# ProductCatalog — CodeVector Internship Task

A backend service for browsing 200,000 products with fast, stable cursor-based pagination and category filtering.

## Live URLs
- **API**: `https://YOUR-APP.onrender.com`
- **UI**: Open `frontend/index.html` in a browser (after setting the API URL inside it)

---

## Architecture decisions

### Why PostgreSQL?
Relational, first-class `TIMESTAMPTZ`, composite indexes, and free tier on Neon — exactly what's needed.

### Why cursor-based pagination instead of OFFSET?

**The problem with OFFSET:**
```sql
-- Page 1
SELECT ... ORDER BY created_at DESC LIMIT 20 OFFSET 0;

-- While user reads page 1, someone inserts 5 new products.

-- Page 2 — now 5 rows have shifted down, user sees 5 duplicates
SELECT ... ORDER BY created_at DESC LIMIT 20 OFFSET 20;
```

**Cursor pagination fixes this:**
```sql
-- Page 1 (no cursor)
SELECT ... ORDER BY created_at DESC, id DESC LIMIT 20;

-- Cursor encodes the last row's (created_at, id).
-- Page 2 ignores everything above that point:
SELECT ...
WHERE created_at < $1 OR (created_at = $1 AND id < $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```
New inserts have *newer* timestamps — they land above the cursor and never disturb pages already browsed. The user sees every row exactly once.

### Why ORDER BY (created_at DESC, id DESC)?
If many rows share a `created_at` (bulk insert gives identical millisecond timestamps), a single-column sort is non-deterministic — rows could appear on two pages or be skipped. Adding `id` as a tiebreaker makes ordering fully deterministic.

### Index design
```sql
-- Covers both unfiltered and cursor traversal
CREATE INDEX idx_products_created_id ON products (created_at DESC, id DESC);

-- Covers category-filtered pagination
CREATE INDEX idx_products_category_created_id ON products (category, created_at DESC, id DESC);
```
Both queries hit the index directly — no sequential scans, O(log n) seek then a tiny 21-row scan.

### Why COPY for seeding?
- 200k individual INSERTs: ~10 minutes
- Batched multi-row INSERTs: ~30 seconds
- `COPY FROM STDIN` stream: **~3–5 seconds**

COPY bypasses per-row parse/plan/execute overhead and streams binary data directly into the table.

---

## API Reference

### `GET /health`
```json
{ "status": "ok", "db": "connected", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### `GET /api/products`
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | int | 20 | Rows per page (max 100) |
| `category` | string | — | Filter by exact category |
| `cursor` | string | — | Pagination cursor (from previous response) |

**Response:**
```json
{
  "data": [{ "id": 1, "name": "...", "category": "...", "price": "9.99", "created_at": "...", "updated_at": "..." }],
  "pagination": {
    "limit": 20,
    "count": 20,
    "hasNextPage": true,
    "nextCursor": "eyJjIjoiMjAyNC0..."
  },
  "filters": { "category": "Electronics" }
}
```

### `GET /api/products/categories`
Returns all distinct category strings.

### `GET /api/products/stats`
Returns aggregate stats: total count, category count, avg/min/max price.

### `GET /api/products/:id`
Returns a single product by ID.

---

## Setup & local development

### Prerequisites
- Node.js 18+
- A PostgreSQL database (Neon free tier: https://neon.tech)

### 1. Install dependencies
```bash
cd backend && npm install
cd ../scripts && npm install
```

### 2. Configure environment
```bash
cp backend/.env.example backend/.env
# Fill in your DATABASE_URL from Neon
```

### 3. Seed the database
```bash
node scripts/seed.js
# Takes ~5 seconds via COPY streaming
```

### 4. Start the server
```bash
cd backend && npm run dev
# Server at http://localhost:3000
```

### 5. Open the UI
Open `frontend/index.html` in a browser. The UI auto-detects localhost and hits the local API.

---

## Deployment

### Database (Neon)
1. Create a free project at https://neon.tech
2. Copy the connection string into `backend/.env` as `DATABASE_URL`
3. Run `node scripts/seed.js` once

### Backend (Render)
1. Push this repo to GitHub
2. Create a new **Web Service** on https://render.com
3. Set **Root Directory** to `backend`
4. **Build command**: `npm install`
5. **Start command**: `npm start`
6. Add env var `DATABASE_URL` (from Neon), `NODE_ENV=production`

### Frontend
Update the API URL in `frontend/index.html` (search for `YOUR-RENDER-APP`), then deploy the file to Netlify Drop, GitHub Pages, or any static host.

---

## What I'd improve with more time
- **Search**: full-text search with `tsvector` / `GIN` index on product name
- **Keyset pagination with `updated_at`**: let users browse "recently updated" with the same stability guarantee
- **Cache layer**: Redis caching for `/categories` and `/stats` (changes rarely)
- **Tests**: integration tests with a test DB, unit tests for cursor encode/decode
- **OpenAPI spec**: auto-generated with zod-openapi or tRPC
- **Connection pooling via PgBouncer**: on Neon this is built-in

---

## How I used AI (Claude)
- **Scaffolded** the Express server structure and middleware stack
- **Explained** the cursor pagination WHERE clause math (I verified it by drawing out the edge cases on paper)
- **Generated** the frontend HTML/CSS — I focused my time on the backend logic
- **Caught by me**: Claude's initial seed script used a for-loop with individual INSERTs. I replaced it with the COPY stream approach after reading the pg-copy-streams docs.
