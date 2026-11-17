'use strict';
const { one, run, now, POSITIONS } = require('./db');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);

/** Wrap a route so thrown errors (sync or async) reach the error handler. */
const ah = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };

function str(v, { max = 200, min = 0, name = 'Value', required = false } = {}) {
  const s = v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length < min) throw bad(`${name} is too short.`);
  if (s.length > max) throw bad(`${name} must be ${max} characters or fewer.`);
  return s;
}
function int(v, { min = -Infinity, max = Infinity, name = 'Value', required = true } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}.`);
  return n;
}
function id(v, name = 'ID') { return int(v, { min: 1, name }); }
function bool(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'on'; }

const POSITION_ALIASES = {
  goalkeeper: 'Goalkeeper', gk: 'Goalkeeper', keeper: 'Goalkeeper', goalie: 'Goalkeeper',
  defender: 'Defender', def: 'Defender', df: 'Defender', defence: 'Defender', defense: 'Defender', back: 'Defender',
  midfielder: 'Midfielder', mid: 'Midfielder', mf: 'Midfielder', midfield: 'Midfielder', cm: 'Midfielder',
  forward: 'Forward', fwd: 'Forward', fw: 'Forward', striker: 'Forward', st: 'Forward', attacker: 'Forward', winger: 'Forward',
};
function position(v, { required = true, name = 'Position' } = {}) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === 'none' || s === '-') {
    if (required) throw bad(`${name} is required.`);
    return null;
  }
  const p = POSITION_ALIASES[s] || POSITIONS.find((x) => x.toLowerCase() === s);
  if (!p) throw bad(`${name} must be Goalkeeper, Defender, Midfielder or Forward.`);
  return p;
}

function audit(req, action, entity, entityId, details, seasonId) {
  const u = req && req.user ? req.user : (req && req.id ? req : null);
  run(`INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, season_id, details, ip)
       VALUES (?,?,?,?,?,?,?,?,?)`,
  now(), u ? u.id : null, u ? u.username : 'system', action, entity || null, entityId || null, seasonId || null,
  details ? JSON.stringify(details) : null, req && req.ip ? req.ip : null);
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function seasonOr404(seasonId) {
  const s = one('SELECT * FROM seasons WHERE id = ?', seasonId);
  if (!s) throw notFound('Season');
  return s;
}

module.exports = { HttpError, bad, notFound, ah, str, int, id, bool, position, audit, fmt, seasonOr404 };
