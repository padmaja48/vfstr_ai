import IORedis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';
import { MemoryRedis } from './memoryRedis';

type RedisLike = IORedis | MemoryRedis;

let redisClient: RedisLike | null = null;
let queueRedisClient: RedisLike | null = null;

const isLocalRedisUrl = (url: string) =>
  /^redis(s)?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);

export const isMemoryRedis = () =>
  env.REDIS_URL.startsWith('memory://') ||
  (env.NODE_ENV === 'production' && isLocalRedisUrl(env.REDIS_URL));

const createClient = () => {
  if (isMemoryRedis()) {
    if (isLocalRedisUrl(env.REDIS_URL)) {
      logger.warn(
        { redisUrl: env.REDIS_URL },
        'REDIS_URL points at localhost in production — using in-memory Redis so login does not hang.',
      );
    } else {
      logger.warn('Using in-memory Redis adapter. This is for local development/testing only.');
    }
    return new MemoryRedis();
  }

  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    connectTimeout: 5000,
    keyPrefix: '',
  });

  client.on('error', (error) => {
    logger.warn({ error: error.message }, 'Redis connection issue');
  });

  return client;
};

export const getRedis = () => {
  if (!redisClient) {
    redisClient = createClient();
  }

  return redisClient;
};

export const getQueueRedis = () => {
  if (!queueRedisClient) {
    queueRedisClient = createClient();
  }

  return queueRedisClient;
};

export const closeRedis = async () => {
  await Promise.all([redisClient?.quit(), queueRedisClient?.quit()]);
  redisClient = null;
  queueRedisClient = null;
};
