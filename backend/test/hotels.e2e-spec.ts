import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HotelOffer } from '../src/hotels/hotel.types.js';
import type { SupplierHotel } from '../src/suppliers/supplier.types.js';

/**
 * Runs against the composed stack (API + worker + Temporal + Redis + the two
 * supplier services and their Postgres databases):
 *   cd infra && docker compose up -d --build
 *   npm run test:e2e
 * It exercises the real workflow, so it is the only check that proves the
 * suppliers, Temporal and Redis are actually wired together.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
/** The suppliers are their own services now, reached directly on their own ports. */
const SUPPLIER_BASE: Record<string, string> = {
  supplierA: process.env.E2E_SUPPLIER_A_URL ?? 'http://localhost:4002',
  supplierB: process.env.E2E_SUPPLIER_B_URL ?? 'http://localhost:4003',
};
const CITY = 'delhi';

const get = async <T>(
  path: string,
  base = BASE,
): Promise<{ status: number; body: T; cache: string | null; degraded: string | null }> => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(60_000) });
  return {
    status: response.status,
    body: (await response.json()) as T,
    cache: response.headers.get('x-cache'),
    degraded: response.headers.get('x-degraded-suppliers'),
  };
};

const setAvailable = async (supplier: string, available: boolean): Promise<void> => {
  const response = await fetch(`${BASE}/api/suppliers/${supplier}/availability`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ available }),
  });
  if (!response.ok) throw new Error(`Could not set ${supplier}: ${response.status}`);
};

describe('hotel offers end to end', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health?.ok) throw new Error(`Stack not reachable at ${BASE}. Start it with docker compose up -d.`);
  }, 30_000);

  afterAll(async () => {
    // Never leave a supplier switched off for the next run.
    await Promise.all([setAvailable('supplierA', true), setAvailable('supplierB', true)]);
  });

  it('serves both supplier services from their own databases, with overlapping names', async () => {
    const [a, b] = await Promise.all([
      get<SupplierHotel[]>(`/hotels?city=${CITY}`, SUPPLIER_BASE.supplierA),
      get<SupplierHotel[]>(`/hotels?city=${CITY}`, SUPPLIER_BASE.supplierB),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const namesB = new Set(b.body.map((h) => h.name));
    expect(a.body.some((h) => namesB.has(h.name))).toBe(true);
  });

  it('returns one deduplicated, cheapest-wins offer per hotel name', async () => {
    const { status, body } = await get<HotelOffer[]>(`/api/hotels?city=${CITY}`);
    expect(status).toBe(200);

    const names = body.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);

    const holtin = body.find((o) => o.name === 'Holtin');
    expect(holtin).toEqual({ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 });

    const oberon = body.find((o) => o.name === 'Oberon');
    expect(oberon?.supplier).toBe('Supplier A'); // tie broken deterministically

    expect(body.some((o) => o.supplier === 'Supplier A')).toBe(true);
    expect(body.some((o) => o.supplier === 'Supplier B')).toBe(true);
  }, 60_000);

  it('serves the second identical request from the Redis cache', async () => {
    const { cache, body } = await get<HotelOffer[]>(`/api/hotels?city=${CITY}`);
    expect(cache).toBe('HIT');
    expect(body.length).toBeGreaterThan(0);
  });

  it('filters by price range inside Redis', async () => {
    const all = await get<HotelOffer[]>(`/api/hotels?city=${CITY}`);
    const filtered = await get<HotelOffer[]>(`/api/hotels?city=${CITY}&minPrice=4000&maxPrice=6000`);

    expect(filtered.body.every((o) => o.price >= 4000 && o.price <= 6000)).toBe(true);
    expect(filtered.body.length).toBeLessThan(all.body.length);
    expect(filtered.body.length).toBeGreaterThan(0);
  });

  it('treats the price bounds as inclusive', async () => {
    const { body } = await get<HotelOffer[]>(`/api/hotels?city=${CITY}&minPrice=5340&maxPrice=5340`);
    expect(body.map((o) => o.name)).toContain('Holtin');
  });

  it('rejects malformed queries with 400', async () => {
    expect((await get(`/api/hotels`)).status).toBe(400);
    expect((await get(`/api/hotels?city=${CITY}&minPrice=abc`)).status).toBe(400);
    expect((await get(`/api/hotels?city=${CITY}&minPrice=9000&maxPrice=100`)).status).toBe(400);
  });

  it('returns an empty list for a city no supplier covers', async () => {
    const { status, body } = await get<HotelOffer[]>('/api/hotels?city=atlantis');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  }, 60_000);

  describe('health', () => {
    it('reports Redis, Temporal and both suppliers', async () => {
      const { status, body } = await get<Record<string, never>>('/health');

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'ok',
        redis: { status: 'up' },
        temporal: { status: 'up' },
        suppliers: { supplierA: { status: 'up' }, supplierB: { status: 'up' } },
      });
    });

    it('keeps liveness independent of dependencies', async () => {
      expect(await get('/health/live')).toMatchObject({ status: 200, body: { status: 'ok' } });
    });
  });

  describe('with one supplier down', () => {
    beforeAll(() => setAvailable('supplierA', false));
    afterAll(() => setAvailable('supplierA', true));

    it('makes that supplier answer 503 and leaves the other alone', async () => {
      expect((await get(`/hotels?city=${CITY}`, SUPPLIER_BASE.supplierA)).status).toBe(503);
      expect((await get(`/hotels?city=${CITY}`, SUPPLIER_BASE.supplierB)).status).toBe(200);
    });

    it('reports degraded but still answers 200', async () => {
      const { status, body } = await get<{ status: string; suppliers: Record<string, { status: string }> }>(
        '/health',
      );

      expect(status).toBe(200);
      expect(body.status).toBe('degraded');
      expect(body.suppliers.supplierA.status).toBe('down');
      expect(body.suppliers.supplierB.status).toBe('up');
    });

    it('still returns hotels, from the surviving supplier only', async () => {
      const { status, body, degraded } = await get<HotelOffer[]>(`/api/hotels?city=${CITY}`);

      expect(status).toBe(200);
      expect(degraded).toBe('Supplier A');
      expect(body.length).toBeGreaterThan(0);
      expect(body.every((o) => o.supplier === 'Supplier B')).toBe(true);
    }, 60_000);
  });

  describe('with both suppliers down', () => {
    beforeAll(async () => {
      await Promise.all([setAvailable('supplierA', false), setAvailable('supplierB', false)]);
    });
    afterAll(async () => {
      await Promise.all([setAvailable('supplierA', true), setAvailable('supplierB', true)]);
    });

    it('fails with 503 rather than 500', async () => {
      expect((await get(`/api/hotels?city=${CITY}`)).status).toBe(503);
    }, 60_000);

    it('reports unhealthy', async () => {
      const { status, body } = await get<{ status: string }>('/health');
      expect(status).toBe(503);
      expect(body.status).toBe('unhealthy');
    });
  });
});
