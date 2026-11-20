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


-- ==========================================
-- EXPIRY MANAGEMENT
-- ==========================================

-- Product batches with expiry dates
CREATE TABLE IF NOT EXISTS expiry_batches (
    id TEXT PRIMARY KEY,
    batch_no TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    qty_received INTEGER NOT NULL
        CHECK (qty_received > 0),
    qty_available INTEGER NOT NULL
        CHECK (qty_available >= 0),
    expiry_date TEXT NOT NULL,
    received_date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'actual'
        CHECK (source IN ('actual', 'sample')),
    written_off INTEGER NOT NULL DEFAULT 0
        CHECK (written_off IN (0, 1)),
    sample_daily_sales REAL DEFAULT 0,

    FOREIGN KEY (product_id)
        REFERENCES products(id) ON DELETE RESTRICT,

    UNIQUE(product_id, batch_no),

    CHECK (qty_available <= qty_received)
);

-- Batch-specific discount overrides
CREATE TABLE IF NOT EXISTS expiry_discounts (
    batch_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL
        CHECK (mode IN ('custom', 'none')),
    discount_percent REAL,
    start_now INTEGER NOT NULL DEFAULT 0
        CHECK (start_now IN (0, 1)),

    FOREIGN KEY (batch_id)
        REFERENCES expiry_batches(id) ON DELETE CASCADE,

    CHECK (
        discount_percent IS NULL OR
        discount_percent BETWEEN 1 AND 90
    )
);

-- Expiry management settings
CREATE TABLE IF NOT EXISTS expiry_settings (
    id INTEGER PRIMARY KEY
        CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    activation_days INTEGER NOT NULL DEFAULT 3,
    discount_percent REAL NOT NULL DEFAULT 50,
    warning_days INTEGER NOT NULL DEFAULT 7
);

-- Sales recorded against individual batches
CREATE TABLE IF NOT EXISTS expiry_batch_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    order_id INTEGER,
    sale_date TEXT NOT NULL,
    quantity INTEGER NOT NULL
        CHECK (quantity > 0),
    unit_price REAL NOT NULL
        CHECK (unit_price >= 0),
    base_price REAL NOT NULL
        CHECK (base_price >= 0),
    discount_percent REAL NOT NULL DEFAULT 0,

    FOREIGN KEY (batch_id)
        REFERENCES expiry_batches(id) ON DELETE RESTRICT,

    FOREIGN KEY (order_id)
        REFERENCES orders(id) ON DELETE SET NULL
);

-- Expiry notifications
CREATE TABLE IF NOT EXISTS expiry_notifications (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
        CHECK (is_read IN (0, 1)),

    FOREIGN KEY (batch_id)
        REFERENCES expiry_batches(id) ON DELETE CASCADE,

    FOREIGN KEY (product_id)
        REFERENCES products(id) ON DELETE RESTRICT
);

-- Prevent duplicate notifications
CREATE TABLE IF NOT EXISTS expiry_event_keys (
    batch_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    PRIMARY KEY (batch_id, stage),

    FOREIGN KEY (batch_id)
        REFERENCES expiry_batches(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expiry_product
    ON expiry_batches(product_id);

CREATE INDEX IF NOT EXISTS idx_expiry_date
    ON expiry_batches(expiry_date);

CREATE INDEX IF NOT EXISTS idx_expiry_sales_batch
    ON expiry_batch_sales(batch_id);

CREATE INDEX IF NOT EXISTS idx_expiry_notifications_read
    ON expiry_notifications(is_read);

-- Default settings
INSERT OR IGNORE INTO expiry_settings (
    id,
    enabled,
    activation_days,
    discount_percent,
    warning_days
)
VALUES (1, 1, 3, 50, 7);