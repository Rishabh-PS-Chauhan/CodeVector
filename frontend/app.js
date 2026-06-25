// ── Config — change this to your deployed backend URL ────────────────────
const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://YOUR-RENDER-APP.onrender.com'; // ← replace before deploying

// ── State ────────────────────────────────────────────────────────────────
let cursorStack = [];   // stack of cursors; cursorStack[i] = cursor for page i
let currentCursor = null;
let currentCategory = '';
let currentLimit = 20;
let totalShown = 0;
let pageNum = 1;

// ── Init ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await checkHealth();
  await loadStats();
  await loadCategories();
  await fetchProducts();
});

function setStatus(connected) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (!dot || !label) return;
  if (connected) {
    dot.style.background = 'var(--green)';
    dot.style.boxShadow = '0 0 8px var(--green)';
    label.textContent = 'Connected';
  } else {
    dot.style.background = 'var(--red)';
    dot.style.boxShadow = '';
    label.textContent = 'Offline';
  }
}

async function checkHealth(attempt = 0) {
  try {
    const r = await fetch(`${API}/health`);
    const j = await r.json();
    if (j.db === 'connected') {
      setStatus(true);
      return true;
    }
    throw new Error('db not connected');
  } catch (err) {
    if (attempt < 3) {
      // retry a few times before showing offline
      await new Promise(r => setTimeout(r, 1000));
      return checkHealth(attempt + 1);
    }
    setStatus(false);
    return false;
  }
}

async function loadStats() {
  try {
    const r = await fetch(`${API}/api/products/stats`);
    const { data } = await r.json();
    document.getElementById('statTotal').textContent = parseInt(data.total_products).toLocaleString();
    document.getElementById('statCats').textContent = data.total_categories;
    document.getElementById('statAvg').textContent = formatCurrency(parseFloat(data.avg_price));
    document.getElementById('statRange').textContent = formatCurrency(parseFloat(data.min_price));
    document.getElementById('statRangeSub').textContent = `to ${formatCurrency(parseFloat(data.max_price))}`;
    // If stats loaded successfully, ensure UI shows connected
    setStatus(true);
  } catch {}
}

async function loadCategories() {
  try {
    const r = await fetch(`${API}/api/products/categories`);
    const { data } = await r.json();
    const sel = document.getElementById('categorySelect');
    data.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat; o.textContent = cat;
      sel.appendChild(o);
    });
  } catch {}
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function fetchProducts(cursor = null) {
  setLoading(true);
  try {
    let url = `${API}/api/products?limit=${currentLimit}`;
    if (currentCategory) url += `&category=${encodeURIComponent(currentCategory)}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();

    // mark connected when products fetch succeeds
    setStatus(true);

    renderTable(json.data);
    updatePagination(json.pagination);
    currentCursor = cursor;
  } catch (err) {
    renderError(err.message);
  } finally {
    setLoading(false);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTable(rows) {
  const wrapper = document.getElementById('tableWrapper');
  if (!rows || rows.length === 0) {
    wrapper.innerHTML = `<div class="state-box"><div class="icon">🔍</div><h3>No products found</h3><p>Try a different category or clear the filter.</p></div>`;
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Category</th>
          <th>Price</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(p => `
          <tr>
            <td class="id-cell">#${p.id}</td>
            <td class="name-cell">${escHtml(p.name)}</td>
            <td><span class="category-badge ${catClass(p.category)}">${escHtml(p.category)}</span></td>
              <td class="price-cell">${formatCurrency(parseFloat(p.price))}</td>
            <td class="date-cell">${formatDate(p.created_at)}</td>
            <td class="date-cell">${formatDate(p.updated_at)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  wrapper.innerHTML = html;
}

function renderError(msg) {
  document.getElementById('tableWrapper').innerHTML = `
    <div class="state-box">
      <div class="icon">⚠️</div>
      <h3>Something went wrong</h3>
      <p>${escHtml(msg)}</p>
    </div>`;
}

function updatePagination(pagination) {
  const el = document.getElementById('pagination');
  const info = document.getElementById('paginationInfo');
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');

  el.classList.remove('hidden');
  totalShown = (pageNum - 1) * currentLimit + pagination.count;
  info.innerHTML = `Page <span>${pageNum}</span> · Showing <span>${totalShown.toLocaleString()}</span> products`;

  nextBtn.disabled = !pagination.hasNextPage;
  if (pagination.hasNextPage) {
    nextBtn._nextCursor = pagination.nextCursor;
  }
  prevBtn.disabled = cursorStack.length === 0;
}

// ── Navigation ─────────────────────────────────────────────────────────────
async function goNext() {
  const cursor = document.getElementById('nextBtn')._nextCursor;
  cursorStack.push(currentCursor);
  pageNum++;
  await fetchProducts(cursor);
}

async function goBack() {
  const prev = cursorStack.pop();
  pageNum--;
  await fetchProducts(prev);
}

function onCategoryChange() {
  currentCategory = document.getElementById('categorySelect').value;
  reset();
  fetchProducts();
}

function onLimitChange() {
  currentLimit = parseInt(document.getElementById('limitSelect').value, 10);
  reset();
  fetchProducts();
}

async function refreshData() {
  await loadStats();
  reset();
  await fetchProducts();
  toast('Refreshed');
}

function reset() {
  cursorStack = [];
  currentCursor = null;
  pageNum = 1;
  totalShown = 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setLoading(on) {
  document.getElementById('loadingOverlay').classList.toggle('visible', on);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatCurrency(value) {
  // Use Indian Rupee formatting
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
  } catch (e) {
    return `₹${Number(value).toFixed(2)}`;
  }
}

function catClass(cat) {
  const map = {
    'Electronics':'cat-electronics','Clothing':'cat-clothing','Books':'cat-books',
    'Home & Garden':'cat-home','Sports':'cat-sports','Toys':'cat-toys',
    'Food & Beverages':'cat-food','Automotive':'cat-automotive',
    'Health & Beauty':'cat-health','Office Supplies':'cat-office',
    'Jewelry':'cat-jewelry','Pet Supplies':'cat-pet','Music':'cat-music',
    'Movies':'cat-movies','Software':'cat-software','Tools':'cat-tools',
  };
  return map[cat] || 'cat-default';
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2000);
}
