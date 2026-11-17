(function () {
  'use strict';
  const { $, $$, API, compressImage, esc } = OLS;
  const POSITIONS = [['Goalkeeper', 'GK'], ['Defender', 'DEF'], ['Midfielder', 'MID'], ['Forward', 'FWD']];
  const pick = (name, optional) => (optional ? `<label><input type="radio" name="${name}" value="" checked><span>None<small>&nbsp;</small></span></label>` : '')
    + POSITIONS.map(([p, s]) => `<label><input type="radio" name="${name}" value="${p}"${optional ? '' : ' required'}><span>${s}<small>${p}</small></span></label>`).join('');
  $('#p1').innerHTML = pick('primary_position');
  $('#p2').innerHTML = pick('secondary_position', true);
  $('#p2').style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';

  // the secondary position cannot be the same as the preferred one
  const syncSecondary = () => {
    const p = ($('input[name=primary_position]:checked') || {}).value;
    $$('input[name=secondary_position]').forEach((i) => {
      i.disabled = i.value && i.value === p;
      if (i.disabled && i.checked) $('input[name=secondary_position][value=""]').checked = true;
    });
  };
  $('#p1').addEventListener('change', syncSecondary);

  API.get('/api/public/registration').then((r) => {
    $('#season').textContent = r.season;
    if (r.fee) $('#fee').textContent = `Participation fee: ${r.fee}`;
    $('#squadNote').textContent = `Each club will have ${words(r.squadSize)} players in its squad, with ${words(r.starters)} playing at a time and ${words(r.subs)} available as substitutes. Final playing selection will be decided by the respective club captain.`;
    if (!r.open) { $('#closed').classList.remove('hidden'); $('#reg').classList.add('hidden'); }
  }).catch(() => {});
  function words(n) { return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n); }

  let photo = null;
  $('#photo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#photoLabel').textContent = 'Preparing photo…';
    photo = await compressImage(f, 1400, 0.85);
    const url = URL.createObjectURL(photo);
    $('#prev').src = url; $('#prev').classList.remove('hidden'); $('#ph').classList.add('hidden');
    $('#photoLabel').textContent = 'Photo added — tap to change';
  });

  $('#reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('#err');
    err.classList.add('hidden');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    if (form.full_name.value.trim().length < 3) return fail('Please enter your full name.');
    if (!form.class_grade.value.trim()) return fail('Please enter your class or grade.');
    if (!photo) return fail('Please add a photograph.');
    if (!$('input[name=primary_position]:checked')) return fail('Please choose your preferred playing position.');
    if (!form.confirm.checked) return fail('Please tick the confirmation box.');
    const fd = new FormData();
    for (const k of ['full_name', 'class_grade', 'website']) fd.set(k, form[k].value);
    fd.set('primary_position', $('input[name=primary_position]:checked').value);
    fd.set('secondary_position', ($('input[name=secondary_position]:checked') || {}).value || '');
    fd.set('confirm', 'true');
    fd.set('photo', photo, photo.name || 'photo.jpg');
    const btn = $('#submit'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const r = await API.post('/api/public/register', fd);
      $('#doneName').textContent = r.name || form.full_name.value;
      form.classList.add('hidden'); $('#done').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) { fail(x.message); } finally { btn.disabled = false; btn.textContent = 'Submit registration'; }
  });
  void esc;
})();
