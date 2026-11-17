/* OLS Premier League — shared browser helpers (no framework, small and fast) */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
  const POS = { Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD' };
  const STATUS = {
    pending: ['Pending Approval', 'amber'], approved: ['Approved', 'blue'], rejected: ['Rejected', 'red'], ready: ['Ready for Auction', 'navy'],
    bidding: ['Currently Bidding', 'gold'], sold: ['Sold', 'green'], pending_allocation: ['Pending Allocation', 'amber'], allocated: ['Allocated', 'green'],
    withdrawn: ['Withdrawn', ''],
  };

  const API = {
    csrf: null,
    async req(method, url, body, opts = {}) {
      const headers = {};
      if (API.csrf) headers['X-CSRF-Token'] = API.csrf;
      let payload = body;
      if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      let res;
      try {
        res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
      } catch {
        throw Object.assign(new Error('Cannot reach the server. Check the internet connection and try again.'), { offline: true });
      }
      if (opts.raw) return res;
      const type = res.headers.get('content-type') || '';
      const data = type.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        if (res.status === 401 && !opts.allow401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); }
        if (data && data.code === 'must_change_password') { location.href = '/login?change=1&next=' + encodeURIComponent(location.pathname); }
        throw Object.assign(new Error((data && data.error) || (data && data.message) || `Request failed (${res.status})`), { status: res.status, data });
      }
      return data;
    },
    get: (u, o) => API.req('GET', u, undefined, o),
    post: (u, b, o) => API.req('POST', u, b ?? {}, o),
    put: (u, b, o) => API.req('PUT', u, b ?? {}, o),
    del: (u, o) => API.req('DELETE', u, undefined, o),
    async me() {
      const r = await API.get('/api/auth/me', { allow401: true });
      API.csrf = r.csrf || null;
      return r;
    },
    async download(url, fallbackName) {
      const res = await API.req('GET', url, undefined, { raw: true });
      if (!res.ok) { let m = 'Download failed.'; try { m = (await res.json()).error || m; } catch { /* */ } throw new Error(m); }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || fallbackName || 'download';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };

  function toast(msg, type = '', ms = 3200) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
  }

  /** modal({ title, body, wide, actions: [{ label, cls, value, close }] }) -> Promise(value) ; onOpen(el) hook */
  function modal({ title, body, wide, actions = [{ label: 'Close', cls: 'ghost', value: null }], onOpen, dismissable = true }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-h"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Close">✕</button></div>
        <div class="modal-b">${body}</div>
        <div class="modal-f">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
      document.addEventListener('keydown', onKey);
      back.addEventListener('click', async (e) => {
        if (e.target === back && dismissable) return close(null);
        if (e.target.closest('[data-x]')) return close(null);
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const a = actions[Number(b.dataset.i)];
        if (a.handler) {
          b.disabled = true;
          try { const v = await a.handler(back); if (v !== false) close(v === undefined ? a.value : v); } catch (err) { toast(err.message, 'err', 5000); } finally { b.disabled = false; }
        } else close(a.value);
      });
      document.body.appendChild(back);
      const first = back.querySelector('input, select, textarea');
      if (first) setTimeout(() => first.focus(), 30);
      if (onOpen) onOpen(back);
    });
  }

  /** Confirmation dialog. With requireReason the user must type a reason (stored in the audit log). */
  function confirmBox({ title = 'Please confirm', message = '', confirm = 'Confirm', danger = false, requireReason = false, reasonLabel = 'Reason (saved in the audit log)' }) {
    return modal({
      title,
      body: `<p>${message}</p>${requireReason ? `<label class="field"><span>${esc(reasonLabel)}</span><textarea data-reason maxlength="300" placeholder="Explain why this change is needed"></textarea></label>` : ''}`,
      actions: [{ label: 'Cancel', cls: 'ghost', value: null }, {
        label: confirm, cls: danger ? 'red' : '',
        handler: (el) => {
          if (!requireReason) return { ok: true };
          const r = el.querySelector('[data-reason]').value.trim();
          if (r.length < 3) { toast('Please enter a reason.', 'err'); return false; }
          return { ok: true, reason: r };
        },
      }],
    });
  }

  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
    }
    return o;
  }

  const crest = (c, cls = '') => `<img class="crest ${cls}" src="${esc(c.logo_url)}" alt="${esc(c.name || '')} crest" loading="lazy" width="40" height="46">`;
  const posTag = (p, alt) => (p ? `<span class="pos ${alt ? 'alt' : POS[p]}" title="${esc(p)}">${POS[p]}</span>` : '');
  const statusBadge = (s) => { const [l, c] = STATUS[s] || [s, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };
  const avatar = (url, cls = '') => (url ? `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="avatar silhouette ${cls}"></span>`);

  /** Football-style player card. No numbers are ever shown. */
  function playerCard(p, { club, size = '', extra = '' } = {}) {
    const c1 = club ? club.primary_color : '#1B2A4A';
    const c2 = club ? club.secondary_color : '#31497A';
    return `<div class="pcard ${size}" style="--c1:${esc(c1)};--c2:${esc(c2)}">
      <div class="ph">${p.photo_url ? `<img class="photo" src="${esc(p.photo_url)}" alt="${esc(p.full_name)}" loading="lazy">` : '<span class="silhouette"></span>'}
        <div class="tags">${posTag(p.primary_position)}${p.secondary_position ? posTag(p.secondary_position, true) : ''}</div>
        ${club ? `<img class="club" src="${esc(club.logo_url)}" alt="">` : ''}
      </div>
      <div class="info"><div class="nm">${esc(p.full_name)}</div><div class="cl">${esc(p.class_grade || '')}${p.is_captain ? ' · <b>Captain</b>' : ''}</div>${extra}</div>
    </div>`;
  }

  function dateFmt(s, withTime = true) {
    if (!s) return '';
    const d = new Date(s.length === 16 ? s : s);
    if (isNaN(d)) return s;
    return d.toLocaleString('en-GB', withTime ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Shrink a photo in the browser before upload: much faster on slow connections. */
  function compressImage(file, maxDim = 1400, quality = 0.85) {
    return new Promise((resolve) => {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 900000) { URL.revokeObjectURL(url); return resolve(file); }
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => { URL.revokeObjectURL(url); resolve(b && b.size < file.size ? new File([b], 'photo.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /** Live auction connection with automatic reconnection and a visible warning when offline. */
  function liveConnection({ onState, onSold, onStatus }) {
    if (typeof io !== 'function') { onStatus && onStatus(false); return null; }
    const socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 8000 });
    let offset = 0;
    socket.on('connect', () => onStatus && onStatus(true));
    socket.on('disconnect', () => onStatus && onStatus(false));
    socket.on('connect_error', (e) => {
      onStatus && onStatus(false);
      if (e && e.message === 'unauthorised') location.href = '/login?next=' + encodeURIComponent(location.pathname);
    });
    socket.on('state', (s) => { offset = s.serverNow - Date.now(); onState && onState(s); });
    socket.on('sold', (s) => onSold && onSold(s));
    // when a phone wakes up or the tab returns, ask for a fresh state
    document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) socket.emit('state:get', (s) => { offset = s.serverNow - Date.now(); onState && onState(s); }); });
    return { socket, now: () => Date.now() + offset };
  }

  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 32); }

  /** App top bar for signed-in screens */
  function topbar({ title, sub = 'Building Al-Qawiyy, Al-Ameen Muslims', user, menu = true, extra = '' }) {
    return `<header class="topbar">
      ${menu ? '<button class="icon-btn menu-toggle" data-menu aria-label="Menu" style="color:#fff;font-size:22px">☰</button>' : ''}
      <a class="logo" href="/" title="OLS Premier League home"><img src="/img/ols-logo.png" alt="O Levels School"></a>
      <div class="title">${esc(title)}<small>${esc(sub)}</small></div>
      <div class="spacer"></div>${extra}
      <div class="user"><span class="hide-sm">${esc(user ? user.display_name : '')}</span>
        <button class="btn ghost sm" data-pw>Password</button><button class="btn ghost sm" data-logout>Sign out</button></div>
    </header><div class="stripe"></div>`;
  }
  function bindTopbar(root = document) {
    const lo = $('[data-logout]', root);
    if (lo) lo.addEventListener('click', async () => { try { await API.post('/api/auth/logout'); } catch { /* */ } location.href = '/login'; });
    const pw = $('[data-pw]', root);
    if (pw) pw.addEventListener('click', changePassword);
    const m = $('[data-menu]', root);
    if (m) m.addEventListener('click', () => { const n = $('.sidenav'); if (n) n.classList.toggle('open'); });
  }
  function changePassword() {
    return modal({
      title: 'Change password',
      body: `<form data-f><label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
             <label class="field"><span>New password <em>(at least 8 characters)</em></span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label></form>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save password', handler: async (el) => { await API.post('/api/auth/password', formData($('[data-f]', el))); toast('Password changed.', 'ok'); } }],
    });
  }

  async function requireUser(roles) {
    const me = await API.me();
    if (!me.user) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('redirect'); }
    if (me.user.must_change_password) { location.href = '/login?change=1&next=' + encodeURIComponent(location.pathname); throw new Error('redirect'); }
    if (roles && !roles.includes(me.user.role)) { location.href = me.home || '/'; throw new Error('redirect'); }
    return me;
  }

  // register the service worker that caches the app shell (never live auction data)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  window.OLS = { $, $$, esc, fmt, POS, STATUS, API, toast, modal, confirmBox, formData, crest, posTag, statusBadge, avatar, playerCard, dateFmt, compressImage, liveConnection, uid, topbar, bindTopbar, changePassword, requireUser };
})();
