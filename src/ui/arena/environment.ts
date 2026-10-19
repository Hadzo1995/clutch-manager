/**
 * Buildings, roofs and surroundings for the 3D map. Every map gets its own
 * architecture from a style sheet (MAP_STYLES): roof construction (clay tiles,
 * flat roofs with parapets, metal sheds, stepped stone), facade materials and
 * colours, windows, rooftop clutter, vegetation, the town or landscape around
 * the playable area, sky and light.
 *
 * Inside the map, every non-walkable cell (walls and the solid "void" between
 * lanes) is split into building lots; lots at least 3 m wide become buildings
 * with roofs, thinner ones stay walls. Nothing here changes the playable
 * geometry: buildings stand only on cells that were already solid, at least as
 * tall as the old walls. Everything is drawn in code (no CS2 assets) and
 * merged into a few meshes per material.
 */
import * as THREE from 'three';
import { CELL, HEIGHT_UNIT, WALL_HEIGHT } from '../../maps/types';
import { SKYLINE } from '../../engine/sim/flight';
import type { MapGeometry } from '../../maps/types';
import { WINDOW, worldMaterial, type SurfaceSet } from './materials';

export type RoofKind = 'tile' | 'flat' | 'metal' | 'stone';
type WindowKind = keyof typeof WINDOW;

export interface MapStyle {
  /** Sky gradient: zenith, horizon. Fog uses the horizon colour. */
  sky: [string, string];
  fog: [number, number];
  sun: { color: string; intensity: number; dir: [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  facadeTex: 'stucco' | 'plaster' | 'sandstone' | 'concrete' | 'mossy' | 'blocks';
  /** Facade colours; each building picks one. */
  facade: string[];
  /** Colour of wall copings and parapet tops. */
  coping: string;
  roofs: [RoofKind, number][];
  roofColors: string[];
  /** Window styles used on facades, by weight. */
  windows: [WindowKind, number][];
  doors: WindowKind[];
  /** Outer landscape. */
  ground: { tex: 'sand' | 'grass' | 'asphalt' | 'jungle' | 'stones'; color: string; scale: number };
  surround: 'town' | 'desert' | 'industrial' | 'jungle';
  vegetation: 'cypress' | 'palm' | 'jungle' | 'pine' | 'none';
  hills: string;
  /** Rooftop details. */
  extras: { chimney?: number; tank?: number; ac?: number; dome?: number; hut?: number; vent?: number; beams?: boolean; cornice?: string; plants?: number };
  /** Distant landmark silhouettes. */
  landmarks: ('belltower' | 'minaret' | 'dome' | 'pyramid' | 'cooling' | 'stack' | 'wheel' | 'temple' | 'mesa')[];
}

export const MAP_STYLES: Record<string, MapStyle> = {
  // Italian hill town: warm plaster in ochre, cream and salmon, terracotta tiled roofs, shutters.
  Inferno: {
    sky: ['#6d9bd1', '#e9d9bc'], fog: [210, 640],
    sun: { color: '#ffe2b8', intensity: 2.1, dir: [0.45, 0.8, 0.35] },
    hemi: { sky: '#cfe0f5', ground: '#6a4a33', intensity: 1.05 }, exposure: 1.05,
    facadeTex: 'stucco', facade: ['#e2c79f', '#d9b48a', '#e8d6b5', '#cf9f7c', '#e3c08a', '#d8a98f', '#c9b293'], coping: '#a65a3c',
    roofs: [['tile', 1]], roofColors: ['#a8634a', '#9c5a43', '#b06f50', '#8f5544', '#a96a4c', '#9a6350', '#b37a5a'],
    windows: [['shutterGreen', 3], ['shutterOpen', 2]], doors: ['doorWood'],
    ground: { tex: 'grass', color: '#9a9466', scale: 1 / 6 }, surround: 'town', vegetation: 'cypress', hills: '#7d8a55',
    extras: { chimney: 0.45, plants: 0.2 }, landmarks: ['belltower'],
  },
  // Desert town: sandstone and dusty plaster, flat roofs with low parapets, timber beam ends.
  Dust2: {
    sky: ['#7fb2dc', '#f1e3c4'], fog: [220, 700],
    sun: { color: '#fff0d0', intensity: 2.35, dir: [0.35, 0.85, 0.4] },
    hemi: { sky: '#d9e6f2', ground: '#8a6a44', intensity: 1.0 }, exposure: 1.02,
    facadeTex: 'sandstone', facade: ['#dcc596', '#d4b886', '#e2cfa4', '#cdb184', '#d9bf8e'], coping: '#e8d6ad',
    roofs: [['flat', 1]], roofColors: ['#cdb68a', '#c4ab7d', '#d3bf95'],
    windows: [['square', 3]], doors: ['doorWood'],
    ground: { tex: 'sand', color: '#cfae78', scale: 1 / 9 }, surround: 'desert', vegetation: 'palm', hills: '#b88a5c',
    extras: { tank: 0.12, hut: 0.1, beams: true }, landmarks: ['mesa'],
  },
  // North African medina: cream and ochre plaster, flat roofs, domes, blue-green trim.
  Mirage: {
    sky: ['#79a9d8', '#efe0c6'], fog: [210, 660],
    sun: { color: '#ffe9c8', intensity: 2.2, dir: [0.5, 0.8, 0.3] },
    hemi: { sky: '#d6e4f3', ground: '#7d6040', intensity: 1.05 }, exposure: 1.03,
    facadeTex: 'plaster', facade: ['#e6d0a6', '#dcc092', '#ecdcbc', '#d6b588', '#e2c79a'], coping: '#efe2c4',
    roofs: [['flat', 1]], roofColors: ['#d2bb92', '#c9b085', '#dac7a2'],
    windows: [['arch', 3], ['square', 1]], doors: ['doorWood'],
    ground: { tex: 'sand', color: '#c9ab7e', scale: 1 / 8 }, surround: 'town', vegetation: 'palm', hills: '#b0916a',
    extras: { dome: 0.12, tank: 0.15, ac: 0.12, hut: 0.08 }, landmarks: ['minaret', 'dome'],
  },
  // Egyptian river town: big sandstone blocks, flat roofs with flared cornices, teal painted bands.
  Anubis: {
    sky: ['#76acd6', '#f0e4c9'], fog: [210, 660],
    sun: { color: '#fff1d6', intensity: 2.3, dir: [0.3, 0.85, 0.45] },
    hemi: { sky: '#d5e6f2', ground: '#8a7048', intensity: 1.0 }, exposure: 1.02,
    facadeTex: 'sandstone', facade: ['#dcc699', '#d2b987', '#e4d2a8', '#c9ae7e'], coping: '#ecdcb6',
    roofs: [['flat', 1]], roofColors: ['#cfb98d', '#c6ae80'],
    windows: [['arch', 1], ['square', 2], ['ornament', 1]], doors: ['doorWood'],
    ground: { tex: 'sand', color: '#d2b682', scale: 1 / 9 }, surround: 'town', vegetation: 'palm', hills: '#c29a62',
    extras: { cornice: '#2f9fa3', tank: 0.06, plants: 0.12 }, landmarks: ['pyramid', 'pyramid'],
  },
  // Overgrown temple ruins: mossy stone, stepped stone roofs, jungle all around.
  Ancient: {
    sky: ['#7fa6bf', '#d3dccb'], fog: [170, 520],
    sun: { color: '#fff1d2', intensity: 1.9, dir: [0.4, 0.8, 0.45] },
    hemi: { sky: '#cfe0e6', ground: '#3d4a2c', intensity: 1.15 }, exposure: 1.05,
    facadeTex: 'mossy', facade: ['#b0a688', '#a39b7e', '#b8ad8c', '#9c9478'], coping: '#8f9a6a',
    roofs: [['stone', 1]], roofColors: ['#8e9a6b', '#7f8c5e', '#9aa078'],
    windows: [], doors: [],
    ground: { tex: 'jungle', color: '#56703c', scale: 1 / 5 }, surround: 'jungle', vegetation: 'jungle', hills: '#3f5a33',
    extras: { plants: 0.55 }, landmarks: ['temple'],
  },
  // Nuclear plant: white and blue cladding, corrugated metal sheds, flat roofs with vents.
  Nuke: {
    sky: ['#86a9c9', '#dfe5ea'], fog: [200, 620],
    sun: { color: '#fff6e6', intensity: 2.0, dir: [0.4, 0.85, 0.35] },
    hemi: { sky: '#dce6ef', ground: '#4c5257', intensity: 1.1 }, exposure: 1.0,
    facadeTex: 'concrete', facade: ['#c9cfd4', '#b9c0c7', '#d6dadd', '#8fa6bb', '#c8c2b4'], coping: '#9aa2aa',
    roofs: [['metal', 2], ['flat', 1]], roofColors: ['#8d969e', '#7b8791', '#5f7f9c', '#a4abb1'],
    windows: [['industrial', 1]], doors: ['doorMetal'],
    ground: { tex: 'asphalt', color: '#8a8f93', scale: 1 / 6 }, surround: 'industrial', vegetation: 'none', hills: '#6f7f63',
    extras: { vent: 0.4, ac: 0.3 }, landmarks: ['cooling', 'cooling', 'stack'],
  },
  // Abandoned Soviet industry: grey concrete panels, rusted metal roofs, birch and pine around.
  Cache: {
    sky: ['#8da6b8', '#d9dcd6'], fog: [190, 600],
    sun: { color: '#fff3dc', intensity: 1.85, dir: [0.4, 0.8, 0.4] },
    hemi: { sky: '#d8e0e4', ground: '#4f5644', intensity: 1.1 }, exposure: 1.0,
    facadeTex: 'concrete', facade: ['#b3b6ad', '#a8aba2', '#c0c2b8', '#9ea594', '#b9ab98'], coping: '#8d9088',
    roofs: [['flat', 2], ['metal', 1]], roofColors: ['#8a8d86', '#7d6a58', '#93968e', '#6f7468'],
    windows: [['industrial', 2], ['square', 1]], doors: ['doorMetal'],
    ground: { tex: 'grass', color: '#6d7a52', scale: 1 / 5 }, surround: 'industrial', vegetation: 'pine', hills: '#5d6b4b',
    extras: { vent: 0.3, ac: 0.15 }, landmarks: ['wheel', 'stack'],
  },
};

export function mapStyle(name: string): MapStyle { return MAP_STYLES[name] ?? MAP_STYLES.Dust2!; }

// ---------------------------------------------------------------------------
// Geometry accumulator: non-indexed triangles with normals, uvs and colours.

class Acc {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = [];
  private v = new THREE.Vector3(); private w = new THREE.Vector3();
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, ua: [number, number] = [0, 0], ub: [number, number] = [0, 0], uc: [number, number] = [0, 0], out?: THREE.Vector3) {
    const n = this.v.subVectors(b, a).cross(this.w.subVectors(c, a)).normalize();
    if (out && n.dot(out) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; n.negate(); }
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(u[0], u[1]); this.col.push(color.r, color.g, color.b);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, out: THREE.Vector3, uvs?: [number, number][]) {
    const u = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, color, u[0], u[1], u[2], out);
    this.tri(a, c, d, color, u[0], u[2], u[3], out);
  }
  /** Axis-aligned box; `top`/`bottom` toggle those faces. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, top = true, bottom = false) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    if (top) this.quad(V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), color, V(0, 1, 0));
    if (bottom) this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), color, V(0, -1, 0));
    this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), color, V(0, 0, 1));
    this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), color, V(0, 0, -1));
    this.quad(V(x1, y0, z0), V(x1, y0, z1), V(x1, y1, z1), V(x1, y1, z0), color, V(1, 0, 0));
    this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), color, V(-1, 0, 0));
  }
  /** A vertical cylinder (no caps unless asked), or a cone when r1 differs. */
  cyl(x: number, y0: number, z: number, r0: number, r1: number, h: number, color: THREE.Color, seg = 10, cap = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, r: number, y: number) => new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      const mid = (a0 + a1) / 2;
      const out = new THREE.Vector3(Math.cos(mid), (r0 - r1) / Math.max(0.01, h), Math.sin(mid));
      if (r1 > 0.001) this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y0 + h), p(a0, r1, y0 + h), color, out);
      else this.tri(p(a0, r0, y0), p(a1, r0, y0), new THREE.Vector3(x, y0 + h, z), color, [0, 0], [0, 0], [0, 0], out);
      if (cap && r1 > 0.001) this.tri(p(a0, r1, y0 + h), p(a1, r1, y0 + h), new THREE.Vector3(x, y0 + h, z), color, [0, 0], [0, 0], [0, 0], new THREE.Vector3(0, 1, 0));
    }
  }
  /** A low-poly blob (bushes, tree crowns), squashed by sy. */
  blob(x: number, y: number, z: number, r: number, sy: number, color: THREE.Color, seed: number) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const tri = [0, 1, 2].map((k) => {
        const j = i + k;
        const jit = 0.85 + 0.3 * frac(Math.sin((p.getX(j) * 12.9 + p.getY(j) * 78.2 + p.getZ(j) * 37.7 + seed) * 43758.5));
        return new THREE.Vector3(x + p.getX(j) * jit, y + p.getY(j) * jit * sy, z + p.getZ(j) * jit);
      });
      const c = new THREE.Vector3().addVectors(tri[0]!, tri[1]!).add(tri[2]!).divideScalar(3).sub(new THREE.Vector3(x, y, z));
      const shade = color.clone().multiplyScalar(0.82 + 0.3 * Math.max(0, c.y / (r * sy)));
      this.tri(tri[0]!, tri[1]!, tri[2]!, shade, [0, 0], [0, 0], [0, 0], c);
    }
    g.dispose();
  }
  get empty() { return this.pos.length === 0; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const frac = (v: number) => v - Math.floor(v);
const rngOf = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length) % list.length]!;
const weighted = <T,>(r: () => number, list: [T, number][]): T => { const tot = list.reduce((s, [, w]) => s + w, 0); let x = r() * tot; for (const [v, w] of list) { x -= w; if (x <= 0) return v; } return list[0]![0]; };

interface Lot {
  /** World bounds (metres). */
  x0: number; z0: number; x1: number; z1: number;
  /** Ground under the building and its eave height (metres). */
  base: number; eave: number;
  /** For each side (-z, +x, +z, -x), the floor heights in front of it, per metre (NaN where no open floor). */
  front?: Float32Array[];
  outer: boolean;
  /** Highest point the roof may reach (grenade arcs clear it). */
  cap?: number;
}

export interface EnvironmentBuild {
  group: THREE.Group;
  style: MapStyle;
  /** Cells drawn here (walls and void), so the viewer skips them. */
  covered: Uint8Array;
}

/**
 * Build the buildings on every solid cell plus the surrounding town or
 * landscape. `toWorld` maps a cell coordinate to world space.
 */
export function buildEnvironment(geo: MapGeometry, S: SurfaceSet, disposables: { dispose(): void }[]): EnvironmentBuild {
  const style = mapStyle(geo.name);
  const g = geo;
  const W = g.w * CELL, H = g.h * CELL;
  const wx = (x: number) => (x - g.w / 2) * CELL, wz = (y: number) => (y - g.h / 2) * CELL;
  const R = rngOf(g.name.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const solid = (i: number) => g.kind[i] === 'wall' || g.kind[i] === 'void';
  const covered = new Uint8Array(g.w * g.h);

  // Wall tops as before (a little under real height so players stay visible), flooded out into the void.
  const top = new Float32Array(g.w * g.h).fill(NaN);
  const queue: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.kind[i] === 'wall') { top[i] = g.height[i]! * HEIGHT_UNIT + WALL_HEIGHT * 0.8; queue.push(i); }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!, x = i % g.w, y = (i - x) / g.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const j = ny * g.w + nx;
      if (g.kind[j] !== 'void' || !Number.isNaN(top[j]!)) continue;
      top[j] = top[i]!; queue.push(j);
    }
  }
  for (let i = 0; i < top.length; i++) if (Number.isNaN(top[i]!)) top[i] = WALL_HEIGHT * 0.8;

  // Split the solid cells into lots: greedy rectangles of varied size.
  const used = new Uint8Array(g.w * g.h);
  const lots: Lot[] = [];
  const thin: [number, number, number, number][] = [];
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && !used[y * g.w + x] && solid(y * g.w + x);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!open(x, y)) continue;
    const maxW = 6 + Math.floor(R() * 10), maxH = 6 + Math.floor(R() * 10);
    let w = 1; while (w < maxW && open(x + w, y)) w++;
    let h = 1;
    while (h < maxH) { let ok = true; for (let k = 0; k < w; k++) if (!open(x + k, y + h)) { ok = false; break; } if (!ok) break; h++; }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { used[yy * g.w + xx] = 1; covered[yy * g.w + xx] = 1; }
    if (Math.min(w, h) < 3) { thin.push([x, y, w, h]); continue; }
    let eave = 0, base = Infinity, nearFloor = false;
    let wallTop = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = yy * g.w + xx;
      eave = Math.max(eave, top[i]!); wallTop = eave;
      if (g.kind[i] === 'wall') { base = Math.min(base, g.height[i]! * HEIGHT_UNIT); nearFloor = true; }
    }
    if (!Number.isFinite(base)) base = Math.max(0, eave - WALL_HEIGHT * 0.8);
    // Grenade arcs are planned to clear SKYLINE metres above the ground under them: roofs stay below.
    let cap = Infinity;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) cap = Math.min(cap, g.height[yy * g.w + xx]! * HEIGHT_UNIT + SKYLINE - 0.3);
    // Lots set back from the lanes can stand a storey taller.
    eave += nearFloor ? Math.floor(R() * 3) * 0.6 : 0.6 + Math.floor(R() * 4) * 0.9;
    const lot: Lot = { x0: wx(x), z0: wz(y), x1: wx(x + w), z1: wz(y + h), base, eave: Math.max(wallTop, Math.min(eave, cap - 0.6)), outer: false, cap };
    // Which stretches of each side face open floor (for windows and doors).
    const side = (n: number, at: (k: number) => [number, number]) => {
      const f = new Float32Array(n).fill(NaN);
      for (let k = 0; k < n; k++) { const [cx, cy] = at(k); if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue; const j = cy * g.w + cx; if (!solid(j)) f[k] = g.height[j]! * HEIGHT_UNIT; }
      return f;
    };
    lot.front = [side(w, (k) => [x + k, y - 1]), side(h, (k) => [x + w, y + k]), side(w, (k) => [x + k, y + h]), side(h, (k) => [x - 1, y + k])];
    lots.push(lot);
  }

  // The town or landscape around the map: rows of lots separated by streets.
  const outerLots: Lot[] = [];
  const band = 46;
  const street = () => 4 + R() * 3;
  const ringLots = (ax0: number, az0: number, ax1: number, az1: number, alongX: boolean) => {
    let a = alongX ? ax0 : az0;
    const end = alongX ? ax1 : az1;
    while (a < end - 4) {
      const len = Math.min(end - a, 9 + R() * 12);
      let b = alongX ? az0 : ax0;
      const bEnd = alongX ? az1 : ax1;
      while (b < bEnd - 4) {
        const dep = Math.min(bEnd - b, 8 + R() * 10);
        const l: Lot = alongX
          ? { x0: a, x1: a + len, z0: b, z1: b + dep, base: 0, eave: 0, outer: true }
          : { x0: b, x1: b + dep, z0: a, z1: a + len, base: 0, eave: 0, outer: true };
        outerLots.push(l);
        b += dep + street();
      }
      a += len + street();
    }
  };
  const hw = W / 2, hh = H / 2, gap = 5.5;
  if (style.surround === 'town' || style.surround === 'industrial') {
    ringLots(-hw - band, -hh - band, hw + band, -hh - gap, true);
    ringLots(-hw - band, hh + gap, hw + band, hh + band, true);
    ringLots(-hh + 0, -hw - band, hh, -hw - gap, false);
    ringLots(-hh + 0, hw + gap, hh, hw + band, false);
  } else if (style.surround === 'desert') {
    // A few low buildings near the map, then open desert.
    ringLots(-hw - 22, -hh - 22, hw + 22, -hh - gap, true);
    ringLots(-hw - 22, hh + gap, hw + 22, hh + 20, true);
    ringLots(-hh, -hw - 20, hh, -hw - gap, false);
    ringLots(-hh, hw + gap, hh, hw + 22, false);
    for (let i = outerLots.length - 1; i >= 0; i--) if (R() < 0.45) outerLots.splice(i, 1);
  }
  for (const l of outerLots) {
    const industrial = style.surround === 'industrial';
    l.eave = (industrial ? 5 : 3.2) + Math.floor(R() * (industrial ? 4 : 3)) * (industrial ? 1.6 : 1.5);
  }

  // --------------------------------------------------------------- materials
  const facadeMat = worldMaterial({ top: S.roofFlat, side: S[style.facadeTex], topScale: 1 / 6, sideScale: style.facadeTex === 'sandstone' || style.facadeTex === 'mossy' ? 1 / 2.4 : 1 / 3.5, roughness: 0.92, baseShade: 0.3 });
  facadeMat.vertexColors = true;
  const tileMat = new THREE.MeshStandardMaterial({ map: S.roofTiles, normalMap: S.roofTilesN, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.78, vertexColors: true });
  const metalMat = new THREE.MeshStandardMaterial({ map: S.metalRoof, normalMap: S.metalRoofN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.5, metalness: 0.45, vertexColors: true });
  const trimMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.15, vertexColors: true });
  const winMat = new THREE.MeshStandardMaterial({ map: S.windows, alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true, flatShading: true });
  disposables.push(facadeMat, tileMat, metalMat, trimMat, winMat, leafMat);
  const A = { facade: new Acc(), tile: new Acc(), metal: new Acc(), trim: new Acc(), win: new Acc(), leaf: new Acc(), far: new Acc() };

  const C = (h: string) => new THREE.Color(h);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ----------------------------------------------------------------- walls
  const coping = C(style.coping);
  for (const [x, y, w, h] of thin) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const i = yy * g.w + xx;
    const t = top[i]!;
    const v = (frac(Math.sin(xx * 12.9898 + yy * 78.233) * 43758.5453) - 0.5) * 0.06;
    A.facade.box(wx(xx), -0.5, wz(yy), wx(xx + 1), t, wz(yy + 1), C(style.facade[0]!).offsetHSL(0, 0, v), false);
    A.trim.box(wx(xx) - 0.04, t, wz(yy) - 0.04, wx(xx + 1) + 0.04, t + 0.16, wz(yy + 1) + 0.04, coping.clone().offsetHSL(0, 0, v));
  }

  // -------------------------------------------------------------- buildings
  const winCell = (k: WindowKind) => { const i = WINDOW[k]; return [(i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 2] as const; };
  const addPanel = (k: WindowKind, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number) => {
    const [u0, v0] = winCell(k);
    const tx = -nz, tz = nx; // tangent along the facade
    const ox = cx + nx * 0.035, oz = cz + nz * 0.035;
    const a = V(ox - tx * w / 2, cy, oz - tz * w / 2), b = V(ox + tx * w / 2, cy, oz + tz * w / 2);
    const c = V(b.x, cy + h, b.z), d = V(a.x, cy + h, a.z);
    A.win.quad(a, b, c, d, new THREE.Color(1, 1, 1), V(nx, 0, nz), [[u0, v0], [u0 + 0.25, v0], [u0 + 0.25, v0 + 0.5], [u0, v0 + 0.5]]);
  };
  const decorate = (l: Lot, wallCol: THREE.Color) => {
    const sides: [number, number, number, number, number, number, number][] = [
      // start x, z, along x, along z, normal x, normal z, length
      [l.x0, l.z0, 1, 0, 0, -1, l.x1 - l.x0], [l.x1, l.z0, 0, 1, 1, 0, l.z1 - l.z0],
      [l.x0, l.z1, 1, 0, 0, 1, l.x1 - l.x0], [l.x0, l.z0, 0, 1, -1, 0, l.z1 - l.z0],
    ];
    sides.forEach(([sx, sz, ax, az, nx, nz, len], si) => {
      const front = l.front?.[si];
      const step = style.windows.length ? 2.6 + R() * 0.8 : 99;
      for (let s = 1.4; s < len - 1.2; s += step) {
        let floorH: number;
        if (l.outer) floorH = 0;
        else {
          const k = Math.min(front!.length - 1, Math.floor(s));
          floorH = front![k]!;
          if (Number.isNaN(floorH)) continue;
        }
        const px = sx + ax * s, pz = sz + az * s;
        const storeys = Math.max(1, Math.floor((l.eave - floorH - 0.6) / 3));
        for (let st = 0; st < storeys; st++) {
          const y = floorH + 1.0 + st * 3;
          if (y + 1.6 > l.eave) break;
          if (st === 0 && style.doors.length && R() < 0.12) { addPanel(pick(R, style.doors), px, floorH, pz, nx, nz, 1.5, 2.5); continue; }
          if (R() < 0.3 || !style.windows.length) continue;
          const k = weighted(R, style.windows);
          addPanel(k, px, y, pz, nx, nz, k === 'industrial' ? 2.2 : k === 'ornament' ? 2.6 : 1.2, k === 'industrial' ? 1.6 : k === 'ornament' ? 1.0 : 1.5);
        }
        // Dust2: timber beam ends under the roof line.
        if (style.extras.beams && R() < 0.5) for (let b = -1; b <= 1; b++) {
          const bx = px + ax * b * 0.7, bz = pz + az * b * 0.7;
          A.trim.box(bx - 0.09 + Math.min(0, nx) * 0.35, l.eave - 0.55, bz - 0.09 + Math.min(0, nz) * 0.35, bx + 0.09 + Math.max(0, nx) * 0.35, l.eave - 0.37, bz + 0.09 + Math.max(0, nz) * 0.35, C('#5a3e26'));
        }
      }
    });
    void wallCol;
  };

  const roofFor = (l: Lot, kind: RoofKind) => {
    const { x0, z0, x1, z1, eave: E } = l;
    const w = x1 - x0, d = z1 - z0;
    const roofCol = C(pick(R, style.roofColors)).offsetHSL((R() - 0.5) * 0.02, 0, (R() - 0.5) * 0.06);
    if (kind === 'tile' || kind === 'metal') {
      const o = kind === 'tile' ? 0.35 : 0.2;
      const along = w >= d; // ridge along x
      const span = (along ? d : w) / 2 + o;
      const pitch = kind === 'tile' ? 0.42 : 0.2;
      const rise = Math.max(0.4, Math.min(kind === 'tile' ? 3 : 1.4, span * pitch, (l.cap ?? Infinity) - E));
      const hip = kind === 'tile' && R() < 0.6;
      const X0 = x0 - o, X1 = x1 + o, Z0 = z0 - o, Z1 = z1 + o;
      const acc = kind === 'tile' ? A.tile : A.metal;
      const uS = kind === 'tile' ? 1 / 2.4 : 1 / 3, vS = kind === 'tile' ? 1 / 2.4 : 1 / 3;
      const slope = Math.hypot(span, rise) * vS;
      // Work in a frame where the ridge runs along "a" (x or z).
      const P = (a: number, b: number, y: number) => (along ? V(a, y, b) : V(b, y, a));
      const a0 = along ? X0 : Z0, a1 = along ? X1 : Z1, b0 = along ? Z0 : X0, b1 = along ? Z1 : X1, bc = (b0 + b1) / 2;
      const inset = hip ? Math.min(span, (a1 - a0) / 2 - 0.2) : 0;
      const ra0 = a0 + inset, ra1 = a1 - inset;
      const ey = E - o * pitch; // eave drops with the overhang
      const ry = E + rise - o * pitch;
      // Two long slopes.
      for (const [bEdge, sgn] of [[b1, 1], [b0, -1]] as const) {
        const out = along ? V(0, 1, sgn) : V(sgn, 1, 0);
        acc.quad(P(a0, bEdge, ey), P(a1, bEdge, ey), P(ra1, bc, ry), P(ra0, bc, ry), roofCol, out,
          [[a0 * uS, 0], [a1 * uS, 0], [ra1 * uS, slope], [ra0 * uS, slope]]);
      }
      if (hip) {
        for (const [aEdge, ra, sgn] of [[a0, ra0, -1], [a1, ra1, 1]] as const) {
          const out = along ? V(sgn, 1, 0) : V(0, 1, sgn);
          acc.tri(P(aEdge, b0, ey), P(aEdge, b1, ey), P(ra, bc, ry), roofCol, [b0 * uS, 0], [b1 * uS, 0], [bc * uS, slope], out);
        }
      } else {
        // Gable ends: wall triangles in the facade material.
        const fc = C(pick(R, style.facade));
        for (const [aEdge, sgn] of [[along ? x0 : z0, -1], [along ? x1 : z1, 1]] as const) {
          const out = along ? V(sgn, 0, 0) : V(0, 0, sgn);
          A.facade.tri(P(aEdge, b0 + o, E), P(aEdge, b1 - o, E), P(aEdge, bc, E + rise - o * pitch * 0), fc, [0, 0], [0, 0], [0, 0], out);
          // Barge board: a thin dark edge so the gable reads from above.
          acc.quad(P(aEdge + sgn * o, b0, ey), P(aEdge + sgn * o, bc, ry), P(aEdge + sgn * (o - 0.08), bc, ry + 0.05), P(aEdge + sgn * (o - 0.08), b0, ey + 0.05), roofCol.clone().multiplyScalar(0.7), out);
          acc.quad(P(aEdge + sgn * o, b1, ey), P(aEdge + sgn * o, bc, ry), P(aEdge + sgn * (o - 0.08), bc, ry + 0.05), P(aEdge + sgn * (o - 0.08), b1, ey + 0.05), roofCol.clone().multiplyScalar(0.7), out);
        }
      }
      // Ridge cap.
      const cap = roofCol.clone().multiplyScalar(kind === 'tile' ? 0.82 : 0.9);
      if (ra1 > ra0) {
        const r = kind === 'tile' ? 0.16 : 0.12;
        const s0 = P(ra0, bc - r, ry - 0.02), s1 = P(ra1, bc - r, ry - 0.02), t0 = P(ra0, bc, ry + r * 0.8), t1 = P(ra1, bc, ry + r * 0.8), u0 = P(ra0, bc + r, ry - 0.02), u1 = P(ra1, bc + r, ry - 0.02);
        acc.quad(s0, s1, t1, t0, cap, along ? V(0, 1, -1) : V(-1, 1, 0));
        acc.quad(u0, u1, t1, t0, cap, along ? V(0, 1, 1) : V(1, 1, 0));
      }
      if (kind === 'metal' && ra1 - ra0 > 6 && R() < 0.6) {
        // Ridge vent.
        const vl = (ra1 - ra0) * 0.5, vc = (ra0 + ra1) / 2;
        const p0 = P(vc - vl / 2, bc - 0.5, ry), p1 = P(vc + vl / 2, bc + 0.5, ry + 0.5);
        A.trim.box(Math.min(p0.x, p1.x), ry - 0.05, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), ry + 0.45, Math.max(p0.z, p1.z), C('#6d757c'));
      }
      if (kind === 'tile' && R() < (style.extras.chimney ?? 0)) {
        const ca = ra0 + (ra1 - ra0) * (0.2 + R() * 0.6), cb = bc + (R() < 0.5 ? -1 : 1) * span * 0.35;
        const cp = P(ca, cb, 0);
        const cy0 = E + rise * 0.4;
        A.facade.box(cp.x - 0.35, cy0 - 0.4, cp.z - 0.35, cp.x + 0.35, ry + 0.9, cp.z + 0.35, C(pick(R, style.facade)));
        A.tile.box(cp.x - 0.45, ry + 0.9, cp.z - 0.45, cp.x + 0.45, ry + 1.05, cp.z + 0.45, roofCol.clone().multiplyScalar(0.8));
      }
      return;
    }
    if (kind === 'stone') {
      // Stepped stone: a recessed upper tier on bigger lots, moss and plants on top.
      const moss = roofCol;
      A.trim.box(x0 - 0.12, E - 0.25, z0 - 0.12, x1 + 0.12, E + 0.05, z1 + 0.12, moss.clone().multiplyScalar(0.9));
      if (w > 6 && d > 6 && R() < 0.65) {
        const i = 1.2 + R() * 0.8, h2 = 1.1 + R() * 1.2;
        A.facade.box(x0 + i, E, z0 + i, x1 - i, E + h2, z1 - i, C(pick(R, style.facade)));
        A.trim.box(x0 + i - 0.1, E + h2 - 0.2, z0 + i - 0.1, x1 - i + 0.1, E + h2 + 0.05, z1 - i + 0.1, moss.clone().multiplyScalar(0.85));
      }
      const n = Math.floor((w * d) / 18 * (style.extras.plants ?? 0));
      for (let k = 0; k < n; k++) {
        const px = x0 + 0.8 + R() * (w - 1.6), pz = z0 + 0.8 + R() * (d - 1.6);
        A.leaf.blob(px, E + 0.4, pz, 0.6 + R() * 0.9, 0.6, C(pick(R, ['#4d6b34', '#5b7a3a', '#3f5d2e', '#6b8a46'])), k + px);
      }
      return;
    }
    // Flat roof: membrane inside a parapet, with rooftop clutter.
    const par = 0.25, ph = 0.45;
    const pc = C(style.coping);
    A.facade.box(x0, E - 0.02, z0, x1, E, z1, roofCol, true);
    if (style.extras.cornice) {
      // Egyptian cavetto cornice: a flared lip with a painted band.
      A.trim.box(x0 - 0.22, E - 0.1, z0 - 0.22, x1 + 0.22, E + 0.25, z1 + 0.22, pc);
      A.trim.box(x0 - 0.05, E - 0.45, z0 - 0.05, x1 + 0.05, E - 0.25, z1 + 0.05, C(style.extras.cornice));
    } else {
      A.facade.box(x0, E, z0, x1, E + ph, z0 + par, pc); A.facade.box(x0, E, z1 - par, x1, E + ph, z1, pc);
      A.facade.box(x0, E, z0 + par, x0 + par, E + ph, z1 - par, pc); A.facade.box(x1 - par, E, z0 + par, x1, E + ph, z1 - par, pc);
      A.trim.box(x0 - 0.04, E + ph, z0 - 0.04, x1 + 0.04, E + ph + 0.06, z1 + 0.04, pc.clone().multiplyScalar(1.04));
    }
    const ix0 = x0 + 0.7, iz0 = z0 + 0.7, ix1 = x1 - 0.7, iz1 = z1 - 0.7;
    if (ix1 - ix0 < 1.5 || iz1 - iz0 < 1.5) return;
    const spot = (s: number) => [ix0 + R() * Math.max(0.01, ix1 - ix0 - s), iz0 + R() * Math.max(0.01, iz1 - iz0 - s)] as const;
    const X = style.extras;
    if (X.dome && w > 6 && d > 6 && R() < X.dome) {
      const r = Math.min(w, d) * 0.28;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      A.facade.box(cx - r - 0.3, E, cz - r - 0.3, cx + r + 0.3, E + 0.9, cz + r + 0.3, C(pick(R, style.facade)));
      const dc = R() < 0.5 ? C('#f1ead8') : C('#3f8fa8');
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * Math.PI / 2, a1 = ((k + 1) / 5) * Math.PI / 2;
        A.trim.cyl(cx, E + 0.9 + Math.sin(a0) * r, cz, Math.cos(a0) * r, Math.cos(a1) * r, (Math.sin(a1) - Math.sin(a0)) * r, dc, 16, k === 4);
      }
      return;
    }
    if (X.hut && w > 5 && d > 5 && R() < X.hut) {
      const [hx, hz] = spot(2.2);
      A.facade.box(hx, E, hz, hx + 2.2, E + 2.2, hz + 2.2, C(pick(R, style.facade)));
      A.trim.box(hx - 0.1, E + 2.2, hz - 0.1, hx + 2.3, E + 2.3, hz + 2.3, pc);
    }
    if (X.tank && R() < X.tank * 2) {
      const [tx, tz] = spot(1.4);
      A.trim.cyl(tx + 0.7, E + 0.6, tz + 0.7, 0.55, 0.55, 1.2, C(pick(R, ['#d9d6cc', '#9aa3a8', '#3f6f8f'])), 12);
      A.trim.box(tx + 0.1, E, tz + 0.1, tx + 1.3, E + 0.6, tz + 1.3, C('#5d5a52'));
    }
    if (X.ac) for (let k = 0; k < 2; k++) if (R() < X.ac * 2) {
      const [ax, az] = spot(1.2);
      A.trim.box(ax, E, az, ax + 1.1, E + 0.7, az + 0.8, C('#c9cdd0'));
    }
    if (X.vent) for (let k = 0; k < 3; k++) if (R() < X.vent) {
      const [vx, vz] = spot(0.8);
      A.trim.cyl(vx + 0.4, E, vz + 0.4, 0.3, 0.3, 0.9, C('#8b9298'), 8);
      A.trim.cyl(vx + 0.4, E + 0.9, vz + 0.4, 0.42, 0.05, 0.3, C('#6f767c'), 8);
    }
    if (X.plants && R() < X.plants) {
      const [px, pz] = spot(1);
      A.trim.box(px, E, pz, px + 1, E + 0.4, pz + 0.5, C('#9a5a3a'));
      A.leaf.blob(px + 0.5, E + 0.6, pz + 0.25, 0.45, 0.7, C('#5f7d3e'), px);
    }
  };

  const building = (l: Lot) => {
    const col = C(pick(R, style.facade)).offsetHSL(0, 0, (R() - 0.5) * 0.05);
    const kind = weighted(R, style.roofs);
    // Industrial sheds are wide; small lots on industrial maps get flat roofs.
    const k2: RoofKind = kind === 'metal' && Math.min(l.x1 - l.x0, l.z1 - l.z0) < 5 ? 'flat' : kind;
    A.facade.box(l.x0, l.base - 0.5, l.z0, l.x1, l.eave, l.z1, col, k2 !== 'flat');
    // A plinth course at street level on stone towns.
    if (style.facadeTex === 'stucco' || style.facadeTex === 'plaster') A.trim.box(l.x0 - 0.04, l.base - 0.5, l.z0 - 0.04, l.x1 + 0.04, l.base + 0.45, l.z1 + 0.04, col.clone().multiplyScalar(0.78), false);
    roofFor(l, k2);
    decorate(l, col);
  };
  for (const l of lots) building(l);
  for (const l of outerLots) { l.base = 0; building(l); }

  // ----------------------------------------------------- vegetation & ground
  const trees: [number, number][] = [];
  const freeOuter = (x: number, z: number, r: number) => {
    if (x > -hw - r - 1 && x < hw + r + 1 && z > -hh - r - 1 && z < hh + r + 1) return false;
    return !outerLots.some((l) => x > l.x0 - r && x < l.x1 + r && z > l.z0 - r && z < l.z1 + r);
  };
  const treeN = style.vegetation === 'jungle' ? 900 : style.vegetation === 'none' ? 0 : style.vegetation === 'pine' ? 260 : 140;
  for (let k = 0, tries = 0; k < treeN && tries < treeN * 8; tries++) {
    const ang = R() * Math.PI * 2, rad = Math.max(hw, hh) + 4 + Math.pow(R(), 0.8) * 120;
    const x = Math.cos(ang) * rad * (hw / Math.max(hw, hh)) * 1.05, z = Math.sin(ang) * rad * (hh / Math.max(hw, hh)) * 1.05;
    if (!freeOuter(x, z, 1.5)) continue;
    trees.push([x, z]); k++;
  }
  for (const [x, z] of trees) {
    const s = 0.8 + R() * 0.5;
    if (style.vegetation === 'cypress') {
      A.trim.box(x - 0.12, 0, z - 0.12, x + 0.12, 1.2 * s, z + 0.12, C('#4a3a2a'));
      A.leaf.cyl(x, 0.8 * s, z, 0.85 * s, 0.05, 7.5 * s, C(pick(R, ['#34502c', '#2d4627', '#3c5a31'])), 8);
    } else if (style.vegetation === 'palm') {
      const h = (5 + R() * 3) * s;
      A.trim.cyl(x, 0, z, 0.22, 0.16, h, C('#7a6248'), 6);
      for (let f = 0; f < 7; f++) {
        const a = (f / 7) * Math.PI * 2 + R();
        const tip = V(x + Math.cos(a) * 2.6 * s, h - 0.9, z + Math.sin(a) * 2.6 * s);
        const side = V(-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45);
        A.leaf.tri(V(x, h + 0.2, z).add(side), V(x, h + 0.2, z).sub(side), tip, C(pick(R, ['#4f7a35', '#5f8a3c', '#46702f'])), [0, 0], [0, 0], [0, 0], V(0, 1, 0));
      }
    } else if (style.vegetation === 'pine') {
      const birch = R() < 0.35;
      if (birch) {
        A.trim.cyl(x, 0, z, 0.14, 0.1, 6 * s, C('#d9d6cc'), 6);
        A.leaf.blob(x, 6 * s, z, 1.9 * s, 1.2, C(pick(R, ['#6b8a46', '#7d9a52'])), x + z);
      } else {
        A.trim.cyl(x, 0, z, 0.2, 0.14, 2 * s, C('#4a3a2a'), 6);
        A.leaf.cyl(x, 1.5 * s, z, 2.1 * s, 0, 7.5 * s, C(pick(R, ['#2f4a2f', '#36533a', '#2a4129'])), 8);
      }
    } else if (style.vegetation === 'jungle') {
      const h = (4 + R() * 7) * s;
      A.trim.cyl(x, 0, z, 0.3, 0.2, h, C('#5a4632'), 6);
      const cc = C(pick(R, ['#3d5e2c', '#4a6d33', '#36552a', '#57793a']));
      A.leaf.blob(x, h, z, (2.4 + R() * 2) * s, 0.65, cc, x * 3 + z);
      if (R() < 0.6) A.leaf.blob(x + (R() - 0.5) * 2.5, h - 1.2, z + (R() - 0.5) * 2.5, (1.6 + R()) * s, 0.7, cc.clone().offsetHSL(0, 0, 0.04), x + z * 5);
    }
  }
  // Streets and yards in the outer town get a few parked cars or crates (industrial) for scale.
  if (style.surround === 'industrial') {
    for (let k = 0; k < 26; k++) {
      const x = (R() - 0.5) * (W + band * 1.6), z = (R() - 0.5) * (H + band * 1.6);
      if (!freeOuter(x, z, 2.5)) continue;
      const along = R() < 0.5;
      const L = 6, D2 = 2.4, col = C(pick(R, ['#2f6f8f', '#8f3a2f', '#3f7f4a', '#b9822a', '#7d8288']));
      const [hx, hz] = along ? [L / 2, D2 / 2] : [D2 / 2, L / 2];
      A.metal.box(x - hx, 0, z - hz, x + hx, 2.6, z + hz, col);
    }
  }

  // Distant landmarks.
  const lmR = Math.max(W, H) / 2 + band + 70;
  style.landmarks.forEach((kind, k) => {
    const ang = -Math.PI * 0.5 + (k - (style.landmarks.length - 1) / 2) * 0.55 + (R() - 0.5) * 0.2;
    const x = Math.cos(ang) * lmR, z = Math.sin(ang) * lmR;
    const stone = C(style.facade[0]!);
    if (kind === 'belltower') {
      A.facade.box(x - 3, 0, z - 3, x + 3, 26, z + 3, C('#d4b48a'));
      A.trim.box(x - 3.4, 26, z - 3.4, x + 3.4, 26.6, z + 3.4, C('#b88a64'));
      A.facade.box(x - 2.6, 26.6, z - 2.6, x + 2.6, 31, z + 2.6, C('#d9bd92'));
      A.tile.cyl(x, 31, z, 3.4, 0, 4, C('#a74f33'), 4);
    } else if (kind === 'minaret') {
      A.facade.box(x - 2.2, 0, z - 2.2, x + 2.2, 30, z + 2.2, C('#e2cba2'));
      A.trim.box(x - 2.8, 30, z - 2.8, x + 2.8, 31, z + 2.8, C('#3f8fa8'));
      A.facade.box(x - 1.6, 31, z - 1.6, x + 1.6, 36, z + 1.6, C('#e8d5ae'));
      A.trim.cyl(x, 36, z, 1.8, 0.1, 3, C('#3f8fa8'), 12);
    } else if (kind === 'dome') {
      A.facade.box(x - 10, 0, z - 10, x + 10, 9, z + 10, C('#e2cba2'));
      for (let s = 0; s < 6; s++) { const a0 = (s / 6) * Math.PI / 2, a1 = ((s + 1) / 6) * Math.PI / 2; A.trim.cyl(x, 9 + Math.sin(a0) * 8, z, Math.cos(a0) * 8, Math.cos(a1) * 8, (Math.sin(a1) - Math.sin(a0)) * 8, C('#3f8fa8'), 20, s === 5); }
    } else if (kind === 'pyramid') {
      const s = 34 + R() * 16;
      A.facade.cyl(x, 0, z, s, 0, s * 0.95, stone.clone().multiplyScalar(0.95), 4, false);
    } else if (kind === 'temple') {
      for (let t = 0; t < 6; t++) { const s = 24 - t * 3.6; A.facade.box(x - s, t * 4.5, z - s, x + s, t * 4.5 + 4.5, z + s, stone.clone().offsetHSL(0, 0, -t * 0.02)); }
      A.facade.box(x - 4, 27, z - 4, x + 4, 33, z + 4, stone);
      A.leaf.blob(x + 14, 9, z - 10, 5, 0.6, C('#3d5e2c'), 3);
    } else if (kind === 'cooling') {
      const off = k === 1 ? 46 : 0;
      for (let s = 0; s < 8; s++) {
        const f0 = s / 8, f1 = (s + 1) / 8;
        const r = (f: number) => 22 - 9 * Math.sin(f * Math.PI * 0.85);
        A.facade.cyl(x + off, f0 * 52, z, r(f0), r(f1), 52 / 8, C('#c9ccce').offsetHSL(0, 0, -0.02 * (s % 2)), 24, false);
      }
    } else if (kind === 'stack') {
      A.facade.cyl(x + 30, 0, z + 25, 3, 1.8, 62, C('#b9bec2'), 12);
      for (let s = 0; s < 3; s++) A.trim.cyl(x + 30, 46 + s * 5, z + 25, 2.2 - s * 0.1, 2.2 - s * 0.1, 2.2, C(s % 2 ? '#d6dadd' : '#b3392f'), 12, false);
    } else if (kind === 'wheel') {
      // A Ferris wheel on the skyline (abandoned fairground).
      const r = 22, cx = x - 20, cy = r + 4;
      for (let s = 0; s < 32; s++) {
        const a0 = (s / 32) * Math.PI * 2, a1 = ((s + 1) / 32) * Math.PI * 2;
        const p0 = V(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z), p1 = V(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z);
        A.trim.quad(p0, p1, p1.clone().setY(p1.y + 0.0).add(V(0, 0, 0.6)), p0.clone().add(V(0, 0, 0.6)), C('#c9b43a'), V(0, 0, 1));
        A.trim.quad(p0, p1, p1.clone().add(V(0, 0, 0.6)), p0.clone().add(V(0, 0, 0.6)), C('#c9b43a'), V(0, 0, -1));
        if (s % 4 === 0) {
          A.trim.quad(V(cx, cy, z + 0.3), p0.clone().add(V(0, 0, 0.3)), p0.clone().add(V(0, 0.4, 0.3)), V(cx, cy + 0.4, z + 0.3), C('#8b8f93'), V(0, 0, 1));
          A.metal.box(p0.x - 1, p0.y - 2.2, z - 0.9, p0.x + 1, p0.y - 0.2, z + 1.5, C('#c9b43a'));
        }
      }
      for (const sx of [-1, 1]) A.trim.quad(V(cx + sx * 10, 0, z), V(cx + sx * 10.8, 0, z), V(cx + 0.4 * sx, cy, z), V(cx, cy, z), C('#8b8f93'), V(0, 0, 1));
    } else if (kind === 'mesa') {
      for (let s = 0; s < 3; s++) A.facade.cyl(x + (s - 1) * 60, 0, z - s * 10, 40 - s * 6, 30 - s * 6, 18 + s * 5, C('#c79a66').offsetHSL(0, 0, -s * 0.03), 9);
    }
  });

  // ------------------------------------------------------------------ meshes
  const group = new THREE.Group();
  const add = (acc: Acc, mat: THREE.Material, cast = true) => {
    if (acc.empty) return;
    const geom = acc.build();
    disposables.push(geom);
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = cast; m.receiveShadow = true;
    group.add(m);
  };
  add(A.facade, facadeMat); add(A.tile, tileMat); add(A.metal, metalMat); add(A.trim, trimMat); add(A.win, winMat, false); add(A.leaf, leafMat);

  // Ground: the landscape under and around the map, plus distant hills.
  const groundTex = S[style.ground.tex];
  const groundMat = worldMaterial({ top: groundTex, topScale: style.ground.scale, roughness: 1 });
  groundMat.color.set(style.ground.color);
  disposables.push(groundMat);
  const groundGeo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  disposables.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.52; ground.receiveShadow = true;
  group.add(ground);
  // Streets between the outer blocks are paved like the map's own lanes.
  if (style.surround === 'town' || style.surround === 'industrial') {
    const paveMat = worldMaterial({ top: style.surround === 'industrial' ? S.asphalt : S.stones, topScale: 1 / 4, roughness: 0.95 });
    paveMat.color.set(style.surround === 'industrial' ? '#7d8287' : C(g.palette.floor).multiplyScalar(0.92));
    disposables.push(paveMat);
    const paveGeo = new THREE.PlaneGeometry(W + band * 2, H + band * 2);
    paveGeo.rotateX(-Math.PI / 2);
    disposables.push(paveGeo);
    const pave = new THREE.Mesh(paveGeo, paveMat);
    pave.position.y = -0.5; pave.receiveShadow = true;
    group.add(pave);
  }
  // Rolling hills on the horizon.
  const hills = new Acc();
  const hc = C(style.hills);
  const ringR0 = Math.max(W, H) / 2 + band + 140, ringR1 = ringR0 + 260;
  const SEG = 72;
  const hgt = (a: number) => 14 + 22 * (0.5 + 0.5 * Math.sin(a * 3 + 1.3)) * (0.6 + 0.4 * Math.sin(a * 7.1)) + 8 * Math.sin(a * 13.7);
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
    const p = (a: number, r: number, y: number) => V(Math.cos(a) * r, y, Math.sin(a) * r);
    hills.quad(p(a0, ringR0, -0.5), p(a1, ringR0, -0.5), p(a1, (ringR0 + ringR1) / 2, hgt(a1)), p(a0, (ringR0 + ringR1) / 2, hgt(a0)), hc, V(-Math.cos(a0), 1, -Math.sin(a0)));
    hills.quad(p(a0, (ringR0 + ringR1) / 2, hgt(a0)), p(a1, (ringR0 + ringR1) / 2, hgt(a1)), p(a1, ringR1, -0.5), p(a0, ringR1, -0.5), hc.clone().multiplyScalar(0.9), V(Math.cos(a0), 1, Math.sin(a0)));
  }
  const hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  disposables.push(hillMat);
  const hg = hills.build(); disposables.push(hg);
  group.add(new THREE.Mesh(hg, hillMat));

  return { group, style, covered };
}

/** Sky dome: a vertical gradient from the horizon colour to the zenith. */
export function skyDome(style: MapStyle, disposables: { dispose(): void }[]): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(style.sky[0]) }, horizon: { value: new THREE.Color(style.sky[1]) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float k = smoothstep(-0.02, 0.45, vP.y); gl_FragColor = vec4(mix(horizon, top, k), 1.0);\n#include <colorspace_fragment>\n}',
  });
  disposables.push(geo, mat);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
