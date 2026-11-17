# Backups and restore

Everything the platform stores is in one folder (`DATA_DIR`):

```
ols-premier-league.db      the database (all seasons, players, bids, results, users, audit log)
uploads/players/           compressed player photographs
uploads/clubs/             uploaded club logos
backups/                   automatic backups
```

## Automatic backups

- A backup is taken every 24 hours (change with `BACKUP_INTERVAL_HOURS`).
- The latest 30 are kept (`BACKUP_KEEP`); older ones are removed.
- Each backup is a folder `backups/backup-<date>-auto/` with a consistent copy of the database (taken safely while the app is running) and a copy of the photographs and logos.

## Manual backups

- **From the website:** Administration → Settings → Backups → **Back up now**, then **Download** to save the database file on a school computer.
- **From the server console:** `npm run backup` (or `docker compose exec app npm run backup`).

**Recommended routine**

| When | What |
|---|---|
| The day before the auction | Back up now, download, store safely |
| Immediately after the auction | Back up now, download, store safely |
| Weekly during the league | Download the latest backup |
| End of season | Download a backup and keep it permanently |

Store downloaded copies somewhere other than the server (for example the school's Google Drive). The database contains student names and class information, so keep copies in a location only authorised staff can open.

The download from the website contains the database only. To keep photographs as well, copy the whole `backups/backup-…` folder (or the `uploads` folder) from the server.

## Restore

1. Stop the app (`docker compose stop`, or stop the service in the hosting dashboard).
2. Take a copy of the current `DATA_DIR` folder, just in case.
3. Copy `ols-premier-league.db` from the backup into `DATA_DIR`, replacing the existing file. Delete any `ols-premier-league.db-wal` and `ols-premier-league.db-shm` files next to it.
4. Copy the backup's `uploads` folder into `DATA_DIR` (replace).
5. Start the app and sign in to check the data.

## Lost administrator password

From the server console:

```bash
npm run reset-password -- admin
# Docker: docker compose exec app npm run reset-password -- admin
```

A new password is printed; you will be asked to change it at sign-in. The reset is recorded in the audit log.
