const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Redis = require('ioredis');

// Redis with error handling
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  connectTimeout: 5000,
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected successfully to Redis');
});

const getNextSequence = async (chatId) => {
  try {
    return await redis.incr(`seq:${chatId}`);
  } catch (err) {
    console.error('[Redis] Sequence increment failed:', err.message);
    // Fallback: use timestamp as sequence if Redis fails
    return Math.floor(Date.now() / 1000);
  }
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
    } catch (err) {
      console.error('[Socket] Auth error:', err.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`[Socket] User ${userId} connected`);

    try {
      // Join personal room
      socket.join(userId);

      // Presence: increment socket count
      await User.findByIdAndUpdate(userId, {
        $inc: { socketCount: 1 },
        isOnline: true,
      }).catch(err => console.error('[Socket] Presence update error:', err.message));
      
      io.emit('presence', { userId, isOnline: true });

      // Join all user's chat rooms
      const chats = await Chat.find({ participants: userId }).select('_id')
        .catch(err => {
          console.error('[Socket] Chat rooms fetch error:', err.message);
          return [];
        });
        
      chats.forEach((c) => socket.join(c._id.toString()));

    // Explicit join for new chats
    socket.on('join', ({ chatId }) => {
      socket.join(chatId);
    });

    // ── SEND MESSAGE ────────────────────────────────────────
    socket.on('send_message', async (data) => {
      const { chatId, ciphertext, iv, clientMsgId, mediaUrl, signalType } = data;
      if (!chatId || !ciphertext || !clientMsgId) return;
      
      // Standard E2EE uses 'iv', Signal Protocol uses 'signalType'
      if (!iv && signalType === undefined) return;

      // Rate limiting: 500ms between messages
      const now = Date.now();
      if (socket.lastMessageAt && now - socket.lastMessageAt < 500) {
        return socket.emit('error', { message: 'Too many messages. Please slow down.' });
      }
      socket.lastMessageAt = now;

      if (ciphertext.length > 10000) return socket.emit('error', { message: 'Message too large' });

      try {
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.some(p => p.toString() === userId)) {
          return socket.emit('error', { message: 'Not authorized for this chat' });
        }

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
          signalType,
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
      try {
        const msg = await Message.findById(msgId).populate('chatId');
        if (!msg || !msg.chatId.participants.some(p => p.toString() === userId)) return;

        await Message.findByIdAndUpdate(msgId, {
          $addToSet: { deliveredTo: userId },
          status: 'delivered',
        });
        
        io.to(msg.chatId._id.toString()).emit('message_status', { 
          msgId, 
          status: 'delivered', 
          userId, 
          chatId: msg.chatId._id 
        });
      } catch (err) {
        console.error('[Socket] Delivered error:', err.message);
      }
    });

    // ── READ ─────────────────────────────────────────────────
    socket.on('read', async ({ msgId }) => {
      try {
        const msg = await Message.findById(msgId).populate('chatId');
        if (!msg || !msg.chatId.participants.some(p => p.toString() === userId)) return;

        await Message.findByIdAndUpdate(msgId, {
          $addToSet: { readBy: userId },
          status: 'read',
        });

        const chat = await Chat.findById(msg.chatId._id);
        if (chat) {
          const readIndex = chat.lastReadBy.findIndex(r => r.userId.toString() === userId);
          if (readIndex !== -1) {
            if (msg.sequence > chat.lastReadBy[readIndex].lastReadSequence) {
              chat.lastReadBy[readIndex].lastReadSequence = msg.sequence;
            }
          } else {
            chat.lastReadBy.push({ userId, lastReadSequence: msg.sequence });
          }
          await chat.save();
        }

        io.to(msg.chatId._id.toString()).emit('message_status', { 
          msgId, 
          status: 'read', 
          userId,
          sequence: msg.sequence,
          chatId: msg.chatId._id.toString()
        });
      } catch (err) {
        console.error('[Socket] Read error:', err.message);
      }
    });

    // ── READ ALL (Mark entire chat as read) ───────────────────
    socket.on('read_chat', async ({ chatId }) => {
      console.log(`[Socket] User ${userId} marking chat ${chatId} as read`);
      try {
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.some(p => p.toString() === userId)) {
          return socket.emit('error', { message: 'Not authorized for this chat' });
        }

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
    socket.on('typing', async ({ chatId }) => {
      const chat = await Chat.findById(chatId).select('participants');
      if (chat && chat.participants.some(p => p.toString() === userId)) {
        socket.to(chatId).emit('user_typing', { userId, chatId });
      }
    });

    socket.on('stop_typing', async ({ chatId }) => {
      const chat = await Chat.findById(chatId).select('participants');
      if (chat && chat.participants.some(p => p.toString() === userId)) {
        socket.to(chatId).emit('user_stop_typing', { userId, chatId });
      }
    });

    // ── DELETE MESSAGE ──────────────────────────────────────
    socket.on('delete_message', async ({ msgId, everyone }) => {
      try {
      const msg = await Message.findById(msgId).populate('chatId');
      if (!msg || !msg.chatId.participants.some(p => p.toString() === userId)) return;

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
        const msg = await Message.findById(msgId).populate('chatId');
        if (!msg || msg.senderId.toString() !== userId) return;
        if (!msg.chatId.participants.some(p => p.toString() === userId)) return;

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
        const msg = await Message.findById(msgId).populate('chatId');
        if (!msg || !msg.chatId.participants.some(p => p.toString() === userId)) return;

        await Message.findByIdAndUpdate(msgId, {
          $pull: { reactions: { userId: userId } }
        });
        
        const updatedMsg = await Message.findByIdAndUpdate(msgId, {
          $push: { reactions: { userId, emoji } }
        }, { new: true });

        io.to(msg.chatId._id.toString()).emit('message_reaction_updated', {
          msgId,
          chatId: msg.chatId._id,
          reactions: updatedMsg.reactions
        });
      } catch (err) {
        console.error('[Socket] Reaction error:', err.message);
      }
    });

    // ── SYNC (reconnection) ──────────────────────────────────
    socket.on('sync', async ({ chatId, lastSequence }) => {
      try {
        const chat = await Chat.findById(chatId).select('participants');
        if (!chat || !chat.participants.some(p => p.toString() === userId)) {
          return socket.emit('error', { message: 'Not authorized' });
        }

        const messages = await Message.find({
          chatId,
          sequence: { $gt: lastSequence },
        }).sort({ sequence: 1 }).limit(100).populate('senderId', 'name profilePic');

        socket.emit('sync_messages', messages);
      } catch (err) {
        console.error('[Socket] Sync error:', err.message);
      }
    });

    // ── GIFTS & ENGAGEMENT ──────────────────────────────────
    socket.on('send_gift', async (data) => {
      const { recipientId, itemId, isAnonymous } = data;
      if (!recipientId || !itemId) return;

      try {
        const sender = await User.findById(userId).select('name');
        // The business logic (coins/db) is handled in the REST API for security, 
        // but we broadcast the UI notification here.
        io.to(recipientId).emit('gift_received', {
          itemId,
          senderName: isAnonymous ? 'Secret User' : sender.name,
          timestamp: new Date()
        });
      } catch (err) {
        console.error('[Socket] Gift broadcast error:', err.message);
      }
    });
  
    socket.on('update_chat_settings', async ({ chatId, themeColor, wallpaperUrl }) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.some(p => p.toString() === userId)) {
          return socket.emit('error', { message: 'Not authorized' });
        }

        const update = {};
        if (themeColor) update.themeColor = themeColor;
        if (wallpaperUrl) update.wallpaperUrl = wallpaperUrl;
        if (data.backgroundColor) update.backgroundColor = data.backgroundColor;

        const updatedChat = await Chat.findByIdAndUpdate(chatId, update, { new: true });
        io.to(chatId).emit('chat_settings_updated', {
          chatId,
          themeColor: updatedChat.themeColor,
          wallpaperUrl: updatedChat.wallpaperUrl,
          backgroundColor: updatedChat.backgroundColor
        });
      } catch (err) {
        console.error('[Socket] Settings update error:', err.message);
      }
    });

    // ── DISCONNECT ───────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const user = await User.findByIdAndUpdate(
          userId,
          { $inc: { socketCount: -1 } },
          { new: true }
        );

        if (user && user.socketCount <= 0) {
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date(),
            socketCount: 0,
          });
          io.emit('presence', { userId, isOnline: false, lastSeen: new Date() });
        }
        console.log(`[Socket] User ${userId} disconnected`);
      } catch (err) {
        console.error('[Socket] Disconnect handler error:', err.message);
      }
    });

    } catch (err) {
      console.error('[Socket] Connection handler error:', err.message);
      socket.emit('error', { message: 'Connection error' });
      socket.disconnect();
    }
  });
};

module.exports = setupSocket;
