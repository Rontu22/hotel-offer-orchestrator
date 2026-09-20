import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRedis, type FakeRedis } from '../test/fake-redis.js';
import { AppModule } from './app.module.js';
import { REDIS } from './redis/redis.tokens.js';
import { TEMPORAL_CLIENT } from './temporal/temporal.tokens.js';

const SUPPLIER_URLS = {
  SUPPLIER_A_URL: 'http://supplier-a:4002',
  SUPPLIER_B_URL: 'http://supplier-b:4003',
};

/**
 * Stands in for the two standalone supplier services, which now live outside
 * this process with a Postgres database each. Only their HTTP surface matters
 * here: an availability flag and a catalogue endpoint that honours it.
 */
function stubSuppliers() {
  const available: Record<string, boolean> = { '4002': true, '4003': true };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const { port, pathname } = new URL(url);
      if (pathname === '/admin/availability') {
        if (init?.method === 'PUT') available[port] = JSON.parse(String(init.body)).available;
        return Response.json({ available: available[port] });
      }
      // GET /hotels, used by the health probe: a switched-off supplier 503s.
      return available[port] ? Response.json([]) : new Response('down', { status: 503 });
    }),
  );
  return available;
}

/**
 * Boots the whole module graph against the in-memory Redis double, with Temporal
 * and the supplier services stubbed. Unit tests construct providers by hand and
 * therefore never catch a missing module import; this does, without Docker.
 */
async function bootApp() {
  const redis: FakeRedis = fakeRedis();
  const offers = [{ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 }];

  // Stands in for the worker: writes what the real activity would write.
  const execute = vi.fn(async (_name: string, options: { args: [{ city: string }] }) => {
    const city = options.args[0].city;
    await redis.multi().zadd(`hotels:v1:${city}:offers`, offers[0].price, JSON.stringify(offers[0]));
    await redis.set(
      `hotels:v1:${city}:meta`,
      JSON.stringify({ count: 1, degraded: [], fetchedAt: new Date().toISOString() }),
    );
    return { offers, degraded: [] };
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(TEMPORAL_CLIENT)
    .useValue({
      workflow: { execute },
      connection: { close: vi.fn(), workflowService: { getSystemInfo: vi.fn(async () => ({})) } },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  return { app, redis, execute, offers, http: () => request(app.getHttpServer()) };
}

describe('AppModule', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;

  beforeEach(async () => {
    Object.assign(process.env, SUPPLIER_URLS);
    stubSuppliers();
    ctx = await bootApp();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resolves every provider, including the workflow activities', async () => {
    await expect(ctx.app.close()).resolves.not.toThrow();
  });

  it('serves GET /api/hotels by orchestrating, every time', async () => {
    await ctx.http().get('/api/hotels?city=delhi').expect(200).expect(ctx.offers);
    expect(ctx.execute).toHaveBeenCalledOnce();

    // Redis is the price filter, not a cache, so a repeat re-runs the workflow.
    await ctx.http().get('/api/hotels?city=delhi').expect(200).expect(ctx.offers);
    expect(ctx.execute).toHaveBeenCalledTimes(2);
    await ctx.app.close();
  });

  it('validates the query string before doing any work', async () => {
    await ctx.http().get('/api/hotels').expect(400);
    await ctx.http().get('/api/hotels?city=delhi&minPrice=9&maxPrice=1').expect(400);

    expect(ctx.execute).not.toHaveBeenCalled();
    await ctx.app.close();
  });

  it('takes a supplier down at the supplier itself, and starts a new era', async () => {
    await ctx.http().get('/api/hotels?city=delhi').expect(200);

    await ctx
      .http()
      .put('/api/suppliers/supplierA/availability')
      .send({ available: false })
      .expect(200)
      .expect({ supplierA: false, supplierB: true });

    // Read back over HTTP: the flag lives in the supplier, not in our Redis.
    await ctx.http().get('/api/suppliers').expect({ supplierA: false, supplierB: true });
    // ...and that is what /health now reports as degraded.
    const { body } = await ctx.http().get('/health').expect(200);
    expect(body).toMatchObject({ status: 'degraded', suppliers: { supplierA: { status: 'down' } } });

    await ctx.app.close();
  });

  it('rejects an unknown supplier id and a non-boolean availability', async () => {
    await ctx.http().put('/api/suppliers/supplierZ/availability').send({ available: false }).expect(400);
    await ctx.http().put('/api/suppliers/supplierA/availability').send({ available: 'maybe' }).expect(400);
    await ctx.app.close();
  });

  it('keeps liveness free of dependencies', async () => {
    ctx.redis.ping.mockRejectedValue(new Error('down'));
    await ctx.http().get('/health/live').expect(200, { status: 'ok' });
    await ctx.app.close();
  });

  it('reports every dependency, including both suppliers, in /health', async () => {
    const { body } = await ctx.http().get('/health');

    expect(body).toMatchObject({ redis: { status: 'up' }, temporal: { status: 'up' } });
    expect(Object.keys(body.suppliers)).toEqual(['supplierA', 'supplierB']);
    await ctx.app.close();
  });

  it('is unhealthy with a 503 when Redis stops answering', async () => {
    ctx.redis.ping.mockRejectedValue(new Error('connection refused'));

    const { body } = await ctx.http().get('/health').expect(503);
    expect(body).toMatchObject({ status: 'unhealthy', redis: { status: 'down', error: 'connection refused' } });
    await ctx.app.close();
  });

  /**
   * The brief pins these two paths down. They forward to the standalone supplier
   * services rather than serving a catalogue this process owns.
   */
  it('exposes the supplier paths the brief specifies', async () => {
    for (const supplier of ['supplierA', 'supplierB']) {
      const { body } = await ctx.http().get(`/${supplier}/hotels?city=delhi`).expect(200);
      expect(Array.isArray(body)).toBe(true);
    }
    await ctx.app.close();
  });

  it('passes a switched-off supplier through as 503 on that path', async () => {
    await ctx.http().put('/api/suppliers/supplierA/availability').send({ available: false }).expect(200);

    await ctx.http().get('/supplierA/hotels?city=delhi').expect(503);
    await ctx.http().get('/supplierB/hotels?city=delhi').expect(200);
    await ctx.app.close();
  });
});
