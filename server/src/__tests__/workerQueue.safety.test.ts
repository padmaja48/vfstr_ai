import * as aiCallGateway from '../services/aiCallGateway.service';
import * as aiService from '../services/ai.service';
import { getConceptGenerationQueue } from '../services/conceptGenerationQueue.service';

describe('worker and queue AI safety regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.env.AI_CALLS_ENABLED = 'false';
  });

  it('keeps AI_CALLS_ENABLED false in automated test process by default', () => {
    expect(aiCallGateway.isAiCallsEnabled()).toBe(false);
  });

  it('assertAiCallsEnabled throws when AI_CALLS_ENABLED is false', () => {
    process.env.AI_CALLS_ENABLED = 'false';
    expect(() => aiCallGateway.assertAiCallsEnabled('test_guard')).toThrow(
      aiCallGateway.AiCallsDisabledError,
    );
  });

  it('transcribeAudio returns a disabled message without calling OpenAI', async () => {
    process.env.AI_CALLS_ENABLED = 'false';
    const fetchMock = jest.fn();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await aiService.transcribeAudio({
        originalname: 'clip.webm',
        mimetype: 'audio/webm',
        buffer: Buffer.alloc(1024),
      } as Express.Multer.File);

      expect(result.text).toMatch(/AI calls are disabled/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('concept generation queue default job options use bounded retries', () => {
    const queue = getConceptGenerationQueue();
    const opts = queue.opts.defaultJobOptions;
    expect(opts?.attempts).toBe(2);
    expect(opts?.backoff).toEqual(expect.objectContaining({ type: 'exponential' }));
    expect((opts?.backoff as { delay?: number })?.delay).toBeGreaterThan(0);
  });

  it('does not reach OpenAI fetch when AI calls are disabled', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('should not reach fetch'));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    process.env.AI_CALLS_ENABLED = 'false';

    try {
      expect(() => aiCallGateway.assertAiCallsEnabled('network_guard_regression')).toThrow(
        aiCallGateway.AiCallsDisabledError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
