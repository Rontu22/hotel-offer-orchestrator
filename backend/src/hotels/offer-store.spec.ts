import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotelOffer } from './hotel.types.js';
import { OfferStore } from './offer-store.js';

/** Just enough Redis to observe which commands the store issues. */
function fakeRedis() {
  const pipeline = {
    del: vi.fn(() => pipeline),
    zadd: vi.fn(() => pipeline),
    expire: vi.fn(() => pipeline),
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
  };
}

const offers: HotelOffer[] = [
  { name: 'Imperial Court', price: 3100, supplier: 'Supplier B', commissionPct: 22 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
];

describe('OfferStore', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let store: OfferStore;

  beforeEach(() => {
    redis = fakeRedis();
    store = new OfferStore(
      redis as unknown as Redis,
      new ConfigService({ OFFER_TTL_SECONDS: 300 }) as never,
    );
  });

  it('stores offers in a price-scored sorted set under a normalized key', async () => {
    await store.save(' Delhi ', offers);

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
    await store.save('delhi', offers);
    expect(redis.pipeline.del).toHaveBeenCalledWith('hotels:v1:delhi:offers');
  });

  it('writes no sorted set for a city with no offers', async () => {
    await store.save('atlantis', []);

    expect(redis.pipeline.del).toHaveBeenCalledWith('hotels:v1:atlantis:offers');
    expect(redis.pipeline.zadd).not.toHaveBeenCalled();
  });

  /** The whole point of the sorted set: Redis does the filtering, not us. */
  it('pushes the price range into Redis as score bounds', async () => {
    await store.find('delhi', { minPrice: 4000, maxPrice: 6000 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', 4000, 6000);
  });

  it('uses open bounds when a side of the range is omitted', async () => {
    await store.find('delhi', { minPrice: 4000 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', 4000, '+inf');

    await store.find('delhi', { maxPrice: 6000 });
    expect(redis.zrangebyscore).toHaveBeenCalledWith('hotels:v1:delhi:offers', '-inf', 6000);
  });

  it('reads offers back as objects', async () => {
    redis.zrangebyscore.mockResolvedValue(offers.map((offer) => JSON.stringify(offer)));
    expect(await store.find('delhi')).toEqual(offers);
  });
});

describe('OfferStore generation', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let store: OfferStore;

  beforeEach(() => {
    redis = fakeRedis();
    store = new OfferStore(
      redis as unknown as Redis,
      new ConfigService({ OFFER_TTL_SECONDS: 300 }) as never,
    );
  });

  it('starts at 0 and advances every time availability changes', async () => {
    expect(await store.generation()).toBe('0');

    await store.beginNewGeneration();
    expect(await store.generation()).toBe('1');

    await store.beginNewGeneration();
    expect(await store.generation()).toBe('2');
  });

  /** It must not sit under hotels:v1:*, which is the offer namespace. */
  it('keeps the counter clear of the offer key prefix', async () => {
    await store.beginNewGeneration();

    expect(redis.incr).toHaveBeenCalledWith('hotels:generation');
    expect([...redis.counters.keys()].some((key) => key.startsWith('hotels:v1:'))).toBe(false);
  });
});
