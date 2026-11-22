/* ==========================================================================
   SmartMart — Expiry Management: shared core (NEW FILE)
   File: js/expiry-core.js

   Loaded by: expiry.html, inventory.html, delivery.html
   Exposes one global: SmartMartExpiry

   What lives here (no DOM code):
   - date helpers (calendar dates, compared at local midnight → no time-zone drift)
   - settings (enable/disable, activation days, discount %)
   - batch store + sample data (sample batches are flagged source:"sample")
   - expiry / discount evaluation per BATCH
   - notification generation with de-duplication
   - sale quoting (server-style price validation) + sale recording
   - analytics and smart suggestions

   BACKEND INTEGRATION: every function that touches localStorage is in the
   "STORAGE ADAPTER" block. Replace those few functions with fetch() calls to
   your Express/MongoDB API and the rest of the file keeps working.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- constants ---------- */
  const KEYS = {
    products: 'smartmart_products',            // shared product list (do not duplicate)
    orders: 'smartmart_orders',                // shared order list
    batches: 'smartmart_expiry_batches',
    settings: 'smartmart_expiry_settings',
    notifications: 'smartmart_expiry_notifications',
    events: 'smartmart_expiry_event_keys',     // remembers alerts already raised (de-dupe)
    previewDate: 'smartmart_expiry_preview_date', // testing aid only
    sampleCleared: 'smartmart_expiry_sample_cleared'
  };

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    activationDays: 3,      // discount starts this many days before expiry
    discountPercent: 50,
    warningDays: 7          // "Approaching Expiry" window (early warning)
  });

  // Requirement: "when the expiry date is reached, the product becomes unavailable".
  // Set to true if your store may still sell on the expiry day itself.
  const ALLOW_SALE_ON_EXPIRY_DAY = false;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const NOTIFICATION_LIMIT = 100;
  const STAGES = ['warning', 'discount', 'urgent', 'expired']; // escalation order

  const STATUS_LABELS = {
    safe: 'Safe', approaching: 'Approaching Expiry', discount: 'Discount Active',
    today: 'Expiring Today', expired: 'Expired'
  };
  const DISCOUNT_LABELS = {
    active: 'Active', scheduled: 'Scheduled', none: 'Not applied', disabled: 'Disabled', ended: 'Ended'
  };

  /* ==========================================================================
     STORAGE ADAPTER  (swap these for API calls when the backend is ready)
     ========================================================================== */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }
  /* SQLite-read adapter: stage 1 */
  function getProducts() {
    if (global.SmartMartExpirySqlite) return global.SmartMartExpirySqlite.products;
    return [];
  }
  function saveProducts(list) { return write(KEYS.products, list); }
  function getOrders() {
    const list = read(KEYS.orders, []);
    return Array.isArray(list) ? list : [];
  }
  function getBatches() {
    if (global.SmartMartExpirySqlite) return global.SmartMartExpirySqlite.batches;
    return [];
  }
  function saveBatches(list) { return write(KEYS.batches, list); }

  function emitChange() {
    try { global.dispatchEvent(new CustomEvent('smartmart:expiry-changed')); } catch (err) { /* ignore */ }
  }

  /* ==========================================================================
     SMALL HELPERS
     ========================================================================== */
  const pad = n => String(n).padStart(2, '0');
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  /* ==========================================================================
     DATE HELPERS
     Expiry dates are CALENDAR dates ("YYYY-MM-DD") in the store's local time.
     Day differences use UTC day numbers of those calendar dates, so daylight
     saving or the viewer's time zone can never shift a discount by a day.
     ========================================================================== */
  function toISODate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }
  function dayNumber(iso) {
    const p = parseISODate(iso);
    return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN;
  }
  function today() {
    const override = read(KEYS.previewDate, null);   // testing aid (Settings → Testing tools)
    if (typeof override === 'string' && parseISODate(override)) return override;
    return toISODate(new Date());
  }
  function isPreviewDate() {
    const o = read(KEYS.previewDate, null);
    return typeof o === 'string' && !!parseISODate(o);
  }
  function setPreviewDate(iso) {
    if (!iso) { try { localStorage.removeItem(KEYS.previewDate); } catch (e) { /* ignore */ } }
    else if (parseISODate(iso)) write(KEYS.previewDate, iso);
    syncNotifications();
    emitChange();
  }
  const daysBetween = (fromISO, toISO) => dayNumber(toISO) - dayNumber(fromISO);
  function addDays(iso, n) {
    const p = parseISODate(iso);
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function formatDate(iso) {
    const p = parseISODate(iso);
    return p ? p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y : '—';
  }
  function formatDateTime(isoString) {
    const d = new Date(isoString);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function monthKey(iso) { return String(iso).slice(0, 7); }
  function monthLabel(key) {
    const parts = key.split('-');
    return MONTHS[+parts[1] - 1] + " '" + parts[0].slice(2);
  }
  function shiftMonth(key, delta) {
    const parts = key.split('-');
    const d = new Date(Date.UTC(+parts[0], +parts[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  function daysLeftText(daysLeft) {
    if (daysLeft < 0) return 'Expired ' + plural(-daysLeft, 'day') + ' ago';
    if (daysLeft === 0) return 'Today';
    return plural(daysLeft, 'day') + ' left';
  }

  /* ==========================================================================
     SETTINGS
     ========================================================================== */
  function validateSettings(input) {
    const errors = {};
    const value = {
      enabled: !!input.enabled,
      activationDays: Number(input.activationDays),
      discountPercent: Number(input.discountPercent),
      warningDays: Number(input.warningDays)
    };
    if (!Number.isInteger(value.activationDays) || value.activationDays < 1 || value.activationDays > 60) {
      errors.activationDays = 'Enter a whole number of days from 1 to 60.';
    }
    if (!Number.isFinite(value.discountPercent) || value.discountPercent < 1 || value.discountPercent > 90) {
      errors.discountPercent = 'Enter a discount from 1% to 90%.';
    } else { value.discountPercent = round2(value.discountPercent); }
    if (!Number.isInteger(value.warningDays) || value.warningDays < 1 || value.warningDays > 90) {
      errors.warningDays = 'Enter a whole number of days from 1 to 90.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }
  function getSettings() {
    const stored = global.SmartMartExpirySqlite
      ? global.SmartMartExpirySqlite.settings : {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored && typeof stored === 'object' ? stored : {});
    const v = validateSettings(merged);
    return v.ok ? v.value : Object.assign({}, DEFAULT_SETTINGS);
  }
  function saveSettings(input) {
    const v = validateSettings(input);
    if (!v.ok) return v;
    write(KEYS.settings, v.value);
    syncNotifications();
    emitChange();
    return v;
  }
  function resetSettings() {
    write(KEYS.settings, Object.assign({}, DEFAULT_SETTINGS));
    syncNotifications();
    emitChange();
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  /* ==========================================================================
     EVALUATION  (the single place where discount + status rules live)
     ========================================================================== */
  const clampPct = p => Math.min(90, Math.max(1, Number(p) || 0));

  function evaluateBatch(batch, product, settings, t) {
    settings = settings || getSettings();
    t = t || today();
    const daysLeft = daysBetween(t, batch.expiryDate);
    const basePrice = product ? Number(product.price) || 0 : 0;
    const override = batch.override || null;
    const mode = override && override.mode ? override.mode : 'auto';
    const pct = mode === 'custom' ? clampPct(override.pct) : settings.discountPercent;
    const qty = Number(batch.qtyAvailable) || 0;

    const expired = daysLeft < 0;
    const expiringToday = daysLeft === 0;
    const dateSellable = daysLeft > 0 || (daysLeft === 0 && ALLOW_SALE_ON_EXPIRY_DAY);

    let discountStatus, active = false, startsOn = null;
    if (!dateSellable) discountStatus = 'ended';
    else if (mode === 'none') discountStatus = 'none';
    else if (mode === 'custom' && override.startNow) { active = true; discountStatus = 'active'; }
    else if (!settings.enabled) discountStatus = 'disabled';
    else {
      startsOn = addDays(batch.expiryDate, -settings.activationDays);
      if (daysLeft <= settings.activationDays) { active = true; discountStatus = 'active'; }
      else discountStatus = 'scheduled';
    }

    let expiryStatus;
    if (expired) expiryStatus = 'expired';
    else if (expiringToday) expiryStatus = 'today';
    else if (active) expiryStatus = 'discount';
    else if (daysLeft <= Math.max(settings.warningDays, settings.activationDays)) expiryStatus = 'approaching';
    else expiryStatus = 'safe';

    const unitPrice = active ? round2(basePrice * (1 - pct / 100)) : basePrice;
    return {
      batch: batch, product: product || null,
      daysLeft: daysLeft, expired: expired, expiringToday: expiringToday,
      sellable: dateSellable && qty > 0 && !batch.writtenOff,
      expiryStatus: expiryStatus, expiryLabel: STATUS_LABELS[expiryStatus],
      discountStatus: discountStatus, discountLabel: DISCOUNT_LABELS[discountStatus],
      discountActive: active, discountPct: pct, discountStartsOn: startsOn,
      basePrice: basePrice, unitPrice: unitPrice, qty: qty, mode: mode
    };
  }

  function evaluateAll(opts) {
    const settings = getSettings(), t = today();
    const products = {};
    getProducts().forEach(p => { products[p.id] = p; });
    return getBatches()
      .filter(b => products[b.productId])               // hide batches of deleted products
      .map(b => evaluateBatch(b, products[b.productId], settings, t));
  }

  /* ==========================================================================
     SAMPLE DATA  (always flagged source:"sample"; never mixed into "actual")
     ========================================================================== */
  function sampleHistory(t) {
    // Fictional previous months. Used ONLY when the analytics scope includes sample data.
    const thisMonth = monthKey(t);
    const saved = [112, 128, 141, 156, 171, 184];
    const expired = [38, 33, 29, 24, 21, 17];
    const revenue = [9800, 11200, 12600, 13900, 15200, 16800];
    const discount = [9100, 10800, 12900, 13300, 14800, 16100];
    return saved.map(function (s, i) {
      return { month: shiftMonth(thisMonth, i - 6), saved: s, expired: expired[i], revenue: revenue[i], discount: discount[i], source: 'sample' };
    });
  }

  function buildSampleBatches(products, t) {
    const perishable = ['Dairy', 'Bakery', 'Fruits'];
    const rank = p => (perishable.indexOf(p.category) === -1 ? 1 : 0);
    const candidates = products.filter(p => Number(p.stock) > 0)
      .map((p, i) => ({ p: p, i: i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map(x => x.p).slice(0, 8);

    // off = days from today to expiry; sold* = units already sold; daily = typical units/day
    const plans = [
      { off: 3, qty: 24, disc: [[0, 6]], daily: 2.5 },
      { off: 2, qty: 18, disc: [[-1, 4], [0, 4]], daily: 1.2 },
      { off: 0, qty: 12, disc: [[-2, 5], [-1, 4]], daily: 4 },
      { off: -1, qty: 6, disc: [[-4, 5], [-3, 4], [-2, 5]], daily: 0 },   // expired, 6 left over
      { off: 6, qty: 16, full: [[-2, 4]], daily: 0.8 },
      { off: 1, qty: 9, disc: [[-2, 5], [-1, 5], [0, 3]], daily: 3 },
      { off: 12, qty: 30, full: [[-3, 5]], daily: 1 },
      { off: 9, qty: 20, daily: 1.5 }
    ];

    const out = [];
    function make(product, plan, serial) {
      const prefix = (String(product.name).match(/[A-Za-z]+/) || ['BAT'])[0].toUpperCase().slice(0, 4);
      const batchNo = prefix + (100 + serial);
      const base = Number(product.price) || 0;
      const pct = DEFAULT_SETTINGS.discountPercent;
      const discPrice = round2(base * (1 - pct / 100));
      const sales = [];
      (plan.disc || []).forEach(function (d) {
        sales.push({ date: addDays(t, d[0]), qty: d[1], unitPrice: discPrice, basePrice: base, discountPct: pct, orderId: null });
      });
      (plan.full || []).forEach(function (d) {
        sales.push({ date: addDays(t, d[0]), qty: d[1], unitPrice: base, basePrice: base, discountPct: 0, orderId: null });
      });
      const sold = sales.reduce((a, s) => a + s.qty, 0);
      const qty = Math.max(1, Math.min(Number(product.stock), plan.qty));
      out.push({
        id: 'smp-' + batchNo, batchNo: batchNo, productId: product.id,
        qtyReceived: qty + sold, qtyAvailable: qty,
        expiryDate: addDays(t, plan.off), receivedDate: addDays(t, plan.off - 14),
        override: null, sales: sales, source: 'sample', writtenOff: false,
        sampleDailySales: plan.daily
      });
    }
    candidates.forEach((p, i) => { if (plans[i]) make(p, plans[i], i + 1); });
    if (candidates[0]) {   // second batch of the first product → shows batch-level tracking
      make(candidates[0], { off: 14, qty: 20, daily: 2.5 }, candidates.length + 1);
    }
    return out;
  }

  function ensureSeeded() {
    if (localStorage.getItem(KEYS.batches) !== null) return;
    if (localStorage.getItem(KEYS.sampleCleared) === '1') return;
    const products = getProducts();
    if (!products.length) return;                       // try again once products exist
    saveBatches(buildSampleBatches(products, today()));
  }

  function reloadSampleData() {
    const kept = getBatches().filter(b => b.source !== 'sample');
    const fresh = buildSampleBatches(getProducts(), today());
    try { localStorage.removeItem(KEYS.sampleCleared); } catch (e) { /* ignore */ }
    saveBatches(kept.concat(fresh));
    resetEventKeysForSample();
    syncNotifications();
    emitChange();
    return fresh.length;
  }
  function clearSampleData() {
    saveBatches(getBatches().filter(b => b.source !== 'sample'));
    write(KEYS.notifications, getNotificationsRaw().filter(n => !isSampleBatchId(n.batchId)));
    try { localStorage.setItem(KEYS.sampleCleared, '1'); } catch (e) { /* ignore */ }
    emitChange();
  }
  const isSampleBatchId = id => String(id || '').indexOf('smp-') === 0;
  function resetEventKeysForSample() {
    write(KEYS.events, read(KEYS.events, []).filter(k => !isSampleBatchId(String(k).split('|')[0])));
  }

  /* ==========================================================================
     BATCH MANAGEMENT
     ========================================================================== */
  function addBatch(input) {
    const products = getProducts();
    const product = products.find(p => p.id === Number(input.productId));
    const batchNo = String(input.batchNo || '').trim().toUpperCase();
    const qty = Number(input.qty);
    const expiryDate = String(input.expiryDate || '');
    const errors = {};
    if (!product) errors.productId = 'Choose a product.';
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(batchNo)) errors.batchNo = 'Use 2–20 letters, numbers or hyphens.';
    else if (getBatches().some(b => b.batchNo === batchNo && b.productId === Number(input.productId))) errors.batchNo = 'This batch number already exists for that product.';
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) errors.qty = 'Enter a whole number of 1 or more.';
    if (!parseISODate(expiryDate)) errors.expiryDate = 'Choose a valid expiry date.';
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    const batches = getBatches();
    const batch = {
      id: 'bat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      batchNo: batchNo, productId: product.id,
      qtyReceived: qty, qtyAvailable: qty,
      expiryDate: expiryDate, receivedDate: today(),
      override: null, sales: [], source: 'actual', writtenOff: false
    };
    batches.push(batch);
    saveBatches(batches);
    syncNotifications();
    emitChange();
    return { ok: true, batch: batch };
  }

  function setOverride(batchId, override) {
    const batches = getBatches();
    const b = batches.find(x => x.id === batchId);
    if (!b) return { ok: false, error: 'Batch not found.' };
    if (override && override.mode === 'custom') {
      const pct = Number(override.pct);
      if (!Number.isFinite(pct) || pct < 1 || pct > 90) return { ok: false, error: 'Enter a discount from 1% to 90%.' };
      b.override = { mode: 'custom', pct: round2(pct), startNow: !!override.startNow };
    } else if (override && override.mode === 'none') {
      b.override = { mode: 'none' };
    } else { b.override = null; }
    saveBatches(batches);
    syncNotifications();
    emitChange();
    return { ok: true };
  }

  function writeOff(batchId) {
    const batches = getBatches();
    const b = batches.find(x => x.id === batchId);
    if (!b) return { ok: false, error: 'Batch not found.' };
    if (daysBetween(today(), b.expiryDate) >= 0) return { ok: false, error: 'Only expired batches can be written off.' };
    if (b.writtenOff) return { ok: false, error: 'This batch was already written off.' };
    const products = getProducts();
    const p = products.find(x => x.id === b.productId);
    if (p) { p.stock = Math.max(0, Number(p.stock) - Number(b.qtyAvailable)); saveProducts(products); }
    b.writtenOff = true;      // qtyAvailable is kept so the units still count as "expired" in analytics
    saveBatches(batches);
    emitChange();
    return { ok: true, units: b.qtyAvailable };
  }

  function deleteBatch(batchId) {
    const batches = getBatches();
    const b = batches.find(x => x.id === batchId);
    if (!b) return { ok: false, error: 'Batch not found.' };
    if (b.sales.length) return { ok: false, error: 'This batch has sales history and cannot be deleted.' };
    saveBatches(batches.filter(x => x.id !== batchId));
    emitChange();
    return { ok: true };
  }

  /* ==========================================================================
     SELLING: price validation (quote) + recording
     The price is ALWAYS calculated here from batch + settings data.
     A price sent by the browser/cart is never trusted.
     ========================================================================== */
  function productBatches(productId) {
    return getBatches().filter(b => b.productId === productId && Number(b.qtyAvailable) > 0 && !b.writtenOff);
  }

  function quoteSale(product, quantity) {
    const qty = Number(quantity);
    if (!product || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'Invalid product or quantity.', lines: [], items: [], total: 0 };

    const settings = getSettings(), t = today();
    const evals = productBatches(product.id).map(b => evaluateBatch(b, product, settings, t));
    const sellable = evals.filter(e => e.sellable).sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate)); // earliest expiry first
    const blockedUnits = evals.filter(e => !e.sellable).reduce((a, e) => a + e.qty, 0);
    const maxOrderable = Math.max(0, Number(product.stock) - blockedUnits);

    if (qty > maxOrderable) {
      const why = blockedUnits > 0 ? ' Expired or expiring-today stock cannot be sold.' : '';
      return { ok: false, error: 'Only ' + maxOrderable + ' unit(s) of ' + product.name + ' can be sold right now.' + why, lines: [], items: [], total: 0 };
    }

    let remaining = qty;
    const lines = [];
    sellable.forEach(function (e) {
      if (remaining <= 0) return;
      const take = Math.min(e.qty, remaining);
      lines.push({ batchId: e.batch.id, batchNo: e.batch.batchNo, qty: take, unitPrice: e.unitPrice, basePrice: e.basePrice, discountPct: e.discountActive ? e.discountPct : 0, expiryDate: e.batch.expiryDate, daysLeft: e.daysLeft });
      remaining -= take;
    });
    if (remaining > 0) {   // stock not tracked by any batch → regular price
      lines.push({ batchId: null, batchNo: null, qty: remaining, unitPrice: Number(product.price), basePrice: Number(product.price), discountPct: 0 });
    }

    // Order items: merge lines that share a price (keeps the order contract: productId, quantity, price)
    const byPrice = new Map();
    lines.forEach(l => byPrice.set(l.unitPrice, (byPrice.get(l.unitPrice) || 0) + l.qty));
    const items = Array.from(byPrice, ([price, quantity2]) => ({ productId: product.id, quantity: quantity2, price: price }));
    const total = round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
    return { ok: true, lines: lines, items: items, total: total };
  }

  function recordSale(productId, lines, orderId, dateISO) {
    const batches = getBatches();
    lines.forEach(function (l) {
      if (!l.batchId) return;
      const b = batches.find(x => x.id === l.batchId);
      if (!b) return;
      b.qtyAvailable = Math.max(0, Number(b.qtyAvailable) - l.qty);
      b.sales.push({ date: dateISO || today(), qty: l.qty, unitPrice: l.unitPrice, basePrice: l.basePrice, discountPct: l.discountPct, orderId: orderId });
    });
    saveBatches(batches);
    emitChange();
  }

  /* What a customer-facing product card needs (reusable by any shopping UI). */
  function getProductOffer(product) {
    const settings = getSettings(), t = today();
    const evals = productBatches(product.id).map(b => evaluateBatch(b, product, settings, t));
    const sellable = evals.filter(e => e.sellable).sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
    const blocked = evals.filter(e => !e.sellable).reduce((a, e) => a + e.qty, 0);
    const maxOrderable = Math.max(0, Number(product.stock) - blocked);
    const base = Number(product.price) || 0;

    if (!evals.length) {
      return { available: Number(product.stock) > 0, reason: Number(product.stock) > 0 ? '' : 'Out of stock', tracked: false, hasDiscount: false, unitPrice: base, basePrice: base, discountPct: 0, maxOrderable: Math.max(0, Number(product.stock)) };
    }
    if (maxOrderable <= 0) {
      const anyExpired = evals.some(e => e.expired || e.expiringToday);
      return { available: false, reason: anyExpired ? 'Expired – unavailable' : 'Out of stock', tracked: true, hasDiscount: false, unitPrice: base, basePrice: base, discountPct: 0, maxOrderable: 0 };
    }
    const head = sellable[0];
    if (!head) return { available: true, reason: '', tracked: false, hasDiscount: false, unitPrice: base, basePrice: base, discountPct: 0, maxOrderable: maxOrderable };
    return {
      available: true, reason: '', tracked: true,
      hasDiscount: head.discountActive, unitPrice: head.unitPrice, basePrice: head.basePrice,
      discountPct: head.discountActive ? head.discountPct : 0,
      expiryDate: head.batch.expiryDate, daysLeft: head.daysLeft, batchNo: head.batch.batchNo,
      maxOrderable: maxOrderable
    };
  }

  /* ==========================================================================
     NOTIFICATIONS (generated from expiry events, de-duplicated)
     ========================================================================== */
  function getNotificationsRaw() {
    const list = read(KEYS.notifications, []);
    return Array.isArray(list) ? list : [];
  }
  function getNotifications() {
    return getNotificationsRaw().slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const unreadCount = () => getNotificationsRaw().filter(n => !n.read).length;
  function markRead(id) {
    const list = getNotificationsRaw();
    const n = list.find(x => x.id === id);
    if (n && !n.read) { n.read = true; write(KEYS.notifications, list); emitChange(); }
  }
  function markAllRead() {
    const list = getNotificationsRaw();
    list.forEach(n => { n.read = true; });
    write(KEYS.notifications, list);
    emitChange();
  }

  function stageIndex(e) {
    if (e.expired) return 3;
    if (e.expiringToday) return 2;
    if (e.discountActive) return 1;
    if (e.expiryStatus === 'approaching') return 0;
    return -1;
  }
  function notificationFor(stage, e) {
    const name = e.product.name, no = e.batch.batchNo;
    const title = name + ' – Batch ' + no;
    if (stage === 'expired') return { type: 'expired', title: title, message: 'Batch ' + no + ' has expired. Removed from sale.' };
    if (stage === 'urgent') return { type: 'urgent', title: title, message: 'Batch ' + no + ' expires today. Immediate attention required.' };
    if (stage === 'discount') return { type: 'discount', title: title, message: 'Batch ' + no + ' expires in ' + plural(e.daysLeft, 'day') + '. A ' + e.discountPct + '% discount has been activated.' };
    return { type: 'warning', title: title, message: 'Batch ' + no + ' expires in ' + plural(e.daysLeft, 'day') + '.' };
  }

  /* Raises each event once per batch. Earlier stages that were skipped (for
     example the app was closed for a week) are recorded silently so the user
     only gets the alert that matters now, never a burst of stale ones. */
  function syncNotifications() {
    ensureSeeded();
    const seen = new Set(read(KEYS.events, []));
    const list = getNotificationsRaw();
    const created = [];
    let seenChanged = false;

    evaluateAll().forEach(function (e) {
      if (e.qty <= 0) return;
      const idx = stageIndex(e);
      if (idx < 0) return;
      for (let j = 0; j <= idx; j++) {
        const key = e.batch.id + '|' + STAGES[j];
        if (seen.has(key)) continue;
        seen.add(key); seenChanged = true;
        if (j !== idx) continue;                       // older stage → remember, don't notify
        const n = notificationFor(STAGES[j], e);
        const record = {
          id: 'ntf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: n.type, title: n.title, message: n.message,
          batchId: e.batch.id, productId: e.product.id,
          createdAt: new Date().toISOString(), read: false
        };
        list.push(record); created.push(record);
      }
    });

    if (seenChanged) write(KEYS.events, Array.from(seen));
    if (created.length) {
      write(KEYS.notifications, list.slice(-NOTIFICATION_LIMIT));
      emitChange();
    }
    return created;
  }

  /* ==========================================================================
     ANALYTICS
     "Saved"   = units sold WITH a discount from batches whose expiry date has passed.
     "Expired" = units still unsold when that date passed.
     Batches that have not reached expiry are NOT counted as saved or wasted.
     Waste reduction % = saved / (saved + expired) over those finished batches.
     ========================================================================== */
  function computeAnalytics(scope) {
    const t = today();
    const includeSample = scope !== 'actual';
    const batches = getBatches().filter(b => includeSample || b.source === 'actual');
    const monthly = {};
    const bucket = k => (monthly[k] = monthly[k] || { key: k, saved: 0, expired: 0, revenue: 0, discount: 0 });
    let saved = 0, expired = 0, revenue = 0, discount = 0, finishedBatches = 0;

    batches.forEach(function (b) {
      let discountedUnits = 0;
      b.sales.forEach(function (s) {
        if (s.discountPct > 0) {
          const rev = s.qty * s.unitPrice, dis = s.qty * (s.basePrice - s.unitPrice);
          revenue += rev; discount += dis; discountedUnits += s.qty;
          const m = bucket(monthKey(s.date)); m.revenue += rev; m.discount += dis;
        }
      });
      if (daysBetween(t, b.expiryDate) < 0) {          // outcome is known
        finishedBatches++;
        const left = Number(b.qtyAvailable) || 0;
        saved += discountedUnits; expired += left;
        const m = bucket(monthKey(b.expiryDate)); m.saved += discountedUnits; m.expired += left;
      }
    });

    if (includeSample) {
      sampleHistory(t).forEach(function (h) {
        saved += h.saved; expired += h.expired; revenue += h.revenue; discount += h.discount;
        const m = bucket(h.month); m.saved += h.saved; m.expired += h.expired; m.revenue += h.revenue; m.discount += h.discount;
      });
    }

    const months = Object.keys(monthly).sort().slice(-7).map(function (k) {
      const m = monthly[k], denom = m.saved + m.expired;
      return { key: k, label: monthLabel(k), saved: m.saved, expired: m.expired, revenue: round2(m.revenue), discount: round2(m.discount), reductionPct: denom ? round2(m.saved / denom * 100) : null };
    });
    const denom = saved + expired;
    return {
      scope: includeSample ? 'all' : 'actual',
      saved: saved, expired: expired, revenue: round2(revenue), discount: round2(discount),
      reductionPct: denom ? round2(saved / denom * 100) : null,
      finishedBatches: finishedBatches, months: months,
      hasData: months.length > 0
    };
  }

  /* ==========================================================================
     SMART WASTE-PREVENTION SUGGESTIONS
     ========================================================================== */
  function averageDailySales(productId, batch, t) {
    const from = addDays(t, -14);
    let units = 0;
    getOrders().forEach(function (o) {
      if (o.status === 'Cancelled' || !o.orderDate || o.orderDate < from || o.orderDate > t) return;
      (o.items || []).forEach(i => { if (i.productId === productId) units += Number(i.quantity) || 0; });
    });
    if (units > 0) return { avg: units / 14, basis: 'last 14 days of orders' };
    if (batch.sampleDailySales > 0) return { avg: batch.sampleDailySales, basis: 'sample sales rate' };
    return { avg: 0, basis: 'no recent sales' };
  }

  function getSuggestions(limit) {
    const t = today();
    const out = [];
    evaluateAll().forEach(function (e) {
      if (!e.sellable || e.daysLeft < 1 || e.daysLeft > 14 || e.qty < 5) return;
      const s = averageDailySales(e.product.id, e.batch, t);
      const projected = s.avg * e.daysLeft;
      const unsold = Math.max(0, Math.round(e.qty - projected));
      const ratio = unsold / e.qty;
      if (unsold < 3 || ratio < 0.35) return;

      const current = e.discountActive ? e.discountPct : 0;
      let text, suggestedPct = null;
      if (e.discountActive) {
        suggestedPct = Math.min(70, Math.ceil((current + (ratio >= 0.6 ? 20 : 10)) / 5) * 5);
        text = suggestedPct > current
          ? 'Consider raising the discount from ' + current + '% to about ' + suggestedPct + '%.'
          : 'Discount is already high. Consider a prominent display or a bundle offer.';
      } else {
        text = 'Consider starting the discount early or increasing the discount.';
      }
      out.push({ evaluation: e, avgDaily: s.avg, basis: s.basis, projectedSold: Math.round(projected), unsold: unsold, ratio: ratio, text: text, suggestedPct: suggestedPct });
    });
    out.sort((a, b) => b.unsold - a.unsold);
    return out.slice(0, limit || 6);
  }

  /* ==========================================================================
     LIVE SUMMARY (cards that describe stock right now)
     ========================================================================== */
  function liveSummary() {
    const evals = evaluateAll().filter(e => e.qty > 0 || e.expired);
    const holding = evals.filter(e => e.qty > 0);
    return {
      approaching: holding.filter(e => e.daysLeft > 0 && (e.expiryStatus === 'approaching' || e.expiryStatus === 'discount')).length,
      activeDiscounts: holding.filter(e => e.discountActive && e.sellable).length,
      today: holding.filter(e => e.expiringToday).length,
      expired: holding.filter(e => e.expired && !e.batch.writtenOff).length
    };
  }

  /* ---------- boot ---------- */
  ensureSeeded();
  syncNotifications();
  setInterval(syncNotifications, 60000);                 // re-check while the page stays open
  global.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf('smartmart_') === 0) global.dispatchEvent(new CustomEvent('smartmart:expiry-changed'));
  });

  global.SmartMartExpiry = {
    KEYS: KEYS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, STATUS_LABELS: STATUS_LABELS, DISCOUNT_LABELS: DISCOUNT_LABELS,
    ALLOW_SALE_ON_EXPIRY_DAY: ALLOW_SALE_ON_EXPIRY_DAY,
    esc: esc, money: money, plural: plural, round2: round2,
    today: today, isPreviewDate: isPreviewDate, setPreviewDate: setPreviewDate,
    daysBetween: daysBetween, addDays: addDays, formatDate: formatDate, formatDateTime: formatDateTime, daysLeftText: daysLeftText,
    getSettings: getSettings, saveSettings: saveSettings, resetSettings: resetSettings, validateSettings: validateSettings,
    getProducts: getProducts, getBatches: getBatches, evaluateBatch: evaluateBatch, evaluateAll: evaluateAll,
    addBatch: addBatch, setOverride: setOverride, writeOff: writeOff, deleteBatch: deleteBatch,
    clearSampleData: clearSampleData, reloadSampleData: reloadSampleData,
    quoteSale: quoteSale, recordSale: recordSale, getProductOffer: getProductOffer,
    syncNotifications: syncNotifications, getNotifications: getNotifications, unreadCount: unreadCount,
    markRead: markRead, markAllRead: markAllRead,
    computeAnalytics: computeAnalytics, getSuggestions: getSuggestions, liveSummary: liveSummary
  };
})(window);