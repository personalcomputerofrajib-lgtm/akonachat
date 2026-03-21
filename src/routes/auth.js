const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const TokenBlacklist = require('../models/TokenBlacklist');
const AuditLog = require('../models/AuditLog'); // Moved to top

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /api/auth/google
router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    let user = await User.findOne({ googleId: payload.sub });
    if (!user) {
      user = await User.create({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        profilePic: payload.picture,
      });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // AUDIT LOG
    AuditLog.create({
      userId: user._id,
      action: 'LOGIN',
      details: { email: user.email },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json({ 
      token, 
      user,
      requiresUsername: !user.username 
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    await TokenBlacklist.create({ token });
    
    // AUDIT LOG
    AuditLog.create({
      userId: req.user.userId,
      action: 'LOGOUT',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
