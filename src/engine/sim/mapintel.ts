/**
 * What the round simulation needs to know about a map, derived once from its
 * geometry and cached: site entrances (chokes) and where Ts stage before them,
 * good holding cells for CTs with the angle each one watches, and a sight-line
 * cache.
 */
import { isWalkable } from '../../maps/parse';
import { distanceField } from '../../maps/nav';
import { EYE } from '../../maps/types';
import type { MapGeometry, Region } from '../../maps/types';

export type Cell = [number, number];

export interface SiteEntry {
  /** Region Ts pass through right before the site. */
  choke: Region;
  /** Region where Ts wait before hitting through this choke. */
  staging: Region;
  /** The lane's region ids from T spawn to the site. */
  via: string[];
}

export interface HoldSpot { cell: Cell; watch: number; score: number }

export interface MapIntel {
  geo: MapGeometry;
  entries: Record<'A' | 'B', SiteEntry[]>;
  /** End regions of mid lanes (where mid control is fought). */
  midEnds: Region[];
  /** Ranked holding cells per region id, for a given site or 'Mid'. */
  holds: (regionId: string, zone: 'A' | 'B' | 'Mid') => HoldSpot[];
  /** Cells of a staging region, least exposed to the site's CT holds first. */
  staging: (regionId: string, site: 'A' | 'B') => Cell[];
  /** CT side gathering region for a retake of each site. */
  retakeFrom: Record<'A' | 'B', Region>;
  /** Sight check with partial-cover detection, cached per ordered cell pair. 0 blocked, 1 clear, 2 clear but target behind low cover. */
  sight: (ax: number, ay: number, bx: number, by: number) => 0 | 1 | 2;
  /** The best-known CT angle in each CT hold region: what a T team smokes before crossing. */
  commonAngles: Cell[];
  ctSpawnCenter: Cell;
  tSpawnCenter: Cell;
}

const cache = new WeakMap<MapGeometry, MapIntel>();

function centroid(cells: Cell[]): Cell {
  let x = 0, y = 0;
  for (const c of cells) { x += c[0]; y += c[1]; }
  return [Math.round(x / Math.max(1, cells.length)), Math.round(y / Math.max(1, cells.length))];
}

function nearestFloor(g: MapGeometry, c: Cell): Cell {
  if (isWalkable(g, c[0], c[1])) return c;
  for (let r = 1; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && isWalkable(g, c[0] + dx, c[1] + dy)) return [c[0] + dx, c[1] + dy];
  }
  return c;
}

export function mapIntel(g: MapGeometry): MapIntel {
  const hit = cache.get(g);
  if (hit) return hit;
  const W = g.w;
  const sightCache = new Map<number, 0 | 1 | 2>();
  const N = g.w * g.h;
  const sight = (ax: number, ay: number, bx: number, by: number): 0 | 1 | 2 => {
    const key = (ay * W + ax) * N + (by * W + bx);
    const c = sightCache.get(key);
    if (c !== undefined) return c;
    const v = rawSight(g, ax, ay, bx, by);
    if (sightCache.size > 600_000) sightCache.clear();
    sightCache.set(key, v);
    return v;
  };

  const entries: Record<'A' | 'B', SiteEntry[]> = { A: [], B: [] };
  for (const site of ['A', 'B'] as const) {
    const seen = new Set<string>();
    for (const lane of g.lanes) {
      if (lane.zone !== site || lane.via.length < 2) continue;
      const chokeId = lane.via[lane.via.length - 2]!;
      if (seen.has(chokeId)) continue;
      seen.add(chokeId);
      const stagingId = lane.via[Math.max(0, lane.via.length - 3)]!;
      entries[site].push({ choke: g.regionById.get(chokeId)!, staging: g.regionById.get(stagingId)!, via: lane.via });
    }
  }
  const midEnds: Region[] = [];
  for (const lane of g.lanes) if (lane.zone === 'Mid') { const r = g.regionById.get(lane.via[lane.via.length - 1]!)!; if (!midEnds.includes(r)) midEnds.push(r); }

  const ctSpawnCenter = nearestFloor(g, centroid(g.ctSpawn));
  const tSpawnCenter = nearestFloor(g, centroid(g.tSpawn));

  const retakeFrom = {} as Record<'A' | 'B', Region>;
  for (const site of ['A', 'B'] as const) {
    const options = g.ctHolds[site].map((id) => g.regionById.get(id)!).filter((r) => r.id !== g.sites[site].id);
    const byDist = options.sort((a, b) => Math.hypot(a.center[0] - ctSpawnCenter[0], a.center[1] - ctSpawnCenter[1]) - Math.hypot(b.center[0] - ctSpawnCenter[0], b.center[1] - ctSpawnCenter[1]));
    retakeFrom[site] = byDist[0] ?? g.sites[site];
  }

  // Where Ts come out of a choke: its cells closest (walking) to the site. A traced map's region
  // centre can sit in a wall or round a corner, so holds there watch the mouth instead
  // (hand-drawn maps keep watching the centre of their rectangular rooms).
  const mouthCache = new Map<string, Cell[]>();
  const mouth = (choke: Region, site: 'A' | 'B'): Cell[] => {
    const key = `${choke.id}:${site}`;
    const hit = mouthCache.get(key);
    if (hit) return hit;
    const field = distanceField(g, g.sites[site].cells, `site-${site}`);
    const ranked = choke.cells.filter(([x, y]) => Number.isFinite(field[y * W + x]!)).sort((a, b) => field[a[1] * W + a[0]]! - field[b[1] * W + b[0]]!);
    const out: Cell[] = [];
    for (const c of ranked.slice(0, Math.max(6, Math.ceil(ranked.length * 0.2)))) {
      if (out.every((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) >= 3)) out.push(c);
      if (out.length >= 4) break;
    }
    if (!out.length) out.push(nearestFloor(g, choke.center));
    mouthCache.set(key, out);
    return out;
  };

  const holdCache = new Map<string, HoldSpot[]>();
  const holds = (regionId: string, zone: 'A' | 'B' | 'Mid'): HoldSpot[] => {
    const key = `${regionId}:${zone}`;
    const c = holdCache.get(key);
    if (c) return c;
    const region = g.regionById.get(regionId)!;
    const threats: Cell[] = [];
    if (zone === 'Mid') {
      for (const r of midEnds) threats.push(r.center);
      for (const lane of g.lanes) { const i = lane.via.indexOf(regionId); if (i > 0) threats.push(g.regionById.get(lane.via[i - 1]!)!.center); }
    } else {
      for (const e of entries[zone]) {
        if (g.regionCode) { threats.push(...mouth(e.choke, zone)); threats.push(nearestFloor(g, e.staging.center)); } else { threats.push(e.choke.center); threats.push(e.staging.center); }
      }
      for (const lane of g.lanes) { const i = lane.via.indexOf(regionId); if (i > 0) threats.push(g.regionById.get(lane.via[i - 1]!)!.center); }
    }
    const step = Math.max(1, Math.floor(region.cells.length / 60));
    const out: HoldSpot[] = [];
    for (let i = 0; i < region.cells.length; i += step) {
      const cell = region.cells[i]!;
      let best = -1, watch = Math.atan2(tSpawnCenter[1] - cell[1], tSpawnCenter[0] - cell[0]), score = 0;
      for (const th of threats) {
        const d = Math.hypot(th[0] - cell[0], th[1] - cell[1]);
        if (d < 3 || d > 45) continue;
        if (rawSight(g, cell[0], cell[1], th[0], th[1]) === 0) continue;
        const s = 1 - Math.abs(d - 16) / 30;
        score += s;
        if (s > best) { best = s; watch = Math.atan2(th[1] - cell[1], th[0] - cell[0]); }
      }
      // Cover next to the spot to fall back behind.
      let cover = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = g.kind[(cell[1] + dy) * W + cell[0] + dx];
        if (k === 'low' || k === 'tall' || k === 'wall') cover++;
      }
      score += Math.min(2, cover) * 0.35;
      out.push({ cell, watch, score });
    }
    out.sort((a, b) => b.score - a.score);
    const top = out.slice(0, 8);
    if (!top.length) top.push({ cell: region.center, watch: 0, score: 0 });
    holdCache.set(key, top);
    return top;
  };

  const stageCache = new Map<string, Cell[]>();
  const staging = (regionId: string, site: 'A' | 'B'): Cell[] => {
    const key = `${regionId}:${site}`;
    const c = stageCache.get(key);
    if (c) return c;
    const region = g.regionById.get(regionId)!;
    const watchers: Cell[] = [];
    for (const id of [...g.ctHolds[site], ...g.ctHolds.Mid]) for (const h of holds(id, g.ctHolds.Mid.includes(id) ? 'Mid' : site).slice(0, 4)) watchers.push(h.cell);
    const step = Math.max(1, Math.floor(region.cells.length / 50));
    const scored: { cell: Cell; exp: number }[] = [];
    for (let i = 0; i < region.cells.length; i += step) {
      const cell = region.cells[i]!;
      let exp = 0;
      for (const w of watchers) if (sight(w[0], w[1], cell[0], cell[1]) !== 0) exp++;
      scored.push({ cell, exp });
    }
    scored.sort((a, b) => a.exp - b.exp);
    // Least exposed first, but spread out so five players don't stand in one cell.
    const out: Cell[] = [];
    for (const sc of scored) {
      if (out.every((c) => Math.abs(c[0] - sc.cell[0]) + Math.abs(c[1] - sc.cell[1]) >= 2)) out.push(sc.cell);
      if (out.length >= 6) break;
    }
    if (!out.length) out.push(region.center);
    stageCache.set(key, out);
    return out;
  };

  const commonAngles: Cell[] = [];
  for (const z of ['A', 'B', 'Mid'] as const) for (const id of g.ctHolds[z]) { const h = holds(id, z)[0]; if (h) commonAngles.push(h.cell); }
  const intel: MapIntel = { geo: g, entries, midEnds, holds, staging, retakeFrom, sight, commonAngles, ctSpawnCenter, tSpawnCenter };
  cache.set(g, intel);
  return intel;
}

/**
 * Sight between two cells at eye height. Blocked by walls, tall cover, the
 * void and floor rising above the line. Low cover in the last two cells before
 * the target leaves only their head and shoulders showing (returns 2).
 */
function rawSight(g: MapGeometry, ax: number, ay: number, bx: number, by: number): 0 | 1 | 2 {
  const W = g.w;
  const ea = g.height[ay * W + ax]! + EYE, eb = g.height[by * W + bx]! + EYE;
  const fx = ax + 0.5, fy = ay + 0.5, tx = bx + 0.5, ty = by + 0.5;
  const len = Math.hypot(tx - fx, ty - fy);
  const steps = Math.ceil(len * 2.5);
  let partial = false;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(fx + (tx - fx) * t), y = Math.floor(fy + (ty - fy) * t);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return 0;
    const k = g.kind[y * W + x];
    if (k === 'wall' || k === 'tall' || k === 'void') return 0;
    const top = g.height[y * W + x]! + (k === 'low' ? 1.0 : 0);
    if (top > ea + (eb - ea) * t - 0.1) return 0;
    if (k === 'low' && len * (1 - t) < 2.2) partial = true;
  }
  return partial ? 2 : 1;
}
