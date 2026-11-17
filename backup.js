#!/usr/bin/env node
'use strict';
/* Create a backup now (safe while the app is running):  npm run backup */
const D = require('../server/db');
const cfg = require('../server/config');
const B = require('../server/services/backup');

D.open(cfg.DB_FILE, { log: () => {} });
B.createBackup('manual-cli').then((dir) => { console.log(`Backup created: ${dir}`); D.close(); })
  .catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
