// Initialise the SQLite schema and seed initial data.
// Safe to run repeatedly — uses CREATE TABLE IF NOT EXISTS and only seeds
// when the relevant table is empty.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      region        TEXT,
      location      TEXT,
      partner       TEXT,
      year          INTEGER,
      description   TEXT,
      display_order INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_images (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path     TEXT NOT NULL,
      caption       TEXT,
      display_order INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      pub_type      TEXT,
      year          INTEGER,
      description   TEXT,
      file_path     TEXT,
      original_filename TEXT,
      display_order INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      group_type    TEXT NOT NULL DEFAULT 'management',  -- 'trustee' | 'management'
      name          TEXT NOT NULL,
      role          TEXT,
      bio           TEXT,
      photo_path    TEXT,
      initials      TEXT,
      display_order INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS partners (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category      TEXT NOT NULL DEFAULT 'government', -- 'government' | 'development' | 'community'
      name          TEXT NOT NULL,
      description   TEXT,
      display_order INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_blocks (
      key           TEXT PRIMARY KEY,
      value         TEXT,
      label         TEXT,
      page          TEXT,
      input_type    TEXT DEFAULT 'text',
      display_order INTEGER DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_projects_order      ON projects(display_order, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_images      ON project_images(project_id, display_order);
    CREATE INDEX IF NOT EXISTS idx_publications_order  ON publications(display_order, year DESC);
    CREATE INDEX IF NOT EXISTS idx_team_order          ON team_members(group_type, display_order);
    CREATE INDEX IF NOT EXISTS idx_partners_order      ON partners(category, display_order);
    CREATE INDEX IF NOT EXISTS idx_content_page        ON content_blocks(page, display_order);
    
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      organisation TEXT,
      enquiry_type TEXT,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_contact_messages_created
    ON contact_messages(created_at DESC);
  `); 
}

function seedContentAndCollections() {
  const seedPath = path.join(__dirname, 'seed-data.json');
  if (!fs.existsSync(seedPath)) {
    console.warn('[init] seed-data.json not found — skipping content seed.');
    return;
  }
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // Team members
  if (db.prepare('SELECT COUNT(*) AS n FROM team_members').get().n === 0) {
    const stmt = db.prepare(`INSERT INTO team_members
      (group_type, name, role, bio, initials, display_order) VALUES (?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((rows) => rows.forEach((m) =>
      stmt.run(m.group_type, m.name, m.role, m.bio, m.initials || null, m.display_order || 0)));
    tx(seed.team_members || []);
    console.log(`[init] Seeded ${seed.team_members.length} team members.`);
  }

  // Partners
  if (db.prepare('SELECT COUNT(*) AS n FROM partners').get().n === 0) {
    const stmt = db.prepare(`INSERT INTO partners
      (category, name, description, display_order) VALUES (?, ?, ?, ?)`);
    const tx = db.transaction((rows) => rows.forEach((p) =>
      stmt.run(p.category, p.name, p.description || null, p.display_order || 0)));
    tx(seed.partners || []);
    console.log(`[init] Seeded ${seed.partners.length} partners.`);
  }

  // Content blocks — upsert labels/pages but never overwrite an admin-edited value.
  const insert = db.prepare(`INSERT INTO content_blocks
      (key, value, label, page, input_type, display_order)
      VALUES (@key, @value, @label, @page, @input_type, @display_order)
      ON CONFLICT(key) DO UPDATE SET label = @label, page = @page,
        input_type = @input_type, display_order = @display_order`);
  const tx = db.transaction((rows) => rows.forEach((r, i) =>
    insert.run({
      key: r[1], value: r[4], label: r[2], page: r[0],
      input_type: r[3], display_order: i,
    })));
  tx(seed.content_blocks || []);
  console.log(`[init] Ensured ${seed.content_blocks.length} content blocks.`);
}

async function seedAdmin() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (existing.n > 0) {
    console.log(`[init] users table already has ${existing.n} row(s) — skipping admin seed.`);
    return;
  }
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  if (password === 'changeme' || password === 'change-me-on-first-login') {
    console.warn('[init] WARNING — ADMIN_PASSWORD is not set in .env. Using insecure default.');
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`[init] Seeded admin user "${username}".`);
}

async function main() {
  createSchema();
  seedContentAndCollections();
  await seedAdmin();
  console.log('[init] Done.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[init] Failed:', err);
    process.exit(1);
  });
}

module.exports = { createSchema, seedContentAndCollections, seedAdmin };
