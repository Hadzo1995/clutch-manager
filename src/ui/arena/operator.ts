/**
 * Operators: how players look in 3D (home lobby and live match), in the style of a modern
 * tactical shooter's agents. Original designs built in code, no game files.
 *
 * The kit is skinned to the rigged figure's skeleton, so it moves with the same idle, walk and
 * run animations. Counter-terrorists wear ballistic helmets, plate carriers, knee pads and
 * gloves in three unit looks: urban police (black, goggles), rangers (green, glasses) and a
 * coyote unit in gas masks. Terrorists wear a balaclava, a shemagh or a beanie with a gaiter,
 * jackets or a hoodie, jeans or cargo trousers and chest rigs.
 *
 * Everything is authored in metres in the skeleton's bind pose (a T-pose, feet at y = 0, facing
 * -z, right hand at +x) and bound with a bind matrix that maps that space onto the skeleton, so
 * one set of geometry per look is shared by every figure wearing it.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Side = 'T' | 'CT';
type V3 = [number, number, number];
type Weights = Record<string, number>;
type Slot = 'kit' | 'gear' | 'lens' | 'accent';

/** The skeleton's bind pose: joint positions in metres, and the bind matrix for meshes authored there. */
export interface Bind {
  at(name: string): THREE.Vector3;
  bindMatrix: THREE.Matrix4;
}

/** Read the bind pose from the figure's own skinned mesh (and the scene it was loaded in, for end joints). */
export function bindOf(mesh: THREE.SkinnedMesh, scene: THREE.Object3D): Bind {
  scene.updateMatrixWorld(true);
  const C = mesh.matrixWorld.clone();
  const bindInv = mesh.bindMatrix.clone().invert();
  const pos = new Map<string, THREE.Vector3>();
  const m = new THREE.Matrix4();
  mesh.skeleton.bones.forEach((b, i) => {
    m.copy(mesh.skeleton.boneInverses[i]!).invert().premultiply(bindInv).premultiply(C);
    pos.set(b.name, new THREE.Vector3().setFromMatrixPosition(m));
  });
  scene.traverse((o) => { if (!pos.has(o.name) && /^mixamorig/.test(o.name)) pos.set(o.name, o.getWorldPosition(new THREE.Vector3())); });
  return {
    at: (n) => (pos.get(`mixamorig${n}`) ?? new THREE.Vector3()).clone(),
    // world = C · bindMatrix⁻¹ · bindMatrix' · p must be p itself.
    bindMatrix: mesh.bindMatrix.clone().multiply(C.clone().invert()),
  };
}

// ------------------------------------------------------------------------------------ looks

interface Look {
  shirt: string; pants: string; boots: string; sole: string; gloves: string; skin: string;
  /** What covers the head under any hat. */
  head: 'balaclava' | 'shemagh' | 'bare';
  headColor: string;
  hat?: 'helmet' | 'beanie';
  hatColor?: string;
  eyes: 'goggles' | 'glasses' | 'gasmask' | 'slit' | 'sunglasses';
  /** CT plate carrier colours. */
  carrier?: string; pouch?: string;
  /** T chest rig colour. */
  rig?: string;
  gaiter?: string;
  headset?: boolean; kneePads?: boolean; holster?: boolean; hood?: boolean; jacket?: boolean;
  pack?: string;
}

const LOOKS: Record<Side, Look[]> = {
  CT: [
    // Urban police unit: black kit, goggles over a balaclava, headset.
    { shirt: '#2b323c', pants: '#22272e', boots: '#121314', sole: '#0a0a0b', gloves: '#141619', skin: '#b88a6a', head: 'balaclava', headColor: '#131518',
      hat: 'helmet', hatColor: '#262b31', eyes: 'goggles', carrier: '#1c1f23', pouch: '#22262b', headset: true, kneePads: true, holster: true },
    // Rangers: green kit, ballistic glasses, a hydration pack.
    { shirt: '#4a5242', pants: '#4b5142', boots: '#3d3229', sole: '#191512', gloves: '#2a2b26', skin: '#a77a5b', head: 'balaclava', headColor: '#30332b',
      hat: 'helmet', hatColor: '#4e5545', eyes: 'glasses', carrier: '#585b45', pouch: '#51543f', headset: true, kneePads: true, pack: '#4f533f' },
    // Coyote unit in gas masks.
    { shirt: '#6d624d', pants: '#625946', boots: '#4f412f', sole: '#1d1913', gloves: '#3b352c', skin: '#c49a78', head: 'balaclava', headColor: '#2a2826',
      hat: 'helmet', hatColor: '#655a46', eyes: 'gasmask', carrier: '#6a5d45', pouch: '#625641', kneePads: true, holster: true },
  ],
  T: [
    // Balaclava, dark jacket, jeans, olive chest rig.
    { shirt: '#2d2b29', pants: '#2b3341', boots: '#29231d', sole: '#121110', gloves: '#161616', skin: '#c09474', head: 'balaclava', headColor: '#121212',
      eyes: 'slit', rig: '#47473a', jacket: true },
    // Shemagh, olive hoodie, khaki cargo trousers, tan boots.
    { shirt: '#4d5240', pants: '#5c5444', boots: '#4a3a29', sole: '#2a2219', gloves: '#4a4032', skin: '#a87a58', head: 'shemagh', headColor: '#7f6f52',
      eyes: 'slit', rig: '#5a4f3a', hood: true },
    // Beanie, gaiter and sunglasses, slate jacket, bare hands.
    { shirt: '#3a4049', pants: '#38362f', boots: '#1d1c1b', sole: '#0f0f0f', gloves: '#b48767', skin: '#b48767', head: 'bare', headColor: '#b48767',
      hat: 'beanie', hatColor: '#1d1e20', gaiter: '#2b2c2a', eyes: 'sunglasses', rig: '#3a3a2e', jacket: true },
  ],
};

export const lookCount = (side: Side) => LOOKS[side].length;

// ------------------------------------------------------------------------------------ mesher

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _hs = new THREE.Vector3();

/** Collects skinned, vertex-coloured triangles for one material slot. */
class Mesher {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; si: number[] = []; sw: number[] = []; ix: number[] = [];
  constructor(private bone: (name: string) => number) {}
  get count() { return this.p.length / 3; }

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, col: THREE.Color, w: Weights) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(col.r, col.g, col.b);
    const e = Object.entries(w).filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = e.reduce((s, [, x]) => s + x, 0) || 1;
    for (let i = 0; i < 4; i++) { const x = e[i]; this.si.push(x ? this.bone(x[0]) : 0); this.sw.push(x ? x[1] / sum : 0); }
  }

  /** Append a primitive placed by `m`, in one colour, skinned by fixed weights or a function of position. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color, w: Weights | ((p: THREE.Vector3) => Weights)) {
    const geo = g.applyMatrix4(m);
    const P = geo.attributes.position!, N = geo.attributes.normal!, U = geo.attributes.uv;
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i).normalize();
      this.vert(_v, _n, U ? U.getX(i) : 0, U ? U.getY(i) : 0, col, typeof w === 'function' ? w(_v) : w);
    }
    const flip = m.determinant() < 0;
    const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: P.count }, (_, i) => i);
    for (let i = 0; i + 2 < idx.length; i += 3) {
      if (flip) this.ix.push(base + idx[i]!, base + idx[i + 2]!, base + idx[i + 1]!);
      else this.ix.push(base + idx[i]!, base + idx[i + 1]!, base + idx[i + 2]!);
    }
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------------------------ shapes

interface Ring { c: V3; a: number; b: number; w: Weights }

function catmull(vals: number[], u: number) {
  const p = (vals.length - 1) * u;
  const i = Math.min(vals.length - 2, Math.max(0, Math.floor(p)));
  const t = p - i;
  const p0 = vals[Math.max(0, i - 1)]!, p1 = vals[i]!, p2 = vals[i + 1]!, p3 = vals[Math.min(vals.length - 1, i + 2)]!;
  const v0 = (p2 - p0) * 0.5, v1 = (p3 - p1) * 0.5;
  return (2 * p1 - 2 * p2 + v0 + v1) * t * t * t + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t * t + v0 * t + p1;
}

function mixW(a: Weights, b: Weights, f: number): Weights {
  const w: Weights = {};
  for (const [k, x] of Object.entries(a)) w[k] = (w[k] ?? 0) + x * (1 - f);
  for (const [k, x] of Object.entries(b)) w[k] = (w[k] ?? 0) + x * f;
  return w;
}

/**
 * A smooth sleeve through key rings: superellipse cross-sections (half-sizes a along `ref`, b
 * across it), centres on a Catmull-Rom curve, skin weights blended between keys so joints bend.
 */
function tube(M: Mesher, rings: Ring[], o: { ref: V3; col: THREE.Color; seg?: number; sub?: number; p?: number; caps?: boolean; vLen?: number }) {
  const seg = o.seg ?? 20, sub = o.sub ?? 3, pw = 2 / (o.p ?? 2);
  const K = rings.length, nR = (K - 1) * sub + 1;
  const curve = new THREE.CatmullRomCurve3(rings.map((r) => new THREE.Vector3(...r.c)), false, 'catmullrom', 0.5);
  const ref = new THREE.Vector3(...o.ref);
  const grid: THREE.Vector3[][] = [], W: Weights[] = [], C: THREE.Vector3[] = [], T: THREE.Vector3[] = [];
  for (let r = 0; r < nR; r++) {
    const u = r / (nR - 1);
    const c = curve.getPoint(u), t = curve.getTangent(u).normalize();
    const U = ref.clone().addScaledVector(t, -ref.dot(t)).normalize();
    const V = new THREE.Vector3().crossVectors(t, U);
    const a = catmull(rings.map((x) => x.a), u), b = catmull(rings.map((x) => x.b), u);
    const kp = (K - 1) * u, k = Math.min(K - 2, Math.floor(kp));
    W.push(mixW(rings[k]!.w, rings[k + 1]!.w, kp - k));
    const row: THREE.Vector3[] = [];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      row.push(c.clone().addScaledVector(U, a * Math.sign(cs) * Math.abs(cs) ** pw).addScaledVector(V, b * Math.sign(sn) * Math.abs(sn) ** pw));
    }
    grid.push(row); C.push(c); T.push(t);
  }
  // Normals from the grid (wrapping around, clamped along), pointing away from the axis.
  const base = M.count;
  let s = 0;
  const du = new THREE.Vector3(), dv = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let r = 0; r < nR; r++) {
    if (r) s += C[r]!.distanceTo(C[r - 1]!);
    for (let j = 0; j <= seg; j++) {
      const jj = j % seg, jm = (jj - 1 + seg) % seg, jp = (jj + 1) % seg;
      du.subVectors(grid[r]![jp]!, grid[r]![jm]!);
      dv.subVectors(grid[Math.min(nR - 1, r + 1)]![jj]!, grid[Math.max(0, r - 1)]![jj]!);
      nn.crossVectors(du, dv).normalize();
      if (nn.dot(_v.subVectors(grid[r]![j]!, C[r]!)) < 0) nn.negate();
      M.vert(grid[r]![j]!, nn, j / seg, s / (o.vLen ?? 0.2), o.col, W[r]!);
    }
  }
  // Winding: pick the order whose face normal agrees with the vertex normal.
  const fn = new THREE.Vector3().crossVectors(_v.subVectors(grid[1]![0]!, grid[0]![0]!), du.subVectors(grid[0]![1]!, grid[0]![0]!));
  const outward = _n.subVectors(grid[0]![0]!, C[0]!);
  const ccw = fn.dot(outward) > 0;
  for (let r = 0; r < nR - 1; r++) for (let j = 0; j < seg; j++) {
    const a = base + r * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    if (ccw) M.ix.push(a, c, b, b, c, d); else M.ix.push(a, b, c, b, d, c);
  }
  if (o.caps !== false) for (const [r, sign] of [[0, -1], [nR - 1, 1]] as const) {
    const ci = M.count;
    M.vert(C[r]!, T[r]!.clone().multiplyScalar(sign), 0.5, 0.5, o.col, W[r]!);
    for (let j = 0; j < seg; j++) {
      const a = base + r * (seg + 1) + j, b = a + 1;
      const fa = new THREE.Vector3().crossVectors(_v.subVectors(grid[r]![j]!, C[r]!), _n.subVectors(grid[r]![j + 1]!, C[r]!));
      if (fa.dot(T[r]!) * sign > 0) M.ix.push(ci, a, b); else M.ix.push(ci, b, a);
    }
  }
}

/** Weld a primitive's shared corners (they come unindexed) so it costs a third of the vertices. */
function welded(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  g.dispose();
  return m;
}
const box = (w: number, h: number, d: number, round = 0.3, seg = 1) => welded(new RoundedBoxGeometry(w, h, d, seg, Math.min(w, h, d) * round));
/** A unit sphere, optionally a patch of it (scale it with the matrix to get an ellipsoid). */
const ball = (ws = 22, hs = 14, phiStart = 0, phiLen = Math.PI * 2, thStart = 0, thLen = Math.PI) => new THREE.SphereGeometry(1, ws, hs, phiStart, phiLen, thStart, thLen);
const cyl = (r0: number, r1: number, h: number, s = 16, open = false) => new THREE.CylinderGeometry(r0, r1, h, s, 1, open);
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const at = (p: V3, rot: V3 = [0, 0, 0], sc: V3 = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), _q.setFromEuler(_e.set(...rot)), new THREE.Vector3(...sc));
/** Matrix that turns a y-axis primitive to run from a to b. */
function along(a: V3, b: V3, sc: V3 = [1, 1, 1]) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(...sc));
}
/**
 * Phi range of a sphere patch centred on the front (-z). three's sphere puts phi = 0 on -x and
 * runs toward +z first, so the front is at phi = 3π/2.
 */
const front = (half: number): [number, number] => [Math.PI * 1.5 - half, half * 2];
/** Theta range (from the top) of an ellipsoid of radius ry centred at cy covering y0..y1. */
const band = (cy: number, ry: number, y0: number, y1: number): [number, number] => {
  const t0 = Math.acos(THREE.MathUtils.clamp((y1 - cy) / ry, -1, 1)), t1 = Math.acos(THREE.MathUtils.clamp((y0 - cy) / ry, -1, 1));
  return [t0, t1 - t0];
};

// ------------------------------------------------------------------------------------ build

/** Torso cross-sections by height: centre z, half-width, half-depth, and which spine bones carry it. */
const TORSO: [number, number, number, number, Weights][] = [
  [0.84, 0.006, 0.152, 0.106, { Hips: 1 }],
  [0.92, 0.012, 0.173, 0.119, { Hips: 1 }],
  [1.0, 0.014, 0.177, 0.121, { Hips: 1 }],
  [1.08, 0.012, 0.166, 0.116, { Hips: 0.6, Spine: 0.4 }],
  [1.16, 0.012, 0.155, 0.11, { Spine: 0.8, Hips: 0.2 }],
  [1.24, 0.02, 0.162, 0.115, { Spine1: 0.6, Spine: 0.4 }],
  [1.32, 0.028, 0.177, 0.124, { Spine1: 0.4, Spine2: 0.6 }],
  [1.4, 0.036, 0.19, 0.128, { Spine2: 1 }],
  [1.465, 0.044, 0.192, 0.118, { Spine2: 1 }],
  [1.515, 0.052, 0.17, 0.098, { Spine2: 0.75, Neck: 0.25 }],
  [1.552, 0.056, 0.092, 0.07, { Spine2: 0.4, Neck: 0.6 }],
];

function torsoAt(y: number) {
  const T = TORSO;
  if (y <= T[0]![0]) return { zc: T[0]![1], hw: T[0]![2], hd: T[0]![3], w: T[0]![4] };
  for (let i = 0; i < T.length - 1; i++) {
    const a = T[i]!, b = T[i + 1]!;
    if (y <= b[0]) {
      const f = (y - a[0]) / (b[0] - a[0]);
      return { zc: a[1] + (b[1] - a[1]) * f, hw: a[2] + (b[2] - a[2]) * f, hd: a[3] + (b[3] - a[3]) * f, w: mixW(a[4], b[4], f) };
    }
  }
  const z = T[T.length - 1]!;
  return { zc: z[1], hw: z[2], hd: z[3], w: z[4] };
}
const torsoW = (p: THREE.Vector3) => torsoAt(p.y).w;
/** Front surface of the torso (z) at height y; the figure faces -z. */
const frontZ = (y: number) => { const t = torsoAt(y); return t.zc - t.hd; };
const backZ = (y: number) => { const t = torsoAt(y); return t.zc + t.hd; };

let boneOrder: string[] = [];
/** The skeleton's bone order (names without the mixamorig prefix); set once from the template. */
export function setBoneOrder(bones: THREE.Bone[]) { boneOrder = bones.map((b) => b.name.replace(/^mixamorig/, '')); }

/** Height (on a unit sphere) where the helmet ends at azimuth `az` (0 = front): at the brow in front, high over the ears, low at the back. */
const helmetCut = (az: number) => {
  const side = Math.abs(Math.sin(az)), back = Math.max(0, -Math.cos(az));
  return 0.1 + 0.25 * side ** 2.2 * (1 - back * 0.7) - 0.46 * back ** 1.6;
};
/** Unit point on the helmet sphere at azimuth `az` and polar angle `th`. */
const helmetPt = (az: number, th: number) => new THREE.Vector3(Math.sin(th) * Math.sin(az), Math.cos(th), -Math.sin(th) * Math.cos(az));

/** A modern high-cut ballistic helmet shell (unit size, scale it with the matrix), built as a grid so the cut edge is clean. */
function helmetShell(): THREE.BufferGeometry {
  const nu = 48, nv = 14, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const az = (i / nu) * Math.PI * 2;
    const p = helmetPt(az, (j / nv) * Math.acos(helmetCut(az)));
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A pad lying on the torso, for plates, cummerbunds and chest rigs: angles th0..th1 round the body
 * (π/2 is the front centre, 3π/2 the back), heights y0..y1, `lift` off the shirt and `thick` thick,
 * with rounded edges. Returned in bind space; skin it with the torso weights.
 */
function torsoPad(th0: number, th1: number, y0: number, y1: number, thick: number, lift = 0.008, nu = 18, nv = 8, p = 2.5): THREE.BufferGeometry {
  const pw = 2 / p;
  const soft = (s: number) => { const d = Math.min(s, 1 - s) / 0.16; return d >= 1 ? 1 : 0.45 + 0.55 * Math.sqrt(1 - (1 - d) ** 2); };
  const pt = (th: number, y: number, off: number) => {
    const t = torsoAt(y), cs = Math.cos(th), sn = Math.sin(th);
    return [(t.hw + off) * Math.sign(cs) * Math.abs(cs) ** pw, y, t.zc - (t.hd + off) * Math.sign(sn) * Math.abs(sn) ** pw];
  };
  // Each row is a closed loop: the outer face from th0 to th1, then the inner face back.
  const L = 2 * (nu + 1), pos: number[] = [], idx: number[] = [];
  for (let r = 0; r <= nv; r++) {
    const v = r / nv, y = y0 + (y1 - y0) * v;
    for (let i = 0; i <= nu; i++) { const u = i / nu; pos.push(...pt(th0 + (th1 - th0) * u, y, lift + thick * soft(u) * soft(v))); }
    for (let i = nu; i >= 0; i--) pos.push(...pt(th0 + (th1 - th0) * (i / nu), y, lift - 0.006));
  }
  for (let r = 0; r < nv; r++) for (let k = 0; k < L; k++) {
    const k1 = (k + 1) % L, a = r * L + k, b = r * L + k1, c = a + L, d = b + L;
    idx.push(a, b, c, b, d, c);
  }
  for (const [r, top] of [[0, false], [nv, true]] as const) for (let i = 0; i < nu; i++) {
    const o0 = r * L + i, o1 = o0 + 1, n0 = r * L + (L - 1 - i), n1 = n0 - 1;
    if (top) idx.push(o0, o1, n0, n0, o1, n1); else idx.push(o0, n0, o1, o1, n0, n1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A strap over the shoulder from the front of a vest to the back. */
function shoulderStrap(M: Mesher, s: number, x: number, w: number, t: number, col: THREE.Color, lift = 0.012) {
  const yF = 1.43, yB = 1.43;
  const pts: V3[] = [
    [s * x, yF, frontZ(yF) - lift],
    [s * x, 1.5, frontZ(1.5) - lift * 0.8],
    [s * x, 1.548, 0.048],
    [s * x, 1.5, backZ(1.5) + lift * 0.8],
    [s * x, yB, backZ(yB) + lift],
  ];
  tube(M, pts.map((c, i): Ring => ({ c, a: w, b: t, w: i === 2 ? { Spine2: 0.8, Neck: 0.2 } : { Spine2: 1 } })), { ref: [1, 0, 0], col, p: 6, sub: 4, seg: 12 });
}

/** Side profile of a boot (forward u, up v), heel at u < 0, as a smooth closed outline. */
function bootShape(): THREE.Shape {
  const pts: [number, number][] = [[-0.058, 0.016], [0.05, 0.016], [0.17, 0.016], [0.194, 0.026], [0.196, 0.042], [0.176, 0.058], [0.125, 0.07], [0.068, 0.094], [0.03, 0.126], [-0.024, 0.138], [-0.057, 0.126], [-0.07, 0.084], [-0.07, 0.04]];
  const sh = new THREE.Shape();
  sh.splineThru(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  sh.closePath();
  return sh;
}
/** Footprint of the sole (forward u, across w). */
function soleShape(): THREE.Shape {
  const pts: [number, number][] = [[-0.074, 0], [-0.066, 0.036], [-0.034, 0.044], [0.05, 0.042], [0.128, 0.05], [0.18, 0.04], [0.204, 0.017], [0.205, -0.006], [0.19, -0.034], [0.138, -0.048], [0.05, -0.042], [-0.034, -0.042], [-0.066, -0.034]];
  const sh = new THREE.Shape();
  sh.splineThru(pts.map(([u, w]) => new THREE.Vector2(u, w)));
  sh.closePath();
  return sh;
}

function build(bind: Bind, side: Side, L: Look): Record<Slot, THREE.BufferGeometry> {
  const bi = (n: string) => Math.max(0, boneOrder.indexOf(n));
  const has = (n: string) => boneOrder.includes(n);
  const M: Record<Slot, Mesher> = { kit: new Mesher(bi), gear: new Mesher(bi), lens: new Mesher(bi), accent: new Mesher(bi) };
  const C = (hex: string) => new THREE.Color(hex);
  const white = C('#ffffff');
  const J = (n: string) => bind.at(n);
  const ct = side === 'CT';
  const col = {
    shirt: white, pants: C(L.pants), boots: C(L.boots), sole: C(L.sole), gloves: C(L.gloves), skin: C(L.skin), head: C(L.headColor),
    hat: C(L.hatColor ?? '#222'), carrier: C(L.carrier ?? '#222'), pouch: C(L.pouch ?? '#222'), rig: C(L.rig ?? '#333'),
    strap: C('#1b1c1e'), metal: C('#2a2c2f'), black: C('#0e0f10'), dark: C('#151618'), eye: C('#2a1d14'), gaiter: C(L.gaiter ?? '#222'),
  };
  const loose = L.jacket || L.hood ? 0.008 : 0;

  // ---------------------------------------------------------------- torso and neck
  // Trousers: the pelvis up to the belt.
  tube(M.gear, TORSO.slice(0, 5).map(([y, zc, hw, hd, w]) => ({ c: [0, y, zc] as V3, a: hw, b: hd, w })), { ref: [1, 0, 0], col: col.pants, p: 2.4, sub: 2, seg: 26, caps: true });
  // Shirt or jacket from the waist (or the hips, for a jacket) to the neck.
  const top = TORSO.filter(([y]) => y >= (L.jacket || L.hood ? 0.92 : 1.0));
  tube(M.kit, top.map(([y, zc, hw, hd, w], i) => {
    const k = i < top.length - 2 ? loose + 0.004 + (loose && y < 1.05 ? 0.014 * (1.05 - y) / 0.13 : 0) : 0.002;
    return { c: [0, y, zc] as V3, a: hw + k, b: hd + k, w: loose && y < 1.0 ? { Hips: 1 } : w };
  }), { ref: [1, 0, 0], col: col.shirt, p: 2.5, sub: 3, seg: 30, caps: true });
  const neckCol = L.gaiter ? col.gaiter : L.head === 'bare' ? col.skin : col.head;
  tube(M.gear, [
    { c: [0, 1.5, 0.05], a: 0.066, b: 0.064, w: { Spine2: 0.6, Neck: 0.4 } },
    { c: [0, 1.56, 0.052], a: L.gaiter ? 0.068 : 0.06, b: L.gaiter ? 0.068 : 0.061, w: { Neck: 1 } },
    { c: [0, 1.615, 0.042], a: L.gaiter ? 0.07 : 0.06, b: L.gaiter ? 0.072 : 0.062, w: { Neck: 0.3, Head: 0.7 } },
  ], { ref: [1, 0, 0], col: neckCol, sub: 2, seg: 20 });

  // ---------------------------------------------------------------- arms and gloves
  for (const s of [1, -1]) {
    const S = s > 0 ? 'Right' : 'Left';
    const sh = J(`${S}Arm`), el = J(`${S}ForeArm`), wr = J(`${S}Hand`);
    const y = sh.y, z = sh.z;
    const X = (x: number): V3 => [x, y, z];
    const lx = (k: number) => sh.x + (el.x - sh.x) * k, fx = (k: number) => el.x + (wr.x - el.x) * k;
    const A = `${S}Arm`, F = `${S}ForeArm`, H = `${S}Hand`, SH = `${S}Shoulder`;
    tube(M.kit, [
      { c: X(s * 0.14), a: 0.066, b: 0.074, w: { [SH]: 0.75, [A]: 0.25 } },
      { c: X(sh.x), a: 0.064 + loose, b: 0.078 + loose, w: { [A]: 0.6, [SH]: 0.4 } },
      { c: X(lx(0.22)), a: 0.066 + loose, b: 0.074 + loose, w: { [A]: 0.9, [SH]: 0.1 } },
      { c: X(lx(0.5)), a: 0.062 + loose, b: 0.064 + loose, w: { [A]: 1 } },
      { c: X(lx(0.8)), a: 0.056 + loose, b: 0.057 + loose, w: { [A]: 0.85, [F]: 0.15 } },
      { c: X(el.x), a: 0.053 + loose, b: 0.054 + loose, w: { [A]: 0.5, [F]: 0.5 } },
      { c: X(fx(0.18)), a: 0.054 + loose, b: 0.056 + loose, w: { [F]: 0.85, [A]: 0.15 } },
      { c: X(fx(0.5)), a: 0.049 + loose, b: 0.051 + loose, w: { [F]: 1 } },
      { c: X(fx(0.85)), a: 0.041 + loose, b: 0.043 + loose, w: { [F]: 1 } },
      { c: X(wr.x), a: 0.037 + loose, b: 0.039 + loose, w: { [F]: 0.6, [H]: 0.4 } },
    ], { ref: [0, 1, 0], col: col.shirt, sub: 3, seg: 20 });
    // Cuff ridge where the sleeve meets the glove.
    M.kit.add(cyl(0.045 + loose, 0.045 + loose, 0.026, 18), along(X(wr.x - s * 0.05), X(wr.x - s * 0.024)), white, { [F]: 1 });

    // Glove: palm, a cuff, and fingers skinned to the finger bones so they curl with the animation.
    const g = L.gloves === L.skin ? col.skin : col.gloves;
    const i1 = J(`${S}HandIndex1`), p1 = J(`${S}HandPinky1`), m1 = J(`${S}HandMiddle1`);
    const pz = (i1.z + p1.z) / 2, plen = Math.abs(m1.x - wr.x);
    M.gear.add(box(plen + 0.012, 0.042, Math.abs(p1.z - i1.z) + 0.034, 0.42, 2), at([wr.x + s * (plen / 2), y - 0.004, pz]), g, { [H]: 1 });
    if (L.gloves !== L.skin) {
      M.gear.add(cyl(0.041, 0.045, 0.06, 18), along(X(wr.x - s * 0.02), X(wr.x + s * 0.035)), g, { [H]: 0.75, [F]: 0.25 });
      M.gear.add(box(0.03, 0.009, Math.abs(p1.z - i1.z) + 0.004, 0.45), at([m1.x - s * 0.014, y + 0.02, pz]), g.clone().multiplyScalar(0.6), { [H]: 1 });
    }
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
      const js = [1, 2, 3].map((k) => `${S}Hand${f}${k}`).filter(has);
      if (!js.length) continue;
      const pts = js.map((n) => J(n));
      const last = pts[pts.length - 1]!, prev = pts[pts.length - 2] ?? wr;
      const seg = last.clone().sub(prev);
      const tip = last.clone().addScaledVector(seg, f === 'Thumb' ? 0.9 : 0.85);
      const r = f === 'Pinky' ? 0.0102 : f === 'Thumb' ? 0.0128 : 0.0114;
      const rings: Ring[] = [];
      pts.forEach((p, k) => {
        const b = js[k]!, nb = js[k + 1];
        rings.push({ c: p.toArray() as V3, a: r, b: r * 1.05, w: k === 0 ? { [b]: 0.7, [H]: 0.3 } : { [b]: 0.6, [js[k - 1]!]: 0.4 } });
        const q = nb ? J(nb) : tip;
        rings.push({ c: p.clone().lerp(q, 0.5).toArray() as V3, a: r * 0.97, b: r * 1.02, w: { [b]: 1 } });
      });
      rings.push({ c: tip.toArray() as V3, a: r * 0.85, b: r * 0.9, w: { [js[js.length - 1]!]: 1 } });
      tube(M.gear, rings, { ref: [0, 1, 0], col: g, sub: 1, seg: 10 });
      M.gear.add(ball(10, 8), at(tip.toArray() as V3, [0, 0, 0], [r * 0.86, r * 0.86, r * 0.9]), g, { [js[js.length - 1]!]: 1 });
    }

    // Flag patch on the outside of the upper arm, in team colour.
    M.accent.add(box(0.058, 0.006, 0.044, 0.3), at([lx(0.3), y + 0.067 + loose, z]), white, { [A]: 1 });
    if (ct) M.gear.add(box(0.074, 0.006, 0.056, 0.3), at([lx(0.3), y + 0.065, z]), col.pouch, { [A]: 1 });
    // Elbow pads (CT): a shell over the back of the elbow with a strap round the forearm.
    if (L.kneePads) {
      M.gear.add(ball(16, 10, Math.PI * 0.5 - 1.15, 2.3), at([el.x, y + 0.004, z + 0.012], [0, 0, 0], [0.05, 0.05, 0.05]), col.carrier, { [A]: 0.5, [F]: 0.5 });
      M.gear.add(cyl(0.057, 0.057, 0.016, 16, true), along(X(fx(0.16)), X(fx(0.2))), col.strap, { [F]: 1 });
    }
  }

  // ---------------------------------------------------------------- legs and boots
  for (const s of [1, -1]) {
    const S = s > 0 ? 'Right' : 'Left';
    const UL = `${S}UpLeg`, LG = `${S}Leg`, FT = `${S}Foot`, TO = `${S}ToeBase`;
    const hip = J(UL), kn = J(LG), an = J(FT);
    const P = (a: THREE.Vector3, b: THREE.Vector3, k: number, dz = 0): V3 => [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k + dz];
    const cargo = ct || L.hood ? 0.007 : 0;
    tube(M.gear, [
      { c: [hip.x * 0.8, hip.y + 0.045, hip.z], a: 0.09, b: 0.104, w: { Hips: 0.65, [UL]: 0.35 } },
      { c: P(hip, kn, 0.06), a: 0.097 + cargo, b: 0.104 + cargo, w: { [UL]: 0.85, Hips: 0.15 } },
      { c: P(hip, kn, 0.3), a: 0.09 + cargo, b: 0.094 + cargo, w: { [UL]: 1 } },
      { c: P(hip, kn, 0.62), a: 0.078 + cargo, b: 0.081 + cargo, w: { [UL]: 1 } },
      { c: P(hip, kn, 0.86), a: 0.069 + cargo, b: 0.071 + cargo, w: { [UL]: 0.8, [LG]: 0.2 } },
      { c: P(hip, kn, 1), a: 0.066 + cargo, b: 0.068 + cargo, w: { [UL]: 0.5, [LG]: 0.5 } },
      { c: P(kn, an, 0.1), a: 0.064 + cargo, b: 0.067 + cargo, w: { [LG]: 0.8, [UL]: 0.2 } },
      { c: P(kn, an, 0.34, 0.008), a: 0.063 + cargo, b: 0.069 + cargo, w: { [LG]: 1 } },
      { c: P(kn, an, 0.64), a: 0.056 + cargo, b: 0.059 + cargo, w: { [LG]: 1 } },
      { c: P(kn, an, 0.88), a: 0.053 + cargo, b: 0.056 + cargo, w: { [LG]: 1 } },
    ], { ref: [1, 0, 0], col: col.pants, sub: 3, seg: 22 });

    // Boot: shaft round the ankle with the shin, an upper and a sole that bend at the ball of the foot.
    const toe = J(TO);
    const dir = new THREE.Vector3(toe.x - an.x, 0, toe.z - an.z).normalize();
    const up = new THREE.Vector3(0, 1, 0), lat = new THREE.Vector3().crossVectors(dir, up);
    const ground = new THREE.Vector3(an.x, 0, an.z);
    const ballK = new THREE.Vector3(toe.x, 0, toe.z).sub(ground).dot(dir);
    const footW = (p: THREE.Vector3): Weights => {
      const k = (p.x - ground.x) * dir.x + (p.z - ground.z) * dir.z;
      const f = THREE.MathUtils.smoothstep(k, ballK - 0.035, ballK + 0.02);
      return { [FT]: 1 - f, [TO]: f };
    };
    tube(M.gear, [
      { c: P(kn, an, 0.72), a: 0.06 + cargo, b: 0.064 + cargo, w: { [LG]: 1 } },
      { c: P(kn, an, 0.88), a: 0.059 + cargo, b: 0.063 + cargo, w: { [LG]: 1 } },
      { c: [an.x, an.y - 0.016, an.z + 0.006], a: 0.051, b: 0.06, w: { [LG]: 0.45, [FT]: 0.55 } },
      { c: [an.x, an.y - 0.046, an.z + 0.01], a: 0.049, b: 0.062, w: { [FT]: 1 } },
    ], { ref: [1, 0, 0], col: col.boots, sub: 2, seg: 20 });
    const upper = welded(new THREE.ExtrudeGeometry(bootShape(), { depth: 0.066, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.011, bevelSegments: 2, curveSegments: 3, steps: 1 }));
    upper.translate(0, 0, -0.033);
    M.gear.add(upper, new THREE.Matrix4().makeBasis(dir, up, lat).setPosition(ground), col.boots, footW);
    const sole = welded(new THREE.ExtrudeGeometry(soleShape(), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1, curveSegments: 3, steps: 1 }));
    M.gear.add(sole, new THREE.Matrix4().makeBasis(dir, lat, up.clone().negate()).setPosition(ground.clone().setY(0.019)), col.sole, footW);
    // Laces panel.
    M.gear.add(box(0.044, 0.01, 0.085, 0.4), new THREE.Matrix4().makeBasis(lat, up, dir.clone().negate()).multiply(at([0, 0, 0], [-0.55, 0, 0])).setPosition(ground.clone().addScaledVector(dir, 0.06).setY(0.1)), col.boots.clone().multiplyScalar(0.62), footW);

    // Knee pads (CT), cargo pockets and a thigh holster.
    if (L.kneePads) {
      const kp = P(hip, kn, 1);
      const [ps, pl] = front(1.0);
      M.gear.add(ball(18, 12, ps, pl), at([kp[0], kp[1] - 0.02, kp[2] - 0.044], [0, 0, 0], [0.058, 0.074, 0.034]), col.carrier, { [LG]: 1 });
      M.gear.add(cyl(0.079, 0.079, 0.022, 20, true), along(P(kn, an, 0.13), P(kn, an, 0.18)), col.strap, { [LG]: 1 });
    }
    if (ct || L.hood) {
      const cp = P(hip, kn, 0.55);
      M.gear.add(box(0.034, 0.14, 0.13, 0.32), at([cp[0] + s * 0.083, cp[1], cp[2] - 0.004], [0, 0, s * 0.03]), col.pants.clone().multiplyScalar(0.93), { [UL]: 1 });
      M.gear.add(box(0.038, 0.032, 0.134, 0.32), at([cp[0] + s * 0.085, cp[1] + 0.066, cp[2] - 0.004]), col.pants.clone().multiplyScalar(0.84), { [UL]: 1 });
    }
    if (L.holster && s > 0) {
      const hp = P(hip, kn, 0.32);
      M.gear.add(box(0.052, 0.19, 0.1, 0.3), at([hp[0] + 0.105, hp[1], hp[2] + 0.005], [0, 0, 0.06]), col.carrier, { [UL]: 1 });
      M.gear.add(box(0.03, 0.085, 0.036, 0.35), at([hp[0] + 0.105, hp[1] + 0.12, hp[2] + 0.03], [0.35, 0, 0.06]), col.black, { [UL]: 1 });
      for (const [k, r] of [[0.36, 0.107], [0.6, 0.097]] as const) M.gear.add(cyl(r, r, 0.022, 20, true), along(P(hip, kn, k - 0.025), P(hip, kn, k + 0.025)), col.strap, { [UL]: 1 });
    }
  }

  // ---------------------------------------------------------------- belt
  const ring = (ys: number[], out: number, color: THREE.Color, mesher = M.gear, p = 2.4) => tube(mesher, ys.map((y) => {
    const t = torsoAt(y); return { c: [0, y, t.zc] as V3, a: t.hw + out, b: t.hd + out, w: t.w };
  }), { ref: [1, 0, 0], col: color, p, sub: 1, seg: 30, caps: false });
  if (L.jacket || L.hood) ring([0.915, 0.928, 0.945], loose + 0.026, col.shirt.clone().multiplyScalar(0.85), M.kit, 2.5);
  else {
    ring([1.035, 1.062, 1.09], 0.017, ct ? col.carrier : col.strap);
    M.gear.add(box(0.05, 0.045, 0.012, 0.3), at([0, 1.062, frontZ(1.062) - 0.022]), col.metal, torsoW);
  }
  if (ct) {
    for (const s of [1, -1]) M.gear.add(box(0.062, 0.09, 0.046, 0.3), at([s * 0.155, 1.04, torsoAt(1.04).zc - 0.07], [0, s * -0.5, 0]), col.pouch, torsoW);
    M.gear.add(box(0.14, 0.1, 0.05, 0.35), at([0, 1.04, backZ(1.04) + 0.032]), col.pouch, torsoW);
  }

  // ---------------------------------------------------------------- vests
  if (ct) {
    const pt = 0.034, lift = 0.01;
    // Plate carrier: front and back plates and a cummerbund that follow the body, padded shoulder straps.
    M.gear.add(torsoPad(Math.PI / 2 - 0.95, Math.PI / 2 + 0.95, 1.13, 1.47, pt, lift), new THREE.Matrix4(), col.carrier, torsoW);
    M.gear.add(torsoPad(Math.PI * 1.5 - 0.95, Math.PI * 1.5 + 0.95, 1.15, 1.49, pt, lift), new THREE.Matrix4(), col.carrier, torsoW);
    for (const c of [0, Math.PI]) M.gear.add(torsoPad(c - 0.68, c + 0.68, 1.15, 1.32, 0.016, 0.008, 12, 5), new THREE.Matrix4(), col.carrier.clone().multiplyScalar(0.9), torsoW);
    for (const s of [1, -1]) shoulderStrap(M.gear, s, 0.1, 0.034, 0.012, col.carrier);
    const fz = frontZ(1.3) - lift - pt;
    // Webbing rows across the plate.
    for (const yy of [1.33, 1.37, 1.41]) M.gear.add(torsoPad(Math.PI / 2 - 0.82, Math.PI / 2 + 0.82, yy, yy + 0.014, 0.004, lift + pt - 0.002, 12, 1), new THREE.Matrix4(), col.carrier.clone().multiplyScalar(0.7), torsoW);
    // Three magazine pouches with the magazines showing, an admin pouch above them.
    const yP = 1.215, zP = frontZ(yP) - lift - pt - 0.022;
    for (const x of [-0.08, 0, 0.08]) {
      M.gear.add(box(0.072, 0.115, 0.046, 0.3), at([x, yP, zP]), col.pouch, torsoW);
      M.gear.add(box(0.056, 0.04, 0.03, 0.25), at([x, yP + 0.07, zP + 0.004], [-0.12, 0, 0]), col.black, torsoW);
      M.gear.add(box(0.074, 0.03, 0.05, 0.3), at([x, yP + 0.045, zP - 0.002]), col.pouch.clone().multiplyScalar(0.9), torsoW);
    }
    M.gear.add(box(0.15, 0.065, 0.022, 0.35), at([0, 1.305, fz - 0.012]), col.pouch, torsoW);
    // Radio on the left with its antenna, a weapon light clipped to the right strap, name tape.
    M.gear.add(box(0.052, 0.12, 0.042, 0.3), at([-0.2, 1.3, torsoAt(1.3).zc + 0.03], [0, 0.25, 0]), col.black, torsoW);
    M.gear.add(cyl(0.004, 0.006, 0.2, 6), along([-0.196, 1.36, torsoAt(1.36).zc + 0.05], [-0.21, 1.56, torsoAt(1.36).zc + 0.11]), col.black, { Spine2: 1 });
    M.gear.add(cyl(0.015, 0.015, 0.055, 12), along([0.1, 1.445, frontZ(1.445) - lift - 0.02], [0.1, 1.44, frontZ(1.445) - lift - 0.075]), col.black, { Spine2: 1 });
    M.accent.add(box(0.1, 0.026, 0.006, 0.3), at([0, 1.44, frontZ(1.44) - lift - pt - 0.004], [0.2, 0, 0]), white, torsoW);
    if (L.pack) M.gear.add(box(0.22, 0.3, 0.07, 0.4), at([0, 1.3, backZ(1.3) + lift + pt + 0.036], [0.06, 0, 0]), C(L.pack), torsoW);
  } else if (L.rig) {
    // Chest rig: a band of rifle-magazine pouches with curved magazines, X straps behind.
    const yR = 1.27, lift = 0.012 + loose;
    M.gear.add(torsoPad(Math.PI / 2 - 1.0, Math.PI / 2 + 1.0, 1.2, 1.35, 0.02, lift), new THREE.Matrix4(), col.rig, torsoW);
    for (const x of [-0.105, -0.035, 0.035, 0.105]) {
      const zR = frontZ(yR) - lift - 0.02 - 0.024 + Math.abs(x) * 0.18;
      M.gear.add(box(0.064, 0.13, 0.044, 0.3), at([x, yR, zR], [0, x * -1.6, 0]), col.rig, torsoW);
      M.gear.add(box(0.068, 0.028, 0.048, 0.3), at([x, yR + 0.058, zR - 0.002], [0, x * -1.6, 0]), col.rig.clone().multiplyScalar(0.85), torsoW);
      M.gear.add(box(0.046, 0.05, 0.028, 0.3), at([x, yR + 0.09, zR + 0.002], [0.3, x * -1.6, 0]), col.metal, torsoW);
    }
    for (const s of [1, -1]) {
      shoulderStrap(M.gear, s, 0.095, 0.022, 0.006, col.rig, lift);
      M.gear.add(box(0.04, 0.4, 0.012, 0.35), at([s * 0.01, 1.3, backZ(1.3) + lift], [0.05, 0, s * 0.45]), col.rig, torsoW);
    }
    M.accent.add(box(0.06, 0.022, 0.006, 0.3), at([0.1, 1.44, frontZ(1.44) - 0.008 - loose], [0.2, 0, 0]), white, torsoW);
  }
  if (L.jacket) {
    tube(M.kit, [1.505, 1.54, 1.575].map((y, i) => ({ c: [0, y, 0.054] as V3, a: 0.084 - i * 0.004, b: 0.082 - i * 0.004, w: i ? { Neck: 0.7, Spine2: 0.3 } : { Spine2: 0.6, Neck: 0.4 } })),
      { ref: [1, 0, 0], col: col.shirt, sub: 1, seg: 22, caps: false });
    M.gear.add(box(0.012, 0.32, 0.008, 0.3), at([0.012, 1.15, frontZ(1.15) - loose - 0.006]), col.metal, torsoW);
  }
  if (L.hood) {
    // A hood lying on the shoulders behind the neck.
    M.kit.add(ball(18, 12), at([0, 1.535, 0.125], [0.35, 0, 0], [0.105, 0.075, 0.055]), white, { Spine2: 0.7, Neck: 0.3 });
    M.kit.add(new THREE.TorusGeometry(0.075, 0.03, 10, 24), at([0, 1.53, 0.07], [Math.PI / 2 - 0.25, 0, 0], [1.15, 1.25, 1]), white, { Spine2: 0.7, Neck: 0.3 });
  }

  // ---------------------------------------------------------------- head
  const hc: V3 = [0, 1.69, 0.03], hr: V3 = [0.084, 0.109, 0.101];
  const headW = { Head: 1 };
  const face = L.head === 'bare' ? col.skin : col.head;
  M.gear.add(ball(28, 20), at(hc, [0, 0, 0], hr), face, headW);
  // Jaw and chin, and a gentle nose under the cloth.
  M.gear.add(ball(20, 14), at([0, 1.612, 0.002], [0.12, 0, 0], [0.064, 0.058, 0.07]), face, headW);
  M.gear.add(ball(10, 8), at([0, 1.655, -0.066], [0.25, 0, 0], [0.01, 0.018, 0.009]), face, headW);
  const eyeY = 1.68;
  if (L.head !== 'bare') {
    // Eye opening: a narrow band of skin, the eyes in shadow.
    const [ts, tl] = band(hc[1], hr[1] * 1.012, eyeY - 0.013, eyeY + 0.012);
    const [ps, pl] = front(0.78);
    M.gear.add(ball(22, 4, ps, pl, ts, tl), at(hc, [0, 0, 0], [hr[0] * 1.012, hr[1] * 1.012, hr[2] * 1.012]), col.skin, headW);
  }
  if (L.eyes === 'slit') for (const s of [1, -1]) M.gear.add(ball(12, 6), at([s * 0.03, eyeY - 0.001, -0.0655], [0, s * 0.35, 0], [0.012, 0.0055, 0.005]), col.eye, headW);
  if (L.head === 'bare') for (const s of [1, -1]) M.gear.add(ball(10, 8), at([s * 0.084, 1.672, 0.04], [0, 0, 0], [0.013, 0.027, 0.02]), col.skin, headW);
  if (L.head === 'shemagh') {
    // Scarf wound round the head and pulled up over the nose: folds at the brow and under the eyes, a knot and a tail behind.
    const sh = col.head, fold = col.head.clone().multiplyScalar(0.82);
    M.gear.add(ball(26, 14, 0, Math.PI * 2, 0, Math.PI * 0.47), at(hc, [0, 0, 0], [hr[0] * 1.12, hr[1] * 1.1, hr[2] * 1.12]), sh, headW);
    M.gear.add(ball(22, 12, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54), at([0, 1.65, 0.012], [0, 0, 0], [0.093, 0.068, 0.1]), sh, headW);
    M.gear.add(new THREE.TorusGeometry(1, 0.07, 6, 40), at([0, 1.708, 0.026], [Math.PI / 2 + 0.1, 0, 0], [0.095, 0.113, 0.09]), fold, headW);
    M.gear.add(new THREE.TorusGeometry(1, 0.07, 6, 40), at([0, 1.663, 0.014], [Math.PI / 2 - 0.08, 0, 0], [0.095, 0.104, 0.09]), fold, headW);
    M.gear.add(box(0.075, 0.14, 0.026, 0.45), at([0.0, 1.6, 0.137], [0.3, 0, 0.06]), fold, { Head: 0.5, Neck: 0.5 });
    M.gear.add(ball(12, 8), at([0.0, 1.69, 0.132], [0, 0, 0], [0.042, 0.032, 0.026]), fold, headW);
  }
  if (L.gaiter) M.gear.add(ball(22, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), at([0, 1.656, 0.014], [0, 0, 0], [0.078, 0.078, 0.092]), col.gaiter, headW);
  if (L.hat === 'beanie') {
    M.gear.add(ball(26, 12, 0, Math.PI * 2, 0, Math.PI * 0.47), at([hc[0], hc[1] + 0.006, hc[2]], [0, 0, 0], [hr[0] * 1.08, hr[1] * 1.07, hr[2] * 1.07]), col.hat, headW);
    M.gear.add(cyl(1, 1, 0.034, 28, true), at([0, 1.708, 0.03], [0, 0, 0], [hr[0] * 1.1, 1, hr[2] * 1.09]), col.hat.clone().multiplyScalar(0.8), headW);
  }
  if (L.hat === 'helmet') {
    // High-cut ballistic helmet: shell with an edge trim, side rails, night-vision mount, velcro top, counterweight.
    const hC = new THREE.Vector3(0, 1.695, 0.03), hS = new THREE.Vector3(0.104, 0.124, 0.12);
    const onShell = (az: number, th: number, out = 0) => helmetPt(az, th).multiply(_hs.copy(hS).addScalar(out)).add(hC);
    M.gear.add(helmetShell(), at(hC.toArray() as V3, [0, 0, 0], hS.toArray() as V3), col.hat, headW);
    const rim = new THREE.CatmullRomCurve3(Array.from({ length: 48 }, (_, i) => { const az = (i / 48) * Math.PI * 2; return onShell(az, Math.acos(helmetCut(az)), -0.002); }), true);
    M.gear.add(new THREE.TubeGeometry(rim, 96, 0.0055, 6, true), new THREE.Matrix4(), col.hat.clone().multiplyScalar(0.7), headW);
    for (const s of [1, -1]) {
      const p = onShell(s * Math.PI / 2, 0.95, 0.004);
      M.gear.add(box(0.008, 0.02, 0.11, 0.4), at(p.toArray() as V3, [0, 0, s * 0.62]), col.metal, headW);
    }
    const nvg = onShell(0, 0.95, 0.006);
    M.gear.add(box(0.05, 0.034, 0.016, 0.35), at(nvg.toArray() as V3, [0.62, 0, 0]), col.metal, headW);
    M.gear.add(box(0.07, 0.01, 0.095, 0.4), at(onShell(0, 0, 0.002).toArray() as V3), col.hat.clone().multiplyScalar(1.12), headW);
    const cw = onShell(Math.PI, 1.55, 0.012);
    M.gear.add(box(0.07, 0.04, 0.026, 0.35), at(cw.toArray() as V3, [0.2, 0, 0]), col.pouch, headW);
    M.accent.add(box(0.04, 0.016, 0.005, 0.3), at(onShell(Math.PI, 0.9, 0.003).toArray() as V3, [-0.67, 0, 0]), white, headW);
  }
  if (L.headset) {
    for (const s of [1, -1]) {
      M.gear.add(cyl(0.04, 0.04, 0.034, 20), at([s * 0.093, 1.672, 0.036], [0, 0, Math.PI / 2]), col.black, headW);
      M.gear.add(cyl(0.029, 0.029, 0.01, 16), at([s * 0.112, 1.672, 0.036], [0, 0, Math.PI / 2]), col.dark, headW);
    }
    M.gear.add(cyl(0.0035, 0.0035, 0.1, 6), along([0.094, 1.64, 0.0], [0.04, 1.612, -0.075]), col.black, headW);
  }
  if (L.eyes === 'goggles') {
    const [ps, pl] = front(1.0), [ts, tl] = band(hc[1], hr[1] * 1.1, eyeY - 0.025, eyeY + 0.024);
    M.gear.add(ball(26, 6, ps, pl, ts, tl), at(hc, [0, 0, 0], [hr[0] * 1.14, hr[1] * 1.1, hr[2] * 1.15]), col.black, headW);
    const [ps2, pl2] = front(0.8), [ts2, tl2] = band(hc[1], hr[1] * 1.12, eyeY - 0.02, eyeY + 0.019);
    M.lens.add(ball(24, 6, ps2, pl2, ts2, tl2), at(hc, [0, 0, 0], [hr[0] * 1.17, hr[1] * 1.12, hr[2] * 1.18]), white, headW);
    M.gear.add(cyl(1, 1, 0.022, 32, true), at([0, eyeY + 0.006, hc[2]], [0, 0, 0], [hr[0] * 1.12, 1, hr[2] * 1.12]), col.strap, headW);
  }
  if (L.eyes === 'glasses' || L.eyes === 'sunglasses') {
    const [ps, pl] = front(0.95), [ts, tl] = band(hc[1], hr[1] * 1.06, eyeY - 0.018, eyeY + 0.016);
    M.lens.add(ball(24, 5, ps, pl, ts, tl), at(hc, [0, 0, 0], [hr[0] * 1.09, hr[1] * 1.06, hr[2] * 1.11]), white, headW);
    const [ts2, tl2] = band(hc[1], hr[1] * 1.06, eyeY + 0.014, eyeY + 0.02);
    M.gear.add(ball(24, 2, ps, pl, ts2, tl2), at(hc, [0, 0, 0], [hr[0] * 1.1, hr[1] * 1.06, hr[2] * 1.12]), col.black, headW);
    for (const s of [1, -1]) M.gear.add(box(0.004, 0.008, 0.1, 0.4), at([s * 0.09, eyeY + 0.008, 0.02]), col.black, headW);
  }
  if (L.eyes === 'gasmask') {
    // Full-face respirator: rubber face piece, two round lenses, a side filter and a voicemitter.
    const [ps, pl] = front(1.25);
    M.gear.add(ball(26, 16, ps, pl, 0.35, 2.35), at([0, 1.636, 0.004], [0.08, 0, 0], [0.087, 0.1, 0.09]), col.black, headW);
    for (const s of [1, -1]) {
      M.lens.add(cyl(0.024, 0.024, 0.012, 22), at([s * 0.034, eyeY - 0.004, -0.085], [Math.PI / 2 - 0.12, 0, 0]), white, headW);
      M.gear.add(new THREE.TorusGeometry(0.025, 0.0055, 6, 22), at([s * 0.034, eyeY - 0.004, -0.09], [-0.12, 0, 0]), col.dark, headW);
    }
    M.gear.add(cyl(0.036, 0.036, 0.055, 22), along([-0.04, 1.59, -0.067], [-0.075, 1.565, -0.112]), col.metal, headW);
    M.gear.add(cyl(0.022, 0.024, 0.03, 16), along([0.008, 1.585, -0.08], [0.008, 1.577, -0.107]), col.dark, headW);
  }

  const out = {} as Record<Slot, THREE.BufferGeometry>;
  for (const k of Object.keys(M) as Slot[]) out[k] = M[k].build();
  return out;
}

// ------------------------------------------------------------------------------------ materials

let fabricTex: THREE.DataTexture | null = null;
/** A tiling twill weave as a normal map, so kit reads as cloth up close. */
function fabric(): THREE.DataTexture {
  if (fabricTex) return fabricTex;
  const N = 128, h = new Float32Array(N * N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = Float32Array.from({ length: N * N }, rnd);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const tw = Math.sin(((x + y) / N) * Math.PI * 2 * 24) * 0.5 + 0.5;
    const wf = Math.sin((x / N) * Math.PI * 2 * 48) * Math.sin((y / N) * Math.PI * 2 * 48);
    h[y * N + x] = tw * 0.55 + wf * 0.2 + noise[y * N + x]! * 0.25;
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const H = (i: number, j: number) => h[((j + N) % N) * N + ((i + N) % N)]!;
    const dx = (H(x + 1, y) - H(x - 1, y)) * 1.2, dy = (H(x, y + 1) - H(x, y - 1)) * 1.2;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * N + x) * 4;
    data[o] = ((-dx / l) * 0.5 + 0.5) * 255; data[o + 1] = ((-dy / l) * 0.5 + 0.5) * 255; data[o + 2] = (1 / l) * 0.5 * 255 + 127.5; data[o + 3] = 255;
  }
  fabricTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  fabricTex.wrapS = fabricTex.wrapT = THREE.RepeatWrapping;
  fabricTex.repeat.set(5, 5);
  fabricTex.generateMipmaps = true;
  fabricTex.minFilter = THREE.LinearMipmapLinearFilter;
  fabricTex.needsUpdate = true;
  return fabricTex;
}

const geoCache = new Map<string, Record<Slot, THREE.BufferGeometry>>();

export interface Dressed {
  meshes: THREE.SkinnedMesh[];
  /** Shirt or jacket: takes the team kit colour. */
  kit: THREE.MeshStandardMaterial;
  /** Patches and name tape: take the team colour. */
  accent: THREE.MeshStandardMaterial;
}

/**
 * Dress one figure: add the look's skinned meshes to `parent`, bound to the figure's skeleton.
 * `rim` adds the team rim light to the cloth materials.
 */
export function dress(parent: THREE.Object3D, skeleton: THREE.Skeleton, bind: Bind, side: Side, look: number, rim: (m: THREE.MeshStandardMaterial) => void): Dressed {
  if (!boneOrder.length) setBoneOrder(skeleton.bones);
  const L = LOOKS[side][((look % LOOKS[side].length) + LOOKS[side].length) % LOOKS[side].length]!;
  const key = `${side}${LOOKS[side].indexOf(L)}`;
  let geo = geoCache.get(key);
  if (!geo) { geo = build(bind, side, L); geoCache.set(key, geo); }
  const nm = fabric();
  const kit = new THREE.MeshStandardMaterial({ color: L.shirt, roughness: 0.9, normalMap: nm, normalScale: new THREE.Vector2(0.45, 0.45), vertexColors: true });
  const gear = new THREE.MeshStandardMaterial({ roughness: 0.8, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), vertexColors: true });
  const lens = new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.06, metalness: 0.85, envMapIntensity: 1.6 });
  const accent = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, vertexColors: true });
  kit.name = 'kit'; gear.name = 'gear'; lens.name = 'lens'; accent.name = 'accent';
  for (const m of [kit, gear, accent]) rim(m);
  const meshes: THREE.SkinnedMesh[] = [];
  for (const [slot, mat] of [['kit', kit], ['gear', gear], ['lens', lens], ['accent', accent]] as const) {
    const g = geo[slot];
    if (!g.attributes.position || g.attributes.position.count === 0) continue;
    const m = new THREE.SkinnedMesh(g, mat);
    m.name = `operator-${slot}`;
    m.bind(skeleton, bind.bindMatrix);
    m.castShadow = true;
    m.frustumCulled = false;
    parent.add(m);
    meshes.push(m);
  }
  return { meshes, kit, accent };
}
