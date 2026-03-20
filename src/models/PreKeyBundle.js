const mongoose = require('mongoose');

const PreKeyBundleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  identityKey: {
    type: String, // Base64 encoded Public Identity Key
    required: true
  },
  signedPreKey: {
    key: { type: String, required: true },
    signature: { type: String, required: true },
    id: { type: Number, required: true }
  },
  oneTimePreKeys: [{
    key: { type: String, required: true },
    id: { type: Number, required: true }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for fast lookup when starting a chat
PreKeyBundleSchema.index({ userId: 1 });

module.exports = mongoose.model('PreKeyBundle', PreKeyBundleSchema);
