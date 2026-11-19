
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
 // ORDERS API - SQLITE
 // ------------------------------------------

function getOrderById(id) {
    const order = db.prepare(`
        SELECT
            id,
            customer_name AS customerName,
            order_date AS orderDate,
            status,
            total
        FROM orders
        WHERE id = ?
    `).get(id);

    if (!order) {
        return null;
    }

    order.items = db.prepare(`
        SELECT
            product_id AS productId,
            quantity,
            price
        FROM order_items
        WHERE order_id = ?
        ORDER BY id
    `).all(id);

    return order;
}

// GET all orders
app.get("/api/orders", (req, res) => {
    try {
        const orders = db.prepare(`
            SELECT id
            FROM orders
            ORDER BY id DESC
        `).all();

        return res.json(
            orders.map(order => getOrderById(order.id))
        );
    } catch (error) {
        console.error("Get orders error:", error);
        return res.status(500).json({
            error: "Unable to retrieve orders."
        });
    }
});

// POST - Create an order and update stock atomically
app.post("/api/orders", (req, res) => {
    const customerName =
        typeof req.body?.customerName === "string"
            ? req.body.customerName.trim()
            : "";

    const items = req.body?.items;

    if (customerName.length < 2 || customerName.length > 100) {
        return res.status(400).json({
            error: "Customer name must contain 2–100 characters."
        });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            error: "Order must contain at least one product."
        });
    }

    // Combine repeated product IDs.
    const quantities = new Map();

    for (const item of items) {
        const productId = item?.productId;
        const quantity = item?.quantity;

        if (
            !Number.isSafeInteger(productId) ||
            productId <= 0 ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
        ) {
            return res.status(400).json({
                error: "Invalid product ID or quantity."
            });
        }

        const combined =
            (quantities.get(productId) || 0) + quantity;

        if (!Number.isSafeInteger(combined)) {
            return res.status(400).json({
                error: "Order quantity is too large."
            });
        }

        quantities.set(productId, combined);
    }

    const createOrder = db.transaction(() => {
        const orderItems = [];
        let total = 0;

        // Validate products and available stock.
        for (const [productId, quantity] of quantities) {
            const product = db.prepare(`
                SELECT id, name, price, stock
                FROM products
                WHERE id = ?
            `).get(productId);

            if (!product) {
                throw new Error(
                    `Product #${productId} was not found.`
                );
            }

            if (quantity > product.stock) {
                throw new Error(
                    `Insufficient stock for ${product.name}. ` +
                    `Available: ${product.stock}`
                );
            }

            orderItems.push({
                productId,
                quantity,
                price: product.price
            });

            total += product.price * quantity;
        }

        // Create the next order ID.
        const nextId = db.prepare(`
            SELECT MAX(
                COALESCE((SELECT MAX(id) FROM orders), 0),
                1000
            ) + 1 AS id
        `).get().id;

        const now = new Date();
        const orderDate = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-");

        db.prepare(`
            INSERT INTO orders (
                id, customer_name, order_date, status, total
            )
            VALUES (?, ?, ?, 'Pending', ?)
        `).run(nextId, customerName, orderDate, total);

        const insertItem = db.prepare(`
            INSERT INTO order_items (
                order_id, product_id, quantity, price
            )
            VALUES (?, ?, ?, ?)
        `);

        const deductStock = db.prepare(`
            UPDATE products
            SET stock = stock - ?
            WHERE id = ? AND stock >= ?
        `);

        for (const item of orderItems) {
            const result = deductStock.run(
                item.quantity,
                item.productId,
                item.quantity
            );

            if (result.changes !== 1) {
                throw new Error(
                    `Unable to reserve stock for product #${item.productId}.`
                );
            }

            insertItem.run(
                nextId,
                item.productId,
                item.quantity,
                item.price
            );
        }

        return getOrderById(nextId);
    });

    try {
        const order = createOrder();
        return res.status(201).json(order);

    } catch (error) {
        console.error("Create order error:", error);

        return res.status(400).json({
            error: error.message
        });
    }
});

// ------------------------------------------
// UPDATE ORDER STATUS
// ------------------------------------------

const ORDER_STATUSES = [
    "Pending",
    "Processing",
    "Dispatched",
    "Delivered",
    "Cancelled"
];


app.put("/api/orders/:id/status", (req, res) => {
    const orderId = Number(req.params.id);
    const newStatus = req.body?.status;

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
            error: "Invalid order ID."
        });
    }

    if (!ORDER_STATUSES.includes(newStatus)) {
        return res.status(400).json({
            error: "Invalid order status."
        });
    }

    try {
        const updateStatus = db.transaction(() => {
            const order = db.prepare(`
                SELECT id, status
                FROM orders
                WHERE id = ?
            `).get(orderId);

            if (!order) {
                return {
                    statusCode: 404,
                    error: "Order not found."
                };
            }

            const oldStatus = order.status;

            // Repeating the same status must not
            // modify stock or order information.
            if (oldStatus === newStatus) {
                return {
                    statusCode: 200,
                    order: getOrderById(orderId)
                };
            }

            // Cancelled orders cannot be reopened.
            if (oldStatus === "Cancelled") {
                return {
                    statusCode: 409,
                    error: "Cancelled orders cannot be reactivated."
                };
            }

            if (newStatus === "Cancelled") {

                // No cancellation after dispatch.
                if (
                    oldStatus !== "Pending" &&
                    oldStatus !== "Processing"
                ) {
                    return {
                        statusCode: 409,
                        error:
                            "Only Pending or Processing orders " +
                            "can be cancelled."
                    };
                }

                const items = db.prepare(`
                    SELECT product_id, quantity
                    FROM order_items
                    WHERE order_id = ?
                `).all(orderId);

                // Restore each product's stock.
                const restoreStock = db.prepare(`
                    UPDATE products
                    SET stock = stock + ?
                    WHERE id = ?
                `);

                for (const item of items) {
                    const result = restoreStock.run(
                        item.quantity,
                        item.product_id
                    );

                    if (result.changes !== 1) {
                        throw new Error(
                            "Unable to restore product stock."
                        );
                    }
                }
            }

            db.prepare(`
                UPDATE orders
                SET status = ?
                WHERE id = ?
            `).run(newStatus, orderId);

            return {
                statusCode: 200,
                order: getOrderById(orderId)
            };
        });

        const result = updateStatus();

        if (result.error) {
            return res.status(result.statusCode).json({
                error: result.error
            });
        }

        return res.json(result.order);

    } catch (error) {
        console.error(
            "Order status update failed:",
            error
        );

        return res.status(500).json({
            error: "Unable to update order status."
        });
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
