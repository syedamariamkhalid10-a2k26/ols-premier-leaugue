'use strict';
/**
 * League tables, tie-breakers, knockout progression, player statistics and club history.
 *
 * Tie-breakers (in order):
 *  1. Points
 *  2. Head-to-head points among the tied clubs
 *  3. Head-to-head goal difference among the tied clubs
 *     (when a subset is still tied, the head-to-head mini-table is recalculated for that subset only)
 *  4. Overall goal difference
 *  5. Overall goals scored
 *  6. Fair play (fewer disciplinary points: yellow = 1, red = 3)
 *  7. Administrator-controlled final resolution (manual rank)
 */
const { one, all } = require('../db');
const { logoUrl } = require('./auction');

const FAIR = { yellow: 1, red: 3 };

function blank() { return { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; }

function tally(ids, matches) {
  const set = new Set(ids);
  const t = new Map(ids.map((i) => [i, blank()]));
  for (const m of matches) {
    if (!set.has(m.home_club_id) || !set.has(m.away_club_id)) continue;
    const h = t.get(m.home_club_id); const a = t.get(m.away_club_id);
    h.p++; a.p++;
    h.gf += m.home_score; h.ga += m.away_score; a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.w++; a.l++; h.pts += 3; } else if (m.home_score < m.away_score) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  for (const v of t.values()) v.gd = v.gf - v.ga;
  return t;
}

function partition(ids, keyFn) {
  const groups = [];
  for (const id of ids) {
    const k = keyFn(id);
    const g = groups.find((x) => x.k === k);
    if (g) g.ids.push(id); else groups.push({ k, ids: [id] });
  }
  return groups.map((g) => g.ids);
}

/**
 * Rank club ids. overall = Map(id -> stats), fair = Map(id -> fair-play points), manual = Map(id -> rank).
 * Returns { order: [ids], notes: Map(id -> string), unresolved: Set(ids) }.
 */
function rank(ids, matches, overall, fair, manual) {
  const notes = new Map();
  const unresolved = new Set();
  const played = [...overall.values()].some((s) => s.p > 0);

  function resolve(group, depth = 0) {
    if (group.length === 1) return group;
    // head-to-head mini-table among exactly these clubs
    const h2h = tally(group, matches);
    const sorted = [...group].sort((a, b) => h2h.get(b).pts - h2h.get(a).pts || h2h.get(b).gd - h2h.get(a).gd);
    const parts = partition(sorted, (id) => `${h2h.get(id).pts}|${h2h.get(id).gd}`);
    if (parts.length > 1) {
      if (played) group.forEach((id) => notes.set(id, 'Separated on head-to-head'));
      return parts.flatMap((p) => (p.length > 1 && depth < 10 ? resolve(p, depth + 1) : p));
    }
    // head-to-head cannot separate them: overall goal difference, goals scored, fair play
    const ov = [...group].sort((a, b) => overall.get(b).gd - overall.get(a).gd || overall.get(b).gf - overall.get(a).gf
      || (fair.get(a) || 0) - (fair.get(b) || 0));
    const parts2 = partition(ov, (id) => `${overall.get(id).gd}|${overall.get(id).gf}|${fair.get(id) || 0}`);
    if (played && parts2.length > 1) group.forEach((id) => { if (!notes.has(id)) notes.set(id, 'Separated on goal difference / goals / fair play'); });
    return parts2.flatMap((p) => {
      if (p.length === 1) return p;
      // administrator-controlled final resolution
      const hasManual = p.every((id) => manual.get(id) != null);
      if (played) p.forEach((id) => (hasManual ? notes.set(id, 'Decided by administrator') : unresolved.add(id)));
      return [...p].sort((a, b) => (manual.get(a) ?? 99) - (manual.get(b) ?? 99) || a - b);
    });
  }

  const byPts = [...ids].sort((a, b) => overall.get(b).pts - overall.get(a).pts);
  const order = partition(byPts, (id) => overall.get(id).pts).flatMap((g) => resolve(g));
  return { order, notes, unresolved };
}

function completedMatches(seasonId, { stage, group, publishedOnly } = {}) {
  let sql = `SELECT * FROM fixtures WHERE season_id = ? AND status = 'completed' AND home_score IS NOT NULL AND away_score IS NOT NULL`;
  const p = [seasonId];
  if (stage) { sql += ' AND stage = ?'; p.push(stage); }
  if (group) { sql += ' AND group_name = ?'; p.push(group); }
  if (publishedOnly) sql += ' AND result_published = 1';
  return all(sql, ...p);
}

function fairPlay(seasonId, fixtureIds) {
  const m = new Map();
  if (!fixtureIds.length) return m;
  const rows = all(`SELECT club_id, type FROM match_events WHERE season_id = ? AND type IN ('yellow','red')
                    AND fixture_id IN (${fixtureIds.map(() => '?').join(',')})`, seasonId, ...fixtureIds);
  for (const r of rows) m.set(r.club_id, (m.get(r.club_id) || 0) + FAIR[r.type]);
  return m;
}

function groupTable(seasonId, group, { publishedOnly = false } = {}) {
  const clubs = all(`SELECT c.id, c.slug, c.name, c.short_name, c.primary_color, c.secondary_color, c.logo, sc.manual_rank
                     FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id
                     WHERE sc.season_id = ? AND sc.group_name = ? ORDER BY c.sort_order`, seasonId, group);
  const ids = clubs.map((c) => c.id);
  const matches = completedMatches(seasonId, { stage: 'group', group, publishedOnly });
  const overall = tally(ids, matches);
  const fair = fairPlay(seasonId, matches.map((m) => m.id));
  const manual = new Map(clubs.map((c) => [c.id, c.manual_rank]));
  const { order, notes, unresolved } = rank(ids, matches, overall, fair, manual);
  const totalFixtures = one("SELECT COUNT(*) AS n FROM fixtures WHERE season_id = ? AND stage = 'group' AND group_name = ? AND status <> 'cancelled'", seasonId, group).n;
  const allFixtures = all("SELECT status, result_published FROM fixtures WHERE season_id = ? AND stage = 'group' AND group_name = ? AND status <> 'cancelled'", seasonId, group);
  const done = allFixtures.filter((f) => f.status === 'completed' && (!publishedOnly || f.result_published)).length;
  const byId = new Map(clubs.map((c) => [c.id, c]));
  return {
    group,
    complete: totalFixtures > 0 && done === totalFixtures,
    played: done,
    total: totalFixtures,
    rows: order.map((id, i) => {
      const c = byId.get(id);
      return {
        pos: i + 1, club_id: id, slug: c.slug, name: c.name, short_name: c.short_name, primary_color: c.primary_color,
        secondary_color: c.secondary_color, logo_url: logoUrl(c), ...overall.get(id), fair_play: fair.get(id) || 0,
        manual_rank: c.manual_rank, note: notes.get(id) || null, unresolved: unresolved.has(id), qualifies: i < 2,
      };
    }),
  };
}

function tables(seasonId, opts) {
  const groups = all('SELECT DISTINCT group_name FROM season_clubs WHERE season_id = ? AND group_name IS NOT NULL ORDER BY group_name', seasonId)
    .map((r) => r.group_name);
  return groups.map((g) => groupTable(seasonId, g, opts));
}

function winnerOf(f) {
  if (!f || f.status !== 'completed' || f.home_score == null) return null;
  if (f.home_score > f.away_score) return f.home_club_id;
  if (f.away_score > f.home_score) return f.away_club_id;
  if (f.home_pens != null && f.away_pens != null && f.home_pens !== f.away_pens) return f.home_pens > f.away_pens ? f.home_club_id : f.away_club_id;
  return null;
}
const loserOf = (f) => { const w = winnerOf(f); return w == null ? null : (w === f.home_club_id ? f.away_club_id : f.home_club_id); };

function fixturesWithClubs(seasonId, where = '', ...params) {
  return all(`SELECT f.*, h.name AS home_name, h.short_name AS home_short, h.slug AS home_slug, h.primary_color AS home_color, h.logo AS home_logo,
                     a.name AS away_name, a.short_name AS away_short, a.slug AS away_slug, a.primary_color AS away_color, a.logo AS away_logo,
                     mp.full_name AS motm_name
              FROM fixtures f JOIN clubs h ON h.id = f.home_club_id JOIN clubs a ON a.id = f.away_club_id
              LEFT JOIN players mp ON mp.id = f.motm_player_id
              WHERE f.season_id = ? ${where}
              ORDER BY CASE f.stage WHEN 'group' THEN 1 WHEN 'semi' THEN 2 WHEN 'third_place' THEN 3 WHEN 'final' THEN 4 ELSE 5 END,
                       COALESCE(f.kickoff_at, '9999'), f.id`, seasonId, ...params)
    .map((f) => ({
      ...f,
      home_logo_url: logoUrl({ logo: f.home_logo, slug: f.home_slug }),
      away_logo_url: logoUrl({ logo: f.away_logo, slug: f.away_slug }),
      winner_club_id: winnerOf(f),
    }));
}

function knockout(seasonId, { publishedOnly = false } = {}) {
  const where = publishedOnly ? "AND f.stage IN ('semi','final','third_place') AND f.published = 1" : "AND f.stage IN ('semi','final','third_place')";
  const list = fixturesWithClubs(seasonId, where).map((f) => (publishedOnly && !f.result_published
    ? { ...f, home_score: null, away_score: null, home_pens: null, away_pens: null, winner_club_id: null, motm_name: null } : f));
  const semis = list.filter((f) => f.stage === 'semi');
  const final = list.find((f) => f.stage === 'final') || null;
  const third = list.find((f) => f.stage === 'third_place') || null;
  const champion = final && final.winner_club_id ? one('SELECT id, name, slug, logo, primary_color FROM clubs WHERE id = ?', final.winner_club_id) : null;
  return { semis, final, third, champion: champion ? { ...champion, logo_url: logoUrl(champion) } : null };
}

function playerStats(seasonId, { publishedOnly = false } = {}) {
  const pub = publishedOnly ? 'AND f.result_published = 1' : '';
  const rows = all(`SELECT e.player_id, e.type, COUNT(*) AS n FROM match_events e JOIN fixtures f ON f.id = e.fixture_id
                    WHERE e.season_id = ? AND f.status = 'completed' AND e.player_id IS NOT NULL ${pub}
                    GROUP BY e.player_id, e.type`, seasonId);
  const motm = all(`SELECT motm_player_id AS player_id, COUNT(*) AS n FROM fixtures f WHERE season_id = ? AND status = 'completed'
                    AND motm_player_id IS NOT NULL ${pub} GROUP BY motm_player_id`, seasonId);
  const m = new Map();
  const get = (id) => { if (!m.has(id)) m.set(id, { player_id: id, goals: 0, assists: 0, own_goals: 0, yellow: 0, red: 0, motm: 0 }); return m.get(id); };
  for (const r of rows) {
    const s = get(r.player_id);
    if (r.type === 'goal') s.goals = r.n; else if (r.type === 'assist') s.assists = r.n; else if (r.type === 'own_goal') s.own_goals = r.n;
    else if (r.type === 'yellow') s.yellow = r.n; else if (r.type === 'red') s.red = r.n;
  }
  for (const r of motm) get(r.player_id).motm = r.n;
  if (!m.size) return [];
  const ids = [...m.keys()];
  const info = new Map(all(`SELECT p.id, p.full_name, p.class_grade, p.primary_position, p.photo, sm.club_id, c.name AS club_name,
                                   c.short_name AS club_short, c.slug AS club_slug, c.primary_color, c.logo
                            FROM players p
                            LEFT JOIN squad_members sm ON sm.player_id = p.id AND sm.active = 1
                            LEFT JOIN clubs c ON c.id = sm.club_id
                            WHERE p.id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => [r.id, r]));
  return [...m.values()].map((s) => {
    const i = info.get(s.player_id) || {};
    return {
      ...s, full_name: i.full_name, class_grade: i.class_grade, position: i.primary_position, photo: i.photo, club_id: i.club_id,
      club_name: i.club_name, club_short: i.club_short, club_slug: i.club_slug, club_color: i.primary_color,
      club_logo_url: i.club_slug ? logoUrl({ logo: i.logo, slug: i.club_slug }) : null,
    };
  }).sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.motm - a.motm || String(a.full_name).localeCompare(b.full_name));
}

/** Summary of how a club did in a season (used for club history and archives). */
function clubSeasonSummary(seasonId, clubId) {
  const sc = one('SELECT group_name FROM season_clubs WHERE season_id = ? AND club_id = ?', seasonId, clubId);
  if (!sc) return null;
  const matches = completedMatches(seasonId).filter((m) => m.home_club_id === clubId || m.away_club_id === clubId);
  const t = blank();
  for (const m of matches) {
    const home = m.home_club_id === clubId;
    const gf = home ? m.home_score : m.away_score; const ga = home ? m.away_score : m.home_score;
    t.p++; t.gf += gf; t.ga += ga;
    if (gf > ga) { t.w++; t.pts += 3; } else if (gf < ga) t.l++; else { t.d++; t.pts++; }
  }
  t.gd = t.gf - t.ga;
  let groupPos = null;
  if (sc.group_name) {
    const gt = groupTable(seasonId, sc.group_name);
    if (gt.played > 0) groupPos = gt.rows.findIndex((r) => r.club_id === clubId) + 1;
  }
  const ko = knockout(seasonId);
  let finish = groupPos ? 'Group stage' : null;
  if (ko.semis.some((f) => f.home_club_id === clubId || f.away_club_id === clubId)) finish = 'Semi-finalist';
  const inFinal = ko.final && (ko.final.home_club_id === clubId || ko.final.away_club_id === clubId);
  if (inFinal) finish = ko.final.winner_club_id ? (ko.final.winner_club_id === clubId ? 'Champions' : 'Runners-up') : 'Finalist';
  return { group: sc.group_name, group_position: groupPos, finish, champion: finish === 'Champions', finalist: !!inFinal, ...t };
}

module.exports = { tally, rank, groupTable, tables, knockout, playerStats, fixturesWithClubs, winnerOf, loserOf, clubSeasonSummary, completedMatches };
