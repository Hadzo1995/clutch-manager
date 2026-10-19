import { EYE, STEP_UP } from './types';
import type { CellKind, MapGeometry, MapSource, Region } from './types';

export function parseMap(src: MapSource): MapGeometry {
  const [w, h] = src.size;
  const kind: CellKind[] = new Array(w * h).fill('void');
  const height: number[] = new Array(w * h).fill(0);
  const each = (r: readonly unknown[], fn: (x: number, y: number, i: number) => void) => {
    const [rx, ry, rw, rh] = r as [number, number, number, number];
    for (let y = Math.max(0, ry); y < Math.min(h, ry + rh); y++) for (let x = Math.max(0, rx); x < Math.min(w, rx + rw); x++) fn(x, y, y * w + x);
  };
  if (src.grid) {
    const kinds: Record<string, CellKind> = { '.': 'floor', x: 'low', X: 'tall', '=': 'rail', '#': 'wall' };
    for (let y = 0; y < h; y++) {
      const row = src.grid.rows[y] ?? '', hr = src.grid.heights[y] ?? '';
      for (let x = 0; x < w; x++) {
        const k = kinds[row[x] ?? ' '];
        if (!k) continue;
        kind[y * w + x] = k;
        height[y * w + x] = Math.max(0, (hr.charCodeAt(x) || 48) - 48) / 10;
      }
    }
  }
  for (const r of src.rooms) {
    each(r, (x, y, i) => {
      kind[i] = 'floor';
      if (r.length === 5) height[i] = r[4];
      else if (r.length === 7) {
        const [rx, ry, rw, rh, h0, h1, axis] = r;
        const f = axis === 'x' ? (rw > 1 ? (x - rx) / (rw - 1) : 0) : (rh > 1 ? (y - ry) / (rh - 1) : 0);
        height[i] = Math.round((h0 + (h1 - h0) * f) * 20) / 20;
      } else height[i] = 0;
    });
  }
  for (const r of src.walls ?? []) each(r, (_x, _y, i) => { kind[i] = 'wall'; });
  for (const r of src.cover ?? []) each(r, (_x, _y, i) => { if (kind[i] === 'floor') kind[i] = r[4] === 'x' ? 'low' : r[4] === 'X' ? 'tall' : 'rail'; });
  // Outline: empty cells next to anything solid or walkable become walls.
  const outline: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (kind[i] !== 'void') continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = kind[ny * w + nx];
      if (k === 'floor' || k === 'low' || k === 'rail') { near = true; break; }
    }
    if (near) outline.push(i);
  }
  for (const i of outline) kind[i] = 'wall';
  const tSpawn: [number, number][] = [];
  const ctSpawn: [number, number][] = [];
  each(src.spawns.T, (x, y, i) => { if (kind[i] === 'floor') tSpawn.push([x, y]); });
  each(src.spawns.CT, (x, y, i) => { if (kind[i] === 'floor') ctSpawn.push([x, y]); });
  // Non-floor cells take the highest neighbouring floor as their base.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (kind[i] === 'floor' || kind[i] === 'void') continue;
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (kind[j] === 'floor') best = Math.max(best, height[j]!);
    }
    height[i] = best;
  }
  const regions: Region[] = src.regions.map((r) => {
    const [rx, ry, rw, rh] = r.rect;
    const cells: [number, number][] = [];
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && kind[y * w + x] === 'floor' && (!r.code || src.grid?.regions[y]?.[x] === r.code)) cells.push([x, y]);
    }
    const cx = rx + rw / 2, cy = ry + rh / 2;
    const center = cells.length ? cells.reduce((b, c) => (Math.hypot(c[0] + 0.5 - cx, c[1] + 0.5 - cy) < Math.hypot(b[0] + 0.5 - cx, b[1] + 0.5 - cy) ? c : b), cells[0]!) : [Math.floor(cx), Math.floor(cy)] as [number, number];
    return { ...r, cells, center };
  });
  const regionById = new Map(regions.map((r) => [r.id, r]));
  const siteA = regions.find((r) => r.site === 'A');
  const siteB = regions.find((r) => r.site === 'B');
  if (!siteA || !siteB) throw new Error(`${src.name}: needs one A site and one B site region`);
  return { name: src.name, w, h, kind, height, regions, regionById, lanes: src.lanes, ctHolds: src.ctHolds, tSpawn, ctSpawn, sites: { A: siteA, B: siteB }, palette: src.palette, props: src.props ?? [], stepUp: src.grid?.stepUp ?? STEP_UP, regionCode: src.grid?.regions, links: gridLinks(src, w), under: underCells(src, w, height), sideTune: src.sideTune ?? 1 };
}

/** Whether a point (cell coordinates, fractions allowed) lies in a region. */
function gridLinks(src: MapSource, w: number): Map<number, number[]> | undefined {
  if (!src.grid?.links?.length) return undefined;
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
  for (const [x1, y1, x2, y2] of src.grid.links) { add(y1 * w + x1, y2 * w + x2); add(y2 * w + x2, y1 * w + x1); }
  return out;
}

/** Cells strictly between a link's ends: the bridge above keeps its height, the passage below is interpolated. */
function underCells(src: MapSource, w: number, height: Float32Array | number[]): Map<number, number> | undefined {
  if (!src.grid?.links?.length) return undefined;
  const out = new Map<number, number>();
  for (const [x1, y1, x2, y2] of src.grid.links) {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    const h1 = height[y1 * w + x1]!, h2 = height[y2 * w + x2]!;
    for (let k = 1; k < n; k++) {
      const x = Math.round(x1 + ((x2 - x1) * k) / n), y = Math.round(y1 + ((y2 - y1) * k) / n);
      out.set(y * w + x, h1 + ((h2 - h1) * k) / n);
    }
  }
  return out;
}

export function regionContains(g: MapGeometry, r: Region, x: number, y: number): boolean {
  const [rx, ry, rw, rh] = r.rect;
  if (!(x >= rx && x < rx + rw && y >= ry && y < ry + rh)) return false;
  return !r.code || g.regionCode?.[Math.floor(y)]?.[Math.floor(x)] === r.code;
}

export function isWalkable(g: MapGeometry, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h && g.kind[y * g.w + x] === 'floor';
}

/** Sight is blocked by walls, tall cover and the void. */
export function blocksSight(g: MapGeometry, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return true;
  const k = g.kind[y * g.w + x];
  return k === 'wall' || k === 'tall' || k === 'void';
}

/**
 * Line of sight between two cells (eye height above each floor). Blocked by
 * walls, tall cover, the void, and floor that rises above the sight line.
 */
export function lineOfSight(g: MapGeometry, a: [number, number], b: [number, number]): boolean {
  const ax = a[0] + 0.5, ay = a[1] + 0.5, bx = b[0] + 0.5, by = b[1] + 0.5;
  const ea = g.height[a[1] * g.w + a[0]]! + EYE, eb = g.height[b[1] * g.w + b[0]]! + EYE;
  // Same sampling as the match engine's sight check (engine/sim/mapintel.ts), so both agree on grazing diagonals.
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(ax + (bx - ax) * t), y = Math.floor(ay + (by - ay) * t);
    if (blocksSight(g, x, y)) return false;
    const k = g.kind[y * g.w + x];
    const top = g.height[y * g.w + x]! + (k === 'low' ? 1.0 : k === 'rail' ? 0 : 0);
    if (top > ea + (eb - ea) * t - 0.1) return false;
  }
  return true;
}
