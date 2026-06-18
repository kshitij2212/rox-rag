import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';
import { sleep }       from '../utils/sleep.js';
import { getRejectQueueModel } from '../memory/models/ModerationQueue.js';
import { Blacklist }       from '../memory/models/Blacklist.js';
import appConfig       from '../../config/default.js';

const log = logger.child({ module: 'ReplyProcessor' });

export function createReplyProcessor(config) {
  const { context, moderation, botId, redis } = config;

  if (!context)    throw new Error('ReplyProcessor: context is required');
  if (!moderation) throw new Error('ReplyProcessor: moderation is required');
  if (!botId)      throw new Error('ReplyProcessor: botId is required');

  async function onReplyReady({ roomId, text, trigger, usage, contextPayload }) {
    if (!text?.trim()) return;

    try {
      let cleanText = text.trim();

      // Get room metadata to check broadcaster gender
      const roomMeta = await context.getMeta(roomId);
      const broadcasterGender = roomMeta?.broadcasterGender?.toLowerCase() || '';

      // If broadcaster is female, append "ma'am" if not already present
      // If broadcaster is female, append "ma'am" if not already present (only for first interaction/greeting)
      const greetingCount = contextPayload?.greetingCount || 0;
      if (greetingCount < 1 && broadcasterGender === 'female' && !cleanText.toLowerCase().includes('ma\'am')) {
        cleanText = cleanText + ', ma\'am';
      }

      // Check if auto-approve is enabled for this bot in Redis
      if (redis) {
        try {
          const autoApprove = await redis.get(`bot:${botId}:auto_approve`);
          if (autoApprove === '1') {
            log.info({ roomId, botId, text: cleanText }, 'Bypassing moderation: auto-approve is active');
            await publishApprovedReply({ text: cleanText, trigger, usage, roomId });
            return;
          }
        } catch (err) {
          log.warn({ err, botId }, 'Failed to check auto-approve status from Redis');
        }
      }

      // Check if bypass moderation flag is explicitly set
      if (trigger?.bypassModeration) {
        log.info({ roomId, botId, text: cleanText }, 'Bypassing moderation for bypass-flagged reply');
        await publishApprovedReply({ text: cleanText, trigger, usage, roomId });
        return;
      }

      const RejectQueue = getRejectQueueModel(botId);

      // Check if response text contains any blacklisted phrase/word (case-insensitive substring match)
      const blacklist = await Blacklist.find({}).lean();
      let matchedPhrase = blacklist.find(item => {
        const phrase = item.phrase?.trim()?.toLowerCase();
        if (!phrase) return false;
        return cleanText.toLowerCase().includes(phrase);
      })?.phrase;

      if (!matchedPhrase && appConfig.blacklistWords) {
        matchedPhrase = appConfig.blacklistWords.find(word => {
          const w = word.trim().toLowerCase();
          if (!w) return false;
          const re = new RegExp(`(?:\\b|\\s|^)${w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\b|\\s|$)`, 'i');
          return re.test(cleanText);
        });
      }

      if (matchedPhrase) {
        log.warn({ roomId, botId, text: cleanText, blockedBy: matchedPhrase }, 'Generated response contains blacklisted phrase — blocking automatically');
        await RejectQueue.create({
          botId,
          roomId,
          question: typeof trigger === 'string' ? trigger : (trigger?.text || trigger?.prompt || ''),
          answer: cleanText,
          status: 'blacklisted',
          trigger,
          usage,
          contextPayload,
        });
        return;
      }

      // Save to ModerationQueue as 'pending'
      const queueItem = await RejectQueue.create({
        botId,
        roomId,
        question: typeof trigger === 'string' ? trigger : (trigger?.text || trigger?.prompt || ''),
        answer: cleanText,
        status: 'pending',
        trigger,
        usage,
        contextPayload,
      });

      log.info({ roomId, botId, queueId: queueItem._id }, 'Saved response to RejectQueue (pending)');

      // Publish new item event to Redis pub/sub
      if (redis) {
        await redis.publish('moderation:channel', JSON.stringify({
          type: 'new_item',
          data: {
            _id: queueItem._id,
            botId,
            roomId,
            question: queueItem.question,
            answer: queueItem.answer,
            status: queueItem.status,
            timestamp: queueItem.timestamp,
          }
        }));
      }
    } catch (err) {
      log.error({ err, roomId }, 'Error in reply handler queueing');
    }
  }

  async function publishApprovedReply({ text, trigger, usage, roomId }) {
    const delayMs = trigger?.delayMs ?? 0;
    if (delayMs > 0) {
      log.debug({ roomId, delayMs }, 'Simulating typing delay');
      await sleep(delayMs);
    }

    try {
      await context.addBotReply(roomId, text, trigger);
      bus.emit(Events.REPLY_SEND, { roomId, trigger, text, usage });
    } catch (err) {
      log.error({ err, roomId }, 'Error sending approved reply');
    }
  }

  function init() {
    bus.on(Events.REPLY_READY, onReplyReady);
    log.info('ReplyProcessor initialised with moderation flow');
  }

  function destroy() {
    bus.off(Events.REPLY_READY, onReplyReady);
    log.debug('ReplyProcessor destroyed');
  }

  return { init, destroy, publishApprovedReply };
}

