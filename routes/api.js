// Public read-only API used by the frontend.
const express = require('express');
const db = require('../db');

const router = express.Router();

router.post('/contact', (req, res) => {
  const {
    firstName,
    lastName,
    email,
    organisation,
    enquiryType,
    message,
  } = req.body;

  if (!firstName || !lastName || !email || !message) {
    return res.status(400).json({
      error: 'First name, last name, email, and message are required.',
    });
  }

  db.prepare(`
    INSERT INTO contact_messages
    (first_name, last_name, email, organisation, enquiry_type, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    firstName.trim(),
    lastName.trim(),
    email.trim(),
    organisation?.trim() || null,
    enquiryType?.trim() || null,
    message.trim()
  );

  res.status(201).json({ message: 'Message received successfully.' });
});

// GET /api/projects  — each project includes its image gallery.
router.get('/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT id, title, region, location, partner, year, description
    FROM projects
    ORDER BY display_order ASC, year DESC, created_at DESC
  `).all();
  const imgStmt = db.prepare(`
    SELECT file_path, caption FROM project_images
    WHERE project_id = ? ORDER BY display_order ASC, id ASC
  `);
  for (const p of projects) {
    p.images = imgStmt.all(p.id);
  }
  res.json(projects);
});

// GET /api/publications
router.get('/publications', (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, pub_type, year, description, file_path, original_filename
    FROM publications
    ORDER BY display_order ASC, year DESC, created_at DESC
  `).all();
  res.json(rows);
});

// GET /api/team  — grouped into trustees and management.
router.get('/team', (req, res) => {
  const rows = db.prepare(`
    SELECT id, group_type, name, role, bio, photo_path, initials
    FROM team_members
    ORDER BY group_type ASC, display_order ASC, id ASC
  `).all();
  res.json({
    trustees:   rows.filter((r) => r.group_type === 'trustee'),
    management: rows.filter((r) => r.group_type === 'management'),
  });
});

// GET /api/partners — grouped by category.
router.get('/partners', (req, res) => {
  const rows = db.prepare(`
    SELECT id, category, name, description
    FROM partners
    ORDER BY category ASC, display_order ASC, id ASC
  `).all();
  res.json({
    government:  rows.filter((r) => r.category === 'government'),
    development: rows.filter((r) => r.category === 'development'),
    community:   rows.filter((r) => r.category === 'community'),
  });
});

// GET /api/content — flat { key: value } map of all editable text.
router.get('/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM content_blocks').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  res.json(map);
});

module.exports = router;
