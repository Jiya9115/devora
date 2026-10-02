const path = require('path');

const isVercel = process.env.VERCEL === '1';

module.exports = {
  // Vercel supplies PORT automatically.
  port: parseInt(process.env.PORT, 10) || 3000,

  // Local:
  //   ./data
  //
  // Vercel:
  //   /app/data
  //
  // NOTE: Vercel container storage is ephemeral.
  dataDir:
    process.env.DATA_DIR ||
    (isVercel
      ? path.join('/app', 'data')
      : path.join(__dirname, '..', 'data')),

  adminUser: process.env.ADMIN_USERNAME || 'admin',

  adminEmail:
    (process.env.ADMIN_EMAIL || 'admin@devora.com').toLowerCase(),

  adminPassword:
    process.env.ADMIN_PASSWORD || 'Devora@2026',

  defaultAdminPassword: 'Devora@2026',

  sessionSecret: process.env.SESSION_SECRET || '',

  // IMPORTANT:
  // Vercel does not run Docker daemon for your application container.
  // Therefore use local Java execution.
  sandbox: (process.env.JUDGE_SANDBOX || 'local').toLowerCase(),

  dockerImage:
    process.env.JUDGE_DOCKER_IMAGE || 'eclipse-temurin:21-jdk',

  // One Java submission at a time on Vercel.
  concurrency: Math.max(
    1,
    parseInt(process.env.JUDGE_CONCURRENCY, 10) || 1
  ),

  javac: process.env.JAVAC || 'javac',

  java: process.env.JAVA || 'java',

  maxCodeBytes: 64 * 1024,

  maxOutputBytes: 1024 * 1024,

  compileTimeoutMs: 30000,
};