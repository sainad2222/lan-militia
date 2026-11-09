import { TILE } from './constants';

export type Rect = [x: number, y: number, w: number, h: number];

export interface GameMap {
  cols: number;
  rows: number;
  width: number;
  height: number;
  rects: Rect[];
  solid: Uint8Array;
  spawns: { x: number; y: number }[];
}

const COLS = 64;
const ROWS = 36;

const RECTS: Rect[] = [
  [0, 0, 64, 1],
  [0, 0, 1, 36],
  [63, 0, 1, 36],
  [0, 33, 64, 3],
  [1, 29, 10, 4],
  [53, 29, 10, 4],
  [24, 30, 2, 3],
  [38, 30, 2, 3],
  [20, 25, 3, 2],
  [41, 25, 3, 2],
  [8, 22, 10, 1],
  [46, 22, 10, 1],
  [27, 20, 10, 1],
  [31, 10, 2, 10],
  [28, 9, 8, 1],
  [3, 14, 8, 1],
  [53, 14, 8, 1],
  [18, 15, 8, 1],
  [38, 15, 8, 1],
  [12, 7, 7, 1],
  [45, 7, 7, 1],
];

const SPAWNS: [number, number][] = [
  [5, 29], [58, 29], [14, 33], [49, 33], [32, 33],
  [12, 22], [51, 22], [29, 20], [35, 20],
  [6, 14], [57, 14], [15, 7], [48, 7], [29, 9], [34, 9],
];

export function buildMap(): GameMap {
  const solid = new Uint8Array(COLS * ROWS);
  for (const [x, y, w, h] of RECTS) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) solid[ty * COLS + tx] = 1;
    }
  }
  return {
    cols: COLS,
    rows: ROWS,
    width: COLS * TILE,
    height: ROWS * TILE,
    rects: RECTS,
    solid,
    spawns: SPAWNS.map(([tx, ty]) => ({ x: (tx + 0.5) * TILE, y: ty * TILE })),
  };
}

export function solidAt(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return true;
  return map.solid[ty * map.cols + tx] === 1;
}

export function boxHitsMap(map: GameMap, x: number, y: number, w: number, h: number): boolean {
  // The -1e-6 keeps a box resting exactly on a tile edge from counting as inside the next tile.
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 1e-6) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 1e-6) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (solidAt(map, tx, ty)) return true;
    }
  }
  return false;
}

export function pointHitsMap(map: GameMap, x: number, y: number): boolean {
  return solidAt(map, Math.floor(x / TILE), Math.floor(y / TILE));
}
