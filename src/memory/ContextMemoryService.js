import { keys, limits, DEFAULT_TTL_SECONDS, INSIGHTS_TTL_SECONDS } from './ContextSchema.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'ContextMemoryService' });

export function createContextMemory(redis, config = {}) {
  const ttl = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const unifiedRoomId = config.unifiedRoomId;
  const botId = config.botId || 'default-bot';

  function getRoomKey(roomId) {
    return unifiedRoomId || roomId;
  }

  async function pushToList(key, entry, limit) {
    const serialized = JSON.stringify(entry);
    await redis
      .pipeline()
      .lpush(key, serialized)
      .ltrim(key, 0, limit - 1)
      .expire(key, ttl)
      .exec();
  }

  async function readList(key) {
    const raw = await redis.lrange(key, 0, -1);
    return raw.map((item) => {
      try {
        return JSON.parse(item);
      } catch {
        log.warn({ key, item }, 'Failed to parse Redis list entry — skipping');
        return null;
      }
    }).filter(Boolean);
  }

  async function addTranscript(roomId, text, speakerId) {
    await pushToList(
      keys.transcripts(botId, getRoomKey(roomId)),
      { text, speakerId, ts: Date.now() },
      limits.transcripts
    );
  }

  async function getTranscripts(roomId) {
    return readList(keys.transcripts(botId, getRoomKey(roomId)));
  }

  async function addComment(roomId, userId, username, text) {
    await pushToList(
      keys.comments(botId, getRoomKey(roomId)),
      { userId, username, text, ts: Date.now() },
      limits.comments
    );
  }

  async function getComments(roomId) {
    return readList(keys.comments(botId, getRoomKey(roomId)));
  }

  async function addBotReply(roomId, text, trigger = null) {
    const entry = { text, ts: Date.now() };
    if (trigger) {
      entry.promptText = typeof trigger === 'string' ? trigger : (trigger.text || trigger.prompt || '');
      entry.promptUser = trigger.username || trigger.userId || 'system';
    }

    const GREETING_QUESTION_REGEX = /(kaise\s+ho|kaise\s+hain|kya\s+haal|how\s+are\s+you|how\s+r\s+u)/i;
    if (GREETING_QUESTION_REGEX.test(text) || (entry.promptText && GREETING_QUESTION_REGEX.test(entry.promptText))) {
      try {
        await incrementGreetingCount(roomId);
      } catch (err) {
        log.warn({ err, roomId }, 'Failed to increment greeting count in Redis');
      }
    }

    await pushToList(
      keys.botReplies(botId, getRoomKey(roomId)),
      entry,
      limits.botReplies
    );
  }

  async function getBotReplies(roomId) {
    return readList(keys.botReplies(botId, getRoomKey(roomId)));
  }

  async function setMeta(roomId, meta) {
    const key = keys.meta(botId, getRoomKey(roomId));

    const pairs = Object.entries(meta).flat();
    await redis
      .pipeline()
      .hset(key, ...pairs)
      .expire(key, ttl)
      .exec();
  }

  async function getMeta(roomId) {
    const data = await redis.hgetall(keys.meta(botId, getRoomKey(roomId)));

    return Object.keys(data).length ? data : null;
  }

  async function setCooldown(roomId, durationMs) {
    await redis.set(keys.cooldown(botId, getRoomKey(roomId)), '1', 'PX', durationMs);
  }

  async function isOnCooldown(roomId) {
    const result = await redis.exists(keys.cooldown(botId, getRoomKey(roomId)));
    return result === 1;
  }

  async function getGreetingCount(roomId) {
    try {
      const val = await redis.get(keys.greetingCount(botId, getRoomKey(roomId)));
      return val ? parseInt(val, 10) : 0;
    } catch (err) {
      log.warn({ err, roomId }, 'Failed to get greeting count from Redis');
      return 0;
    }
  }

  async function incrementGreetingCount(roomId) {
    const key = keys.greetingCount(botId, getRoomKey(roomId));
    await redis
      .pipeline()
      .incr(key)
      .expire(key, ttl)
      .exec();
  }

  async function getAll(roomId) {
    const [transcripts, comments, botReplies, meta, greetingCountVal] = await Promise.all([
      getTranscripts(roomId),
      getComments(roomId),
      getBotReplies(roomId),
      getMeta(roomId),
      getGreetingCount(roomId),
    ]);
    return { transcripts, comments, botReplies, meta, greetingCount: greetingCountVal };
  }

  async function setInsights(roomId, insights) {
    const key = keys.insights(botId, getRoomKey(roomId));
    const pairs = Object.entries(insights).map(([k, v]) => [
      k, 
      typeof v === 'object' ? JSON.stringify(v) : String(v)
    ]).flat();
    if (pairs.length === 0) return;
    await redis
      .pipeline()
      .hset(key, ...pairs)
      .expire(key, INSIGHTS_TTL_SECONDS)
      .exec();
    log.debug({ roomId: getRoomKey(roomId) }, 'Room insights updated');
  }

  async function getInsights(roomId) {
    const data = await redis.hgetall(keys.insights(botId, getRoomKey(roomId)));
    const parsed = {};
    for (const [k, v] of Object.entries(data)) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    }
    return Object.keys(parsed).length ? parsed : null;
  }

  async function clearRoom(roomId) {
    await redis.del(
      keys.transcripts(botId, getRoomKey(roomId)),
      keys.comments(botId, getRoomKey(roomId)),
      keys.botReplies(botId, getRoomKey(roomId)),
      keys.meta(botId, getRoomKey(roomId)),
      keys.cooldown(botId, getRoomKey(roomId)),
      keys.greetingCount(botId, getRoomKey(roomId))
    );
    log.debug({ roomId: getRoomKey(roomId) }, 'Room context cleared (insights and greeting count reset)');
  }

  async function setBroadcasterFacts(broadcasterId, facts) {
    const key = `bot:${botId}:broadcaster:${broadcasterId}:facts`;
    await redis.set(key, JSON.stringify(facts));
  }

  async function getBroadcasterFacts(broadcasterId) {
    const key = `bot:${botId}:broadcaster:${broadcasterId}:facts`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  return {
    addTranscript,
    getTranscripts,
    addComment,
    getComments,
    addBotReply,
    getBotReplies,
    setMeta,
    getMeta,
    setCooldown,
    isOnCooldown,
    getAll,
    clearRoom,
    setInsights,
    getInsights,
    setBroadcasterFacts,
    getBroadcasterFacts,
    getGreetingCount,
    incrementGreetingCount,
  };
}
