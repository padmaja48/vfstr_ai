export const createRedisMock = () => {
  const store = new Map<string, Record<string, string>>();
  const stringStore = new Map<string, string>();

  return {
    getRedis: () => ({
      hgetall: async (key: string) => store.get(key) || {},
      hset: async (key: string, data: Record<string, string>) => {
        store.set(key, { ...(store.get(key) || {}), ...data });
      },
      expire: async () => undefined,
      get: async (key: string) => stringStore.get(key) ?? null,
      set: async (key: string, value: string) => {
        stringStore.set(key, value);
      },
      del: async (key: string) => {
        store.delete(key);
        stringStore.delete(key);
      },
    }),
    isMemoryRedis: () => true,
    getQueueRedis: () => ({
      hgetall: async (key: string) => store.get(key) || {},
      hset: async (key: string, data: Record<string, string>) => {
        store.set(key, { ...(store.get(key) || {}), ...data });
      },
      expire: async () => undefined,
      get: async (key: string) => stringStore.get(key) ?? null,
      set: async (key: string, value: string) => {
        stringStore.set(key, value);
      },
      del: async (key: string) => {
        store.delete(key);
        stringStore.delete(key);
      },
    }),
  };
};
