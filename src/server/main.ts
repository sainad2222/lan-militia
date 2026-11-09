import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { WebSocket, WebSocketServer } from 'ws';
import { SNAPSHOT_EVERY, TICK_RATE } from '../shared/constants';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { Input } from '../shared/sim';
import { Game, ServerPlayer } from './game';

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const FILES: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/client.js.map': ['client.js.map', 'application/json'],
};

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  const entry = FILES[url];
  if (!entry) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(path.join(PUBLIC_DIR, entry[0]), (err, data) => {
    if (err) {
      res.writeHead(500).end('Missing build output. Run npm start.');
      return;
    }
    res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-cache' }).end(data);
  });
});

const game = new Game();
const wss = new WebSocketServer({ server, path: '/ws' });

const send = (ws: WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

wss.on('connection', (ws) => {
  let player: ServerPlayer | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'join' && !player) {
      player = game.addPlayer(ws, msg.name);
      if (!player) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }
      send(ws, { t: 'welcome', id: player.id });
      console.log(`+ ${player.name} joined (${game.players.size} playing)`);
    } else if (msg.t === 'in' && player) {
      const input: Input = {
        seq: num(msg.seq),
        move: Math.max(-1, Math.min(1, num(msg.move))),
        fly: msg.fly === true,
        aim: num(msg.aim),
        shoot: msg.shoot === true,
        reload: msg.reload === true,
      };
      game.queueInput(player, input);
    } else if (msg.t === 'ping') {
      send(ws, { t: 'pong', c: num(msg.c) });
    }
  });

  ws.on('close', () => {
    if (!player) return;
    game.removePlayer(player.id);
    console.log(`- ${player.name} left (${game.players.size} playing)`);
  });
});

const tickMs = 1000 / TICK_RATE;
let nextTickAt = performance.now();

function loop() {
  const now = performance.now();
  let ran = 0;
  while (now >= nextTickAt && ran < 5) {
    game.step();
    if (game.tick % SNAPSHOT_EVERY === 0) {
      const snap = game.snapshot();
      for (const p of game.players.values()) {
        if (p.ws.readyState === WebSocket.OPEN && p.ws.bufferedAmount < 1 << 20) p.ws.send(snap);
      }
    }
    nextTickAt += tickMs;
    ran++;
  }
  if (now - nextTickAt > 250) nextTickAt = now;
  setTimeout(loop, Math.max(0, nextTickAt - performance.now()));
}

function lanAddresses(): string[] {
  const found: { addr: string; rank: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/docker|veth|br-|vbox|vmnet|utun|tailscale|zt/i.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const rank = a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2;
      found.push({ addr: a.address, rank });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.addr);
}

server.listen(PORT, '0.0.0.0', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  const addrs = lanAddresses();
  console.log('\nLAN Militia is running.\n');
  if (addrs.length) {
    const url = `http://${addrs[0]}:${port}`;
    console.log(`Phones on the same Wi-Fi join at:  ${url}\n`);
    qrcode.generate(url, { small: true });
    for (const other of addrs.slice(1)) console.log(`Other address:  http://${other}:${port}`);
  } else {
    console.log('No Wi-Fi address found. Connect this laptop to Wi-Fi or a hotspot.');
  }
  console.log(`On this laptop:  http://localhost:${port}\n`);
  loop();
});
