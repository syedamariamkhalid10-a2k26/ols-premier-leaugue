/* Visual squad manager: starting players on a pitch, substitutes on the bench. Used by captains and administrators. */
(function () {
  'use strict';
  const { esc, POS } = OLS;
  const FORMATIONS = {
    '2-1-1': [['GK', 50, 87, 'GK'], ['D1', 28, 66, 'DEF'], ['D2', 72, 66, 'DEF'], ['M1', 50, 45, 'MID'], ['F1', 50, 20, 'FWD']],
    '1-2-1': [['GK', 50, 87, 'GK'], ['D1', 50, 68, 'DEF'], ['M1', 25, 46, 'MID'], ['M2', 75, 46, 'MID'], ['F1', 50, 20, 'FWD']],
    '2-2': [['GK', 50, 87, 'GK'], ['D1', 28, 64, 'DEF'], ['D2', 72, 64, 'DEF'], ['F1', 30, 28, 'FWD'], ['F2', 70, 28, 'FWD']],
    '3-1': [['GK', 50, 87, 'GK'], ['D1', 20, 62, 'DEF'], ['D2', 50, 67, 'DEF'], ['D3', 80, 62, 'DEF'], ['F1', 50, 26, 'FWD']],
    '1-1-2': [['GK', 50, 87, 'GK'], ['D1', 50, 69, 'DEF'], ['M1', 50, 49, 'MID'], ['F1', 30, 25, 'FWD'], ['F2', 70, 25, 'FWD']],
  };
  function genericSlots(n) {
    const out = [['GK', 50, 87, 'GK']];
    const rest = n - 1; const rows = rest <= 3 ? 1 : rest <= 6 ? 2 : 3;
    let k = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.ceil((rest - k) / (rows - r));
      for (let i = 0; i < inRow; i++, k++) out.push([`P${k + 1}`, ((i + 1) * 100) / (inRow + 1), 64 - r * (44 / rows), 'PLAY']);
    }
    return out;
  }

  /** mount(el, squad, { onSave(body) -> Promise(newSquad), readOnly }) */
  function mount(el, squad, opts = {}) {
    let data = squad;
    let formation = data.formation || Object.keys(FORMATIONS)[0];
    let picked = null; // { kind: 'member', id } or { kind: 'slot', slot }
    let lineup = new Map(); // slotId -> memberId
    const subs = () => Array.from({ length: data.subs }, (_, i) => `S${i + 1}`);
    function load() {
      lineup = new Map();
      for (const m of data.members) {
        if (m.lineup_role === 'starter' && m.lineup_slot) lineup.set(m.lineup_slot, m.id);
        if (m.lineup_role === 'sub') { const free = subs().find((s) => !lineup.has(s)); if (free) lineup.set(free, m.id); }
      }
      // place starters without a slot (or from an older formation) into free slots
      const slots = slotList().map((s) => s[0]);
      for (const [k] of [...lineup]) if (!slots.includes(k) && !k.startsWith('S')) lineup.delete(k);
      for (const m of data.members.filter((x) => x.lineup_role === 'starter' && ![...lineup.values()].includes(x.id))) {
        const free = slots.find((s) => !lineup.has(s)); if (free) lineup.set(free, m.id);
      }
    }
    const slotList = () => (data.starters === 5 && FORMATIONS[formation] ? FORMATIONS[formation] : genericSlots(data.starters));
    const member = (id) => data.members.find((m) => m.id === id);
    const placedIds = () => new Set(lineup.values());

    function render() {
      const placed = placedIds();
      const reserves = data.members.filter((m) => !placed.has(m.id));
      const slotHtml = (sid, x, y, label) => {
        const m = member(lineup.get(sid));
        const sel = picked && picked.kind === 'slot' && picked.slot === sid;
        return `<div class="slot ${m ? 'filled' : ''} ${sel || (picked && !m) ? 'target' : ''}" data-slot="${sid}" style="left:${x}%;top:${y}%">
          <div class="disc">${m ? (m.photo_url ? `<img src="${esc(m.photo_url)}" alt="">` : esc(POS[m.primary_position])) : esc(label)}</div>
          <div class="lbl">${m ? esc(m.full_name.split(' ')[0]) : esc(label)}</div></div>`;
      };
      const chip = (m, extra = '') => `<button type="button" class="pchip ${picked && picked.kind === 'member' && picked.id === m.id ? 'sel' : ''}" data-member="${m.id}">
          ${OLS.avatar(m.photo_url, 'sm')}<span><b>${esc(m.full_name)}${m.is_captain ? ' (C)' : ''}</b><small>${esc(m.primary_position)}${m.secondary_position ? ' / ' + esc(m.secondary_position) : ''}</small>${extra}</span></button>`;
      el.innerHTML = `
        <div class="row between mb2">
          ${data.formations && data.formations.length ? `<label class="row nowrap" style="gap:8px"><b class="small">Formation</b><select data-formation ${opts.readOnly ? 'disabled' : ''}>${data.formations.map((f) => `<option ${f === formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>` : '<span></span>'}
          ${opts.readOnly ? '' : '<div class="row"><button class="btn ghost sm" data-clear type="button">Clear</button><button class="btn red sm" data-save type="button">Save lineup</button></div>'}
        </div>
        <p class="small muted mt0">${opts.readOnly ? '' : 'Tap a player, then tap a position. Tap two positions to swap players.'}</p>
        <div class="grid c2" style="align-items:start">
          <div><div class="pitch"><div class="box"></div>${slotList().map(([sid, x, y, label]) => slotHtml(sid, x, y, label)).join('')}</div></div>
          <div>
            <h3 class="mt0">Substitutes <span class="muted small">(${data.subs})</span></h3>
            <div class="bench mb2">${subs().map((sid) => { const m = member(lineup.get(sid)); return m ? chip(m).replace('class="pchip', `data-slot="${sid}" class="pchip`) : `<button type="button" class="pchip ${picked ? 'sel' : ''}" data-slot="${sid}"><span class="avatar sm silhouette"></span><span><b>Empty</b><small>Substitute place</small></span></button>`; }).join('')}</div>
            <h3>Not selected <span class="muted small">(${reserves.length})</span></h3>
            <div class="bench">${reserves.map((m) => chip(m)).join('') || '<p class="muted small">Everyone has a place.</p>'}</div>
          </div>
        </div>`;
    }

    el.addEventListener('click', async (e) => {
      if (opts.readOnly) return;
      if (e.target.closest('[data-save]')) return save();
      if (e.target.closest('[data-clear]')) { lineup.clear(); picked = null; return render(); }
      const slotEl = e.target.closest('[data-slot]');
      const memEl = e.target.closest('[data-member]');
      if (slotEl) {
        const sid = slotEl.dataset.slot;
        if (picked && picked.kind === 'member') {
          for (const [k, v] of [...lineup]) if (v === picked.id) lineup.delete(k);
          const prev = lineup.get(sid);
          lineup.set(sid, picked.id);
          void prev; picked = null;
        } else if (picked && picked.kind === 'slot') {
          if (picked.slot !== sid) { const a = lineup.get(picked.slot); const b = lineup.get(sid); if (b) lineup.set(picked.slot, b); else lineup.delete(picked.slot); if (a) lineup.set(sid, a); else lineup.delete(sid); }
          picked = null;
        } else if (lineup.has(sid)) picked = { kind: 'slot', slot: sid };
        return render();
      }
      if (memEl) {
        const id = Number(memEl.dataset.member);
        if (picked && picked.kind === 'slot') { // put this reserve into the picked slot
          for (const [k, v] of [...lineup]) if (v === id) lineup.delete(k);
          lineup.set(picked.slot, id); picked = null;
        } else picked = picked && picked.id === id ? null : { kind: 'member', id };
        return render();
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-formation]')) {
        const starters = slotList().map(([s]) => lineup.get(s)).filter(Boolean);
        formation = e.target.value;
        for (const s of slotList().map(([x]) => x)) lineup.delete(s);
        for (const [k] of [...lineup]) if (!k.startsWith('S')) lineup.delete(k);
        slotList().forEach(([s], i) => { if (starters[i]) lineup.set(s, starters[i]); });
        render();
      }
    });

    async function save() {
      const body = {
        formation: data.formations && data.formations.length ? formation : null,
        members: data.members.map((m) => {
          const slot = [...lineup].find(([, v]) => v === m.id);
          if (!slot) return { id: m.id, role: 'unset' };
          return slot[0].startsWith('S') ? { id: m.id, role: 'sub' } : { id: m.id, role: 'starter', slot: slot[0] };
        }),
      };
      const btn = el.querySelector('[data-save]'); btn.disabled = true;
      try { data = await opts.onSave(body); load(); render(); OLS.toast('Lineup saved.', 'ok'); } catch (err) { OLS.toast(err.message, 'err', 5000); } finally { const b = el.querySelector('[data-save]'); if (b) b.disabled = false; }
    }

    load(); render();
    return { update(s) { data = s; formation = s.formation || formation; load(); render(); } };
  }

  window.Lineup = { mount, FORMATIONS };
})();
