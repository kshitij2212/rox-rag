import '../utils/patchLiveKit.js';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import mongoose from 'mongoose';

import bus, { Events }                           from './EventBus.js';
import logger                                    from '../utils/logger.js';
import config                                    from '../../config/default.js';
import { resolveUser, resolveActiveLiveSession, resolveLiveIdFromRoomName } from '../utils/database.js';

import { createLiveKitConnector }    from '../realtime/LiveKitConnector.js';
import { createSocketIOConnector }   from '../realtime/SocketIOConnector.js';
import { createReplyPublisher }      from '../realtime/ReplyPublisher.js';
import { createRedisClient }         from '../memory/RedisClient.js';
import { createMongoClient }         from '../memory/MongoClient.js';
import { createMongoConversationService } from '../memory/MongoConversationService.js';
import { createMongoPersonaService }      from '../memory/MongoPersonaService.js';
import { createContextMemory }       from '../memory/ContextMemoryService.js';
import { createPersonaMemory }       from '../memory/PersonaMemoryService.js';
import { createBehaviorEngine }      from '../behavior/BehaviorEngine.js';
import { createContextBuilder }      from '../ai/ContextBuilder.js';
import { createPromptBuilder }       from '../ai/PromptBuilder.js';
import { createGroqAdapter }         from '../ai/GroqAdapter.js';
import { createOpenAIAdapter }       from '../ai/OpenAIAdapter.js';
import { createLLMService }          from '../ai/LLMService.js';
import { createResponseParser }      from '../ai/ResponseParser.js';
import { createModerationService }   from '../moderation/ModerationService.js';
import { createCommentFilter }       from '../comments/CommentFilter.js';
import { createCommentListener }     from '../comments/CommentListener.js';
import { createGroqGateCheck }       from '../ai/GroqGateCheck.js';
import { createJoinGreetingService } from '../ai/JoinGreetingService.js';
import { createTranscriptProcessor } from '../comments/TranscriptProcessor.js';
import { createCommentProcessor }    from '../comments/CommentProcessor.js';
import { createReplyProcessor }      from '../realtime/ReplyProcessor.js';
import { createAudioPipeline }       from '../audio/AudioPipeline.js';
import '../comments/CommentParser.js';

const log = logger.child({ module: 'BotRunner' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BOT_DEFS = [
  {
    key: 'aman',
    envId: 'SOCKET_USER_ID_AMAN',       defaultId: '4638',
    envIdentity: 'BOT_IDENTITY_AMAN',   defaultIdentity: 'aman-bot',
    envName: 'BOT_DISPLAY_NAME_AMAN',   defaultName: 'Aman',
    displayNameVariations: ['Aman', 'Aman Gupta', 'gupta', 'aman', 'अमन', 'आमन', 'अमं', 'अमान', 'हमन'],
  },
  {
    key: 'shivam',
    envId: 'SOCKET_USER_ID_SHIVAM',     defaultId: '4639',
    envIdentity: 'BOT_IDENTITY_SHIVAM', defaultIdentity: 'shivam-bot',
    envName: 'BOT_DISPLAY_NAME_SHIVAM', defaultName: 'Shivam',
    displayNameVariations: ['Shivam', 'Shivam Soni', 'soni', 'shivam', 'शिवम', 'शिवं', 'शिवाम', 'शीवम', 'शिवम्', 'शिवन', 'शिवा', 'शवाम', 'शवंम', 'शिबम', 'शेबम', 'सेवम', 'शेबं', 'शेबाम', 'शे बाम', 'शेबंबाई', 'शिवम जी', 'शिवमजी', 'शिवम सर', 'शिवम भाई', 'Shivam ji', 'shivam ji', 'शिवम सोनी', 'शीवम सोनी', 'शिवाम सोनी', 'शिवं सोनी', 'शिबम सोनी', 'सोनी', 'सोनी जी', 'सोनीजी', 'सोनी साहब', 'सोनी सर', 'शोनी', 'सोनि', 'सोनीय', 'सोनीया'],
  },
  {
    key: 'abhishek',
    envId: 'SOCKET_USER_ID_ABHISHEK',     defaultId: '4640',
    envIdentity: 'BOT_IDENTITY_ABHISHEK', defaultIdentity: 'abhishek-bot',
    envName: 'BOT_DISPLAY_NAME_ABHISHEK', defaultName: 'Abhishek',
    displayNameVariations: ['Abhishek', 'Abhishek Saxena', 'saxena', 'abhishek', 'अभिषेक', 'अभिशेक', 'अभि', 'अभिशेख', 'अब्बी', 'अबे शेख', 'अबे सेख', 'अब्बी शेख', 'Abhishek ji', 'abhishek ji', 'अभिषेक जी', 'अभिशेक जी', 'अभिषेक जी', 'अभिशेख जी', 'अभिषेक सर', 'अभिशेक सर', 'अभिषेक भाई', 'अभिशेक भाई', 'अभिषेक सक्सेना', 'अभिशेक सक्सेना', 'अभिषेख सक्सेना', 'अबिषेक', 'अबिशेक', 'अबीशेक', 'अबिषेख', 'अबीशेख', 'अभी', 'अभी', 'अभीषेक', 'अभीशेक', 'सक्सेना', 'सक्सेना', 'सक्सेना जी', 'सक्सेनाजी'],
  },
  {
    key: 'rahul',
    envId: 'SOCKET_USER_ID_RAHUL',     defaultId: '4641',
    envIdentity: 'BOT_IDENTITY_RAHUL', defaultIdentity: 'rahul-bot',
    envName: 'BOT_DISPLAY_NAME_RAHUL', defaultName: 'Rahul',
    displayNameVariations: ['Rahul', 'rahul', 'Raahul', 'Rahool', 'राहुल', 'राहूल', 'राहू', 'राहु', 'राउल', 'राऊल', 'राहल', 'रहुल', 'राहुला', 'राहुल जी', 'राहुलजी', 'राहुल सर', 'राहुल भैया', 'Rahul Sharma', 'rahul sharma', 'राहुल शर्मा', 'राहूल शर्मा', 'राहुल शरमा', 'राहुल सरमा', 'राउल शर्मा', 'राऊल शर्मा', 'शर्मा', 'शरमा', 'सरमा', 'सर्मा', 'शर्मा जी', 'शर्माजी'],
  },
  {
    key: 'priya',
    envId: 'SOCKET_USER_ID_PRIYA',     defaultId: '4664',
    envIdentity: 'BOT_IDENTITY_PRIYA', defaultIdentity: 'priya-bot',
    envName: 'BOT_DISPLAY_NAME_PRIYA', defaultName: 'Priya Sharma',
    displayNameVariations: ['Priya', 'Priya Sharma', 'priya', 'pria', 'priyaa', 'priyaa', 'preeya', 'priyah', 'priy', 'priya ji', 'priyasharma', 'प्रिया', 'प्रिय', 'प्रीया', 'प्रीया', 'प्रिया शर्मा', 'प्रियाशर्मा', 'प्रियाजी', 'प्रिया जी', 'पिरिया', 'प्रीय', 'प्रीया', 'परिया', 'परीया', 'पिरीया', 'प्रीयाह', 'प्रियाा', 'प्रिय्या', 'प्रियाह', 'प्रिआ', 'प्रिया शरमा', 'प्रिया सरमा', 'शर्मा', 'सरमा', 'शरमा'],
  },
  {
    key: 'simran',
    envId: 'SOCKET_USER_ID_SIMRAN',     defaultId: '4655',
    envIdentity: 'BOT_IDENTITY_SIMRAN', defaultIdentity: 'simran-bot',
    envName: 'BOT_DISPLAY_NAME_SIMRAN', defaultName: 'Simran Kaur',
    displayNameVariations: ['Simran', 'Simran Kaur', 'simran', 'simra', 'simar', 'samran', 'samaran', 'simrin', 'simreen', 'simron', 'simeran', 'simern', 'simraan', 'simranjeet', 'simarpreet', 'सिमरन', 'सिमरण', 'सिमरन कौर', 'सिमरण कौर', 'सिमरा', 'सिमर', 'समरन', 'समरण', 'सिम्रन', 'सिमरीन', 'सिमरीन कौर', 'सिमरोन', 'सिमन', 'सिमराण', 'सिमरां', 'सिमरांन', 'सीमरन', 'सीमरण', 'शिमरन', 'शीमरन', 'सुमिरन', 'सुमिरण', 'स्मरण', 'समिरन', 'समीरन', 'सिमरना', 'सिमरानी', 'सिमरांजीत', 'सिमरप्रीत', 'कौर', 'कोर', 'कउर', 'कौर जी'],
  },
  {
    key: 'neha',
    envId: 'SOCKET_USER_ID_NEHA',       defaultId: '4678',
    envIdentity: 'BOT_IDENTITY_NEHA',   defaultIdentity: 'neha-bot',
    envName: 'BOT_DISPLAY_NAME_NEHA',   defaultName: 'Neha Kapoor',
    displayNameVariations: ['Neha', 'Neha Kapoor', 'neha', 'नेहा', 'नेहा कपूर', 'नेहा जी', 'नेहाजी', 'नेहा मैम', 'नेहा मैडम', 'नेहा दी', 'नेहा बहन', 'नेहा कपूर जी', 'नेहा कपुर', 'नेहा कपूर', 'नेहा कापूर', 'नेहा कपूर', 'नेहा कपुर', 'नेहा कापुर', 'नेहा', 'नेहाा', 'नेह', 'निहा', 'नीहा', 'नैया', 'नेया', 'नेहा जी', 'नीहा जी', 'कपूर', 'कपुर', 'कपूर', 'कापूर', 'कापुर', 'कपूर जी', 'कपूरजी'],
  },
  {
    key: 'ananya',
    envId: 'SOCKET_USER_ID_ANANYA',     defaultId: '4679',
    envIdentity: 'BOT_IDENTITY_ANANYA', defaultIdentity: 'ananya-bot',
    envName: 'BOT_DISPLAY_NAME_ANANYA', defaultName: 'Ananya Reddy',
    displayNameVariations: ['Ananya', 'Ananya Reddy', 'ananya', 'अनन्या', 'अननिया', 'अनन्या रेड्डी', 'अननिया रेड्डी', 'अनन्या जी', 'अनन्याजी', 'अनन्या मैम', 'अनन्या मैडम', 'अनन्या दी', 'अनन्या बहन', 'अनन्या रेड्डी जी', 'अनन्या रेडी', 'अननिया', 'अननिया जी', 'अनन्याा', 'अनन्य', 'अनया', 'अन्या', 'अननिया', 'अनन्या', 'अनन्या जी', 'अननिया जी', 'रेड्डी', 'रेडी', 'रेड्डी जी', 'रेड्डीजी', 'रेडी', 'रेड्डी मैम'],
  },
  {
    key: 'divya',
    envId: 'SOCKET_USER_ID_DIVYA',       defaultId: '4680',
    envIdentity: 'BOT_IDENTITY_DIVYA',   defaultIdentity: 'divya-bot',
    envName: 'BOT_DISPLAY_NAME_DIVYA',   defaultName: 'Divya Joshi',
    displayNameVariations: ['Divya', 'Divya Joshi', 'divya', 'दिव्या', 'दिविया', 'दिव्या जोशी', 'दिविया जोशी', 'दिव्या जी', 'दिव्याजी', 'दिव्या मैम', 'दिव्या मैडम', 'दिव्या दी', 'दिव्या बहन', 'दिव्या जोशी जी', 'दिव्या जोशी', 'दिव्या जोसी', 'दिविया', 'दिविया जी', 'दिव्याा', 'दिव्य', 'दिब्या', 'दिबिया', 'देव्या', 'दिवा', 'दिवीया', 'दिव्या जी', 'दिविया जी', 'जोशी', 'जोसी', 'जोषी', 'जोशी जी', 'जोशीजी', 'जोशी मैम'],
  },
];

function resolveActiveDef(persona, botDefs) {
  return botDefs.find((def) => persona.includes(def.key)) ?? null;
}

function buildBlockedLists(activeDef, botDefs) {
  const blockedUserIds = [];
  const otherBotDisplayNames = [];

  for (const def of botDefs) {
    if (def.key === activeDef?.key) continue;
    blockedUserIds.push(
      String(process.env[def.envId] ?? def.defaultId),
      process.env[def.envIdentity] ?? def.defaultIdentity,
    );
    const names = new Set([
      process.env[def.envName] ?? def.defaultName,
      ...def.displayNameVariations,
      process.env[def.envIdentity] ?? def.defaultIdentity,
    ].filter(Boolean));
    otherBotDisplayNames.push(...names);
  }

  return { blockedUserIds, otherBotDisplayNames };
}

async function applyActiveLiveSession(broadcasterId, upperKey = '') {
  try {
    const session = await resolveActiveLiveSession(broadcasterId);
    if (session) {
      log.info({ session }, 'Active live session found — overriding config');
      config.socket.liveId = session.liveId;
      if (session.roomName) config.livekit.roomName = session.roomName;

      if (upperKey) {
        try {
          const { updateEnvValue } = await import('../utils/envHelper.js');
          updateEnvValue(`LIVEKIT_ROOM_${upperKey}`, session.roomName);
          updateEnvValue(`SOCKET_LIVE_ID_${upperKey}`, String(session.liveId));
        } catch (envErr) {
          log.warn({ envErr }, 'Failed to update .env with resolved session values');
        }
      }
      return true;
    } else {
      log.warn({ broadcasterId }, 'No active live session found — using env config');
    }
  } catch (err) {
    log.error({ err }, 'Failed to query active live session — falling back to env config');
  }
  return false;
}

// ─── BotRunner ────────────────────────────────────────────────────────────────

export function createBotRunner() {
  // Service instances
  let livekitConnector    = null;
  let socketIOConnector   = null;
  let replyPublisher      = null;
  let redis               = null;
  let redisSub            = null;
  let mongoClient         = null;
  let mongoConversationService = null;
  let mongoPersonaService = null;
  let context             = null;
  let persona             = null;
  let behavior            = null;
  let contextBuilder      = null;
  let promptBuilder       = null;
  let llm                 = null;
  let responseParser      = null;
  let moderation          = null;
  let audioPipeline       = null;
  let commentFilter       = null;
  let commentListener     = null;
  let gateCheck           = null;
  let groqAdapter         = null;
  let joinGreeting        = null;
  let transcriptProcessor = null;
  let commentProcessor    = null;
  let replyProcessor      = null;
  let isShuttingDown      = false;
  let heartbeatInterval   = null;

  const roomRef      = { room: null };
  const connectorRef = { connector: null };
  const listeners    = [];

  // ─── EventBus helpers ───────────────────────────────────────────────────────

  function on(event, fn)   { bus.on(event, fn);   listeners.push([event, fn]); }
  function once(event, fn) { bus.once(event, fn); listeners.push([event, fn]); }

  function unwireEvents() {
    for (const [event, fn] of listeners) bus.off(event, fn);
    listeners.length = 0;
  }

  function startHeartbeat(roomId) {
    stopHeartbeat();
    heartbeatInterval = setInterval(async () => {
      try {
        if (redis) {
          const heartbeatKey = `bot:${config.livekit.botPersona}:room:${roomId}:heartbeat`;
          await redis.set(heartbeatKey, '1', 'EX', 15);
        }
      } catch (err) {
        log.warn({ err }, 'Failed to send heartbeat to Redis');
      }
    }, 10000);
    if (redis) {
      redis.set(`bot:${config.livekit.botPersona}:room:${roomId}:heartbeat`, '1', 'EX', 15).catch(() => {});
    }
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // ─── Event wiring ───────────────────────────────────────────────────────────

  function wireEvents() {
    on(Events.ROOM_CONNECTED, ({ roomId, roomName, room }) => {
      if (room) roomRef.room = room;
      log.info({ roomId, roomName }, '🎙  Joined room');
      startHeartbeat(roomId);

      const broadcasterId = config.socket.broadcasterId;

      resolveUser(broadcasterId, 'host')
        .then(async (broadcasterDetails) => {
          await cacheBroadcasterAndRoomData(roomId, roomName, broadcasterId, broadcasterDetails);
          await initRoomContext(roomId, roomName, broadcasterId, broadcasterDetails);
        })
        .catch(async (err) => {
          log.warn({ err }, 'Failed to resolve broadcaster details — using defaults');
          const fallbackDetails = { username: 'host', gender: '' };

          await cacheBroadcasterAndRoomData(roomId, roomName, broadcasterId, fallbackDetails);
          await initRoomContext(roomId, roomName, broadcasterId, fallbackDetails);
        });
    });

    on(Events.ROOM_DISCONNECTED, async ({ roomId, reason }) => {
      log.warn({ roomId, reason }, 'Left room');
      stopHeartbeat();
      await removeBotRoomData(roomId);
      await compileAndSaveInsights(roomId).catch((err) =>
        log.warn({ err, roomId }, 'Failed to compile session insights'),
      );
    });

    on(Events.PARTICIPANT_JOINED, ({ roomId, identity }) => {
      log.info({ roomId, identity }, '👤 Participant joined');
    });

    on(Events.PARTICIPANT_LEFT, ({ roomId, identity }) => {
      log.info({ roomId, identity }, '👤 Participant left');
    });

    on(Events.REPLY_SENT, ({ roomId, trigger, text }) => {
      log.info({ roomId, text }, '✅ Reply sent');
      if (mongoConversationService) {
        const question = typeof trigger === 'string' ? trigger : (trigger?.text || trigger?.prompt || (trigger ? String(trigger) : ''));
        const questionUser = trigger?.username || trigger?.userId || 'system';
        const botId = config.livekit.botPersona;
        mongoConversationService.saveQA({
          botId,
          roomId,
          question,
          questionUser,
          answer: text,
        }).catch((err) => log.error({ err }, 'Failed to save QA to MongoDB'));
      }
    });

    on(Events.REPLY_FAILED, ({ roomId, trigger, errName, errMessage }) => {
      log.warn({ roomId, userId: trigger?.userId, errName, errMessage }, '⚠️  Reply failed');
    });

    on(Events.CONNECTOR_RECONNECTING, ({ roomId, attempt, maxAttempts, delayMs }) => {
      log.warn({ roomId, attempt, maxAttempts, delayMs }, '🔄 Reconnecting...');
    });

    on(Events.CONNECTOR_RECONNECTED, ({ roomId, attempt }) => {
      if (connectorRef.connector?.getRoom) roomRef.room = connectorRef.connector.getRoom();
      log.info({ roomId, attempt }, '✓ Reconnected');
    });

    on(Events.CONNECTOR_FAILED, ({ roomId, attempts }) => {
      log.error({ roomId, attempts }, '✗ All reconnect attempts failed — shutting down');
      stop('connector_failed').catch((err) => log.error({ err }, 'Shutdown error'));
    });

    once(Events.BOT_SHUTDOWN, () => {
      stop('BOT_SHUTDOWN event').catch((err) => log.error({ err }, 'Shutdown error'));
    });
  }

  // ─── Room helpers ────────────────────────────────────────────────────────────

  async function cacheBroadcasterAndRoomData(roomId, roomName, broadcasterId, broadcasterDetails) {
    if (!redis) return;
    const botKey = `bot:${config.livekit.botPersona}:rooms`;
    const roomData = {
      roomId,
      roomName,
      broadcasterId,
      ...(broadcasterDetails && { owner: broadcasterDetails }),
      joinedAt: new Date().toISOString(),
    };

    await Promise.all([
      broadcasterDetails
        ? redis.set(`user:${broadcasterId}`, JSON.stringify(broadcasterDetails), 'EX', 3600)
            .catch((err) => log.warn({ err }, 'Failed to cache broadcaster in Redis'))
        : Promise.resolve(),
      redis.hset(botKey, roomId, JSON.stringify(roomData))
        .catch((err) => log.warn({ err, botKey }, 'Failed to save room data to Redis')),
    ]);
  }

  async function removeBotRoomData(roomId) {
    if (!redis) return;
    const botKey = `bot:${config.livekit.botPersona}:rooms`;
    await redis.hdel(botKey, roomId)
      .catch((err) => log.warn({ err, botKey }, 'Failed to remove room data from Redis'));
  }

  async function initRoomContext(roomId, roomName, broadcasterId, broadcasterDetails) {
    await context.clearRoom(roomId);
    await context.setMeta(roomId, {
      roomName,
      botUserId:           config.livekit.botIdentity,
      startedAt:           new Date().toISOString(),
      broadcasterId:       String(broadcasterId),
      broadcasterGender:   broadcasterDetails?.gender || '',
      broadcasterName:     broadcasterDetails?.username || 'host',
    });
  }

  // ─── Start ───────────────────────────────────────────────────────────────────

  async function start() {
    log.info('Connecting to MongoDB...');
    try {
      mongoClient = await createMongoClient(config.mongo.url);
      mongoConversationService = createMongoConversationService(mongoClient);
      
      await mongoose.connect(config.mongo.url);
      mongoPersonaService = createMongoPersonaService();
      
      log.info('✓ MongoDB connected');
    } catch (err) {
      log.error({ err }, 'Failed to connect to MongoDB, proceeding without it');
    }

    log.info('Connecting to Redis...');
    redis = await createRedisClient(config.redis.url);
    log.info({ url: config.redis.url }, '✓ Redis connected');

    log.info('Connecting Redis Sub client...');
    redisSub = await createRedisClient(config.redis.url);
    log.info('✓ Redis Sub connected');

    // Load dynamic bot definitions from MongoDB, merge with static fallback BOT_DEFS
    let dbDefs = [];
    if (mongoPersonaService) {
      dbDefs = await mongoPersonaService.getBotDefinitions();
    }
    const botDefs = [...BOT_DEFS];
    for (const dbDef of dbDefs) {
      if (!botDefs.some(def => def.key === dbDef.key)) {
        botDefs.push(dbDef);
      }
    }

    // Resolve active persona from CLI arg
    const arg = process.argv[2];
    if (arg && !arg.startsWith('-')) {
      config.livekit.botPersona = arg.endsWith('-bot') ? arg : `${arg}-bot`;
    }

    const activePersona = config.livekit.botPersona;
    const activeDef     = resolveActiveDef(activePersona, botDefs);
    const { blockedUserIds, otherBotDisplayNames } = buildBlockedLists(activeDef, botDefs);

    let botKeyUpper = '';

    // Apply per-bot overrides from env
    if (activeDef) {
      const { key, envId, defaultId, envIdentity, defaultIdentity, envName, defaultName } = activeDef;
      const upperKey = key.toUpperCase();
      botKeyUpper = upperKey;

      const specificBroadcasterEnv = `SOCKET_BROADCASTER_ID_${upperKey}`;
      if (process.env[specificBroadcasterEnv]) {
        config.socket.broadcasterId = Number(process.env[specificBroadcasterEnv].trim());
      }

      const specificRoomEnv = `LIVEKIT_ROOM_${upperKey}`;
      if (process.env[specificRoomEnv]) {
        config.livekit.roomName = process.env[specificRoomEnv].trim();
      }

      const specificLiveIdEnv = `SOCKET_LIVE_ID_${upperKey}`;
      if (process.env[specificLiveIdEnv]) {
        config.socket.liveId = Number(process.env[specificLiveIdEnv].trim());
      }

      config.socket.userId          = Number(process.env[envId]       ?? defaultId);
      config.livekit.botIdentity    = process.env[envIdentity]         ?? defaultIdentity;
      config.livekit.botDisplayName = process.env[envName]             ?? defaultName;

      const botApiKeyEnv = `GROQ_API_KEY_${upperKey}`;
      if (process.env[botApiKeyEnv]) config.groq.apiKey = process.env[botApiKeyEnv].trim();
    }

    let hasOverriddenSession = false;
    if (config.socket.broadcasterId) {
      log.info({ broadcasterId: config.socket.broadcasterId }, 'Querying active live session...');
      hasOverriddenSession = await applyActiveLiveSession(config.socket.broadcasterId, botKeyUpper);
    }

    if (!hasOverriddenSession && config.livekit.roomName) {
      log.info({ roomName: config.livekit.roomName }, 'Aligning socket liveId with configured roomName from DB...');
      try {
        const resolvedLiveId = await resolveLiveIdFromRoomName(config.livekit.roomName);
        if (resolvedLiveId) {
          log.info({ roomName: config.livekit.roomName, resolvedLiveId }, 'Successfully aligned liveId with roomName');
          config.socket.liveId = resolvedLiveId;
        } else {
          log.warn({ roomName: config.livekit.roomName }, 'Could not resolve liveId for roomName from DB, using fallback config');
        }
      } catch (err) {
        log.warn({ err, roomName: config.livekit.roomName }, 'Error aligning liveId with roomName');
      }
    }

    log.info('═══════════════════════════════════════════');
    log.info('  Roxstar AI Bot — starting up');
    log.info('═══════════════════════════════════════════');
    log.info(
      { room: config.livekit.roomName, bot: config.livekit.botIdentity, persona: activePersona },
      'Config loaded',
    );

    log.info('Instantiating services...');

    persona = createPersonaMemory(mongoPersonaService);
    log.debug('✓ PersonaMemory');

    context = createContextMemory(redis, {
      maxTranscriptEntries: config.context.windowSize,
      maxCommentEntries:    config.context.windowSize,
      maxBotReplyEntries:   config.context.windowSize,
      contextTtl:           config.redis.contextTtlSeconds,
      unifiedRoomId:        config.livekit.roomName,
      botId:                config.livekit.botPersona,
    });
    log.debug('✓ ContextMemory');

    behavior = createBehaviorEngine(redis, {
      cooldownSeconds:      Math.floor(config.behavior.perUserCooldownMs / 1000),
      baseReplyProbability: config.behavior.replyProbability,
      maxRepliesPerMinute:  6,
      botId:                config.livekit.botPersona,
      botNames: [
        config.livekit.botDisplayName,
        config.livekit.botIdentity,
        ...(activeDef?.displayNameVariations ?? []),
      ].filter(Boolean),
    });
    log.debug('✓ BehaviorEngine');

    promptBuilder = createPromptBuilder({
      historyTokenBudget: config.prompt.historyTokenBudget,
      broadcasterId:      config.socket.broadcasterId,
      blacklistWords:     config.blacklistWords,
    });
    log.debug('✓ PromptBuilder');

    const useLiveKit  = ['livekit', 'both'].includes(config.realtime.provider);
    const useSocketIO = ['socketio', 'both'].includes(config.realtime.provider);
    const fallbackBotId = config.livekit.botPersona || 'zara-bot';

    contextBuilder = createContextBuilder({
      contextMemory: context,
      personaMemory: persona,
      promptBuilder,
      roomRef,
      botId: useLiveKit ? config.livekit.botPersona : fallbackBotId,
    });
    log.debug('✓ ContextBuilder');

    responseParser = createResponseParser({ maxReplyChars: 300 });
    log.debug('✓ ResponseParser');

    const apiKey = config.groq.apiKey;
    const isOpenAI = apiKey?.startsWith('sk-') && !apiKey?.startsWith('sk-or-');
    if (isOpenAI) {
      let model = config.groq.model;
      if (!model || (!model.startsWith('gpt-') && !model.startsWith('o1-') && !model.startsWith('o3-'))) {
        model = 'gpt-4o-mini';
      }
      groqAdapter = createOpenAIAdapter({
        apiKey,
        model,
        maxTokens:   config.groq.maxTokens,
        temperature: config.groq.temperature,
        timeoutMs:   config.groq.timeoutMs,
        maxRetries:  config.groq.maxRetries,
      });
      log.info({ model }, '✓ OpenAIAdapter (loaded dynamically)');
    } else {
      groqAdapter = createGroqAdapter({
        apiKey,
        model:       config.groq.model,
        maxTokens:   config.groq.maxTokens,
        temperature: config.groq.temperature,
        timeoutMs:   config.groq.timeoutMs,
        maxRetries:  config.groq.maxRetries,
      });
      log.debug('✓ GroqAdapter');
    }

    llm = createLLMService({ groqAdapter, responseParser });
    log.debug('✓ LLMService');

    const gateBotNames = [
      config.livekit.botDisplayName,
      config.livekit.botIdentity,
      ...(activeDef?.displayNameVariations ?? []),
    ].filter(Boolean);

    gateCheck = createGroqGateCheck({ groqAdapter, botNames: gateBotNames });
    log.debug('✓ GroqGateCheck');

    joinGreeting = createJoinGreetingService({
      redis,
      groqAdapter,
      personaMemory: persona,
      botPersona:    useLiveKit ? config.livekit.botPersona : fallbackBotId,
      connectorRef,
      useSocketIO,
      broadcasterId: config.socket.broadcasterId,
    });
    joinGreeting.init();
    log.debug('✓ JoinGreetingService');

    moderation = createModerationService({ groqKey: config.groq.apiKey });
    log.debug('✓ ModerationService');

    commentFilter = createCommentFilter({
      minLength:            config.commentFilter.minLength,
      maxLength:            config.commentFilter.maxLength,
      rateLimitWindowMs:    config.commentFilter.rateLimitWindowMs,
      rateLimitMaxMessages: config.commentFilter.rateLimitMaxMessages,
      blockedUserIds,
      botNames:             [config.livekit.botDisplayName, config.livekit.botIdentity].filter(Boolean),
      otherBotNames:        otherBotDisplayNames,
    });
    log.debug('✓ CommentFilter');

    commentListener = createCommentListener();
    log.debug('✓ CommentListener');

    if (useLiveKit) {
      const audioStage = process.env.AUDIO_PIPELINE_STAGE ? Number(process.env.AUDIO_PIPELINE_STAGE.trim()) : 0;
      const whisperKey = process.env.WHISPER_API_KEY ?? config.groq.apiKey;
      log.info({ keyPrefix: whisperKey?.slice(0, 15), keyLength: whisperKey?.length }, 'BotRunner: whisper key being used');
      audioPipeline = createAudioPipeline({
        stage:      audioStage,
        groqApiKey: whisperKey,
        sttMinRms:  config.livekit.sttMinRms,
      });
      await audioPipeline.init();

      livekitConnector = createLiveKitConnector({
        url:                 config.livekit.url,
        apiKey:              config.livekit.apiKey,
        apiSecret:           config.livekit.apiSecret,
        tokenApiUrl:         config.livekit.tokenApiUrl,
        roomName:            config.livekit.roomName,
        botIdentity:         config.livekit.botIdentity,
        botDisplayName:      config.livekit.botDisplayName,
        reconnectAttempts:   config.livekit.reconnect.attempts,
        reconnectBaseMs:     config.livekit.reconnect.baseMs,
        reconnectMaxMs:      config.livekit.reconnect.maxMs,
        connectTimeoutMs:    config.livekit.connectTimeoutMs,
        disconnectTimeoutMs: config.livekit.disconnectTimeoutMs,
      });
      log.debug('✓ LiveKitConnector');
    }

    if (useSocketIO) {
      socketIOConnector = createSocketIOConnector({
        url:                  config.socket.url,
        path:                 config.socket.path,
        reconnectionAttempts: config.socket.reconnectionAttempts,
        timeout:              config.socket.timeout,
        liveId:               config.socket.liveId,
        userId:               config.socket.userId,
        broadcasterId:        config.socket.broadcasterId,
        redis,
      });
      log.debug('✓ SocketIOConnector');
    }

    replyPublisher = createReplyPublisher({
      roomRef,
      connectorRef,
      botIdentity:    useSocketIO ? String(config.socket.userId) : config.livekit.botIdentity,
      botDisplayName: useSocketIO ? String(config.socket.userId) : config.livekit.botDisplayName,
      sendMode:       useSocketIO ? 'socket_io' : 'chat',
    });
    log.debug('✓ ReplyPublisher');

    if (useLiveKit) {
      transcriptProcessor = createTranscriptProcessor({
        context,
        behavior,
        gateCheck,
        roomRef,
        botIdentity:    config.livekit.botIdentity,
        botDisplayName: config.livekit.botDisplayName,
        blockedUserIds,
      });
      transcriptProcessor.init();
      log.debug('✓ TranscriptProcessor');
    }

    commentProcessor = createCommentProcessor({ context, behavior });
    commentProcessor.init();
    log.debug('✓ CommentProcessor');

    replyProcessor = createReplyProcessor({
      context,
      moderation,
      botId: config.livekit.botPersona,
      redis,
    });
    replyProcessor.init();
    log.debug('✓ ReplyProcessor');

    // Subscribe to Redis approved events for moderation
    try {
      await redisSub.subscribe('moderation:channel');
      log.info('Subscribed to Redis moderation:channel');
    } catch (err) {
      log.error({ err }, 'Failed to subscribe to Redis moderation:channel');
    }

    redisSub.on('message', (channel, message) => {
      if (channel === 'moderation:channel') {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'approved' && parsed.botId === config.livekit.botPersona) {
            log.info({ queueId: parsed.queueId, text: parsed.text }, 'Received approval message via Redis');
            replyProcessor.publishApprovedReply({
              text: parsed.text,
              trigger: parsed.trigger,
              usage: parsed.usage,
              roomId: parsed.roomId,
            }).catch((err) => log.error({ err }, 'Failed to process approved reply'));
          } else if (parsed.type === 'shutdown' && parsed.botId === config.livekit.botPersona) {
            log.info('Received shutdown command via Redis');
            stop('Redis shutdown command').catch((err) => log.error({ err }, 'Shutdown error'));
          }
        } catch (err) {
          log.error({ err, message }, 'Failed to parse/process Redis subscription message');
        }
      }
    });

    log.info('Wiring EventBus...');
    wireEvents();
    log.info('✓ EventBus wired');

    if (useLiveKit) {
      log.info({ room: config.livekit.roomName }, 'Connecting to LiveKit room...');
      await livekitConnector.connect();
      if (livekitConnector.getRoom) roomRef.room = livekitConnector.getRoom();
    }

    if (useSocketIO) {
      log.info({ url: config.socket.url }, 'Connecting to Socket.IO server...');
      connectorRef.connector = socketIOConnector;
      await socketIOConnector.connect();
    }

    log.info('═══════════════════════════════════════════');
    log.info('  Bot is live. Listening...');
    log.info('═══════════════════════════════════════════');
  }

  // ─── Session insights ────────────────────────────────────────────────────────

  const SONG_KEYWORDS = ['gaana', 'song', 'ghazal', 'suna', 'sing', 'lyric'];

  async function compileAndSaveInsights(roomId) {
    log.info({ roomId }, 'Compiling session insights...');

    const data = await context.getAll(roomId);

    const uniqueUsers = new Set([
      ...(data.transcripts ?? []).map((t) => t.speakerId).filter(Boolean),
      ...(data.comments    ?? []).map((c) => c.username ?? c.userId).filter(Boolean),
    ]);

    const requestedSongs = (data.transcripts ?? []).filter((t) =>
      SONG_KEYWORDS.some((k) => t.text.toLowerCase().includes(k)),
    ).map(({ text, ts }) => ({ text, ts }));

    const botConversations = (data.botReplies ?? []).map((r) => ({
      user:     r.promptUser || 'unknown',
      question: r.promptText || '',
      botReply: r.text,
      ts:       r.ts,
    }));

    const insights = {
      totalTranscripts: data.transcripts?.length ?? 0,
      totalComments:    data.comments?.length    ?? 0,
      totalBotReplies:  data.botReplies?.length  ?? 0,
      uniqueUsers:      Array.from(uniqueUsers),
      requestedSongs,
      botConversations,
      startedAt: data.meta?.startedAt ?? new Date().toISOString(),
      endedAt:   new Date().toISOString(),
      roomName:  data.meta?.roomName  ?? roomId,
    };

    await context.setInsights(roomId, insights);
    log.info({ roomId, insights }, '✓ Session insights saved');

    await extractAndSaveBroadcasterFacts(roomId, data);
  }

  async function extractAndSaveBroadcasterFacts(roomId, data) {
    const broadcasterId = data.meta?.broadcasterId ?? config.socket.broadcasterId;
    if (!broadcasterId || !groqAdapter) return;

    const broadcasterTranscripts = (data.transcripts ?? [])
      .filter((t) => String(t.speakerId) === String(broadcasterId))
      .map((t) => t.text)
      .join('\n')
      .trim();

    if (!broadcasterTranscripts) return;

    log.info({ roomId, broadcasterId }, 'Extracting broadcaster facts from transcripts...');

    try {
      const messages = [
        {
          role: 'system',
          content: `You are an information extraction assistant. Analyze the following livestream transcript and extract key personal facts about the broadcaster (the streamer/host) — such as city, state, age, hobbies, family, or work.
Only extract facts explicitly stated by the broadcaster.
Respond with a raw JSON object only. No markdown, no wrappers, no extra text.
Example: {"location":"Gujarat","hobbies":"singing"}`,
        },
        { role: 'user', content: broadcasterTranscripts },
      ];

      const response   = await groqAdapter.complete(messages, { maxTokens: 256, temperature: 0.1 });
      const rawContent = response?.choices?.[0]?.message?.content?.trim() ?? '';

      if (!rawContent.startsWith('{') || !rawContent.endsWith('}')) return;

      const newFacts = JSON.parse(rawContent);
      if (!Object.keys(newFacts).length) return;

      const existingFacts = (await context.getBroadcasterFacts(broadcasterId)) ?? {};
      const mergedFacts   = { ...existingFacts, ...newFacts };
      await context.setBroadcasterFacts(broadcasterId, mergedFacts);
      log.info({ roomId, broadcasterId, mergedFacts }, '✓ Broadcaster facts saved');
    } catch (err) {
      log.warn({ err, roomId }, 'Failed to extract broadcaster facts');
    }
  }

  // ─── Stop ────────────────────────────────────────────────────────────────────

  async function stop(reason = 'unknown') {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info({ reason }, 'Shutting down bot...');
    stopHeartbeat();
    unwireEvents();

    llm?.destroy();
    transcriptProcessor?.destroy();
    commentProcessor?.destroy();
    replyProcessor?.destroy();
    joinGreeting?.destroy();
    contextBuilder?.destroy();
    replyPublisher?.destroy();
    commentFilter?.destroy();
    commentListener?.destroy();
    audioPipeline?.destroy();

    await livekitConnector?.disconnect().catch((err) => log.warn({ err }, 'LiveKit disconnect error'));
    await socketIOConnector?.disconnect().catch((err) => log.warn({ err }, 'SocketIO disconnect error'));

    if (redisSub) {
      await redisSub.unsubscribe().catch((err) => log.warn({ err }, 'Redis Sub unsubscribe error'));
      if (redisSub.quit) {
        await redisSub.quit().catch((err) => log.warn({ err }, 'Redis Sub quit error'));
        log.info('Redis Sub disconnected');
      }
    }

    if (redis?.quit) {
      await redis.quit().catch((err) => log.warn({ err }, 'Redis quit error'));
      log.info('Redis disconnected');
    }

    if (mongoClient) {
      await mongoClient.close().catch((err) => log.warn({ err }, 'MongoClient close error'));
      log.info('MongoDB disconnected');
    }

    try {
      await mongoose.connection.close();
      log.info('Mongoose disconnected');
    } catch (err) {
      log.warn({ err }, 'Mongoose disconnect error');
    }

    roomRef.room = null;
    log.info('Bot stopped cleanly. Goodbye.');
    await sleep(200);
    process.exit(0);
  }

  return { start, stop };
}

// ─── Signal handlers ──────────────────────────────────────────────────────────

export function registerSignalHandlers(runner) {
  let forcedExit = false;

  async function handleSignal(signal) {
    if (forcedExit) {
      process.stderr.write(`Forced exit on second ${signal}\n`);
      process.exit(1);
    }
    forcedExit = true;
    log.info({ signal }, 'Signal received — beginning graceful shutdown');
    await runner.stop(signal);
  }

  process.on('SIGINT',  () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  process.on('uncaughtException', async (err) => {
    log.error({ err }, 'Uncaught exception');
    await runner.stop('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled promise rejection — investigate immediately');
  });
}


const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('BotRunner.js') || process.argv[1].endsWith('start-bot.js'));

if (isMain) {
  const runner = createBotRunner();
  registerSignalHandlers(runner);
  runner.start().catch(async (err) => {
    log.error({ err }, 'BotRunner.start() failed');
    await runner.stop('startup_error');
  });
}