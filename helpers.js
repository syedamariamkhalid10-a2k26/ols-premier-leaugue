'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'olspl-test-'));
process.env.ADMIN_PASSWORD = 'Admin#Pass2026';
process.env.BACKUP_INTERVAL_HOURS = '0';
process.env.NODE_ENV = 'test';
process.env.BID_FLOOD_LIMIT = '1000';

const { start, stop } = require('../server');
const { io: ioClient } = require('socket.io-client');
const sharp = require('sharp');

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, { form } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) if (c.startsWith('olspl_sid=')) this.cookie = c.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b ?? {}); }
  del(u) { return this.req('DELETE', u); }
  async login(username, password) {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.data)}`);
    this.csrf = r.data.csrf;
    return r.data;
  }
  socket() {
    return new Promise((resolve, reject) => {
      const s = ioClient(this.base, { extraHeaders: { cookie: this.cookie }, transports: ['websocket'], reconnection: false });
      s.once('state', (st) => { s.lastState = st; resolve(s); });
      s.on('state', (st) => { s.lastState = st; });
      s.once('connect_error', reject);
    });
  }
}

const emitBid = (sock, payload) => new Promise((resolve) => sock.emit('bid', payload, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function testImage(color = { r: 200, g: 40, b: 60 }) {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: color } })
    .withMetadata({ exif: { IFD0: { Copyright: 'test' } } }).jpeg().toBuffer();
}

async function boot() {
  const ctx = await start({ port: 0, host: '127.0.0.1', log: () => {} });
  const base = `http://127.0.0.1:${ctx.port}`;
  const admin = new Client(base);
  await admin.login('admin', process.env.ADMIN_PASSWORD);
  // the seeded admin must change the password first
  const blocked = await admin.get('/api/admin/dashboard');
  if (blocked.status !== 403) throw new Error('expected forced password change');
  await admin.post('/api/auth/password', { current: process.env.ADMIN_PASSWORD, password: 'NewAdmin#2026' });
  return { ctx, base, admin, client: () => new Client(base), stop: () => stop(ctx) };
}

module.exports = { boot, Client, emitBid, wait, testImage };
