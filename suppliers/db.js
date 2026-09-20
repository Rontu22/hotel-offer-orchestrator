import pg from 'pg';
import { CATALOGUE } from './catalogue.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS hotels (
  hotel_id       text PRIMARY KEY,
  name           text NOT NULL,
  price          integer NOT NULL CHECK (price > 0),
  city           text NOT NULL,
  commission_pct integer NOT NULL CHECK (commission_pct BETWEEN 0 AND 100)
)`;

/**
 * Creates the supplier's own database if it is missing, applies the schema and
 * seeds it. Idempotent, so it can run on every boot: that is what makes the
 * service work the same under `docker compose up` and against a bare local
 * Postgres, with no migration tool and no separate seed step.
 */
export async function connect({ databaseUrl, supplierId }) {
  await ensureDatabase(databaseUrl);

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  await pool.query(SCHEMA);
  await seed(pool, CATALOGUE[supplierId] ?? []);
  return pool;
}

/** `CREATE DATABASE` cannot run against the database it creates, so use `postgres`. */
async function ensureDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  // Identifier, not a bindable parameter: reject anything that would need escaping.
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unusable database name "${name}"`);

  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

/** Existing rows win, so prices edited in the database survive a restart. */
async function seed(pool, rows) {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO hotels (hotel_id, name, price, city, commission_pct)
     SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::int[])
     ON CONFLICT (hotel_id) DO NOTHING`,
    [
      rows.map((h) => h.hotelId),
      rows.map((h) => h.name),
      rows.map((h) => h.price),
      rows.map((h) => h.city.toLowerCase()),
      rows.map((h) => h.commissionPct),
    ],
  );
}

const SELECT = `SELECT hotel_id AS "hotelId", name, price, city, commission_pct AS "commissionPct"
                FROM hotels`;

/** Cities are stored lowercase; the query string is normalised to match. */
export async function findHotels(pool, city) {
  const wanted = city?.trim().toLowerCase();
  const { rows } = wanted
    ? await pool.query(`${SELECT} WHERE city = $1 ORDER BY name, hotel_id`, [wanted])
    : await pool.query(`${SELECT} ORDER BY city, name, hotel_id`);
  return rows;
}
