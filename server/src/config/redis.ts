import IORedis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';
import { MemoryRedis } from './memoryRedis';

type RedisLike = IORedis | MemoryRedis;

let redisClient: RedisLike | null = null;
let queueRedisClient: RedisLike | null = null;

export const isMemoryRedis = () => env.REDIS_URL.startsWith('memory://');

const createClient = () => {
  if (isMemoryRedis()) {
    logger.warn('Using in-memory Redis adapter. This is for local development/testing only.');
    return new MemoryRedis();
  }

  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
