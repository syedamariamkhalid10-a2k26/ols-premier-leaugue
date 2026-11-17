'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const cfg = require('./config');
const { one, run } = require('./db');

const COOKIE_NAME = 'olspl_sid';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const ROLE_HOME = { admin: '/admin', operator: '/operator', captain: '/captain', projector: '/projector' };
const PERMISSIONS = {
  'auction.correct': 'Undo accidental bids and cancel a presented player',
  'auction.allocate': 'Allocate unsold players to clubs',
};

async function hashPassword(pw) { return bcrypt.hash(pw, 11); }
async function verifyPassword(pw, hash) { return bcrypt.compare(pw, hash); }

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ms = user.role === 'projector' ? cfg.PROJECTOR_SESSION_DAYS * 86400000 : cfg.SESSION_HOURS * 3600000;
  const created = Date.now();
  run('INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)',
    sha256(token), user.id, csrf, created, created + ms, req.ip, String(req.get('user-agent') || '').slice(0, 200));
  run('DELETE FROM sessions WHERE expires_at < ?', created);
  return { token, csrf, maxAge: ms };
}

function setSessionCookie(res, token, maxAge) {
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: cfg.COOKIE_SECURE, maxAge, path: '/' });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: cfg.COOKIE_SECURE, path: '/' });
}

function sessionFromToken(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const row = one(`SELECT s.id AS sid, s.csrf, s.expires_at, u.id, u.username, u.display_name, u.role, u.permissions,
                          u.active, u.must_change_password
                   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  const user = {
    id: row.id, username: row.username, display_name: row.display_name, role: row.role,
    permissions: row.permissions ? row.permissions.split(',').filter(Boolean) : [],
    must_change_password: !!row.must_change_password,
  };
  return { sid: row.sid, csrf: row.csrf, user };
}

function tokenFromCookieHeader(header) {
  if (!header) return null;
  try { return cookie.parseCookie(header)[COOKIE_NAME] || null; } catch { return null; }
}

function attachUser(req, _res, next) {
  const s = sessionFromToken(tokenFromCookieHeader(req.headers.cookie));
  req.session = s;
  req.user = s ? s.user : null;
  next();
}

function destroySession(req) {
  if (req.session) run('DELETE FROM sessions WHERE id = ?', req.session.sid);
}
function destroyUserSessions(userId) { run('DELETE FROM sessions WHERE user_id = ?', userId); }

function hasPerm(user, perm) {
  return !!user && (user.role === 'admin' || user.permissions.includes(perm));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this.' });
    if (req.user.must_change_password && !req.path.startsWith('/password')) {
      return res.status(403).json({ error: 'Please change your password first.', code: 'must_change_password' });
    }
    next();
  };
}
function requirePerm(perm) {
  return (req, res, next) => {
    if (!hasPerm(req.user, perm)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

/** Double-submit protection for state-changing requests made with a session cookie. */
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.session) return next();
  const sent = req.get('x-csrf-token');
  if (!sent || sent.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf))) {
    return res.status(403).json({ error: 'Your session token is out of date. Please reload the page.' });
  }
  next();
}

module.exports = {
  COOKIE_NAME, ROLE_HOME, PERMISSIONS, hashPassword, verifyPassword, passwordProblem, createSession, setSessionCookie,
  clearSessionCookie, sessionFromToken, tokenFromCookieHeader, attachUser, destroySession, destroyUserSessions,
  hasPerm, requireAuth, requireRole, requirePerm, csrfProtect,
};
