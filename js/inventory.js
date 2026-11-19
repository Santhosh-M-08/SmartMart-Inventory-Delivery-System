
/*
 * SmartMart — Inventory Management
 *
 * Storage: SQLite through Express REST API
 * Fixed catalog: 15 products (IDs 101–115)
 *
 * Features:
 * - View inventory
 * - Search and category filtering
 * - Low-stock alerts
 * - Edit product price and stock
 * - Inventory summary statistics
 */

(() => {
    "use strict";

    const API_URL = "http://localhost:3000/api/products";

    const THRESHOLD_KEY = "smartmart_low_stock_threshold";
    const DEFAULT_THRESHOLD = 10;

    const state = {
        products: [],
        query: "",
        category: "all",
        lowOnly: false,
        threshold: DEFAULT_THRESHOLD
    };

    const $ = id => document.getElementById(id);

    let toastTimer;
    let saving = false;

    // ------------------------------------------
    // HELPERS
    // ------------------------------------------

    const esc = value =>
        String(value).replace(
            /[&<>"']/g,
            char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[char])
        );

    const money = value =>
        "₹" + Number(value).toLocaleString("en-IN", {
            maximumFractionDigits: 2
        });

    const stockLevel = product => {
        if (product.stock <= 0) {
            return "out";
        }

        if (product.stock <= state.threshold) {
            return "low";
        }

        return "ok";
    };

    function toast(message, isError = false) {
        const element = $("toast");

        element.textContent = message;
        element.classList.toggle("is-error", isError);
        element.hidden = false;

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            element.hidden = true;
        }, 3200);
    }

    // ------------------------------------------
    // SQLITE API
    // ------------------------------------------

    async function getProducts() {
        const response = await fetch(API_URL, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                "Unable to retrieve products from SQLite."
            );
        }

        const products = await response.json();

        if (!Array.isArray(products)) {
            throw new Error(
                "Invalid product data received from API."
            );
        }

        return products;
    }

    async function updateProduct(product) {
        const response = await fetch(
            `${API_URL}/${product.id}`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(product)
            }
        );

        if (!response.ok) {
            let message = "Unable to update product.";

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
                // Keep default error message
            }

            throw new Error(message);
        }

        return response.json();
    }

    async function refreshInventory() {
        state.products = await getProducts();
        render();
    }

    // ------------------------------------------
    // RENDER DASHBOARD
    // ------------------------------------------

    function render() {
        renderCategories();
        renderStats();
        renderTable();
    }

    function renderCategories() {
        const categories = [
            ...new Set(
                state.products.map(product => product.category)
            )
        ].sort((a, b) => a.localeCompare(b));

        if (
            state.category !== "all" &&
            !categories.includes(state.category)
        ) {
            state.category = "all";
        }

        $("categoryFilter").innerHTML =
            '<option value="all">All categories</option>' +
            categories.map(category => `
                <option value="${esc(category)}"
                    ${category === state.category ? "selected" : ""}>
                    ${esc(category)}
                </option>
            `).join("");

        $("categoryList").innerHTML =
            categories.map(category => `
                <option value="${esc(category)}">
            `).join("");
    }

    function renderStats() {
        const products = state.products;

        const low = products.filter(
            product => stockLevel(product) !== "ok"
        );

        const totalUnits = products.reduce(
            (sum, product) => sum + Number(product.stock),
            0
        );

        const totalValue = products.reduce(
            (sum, product) =>
                sum + Number(product.stock) *
                Number(product.price),
            0
        );

        $("statProducts").textContent = products.length;

        $("statUnits").textContent =
            totalUnits.toLocaleString("en-IN");

        $("statLow").textContent = low.length;

        $("statValue").textContent = money(totalValue);

        const banner = $("lowBanner");

        banner.hidden = low.length === 0;

        if (low.length > 0) {
            const outOfStock = low.filter(
                product => product.stock <= 0
            ).length;

            $("lowBannerText").textContent =
                `${low.length} product(s) need restocking` +
                (
                    outOfStock > 0
                        ? ` (${outOfStock} out of stock).`
                        : "."
                );

            $("lowToggle").textContent =
                state.lowOnly
                    ? "Show all products"
                    : "Show only low stock";

        } else {
            state.lowOnly = false;
        }
    }

    function filtered() {
        const query = state.query
            .trim()
            .toLowerCase();

        return state.products.filter(product => {
            const matchesName =
                !query ||
                product.name.toLowerCase().includes(query);

            const matchesCategory =
                state.category === "all" ||
                product.category === state.category;

            const matchesStock =
                !state.lowOnly ||
                stockLevel(product) !== "ok";

            return (
                matchesName &&
                matchesCategory &&
                matchesStock
            );
        });
    }

    const BADGES = {
        ok: ["inv-badge--ok", "In stock"],
        low: ["inv-badge--low", "Low stock"],
        out: ["inv-badge--out", "Out of stock"]
    };

    function renderTable() {
        const products = filtered();

        $("productRows").innerHTML = products.map(product => {
            const level = stockLevel(product);
            const badge = BADGES[level];

            return `
                <tr class="${level !== "ok" ? "is-low" : ""}">
                    <td>#${product.id}</td>

                    <td>
                        <strong>${esc(product.name)}</strong>
                    </td>

                    <td>${esc(product.category)}</td>

                    <td class="num">
                        ${money(product.price)}
                    </td>

                    <td class="num">
                        ${product.stock}
                    </td>

                    <td>
                        <span class="inv-badge ${badge[0]}">
                            ${badge[1]}
                        </span>
                    </td>

                    <td class="actions">
                        <button
                            type="button"
                            class="inv-btn inv-btn--small"
                            data-action="edit"
                            data-id="${product.id}">
                            Edit
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        const empty = $("emptyState");

        empty.hidden = products.length > 0;

        document.querySelector(
            ".inv-table-wrap"
        ).hidden = products.length === 0;

        if (products.length === 0) {
            if (state.products.length === 0) {
                $("emptyTitle").textContent =
                    "No products available";

                $("emptyText").textContent =
                    "Unable to display inventory products.";

                $("emptyAction").hidden = true;
            } else {
                $("emptyTitle").textContent =
                    "No matching products";

                $("emptyText").textContent =
                    "Try another name or category.";

                $("emptyAction").hidden = false;
                $("emptyAction").textContent =
                    "Clear filters";
            }
        }
    }

    // ------------------------------------------
    // EDIT PRODUCT FORM
    // ------------------------------------------

    const dialog = $("productDialog");

    const fields = {
        name: $("fName"),
        category: $("fCategory"),
        price: $("fPrice"),
        stock: $("fStock")
    };

    const errorIds = {
        name: "eName",
        category: "eCategory",
        price: "ePrice",
        stock: "eStock"
    };

    function clearErrors() {
        Object.keys(errorIds).forEach(key => {
            $(errorIds[key]).textContent = "";

            fields[key]
                .closest(".inv-field")
                .classList.remove("has-error");
        });
    }

    function openForm(product) {
        if (!product) {
            toast(
                "The SmartMart catalog is fixed to 15 products.",
                true
            );
            return;
        }

        clearErrors();

        $("productForm").reset();

        $("dialogTitle").textContent = "Edit product";
        $("saveBtn").textContent = "Save changes";

        $("fId").value = product.id;

        fields.name.value = product.name;
        fields.category.value = product.category;
        fields.price.value = product.price;
        fields.stock.value = product.stock;

        // Preserve ML product identity and category
        fields.name.readOnly = true;
        fields.category.readOnly = true;

        dialog.showModal();

        fields.stock.focus();
    }

    function validate(data) {
        const errors = {};

        if (
            !Number.isFinite(data.price) ||
            data.price <= 0
        ) {
            errors.price = "Enter a valid price greater than 0.";
        } else if (data.price > 1000000) {
            errors.price = "Price is too large.";
        }

        if (
            !Number.isInteger(data.stock) ||
            data.stock < 0
        ) {
            errors.stock =
                "Stock must be a whole number, 0 or more.";
        } else if (data.stock > 100000) {
            errors.stock = "Stock quantity is too large.";
        }

        return errors;
    }

    async function onSubmit(event) {
        event.preventDefault();

        if (saving) {
            return;
        }

        clearErrors();

        const id = Number($("fId").value);

        const existingProduct = state.products.find(
            product => product.id === id
        );

        if (!existingProduct) {
            toast("Product not found.", true);
            return;
        }

        // Keep ID, name and category unchanged
        const updatedProduct = {
            id: existingProduct.id,
            name: existingProduct.name,
            category: existingProduct.category,
            price: fields.price.value === ""
                ? NaN
                : Number(fields.price.value),
            stock: fields.stock.value === ""
                ? NaN
                : Number(fields.stock.value)
        };

        const errors = validate(updatedProduct);
        const keys = Object.keys(errors);

        if (keys.length > 0) {
            keys.forEach(key => {
                $(errorIds[key]).textContent = errors[key];

                fields[key]
                    .closest(".inv-field")
                    .classList.add("has-error");
            });

            fields[keys[0]].focus();

            toast("Please fix the highlighted fields.", true);
            return;
        }

        saving = true;
        $("saveBtn").disabled = true;

        try {
            // Save changes to SQLite
            await updateProduct(updatedProduct);

            // Refresh inventory from the database
            await refreshInventory();

            dialog.close();

            toast(
                `Updated "${updatedProduct.name}" successfully.`
            );

        } catch (error) {
            toast(error.message, true);

        } finally {
            saving = false;
            $("saveBtn").disabled = false;
        }
    }

    // ------------------------------------------
    // FILTER CONTROLS
    // ------------------------------------------

    function clearFilters() {
        state.query = "";
        state.category = "all";
        state.lowOnly = false;

        $("searchInput").value = "";

        render();
    }

    // ------------------------------------------
    // INITIALIZATION
    // ------------------------------------------

    async function init() {
        // Fixed 15-product catalog:
        // disable product creation
        $("addBtn").hidden = true;
        $("emptyAction").hidden = true;

        // Load saved low-stock threshold
        const saved = Number(
            localStorage.getItem(THRESHOLD_KEY)
        );

        state.threshold =
            Number.isInteger(saved) && saved > 0
                ? saved
                : DEFAULT_THRESHOLD;

        $("thresholdInput").value = state.threshold;

        // Search
        $("searchInput").addEventListener(
            "input",
            event => {
                state.query = event.target.value;
                renderTable();
            }
        );

        // Category filtering
        $("categoryFilter").addEventListener(
            "change",
            event => {
                state.category = event.target.value;
                renderTable();
            }
        );

        // Clear filters
        $("clearBtn").addEventListener(
            "click",
            clearFilters
        );

        $("emptyAction").addEventListener(
            "click",
            clearFilters
        );

        // Low-stock toggle
        $("lowToggle").addEventListener(
            "click",
            () => {
                state.lowOnly = !state.lowOnly;
                render();
            }
        );

        // Change low-stock threshold
        $("thresholdInput").addEventListener(
            "change",
            event => {
                const value = Number(event.target.value);

                if (
                    !Number.isInteger(value) ||
                    value < 1 ||
                    value > 1000
                ) {
                    toast(
                        "Threshold must be between 1 and 1000.",
                        true
                    );

                    event.target.value = state.threshold;
                    return;
                }

                state.threshold = value;

                try {
                    localStorage.setItem(
                        THRESHOLD_KEY,
                        String(value)
                    );
                } catch (error) {
                    // Threshold still works for this session
                }

                toast(
                    `Low-stock threshold set to ${value}.`
                );

                render();
            }
        );

        // Edit product
        $("productRows").addEventListener(
            "click",
            event => {
                const button = event.target.closest(
                    "button[data-action]"
                );

                if (!button) {
                    return;
                }

                if (button.dataset.action === "edit") {
                    const id = Number(button.dataset.id);

                    const product = state.products.find(
                        item => item.id === id
                    );

                    openForm(product);
                }
            }
        );

        // Save product changes
        $("productForm").addEventListener(
            "submit",
            onSubmit
        );

        // Cancel editing
        $("cancelBtn").addEventListener(
            "click",
            () => {
                if (!saving) {
                    dialog.close();
                }
            }
        );

        // Close dialog on backdrop click
        dialog.addEventListener(
            "click",
            event => {
                if (event.target === dialog && !saving) {
                    dialog.close();
                }
            }
        );

        // Load inventory from SQLite
        try {
            await refreshInventory();
        } catch (error) {
            console.error(
                "Inventory initialization failed:",
                error
            );

            render();

            toast(
                "Cannot connect to SmartMart backend. " +
                "Start the Express server on port 3000.",
                true
            );
        }
    }

    init();
})();
