// Tiny SQLite session store on top of the already-installed better-sqlite3.
// API-compatible with express-session's Store interface.
const session = require('express-session');
const db = require('./index');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

class SQLiteStore extends session.Store {
  constructor() {
    super();
    this.getStmt    = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt    = db.prepare('INSERT OR REPLACE INTO sessions (sid, expires, data) VALUES (?, ?, ?)');
    this.delStmt    = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt  = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.cleanStmt  = db.prepare('DELETE FROM sessions WHERE expires < ?');
    // Sweep expired sessions every hour.
    setInterval(() => this.cleanStmt.run(Date.now()), 60 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        this.delStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const ttl = (sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 24 * 14;
      this.setStmt.run(sid, Date.now() + ttl, JSON.stringify(sess));
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb && cb(null); }
    catch (err) { cb && cb(err); }
  }
  touch(sid, sess, cb) {
    try {
      const ttl = (sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 24 * 14;
      this.touchStmt.run(Date.now() + ttl, sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
}

module.exports = SQLiteStore;
