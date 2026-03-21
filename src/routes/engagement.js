const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth'); // Assuming you have auth middleware

/**
 * @route   POST /api/engagement/claim-daily
 * @desc    Claim daily login reward and update streak
 */
router.post('/claim-daily', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let lastLogin = user.lastLoginDate;
    if (lastLogin) {
      lastLogin = new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate());
    }

    // Check if user already claimed today
    if (lastLogin && today.getTime() === lastLogin.getTime()) {
      return res.status(400).json({ message: 'Already claimed today' });
    }

    // Check if it's a consecutive day
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastLogin && lastLogin.getTime() === yesterday.getTime()) {
      user.streak += 1;
    } else {
      user.streak = 1;
    }

    // Award coins based on streak (1-7 day cycle)
    const day = ((user.streak - 1) % 7) + 1;
    const rewards = [15, 20, 25, 30, 35, 40, 50];
    let reward = rewards[day - 1] || 15;
    
    // Day 7 special logic: Add a random mystery gift
    if (day === 7) {
      const mysteryGifts = ['rose', 'cake', 'friendship_band'];
      const randomGift = mysteryGifts[Math.floor(Math.random() * mysteryGifts.length)];
      user.gifts.push({
        itemId: randomGift,
        senderId: null, // System gift
        isAnonymous: true,
        timestamp: new Date()
      });
    }

    user.coins += reward;
    user.lastLoginDate = now;
    await user.save();

    // Reward XP for daily login
    await User.addXP(req.user.userId, 50);

    res.json({
      message: `Claimed ${reward} coins!`,
      coins: user.coins,
      streak: user.streak,
      reward
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/**
 * @route   GET /api/engagement/status
 * @desc    Get current daily reward status
 */
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let lastLogin = user.lastLoginDate;
    if (lastLogin) {
      lastLogin = new Date(lastLogin.getFullYear(), lastLogin.getMonth(), lastLogin.getDate());
    }

    const canClaim = !lastLogin || today.getTime() !== lastLogin.getTime();
    
    res.json({
      canClaim,
      streak: user.streak,
      lastClaimed: user.lastLoginDate,
      nextRewardDay: ((user.streak) % 7) + 1
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

/**
 * @route   POST /api/engagement/send-gift
 * @desc    Send a sticker gift to another user
 */
router.post('/send-gift', auth, async (req, res) => {
  const { recipientId, itemId, isAnonymous } = req.body;
  if (!recipientId || !itemId) return res.status(400).json({ message: 'Missing fields' });

  try {
    const sender = await User.findById(req.user.userId);
    const recipient = await User.findById(recipientId);

    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });

    // Gift Prices
    const prices = {
      'rose': 10,
      'cake': 25,
      'friendship_band': 50,
      'car': 500
    };

    const price = prices[itemId] || 10;

    if (sender.coins < price) {
      return res.status(400).json({ message: 'Not enough coins' });
    }

    // Deduct and Add
    sender.coins -= price;
    recipient.gifts.push({
      itemId,
      senderId: isAnonymous ? null : sender._id,
      isAnonymous,
      timestamp: new Date()
    });

    await sender.save();
    await recipient.save();

    // Reward XP for gifting
    await User.addXP(req.user.userId, 10);

    // The Socket notification should happen here or in the controller
    // req.io.to(recipientId).emit('gift_received', { itemId, senderName: isAnonymous ? 'Secret User' : sender.name });

    res.json({ message: 'Gift sent successfully!', coins: sender.coins });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/**
 * @route   GET /api/engagement/leaderboard
 * @desc    Get global popularity leaderboard
 */
router.get('/leaderboard', auth, async (req, res) => {
  try {
    const topUsers = await User.aggregate([
      { $project: { name: 1, profilePic: 1, username: 1, giftCount: { $size: "$gifts" } } },
      { $sort: { giftCount: -1 } },
      { $limit: 20 }
    ]);
    res.json(topUsers);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

/**
 * @route   GET /api/engagement/guards/:userId
 * @desc    Get top gifters for a specific user
 */
router.get('/guards/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Aggregate gifts by senderId and count them
    const guards = await User.aggregate([
      { $match: { _id: user._id } },
      { $unwind: "$gifts" },
      { $group: { _id: "$gifts.senderId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'senderInfo' } },
      { $unwind: "$senderInfo" },
      { $project: { _id: 1, count: 1, "senderInfo.name": 1, "senderInfo.profilePic": 1, "senderInfo.username": 1 } }
    ]);

    res.json(guards);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

module.exports = router;
