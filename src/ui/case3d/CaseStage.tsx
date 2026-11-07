/**
 * The live 3D case for the opening screen: the case floats over a lit pedestal in a cone of
 * light, turns slowly and can be spun by dragging. On unlock it plays the opening: both latches
 * flip, the case rattles while light leaks from the seam, the lid bursts open and a beam of
 * light pours out, then the camera pushes into the light and the strip takes over.
 *
 * The canvas covers the whole opening screen behind the interface; the case is framed onto
 * whichever element carries data-case-anchor, so it glides from the inspect column to the
 * centre of the screen when the opening starts. The drop is decided before any of this plays.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CaseId } from '../../engine/cases';
import type { Role } from '../../engine/types';
import { BODY_H, buildCase } from './caseModel';
import type { CaseRig } from './caseModel';
import { RayBurst, shaftMaterial } from './fx';
import { fontsReady, glowTexture, ringTexture, shadowTexture } from './textures';

export type CaseBeat = 'latch0' | 'latch1' | 'burst' | 'flash' | 'done';

/** Milliseconds from Unlock to each beat of the opening. */
export const OPEN_TIMELINE = { latch0: 240, latch1: 420, rattle: 520, burst: 1000, flash: 1650, done: 1900 } as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutBack = (t: number, k = 1.9) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
/** A damped spring from 0 to 1 with one overshoot, for the lid. */
const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(9 * t));

/** Desktop-class GPU budget: shadows, higher pixel ratio and more geometry. */
function highQuality(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return false;
  return window.innerWidth >= 900;
}

class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(27, 1, 0.1, 60);
  private target = new THREE.Vector3(0, 0.42, 0);
  private rig: CaseRig;
  private holder = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private sparkVel: Float32Array;
  private halo: THREE.Sprite;
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private core: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private rays: RayBurst;
  private shock: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private cone: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>;
  private ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private floorGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private blob: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private key: THREE.SpotLight;
  private raf = 0;
  private last = 0;
  private t = 0;
  private size = { w: 1, h: 1 };
  private framing = { x: 0, y: 0, zoom: 1, ready: false };
  private yaw = -0.42;
  private yawVel = 0;
  private drag: { x: number; t: number } | null = null;
  private idleSince = 0;
  /** Milliseconds of opening played so far; null until Unlock. Advances by frame time (max 50 ms a frame), so a slow frame never skips a beat. */
  openAt: number | null = null;
  /** Development only: holds the opening clock still so a test can step through the beats. */
  frozen = false;
  private fired = new Set<CaseBeat>();
  onBeat: (b: CaseBeat) => void = () => {};
  anchor: () => HTMLElement | null = () => null;

  constructor(private canvas: HTMLCanvasElement, caseId: CaseId, role: Role | undefined, hq: boolean) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = hq;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hq ? 1.75 : 2));
    this.renderer = r;
    const keep = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };

    const pmrem = new THREE.PMREMGenerator(r);
    const env = keep(pmrem.fromScene(new RoomEnvironment(r), 0.04).texture);
    pmrem.dispose();
    this.scene.environment = env;

    // ---- the case ----
    this.rig = buildCase(caseId, role, hq ? 'high' : 'low');
    this.rig.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.85;
    });
    this.holder.add(this.rig.root);
    this.scene.add(this.holder);
    const accent = this.rig.accent;

    // ---- lights ----
    const key = new THREE.SpotLight('#fff1dc', 95, 0, 0.42, 0.65, 2);
    key.position.set(1.4, 6.2, 2.6);
    key.target.position.set(0, 0.3, 0);
    key.castShadow = hq;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    this.key = key;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(accent, 2.2);
    rim.position.set(-3.5, 2.6, -4);
    const rim2 = new THREE.DirectionalLight('#9fc4ff', 0.9);
    rim2.position.set(4, 1.5, -3);
    const front = new THREE.DirectionalLight('#ffffff', 0.55);
    front.position.set(0, 1.2, 6);
    this.scene.add(rim, rim2, front, new THREE.HemisphereLight('#b9c8e8', '#07090c', 0.35));

    // ---- pedestal ----
    const ped = new THREE.Group();
    const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.62, 1.78, 0.34, hq ? 96 : 48)), keep(new THREE.MeshStandardMaterial({ color: '#151a21', metalness: 0.75, roughness: 0.38 })));
    base.position.y = -0.17;
    base.receiveShadow = true;
    const top = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.56, 1.56, 0.02, hq ? 96 : 48)), keep(new THREE.MeshPhysicalMaterial({ color: '#0b0f14', metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 })));
    top.position.y = 0.001;
    top.receiveShadow = true;
    this.ring = new THREE.Mesh(keep(new THREE.TorusGeometry(1.585, 0.018, 8, hq ? 160 : 96)), keep(new THREE.MeshBasicMaterial({ color: accent, toneMapped: false })));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    const inner = new THREE.Mesh(keep(new THREE.TorusGeometry(1.2, 0.006, 6, 96)), keep(new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, toneMapped: false })));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.013;
    const lower = new THREE.Mesh(keep(new THREE.TorusGeometry(1.74, 0.01, 6, 128)), keep(new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, toneMapped: false })));
    lower.rotation.x = -Math.PI / 2;
    lower.position.y = -0.3;
    ped.add(base, top, this.ring, inner, lower);
    this.scene.add(ped);
    const ringMap = keep(ringTexture());
    this.floorGlow = new THREE.Mesh(keep(new THREE.PlaneGeometry(6.4, 6.4)), keep(new THREE.MeshBasicMaterial({ map: ringMap, color: accent, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.y = -0.33;
    this.scene.add(this.floorGlow);
    const shadowMap = keep(shadowTexture());
    this.blob = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.9, 2.1)), keep(new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, opacity: 0.75, depthWrite: false })));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.014;
    this.scene.add(this.blob);

    // ---- light cone and dust ----
    this.cone = new THREE.Mesh(keep(new THREE.ConeGeometry(1.85, 6, 48, 1, true)), keep(shaftMaterial(new THREE.Color('#fff4e0').lerp(accent, 0.25), 'tip', 1.3)));
    this.cone.material.uniforms.uOpacity!.value = 0.2;
    this.cone.position.y = 2.75;
    this.scene.add(this.cone);
    const glowMap = keep(glowTexture());
    const N = hq ? 160 : 90;
    const dpos = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 1.7;
      dpos[i * 3] = Math.cos(a) * rr; dpos[i * 3 + 1] = Math.random() * 4.2; dpos[i * 3 + 2] = Math.sin(a) * rr;
      this.dustVel[i] = 0.05 + Math.random() * 0.12;
    }
    const dgeo = keep(new THREE.BufferGeometry());
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(dgeo, keep(new THREE.PointsMaterial({ map: glowMap, color: '#fff2dc', size: 0.045, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.scene.add(this.dust);

    // ---- the burst: halo, beam and sparks ----
    this.halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowMap, color: new THREE.Color('#ffffff').lerp(accent, 0.45), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.halo.position.set(0, BODY_H + 0.35, 0);
    this.halo.scale.setScalar(0.01);
    this.holder.add(this.halo);
    // The beam pours up out of the case: a wide soft shaft and a hot narrow core, both grown
    // from the base. Their geometry starts at y = 0 so scaling y raises them out of the case.
    const beamGeo = keep(new THREE.CylinderGeometry(1.2, 0.62, 6.5, 48, 1, true));
    beamGeo.translate(0, 3.25, 0);
    this.beam = new THREE.Mesh(beamGeo, keep(shaftMaterial(new THREE.Color('#ffffff').lerp(accent, 0.45), 'base', 1.6)));
    this.beam.position.set(0, BODY_H - 0.05, 0);
    this.beam.scale.set(1, 0.001, 1);
    this.beam.renderOrder = 3;
    this.holder.add(this.beam);
    const coreGeo = keep(new THREE.CylinderGeometry(0.55, 0.32, 5, 32, 1, true));
    coreGeo.translate(0, 2.5, 0);
    this.core = new THREE.Mesh(coreGeo, keep(shaftMaterial(new THREE.Color('#ffffff').lerp(accent, 0.15), 'base', 2.4)));
    this.core.position.copy(this.beam.position);
    this.core.scale.set(1, 0.001, 1);
    this.core.renderOrder = 4;
    this.holder.add(this.core);
    this.rays = new RayBurst(new THREE.Color('#ffffff').lerp(accent, 0.55), hq ? 13 : 9);
    this.disposables.push(this.rays);
    this.scene.add(this.rays.group);
    // A ring of light that runs out across the pedestal when the lid bursts.
    this.shock = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.2, 3.2)), keep(new THREE.MeshBasicMaterial({ map: ringMap, color: new THREE.Color('#ffffff').lerp(accent, 0.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.03;
    this.scene.add(this.shock);
    const S = hq ? 140 : 80;
    const spos = new Float32Array(S * 3);
    const scol = new Float32Array(S * 3);
    this.sparkVel = new Float32Array(S * 3);
    const palette = [new THREE.Color('#ffffff'), accent.clone(), new THREE.Color('#ffd27a')];
    for (let i = 0; i < S; i++) {
      const c = palette[i % 3]!;
      scol[i * 3] = c.r; scol[i * 3 + 1] = c.g; scol[i * 3 + 2] = c.b;
      spos[i * 3 + 1] = -50; // parked out of sight until the burst
    }
    const sgeo = keep(new THREE.BufferGeometry());
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    sgeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
    this.sparks = new THREE.Points(sgeo, keep(new THREE.PointsMaterial({ map: glowMap, size: 0.09, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.holder.add(this.sparks);

    this.camera.position.set(0, 2.25, 6.6);
    this.camera.lookAt(this.target);
  }

  resize(w: number, h: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    this.camera.updateProjectionMatrix();
  }

  /** Called if a frame throws: the caller falls back to the drawn case. */
  onError: () => void = () => {};

  start() {
    const loop = (now: number) => {
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
      this.last = now;
      try {
        this.frame(dt);
      } catch {
        this.onError();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  open() {
    if (this.openAt !== null) return;
    this.openAt = 0;
    this.drag = null;
  }

  pointerDown(x: number) { if (this.openAt === null) { this.drag = { x, t: performance.now() }; this.yawVel = 0; } }
  pointerMove(x: number) {
    if (!this.drag) return;
    const now = performance.now();
    const d = (x - this.drag.x) * 0.012;
    this.yaw += d;
    this.yawVel = d / Math.max(0.008, (now - this.drag.t) / 1000);
    this.drag = { x, t: now };
  }
  pointerUp() { if (this.drag) { this.drag = null; this.idleSince = this.t; } }

  /** Frames the composition onto the anchor element: offset the view so the case sits at its centre, zoom so it fits. */
  private updateFraming(dt: number, push: number) {
    const el = this.anchor();
    const rect = this.canvas.getBoundingClientRect();
    let cx = rect.width / 2, cy = rect.height / 2, aw = rect.width * 0.6, ah = rect.height * 0.6;
    if (el) {
      const a = el.getBoundingClientRect();
      if (a.width > 0 && a.height > 0) { cx = a.left + a.width / 2 - rect.left; cy = a.top + a.height / 2 - rect.top; aw = a.width; ah = a.height; }
    }
    const dist = this.camera.position.distanceTo(this.target);
    const pxPerUnit = rect.height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    // The case on its pedestal spans about 3.9 x 2.7 units on screen.
    const zoom = Math.max(0.2, Math.min(aw / 3.9, ah / 2.7) / pxPerUnit) * push;
    const tx = rect.width / 2 - cx, ty = rect.height / 2 - cy;
    const f = this.framing;
    if (!f.ready) { f.x = tx; f.y = ty; f.zoom = zoom; f.ready = true; }
    else {
      const k = 1 - Math.exp(-dt * (this.openAt !== null ? 4.5 : 9));
      f.x += (tx - f.x) * k; f.y += (ty - f.y) * k; f.zoom += (zoom - f.zoom) * k;
    }
    this.camera.zoom = f.zoom;
    this.camera.setViewOffset(this.size.w, this.size.h, f.x * (this.size.w / rect.width), f.y * (this.size.h / rect.height), this.size.w, this.size.h);
  }

  private beat(b: CaseBeat) {
    if (this.fired.has(b)) return;
    this.fired.add(b);
    this.onBeat(b);
  }

  private frame(dt: number) {
    this.t += dt;
    const t = this.t;
    if (this.openAt !== null && !this.frozen) this.openAt += dt * 1000;
    const e = this.openAt === null ? -1 : this.openAt;
    const T = OPEN_TIMELINE;
    const rig = this.rig;

    // ---- yaw: auto sway, drag with inertia, or turned to face the camera for the opening ----
    if (e >= 0) {
      this.yaw += (-0.3 - this.yaw) * (1 - Math.exp(-dt * 7));
    } else if (!this.drag) {
      this.yawVel *= Math.exp(-dt * 2.6);
      this.yaw += this.yawVel * dt;
      if (t - this.idleSince > 1.6 && Math.abs(this.yawVel) < 0.05) {
        const want = -0.42 + Math.sin(t * 0.33) * 0.5;
        // Unwind full turns so the sway resumes from the nearest angle.
        while (this.yaw - want > Math.PI) this.yaw -= Math.PI * 2;
        while (want - this.yaw > Math.PI) this.yaw += Math.PI * 2;
        this.yaw += (want - this.yaw) * (1 - Math.exp(-dt * 0.9));
      }
    }

    // ---- float, rattle and the push-in ----
    const settle = e >= 0 ? smooth(0, 300, e) : 0;
    const bob = (1 - settle) * Math.sin(t * 1.15) * 0.04;
    const rattle = e >= 0 ? smooth(T.rattle, T.burst, e) * (e < T.burst ? 1 : Math.max(0, 1 - (e - T.burst) / 180)) : 0;
    const jx = rattle ? (Math.random() - 0.5) * 0.05 * rattle : 0;
    const jz = rattle ? (Math.random() - 0.5) * 0.05 * rattle : 0;
    this.holder.position.y = 0.18 + bob + (e >= 0 ? smooth(0, 400, e) * 0.06 : 0);
    this.holder.rotation.set(jx + (1 - settle) * Math.sin(t * 0.7) * 0.02, this.yaw, jz);
    this.blob.material.opacity = 0.78 - bob * 4;
    this.blob.scale.setScalar(1 - bob * 1.2);

    // ---- latches ----
    if (e >= 0) {
      const l0 = clamp01((e - T.latch0) / 170), l1 = clamp01((e - T.latch1) / 170);
      rig.latches[0]!.rotation.x = easeOutBack(l0) * 2.25 * (l0 > 0 ? 1 : 0);
      rig.latches[1]!.rotation.x = easeOutBack(l1) * 2.25 * (l1 > 0 ? 1 : 0);
      if (e >= T.latch0) this.beat('latch0');
      if (e >= T.latch1) this.beat('latch1');
    }

    // ---- light leaking, then the lid ----
    const leak = e >= 0 ? smooth(T.rattle - 80, T.burst, e) : 0;
    const lidT = e >= T.burst ? (e - T.burst) / 620 : 0;
    const lid = e >= T.burst ? spring(lidT) : 0;
    rig.lid.rotation.x = -lid * 1.92 - leak * 0.04;
    rig.seam.material.opacity = Math.min(1, leak * 1.4) * (1 - smooth(T.burst, T.burst + 400, e));
    const burstK = e >= T.burst ? Math.exp(-(e - T.burst) / 380) : 0;
    rig.inner.intensity = leak * 6 + (e >= T.burst ? 26 + burstK * 90 : 0);
    rig.slot.material.opacity = e >= T.burst ? Math.min(1, (e - T.burst) / 160) : leak * 0.3;
    if (e >= T.burst) this.beat('burst');

    // ---- burst effects ----
    if (e >= T.burst) {
      const b = (e - T.burst) / 1000;
      this.halo.material.opacity = Math.min(1, b * 8) * (0.32 + burstK * 0.4);
      this.halo.scale.setScalar(1.2 + Math.min(1, b * 2.5) * 2.6 + burstK * 1.4);
      const grow = smooth(0, 0.4, b);
      this.beam.material.uniforms.uOpacity!.value = Math.min(1, b * 4) * (0.42 + burstK * 0.4);
      this.beam.scale.set(0.8 + grow * 0.3, Math.max(0.001, grow), 0.8 + grow * 0.3);
      this.core.material.uniforms.uOpacity!.value = Math.min(1, b * 6) * (0.5 + burstK * 0.5);
      this.core.scale.set(1, Math.max(0.001, smooth(0, 0.3, b)), 1);
      this.rays.group.position.set(this.holder.position.x, this.holder.position.y + BODY_H + 0.05, this.holder.position.z - 0.25);
      this.rays.update(smooth(0, 0.3, b) * (0.6 + burstK * 0.45), t, this.camera);
      const sw = clamp01(b / 0.65);
      this.shock.scale.setScalar(0.6 + sw * 2.2);
      this.shock.material.opacity = (1 - sw) * (1 - sw) * 0.95;
      this.renderer.toneMappingExposure = 1.05 + smooth(0, 0.8, b) * 0.3 + burstK * 0.25;
      this.key.intensity = 95 * (1 - smooth(0.1, 0.7, b) * 0.4);
      this.updateSparks(dt, e - T.burst < 20);
      this.sparks.material.opacity = 1 - smooth(0.6, 1.1, b);
    }
    if (e >= T.flash) this.beat('flash');
    if (e >= T.done) this.beat('done');

    // ---- ambience ----
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.dustVel.length; i++) {
      let y = pos.getY(i) + this.dustVel[i]! * dt;
      if (y > 4.2) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.6 + i) * 0.0009);
    }
    pos.needsUpdate = true;
    const pulse = 0.82 + Math.sin(t * 2.1) * 0.08 + (e >= T.burst ? burstK * 0.8 : leak * 0.4);
    this.ring.material.color.copy(rig.accent).multiplyScalar(1.6 * pulse);
    this.floorGlow.material.opacity = 0.45 + pulse * 0.15;
    this.cone.material.uniforms.uOpacity!.value = 0.2 + (e >= T.burst ? 0.12 : leak * 0.06);

    // Camera: the push into the light after the burst.
    const push = 1 + (e >= T.burst ? smooth(T.burst, T.done, e) * 0.55 : 0);
    this.updateFraming(dt, push);
    if (e >= T.burst) {
      const k = smooth(T.burst, T.done, e);
      // A short kick as the lid bursts, then the push into the light.
      const kick = Math.max(0, 1 - (e - T.burst) / 260) * 0.05;
      this.camera.position.set((Math.random() - 0.5) * kick, 2.25 - k * 0.5 + (Math.random() - 0.5) * kick, 6.6 - k * 0.8);
      this.target.set(0, 0.42 + k * 0.4, 0);
      this.camera.lookAt(this.target);
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSparks(dt: number, spawn: boolean) {
    const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = this.sparkVel;
    const n = pos.count;
    if (spawn) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 2.2;
        pos.setXYZ(i, (Math.random() - 0.5) * 1.1, BODY_H + 0.1, (Math.random() - 0.5) * 0.6);
        v[i * 3] = Math.cos(a) * sp * 0.6; v[i * 3 + 1] = 2.2 + Math.random() * 3.6; v[i * 3 + 2] = Math.sin(a) * sp * 0.6;
      }
    }
    for (let i = 0; i < n; i++) {
      v[i * 3 + 1] = v[i * 3 + 1]! - 4.2 * dt;
      pos.setXYZ(i, pos.getX(i) + v[i * 3]! * dt, pos.getY(i) + v[i * 3 + 1]! * dt, pos.getZ(i) + v[i * 3 + 2]! * dt);
    }
    pos.needsUpdate = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.rig.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}

export function CaseStage3D({ caseId, role, opening, anchor, onBeat, onFail }: {
  caseId: CaseId;
  role?: Role;
  /** Set to true to play the opening; it cannot be undone. */
  opening: boolean;
  /** The element to frame the case on; looked up every frame, so it can change between stages. */
  anchor: () => HTMLElement | null;
  onBeat?: (b: CaseBeat) => void;
  /** WebGL is missing or the context was lost: the caller shows the drawn case instead. */
  onFail: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const beatRef = useRef(onBeat);
  beatRef.current = onBeat;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const openingRef = useRef(opening);
  openingRef.current = opening;

  useEffect(() => {
    let stage: Stage | null = null;
    let alive = true;
    let ro: ResizeObserver | null = null;
    const host = hostRef.current!, canvas = canvasRef.current!;
    const lost = (ev: Event) => { ev.preventDefault(); failRef.current(); };
    canvas.addEventListener('webglcontextlost', lost);
    void fontsReady().then(() => {
      if (!alive) return;
      try {
        stage = new Stage(canvas, caseId, role, highQuality());
      } catch {
        failRef.current();
        return;
      }
      stageRef.current = stage;
      stage.onBeat = (b) => beatRef.current?.(b);
      stage.onError = () => failRef.current();
      stage.anchor = () => anchorRef.current();
      if (import.meta.env.DEV) (window as unknown as { __case3d?: Stage }).__case3d = stage;
      const fit = () => { const r = host.getBoundingClientRect(); stage?.resize(r.width, r.height); };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(host);
      stage.start();
      if (openingRef.current) stage.open();
      host.classList.add('ready');
    });
    // Drag anywhere on the anchor to spin the case.
    const root = host.parentElement;
    const down = (e: PointerEvent) => {
      const a = (e.target as Element | null)?.closest?.('[data-case-anchor]');
      if (!a || !stageRef.current) return;
      stageRef.current.pointerDown(e.clientX);
    };
    const move = (e: PointerEvent) => stageRef.current?.pointerMove(e.clientX);
    const up = () => stageRef.current?.pointerUp();
    root?.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      alive = false;
      ro?.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
      root?.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stage?.dispose();
      stageRef.current = null;
    };
  }, [caseId, role]);

  useEffect(() => { if (opening) stageRef.current?.open(); }, [opening]);

  return <div className="co3d" ref={hostRef} aria-hidden="true"><canvas ref={canvasRef} /></div>;
}
