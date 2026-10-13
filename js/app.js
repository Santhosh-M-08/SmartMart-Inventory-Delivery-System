// =========================
// SMARTMART DASHBOARD
// =========================

const LOW_STOCK_THRESHOLD = 20;

document.addEventListener("DOMContentLoaded", function () {
    initializeDashboard();
    initializeSidebar();
    initializeLogout();
});

// =========================
// DASHBOARD INITIALIZATION
// =========================

function initializeDashboard() {
    try {
        const products = getProducts();
        const orders = getOrders();

        renderDashboardStats(products, orders);
        renderRecentOrders(orders);
        renderCurrentDate();
    } catch (error) {
        console.error("Unable to load dashboard data:", error);
        showDashboardError();
    }
}

// =========================
// SUMMARY CARDS
// =========================

function renderDashboardStats(products, orders) {
    const today = getLocalDateString(new Date());

    const totalProducts = products.length;

    const lowStockProducts = products.filter(function (product) {
        return Number(product.stock) < LOW_STOCK_THRESHOLD;
    }).length;

    const ordersToday = orders.filter(function (order) {
        return order.orderDate === today;
    }).length;

    const pendingDeliveries = orders.filter(function (order) {
        return order.status === "Pending";
    }).length;

    setText("totalProducts", totalProducts);
    setText("lowStockProducts", lowStockProducts);
    setText("ordersToday", ordersToday);
    setText("pendingDeliveries", pendingDeliveries);
}

// Return YYYY-MM-DD in the browser's local timezone.
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// =========================
// RECENT ORDERS
// =========================

function renderRecentOrders(orders) {
    const tbody = document.getElementById("recentOrdersBody");

    if (!tbody) {
        return;
    }

    tbody.replaceChildren();

    const recentOrders = [...orders]
        .sort(function (a, b) {
            const dateComparison = String(b.orderDate || "")
                .localeCompare(String(a.orderDate || ""));

            return dateComparison || Number(b.id) - Number(a.id);
        })
        .slice(0, 5);

    if (recentOrders.length === 0) {
        showTableMessage("No orders available yet.");
        return;
    }

    recentOrders.forEach(function (order) {
        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.className = "order-id";
        idCell.textContent = `#${order.id}`;

        const customerCell = document.createElement("td");
        customerCell.className = "customer-name";
        customerCell.textContent = order.customerName || "Unknown";

        const dateCell = document.createElement("td");
        dateCell.textContent = formatOrderDate(order.orderDate);

        const totalCell = document.createElement("td");
        totalCell.className = "money";
        totalCell.textContent = formatCurrency(order.total);

        const statusCell = document.createElement("td");
        const badge = document.createElement("span");

        badge.className = `status-badge ${getStatusClass(order.status)}`;
        badge.textContent = order.status || "Unknown";

        statusCell.appendChild(badge);

        row.append(
            idCell,
            customerCell,
            dateCell,
            totalCell,
            statusCell
        );

        tbody.appendChild(row);
    });
}

function getStatusClass(status) {
    const statusClasses = {
        Pending: "status-pending",
        Processing: "status-processing",
        Dispatched: "status-dispatched",
        Delivered: "status-delivered",
        Cancelled: "status-cancelled"
    };

    return statusClasses[status] || "";
}

function formatOrderDate(dateString) {
    if (!dateString) {
        return "—";
    }

    // Parse date-only values as calendar dates, not UTC timestamps.
    const parts = String(dateString).split("-");

    if (parts.length !== 3) {
        return "—";
    }

    const [year, month, day] = parts;

    if (!year || !month || !day) {
        return "—";
    }

    return `${day}/${month}/${year}`;
}

function formatCurrency(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        return "—";
    }

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// =========================
// DATE AND UI HELPERS
// =========================

function renderCurrentDate() {
    const element = document.getElementById("currentDate");

    if (!element) {
        return;
    }

    element.textContent = new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
    }).format(new Date());
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = String(value);
    }
}

function showTableMessage(message) {
    const tbody = document.getElementById("recentOrdersBody");
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = message;

    row.appendChild(cell);
    tbody.replaceChildren(row);
}

function showDashboardError() {
    [
        "totalProducts",
        "lowStockProducts",
        "ordersToday",
        "pendingDeliveries"
    ].forEach(function (id) {
        setText(id, "—");
    });

    showTableMessage("Unable to load orders. Check your browser storage.");
}

// =========================
// RESPONSIVE SIDEBAR
// =========================

function initializeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("menuToggle");
    const overlay = document.getElementById("sidebarOverlay");

    if (!sidebar || !toggle || !overlay) {
        return;
    }

    function closeSidebar() {
        sidebar.classList.remove("sidebar-open");
        overlay.classList.remove("overlay-visible");
        toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function () {
        const isOpen = sidebar.classList.toggle("sidebar-open");

        overlay.classList.toggle("overlay-visible", isOpen);
        toggle.setAttribute("aria-expanded", String(isOpen));
    });

    overlay.addEventListener("click", closeSidebar);

    sidebar.querySelectorAll(".nav-link").forEach(function (link) {
        link.addEventListener("click", closeSidebar);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeSidebar();
        }
    });

    window.addEventListener("resize", function () {
        if (window.innerWidth > 760) {
            closeSidebar();
        }
    });
}

// =========================
// DEMO LOGOUT
// =========================

function initializeLogout() {
    const logoutButton = document.getElementById("logoutButton");

    if (!logoutButton) {
        return;
    }

    logoutButton.addEventListener("click", function () {
        sessionStorage.removeItem("smartmart_demo_logged_in");
    });
}