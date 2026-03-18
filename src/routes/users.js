const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/users/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-__v');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/username
router.post('/username', auth, async (req, res) => {
  const { username } = req.body;
  
  if (!username || username.length < 5 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 5-20 characters' });
  }

  if (!/^[a-z0-9_]+$/.test(username.toLowerCase())) {
    return res.status(400).json({ error: 'Only letters, numbers, and underscores allowed' });
  }

  try {
    const existing = await User.findOne({ username_lower: username.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { 
        username, 
        username_lower: username.toLowerCase(),
        hasCompletedOnboarding: true 
      },
      { new: true }
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/search?q=username
router.get('/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const users = await User.find({
      username_lower: { $regex: `^${q.toLowerCase()}` },
      _id: { $ne: req.user.userId },
    }).select('name username profilePic about isOnline lastSeen').limit(20);

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
