const express = require('express');
const router = express.Router();
const pool = require('../db');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id })).toString('base64url');
}

function decodeCursor(str) {
  try {
    const p = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    if (!p.c || !p.i) return null;
    return p;
  } catch { return null; }
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const category = req.query.category?.trim() || null;
    const rawCursor = req.query.cursor || null;

    let cursor = null;
    if (rawCursor) {
      cursor = decodeCursor(rawCursor);
      if (!cursor) return res.status(400).json({ error: 'Invalid cursor' });
    }

    const params = [];
    const conditions = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (cursor) {
      params.push(cursor.c);
      params.push(cursor.i);
      conditions.push(`(created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit + 1);

    const sql = `
      SELECT id, name, category, price, created_at, updated_at
      FROM products
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null;

    return res.json({ data, pagination: { limit, count: data.length, hasNextPage, nextCursor }, filters: { category } });
  } catch (err) {
    console.error('[GET /products]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/categories
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT category FROM products ORDER BY category ASC');
    return res.json({ data: rows.map(r => r.category) });
  } catch (err) {
    console.error('[GET /products/categories]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/stats
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(DISTINCT category)::int AS total_categories,
        ROUND(AVG(price)::numeric, 2) AS avg_price,
        ROUND(MIN(price)::numeric, 2) AS min_price,
        ROUND(MAX(price)::numeric, 2) AS max_price,
        MAX(created_at) AS latest_created_at
      FROM products
    `);
    return res.json({ data: rows[0] });
  } catch (err) {
    console.error('[GET /products/stats]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'id must be a positive integer' });
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: `Product ${id} not found` });
    return res.json({ data: rows[0] });
  } catch (err) {
    console.error('[GET /products/:id]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
