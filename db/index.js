// Single shared SQLite connection.
// Using better-sqlite3 because it is synchronous, fast, and zero-config.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'crs.db');
const db = new Database(DB_PATH);

// Enable foreign keys and WAL for better concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
