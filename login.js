(function () {
  'use strict';
  const { $, API, formData } = OLS;
  const params = new URLSearchParams(location.search);
  const safeNext = (n) => (n && /^\/[a-z]*([/#?].*)?$/i.test(n) && !n.startsWith('//') ? n : null);
  let home = '/';
  const go = (me) => { const n = safeNext(params.get('next')); location.href = n && n !== '/' ? n : me.home; };
  const showErr = (el, msg) => { el.textContent = msg; el.classList.remove('hidden'); };

  function showChange() { $('#login').classList.add('hidden'); $('#change').classList.remove('hidden'); $('#change [name=current]').focus(); }

  API.me().then((me) => {
    if (me.user) {
      home = me.home;
      if (me.user.must_change_password || params.get('change')) showChange(); else go(me);
    }
  }).catch(() => {});

  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    $('#err').classList.add('hidden');
    try {
      const me = await API.post('/api/auth/login', formData(e.target), { allow401: true });
      API.csrf = me.csrf; home = me.home;
      if (me.user.must_change_password) { showChange(); $('#change [name=current]').value = e.target.password.value; $('#change [name=password]').focus(); } else go(me);
    } catch (err) { showErr($('#err'), err.message); } finally { btn.disabled = false; }
  });

  $('#change').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (d.password !== d.confirm) return showErr($('#err2'), 'The new passwords do not match.');
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      await API.post('/api/auth/password', { current: d.current, password: d.password });
      const me = await API.me(); go(me);
    } catch (err) { showErr($('#err2'), err.message); } finally { btn.disabled = false; }
  });
})();
