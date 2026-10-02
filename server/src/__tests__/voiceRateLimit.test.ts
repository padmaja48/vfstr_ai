import express from 'express';
import request from 'supertest';
import { createVoiceLimiter } from '../middleware/rateLimiter';

describe('voice rate limiters (J02)', () => {
  const prevForce = process.env.FORCE_RATE_LIMIT;

  beforeAll(() => {
    process.env.FORCE_RATE_LIMIT = '1';
  });

  afterAll(() => {
    if (prevForce === undefined) delete process.env.FORCE_RATE_LIMIT;
    else process.env.FORCE_RATE_LIMIT = prevForce;
  });

  it('returns retryable 429 under speak burst load instead of crashing', async () => {
    const app = express();
    app.use(express.json());
    // skip must be false so FORCE_RATE_LIMIT path is exercised via factory override
    app.post(
      '/speak',
      createVoiceLimiter({
        windowMs: 60_000,
        limit: 2,
        message: 'Too many speak requests. Please wait a moment and retry.',
        skip: () => false,
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );

    const first = await request(app).post('/speak').send({});
    const second = await request(app).post('/speak').send({});
    const third = await request(app).post('/speak').send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');
    expect(third.body.retryable).toBe(true);
    expect(third.headers['retry-after']).toBeTruthy();
  });
});
