import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.tokens.js';
import type { HotelOffer, PriceRange } from './hotel.types.js';
import type { SupplierName } from '../suppliers/supplier.types.js';

/**
 * Outside the `hotels:v1:*` namespace on purpose, so a sweep of the offer keys
 * cannot delete the counter.
 */
const GENERATION_KEY = 'hotels:generation';

/**
 * Where the workflow's result lands so that Redis, not application code, does the
 * price filtering: offers go into a sorted set scored by price, and a range query
 * is a single ZRANGEBYSCORE.
 *
 * This is deliberately NOT a cache. Every request runs the workflow and writes a
 * fresh set; the TTL only stops abandoned keys accumulating. Returning a stored
 * result instead of orchestrating would make the prices as old as the TTL.
 */
@Injectable()
export class OfferStore {
  private readonly logger = new Logger(OfferStore.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private offersKey(city: string): string {
    return `hotels:v1:${normalizeCity(city)}:offers`;
  }

  /** Replaces this city's set with what the workflow just produced. */
  async save(city: string, offers: readonly HotelOffer[], degraded: SupplierName[] = []): Promise<void> {
    const ttl = this.config.get('OFFER_TTL_SECONDS', { infer: true });
    const pipeline = this.redis.multi().del(this.offersKey(city));

    if (offers.length > 0) {
      pipeline.zadd(
        this.offersKey(city),
        ...offers.flatMap((offer) => [offer.price, JSON.stringify(offer)] as const),
      );
      pipeline.expire(this.offersKey(city), ttl);
    }

    await pipeline.exec();
    this.logger.log(
      `Stored ${offers.length} offer(s) for "${normalizeCity(city)}"` +
        (degraded.length ? ` (degraded: ${degraded.join(', ')})` : ''),
    );
  }

  /** The price filter itself: executed by Redis, not by us. */
  async find(city: string, range: PriceRange = {}): Promise<HotelOffer[]> {
    const members = await this.redis.zrangebyscore(
      this.offersKey(city),
      range.minPrice ?? '-inf',
      range.maxPrice ?? '+inf',
    );
    return members.map((member) => JSON.parse(member) as HotelOffer);
  }

  /**
   * Identifies the current supplier-availability era. Concurrent requests for a
   * city still share one workflow run, so without this a request made after a
   * supplier was switched off could join a run that read it while it was up.
   */
  async generation(): Promise<string> {
    return (await this.redis.get(GENERATION_KEY)) ?? '0';
  }

  /** Called when supplier availability changes, closing the current era. */
  async beginNewGeneration(): Promise<number> {
    const generation = await this.redis.incr(GENERATION_KEY);
    this.logger.warn(`Supplier availability changed — generation is now ${generation}`);
    return generation;
  }
}

/** Cities are matched case-insensitively, so the key is the normalized form. */
export function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}
