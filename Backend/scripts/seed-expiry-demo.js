
/* SmartMart Expiry — SQLite demo seed
   Run: node scripts/seed-expiry-demo.js
        node scripts/seed-expiry-demo.js --clear
*/
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db } = require('../expiry/models');
const R = require('../expiry/rules');

function run() {
    try {
        const productsPath = path.join(__dirname, '..', 'data', 'products.json');

        // Find existing sample batches only.
        const sampleBatches = db.prepare(
            "SELECT id FROM expiry_batches WHERE source = 'sample'"
        ).all();

        const deleteSample = db.transaction(() => {
            for (const batch of sampleBatches) {
                db.prepare(
                    'DELETE FROM expiry_batch_sales WHERE batch_id = ?'
                ).run(batch.id);

                // Notifications and event keys are removed by cascade.
                db.prepare(
                    'DELETE FROM expiry_batches WHERE id = ?'
                ).run(batch.id);
            }
        });

        deleteSample();

        if (sampleBatches.length) {
            console.log(`Removed ${sampleBatches.length} sample batches.`);
        }

        if (process.argv.includes('--clear')) {
            console.log('Sample data cleared. Actual batches were not touched.');
            return;
        }

        if (!fs.existsSync(productsPath)) {
            console.log('No data/products.json found. Start the server once and try again.');
            return;
        }

        let products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
        products = products.filter(p => Number(p.stock) > 0);

        if (!products.length) {
            console.log('No products with stock.');
            return;
        }

        const today = R.todayISO();

        const plans = [
            { off: 3, qty: 24, disc: [[0, 6]] },
            { off: 2, qty: 18, disc: [[-1, 4], [0, 4]] },
            { off: 0, qty: 12, disc: [[-2, 5], [-1, 4]] },
            { off: -1, qty: 6, disc: [[-4, 5], [-3, 4], [-2, 5]] },
            { off: 6, qty: 16, full: [[-2, 4]] },
            { off: 12, qty: 30, full: [[-3, 5]] }
        ];

        const insertBatch = db.prepare(`
            INSERT INTO expiry_batches (
                id, batch_no, product_id, qty_received,
                qty_available, expiry_date, received_date,
                source, written_off
            )
            VALUES (
                @id, @batchNo, @productId, @qtyReceived,
                @qtyAvailable, @expiryDate, @receivedDate,
                'sample', 0
            )
        `);

        const insertSale = db.prepare(`
            INSERT INTO expiry_batch_sales (
                batch_id, order_id, sale_date,
                quantity, unit_price, base_price, discount_percent
            )
            VALUES (
                @batchId, NULL, @saleDate,
                @quantity, @unitPrice, @basePrice, @discountPercent
            )
        `);

        const seedTransaction = db.transaction(() => {
            let created = 0;

            for (let i = 0; i < plans.length; i++) {
                const product = products[i % products.length];
                const plan = plans[i];

                const prefix = (
                    String(product.name).match(/[A-Za-z]+/) || ['BAT']
                )[0].toUpperCase().slice(0, 4);

                const batchNo = prefix + (900 + i);
                const basePrice = Number(product.price);
                const discountedPrice = R.round2(basePrice * 0.5);

                const sales = [];

                (plan.disc || []).forEach(item => {
                    sales.push({
                        saleDate: R.addDays(today, item[0]),
                        quantity: item[1],
                        unitPrice: discountedPrice,
                        basePrice,
                        discountPercent: 50
                    });
                });

                (plan.full || []).forEach(item => {
                    sales.push({
                        saleDate: R.addDays(today, item[0]),
                        quantity: item[1],
                        unitPrice: basePrice,
                        basePrice,
                        discountPercent: 0
                    });
                });

                const sold = sales.reduce((sum, sale) => sum + sale.quantity, 0);
                const available = Math.max(
                    1,
                    Math.min(Number(product.stock), plan.qty)
                );

                const batchId = crypto.randomUUID();

                insertBatch.run({
                    id: batchId,
                    batchNo,
                    productId: Number(product.id),
                    qtyReceived: available + sold,
                    qtyAvailable: available,
                    expiryDate: R.addDays(today, plan.off),
                    receivedDate: R.addDays(today, plan.off - 14)
                });

                for (const sale of sales) {
                    insertSale.run({
                        batchId,
                        saleDate: sale.saleDate,
                        quantity: sale.quantity,
                        unitPrice: sale.unitPrice,
                        basePrice: sale.basePrice,
                        discountPercent: sale.discountPercent
                    });
                }

                created++;
            }

            return created;
        });

        const created = seedTransaction();

        console.log(
            `Created ${created} sample batches (source: "sample").`
        );
        console.log(
            'Expiry notifications can be generated by the server notification sync.'
        );

    } finally {
        db.close();
    }
}

try {
    run();
} catch (error) {
    console.error('Demo seed failed:', error.message);
    process.exitCode = 1;
}
