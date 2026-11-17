/* Auction operator console — kept deliberately simple for use during a live event. */
(function () {
  'use strict';
  let expiredKey = null;
  const { $, $$, esc, fmt, API, toast, playerCard, crest, avatar, posTag, confirmBox, modal } = OLS;
  let state = null; let queue = { ready: [], pending: [], recent: [], permissions: {} }; let conn = null; let online = false;
  let tab = 'ready'; let busy = false; let lastBidId = null; let lastLot = null;
  const club = (id) => state && state.clubs.find((c) => c.id === id);

  async function act(path, body, okMsg) {
    if (busy) return;
    if (!online) return toast('Offline — wait for the connection to return.', 'err');
    busy = true; renderLot();
    try { await API.post('/api/auction/' + path, body); if (okMsg) toast(okMsg, 'ok'); await loadQueue(); } catch (e) { toast(e.message, 'err', 5000); } finally { busy = false; renderLot(); }
  }

  function renderSession() {
    const s = state.session.status;
    $('#sess').innerHTML = `<span class="badge ${s === 'live' ? 'green' : s === 'ended' ? '' : 'amber'}" style="font-size:13px;padding:6px 12px">${s === 'live' ? '● LIVE' : s === 'ended' ? 'Auction ended' : 'Not started'}</span>
      <b>${esc(state.season.name)}</b>
      ${s !== 'live' ? '<button class="btn green" data-a="start">Start auction</button>' : '<button class="btn ghost" data-a="end">End auction</button>'}`;
  }

  function renderLot() {
    if (!state) return;
    const lot = state.lot;
    const box = $('#lot');
    const dis = busy || !online ? 'disabled' : '';
    if (!lot) {
      lastLot = null;
      box.innerHTML = `<div class="empty"><h2 style="text-transform:uppercase">No player on the block</h2>
        <p>${state.session.status === 'live' ? 'Choose the next player from the queue, or present the next one in order.' : 'Start the auction to begin presenting players.'}</p>
        ${state.session.status === 'live' && queue.ready.length ? `<button class="btn red lg" data-a="next" ${dis}>Present next: ${esc(queue.ready[0].full_name)} ▶</button>` : ''}</div>`;
      return;
    }
    const leader = club(lot.leading_club_id);
    const timeUp = lot.status === 'open' && conn.now() >= lot.timer_ends_at;
    const hasBids = lot.highest_bid != null;
    let buttons = '';
    if (lot.status === 'presenting') buttons = `<button class="btn green" data-a="open" ${dis}>▶ Start bidding</button><button class="btn ghost" data-a="cancel" ${dis}>Return to queue</button><button class="btn ghost" data-a="unsold" ${dis}>Skip → allocation</button>`;
    else {
      buttons = `<button class="btn sold ${timeUp && hasBids ? 'pulse' : ''}" data-a="sold" ${dis || (!hasBids ? 'disabled' : '')}>✓ CONFIRM SOLD${hasBids ? ` — ${esc(leader ? leader.short_name : '')} ${fmt(lot.highest_bid)}` : ''}</button>`;
      buttons += lot.status === 'open' ? `<button class="btn gold" data-a="pause" ${dis}>⏸ Pause</button>` : `<button class="btn" data-a="open" ${dis}>▶ Resume</button>`;
      buttons += `<button class="btn ghost" data-a="restart" ${dis}>↻ Restart timer</button>`;
      buttons += `<button class="btn ghost" data-a="unsold" ${dis}>${hasBids ? 'Discard bids → allocation' : 'No bids → allocation'}</button>`;
      if (queue.permissions.correct) buttons += `<button class="btn danger-ghost" data-a="undo" ${dis || (!hasBids ? 'disabled' : '')}>Undo last bid</button><button class="btn danger-ghost" data-a="cancel" ${dis}>Withdraw player</button>`;
    }
    const statusCls = timeUp ? 'timeup' : lot.status;
    const statusTxt = timeUp ? 'Time up — confirm the sale' : lot.status === 'open' ? 'Bidding open' : lot.status === 'paused' ? 'Paused' : 'Presenting — bidding not started';
    box.innerHTML = `<div class="lotbox">${playerCard(lot.player)}
      <div><div class="row between"><span class="statusline ${statusCls}" id="sline">${statusTxt}</span><span class="muted small">Lot ${lot.sequence_no}${lot.round > 1 ? ` · Round ${lot.round}` : ''}</span></div>
        <h2>${esc(lot.player.full_name)}</h2>
        <div class="row small muted">${esc(lot.player.class_grade)} ${posTag(lot.player.primary_position)} ${lot.player.secondary_position ? posTag(lot.player.secondary_position, true) : ''}</div>
        <div class="bigbid">
          <div><div class="l">Highest bid</div><div class="v num">${hasBids ? fmt(lot.highest_bid) : '—'}</div><div class="small muted">Start ${fmt(lot.starting_bid)} · +${fmt(lot.min_increment)}</div></div>
          <div><div class="l">Leading club</div>${leader ? `<div class="club-name mt1">${crest(leader, 'sm')}${esc(leader.name)}</div>` : '<div class="muted mt1">No bids yet</div>'}<div class="small muted">${lot.bid_count} bid(s)</div></div>
          <div class="t" id="tbox"><div class="l">Timer</div><div class="v num" id="tsec">--</div></div>
        </div>
        <div class="ctrl">${buttons}</div>
      </div></div>
      <h3 class="mt2">Bid log</h3><div class="bidlog" id="bidlog"><p class="muted small">No bids yet.</p></div>`;
    if (lastLot !== lot.id || lastBidId !== lot.highest_bid_id) { lastLot = lot.id; lastBidId = lot.highest_bid_id; loadBids(lot.id); } else if (bidHtml) $('#bidlog').innerHTML = bidHtml;
  }

  let bidHtml = '';
  async function loadBids(lotId) {
    try {
      const bids = await API.get(`/api/auction/lots/${lotId}/bids`);
      bidHtml = bids.length ? bids.map((b) => { const c = club(b.club_id); return `<div class="r ${b.status}"><span>${c ? crest(c, 'sm').replace('class="crest sm"', 'class="crest sm" style="display:inline;vertical-align:middle;width:18px;height:20px"') : ''} ${esc(c ? c.name : '')}</span><span class="num"><b>${fmt(b.amount)}</b> ${b.status !== 'accepted' ? `<small>(${esc(b.status)}${b.reason ? ': ' + esc(b.reason.replace(/_/g, ' ')) : ''})</small>` : ''} <small class="muted">${new Date(b.created_at).toLocaleTimeString()}</small></span></div>`; }).join('') : '<p class="muted small">No bids yet.</p>';
      const el = $('#bidlog'); if (el) el.innerHTML = bidHtml;
    } catch { /* ignore */ }
  }

  function renderClubs() {
    const lead = state.lot ? state.lot.leading_club_id : null;
    $('#placed').textContent = `${state.counts.sold} sold · ${state.counts.allocated} allocated · ${state.counts.ready} in queue`;
    $('#clubs').innerHTML = `<table class="t"><thead><tr><th>Club</th><th class="n">Remaining</th><th class="n">Players</th><th class="n">Max bid</th><th class="hide-sm">Captain login</th></tr></thead><tbody>
      ${state.clubs.map((c) => `<tr class="${c.id === lead ? 'selected' : ''}"><td><span class="club-name">${crest(c, 'sm')}${esc(c.name)}</span></td><td class="n"><b>${fmt(c.remaining)}</b></td><td class="n">${c.count}/${c.max}</td><td class="n">${c.open ? fmt(c.maxBid) : 'Full'}</td><td class="hide-sm">${c.has_captain_account ? '<span class="badge green">Ready</span>' : '<span class="badge red">None</span>'}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderQueue() {
    $('#nReady').textContent = queue.ready.length; $('#nPending').textContent = queue.pending.length;
    const q = ($('#qsearch').value || '').toLowerCase();
    const live = state && state.session.status === 'live' && !state.lot;
    const dis = live && online && !busy ? '' : 'disabled';
    $('#qtools').classList.toggle('hidden', tab === 'recent');
    $('#nextBtn').disabled = !live || !queue.ready.length;
    let html = '';
    if (tab === 'ready') {
      const list = queue.ready.filter((p) => !q || p.full_name.toLowerCase().includes(q) || (p.class_grade || '').toLowerCase().includes(q));
      html = list.map((p, i) => `<div class="qrow">${avatar(p.photo_url, 'sm')}<div class="grow"><b>${esc(p.full_name)}</b><span class="small muted">${esc(p.class_grade)}</span> ${posTag(p.primary_position)} ${p.secondary_position ? posTag(p.secondary_position, true) : ''}</div>
        ${i === 0 && !q ? '<span class="badge navy">Next</span>' : ''}<button class="btn sm" data-present="${p.id}" ${dis}>Present</button></div>`).join('') || '<div class="empty">No players in the auction queue.<br><small>The administrator adds approved players to the auction list.</small></div>';
    } else if (tab === 'pending') {
      const list = queue.pending.filter((p) => !q || p.full_name.toLowerCase().includes(q));
      html = (queue.permissions.allocate && list.length ? `<div class="row end mb2"><button class="btn gold sm" data-distribute ${state && state.lot ? 'disabled' : ''}>Distribute all automatically</button></div>` : '')
        + (list.map((p) => `<div class="qrow">${avatar(p.photo_url, 'sm')}<div class="grow"><b>${esc(p.full_name)}</b><span class="small muted">${esc(p.class_grade)}</span> ${posTag(p.primary_position)}</div>
        <button class="btn ghost sm" data-present="${p.id}" ${dis}>Second round</button>${queue.permissions.allocate ? `<button class="btn sm" data-allocate="${p.id}">Allocate</button>` : ''}</div>`).join('') || '<div class="empty">Nobody is waiting for allocation.</div>');
    } else {
      html = queue.recent.map((l) => { const c = club(l.leading_club_id); return `<div class="qrow"><div class="grow"><b>${esc(l.full_name)}</b><span class="small muted">Lot ${l.sequence_no}${l.round > 1 ? ' · round ' + l.round : ''}</span></div>
        ${l.status === 'sold' ? `<span class="club-name small">${c ? crest(c, 'sm') : ''}${fmt(l.highest_bid)}</span>` : `<span class="badge ${l.status === 'unsold' ? 'amber' : ''}">${l.status === 'unsold' ? 'No sale' : 'Withdrawn'}</span>`}</div>`; }).join('') || '<div class="empty">Nothing yet.</div>';
    }
    $('#queue').innerHTML = html;
  }

  async function loadQueue() {
    try { queue = await API.get('/api/auction/queue'); renderQueue(); if (state && !state.lot) renderLot(); } catch (e) { toast(e.message, 'err'); }
  }

  function tick() {
    requestAnimationFrame(tick);
    const lot = state && state.lot; const el = $('#tsec');
    if (!lot || !el) return;
    const ms = lot.status === 'open' ? Math.max(0, lot.timer_ends_at - conn.now()) : lot.status === 'paused' ? (lot.paused_remaining_ms || 0) : lot.timer_seconds * 1000;
    const s = Math.ceil(ms / 1000);
    if (el.textContent !== String(s)) {
      el.textContent = s;
      $('#tbox').className = 't' + (s <= 3 ? ' end' : s <= 7 ? ' warn' : '');
      if (lot.status === 'open' && ms === 0 && expiredKey !== `${lot.id}:${lot.timer_ends_at}`) { expiredKey = `${lot.id}:${lot.timer_ends_at}`; renderLot(); }
    }
  }

  async function allocate(pid) {
    const p = queue.pending.find((x) => x.id === pid);
    const options = state.clubs.filter((c) => c.open > 0).map((c) => `<option value="${c.id}">${esc(c.name)} — ${c.count}/${c.max} players, ${fmt(c.remaining)} pts</option>`).join('');
    await modal({
      title: `Allocate ${p.full_name}`,
      body: `<form data-f><label class="field"><span>Club</span><select name="club_id" required>${options}</select></label>
        <label class="field"><span>Price in points <em>(usually 0 for allocation)</em></span><input type="number" name="price" min="0" value="0"></label>
        <label class="field"><span>Reason (saved in the audit log)</span><input type="text" name="reason" value="No valid bid received" maxlength="200"></label></form>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Allocate player', handler: async (el) => { const d = OLS.formData($('[data-f]', el)); await API.post('/api/auction/allocate', { player_id: pid, ...d }); toast('Player allocated.', 'ok'); await loadQueue(); } }],
    });
  }

  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (a) {
      const lot = state.lot; const k = a.dataset.a;
      if (k === 'start') return act('start', {}, 'Auction is live.');
      if (k === 'end') { const c = await confirmBox({ title: 'End the auction?', message: 'Captains will no longer be able to bid. You can start it again later for a second round.', confirm: 'End auction' }); if (c) act('end'); return; }
      if (k === 'next') return queue.ready[0] && act('present', { player_id: queue.ready[0].id });
      if (!lot) return;
      if (k === 'open') return act('open', { lot_id: lot.id });
      if (k === 'pause') return act('pause', { lot_id: lot.id });
      if (k === 'restart') return act('restart-timer', { lot_id: lot.id });
      if (k === 'sold') {
        const leader = club(lot.leading_club_id);
        const running = lot.status === 'open' && conn.now() < lot.timer_ends_at;
        if (running) { const c = await confirmBox({ title: 'Sell now?', message: `The timer is still running. Sell <b>${esc(lot.player.full_name)}</b> to <b>${esc(leader ? leader.name : '')}</b> for <b>${fmt(lot.highest_bid)}</b> points now?`, confirm: 'Confirm SOLD' }); if (!c) return; }
        return act('sold', { lot_id: lot.id });
      }
      if (k === 'unsold') {
        const has = lot.highest_bid != null;
        const c = await confirmBox({ title: has ? 'Discard the bids?' : 'No bids received', message: has ? 'This discards all bids and moves the player to <b>Awaiting allocation</b>.' : `Move <b>${esc(lot.player.full_name)}</b> to <b>Awaiting allocation</b>? They can go to a second round or be allocated.`, confirm: 'Move to allocation', danger: has });
        if (c) act('unsold', { lot_id: lot.id, force: has });
        return;
      }
      if (k === 'undo') { const c = await confirmBox({ title: 'Undo the last bid?', message: 'The previous bid becomes the highest bid again and the timer restarts. This is recorded in the audit log.', confirm: 'Undo bid', danger: true }); if (c) act('undo-bid', { lot_id: lot.id }); return; }
      if (k === 'cancel') { const c = await confirmBox({ title: 'Return player to the queue?', message: 'The player leaves the block and any bids on this player are cancelled.', confirm: 'Return to queue', danger: lot.highest_bid != null }); if (c) act('cancel', { lot_id: lot.id }); return; }
    }
    const pr = e.target.closest('[data-present]');
    if (pr) return act('present', { player_id: Number(pr.dataset.present) });
    const al = e.target.closest('[data-allocate]');
    if (al) return allocate(Number(al.dataset.allocate));
    if (e.target.closest('[data-distribute]')) {
      const c = await confirmBox({ title: 'Distribute automatically?', message: `All ${queue.pending.length} players awaiting allocation will be shared out (0 points) to the clubs with the most free places. Every allocation is recorded.`, confirm: 'Distribute' });
      if (c) { try { const r = await API.post('/api/auction/distribute'); toast(`${r.allocated.length} players allocated.`, 'ok'); await loadQueue(); } catch (x) { toast(x.message, 'err'); } }
    }
  });
  $('#nextBtn').addEventListener('click', () => queue.ready[0] && act('present', { player_id: queue.ready[0].id }));
  $('#qsearch').addEventListener('input', renderQueue);
  $$('#qtabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; $$('#qtabs button').forEach((x) => x.classList.toggle('active', x === b)); renderQueue(); }));

  OLS.requireUser(['admin', 'operator']).then((me) => {
    $('#top').innerHTML = OLS.topbar({ title: 'Auction Operator', user: me.user, menu: false,
      extra: `${me.user.role === 'admin' ? '<a class="btn ghost sm hide-sm" href="/admin">Admin</a>' : ''}<span class="conn off" id="conn"><span class="dot"></span><span>Offline</span></span>` });
    OLS.bindTopbar();
    conn = OLS.liveConnection({
      onState: (s) => { const changed = !state || (state.lot && state.lot.id) !== (s.lot && s.lot.id); state = s; renderSession(); renderLot(); renderClubs(); if (changed) loadQueue(); else renderQueue(); },
      onSold: (s) => { const c = club(s.club_id); toast(`SOLD: ${s.player.full_name} → ${c ? c.name : ''} for ${fmt(s.price)}`, 'ok', 4000); },
      onStatus: (ok) => { online = ok; $('#offline').classList.toggle('hidden', ok); const el = $('#conn'); el.classList.toggle('off', !ok); el.lastElementChild.textContent = ok ? 'Connected' : 'Offline'; if (ok) loadQueue(); if (state) { renderLot(); renderQueue(); } },
    });
    loadQueue();
    requestAnimationFrame(tick);
  }).catch(() => {});
})();
