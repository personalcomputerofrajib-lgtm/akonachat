const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ciphertext: { type: String, required: true }, // E2EE — server never decrypts
  iv: { type: String, required: true },
  clientMsgId: { type: String, required: true, unique: true }, // idempotency
  sequence: { type: Number }, // atomic ordering via Redis INCR
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  mediaUrl: { type: String },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // "Delete for Me"
  isDeletedEveryone: { type: Boolean, default: false }, // "Delete for Everyone"
  isEdited: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ chatId: 1, sequence: 1 });
messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
