const express = require('express');
const path = require('path');

const cfg = require('./src/config');
const { db } = require('./src/db');
const { attachUser, hashPassword } = require('./src/auth');
const { seedProblems } = require('./src/seed');
const { calibrate } = require('./src/judge');
const api = require('./src/api');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ------------------------------------------------------------- */
/* Security headers                                               */
/* ------------------------------------------------------------- */

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/* ------------------------------------------------------------- */
/* API                                                             */
/* ------------------------------------------------------------- */

app.use(
  '/api/admin',
  express.json({ limit: '25mb' })
);

app.use(
  '/api',
  express.json({ limit: '300kb' })
);

app.use('/api', attachUser, api);

/* ------------------------------------------------------------- */
/* Health check                                                    */
/* ------------------------------------------------------------- */

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'devora',
    environment: process.env.VERCEL === '1'
      ? 'vercel'
      : 'local',
  });
});

/* ------------------------------------------------------------- */
/* Frontend                                                        */
/* ------------------------------------------------------------- */

app.use(
  express.static(
    path.join(__dirname, 'public'),
    {
      extensions: ['html'],
      maxAge: '5m',
    }
  )
);

app.get('*', (_req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

/* ------------------------------------------------------------- */
/* First-run setup                                                 */
/* ------------------------------------------------------------- */

function ensureAdmin() {
  const have = db
    .prepare(
      "SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
    )
    .get();

  if (have) {
    if (!have.email) {
      db.prepare(
        'UPDATE users SET email = ? WHERE id = ?'
      ).run(cfg.adminEmail, have.id);
    }

    return;
  }

  const { salt, hash } = hashPassword(
    cfg.adminPassword
  );

  db.prepare(
    `INSERT INTO users
      (username, email, salt, hash, role, display_name, slug)
     VALUES (?, ?, ?, ?, 'admin', ?, ?)`
  ).run(
    cfg.adminUser,
    cfg.adminEmail,
    salt,
    hash,
    cfg.adminUser,
    cfg.adminUser.toLowerCase()
  );

  console.log(
    `Admin account created: ${cfg.adminEmail}`
  );

  if (
    cfg.adminPassword ===
    cfg.defaultAdminPassword
  ) {
    console.warn(
      'WARNING: Using default admin password.'
    );
  }
}

/* ------------------------------------------------------------- */
/* Database / seed initialization                                 */
/* ------------------------------------------------------------- */

function initializeDatabase() {
  ensureAdmin();

  if (seedProblems()) {
    console.log(
      'Seeded the starter problem set.'
    );
  }

  // Anything left pending belongs to a process
  // that died during judging.
  db.prepare(
    "UPDATE submissions SET verdict='IE' WHERE verdict='Pending'"
  ).run();
}

/* ------------------------------------------------------------- */
/* Start server                                                    */
/* ------------------------------------------------------------- */

async function start() {
  try {
    initializeDatabase();

    const calibration = await calibrate();

    if (calibration.ok) {
      console.log(
        `Java toolchain OK. JVM baseline: ${calibration.baselineMs} ms`
      );
    } else {
      console.warn(
        `Java calibration failed: ${calibration.error}`
      );
    }

    const port = cfg.port;

    app.listen(port, '0.0.0.0', () => {
      console.log(
        `Devora running on port ${port}`
      );
    });
  } catch (error) {
    console.error(
      'Failed to start Devora:',
      error
    );

    process.exit(1);
  }
}

start();

module.exports = app;