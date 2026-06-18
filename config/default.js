import dotenv from 'dotenv';
dotenv.config({ override: true });

function env(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val.trim() !== '') return val.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`config: required environment variable "${key}" is not set`);
}

function envInt(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val.trim() !== '') {
    const n = parseInt(val.trim(), 10);
    if (isNaN(n)) throw new Error(`config: "${key}" must be an integer, got "${val}"`);
    return n;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`config: required environment variable "${key}" is not set`);
}

function envFloat(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val.trim() !== '') {
    const n = parseFloat(val.trim());
    if (isNaN(n)) throw new Error(`config: "${key}" must be a number, got "${val}"`);
    return n;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`config: required environment variable "${key}" is not set`);
}

const config = {

  realtime: {
    provider:     env('REALTIME_PROVIDER',    'both'),
  },

  socket: {
    url:            env('SOCKET_URL',            'wss://api.roxstarstudioz.com'),
    path:           env('SOCKET_PATH',           '/v1/live/socket'),
    liveId:         envInt('SOCKET_LIVE_ID', 0),
    userId:         envInt('SOCKET_USER_ID', 0),
    broadcasterId:  envInt('SOCKET_BROADCASTER_ID', 0),
  },

  livekit: {
    url:          env('LIVEKIT_URL', 'wss://live.dev.roxstarstudioz.com'),
    apiKey:       env('LIVEKIT_API_KEY', 'default_key'),
    apiSecret:    env('LIVEKIT_API_SECRET', 'default_secret'),
    roomName:     env('LIVEKIT_ROOM', 'default_room'),
    botIdentity:  env('BOT_IDENTITY', 'aman-bot'),
    botDisplayName: env('BOT_DISPLAY_NAME', 'Aman'),

    botPersona:   env('BOT_PERSONA', 'aman-bot'),
    tokenApiUrl: env('LIVEKIT_TOKEN_API', null),

    bot: {
      userId: env('BOT_IDENTITY', 'aman-bot'),
      username: env('BOT_DISPLAY_NAME', 'Aman'),
    },
    reconnect: {
      attempts:   envInt('LIVEKIT_RECONNECT_ATTEMPTS', 2),
      baseMs:     envInt('LIVEKIT_RECONNECT_BASE_MS',  1500),
      maxMs:      envInt('LIVEKIT_RECONNECT_MAX_MS',   30000),
    },
    connectTimeoutMs:    envInt('LIVEKIT_CONNECT_TIMEOUT_MS', 10000),
    disconnectTimeoutMs: envInt('LIVEKIT_DISCONNECT_TIMEOUT_MS', 5000),
    sttMinRms:           envInt('STT_MIN_RMS', 362),
  },

  groq: {
    apiKey:      env('GROQ_API_KEY', 'default_groq_key'),
    model:       env('GROQ_MODEL',    'llama-3.3-70b-versatile'),
    maxTokens:   envInt('GROQ_MAX_TOKENS',   256),
    temperature: envFloat('GROQ_TEMPERATURE', 0.5),
    timeoutMs:   envInt('GROQ_TIMEOUT_MS',   10000),
    maxRetries:  envInt('GROQ_MAX_RETRIES',  3),
    retryBaseMs: envInt('GROQ_RETRY_BASE_MS', 500),
  },

  redis: {
    url:         env('REDIS_URL', 'redis://localhost:6379'),
    contextTtlSeconds: envInt('REDIS_CONTEXT_TTL_SECONDS', 7200),
  },

  mongo: {
    url:         env('MONGO_URI', 'mongodb://localhost:27017/ai_chatbot'),
  },

  context: {
    windowSize: envInt('CONTEXT_WINDOW_SIZE', 20),
  },

  prompt: {
    historyTokenBudget: envInt('PROMPT_HISTORY_TOKEN_BUDGET', 600),
  },

  behavior: {
    perUserCooldownMs:  envInt('REPLY_COOLDOWN_MS',        0),

    globalCooldownMs:   envInt('GLOBAL_RATE_LIMIT_MS',     6000),

    typingDelayMinMs:   envInt('TYPING_DELAY_MIN_MS',      500),
    typingDelayMaxMs:   envInt('TYPING_DELAY_MAX_MS',      1000),

    replyProbability:   envFloat('REPLY_PROBABILITY',      1.0),

    botNameAliases:     env('BOT_NAME_ALIASES', '').split(',').map(s => s.trim()).filter(Boolean),
  },

  commentFilter: {
    minLength:            envInt('FILTER_MIN_LENGTH',             3),
    maxLength:            envInt('FILTER_MAX_LENGTH',             500),
    rateLimitWindowMs:    envInt('FILTER_RATE_LIMIT_WINDOW_MS',   10000),
    rateLimitMaxMessages: envInt('FILTER_RATE_LIMIT_MAX_MESSAGES', 5),
  },

  blacklistWords: ['yaar', 'scene', 'bhai', 'bhaiya', 'didi', 'behen', 'bro', 'sister', 'brother'],

  logging: {
    level: env('LOG_LEVEL', 'info'),
  },

};

export default config;
