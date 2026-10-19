/**
 * Landmark meshes for the 3D map (cars, crates, silos, palms, doors...), built
 * from simple shapes in code. Each map lists its props in its source file;
 * they are decoration only and never change movement or sight.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, WALL_HEIGHT } from '../../maps/types';
import type { MapGeometry, PropSource } from '../../maps/types';
import type { SurfaceSet } from './materials';

export interface PropContext {
  geo: MapGeometry;
  surfaces: SurfaceSet;
  /** World position of a cell coordinate (fractional) at height h (metres). */
  toWorld: (x: number, y: number, h?: number) => THREE.Vector3;
  disposables: { dispose(): void }[];
}

/** Things that move every frame (water). */
export interface PropAnim { tick(t: number): void }

const rnd = (seed: number) => { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };

class Mats {
  private cache = new Map<string, THREE.Material>();
  constructor(private ctx: PropContext) {}
  std(color: THREE.ColorRepresentation, rough = 0.8, metal = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = `s:${new THREE.Color(color).getHexString()}:${rough}:${metal}:${extra.map ? extra.map.uuid : ''}:${extra.emissive ?? ''}:${extra.transparent ?? ''}`;
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); this.cache.set(key, m); this.ctx.disposables.push(m); }
    return m;
  }
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, ctx: PropContext, shadow = true): THREE.Mesh {
  ctx.disposables.push(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/** Floor height under a cell rect: the highest walkable/base height inside it. */
function baseHeight(g: MapGeometry, r: PropSource['rect']): number {
  let h = -Infinity;
  for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    const k = g.kind[y * g.w + x];
    if (k !== 'void') h = Math.max(h, g.height[y * g.w + x]!);
  }
  return Number.isFinite(h) ? h : 0;
}

function kindAt(g: MapGeometry, r: PropSource['rect']): 'tall' | 'low' | 'wall' | 'other' {
  let tall = 0, low = 0, wall = 0;
  for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) {
    const k = g.kind[y * g.w + x];
    if (k === 'tall') tall++; else if (k === 'low') low++; else if (k === 'wall') wall++;
  }
  return tall >= low && tall >= wall && tall > 0 ? 'tall' : low >= wall && low > 0 ? 'low' : wall > 0 ? 'wall' : 'other';
}

export function buildProps(ctx: PropContext): { group: THREE.Group; anims: PropAnim[]; skinned: Set<number> } {
  const { geo } = ctx;
  const group = new THREE.Group();
  const anims: PropAnim[] = [];
  const skinned = new Set<number>();
  const mats = new Mats(ctx);
  geo.props.forEach((p, idx) => {
    try {
      const o = buildOne(p, idx, ctx, mats, anims);
      if (!o) return;
      group.add(o);
      if (isSolid(p.kind)) for (let y = p.rect[1]; y < p.rect[1] + p.rect[3]; y++) for (let x = p.rect[0]; x < p.rect[0] + p.rect[2]; x++) {
        const k = geo.kind[y * geo.w + x];
        if (k === 'low' || k === 'tall') skinned.add(y * geo.w + x);
      }
    } catch { /* a bad prop never breaks the map */ }
  });
  return { group: mergeStatic(group, ctx), anims, skinned };
}

/**
 * Props never move, so meshes that share a material (and shadow setting) are
 * baked into one geometry in world space: hundreds of draw calls become a few dozen.
 */
function mergeStatic(group: THREE.Group, ctx: PropContext): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const key = `${m.material.uuid}|${m.castShadow}`;
    let b = buckets.get(key);
    if (!b) { b = { mat: m.material, cast: m.castShadow, geos: [] }; buckets.set(key, b); }
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    g.applyMatrix4(m.matrixWorld);
    b.geos.push(g);
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = true;
    out.add(mesh);
    ctx.disposables.push(merged);
  }
  return out;
}

const SOLID = new Set(['crate', 'crates', 'barrel', 'car', 'van', 'truck', 'forklift', 'container', 'tank', 'pillar', 'statue', 'rock', 'sandbags', 'fountain', 'well', 'pallet', 'machine', 'planter', 'bench', 'cart']);
function isSolid(k: string) { return SOLID.has(k); }

function buildOne(p: PropSource, idx: number, ctx: PropContext, mats: Mats, anims: PropAnim[]): THREE.Object3D | null {
  const { geo, surfaces: S } = ctx;
  const [rx, ry, rw, rh] = p.rect;
  const base = baseHeight(geo, p.rect);
  const c = ctx.toWorld(rx + rw / 2, ry + rh / 2, base);
  const W = rw * CELL, D = rh * CELL;
  const long = Math.max(W, D), short = Math.min(W, D);
  const alongX = W >= D;
  const R = rnd(idx * 7919 + 13);
  const kind = kindAt(geo, p.rect);
  const root = new THREE.Group();
  root.position.copy(c);
  // Builders work in a local frame where the long axis is +x.
  const body = new THREE.Group();
  if (!alongX) body.rotation.y = Math.PI / 2;
  root.add(body);
  const pal = geo.palette;
  const tint = (fallback: string) => new THREE.Color(p.color ?? fallback);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) => { const o = mesh(g, m, ctx, shadow); o.position.set(x, y, z); body.add(o); return o; };
  const crateMat = (col: THREE.ColorRepresentation) => mats.std(col, 0.85, 0.02, { map: S.crate });
  const wheel = (x: number, z: number, r: number) => { const w = add(new THREE.CylinderGeometry(r, r, 0.22, 14), mats.std(0x1a1c1f, 0.9), x, r, z); w.rotation.x = Math.PI / 2; };

  switch (p.kind) {
    case 'crate': {
      const h = p.h ?? (kind === 'tall' ? 2.2 : 1.05);
      add(new THREE.BoxGeometry(long * 0.96, h, short * 0.96), crateMat(tint('#b08a58')), 0, h / 2, 0);
      break;
    }
    case 'crates': {
      const h = p.h ?? (kind === 'tall' ? 2.3 : 1.1);
      const nx = Math.max(1, Math.round(long / 1.2)), nz = Math.max(1, Math.round(short / 1.2));
      const sx = long / nx, sz = short / nz;
      const levels = h > 1.6 ? 2 : 1, lh = h / levels;
      for (let l = 0; l < levels; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (l > 0 && R() < 0.25) continue;
        const b = add(new THREE.BoxGeometry(sx * 0.94, lh * 0.97, sz * 0.94), crateMat(tint('#b08a58').offsetHSL(0, 0, (R() - 0.5) * 0.08)), -long / 2 + sx * (i + 0.5), lh * (l + 0.5), -short / 2 + sz * (j + 0.5));
        b.rotation.y = (R() - 0.5) * 0.12;
      }
      break;
    }
    case 'barrel': {
      const n = Math.max(1, Math.round(long / 0.75)), m = Math.max(1, Math.round(short / 0.75));
      const col = tint(['#3f6b8a', '#8a3b2e', '#6b6b3a'][idx % 3]!);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const x = -long / 2 + (long / n) * (i + 0.5), z = -short / 2 + (short / m) * (j + 0.5);
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.95, 16), mats.std(col, 0.55, 0.35), x, 0.475, z);
        add(new THREE.TorusGeometry(0.3, 0.025, 6, 16), mats.std(0x2a2a2a, 0.5, 0.5), x, 0.3, z).rotation.x = Math.PI / 2;
        add(new THREE.TorusGeometry(0.3, 0.025, 6, 16), mats.std(0x2a2a2a, 0.5, 0.5), x, 0.7, z).rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'car': {
      const L = Math.min(long, 4.6), Wd = Math.min(short, 1.9);
      const paint = mats.std(tint(['#7d2f26', '#3c5a74', '#c9c2b0', '#5b6b3c'][idx % 4]!), 0.35, 0.5);
      add(new THREE.BoxGeometry(L, 0.7, Wd), paint, 0, 0.6, 0);
      add(new THREE.BoxGeometry(L * 0.5, 0.55, Wd * 0.92), paint, -L * 0.06, 1.2, 0);
      add(new THREE.BoxGeometry(L * 0.46, 0.42, Wd * 0.96), mats.std(0x1b2430, 0.1, 0.6), -L * 0.06, 1.2, 0, false);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(sx * L * 0.32, sz * Wd * 0.48, 0.34);
      add(new THREE.BoxGeometry(0.05, 0.12, Wd * 0.7), mats.std(0xfff3c4, 0.3, 0, { emissive: new THREE.Color(0x332a10) }), L / 2, 0.75, 0, false);
      break;
    }
    case 'van': {
      const L = Math.min(long, 5.2), Wd = Math.min(short, 2.1);
      const paint = mats.std(tint('#d8d5cc'), 0.45, 0.3);
      add(new THREE.BoxGeometry(L * 0.72, 2.0, Wd), paint, -L * 0.14, 1.3, 0);
      add(new THREE.BoxGeometry(L * 0.28, 1.4, Wd), paint, L * 0.36, 1.0, 0);
      add(new THREE.BoxGeometry(0.06, 0.6, Wd * 0.85), mats.std(0x1b2430, 0.1, 0.6), L / 2, 1.35, 0, false);
      for (const sx of [-0.3, 0.32]) for (const sz of [-1, 1]) wheel(sx * L, sz * Wd * 0.48, 0.38);
      break;
    }
    case 'truck': {
      const L = Math.min(long, 9), Wd = Math.min(short, 2.5);
      const cab = mats.std(tint('#c79a2a'), 0.45, 0.3);
      add(new THREE.BoxGeometry(L * 0.22, 2.4, Wd), cab, L * 0.39, 1.6, 0);
      add(new THREE.BoxGeometry(0.06, 0.8, Wd * 0.85), mats.std(0x1b2430, 0.1, 0.6), L / 2, 2.1, 0, false);
      add(new THREE.BoxGeometry(L * 0.74, 2.6, Wd), mats.std(0xc9c9c9, 0.6, 0.3, { map: S.ribbed }), -L * 0.12, 1.9, 0);
      add(new THREE.BoxGeometry(L, 0.3, Wd * 0.9), mats.std(0x262626, 0.7, 0.4), 0, 0.55, 0);
      for (const sx of [-0.4, -0.25, 0.38]) for (const sz of [-1, 1]) wheel(sx * L, sz * Wd * 0.46, 0.45);
      break;
    }
    case 'forklift': {
      const L = Math.min(long, 3), Wd = Math.min(short, 1.4);
      const y = mats.std(tint('#e0b021'), 0.45, 0.3);
      add(new THREE.BoxGeometry(L * 0.6, 1.0, Wd), y, -L * 0.1, 0.8, 0);
      add(new THREE.BoxGeometry(L * 0.25, 0.9, Wd), mats.std(0x2b2b2b, 0.6, 0.4), -L * 0.38, 0.75, 0);
      for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.08, 2.0, 0.08), mats.std(0x222222, 0.5, 0.6), -L * 0.05, 2.0, sz * Wd * 0.45);
      add(new THREE.BoxGeometry(L * 0.62, 0.08, Wd), mats.std(0x222222, 0.5, 0.6), -L * 0.08, 3.0, 0);
      for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.1, 2.6, 0.12), mats.std(0x333333, 0.5, 0.6), L * 0.25, 1.4, sz * Wd * 0.3);
      for (const sz of [-1, 1]) add(new THREE.BoxGeometry(L * 0.3, 0.06, 0.14), mats.std(0x444444, 0.4, 0.7), L * 0.42, 0.12, sz * Wd * 0.3);
      for (const sx of [-0.3, 0.15]) for (const sz of [-1, 1]) wheel(sx * L, sz * Wd * 0.5, 0.3);
      break;
    }
    case 'container': {
      const h = p.h ?? 2.6;
      const col = tint(['#2f6f8f', '#8f3a2f', '#3f7f4a', '#b9822a'][idx % 4]!);
      add(new THREE.BoxGeometry(long * 0.98, h, short * 0.98), mats.std(col, 0.55, 0.35, { map: S.ribbed }), 0, h / 2, 0);
      add(new THREE.BoxGeometry(0.06, h * 0.9, short * 0.8), mats.std(col.clone().multiplyScalar(0.7), 0.5, 0.4), long * 0.49, h / 2, 0);
      break;
    }
    case 'tank': {
      const h = p.h ?? 7;
      const r = short / 2 * 0.95;
      const m = mats.std(tint('#cfd3d6'), 0.45, 0.45);
      const n = Math.max(1, Math.round(long / short));
      for (let i = 0; i < n; i++) {
        const x = -long / 2 + (long / n) * (i + 0.5);
        add(new THREE.CylinderGeometry(r, r, h, 28), m, x, h / 2, 0);
        add(new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, x, h, 0).scale.y = 0.35;
        for (const yy of [h * 0.3, h * 0.65]) add(new THREE.TorusGeometry(r * 1.005, 0.05, 6, 28), mats.std(0x7a8086, 0.5, 0.6), x, yy, 0).rotation.x = Math.PI / 2;
        add(new THREE.BoxGeometry(0.06, h * 0.9, 0.5), mats.std(0x555b61, 0.5, 0.6), x + r, h * 0.45, 0);
      }
      break;
    }
    case 'pillar': {
      const h = p.h ?? (kind === 'wall' ? WALL_HEIGHT * 0.8 + 0.6 : 4);
      const r = short / 2 * 0.8;
      const stone = mats.std(tint(pal.wall), 0.85, 0.02, { map: S.plaster });
      const n = Math.max(1, Math.round(long / short));
      for (let i = 0; i < n; i++) {
        const x = -long / 2 + (long / n) * (i + 0.5);
        add(new THREE.BoxGeometry(r * 2.4, 0.35, r * 2.4), stone, x, 0.17, 0);
        add(new THREE.CylinderGeometry(r * 0.9, r, h - 0.7, 18), stone, x, h / 2, 0);
        add(new THREE.BoxGeometry(r * 2.4, 0.35, r * 2.4), stone, x, h - 0.17, 0);
      }
      break;
    }
    case 'statue': {
      const h = p.h ?? 3.4;
      const stone = mats.std(tint('#b9ab8e'), 0.8, 0.02, { map: S.plaster });
      add(new THREE.BoxGeometry(long * 0.9, h * 0.3, short * 0.9), stone, 0, h * 0.15, 0);
      add(new THREE.CylinderGeometry(short * 0.18, short * 0.26, h * 0.45, 10), stone, 0, h * 0.53, 0);
      add(new THREE.SphereGeometry(short * 0.17, 12, 10), stone, 0, h * 0.85, 0);
      add(new THREE.ConeGeometry(short * 0.2, h * 0.22, 4), stone, 0, h * 1.0, 0);
      break;
    }
    case 'rock': {
      const h = p.h ?? (kind === 'tall' ? 2.2 : 1.1);
      const g = new THREE.DodecahedronGeometry(1, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const k = 0.85 + R() * 0.3; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k); }
      g.computeVertexNormals();
      const r = add(g, mats.std(tint('#8d8577'), 0.95, 0.02), 0, h * 0.45, 0);
      r.scale.set(long * 0.5, h * 0.55, short * 0.5);
      break;
    }
    case 'sandbags': {
      const h = p.h ?? 1.0;
      const m = mats.std(tint('#b59f73'), 0.95, 0.0);
      const layers = Math.max(2, Math.round(h / 0.3));
      const per = Math.max(1, Math.round(long / 0.62));
      const g = new THREE.CapsuleGeometry(0.16, 0.36, 3, 8);
      ctx.disposables.push(g);
      for (let l = 0; l < layers; l++) for (let i = 0; i < per; i++) {
        const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true;
        o.rotation.z = Math.PI / 2; o.scale.set(1, 1, 1.35);
        o.position.set(-long / 2 + (long / per) * (i + 0.5 + (l % 2) * 0.5 - 0.25), 0.16 + l * 0.28, (R() - 0.5) * 0.06);
        body.add(o);
      }
      break;
    }
    case 'fountain': {
      const r = short / 2 * 0.95;
      const stone = mats.std(tint('#c4b597'), 0.85, 0.02, { map: S.plaster });
      add(new THREE.CylinderGeometry(r, r * 1.05, 0.7, 28), stone, 0, 0.35, 0);
      const w = add(new THREE.CircleGeometry(r * 0.86, 28), waterMat(ctx, mats, anims, '#3d8fa6'), 0, 0.62, 0, false); w.rotation.x = -Math.PI / 2;
      add(new THREE.CylinderGeometry(r * 0.16, r * 0.22, 1.6, 12), stone, 0, 1.0, 0);
      add(new THREE.CylinderGeometry(r * 0.42, r * 0.3, 0.18, 18), stone, 0, 1.7, 0);
      break;
    }
    case 'well': {
      const r = short / 2 * 0.9;
      const stone = mats.std(tint('#9d917b'), 0.9, 0.02, { map: S.blocks });
      add(new THREE.CylinderGeometry(r, r, 0.9, 20, 1, true), stone, 0, 0.45, 0);
      const w = add(new THREE.CircleGeometry(r * 0.95, 20), mats.std(0x10181c, 0.2, 0.2), 0, 0.3, 0, false); w.rotation.x = -Math.PI / 2;
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.12, 1.8, 0.12), mats.std(0x5a4128, 0.9), sx * r, 1.3, 0);
      add(new THREE.BoxGeometry(r * 2.6, 0.12, r * 1.4), mats.std(0x6e4d2c, 0.9), 0, 2.25, 0).rotation.x = 0.0;
      break;
    }
    case 'pallet': {
      const m = mats.std(tint('#a0784a'), 0.9);
      for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(long * 0.95, 0.04, short * 0.15), m, 0, 0.16, -short / 2 + short * (i + 0.5) / 5);
      for (const z of [-0.4, 0, 0.4]) add(new THREE.BoxGeometry(long * 0.95, 0.12, 0.1), m, 0, 0.07, z * short);
      add(new THREE.BoxGeometry(long * 0.8, 0.8, short * 0.8), crateMat('#9c9c9c'), 0, 0.6, 0);
      break;
    }
    case 'machine': {
      const h = p.h ?? (kind === 'tall' ? 2.4 : 1.3);
      const m = mats.std(tint('#6f7a80'), 0.5, 0.55);
      add(new THREE.BoxGeometry(long * 0.95, h, short * 0.95), m, 0, h / 2, 0);
      add(new THREE.BoxGeometry(long * 0.5, h * 0.3, 0.04), mats.std(0x1a2a30, 0.3, 0.3, { emissive: new THREE.Color(0x0a2a20) }), 0, h * 0.62, short * 0.48, false);
      add(new THREE.CylinderGeometry(0.12, 0.12, long, 10), mats.std(0x9aa3a8, 0.4, 0.7), 0, h + 0.15, -short * 0.25).rotation.z = Math.PI / 2;
      break;
    }
    case 'planter': {
      const stone = mats.std(tint('#a89878'), 0.85, 0.02, { map: S.blocks });
      add(new THREE.BoxGeometry(long * 0.95, 0.8, short * 0.95), stone, 0, 0.4, 0);
      const bush = mats.std(0x4f6b34, 0.95);
      const n = Math.max(1, Math.round(long / 1.2));
      for (let i = 0; i < n; i++) add(new THREE.IcosahedronGeometry(Math.min(0.7, short * 0.45), 1), bush, -long / 2 + (long / n) * (i + 0.5), 1.1, 0);
      break;
    }
    case 'bench': {
      const wood = mats.std(tint('#7b5a3a'), 0.85);
      add(new THREE.BoxGeometry(long * 0.9, 0.08, short * 0.6), wood, 0, 0.48, 0);
      add(new THREE.BoxGeometry(long * 0.9, 0.4, 0.06), wood, 0, 0.75, -short * 0.3);
      for (const sx of [-0.4, 0.4]) add(new THREE.BoxGeometry(0.08, 0.46, short * 0.5), mats.std(0x2a2a2a, 0.5, 0.6), sx * long, 0.23, 0);
      break;
    }
    case 'cart': {
      add(new THREE.BoxGeometry(long * 0.8, 0.7, short * 0.85), mats.std(tint('#7b5a3a'), 0.85, 0.02, { map: S.crate }), 0, 0.85, 0);
      for (const sz of [-1, 1]) { const w = add(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16), mats.std(0x4a3420, 0.9), 0, 0.45, sz * short * 0.47); w.rotation.x = Math.PI / 2; }
      break;
    }
    // ---- flat
    case 'water': {
      const pl = add(new THREE.PlaneGeometry(long, short), waterMat(ctx, mats, anims, p.color ?? '#3b8ea5'), 0, 0.06, 0, false);
      pl.rotation.x = -Math.PI / 2; pl.receiveShadow = true;
      break;
    }
    case 'grass': case 'sand': case 'rug': case 'tiles': {
      let m: THREE.Material;
      if (p.kind === 'grass') m = mats.std(tint('#5f7a3a'), 0.95, 0, { map: S.grass });
      else if (p.kind === 'sand') m = mats.std(tint('#c9ad7a'), 1, 0, { map: S.plaster });
      else if (p.kind === 'rug') m = mats.std(tint('#7a2f2a'), 0.95, 0);
      else m = checkerMat(ctx, p.color);
      const pl = add(new THREE.PlaneGeometry(long, short), m, 0, 0.035, 0, false);
      pl.rotation.x = -Math.PI / 2;
      if (p.kind === 'tiles' && m instanceof THREE.MeshStandardMaterial && m.map) { m.map.repeat.set(1, 1); }
      if (p.kind === 'tiles') { const uv = pl.geometry.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * long / 2, uv.getY(i) * short / 2); }
      break;
    }
    case 'rubble': {
      const m = mats.std(tint('#8a8070'), 0.95);
      const g = new THREE.DodecahedronGeometry(0.18, 0);
      ctx.disposables.push(g);
      const n = Math.round(long * short * 2.5);
      for (let i = 0; i < n; i++) {
        const o = new THREE.Mesh(g, m); o.castShadow = true;
        const s = 0.5 + R() * 1.4;
        o.scale.set(s, s * 0.6, s);
        o.position.set((R() - 0.5) * long, 0.06, (R() - 0.5) * short);
        o.rotation.set(R() * 3, R() * 3, R() * 3);
        body.add(o);
      }
      break;
    }
    // ---- frames over openings
    case 'door': case 'arch': {
      const h = p.h ?? 2.9;
      const span = long + 0.4;
      const m = p.kind === 'door' ? mats.std(tint('#5b3f27'), 0.85) : mats.std(tint(pal.wall), 0.85, 0.02, { map: S.blocks });
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.4, h, short + 0.2), m, sx * (span / 2), h / 2, 0);
      if (p.kind === 'door') {
        add(new THREE.BoxGeometry(span + 0.4, 0.45, short + 0.2), m, 0, h + 0.22, 0);
        // Open door leaves swung back against the frame.
        const leaf = mats.std(tint('#6a4a2c').offsetHSL(0, 0, -0.05), 0.85);
        for (const sx of [-1, 1]) { const l = add(new THREE.BoxGeometry(0.08, h * 0.92, long / 2), leaf, sx * (span / 2 - 0.15), h * 0.46, short / 2 + long / 4); l.rotation.y = 0; }
      } else {
        const a = add(new THREE.TorusGeometry(span / 2, 0.22, 8, 24, Math.PI), m, 0, h, 0);
        a.scale.z = (short + 0.2) / 0.44;
      }
      break;
    }
    // ---- outdoor
    case 'tree': {
      const h = p.h ?? 6.5;
      add(new THREE.CylinderGeometry(0.12, 0.2, h * 0.55, 8), mats.std(0x5a4330, 0.95), 0, h * 0.27, 0);
      const leaf = mats.std(tint('#4d6a33'), 0.95);
      const r = Math.max(1.2, short * 0.7);
      for (let i = 0; i < 4; i++) add(new THREE.IcosahedronGeometry(r * (0.6 + R() * 0.4), 1), leaf, (R() - 0.5) * r, h * (0.6 + R() * 0.3), (R() - 0.5) * r);
      break;
    }
    case 'palm': {
      const h = p.h ?? 7.5;
      const trunk = mats.std(0x7a6247, 0.95);
      const segs = 6; let x = 0, y = 0;
      const lean = (R() - 0.5) * 0.5;
      for (let i = 0; i < segs; i++) {
        const sh = h / segs;
        const s = add(new THREE.CylinderGeometry(0.13, 0.17, sh, 7), trunk, x, y + sh / 2, 0);
        s.rotation.z = -lean * 0.5; x += Math.sin(lean) * sh * 0.5; y += sh;
      }
      const leaf = mats.std(tint('#5d7a32'), 0.9, 0, { side: THREE.DoubleSide } as Partial<THREE.MeshStandardMaterialParameters>);
      for (let i = 0; i < 8; i++) {
        const l = add(new THREE.PlaneGeometry(3.2, 0.55), leaf, x, y, 0);
        l.rotation.set(-Math.PI / 2 + 0.35, (i / 8) * Math.PI * 2, 0, 'YXZ');
        l.translateX(1.4);
      }
      break;
    }
    case 'lamp': {
      add(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8), mats.std(0x2a2d31, 0.5, 0.6), 0, 1.8 + (kind === 'wall' ? WALL_HEIGHT * 0.8 : 0), 0);
      add(new THREE.SphereGeometry(0.22, 12, 8), mats.std(0xfff1c8, 0.3, 0, { emissive: new THREE.Color(0xffd27a) }), 0, 3.7 + (kind === 'wall' ? WALL_HEIGHT * 0.8 : 0), 0, false);
      break;
    }
    case 'awning': {
      const top = WALL_HEIGHT * 0.8;
      const cloth = awningMat(ctx, p.color ?? '#a6402f');
      const a = add(new THREE.PlaneGeometry(long, Math.max(1.2, short)), cloth, 0, top - 0.3, 0, true);
      a.rotation.x = -Math.PI / 2 + 0.35;
      break;
    }
    case 'sign': {
      const t = signTex(ctx, p.text ?? '', p.color ?? '#c96f3a');
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, transparent: true });
      ctx.disposables.push(m);
      const s = add(new THREE.PlaneGeometry(Math.max(1.2, long), Math.max(1.2, long) * 0.6), m, 0, WALL_HEIGHT * 0.8 + 0.9, 0, false);
      s.rotation.x = -Math.PI / 2 + 0.9;
      break;
    }
    case 'vines': {
      const top = WALL_HEIGHT * 0.8;
      const m = mats.std(tint('#3f5e2c'), 0.95, 0, { map: S.grass });
      add(new THREE.BoxGeometry(long + 0.08, top * 0.55, short + 0.08), m, 0, top * 0.72, 0, false);
      break;
    }
    default:
      return null;
  }
  return root;
}

function waterMat(ctx: PropContext, mats: Mats, anims: PropAnim[], color: string): THREE.Material {
  const t = ctx.surfaces.water.clone();
  t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.25, 0.25);
  ctx.disposables.push(t);
  const m = new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.88 });
  ctx.disposables.push(m);
  anims.push({ tick: (time) => { t.offset.set(time * 0.012, time * 0.007); } });
  void mats;
  return m;
}

function checkerMat(ctx: PropContext, color?: string): THREE.MeshStandardMaterial {
  // Worn chequered tiles: 0.5 m tiles (4 x 4 per 2 m repeat), grout lines and a little grime.
  const n = 128, k = 4, s = n / k;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d')!;
  const dark = new THREE.Color(color ?? '#1e1f22').lerp(new THREE.Color('#6a665e'), 0.45);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#6d6a63'; g.fillRect(0, 0, n, n);
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const base = (x + y) % 2 ? dark.clone() : new THREE.Color('#c2bbac');
    base.offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
    g.fillStyle = `#${base.getHexString()}`;
    g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
  }
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(40,34,26,${0.04 + rnd() * 0.08})`; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 5, 1 + rnd() * 5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
  ctx.disposables.push(t, m);
  return m;
}

function awningMat(ctx: PropContext, color: string): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ece6d6' : color; g.fillRect(i * 8, 0, 8, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide });
  ctx.disposables.push(t, m);
  return m;
}

function signTex(ctx: PropContext, text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 154;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.beginPath(); g.roundRect(4, 4, 248, 146, 12); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#ffffff'; g.font = '700 96px "Chakra Petch", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 4), 128, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  ctx.disposables.push(t);
  return t;
}
