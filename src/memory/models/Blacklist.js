import mongoose from 'mongoose';

const blacklistSchema = new mongoose.Schema({
  phrase: { type: String, required: true, unique: true, index: true },
  addedAt: { type: Date, default: Date.now },
});

export const Blacklist = mongoose.model('Blacklist', blacklistSchema, 'blacklist');
