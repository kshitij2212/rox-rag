import mongoose from 'mongoose';
import Redis from 'ioredis';
import 'dotenv/config';

import config from '../config/default.js';
import { ModerationQueue } from '../src/memory/models/ModerationQueue.js';

async function main() {
  console.log('Connecting to MongoDB:', config.mongo.url);
  await mongoose.connect(config.mongo.url);
  
  console.log('Connecting to Redis:', config.redis.url);
  const redis = new Redis(config.redis.url);

  console.log('Registering active bot room in Redis...');
  const botKey = 'bot:aman-bot:rooms';
  const roomData = {
    roomId: 'test-room-123',
    roomName: 'Test Livestream',
    broadcasterId: 999,
    owner: { username: 'Kshitij', gender: 'male' },
    joinedAt: new Date().toISOString(),
  };
  await redis.hset(botKey, 'test-room-123', JSON.stringify(roomData));
  
  // Set heartbeat key so it passes the live check
  await redis.set('bot:aman-bot:room:test-room-123:heartbeat', '1', 'EX', 15);

  const mockItem = {
    botId: 'aman-bot',
    roomId: 'test-room-123',
    question: 'Aman, what is your favorite color?',
    answer: 'I love blue because it feels like the sky and sea!',
    status: 'pending',
    trigger: { text: 'Aman, what is your favorite color?', userId: 'user-789', username: 'Kshitij' },
    usage: { prompt_tokens: 45, completion_tokens: 18 },
    timestamp: new Date()
  };

  console.log('Saving mock item to MongoDB...');
  const doc = await ModerationQueue.create(mockItem);
  console.log('Created Moderation Queue document with ID:', doc._id);

  console.log('Publishing new item event to Redis pub/sub...');
  await redis.publish('moderation:channel', JSON.stringify({
    type: 'new_item',
    data: {
      _id: doc._id,
      botId: doc.botId,
      roomId: doc.roomId,
      question: doc.question,
      answer: doc.answer,
      status: doc.status,
      timestamp: doc.timestamp
    }
  }));

  console.log('Verification event sent successfully!');
  
  // Clean up
  await mongoose.connection.close();
  await redis.quit();
  process.exit(0);
}

main().catch(err => {
  console.error('Error running test script:', err);
  process.exit(1);
});
