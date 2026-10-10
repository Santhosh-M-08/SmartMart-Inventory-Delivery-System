
const PRODUCT_STORAGE_KEY = "smartmart_products";
const ORDER_STORAGE_KEY = "smartmart_orders";

const ORDER_STATUSES = [
    "Pending",
    "Processing",
    "Dispatched",
    "Delivered",
    "Cancelled"
];

// Fictional sample products
const sampleProducts = [
    {
        id: 101,
        name: "Milk",
        category: "Dairy",
        price: 30,
        stock: 50
    },
    {
        id: 102,
        name: "Bread",
        category: "Bakery",
        price: 40,
        stock: 35
    },
    {
        id: 103,
        name: "Rice",
        category: "Grains",
        price: 60,
        stock: 80
    },
    {
        id: 104,
        name: "Eggs",
        category: "Dairy",
        price: 7,
        stock: 100
    },
    {
        id: 105,
        name: "Apples",
        category: "Fruits",
        price: 120,
        stock: 25
    },
    {
        id: 106,
        name: "Cooking Oil",
        category: "Groceries",
        price: 150,
        stock: 40
    }
];

// Fictional sample orders
// Item price represents the unit price at order time.
const sampleOrders = [
    {
        id: 1001,
        customerName: "Rahul Sharma",
        items: [
            { productId: 101, quantity: 2, price: 30 },
            { productId: 102, quantity: 1, price: 40 }
        ],
        total: 100,
        status: "Pending",
        orderDate: "2026-10-10"
    },
    {
        id: 1002,
        customerName: "Priya Rao",
        items: [
            { productId: 103, quantity: 2, price: 60 },
            { productId: 104, quantity: 6, price: 7 }
        ],
        total: 162,
        status: "Processing",
        orderDate: "2026-10-09"
    },
    {
        id: 1003,
        customerName: "Arjun Kumar",
        items: [
            { productId: 105, quantity: 1, price: 120 },
            { productId: 101, quantity: 1, price: 30 }
        ],
        total: 150,
        status: "Dispatched",
        orderDate: "2026-10-09"
    },
    {
        id: 1004,
        customerName: "Sneha Patel",
        items: [
            { productId: 106, quantity: 1, price: 150 },
            { productId: 102, quantity: 2, price: 40 }
        ],
        total: 230,
        status: "Delivered",
        orderDate: "2026-10-08"
    },
    {
        id: 1005,
        customerName: "Vikram Singh",
        items: [
            { productId: 103, quantity: 1, price: 60 }
        ],
        total: 60,
        status: "Cancelled",
        orderDate: "2026-10-08"
    },
    {
        id: 1006,
        customerName: "Ananya Reddy",
        items: [
            { productId: 105, quantity: 2, price: 120 },
            { productId: 104, quantity: 12, price: 7 }
        ],
        total: 324,
        status: "Pending",
        orderDate: "2026-10-10"
    }
];

// Initialize sample data without overwriting saved data.
function initializeSampleData() {
    if (localStorage.getItem(PRODUCT_STORAGE_KEY) === null) {
        localStorage.setItem(
            PRODUCT_STORAGE_KEY,
            JSON.stringify(sampleProducts)
        );
    }

    if (localStorage.getItem(ORDER_STORAGE_KEY) === null) {
        localStorage.setItem(
            ORDER_STORAGE_KEY,
            JSON.stringify(sampleOrders)
        );
    }
}

// Return the shared product list.
function getProducts() {
    const products = localStorage.getItem(PRODUCT_STORAGE_KEY);
    return products === null ? [] : JSON.parse(products);
}

// Return the shared order list.
function getOrders() {
    const orders = localStorage.getItem(ORDER_STORAGE_KEY);
    return orders === null ? [] : JSON.parse(orders);
}

// Update one order and persist its new status.
function updateOrderStatus(orderId, status) {
    if (!ORDER_STATUSES.includes(status)) {
        throw new Error("Invalid order status.");
    }

    const orders = getOrders();
    const order = orders.find(item => item.id === orderId);

    if (!order) {
        throw new Error("Order not found.");
    }

    order.status = status;

    localStorage.setItem(
        ORDER_STORAGE_KEY,
        JSON.stringify(orders)
    );

    return order;
}

// Make sure sample data is available when this file loads.
initializeSampleData();
