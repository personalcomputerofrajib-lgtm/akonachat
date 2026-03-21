const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true }, // e.g., 'PROFILE_UPDATE', 'BLOCK_USER', 'FILE_UPLOAD'
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
