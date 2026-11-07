/**
 * A detail map laid over the whole floor of a map, four texels to the metre:
 *  - red: soft contact shadow where the floor meets walls, cover and higher ground, darkest in
 *    inner corners, so buildings sit on the ground instead of floating on a flat colour;
 *  - green: where loose material gathers: sand, dust or grime along the foot of walls and in
 *    corners, broken up by noise so it reads as drifts rather than a stripe;
 *  - blue: large soft patches across open ground, so long floors don't read as one tiled sheet.
 * Nothing here changes the map: it is computed from the same cells the game plays on.
 */
import * as THREE from 'three';
import type { MapGeometry } from '../../maps/types';

/** Texels per cell (one cell is one metre). */
const RES = 4;
/** How far, in metres, a wall's contact shadow and drift reach across the floor. */
const REACH = 1.6;

function hash(x: number, y: number, s: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function noise(x: number, y: number, s: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function fbm(x: number, y: number, s: number): number {
  return noise(x, y, s) * 0.55 + noise(x * 2.1, y * 2.1, s + 1) * 0.3 + noise(x * 4.3, y * 4.3, s + 2) * 0.15;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface GroundDetail {
  texture: THREE.DataTexture;
  /** World x and z of the map's corner, and 1 / its size in metres: uv = (xz - rect.xy) * rect.zw. */
  rect: THREE.Vector4;
}

/** `origin` is the world position of cell (0, 0)'s corner; cells are `cell` metres. */
export function groundDetail(g: MapGeometry, origin: THREE.Vector3, cell: number): GroundDetail {
  const W = g.w * RES, H = g.h * RES;
  const data = new Uint8Array(W * H * 4);
  // How much each cell shades the floor next to it, as a function of the floor's own height.
  const occluder = (nx: number, ny: number, h0: number): number => {
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) return 1;
    const j = ny * g.w + nx, k = g.kind[j];
    if (k === 'wall' || k === 'void' || k === 'tall') return 1;
    if (k === 'low') return 0.55;
    if (g.height[j]! > h0 + 0.9) return 0.9;
    return 0;
  };
  const span = Math.ceil(REACH);
  for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) {
    const i = cy * g.w + cx, k = g.kind[i];
    const open = k === 'floor' || k === 'low' || k === 'tall' || k === 'rail';
    const h0 = g.height[i]!;
    // Which neighbours shade this cell: gathered once per cell, used by its 16 texels.
    const occ: [number, number, number][] = [];
    if (open) for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
      if (!dx && !dy) continue;
      const w = occluder(cx + dx, cy + dy, h0);
      if (w > 0) occ.push([cx + dx, cy + dy, w]);
    }
    for (let sy = 0; sy < RES; sy++) for (let sx = 0; sx < RES; sx++) {
      const px = cx * RES + sx, py = cy * RES + sy;
      const o = (py * W + px) * 4;
      if (!open) { data[o] = 255; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255; continue; }
      const u = cx + (sx + 0.5) / RES, v = cy + (sy + 0.5) / RES;
      let sum = 0;
      for (const [ox, oy, w] of occ) {
        const ddx = Math.max(ox - u, 0, u - (ox + 1)), ddy = Math.max(oy - v, 0, v - (oy + 1));
        const d = Math.hypot(ddx, ddy);
        if (d < REACH) { const f = 1 - d / REACH; sum += w * f * f; }
      }
      const ao = 1 - 0.55 * (1 - Math.exp(-sum * 0.55));
      const drift = smooth(0.35, 2.2, sum) * smooth(0.3, 0.75, fbm(u / 2.6, v / 2.6, 3));
      const patch = smooth(0.5, 0.82, fbm(u / 9, v / 9, 11));
      data[o] = Math.round(ao * 255);
      data[o + 1] = Math.round(drift * 255);
      data[o + 2] = Math.round(patch * 255);
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, rect: new THREE.Vector4(origin.x, origin.z, 1 / (g.w * cell), 1 / (g.h * cell)) };
}
