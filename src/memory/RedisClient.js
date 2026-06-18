import Redis  from 'ioredis';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'RedisClient' });

export async function createRedisClient(url) {
  if (!url?.trim()) {
    throw new Error('RedisClient: missing required config field "url"');
  }

  const client = new Redis(url, {

    maxRetriesPerRequest: 3,
    enableReadyCheck:     true,
    lazyConnect:          true,
  });

  client.on('error',       (err) => log.error({ err },    'Redis error'));
  client.on('reconnecting', ()   => log.warn({},           'Redis reconnecting'));
  client.on('ready',        ()   => log.info({ url },      'Redis ready'));

  await client.connect();

  const pong = await client.ping();
  if (pong !== 'PONG') {
    throw new Error('RedisClient: PING check failed after connect');
  }

  log.info({ url }, 'RedisClient connected');
  return client;
}
