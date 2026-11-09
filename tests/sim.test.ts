import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/shared/constants';
import { buildMap, boxHitsMap } from '../src/shared/map';
import { Input, PlayerState, copyState, spawnState, stepPlayer } from '../src/shared/sim';

const map = buildMap();
const FLOOR_Y = 33 * C.TILE;

let seq = 0;
const input = (over: Partial<Input> = {}): Input => ({
  seq: ++seq,
  move: 0,
  fly: false,
  aim: 0,
  shoot: false,
  reload: false,
  ...over,
});

function run(p: PlayerState, ticks: number, over: Partial<Input> = {}) {
  let shots = 0;
  for (let i = 0; i < ticks; i++) if (stepPlayer(p, input(over), map)) shots++;
  return shots;
}

test('every spawn point is clear of walls and has ground underneath', () => {
  for (const s of map.spawns) {
    const p = spawnState(s);
    assert.equal(boxHitsMap(map, p.x, p.y, C.PLAYER_W, C.PLAYER_H), false, `spawn ${s.x},${s.y} is inside a wall`);
    run(p, 5);
    assert.equal(p.onGround, true, `spawn ${s.x},${s.y} has no ground`);
  }
});

test('a standing player rests exactly on the floor', () => {
  const p = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  run(p, 120);
  assert.equal(p.onGround, true);
  assert.equal(p.y + C.PLAYER_H, FLOOR_Y);
});

test('running into a wall stops at its edge', () => {
  const p = spawnState({ x: 21 * C.TILE, y: FLOOR_Y });
  run(p, 120, { move: 1 });
  assert.equal(p.x + C.PLAYER_W, 24 * C.TILE);
  assert.equal(p.vx, 0);
});

test('the jetpack lifts the player and burns fuel, which refills on the ground', () => {
  const p = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  run(p, 2);
  const startY = p.y;
  run(p, 30, { fly: true });
  assert.ok(p.y < startY - 50, 'player should have risen');
  assert.ok(p.fuel < C.FUEL_MAX);
  run(p, 400);
  assert.equal(p.onGround, true);
  assert.equal(p.fuel, C.FUEL_MAX);
});

test('flying stops when fuel runs out', () => {
  const p = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  run(p, 60 * 5, { fly: true });
  assert.ok(p.fuel < 1);
  assert.equal(p.flying, false);
});

test('the gun respects fire rate, empties the magazine, then reloads', () => {
  const p = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  assert.equal(run(p, C.FIRE_TICKS * 5, { shoot: true }), 5);
  assert.equal(run(p, C.FIRE_TICKS * C.MAG_SIZE, { shoot: true }), C.MAG_SIZE - 5);
  assert.equal(p.ammo, 0);
  assert.ok(p.reload > 0);
  run(p, C.RELOAD_TICKS);
  assert.equal(p.ammo, C.MAG_SIZE);
});

test('dead players ignore input', () => {
  const p = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  p.alive = false;
  const before = copyState(p);
  assert.equal(run(p, 30, { move: 1, fly: true, shoot: true }), 0);
  assert.equal(p.x, before.x);
  assert.equal(p.y, before.y);
});

test('the same inputs always produce the same state (client prediction relies on this)', () => {
  let rng = 42;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const inputs = Array.from({ length: 3000 }, () =>
    input({ move: rand() * 2 - 1, fly: rand() < 0.4, aim: rand() * 6, shoot: rand() < 0.5, reload: rand() < 0.01 }),
  );
  const a = spawnState(map.spawns[3]);
  const b = copyState(a);
  for (const i of inputs) stepPlayer(a, i, map);
  for (const i of inputs) stepPlayer(b, { ...i }, map);
  assert.deepEqual(a, b);
  assert.equal(boxHitsMap(map, a.x, a.y, C.PLAYER_W, C.PLAYER_H), false, 'player ended up inside a wall');
});
