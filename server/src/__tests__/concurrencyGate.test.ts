import express from 'express';
import request from 'supertest';
import { concurrencyGate } from '../middleware/concurrencyGate';

const startPost = (app: express.Express) =>
  new Promise<request.Response>((resolve, reject) => {
    request(app)
      .post('/start')
      .end((err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
  });

describe('concurrencyGate (J01)', () => {
  it('admits queued work so 20 concurrent starts succeed ≥90% under light load', async () => {
    const app = express();
    // 16 running + 8 queued = 24 capacity → 20 parallel should all succeed.
    app.post(
      '/start',
      concurrencyGate({ maxConcurrent: 16, maxQueue: 8, retryAfterSeconds: 1 }),
      async (_req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        res.status(201).json({ ok: true });
      },
    );

    const results = await Promise.all(Array.from({ length: 20 }, () => startPost(app)));
    const successes = results.filter((r) => r.status === 201).length;
    const busy = results.filter((r) => r.status === 503 && r.body.retryable === true);

    expect(successes / 20).toBeGreaterThanOrEqual(0.9);
    expect(successes + busy.length).toBe(20);
  });

  it('returns retryable 503 with Retry-After when saturated', async () => {
    const app = express();
    let inHandler = 0;
    let releaseHeavy!: () => void;
    const heavyReady = new Promise<void>((resolve) => {
      releaseHeavy = resolve;
    });

    app.post(
      '/start',
      concurrencyGate({ maxConcurrent: 1, maxQueue: 0, retryAfterSeconds: 3 }),
      async (_req, res) => {
        inHandler += 1;
        await heavyReady;
        res.status(201).json({ ok: true });
      },
    );

    const firstPromise = startPost(app);

    const deadline = Date.now() + 2000;
    while (inHandler < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(inHandler).toBe(1);

    const overflow = await startPost(app);
    expect(overflow.status).toBe(503);
    expect(overflow.body.code).toBe('SERVICE_BUSY');
    expect(overflow.body.retryable).toBe(true);
    expect(overflow.headers['retry-after']).toBe('3');

    releaseHeavy();
    const first = await firstPromise;
    expect(first.status).toBe(201);
  }, 15_000);
});
