import { jest } from '@jest/globals';
import { BehaviorEngine } from '../../src/behavior/BehaviorEngine.js';

describe('BehaviorEngine', () => {
  let mockRedis;

  beforeEach(() => {
    // Mock Redis for cooldown checks
    const store = {};
    mockRedis = {
      get: jest.fn(async (key) => store[key] || null),
      set: jest.fn(async (key, val) => { store[key] = val; }),
      exists: jest.fn(async (key) => store[key] ? 1 : 0),
    };
  });

  test('forces reply when bot name is mentioned, bypassing cooldown', async () => {
    const engine = new BehaviorEngine(mockRedis, {
      cooldownSeconds: 60,
      baseReplyProbability: 0, // 0% probability under normal conditions
      botId: 'test-bot',
      botNames: ['Aman', 'Aman Gupta'],
    });

    // Mentions "Aman"
    const result1 = await engine.evaluate({ roomId: 'room1', type: 'comment', text: 'hello Aman, kaise ho' });
    expect(result1.shouldReply).toBe(true);

    // Cooldown is set now, but mentioning again should STILL bypass cooldown
    const result2 = await engine.evaluate({ roomId: 'room1', type: 'comment', text: 'Aman Gupta listen to me' });
    expect(result2.shouldReply).toBe(true);
  });

  test('respects cooldown and probability when name is not mentioned', async () => {
    const engine = new BehaviorEngine(mockRedis, {
      cooldownSeconds: 60,
      baseReplyProbability: 1.0, // 100% probability
      botId: 'test-bot',
      botNames: ['Aman'],
    });

    // First message gets approved
    const result1 = await engine.evaluate({ roomId: 'room1', type: 'comment', text: 'hello' });
    expect(result1.shouldReply).toBe(true);

    // Second message (on cooldown) is rejected
    const result2 = await engine.evaluate({ roomId: 'room1', type: 'comment', text: 'how are you' });
    expect(result2.shouldReply).toBe(false);
  });
});
