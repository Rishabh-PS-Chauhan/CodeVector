/**
 * Seed script — generates 200,000 products fast using PostgreSQL COPY streaming.
 *
 * Why COPY instead of individual INSERTs?
 *   - 200k individual INSERTs would take many minutes (network round-trip × 200k).
 *   - Multi-row INSERT batches (1000 rows each) are better — ~30s.
 *   - COPY streams all rows in a single command with zero per-row overhead — ~3-5s.
 *
 * We generate the CSV entirely in memory using Node streams, pipe it straight
 * into the COPY command via a pg COPY FROM STDIN call. No temp files needed.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const { Client } = require('pg');
const { pipeline, Readable } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

const TOTAL = 200_000;
const BATCH_ROWS = 10_000; // rows per stream chunk

const CATEGORIES = [
  'Electronics', 'Clothing', 'Books', 'Home & Garden',
  'Sports', 'Toys', 'Food & Beverages', 'Automotive',
  'Health & Beauty', 'Office Supplies', 'Jewelry', 'Pet Supplies',
  'Music', 'Movies', 'Software', 'Tools',
];

const ADJECTIVES = ['Premium', 'Deluxe', 'Pro', 'Ultra', 'Classic', 'Essential',
  'Advanced', 'Smart', 'Eco', 'Vintage', 'Compact', 'Portable', 'Wireless',
  'Heavy-Duty', 'Lightweight', 'Ergonomic', 'Multi-Function', 'Waterproof'];

const NOUNS = ['Widget', 'Gadget', 'Device', 'Tool', 'Kit', 'Set', 'Pack',
  'Bundle', 'System', 'Unit', 'Module', 'Component', 'Accessory', 'Solution',
  'Product', 'Item', 'Gear', 'Equipment', 'Appliance', 'Instrument'];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randPrice() {
  // Generate prices in Indian Rupees (INR).
  // Range: ₹50.00 – ₹99,999.00 (two decimals preserved)
  return (randInt(5000, 9999900) / 100).toFixed(2);
}

function randDate(start, end) {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString();
}

// Escape a value for PostgreSQL COPY text format
function escape(val) {
  return String(val).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log('Connected to database');

  // ── Schema ────────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
      name        TEXT        NOT NULL,
      category    TEXT        NOT NULL,
      price       NUMERIC(10,2) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Composite index for cursor pagination — this is the critical performance index.
  // ORDER BY created_at DESC, id DESC with WHERE cursor condition hits this directly.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_products_created_id
      ON products (created_at DESC, id DESC)
  `);

  // Partial indexes per category for filtered pagination
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_products_category_created_id
      ON products (category, created_at DESC, id DESC)
  `);

  console.log('Schema & indexes ready');

  const existing = parseInt((await client.query('SELECT COUNT(*) FROM products')).rows[0].count, 10);
  const force = process.env.FORCE_SEED === '1';
  if (existing >= TOTAL && !force) {
    console.log(`Table already has ${existing} rows. Skipping seed.`);
    await client.end();
    return;
  }

  if (existing > 0) {
    console.log(`Truncating existing ${existing} rows…`);
    await client.query('TRUNCATE TABLE products RESTART IDENTITY');
  }

  // ── COPY stream ───────────────────────────────────────────────────────────
  console.log(`Seeding ${TOTAL.toLocaleString()} products via COPY…`);
  const start = Date.now();

  const now = new Date();
  const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);

  // Build generator: yields lines in PostgreSQL COPY text format (tab-separated)
  // Columns: name, category, price, created_at, updated_at
  function* generateRows() {
    for (let i = 0; i < TOTAL; i++) {
      const name = `${escape(randElement(ADJECTIVES))} ${escape(randElement(NOUNS))} ${randInt(100, 9999)}`;
      const category = escape(randElement(CATEGORIES));
      const price = randPrice();
      const createdAt = randDate(twoYearsAgo, now);
      const updatedAt = randDate(new Date(createdAt), now);
      yield `${name}\t${category}\t${price}\t${createdAt}\t${updatedAt}\n`;
    }
  }

  const copyStream = client.query(
    require('pg-copy-streams').from(
      `COPY products (name, category, price, created_at, updated_at) FROM STDIN WITH (FORMAT text)`
    )
  );

  let written = 0;
  const readableFromGenerator = Readable.from((function* () {
    for (const line of generateRows()) {
      yield line;
      written++;
      if (written % 50_000 === 0) {
        process.stdout.write(`  ${written.toLocaleString()} / ${TOTAL.toLocaleString()}\n`);
      }
    }
  })());

  await pipelineAsync(readableFromGenerator, copyStream);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nSeeded ${TOTAL.toLocaleString()} products in ${elapsed}s`);

  const finalCount = (await client.query('SELECT COUNT(*) FROM products')).rows[0].count;
  console.log(`Verified row count: ${parseInt(finalCount, 10).toLocaleString()}`);

  await client.end();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
