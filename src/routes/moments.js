const express = require('express');
const router = express.Router();
const Moment = require('../models/Moment');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/moments
 * @desc    Create a new moment
 */
router.post('/', auth, async (req, res) => {
  const { text, imageUrl, type } = req.body;
  
  try {
    const moment = new Moment({
      userId: req.user.userId,
      text,
      imageUrl,
      type: type || (imageUrl ? 'image' : 'text')
    });

    await moment.save();
    const populated = await moment.populate('userId', 'name profilePic username');
    
    res.json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/**
 * @route   GET /api/moments
 * @desc    Get all active moments (global feed)
 */
router.get('/', auth, async (req, res) => {
  try {
    const moments = await Moment.find()
      .populate('userId', 'name profilePic username')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(moments);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/**
 * @route   POST /api/moments/like/:id
 * @desc    Like/Unlike a moment
 */
router.post('/like/:id', auth, async (req, res) => {
  try {
    const moment = await Moment.findById(req.params.id);
    if (!moment) return res.status(404).json({ message: 'Moment not found' });

    const likeIndex = moment.likes.indexOf(req.user.userId);
    if (likeIndex === -1) {
      moment.likes.push(req.user.userId);
    } else {
      moment.likes.splice(likeIndex, 1);
    }

    await moment.save();
    res.json(moment.likes);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
