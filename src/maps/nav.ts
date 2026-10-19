/** Grid pathfinding (A*, 8 directions, no corner cutting, max one height step). */
import { isWalkable } from './parse';
import { DROP_DOWN, STEP_UP } from './types';
import type { MapGeometry } from './types';

export type Cell = [number, number];

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function canStep(g: MapGeometry, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx, ny = y + dy;
  if (!isWalkable(g, nx, ny)) return false;
  if (!heightOk(g.height[y * g.w + x]!, g.height[ny * g.w + nx]!, g.stepUp)) return false;
  if (dx !== 0 && dy !== 0 && (!isWalkable(g, x + dx, y) || !isWalkable(g, x, y + dy))) return false;
  // Diagonals must also be fine through both side cells (no cutting a ledge corner).
  if (dx !== 0 && dy !== 0 && (!heightOk(g.height[y * g.w + x]!, g.height[y * g.w + x + dx]!, g.stepUp) || !heightOk(g.height[y * g.w + x]!, g.height[(y + dy) * g.w + x]!, g.stepUp))) return false;
  return true;
}

/** Up a small step, or down a ledge (one way). */
export function heightOk(from: number, to: number, stepUp = STEP_UP): boolean {
  const d = to - from;
  return d <= stepUp + 1e-6 && d >= -DROP_DOWN - 1e-6;
}

class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(v: [number, number]) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p]![0] <= a[i]![0]) break; [a[p], a[i]] = [a[i]!, a[p]!]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a; const top = a[0]!; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l]![0] < a[m]![0]) m = l; if (r < a.length && a[r]![0] < a[m]![0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i]!, a[m]!]; i = m; }
    }
    return top;
  }
}

/** Walking cost of a link (see GridSource.links): the straight distance between its ends. */
function linkCost(W: number, i: number, j: number): number {
  return Math.hypot((i % W) - (j % W), ((i / W) | 0) - ((j / W) | 0));
}

const cache = new WeakMap<MapGeometry, Map<string, Cell[] | null>>();

export function findPath(g: MapGeometry, from: Cell, to: Cell): Cell[] | null {
  const key = `${from[0]},${from[1]}>${to[0]},${to[1]}`;
  let c = cache.get(g);
  if (!c) { c = new Map(); cache.set(g, c); }
  if (c.has(key)) return c.get(key)!;
  const res = astar(g, from, to);
  if (c.size > 20000) c.clear();
  c.set(key, res);
  return res;
}

// Allowed steps per cell (bit k = DIRS[k]), computed once per geometry.
const maskCache = new WeakMap<MapGeometry, Uint8Array>();
function stepMask(g: MapGeometry): Uint8Array {
  let m = maskCache.get(g);
  if (m) return m;
  m = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!isWalkable(g, x, y)) continue;
    let bits = 0;
    for (let k = 0; k < 8; k++) if (canStep(g, x, y, DIRS[k]![0], DIRS[k]![1])) bits |= 1 << k;
    m[y * g.w + x] = bits;
  }
  maskCache.set(g, m);
  return m;
}

// Reused search buffers (A* runs a lot during simulation): a stamp per cell marks
// which search last touched it, so nothing needs clearing between calls.
let bufSize = 0;
let gsBuf = new Float64Array(0);
let prevBuf = new Int32Array(0);
let stampBuf = new Uint32Array(0);
let closedBuf = new Uint32Array(0);
let stamp = 0;
let heapK = new Float64Array(1024);
let heapV = new Int32Array(1024);

function astar(g: MapGeometry, from: Cell, to: Cell): Cell[] | null {
  if (!isWalkable(g, from[0], from[1]) || !isWalkable(g, to[0], to[1])) return null;
  const W = g.w;
  const size = W * g.h;
  const mask = stepMask(g);
  if (size > bufSize) { bufSize = size; gsBuf = new Float64Array(size); prevBuf = new Int32Array(size); stampBuf = new Uint32Array(size); closedBuf = new Uint32Array(size); stamp = 0; }
  stamp++;
  if (stamp >= 0xffffffff) { stampBuf.fill(0); closedBuf.fill(0); stamp = 1; }
  const gs = gsBuf, prev = prevBuf, st = stampBuf, closed = closedBuf, cur = stamp;
  const start = from[1] * W + from[0], goal = to[1] * W + to[0];
  const tx = to[0], ty = to[1];
  const hfn = (i: number) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return dx > dy ? dx + 0.41421356 * dy : dy + 0.41421356 * dx; };
  // Binary heap on typed arrays.
  let n = 0;
  const push = (k: number, v: number) => {
    if (n >= heapK.length) { const nk = new Float64Array(heapK.length * 2); nk.set(heapK); heapK = nk; const nv = new Int32Array(heapV.length * 2); nv.set(heapV); heapV = nv; }
    let i = n++;
    while (i > 0) { const p = (i - 1) >> 1; if (heapK[p]! <= k) break; heapK[i] = heapK[p]!; heapV[i] = heapV[p]!; i = p; }
    heapK[i] = k; heapV[i] = v;
  };
  const pop = (): number => {
    const top = heapV[0]!;
    n--;
    if (n > 0) {
      const k = heapK[n]!, v = heapV[n]!;
      let i = 0;
      for (;;) { const l = i * 2 + 1; if (l >= n) break; const r = l + 1; const c = r < n && heapK[r]! < heapK[l]! ? r : l; if (heapK[c]! >= k) break; heapK[i] = heapK[c]!; heapV[i] = heapV[c]!; i = c; }
      heapK[i] = k; heapV[i] = v;
    }
    return top;
  };
  gs[start] = 0; prev[start] = -1; st[start] = cur; push(hfn(start), start);
  let found = false;
  while (n) {
    const i = pop();
    if (closed[i] === cur) continue;
    if (i === goal) { found = true; break; }
    closed[i] = cur;
    const bits = mask[i]!;
    const gi = gs[i]!;
    for (let k = 0; k < 8; k++) {
      if (!(bits & (1 << k))) continue;
      const d = DIRS[k]!;
      const j = i + d[1] * W + d[0];
      const ng = gi + d[2];
      if (st[j] !== cur || ng < gs[j]!) { gs[j] = ng; prev[j] = i; st[j] = cur; push(ng + hfn(j), j); }
    }
    const linked = g.links?.get(i);
    if (linked) for (const j of linked) {
      const ng = gi + linkCost(W, i, j);
      if (st[j] !== cur || ng < gs[j]!) { gs[j] = ng; prev[j] = i; st[j] = cur; push(ng + hfn(j), j); }
    }
  }
  if (!found && st[goal] !== cur) return null;
  const out: Cell[] = [];
  for (let i = goal; i !== -1; i = prev[i]!) out.push([i % W, (i / W) | 0]);
  return out.reverse();
}

/** Drops intermediate cells that lie on a straight walkable line, for smoother movement. */
export function simplify(g: MapGeometry, path: Cell[]): Cell[] {
  if (path.length <= 2) return path;
  const out: Cell[] = [path[0]!];
  let anchor = path[0]!;
  for (let i = 2; i < path.length; i++) {
    if (!straightWalk(g, anchor, path[i]!)) { anchor = path[i - 1]!; out.push(anchor); }
  }
  out.push(path[path.length - 1]!);
  return out;
}

function straightWalk(g: MapGeometry, a: Cell, b: Cell): boolean {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3);
  let px = a[0], py = a[1];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    // test a small square around the line so the walker keeps clear of corners
    for (const [ox, oy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.8], [0.2, 0.8], [0.8, 0.2]] as const) {
      const x = Math.floor(a[0] + (b[0] - a[0]) * t + ox), y = Math.floor(a[1] + (b[1] - a[1]) * t + oy);
      if (!isWalkable(g, x, y)) return false;
    }
    const x = Math.floor(a[0] + (b[0] - a[0]) * t + 0.5), y = Math.floor(a[1] + (b[1] - a[1]) * t + 0.5);
    if ((x !== px || y !== py) && (!heightOk(g.height[py * g.w + px]!, g.height[y * g.w + x]!, g.stepUp) || Math.abs(g.height[y * g.w + x]! - g.height[py * g.w + px]!) > g.stepUp + 1e-6)) return false;
    px = x; py = y;
  }
  return true;
}

export function pathLength(path: Cell[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  return d;
}

const fieldCache = new WeakMap<MapGeometry, Map<string, Float64Array>>();

/**
 * Walking distance from every cell to the nearest goal cell (Infinity where the
 * goal can't be reached). Cached per geometry and goal set.
 */
export function distanceField(g: MapGeometry, goals: Cell[], key: string): Float64Array {
  let c = fieldCache.get(g);
  if (!c) { c = new Map(); fieldCache.set(g, c); }
  const hit = c.get(key);
  if (hit) return hit;
  const W = g.w;
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const heap = new Heap();
  for (const [x, y] of goals) { if (!isWalkable(g, x, y)) continue; dist[y * W + x] = 0; heap.push([0, y * W + x]); }
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]!) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy, cost] of DIRS) {
      // Walking backwards: the neighbour must be able to step onto this cell.
      const px = x - dx, py = y - dy;
      if (!isWalkable(g, px, py) || !canStep(g, px, py, dx, dy)) continue;
      const j = py * W + px, nd = d + cost;
      if (nd < dist[j]!) { dist[j] = nd; heap.push([nd, j]); }
    }
    for (const j of g.links?.get(i) ?? []) {
      const nd = d + linkCost(W, i, j);
      if (nd < dist[j]!) { dist[j] = nd; heap.push([nd, j]); }
    }
  }
  c.set(key, dist);
  return dist;
}

/** Follows a distance field downhill from `from` for about `ahead` cells; returns where it ends. */
export function followField(g: MapGeometry, field: Float64Array, from: Cell, ahead: number): Cell {
  let [x, y] = from; let walked = 0;
  while (walked < ahead) {
    const here = field[y * g.w + x]!;
    if (!(here > 0) || here === Infinity) break;
    let best = -1, bd = here, bc = 1;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const v = field[ny * g.w + nx]!;
      if (v < bd - 1e-6 && canStep(g, x, y, dx, dy)) { bd = v; best = ny * g.w + nx; bc = cost; }
    }
    for (const j of g.links?.get(y * g.w + x) ?? []) {
      if (field[j]! < bd - 1e-6) { bd = field[j]!; best = j; bc = linkCost(g.w, y * g.w + x, j); }
    }
    if (best < 0) break;
    x = best % g.w; y = (best - x) / g.w; walked += bc;
  }
  return [x, y];
}

/** Walking distances from one cell to every cell within `radius` (Infinity elsewhere), as a sparse map. */
export function localReach(g: MapGeometry, from: Cell, radius: number): Map<number, number> {
  const W = g.w, out = new Map<number, number>();
  if (!isWalkable(g, from[0], from[1])) return out;
  const heap = new Heap();
  out.set(from[1] * W + from[0], 0); heap.push([0, from[1] * W + from[0]]);
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > (out.get(i) ?? Infinity)) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy, cost] of DIRS) {
      const nd = d + cost;
      if (nd > radius || !canStep(g, x, y, dx, dy)) continue;
      const j = (y + dy) * W + x + dx;
      if (nd < (out.get(j) ?? Infinity)) { out.set(j, nd); heap.push([nd, j]); }
    }
    for (const j of g.links?.get(i) ?? []) {
      const nd = d + linkCost(W, i, j);
      if (nd <= radius && nd < (out.get(j) ?? Infinity)) { out.set(j, nd); heap.push([nd, j]); }
    }
  }
  return out;
}
