/* ==========================================================
   BrainError | app (router, views, grading, editor, events)
   ========================================================== */

/* ---------- helpers ---------- */
const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const BLANK_RE = /\[\[(.+?)\]\]/g;
const LANGS = ['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'php', 'html', 'css', 'sql', 'go', 'rust', 'ruby', 'kotlin', 'swift', 'bash'];
const EXT_LANG = { js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', java: 'java', c: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', html: 'html', css: 'css', sql: 'sql', go: 'go', rs: 'rust', rb: 'ruby', kt: 'kotlin', swift: 'swift', sh: 'bash' };
const PLAY_PROGRESS_TTL = 24 * 60 * 60 * 1000;
const TYPE = {
  mcq: { label: 'Multiple choice', short: 'MCQ', icon: 'check', blurb: 'Pick the correct choice' },
  ident: { label: 'Identification', short: 'ID', icon: 'search', blurb: 'Type the exact term' },
  enum: { label: 'Enumeration', short: 'ENUM', icon: 'list', blurb: 'List several answers' },
  code: { label: 'Code challenge', short: 'CODE', icon: 'code', blurb: 'Fill, debug or arrange code' },
};
const S = { play: null, ed: null, dirty: false };

/* ---------- toast / modal ---------- */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function openModal({ title, body, actions = [], wide = false }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-act="modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-modal-btn="${i}">${a.label}</button>`).join('')}</div></div></div>`;
  $$('[data-modal-btn]', root).forEach((b) => b.addEventListener('click', () => {
    const a = actions[+b.dataset.modalBtn];
    if (a.onClick) { const keep = a.onClick(); if (keep === false) return; }
    closeModal();
  }));
  const f = $('input,textarea,select', root); if (f) f.focus();
}
function confirmBox(message, onYes, label = 'Delete') {
  openModal({ title: 'Are you sure?', body: `<p class="muted">${message}</p>`, actions: [{ label: 'Cancel', cls: 'ghost' }, { label, cls: 'danger solid', onClick: onYes }] });
}
function download(name, obj) {
  const b = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
const go = (p) => { if (location.hash.slice(1) === p) render(); else location.hash = p; };
const homeFor = (u) => (u.role === 'admin' ? '/manage' : '/dashboard');
function setPath(obj, path, val) {
  const k = path.split('.'); let o = obj;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k[k.length - 1]] = val;
}

/* ==========================================================
   Grading
   ========================================================== */
const normText = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[.,;:!?"'`()]/g, '').replace(/\s+/g, ' ').trim();
const blanksOf = (q) => [...String(q.code || '').matchAll(BLANK_RE)].map((m) => m[1]);
const arrangeLines = (q) => String(q.code || '').split('\n').filter((l) => normalizeCode(l, q.language) !== '');
const sectionQuestions = (section) => Array.isArray(section.questions) ? section.questions : [];

function qMax(q) {
  if (q.type === 'enum') return q.answers.length;
  if (q.type === 'code') return q.mode === 'blank' ? blanksOf(q).length : q.mode === 'bug' ? 2 : q.mode === 'syntax' ? 1 : 1;
  return 1;
}
const quizMax = (quiz) => quiz.sections.reduce((t, s) => t + sectionQuestions(s).reduce((u, q) => u + qMax(q), 0), 0);
const quizCount = (quiz) => quiz.sections.reduce((t, s) => t + sectionQuestions(s).length, 0);

/* Levenshtein distance for fuzzy matching */
function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl; if (!bl) return al;
  const prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    let cur = [i];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bl; j++) prev[j] = cur[j];
  }
  return prev[bl];
}

function textMatches(given, accepted) {
  const g = normText(given);
  if (!g) return false;
  for (const a of accepted) {
    const n = normText(a);
    if (g === n) return true;
    // fuzzy for longer words
    if (n.length >= 5 && levenshtein(g, n) <= 1) return true;
  }
  return false;
}

function grade(q, a) {
  a = a || {};
  switch (q.type) {
    case 'mcq': return { got: a.v === q.answer ? 1 : 0, max: 1 };
    case 'ident': {
      const ok = textMatches(a.v, [q.answer, ...(q.alts || [])]);
      return { got: ok ? 1 : 0, max: 1 };
    }
    case 'enum': {
      const exp = q.answers.map(normText);
      const given = (a.v || []).map(normText);
      const flags = [];
      let got = 0;
      if (q.ordered) {
        given.forEach((g, i) => { const ok = g !== '' && g === exp[i]; flags.push(ok); if (ok) got++; });
      } else {
        const pool = [...exp];
        given.forEach((g) => {
          if (!g) { flags.push(false); return; }
          let k = pool.indexOf(g);
          if (k < 0 && g.length >= 5) k = pool.findIndex((p) => levenshtein(g, p) <= 1);
          if (k > -1) { pool.splice(k, 1); got++; flags.push(true); }
          else flags.push(false);
        });
      }
      return { got, max: exp.length, flags };
    }
    case 'code': {
      if (q.mode === 'blank') {
        const exp = blanksOf(q);
        const given = a.v || [];
        const flags = exp.map((b, i) => !!String(given[i] ?? '').trim() && codeEquivalent(given[i], b, q.language));
        return { got: flags.filter(Boolean).length, max: exp.length, flags };
      }
      if (q.mode === 'bug') {
        const lineOk = a.line === q.bugLine;
        const fixOk = !!String(a.fix || '').trim() && codeEquivalent(a.fix, q.fix, q.language);
        return { got: (lineOk ? 1 : 0) + (fixOk ? 1 : 0), max: 2, lineOk, fixOk };
      }
      if (q.mode === 'syntax') {
        const ok = !!String(a.v || '').trim() && codeEquivalent(a.v, q.fix || q.code, q.language);
        return { got: ok ? 1 : 0, max: 1 };
      }
      // arrange
      const lines = arrangeLines(q);
      const order = a.v || [];
      const want = lines.map((l) => normalizeCode(l, q.language));
      const have = order.map((i) => normalizeCode(lines[i] || '', q.language));
      const flags = have.map((h, i) => h === want[i]);
      return { got: order.length === lines.length && flags.every(Boolean) ? 1 : 0, max: 1, flags };
    }
  }
  return { got: 0, max: 1 };
}

/* ==========================================================
   Shell / navigation
   ========================================================== */
function themeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return `<button class="btn icon-btn ghost" data-act="theme" aria-label="Toggle theme" title="Toggle theme">${ic(dark ? 'sun' : 'moon')}</button>`;
}
function soundBtn() {
  const on = typeof Sound !== 'undefined' && Sound.isEnabled();
  const vol = (typeof Sound !== 'undefined' && Sound.getVolume) ? Sound.getVolume() : 0.15;
  const pct = Math.round(vol * 100);
  const iconName = on ? 'volume2' : 'volumeX';
  return `
    <div class="sound-pop-wrap">
      <button class="btn icon-btn ghost" data-act="sound" aria-label="Sound settings" title="Sound settings">${ic(iconName)}</button>
      <div class="sound-pop" id="sound-pop" hidden>
        <div class="sound-pop-row">
          <span class="lbl">Sound</span>
          <label class="switch-sm">
            <input type="checkbox" id="sound-pop-toggle" ${on ? 'checked' : ''} />
            <span></span>
          </label>
        </div>
        <div class="sound-pop-row">
          <span class="lbl">Volume</span>
          <span class="sound-pop-val" id="sound-pop-val">${pct}%</span>
        </div>
        <input type="range" id="sound-pop-range" min="0" max="100" value="${pct}" step="5" aria-label="Volume" />
        <div class="sound-pop-row small">
          <span class="muted">Click a button to preview</span>
        </div>
      </div>
    </div>`;
}

const logo = `<a class="logo" href="#/"><span class="logo-mark">{!}</span>BrainError</a>`;

function shell(inner, active = '') {
  const u = DB.session();
  const userInitials = u ? (String(u.name || 'User').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U') : '';
  const links = !u ? '' : u.role === 'admin'
    ? `<a href="#/manage" class="${active === 'manage' ? 'active' : ''}">Manage quizzes</a>`
    : `<a href="#/dashboard" class="${active === 'dashboard' ? 'active' : ''}">Quizzes</a><a href="#/history" class="${active === 'history' ? 'active' : ''}">My scores</a>`;
  app.innerHTML = `
       <header class="nav"><div class="container nav-in">
      ${logo}
      <button class="btn icon-btn ghost nav-burger" data-act="nav-toggle" aria-label="Menu">☰</button>
      <nav class="nav-links" aria-label="Main">${links}</nav>
      <span class="spacer"></span>
      ${soundBtn()}
      ${themeBtn()}
      ${u ? `<div class="chip-user"><span class="avatar" aria-hidden="true">${esc(userInitials)}</span><span class="nm">${esc(u.name)}<small>${esc(u.guest ? 'Guest' : u.role)}</small></span><button class="btn icon-btn ghost" data-act="logout" aria-label="Log out" title="Log out">${ic('logout')}</button></div>` : ''}
    </div>
    <div class="mobile-menu" id="mobile-menu" hidden>${links}</div></header>
    <main class="container page">${inner}</main>`;
}

/* ==========================================================
   Landing
   ========================================================== */
function landing() {
  app.innerHTML = `
  <header class="nav"><div class="container nav-in">
    ${logo}<span class="spacer"></span>
    <a class="btn ghost hide-sm" href="#/auth?mode=login">Log in</a>
    <a class="btn primary" href="#/auth?mode=register">Create account</a>
    ${themeBtn()}
  </div></header>

  <section class="container hero">
    <div>
      <span class="eyebrow"><i></i> Reviewer minigame for students</span>
      <h1><span class="glitch" data-text="BrainError">BrainError</span><br/>Study. Break. Fix.</h1>
      <p class="lead">Turn your notes into a game. Multiple choice, identification, enumeration and real code challenges | with instant, accurate checking and answers revealed exactly when you want them.</p>
      <div class="cta">
        <a class="btn primary lg" href="#/auth?mode=register">${ic('play')} Get started</a>
        <button class="btn lg" data-act="guest">Continue as guest</button>
      </div>
      <p class="hint" style="margin-top:14px">Already have an account? <a href="#/auth?mode=login">Log in</a></p>
    </div>
    <div class="mock" aria-hidden="true">
      <div class="mock-bar"><i></i><i></i><i></i><span style="margin-left:10px">find_the_bug.js</span></div>
      <pre><span class="ln"><b>1</b><span class="kw">function</span> isEven(n) {</span><span class="ln bug"><b>2</b>  <span class="kw">return</span> n % 2 = 0;</span><span class="ln"><b>3</b>}</span><span class="ln"><b>4</b></span><span class="ln"><b>5</b><span class="cm">// tap the line with the bug</span></span></pre>
      <div class="mock-foot"><span>Part 4 of 4 · Code</span><span class="pill">1 bug found</span></div>
    </div>
  </section>

  <section class="container section" id="features">
    <h2>Everything a reviewer needs</h2>
    <p class="sub">Built around how exams actually work | especially the code part.</p>
    <div class="grid cols-3" style="margin-top:24px">
      ${[
        ['check', 'Four quiz types', 'Multiple choice, identification, enumeration and code challenges in one quiz.'],
        ['code', 'Smart code questions', 'Fill the blanks, find the bug, fix syntax or rearrange shuffled lines.'],
        ['shield', 'Fair code checking', 'Extra spaces, comments and string text are ignored. If the syntax is right, it counts.'],
        ['eye', 'Reveal on your terms', 'See answers after each part, or switch it off and review everything at the end.'],
        ['trophy', 'Scores & history', 'Per-part score breakdown after every game, plus your full history.'],
        ['download', 'Ready to host', 'Export your material to JSON, commit it to GitHub and it is there for everyone.'],
      ].map(([i, t, d]) => `<div class="card feat"><div class="ico">${ic(i)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="container section">
    <h2>How it works</h2>
    <div class="steps" style="margin-top:20px">
      <div class="card"><h3>Add your material</h3><p class="muted">Admins paste notes, import a file or upload code to build a quiz.</p></div>
      <div class="card"><h3>Play it part by part</h3><p class="muted">Answer a part, reveal the answers, then move on to the next.</p></div>
      <div class="card"><h3>Track your score</h3><p class="muted">See where you lost points and retry until it sticks.</p></div>
    </div>
  </section>

  <section class="container section" id="roles">
    <h2>Two roles, zero confusion</h2>
    <div class="roles" style="margin-top:20px">
      <div class="card"><span class="badge accent">${ic('user')} Student</span><h3 style="margin-top:12px">Start quizzes</h3><ul><li>Browse and search quizzes</li><li>Choose reveal and shuffle options</li><li>Keep a history of scores</li><li>Works as a guest, no sign-up</li></ul></div>
      <div class="card"><span class="badge warn">${ic('shield')} Admin</span><h3 style="margin-top:12px">Create quizzes</h3><ul><li>Create, edit, duplicate and delete quizzes</li><li>Import material and upload code</li><li>Export data for GitHub hosting</li><li>Preview any quiz before sharing</li></ul></div>
    </div>
  </section>

  <footer class="footer"><div class="container row"><span>BrainError | built for studying.</span><span class="spacer"></span><button class="btn sm ghost" data-act="guest">Continue as guest</button></div></footer>`;
}

/* ==========================================================
   Auth
   ========================================================== */
function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `
  <div class="auth">
    <aside class="auth-side">
      <a class="logo" href="#/"><span class="logo-mark">{!}</span>BrainError</a>
      <div style="position:relative;z-index:1"><h2>Break it.<br/>Then fix it.</h2>
        <ul><li>${ic('check')} Quizzes that check code fairly</li><li>${ic('check')} Answers revealed when you choose</li><li>${ic('check')} Scores saved on this device</li></ul></div>
      <span class="muted" style="position:relative;z-index:1;font-size:.85rem">Front-end template · data stored in your browser</span>
    </aside>
    <section class="auth-main"><div class="auth-box">
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><a class="btn sm ghost" href="#/">${ic('arrowL')} Back</a>${themeBtn()}</div>
      <h1>${reg ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted">${reg ? 'Save your scores and pick up where you left off.' : 'Log in to continue studying.'}</p>
      <div class="tabs" role="tablist"><button class="${reg ? '' : 'on'}" data-act="auth-tab" data-mode="login" role="tab">Log in</button><button class="${reg ? 'on' : ''}" data-act="auth-tab" data-mode="register" role="tab">Create account</button></div>
      <div id="auth-err"></div>
      <form data-form="${reg ? 'register' : 'login'}" novalidate>
        ${reg ? `<div class="field"><label for="f-name">Name</label><input class="input" id="f-name" name="name" autocomplete="name" placeholder="Your name" required /></div>` : ''}
        <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" autocomplete="email" placeholder="you@school.edu" required /></div>
        <div class="field"><label for="f-pass">Password</label><input class="input" id="f-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'At least 6 characters' : 'Your password'}" required /></div>
        ${reg ? `<label class="switch" style="border:0;padding:4px 0 10px"><span class="t"><b>I'm a quiz creator (admin)</b><span>Needs an access code</span></span><input type="checkbox" id="f-admin" data-act="toggle-admin" /></label>
          <div class="field hidden" id="admin-code-wrap"><label for="f-code">Admin access code</label><input class="input" id="f-code" name="adminCode" placeholder="Enter code" /></div>` : ''}
        <button class="btn primary block lg" type="submit">${reg ? 'Create account' : 'Log in'}</button>
      </form>
      <div class="divider">or</div>
      <button class="btn block" data-act="guest">${ic('user')} Continue as guest</button>
    </div></section>
  </div>`;
}

/* ==========================================================
   Student: dashboard + history
   ========================================================== */
function chipsFor(quiz) {
  return quiz.sections.filter((s) => sectionQuestions(s).length).map((s) => `<span class="badge ${s.type === 'code' ? 'accent' : ''}">${ic(TYPE[s.type].icon)} ${TYPE[s.type].short} · ${sectionQuestions(s).length}</span>`).join('');
}
function dashboard(u) {
  const quizzes = DB.quizzes().filter((q) => quizCount(q) > 0);
  const at = DB.attempts(u.id);
  const avg = at.length ? Math.round(at.reduce((t, a) => t + pct(a.got, a.max), 0) / at.length) : 0;
  const best = at.length ? Math.max(...at.map((a) => pct(a.got, a.max))) : 0;
  const subjects = [...new Set(quizzes.map((q) => q.subject).filter(Boolean))];
  shell(`
    ${u.guest ? `<div class="banner">${ic('user')} You're playing as a guest. Scores are saved on this device only. <a href="#/auth?mode=register">Create an account</a></div>` : ''}
    <div class="page-head"><div><span class="muted">Hi ${esc(u.name)}</span><h1>Pick a quiz</h1></div></div>
    <div class="grid cols-4" style="margin-bottom:26px">
      <div class="card stat"><span>Games played</span><b>${at.length}</b></div>
      <div class="card stat"><span>Average score</span><b>${avg}%</b></div>
      <div class="card stat"><span>Best score</span><b>${best}%</b></div>
      <div class="card stat"><span>Quizzes available</span><b>${quizzes.length}</b></div>
    </div>
    <div class="toolbar">
      <div class="search">${ic('search')}<input class="input" id="q-search" placeholder="Search quizzes…" aria-label="Search quizzes" /></div>
      <select class="input" id="q-subject" aria-label="Filter by subject"><option value="">All subjects</option>${subjects.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
    </div>
    <div id="quiz-grid" class="grid cols-3"></div>`, 'dashboard');
  const draw = () => {
    const t = $('#q-search').value.trim().toLowerCase(); const sub = $('#q-subject').value;
    const list = quizzes.filter((q) => (!sub || q.subject === sub) && (!t || (q.title + ' ' + q.description + ' ' + q.subject).toLowerCase().includes(t)));
    $('#quiz-grid').innerHTML = list.length ? list.map((q) => {
      const mine = at.filter((a) => a.quizId === q.id);
      const bestQ = mine.length ? Math.max(...mine.map((a) => pct(a.got, a.max))) : null;
      return `<article class="card quiz-card">
        <div class="row" style="justify-content:space-between"><span class="badge">${esc(q.subject || 'General')}</span>${bestQ !== null ? `<span class="badge ok">${ic('trophy')} Best ${bestQ}%</span>` : '<span class="badge">New</span>'}</div>
        <div><h3>${esc(q.title)}</h3><p class="desc">${esc(q.description || 'No description.')}</p></div>
        <div class="chips">${chipsFor(q)}</div>
        <div class="foot"><span class="muted" style="font-size:.85rem">${quizCount(q)} questions · ${quizMax(q)} pts</span><button class="btn primary sm" data-act="start-open" data-id="${esc(q.id)}">${ic('play')} Start</button></div>
      </article>`;
    }).join('') : `<div class="empty" style="grid-column:1/-1"><div class="big">🧠</div><h3>No quizzes found</h3><p>${quizzes.length ? 'Try a different search.' : 'An admin has not published any quizzes yet.'}</p></div>`;
  };
  $('#q-search').addEventListener('input', draw); $('#q-subject').addEventListener('change', draw); draw();
}

function historyView(u) {
  const at = DB.attempts(u.id);
  
  const clearBtn = at.length
    ? `<button class="btn danger" data-act="clear-history">${ic('trash')} Clear history</button>`
    : '';
  
  const content = at.length
    ? `
      <div class="card table-wrap" style="padding:8px">
        <table class="table">
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Date</th>
              <th>Score</th>
              <th>Breakdown</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${at.map((a) => `
              <tr>
                <td><b>${esc(a.quizTitle)}</b></td>
                <td class="muted">${fmtDate(a.at)}</td>
                <td>
                  <span class="badge ${pct(a.got, a.max) >= 75 ? 'ok' : pct(a.got, a.max) >= 50 ? 'warn' : 'bad'}">
                    ${pct(a.got, a.max)}%
                  </span>
                  <span class="mono muted">${a.got}/${a.max}</span>
                </td>
                <td>
                  <div class="chips">
                    ${a.sections.map((s) => `
                      <span class="badge">
                        ${esc(TYPE[s.type]?.short || s.type)} ${s.got}/${s.max}
                      </span>
                    `).join('')}
                  </div>
                </td>
                <td class="actions">
                  ${DB.quiz(a.quizId) 
                    ? `<button class="btn sm" data-act="start-open" data-id="${esc(a.quizId)}">${ic('refresh')} Retry</button>` 
                    : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    : `
      <div class="empty">
        <div class="big">📈</div>
        <h3>No games yet</h3>
        <p>Finish a quiz and your score shows up here.</p>
        <a class="btn primary" href="#/dashboard">Browse quizzes</a>
      </div>
    `;
  
  shell(`
    <div class="page-head">
      <h1>My scores</h1>
      ${clearBtn}
    </div>
    ${content}
  `, 'history');
}

/* ==========================================================
   Play
   ========================================================== */
function startModal(id, preview = false) {
  const quiz = DB.quiz(id); if (!quiz) return toast('Quiz not found.', 'err');
  const st = quiz.settings || {};
  const timers = st.timers || { mcq: 10, ident: 5, enum: 20, code: 60 };
  const sections = quiz.sections.map((section, index) => ({ section, index })).filter(({ section }) => sectionQuestions(section).length);
  if (!sections.length) return toast('This quiz has no questions to play.', 'err');
  openModal({
    title: `${preview ? 'Preview: ' : 'Start: '}${quiz.title}`,
    body: `<p class="muted">${quizCount(quiz)} questions · ${quizMax(quiz)} points · ${sections.length} parts</p>
      <div class="field section-picker-field">
        <div class="row section-picker-head"><span class="lbl">Parts to include</span><span class="row"><button class="btn sm ghost" type="button" data-act="select-all-sections">All</button><button class="btn sm ghost" type="button" data-act="clear-sections">None</button></span></div>
        <div class="section-picker">${sections.map(({ section, index }) => `<label class="section-option">
          <input type="checkbox" data-section-option data-section-index="${index}" checked />
          <span class="section-option-info"><b>${ic(TYPE[section.type].icon)} ${esc(section.title || TYPE[section.type].label)}</b><span>${TYPE[section.type].short} · ${section.questions.length} question${section.questions.length === 1 ? '' : 's'}</span></span>
        </label>`).join('')}</div>
        <span class="hint">Choose the parts for this attempt. Your quiz stays unchanged.</span>
      </div>
      <label class="switch"><span class="t"><b>Reveal answers after each part</b><span>Off = all answers are shown at the very end</span></span><input type="checkbox" id="o-reveal" ${st.reveal !== false ? 'checked' : ''} /></label>
      <label class="switch"><span class="t"><b>Shuffle questions</b><span>Mix the order inside each part</span></span><input type="checkbox" id="o-shq" ${st.shuffleQuestions ? 'checked' : ''} /></label>
      <label class="switch"><span class="t"><b>Shuffle choices</b><span>Randomise multiple choice options</span></span><input type="checkbox" id="o-shc" ${st.shuffleChoices ? 'checked' : ''} /></label>
      <label class="switch"><span class="t"><b>Enable per-question timer</b><span>Each question has its own countdown</span></span><input type="checkbox" id="o-timer" ${st.timerEnabled ? 'checked' : ''} /></label>
      <div id="timer-config" class="${st.timerEnabled ? '' : 'hidden'}" style="padding-left:8px;margin-top:8px">
        <div class="grid-2">
          <div class="field"><label>Multiple choice (sec/q)</label><input class="input sm" type="number" min="3" id="t-mcq" value="${timers.mcq}" /></div>
          <div class="field"><label>Identification (sec/q)</label><input class="input sm" type="number" min="3" id="t-ident" value="${timers.ident}" /></div>
          <div class="field"><label>Enumeration (sec/q)</label><input class="input sm" type="number" min="5" id="t-enum" value="${timers.enum}" /></div>
          <div class="field"><label>Code (sec/q)</label><input class="input sm" type="number" min="10" id="t-code" value="${timers.code}" /></div>
        </div>
      </div>
      ${preview ? '<p class="hint" style="margin-top:12px">Preview games are not saved to history.</p>' : ''}`,
    actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: `${ic('play')} ${preview ? 'Preview' : 'Start game'}`, cls: 'primary',
      onClick: () => {
        const sectionIndexes = $$('[data-section-option]:checked', $('#modal-root')).map((input) => Number(input.dataset.sectionIndex));
        if (!sectionIndexes.length) {
          toast('Choose at least one part to start.', 'err');
          return false;
        }
        const useTimer = $('#o-timer').checked;
        const timers = {
          mcq: +$('#t-mcq').value || 10,
          ident: +$('#t-ident').value || 5,
          enum: +$('#t-enum').value || 20,
          code: +$('#t-code').value || 60,
        };
        S.play = newPlay(quiz, {
          sectionIndexes,
          reveal: $('#o-reveal').checked,
          shuffleQ: $('#o-shq').checked,
          shuffleC: $('#o-shc').checked,
          timers: useTimer,
          preview,
        });
        S.play.timers = timers;
        S.play.timerOn = useTimer;
        S.play.shuffleQuestions = $('#o-shq').checked;
        S.play.shuffleChoices = $('#o-shc').checked;
        if (!preview) DB.clearPlayProgress(DB.session().id, id);
        go('/play/' + id);
      },
    }],
  });
  // wire the toggle to show/hide timer config
  setTimeout(() => {
    const tgl = $('#o-timer');
    if (tgl) tgl.addEventListener('change', () => {
      $('#timer-config').classList.toggle('hidden', !tgl.checked);
    });
  }, 0);
}
function newPlay(quiz, o) {
  const q = clone(quiz);
  const selectedSections = new Set(o.sectionIndexes);
  q.sections = q.sections.filter((s, index) => selectedSections.has(index) && sectionQuestions(s).length);
  q.sections.forEach((s) => {
    if (o.shuffleQ) shuffle(s.questions);
    if (o.shuffleC) s.questions.forEach((x) => {
      if (x.type !== 'mcq') return;
      const items = shuffle(x.choices.map((t, i) => ({ t, c: i === x.answer })));
      x.choices = items.map((i) => i.t); x.answer = items.findIndex((i) => i.c);
    });
  });
  // per-question index within each section
  const qIdx = {};
  q.sections.forEach((s) => (qIdx[s.id] = 0));
  // timer config
  const timers = (q.settings && q.settings.timers) || { mcq: 10, ident: 5, enum: 20, code: 60 };
  const timerOn = !!o.timers;
  return {
    quiz: q,
    idx: 0,               // current section index
    qIdx,                 // current question index per section
    phase: 'answer',
    reveal: !!o.reveal,
    preview: !!o.preview,
    timerOn,
    timers,
    shuffleQuestions: !!o.shuffleQ,
    shuffleChoices: !!o.shuffleC,
    timeLeft: null,       // seconds remaining
    timerHandle: null,    // setInterval handle
    answers: {},
    graded: {},
    shuffles: {},
    revealed: {},
  };
}
function resumeSavedPlay(id) {
  const user = DB.session();
  if (!user) return false;
  const saved = DB.loadPlayProgress(user.id, id);
  if (!saved || !saved.quiz || saved.quiz.id !== id || !Array.isArray(saved.quiz.sections) ||
      !Number.isInteger(saved.idx) || saved.idx < 0 || saved.idx >= saved.quiz.sections.length ||
      !['answer', 'reveal'].includes(saved.phase)) return false;
  const play = clone(saved);
  play.timerHandle = null;
  play.timerOn = !!play.timerOn;
  play.shuffleQuestions = !!play.shuffleQuestions;
  play.shuffleChoices = !!play.shuffleChoices;
  play.answers = play.answers || {};
  play.graded = play.graded || {};
  play.qIdx = play.qIdx || {};
  play.shuffles = play.shuffles || {};
  play.revealed = play.revealed || {};
  const sec = play.quiz.sections[play.idx];
  if (!sec || !Array.isArray(sec.questions) || !sec.questions.length) return false;
  if (!Number.isInteger(play.qIdx[sec.id]) || play.qIdx[sec.id] < 0 || play.qIdx[sec.id] >= sec.questions.length) {
    play.qIdx[sec.id] = 0;
  }
  S.play = play;
  return true;
}

/* ---------- timer helpers ---------- */
function clearPlayTimer(play = S.play) {
  if (play && play.timerHandle !== null) {
    clearInterval(play.timerHandle);
    play.timerHandle = null;
  }
}
function isActivePlayRoute(play = S.play) {
  const match = location.hash.slice(1).match(/^\/play\/(.+)$/);
  return !!play && play.phase !== 'done' && !!match && decodeURIComponent(match[1]) === play.quiz.id;
}
function startQuestionTimer(reset = false) {
  const P = S.play;
  if (!P || !P.timerOn || P.phase !== 'answer' || !isActivePlayRoute(P)) return;
  if (P.timerHandle !== null) return;
  clearPlayTimer(P);
  const sec = P.quiz.sections[P.idx];
  const seconds = P.timers[sec.type] || 10;
  if (reset || P.timeLeft === null || P.timeLeft <= 0) P.timeLeft = seconds;
  paintTimer();
  P.timerHandle = setInterval(() => {
    if (S.play !== P || !P.timerOn || P.phase !== 'answer' || !isActivePlayRoute(P)) {
      clearPlayTimer(P);
      return;
    }
    P.timeLeft--;
    // Tick sound in the last 5 seconds
    if (P.timeLeft > 0 && P.timeLeft <= 5 && typeof Sound !== 'undefined') Sound.play('tick');
    if (P.timeLeft <= 0) {
      clearPlayTimer();
      if (typeof Sound !== 'undefined') Sound.play('timeup');
      // auto-advance this question
      const secNow = P.quiz.sections[P.idx];
      const last = P.qIdx[secNow.id] >= secNow.questions.length - 1;
      if (last) {
        // time to end the section
        if (P.reveal) {
          collectSection(secNow);
          P.phase = 'reveal'; P.revealed[secNow.id] = true; P.timeLeft = null;
          playView(P.quiz.id); window.scrollTo(0, 0);
        } else {
          collectSection(secNow);
          advance();
        }
      } else {
        collectCurrentQuestion(secNow);
        P.qIdx[secNow.id]++;
        P.timeLeft = null;
        playView(P.quiz.id);
      }
    } else {
      paintTimer();
      persistPlayProgress(P);
    }
  }, 1000);
}
function persistPlayProgress(play = S.play) {
  if (!play || play.preview || play.phase === 'done') return;
  const user = DB.session();
  if (!user) return;
  if (play.phase === 'answer' && S.play === play) {
    const sec = play.quiz.sections[play.idx];
    if (sec && sec.questions[play.qIdx[sec.id]]) collectCurrentQuestion(sec);
  }
  const state = {
    quiz: play.quiz,
    idx: play.idx,
    qIdx: play.qIdx,
    phase: play.phase,
    reveal: play.reveal,
    preview: play.preview,
    timerOn: play.timerOn,
    timers: play.timers,
    shuffleQuestions: play.shuffleQuestions,
    shuffleChoices: play.shuffleChoices,
    timeLeft: play.timeLeft,
    answers: play.answers,
    graded: play.graded,
    shuffles: play.shuffles,
    revealed: play.revealed,
  };
  try {
    DB.savePlayProgress(user.id, play.quiz.id, state, PLAY_PROGRESS_TTL);
  } catch (error) {
    if (!play._storageErrorShown) {
      play._storageErrorShown = true;
      toast(error.message, 'err');
    }
  }
}
function paintTimer() {
  const el = document.getElementById('timer-display');
  if (!el || !S.play) return;
  el.innerHTML = `<span class="badge ${S.play.timeLeft <= 5 ? 'bad' : 'accent'}">${ic('history')} ${S.play.timeLeft}s</span>`;
}
function collectCurrentQuestion(sec) {
  const P = S.play;
  const q = sec.questions[P.qIdx[sec.id]];
  if (!q) return;
  const id = CSS.escape(q.id); const root = $('#part');
  let a = {};
  if (q.type === 'mcq') { const c = $(`input[name="q_${id}"]:checked`, root); if (c) a.v = +c.value; else a.v = P.answers[q.id]?.v; }
  else if (q.type === 'ident') a.v = ($(`input[data-qid="${id}"]`, root) || {}).value || P.answers[q.id]?.v || '';
  else if (q.type === 'enum') a.v = $$(`input[data-qid="${id}"]`, root).map((i) => i.value);
  else if (q.mode === 'blank') a.v = $$(`input[data-qid="${id}"]`, root).map((i) => i.value);
  else if (q.mode === 'bug') { const s = $(`[data-bug="${id}"] .code-line.sel`, root); a.line = s ? +s.dataset.line : (P.answers[q.id]?.line ?? null); a.fix = ($(`input[data-fix="${id}"]`, root) || {}).value || P.answers[q.id]?.fix || ''; }
  else if (q.mode === 'syntax') a.v = ($(`textarea[data-qid="${id}"]`, root) || {}).value || P.answers[q.id]?.v || '';
  else {
    a.v = $$(`[data-arr="${id}"] .arr-item`, root).map((e) => +e.dataset.i);
    P.shuffles[q.id] = a.v;
  }
  P.answers[q.id] = a;
}
function goToQuestion(delta) {
  const P = S.play;
  const sec = P.quiz.sections[P.idx];
  collectCurrentQuestion(sec);
  const next = P.qIdx[sec.id] + delta;
  if (next < 0) return;
  if (next >= sec.questions.length) return;
  P.qIdx[sec.id] = next;
  playView(P.quiz.id);
  startQuestionTimer();
}

/* ---------- play view (one question at a time) ---------- */
function playView(id) {
  const P = S.play;
  if (!P || P.quiz.id !== id) return go(DB.session().role === 'admin' ? '/manage' : '/dashboard');
  if (P.phase === 'done') return resultsView();
  const sec = P.quiz.sections[P.idx];
  const total = P.quiz.sections.length;
  const totalQ = sec.questions.length;
  const curIdx = P.qIdx[sec.id] || 0;
  const curQ = sec.questions[curIdx];
  const progress = Math.round((P.idx / total) * 100);
  const stepper = P.quiz.sections.map((s, i) => `<span class="step ${i < P.idx || (i === P.idx && P.phase === 'reveal') ? 'done' : i === P.idx ? 'cur' : ''}">${ic(TYPE[s.type].icon)} ${esc(s.title || TYPE[s.type].label)}</span>`).join('');
  const isLastSection = P.idx === total - 1;
  const isLastQuestion = curIdx === totalQ - 1;
  const timerBadge = (P.timerOn && P.phase === 'answer') ? `<span id="timer-display"></span>` : '';

   let body;
  if (P.phase === 'answer') {
    // Only the current question
    body = `<div class="q-progress muted">Question <b>${curIdx + 1}</b> of <b>${totalQ}</b> in this part</div>`
         + questionHTML(curQ, curIdx + 1);
  } else {
    // Play a section reveal sound (only once per section)
    if (typeof Sound !== 'undefined' && P._lastRevealSound !== sec.id) {
      P._lastRevealSound = sec.id;
      const ratio = P.graded[sec.id].max > 0 ? P.graded[sec.id].got / P.graded[sec.id].max : 0;
      if (ratio === 1) Sound.play('success');
      else if (ratio === 0) Sound.play('error');
      else Sound.play('click');
    }
    // Reveal phase: show all questions with reveals
    body = `<div class="card flat" style="margin-bottom:16px"><b>${esc(sec.title)}</b> | you scored <b>${P.graded[sec.id].got}/${P.graded[sec.id].max}</b> in this part.</div>`
         + sec.questions.map((q, i) => revealHTML(q, P.answers[q.id], P.graded[q.id], i + 1)).join('');
  }
  let footer;
  if (P.phase === 'answer') {
    footer = `
      <button class="btn lg" data-act="q-prev" ${curIdx === 0 ? 'disabled' : ''}>${ic('arrowL')} Previous</button>
      <span class="spacer"></span>
      ${!isLastQuestion
        ? `<button class="btn primary lg" data-act="q-next">Next question ${ic('play')}</button>`
        : `<button class="btn primary lg" data-act="submit-part">${P.reveal ? ic('eye') + ' Reveal this part' : isLastSection ? ic('check') + ' Submit & finish' : 'Submit & next part'}</button>`}
    `;
  } else {
    footer = `
      <span class="muted">Answers revealed</span>
      <span class="spacer"></span>
      <button class="btn primary lg" data-act="next-part">${isLastSection ? ic('trophy') + ' See final score' : 'Next part ' + ic('play')}</button>
    `;
  }

  shell(`
    <div class="play-head"><div><span class="muted">${P.preview ? 'Preview · ' : ''}${esc(P.quiz.subject || 'Quiz')}</span><h1>${esc(P.quiz.title)}</h1></div>
      <div class="row">${timerBadge}
      <label class="pill-toggle" title="Show answers after each part"><input type="checkbox" id="reveal-toggle" ${P.reveal ? 'checked' : ''} /> Reveal after each part</label>
      <label class="pill-toggle" title="Enable per-question timer"><input type="checkbox" id="timer-toggle" ${P.timerOn ? 'checked' : ''} /> Timer</label>
      ${!P.preview ? `<button class="btn sm" data-act="restart-play">${ic('refresh')} Start again</button>` : ''}
      <button class="btn sm ghost danger" data-act="quit">${ic('x')} Quit</button></div></div>
    <div class="stepper">${stepper}</div>
    <div class="bar"><i style="width:${progress}%"></i></div>
    <div id="part" data-sec="${esc(sec.id)}" data-q="${esc(curQ.id)}">${body}</div>
    <div class="play-foot">${footer}</div>`, 'play');

  if (P.phase === 'answer' && P.timerOn) startQuestionTimer();
  else clearPlayTimer();
  persistPlayProgress(P);
}

/* ----- question inputs ----- */
function questionHTML(q, n) {
  const head = `<div class="q-no">${TYPE[q.type].short} · Q${n}</div>`;
  const answer = S.play.answers[q.id] || {};
  let body = '';
  if (q.type === 'mcq') {
    body = `<div class="q-text">${esc(q.q)}</div><div class="choices">${q.choices.map((c, i) => `<label class="choice"><input type="radio" name="q_${esc(q.id)}" value="${i}" ${answer.v === i ? 'checked' : ''} /><span class="key">${String.fromCharCode(65 + i)}</span><span>${esc(c)}</span></label>`).join('')}</div>`;
  } else if (q.type === 'ident') {
    body = `<div class="q-text">${esc(q.q)}</div><input class="input" data-qid="${esc(q.id)}" value="${esc(answer.v || '')}" placeholder="Type your answer" autocomplete="off" />`;
  } else if (q.type === 'enum') {
    body = `<div class="q-text">${esc(q.q)}</div><p class="hint">${q.answers.length} answers · ${q.ordered ? 'in order' : 'any order'}</p><div class="enum-list">${q.answers.map((_, i) => `<div class="r"><span class="n">${i + 1}.</span><input class="input sm" data-qid="${esc(q.id)}" data-i="${i}" value="${esc(answer.v?.[i] || '')}" autocomplete="off" /></div>`).join('')}</div>`;
  } else {
    body = `<div class="q-text">${esc(q.title || 'Code challenge')}</div><p class="muted" style="margin-top:-6px">${esc(q.prompt || '')} <span class="badge">${esc(q.language)}</span></p>`;
    if (q.mode === 'blank') body += `<div class="code-block">${codeBlankHTML(q, null, answer)}</div>`;
    else if (q.mode === 'bug') body += bugHTML(q, null, answer) + `<div class="field"><label>Corrected line</label><input class="input mono" data-fix="${esc(q.id)}" value="${esc(answer.fix || '')}" placeholder="Type the fixed line" autocomplete="off" /></div>`;
    else if (q.mode === 'syntax') body += `<div class="code-block">${String(q.code).split('\n').map((l, i) => `<div class="code-line"><span class="no">${i + 1}</span><span class="tx">${esc(l) || ' '}</span></div>`).join('')}</div><div class="field"><label>Corrected code</label><textarea class="input code-input" data-qid="${esc(q.id)}" data-kind="syntax" spellcheck="false" placeholder="Paste the corrected code…">${esc(answer.v || '')}</textarea></div>`;
    else body += arrangeHTML(q, null);
  }
  return `<article class="card q-card" data-q="${esc(q.id)}">${head}${body}</article>`;
}
function codeBlankHTML(q, g, a) {
  let bi = 0;
  return String(q.code).split('\n').map((line, li) => {
    let html = ''; let last = 0; let m; const re = /\[\[(.+?)\]\]/g;
    while ((m = re.exec(line))) {
      html += esc(line.slice(last, m.index)); last = m.index + m[0].length;
      const i = bi++;
      if (!g) html += `<input class="blank" data-qid="${esc(q.id)}" data-b="${i}" value="${esc(a && a.v && a.v[i] || '')}" style="width:${Math.max(6, m[1].length + 3)}ch" spellcheck="false" autocomplete="off" aria-label="Blank ${i + 1}" />`;
      else { const ok = g.flags[i]; const given = (a && a.v && a.v[i]) || ''; html += `<span class="blank ${ok ? 'ok' : 'no'}">${esc(given || '|')}</span>${ok ? '' : `<span class="ans-chip">${esc(m[1])}</span>`}`; }
    }
    html += esc(line.slice(last));
    return `<div class="code-line"><span class="no">${li + 1}</span><span class="tx">${html || ' '}</span></div>`;
  }).join('');
}
function bugHTML(q, g, a) {
  const lines = String(q.code).split('\n');
  return `<div class="code-block" data-bug="${esc(q.id)}">${lines.map((l, i) => {
    const n = i + 1; let cls = '';
    if (!g) cls = l.trim() ? `pick ${a && a.line === n ? 'sel' : ''}` : '';
    else if (n === q.bugLine) cls = 'ok-line'; else if (a && a.line === n) cls = 'bad-line';
    return `<div class="code-line ${cls}" ${!g && l.trim() ? `data-line="${n}"` : ''}><span class="no">${n}</span><span class="tx">${esc(l) || ' '}</span></div>`;
  }).join('')}</div>${g ? '' : '<p class="hint" style="margin-top:-6px">Click the line that contains the bug.</p>'}`;
}
function arrangeHTML(q, g, a) {
  const lines = arrangeLines(q); const P = S.play;
  if (!g) {
    if (!P.shuffles[q.id]) {
      const idx = lines.map((_, i) => i); const want = lines.map((l) => normalizeCode(l, q.language));
      let tries = 0; do { shuffle(idx); tries++; } while (lines.length > 1 && tries < 20 && idx.every((v, i) => normalizeCode(lines[v], q.language) === want[i]));
      P.shuffles[q.id] = idx;
    }
    return `<p class="hint">Drag the lines, or use the arrows, to put them in order.</p><div class="arr" data-arr="${esc(q.id)}">${P.shuffles[q.id].map((i) => `<div class="arr-item" draggable="true" data-i="${i}"><span class="grip">${ic('grip')}</span><span class="tx">${esc(lines[i].trim())}</span><span class="mv"><button type="button" data-act="arr-up" aria-label="Move up">${ic('up')}</button><button type="button" data-act="arr-down" aria-label="Move down">${ic('down')}</button></span></div>`).join('')}</div>`;
  }
  const want = lines.map((l) => normalizeCode(l, q.language));
  return `<p class="hint">Your order</p><div class="arr">${((a && a.v) || []).map((i, k) => `<div class="arr-item ${normalizeCode(lines[i], q.language) === want[k] ? 'ok' : 'no'}"><span class="grip">${k + 1}</span><span class="tx">${esc(lines[i].trim())}</span></div>`).join('')}</div>
    <div class="answer-box"><b>Correct order</b><div class="v">${lines.map((l) => esc(l)).join('\n')}</div></div>`;
}

/* ----- reveal ----- */
function verdictHTML(g) {
  const r = g.max ? g.got / g.max : 0;
  const cls = r === 1 ? 'ok' : r === 0 ? 'bad' : 'warn';
  return `<div class="verdict"><span class="badge ${cls}">${ic(r === 1 ? 'check' : r === 0 ? 'x' : 'minus')} ${r === 1 ? 'Correct' : r === 0 ? 'Wrong' : 'Partial'}</span><span class="muted mono">${g.got}/${g.max} pt${g.max > 1 ? 's' : ''}</span></div>`;
}
function revealHTML(q, a, g, n) {
  a = a || {}; g = g || grade(q, a);
  let body = '';
  
  if (q.type === 'mcq') {
    body = `<div class="q-text">${esc(q.q)}</div><div class="choices">${q.choices.map((c, i) => `<div class="choice static ${i === q.answer ? 'ok' : a.v === i ? 'no' : ''}"><span class="key">${String.fromCharCode(65 + i)}</span><span>${esc(c)}</span></div>`).join('')}</div>${a.v === undefined ? '<p class="hint" style="margin-top:10px">No answer given.</p>' : ''}`;
  } else if (q.type === 'ident') {
    body = `<div class="q-text">${esc(q.q)}</div><div class="answer-box"><b>Your answer</b><div class="v">${esc(a.v || '|')}</div></div><div class="answer-box"><b>Correct answer</b><div class="v">${esc([q.answer, ...(q.alts || [])].join('  ·  '))}</div></div>`;
  } else if (q.type === 'enum') {
    const given = a.v || [];
    body = `<div class="q-text">${esc(q.q)}</div><div class="enum-list">${q.answers.map((_, i) => `<div class="r"><span class="n">${i + 1}.</span><input class="input sm ${g.flags && g.flags[i] ? 'ok' : 'no'}" value="${esc(given[i] || '')}" readonly /></div>`).join('')}</div><div class="answer-box"><b>Correct answers${q.ordered ? ' (in order)' : ''}</b><div class="v">${esc(q.answers.join(', '))}</div></div>`;
  } else {
    body = `<div class="q-text">${esc(q.title || 'Code challenge')}</div>`;
    if (q.mode === 'blank') body += `<div class="code-block">${codeBlankHTML(q, g, a)}</div>`;
    else if (q.mode === 'bug') body += bugHTML(q, g, a) + `<div class="answer-box"><b>Your fix</b><div class="v">${esc(a.fix || '|')}</div></div><div class="answer-box"><b>Correct fix (line ${q.bugLine})</b><div class="v">${esc(q.fix)}</div></div>`;
    else if (q.mode === 'syntax') body += `<div class="code-block">${String(q.code).split('\n').map((l, i) => `<div class="code-line"><span class="no">${i + 1}</span><span class="tx">${esc(l) || ' '}</span></div>`).join('')}</div><div class="answer-box"><b>Your corrected code</b><div class="v">${esc(a.v || '|')}</div></div><div class="answer-box"><b>Reference fix</b><div class="v">${esc(q.fix || q.code)}</div></div>`;
    else body += arrangeHTML(q, g, a);
  }
  return `<article class="card q-card"><div class="q-no">${TYPE[q.type].short} · Q${n}</div>${verdictHTML(g)}${body}${q.explain ? `<div class="explain">${esc(q.explain)}</div>` : ''}</article>`;
}

/* ----- collect answers ----- */
function collectSection(sec) {
  const P = S.play;
  // grab the current (visible) question first
  collectCurrentQuestion(sec);
  // grade everything
  sec.questions.forEach((q) => {
    const a = P.answers[q.id] || {};
    P.answers[q.id] = a;
    P.graded[q.id] = grade(q, a);
  });
  const got = sec.questions.reduce((t, q) => t + P.graded[q.id].got, 0);
  const max = sec.questions.reduce((t, q) => t + P.graded[q.id].max, 0);
  P.graded[sec.id] = { got, max };
}
function advance() {
  const P = S.play;
  clearPlayTimer();
  if (P.idx >= P.quiz.sections.length - 1) return finishGame();
  P.idx++;
  P.phase = 'answer';
  P.timeLeft = null;
  // reset the question index for the new section
  const nextSec = P.quiz.sections[P.idx];
  P.qIdx[nextSec.id] = 0;
  playView(P.quiz.id);
  window.scrollTo(0, 0);
}
function finishGame() {
  const P = S.play; const u = DB.session();
  clearPlayTimer();
  if (typeof Sound !== 'undefined') Sound.play('complete');
  const sections = P.quiz.sections.map((s) => ({ title: s.title, type: s.type, ...P.graded[s.id] }));
  P.total = { got: sections.reduce((t, s) => t + s.got, 0), max: sections.reduce((t, s) => t + s.max, 0) };
  P.phase = 'done';
  if (!P.preview) DB.clearPlayProgress(u.id, P.quiz.id);
  if (!P.preview) DB.addAttempt({ userId: u.id, quizId: P.quiz.id, quizTitle: P.quiz.title, got: P.total.got, max: P.total.max, sections });
  resultsView(); window.scrollTo(0, 0);
}
function resultsView() {
  const P = S.play; const p = pct(P.total.got, P.total.max);
  const msg = p === 100 ? 'Flawless. Zero errors.' : p >= 75 ? 'Strong run | nearly there.' : p >= 50 ? 'Decent. Review the misses below.' : 'Time to debug your brain. Check the answers below.';
  shell(`
    <div class="page-head"><div><span class="muted">${P.preview ? 'Preview · not saved' : 'Game complete'}</span><h1>${esc(P.quiz.title)}</h1></div></div>
    <div class="card result-hero"><div class="ring" style="--p:${p}"><div><div><b>${p}%</b><span>${P.total.got}/${P.total.max} pts</span></div></div></div>
      <div><h2 style="margin-bottom:6px">${msg}</h2>
        ${P.quiz.sections.map((s) => { const g = P.graded[s.id]; return `<div class="sec-row"><span>${ic(TYPE[s.type].icon)} ${esc(s.title)}</span><div class="bar"><i style="width:${pct(g.got, g.max)}%"></i></div><span class="sc">${g.got}/${g.max}</span></div>`; }).join('')}
        <div class="row" style="margin-top:18px"><button class="btn primary" data-act="retry">${ic('refresh')} Play again</button><button class="btn" data-act="quit">${ic('arrowL')} Back to ${DB.session().role === 'admin' ? 'manager' : 'quizzes'}</button><button class="btn" data-act="print-results">${ic('printer')} Print</button></div></div></div>
    <h2 style="margin:28px 0 14px">Answer review</h2>
    ${P.quiz.sections.map((s, i) => `<details class="rev" ${i === 0 ? 'open' : ''}><summary>${ic(TYPE[s.type].icon)} ${esc(s.title)}<span class="sc">${P.graded[s.id].got}/${P.graded[s.id].max}</span></summary><div class="body">${s.questions.map((q, k) => revealHTML(q, P.answers[q.id], P.graded[q.id], k + 1)).join('')}</div></details>`).join('')}`, 'play');
}

/* ==========================================================
   Admin: manager
   ========================================================== */
function manageView() {
  const list = DB.quizzes();
  shell(`
    <div class="page-head"><div><span class="badge warn">${ic('shield')} Admin</span><h1 style="margin-top:8px">Manage quizzes</h1></div>
      <div class="row"><button class="btn" data-act="change-admin-code">${ic('key')} Admin code</button><button class="btn primary lg" data-act="new-quiz">${ic('plus')} Create quiz</button></div></div>
    <div class="grid cols-4" style="margin-bottom:22px">
      <div class="card stat"><span>Quizzes</span><b>${list.length}</b></div>
      <div class="card stat"><span>Total questions</span><b>${list.reduce((t, q) => t + quizCount(q), 0)}</b></div>
      <div class="card stat"><span>Code challenges</span><b>${list.reduce((t, q) => t + q.sections.filter((s) => s.type === 'code').reduce((u, s) => u + s.questions.length, 0), 0)}</b></div>
    </div>
    <div class="card flat" style="margin-bottom:22px"><div class="row"><div><b>Data &amp; GitHub hosting</b><div class="hint">Quizzes live in this browser. Export them, save as <span class="mono">data/quizzes.json</span> in your repo and push | new visitors start with that data.</div></div><span class="spacer"></span>
      <button class="btn sm" data-act="export">${ic('download')} Export all</button>
      <label class="btn sm upload-btn">${ic('upload')} Import JSON<input type="file" accept=".json,application/json" data-import /></label>
      <button class="btn sm" data-act="repo-load">${ic('refresh')} Load repo file</button></div></div>
    ${list.length ? `<div class="card table-wrap" style="padding:8px"><table class="table"><thead><tr><th>Quiz</th><th>Parts</th><th>Questions</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map((q) => `<tr><td><b>${esc(q.title)}</b><div class="muted" style="font-size:.85rem">${esc(q.subject || 'General')}</div></td><td><div class="chips">${chipsFor(q) || '<span class="muted">Empty</span>'}</div></td><td>${quizCount(q)}</td><td class="muted">${fmtDate(q.updatedAt || q.createdAt)}</td>
        <td><div class="actions"><button class="btn sm" data-act="preview" data-id="${esc(q.id)}" title="Preview">${ic('play')}</button><a class="btn sm" href="#/manage/edit/${esc(q.id)}" title="Edit">${ic('edit')}</a><button class="btn sm" data-act="dup" data-id="${esc(q.id)}" title="Duplicate">${ic('copy')}</button><button class="btn sm danger" data-act="del" data-id="${esc(q.id)}" title="Delete">${ic('trash')}</button></div></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty"><div class="big">🧩</div><h3>No quizzes yet</h3><p>Create your first quiz or import a JSON file.</p><button class="btn primary" data-act="new-quiz">${ic('plus')} Create quiz</button></div>`}`, 'manage');
}

/* ==========================================================
   Admin: editor
   ========================================================== */
const newQ = (type) => {
  const id = DB.uid('q');
  if (type === 'mcq') return { id, type, q: '', choices: ['', '', '', ''], answer: 0, explain: '' };
  if (type === 'ident') return { id, type, q: '', answer: '', alts: [], explain: '' };
  if (type === 'enum') return { id, type, q: '', answers: ['', ''], ordered: false, explain: '' };
  return { id, type: 'code', mode: 'blank', language: 'javascript', title: '', prompt: '', code: '', bugLine: null, fix: '', explain: '' };
};
const newSection = (type) => ({ id: DB.uid('s'), type, title: TYPE[type].label, questions: [newQ(type)] });
const blankQuiz = () => ({
  id: DB.uid('quiz'),
  title: '',
  subject: '',
  description: '',
  settings: {
    reveal: true,
    shuffleQuestions: false,
    shuffleChoices: true,
    timerEnabled: false,
    timers: { mcq: 10, ident: 5, enum: 20, code: 60 },
  },
  sections: [],
  createdBy: DB.session().id,
});
function editorView(id) {
  const existing = id === 'new' ? null : DB.quiz(id);
  if (id !== 'new' && !existing) { toast('Quiz not found.', 'err'); return go('/manage'); }
  S.ed = existing ? clone(existing) : blankQuiz(); S.ed._isNew = !existing; S.dirty = false;
  shell(`
    <div class="ed-bar"><div class="row"><a class="btn sm ghost" data-act="ed-cancel" href="#/manage">${ic('arrowL')} Back</a><h1 style="font-size:1.5rem;margin:0">${existing ? 'Edit quiz' : 'New quiz'}</h1></div>
      <div class="row"><button class="btn" data-act="import-material">${ic('file')} Import material</button><button class="btn primary" data-act="ed-save">${ic('check')} Save quiz</button></div></div>
    <div id="ed-body"></div>`, 'manage');
  renderEd();
}
function renderEd() {
  const Q = S.ed;
  const y = window.scrollY;
  $('#ed-body').innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <h3>Quiz details</h3>
      <div class="field">
        <label for="e-title">Title</label>
        <input class="input" id="e-title" data-bind="title" value="${esc(Q.title)}" placeholder="e.g. Networking Midterm Reviewer" />
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="e-sub">Subject</label>
          <input class="input" id="e-sub" data-bind="subject" value="${esc(Q.subject)}" placeholder="e.g. Programming" />
        </div>
        <div class="field">
          <label for="e-desc">Description</label>
          <input class="input" id="e-desc" data-bind="description" value="${esc(Q.description)}" placeholder="What does this cover?" />
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <h3>Default game settings</h3>
      <p class="hint">Students can still change these before they start.</p>
      <label class="switch">
        <span class="t"><b>Reveal answers after each part</b><span>Off = answers only appear at the end</span></span>
        <input type="checkbox" data-bind="settings.reveal" ${Q.settings.reveal ? 'checked' : ''} />
      </label>
      <label class="switch">
        <span class="t"><b>Shuffle questions</b><span>Random order inside each part</span></span>
        <input type="checkbox" data-bind="settings.shuffleQuestions" ${Q.settings.shuffleQuestions ? 'checked' : ''} />
      </label>
      <label class="switch">
        <span class="t"><b>Shuffle multiple-choice options</b><span>Random choice order</span></span>
        <input type="checkbox" data-bind="settings.shuffleChoices" ${Q.settings.shuffleChoices ? 'checked' : ''} />
      </label>
      <label class="switch">
        <span class="t"><b>Enable per-question timer</b><span>Countdown on each question</span></span>
        <input type="checkbox" data-bind="settings.timerEnabled" ${Q.settings.timerEnabled ? 'checked' : ''} />
      </label>
      <div class="grid-2" style="margin-top:12px">
        <div class="field">
          <label>MCQ seconds per question</label>
          <input class="input sm" type="number" min="3" data-bind="settings.timers.mcq" data-kind="num" value="${Q.settings.timers?.mcq ?? 10}" />
        </div>
        <div class="field">
          <label>Identification seconds per question</label>
          <input class="input sm" type="number" min="3" data-bind="settings.timers.ident" data-kind="num" value="${Q.settings.timers?.ident ?? 5}" />
        </div>
        <div class="field">
          <label>Enumeration seconds per question</label>
          <input class="input sm" type="number" min="5" data-bind="settings.timers.enum" data-kind="num" value="${Q.settings.timers?.enum ?? 20}" />
        </div>
        <div class="field">
          <label>Code seconds per question</label>
          <input class="input sm" type="number" min="10" data-bind="settings.timers.code" data-kind="num" value="${Q.settings.timers?.code ?? 60}" />
        </div>
      </div>
    </div>

    ${Q.sections.map(sectionEd).join('')}

    <h3 style="margin:26px 0 10px">Add a part</h3>
    <div class="add-row">
      ${Object.entries(TYPE).map(([k, t]) => `
        <button class="add-tile" data-act="add-section" data-type="${k}">
          ${ic(t.icon)}
          <span>${t.label}<small>${t.blurb}</small></span>
        </button>
      `).join('')}
    </div>`;
  window.scrollTo(0, y);
}
function sectionEd(s, si) {
  const P = `sections.${si}`;
  return `<section class="card sec-card"><div class="sec-head"><span class="badge accent">${ic(TYPE[s.type].icon)} ${TYPE[s.type].short}</span>
    <input class="input sm" data-bind="${P}.title" value="${esc(s.title)}" aria-label="Part title" /><span class="spacer"></span>
    <button class="btn icon-btn sm" data-act="sec-up" data-s="${si}" aria-label="Move part up">${ic('up')}</button><button class="btn icon-btn sm" data-act="sec-down" data-s="${si}" aria-label="Move part down">${ic('down')}</button><button class="btn icon-btn sm danger" data-act="sec-del" data-s="${si}" aria-label="Delete part">${ic('trash')}</button></div>
    <div class="sec-body">${s.questions.map((q, qi) => questionEd(q, si, qi)).join('')}<button class="btn" data-act="add-q" data-s="${si}">${ic('plus')} Add question</button></div></section>`;
}
function questionEd(q, si, qi) {
  const P = `sections.${si}.questions.${qi}`;
  const head = `<div class="qe-head"><b>${TYPE[q.type].short} · Q${qi + 1}</b><div class="row" style="gap:6px"><button class="btn icon-btn sm" data-act="q-dup" data-s="${si}" data-q="${qi}" aria-label="Duplicate">${ic('copy')}</button><button class="btn icon-btn sm danger" data-act="q-del" data-s="${si}" data-q="${qi}" aria-label="Delete">${ic('trash')}</button></div></div>`;
  const explain = `<div class="field" style="margin:12px 0 0"><label>Explanation (shown on reveal)</label><input class="input sm" data-bind="${P}.explain" value="${esc(q.explain)}" placeholder="Optional" /></div>`;
  let b = '';
  if (q.type === 'mcq') {
    b = `<div class="field"><label>Question</label><textarea class="input" rows="2" data-bind="${P}.q">${esc(q.q)}</textarea></div><label class="lbl">Choices <span class="hint">· select the correct one</span></label>
      ${q.choices.map((c, ci) => `<div class="choice-ed"><input type="radio" name="ans-${si}-${qi}" value="${ci}" data-bind="${P}.answer" data-kind="radio" ${q.answer === ci ? 'checked' : ''} aria-label="Correct choice ${ci + 1}" /><input class="input sm" data-bind="${P}.choices.${ci}" value="${esc(c)}" placeholder="Choice ${String.fromCharCode(65 + ci)}" />${q.choices.length > 2 ? `<button class="btn icon-btn sm danger" data-act="del-choice" data-s="${si}" data-q="${qi}" data-c="${ci}" aria-label="Remove choice">${ic('x')}</button>` : ''}</div>`).join('')}
      ${q.choices.length < 8 ? `<button class="btn sm" data-act="add-choice" data-s="${si}" data-q="${qi}">${ic('plus')} Add choice</button>` : ''}`;
  } else if (q.type === 'ident') {
    b = `<div class="field"><label>Question / description</label><textarea class="input" rows="2" data-bind="${P}.q">${esc(q.q)}</textarea></div>
      <div class="grid-2"><div class="field"><label>Correct answer</label><input class="input" data-bind="${P}.answer" value="${esc(q.answer)}" /></div>
      <div class="field"><label>Also accept <span class="hint">(comma separated)</span></label><input class="input" data-bind="${P}.alts" data-kind="csv" value="${esc((q.alts || []).join(', '))}" /></div></div>`;
  } else if (q.type === 'enum') {
    b = `<div class="field"><label>Question</label><textarea class="input" rows="2" data-bind="${P}.q">${esc(q.q)}</textarea></div>
      <div class="field"><label>Correct answers <span class="hint">(one per line)</span></label><textarea class="input" rows="4" data-bind="${P}.answers" data-kind="lines">${esc(q.answers.join('\n'))}</textarea></div>
      <label class="switch" style="border:0;padding:0"><span class="t"><b>Answers must be in order</b><span>Off = any order is fine</span></span><input type="checkbox" data-bind="${P}.ordered" ${q.ordered ? 'checked' : ''} /></label>`;
  } else {
    const nBlank = blanksOf(q).length;
    b = `<div class="grid-2"><div class="field"><label>Challenge type</label><select class="input" data-bind="${P}.mode" data-rerender="1"><option value="blank" ${q.mode === 'blank' ? 'selected' : ''}>Fill in the blanks</option><option value="bug" ${q.mode === 'bug' ? 'selected' : ''}>Find the bug</option><option value="syntax" ${q.mode === 'syntax' ? 'selected' : ''}>Fix the syntax</option><option value="arrange" ${q.mode === 'arrange' ? 'selected' : ''}>Arrange the lines</option></select></div>
      <div class="field"><label>Language</label><select class="input" data-bind="${P}.language">${LANGS.map((l) => `<option ${q.language === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label>Title</label><input class="input" data-bind="${P}.title" value="${esc(q.title)}" placeholder="e.g. Complete the loop" /></div><div class="field"><label>Instructions</label><input class="input" data-bind="${P}.prompt" value="${esc(q.prompt)}" placeholder="What should the student do?" /></div></div>
      <div class="field"><div class="row" style="justify-content:space-between"><label for="code-${si}-${qi}">${q.mode === 'bug' ? 'Code (with the bug in it)' : 'Code'}</label>
        <label class="btn sm upload-btn">${ic('upload')} Upload code file<input type="file" data-upload="${si}.${qi}" /></label></div>
        <textarea class="input code-input" id="code-${si}-${qi}" data-bind="${P}.code" spellcheck="false" placeholder="Paste or upload your code…">${esc(q.code)}</textarea></div>
      ${q.mode === 'blank' ? `<div class="row" style="margin-bottom:6px"><button class="btn sm" data-act="wrap-blank" data-s="${si}" data-q="${qi}">${ic('eye')} Hide selection</button><button class="btn sm" data-act="auto-blank" data-s="${si}" data-q="${qi}">${ic('shuffle')} Auto-blank keywords</button><span class="hint">Hidden parts are wrapped like <span class="mono">[[word]]</span>. Blanks: <b>${nBlank}</b></span></div>` : ''}
      ${q.mode === 'bug' ? `<div class="grid-2"><div class="field"><label>Buggy line number</label><input class="input" type="number" min="1" data-bind="${P}.bugLine" data-kind="num" value="${q.bugLine ?? ''}" /></div><div class="field"><label>Corrected line</label><input class="input mono" data-bind="${P}.fix" value="${esc(q.fix)}" /></div></div>
        <div class="ln-preview" aria-label="Line numbers">${String(q.code || '').split('\n').map((l, i) => `<div><i>${i + 1}</i>${esc(l) || ' '}</div>`).join('')}</div>` : ''}
      ${q.mode === 'syntax' ? `<div class="field"><label>Fixed code (reference)</label><textarea class="input code-input" data-bind="${P}.fix" spellcheck="false" placeholder="The corrected version…">${esc(q.fix)}</textarea></div>
        <p class="hint">The student sees the broken code and types a correction. Extra spaces, comments and string contents are ignored when checking.</p>` : ''}
      ${q.mode === 'arrange' ? '<p class="hint">Lines are shuffled for the student. Indentation and comments are ignored when checking.</p>' : ''}`;
  }
  return `<div class="qe">${head}${b}${explain}</div>`;
}

function validateQuiz(Q) {
  if (!Q.title.trim()) return 'Give your quiz a title.';
  if (!Q.sections.some((s) => s.questions.length)) return 'Add at least one part with a question.';
  for (const s of Q.sections) for (const [i, q] of s.questions.entries()) {
    const w = `${s.title} · Q${i + 1}: `;
    if (q.type === 'mcq') { if (!q.q.trim()) return w + 'question is empty.'; if (q.choices.filter((c) => c.trim()).length < 2) return w + 'needs at least 2 choices.'; if (!q.choices[q.answer] || !q.choices[q.answer].trim()) return w + 'the correct choice is empty.'; }
    else if (q.type === 'ident') { if (!q.q.trim() || !q.answer.trim()) return w + 'needs a question and an answer.'; }
    else if (q.type === 'enum') { if (!q.q.trim() || q.answers.length < 1) return w + 'needs a question and at least one answer.'; }
    else {
      if (!q.code.trim()) return w + 'code is empty.';
      if (q.mode === 'blank' && !blanksOf(q).length) return w + 'hide at least one part with [[ ]].';
      if (q.mode === 'bug') { const n = q.code.split('\n').length; if (!q.bugLine || q.bugLine < 1 || q.bugLine > n) return w + `buggy line must be between 1 and ${n}.`; if (!String(q.fix).trim()) return w + 'add the corrected line.'; }
      if (q.mode === 'syntax' && !String(q.fix).trim()) return w + 'add the fixed reference code.';
      if (q.mode === 'arrange' && arrangeLines(q).length < 2) return w + 'needs at least 2 lines to arrange.';
    }
  }
  return '';
}

function parseMaterial(text) {
  const out = { mcq: [], ident: [], enum: [] };
  text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).forEach((block) => {
    let q = ''; let ans = ''; let explain = ''; const ch = [];
    block.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
      let m;
      if ((m = l.match(/^ans(?:wer)?\s*[:=]\s*(.+)/i))) ans = m[1].trim();
      else if ((m = l.match(/^exp(?:lain|lanation)?\s*[:=]\s*(.+)/i))) explain = m[1].trim();
      else if ((m = l.match(/^(?:q\d*\s*[:.)]|\d+\s*[.)])\s*(.+)/i))) q = m[1].trim();
      else if ((m = l.match(/^\(?([a-h])[.)]\s*(.+)/i))) ch.push({ k: m[1].toUpperCase(), t: m[2].trim() });
      else q = q ? q + ' ' + l : l;
    });
    if (!q) return;
    if (ch.length >= 2) {
      let idx = ans.length <= 2 ? ch.findIndex((c) => c.k === ans.trim().charAt(0).toUpperCase()) : -1;
      if (idx < 0) idx = ch.findIndex((c) => c.t.toLowerCase() === ans.toLowerCase());
      out.mcq.push({ ...newQ('mcq'), q, choices: ch.map((c) => c.t), answer: Math.max(idx, 0), explain });
    } else if (ans.includes(';')) out.enum.push({ ...newQ('enum'), q, answers: ans.split(';').map((s) => s.trim()).filter(Boolean), explain });
    else if (ans) out.ident.push({ ...newQ('ident'), q, answer: ans, explain });
  });
  return out;
}
function addParsed(parsed) {
  let n = 0;
  Object.entries(parsed).forEach(([type, qs]) => {
    if (!qs.length) return; n += qs.length;
    let sec = S.ed.sections.find((s) => s.type === type);
    if (!sec) { sec = { id: DB.uid('s'), type, title: TYPE[type].label, questions: [] }; S.ed.sections.push(sec); }
    sec.questions = sec.questions.filter((q) => (q.q || '').trim() || (q.code || '').trim()).concat(qs);
  });
  return n;
}

/* ==========================================================
   Router
   ========================================================== */
function render() {
  const raw = location.hash.slice(1) || '/'; const [path, qs] = raw.split('?'); const q = new URLSearchParams(qs || '');
  const u = DB.session(); let m;
  if (S.play && S.play.phase !== 'done' && !isActivePlayRoute(S.play)) {
    persistPlayProgress(S.play);
    clearPlayTimer(S.play);
  }
  if (!isActivePlayRoute()) clearPlayTimer();
  closeModal(); window.scrollTo(0, 0);
  if (path === '/') return u ? go(homeFor(u)) : landing();
  if (path === '/auth') return u ? go(homeFor(u)) : authView(q.get('mode') === 'register' ? 'register' : 'login');
  if (!u) return go('/auth');
  const admin = u.role === 'admin';
  if (path === '/dashboard') return admin ? go('/manage') : dashboard(u);
  if (path === '/history') return admin ? go('/manage') : historyView(u);
  if ((m = path.match(/^\/play\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    if ((!S.play || S.play.quiz.id !== id) && !resumeSavedPlay(id)) return go(homeFor(u));
    return playView(id);
  }
  if (path === '/manage') return admin ? manageView() : go('/dashboard');
  if ((m = path.match(/^\/manage\/edit\/(.+)$/))) return admin ? editorView(decodeURIComponent(m[1])) : go('/dashboard');
  go(homeFor(u));
}
window.addEventListener('hashchange', render);

/* ==========================================================
   Events
   ========================================================== */
const actions = {
  theme() {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('be_theme', t); } catch {}
    $$('[data-act="theme"]').forEach((b) => (b.innerHTML = ic(t === 'dark' ? 'sun' : 'moon')));
  },
  sound() {
    if (typeof Sound === 'undefined') return;
    const on = Sound.toggle();
    $$('[data-act="sound"]').forEach((b) => (b.textContent = on ? '🔊' : '🔇'));
    toast(on ? 'Sound on' : 'Sound off', on ? 'ok' : 'info');
  },
  'nav-toggle'() {
    const m = document.getElementById('mobile-menu');
    if (m) m.hidden = !m.hidden;
  },
  logout() {
  confirmBox(
    'You will be logged out. Your progress in unfinished quizzes will be lost.',
    () => { clearPlayTimer(); DB.logout(); S.play = null; go('/'); },
    'Log out'
  );
},
  guest() { DB.guest(); go('/dashboard'); },
  'modal-bg'(t, e) { if (e.target === t) closeModal(); },
  'auth-tab'(t) { go('/auth?mode=' + t.dataset.mode); },
  'toggle-admin'(t) { $('#admin-code-wrap').classList.toggle('hidden', !t.checked); if (t.checked) $('#f-code').focus(); },
  'change-admin-code'() {
    openModal({
      title: 'Change admin access code', body: `<div class="field"><label>New code</label><input class="input" id="new-code" placeholder="At least 4 characters" /></div><p class="hint">Current code: <span class="mono">${esc(DB.adminCode())}</span></p>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', onClick: () => { try { DB.updateAdminCode($('#new-code').value); toast('Admin code updated.', 'ok'); } catch (e) { toast(e.message, 'err'); return false; } } }],
    });
  },

  'start-open'(t) {
    if (resumeSavedPlay(t.dataset.id)) {
      go('/play/' + t.dataset.id);
      return toast('Resumed your quiz where you left off.', 'ok');
    }
    startModal(t.dataset.id);
  },
  preview(t) { startModal(t.dataset.id, true); },
  'select-all-sections'() { $$('[data-section-option]', $('#modal-root')).forEach((input) => { input.checked = true; }); },
  'clear-sections'() { $$('[data-section-option]', $('#modal-root')).forEach((input) => { input.checked = false; }); },
  'clear-history'() { confirmBox('This removes all your saved scores on this device.', () => { DB.clearAttempts(DB.session().id); render(); }, 'Clear'); },
  'print-results'() { window.print(); },

  'submit-part'() {
    const P = S.play; const sec = P.quiz.sections[P.idx];
    collectSection(sec);
    if (P.reveal) { P.phase = 'reveal'; P.revealed[sec.id] = true; playView(P.quiz.id); window.scrollTo(0, 0); }
    else advance();
  },'q-next'() {
  const P = S.play;
  const sec = P.quiz.sections[P.idx];
  collectCurrentQuestion(sec);
  if (P.qIdx[sec.id] < sec.questions.length - 1) {
    P.qIdx[sec.id]++;
    P.timeLeft = null;
    playView(P.quiz.id);
  } else {
    // it's the last question | trigger submit
    actions['submit-part']();
  }
},
'q-prev'() {
  const P = S.play;
  const sec = P.quiz.sections[P.idx];
  collectCurrentQuestion(sec);
  if (P.qIdx[sec.id] > 0) {
    P.qIdx[sec.id]--;
    P.timeLeft = null;
    playView(P.quiz.id);
  }
},
  'next-part'() { advance(); },
 quit() {
  const P = S.play; const back = DB.session().role === 'admin' ? '/manage' : '/dashboard';
  if (!P || P.phase === 'done') { clearPlayTimer(); S.play = null; return go(back); }
  confirmBox('Your progress will be saved so you can continue this quiz later.', () => { persistPlayProgress(P); clearPlayTimer(P); S.play = null; go(back); }, 'Quit game');
},
  'restart-play'() {
    const P = S.play;
    if (!P || P.preview) return;
    clearPlayTimer(P);
    persistPlayProgress(P);
    openModal({
      title: 'Start this quiz again?',
      body: '<p class="muted">Your current answers will be cleared and this same selection of parts will start from the beginning.</p>',
      actions: [
        { label: 'Keep current run', cls: 'ghost', onClick: () => { startQuestionTimer(); } },
        { label: 'Start again', cls: 'primary', onClick: () => {
          const user = DB.session();
          DB.clearPlayProgress(user.id, P.quiz.id);
          const reset = newPlay(P.quiz, {
            sectionIndexes: P.quiz.sections.map((_, index) => index),
            reveal: P.reveal,
            shuffleQ: P.shuffleQuestions,
            shuffleC: P.shuffleChoices,
            timers: P.timerOn,
            preview: false,
          });
          reset.timers = clone(P.timers);
          S.play = reset;
          playView(reset.quiz.id);
          window.scrollTo(0, 0);
        } },
      ],
    });
  },
  retry() { const q = DB.quiz(S.play.quiz.id); if (q) startModal(q.id, S.play.preview); },
  'arr-up'(t) { const it = t.closest('.arr-item'); if (it.previousElementSibling) it.previousElementSibling.before(it); persistPlayProgress(); },
  'arr-down'(t) { const it = t.closest('.arr-item'); if (it.nextElementSibling) it.nextElementSibling.after(it); persistPlayProgress(); },

  'new-quiz'() { go('/manage/edit/new'); },
  dup(t) { DB.duplicateQuiz(t.dataset.id); toast('Quiz duplicated.', 'ok'); manageView(); },
  del(t) { const q = DB.quiz(t.dataset.id); confirmBox(`Delete <b>${esc(q.title)}</b>? This can't be undone.`, () => { DB.removeQuiz(q.id); toast('Quiz deleted.'); manageView(); }); },
  export() { download('quizzes.json', DB.exportData()); toast('Exported. Save it as data/quizzes.json in your repo.', 'ok'); },
  async 'repo-load'() {
    try { const n = await DB.loadRepoData(); n ? toast(`Loaded ${n} quiz(zes) from data/quizzes.json.`, 'ok') : toast('data/quizzes.json is empty.'); manageView(); }
    catch (e) { toast(e.message + ' (Use a web server or GitHub Pages, not file://)', 'err'); }
  },

  'ed-cancel'(t, e) { if (S.dirty) { e.preventDefault(); confirmBox('You have unsaved changes.', () => { S.dirty = false; go('/manage'); }, 'Discard'); } },
  'ed-save'() {
    const err = validateQuiz(S.ed); if (err) return toast(err, 'err');
    try { const copy = clone(S.ed); delete copy._isNew; DB.saveQuiz(copy); S.dirty = false; toast('Quiz saved.', 'ok'); go('/manage'); } catch (e) { toast(e.message, 'err'); }
  },
  'add-section'(t) { S.ed.sections.push(newSection(t.dataset.type)); S.dirty = true; renderEd(); },
  'sec-del'(t) { const s = S.ed.sections[+t.dataset.s]; const doIt = () => { S.ed.sections.splice(+t.dataset.s, 1); S.dirty = true; renderEd(); }; s.questions.length ? confirmBox(`Delete the part "${esc(s.title)}" and its ${s.questions.length} question(s)?`, doIt) : doIt(); },
  'sec-up'(t) { const i = +t.dataset.s, a = S.ed.sections; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; S.dirty = true; renderEd(); } },
  'sec-down'(t) { const i = +t.dataset.s, a = S.ed.sections; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; S.dirty = true; renderEd(); } },
  'add-q'(t) { const s = S.ed.sections[+t.dataset.s]; s.questions.push(newQ(s.type)); S.dirty = true; renderEd(); },
  'q-del'(t) { S.ed.sections[+t.dataset.s].questions.splice(+t.dataset.q, 1); S.dirty = true; renderEd(); },
  'q-dup'(t) { const qs = S.ed.sections[+t.dataset.s].questions; const c = clone(qs[+t.dataset.q]); c.id = DB.uid('q'); qs.splice(+t.dataset.q + 1, 0, c); S.dirty = true; renderEd(); },
  'add-choice'(t) { S.ed.sections[+t.dataset.s].questions[+t.dataset.q].choices.push(''); renderEd(); },
  'del-choice'(t) { const q = S.ed.sections[+t.dataset.s].questions[+t.dataset.q]; const c = +t.dataset.c; q.choices.splice(c, 1); if (q.answer === c) q.answer = 0; else if (q.answer > c) q.answer--; S.dirty = true; renderEd(); },
  'wrap-blank'(t) {
    const ta = $(`#code-${t.dataset.s}-${t.dataset.q}`); const a = ta.selectionStart, b = ta.selectionEnd;
    if (a === b) return toast('Select the text to hide first.');
    const sel = ta.value.slice(a, b); if (sel.includes('\n')) return toast('Hide one line at a time.');
    S.ed.sections[+t.dataset.s].questions[+t.dataset.q].code = ta.value.slice(0, a) + '[[' + sel + ']]' + ta.value.slice(b); S.dirty = true; renderEd();
  },
  'auto-blank'(t) {
    const q = S.ed.sections[+t.dataset.s].questions[+t.dataset.q];
    if (!q.code.trim()) return toast('Add some code first.');
    if (blanksOf(q).length) return toast('This code already has blanks.');
    const re = /\b(function|return|const|let|var|if|else|for|while|class|def|import|print|console|public|static|void|int|string|true|false|null|None|echo|foreach)\b|\b\d+\b/g;
    const ms = [...q.code.matchAll(re)].filter((_, i) => i % 2 === 0).slice(0, 6);
    if (!ms.length) return toast('No keywords found. Select text and use "Hide selection".');
    let c = q.code; ms.reverse().forEach((m) => { c = c.slice(0, m.index) + '[[' + m[0] + ']]' + c.slice(m.index + m[0].length); });
    q.code = c; S.dirty = true; renderEd(); toast(`${ms.length} blanks added. Review them before saving.`, 'ok');
  },
  'import-material'() {
    openModal({
      title: 'Import material', wide: true,
      body: `<p class="muted">Paste your notes. Separate each question with a blank line. Multiple choice, identification and enumeration are detected automatically.</p>
        <textarea class="input code-input" id="mat" style="min-height:220px" spellcheck="false">Q: Which layer of the OSI model handles routing?
A) Physical
B) Network
C) Transport
D) Session
Answer: B

Q: What protocol resolves domain names to IP addresses?
Answer: DNS

Q: Name the private IPv4 ranges.
Answer: 10.0.0.0/8; 172.16.0.0/12; 192.168.0.0/16</textarea>
        <p class="hint">Answers separated by <span class="mono">;</span> become an enumeration. Add <span class="mono">Explain:</span> for an explanation.</p>`,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Add to quiz', cls: 'primary', onClick: () => { const n = addParsed(parseMaterial($('#mat').value)); if (!n) { toast('Nothing recognised. Check the format.', 'err'); return false; } S.dirty = true; renderEd(); toast(`${n} question(s) added.`, 'ok'); } }],
    });
  },
};

/* ---------- sound popover wiring ---------- */
/* ---------- sound popover wiring ---------- */
function refreshSoundUI() {
  if (typeof Sound === 'undefined') return;
  const on = Sound.isEnabled();
  const pct = Math.round(Sound.getVolume() * 100);

  // Update all sound button icons (SVG)
  $$('[data-act="sound"]').forEach((b) => {
    b.innerHTML = ic(on ? 'volume2' : 'volumeX');
  });

  // Update the popover switch + slider values
  const toggle = document.getElementById('sound-pop-toggle');
  if (toggle) toggle.checked = on;

  const range = document.getElementById('sound-pop-range');
  if (range && document.activeElement !== range) range.value = pct;

  const valEl = document.getElementById('sound-pop-val');
  if (valEl) valEl.textContent = pct + '%';
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'sound-pop-toggle' && typeof Sound !== 'undefined') {
    Sound.setEnabled(t.checked);
    refreshSoundUI();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'sound-pop-range' && typeof Sound !== 'undefined') {
    const pct = Number(t.value);
    Sound.setVolume(pct / 100);
    // Update label live
    const valEl = document.getElementById('sound-pop-val');
    if (valEl) valEl.textContent = pct + '%';
    // Sync toggle switch + button icon
    const toggle = document.getElementById('sound-pop-toggle');
    if (toggle) toggle.checked = Sound.isEnabled();
    $$('[data-act="sound"]').forEach((b) => {
      b.innerHTML = ic(Sound.isEnabled() ? 'volume2' : 'volumeX');
    });
    // Preview sound at new volume (only when > 0)
    if (pct > 0) Sound.play('click');
  }
});

// Close the popover when clicking outside
document.addEventListener('click', (e) => {
  const pop = document.getElementById('sound-pop');
  if (!pop || pop.hidden) return;
  const inside = e.target.closest('.sound-pop-wrap');
  if (!inside) pop.hidden = true;
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  // Play click sound for any action button (but not when sound would be jarring)
  if (t && Sound) {
    const silent = t.dataset.act === 'theme'; // theme toggle has its own feel
    if (!silent) Sound.play('click');
  }
  if (t && actions[t.dataset.act]) { actions[t.dataset.act](t, e); return; }
  const line = e.target.closest('[data-bug] .code-line.pick');
  if (line) {
    if (Sound) Sound.play('click');
    $$('.code-line.sel', line.parentNode).forEach((x) => x.classList.remove('sel'));
    line.classList.add('sel');
    persistPlayProgress();
  }
});

// Unlock Web Audio on the first interaction anywhere
document.addEventListener('pointerdown', () => { if (Sound) Sound.unlock(); }, { once: true });
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
  const d = Object.fromEntries(new FormData(f)); const err = $('#auth-err');
  const fail = (m) => { err.innerHTML = `<div class="form-error" role="alert">${esc(m)}</div>`; };
  try {
    if (!/^\S+@\S+\.\S+$/.test(d.email || '')) return fail('Enter a valid email address.');
    if (f.dataset.form === 'register') {
      if (!d.name.trim()) return fail('Enter your name.');
      if ((d.password || '').length < 6) return fail('Password must be at least 6 characters.');
      const wantsAdmin = $('#f-admin') && $('#f-admin').checked;
      if (wantsAdmin && !d.adminCode.trim()) return fail('Enter the admin access code.');
      DB.register({ ...d, adminCode: wantsAdmin ? d.adminCode : '' });
    } else {
      if (!d.password) return fail('Enter your password.');
      DB.login(d);
    }
    go(homeFor(DB.session()));
  } catch (x) { fail(x.message); }
});

function onBind(e) {
  const t = e.target;
  if (!t.dataset || !t.dataset.bind || !S.ed) return;
  const k = t.dataset.kind || 'text';
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (k === 'radio') { if (!t.checked) return; v = Number(t.value); }
  else if (k === 'num') v = t.value === '' ? null : Number(t.value);
  else if (k === 'lines') v = t.value.split('\n').map((s) => s.trim()).filter(Boolean);
  else if (k === 'csv') v = t.value.split(',').map((s) => s.trim()).filter(Boolean);
  else v = t.value;

  // Ensure nested objects exist before writing (fixes settings.timers.* crashes)
  const path = t.dataset.bind.split('.');
  let obj = S.ed;
  for (let i = 0; i < path.length - 1; i++) {
    if (obj[path[i]] === undefined || obj[path[i]] === null) {
      obj[path[i]] = {};
    }
    obj = obj[path[i]];
  }
  obj[path[path.length - 1]] = v;

  S.dirty = true;
  if (t.dataset.rerender && e.type === 'change') renderEd();
}
document.addEventListener('input', onBind);
document.addEventListener('change', (e) => {
  onBind(e); const t = e.target;
  if (t.id === 'reveal-toggle' && S.play) S.play.reveal = t.checked;
  if (t.id === 'timer-toggle' && S.play) {
    S.play.timerOn = t.checked;
    if (t.checked) startQuestionTimer(true); else clearPlayTimer();
  }
  if (t.matches && t.matches('input[data-upload]')) {
    const f = t.files[0]; if (!f) return;
    if (f.size > 500 * 1024) return toast('File is too large (max 500 KB).', 'err');
    const [si, qi] = t.dataset.upload.split('.').map(Number); const r = new FileReader();
    r.onload = () => { const q = S.ed.sections[si].questions[qi]; q.code = String(r.result).replace(/\r\n/g, '\n'); const ext = f.name.split('.').pop().toLowerCase(); if (EXT_LANG[ext]) q.language = EXT_LANG[ext]; S.dirty = true; renderEd(); toast(`Loaded ${f.name}.`, 'ok'); };
    r.readAsText(f);
  }
  if (t.matches && t.matches('input[data-import]')) {
    const f = t.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { try { const n = DB.importData(JSON.parse(r.result)); toast(`Imported ${n} quiz(zes).`, 'ok'); manageView(); } catch (x) { toast(x.message || 'Could not read that file.', 'err'); } };
    r.readAsText(f);
  }
  if (t.closest && t.closest('#part')) persistPlayProgress();
});
document.addEventListener('input', (e) => {
  if (e.target.closest && e.target.closest('#part')) persistPlayProgress();
});

/* drag & drop for arrange */
let dragEl = null;
document.addEventListener('dragstart', (e) => { const it = e.target.closest && e.target.closest('.arr-item'); if (!it) return; dragEl = it; it.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x'); });
document.addEventListener('dragover', (e) => { const it = e.target.closest && e.target.closest('.arr-item'); if (!dragEl || !it || it.parentNode !== dragEl.parentNode) return; e.preventDefault(); $$('.arr-item.over').forEach((x) => x.classList.remove('over')); if (it !== dragEl) it.classList.add('over'); });
document.addEventListener('drop', (e) => {
  const it = e.target.closest && e.target.closest('.arr-item'); if (!dragEl || !it || it === dragEl || it.parentNode !== dragEl.parentNode) return; e.preventDefault();
  const kids = [...it.parentNode.children]; if (kids.indexOf(dragEl) < kids.indexOf(it)) it.after(dragEl); else it.before(dragEl);
});
document.addEventListener('dragend', () => {
  if (dragEl) dragEl.classList.remove('drag');
  $$('.arr-item.over').forEach((x) => x.classList.remove('over'));
  dragEl = null;
  persistPlayProgress();
});

function focusCurrentAnswer() {
  const P = S.play;
  if (!P || P.phase !== 'answer') return;
  const sec = P.quiz.sections[P.idx];
  const q = sec && sec.questions[P.qIdx[sec.id]];
  if (!q) return;
  const id = CSS.escape(q.id);
  const selector = q.type === 'mcq'
    ? `input[name="q_${id}"]`
    : q.type === 'ident' || q.type === 'enum' || (q.type === 'code' && q.mode === 'blank')
      ? `input[data-qid="${id}"]`
      : q.type === 'code' && q.mode === 'bug'
        ? `input[data-fix="${id}"]`
        : q.type === 'code' && q.mode === 'syntax'
          ? `textarea[data-qid="${id}"]`
          : `[data-arr="${id}"] button`;
  const field = $(`${selector}`, $('#part'));
  if (field) field.focus();
}

/* keyboard shortcuts */
document.addEventListener('keydown', (e) => {
  if (!S.play || !isActivePlayRoute(S.play)) return;
  if (e.key === 'Tab' && !e.shiftKey && !$('#part')?.contains(e.target)) {
    e.preventDefault();
    focusCurrentAnswer();
    return;
  }
  if (S.play.phase === 'answer' && e.key >= '1' && e.key <= '4') {
    const sec = S.play.quiz.sections[S.play.idx];
    const q = sec.questions[S.play.qIdx[sec.id]];
    if (q && q.type === 'mcq') {
      const c = $(`input[name="q_${CSS.escape(q.id)}"][value="${+e.key - 1}"]`);
      if (c) { c.checked = true; persistPlayProgress(); }
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const action = S.play.phase === 'reveal'
      ? $('[data-act="next-part"]')
      : $('[data-act="q-next"]') || $('[data-act="submit-part"]');
    if (action) {
      e.preventDefault();
      action.click();
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (S.play && isActivePlayRoute(S.play)) {
    persistPlayProgress(S.play);
    clearPlayTimer(S.play);
  }
  if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('pagehide', () => {
  if (S.play && isActivePlayRoute(S.play)) {
    persistPlayProgress(S.play);
    clearPlayTimer(S.play);
  }
});

/* ---------- boot ---------- */
DB.init().then(render);