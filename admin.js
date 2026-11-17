/* Super Administrator application (single page, hash routes). */
(function () {
  'use strict';
  const { $, $$, esc, fmt, API, toast, modal, confirmBox, formData, crest, posTag, statusBadge, avatar, playerCard, dateFmt, compressImage, POS } = OLS;
  const main = $('#main');
  let ME = null;

  const SECTIONS = [
    ['dashboard', 'Dashboard', '◧'], ['registrations', 'Student Registrations', '✎'], ['players', 'Player Management', '☺'],
    ['clubs', 'Club Management', '⛨'], ['captains', 'Captain Accounts', '©'],
    ['sep', 'Auction'], ['auction', 'Auction Control', '⚑'], ['history', 'Auction History', '☰'], ['squads', 'Squad Management', '⚽'],
    ['sep', 'League'], ['fixtures', 'Fixtures', '▦'], ['results', 'Match Results', '✓'], ['table', 'League Table', '≡'], ['stats', 'Player Statistics', '★'],
    ['sep', 'Administration'], ['reports', 'Reports', '⎙'], ['seasons', 'Season Management', '↻'], ['users', 'User Management', '⚇'], ['settings', 'Settings', '⚙'],
  ];
  const ROUTES = {};

  function nav(active) {
    $('#nav').innerHTML = SECTIONS.map((s) => (s[0] === 'sep' ? `<div class="sep">${esc(s[1])}</div>`
      : `<a href="#/${s[0]}" class="${s[0] === active ? 'active' : ''}"><span class="ix">${s[2]}</span>${esc(s[1])}</a>`)).join('')
      + '<div class="sep">Live screens</div><a href="/operator" target="_blank" rel="noopener"><span class="ix">▶</span>Operator console ↗</a><a href="/projector" target="_blank" rel="noopener"><span class="ix">▣</span>Projector display ↗</a><a href="/" target="_blank" rel="noopener"><span class="ix">⌂</span>Public website ↗</a>';
  }
  async function route() {
    const [name] = (location.hash.replace(/^#\//, '') || 'dashboard').split('?');
    const r = ROUTES[name] ? name : 'dashboard';
    nav(r);
    $('#nav').classList.remove('open');
    main.innerHTML = '<div class="empty">Loading…</div>';
    try { await ROUTES[r](); } catch (e) { if (e.message !== 'redirect') main.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  }
  const head = (title, sub = '', actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
  const reload = () => route();
  async function guarded(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (e) { toast(e.message, 'err', 5000); return null; } }
  const exportButtons = (path, label = 'Export') => `<div class="row" style="gap:6px"><span class="small muted">${esc(label)}:</span>${['xlsx', 'csv', 'pdf'].map((f) => `<button class="btn ghost sm" data-dl="${esc(path)}${path.includes('?') ? '&' : '?'}format=${f}">${f === 'xlsx' ? 'Excel' : f.toUpperCase()}</button>`).join('')}</div>`;
  document.addEventListener('click', (e) => { const d = e.target.closest('[data-dl]'); if (d) guarded(() => API.download(d.dataset.dl)); });

  // ================================================================ DASHBOARD
  ROUTES.dashboard = async () => {
    const d = await API.get('/api/admin/dashboard');
    const c = d.counts;
    const tile = (v, l, cls = '') => `<div class="tile ${cls}"><div class="v">${fmt(v)}</div><div class="l">${l}</div></div>`;
    main.innerHTML = head('Dashboard', `${esc(d.season.name)} · phase: <b>${esc(d.season.phase)}</b>`, `<a class="btn red" href="/operator" target="_blank">Operator console ↗</a><a class="btn ghost" href="/projector" target="_blank">Projector ↗</a>`)
      + `<div class="grid c4">${tile(c.total, 'Total registrations')}${tile(c.pending, 'Pending approvals', 'amber')}${tile(c.approved, 'Approved players', 'gold')}${tile(c.ready, 'Auction-ready players', 'red')}
         ${tile(c.sold, 'Players sold', 'green')}${tile(c.pending_allocation, 'Awaiting allocation', 'amber')}${tile(c.allocated, 'Allocated players', 'green')}${tile(c.clubs, 'Total clubs')}</div>
      <div class="grid c2 mt2">
        <div class="card"><div class="card-head"><h3>Status</h3><span class="badge ${d.auction === 'live' ? 'green' : d.auction === 'ended' ? '' : 'amber'}">Auction: ${esc(d.auction === 'live' ? 'LIVE' : d.auction === 'ended' ? 'Ended' : 'Not started')}</span></div>
          ${d.warnings.length ? d.warnings.map((w) => `<div class="alert warn mb2">${esc(w)}</div>`).join('') : '<div class="alert ok">Everything looks ready.</div>'}
          <p class="small muted mt2">Squad places still open across all clubs: <b>${fmt(d.capacity)}</b></p>
          <div class="row mt2"><a class="btn ghost sm" href="#/registrations">Review registrations</a><a class="btn ghost sm" href="#/auction">Auction control</a><a class="btn ghost sm" href="#/captains">Captain accounts</a></div></div>
        <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h3>Clubs</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Club</th><th class="n">Spent</th><th class="n">Remaining</th><th class="n">Players</th></tr></thead><tbody>
          ${d.clubs.map((x) => `<tr><td><span class="club-name">${crest(x, 'sm')}${esc(x.name)}</span></td><td class="n">${fmt(x.spent)}</td><td class="n"><b>${fmt(x.remaining)}</b></td><td class="n">${x.count}/${x.max}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="card mt2"><div class="card-head"><h3>Recent activity</h3><a class="small" href="#/history?tab=audit">Full audit log</a></div>${auditList(d.recent)}</div>`;
  };
  function auditList(rows) {
    if (!rows.length) return '<p class="muted">No activity yet.</p>';
    return `<div class="table-wrap"><table class="t"><tbody>${rows.map((a) => `<tr><td class="small muted" style="white-space:nowrap">${esc(dateFmt(a.at))}</td><td><b>${esc(a.username || 'system')}</b></td><td><code>${esc(a.action)}</code></td><td class="small muted">${esc(a.entity || '')}${a.entity_id ? ' #' + a.entity_id : ''} ${a.details ? esc(a.details).slice(0, 160) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ================================================================ REGISTRATIONS
  ROUTES.registrations = async () => {
    const all = await API.get('/api/admin/players');
    const pending = all.filter((p) => p.status === 'pending');
    const rejected = all.filter((p) => p.status === 'rejected');
    main.innerHTML = head('Student Registrations', 'New registrations wait here until the administration approves them. Only approved players can enter the auction.',
      `<a class="btn ghost" href="/register" target="_blank">Open registration form ↗</a>${pending.length ? `<button class="btn green" data-approve-all>Approve all with photos (${pending.filter((p) => p.has_photo).length})</button>` : ''}`)
      + (pending.length ? `<div class="grid c3">${pending.map((p) => `
        <div class="card"><div class="row nowrap" style="align-items:flex-start">${playerCard(p, { size: 'sm' })}
          <div class="grow"><b>${esc(p.full_name)}</b><div class="small muted">${esc(p.class_grade)}</div>
            <div class="mt1">${esc(p.primary_position)}${p.secondary_position ? `<br><span class="small muted">2nd: ${esc(p.secondary_position)}</span>` : ''}</div>
            <div class="small muted mt1">${esc(dateFmt(p.created_at))}${p.source !== 'form' ? ' · ' + esc(p.source) : ''}</div>
            ${!p.has_photo ? '<div class="badge red mt1">No photo</div>' : ''}</div></div>
          <div class="row mt2"><button class="btn green sm" data-st="approved" data-id="${p.id}">Approve</button><button class="btn danger-ghost sm" data-st="rejected" data-id="${p.id}">Reject</button><button class="btn ghost sm" data-edit="${p.id}">Edit</button></div></div>`).join('')}</div>`
        : '<div class="card empty">No registrations are waiting for approval. 🎉</div>')
      + (rejected.length ? `<div class="card mt3"><h3>Rejected (${rejected.length})</h3>${rejected.map((p) => `<div class="qrow row between" style="padding:6px 0;border-bottom:1px solid var(--g100)"><span>${esc(p.full_name)} · <span class="muted">${esc(p.class_grade)}</span></span><button class="btn ghost sm" data-st="pending" data-id="${p.id}">Restore to pending</button></div>`).join('')}</div>` : '');
    main.onclick = async (e) => {
      const st = e.target.closest('[data-st]');
      if (st) { await guarded(() => API.post('/api/admin/players/status', { ids: [Number(st.dataset.id)], status: st.dataset.st }), st.dataset.st === 'approved' ? 'Approved.' : 'Updated.'); return reload(); }
      const ed = e.target.closest('[data-edit]');
      if (ed) return editPlayer(all.find((p) => p.id === Number(ed.dataset.edit)));
      if (e.target.closest('[data-approve-all]')) {
        const ids = pending.filter((p) => p.has_photo).map((p) => p.id);
        if (!ids.length) return toast('No pending registrations with photos.');
        if (await confirmBox({ title: 'Approve registrations', message: `Approve ${ids.length} registration(s) that have a photograph?`, confirm: 'Approve' })) { await guarded(() => API.post('/api/admin/players/status', { ids, status: 'approved' }), 'Approved.'); reload(); }
      }
    };
  };

  // ================================================================ PLAYERS
  async function editPlayer(p) {
    const isNew = !p;
    p = p || { full_name: '', class_grade: '', primary_position: '', secondary_position: '', status: 'approved' };
    let newPhoto = null;
    const r = await modal({
      title: isNew ? 'Add player' : `Edit ${p.full_name}`,
      body: `<form data-f><div class="row nowrap" style="align-items:flex-start;gap:16px">
          <div style="flex:none"><label for="ph-in" style="cursor:pointer">${p.photo_url ? `<img class="avatar" id="ph-prev" src="${esc(p.photo_url)}" style="width:110px;height:138px">` : '<img class="avatar hidden" id="ph-prev" style="width:110px;height:138px"><span class="avatar silhouette" id="ph-sil" style="width:110px;height:138px;display:block"></span>'}</label>
            <input type="file" id="ph-in" accept="image/*" class="sr-only"><label for="ph-in" class="btn ghost sm block mt1">${p.photo_url ? 'Replace photo' : 'Add photo'}</label></div>
          <div class="grow"><label class="field"><span>Full name</span><input type="text" name="full_name" value="${esc(p.full_name)}" maxlength="80" required></label>
          <label class="field"><span>Class / Grade</span><input type="text" name="class_grade" value="${esc(p.class_grade)}" maxlength="30" required></label></div></div>
        <div class="inline-fields"><label class="field"><span>Preferred position</span><select name="primary_position">${opts([['', 'Choose…'], ...POSITIONS.map((x) => [x, x])], p.primary_position)}</select></label>
        <label class="field"><span>Secondary position</span><select name="secondary_position">${opts([['', 'None'], ...POSITIONS.map((x) => [x, x])], p.secondary_position || '')}</select></label></div>
        ${isNew ? `<label class="field"><span>Status</span><select name="status">${opts([['approved', 'Approved'], ['pending', 'Pending Approval']], 'approved')}</select></label>` : `<p class="small">Status: ${statusBadge(p.status)} ${p.club_name ? ` · Club: <b>${esc(p.club_name)}</b>` : ''}</p>`}
        <label class="field"><span>Administrator note <em>(private)</em></span><input type="text" name="admin_note" value="${esc(p.admin_note || '')}" maxlength="500"></label></form>`,
      actions: [
        ...(isNew ? [] : [{ label: 'Remove player', cls: 'danger-ghost', value: 'delete' }]),
        { label: 'Cancel', cls: 'ghost' },
        { label: isNew ? 'Add player' : 'Save changes', handler: async (el) => {
          const d = formData($('[data-f]', el));
          if (isNew) {
            const fd = new FormData(); for (const [k, v] of Object.entries(d)) fd.set(k, v);
            if (newPhoto) fd.set('photo', newPhoto, 'photo.jpg');
            await API.post('/api/admin/players', fd);
          } else {
            await API.put(`/api/admin/players/${p.id}`, d);
            if (newPhoto) { const fd = new FormData(); fd.set('photo', newPhoto, 'photo.jpg'); await API.post(`/api/admin/players/${p.id}/photo`, fd); }
          }
          toast('Saved.', 'ok'); return 'saved';
        } },
      ],
      onOpen(el) {
        $('#ph-in', el).addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          newPhoto = await compressImage(f);
          const img = $('#ph-prev', el); img.src = URL.createObjectURL(newPhoto); img.classList.remove('hidden');
          const s = $('#ph-sil', el); if (s) s.remove();
        });
      },
    });
    if (r === 'delete') {
      const c = await confirmBox({ title: 'Remove player?', message: `Remove <b>${esc(p.full_name)}</b>? Players with auction or match history are marked as withdrawn instead of deleted, so records are preserved.`, confirm: 'Remove', danger: true });
      if (c) await guarded(() => API.del(`/api/admin/players/${p.id}`), 'Player removed.');
    }
    if (r) reload();
  }

  ROUTES.players = async () => {
    const list = await API.get('/api/admin/players');
    const classes = [...new Set(list.map((p) => p.class_grade))].sort();
    const f = JSON.parse(sessionStorage.getItem('pf') || '{}');
    main.innerHTML = head('Player Management', `${list.length} players this season. Students only provide name, class, photo and positions — no jersey numbers are used.`,
      `<button class="btn ghost" data-import>Import Excel/CSV</button><button class="btn ghost" data-photos>Upload photos</button><button class="btn red" data-add>+ Add player</button>`)
      + `<div class="card"><div class="toolbar">
          <input type="search" id="q" placeholder="Search name…" value="${esc(f.q || '')}">
          <select id="fs">${opts([['', 'All statuses'], ...Object.entries(OLS.STATUS).map(([k, v]) => [k, v[0]])], f.s || '')}</select>
          <select id="fp">${opts([['', 'All positions'], ...POSITIONS.map((x) => [x, x])], f.p || '')}</select>
          <select id="fc">${opts([['', 'All classes'], ...classes.map((x) => [x, x])], f.c || '')}</select>
          <span class="grow"></span>${exportButtons('/api/admin/players/export')}</div>
        <div class="row mb2" id="bulk" style="display:none;background:var(--g50);padding:8px 10px;border-radius:10px"><b id="nsel"></b>
          <button class="btn green sm" data-bulk="approved">Approve</button><button class="btn sm" data-bulk="ready">Add to auction list</button>
          <button class="btn ghost sm" data-bulk="approved">Remove from auction list</button><button class="btn ghost sm" data-bulk="pending">Mark pending</button>
          <button class="btn danger-ghost sm" data-bulk="rejected">Reject</button><button class="btn danger-ghost sm" data-bulk="withdrawn">Withdraw</button></div>
        <div class="table-wrap"><table class="t"><thead><tr><th><input type="checkbox" id="all"></th><th></th><th>Name</th><th>Class</th><th>Positions</th><th>Status</th><th>Club</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
    const sel = new Set();
    const draw = () => {
      const q = $('#q').value.toLowerCase(); const s = $('#fs').value; const p = $('#fp').value; const c = $('#fc').value;
      sessionStorage.setItem('pf', JSON.stringify({ q, s, p, c }));
      const rows = list.filter((x) => (!q || x.full_name.toLowerCase().includes(q)) && (!s || x.status === s) && (!p || x.primary_position === p || x.secondary_position === p) && (!c || x.class_grade === c));
      $('#rows').innerHTML = rows.map((x) => `<tr class="${sel.has(x.id) ? 'selected' : ''}"><td><input type="checkbox" data-sel="${x.id}" ${sel.has(x.id) ? 'checked' : ''}></td><td>${avatar(x.thumb_url, 'sm')}</td>
        <td><b>${esc(x.full_name)}</b>${x.is_captain ? ' <span class="badge gold">Captain</span>' : ''}${!x.has_photo ? ' <span class="badge red">No photo</span>' : ''}</td><td>${esc(x.class_grade)}</td>
        <td>${posTag(x.primary_position)} ${x.secondary_position ? posTag(x.secondary_position, true) : ''}</td><td>${statusBadge(x.status)}</td>
        <td>${x.club_name ? `<span class="club-name small"><span class="dot" style="background:${esc(x.club_color)}"></span>${esc(x.club_short)}${x.method === 'auction' ? ` · ${fmt(x.price)}` : ''}</span>` : ''}</td>
        <td class="right"><button class="btn ghost sm" data-edit="${x.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No players match.</td></tr>';
      $('#bulk').style.display = sel.size ? 'flex' : 'none'; $('#nsel').textContent = `${sel.size} selected`;
      $('#all').checked = rows.length > 0 && rows.every((x) => sel.has(x.id));
      $('#all').onchange = (e) => { rows.forEach((x) => (e.target.checked ? sel.add(x.id) : sel.delete(x.id))); draw(); };
    };
    ['#q', '#fs', '#fp', '#fc'].forEach((id) => $(id).addEventListener('input', draw));
    draw();
    main.onclick = async (e) => {
      const cb = e.target.closest('[data-sel]');
      if (cb) { const id = Number(cb.dataset.sel); cb.checked ? sel.add(id) : sel.delete(id); return draw(); }
      const ed = e.target.closest('[data-edit]'); if (ed) return editPlayer(list.find((x) => x.id === Number(ed.dataset.edit)));
      if (e.target.closest('[data-add]')) return editPlayer(null);
      if (e.target.closest('[data-import]')) return importDialog();
      if (e.target.closest('[data-photos]')) return bulkPhotos(list);
      const b = e.target.closest('[data-bulk]');
      if (b) {
        const r = await guarded(() => API.post('/api/admin/players/status', { ids: [...sel], status: b.dataset.bulk }));
        if (r) { toast(`${r.changed} updated.${r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}` : ''}`, r.skipped.length ? 'warn' : 'ok', 5000); reload(); }
      }
    };
  };

  async function importDialog() {
    let file = null;
    await modal({
      title: 'Import registrations from Excel or CSV', wide: true,
      body: `<p>Use columns <b>Full Name</b>, <b>Class / Grade</b>, <b>Preferred Position</b> and (optional) <b>Secondary Position</b>. Positions can be written as GK, DEF, MID, FWD.</p>
        <div class="row mb2"><button class="btn ghost sm" data-dl="/api/admin/players/import-template?format=xlsx">Download Excel template</button><button class="btn ghost sm" data-dl="/api/admin/players/import-template?format=csv">Download CSV template</button></div>
        <label class="field"><span>File (.xlsx or .csv)</span><input type="file" id="imp" accept=".xlsx,.csv,.txt"></label>
        <label class="check mb2"><input type="checkbox" id="impApprove"><span>Mark imported players as <b>Approved</b> (otherwise they go to Pending Approval)</span></label>
        <div id="impPrev"></div>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Import valid rows', handler: async (el) => {
        if (!file) { toast('Choose a file first.', 'err'); return false; }
        const fd = new FormData(); fd.set('file', file); fd.set('commit', 'true'); fd.set('approve', String($('#impApprove', el).checked));
        const r = await API.post('/api/admin/players/import', fd);
        toast(`${r.imported} imported${r.skipped ? `, ${r.skipped} skipped` : ''}.`, 'ok', 5000); reload();
      } }],
      onOpen(el) {
        $('#imp', el).addEventListener('change', async (e) => {
          file = e.target.files[0]; if (!file) return;
          const fd = new FormData(); fd.set('file', file);
          try {
            const r = await API.post('/api/admin/players/import', fd);
            const ok = r.rows.filter((x) => !x.errors.length).length;
            $('#impPrev', el).innerHTML = `<div class="alert ${ok === r.rows.length ? 'ok' : 'warn'} mb2">${ok} of ${r.rows.length} rows are ready to import.</div>
              <div class="table-wrap" style="max-height:300px"><table class="t"><thead><tr><th>Line</th><th>Name</th><th>Class</th><th>Preferred</th><th>Secondary</th><th>Problems</th></tr></thead><tbody>
              ${r.rows.map((x) => `<tr><td>${x.line}</td><td>${esc(x.full_name)}</td><td>${esc(x.class_grade)}</td><td>${esc(x.primary_position || '')}</td><td>${esc(x.secondary_position || '')}</td><td class="small" style="color:var(--red-dark)">${esc(x.errors.join('; '))}</td></tr>`).join('')}</tbody></table></div>`;
          } catch (x) { $('#impPrev', el).innerHTML = `<div class="alert err">${esc(x.message)}</div>`; }
        });
      },
    });
  }

  /** Match many photo files to students by file name, let the admin correct matches, then upload one by one. */
  async function bulkPhotos(list) {
    const norm = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z]+/g, ' ').trim();
    const candidates = list.filter((p) => p.status !== 'withdrawn');
    const guess = (file) => {
      const n = norm(file.name); if (!n) return null;
      const exact = candidates.find((p) => norm(p.full_name) === n); if (exact) return exact.id;
      const words = n.split(' ');
      const scored = candidates.map((p) => { const pw = norm(p.full_name).split(' '); return [p.id, words.filter((w) => w.length > 1 && pw.includes(w)).length / Math.max(pw.length, words.length)]; }).sort((a, b) => b[1] - a[1]);
      return scored[0] && scored[0][1] >= 0.5 ? scored[0][0] : null;
    };
    let files = [];
    await modal({
      title: 'Upload photographs', wide: true,
      body: `<p>Select several photos at once. Name each file after the student (for example <code>Ahmed Raza.jpg</code>) and they will be matched automatically. Check every match before uploading.</p>
        <label class="field"><span>Photos</span><input type="file" id="bp" accept="image/*" multiple></label><div id="bpList"></div>`,
      actions: [{ label: 'Close', cls: 'ghost' }, { label: 'Upload matched photos', handler: async (el) => {
        const rows = $$('[data-bp]', el); let done = 0; let skipped = 0;
        for (const r of rows) {
          const pid = Number(r.querySelector('select').value); const i = Number(r.dataset.bp);
          if (!pid) { skipped++; continue; }
          r.querySelector('.st').textContent = 'Uploading…';
          try { const fd = new FormData(); fd.set('photo', await compressImage(files[i]), 'photo.jpg'); await API.post(`/api/admin/players/${pid}/photo`, fd); r.querySelector('.st').innerHTML = '<span class="badge green">Done</span>'; done++; } catch (x) { r.querySelector('.st').innerHTML = `<span class="badge red">${esc(x.message)}</span>`; }
        }
        toast(`${done} photo(s) uploaded${skipped ? `, ${skipped} not matched` : ''}.`, 'ok', 5000);
        return false;
      } }],
      onOpen(el) {
        $('#bp', el).addEventListener('change', (e) => {
          files = Array.from(e.target.files);
          const options = `<option value="">— not matched —</option>${candidates.map((p) => `<option value="${p.id}">${esc(p.full_name)} (${esc(p.class_grade)})${p.has_photo ? ' ✓' : ''}</option>`).join('')}`;
          $('#bpList', el).innerHTML = `<div class="table-wrap" style="max-height:340px"><table class="t"><thead><tr><th>File</th><th>Student</th><th></th></tr></thead><tbody>${files.map((f, i) => `<tr data-bp="${i}"><td class="small">${esc(f.name)}</td><td><select>${options}</select></td><td class="st small"></td></tr>`).join('')}</tbody></table></div><p class="small muted">✓ = student already has a photo (it will be replaced).</p>`;
          $$('[data-bp]', el).forEach((r) => { const g = guess(files[Number(r.dataset.bp)]); if (g) r.querySelector('select').value = String(g); });
        });
      },
    });
    reload();
  }

  // ================================================================ CLUBS
  ROUTES.clubs = async () => {
    const clubs = await API.get('/api/admin/clubs');
    const seasons = await API.get('/api/admin/seasons');
    main.innerHTML = head('Club Management', 'The eight permanent OLS clubs. Upload each club\'s official approved logo and set its official colours here.')
      + `<div class="grid c2">${clubs.map((c) => `
        <div class="card" style="border-top:6px solid ${esc(c.primary_color)}">
          <div class="row nowrap" style="align-items:flex-start">${crest(c, 'lg')}
            <div class="grow"><h2 style="margin:0;text-transform:uppercase">${esc(c.name)}</h2>
              <div class="row small mt1"><span class="dot" style="background:${esc(c.primary_color)};width:16px;height:16px"></span>${esc(c.primary_color)} <span class="dot" style="background:${esc(c.secondary_color)};width:16px;height:16px;box-shadow:0 0 0 1px var(--g300)"></span>${esc(c.secondary_color)}
              ${c.has_custom_logo ? '<span class="badge green">Official logo</span>' : '<span class="badge amber">Placeholder crest</span>'}</div>
              ${c.motto ? `<p class="small mt1 mb0"><i>${esc(c.motto)}</i></p>` : ''}
              <div class="small muted mt1">Group ${esc(c.group_name || '—')} · Captain: ${esc(c.captain_player || '—')} · Account: ${esc(c.captain_username || 'none')}</div></div></div>
          <div class="grid c3 mt2" style="gap:8px">
            <div class="tile" style="padding:10px"><div class="v" style="font-size:22px">${fmt(c.finance.budget)}</div><div class="l">Budget</div></div>
            <div class="tile red" style="padding:10px"><div class="v" style="font-size:22px">${fmt(c.finance.spent)}</div><div class="l">Auction expenditure</div></div>
            <div class="tile green" style="padding:10px"><div class="v" style="font-size:22px">${fmt(c.finance.remaining)}</div><div class="l">Remaining · ${c.finance.count}/${c.finance.max}</div></div></div>
          ${c.achievements.length ? `<div class="mt2"><b class="small upper muted">Achievements</b>${c.achievements.map((a) => `<div class="row between small" style="padding:4px 0">🏆 ${esc(a.title)}${a.season_name ? ` <span class="muted">(${esc(a.season_name)})</span>` : ''}<button class="icon-btn" data-del-ach="${a.id}" title="Delete">✕</button></div>`).join('')}</div>` : ''}
          <div class="row mt2"><button class="btn sm" data-edit="${c.id}">Edit identity</button><label class="btn ghost sm" style="cursor:pointer">Upload logo<input type="file" class="sr-only" accept="image/*,.svg" data-logo="${c.id}"></label>
            ${c.has_custom_logo ? `<button class="btn ghost sm" data-reset-logo="${c.id}">Use placeholder</button>` : ''}<button class="btn ghost sm" data-budget="${c.id}">Adjust budget</button><button class="btn ghost sm" data-ach="${c.id}">Add achievement</button><a class="btn ghost sm" href="/#/club/${esc(c.slug)}" target="_blank">Public page ↗</a></div>
        </div>`).join('')}</div>`;
    main.onclick = async (e) => {
      const id = (k) => { const el = e.target.closest(`[data-${k}]`); return el ? Number(el.dataset[k.replace(/-([a-z])/g, (_, x) => x.toUpperCase())]) : null; };
      let cid;
      if ((cid = id('edit'))) {
        const c = clubs.find((x) => x.id === cid);
        const r = await modal({ title: `Edit ${c.name}`, body: `<form data-f>
          <div class="alert warn mb2 small">Club names and colours are permanent identities. Only change them to match the officially approved versions.</div>
          <label class="field"><span>Club name</span><input type="text" name="name" value="${esc(c.name)}" maxlength="60"></label>
          <label class="field"><span>Short name <em>(used on small screens)</em></span><input type="text" name="short_name" value="${esc(c.short_name)}" maxlength="20"></label>
          <div class="inline-fields"><label class="field"><span>Primary colour</span><div class="row nowrap"><input type="color" value="${esc(c.primary_color)}" data-sync="primary_color"><input type="text" name="primary_color" value="${esc(c.primary_color)}" maxlength="7"></div></label>
          <label class="field"><span>Secondary colour</span><div class="row nowrap"><input type="color" value="${esc(c.secondary_color)}" data-sync="secondary_color"><input type="text" name="secondary_color" value="${esc(c.secondary_color)}" maxlength="7"></div></label></div>
          <label class="field"><span>Motto <em>(optional)</em></span><input type="text" name="motto" value="${esc(c.motto || '')}" maxlength="120"></label>
          <label class="field"><span>About the club <em>(shown on the public club page)</em></span><textarea name="description" maxlength="1500">${esc(c.description || '')}</textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { await API.put(`/api/admin/clubs/${cid}`, formData($('[data-f]', el))); toast('Club updated.', 'ok'); return true; } }],
        onOpen(el) { $$('[data-sync]', el).forEach((i) => i.addEventListener('input', () => { el.querySelector(`[name=${i.dataset.sync}]`).value = i.value.toUpperCase(); })); } });
        if (r) reload();
      } else if ((cid = id('budget'))) {
        const c = clubs.find((x) => x.id === cid);
        const r = await modal({ title: `Adjust budget — ${c.name}`, body: `<p>Current remaining budget: <b>${fmt(c.finance.remaining)}</b> points.</p><form data-f>
          <label class="field"><span>Change in points <em>(use a minus sign to reduce)</em></span><input type="number" name="amount" step="1" required></label>
          <label class="field"><span>Reason (saved in the audit log)</span><textarea name="reason" required maxlength="300"></textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Apply change', cls: 'red', handler: async (el) => { await API.post(`/api/admin/clubs/${cid}/budget`, formData($('[data-f]', el))); toast('Budget updated.', 'ok'); return true; } }] });
        if (r) reload();
      } else if ((cid = id('ach'))) {
        const c = clubs.find((x) => x.id === cid);
        const r = await modal({ title: `Add achievement — ${c.name}`, body: `<form data-f><label class="field"><span>Title</span><input type="text" name="title" maxlength="120" placeholder="e.g. Fair Play Award" required></label>
          <label class="field"><span>Season</span><select name="season_id"><option value="">—</option>${seasons.map((s) => `<option value="${s.id}" ${s.is_current ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Date</span><input type="date" name="awarded_on"></label><label class="field"><span>Description</span><textarea name="description" maxlength="500"></textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Add', handler: async (el) => { await API.post('/api/admin/achievements', { club_id: cid, ...formData($('[data-f]', el)) }); toast('Achievement added.', 'ok'); return true; } }] });
        if (r) reload();
      } else if ((cid = id('reset-logo'))) {
        if (await confirmBox({ title: 'Use placeholder crest?', message: 'The uploaded logo will no longer be shown.' })) { await guarded(() => API.del(`/api/admin/clubs/${cid}/logo`), 'Logo reset.'); reload(); }
      } else if ((cid = id('del-ach'))) {
        if (await confirmBox({ title: 'Delete achievement?', danger: true, confirm: 'Delete' })) { await guarded(() => API.del(`/api/admin/achievements/${cid}`), 'Deleted.'); reload(); }
      }
    };
    main.onchange = async (e) => {
      const inp = e.target.closest('[data-logo]');
      if (!inp || !inp.files[0]) return;
      const fd = new FormData(); fd.set('logo', inp.files[0]);
      await guarded(() => API.post(`/api/admin/clubs/${inp.dataset.logo}/logo`, fd), 'Logo uploaded.'); reload();
    };
  };

  // ================================================================ CAPTAINS
  function showCredentials(club, username, password) {
    return modal({ title: 'Captain login details', body: `<div class="card" style="border:2px dashed var(--g300);box-shadow:none">
      <div class="row nowrap">${club ? crest(club, 'lg') : ''}<div><div class="small upper muted" style="font-weight:700">OLS Premier League · Captain</div><h2 style="margin:4px 0">${esc(club ? club.club_name || club.name : '')}</h2>
      <div>Website: <b>${esc(location.origin)}/login</b></div><div>Username: <b style="font-size:1.2em">${esc(username)}</b></div><div>Password: <b style="font-size:1.2em;font-family:monospace">${esc(password)}</b></div></div></div></div>
      <p class="small muted mt2">This password is shown only once. Print or copy it now and hand it to the captain privately.</p>`,
    actions: [{ label: 'Print', cls: 'ghost', handler: () => { window.print(); return false; } }, { label: 'Done' }] });
  }
  ROUTES.captains = async () => {
    const [caps, players, settings] = await Promise.all([API.get('/api/admin/captains'), API.get('/api/admin/players'), API.get('/api/admin/settings')]);
    const eligible = players.filter((p) => ['approved', 'ready', 'pending_allocation', 'pending', 'allocated', 'sold'].includes(p.status));
    main.innerHTML = head('Captain Accounts', `Each club has one secure captain account for bidding and team selection. Captains are ${settings.settings.captainsInAuction ? '<b>included in the auction</b>' : '<b>assigned to their club automatically</b>'} and ${settings.settings.captainCountsInSquad ? '<b>count towards</b>' : '<b>do not count towards</b>'} the squad limit (change this in Auction Control).`)
      + `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Club</th><th>Login</th><th>Captain (player)</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${caps.map((c) => `<tr><td><span class="club-name">${crest(c, 'sm')}${esc(c.club_name)}</span></td>
          <td>${c.username ? `<b>${esc(c.username)}</b><div class="small muted">${esc(c.display_name)} ${c.active ? '' : '<span class="badge red">Disabled</span>'}</div>` : '<span class="badge red">No account</span>'}</td>
          <td>${c.captain_player ? `${esc(c.captain_player)} <span class="small muted">${esc(c.captain_class || '')}</span>` : '<span class="muted">Not set</span>'}</td>
          <td class="small muted">${c.last_login_at ? esc(dateFmt(c.last_login_at)) : '—'}</td>
          <td class="right"><div class="row end" style="gap:6px">${c.username ? `<button class="btn ghost sm" data-player="${c.club_id}">Captain player</button><button class="btn ghost sm" data-reset="${c.club_id}">Reset password</button>
            <button class="btn ghost sm" data-toggle="${c.club_id}" data-active="${c.active ? 1 : 0}">${c.active ? 'Disable' : 'Enable'}</button><button class="btn danger-ghost sm" data-unlink="${c.club_id}">Unlink</button>`
          : `<button class="btn red sm" data-create="${c.club_id}">Create account</button>`}</div></td></tr>`).join('')}</tbody></table></div></div>
      <div class="alert mt2">Captains sign in at <b>${esc(location.origin)}/login</b> on their own phone or tablet. Ask each captain to test their account before the auction (step 8 of the event workflow).</div>`;
    const playerSelect = (sel) => `<select name="player_id"><option value="">— none —</option>${eligible.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name)} (${esc(p.class_grade)}) — ${esc(OLS.STATUS[p.status][0])}</option>`).join('')}</select>`;
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const cid = Number(b.dataset.create || b.dataset.reset || b.dataset.player || b.dataset.toggle || b.dataset.unlink);
      const c = caps.find((x) => x.club_id === cid);
      if (b.dataset.create) {
        const slug = c.slug.replace(/^(al|as)-/, '').split('-')[0];
        const r = await modal({ title: `Create captain account — ${c.club_name}`, body: `<form data-f>
          <label class="field"><span>Username</span><input type="text" name="username" value="${esc(slug)}-captain" autocapitalize="none" required></label>
          <label class="field"><span>Display name</span><input type="text" name="display_name" value="${esc(c.club_name)} Captain"></label>
          <label class="field"><span>Captain (registered player) <em>(optional)</em></span>${playerSelect(null)}</label>
          <label class="field"><span>Password <em>(leave empty to generate a secure one)</em></span><input type="text" name="password" autocomplete="off"></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create account', handler: async (el) => API.post('/api/admin/captains', { club_id: cid, ...formData($('[data-f]', el)) }) }] });
        if (r) { await showCredentials(c, r.username, r.password); reload(); }
      } else if (b.dataset.reset) {
        if (!(await confirmBox({ title: 'Reset password?', message: `A new password will be generated for <b>${esc(c.username)}</b>. They will be signed out on all devices.`, confirm: 'Reset' }))) return;
        const r = await guarded(() => API.put(`/api/admin/captains/${cid}`, { reset_password: true }));
        if (r) await showCredentials(c, c.username, r.password);
      } else if (b.dataset.player) {
        const r = await modal({ title: `Captain of ${c.club_name}`, body: `<form data-f><label class="field"><span>Registered player who captains this club</span>${playerSelect(c.captain_player_id)}</label></form>
          <p class="small muted">${settings.settings.captainsInAuction ? 'Captains take part in the auction like other players.' : 'The captain is added to this club\'s squad automatically at 0 points.'}</p>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { await API.put(`/api/admin/captains/${cid}`, { player_id: formData($('[data-f]', el)).player_id || null }); toast('Captain updated.', 'ok'); return true; } }] });
        if (r) reload();
      } else if (b.dataset.toggle) {
        await guarded(() => API.put(`/api/admin/captains/${cid}`, { active: b.dataset.active !== '1' }), 'Updated.'); reload();
      } else if (b.dataset.unlink) {
        if (await confirmBox({ title: 'Unlink captain account?', message: 'The account will no longer be able to bid for this club.', danger: true, confirm: 'Unlink' })) { await guarded(() => API.del(`/api/admin/captains/${cid}`), 'Unlinked.'); reload(); }
      }
    };
  };

  // ================================================================ AUCTION CONTROL
  ROUTES.auction = async () => {
    const [s, players, state] = await Promise.all([API.get('/api/admin/settings'), API.get('/api/admin/players'), API.get('/api/auction/state')]);
    const st = s.settings;
    const ready = players.filter((p) => p.status === 'ready').sort((a, b) => (a.auction_order || 1e9) - (b.auction_order || 1e9));
    const approved = players.filter((p) => p.status === 'approved' && !p.is_captain);
    const open = state.clubs.reduce((t, c) => t + c.open, 0);
    const toPlace = ready.length + state.counts.pending_allocation + approved.length;
    const num = (k, label, help = '') => `<label class="field"><span>${label}</span><input type="number" name="${k}" value="${st[k]}" min="1" step="1"></label>${help ? `<p class="help">${help}</p>` : ''}`;
    const sw = (k, label, help) => `<label class="switch"><span><b>${label}</b><br><span class="small muted">${help}</span></span><input type="checkbox" name="${k}" ${st[k] ? 'checked' : ''}></label>`;
    main.innerHTML = head('Auction Control', `Auction status: <b>${esc(state.session.status === 'live' ? 'LIVE' : state.session.status === 'ended' ? 'Ended' : 'Not started')}</b>${state.lot ? ` · on the block: <b>${esc(state.lot.player.full_name)}</b>` : ''}`,
      '<a class="btn red" href="/operator" target="_blank">Open operator console ↗</a><a class="btn ghost" href="/projector" target="_blank">Open projector ↗</a>')
      + `<div class="grid c2" style="align-items:start">
        <div class="card"><h3>Auction settings</h3>${s.sales ? '<div class="alert warn mb2 small">Purchases have been made. The starting budget can no longer change — use Club Management → Adjust budget instead.</div>' : ''}
          <form id="af"><div class="inline-fields">${num('budget', 'Budget per club (points)')}${num('startingBid', 'Starting bid')}${num('minIncrement', 'Minimum bid increase')}${num('timerSeconds', 'Countdown (seconds)')}
            ${num('squadSize', 'Squad size')}${num('starters', 'Starting players')}${num('subs', 'Substitutes')}${num('secondRoundStartingBid', 'Second-round starting bid')}</div>
            ${sw('captainCountsInSquad', 'Captain counts in the squad limit', 'On: the captain is one of the seven. Off: the captain is additional.')}
            ${sw('captainsInAuction', 'Captains take part in the auction', 'Off: each captain is assigned to their own club automatically.')}
            ${sw('reserveForRemainingSlots', 'Keep enough points to complete the squad', 'Clubs must keep the starting bid for each remaining empty place, so every club can always complete its squad.')}
            <div class="row end mt2"><button class="btn red">Save settings</button></div></form></div>
        <div class="card"><div class="card-head"><h3>Auction player list</h3><span class="badge navy">${ready.length} ready</span></div>
          <div class="alert ${toPlace > open ? 'warn' : ''} mb2 small">${fmt(toPlace)} players to place · ${fmt(open)} squad places open across all clubs.${toPlace > open ? ' There are more players than places: increase the squad size or leave some players out.' : ''}</div>
          ${approved.length ? `<div class="row mb2"><button class="btn sm" data-addall>Add all ${approved.length} approved players to the list</button></div>` : ''}
          <div class="row mb2" style="gap:6px"><span class="small muted">Order:</span><button class="btn ghost sm" data-order="shuffle">Shuffle</button><button class="btn ghost sm" data-order="position">By position</button><button class="btn ghost sm" data-order="name">By name</button></div>
          <div style="max-height:520px;overflow-y:auto">${ready.map((p, i) => `<div class="qrow row nowrap" style="padding:6px 0;border-bottom:1px solid var(--g100)"><span class="muted small" style="width:28px">${i + 1}.</span>${avatar(p.thumb_url, 'sm')}<div class="grow"><b>${esc(p.full_name)}</b> <span class="small muted">${esc(p.class_grade)}</span> ${posTag(p.primary_position)}${!p.has_photo ? ' <span class="badge red">No photo</span>' : ''}</div>
            <button class="icon-btn" data-up="${i}" title="Move up">▲</button><button class="icon-btn" data-down="${i}" title="Move down">▼</button><button class="icon-btn" data-out="${p.id}" title="Remove from list">✕</button></div>`).join('') || '<div class="empty">No players on the auction list yet.</div>'}</div></div>
      </div>`;
    $('#af').addEventListener('submit', async (e) => { e.preventDefault(); const d = formData(e.target); if (await guarded(() => API.put('/api/admin/settings', d), 'Settings saved.')) reload(); });
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.addall !== undefined) { await guarded(() => API.post('/api/admin/players/status', { ids: approved.map((p) => p.id), status: 'ready' }), 'Added to the auction list.'); return reload(); }
      if (b.dataset.order) { await guarded(() => API.post('/api/admin/auction-list/order', { mode: b.dataset.order }), 'Order updated.'); return reload(); }
      if (b.dataset.out) { await guarded(() => API.post('/api/admin/players/status', { ids: [Number(b.dataset.out)], status: 'approved' })); return reload(); }
      const move = (i, d) => { const ids = ready.map((p) => p.id); const j = i + d; if (j < 0 || j >= ids.length) return null; [ids[i], ids[j]] = [ids[j], ids[i]]; return ids; };
      const ids = b.dataset.up ? move(Number(b.dataset.up), -1) : b.dataset.down ? move(Number(b.dataset.down), 1) : null;
      if (ids) { await guarded(() => API.post('/api/admin/auction-list/order', { ids })); reload(); }
    };
  };

  // ================================================================ AUCTION HISTORY
  ROUTES.history = async () => {
    const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'lots';
    const h = await API.get('/api/admin/auction/history');
    const clubs = (await API.get('/api/auction/state')).clubs;
    const LOT = { presenting: ['On the block', 'gold'], open: ['Bidding', 'gold'], paused: ['Paused', 'amber'], sold: ['Sold', 'green'], unsold: ['No sale', 'amber'], cancelled: ['Withdrawn', ''] };
    main.innerHTML = head('Auction History', 'Every auction transaction, bid, allocation and correction is recorded.', exportButtons('/api/admin/reports/auction'))
      + `<div class="tabs"><button data-tab="lots" class="${tab === 'lots' ? 'active' : ''}">Auction lots (${h.lots.length})</button><button data-tab="manual" class="${tab === 'manual' ? 'active' : ''}">Allocations & captains (${h.manual.length})</button><button data-tab="audit" class="${tab === 'audit' ? 'active' : ''}">Audit log</button></div><div id="hb"></div>`;
    const body = $('#hb');
    if (tab === 'lots') {
      body.innerHTML = `<div class="card"><div class="toolbar"><input type="search" id="hq" placeholder="Player or class…"><select id="hc">${opts([['', 'All clubs'], ...clubs.map((c) => [c.id, c.name])])}</select>
        <select id="hp">${opts([['', 'All positions'], ...POSITIONS.map((x) => [x, x])])}</select><select id="hs">${opts([['', 'All statuses'], ...Object.entries(LOT).map(([k, v]) => [k, v[0]])])}</select>
        <input type="number" id="hmin" placeholder="Min price" style="width:110px"><input type="number" id="hmax" placeholder="Max price" style="width:110px"></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Lot</th><th>Player</th><th>Class</th><th>Position</th><th>Winning club</th><th class="n">Final price</th><th class="n">Bids</th><th>Status</th><th>Date & time</th></tr></thead><tbody id="hr"></tbody></table></div></div>`;
      const draw = () => {
        const q = $('#hq').value.toLowerCase(); const c = Number($('#hc').value); const p = $('#hp').value; const s = $('#hs').value; const mn = Number($('#hmin').value) || 0; const mx = Number($('#hmax').value) || Infinity;
        const rows = h.lots.filter((l) => (!q || l.full_name.toLowerCase().includes(q) || l.class_grade.toLowerCase().includes(q)) && (!c || (l.status === 'sold' && l.leading_club_id === c)) && (!p || l.primary_position === p) && (!s || l.status === s)
          && (!$('#hmin').value && !$('#hmax').value ? true : (l.status === 'sold' && l.highest_bid >= mn && l.highest_bid <= mx)));
        $('#hr').innerHTML = rows.map((l) => `<tr data-lot="${l.id}" style="cursor:pointer"><td>${l.sequence_no}${l.round > 1 ? `<span class="small muted"> R${l.round}</span>` : ''}</td><td><b>${esc(l.full_name)}</b></td><td>${esc(l.class_grade)}</td><td>${posTag(l.primary_position)}</td>
          <td>${l.status === 'sold' ? `<span class="club-name small"><span class="dot" style="background:${esc(l.club_color)}"></span>${esc(l.club_name)}</span>` : ''}</td><td class="n"><b>${l.status === 'sold' ? fmt(l.highest_bid) : '—'}</b></td><td class="n">${l.bids}</td>
          <td><span class="badge ${LOT[l.status][1]}">${LOT[l.status][0]}</span></td><td class="small muted">${esc(dateFmt(l.closed_at || l.created_at))}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No auction records.</td></tr>';
      };
      ['#hq', '#hc', '#hp', '#hs', '#hmin', '#hmax'].forEach((i) => $(i).addEventListener('input', draw)); draw();
    } else if (tab === 'manual') {
      body.innerHTML = `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th>Club</th><th>How</th><th class="n">Price</th><th>By</th><th>When</th><th>Status</th></tr></thead><tbody>
        ${h.manual.map((m) => `<tr><td><b>${esc(m.full_name)}</b> <span class="small muted">${esc(m.class_grade)}</span></td><td><span class="club-name small"><span class="dot" style="background:${esc(m.club_color)}"></span>${esc(m.club_name)}</span></td><td>${m.method === 'captain' ? 'Captain' : 'Allocated'}</td><td class="n">${fmt(m.price)}</td><td>${esc(m.username || '')}</td><td class="small muted">${esc(dateFmt(m.created_at))}</td><td>${m.active ? '<span class="badge green">Active</span>' : `<span class="badge">Reversed</span> <span class="small muted">${esc(m.removed_reason || '')}</span>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No manual allocations.</td></tr>'}</tbody></table></div></div>`;
    } else {
      body.innerHTML = '<div class="card"><div class="toolbar"><input type="search" id="aq" placeholder="Filter by action, user or details…" style="flex:1"></div><div id="al"></div></div>';
      const load = async () => { $('#al').innerHTML = auditList(await API.get(`/api/admin/audit?q=${encodeURIComponent($('#aq').value)}`)); };
      let t; $('#aq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); }); load();
    }
    main.onclick = async (e) => {
      const t = e.target.closest('[data-tab]'); if (t) { location.hash = `#/history?tab=${t.dataset.tab}`; return; }
      const tr = e.target.closest('[data-lot]');
      if (tr) {
        const d = await API.get(`/api/admin/auction/lots/${tr.dataset.lot}`);
        modal({ title: `Bids — auction lot ${d.lot.sequence_no}`, wide: true, body: `<div class="table-wrap"><table class="t"><thead><tr><th>Time</th><th>Club</th><th>Captain</th><th class="n">Amount</th><th>Result</th></tr></thead><tbody>
          ${d.bids.map((b) => `<tr><td class="small">${new Date(b.created_at).toLocaleTimeString()}</td><td>${esc(b.club_short)}</td><td class="small">${esc(b.username)}</td><td class="n"><b>${fmt(b.amount)}</b></td><td><span class="badge ${b.status === 'accepted' ? 'green' : b.status === 'voided' ? '' : 'red'}">${esc(b.status)}</span> <span class="small muted">${esc((b.reason || '').replace(/_/g, ' '))}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No bids.</td></tr>'}</tbody></table></div>` });
      }
    };
  };

  // ================================================================ SQUADS
  ROUTES.squads = async () => {
    const [squads, players] = await Promise.all([API.get('/api/admin/squads'), API.get('/api/admin/players')]);
    const sel = Number(sessionStorage.getItem('sqc')) || squads[0].club.id;
    const sq = squads.find((s) => s.club.id === sel) || squads[0];
    const unplaced = players.filter((p) => ['pending_allocation', 'ready', 'approved'].includes(p.status));
    main.innerHTML = head('Squad Management', 'Every confirmed squad. Reversing a sale, moving a player or allocating requires a reason and is audited.',
      `${exportButtons('/api/admin/reports/squads', 'All squads')}`)
      + `<div class="tabs">${squads.map((s) => `<button data-club="${s.club.id}" class="${s.club.id === sq.club.id ? 'active' : ''}"><span class="club-name">${crest(s.club, 'sm')}${esc(s.club.short_name)} <span class="badge">${s.finance.count}/${s.finance.max}</span></span></button>`).join('')}</div>
      <div class="grid c2" style="align-items:start">
        <div class="card"><div class="card-head"><div class="club-name">${crest(sq.club)}<h2 style="margin:0">${esc(sq.club.name)}</h2></div>${exportButtons(`/api/admin/reports/club?club=${sq.club.id}`, 'Squad report')}</div>
          <div class="row small mb2"><span class="badge navy">${sq.finance.count}/${sq.finance.max} players</span><span class="badge">Spent ${fmt(sq.finance.spent)}</span><span class="badge green">Remaining ${fmt(sq.finance.remaining)}</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th></th><th>Player</th><th>Position</th><th>Joined</th><th class="n">Price</th><th></th></tr></thead><tbody>
          ${sq.members.map((m) => `<tr><td>${avatar(m.photo_url, 'sm')}</td><td><b>${esc(m.full_name)}</b>${m.is_captain ? ' <span class="badge gold">C</span>' : ''}<div class="small muted">${esc(m.class_grade)} · ${m.lineup_role === 'starter' ? 'Starting' : m.lineup_role === 'sub' ? 'Substitute' : 'Not selected'}</div></td>
            <td>${posTag(m.primary_position)}</td><td class="small">${m.method === 'auction' ? 'Auction' : m.method === 'captain' ? 'Captain' : 'Allocated'}</td><td class="n">${fmt(m.price)}</td>
            <td class="right"><div class="row end nowrap" style="gap:4px"><button class="btn ghost sm" data-move="${m.id}">Move</button><button class="btn danger-ghost sm" data-reverse="${m.id}">${m.method === 'auction' ? 'Reverse sale' : 'Remove'}</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No players yet.</td></tr>'}</tbody></table></div>
          <div class="row mt2"><button class="btn sm" data-alloc ${sq.finance.open ? '' : 'disabled'}>+ Allocate a player</button>${unplaced.some((p) => p.status === 'pending_allocation') ? '<button class="btn gold sm" data-dist>Distribute all awaiting allocation</button>' : ''}</div></div>
        <div class="card"><h3>Starting five & substitutes</h3><div id="lu"></div></div>
      </div>`;
    if (sq.members.length) Lineup.mount($('#lu'), sq, { onSave: (body) => API.put(`/api/admin/squads/${sq.club.id}/lineup`, body) });
    else $('#lu').innerHTML = '<p class="muted">The lineup can be arranged once the club has players.</p>';
    main.onclick = async (e) => {
      const b = e.target.closest('[data-club]'); if (b) { sessionStorage.setItem('sqc', b.dataset.club); return reload(); }
      const mv = e.target.closest('[data-move]');
      if (mv) {
        const m = sq.members.find((x) => x.id === Number(mv.dataset.move));
        const r = await modal({ title: `Move ${m.full_name}`, body: `<form data-f><label class="field"><span>New club</span><select name="to_club_id">${squads.filter((s) => s.club.id !== sq.club.id).map((s) => `<option value="${s.club.id}" ${s.finance.open ? '' : 'disabled'}>${esc(s.club.name)} (${s.finance.count}/${s.finance.max})</option>`).join('')}</select></label>
          <p class="small muted">The purchase price (${fmt(m.price)}) moves with the player: it is refunded to ${esc(sq.club.name)} and charged to the new club.</p>
          <label class="field"><span>Reason (saved in the audit log)</span><textarea name="reason" required></textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Move player', cls: 'red', handler: async (el) => { await API.post('/api/admin/squads/move', { member_id: m.id, ...formData($('[data-f]', el)) }); toast('Player moved.', 'ok'); return true; } }] });
        if (r) reload(); return;
      }
      const rv = e.target.closest('[data-reverse]');
      if (rv) {
        const m = sq.members.find((x) => x.id === Number(rv.dataset.reverse));
        const r = await modal({ title: m.method === 'auction' ? 'Reverse sale' : 'Remove from squad', body: `<p>Remove <b>${esc(m.full_name)}</b> from <b>${esc(sq.club.name)}</b>${m.price ? ` and refund <b>${fmt(m.price)}</b> points` : ''}?</p>
          <form data-f><label class="field"><span>Player goes back to</span><select name="return_to">${opts([['pending_allocation', 'Awaiting allocation'], ['ready', 'Auction list (Ready for Auction)'], ['approved', 'Approved (not in auction)']])}</select></label>
          <label class="field"><span>Reason (saved in the audit log)</span><textarea name="reason" required></textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Confirm', cls: 'red', handler: async (el) => { await API.post('/api/admin/squads/reverse', { member_id: m.id, ...formData($('[data-f]', el)) }); toast('Done. The budget has been restored.', 'ok'); return true; } }] });
        if (r) reload(); return;
      }
      if (e.target.closest('[data-alloc]')) {
        const r = await modal({ title: `Allocate a player to ${sq.club.name}`, body: `<form data-f><label class="field"><span>Player</span><select name="player_id">${unplaced.map((p) => `<option value="${p.id}">${esc(p.full_name)} (${esc(p.class_grade)}) — ${esc(OLS.STATUS[p.status][0])}</option>`).join('')}</select></label>
          <label class="field"><span>Price in points</span><input type="number" name="price" value="0" min="0"></label><label class="field"><span>Reason (saved in the audit log)</span><textarea name="reason" required>No valid bid received</textarea></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Allocate', handler: async (el) => { await API.post('/api/admin/squads/allocate', { club_id: sq.club.id, ...formData($('[data-f]', el)) }); toast('Allocated.', 'ok'); return true; } }] });
        if (r) reload(); return;
      }
      if (e.target.closest('[data-dist]')) {
        if (await confirmBox({ title: 'Distribute automatically?', message: 'Players awaiting allocation are shared out at 0 points to the clubs with the most free places.', confirm: 'Distribute' })) { const r = await guarded(() => API.post('/api/admin/squads/distribute')); if (r) toast(`${r.allocated.length} allocated.`, 'ok'); reload(); }
      }
    };
  };

  // ================================================================ FIXTURES
  const STAGE = { group: 'Group stage', semi: 'Semi-final', final: 'Grand Final', third_place: 'Third place', friendly: 'Friendly' };
  function fixtureRow(f, actions) {
    const done = f.status === 'completed';
    return `<tr><td class="small muted">${esc(f.match_label || STAGE[f.stage])}</td><td><span class="club-name">${crest({ logo_url: f.home_logo_url, name: f.home_name }, 'sm')}${esc(f.home_name)}</span></td>
      <td class="n"><b>${done ? `${f.home_score} – ${f.away_score}${f.home_pens != null ? ` <small>(${f.home_pens}–${f.away_pens} p)</small>` : ''}` : 'v'}</b></td>
      <td><span class="club-name">${crest({ logo_url: f.away_logo_url, name: f.away_name }, 'sm')}${esc(f.away_name)}</span></td>
      <td class="small">${f.kickoff_at ? esc(dateFmt(f.kickoff_at)) : '<span class="muted">Date TBC</span>'}${f.venue ? `<div class="muted">${esc(f.venue)}</div>` : ''}</td>
      <td>${done ? (f.result_published ? '<span class="badge green">Published</span>' : '<span class="badge amber">Not published</span>') : f.status === 'scheduled' ? (f.published ? '<span class="badge blue">Scheduled</span>' : '<span class="badge">Hidden</span>') : `<span class="badge red">${esc(f.status)}</span>`}</td>
      <td class="right"><div class="row end nowrap" style="gap:4px">${actions(f)}</div></td></tr>`;
  }
  async function fixtureForm(f, clubs) {
    const isNew = !f; f = f || { stage: 'group', published: 1 };
    const clubOpts = (sel) => clubs.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    return modal({ title: isNew ? 'Add fixture' : 'Edit fixture', body: `<form data-f>
      <div class="inline-fields"><label class="field"><span>Stage</span><select name="stage">${opts(Object.entries(STAGE), f.stage)}</select></label>
      <label class="field"><span>Group</span><select name="group_name">${opts([['', '—'], ['A', 'Group A'], ['B', 'Group B']], f.group_name || '')}</select></label></div>
      <div class="inline-fields"><label class="field"><span>Home club</span><select name="home_club_id" ${f.status === 'completed' ? 'disabled' : ''}>${clubOpts(f.home_club_id)}</select></label>
      <label class="field"><span>Away club</span><select name="away_club_id" ${f.status === 'completed' ? 'disabled' : ''}>${clubOpts(f.away_club_id || (clubs[1] && clubs[1].id))}</select></label></div>
      <div class="inline-fields"><label class="field"><span>Date & time</span><input type="datetime-local" name="kickoff_at" value="${esc(f.kickoff_at || '')}"></label>
      <label class="field"><span>Venue</span><input type="text" name="venue" value="${esc(f.venue || '')}" maxlength="80" placeholder="e.g. School ground"></label></div>
      <label class="field"><span>Label</span><input type="text" name="match_label" value="${esc(f.match_label || '')}" maxlength="80"></label>
      ${f.status !== 'completed' ? `<label class="field"><span>Status</span><select name="status">${opts([['scheduled', 'Scheduled'], ['postponed', 'Postponed'], ['cancelled', 'Cancelled']], f.status || 'scheduled')}</select></label>` : ''}
      <label class="check"><input type="checkbox" name="published" ${f.published ? 'checked' : ''}><span>Show this fixture on the public website</span></label></form>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { const d = formData($('[data-f]', el)); if (isNew) await API.post('/api/admin/fixtures', d); else await API.put(`/api/admin/fixtures/${f.id}`, d); toast('Fixture saved.', 'ok'); return true; } }] });
  }
  ROUTES.fixtures = async () => {
    const { fixtures, clubs } = await API.get('/api/admin/fixtures');
    const hasGroups = clubs.every((c) => c.group_name);
    const groupFx = fixtures.filter((f) => f.stage === 'group');
    const groupLocked = groupFx.some((f) => f.status === 'completed');
    main.innerHTML = head('Fixtures', 'Two groups of four. Each club plays the other three in its group once; the top two qualify for the semi-finals.', '<button class="btn red" data-add>+ Add fixture</button>')
      + `<div class="grid c2" style="align-items:start">
        <div class="card"><div class="card-head"><h3>1 · Groups</h3>${!groupLocked ? '<button class="btn ghost sm" data-draw>Random draw</button>' : ''}</div>
          <form id="gf"><div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">${clubs.map((c) => `<label class="row nowrap" style="gap:8px;background:var(--g50);padding:6px 8px;border-radius:8px">${crest(c, 'sm')}<span class="grow small"><b>${esc(c.short_name)}</b></span>
            <select name="${c.id}" style="width:auto;min-height:34px;padding:4px 8px" ${groupLocked ? 'disabled' : ''}>${opts([['', '—'], ['A', 'A'], ['B', 'B']], c.group_name || '')}</select></label>`).join('')}</div>
          ${!groupLocked ? '<div class="row end mt2"><button class="btn sm">Save groups</button></div>' : '<p class="small muted mt2">Groups are locked because results have been entered.</p>'}</form></div>
        <div class="card"><h3>2 · Generate matches</h3>
          ${!groupFx.length ? `<form id="genf"><div class="inline-fields"><label class="field"><span>First match <em>(optional)</em></span><input type="datetime-local" name="start"></label>
            <label class="field"><span>Matches per day</span><input type="number" name="per_day" value="4" min="1" max="12"></label><label class="field"><span>Days between match days</span><input type="number" name="gap_days" value="1" min="0" max="30"></label></div>
            <button class="btn" ${hasGroups ? '' : 'disabled'}>Generate 12 group matches</button>${hasGroups ? '' : '<p class="small muted mt1">Assign every club to a group first.</p>'}</form>`
          : `<p class="small">Group matches: <b>${groupFx.filter((f) => f.status === 'completed').length}/${groupFx.length}</b> completed.</p>`}
          <div class="row mt2"><button class="btn ghost sm" data-semis>Generate semi-finals</button><button class="btn ghost sm" data-final>Generate Grand Final</button></div>
          <p class="small muted mt1">Semi-finals: A1 v B2 and B1 v A2. The final is created from the two semi-final winners.</p></div>
      </div>
      ${['group', 'semi', 'third_place', 'final', 'friendly'].map((stage) => { const list = fixtures.filter((f) => f.stage === stage); if (!list.length) return '';
        return `<div class="card flush mt2"><div class="card-head" style="padding:14px 16px 0"><h3>${STAGE[stage]}</h3></div><div class="table-wrap"><table class="t"><tbody>${list.map((f) => fixtureRow(f, (x) => `<button class="btn ghost sm" data-edit="${x.id}">Edit</button><a class="btn ghost sm" href="#/results?f=${x.id}">Result</a><button class="icon-btn" data-del="${x.id}" title="Delete">✕</button>`)).join('')}</tbody></table></div></div>`; }).join('')}`;
    $('#gf').addEventListener('submit', async (e) => { e.preventDefault(); if (await guarded(() => API.post('/api/admin/groups', { assignments: formData(e.target) }), 'Groups saved.')) reload(); });
    const gen = $('#genf'); if (gen) gen.addEventListener('submit', async (e) => { e.preventDefault(); const r = await guarded(() => API.post('/api/admin/fixtures/generate-groups', formData(e.target))); if (r) { toast(`${r.created} matches created.`, 'ok'); reload(); } });
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.draw !== undefined) { if (await confirmBox({ title: 'Random group draw?', message: 'Clubs will be split randomly into two groups of four.' })) { await guarded(() => API.post('/api/admin/groups', { random: true }), 'Groups drawn.'); reload(); } }
      if (b.dataset.add !== undefined) { if (await fixtureForm(null, clubs)) reload(); }
      if (b.dataset.edit) { if (await fixtureForm(fixtures.find((f) => f.id === Number(b.dataset.edit)), clubs)) reload(); }
      if (b.dataset.del) {
        const f = fixtures.find((x) => x.id === Number(b.dataset.del));
        if (await confirmBox({ title: 'Delete fixture?', message: f.status === 'completed' ? 'This match has a result. Its score and statistics will be deleted too.' : 'Delete this fixture?', danger: true, confirm: 'Delete' })) { await guarded(() => API.del(`/api/admin/fixtures/${f.id}?force=1`), 'Deleted.'); reload(); }
      }
      if (b.dataset.semis !== undefined) { if (await guarded(() => API.post('/api/admin/fixtures/generate-semis'), 'Semi-finals created.')) reload(); }
      if (b.dataset.final !== undefined) {
        const r = await modal({ title: 'Generate the Grand Final', body: '<label class="check"><input type="checkbox" data-third><span>Also create a third-place play-off</span></label>', actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create', handler: async (el) => API.post('/api/admin/fixtures/generate-final', { third_place: $('[data-third]', el).checked }) }] });
        if (r) { toast('Grand Final created.', 'ok'); reload(); }
      }
    };
  };

  // ================================================================ RESULTS
  async function resultForm(id) {
    const d = await API.get(`/api/admin/fixtures/${id}/result`);
    const f = d.fixture; const ko = ['semi', 'final', 'third_place'].includes(f.stage);
    let events = d.events.map((e) => ({ ...e }));
    const sideSquad = (cid) => (cid === f.home_club_id ? d.home_squad : d.away_squad);
    const other = (cid) => (cid === f.home_club_id ? f.away_club_id : f.home_club_id);
    const pOpts = (list, sel, none = '— unknown —') => `<option value="">${none}</option>${list.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('')}`;
    const evRow = (e, i) => {
      const squad = e.type === 'own_goal' ? sideSquad(other(e.club_id)) : sideSquad(e.club_id);
      return `<tr data-ev="${i}"><td><select data-k="type" style="min-width:120px">${opts([['goal', '⚽ Goal'], ['own_goal', 'Own goal'], ['assist', 'Assist'], ['yellow', 'Yellow card'], ['red', 'Red card']], e.type)}</select></td>
        <td><select data-k="club_id">${opts([[f.home_club_id, f.home_short], [f.away_club_id, f.away_short]], e.club_id)}</select></td>
        <td><select data-k="player_id">${pOpts(squad, e.player_id)}</select></td><td><input type="number" data-k="minute" value="${e.minute ?? ''}" min="0" max="200" style="width:76px" placeholder="min"></td>
        <td><button type="button" class="icon-btn" data-rm="${i}">✕</button></td></tr>`;
    };
    const all = [...d.home_squad, ...d.away_squad];
    const r = await modal({ title: `${f.home_name} v ${f.away_name}`, wide: true, body: `<form data-f>
      <div class="row" style="justify-content:center;gap:16px;margin-bottom:14px">
        <div class="center">${crest({ logo_url: f.home_logo_url }, 'lg')}<b>${esc(f.home_short)}</b></div>
        <input type="number" name="home_score" value="${f.home_score ?? ''}" min="0" max="99" style="width:84px;font:800 32px var(--display);text-align:center" required>
        <span class="display" style="font-size:28px">–</span>
        <input type="number" name="away_score" value="${f.away_score ?? ''}" min="0" max="99" style="width:84px;font:800 32px var(--display);text-align:center" required>
        <div class="center">${crest({ logo_url: f.away_logo_url }, 'lg')}<b>${esc(f.away_short)}</b></div></div>
      ${ko ? `<div class="alert small mb2">Knockout match: if the score is level, enter the penalty shoot-out.<div class="row mt1" style="justify-content:center">Penalties <input type="number" name="home_pens" value="${f.home_pens ?? ''}" min="0" max="99" style="width:70px"> – <input type="number" name="away_pens" value="${f.away_pens ?? ''}" min="0" max="99" style="width:70px"></div></div>` : ''}
      <h3>Goal scorers, assists and cards</h3>
      <div class="table-wrap"><table class="t"><tbody id="evs"></tbody></table></div>
      <div class="row mt1"><button type="button" class="btn ghost sm" data-addev="goal">+ Goal</button><button type="button" class="btn ghost sm" data-addev="assist">+ Assist</button><button type="button" class="btn ghost sm" data-addev="yellow">+ Card</button></div>
      <label class="field mt2"><span>Player of the match</span><select name="motm_player_id">${pOpts(all, f.motm_player_id, '— none —')}</select></label>
      <label class="check"><input type="checkbox" name="result_published" ${f.result_published || f.status !== 'completed' ? 'checked' : ''}><span>Publish this result on the public website</span></label>
      <p class="small muted mt1">Saving confirms the result and updates the league table automatically.</p></form>`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save confirmed result', cls: 'red', handler: async (el) => {
      const data = formData($('[data-f]', el));
      await API.put(`/api/admin/fixtures/${id}/result`, { ...data, events: events.map((e) => ({ ...e, player_id: e.player_id || null })) });
      toast('Result saved. Standings updated.', 'ok'); return true;
    } }],
    onOpen(el) {
      const draw = () => { $('#evs', el).innerHTML = events.map(evRow).join('') || '<tr><td class="muted small">No events recorded.</td></tr>'; };
      draw();
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-addev]'); if (a) { events.push({ type: a.dataset.addev, club_id: f.home_club_id, player_id: null, minute: null }); draw(); }
        const rm = e.target.closest('[data-rm]'); if (rm) { events.splice(Number(rm.dataset.rm), 1); draw(); }
      });
      el.addEventListener('change', (e) => {
        const row = e.target.closest('[data-ev]'); if (!row) return;
        const ev = events[Number(row.dataset.ev)]; const k = e.target.dataset.k;
        ev[k] = k === 'type' ? e.target.value : e.target.value === '' ? null : Number(e.target.value);
        if (k === 'type' || k === 'club_id') { ev.player_id = null; draw(); }
      });
    } });
    return r;
  }
  ROUTES.results = async () => {
    const { fixtures } = await API.get('/api/admin/fixtures');
    const want = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('f'));
    const pending = fixtures.filter((f) => f.status !== 'completed' && f.status !== 'cancelled');
    const done = fixtures.filter((f) => f.status === 'completed');
    const act = (f) => `<button class="btn ${f.status === 'completed' ? 'ghost' : ''} sm" data-res="${f.id}">${f.status === 'completed' ? 'Edit result' : 'Enter result'}</button>`;
    main.innerHTML = head('Match Results', 'Enter scores, goal scorers, assists, cards and player of the match. Standings update automatically from confirmed results.')
      + `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h3>Awaiting result (${pending.length})</h3></div><div class="table-wrap"><table class="t"><tbody>${pending.map((f) => fixtureRow(f, act)).join('') || '<tr><td class="empty">No matches waiting for a result.</td></tr>'}</tbody></table></div></div>
         <div class="card flush mt2"><div class="card-head" style="padding:14px 16px 0"><h3>Completed (${done.length})</h3></div><div class="table-wrap"><table class="t"><tbody>${done.map((f) => fixtureRow(f, act)).join('') || '<tr><td class="empty">No results yet.</td></tr>'}</tbody></table></div></div>`;
    main.onclick = async (e) => { const b = e.target.closest('[data-res]'); if (b && await resultForm(Number(b.dataset.res))) { location.hash = '#/results'; reload(); } };
    if (want) { history.replaceState(null, '', '#/results'); if (await resultForm(want)) reload(); }
  };

  // ================================================================ LEAGUE TABLE
  function tableHtml(t, admin) {
    return `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h3>Group ${esc(t.group)}</h3><span class="small muted">${t.played}/${t.total} played${t.complete ? ' · complete' : ''}</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Club</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GF</th><th class="n">GA</th><th class="n">GD</th><th class="n">Pts</th>${admin ? '<th class="n" title="Fair play points: yellow 1, red 3">FP</th><th>Final order</th>' : ''}</tr></thead><tbody>
      ${t.rows.map((r) => `<tr class="${r.qualifies && t.played ? 'qualify' : ''}"><td>${r.pos}</td><td><span class="club-name">${crest(r, 'sm')}${esc(r.name)}</span>${r.unresolved ? ' <span class="badge red">Tied — decide order</span>' : r.note ? ` <span class="small muted">${esc(r.note)}</span>` : ''}</td>
        <td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td><td class="n">${r.gf}</td><td class="n">${r.ga}</td><td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.pts}</b></td>
        ${admin ? `<td class="n">${r.fair_play}</td><td><select data-rank="${r.club_id}" style="width:auto;min-height:32px;padding:3px 8px">${opts([['', 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], r.manual_rank ?? '')}</select></td>` : ''}</tr>`).join('')}</tbody></table></div></div>`;
  }
  ROUTES.table = async () => {
    const d = await API.get('/api/admin/standings');
    const ko = d.knockout;
    const m = (f) => (f ? `<div class="match"><div class="side"><img class="crest sm" src="${esc(f.home_logo_url)}" alt=""><span>${esc(f.home_name)}</span></div><div class="score ${f.status === 'completed' ? '' : 'vs'}">${f.status === 'completed' ? `${f.home_score}–${f.away_score}` : 'v'}</div><div class="side away"><span>${esc(f.away_name)}</span><img class="crest sm" src="${esc(f.away_logo_url)}" alt=""></div><div class="meta"><span>${esc(f.match_label || '')}</span><span>${f.home_pens != null ? `Penalties ${f.home_pens}–${f.away_pens}` : ''}</span></div></div>` : '<div class="match"><div class="muted">To be decided</div></div>');
    main.innerHTML = head('League Table', 'Tie-breakers: points → head-to-head points → head-to-head goal difference → goal difference → goals scored → fair play → administrator decision.', exportButtons('/api/admin/reports/standings'))
      + (d.tables.length ? `<div class="stack">${d.tables.map((t) => tableHtml(t, true)).join('')}</div>` : '<div class="card empty">Assign clubs to groups in Fixtures to start the league table.</div>')
      + `<p class="small muted mt1">"Final order" is only used when clubs are level on every tie-breaker (the administrator-controlled final resolution).</p>
      <h2 class="mt3">Knockout stage</h2>${ko.champion ? `<div class="champion mb2">${crest(ko.champion, 'lg')}<div><div class="small upper muted" style="font-weight:700">Champions</div><h2 style="margin:0;text-transform:uppercase">${esc(ko.champion.name)}</h2></div></div>` : ''}
      <div class="bracket">${m(ko.semis[0])}${m(ko.semis[1])}<div class="final">${m(ko.final)}</div></div>`;
    main.onchange = async (e) => { const s = e.target.closest('[data-rank]'); if (s) { await guarded(() => API.put('/api/admin/standings/manual-rank', { club_id: Number(s.dataset.rank), rank: s.value || null }), 'Order saved.'); reload(); } };
  };

  // ================================================================ PLAYER STATS
  ROUTES.stats = async () => {
    const rows = await API.get('/api/admin/stats');
    main.innerHTML = head('Player Statistics', 'Built automatically from confirmed match results.', exportButtons('/api/admin/reports/stats'))
      + `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th></th><th>Player</th><th>Club</th><th class="n">Goals</th><th class="n">Assists</th><th class="n">Player of the Match</th><th class="n">Yellow</th><th class="n">Red</th><th class="n">Own goals</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${avatar(p.photo_url, 'sm')}</td><td><b>${esc(p.full_name)}</b><div class="small muted">${esc(p.class_grade || '')}</div></td><td>${p.club_name ? `<span class="club-name small"><span class="dot" style="background:${esc(p.club_color)}"></span>${esc(p.club_name)}</span>` : ''}</td>
        <td class="n"><b>${p.goals}</b></td><td class="n">${p.assists}</td><td class="n">${p.motm}</td><td class="n">${p.yellow}</td><td class="n">${p.red}</td><td class="n">${p.own_goals}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No statistics yet. They appear once results with goal scorers are entered.</td></tr>'}</tbody></table></div></div>`;
  };

  // ================================================================ REPORTS
  ROUTES.reports = async () => {
    const s = await API.get('/api/admin/reports/summary');
    const tile = (v, l, cls = '') => `<div class="tile ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const rep = (title, desc, path) => `<div class="card"><h3>${esc(title)}</h3><p class="small muted">${esc(desc)}</p>${exportButtons(path, 'Download')}</div>`;
    main.innerHTML = head('Reports', 'Download reports in Excel, CSV or PDF.')
      + `<div class="grid c4">${tile(fmt(s.auctioned), 'Players auctioned')}${tile(fmt(s.sold), 'Sold at auction', 'green')}${tile(fmt(s.allocated), 'Allocated', 'gold')}${tile(fmt(s.total_spent), 'Total expenditure', 'red')}
        ${tile(fmt(s.average_price), 'Average purchase price')}${tile(s.highest ? fmt(s.highest.price) : '—', s.highest ? `Highest: ${esc(s.highest.full_name)}` : 'Highest-priced player', 'gold')}${tile(fmt(s.pending_allocation), 'Awaiting allocation', 'amber')}${tile(fmt(s.ready), 'Still in auction queue')}</div>
      <div class="card flush mt2"><div class="table-wrap"><table class="t"><thead><tr><th>Club</th><th class="n">Budget</th><th class="n">Expenditure</th><th class="n">Remaining</th><th class="n">Squad size</th></tr></thead><tbody>${s.clubs.map((c) => `<tr><td><span class="club-name">${crest(c, 'sm')}${esc(c.name)}</span></td><td class="n">${fmt(c.budget)}</td><td class="n">${fmt(c.spent)}</td><td class="n"><b>${fmt(c.remaining)}</b></td><td class="n">${c.count}/${c.max}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="grid c3 mt2">${rep('Complete season report', 'Auction summary, budgets, squads, full auction history and standings in one file.', '/api/admin/reports/full')}
        ${rep('Auction history', 'Every player auctioned: winning club, final price, previous bids, date and time, status.', '/api/admin/reports/auction')}
        ${rep('Club squads', 'All eight squads with positions, how each player joined, price and lineup role.', '/api/admin/reports/squads')}
        ${rep('Club budgets', 'Budget, expenditure and remaining points for every club.', '/api/admin/reports/budgets')}
        ${rep('Group standings', 'Current league tables.', '/api/admin/reports/standings')}
        ${rep('Player statistics', 'Goals, assists, player of the match and discipline.', '/api/admin/reports/stats')}
        ${rep('Registered players', 'Everyone registered this season with their status.', '/api/admin/players/export')}</div>`;
  };

  // ================================================================ SEASONS
  ROUTES.seasons = async () => {
    const list = await API.get('/api/admin/seasons');
    main.innerHTML = head('Season Management', 'The eight clubs are permanent. Each new season has fresh registrations, captains, auction, squads, fixtures and standings — previous seasons are always kept.', '<button class="btn red" data-new>+ New season</button>')
      + `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Phase</th><th class="n">Players</th><th class="n">Fixtures</th><th>Created</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr><td><b>${esc(s.name)}</b> ${s.is_current ? '<span class="badge green">Current</span>' : ''}</td><td>${esc(s.phase)}</td><td class="n">${s.players}</td><td class="n">${s.fixtures}</td><td class="small muted">${esc(dateFmt(s.created_at, false))}</td>
        <td class="right"><div class="row end" style="gap:6px"><button class="btn ghost sm" data-edit="${s.id}">Edit</button>${s.is_current ? '' : `<button class="btn ghost sm" data-cur="${s.id}">Make current</button>`}<a class="btn ghost sm" href="/#/archive?season=${s.id}" target="_blank">Public view ↗</a></div></td></tr>`).join('')}</tbody></table></div></div>
      <div class="alert mt2 small">Administration screens always work on the <b>current</b> season. Making an older season current lets you correct its records; switch back afterwards.</div>`;
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new !== undefined) {
        const y = new Date().getFullYear();
        const r = await modal({ title: 'Create a new season', body: `<form data-f><label class="field"><span>Season name</span><input type="text" name="name" value="Season ${y + 1}–${String(y + 2).slice(2)}" required></label>
          <label class="check mb2"><input type="checkbox" name="copy_settings" checked><span>Copy auction settings from the current season</span></label>
          <label class="check"><input type="checkbox" name="make_current" checked><span>Make it the current season now (the current season is marked as completed)</span></label></form>
          <p class="small muted mt2">Nothing is deleted. The previous season stays in the archive with its squads, results, standings and history.</p>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create season', cls: 'red', handler: async (el) => { await API.post('/api/admin/seasons', formData($('[data-f]', el))); toast('Season created.', 'ok'); return true; } }] });
        if (r) reload();
      }
      if (b.dataset.edit) {
        const s = list.find((x) => x.id === Number(b.dataset.edit));
        const r = await modal({ title: 'Edit season', body: `<form data-f><label class="field"><span>Name</span><input type="text" name="name" value="${esc(s.name)}"></label>
          <label class="field"><span>Phase</span><select name="phase">${opts([['setup', 'Set-up'], ['registration', 'Registration'], ['auction', 'Auction'], ['league', 'League'], ['completed', 'Completed']], s.phase)}</select></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { await API.put(`/api/admin/seasons/${s.id}`, formData($('[data-f]', el))); return true; } }] });
        if (r) reload();
      }
      if (b.dataset.cur) { if (await confirmBox({ title: 'Switch current season?', message: 'Administration, registration and the auction will work on this season.' })) { await guarded(() => API.post(`/api/admin/seasons/${b.dataset.cur}/make-current`), 'Current season changed.'); reload(); } }
    };
  };

  // ================================================================ USERS
  ROUTES.users = async () => {
    const [users, s] = await Promise.all([API.get('/api/admin/users'), API.get('/api/admin/settings')]);
    const ROLE = { admin: 'Super Administrator', operator: 'Auction Operator', captain: 'Club Captain', projector: 'Projector Display' };
    main.innerHTML = head('User Management', 'Captain accounts are created in Captain Accounts. Use a separate Projector account for the auction screen.', '<button class="btn red" data-new>+ New user</button>')
      + `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Permissions</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><b>${esc(u.username)}</b><div class="small muted">${esc(u.display_name)}</div></td><td>${esc(ROLE[u.role])}${u.club_name ? `<div class="small muted">${esc(u.club_name)}</div>` : ''}</td>
        <td class="small">${u.role === 'admin' ? 'Everything' : u.role === 'operator' ? (u.permissions.map((p) => esc(s.permissions[p])).join('<br>') || '<span class="muted">Run the auction only</span>') : '—'}</td>
        <td class="small muted">${u.last_login_at ? esc(dateFmt(u.last_login_at)) : '—'}</td>
        <td class="right"><div class="row end" style="gap:6px">${u.active ? '' : '<span class="badge red">Disabled</span>'}<button class="btn ghost sm" data-edit="${u.id}">Edit</button><button class="btn ghost sm" data-reset="${u.id}">Reset password</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
    const permBoxes = (sel = []) => Object.entries(s.permissions).map(([k, v]) => `<label class="check mb2"><input type="checkbox" name="perm_${k}" ${sel.includes(k) ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('');
    const permsFrom = (d) => Object.keys(s.permissions).filter((k) => d[`perm_${k}`]);
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new !== undefined) {
        const r = await modal({ title: 'New user', body: `<form data-f><label class="field"><span>Username</span><input type="text" name="username" autocapitalize="none" required></label>
          <label class="field"><span>Display name</span><input type="text" name="display_name"></label>
          <label class="field"><span>Role</span><select name="role">${opts([['operator', 'Auction Operator'], ['projector', 'Projector Display (read-only)'], ['admin', 'Super Administrator']])}</select></label>
          <div class="small muted mb2"><b>Operator permissions</b></div>${permBoxes()}
          <label class="field"><span>Password <em>(leave empty to generate one)</em></span><input type="text" name="password" autocomplete="off"></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create', handler: async (el) => { const d = formData($('[data-f]', el)); return API.post('/api/admin/users', { ...d, permissions: permsFrom(d) }); } }] });
        if (r) { await modal({ title: 'Account created', body: `<p>Username: <b>${esc(r.username)}</b><br>Password: <b style="font-family:monospace">${esc(r.password)}</b></p><p class="small muted">Shown only once. ${r.username && users.length ? '' : ''}</p>`, actions: [{ label: 'Done' }] }); reload(); }
      }
      if (b.dataset.edit) {
        const u = users.find((x) => x.id === Number(b.dataset.edit));
        const r = await modal({ title: `Edit ${u.username}`, body: `<form data-f><label class="field"><span>Display name</span><input type="text" name="display_name" value="${esc(u.display_name)}"></label>
          ${u.role === 'operator' ? `<div class="small muted mb2"><b>Operator permissions</b></div>${permBoxes(u.permissions)}` : ''}
          <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span>Account active</span></label></form>`,
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { const d = formData($('[data-f]', el)); await API.put(`/api/admin/users/${u.id}`, { ...d, permissions: permsFrom(d) }); toast('Saved.', 'ok'); return true; } }] });
        if (r) reload();
      }
      if (b.dataset.reset) {
        const u = users.find((x) => x.id === Number(b.dataset.reset));
        if (!(await confirmBox({ title: 'Reset password?', message: `Generate a new password for <b>${esc(u.username)}</b>?`, confirm: 'Reset' }))) return;
        const r = await guarded(() => API.post(`/api/admin/users/${u.id}/reset-password`));
        if (r) modal({ title: 'New password', body: `<p>Username: <b>${esc(u.username)}</b><br>Password: <b style="font-family:monospace">${esc(r.password)}</b></p><p class="small muted">Shown only once.</p>`, actions: [{ label: 'Done' }] });
      }
    };
  };

  // ================================================================ SETTINGS
  ROUTES.settings = async () => {
    const [s, ann] = await Promise.all([API.get('/api/admin/settings'), API.get('/api/admin/announcements')]);
    const st = s.settings;
    const sw = (k, label, help) => `<label class="switch"><span><b>${label}</b>${help ? `<br><span class="small muted">${help}</span>` : ''}</span><input type="checkbox" name="${k}" ${st[k] ? 'checked' : ''}></label>`;
    main.innerHTML = head('Settings', `${esc(s.season.name)} · version ${esc(s.version)}`)
      + `<div class="grid c2" style="align-items:start">
        <div class="stack">
          <form class="card" id="rf"><h3>Student registration</h3>${sw('registrationOpen', 'Registration open', 'Students can submit the registration form.')}
            <label class="field mt2"><span>Participation fee note <em>(shown discreetly at the bottom of the form)</em></span><input type="text" name="registrationFee" value="${esc(st.registrationFee)}" maxlength="40"></label>
            <div class="row end"><button class="btn sm">Save</button></div></form>
          <form class="card" id="pf"><h3>Public website</h3><p class="small muted">Choose what visitors can see. Private student information and administrative records are never public.</p>
            ${sw('publicSquads', 'Squads and player names', 'Show each club\'s squad and player profiles.')}${sw('publicPhotos', 'Player photographs', 'Only if school consent arrangements are in place. Requires squads to be public.')}
            ${sw('publicFixtures', 'Fixtures')}${sw('publicResults', 'Results')}${sw('publicStandings', 'Group standings')}${sw('publicStats', 'Top scorers and player statistics')}${sw('publicAuctionPrices', 'Auction prices and club budgets')}
            <div class="row end mt2"><button class="btn sm">Save</button></div></form>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>Announcements</h3><button class="btn sm" data-ann>+ New</button></div>
            ${ann.map((a) => `<div style="padding:8px 0;border-bottom:1px solid var(--g100)"><div class="row between"><b>${esc(a.title)}</b><span>${a.pinned ? '<span class="badge gold">Pinned</span> ' : ''}${a.published ? '<span class="badge green">Published</span>' : '<span class="badge">Draft</span>'}</span></div>
              <div class="small muted">${esc(a.body).slice(0, 140)}</div><div class="row mt1" style="gap:6px"><button class="btn ghost sm" data-edit-ann="${a.id}">Edit</button><button class="btn ghost sm" data-del-ann="${a.id}">Delete</button></div></div>`).join('') || '<p class="muted small">No announcements.</p>'}</div>
          <div class="card"><div class="card-head"><h3>Backups</h3><button class="btn sm" data-backup>Back up now</button></div>
            <p class="small muted">Automatic backups run every day and the last 30 are kept on the server. Download a copy regularly and store it somewhere safe.</p>
            ${s.backups.map((b) => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--g100)"><span>${esc(b.name.replace('backup-', ''))}<br><span class="muted">${(b.size / 1024).toFixed(0)} KB</span></span><button class="btn ghost sm" data-dl="/api/admin/backups/${esc(b.name)}/download">Download</button></div>`).join('') || '<p class="muted small">No backups yet.</p>'}</div>
          <div class="card"><h3>Your account</h3><button class="btn ghost sm" data-pw2>Change my password</button></div>
        </div></div>`;
    const save = async (e) => { e.preventDefault(); if (await guarded(() => API.put('/api/admin/settings', formData(e.target)), 'Saved.')) reload(); };
    $('#rf').addEventListener('submit', save); $('#pf').addEventListener('submit', save);
    const annForm = async (a) => {
      a = a || { published: 1 };
      const r = await modal({ title: a.id ? 'Edit announcement' : 'New announcement', body: `<form data-f><label class="field"><span>Title</span><input type="text" name="title" value="${esc(a.title || '')}" maxlength="120" required></label>
        <label class="field"><span>Message</span><textarea name="body" maxlength="3000" required>${esc(a.body || '')}</textarea></label>
        <label class="check mb2"><input type="checkbox" name="published" ${a.published ? 'checked' : ''}><span>Published</span></label><label class="check"><input type="checkbox" name="pinned" ${a.pinned ? 'checked' : ''}><span>Pin to the top</span></label></form>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', handler: async (el) => { const d = formData($('[data-f]', el)); if (a.id) await API.put(`/api/admin/announcements/${a.id}`, d); else await API.post('/api/admin/announcements', d); return true; } }] });
      if (r) reload();
    };
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ann !== undefined) annForm(null);
      if (b.dataset.editAnn) annForm(ann.find((a) => a.id === Number(b.dataset.editAnn)));
      if (b.dataset.delAnn && await confirmBox({ title: 'Delete announcement?', danger: true, confirm: 'Delete' })) { await guarded(() => API.del(`/api/admin/announcements/${b.dataset.delAnn}`)); reload(); }
      if (b.dataset.backup !== undefined) { if (await guarded(() => API.post('/api/admin/backups'), 'Backup created.')) reload(); }
      if (b.dataset.pw2 !== undefined) OLS.changePassword();
    };
  };

  // ================================================================ START
  OLS.requireUser(['admin']).then((me) => {
    ME = me;
    $('#top').innerHTML = OLS.topbar({ title: 'OLS Premier League', sub: 'Administration', user: me.user });
    OLS.bindTopbar();
    window.addEventListener('hashchange', route);
    route();
  }).catch(() => {});
  void ME; void POS;
})();
