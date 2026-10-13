
const LOW_STOCK_THRESHOLD = 20;
const RECENT_ITEMS_LIMIT = 5;

document.addEventListener("DOMContentLoaded", function () {
    initializeDashboard();
    initializeSidebar();
    initializeLogout();
});

function initializeDashboard() {
    try {
        const products = getProducts();
        const orders = getOrders();

        renderDashboardStats(products, orders);
        renderStockAlerts(products);
        renderOrderStatusOverview(orders);
        renderRecentOrders(orders);
        renderRecentActivity(orders);
        renderCurrentDate();
    } catch (error) {
        console.error("Unable to load dashboard data:", error);
        showDashboardError();
    }
}

// =========================
// DASHBOARD SUMMARY
// =========================

function renderDashboardStats(products, orders) {
    const today = getLocalDateString(new Date());

    const totalProducts = products.length;

    const lowStockProducts = products.filter(function (product) {
        return Number(product.stock) < LOW_STOCK_THRESHOLD;
    }).length;

    const todaysOrders = orders.filter(function (order) {
        return order.orderDate === today;
    });

    const pendingDeliveries = orders.filter(function (order) {
        return order.status === "Pending";
    }).length;

    const todaysOrderValue = todaysOrders.reduce(function (total, order) {
        return total + (Number(order.total) || 0);
    }, 0);

    setText("totalProducts", totalProducts);
    setText("lowStockProducts", lowStockProducts);
    setText("ordersToday", todaysOrders.length);
    setText("pendingDeliveries", pendingDeliveries);
    setText("todayOrderValue", formatCurrency(todaysOrderValue));
}

function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// =========================
// STOCK ALERTS
// =========================

function renderStockAlerts(products) {
    const container = document.getElementById("stockAlertsList");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const lowStockItems = products
        .filter(function (product) {
            return Number(product.stock) < LOW_STOCK_THRESHOLD;
        })
        .sort(function (a, b) {
            return Number(a.stock) - Number(b.stock);
        })
        .slice(0, RECENT_ITEMS_LIMIT);

    if (lowStockItems.length === 0) {
        container.appendChild(
            createMessage(
                "All products have stock of 20 units or more.",
                "empty-state"
            )
        );
        return;
    }

    lowStockItems.forEach(function (product) {
        const item = document.createElement("div");
        item.className = "stock-alert-item";

        const productInfo = document.createElement("div");

        const name = document.createElement("span");
        name.className = "stock-product-name";
        name.textContent = product.name;

        const category = document.createElement("span");
        category.className = "stock-product-category";
        category.textContent = product.category || "Uncategorized";

        productInfo.append(name, category);

        const quantity = document.createElement("span");
        quantity.className = "stock-quantity";
        quantity.textContent = `${Number(product.stock) || 0} left`;

        item.append(productInfo, quantity);
        container.appendChild(item);
    });
}

// =========================
// ORDER STATUS OVERVIEW
// =========================

function renderOrderStatusOverview(orders) {
    const container = document.getElementById("orderStatusOverview");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const totalOrders = orders.length;

    ORDER_STATUSES.forEach(function (status) {
        const count = orders.filter(function (order) {
            return order.status === status;
        }).length;

        const percentage = totalOrders === 0
            ? 0
            : (count / totalOrders) * 100;

        const row = document.createElement("div");
        row.className = "status-row";

        const rowTop = document.createElement("div");
        rowTop.className = "status-row-top";

        const labelWrap = document.createElement("div");
        labelWrap.className = "status-label-wrap";

        const dot = document.createElement("span");
        dot.className = `status-dot ${getStatusClass(status)}`;
        dot.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.textContent = status;

        labelWrap.append(dot, label);

        const countLabel = document.createElement("span");
        countLabel.className = "status-count";
        countLabel.textContent = `${count} ${count === 1 ? "order" : "orders"}`;

        rowTop.append(labelWrap, countLabel);

        const track = document.createElement("div");
        track.className = "status-track";
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `${status} orders`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", String(Math.round(percentage)));

        const fill = document.createElement("div");
        fill.className = `status-fill ${getStatusClass(status)}`;
        fill.style.width = `${percentage}%`;

        track.appendChild(fill);
        row.append(rowTop, track);
        container.appendChild(row);
    });

    if (totalOrders === 0) {
        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = "No orders have been recorded yet.";
        container.prepend(message);
    }
}

// =========================
// RECENT ORDERS TABLE
// =========================

function renderRecentOrders(orders) {
    const tableBody = document.getElementById("recentOrdersBody");

    if (!tableBody) {
        return;
    }

    tableBody.replaceChildren();

    const recentOrders = getSortedRecentOrders(orders)
        .slice(0, RECENT_ITEMS_LIMIT);

    if (recentOrders.length === 0) {
        showTableMessage("No orders found.");
        return;
    }

    recentOrders.forEach(function (order) {
        const row = document.createElement("tr");

        const idCell = document.createElement("td");
        idCell.className = "order-id";
        idCell.textContent = `#${order.id}`;

        const customerCell = document.createElement("td");
        customerCell.className = "order-customer";
        customerCell.textContent = order.customerName || "Unknown customer";

        const dateCell = document.createElement("td");
        dateCell.textContent = formatOrderDate(order.orderDate);

        const amountCell = document.createElement("td");
        amountCell.className = "order-amount";
        amountCell.textContent = formatCurrency(order.total);

        const statusCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `status-badge ${getStatusClass(order.status)}`;
        badge.textContent = order.status || "Unknown";
        statusCell.appendChild(badge);

        row.append(
            idCell,
            customerCell,
            dateCell,
            amountCell,
            statusCell
        );

        tableBody.appendChild(row);
    });
}

// =========================
// RECENT ACTIVITY
// =========================

function renderRecentActivity(orders) {
    const container = document.getElementById("recentActivityList");

    if (!container) {
        return;
    }

    container.replaceChildren();

    const recentOrders = getSortedRecentOrders(orders)
        .slice(0, RECENT_ITEMS_LIMIT);

    if (recentOrders.length === 0) {
        container.appendChild(
            createMessage("No recent orders to display.", "empty-state")
        );
        return;
    }

    recentOrders.forEach(function (order) {
        const item = document.createElement("div");
        item.className = "activity-item";

        const marker = document.createElement("span");
        marker.className = "activity-marker";
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = "▣";

        const main = document.createElement("div");
        main.className = "activity-main";

        const title = document.createElement("p");
        title.className = "activity-title";
        title.textContent =
            `Order #${order.id} — ${order.customerName || "Unknown customer"}`;

        const details = document.createElement("div");
        details.className = "activity-detail";

        const date = document.createElement("span");
        date.textContent = formatOrderDate(order.orderDate);

        const separator = document.createElement("span");
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";

        const status = document.createElement("span");
        status.className = "activity-status";
        status.textContent = order.status || "Unknown status";

        details.append(date, separator, status);
        main.append(title, details);
        item.append(marker, main);

        container.appendChild(item);
    });
}

function getSortedRecentOrders(orders) {
    return [...orders].sort(function (a, b) {
        const dateComparison = String(b.orderDate || "")
            .localeCompare(String(a.orderDate || ""));

        if (dateComparison !== 0) {
            return dateComparison;
        }

        return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
}

// =========================
// FORMATTING AND HELPERS
// =========================

function getStatusClass(status) {
    const classes = {
        Pending: "status-pending",
        Processing: "status-processing",
        Dispatched: "status-dispatched",
        Delivered: "status-delivered",
        Cancelled: "status-cancelled"
    };

    return classes[status] || "";
}

function formatOrderDate(dateString) {
    if (!dateString) {
        return "—";
    }

    const parts = String(dateString).split("-");

    if (parts.length !== 3) {
        return dateString;
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(amount) || 0);
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function createMessage(message, className) {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = message;
    return element;
}

function showTableMessage(message) {
    const tableBody = document.getElementById("recentOrdersBody");

    if (!tableBody) {
        return;
    }

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "table-message";
    cell.textContent = message;

    row.appendChild(cell);
    tableBody.replaceChildren(row);
}

function showDashboardError() {
    setText("totalProducts", "—");
    setText("lowStockProducts", "—");
    setText("ordersToday", "—");
    setText("pendingDeliveries", "—");
    setText("todayOrderValue", "—");

    showTableMessage("Unable to load orders. Check the browser console.");

    const stockAlerts = document.getElementById("stockAlertsList");
    if (stockAlerts) {
        stockAlerts.replaceChildren(
            createMessage("Unable to load stock alerts.", "empty-state")
        );
    }

    const statusOverview = document.getElementById("orderStatusOverview");
    if (statusOverview) {
        statusOverview.replaceChildren(
            createMessage("Unable to load order statuses.", "empty-state")
        );
    }

    const activity = document.getElementById("recentActivityList");
    if (activity) {
        activity.replaceChildren(
            createMessage("Unable to load recent activity.", "empty-state")
        );
    }
}

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

// =========================
// RESPONSIVE SIDEBAR
// =========================

function initializeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const menuToggle = document.getElementById("menuToggle");
    const overlay = document.getElementById("sidebarOverlay");

    if (!sidebar || !menuToggle || !overlay) {
        return;
    }

    function closeSidebar() {
        sidebar.classList.remove("sidebar-open");
        overlay.classList.remove("overlay-visible");
        menuToggle.setAttribute("aria-expanded", "false");
    }

    function toggleSidebar() {
        const isOpen = sidebar.classList.toggle("sidebar-open");

        overlay.classList.toggle("overlay-visible", isOpen);
        menuToggle.setAttribute("aria-expanded", String(isOpen));
    }

    menuToggle.addEventListener("click", toggleSidebar);
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
        if (window.innerWidth > 900) {
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
        window.location.href = "login.html";
    });
}
