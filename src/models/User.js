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
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  privacySettings: {
    showLastSeen: { type: Boolean, default: true },
    showReadReceipts: { type: Boolean, default: true },
  },
  coins: { type: Number, default: 10 }, // Start with 10 coins
  streak: { type: Number, default: 0 },
  lastLoginDate: { type: Date },
  gifts: [{
    itemId: String,
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isAnonymous: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
  }],
  profileBanner: { type: String, default: '' },
  animeBanner: { type: String, default: '' },
  gameId: { type: String, default: '' },
  titles: [{ type: String }],
  guards: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    totalGiftsValue: { type: Number, default: 0 }
  }],
  signature: { type: String, default: '' },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
}, { timestamps: true });

userSchema.index({ username_lower: 1 });

userSchema.statics.addXP = async function(userId, amount) {
  const user = await this.findById(userId);
  if (!user) return null;

  user.xp += amount;
  
  // Logic: Level = floor(sqrt(xp) / 5) + 1
  // level 1: 0xp, level 2: 25xp, level 3: 100xp, level 4: 225xp etc.
  const oldLevel = user.level;
  const newLevel = Math.floor(Math.sqrt(user.xp) / 5) + 1;
  
  if (newLevel > oldLevel) {
    user.level = newLevel;
    await user.save();
    return { leveledUp: true, newLevel, currentXP: user.xp };
  }
  
  await user.save();
  return { leveledUp: false, newLevel, currentXP: user.xp };
};

module.exports = mongoose.model('User', userSchema);
