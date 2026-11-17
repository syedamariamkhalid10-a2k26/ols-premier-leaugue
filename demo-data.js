#!/usr/bin/env node
'use strict';
/**
 * Fills an EMPTY database with demonstration data so the school can rehearse the event.
 *   npm run demo-data                    -> 56 demo players (approved, with placeholder photos) + demo accounts
 *   npm run demo-data -- --auction       -> also sells about half the players at random prices
 *   npm run demo-data -- --league        -> also draws groups, creates fixtures and enters some results
 * Never run this on the real database: it refuses if players already exist (unless --force).
 */
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const D = require('../server/db');
const cfg = require('../server/config');
const S = require('../server/services/settings');
const A = require('../server/services/auction');
const P = require('../server/services/photos');
const { one, all, run, now } = D;

const args = process.argv.slice(2);
const FIRST = ['Ahmed', 'Hamza', 'Bilal', 'Usman', 'Zain', 'Omar', 'Ali', 'Hassan', 'Ibrahim', 'Yusuf', 'Saad', 'Talha', 'Abdullah', 'Faris', 'Rayyan', 'Hadi', 'Musa', 'Ayaan', 'Danish', 'Shayan',
  'Arham', 'Haris', 'Sufyan', 'Moiz', 'Taha', 'Daniyal', 'Fahad', 'Junaid', 'Kashif', 'Owais', 'Rafay', 'Saim', 'Uzair', 'Wahaj', 'Yahya', 'Zayan', 'Anas', 'Huzaifa', 'Ismail', 'Khalid'];
const LAST = ['Khan', 'Raza', 'Siddiqui', 'Qureshi', 'Malik', 'Shaikh', 'Ansari', 'Hashmi', 'Farooqui', 'Baig', 'Mirza', 'Iqbal', 'Chaudhry', 'Ahmed', 'Butt', 'Zaidi', 'Rizvi', 'Javed'];
const POS = ['Goalkeeper', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Forward', 'Forward'];
const CLASSES = ['Grade 6', 'Grade 7', 'Grade 8', 'O1', 'O2', 'O3'];
const COLORS = ['#2F5D8A', '#7A3B69', '#2E7D5B', '#9C5A1A', '#4B4F9C', '#8A2E3B', '#356F7A', '#6B5B2E'];

async function avatar(name, i) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS[i % COLORS.length]}"/><stop offset="1" stop-color="#1B2A4A"/></linearGradient></defs>
    <rect width="600" height="750" fill="url(#g)"/><circle cx="300" cy="300" r="120" fill="#fff" fill-opacity=".22"/><ellipse cx="300" cy="760" rx="240" ry="260" fill="#fff" fill-opacity=".22"/>
    <text x="300" y="330" font-family="Arial, sans-serif" font-weight="700" font-size="110" text-anchor="middle" fill="#fff">${initials}</text>
    <text x="300" y="720" font-family="Arial, sans-serif" font-size="26" text-anchor="middle" fill="#fff" fill-opacity=".7">DEMO PHOTO</text></svg>`;
  return P.savePlayerPhoto(await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
}

(async () => {
  D.open(cfg.DB_FILE, { log: () => {} });
  const season = S.currentSeason();
  if (one('SELECT 1 FROM players WHERE season_id = ? LIMIT 1', season.id) && !args.includes('--force')) {
    console.error('This season already has players. Demo data is only for an empty database (use --force to override).');
    process.exit(1);
  }
  const admin = one("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const req = { user: { id: admin.id, username: 'demo-script', role: 'admin', permissions: [] }, ip: '127.0.0.1' };
  const used = new Set();
  const ids = [];
  for (let i = 0; i < 56; i++) {
    let name;
    do { name = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`; } while (used.has(name));
    used.add(name);
    const p = POS[i % POS.length];
    let s = POS[Math.floor(Math.random() * POS.length)]; if (s === p || Math.random() < 0.35) s = null;
    const photo = await avatar(name, i);
    const t = now();
    const info = run(`INSERT INTO players (season_id, full_name, class_grade, primary_position, secondary_position, photo, status, source, confirmed, created_at, updated_at)
                      VALUES (?,?,?,?,?,?, 'approved', 'demo', 1, ?, ?)`, season.id, name, CLASSES[i % CLASSES.length], p, s, photo, t, t);
    ids.push(Number(info.lastInsertRowid));
  }
  // a few pending registrations to show the approval screen
  for (let i = 0; i < 4; i++) run(`INSERT INTO players (season_id, full_name, class_grade, primary_position, status, source, confirmed, created_at, updated_at)
    VALUES (?,?,?,?, 'pending', 'demo', 1, ?, ?)`, season.id, `Pending Student ${i + 1}`, CLASSES[i], POS[i], now(), now());

  const hash = bcrypt.hashSync('demo-pass-2026', 11);
  const clubs = all('SELECT c.* FROM clubs c ORDER BY sort_order');
  clubs.forEach((c, i) => {
    const username = `${c.slug.replace(/^(al|as)-/, '').split('-')[0]}-captain`;
    let u = one('SELECT id FROM users WHERE username = ?', username);
    if (!u) u = { id: Number(run(`INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?, 'captain', ?)`, username, `${c.name} Captain`, hash, now()).lastInsertRowid) };
    run('UPDATE season_clubs SET captain_user_id = ?, captain_player_id = ? WHERE season_id = ? AND club_id = ?', u.id, ids[i * 7], season.id, c.id);
    A.addMember(req, season.id, { playerId: ids[i * 7], clubId: c.id, price: 0, method: 'captain', reason: 'Demo captain' });
  });
  for (const [u, role, perms] of [['operator', 'operator', 'auction.correct,auction.allocate'], ['projector', 'projector', '']]) {
    if (!one('SELECT 1 FROM users WHERE username = ?', u)) run(`INSERT INTO users (username, display_name, password_hash, role, permissions, created_at) VALUES (?,?,?,?,?,?)`, u, role === 'operator' ? 'Auction Operator' : 'Projector Screen', hash, role, perms, now());
  }
  const rest = ids.filter((id) => !all('SELECT captain_player_id AS c FROM season_clubs WHERE season_id = ?', season.id).some((r) => r.c === id));
  rest.forEach((id, i) => run("UPDATE players SET status = 'ready', auction_order = ? WHERE id = ?", i + 1, id));

  if (args.includes('--auction') || args.includes('--league')) {
    A.startAuction(req);
    const st = S.get(season.id);
    const toSell = args.includes('--league') ? rest : rest.slice(0, 22);
    for (const pid of toSell) {
      A.presentPlayer(req, pid);
      const lot = A.activeLot(season.id);
      A.openBidding(req, lot.id);
      const fin = A.clubsFinance(season.id, st).filter((c) => c.open > 0 && c.maxBid >= st.startingBid);
      const winner = fin[Math.floor(Math.random() * fin.length)];
      const price = Math.min(winner.maxBid, st.startingBid + st.minIncrement * Math.floor(Math.random() * 30));
      const capUser = one('SELECT captain_user_id AS u FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, winner.id).u;
      let amount = st.startingBid;
      // a short bidding war, then the winner's final bid
      const others = fin.filter((c) => c.id !== winner.id).slice(0, 2);
      for (const o of others) {
        if (amount + st.minIncrement > price) break;
        const ou = one('SELECT captain_user_id AS u FROM season_clubs WHERE season_id = ? AND club_id = ?', season.id, o.id).u;
        if (amount <= o.maxBid) A.placeBid({ id: ou, role: 'captain' }, { lotId: lot.id, amount }); amount += st.minIncrement;
      }
      const cur = A.activeLot(season.id);
      const finalAmt = Math.max(price, cur.highest_bid == null ? st.startingBid : cur.highest_bid + st.minIncrement);
      const r = A.placeBid({ id: capUser, role: 'captain' }, { lotId: lot.id, amount: Math.min(finalAmt, winner.maxBid) });
      if (r.ok || A.activeLot(season.id).highest_bid != null) A.confirmSold(req, lot.id); else A.markUnsold(req, lot.id, true);
    }
    if (args.includes('--league')) {
      A.autoDistribute(req);
      A.endAuction(req);
    }
  }
  if (args.includes('--league')) {
    const cs = all('SELECT club_id FROM season_clubs WHERE season_id = ?', season.id).map((x) => x.club_id);
    cs.forEach((c, i) => run('UPDATE season_clubs SET group_name = ? WHERE season_id = ? AND club_id = ?', i % 2 ? 'B' : 'A', season.id, c));
    for (const g of ['A', 'B']) {
      const [a, b, c, d] = all('SELECT club_id FROM season_clubs WHERE season_id = ? AND group_name = ? ORDER BY club_id', season.id, g).map((x) => x.club_id);
      [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]].forEach((pairs, ri) => pairs.forEach(([h, w], k) => {
        const day = new Date(Date.now() + (ri * 2 - 3) * 86400000);
        const kick = `${day.toISOString().slice(0, 10)}T${14 + k}:${g === 'A' ? '00' : '40'}`;
        run(`INSERT INTO fixtures (season_id, stage, group_name, round, match_label, home_club_id, away_club_id, kickoff_at, venue, status, published, created_at, updated_at)
             VALUES (?, 'group', ?, ?, ?, ?, ?, ?, 'School ground', 'scheduled', 1, ?, ?)`, season.id, g, ri + 1, `Group ${g} · Matchday ${ri + 1}`, h, w, kick, now(), now());
      }));
    }
    // results for the first two matchdays
    const fx = all("SELECT * FROM fixtures WHERE season_id = ? AND round <= 2", season.id);
    for (const f of fx) {
      const hs = Math.floor(Math.random() * 4); const as = Math.floor(Math.random() * 3);
      run("UPDATE fixtures SET home_score = ?, away_score = ?, status = 'completed', result_published = 1 WHERE id = ?", hs, as, f.id);
      const squad = (cid) => all('SELECT player_id FROM squad_members WHERE season_id = ? AND club_id = ? AND active = 1', season.id, cid).map((x) => x.player_id);
      const add = (cid, n) => { const sq = squad(cid); for (let i = 0; i < n; i++) run("INSERT INTO match_events (fixture_id, season_id, club_id, player_id, type, minute, created_at) VALUES (?,?,?,?, 'goal', ?, ?)", f.id, season.id, cid, sq[Math.floor(Math.random() * sq.length)], 3 + Math.floor(Math.random() * 35), now()); };
      add(f.home_club_id, hs); add(f.away_club_id, as);
      const ms = squad(hs >= as ? f.home_club_id : f.away_club_id);
      run('UPDATE fixtures SET motm_player_id = ? WHERE id = ?', ms[0], f.id);
    }
    run("UPDATE seasons SET phase = 'league' WHERE id = ?", season.id);
    S.save(season.id, { publicSquads: true });
  }
  run("INSERT INTO announcements (season_id, title, body, published, pinned, created_at) VALUES (?, ?, ?, 1, 1, ?)", season.id,
    'Welcome to the OLS Premier League', 'Registrations are open. The live auction will be held in the school hall — captains, please test your accounts beforehand.', now());
  console.log(`Demo data created in ${cfg.DB_FILE}
  Captain accounts: saqr-captain, barq-captain, fursan-captain, shihab-captain, saif-captain, raad-captain, hadid-captain, nujum-captain
  Operator: operator · Projector: projector · Password for all demo accounts: demo-pass-2026`);
  D.close();
})().catch((e) => { console.error(e); process.exit(1); });
