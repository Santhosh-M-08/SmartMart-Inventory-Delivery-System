/* SmartMart — Inventory Management module (Member 1)
   Product contract (PROJECT_RULES.md): { id:number, name:string, category:string, price:number, stock:number }

   STORAGE ADAPTER
   The rules do not define shared storage functions yet, so this file talks to localStorage
   ONLY through the two methods in `ProductStore` below. If the team has a shared
   getProducts()/saveProducts(), replace the bodies of these two methods and nothing else changes.
   Agree the key name with the team: PRODUCTS_KEY must be the same in every module. */
(() => {
  'use strict';

  const PRODUCTS_KEY = 'smartmart_products';
  const THRESHOLD_KEY = 'smartmart_low_stock_threshold';
  const DEFAULT_THRESHOLD = 10;

  // Fictional sample data, only used the first time if nobody has created the dataset yet.
  const SAMPLE_PRODUCTS = [
    { id: 1, name: 'Sona Masoori Rice 5kg', category: 'Grains', price: 320, stock: 40 },
    { id: 2, name: 'Fresh Toned Milk 500ml', category: 'Dairy', price: 28, stock: 8 },
    { id: 3, name: 'Wheat Flour 5kg', category: 'Grains', price: 245, stock: 22 },
    { id: 4, name: 'Cream Biscuits Pack', category: 'Snacks', price: 20, stock: 0 },
    { id: 5, name: 'Sunflower Oil 1L', category: 'Oils', price: 135, stock: 6 },
    { id: 6, name: 'Tea Powder 250g', category: 'Beverages', price: 110, stock: 35 },
    { id: 7, name: 'Salted Butter 100g', category: 'Dairy', price: 56, stock: 14 },
    { id: 8, name: 'Instant Noodles', category: 'Snacks', price: 14, stock: 90 },
    { id: 9, name: 'Bath Soap', category: 'Personal Care', price: 38, stock: 4 },
    { id: 10, name: 'Mineral Water 1L', category: 'Beverages', price: 20, stock: 60 }
  ];

  const ProductStore = {
    getProducts() {
      try {
        const raw = localStorage.getItem(PRODUCTS_KEY);
        if (raw === null) { this.saveProducts(SAMPLE_PRODUCTS); return SAMPLE_PRODUCTS.map(p => ({ ...p })); }
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      } catch (err) { return []; }
    },
    saveProducts(list) {
      try { localStorage.setItem(PRODUCTS_KEY, JSON.stringify(list)); return true; }
      catch (err) { return false; }
    }
  };

  /* ---------- state & helpers ---------- */
  const $ = id => document.getElementById(id);
  const state = { products: [], query: '', category: 'all', lowOnly: false, threshold: DEFAULT_THRESHOLD };
  let toastTimer;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const stockLevel = p => (p.stock <= 0 ? 'out' : p.stock <= state.threshold ? 'low' : 'ok');
  const nextId = () => state.products.reduce((m, p) => Math.max(m, p.id), 0) + 1;

  function toast(message, isError) {
    const t = $('toast');
    t.textContent = message;
    t.classList.toggle('is-error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function persist(successMsg) {
    if (ProductStore.saveProducts(state.products)) { toast(successMsg); return true; }
    toast('Could not save. Browser storage is unavailable.', true);
    return false;
  }

  /* ---------- rendering ---------- */
  function render() {
    renderCategories();
    renderStats();
    renderTable();
  }

  function renderCategories() {
    const cats = [...new Set(state.products.map(p => p.category))].sort((a, b) => a.localeCompare(b));
    if (state.category !== 'all' && !cats.includes(state.category)) state.category = 'all';
    $('categoryFilter').innerHTML = '<option value="all">All categories</option>' +
      cats.map(c => `<option value="${esc(c)}"${c === state.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('categoryList').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  }

  function renderStats() {
    const low = state.products.filter(p => stockLevel(p) !== 'ok');
    $('statProducts').textContent = state.products.length;
    $('statUnits').textContent = state.products.reduce((a, p) => a + p.stock, 0).toLocaleString('en-IN');
    $('statLow').textContent = low.length;
    $('statValue').textContent = money(state.products.reduce((a, p) => a + p.stock * p.price, 0));

    const banner = $('lowBanner');
    banner.hidden = low.length === 0;
    if (low.length) {
      const out = low.filter(p => p.stock <= 0).length;
      $('lowBannerText').textContent = `⚠ ${low.length} product${low.length > 1 ? 's' : ''} need restocking` + (out ? ` (${out} out of stock).` : '.');
      $('lowToggle').textContent = state.lowOnly ? 'Show all products' : 'Show only low stock';
    } else { state.lowOnly = false; }
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    return state.products.filter(p =>
      (!q || p.name.toLowerCase().includes(q)) &&
      (state.category === 'all' || p.category === state.category) &&
      (!state.lowOnly || stockLevel(p) !== 'ok'));
  }

  const BADGES = { ok: ['inv-badge--ok', 'In stock'], low: ['inv-badge--low', 'Low stock'], out: ['inv-badge--out', 'Out of stock'] };

  function renderTable() {
    const rows = filtered();
    $('productRows').innerHTML = rows.map(p => {
      const lvl = stockLevel(p), b = BADGES[lvl];
      return `<tr class="${lvl !== 'ok' ? 'is-low' : ''}">
        <td>#${p.id}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.category)}</td>
        <td class="num">${money(p.price)}</td><td class="num">${p.stock}</td>
        <td><span class="inv-badge ${b[0]}">${b[1]}</span></td>
        <td class="actions">
          <button type="button" class="inv-btn inv-btn--small" data-action="edit" data-id="${p.id}">Edit</button>
          <button type="button" class="inv-btn inv-btn--small inv-btn--danger" data-action="delete" data-id="${p.id}">Delete</button>
        </td></tr>`;
    }).join('');

    const empty = $('emptyState'), btn = $('emptyAction');
    empty.hidden = rows.length > 0;
    document.querySelector('.inv-table-wrap').hidden = rows.length === 0;
    if (rows.length === 0) {
      if (state.products.length === 0) {
        $('emptyTitle').textContent = 'No products yet';
        $('emptyText').textContent = 'Add your first product to start tracking stock.';
        btn.textContent = '+ Add product'; btn.dataset.mode = 'add';
      } else {
        $('emptyTitle').textContent = 'No matching products';
        $('emptyText').textContent = 'Try a different name or category, or clear the filters.';
        btn.textContent = 'Clear filters'; btn.dataset.mode = 'clear';
      }
    }
  }

  /* ---------- add / edit form ---------- */
  const dialog = $('productDialog');
  const fields = { name: $('fName'), category: $('fCategory'), price: $('fPrice'), stock: $('fStock') };
  const errorIds = { name: 'eName', category: 'eCategory', price: 'ePrice', stock: 'eStock' };

  function clearErrors() {
    Object.keys(errorIds).forEach(k => { $(errorIds[k]).textContent = ''; fields[k].closest('.inv-field').classList.remove('has-error'); });
  }

  function openForm(product) {
    clearErrors();
    $('productForm').reset();
    $('dialogTitle').textContent = product ? 'Edit product' : 'Add product';
    $('saveBtn').textContent = product ? 'Save changes' : 'Save product';
    $('fId').value = product ? product.id : '';
    if (product) {
      fields.name.value = product.name; fields.category.value = product.category;
      fields.price.value = product.price; fields.stock.value = product.stock;
    }
    dialog.showModal();
    fields.name.focus();
  }

  function validate(data, editingId) {
    const errors = {};
    if (data.name.length < 2) errors.name = 'Enter a product name (at least 2 characters).';
    else if (data.name.length > 60) errors.name = 'Name must be 60 characters or fewer.';
    if (!data.category) errors.category = 'Choose or enter a category.';
    if (!Number.isFinite(data.price) || data.price <= 0) errors.price = 'Enter a price greater than 0.';
    else if (data.price > 1000000) errors.price = 'Price is too large.';
    if (!Number.isInteger(data.stock) || data.stock < 0) errors.stock = 'Enter a whole number, 0 or more.';
    else if (data.stock > 100000) errors.stock = 'Stock quantity is too large.';
    if (!errors.name && !errors.category) {
      const dup = state.products.some(p => p.id !== editingId &&
        p.name.toLowerCase() === data.name.toLowerCase() && p.category.toLowerCase() === data.category.toLowerCase());
      if (dup) errors.name = 'This product already exists in that category.';
    }
    return errors;
  }

  function onSubmit(e) {
    e.preventDefault();
    clearErrors();
    const editingId = $('fId').value ? Number($('fId').value) : null;
    const data = {
      name: fields.name.value.trim().replace(/\s+/g, ' '),
      category: fields.category.value.trim().replace(/\s+/g, ' '),
      price: fields.price.value === '' ? NaN : Number(fields.price.value),
      stock: fields.stock.value === '' ? NaN : Number(fields.stock.value)
    };
    // Reuse the existing category spelling/casing if the user typed one that already exists.
    const existing = state.products.find(p => p.category.toLowerCase() === data.category.toLowerCase());
    if (existing) data.category = existing.category;

    const errors = validate(data, editingId);
    const keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach(k => { $(errorIds[k]).textContent = errors[k]; fields[k].closest('.inv-field').classList.add('has-error'); });
      fields[keys[0]].focus();
      toast('Please fix the highlighted fields.', true);
      return;
    }

    if (editingId) {
      const p = state.products.find(x => x.id === editingId);
      if (!p) { toast('That product no longer exists.', true); dialog.close(); return; }
      Object.assign(p, data);
      if (persist(`Updated “${p.name}”.`)) { dialog.close(); render(); }
    } else {
      const product = { id: nextId(), ...data };
      state.products.push(product);
      if (persist(`Added “${product.name}”.`)) { dialog.close(); render(); }
      else state.products.pop();
    }
  }

  function deleteProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p || !window.confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    state.products = state.products.filter(x => x.id !== id);
    persist(`Deleted “${p.name}”.`);
    render();
  }

  /* ---------- events ---------- */
  function clearFilters() {
    state.query = ''; state.category = 'all'; state.lowOnly = false;
    $('searchInput').value = '';
    render();
  }

  function init() {
    state.products = ProductStore.getProducts();
    const saved = Number(localStorage.getItem(THRESHOLD_KEY));
    state.threshold = Number.isInteger(saved) && saved > 0 ? saved : DEFAULT_THRESHOLD;
    $('thresholdInput').value = state.threshold;

    $('addBtn').addEventListener('click', () => openForm(null));
    $('searchInput').addEventListener('input', e => { state.query = e.target.value; renderTable(); });
    $('categoryFilter').addEventListener('change', e => { state.category = e.target.value; renderTable(); });
    $('clearBtn').addEventListener('click', clearFilters);
    $('lowToggle').addEventListener('click', () => { state.lowOnly = !state.lowOnly; render(); });
    $('emptyAction').addEventListener('click', e => (e.currentTarget.dataset.mode === 'add' ? openForm(null) : clearFilters()));
    $('thresholdInput').addEventListener('change', e => {
      const v = Number(e.target.value);
      if (!Number.isInteger(v) || v < 1 || v > 1000) { toast('Threshold must be a whole number from 1 to 1000.', true); e.target.value = state.threshold; return; }
      state.threshold = v;
      try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch (err) { /* ignore */ }
      toast(`Low-stock threshold set to ${v}.`);
      render();
    });
    $('productRows').addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.dataset.action === 'edit') openForm(state.products.find(p => p.id === id));
      else deleteProduct(id);
    });
    $('productForm').addEventListener('submit', onSubmit);
    $('cancelBtn').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    window.addEventListener('storage', e => { if (e.key === PRODUCTS_KEY) { state.products = ProductStore.getProducts(); render(); } });

    render();
  }

  init();
})();