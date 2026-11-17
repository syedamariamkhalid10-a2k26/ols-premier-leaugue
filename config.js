'use strict';
const path = require('path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const NODE_ENV = process.env.NODE_ENV || 'development';
const PROD = NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

module.exports = {
  ROOT,
  PROD,
  NODE_ENV,
  APP_VERSION: pkg.version,
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'ols-premier-league.db'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  BACKUP_DIR: path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups')),
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  // Set COOKIE_SECURE=true when the site is served over HTTPS (it is on by default in production).
  COOKIE_SECURE: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : PROD,
  // Number of reverse proxies in front of the app (Nginx, Railway, Render = 1).
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : (PROD ? 1 : 0),
  SESSION_HOURS: Number(process.env.SESSION_HOURS) || 18,
  PROJECTOR_SESSION_DAYS: 7,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  BACKUP_INTERVAL_HOURS: process.env.BACKUP_INTERVAL_HOURS !== undefined ? Number(process.env.BACKUP_INTERVAL_HOURS) : 24,
  BACKUP_KEEP: Number(process.env.BACKUP_KEEP) || 30,
  MAX_UPLOAD_MB: 10,
};
