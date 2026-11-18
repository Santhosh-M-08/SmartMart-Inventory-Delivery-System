/* ==========================================================================
   SmartMart Expiry — pure business rules (NEW FILE)
   File: Backend/expiry/rules.js
   No database, no Express. Same rules as the frontend's js/expiry-core.js,
   so the server and the browser always agree on prices and statuses.

   Dates are calendar dates "YYYY-MM-DD" in the STORE time zone
   (env STORE_TZ, default Asia/Kolkata). "Today" is computed in that zone on
   the server, so the browser's clock/time zone can never change a discount.
   ========================================================================== */
'use strict';

const STORE_TZ = process.env.STORE_TZ || 'Asia/Kolkata';
const DEFAULT_SETTINGS = Object.freeze({ enabled: true, activationDays: 3, discountPercent: 50, warningDays: 7 });
// Requirement: when the expiry date is reached the product is unavailable. Set true to allow sale on that day.
const ALLOW_SALE_ON_EXPIRY_DAY = false;
const STAGES = ['warning', 'discount', 'urgent', 'expired'];
const STATUS_LABELS = { safe: 'Safe', approaching: 'Approaching Expiry', discount: 'Discount Active', today: 'Expiring Today', expired: 'Expired' };
const DISCOUNT_LABELS = { active: 'Active', scheduled: 'Scheduled', none: 'Not applied', disabled: 'Disabled', ended: 'Ended' };

const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- dates ---------- */
function todayISO(now, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], c = new Date(Date.UTC(y, mo - 1, d));
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
function dayNumber(iso) { const p = parseISODate(iso); return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN; }
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
function addDays(iso, n) {
  const p = parseISODate(iso), d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const monthKey = iso => String(iso).slice(0, 7);

/* ---------- settings ---------- */
function validateSettings(input) {
  const errors = {};
  const v = {
    enabled: input.enabled === undefined ? DEFAULT_SETTINGS.enabled : input.enabled === true || input.enabled === 'true',
    activationDays: Number(input.activationDays),
    discountPercent: Number(input.discountPercent),
    warningDays: Number(input.warningDays)
  };
  if (!Number.isInteger(v.activationDays) || v.activationDays < 1 || v.activationDays > 60) errors.activationDays = 'Enter a whole number of days from 1 to 60.';
  if (!Number.isFinite(v.discountPercent) || v.discountPercent < 1 || v.discountPercent > 90) errors.discountPercent = 'Enter a discount from 1% to 90%.';
  else v.discountPercent = round2(v.discountPercent);
  if (!Number.isInteger(v.warningDays) || v.warningDays < 1 || v.warningDays > 90) errors.warningDays = 'Enter a whole number of days from 1 to 90.';
  return { ok: !Object.keys(errors).length, errors, value: v };
}

/* ---------- evaluation (one batch) ---------- */
const clampPct = p => Math.min(90, Math.max(1, Number(p) || 0));

/* batch: { id, batchNo, productId, qtyAvailable, expiryDate, override, writtenOff, source }
   product: { id, name, category, price, stock } */
function evaluateBatch(batch, product, settings, today) {
  const daysLeft = daysBetween(today, batch.expiryDate);
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
    if (daysLeft <= settings.activationDays) { active = true; discountStatus = 'active'; } else discountStatus = 'scheduled';
  }

  let expiryStatus;
  if (expired) expiryStatus = 'expired';
  else if (expiringToday) expiryStatus = 'today';
  else if (active) expiryStatus = 'discount';
  else if (daysLeft <= Math.max(settings.warningDays, settings.activationDays)) expiryStatus = 'approaching';
  else expiryStatus = 'safe';

  return {
    batch, product: product || null, daysLeft, expired, expiringToday,
    sellable: dateSellable && qty > 0 && !batch.writtenOff,
    expiryStatus, expiryLabel: STATUS_LABELS[expiryStatus],
    discountStatus, discountLabel: DISCOUNT_LABELS[discountStatus],
    discountActive: active, discountPct: pct, discountStartsOn: startsOn,
    basePrice, unitPrice: active ? round2(basePrice * (1 - pct / 100)) : basePrice,
    qty, mode
  };
}

/* ---------- selling: price validation ---------- */
/* evals = evaluateBatch() results for ONE product's batches that still hold stock. */
function allocateSale(product, quantity, evals) {
  const qty = Number(quantity);
  if (!product || !Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'Invalid product or quantity.', lines: [], items: [], total: 0 };

  const sellable = evals.filter(e => e.sellable).sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate)); // earliest expiry first
  const blocked = evals.filter(e => !e.sellable).reduce((a, e) => a + e.qty, 0);
  const maxOrderable = Math.max(0, Number(product.stock) - blocked);
  if (qty > maxOrderable) {
    return { ok: false, error: 'Only ' + maxOrderable + ' unit(s) of ' + product.name + ' can be sold right now.' + (blocked ? ' Expired or expiring-today stock cannot be sold.' : ''), lines: [], items: [], total: 0 };
  }

  let remaining = qty;
  const lines = [];
  sellable.forEach(e => {
    if (remaining <= 0) return;
    const take = Math.min(e.qty, remaining);
    lines.push({ batchId: e.batch.id, batchNo: e.batch.batchNo, qty: take, unitPrice: e.unitPrice, basePrice: e.basePrice, discountPct: e.discountActive ? e.discountPct : 0, expiryDate: e.batch.expiryDate });
    remaining -= take;
  });
  if (remaining > 0) lines.push({ batchId: null, batchNo: null, qty: remaining, unitPrice: Number(product.price), basePrice: Number(product.price), discountPct: 0 });

  const byPrice = new Map();
  lines.forEach(l => byPrice.set(l.unitPrice, (byPrice.get(l.unitPrice) || 0) + l.qty));
  const items = Array.from(byPrice, ([price, q]) => ({ productId: product.id, quantity: q, price }));
  return { ok: true, lines, items, total: round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)) };
}

function productOffer(product, evals) {
  const base = Number(product.price) || 0;
  const sellable = evals.filter(e => e.sellable).sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
  const blocked = evals.filter(e => !e.sellable).reduce((a, e) => a + e.qty, 0);
  const maxOrderable = Math.max(0, Number(product.stock) - blocked);
  const plain = { tracked: false, hasDiscount: false, unitPrice: base, basePrice: base, discountPct: 0 };

  if (!evals.length) return Object.assign({ productId: product.id, available: Number(product.stock) > 0, reason: Number(product.stock) > 0 ? '' : 'Out of stock', maxOrderable: Math.max(0, Number(product.stock)) }, plain);
  if (maxOrderable <= 0) return Object.assign({ productId: product.id, available: false, reason: evals.some(e => e.expired || e.expiringToday) ? 'Expired – unavailable' : 'Out of stock', maxOrderable: 0 }, plain, { tracked: true });
  const head = sellable[0];
  if (!head) return Object.assign({ productId: product.id, available: true, reason: '', maxOrderable }, plain);
  return {
    productId: product.id, available: true, reason: '', tracked: true, maxOrderable,
    hasDiscount: head.discountActive, unitPrice: head.unitPrice, basePrice: head.basePrice,
    discountPct: head.discountActive ? head.discountPct : 0,
    expiryDate: head.batch.expiryDate, daysLeft: head.daysLeft, batchNo: head.batch.batchNo
  };
}

/* ---------- notifications ---------- */
function stageIndex(e) {
  if (e.expired) return 3;
  if (e.expiringToday) return 2;
  if (e.discountActive) return 1;
  if (e.expiryStatus === 'approaching') return 0;
  return -1;
}
function notificationFor(stage, e) {
  const no = e.batch.batchNo, title = e.product.name + ' – Batch ' + no;
  if (stage === 'expired') return { type: 'expired', title, message: 'Batch ' + no + ' has expired. Removed from sale.' };
  if (stage === 'urgent') return { type: 'urgent', title, message: 'Batch ' + no + ' expires today. Immediate attention required.' };
  if (stage === 'discount') return { type: 'discount', title, message: 'Batch ' + no + ' expires in ' + plural(e.daysLeft, 'day') + '. A ' + e.discountPct + '% discount has been activated.' };
  return { type: 'warning', title, message: 'Batch ' + no + ' expires in ' + plural(e.daysLeft, 'day') + '.' };
}

/* ---------- suggestions ---------- */
function buildSuggestion(e, avgDaily, basis) {
  if (!e.sellable || e.daysLeft < 1 || e.daysLeft > 14 || e.qty < 5) return null;
  const projected = avgDaily * e.daysLeft;
  const unsold = Math.max(0, Math.round(e.qty - projected));
  const ratio = unsold / e.qty;
  if (unsold < 3 || ratio < 0.35) return null;
  const current = e.discountActive ? e.discountPct : 0;
  let text, suggestedPct = null;
  if (e.discountActive) {
    suggestedPct = Math.min(70, Math.ceil((current + (ratio >= 0.6 ? 20 : 10)) / 5) * 5);
    text = suggestedPct > current ? 'Consider raising the discount from ' + current + '% to about ' + suggestedPct + '%.' : 'Discount is already high. Consider a prominent display or a bundle offer.';
  } else text = 'Consider starting the discount early or increasing the discount.';
  return { avgDailySales: round2(avgDaily), basis, projectedSold: Math.round(projected), projectedUnsold: unsold, text, suggestedPct };
}

module.exports = {
  STORE_TZ, DEFAULT_SETTINGS, STAGES, STATUS_LABELS, DISCOUNT_LABELS, ALLOW_SALE_ON_EXPIRY_DAY,
  round2, plural, todayISO, parseISODate, daysBetween, addDays, monthKey,
  validateSettings, evaluateBatch, allocateSale, productOffer, stageIndex, notificationFor, buildSuggestion
};