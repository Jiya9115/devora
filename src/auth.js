const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { db } = require('./db');

const COOKIE = 'vt';
const MAX_AGE_S = 60 * 60 * 24 * 14;

// Secret used to sign the session cookie. Persisted so logins survive restarts.
function loadSecret() {
  if (cfg.sessionSecret) return cfg.sessionSecret;
  const file = path.join(cfg.dataDir, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(req, res, userId) {
  const token = sign({ uid: userId, exp: Date.now() + MAX_AGE_S * 1000 });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`
  );
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

const getUser = db.prepare(
  'SELECT id, username, role, email, display_name, college, target_role, target_date, is_public, slug FROM users WHERE id = ?'
);

/** The user object sent to the browser (never includes the password hash). */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    email: u.email,
    name: u.display_name || u.username,
    college: u.college || '',
    targetRole: u.target_role || '',
    targetDate: u.target_date || null,
    isPublic: !!u.is_public,
    slug: u.slug,
  };
}

function attachUser(req, _res, next) {
  const p = verify(parseCookies(req.headers.cookie)[COOKIE]);
  req.user = p ? getUser.get(p.uid) || null : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

/** Tiny in-memory rate limiter: max `limit` hits per `windowMs` per key. */
function rateLimit({ limit, windowMs, key }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset < now) e = { n: 0, reset: now + windowMs };
    e.n += 1;
    hits.set(k, e);
    if (e.n > limit) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Slow down for a moment.' });
    }
    next();
  };
}

module.exports = {
  publicUser,
  hashPassword,
  verifyPassword,
  setSession,
  clearSession,
  attachUser,
  requireAuth,
  requireAdmin,
  rateLimit,
};
