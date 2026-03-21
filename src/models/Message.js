const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ciphertext: { type: String, required: true, maxlength: 10000 },
  iv: { type: String }, // Optional for Signal messages
  signalType: { type: Number }, // Required for Signal messages
  clientMsgId: { type: String, required: true, unique: true },
  sequence: { type: Number },
  type: { type: String, enum: ['text', 'image', 'voice'], default: 'text' },
  mediaUrl: { type: String },
  duration: { type: Number }, // For voice messages in seconds
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // "Delete for Me"
  isDeletedEveryone: { type: Boolean, default: false }, // "Delete for Everyone"
  isEdited: { type: Boolean, default: false },
  reactions: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      emoji: String
    }
  ]
}, { timestamps: true });

messageSchema.index({ chatId: 1, sequence: 1 });
messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
