'use strict';
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { one, run, now } = require('../db');
const sec = require('../security');
const { ah, bad, audit, str } = require('../util');
const S = require('../services/settings');
const A = require('../services/auction');

const r = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String((req.body && req.body.username) || '').toLowerCase()}`,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

// constant-time-ish failure path: always run bcrypt even if the user does not exist
const DUMMY_HASH = require('bcryptjs').hashSync('not-a-real-password', 11);

function meta(user) {
  const out = { user, home: sec.ROLE_HOME[user.role] };
  if (user.role === 'captain') {
    const season = S.currentSeason();
    const clubId = A.captainClub(user.id, season.id);
    out.club_id = clubId;
  }
  return out;
}

r.post('/login', loginLimiter, ah(async (req, res) => {
  const username = str(req.body.username, { max: 60, name: 'Username', required: true });
  const password = String(req.body.password || '');
  const u = one('SELECT * FROM users WHERE username = ?', username);
  const ok = await sec.verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.active) {
    audit(req, 'auth.login_failed', 'user', u ? u.id : null, { username });
    throw bad(u && !u.active ? 'This account has been disabled.' : 'Incorrect username or password.');
  }
  const s = sec.createSession(u, req);
  sec.setSessionCookie(res, s.token, s.maxAge);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), u.id);
  audit({ user: u, ip: req.ip }, 'auth.login', 'user', u.id);
  const user = { id: u.id, username: u.username, display_name: u.display_name, role: u.role,
    permissions: u.permissions ? u.permissions.split(',').filter(Boolean) : [], must_change_password: !!u.must_change_password };
  res.json({ ...meta(user), csrf: s.csrf });
}));

r.post('/logout', (req, res) => {
  sec.destroySession(req);
  sec.clearSessionCookie(res);
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.json({ user: null });
  res.json({ ...meta(req.user), csrf: req.session.csrf });
});

r.post('/password', sec.requireAuth, ah(async (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await sec.verifyPassword(String(req.body.current || ''), u.password_hash))) throw bad('Your current password is incorrect.');
  const pw = String(req.body.password || '');
  const problem = sec.passwordProblem(pw);
  if (problem) throw bad(problem);
  if (pw === String(req.body.current)) throw bad('Please choose a new password that is different from the current one.');
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await sec.hashPassword(pw), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', u.id, req.session.sid);
  audit(req, 'auth.password_changed', 'user', u.id);
  res.json({ ok: true });
}));

module.exports = r;
