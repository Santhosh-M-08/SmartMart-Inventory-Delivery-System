
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// Database directory
const databaseDir = __dirname;

// SQLite database file
const databasePath = path.join(
    databaseDir,
    "smartmart.db"
);

// SQL schema file
const schemaPath = path.join(
    databaseDir,
    "schema.sql"
);

function initializeDatabase() {

    // Ensure database directory exists
    fs.mkdirSync(databaseDir, {
        recursive: true
    });

    // Connect to SQLite
    const db = new Database(databasePath);

    try {
        // Enable foreign key constraints
        db.pragma("foreign_keys = ON");

        // Read SQL schema
        const schema = fs.readFileSync(
            schemaPath,
            "utf8"
        );

        // Create all tables
        db.exec(schema);

        console.log(
            "SmartMart database initialized successfully!"
        );

        return db;

    } catch (error) {
        db.close();
        throw error;
    }
}

// Run when executed directly
if (require.main === module) {
    const db = initializeDatabase();

    const tables = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all();

    console.log("\nDatabase tables:");

    tables.forEach(table => {
        console.log("-", table.name);
    });

    db.close();
}

// Export for future backend integration
module.exports = {
    initializeDatabase
};
