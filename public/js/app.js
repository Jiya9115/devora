(() => {
'use strict';

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let me = null;

const store = {
  get(k) { try { return localStorage.getItem('devora:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('devora:' + k, v); } catch { /* private mode */ } },
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function ago(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const s = Math.max(1, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const VERDICT_NAME = {
  AC: 'Accepted', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded', MLE: 'Memory Limit Exceeded',
  RE: 'Runtime Error', CE: 'Compilation Error', OLE: 'Output Limit Exceeded', IE: 'Judge Error',
  OK: 'Ran without errors', Pending: 'Judging…',
};
const vTag = (v) => `<span class="v v-${esc(v)}">${esc(v === 'Pending' ? '…' : v)}</span>`;

/* ---------- tiny markdown for problem statements ---------- */
function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const b = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) b.push(lines[i++]);
      i++; html += `<pre>${esc(b.join('\n'))}</pre>`; continue;
    }
    if (/^###\s+/.test(l)) { html += `<h3>${inline(l.replace(/^###\s+/, ''))}</h3>`; i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) {
      html += '<ul>';
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`;
      html += '</ul>'; continue;
    }
    if (!l.trim()) { i++; continue; }
    const p = [];
    while (i < lines.length && lines[i].trim() && !/^(###\s|```|\s*[-*]\s)/.test(lines[i])) p.push(lines[i++]);
    html += `<p>${inline(p.join(' '))}</p>`;
  }
  return html;
}

/* ---------- Java syntax highlighting ---------- */
const KW = new Set(('abstract assert break case catch class continue default do else enum extends final finally for if implements ' +
  'import instanceof interface native new package private protected public return static strictfp super switch synchronized ' +
  'this throw throws transient try volatile while var record true false null').split(' '));
const PRIM = new Set('boolean byte char short int long float double void'.split(' '));
function hlJava(code) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[LlFfDd]?\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let out = '';
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) out += `<span class="tk-cmt">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-num">${esc(m[3])}</span>`;
    else if (m[4]) {
      const w = m[4];
      const next = code[re.lastIndex];
      if (KW.has(w) || PRIM.has(w)) out += `<span class="tk-kw">${w}</span>`;
      else if (/^[A-Z]/.test(w)) out += `<span class="tk-ty">${w}</span>`;
      else if (next === '(') out += `<span class="tk-fn">${w}</span>`;
      else out += w;
    } else out += esc(m[5]);
  }
  return out;
}

/* ---------- code editor: textarea over a highlighted <pre> ---------- */
function createEditor(host, { value = '', readOnly = false, onChange, onRun } = {}) {
  host.classList.add('editor');
  if (readOnly) host.classList.add('ro');
  host.innerHTML = `<div class="gutter"></div><div class="area"><pre class="hl" aria-hidden="true"></pre>` +
    `<textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" ${readOnly ? 'readonly' : ''} aria-label="Code editor"></textarea></div>`;
  const ta = $('textarea', host);
  const pre = $('pre', host);
  const gut = $('.gutter', host);
  ta.value = value;

  const paint = () => {
    pre.innerHTML = hlJava(ta.value) + '\n';
    const n = ta.value.split('\n').length;
    gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    sync();
  };
  const sync = () => {
    pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
    gut.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('input', () => { paint(); onChange && onChange(ta.value); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun && onRun(); return; }
    if (readOnly) return;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    const edit = (text, from, to, caret) => {
      ta.focus();
      ta.setSelectionRange(from, to);
      // execCommand keeps the native undo stack; fall back if unavailable
      if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        ta.setRangeText(text, from, to, 'end');
        ta.dispatchEvent(new Event('input'));
      }
      if (caret != null) ta.setSelectionRange(caret, caret);
    };
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s !== en && v.slice(s, en).includes('\n')) {
        const start = v.lastIndexOf('\n', s - 1) + 1;
        const block = v.slice(start, en);
        const out = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, '') : block.replace(/^/gm, '    ');
        edit(out, start, en);
        ta.setSelectionRange(start, start + out.length);
      } else if (e.shiftKey) {
        const start = v.lastIndexOf('\n', s - 1) + 1;
        const m = v.slice(start, s).match(/^( {1,4}|\t)/);
        if (m) edit('', start, start + m[0].length);
      } else edit('    ', s, en);
    } else if (e.key === 'Enter' && s === en) {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const indent = v.slice(lineStart, s).match(/^\s*/)[0];
      const before = v[s - 1];
      const after = v[s];
      if (before === '{' && after === '}') {
        edit(`\n${indent}    \n${indent}`, s, en, s + 1 + indent.length + 4);
      } else edit('\n' + indent + (before === '{' ? '    ' : ''), s, en);
    } else if (e.key === '}' && s === en) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const seg = v.slice(lineStart, s);
      if (/^ +$/.test(seg) && seg.length >= 4) { e.preventDefault(); edit('}', s - 4, en); }
    }
  });
  paint();
  return {
    get: () => ta.value,
    set: (v) => { ta.value = v; paint(); onChange && onChange(v); },
    focus: () => ta.focus(),
  };
}

/* ================================================================== */
/* chrome: nav, theme, auth state                                      */
/* ================================================================== */
function theme() {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  renderChrome();
}

function renderChrome() {
  const h = location.hash || '#/';
  const on = (p) => (h === p || h.startsWith(p + '/') || (p === '#/' && h === '#/') ? 'on' : '');
  $('#nav').innerHTML =
    `<a class="${on('#/')}" href="#/">Problems</a>` +
    (me ? `<a class="${on('#/dashboard')}" href="#/dashboard">Dashboard</a>` +
      `<a class="${on('#/applications')}" href="#/applications">Applications</a>` +
      `<a class="${on('#/practice')}" href="#/practice">Practice log</a>` +
      `<a class="${on('#/skills')}" href="#/skills">Skills</a>` : '') +
    `<a class="${on('#/leaderboard')}" href="#/leaderboard">Leaderboard</a>` +
    (me ? `<a class="${on('#/submissions')}" href="#/submissions">Submissions</a>` : '') +
    (me && me.role === 'admin' ? `<a class="${on('#/admin')}" href="#/admin">Admin</a>` : '');
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  $('#top-right').innerHTML =
    `<button class="btn ghost sm" id="theme-btn" title="Switch theme">${dark ? 'Light' : 'Dark'} mode</button>` +
    (me
      ? `<a class="link" href="#/settings" title="Settings">${esc(me.name)}</a><button class="btn sm" id="logout-btn">Log out</button>`
      : `<a class="link" href="#/login">Log in</a><a class="btn primary sm" href="#/register">Sign up</a>`);
  $('#theme-btn').onclick = theme;
  const lo = $('#logout-btn');
  if (lo) lo.onclick = async () => { await api('/auth/logout', { method: 'POST' }); me = null; location.hash = '#/'; renderChrome(); route(); };
}

/* ================================================================== */
/* pages                                                               */
/* ================================================================== */
const page = (html, cls = '') => { document.body.classList.remove('ws'); app.innerHTML = `<div class="page ${cls}">${html}</div>`; };

/* ---------- problem list ---------- */
async function problemsPage() {
  page('<p class="muted">Loading…</p>');
  const { problems } = await api('/problems');
  const solved = problems.filter((p) => p.status === 'solved').length;
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  problems.forEach((p) => { if (p.status === 'solved') counts[p.difficulty]++; });
  const tags = [...new Set(problems.flatMap((p) => p.tags))].sort();

  page(`
    <h1>Problems</h1>
    <p class="lede">Solve problems in Java, then track the rest of your placement preparation (applications, skills and a readiness score) in the same place.</p>
    <div class="stat-line">
      <div><b>${problems.length}</b>problems</div>
      ${me ? `<div><b>${solved}</b>solved by you</div>
      <div><b>${counts.Easy}</b>easy</div><div><b>${counts.Medium}</b>medium</div><div><b>${counts.Hard}</b>hard</div>` :
      '<div><a href="#/register" style="text-decoration:underline">Create an account</a> to track what you have solved.</div>'}
    </div>
    <div class="filters">
      <input type="text" id="q" placeholder="Search by title or tag" aria-label="Search problems">
      <select id="fd" aria-label="Difficulty"><option value="">Any difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <select id="ft" aria-label="Tag"><option value="">Any tag</option>${tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
    </div>
    <table class="t"><thead><tr>
      <th class="state"></th><th>Title</th><th class="hide-s">Tags</th><th>Difficulty</th><th class="num hide-s">Acceptance</th>
    </tr></thead><tbody id="rows"></tbody></table>
    <div class="empty" id="none" hidden>No problems match.</div>`);

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const d = $('#fd').value;
    const t = $('#ft').value;
    const list = problems.filter((p) =>
      (!d || p.difficulty === d) && (!t || p.tags.includes(t)) &&
      (!q || p.title.toLowerCase().includes(q) || p.tags.some((x) => x.includes(q))));
    $('#rows').innerHTML = list.map((p, i) => `
      <tr>
        <td class="state">${p.status ? `<span class="dot ${p.status}" title="${p.status}"></span>` : ''}</td>
        <td><a class="title" href="#/problem/${p.slug}">${esc(p.title)}</a></td>
        <td class="hide-s"><div class="tags">${p.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></td>
        <td><span class="diff diff-${p.difficulty}">${p.difficulty}</span></td>
        <td class="num hide-s">${p.total ? Math.round((100 * p.accepted) / p.total) + '%' : '—'}</td>
      </tr>`).join('');
    $('#none').hidden = list.length > 0;
  };
  ['input', 'change'].forEach((ev) => { $('#q').addEventListener(ev, draw); $('#fd').addEventListener(ev, draw); $('#ft').addEventListener(ev, draw); });
  draw();
}

/* ---------- problem workspace ---------- */
async function problemPage(slug) {
  page('<p class="muted">Loading…</p>');
  let problem;
  try { ({ problem } = await api('/problems/' + slug)); }
  catch (e) { return page(`<h1>Not found</h1><p class="lede">${esc(e.message)} <a href="#/" style="text-decoration:underline">Back to problems</a></p>`); }

  document.body.classList.add('ws');
  document.title = `${problem.title} — Devora`;
  const key = `code:${problem.slug}`;
  const saved = store.get(key);

  app.innerHTML = `
  <div class="work" id="work">
    <section class="pane left">
      <div class="tabs"><button class="on" data-t="desc">Description</button><button data-t="subs">My submissions</button></div>
      <div class="scroll" id="left-body"></div>
    </section>
    <div class="split" id="split" title="Drag to resize"></div>
    <section class="pane right">
      <div class="editor-bar">
        <span class="lang">Java</span>
        <button class="btn ghost sm" id="reset">Reset</button>
        <span class="sp"></span>
        <span class="hint">Tab indents · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs</span>
        <button class="btn sm" id="run">Run</button>
        <button class="btn primary sm" id="submit">Submit</button>
      </div>
      <div id="ed" style="flex:1;min-height:120px"></div>
      <div class="vsplit" id="vsplit"></div>
      <div class="console" id="console">
        <div class="tabs"><button class="on" data-c="result">Result</button><button data-c="custom">Custom input</button></div>
        <div class="scroll" id="console-body"></div>
      </div>
    </section>
  </div>`;

  /* editor */
  const editor = createEditor($('#ed'), {
    value: saved ?? problem.starterCode,
    onChange: (v) => store.set(key, v),
    onRun: () => run(),
  });

  /* left pane */
  const left = $('#left-body');
  const acc = problem.total ? Math.round((100 * problem.accepted) / problem.total) + '% accepted' : 'no submissions yet';
  const descHtml = () => `
    <div class="statement">
      <h1>${esc(problem.title)}</h1>
      <div class="meta"><span class="diff diff-${problem.difficulty}">${problem.difficulty}</span>
        <span>${problem.timeLimitMs} ms</span><span>${problem.memoryMb} MB</span><span>${acc}</span></div>
      ${md(problem.statement)}
      <h3>Examples</h3>
      ${problem.samples.map((s, i) => `
        <div class="sample"><div class="sh"><span>Example ${i + 1}</span><button class="btn ghost sm" data-copy="${i}">Copy input</button></div>
        <div class="cols"><div><div class="cl">Input</div><pre>${esc(s.input)}</pre></div><div><div class="cl">Output</div><pre>${esc(s.expected)}</pre></div></div></div>`).join('')}
      ${problem.tags.length ? `<div class="tags" style="margin-top:22px">${problem.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;

  async function subsHtml() {
    if (!me) return '<div class="empty">Log in to see your submissions.</div>';
    const { submissions } = await api('/submissions?slug=' + problem.slug);
    if (!submissions.length) return '<div class="empty">You have not submitted anything for this problem yet.</div>';
    return `<table class="t" style="margin:8px 0"><thead><tr><th>Verdict</th><th>Tests</th><th class="num">Time</th><th class="num">When</th></tr></thead><tbody>
      ${submissions.map((s) => `<tr><td><a href="#/submission/${s.id}">${vTag(s.verdict)}</a></td><td>${s.passed}/${s.total}</td>
      <td class="num">${s.runtimeMs ?? '—'} ms</td><td class="num muted">${ago(s.createdAt)}</td></tr>`).join('')}</tbody></table>`;
  }

  async function showLeft(tab) {
    $$('.tabs button[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'desc') {
      left.innerHTML = descHtml();
      $$('[data-copy]', left).forEach((b) => b.onclick = () => {
        navigator.clipboard?.writeText(problem.samples[b.dataset.copy].input).then(() => toast('Input copied'));
      });
    } else {
      left.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>';
      left.innerHTML = await subsHtml();
    }
  }
  $$('.tabs button[data-t]').forEach((b) => b.onclick = () => showLeft(b.dataset.t));
  showLeft('desc');

  /* console */
  let ctab = 'result';
  let last = null; // last result object
  let pick = 0;
  let customInput = store.get(`input:${problem.slug}`) ?? (problem.samples[0]?.input || '');
  const cb = $('#console-body');

  const resultView = () => {
    if (!last) return '<p class="muted">Run your code to try the examples, or submit it to judge against every test.</p>';
    if (last.pending) return `<div class="result-head"><span class="big"><span class="spinner"></span>${esc(last.msg || 'Judging…')}</span></div>`;
    const name = VERDICT_NAME[last.verdict] || last.verdict;
    let h = `<div class="result-head"><span class="big v-${last.verdict}">${esc(name)}</span>`;
    if (last.verdict !== 'CE') h += `<span class="muted">${last.passed}/${last.total} passed${last.runtimeMs != null ? ` · ${last.runtimeMs} ms` : ''}</span>`;
    h += '</div>';
    if (last.error) h += `<div class="kv"><div class="k">${last.verdict === 'CE' ? 'Compiler output' : 'Details'}</div><pre class="bad">${esc(last.error)}</pre></div>`;
    const rs = last.results || [];
    if (rs.length) {
      if (pick >= rs.length) pick = 0;
      h += `<div class="case-tabs">${rs.map((r, i) => `<button data-pick="${i}" class="${i === pick ? 'on' : ''}">${last.custom ? 'Output' : r.sample || last.isRun ? 'Case ' + r.n : 'Test ' + r.n}${vTag(r.verdict)}</button>`).join('')}</div>`;
      const r = rs[pick];
      if (r.input != null) h += `<div class="kv"><div class="k">Input</div><pre>${esc(r.input)}</pre></div>`;
      if (r.expected != null) h += `<div class="kv"><div class="k">Expected</div><pre>${esc(r.expected)}</pre></div>`;
      if (r.output != null) h += `<div class="kv"><div class="k">Your output</div><pre class="${r.verdict === 'WA' ? 'bad' : ''}">${esc(r.output) || '<span class="muted">(empty)</span>'}</pre></div>`;
      if (r.stderr) h += `<div class="kv"><div class="k">Error output</div><pre class="bad">${esc(r.stderr)}</pre></div>`;
      if (r.input == null && r.verdict !== 'AC') h += `<p class="muted" style="margin:0">Test ${r.n} is hidden. ${r.verdict === 'TLE' ? 'Your solution is too slow for the largest inputs.' : ''}</p>`;
      if (r.time != null) h += `<p class="muted" style="margin:6px 0 0;font-size:13px">${r.time} ms</p>`;
    }
    return h;
  };

  const drawConsole = () => {
    $$('.tabs button[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === ctab));
    if (ctab === 'custom') {
      cb.innerHTML = `<label class="lbl" for="ci">Standard input</label><textarea class="custom" id="ci" spellcheck="false"></textarea>
        <p class="muted" style="font-size:13px;margin:6px 0 0">Press Run to execute your program on this input and see its output.</p>`;
      const ci = $('#ci'); ci.value = customInput;
      ci.oninput = () => { customInput = ci.value; store.set(`input:${problem.slug}`, customInput); };
    } else {
      cb.innerHTML = resultView();
      $$('[data-pick]', cb).forEach((b) => b.onclick = () => { pick = +b.dataset.pick; drawConsole(); });
    }
  };
  $$('.tabs button[data-c]').forEach((b) => b.onclick = () => { ctab = b.dataset.c; drawConsole(); });
  drawConsole();

  const busy = (on) => { $('#run').disabled = on; $('#submit').disabled = on; };

  async function run() {
    const code = editor.get();
    const custom = ctab === 'custom';
    if (!custom) ctab = 'result';
    last = { pending: true, msg: custom ? 'Running…' : 'Running examples…' }; pick = 0; drawConsole(); busy(true);
    try {
      const r = await api('/run', { method: 'POST', body: { slug: problem.slug, code, ...(custom ? { input: customInput } : {}) } });
      last = { ...r, custom, isRun: true };
      if (custom) { ctab = 'result'; }
    } catch (e) { last = { verdict: 'IE', error: e.message, results: [], passed: 0, total: 0 }; }
    busy(false); drawConsole();
  }

  async function submit() {
    if (!me) { toast('Log in to submit'); location.hash = '#/login'; return; }
    ctab = 'result'; pick = 0;
    last = { pending: true, msg: 'Submitting…' }; drawConsole(); busy(true);
    try {
      const { id } = await api('/submit', { method: 'POST', body: { slug: problem.slug, code: editor.get() } });
      last = { pending: true, msg: 'Judging against all tests…' }; drawConsole();
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 500 : 900));
        if (!location.hash.includes(problem.slug)) return; // navigated away
        const { submission: s } = await api('/submissions/' + id);
        if (s.verdict !== 'Pending') {
          last = { verdict: s.verdict, passed: s.passed, total: s.total, runtimeMs: s.runtimeMs, results: s.results, error: s.error };
          if (s.verdict === 'AC') toast('Accepted');
          break;
        }
      }
    } catch (e) { last = { verdict: 'IE', error: e.message, results: [], passed: 0, total: 0 }; }
    busy(false); drawConsole();
    if ($('.tabs button[data-t="subs"]').classList.contains('on')) showLeft('subs');
  }
  $('#run').onclick = run;
  $('#submit').onclick = submit;
  $('#reset').onclick = () => { if (confirm('Replace your code with the starter template?')) editor.set(problem.starterCode); };

  /* resizable panes */
  const work = $('#work');
  const savedLeft = store.get('split-left');
  if (savedLeft) work.style.setProperty('--left', savedLeft);
  $('#split').addEventListener('pointerdown', (e) => {
    const sp = e.currentTarget; sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
    const move = (ev) => {
      const r = work.getBoundingClientRect();
      const pct = Math.min(70, Math.max(25, ((ev.clientX - r.left) / r.width) * 100));
      work.style.setProperty('--left', pct + '%');
    };
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); store.set('split-left', work.style.getPropertyValue('--left')); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  $('#vsplit').addEventListener('pointerdown', (e) => {
    const sp = e.currentTarget; sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
    const con = $('#console'); const panel = con.parentElement.getBoundingClientRect();
    const move = (ev) => { con.style.height = Math.min(panel.height - 180, Math.max(80, panel.bottom - ev.clientY)) + 'px'; };
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
}

/* ---------- submission detail ---------- */
async function submissionPage(id) {
  page('<p class="muted">Loading…</p>');
  let s;
  try { ({ submission: s } = await api('/submissions/' + id)); }
  catch (e) { if (e.status === 401) return location.hash = '#/login'; return page(`<h1>Not found</h1><p class="lede">${esc(e.message)}</p>`); }
  page(`
    <p class="muted" style="margin:0 0 8px"><a href="#/problem/${s.slug}" style="text-decoration:underline">${esc(s.title)}</a> · submission #${s.id} by ${esc(s.username)} · ${ago(s.createdAt)}</p>
    <h1 class="v-${s.verdict}">${esc(VERDICT_NAME[s.verdict] || s.verdict)}</h1>
    <p class="lede">${s.passed}/${s.total} tests passed${s.runtimeMs != null ? ` · slowest test ${s.runtimeMs} ms` : ''} · Java</p>
    ${s.error ? `<div class="kv" style="margin-top:14px"><div class="k">${s.verdict === 'CE' ? 'Compiler output' : 'Details'}</div><pre class="bad" style="margin:0;background:var(--sunk);padding:8px 10px;border-radius:3px;white-space:pre-wrap">${esc(s.error)}</pre></div>` : ''}
    <div class="code-view" id="cv"></div>
    <div class="row" style="margin-top:14px"><a class="btn" href="#/problem/${s.slug}" id="load">Open in editor</a><button class="btn" id="cp">Copy code</button></div>`, '');
  createEditor($('#cv'), { value: s.code, readOnly: true });
  $('#cp').onclick = () => navigator.clipboard?.writeText(s.code).then(() => toast('Code copied'));
  $('#load').onclick = () => store.set(`code:${s.slug}`, s.code);
}

async function submissionsPage() {
  if (!me) return location.hash = '#/login';
  page('<p class="muted">Loading…</p>');
  const { submissions } = await api('/submissions');
  page(`<h1>My submissions</h1><p class="lede">Your last 100 submissions.</p>
    ${submissions.length ? `<table class="t" style="margin-top:18px"><thead><tr><th>Problem</th><th>Verdict</th><th class="hide-s">Tests</th><th class="num hide-s">Time</th><th class="num">When</th></tr></thead><tbody>
    ${submissions.map((s) => `<tr><td><a class="title" href="#/problem/${s.slug}">${esc(s.title)}</a></td>
      <td><a href="#/submission/${s.id}">${vTag(s.verdict)}</a></td><td class="hide-s">${s.passed}/${s.total}</td>
      <td class="num hide-s">${s.runtimeMs ?? '—'} ms</td><td class="num muted">${ago(s.createdAt)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nothing here yet. <a href="#/" style="text-decoration:underline">Pick a problem</a>.</div>'}`);
}

/* ---------- leaderboard ---------- */
async function leaderboardPage() {
  page('<p class="muted">Loading…</p>');
  const { users } = await api('/leaderboard');
  page(`<h1>Leaderboard</h1><p class="lede">Ranked by problems solved, then by fewest submissions.</p>
    ${users.length ? `<table class="t" style="margin-top:18px"><thead><tr><th style="width:50px">#</th><th>User</th><th class="num">Solved</th><th class="num hide-s">Submissions</th><th class="num hide-s">Acceptance</th></tr></thead><tbody>
    ${users.map((u, i) => `<tr><td class="muted">${i + 1}</td><td><a class="title" href="#/u/${encodeURIComponent(u.username)}">${esc(u.username)}</a></td>
      <td class="num"><b>${u.solved}</b></td><td class="num hide-s">${u.submissions}</td>
      <td class="num hide-s">${u.submissions ? Math.round((100 * u.accepted) / u.submissions) : 0}%</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No submissions yet. Be the first.</div>'}`);
}

/* ---------- profile ---------- */
async function profilePage(name) {
  page('<p class="muted">Loading…</p>');
  let d;
  try { d = await api('/users/' + encodeURIComponent(name)); }
  catch (e) { return page(`<h1>Not found</h1><p class="lede">${esc(e.message)}</p>`); }
  const col = { Easy: 'var(--easy)', Medium: 'var(--medium)', Hard: 'var(--hard)' };
  page(`<h1>${esc(d.user.username)}</h1>
    <p class="lede">Joined ${new Date(d.user.joined.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}${d.user.role === 'admin' ? ' · admin' : ''}</p>
    <div class="stat-line">
      <div><b>${Object.values(d.solved).reduce((a, b) => a + b, 0)}</b>solved</div>
      <div><b>${d.stats.submissions}</b>submissions</div>
      <div><b>${d.stats.submissions ? Math.round((100 * d.stats.accepted) / d.stats.submissions) : 0}%</b>acceptance</div>
    </div>
    <div class="bars">${['Easy', 'Medium', 'Hard'].map((k) => {
      const n = d.solved[k] || 0; const t = d.totals[k] || 0;
      return `<div class="bar"><div class="bl"><span class="diff-${k} diff">${k}</span><span>${n} / ${t}</span></div><div class="track"><div class="fill" style="width:${t ? (100 * n) / t : 0}%;background:${col[k]}"></div></div></div>`;
    }).join('')}</div>
    <h2 class="sec-title">Recent submissions</h2>
    ${d.recent.length ? `<table class="t"><tbody>${d.recent.map((s) => `<tr><td><a class="title" href="#/problem/${s.slug}">${esc(s.title)}</a></td><td>${vTag(s.verdict)}</td><td class="num muted">${ago(s.created_at)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No submissions yet.</p>'}`);
}

/* ---------- login / register ---------- */
function authPage(mode) {
  const reg = mode === 'register';
  page(`<h1>${reg ? 'Create an account' : 'Log in'}</h1>
    <p class="lede">${reg ? 'Pick a username to track your solved problems.' : 'Welcome back.'}</p>
    <form id="f" class="form-grid" style="margin-top:22px" autocomplete="on">
      ${reg ? '<div><label class="lbl" for="em">Email</label><input type="text" id="em" name="email" autocomplete="email" inputmode="email" required></div>' : ''}
      <div><label class="lbl" for="u">${reg ? 'Username' : 'Email or username'}</label><input type="text" id="u" name="username" autocomplete="username" required></div>
      <div><label class="lbl" for="p">Password</label><input type="password" id="p" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></div>
      ${reg ? '<p class="muted" style="margin:-4px 0 0;font-size:13px">At least 8 characters, with a letter and a number.</p>' : ''}
      <button class="btn primary" style="padding:9px">${reg ? 'Sign up' : 'Log in'}</button>
      <div id="g-btn" style="display:flex;justify-content:center"></div>
      <div class="err" id="err"></div>
    </form>
    <p class="muted">${reg ? 'Already have an account? <a href="#/login" style="text-decoration:underline">Log in</a>' : 'New here? <a href="#/register" style="text-decoration:underline">Create an account</a>'}</p>`, 'narrow');
  (reg ? $('#em') : $('#u')).focus();
  mountGoogle($('#g-btn'));
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    try {
      const { user } = await api(`/auth/${reg ? 'register' : 'login'}`, { method: 'POST', body: { username: $('#u').value.trim(), ...(reg ? { email: $('#em').value.trim() } : {}), password: $('#p').value } });
      me = user; renderChrome(); location.hash = reg ? '#/dashboard' : '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

/* ---------- admin ---------- */
async function adminListPage() {
  if (!me || me.role !== 'admin') return page('<h1>Admins only</h1>');
  page('<p class="muted">Loading…</p>');
  const { problems } = await api('/problems');
  page(`<div class="row spread"><div><h1>Manage problems</h1><p class="lede">Add problems and test cases, or edit existing ones.</p></div><a class="btn primary" href="#/admin/new">New problem</a></div>
    <table class="t" style="margin-top:22px"><thead><tr><th>Title</th><th>Difficulty</th><th class="num">Submissions</th><th></th></tr></thead><tbody>
    ${problems.map((p) => `<tr><td><a class="title" href="#/problem/${p.slug}">${esc(p.title)}</a><div class="muted" style="font-size:12px">${esc(p.slug)}</div></td>
      <td><span class="diff diff-${p.difficulty}">${p.difficulty}</span></td><td class="num">${p.total}</td>
      <td class="num"><a class="btn sm" href="#/admin/edit/${p.slug}">Edit</a> <button class="btn sm danger" data-del="${p.slug}">Delete</button></td></tr>`).join('')}</tbody></table>`);
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Delete "${b.dataset.del}" and all its submissions?`)) return;
    try { await api('/admin/problems/' + b.dataset.del, { method: 'DELETE' }); toast('Deleted'); adminListPage(); } catch (e) { toast(e.message); }
  });
}

async function adminFormPage(slug) {
  if (!me || me.role !== 'admin') return page('<h1>Admins only</h1>');
  let p = { slug: '', title: '', difficulty: 'Easy', tags: '', statement: '### Input\n\n\n### Output\n\n\n### Constraints\n\n- ', timeLimitMs: 1000, memoryMb: 256, starterCode: '', tests: [{ input: '', expected: '', sample: true }] };
  if (slug) {
    try { ({ problem: p } = await api('/admin/problems/' + slug)); } catch (e) { return page(`<h1>Not found</h1><p>${esc(e.message)}</p>`); }
  }
  const tests = p.tests.map((t) => ({ ...t }));
  page(`<h1>${slug ? 'Edit problem' : 'New problem'}</h1>
    <p class="lede">Statements support <code>**bold**</code>, <code>*italic*</code>, <code>\`code\`</code>, <code>- lists</code> and <code>### headings</code>. Sample tests are shown to everyone; the rest stay hidden.</p>
    <form id="f" class="form-grid" style="margin-top:22px">
      <div class="two"><div><label class="lbl" for="title">Title</label><input type="text" id="title"></div>
      <div><label class="lbl" for="slug">URL slug</label><input type="text" id="slug" placeholder="two-sum"></div></div>
      <div class="three"><div><label class="lbl" for="diff">Difficulty</label><select id="diff"><option>Easy</option><option>Medium</option><option>Hard</option></select></div>
      <div><label class="lbl" for="tl">Time limit (ms)</label><input type="number" id="tl"></div>
      <div><label class="lbl" for="mem">Memory (MB)</label><input type="number" id="mem"></div></div>
      <div><label class="lbl" for="tags">Tags (comma separated)</label><input type="text" id="tags"></div>
      <div><label class="lbl" for="st">Statement</label><textarea class="field" id="st" rows="14" style="font-family:var(--mono);font-size:13px"></textarea></div>
      <div><label class="lbl" for="sc">Starter code (blank = default template)</label><textarea class="field" id="sc" rows="6" style="font-family:var(--mono);font-size:13px"></textarea></div>
      <div><div class="row spread"><label class="lbl" style="margin:0">Test cases</label><button type="button" class="btn sm" id="add">Add test</button></div><div id="tests" style="margin-top:8px"></div></div>
      <div class="row"><button class="btn primary">${slug ? 'Save changes' : 'Create problem'}</button><a class="btn ghost" href="#/admin">Cancel</a></div>
      <div class="err" id="err"></div>
    </form>`);
  $('#title').value = p.title; $('#slug').value = p.slug; $('#diff').value = p.difficulty; $('#tl').value = p.timeLimitMs;
  $('#mem').value = p.memoryMb; $('#tags').value = p.tags; $('#st').value = p.statement; $('#sc').value = slug ? p.starterCode : '';

  const drawTests = () => {
    $('#tests').innerHTML = tests.map((t, i) => `
      <div class="test-row"><div class="row spread"><b>Test ${i + 1}</b>
        <span class="row"><label class="row" style="font-size:13px;gap:5px"><input type="checkbox" data-s="${i}" ${t.sample ? 'checked' : ''}> sample</label>
        <button type="button" class="btn sm danger" data-rm="${i}">Remove</button></span></div>
        <div class="two"><div><label class="lbl">Input <span class="muted" style="font-weight:400">· <label style="text-decoration:underline;cursor:pointer">load file<input type="file" hidden data-f="input" data-i="${i}"></label></span></label><textarea class="field" data-k="input" data-i="${i}"></textarea></div>
        <div><label class="lbl">Expected output <span class="muted" style="font-weight:400">· <label style="text-decoration:underline;cursor:pointer">load file<input type="file" hidden data-f="expected" data-i="${i}"></label></span></label><textarea class="field" data-k="expected" data-i="${i}"></textarea></div></div></div>`).join('');
    $$('#tests textarea').forEach((ta) => { ta.value = tests[ta.dataset.i][ta.dataset.k]; ta.oninput = () => { tests[ta.dataset.i][ta.dataset.k] = ta.value; }; });
    $$('#tests [data-s]').forEach((c) => c.onchange = () => { tests[c.dataset.s].sample = c.checked; });
    $$('#tests [data-rm]').forEach((b) => b.onclick = () => { tests.splice(+b.dataset.rm, 1); drawTests(); });
    $$('#tests [data-f]').forEach((f) => f.onchange = async () => {
      const file = f.files[0]; if (!file) return;
      tests[f.dataset.i][f.dataset.f] = await file.text(); drawTests();
    });
  };
  drawTests();
  $('#add').onclick = () => { tests.push({ input: '', expected: '', sample: false }); drawTests(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); $('#err').textContent = '';
    const body = { title: $('#title').value, slug: $('#slug').value, difficulty: $('#diff').value, timeLimitMs: $('#tl').value, memoryMb: $('#mem').value, tags: $('#tags').value, statement: $('#st').value, starterCode: $('#sc').value, tests };
    try {
      await api(slug ? '/admin/problems/' + slug : '/admin/problems', { method: slug ? 'PUT' : 'POST', body });
      toast('Saved'); location.hash = '#/admin';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

/* ================================================================== */
/* career tools: dashboard, applications, practice log, skills, settings */
/* ================================================================== */
let META = { topics: [], platforms: [], difficulties: [], skillCategories: [], statuses: [], googleClientId: null };
const STATUS_LABEL = { wishlist: 'Wishlist', applied: 'Applied', oa: 'Online test', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tzNow = () => -new Date().getTimezoneOffset();
const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const needLogin = () => { toast('Log in first'); location.hash = '#/login'; };

/* ---------- modal form ---------- */
function fieldHtml(f, v) {
  const val = v ?? f.default ?? '';
  const id = `f_${f.key}`;
  const lab = f.type === 'checkbox' ? '' : `<label class="lbl" for="${id}">${esc(f.label)}</label>`;
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.key}">${f.options.map((o) => {
      const [value, text] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(value)}" ${String(value) === String(val) ? 'selected' : ''}>${esc(text)}</option>`;
    }).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea class="field" id="${id}" name="${f.key}" rows="3" maxlength="${f.max || 2000}">${esc(val)}</textarea>`;
  } else if (f.type === 'range') {
    input = `<div class="row"><input type="range" id="${id}" name="${f.key}" min="${f.min || 0}" max="${f.max || 100}" value="${esc(val)}" style="flex:1;accent-color:var(--accent)"><output class="muted" style="width:3ch;text-align:right">${esc(val)}</output></div>`;
  } else if (f.type === 'checkbox') {
    input = `<label class="row" style="gap:8px"><input type="checkbox" id="${id}" name="${f.key}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
  } else {
    input = `<input type="${f.type || 'text'}" id="${id}" name="${f.key}" value="${esc(val)}" ${f.required ? 'required' : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
  }
  return `<div>${lab}${input}</div>`;
}

function openForm({ title, rows, values = {}, submitLabel = 'Save', onSave, onDelete }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  const body = rows.map((r) => (Array.isArray(r)
    ? `<div class="${r.length === 3 ? 'three' : 'two'}">${r.map((f) => fieldHtml(f, values[f.key])).join('')}</div>`
    : fieldHtml(r, values[r.key]))).join('');
  dlg.innerHTML = `<form class="form-grid"><h2>${esc(title)}</h2>${body}<div class="err" data-err></div>
    <div class="row spread"><span>${onDelete ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}</span>
    <span class="row"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">${esc(submitLabel)}</button></span></div></form>`;
  document.body.appendChild(dlg);
  const form = $('form', dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  $$('input[type=range]', dlg).forEach((r) => r.addEventListener('input', () => { r.parentElement.querySelector('output').textContent = r.value; }));
  $('[data-cancel]', dlg).onclick = close;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  if (onDelete) $('[data-del]', dlg).onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    try { await onDelete(); close(); } catch (e) { $('[data-err]', dlg).textContent = e.message; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    rows.flat().forEach((f) => {
      const el = form.elements[f.key];
      out[f.key] = f.type === 'checkbox' ? el.checked : f.type === 'number' || f.type === 'range' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    });
    try { await onSave(out); close(); } catch (err) { $('[data-err]', dlg).textContent = err.message; }
  };
  dlg.showModal();
  const first = $('input:not([type=checkbox]), select', dlg); if (first) first.focus();
}

/* ---------- small chart pieces (plain CSS, one accent colour) ---------- */
const barRow = (label, value, max, extra = '', color = 'var(--accent)') =>
  `<div class="bar"><div class="bl"><span>${esc(label)}</span><span class="muted">${extra || value}</span></div>
   <div class="track"><div class="fill" style="width:${max ? Math.min(100, (100 * value) / max) : 0}%;background:${color}"></div></div></div>`;

function heatmapHtml(days) {
  const first = new Date(days[0].date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  const pad = Array.from({ length: first }, () => '<i class="hm pad"></i>').join('');
  const cells = days.map((d) => `<i class="hm l${Math.min(d.count, 4)}" title="${esc(d.date)}: ${d.count} ${d.count === 1 ? 'item' : 'items'}"></i>`).join('');
  return `<div class="heat" aria-label="Activity over the last 12 weeks">${pad}${cells}</div>
    <div class="heat-key muted">Less <i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l4"></i> More</div>`;
}

function diffStack(byDifficulty) {
  const total = (byDifficulty.easy || 0) + (byDifficulty.medium || 0) + (byDifficulty.hard || 0);
  if (!total) return '<p class="muted" style="margin:0">Nothing solved yet.</p>';
  const col = { easy: 'var(--easy)', medium: 'var(--medium)', hard: 'var(--hard)' };
  return `<div class="stack">${['easy', 'medium', 'hard'].map((k) => byDifficulty[k] ? `<span style="flex:${byDifficulty[k]};background:${col[k]}" title="${cap(k)} ${byDifficulty[k]}"></span>` : '').join('')}</div>
    <div class="legend">${['easy', 'medium', 'hard'].map((k) => `<span><i style="background:${col[k]}"></i>${cap(k)} <b>${byDifficulty[k] || 0}</b></span>`).join('')}</div>`;
}

function readinessCard(r) {
  const moves = [...r.breakdown].filter((b) => b.max - b.points >= 1).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, 3);
  return `<div class="card">
    <div class="row spread" style="align-items:flex-end"><div><div class="k-label">Placement readiness</div>
    <div class="score"><b>${r.score}</b><span class="muted"> / 100</span></div></div><span class="level">${esc(r.level)}</span></div>
    <div class="bars" style="margin:14px 0 0;gap:9px">${r.breakdown.map((b) => barRow(b.label, b.points, b.max, `${b.points} / ${b.max}`)).join('')}</div>
    ${moves.length ? `<div class="moves"><div class="k-label">Next best moves</div><ul>${moves.map((b) => `<li><b>${esc(b.label)}</b> (+${Math.round(b.max - b.points)} possible): ${esc(b.tip)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

/* ---------- dashboard ---------- */
async function dashboardPage() {
  if (!me) return needLogin();
  page('<p class="muted">Loading…</p>', 'wide');
  const { summary: s } = await api('/dashboard?tz=' + tzNow());
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const funnel = ['wishlist', 'applied', 'oa', 'interview', 'offer', 'rejected'];
  const maxF = Math.max(1, ...funnel.map((k) => s.pipeline.byStatus[k] || 0));
  const topicMax = Math.max(1, ...s.dsa.byTopic.map((t) => t.count));
  const dueClass = (d) => (d < 0 ? 'bad' : d <= 3 ? 'warn' : '');
  const dueText = (d) => (d < 0 ? `overdue ${-d}d` : d === 0 ? 'today' : `in ${d}d`);

  page(`
    <div class="row spread"><div><h1>${greet}, ${esc(me.name.split(' ')[0])}</h1>
      <p class="lede">${s.dsa.streak.current ? `You are on a <b>${s.dsa.streak.current}-day</b> streak.` : 'No active streak yet. Solve one problem today to start one.'}</p></div>
      <a class="btn primary" href="#/">Solve a problem</a></div>

    <div class="stat-line">
      <div><b>${s.dsa.total}</b>problems solved<span class="sub">${s.dsa.onDevora} on Devora, ${s.dsa.logged} logged</span></div>
      <div><b>${s.dsa.streak.current}</b>day streak<span class="sub">best ${s.dsa.streak.longest}</span></div>
      <div><b>${s.pipeline.submitted}</b>applications sent</div>
      <div><b>${s.pipeline.reached}</b>reached test or interview</div>
      <div><b>${s.pipeline.offers}</b>offers</div>
    </div>

    <div class="grid2">
      ${readinessCard(s.readiness)}
      <div class="card"><div class="row spread"><div class="k-label">Upcoming deadlines</div><a href="#/applications" class="muted" style="font-size:13px;text-decoration:underline">Board</a></div>
        ${s.upcoming.length ? `<ul class="plain">${s.upcoming.map((a) => `<li><div><b>${esc(a.company)}</b><div class="muted" style="font-size:13px">${esc(a.role)} · ${STATUS_LABEL[a.status]}</div></div>
          <div style="text-align:right"><div>${fmtDate(a.deadline)}</div><div class="due ${dueClass(a.daysLeft)}">${dueText(a.daysLeft)}</div></div></li>`).join('')}</ul>`
          : '<p class="muted">No open deadlines. Add one to an application and it shows up here.</p>'}
      </div>
    </div>

    <div class="grid2">
      <div class="card"><div class="k-label">Activity, last 12 weeks</div>${heatmapHtml(s.dsa.heatmap)}
        <p class="muted" style="margin:10px 0 0;font-size:13px">${s.dsa.solvedThisWeek} solved this week · ${s.dsa.streak.activeDays} active days in total</p></div>
      <div class="card"><div class="k-label">Difficulty</div>${diffStack(s.dsa.byDifficulty)}
        ${s.dsa.revisit ? `<p class="muted" style="margin:12px 0 0;font-size:13px">${s.dsa.revisit} logged problem(s) marked for revisit</p>` : ''}</div>
    </div>

    <div class="grid2">
      <div class="card"><div class="k-label">Topics you practise most</div>
        ${s.dsa.byTopic.length ? `<div class="bars" style="margin:12px 0 0;gap:9px">${s.dsa.byTopic.map((t) => barRow(t.topic, t.count, topicMax)).join('')}</div>` : '<p class="muted">Solve or log a problem to see your topics.</p>'}</div>
      <div class="card"><div class="k-label">Application funnel</div>
        <div class="bars" style="margin:12px 0 0;gap:9px">${funnel.map((k) => barRow(STATUS_LABEL[k], s.pipeline.byStatus[k] || 0, maxF, '', k === 'offer' ? 'var(--ok)' : k === 'rejected' ? 'var(--bad)' : 'var(--accent)')).join('')}</div></div>
    </div>

    <div class="card"><div class="row spread"><div class="k-label">Skills against targets</div><a href="#/skills" class="muted" style="font-size:13px;text-decoration:underline">Manage skills</a></div>
      ${s.skills.length ? `<div class="skills-grid">${s.skills.slice(0, 8).map(skillBar).join('')}</div>` : '<p class="muted">Add the skills you are building to track them against a target level.</p>'}</div>`, 'wide');
}

const skillBar = (k) => `<div class="skill"><div class="bl"><span>${esc(k.name)}</span><span class="muted">${k.level}% / target ${k.target}%</span></div>
  <div class="track"><div class="fill" style="width:${k.level}%;background:var(--accent)"></div><i class="tick" style="left:${k.target}%"></i></div></div>`;

/* ---------- applications (kanban) ---------- */
async function applicationsPage() {
  if (!me) return needLogin();
  page('<p class="muted">Loading…</p>', 'wide');
  let { items } = await api('/applications');
  const statuses = META.statuses;

  const fields = [
    [{ key: 'company', label: 'Company', required: true, max: 100 }, { key: 'role', label: 'Role', required: true, max: 100 }],
    [{ key: 'status', label: 'Stage', type: 'select', options: statuses.map((s) => [s, STATUS_LABEL[s]]) }, { key: 'packageLpa', label: 'Package (LPA)', type: 'number', step: 'any' }],
    [{ key: 'deadline', label: 'Deadline', type: 'date' }, { key: 'appliedOn', label: 'Applied on', type: 'date' }],
    { key: 'location', label: 'Location', max: 100 },
    { key: 'link', label: 'Job link', type: 'url', placeholder: 'https://', max: 500 },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const edit = (a) => openForm({
    title: a ? `${a.company}` : 'New application', rows: fields, values: a || { status: 'wishlist' }, submitLabel: a ? 'Save' : 'Add',
    onSave: async (v) => { await api(a ? `/applications/${a.id}` : '/applications', { method: a ? 'PUT' : 'POST', body: v }); applicationsPage(); },
    onDelete: a ? async () => { await api(`/applications/${a.id}`, { method: 'DELETE' }); applicationsPage(); } : null,
  });

  const card = (a) => {
    const days = a.deadline ? Math.ceil((new Date(a.deadline + 'T00:00:00') - new Date()) / 86400000) : null;
    return `<article class="kcard" draggable="true" data-id="${a.id}" tabindex="0">
      <b>${esc(a.company)}</b><div class="muted">${esc(a.role)}</div>
      <div class="kmeta">${a.packageLpa != null ? `<span>${a.packageLpa} LPA</span>` : ''}${a.deadline ? `<span class="${days < 0 && !['offer', 'rejected'].includes(a.status) ? 'bad' : ''}">${fmtDate(a.deadline)}</span>` : ''}</div></article>`;
  };

  const draw = () => {
    $('#board').innerHTML = statuses.map((st) => {
      const list = items.filter((a) => a.status === st);
      return `<section class="kcol" data-status="${st}"><header><span>${STATUS_LABEL[st]}</span><span class="muted">${list.length}</span></header>
        <div class="kbody">${list.map(card).join('') || '<div class="kempty">Drop here</div>'}</div></section>`;
    }).join('');
    $$('.kcard').forEach((el) => {
      const a = items.find((x) => x.id === +el.dataset.id);
      el.onclick = () => edit(a);
      el.onkeydown = (e) => { if (e.key === 'Enter') edit(a); };
      el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); };
      el.ondragend = () => el.classList.remove('dragging');
    });
    $$('.kcol').forEach((col) => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = () => col.classList.remove('over');
      col.ondrop = async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const a = items.find((x) => x.id === +e.dataTransfer.getData('text/plain'));
        if (!a || a.status === col.dataset.status) return;
        const before = a.status;
        a.status = col.dataset.status; draw();
        try { await api(`/applications/${a.id}`, { method: 'PUT', body: { status: a.status } }); }
        catch (err) { a.status = before; draw(); toast(err.message); }
      };
    });
  };

  page(`<div class="row spread"><div><h1>Applications</h1><p class="lede">Drag a card to move it through the stages. Click a card to edit it.</p></div>
    <span class="row"><a class="btn" href="/api/export/applications.csv">Export CSV</a><button class="btn primary" id="add">Add application</button></span></div>
    <div class="board" id="board" style="margin-top:22px"></div>`, 'wide');
  $('#add').onclick = () => edit(null);
  draw();
}

/* ---------- practice log ---------- */
async function practicePage() {
  if (!me) return needLogin();
  page('<p class="muted">Loading…</p>', 'wide');
  const { items } = await api('/practice');
  const fields = [
    { key: 'title', label: 'Problem title', required: true, max: 160 },
    [{ key: 'platform', label: 'Platform', type: 'select', options: META.platforms }, { key: 'difficulty', label: 'Difficulty', type: 'select', options: META.difficulties.map((d) => [d, cap(d)]) }],
    [{ key: 'topic', label: 'Topic', type: 'select', options: META.topics }, { key: 'timeMinutes', label: 'Minutes taken', type: 'number' }],
    [{ key: 'solvedOn', label: 'Solved on', type: 'date' }, { key: 'link', label: 'Link', type: 'url', placeholder: 'https://', max: 500 }],
    { key: 'revisit', label: 'Mark for revisit', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const toBody = (v) => {
    const today = new Date().toLocaleDateString('en-CA');
    return { ...v, solvedOn: !v.solvedOn || v.solvedOn === today ? new Date().toISOString() : `${v.solvedOn}T12:00:00Z` };
  };
  const edit = (p) => openForm({
    title: p ? 'Edit entry' : 'Log a problem', rows: fields,
    values: p ? { ...p, solvedOn: p.solvedOn.slice(0, 10) } : { solvedOn: new Date().toLocaleDateString('en-CA'), difficulty: 'easy' },
    onSave: async (v) => { await api(p ? `/practice/${p.id}` : '/practice', { method: p ? 'PUT' : 'POST', body: toBody(v) }); practicePage(); },
    onDelete: p ? async () => { await api(`/practice/${p.id}`, { method: 'DELETE' }); practicePage(); } : null,
  });

  page(`<div class="row spread"><div><h1>Practice log</h1><p class="lede">Problems you solved on other sites. They count towards your streak and readiness score along with everything you solve on Devora.</p></div>
    <span class="row"><a class="btn" href="/api/export/practice.csv">Export CSV</a><button class="btn primary" id="add">Log a problem</button></span></div>
    <div class="filters" style="margin-top:22px"><input type="text" id="q" placeholder="Search title or topic" aria-label="Search">
      <select id="fd" aria-label="Difficulty"><option value="">Any difficulty</option>${META.difficulties.map((d) => `<option value="${d}">${cap(d)}</option>`).join('')}</select>
      <select id="ft" aria-label="Topic"><option value="">Any topic</option>${META.topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
    <table class="t"><thead><tr><th>Date</th><th>Problem</th><th class="hide-s">Platform</th><th class="hide-s">Topic</th><th>Level</th><th class="num hide-s">Time</th></tr></thead><tbody id="rows"></tbody></table>
    <div class="empty" id="none" hidden></div>`, 'wide');
  $('#add').onclick = () => edit(null);
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(); const d = $('#fd').value; const t = $('#ft').value;
    const list = items.filter((p) => (!d || p.difficulty === d) && (!t || p.topic === t) && (!q || p.title.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q)));
    $('#rows').innerHTML = list.map((p) => `<tr class="click" data-id="${p.id}"><td class="muted">${fmtDate(p.solvedOn)}</td>
      <td><b>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="text-decoration:underline;text-underline-offset:3px">${esc(p.title)}</a>` : esc(p.title)}</b>${p.revisit ? ' <span class="tag">revisit</span>' : ''}</td>
      <td class="hide-s">${esc(p.platform)}</td><td class="hide-s">${esc(p.topic)}</td><td><span class="diff diff-${cap(p.difficulty)}">${cap(p.difficulty)}</span></td>
      <td class="num hide-s">${p.timeMinutes != null ? p.timeMinutes + ' min' : ''}</td></tr>`).join('');
    const none = $('#none'); none.hidden = list.length > 0;
    none.textContent = items.length ? 'No entries match.' : 'Nothing logged yet. Add problems you solved on LeetCode, Codeforces and similar sites.';
    $$('#rows tr').forEach((tr) => { tr.onclick = () => edit(items.find((x) => x.id === +tr.dataset.id)); });
  };
  ['input', 'change'].forEach((ev) => ['#q', '#fd', '#ft'].forEach((s) => $(s).addEventListener(ev, draw)));
  draw();
}

/* ---------- skills ---------- */
async function skillsPage() {
  if (!me) return needLogin();
  page('<p class="muted">Loading…</p>');
  const { items } = await api('/skills');
  const fields = [
    { key: 'name', label: 'Skill', required: true, max: 60, placeholder: 'e.g. Java, SQL, AWS' },
    { key: 'category', label: 'Category', type: 'select', options: META.skillCategories },
    { key: 'level', label: 'Current level (%)', type: 'range', min: 0, max: 100, default: 30 },
    { key: 'target', label: 'Target level (%)', type: 'range', min: 1, max: 100, default: 80 },
    { key: 'notes', label: 'Notes', type: 'textarea', max: 500 },
  ];
  const edit = (k) => openForm({
    title: k ? `Edit ${k.name}` : 'Add a skill', rows: fields, values: k || {}, submitLabel: k ? 'Save' : 'Add',
    onSave: async (v) => { await api(k ? `/skills/${k.id}` : '/skills', { method: k ? 'PUT' : 'POST', body: v }); skillsPage(); },
    onDelete: k ? async () => { await api(`/skills/${k.id}`, { method: 'DELETE' }); skillsPage(); } : null,
  });
  const cats = [...new Set(items.map((k) => k.category))];
  page(`<div class="row spread"><div><h1>Skills</h1><p class="lede">The line on each bar is your target. Closing the gap raises your readiness score.</p></div>
    <button class="btn primary" id="add">Add skill</button></div>
    ${items.length ? cats.map((c) => `<h2 class="sec-title">${esc(c)}</h2><div class="card" style="padding:6px 18px">${items.filter((k) => k.category === c).map((k) =>
      `<div class="skill-row" data-id="${k.id}" tabindex="0">${skillBar(k)}</div>`).join('')}</div>`).join('')
      : '<div class="empty">No skills yet. Add the technologies you want to be strong in for interviews.</div>'}`);
  $('#add').onclick = () => edit(null);
  $$('.skill-row').forEach((r) => {
    const open = () => edit(items.find((k) => k.id === +r.dataset.id));
    r.onclick = open; r.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

/* ---------- settings ---------- */
async function settingsPage() {
  if (!me) return needLogin();
  const link = `${location.origin}/#/p/${me.slug}`;
  page(`<h1>Settings</h1><p class="lede">${esc(me.email || '')} · @${esc(me.username)}</p>
    <form id="f" class="form-grid card" style="margin-top:22px">
      <div class="two"><div><label class="lbl" for="name">Display name</label><input type="text" id="name" maxlength="80" required></div>
      <div><label class="lbl" for="college">College</label><input type="text" id="college" maxlength="120"></div></div>
      <div class="two"><div><label class="lbl" for="role">Target role</label><input type="text" id="role" maxlength="80" placeholder="Software Development Engineer"></div>
      <div><label class="lbl" for="tdate">Target date for offers</label><input type="date" id="tdate"></div></div>
      <label class="row" style="gap:8px"><input type="checkbox" id="pub"> Make my profile public</label>
      <p class="muted" style="margin:-6px 0 0;font-size:13px">A public profile shows your readiness score, solved counts, activity, skills and application counts. It never shows company names, notes or your email.</p>
      <div id="linkrow" class="row" hidden><input type="text" id="plink" readonly><button type="button" class="btn" id="copy">Copy link</button><a class="btn" href="#/p/${esc(me.slug)}">View</a></div>
      <div class="row"><button class="btn primary">Save changes</button></div><div class="err" id="err"></div>
    </form>
    <h2 class="sec-title">Your data</h2>
    <div class="row"><a class="btn" href="/api/export/applications.csv">Export applications (CSV)</a><a class="btn" href="/api/export/practice.csv">Export practice log (CSV)</a></div>`);
  $('#name').value = me.name; $('#college').value = me.college; $('#role').value = me.targetRole;
  $('#tdate').value = me.targetDate || ''; $('#pub').checked = me.isPublic; $('#plink').value = link;
  const sync = () => { $('#linkrow').hidden = !$('#pub').checked; };
  $('#pub').onchange = sync; sync();
  $('#copy').onclick = () => navigator.clipboard?.writeText(link).then(() => toast('Link copied'));
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); $('#err').textContent = '';
    try {
      ({ user: me } = await api('/profile', { method: 'PUT', body: { name: $('#name').value, college: $('#college').value, targetRole: $('#role').value, targetDate: $('#tdate').value, isPublic: $('#pub').checked } }));
      renderChrome(); toast('Saved');
    } catch (err) { $('#err').textContent = err.message; }
  };
}

/* ---------- public profile ---------- */
async function publicProfilePage(slug) {
  page('<p class="muted">Loading…</p>', 'wide');
  let p;
  try { ({ profile: p } = await api('/public/' + encodeURIComponent(slug))); }
  catch (e) { return page(`<h1>Profile not available</h1><p class="lede">${esc(e.message)}</p>`); }
  document.title = `${p.name} — Devora`;
  const topicMax = Math.max(1, ...p.dsa.byTopic.map((t) => t.count));
  page(`
    <p class="muted" style="margin:0 0 6px">Devora profile</p>
    <h1>${esc(p.name)}</h1>
    <p class="lede">${[p.targetRole, p.college].filter(Boolean).map(esc).join(' · ') || '@' + esc(p.username)}</p>
    <div class="stat-line">
      <div><b>${p.readiness.score}</b>readiness<span class="sub">${esc(p.readiness.level)}</span></div>
      <div><b>${p.dsa.total}</b>problems solved<span class="sub">${p.dsa.onDevora} on Devora</span></div>
      <div><b>${p.dsa.streak.longest}</b>longest streak</div>
      <div><b>${p.pipeline.submitted}</b>applications</div>
      <div><b>${p.pipeline.reached}</b>tests and interviews</div>
    </div>
    <div class="grid2">
      <div class="card"><div class="k-label">Activity, last 12 weeks</div>${heatmapHtml(p.dsa.heatmap)}</div>
      <div class="card"><div class="k-label">Difficulty</div>${diffStack(p.dsa.byDifficulty)}</div>
    </div>
    <div class="grid2">
      <div class="card"><div class="k-label">Topics</div>${p.dsa.byTopic.length ? `<div class="bars" style="margin:12px 0 0;gap:9px">${p.dsa.byTopic.map((t) => barRow(t.topic, t.count, topicMax)).join('')}</div>` : '<p class="muted">None yet.</p>'}</div>
      <div class="card"><div class="k-label">Solved on Devora</div>${p.judged.length ? `<ul class="plain">${p.judged.map((j) => `<li><a href="#/problem/${esc(j.slug)}">${esc(j.title)}</a><span class="diff diff-${esc(j.difficulty)}">${esc(j.difficulty)}</span></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}</div>
    </div>
    ${p.skills.length ? `<div class="card"><div class="k-label">Skills</div><div class="skills-grid">${p.skills.map(skillBar).join('')}</div></div>` : ''}`, 'wide');
}

/* ---------- Google sign-in button (only when the server has a client id) ---------- */
function mountGoogle(host) {
  if (!META.googleClientId || !host) return;
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: META.googleClientId,
      callback: async (resp) => {
        try {
          ({ user: me } = await api('/auth/google', { method: 'POST', body: { credential: resp.credential } }));
          renderChrome(); location.hash = '#/dashboard';
        } catch (e) { toast(e.message); }
      },
    });
    window.google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', text: 'continue_with', width: 340 });
  };
  if (window.google?.accounts) return init();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init;
  document.head.appendChild(s);
}

/* ================================================================== */
/* router                                                              */
/* ================================================================== */
async function route() {
  renderChrome();
  document.title = 'Devora — practice problems, judged in Java';
  const h = (location.hash || '#/').slice(1);
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return await problemsPage();
    const [a, b] = parts;
    if (a === 'problem' && b) return await problemPage(b);
    if (a === 'submission' && b) return await submissionPage(b);
    if (a === 'submissions') return await submissionsPage();
    if (a === 'leaderboard') return await leaderboardPage();
    if (a === 'u' && b) return await profilePage(b);
    if (a === 'dashboard') return await dashboardPage();
    if (a === 'applications') return await applicationsPage();
    if (a === 'practice') return await practicePage();
    if (a === 'skills') return await skillsPage();
    if (a === 'settings') return await settingsPage();
    if (a === 'p' && b) return await publicProfilePage(b);
    if (a === 'login') return authPage('login');
    if (a === 'register') return authPage('register');
    if (a === 'admin' && !b) return await adminListPage();
    if (a === 'admin' && b === 'new') return await adminFormPage();
    if (a === 'admin' && b === 'edit' && parts[2]) return await adminFormPage(parts[2]);
    page('<h1>Page not found</h1><p class="lede"><a href="#/" style="text-decoration:underline">Back to problems</a></p>');
  } catch (e) {
    page(`<h1>Something went wrong</h1><p class="lede">${esc(e.message)}</p>`);
  }
}

window.addEventListener('hashchange', route);
(async () => {
  try { META = await api('/meta'); } catch { /* keep defaults */ }
  try { ({ user: me } = await api('/me')); } catch { me = null; }
  route();
})();
})();
