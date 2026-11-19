/* ==========================================================================
   SmartMart Expiry — service layer (NEW FILE)
   File: Backend/expiry/service.js
   All database work lives here. `ctx` = { readProducts, writeProducts } from
   the existing server.js, so products are NOT duplicated in MongoDB.
   ========================================================================== */
'use strict';
const { Batch, Sale, Settings, Notification } = require('./models');
const R = require('./rules');

const today = () => R.todayISO();
const plain = d => (d ? Object.assign({}, d, { id: String(d._id) }) : null);
const asyncProducts = ctx => { const m = new Map(); ctx.readProducts().forEach(p => m.set(p.id, p)); return m; };
class HttpError extends Error { constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; } }

/* ---------------- settings ---------------- */
async function getSettings() {
  const doc = await Settings.findOne({ key: 'default' }).lean();
  const v = R.validateSettings(Object.assign({}, R.DEFAULT_SETTINGS, doc || {}));
  return v.ok ? v.value : Object.assign({}, R.DEFAULT_SETTINGS);
}
async function saveSettings(input, ctx) {
  const v = R.validateSettings(input || {});
  if (!v.ok) throw new HttpError(400, 'Invalid settings.', v.errors);
  await Settings.updateOne({ key: 'default' }, { $set: v.value }, { upsert: true });
  await syncNotifications(ctx);
  return v.value;
}
async function resetSettings(ctx) { return saveSettings(R.DEFAULT_SETTINGS, ctx); }

/* ---------------- evaluation helpers ---------------- */
async function evaluateAll(ctx, filter) {
  const [settings, docs] = await Promise.all([getSettings(), Batch.find(filter || {}).lean()]);
  const products = asyncProducts(ctx), t = today();
  return docs.map(plain).filter(b => products.has(b.productId)).map(b => R.evaluateBatch(b, products.get(b.productId), settings, t));
}

function toRow(e) {
  const b = e.batch;
  return {
    id: b.id, productId: b.productId, productName: e.product.name, category: e.product.category, batchNo: b.batchNo,
    source: b.source, qtyAvailable: e.qty, qtyReceived: b.qtyReceived,
    originalPrice: e.basePrice, discountPercent: e.discountActive || e.discountStatus === 'scheduled' ? e.discountPct : null,
    discountedPrice: e.discountActive ? e.unitPrice : null, currentPrice: e.unitPrice,
    expiryDate: b.expiryDate, daysRemaining: e.daysLeft,
    expiryStatus: e.expiryStatus, expiryLabel: e.expiryLabel,
    discountStatus: e.discountStatus, discountLabel: e.discountLabel, discountStartsOn: e.discountStartsOn,
    sellable: e.sellable, writtenOff: !!b.writtenOff, overrideMode: e.mode,
    overridePercent: b.override && b.override.mode === 'custom' ? b.override.pct : null
  };
}

/* ---------------- batches ---------------- */
async function listBatches(ctx, q) {
  const needle = String(q.search || '').trim().toLowerCase();
  let rows = (await evaluateAll(ctx)).filter(e =>
    (!needle || e.product.name.toLowerCase().includes(needle)) &&
    (!q.category || e.product.category === q.category) &&
    (!q.expiryStatus || e.expiryStatus === q.expiryStatus) &&
    (!q.discountStatus || e.discountStatus === q.discountStatus) &&
    (!q.source || e.batch.source === q.source));
  const sorts = {
    nearest: (a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate),
    farthest: (a, b) => b.batch.expiryDate.localeCompare(a.batch.expiryDate),
    name: (a, b) => a.product.name.localeCompare(b.product.name),
    qty: (a, b) => b.qty - a.qty
  };
  rows.sort(sorts[q.sort] || sorts.nearest);
  return rows.map(toRow);
}

async function getBatch(ctx, id) {
  const e = (await evaluateAll(ctx, { _id: id }))[0];
  if (!e) throw new HttpError(404, 'Batch not found.');
  const sales = await Sale.find({ batchId: id }).sort({ date: -1, _id: -1 }).limit(20).lean();
  return Object.assign(toRow(e), { sales: sales.map(s => ({ date: s.date, qty: s.qty, unitPrice: s.unitPrice, discountPercent: s.discountPct || null })) });
}

async function addBatch(ctx, input) {
  const product = ctx.readProducts().find(p => p.id === Number(input.productId));
  const batchNo = String(input.batchNo || '').trim().toUpperCase();
  const qty = Number(input.qty), expiryDate = String(input.expiryDate || '');
  const errors = {};
  if (!product) errors.productId = 'Choose an existing product.';
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(batchNo)) errors.batchNo = 'Use 2–20 letters, numbers or hyphens.';
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) errors.qty = 'Enter a whole number of 1 or more.';
  if (!R.parseISODate(expiryDate)) errors.expiryDate = 'Enter a valid date as YYYY-MM-DD.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Invalid batch.', errors);
  if (await Batch.exists({ productId: product.id, batchNo })) throw new HttpError(409, 'Duplicate batch.', { batchNo: 'This batch number already exists for that product.' });

  const doc = await Batch.create({ productId: product.id, batchNo, qtyReceived: qty, qtyAvailable: qty, expiryDate, receivedDate: today(), source: 'actual' });
  await syncNotifications(ctx);
  return getBatch(ctx, String(doc._id));
}

async function setOverride(ctx, id, body) {
  const b = await Batch.findById(id);
  if (!b) throw new HttpError(404, 'Batch not found.');
  const mode = body && body.mode;
  if (mode === 'custom') {
    const pct = Number(body.percent);
    if (!Number.isFinite(pct) || pct < 1 || pct > 90) throw new HttpError(400, 'Invalid discount.', { percent: 'Enter a discount from 1% to 90%.' });
    b.override = { mode: 'custom', pct: R.round2(pct), startNow: body.startNow === true };
  } else if (mode === 'none') b.override = { mode: 'none' };
  else if (mode === 'auto') b.override = undefined;
  else throw new HttpError(400, 'Invalid mode.', { mode: 'Use auto, custom or none.' });
  await b.save();
  await syncNotifications(ctx);
  return getBatch(ctx, id);
}

async function writeOff(ctx, id) {
  const b = await Batch.findById(id);
  if (!b) throw new HttpError(404, 'Batch not found.');
  if (R.daysBetween(today(), b.expiryDate) >= 0) throw new HttpError(400, 'Only expired batches can be written off.');
  if (b.writtenOff) throw new HttpError(409, 'This batch was already written off.');
  const products = ctx.readProducts(), p = products.find(x => x.id === b.productId);
  if (p) { p.stock = Math.max(0, Number(p.stock) - b.qtyAvailable); ctx.writeProducts(products); }
  b.writtenOff = true;               // qtyAvailable is kept: those units still count as "expired" in analytics
  await b.save();
  return { id, writtenOff: true, units: b.qtyAvailable };
}

async function deleteBatch(id) {
  if (await Sale.exists({ batchId: id })) throw new HttpError(409, 'This batch has sales history and cannot be deleted.');
  const r = await Batch.deleteOne({ _id: id });
  if (!r.deletedCount) throw new HttpError(404, 'Batch not found.');
  await Notification.deleteMany({ batchId: id });
}

/* ---------------- dashboard numbers ---------------- */
async function summary(ctx) {
  const holding = (await evaluateAll(ctx)).filter(e => e.qty > 0);
  return {
    today: R.todayISO(), timeZone: R.STORE_TZ,
    approachingExpiry: holding.filter(e => e.daysLeft > 0 && (e.expiryStatus === 'approaching' || e.expiryStatus === 'discount')).length,
    activeDiscounts: holding.filter(e => e.discountActive && e.sellable).length,
    expiringToday: holding.filter(e => e.expiringToday).length,
    expired: holding.filter(e => e.expired && !e.batch.writtenOff).length
  };
}

/* "Saved" = units sold WITH a discount from batches whose expiry date has passed.
   "Expired" = units left when that date passed. Batches not yet expired are never counted. */
async function analytics(ctx, scope) {
  const filter = scope === 'actual' ? { source: 'actual' } : scope === 'sample' ? { source: 'sample' } : {};
  const t = today();
  const batches = await Batch.find(filter).select('_id expiryDate qtyAvailable').lean();
  const ids = batches.map(b => b._id);
  const monthly = {};
  const bucket = k => (monthly[k] = monthly[k] || { month: k, saved: 0, expired: 0, revenue: 0, discount: 0 });

  const [perBatch, perMonth] = ids.length ? await Promise.all([
    Sale.aggregate([{ $match: { batchId: { $in: ids }, discountPct: { $gt: 0 } } }, { $group: { _id: '$batchId', qty: { $sum: '$qty' } } }]),
    Sale.aggregate([{ $match: { batchId: { $in: ids }, discountPct: { $gt: 0 } } },
      { $group: { _id: { $substrBytes: ['$date', 0, 7] }, revenue: { $sum: { $multiply: ['$qty', '$unitPrice'] } }, discount: { $sum: { $multiply: ['$qty', { $subtract: ['$basePrice', '$unitPrice'] }] } } } }])
  ]) : [[], []];

  const discounted = new Map(perBatch.map(x => [String(x._id), x.qty]));
  let saved = 0, expired = 0, revenue = 0, discount = 0, finished = 0;
  perMonth.forEach(m => { revenue += m.revenue; discount += m.discount; const b = bucket(m._id); b.revenue += m.revenue; b.discount += m.discount; });
  batches.forEach(b => {
    if (R.daysBetween(t, b.expiryDate) >= 0) return;          // outcome not known yet
    finished++;
    const s = discounted.get(String(b._id)) || 0;
    saved += s; expired += b.qtyAvailable;
    const m = bucket(R.monthKey(b.expiryDate)); m.saved += s; m.expired += b.qtyAvailable;
  });

  const months = Object.keys(monthly).sort().slice(-7).map(k => {
    const m = monthly[k], d = m.saved + m.expired;
    return { month: k, saved: m.saved, expired: m.expired, revenue: R.round2(m.revenue), discount: R.round2(m.discount), wasteReductionPercent: d ? R.round2(m.saved / d * 100) : null };
  });
  const denom = saved + expired;
  return {
    scope: scope || 'all', finishedBatches: finished,
    productsSaved: saved, expiredProducts: expired,
    discountedRevenue: R.round2(revenue), totalDiscountGiven: R.round2(discount),
    wasteReductionPercent: denom ? R.round2(saved / denom * 100) : null,     // null = no finished batches yet
    months
  };
}

async function suggestions(ctx, limit) {
  const t = today(), from = R.addDays(t, -14);
  const sold = await Sale.aggregate([{ $match: { date: { $gte: from, $lte: t } } }, { $group: { _id: '$productId', qty: { $sum: '$qty' } } }]);
  const perDay = new Map(sold.map(s => [s._id, s.qty / 14]));
  const out = [];
  (await evaluateAll(ctx)).forEach(e => {
    const avg = perDay.get(e.product.id) || 0;
    const s = R.buildSuggestion(e, avg, avg > 0 ? 'last 14 days of sales' : 'no recent sales');
    if (s) out.push(Object.assign({ batchId: e.batch.id, productName: e.product.name, batchNo: e.batch.batchNo, quantityRemaining: e.qty, daysRemaining: e.daysLeft }, s));
  });
  out.sort((a, b) => b.projectedUnsold - a.projectedUnsold);
  return out.slice(0, limit || 6);
}

/* ---------------- notifications ---------------- */
const nfDto = n => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, batchId: n.batchId ? String(n.batchId) : null, productId: n.productId, read: n.read, createdAt: n.createdAt });

async function listNotifications(q) {
  const filter = { suppressed: false };
  if (q.unread === 'true') filter.read = false;
  const [list, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(q.limit) || 50, 100)).lean(),
    Notification.countDocuments({ suppressed: false, read: false })
  ]);
  return { unreadCount: unread, notifications: list.map(nfDto) };
}
async function markRead(id) {
  const n = await Notification.findByIdAndUpdate(id, { $set: { read: true } }, { new: true }).lean();
  if (!n) throw new HttpError(404, 'Notification not found.');
  return nfDto(n);
}
async function markAllRead() { const r = await Notification.updateMany({ suppressed: false, read: false }, { $set: { read: true } }); return { updated: r.modifiedCount }; }

/* Raises each event once per batch. The unique eventKey index makes duplicates impossible,
   even if two server processes run this at the same time. Skipped earlier stages are stored as
   suppressed so only the alert that matters now is shown. */
async function syncNotifications(ctx) {
  let created = 0;
  for (const e of await evaluateAll(ctx)) {
    if (e.qty <= 0) continue;
    const idx = R.stageIndex(e);
    for (let j = 0; j <= idx; j++) {
      const stage = R.STAGES[j], n = R.notificationFor(stage, e);
      const r = await Notification.updateOne({ eventKey: e.batch.id + '|' + stage },
        { $setOnInsert: { type: n.type, title: n.title, message: n.message, batchId: e.batch.id, productId: e.product.id, read: false, suppressed: j !== idx } },
        { upsert: true });
      if (r.upsertedCount && j === idx) created++;
    }
  }
  return { created };
}

/* ---------------- storefront: offers, quote, checkout ---------------- */
async function offers(ctx) {
  const settings = await getSettings(), t = today();
  const docs = (await Batch.find({ qtyAvailable: { $gt: 0 }, writtenOff: { $ne: true } }).lean()).map(plain);
  return ctx.readProducts().map(p => R.productOffer(p, docs.filter(b => b.productId === p.id).map(b => R.evaluateBatch(b, p, settings, t))));
}

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new HttpError(400, 'Send 1 to 50 items.', { items: 'Items must be a non-empty array.' });
  const merged = new Map();
  items.forEach((i, n) => {
    const productId = Number(i && i.productId), quantity = Number(i && i.quantity);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new HttpError(400, 'Invalid item.', { ['items[' + n + ']']: 'productId and quantity must be whole numbers (quantity 1–1000).' });
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);      // any client-sent price is ignored
  });
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

async function priceItems(ctx, items) {
  const settings = await getSettings(), t = today(), products = asyncProducts(ctx);
  const docs = (await Batch.find({ productId: { $in: items.map(i => i.productId) }, qtyAvailable: { $gt: 0 }, writtenOff: { $ne: true } }).lean()).map(plain);
  const results = [];
  for (const i of items) {
    const p = products.get(i.productId);
    if (!p) throw new HttpError(404, 'Product ' + i.productId + ' was not found.');
    const evals = docs.filter(b => b.productId === p.id).map(b => R.evaluateBatch(b, p, settings, t));
    const q = R.allocateSale(p, i.quantity, evals);
    if (!q.ok) throw new HttpError(409, q.error);
    results.push({ product: p, quote: q });
  }
  return results;
}

const quoteDto = priced => ({
  items: [].concat(...priced.map(r => r.quote.items)),
  lines: [].concat(...priced.map(r => r.quote.lines.map(l => Object.assign({ productId: r.product.id, productName: r.product.name }, l)))),
  total: R.round2(priced.reduce((a, r) => a + r.quote.total, 0))
});

async function quote(ctx, body) { return quoteDto(await priceItems(ctx, cleanItems(body && body.items))); }

/* Reserves stock and records the sale. The returned items carry the SERVER-calculated prices;
   the caller must create its order from these, not from prices the browser calculated. */
async function checkout(ctx, body) {
  const priced = await priceItems(ctx, cleanItems(body && body.items));
  const dto = quoteDto(priced), t = today(), done = [];
  try {
    for (const l of dto.lines) {
      if (!l.batchId) continue;
      const r = await Batch.updateOne({ _id: l.batchId, qtyAvailable: { $gte: l.qty }, writtenOff: { $ne: true } }, { $inc: { qtyAvailable: -l.qty } });
      if (!r.modifiedCount) throw new HttpError(409, 'Stock for ' + l.productName + ' (batch ' + l.batchNo + ') changed. Please review your cart and try again.');
      done.push(l);
    }
  } catch (err) {
    await Promise.all(done.map(l => Batch.updateOne({ _id: l.batchId }, { $inc: { qtyAvailable: l.qty } })));   // put back what was taken
    throw err;
  }
  const orderRef = body.orderRef ? String(body.orderRef).slice(0, 40) : undefined;
  const saleDocs = dto.lines.filter(l => l.batchId).map(l => ({ batchId: l.batchId, productId: l.productId, date: t, qty: l.qty, unitPrice: l.unitPrice, basePrice: l.basePrice, discountPct: l.discountPct, orderRef }));
  if (saleDocs.length) await Sale.insertMany(saleDocs);

  const products = ctx.readProducts();                         // keep the existing product stock in step
  priced.forEach(r => { const p = products.find(x => x.id === r.product.id); if (p) p.stock = Math.max(0, p.stock - r.quote.lines.reduce((a, l) => a + l.qty, 0)); });
  ctx.writeProducts(products);
  return dto;
}

module.exports = {
  HttpError, getSettings, saveSettings, resetSettings, listBatches, getBatch, addBatch, setOverride, writeOff, deleteBatch,
  summary, analytics, suggestions, listNotifications, markRead, markAllRead, syncNotifications, offers, quote, checkout
};