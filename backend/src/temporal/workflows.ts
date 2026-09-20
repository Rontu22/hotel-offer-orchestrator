import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import type { AggregateResult } from '../hotels/hotel.types.js';
import { partitionFeeds, selectBestOffers } from '../hotels/select-best-offers.js';
import type { Activities } from './activities.js';

const { fetchSupplierA, fetchSupplierB, cacheOffers } = proxyActivities<Activities>({
  // Generous enough to survive a stalled small instance; a genuinely dead supplier
  // is still detected in one attempt, because it refuses the connection outright.
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '200ms', maximumAttempts: 3 },
});

export const AGGREGATE_HOTEL_OFFERS = 'aggregateHotelOffers';

/**
 * Fan out to both suppliers in parallel, keep the cheapest offer per hotel name,
 * then hand the deduplicated list to Redis for price-range queries.
 *
 * One supplier failing is a degraded result, not a failed one: allSettled lets the
 * survivor's hotels through, which is also what the "only one supplier returned
 * this hotel" rule requires. Only a total outage fails the workflow.
 */
export async function aggregateHotelOffers(input: { city: string }): Promise<AggregateResult> {
  log.info('Aggregating hotel offers', { city: input.city });

  const [a, b] = await Promise.allSettled([fetchSupplierA(input.city), fetchSupplierB(input.city)]);
  const { feeds, degraded, failures } = partitionFeeds([
    { supplier: 'Supplier A', result: a },
    { supplier: 'Supplier B', result: b },
  ]);

  for (const failure of failures) {
    log.warn('Supplier unavailable after retries, continuing without it', failure);
  }

  if (feeds.length === 0) {
    // Nothing to compare and nothing to cache; surfaces to the API as a 503.
    throw ApplicationFailure.nonRetryable(
      `No supplier could be reached: ${failures.map((f) => `${f.supplier} (${f.reason})`).join('; ')}`,
      'AllSuppliersUnavailable',
    );
  }

  const offers = selectBestOffers(feeds);
  await cacheOffers(input.city, offers, degraded);

  log.info('Aggregation complete', { city: input.city, offers: offers.length, degraded });
  return { offers, degraded };
}
