const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '30d', // Automatically remove from blacklist after token would have expired anyway
  },
});

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
