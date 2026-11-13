/**
 * A hard-shell weapon case built from primitives: moulded body and lid with belt ridges, rubber
 * corner guards, two flip latches, a carry handle, back hinges, a printed lid label, painted
 * stencils and an inside of egg-crate foam with a slot that glows when the lid opens.
 * Original design; no game assets. The origin is the centre of the bottom face.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CaseId } from '../../engine/cases';
import type { Role } from '../../engine/types';
import { CASE_LOOK, foamTexture, glowTexture, labelTexture, plateTexture, stencilTexture, stippleTexture } from './textures';

export const CASE_W = 2.0;
export const CASE_D = 1.3;
export const BODY_H = 0.5;
export const LID_H = 0.23;
export const CASE_H = BODY_H + LID_H;

export interface CaseRig {
  root: THREE.Group;
  /** Pivots on the back hinge; a negative rotation.x opens it. */
  lid: THREE.Group;
  /** Pivot at the bottom of each lever; a positive rotation.x flips it open. */
  latches: THREE.Group[];
  /** The light leaking through the seam, 0..1 via its material opacity. */
  seam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The slot inside, white-hot when open. */
  slot: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Light from inside the case. */
  inner: THREE.PointLight;
  accent: THREE.Color;
  dispose(): void;
}

function rbox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
}

export function buildCase(id: CaseId, role?: Role, quality: 'high' | 'low' = 'high'): CaseRig {
  const look = CASE_LOOK[id];
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const seg = quality === 'high' ? 4 : 2;

  // ---------- materials ----------
  const stipple = keep(stippleTexture());
  const shell = keep(new THREE.MeshPhysicalMaterial({
    color: look.shell, roughness: 0.4, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.26,
    bumpMap: stipple, bumpScale: 0.9, roughnessMap: stipple,
    ...(look.gold ? { iridescence: 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520] as [number, number], sheen: 0.4, sheenColor: new THREE.Color('#f4c8ff') } : {}),
  }));
  const deep = keep(new THREE.MeshPhysicalMaterial({ color: look.deep, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4, bumpMap: stipple, bumpScale: 0.6 }));
  const rubber = keep(new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.82, metalness: 0.05 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#c7ccd3', roughness: 0.26, metalness: 1 }));
  const gold = keep(new THREE.MeshStandardMaterial({ color: '#e1b24a', roughness: 0.22, metalness: 1 }));
  const trim = look.gold ? gold : rubber;
  const metal = look.gold ? gold : steel;

  const root = new THREE.Group();
  root.name = `case-${id}`;
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    keep(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const W = CASE_W, D = CASE_D, HB = BODY_H, HL = LID_H;

  // ---------- body ----------
  const body = new THREE.Group();
  root.add(body);
  add(body, rbox(W, HB, D, 0.09, seg), shell, 0, HB / 2, 0);
  // Belt ridges wrap the body; the lower one doubles as a bumper.
  add(body, rbox(W + 0.05, 0.075, D + 0.05, 0.035, 2), deep, 0, 0.13, 0);
  add(body, rbox(W + 0.04, 0.06, D + 0.04, 0.028, 2), deep, 0, HB - 0.15, 0);
  // Corner guards.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(body, rbox(0.2, HB - 0.03, 0.2, 0.06, 2), trim, sx * (W / 2 - 0.055), (HB - 0.03) / 2 + 0.005, sz * (D / 2 - 0.055));
  }
  // Feet.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(body, rbox(0.26, 0.04, 0.2, 0.015, 1), rubber, sx * (W / 2 - 0.32), -0.012, sz * (D / 2 - 0.24), false);
  // Back hinges.
  for (const sx of [-1, 1]) {
    const hinge = add(body, keep(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 16)), metal, sx * 0.58, HB, -D / 2 - 0.035);
    hinge.rotation.z = Math.PI / 2;
  }
  // Handle on the front: two mounts and a rubber grip folded down.
  for (const sx of [-1, 1]) add(body, rbox(0.11, 0.12, 0.1, 0.03, 2), metal, sx * 0.3, HB - 0.12, D / 2 + 0.03);
  const grip = add(body, keep(new THREE.CapsuleGeometry(0.048, 0.5, 6, 16)), rubber, 0, HB - 0.27, D / 2 + 0.1);
  grip.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const arm = add(body, rbox(0.05, 0.17, 0.05, 0.02, 1), metal, sx * 0.3, HB - 0.2, D / 2 + 0.085);
    arm.rotation.x = -0.35;
  }
  // Serial plate under the handle.
  const plateMap = keep(plateTexture(id));
  const plate = add(body, keep(new THREE.PlaneGeometry(0.46, 0.115)), keep(new THREE.MeshStandardMaterial({ map: plateMap, roughness: 0.35, metalness: 0.75 })), 0, 0.22, D / 2 + 0.003, false);
  plate.receiveShadow = true;
  // Stencils on both sides.
  const stencilMap = keep(stencilTexture(id));
  const stencilMat = keep(new THREE.MeshStandardMaterial({ map: stencilMap, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const sx of [-1, 1]) {
    const s = add(body, keep(new THREE.PlaneGeometry(D - 0.42, (D - 0.42) / 4)), stencilMat, sx * (W / 2 + 0.002), HB / 2 - 0.02, 0, false);
    s.rotation.y = sx * Math.PI / 2;
  }
  // Inside: foam and the glowing slot (on top of the body, hidden while the lid is shut).
  const foamMap = keep(foamTexture());
  const foam = add(body, keep(new THREE.PlaneGeometry(W - 0.2, D - 0.2)), keep(new THREE.MeshStandardMaterial({ map: foamMap, roughness: 1 })), 0, HB + 0.004, 0, false);
  foam.rotation.x = -Math.PI / 2;
  const glowMap = keep(glowTexture(0.35));
  const slot = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 0.62, D * 0.5)), keep(new THREE.MeshBasicMaterial({ map: glowMap, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
  slot.rotation.x = -Math.PI / 2;
  slot.position.set(0, HB + 0.01, 0);
  body.add(slot);
  // The seam: a thin band of light between body and lid, visible in the groove.
  const seam = new THREE.Mesh(keep(rbox(W - 0.03, 0.035, D - 0.03, 0.012, 1)), keep(new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
  seam.position.y = HB;
  body.add(seam);
  const inner = new THREE.PointLight(look.accent, 0, 6, 2);
  inner.position.set(0, HB + 0.25, 0.1);
  body.add(inner);

  // ---------- latches ----------
  const latches: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    add(body, rbox(0.3, 0.12, 0.06, 0.02, 2), metal, sx * 0.66, HB - 0.11, D / 2 + 0.02);
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.66, HB - 0.16, D / 2 + 0.06);
    body.add(pivot);
    add(pivot, rbox(0.25, 0.3, 0.045, 0.02, 2), metal, 0, 0.15, 0);
    // A coloured insert on each lever, so the latches read from a distance.
    add(pivot, rbox(0.15, 0.1, 0.02, 0.008, 1), keep(new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.4, emissive: look.accent, emissiveIntensity: 0.25 })), 0, 0.2, 0.025, false);
    latches.push(pivot);
  }

  // ---------- lid ----------
  const lid = new THREE.Group();
  lid.position.set(0, HB, -D / 2);
  root.add(lid);
  add(lid, rbox(W, HL, D, 0.09, seg), shell, 0, HL / 2, D / 2);
  add(lid, rbox(W + 0.04, 0.055, D + 0.04, 0.026, 2), deep, 0, 0.07, D / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(lid, rbox(0.2, HL - 0.03, 0.2, 0.06, 2), trim, sx * (W / 2 - 0.055), (HL - 0.03) / 2 + 0.01, D / 2 + sz * (D / 2 - 0.055));
  // Two raised ribs run front to back on the top; the label sits between them.
  for (const sx of [-1, 1]) add(lid, rbox(0.14, 0.05, D - 0.26, 0.02, 2), deep, sx * (W / 2 - 0.24), HL + 0.012, D / 2);
  // Keepers the latches hook onto.
  for (const sx of [-1, 1]) add(lid, rbox(0.24, 0.06, 0.05, 0.015, 1), metal, sx * 0.66, 0.1, D + 0.02);
  // The printed label.
  const labelMap = keep(labelTexture(id, role));
  const label = add(lid, keep(new THREE.PlaneGeometry(W - 0.66, (W - 0.66) / 1.55)), keep(new THREE.MeshPhysicalMaterial({ map: labelMap, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.15, polygonOffset: true, polygonOffsetFactor: -2 })), 0, HL + 0.003, D / 2, false);
  label.rotation.x = -Math.PI / 2;
  label.receiveShadow = true;
  // Foam on the underside of the lid, seen when it opens.
  const lidFoam = add(lid, keep(new THREE.PlaneGeometry(W - 0.2, D - 0.2)), keep(new THREE.MeshStandardMaterial({ map: foamMap, roughness: 1 })), 0, -0.004, D / 2, false);
  lidFoam.rotation.x = Math.PI / 2;

  return {
    root, lid, latches, seam, slot, inner,
    accent: new THREE.Color(look.accent),
    dispose: () => { for (const d of disposables) d.dispose(); },
  };
}
