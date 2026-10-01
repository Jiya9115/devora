const express = require('express');
const { db, tx } = require('./db');
const cfg = require('./config');
const {
  hashPassword, verifyPassword, setSession, clearSession, publicUser,
  requireAuth, requireAdmin, rateLimit,
} = require('./auth');
const { judgeQueued } = require('./judge');
const { STARTER } = require('./seed');

const router = express.Router();

const byIp = (req) => req.ip;
const byUserOrIp = (req) => (req.user ? `u${req.user.id}` : req.ip);
const authLimiter = rateLimit({ limit: 15, windowMs: 60_000, key: byIp });
const runLimiter = rateLimit({ limit: 20, windowMs: 60_000, key: byUserOrIp });
const submitLimiter = rateLimit({ limit: 12, windowMs: 60_000, key: byUserOrIp });

const fullUser = (id) => publicUser(db.prepare(
  'SELECT id, username, role, email, display_name, college, target_role, target_date, is_public, slug FROM users WHERE id = ?'
).get(id));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

router.post('/auth/register', authLimiter, (req, res) => {
  const { username = '', email = '', password = '' } = req.body || {};
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or underscores.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120)
    return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 100 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: 'Password needs at least 8 characters, including a letter and a number.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
    return res.status(409).json({ error: 'That username is already taken.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with that email already exists.' });
  const { salt, hash } = hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, email, salt, hash, display_name, slug) VALUES (?,?,?,?,?,?)')
    .run(username, email.toLowerCase(), salt, hash, username, username.toLowerCase());
  setSession(req, res, Number(lastInsertRowid));
  res.json({ user: fullUser(Number(lastInsertRowid)) });
});

router.post('/auth/login', authLimiter, (req, res) => {
  // `username` may hold either the username or the email address.
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(String(username).trim(), String(username).trim());
  if (!u || !verifyPassword(String(password), u.salt, u.hash))
    return res.status(401).json({ error: 'Wrong username or password.' });
  setSession(req, res, u.id);
  res.json({ user: fullUser(u.id) });
});

// "Continue with Google": verifies the ID token server-side (only active when GOOGLE_CLIENT_ID is set)
router.post('/auth/google', authLimiter, wrap(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(400).json({ error: 'Google sign-in is not configured on this server.' });
  const credential = String((req.body || {}).credential || '');
  if (credential.length < 20) return res.status(400).json({ error: 'Missing Google credential.' });
  let payload;
  try {
    const { OAuth2Client } = require('google-auth-library');
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
  if (!payload.email || !payload.email_verified) return res.status(401).json({ error: 'Your Google email is not verified.' });
  const email = payload.email.toLowerCase();
  let u = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(payload.sub, email);
  if (u) {
    if (!u.google_id) db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(payload.sub, u.id);
  } else {
    const base = (email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 14) || 'user');
    let username = base.length >= 3 ? base : `${base}user`;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
    const { salt, hash } = hashPassword(require('crypto').randomBytes(24).toString('hex')); // unusable password
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (username, email, salt, hash, display_name, slug, google_id) VALUES (?,?,?,?,?,?,?)'
    ).run(username, email, salt, hash, payload.name || username, username.toLowerCase(), payload.sub);
    u = { id: Number(lastInsertRowid) };
  }
  setSession(req, res, u.id);
  res.json({ user: fullUser(u.id) });
}));

router.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

/* ------------------------------------------------------------------ */
/* problems                                                            */
/* ------------------------------------------------------------------ */

router.get('/problems', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
      (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.verdict <> 'Pending') AS total,
      (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.verdict = 'AC') AS accepted
    FROM problems p ORDER BY p.id`).all();

  const status = new Map();
  if (req.user) {
    for (const r of db
      .prepare(`SELECT problem_id, MAX(verdict = 'AC') AS solved FROM submissions
                WHERE user_id = ? AND verdict <> 'Pending' GROUP BY problem_id`)
      .all(req.user.id)) status.set(r.problem_id, r.solved ? 'solved' : 'attempted');
  }
  res.json({
    problems: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      difficulty: r.difficulty,
      tags: r.tags ? r.tags.split(',') : [],
      total: r.total,
      accepted: r.accepted,
      status: status.get(r.id) || null,
    })),
  });
});

function loadProblem(slug) {
  return db.prepare('SELECT * FROM problems WHERE slug = ?').get(slug);
}

router.get('/problems/:slug', (req, res) => {
  const p = loadProblem(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });
  const samples = db
    .prepare('SELECT input, expected FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY position')
    .all(p.id);
  const stats = db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(verdict = 'AC'),0) AS accepted
              FROM submissions WHERE problem_id = ? AND verdict <> 'Pending'`)
    .get(p.id);
  res.json({
    problem: {
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      tags: p.tags ? p.tags.split(',') : [],
      statement: p.statement,
      timeLimitMs: p.time_limit_ms,
      memoryMb: p.memory_mb,
      starterCode: p.starter_code,
      samples,
      total: stats.total,
      accepted: stats.accepted,
    },
  });
});

/* ------------------------------------------------------------------ */
/* run + submit                                                        */
/* ------------------------------------------------------------------ */

function checkCode(code) {
  if (typeof code !== 'string' || !code.trim()) return 'Write some code first.';
  if (Buffer.byteLength(code) > cfg.maxCodeBytes) return 'Code is too long (64 KB max).';
  return null;
}

// "Run": executes against the sample cases, or against custom input if supplied.
router.post('/run', runLimiter, wrap(async (req, res) => {
  const { slug, code, input } = req.body || {};
  const bad = checkCode(code);
  if (bad) return res.status(400).json({ error: bad });
  const p = loadProblem(slug);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });

  let tests;
  if (typeof input === 'string') {
    if (input.length > 100_000) return res.status(400).json({ error: 'Custom input is too large.' });
    tests = [{ input, expected: null, is_sample: 1 }];
  } else {
    tests = db
      .prepare('SELECT input, expected, is_sample FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY position')
      .all(p.id);
  }
  const out = await judgeQueued({
    code, tests, timeLimitMs: p.time_limit_ms, memoryMb: p.memory_mb, stopOnFail: false, revealAll: true,
  });
  res.json(out);
}));

router.post('/submit', requireAuth, submitLimiter, (req, res) => {
  const { slug, code } = req.body || {};
  const bad = checkCode(code);
  if (bad) return res.status(400).json({ error: bad });
  const p = loadProblem(slug);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });

  const total = db.prepare('SELECT COUNT(*) AS n FROM testcases WHERE problem_id = ?').get(p.id).n;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO submissions (user_id, problem_id, code, total) VALUES (?,?,?,?)')
    .run(req.user.id, p.id, code, total);
  const id = Number(lastInsertRowid);

  // Judge in the background; the client polls /submissions/:id.
  const tests = db
    .prepare('SELECT input, expected, is_sample FROM testcases WHERE problem_id = ? ORDER BY position')
    .all(p.id);
  judgeQueued({
    code, tests, timeLimitMs: p.time_limit_ms, memoryMb: p.memory_mb, stopOnFail: true, revealAll: false,
  }).then((r) => {
    db.prepare(
      'UPDATE submissions SET verdict=?, runtime_ms=?, passed=?, total=?, detail=? WHERE id=?'
    ).run(r.verdict, r.runtimeMs, r.passed, r.total, JSON.stringify({ error: r.error || null, results: r.results }), id);
  }).catch((e) => {
    db.prepare("UPDATE submissions SET verdict='IE', detail=? WHERE id=?")
      .run(JSON.stringify({ error: String(e.message), results: [] }), id);
  });

  res.status(202).json({ id });
});

/* ------------------------------------------------------------------ */
/* submissions                                                         */
/* ------------------------------------------------------------------ */

const subShape = (r, withCode) => {
  const d = r.detail ? JSON.parse(r.detail) : { error: null, results: [] };
  return {
    id: r.id,
    username: r.username,
    slug: r.slug,
    title: r.title,
    language: r.language,
    verdict: r.verdict,
    runtimeMs: r.runtime_ms,
    passed: r.passed,
    total: r.total,
    createdAt: r.created_at,
    ...(withCode ? { code: r.code, error: d.error, results: d.results } : {}),
  };
};

router.get('/submissions', requireAuth, (req, res) => {
  const { slug } = req.query;
  const rows = db.prepare(`
    SELECT s.*, u.username, p.slug, p.title FROM submissions s
    JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? ${slug ? 'AND p.slug = ?' : ''}
    ORDER BY s.id DESC LIMIT 100`).all(...(slug ? [req.user.id, slug] : [req.user.id]));
  res.json({ submissions: rows.map((r) => subShape(r, false)) });
});

router.get('/submissions/:id', requireAuth, (req, res) => {
  const r = db.prepare(`
    SELECT s.*, u.username, p.slug, p.title FROM submissions s
    JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id
    WHERE s.id = ?`).get(Number(req.params.id));
  if (!r || (r.user_id !== req.user.id && req.user.role !== 'admin'))
    return res.status(404).json({ error: 'Submission not found.' });
  res.json({ submission: subShape(r, true) });
});

/* ------------------------------------------------------------------ */
/* leaderboard + profile                                               */
/* ------------------------------------------------------------------ */

router.get('/leaderboard', (_req, res) => {
  const rows = db.prepare(`
    SELECT u.username,
      COUNT(DISTINCT CASE WHEN s.verdict = 'AC' THEN s.problem_id END) AS solved,
      COUNT(CASE WHEN s.verdict <> 'Pending' THEN 1 END) AS submissions,
      COALESCE(SUM(s.verdict = 'AC'), 0) AS accepted
    FROM users u LEFT JOIN submissions s ON s.user_id = u.id
    GROUP BY u.id HAVING submissions > 0
    ORDER BY solved DESC, submissions ASC, u.username LIMIT 100`).all();
  res.json({ users: rows });
});

router.get('/users/:username', (req, res) => {
  const u = db.prepare('SELECT id, username, role, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const solvedRows = db.prepare(`
    SELECT p.difficulty, COUNT(DISTINCT p.id) AS n FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.verdict = 'AC' GROUP BY p.difficulty`).all(u.id);
  const totals = db.prepare('SELECT difficulty, COUNT(*) AS n FROM problems GROUP BY difficulty').all();
  const stats = db.prepare(`
    SELECT COUNT(CASE WHEN verdict <> 'Pending' THEN 1 END) AS submissions,
           COALESCE(SUM(verdict = 'AC'), 0) AS accepted
    FROM submissions WHERE user_id = ?`).get(u.id);
  const recent = db.prepare(`
    SELECT s.id, s.verdict, s.runtime_ms, s.created_at, p.slug, p.title FROM submissions s
    JOIN problems p ON p.id = s.problem_id WHERE s.user_id = ? AND s.verdict <> 'Pending'
    ORDER BY s.id DESC LIMIT 10`).all(u.id);
  res.json({
    user: { username: u.username, role: u.role, joined: u.created_at },
    solved: Object.fromEntries(solvedRows.map((r) => [r.difficulty, r.n])),
    totals: Object.fromEntries(totals.map((r) => [r.difficulty, r.n])),
    stats,
    recent,
  });
});

/* ------------------------------------------------------------------ */
/* admin: manage problems                                              */
/* ------------------------------------------------------------------ */

function validateProblem(b) {
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') err('Invalid request.');
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) err('Slug may contain lowercase letters, numbers and dashes only.');
  const title = String(b.title || '').trim();
  if (!title) err('Title is required.');
  if (!['Easy', 'Medium', 'Hard'].includes(b.difficulty)) err('Pick a difficulty.');
  const statement = String(b.statement || '').trim();
  if (!statement) err('Statement is required.');
  const tl = parseInt(b.timeLimitMs, 10);
  const mem = parseInt(b.memoryMb, 10);
  if (!(tl >= 100 && tl <= 10000)) err('Time limit must be between 100 and 10000 ms.');
  if (!(mem >= 32 && mem <= 1024)) err('Memory limit must be between 32 and 1024 MB.');
  const tests = Array.isArray(b.tests) ? b.tests : [];
  if (!tests.length) err('Add at least one test case.');
  if (!tests.some((t) => t.sample)) err('Mark at least one test case as a sample.');
  for (const t of tests) {
    if (typeof t.input !== 'string' || typeof t.expected !== 'string') err('Every test needs input and expected output.');
  }
  const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).join(',');
  return {
    slug, title, difficulty: b.difficulty, tags, statement, tl, mem, tests,
    starter: String(b.starterCode || '').trim() ? String(b.starterCode) : STARTER,
  };
}

router.get('/admin/problems/:slug', requireAdmin, (req, res) => {
  const p = loadProblem(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });
  const tests = db
    .prepare('SELECT input, expected, is_sample FROM testcases WHERE problem_id = ? ORDER BY position')
    .all(p.id)
    .map((t) => ({ input: t.input, expected: t.expected, sample: !!t.is_sample }));
  res.json({
    problem: {
      slug: p.slug, title: p.title, difficulty: p.difficulty, tags: p.tags, statement: p.statement,
      timeLimitMs: p.time_limit_ms, memoryMb: p.memory_mb, starterCode: p.starter_code, tests,
    },
  });
});

function saveTests(problemId, tests) {
  db.prepare('DELETE FROM testcases WHERE problem_id = ?').run(problemId);
  const ins = db.prepare('INSERT INTO testcases (problem_id, position, input, expected, is_sample) VALUES (?,?,?,?,?)');
  tests.forEach((t, i) => ins.run(problemId, i, t.input, t.expected, t.sample ? 1 : 0));
}

router.post('/admin/problems', requireAdmin, (req, res) => {
  const v = validateProblem(req.body);
  if (loadProblem(v.slug)) return res.status(409).json({ error: 'A problem with that slug already exists.' });
  tx(() => {
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO problems (slug,title,difficulty,tags,statement,time_limit_ms,memory_mb,starter_code)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(v.slug, v.title, v.difficulty, v.tags, v.statement, v.tl, v.mem, v.starter);
    saveTests(Number(lastInsertRowid), v.tests);
  });
  res.status(201).json({ slug: v.slug });
});

router.put('/admin/problems/:slug', requireAdmin, (req, res) => {
  const old = loadProblem(req.params.slug);
  if (!old) return res.status(404).json({ error: 'Problem not found.' });
  const v = validateProblem(req.body);
  if (v.slug !== old.slug && loadProblem(v.slug))
    return res.status(409).json({ error: 'A problem with that slug already exists.' });
  tx(() => {
    db.prepare(
      `UPDATE problems SET slug=?, title=?, difficulty=?, tags=?, statement=?, time_limit_ms=?, memory_mb=?, starter_code=?
       WHERE id=?`
    ).run(v.slug, v.title, v.difficulty, v.tags, v.statement, v.tl, v.mem, v.starter, old.id);
    saveTests(old.id, v.tests);
  });
  res.json({ slug: v.slug });
});

router.delete('/admin/problems/:slug', requireAdmin, (req, res) => {
  const p = loadProblem(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });
  db.prepare('DELETE FROM problems WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */

router.use(require('./career'));

router.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = router;
