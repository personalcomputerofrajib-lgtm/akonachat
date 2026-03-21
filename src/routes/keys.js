const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const PreKeyBundle = require('../models/PreKeyBundle');
const AuditLog = require('../models/AuditLog');

// @route   POST api/keys/upload
// @desc    Upload or update a user's Pre-Key Bundle
// @access  Private
router.post('/upload', auth, async (req, res) => {
  try {
    const { identityKey, signedPreKey, oneTimePreKeys } = req.body;

    let bundle = await PreKeyBundle.findOne({ userId: req.user.userId });

    if (bundle) {
      bundle.identityKey = identityKey;
      bundle.signedPreKey = signedPreKey;
      bundle.oneTimePreKeys = oneTimePreKeys;
      bundle.updatedAt = Date.now();
      await bundle.save();
    } else {
      bundle = new PreKeyBundle({
        userId: req.user.userId,
        identityKey,
        signedPreKey,
        oneTimePreKeys
      });
      await bundle.save();
    }

    // AUDIT LOG
    AuditLog.create({
      userId: req.user.userId,
      action: 'KEY_BUNDLE_UPLOAD',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    res.json({ msg: 'Pre-Key Bundle uploaded successfully' });
  } catch (err) {
    console.error('Key Upload Error:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/keys/fetch/:userId
// @desc    Fetch a user's bundle and consume one One-Time Pre-Key
// @access  Private
router.get('/fetch/:userId', auth, async (req, res) => {
  try {
    const bundle = await PreKeyBundle.findOne({ userId: req.params.userId });

    if (!bundle) {
      return res.status(404).json({ msg: 'Pre-Key Bundle not found' });
    }

    // Strictly consume one One-Time Pre-Key if available
    let oneTimeKey = null;
    if (bundle.oneTimePreKeys && bundle.oneTimePreKeys.length > 0) {
      // Take the first one and remove it from the array
      oneTimeKey = bundle.oneTimePreKeys.shift();
      await bundle.save();
    }

    res.json({
      userId: bundle.userId,
      identityKey: bundle.identityKey,
      signedPreKey: bundle.signedPreKey,
      oneTimePreKey: oneTimeKey // Might be null if all consumed
    });
  } catch (err) {
    console.error('Key Fetch Error:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
