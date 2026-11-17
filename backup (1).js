'use strict';
/**
 * Backups: a consistent copy of the SQLite database (taken safely while the app runs)
 * plus a copy of uploaded photographs and logos. Old backups are pruned automatically.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const D = require('../db');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function createBackup(reason = 'manual') {
  fs.mkdirSync(cfg.BACKUP_DIR, { recursive: true });
  const dir = path.join(cfg.BACKUP_DIR, `backup-${stamp()}-${reason}`);
  fs.mkdirSync(dir, { recursive: true });
  await D.db.backup(path.join(dir, 'ols-premier-league.db'));
  if (fs.existsSync(cfg.UPLOAD_DIR)) fs.cpSync(cfg.UPLOAD_DIR, path.join(dir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.txt'),
    `OLS Premier League backup\nCreated: ${new Date().toISOString()}\nReason: ${reason}\n\nTo restore: stop the app, copy ols-premier-league.db and the uploads folder into the data folder, then start the app.\n`);
  prune();
  return dir;
}

function list() {
  if (!fs.existsSync(cfg.BACKUP_DIR)) return [];
  return fs.readdirSync(cfg.BACKUP_DIR).filter((n) => n.startsWith('backup-'))
    .map((n) => {
      const f = path.join(cfg.BACKUP_DIR, n, 'ols-premier-league.db');
      return fs.existsSync(f) ? { name: n, size: fs.statSync(f).size, created: fs.statSync(f).mtime.toISOString() } : null;
    })
    .filter(Boolean).sort((a, b) => b.name.localeCompare(a.name));
}

function prune() {
  const items = list();
  for (const b of items.slice(cfg.BACKUP_KEEP)) fs.rmSync(path.join(cfg.BACKUP_DIR, b.name), { recursive: true, force: true });
}

let timer = null;
function schedule(log = console.log) {
  if (!cfg.BACKUP_INTERVAL_HOURS) return;
  const ms = cfg.BACKUP_INTERVAL_HOURS * 3600000;
  timer = setInterval(() => createBackup('auto').then((d) => log(`Backup created: ${d}`)).catch((e) => log('Backup failed:', e.message)), ms);
  timer.unref();
}
function stop() { clearInterval(timer); }

module.exports = { createBackup, list, prune, schedule, stop };
