import mongoose from 'mongoose';

const moderationQueueSchema = new mongoose.Schema({
  botId: { type: String, required: true, index: true },
  roomId: { type: String, required: true, index: true },
  question: { type: String }, // Original transcript / trigger text
  answer: { type: String, required: true }, // Generated response
  status: { type: String, enum: ['pending', 'held', 'approved', 'rejected', 'blacklisted'], default: 'pending', index: true },
  trigger: { type: mongoose.Schema.Types.Mixed },
  usage: { type: mongoose.Schema.Types.Mixed },
  contextPayload: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now, index: true },
  actionedAt: { type: Date },
});

export function getRejectQueueModel(botId) {
  const cleanBotName = botId.replace('-bot', '').toLowerCase();
  const collectionName = `reject_queue/${cleanBotName}`;
  const modelName = `RejectQueue_${cleanBotName}`;
  
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName];
  }
  
  return mongoose.model(modelName, moderationQueueSchema, collectionName);
}
