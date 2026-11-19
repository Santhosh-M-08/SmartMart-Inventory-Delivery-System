
-- SmartMart SQLite Database Schema

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL CHECK (price > 0),
    stock INTEGER NOT NULL DEFAULT 0
        CHECK (stock >= 0),
    UNIQUE(name, category)
);

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer_name TEXT NOT NULL,
    order_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (status IN (
            'Pending',
            'Processing',
            'Dispatched',
            'Delivered',
            'Cancelled'
        )),
    total REAL NOT NULL DEFAULT 0
        CHECK (total >= 0)
);

-- ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL CHECK (price >= 0),

    FOREIGN KEY (order_id)
        REFERENCES orders(id) ON DELETE CASCADE,

    FOREIGN KEY (product_id)
        REFERENCES products(id) ON DELETE RESTRICT
);

-- HISTORICAL SALES FOR MACHINE LEARNING
CREATE TABLE IF NOT EXISTS sales_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sale_date TEXT NOT NULL,
    units_sold INTEGER NOT NULL
        CHECK (units_sold >= 0),
    demand_units INTEGER NOT NULL
        CHECK (demand_units >= 0),

    FOREIGN KEY (product_id)
        REFERENCES products(id),

    UNIQUE(product_id, sale_date)
);

-- MACHINE LEARNING PREDICTIONS
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    prediction_date TEXT NOT NULL,
    predicted_demand INTEGER NOT NULL
        CHECK (predicted_demand >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id)
        REFERENCES products(id),

    UNIQUE(product_id, prediction_date)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
    ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_sales_date
    ON sales_history(sale_date);
