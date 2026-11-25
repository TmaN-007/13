import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/t/:code', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

/** @type {Map<string, Room>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

function broadcast(room, fx) {
  for (const p of room.players) {
    if (p.isBot || !p.sockets) continue;
    const view = room.view(p.id);
    for (const sid of p.sockets) io.to(sid).emit('state', view, fx);
  }
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
const cleanToken = (t) => String(t || '').slice(0, 64);

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const attach = (r, token, name) => {
    const res = r.join(token, name);
    if (res.error) return res.error;
    if (room && room !== r) detach();
    room = r;
    me = res.player;
    me.sockets ??= new Set();
    me.sockets.add(socket.id);
    me.connected = true;
    room.emptySince = null;
    room.commit();
    return null;
  };

  const detach = () => {
    if (!room || !me) return;
    me.sockets?.delete(socket.id);
    if (!me.sockets?.size) me.connected = false;
    room.commit();
  };

  socket.on('create', ({ name, token } = {}, ack) => {
    const r = new Room(makeCode(), broadcast);
    rooms.set(r.code, r);
    const err = attach(r, cleanToken(token), cleanName(name));
    ack?.(err ? { error: err } : { code: r.code });
  });

  socket.on('join', ({ code, name, token } = {}, ack) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return ack?.({ error: "Couldn't find a table with that code." });
    const err = attach(r, cleanToken(token), cleanName(name));
    ack?.(err ? { error: err } : { code: r.code });
  });

  const hostOnly = (fn) => (payload, ack) => {
    if (!room || !me) return ack?.({ error: 'Not at a table.' });
    if (room.hostId !== me.id) return ack?.({ error: 'Only the host can do that.' });
    const err = fn(payload);
    if (!err) room.commit();
    ack?.(err ? { error: err } : { ok: true });
  };

  socket.on('settings', hostOnly((patch) => room.updateSettings(patch || {})));
  socket.on('addBot', hostOnly(() => room.addBot()));
  socket.on('kick', hostOnly((id) => {
    if (id === me.id) return "You can't kick yourself.";
    const p = room.player(id);
    if (!p) return 'No such player.';
    for (const sid of p.sockets || []) io.to(sid).emit('kicked');
    room.removePlayer(id);
    return null;
  }));
  socket.on('start', hostOnly(() => room.start()));

  const act = (action) => (payload, ack) => {
    if (!room || !me) return ack?.({ error: 'Not at a table.' });
    const err = room.act(me.id, action, payload);
    ack?.(err ? { error: err } : { ok: true });
  };
  socket.on('play', act('play'));
  socket.on('pass', act('pass'));
  socket.on('tribute', act('tribute'));

  socket.on('chat', (text) => room && me && room.addChat(me.id, text));

  socket.on('leave', (_p, ack) => {
    if (room && me) {
      me.sockets?.delete(socket.id);
      room.removePlayer(me.id);
      room.commit();
    }
    room = null;
    me = null;
    ack?.({ ok: true });
  });

  socket.on('disconnect', detach);
});

// Reap tables nobody is connected to.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.humans.some((p) => p.connected);
    if (anyone) { r.emptySince = null; continue; }
    r.emptySince ??= now;
    if (now - r.emptySince > 10 * 60 * 1000) { r.destroy(); rooms.delete(code); }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Thirteen is dealing on http://localhost:${PORT}`);
});
