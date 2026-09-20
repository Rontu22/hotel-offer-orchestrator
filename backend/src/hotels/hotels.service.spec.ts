import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Client } from '@temporalio/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheMeta } from './hotel.types.js';
import type { HotelsCache } from './hotels.cache.js';
import { HotelsService } from './hotels.service.js';

const offer = { name: 'Holtin', price: 5340, supplier: 'Supplier B' as const, commissionPct: 20 };
const meta = (over: Partial<CacheMeta> = {}): CacheMeta => ({
  count: 1,
  degraded: [],
  fetchedAt: '2026-09-20T00:00:00.000Z',
  ...over,
});

describe('HotelsService', () => {
  const execute = vi.fn(async (_name: string, _options: Record<string, unknown>) => ({
    offers: [offer],
    degraded: [] as never[],
  }));
  let cache: {
    meta: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    generation: ReturnType<typeof vi.fn>;
  };
  let service: HotelsService;

  beforeEach(() => {
    execute.mockClear();
    cache = {
      meta: vi.fn(async () => null),
      find: vi.fn(async () => [offer]),
      generation: vi.fn(async () => '0'),
    };
    service = new HotelsService(
      { workflow: { execute } } as unknown as Client,
      cache as unknown as HotelsCache,
      new ConfigService({ TEMPORAL_TASK_QUEUE: 'hotel-offers' }) as never,
    );
  });

  it('runs the workflow on a cache miss and serves the result from Redis', async () => {
    const result = await service.find({ city: 'delhi' });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1]).toMatchObject({
      taskQueue: 'hotel-offers',
      workflowId: 'hotel-offers:delhi:g0',
      args: [{ city: 'delhi' }],
    });
    expect(result).toEqual({ offers: [offer], cached: false, degraded: [] });
  });

  it('skips the workflow entirely when the city is already cached', async () => {
    cache.meta.mockResolvedValue(meta());

    expect(await service.find({ city: 'delhi' })).toEqual({
      offers: [offer],
      cached: true,
      degraded: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports the degraded suppliers the workflow saw', async () => {
    execute.mockResolvedValueOnce({ offers: [offer], degraded: ['Supplier A'] as never });

    expect((await service.find({ city: 'delhi' })).degraded).toEqual(['Supplier A']);
  });

  it('still reports degradation when the answer comes from cache', async () => {
    cache.meta.mockResolvedValue(meta({ degraded: ['Supplier B'] }));

    const result = await service.find({ city: 'delhi' });
    expect(result).toMatchObject({ cached: true, degraded: ['Supplier B'] });
    expect(execute).not.toHaveBeenCalled();
  });

  it('collapses concurrent requests for a city onto one workflow run', async () => {
    await service.find({ city: 'Delhi' });
    expect(execute.mock.calls[0][1]).toMatchObject({ workflowIdConflictPolicy: 'USE_EXISTING' });
  });

  it('passes the price range through to Redis', async () => {
    await service.find({ city: 'delhi', minPrice: 4000, maxPrice: 6000 });
    expect(cache.find).toHaveBeenCalledWith('delhi', { city: 'delhi', minPrice: 4000, maxPrice: 6000 });
  });

  it('answers 503 rather than 500 when the workflow cannot complete', async () => {
    execute.mockRejectedValueOnce(new Error('no supplier could be reached'));

    await expect(service.find({ city: 'delhi' })).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects an inverted price range before touching Temporal or Redis', async () => {
    await expect(service.find({ city: 'delhi', minPrice: 6000, maxPrice: 4000 })).rejects.toThrow(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(cache.meta).not.toHaveBeenCalled();
  });

  /**
   * Regression: flipping a supplier bumps the generation, so a request made
   * afterwards must not join — via USE_EXISTING — a run started before the flip.
   * Without the suffix both eras share `hotel-offers:delhi` and the second
   * request is handed offers read while the supplier was still up.
   */
  it('scopes the shared workflow run to one supplier-availability era', async () => {
    await service.find({ city: 'delhi' });
    expect(execute.mock.calls[0][1]).toMatchObject({
      workflowId: 'hotel-offers:delhi:g0',
      workflowIdConflictPolicy: 'USE_EXISTING',
    });

    // A supplier was switched off: invalidateAll advanced the counter.
    cache.generation.mockResolvedValue('1');
    await service.find({ city: 'delhi' });

    expect(execute.mock.calls[1][1]).toMatchObject({ workflowId: 'hotel-offers:delhi:g1' });
    expect(execute.mock.calls[1][1]).not.toMatchObject({ workflowId: 'hotel-offers:delhi:g0' });
  });
});
