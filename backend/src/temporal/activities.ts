import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, log } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type { Env } from '../config/env.js';
import { HotelsCache } from '../hotels/hotels.cache.js';
import type { HotelOffer } from '../hotels/hotel.types.js';
import { SUPPLIER_URL_ENV, type SupplierHotel, type SupplierId, type SupplierName } from '../suppliers/supplier.types.js';

/** The activity surface the workflow is allowed to call. */
export interface Activities {
  fetchSupplierA(city: string): Promise<SupplierHotel[]>;
  fetchSupplierB(city: string): Promise<SupplierHotel[]>;
  cacheOffers(city: string, offers: HotelOffer[], degraded: SupplierName[]): Promise<void>;
}

@Injectable()
export class HotelActivities implements Activities {
  private readonly logger = new Logger(HotelActivities.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly cache: HotelsCache,
  ) {}

  fetchSupplierA(city: string): Promise<SupplierHotel[]> {
    return this.fetchSupplier('supplierA', city);
  }

  fetchSupplierB(city: string): Promise<SupplierHotel[]> {
    return this.fetchSupplier('supplierB', city);
  }

  async cacheOffers(city: string, offers: HotelOffer[], degraded: SupplierName[] = []): Promise<void> {
    try {
      await this.cache.save(city, offers, degraded);
    } catch (cause) {
      // Redis being briefly unreachable is worth another attempt, not a dead workflow.
      this.logger.error(`Caching offers for "${city}" failed`, stackOf(cause));
      throw ApplicationFailure.retryable(`Could not cache offers: ${messageOf(cause)}`, 'CacheWriteFailed');
    }
  }

  /**
   * Real HTTP call, so supplier flakiness is retried by Temporal rather than by us.
   * 4xx means we asked wrong and a retry cannot help; 5xx, timeouts and connection
   * errors are transient and retryable.
   */
  private async fetchSupplier(supplier: SupplierId, city: string): Promise<SupplierHotel[]> {
    const base = this.config.get(SUPPLIER_URL_ENV[supplier], { infer: true });
    const url = `${base}/hotels?city=${encodeURIComponent(city)}`;
    const { attempt } = Context.current().info;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch (cause) {
      log.warn('Supplier request failed', { supplier, city, attempt, error: messageOf(cause) });
      throw ApplicationFailure.retryable(
        `${supplier} unreachable: ${messageOf(cause)}`,
        'SupplierUnreachable',
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      log.warn('Supplier responded with an error', { supplier, city, attempt, status: response.status });

      throw retryable
        ? ApplicationFailure.retryable(`${supplier} responded ${response.status}`, 'SupplierUnavailable')
        : ApplicationFailure.nonRetryable(`${supplier} rejected the request (${response.status})`, 'SupplierBadRequest');
    }

    const hotels = (await response.json()) as SupplierHotel[];
    log.info('Supplier responded', {
      supplier,
      city,
      attempt,
      hotels: hotels.length,
      ms: Date.now() - startedAt,
    });
    return hotels;
  }
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const stackOf = (cause: unknown): string | undefined => (cause instanceof Error ? cause.stack : undefined);

/** Temporal wants plain functions; DI wants a class. This is the seam. */
export function bindActivities(impl: Activities): Activities {
  return {
    fetchSupplierA: (city) => impl.fetchSupplierA(city),
    fetchSupplierB: (city) => impl.fetchSupplierB(city),
    cacheOffers: (city, offers, degraded) => impl.cacheOffers(city, offers, degraded),
  };
}
