/**
 * Rifles the operators carry: a carbine for counter-terrorists, a wood-and-steel assault rifle for
 * terrorists and a bolt-action sniper rifle. Original models built in code from simple shapes in
 * the manner of the classic designs (no game files).
 *
 * Gun space: metres, +z toward the muzzle, +y up, origin on the bore line at the back of the
 * receiver; it is right-handed, so +x is the gun's left side as the shooter sees it. Each model also says where the hands go: `grip` for the right wrist
 * (firing hand on the pistol grip) and `guard` for the left wrist (support hand under the fore-end).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type WeaponKind = 'carbine' | 'rifle' | 'sniper';
export interface WeaponModel { geo: THREE.BufferGeometry; grip: THREE.Vector3; guard: THREE.Vector3 }

type V3 = [number, number, number];
type ZY = [number, number];

class Parts {
  private list: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(g: THREE.BufferGeometry, color: string, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], sc: V3 = [1, 1, 1]) {
    this.m.compose(new THREE.Vector3(...at), this.q.setFromEuler(this.e.set(...rot)), new THREE.Vector3(...sc));
    this.put(g, color, this.m);
  }

  put(g: THREE.BufferGeometry, color: string, m: THREE.Matrix4) {
    const src = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    for (const a of Object.keys(src.attributes)) if (a !== 'position' && a !== 'normal') src.deleteAttribute(a);
    src.applyMatrix4(m);
    const c = new THREE.Color(color), n = src.attributes.position!.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    src.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.list.push(src);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list) ?? new THREE.BufferGeometry();
    for (const x of this.list) x.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

const box = (w: number, h: number, d: number, r = 0.25) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * r);
/** A cylinder along +z (radius r1 at the front, r0 at the back). */
const tubeZ = (r0: number, r1: number, len: number, seg = 14) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2);
/** A cylinder along +x. */
const tubeX = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
/** A side profile (z, y points) extruded across the gun, centred on x = 0. */
function slab(pts: ZY[], depth: number, bevel = 0.004, smooth = false): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  if (smooth) sh.splineThru(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  else { sh.moveTo(pts[0]![0], pts[0]![1]); for (const [z, y] of pts.slice(1)) sh.lineTo(z, y); }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8, steps: 1 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  // Shape x → gun z, shape y → gun y, extrusion → gun -x.
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
  return g;
}
/** A curved magazine: top edge from zA to zB at y0, bowing forward to its foot at (zC..zD, y1). */
function curvedMag(zA: number, zB: number, y0: number, zC: number, zD: number, y1: number, bow: number, depth: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(zA, y0);
  sh.lineTo(zB, y0);
  sh.quadraticCurveTo(zB + bow * 0.4, (y0 + y1) / 2, zD, y1);
  sh.lineTo(zC, y1 - 0.012);
  sh.quadraticCurveTo(zA + bow * 0.2, (y0 + y1) / 2, zA, y0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 10, steps: 1 });
  g.translate(0, 0, -(depth - 0.006) / 2);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
  return g;
}

function carbine(): WeaponModel {
  const P = new Parts();
  const K = '#1b1c1e', G = '#2a2c2f', M = '#3a3d41', lens = '#2c5878';
  // Upper and lower receiver, a flat-top rail running onto the handguard.
  P.add(box(0.032, 0.042, 0.2), G, [0, 0.004, 0.1]);
  P.add(box(0.03, 0.04, 0.17), G, [0, -0.034, 0.105]);
  P.add(box(0.024, 0.01, 0.46), K, [0, 0.03, 0.23]);
  for (let i = 0; i < 18; i++) P.add(box(0.026, 0.004, 0.006, 0.1), K, [0, 0.036, 0.02 + i * 0.024]);
  P.add(box(0.002, 0.016, 0.05, 0.1), M, [-0.017, 0.002, 0.095]);
  P.add(box(0.03, 0.01, 0.024), G, [0, 0.02, -0.006]);
  // Magazine well and a curved box magazine.
  P.add(box(0.033, 0.05, 0.068), G, [0, -0.066, 0.15]);
  P.put(curvedMag(0.122, 0.178, -0.085, 0.158, 0.214, -0.27, 0.05, 0.026), K, new THREE.Matrix4());
  P.add(box(0.031, 0.012, 0.064), G, [0, -0.276, 0.188], [-0.22, 0, 0]);
  // Pistol grip, trigger guard and trigger.
  P.put(slab([[0.03, -0.05], [0.068, -0.05], [0.052, -0.1], [0.044, -0.158], [0.006, -0.158], [0.012, -0.1]], 0.029, 0.005), K, new THREE.Matrix4());
  P.add(box(0.008, 0.005, 0.058), G, [0, -0.074, 0.1]);
  P.add(box(0.004, 0.02, 0.006), M, [0, -0.062, 0.097], [0.3, 0, 0]);
  // Buffer tube and a collapsible stock.
  P.add(tubeZ(0.0155, 0.0155, 0.17), G, [0, -0.008, -0.085]);
  P.put(slab([[-0.29, 0.024], [-0.15, 0.024], [-0.135, 0.004], [-0.15, -0.03], [-0.2, -0.104], [-0.29, -0.112]], 0.044, 0.007), K, new THREE.Matrix4());
  P.add(box(0.046, 0.138, 0.014), '#141516', [0, -0.044, -0.292]);
  // Handguard with vent slots, barrel, flash hider, folding sights.
  P.add(box(0.052, 0.056, 0.3, 0.3), K, [0, -0.002, 0.355]);
  for (let i = 0; i < 5; i++) P.add(box(0.0545, 0.012, 0.03, 0.2), G, [0, -0.004, 0.25 + i * 0.052]);
  P.add(tubeZ(0.0088, 0.0088, 0.18), G, [0, 0, 0.59]);
  P.add(tubeZ(0.0115, 0.0115, 0.055), K, [0, 0, 0.695]);
  P.add(box(0.016, 0.016, 0.03), K, [0, 0.043, 0.47]);
  P.add(box(0.016, 0.018, 0.024), K, [0, 0.044, 0.012]);
  // Red-dot sight on a riser.
  P.add(box(0.022, 0.026, 0.042), K, [0, 0.047, 0.125]);
  P.add(tubeZ(0.02, 0.02, 0.072, 18), K, [0, 0.068, 0.125]);
  P.add(tubeZ(0.0165, 0.0165, 0.003, 18), lens, [0, 0.068, 0.162]);
  P.add(tubeZ(0.0165, 0.0165, 0.003, 18), lens, [0, 0.068, 0.088]);
  return { geo: P.build(), grip: new THREE.Vector3(-0.03, -0.095, -0.04), guard: new THREE.Vector3(0.04, -0.085, 0.27) };
}

function rifle(): WeaponModel {
  const P = new Parts();
  const wood = '#6e4428', woodD = '#5a361f', steel = '#2a2b2d', steel2 = '#3b3c3f', bake = '#6a3418';
  // Stamped receiver with its rounded dust cover and the selector on the right.
  P.add(box(0.036, 0.058, 0.25, 0.15), steel, [0, -0.012, 0.125]);
  P.add(tubeZ(0.018, 0.018, 0.22, 16), steel, [0, 0.014, 0.12], [0, 0, 0], [1, 1, 0.55]);
  P.add(box(0.003, 0.012, 0.085, 0.2), steel2, [-0.0195, 0.002, 0.125]);
  // Wooden stock and a dark pistol grip.
  P.put(slab([[-0.34, 0.0], [-0.01, 0.007], [0.002, -0.034], [-0.05, -0.05], [-0.25, -0.1], [-0.34, -0.126]], 0.04, 0.006), wood, new THREE.Matrix4());
  P.add(box(0.044, 0.13, 0.012), steel, [0, -0.063, -0.343], [0.12, 0, 0]);
  P.put(slab([[0.035, -0.038], [0.072, -0.038], [0.056, -0.1], [0.046, -0.15], [0.008, -0.146], [0.016, -0.09]], 0.03, 0.005), woodD, new THREE.Matrix4());
  P.add(box(0.008, 0.005, 0.072), steel, [0, -0.047, 0.112]);
  // Curved magazine.
  P.put(curvedMag(0.135, 0.2, -0.038, 0.256, 0.316, -0.262, 0.08, 0.027), bake, new THREE.Matrix4());
  // Wooden handguards over the barrel and gas tube.
  P.add(box(0.05, 0.05, 0.2, 0.4), wood, [0, -0.016, 0.356]);
  P.add(box(0.042, 0.03, 0.012, 0.3), steel, [0, -0.012, 0.46]);
  P.add(tubeZ(0.0165, 0.0165, 0.16, 14), woodD, [0, 0.031, 0.33]);
  P.add(tubeZ(0.011, 0.011, 0.07, 10), steel, [0, 0.031, 0.445]);
  // Barrel, gas block, front sight and muzzle brake; rear sight on the handguard.
  P.add(tubeZ(0.0095, 0.009, 0.42, 12), steel2, [0, 0, 0.46]);
  P.add(box(0.022, 0.045, 0.022), steel, [0, 0.014, 0.48]);
  P.add(box(0.018, 0.034, 0.028), steel, [0, 0.016, 0.635]);
  P.add(box(0.006, 0.03, 0.006, 0.2), steel, [0, 0.046, 0.635]);
  P.add(tubeZ(0.0125, 0.012, 0.045, 12), steel2, [0, 0, 0.69]);
  P.add(box(0.024, 0.016, 0.05), steel, [0, 0.032, 0.27]);
  return { geo: P.build(), grip: new THREE.Vector3(-0.03, -0.085, -0.035), guard: new THREE.Vector3(0.04, -0.08, 0.3) };
}

function sniper(): WeaponModel {
  const P = new Parts();
  const green = '#3f4b38', greenD = '#333d2e', steel = '#24262a', black = '#151618', lens = '#2c5878';
  // One-piece stock with a pistol grip, fore-end and cheek line.
  P.put(slab([[-0.43, 0.02], [-0.1, 0.022], [0.02, -0.008], [0.42, -0.004], [0.44, -0.03], [0.41, -0.056], [0.1, -0.06], [0.064, -0.07], [0.056, -0.16],
    [0.012, -0.162], [-0.02, -0.08], [-0.1, -0.074], [-0.25, -0.128], [-0.43, -0.146]], 0.05, 0.007), green, new THREE.Matrix4());
  P.add(box(0.052, 0.17, 0.014), black, [0, -0.062, -0.437]);
  // Receiver, bolt, magazine and trigger guard.
  P.add(tubeZ(0.018, 0.018, 0.25, 16), steel, [0, 0.02, 0.1]);
  P.add(tubeX(0.005, 0.05), black, [-0.035, 0.018, 0.17]);
  P.add(new THREE.SphereGeometry(0.01, 10, 8), black, [-0.062, 0.012, 0.17]);
  P.add(box(0.03, 0.06, 0.07), black, [0, -0.07, 0.14]);
  P.add(box(0.008, 0.005, 0.06), black, [0, -0.07, 0.08]);
  // Long barrel and a muzzle brake.
  P.add(tubeZ(0.012, 0.0095, 0.62, 14), steel, [0, 0.02, 0.53]);
  P.add(tubeZ(0.015, 0.015, 0.065, 12), black, [0, 0.02, 0.87]);
  // Telescopic sight: tube, bells, lenses, turrets and rings.
  P.add(tubeZ(0.016, 0.016, 0.25, 18), black, [0, 0.086, 0.11]);
  P.add(tubeZ(0.017, 0.027, 0.065, 18), black, [0, 0.086, 0.265]);
  P.add(tubeZ(0.024, 0.024, 0.003, 18), lens, [0, 0.086, 0.299]);
  P.add(tubeZ(0.021, 0.017, 0.05, 18), black, [0, 0.086, -0.04]);
  P.add(tubeZ(0.017, 0.017, 0.003, 18), lens, [0, 0.086, -0.066]);
  P.add(new THREE.CylinderGeometry(0.011, 0.011, 0.022, 14), greenD, [0, 0.112, 0.11]);
  P.add(tubeX(0.011, 0.022, 14), greenD, [-0.024, 0.086, 0.11]);
  for (const z of [0.04, 0.18]) P.add(box(0.026, 0.05, 0.016), black, [0, 0.058, z]);
  return { geo: P.build(), grip: new THREE.Vector3(-0.03, -0.1, -0.035), guard: new THREE.Vector3(0.04, -0.09, 0.3) };
}

const cache = new Map<WeaponKind, WeaponModel>();
/** The shared model of one weapon (geometry is cached: do not dispose it). */
export function weaponModel(kind: WeaponKind): WeaponModel {
  let w = cache.get(kind);
  if (!w) { w = kind === 'carbine' ? carbine() : kind === 'rifle' ? rifle() : sniper(); cache.set(kind, w); }
  return w;
}

/** A material for weapons: vertex colours, a little metal sheen. */
export function weaponMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.7 });
}

/**
 * A relaxed carry across the body, as operators stand in a game's menu: the weapon rests on the
 * chest bone with the muzzle toward the figure's left front. Returns where the weapon sits in the
 * operator's bind space (metres, facing -z, right hand at +x) and the wrist targets in gun space;
 * the support hand holds the front of the receiver, where the figure's arms reach.
 */
export function carryAcross(w: WeaponModel, o: { yaw?: number; pitch?: number; roll?: number; wrist?: [number, number, number] } = {}) {
  const yaw = o.yaw ?? 0.9, pitch = o.pitch ?? 0.12, roll = o.roll ?? 0.45;
  const f = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const u0 = new THREE.Vector3(0, 1, 0).addScaledVector(f, -f.y).normalize();
  const x0 = new THREE.Vector3().crossVectors(u0, f);
  const x = x0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(u0, Math.sin(roll));
  const u = u0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(x0, -Math.sin(roll));
  const m = new THREE.Matrix4().makeBasis(x, u, f);
  const grip = w.grip.clone();
  const guard = new THREE.Vector3(w.guard.x, w.guard.y, Math.min(w.guard.z, 0.17));
  const wrist = new THREE.Vector3(...(o.wrist ?? [0.1, 1.16, -0.2]));
  m.setPosition(wrist.sub(grip.clone().applyMatrix4(m)));
  return { m, grip, guard };
}
