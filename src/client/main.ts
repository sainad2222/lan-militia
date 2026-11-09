import * as C from '../shared/constants';
import { buildMap } from '../shared/map';
import type { ClientMsg, GameEvent, NetPlayer, ServerMsg } from '../shared/protocol';
import { Bullet, Input, PlayerState, copyState, fireBullet, pointInPlayer, stepBullet, stepPlayer } from '../shared/sim';
import { Controls } from './controls';
import { Particle, PlayerView, Renderer } from './render';
import { Snap, SnapshotBuffer } from './snapshots';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('game');
const overlay = byId<HTMLDivElement>('overlay');
const nameInput = byId<HTMLInputElement>('name');
const playBtn = byId<HTMLButtonElement>('play');
const statusEl = byId<HTMLParagraphElement>('status');

const map = buildMap();
const renderer = new Renderer(canvas, map);
const controls = new Controls(canvas, () => renderer.reloadButton());
const snaps = new SnapshotBuffer();

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

let ws: WebSocket | null = null;
let closeReason = '';
let myId = -1;
let latest: Snap | null = null;
let me: NetPlayer | null = null;
let predicted: PlayerState | null = null;
let prev: PlayerState | null = null;
let pending: Input[] = [];
let seq = 0;
const smooth = { x: 0, y: 0 };
let localBullets: Bullet[] = [];
let nextLocalBulletId = -1;
let remoteViews = new Map<number, PlayerView>();
let particles: Particle[] = [];
let hitmarkers: { x: number; y: number; t: number }[] = [];
let feed: { text: string; t: number }[] = [];
let banner: { text: string; t: number } | null = null;
let damageFlash = 0;
let ping: number | null = null;
let aimOrigin = { x: 0, y: 0 };

try {
  nameInput.value = localStorage.getItem('lan-militia-name') ?? '';
} catch {}

playBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  try {
    localStorage.setItem('lan-militia-name', name);
  } catch {}
  void enterFullscreen();
  connect(name);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});

async function enterFullscreen() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {}
}

function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(name: string) {
  if (ws) return;
  closeReason = '';
  statusEl.textContent = 'Connecting...';
  playBtn.disabled = true;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => send({ t: 'join', name });
  sock.onmessage = (e) => onMessage(JSON.parse(e.data as string) as ServerMsg);
  sock.onclose = () => {
    if (ws !== sock) return;
    const wasPlaying = myId >= 0;
    ws = null;
    resetGame();
    overlay.classList.remove('hidden');
    playBtn.disabled = false;
    statusEl.textContent =
      closeReason || (wasPlaying ? 'Disconnected. Tap Play to rejoin.' : 'Could not reach the game server.');
  };
}

function resetGame() {
  myId = -1;
  latest = null;
  me = null;
  predicted = null;
  prev = null;
  pending = [];
  seq = 0;
  localBullets = [];
  remoteViews.clear();
  snaps.reset();
  ping = null;
}

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome':
      myId = msg.id;
      overlay.classList.add('hidden');
      statusEl.textContent = '';
      playBtn.disabled = false;
      break;
    case 'full':
      closeReason = `The game is full (${C.MAX_PLAYERS} players).`;
      break;
    case 'pong':
      ping = performance.now() - msg.c;
      break;
    case 'snap':
      onSnapshot(msg);
      break;
  }
}

function onSnapshot(msg: Extract<ServerMsg, { t: 'snap' }>) {
  latest = snaps.push(msg, performance.now());
  const mine = latest.players.get(myId);
  if (mine) {
    if (me && mine.hp < me.hp) damageFlash = 1;
    me = mine;
    reconcile(mine);
  }
  for (const e of msg.events) onEvent(e);
}

// Rewind to the server's copy of our player, then replay inputs it has not processed yet.
function reconcile(server: NetPlayer) {
  const next = copyState(server);
  pending = pending.filter((i) => i.seq > server.seq);
  for (const input of pending) stepPlayer(next, input, map);

  if (predicted && prev) {
    const dx = next.x - predicted.x;
    const dy = next.y - predicted.y;
    if (Math.hypot(dx, dy) < 120) {
      smooth.x -= dx;
      smooth.y -= dy;
      prev.x += dx;
      prev.y += dy;
    } else {
      prev = copyState(next);
      smooth.x = smooth.y = 0;
    }
  } else {
    prev = copyState(next);
  }
  predicted = next;
}

function playerName(id: number) {
  return latest?.players.get(id)?.name ?? 'Someone';
}

function playerCenter(id: number): { x: number; y: number } | null {
  const v = id === myId ? predicted : (remoteViews.get(id) ?? latest?.players.get(id));
  return v ? { x: v.x + C.PLAYER_W / 2, y: v.y + C.PLAYER_H / 2 } : null;
}

function onEvent(e: GameEvent) {
  const now = performance.now();
  if (e.kind === 'hit') {
    const at = e.by === myId ? playerCenter(e.victim) : null;
    if (at) hitmarkers.push({ ...at, t: now });
    return;
  }
  const victim = playerName(e.victim);
  feed.push({ text: e.by === e.victim ? `${victim} died` : `${playerName(e.by)} killed ${victim}`, t: now });
  if (feed.length > 5) feed.shift();
  if (e.by === myId && e.victim !== myId) banner = { text: `You eliminated ${victim}`, t: now };
  const at = playerCenter(e.victim);
  const color = latest?.players.get(e.victim)?.color ?? '#ffffff';
  if (at) burst(at.x, at.y, color, 22, 320);
}

function burst(x: number, y: number, color: string, count: number, speed: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    const life = 0.3 + Math.random() * 0.4;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 3 + Math.random() * 3 });
  }
}

function fixedTick() {
  if (!predicted || ws?.readyState !== WebSocket.OPEN) return;
  const input: Input = { seq: ++seq, ...controls.sample(aimOrigin) };
  send({ t: 'in', ...input });
  pending.push(input);
  if (pending.length > 120) pending.shift();

  prev = copyState(predicted);
  if (stepPlayer(predicted, input, map)) {
    localBullets.push(fireBullet(nextLocalBulletId--, myId, predicted));
  }

  const targets = [...remoteViews.values()].filter((v) => !v.protected);
  localBullets = localBullets.filter((b) => {
    const r = stepBullet(b, map, (x, y) => targets.some((t) => pointInPlayer(t, x, y)));
    if (r === 'wall' || r === 'hit') burst(b.x, b.y, r === 'hit' ? '#ff6b5a' : '#ffd27a', 5, 160);
    return r === 'flying';
  });
}

function viewOf(p: NetPlayer): PlayerView {
  return { x: p.x, y: p.y, aim: p.aim, flying: p.flying, color: p.color, name: p.name, hp: p.hp, protected: p.protected };
}

function updateRemoteViews(now: number) {
  remoteViews = new Map();
  const s = snaps.at(snaps.serverTick(now) - C.INTERP_TICKS);
  if (!s) return s;
  for (const [id, b] of s.b.players) {
    if (id === myId) continue;
    const a = s.a.players.get(id) ?? b;
    if (a.alive && b.alive && Math.hypot(b.x - a.x, b.y - a.y) < 150) {
      remoteViews.set(id, {
        ...viewOf(b),
        x: lerp(a.x, b.x, s.t),
        y: lerp(a.y, b.y, s.t),
        aim: lerpAngle(a.aim, b.aim, s.t),
      });
    } else if (a.alive && !b.alive) {
      remoteViews.set(id, viewOf(a));
    } else if (b.alive) {
      remoteViews.set(id, viewOf(b));
    }
  }
  return s;
}

function render(now: number, alpha: number, dt: number, fps: number) {
  let myView: PlayerView | null = null;
  if (predicted && prev && me) {
    myView = {
      ...viewOf(me),
      x: lerp(prev.x, predicted.x, alpha) + smooth.x,
      y: lerp(prev.y, predicted.y, alpha) + smooth.y,
      aim: predicted.aim,
      flying: predicted.flying,
      hp: predicted.hp,
    };
  }

  if (myView) renderer.setCamera(myView.x + C.PLAYER_W / 2, myView.y + C.PLAYER_H / 2);
  else renderer.setCamera(map.width / 2, map.height / 2);
  if (myView) aimOrigin = renderer.toScreen(myView.x + C.PLAYER_W / 2, myView.y + C.GUN_Y);

  renderer.drawBackground();
  renderer.worldSpace();
  renderer.drawMap();

  const s = updateRemoteViews(now);
  for (const v of remoteViews.values()) renderer.drawPlayer(v, now, true);
  if (myView && predicted?.alive) renderer.drawPlayer(myView, now, false);

  if (s) {
    for (const [id, b] of s.b.bullets) {
      if (b.owner === myId) continue;
      const a = s.a.bullets.get(id);
      if (a) renderer.drawTracer(lerp(a.x, b.x, s.t), lerp(a.y, b.y, s.t), b.vx, b.vy);
    }
  }
  for (const b of localBullets) renderer.drawTracer(b.x + b.vx * C.DT * alpha, b.y + b.vy * C.DT * alpha, b.vx, b.vy);

  for (const p of particles) {
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
  renderer.drawParticles(particles);

  hitmarkers = hitmarkers.filter((h) => now - h.t < 300);
  for (const h of hitmarkers) renderer.drawHitmarker(h.x, h.y, now - h.t);

  feed = feed.filter((f) => now - f.t < 5000);
  if (banner && now - banner.t > 2000) banner = null;
  const scores = latest
    ? [...latest.players.values()]
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((p) => ({ name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, me: p.id === myId }))
    : [];

  renderer.drawHud({
    me:
      predicted && me
        ? {
            hp: predicted.hp,
            fuel: predicted.fuel,
            ammo: predicted.ammo,
            reload: predicted.reload,
            alive: predicted.alive,
            respawnIn: me.respawnIn,
          }
        : null,
    ping,
    fps,
    scores,
    feed: feed.map((f) => ({ text: f.text, age: now - f.t })),
    banner: banner?.text ?? null,
    damageFlash,
    controls,
  });
}

let acc = 0;
let last = performance.now();
let frames = 0;
let fps = 0;
let fpsSince = last;

function frame(now: number) {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  acc += dt;
  while (acc >= C.DT) {
    fixedTick();
    acc -= C.DT;
  }
  const decay = Math.exp(-dt * 12);
  smooth.x *= decay;
  smooth.y *= decay;
  damageFlash = Math.max(0, damageFlash - dt * 2.5);

  frames++;
  if (now - fpsSince >= 1000) {
    fps = frames;
    frames = 0;
    fpsSince = now;
  }
  render(now, acc / C.DT, dt, fps);
  requestAnimationFrame(frame);
}

setInterval(() => send({ t: 'ping', c: performance.now() }), 1000);
requestAnimationFrame(frame);
