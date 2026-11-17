'use strict';
/** Tournament administration: groups, fixtures, results, standings, statistics. */
const express = require('express');
const crypto = require('crypto');
const { one, all, run, tx, now } = require('../db');
const sec = require('../security');
const S = require('../services/settings');
const T = require('../services/standings');
const A = require('../services/auction');
const { ah, bad, notFound, str, int, id, bool, audit } = require('../util');

const r = express.Router();
r.use(sec.requireRole('admin'));
const cur = () => S.currentSeason();
const STAGES = ['group', 'semi', 'final', 'third_place', 'friendly'];

function dt(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(s)) throw bad('Use a valid date and time.');
  return s.slice(0, 16);
}

r.get('/fixtures', ah((_req, res) => {
  const season = cur();
  const groups = all(`SELECT c.id, c.name, c.short_name, c.slug, c.logo, c.primary_color, sc.group_name FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id
                      WHERE sc.season_id = ? ORDER BY c.sort_order`, season.id).map((c) => ({ ...c, logo_url: A.logoUrl(c) }));
  res.set('Cache-Control', 'no-store').json({ fixtures: T.fixturesWithClubs(season.id), clubs: groups });
}));

r.post('/groups', ah((req, res) => {
  const season = cur();
  if (one("SELECT 1 FROM fixtures WHERE season_id = ? AND stage = 'group' AND status = 'completed'", season.id)) throw bad('Group results already exist. Groups can no longer be changed.');
  const clubs = all('SELECT club_id FROM season_clubs WHERE season_id = ?', season.id).map((c) => c.club_id);
  let assign = {};
  if (bool(req.body.random)) {
    const shuffled = [...clubs];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    shuffled.forEach((c, i) => { assign[c] = i < shuffled.length / 2 ? 'A' : 'B'; });
  } else assign = req.body.assignments || {};
  const vals = clubs.map((c) => (assign[c] === 'A' || assign[c] === 'B' ? assign[c] : null));
  const a = vals.filter((v) => v === 'A').length; const b = vals.filter((v) => v === 'B').length;
  if (a !== 4 || b !== 4) throw bad('Each group needs exactly four clubs.');
  tx(() => {
    clubs.forEach((c, i) => run('UPDATE season_clubs SET group_name = ? WHERE season_id = ? AND club_id = ?', vals[i], season.id, c));
    audit(req, 'groups.set', 'season', season.id, { assign, random: bool(req.body.random) }, season.id);
  });
  res.json({ ok: true });
}));

r.post('/fixtures/generate-groups', ah((req, res) => {
  const season = cur();
  if (one("SELECT 1 FROM fixtures WHERE season_id = ? AND stage = 'group'", season.id)) throw bad('Group fixtures already exist. Delete them first to regenerate.');
  const start = req.body.start ? new Date(dt(req.body.start)) : null;
  const gapDays = int(req.body.gap_days ?? 1, { min: 0, max: 30, name: 'Days between rounds' });
  const perDay = int(req.body.per_day ?? 4, { min: 1, max: 12, name: 'Matches per day' });
  const created = tx(() => {
    let n = 0;
    for (const g of ['A', 'B']) {
      const ids = all('SELECT sc.club_id FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id WHERE sc.season_id = ? AND sc.group_name = ? ORDER BY c.sort_order', season.id, g).map((x) => x.club_id);
      if (ids.length !== 4) throw bad(`Group ${g} needs four clubs before fixtures can be generated.`);
      const [a, b, c, d] = ids;
      const rounds = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
      rounds.forEach((pairs, ri) => pairs.forEach(([h, aw]) => {
        run(`INSERT INTO fixtures (season_id, stage, group_name, round, match_label, home_club_id, away_club_id, kickoff_at, status, published, created_at, updated_at)
             VALUES (?, 'group', ?, ?, ?, ?, ?, NULL, 'scheduled', 1, ?, ?)`, season.id, g, ri + 1, `Group ${g} · Matchday ${ri + 1}`, h, aw, now(), now());
        n++;
      }));
    }
    // optional schedule: spread matches across days
    if (start) {
      const list = all("SELECT id FROM fixtures WHERE season_id = ? AND stage = 'group' ORDER BY round, group_name, id", season.id);
      list.forEach((f, i) => {
        const day = Math.floor(i / perDay);
        const d = new Date(start.getTime() + day * Math.max(1, gapDays) * 86400000 + (i % perDay) * 40 * 60000);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        run('UPDATE fixtures SET kickoff_at = ? WHERE id = ?', local, f.id);
      });
    }
    audit(req, 'fixtures.generate_groups', 'season', season.id, { count: n }, season.id);
    if (['registration', 'auction', 'setup'].includes(season.phase)) run("UPDATE seasons SET phase = 'league' WHERE id = ?", season.id);
    return n;
  });
  res.json({ created });
}));

r.post('/fixtures/generate-semis', ah((req, res) => {
  const season = cur();
  if (one("SELECT 1 FROM fixtures WHERE season_id = ? AND stage = 'semi'", season.id)) throw bad('Semi-finals already exist.');
  const ta = T.groupTable(season.id, 'A'); const tb = T.groupTable(season.id, 'B');
  if (!ta.complete || !tb.complete) throw bad('All group matches must be completed first.');
  const unresolved = [...ta.rows, ...tb.rows].filter((x) => x.unresolved && x.pos <= 3);
  if (unresolved.length) throw bad('Some clubs are level on every tie-breaker. Set the final order in League Table before generating the semi-finals.');
  tx(() => {
    const ins = (label, h, a) => run(`INSERT INTO fixtures (season_id, stage, match_label, home_club_id, away_club_id, status, published, created_at, updated_at)
                                      VALUES (?, 'semi', ?, ?, ?, 'scheduled', 1, ?, ?)`, season.id, label, h, a, now(), now());
    ins('Semi-final 1 · A1 v B2', ta.rows[0].club_id, tb.rows[1].club_id);
    ins('Semi-final 2 · B1 v A2', tb.rows[0].club_id, ta.rows[1].club_id);
    audit(req, 'fixtures.generate_semis', 'season', season.id, null, season.id);
  });
  res.json({ ok: true });
}));

r.post('/fixtures/generate-final', ah((req, res) => {
  const season = cur();
  if (one("SELECT 1 FROM fixtures WHERE season_id = ? AND stage = 'final'", season.id)) throw bad('The Grand Final already exists.');
  const semis = all("SELECT * FROM fixtures WHERE season_id = ? AND stage = 'semi' ORDER BY id", season.id);
  if (semis.length !== 2) throw bad('Generate the semi-finals first.');
  const w = semis.map(T.winnerOf);
  if (w.some((x) => !x)) throw bad('Both semi-finals need a completed result with a winner (enter penalties for a draw).');
  tx(() => {
    run(`INSERT INTO fixtures (season_id, stage, match_label, home_club_id, away_club_id, status, published, created_at, updated_at)
         VALUES (?, 'final', 'Grand Final', ?, ?, 'scheduled', 1, ?, ?)`, season.id, w[0], w[1], now(), now());
    if (bool(req.body.third_place)) {
      run(`INSERT INTO fixtures (season_id, stage, match_label, home_club_id, away_club_id, status, published, created_at, updated_at)
           VALUES (?, 'third_place', 'Third-place play-off', ?, ?, 'scheduled', 1, ?, ?)`, season.id, T.loserOf(semis[0]), T.loserOf(semis[1]), now(), now());
    }
    audit(req, 'fixtures.generate_final', 'season', season.id, null, season.id);
  });
  res.json({ ok: true });
}));

function fixtureFields(body, existing = {}) {
  const f = {
    stage: body.stage !== undefined ? String(body.stage) : existing.stage,
    group_name: body.group_name !== undefined ? (['A', 'B'].includes(body.group_name) ? body.group_name : null) : existing.group_name,
    round: body.round !== undefined ? int(body.round, { min: 1, max: 20, required: false, name: 'Round' }) : existing.round,
    match_label: body.match_label !== undefined ? str(body.match_label, { max: 80 }) || null : existing.match_label,
    home_club_id: body.home_club_id !== undefined ? id(body.home_club_id, 'Home club') : existing.home_club_id,
    away_club_id: body.away_club_id !== undefined ? id(body.away_club_id, 'Away club') : existing.away_club_id,
    kickoff_at: body.kickoff_at !== undefined ? dt(body.kickoff_at) : existing.kickoff_at,
    venue: body.venue !== undefined ? str(body.venue, { max: 80 }) || null : existing.venue,
    published: body.published !== undefined ? (bool(body.published) ? 1 : 0) : (existing.published ?? 1),
    notes: body.notes !== undefined ? str(body.notes, { max: 500 }) || null : existing.notes,
  };
  if (!STAGES.includes(f.stage)) throw bad('Unknown stage.');
  if (f.home_club_id === f.away_club_id) throw bad('A club cannot play itself.');
  return f;
}

r.post('/fixtures', ah((req, res) => {
  const season = cur();
  const f = fixtureFields(req.body, { stage: 'group' });
  const info = run(`INSERT INTO fixtures (season_id, stage, group_name, round, match_label, home_club_id, away_club_id, kickoff_at, venue, published, notes, status, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?, ?)`, season.id, f.stage, f.group_name, f.round, f.match_label, f.home_club_id, f.away_club_id,
  f.kickoff_at, f.venue, f.published, f.notes, now(), now());
  audit(req, 'fixture.create', 'fixture', Number(info.lastInsertRowid), f, season.id);
  res.json({ id: Number(info.lastInsertRowid) });
}));

r.put('/fixtures/:id', ah((req, res) => {
  const fx = one('SELECT * FROM fixtures WHERE id = ?', id(req.params.id));
  if (!fx) throw notFound('Fixture');
  const f = fixtureFields(req.body, fx);
  if (fx.status === 'completed' && (f.home_club_id !== fx.home_club_id || f.away_club_id !== fx.away_club_id)) throw bad('Clubs cannot be changed after a result has been entered.');
  const status = req.body.status && ['scheduled', 'postponed', 'cancelled'].includes(req.body.status) && fx.status !== 'completed' ? req.body.status : fx.status;
  run(`UPDATE fixtures SET stage = ?, group_name = ?, round = ?, match_label = ?, home_club_id = ?, away_club_id = ?, kickoff_at = ?, venue = ?,
       published = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?`, f.stage, f.group_name, f.round, f.match_label, f.home_club_id, f.away_club_id,
  f.kickoff_at, f.venue, f.published, f.notes, status, now(), fx.id);
  audit(req, 'fixture.edit', 'fixture', fx.id, { ...f, status }, fx.season_id);
  res.json({ ok: true });
}));

r.delete('/fixtures/:id', ah((req, res) => {
  const fx = one('SELECT * FROM fixtures WHERE id = ?', id(req.params.id));
  if (!fx) throw notFound('Fixture');
  if (fx.status === 'completed' && !bool(req.query.force)) throw bad('This match has a result. Confirm deletion to remove it and its statistics.');
  tx(() => {
    run('DELETE FROM match_events WHERE fixture_id = ?', fx.id);
    run('DELETE FROM fixtures WHERE id = ?', fx.id);
    audit(req, 'fixture.delete', 'fixture', fx.id, { home: fx.home_club_id, away: fx.away_club_id, score: [fx.home_score, fx.away_score] }, fx.season_id);
  });
  res.json({ ok: true });
}));

function squadFor(seasonId, clubId) {
  return all(`SELECT p.id, p.full_name, p.primary_position FROM squad_members sm JOIN players p ON p.id = sm.player_id
              WHERE sm.season_id = ? AND sm.club_id = ? AND sm.active = 1 ORDER BY p.full_name`, seasonId, clubId);
}

r.get('/fixtures/:id/result', ah((req, res) => {
  const fx = T.fixturesWithClubs(cur().id, 'AND f.id = ?', id(req.params.id))[0];
  if (!fx) throw notFound('Fixture');
  res.json({
    fixture: fx,
    events: all('SELECT id, club_id, player_id, type, minute FROM match_events WHERE fixture_id = ? ORDER BY minute, id', fx.id),
    home_squad: squadFor(fx.season_id, fx.home_club_id), away_squad: squadFor(fx.season_id, fx.away_club_id),
  });
}));

r.put('/fixtures/:id/result', ah((req, res) => {
  const fx = one('SELECT * FROM fixtures WHERE id = ?', id(req.params.id));
  if (!fx) throw notFound('Fixture');
  const hs = int(req.body.home_score, { min: 0, max: 99, name: 'Home score' });
  const as = int(req.body.away_score, { min: 0, max: 99, name: 'Away score' });
  let hp = int(req.body.home_pens, { min: 0, max: 99, required: false, name: 'Home penalties' });
  let ap = int(req.body.away_pens, { min: 0, max: 99, required: false, name: 'Away penalties' });
  const knockout = ['semi', 'final', 'third_place'].includes(fx.stage);
  if (!knockout || hs !== as) { hp = null; ap = null; }
  if (knockout && hs === as && (hp == null || ap == null || hp === ap)) throw bad('Knockout matches need a winner. Enter the penalty shoot-out score.');
  const members = new Map([...squadFor(fx.season_id, fx.home_club_id).map((p) => [p.id, fx.home_club_id]),
    ...squadFor(fx.season_id, fx.away_club_id).map((p) => [p.id, fx.away_club_id])]);
  const events = (Array.isArray(req.body.events) ? req.body.events : []).map((e) => {
    const type = String(e.type);
    if (!['goal', 'own_goal', 'assist', 'yellow', 'red'].includes(type)) throw bad('Unknown event type.');
    const clubId = id(e.club_id, 'Club');
    if (![fx.home_club_id, fx.away_club_id].includes(clubId)) throw bad('Events must belong to one of the two clubs.');
    const pid = e.player_id ? id(e.player_id, 'Player') : null;
    if (pid && !members.has(pid)) throw bad('A selected player is not in either squad.');
    // an own goal is credited to the benefiting club but scored by a player from the other club
    if (pid && type !== 'own_goal' && members.get(pid) !== clubId) throw bad('A selected player does not belong to that club.');
    if (pid && type === 'own_goal' && members.get(pid) === clubId) throw bad('An own goal must be scored by a player from the opposing club.');
    return { type, clubId, pid, minute: int(e.minute, { min: 0, max: 200, required: false, name: 'Minute' }) };
  });
  const goals = (cid) => events.filter((e) => (e.type === 'goal' || e.type === 'own_goal') && e.clubId === cid).length;
  if (goals(fx.home_club_id) > hs || goals(fx.away_club_id) > as) throw bad('More goal scorers have been entered than goals in the score.');
  const motm = req.body.motm_player_id ? id(req.body.motm_player_id, 'Player of the match') : null;
  if (motm && !members.has(motm)) throw bad('Player of the match must be in one of the two squads.');
  const confirmed = req.body.status === 'scheduled' ? 'scheduled' : 'completed';
  tx(() => {
    run(`UPDATE fixtures SET home_score = ?, away_score = ?, home_pens = ?, away_pens = ?, motm_player_id = ?, status = ?, result_published = ?, updated_at = ?
         WHERE id = ?`, hs, as, hp, ap, motm, confirmed, bool(req.body.result_published) ? 1 : 0, now(), fx.id);
    run('DELETE FROM match_events WHERE fixture_id = ?', fx.id);
    for (const e of events) {
      run('INSERT INTO match_events (fixture_id, season_id, club_id, player_id, type, minute, created_at) VALUES (?,?,?,?,?,?,?)',
        fx.id, fx.season_id, e.clubId, e.pid, e.type, e.minute, now());
    }
    audit(req, 'fixture.result', 'fixture', fx.id, { score: `${hs}-${as}`, pens: hp != null ? `${hp}-${ap}` : null, events: events.length, published: bool(req.body.result_published) }, fx.season_id);
  });
  res.json({ ok: true });
}));

r.get('/standings', ah((_req, res) => {
  const season = cur();
  res.set('Cache-Control', 'no-store').json({ tables: T.tables(season.id), knockout: T.knockout(season.id) });
}));
r.put('/standings/manual-rank', ah((req, res) => {
  const season = cur();
  const cid = id(req.body.club_id, 'Club');
  const rank = req.body.rank === null || req.body.rank === '' ? null : int(req.body.rank, { min: 1, max: 8, name: 'Rank' });
  run('UPDATE season_clubs SET manual_rank = ? WHERE season_id = ? AND club_id = ?', rank, season.id, cid);
  audit(req, 'standings.manual_rank', 'club', cid, { rank }, season.id);
  res.json({ ok: true });
}));

r.get('/stats', ah((_req, res) => {
  const season = cur();
  res.set('Cache-Control', 'no-store').json(T.playerStats(season.id).map((p) => ({ ...p, photo: undefined, photo_url: A.photoUrl(p.photo, true) })));
}));

module.exports = r;
