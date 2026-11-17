'use strict';
/** Super Administrator API. Every route here requires the admin role. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { one, all, run, tx, now } = require('../db');
const cfg = require('../config');
const sec = require('../security');
const S = require('../services/settings');
const A = require('../services/auction');
const P = require('../services/photos');
const B = require('../services/backup');
const X = require('../services/exporter');
const { parseImport } = require('../services/importer');
const { squadView, saveLineup } = require('./auction');
const { ah, bad, notFound, HttpError, str, int, id, bool, position, audit } = require('../util');

const r = express.Router();
r.use(sec.requireRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 } });
const cur = () => S.currentSeason();
const reason = (v) => str(v, { max: 300, min: 3, name: 'Reason', required: true });
const genPassword = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');

// ------------------------------------------------------------ dashboard

r.get('/dashboard', ah((_req, res) => {
  const season = cur();
  const st = S.get(season.id);
  const c = one(`SELECT COUNT(*) AS total, SUM(status='pending') AS pending, SUM(status='approved') AS approved, SUM(status='ready') AS ready,
                 SUM(status='bidding') AS bidding, SUM(status='sold') AS sold, SUM(status='pending_allocation') AS pending_allocation,
                 SUM(status='allocated') AS allocated, SUM(status='rejected') AS rejected, SUM(photo IS NULL AND status NOT IN ('rejected','withdrawn')) AS no_photo
                 FROM players WHERE season_id = ? AND status <> 'withdrawn'`, season.id);
  for (const k of Object.keys(c)) c[k] = c[k] || 0;
  const clubs = A.clubsFinance(season.id, st);
  const capacity = clubs.reduce((s, x) => s + x.open, 0);
  const toPlace = c.approved + c.ready + c.bidding + c.pending_allocation;
  const warnings = [];
  const noCaptain = clubs.filter((x) => !x.has_captain_account).map((x) => x.name);
  if (noCaptain.length) warnings.push(`${noCaptain.length} club(s) have no captain account yet.`);
  if (toPlace > capacity) warnings.push(`There are ${toPlace} approved players still to place but only ${capacity} squad places left. Increase the squad size or leave some players out of the auction list.`);
  if (c.no_photo) warnings.push(`${c.no_photo} registration(s) have no photograph.`);
  if (c.pending) warnings.push(`${c.pending} registration(s) are waiting for approval.`);
  res.json({
    season: { id: season.id, name: season.name, phase: season.phase },
    counts: { ...c, clubs: clubs.length },
    auction: A.getSession(season.id).status,
    clubs, capacity, warnings,
    recent: all('SELECT at, username, action, entity, entity_id, details FROM audit_log ORDER BY id DESC LIMIT 12'),
  });
}));

// ------------------------------------------------------------ players & registrations

function playerRow(p) {
  return { ...p, photo: undefined, has_photo: !!p.photo, photo_url: A.photoUrl(p.photo), thumb_url: A.photoUrl(p.photo, true) };
}

r.get('/players', ah((req, res) => {
  const season = cur();
  const rows = all(`SELECT p.*, sm.club_id, sm.price, sm.method, c.short_name AS club_short, c.name AS club_name, c.primary_color AS club_color
                    FROM players p
                    LEFT JOIN squad_members sm ON sm.player_id = p.id AND sm.active = 1
                    LEFT JOIN clubs c ON c.id = sm.club_id
                    WHERE p.season_id = ? ORDER BY p.created_at DESC, p.id DESC`, season.id);
  const captains = new Set(all('SELECT captain_player_id FROM season_clubs WHERE season_id = ? AND captain_player_id IS NOT NULL', season.id).map((x) => x.captain_player_id));
  res.set('Cache-Control', 'no-store').json(rows.map((p) => ({ ...playerRow(p), is_captain: captains.has(p.id) })));
}));

function readPlayerFields(body, partial = false) {
  const out = {};
  if (!partial || body.full_name !== undefined) out.full_name = str(body.full_name, { max: 80, min: 3, name: 'Full name', required: true });
  if (!partial || body.class_grade !== undefined) out.class_grade = str(body.class_grade, { max: 30, name: 'Class / Grade', required: true });
  if (!partial || body.primary_position !== undefined) out.primary_position = position(body.primary_position, { name: 'Preferred position' });
  if (!partial || body.secondary_position !== undefined) out.secondary_position = position(body.secondary_position, { required: false });
  if (body.admin_note !== undefined) out.admin_note = str(body.admin_note, { max: 500, name: 'Note' }) || null;
  return out;
}

r.post('/players', upload.single('photo'), ah(async (req, res) => {
  const season = cur();
  const f = readPlayerFields(req.body);
  if (f.secondary_position === f.primary_position) f.secondary_position = null;
  const status = ['pending', 'approved'].includes(req.body.status) ? req.body.status : 'approved';
  const key = req.file ? await P.savePlayerPhoto(req.file.buffer) : null;
  const t = now();
  const info = run(`INSERT INTO players (season_id, full_name, class_grade, primary_position, secondary_position, photo, status, source, confirmed, admin_note, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?, 'admin', 1, ?, ?, ?)`, season.id, f.full_name, f.class_grade, f.primary_position, f.secondary_position, key, status, f.admin_note || null, t, t);
  audit(req, 'player.create', 'player', Number(info.lastInsertRowid), { name: f.full_name }, season.id);
  res.json({ id: Number(info.lastInsertRowid) });
}));

r.put('/players/:id', ah((req, res) => {
  const pid = id(req.params.id);
  const p = one('SELECT * FROM players WHERE id = ?', pid);
  if (!p) throw notFound('Player');
  const f = readPlayerFields(req.body, true);
  const merged = { ...p, ...f };
  if (merged.secondary_position === merged.primary_position) merged.secondary_position = null;
  run(`UPDATE players SET full_name = ?, class_grade = ?, primary_position = ?, secondary_position = ?, admin_note = ?, updated_at = ? WHERE id = ?`,
    merged.full_name, merged.class_grade, merged.primary_position, merged.secondary_position, merged.admin_note, now(), pid);
  const changes = {};
  for (const k of Object.keys(f)) if (p[k] !== merged[k]) changes[k] = { from: p[k], to: merged[k] };
  audit(req, 'player.edit', 'player', pid, changes, p.season_id);
  if (['bidding', 'sold', 'allocated'].includes(p.status)) A.emitState(p.season_id);
  res.json({ ok: true });
}));

r.post('/players/:id/photo', upload.single('photo'), ah(async (req, res) => {
  const pid = id(req.params.id);
  const p = one('SELECT * FROM players WHERE id = ?', pid);
  if (!p) throw notFound('Player');
  if (!req.file) throw bad('Please choose a photograph.');
  const key = await P.savePlayerPhoto(req.file.buffer);
  run('UPDATE players SET photo = ?, updated_at = ? WHERE id = ?', key, now(), pid);
  P.removePlayerPhoto(p.photo);
  audit(req, 'player.photo', 'player', pid, null, p.season_id);
  if (p.status === 'bidding') A.emitState(p.season_id);
  res.json({ ok: true, photo_url: A.photoUrl(key), thumb_url: A.photoUrl(key, true) });
}));

const MANUAL_STATUSES = { pending: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', ready: 'Ready for Auction', withdrawn: 'Withdrawn' };
r.post('/players/status', ah((req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => id(x, 'Player'));
  const status = String(req.body.status || '');
  if (!MANUAL_STATUSES[status]) throw bad('Unknown status.');
  if (!ids.length) throw bad('Select at least one player.');
  const season = cur();
  const out = tx(() => {
    let changed = 0; const skipped = [];
    let order = one('SELECT COALESCE(MAX(auction_order), 0) AS n FROM players WHERE season_id = ?', season.id).n;
    for (const pid of ids) {
      const p = one('SELECT * FROM players WHERE id = ? AND season_id = ?', pid, season.id);
      if (!p) continue;
      if (['bidding', 'sold', 'allocated'].includes(p.status)) { skipped.push(`${p.full_name} (${p.status})`); continue; }
      if (status === 'ready' && !['approved', 'ready', 'pending_allocation'].includes(p.status)) { skipped.push(`${p.full_name} (not approved)`); continue; }
      if (status === 'ready' && !p.photo) { /* allowed, but flagged in the UI */ }
      run('UPDATE players SET status = ?, auction_order = ?, updated_at = ? WHERE id = ?', status,
        status === 'ready' ? (p.auction_order || ++order) : null, now(), pid);
      changed++;
    }
    audit(req, 'player.status', 'player', null, { ids, status, changed }, season.id);
    return { changed, skipped };
  });
  A.emitState(season.id);
  res.json(out);
}));

r.delete('/players/:id', ah((req, res) => {
  const pid = id(req.params.id);
  const p = one('SELECT * FROM players WHERE id = ?', pid);
  if (!p) throw notFound('Player');
  if (['bidding', 'sold', 'allocated'].includes(p.status)) throw bad('Remove this player from their club (Squad Management) before removing them.');
  const history = one('SELECT 1 FROM auction_lots WHERE player_id = ? LIMIT 1', pid) || one('SELECT 1 FROM squad_members WHERE player_id = ? LIMIT 1', pid)
    || one('SELECT 1 FROM match_events WHERE player_id = ? LIMIT 1', pid);
  if (history) {
    run("UPDATE players SET status = 'withdrawn', updated_at = ? WHERE id = ?", now(), pid);
    audit(req, 'player.withdraw', 'player', pid, { name: p.full_name }, p.season_id);
    return res.json({ ok: true, withdrawn: true });
  }
  run('UPDATE season_clubs SET captain_player_id = NULL WHERE captain_player_id = ?', pid);
  run('DELETE FROM players WHERE id = ?', pid);
  P.removePlayerPhoto(p.photo);
  audit(req, 'player.delete', 'player', pid, { name: p.full_name, class: p.class_grade }, p.season_id);
  res.json({ ok: true, deleted: true });
}));

r.get('/players/import-template', ah(async (req, res) => {
  const columns = [{ label: 'Full Name', key: 'a', width: 28 }, { label: 'Class / Grade', key: 'b', width: 14 },
    { label: 'Preferred Position', key: 'c', width: 20 }, { label: 'Secondary Position', key: 'd', width: 20 }];
  const rows = [{ a: 'Example Student', b: 'Grade 8', c: 'Midfielder', d: 'Defender' }];
  await X.sendTable(res, req.query.format === 'csv' ? 'csv' : 'xlsx', { filename: 'ols-registration-template', title: 'Registrations', columns, rows });
}));

r.post('/players/import', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Please choose a file.');
  const season = cur();
  const parsed = await parseImport(req.file.buffer, req.file.originalname || '');
  if (parsed.error) throw bad(parsed.error);
  const existing = new Set(all("SELECT lower(full_name) || '|' || lower(class_grade) AS k FROM players WHERE season_id = ? AND status NOT IN ('rejected','withdrawn')", season.id).map((x) => x.k));
  for (const row of parsed.rows) {
    const k = `${row.full_name.toLowerCase()}|${row.class_grade.toLowerCase()}`;
    if (existing.has(k)) row.errors.push('Already registered');
    existing.add(k);
  }
  if (bool(req.body.commit)) {
    const status = bool(req.body.approve) ? 'approved' : 'pending';
    const t = now();
    const n = tx(() => {
      let c = 0;
      for (const row of parsed.rows.filter((x) => !x.errors.length)) {
        run(`INSERT INTO players (season_id, full_name, class_grade, primary_position, secondary_position, status, source, confirmed, admin_note, created_at, updated_at)
             VALUES (?,?,?,?,?,?, 'import', 0, ?, ?, ?)`, season.id, row.full_name, row.class_grade, row.primary_position, row.secondary_position, status,
        row.photo_file ? `Photo file: ${row.photo_file}` : null, t, t);
        c++;
      }
      audit(req, 'player.import', 'player', null, { imported: c, status, file: req.file.originalname }, season.id);
      return c;
    });
    return res.json({ imported: n, skipped: parsed.rows.length - n });
  }
  res.json({ rows: parsed.rows });
}));

r.get('/players/export', ah(async (req, res) => {
  const season = cur();
  const rows = all(`SELECT p.*, c.name AS club FROM players p LEFT JOIN squad_members sm ON sm.player_id = p.id AND sm.active = 1
                    LEFT JOIN clubs c ON c.id = sm.club_id WHERE p.season_id = ? ORDER BY p.full_name`, season.id);
  await X.sendTable(res, req.query.format, {
    filename: `ols-players-${season.name}`, title: 'Registered Players', subtitle: season.name, rows,
    columns: [{ label: 'Full Name', key: 'full_name', width: 28, pdfWidth: 2.2 }, { label: 'Class / Grade', key: 'class_grade', pdfWidth: 1 },
      { label: 'Preferred Position', key: 'primary_position', pdfWidth: 1.2 }, { label: 'Secondary Position', key: 'secondary_position', pdfWidth: 1.2 },
      { label: 'Status', value: (p) => STATUS_LABEL[p.status], pdfWidth: 1.2 }, { label: 'Club', key: 'club', width: 22, pdfWidth: 1.6 },
      { label: 'Photo', value: (p) => (p.photo ? 'Yes' : 'No'), pdfWidth: 0.6 }],
  });
}));

const STATUS_LABEL = { pending: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', ready: 'Ready for Auction', bidding: 'Currently Bidding',
  sold: 'Sold', pending_allocation: 'Pending Allocation', allocated: 'Allocated', withdrawn: 'Withdrawn' };

// auction list ordering
r.post('/auction-list/order', ah((req, res) => {
  const season = cur();
  const mode = String(req.body.mode || 'shuffle');
  const ready = all("SELECT id, primary_position, full_name FROM players WHERE season_id = ? AND status = 'ready'", season.id);
  let ordered;
  if (Array.isArray(req.body.ids)) {
    const pos = new Map(req.body.ids.map((x, i) => [Number(x), i]));
    ordered = [...ready].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  } else if (mode === 'position') {
    const rank = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };
    ordered = [...ready].sort((a, b) => rank[a.primary_position] - rank[b.primary_position] || Math.random() - 0.5);
  } else if (mode === 'name') ordered = [...ready].sort((a, b) => a.full_name.localeCompare(b.full_name));
  else {
    ordered = [...ready];
    for (let i = ordered.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ordered[i], ordered[j]] = [ordered[j], ordered[i]]; }
  }
  tx(() => ordered.forEach((p, i) => run('UPDATE players SET auction_order = ? WHERE id = ?', i + 1, p.id)));
  audit(req, 'auction.order', 'season', season.id, { mode: Array.isArray(req.body.ids) ? 'manual' : mode, count: ordered.length }, season.id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------ clubs

r.get('/clubs', ah((_req, res) => {
  const season = cur();
  const fin = new Map(A.clubsFinance(season.id).map((c) => [c.id, c]));
  const rows = all(`SELECT c.*, sc.group_name, sc.captain_user_id, sc.captain_player_id, sc.budget_start, u.username AS captain_username,
                           u.display_name AS captain_display, p.full_name AS captain_player
                    FROM clubs c JOIN season_clubs sc ON sc.club_id = c.id AND sc.season_id = ?
                    LEFT JOIN users u ON u.id = sc.captain_user_id LEFT JOIN players p ON p.id = sc.captain_player_id
                    ORDER BY c.sort_order`, season.id);
  res.json(rows.map((c) => ({ ...c, logo_url: A.logoUrl(c), has_custom_logo: !!c.logo, finance: fin.get(c.id),
    achievements: all('SELECT a.*, s.name AS season_name FROM achievements a LEFT JOIN seasons s ON s.id = a.season_id WHERE club_id = ? ORDER BY id DESC', c.id) })));
}));

const COLOR = /^#[0-9a-fA-F]{6}$/;
r.put('/clubs/:id', ah((req, res) => {
  const cid = id(req.params.id);
  const c = one('SELECT * FROM clubs WHERE id = ?', cid);
  if (!c) throw notFound('Club');
  const f = {
    name: req.body.name !== undefined ? str(req.body.name, { max: 60, min: 3, name: 'Club name', required: true }) : c.name,
    short_name: req.body.short_name !== undefined ? str(req.body.short_name, { max: 20, name: 'Short name', required: true }) : c.short_name,
    primary_color: req.body.primary_color !== undefined ? String(req.body.primary_color) : c.primary_color,
    secondary_color: req.body.secondary_color !== undefined ? String(req.body.secondary_color) : c.secondary_color,
    motto: req.body.motto !== undefined ? str(req.body.motto, { max: 120, name: 'Motto' }) || null : c.motto,
    description: req.body.description !== undefined ? str(req.body.description, { max: 1500, name: 'Description' }) || null : c.description,
  };
  if (!COLOR.test(f.primary_color) || !COLOR.test(f.secondary_color)) throw bad('Colours must be hex values like #1B2A4A.');
  if (f.name !== c.name && one('SELECT 1 FROM clubs WHERE name = ? AND id <> ?', f.name, cid)) throw bad('Another club already has that name.');
  run('UPDATE clubs SET name = ?, short_name = ?, primary_color = ?, secondary_color = ?, motto = ?, description = ? WHERE id = ?',
    f.name, f.short_name, f.primary_color, f.secondary_color, f.motto, f.description, cid);
  const changes = {};
  for (const k of Object.keys(f)) if (c[k] !== f[k]) changes[k] = { from: c[k], to: f[k] };
  audit(req, 'club.edit', 'club', cid, changes);
  A.emitState(cur().id);
  res.json({ ok: true });
}));

r.post('/clubs/:id/logo', upload.single('logo'), ah(async (req, res) => {
  const cid = id(req.params.id);
  const c = one('SELECT * FROM clubs WHERE id = ?', cid);
  if (!c) throw notFound('Club');
  if (!req.file) throw bad('Please choose a logo file.');
  const key = await P.saveClubLogo(req.file.buffer);
  run('UPDATE clubs SET logo = ? WHERE id = ?', key, cid);
  audit(req, 'club.logo', 'club', cid);
  A.emitState(cur().id);
  res.json({ ok: true, logo_url: `/media/club/${key}.png` });
}));
r.delete('/clubs/:id/logo', ah((req, res) => {
  const cid = id(req.params.id);
  run('UPDATE clubs SET logo = NULL WHERE id = ?', cid);
  audit(req, 'club.logo_reset', 'club', cid);
  A.emitState(cur().id);
  res.json({ ok: true });
}));

r.post('/clubs/:id/budget', ah((req, res) => {
  const amount = int(req.body.amount, { min: -10000000, max: 10000000, name: 'Amount' });
  if (!amount) throw bad('Enter a non-zero amount.');
  res.json(A.adjustBudget(req, id(req.params.id), amount, reason(req.body.reason)));
}));

r.post('/achievements', ah((req, res) => {
  const cid = id(req.body.club_id, 'Club');
  const sid = req.body.season_id ? id(req.body.season_id, 'Season') : null;
  const info = run('INSERT INTO achievements (club_id, season_id, title, description, awarded_on, created_at) VALUES (?,?,?,?,?,?)',
    cid, sid, str(req.body.title, { max: 120, name: 'Title', required: true }), str(req.body.description, { max: 500 }) || null,
    req.body.awarded_on ? str(req.body.awarded_on, { max: 10 }) : null, now());
  audit(req, 'achievement.add', 'club', cid, { title: req.body.title });
  res.json({ id: Number(info.lastInsertRowid) });
}));
r.delete('/achievements/:id', ah((req, res) => {
  const a = one('SELECT * FROM achievements WHERE id = ?', id(req.params.id));
  if (!a) throw notFound('Achievement');
  run('DELETE FROM achievements WHERE id = ?', a.id);
  audit(req, 'achievement.delete', 'club', a.club_id, { title: a.title });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ captains

function setCaptainPlayer(req, season, clubId, playerId) {
  const st = S.get(season.id);
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, clubId);
  if (sc.captain_player_id === playerId) return;
  if (playerId) {
    const p = one('SELECT * FROM players WHERE id = ? AND season_id = ?', playerId, season.id);
    if (!p) throw notFound('Player');
    const other = one('SELECT club_id FROM season_clubs WHERE season_id = ? AND captain_player_id = ?', season.id, playerId);
    if (other) throw bad(`${p.full_name} is already captain of another club.`);
    const member = one('SELECT * FROM squad_members WHERE season_id = ? AND player_id = ? AND active = 1', season.id, playerId);
    if (member && member.club_id !== clubId) throw bad(`${p.full_name} already plays for another club.`);
    if (!member && !st.captainsInAuction) {
      if (!['approved', 'ready', 'pending_allocation', 'pending'].includes(p.status)) throw bad(`${p.full_name} cannot be assigned (status: ${p.status}).`);
      A.addMember(req, season.id, { playerId, clubId, price: 0, method: 'captain', reason: 'Club captain' });
    }
  }
  // release the previous captain's automatic squad place
  if (sc.captain_player_id) {
    const old = one("SELECT * FROM squad_members WHERE season_id = ? AND player_id = ? AND active = 1 AND method = 'captain'", season.id, sc.captain_player_id);
    if (old) {
      run('UPDATE squad_members SET active = 0, removed_at = ?, removed_by = ?, removed_reason = ? WHERE id = ?', now(), req.user.id, 'Captain changed', old.id);
      run("UPDATE players SET status = 'approved', updated_at = ? WHERE id = ?", now(), old.player_id);
    }
  }
  run('UPDATE season_clubs SET captain_player_id = ? WHERE season_id = ? AND club_id = ?', playerId || null, season.id, clubId);
  audit(req, 'captain.player', 'club', clubId, { player: playerId || null, previous: sc.captain_player_id }, season.id);
}

r.get('/captains', ah((_req, res) => {
  const season = cur();
  res.json(all(`SELECT c.id AS club_id, c.name AS club_name, c.slug, c.logo, c.primary_color, sc.captain_user_id, sc.captain_player_id,
                        u.username, u.display_name, u.active, u.last_login_at, p.full_name AS captain_player, p.class_grade AS captain_class
                 FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id
                 LEFT JOIN users u ON u.id = sc.captain_user_id LEFT JOIN players p ON p.id = sc.captain_player_id
                 WHERE sc.season_id = ? ORDER BY c.sort_order`, season.id).map((x) => ({ ...x, logo_url: A.logoUrl(x) })));
}));

r.post('/captains', ah(async (req, res) => {
  const season = cur();
  const clubId = id(req.body.club_id, 'Club');
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, clubId);
  if (!sc) throw notFound('Club');
  if (sc.captain_user_id) throw bad('This club already has a captain account. Edit it instead.');
  const username = str(req.body.username, { max: 40, min: 3, name: 'Username', required: true }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw bad('Usernames may use letters, numbers, dots, dashes and underscores only.');
  const password = req.body.password ? String(req.body.password) : genPassword();
  const problem = sec.passwordProblem(password);
  if (problem) throw bad(problem);
  let userId;
  const existing = one('SELECT * FROM users WHERE username = ?', username);
  if (existing) {
    if (existing.role !== 'captain') throw bad('That username is already used by a non-captain account.');
    if (one('SELECT 1 FROM season_clubs WHERE season_id = ? AND captain_user_id = ?', season.id, existing.id)) throw bad('That captain account is already linked to another club.');
    userId = existing.id;
    run('UPDATE users SET password_hash = ?, display_name = ?, active = 1 WHERE id = ?', await sec.hashPassword(password),
      str(req.body.display_name, { max: 60 }) || existing.display_name, userId);
  } else {
    const club = one('SELECT name FROM clubs WHERE id = ?', clubId);
    const info = run(`INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?, 'captain', ?)`,
      username, str(req.body.display_name, { max: 60 }) || `${club.name} Captain`, await sec.hashPassword(password), now());
    userId = Number(info.lastInsertRowid);
  }
  tx(() => {
    run('UPDATE season_clubs SET captain_user_id = ? WHERE season_id = ? AND club_id = ?', userId, season.id, clubId);
    if (req.body.player_id) setCaptainPlayer(req, season, clubId, id(req.body.player_id, 'Player'));
    audit(req, 'captain.create', 'club', clubId, { username }, season.id);
  });
  A.emitState(season.id);
  res.json({ ok: true, username, password });
}));

r.put('/captains/:clubId', ah(async (req, res) => {
  const season = cur();
  const clubId = id(req.params.clubId, 'Club');
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, clubId);
  if (!sc) throw notFound('Club');
  let newPassword = null;
  if (sc.captain_user_id) {
    if (req.body.display_name !== undefined) run('UPDATE users SET display_name = ? WHERE id = ?', str(req.body.display_name, { max: 60, required: true, name: 'Display name' }), sc.captain_user_id);
    if (req.body.active !== undefined) {
      run('UPDATE users SET active = ? WHERE id = ?', bool(req.body.active) ? 1 : 0, sc.captain_user_id);
      if (!bool(req.body.active)) sec.destroyUserSessions(sc.captain_user_id);
    }
    if (req.body.reset_password) {
      newPassword = req.body.password ? String(req.body.password) : genPassword();
      const problem = sec.passwordProblem(newPassword);
      if (problem) throw bad(problem);
      run('UPDATE users SET password_hash = ? WHERE id = ?', await sec.hashPassword(newPassword), sc.captain_user_id);
      sec.destroyUserSessions(sc.captain_user_id);
      audit(req, 'captain.password_reset', 'club', clubId, null, season.id);
    }
  }
  if (req.body.player_id !== undefined) tx(() => setCaptainPlayer(req, season, clubId, req.body.player_id ? id(req.body.player_id, 'Player') : null));
  A.emitState(season.id);
  res.json({ ok: true, password: newPassword });
}));

r.delete('/captains/:clubId', ah((req, res) => {
  const season = cur();
  const clubId = id(req.params.clubId, 'Club');
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, clubId);
  if (!sc || !sc.captain_user_id) throw notFound('Captain account');
  run('UPDATE season_clubs SET captain_user_id = NULL WHERE season_id = ? AND club_id = ?', season.id, clubId);
  sec.destroyUserSessions(sc.captain_user_id);
  audit(req, 'captain.unlink', 'club', clubId, { user: sc.captain_user_id }, season.id);
  A.emitState(season.id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------ squads

r.get('/squads', ah((_req, res) => {
  const season = cur();
  res.json(all('SELECT club_id FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id WHERE season_id = ? ORDER BY c.sort_order', season.id)
    .map((x) => squadView(season.id, x.club_id)));
}));
r.put('/squads/:clubId/lineup', ah((req, res) => res.json(saveLineup(req, cur().id, id(req.params.clubId, 'Club'), req.body))));
r.post('/squads/allocate', ah((req, res) => res.json(A.allocate(req, {
  playerId: id(req.body.player_id, 'Player'), clubId: id(req.body.club_id, 'Club'),
  price: int(req.body.price ?? 0, { min: 0, name: 'Price' }), reason: reason(req.body.reason),
}))));
r.post('/squads/reverse', ah((req, res) => res.json(A.reverseSale(req, id(req.body.member_id, 'Squad record'), {
  reason: reason(req.body.reason), returnTo: ['ready', 'pending_allocation', 'approved'].includes(req.body.return_to) ? req.body.return_to : 'pending_allocation',
}))));
r.post('/squads/move', ah((req, res) => res.json(A.moveMember(req, id(req.body.member_id, 'Squad record'), {
  toClubId: id(req.body.to_club_id, 'Club'), reason: reason(req.body.reason),
}))));
r.post('/squads/distribute', ah((req, res) => res.json({ allocated: A.autoDistribute(req) })));

// ------------------------------------------------------------ auction history & audit

r.get('/auction/history', ah((_req, res) => {
  const season = cur();
  const lots = all(`SELECT l.id, l.sequence_no, l.round, l.status, l.starting_bid, l.highest_bid, l.leading_club_id, l.created_at, l.closed_at,
                           p.id AS player_id, p.full_name, p.class_grade, p.primary_position, p.secondary_position,
                           c.name AS club_name, c.short_name AS club_short, c.primary_color AS club_color,
                           (SELECT COUNT(*) FROM bids b WHERE b.lot_id = l.id AND b.status = 'accepted') AS bids
                    FROM auction_lots l JOIN players p ON p.id = l.player_id LEFT JOIN clubs c ON c.id = l.leading_club_id
                    WHERE l.season_id = ? ORDER BY l.id DESC`, season.id);
  const manual = all(`SELECT sm.id, sm.price, sm.method, sm.created_at, sm.active, sm.removed_reason, p.id AS player_id, p.full_name, p.class_grade,
                             p.primary_position, c.name AS club_name, c.short_name AS club_short, c.primary_color AS club_color, u.username
                      FROM squad_members sm JOIN players p ON p.id = sm.player_id JOIN clubs c ON c.id = sm.club_id LEFT JOIN users u ON u.id = sm.created_by
                      WHERE sm.season_id = ? AND sm.method <> 'auction' ORDER BY sm.id DESC`, season.id);
  res.set('Cache-Control', 'no-store').json({ lots, manual });
}));
r.get('/auction/lots/:id', ah((req, res) => {
  const lot = one('SELECT * FROM auction_lots WHERE id = ?', id(req.params.id));
  if (!lot) throw notFound('Lot');
  res.json({ lot, bids: all(`SELECT b.*, c.short_name AS club_short, u.username FROM bids b JOIN clubs c ON c.id = b.club_id JOIN users u ON u.id = b.user_id
                             WHERE b.lot_id = ? ORDER BY b.id`, lot.id) });
}));
r.get('/audit', ah((req, res) => {
  const q = `%${String(req.query.q || '').slice(0, 60)}%`;
  res.json(all(`SELECT * FROM audit_log WHERE (action LIKE ? OR username LIKE ? OR details LIKE ?) ORDER BY id DESC LIMIT 500`, q, q, q));
}));

// ------------------------------------------------------------ seasons

r.get('/seasons', ah((_req, res) => {
  res.json(all(`SELECT s.id, s.name, s.phase, s.is_current, s.created_at, s.completed_at,
                       (SELECT COUNT(*) FROM players p WHERE p.season_id = s.id AND p.status <> 'withdrawn') AS players,
                       (SELECT COUNT(*) FROM fixtures f WHERE f.season_id = s.id) AS fixtures
                FROM seasons s ORDER BY s.id DESC`));
}));
r.post('/seasons', ah((req, res) => {
  const name = str(req.body.name, { max: 60, min: 3, name: 'Season name', required: true });
  if (one('SELECT 1 FROM seasons WHERE name = ?', name)) throw bad('A season with that name already exists.');
  const prev = cur();
  const base = bool(req.body.copy_settings) ? { ...S.get(prev.id) } : { ...S.DEFAULT_SETTINGS };
  Object.assign(base, { registrationOpen: true, publicSquads: false, publicPhotos: false });
  const sid = tx(() => {
    const info = run('INSERT INTO seasons (name, is_current, phase, settings, created_at) VALUES (?, 0, ?, ?, ?)', name, 'registration', JSON.stringify(base), now());
    const newId = Number(info.lastInsertRowid);
    for (const c of all('SELECT id FROM clubs ORDER BY sort_order')) run('INSERT INTO season_clubs (season_id, club_id, budget_start) VALUES (?,?,?)', newId, c.id, base.budget);
    run("INSERT INTO auction_sessions (season_id, status) VALUES (?, 'not_started')", newId);
    if (bool(req.body.make_current)) {
      run('UPDATE seasons SET is_current = 0');
      run('UPDATE seasons SET is_current = 1 WHERE id = ?', newId);
      if (prev.phase !== 'completed') run("UPDATE seasons SET phase = 'completed', completed_at = ? WHERE id = ?", now(), prev.id);
    }
    audit(req, 'season.create', 'season', newId, { name, make_current: bool(req.body.make_current) }, newId);
    return newId;
  });
  A.emitState(cur().id);
  res.json({ id: sid });
}));
r.put('/seasons/:id', ah((req, res) => {
  const s = one('SELECT * FROM seasons WHERE id = ?', id(req.params.id));
  if (!s) throw notFound('Season');
  const name = req.body.name !== undefined ? str(req.body.name, { max: 60, min: 3, name: 'Season name', required: true }) : s.name;
  const phase = req.body.phase !== undefined ? String(req.body.phase) : s.phase;
  if (!['setup', 'registration', 'auction', 'league', 'completed'].includes(phase)) throw bad('Unknown phase.');
  run('UPDATE seasons SET name = ?, phase = ?, completed_at = CASE WHEN ? = \'completed\' THEN COALESCE(completed_at, ?) ELSE NULL END WHERE id = ?',
    name, phase, phase, now(), s.id);
  audit(req, 'season.edit', 'season', s.id, { name, phase }, s.id);
  res.json({ ok: true });
}));
r.post('/seasons/:id/make-current', ah((req, res) => {
  const s = one('SELECT * FROM seasons WHERE id = ?', id(req.params.id));
  if (!s) throw notFound('Season');
  const active = A.activeLot(cur().id);
  if (active) throw bad('A player is currently on the auction block. Finish that first.');
  tx(() => { run('UPDATE seasons SET is_current = 0'); run('UPDATE seasons SET is_current = 1 WHERE id = ?', s.id); });
  audit(req, 'season.make_current', 'season', s.id, null, s.id);
  A.emitState(s.id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------ users

r.get('/users', ah((_req, res) => {
  const season = cur();
  res.json(all(`SELECT u.id, u.username, u.display_name, u.role, u.permissions, u.active, u.created_at, u.last_login_at, u.must_change_password,
                       c.name AS club_name
                FROM users u LEFT JOIN season_clubs sc ON sc.captain_user_id = u.id AND sc.season_id = ? LEFT JOIN clubs c ON c.id = sc.club_id
                ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'operator' THEN 1 WHEN 'projector' THEN 2 ELSE 3 END, u.username`, season.id)
    .map((u) => ({ ...u, permissions: u.permissions ? u.permissions.split(',').filter(Boolean) : [] })));
}));
const cleanPerms = (list) => (Array.isArray(list) ? list : []).filter((p) => sec.PERMISSIONS[p]).join(',');
r.post('/users', ah(async (req, res) => {
  const username = str(req.body.username, { max: 40, min: 3, name: 'Username', required: true }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw bad('Usernames may use letters, numbers, dots, dashes and underscores only.');
  if (one('SELECT 1 FROM users WHERE username = ?', username)) throw bad('That username is taken.');
  const role = String(req.body.role);
  if (!['admin', 'operator', 'projector', 'captain'].includes(role)) throw bad('Unknown role.');
  const password = req.body.password ? String(req.body.password) : genPassword();
  const problem = sec.passwordProblem(password);
  if (problem) throw bad(problem);
  const info = run(`INSERT INTO users (username, display_name, password_hash, role, permissions, must_change_password, created_at) VALUES (?,?,?,?,?,?,?)`,
    username, str(req.body.display_name, { max: 60, name: 'Display name' }) || username, await sec.hashPassword(password), role,
    role === 'operator' ? cleanPerms(req.body.permissions) : '', role === 'admin' ? 1 : 0, now());
  audit(req, 'user.create', 'user', Number(info.lastInsertRowid), { username, role });
  res.json({ id: Number(info.lastInsertRowid), username, password });
}));
r.put('/users/:id', ah((req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', id(req.params.id));
  if (!u) throw notFound('User');
  const display = req.body.display_name !== undefined ? str(req.body.display_name, { max: 60, required: true, name: 'Display name' }) : u.display_name;
  const active = req.body.active !== undefined ? (bool(req.body.active) ? 1 : 0) : u.active;
  const perms = req.body.permissions !== undefined && u.role === 'operator' ? cleanPerms(req.body.permissions) : u.permissions;
  if (u.id === req.user.id && !active) throw bad('You cannot disable your own account.');
  if (u.role === 'admin' && !active && one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n <= 1) throw bad('At least one administrator must remain active.');
  run('UPDATE users SET display_name = ?, active = ?, permissions = ? WHERE id = ?', display, active, perms, u.id);
  if (!active) sec.destroyUserSessions(u.id);
  audit(req, 'user.edit', 'user', u.id, { display_name: display, active, permissions: perms });
  res.json({ ok: true });
}));
r.post('/users/:id/reset-password', ah(async (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', id(req.params.id));
  if (!u) throw notFound('User');
  const password = req.body.password ? String(req.body.password) : genPassword();
  const problem = sec.passwordProblem(password);
  if (problem) throw bad(problem);
  run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', await sec.hashPassword(password), u.role === 'admin' ? 1 : 0, u.id);
  if (u.id !== req.user.id) sec.destroyUserSessions(u.id);
  audit(req, 'user.password_reset', 'user', u.id);
  res.json({ ok: true, password });
}));

// ------------------------------------------------------------ settings, announcements, backups

r.get('/settings', ah((_req, res) => {
  const season = cur();
  res.json({ season: { id: season.id, name: season.name, phase: season.phase }, settings: S.get(season.id), defaults: S.DEFAULT_SETTINGS,
    permissions: sec.PERMISSIONS, version: cfg.APP_VERSION, backups: B.list().slice(0, 10), auction: A.getSession(season.id).status,
    sales: one('SELECT COUNT(*) AS n FROM squad_members WHERE season_id = ? AND active = 1 AND price > 0', season.id).n });
}));

r.put('/settings', ah((req, res) => {
  const season = cur();
  const { clean, errors } = S.validate(req.body || {});
  if (errors.length) throw bad(errors.join(' '));
  const before = S.get(season.id);
  const sales = one('SELECT COUNT(*) AS n FROM squad_members WHERE season_id = ? AND active = 1 AND price > 0', season.id).n;
  if (clean.budget !== undefined && clean.budget !== before.budget) {
    if (sales) throw bad('Purchases have already been made. Use a budget adjustment in Club Management instead of changing the starting budget.');
  }
  if (clean.squadSize !== undefined) {
    const biggest = Math.max(0, ...A.clubsFinance(season.id, before).map((c) => c.count));
    if (clean.squadSize < biggest) throw bad(`A club already has ${biggest} players, so the squad size cannot be lower than that.`);
  }
  if (A.activeLot(season.id) && ['startingBid', 'minIncrement', 'timerSeconds'].some((k) => clean[k] !== undefined && clean[k] !== before[k])) {
    throw bad('Change bidding settings between players, not while a player is on the block.');
  }
  const saved = tx(() => {
    const out = S.save(season.id, clean);
    if (clean.budget !== undefined && clean.budget !== before.budget) run('UPDATE season_clubs SET budget_start = ? WHERE season_id = ?', clean.budget, season.id);
    const diff = {};
    for (const k of Object.keys(clean)) if (before[k] !== clean[k]) diff[k] = { from: before[k], to: clean[k] };
    audit(req, 'settings.update', 'season', season.id, diff, season.id);
    return out;
  });
  A.emitState(season.id);
  res.json(saved);
}));

r.get('/announcements', ah((_req, res) => res.json(all('SELECT * FROM announcements ORDER BY id DESC LIMIT 100'))));
r.post('/announcements', ah((req, res) => {
  const info = run('INSERT INTO announcements (season_id, title, body, published, pinned, created_at, created_by) VALUES (?,?,?,?,?,?,?)',
    cur().id, str(req.body.title, { max: 120, name: 'Title', required: true }), str(req.body.body, { max: 3000, name: 'Message', required: true }),
    bool(req.body.published) ? 1 : 0, bool(req.body.pinned) ? 1 : 0, now(), req.user.id);
  audit(req, 'announcement.create', 'announcement', Number(info.lastInsertRowid));
  res.json({ id: Number(info.lastInsertRowid) });
}));
r.put('/announcements/:id', ah((req, res) => {
  const a = one('SELECT * FROM announcements WHERE id = ?', id(req.params.id));
  if (!a) throw notFound('Announcement');
  run('UPDATE announcements SET title = ?, body = ?, published = ?, pinned = ? WHERE id = ?',
    req.body.title !== undefined ? str(req.body.title, { max: 120, required: true, name: 'Title' }) : a.title,
    req.body.body !== undefined ? str(req.body.body, { max: 3000, required: true, name: 'Message' }) : a.body,
    req.body.published !== undefined ? (bool(req.body.published) ? 1 : 0) : a.published,
    req.body.pinned !== undefined ? (bool(req.body.pinned) ? 1 : 0) : a.pinned, a.id);
  audit(req, 'announcement.edit', 'announcement', a.id);
  res.json({ ok: true });
}));
r.delete('/announcements/:id', ah((req, res) => {
  run('DELETE FROM announcements WHERE id = ?', id(req.params.id));
  audit(req, 'announcement.delete', 'announcement', Number(req.params.id));
  res.json({ ok: true });
}));

r.post('/backups', ah(async (req, res) => {
  const dir = await B.createBackup('manual');
  audit(req, 'backup.create', null, null, { dir: path.basename(dir) });
  res.json({ ok: true, name: path.basename(dir) });
}));
r.get('/backups/:name/download', ah((req, res) => {
  const name = String(req.params.name);
  if (!/^backup-[\w-]+$/.test(name)) throw notFound('Backup');
  const file = path.join(cfg.BACKUP_DIR, name, 'ols-premier-league.db');
  if (!fs.existsSync(file)) throw notFound('Backup');
  audit(req, 'backup.download', null, null, { name });
  res.download(file, `${name}.db`);
}));

module.exports = r;
module.exports.STATUS_LABEL = STATUS_LABEL;
