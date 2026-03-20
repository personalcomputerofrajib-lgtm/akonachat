const express = require('express');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/chats — get all chats for current user
router.get('/', auth, async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user.userId })
      .populate('participants', 'name username profilePic isOnline lastSeen')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1 });

    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/chats/private — start or get private chat
router.post('/private', auth, async (req, res) => {
  const { targetUserId, targetUsername } = req.body;
  
  try {
    let targetId = targetUserId;

    if (targetUsername) {
      const targetUser = await User.findOne({ username_lower: targetUsername.toLowerCase() });
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      targetId = targetUser._id;
    }

    if (!targetId) return res.status(400).json({ error: 'targetUserId or targetUsername required' });
    
    // Block Check
    const currentUser = await User.findById(req.user.userId);
    const targetUser = await User.findById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

    if (currentUser.blockedUsers.includes(targetId) || targetUser.blockedUsers.includes(req.user.userId)) {
      return res.status(403).json({ error: 'Cannot start chat with a blocked user' });
    }

    if (targetId.toString() === req.user.userId.toString()) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    let chat = await Chat.findOne({
      type: 'private',
      participants: { $all: [req.user.userId, targetId], $size: 2 },
    }).populate('participants', 'name username profilePic isOnline lastSeen');

    if (!chat) {
      chat = await Chat.create({
        type: 'private',
        participants: [req.user.userId, targetId],
        lastReadBy: [
          { userId: req.user.userId, lastReadSequence: 0 },
          { userId: targetId, lastReadSequence: 0 },
        ],
      });
      chat = await chat.populate('participants', 'name username profilePic isOnline lastSeen');
    }

    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/chats/:chatId — get single chat details
router.get('/:chatId', auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ 
      _id: req.params.chatId,
      participants: req.user.userId 
    }).populate('participants', 'name username profilePic about isOnline lastSeen');
    
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/chats/:chatId/messages?before=timestamp
router.get('/:chatId/messages', auth, async (req, res) => {
  const { before } = req.query;
  const query = { chatId: req.params.chatId };
  if (before) query.createdAt = { $lt: new Date(before) };

  try {
    const messages = await Message.find(query)
      .sort({ sequence: -1 })
      .limit(50)
      .populate('senderId', 'name profilePic');

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
