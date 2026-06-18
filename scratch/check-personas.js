import mongoose from 'mongoose';
import 'dotenv/config';
import { Persona } from '../src/memory/models/Persona.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ai_chatbot';

const defaultOccupations = {
  'rahul-bot': '(e.g., "dukaan hai meri kirane ki" or "kirane ki dukaan hai")',
  'shivam-bot': '(e.g., "college mein padhta hoon" or "bcom kar raha hoon")',
  'abhishek-bot': '(e.g., "btech kar raha hoon" or "college student hoon")',
  'aman-bot': '(e.g., "software engineer hoon" or "infosys mein kaam karta hoon")',
};

async function main() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGO_URI);
  console.log(`✓ MongoDB connected.`);

  const personas = await Persona.find({}).lean();
  console.log(`Found ${personas.length} personas in database.`);

  for (const p of personas) {
    console.log(`Bot: ${p.botId} (${p.displayName})`);
    console.log(`  Current occupationExample: ${p.occupationExample || 'None'}`);

    if (!p.occupationExample) {
      const defaultVal = defaultOccupations[p.botId] || '(answer briefly based on your backstory)';
      console.log(`  Seeding with: ${defaultVal}`);
      await Persona.updateOne({ botId: p.botId }, { $set: { occupationExample: defaultVal } });
      console.log(`  ✓ Updated!`);
    }
  }

  await mongoose.connection.close();
  console.log(`✓ Done`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
