// All admin (authenticated) routes.
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// File-upload config (multer)
// ─────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e4)}-${safe}`);
  },
});

const PROJECT_IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const PROJECT_PDF_RE = /\.pdf$/i;

const uploadProjectFiles = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 13
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images'){
      const allowedImageTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
      ];

      if(
        !PROJECT_IMAGE_RE.test(file.originalname) ||
        !allowedImageTypes.includes(file.mimetype)
      ){
        return cb(new Error('Only PNG, JPG, JPEG and WEBP images are allowed.'));
      }

      return cb(null, true);
    }

    if (file.fieldname === 'project_pdf') {
      if (
        !PROJECT_PDF_RE.test(file.originalname) ||
        file.mimetype !== 'application/pdf'
      ) {
        return cb(new Error('Only PDF files are allowed.'));
      }
      return cb(null, true);
    }

    cb(new Error('Invalid upload field.'));
  },
});

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const DOC_RE = /\.(pdf|docx?|pptx?|xlsx?|png|jpe?g|webp)$/i;

const allowedDocTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const uploadDoc = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      !DOC_RE.test(file.originalname) ||
      !allowedDocTypes.includes(file.mimetype)
    ) {
      return cb(new Error('Unsupported document type.'));
    }

    cb(null, true);
  },
});

const uploadImages = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImageTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ];

    if (
      !IMAGE_RE.test(file.originalname) ||
      !allowedImageTypes.includes(file.mimetype)
    ) {
      return cb(new Error('Only PNG, JPG, JPEG, WEBP, and GIF images are allowed.'));
    }

    cb(null, true);
  },
});

// Remove an uploaded file from disk given its public path (/uploads/x).
function unlinkPublic(publicPath) {
  if (!publicPath) return;
  const f = path.join(__dirname, '..', 'public', publicPath);
  if (fs.existsSync(f)) {
    try { fs.unlinkSync(f); } catch (_) { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function flash(req, type, message) { req.session.flash = { type, message }; }
function consumeFlash(req) {
  const f = req.session && req.session.flash;
  if (f) delete req.session.flash;
  return f || null;
}

router.use((req, res, next) => {
  res.locals.flash = consumeFlash(req);
  res.locals.currentUser = req.session.userId
    ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId)
    : null;
  res.locals.currentPath = req.path;
  next();
});

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('admin/login', { error: 'Username and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('admin/login', { error: 'Invalid credentials.' });
  }
  req.session.userId = user.id;
  res.redirect('/admin');
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  res.render('admin/dashboard', {
    projectCount:     db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,
    publicationCount: db.prepare('SELECT COUNT(*) AS n FROM publications').get().n,
    teamCount:        db.prepare('SELECT COUNT(*) AS n FROM team_members').get().n,
    partnerCount:     db.prepare('SELECT COUNT(*) AS n FROM partners').get().n,
    messageCount:     db.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n,
    latestProjects:   db.prepare('SELECT id, title, region, year FROM projects ORDER BY created_at DESC LIMIT 5').all(),
    latestPublications: db.prepare('SELECT id, title, pub_type, year FROM publications ORDER BY created_at DESC LIMIT 5').all(),
  });
});

// ─────────────────────────────────────────────────────────────
// Projects (with image gallery)
// ─────────────────────────────────────────────────────────────
function getProjectImages(projectId) {
  return db.prepare('SELECT * FROM project_images WHERE project_id = ? ORDER BY display_order ASC, id ASC').all(projectId);
}

router.get('/projects', requireAuth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY display_order ASC, year DESC, created_at DESC').all();
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM project_images WHERE project_id = ?');
  for (const p of projects) p.imageCount = countStmt.get(p.id).n;
  res.render('admin/projects', { projects });
});

router.get('/projects/new', requireAuth, (req, res) => {
  res.render('admin/project-form', { project: {}, images: [], mode: 'new' });
});

router.post('/projects', requireAuth, uploadProjectFiles.fields([
  { name: 'images', maxCount: 12 },
  { name: 'project_pdf', maxCount: 1 },
]), (req, res) => {
  const { title, region, location, partner, year, description, display_order } = req.body;

  const images = req.files?.images || [];
  const pdf = req.files?.project_pdf?.[0] || null;

  if (!title || !title.trim()) {
    images.forEach((f) => unlinkPublic(`/uploads/${f.filename}`));
    if (pdf) unlinkPublic(`/uploads/${pdf.filename}`);

    flash(req, 'error', 'Title is required.');
    return res.redirect('/admin/projects/new');
  }

  const info = db.prepare(`
    INSERT INTO projects (
      title, region, location, partner, year, description,
      pdf_file_path, pdf_original_filename, pdf_file_size,
      display_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    region || null,
    location || null,
    partner || null,
    year ? Number(year) : null,
    description || null,
    pdf ? `/uploads/${pdf.filename}` : null,
    pdf ? pdf.originalname : null,
    pdf ? pdf.size : null,
    display_order ? Number(display_order) : 0,
  );

  const projectId = info.lastInsertRowid;

  const imgStmt = db.prepare(
    'INSERT INTO project_images (project_id, file_path, display_order) VALUES (?, ?, ?)'
  );

  images.forEach((f, i) => {
    imgStmt.run(projectId, `/uploads/${f.filename}`, i);
  });

  flash(req, 'success', 'Project created.');
  res.redirect(`/admin/projects/${projectId}/edit`);
});

router.get('/projects/:id/edit', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).send('Not found');
  res.render('admin/project-form', { project, images: getProjectImages(project.id), mode: 'edit' });
});

router.post('/projects/:id', requireAuth, uploadProjectFiles.fields([
  { name: 'images', maxCount: 12 },
  { name: 'project_pdf', maxCount: 1 },
]), (req, res) => {
  const existingProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  const {remove_pdf} = req.body;
  if (!existingProject) return res.status(404).send('Not found');

  const { title, region, location, partner, year, description, display_order } = req.body;

  const images = req.files?.images || [];
  const pdf = req.files?.project_pdf?.[0] || null;

  if (!title || !title.trim()) {
    images.forEach((f) => unlinkPublic(`/uploads/${f.filename}`));
    if (pdf) unlinkPublic(`/uploads/${pdf.filename}`);

    flash(req, 'error', 'Title is required.');
    return res.redirect(`/admin/projects/${req.params.id}/edit`);
  }

  let pdfFilePath = existingProject.pdf_file_path;
  let pdfOriginalFilename = existingProject.pdf_original_filename;
  let pdfFileSize = existingProject.pdf_file_size;

  if (pdf) {
    unlinkPublic(existingProject.pdf_file_path);

    pdfFilePath = `/uploads/${pdf.filename}`;
    pdfOriginalFilename = pdf.originalname;
    pdfFileSize = pdf.size;
  }
  else if (remove_pdf === 'on' && existingProject.pdf_file_path && !pdf){
    unlinkPublic(existingProject.pdf_file_path);

    pdfFilePath = null;
    pdfOriginalFilename = null;
    pdfFileSize = null;
  }

  db.prepare(`
    UPDATE projects SET 
      title = ?, 
      region = ?, 
      location = ?, 
      partner = ?, 
      year = ?,
      description = ?, 
      pdf_file_path = ?,
      pdf_original_filename = ?,
      pdf_file_size = ?,
      display_order = ?, 
      updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(
    title.trim(),
    region || null,
    location || null,
    partner || null,
    year ? Number(year) : null,
    description || null,
    pdfFilePath,
    pdfOriginalFilename,
    pdfFileSize,
    display_order ? Number(display_order) : 0,
    req.params.id,
  );

  const base = db.prepare(
    'SELECT COALESCE(MAX(display_order), -1) AS m FROM project_images WHERE project_id = ?'
  ).get(req.params.id).m;

  const imgStmt = db.prepare(
    'INSERT INTO project_images (project_id, file_path, display_order) VALUES (?, ?, ?)'
  );

  images.forEach((f, i) => {
    imgStmt.run(req.params.id, `/uploads/${f.filename}`, base + 1 + i);
  });

  flash(req, 'success', 'Project updated.');
  res.redirect(`/admin/projects/${req.params.id}/edit`);
});

router.post('/projects/:id/delete', requireAuth, (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).get(req.params.id);

  if (project?.pdf_file_path) {
    unlinkPublic(project.pdf_file_path);
  }

  getProjectImages(req.params.id).forEach((img) => {
    unlinkPublic(img.file_path);
  });

  db.prepare('DELETE FROM project_images WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

  flash(req, 'success', 'Project deleted.');
  res.redirect('/admin/projects');
});

// Delete a single project image.
router.post('/projects/:id/images/:imageId/delete', requireAuth, (req, res) => {
  const img = db.prepare('SELECT * FROM project_images WHERE id = ? AND project_id = ?').get(req.params.imageId, req.params.id);
  if (img) {
    unlinkPublic(img.file_path);
    db.prepare('DELETE FROM project_images WHERE id = ?').run(img.id);
    flash(req, 'success', 'Image removed.');
  }
  res.redirect(`/admin/projects/${req.params.id}/edit`);
});

// ─────────────────────────────────────────────────────────────
// Publications (with file upload)
// ─────────────────────────────────────────────────────────────
router.get('/publications', requireAuth, (req, res) => {
  const publications = db.prepare('SELECT * FROM publications ORDER BY display_order ASC, year DESC, created_at DESC').all();
  res.render('admin/publications', { publications });
});

router.get('/publications/new', requireAuth, (req, res) => {
  res.render('admin/publication-form', { publication: {}, mode: 'new' });
});

router.post('/publications', requireAuth, uploadDoc.single('file'), (req, res) => {
  const { title, pub_type, year, description, display_order } = req.body;
  if (!title || !title.trim()) {
    if (req.file) unlinkPublic(`/uploads/${req.file.filename}`);
    flash(req, 'error', 'Title is required.');
    return res.redirect('/admin/publications/new');
  }
  db.prepare(`
    INSERT INTO publications (title, pub_type, year, description, file_path, original_filename, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), pub_type || null, year ? Number(year) : null, description || null,
    req.file ? `/uploads/${req.file.filename}` : null,
    req.file ? req.file.originalname : null,
    display_order ? Number(display_order) : 0,
  );
  flash(req, 'success', 'Publication created.');
  res.redirect('/admin/publications');
});

router.get('/publications/:id/edit', requireAuth, (req, res) => {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!publication) return res.status(404).send('Not found');
  res.render('admin/publication-form', { publication, mode: 'edit' });
});

router.post('/publications/:id', requireAuth, uploadDoc.single('file'), (req, res) => {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!publication) return res.status(404).send('Not found');
  const { title, pub_type, year, description, display_order, remove_file } = req.body;
  if (!title || !title.trim()) {
    if (req.file) unlinkPublic(`/uploads/${req.file.filename}`);
    flash(req, 'error', 'Title is required.');
    return res.redirect(`/admin/publications/${req.params.id}/edit`);
  }
  let filePath = publication.file_path;
  let originalFilename = publication.original_filename;
  if (req.file) {
    unlinkPublic(publication.file_path);
    filePath = `/uploads/${req.file.filename}`;
    originalFilename = req.file.originalname;
  } else if (remove_file === 'on' && publication.file_path) {
    unlinkPublic(publication.file_path);
    filePath = null; originalFilename = null;
  }
  db.prepare(`
    UPDATE publications SET title = ?, pub_type = ?, year = ?, description = ?,
      file_path = ?, original_filename = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    title.trim(), pub_type || null, year ? Number(year) : null, description || null,
    filePath, originalFilename, display_order ? Number(display_order) : 0, req.params.id,
  );
  flash(req, 'success', 'Publication updated.');
  res.redirect('/admin/publications');
});

router.post('/publications/:id/delete', requireAuth, (req, res) => {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (publication) unlinkPublic(publication.file_path);
  db.prepare('DELETE FROM publications WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Publication deleted.');
  res.redirect('/admin/publications');
});

// ─────────────────────────────────────────────────────────────
// Team members (trustees + management, with photo)
// ─────────────────────────────────────────────────────────────
const TEAM_GROUPS = ['trustee', 'management'];

router.get('/team', requireAuth, (req, res) => {
  const trustees   = db.prepare("SELECT * FROM team_members WHERE group_type = 'trustee'    ORDER BY display_order ASC, id ASC").all();
  const management = db.prepare("SELECT * FROM team_members WHERE group_type = 'management' ORDER BY display_order ASC, id ASC").all();
  res.render('admin/team', { trustees, management });
});

router.get('/team/new', requireAuth, (req, res) => {
  res.render('admin/team-form', { member: { group_type: req.query.group || 'management' }, mode: 'new' });
});

router.post('/team', requireAuth, uploadImages.single('photo'), (req, res) => {
  const { group_type, name, role, bio, initials, display_order } = req.body;
  if (!name || !name.trim()) {
    if (req.file) unlinkPublic(`/uploads/${req.file.filename}`);
    flash(req, 'error', 'Name is required.');
    return res.redirect('/admin/team/new');
  }
  db.prepare(`
    INSERT INTO team_members (group_type, name, role, bio, initials, photo_path, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    TEAM_GROUPS.includes(group_type) ? group_type : 'management',
    name.trim(), role || null, bio || null, (initials || '').trim().slice(0, 3) || null,
    req.file ? `/uploads/${req.file.filename}` : null,
    display_order ? Number(display_order) : 0,
  );
  flash(req, 'success', 'Team member added.');
  res.redirect('/admin/team');
});

router.get('/team/:id/edit', requireAuth, (req, res) => {
  const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).send('Not found');
  res.render('admin/team-form', { member, mode: 'edit' });
});

router.post('/team/:id', requireAuth, uploadImages.single('photo'), (req, res) => {
  const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).send('Not found');
  const { group_type, name, role, bio, initials, display_order, remove_photo } = req.body;
  if (!name || !name.trim()) {
    if (req.file) unlinkPublic(`/uploads/${req.file.filename}`);
    flash(req, 'error', 'Name is required.');
    return res.redirect(`/admin/team/${req.params.id}/edit`);
  }
  let photoPath = member.photo_path;
  if (req.file) {
    unlinkPublic(member.photo_path);
    photoPath = `/uploads/${req.file.filename}`;
  } else if (remove_photo === 'on' && member.photo_path) {
    unlinkPublic(member.photo_path);
    photoPath = null;
  }
  db.prepare(`
    UPDATE team_members SET group_type = ?, name = ?, role = ?, bio = ?, initials = ?,
      photo_path = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    TEAM_GROUPS.includes(group_type) ? group_type : member.group_type,
    name.trim(), role || null, bio || null, (initials || '').trim().slice(0, 3) || null,
    photoPath, display_order ? Number(display_order) : 0, req.params.id,
  );
  flash(req, 'success', 'Team member updated.');
  res.redirect('/admin/team');
});

router.post('/team/:id/delete', requireAuth, (req, res) => {
  const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (member) unlinkPublic(member.photo_path);
  db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Team member removed.');
  res.redirect('/admin/team');
});

// ─────────────────────────────────────────────────────────────
// Partners
// ─────────────────────────────────────────────────────────────
const PARTNER_CATS = ['government', 'development', 'community'];

router.get('/partners', requireAuth, (req, res) => {
  const byCat = {};
  for (const c of PARTNER_CATS) {
    byCat[c] = db.prepare('SELECT * FROM partners WHERE category = ? ORDER BY display_order ASC, id ASC').all(c);
  }
  res.render('admin/partners', { byCat });
});

router.get('/partners/new', requireAuth, (req, res) => {
  res.render('admin/partner-form', { partner: { category: req.query.cat || 'government' }, mode: 'new' });
});

router.post('/partners', requireAuth, (req, res) => {
  const { category, name, description, display_order } = req.body;
  if (!name || !name.trim()) {
    flash(req, 'error', 'Name is required.');
    return res.redirect('/admin/partners/new');
  }
  db.prepare('INSERT INTO partners (category, name, description, display_order) VALUES (?, ?, ?, ?)').run(
    PARTNER_CATS.includes(category) ? category : 'government',
    name.trim(), description || null, display_order ? Number(display_order) : 0,
  );
  flash(req, 'success', 'Partner added.');
  res.redirect('/admin/partners');
});

router.get('/partners/:id/edit', requireAuth, (req, res) => {
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).send('Not found');
  res.render('admin/partner-form', { partner, mode: 'edit' });
});

router.post('/partners/:id', requireAuth, (req, res) => {
  const partner = db.prepare('SELECT id FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).send('Not found');
  const { category, name, description, display_order } = req.body;
  if (!name || !name.trim()) {
    flash(req, 'error', 'Name is required.');
    return res.redirect(`/admin/partners/${req.params.id}/edit`);
  }
  db.prepare(`
    UPDATE partners SET category = ?, name = ?, description = ?, display_order = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    PARTNER_CATS.includes(category) ? category : 'government',
    name.trim(), description || null, display_order ? Number(display_order) : 0, req.params.id,
  );
  flash(req, 'success', 'Partner updated.');
  res.redirect('/admin/partners');
});

router.post('/partners/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM partners WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Partner removed.');
  res.redirect('/admin/partners');
});

// ─────────────────────────────────────────────────────────────
// Content blocks (editable site text)
// ─────────────────────────────────────────────────────────────
const CONTENT_PAGES = [
  { id: 'home',         label: 'Home page' },
  { id: 'about',        label: 'About page' },
  { id: 'projects',     label: 'Projects page' },
  { id: 'publications', label: 'Publications page' },
  { id: 'contact',      label: 'Contact page' },
  { id: 'footer',       label: 'Footer' },
];

router.get('/content', requireAuth, (req, res) => {
  const page = req.query.page || 'home';
  const blocks = db.prepare('SELECT * FROM content_blocks WHERE page = ? ORDER BY display_order ASC').all(page);
  res.render('admin/content', { pages: CONTENT_PAGES, page, blocks });
});

router.post('/content', requireAuth, (req, res) => {
  const page = req.body.__page || 'home';
  const update = db.prepare('UPDATE content_blocks SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?');
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (key === '__page') continue;
      update.run(value, key);
    }
  });
  tx(Object.entries(req.body));
  flash(req, 'success', 'Content saved.');
  res.redirect(`/admin/content?page=${encodeURIComponent(page)}`);
});

// ─────────────────────────────────────────────────────────────
// Account — change password
// ─────────────────────────────────────────────────────────────
router.get('/account', requireAuth, (req, res) => {
  res.render('admin/account');
});

router.post('/account/password', requireAuth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !(await bcrypt.compare(current_password || '', user.password_hash))) {
    flash(req, 'error', 'Current password is incorrect.');
    return res.redirect('/admin/account');
  }
  if (!new_password || new_password.length < 8) {
    flash(req, 'error', 'New password must be at least 8 characters.');
    return res.redirect('/admin/account');
  }
  if (new_password !== confirm_password) {
    flash(req, 'error', 'New passwords do not match.');
    return res.redirect('/admin/account');
  }
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  flash(req, 'success', 'Password updated.');
  res.redirect('/admin/account');
});

router.get('/messages', requireAuth, (req, res) => {
  const messages = db.prepare(`
    SELECT *
    FROM contact_messages
    ORDER BY created_at DESC
  `).all();

  res.render('admin/messages', {
    pageTitle: 'Contact Messages',
    messages,
  });
});

router.post('/messages/:id/read', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE contact_messages
    SET is_read = 1
    WHERE id = ?
  `).run(req.params.id);

  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', requireAuth, (req, res) => {
  db.prepare(`
    DELETE FROM contact_messages
    WHERE id = ?
  `).run(req.params.id);

  res.redirect('/admin/messages');
});

module.exports = router;
