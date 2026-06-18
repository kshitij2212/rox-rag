import 'dotenv/config';

import config from '../config/default.js';
import { createMongoClient } from '../src/memory/MongoClient.js';

const REQUIRED_BOTS = new Set(['aman', 'shivam', 'abhishek', 'rahul']);
const COLLECTIONS_TO_MIGRATE = [
  { legacy: 'conversations', pattern: 'conversations' },
  { legacy: 'reject_queue', pattern: 'reject_queue' }
];

function normalizeBotName(botId) {
  const raw = String(botId || '').trim().toLowerCase();
  if (!raw) return null;
  return raw.replace(/-bot$/i, '');
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function printHelp() {
  console.log('Usage: node scripts/migrate-conversations.js [--dry-run] [--drop-legacy]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run      Preview migration without writing any documents');
  console.log('  --drop-legacy  Drop legacy collections after successful migration (conversations, reject_queue)');
}

async function ensureTargetCollections(db) {
  for (const collType of COLLECTIONS_TO_MIGRATE) {
    for (const bot of REQUIRED_BOTS) {
      const collection = db.collection(`${collType.pattern}/${bot}`);
      await collection.createIndex({ botId: 1, roomId: 1, timestamp: -1 });
    }
  }
}

async function main() {
  if (hasArg('--help') || hasArg('-h')) {
    printHelp();
    return;
  }

  const dryRun = hasArg('--dry-run');
  const dropLegacy = hasArg('--drop-legacy');

  let client;
  try {
    client = await createMongoClient(config.mongo.url);
    const db = client.db();

    await ensureTargetCollections(db);

    const globalSummary = {
      collections: {}
    };

    for (const collType of COLLECTIONS_TO_MIGRATE) {
      const legacyName = collType.legacy;
      const legacyExists = await db.listCollections({ name: legacyName }, { nameOnly: true }).hasNext();
      
      if (!legacyExists) {
        console.log(`No legacy ${legacyName} collection found.`);
        continue;
      }

      const legacyCollection = db.collection(legacyName);
      const cursor = legacyCollection.find({});

      const summary = {
        scanned: 0,
        migrated: 0,
        skipped: 0,
        skippedUnsupportedBots: 0,
        alreadyPresent: 0,
        errors: 0,
      };

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        summary.scanned += 1;

        const bot = normalizeBotName(doc?.botId);
        if (!bot || !REQUIRED_BOTS.has(bot)) {
          summary.skipped += 1;
          summary.skippedUnsupportedBots += 1;
          continue;
        }

        if (dryRun) {
          summary.migrated += 1;
          continue;
        }

        try {
          const target = db.collection(`${collType.pattern}/${bot}`);
          const result = await target.updateOne(
            { _id: doc._id },
            { $setOnInsert: doc },
            { upsert: true }
          );

          if (result.upsertedCount === 1) {
            summary.migrated += 1;
          } else {
            summary.alreadyPresent += 1;
          }
        } catch (err) {
          summary.errors += 1;
          console.error(`Failed to migrate ${legacyName} _id=${doc?._id}:`, err.message);
        }
      }

      globalSummary.collections[legacyName] = summary;

      if (!dryRun && dropLegacy && summary.errors === 0) {
        await legacyCollection.drop();
        console.log(`Dropped legacy collection: ${legacyName}`);
      }
    }

    console.log('\nMigration summary:');
    console.log(JSON.stringify(globalSummary, null, 2));

    if (dryRun) {
      console.log('\nDry run only: no documents were written.');
      return;
    }

    if (dropLegacy) {
      const hasErrors = Object.values(globalSummary.collections).some(s => s.errors > 0);
      if (hasErrors) {
        console.log('\nSkipped dropping collections because migration had errors.');
      }
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();
