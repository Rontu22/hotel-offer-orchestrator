import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.tokens.js';
import type { CacheMeta, HotelOffer, PriceRange } from './hotel.types.js';
import type { SupplierName } from '../suppliers/supplier.types.js';

/** A partial result should not linger: recovery must be picked up quickly. */
const DEGRADED_TTL_SECONDS = 30;

/**
 * Outside the `hotels:v1:*` namespace on purpose, so invalidateAll's own SCAN
 * does not delete the counter it just incremented.
 */
const GENERATION_KEY = 'hotels:generation';

/**
 * Offers live in a sorted set scored by price, so price-range filtering is a
 * single ZRANGEBYSCORE inside Redis rather than a filter in application code.
 * A sibling metadata key carries the TTL, tells "not cached" apart from "cached,
 * and this city genuinely has no hotels", and remembers which suppliers failed.
 */
@Injectable()
export class HotelsCache {
  private readonly logger = new Logger(HotelsCache.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private offersKey(city: string): string {
    return `hotels:v1:${normalizeCity(city)}:offers`;
  }

  private metaKey(city: string): string {
    return `hotels:v1:${normalizeCity(city)}:meta`;
  }

  /** Returns the cache metadata, or null when this city has not been aggregated. */
  async meta(city: string): Promise<CacheMeta | null> {
    const raw = await this.redis.get(this.metaKey(city));
    return raw ? (JSON.parse(raw) as CacheMeta) : null;
  }

  async save(city: string, offers: readonly HotelOffer[], degraded: SupplierName[] = []): Promise<void> {
    const ttl = degraded.length
      ? Math.min(this.config.get('CACHE_TTL_SECONDS', { infer: true }), DEGRADED_TTL_SECONDS)
      : this.config.get('CACHE_TTL_SECONDS', { infer: true });

    const meta: CacheMeta = { count: offers.length, degraded, fetchedAt: new Date().toISOString() };
    const pipeline = this.redis.multi().del(this.offersKey(city));

    if (offers.length > 0) {
      pipeline.zadd(
        this.offersKey(city),
        ...offers.flatMap((offer) => [offer.price, JSON.stringify(offer)] as const),
      );
      pipeline.expire(this.offersKey(city), ttl);
    }
    pipeline.set(this.metaKey(city), JSON.stringify(meta), 'EX', ttl);

    await pipeline.exec();
    this.logger.log(
      `Cached ${offers.length} offer(s) for "${normalizeCity(city)}" for ${ttl}s` +
        (degraded.length ? ` (degraded: ${degraded.join(', ')})` : ''),
    );
  }

  /** Reads the cached list back, price-filtered by Redis itself. */
  async find(city: string, range: PriceRange = {}): Promise<HotelOffer[]> {
    const members = await this.redis.zrangebyscore(
      this.offersKey(city),
      range.minPrice ?? '-inf',
      range.maxPrice ?? '+inf',
    );
    return members.map((member) => JSON.parse(member) as HotelOffer);
  }

  /** Called when supplier availability changes, which invalidates every aggregate. */
  /**
   * Identifies the current supplier-availability era. It changes whenever the
   * cache is dropped, which is what stops a workflow run started before a
   * supplier was switched off from being reused by a request made after it.
   */
  async generation(): Promise<string> {
    return (await this.redis.get(GENERATION_KEY)) ?? '0';
  }

  async invalidateAll(): Promise<number> {
    // Bump first: a run started from here on belongs to the new era, and a
    // duplicate bump is harmless where a missed one would serve stale offers.
    const generation = await this.redis.incr(GENERATION_KEY);

    let cursor = '0';
    let removed = 0;

    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'hotels:v1:*', 'COUNT', 250);
      cursor = next;
      if (keys.length) removed += await this.redis.unlink(...keys);
    } while (cursor !== '0');

    this.logger.warn(`Invalidated ${removed} cache key(s), generation is now ${generation}`);
    return removed;
  }
}

export function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}
