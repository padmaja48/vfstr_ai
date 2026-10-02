import {
  DEFAULT_TEST_MONGODB_URI,
  resolveMongoUriFromConfig,
} from '../config/database';

describe('resolveMongoUriFromConfig', () => {
  it('uses production URI outside test environment', () => {
    expect(resolveMongoUriFromConfig({
      nodeEnv: 'development',
      mongodbUri: 'mongodb://localhost:27017/fluentai',
    })).toBe('mongodb://localhost:27017/fluentai');
  });

  it('redirects prod-like fluentai URI to fluentai_test during tests', () => {
    expect(resolveMongoUriFromConfig({
      nodeEnv: 'test',
      mongodbUri: 'mongodb+srv://user:pass@cluster.example/fluentai?retryWrites=true',
    })).toBe(DEFAULT_TEST_MONGODB_URI);
  });

  it('honors MONGODB_TEST_URI in test environment', () => {
    expect(resolveMongoUriFromConfig({
      nodeEnv: 'test',
      mongodbUri: 'mongodb://localhost:27017/fluentai',
      mongodbTestUri: 'mongodb://localhost:27017/custom_test_db',
    })).toBe('mongodb://localhost:27017/custom_test_db');
  });

  it('allows prod URI in tests only when ALLOW_PROD_DB_IN_TESTS=1 equivalent is set', () => {
    expect(resolveMongoUriFromConfig({
      nodeEnv: 'test',
      mongodbUri: 'mongodb://localhost:27017/fluentai',
      allowProdDbInTests: true,
    })).toBe('mongodb://localhost:27017/fluentai');
  });
});
