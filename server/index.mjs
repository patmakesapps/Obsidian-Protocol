import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

/**
 * Obsidian Protocol multiplayer server.
 *
 * One process does three jobs:
 *  - WebSocket match relay: rooms with join codes, player state fan-out,
 *    hit/kill bookkeeping and match flow (free-for-all, first to KILL_LIMIT).
 *  - Persistent leaderboard, kept in leaderboard.json next to this file.
 *  - Static file serving of ../dist when it exists, so a production deploy is
 *    `npm run build && npm run server` and players just open the URL.
 *
 * The server is a relay, not a simulation: each client owns its own player
 * (position, health, death) and the server owns only the social facts — who is
 * in the room, the scores, and when the match ends. That keeps it cheap enough
 * to run anywhere Node runs.
 */

const PORT = Number(process.env.PORT ?? 8081);
const KILL_LIMIT = Number(process.env.KILL_LIMIT ?? 20);
const MAX_PLAYERS = 8;
const INTERMISSION_MS = 12_000;
// A room survives this long with nobody in it — the creator's page reloads
// into the match between "create" and "join", so an instantly-reaped room
// would make creating a match impossible.
const EMPTY_ROOM_GRACE_MS = 120_000;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'dist');
const LEADERBOARD_FILE = join(HERE, 'leaderboard.json');

// Identity colours, assigned round-robin by join order. Matches the game
// palette family so rings and tags don't clash with the art direction.
const PLAYER_COLORS = [
  0xc4a6ff, // violet
  0xff9a3c, // amber
  0x6effc4, // mint
  0xff4b6b, // danger red
  0x7ad7ff, // ice blue
  0xfff06e, // yellow
  0xff8ade, // pink
  0xb4ff7a, // lime
];

// ------------------------------------------------------------- leaderboard

function loadLeaderboard() {
  try {
    if (existsSync(LEADERBOARD_FILE)) return JSON.parse(readFileSync(LEADERBOARD_FILE, 'utf8'));
  } catch (err) {
    console.error('[leaderboard] unreadable, starting fresh:', err.message);
  }
  return {};
}

const leaderboard = loadLeaderboard();
let saveQueued = false;

function saveLeaderboard() {
  // Coalesce bursts (a kill updates two rows) into one write.
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    try {
      writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (err) {
      console.error('[leaderboard] save failed:', err.message);
    }
  }, 500);
}

function boardEntry(name) {
  if (!leaderboard[name]) {
    leaderboard[name] = { kills: 0, deaths: 0, wins: 0, matches: 0 };
  }
  return leaderboard[name];
}

function topRows(limit = 10) {
  return Object.entries(leaderboard)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
    .slice(0, limit);
}

// ------------------------------------------------------------------- rooms

/** @type {Map<string, Room>} */
const rooms = new Map();
let nextClientId = 1;

function makeCode() {
  // No 0/O/1/I — codes get read out loud across a couch.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

class Room {
  constructor(code, level) {
    this.code = code;
    this.level = level;
    /** @type {Map<number, Client>} */
    this.players = new Map();
    this.state = 'live'; // 'live' | 'intermission'
    this.emptySince = Date.now();
    this._intermissionTimer = null;
  }

  broadcast(message, except = null) {
    const raw = JSON.stringify(message);
    for (const client of this.players.values()) {
      if (client !== except && client.ws.readyState === 1) client.ws.send(raw);
    }
  }

  roster() {
    return [...this.players.values()].map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kills: c.kills,
      deaths: c.deaths,
    }));
  }

  scores() {
    return this.roster().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  pickColor() {
    const used = new Set([...this.players.values()].map((c) => c.color));
    for (const color of PLAYER_COLORS) if (!used.has(color)) return color;
    return PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
  }

  /** A name that is unique within the room, so the kill feed stays readable. */
  uniqueName(wanted) {
    const base = (wanted || 'OPERATIVE').slice(0, 16).toUpperCase();
    let name = base;
    let n = 2;
    const names = new Set([...this.players.values()].map((c) => c.name));
    while (names.has(name)) name = `${base}-${n++}`;
    return name;
  }

  add(client) {
    client.room = this;
    client.color = this.pickColor();
    client.name = this.uniqueName(client.name);
    client.kills = 0;
    client.deaths = 0;
    this.players.set(client.id, client);
    this.emptySince = null;

    this.broadcast(
      { t: 'playerJoined', id: client.id, name: client.name, color: client.color },
      client,
    );
  }

  remove(client) {
    this.players.delete(client.id);
    client.room = null;
    this.broadcast({ t: 'playerLeft', id: client.id, name: client.name });
    this.broadcast({ t: 'scores', rows: this.scores(), limit: KILL_LIMIT });
    if (this.players.size === 0) this.emptySince = Date.now();
  }

  /** A confirmed elimination, reported by the victim's own client. */
  onKill(victim, killerId, headshot) {
    if (this.state !== 'live') return;

    victim.deaths++;
    boardEntry(victim.name).deaths++;

    const killer = this.players.get(killerId) ?? null;
    if (killer && killer !== victim) {
      killer.kills++;
      boardEntry(killer.name).kills++;
    }
    saveLeaderboard();

    this.broadcast({
      t: 'kill',
      victim: victim.id,
      victimName: victim.name,
      victimColor: victim.color,
      killer: killer?.id ?? null,
      killerName: killer?.name ?? null,
      killerColor: killer?.color ?? 0xffffff,
      headshot: !!headshot,
    });
    this.broadcast({ t: 'scores', rows: this.scores(), limit: KILL_LIMIT });

    if (killer && killer.kills >= KILL_LIMIT) this.endMatch(killer);
  }

  endMatch(winner) {
    this.state = 'intermission';
    boardEntry(winner.name).wins++;
    for (const c of this.players.values()) boardEntry(c.name).matches++;
    saveLeaderboard();

    this.broadcast({
      t: 'matchEnd',
      winner: winner.id,
      winnerName: winner.name,
      winnerColor: winner.color,
      rows: this.scores(),
      restartIn: INTERMISSION_MS / 1000,
    });

    this._intermissionTimer = setTimeout(() => {
      this.state = 'live';
      for (const c of this.players.values()) {
        c.kills = 0;
        c.deaths = 0;
      }
      this.broadcast({ t: 'matchStart', rows: this.scores(), limit: KILL_LIMIT });
    }, INTERMISSION_MS);
  }

  dispose() {
    clearTimeout(this._intermissionTimer);
  }
}

// Reap rooms that have sat empty past the grace window.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.emptySince && Date.now() - room.emptySince > EMPTY_ROOM_GRACE_MS) {
      room.dispose();
      rooms.delete(code);
      console.log(`[room ${code}] reaped (empty)`);
    }
  }
}, 30_000);

// --------------------------------------------------------------- websocket

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = nextClientId++;
    this.name = 'OPERATIVE';
    this.color = 0xffffff;
    this.room = null;
    this.kills = 0;
    this.deaths = 0;
  }

  send(message) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(message));
  }
}

const httpServer = createServer(handleHttp);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const client = new Client(ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handleMessage(client, msg);
    } catch (err) {
      console.error('[ws] handler error:', err);
    }
  });

  ws.on('close', () => {
    if (client.room) client.room.remove(client);
  });
});

function handleMessage(client, msg) {
  switch (msg.t) {
    case 'create': {
      const code = makeCode();
      if (!code) return client.send({ t: 'error', message: 'SERVER FULL' });
      const room = new Room(code, typeof msg.level === 'string' ? msg.level : 'arcology');
      rooms.set(code, room);
      console.log(`[room ${code}] created (${room.level})`);
      client.send({ t: 'created', code, level: room.level });
      break;
    }

    // Menu-time probe: which level is this room on, is there space? Used so
    // the client can load the right level BEFORE joining, avoiding a visible
    // join/leave flicker for everyone already in the match.
    case 'peek': {
      const code = String(msg.code ?? '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return client.send({ t: 'error', message: 'MATCH NOT FOUND' });
      client.send({ t: 'peeked', code, level: room.level, players: room.players.size, max: MAX_PLAYERS });
      break;
    }

    case 'join': {
      const code = String(msg.code ?? '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return client.send({ t: 'error', message: 'MATCH NOT FOUND' });
      if (room.players.size >= MAX_PLAYERS) return client.send({ t: 'error', message: 'MATCH FULL' });
      if (client.room) client.room.remove(client);

      client.name = String(msg.name ?? 'OPERATIVE');
      room.add(client);
      client.send({
        t: 'joined',
        id: client.id,
        code,
        level: room.level,
        name: client.name,
        color: client.color,
        players: room.roster().filter((p) => p.id !== client.id),
        rows: room.scores(),
        limit: KILL_LIMIT,
        state: room.state,
      });
      console.log(`[room ${code}] ${client.name} joined (${room.players.size} in)`);
      break;
    }

    // High-frequency movement state — relayed untouched to everyone else.
    case 'state': {
      if (!client.room) return;
      msg.id = client.id;
      client.room.broadcast(msg, client);
      break;
    }

    // A shot was fired: everyone else draws the tracer and hears it.
    case 'fire': {
      if (!client.room) return;
      msg.id = client.id;
      client.room.broadcast(msg, client);
      break;
    }

    // Shooter → victim only. The victim's client owns its own health.
    case 'hit': {
      if (!client.room) return;
      const target = client.room.players.get(msg.target);
      target?.send({ t: 'hit', from: client.id, damage: msg.damage, headshot: !!msg.headshot });
      break;
    }

    // Reported by the victim once its own health hits zero.
    case 'death': {
      if (!client.room) return;
      client.room.onKill(client, msg.killer ?? null, msg.headshot);
      break;
    }

    case 'respawn': {
      if (!client.room) return;
      client.room.broadcast({ t: 'respawn', id: client.id }, client);
      break;
    }

    case 'leaderboard': {
      client.send({ t: 'leaderboard', rows: topRows(10) });
      break;
    }
  }
}

// ------------------------------------------------------------ static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

function handleHttp(req, res) {
  // A tiny JSON endpoint so the menu can show the leaderboard over plain HTTP
  // too (some corporate networks are weird about websockets until the game
  // actually starts).
  if (req.url === '/api/leaderboard') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ rows: topRows(10) }));
    return;
  }

  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Obsidian Protocol multiplayer server is running.\nBuild the game (npm run build) to serve it from here too.\n');
    return;
  }

  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let filePath = normalize(join(DIST, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html'); // SPA fallback
  }

  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

httpServer.listen(PORT, () => {
  console.log(`Obsidian Protocol server listening on :${PORT}`);
  console.log(`  ws relay : ws://<this-machine>:${PORT}`);
  console.log(`  game     : ${existsSync(DIST) ? `http://<this-machine>:${PORT}` : '(no dist/ build yet — dev clients connect from vite)'}`);
});
