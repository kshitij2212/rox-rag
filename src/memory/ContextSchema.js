export const keys = {
  transcripts: (botId, roomId) => `bot:${botId}:context:${roomId}:transcripts`,
  comments:    (botId, roomId) => `bot:${botId}:context:${roomId}:comments`,
  botReplies:  (botId, roomId) => `bot:${botId}:context:${roomId}:bot_replies`,
  meta:        (botId, roomId) => `bot:${botId}:context:${roomId}:meta`,
  cooldown:    (botId, roomId) => `bot:${botId}:context:${roomId}:cooldown`,
  insights:    (botId, roomId) => `bot:${botId}:context:${roomId}:insights`,
  greetingCount: (botId, roomId) => `bot:${botId}:context:${roomId}:greeting_count`,
};

export const limits = {
  transcripts: 15,
  comments:    30,
  botReplies:  10,
};

export const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
export const INSIGHTS_TTL_SECONDS = 7 * 24 * 60 * 60; // Keep insights for 7 days

