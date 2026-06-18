import { CooldownManager }        from './CooldownManager.js';
import { computeReplyProbability } from './ReplyProbability.js';
import { computeTypingDelay }      from './TypingSimulator.js';
import logger                      from '../utils/logger.js';

const log = logger.child({ module: 'BehaviorEngine' });

export class BehaviorEngine {

  constructor(redis, {
    cooldownSeconds      = 10,
    baseReplyProbability = 0.4,
    maxRepliesPerMinute  = 6,
    botId                = 'default-bot',
    botNames             = [],
  } = {}) {
    this.cooldown            = new CooldownManager(redis, { cooldownSeconds, botId });
    this.baseProb            = baseReplyProbability;
    this.maxRepliesPerMinute = maxRepliesPerMinute;
    this.botNames            = botNames;
  }

  async evaluate({ roomId, type, text }) {
    // Check if the bot name is explicitly mentioned in the text
    let isNameMentioned = false;
    if (text && this.botNames && this.botNames.length > 0) {
      const lowerText = text.toLowerCase();
      isNameMentioned = this.botNames.some(name => {
        const lowerName = name.toLowerCase().trim();
        if (!lowerName) return false;
        return lowerText.includes(lowerName);
      });
    }

    if (isNameMentioned) {
      log.info({ roomId, type, text }, 'Bot name mentioned in text — forcing reply (bypassing cooldown and probability)');
      await this.cooldown.setCooldown(roomId, type).catch(() => {});
      const delayMs = computeTypingDelay(text);
      return { shouldReply: true, delayMs };
    }

    const onCooldown = await this.cooldown.isOnCooldown(roomId, type);
    if (onCooldown) {
      log.debug({ roomId, type }, 'On cooldown — skipping');
      return { shouldReply: false, delayMs: 0 };
    }

    const prob = computeReplyProbability(this.baseProb, { type, text });
    if (Math.random() > prob) {
      log.debug({ roomId, type, prob: prob.toFixed(2) }, 'Probability roll failed — skipping');
      return { shouldReply: false, delayMs: 0 };
    }

    await this.cooldown.setCooldown(roomId, type);

    const delayMs = computeTypingDelay(text);

    log.debug({ roomId, type, prob: prob.toFixed(2), delayMs }, 'Reply approved');
    return { shouldReply: true, delayMs };
  }
}

export function createBehaviorEngine(redis, config) {
  return new BehaviorEngine(redis, config);
}
