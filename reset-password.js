#!/usr/bin/env node
'use strict';
/* Reset any account's password from the server console:  npm run reset-password -- <username> [new-password] */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const D = require('../server/db');
const cfg = require('../server/config');

const [username, given] = process.argv.slice(2);
if (!username) { console.error('Usage: npm run reset-password -- <username> [new-password]'); process.exit(1); }
D.open(cfg.DB_FILE, { log: () => {} });
const u = D.one('SELECT * FROM users WHERE username = ?', username);
if (!u) { console.error(`No account called "${username}".`); process.exit(1); }
const pw = given || crypto.randomBytes(9).toString('base64url');
if (pw.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }
D.run('UPDATE users SET password_hash = ?, active = 1, must_change_password = ? WHERE id = ?', bcrypt.hashSync(pw, 11), u.role === 'admin' ? 1 : 0, u.id);
D.run('DELETE FROM sessions WHERE user_id = ?', u.id);
D.run(`INSERT INTO audit_log (at, username, action, entity, entity_id) VALUES (?, 'console', 'user.password_reset', 'user', ?)`, new Date().toISOString(), u.id);
console.log(`Password for ${username} reset to: ${pw}${u.role === 'admin' ? '\n(They will be asked to choose a new one when they sign in.)' : ''}`);
D.close();
