const STORAGE_KEY = "smartmart_products";

    // Two days for delivery, two days of safety stock.
    const LEAD_TIME = 2;
    const SAFETY_DAYS = 2;

    let forecasts = [];
    let mapping = {};

    const el = id => document.getElementById(id);

    function cell(row, value) {
      const td = document.createElement("td");
      td.textContent = String(value);
      row.appendChild(td);
      return td;
    }

    function loadInventory() {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw === null) {
        throw new Error(
          "No SmartMart inventory found in this browser."
        );
      }

      const products = JSON.parse(raw);

      if (!Array.isArray(products)) {
        throw new Error("Invalid inventory data.");
      }

      return products;
    }

    function analyzeProduct(product) {
      const mlId = mapping[String(product.id)];

      const forecast = forecasts.find(
        f => Number(f.product_id) === Number(mlId)
      );

      if (!forecast || !Number.isFinite(
        Number(product.stock)
      ) || Number(product.stock) < 0) {
        return null;
      }

      const stock = Number(product.stock);
      const demand = Number(forecast.predicted_demand);

      if (!Number.isFinite(demand) || demand < 0) {
        return null;
      }

      const daysLeft = demand === 0
        ? Infinity
        : stock / demand;

      let status = "Healthy";

      if (daysLeft <= 1) {
        status = "Critical";
      } else if (daysLeft <= 3) {
        status = "Warning";
      }

      const reorder = Math.max(
        0,
        Math.ceil(
          demand * (LEAD_TIME + SAFETY_DAYS)
          - stock
        )
      );

      return { stock, demand, daysLeft, status, reorder };
    }

    function renderDashboard() {
      const products = loadInventory();

      const tbody = el("stockTable");
      tbody.replaceChildren();

      let critical = 0;
      let warning = 0;
      let healthy = 0;

      for (const product of products) {
        const result = analyzeProduct(product);

        const row = document.createElement("tr");

        cell(row, product.name);
        cell(row, product.stock);

        if (result === null) {
          cell(row, "N/A");
          cell(row, "N/A");

          const statusCell = cell(row, "");
          const badge = document.createElement("span");

          badge.className = "badge unavailable";
          badge.textContent = "Forecast Unavailable";
          statusCell.appendChild(badge);

          cell(row, "N/A");
        } else {
          cell(row, result.demand);

          cell(
            row,
            Number.isFinite(result.daysLeft)
              ? result.daysLeft.toFixed(2)
              : "Unlimited*"
          );

          const statusCell = cell(row, "");
          const badge = document.createElement("span");

          badge.className =
            "badge " + result.status.toLowerCase();
          badge.textContent = result.status;
          statusCell.appendChild(badge);

          cell(row, result.reorder);

          if (result.status === "Critical") critical++;
          if (result.status === "Warning") warning++;
          if (result.status === "Healthy") healthy++;
        }

        tbody.appendChild(row);
      }

      el("total").textContent = products.length;
      el("critical").textContent = critical;
      el("warning").textContent = warning;
      el("healthy").textContent = healthy;
      sortProducts();
      applyFilters();
    }

    async function initialize() {
      try {
        el("message").textContent = "";

        const [forecastResponse, mappingResponse] =
          await Promise.all([
            fetch("ml/data/forecasts.json"),
            fetch("ml/product_mapping.json")
          ]);

        if (!forecastResponse.ok || !mappingResponse.ok) {
          throw new Error(
            "Could not load ML forecast or product mapping."
          );
        }

        forecasts = await forecastResponse.json();
        mapping = await mappingResponse.json();

        if (!Array.isArray(forecasts)) {
          throw new Error("Invalid forecast file.");
        }

        const dates = [
          ...new Set(
            forecasts.map(f => f.prediction_date)
          )
        ];

        el("forecastDate").textContent =
          "Forecast date: " + dates.join(", ")
          + " (historical demonstration)";

        renderDashboard();
      } catch (error) {
        el("message").textContent = error.message;
      }
    }

    el("refreshBtn").addEventListener(
      "click",
      initialize
    );


    function applyFilters() {
        const search = document.getElementById("productSearch")
            .value.trim().toLowerCase();

        const selectedRisk = document.getElementById("riskFilter")
            .value;

        const rows = document.querySelectorAll(
            "#stockTable tr"
        );

        let visibleCount = 0;

        el("emptyFilterMessage").hidden =
            visibleCount !== 0;

        rows.forEach(row => {
            const productName = row.cells[0]
                .textContent.toLowerCase();

            const risk = row.cells[4]
                .textContent.trim();

            const matchesSearch = productName.includes(search);

            const matchesRisk =
                selectedRisk === "all" ||
                risk === selectedRisk;

            const visible = matchesSearch && matchesRisk;

            row.hidden = !visible;

            if (visible) {
                visibleCount++;
            }
        });

        document.getElementById("filterCount")
            .textContent =
            `Showing ${visibleCount} of ${rows.length} products`;
    }

    function clearFilters() {
        document.getElementById("productSearch").value = "";
        document.getElementById("riskFilter").value = "all";

        applyFilters();
    }


    function sortProducts() {
        const sortBy = el("sortFilter").value;
        const tbody = el("stockTable");

        const rows = Array.from(tbody.querySelectorAll("tr"));

        const riskPriority = {
            "Critical": 0,
            "Warning": 1,
            "Healthy": 2,
            "Forecast Unavailable": 3
        };

        function numberAt(row, index) {
            const value = row.cells[index].textContent.trim();

            if (value === "N/A" || value === "Unlimited*") {
                return Infinity;
            }

            return Number(value);
        }

        rows.sort((a, b) => {
            const nameA = a.cells[0].textContent.trim();
            const nameB = b.cells[0].textContent.trim();

            const riskA = a.cells[4].textContent.trim();
            const riskB = b.cells[4].textContent.trim();

            if (sortBy === "name") {
                return nameA.localeCompare(nameB);
            }

            if (sortBy === "days") {
                return numberAt(a, 3) - numberAt(b, 3);
            }

            if (sortBy === "demand") {
                const demandA = numberAt(a, 2);
                const demandB = numberAt(b, 2);

                if (demandA === Infinity) return 1;
                if (demandB === Infinity) return -1;

                return demandB - demandA;
            }

            // Default: highest risk first
            return riskPriority[riskA] - riskPriority[riskB];
        });

        rows.forEach(row => tbody.appendChild(row));
    }

// Sort whenever the selection changes
el("sortFilter").addEventListener(
    "change",
    sortProducts
);


    // Register events once
    document.getElementById("productSearch")
        .addEventListener("input", applyFilters);

    document.getElementById("riskFilter")
        .addEventListener("change", applyFilters);

    document.getElementById("clearFiltersBtn")
        .addEventListener("click", clearFilters);


    initialize();