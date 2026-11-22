/* SmartMart Expiry: SQLite read-only integration milestone.
   Shows real API data without pretending that localStorage writes reach SQLite.
   Backend mutations will be connected in a subsequent milestone. */
(function () {
  'use strict';
  const BASE = 'http://127.0.0.1:3000/api';
  const X = window.SmartMartExpiry;
  if (!X) return;

  async function readJson(path) {
    const res = await fetch(BASE + path, { cache: 'no-store' });
    if (!res.ok) throw new Error(path + ' returned HTTP ' + res.status);
    return res.json();
  }

  const prohibited = [
    '[data-act="delete"]',
    '#settingsForm button[type="submit"]', '#sReset',
    '#tReloadSample', '#tClearSample', '#sampleBannerClear',
    '#checkoutBtn', '[data-add-cart]', '[data-cart-inc]', '[data-cart-dec]',
    '#nfMarkAll', '[data-nf-read]', '[data-nf-open]'
  ];

  function blockWrites(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (prohibited.some(selector => e.target.closest(selector))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.alert('This action is temporarily disabled while we connect Expiry Management writes to SQLite. No data was changed.');
    }
  }
  // capture before existing expiry.js event handlers (important)
  document.addEventListener('click', blockWrites, true);
  // Stage 2 — API-backed expiry mutations. Never invoke old localStorage writers.
  let saving = false;
  async function sendJson(path, method, body) {
    const res = await fetch(BASE + path, {
      method: method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let result;
    try { result = await res.json(); }
    catch (_) { result = {}; }
    if (!res.ok) {
      const details = result.errors ? Object.values(result.errors).join(' ') : '';
      throw new Error(details || result.error || 'API request failed (HTTP ' + res.status + ').');
    }
    return result;
  }

  function notify(message, error) {
    const el = document.getElementById('expToast');
    if (!el) { window.alert(message); return; }
    el.textContent = message;
    el.classList.toggle('is-error', !!error);
    el.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  async function saveBatch() {
    const id = Number(document.getElementById('bProduct').value);
    const qty = Number(document.getElementById('bQty').value);
    const product = (window.SmartMartExpirySqlite?.products || []).find(p => Number(p.id) === id);
    if (!product) throw new Error('Choose an existing product.');
    if (!Number.isSafeInteger(qty) || qty < 1) throw new Error('Quantity must be a positive whole number.');

    // A batch identifies stock already recorded in Inventory; it must not create extra stock.
    const assigned = (window.SmartMartExpirySqlite?.batches || [])
      .filter(b => Number(b.productId) === id && !b.writtenOff)
      .reduce((total, b) => total + Number(b.qtyAvailable || 0), 0);
    if (assigned + qty > Number(product.stock)) {
      throw new Error('This batch would assign ' + (assigned + qty) +
        ' units, but Inventory has only ' + product.stock +
        '. Add stock in Inventory first or lower the batch quantity.');
    }
    const result = await sendJson('/expiry/batches', 'POST', {
      productId: id,
      batchNo: document.getElementById('bNo').value.trim(),
      qty: qty,
      expiryDate: document.getElementById('bDate').value
    });
    await refresh();
    document.getElementById('batchDialog').close();
    notify('Batch ' + result.batchNo + ' saved to SQLite.');
    window.location.hash = 'batches';
  }

  let editingBatchId = null;
  // Capture the exact ID; batch numbers need not be globally unique.
  document.addEventListener('click', function (e) {
    const button = e.target?.closest?.('[data-manage], [data-act="discount"]');
    if (button) editingBatchId = button.dataset.manage || button.dataset.id;
  }, true);

  async function saveDiscount() {
    const dialog = document.getElementById('discountDialog');
    const mode = document.querySelector('input[name="dMode"]:checked')?.value;
    if (!editingBatchId || !(window.SmartMartExpirySqlite?.batches || []).some(b => b.id === editingBatchId)) {
      throw new Error('Could not identify the selected batch safely. Close and reopen Manage Discount.');
    }
    const data = { mode: mode };
    if (mode === 'custom') {
      data.percent = Number(document.getElementById('dPct').value);
      data.startNow = document.getElementById('dNow').checked;
    }
    await sendJson('/expiry/batches/' + encodeURIComponent(editingBatchId) + '/discount', 'PATCH', data);
    await refresh();
    dialog.close();
    notify('Discount saved to SQLite.');
  }

  // Stage 4 — SQLite-backed Write off button.
  // Capture click before expiry.js can execute its old localStorage handler.
  let writeOffBusy = false;
  document.addEventListener('click', async function (e) {
    const button = e.target?.closest?.('[data-act="writeoff"]');
    if (!button) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (writeOffBusy) return;
    const batchId = button.dataset.id;
    const batch = window.SmartMartExpirySqlite?.batches?.find(b => b.id === batchId);
    const product = window.SmartMartExpirySqlite?.products?.find(
      p => Number(p.id) === Number(batch?.productId)
    );

    if (!batch || !product) {
      notify('Could not identify this batch. Refresh the page and try again.', true);
      return;
    }
    if (batch.writtenOff) {
      notify('This batch is already written off.', true);
      return;
    }
    // The API is authoritative: it checks expiry, quantity and duplicate writes.
    if (!window.confirm(
      'Write off ' + batch.qtyAvailable + ' expired unit(s) of ' +
      product.name + ' (batch ' + batch.batchNo + ')?\n\n' +
      'This permanently reduces Inventory stock.'
    )) return;

    writeOffBusy = true;
    button.disabled = true;
    try {
      const result = await sendJson(
        '/expiry/batches/' + encodeURIComponent(batchId) + '/write-off',
        'POST',
        {}
      );
      // Refresh from SQLite before reporting success to the user.
      await refresh();
      notify(result.units + ' unit(s) written off in SQLite.');
    } catch (error) {
      console.error('SmartMart SQLite write-off:', error);
      notify(error.message || 'Unable to write off this batch.', true);
      // Refresh even on errors, in case the request committed before a network failure.
      try { await refresh(); } catch (_) { /* refresh handles connection failures */ }
    } finally {
      writeOffBusy = false;
      button.disabled = false;
    }
  }, true);

  document.addEventListener('submit', async function (e) {
    const formId = e.target?.id;
    if (!['batchForm', 'discountForm', 'settingsForm'].includes(formId)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // Prevent old localStorage-only handler.
    if (formId === 'settingsForm') {
      notify('Settings editing is not connected yet.', true);
      return;
    }
    if (saving) return;
    saving = true;
    const button = e.target.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      if (formId === 'batchForm') await saveBatch();
      else await saveDiscount();
    } catch (err) {
      console.error('SmartMart expiry SQLite write:', err);
      notify(err.message || 'Could not save to SQLite.', true);
    } finally {
      saving = false;
      if (button) button.disabled = false;
    }
  }, true);

  const banner = document.createElement('div');
  banner.setAttribute('role', 'status');
  banner.style.cssText = 'padding:10px 16px;margin:12px 0;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155;font-size:13px';
  banner.textContent = 'Connecting Expiry Management to SQLite…';
  const content = document.getElementById('expApp');
  if (content) content.insertBefore(banner, content.firstChild);

  function coerceBatch(b) {
    return {
      id: String(b.id),
      productId: Number(b.productId),
      batchNo: String(b.batchNo),
      qtyReceived: Number(b.qtyReceived),
      qtyAvailable: Number(b.qtyAvailable),
      expiryDate: String(b.expiryDate),
      receivedDate: String(b.receivedDate || ''),
      source: String(b.source || 'actual'),
      writtenOff: Boolean(b.writtenOff),
      sales: [],
      override: b.overrideMode === 'custom' ? { mode: 'custom', pct: Number(b.overridePercent), startNow: Boolean(b.overrideStartNow) }
        : b.overrideMode === 'none' ? { mode: 'none' } : null
    };
  }

  async function refresh() {
    try {
      const [products, batches, settings] = await Promise.all([
        readJson('/products'), readJson('/expiry/batches'), readJson('/expiry/settings')
      ]);
      if (!Array.isArray(products) || !Array.isArray(batches)) throw new Error('Unexpected API response');
      // Not stored in localStorage: SQLite stays the sole authoritative source.
      window.SmartMartExpirySqlite = {
        products: products,
        batches: batches.map(coerceBatch),
        settings: settings
      };
      // Batches and pricing settings are sourced directly from the API.
      banner.textContent = 'SQLite connected — ' + batches.length + ' live batch(es) loaded. Add Batch, Manage Discount and Write off use SQLite. Checkout and other unfinished edits remain disabled.';
      banner.style.borderColor = '#86efac';
      window.dispatchEvent(new CustomEvent('smartmart:expiry-changed'));
    } catch (err) {
      console.error('SmartMart expiry SQLite sync:', err);
      banner.textContent = 'Could not load expiry data from SQLite: ' + err.message + '. Start the backend on port 3000. Editing remains disabled.';
      banner.style.borderColor = '#fca5a5';
    }
  }
  refresh();
  window.addEventListener('focus', refresh);
})();
