import * as C from '../shared/constants';
import { GameMap, solidAt } from '../shared/map';
import { Circle, Controls, STICK_RADIUS, Stick, stickVector } from './controls';

export interface PlayerView {
  x: number;
  y: number;
  aim: number;
  flying: boolean;
  color: string;
  name: string;
  hp: number;
  protected: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface ScoreRow {
  name: string;
  color: string;
  kills: number;
  deaths: number;
  me: boolean;
}

export interface HudState {
  me: { hp: number; fuel: number; ammo: number; reload: number; alive: boolean; respawnIn: number } | null;
  ping: number | null;
  fps: number;
  scores: ScoreRow[];
  feed: { text: string; age: number }[];
  banner: string | null;
  damageFlash: number;
  controls: Controls;
}

const VIEW_AREA = 1100 * 620;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  scale = 1;
  camX = 0;
  camY = 0;
  private grass: [number, number][] = [];
  private sky!: CanvasGradient;

  constructor(
    private canvas: HTMLCanvasElement,
    private map: GameMap,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    for (const [x, y, w] of map.rects) {
      for (let tx = x; tx < x + w; tx++) if (!solidAt(map, tx, y - 1)) this.grass.push([tx, y]);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.scale = Math.sqrt((this.w * this.h) / VIEW_AREA);
    this.sky = this.ctx.createLinearGradient(0, 0, 0, this.h);
    this.sky.addColorStop(0, '#132038');
    this.sky.addColorStop(0.6, '#28466a');
    this.sky.addColorStop(1, '#b9805e');
  }

  reloadButton(): Circle {
    return { x: this.w - 60, y: this.h * 0.42, r: 26 };
  }

  setCamera(fx: number, fy: number) {
    const vw = this.w / this.scale;
    const vh = this.h / this.scale;
    this.camX = vw >= this.map.width ? (this.map.width - vw) / 2 : clamp(fx - vw / 2, 0, this.map.width - vw);
    this.camY = vh >= this.map.height ? (this.map.height - vh) / 2 : clamp(fy - vh / 2, 0, this.map.height - vh);
  }

  toScreen(x: number, y: number) {
    return { x: (x - this.camX) * this.scale, y: (y - this.camY) * this.scale };
  }

  worldSpace() {
    const k = this.dpr * this.scale;
    this.ctx.setTransform(k, 0, 0, k, -this.camX * k, -this.camY * k);
  }

  screenSpace() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  drawBackground() {
    const { ctx, w, h } = this;
    this.screenSpace();
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, w, h);
    this.hills(0.15, h * 0.62, 40, '#1e3350', 260);
    this.hills(0.3, h * 0.76, 30, '#172840', 170);
  }

  private hills(f: number, base: number, amp: number, color: string, wavelength: number) {
    const { ctx, w, h } = this;
    const shiftX = this.camX * this.scale * f;
    const midY = (this.map.height - h / this.scale) / 2;
    const y0 = base - (this.camY - midY) * this.scale * f;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let sx = 0; sx <= w + 20; sx += 20) {
      const wx = sx + shiftX;
      ctx.lineTo(sx, y0 + Math.sin(wx / wavelength) * amp + Math.sin(wx / (wavelength * 0.37)) * amp * 0.4);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  drawMap() {
    const { ctx } = this;
    const T = C.TILE;
    ctx.fillStyle = '#253142';
    for (const [x, y, w, h] of this.map.rects) ctx.fillRect(x * T, y * T, w * T, h * T);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    for (const [x, y, w, h] of this.map.rects) ctx.strokeRect(x * T + 1, y * T + 1, w * T - 2, h * T - 2);
    ctx.fillStyle = '#5aa84e';
    for (const [tx, ty] of this.grass) ctx.fillRect(tx * T, ty * T, T, 6);
    ctx.fillStyle = '#3f7d3a';
    for (const [tx, ty] of this.grass) ctx.fillRect(tx * T, ty * T + 6, T, 2);
  }

  drawPlayer(v: PlayerView, now: number, showLabel: boolean) {
    const { ctx } = this;
    const W = C.PLAYER_W;
    const cx = v.x + W / 2;
    const facing = Math.cos(v.aim) >= 0 ? 1 : -1;
    const packX = cx - facing * 9;

    ctx.save();
    if (v.protected) ctx.globalAlpha = 0.5 + 0.25 * Math.sin(now / 70);

    if (v.flying) {
      const len = 12 + Math.random() * 10;
      ctx.fillStyle = '#ff9a2e';
      ctx.beginPath();
      ctx.moveTo(packX - 5, v.y + 29);
      ctx.lineTo(packX + 5, v.y + 29);
      ctx.lineTo(packX, v.y + 29 + len);
      ctx.fill();
      ctx.fillStyle = '#fff1a8';
      ctx.beginPath();
      ctx.moveTo(packX - 2.5, v.y + 29);
      ctx.lineTo(packX + 2.5, v.y + 29);
      ctx.lineTo(packX, v.y + 29 + len * 0.55);
      ctx.fill();
    }

    ctx.fillStyle = '#4a515c';
    ctx.fillRect(packX - 4, v.y + 13, 8, 17);
    ctx.fillStyle = '#272c33';
    ctx.fillRect(v.x + 3, v.y + 30, 7, 10);
    ctx.fillRect(v.x + 12, v.y + 30, 7, 10);
    ctx.fillStyle = v.color;
    ctx.beginPath();
    ctx.roundRect(v.x + 1, v.y + 13, W - 2, 19, 4);
    ctx.fill();
    ctx.fillStyle = '#f1c58f';
    ctx.beginPath();
    ctx.arc(cx, v.y + 8, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = v.color;
    ctx.beginPath();
    ctx.arc(cx, v.y + 7, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(cx + facing * 3 - 1.25, v.y + 7.5, 2.5, 2.5);

    ctx.translate(cx, v.y + C.GUN_Y);
    ctx.rotate(v.aim);
    ctx.scale(1, facing);
    ctx.fillStyle = '#1b1e23';
    ctx.fillRect(2, -2.5, 24, 5);
    ctx.fillRect(6, 1, 5, 6);
    ctx.restore();

    if (showLabel) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillText(v.name, cx + 1, v.y - 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(v.name, cx, v.y - 14);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(cx - 15, v.y - 9, 30, 4);
      ctx.fillStyle = v.hp > 35 ? '#57d26b' : '#ee5a4f';
      ctx.fillRect(cx - 15, v.y - 9, (30 * v.hp) / C.HP_MAX, 4);
    }
  }

  drawTracer(x: number, y: number, vx: number, vy: number) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255, 228, 140, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - vx * 0.014, y - vy * 0.014);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  drawParticles(ps: Particle[]) {
    const { ctx } = this;
    for (const p of ps) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawHitmarker(x: number, y: number, age: number) {
    const { ctx } = this;
    const s = 7;
    ctx.globalAlpha = Math.max(0, 1 - age / 300);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawHud(s: HudState) {
    const { ctx, w, h } = this;
    const c = s.controls;
    const pad = c.touchMode ? 24 : 14;
    this.screenSpace();

    if (s.damageFlash > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(220, 30, 30, 0)');
      g.addColorStop(1, `rgba(220, 30, 30, ${0.45 * s.damageFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (s.me) {
      this.bar(pad, pad, 150, 10, s.me.hp / C.HP_MAX, s.me.hp > 35 ? '#57d26b' : '#ee5a4f');
      this.bar(pad, pad + 16, 150, 7, s.me.fuel / C.FUEL_MAX, '#4fb4ff');
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.me.reload > 0 ? 'Reloading' : `${s.me.ammo} / ${C.MAG_SIZE}`, pad, pad + 42);
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#9fb0c6';
    const ping = s.ping === null ? '--' : Math.round(s.ping);
    ctx.fillText(`${ping} ms   ${s.fps} fps`, pad, pad + 60);

    ctx.textAlign = 'right';
    ctx.font = '600 13px system-ui, sans-serif';
    s.scores.forEach((row, i) => {
      const y = pad + 10 + i * 18;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(w - pad - 112, y - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = row.me ? '#ffffff' : '#c3cfdf';
      ctx.fillText(row.name, w - pad - 44, y);
      ctx.fillText(`${row.kills} / ${row.deaths}`, w - pad, y);
    });
    ctx.font = '12px system-ui, sans-serif';
    const feedTop = pad + 18 + s.scores.length * 18;
    s.feed.forEach((f, i) => {
      ctx.globalAlpha = Math.min(1, (5000 - f.age) / 800);
      ctx.fillStyle = '#ffd98a';
      ctx.fillText(f.text, w - pad, feedTop + i * 16);
    });
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    const center = s.me && !s.me.alive ? `Respawning in ${Math.ceil(s.me.respawnIn / C.TICK_RATE)}` : s.banner;
    if (center) {
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillText(center, w / 2 + 2, h * 0.3 + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(center, w / 2, h * 0.3);
    }

    if (c.touchMode) {
      this.stick(c.moveStick, pad + 80, h - pad - 80);
      this.stick(c.aimStick, w - pad - 80, h - pad - 80);
      const r = this.reloadButton();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (s.me && s.me.reload > 0) {
        ctx.strokeStyle = '#f2b63c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - s.me.reload / C.RELOAD_TICKS));
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('R', r.x, r.y + 1);
      ctx.textBaseline = 'alphabetic';
    } else if (c.mouse.seen) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.mouse.x, c.mouse.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(c.mouse.x - 1, c.mouse.y - 1, 2, 2);
    }
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }

  private stick(st: Stick | null, homeX: number, homeY: number) {
    const { ctx } = this;
    const ox = st ? st.ox : homeX;
    const oy = st ? st.oy : homeY;
    ctx.strokeStyle = `rgba(255, 255, 255, ${st ? 0.35 : 0.12})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, STICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    const v = st ? stickVector(st) : { dx: 0, dy: 0 };
    ctx.fillStyle = `rgba(255, 255, 255, ${st ? 0.35 : 0.1})`;
    ctx.beginPath();
    ctx.arc(ox + v.dx * STICK_RADIUS, oy + v.dy * STICK_RADIUS, 24, 0, Math.PI * 2);
    ctx.fill();
  }
}
