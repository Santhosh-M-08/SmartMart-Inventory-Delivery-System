
const fs = require("fs");
const path = require("path");
const { initializeDatabase } = require("./db");

const forecastPath = path.join(
    __dirname,
    "../../ml/data/forecasts.json"
);

function importPredictions() {
    const forecasts = JSON.parse(
        fs.readFileSync(forecastPath, "utf8")
    );

    if (!Array.isArray(forecasts)) {
        throw new Error("Forecast file must contain an array.");
    }

    const db = initializeDatabase();

    try {
        const insert = db.prepare(`
            INSERT INTO predictions (
                product_id,
                prediction_date,
                predicted_demand
            )
            VALUES (?, ?, ?)
            ON CONFLICT(product_id, prediction_date)
            DO UPDATE SET
                predicted_demand = excluded.predicted_demand,
                created_at = CURRENT_TIMESTAMP
        `);

        const importAll = db.transaction(() => {
            for (const forecast of forecasts) {
                const id = Number(forecast.product_id);
                const demand = Number(
                    forecast.predicted_demand
                );
                const date = forecast.prediction_date;

                if (
                    !Number.isSafeInteger(id) ||
                    id <= 0 ||
                    !Number.isSafeInteger(demand) ||
                    demand < 0 ||
                    typeof date !== "string" ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(date)
                ) {
                    throw new Error(
                        `Invalid forecast for product ${forecast.product_id}`
                    );
                }

                insert.run(id, date, demand);
            }
        });

        importAll();

        const results = db.prepare(`
            SELECT
                p.name,
                f.prediction_date,
                f.predicted_demand
            FROM predictions f
            JOIN products p ON p.id = f.product_id
            ORDER BY f.product_id
        `).all();

        console.log(
            `Imported ${forecasts.length} forecast records.`
        );
        console.table(results);

    } finally {
        db.close();
    }
}

importPredictions();
