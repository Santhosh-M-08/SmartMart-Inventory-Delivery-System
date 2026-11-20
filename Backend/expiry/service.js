
'use strict';

const crypto = require('crypto');
const { db } = require('./models');
const R = require('./rules');

const today = () => R.todayISO();

class HttpError extends Error {
    constructor(status, message, errors) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

const id = () => crypto.randomUUID();

function syncProducts(ctx) {
    const { syncProducts: sync } = require('./models');
    sync(ctx.readProducts());
}

function getSettings() {
    const row = db.prepare(
        'SELECT * FROM expiry_settings WHERE id = 1'
    ).get();

    const result = {
        enabled: !!row.enabled,
        activationDays: row.activation_days,
        discountPercent: row.discount_percent,
        warningDays: row.warning_days
    };

    const v = R.validateSettings(result);
    return v.ok ? v.value : { ...R.DEFAULT_SETTINGS };
}

function saveSettings(input, ctx) {
    const v = R.validateSettings(input || {});
    if (!v.ok) throw new HttpError(400, 'Invalid settings.', v.errors);

    db.prepare(`
        UPDATE expiry_settings
        SET enabled = ?, activation_days = ?,
            discount_percent = ?, warning_days = ?
        WHERE id = 1
    `).run(
        v.value.enabled ? 1 : 0,
        v.value.activationDays,
        v.value.discountPercent,
        v.value.warningDays
    );

    syncNotifications(ctx);
    return v.value;
}

function resetSettings(ctx) {
    return saveSettings(R.DEFAULT_SETTINGS, ctx);
}

function getBatchRecord(batchId) {
    return db.prepare(`
        SELECT b.*,
               d.mode AS override_mode,
               d.discount_percent AS override_percent,
               d.start_now AS override_start_now
        FROM expiry_batches b
        LEFT JOIN expiry_discounts d ON d.batch_id = b.id
        WHERE b.id = ?
    `).get(batchId);
}

function toBatch(row) {
    if (!row) return null;

    return {
        id: String(row.id),
        productId: Number(row.product_id),
        batchNo: row.batch_no,
        qtyReceived: Number(row.qty_received),
        qtyAvailable: Number(row.qty_available),
        expiryDate: row.expiry_date,
        receivedDate: row.received_date,
        source: row.source,
        writtenOff: !!row.written_off,
        override: row.override_mode ? {
            mode: row.override_mode,
            pct: row.override_percent,
            startNow: !!row.override_start_now
        } : null
    };
}

function evaluateAll(ctx, filter = {}) {
    syncProducts(ctx);

    const settings = getSettings();
    const products = new Map(
        ctx.readProducts().map(p => [Number(p.id), p])
    );

    let sql = `
        SELECT b.*,
               d.mode AS override_mode,
               d.discount_percent AS override_percent,
               d.start_now AS override_start_now
        FROM expiry_batches b
        LEFT JOIN expiry_discounts d ON d.batch_id = b.id
    `;

    const conditions = [];
    const params = [];

    if (filter.id) {
        conditions.push('b.id = ?');
        params.push(filter.id);
    }

    if (filter.source) {
        conditions.push('b.source = ?');
        params.push(filter.source);
    }

    if (conditions.length) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }

    const rows = db.prepare(sql).all(...params);

    return rows.map(row => {
        const batch = toBatch(row);
        const product = products.get(batch.productId);

        if (!product) return null;

        return R.evaluateBatch(batch, product, settings, today());
    }).filter(Boolean);
}

function toRow(e) {
    const b = e.batch;

    return {
        id: b.id,
        productId: b.productId,
        productName: e.product.name,
        category: e.product.category,
        batchNo: b.batchNo,
        source: b.source,
        qtyAvailable: e.qty,
        qtyReceived: b.qtyReceived,
        originalPrice: e.basePrice,
        discountPercent:
            e.discountActive || e.discountStatus === 'scheduled'
                ? e.discountPct : null,
        discountedPrice: e.discountActive ? e.unitPrice : null,
        currentPrice: e.unitPrice,
        expiryDate: b.expiryDate,
        daysRemaining: e.daysLeft,
        expiryStatus: e.expiryStatus,
        expiryLabel: e.expiryLabel,
        discountStatus: e.discountStatus,
        discountLabel: e.discountLabel,
        discountStartsOn: e.discountStartsOn,
        sellable: e.sellable,
        writtenOff: !!b.writtenOff,
        overrideMode: e.mode,
        overridePercent:
            b.override && b.override.mode === 'custom'
                ? b.override.pct : null
    };
}

/* BATCHES */

function listBatches(ctx, q = {}) {
    let rows = evaluateAll(ctx);

    const needle = String(q.search || '').trim().toLowerCase();

    rows = rows.filter(e =>
        (!needle || e.product.name.toLowerCase().includes(needle)) &&
        (!q.category || e.product.category === q.category) &&
        (!q.expiryStatus || e.expiryStatus === q.expiryStatus) &&
        (!q.discountStatus || e.discountStatus === q.discountStatus) &&
        (!q.source || e.batch.source === q.source)
    );

    const sorts = {
        nearest: (a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate),
        farthest: (a, b) => b.batch.expiryDate.localeCompare(a.batch.expiryDate),
        name: (a, b) => a.product.name.localeCompare(b.product.name),
        qty: (a, b) => b.qty - a.qty
    };

    rows.sort(sorts[q.sort] || sorts.nearest);
    return rows.map(toRow);
}

function getBatch(ctx, batchId) {
    const e = evaluateAll(ctx, { id: batchId })[0];

    if (!e) throw new HttpError(404, 'Batch not found.');

    const sales = db.prepare(`
        SELECT sale_date, quantity, unit_price, discount_percent
        FROM expiry_batch_sales
        WHERE batch_id = ?
        ORDER BY sale_date DESC, id DESC
        LIMIT 20
    `).all(batchId);

    return Object.assign(toRow(e), {
        sales: sales.map(s => ({
            date: s.sale_date,
            qty: s.quantity,
            unitPrice: s.unit_price,
            discountPercent: s.discount_percent || null
        }))
    });
}

function addBatch(ctx, input) {
    syncProducts(ctx);

    const product = ctx.readProducts().find(
        p => Number(p.id) === Number(input.productId)
    );

    const batchNo = String(input.batchNo || '').trim().toUpperCase();
    const qty = Number(input.qty);
    const expiryDate = String(input.expiryDate || '');

    const errors = {};

    if (!product) errors.productId = 'Choose an existing product.';
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(batchNo))
        errors.batchNo = 'Use 2–20 letters, numbers or hyphens.';
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000)
        errors.qty = 'Enter a whole number of 1 or more.';
    if (!R.parseISODate(expiryDate))
        errors.expiryDate = 'Enter a valid date as YYYY-MM-DD.';

    if (Object.keys(errors).length)
        throw new HttpError(400, 'Invalid batch.', errors);

    const duplicate = db.prepare(`
        SELECT id FROM expiry_batches
        WHERE product_id = ? AND batch_no = ?
    `).get(product.id, batchNo);

    if (duplicate)
        throw new HttpError(409, 'Duplicate batch.', {
            batchNo: 'This batch number already exists for that product.'
        });

    const batchId = id();

    db.prepare(`
        INSERT INTO expiry_batches
        (id, batch_no, product_id, qty_received, qty_available,
         expiry_date, received_date, source, written_off)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'actual', 0)
    `).run(
        batchId, batchNo, product.id, qty, qty,
        expiryDate, today()
    );

    syncNotifications(ctx);
    return getBatch(ctx, batchId);
}

function setOverride(ctx, batchId, body) {
    const batch = getBatchRecord(batchId);

    if (!batch) throw new HttpError(404, 'Batch not found.');

    const mode = body && body.mode;

    if (mode === 'custom') {
        const pct = Number(body.percent);

        if (!Number.isFinite(pct) || pct < 1 || pct > 90)
            throw new HttpError(400, 'Invalid discount.', {
                percent: 'Enter a discount from 1% to 90%.'
            });

        db.prepare(`
            INSERT INTO expiry_discounts
            (batch_id, mode, discount_percent, start_now)
            VALUES (?, 'custom', ?, ?)
            ON CONFLICT(batch_id) DO UPDATE SET
                mode = 'custom',
                discount_percent = excluded.discount_percent,
                start_now = excluded.start_now
        `).run(batchId, R.round2(pct), body.startNow === true ? 1 : 0);

    } else if (mode === 'none') {
        db.prepare(`
            INSERT INTO expiry_discounts
            (batch_id, mode, discount_percent, start_now)
            VALUES (?, 'none', NULL, 0)
            ON CONFLICT(batch_id) DO UPDATE SET
                mode = 'none',
                discount_percent = NULL,
                start_now = 0
        `).run(batchId);

    } else if (mode === 'auto') {
        db.prepare(
            'DELETE FROM expiry_discounts WHERE batch_id = ?'
        ).run(batchId);

    } else {
        throw new HttpError(400, 'Invalid mode.', {
            mode: 'Use auto, custom or none.'
        });
    }

    syncNotifications(ctx);
    return getBatch(ctx, batchId);
}

function writeOff(ctx, batchId) {
    const batch = getBatchRecord(batchId);

    if (!batch) throw new HttpError(404, 'Batch not found.');

    if (R.daysBetween(today(), batch.expiry_date) >= 0)
        throw new HttpError(400, 'Only expired batches can be written off.');

    if (batch.written_off)
        throw new HttpError(409, 'This batch was already written off.');

    const products = ctx.readProducts();
    const product = products.find(p => p.id === batch.product_id);

    if (product) {
        product.stock = Math.max(
            0,
            Number(product.stock) - Number(batch.qty_available)
        );
        ctx.writeProducts(products);
    }

    db.prepare(`
        UPDATE expiry_batches SET written_off = 1 WHERE id = ?
    `).run(batchId);

    return {
        id: batchId,
        writtenOff: true,
        units: batch.qty_available
    };
}

function deleteBatch(batchId) {
    const sales = db.prepare(`
        SELECT COUNT(*) AS count
        FROM expiry_batch_sales WHERE batch_id = ?
    `).get(batchId).count;

    if (sales > 0)
        throw new HttpError(409, 'This batch has sales history and cannot be deleted.');

    const result = db.prepare(`
        DELETE FROM expiry_batches WHERE id = ?
    `).run(batchId);

    if (!result.changes)
        throw new HttpError(404, 'Batch not found.');
}

/* DASHBOARD */

function summary(ctx) {
    const holding = evaluateAll(ctx).filter(e => e.qty > 0);

    return {
        today: today(),
        timeZone: R.STORE_TZ,
        approachingExpiry: holding.filter(e =>
            e.daysLeft > 0 &&
            (e.expiryStatus === 'approaching' || e.expiryStatus === 'discount')
        ).length,
        activeDiscounts: holding.filter(e =>
            e.discountActive && e.sellable
        ).length,
        expiringToday: holding.filter(e => e.expiringToday).length,
        expired: holding.filter(e =>
            e.expired && !e.batch.writtenOff
        ).length
    };
}

function analytics(ctx, scope) {
    const filter = scope === 'actual'
        ? { source: 'actual' }
        : scope === 'sample' ? { source: 'sample' } : {};

    const batches = db.prepare(`
        SELECT id, expiry_date, qty_available
        FROM expiry_batches
        ${filter.source ? 'WHERE source = ?' : ''}
    `).all(...(filter.source ? [filter.source] : []));

    const monthly = {};
    const bucket = key => monthly[key] ||
        (monthly[key] = {
            month: key, saved: 0, expired: 0, revenue: 0, discount: 0
        });

    let saved = 0;
    let expired = 0;
    let revenue = 0;
    let discount = 0;
    let finished = 0;

    const sales = db.prepare(`
        SELECT s.sale_date, s.quantity, s.unit_price,
               s.base_price, s.discount_percent, s.batch_id
        FROM expiry_batch_sales s
        JOIN expiry_batches b ON b.id = s.batch_id
        ${filter.source ? 'WHERE b.source = ? AND s.discount_percent > 0'
                        : 'WHERE s.discount_percent > 0'}
    `).all(...(filter.source ? [filter.source] : []));

    for (const sale of sales) {
        const saleMonth = sale.sale_date.slice(0, 7);
        const m = bucket(saleMonth);
        const saleRevenue = sale.quantity * sale.unit_price;
        const saleDiscount =
            sale.quantity * (sale.base_price - sale.unit_price);

        revenue += saleRevenue;
        discount += saleDiscount;
        m.revenue += saleRevenue;
        m.discount += saleDiscount;
    }

    for (const batch of batches) {
        if (R.daysBetween(today(), batch.expiry_date) >= 0) continue;

        finished++;

        const discounted = db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) AS qty
            FROM expiry_batch_sales
            WHERE batch_id = ? AND discount_percent > 0
        `).get(batch.id).qty;

        saved += discounted;
        expired += batch.qty_available;

        const m = bucket(R.monthKey(batch.expiry_date));
        m.saved += discounted;
        m.expired += batch.qty_available;
    }

    const months = Object.keys(monthly).sort().slice(-7).map(key => {
        const m = monthly[key];
        const total = m.saved + m.expired;

        return {
            month: key,
            saved: m.saved,
            expired: m.expired,
            revenue: R.round2(m.revenue),
            discount: R.round2(m.discount),
            wasteReductionPercent: total
                ? R.round2(m.saved / total * 100) : null
        };
    });

    const denominator = saved + expired;

    return {
        scope: scope || 'all',
        finishedBatches: finished,
        productsSaved: saved,
        expiredProducts: expired,
        discountedRevenue: R.round2(revenue),
        totalDiscountGiven: R.round2(discount),
        wasteReductionPercent: denominator
            ? R.round2(saved / denominator * 100) : null,
        months
    };
}

function suggestions(ctx, limit) {
    const from = R.addDays(today(), -14);

  const sold = db.prepare(`
    SELECT b.product_id, SUM(s.quantity) AS qty
    FROM expiry_batch_sales s
    JOIN expiry_batches b ON b.id = s.batch_id
    WHERE s.sale_date >= ? AND s.sale_date <= ?
    GROUP BY b.product_id
`).all(from, today());
        
    const perDay = new Map(
        sold.map(s => [Number(s.product_id), s.qty / 14])
    );

    const output = [];

    for (const e of evaluateAll(ctx)) {
        const avg = perDay.get(e.product.id) || 0;
        const suggestion = R.buildSuggestion(
            e, avg, avg > 0 ? 'last 14 days of sales' : 'no recent sales'
        );

        if (suggestion) {
            output.push(Object.assign({
                batchId: e.batch.id,
                productName: e.product.name,
                batchNo: e.batch.batchNo,
                quantityRemaining: e.qty,
                daysRemaining: e.daysLeft
            }, suggestion));
        }
    }

    output.sort((a, b) => b.projectedUnsold - a.projectedUnsold);
    return output.slice(0, limit || 6);
}

/* NOTIFICATIONS */

const nfDto = n => ({
    id: String(n.id),
    type: n.type,
    title: n.title,
    message: n.message,
    batchId: n.batch_id,
    productId: Number(n.product_id),
    read: !!n.is_read,
    createdAt: n.created_at
});

function listNotifications(q = {}) {
    const limit = Math.min(Number(q.limit) || 50, 100);

    const unreadCount = db.prepare(`
        SELECT COUNT(*) AS count FROM expiry_notifications
        WHERE is_read = 0
    `).get().count;

    const list = db.prepare(`
        SELECT * FROM expiry_notifications
        ${q.unread === 'true' ? 'WHERE is_read = 0' : ''}
        ORDER BY created_at DESC LIMIT ?
    `).all(limit);

    return {
        unreadCount,
        notifications: list.map(nfDto)
    };
}

function markRead(notificationId) {
    const result = db.prepare(`
        UPDATE expiry_notifications SET is_read = 1 WHERE id = ?
    `).run(notificationId);

    if (!result.changes)
        throw new HttpError(404, 'Notification not found.');

    return nfDto(db.prepare(`
        SELECT * FROM expiry_notifications WHERE id = ?
    `).get(notificationId));
}

function markAllRead() {
    const result = db.prepare(`
        UPDATE expiry_notifications SET is_read = 1 WHERE is_read = 0
    `).run();

    return { updated: result.changes };
}

function syncNotifications(ctx) {
    let created = 0;

    const insertEvent = db.prepare(`
        INSERT OR IGNORE INTO expiry_event_keys (batch_id, stage)
        VALUES (?, ?)
    `);

    const insertNotification = db.prepare(`
        INSERT INTO expiry_notifications
        (id, batch_id, product_id, type, title, message, created_at, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const transaction = db.transaction(() => {
        for (const e of evaluateAll(ctx)) {
            if (e.qty <= 0) continue;

            const stageIndex = R.stageIndex(e);
            if (stageIndex < 0) continue;

            const stage = R.STAGES[stageIndex];
            const notification = R.notificationFor(stage, e);

            const result = insertEvent.run(e.batch.id, stage);

            if (result.changes) {
                insertNotification.run(
                    id(),
                    e.batch.id,
                    e.product.id,
                    notification.type,
                    notification.title,
                    notification.message,
                    new Date().toISOString()
                );
                created++;
            }
        }
    });

    transaction();
    return { created };
}

/* STOREFRONT */

function offers(ctx) {
    const settings = getSettings();
    const t = today();

    const rows = db.prepare(`
        SELECT b.*,
               d.mode AS override_mode,
               d.discount_percent AS override_percent,
               d.start_now AS override_start_now
        FROM expiry_batches b
        LEFT JOIN expiry_discounts d ON d.batch_id = b.id
        WHERE b.qty_available > 0 AND b.written_off = 0
    `).all();

    const docs = rows.map(toBatch);
    const evaluations = new Map();

    for (const p of ctx.readProducts()) {
        evaluations.set(p.id, docs
            .filter(b => b.productId === p.id)
            .map(b => R.evaluateBatch(b, p, settings, t)));
    }

    return ctx.readProducts().map(p =>
        R.productOffer(p, evaluations.get(p.id) || [])
    );
}

function cleanItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 50)
        throw new HttpError(400, 'Send 1 to 50 items.', {
            items: 'Items must be a non-empty array.'
        });

    const merged = new Map();

    items.forEach((item, index) => {
        const productId = Number(item && item.productId);
        const quantity = Number(item && item.quantity);

        if (!Number.isInteger(productId) ||
            !Number.isInteger(quantity) ||
            quantity < 1 || quantity > 1000) {
            throw new HttpError(400, 'Invalid item.', {
                ['items[' + index + ']']:
                    'productId and quantity must be whole numbers (quantity 1–1000).'
            });
        }

        merged.set(
            productId,
            (merged.get(productId) || 0) + quantity
        );
    });

    return Array.from(merged, ([productId, quantity]) => ({
        productId, quantity
    }));
}

function priceItems(ctx, items) {
    const settings = getSettings();
    const products = new Map(
        ctx.readProducts().map(p => [Number(p.id), p])
    );

    const rows = db.prepare(`
        SELECT b.*,
               d.mode AS override_mode,
               d.discount_percent AS override_percent,
               d.start_now AS override_start_now
        FROM expiry_batches b
        LEFT JOIN expiry_discounts d ON d.batch_id = b.id
        WHERE b.qty_available > 0 AND b.written_off = 0
    `).all();

    const docs = rows.map(toBatch);
    const results = [];

    for (const item of items) {
        const product = products.get(item.productId);

        if (!product)
            throw new HttpError(404, 'Product ' + item.productId + ' was not found.');

        const evaluations = docs
            .filter(b => b.productId === product.id)
            .map(b => R.evaluateBatch(b, product, settings, today()));

        const quote = R.allocateSale(product, item.quantity, evaluations);

        if (!quote.ok) throw new HttpError(409, quote.error);

        results.push({ product, quote });
    }

    return results;
}

const quoteDto = priced => ({
    items: [].concat(...priced.map(r => r.quote.items)),
    lines: [].concat(...priced.map(r =>
        r.quote.lines.map(line => Object.assign({
            productId: r.product.id,
            productName: r.product.name
        }, line))
    )),
    total: R.round2(priced.reduce((a, r) => a + r.quote.total, 0))
});

function quote(ctx, body) {
    return quoteDto(priceItems(ctx, cleanItems(body && body.items)));
}

function checkout(ctx, body) {
    const priced = priceItems(ctx, cleanItems(body && body.items));
    const dto = quoteDto(priced);
    const t = today();

    const reserve = db.prepare(`
        UPDATE expiry_batches
        SET qty_available = qty_available - ?
        WHERE id = ? AND qty_available >= ? AND written_off = 0
    `);

    const insertSale = db.prepare(`
        INSERT INTO expiry_batch_sales
        (batch_id, order_id, sale_date, quantity,
         unit_price, base_price, discount_percent)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        for (const line of dto.lines) {
            if (!line.batchId) continue;

            const result = reserve.run(
                line.qty, line.batchId, line.qty
            );

            if (!result.changes) {
                throw new HttpError(
                    409,
                    'Stock for ' + line.productName +
                    ' (batch ' + line.batchNo +
                    ') changed. Please review your cart and try again.'
                );
            }

            insertSale.run(
                line.batchId,
                t,
                line.qty,
                line.unitPrice,
                line.basePrice,
                line.discountPct
            );
        }

        const products = ctx.readProducts();

        priced.forEach(r => {
            const product = products.find(
                p => p.id === r.product.id
            );

            if (product) {
                product.stock = Math.max(
                    0,
                    product.stock -
                    r.quote.lines.reduce((a, line) => a + line.qty, 0)
                );
            }
        });

        ctx.writeProducts(products);
    });

    transaction();
    return dto;
}

module.exports = {
    HttpError,
    getSettings,
    saveSettings,
    resetSettings,
    listBatches,
    getBatch,
    addBatch,
    setOverride,
    writeOff,
    deleteBatch,
    summary,
    analytics,
    suggestions,
    listNotifications,
    markRead,
    markAllRead,
    syncNotifications,
    offers,
    quote,
    checkout
};
