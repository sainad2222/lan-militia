import type { Bullet, PlayerState } from './sim';

export interface NetPlayer extends PlayerState {
  id: number;
  name: string;
  color: string;
  seq: number;
  kills: number;
  deaths: number;
  protected: boolean;
  respawnIn: number;
}

export type NetBullet = Omit<Bullet, 'ttl'>;

export type GameEvent =
  | { kind: 'kill'; by: number; victim: number }
  | { kind: 'hit'; by: number; victim: number };

export type ClientMsg =
  | { t: 'join'; name: string }
  | { t: 'in'; seq: number; move: number; fly: boolean; aim: number; shoot: boolean; reload: boolean }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'full' }
  | { t: 'pong'; c: number }
  | { t: 'snap'; tick: number; players: NetPlayer[]; bullets: NetBullet[]; events: GameEvent[] };
