/**
 * Miniature CT and T characters for the 3D viewer, built in code from simple
 * shapes (original stylised figures, not CS2 character models).
 *
 * Each figure is articulated: hips and knees for walking, a waist for recoil
 * and falls, shoulders for throwing. Parts are vertex-coloured and merged per
 * joint, so a soldier is about ten small meshes sharing one material.
 *
 * CTs: helmet with goggles and headset, plate carrier with pouches, knee
 * pads, gloves and a hydration pack. Uniform colour varies by unit
 * (navy, olive-tan, urban grey).
 * Ts: no plate carrier or ballistic helmet; balaclava, head wrap, beanie or
 * cap; jackets and hoodies in civilian colours; a chest rig or satchel.
 * Both wear team-coloured armbands so sides read from the tactical camera.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type Joint = 'root' | 'hipL' | 'kneeL' | 'hipR' | 'kneeR' | 'waist' | 'helmet' | 'armL' | 'armR' | 'nade';
export type GunClass = 'rifle' | 'awp' | 'smg' | 'pistol' | 'shotgun';

/** Pivot of each joint in standing pose (metres, feet at y = 0, facing +z), and its parent. */
const PIVOT: Record<Joint, [number, number, number, Joint | null]> = {
  root: [0, 0, 0, null],
  hipL: [-0.1, 0.92, 0, 'root'], kneeL: [-0.1, 0.5, 0.01, 'hipL'],
  hipR: [0.1, 0.92, 0, 'root'], kneeR: [0.1, 0.5, 0.01, 'hipR'],
  waist: [0, 0.98, 0, 'root'],
  helmet: [0, 1.62, 0, 'waist'],
  armL: [-0.2, 1.42, 0, 'waist'], armR: [0.2, 1.42, 0, 'waist'],
  nade: [0.2, 1.42, 0, 'waist'],
};

export interface SoldierKit {
  geos: Map<string, THREE.BufferGeometry>;
  dead: THREE.MeshStandardMaterial;
  dispose(): void;
}

export interface Soldier {
  body: THREE.Group;
  legL: THREE.Object3D; legR: THREE.Object3D;
  kneeL: THREE.Object3D; kneeR: THREE.Object3D;
  waist: THREE.Object3D;
  armL: THREE.Object3D; armR: THREE.Object3D;
  helmet: THREE.Object3D;
  /** Both arms, the gun and the grenade hand, pivoting at the shoulders: pitch it to raise or lower the weapon. */
  carry: THREE.Object3D;
  gun: THREE.Mesh;
  nade: THREE.Object3D;
  gunClass: GunClass;
  side: 'T' | 'CT';
  variant: number;
  /** Material owned by this soldier (hit flashes tint it). */
  accent: THREE.MeshStandardMaterial;
  meshes: THREE.Mesh[];
  originals: THREE.Material[];
}

export function soldierKit(): SoldierKit {
  const geos = new Map<string, THREE.BufferGeometry>();
  const dead = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.9 });
  return { geos, dead, dispose() { for (const g of geos.values()) g.dispose(); geos.clear(); dead.dispose(); } };
}

// --------------------------------------------------------------------------- parts

type Part = { joint: Joint; geo: THREE.BufferGeometry; color: string; at: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

const G = {
  capsule: (r: number, l: number, s = 12) => new THREE.CapsuleGeometry(r, l, 4, s),
  // Every block is a rounded box: soft edges read as cloth, padding and moulded plastic, not crates.
  box: (x: number, y: number, z: number, round = 0.38) => new RoundedBoxGeometry(x, y, z, 3, Math.min(x, y, z) * round),
  sphere: (r: number, ws = 18, hs = 12, phiLen = Math.PI * 2, thetaLen = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen),
  cyl: (r0: number, r1: number, h: number, s = 10) => new THREE.CylinderGeometry(r0, r1, h, s),
};

/** A tapered capsule from a (radius r) to b (radius r1): rounded joints at both ends, like a padded limb. */
function limb(joint: Joint, a: [number, number, number], b: [number, number, number], r: number, color: string, r1 = r): Part {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = Math.max(0.01, va.distanceTo(vb));
  const body = new THREE.CylinderGeometry(r1, r, len, 14, 1, true);
  const capA = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  capA.translate(0, -len / 2, 0);
  const capB = new THREE.SphereGeometry(r1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  capB.translate(0, len / 2, 0);
  const parts = [body, capA, capB].map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
  const geo = mergeGeometries(parts) ?? body;
  [body, capA, capB, ...parts].forEach((g) => { if (g !== geo) g.dispose(); });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  geo.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  return { joint, geo, color, at: [mid.x, mid.y, mid.z] };
}

interface Outfit {
  top: string; pants: string; boots: string; skin: string; gloves: string;
  vest?: string; pouch?: string; pack?: string; helmet?: string;
  head: 'helmet' | 'balaclava' | 'wrap' | 'beanie' | 'cap';
  headColor: string; jacketLong: boolean; rig?: string; satchel?: string;
}

const CT_OUTFITS: Outfit[] = [
  { top: '#2b3a52', pants: '#27344a', boots: '#17191c', skin: '#c99c7a', gloves: '#1d1f22', vest: '#2f3a48', pouch: '#26303c', pack: '#28323e', helmet: '#39434e', head: 'helmet', headColor: '#39434e', jacketLong: false },
  { top: '#7d7258', pants: '#6f6650', boots: '#3b3127', skin: '#b98b6a', gloves: '#3a3a33', vest: '#8a7d5e', pouch: '#776b51', pack: '#6c624b', helmet: '#7d7358', head: 'helmet', headColor: '#7d7358', jacketLong: false },
  { top: '#3f4448', pants: '#353a3e', boots: '#151618', skin: '#d2a789', gloves: '#202224', vest: '#24282b', pouch: '#2c3135', pack: '#2a2e31', helmet: '#2a2f33', head: 'helmet', headColor: '#2a2f33', jacketLong: false },
];
const T_OUTFITS: Outfit[] = [
  { top: '#5a4632', pants: '#2c2a26', boots: '#1d1b18', skin: '#c49878', gloves: '#2a2622', head: 'balaclava', headColor: '#1d1e20', jacketLong: true, pack: '#3e3b2d', rig: '#3a3a2c' },
  { top: '#a08a64', pants: '#6b5d45', boots: '#3a2e22', skin: '#b08362', gloves: '#5a4b38', head: 'wrap', headColor: '#c9b48c', jacketLong: false, rig: '#58503a', satchel: '#6a5638' },
  { top: '#2f3533', pants: '#3b3a36', boots: '#1a1a1a', skin: '#d0a283', gloves: '#1e1e1e', head: 'beanie', headColor: '#262626', jacketLong: true, satchel: '#3d3a33' },
  { top: '#4c5a3c', pants: '#34362e', boots: '#24221d', skin: '#a9795a', gloves: '#2c2b26', head: 'cap', headColor: '#3a3f33', jacketLong: false, pack: '#4a4636', rig: '#3f4532' },
];

function outfitParts(side: 'T' | 'CT', variant: number, accent: string): Part[] {
  const o = (side === 'CT' ? CT_OUTFITS : T_OUTFITS)[variant]!;
  const P: Part[] = [];
  const ct = side === 'CT';
  // Legs: thigh on the hip joint, shin and boot on the knee joint.
  for (const [hip, knee, x] of [['hipL', 'kneeL', -0.1], ['hipR', 'kneeR', 0.1]] as const) {
    P.push(limb(hip, [x, 0.95, 0], [x, 0.5, 0.01], ct ? 0.1 : 0.097, o.pants, 0.078));
    P.push(limb(knee, [x, 0.5, 0.01], [x, 0.1, -0.01], 0.076, o.pants, 0.058));
    P.push({ joint: knee, geo: G.box(0.13, 0.12, 0.27), color: o.boots, at: [x, 0.06, 0.04] });
    if (ct) {
      P.push({ joint: knee, geo: G.box(0.13, 0.13, 0.06), color: o.pouch!, at: [x, 0.5, 0.075] });
      P.push({ joint: hip, geo: G.box(0.07, 0.14, 0.12), color: o.pouch!, at: [x + Math.sign(x) * 0.09, 0.72, 0.02] });
    }
  }
  // Hips and belt.
  P.push({ joint: 'waist', geo: G.box(0.34, 0.17, 0.22), color: o.pants, at: [0, 0.95, 0] });
  P.push({ joint: 'waist', geo: G.box(0.36, 0.05, 0.24), color: '#1c1c1c', at: [0, 1.02, 0] });
  // Torso.
  if (ct) {
    P.push({ joint: 'waist', geo: G.capsule(0.165, 0.24), color: o.top, at: [0, 1.3, 0], scale: [1.0, 0.8, 0.74] });
    P.push({ joint: 'waist', geo: G.box(0.4, 0.38, 0.28), color: o.vest!, at: [0, 1.3, 0.005] });
    // Front pouches, radio, shoulder straps.
    for (const px of [-0.12, 0, 0.12]) P.push({ joint: 'waist', geo: G.box(0.1, 0.13, 0.07), color: o.pouch!, at: [px, 1.2, 0.17] });
    P.push({ joint: 'waist', geo: G.box(0.07, 0.16, 0.06), color: '#151515', at: [-0.17, 1.38, 0.13] });
    P.push({ joint: 'waist', geo: G.box(0.4, 0.05, 0.3), color: o.pouch!, at: [0, 1.47, 0] });
    P.push({ joint: 'waist', geo: G.box(0.27, 0.32, 0.1), color: o.pack!, at: [0, 1.31, -0.19] });
    // Team patch on the back of the carrier.
    P.push({ joint: 'waist', geo: G.box(0.2, 0.06, 0.02), color: accent, at: [0, 1.42, -0.245] });
  } else {
    // Jacket or hoodie, longer and looser than the CT carrier.
    P.push({ joint: 'waist', geo: G.capsule(0.175, o.jacketLong ? 0.34 : 0.26), color: o.top, at: [0, o.jacketLong ? 1.24 : 1.29, 0], scale: [1.15, 1, 0.82] });
    if (o.rig) {
      P.push({ joint: 'waist', geo: G.box(0.3, 0.14, 0.08), color: o.rig, at: [0, 1.22, 0.15] });
      for (const sx of [-1, 1]) P.push({ joint: 'waist', geo: G.box(0.05, 0.3, 0.32), color: o.rig, at: [sx * 0.11, 1.36, 0] });
    }
    if (o.satchel) {
      P.push({ joint: 'waist', geo: G.box(0.08, 0.22, 0.26), color: o.satchel, at: [-0.2, 1.08, 0.02] });
      P.push({ joint: 'waist', geo: G.box(0.32, 0.04, 0.04), color: o.satchel, at: [0, 1.36, 0.15], rot: [0, 0, -0.6] });
    }
    if (o.pack) {
      P.push({ joint: 'waist', geo: G.box(0.32, 0.4, 0.18), color: o.pack, at: [0, 1.3, -0.22] });
      P.push({ joint: 'waist', geo: G.box(0.34, 0.06, 0.2), color: accent, at: [0, 1.53, -0.22] });
    } else P.push({ joint: 'waist', geo: G.box(0.22, 0.05, 0.02), color: accent, at: [0, 1.42, -0.15] });
    if (o.head === 'wrap') P.push({ joint: 'waist', geo: G.box(0.3, 0.08, 0.2), color: o.headColor, at: [0, 1.55, 0] });
  }
  // Shoulders: rounded caps so the silhouette reads as a person, not a box.
  for (const sx of [-1, 1]) P.push({ joint: 'waist', geo: G.sphere(ct ? 0.072 : 0.068), color: o.top, at: [sx * 0.185, 1.43, 0], scale: [0.95, 0.8, 0.95] });
  // Neck and head.
  P.push({ joint: 'waist', geo: G.cyl(0.055, 0.06, 0.1, 8), color: o.head === 'balaclava' ? o.headColor : o.skin, at: [0, 1.6, 0] });
  const headCol = o.head === 'balaclava' ? o.headColor : o.skin;
  // Skull a touch smaller and longer than a ball, with a jaw, chin and ears: a head, not a bead.
  P.push({ joint: 'waist', geo: G.sphere(0.108), color: headCol, at: [0, 1.745, 0.0], scale: [0.92, 1.06, 1.02] });
  P.push({ joint: 'waist', geo: G.box(0.135, 0.08, 0.14, 0.5), color: headCol, at: [0, 1.67, 0.03] });
  P.push({ joint: 'waist', geo: G.sphere(0.035, 10, 8), color: headCol, at: [0, 1.645, 0.09], scale: [1.2, 0.8, 0.9] });
  if (o.head !== 'balaclava') for (const sx of [-1, 1]) P.push({ joint: 'waist', geo: G.sphere(0.028, 8, 6), color: o.skin, at: [sx * 0.1, 1.735, -0.005], scale: [0.45, 1, 0.8] });
  // Mouth line.
  if (o.head !== 'balaclava') P.push({ joint: 'waist', geo: G.box(0.05, 0.01, 0.01), color: '#5a3a2c', at: [0, 1.672, 0.116] });
  if (o.head === 'balaclava') P.push({ joint: 'waist', geo: G.box(0.15, 0.04, 0.05), color: o.skin, at: [0, 1.75, 0.095] });
  // Eyes and brow, so faces have a direction even from the tactical camera.
  for (const sx of [-1, 1]) P.push({ joint: 'waist', geo: G.box(0.03, 0.018, 0.02), color: '#15130f', at: [sx * 0.04, 1.75, 0.112] });
  if (o.head !== 'balaclava') P.push({ joint: 'waist', geo: G.box(0.12, 0.02, 0.03), color: '#2a221b', at: [0, 1.775, 0.105] });
  if (o.head !== 'balaclava') P.push({ joint: 'waist', geo: G.box(0.03, 0.04, 0.03), color: o.skin, at: [0, 1.72, 0.12] });
  if (o.head === 'wrap') {
    P.push({ joint: 'waist', geo: G.sphere(0.128, 14, 8, Math.PI * 2, Math.PI * 0.58), color: o.headColor, at: [0, 1.75, 0] });
    P.push({ joint: 'waist', geo: G.box(0.2, 0.08, 0.06), color: o.headColor, at: [0, 1.68, 0.09] });
    P.push({ joint: 'waist', geo: G.box(0.07, 0.2, 0.05), color: o.headColor, at: [0.02, 1.62, -0.12], rot: [0.3, 0, 0] });
  }
  if (o.head === 'beanie') P.push({ joint: 'waist', geo: G.sphere(0.124, 14, 8, Math.PI * 2, Math.PI * 0.5), color: o.headColor, at: [0, 1.76, 0], scale: [1, 1.15, 1] });
  if (o.head === 'cap') {
    P.push({ joint: 'waist', geo: G.sphere(0.122, 14, 8, Math.PI * 2, Math.PI * 0.45), color: o.headColor, at: [0, 1.77, 0] });
    P.push({ joint: 'waist', geo: G.box(0.17, 0.02, 0.12), color: o.headColor, at: [0, 1.8, 0.13] });
  }
  // CT helmet (shown only when the player bought one): shell, rim, goggles, headset, NVG mount.
  if (ct) {
    P.push({ joint: 'helmet', geo: G.sphere(0.142, 16, 9, Math.PI * 2, Math.PI * 0.55), color: o.helmet!, at: [0, 1.76, 0] });
    P.push({ joint: 'helmet', geo: G.cyl(0.15, 0.15, 0.03, 16), color: o.helmet!, at: [0, 1.745, -0.005] });
    P.push({ joint: 'helmet', geo: G.box(0.17, 0.05, 0.05), color: '#11161b', at: [0, 1.86, 0.1] });
    P.push({ joint: 'helmet', geo: G.box(0.05, 0.05, 0.05), color: '#222', at: [0, 1.82, 0.13] });
    for (const sx of [-1, 1]) P.push({ joint: 'helmet', geo: G.cyl(0.05, 0.05, 0.05, 10), color: '#1b1d20', at: [sx * 0.12, 1.72, 0], rot: [0, 0, Math.PI / 2] });
    P.push({ joint: 'helmet', geo: G.box(0.1, 0.035, 0.02), color: accent, at: [0, 1.81, -0.135] });
    // Chin strap, side rails and a lens on the goggles that catches the light.
    for (const sx of [-1, 1]) P.push({ joint: 'helmet', geo: G.box(0.012, 0.12, 0.02), color: '#191b1e', at: [sx * 0.105, 1.66, 0.04], rot: [0, 0, sx * 0.15] });
    for (const sx of [-1, 1]) P.push({ joint: 'helmet', geo: G.box(0.02, 0.03, 0.16), color: '#23272b', at: [sx * 0.14, 1.79, 0] });
    P.push({ joint: 'helmet', geo: G.box(0.15, 0.035, 0.02), color: '#3d5a73', at: [0, 1.86, 0.126] });
  }
  // Arms in a rifle hold: right hand on the grip, left hand on the handguard.
  for (const [arm, sh, el, hand] of [
    ['armR', [0.2, 1.43, 0], [0.24, 1.22, 0.06], [0.09, 1.28, 0.26]],
    ['armL', [-0.2, 1.43, 0], [-0.2, 1.24, 0.24], [0.02, 1.31, 0.48]],
  ] as const) {
    P.push(limb(arm, sh as unknown as [number, number, number], el as unknown as [number, number, number], ct ? 0.072 : 0.068, o.top, 0.056));
    P.push(limb(arm, el as unknown as [number, number, number], hand as unknown as [number, number, number], 0.054, o.top, 0.044));
    P.push({ joint: arm, geo: G.sphere(0.05, 10, 8), color: o.gloves, at: [hand[0], hand[1], hand[2]], scale: [0.9, 0.8, 1.25] });
    // Armband in team colour.
    const along = (k: number): [number, number, number] => [sh[0] + (el[0] - sh[0]) * k, sh[1] + (el[1] - sh[1]) * k, sh[2] + (el[2] - sh[2]) * k];
    P.push(limb(arm, along(0.3), along(0.46), ct ? 0.079 : 0.075, accent, 0.07));
    if (ct) P.push({ joint: arm, geo: G.box(0.13, 0.05, 0.14), color: o.vest!, at: [sh[0], sh[1] + 0.02, sh[2]] });
  }
  // A grenade in the throwing hand (shown during a throw).
  P.push({ joint: 'nade', geo: G.sphere(0.06, 8, 6), color: '#59614a', at: [0.09, 1.28, 0.26] });
  return P;
}

function gunParts(kind: GunClass): Part[] {
  const P: Part[] = [];
  const black = '#1a1c1f', wood = '#6b4a2e', metal = '#3a3e43';
  const add = (geo: THREE.BufferGeometry, color: string, at: [number, number, number], rot?: [number, number, number]) => P.push({ joint: 'waist', geo, color, at, rot });
  const y = 1.31, x = 0.07;
  if (kind === 'pistol') {
    add(G.box(0.04, 0.05, 0.2), metal, [0.05, y + 0.012, 0.5]);
    add(G.box(0.036, 0.03, 0.17), black, [0.05, y - 0.027, 0.49]);
    add(G.box(0.035, 0.1, 0.05), black, [0.05, y - 0.06, 0.45], [0.25, 0, 0]);
    add(G.box(0.01, 0.015, 0.012), '#c9ced4', [0.05, y + 0.042, 0.59]);
    return P;
  }
  const len = kind === 'awp' ? 0.62 : kind === 'smg' ? 0.32 : kind === 'shotgun' ? 0.5 : 0.46;
  add(G.box(0.06, 0.09, len), kind === 'rifle' ? metal : black, [x, y, 0.15 + len / 2]);
  const barrel = kind === 'awp' ? 0.42 : kind === 'smg' ? 0.12 : 0.26;
  add(G.cyl(0.016, 0.016, barrel, 6), black, [x, y + 0.01, 0.15 + len + barrel / 2], [Math.PI / 2, 0, 0]);
  add(G.box(0.05, 0.11, 0.2), kind === 'awp' || kind === 'shotgun' ? wood : black, [x + 0.01, y - 0.01, 0.07]);
  if (kind !== 'shotgun') add(G.box(0.04, 0.15, 0.06), black, [x, y - 0.1, 0.15 + len * 0.45], [kind === 'rifle' ? 0.3 : 0.1, 0, 0]);
  if (kind === 'awp') {
    add(G.cyl(0.03, 0.03, 0.3, 12), '#25292d', [x, y + 0.09, 0.42], [Math.PI / 2, 0, 0]);
    add(G.cyl(0.038, 0.03, 0.06, 12), '#25292d', [x, y + 0.09, 0.6], [Math.PI / 2, 0, 0]);
    add(G.cyl(0.031, 0.031, 0.005, 12), '#4a7fb0', [x, y + 0.09, 0.632], [Math.PI / 2, 0, 0]);
    add(G.cyl(0.012, 0.012, 0.07, 6), metal, [x + 0.05, y + 0.02, 0.2], [0, 0, Math.PI / 2]);
    add(G.box(0.07, 0.1, 0.06), '#2b4a2e', [x, y - 0.03, 0.06]);
  }
  if (kind === 'rifle') {
    add(G.box(0.05, 0.03, 0.18), '#2b2f33', [x, y + 0.055, 0.32]);
    // Curved magazine, front sight post and a muzzle brake.
    add(G.box(0.04, 0.16, 0.07), '#5a4a32', [x, y - 0.11, 0.42], [0.35, 0, 0]);
    add(G.box(0.012, 0.05, 0.012), black, [x, y + 0.06, 0.58]);
    add(G.cyl(0.022, 0.022, 0.05, 8), metal, [x, y + 0.01, 0.9], [Math.PI / 2, 0, 0]);
  }
  if (kind === 'smg') add(G.box(0.035, 0.18, 0.04), black, [x, y - 0.12, 0.3], [0.05, 0, 0]);
  if (kind === 'shotgun') add(G.cyl(0.024, 0.024, 0.3, 8), wood, [x, y - 0.045, 0.45], [Math.PI / 2, 0, 0]);
  return P;
}

/** Merge parts of one joint into one vertex-coloured geometry in joint-local space. */
function mergeJoint(parts: Part[], joint: Joint): THREE.BufferGeometry {
  const [px, py, pz] = PIVOT[joint];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const list = parts.filter((p) => p.joint === joint).map((p) => {
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const a of Object.keys(src.attributes)) if (a !== 'position' && a !== 'normal') src.deleteAttribute(a);
    m.compose(new THREE.Vector3(p.at[0] - px, p.at[1] - py, p.at[2] - pz), q.setFromEuler(e.set(...(p.rot ?? [0, 0, 0]))), new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
    src.applyMatrix4(m);
    c.set(p.color);
    const n = src.attributes.position!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    src.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return src;
  });
  for (const p of parts) if (p.joint === joint) p.geo.dispose();
  const g = list.length ? mergeGeometries(list) ?? new THREE.BufferGeometry() : new THREE.BufferGeometry();
  list.forEach((x) => x.dispose());
  return g;
}

function cached(kit: SoldierKit, key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = kit.geos.get(key);
  if (!g) { g = make(); kit.geos.set(key, g); }
  return g;
}

export function gunClassOf(weapon: string): GunClass {
  const w = weapon.toLowerCase();
  if (w.includes('awp') || w.includes('ssg') || w.includes('scout')) return 'awp';
  if (/(mac|mp9|mp7|mp5|ump|p90|bizon)/.test(w)) return 'smg';
  if (/(nova|xm|mag-7|sawed|mag7)/.test(w)) return 'shotgun';
  if (/(glock|usp|p2000|p250|deagle|desert|five|tec|cz|dual|r8|revolver)/.test(w)) return 'pistol';
  return 'rifle';
}

export function buildSoldier(kit: SoldierKit, side: 'T' | 'CT', team: THREE.Color, seed = 0): Soldier {
  const variant = Math.abs(seed) % (side === 'CT' ? CT_OUTFITS.length : T_OUTFITS.length);
  const accentHex = `#${team.getHexString()}`;
  const accent = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.06 });
  addRim(accent, team);
  const joints: Partial<Record<Joint, THREE.Object3D>> = {};
  const order: Joint[] = ['root', 'hipL', 'kneeL', 'hipR', 'kneeR', 'waist', 'helmet', 'armL', 'armR', 'nade'];
  const meshes: THREE.Mesh[] = [];
  for (const j of order) {
    const [x, y, z, parent] = PIVOT[j];
    const grp = new THREE.Group();
    if (parent) { const [ppx, ppy, ppz] = PIVOT[parent]; grp.position.set(x - ppx, y - ppy, z - ppz); joints[parent]!.add(grp); }
    joints[j] = grp;
    if (j === 'root') continue;
    const geo = cached(kit, `${side}|${variant}|${accentHex}|${j}`, () => mergeJoint(outfitParts(side, variant, accentHex), j));
    if (!geo.attributes.position) continue;
    const mesh = new THREE.Mesh(geo, accent);
    mesh.castShadow = true;
    grp.add(mesh); meshes.push(mesh);
  }
  const gun = new THREE.Mesh(cached(kit, 'gun|rifle', () => mergeJoint(gunParts('rifle'), 'waist')), accent);
  gun.castShadow = true;
  // The carry pivot sits on the shoulder line; arms, grenade hand and gun move with it.
  const shoulderY = PIVOT.armL[1] - PIVOT.waist[1];
  const carry = new THREE.Group();
  carry.position.set(0, shoulderY, 0);
  joints.waist!.add(carry);
  for (const j of ['armL', 'armR', 'nade'] as const) { const o = joints[j]!; carry.add(o); o.position.y -= shoulderY; }
  gun.position.y = -shoulderY;
  carry.add(gun); meshes.push(gun);
  const nade = joints.nade!;
  nade.visible = false;
  return {
    body: joints.root as THREE.Group, legL: joints.hipL!, legR: joints.hipR!, kneeL: joints.kneeL!, kneeR: joints.kneeR!,
    waist: joints.waist!, armL: joints.armL!, armR: joints.armR!, helmet: joints.helmet!, carry, gun, nade, gunClass: 'rifle', side, variant,
    accent, meshes, originals: meshes.map((m) => m.material as THREE.Material),
  };
}

/**
 * A soft team-coloured rim light (fresnel) so figures separate from the map at any camera angle,
 * the way broadcast lighting picks players out.
 */
function addRim(mat: THREE.MeshStandardMaterial, team: THREE.Color) {
  const rim = team.clone().lerp(new THREE.Color(0xffffff), 0.35);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: rim };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 rimColor;
varying vec3 vObj;
float cmHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cmNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cmHash(i), cmHash(i + vec3(1, 0, 0)), f.x), mix(cmHash(i + vec3(0, 1, 0)), cmHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cmHash(i + vec3(0, 0, 1)), cmHash(i + vec3(1, 0, 1)), f.x), mix(cmHash(i + vec3(0, 1, 1)), cmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      // Cloth: a fine weave grain plus broad wear and dust patches, so kit reads as fabric, not plastic.
      .replace('#include <color_fragment>', `#include <color_fragment>
float weave = cmNoise(vObj * 220.0) * 0.6 + cmNoise(vObj * 90.0) * 0.4;
float wear = cmNoise(vObj * 7.0 + 3.1);
diffuseColor.rgb *= 0.9 + 0.16 * weave;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.04, 0.96) + 0.025, smoothstep(0.55, 0.85, wear) * 0.5);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (cmNoise(vObj * 140.0) - 0.5) * 0.18, 0.3, 1.0);')
      .replace('#include <opaque_fragment>', 'float rimK = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.5);\noutgoingLight += rimColor * rimK * 0.24;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => `rim-cloth-${rim.getHexString()}`;
}

/** Swap the gun model when the player's weapon class changes. */
export function setGun(kit: SoldierKit, s: Soldier, cls: GunClass) {
  if (s.gunClass === cls) return;
  s.gunClass = cls;
  s.gun.geometry = cached(kit, `gun|${cls}`, () => mergeJoint(gunParts(cls), 'waist'));
}

/** 0 standing, 1 walking (silent), 2 running, 3 a faster run (unused by the match view). */
export type Gait = 0 | 1 | 2 | 3;
/** How low the weapon is carried at each gait (radians of shoulder pitch). */
export const CARRY = [0.14, 0.04, 0.2, 0.62] as const;

/**
 * Body pose for one frame. p is the stride phase (radians), aim 0..1 blends to the shouldered
 * aiming stance, carry is the eased weapon height for the gait, kick 0..1 is recent recoil.
 */
export function poseSoldier(s: Soldier, o: { gait: Gait; p: number; aim: number; carry: number; kick: number }) {
  const { gait, p, aim, kick } = o;
  const moving = gait > 0;
  const amp = [0, 0.32, 0.5, 0.74][gait]! * (1 - 0.45 * aim);
  const swing = Math.sin(p) * amp;
  s.legL.rotation.x = swing; s.legR.rotation.x = -swing;
  // Knees bend as each leg swings through; a crouched stance while aiming or walking.
  const crouch = 0.04 + 0.2 * aim * (moving ? 0.5 : 1) + (gait === 1 ? 0.14 : 0);
  s.kneeL.rotation.x = moving ? Math.max(0, -Math.sin(p - 0.6)) * (0.6 + amp * 0.8) + crouch : crouch;
  s.kneeR.rotation.x = moving ? Math.max(0, Math.sin(p - 0.6)) * (0.6 + amp * 0.8) + crouch : crouch;
  s.body.position.y = (moving ? Math.abs(Math.cos(p)) * [0, 0.02, 0.05, 0.09][gait]! : 0) - crouch * 0.12;
  // Torso: leans into a sprint, settles behind the sights; recoil kicks it back after each shot.
  const lean = [0, 0.03, 0.08, 0.22][gait]!;
  s.waist.rotation.x = lean * (1 - aim) + 0.05 * aim - kick * 0.12;
  s.waist.rotation.y = moving ? Math.sin(p) * 0.06 * (1 - aim) : 0;
  // Weapon: low and swinging in a sprint, up on the shoulder to aim; the head dips to the sights.
  s.carry.rotation.x = o.carry * (1 - aim) - 0.05 * aim + (gait === 3 ? Math.sin(p * 2) * 0.05 : 0) - kick * 0.06;
  s.helmet.rotation.x = 0.12 * aim;
}

/** Swap every part to one material (corpses), or back to the originals. */
export function setDead(s: Soldier, dead: THREE.Material | null) {
  s.meshes.forEach((m, i) => { m.material = dead ?? s.originals[i]!; });
}
