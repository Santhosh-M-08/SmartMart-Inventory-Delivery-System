
const fs = require("fs");
const path = require("path");
const { initializeDatabase } = require("./db");

// Path to generated product catalog
const catalogPath = path.join(
    __dirname,
    "../../ml/data/product_catalog.json"
);

function importProducts() {
    const db = initializeDatabase();

    try {
        const raw = fs.readFileSync(catalogPath, "utf8");
        const catalog = JSON.parse(raw);

        if (!Array.isArray(catalog)) {
            throw new Error(
                "Product catalog must contain a JSON array."
            );
        }

        const insert = db.prepare(`
            INSERT INTO products (id, name, category, price, stock)
            VALUES (@id, @name, @category, @price, @stock)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                category = excluded.category,
                price = excluded.price
        `);

        const transaction = db.transaction((products) => {
            for (const product of products) {
                insert.run(product);
            }
        });

        transaction(catalog);

        console.log(
            `Imported or updated ${catalog.length} products.`
        );

        const products = db.prepare(`
            SELECT id, name, stock
            FROM products
            ORDER BY id
        `).all();

        console.table(products);

    } finally {
        db.close();
    }
}

importProducts();
