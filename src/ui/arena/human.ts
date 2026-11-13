/**
 * Skinned soldier figures for the 3D views (home lobby and live match).
 *
 * The rig is the rigged "Soldier" from the three.js examples (a Mixamo skeleton with Idle,
 * Walk and Run clips). Its own armoured mesh is not shown: each figure is dressed as an operator
 * (operator.ts), kit built in code and skinned to the same skeleton, CTs and Ts in their own
 * looks with the team rim light. The procedural soldier from models.ts stays as the skeleton the
 * match viewer poses (and as the fallback until this loads); its gun is moved into the figure's
 * hands with IK on top of the walk and run clips.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import soldierUrl from './assets/soldier.glb?url';
import { bindOf, dress, type Bind } from './operator';

interface Template { scene: THREE.Object3D; clips: THREE.AnimationClip[]; scale: number; bind: Bind }

let template: Template | null = null;
let loading: Promise<void> | null = null;
let failed = false;

/** Start loading the figure (once). Resolves when ready; never rejects. */
export function loadHuman(): Promise<void> {
  if (loading) return loading;
  // The file is packed with gltf-transform (meshopt geometry, WebP textures): about 0.7 MB instead of 2.2 MB.
  loading = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(soldierUrl).then((g) => {
    // Skinned bounding boxes ignore the armature's scale, so measure the skeleton instead:
    // the head joint of a 1.84 m figure sits about 1.6 m above the soles.
    g.scene.updateMatrixWorld(true);
    const y = (n: string) => g.scene.getObjectByName(`mixamorig${n}`)?.getWorldPosition(new THREE.Vector3()).y ?? 0;
    const h = y('Head') - Math.min(y('LeftToeBase'), y('RightToeBase')) + 0.05 * (y('Head') - y('Hips'));
    let skinned: THREE.SkinnedMesh | null = null;
    g.scene.traverse((o) => { if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh && !/visor/i.test(o.name)) skinned = o as THREE.SkinnedMesh; });
    if (!skinned) throw new Error('no skinned mesh');
    template = { scene: g.scene, clips: g.animations, scale: h > 0 ? 1.6 / h : 1, bind: bindOf(skinned, g.scene) };
  }).catch(() => { failed = true; });
  return loading;
}

export const humanReady = () => !!template;
export const humanFailed = () => failed;

export interface Human {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction;
  bones: Record<'spine' | 'neck' | 'armR' | 'foreR' | 'handR' | 'armL' | 'foreL' | 'handL', THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
  /** The shirt material owned by this figure (hit flashes and hover tint its emissive). */
  body: THREE.MeshStandardMaterial;
  /** Materials that take the team kit colour (the shirt or jacket). */
  kit: THREE.MeshStandardMaterial[];
  /** Patches and name tape, in the team colour. */
  accent: THREE.MeshStandardMaterial;
  weights: [number, number, number];
}

/**
 * A new figure for one player, or null while the model is still loading. `look` picks one of
 * the side's operator looks (any integer; it wraps).
 */
export function makeHuman(side: 'T' | 'CT', rim: (m: THREE.MeshStandardMaterial) => void, look = 0): Human | null {
  if (!template) return null;
  const root = cloneSkinned(template.scene);
  root.scale.setScalar(template.scale);
  // The stock armoured mesh only lends its skeleton: take it out and dress the operator instead.
  let skeleton: THREE.Skeleton | null = null;
  const stock: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    skeleton ??= m.skeleton;
    stock.push(m);
  });
  for (const m of stock) m.parent?.remove(m);
  if (!skeleton) return null;
  const d = dress(root, skeleton, template.bind, side, look, rim);
  const bone = (n: string) => root.getObjectByName(`mixamorig${n}`) as THREE.Bone;
  const bones = {
    spine: bone('Spine1'), neck: bone('Neck'),
    armR: bone('RightArm'), foreR: bone('RightForeArm'), handR: bone('RightHand'),
    armL: bone('LeftArm'), foreL: bone('LeftForeArm'), handL: bone('LeftHand'),
  };
  const mixer = new THREE.AnimationMixer(root);
  const clip = (n: string) => template!.clips.find((c) => c.name === n)!;
  const act = (n: string) => { const a = mixer.clipAction(clip(n)); a.play(); a.setEffectiveWeight(0); return a; };
  const h: Human = { root, mixer, idle: act('Idle'), walk: act('Walk'), run: act('Run'), bones, meshes: d.meshes, body: d.kit, kit: [d.kit], accent: d.accent, weights: [1, 0, 0] };
  h.idle.setEffectiveWeight(1);
  // Different players are out of step with each other.
  for (const a of [h.idle, h.walk, h.run]) a.time = Math.random() * a.getClip().duration;
  return h;
}

// Two-bone IK: the hands are put on the gun (grip and handguard) after the clip has posed the body,
// so the figure carries whatever weapon the procedural rig holds, wherever it points.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion();

/** Rotate `bone` (in world space) so the point `from` (world) moves onto the ray toward `to`. */
function aimBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) {
  const p = bone.getWorldPosition(_a);
  const v1 = _b.copy(from).sub(p).normalize(), v2 = _c.copy(to).sub(p).normalize();
  if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(v1, v2);
  bone.getWorldQuaternion(_bq);
  bone.parent!.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_q.multiply(_bq)));
  bone.updateMatrixWorld(true);
}

function twoBoneIK(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const H = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E), b = E.distanceTo(H);
  const toT = _d.copy(target).sub(S);
  const d = Math.min(toT.length(), a + b - 1e-4);
  if (d < 1e-4) return;
  const u = toT.normalize().clone();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const w = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const elbow = S.clone().addScaledVector(u, a * cosA).addScaledVector(w, a * Math.sqrt(1 - cosA * cosA));
  aimBone(upper, E, elbow);
  aimBone(lower, hand.getWorldPosition(new THREE.Vector3()), target);
}

export interface Hold {
  /** World positions for the right hand (grip) and left hand (handguard); null hides the weapon pose. */
  grip: THREE.Vector3 | null;
  guard: THREE.Vector3 | null;
  /** World-space "down and out to the right" for elbow placement. */
  right: THREE.Vector3;
}

/**
 * Advance one figure: blend idle, walk and run by gait (0 still, 1 walk, 2 run), then put the
 * hands on the weapon with IK. Elbows hang down and out, as when holding a rifle.
 */
export function driveHuman(h: Human, o: { gait: number; dt: number; dead: boolean; hold?: Hold | (() => Hold); throwArm?: number }) {
  const want: [number, number, number] = o.dead ? [1, 0, 0] : o.gait === 0 ? [1, 0, 0] : o.gait === 1 ? [0, 1, 0] : [0, 0, 1];
  const k = Math.min(1, o.dt * 8);
  for (let i = 0; i < 3; i++) h.weights[i] = h.weights[i]! + (want[i]! - h.weights[i]!) * k;
  h.idle.setEffectiveWeight(h.weights[0]); h.walk.setEffectiveWeight(h.weights[1]); h.run.setEffectiveWeight(h.weights[2]);
  // A crouched, careful walk plays slower than the clip.
  h.walk.timeScale = 0.8;
  h.run.timeScale = 1.05;
  h.mixer.update(o.dt);
  if (o.dead || !o.hold) return;
  h.root.updateMatrixWorld(true);
  const b = h.bones;
  const down = new THREE.Vector3(0, -1, 0);
  const { grip, guard, right } = typeof o.hold === 'function' ? o.hold() : o.hold;
  if (grip) twoBoneIK(b.armR, b.foreR, b.handR, grip, down.clone().addScaledVector(right, 0.8));
  if (guard) twoBoneIK(b.armL, b.foreL, b.handL, guard, down.clone().addScaledVector(right, -0.5));
  if (!grip && o.throwArm) {
    // Grenade: the right arm swings with the procedural throw.
    b.armR.rotateX(-o.throwArm * 0.8);
  }
}

/**
 * World matrix of something carried rigidly by one of the figure's bones (a rifle on the chest),
 * placed by `local` in the operator's bind space (metres, feet at y = 0, facing -z, right hand at
 * +x). Call it after the figure has been posed for the frame.
 */
export function carryMatrix(h: Human, bone: string, local: THREE.Matrix4, out = new THREE.Matrix4()): THREE.Matrix4 {
  const mesh = h.meshes[0]!, sk = mesh.skeleton;
  const i = Math.max(0, sk.bones.findIndex((b) => b.name === `mixamorig${bone}`));
  return out.multiplyMatrices(sk.bones[i]!.matrixWorld, sk.boneInverses[i]!).multiply(mesh.bindMatrix).multiply(local);
}
