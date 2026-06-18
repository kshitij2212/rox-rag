import logger from '../utils/logger.js';

const log = logger.child({ module: 'PersonaMemoryService' });

export function createPersonaMemory(mongoPersonaService = null) {

  const cache = new Map();

  async function load(botId) {
    if (!mongoPersonaService) {
      throw new Error('PersonaMemoryService: mongoPersonaService is required when running without local fallback');
    }

    try {
      const persona = await mongoPersonaService.getPersona(botId);
      if (persona) {
        // Remove internal mongodb _id field
        delete persona._id;
        validatePersona(persona, botId);
        log.info({ botId, displayName: persona.displayName }, 'Persona loaded from MongoDB');
        return persona;
      }
    } catch (err) {
      log.error({ err, botId }, 'Failed to fetch persona from MongoDB');
      throw err;
    }

    throw new Error(`PersonaMemory: persona not found in MongoDB for botId "${botId}"`);
  }

  function validatePersona(persona, botId) {
    const required = ['botId', 'displayName', 'location', 'language', 'personality', 'interests', 'backstory', 'replyStyle'];
    for (const field of required) {
      if (persona[field] == null) {
        throw new Error(`PersonaMemory: persona "${botId}" is missing required field "${field}"`);
      }
    }
    if (!Array.isArray(persona.interests) || persona.interests.length === 0) {
      throw new Error(`PersonaMemory: persona "${botId}" interests must be a non-empty array`);
    }
    if (!Array.isArray(persona.replyStyle?.exampleReplies)) {
      throw new Error(`PersonaMemory: persona "${botId}" replyStyle.exampleReplies must be an array`);
    }
  }

  async function getPersona(botId) {
    if (!cache.has(botId)) {
      const persona = await load(botId);
      cache.set(botId, persona);
    }
    return cache.get(botId);
  }

  async function preload(botId) {
    await getPersona(botId);
  }

  return { getPersona, preload };
}
