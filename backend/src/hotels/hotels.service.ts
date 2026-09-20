import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Client } from '@temporalio/client';
import type { Env } from '../config/env.js';
import { TEMPORAL_CLIENT } from '../temporal/temporal.tokens.js';
import { AGGREGATE_HOTEL_OFFERS, type aggregateHotelOffers } from '../temporal/workflows.js';
import type { FindHotelsDto } from './dto/find-hotels.dto.js';
import type { AggregateResult, HotelOffer } from './hotel.types.js';
import type { SupplierName } from '../suppliers/supplier.types.js';
import { OfferStore, normalizeCity } from './offer-store.js';

export interface FindHotelsResult {
  offers: HotelOffer[];
  /** Suppliers that could not be reached, so the list may be incomplete. */
  degraded: SupplierName[];
}

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly offers: OfferStore,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async find(query: FindHotelsDto): Promise<FindHotelsResult> {
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      throw new BadRequestException('minPrice must not be greater than maxPrice');
    }

    // Every request orchestrates. Redis is the price filter, not a cache: handing
    // back a stored result would mean quoting prices as stale as its TTL.
    const { degraded } = await this.aggregate(query.city);

    // Filtering happens in Redis (ZRANGEBYSCORE), not here.
    const offers = await this.offers.find(query.city, query);
    return { offers, degraded };
  }

  /**
   * Runs the Temporal workflow; concurrent requests for a city share one run.
   * The generation suffix scopes that sharing to one supplier-availability era:
   * without it, USE_EXISTING would hand a request made after a supplier was
   * switched off the result of a run that read that supplier while it was up.
   */
  private async aggregate(city: string): Promise<AggregateResult> {
    const generation = await this.offers.generation();
    const workflowId = `hotel-offers:${normalizeCity(city)}:g${generation}`;
    this.logger.log(`Orchestrating "${city}" — workflow ${workflowId}`);

    try {
      return await this.temporal.workflow.execute<typeof aggregateHotelOffers>(AGGREGATE_HOTEL_OFFERS, {
        taskQueue: this.config.get('TEMPORAL_TASK_QUEUE', { infer: true }),
        workflowId,
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowExecutionTimeout: '2 minutes',
        args: [{ city }],
      });
    } catch (cause) {
      // A dead worker or both suppliers down is upstream trouble, not a bug here.
      this.logger.error(`Workflow ${workflowId} failed`, cause instanceof Error ? cause.stack : cause);
      throw new ServiceUnavailableException('Hotel offers are temporarily unavailable', { cause });
    }
  }
}
