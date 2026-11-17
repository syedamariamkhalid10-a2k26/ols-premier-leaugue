/* Captain dashboard: bid for your own club, follow the auction, manage your starting five. */
(function () {
  'use strict';
  let expiredKey = null;
  const { $, $$, esc, fmt, API, toast, playerCard, crest } = OLS;
  let me = null; let myClub = null; let state = null; let conn = null; let online = false;
  let raise = 0; let pending = false; let lastLotId = null; let lineup = null; let lastBidSeen = null;

  const club = (id) => state && state.clubs.find((c) => c.id === id);

  function renderHeader() {
    const c = club(myClub);
    if (!c) return;
    const bar = $('#clubbar');
    bar.style.setProperty('--c1', c.primary_color);
    bar.innerHTML = `${crest(c, 'lg')}<div class="grow"><div class="small muted upper" style="font-weight:700">Captain</div><h2>${esc(c.name)}</h2><div class="small muted">${esc(me.user.display_name)}</div></div>`;
    $('#money').innerHTML = `<div><b>${fmt(c.remaining)}</b><span>Points left</span></div>
      <div><b>${c.count}/${c.max}</b><span>Players</span></div>
      <div><b>${c.open ? fmt(c.maxBid) : '—'}</b><span>Max bid</span></div>`;
  }

  function myBid(lot, c) {
    const base = lot.next_bid;
    return Math.min(base + raise, c ? c.maxBid : base);
  }

  function renderLot() {
    const box = $('#lot');
    const lot = state.lot;
    const c = club(myClub);
    if (!lot) {
      lastLotId = null;
      box.innerHTML = `<div class="waiting"><h3>${state.session.status === 'live' ? 'Next player coming up' : state.session.status === 'ended' ? 'The auction has ended' : 'The auction has not started'}</h3>
        <p class="muted">Keep this page open. It updates automatically.</p>
        ${state.lastSale ? `<p class="small">Last sale: <b>${esc(state.lastSale.full_name)}</b> → ${esc((club(state.lastSale.club_id) || {}).name || '')} for <b>${fmt(state.lastSale.price)}</b></p>` : ''}</div>`;
      return;
    }
    if (lastLotId !== lot.id) { raise = 0; lastLotId = lot.id; setFb(''); }
    const leader = club(lot.leading_club_id);
    const leadingMe = lot.leading_club_id === myClub;
    const timeUp = lot.status === 'open' && conn.now() >= lot.timer_ends_at;
    const amount = myBid(lot, c);
    let reason = '';
    if (!online) reason = 'Reconnecting…';
    else if (state.session.status !== 'live') reason = 'Auction not live';
    else if (lot.status === 'presenting') reason = 'Bidding opens soon';
    else if (lot.status === 'paused') reason = 'Bidding paused';
    else if (timeUp) reason = 'Time is up';
    else if (leadingMe) reason = 'You are the highest bidder';
    else if (!c || c.open <= 0) reason = 'Your squad is full';
    else if (c.maxBid < lot.next_bid) reason = 'Not enough points';
    else if (pending) reason = 'Sending…';
    const canBid = !reason;
    box.innerHTML = `
      <div class="lot-top">${playerCard(lot.player, { size: 'sm' })}
        <div class="grow"><span class="status ${timeUp ? 'timeup' : lot.status}">${timeUp ? 'Time up' : lot.status === 'open' ? 'Bidding open' : lot.status === 'paused' ? 'Paused' : 'On the block'}</span>
          <h3>${esc(lot.player.full_name)}</h3>
          <div class="small muted">${esc(lot.player.class_grade)} · ${esc(lot.player.primary_position)}${lot.player.secondary_position ? ' / ' + esc(lot.player.secondary_position) : ''}</div>
          <div class="small muted mt1">Lot ${lot.sequence_no}${lot.round > 1 ? ` · Round ${lot.round}` : ''} · Starting bid ${fmt(lot.starting_bid)}</div></div></div>
      <div class="timerbar" id="tb"><i id="tbi"></i></div>
      <div class="hb">
        <div><div class="l">Highest bid</div><div class="v num">${lot.highest_bid == null ? '—' : fmt(lot.highest_bid)}</div><div class="small muted"><span id="secs"></span></div></div>
        <div><div class="l">Leading club</div>${leader ? `<div class="lead ${leadingMe ? 'me' : ''}">${crest(leader, 'sm')}<span>${leadingMe ? 'Your club!' : esc(leader.name)}</span></div>` : '<div class="lead muted">No bids yet</div>'}</div>
      </div>
      <div class="bidzone">
        <button class="bidbtn ${leadingMe ? 'leading' : ''}" id="bid" ${canBid ? '' : 'disabled'}>${canBid ? `BID ${fmt(amount)}` : esc(leadingMe ? '✓ LEADING' : 'BID')}<small>${canBid ? `Next valid bid: ${fmt(lot.next_bid)} points` : esc(reason)}</small></button>
        <div class="raise">${[0, 200, 500, 1000].map((r) => `<button class="btn ${raise === r ? '' : 'ghost'} sm" data-raise="${r}" ${canBid ? '' : 'disabled'}>${r ? `+${fmt(r)}` : 'Minimum'}</button>`).join('')}</div>
        <div class="fb" id="fb"></div>
      </div>`;
    if (lot.highest_bid_id !== lastBidSeen) {
      if (lastBidSeen !== null && lot.highest_bid_id && !leadingMe && lot.leading_club_id) { if (navigator.vibrate) navigator.vibrate(60); }
      lastBidSeen = lot.highest_bid_id;
    }
    setFb(fbText, fbType);
  }

  let fbText = ''; let fbType = '';
  function setFb(t, type = '') { fbText = t; fbType = type; const el = $('#fb'); if (el) { el.textContent = t; el.className = 'fb ' + type; } }

  function renderMine() {
    API.get('/api/auction/my-squad').then((sq) => {
      $('#mine').innerHTML = `<div class="card-head"><h3>Purchased players</h3><span class="badge navy">${sq.members.length} / ${sq.squadSize}</span></div>
        ${sq.members.length ? `<div class="squad-grid">${sq.members.map((m) => playerCard(m, { club: sq.club, size: 'sm', extra: `<div class="small muted">${m.method === 'auction' ? fmt(m.price) + ' pts' : m.method === 'captain' ? '' : 'Allocated'}</div>` })).join('')}</div>` : '<p class="muted">No players yet.</p>'}`;
      if (lineup) lineup.update(sq);
    }).catch(() => {});
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!state || !state.lot || !$('#tbi')) return;
    const lot = state.lot;
    const ms = lot.status === 'open' ? Math.max(0, lot.timer_ends_at - conn.now()) : lot.status === 'paused' ? (lot.paused_remaining_ms || 0) : lot.timer_seconds * 1000;
    const frac = ms / (lot.timer_seconds * 1000);
    $('#tbi').style.width = (frac * 100).toFixed(1) + '%';
    const s = Math.ceil(ms / 1000);
    $('#tb').className = 'timerbar' + (s <= 3 ? ' end' : s <= 7 ? ' warn' : '');
    const secs = $('#secs');
    const txt = lot.status === 'open' ? `${s}s left` : lot.status === 'paused' ? 'Paused' : '';
    if (secs.textContent !== txt) { secs.textContent = txt; if (lot.status === 'open' && ms === 0 && expiredKey !== `${lot.id}:${lot.timer_ends_at}`) { expiredKey = `${lot.id}:${lot.timer_ends_at}`; renderLot(); } }
  }

  function placeBid() {
    const lot = state.lot; const c = club(myClub);
    if (!lot || pending || !online) return;
    const amount = myBid(lot, c);
    pending = true; renderLot(); setFb('Sending bid…');
    const payload = { lot_id: lot.id, amount, client_bid_id: OLS.uid() };
    conn.socket.timeout(8000).emit('bid', payload, (err, res) => {
      pending = false;
      if (err) { setFb('No confirmation from the server. Showing the latest confirmed state.', 'err'); conn.socket.emit('state:get', (s) => onState(s)); return; }
      if (res.ok) { raise = 0; setFb(`✓ Bid accepted: ${fmt(res.bid.amount)} points`, 'ok'); if (navigator.vibrate) navigator.vibrate([30, 40, 30]); } else setFb(res.message || 'Bid not accepted.', 'err');
      renderLot();
    });
  }

  function onState(s) {
    const prevCount = state ? (club(myClub) || {}).count : null;
    state = s;
    renderHeader(); renderLot();
    const c = club(myClub);
    if (c && prevCount !== null && c.count !== prevCount) renderMine();
  }

  $('#lot').addEventListener('click', (e) => {
    if (e.target.closest('#bid')) return placeBid();
    const r = e.target.closest('[data-raise]');
    if (r) { raise = Number(r.dataset.raise); renderLot(); }
  });
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
    $('#tab-auction').classList.toggle('hidden', b.dataset.tab !== 'auction');
    $('#tab-squad').classList.toggle('hidden', b.dataset.tab !== 'squad');
    if (b.dataset.tab === 'squad' && !lineup) {
      API.get('/api/auction/my-squad').then((sq) => { lineup = Lineup.mount($('#lineup'), sq, { onSave: (body) => API.put('/api/auction/my-squad', body) }); });
    }
  }));

  OLS.requireUser(['captain']).then((m) => {
    me = m; myClub = m.club_id;
    $('#top').innerHTML = OLS.topbar({ title: 'Captain', user: m.user, menu: false, extra: '<span class="conn off" id="conn"><span class="dot"></span><span>Offline</span></span>' });
    OLS.bindTopbar();
    if (!myClub) { $('#lot').innerHTML = '<div class="waiting"><h3>No club linked</h3><p class="muted">Your account is not linked to a club for this season. Please contact the administrator.</p></div>'; return; }
    conn = OLS.liveConnection({
      onState,
      onSold: (s) => { const c = club(s.club_id); if (s.club_id === myClub) toast(`${s.player.full_name} joined your squad for ${fmt(s.price)} points!`, 'ok', 4500); else toast(`SOLD: ${s.player.full_name} → ${c ? c.name : ''} (${fmt(s.price)})`, '', 3000); },
      onStatus: (ok) => {
        online = ok;
        $('#offline').classList.toggle('hidden', ok);
        const el = $('#conn'); el.classList.toggle('off', !ok); el.lastElementChild.textContent = ok ? 'Live' : 'Offline';
        if (!ok) pending = false;
        if (state) renderLot();
      },
    });
    renderMine();
    requestAnimationFrame(tick);
  }).catch(() => {});
})();
