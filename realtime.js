'use strict';
/** Socket.IO real-time channel for the live auction. */
const { Server } = require('socket.io');
const sec = require('./security');
const S = require('./services/settings');
const A = require('./services/auction');

const FLOOD_LIMIT = Number(process.env.BID_FLOOD_LIMIT) || 8;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, tools) send no Origin
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}

function attach(httpServer) {
  const io = new Server(httpServer, {
    serveClient: true,
    pingInterval: 10000,
    pingTimeout: 9000,
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (req, cb) => cb(null, sameOrigin(req)),
  });

  io.use((socket, next) => {
    const token = sec.tokenFromCookieHeader(socket.handshake.headers.cookie);
    const s = sec.sessionFromToken(token);
    if (!s) return next(new Error('unauthorised'));
    socket.data.token = token;
    socket.data.user = s.user;
    next();
  });

  io.on('connection', (socket) => {
    socket.join('auction');
    socket.emit('state', A.buildState(S.currentSeason().id));

    socket.on('state:get', (ack) => {
      if (typeof ack === 'function') ack(A.buildState(S.currentSeason().id));
    });

    // simple flood protection: at most BID_FLOOD_LIMIT bid messages per second per connection
    let windowStart = 0; let count = 0;
    socket.on('bid', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const t = Date.now();
      if (t - windowStart > 1000) { windowStart = t; count = 0; }
      if (++count > FLOOD_LIMIT) return ack({ ok: false, code: 'too_fast', message: 'Too many bids at once. Please wait a moment.' });
      const s = sec.sessionFromToken(socket.data.token); // re-check on every bid: account may have been disabled
      if (!s) { ack({ ok: false, code: 'not_authorised', message: 'Your session has ended. Please sign in again.' }); return socket.disconnect(true); }
      const p = payload && typeof payload === 'object' ? payload : {};
      try {
        ack(A.placeBid(s.user, { lotId: Number(p.lot_id), amount: Number(p.amount), clientBidId: p.client_bid_id }));
      } catch (e) {
        console.error('Bid error', e);
        ack({ ok: false, code: 'server_error', message: 'The bid could not be processed. Please try again.' });
      }
    });
  });

  A.bus.on('state', (seasonId, state) => {
    if (seasonId === S.currentSeason().id) io.to('auction').emit('state', state);
  });
  A.bus.on('sold', (seasonId, sale) => {
    if (seasonId === S.currentSeason().id) io.to('auction').emit('sold', sale);
  });
  return io;
}

module.exports = { attach };
