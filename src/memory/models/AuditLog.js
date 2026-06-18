import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  botId: { type: String, index: true },
  roomId: { type: String, index: true },
  action: { type: String, enum: ['approve', 'reject', 'hold', 'blacklist', 'edit'], required: true },
  details: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema, 'audit_logs');
