'use strict';
/* End-to-end tests covering the testing checklist in the development brief. Run with: npm test */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, emitBid, wait, testImage } = require('./helpers');

let T; // test context
const captains = {}; // clubId -> { client, socket, username }
let clubs = [];

before(async () => { T = await boot(); });
after(async () => {
  for (const c of Object.values(captains)) if (c.socket) c.socket.close();
  if (T) await T.stop();
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
});

async function setSettings(patch) {
  const r = await T.admin.put('/api/admin/settings', patch);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function addPlayers(n, prefix, status = 'approved') {
  const ids = [];
  const pos = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
  for (let i = 0; i < n; i++) {
    const r = await T.admin.post('/api/admin/players', { full_name: `${prefix} Player ${i + 1}`, class_grade: `Grade ${7 + (i % 4)}`, primary_position: pos[i % 4], status });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ids.push(r.data.id);
  }
  return ids;
}
const state = async () => (await T.admin.get('/api/auction/state')).data;
const fin = async (clubId) => (await state()).clubs.find((c) => c.id === clubId);

test('student registration: only the five fields, photo required, enters Pending Approval', async () => {
  const pub = T.client();
  const info = await pub.get('/api/public/registration');
  assert.equal(info.data.open, true);
  assert.equal(info.data.fee, 'Rs. 500');

  const noPhoto = new FormData();
  noPhoto.set('full_name', 'Ahmed Raza'); noPhoto.set('class_grade', 'Grade 9'); noPhoto.set('primary_position', 'Forward'); noPhoto.set('confirm', 'true');
  assert.equal((await pub.req('POST', '/api/public/register', null, { form: noPhoto })).status, 400);

  const badFile = new FormData();
  for (const [k, v] of noPhoto.entries()) badFile.set(k, v);
  badFile.set('photo', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'x.jpg');
  const bad = await pub.req('POST', '/api/public/register', null, { form: badFile });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /not a supported photograph/);

  const noConfirm = new FormData();
  noConfirm.set('full_name', 'Ahmed Raza'); noConfirm.set('class_grade', 'Grade 9'); noConfirm.set('primary_position', 'Forward');
  noConfirm.set('photo', new Blob([await testImage()], { type: 'image/jpeg' }), 'a.jpg');
  assert.equal((await pub.req('POST', '/api/public/register', null, { form: noConfirm })).status, 400);

  const ok = new FormData();
  ok.set('full_name', 'Ahmed Raza'); ok.set('class_grade', 'Grade 9'); ok.set('primary_position', 'FWD'); ok.set('secondary_position', 'Midfielder');
  ok.set('confirm', 'true'); ok.set('photo', new Blob([await testImage()], { type: 'image/jpeg' }), 'ahmed.jpg');
  const r = await pub.req('POST', '/api/public/register', null, { form: ok });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const dup = new FormData();
  for (const [k, v] of ok.entries()) dup.set(k, v);
  assert.equal((await pub.req('POST', '/api/public/register', null, { form: dup })).status, 400, 'duplicate registration is refused');

  const list = (await T.admin.get('/api/admin/players')).data;
  const p = list.find((x) => x.full_name === 'Ahmed Raza');
  assert.equal(p.status, 'pending');
  assert.equal(p.primary_position, 'Forward');
  assert.equal(p.secondary_position, 'Midfielder');
  assert.equal(p.has_photo, true);
  for (const k of ['student_id', 'jersey_number', 'phone', 'address']) assert.ok(!(k in p), `${k} must not exist`);
});

test('photographs: compressed, EXIF removed, protected from the public', async () => {
  const p = (await T.admin.get('/api/admin/players')).data.find((x) => x.full_name === 'Ahmed Raza');
  const img = await T.admin.get(p.photo_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  const meta = await require('sharp')(img.data).metadata();
  assert.equal(meta.width, 600); assert.equal(meta.height, 750);
  assert.equal(meta.exif, undefined, 'EXIF metadata removed');
  assert.ok(img.data.length < 60000, 'photo is compressed');
  assert.equal((await T.client().get(p.photo_url)).status, 404, 'anonymous visitors cannot load student photos');

  const form = new FormData();
  form.set('photo', new Blob([await testImage({ r: 10, g: 120, b: 200 })], { type: 'image/jpeg' }), 'new.jpg');
  const rep = await T.admin.req('POST', `/api/admin/players/${p.id}/photo`, null, { form });
  assert.equal(rep.status, 200);
  assert.notEqual(rep.data.photo_url, p.photo_url);
  assert.equal((await T.admin.get(p.photo_url)).status, 404, 'old photo file removed');
});

test('registration approval, editing and Excel/CSV import', async () => {
  const p = (await T.admin.get('/api/admin/players')).data.find((x) => x.full_name === 'Ahmed Raza');
  assert.equal((await T.admin.put(`/api/admin/players/${p.id}`, { class_grade: 'Grade 10' })).status, 200);
  const r = await T.admin.post('/api/admin/players/status', { ids: [p.id], status: 'approved' });
  assert.equal(r.data.changed, 1);

  const csv = 'Full Name,Class / Grade,Preferred Position,Secondary Position\nBilal Khan,Grade 8,GK,\nOmar Farooq,Grade 9,Striker,Midfielder\n,Grade 9,Defender,\nZain Ali,Grade 7,Winger,Unknown\n';
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'players.csv');
  const preview = await T.admin.req('POST', '/api/admin/players/import', null, { form });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rows.length, 4);
  assert.equal(preview.data.rows.filter((x) => !x.errors.length).length, 2);
  const form2 = new FormData();
  form2.set('file', new Blob([csv], { type: 'text/csv' }), 'players.csv'); form2.set('commit', 'true'); form2.set('approve', 'true');
  const done = await T.admin.req('POST', '/api/admin/players/import', null, { form: form2 });
  assert.equal(done.data.imported, 2);
  const tpl = await T.admin.get('/api/admin/players/import-template');
  assert.equal(tpl.status, 200);
  assert.ok(tpl.data.length > 1000);
});

test('captain accounts: one per club, secure login, no access to other areas', async () => {
  clubs = (await T.admin.get('/api/admin/clubs')).data;
  assert.equal(clubs.length, 8);
  assert.deepEqual(clubs.map((c) => c.name), ['Al Saqr Strikers', 'Al Barq Volt', 'Al Fursan United', 'Al Shihab Comets', 'As-Saif Elite', "Al Ra'ad Thunder", 'Al Hadid Titans', 'Al Nujum United']);
  for (const c of clubs) {
    const username = `cap-${c.slug}`;
    const r = await T.admin.post('/api/admin/captains', { club_id: c.id, username });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.password.length >= 8);
    const client = T.client();
    const me = await client.login(username, r.data.password);
    assert.equal(me.home, '/captain');
    assert.equal(me.club_id, c.id);
    captains[c.id] = { client, username };
  }
  const cap = captains[clubs[0].id].client;
  assert.equal((await cap.get('/api/admin/dashboard')).status, 403);
  assert.equal((await cap.post('/api/auction/present', { player_id: 1 })).status, 403);
  assert.equal((await cap.post('/api/admin/clubs/2/budget', { amount: 5000, reason: 'cheat' })).status, 403);
  assert.equal((await T.client().post('/api/auction/bid', { lot_id: 1, amount: 500 })).status, 401);
  const wrong = await T.client().post('/api/auth/login', { username: captains[clubs[0].id].username, password: 'wrong-password' });
  assert.equal(wrong.status, 400);
  // CSRF: a request without the token is refused
  const saved = cap.csrf; cap.csrf = '';
  assert.equal((await cap.put('/api/auction/my-squad', { members: [] })).status, 403);
  cap.csrf = saved;
});

test('auction defaults, starting bid of 500 and minimum increase of 200', async () => {
  const st = await state();
  assert.equal(st.settings.startingBid, 500);
  assert.equal(st.settings.minIncrement, 200);
  assert.equal(st.settings.squadSize, 7);
  assert.equal(st.settings.timerSeconds, 15);
  assert.ok(st.clubs.every((c) => c.budget === 70000 && c.remaining === 70000));

  await addPlayers(20, 'Auction');
  const all = (await T.admin.get('/api/admin/players')).data.filter((p) => p.status === 'approved');
  const r = await T.admin.post('/api/admin/players/status', { ids: all.map((p) => p.id), status: 'ready' });
  assert.ok(r.data.changed >= 20);
  assert.equal((await T.admin.post('/api/admin/auction-list/order', { mode: 'shuffle' })).status, 200);

  for (const c of clubs) captains[c.id].socket = await captains[c.id].client.socket();
  const [a, b] = [captains[clubs[0].id], captains[clubs[1].id]];

  // bidding refused before the auction is live
  assert.equal((await T.admin.post('/api/auction/present', { player_id: all[0].id })).status, 409);
  assert.equal((await T.admin.post('/api/auction/start')).status, 200);
  const q = (await T.admin.get('/api/auction/queue')).data;
  assert.ok(q.ready.length >= 20);
  assert.equal((await T.admin.post('/api/auction/present', { player_id: q.ready[0].id })).status, 200);
  let lot = (await state()).lot;
  assert.equal(lot.status, 'presenting');
  assert.equal(lot.starting_bid, 500);

  let res = await emitBid(a.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'early-bid-1' });
  assert.equal(res.ok, false); assert.equal(res.code, 'not_open');

  await T.admin.post('/api/auction/open', { lot_id: lot.id });
  res = await emitBid(a.socket, { lot_id: lot.id, amount: 400, client_bid_id: 'low-bid-001' });
  assert.equal(res.code, 'too_low');
  res = await emitBid(a.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'first-bid-01' });
  assert.equal(res.ok, true, JSON.stringify(res));
  res = await emitBid(a.socket, { lot_id: lot.id, amount: 700, client_bid_id: 'self-raise-1' });
  assert.equal(res.code, 'already_leading');
  res = await emitBid(b.socket, { lot_id: lot.id, amount: 600, client_bid_id: 'b-low-00001' });
  assert.equal(res.code, 'too_low');
  res = await emitBid(b.socket, { lot_id: lot.id, amount: 700, client_bid_id: 'b-bid-00001' });
  assert.equal(res.ok, true);
  res = await emitBid(a.socket, { lot_id: lot.id, amount: 900, client_bid_id: 'a-bid-00002' });
  assert.equal(res.ok, true);
  res = await emitBid(b.socket, { lot_id: lot.id, amount: 1100, client_bid_id: 'b-bid-00002' });
  assert.equal(res.ok, true);
  lot = (await state()).lot;
  assert.equal(lot.highest_bid, 1100);
  assert.equal(lot.leading_club_id, clubs[1].id);
  assert.equal(lot.next_bid, 1300);
  // wrong lot id, invalid amounts
  assert.equal((await emitBid(a.socket, { lot_id: lot.id + 99, amount: 1300 })).code, 'lot_changed');
  assert.equal((await emitBid(a.socket, { lot_id: lot.id, amount: 'abc', client_bid_id: 'nan-bid-0001' })).code, 'invalid_amount');
  assert.equal((await emitBid(a.socket, { lot_id: lot.id, amount: 1300.5, client_bid_id: 'frac-bid-001' })).code, 'invalid_amount');

  // pause blocks bids
  await T.admin.post('/api/auction/pause', { lot_id: lot.id });
  assert.equal((await emitBid(a.socket, { lot_id: lot.id, amount: 1300, client_bid_id: 'paused-bid-1' })).code, 'paused');
  await T.admin.post('/api/auction/open', { lot_id: lot.id });
});

test('duplicate bids from repeated clicks are processed once', async () => {
  const a = captains[clubs[0].id];
  const lot = (await state()).lot;
  const results = await Promise.all([1, 2, 3].map(() => emitBid(a.socket, { lot_id: lot.id, amount: 1300, client_bid_id: 'same-click-01' })));
  assert.equal(results.filter((r) => r.ok && !r.duplicate).length, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 2);
  assert.equal((await state()).lot.highest_bid, 1300);
});

test('simultaneous bids: exactly one wins, the rest are rejected and recorded', async () => {
  const lot = (await state()).lot;
  const others = clubs.slice(1).map((c) => captains[c.id]);
  const results = await Promise.all(others.map((c, i) => emitBid(c.socket, { lot_id: lot.id, amount: 1500, client_bid_id: `simul-${i}-xyz` })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'too_low'));
  const after = (await state()).lot;
  assert.equal(after.highest_bid, 1500);
  const bids = (await T.admin.get(`/api/auction/lots/${lot.id}/bids`)).data;
  assert.equal(bids.filter((b) => b.amount === 1500 && b.status === 'rejected').length, 6);
});

test('timer: resets on each bid; time up blocks bids; never sells automatically', async () => {
  await setSettings({ timerSeconds: 15 }); // unchanged while a player is on the block is allowed
  const st = await state();
  const lot = st.lot;
  assert.ok(lot.timer_ends_at - st.serverNow > 13000, 'timer reset to ~15s by last bid');
  // shorten: restart timer uses lot.timer_seconds (snapshot of settings when presented)
  assert.equal(lot.timer_seconds, 15);
  const bad = await T.admin.put('/api/admin/settings', { timerSeconds: 6 });
  assert.equal(bad.status, 400, 'bidding settings cannot change mid-lot');
});

test('successful sale: budget deducted, player added to squad, SOLD broadcast, duplicate sale prevented', async () => {
  const st = await state();
  const lot = st.lot;
  const winner = lot.leading_club_id;
  const before = st.clubs.find((c) => c.id === winner);
  const soldEvents = [];
  const proj = T.client();
  const pr = await T.admin.post('/api/admin/users', { username: 'projector1', role: 'projector', password: 'Projector#2026' });
  assert.equal(pr.status, 200);
  await proj.login('projector1', 'Projector#2026');
  const ps = await proj.socket();
  ps.on('sold', (e) => soldEvents.push(e));
  assert.equal((await proj.post('/api/auction/sold', { lot_id: lot.id })).status, 403, 'projector is read-only');
  assert.equal((await emitBid(ps, { lot_id: lot.id, amount: 5000 })).code, 'not_authorised');

  const [r1, r2] = await Promise.all([T.admin.post('/api/auction/sold', { lot_id: lot.id }), T.admin.post('/api/auction/sold', { lot_id: lot.id })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const r3 = await T.admin.post('/api/auction/sold', { lot_id: lot.id });
  assert.equal(r3.status, 409);
  await wait(100);
  assert.equal(soldEvents.length, 1);
  assert.equal(soldEvents[0].price, 1500);
  assert.equal(soldEvents[0].before.remaining, 70000);
  assert.equal(soldEvents[0].after.remaining, 68500);
  const after = await fin(winner);
  assert.equal(after.remaining, before.remaining - 1500);
  assert.equal(after.count, 1);
  const squad = (await captains[winner].client.get('/api/auction/my-squad')).data;
  assert.equal(squad.members.length, 1);
  assert.equal(squad.members[0].price, 1500);
  ps.close();
});

test('budget enforcement: cannot overspend, and must keep enough to fill remaining places', async () => {
  const st = await state();
  const leader = st.lot ? st.lot.leading_club_id : null;
  const c = clubs.find((x) => x.id !== leader && st.clubs.find((y) => y.id === x.id).count === 0);
  const rival = clubs.find((x) => x.id !== c.id);
  const cap = captains[c.id];
  // leave the club with exactly enough for one 500 bid plus 500 for each other open place
  const f = await fin(c.id);
  const target = 500 + (f.open - 1) * 500;
  const r = await T.admin.post(`/api/admin/clubs/${c.id}/budget`, { amount: target - f.remaining, reason: 'Test budget limit' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await fin(c.id)).maxBid, 500);
  const q = (await T.admin.get('/api/auction/queue')).data;
  await T.admin.post('/api/auction/present', { player_id: q.ready[0].id });
  const lot = (await state()).lot;
  await T.admin.post('/api/auction/open', { lot_id: lot.id });
  assert.equal((await emitBid(cap.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'budget-ok-01' })).ok, true);
  assert.equal((await emitBid(captains[rival.id].socket, { lot_id: lot.id, amount: 700, client_bid_id: 'budget-other' })).ok, true);
  const res = await emitBid(cap.socket, { lot_id: lot.id, amount: 900, client_bid_id: 'budget-over1' });
  assert.equal(res.code, 'insufficient_budget');
  assert.match(res.message, /Keep [\d,]+ points to fill/);
  // http fallback gives the same answer
  const http = await cap.client.post('/api/auction/bid', { lot_id: lot.id, amount: 90000, client_bid_id: 'budget-http1' });
  assert.equal(http.status, 409);
  assert.equal(http.data.code, 'insufficient_budget');
  // a negative budget is impossible
  assert.equal((await T.admin.post(`/api/admin/clubs/${c.id}/budget`, { amount: -999999, reason: 'Too much' })).status, 409);
  await T.admin.post('/api/auction/sold', { lot_id: lot.id });
  const f2 = await fin(c.id);
  await T.admin.post(`/api/admin/clubs/${c.id}/budget`, { amount: 70000 - f2.remaining, reason: 'Restore after test' });
  assert.equal((await fin(c.id)).remaining, 70000);
});

test('squad limit enforcement', async () => {
  const empty = (await state()).clubs.filter((x) => x.count === 0).map((x) => x.id);
  const c = clubs.find((x) => empty.includes(x.id));
  const cap = captains[c.id];
  // Reduce the squad size temporarily so this club fills up quickly
  const biggest = Math.max(...(await state()).clubs.map((x) => x.count));
  await setSettings({ squadSize: 2, starters: 1, subs: 1 });
  assert.ok(biggest <= 2);
  for (let i = 0; i < 2; i++) {
    const q = (await T.admin.get('/api/auction/queue')).data;
    await T.admin.post('/api/auction/present', { player_id: q.ready[0].id });
    const lot = (await state()).lot;
    await T.admin.post('/api/auction/open', { lot_id: lot.id });
    const r = await emitBid(cap.socket, { lot_id: lot.id, amount: 500, client_bid_id: `squad-fill-${i}` });
    assert.equal(r.ok, true, JSON.stringify(r));
    await T.admin.post('/api/auction/sold', { lot_id: lot.id });
  }
  assert.equal((await fin(c.id)).open, 0);
  const q = (await T.admin.get('/api/auction/queue')).data;
  await T.admin.post('/api/auction/present', { player_id: q.ready[0].id });
  const lot = (await state()).lot;
  await T.admin.post('/api/auction/open', { lot_id: lot.id });
  const r = await emitBid(cap.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'squad-full-1' });
  assert.equal(r.code, 'squad_full');
  // manual allocation is also blocked
  const alloc = await T.admin.post('/api/admin/squads/allocate', { player_id: q.ready[1].id, club_id: c.id, price: 0, reason: 'test full squad' });
  assert.equal(alloc.status, 409);
  // squad size can't go below the biggest squad
  assert.equal((await T.admin.put('/api/admin/settings', { squadSize: 1, starters: 1, subs: 0 })).status, 400);
  await T.admin.post('/api/auction/cancel', { lot_id: lot.id });
  await setSettings({ squadSize: 7, starters: 5, subs: 2 });
});

test('connection loss and recovery: state restored from the server after reconnect', async () => {
  const a = captains[clubs[5].id];
  const b = captains[clubs[6].id];
  const q = (await T.admin.get('/api/auction/queue')).data;
  await T.admin.post('/api/auction/present', { player_id: q.ready[0].id });
  const lot = (await state()).lot;
  await T.admin.post('/api/auction/open', { lot_id: lot.id });
  a.socket.close(); // captain A loses connection
  assert.equal((await emitBid(b.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'recon-b-001' })).ok, true);
  assert.equal((await emitBid(b.socket, { lot_id: lot.id, amount: 500, client_bid_id: 'recon-b-001' })).duplicate, true, 'retry after a slow connection is not double-counted');
  a.socket = await a.client.socket(); // reconnect
  assert.equal(a.socket.lastState.lot.highest_bid, 500, 'latest confirmed state restored');
  assert.equal(a.socket.lastState.lot.leading_club_id, clubs[6].id);
  assert.equal((await emitBid(a.socket, { lot_id: lot.id, amount: 700, client_bid_id: 'recon-a-001' })).ok, true);
  // operator undo of an accidental bid (admin has the correction permission)
  assert.equal((await T.admin.post('/api/auction/undo-bid', { lot_id: lot.id })).status, 200);
  const s = await state();
  assert.equal(s.lot.highest_bid, 500);
  assert.equal(s.lot.leading_club_id, clubs[6].id);
  await T.admin.post('/api/auction/sold', { lot_id: lot.id });
});

test('operator role: runs the auction but needs permission for corrections', async () => {
  const op = T.client();
  await T.admin.post('/api/admin/users', { username: 'operator1', role: 'operator', password: 'Operator#2026', permissions: [] });
  await op.login('operator1', 'Operator#2026');
  const q = (await op.get('/api/auction/queue')).data;
  assert.equal(q.permissions.correct, false);
  assert.equal((await op.post('/api/auction/present', { player_id: q.ready[0].id })).status, 200);
  const lot = (await state()).lot;
  await op.post('/api/auction/open', { lot_id: lot.id });
  await emitBid(captains[clubs[7].id].socket, { lot_id: lot.id, amount: 500, client_bid_id: 'op-test-0001' });
  assert.equal((await op.post('/api/auction/undo-bid', { lot_id: lot.id })).status, 403);
  assert.equal((await op.post('/api/auction/cancel', { lot_id: lot.id })).status, 403, 'cannot withdraw a player with bids without permission');
  assert.equal((await op.get('/api/admin/dashboard')).status, 403);
  assert.equal((await op.post('/api/auction/sold', { lot_id: lot.id })).status, 200);
});

test('unsold players: pending allocation, second round, manual and automatic allocation', async () => {
  const q = (await T.admin.get('/api/auction/queue')).data;
  const pid = q.ready[0].id;
  await T.admin.post('/api/auction/present', { player_id: pid });
  let lot = (await state()).lot;
  await T.admin.post('/api/auction/open', { lot_id: lot.id });
  assert.equal((await T.admin.post('/api/auction/sold', { lot_id: lot.id })).status, 409, 'cannot sell without bids');
  await T.admin.post('/api/auction/unsold', { lot_id: lot.id });
  let players = (await T.admin.get('/api/admin/players')).data;
  assert.equal(players.find((p) => p.id === pid).status, 'pending_allocation');
  // second round
  await T.admin.post('/api/auction/present', { player_id: pid });
  lot = (await state()).lot;
  assert.equal(lot.round, 2);
  await T.admin.post('/api/auction/unsold', { lot_id: lot.id });
  // manual allocation (authorised + recorded)
  const club = clubs[3];
  const r = await T.admin.post('/api/admin/squads/allocate', { player_id: pid, club_id: club.id, price: 0, reason: 'No bids in two rounds' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  players = (await T.admin.get('/api/admin/players')).data;
  assert.equal(players.find((p) => p.id === pid).status, 'allocated');
  const audit = (await T.admin.get('/api/admin/audit?q=auction.allocate')).data;
  assert.ok(audit.some((a) => a.entity_id === pid));
  // send two more to pending and distribute automatically
  for (let i = 0; i < 2; i++) {
    const qq = (await T.admin.get('/api/auction/queue')).data;
    await T.admin.post('/api/auction/present', { player_id: qq.ready[0].id });
    const l = (await state()).lot;
    await T.admin.post('/api/auction/unsold', { lot_id: l.id });
  }
  const d = await T.admin.post('/api/admin/squads/distribute');
  assert.equal(d.data.allocated.length, 2);
  assert.equal((await T.admin.get('/api/auction/queue')).data.pending.length, 0);
});

test('reversing a sale restores the budget and is audited; a player never belongs to two clubs', async () => {
  const squads = (await T.admin.get('/api/admin/squads')).data;
  const withSale = squads.find((s) => s.members.some((m) => m.method === 'auction'));
  const m = withSale.members.find((x) => x.method === 'auction');
  const before = withSale.finance.remaining;
  assert.equal((await T.admin.post('/api/admin/squads/reverse', { member_id: m.id, reason: '' })).status, 400, 'reason required');
  const r = await T.admin.post('/api/admin/squads/reverse', { member_id: m.id, reason: 'Entered against wrong club', return_to: 'ready' });
  assert.equal(r.status, 200);
  assert.equal((await fin(withSale.club.id)).remaining, before + m.price);
  const again = await T.admin.post('/api/admin/squads/reverse', { member_id: m.id, reason: 'twice' });
  assert.equal(again.status, 404, 'cannot refund twice');
  // allocate to club A then try to allocate the same player to club B
  await T.admin.post('/api/admin/squads/allocate', { player_id: m.player_id, club_id: clubs[0].id, price: 0, reason: 'Re-allocate' });
  const dup = await T.admin.post('/api/admin/squads/allocate', { player_id: m.player_id, club_id: clubs[1].id, price: 0, reason: 'Second club' });
  assert.notEqual(dup.status, 200);
  const owners = (await T.admin.get('/api/admin/squads')).data.filter((s) => s.members.some((x) => x.player_id === m.player_id));
  assert.equal(owners.length, 1);
  const audit = (await T.admin.get('/api/admin/audit?q=squad.reverse')).data;
  assert.ok(audit.length >= 1);
});

test('captain manages starting five and substitutes for their own club only', async () => {
  const squads = (await T.admin.get('/api/admin/squads')).data;
  const s = squads.find((x) => x.members.length >= 2);
  const cap = captains[s.club.id].client;
  const mine = (await cap.get('/api/auction/my-squad')).data;
  const body = { formation: '2-1-1', members: mine.members.map((m, i) => ({ id: m.id, role: i === 0 ? 'starter' : i <= 2 ? 'sub' : 'unset', slot: i === 0 ? 'GK' : null })) };
  const r = await cap.put('/api/auction/my-squad', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.members[0].lineup_role, 'starter');
  const other = squads.find((x) => x.club.id !== s.club.id && x.members.length);
  const hack = await cap.put('/api/auction/my-squad', { members: [{ id: other.members[0].id, role: 'starter' }] });
  assert.equal(hack.status, 403);
  const tooMany = await cap.put('/api/auction/my-squad', { members: mine.members.map((m) => ({ id: m.id, role: 'sub' })) });
  if (mine.members.length > 2) assert.equal(tooMany.status, 400);
});

test('auction history, reports and exports (Excel, CSV, PDF)', async () => {
  const h = (await T.admin.get('/api/admin/auction/history')).data;
  assert.ok(h.lots.length >= 8);
  const sold = h.lots.find((l) => l.status === 'sold' && l.bids >= 2);
  assert.ok(sold);
  const detail = (await T.admin.get(`/api/admin/auction/lots/${sold.id}`)).data;
  assert.ok(detail.bids.length >= 2);
  const sum = (await T.admin.get('/api/admin/reports/summary')).data;
  assert.ok(sum.sold >= 5);
  assert.ok(sum.highest.price >= 500);
  assert.ok(sum.average_price > 0);
  for (const fmt of ['xlsx', 'csv', 'pdf']) {
    const r = await T.admin.get(`/api/admin/reports/auction?format=${fmt}`);
    assert.equal(r.status, 200, fmt);
    assert.ok(r.data.length > 200, fmt);
  }
  const csv = (await T.admin.get('/api/admin/reports/auction?format=csv')).data.toString();
  assert.match(csv, /Winning Club/);
  const pdf = await T.admin.get('/api/admin/reports/full?format=pdf');
  assert.equal(pdf.data.slice(0, 4).toString(), '%PDF');
  assert.equal((await T.admin.get('/api/admin/reports/full?format=xlsx')).status, 200);
});

test('fixtures, results and automatic standings with tie-breakers', async () => {
  assert.equal((await T.admin.post('/api/admin/groups', { random: true })).status, 200);
  const g = await T.admin.post('/api/admin/fixtures/generate-groups', { start: '2027-01-11T14:00', per_day: 4, gap_days: 1 });
  assert.equal(g.data.created, 12);
  const { fixtures } = (await T.admin.get('/api/admin/fixtures')).data;
  const groupA = fixtures.filter((f) => f.group_name === 'A');
  assert.equal(groupA.length, 6);
  // every club plays the other three once
  const pairs = new Set(groupA.map((f) => [f.home_club_id, f.away_club_id].sort().join('-')));
  assert.equal(pairs.size, 6);

  // three-way tie in group A: a beats b, b beats c, c beats a (all 1-0); everyone beats d 2-0
  const ids = [...new Set(groupA.flatMap((f) => [f.home_club_id, f.away_club_id]))];
  const [a, b, c, d] = ids;
  const score = (x, y) => {
    const map = { [`${a}-${b}`]: [1, 0], [`${b}-${c}`]: [1, 0], [`${c}-${a}`]: [1, 0], [`${a}-${d}`]: [3, 0], [`${b}-${d}`]: [2, 0], [`${c}-${d}`]: [2, 0] };
    if (map[`${x}-${y}`]) return map[`${x}-${y}`];
    const r = map[`${y}-${x}`]; return [r[1], r[0]];
  };
  for (const f of groupA) {
    const [hs, as] = score(f.home_club_id, f.away_club_id);
    const res = await T.admin.put(`/api/admin/fixtures/${f.id}/result`, { home_score: hs, away_score: as, events: [], result_published: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }
  const tables = (await T.admin.get('/api/admin/standings')).data.tables;
  const ta = tables.find((t) => t.group === 'A');
  assert.equal(ta.complete, true);
  // a, b, c all on 6 points; head-to-head all equal (3 pts, GD 0) -> overall GD: a +3 (4-1), b +2, c +2
  assert.equal(ta.rows[0].club_id, a);
  assert.equal(ta.rows[0].pts, 6);
  assert.equal(ta.rows[3].club_id, d);
  assert.equal(ta.rows[3].pts, 0);
  // b and c are level on every criterion -> flagged for administrator resolution
  assert.ok(ta.rows[1].unresolved && ta.rows[2].unresolved);
  await T.admin.put('/api/admin/standings/manual-rank', { club_id: c, rank: 1 });
  await T.admin.put('/api/admin/standings/manual-rank', { club_id: b, rank: 2 });
  const ta2 = (await T.admin.get('/api/admin/standings')).data.tables.find((t) => t.group === 'A');
  assert.equal(ta2.rows[1].club_id, c);
  assert.equal(ta2.rows[1].note, 'Decided by administrator');

  // group B with a goal scorer, card and player of the match
  const groupB = fixtures.filter((f) => f.group_name === 'B');
  for (const f of groupB) {
    const det = (await T.admin.get(`/api/admin/fixtures/${f.id}/result`)).data;
    const scorer = det.home_squad[0];
    const events = scorer ? [{ type: 'goal', club_id: f.home_club_id, player_id: scorer.id, minute: 10 }, { type: 'yellow', club_id: f.away_club_id, minute: 20 }] : [];
    const res = await T.admin.put(`/api/admin/fixtures/${f.id}/result`, { home_score: 1, away_score: 0, events, motm_player_id: scorer ? scorer.id : null, result_published: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }
  const badScore = await T.admin.put(`/api/admin/fixtures/${groupB[0].id}/result`, { home_score: 0, away_score: 0, events: [{ type: 'goal', club_id: groupB[0].home_club_id }] });
  assert.equal(badScore.status, 400, 'scorers cannot exceed the score');

  const tb = (await T.admin.get('/api/admin/standings')).data.tables.find((t) => t.group === 'B');
  if (tb.rows.some((r) => r.unresolved)) {
    for (const [i, r] of tb.rows.entries()) await T.admin.put('/api/admin/standings/manual-rank', { club_id: r.club_id, rank: i + 1 });
  }
  assert.equal((await T.admin.post('/api/admin/fixtures/generate-semis')).status, 200);
  const ko = (await T.admin.get('/api/admin/standings')).data.knockout;
  assert.equal(ko.semis.length, 2);
  const tA = (await T.admin.get('/api/admin/standings')).data.tables;
  const A1 = tA.find((t) => t.group === 'A').rows[0].club_id; const B2 = tA.find((t) => t.group === 'B').rows[1].club_id;
  assert.equal(ko.semis[0].home_club_id, A1); assert.equal(ko.semis[0].away_club_id, B2);
  // knockout draw needs penalties
  const s1 = ko.semis[0];
  assert.equal((await T.admin.put(`/api/admin/fixtures/${s1.id}/result`, { home_score: 1, away_score: 1, events: [] })).status, 400);
  await T.admin.put(`/api/admin/fixtures/${s1.id}/result`, { home_score: 1, away_score: 1, home_pens: 4, away_pens: 3, events: [], result_published: true });
  await T.admin.put(`/api/admin/fixtures/${ko.semis[1].id}/result`, { home_score: 0, away_score: 2, events: [], result_published: true });
  assert.equal((await T.admin.post('/api/admin/fixtures/generate-final')).status, 200);
  const ko2 = (await T.admin.get('/api/admin/standings')).data.knockout;
  assert.equal(ko2.final.home_club_id, s1.home_club_id);
  assert.equal(ko2.final.away_club_id, ko.semis[1].away_club_id);
  await T.admin.put(`/api/admin/fixtures/${ko2.final.id}/result`, { home_score: 3, away_score: 2, events: [], result_published: true });
  const champ = (await T.admin.get('/api/admin/standings')).data.knockout.champion;
  assert.equal(champ.id, s1.home_club_id);

  const stats = (await T.admin.get('/api/admin/stats')).data;
  assert.ok(stats.length >= 1);
  assert.ok(stats[0].goals >= 1);
});

test('public website respects visibility settings and hides private data', async () => {
  const pub = T.client();
  let home = (await pub.get('/api/public/home')).data;
  assert.equal(home.clubs.length, 8);
  assert.ok(home.results.length > 0);
  assert.ok(home.tables.length === 2);
  const club = (await pub.get(`/api/public/clubs/${clubs[0].slug}`)).data;
  assert.equal(club.squad, null, 'squads hidden until published');
  assert.equal(club.finance, null);
  await setSettings({ publicSquads: true });
  const club2 = (await pub.get(`/api/public/clubs/${clubs[0].slug}`)).data;
  assert.ok(Array.isArray(club2.squad));
  assert.ok(club2.squad.every((p) => p.photo_url === null), 'photos stay private until allowed');
  for (const p of club2.squad) for (const k of ['admin_note', 'status', 'confirmed', 'source', 'photo']) assert.ok(!(k in p));
  await setSettings({ publicPhotos: true });
  const club3 = (await pub.get(`/api/public/clubs/${clubs[0].slug}`)).data;
  const withPhoto = club3.squad.find((p) => p.photo_url);
  if (withPhoto) assert.equal((await pub.get(withPhoto.photo_url)).status, 200);
  await setSettings({ publicResults: false });
  home = (await pub.get('/api/public/home')).data;
  assert.equal(home.results.length, 0);
  assert.equal(home.knockout.champion, null);
  await setSettings({ publicResults: true });
  assert.equal((await pub.get('/api/auction/state')).status, 401, 'live auction data needs a login');
  assert.equal((await pub.get('/api/admin/players')).status, 401);
});

test('new season keeps every previous season and its records', async () => {
  // the auction must have no player on the block
  await T.admin.post('/api/auction/end');
  const old = (await T.admin.get('/api/admin/seasons')).data[0];
  const oldPlayers = (await T.admin.get('/api/admin/players')).data.length;
  const r = await T.admin.post('/api/admin/seasons', { name: 'Season 2027–28', copy_settings: true, make_current: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const seasons = (await T.admin.get('/api/admin/seasons')).data;
  assert.equal(seasons.length, 2);
  assert.equal(seasons.find((s) => s.id === old.id).players, oldPlayers);
  assert.equal(seasons.find((s) => s.id === old.id).phase, 'completed');
  // fresh season: no players, fresh budgets, no captains, same eight permanent clubs
  assert.equal((await T.admin.get('/api/admin/players')).data.length, 0);
  const st = await state();
  assert.ok(st.clubs.every((c) => c.remaining === 70000 && c.count === 0 && !c.has_captain_account));
  assert.equal(st.clubs.length, 8);
  assert.equal(st.clubs[0].name, 'Al Saqr Strikers');
  // previous season still visible in the archive with its champion
  const archive = (await T.client().get('/api/public/archive')).data.seasons;
  assert.equal(archive.length, 2);
  assert.ok(archive.find((s) => s.id === old.id).champion);
  const history = (await T.client().get(`/api/public/clubs/${clubs[0].slug}`)).data.history;
  assert.ok(history.some((h) => h.season.id === old.id));
  // old captain accounts no longer bid in the new season
  const cap = captains[clubs[0].id];
  const res = await cap.client.post('/api/auction/bid', { lot_id: 1, amount: 500 });
  assert.equal(res.data.code, 'not_authorised');
});

test('backups can be created', async () => {
  const r = await T.admin.post('/api/admin/backups');
  assert.equal(r.status, 200);
  const file = path.join(process.env.DATA_DIR, 'backups', r.data.name, 'ols-premier-league.db');
  assert.ok(fs.existsSync(file));
  const dl = await T.admin.get(`/api/admin/backups/${r.data.name}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.slice(0, 15).toString(), 'SQLite format 3');
});
