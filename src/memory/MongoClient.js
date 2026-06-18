import { MongoClient } from 'mongodb';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'MongoClient' });

export async function createMongoClient(url) {
  if (!url?.trim()) {
    throw new Error('MongoClient: missing required config field "url"');
  }

  const client = new MongoClient(url);

  try {
    await client.connect();
    // Verify connection using ping command
    await client.db().admin().ping();
    log.info('MongoClient connected and verified successfully');
    return client;
  } catch (err) {
    log.error({ err }, 'MongoClient connection failed');
    throw err;
  }
}
