import type { WebSocket } from 'ws';
import * as C from '../shared/constants';
import { buildMap } from '../shared/map';
import { Bullet, Input, PlayerState, fireBullet, pointInPlayer, spawnState, stepBullet, stepPlayer } from '../shared/sim';
import type { GameEvent, NetPlayer } from '../shared/protocol';

const COLORS = ['#e8524a', '#3d8fe0', '#f2b63c', '#4cc46a', '#b36ae2', '#2fc6c0', '#f07ab8', '#e8e8e8'];
const MAX_QUEUED_INPUTS = 30;
const MAX_INPUTS_PER_TICK = 4;

export interface ServerPlayer {
  id: number;
  name: string;
  color: string;
  ws: WebSocket;
  state: PlayerState;
  inputs: Input[];
  lastSeq: number;
  kills: number;
  deaths: number;
  respawnAt: number;
  protectUntil: number;
}

export class Game {
  readonly map = buildMap();
  tick = 0;
  readonly players = new Map<number, ServerPlayer>();
  private bullets: Bullet[] = [];
  private events: GameEvent[] = [];
  private nextPlayerId = 1;
  private nextBulletId = 1;

  addPlayer(ws: WebSocket, rawName: unknown): ServerPlayer | null {
    if (this.players.size >= C.MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const id = this.nextPlayerId++;
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 12) : '';
    const player: ServerPlayer = {
      id,
      name: name || `Player ${id}`,
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[id % COLORS.length],
      ws,
      state: spawnState(this.map.spawns[0]),
      inputs: [],
      lastSeq: 0,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      protectUntil: 0,
    };
    this.respawn(player);
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: number) {
    this.players.delete(id);
  }

  queueInput(p: ServerPlayer, input: Input) {
    const last = p.inputs.length ? p.inputs[p.inputs.length - 1].seq : p.lastSeq;
    if (input.seq <= last) return;
    p.inputs.push(input);
    if (p.inputs.length > MAX_QUEUED_INPUTS) p.inputs.splice(0, p.inputs.length - MAX_QUEUED_INPUTS);
  }

  step() {
    this.tick++;

    for (const p of this.players.values()) {
      if (!p.state.alive && this.tick >= p.respawnAt) this.respawn(p);
      const n = Math.min(p.inputs.length, MAX_INPUTS_PER_TICK);
      for (let i = 0; i < n; i++) {
        const input = p.inputs.shift()!;
        p.lastSeq = input.seq;
        if (stepPlayer(p.state, input, this.map)) {
          this.bullets.push(fireBullet(this.nextBulletId++, p.id, p.state));
        }
      }
    }

    this.bullets = this.bullets.filter((b) => {
      let victim: ServerPlayer | undefined;
      const result = stepBullet(b, this.map, (x, y) => {
        for (const p of this.players.values()) {
          if (p.id === b.owner || !p.state.alive || this.tick < p.protectUntil) continue;
          if (pointInPlayer(p.state, x, y)) {
            victim = p;
            return true;
          }
        }
        return false;
      });
      if (result === 'hit' && victim) this.damage(victim, b.owner);
      return result === 'flying';
    });
  }

  private damage(victim: ServerPlayer, by: number) {
    victim.state.hp -= C.BULLET_DAMAGE;
    this.events.push({ kind: 'hit', by, victim: victim.id });
    if (victim.state.hp > 0) return;
    victim.state.hp = 0;
    victim.state.alive = false;
    victim.state.vx = 0;
    victim.state.vy = 0;
    victim.respawnAt = this.tick + C.RESPAWN_TICKS;
    victim.deaths++;
    const killer = this.players.get(by);
    if (killer && killer !== victim) killer.kills++;
    this.events.push({ kind: 'kill', by, victim: victim.id });
  }

  private respawn(p: ServerPlayer) {
    const others = [...this.players.values()].filter((o) => o !== p && o.state.alive);
    const ranked = this.map.spawns
      .map((s) => ({
        s,
        d: others.length ? Math.min(...others.map((o) => Math.hypot(o.state.x - s.x, o.state.y - s.y))) : Math.random(),
      }))
      .sort((a, b) => b.d - a.d);
    const pick = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))].s;
    const aim = p.state.aim;
    p.state = spawnState(pick);
    p.state.aim = aim;
    p.protectUntil = this.tick + C.SPAWN_PROTECT_TICKS;
  }

  snapshot(): string {
    const players: NetPlayer[] = [...this.players.values()].map((p) => ({
      ...p.state,
      id: p.id,
      name: p.name,
      color: p.color,
      seq: p.lastSeq,
      kills: p.kills,
      deaths: p.deaths,
      protected: this.tick < p.protectUntil,
      respawnIn: p.state.alive ? 0 : Math.max(0, p.respawnAt - this.tick),
    }));
    const bullets = this.bullets.map(({ id, owner, x, y, vx, vy }) => ({ id, owner, x, y, vx, vy }));
    const msg = JSON.stringify({ t: 'snap', tick: this.tick, players, bullets, events: this.events });
    this.events = [];
    return msg;
  }
}
