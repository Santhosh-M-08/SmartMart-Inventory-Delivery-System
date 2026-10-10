// ========================================
// SMARTMART - ORDERS & DELIVERY
// File: js/delivery.js
// ========================================

document.addEventListener("DOMContentLoaded", function () {
    // Shared data comes from js/data.js.
    const orderTableBody = document.getElementById("ordersTableBody");
    const searchInput = document.getElementById("orderSearch");
    const statusFilter = document.getElementById("statusFilter");
    const emptyState = document.getElementById("emptyState");
    const visibleOrderCount = document.getElementById("visibleOrderCount");

    const modal = document.getElementById("orderDetailsModal");
    const closeModalBtn = document.getElementById("closeOrderModalBtn");
    const closeModalFooterBtn = document.getElementById("closeOrderModalFooterBtn");
    const saveStatusBtn = document.getElementById("saveOrderStatusBtn");
    const detailStatusSelect = document.getElementById("detailStatusSelect");
    const toastContainer = document.getElementById("toastContainer");

    let selectedOrderId = null;

    const validStatuses = [
        "Pending",
        "Processing",
        "Dispatched",
        "Delivered",
        "Cancelled"
    ];

    // Return the CSS class for an order status.
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

    // Format a number as Indian Rupees.
    function formatCurrency(amount) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            minimumFractionDigits: 2
        }).format(amount);
    }

    // Format YYYY-MM-DD without shifting the date by timezone.
    function formatDate(dateString) {
        if (!dateString) {
            return "—";
        }

        const parts = dateString.split("-");

        if (parts.length !== 3) {
            return dateString;
        }

        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    // Find a product using the shared product dataset.
    function findProduct(productId) {
        return getProducts().find(function (product) {
            return product.id === productId;
        });
    }

    // Safely create an HTML element containing text.
    function createTextElement(tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
    }

    // Show a notification to the user.
    function showToast(message, isError = false) {
        const toast = document.createElement("div");
        toast.className = isError ? "toast toast-error" : "toast";
        toast.textContent = message;

        toastContainer.appendChild(toast);

        window.setTimeout(function () {
            toast.remove();
        }, 3000);
    }

    // Calculate and update summary counts from shared orders.
    function updateSummary() {
        const orders = getOrders();

        document.getElementById("totalOrders").textContent = orders.length;

        document.getElementById("pendingOrders").textContent =
            orders.filter(order => order.status === "Pending").length;

        document.getElementById("processingOrders").textContent =
            orders.filter(order => order.status === "Processing").length;

        document.getElementById("dispatchedOrders").textContent =
            orders.filter(order => order.status === "Dispatched").length;

        document.getElementById("deliveredOrders").textContent =
            orders.filter(order => order.status === "Delivered").length;

        document.getElementById("cancelledOrders").textContent =
        orders.filter(order => order.status === "Cancelled").length;
    }

    // Create a status badge without inserting untrusted HTML.
    function createStatusBadge(status) {
        const badge = createTextElement(
            "span",
            "status-badge " + getStatusClass(status),
            status
        );

        return badge;
    }

    // Render the orders table using the current search and filter.
    function renderOrders() {
        const orders = getOrders();
        const searchTerm = searchInput.value.trim().toLowerCase();
        const selectedStatus = statusFilter.value;

        const filteredOrders = orders.filter(function (order) {
            const matchesSearch =
                String(order.id).toLowerCase().includes(searchTerm) ||
                order.customerName.toLowerCase().includes(searchTerm);

            const matchesStatus =
                selectedStatus === "All" ||
                order.status === selectedStatus;

            return matchesSearch && matchesStatus;
        });

        orderTableBody.replaceChildren();

        filteredOrders.forEach(function (order) {
            const row = document.createElement("tr");

            // Order ID
            const idCell = document.createElement("td");
            idCell.appendChild(
                createTextElement("span", "order-id", "#" + order.id)
            );
            row.appendChild(idCell);

            // Customer name
            const customerCell = document.createElement("td");
            customerCell.appendChild(
                createTextElement("span", "customer-name", order.customerName)
            );
            row.appendChild(customerCell);

            // Total quantity of items
            const itemCount = order.items.reduce(function (sum, item) {
                return sum + item.quantity;
            }, 0);

            const itemsCell = document.createElement("td");
            itemsCell.appendChild(
                createTextElement(
                    "span",
                    "item-count",
                    `${itemCount} item${itemCount === 1 ? "" : "s"}`
                )
            );
            row.appendChild(itemsCell);

            // Order total
            const totalCell = document.createElement("td");
            totalCell.appendChild(
                createTextElement(
                    "span",
                    "order-amount",
                    formatCurrency(order.total)
                )
            );
            row.appendChild(totalCell);

            // Order date
            const dateCell = document.createElement("td");
            dateCell.appendChild(
                createTextElement(
                    "span",
                    "order-date",
                    formatDate(order.orderDate)
                )
            );
            row.appendChild(dateCell);

            // Status badge
            const statusCell = document.createElement("td");
            statusCell.appendChild(createStatusBadge(order.status));
            row.appendChild(statusCell);

            // Details action
            const actionCell = document.createElement("td");
            const detailsButton = createTextElement(
                "button",
                "action-btn",
                "View details"
            );

            detailsButton.type = "button";
            detailsButton.setAttribute(
                "aria-label",
                `View details for order ${order.id}`
            );

            detailsButton.addEventListener("click", function () {
                openOrderDetails(order.id);
            });

            actionCell.appendChild(detailsButton);
            row.appendChild(actionCell);

            orderTableBody.appendChild(row);
        });

        visibleOrderCount.textContent =
            `${filteredOrders.length} order${filteredOrders.length === 1 ? "" : "s"}`;

        emptyState.hidden = filteredOrders.length !== 0;
    }

    // Refresh every part of the page that depends on order data.
    function refreshUI() {
        updateSummary();
        renderOrders();

        if (selectedOrderId !== null && modal.open) {
            const currentOrder = getOrders().find(function (order) {
                return order.id === selectedOrderId;
            });

            if (currentOrder) {
                populateOrderDetails(currentOrder);
            }
        }
    }

    // Fill the order details modal.
    function populateOrderDetails(order) {
        document.getElementById("modalOrderId").textContent =
            `Order #${order.id}`;

        document.getElementById("detailCustomerName").textContent =
            order.customerName;

        document.getElementById("detailOrderDate").textContent =
            formatDate(order.orderDate);

        const detailStatus = document.getElementById("detailStatus");
        detailStatus.textContent = order.status;
        detailStatus.className =
            "status-badge " + getStatusClass(order.status);

        document.getElementById("detailOrderTotal").textContent =
            formatCurrency(order.total);

        detailStatusSelect.value = order.status;

        const itemsBody = document.getElementById("orderItemsBody");
        itemsBody.replaceChildren();

        order.items.forEach(function (item) {
            const row = document.createElement("tr");
            const product = findProduct(item.productId);
            const productName = product
                ? product.name
                : `Unknown product (#${item.productId})`;

            const subtotal = item.quantity * item.price;

            row.appendChild(
                createTextElement("td", "", productName)
            );

            row.appendChild(
                createTextElement("td", "", String(item.quantity))
            );

            row.appendChild(
                createTextElement("td", "", formatCurrency(item.price))
            );

            row.appendChild(
                createTextElement("td", "", formatCurrency(subtotal))
            );

            itemsBody.appendChild(row);
        });
    }

    // Open the selected order's modal.
    function openOrderDetails(orderId) {
        const order = getOrders().find(function (item) {
            return item.id === orderId;
        });

        if (!order) {
            showToast("Order could not be found.", true);
            return;
        }

        selectedOrderId = orderId;
        populateOrderDetails(order);
        modal.showModal();
    }

    // Close the modal and clear the current selection.
    function closeOrderDetails() {
        modal.close();
        selectedOrderId = null;
    }

    // Search orders by ID or customer name.
    searchInput.addEventListener("input", renderOrders);

    // Filter orders by status.
    statusFilter.addEventListener("change", renderOrders);

    // Reset search and status filters.
    function clearFilters() {
        searchInput.value = "";
        statusFilter.value = "All";
        renderOrders();
    }

    document.getElementById("clearFiltersBtn")
        .addEventListener("click", clearFilters);

    document.getElementById("emptyStateClearBtn")
        .addEventListener("click", clearFilters);

    // Modal close controls.
    closeModalBtn.addEventListener("click", closeOrderDetails);
    closeModalFooterBtn.addEventListener("click", closeOrderDetails);

    // Also clear selection when the dialog closes through Escape.
    modal.addEventListener("close", function () {
        selectedOrderId = null;
    });

    // Save a status update through the shared data function.
    saveStatusBtn.addEventListener("click", function () {
        if (selectedOrderId === null) {
            showToast("Please select an order first.", true);
            return;
        }

        const newStatus = detailStatusSelect.value;

        if (!validStatuses.includes(newStatus)) {
            showToast("Please select a valid order status.", true);
            return;
        }

        try {
            updateOrderStatus(selectedOrderId, newStatus);
            refreshUI();
            showToast(`Order #${selectedOrderId} updated to ${newStatus}.`);
        } catch (error) {
            showToast(error.message || "Unable to update order.", true);
        }
    });

    // Initial page load.
    refreshUI();
});
