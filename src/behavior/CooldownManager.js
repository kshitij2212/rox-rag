import logger from '../utils/logger.js';

const log = logger.child({ module: 'CooldownManager' });

const KEY_PREFIX = 'bot:cooldown:';

export class CooldownManager {

  constructor(redis, { cooldownSeconds = 10, botId = 'default-bot' } = {}) {
    if (!redis) throw new Error('CooldownManager: redis client is required');
    this.redis = redis;
    this.ttl   = cooldownSeconds;
    this.botId = botId;
  }

  async isOnCooldown(roomId, type) {
    if (type === 'transcript') {
      return false; // Audio is never on cooldown
    }
    const key    = `bot:${this.botId}:cooldown:${roomId}:chat`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async setCooldown(roomId, type) {
    if (this.ttl <= 0) return;
    const key = `bot:${this.botId}:cooldown:${roomId}:chat`;
    await this.redis.set(key, '1', 'EX', this.ttl);
    log.debug({ roomId, type, ttlSeconds: this.ttl }, 'Chat cooldown armed');
  }

  async clearCooldown(roomId) {
    await this.redis.del(`bot:${this.botId}:cooldown:${roomId}:chat`);
    log.debug({ roomId }, 'Cooldown cleared');
  }
}
