import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotelOffer } from './hotel.types.js';
import { HotelsCache } from './hotels.cache.js';

/** Just enough Redis to observe which commands the cache issues. */
function fakeRedis() {
  const pipeline = {
    del: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
    set: vi.fn((_key: string, _value: string, _mode: 'EX', _ttl: number) => pipeline),
    exec: vi.fn(async () => []),
  };
  const counters = new Map<string, number>();
  return {
    pipeline,
    counters,
    get: vi.fn(async (key: string): Promise<string | null> =>
      counters.has(key) ? String(counters.get(key)) : null,
    ),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    multi: vi.fn(() => pipeline),
    zrangebyscore: vi.fn(async () => [] as string[]),
    scan: vi.fn(async () => ['0', [] as string[]] as [string, string[]]),
    unlink: vi.fn(async (...keys: string[]) => keys.length),
  };
}

const offers: HotelOffer[] = [
  { name: 'Imperial Court', price: 3100, supplier: 'Supplier B', commissionPct: 22 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
];

describe('HotelsCache', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let cache: HotelsCache;

  beforeEach(() => {
    redis = fakeRedis();
    cache = new HotelsCache(
      redis as unknown as Redis,
      new ConfigService({ CACHE_TTL_SECONDS: 300 }) as never,
    );
  });

  it('stores offers in a price-scored sorted set under a normalized key', async () => {
    await cache.save(' Delhi ', offers);

    expect(redis.pipeline.zadd).toHaveBeenCalledWith(
      'hotels:v1:delhi:offers',
      3100,
      JSON.stringify(offers[0]),
      5340,
      JSON.stringify(offers[1]),
    );
    expect(redis.pipeline.expire).toHaveBeenCalledWith('hotels:v1:delhi:offers', 300);
  });

  it('replaces the previous list instead of merging into it', async () => {
    await cache.save('delhi', offers);
    expect(redis.pipeline.del).toHaveBeenCalledWith('hotels:v1:delhi:offers');
  });

  it('marks an empty city as cached without writing an empty sorted set', async () => {
    await cache.save('atlantis', []);

    expect(redis.pipeline.zadd).not.toHaveBeenCalled();
    const [key, raw, , ttl] = redis.pipeline.set.mock.calls[0];
    expect(key).toBe('hotels:v1:atlantis:meta');
    expect(JSON.parse(raw)).toMatchObject({ count: 0, degraded: [] });
    expect(ttl).toBe(300);
  });

  it('records which suppliers failed, and expires a degraded result sooner', async () => {
    await cache.save('delhi', offers, ['Supplier A']);

    const [, raw, , ttl] = redis.pipeline.set.mock.calls[0];
    expect(JSON.parse(raw)).toMatchObject({ count: 2, degraded: ['Supplier A'] });
    expect(ttl).toBe(30); // shorter, so recovery is picked up quickly
    expect(redis.pipeline.expire).toHaveBeenCalledWith('hotels:v1:delhi:offers', 30);
  });

  it('pushes the price range into Redis as score bounds', async () => {
    await cache.find('delhi', { minPrice: 4000, maxPrice: 6000 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', 4000, 6000);
  });

  it('uses open bounds when a side of the range is omitted', async () => {
    await cache.find('delhi', { minPrice: 4000 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', 4000, '+inf');

    await cache.find('delhi', {});
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', '-inf', '+inf');
  });

  it('reads offers back as objects', async () => {
    redis.zrangebyscore.mockResolvedValue(offers.map((o) => JSON.stringify(o)));
    expect(await cache.find('delhi')).toEqual(offers);
  });

  it('reports no metadata for a city that was never aggregated', async () => {
    expect(await cache.meta('delhi')).toBeNull();
  });

  it('reads the metadata back so a cache hit can still report degradation', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ count: 2, degraded: ['Supplier B'], fetchedAt: '2026-09-20T00:00:00.000Z' }),
    );

    expect(await cache.meta(' Delhi ')).toEqual({
      count: 2,
      degraded: ['Supplier B'],
      fetchedAt: '2026-09-20T00:00:00.000Z',
    });
    expect(redis.get).toHaveBeenCalledWith('hotels:v1:delhi:meta');
  });

  it('invalidates every cached city by scanning the key prefix', async () => {
    redis.scan.mockResolvedValue(['0', ['hotels:v1:delhi:offers', 'hotels:v1:delhi:meta']]);

    expect(await cache.invalidateAll()).toBe(2);
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'hotels:v1:*', 'COUNT', 250);
    expect(redis.unlink).toHaveBeenCalledWith('hotels:v1:delhi:offers', 'hotels:v1:delhi:meta');
  });
});

describe('HotelsCache generation', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let cache: HotelsCache;

  beforeEach(() => {
    redis = fakeRedis();
    cache = new HotelsCache(
      redis as unknown as Redis,
      new ConfigService({ CACHE_TTL_SECONDS: 300 }) as never,
    );
  });

  it('starts at 0 and advances on every invalidation', async () => {
    expect(await cache.generation()).toBe('0');

    await cache.invalidateAll();
    expect(await cache.generation()).toBe('1');

    await cache.invalidateAll();
    expect(await cache.generation()).toBe('2');
  });

  /**
   * The counter must live outside hotels:v1:*, or invalidateAll's own SCAN would
   * delete it and every era would look like era 0 again.
   */
  it('keeps the counter clear of the key prefix it sweeps', async () => {
    await cache.invalidateAll();

    expect(redis.incr).toHaveBeenCalledWith('hotels:generation');
    expect([...redis.counters.keys()].some((key) => key.startsWith('hotels:v1:'))).toBe(false);
  });
});
