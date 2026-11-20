
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const databasePath = path.join(__dirname, "smartmart.db");
const schemaPath = path.join(__dirname, "schema.sql");

function initializeDatabase() {
    const db = new Database(databasePath);

    try {
        db.pragma("foreign_keys = ON");
        db.pragma("journal_mode = WAL");

        const schema = fs.readFileSync(schemaPath, "utf8");
        db.exec(schema);

        console.log("SmartMart SQLite database initialized!");

        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

if (require.main === module) {
    const db = initializeDatabase();

    const tables = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all();

    console.log("\nCreated database tables:");
    console.table(tables);

    db.close();
}

module.exports = { initializeDatabase };
