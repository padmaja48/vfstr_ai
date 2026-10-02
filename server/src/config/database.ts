import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

export const DEFAULT_TEST_MONGODB_URI = 'mongodb://localhost:27017/fluentai_test';

export type MongoUriResolutionInput = {
  nodeEnv: string;
  mongodbUri: string;
  mongodbTestUri?: string;
  allowProdDbInTests?: boolean;
};

/** Pure resolver — used in tests to verify prod DB is never selected accidentally. */
export const resolveMongoUriFromConfig = (input: MongoUriResolutionInput): string => {
  if (input.nodeEnv !== 'test') return input.mongodbUri;

  const explicitTestUri = input.mongodbTestUri?.trim();
  if (explicitTestUri) return explicitTestUri;

  const prodLike = /\/fluentai(\?|$)/i.test(input.mongodbUri)
    && !/\/fluentai_test/i.test(input.mongodbUri);

  if (prodLike && input.allowProdDbInTests !== true) {
    return DEFAULT_TEST_MONGODB_URI;
  }

  return input.mongodbUri || DEFAULT_TEST_MONGODB_URI;
};

const resolveMongoUri = () => resolveMongoUriFromConfig({
  nodeEnv: env.NODE_ENV,
  mongodbUri: env.MONGODB_URI,
  mongodbTestUri: process.env.MONGODB_TEST_URI,
  allowProdDbInTests: process.env.ALLOW_PROD_DB_IN_TESTS === '1',
});

export const getResolvedMongoUri = () => resolveMongoUri();

export const connectDatabase = async () => {
  const uri = resolveMongoUri();
  if (env.NODE_ENV === 'test' && uri === DEFAULT_TEST_MONGODB_URI && /\/fluentai(\?|$)/i.test(env.MONGODB_URI)) {
    logger.warn(
      { uri },
      'Tests use isolated MongoDB database (set MONGODB_TEST_URI or ALLOW_PROD_DB_IN_TESTS=1 to override)',
    );
  }
  await mongoose.connect(uri);
  logger.info('MongoDB connected');
};

export const disconnectDatabase = async () => {
  await mongoose.disconnect();
};

export const isDatabaseConnected = () => mongoose.connection.readyState === 1;
