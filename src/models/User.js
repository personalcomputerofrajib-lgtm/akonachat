const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  username: { type: String, unique: true, sparse: true },
  username_lower: { type: String, unique: true, sparse: true, lowercase: true },
  name: { type: String, required: true },
  profilePic: { type: String, default: '' },
  about: { type: String, default: 'Hey there! I am using AkonaChat.' },
  hasCompletedOnboarding: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  socketCount: { type: Number, default: 0 },
}, { timestamps: true });

userSchema.index({ username_lower: 1 });

module.exports = mongoose.model('User', userSchema);
