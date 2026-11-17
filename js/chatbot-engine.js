
/*
 * SmartMart Data Engine
 * Read-only inventory, orders, sales and historical forecasts.
 */

window.SmartMartEngine = (() => {
    "use strict";

    let lastProduct = null;
    let lastTopic = "stock";
    let lastOrderId = null;

    const money = n => new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR"
    }).format(Number(n) || 0);

    const norm = s => String(s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");

    const nowDate = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    function getStock() {
        const data = typeof getProducts === "function"
            ? getProducts()
            : JSON.parse(localStorage.getItem("smartmart_products") || "[]");

        if (!Array.isArray(data)) throw Error("Invalid products");
        return data;
    }

    function getSalesOrders() {
        const data = typeof getOrders === "function"
            ? getOrders()
            : JSON.parse(localStorage.getItem("smartmart_orders") || "[]");

        if (!Array.isArray(data)) throw Error("Invalid orders");
        return data;
    }

    function limit() {
        const raw = localStorage.getItem("smartmart_low_stock_threshold");
        const n = Number(raw);
        return raw !== null && Number.isInteger(n) && n >= 1 && n <= 1000
            ? n : 10;
    }

    function productNamed(question, products) {
        const q = ` ${norm(question)} `;
        return [...products]
            .sort((a, b) => String(b.name).length - String(a.name).length)
            .find(p => q.includes(` ${norm(p.name)} `));
    }

    function categoryNamed(question, products) {
        const q = ` ${norm(question)} `;
        return [...new Set(products.map(p => p.category).filter(Boolean))]
            .find(c => q.includes(` ${norm(c)} `));
    }

    const delivered = orders =>
        orders.filter(o => o.status === "Delivered");

    const completedRevenue = orders =>
        delivered(orders).reduce(
            (total, o) => total + (Number(o.total) || 0), 0
        );

    function ranking(orders, products) {
        const counts = new Map();

        for (const order of delivered(orders)) {
            for (const item of Array.isArray(order.items) ? order.items : []) {
                const id = String(item.productId);
                counts.set(id, (counts.get(id) || 0) + (Number(item.quantity) || 0));
            }
        }

        return [...counts].map(([id, qty]) => ({
            id, qty,
            name: products.find(p => String(p.id) === id)?.name || `Product #${id}`
        })).sort((a, b) => b.qty - a.qty);
    }

    const orderLine = o =>
        `#${o.id} · ${o.customerName || "Customer"}\n` +
        `${o.orderDate || "Date unavailable"} · ${o.status} · ${money(o.total)}`;

    function answer(question) {
        const q = norm(question);
        const products = getStock();
        const orders = getSalesOrders();
        const product = productNamed(question, products);
        const category = categoryNamed(question, products);
        const has = regex => regex.test(q);

        if (product) lastProduct = String(product.id);

        const remembered = products.find(p => String(p.id) === lastProduct);

        if (/^(hi|hello|hey|good morning|good evening|good afternoon)$/.test(q)) {
            return "Hello! I can help with inventory, orders, sales and historical stock intelligence. What's on your mind?";
        }

        if (has(/\b(help|what can you do|your features)\b/)) {
            return "I can check stock, prices, orders, sales and historical forecasts. Use Main Menu to explore.";
        }

        if (has(/\b(expiry|expired|expiring|discount|promotion)\b/)) {
            return "Expiry dates, discounts and promotions aren't included in the current SmartMart data.";
        }

        // Highest / lowest comparisons, including "and the lowest?"
        const extreme = q.match(
            /\b(highest|maximum|most|greatest|largest|lowest|minimum|least|fewest|smallest)\b/
        );

        if (extreme && !has(/\b(selling|sold|sales|order|risk|demand)\b/)) {
            const higher = /highest|maximum|most|greatest|largest/.test(extreme[1]);

            const field = has(/\b(price|priced|cost|expensive|cheap)\b/)
                ? "price"
                : has(/\b(stock|inventory|quantity|units|stocked)\b/)
                    ? "stock"
                    : lastTopic;

            if (
                has(/\b(stock|inventory|quantity|units|stocked|price|priced|cost|product|item|one|and|what|which|the)\b/) ||
                q === extreme[1]
            ) {
                const sorted = products
                    .filter(p => Number.isFinite(Number(p[field])))
                    .sort((a, b) => higher
                        ? Number(b[field]) - Number(a[field])
                        : Number(a[field]) - Number(b[field]));

                if (!sorted.length) return "No products available.";

                const chosen = sorted[0];
                lastTopic = field;
                lastProduct = String(chosen.id);

                return `${chosen.name} has the ${higher ? "highest" : "lowest"} ${field}: ${
                    field === "price" ? money(chosen.price) : `${chosen.stock} units`
                }.`;
            }
        }

        // Product follow-ups
        if (!product && remembered && has(/\b(it|its|that|this|same product)\b/)) {
            if (has(/\b(price|cost|rate|how much)\b/)) {
                lastTopic = "price";
                return `${remembered.name} costs ${money(remembered.price)} per unit.`;
            }

            if (has(/\b(stock|available|remaining|left|quantity|units)\b/)) {
                lastTopic = "stock";
                return `${remembered.name} has ${remembered.stock} units in stock.`;
            }
        }

        // Business summary
        if (has(/\b(business summary|store summary|store overview|business report|what needs my attention|major issues)\b/)) {
            const low = products.filter(p => Number(p.stock) <= limit());

            return (
                `SMARTMART SUMMARY (${nowDate()})\n` +
                `Products: ${products.length}\n` +
                `Low stock (≤${limit()}): ${low.length}\n` +
                `Orders: ${orders.length}\n` +
                `Pending: ${orders.filter(o => o.status === "Pending").length}\n` +
                `Processing: ${orders.filter(o => o.status === "Processing").length}\n` +
                `Dispatched: ${orders.filter(o => o.status === "Dispatched").length}\n` +
                `Completed revenue: ${money(completedRevenue(orders))}\n` +
                "Revenue includes Delivered orders only."
            );
        }

        // Order lookup
        const orderMatch =
            q.match(/\b(?:order|delivery)\s*(?:id|number|no)?\s*(\d+)\b/) ||
            q.match(/\b(?:track|status of)\s*(?:order\s*)?(\d+)\b/);

        if (orderMatch) {
            lastOrderId = orderMatch[1];

            const order = orders.find(o => String(o.id) === lastOrderId);
            if (!order) return `Order #${lastOrderId} not found.`;

            const items = (order.items || []).map(item => {
                const name = products.find(
                    p => String(p.id) === String(item.productId)
                )?.name || `Product #${item.productId}`;

                return `${name}: ${item.quantity} units`;
            }).join("\n");

            return orderLine(order) + (items ? "\n" + items : "");
        }

        if (lastOrderId && has(/\b(its status|that order|what about that order)\b/)) {
            const order = orders.find(o => String(o.id) === lastOrderId);
            return order ? `Order #${order.id} is ${order.status}.`
                : "That order is no longer available.";
        }

        // Orders by status
        const status = q.match(
            /\b(pending|processing|dispatched|delivered|cancelled|canceled)\b/
        );

        if (status && has(/\b(order|orders|delivery|deliveries|show|list|how many)\b/)) {
            const name = status[1] === "canceled"
                ? "Cancelled"
                : status[1][0].toUpperCase() + status[1].slice(1);

            const matches = orders.filter(o => o.status === name);

            if (has(/\b(how many|count|number)\b/)) {
                return `${matches.length} ${name.toLowerCase()} orders.`;
            }

            return matches.length
                ? `${name} orders (${matches.length}):\n\n` +
                  matches.slice(0, 10).map(orderLine).join("\n\n")
                : `No ${name.toLowerCase()} orders.`;
        }

        if (has(/\b(recent orders|latest orders)\b/)) {
            return [...orders]
                .sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)))
                .slice(0, 5)
                .map(orderLine).join("\n\n") || "No orders recorded.";
        }

        if (has(/\b(orders today|today s orders|todays orders)\b/)) {
            return `${orders.filter(o => o.orderDate === nowDate()).length} orders dated ${nowDate()}.`;
        }

        if (has(/\b(order overview|order summary|orders|deliveries)\b/)) {
            return `Total orders: ${orders.length}\n` +
                ["Pending", "Processing", "Dispatched", "Delivered", "Cancelled"]
                    .map(s => `${s}: ${orders.filter(o => o.status === s).length}`)
                    .join("\n");
        }

        // Sales
        if (has(/\b(sales|sold|selling|sells|revenue|best seller|best selling|top selling|order value)\b/)) {
            const subset = has(/\b(today|todays)\b/)
                ? orders.filter(o => o.orderDate === nowDate())
                : orders;

            if (has(/\border value\b/)) {
                const total = subset
                    .filter(o => o.status !== "Cancelled")
                    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

                return `Non-cancelled order value: ${money(total)}. Includes orders not yet completed.`;
            }

            const ranks = ranking(subset, products);

            if (product && has(/\b(sold|selling|sells|units)\b/)) {
                const qty = ranks.find(r => r.id === String(product.id))?.qty || 0;
                return `${product.name}: ${qty} units sold in Delivered orders.`;
            }

            if (has(/\b(best|top|most|by product|product wise)\b/)) {
                return ranks.length
                    ? "Completed units sold by product:\n" +
                      ranks.slice(0, 10).map((r, i) => `${i + 1}. ${r.name}: ${r.qty}`).join("\n")
                    : "No Delivered order items recorded.";
            }

            return (
                `Completed sales: ${money(completedRevenue(subset))}\n` +
                `Delivered orders: ${delivered(subset).length}\n` +
                "Other order statuses are excluded."
            );
        }

        // Low-stock alerts
        if (has(/\b(low stock|low in stock|stock alerts|stock alert|running out|run out|restock|restocking)\b/)) {
            const low = products.filter(p => Number(p.stock) <= limit());

            return low.length
                ? `Low-stock products (≤${limit()} units):\n` +
                  low.slice(0, 20).map(p => `${p.name}: ${p.stock} units`).join("\n")
                : `No products at or below ${limit()} units.`;
        }

        // Numerical filters
        const comparison = q.match(
            /\b(below|under|less than|above|over|more than|at least|at most)\s*(?:rs|inr)?\s*(\d+(?:\.\d+)?)\s*(?:rupees|units)?\b/
        );

        if (comparison && has(/\b(product|products|item|items|stock|units|price|cost|inventory|rupees|rs|inr)\b/)) {
            const op = comparison[1];
            const amount = Number(comparison[2]);
            const field = has(/\b(price|cost|rupees|rs|inr)\b/) ? "price" : "stock";

            const matches = value => {
                if (op === "at least") return value >= amount;
                if (op === "at most") return value <= amount;
                if (["below", "under", "less than"].includes(op)) return value < amount;
                return value > amount;
            };

            const hits = products.filter(p =>
                (!category || p.category === category) &&
                matches(Number(p[field]))
            );

            return hits.length
                ? `${hits.length} matching products:\n` +
                  hits.slice(0, 20).map(p =>
                      `${p.name}: ${field === "price" ? money(p.price) : `${p.stock} units`}`
                  ).join("\n")
                : "No products match those conditions.";
        }

        if (category && has(/\b(how many|count|number)\b/)) {
            return `${products.filter(p => p.category === category).length} products in ${category}.`;
        }

        if (product) {
            if (has(/\b(price|cost|how much|rate)\b/)) {
                lastTopic = "price";
                return `${product.name} costs ${money(product.price)} per unit.`;
            }

            if (has(/\b(stock|available|left|quantity|units|how many)\b/)) {
                lastTopic = "stock";
                return `${product.name} has ${product.stock} units in stock.`;
            }

            return `${product.name}\nCategory: ${product.category}\nPrice: ${money(product.price)}\nStock: ${product.stock} units.`;
        }

        if (has(/\b(how many products|total products|product count|number of products)\b/)) {
            return `Your inventory contains ${products.length} products.`;
        }

        if (has(/\b(categories|category)\b/)) {
            return `Categories: ${[...new Set(products.map(p => p.category).filter(Boolean))].join(", ") || "none"}.`;
        }

        return null;
    }

    // =========================================
    // HISTORICAL ML FORECASTS
    // =========================================

    async function forecasts(question) {
        const [fr, mr] = await Promise.all([
            fetch("ml/data/forecasts.json", { cache: "no-store" }),
            fetch("ml/product_mapping.json", { cache: "no-store" })
        ]);

        if (!fr.ok || !mr.ok) {
            throw Error("Forecast files could not be loaded");
        }

        const [data, mapping] = await Promise.all([
            fr.json(),
            mr.json()
        ]);

        if (
            !Array.isArray(data) ||
            !mapping ||
            typeof mapping !== "object" ||
            Array.isArray(mapping)
        ) {
            throw Error("Unexpected forecast data format");
        }

        const products = getStock();
        const requested = productNamed(question, products);
        const q = norm(question);
        const matches = [];

        for (const product of products) {
            if (
                requested &&
                String(requested.id) !== String(product.id)
            ) {
                continue;
            }

            // Match by product name first.
            // Avoid pairing products with unrelated forecast IDs.
            let forecast = data.find(
                f => norm(f.product_name) === norm(product.name)
            );

            // Only use an ID mapping when the names also agree.
            if (!forecast) {
                const mappedId = mapping[String(product.id)];

                const candidate = data.find(
                    f => String(f.product_id) === String(mappedId)
                );

                if (
                    candidate &&
                    norm(candidate.product_name) === norm(product.name)
                ) {
                    forecast = candidate;
                }
            }

            if (!forecast) continue;

            const demand = Number(forecast.predicted_demand);
            const stock = Number(product.stock);

            if (
                !Number.isFinite(demand) ||
                demand < 0 ||
                !Number.isFinite(stock) ||
                stock < 0
            ) {
                continue;
            }

            const days = demand === 0
                ? Infinity
                : stock / demand;

            matches.push({
                name: product.name,
                stock,
                demand,
                days,
                risk: days <= 1
                    ? "Critical"
                    : days <= 3
                        ? "Warning"
                        : "Healthy",
                reorder: Math.max(
                    0,
                    Math.ceil(demand * 4 - stock)
                )
            });
        }

        const wantsReorder =
            /\b(reorder|purchase recommendation|buy for stock|supplier)\b/.test(q);

        const wantsRisk =
            /\b(risk|at risk|stockout|critical|warning)\b/.test(q);

        const shown = matches.filter(
            p =>
                (!wantsReorder || p.reorder > 0) &&
                (!wantsRisk || p.risk !== "Healthy")
        );

        const date = [...new Set(
            data.map(f => f.prediction_date).filter(Boolean)
        )].join(", ") || "unknown";

        const label =
            `Historical synthetic forecast (${date}); not a live prediction.`;

        if (!matches.length) {
            return (
                "No forecast products could be matched to current inventory. " +
                label +
                " Check product names and the forecast mapping."
            );
        }

        if (!shown.length) {
            return `Matched ${matches.length} products, but none meet that filter. ${label}`;
        }

        const lines = shown.slice(0, 10).map(p =>
            `${p.name}\n` +
            `Stock: ${p.stock} · Forecast demand: ${p.demand}\n` +
            `Estimated days left: ${Number.isFinite(p.days) ? p.days.toFixed(2) : "Unlimited"} · ${p.risk}\n` +
            `Suggested reorder: ${p.reorder} units`
        );

        return (
            `STOCK INTELLIGENCE — ${date}\n\n` +
            lines.join("\n\n") +
            (shown.length > 10 ? "\n\nShowing first 10." : "") +
            `\n\n${label} Matched ${matches.length} of ${products.length} inventory products. ` +
            "Reorder assumes four days of demand."
        );
    }

    function reset() {
        lastProduct = null;
        lastTopic = "stock";
        lastOrderId = null;
    }

    function snapshot() {
        const products = getStock();
        const orders = getSalesOrders();

        return {
            date: nowDate(),
            lowStockThreshold: limit(),
            totalProducts: products.length,

            products: products.slice(0, 100).map(p => ({
                id: p.id,
                name: p.name,
                category: p.category,
                stock: p.stock,
                price: p.price
            })),

            productsTruncated: products.length > 100,
            totalOrders: orders.length,

            orderStatusCounts: Object.fromEntries(
                ["Pending", "Processing", "Dispatched", "Delivered", "Cancelled"]
                    .map(status => [
                        status,
                        orders.filter(o => o.status === status).length
                    ])
            ),

            completedRevenue: completedRevenue(orders),
            bestSellers: ranking(orders, products).slice(0, 10),

            notes: [
                "Revenue counts Delivered orders only.",
                "Customer names and individual order details are excluded.",
                "Forecasts are historical demonstrations and not included in this snapshot."
            ]
        };
    }

    return {
        answer,
        forecasts,
        snapshot,
        reset,
        getStock,
        categoryNamed,
        norm
    };
})();
