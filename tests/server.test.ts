import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { buildMap } from '../src/shared/map';
import type { NetPlayer, ServerMsg } from '../src/shared/protocol';
import { Input, PlayerState, copyState, stepPlayer } from '../src/shared/sim';

let server: ChildProcess;
let base = '';

before(async () => {
  server = spawn(process.execPath, ['dist/server.js'], { env: { ...process.env, PORT: '0' } });
  base = await new Promise<string>((resolve, reject) => {
    let out = '';
    server.stdout!.on('data', (d) => {
      out += d;
      const m = out.match(/localhost:(\d+)/);
      if (m) resolve(`localhost:${m[1]}`);
    });
    server.on('exit', (code) => reject(new Error(`server exited with ${code}: ${out}`)));
  });
});

after(() => {
  server.kill();
});

test('serves the game page and nothing outside the public folder', async () => {
  const page = await fetch(`http://${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>LAN Militia<\/title>/);
  assert.equal((await fetch(`http://${base}/client.js`)).status, 200);
  assert.equal((await fetch(`http://${base}/package.json`)).status, 404);
  assert.equal((await fetch(`http://${base}/%2e%2e/package.json`)).status, 404);
});

test('a client is welcomed, gets 30 snapshots a second, and its prediction matches the server', async () => {
  const map = buildMap();
  const ws = new WebSocket(`ws://${base}/ws`);
  let id = -1;
  let predicted: PlayerState | null = null;
  let pending: Input[] = [];
  const history = new Map<number, PlayerState>();
  let snapshots = 0;
  let checks = 0;
  let mismatches = 0;
  let seq = 0;

  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Tester' })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMsg;
    if (msg.t === 'welcome') id = msg.id;
    if (msg.t !== 'snap') return;
    snapshots++;
    const me = msg.players.find((p: NetPlayer) => p.id === id);
    if (!me) return;
    const mine = history.get(me.seq);
    if (mine) {
      checks++;
      if (mine.x !== me.x || mine.y !== me.y || mine.fuel !== me.fuel || mine.ammo !== me.ammo) mismatches++;
    }
    pending = pending.filter((i) => i.seq > me.seq);
    const next = copyState(me);
    for (const i of pending) stepPlayer(next, i, map);
    predicted = next;
  });

  const timer = setInterval(() => {
    if (!predicted || ws.readyState !== WebSocket.OPEN) return;
    const t = seq / 60;
    const input: Input = {
      seq: ++seq,
      move: Math.sin(t * 2),
      fly: Math.sin(t * 3) > 0.3,
      aim: t,
      shoot: Math.sin(t * 5) > 0,
      reload: false,
    };
    ws.send(JSON.stringify({ t: 'in', ...input }));
    pending.push(input);
    stepPlayer(predicted, input, map);
    history.set(input.seq, copyState(predicted));
  }, 1000 / 60);

  const started = Date.now();
  await new Promise((r) => setTimeout(r, 3000));
  clearInterval(timer);
  ws.close();
  const perSecond = snapshots / ((Date.now() - started) / 1000);

  assert.ok(id > 0, 'should be welcomed with an id');
  assert.ok(perSecond > 25 && perSecond < 35, `expected about 30 snapshots per second, got ${perSecond}`);
  assert.ok(checks > 50, `too few prediction checks (${checks})`);
  assert.equal(mismatches, 0);
});
