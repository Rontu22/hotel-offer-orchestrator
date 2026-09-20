import { createServer } from 'node:http';
import { connect, findHotels } from './db.js';

/**
 * One supplier, standing in for a third party we do not own: its own process,
 * its own port and its own Postgres database. The orchestrator can only reach it
 * over HTTP, which is the point — it has no access to these tables.
 */
export function createSupplier({ supplierId, pool, latencyMs = 0 }) {
  // In memory on purpose: a real supplier's outage is not persisted in our Redis.
  let available = true;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://supplier.local');
    route(req, res, url).catch((cause) => {
      console.error(`[${supplierId}] ${req.method} ${url.pathname} failed`, cause);
      json(res, 500, { error: message(cause) });
    });
  });

  async function route(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/health') {
      await pool.query('SELECT 1');
      return json(res, 200, { supplier: supplierId, status: 'ok', available });
    }

    if (url.pathname === '/admin/availability') {
      if (req.method === 'GET') return json(res, 200, { supplier: supplierId, available });
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (typeof body?.available !== 'boolean') {
          return json(res, 400, { error: 'available must be true or false' });
        }
        available = body.available;
        console.warn(`[${supplierId}] switched ${available ? 'ON' : 'OFF'}`);
        return json(res, 200, { supplier: supplierId, available });
      }
    }

    if (req.method === 'GET' && url.pathname === '/hotels') {
      if (!available) return json(res, 503, { error: `${supplierId} is unavailable` });
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return json(res, 200, await findHotels(pool, url.searchParams.get('city') ?? undefined));
    }

    json(res, 404, { error: `Cannot ${req.method} ${url.pathname}` });
  }

  return server;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8_192) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

const message = (cause) => (cause instanceof Error ? cause.message : String(cause));

export async function start(env = process.env) {
  const supplierId = env.SUPPLIER_ID ?? 'supplierA';
  const port = Number(env.PORT ?? 4002);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = await connect({ databaseUrl: env.DATABASE_URL, supplierId });
  const server = createSupplier({ supplierId, pool, latencyMs: Number(env.LATENCY_MS ?? 150) });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`[${supplierId}] listening on ${port}, backed by ${new URL(env.DATABASE_URL).pathname.slice(1)}`);

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return { server, pool };
}
