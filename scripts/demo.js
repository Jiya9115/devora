/**
 * Adds a demo account with a realistic history so a fresh install has something to look at.
 *   npm run demo        then log in with  demo@devora.dev / Demo@1234
 * Safe to run more than once (it replaces the demo account's data).
 */
const fs = require('fs');
const path = require('path');
const { db, tx } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { seedProblems } = require('../src/seed');

seedProblems();

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const DAY = 86400000;
const ago = (days, hour = 14) => new Date(Date.now() - days * DAY + (hour - 12) * 3600000);
const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const dateOnly = (d) => d.toISOString().slice(0, 10);

tx(() => {
  db.prepare("DELETE FROM users WHERE email = 'demo@devora.dev'").run();
  const { salt, hash } = hashPassword('Demo@1234');
  const uid = Number(db.prepare(`INSERT INTO users (username, email, salt, hash, display_name, college, target_role, target_date, is_public, slug)
    VALUES ('demo', 'demo@devora.dev', ?, ?, 'Demo Student', 'Government Engineering College', 'Software Development Engineer', ?, 1, 'demo')`)
    .run(salt, hash, dateOnly(new Date(Date.now() + 120 * DAY))).lastInsertRowid);

  // practice log: ~48 problems over 12 weeks
  const topics = ['Arrays', 'Strings', 'Hashing', 'Trees', 'Graphs', 'Dynamic Programming', 'Backtracking', 'Heap', 'Greedy', 'Stack & Queue'];
  const titles = ['Container With Most Water', 'Group Anagrams', 'Merge Intervals', 'Binary Tree Level Order', 'Course Schedule', 'Coin Change',
    'Subsets', 'Top K Frequent Elements', 'Jump Game', 'Daily Temperatures', 'Word Break', 'Number of Islands', 'Kth Largest Element',
    'Longest Palindromic Substring', '3Sum', 'Product of Array Except Self', 'Lowest Common Ancestor', 'Climbing Stairs', 'Permutations', 'LRU Cache'];
  const ins = db.prepare(`INSERT INTO practice (user_id, title, platform, topic, difficulty, time_minutes, revisit, solved_on, notes)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 48; i++) {
    const day = i < 9 ? i : Math.floor(rnd() * 84);       // recent streak + scattered older activity
    const diffRoll = rnd();
    ins.run(uid, `${pick(titles)}${i > 19 ? ` (${Math.ceil(i / 20)})` : ''}`, pick(['LeetCode', 'LeetCode', 'GeeksforGeeks', 'Codeforces']), pick(topics),
      diffRoll < 0.4 ? 'easy' : diffRoll < 0.85 ? 'medium' : 'hard', 15 + Math.floor(rnd() * 50), rnd() < 0.15 ? 1 : 0,
      ago(day, 9 + Math.floor(rnd() * 12)).toISOString(), '');
  }

  // applications
  const insApp = db.prepare(`INSERT INTO applications (user_id, company, role, location, package_lpa, status, deadline, applied_on, history)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const apps = [
    ['Atlassian', 'Graduate Engineer', 'Bengaluru', 28, 'wishlist', 21, null, ['wishlist']],
    ['Adobe', 'Computer Scientist', 'Noida', 24, 'wishlist', 18, null, ['wishlist']],
    ['Razorpay', 'Backend Engineer', 'Bengaluru', 20, 'applied', 15, 6, ['wishlist', 'applied']],
    ['Zoho', 'Member Technical Staff', 'Chennai', 9, 'applied', 12, 9, ['wishlist', 'applied']],
    ['Microsoft', 'SDE-1', 'Hyderabad', 44, 'oa', 9, 14, ['wishlist', 'applied', 'oa']],
    ['Google', 'SWE Intern', 'Bengaluru', 36, 'interview', 6, 20, ['wishlist', 'applied', 'oa', 'interview']],
    ['Infosys', 'Systems Engineer', 'Pune', 4.5, 'offer', null, 40, ['wishlist', 'applied', 'oa', 'interview', 'offer']],
    ['Flipkart', 'SDE-1', 'Bengaluru', 32, 'rejected', null, 30, ['wishlist', 'applied', 'rejected']],
  ];
  apps.forEach(([company, role, loc, lpa, status, dl, appliedDays, hist], i) => insApp.run(
    uid, company, role, loc, lpa, status, dl == null ? null : dateOnly(new Date(Date.now() + dl * DAY)),
    appliedDays == null ? null : dateOnly(ago(appliedDays)),
    JSON.stringify(hist.map((s, k) => ({ status: s, at: ago((appliedDays || 5) - k).toISOString() })))));

  // skills
  const insSkill = db.prepare('INSERT INTO skills (user_id, name, category, level, target) VALUES (?,?,?,?,?)');
  [['Java', 'Language', 78, 90], ['JavaScript', 'Language', 72, 85], ['Node.js and Express', 'Backend', 70, 85], ['React', 'Frontend', 55, 80],
    ['SQL', 'Database', 60, 85], ['MongoDB', 'Database', 55, 80], ['AWS', 'Cloud & DevOps', 40, 70], ['Docker', 'Cloud & DevOps', 35, 65]]
    .forEach((s) => insSkill.run(uid, ...s));

  // real accepted submissions on Devora, using the reference solutions from the test suite
  const refDir = path.join(__dirname, '..', 'tests', 'reference');
  const insSub = db.prepare(`INSERT INTO submissions (user_id, problem_id, code, verdict, runtime_ms, passed, total, detail, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const plan = [['two-sum', 5], ['valid-parentheses', 4], ['reverse-the-sentence', 3], ['maximum-subarray', 2], ['fast-fibonacci', 1], ['longest-increasing-subsequence', 0]];
  for (const [slug, d] of plan) {
    const p = db.prepare('SELECT id FROM problems WHERE slug = ?').get(slug);
    if (!p) continue;
    const total = db.prepare('SELECT COUNT(*) AS n FROM testcases WHERE problem_id = ?').get(p.id).n;
    const code = fs.readFileSync(path.join(refDir, `${slug}.java`), 'utf8');
    if (d % 2 === 1) insSub.run(uid, p.id, code.replace('System.out.println', 'System.err.println'), 'WA', 40, 0, total, '{"error":null,"results":[]}', sqlTime(ago(d, 10)));
    insSub.run(uid, p.id, code, 'AC', 30 + Math.floor(rnd() * 200), total, total, '{"error":null,"results":[]}', sqlTime(ago(d, 11)));
  }
});
console.log('Demo account ready:  demo@devora.dev  /  Demo@1234   (public profile: /#/p/demo)');
