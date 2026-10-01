const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(cfg.dataDir, 'devora.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email       TEXT COLLATE NOCASE,
  salt        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problems (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  tags          TEXT NOT NULL DEFAULT '',
  statement     TEXT NOT NULL,
  time_limit_ms INTEGER NOT NULL DEFAULT 1000,
  memory_mb     INTEGER NOT NULL DEFAULT 256,
  starter_code  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS testcases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  input       TEXT NOT NULL,
  expected    TEXT NOT NULL,
  is_sample   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tests_problem ON testcases(problem_id, position);

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language    TEXT NOT NULL DEFAULT 'java',
  code        TEXT NOT NULL,
  verdict     TEXT NOT NULL DEFAULT 'Pending',
  runtime_ms  INTEGER,
  passed      INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id, problem_id);
CREATE INDEX IF NOT EXISTS idx_sub_problem ON submissions(problem_id, verdict);

CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company     TEXT NOT NULL,
  role        TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  package_lpa REAL,
  status      TEXT NOT NULL DEFAULT 'wishlist',
  deadline    TEXT,
  applied_on  TEXT,
  link        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  history     TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_user ON applications(user_id, status);

CREATE TABLE IF NOT EXISTS skills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Language',
  level       INTEGER NOT NULL DEFAULT 0,
  target      INTEGER NOT NULL DEFAULT 80,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skill_user ON skills(user_id);

-- problems solved on other sites (LeetCode, Codeforces ...), logged by hand
CREATE TABLE IF NOT EXISTS practice (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'LeetCode',
  topic        TEXT NOT NULL DEFAULT 'Arrays',
  difficulty   TEXT NOT NULL DEFAULT 'easy',
  link         TEXT NOT NULL DEFAULT '',
  time_minutes INTEGER,
  revisit      INTEGER NOT NULL DEFAULT 0,
  solved_on    TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_practice_user ON practice(user_id, solved_on);
`);

// Databases created before email login existed get the column added in place.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');

// Career-profile columns, added in place for databases created by earlier versions.
const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [name, ddl] of [
  ['display_name', "TEXT NOT NULL DEFAULT ''"],
  ['college', "TEXT NOT NULL DEFAULT ''"],
  ['target_role', "TEXT NOT NULL DEFAULT ''"],
  ['target_date', 'TEXT'],
  ['is_public', 'INTEGER NOT NULL DEFAULT 0'],
  ['slug', 'TEXT'],
  ['google_id', 'TEXT'],
]) {
  if (!userCols.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
}
db.exec('UPDATE users SET slug = lower(username) WHERE slug IS NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id)');

/** Run fn inside a transaction. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx };
