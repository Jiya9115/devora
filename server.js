const express = require('express');
const path = require('path');
const cfg = require('./src/config');
const { db } = require('./src/db');
const { attachUser, hashPassword } = require('./src/auth');
const { seedProblems } = require('./src/seed');
const { calibrate } = require('./src/judge');
const api = require('./src/api');

const app = express();
app.set('trust proxy', 1); // running behind nginx / a load balancer
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Admin test data can be large (a few MB), everything else is tiny.
app.use('/api/admin', express.json({ limit: '25mb' }));
app.use('/api', express.json({ limit: '300kb' }));
app.use('/api', attachUser, api);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------------- first-run setup ---------------- */

function ensureAdmin() {
  const have = db.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (have) {
    if (!have.email) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(cfg.adminEmail, have.id);
    return;
  }
  const { salt, hash } = hashPassword(cfg.adminPassword);
  db.prepare("INSERT INTO users (username, email, salt, hash, role, display_name, slug) VALUES (?,?,?,?, 'admin', ?, ?)")
    .run(cfg.adminUser, cfg.adminEmail, salt, hash, cfg.adminUser, cfg.adminUser.toLowerCase());
  console.log(`\n  Admin account created: ${cfg.adminEmail}`);
  if (cfg.adminPassword === cfg.defaultAdminPassword) {
    console.log('  Using the default admin password. Set ADMIN_PASSWORD in .env before putting this on the internet.');
  }
  console.log('');
}

ensureAdmin();
if (seedProblems()) console.log('  Seeded the starter problem set.');

// Anything left "Pending" belongs to a previous process that died mid-judging.
db.prepare("UPDATE submissions SET verdict='IE' WHERE verdict='Pending'").run();

app.listen(cfg.port, async () => {
  console.log(`  Devora is running at http://localhost:${cfg.port}  (sandbox: ${cfg.sandbox})`);
  const c = await calibrate();
  if (c.ok) console.log(`  Java toolchain OK, JVM start-up baseline ${c.baselineMs} ms`);
  else console.warn(`  ! Could not run Java (${c.error}). Install JDK 17+ and make sure javac is on PATH.`);
});
