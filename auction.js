'use strict';
/**
 * Live auction engine. The server and database are the single source of truth:
 * every bid, sale and allocation is validated and written here inside a transaction,
 * then the new state is broadcast to captains, operators and the projector.
 */
const EventEmitter = require('events');
const { one, all, run, tx, now } = require('../db');
const S = require('./settings');
const { HttpError, audit, fmt, notFound } = require('../util');
const { hasPerm } = require('../security');

const bus = new EventEmitter();
bus.setMaxListeners(50);
const timers = new Map();

class AuctionError extends HttpError {
  constructor(code, message, extra = {}) { super(409, message, { code, ...extra }); }
}
const E = (code, msg, extra) => new AuctionError(code, msg, extra);

const ACTIVE = "('presenting','open','paused')";

const logoUrl = (c) => (c.logo ? `/media/club/${c.logo}.png` : `/img/clubs/${c.slug}.svg`);
const photoUrl = (key, thumb) => (key ? `/media/player/${key}${thumb ? '_t' : ''}.webp` : null);

// ---------------------------------------------------------------- finance

function clubsFinance(seasonId, st = S.get(seasonId)) {
  const rows = all(`SELECT c.id, c.slug, c.name, c.short_name, c.primary_color, c.secondary_color, c.logo, sc.budget_start,
                           sc.captain_user_id, sc.group_name
                    FROM season_clubs sc JOIN clubs c ON c.id = sc.club_id
                    WHERE sc.season_id = ? ORDER BY c.sort_order`, seasonId);
  const sq = new Map(all(`SELECT club_id, SUM(price) AS spent, COUNT(*) AS n, SUM(method <> 'captain') AS nc
                          FROM squad_members WHERE season_id = ? AND active = 1 GROUP BY club_id`, seasonId)
    .map((r) => [r.club_id, r]));
  const adj = new Map(all('SELECT club_id, SUM(amount) AS a FROM budget_adjustments WHERE season_id = ? GROUP BY club_id', seasonId)
    .map((r) => [r.club_id, r.a]));
  return rows.map((r) => {
    const s = sq.get(r.id);
    const members = s ? s.n : 0;
    const count = s ? (st.captainCountsInSquad ? s.n : s.nc) : 0;
    const spent = s ? s.spent : 0;
    const budget = r.budget_start + (adj.get(r.id) || 0);
    const remaining = budget - spent;
    const open = Math.max(0, st.squadSize - count);
    const reserve = st.reserveForRemainingSlots ? Math.max(0, open - 1) * st.startingBid : 0;
    const maxBid = open > 0 ? Math.max(0, remaining - reserve) : 0;
    return {
      id: r.id, slug: r.slug, name: r.name, short_name: r.short_name, primary_color: r.primary_color,
      secondary_color: r.secondary_color, logo_url: logoUrl(r), group_name: r.group_name,
      budget, spent, remaining, count, members, max: st.squadSize, open, reserve, maxBid,
      has_captain_account: !!r.captain_user_id,
    };
  });
}
const clubFinance = (seasonId, clubId, st) => clubsFinance(seasonId, st).find((c) => c.id === clubId);

// ---------------------------------------------------------------- state

function getSession(seasonId) {
  let s = one('SELECT * FROM auction_sessions WHERE season_id = ?', seasonId);
  if (!s) {
    run("INSERT INTO auction_sessions (season_id, status) VALUES (?, 'not_started')", seasonId);
    s = one('SELECT * FROM auction_sessions WHERE season_id = ?', seasonId);
  }
  return s;
}
const activeLot = (seasonId) => one(`SELECT * FROM auction_lots WHERE season_id = ? AND status IN ${ACTIVE}`, seasonId);

function nextValidBid(lot) {
  return lot.highest_bid == null ? lot.starting_bid : lot.highest_bid + lot.min_increment;
}

function buildState(seasonId) {
  const season = one('SELECT id, name, phase FROM seasons WHERE id = ?', seasonId);
  const st = S.get(seasonId);
  const session = getSession(seasonId);
  const lot = activeLot(seasonId);
  const t = Date.now();
  let lotOut = null;
  if (lot) {
    const p = one('SELECT id, full_name, class_grade, primary_position, secondary_position, photo FROM players WHERE id = ?', lot.player_id);
    const bids = all(`SELECT id, club_id, amount, created_at FROM bids WHERE lot_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 6`, lot.id);
    const bidCount = one(`SELECT COUNT(*) AS n FROM bids WHERE lot_id = ? AND status = 'accepted'`, lot.id).n;
    lotOut = {
      id: lot.id, sequence_no: lot.sequence_no, round: lot.round, status: lot.status,
      starting_bid: lot.starting_bid, min_increment: lot.min_increment, timer_seconds: lot.timer_seconds,
      highest_bid: lot.highest_bid, leading_club_id: lot.leading_club_id, highest_bid_id: lot.highest_bid_id,
      timer_ends_at: lot.timer_ends_at, paused_remaining_ms: lot.paused_remaining_ms,
      time_up: lot.status === 'open' && t >= lot.timer_ends_at,
      next_bid: nextValidBid(lot), bid_count: bidCount, recent_bids: bids,
      player: {
        id: p.id, full_name: p.full_name, class_grade: p.class_grade, primary_position: p.primary_position,
        secondary_position: p.secondary_position, photo_url: photoUrl(p.photo),
      },
    };
  }
  const counts = one(`SELECT COUNT(*) AS total,
      SUM(status = 'ready') AS ready, SUM(status = 'pending_allocation') AS pending_allocation,
      SUM(status = 'sold') AS sold, SUM(status = 'allocated') AS allocated, SUM(status = 'bidding') AS bidding
    FROM players WHERE season_id = ? AND status IN ('ready','bidding','sold','pending_allocation','allocated')`, seasonId);
  for (const k of Object.keys(counts)) counts[k] = counts[k] || 0;
  const last = one(`SELECT l.id, l.highest_bid AS price, l.leading_club_id AS club_id, p.full_name
                    FROM auction_lots l JOIN players p ON p.id = l.player_id
                    WHERE l.season_id = ? AND l.status = 'sold' ORDER BY l.closed_at DESC, l.id DESC LIMIT 1`, seasonId);
  return {
    serverNow: t,
    season: { id: season.id, name: season.name },
    session: { status: session.status },
    settings: {
      startingBid: st.startingBid, minIncrement: st.minIncrement, timerSeconds: st.timerSeconds, squadSize: st.squadSize,
      starters: st.starters, subs: st.subs, reserveForRemainingSlots: st.reserveForRemainingSlots,
    },
    lot: lotOut,
    clubs: clubsFinance(seasonId, st),
    counts,
    lastSale: last || null,
  };
}

function scheduleTimer(seasonId) {
  clearTimeout(timers.get(seasonId));
  const lot = activeLot(seasonId);
  if (lot && lot.status === 'open' && lot.timer_ends_at > Date.now()) {
    timers.set(seasonId, setTimeout(() => emitState(seasonId), lot.timer_ends_at - Date.now() + 40));
  }
}

function emitState(seasonId) {
  const state = buildState(seasonId);
  bus.emit('state', seasonId, state);
  scheduleTimer(seasonId);
  return state;
}

// ---------------------------------------------------------------- captain bidding

function captainClub(userId, seasonId) {
  const r = one('SELECT club_id FROM season_clubs WHERE season_id = ? AND captain_user_id = ?', seasonId, userId);
  return r ? r.club_id : null;
}

/**
 * Place a bid for the captain's own club. Returns { ok, code, message, ... }.
 * Rejections are recorded too, so the history shows what happened during simultaneous bidding.
 * clientBidId makes the call idempotent: a repeated click or a retried request never creates a second bid.
 */
function placeBid(user, { lotId, amount, clientBidId } = {}) {
  const season = S.currentSeason();
  if (!user || user.role !== 'captain') return { ok: false, code: 'not_authorised', message: 'Only club captains can bid.' };
  const clubId = captainClub(user.id, season.id);
  if (!clubId) return { ok: false, code: 'not_authorised', message: 'Your account is not linked to a club for this season.' };
  const cbid = typeof clientBidId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(clientBidId) ? clientBidId : null;

  const result = tx(() => {
    if (cbid) {
      const prev = one('SELECT * FROM bids WHERE user_id = ? AND client_bid_id = ?', user.id, cbid);
      if (prev) {
        return prev.status === 'accepted'
          ? { ok: true, duplicate: true, bid: { id: prev.id, amount: prev.amount, lot_id: prev.lot_id } }
          : { ok: false, duplicate: true, code: prev.reason, message: 'This bid was already processed and was not accepted.' };
      }
    }
    const st = S.get(season.id);
    const lot = activeLot(season.id);
    const t = Date.now();
    if (!lot || Number(lotId) !== lot.id) return { ok: false, code: 'lot_changed', message: 'This player is no longer on the block.' };
    const reject = (code, message, extra = {}) => {
      run(`INSERT INTO bids (lot_id, season_id, club_id, user_id, amount, status, reason, client_bid_id, created_at)
           VALUES (?,?,?,?,?, 'rejected', ?,?,?)`, lot.id, season.id, clubId, user.id,
      Number.isSafeInteger(Number(amount)) ? Number(amount) : 0, code, cbid, t);
      return { ok: false, code, message, next_bid: nextValidBid(lot), ...extra };
    };
    const amt = Number(amount);
    if (getSession(season.id).status !== 'live') return reject('not_live', 'The auction is not live.');
    if (lot.status === 'paused') return reject('paused', 'Bidding is paused.');
    if (lot.status !== 'open') return reject('not_open', 'Bidding has not started for this player yet.');
    if (t >= lot.timer_ends_at) return reject('time_up', 'Time is up. Waiting for the operator.');
    if (!Number.isSafeInteger(amt) || amt <= 0) return reject('invalid_amount', 'That is not a valid bid amount.');
    if (lot.leading_club_id === clubId) return reject('already_leading', 'Your club already has the highest bid.');
    const min = nextValidBid(lot);
    if (amt < min) return reject('too_low', `Too low. The next valid bid is ${fmt(min)} points.`);
    const fin = clubFinance(season.id, clubId, st);
    if (fin.open <= 0) return reject('squad_full', 'Your squad is already full.');
    if (amt > fin.remaining) return reject('insufficient_budget', `Not enough points. You have ${fmt(fin.remaining)} left.`);
    if (amt > fin.maxBid) {
      return reject('insufficient_budget',
        `You can bid up to ${fmt(fin.maxBid)}. Keep ${fmt(fin.reserve)} points to fill your remaining ${fin.open - 1} place(s).`);
    }
    const info = run(`INSERT INTO bids (lot_id, season_id, club_id, user_id, amount, status, client_bid_id, created_at)
                      VALUES (?,?,?,?,?, 'accepted', ?, ?)`, lot.id, season.id, clubId, user.id, amt, cbid, t);
    run(`UPDATE auction_lots SET highest_bid = ?, leading_club_id = ?, highest_bid_id = ?, timer_ends_at = ? WHERE id = ?`,
      amt, clubId, info.lastInsertRowid, t + lot.timer_seconds * 1000, lot.id);
    return { ok: true, bid: { id: Number(info.lastInsertRowid), amount: amt, lot_id: lot.id, club_id: clubId } };
  });
  if (result.ok && !result.duplicate) emitState(season.id);
  return result;
}

// ---------------------------------------------------------------- operator controls

function requireLive(seasonId) {
  if (getSession(seasonId).status !== 'live') throw E('not_live', 'Start the auction first.');
}
function lotOrThrow(seasonId, lotId) {
  const lot = activeLot(seasonId);
  if (!lot || (lotId && Number(lotId) !== lot.id)) throw E('lot_changed', 'That player is no longer on the block. The screen has been refreshed.');
  return lot;
}

function startAuction(req) {
  const season = S.currentSeason();
  tx(() => {
    getSession(season.id);
    run("UPDATE auction_sessions SET status = 'live', started_at = COALESCE(started_at, ?), ended_at = NULL WHERE season_id = ?", now(), season.id);
    if (['setup', 'registration'].includes(season.phase)) run("UPDATE seasons SET phase = 'auction' WHERE id = ?", season.id);
    audit(req, 'auction.start', 'season', season.id, null, season.id);
  });
  return emitState(season.id);
}

function endAuction(req) {
  const season = S.currentSeason();
  tx(() => {
    if (activeLot(season.id)) throw E('lot_active', 'Finish or cancel the current player before ending the auction.');
    run("UPDATE auction_sessions SET status = 'ended', ended_at = ? WHERE season_id = ?", now(), season.id);
    audit(req, 'auction.end', 'season', season.id, null, season.id);
  });
  return emitState(season.id);
}

function presentPlayer(req, playerId) {
  const season = S.currentSeason();
  tx(() => {
    requireLive(season.id);
    if (activeLot(season.id)) throw E('lot_active', 'Finish the current player first.');
    const st = S.get(season.id);
    const p = one('SELECT * FROM players WHERE id = ? AND season_id = ?', playerId, season.id);
    if (!p) throw notFound('Player');
    if (!['ready', 'pending_allocation'].includes(p.status)) throw E('not_ready', `${p.full_name} is not in the auction list.`);
    if (one('SELECT 1 FROM squad_members WHERE season_id = ? AND player_id = ? AND active = 1', season.id, p.id)) {
      throw E('already_in_squad', `${p.full_name} already belongs to a club.`);
    }
    const unsoldRounds = one("SELECT COUNT(*) AS n FROM auction_lots WHERE player_id = ? AND status = 'unsold'", p.id).n;
    const round = p.status === 'pending_allocation' ? Math.max(2, unsoldRounds + 1) : 1;
    const seq = one('SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM auction_lots WHERE season_id = ?', season.id).n;
    const info = run(`INSERT INTO auction_lots (season_id, player_id, sequence_no, round, status, player_prev_status, starting_bid,
                        min_increment, timer_seconds, created_at, created_by)
                      VALUES (?,?,?,?, 'presenting', ?,?,?,?,?,?)`,
    season.id, p.id, seq, round, p.status, round > 1 ? st.secondRoundStartingBid : st.startingBid,
    st.minIncrement, st.timerSeconds, now(), req.user.id);
    run("UPDATE players SET status = 'bidding', updated_at = ? WHERE id = ?", now(), p.id);
    audit(req, 'auction.present', 'player', p.id, { lot: Number(info.lastInsertRowid), round, sequence: seq }, season.id);
  });
  return emitState(season.id);
}

function openBidding(req, lotId) {
  const season = S.currentSeason();
  tx(() => {
    requireLive(season.id);
    const lot = lotOrThrow(season.id, lotId);
    if (lot.status === 'open') throw E('already_open', 'Bidding is already open.');
    const remaining = lot.status === 'paused' && lot.paused_remaining_ms > 1000 ? lot.paused_remaining_ms : lot.timer_seconds * 1000;
    run(`UPDATE auction_lots SET status = 'open', timer_ends_at = ?, paused_remaining_ms = NULL, opened_at = COALESCE(opened_at, ?) WHERE id = ?`,
      Date.now() + remaining, now(), lot.id);
    audit(req, lot.status === 'paused' ? 'auction.resume' : 'auction.open', 'lot', lot.id, null, season.id);
  });
  return emitState(season.id);
}

function pauseBidding(req, lotId) {
  const season = S.currentSeason();
  tx(() => {
    const lot = lotOrThrow(season.id, lotId);
    if (lot.status !== 'open') throw E('not_open', 'Bidding is not running.');
    run("UPDATE auction_lots SET status = 'paused', paused_remaining_ms = ? WHERE id = ?", Math.max(0, lot.timer_ends_at - Date.now()), lot.id);
    audit(req, 'auction.pause', 'lot', lot.id, null, season.id);
  });
  return emitState(season.id);
}

function restartTimer(req, lotId) {
  const season = S.currentSeason();
  tx(() => {
    requireLive(season.id);
    const lot = lotOrThrow(season.id, lotId);
    if (lot.status === 'presenting') throw E('not_open', 'Start bidding first.');
    run("UPDATE auction_lots SET status = 'open', timer_ends_at = ?, paused_remaining_ms = NULL WHERE id = ?", Date.now() + lot.timer_seconds * 1000, lot.id);
    audit(req, 'auction.restart_timer', 'lot', lot.id, null, season.id);
  });
  return emitState(season.id);
}

/** Operator confirms the sale. Never happens automatically. */
function confirmSold(req, lotId) {
  const season = S.currentSeason();
  const sale = tx(() => {
    const lot = one('SELECT * FROM auction_lots WHERE id = ? AND season_id = ?', lotId, season.id);
    if (!lot) throw notFound('Auction lot');
    if (lot.status === 'sold') throw E('already_sold', 'This player has already been sold.');
    if (!['open', 'paused'].includes(lot.status)) throw E('not_open', 'Bidding has not started for this player.');
    if (lot.highest_bid == null || !lot.leading_club_id) throw E('no_bids', 'There are no bids. Use "No bids" to send the player to allocation.');
    const top = one("SELECT * FROM bids WHERE id = ? AND status = 'accepted'", lot.highest_bid_id);
    if (!top || top.amount !== lot.highest_bid || top.club_id !== lot.leading_club_id) throw E('bid_mismatch', 'The highest bid could not be verified. Please refresh.');
    const st = S.get(season.id);
    const before = clubFinance(season.id, lot.leading_club_id, st);
    if (before.open <= 0) throw E('squad_full', 'That club squad is already full.');
    if (lot.highest_bid > before.remaining) throw E('insufficient_budget', 'That club no longer has enough points.');
    const t = now();
    run(`INSERT INTO squad_members (season_id, club_id, player_id, price, method, lot_id, created_at, created_by)
         VALUES (?,?,?,?, 'auction', ?,?,?)`, season.id, lot.leading_club_id, lot.player_id, lot.highest_bid, lot.id, t, req.user.id);
    run("UPDATE auction_lots SET status = 'sold', closed_at = ?, closed_by = ? WHERE id = ?", t, req.user.id, lot.id);
    run("UPDATE players SET status = 'sold', updated_at = ? WHERE id = ?", t, lot.player_id);
    const after = clubFinance(season.id, lot.leading_club_id, st);
    const p = one('SELECT id, full_name, class_grade, primary_position, secondary_position, photo FROM players WHERE id = ?', lot.player_id);
    audit(req, 'auction.sold', 'player', p.id, { lot: lot.id, club: lot.leading_club_id, price: lot.highest_bid }, season.id);
    return {
      lot_id: lot.id, sequence_no: lot.sequence_no, price: lot.highest_bid, club_id: lot.leading_club_id,
      player: { ...p, photo: undefined, photo_url: photoUrl(p.photo) },
      before: { remaining: before.remaining, count: before.count }, after: { remaining: after.remaining, count: after.count, max: after.max },
    };
  });
  bus.emit('sold', season.id, sale);
  emitState(season.id);
  return sale;
}

function markUnsold(req, lotId, force) {
  const season = S.currentSeason();
  tx(() => {
    const lot = lotOrThrow(season.id, lotId);
    if (lot.highest_bid != null && !force) throw E('has_bids', 'This player has bids. Confirm the sale instead, or confirm that you want to discard the bids.');
    run("UPDATE auction_lots SET status = 'unsold', closed_at = ?, closed_by = ? WHERE id = ?", now(), req.user.id, lot.id);
    run("UPDATE bids SET status = 'voided', reason = 'lot_unsold' WHERE lot_id = ? AND status = 'accepted'", lot.id);
    run("UPDATE players SET status = 'pending_allocation', updated_at = ? WHERE id = ?", now(), lot.player_id);
    audit(req, 'auction.unsold', 'player', lot.player_id, { lot: lot.id, discarded_bid: lot.highest_bid }, season.id);
  });
  return emitState(season.id);
}

function cancelLot(req, lotId) {
  const season = S.currentSeason();
  tx(() => {
    const lot = lotOrThrow(season.id, lotId);
    if (lot.highest_bid != null && !hasPerm(req.user, 'auction.correct')) {
      throw new HttpError(403, 'Bids have been placed. Only users with correction permission can withdraw this player.');
    }
    run("UPDATE auction_lots SET status = 'cancelled', closed_at = ?, closed_by = ? WHERE id = ?", now(), req.user.id, lot.id);
    run("UPDATE bids SET status = 'voided', reason = 'lot_cancelled' WHERE lot_id = ? AND status = 'accepted'", lot.id);
    run('UPDATE players SET status = ?, updated_at = ? WHERE id = ?', lot.player_prev_status, now(), lot.player_id);
    audit(req, 'auction.cancel_lot', 'player', lot.player_id, { lot: lot.id }, season.id);
  });
  return emitState(season.id);
}

function voidLastBid(req, lotId) {
  const season = S.currentSeason();
  tx(() => {
    const lot = lotOrThrow(season.id, lotId);
    const last = one("SELECT * FROM bids WHERE lot_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1", lot.id);
    if (!last) throw E('no_bids', 'There is no bid to undo.');
    run("UPDATE bids SET status = 'voided', reason = 'operator_undo' WHERE id = ?", last.id);
    const prev = one("SELECT * FROM bids WHERE lot_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1", lot.id);
    run(`UPDATE auction_lots SET highest_bid = ?, leading_club_id = ?, highest_bid_id = ?,
           timer_ends_at = CASE WHEN status = 'open' THEN ? ELSE timer_ends_at END WHERE id = ?`,
    prev ? prev.amount : null, prev ? prev.club_id : null, prev ? prev.id : null, Date.now() + lot.timer_seconds * 1000, lot.id);
    audit(req, 'auction.void_bid', 'bid', last.id, { lot: lot.id, club: last.club_id, amount: last.amount }, season.id);
  });
  return emitState(season.id);
}

// ---------------------------------------------------------------- allocation & corrections

function addMember(req, seasonId, { playerId, clubId, price = 0, method, reason }) {
  const st = S.get(seasonId);
  const p = one('SELECT * FROM players WHERE id = ? AND season_id = ?', playerId, seasonId);
  if (!p) throw notFound('Player');
  const club = one('SELECT club_id FROM season_clubs WHERE season_id = ? AND club_id = ?', seasonId, clubId);
  if (!club) throw notFound('Club');
  if (one('SELECT 1 FROM squad_members WHERE season_id = ? AND player_id = ? AND active = 1', seasonId, playerId)) {
    throw E('already_in_squad', `${p.full_name} already belongs to a club.`);
  }
  const fin = clubFinance(seasonId, clubId, st);
  const counts = method !== 'captain' || st.captainCountsInSquad;
  if (counts && fin.open <= 0) throw E('squad_full', 'That club squad is already full.');
  if (price < 0 || price > fin.remaining) throw E('insufficient_budget', `That club has only ${fmt(fin.remaining)} points left.`);
  const info = run(`INSERT INTO squad_members (season_id, club_id, player_id, price, method, created_at, created_by)
                    VALUES (?,?,?,?,?,?,?)`, seasonId, clubId, playerId, price, method, now(), req.user.id);
  run("UPDATE players SET status = 'allocated', updated_at = ? WHERE id = ?", now(), playerId);
  audit(req, method === 'captain' ? 'squad.captain_assigned' : 'auction.allocate', 'player', playerId,
    { club: clubId, price, reason: reason || null }, seasonId);
  return Number(info.lastInsertRowid);
}

function allocate(req, { playerId, clubId, price = 0, reason }) {
  const season = S.currentSeason();
  tx(() => {
    const p = one('SELECT status FROM players WHERE id = ? AND season_id = ?', playerId, season.id);
    if (!p) throw notFound('Player');
    if (!['pending_allocation', 'ready', 'approved'].includes(p.status)) {
      throw E('not_allocatable', 'Only approved players who have not been sold can be allocated.');
    }
    addMember(req, season.id, { playerId, clubId, price, method: 'manual', reason });
  });
  return emitState(season.id);
}

/** Share all players awaiting allocation across clubs that still have places, fewest players first. */
function autoDistribute(req) {
  const season = S.currentSeason();
  const st = S.get(season.id);
  const done = tx(() => {
    if (activeLot(season.id)) throw E('lot_active', 'Finish the current player first.');
    const pending = all("SELECT id FROM players WHERE season_id = ? AND status = 'pending_allocation' ORDER BY RANDOM()", season.id);
    const out = [];
    for (const p of pending) {
      const clubs = clubsFinance(season.id, st).filter((c) => c.open > 0)
        .sort((a, b) => b.open - a.open || a.count - b.count || Math.random() - 0.5);
      if (!clubs.length) break;
      addMember(req, season.id, { playerId: p.id, clubId: clubs[0].id, price: 0, method: 'manual', reason: 'Automatic distribution' });
      out.push({ player_id: p.id, club_id: clubs[0].id });
    }
    return out;
  });
  emitState(season.id);
  return done;
}

function reverseSale(req, memberId, { reason, returnTo = 'pending_allocation' }) {
  const season = S.currentSeason();
  tx(() => {
    const m = one('SELECT * FROM squad_members WHERE id = ? AND active = 1', memberId);
    if (!m) throw notFound('Squad record');
    if (!['ready', 'pending_allocation', 'approved'].includes(returnTo)) throw E('bad_status', 'Invalid return status.');
    run('UPDATE squad_members SET active = 0, removed_at = ?, removed_by = ?, removed_reason = ? WHERE id = ?', now(), req.user.id, reason, m.id);
    run('UPDATE players SET status = ?, updated_at = ? WHERE id = ?', returnTo, now(), m.player_id);
    if (m.method === 'captain') run('UPDATE season_clubs SET captain_player_id = NULL WHERE season_id = ? AND captain_player_id = ?', m.season_id, m.player_id);
    audit(req, 'squad.reverse', 'player', m.player_id, { member: m.id, club: m.club_id, refunded: m.price, method: m.method, reason, returnTo }, m.season_id);
  });
  return emitState(season.id);
}

function moveMember(req, memberId, { toClubId, reason }) {
  const season = S.currentSeason();
  tx(() => {
    const m = one('SELECT * FROM squad_members WHERE id = ? AND active = 1', memberId);
    if (!m) throw notFound('Squad record');
    if (m.club_id === toClubId) throw E('same_club', 'The player is already in that club.');
    const st = S.get(m.season_id);
    const fin = clubFinance(m.season_id, toClubId, st);
    if (!fin) throw notFound('Club');
    if (fin.open <= 0) throw E('squad_full', 'The destination squad is full.');
    if (m.price > fin.remaining) throw E('insufficient_budget', 'The destination club cannot afford the purchase price.');
    run('UPDATE squad_members SET active = 0, removed_at = ?, removed_by = ?, removed_reason = ? WHERE id = ?', now(), req.user.id, `Moved: ${reason}`, m.id);
    run(`INSERT INTO squad_members (season_id, club_id, player_id, price, method, lot_id, created_at, created_by)
         VALUES (?,?,?,?, 'manual', NULL, ?, ?)`, m.season_id, toClubId, m.player_id, m.price, now(), req.user.id);
    audit(req, 'squad.move', 'player', m.player_id, { from: m.club_id, to: toClubId, price: m.price, reason }, m.season_id);
  });
  return emitState(season.id);
}

function adjustBudget(req, clubId, amount, reason) {
  const season = S.currentSeason();
  tx(() => {
    const fin = clubFinance(season.id, clubId);
    if (!fin) throw notFound('Club');
    if (fin.remaining + amount < 0) throw E('negative_budget', 'This change would make the remaining budget negative.');
    run('INSERT INTO budget_adjustments (season_id, club_id, amount, reason, created_by, created_at) VALUES (?,?,?,?,?,?)',
      season.id, clubId, amount, reason, req.user.id, now());
    audit(req, 'budget.adjust', 'club', clubId, { amount, reason, before: fin.remaining, after: fin.remaining + amount }, season.id);
  });
  return emitState(season.id);
}

module.exports = {
  bus, AuctionError, clubsFinance, clubFinance, buildState, emitState, scheduleTimer, getSession, activeLot, captainClub,
  placeBid, startAuction, endAuction, presentPlayer, openBidding, pauseBidding, restartTimer, confirmSold, markUnsold,
  cancelLot, voidLastBid, allocate, autoDistribute, reverseSale, moveMember, adjustBudget, addMember, logoUrl, photoUrl,
};
