import * as C from './constants';
import { GameMap, boxHitsMap, pointHitsMap } from './map';

export interface Input {
  seq: number;
  move: number;
  fly: boolean;
  aim: number;
  shoot: boolean;
  reload: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  flying: boolean;
  fuel: number;
  aim: number;
  hp: number;
  alive: boolean;
  ammo: number;
  reload: number;
  cooldown: number;
}

export interface Bullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

export type BulletResult = 'flying' | 'wall' | 'hit' | 'expired';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function spawnState(spawn: { x: number; y: number }): PlayerState {
  return {
    x: spawn.x - C.PLAYER_W / 2,
    y: spawn.y - C.PLAYER_H,
    vx: 0,
    vy: 0,
    onGround: false,
    flying: false,
    fuel: C.FUEL_MAX,
    aim: 0,
    hp: C.HP_MAX,
    alive: true,
    ammo: C.MAG_SIZE,
    reload: 0,
    cooldown: 0,
  };
}

export function copyState(s: PlayerState): PlayerState {
  return {
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    onGround: s.onGround,
    flying: s.flying,
    fuel: s.fuel,
    aim: s.aim,
    hp: s.hp,
    alive: s.alive,
    ammo: s.ammo,
    reload: s.reload,
    cooldown: s.cooldown,
  };
}

// Runs on both the server and the client (for prediction), so it must stay deterministic.
export function stepPlayer(p: PlayerState, input: Input, map: GameMap): boolean {
  p.aim = input.aim;
  if (!p.alive) {
    p.flying = false;
    return false;
  }

  const target = clamp(input.move, -1, 1) * C.MAX_RUN;
  const maxDv = (p.onGround ? C.GROUND_ACCEL : C.AIR_ACCEL) * C.DT;
  p.vx += clamp(target - p.vx, -maxDv, maxDv);

  p.flying = input.fly && p.fuel > 0;
  p.vy += C.GRAVITY * C.DT;
  if (p.flying) {
    p.vy -= C.JET_THRUST * C.DT;
    p.fuel = Math.max(0, p.fuel - C.FUEL_BURN * C.DT);
  } else {
    p.fuel = Math.min(C.FUEL_MAX, p.fuel + (p.onGround ? C.FUEL_REGEN_GROUND : C.FUEL_REGEN_AIR) * C.DT);
  }
  p.vy = clamp(p.vy, -C.MAX_RISE, C.MAX_FALL);

  moveAndCollide(p, map);
  return stepGun(p, input);
}

function moveAndCollide(p: PlayerState, map: GameMap) {
  const W = C.PLAYER_W;
  const H = C.PLAYER_H;

  p.x += p.vx * C.DT;
  if (boxHitsMap(map, p.x, p.y, W, H)) {
    if (p.vx > 0) p.x = Math.floor((p.x + W) / C.TILE) * C.TILE - W;
    else p.x = (Math.floor(p.x / C.TILE) + 1) * C.TILE;
    p.vx = 0;
  }

  p.onGround = false;
  p.y += p.vy * C.DT;
  if (boxHitsMap(map, p.x, p.y, W, H)) {
    if (p.vy > 0) {
      p.y = Math.floor((p.y + H) / C.TILE) * C.TILE - H;
      p.onGround = true;
    } else {
      p.y = (Math.floor(p.y / C.TILE) + 1) * C.TILE;
    }
    p.vy = 0;
  }
}

function stepGun(p: PlayerState, input: Input): boolean {
  if (p.cooldown > 0) p.cooldown--;
  if (p.reload > 0) {
    p.reload--;
    if (p.reload === 0) p.ammo = C.MAG_SIZE;
    return false;
  }
  if (input.reload && p.ammo < C.MAG_SIZE) {
    p.reload = C.RELOAD_TICKS;
    return false;
  }
  if (!input.shoot || p.cooldown > 0 || p.ammo <= 0) return false;
  p.ammo--;
  p.cooldown = C.FIRE_TICKS;
  if (p.ammo === 0) p.reload = C.RELOAD_TICKS;
  return true;
}

export function fireBullet(id: number, owner: number, p: PlayerState): Bullet {
  const cx = p.x + C.PLAYER_W / 2;
  const cy = p.y + C.GUN_Y;
  const dx = Math.cos(p.aim);
  const dy = Math.sin(p.aim);
  return {
    id,
    owner,
    x: cx + dx * C.MUZZLE_DIST,
    y: cy + dy * C.MUZZLE_DIST,
    vx: dx * C.BULLET_SPEED,
    vy: dy * C.BULLET_SPEED,
    ttl: C.BULLET_TICKS,
  };
}

export function stepBullet(b: Bullet, map: GameMap, hits: (x: number, y: number) => boolean): BulletResult {
  const sx = (b.vx * C.DT) / C.BULLET_SUBSTEPS;
  const sy = (b.vy * C.DT) / C.BULLET_SUBSTEPS;
  for (let i = 0; i < C.BULLET_SUBSTEPS; i++) {
    b.x += sx;
    b.y += sy;
    if (pointHitsMap(map, b.x, b.y)) return 'wall';
    if (hits(b.x, b.y)) return 'hit';
  }
  b.ttl--;
  return b.ttl <= 0 ? 'expired' : 'flying';
}

export function pointInPlayer(p: { x: number; y: number }, x: number, y: number): boolean {
  return x >= p.x && x <= p.x + C.PLAYER_W && y >= p.y && y <= p.y + C.PLAYER_H;
}
