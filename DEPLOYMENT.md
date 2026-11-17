# Deployment guide

This guide puts OLS Premier League online at a school-owned web address such as **league.olevels.com**.

## What the hosting needs

- **Node.js 22+** (or Docker — a `Dockerfile` is included)
- **One** running instance. The app keeps live auction state in one process and uses an SQLite database file, so do not run several copies side by side.
- A **persistent disk/volume** for the `DATA_DIR` folder (database, photographs, logos, backups). Without it, data is lost when the host restarts.
- **HTTPS** (all the options below provide it). Sign-in cookies are only sent over HTTPS in production.
- **WebSocket** support for the live auction (all the options below support it).

## Settings (environment variables)

| Variable | Example | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Turns on secure cookies and HTTPS headers |
| `DATA_DIR` | `/data` | Folder on the persistent volume |
| `ADMIN_USERNAME` | `admin` | First administrator (used only on the very first start) |
| `ADMIN_PASSWORD` | a long password | First administrator password; you must change it at first sign-in. If empty, one is generated and printed in the logs |
| `TRUST_PROXY` | `1` | Number of proxies in front of the app (Nginx, Railway, Render = 1) |
| `TZ` | `Asia/Karachi` | Time zone for reports |
| `BACKUP_INTERVAL_HOURS` | `24` | Automatic backup frequency (`0` turns it off) |
| `BACKUP_KEEP` | `30` | How many automatic backups to keep |
| `PORT` | `3000` | Port the app listens on (most hosts set this for you) |

A template is in `.env.example`.

---

## Option A — Managed hosting with Docker (easiest)

Any platform that can build a Dockerfile from a Git repository and attach a persistent volume works (for example Railway, Render or Fly.io). The steps are the same everywhere; button names vary, so follow the host's current documentation for each step.

1. Put this folder in a **private** GitHub repository owned by the school.
2. Create a new service from that repository. The host detects the `Dockerfile`.
3. Add a **volume / persistent disk** mounted at **`/data`** (1 GB is plenty).
4. Add the environment variables above (`NODE_ENV=production`, `DATA_DIR=/data`, `ADMIN_PASSWORD=…`, `TRUST_PROXY=1`, `TZ=Asia/Karachi`).
5. Keep it at **one instance** and make sure it does not "sleep" when idle (free tiers often sleep — a sleeping server would interrupt the live auction).
6. Deploy. Open the address the host gives you and check `https://…/healthz` shows `{"ok":true}`.
7. **Custom domain:** in the host's dashboard add `league.olevels.com` (or the address the school chooses). The host shows a DNS record (usually a **CNAME**). Ask whoever manages the `olevels.com` domain to add that record. HTTPS is issued automatically once DNS is correct.

## Option B — Your own server (VPS) with Docker

On a small Linux server (1 vCPU, 1 GB RAM is enough) with Docker installed:

```bash
git clone <your private repository> /opt/ols-premier-league
cd /opt/ols-premier-league
cp .env.example .env        # then edit .env and set ADMIN_PASSWORD
docker compose up -d --build
```

The app now runs on `127.0.0.1:3000`. Publish it over HTTPS with Nginx:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/league.olevels.com
sudo ln -s /etc/nginx/sites-available/league.olevels.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d league.olevels.com
```

Point the domain's **A record** at the server's IP address before running certbot. The Nginx file already includes the WebSocket settings the live auction needs and allows 12 MB photo uploads.

**Without Docker:** install Node.js 22, run `npm ci --omit=dev --ignore-scripts`, create `/opt/ols-premier-league/.env`, and use `deploy/ols-premier-league.service` with systemd.

## After the first deployment

1. Sign in at `/login` as `admin` with the first password; you will be asked to choose a new one.
2. Delete `INITIAL_ADMIN_PASSWORD.txt` from the data folder if it was created.
3. In **Settings** check registration, the fee note and public-website visibility.
4. In **Club Management** upload the official club logos and colours.
5. In **User Management** create an **Auction Operator** account and a **Projector** account.
6. Download a backup from **Settings → Backups** to confirm backups work.

## Updating to a new version

- Managed hosting: push the new code to the repository; the host rebuilds and redeploys. Data on the volume is kept.
- VPS: `git pull && docker compose up -d --build`.
- Database changes are applied automatically at start-up. Take a backup first.
- Do not update on auction day.

## Event-day network tips

- The auction works over ordinary mobile data or Wi-Fi; each update is a few kilobytes.
- Test the school Wi-Fi in the auction hall the day before with the captains' phones and the projector computer.
- Keep a mobile hotspot available as a fallback for the operator laptop and projector computer.
- If a device loses connection, it reconnects automatically and shows the latest confirmed state; bids cannot be placed while offline.
