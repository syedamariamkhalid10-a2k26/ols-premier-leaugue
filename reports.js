'use strict';
/** Reports and exports (Excel, CSV and PDF). */
const express = require('express');
const { one, all } = require('../db');
const sec = require('../security');
const S = require('../services/settings');
const A = require('../services/auction');
const T = require('../services/standings');
const X = require('../services/exporter');
const { ah, notFound, id, fmt } = require('../util');

const r = express.Router();
r.use(sec.requireRole('admin'));
const cur = () => S.currentSeason();
const fmtDate = (s) => (s ? new Date(s).toLocaleString('en-GB', { timeZone: process.env.TZ || 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }) : '');
const LOT_STATUS = { presenting: 'On the block', open: 'Currently Bidding', paused: 'Paused', sold: 'Sold', unsold: 'Unsold → Pending Allocation', cancelled: 'Withdrawn' };
const METHOD = { auction: 'Auction', manual: 'Allocated', captain: 'Captain' };

function summary(seasonId) {
  const st = S.get(seasonId);
  const clubs = A.clubsFinance(seasonId, st);
  const sales = all(`SELECT sm.price, p.full_name, c.name AS club FROM squad_members sm JOIN players p ON p.id = sm.player_id JOIN clubs c ON c.id = sm.club_id
                     WHERE sm.season_id = ? AND sm.active = 1 AND sm.method = 'auction'`, seasonId);
  const top = sales.reduce((m, s) => (!m || s.price > m.price ? s : m), null);
  const auctioned = one("SELECT COUNT(DISTINCT player_id) AS n FROM auction_lots WHERE season_id = ? AND status <> 'cancelled'", seasonId).n;
  const counts = one(`SELECT SUM(status='sold') AS sold, SUM(status='allocated') AS allocated, SUM(status='pending_allocation') AS pending_allocation,
                      SUM(status='ready') AS ready FROM players WHERE season_id = ?`, seasonId);
  return {
    auctioned, sold: counts.sold || 0, allocated: counts.allocated || 0, pending_allocation: counts.pending_allocation || 0, ready: counts.ready || 0,
    total_spent: clubs.reduce((s, c) => s + c.spent, 0),
    average_price: sales.length ? Math.round(sales.reduce((s, x) => s + x.price, 0) / sales.length) : 0,
    highest: top, clubs,
  };
}

function historyRows(seasonId) {
  const lots = all(`SELECT l.*, p.full_name, p.class_grade, p.primary_position, c.name AS club
                    FROM auction_lots l JOIN players p ON p.id = l.player_id LEFT JOIN clubs c ON c.id = l.leading_club_id
                    WHERE l.season_id = ? ORDER BY l.sequence_no`, seasonId);
  const bidRows = all(`SELECT b.lot_id, b.amount, c.short_name FROM bids b JOIN clubs c ON c.id = b.club_id
                       WHERE b.season_id = ? AND b.status IN ('accepted','voided') ORDER BY b.id`, seasonId);
  const byLot = new Map();
  for (const b of bidRows) (byLot.get(b.lot_id) || byLot.set(b.lot_id, []).get(b.lot_id)).push(`${b.short_name} ${fmt(b.amount)}`);
  return lots.map((l) => ({
    seq: l.sequence_no, round: l.round, player: l.full_name, class_grade: l.class_grade, position: l.primary_position,
    club: l.status === 'sold' ? l.club : '', price: l.status === 'sold' ? l.highest_bid : null, status: LOT_STATUS[l.status],
    bids: (byLot.get(l.id) || []).join(' → '), when: fmtDate(l.closed_at || l.created_at),
  }));
}
const HISTORY_COLS = [
  { label: 'Lot', key: 'seq', width: 6, pdfWidth: 0.4 }, { label: 'Player', key: 'player', width: 26, pdfWidth: 1.8 },
  { label: 'Class', key: 'class_grade', pdfWidth: 0.8 }, { label: 'Position', key: 'position', pdfWidth: 1 },
  { label: 'Winning Club', key: 'club', width: 22, pdfWidth: 1.6 }, { label: 'Final Price', key: 'price', pdfWidth: 0.8 },
  { label: 'Status', key: 'status', width: 22, pdfWidth: 1.2 }, { label: 'Previous Bids', key: 'bids', width: 60, pdfWidth: 2.6 },
  { label: 'Date & Time', key: 'when', width: 20, pdfWidth: 1.3 },
];

function squadRows(seasonId) {
  return all(`SELECT c.name AS club, p.full_name, p.class_grade, p.primary_position, p.secondary_position, sm.price, sm.method, sm.lineup_role,
                     sc.captain_player_id = p.id AS is_captain
              FROM squad_members sm JOIN players p ON p.id = sm.player_id JOIN clubs c ON c.id = sm.club_id
              JOIN season_clubs sc ON sc.season_id = sm.season_id AND sc.club_id = sm.club_id
              WHERE sm.season_id = ? AND sm.active = 1 ORDER BY c.sort_order, CASE sm.lineup_role WHEN 'starter' THEN 0 WHEN 'sub' THEN 1 ELSE 2 END, p.full_name`, seasonId)
    .map((x) => ({ ...x, method: METHOD[x.method], role: x.lineup_role === 'starter' ? 'Starting' : x.lineup_role === 'sub' ? 'Substitute' : '', captain: x.is_captain ? 'Captain' : '' }));
}
const SQUAD_COLS = [
  { label: 'Club', key: 'club', width: 22, pdfWidth: 1.5 }, { label: 'Player', key: 'full_name', width: 26, pdfWidth: 1.8 },
  { label: 'Class', key: 'class_grade', pdfWidth: 0.7 }, { label: 'Position', key: 'primary_position', pdfWidth: 0.9 },
  { label: 'Secondary', key: 'secondary_position', pdfWidth: 0.9 }, { label: 'How joined', key: 'method', pdfWidth: 0.8 },
  { label: 'Price', key: 'price', pdfWidth: 0.6 }, { label: 'Lineup', key: 'role', pdfWidth: 0.8 }, { label: 'Captain', key: 'captain', pdfWidth: 0.6 },
];
const BUDGET_COLS = [
  { label: 'Club', key: 'name', width: 24, pdfWidth: 2 }, { label: 'Budget', key: 'budget', pdfWidth: 1 }, { label: 'Spent', key: 'spent', pdfWidth: 1 },
  { label: 'Remaining', key: 'remaining', pdfWidth: 1 }, { label: 'Players', value: (c) => `${c.count} / ${c.max}`, pdfWidth: 0.8 },
];
const STAT_COLS = [
  { label: 'Player', key: 'full_name', width: 26, pdfWidth: 2 }, { label: 'Club', key: 'club_name', width: 22, pdfWidth: 1.6 },
  { label: 'Goals', key: 'goals', pdfWidth: 0.6 }, { label: 'Assists', key: 'assists', pdfWidth: 0.6 }, { label: 'Player of the Match', key: 'motm', pdfWidth: 1 },
  { label: 'Yellow', key: 'yellow', pdfWidth: 0.6 }, { label: 'Red', key: 'red', pdfWidth: 0.6 },
];
const TABLE_COLS = [
  { label: 'Group', key: 'group', pdfWidth: 0.6 }, { label: 'Pos', key: 'pos', pdfWidth: 0.5 }, { label: 'Club', key: 'name', width: 24, pdfWidth: 2 },
  { label: 'P', key: 'p', pdfWidth: 0.4 }, { label: 'W', key: 'w', pdfWidth: 0.4 }, { label: 'D', key: 'd', pdfWidth: 0.4 }, { label: 'L', key: 'l', pdfWidth: 0.4 },
  { label: 'GF', key: 'gf', pdfWidth: 0.4 }, { label: 'GA', key: 'ga', pdfWidth: 0.4 }, { label: 'GD', key: 'gd', pdfWidth: 0.4 }, { label: 'Pts', key: 'pts', pdfWidth: 0.5 },
];

function summaryLines(s) {
  return [
    `Total players auctioned: ${s.auctioned}`,
    `Players sold at auction: ${s.sold}    Players allocated: ${s.allocated}    Awaiting allocation: ${s.pending_allocation}`,
    `Total club expenditure: ${fmt(s.total_spent)} points    Average purchase price: ${fmt(s.average_price)} points`,
    `Highest-priced player: ${s.highest ? `${s.highest.full_name} (${s.highest.club}) — ${fmt(s.highest.price)} points` : '—'}`,
  ];
}

r.get('/summary', ah((_req, res) => res.json(summary(cur().id))));

r.get('/:type', ah(async (req, res) => {
  const season = cur();
  const format = ['csv', 'pdf', 'xlsx'].includes(req.query.format) ? req.query.format : 'xlsx';
  const type = req.params.type;
  const base = `ols-${type}-${season.name}`;
  if (type === 'auction') {
    const s = summary(season.id);
    return X.sendTable(res, format, { filename: base, title: 'Auction History', subtitle: season.name, columns: HISTORY_COLS, rows: historyRows(season.id),
      extraSections: [{ heading: 'Summary', lines: summaryLines(s) }] });
  }
  if (type === 'squads') return X.sendTable(res, format, { filename: base, title: 'Club Squads', subtitle: season.name, columns: SQUAD_COLS, rows: squadRows(season.id) });
  if (type === 'budgets') return X.sendTable(res, format, { filename: base, title: 'Club Budgets', subtitle: season.name, columns: BUDGET_COLS, rows: A.clubsFinance(season.id) });
  if (type === 'stats') return X.sendTable(res, format, { filename: base, title: 'Player Statistics', subtitle: season.name, columns: STAT_COLS, rows: T.playerStats(season.id) });
  if (type === 'standings') {
    const rows = T.tables(season.id).flatMap((t) => t.rows.map((x) => ({ ...x, group: t.group })));
    return X.sendTable(res, format, { filename: base, title: 'Group Standings', subtitle: season.name, columns: TABLE_COLS, rows });
  }
  if (type === 'club') {
    const cid = id(req.query.club, 'Club');
    const c = one('SELECT name FROM clubs WHERE id = ?', cid);
    if (!c) throw notFound('Club');
    const rows = squadRows(season.id).filter((x) => x.club === c.name);
    const f = A.clubFinance(season.id, cid);
    return X.sendTable(res, format, { filename: `ols-squad-${c.name}`, title: `${c.name} — Squad`, subtitle: season.name, columns: SQUAD_COLS.slice(1), rows,
      extraSections: [{ lines: [`Budget: ${fmt(f.budget)}   Spent: ${fmt(f.spent)}   Remaining: ${fmt(f.remaining)}   Players: ${f.count} / ${f.max}`] }] });
  }
  if (type === 'full') {
    const s = summary(season.id);
    const tables = T.tables(season.id).flatMap((t) => t.rows.map((x) => ({ ...x, group: t.group })));
    if (format === 'pdf') {
      const buf = await X.toPdf({ title: 'Season Report', subtitle: season.name, sections: [
        { heading: 'Auction summary', lines: summaryLines(s) },
        { heading: 'Club expenditure and remaining budgets', columns: BUDGET_COLS, rows: s.clubs },
        { heading: 'Squads', columns: SQUAD_COLS, rows: squadRows(season.id) },
        { heading: 'Complete auction history', columns: HISTORY_COLS, rows: historyRows(season.id) },
        ...(tables.length ? [{ heading: 'Group standings', columns: TABLE_COLS, rows: tables }] : []),
      ] });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base.replace(/[^a-z0-9_-]+/gi, '-')}.pdf"`);
      return res.send(buf);
    }
    const buf = await X.toXlsx({ title: 'Season Report', sheets: [
      { name: 'Summary', title: `Season Report — ${season.name}`, columns: [{ label: 'Measure', key: 'k', width: 34 }, { label: 'Value', key: 'v', width: 50 }],
        rows: [['Total players auctioned', s.auctioned], ['Players sold', s.sold], ['Players allocated', s.allocated], ['Awaiting allocation', s.pending_allocation],
          ['Total expenditure', s.total_spent], ['Average purchase price', s.average_price],
          ['Highest-priced player', s.highest ? `${s.highest.full_name} (${s.highest.club}) — ${s.highest.price}` : '—']].map(([k, v]) => ({ k, v })) },
      { name: 'Budgets', columns: BUDGET_COLS, rows: s.clubs },
      { name: 'Squads', columns: SQUAD_COLS, rows: squadRows(season.id) },
      { name: 'Auction History', columns: HISTORY_COLS, rows: historyRows(season.id) },
      { name: 'Standings', columns: TABLE_COLS, rows: tables },
      { name: 'Player Stats', columns: STAT_COLS, rows: T.playerStats(season.id) },
    ] });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base.replace(/[^a-z0-9_-]+/gi, '-')}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  throw notFound('Report');
}));

module.exports = r;
