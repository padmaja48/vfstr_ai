type StoredValue = {
  value: string | Record<string, string>;
  expiresAt?: number;
};

export class MemoryRedis {
  private store = new Map<string, StoredValue>();

  on() {
    return this;
  }

  private read(key: string) {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return item;
  }

  async hset(key: string, value: Record<string, string>) {
    this.store.set(key, { value });
    return 1;
  }

  async hgetall(key: string) {
    const item = this.read(key);
    return typeof item?.value === 'object' ? item.value : {};
  }

  async expire(key: string, seconds: number) {
    const item = this.read(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async get(key: string) {
    const item = this.read(key);
    return typeof item?.value === 'string' ? item.value : null;
  }

  async set(key: string, value: string, mode?: string, seconds?: number) {
    this.store.set(key, {
      value,
      expiresAt: mode === 'EX' && seconds ? Date.now() + seconds * 1000 : undefined,
    });
    return 'OK';
  }

  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }

  async quit() {
    this.store.clear();
    return 'OK';
  }
}
