'use strict';
/** Public league website API. Only returns what the administrator has made public. */
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { one, all, run, now } = require('../db');
const S = require('../services/settings');
const A = require('../services/auction');
const T = require('../services/standings');
const P = require('../services/photos');
const cfg = require('../config');
const { ah, bad, notFound, str, position, int } = require('../util');

const r = express.Router();

function seasonFor(req) {
  const id = Number(req.query.season);
  const s = id ? one('SELECT * FROM seasons WHERE id = ?', id) : S.currentSeason();
  if (!s) throw notFound('Season');
  return { season: s, st: S.parse(s.settings) };
}
const seasonInfo = (s) => ({ id: s.id, name: s.name, phase: s.phase, is_current: !!s.is_current });
const flags = (st) => ({
  squads: st.publicSquads, photos: st.publicPhotos && st.publicSquads, fixtures: st.publicFixtures, results: st.publicResults,
  standings: st.publicStandings, stats: st.publicStats, prices: st.publicAuctionPrices,
});

function clubsBasic(seasonId) {
  return all(`SELECT c.id, c.slug, c.name, c.short_name, c.primary_color, c.secondary_color, c.logo, c.motto, sc.group_name
              FROM clubs c LEFT JOIN season_clubs sc ON sc.club_id = c.id AND sc.season_id = ? ORDER BY c.sort_order`, seasonId)
    .map((c) => ({ ...c, logo: undefined, logo_url: A.logoUrl(c) }));
}

function publicFixtures(seasonId, st) {
  if (!st.publicFixtures) return [];
  return T.fixturesWithClubs(seasonId, 'AND f.published = 1').map((f) => {
    const showResult = st.publicResults && f.result_published && f.status === 'completed';
    const out = {
      id: f.id, stage: f.stage, group_name: f.group_name, round: f.round, match_label: f.match_label, kickoff_at: f.kickoff_at,
      venue: f.venue, status: showResult ? 'completed' : (f.status === 'completed' ? 'scheduled' : f.status),
      home: { id: f.home_club_id, name: f.home_name, short_name: f.home_short, slug: f.home_slug, color: f.home_color, logo_url: f.home_logo_url },
      away: { id: f.away_club_id, name: f.away_name, short_name: f.away_short, slug: f.away_slug, color: f.away_color, logo_url: f.away_logo_url },
    };
    if (showResult) Object.assign(out, { home_score: f.home_score, away_score: f.away_score, home_pens: f.home_pens, away_pens: f.away_pens, winner_club_id: f.winner_club_id, motm_name: st.publicSquads ? f.motm_name : null });
    return out;
  });
}

function publicKnockout(seasonId, st) {
  const ko = T.knockout(seasonId, { publishedOnly: true });
  if (!st.publicResults) {
    const hide = (f) => (f ? { ...f, home_score: null, away_score: null, home_pens: null, away_pens: null, winner_club_id: null, motm_name: null } : f);
    return { semis: ko.semis.map(hide), final: hide(ko.final), third: hide(ko.third), champion: null };
  }
  if (!st.publicSquads) for (const f of [...ko.semis, ko.final, ko.third]) if (f) f.motm_name = null;
  return ko;
}

function scorersFor(fixtureIds, st) {
  if (!fixtureIds.length || !st.publicSquads) return {};
  const rows = all(`SELECT e.fixture_id, e.club_id, e.type, e.minute, p.full_name FROM match_events e LEFT JOIN players p ON p.id = e.player_id
                    WHERE e.fixture_id IN (${fixtureIds.map(() => '?').join(',')}) AND e.type IN ('goal','own_goal') ORDER BY e.minute, e.id`, ...fixtureIds);
  const out = {};
  for (const e of rows) (out[e.fixture_id] = out[e.fixture_id] || []).push({ club_id: e.club_id, name: e.full_name, minute: e.minute, own_goal: e.type === 'own_goal' });
  return out;
}

r.get('/home', ah((req, res) => {
  const { season, st } = seasonFor(req);
  const fixtures = publicFixtures(season.id, st);
  const upcoming = fixtures.filter((f) => f.status === 'scheduled').slice(0, 4);
  const results = fixtures.filter((f) => f.status === 'completed').slice(-4).reverse();
  res.json({
    season: seasonInfo(season),
    seasons: all('SELECT id, name, phase, is_current FROM seasons ORDER BY id DESC').map(seasonInfo),
    public: flags(st),
    registration_open: !!(season.is_current && st.registrationOpen),
    clubs: clubsBasic(season.id),
    announcements: all(`SELECT id, title, body, pinned, created_at FROM announcements WHERE published = 1 AND (season_id = ? OR season_id IS NULL)
                        ORDER BY pinned DESC, id DESC LIMIT 6`, season.id),
    upcoming, results,
    tables: st.publicStandings ? T.tables(season.id, { publishedOnly: true }) : [],
    knockout: st.publicFixtures ? publicKnockout(season.id, st) : null,
  });
}));

r.get('/fixtures', ah((req, res) => {
  const { season, st } = seasonFor(req);
  const fixtures = publicFixtures(season.id, st);
  res.json({ season: seasonInfo(season), public: flags(st), fixtures, scorers: scorersFor(fixtures.filter((f) => f.status === 'completed').map((f) => f.id), st) });
}));

r.get('/standings', ah((req, res) => {
  const { season, st } = seasonFor(req);
  res.json({ season: seasonInfo(season), public: flags(st), tables: st.publicStandings ? T.tables(season.id, { publishedOnly: true }) : [],
    knockout: st.publicFixtures ? publicKnockout(season.id, st) : null });
}));

r.get('/stats', ah((req, res) => {
  const { season, st } = seasonFor(req);
  if (!st.publicStats || !st.publicSquads) return res.json({ season: seasonInfo(season), public: flags(st), players: [] });
  const players = T.playerStats(season.id, { publishedOnly: true }).map((p) => ({
    ...p, photo: undefined, photo_url: st.publicPhotos ? A.photoUrl(p.photo, true) : null,
  }));
  res.json({ season: seasonInfo(season), public: flags(st), players });
}));

r.get('/clubs', ah((req, res) => {
  const { season, st } = seasonFor(req);
  const tables = T.tables(season.id, { publishedOnly: true });
  const rowOf = new Map(tables.flatMap((t) => t.rows.map((x) => [x.club_id, x])));
  const counts = new Map(all('SELECT club_id, COUNT(*) AS n FROM squad_members WHERE season_id = ? AND active = 1 GROUP BY club_id', season.id).map((x) => [x.club_id, x.n]));
  res.json({
    season: seasonInfo(season), public: flags(st),
    clubs: clubsBasic(season.id).map((c) => ({ ...c, players: st.publicSquads ? (counts.get(c.id) || 0) : null,
      table: st.publicStandings ? rowOf.get(c.id) || null : null })),
  });
}));

r.get('/clubs/:slug', ah((req, res) => {
  const { season, st } = seasonFor(req);
  const c = one('SELECT * FROM clubs WHERE slug = ?', String(req.params.slug));
  if (!c) throw notFound('Club');
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, c.id);
  let squad = null;
  if (st.publicSquads && sc) {
    squad = all(`SELECT sm.player_id, sm.price, sm.method, sm.lineup_role, sm.lineup_slot, p.full_name, p.class_grade,
                        p.primary_position, p.secondary_position, p.photo
                 FROM squad_members sm JOIN players p ON p.id = sm.player_id
                 WHERE sm.season_id = ? AND sm.club_id = ? AND sm.active = 1
                 ORDER BY CASE sm.lineup_role WHEN 'starter' THEN 0 WHEN 'sub' THEN 1 ELSE 2 END, p.full_name`, season.id, c.id)
      .map((p) => ({
        id: p.player_id, full_name: p.full_name, class_grade: p.class_grade, primary_position: p.primary_position,
        secondary_position: p.secondary_position, lineup_role: p.lineup_role, is_captain: sc.captain_player_id === p.player_id,
        photo_url: st.publicPhotos ? A.photoUrl(p.photo, true) : null, price: st.publicAuctionPrices && p.method === 'auction' ? p.price : null,
      }));
  }
  const fixtures = publicFixtures(season.id, st).filter((f) => f.home.id === c.id || f.away.id === c.id);
  const seasons = all('SELECT * FROM seasons ORDER BY id DESC');
  const history = seasons.map((s) => {
    const sst = S.parse(s.settings);
    const sum = sst.publicStandings || sst.publicResults ? T.clubSeasonSummary(s.id, c.id) : null;
    return sum ? { season: seasonInfo(s), ...sum } : null;
  }).filter((h) => h && (h.p > 0 || h.finish));
  const achievements = all(`SELECT a.id, a.title, a.description, a.awarded_on, s.name AS season_name FROM achievements a
                            LEFT JOIN seasons s ON s.id = a.season_id WHERE a.club_id = ? ORDER BY COALESCE(a.awarded_on, a.created_at) DESC`, c.id);
  const stats = st.publicStats && st.publicSquads ? T.playerStats(season.id, { publishedOnly: true }).filter((p) => p.club_id === c.id)
    .map((p) => ({ player_id: p.player_id, full_name: p.full_name, goals: p.goals, assists: p.assists, motm: p.motm })) : [];
  const finance = st.publicAuctionPrices ? A.clubFinance(season.id, c.id) : null;
  res.json({
    season: seasonInfo(season), public: flags(st),
    club: { id: c.id, slug: c.slug, name: c.name, short_name: c.short_name, primary_color: c.primary_color, secondary_color: c.secondary_color,
      logo_url: A.logoUrl(c), motto: c.motto, description: c.description, group_name: sc ? sc.group_name : null, formation: sc ? sc.formation : null },
    squad, fixtures, history, achievements, stats,
    finance: finance ? { spent: finance.spent, remaining: finance.remaining, budget: finance.budget } : null,
    honours: { championships: history.filter((h) => h.champion).length, finals: history.filter((h) => h.finalist).length },
  });
}));

r.get('/players/:id', ah((req, res) => {
  const pid = int(req.params.id, { min: 1, name: 'Player' });
  const p = one(`SELECT p.*, sm.club_id, s.settings AS season_settings, s.name AS season_name, s.id AS sid
                 FROM players p JOIN squad_members sm ON sm.player_id = p.id AND sm.active = 1 JOIN seasons s ON s.id = p.season_id
                 WHERE p.id = ?`, pid);
  if (!p) throw notFound('Player');
  const st = S.parse(p.season_settings);
  if (!st.publicSquads) throw notFound('Player');
  const club = one('SELECT id, slug, name, short_name, primary_color, secondary_color, logo FROM clubs WHERE id = ?', p.club_id);
  const stats = st.publicStats ? T.playerStats(p.sid, { publishedOnly: true }).find((x) => x.player_id === p.id) || null : null;
  res.json({
    player: { id: p.id, full_name: p.full_name, class_grade: p.class_grade, primary_position: p.primary_position,
      secondary_position: p.secondary_position, photo_url: st.publicPhotos ? A.photoUrl(p.photo) : null, season: p.season_name },
    club: { ...club, logo: undefined, logo_url: A.logoUrl(club) },
    stats: stats ? { goals: stats.goals, assists: stats.assists, motm: stats.motm } : null,
  });
}));

r.get('/archive', ah((_req, res) => {
  const seasons = all('SELECT * FROM seasons ORDER BY id DESC').map((s) => {
    const st = S.parse(s.settings);
    const ko = st.publicFixtures ? T.knockout(s.id, { publishedOnly: true }) : null;
    const runner = ko && ko.final && ko.final.winner_club_id
      ? one('SELECT name FROM clubs WHERE id = ?', ko.final.winner_club_id === ko.final.home_club_id ? ko.final.away_club_id : ko.final.home_club_id) : null;
    const top = st.publicStats && st.publicSquads ? T.playerStats(s.id, { publishedOnly: true })[0] : null;
    return {
      ...seasonInfo(s), created_at: s.created_at, champion: ko ? ko.champion : null, runner_up: runner ? runner.name : null,
      top_scorer: top && top.goals ? { name: top.full_name, goals: top.goals, club: top.club_name } : null,
      players: one("SELECT COUNT(*) AS n FROM squad_members WHERE season_id = ? AND active = 1", s.id).n,
      matches: one("SELECT COUNT(*) AS n FROM fixtures WHERE season_id = ? AND status = 'completed' AND result_published = 1", s.id).n,
    };
  });
  res.json({ seasons });
}));

// ------------------------------------------------------------ registration

r.get('/registration', ah((_req, res) => {
  const season = S.currentSeason();
  const st = S.get(season.id);
  res.json({ open: !!st.registrationOpen, season: season.name, fee: st.registrationFee, squadSize: st.squadSize, starters: st.starters, subs: st.subs });
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 12 },
});
const registerLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many registrations from this connection. Please try again in a few minutes.' },
});

r.post('/register', registerLimiter, upload.single('photo'), ah(async (req, res) => {
  const season = S.currentSeason();
  const st = S.get(season.id);
  if (!st.registrationOpen) throw bad('Registration is currently closed.');
  if (req.body.website) return res.json({ ok: true }); // honeypot: silently ignore bots
  const full_name = str(req.body.full_name, { max: 80, min: 3, name: 'Full name', required: true });
  const class_grade = str(req.body.class_grade, { max: 30, name: 'Class / Grade', required: true });
  const primary = position(req.body.primary_position, { name: 'Preferred position' });
  let secondary = position(req.body.secondary_position, { required: false, name: 'Secondary position' });
  if (secondary === primary) secondary = null;
  if (!['true', 'on', '1'].includes(String(req.body.confirm))) throw bad('Please tick the confirmation box.');
  if (!req.file) throw bad('Please add a photograph.');
  const dupe = one(`SELECT id FROM players WHERE season_id = ? AND lower(full_name) = lower(?) AND lower(class_grade) = lower(?)
                    AND status NOT IN ('rejected','withdrawn')`, season.id, full_name, class_grade);
  if (dupe) throw bad('A registration with this name and class already exists. Please speak to the sports department if you need to change it.');
  const key = await P.savePlayerPhoto(req.file.buffer);
  const t = now();
  run(`INSERT INTO players (season_id, full_name, class_grade, primary_position, secondary_position, photo, status, source, confirmed, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'pending', 'form', 1, ?, ?)`, season.id, full_name, class_grade, primary, secondary, key, t, t);
  res.json({ ok: true, name: full_name });
}));

// ------------------------------------------------------------ media (photos are protected)

const media = express.Router();
media.get('/player/:file', (req, res) => {
  const m = /^([a-f0-9]{24})(_t)?\.webp$/.exec(req.params.file);
  if (!m) return res.sendStatus(404);
  let allowed = !!req.user;
  if (!allowed) {
    const p = one(`SELECT p.status, s.settings FROM players p JOIN seasons s ON s.id = p.season_id WHERE p.photo = ?`, m[1]);
    if (p && ['sold', 'allocated'].includes(p.status)) { const st = S.parse(p.settings); allowed = st.publicSquads && st.publicPhotos; }
  }
  const file = P.playerPhotoPath(m[1], !!m[2]);
  if (!allowed || !file || !fs.existsSync(file)) return res.sendStatus(404);
  res.set('Cache-Control', req.user ? 'private, max-age=604800, immutable' : 'public, max-age=86400');
  res.sendFile(file);
});
media.get('/club/:file', (req, res) => {
  const m = /^([a-f0-9]{24})\.png$/.exec(req.params.file);
  const file = m && P.clubLogoPath(m[1]);
  if (!file || !fs.existsSync(file)) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.sendFile(file);
});

module.exports = { router: r, media };
