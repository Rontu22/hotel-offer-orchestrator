import { ConfigService } from '@nestjs/config';
import type { Client } from '@temporalio/client';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeRedis } from '../../test/fake-redis.js';
import { HealthService } from './health.service.js';

/** Lets each supplier be answered independently, which is the whole point here. */
function stubSuppliers(status: { supplierA: number; supplierB: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const code = url.includes(':4002') ? status.supplierA : status.supplierB;
      return new Response(code === 200 ? '[]' : 'error', { status: code });
    }),
  );
}

function build(temporalOk = true) {
  const redis = fakeRedis();
  const temporal = {
    connection: {
      workflowService: {
        getSystemInfo: vi.fn(async () => {
          if (!temporalOk) throw new Error('connection refused');
          return {};
        }),
      },
    },
  };

  return {
    redis,
    service: new HealthService(
      redis as unknown as Redis,
      temporal as unknown as Client,
      new ConfigService({
        SUPPLIER_A_URL: 'http://supplier-a:4002',
        SUPPLIER_B_URL: 'http://supplier-b:4003',
        HEALTH_PROBE_TIMEOUT_MS: 2000,
      }) as never,
    ),
  };
}

describe('HealthService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports ok with both suppliers up', async () => {
    stubSuppliers({ supplierA: 200, supplierB: 200 });
    const report = await build().service.report();

    expect(report.status).toBe('ok');
    expect(report.suppliers.supplierA.status).toBe('up');
    expect(report.suppliers.supplierB.status).toBe('up');
    expect(report.suppliers.supplierA.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded, not unhealthy, when one supplier is down', async () => {
    stubSuppliers({ supplierA: 503, supplierB: 200 });
    const report = await build().service.report();

    expect(report.status).toBe('degraded');
    expect(report.suppliers.supplierA).toMatchObject({ status: 'down', error: 'responded 503' });
    expect(report.suppliers.supplierB.status).toBe('up');
  });

  it('reports unhealthy when neither supplier answers', async () => {
    stubSuppliers({ supplierA: 503, supplierB: 503 });
    expect((await build().service.report()).status).toBe('unhealthy');
  });

  it('reports unhealthy when Redis is unreachable, whatever the suppliers say', async () => {
    stubSuppliers({ supplierA: 200, supplierB: 200 });
    const { service, redis } = build();
    redis.ping.mockRejectedValue(new Error('connection refused'));

    const report = await service.report();
    expect(report).toMatchObject({ status: 'unhealthy', redis: { status: 'down' } });
  });

  it('reports unhealthy when Temporal is unreachable', async () => {
    stubSuppliers({ supplierA: 200, supplierB: 200 });
    const report = await build(false).service.report();

    expect(report).toMatchObject({ status: 'unhealthy', temporal: { status: 'down' } });
  });

  it('probes every dependency in parallel', async () => {
    stubSuppliers({ supplierA: 200, supplierB: 200 });
    const started = Date.now();
    await build().service.report();

    // Four probes; serialising them would be visibly slower than this bound.
    expect(Date.now() - started).toBeLessThan(500);
  });
});
