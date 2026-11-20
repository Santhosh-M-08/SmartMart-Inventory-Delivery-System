
/*
 * SmartMart — Shared Orders & Delivery Data
 *
 * Products: SQLite through Express API
 * Orders: SQLite through Express API
 *
 * Fixed product catalog: IDs 101–115
 */

const API_BASE_URL = "http://localhost:3000/api";

const ORDER_STATUSES = [
    "Pending",
    "Processing",
    "Dispatched",
    "Delivered",
    "Cancelled"
];

// Cached data for the existing Delivery UI.
// The database remains the source of truth.
let cachedProducts = [];
let cachedOrders = [];

// ------------------------------------------
// API HELPER
// ------------------------------------------

async function apiRequest(endpoint, options = {}) {
    let response;

    try {
        response = await fetch(
            `${API_BASE_URL}${endpoint}`,
            {
                cache: "no-store",
                ...options
            }
        );
    } catch (error) {
        throw new Error(
            "Cannot connect to SmartMart backend. " +
            "Make sure the server is running on port 3000."
        );
    }

    if (!response.ok) {
        let message = `Request failed (${response.status}).`;

        try {
            const result = await response.json();

            if (result.error) {
                message = result.error;
            } else if (result.errors) {
                message = Object.values(
                    result.errors
                ).join(" ");
            }
        } catch (error) {
            // Keep the default message.
        }

        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

// ------------------------------------------
// LOAD PRODUCTS AND ORDERS
// ------------------------------------------

async function refreshData() {
    const [products, orders] = await Promise.all([
        apiRequest("/products"),
        apiRequest("/orders")
    ]);

    if (!Array.isArray(products)) {
        throw new Error("Invalid products response.");
    }

    if (!Array.isArray(orders)) {
        throw new Error("Invalid orders response.");
    }

    cachedProducts = products;
    cachedOrders = orders;

    return {
        products: cachedProducts,
        orders: cachedOrders
    };
}

// ------------------------------------------
// SHARED DATA ACCESS
// ------------------------------------------

// These functions remain synchronous so the
// existing Delivery rendering code can use them.
function getProducts() {
    return cachedProducts;
}

function getOrders() {
    return cachedOrders;
}

// ------------------------------------------
// UPDATE ORDER STATUS
// ------------------------------------------

async function updateOrderStatus(orderId, status) {
    if (!ORDER_STATUSES.includes(status)) {
        throw new Error("Invalid order status.");
    }

    const updatedOrder = await apiRequest(
        `/orders/${orderId}/status`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ status })
        }
    );

    // Reload database records after successful save.
    await refreshData();

    return updatedOrder;
}

// ------------------------------------------
// CREATE ORDER
// ------------------------------------------

async function createOrder(customerName, items) {
    if (
        typeof customerName !== "string" ||
        !customerName.trim()
    ) {
        throw new Error("Customer name is required.");
    }

    if (!Array.isArray(items) || items.length === 0) {
        throw new Error(
            "Please add at least one product."
        );
    }

    // Validate item structure before sending.
    const quantities = new Map();

    for (const item of items) {
        if (
            !Number.isSafeInteger(item.productId) ||
            !Number.isSafeInteger(item.quantity) ||
            item.productId <= 0 ||
            item.quantity <= 0
        ) {
            throw new Error(
                "Invalid product or quantity."
            );
        }

        const combined =
            (quantities.get(item.productId) || 0) +
            item.quantity;

        if (!Number.isSafeInteger(combined)) {
            throw new Error(
                "Order quantity is too large."
            );
        }

        quantities.set(item.productId, combined);
    }

    const normalizedItems = Array.from(
        quantities,
        ([productId, quantity]) => ({
            productId,
            quantity
        })
    );

    // The backend validates live stock, calculates
    // prices and performs stock deduction atomically.
    const newOrder = await apiRequest(
        "/orders",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                customerName: customerName.trim(),
                items: normalizedItems
            })
        }
    );

    // Refresh products and orders from SQLite.
    await refreshData();

    return newOrder;
}
