import { TICK_RATE } from '../shared/constants';
import type { NetBullet, NetPlayer, ServerMsg } from '../shared/protocol';

export interface Snap {
  tick: number;
  players: Map<number, NetPlayer>;
  bullets: Map<number, NetBullet>;
}

type SnapMsg = Extract<ServerMsg, { t: 'snap' }>;

export class SnapshotBuffer {
  private snaps: Snap[] = [];
  private offset: number | null = null;

  push(msg: SnapMsg, nowMs: number): Snap {
    const snap: Snap = {
      tick: msg.tick,
      players: new Map(msg.players.map((p) => [p.id, p])),
      bullets: new Map(msg.bullets.map((b) => [b.id, b])),
    };
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();

    const sample = msg.tick - (nowMs * TICK_RATE) / 1000;
    if (this.offset === null || Math.abs(sample - this.offset) > TICK_RATE) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.05;
    return snap;
  }

  serverTick(nowMs: number): number {
    return (nowMs * TICK_RATE) / 1000 + (this.offset ?? 0);
  }

  at(renderTick: number): { a: Snap; b: Snap; t: number } | null {
    const s = this.snaps;
    if (!s.length) return null;
    if (renderTick <= s[0].tick) return { a: s[0], b: s[0], t: 0 };
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].tick <= renderTick) {
        const a = s[i];
        const b = s[i + 1] ?? a;
        const t = b === a ? 0 : (renderTick - a.tick) / (b.tick - a.tick);
        return { a, b, t };
      }
    }
    return null;
  }

  reset() {
    this.snaps = [];
    this.offset = null;
  }
}
