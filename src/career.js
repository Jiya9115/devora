/**
 * Career tools: dashboard + readiness score, application board, skills roadmap,
 * practice log (problems solved on other sites), settings, CSV export, public profile.
 * Everything is scoped to the logged-in user; other people's ids simply 404.
 */
const express = require('express');
const { db } = require('./db');
const { requireAuth, publicUser } = require('./auth');
const { validate } = require('./validate');
const stats = require('./stats');
const { toCsv } = require('./csv');

const router = express.Router();

const TOPICS = ['Arrays', 'Strings', 'Linked List', 'Stack & Queue', 'Recursion', 'Sorting & Searching', 'Hashing',
  'Trees', 'Graphs', 'Dynamic Programming', 'Greedy', 'Backtracking', 'Heap', 'Math', 'SQL', 'OOP & CS Core', 'Other'];
const PLATFORMS = ['LeetCode', 'GeeksforGeeks', 'Codeforces', 'CodeChef', 'HackerRank', 'Other'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const SKILL_CATEGORIES = ['Language', 'Frontend', 'Backend', 'Database', 'Cloud & DevOps', 'CS Fundamentals', 'Tools', 'Soft Skills'];

const SCHEMAS = {
  applications: [
    { key: 'company', col: 'company', type: 'text', max: 100, required: true },
    { key: 'role', col: 'role', type: 'text', max: 100, required: true },
    { key: 'location', col: 'location', type: 'text', max: 100 },
    { key: 'packageLpa', col: 'package_lpa', type: 'num', min: 0, max: 1000, label: 'Package' },
    { key: 'status', col: 'status', type: 'enum', values: stats.STATUSES, fallback: 'wishlist' },
    { key: 'deadline', col: 'deadline', type: 'date' },
    { key: 'appliedOn', col: 'applied_on', type: 'date', label: 'Applied on' },
    { key: 'link', col: 'link', type: 'url', max: 500 },
    { key: 'notes', col: 'notes', type: 'text', max: 2000 },
  ],
  skills: [
    { key: 'name', col: 'name', type: 'text', max: 60, required: true },
    { key: 'category', col: 'category', type: 'enum', values: SKILL_CATEGORIES, fallback: 'Language' },
    { key: 'level', col: 'level', type: 'int', min: 0, max: 100, nullable: false, fallback: 0 },
    { key: 'target', col: 'target', type: 'int', min: 1, max: 100, nullable: false, fallback: 80 },
    { key: 'notes', col: 'notes', type: 'text', max: 500 },
  ],
  practice: [
    { key: 'title', col: 'title', type: 'text', max: 160, required: true },
    { key: 'platform', col: 'platform', type: 'enum', values: PLATFORMS, fallback: 'LeetCode' },
    { key: 'topic', col: 'topic', type: 'enum', values: TOPICS, fallback: 'Arrays' },
    { key: 'difficulty', col: 'difficulty', type: 'enum', values: DIFFICULTIES, fallback: 'easy' },
    { key: 'link', col: 'link', type: 'url', max: 500 },
    { key: 'timeMinutes', col: 'time_minutes', type: 'int', min: 0, max: 1440, label: 'Time' },
    { key: 'revisit', col: 'revisit', type: 'bool', fallback: 0 },
    { key: 'solvedOn', col: 'solved_on', type: 'datetime', fallback: () => new Date().toISOString(), label: 'Solved on' },
    { key: 'notes', col: 'notes', type: 'text', max: 2000 },
  ],
};

const camel = (c) => c.replace(/_([a-z])/g, (_, x) => x.toUpperCase());
const toJson = (table, row) => {
  const o = { id: row.id };
  for (const f of SCHEMAS[table]) {
    let v = row[f.col];
    if (f.type === 'bool') v = !!v;
    o[f.key] = v;
  }
  if (table === 'applications') o.history = JSON.parse(row.history || '[]');
  o.createdAt = row.created_at;
  return o;
};

/* ------------------------------------------------------------------ */
/* owner-scoped CRUD                                                   */
/* ------------------------------------------------------------------ */

function mountCrud(table, order) {
  const schema = SCHEMAS[table];
  const cols = schema.map((f) => f.col);

  router.get(`/${table}`, requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order} LIMIT 1000`).all(req.user.id);
    res.json({ items: rows.map((r) => toJson(table, r)) });
  });

  router.post(`/${table}`, requireAuth, (req, res) => {
    const { values, error } = validate(schema, req.body);
    if (error) return res.status(400).json({ error });
    if (table === 'applications') values.history = JSON.stringify([{ status: values.status, at: new Date().toISOString() }]);
    const keys = Object.keys(values);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO ${table} (user_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})`)
      .run(req.user.id, ...keys.map((k) => values[k]));
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(lastInsertRowid);
    res.status(201).json({ item: toJson(table, row) });
  });

  router.put(`/${table}/:id`, requireAuth, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const { values, error } = validate(schema, req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    if (table === 'applications' && values.status && values.status !== row.status) {
      const h = JSON.parse(row.history || '[]');
      h.push({ status: values.status, at: new Date().toISOString() });
      values.history = JSON.stringify(h);
    }
    const keys = Object.keys(values).filter((k) => cols.includes(k) || k === 'history');
    if (keys.length) {
      db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => values[k]), row.id);
    }
    res.json({ item: toJson(table, db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)) });
  });

  router.delete(`/${table}/:id`, requireAuth, (req, res) => {
    const r = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(Number(req.params.id), req.user.id);
    if (!r.changes) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  });
}

mountCrud('applications', "COALESCE(deadline, '9999') ASC, id DESC");
mountCrud('skills', 'level DESC, id ASC');
mountCrud('practice', 'solved_on DESC, id DESC');

router.get('/meta', (_req, res) => {
  res.json({
    topics: TOPICS, platforms: PLATFORMS, difficulties: DIFFICULTIES,
    skillCategories: SKILL_CATEGORIES, statuses: stats.STATUSES,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

const PROFILE = [
  { key: 'name', col: 'display_name', type: 'text', max: 80, required: true },
  { key: 'college', col: 'college', type: 'text', max: 120 },
  { key: 'targetRole', col: 'target_role', type: 'text', max: 80, label: 'Target role' },
  { key: 'targetDate', col: 'target_date', type: 'date', label: 'Target date' },
  { key: 'isPublic', col: 'is_public', type: 'bool', label: 'Public profile' },
];

router.put('/profile', requireAuth, (req, res) => {
  const { values, error } = validate(PROFILE, req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => values[k]), req.user.id);
  }
  const u = db.prepare(
    'SELECT id, username, role, email, display_name, college, target_role, target_date, is_public, slug FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json({ user: publicUser(u) });
});

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

const iso = (sqlTime) => `${sqlTime.replace(' ', 'T')}Z`; // SQLite datetime('now') is UTC

function buildSummary(user, tz = 0) {
  // problems solved on Devora itself: first accepted submission per problem
  const judged = db.prepare(`
    SELECT p.id, p.title, p.slug, p.difficulty, p.tags, MIN(s.created_at) AS first
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.verdict = 'AC' GROUP BY p.id ORDER BY first DESC`).all(user.id);
  const activity = db.prepare("SELECT created_at FROM submissions WHERE user_id = ? AND verdict = 'AC'").all(user.id)
    .map((r) => iso(r.created_at));
  const judgeStats = db.prepare(`
    SELECT COUNT(CASE WHEN verdict <> 'Pending' THEN 1 END) AS submissions FROM submissions WHERE user_id = ?`).get(user.id);

  const practice = db.prepare('SELECT difficulty, topic, solved_on, revisit FROM practice WHERE user_id = ?').all(user.id);
  const apps = db.prepare('SELECT id, company, role, status, deadline, history FROM applications WHERE user_id = ?').all(user.id)
    .map((a) => ({ ...a, history: JSON.parse(a.history || '[]') }));
  const skills = db.prepare('SELECT name, category, level, target FROM skills WHERE user_id = ? ORDER BY level DESC').all(user.id);

  const solves = [
    ...judged.map((j) => ({ difficulty: j.difficulty.toLowerCase(), topics: j.tags ? j.tags.split(',') : [] })),
    ...practice.map((p) => ({ difficulty: p.difficulty, topics: [p.topic] })),
  ];
  const dates = [...activity, ...practice.map((p) => p.solved_on)];
  const streak = stats.streaks(dates, tz);
  const diff = stats.countBy(solves, 'difficulty', DIFFICULTIES);
  const topicCounts = {};
  solves.forEach((s) => s.topics.forEach((t) => { topicCounts[t] = (topicCounts[t] || 0) + 1; }));
  const pipeline = stats.pipelineSummary(apps);
  const weekAgo = Date.now() - 7 * 86400000;

  return {
    dsa: {
      total: solves.length,
      onDevora: judged.length,
      logged: practice.length,
      byDifficulty: diff,
      byTopic: Object.entries(topicCounts).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      solvedThisWeek: judged.filter((j) => new Date(iso(j.first)).getTime() >= weekAgo).length +
        practice.filter((p) => new Date(p.solved_on).getTime() >= weekAgo).length,
      revisit: practice.filter((p) => p.revisit).length,
      streak,
      heatmap: stats.heatmap(dates, 84, tz),
      submissions: judgeStats.submissions,
    },
    judged: judged.map((j) => ({ slug: j.slug, title: j.title, difficulty: j.difficulty })),
    pipeline,
    skills,
    readiness: stats.readiness({
      easy: diff.easy, medium: diff.medium, hard: diff.hard, streak: streak.current, skills,
      submitted: pipeline.submitted, reached: pipeline.reached,
      targetRole: user.target_role, targetDate: user.target_date,
    }),
    upcoming: stats.upcomingDeadlines(apps).map((a) => ({
      id: a.id, company: a.company, role: a.role, status: a.status, deadline: a.deadline, daysLeft: a.daysLeft,
    })),
  };
}

const tzOf = (req) => {
  const n = parseInt(req.query.tz, 10);
  return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0;
};

router.get('/dashboard', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ summary: buildSummary(u, tzOf(req)) });
});

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function sendCsv(res, name, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${toCsv(columns, rows)}`);
}

router.get('/export/applications.csv', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id').all(req.user.id);
  sendCsv(res, 'applications.csv', [
    { key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'location', label: 'Location' },
    { key: 'package_lpa', label: 'Package (LPA)' }, { key: 'status', label: 'Status' }, { key: 'deadline', label: 'Deadline' },
    { key: 'applied_on', label: 'Applied on' }, { key: 'link', label: 'Link' }, { key: 'notes', label: 'Notes' },
  ], rows);
});

router.get('/export/practice.csv', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM practice WHERE user_id = ? ORDER BY solved_on DESC').all(req.user.id)
    .map((r) => ({ ...r, solved_on: r.solved_on.slice(0, 10), revisit: r.revisit ? 'yes' : '' }));
  sendCsv(res, 'practice-log.csv', [
    { key: 'title', label: 'Title' }, { key: 'platform', label: 'Platform' }, { key: 'topic', label: 'Topic' },
    { key: 'difficulty', label: 'Difficulty' }, { key: 'time_minutes', label: 'Minutes' }, { key: 'solved_on', label: 'Solved on' },
    { key: 'revisit', label: 'Revisit' }, { key: 'link', label: 'Link' }, { key: 'notes', label: 'Notes' },
  ], rows);
});

/* ------------------------------------------------------------------ */
/* public profile (opt-in)                                             */
/* ------------------------------------------------------------------ */

router.get('/public/:slug', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE slug = ? COLLATE NOCASE').get(req.params.slug);
  if (!u || !u.is_public) return res.status(404).json({ error: 'This profile is private or does not exist.' });
  const s = buildSummary(u, 330);
  // counts and skills only: no company names, notes or email
  res.json({
    profile: {
      name: u.display_name || u.username,
      username: u.username,
      college: u.college,
      targetRole: u.target_role,
      readiness: s.readiness,
      dsa: { total: s.dsa.total, onDevora: s.dsa.onDevora, byDifficulty: s.dsa.byDifficulty, byTopic: s.dsa.byTopic, streak: s.dsa.streak, heatmap: s.dsa.heatmap },
      judged: s.judged,
      pipeline: { submitted: s.pipeline.submitted, reached: s.pipeline.reached, offers: s.pipeline.offers },
      skills: s.skills,
    },
  });
});

module.exports = router;
