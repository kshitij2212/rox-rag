import { readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';
import 'dotenv/config';

import { createMongoPersonaService } from '../src/memory/MongoPersonaService.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ai_chatbot';

async function main() {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error('Usage: node scripts/add-bot.js <path-to-persona-json>');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), filePathArg);
  let persona;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    persona = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read/parse persona file at ${filePath}:`, err.message);
    process.exit(1);
  }

  // Basic validation
  const required = ['botId', 'displayName', 'location', 'language', 'personality', 'interests', 'backstory', 'replyStyle'];
  for (const field of required) {
    if (persona[field] == null) {
      console.error(`Validation Error: Persona is missing required field "${field}"`);
      process.exit(1);
    }
  }

  // Derive bot definitions
  const botId = persona.botId;
  const key = botId.replace('-bot', '').toLowerCase();
  const upperKey = key.toUpperCase();

  const botDef = {
    key,
    envId: `SOCKET_USER_ID_${upperKey}`,
    defaultId: String(Math.floor(1000 + Math.random() * 9000)), // Generate a default ID
    envIdentity: `BOT_IDENTITY_${upperKey}`,
    defaultIdentity: botId,
    envName: `BOT_DISPLAY_NAME_${upperKey}`,
    defaultName: persona.displayName,
    displayNameVariations: [persona.displayName, key]
  };

  console.log(`Connecting to MongoDB via Mongoose...`);
  try {
    await mongoose.connect(MONGO_URI);
    const mongoPersonaService = createMongoPersonaService();

    console.log(`Saving persona for "${botId}"...`);
    await mongoPersonaService.savePersona(persona);

    console.log(`Saving bot definition for "${key}"...`);
    await mongoPersonaService.saveBotDefinition(botDef);

    console.log('✓ Bot successfully added and registered in MongoDB!');
    console.log('Connection settings created:');
    console.log(JSON.stringify(botDef, null, 2));
  } catch (err) {
    console.error('Error adding bot:', err.message);
  } finally {
    await mongoose.connection.close();
  }
}

main();
