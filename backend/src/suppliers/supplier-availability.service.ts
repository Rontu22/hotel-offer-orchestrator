import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SUPPLIER_IDS, SUPPLIER_URL_ENV, type SupplierId } from './supplier.types.js';

/**
 * Runtime kill switch per supplier, used to exercise the "one supplier is down"
 * path without restarting anything. The switch lives in the supplier service
 * itself — we ask it to go down, the same way a real outage happens over there
 * rather than in our own state.
 */
@Injectable()
export class SupplierAvailabilityService {
  private static readonly TIMEOUT_MS = 3_000;
  private readonly logger = new Logger(SupplierAvailabilityService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async list(): Promise<Record<SupplierId, boolean>> {
    const entries = await Promise.all(
      SUPPLIER_IDS.map(async (id) => [id, await this.isAvailable(id)] as const),
    );
    return Object.fromEntries(entries) as Record<SupplierId, boolean>;
  }

  /** An unreachable supplier is a supplier that is down, not an error to report. */
  async isAvailable(supplier: SupplierId): Promise<boolean> {
    try {
      const body = (await this.admin(supplier, { method: 'GET' })) as { available?: boolean };
      return body.available === true;
    } catch (cause) {
      this.logger.warn(`Could not read ${supplier} availability: ${messageOf(cause)}`);
      return false;
    }
  }

  async set(supplier: SupplierId, available: boolean): Promise<void> {
    try {
      await this.admin(supplier, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ available }),
      });
    } catch (cause) {
      // The operator asked for a change we could not make; saying "done" would lie.
      throw new ServiceUnavailableException(`Could not reach ${supplier}: ${messageOf(cause)}`);
    }
    this.logger.warn(`${supplier} marked ${available ? 'AVAILABLE' : 'DOWN'}`);
  }

  private async admin(supplier: SupplierId, init: RequestInit): Promise<unknown> {
    const base = this.config.get(SUPPLIER_URL_ENV[supplier], { infer: true });
    const response = await fetch(`${base}/admin/availability`, {
      ...init,
      signal: AbortSignal.timeout(SupplierAvailabilityService.TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`responded ${response.status}`);
    return response.json();
  }
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
