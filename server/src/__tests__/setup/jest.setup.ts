/**
 * Global Jest setup — runs in the test runner process only.
 * Does not affect manual scripts (prewarm, concept generation CLI, etc.).
 */

process.env.NODE_ENV = 'test';

if (process.env.AI_CALLS_ENABLED === undefined) {
  process.env.AI_CALLS_ENABLED = 'false';
}

export const OPENAI_NETWORK_GUARD_PREFIX = '[OPENAI_NETWORK_GUARD]';

const isBlockedOpenAiUrl = (urlString: string): boolean => {
  try {
    const url = new URL(urlString);
    if (url.hostname === 'api.openai.com' || url.hostname.endsWith('.openai.com')) {
      return true;
    }
    const configuredBase = process.env.OPENAI_BASE_URL?.trim();
    if (configuredBase) {
      const configured = new URL(configuredBase);
      if (url.hostname === configured.hostname) {
        return true;
      }
    }
  } catch {
    if (/api\.openai\.com/i.test(urlString)) return true;
  }
  return false;
};

const originalFetch = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : undefined;

if (originalFetch) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    if (isBlockedOpenAiUrl(url)) {
      const error = new Error(
        `${OPENAI_NETWORK_GUARD_PREFIX} Blocked outbound OpenAI request in automated tests.\n`
        + `URL: ${url}\n`
        + `Method: ${init?.method ?? 'GET'}\n`
        + `Stack:\n${new Error().stack ?? 'n/a'}`,
      );
      error.name = 'OpenAiNetworkGuardError';
      throw error;
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
