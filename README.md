# OLS Premier League

**Building Al-Qawiyy, Al-Ameen Muslims** · *Strength in Character. Trustworthiness in Action.*

The official football club and live-auction platform of O Levels School: eight permanent clubs, student registration, a real-time player auction, squad selection, fixtures, results, standings and a public league website. Every season is kept for the school's sporting history.

## What's included

| Area | Screens |
|---|---|
| Public website (`/`) | Home, About, eight club profiles, squads and player profiles, fixtures, results, group standings, knockout stage and Grand Final, top scorers and statistics, announcements, season archive |
| Student registration (`/register`) | Five fields only (full name, class/grade, photograph, preferred position, optional secondary position), confirmation checkbox, squad note, discreet Rs. 500 fee note |
| Super Administrator (`/admin`) | Dashboard, Student Registrations, Player Management (Excel/CSV import, bulk photo upload), Club Management, Captain Accounts, Auction Control, Auction History and audit log, Squad Management, Fixtures, Match Results, League Table, Player Statistics, Reports (Excel/CSV/PDF), Season Management, User Management, Settings and backups |
| Auction Operator (`/operator`) | Present a player, start or pause bidding, restart the timer, confirm SOLD, send unsold players to allocation, second round, manual or automatic allocation, undo an accidental bid (with permission) |
| Club Captain (`/captain`) | Mobile bidding with one large **BID** button showing the next valid bid, live highest bid and countdown, budget and squad, starting five and substitutes on a pitch |
| Projector (`/projector`) | Full-screen broadcast view: player on the block, current bid, leading club, countdown, all eight clubs with budgets and squad places, SOLD animation that sends the player to the winning club |

There are no jersey numbers anywhere in the application.

## How the auction protects fairness

- The **server is the only source of truth**. Every bid is checked on the server: auction live, bidding open, timer not expired, bid at least the starting bid or the current bid + 200, enough points, squad not full, and the captain bidding only for their own club.
- Bids are processed one at a time inside database transactions, so simultaneous bids can never both win. Each bid carries a unique ID, so a double tap or a retried request on a slow connection is never counted twice.
- A sale happens **only when the operator confirms it**. The database refuses to put a player in two clubs or to record a sale twice, so a budget can never be deducted twice.
- Optional rule (on by default): a club must keep enough points to fill its remaining places at the starting bid, so every club can always complete its squad.
- Reversing a sale, moving a player, changing a budget and manual allocation all need a written reason and are recorded in the audit log.

## Quick start (on a computer, for testing)

Requires **Node.js 22 or newer**.

```bash
npm ci --ignore-scripts      # install (the native parts come ready-made)
npm start                    # http://localhost:3000
```

On the first start the server prints a one-time administrator password (also saved in `data/INITIAL_ADMIN_PASSWORD.txt`). Sign in at `/login` and choose a new password.

To rehearse with sample data on a **separate, empty** data folder:

```bash
DATA_DIR=./demo-data npm run demo-data -- --auction   # demo players, captains, half the auction done
DATA_DIR=./demo-data npm start
```

All demo accounts use the password `demo-pass-2026` (`saqr-captain`, `barq-captain` … `nujum-captain`, `operator`, `projector`).

## Tests

```bash
npm test
```

26 automated tests cover the checklist in the development brief: registration and approval, photograph uploads (compression, EXIF removal, privacy), captain authentication and permissions, starting bid 500, minimum increase 200, invalid bid rejection, budget and squad limits, simultaneous bids, repeated clicks, successful sale and automatic budget deduction, duplicate sale prevention, connection loss and recovery, unsold players and allocation, sale reversal, lineups, auction history and exports, fixtures, results, standings and every tie-breaker, public visibility, new seasons preserving old ones, and backups.

## Technology

- **Node.js + Express** web server, **Socket.IO** for the live auction (with automatic reconnection)
- **SQLite** database (one file, with WAL mode, automatic daily backups) — simple to host and back up
- Plain HTML, CSS and JavaScript in the browser: no framework, small pages, fast on ordinary school computers and phones
- **sharp** for photographs (resized, compressed to WebP, location data removed), **ExcelJS** and **PDFKit** for exports
- Security: password hashing (bcrypt), secure session cookies, CSRF protection, role-based access, rate-limited sign-in and registration, Content-Security-Policy and other security headers, parameterised SQL, server-side validation of every input

## Project layout

```
server/            Express app, database, auction engine, standings, exports, backups
  routes/          auth, public, auction (operator + captain), admin, tournament, reports
  services/        auction.js, standings.js, photos.js, exporter.js, importer.js, backup.js, settings.js
public/            Pages, styles, browser scripts, club crests, school logo, fonts
scripts/           demo-data, backup, reset-password
tests/             automated tests (node --test)
deploy/            Nginx and systemd examples
docs/              DEPLOYMENT.md, BACKUP.md, OPERATING_GUIDE.md
```

## Before the first season

1. **Club logos:** the eight crests included are placeholders. Upload each club's official approved logo in **Club Management → Upload logo**, and set the official colours in **Edit identity**.
2. **Photo consent:** player photographs are private by default. Only switch on **Settings → Public website → Player photographs** once the school's consent arrangements are in place.
3. Read `docs/OPERATING_GUIDE.md` for the full event-day workflow.

See `docs/DEPLOYMENT.md` to put the platform online at a school-owned address and `docs/BACKUP.md` for backups and restore.
