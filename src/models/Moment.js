const mongoose = require('mongoose');

const momentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    trim: true,
    maxlength: 300
  },
  imageUrl: {
    type: String
  },
  type: {
    type: String,
    enum: ['text', 'image'],
    default: 'text'
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 * 7 // Moments expire after 7 days automatically
  }
});

module.exports = mongoose.model('Moment', momentSchema);
