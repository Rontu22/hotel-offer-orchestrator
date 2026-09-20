import { vi } from 'vitest';

type Entry = { value: string } | { zset: Map<string, number> };

/**
 * In-memory stand-in for the handful of Redis commands this service uses, with
 * real semantics (score ordering, ±inf bounds, SCAN cursors). It lets the module
 * tests exercise the actual cache logic without Docker; the e2e suite is what
 * proves the same code works against a real Redis.
 */
export function fakeRedis() {
  const store = new Map<string, Entry>();

  const zsetOf = (key: string): Map<string, number> => {
    const existing = store.get(key);
    if (existing && 'zset' in existing) return existing.zset;
    const zset = new Map<string, number>();
    store.set(key, { zset });
    return zset;
  };

  const bound = (raw: number | string, fallback: number): number => {
    if (raw === '-inf') return -Infinity;
    if (raw === '+inf') return Infinity;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const redis = {
    store,
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),

    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry && 'value' in entry ? entry.value : null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, { value: String(value) });
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
    unlink: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    incr: vi.fn(async (key: string) => {
      const entry = store.get(key);
      const next = (entry && 'value' in entry ? Number(entry.value) : 0) + 1;
      store.set(key, { value: String(next) });
      return next;
    }),
    expire: vi.fn(async () => 1),

    zadd: vi.fn(async (key: string, ...args: (string | number)[]) => {
      const zset = zsetOf(key);
      for (let i = 0; i < args.length; i += 2) zset.set(String(args[i + 1]), Number(args[i]));
      return zset.size;
    }),
    zrangebyscore: vi.fn(async (key: string, min: number | string, max: number | string) => {
      const entry = store.get(key);
      if (!entry || !('zset' in entry)) return [];
      const [lo, hi] = [bound(min, -Infinity), bound(max, Infinity)];
      return [...entry.zset.entries()]
        .filter(([, score]) => score >= lo && score <= hi)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    }),

    scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return ['0', [...store.keys()].filter((key) => regex.test(key))] as [string, string[]];
    }),

    // Commands are applied eagerly; exec() only settles the chain.
    multi: vi.fn(() => {
      const chain = {
        del: (...keys: string[]) => (keys.forEach((key) => store.delete(key)), chain),
        zadd: (key: string, ...args: (string | number)[]) => {
          const zset = zsetOf(key);
          for (let i = 0; i < args.length; i += 2) zset.set(String(args[i + 1]), Number(args[i]));
          return chain;
        },
        expire: () => chain,
        set: (key: string, value: string) => (store.set(key, { value: String(value) }), chain),
        exec: async () => [],
      };
      return chain;
    }),
  };

  return redis;
}

export type FakeRedis = ReturnType<typeof fakeRedis>;
