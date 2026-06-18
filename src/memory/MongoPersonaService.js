import logger from '../utils/logger.js';
import { Persona } from './models/Persona.js';
import { BotDefinition } from './models/BotDefinition.js';

const log = logger.child({ module: 'MongoPersonaService' });

export function createMongoPersonaService(mongoClient = null, dbName = 'ai_chatbot') {
  async function getPersona(botId) {
    try {
      return await Persona.findOne({ botId }).lean();
    } catch (err) {
      log.error({ err, botId }, 'Failed to fetch persona from MongoDB');
      return null;
    }
  }

  async function savePersona(persona) {
    if (!persona || !persona.botId) {
      throw new Error('MongoPersonaService.savePersona: invalid persona payload');
    }
    try {
      const result = await Persona.updateOne(
        { botId: persona.botId },
        { $set: { ...persona, updatedAt: new Date() } },
        { upsert: true }
      );
      log.info({ botId: persona.botId }, 'Persona saved to MongoDB');
      return result;
    } catch (err) {
      log.error({ err, botId: persona.botId }, 'Failed to save persona to MongoDB');
      throw err;
    }
  }

  async function getBotDefinitions() {
    try {
      return await BotDefinition.find({}).lean();
    } catch (err) {
      log.error({ err }, 'Failed to fetch bot definitions from MongoDB');
      return [];
    }
  }

  async function saveBotDefinition(botDef) {
    if (!botDef || !botDef.key) {
      throw new Error('MongoPersonaService.saveBotDefinition: invalid botDef payload');
    }
    try {
      const result = await BotDefinition.updateOne(
        { key: botDef.key },
        { $set: { ...botDef, updatedAt: new Date() } },
        { upsert: true }
      );
      log.info({ key: botDef.key }, 'Bot definition saved to MongoDB');
      return result;
    } catch (err) {
      log.error({ err, key: botDef.key }, 'Failed to save bot definition to MongoDB');
      throw err;
    }
  }

  return {
    getPersona,
    savePersona,
    getBotDefinitions,
    saveBotDefinition
  };
}
