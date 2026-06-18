import { createContextMemory } from '../../src/memory/ContextMemoryService.js';

class MockPipeline {
  constructor(client) {
    this.client = client;
    this.operations = [];
  }
  lpush(key, val) {
    this.operations.push(() => this.client.lpush(key, val));
    return this;
  }
  ltrim(key, start, stop) {
    this.operations.push(() => this.client.ltrim(key, start, stop));
    return this;
  }
  expire(key, ttl) {
    this.operations.push(() => this.client.expire(key, ttl));
    return this;
  }
  hset(key, ...pairs) {
    this.operations.push(() => this.client.hset(key, ...pairs));
    return this;
  }
  async exec() {
    for (const op of this.operations) {
      await op();
    }
  }
}

class MockRedis {
  constructor() {
    this.db = new Map();
  }

  pipeline() {
    return new MockPipeline(this);
  }

  async lpush(key, val) {
    if (!this.db.has(key)) this.db.set(key, []);
    this.db.get(key).unshift(val);
  }

  async ltrim(key, start, stop) {
    const list = this.db.get(key) || [];
    this.db.set(key, list.slice(start, stop + 1));
  }

  async lrange(key, start, stop) {
    const list = this.db.get(key) || [];
    return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
  }

  async expire(key, ttl) {
    // mock no-op
  }

  async hset(key, ...pairs) {
    if (!this.db.has(key)) this.db.set(key, new Map());
    const map = this.db.get(key);
    for (let i = 0; i < pairs.length; i += 2) {
      map.set(pairs[i], pairs[i + 1]);
    }
  }

  async hgetall(key) {
    const map = this.db.get(key);
    if (!map) return {};
    const obj = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  async del(...keys) {
    for (const key of keys) {
      this.db.delete(key);
    }
  }
}

describe('ContextMemoryService', () => {
  let redis;
  let service;

  beforeEach(() => {
    redis = new MockRedis();
    service = createContextMemory(redis, { unifiedRoomId: 'room123' });
  });

  test('addTranscript and getTranscripts store correctly', async () => {
    await service.addTranscript('room123', 'hello world', 'user1');
    const list = await service.getTranscripts('room123');
    expect(list.length).toBe(1);
    expect(list[0].text).toBe('hello world');
    expect(list[0].speakerId).toBe('user1');
  });

  test('clearRoom deletes chat logs but setInsights/getInsights are preserved', async () => {
    // 1. Add transcripts, comments, and replies
    await service.addTranscript('room123', 'trans1', 'user1');
    await service.addComment('room123', 'user1', 'User', 'comm1');
    
    // 2. Set insights
    const insightsData = {
      totalTranscripts: 1,
      totalComments: 1,
      uniqueUsers: ['user1'],
      endedAt: '2026-06-11'
    };
    await service.setInsights('room123', insightsData);

    // 3. Clear room
    await service.clearRoom('room123');

    // 4. Verify transcripts/comments are deleted
    const transcripts = await service.getTranscripts('room123');
    const comments = await service.getComments('room123');
    expect(transcripts.length).toBe(0);
    expect(comments.length).toBe(0);

    // 5. Verify insights are PRESERVED
    const insights = await service.getInsights('room123');
    expect(insights).toBeDefined();
    expect(insights.totalTranscripts).toBe(1);
    expect(insights.uniqueUsers).toEqual(['user1']);
    expect(insights.endedAt).toBe('2026-06-11');
  });
});
