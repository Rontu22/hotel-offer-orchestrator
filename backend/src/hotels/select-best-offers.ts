import type { SupplierHotel, SupplierName } from '../suppliers/supplier.types.js';
import type { HotelOffer } from './hotel.types.js';

export interface SupplierFeed {
  supplier: SupplierName;
  hotels: readonly SupplierHotel[];
}

export interface SupplierAttempt {
  supplier: SupplierName;
  result: PromiseSettledResult<SupplierHotel[]>;
}

export interface Partitioned {
  feeds: SupplierFeed[];
  degraded: SupplierName[];
  failures: { supplier: SupplierName; reason: string }[];
}

/**
 * Splits settled supplier calls into usable feeds and failures. Pure, so the
 * workflow's degradation policy is testable without a Temporal test server.
 */
export function partitionFeeds(attempts: readonly SupplierAttempt[]): Partitioned {
  const partitioned: Partitioned = { feeds: [], degraded: [], failures: [] };

  for (const { supplier, result } of attempts) {
    if (result.status === 'fulfilled') {
      partitioned.feeds.push({ supplier, hotels: result.value });
    } else {
      partitioned.degraded.push(supplier);
      partitioned.failures.push({ supplier, reason: describe(result.reason) });
    }
  }

  return partitioned;
}

/**
 * Temporal wraps an activity error in an ActivityFailure whose own message is just
 * "Activity task failed", so walk to the innermost cause for the real reason.
 */
function describe(reason: unknown): string {
  if (!(reason instanceof Error)) return typeof reason === 'string' ? reason : JSON.stringify(reason);

  let error: Error = reason;
  const seen = new Set<Error>([error]);
  while (error.cause instanceof Error && !seen.has(error.cause)) {
    error = error.cause;
    seen.add(error);
  }
  return error.message;
}

/**
 * Dedupe by hotel name and keep the cheapest offer. Ties keep the first feed in
 * argument order, so the result is stable regardless of which supplier replied
 * first. Names are matched case-insensitively but reported as given.
 */
export function selectBestOffers(feeds: readonly SupplierFeed[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();

  for (const { supplier, hotels } of feeds) {
    for (const hotel of hotels) {
      const key = hotel.name.trim().toLowerCase();
      const current = best.get(key);
      if (current && current.price <= hotel.price) continue;
      best.set(key, {
        name: hotel.name.trim(),
        price: hotel.price,
        supplier,
        commissionPct: hotel.commissionPct,
      });
    }
  }

  return [...best.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
