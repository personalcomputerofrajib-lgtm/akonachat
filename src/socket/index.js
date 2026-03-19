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
      const { chatId, ciphertext, iv, clientMsgId } = data;
      if (!chatId || !ciphertext || !iv || !clientMsgId) return;

      try {
        const seq = await getNextSequence(chatId);

        const msg = await Message.create({
          chatId,
          senderId: userId,
          ciphertext,
          iv,
          clientMsgId,
          sequence: seq,
        });

        // Update Chat metadata AND mark as read for the SENDER
        await Chat.updateOne(
          { _id: chatId, "lastReadBy.userId": userId },
          { 
            $set: { 
              "lastReadBy.$.lastReadSequence": seq,
              lastMessage: msg._id,
              lastMessageAt: msg.createdAt,
              lastSequence: seq
            }
          }
        );

        const populated = await msg.populate('senderId', 'name profilePic');

        io.to(chatId).emit('receive_message', populated);
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
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        await Chat.updateOne(
          { _id: chatId, "lastReadBy.userId": userId },
          { $set: { "lastReadBy.$.lastReadSequence": chat.lastSequence } }
        );

        // Also mark all unread messages in this chat as read by this user
        await Message.updateMany(
          { chatId, senderId: { $ne: userId }, status: { $ne: 'read' } },
          { $set: { status: 'read' }, $addToSet: { readBy: userId } }
        );

        socket.emit('chat_read_confirmed', { chatId });
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

    // ── SYNC (reconnection) ──────────────────────────────────
    socket.on('sync', async ({ chatId, lastSequence }) => {
      const messages = await Message.find({
        chatId,
        sequence: { $gt: lastSequence },
      }).sort({ sequence: 1 }).limit(100);

      socket.emit('sync_messages', messages);
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
