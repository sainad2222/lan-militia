import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebSocket } from 'ws';
import * as C from '../src/shared/constants';
import { Game } from '../src/server/game';
import { spawnState } from '../src/shared/sim';

const fakeSocket = {} as WebSocket;
const FLOOR_Y = 33 * C.TILE;

function duel() {
  const game = new Game();
  const a = game.addPlayer(fakeSocket, 'Alice')!;
  const b = game.addPlayer(fakeSocket, 'Bob')!;
  a.state = spawnState({ x: 14.5 * C.TILE, y: FLOOR_Y });
  b.state = spawnState({ x: 20.5 * C.TILE, y: FLOOR_Y });
  a.protectUntil = b.protectUntil = 0;
  return { game, a, b };
}

test('bullets damage, kill, credit the shooter and the victim respawns', () => {
  const { game, a, b } = duel();
  const events: { kind: string }[] = [];
  let seq = 0;
  let killedAt = -1;
  for (let t = 0; t < 400; t++) {
    seq++;
    game.queueInput(a, { seq, move: 0, fly: false, aim: 0, shoot: true, reload: false });
    game.queueInput(b, { seq, move: 0, fly: false, aim: Math.PI, shoot: false, reload: false });
    game.step();
    if (!b.state.alive && killedAt < 0) killedAt = game.tick;
    events.push(...JSON.parse(game.snapshot()).events);
  }
  const hits = events.filter((e) => e.kind === 'hit').length;
  assert.equal(hits, Math.ceil(C.HP_MAX / C.BULLET_DAMAGE) + countHitsAfterRespawn(events));
  assert.equal(events.filter((e) => e.kind === 'kill').length, 1);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.ok(killedAt > 0);
  assert.equal(b.state.alive, true, 'victim should have respawned');
  assert.equal(b.state.hp, C.HP_MAX);
});

function countHitsAfterRespawn(events: { kind: string }[]) {
  const killIndex = events.findIndex((e) => e.kind === 'kill');
  return events.slice(killIndex + 1).filter((e) => e.kind === 'hit').length;
}

test('spawn protection blocks damage', () => {
  const { game, a, b } = duel();
  b.protectUntil = Number.MAX_SAFE_INTEGER;
  for (let seq = 1; seq < 200; seq++) {
    game.queueInput(a, { seq, move: 0, fly: false, aim: 0, shoot: true, reload: false });
    game.step();
  }
  assert.equal(b.state.hp, C.HP_MAX);
});

test('the server refuses players beyond the limit and gives everyone a different color', () => {
  const game = new Game();
  const players = Array.from({ length: C.MAX_PLAYERS }, (_, i) => game.addPlayer(fakeSocket, `P${i}`));
  assert.ok(players.every(Boolean));
  assert.equal(new Set(players.map((p) => p!.color)).size, C.MAX_PLAYERS);
  assert.equal(game.addPlayer(fakeSocket, 'late'), null);
});

test('names are trimmed and limited, with a default for blanks', () => {
  const game = new Game();
  assert.equal(game.addPlayer(fakeSocket, '  A very long player name  ')!.name, 'A very long ');
  assert.match(game.addPlayer(fakeSocket, '   ')!.name, /^Player \d+$/);
  assert.match(game.addPlayer(fakeSocket, 42)!.name, /^Player \d+$/);
});

test('old or repeated inputs are ignored', () => {
  const game = new Game();
  const p = game.addPlayer(fakeSocket, 'P')!;
  const base = { move: 0, fly: false, aim: 0, shoot: false, reload: false };
  game.queueInput(p, { ...base, seq: 5 });
  game.queueInput(p, { ...base, seq: 5 });
  game.queueInput(p, { ...base, seq: 3 });
  game.queueInput(p, { ...base, seq: 6 });
  assert.deepEqual(p.inputs.map((i) => i.seq), [5, 6]);
});
