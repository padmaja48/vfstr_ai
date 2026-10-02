import { OPENAI_NETWORK_GUARD_PREFIX } from './setup/jest.setup';

describe('global OpenAI network guard', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('defaults AI_CALLS_ENABLED to false in the test runner', () => {
    expect(process.env.AI_CALLS_ENABLED).toBe('false');
  });

  it('blocks fetch to api.openai.com with a descriptive error', async () => {
    await expect(
      fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' }),
    ).rejects.toMatchObject({
      name: 'OpenAiNetworkGuardError',
      message: expect.stringContaining(OPENAI_NETWORK_GUARD_PREFIX),
    });

    try {
      await fetch('https://api.openai.com/v1/responses', { method: 'POST' });
      throw new Error('expected guard to throw');
    } catch (error) {
      const err = error as Error;
      expect(err.message).toContain('https://api.openai.com/v1/responses');
      expect(err.message).toContain('Method: POST');
      expect(err.message).toContain('Stack:');
    }
  });

  it('blocks fetch to a custom OPENAI_BASE_URL host', async () => {
    const previous = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'https://proxy.example.test/v1';

    try {
      await expect(
        fetch('https://proxy.example.test/v1/chat/completions'),
      ).rejects.toMatchObject({ name: 'OpenAiNetworkGuardError' });
    } finally {
      if (previous === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previous;
    }
  });

  it('allows non-OpenAI outbound fetch', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;

    const response = await fetch('https://example.com/health');
    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/health');
  });
});
