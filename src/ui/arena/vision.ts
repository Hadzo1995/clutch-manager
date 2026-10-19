/**
 * The visible part of a player's view cone, for drawing: rays fanned across the
 * field of view that stop at walls, tall cover, floor rising above eye level
 * and active smokes. Pure geometry in cell coordinates, shared by both renderers.
 */
import { blocksSight } from '../../maps/parse';
import { EYE } from '../../maps/types';
import type { MapGeometry } from '../../maps/types';
import { CONE_RANGE, FOV, SMOKE_SECONDS, type RoundTimeline, type Vec } from './timeline';

export interface Smoke { at: Vec; r: number }

export function activeSmokes(tl: RoundTimeline, t: number): Smoke[] {
  const out: Smoke[] = [];
  for (const u of tl.utility) if (u.kind === 'smoke' && t >= u.t && t <= u.t + Math.min(u.duration, SMOKE_SECONDS)) out.push({ at: u.at, r: u.radius * 0.85 });
  return out;
}

/** Ray end points from `pos`, left to right across the cone around `aim`. */
export function visionFan(geo: MapGeometry, pos: Vec, aim: number, smokes: Smoke[], rays = 24, range = CONE_RANGE, fov = FOV): Vec[] {
  const out: Vec[] = [];
  const cx = Math.floor(pos[0]), cy = Math.floor(pos[1]);
  const eye = (geo.height[cy * geo.w + cx] ?? 0) + EYE;
  const step = 0.3;
  for (let i = 0; i <= rays; i++) {
    const a = aim - fov / 2 + (fov * i) / rays;
    const dx = Math.cos(a), dy = Math.sin(a);
    let d = step, end = range;
    for (; d < range; d += step) {
      const x = pos[0] + dx * d, y = pos[1] + dy * d;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= geo.w || iy >= geo.h) { end = d; break; }
      if (blocksSight(geo, ix, iy) || (geo.height[iy * geo.w + ix] ?? 0) > eye - 0.1) { end = d; break; }
      let hit = false;
      for (const s of smokes) if (Math.hypot(x - s.at[0], y - s.at[1]) < s.r) { hit = true; break; }
      if (hit) { end = d; break; }
    }
    out.push([pos[0] + dx * end, pos[1] + dy * end]);
  }
  return out;
}
