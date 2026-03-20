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
  
  if (!username || username.length < 5 || username.length > 10) {
    return res.status(400).json({ error: 'Username must be 5-10 characters' });
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

// PATCH /api/users/profile
router.patch('/profile', auth, async (req, res) => {
  const { name, about, profilePic } = req.body;
  const updates = {};
  
  if (name) updates.name = name;
  if (about) updates.about = about;
  if (profilePic) updates.profilePic = profilePic;

  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true }
    ).select('-__v');
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/search?q=username
router.get('/search', auth, async (req, res) => {
  let { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  // Handle @ by stripping it
  q = q.startsWith('@') ? q.substring(1) : q;

  try {
    const searchRegex = new RegExp(q.toLowerCase(), 'i');
    
    // Get the current user to check their blocked list and who blocked them
    const currentUser = await User.findById(req.user.userId).select('blockedUsers');
    const whoBlockedMe = await User.find({ blockedUsers: req.user.userId }).select('_id');
    const whoBlockedMeIds = whoBlockedMe.map(u => u._id);

    const users = await User.find({
      $and: [
        { _id: { $ne: req.user.userId } },
        { _id: { $nin: currentUser.blockedUsers } }, // Don't show users I blocked
        { _id: { $nin: whoBlockedMeIds } }, // Don't show users who blocked me
        { 
          $or: [
            { name: { $regex: searchRegex } },
            { username_lower: { $regex: searchRegex } }
          ]
        }
      ]
    }).select('name username profilePic about isOnline lastSeen').limit(100);

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Block a user
router.post('/block', auth, async (req, res) => {
  try {
    const { userIdToBlock } = req.body;
    if (!userIdToBlock) return res.status(400).json({ error: 'User ID required' });

    await User.findByIdAndUpdate(req.user.userId, {
      $addToSet: { blockedUsers: userIdToBlock }
    });
    res.json({ message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Unblock a user
router.post('/unblock', auth, async (req, res) => {
  try {
    const { userIdToUnblock } = req.body;
    if (!userIdToUnblock) return res.status(400).json({ error: 'User ID required' });

    await User.findByIdAndUpdate(req.user.userId, {
      $pull: { blockedUsers: userIdToUnblock }
    });
    res.json({ message: 'User unblocked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
