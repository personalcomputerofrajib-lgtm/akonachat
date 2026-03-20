const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const getNextSequence = async (chatId) => {
  return await redis.incr(`seq:${chatId}`); // Atomic Redis INCR — no race condition
};

const setupSocket = (io) => {
  // Auth middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    // Join personal room
    socket.join(userId);

    // Presence: increment socket count
    await User.findByIdAndUpdate(userId, {
      $inc: { socketCount: 1 },
      isOnline: true,
    });
    io.emit('presence', { userId, isOnline: true });

    // Join all user's chat rooms
    const chats = await Chat.find({ participants: userId }).select('_id');
    chats.forEach((c) => socket.join(c._id.toString()));

    // Explicit join for new chats
    socket.on('join', ({ chatId }) => {
      socket.join(chatId);
    });

    // ── SEND MESSAGE ────────────────────────────────────────
    socket.on('send_message', async (data) => {
      const { chatId, ciphertext, iv, clientMsgId, mediaUrl } = data;
      if (!chatId || !ciphertext || !iv || !clientMsgId) return;

      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        // Block Check: Ensure neither participant has blocked the other
        const participants = await User.find({ _id: { $in: chat.participants } });
        const sender = participants.find(p => p._id.toString() === userId);
        const recipient = participants.find(p => p._id.toString() !== userId);
        
        if (sender && recipient) {
          if (sender.blockedUsers.includes(recipient._id) || recipient.blockedUsers.includes(sender._id)) {
            return socket.emit('error', { message: 'Cannot send message to a blocked user' });
          }
        }

        const seq = await getNextSequence(chatId);

        console.log(`[Socket] Message from ${userId} to chat ${chatId}. Ciphertext length: ${ciphertext.length}`);

        const msg = await Message.create({
          chatId,
          senderId: userId,
          ciphertext,
          iv,
          clientMsgId,
          sequence: seq,
          mediaUrl,
          type: mediaUrl ? 'image' : 'text',
        });

        // Update Chat metadata AND mark as read for the SENDER
        // Use arrayFilters to reliably update the sender's lastReadBy entry.
        const updateResult = await Chat.updateOne(
          { _id: chatId },
          {
            $set: {
              'lastReadBy.$[elem].lastReadSequence': seq,
              lastMessage: msg._id,
              lastMessageAt: msg.createdAt,
              lastSequence: seq,
            },
          },
          { arrayFilters: [{ 'elem.userId': new (require('mongoose').Types.ObjectId)(userId) }] }
        );

        // If sender had no lastReadBy entry yet, push one now.
        if (updateResult.modifiedCount === 0) {
          await Chat.updateOne(
            { _id: chatId },
            {
              $set: { lastMessage: msg._id, lastMessageAt: msg.createdAt, lastSequence: seq },
              $push: { lastReadBy: { userId, lastReadSequence: seq } },
            }
          );
        }

        const populated = await msg.populate('senderId', 'name profilePic');
        console.log(`[Socket] Emitting message. Populated Sender: ${populated.senderId?.name} (${populated.senderId?._id})`);

        io.to(chatId).emit('receive_message', populated.toObject());
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate clientMsgId — silently ignore (idempotent)
          return;
        }
        socket.emit('error', { message: 'Message failed' });
      }
    });

    // ── DELIVERED ───────────────────────────────────────────
    socket.on('delivered', async ({ msgId }) => {
      const msg = await Message.findById(msgId);
      if (!msg) return;

      await Message.findByIdAndUpdate(msgId, {
        $addToSet: { deliveredTo: userId },
        status: 'delivered',
      });
      
      io.to(msg.chatId.toString()).emit('message_status', { 
        msgId, 
        status: 'delivered', 
        userId, 
        chatId: msg.chatId 
      });
    });

    // ── READ ─────────────────────────────────────────────────
    socket.on('read', async ({ msgId }) => {
      const msg = await Message.findById(msgId);
      if (!msg) return;

      await Message.findByIdAndUpdate(msgId, {
        $addToSet: { readBy: userId },
        status: 'read',
      });

      // Update Chat lastReadBy for this user - using atomic update with upsert-like logic for array
      const chat = await Chat.findById(msg.chatId);
      if (chat) {
        const readIndex = chat.lastReadBy.findIndex(r => r.userId.toString() === userId);
        if (readIndex !== -1) {
          // Update existing
          if (msg.sequence > chat.lastReadBy[readIndex].lastReadSequence) {
            chat.lastReadBy[readIndex].lastReadSequence = msg.sequence;
          }
        } else {
          // Add new entry
          chat.lastReadBy.push({ userId, lastReadSequence: msg.sequence });
        }
        await chat.save();
      }

      io.to(msg.chatId.toString()).emit('message_status', { 
        msgId, 
        status: 'read', 
        userId,
        sequence: msg.sequence,
        chatId: msg.chatId.toString()
      });
    });

    // ── READ ALL (Mark entire chat as read) ───────────────────
    socket.on('read_chat', async ({ chatId }) => {
      console.log(`[Socket] User ${userId} marking chat ${chatId} as read`);
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        const readResult = await Chat.updateOne(
          { _id: chatId },
          { $set: { 'lastReadBy.$[elem].lastReadSequence': chat.lastSequence } },
          { arrayFilters: [{ 'elem.userId': new (require('mongoose').Types.ObjectId)(userId) }] }
        );
        if (readResult.modifiedCount === 0) {
          await Chat.updateOne(
            { _id: chatId },
            { $push: { lastReadBy: { userId, lastReadSequence: chat.lastSequence } } }
          );
        }
        console.log(`[Socket] Updated lastReadSequence for chat ${chatId} to ${chat.lastSequence}`);

        // Also mark all unread messages in this chat as read by this user
        await Message.updateMany(
          { chatId, senderId: { $ne: userId }, status: { $ne: 'read' } },
          { $set: { status: 'read' }, $addToSet: { readBy: userId } }
        );

        socket.emit('chat_read_confirmed', { chatId });
        
        // BROADCAST to everyone in the chat (including the user's other devices)
        // so their ChatListScreen can refresh the unread count instantly.
        io.to(chatId).emit('message_status', { 
          chatId, 
          userId, 
          status: 'read',
          lastReadSequence: chat.lastSequence 
        });
      } catch (err) {
        console.error('Read chat error:', err);
      }
    });

    // ── TYPING ──────────────────────────────────────────────
    socket.on('typing', ({ chatId }) => {
      socket.to(chatId).emit('user_typing', { userId, chatId });
    });

    socket.on('stop_typing', ({ chatId }) => {
      socket.to(chatId).emit('user_stop_typing', { userId, chatId });
    });

    // ── DELETE MESSAGE ──────────────────────────────────────
    socket.on('delete_message', async ({ msgId, everyone }) => {
      try {
        const msg = await Message.findById(msgId);
        if (!msg) return;

        // "Delete for Me" (just add to isDeletedFor)
        await Message.findByIdAndUpdate(msgId, {
          $addToSet: { isDeletedFor: userId }
        });

        if (everyone && msg.senderId.toString() === userId) {
          // "Delete for Everyone" (only sender can do this)
          await Message.findByIdAndUpdate(msgId, {
            isDeletedEveryone: true,
            ciphertext: 'This message was deleted', // Replace content
            type: 'text',
            mediaUrl: null
          });
          io.to(msg.chatId.toString()).emit('message_deleted_everyone', { msgId, chatId: msg.chatId });
        } else {
          // Tell the specific user's other devices that it was deleted for them
          socket.emit('message_deleted_me', { msgId, chatId: msg.chatId });
        }
      } catch (err) {
        console.error('Delete error:', err);
      }
    });

    // ── EDIT MESSAGE ────────────────────────────────────────
    socket.on('edit_message', async ({ msgId, newText }) => {
      try {
        const msg = await Message.findById(msgId);
        if (!msg || msg.senderId.toString() !== userId) return;

        await Message.findByIdAndUpdate(msgId, {
          ciphertext: newText,
          isEdited: true
        });

        io.to(msg.chatId.toString()).emit('message_edited', { 
          msgId, 
          chatId: msg.chatId, 
          newText, 
          isEdited: true 
        });
      } catch (err) {
        console.error('Edit error:', err);
      }
    });

    // ── MESSAGE REACTIONS ─────────────────────────────────────
    socket.on('add_reaction', async ({ msgId, emoji }) => {
      try {
        const msg = await Message.findById(msgId);
        if (!msg) return;

        // Remove existing reaction from this user if any, then push new one
        await Message.findByIdAndUpdate(msgId, {
          $pull: { reactions: { userId: userId } }
        });
        
        const updatedMsg = await Message.findByIdAndUpdate(msgId, {
          $push: { reactions: { userId, emoji } }
        }, { new: true });

        io.to(msg.chatId.toString()).emit('message_reaction_updated', {
          msgId,
          chatId: msg.chatId,
          reactions: updatedMsg.reactions
        });
      } catch (err) {
        console.error('Reaction error:', err);
      }
    });

    // ── SYNC (reconnection) ──────────────────────────────────
    socket.on('sync', async ({ chatId, lastSequence }) => {
      const messages = await Message.find({
        chatId,
        sequence: { $gt: lastSequence },
      }).sort({ sequence: 1 }).limit(100).populate('senderId', 'name profilePic');

      socket.emit('sync_messages', messages);
    });
  
    // ── CHAT SETTINGS (Theme/Wallpaper) ──────────────────────
    socket.on('update_chat_settings', async ({ chatId, themeColor, wallpaperUrl }) => {
      try {
        const update = {};
        if (themeColor) update.themeColor = themeColor;
        if (wallpaperUrl) update.wallpaperUrl = wallpaperUrl;

        const chat = await Chat.findByIdAndUpdate(chatId, update, { new: true });
        io.to(chatId).emit('chat_settings_updated', {
          chatId,
          themeColor: chat.themeColor,
          wallpaperUrl: chat.wallpaperUrl
        });
      } catch (err) {
        console.error('Settings update error:', err);
      }
    });

    // ── DISCONNECT ───────────────────────────────────────────
    socket.on('disconnect', async () => {
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { socketCount: -1 } },
        { new: true }
      );

      if (user.socketCount <= 0) {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
          socketCount: 0,
        });
        io.emit('presence', { userId, isOnline: false, lastSeen: new Date() });
      }
    });
  });
};

module.exports = setupSocket;
