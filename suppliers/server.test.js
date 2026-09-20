import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { connect, findHotels } from './db.js';
import { createSupplier } from './server.js';

/**
 * Runs against a real Postgres, because the whole point of the change is that
 * the catalogue lives in one. Start the stack (`cd infra && docker compose up -d
 * postgres`) or point TEST_DATABASE_URL somewhere else; without it the suite
 * skips rather than failing a checkout that has no database.
 */
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://temporal:temporal@localhost:5432/supplier_test';

let pool;
let skip = false;
try {
  pool = await connect({ databaseUrl: DATABASE_URL, supplierId: 'supplierA' });
} catch (cause) {
  skip = `no Postgres at ${DATABASE_URL}: ${cause.message}`;
}

describe('supplier service', { skip }, () => {
  const server = pool && createSupplier({ supplierId: 'supplierA', pool });
  const listening = new Promise((resolve) => server?.listen(0, resolve));

  const call = async (path, init) => {
    await listening;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
    return { status: response.status, body: await response.json() };
  };

  const setAvailable = (available) =>
    call('/admin/availability', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ available }),
    });

  after(async () => {
    server?.close();
    await pool?.end();
  });

  it('serves the seeded catalogue for a city, case and space insensitively', async () => {
    const { status, body } = await call('/hotels?city=%20DELHI%20');

    assert.equal(status, 200);
    assert.ok(body.length > 0);
    assert.ok(body.every((hotel) => hotel.city === 'delhi'));
    // camelCase shape, not the snake_case the table uses.
    assert.deepEqual(Object.keys(body[0]).sort(), [
      'city',
      'commissionPct',
      'hotelId',
      'name',
      'price',
    ]);
  });

  it('returns the whole catalogue with no city, and nothing for an unknown one', async () => {
    assert.equal((await call('/hotels')).body.length, (await findHotels(pool)).length);
    assert.deepEqual((await call('/hotels?city=atlantis')).body, []);
  });

  it('answers 503 once switched off, and recovers when switched back on', async () => {
    assert.deepEqual((await setAvailable(false)).body, { supplier: 'supplierA', available: false });
    assert.equal((await call('/hotels?city=delhi')).status, 503);

    await setAvailable(true);
    assert.equal((await call('/hotels?city=delhi')).status, 200);
  });

  it('rejects a non-boolean availability and an unknown path', async () => {
    assert.equal((await setAvailable('maybe')).status, 400);
    assert.equal((await call('/nope')).status, 404);
  });
});
