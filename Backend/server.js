
/*
 * SmartMart Inventory REST API
 * Database: SQLite
 *
 * Start from Backend:
 * npm.cmd start
 */

const express = require("express");
const { initializeDatabase } = require("./database/db");

const app = express();
const PORT = process.env.PORT || 3000;

// Open and initialize SQLite once at startup
const db = initializeDatabase();

app.use(express.json());

// CORS for development
app.use((req, res, next) => {
    res.set({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
    });

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// Sanitize incoming product data
function clean(body = {}) {
    return {
        name: String(body.name ?? "")
            .trim()
            .replace(/\s+/g, " "),

        category: String(body.category ?? "")
            .trim()
            .replace(/\s+/g, " "),

        price: Number(body.price),
        stock: Number(body.stock)
    };
}

// Validate product fields
function validate(product) {
    const errors = {};

    if (
        product.name.length < 2 ||
        product.name.length > 60
    ) {
        errors.name = "Name must be 2–60 characters.";
    }

    if (!product.category) {
        errors.category = "Category is required.";
    }

    if (
        !Number.isFinite(product.price) ||
        product.price <= 0
    ) {
        errors.price = "Price must be greater than 0.";
    }

    if (
        !Number.isInteger(product.stock) ||
        product.stock < 0
    ) {
        errors.stock =
            "Stock must be a whole number, 0 or more.";
    }

    return errors;
}

// Check if name/category combination already exists
function isDuplicate(product, ignoreId = null) {
    const existing = db.prepare(`
        SELECT id
        FROM products
        WHERE LOWER(name) = LOWER(?)
          AND LOWER(category) = LOWER(?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
    `).get(
        product.name,
        product.category,
        ignoreId,
        ignoreId
    );

    return Boolean(existing);
}

// Centralized API error handling
function handleError(res, error) {
    console.error("Database error:", error);

    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
            errors: {
                name: "Product already exists in that category."
            }
        });
    }

    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        return res.status(409).json({
            error: "This product is referenced by other records."
        });
    }

    return res.status(500).json({
        error: "Internal database error."
    });
}

// ------------------------------------------
// GET PRODUCTS
// ------------------------------------------
app.get("/api/products", (req, res) => {
    try {
        const q = String(req.query.q || "").toLowerCase();
        const category = String(req.query.category || "");

        const products = db.prepare(`
            SELECT id, name, category, price, stock
            FROM products
            ORDER BY id
        `).all();

        const filtered = products.filter(product =>
            (!q || product.name.toLowerCase().includes(q)) &&
            (!category || product.category === category)
        );

        return res.json(filtered);

    } catch (error) {
        return handleError(res, error);
    }
});

// ------------------------------------------
// GET PRODUCTS - SQLITE TEST ENDPOINT
// ------------------------------------------
app.get("/api/sqlite/products", (req, res) => {
    try {
        const products = db.prepare(`
            SELECT id, name, category, price, stock
            FROM products
            ORDER BY id
        `).all();

        return res.json(products);

    } catch (error) {
        return handleError(res, error);
    }
});

// ------------------------------------------
// ADD PRODUCT
// ------------------------------------------
app.post("/api/products", (req, res) => {
    try {
        const product = clean(req.body);
        const errors = validate(product);

        if (Object.keys(errors).length) {
            return res.status(400).json({ errors });
        }

        if (isDuplicate(product)) {
            return res.status(409).json({
                errors: {
                    name: "Product already exists in that category."
                }
            });
        }

        const createProduct = db.transaction(() => {
            // Keep IDs compatible with current
            // catalog IDs 101–115.
            const next = db.prepare(`
                SELECT COALESCE(MAX(id), 0) + 1 AS id
                FROM products
            `).get();

            db.prepare(`
                INSERT INTO products
                    (id, name, category, price, stock)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                next.id,
                product.name,
                product.category,
                product.price,
                product.stock
            );

            return {
                id: next.id,
                ...product
            };
        });

        const created = createProduct();

        return res.status(201).json(created);

    } catch (error) {
        return handleError(res, error);
    }
});

// ------------------------------------------
// UPDATE PRODUCT
// ------------------------------------------
app.put("/api/products/:id", (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "Invalid product ID."
            });
        }

        const existing = db.prepare(`
            SELECT id FROM products WHERE id = ?
        `).get(id);

        if (!existing) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        const product = clean(req.body);
        const errors = validate(product);

        if (Object.keys(errors).length) {
            return res.status(400).json({ errors });
        }

        if (isDuplicate(product, id)) {
            return res.status(409).json({
                errors: {
                    name: "Product already exists in that category."
                }
            });
        }

        db.prepare(`
            UPDATE products
            SET name = ?,
                category = ?,
                price = ?,
                stock = ?
            WHERE id = ?
        `).run(
            product.name,
            product.category,
            product.price,
            product.stock,
            id
        );

        return res.json({
            id,
            ...product
        });

    } catch (error) {
        return handleError(res, error);
    }
});

// ------------------------------------------
// DELETE PRODUCT
// ------------------------------------------
app.delete("/api/products/:id", (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "Invalid product ID."
            });
        }

        const result = db.prepare(`
            DELETE FROM products
            WHERE id = ?
        `).run(id);

        if (result.changes === 0) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        return res.sendStatus(204);

    } catch (error) {
        return handleError(res, error);
    }
});

// ------------------------------------------
// START SERVER
// ------------------------------------------
app.listen(PORT, () => {
    console.log(
        `SmartMart API running on http://localhost:${PORT}`
    );
});


 // ------------------------------------------
 // GET ML PREDICTIONS FROM SQLITE
 // ------------------------------------------

app.get("/api/predictions", (req, res) => {
    try {
        const predictions = db.prepare(`
            SELECT
                p.product_id,
                pr.name AS product_name,
                p.prediction_date,
                p.predicted_demand
            FROM predictions p
            JOIN products pr
                ON pr.id = p.product_id
            ORDER BY p.product_id
        `).all();

        return res.json(predictions);

    } catch (error) {
        console.error(
            "Error fetching predictions:",
            error.message
        );

        return res.status(500).json({
            error: "Unable to retrieve ML predictions."
        });
    }
});
