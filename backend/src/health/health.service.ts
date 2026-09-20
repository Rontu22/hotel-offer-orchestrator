import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Client } from '@temporalio/client';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.tokens.js';
import { SUPPLIER_IDS, SUPPLIER_URL_ENV, type SupplierId } from '../suppliers/supplier.types.js';
import { TEMPORAL_CLIENT } from '../temporal/temporal.tokens.js';

export type Status = 'up' | 'down';

export interface Check {
  status: Status;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  /** ok: everything answered. degraded: one supplier is out. unhealthy: cannot serve. */
  status: 'ok' | 'degraded' | 'unhealthy';
  checkedAt: string;
  redis: Check;
  temporal: Check;
  suppliers: Record<SupplierId, Check>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Every dependency is probed in parallel so the endpoint stays fast. */
  async report(): Promise<HealthReport> {
    const [redis, temporal, ...suppliers] = await Promise.all([
      timed(() => this.redis.ping()),
      timed(() => this.temporal.connection.workflowService.getSystemInfo({})),
      ...SUPPLIER_IDS.map((id) => timed(() => this.probeSupplier(id))),
    ]);

    const supplierChecks = Object.fromEntries(
      SUPPLIER_IDS.map((id, index) => [id, suppliers[index]]),
    ) as Record<SupplierId, Check>;

    const downSuppliers = SUPPLIER_IDS.filter((id) => supplierChecks[id].status === 'down');
    const report: HealthReport = {
      status: this.overall(redis, temporal, downSuppliers.length),
      checkedAt: new Date().toISOString(),
      redis,
      temporal,
      suppliers: supplierChecks,
    };

    if (report.status !== 'ok') {
      this.logger.warn(`Health is ${report.status}`, JSON.stringify({ redis, temporal, supplierChecks }));
    }
    return report;
  }

  private overall(redis: Check, temporal: Check, suppliersDown: number): HealthReport['status'] {
    // Redis and Temporal are ours: without them no request can be served at all.
    if (redis.status === 'down' || temporal.status === 'down') return 'unhealthy';
    if (suppliersDown === SUPPLIER_IDS.length) return 'unhealthy';
    return suppliersDown > 0 ? 'degraded' : 'ok';
  }

  /** Probes the supplier service over HTTP, exactly the way the activity reaches it. */
  private async probeSupplier(supplier: SupplierId): Promise<void> {
    const base = this.config.get(SUPPLIER_URL_ENV[supplier], { infer: true });
    const response = await fetch(`${base}/hotels`, {
      signal: AbortSignal.timeout(this.config.get('HEALTH_PROBE_TIMEOUT_MS', { infer: true })),
    });
    if (!response.ok) throw new Error(`responded ${response.status}`);
    await response.arrayBuffer(); // drain, so the socket is released
  }
}

async function timed(probe: () => Promise<unknown>): Promise<Check> {
  const startedAt = Date.now();
  try {
    await probe();
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (cause) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
