'use strict';
/**
 * OLS Premier League — application entry point.
 * Building Al-Qawiyy, Al-Ameen Muslims.
 */
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const cfg = require('./config');
const D = require('./db');
const sec = require('./security');
const S = require('./services/settings');
const A = require('./services/auction');
const B = require('./services/backup');
const realtime = require('./realtime');

const PUBLIC = path.join(cfg.ROOT, 'public');

const PAGES = {
  '/': { file: 'index.html' },
  '/register': { file: 'register.html' },
  '/login': { file: 'login.html' },
  '/admin': { file: 'admin.html', roles: ['admin'] },
  '/operator': { file: 'operator.html', roles: ['admin', 'operator'] },
  '/captain': { file: 'captain.html', roles: ['captain'] },
  '/projector': { file: 'projector.html', roles: ['admin', 'operator', 'projector'] },
};

function createApp() {
  const app = express();
  app.set('trust proxy', cfg.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: cfg.COOKIE_SECURE ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: cfg.COOKIE_SECURE ? { maxAge: 15552000 } : false,
  }));
  app.use(compression());
  app.use(express.json({ limit: '300kb' }));
  app.use(sec.attachUser);
  app.use('/api', sec.csrfProtect);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/public', require('./routes/public').router);
  app.use('/api/auction', require('./routes/auction').router);
  app.use('/api/admin/reports', require('./routes/reports'));
  app.use('/api/admin', require('./routes/tournament'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/media', require('./routes/public').media);
  app.get('/healthz', (_req, res) => res.json({ ok: true, version: cfg.APP_VERSION }));

  for (const [route, page] of Object.entries(PAGES)) {
    app.get(route, (req, res) => {
      if (page.roles) {
        if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(route)}`);
        if (!page.roles.includes(req.user.role)) return res.redirect(sec.ROLE_HOME[req.user.role] || '/');
      }
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(PUBLIC, page.file));
    });
  }

  app.use(express.static(PUBLIC, {
    index: false,
    setHeaders(res, file) {
      if (/\.(woff2|png|svg|webp|jpg|ico)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else res.setHeader('Cache-Control', 'no-cache'); // revalidated with ETag, so updates appear immediately
    },
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File is too large (maximum ${cfg.MAX_UPLOAD_MB} MB).` : 'Upload problem: ' + err.message });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: 'This change conflicts with an existing record (it may already have been done).' });
    }
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message, code: err.code });
  });
  return app;
}

function start({ port = cfg.PORT, host = cfg.HOST, log = console.log } = {}) {
  D.open(cfg.DB_FILE, { log });
  const app = createApp();
  const server = http.createServer(app);
  const io = realtime.attach(server);
  A.scheduleTimer(S.currentSeason().id); // resume countdown handling after a restart
  B.schedule(log);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      log(`OLS Premier League v${cfg.APP_VERSION} running on http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}`);
      resolve({ app, server, io, port: server.address().port });
    });
  });
}

async function stop(ctx) {
  B.stop();
  if (ctx && ctx.io) ctx.io.close();
  if (ctx && ctx.server) await new Promise((r) => ctx.server.close(() => r()));
  D.close();
}

if (require.main === module) {
  start().then((ctx) => {
    const shutdown = (sig) => {
      console.log(`${sig} received, shutting down…`);
      stop(ctx).then(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}

module.exports = { createApp, start, stop };
