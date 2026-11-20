
/*
 * SmartMart Conversation Manager
 * One decision per message
 */

window.SmartMartConversation = (() => {
    "use strict";

    const Engine = window.SmartMartEngine;
    const AI = window.SmartMartOllama;

    const norm = Engine.norm;

    const money = n =>
        new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR"
        }).format(Number(n) || 0);

    let pending = null;
    let lastProduct = "";
    let lastTopic = "stock";
    let lastAnswer = "";
    let lastQuestion = "";
    let lastOffer = "";

    function reset() {
        pending = null;
        lastProduct = "";
        lastTopic = "stock";
        lastAnswer = "";
        lastQuestion = "";
        lastOffer = "";

        Engine.reset();
        AI.reset();
    }

    function remember(question, reply) {
        lastQuestion = question;

        if (reply.type === "text") {
            lastAnswer = reply.text.slice(0, 500);
        }
    }

    const text = value => ({
        type: "text",
        text: value
    });

    const browse = category => ({
        type: "browse",
        category: category || ""
    });

    function ask(type, message) {
        pending = { type };
        return text(message);
    }

    // =========================================
    // MANAGEMENT ADVICE
    // =========================================

    function advice(topic) {
        const snapshot = Engine.snapshot();
        const counts = snapshot.orderStatusCounts;
        const topicName = norm(topic);

        if (/sales|revenue|selling/.test(topicName)) {
            lastOffer = "best_sellers";

            return text(
                "Improve sales by keeping best-sellers available, " +
                "reviewing Delivered-order trends and testing " +
                "promotions only when you can measure their impact. " +
                `Recorded completed revenue is ${money(snapshot.completedRevenue)}. ` +
                "Show your best-selling products?"
            );
        }

        if (/stock|inventory/.test(topicName)) {
            lastOffer = "low_stock";

            return text(
                "Improve inventory by checking items at or below " +
                `${snapshot.lowStockThreshold} units and reviewing ` +
                "demand before placing purchase orders. " +
                "Show low-stock products?"
            );
        }

        if (/order|delivery|dispatch/.test(topicName)) {
            lastOffer = "order_status";

            return text(
                "Improve deliveries by tracking Pending " +
                `(${counts.Pending}) and Processing ` +
                `(${counts.Processing}) orders, reviewing delays ` +
                "and keeping statuses current. Show pending orders?"
            );
        }

        lastOffer = "";

        return ask(
            "advice_area",
            "Start with stock availability, completed sales " +
            "and pending orders. Which area would you like " +
            "to improve: sales, inventory or delivery?"
        );
    }

    // =========================================
    // PRODUCT RESOLUTION
    // =========================================

    function resolveProduct(value) {
        const name = norm(value);

        return Engine.getStock().find(
            product => norm(product.name) === name
        ) || null;
    }

    function requireProduct(value, intent) {
        const selected = resolveProduct(
            value || lastProduct
        );

        if (!selected) {
            return ask(
                intent,
                "Which product? Enter an inventory product " +
                "name, or type cancel."
            );
        }

        lastProduct = selected.name;
        return selected;
    }

    // =========================================
    // FORECAST COMMANDS
    // =========================================

    function forecast(intent, product = "") {
        const prefix =
            intent === "forecast_reorder"
                ? "Show reorder recommendations"
                : intent === "forecast_risk"
                    ? "Which products are at risk of stockout?"
                    : "Show stock intelligence";

        return {
            type: "forecast",

            query: product
                ? `${prefix} for ${product}`
                : prefix
        };
    }

    // =========================================
    // EXECUTE RECOGNIZED INTENTS
    // =========================================

    function dispatch(plan) {
        const intent = plan.intent;

        let product;
        let question;

        switch (intent) {
            case "advice":
                return advice(plan.topic);

            case "inventory_count":
                return text(
                    Engine.answer(
                        "How many products do we have?"
                    )
                );

            case "stock_extreme": {
                const direction =
                    plan.direction === "lowest"
                        ? "lowest"
                        : plan.direction === "highest"
                            ? "highest"
                            : "";

                if (!direction) {
                    return text(
                        "Would you like the highest " +
                        "or lowest value?"
                    );
                }

                const field =
                    plan.field === "price"
                        ? "price"
                        : "stock";

                lastTopic = field;

                const products = Engine.getStock().filter(
                    p => Number.isFinite(
                        Number(p[field])
                    )
                );

                if (!products.length) {
                    return text("No products available.");
                }

                products.sort((a, b) =>
                    direction === "highest"
                        ? Number(b[field]) - Number(a[field])
                        : Number(a[field]) - Number(b[field])
                );

                const chosen = products[0];

                lastProduct = chosen.name;

                const value = field === "price"
                    ? money(chosen.price)
                    : `${chosen.stock} units`;

                return text(
                    `${chosen.name} has the ${direction} ` +
                    `${field}: ${value}.`
                );
            }

            case "product_detail":
            case "product_stock":
            case "product_price": {
                product = requireProduct(
                    plan.product,
                    intent
                );

                if (product.type === "text") {
                    return product;
                }

                question =
                    intent === "product_price"
                        ? `Price of ${product.name}`
                        : intent === "product_stock"
                            ? `Stock of ${product.name}`
                            : `Details of ${product.name}`;

                lastTopic =
                    intent === "product_price"
                        ? "price"
                        : "stock";

                return text(Engine.answer(question));
            }

            case "low_stock":
                return text(
                    Engine.answer(
                        "Show low stock products"
                    )
                );

            case "inventory_filter": {
                const operators = {
                    below: value => value < plan.amount,
                    above: value => value > plan.amount,
                    at_least: value => value >= plan.amount,
                    at_most: value => value <= plan.amount
                };

                const compare = operators[plan.operator];

                if (!compare || plan.amount < 0) {
                    return text(
                        "Please specify a valid stock " +
                        "or price filter."
                    );
                }

                const field =
                    plan.field === "price"
                        ? "price"
                        : "stock";

                const products = Engine.getStock().filter(p =>
                    (
                        !plan.category ||
                        norm(p.category) === norm(plan.category)
                    ) &&
                    Number.isFinite(Number(p[field])) &&
                    compare(Number(p[field]))
                );

                if (!products.length) {
                    return text(
                        "No products match those conditions."
                    );
                }

                const lines = products.slice(0, 20).map(p =>
                    `${p.name}: ${
                        field === "price"
                            ? money(p.price)
                            : `${p.stock} units`
                    }`
                );

                return text(
                    `${products.length} matching products:\n` +
                    lines.join("\n")
                );
            }

            case "categories":
                return text(
                    Engine.answer("Show categories")
                );

            case "browse":
                return browse(plan.category);

            case "order_overview":
                return text(
                    Engine.answer("Show order overview")
                );

            case "store_summary":
                return text(
                    Engine.answer(
                        "Give me a business summary"
                    )
                );

            case "order_status": {
                const status = norm(plan.topic);

                if (
                    !/^(pending|processing|dispatched|delivered|cancelled|canceled)$/
                        .test(status)
                ) {
                    return text(
                        "Which order status do you want to see?"
                    );
                }

                return text(
                    Engine.answer(`Show ${status} orders`)
                );
            }

            case "order_lookup": {
                const id = String(plan.order_id || "");

                if (!/^\d+$/.test(id)) {
                    return ask(
                        "order_lookup",
                        "Enter the numeric order ID, or cancel."
                    );
                }

                return text(
                    Engine.answer(`Status of order ${id}`)
                );
            }

            case "recent_orders":
                return text(
                    Engine.answer("Show recent orders")
                );

            case "sales_summary":
                return text(
                    Engine.answer(
                        plan.topic === "today"
                            ? "What are today's sales?"
                            : "Show total completed sales"
                    )
                );

            case "best_sellers":
                return text(
                    Engine.answer(
                        "Which products are best selling?"
                    )
                );

            case "product_sales": {
                product = requireProduct(
                    plan.product,
                    "product_sales"
                );

                if (product.type === "text") {
                    return product;
                }

                return text(
                    Engine.answer(
                        `How many units of ${product.name} were sold?`
                    )
                );
            }

            case "forecast_overview":
                return forecast(
                    intent,
                    plan.product
                );

            case "forecast_reorder":
            case "forecast_risk": {
                if (
                    !plan.product &&
                    plan.topic !== "all"
                ) {
                    return ask(
                        intent,
                        "Which product? Enter a product name " +
                        "or 'all' for all mapped products, " +
                        "or cancel."
                    );
                }

                if (
                    plan.product &&
                    !resolveProduct(plan.product)
                ) {
                    return ask(
                        intent,
                        "I couldn't match that product. " +
                        "Enter an exact inventory product name " +
                        "or 'all'."
                    );
                }

                return forecast(
                    intent,
                    plan.product
                );
            }

            case "clarify":
                return text(
                    plan.clarification ||
                    "Could you clarify what you'd like to do?"
                );

            default:
                return {
                    type: "general"
                };
        }
    }

    // =========================================
    // HANDLE USER MESSAGES
    // =========================================

    async function run(message, { signal } = {}) {
        const q = norm(message);

        // Pending actions always take priority.

        if (
            pending &&
            /^(cancel|nevermind|never mind|stop)$/.test(q)
        ) {
            pending = null;

            return text(
                "Cancelled. Choose a menu or ask another question."
            );
        }

        if (pending) {
            const action = pending;
            pending = null;

            if (action.type === "advice_area") {
                if (/\b(sales|revenue)\b/.test(q)) {
                    return advice("sales");
                }

                if (/\b(inventory|stock)\b/.test(q)) {
                    return advice("inventory");
                }

                if (/\b(delivery|deliveries|orders)\b/.test(q)) {
                    return advice("delivery");
                }

                pending = action;

                return text(
                    "Choose sales, inventory or delivery " +
                    "(or type cancel)."
                );
            }

            if (action.type === "order_lookup") {
                return dispatch({
                    intent: "order_lookup",
                    order_id: q
                });
            }

            if ([
                "product_detail",
                "product_price",
                "product_stock",
                "product_sales"
            ].includes(action.type)) {
                return dispatch({
                    intent: action.type,
                    product: message
                });
            }

            if (action.type.startsWith("forecast_")) {
                if (
                    /^(all|all products|everything)$/.test(q)
                ) {
                    return forecast(action.type);
                }

                const product = resolveProduct(message);

                if (product) {
                    return forecast(
                        action.type,
                        product.name
                    );
                }

                pending = action;

                return text(
                    "I couldn't match that product. " +
                    "Enter an inventory product name, " +
                    "'all', or cancel."
                );
            }
        }

        // Handle affirmative replies to offers.

        if (
            /^(yes|yep|sure|okay|ok)$/.test(q) &&
            lastOffer
        ) {
            const offer = lastOffer;
            lastOffer = "";

            return dispatch({
                intent: offer,

                topic:
                    offer === "order_status"
                        ? "pending"
                        : "",

                product: ""
            });
        }

        lastOffer = "";

        // Typed questions are interpreted by Ollama.

        const context = {
            last_question: lastQuestion,
            last_answer: lastAnswer,
            last_product: lastProduct,
            last_topic: lastTopic,

            product_names: Engine.getStock().map(
                p => p.name
            ),

            pending_action: null
        };

        const plan = await AI.interpret(
            message,
            context,
            { signal }
        );

        const result = dispatch(plan);

        if (result.type === "general") {
            return text(
                await AI.converse(
                    message,
                    Engine.snapshot(),
                    { signal }
                )
            );
        }

        remember(message, result);

        return result;
    }

    // =========================================
    // DIRECT MENU ACTIONS
    // =========================================

    function menuAction(action) {
        // Menu selections bypass Ollama completely.

        pending = null;
        lastOffer = "";

        if (action === "browse") {
            return browse("");
        }

        if (action.startsWith("forecast:")) {
            const type =
                "forecast_" + action.slice(9);

            if (type === "forecast_overview") {
                return forecast(type);
            }

            return ask(
                type,
                "Which product? Enter an inventory " +
                "product name, 'all', or cancel."
            );
        }

        if (action.startsWith("prompt:")) {
            const type = action.slice(7);

            if (type === "order") {
                return ask(
                    "order_lookup",
                    "Enter the numeric order ID, or cancel."
                );
            }

            if (type === "sales-product") {
                return ask(
                    "product_sales",
                    "Enter an inventory product name, or cancel."
                );
            }

            return ask(
                "product_detail",
                "Enter an inventory product name, or cancel."
            );
        }

        if (action === "advice:general") {
            return advice("general");
        }

        const map = {
            total_products: {
                intent: "inventory_count"
            },

            low_stock: {
                intent: "low_stock"
            },

            highest_stock: {
                intent: "stock_extreme",
                direction: "highest",
                field: "stock"
            },

            lowest_stock: {
                intent: "stock_extreme",
                direction: "lowest",
                field: "stock"
            },

            categories: {
                intent: "categories"
            },

            order_overview: {
                intent: "order_overview"
            },

            pending_orders: {
                intent: "order_status",
                topic: "pending"
            },

            processing_orders: {
                intent: "order_status",
                topic: "processing"
            },

            dispatched_orders: {
                intent: "order_status",
                topic: "dispatched"
            },

            delivered_orders: {
                intent: "order_status",
                topic: "delivered"
            },

            cancelled_orders: {
                intent: "order_status",
                topic: "cancelled"
            },

            recent_orders: {
                intent: "recent_orders"
            },

            today_sales: {
                intent: "sales_summary",
                topic: "today"
            },

            completed_sales: {
                intent: "sales_summary"
            },

            best_sellers: {
                intent: "best_sellers"
            },

            store_summary: {
                intent: "store_summary"
            }
        };

        return dispatch(
            map[action] || {
                intent: "clarify",
                clarification:
                    "This menu action is not configured yet."
            }
        );
    }

    function navigate() {
        pending = null;
        lastOffer = "";
    }

    return {
        run,
        menuAction,
        reset,
        navigate
    };
})();
