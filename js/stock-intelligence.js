
/*
 * SmartMart AI Stock Intelligence
 *
 * Inventory Source: SQLite via Express REST API
 * Forecast Source: ML-generated forecasts.json
 *
 * Product IDs in SQLite match ML forecast IDs (101-115).
 */

const API_URL = "http://localhost:3000/api/products";
const FORECAST_URL = "ml/data/forecasts.json";

// Inventory planning assumptions
const LEAD_TIME = 2;
const SAFETY_DAYS = 2;

// ML forecasts
let forecasts = [];

// DOM helper
const el = (id) => document.getElementById(id);

// ------------------------------------------
// CREATE TABLE CELL
// ------------------------------------------

function cell(row, value) {
    const td = document.createElement("td");
    td.textContent = String(value);
    row.appendChild(td);
    return td;
}

// ------------------------------------------
// LOAD PRODUCTS FROM SQLITE API
// ------------------------------------------

async function loadInventory() {
    let response;

    try {
        response = await fetch(API_URL, {
            cache: "no-store"
        });
    } catch (error) {
        throw new Error(
            "Cannot connect to SmartMart backend. " +
            "Make sure the Express server is running on port 3000."
        );
    }

    if (!response.ok) {
        throw new Error(
            "Unable to load products from SmartMart SQLite API."
        );
    }

    const products = await response.json();

    if (!Array.isArray(products)) {
        throw new Error(
            "Invalid product data received from the API."
        );
    }

    return products;
}

// ------------------------------------------
// ANALYZE STOCK USING ML FORECASTS
// ------------------------------------------

function analyzeProduct(product) {
    // SQLite IDs match ML product IDs directly
    const forecast = forecasts.find(
        (f) => Number(f.product_id) === Number(product.id)
    );

    if (!forecast) {
        return null;
    }

    const stock = Number(product.stock);
    const demand = Number(forecast.predicted_demand);

    if (
        !Number.isFinite(stock) ||
        stock < 0 ||
        !Number.isFinite(demand) ||
        demand < 0
    ) {
        return null;
    }

    // Estimate days of stock remaining
    const daysLeft = demand === 0
        ? Infinity
        : stock / demand;

    // Determine stock risk
    let status = "Healthy";

    if (daysLeft <= 1) {
        status = "Critical";
    } else if (daysLeft <= 3) {
        status = "Warning";
    }

    // Calculate recommended reorder quantity
    const reorder = Math.max(
        0,
        Math.ceil(
            demand * (LEAD_TIME + SAFETY_DAYS) - stock
        )
    );

    return {
        stock,
        demand,
        daysLeft,
        status,
        reorder
    };
}

// ------------------------------------------
// RENDER INVENTORY DASHBOARD
// ------------------------------------------

async function renderDashboard() {
    const products = await loadInventory();

    const tbody = el("stockTable");
    tbody.replaceChildren();

    let critical = 0;
    let warning = 0;
    let healthy = 0;

    for (const product of products) {
        const result = analyzeProduct(product);

        const row = document.createElement("tr");

        // Product name
        cell(row, product.name);

        // Current stock from SQLite
        cell(row, product.stock);

        if (result === null) {
            // Product has no valid ML forecast
            cell(row, "N/A");
            cell(row, "N/A");

            const statusCell = cell(row, "");

            const badge = document.createElement("span");
            badge.className = "badge unavailable";
            badge.textContent = "Forecast Unavailable";

            statusCell.appendChild(badge);

            cell(row, "N/A");

        } else {
            // Predicted daily demand
            cell(row, result.demand);

            // Estimated stock coverage
            cell(
                row,
                Number.isFinite(result.daysLeft)
                    ? result.daysLeft.toFixed(2)
                    : "Unlimited*"
            );

            // Risk status
            const statusCell = cell(row, "");

            const badge = document.createElement("span");
            badge.className =
                "badge " + result.status.toLowerCase();
            badge.textContent = result.status;

            statusCell.appendChild(badge);

            // Recommended reorder quantity
            cell(row, result.reorder);

            // Summary counters
            if (result.status === "Critical") {
                critical++;
            } else if (result.status === "Warning") {
                warning++;
            } else if (result.status === "Healthy") {
                healthy++;
            }
        }

        tbody.appendChild(row);
    }

    // Update summary cards
    el("total").textContent = products.length;
    el("critical").textContent = critical;
    el("warning").textContent = warning;
    el("healthy").textContent = healthy;

    // Apply selected sorting and filters
    sortProducts();
    applyFilters();
}

// ------------------------------------------
// INITIALIZE DASHBOARD
// ------------------------------------------

async function initialize() {
    try {
        el("message").textContent = "";

        const forecastResponse = await fetch(
            FORECAST_URL,
            { cache: "no-store" }
        );

        if (!forecastResponse.ok) {
            throw new Error(
                "Could not load ML forecasts."
            );
        }

        forecasts = await forecastResponse.json();

        if (!Array.isArray(forecasts)) {
            throw new Error(
                "Invalid ML forecast file."
            );
        }

        // Display forecast dates
        const dates = [
            ...new Set(
                forecasts.map(
                    (f) => f.prediction_date
                )
            )
        ];

        el("forecastDate").textContent =
            "Forecast date: " +
            dates.join(", ") +
            " (historical demonstration)";

        // Correct asynchronous function call
        await renderDashboard();

    } catch (error) {
        console.error(
            "Stock Intelligence error:",
            error
        );

        el("message").textContent = error.message;
    }
}

// ------------------------------------------
// FILTER INVENTORY TABLE
// ------------------------------------------

function applyFilters() {
    const search = el("productSearch")
        .value.trim().toLowerCase();

    const selectedRisk = el("riskFilter").value;

    const rows = document.querySelectorAll(
        "#stockTable tr"
    );

    let visibleCount = 0;

    rows.forEach((row) => {
        const productName = row.cells[0]
            .textContent.toLowerCase();

        const risk = row.cells[4]
            .textContent.trim();

        const matchesSearch =
            productName.includes(search);

        const matchesRisk =
            selectedRisk === "all" ||
            risk === selectedRisk;

        const visible =
            matchesSearch && matchesRisk;

        row.hidden = !visible;

        if (visible) {
            visibleCount++;
        }
    });

    // Show empty message only when no rows match
    el("emptyFilterMessage").hidden =
        visibleCount !== 0;

    // Update visible product count
    el("filterCount").textContent =
        `Showing ${visibleCount} of ${rows.length} products`;
}

// ------------------------------------------
// CLEAR SEARCH AND RISK FILTERS
// ------------------------------------------

function clearFilters() {
    el("productSearch").value = "";
    el("riskFilter").value = "all";

    applyFilters();
}

// ------------------------------------------
// SORT INVENTORY TABLE
// ------------------------------------------

function sortProducts() {
    const sortBy = el("sortFilter").value;

    const tbody = el("stockTable");

    const rows = Array.from(
        tbody.querySelectorAll("tr")
    );

    const riskPriority = {
        "Critical": 0,
        "Warning": 1,
        "Healthy": 2,
        "Forecast Unavailable": 3
    };

    function numberAt(row, index) {
        const value = row.cells[index]
            .textContent.trim();

        if (
            value === "N/A" ||
            value === "Unlimited*"
        ) {
            return Infinity;
        }

        return Number(value);
    }

    rows.sort((a, b) => {
        const nameA = a.cells[0]
            .textContent.trim();

        const nameB = b.cells[0]
            .textContent.trim();

        const riskA = a.cells[4]
            .textContent.trim();

        const riskB = b.cells[4]
            .textContent.trim();

        // Sort alphabetically
        if (sortBy === "name") {
            return nameA.localeCompare(nameB);
        }

        // Sort by fewest days remaining
        if (sortBy === "days") {
            return numberAt(a, 3) -
                   numberAt(b, 3);
        }

        // Sort by highest predicted demand
        if (sortBy === "demand") {
            const demandA = numberAt(a, 2);
            const demandB = numberAt(b, 2);

            if (
                demandA === Infinity &&
                demandB === Infinity
            ) {
                return 0;
            }

            if (demandA === Infinity) {
                return 1;
            }

            if (demandB === Infinity) {
                return -1;
            }

            return demandB - demandA;
        }

        // Default: highest risk first
        return (
            riskPriority[riskA] -
            riskPriority[riskB]
        );
    });

    // Reinsert rows in sorted order
    rows.forEach(
        (row) => tbody.appendChild(row)
    );
}

// ------------------------------------------
// EVENT LISTENERS
// ------------------------------------------

// Refresh inventory and forecasts
el("refreshBtn").addEventListener(
    "click",
    initialize
);

// Search products
el("productSearch").addEventListener(
    "input",
    applyFilters
);

// Filter products by risk
el("riskFilter").addEventListener(
    "change",
    applyFilters
);

// Sort products
el("sortFilter").addEventListener(
    "change",
    () => {
        sortProducts();
        applyFilters();
    }
);

// Clear filters
el("clearFiltersBtn").addEventListener(
    "click",
    clearFilters
);

// ------------------------------------------
// START DASHBOARD
// ------------------------------------------

initialize();
