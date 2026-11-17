/* Public league website (read-only). */
(function () {
  'use strict';
  const { $, $$, esc, fmt, API, crest, playerCard, dateFmt, posTag } = OLS;
  const app = $('#app');
  let home = null;

  const qs = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const seasonQ = () => (qs().get('season') ? `?season=${encodeURIComponent(qs().get('season'))}` : '');
  const seasonLink = () => (qs().get('season') ? `?season=${encodeURIComponent(qs().get('season'))}` : '');
  const section = (title, body, extra = '') => `<section class="section"><div class="wrap"><div class="section-title"><h2>${title}</h2>${extra}</div>${body}</div></section>`;
  const STAGE = { group: 'Group stage', semi: 'Semi-final', final: 'Grand Final', third_place: 'Third place', friendly: 'Friendly' };
  const hidden = (what) => `<div class="card empty">${esc(what)} will appear here once published by the school.</div>`;

  function matchCard(f, scorers) {
    const done = f.status === 'completed';
    const hw = done && f.winner_club_id === f.home.id; const aw = done && f.winner_club_id === f.away.id;
    const sc = scorers && scorers[f.id] ? scorers[f.id] : [];
    const list = (cid) => sc.filter((s) => s.club_id === cid).map((s) => `${esc(s.name || 'Goal')}${s.own_goal ? ' (og)' : ''}${s.minute != null ? ` ${s.minute}'` : ''}`).join(', ');
    return `<div class="match">
      <a class="side ${hw ? 'w' : aw ? 'l' : ''}" href="#/club/${esc(f.home.slug)}" style="text-decoration:none;color:inherit">${crest(f.home)}<span class="f">${esc(f.home.name)}</span><span class="s">${esc(f.home.short_name || f.home.name)}</span></a>
      <div class="score ${done ? '' : 'vs'}">${done ? `${f.home_score} – ${f.away_score}` : f.status === 'postponed' ? 'PP' : 'VS'}</div>
      <a class="side away ${aw ? 'w' : hw ? 'l' : ''}" href="#/club/${esc(f.away.slug)}" style="text-decoration:none;color:inherit"><span class="f">${esc(f.away.name)}</span><span class="s">${esc(f.away.short_name || f.away.name)}</span>${crest(f.away)}</a>
      <div class="meta"><span>${esc(f.match_label || STAGE[f.stage])}${f.home_pens != null ? ` · Penalties ${f.home_pens}–${f.away_pens}` : ''}</span><span>${f.kickoff_at ? esc(dateFmt(f.kickoff_at)) : 'Date to be confirmed'}${f.venue ? ' · ' + esc(f.venue) : ''}</span></div>
      ${done && (list(f.home.id) || list(f.away.id) || f.motm_name) ? `<div class="meta" style="border-top:0;padding-top:0"><span>${list(f.home.id)}</span><span>${list(f.away.id)}</span></div>${f.motm_name ? `<div class="meta" style="border-top:0;padding-top:0;justify-content:center"><span>⭐ Player of the match: <b>${esc(f.motm_name)}</b></span></div>` : ''}` : ''}
    </div>`;
  }

  function tableHtml(t, compact) {
    return `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h3>Group ${esc(t.group)}</h3><span class="small muted">${t.played}/${t.total} played</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Club</th><th class="n">P</th>${compact ? '' : '<th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GF</th><th class="n">GA</th>'}<th class="n">GD</th><th class="n">Pts</th></tr></thead><tbody>
      ${t.rows.map((r) => `<tr class="${r.qualifies && t.played ? 'qualify' : ''}"><td>${r.pos}</td><td><a class="club-name" href="#/club/${esc(r.slug)}" style="text-decoration:none;color:inherit">${crest(r, 'sm')}${esc(compact ? r.short_name : r.name)}</a></td><td class="n">${r.p}</td>
        ${compact ? '' : `<td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td><td class="n">${r.gf}</td><td class="n">${r.ga}</td>`}<td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.pts}</b></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function bracket(ko) {
    if (!ko || (!ko.semis.length && !ko.final)) return '<div class="card empty">The knockout stage begins after the group matches. Group winners and runners-up qualify.</div>';
    const m = (f, label) => (f ? matchCard({ ...f, home: { id: f.home_club_id, name: f.home_name, short_name: f.home_short, slug: f.home_slug, logo_url: f.home_logo_url }, away: { id: f.away_club_id, name: f.away_name, short_name: f.away_short, slug: f.away_slug, logo_url: f.away_logo_url } })
      : `<div class="match"><div class="muted" style="grid-column:1/-1;text-align:center">${label} — to be decided</div></div>`);
    return `${ko.champion ? `<div class="champion mb2">${crest(ko.champion, 'lg')}<div><div class="small upper" style="font-weight:700;color:#8A6D12">🏆 Champions</div><h2 style="margin:0;text-transform:uppercase">${esc(ko.champion.name)}</h2></div></div>` : ''}
      <div class="bracket">${m(ko.semis[0], 'Semi-final 1 (A1 v B2)')}${m(ko.semis[1], 'Semi-final 2 (B1 v A2)')}<div class="final"><h3 class="center upper">Grand Final</h3>${m(ko.final, 'Grand Final')}</div></div>
      ${ko.third ? `<div class="mt2" style="max-width:520px;margin-left:auto;margin-right:auto">${m(ko.third, 'Third place')}</div>` : ''}`;
  }

  const ROUTES = {
    async ''() {
      home = await API.get('/api/public/home' + seasonQ());
      $('#regBtn').classList.toggle('hidden', !home.registration_open);
      const h = home;
      app.innerHTML = `<section class="hero"><div class="in">
          <div><div class="plate"><img src="/img/ols-logo.png" alt="O Levels School"></div>
            <h1>OLS <span>Premier</span><br>League</h1>
            <div class="motto">Building Al-Qawiyy, Al-Ameen Muslims</div>
            <p class="sub">Strength in Character. Trustworthiness in Action.</p>
            <p class="arabic" lang="ar"><b>القوي</b> · Al-Qawiyy &nbsp;&nbsp; <b>الأمين</b> · Al-Ameen</p>
            <div class="cta">${h.registration_open ? '<a class="btn red lg" href="/register">Register to play</a>' : ''}<a class="btn gold lg" href="#/standings">Standings</a><a class="btn ghost lg" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.35)" href="#/clubs">The eight clubs</a></div></div>
          <div class="crests">${h.clubs.map((c) => `<a href="#/club/${esc(c.slug)}"><img src="${esc(c.logo_url)}" alt="">${esc(c.short_name)}</a>`).join('')}</div>
        </div></section>
        ${h.announcements.length ? section('Announcements', `<div class="grid c2">${h.announcements.map((a) => `<div class="card" ${a.pinned ? 'style="border-left:4px solid var(--gold)"' : ''}><h3>${esc(a.title)}</h3><p class="mb0" style="white-space:pre-line">${esc(a.body)}</p><div class="small muted mt1">${esc(dateFmt(a.created_at, false))}</div></div>`).join('')}</div>`) : ''}
        ${section('Latest results', h.public.results ? (h.results.length ? `<div class="grid matches">${h.results.map((f) => matchCard(f)).join('')}</div>` : '<div class="card empty">No results yet.</div>') : hidden('Results'), '<a href="#/results">All results →</a>')}
        ${section('Upcoming fixtures', h.public.fixtures ? (h.upcoming.length ? `<div class="grid matches">${h.upcoming.map((f) => matchCard(f)).join('')}</div>` : '<div class="card empty">Fixtures will be announced after the auction.</div>') : hidden('Fixtures'), '<a href="#/fixtures">All fixtures →</a>')}
        ${section('Group standings', h.public.standings && h.tables.length ? `<div class="grid c2">${h.tables.map((t) => tableHtml(t, true)).join('')}</div>` : '<div class="card empty">Standings will appear once the groups are drawn.</div>', '<a href="#/standings">Full table →</a>')}
        ${section('Our values', `<div class="values"><div class="value q"><div class="ar" lang="ar">القوي</div><h3>Al-Qawiyy</h3><p class="mb0">Strength, courage, capability and determination — on the pitch and in life.</p></div>
          <div class="value a"><div class="ar" lang="ar">الأمين</div><h3>Al-Ameen</h3><p class="mb0">Trustworthiness, honesty, responsibility and integrity — in every game we play.</p></div></div>`)}`;
    },
    async about() {
      app.innerHTML = section('About OLS Premier League', `<div class="grid c2" style="align-items:start"><div class="card"><p><b>OLS Premier League</b> is the official football league of O Levels School. It establishes eight permanent sporting clubs that represent the school in football competitions and future school activities.</p>
        <p>It is the beginning of a long-term school sporting legacy, built on the school's Islamic identity and Tarbiyah vision: developing Muslims who are strong in character, capable, trustworthy and responsible.</p>
        <p class="mb0">Players register, are approved by the school, and join clubs through a live auction run by club captains. Each club has a squad of seven — five on the field and two substitutes — selected by its captain.</p></div>
        <div class="card"><h3>How the league works</h3><ul><li>Eight clubs in two groups of four.</li><li>Each club plays the other three in its group once.</li><li>Win 3 points, draw 1, loss 0.</li><li>The top two in each group reach the semi-finals: A1 v B2 and B1 v A2.</li><li>The semi-final winners meet in the Grand Final.</li></ul>
        <p class="small muted mb0">Tie-breakers: points, head-to-head points, head-to-head goal difference, goal difference, goals scored, fair play.</p></div></div>
        <div class="values mt2"><div class="value q"><div class="ar" lang="ar">القوي</div><h3>Al-Qawiyy</h3><p class="mb0">Strength, courage, capability and determination.</p></div><div class="value a"><div class="ar" lang="ar">الأمين</div><h3>Al-Ameen</h3><p class="mb0">Trustworthiness, honesty, responsibility and integrity.</p></div></div>`);
    },
    async clubs() {
      const d = await API.get('/api/public/clubs' + seasonQ());
      app.innerHTML = section('The Eight Clubs', `<div class="grid c4">${d.clubs.map((c) => `<a class="club-card" href="#/club/${esc(c.slug)}${seasonLink()}" style="--c1:${esc(c.primary_color)};--c2:${esc(c.secondary_color)}">${crest(c, 'lg')}<b>${esc(c.name)}</b>
        <span class="small muted">${c.group_name ? `Group ${esc(c.group_name)}` : '&nbsp;'}${c.table ? ` · ${c.table.pts} pts` : ''}${c.players != null ? ` · ${c.players} players` : ''}</span></a>`).join('')}</div>`);
    },
    async club(slug) {
      const d = await API.get(`/api/public/clubs/${encodeURIComponent(slug)}${seasonQ()}`);
      const c = d.club;
      app.innerHTML = `<section class="club-hero" style="--c1:${esc(c.primary_color)};--c2:${esc(c.secondary_color)}"><div class="in">${crest(c, 'xl')}
          <div><div class="upper small" style="font-weight:700;opacity:.85;letter-spacing:.14em">OLS Premier League · ${esc(d.season.name)}</div><h1>${esc(c.name)}</h1>
          ${c.motto ? `<div style="font-size:1.1rem;opacity:.9"><i>${esc(c.motto)}</i></div>` : ''}
          <div class="row mt1">${c.group_name ? `<span class="badge" style="background:rgba(255,255,255,.18);color:#fff">Group ${esc(c.group_name)}</span>` : ''}${d.honours.championships ? `<span class="badge gold">🏆 ${d.honours.championships}× Champions</span>` : ''}${d.honours.finals ? `<span class="badge" style="background:rgba(255,255,255,.18);color:#fff">${d.honours.finals} final(s)</span>` : ''}</div></div></div></section>
        ${c.description ? section('About the club', `<div class="card"><p class="mb0" style="white-space:pre-line">${esc(c.description)}</p></div>`) : ''}
        ${section('Squad', d.squad ? (d.squad.length ? `<div class="squad-grid">${d.squad.map((p) => `<a href="#/player/${p.id}" style="text-decoration:none">${playerCard(p, { club: c, extra: p.lineup_role === 'starter' ? '<div class="small" style="color:var(--green);font-family:var(--body);font-weight:700">Starting five</div>' : p.lineup_role === 'sub' ? '<div class="small muted" style="font-family:var(--body)">Substitute</div>' : '' })}</a>`).join('')}</div>` : '<div class="card empty">The squad will be formed in the live auction.</div>') : hidden('The squad'),
          d.finance ? `<span class="small muted">Auction spend ${fmt(d.finance.spent)} · remaining ${fmt(d.finance.remaining)}</span>` : '')}
        ${section('Matches', d.fixtures.length ? `<div class="grid matches">${d.fixtures.map((f) => matchCard(f)).join('')}</div>` : '<div class="card empty">No fixtures yet.</div>')}
        ${d.stats.length ? section('Club statistics', `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th class="n">Goals</th><th class="n">Assists</th><th class="n">Player of the Match</th></tr></thead><tbody>${d.stats.map((s) => `<tr><td>${esc(s.full_name)}</td><td class="n"><b>${s.goals}</b></td><td class="n">${s.assists}</td><td class="n">${s.motm}</td></tr>`).join('')}</tbody></table></div></div>`) : ''}
        ${section('History & achievements', `<div class="grid c2" style="align-items:start"><div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Finish</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GD</th></tr></thead><tbody>
          ${d.history.map((h) => `<tr><td><a href="#/club/${esc(c.slug)}?season=${h.season.id}">${esc(h.season.name)}</a></td><td>${h.champion ? '🏆 ' : ''}${esc(h.finish || '—')}${h.group_position ? ` <span class="small muted">(Group ${esc(h.group)} · ${h.group_position}${['', 'st', 'nd', 'rd'][h.group_position] || 'th'})</span>` : ''}</td><td class="n">${h.p}</td><td class="n">${h.w}</td><td class="n">${h.d}</td><td class="n">${h.l}</td><td class="n">${h.gd > 0 ? '+' : ''}${h.gd}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">The first season is under way.</td></tr>'}</tbody></table></div></div>
          <div class="card"><h3>Achievements</h3>${d.achievements.map((a) => `<div style="padding:6px 0;border-bottom:1px solid var(--g100)">🏆 <b>${esc(a.title)}</b>${a.season_name ? ` <span class="small muted">${esc(a.season_name)}</span>` : ''}${a.description ? `<div class="small muted">${esc(a.description)}</div>` : ''}</div>`).join('') || '<p class="muted mb0">No achievements recorded yet.</p>'}</div></div>`)}`;
    },
    async player(id) {
      const d = await API.get(`/api/public/players/${encodeURIComponent(id)}`);
      const p = d.player;
      app.innerHTML = section(esc(p.full_name), `<div class="row" style="align-items:flex-start;gap:24px">${playerCard(p, { club: d.club })}
        <div class="card grow"><p><b>Club:</b> <a href="#/club/${esc(d.club.slug)}">${esc(d.club.name)}</a></p><p><b>Class / Grade:</b> ${esc(p.class_grade)}</p>
          <p><b>Preferred position:</b> ${posTag(p.primary_position)} ${esc(p.primary_position)}</p>${p.secondary_position ? `<p><b>Secondary position:</b> ${posTag(p.secondary_position, true)} ${esc(p.secondary_position)}</p>` : ''}
          <p class="mb0"><b>Season:</b> ${esc(p.season)}</p>
          ${d.stats ? `<div class="grid c3 mt2"><div class="tile"><div class="v">${d.stats.goals}</div><div class="l">Goals</div></div><div class="tile gold"><div class="v">${d.stats.assists}</div><div class="l">Assists</div></div><div class="tile green"><div class="v">${d.stats.motm}</div><div class="l">Player of the Match</div></div></div>` : ''}</div></div>`);
    },
    async fixtures() {
      const d = await API.get('/api/public/fixtures' + seasonQ());
      const list = d.fixtures.filter((f) => f.status !== 'completed');
      const groups = ['group', 'semi', 'third_place', 'final', 'friendly'].map((s) => [s, list.filter((f) => f.stage === s)]).filter(([, l]) => l.length);
      app.innerHTML = section('Fixtures', d.public.fixtures ? (groups.length ? groups.map(([s, l]) => `<h3 class="mt2">${STAGE[s]}</h3><div class="grid matches">${l.map((f) => matchCard(f)).join('')}</div>`).join('') : '<div class="card empty">No upcoming fixtures.</div>') : hidden('Fixtures'), `<span class="muted">${esc(d.season.name)}</span>`);
    },
    async results() {
      const d = await API.get('/api/public/fixtures' + seasonQ());
      const list = d.fixtures.filter((f) => f.status === 'completed').reverse();
      app.innerHTML = section('Results', d.public.results ? (list.length ? `<div class="grid matches">${list.map((f) => matchCard(f, d.scorers)).join('')}</div>` : '<div class="card empty">No results yet.</div>') : hidden('Results'), `<span class="muted">${esc(d.season.name)}</span>`);
    },
    async standings() {
      const d = await API.get('/api/public/standings' + seasonQ());
      app.innerHTML = section('Group Standings', d.public.standings ? (d.tables.length ? `<div class="grid c2">${d.tables.map((t) => tableHtml(t)).join('')}</div><p class="small muted mt1">Top two in each group qualify for the semi-finals (green bar). Tie-breakers: points, head-to-head points, head-to-head goal difference, goal difference, goals scored, fair play.</p>` : '<div class="card empty">The groups have not been drawn yet.</div>') : hidden('Standings'), `<span class="muted">${esc(d.season.name)}</span>`)
        + section('Knockout stage', bracket(d.knockout));
    },
    async knockout() {
      const d = await API.get('/api/public/standings' + seasonQ());
      app.innerHTML = section('Knockout Stage & Grand Final', bracket(d.knockout), `<span class="muted">${esc(d.season.name)}</span>`);
    },
    async stats() {
      const d = await API.get('/api/public/stats' + seasonQ());
      const top = (key, label) => { const l = d.players.filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 10);
        return `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h3>${label}</h3></div><div class="table-wrap"><table class="t"><tbody>${l.map((p, i) => `<tr><td style="width:28px">${i + 1}</td><td>${p.photo_url ? OLS.avatar(p.photo_url, 'sm') : ''}</td><td><b>${esc(p.full_name)}</b><div class="small muted">${esc(p.club_name || '')}</div></td><td class="n"><b style="font:800 1.4rem var(--display)">${p[key]}</b></td></tr>`).join('') || '<tr><td class="empty">Nothing yet.</td></tr>'}</tbody></table></div></div>`; };
      app.innerHTML = section('Top Scorers & Player Statistics', d.public.stats && d.public.squads ? `<div class="grid c3">${top('goals', 'Top scorers')}${top('assists', 'Most assists')}${top('motm', 'Player of the Match awards')}</div>` : hidden('Player statistics'), `<span class="muted">${esc(d.season.name)}</span>`);
    },
    async archive() {
      const d = await API.get('/api/public/archive');
      app.innerHTML = section('Season Archive', `<div class="grid c2">${d.seasons.map((s) => `<div class="card"><div class="row between"><h3 class="mb0">${esc(s.name)}</h3>${s.is_current ? '<span class="badge green">Current season</span>' : '<span class="badge">Completed</span>'}</div>
        ${s.champion ? `<div class="champion mt2" style="padding:10px 14px">${crest(s.champion)}<div><div class="small upper" style="font-weight:700;color:#8A6D12">Champions</div><b style="font:800 1.3rem var(--display);text-transform:uppercase">${esc(s.champion.name)}</b>${s.runner_up ? `<div class="small muted">Runners-up: ${esc(s.runner_up)}</div>` : ''}</div></div>` : ''}
        <p class="small muted mt2">${s.players} players · ${s.matches} matches played${s.top_scorer ? ` · Top scorer: <b>${esc(s.top_scorer.name)}</b> (${s.top_scorer.goals})` : ''}</p>
        <div class="row" style="gap:6px"><a class="btn ghost sm" href="#/standings?season=${s.id}">Standings</a><a class="btn ghost sm" href="#/results?season=${s.id}">Results</a><a class="btn ghost sm" href="#/clubs?season=${s.id}">Clubs</a><a class="btn ghost sm" href="#/stats?season=${s.id}">Statistics</a></div></div>`).join('')}</div>`);
    },
  };

  async function route() {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0];
    const [name, arg] = path.split('/');
    $$('#siteNav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}` || (name === '' && a.getAttribute('href') === '#/')));
    $('#siteNav').classList.remove('open');
    const fn = ROUTES[name] || ROUTES[''];
    try { await fn(arg); } catch (e) { app.innerHTML = section('Not available', `<div class="card empty">${esc(e.message)}</div>`); }
    window.scrollTo(0, 0);
  }
  $('#navToggle').addEventListener('click', () => $('#siteNav').classList.toggle('open'));
  window.addEventListener('hashchange', route);
  route();
  API.get('/api/public/registration').then((r) => $('#regBtn').classList.toggle('hidden', !r.open)).catch(() => {});
  void fmt;
})();
