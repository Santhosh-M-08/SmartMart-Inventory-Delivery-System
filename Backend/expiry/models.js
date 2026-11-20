
'use strict';

const { initializeDatabase } = require('../database/db');

// Initialize and connect to SQLite
const db = initializeDatabase();

// Synchronize products.json with the SQLite products table.
// products.json remains the main product data source.
function syncProducts(products) {
    if (!Array.isArray(products)) {
        throw new Error('Products must be an array.');
    }

    const upsert = db.prepare(`
        INSERT INTO products (id, name, category, price, stock)
        VALUES (@id, @name, @category, @price, @stock)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            price = excluded.price,
            stock = excluded.stock
    `);

    const transaction = db.transaction((items) => {
        for (const product of items) {
            upsert.run({
                id: Number(product.id),
                name: String(product.name),
                category: String(product.category),
                price: Number(product.price),
                stock: Number(product.stock)
            });
        }
    });

    transaction(products);
}

module.exports = {
    db,
    syncProducts
};
