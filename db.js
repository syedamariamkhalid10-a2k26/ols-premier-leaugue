'use strict';
/**
 * SQLite database: connection, schema migrations, seed data and small query helpers.
 * better-sqlite3 is synchronous, so every transaction runs atomically inside the single
 * Node.js process. That is what makes simultaneous bids safe: they are processed one by one.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const cfg = require('./config');

const D = { db: null };
const cache = new Map();

function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = D.db.prepare(sql); cache.set(sql, s); }
  return s;
}
const one = (sql, ...p) => stmt(sql).get(...p);
const all = (sql, ...p) => stmt(sql).all(...p);
const run = (sql, ...p) => stmt(sql).run(...p);
const tx = (fn) => D.db.transaction(fn)();
const now = () => new Date().toISOString();

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const PLAYER_STATUSES = ['pending', 'approved', 'rejected', 'ready', 'bidding', 'sold', 'pending_allocation', 'allocated', 'withdrawn'];

// The eight permanent clubs. Colours and crests are defaults that the administrator can
// replace with the officially approved artwork from Club Management.
const CLUBS = [
  { slug: 'al-saqr-strikers', name: 'Al Saqr Strikers', short: 'Saqr', p: '#9B1C2E', s: '#D9A520' },
  { slug: 'al-barq-volt', name: 'Al Barq Volt', short: 'Barq', p: '#E3A300', s: '#1B2A4A' },
  { slug: 'al-fursan-united', name: 'Al Fursan United', short: 'Fursan', p: '#1F4E9C', s: '#C9D1DC' },
  { slug: 'al-shihab-comets', name: 'Al Shihab Comets', short: 'Shihab', p: '#E2621B', s: '#1B2A4A' },
  { slug: 'as-saif-elite', name: 'As-Saif Elite', short: 'Saif', p: '#0E7A4E', s: '#E6EBF0' },
  { slug: 'al-raad-thunder', name: "Al Ra'ad Thunder", short: "Ra'ad", p: '#5A2D82', s: '#F2C230' },
  { slug: 'al-hadid-titans', name: 'Al Hadid Titans', short: 'Hadid', p: '#3C4652', s: '#E04E39' },
  { slug: 'al-nujum-united', name: 'Al Nujum United', short: 'Nujum', p: '#0B8CA6', s: '#F2D16B' },
];

const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','operator','captain','projector')),
    permissions TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    ua TEXT
  );
  CREATE INDEX ix_sessions_user ON sessions(user_id);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT 'registration' CHECK (phase IN ('setup','registration','auction','league','completed')),
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE clubs (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    short_name TEXT NOT NULL,
    primary_color TEXT NOT NULL,
    secondary_color TEXT NOT NULL,
    logo TEXT,
    motto TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    full_name TEXT NOT NULL,
    class_grade TEXT NOT NULL,
    primary_position TEXT NOT NULL CHECK (primary_position IN ('Goalkeeper','Defender','Midfielder','Forward')),
    secondary_position TEXT CHECK (secondary_position IS NULL OR secondary_position IN ('Goalkeeper','Defender','Midfielder','Forward')),
    photo TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','ready','bidding','sold','pending_allocation','allocated','withdrawn')),
    auction_order INTEGER,
    source TEXT NOT NULL DEFAULT 'form',
    confirmed INTEGER NOT NULL DEFAULT 0,
    admin_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX ix_players_season_status ON players(season_id, status);

  CREATE TABLE season_clubs (
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    club_id INTEGER NOT NULL REFERENCES clubs(id),
    group_name TEXT CHECK (group_name IS NULL OR group_name IN ('A','B')),
    budget_start INTEGER NOT NULL,
    captain_user_id INTEGER REFERENCES users(id),
    captain_player_id INTEGER REFERENCES players(id),
    formation TEXT,
    manual_rank INTEGER,
    PRIMARY KEY (season_id, club_id)
  );
  CREATE UNIQUE INDEX ux_captain_user ON season_clubs(season_id, captain_user_id) WHERE captain_user_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_captain_player ON season_clubs(season_id, captain_player_id) WHERE captain_player_id IS NOT NULL;

  CREATE TABLE auction_sessions (
    season_id INTEGER PRIMARY KEY REFERENCES seasons(id),
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','live','ended')),
    started_at TEXT,
    ended_at TEXT
  );

  CREATE TABLE auction_lots (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    sequence_no INTEGER NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('presenting','open','paused','sold','unsold','cancelled')),
    player_prev_status TEXT NOT NULL,
    starting_bid INTEGER NOT NULL,
    min_increment INTEGER NOT NULL,
    timer_seconds INTEGER NOT NULL,
    highest_bid INTEGER,
    leading_club_id INTEGER REFERENCES clubs(id),
    highest_bid_id INTEGER,
    timer_ends_at INTEGER,
    paused_remaining_ms INTEGER,
    created_at TEXT NOT NULL,
    opened_at TEXT,
    closed_at TEXT,
    created_by INTEGER,
    closed_by INTEGER
  );
  CREATE UNIQUE INDEX ux_one_active_lot ON auction_lots(season_id) WHERE status IN ('presenting','open','paused');
  CREATE INDEX ix_lots_player ON auction_lots(player_id);

  CREATE TABLE bids (
    id INTEGER PRIMARY KEY,
    lot_id INTEGER NOT NULL REFERENCES auction_lots(id),
    season_id INTEGER NOT NULL,
    club_id INTEGER NOT NULL REFERENCES clubs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted','rejected','voided')),
    reason TEXT,
    client_bid_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX ux_bid_idempotency ON bids(user_id, client_bid_id) WHERE client_bid_id IS NOT NULL;
  CREATE INDEX ix_bids_lot ON bids(lot_id, status);

  CREATE TABLE squad_members (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    club_id INTEGER NOT NULL REFERENCES clubs(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    method TEXT NOT NULL CHECK (method IN ('auction','manual','captain')),
    lot_id INTEGER REFERENCES auction_lots(id),
    lineup_role TEXT NOT NULL DEFAULT 'unset' CHECK (lineup_role IN ('starter','sub','unset')),
    lineup_slot TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by INTEGER,
    removed_at TEXT,
    removed_by INTEGER,
    removed_reason TEXT
  );
  -- A player can never belong to two clubs, and a lot can never produce two sales.
  CREATE UNIQUE INDEX ux_squad_player_active ON squad_members(season_id, player_id) WHERE active = 1;
  CREATE UNIQUE INDEX ux_squad_lot ON squad_members(lot_id) WHERE lot_id IS NOT NULL;
  CREATE INDEX ix_squad_club ON squad_members(season_id, club_id, active);

  CREATE TABLE budget_adjustments (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL,
    club_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    season_id INTEGER,
    details TEXT,
    ip TEXT
  );
  CREATE INDEX ix_audit_at ON audit_log(at);

  CREATE TABLE fixtures (
    id INTEGER PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES seasons(id),
    stage TEXT NOT NULL CHECK (stage IN ('group','semi','final','third_place','friendly')),
    group_name TEXT,
    round INTEGER,
    match_label TEXT,
    home_club_id INTEGER NOT NULL REFERENCES clubs(id),
    away_club_id INTEGER NOT NULL REFERENCES clubs(id),
    kickoff_at TEXT,
    venue TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','postponed','cancelled')),
    home_score INTEGER,
    away_score INTEGER,
    home_pens INTEGER,
    away_pens INTEGER,
    motm_player_id INTEGER REFERENCES players(id),
    published INTEGER NOT NULL DEFAULT 1,
    result_published INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (home_club_id <> away_club_id)
  );
  CREATE INDEX ix_fixtures_season ON fixtures(season_id, stage);

  CREATE TABLE match_events (
    id INTEGER PRIMARY KEY,
    fixture_id INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL,
    club_id INTEGER NOT NULL REFERENCES clubs(id),
    player_id INTEGER REFERENCES players(id),
    type TEXT NOT NULL CHECK (type IN ('goal','own_goal','assist','yellow','red')),
    minute INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX ix_events_fixture ON match_events(fixture_id);
  CREATE INDEX ix_events_player ON match_events(player_id);

  CREATE TABLE achievements (
    id INTEGER PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id),
    season_id INTEGER REFERENCES seasons(id),
    title TEXT NOT NULL,
    description TEXT,
    awarded_on TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY,
    season_id INTEGER REFERENCES seasons(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by INTEGER
  );
  `,
];

function migrate() {
  const db = D.db;
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = db.prepare('SELECT version FROM schema_version').get();
  if (!row) { db.prepare('INSERT INTO schema_version (version) VALUES (0)').run(); row = { version: 0 }; }
  for (let v = row.version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    })();
  }
}

function seed(log = console.log) {
  const t = now();
  tx(() => {
    if (!one('SELECT 1 FROM clubs LIMIT 1')) {
      CLUBS.forEach((c, i) => run(
        'INSERT INTO clubs (slug, name, short_name, primary_color, secondary_color, sort_order) VALUES (?,?,?,?,?,?)',
        c.slug, c.name, c.short, c.p, c.s, i + 1));
    }
    if (!one('SELECT 1 FROM seasons LIMIT 1')) {
      const { DEFAULT_SETTINGS } = require('./services/settings');
      const year = new Date().getFullYear();
      const name = `Season ${year}–${String(year + 1).slice(2)}`;
      const info = run('INSERT INTO seasons (name, is_current, phase, settings, created_at) VALUES (?,1,?,?,?)',
        name, 'registration', JSON.stringify(DEFAULT_SETTINGS), t);
      for (const c of all('SELECT id FROM clubs')) {
        run('INSERT INTO season_clubs (season_id, club_id, budget_start) VALUES (?,?,?)', info.lastInsertRowid, c.id, DEFAULT_SETTINGS.budget);
      }
      run("INSERT INTO auction_sessions (season_id, status) VALUES (?, 'not_started')", info.lastInsertRowid);
    }
  });
  if (!one('SELECT 1 FROM users LIMIT 1')) {
    const bcrypt = require('bcryptjs');
    let pw = cfg.ADMIN_PASSWORD;
    let generated = false;
    if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
    run(`INSERT INTO users (username, display_name, password_hash, role, permissions, must_change_password, created_at)
         VALUES (?,?,?,?,?,?,?)`, cfg.ADMIN_USERNAME, 'Super Administrator', bcrypt.hashSync(pw, 11), 'admin', '', 1, t);
    if (generated) {
      const file = path.join(cfg.DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt');
      fs.writeFileSync(file, `Username: ${cfg.ADMIN_USERNAME}\nPassword: ${pw}\n\nSign in, change this password, then delete this file.\n`, { mode: 0o600 });
      log(`\n  First run: Super Administrator created.\n  Username: ${cfg.ADMIN_USERNAME}\n  Password: ${pw}\n  (also saved to ${file})\n`);
    }
  }
}

function open(file = cfg.DB_FILE, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (D.db) close();
  D.db = new Database(file);
  D.db.pragma('journal_mode = WAL');
  D.db.pragma('foreign_keys = ON');
  D.db.pragma('busy_timeout = 5000');
  D.db.pragma('synchronous = NORMAL');
  migrate();
  seed(opts.log);
  return D.db;
}

function close() {
  if (D.db) { D.db.close(); D.db = null; cache.clear(); }
}

module.exports = Object.assign(D, { open, close, one, all, run, tx, now, POSITIONS, PLAYER_STATUSES, CLUBS });
