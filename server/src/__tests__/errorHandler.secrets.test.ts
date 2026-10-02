import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/errorHandler';
import { AppError } from '../utils/AppError';

describe('errorHandler secret scrubbing (L05)', () => {
  it('does not leak API keys or stacks on 500 responses', async () => {
    const app = express();
    app.get('/boom', (_req, _res, next) => {
      next(new Error('Upstream failed with key gsk-abcdefghijklmnopqrstuvwxyz123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abc'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toMatch(/gsk-/i);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJhbGci/i);
    expect(res.body.stack).toBeUndefined();
  });

  it('scrubs secrets from AppError messages returned to clients', async () => {
    const app = express();
    app.get('/app-error', (_req, _res, next) => {
      next(new AppError('TTS failed: api_key=sk-live-secretvalue123456', 502, 'TTS_FAILED'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/app-error');
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/\[redacted\]/i);
    expect(res.body.message).not.toMatch(/sk-live-secretvalue/i);
  });
});
