import type { Input } from '../shared/sim';

export interface Stick {
  pointer: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export const STICK_RADIUS = 60;

export class Controls {
  touchMode = false;
  moveStick: Stick | null = null;
  aimStick: Stick | null = null;
  mouse = { x: 0, y: 0, down: false, seen: false };
  private keys = new Set<string>();
  private aim = 0;
  private reloadTapped = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private reloadButton: () => Circle,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.setTouchMode(false);
      this.mouse = { x: e.clientX, y: e.clientY, down: e.button === 0, seen: true };
      return;
    }
    this.setTouchMode(true);
    const btn = this.reloadButton();
    if (Math.hypot(e.clientX - btn.x, e.clientY - btn.y) <= btn.r + 8) {
      this.reloadTapped = true;
      return;
    }
    const stick: Stick = { pointer: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    if (e.clientX < window.innerWidth / 2) {
      if (!this.moveStick) this.moveStick = stick;
    } else if (!this.aimStick) {
      this.aimStick = stick;
    }
    this.canvas.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.seen = true;
      return;
    }
    for (const s of [this.moveStick, this.aimStick]) {
      if (s && s.pointer === e.pointerId) {
        s.x = e.clientX;
        s.y = e.clientY;
      }
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouse.down = false;
      return;
    }
    if (this.moveStick?.pointer === e.pointerId) this.moveStick = null;
    if (this.aimStick?.pointer === e.pointerId) this.aimStick = null;
  }

  private key(e: KeyboardEvent, pressed: boolean) {
    if (e.target instanceof HTMLInputElement) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (pressed) {
      this.keys.add(e.code);
      if (!e.repeat) this.setTouchMode(false);
    } else {
      this.keys.delete(e.code);
    }
  }

  private setTouchMode(on: boolean) {
    this.touchMode = on;
    this.canvas.classList.toggle('mouse', !on);
  }

  sample(playerScreen: { x: number; y: number }): Omit<Input, 'seq'> {
    const k = this.keys;
    let move = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let fly = k.has('KeyW') || k.has('Space') || k.has('ArrowUp');
    let shoot = false;

    if (!this.touchMode && this.mouse.seen) {
      this.aim = Math.atan2(this.mouse.y - playerScreen.y, this.mouse.x - playerScreen.x);
      shoot = this.mouse.down;
    }

    if (this.moveStick) {
      const { dx, dy } = stickVector(this.moveStick);
      if (Math.abs(dx) > 0.2) move = Math.max(-1, Math.min(1, dx * 1.25));
      fly = fly || dy < -0.35;
    }

    if (this.aimStick) {
      const { dx, dy, mag } = stickVector(this.aimStick);
      if (mag > 0.15) this.aim = Math.atan2(dy, dx);
      shoot = mag > 0.55;
    }

    const reload = k.has('KeyR') || this.reloadTapped;
    this.reloadTapped = false;
    return { move, fly, aim: this.aim, shoot, reload };
  }
}

export function stickVector(s: Stick) {
  const dx = (s.x - s.ox) / STICK_RADIUS;
  const dy = (s.y - s.oy) / STICK_RADIUS;
  const mag = Math.hypot(dx, dy);
  const k = mag > 1 ? 1 / mag : 1;
  return { dx: dx * k, dy: dy * k, mag: Math.min(mag, 1) };
}
