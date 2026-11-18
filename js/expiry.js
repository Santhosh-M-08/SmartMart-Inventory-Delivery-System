/* ==========================================================================
   SmartMart — Expiry Management page (NEW FILE)
   File: js/expiry.js
   Needs (in this order): data.js, expiry-core.js, expiry-bell.js
   ========================================================================== */
(function () {
  'use strict';
  const X = window.SmartMartExpiry;
  if (!X) { console.error('expiry-core.js must load before expiry.js'); return; }

  const $ = id => document.getElementById(id);
  const esc = X.esc, money = X.money;
  const TABS = ['overview', 'batches', 'settings', 'notifications', 'shop'];
  const EMOJI = { Dairy: '🥛', Bakery: '🍞', Fruits: '🍎', Grains: '🌾', Snacks: '🍪', Beverages: '🧃', Oils: '🫒', 'Personal Care': '🧼', Groceries: '🛒' };
  const state = { tab: 'overview', scope: 'all', search: '', category: 'all', expiry: 'all', discount: 'all', source: 'all', sort: 'nearest', nf: 'all', highlight: null, cart: {} };
  let toastTimer;

  const emoji = p => EMOJI[p.category] || '📦';
  function toast(msg, isError) {
    const t = $('expToast');
    t.textContent = msg; t.classList.toggle('is-error', !!isError); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const short = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n * 10) / 10));

  /* ====================== layout: sidebar, logout, date ====================== */
  function initShell() {
    const sidebar = $('sidebar'), toggle = $('menuToggle'), overlay = $('sidebarOverlay');
    function closeSidebar() { sidebar.classList.remove('sidebar-open'); overlay.classList.remove('overlay-visible'); toggle.setAttribute('aria-expanded', 'false'); }
    toggle.addEventListener('click', function () {
      const open = sidebar.classList.toggle('sidebar-open');
      overlay.classList.toggle('overlay-visible', open); toggle.setAttribute('aria-expanded', String(open));
    });
    overlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) closeSidebar(); });
    $('logoutButton').addEventListener('click', function () {
      sessionStorage.removeItem('smartmart_demo_logged_in');
      window.location.href = 'login.html';
    });
    $('currentDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ====================== tabs ====================== */
  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = 'overview';
    state.tab = name;
    document.querySelectorAll('.exp-tab').forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    TABS.forEach(t => { $('pane-' + t).hidden = t !== name; });
    const url = location.pathname + location.search + '#' + name;
    if (location.hash !== '#' + name) history.replaceState(null, '', url);
    renderAll();
  }

  function renderAll() {
    renderBanners();
    const unread = X.unreadCount();
    $('tabUnread').hidden = unread === 0; $('tabUnread').textContent = unread;
    ({ overview: renderOverview, batches: renderBatches, settings: renderSettingsTab, notifications: renderNotifications, shop: renderShop })[state.tab]();
  }

  function renderBanners() {
    const preview = X.isPreviewDate();
    $('previewBanner').hidden = !preview;
    if (preview) $('previewBannerText').textContent = 'Preview mode: the page is pretending today is ' + X.formatDate(X.today()) + '. Expiry dates and discounts follow that date.';
    $('sampleBanner').hidden = !X.getBatches().some(b => b.source === 'sample');
  }

  /* ====================== overview ====================== */
  function card(label, icon, cls, value, note) {
    return '<article class="exp-card"><div class="exp-card-top"><span class="exp-card-label">' + esc(label) + '</span><span class="exp-card-icon ' + cls + '" aria-hidden="true">' + icon + '</span></div>' +
      '<p class="exp-card-value">' + value + '</p><p class="exp-card-note">' + esc(note) + '</p></article>';
  }

  function renderOverview() {
    renderAlerts();
    const live = X.liveSummary();
    $('liveCards').innerHTML =
      card('Approaching Expiry', '◔', 'is-amber', live.approaching, 'Batches expiring within the warning window') +
      card('Active Discounts', '%', 'is-green', live.activeDiscounts, 'Batches currently discounted') +
      card('Expiring Today', '⚑', 'is-amber', live.today, 'Removed from sale today') +
      card('Expired Products', '✕', 'is-red', live.expired, 'Expired batches still in stock');

    const a = X.computeAnalytics(state.scope);
    document.querySelectorAll('[data-scope]').forEach(b => b.classList.toggle('is-active', b.dataset.scope === state.scope));
    $('analyticsNote').textContent = (state.scope === 'actual' ? 'Actual records only. ' : 'Includes clearly labelled sample history. ') +
      'Saved and expired count only batches whose expiry date has passed (' + X.plural(a.finishedBatches, 'finished batch') + ' from live records).';
    $('analyticsCards').innerHTML =
      card('Products Saved from Expiry', '✓', 'is-green', a.saved.toLocaleString('en-IN'), 'Units sold at a discount before expiry') +
      card('Revenue from Discounted Products', '₹', 'is-green', money(a.revenue), 'Sales made with an expiry discount') +
      card('Total Discount Given', '%', 'is-blue', money(a.discount), 'Value given back to customers') +
      card('Food Waste Reduction', '♻', 'is-green', a.reductionPct === null ? '—' : a.reductionPct + '%', a.reductionPct === null ? 'No finished batches yet' : a.saved + ' saved vs ' + a.expired + ' expired');

    const labels = a.months.map(m => m.label);
    drawBars($('chartSaved'), labels, [{ name: 'Saved', color: '#22C55E', values: a.months.map(m => m.saved) }], short);
    drawBars($('chartExpired'), labels, [{ name: 'Expired', color: '#DC2626', values: a.months.map(m => m.expired) }], short);
    drawBars($('chartSales'), labels, [
      { name: 'Revenue', color: '#166534', values: a.months.map(m => m.revenue) },
      { name: 'Discount given', color: '#F59E0B', values: a.months.map(m => m.discount) }], v => '₹' + short(v));
    drawLine($('chartTrend'), labels, a.months.map(m => m.reductionPct));
    renderSuggestions();
  }

  function renderAlerts() {
    const sev = { expired: 0, urgent: 1, discount: 2, warning: 3 };
    const list = [];
    X.evaluateAll().forEach(function (e) {
      if (e.qty <= 0) return;
      const name = '<strong>' + esc(e.product.name) + '</strong> – Batch ' + esc(e.batch.batchNo);
      let type = null, text = '';
      if (e.expired && !e.batch.writtenOff) { type = 'expired'; text = ' has expired and is removed from sale.'; }
      else if (e.expiringToday) { type = 'urgent'; text = ' expires today. Immediate attention required.'; }
      else if (e.discountActive && e.sellable) { type = 'discount'; text = ' expires in ' + X.plural(e.daysLeft, 'day') + '. ' + e.discountPct + '% discount is active.'; }
      else if (e.expiryStatus === 'approaching') { type = 'warning'; text = ' expires in ' + X.plural(e.daysLeft, 'day') + '.'; }
      if (type) list.push({ type: type, html: name + text, id: e.batch.id, days: e.daysLeft });
    });
    list.sort((a, b) => sev[a.type] - sev[b.type] || a.days - b.days);
    $('alertsBox').innerHTML = list.length
      ? list.slice(0, 5).map(a => '<div class="exp-alert exp-alert--' + a.type + '"><span>' + a.html + '</span><a data-open-batch="' + esc(a.id) + '">View batch</a></div>').join('') +
        (list.length > 5 ? '<div class="exp-help">+' + (list.length - 5) + ' more on the Batches tab.</div>' : '')
      : '<div class="exp-alert exp-alert--discount"><span>No urgent expiry alerts right now.</span></div>';
  }

  function renderSuggestions() {
    const list = X.getSuggestions(6);
    $('suggestions').innerHTML = list.length ? list.map(function (s) {
      const e = s.evaluation;
      return '<div class="exp-suggest"><div><h4>' + esc(e.product.name) + '</h4><small>Batch ' + esc(e.batch.batchNo) + ' · ' + esc(X.daysLeftText(e.daysLeft)) + '</small></div>' +
        '<div><p><strong>' + e.qty + ' units left</strong>, about ' + s.unsold + ' likely to remain unsold.</p>' +
        '<p>' + esc(s.text) + '</p><span class="exp-suggest-meta">Avg ' + (Math.round(s.avgDaily * 10) / 10) + ' units/day (' + esc(s.basis) + ') · projected ' + s.projectedSold + ' sold before expiry</span></div>' +
        '<button type="button" class="exp-btn exp-btn--small" data-manage="' + esc(e.batch.id) + '">Review discount</button></div>';
    }).join('') : '<div class="exp-empty"><h4>No batches at risk</h4><p>Stock levels look healthy for the days remaining.</p></div>';
  }

  /* ====================== charts (plain SVG, no library) ====================== */
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function emptyChart(el) { el.innerHTML = '<div class="exp-empty"><h4>No data yet</h4><p>Charts appear once batches have passed their expiry date, or when sample data is included.</p></div>'; }
  function legend(series) { return '<div class="exp-legend">' + series.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') + '</div>'; }

  function frame(maxV, fmt, W, H, L, T, B) {
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = T + (H - T - B) * (1 - i / 4);
      g += '<line x1="' + L + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '" stroke="#E2E8F0"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmt(maxV * i / 4) + '</text>';
    }
    return g;
  }

  function drawBars(el, labels, series, fmt) {
    if (!labels.length) return emptyChart(el);
    const W = 560, H = 250, L = 48, T = 12, B = 32, n = labels.length;
    const maxV = niceMax(Math.max.apply(null, series.reduce((a, s) => a.concat(s.values), [0])));
    const group = (W - L - 8) / n, bw = Math.min(34, group * 0.72 / series.length);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart">' + frame(maxV, fmt, W, H, L, T, B);
    labels.forEach(function (lab, i) {
      const cx = L + group * i + group / 2;
      series.forEach(function (s, k) {
        const v = s.values[i], h = (H - T - B) * (v / maxV), x = cx - (bw * series.length) / 2 + bw * k, y = H - B - h;
        svg += '<rect x="' + x + '" y="' + y + '" width="' + (bw - 2) + '" height="' + Math.max(h, 0) + '" rx="3" fill="' + s.color + '"><title>' + esc(lab + ' · ' + s.name + ': ' + fmt(v)) + '</title></rect>';
        if (n <= 7 && series.length === 1 && v > 0) svg += '<text x="' + (x + (bw - 2) / 2) + '" y="' + (y - 4) + '" text-anchor="middle">' + fmt(v) + '</text>';
      });
      svg += '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(lab) + '</text>';
    });
    el.innerHTML = (series.length > 1 ? legend(series) : '') + svg + '</svg>';
  }

  function drawLine(el, labels, values) {
    if (!labels.length || values.every(v => v === null)) return emptyChart(el);
    const W = 560, H = 250, L = 48, T = 12, B = 32, n = labels.length, step = (W - L - 8) / n;
    const fmt = v => Math.round(v) + '%';
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Line chart">' + frame(100, fmt, W, H, L, T, B);
    let path = '', pen = false, dots = '';
    values.forEach(function (v, i) {
      const x = L + step * i + step / 2;
      svg += '<text x="' + x + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
      if (v === null) { pen = false; return; }
      const y = H - B - (H - T - B) * (v / 100);
      path += (pen ? ' L' : ' M') + x + ' ' + y; pen = true;
      dots += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#22C55E" stroke="#fff" stroke-width="2"><title>' + esc(labels[i] + ': ' + v + '%') + '</title></circle>' +
        '<text x="' + x + '" y="' + (y - 9) + '" text-anchor="middle">' + v + '%</text>';
    });
    el.innerHTML = svg + '<path d="' + path + '" fill="none" stroke="#166534" stroke-width="2.5" stroke-linejoin="round"/>' + dots + '</svg>';
  }

  /* ====================== batches table ====================== */
  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    const rows = X.evaluateAll().filter(e =>
      (!q || e.product.name.toLowerCase().includes(q)) &&
      (state.category === 'all' || e.product.category === state.category) &&
      (state.expiry === 'all' || e.expiryStatus === state.expiry) &&
      (state.discount === 'all' || e.discountStatus === state.discount) &&
      (state.source === 'all' || e.batch.source === state.source));
    const by = {
      nearest: (a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate),
      farthest: (a, b) => b.batch.expiryDate.localeCompare(a.batch.expiryDate),
      name: (a, b) => a.product.name.localeCompare(b.product.name),
      qty: (a, b) => b.qty - a.qty
    };
    return rows.sort(by[state.sort]);
  }

  function rowHtml(e) {
    const b = e.batch, p = e.product;
    const sched = e.discountStatus === 'scheduled';
    const pctCell = e.discountActive ? '<span class="exp-off">' + e.discountPct + '% OFF</span>' : sched ? '<span class="exp-muted">' + e.discountPct + '%</span>' : '<span class="exp-muted">—</span>';
    const priceCell = e.discountActive ? '<span class="exp-price-new">' + money(e.unitPrice) + '</span>'
      : sched ? '<span class="exp-muted" title="Applies from ' + esc(X.formatDate(e.discountStartsOn)) + '">' + money(X.round2(e.basePrice * (1 - e.discountPct / 100))) + '</span>' : '<span class="exp-muted">—</span>';
    const cls = e.expired ? 'is-expired' : e.expiringToday ? 'is-today' : '';
    const discBadge = '<span class="exp-badge exp-badge--' + e.discountStatus + '">' + esc(e.discountLabel) + '</span>' +
      (sched ? '<br><small class="exp-muted">from ' + esc(X.formatDate(e.discountStartsOn)) + '</small>' : '');
    let actions = '<button type="button" class="exp-btn exp-btn--small" data-act="view" data-id="' + esc(b.id) + '">View</button>';
    if (!e.expired) actions += '<button type="button" class="exp-btn exp-btn--small" data-act="discount" data-id="' + esc(b.id) + '">Discount</button>';
    else if (b.writtenOff) actions += '<span class="exp-muted" style="align-self:center;font-size:12px">Written off</span>';
    else if (e.qty > 0) actions += '<button type="button" class="exp-btn exp-btn--small exp-btn--danger" data-act="writeoff" data-id="' + esc(b.id) + '">Write off</button>';
    return '<tr data-batch="' + esc(b.id) + '" class="' + cls + '">' +
      '<td><div class="exp-thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : emoji(p)) + '</div></td>' +
      '<td><strong>' + esc(p.name) + '</strong></td>' +
      '<td>' + esc(b.batchNo) + (b.source === 'sample' ? '<span class="exp-chip">Sample</span>' : '') + '</td>' +
      '<td>' + esc(p.category) + '</td><td class="num">' + e.qty + '</td><td class="num">' + money(e.basePrice) + '</td>' +
      '<td class="num">' + pctCell + '</td><td class="num">' + priceCell + '</td>' +
      '<td>' + esc(X.formatDate(b.expiryDate)) + '</td><td>' + esc(X.daysLeftText(e.daysLeft)) + '</td>' +
      '<td><span class="exp-badge exp-badge--' + e.expiryStatus + '">' + esc(e.expiryLabel) + '</span></td><td>' + discBadge + '</td>' +
      '<td><div class="exp-actions">' + actions + '</div></td></tr>';
  }

  function renderBatches() {
    const all = X.evaluateAll();
    const cats = Array.from(new Set(all.map(e => e.product.category))).sort();
    if (state.category !== 'all' && cats.indexOf(state.category) === -1) state.category = 'all';
    $('fCategory').innerHTML = '<option value="all">All categories</option>' + cats.map(c => '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    ['fExpiry:expiry', 'fDiscount:discount', 'fSource:source', 'fSort:sort'].forEach(p => { const [id, key] = p.split(':'); $(id).value = state[key]; });
    $('fSearch').value = state.search;

    const rows = filteredRows();
    $('batchRows').innerHTML = rows.map(rowHtml).join('');
    $('tableCount').textContent = rows.length + ' of ' + all.length + ' batches shown. Every batch is tracked separately.';
    document.querySelector('.exp-table-wrap').hidden = rows.length === 0;
    const empty = $('batchEmpty');
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.innerHTML = all.length
        ? '<h4>No matching batches</h4><p>Try a different search or clear the filters.</p><button type="button" class="exp-btn" data-clear>Clear filters</button>'
        : '<h4>No batches yet</h4><p>Add a batch to start tracking expiry dates.</p><button type="button" class="exp-btn exp-btn--primary" data-add>+ Add batch</button>';
    }
    if (state.highlight) {
      const tr = document.querySelector('tr[data-batch="' + state.highlight + '"]');
      if (tr) { tr.classList.add('is-highlight'); tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      state.highlight = null;
    }
  }

  function clearFilters() { Object.assign(state, { search: '', category: 'all', expiry: 'all', discount: 'all', source: 'all', sort: 'nearest' }); renderBatches(); }

  function openBatch(id) {
    clearFilters(); state.highlight = id;
    showTab('batches');
    setTimeout(function () { const tr = document.querySelector('tr.is-highlight'); if (tr) setTimeout(() => tr.classList.remove('is-highlight'), 4000); }, 50);
  }

  /* ---------- dialogs ---------- */
  function findEval(id) { return X.evaluateAll().find(e => e.batch.id === id); }

  function openDetails(id) {
    const e = findEval(id); if (!e) return;
    const b = e.batch;
    $('detailTitle').textContent = e.product.name + ' – Batch ' + b.batchNo;
    $('detailSub').textContent = e.product.category + (b.source === 'sample' ? ' · Sample batch' : ' · Actual batch');
    const sales = b.sales.slice(-8).reverse();
    $('detailBody').innerHTML =
      '<div class="exp-detail-grid">' +
      '<div><span>Expiry date</span><strong>' + esc(X.formatDate(b.expiryDate)) + '</strong></div>' +
      '<div><span>Days remaining</span><strong>' + esc(X.daysLeftText(e.daysLeft)) + '</strong></div>' +
      '<div><span>Available / received</span><strong>' + e.qty + ' / ' + (b.qtyReceived || e.qty) + '</strong></div>' +
      '<div><span>Expiry status</span><span class="exp-badge exp-badge--' + e.expiryStatus + '" style="color:inherit">' + esc(e.expiryLabel) + '</span></div>' +
      '<div><span>Original price</span><strong>' + money(e.basePrice) + '</strong></div>' +
      '<div><span>Current selling price</span><strong class="' + (e.discountActive ? 'exp-price-new' : '') + '">' + money(e.unitPrice) + '</strong></div>' +
      '<div><span>Discount</span><strong>' + (e.discountActive ? e.discountPct + '% OFF (active)' : e.discountStatus === 'scheduled' ? e.discountPct + '% from ' + esc(X.formatDate(e.discountStartsOn)) : esc(e.discountLabel)) + '</strong></div>' +
      '<div><span>Discount rule</span><strong>' + (e.mode === 'custom' ? 'Custom for this batch' : e.mode === 'none' ? 'Disabled for this batch' : 'Store setting') + '</strong></div></div>' +
      '<p class="exp-group-label">Recent sales from this batch</p>' +
      (sales.length ? '<div class="exp-table-wrap"><table class="exp-table" style="min-width:0"><thead><tr><th>Date</th><th class="num">Qty</th><th class="num">Unit price</th><th>Discount</th></tr></thead><tbody>' +
        sales.map(s => '<tr><td>' + esc(X.formatDate(s.date)) + '</td><td class="num">' + s.qty + '</td><td class="num">' + money(s.unitPrice) + '</td><td>' + (s.discountPct ? s.discountPct + '%' : '—') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="exp-help">No sales recorded for this batch yet.</p>');
    const foot = document.querySelector('#detailDialog .exp-dialog-actions');
    foot.innerHTML = (!e.expired ? '<button type="button" class="exp-btn" data-act="discount" data-id="' + esc(b.id) + '">Manage discount</button>' : '') +
      (!b.sales.length ? '<button type="button" class="exp-btn exp-btn--danger" data-act="delete" data-id="' + esc(b.id) + '">Delete batch</button>' : '') +
      '<button type="button" class="exp-btn" data-close="detailDialog">Close</button>';
    $('detailDialog').showModal();
  }

  let discountId = null;
  function openDiscount(id) {
    const e = findEval(id); if (!e) return;
    discountId = id;
    const s = X.getSettings();
    $('discountSub').textContent = e.product.name + ' – Batch ' + e.batch.batchNo + ' · expires ' + X.formatDate(e.batch.expiryDate);
    $('dAutoText').textContent = s.enabled ? 'Uses the store setting: ' + s.discountPercent + '% starting ' + X.plural(s.activationDays, 'day') + ' before expiry.' : 'Automatic discounts are currently turned off in settings.';
    document.querySelector('input[name="dMode"][value="' + e.mode + '"]').checked = true;
    $('dPct').value = e.mode === 'custom' ? e.batch.override.pct : s.discountPercent;
    $('dNow').checked = !!(e.batch.override && e.batch.override.startNow);
    $('eDPct').textContent = '';
    syncDiscountBox();
    if ($('detailDialog').open) $('detailDialog').close();
    $('discountDialog').showModal();
  }
  function syncDiscountBox() { $('dCustomBox').hidden = document.querySelector('input[name="dMode"]:checked').value !== 'custom'; }

  function openBatchForm() {
    const products = X.getProducts();
    if (!products.length) { toast('Add a product in Inventory first.', true); return; }
    $('batchForm').reset();
    ['eBProduct', 'eBNo', 'eBQty', 'eBDate'].forEach(i => { $(i).textContent = ''; });
    $('bProduct').innerHTML = '<option value="">Choose a product</option>' + products.map(p => '<option value="' + p.id + '">' + esc(p.name) + ' (' + esc(p.category) + ')</option>').join('');
    $('batchDialog').showModal();
  }

  function onBatchSubmit(ev) {
    ev.preventDefault();
    const r = X.addBatch({ productId: $('bProduct').value, batchNo: $('bNo').value, qty: $('bQty').value, expiryDate: $('bDate').value });
    ['eBProduct:productId', 'eBNo:batchNo', 'eBQty:qty', 'eBDate:expiryDate'].forEach(p => { const [i, k] = p.split(':'); $(i).textContent = (r.errors && r.errors[k]) || ''; });
    if (!r.ok) { toast('Please fix the highlighted fields.', true); return; }
    $('batchDialog').close(); toast('Batch ' + r.batch.batchNo + ' added.');
    state.highlight = r.batch.id; showTab('batches');
  }

  function onDiscountSubmit(ev) {
    ev.preventDefault();
    const mode = document.querySelector('input[name="dMode"]:checked').value;
    const r = X.setOverride(discountId, mode === 'auto' ? null : { mode: mode, pct: $('dPct').value, startNow: $('dNow').checked });
    if (!r.ok) { $('eDPct').textContent = r.error; return; }
    $('discountDialog').close(); toast('Discount updated.');
  }

  /* ====================== settings ====================== */
  function loadSettingsForm() {
    const s = X.getSettings();
    $('sEnabled').checked = s.enabled;
    const preset = [3, 4, 5].indexOf(s.activationDays) !== -1;
    $('sDaysSelect').value = preset ? String(s.activationDays) : 'custom';
    $('sDaysCustom').hidden = preset; $('sDaysCustom').value = preset ? '' : s.activationDays;
    $('sPct').value = s.discountPercent; $('sWarn').value = s.warningDays;
    ['eDays', 'ePct', 'eWarn'].forEach(i => { $(i).textContent = ''; });
    ['sDaysField', 'sPctField', 'sWarnField'].forEach(i => $(i).classList.remove('has-error'));
    renderPreview();
  }
  function readSettingsForm() {
    return {
      enabled: $('sEnabled').checked,
      activationDays: $('sDaysSelect').value === 'custom' ? $('sDaysCustom').value : $('sDaysSelect').value,
      discountPercent: $('sPct').value, warningDays: $('sWarn').value
    };
  }
  function renderSettingsTab() {
    if (!$('settingsForm').dataset.ready) { loadSettingsForm(); $('settingsForm').dataset.ready = '1'; }
    $('tDate').value = X.isPreviewDate() ? X.today() : '';
  }
  function renderPreview() {
    const v = X.validateSettings(readSettingsForm());
    const box = $('settingsPreview');
    if (!v.ok) { box.innerHTML = '<h4>Preview</h4><p class="exp-help">Enter valid values to see an example.</p>'; return; }
    const s = v.value, expiry = X.addDays(X.today(), 10), start = X.addDays(expiry, -s.activationDays);
    const price = 100, disc = X.round2(price * (1 - s.discountPercent / 100));
    box.innerHTML = '<h4>Example with these settings</h4><div>Milk · original price ' + money(price) + ' · expires ' + esc(X.formatDate(expiry)) + '</div>' +
      (s.enabled ? '<ul><li>Before ' + esc(X.formatDate(start)) + ': normal price ' + money(price) + '</li>' +
        '<li>From ' + esc(X.formatDate(start)) + ': <strong>' + s.discountPercent + '% OFF → ' + money(disc) + '</strong></li>' +
        '<li>On ' + esc(X.formatDate(expiry)) + ': expiring today, removed from sale</li>' +
        '<li>After that: marked Expired</li></ul>'
        : '<ul><li>Automatic discounts are <strong>off</strong>: price stays ' + money(price) + ' until expiry.</li><li>Products are still marked expired and removed from sale.</li></ul>');
  }
  function onSettingsSubmit(ev) {
    ev.preventDefault();
    const r = X.saveSettings(readSettingsForm());
    [['eDays', 'sDaysField', 'activationDays'], ['ePct', 'sPctField', 'discountPercent'], ['eWarn', 'sWarnField', 'warningDays']].forEach(function (t) {
      $(t[0]).textContent = (r.errors && r.errors[t[2]]) || ''; $(t[1]).classList.toggle('has-error', !!(r.errors && r.errors[t[2]]));
    });
    if (!r.ok) { toast('Please fix the highlighted fields.', true); return; }
    toast('Settings saved. Prices and labels are updated.');
  }

  /* ====================== notifications page ====================== */
  const ICON = { warning: '!', urgent: '⚑', discount: '%', expired: '✕' };
  function renderNotifications() {
    document.querySelectorAll('[data-nf]').forEach(b => b.classList.toggle('is-active', b.dataset.nf === state.nf));
    $('nfMarkAll').disabled = X.unreadCount() === 0;
    const list = X.getNotifications().filter(n => state.nf === 'all' || !n.read);
    $('nfList').innerHTML = list.length ? '<ul class="exp-ntf-list">' + list.map(n =>
      '<li class="exp-ntf exp-ntf--' + esc(n.type) + (n.read ? '' : ' is-unread') + '"><button type="button" class="exp-ntf-main" data-nf-open="' + esc(n.id) + '">' +
      '<span class="exp-ntf-icon" aria-hidden="true">' + (ICON[n.type] || '!') + '</span><span class="exp-ntf-body"><span class="exp-ntf-title">' + esc(n.title) + '</span>' +
      '<span class="exp-ntf-msg">' + esc(n.message) + '</span><span class="exp-ntf-time">' + esc(X.formatDateTime(n.createdAt)) + '</span></span></button>' +
      (n.read ? '' : '<button type="button" class="exp-ntf-read" data-nf-read="' + esc(n.id) + '">Mark read</button>') + '</li>').join('') + '</ul>'
      : '<div class="exp-empty"><h4>' + (state.nf === 'unread' ? 'No unread notifications' : 'No notifications yet') + '</h4><p>Alerts appear automatically when batches approach expiry.</p></div>';
  }

  /* ====================== customer preview ====================== */
  function renderShop() {
    const products = X.getProducts();
    $('shopGrid').innerHTML = products.length ? products.map(function (p) {
      const o = X.getProductOffer(p);
      const shelf = o.tracked && o.available ? '<span class="exp-shelf' + (o.daysLeft > 5 ? ' is-green' : '') + '">Expires ' + esc(X.formatDate(o.expiryDate)) + ' · ' + esc(X.daysLeftText(o.daysLeft)) + '</span>' : '';
      return '<article class="exp-product' + (o.available ? '' : ' is-unavailable') + '">' +
        (o.hasDiscount ? '<span class="exp-off">' + o.discountPct + '% OFF</span>' : '') +
        '<div class="exp-product-img" aria-hidden="true">' + emoji(p) + '</div><h4>' + esc(p.name) + '</h4><small>' + esc(p.category) + '</small>' +
        '<div class="exp-price-line">' + (o.hasDiscount ? '<span class="exp-price-new">' + money(o.unitPrice) + '</span><span class="exp-strike">' + money(o.basePrice) + '</span>' : '<span class="exp-price-new" style="color:inherit">' + money(o.unitPrice) + '</span>') + '</div>' +
        shelf + '<button type="button" class="exp-btn exp-btn--primary exp-btn--small" data-add-cart="' + p.id + '"' + (o.available ? '' : ' disabled') + '>' + (o.available ? 'Add to cart' : esc(o.reason || 'Unavailable')) + '</button></article>';
    }).join('') : '<div class="exp-empty"><h4>No products</h4><p>Add products in Inventory to preview the shop.</p></div>';
    renderCart();
  }

  function cartQuotes() {
    const products = X.getProducts(), out = [];
    Object.keys(state.cart).forEach(function (id) {
      const p = products.find(x => x.id === Number(id));
      if (!p) { delete state.cart[id]; return; }
      out.push({ p: p, qty: state.cart[id], q: X.quoteSale(p, state.cart[id]) });   // price is always re-validated here
    });
    return out;
  }
  function renderCart() {
    const lines = cartQuotes();
    let total = 0, blocked = false;
    $('cartLines').innerHTML = lines.length ? lines.map(function (l) {
      if (l.q.ok) total += l.q.total; else blocked = true;
      const detail = l.q.ok ? l.q.lines.map(x => x.qty + ' × ' + money(x.unitPrice) + (x.discountPct ? ' (' + x.discountPct + '% OFF)' : '')).join(' + ') : '';
      return '<div class="exp-cart-line"><span><strong>' + esc(l.p.name) + '</strong></span><span>' + (l.q.ok ? money(l.q.total) : '—') + '</span>' +
        '<span class="exp-qty"><button type="button" data-cart-dec="' + l.p.id + '" aria-label="Decrease">−</button>' + l.qty + '<button type="button" data-cart-inc="' + l.p.id + '" aria-label="Increase">+</button></span><span></span>' +
        (detail ? '<small>' + esc(detail) + '</small>' : '') + (l.q.ok ? '' : '<span class="exp-error">' + esc(l.q.error) + '</span>') + '</div>';
    }).join('') : '<p class="exp-help">Your cart is empty. Add a product to see discounted prices applied.</p>';
    $('cartTotal').textContent = money(total);
    $('checkoutBtn').disabled = !lines.length || blocked;
  }
  function changeCart(id, delta) {
    const p = X.getProducts().find(x => x.id === Number(id)); if (!p) return;
    const next = (state.cart[id] || 0) + delta;
    if (next <= 0) delete state.cart[id];
    else {
      const o = X.getProductOffer(p);
      if (!o.available) { toast(p.name + ' is unavailable.', true); return; }
      if (next > o.maxOrderable) { toast('Only ' + o.maxOrderable + ' unit(s) of ' + p.name + ' available.', true); return; }
      state.cart[id] = next;
    }
    renderCart();
  }
  function checkout() {
    const name = $('cartName').value.trim();
    if (!name) { toast('Enter the customer name.', true); $('cartName').focus(); return; }
    if (typeof createOrder !== 'function') { toast('Order module (js/data.js) is not loaded.', true); return; }
    const items = Object.keys(state.cart).map(id => ({ productId: Number(id), quantity: state.cart[id] }));   // no prices sent
    try {
      const order = createOrder(name, items);
      state.cart = {}; $('cartName').value = '';
      toast('Order #' + order.id + ' placed. Total ' + money(order.total) + '.');
      renderAll();
    } catch (err) { toast(err.message || 'Could not place the order.', true); renderAll(); }
  }

  /* ====================== events ====================== */
  function init() {
    initShell();
    document.querySelectorAll('.exp-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.indexOf(h) !== -1 && h !== state.tab) showTab(h); });
    window.addEventListener('smartmart:expiry-changed', renderAll);
    window.addEventListener('smartmart:open-batch', function (e) { e.preventDefault(); openBatch(e.detail.id); });

    document.addEventListener('click', function (e) {
      const t = e.target;
      let el;
      if ((el = t.closest('[data-close]'))) { $(el.dataset.close).close(); return; }
      if ((el = t.closest('[data-open-batch]'))) { openBatch(el.dataset.openBatch); return; }
      if ((el = t.closest('[data-manage]'))) { openDiscount(el.dataset.manage); return; }
      if ((el = t.closest('[data-scope]'))) { state.scope = el.dataset.scope; renderOverview(); return; }
      if ((el = t.closest('[data-nf]'))) { state.nf = el.dataset.nf; renderNotifications(); return; }
      if ((el = t.closest('[data-nf-read]'))) { X.markRead(el.dataset.nfRead); return; }
      if ((el = t.closest('[data-nf-open]'))) { const n = X.getNotifications().find(x => x.id === el.dataset.nfOpen); if (n) { X.markRead(n.id); openBatch(n.batchId); } return; }
      if ((el = t.closest('[data-add-cart]'))) { changeCart(el.dataset.addCart, 1); return; }
      if ((el = t.closest('[data-cart-inc]'))) { changeCart(el.dataset.cartInc, 1); return; }
      if ((el = t.closest('[data-cart-dec]'))) { changeCart(el.dataset.cartDec, -1); return; }
      if (t.closest('[data-clear]')) { clearFilters(); return; }
      if (t.closest('[data-add]')) { openBatchForm(); return; }
      if ((el = t.closest('[data-act]'))) {
        const id = el.dataset.id, act = el.dataset.act;
        if (act === 'view') openDetails(id);
        else if (act === 'discount') openDiscount(id);
        else if (act === 'writeoff') {
          const ev = findEval(id);
          if (ev && window.confirm('Write off ' + ev.qty + ' expired unit(s) of ' + ev.product.name + '? This reduces the product stock in Inventory.')) {
            const r = X.writeOff(id); toast(r.ok ? r.units + ' unit(s) written off.' : r.error, !r.ok);
          }
        } else if (act === 'delete') {
          if (window.confirm('Delete this batch? This cannot be undone.')) { const r = X.deleteBatch(id); if (r.ok) { $('detailDialog').close(); toast('Batch deleted.'); } else toast(r.error, true); }
        }
      }
    });

    // filters
    $('fSearch').addEventListener('input', e => { state.search = e.target.value; renderBatchRowsOnly(); });
    [['fCategory', 'category'], ['fExpiry', 'expiry'], ['fDiscount', 'discount'], ['fSource', 'source'], ['fSort', 'sort']].forEach(p => $(p[0]).addEventListener('change', e => { state[p[1]] = e.target.value; renderBatchRowsOnly(); }));
    $('fClear').addEventListener('click', clearFilters);
    $('addBatchBtn').addEventListener('click', openBatchForm);
    $('batchForm').addEventListener('submit', onBatchSubmit);
    $('discountForm').addEventListener('submit', onDiscountSubmit);
    document.querySelectorAll('input[name="dMode"]').forEach(r => r.addEventListener('change', syncDiscountBox));
    document.querySelectorAll('.exp-dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    // settings
    $('settingsForm').addEventListener('submit', onSettingsSubmit);
    $('settingsForm').addEventListener('input', renderPreview);
    $('settingsForm').addEventListener('change', function () { $('sDaysCustom').hidden = $('sDaysSelect').value !== 'custom'; renderPreview(); });
    $('sReset').addEventListener('click', function () { X.resetSettings(); loadSettingsForm(); toast('Settings reset to default (3 days, 50%).'); });
    $('tApply').addEventListener('click', function () { if (!$('tDate').value) { toast('Choose a date first.', true); return; } X.setPreviewDate($('tDate').value); toast('Preview date applied.'); });
    const resetDate = function () { X.setPreviewDate(null); $('tDate').value = ''; toast('Using the real date.'); };
    $('tReset').addEventListener('click', resetDate); $('previewBannerReset').addEventListener('click', resetDate);
    $('tReloadSample').addEventListener('click', function () { const n = X.reloadSampleData(); toast(n + ' sample batches loaded.'); });
    const clearSample = function () { if (window.confirm('Remove all sample batches and their alerts? Your own batches are kept.')) { X.clearSampleData(); toast('Sample data cleared.'); } };
    $('tClearSample').addEventListener('click', clearSample); $('sampleBannerClear').addEventListener('click', clearSample);

    // notifications + shop
    $('nfMarkAll').addEventListener('click', () => X.markAllRead());
    $('checkoutBtn').addEventListener('click', checkout);

    // initial route: ?batch=ID#batches or #tab
    const params = new URLSearchParams(location.search), batch = params.get('batch'), hash = location.hash.slice(1);
    if (batch) { history.replaceState(null, '', location.pathname + '#batches'); openBatch(batch); }
    else showTab(TABS.indexOf(hash) !== -1 ? hash : 'overview');
  }

  function renderBatchRowsOnly() {   // keeps focus in the search box while typing
    const rows = filteredRows(), all = X.evaluateAll().length;
    $('batchRows').innerHTML = rows.map(rowHtml).join('');
    $('tableCount').textContent = rows.length + ' of ' + all + ' batches shown. Every batch is tracked separately.';
    document.querySelector('.exp-table-wrap').hidden = rows.length === 0;
    $('batchEmpty').hidden = rows.length > 0;
    if (!rows.length) $('batchEmpty').innerHTML = '<h4>No matching batches</h4><p>Try a different search or clear the filters.</p><button type="button" class="exp-btn" data-clear>Clear filters</button>';
  }

  init();
})();