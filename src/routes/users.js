const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

const xss = require('xss');
const validator = require('validator');
const AuditLog = require('../models/AuditLog');

// GET /api/users/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('name username profilePic profileBanner animeBanner about email hasCompletedOnboarding isOnline lastSeen coins streak gifts gameId signature guards titles xp level createdAt');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/username
router.post('/username', auth, async (req, res) => {
  let { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  
  username = validator.trim(username);
  if (username.length < 5 || username.length > 20) {
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
    ).select('name username profilePic about hasCompletedOnboarding');

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/profile
router.patch('/profile', auth, async (req, res) => {
  let { name, about, profilePic, profileBanner, animeBanner, signature, gameId } = req.body;
  const updates = {};
  
  if (name) {
    name = xss(validator.trim(name));
    if (name.length > 50) return res.status(400).json({ error: 'Name too long (max 50)' });
    updates.name = name;
  }
  
  if (about) {
    about = xss(validator.trim(about));
    if (about.length > 200) return res.status(400).json({ error: 'About too long (max 200)' });
    updates.about = about;
  }

  if (signature) {
    updates.signature = xss(validator.trim(signature));
  }

  if (gameId) {
    updates.gameId = xss(validator.trim(gameId));
  }
  
  if (profilePic) {
    // Relaxed validation: Allow any URL but check for suspicious patterns
    if (!validator.isURL(profilePic, { protocols: ['http','https'], require_tld: false })) {
      return res.status(400).json({ error: 'Invalid profile picture URL' });
    }
    updates.profilePic = profilePic;
  }

  if (profileBanner) {
    updates.profileBanner = profileBanner;
  }

  if (animeBanner) {
    updates.animeBanner = animeBanner;
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true }
    ).select('name username profilePic profileBanner animeBanner about gameId signature isOnline lastSeen');
    
    // AUDIT LOG
    AuditLog.create({
      userId: req.user.userId,
      action: 'PROFILE_UPDATE',
      details: { updatedFields: Object.keys(updates) },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper to escape regex special characters
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/users/blocked
router.get('/blocked', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('blockedUsers', 'name username profilePic about');
    res.json(user.blockedUsers);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/search?q=username
router.get('/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  try {
    const query = escapeRegExp(q);
    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } }
      ]
    }).limit(20).select('name username profilePic about isOnline');
    
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/users/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name username profilePic about isOnline lastSeen coins streak gifts profileBanner animeBanner gameId signature guards titles xp level createdAt');
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json(user);
  } catch (err) {
    console.error('Fetch user error:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
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

    // AUDIT LOG
    AuditLog.create({
      userId: req.user.userId,
      action: 'BLOCK_USER',
      details: { targetUserId: userIdToBlock },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json({ message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Unblock a user
router.post('/unblock', auth, async (req, res) => {
  try {
    const { userId } = req.body; // Match Flutter expected key
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    await User.findByIdAndUpdate(req.user.userId, {
      $pull: { blockedUsers: userId }
    });

    // AUDIT LOG
    AuditLog.create({
      userId: req.user.userId,
      action: 'UNBLOCK_USER',
      details: { targetUserId: userId },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json({ message: 'User unblocked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/privacy
router.patch('/privacy', auth, async (req, res) => {
  const { showLastSeen, showReadReceipts } = req.body;
  const updates = {};
  if (showLastSeen !== undefined) updates['privacySettings.showLastSeen'] = showLastSeen;
  if (showReadReceipts !== undefined) updates['privacySettings.showReadReceipts'] = showReadReceipts;

  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true }
    ).select('privacySettings');
    res.json(user.privacySettings);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
