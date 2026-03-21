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

    // Award coins based on streak
    let reward = 10;
    if (user.streak === 2) reward = 15;
    else if (user.streak === 3) reward = 20;
    else if (user.streak >= 4 && user.streak <= 6) reward = 30;
    else if (user.streak >= 7) {
       reward = 50;
       // Special gift on day 7? We can add logic here later
    }

    user.coins += reward;
    user.lastLoginDate = now;
    await user.save();

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

    // The Socket notification should happen here or in the controller
    // req.io.to(recipientId).emit('gift_received', { itemId, senderName: isAnonymous ? 'Secret User' : sender.name });

    res.json({ message: 'Gift sent successfully!', coins: sender.coins });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
