// CRS — Express server.
// Serves the static frontend, the public API, and the admin panel.
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('./db/session-store');

// Ensure DB exists & is migrated/seeded before we accept traffic.
const { createSchema, seedContentAndCollections, seedAdmin } = require('./db/init');
createSchema();
seedContentAndCollections();
seedAdmin().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';

// View engine for admin pages.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Trust the proxy if you put this behind nginx/Caddy/etc.
if (PROD) app.set('trust proxy', 1);

// Body parsing — multipart is handled per-route by multer.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions — single admin login, persisted in SQLite so they survive restarts.
app.use(
  session({
    store: new SQLiteStore(),
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }),
);

// Public API and uploaded files.
app.use('/api', apiRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), {
  maxAge: '7d',
}));

// Admin panel.
app.use('/admin', adminRoutes);

// Static frontend (index.html and friends).
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: PROD ? '1h' : 0,
}));

// 404 fallback.
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Global error handler — catches multer errors, etc.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/admin')) {
    return res.status(400).render('admin/error', { error: err.message });
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`CRS backend running on http://localhost:${PORT}`);
  console.log(`Admin panel:    http://localhost:${PORT}/admin/login`);
});
