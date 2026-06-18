import logger from '../utils/logger.js';

const log = logger.child({ module: 'MongoConversationService' });
const REQUIRED_CONVERSATION_BOTS = ['aman', 'shivam', 'abhishek', 'rahul', 'priya', 'simran', 'neha', 'ananya', 'divya'];

function normalizeBotName(botId) {
  return String(botId || '').trim().toLowerCase().replace(/-bot$/i, '');
}

function isPoolClosedError(err) {
  return err && (
    err.name === 'MongoPoolClosedError' ||
    err.name === 'PoolClosedError' ||
    err.name === 'MongoExpiredSessionError' ||
    err.message?.includes('closed connection pool') ||
    err.message?.includes('session that has ended')
  );
}

async function getKnownBotNames(db) {
  const names = new Set(REQUIRED_CONVERSATION_BOTS);

  try {
    const botDefs = await db.collection('bot_definitions')
      .find({}, { projection: { key: 1, defaultIdentity: 1 } })
      .toArray();

    for (const def of botDefs) {
      const fromKey = normalizeBotName(def?.key);
      const fromIdentity = normalizeBotName(def?.defaultIdentity);
      if (fromKey) names.add(fromKey);
      if (fromIdentity) names.add(fromIdentity);
    }
  } catch (err) {
    if (isPoolClosedError(err)) {
      log.debug({ err }, 'MongoDB connection pool closed while loading bot_definitions');
    } else {
      log.warn({ err }, 'Failed to load bot_definitions; using fallback static bot list');
    }
  }

  return [...names];
}

function ensureQueueCollectionsForBot(db, bot) {
  const conversationsQueue = db.collection(`conversationsqueue/${bot}`);
  const rejectQueue = db.collection(`reject_queue/${bot}`);

  const handleIndexError = (err, collectionName) => {
    if (isPoolClosedError(err)) {
      log.debug({ err }, `MongoDB connection pool closed while creating index on collection: ${collectionName}`);
    } else {
      log.error({ err }, `Failed to create index on collection: ${collectionName}`);
    }
  };

  conversationsQueue.createIndex({ botId: 1, roomId: 1, timestamp: -1 })
    .catch((err) => handleIndexError(err, `conversationsqueue/${bot}`));

  rejectQueue.createIndex({ botId: 1, roomId: 1, status: 1, timestamp: -1 })
    .catch((err) => handleIndexError(err, `reject_queue/${bot}`));
}

export function createMongoConversationService(mongoClient, dbName = 'ai_chatbot') {
  if (!mongoClient) {
    throw new Error('MongoConversationService: mongoClient is required');
  }

  const db = mongoClient.db(dbName);

  // Ensure conversations, conversationsqueue, and reject_queue collections exist for all known bots.
  (async () => {
    const knownBots = await getKnownBotNames(db);
    for (const bot of knownBots) {
      ensureQueueCollectionsForBot(db, bot);
    }
  })().catch((err) => log.error({ err }, 'Failed to ensure per-bot queue collections'));

  async function saveQA({ botId, roomId, question, questionUser, answer }) {
    try {
      const cleanBotName = normalizeBotName(botId || 'unknown');
      const dynamicCollection = db.collection(`conversationsqueue/${cleanBotName}`);

      // Ensure queues for bots discovered at runtime.
      ensureQueueCollectionsForBot(db, cleanBotName);

      const doc = {
        botId: botId || 'unknown-bot',
        roomId,
        question: question || '',
        questionUser: questionUser || 'unknown',
        answer: answer || '',
        timestamp: new Date()
      };
      const result = await dynamicCollection.insertOne(doc);
      log.debug({ id: result.insertedId, botId, roomId }, `Saved Q&A pair to MongoDB collection: ${cleanBotName}`);
      return result;
    } catch (err) {
      log.error({ err, botId, roomId }, 'Failed to save Q&A pair to MongoDB conversationsqueue');
    }
  }

  return {
    saveQA,
    db
  };
}
