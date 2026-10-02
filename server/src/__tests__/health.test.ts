import request from 'supertest';
import { createApp } from '../app';

describe('health endpoint', () => {
  it('returns service health with capability flags', async () => {
    const response = await request(createApp()).get('/api/health');

    // 200 when Mongo is up in CI/dev; 503 when disconnected — both are valid shapes.
    expect([200, 503]).toContain(response.status);
    expect(response.body.service).toBe('fluentai-interview');
    expect(['ok', 'degraded']).toContain(response.body.status);
    expect(response.body).toHaveProperty('mongodb');
    expect(response.body.capabilities).toEqual(
      expect.objectContaining({
        llm: expect.any(Boolean),
        tts: expect.any(Boolean),
        stt: expect.any(Boolean),
      }),
    );
    expect(Array.isArray(response.body.warnings)).toBe(true);
  });
});
