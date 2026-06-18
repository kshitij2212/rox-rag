import mongoose from 'mongoose';

const personalitySchema = new mongoose.Schema({
  tone: { type: String },
  energy: { type: String },
  humor: { type: String },
  traits: [{ type: String }]
}, { _id: false });

const replyStyleSchema = new mongoose.Schema({
  maxSentences: { type: Number },
  useEmojis: { type: Boolean },
  emojiFrequency: { type: String },
  usesFillerWords: { type: Boolean },
  exampleReplies: [{ type: String }]
}, { _id: false });

const personaSchema = new mongoose.Schema({
  botId: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  location: { type: String, required: true },
  age: { type: Number },
  language: { type: String, required: true },
  personality: { type: personalitySchema, required: true },
  interests: [{ type: String }],
  otherViewers: [{ type: String }],
  college: { type: String },
  politicalViews: { type: String },
  backstory: { type: String, required: true },
  occupationExample: { type: String },
  avoid: [{ type: String }],
  replyStyle: { type: replyStyleSchema, required: true },
  remarks: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

export const Persona = mongoose.model('Persona', personaSchema, 'personas');
