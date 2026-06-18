import mongoose from 'mongoose';

const botDefinitionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  envId: { type: String },
  defaultId: { type: String },
  envIdentity: { type: String },
  defaultIdentity: { type: String },
  envName: { type: String },
  defaultName: { type: String },
  displayNameVariations: [{ type: String }],
  updatedAt: { type: Date, default: Date.now }
});

export const BotDefinition = mongoose.model('BotDefinition', botDefinitionSchema, 'bot_definitions');
