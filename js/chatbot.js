
/*
 * SmartMart Assistant UI
 * Menus, chat, product browser and window controls
 */

(() => {
    "use strict";

    if (document.getElementById("chatbotPanel")) {
        return;
    }

    const PAGE_SIZE = 5;

    const Engine = window.SmartMartEngine;
    const AI = window.SmartMartOllama;
    const Chat = window.SmartMartConversation;

    if (!Engine || !AI || !Chat) {
        console.error(
            "Load chatbot-engine.js, ollama.js and " +
            "conversation-manager.js before chatbot.js"
        );
        return;
    }

    const norm = Engine.norm;
    const getStock = Engine.getStock;

    const money = n =>
        new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR"
        }).format(Number(n) || 0);

    const limit = () => {
        const raw = localStorage.getItem(
            "smartmart_low_stock_threshold"
        );

        const n = Number(raw);

        return raw !== null &&
            Number.isInteger(n) &&
            n >= 1 &&
            n <= 1000 ? n : 10;
    };

    // =========================================
    // BUILD CHATBOT INTERFACE
    // =========================================

    const root = document.createElement("div");
    root.className = "chatbot-widget";

    root.innerHTML = `
        <section class="chatbot-panel"
                 id="chatbotPanel"
                 aria-label="SmartMart Assistant"
                 hidden>

            <header class="chatbot-header">

                <div class="chatbot-avatar"
                     aria-hidden="true">✦</div>

                <div class="chatbot-header-info">
                    <h2>SmartMart Assistant</h2>

                    <div class="chatbot-status">
                        <span class="chatbot-status-dot"></span>
                        Local AI + SmartMart Data
                    </div>
                </div>

                <div class="chatbot-header-actions">

                    <button id="chatbotMinimize"
                            type="button"
                            aria-label="Minimize"
                            title="Minimize">−</button>

                    <button id="chatbotMaximize"
                            type="button"
                            aria-label="Maximize"
                            title="Maximize">⛶</button>

                    <button id="chatbotClose"
                            type="button"
                            aria-label="Close and reset"
                            title="Close and reset">×</button>

                </div>
            </header>

            <div class="chatbot-workspace">

                <nav class="chatbot-side-menu"
                     aria-label="Quick navigation"
                     hidden></nav>

                <div class="chatbot-chat-column">

                    <div class="chatbot-messages"
                         id="chatbotMessages"
                         role="log"
                         aria-live="polite"></div>

                    <div class="chatbot-menu-tools">
                        <button id="chatbotBack"
                                type="button">← Back</button>

                        <button id="chatbotHome"
                                type="button">⌂ Main Menu</button>
                    </div>

                    <form id="chatbotForm"
                          class="chatbot-input-area">

                        <input id="chatbotInput"
                               class="chatbot-input"
                               type="text"
                               maxlength="500"
                               autocomplete="off"
                               placeholder="Ask about your store..."
                               aria-label="Your question"
                               required>

                        <button type="submit"
                                class="chatbot-send"
                                aria-label="Send message">

                            <svg viewBox="0 0 24 24"
                                 fill="none"
                                 stroke="currentColor"
                                 stroke-width="2"
                                 stroke-linecap="round"
                                 stroke-linejoin="round"
                                 aria-hidden="true">

                                <path d="m22 2-7 20-4-9-9-4Z"/>
                                <path d="M22 2 11 13"/>
                            </svg>
                        </button>
                    </form>
                </div>
            </div>
        </section>

        <button class="chatbot-toggle"
                id="chatbotToggle"
                type="button"
                aria-label="Open SmartMart Assistant"
                aria-controls="chatbotPanel"
                aria-expanded="false">

            <svg viewBox="0 0 24 24"
                 fill="none"
                 stroke="currentColor"
                 stroke-width="2"
                 stroke-linecap="round"
                 stroke-linejoin="round">

                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5
                         8.4 8.4 0 0 1-3.8-.9L3 21
                         l1.9-5.7a8.5 8.5 0 1 1
                         16.1-3.8Z"/>
            </svg>
        </button>
    `;

    document.body.append(root);

    const $ = selector =>
        root.querySelector(selector);

    const panel = $("#chatbotPanel");
    const toggle = $("#chatbotToggle");
    const messages = $("#chatbotMessages");
    const input = $("#chatbotInput");
    const side = $(".chatbot-side-menu");

    let current = "main";
    let stack = [];
    let generation = 0;
    let activeController = null;

    // Ensures messages are processed in order.
    let queue = Promise.resolve();

    // =========================================
    // GUIDED MENUS
    // =========================================

    const MENUS = {
        main: [
            "Main Menu",
            [
                ["inventory", "📦 Inventory Management"],
                ["orders", "🚚 Orders & Delivery"],
                ["sales", "📊 Sales Analytics"],
                ["intelligence", "🧠 Stock Intelligence"],
                ["summary", "📋 Business Summary"]
            ]
        ],

        inventory: [
            "Inventory Management",
            [
                ["browse", "Browse products by category"],
                ["total_products", "Total products"],
                ["low_stock", "Low-stock alerts"],
                ["highest_stock", "Highest stock"],
                ["lowest_stock", "Lowest stock"],
                ["categories", "Product categories"],
                ["prompt:product", "Find a product"]
            ]
        ],

        orders: [
            "Orders & Delivery",
            [
                ["order_overview", "Order overview"],
                ["pending_orders", "Pending orders"],
                ["processing_orders", "Processing orders"],
                ["dispatched_orders", "Dispatched orders"],
                ["delivered_orders", "Delivered orders"],
                ["cancelled_orders", "Cancelled orders"],
                ["recent_orders", "Recent orders"],
                ["prompt:order", "Track order by ID"]
            ]
        ],

        sales: [
            "Sales Analytics",
            [
                ["today_sales", "Today's completed sales"],
                ["completed_sales", "Completed sales"],
                ["best_sellers", "Best-selling products"],
                ["prompt:sales-product", "Units sold by product"]
            ]
        ],

        intelligence: [
            "Stock Intelligence",
            [
                ["forecast:overview", "Historical forecasts"],
                ["forecast:reorder", "Reorder suggestions"],
                ["forecast:risk", "Forecast stockout risk"]
            ]
        ],

        summary: [
            "Business Summary",
            [
                ["store_summary", "Store overview"],
                ["advice:general", "Improve store management"]
            ]
        ]
    };

    // =========================================
    // MESSAGE HELPERS
    // =========================================

    function add(text, who = "assistant") {
        const element = document.createElement("div");

        element.className = `chatbot-message ${who}`;
        element.textContent = text;

        messages.append(element);
        messages.scrollTop = messages.scrollHeight;

        return element;
    }

    function card(title) {
        const element = add("", "assistant");
        element.classList.add("chatbot-rich-card");

        const heading = document.createElement("strong");
        heading.textContent = title;
        element.append(heading);

        return element;
    }

    function btn(label, callback) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "chatbot-option";
        button.textContent = label;
        button.onclick = callback;

        return button;
    }

    // =========================================
    // MENU NAVIGATION
    // =========================================

    function menu(key, push = true) {
        if (!MENUS[key]) return;

        Chat.navigate();

        if (push && key !== current) {
            stack.push(current);
        }

        current = key;

        const [title, items] = MENUS[key];

        const element = card(title);
        const grid = document.createElement("div");
        grid.className = "chatbot-option-grid";

        for (const [action, label] of items) {
            grid.append(
                btn(label, () => choose(action, label))
            );
        }

        element.append(grid);

        $("#chatbotBack").disabled = !stack.length;

        sidebar();
        messages.scrollTop = messages.scrollHeight;
    }

    function sidebar() {
        side.replaceChildren();

        const heading = document.createElement("strong");
        heading.textContent = "Quick navigation";
        side.append(heading);

        for (const [key, label] of MENUS.main[1]) {
            const button = btn(label, () => {
                if (key !== current) {
                    menu(key);
                }
            });

            if (key === current) {
                button.classList.add("is-selected");
            }

            side.append(button);
        }
    }

    // =========================================
    // DISPLAY ENGINE RESULTS
    // =========================================

    function showResult(
        result,
        bubble = null,
        turn = generation
    ) {
        if (turn !== generation) return;

        if (result.type === "browse") {
            if (bubble) bubble.remove();

            browse(result.category);
            return;
        }

        if (result.type === "forecast") {
            const target =
                bubble || add("Loading historical forecasts…");

            return Engine.forecasts(result.query)
                .then(answer => {
                    if (turn === generation) {
                        target.textContent = answer;
                    }
                })
                .catch(error => {
                    console.warn("Forecast:", error);

                    if (turn === generation) {
                        target.textContent =
                            "Forecast files could not be loaded.";
                    }
                });
        }

        if (bubble) {
            bubble.textContent = result.text;
        } else {
            add(result.text);
        }
    }

    function choose(action, label) {
        add(label, "user");

        if (MENUS[action]) {
            menu(action);
            return;
        }

        // Direct menu action, no Ollama classification.
        const result = Chat.menuAction(action);
        const turn = generation;

        enqueue(() =>
            showResult(result, null, turn)
        );

        input.placeholder = "Ask about your store...";
        input.focus();
    }

    // =========================================
    // WINDOW CONTROLS
    // =========================================

    function show() {
        panel.hidden = false;
        toggle.hidden = true;
        toggle.style.display = "none";

        toggle.setAttribute(
            "aria-expanded",
            "true"
        );

        input.focus();
    }

    function hide() {
        panel.hidden = true;
        toggle.hidden = false;
        toggle.style.display = "flex";

        toggle.setAttribute(
            "aria-expanded",
            "false"
        );

        toggle.focus();
    }

    function maxButton() {
        const expanded =
            panel.classList.contains("chatbot-expanded");

        const button = $("#chatbotMaximize");

        button.textContent =
            expanded ? "❐" : "⛶";

        button.title =
            expanded ? "Restore" : "Maximize";

        button.setAttribute(
            "aria-label",
            button.title
        );

        button.setAttribute(
            "aria-pressed",
            String(expanded)
        );

        side.hidden = !expanded;
    }

    function reset() {
        generation++;

        activeController?.abort();
        activeController = null;

        Chat.reset();

        stack = [];
        current = "main";

        input.value = "";
        input.placeholder = "Ask about your store...";

        panel.classList.remove("chatbot-expanded");
        maxButton();

        messages.replaceChildren();

        add(
            "Hello! 👋 I'm your SmartMart Assistant. " +
            "Choose a menu or ask a question."
        );

        menu("main", false);
        hide();
    }

    // =========================================
    // CATEGORY PRODUCT BROWSER
    // =========================================

    function browse(initial = "") {
        const container = card("Browse Products");

        const info = document.createElement("p");
        const category = document.createElement("select");
        const search = document.createElement("input");
        const sort = document.createElement("select");
        const list = document.createElement("div");
        const pager = document.createElement("div");

        category.setAttribute("aria-label", "Category");

        search.type = "search";
        search.placeholder = "Search this category";
        search.setAttribute("aria-label", "Search products");

        sort.setAttribute("aria-label", "Sort products");

        const sortOptions = [
            ["name", "Name A–Z"],
            ["stockAsc", "Lowest stock"],
            ["stockDesc", "Highest stock"],
            ["priceAsc", "Lowest price"],
            ["priceDesc", "Highest price"]
        ];

        for (const [value, label] of sortOptions) {
            sort.add(new Option(label, value));
        }

        list.className = "chatbot-product-list";
        pager.className = "chatbot-pagination";

        container.append(
            info,
            category,
            search,
            sort,
            list,
            pager
        );

        let selected = initial;
        let page = 0;

        function render() {
            try {
                const all = getStock();

                const categories = [
                    ...new Set(
                        all.map(
                            p => p.category || "Uncategorized"
                        )
                    )
                ].sort();

                category.replaceChildren(
                    new Option(
                        "Select a category",
                        ""
                    )
                );

                for (const name of categories) {
                    const count = all.filter(
                        p =>
                            (p.category || "Uncategorized") === name
                    ).length;

                    category.add(
                        new Option(
                            `${name} (${count})`,
                            name
                        )
                    );
                }

                if (!categories.includes(selected)) {
                    selected = "";
                }

                category.value = selected;

                list.replaceChildren();
                pager.replaceChildren();

                search.hidden = !selected;
                sort.hidden = !selected;

                if (!selected) {
                    info.textContent =
                        `${all.length} products across ` +
                        `${categories.length} categories. Choose one:`;

                    for (const name of categories) {
                        list.append(
                            btn(name, () => {
                                selected = name;
                                search.value = "";
                                page = 0;
                                render();
                            })
                        );
                    }

                    if (!categories.length) {
                        list.textContent =
                            "No products available.";
                    }

                    return;
                }

                const filtered = all.filter(
                    p =>
                        (p.category || "Uncategorized") ===
                            selected &&
                        norm(p.name).includes(
                            norm(search.value)
                        )
                );

                const sortKey = sort.value;

                filtered.sort((a, b) => {
                    if (sortKey === "name") {
                        return String(a.name)
                            .localeCompare(
                                String(b.name)
                            );
                    }

                    if (sortKey === "stockAsc") {
                        return Number(a.stock) -
                            Number(b.stock);
                    }

                    if (sortKey === "stockDesc") {
                        return Number(b.stock) -
                            Number(a.stock);
                    }

                    if (sortKey === "priceAsc") {
                        return Number(a.price) -
                            Number(b.price);
                    }

                    return Number(b.price) -
                        Number(a.price);
                });

                const pages = Math.max(
                    1,
                    Math.ceil(
                        filtered.length / PAGE_SIZE
                    )
                );

                page = Math.max(
                    0,
                    Math.min(page, pages - 1)
                );

                info.textContent =
                    `${selected}: ${filtered.length} products`;

                if (!filtered.length) {
                    list.textContent =
                        "No matching products.";
                    return;
                }

                const visible = filtered.slice(
                    page * PAGE_SIZE,
                    (page + 1) * PAGE_SIZE
                );

                for (const product of visible) {
                    const row = document.createElement("div");
                    const title = document.createElement("strong");
                    const detail = document.createElement("small");

                    row.className = "chatbot-product-row";

                    title.textContent = product.name;

                    detail.textContent =
                        `${money(product.price)} · ` +
                        `Stock ${product.stock}` +
                        (
                            Number(product.stock) <= limit()
                                ? " · LOW STOCK"
                                : ""
                        );

                    row.append(title, detail);
                    list.append(row);
                }

                const previous = btn(
                    "‹ Previous",
                    () => {
                        page--;
                        render();
                    }
                );

                const next = btn(
                    "Next ›",
                    () => {
                        page++;
                        render();
                    }
                );

                previous.disabled = page === 0;
                next.disabled = page >= pages - 1;

                const counter = document.createElement("span");
                counter.textContent =
                    `${page + 1} / ${pages}`;

                pager.append(previous, counter, next);

            } catch (error) {
                console.error("Product browser:", error);
                info.textContent =
                    "Couldn't load products.";
            }
        }

        category.onchange = () => {
            selected = category.value;
            search.value = "";
            page = 0;
            render();
        };

        search.oninput = () => {
            page = 0;
            render();
        };

        sort.onchange = () => {
            page = 0;
            render();
        };

        render();
    }

    // =========================================
    // MESSAGE PROCESSING QUEUE
    // =========================================

    function enqueue(task) {
        const turn = generation;

        queue = queue
            .catch(() => {})
            .then(() => {
                if (turn === generation) {
                    return task();
                }
            });
    }

    async function respond(raw, turn = generation) {
        const bubble = add(
            "Understanding your question…"
        );

        const controller = new AbortController();
        activeController = controller;

        try {
            // All typed questions use the intent router.
            const result = await Chat.run(
                raw,
                { signal: controller.signal }
            );

            if (turn === generation) {
                await showResult(
                    result,
                    bubble,
                    turn
                );
            }

        } catch (error) {
            if (turn !== generation) return;

            console.warn(
                "SmartMart conversation:",
                error
            );

            bubble.textContent =
                "I couldn't interpret that right now. " +
                "Check Ollama and try again, " +
                "or use Main Menu.";

        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }

    function send(value) {
        const raw = String(value).trim();
        if (!raw) return;

        add(raw, "user");

        input.value = "";

        const turn = generation;

        enqueue(() =>
            respond(raw, turn)
        );

        input.focus();
    }

    // =========================================
    // EVENT LISTENERS
    // =========================================

    $("#chatbotForm").onsubmit = event => {
        event.preventDefault();
        send(input.value);
    };

    $("#chatbotMinimize").onclick = hide;
    $("#chatbotClose").onclick = reset;

    $("#chatbotMaximize").onclick = () => {
        panel.classList.toggle("chatbot-expanded");
        maxButton();
        messages.scrollTop = messages.scrollHeight;
    };

    $("#chatbotBack").onclick = () => {
        if (stack.length) {
            menu(stack.pop(), false);
        }
    };

    $("#chatbotHome").onclick = () => {
        stack = [];
        menu("main", false);
    };

    toggle.onclick = show;

    document.addEventListener("keydown", event => {
        if (
            event.key === "Escape" &&
            !panel.hidden
        ) {
            hide();
        }
    });

    // =========================================
    // INITIALIZE
    // =========================================

    add(
        "Hello! 👋 I'm your SmartMart Assistant. " +
        "Select a menu option or ask a question."
    );

    menu("main", false);
    maxButton();

})();
