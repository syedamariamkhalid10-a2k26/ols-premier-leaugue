/* Read-only projector display. Shows the live auction; never shows controls or private data. */
(function () {
  'use strict';
  let expiredKey = null;
  const { $, $$, esc, fmt, POS } = OLS;
  let state = null;
  let pending = null;   // state received while the SOLD animation is playing
  let animating = false;
  let lastBidId = null;
  let lastLotId = null;
  let conn = null;
  const R = 2 * Math.PI * 54;

  const clubById = (id) => (state ? state.clubs.find((c) => c.id === id) : null);

  function renderClubs() {
    const lead = state.lot ? state.lot.leading_club_id : null;
    $('#clubs').innerHTML = state.clubs.map((c) => `
      <div class="pj-club ${c.id === lead ? 'leading' : ''} ${c.open === 0 ? 'full' : ''}" data-club="${c.id}" style="--c1:${esc(c.primary_color)};--c2:${esc(c.secondary_color)}">
        <img src="${esc(c.logo_url)}" alt="">
        <div class="nm" title="${esc(c.name)}">${esc(c.name)}</div>
        <div class="bud" data-bud>${fmt(c.remaining)}<small>POINTS LEFT</small></div>
        <div class="pips">${Array.from({ length: c.max }, (_, i) => `<i class="${i < c.count ? 'f' : ''}"></i>`).join('')}</div>
        <div class="cnt" data-cnt>${c.count} / ${c.max} PLAYERS</div>
      </div>`).join('');
  }

  function renderStage() {
    const s = state;
    const live = s.session.status === 'live';
    $('#live').classList.toggle('off', !live);
    $('#live span').textContent = live ? 'Live Auction' : (s.session.status === 'ended' ? 'Auction closed' : 'Live Auction');
    const lot = s.lot;
    if (!lot) {
      $('#seq').textContent = `${s.counts.sold + s.counts.allocated} players placed`;
      const last = s.lastSale ? clubById(s.lastSale.club_id) : null;
      $('#stage').innerHTML = `<div class="pj-idle">
        <div class="tag">${live ? 'Live auction in progress' : s.session.status === 'ended' ? 'The auction has ended' : 'The auction will begin shortly'}</div>
        <h2>${live ? 'Next player <span>coming up</span>' : 'OLS <span>Premier</span> League'}</h2>
        <div class="tag" style="color:var(--g500);letter-spacing:.18em">Strength in Character · Trustworthiness in Action</div>
        <div class="stats">
          <div><b>${fmt(s.counts.sold)}</b><span>Sold</span></div>
          <div><b>${fmt(s.counts.allocated)}</b><span>Allocated</span></div>
          <div><b>${fmt(s.counts.ready)}</b><span>Still to come</span></div>
        </div>
        ${s.lastSale && last ? `<div class="last">Last sale: <b>${esc(s.lastSale.full_name)}</b> to <b>${esc(last.name)}</b> for <b>${fmt(s.lastSale.price)}</b> points</div>` : ''}
      </div>`;
      return;
    }
    $('#seq').textContent = `Auction lot ${lot.sequence_no}${lot.round > 1 ? ` · Round ${lot.round}` : ''} · ${s.counts.ready} to go`;
    const p = lot.player;
    const leader = clubById(lot.leading_club_id);
    if (lastLotId !== lot.id || !$('#pjName')) {
      lastLotId = lot.id;
      $('#stage').innerHTML = `
        <div class="pj-card" id="pjCard">
          <div class="ph">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : '<span class="silhouette"></span>'}</div>
          <div class="band"><span>${esc(POS[p.primary_position])}${p.secondary_position ? ` / ${esc(POS[p.secondary_position])}` : ''}</span><b>OLS PL</b></div>
        </div>
        <div class="pj-info">
          <div class="pj-status" id="pjStatus"></div>
          <h1 class="pj-name" id="pjName">${esc(p.full_name)}</h1>
          <div class="pj-meta">
            <span class="chip"><small>Class</small>${esc(p.class_grade)}</span>
            <span class="chip"><small>Preferred</small><span class="pos ${POS[p.primary_position]}">${POS[p.primary_position]}</span>${esc(p.primary_position)}</span>
            ${p.secondary_position ? `<span class="chip"><small>Secondary</small><span class="pos ${POS[p.secondary_position]}">${POS[p.secondary_position]}</span>${esc(p.secondary_position)}</span>` : ''}
          </div>
          <div class="pj-bid">
            <div class="pj-box"><div class="lbl">Starting bid</div><div class="val">${fmt(lot.starting_bid)}</div></div>
            <div class="pj-box current"><div class="lbl">Current highest bid</div><div class="val" id="pjBid"></div></div>
            <div class="pj-box leader" id="pjLeader"><div class="lbl">Leading club</div><div class="who" id="pjWho"></div></div>
            <div class="pj-timer" id="pjTimer"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="54"/><circle class="fg" id="pjRing" cx="60" cy="60" r="54" stroke-dasharray="${R}" stroke-dashoffset="0"/></svg>
              <div class="sec"><div><span id="pjSec">--</span><small>SECONDS</small></div></div></div>
          </div>
          <div class="pj-ticker" id="pjTicker"></div>
        </div>`;
    }
    $('#pjBid').innerHTML = lot.highest_bid == null ? '<span style="opacity:.55">No bids</span>' : `${fmt(lot.highest_bid)}<small>PTS</small>`;
    $('#pjLeader').style.setProperty('--lc', leader ? leader.primary_color : '#CBD2DD');
    $('#pjWho').innerHTML = leader ? `<img src="${esc(leader.logo_url)}" alt=""><b>${esc(leader.name)}</b>` : '<b style="color:var(--g400)">Awaiting first bid</b>';
    $('#pjTicker').innerHTML = lot.recent_bids.map((b) => { const c = clubById(b.club_id); return `<span style="--c:${esc(c ? c.primary_color : '#999')}">${esc(c ? c.short_name : '')} ${fmt(b.amount)}</span>`; }).join('');
    const st = $('#pjStatus');
    const timeUp = lot.status === 'open' && conn && conn.now() >= lot.timer_ends_at;
    st.className = 'pj-status ' + (timeUp ? 'timeup' : lot.status);
    st.textContent = timeUp ? 'Time up · awaiting confirmation' : lot.status === 'open' ? 'Bidding open' : lot.status === 'paused' ? 'Bidding paused' : 'Bidding opens shortly';
    if (lot.highest_bid_id && lot.highest_bid_id !== lastBidId) {
      const el = $('#pjBid'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      const tile = $(`.pj-club[data-club="${lot.leading_club_id}"]`);
      if (tile) { tile.classList.remove('flash'); void tile.offsetWidth; tile.classList.add('flash'); }
    }
    lastBidId = lot.highest_bid_id;
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!state || !state.lot || !$('#pjSec')) return;
    const lot = state.lot;
    let ms;
    if (lot.status === 'open') ms = Math.max(0, lot.timer_ends_at - conn.now());
    else if (lot.status === 'paused') ms = lot.paused_remaining_ms || 0;
    else ms = lot.timer_seconds * 1000;
    const frac = Math.max(0, Math.min(1, ms / (lot.timer_seconds * 1000)));
    $('#pjRing').setAttribute('stroke-dashoffset', String(R * (1 - frac)));
    const secs = Math.ceil(ms / 1000);
    const secEl = $('#pjSec');
    if (secEl.textContent !== String(secs)) {
      secEl.textContent = secs;
      $('#pjTimer').className = 'pj-timer' + (secs <= 3 ? ' end' : secs <= 7 ? ' warn' : '');
      if (lot.status === 'open' && ms === 0 && expiredKey !== `${lot.id}:${lot.timer_ends_at}`) { expiredKey = `${lot.id}:${lot.timer_ends_at}`; renderStage(); }
    }
  }

  function apply(s) {
    if (animating) { pending = s; return; }
    state = s;
    renderClubs();
    renderStage();
  }

  function countTo(el, from, to, ms) {
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.firstChild.nodeValue = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** SOLD sequence: announcement → player flies to the winning club → budget & squad update → next player. */
  async function sold(sale) {
    animating = true;
    const club = clubById(sale.club_id) || { name: '', logo_url: '', primary_color: '#1B2A4A' };
    const card = $('#pjCard');
    const from = card ? card.getBoundingClientRect() : null;
    const ov = document.createElement('div');
    ov.className = 'sold';
    ov.innerHTML = `<div class="stamp">SOLD</div>
      <div class="who">${esc(sale.player.full_name)}</div>
      <div class="to"><img src="${esc(club.logo_url)}" alt=""><div><b>${esc(club.name)}</b><span>for ${fmt(sale.price)} points</span></div></div>`;
    document.body.appendChild(ov);
    const stamp = ov.querySelector('.stamp');
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
    stamp.animate([{ transform: 'rotate(-6deg) scale(2.4)', opacity: 0 }, { transform: 'rotate(-6deg) scale(.92)', opacity: 1, offset: .7 }, { transform: 'rotate(-6deg) scale(1)', opacity: 1 }],
      { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' });
    ov.querySelector('.to').animate([{ transform: 'translateY(3vh)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, delay: 380, fill: 'both', easing: 'ease-out' });
    await wait(2100);

    const tile = $(`.pj-club[data-club="${sale.club_id}"]`);
    let fly = null;
    if (from && tile) {
      const to = tile.getBoundingClientRect();
      fly = document.createElement('div');
      fly.className = 'fly';
      Object.assign(fly.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.width * 1.25 + 'px' });
      fly.innerHTML = sale.player.photo_url ? `<img src="${esc(sale.player.photo_url)}" alt="">` : `<div style="width:100%;height:100%;background:linear-gradient(160deg,${esc(club.primary_color)},#1B2A4A)"></div>`;
      document.body.appendChild(fly);
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      const scale = Math.min(to.width / from.width, 0.3);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.width * 0.625);
      await fly.animate([
        { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.3 - 60}px) scale(${(1 + scale) / 2}) rotate(-4deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0)`, opacity: 0.2 },
      ], { duration: 1000, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished;
      fly.remove();
    } else {
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      await wait(400);
    }
    ov.remove();

    // land: update the club tile
    if (tile) {
      tile.classList.remove('flash', 'leading'); void tile.offsetWidth; tile.classList.add('flash');
      const plus = document.createElement('div'); plus.className = 'plus'; plus.textContent = '+1 PLAYER'; tile.appendChild(plus);
      const bud = tile.querySelector('[data-bud]');
      countTo(bud, sale.before.remaining, sale.after.remaining, 900);
      const pips = tile.querySelectorAll('.pips i');
      if (pips[sale.after.count - 1]) { pips[sale.after.count - 1].classList.add('f'); pips[sale.after.count - 1].animate([{ transform: 'scale(2.2)' }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' }); }
      tile.querySelector('[data-cnt]').textContent = `${sale.after.count} / ${sale.after.max} PLAYERS`;
      const r = tile.getBoundingClientRect();
      const w = document.createElement('div'); w.className = 'welcome';
      w.style.left = r.left + r.width / 2 + 'px'; w.style.top = r.top - 10 + 'px';
      w.textContent = `Welcome to ${club.short_name || club.name}`;
      document.body.appendChild(w);
      const half = w.offsetWidth / 2 + 8; // keep the label on screen for the outer tiles
      w.style.left = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half) + 'px';
      setTimeout(() => w.remove(), 2500);
    }
    await wait(1700);
    animating = false;
    lastLotId = null;
    if (pending) { const p = pending; pending = null; apply(p); }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // full screen + hide the cursor when idle
  $('#fs').addEventListener('click', toggleFs);
  document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
  function toggleFs() { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); }
  let idleT;
  const wake = () => { document.body.classList.remove('idle-cursor'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle-cursor'), 2500); };
  document.addEventListener('mousemove', wake); wake();

  OLS.requireUser(['admin', 'operator', 'projector']).then(() => {
    conn = OLS.liveConnection({
      onState: apply,
      onSold: (s) => { if (state) sold(s); },
      onStatus: (ok) => $('#offline').classList.toggle('hidden', ok),
    });
    requestAnimationFrame(tick);
  }).catch(() => {});
  void $$;
})();
