const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth'); // Assuming you have auth middleware

const GIFT_COSTS = {
  'rose': 5,
  'heart': 10,
  'chocolate': 20,
  'coffee': 30,
  'cake': 50,
  'bouquet': 100,
  'diamond': 150,
  'car': 200,
  'castle': 500,
  'rocket': 1000
};

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
      // Increment streak, reset to 1 if it was 7 (weekly cycle)
      user.streak = (user.streak % 7) + 1;
    } else {
      user.streak = 1;
    }

    // Award coins based on streak (1-7 day cycle)
    const rewards = [15, 20, 25, 30, 35, 40, 50];
    let reward = rewards[user.streak - 1] || 15;
    
    // Day 7 special logic: Add a random mystery gift
    if (user.streak === 7) {
      const mysteryGifts = ['rose', 'cake', 'heart'];
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

// ── GET STATUS ──────────────────────────────────────────────
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
      nextRewardDay: (user.streak % 7) + 1
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ── SEND GIFT ──────────────────────────────────────────────
router.post('/send-gift', auth, async (req, res) => {
  const { recipientId, itemId, isAnonymous } = req.body;
  if (!recipientId || !itemId) return res.status(400).json({ message: 'Missing data' });

  try {
    const sender = await User.findById(req.user.userId);
    const recipient = await User.findById(recipientId);

    if (!sender || !recipient) return res.status(404).json({ message: 'User not found' });

    const cost = GIFT_COSTS[itemId.toLowerCase()] || 10;
    if (sender.coins < cost) {
      return res.status(400).json({ message: `Insufficient coins. Need ${cost} Akona Coins.` });
    }

    // Deduct and Add
    sender.coins -= cost;
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
