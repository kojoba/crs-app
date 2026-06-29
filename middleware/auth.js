

// Guards admin routes. Redirects to /admin/login if not authenticated.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  // For API-style requests, send 401 JSON; otherwise redirect.
  if (req.path.startsWith('/api') || req.xhr) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAuth };
