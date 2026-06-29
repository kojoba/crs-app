const db = require('./db');

const columns = db.prepare("PRAGMA table_info(projects)").all();

console.table(columns);