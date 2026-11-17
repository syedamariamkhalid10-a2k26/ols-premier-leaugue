'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const sec = require('../security');
const A = require('../services/auction');
const S = require('../services/settings');
const { ah, bad, id, int, str, bool, audit, HttpError } = require('../util');

const r = express.Router();
const operator = sec.requireRole('admin', 'operator');

r.get('/state', sec.requireRole('admin', 'operator', 'captain', 'projector'), (req, res) => {
  const season = S.currentSeason();
  const state = A.buildState(season.id);
  if (req.user.role === 'captain') state.my_club_id = A.captainClub(req.user.id, season.id);
  res.set('Cache-Control', 'no-store').json(state);
});

// HTTP fallback for bidding (the captain screen normally bids over the live socket connection)
r.post('/bid', sec.requireRole('captain'), (req, res) => {
  const out = A.placeBid(req.user, { lotId: Number(req.body.lot_id), amount: Number(req.body.amount), clientBidId: req.body.client_bid_id });
  res.status(out.ok ? 200 : 409).json(out);
});

r.get('/queue', operator, (req, res) => {
  const season = S.currentSeason();
  const cols = 'id, full_name, class_grade, primary_position, secondary_position, photo, status, auction_order';
  const map = (p) => ({ ...p, photo: undefined, photo_url: A.photoUrl(p.photo, true) });
  res.set('Cache-Control', 'no-store').json({
    ready: all(`SELECT ${cols} FROM players WHERE season_id = ? AND status = 'ready' ORDER BY auction_order IS NULL, auction_order, id`, season.id).map(map),
    pending: all(`SELECT ${cols} FROM players WHERE season_id = ? AND status = 'pending_allocation' ORDER BY updated_at, id`, season.id).map(map),
    recent: all(`SELECT l.id, l.sequence_no, l.round, l.status, l.highest_bid, l.leading_club_id, l.closed_at, p.full_name
                 FROM auction_lots l JOIN players p ON p.id = l.player_id
                 WHERE l.season_id = ? AND l.status IN ('sold','unsold','cancelled') ORDER BY l.id DESC LIMIT 12`, season.id),
    permissions: { correct: sec.hasPerm(req.user, 'auction.correct'), allocate: sec.hasPerm(req.user, 'auction.allocate') },
  });
});

r.get('/lots/:id/bids', operator, (req, res) => {
  res.json(all(`SELECT b.id, b.club_id, b.amount, b.status, b.reason, b.created_at, u.username
                FROM bids b JOIN users u ON u.id = b.user_id WHERE b.lot_id = ? ORDER BY b.id DESC LIMIT 200`, id(req.params.id)));
});

const lotId = (req) => (req.body.lot_id ? id(req.body.lot_id, 'Lot') : null);
r.post('/start', operator, ah((req, res) => res.json(A.startAuction(req))));
r.post('/end', operator, ah((req, res) => res.json(A.endAuction(req))));
r.post('/present', operator, ah((req, res) => res.json(A.presentPlayer(req, id(req.body.player_id, 'Player')))));
r.post('/open', operator, ah((req, res) => res.json(A.openBidding(req, lotId(req)))));
r.post('/pause', operator, ah((req, res) => res.json(A.pauseBidding(req, lotId(req)))));
r.post('/restart-timer', operator, ah((req, res) => res.json(A.restartTimer(req, lotId(req)))));
r.post('/sold', operator, ah((req, res) => res.json(A.confirmSold(req, id(req.body.lot_id, 'Lot')))));
r.post('/unsold', operator, ah((req, res) => res.json(A.markUnsold(req, lotId(req), bool(req.body.force)))));
r.post('/cancel', operator, ah((req, res) => res.json(A.cancelLot(req, lotId(req)))));
r.post('/undo-bid', operator, sec.requirePerm('auction.correct'), ah((req, res) => res.json(A.voidLastBid(req, lotId(req)))));
r.post('/allocate', operator, sec.requirePerm('auction.allocate'), ah((req, res) => {
  res.json(A.allocate(req, {
    playerId: id(req.body.player_id, 'Player'), clubId: id(req.body.club_id, 'Club'),
    price: int(req.body.price ?? 0, { min: 0, name: 'Price' }), reason: str(req.body.reason, { max: 200, name: 'Reason' }) || 'Manual allocation',
  }));
}));
r.post('/distribute', operator, sec.requirePerm('auction.allocate'), ah((req, res) => res.json({ allocated: A.autoDistribute(req) })));

// ------------------------------------------------------------ squads & lineups (captain + admin)

const FORMATIONS = ['2-1-1', '1-2-1', '2-2', '3-1', '1-1-2'];

function squadView(seasonId, clubId) {
  const st = S.get(seasonId);
  const sc = one('SELECT * FROM season_clubs WHERE season_id = ? AND club_id = ?', seasonId, clubId);
  if (!sc) throw new HttpError(404, 'Club not found.');
  const club = one('SELECT id, slug, name, short_name, primary_color, secondary_color, logo FROM clubs WHERE id = ?', clubId);
  const members = all(`SELECT sm.id, sm.player_id, sm.price, sm.method, sm.lineup_role, sm.lineup_slot, p.full_name, p.class_grade,
                              p.primary_position, p.secondary_position, p.photo
                       FROM squad_members sm JOIN players p ON p.id = sm.player_id
                       WHERE sm.season_id = ? AND sm.club_id = ? AND sm.active = 1 ORDER BY sm.id`, seasonId, clubId)
    .map((m) => ({ ...m, photo: undefined, photo_url: A.photoUrl(m.photo, true), is_captain: sc.captain_player_id === m.player_id }));
  return {
    club: { ...club, logo: undefined, logo_url: A.logoUrl(club) },
    finance: A.clubFinance(seasonId, clubId, st),
    formation: sc.formation || (st.starters === 5 ? '2-1-1' : null),
    formations: st.starters === 5 ? FORMATIONS : [],
    starters: st.starters, subs: st.subs, squadSize: st.squadSize,
    members,
  };
}

function saveLineup(req, seasonId, clubId, body) {
  const st = S.get(seasonId);
  const formation = body.formation ? String(body.formation) : null;
  if (formation && st.starters === 5 && !FORMATIONS.includes(formation)) throw bad('Unknown formation.');
  const list = Array.isArray(body.members) ? body.members : [];
  const mine = new Map(all('SELECT id FROM squad_members WHERE season_id = ? AND club_id = ? AND active = 1', seasonId, clubId).map((m) => [m.id, true]));
  let starters = 0; let subs = 0;
  const slots = new Set();
  const clean = list.map((m) => {
    const mid = id(m.id, 'Squad member');
    if (!mine.has(mid)) throw new HttpError(403, 'You can only arrange players in your own squad.');
    const role = ['starter', 'sub', 'unset'].includes(m.role) ? m.role : 'unset';
    const slot = m.slot ? String(m.slot).slice(0, 12) : null;
    if (role === 'starter') starters++;
    if (role === 'sub') subs++;
    if (slot && role === 'starter') { if (slots.has(slot)) throw bad('Two players cannot share the same position.'); slots.add(slot); }
    return { id: mid, role, slot: role === 'starter' ? slot : null };
  });
  if (starters > st.starters) throw bad(`Only ${st.starters} players can start.`);
  if (subs > st.subs) throw bad(`Only ${st.subs} substitutes are allowed.`);
  tx(() => {
    for (const m of clean) run('UPDATE squad_members SET lineup_role = ?, lineup_slot = ? WHERE id = ?', m.role, m.slot, m.id);
    run('UPDATE season_clubs SET formation = ? WHERE season_id = ? AND club_id = ?', formation, seasonId, clubId);
    audit(req, 'squad.lineup', 'club', clubId, { formation, starters, subs }, seasonId);
  });
  return squadView(seasonId, clubId);
}

const captainOnly = sec.requireRole('captain');
function myClub(req) {
  const season = S.currentSeason();
  const clubId = A.captainClub(req.user.id, season.id);
  if (!clubId) throw new HttpError(403, 'Your account is not linked to a club for this season.');
  return { season, clubId };
}
r.get('/my-squad', captainOnly, ah((req, res) => { const { season, clubId } = myClub(req); res.json(squadView(season.id, clubId)); }));
r.put('/my-squad', captainOnly, ah((req, res) => { const { season, clubId } = myClub(req); res.json(saveLineup(req, season.id, clubId, req.body)); }));

module.exports = { router: r, squadView, saveLineup, FORMATIONS };
