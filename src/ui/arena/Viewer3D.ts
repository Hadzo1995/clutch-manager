/**
 * Real-time 3D round viewer (three.js).
 *
 * Rendering only: the map comes from MapGeometry, and everything that moves
 * comes from a RoundTimeline sampled at time t. The renderer keeps no game
 * state of its own, so scrubbing, pausing and replays are just "render(t)".
 *
 * Camera: top-down or isometric, wheel/pinch zoom, drag to pan, right-drag or
 * two-finger twist to rotate, double-click to reset, click a player to follow.
 */
import * as THREE from 'three';
import type { MapGeometry } from '../../maps/types';
import { CELL, HEIGHT_UNIT, WALL_HEIGHT } from '../../maps/types';
import { FLASH_POP_H, flightAt } from '../../engine/sim/flight';
import { buildEnvironment, mapStyle, skyDome, type MapStyle } from './environment';
import { BOMB_SECONDS, HEAR_RUN, PLANT_SECONDS, WALK_RING, aimAt, blindAmount, bombAt, hpAt, isMoving, isSpotted, paceAt, posAt, weaponAt } from './timeline';
import { activeSmokes, visionFan } from './vision';
import { floorStyle, releaseSurfaces, surfaces, worldMaterial } from './materials';
import type { SurfaceSet } from './materials';
import { buildProps } from './props';
import type { PropAnim } from './props';
import { CARRY, buildSoldier, gunClassOf, poseSoldier, setDead, setGun, soldierKit } from './models';
import type { Gait } from './models';
import type { Soldier, SoldierKit } from './models';
import type { PlayerTrack, RoundTimeline, UtilityObject, Vec } from './timeline';

export type CameraMode = 'overview' | 'follow' | 'free';
export type Tilt = 'top' | 'iso';

export interface ViewerColors { t: string; ct: string }

export interface ViewerEvents {
  onPick?: (playerId: string | null) => void;
  onCameraMode?: (mode: CameraMode) => void;
  onContextLost?: () => void;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A lumpy sphere for smoke puffs: reads as a cloud rather than a ball. */
function cloudGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 4.1 + v.y * 2.3) * Math.cos(v.z * 3.7 - v.y * 1.9) * 0.09 + Math.sin(v.x * 9.3 + v.z * 7.1) * 0.035;
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

interface Rig {
  track: PlayerTrack;
  /** Last shot fired (for recoil) and this player's grenade throws. */
  lastShot: number;
  throws: number[];
  root: THREE.Group;
  body: THREE.Group;
  soldier: Soldier;
  isDead: boolean;
  helmet: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  ring: THREE.Mesh;
  hpArc: THREE.Mesh;
  glow: THREE.Sprite;
  label: THREE.Sprite;
  dot: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  labelKey: string;
  mat: THREE.MeshStandardMaterial;
  phase: number;
  cone: THREE.Mesh;
  conePos: Float32Array;
  /** Pace ring: a faint disc (small for a walker, 20 m for a runner) and ripples travelling out. */
  soundDisc: THREE.Mesh;
  ripples: THREE.Mesh[];
  /** This player's shot times (sorted), for the aiming pose. */
  shotTimes: number[];
  /** Animation state: stride phase, last round time seen, and the eased aim and carry poses. */
  stride: number;
  lastT: number;
  aim: number;
  carry: number;
}

interface UtilRig {
  u: UtilityObject; group: THREE.Group; proj: THREE.Mesh; projGlow: THREE.Sprite; parts: THREE.Object3D[]; ring: THREE.Mesh;
  /** Flight trail: sampled points of the simulated arc, revealed up to the grenade. */
  trail: THREE.Points; trailLine: THREE.Line; trailT: Float32Array; origin: THREE.Mesh;
  smoke?: { points: THREE.Points; base: Float32Array; size: Float32Array; seed: Float32Array };
}
const TRAIL_N = 48;
const SMOKE_N = 38;

/** Soft, lumpy cloud sprite for smoke particles (alpha in the texture). */
function puffTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    let a = 7;
    const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * Math.PI * 2, r = rnd() * 30;
      const x = 64 + Math.cos(ang) * r, y = 64 + Math.sin(ang) * r, rr = 18 + rnd() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      const l = Math.round(200 + rnd() * 55);
      gr.addColorStop(0, `rgba(${l},${l},${l},0.32)`); gr.addColorStop(1, `rgba(${l},${l},${l},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  });
}

export class Viewer3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.5, 3000);
  private style!: MapStyle;
  private geo: MapGeometry;
  private colors: { t: THREE.Color; ct: THREE.Color };
  private mapGroup = new THREE.Group();
  private dynGroup = new THREE.Group();
  private rigs: Rig[] = [];
  private kit!: SoldierKit;
  private surf: SurfaceSet = surfaces();
  private anims: PropAnim[] = [];
  private rigById = new Map<string, Rig>();
  private utils: UtilRig[] = [];
  private tl: RoundTimeline | null = null;
  private disposables: { dispose(): void }[] = [];
  private ro: ResizeObserver;
  private events: ViewerEvents;

  // Shared resources
  private shared!: {
    ring: THREE.RingGeometry; dead: THREE.MeshStandardMaterial; ripple: THREE.RingGeometry; soundDisc: THREE.CircleGeometry;
    smokeGeo: THREE.BufferGeometry; smokeMat: THREE.MeshStandardMaterial; puffTex: THREE.CanvasTexture; smokePts: THREE.ShaderMaterial; trailTex: THREE.CanvasTexture; flareTex: THREE.CanvasTexture; projGeo: THREE.SphereGeometry; disc: THREE.CircleGeometry;
    flameGeo: THREE.ConeGeometry; glowTex: THREE.CanvasTexture; soundTex: THREE.CanvasTexture; fireTex: THREE.CanvasTexture; flashTex: THREE.CanvasTexture; dotTex: THREE.CanvasTexture;
  };

  // Effects
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(96 * 6);
  private tracerCol = new Float32Array(96 * 6);
  private tracers: THREE.LineSegments;
  private muzzles: THREE.Sprite[] = [];
  private bomb: THREE.Group;
  private bombLed: THREE.MeshBasicMaterial;
  private bombRing: THREE.Mesh;
  private bombRingMat: THREE.MeshBasicMaterial;
  private blast: THREE.Mesh;
  /** A soft light column over a planted bomb, so it reads from the overview. */
  private beacon: THREE.Mesh;
  private followRing: THREE.Mesh;
  private leaderPos = new Float32Array(16 * 6);
  private leaderCol = new Float32Array(16 * 6);
  private leaders: THREE.LineSegments;

  // Camera state
  mode: CameraMode = 'overview';
  tilt: Tilt = 'iso';
  followId: string | null = null;
  private target = new THREE.Vector3();
  private dist = 80;
  private yaw = 0;
  private pitch = 0.95;
  private cur = { target: new THREE.Vector3(), dist: 80, yaw: 0, pitch: 0.95 };
  private overviewDist = 80;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; button: number } | null = null;
  private pinch: { d: number; a: number } | null = null;
  private lastFrame = performance.now();
  private elapsed = 0;
  private frameDt = 0.016;
  showLabels = true;
  /** Draw each living player's view cone on the floor. */
  showVision = true;
  /** Pace rings and who heard a runner coming. */
  showSound = true;
  private heardLines!: THREE.LineSegments;
  private heardPos = new Float32Array(16 * 6);
  private heardCol = new Float32Array(16 * 6);
  private heardDist = new Float32Array(16 * 2);

  constructor(canvas: HTMLCanvasElement, geo: MapGeometry, colors: ViewerColors, events: ViewerEvents = {}) {
    this.canvas = canvas;
    this.geo = geo;
    this.events = events;
    this.colors = { t: new THREE.Color(colors.t), ct: new THREE.Color(colors.ct) };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.addEventListener('webglcontextlost', this.onLost);

    this.style = mapStyle(geo.name);
    this.renderer.toneMappingExposure = this.style.exposure;
    this.scene.background = new THREE.Color(this.style.sky[1]);
    this.scene.add(skyDome(this.style, this.disposables));
    this.scene.fog = new THREE.Fog(new THREE.Color(this.style.sky[1]), this.style.fog[0], this.style.fog[1]);

    this.initShared();
    this.buildLights();
    this.buildMap();
    this.scene.add(this.mapGroup, this.dynGroup);

    // Tracers
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.dynGroup.add(this.tracers);
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.shared.flashTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.scale.setScalar(1.4);
      this.muzzles.push(s); this.dynGroup.add(s);
    }

    // Bomb
    this.bomb = new THREE.Group();
    const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.38), new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.7 }));
    bombBody.castShadow = true;
    this.bombLed = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.14), this.bombLed);
    led.position.y = 0.17;
    this.bomb.add(bombBody, led);
    this.bombRingMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    this.bombRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 48), this.bombRingMat);
    this.bombRing.rotation.x = -Math.PI / 2;
    this.blast = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8, depthWrite: false }));
    this.blast.visible = false;
    const beaconGeo = new THREE.CylinderGeometry(0.35, 0.9, 9, 20, 1, true);
    beaconGeo.translate(0, 4.5, 0);
    this.beacon = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.beacon.visible = false;
    this.dynGroup.add(this.bomb, this.bombRing, this.blast, this.beacon);

    this.followRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.4, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.followRing.rotation.x = -Math.PI / 2;
    this.followRing.visible = false;
    this.dynGroup.add(this.followRing);
    const heardGeo = new THREE.BufferGeometry();
    heardGeo.setAttribute('position', new THREE.BufferAttribute(this.heardPos, 3));
    heardGeo.setAttribute('color', new THREE.BufferAttribute(this.heardCol, 3));
    heardGeo.setAttribute('lineDistance', new THREE.BufferAttribute(this.heardDist, 1));
    this.heardLines = new THREE.LineSegments(heardGeo, new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: 0.9, dashSize: 1.1, gapSize: 0.7, depthTest: false, blending: THREE.AdditiveBlending }));
    this.heardLines.frustumCulled = false; this.heardLines.renderOrder = 8;
    this.dynGroup.add(this.heardLines);
    const leadGeo = new THREE.BufferGeometry();
    leadGeo.setAttribute('position', new THREE.BufferAttribute(this.leaderPos, 3));
    leadGeo.setAttribute('color', new THREE.BufferAttribute(this.leaderCol, 3));
    const leadMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthTest: false });
    this.leaders = new THREE.LineSegments(leadGeo, leadMat);
    this.leaders.renderOrder = 8; this.leaders.frustumCulled = false; this.leaders.visible = false;
    this.dynGroup.add(this.leaders);
    this.disposables.push(leadGeo, leadMat);

    // Camera framing
    const size = Math.max(geo.w, geo.h) * CELL;
    this.overviewDist = size * 1.35;
    this.resetView(true);

    // Input
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDbl);
    canvas.addEventListener('contextmenu', this.onCtx);
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __viewer: Viewer3D }).__viewer = this;
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __vinfo: () => unknown }).__vinfo = () => ({ ...this.renderer.info.render, ...this.renderer.info.memory, objects: this.scene.children.length, pixelRatio: this.renderer.getPixelRatio(), shadow: this.sun?.shadow.mapSize.x });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Setup

  private initShared() {
    const s = {
      ring: new THREE.RingGeometry(0.55, 0.72, 32),
      ripple: new THREE.RingGeometry(0.94, 1, 72),
      soundDisc: new THREE.CircleGeometry(1, 72),
      dead: new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.9 }),
      smokeGeo: cloudGeometry(),
      puffTex: puffTexture(),
      smokePts: new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { map: { value: null as THREE.Texture | null }, scale: { value: 600 }, lit: { value: new THREE.Color(0xe9ecef) }, dark: { value: new THREE.Color(0x8e969f) } },
        vertexShader: `attribute float size; attribute float alpha; attribute float shade; uniform float scale; varying float vA; varying float vS;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; vA = alpha; vS = shade; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 lit; uniform vec3 dark; varying float vA; varying float vS;
          void main(){ vec4 tx = texture2D(map, gl_PointCoord); float a = tx.a * vA; if (a < 0.01) discard; vec3 c = mix(dark, lit, clamp(vS + (tx.r - 0.85) * 0.6, 0.0, 1.0)); gl_FragColor = vec4(c, min(1.0, a * 1.6));
          #include <colorspace_fragment>
          }`,
      }),
      // Flashbang burst: hot core with a few long rays, drawn on top of the bright maps.
      flareTex: canvasTexture(256, 256, (g) => {
        const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, 'rgba(210,235,255,0.45)'); gr.addColorStop(1, 'rgba(180,220,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
        g.translate(128, 128);
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3 + (i % 2) * 0.2);
          const lg = g.createLinearGradient(0, 0, 124, 0);
          lg.addColorStop(0, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(200,230,255,0)');
          g.fillStyle = lg; g.beginPath(); g.moveTo(0, -3); g.lineTo(124, 0); g.lineTo(0, 3); g.fill();
        }
      }),
      trailTex: canvasTexture(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }),
      smokeMat: new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 1, transparent: true, opacity: 0.92, depthWrite: false }),
      projGeo: new THREE.SphereGeometry(0.16, 8, 6),
      disc: new THREE.CircleGeometry(1, 40),
      flameGeo: new THREE.ConeGeometry(0.28, 0.9, 7),
      glowTex: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      // Hearing range: clear in the middle, a soft wash toward a bright rim at the edge.
      soundTex: canvasTexture(256, 256, (g) => {
        const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.985, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      }),
      fireTex: radialTexture('rgba(255,170,60,0.95)', 'rgba(255,60,0,0)'),
      flashTex: radialTexture('rgba(255,255,240,1)', 'rgba(255,240,200,0)'),
      // Radar-style marker under each player so positions read at any zoom.
      dotTex: canvasTexture(64, 64, (g) => {
        g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
        g.lineWidth = 6; g.strokeStyle = 'rgba(8,11,15,0.9)'; g.stroke();
      }),
    };
    s.smokePts.uniforms.map!.value = s.puffTex;
    this.shared = s;
    this.disposables.push(...Object.values(s));
    this.kit = soldierKit();
    this.disposables.push(this.kit);
  }

  private buildLights() {
    const st = this.style;
    this.scene.add(new THREE.HemisphereLight(st.hemi.sky, st.hemi.ground, st.hemi.intensity));
    const sun = new THREE.DirectionalLight(st.sun.color, st.sun.intensity);
    const W = this.geo.w * CELL, H = this.geo.h * CELL;
    const [dx, dy, dz] = st.sun.dir;
    const k = 110 / Math.hypot(dx, dy, dz);
    sun.position.set(dx * k, dy * k, dz * k);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = Math.max(W, H) * 0.62;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 260 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target, this.flashLight);
    this.sun = sun;
  }

  /** Cell (x, y) to world position (centre of the cell at floor height). */
  cellToWorld(x: number, y: number, h = 0): THREE.Vector3 {
    return new THREE.Vector3((x - this.geo.w / 2) * CELL, h * HEIGHT_UNIT, (y - this.geo.h / 2) * CELL);
  }

  /** Floor height under a fractional cell position, smoothed across cells (ramps read as slopes). */
  groundAt(x: number, y: number): number {
    const g = this.geo;
    const sample = (cx: number, cy: number) => {
      const ix = Math.max(0, Math.min(g.w - 1, Math.floor(cx))), iy = Math.max(0, Math.min(g.h - 1, Math.floor(cy)));
      const k = g.kind[iy * g.w + ix];
      return k === 'floor' ? g.height[iy * g.w + ix]! : null;
    };
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const base = sample(x, y) ?? 0;
    const v = (cx: number, cy: number) => { const s = sample(cx + 0.5, cy + 0.5); return s === null || Math.abs(s - base) > 1 ? base : s; };
    const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * HEIGHT_UNIT;
  }

  private buildMap() {
    const g = this.geo;
    const pal = g.palette;
    const col = (h: string) => new THREE.Color(h);
    const regionOf = new Int16Array(g.w * g.h).fill(-1);
    g.regions.forEach((r, ri) => { for (const [x, y] of r.cells) regionOf[y * g.w + x] = ri; });
    const siteIdx = new Set(g.regions.map((r, i) => (r.site ? i : -1)).filter((i) => i >= 0));
    const tSp = new Set(g.tSpawn.map(([x, y]) => y * g.w + x));
    const ctSp = new Set(g.ctSpawn.map(([x, y]) => y * g.w + x));

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(box);
    const count = { floor: 0, wall: 0, low: 0, tall: 0, rail: 0 };
    for (const k of g.kind) if (k !== 'void') count[k === 'floor' ? 'floor' : k]++;
    // Cover sits on a floor tile too.
    const floorN = count.floor + count.low + count.tall + count.rail + (g.under?.size ?? 0);
    const S = this.surf;
    const stoneMap = g.name === 'Ancient' || g.name === 'Anubis';
    const sideTex = g.name === 'Nuke' || g.name === 'Cache' ? S.concrete : stoneMap ? S.blocks : S.plaster;
    const floorMat = worldMaterial({ top: S[floorStyle(g.name)], side: S.blocks, topScale: 1 / 4, sideScale: 1 / 3, roughness: 0.92 });
    const wallMat = worldMaterial({ top: S.plaster, side: sideTex, topScale: 1 / 4, sideScale: 1 / 3.5, roughness: 0.88, baseShade: 0.35 });
    const capMat = worldMaterial({ top: stoneMap ? S.blocks : S.concrete, topScale: 1 / 3, roughness: 0.8 });
    const coverMat = new THREE.MeshStandardMaterial({ map: S.crate, roughness: 0.8, metalness: 0.02 });
    this.disposables.push(floorMat, wallMat, capMat, coverMat);

    // Buildings, roofs and the land around the map.
    const env = buildEnvironment(g, S, this.disposables);
    this.mapGroup.add(env.group);

    // Landmarks first: cover cells they dress are drawn by the prop instead of a plain box.
    const props = buildProps({ geo: g, surfaces: S, toWorld: (x, y, h = 0) => this.cellToWorld(x, y, h), disposables: this.disposables });
    this.mapGroup.add(props.group);
    this.anims = props.anims;

    const floors = new THREE.InstancedMesh(box, floorMat, floorN);
    const walls = new THREE.InstancedMesh(box, wallMat, count.wall);
    const caps = new THREE.InstancedMesh(box, capMat, count.wall);
    const covers = new THREE.InstancedMesh(box, coverMat, count.low + count.tall);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, roughness: 0.45, metalness: 0.7 });
    this.disposables.push(railMat);
    const rails = new THREE.InstancedMesh(box, railMat, Math.max(1, count.rail * 3));
    rails.castShadow = true;
    floors.receiveShadow = true;
    walls.castShadow = true; walls.receiveShadow = true;
    caps.receiveShadow = true;
    covers.castShadow = true; covers.receiveShadow = true;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let fi = 0, wi = 0, ci = 0, rn = 0;
    const floorA = col(pal.floor), floorB = col(pal.floorAlt), accent = col(pal.accent);
    const tTint = this.colors.t.clone(), ctTint = this.colors.ct.clone();
    // Smooth large-scale wear so floors don't read as a checkerboard.
    const hash = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
    const noise = (x: number, y: number) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = hash(x0, y0), b = hash(x0 + 1, y0), c2 = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d * sx) * sy;
    };
    // Contact shadow: floor cells next to walls and tall cover are a little darker.
    const occ = (x: number, y: number, h: number) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const j = ny * g.w + nx, k = g.kind[j];
        if (k === 'wall' || k === 'tall') n += dx && dy ? 0.6 : 1;
        else if (k === 'floor' && g.height[j]! > h + 1.5) n += dx && dy ? 0.4 : 0.8;
      }
      return 1 - Math.min(0.32, n * 0.07);
    };
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const k = g.kind[i]!;
      if (k === 'void') continue;
      const hgt = g.height[i]! * HEIGHT_UNIT;
      const p = this.cellToWorld(x + 0.5, y + 0.5);
      if (k === 'wall' && env.covered[i]) continue;
      if (k === 'wall') {
        const top = hgt + WALL_HEIGHT * 0.8; // a little lower than "real" so players stay visible from above
        m.makeScale(CELL, top + 0.5, CELL).setPosition(p.x, (top - 0.5) / 2, p.z);
        walls.setMatrixAt(wi, m);
        // Large-scale tone variation so long walls don't read as one flat slab.
        const v = (noise(x / 7, y / 7) - 0.5) * 0.1;
        walls.setColorAt(wi, c.set(pal.wall).offsetHSL(0, 0, v));
        m.makeScale(CELL, 0.14, CELL).setPosition(p.x, top + 0.07, p.z);
        caps.setMatrixAt(wi, m);
        caps.setColorAt(wi, c.set(pal.wallTop).offsetHSL(0, 0, v * 0.6));
        wi++;
        continue;
      }
      // Floor tile under everything walkable or covered.
      const low = g.under?.get(i);
      if (low !== undefined) {
        // A bridge: a deck at its height and the passage floor underneath, open between them.
        const lh = low * HEIGHT_UNIT;
        m.makeScale(CELL, lh + 0.5, CELL).setPosition(p.x, (lh - 0.5) / 2, p.z);
        floors.setMatrixAt(fi, m);
        floors.setColorAt(fi, c.copy(floorA).multiplyScalar(0.7));
        fi++;
        m.makeScale(CELL, 0.6, CELL).setPosition(p.x, hgt - 0.3, p.z);
      } else m.makeScale(CELL, hgt + 0.5, CELL).setPosition(p.x, (hgt - 0.5) / 2, p.z);
      floors.setMatrixAt(fi, m);
      const ri = regionOf[i]!;
      c.copy(floorA).lerp(floorB, noise(x / 5, y / 5) * 0.9 + noise(x / 1.7, y / 1.7) * 0.1);
      if (ri >= 0 && siteIdx.has(ri)) c.lerp(accent, 0.16);
      if (tSp.has(i)) c.lerp(tTint, 0.12);
      if (ctSp.has(i)) c.lerp(ctTint, 0.12);
      c.offsetHSL(0, 0, Math.min(0.06, g.height[i]! * 0.02));
      c.multiplyScalar(occ(x, y, g.height[i]!));
      floors.setColorAt(fi, c);
      fi++;
      if ((k === 'low' || k === 'tall' || k === 'rail') && !props.skinned.has(i)) {
        const ch = k === 'low' ? 1.05 : k === 'tall' ? 2.3 : 1.0;
        if (k === 'rail') {
          // Metal railing: a top bar, a mid bar and a post, aligned with neighbouring rails.
          const horiz = (x > 0 && g.kind[i - 1] === 'rail') || (x < g.w - 1 && g.kind[i + 1] === 'rail');
          const sx = horiz ? CELL : 0.07, sz = horiz ? 0.07 : CELL;
          m.makeScale(sx, 0.07, sz).setPosition(p.x, hgt + ch, p.z); rails.setMatrixAt(rn++, m);
          m.makeScale(sx, 0.05, sz).setPosition(p.x, hgt + ch * 0.5, p.z); rails.setMatrixAt(rn++, m);
          m.makeScale(0.08, ch, 0.08).setPosition(p.x, hgt + ch / 2, p.z); rails.setMatrixAt(rn++, m);
          continue;
        }
        m.makeScale(CELL * 0.96, ch, CELL * 0.96).setPosition(p.x, hgt + ch / 2, p.z);
        covers.setMatrixAt(ci, m);
        const v = (hash(x, y) - 0.5) * 0.08;
        covers.setColorAt(ci, c.set(pal.cover).lerp(new THREE.Color(0xffffff), 0.35).offsetHSL(0, 0, (k === 'tall' ? -0.04 : 0) + v));
        ci++;
      }
    }
    floors.count = fi; walls.count = wi; caps.count = wi; covers.count = ci; rails.count = rn;
    rails.instanceMatrix.needsUpdate = true; this.mapGroup.add(rails);

    for (const im of [floors, walls, caps, covers]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.mapGroup.add(im); }

    // Site letters painted on the floor, and spawn markers.
    for (const s of ['A', 'B'] as const) {
      const r = g.sites[s];
      const tex = canvasTexture(256, 256, (cx) => {
        cx.strokeStyle = 'rgba(255,255,255,0.85)'; cx.lineWidth = 14;
        cx.strokeRect(14, 14, 228, 228);
        cx.fillStyle = 'rgba(255,255,255,0.9)';
        cx.font = '700 190px "Chakra Petch", system-ui, sans-serif';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(s, 128, 140);
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, color: new THREE.Color(pal.accent).lerp(new THREE.Color('#ffffff'), 0.6) });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 5.5, CELL * 5.5), mat);
      plane.rotation.x = -Math.PI / 2;
      const p = this.cellToWorld(r.center[0] + 0.5, r.center[1] + 0.5);
      plane.position.set(p.x, g.height[r.center[1] * g.w + r.center[0]]! * HEIGHT_UNIT + 0.03, p.z);
      plane.renderOrder = 1;
      this.mapGroup.add(plane);
      this.disposables.push(tex, mat, plane.geometry);
      // Painted bombsite border: a thin stripe along the edge of the site's walkable area.
      const inSite = new Set(r.cells.map(([x, y]) => y * g.w + x));
      const walk = (i: number) => g.kind[i] !== 'void' && g.kind[i] !== 'wall';
      const stripes: [number, number, number, boolean][] = [];
      for (const i of inSite) {
        if (!walk(i)) continue;
        const x = i % g.w, y = (i - x) / g.w;
        const hgt = g.height[i]! * HEIGHT_UNIT;
        const out = (j: number, ok: boolean) => !ok || !inSite.has(j) || !walk(j);
        if (out(i - 1, x > 0)) stripes.push([x + 0.08, y + 0.5, hgt, false]);
        if (out(i + 1, x < g.w - 1)) stripes.push([x + 0.92, y + 0.5, hgt, false]);
        if (out(i - g.w, y > 0)) stripes.push([x + 0.5, y + 0.08, hgt, true]);
        if (out(i + g.w, y < g.h - 1)) stripes.push([x + 0.5, y + 0.92, hgt, true]);
      }
      if (stripes.length) {
        const stripeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.accent).lerp(new THREE.Color('#ffffff'), 0.25), transparent: true, opacity: 0.75, depthWrite: false });
        const im = new THREE.InstancedMesh(box, stripeMat, stripes.length);
        stripes.forEach(([x, y, hgt, horiz], k) => {
          const w = this.cellToWorld(x, y);
          m.makeScale(horiz ? CELL : 0.16, 0.02, horiz ? 0.16 : CELL).setPosition(w.x, hgt + 0.03, w.z);
          im.setMatrixAt(k, m);
        });
        im.instanceMatrix.needsUpdate = true; im.renderOrder = 1;
        this.mapGroup.add(im);
        this.disposables.push(stripeMat);
      }
    }

    // Callout labels (sprites that face the camera).
    for (const r of g.regions) {
      if (r.zone === 'TS' || r.zone === 'CTS' || r.site) continue;
      const label = this.makeTextSprite(r.name.toUpperCase(), 'rgba(235,240,245,0.85)', 22, 'rgba(10,14,18,0.55)');
      const p = this.cellToWorld(r.center[0] + 0.5, r.center[1] + 0.5, g.height[r.center[1] * g.w + r.center[0]]!);
      label.position.set(p.x, p.y + 0.3, p.z);
      label.userData.callout = true;
      label.userData.area = r.cells.length;
      label.renderOrder = 2;
      this.mapGroup.add(label);
    }
  }

  private makeTextSprite(text: string, color: string, px: number, bg: string): THREE.Sprite {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `600 ${px}px "Chakra Petch", system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 18;
    const tex = canvasTexture(w, px + 14, (cx) => {
      cx.fillStyle = bg; cx.beginPath(); cx.roundRect(0, 0, w, px + 14, 6); cx.fill();
      cx.font = `600 ${px}px "Chakra Petch", system-ui, sans-serif`;
      cx.fillStyle = color; cx.textBaseline = 'middle'; cx.textAlign = 'center';
      cx.fillText(text, w / 2, (px + 14) / 2 + 1);
    });
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.userData.aspect = w / (px + 14);
    s.userData.base = 0.75;
    this.disposables.push(tex, mat);
    return s;
  }

  // ---------------------------------------------------------------------------
  // Round content

  setTimeline(tl: RoundTimeline) {
    this.clearRound();
    this.tl = tl;
    for (const track of tl.players) this.addRig(track);
    for (const u of tl.utility) this.addUtil(u);
    if (this.followId && !this.rigById.has(this.followId)) this.followId = null;
  }

  private clearRound() {
    for (const r of this.rigs) {
      this.dynGroup.remove(r.root, r.label, r.glow, r.dot, r.cone, r.soundDisc, ...r.ripples); (r.dot.material as THREE.Material).dispose();
      for (const m of [r.soundDisc, ...r.ripples]) (m.material as THREE.Material).dispose();
      r.cone.geometry.dispose(); (r.cone.material as THREE.Material).dispose();
      r.mat.dispose(); r.labelTex.dispose(); (r.label.material as THREE.SpriteMaterial).dispose();
      (r.ring.material as THREE.Material).dispose(); (r.hpArc.material as THREE.Material).dispose(); r.hpArc.geometry.dispose();
      (r.glow.material as THREE.Material).dispose();
    }
    for (const u of this.utils) {
      this.dynGroup.remove(u.group);
      u.group.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mm && mm !== this.shared.smokeMat && mm !== this.shared.smokePts) mm.dispose();
        const gg = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (gg && (o === u.trail || o === u.smoke?.points)) gg.dispose();
      });
    }
    this.rigs = []; this.rigById.clear(); this.utils = [];
  }

  private teamColor(track: PlayerTrack): THREE.Color { return track.side === 'T' ? this.colors.t : this.colors.ct; }

  private addRig(track: PlayerTrack) {
    const s = this.shared;
    const color = this.teamColor(track);
    const root = new THREE.Group();
    let seed = 0;
    for (const ch of track.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const soldier = buildSoldier(this.kit, track.side, color, seed);
    const { body, helmet, legL, legR } = soldier;
    const mat = soldier.accent;
    helmet.visible = track.helmet;
    const ring = new THREE.Mesh(s.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const hpArc = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.9, 40, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0x5fe39a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    hpArc.rotation.x = -Math.PI / 2; hpArc.position.y = 0.05;
    // A little over life size so players read from the tactical camera (about 2.3 m against 2.9 m walls).
    body.scale.setScalar(1.28); ring.scale.setScalar(1.3); hpArc.scale.setScalar(1.3);
    root.add(body, ring, hpArc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(2.4); glow.visible = false;
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 300; labelCanvas.height = 56;
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true }));
    label.renderOrder = 10;
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.dotTex, color, transparent: true, depthTest: false }));
    dot.renderOrder = 9;
    dot.userData.aspect = 1;
    label.userData.aspect = 300 / 56;
    label.userData.base = 1.25;
    // View cone: a triangle fan draped on the floor, rebuilt every frame from the sight rays.
    const RAYS = 24;
    const conePos = new Float32Array((RAYS + 2) * 3);
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.BufferAttribute(conePos, 3));
    const idx: number[] = [];
    for (let i = 1; i <= RAYS; i++) idx.push(0, i, i + 1);
    coneGeo.setIndex(idx);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    cone.frustumCulled = false; cone.renderOrder = 2;
    const soundMat = (opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const soundDisc = new THREE.Mesh(s.soundDisc, soundMat(0.05));
    (soundDisc.material as THREE.MeshBasicMaterial).map = s.soundTex;
    const ripples = [0, 1].map(() => new THREE.Mesh(s.ripple, soundMat(0.4)));
    for (const m of [soundDisc, ...ripples]) { m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 3; m.frustumCulled = false; }
    this.dynGroup.add(root, label, glow, dot, cone, soundDisc, ...ripples);
    const shotTimes = (this.tl?.shots ?? []).filter((x) => x.from === track.id).map((x) => x.t).sort((a, b) => a - b);
    const rig: Rig = { track, lastShot: -9, throws: (this.tl?.utility ?? []).filter((u) => u.playerId === track.id).map((u) => u.throwT), root, body, soldier, isDead: false, helmet, legL, legR, ring, hpArc, glow, label, dot, labelCanvas, labelTex, labelKey: '', mat, phase: (track.id.charCodeAt(track.id.length - 1) % 10) / 3, cone, conePos, soundDisc, ripples, shotTimes, stride: 0, lastT: 0, aim: 0, carry: 0.12 };
    this.rigs.push(rig); this.rigById.set(track.id, rig);
  }

  private updateCone(rig: Rig, pos: Vec, aim: number, baseY: number, smokes: ReturnType<typeof activeSmokes>) {
    const fan = visionFan(this.geo, pos, aim, smokes);
    const P = rig.conePos;
    const hw = this.geo.w / 2, hh = this.geo.h / 2;
    P[0] = (pos[0] - hw) * CELL; P[1] = baseY + 0.07; P[2] = (pos[1] - hh) * CELL;
    for (let i = 0; i < fan.length; i++) {
      const [x, y] = fan[i]!;
      // Each ray ends on the floor it reaches (stairs and drops), within a sensible band.
      P[(i + 1) * 3] = (x - hw) * CELL; P[(i + 1) * 3 + 1] = Math.max(baseY - 4, Math.min(baseY + 1.5, this.groundAt(x, y))) + 0.07; P[(i + 1) * 3 + 2] = (y - hh) * CELL;
    }
    (rig.cone.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private drawLabel(rig: Rig, hp: number, weapon: string, status: string, spotted = false) {
    const followed = this.followId === rig.track.id;
    const key = `${hp}|${status}|${followed}|${spotted}|${weapon}`;
    if (key === rig.labelKey) return;
    rig.labelKey = key;
    const g = rig.labelCanvas.getContext('2d')!;
    const W = rig.labelCanvas.width, H = rig.labelCanvas.height;
    const tcol = rig.track.side === 'T' ? '#f0a33a' : '#5aa9e6';
    g.clearRect(0, 0, W, H);
    // Broadcast nameplate: team stripe | name | weapon, HP bar underneath.
    const name = rig.track.handle;
    g.font = '700 28px "Chakra Petch", system-ui, sans-serif';
    const nw = g.measureText(name).width;
    g.font = '600 18px "Chakra Petch", system-ui, sans-serif';
    // Status (flashed, planting, defusing) takes the weapon's place, in yellow.
    const wpn = status || weapon.toUpperCase();
    const ww = wpn ? g.measureText(wpn).width + 12 : 0;
    const eye = spotted ? 22 : 0;
    const tw = Math.min(W - 4, 14 + eye + nw + ww + 14);
    const x0 = (W - tw) / 2;
    g.fillStyle = followed ? 'rgba(18,25,34,0.95)' : 'rgba(9,13,18,0.82)';
    g.beginPath(); g.roundRect(x0, 2, tw, 38, 6); g.fill();
    if (followed) { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x0 + 1, 3, tw - 2, 36, 5); g.stroke(); }
    g.fillStyle = tcol; g.beginPath(); g.roundRect(x0, 2, 6, 38, [6, 0, 0, 6]); g.fill();
    let x = x0 + 14;
    if (spotted) {
      g.fillStyle = '#ff5a4f'; g.beginPath(); g.ellipse(x + 8, 21, 8, 5.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b0f14'; g.beginPath(); g.arc(x + 8, 21, 2.6, 0, Math.PI * 2); g.fill();
      x += eye;
    }
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '700 28px "Chakra Petch", system-ui, sans-serif';
    g.fillStyle = '#eef3f7';
    g.fillText(name, x, 22, Math.max(20, tw - (x - x0) - ww - 10));
    if (wpn) {
      g.font = '600 18px "Chakra Petch", system-ui, sans-serif';
      g.fillStyle = status ? '#ffd66b' : 'rgba(200,212,224,0.7)'; g.textAlign = 'right';
      g.fillText(wpn, x0 + tw - 10, 23);
    }
    // HP bar
    g.fillStyle = 'rgba(9,13,18,0.82)'; g.beginPath(); g.roundRect(x0, 44, tw, 9, 3); g.fill();
    g.fillStyle = hp > 50 ? '#4cc38a' : hp > 20 ? '#e8c547' : '#f06a5f';
    g.beginPath(); g.roundRect(x0 + 2, 46, Math.max(2, Math.round((tw - 4) * hp / 100)), 5, 2); g.fill();
    rig.labelTex.needsUpdate = true;
  }

  private addUtil(u: UtilityObject) {
    const s = this.shared;
    const group = new THREE.Group();
    const tint = u.side === 'T' ? this.colors.t : this.colors.ct;
    const projColor = u.kind === 'smoke' ? 0x9aa39a : u.kind === 'flash' ? 0xe8edf2 : u.kind === 'molotov' ? 0xff8a3a : 0x5f8a45;
    const proj = new THREE.Mesh(s.projGeo, new THREE.MeshStandardMaterial({ color: projColor, roughness: 0.5, metalness: 0.4, emissive: new THREE.Color(projColor).multiplyScalar(0.25) }));
    proj.scale.setScalar(0.8);
    proj.castShadow = true;
    const projGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.glowTex, color: u.kind === 'molotov' ? 0xffa050 : 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    projGlow.scale.setScalar(1.1);
    group.add(proj, projGlow);

    // Trail: the simulated arc sampled from throw to pop; drawn up to the grenade's current position.
    const air = Math.max(0.05, u.t - u.throwT);
    const tPos = new Float32Array(TRAIL_N * 3), tCol = new Float32Array(TRAIL_N * 3), tT = new Float32Array(TRAIL_N);
    const trailColor = new THREE.Color(0xffffff).lerp(tint, 0.35);
    for (let i = 0; i < TRAIL_N; i++) {
      const tt = u.throwT + (air * i) / (TRAIL_N - 1);
      const f = flightAt(u.flight, tt);
      const w = this.cellToWorld(f.x, f.y, f.h);
      tPos.set([w.x, w.y, w.z], i * 3); tT[i] = tt;
    }
    for (let i = 0; i < TRAIL_N; i++) tCol.set([trailColor.r, trailColor.g, trailColor.b], i * 3);
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    const trail = new THREE.Points(tGeo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, map: s.trailTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const trailLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    trail.frustumCulled = false; trailLine.frustumCulled = false;
    trail.renderOrder = 6; trailLine.renderOrder = 6;
    const origin = new THREE.Mesh(s.ring, new THREE.MeshBasicMaterial({ color: trailColor, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    origin.rotation.x = -Math.PI / 2;
    const o = this.cellToWorld(u.from[0], u.from[1], u.flight.fromH);
    origin.position.set(o.x, o.y + 0.06, o.z); origin.scale.setScalar(0.7);
    group.add(trail, trailLine, origin);

    const parts: THREE.Object3D[] = [];
    const R = u.radius * CELL;
    let smoke: UtilRig['smoke'];
    if (u.kind === 'smoke') {
      // Layered particle cloud: each puff drifts from the canister out to its place in the smoke volume.
      const base = new Float32Array(SMOKE_N * 3), size = new Float32Array(SMOKE_N), seed = new Float32Array(SMOKE_N);
      let a = Math.floor(u.throwT * 1000) + 11;
      const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
      for (let i = 0; i < SMOKE_N; i++) {
        const ang = rnd() * Math.PI * 2, r = R * (0.15 + 0.85 * Math.sqrt(rnd()));
        const y = 0.5 + Math.pow(rnd(), 1.4) * 2.6;
        base.set([Math.cos(ang) * r * 0.95, y, Math.sin(ang) * r * 0.95], i * 3);
        size[i] = 2.8 + rnd() * 1.8; seed[i] = rnd() * 100;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE_N * 3), 3));
      geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(SMOKE_N), 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SMOKE_N), 1));
      geo.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(SMOKE_N), 1));
      const points = new THREE.Points(geo, s.smokePts);
      points.frustumCulled = false; points.renderOrder = 5;
      group.add(points); parts.push(points);
      smoke = { points, base, size, seed };
    } else if (u.kind === 'molotov') {
      const fireMat = new THREE.MeshBasicMaterial({ map: s.fireTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const disc = new THREE.Mesh(s.disc, fireMat);
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06; disc.scale.setScalar(R);
      parts.push(disc); group.add(disc);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
      for (let i = 0; i < 9; i++) {
        const f = new THREE.Mesh(s.flameGeo, flameMat);
        const ang = (i / 9) * Math.PI * 2 + i, r = (0.2 + ((i * 37) % 10) / 13) * R * 0.75;
        f.position.set(Math.cos(ang) * r, 0.45, Math.sin(ang) * r);
        f.userData.seed = i * 1.7;
        parts.push(f); group.add(f);
      }
    } else if (u.kind === 'flash') {
      // Normal blending (not additive) so the burst still reads over pale sandstone.
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.flareTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false }));
      sp.renderOrder = 7;
      parts.push(sp); group.add(sp);
      const pool = new THREE.Mesh(s.disc, new THREE.MeshBasicMaterial({ map: s.glowTex, color: 0xfff6dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.rotation.x = -Math.PI / 2;
      parts.push(pool); group.add(pool);
    } else {
      const ball = new THREE.Mesh(s.smokeGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      ball.position.y = 0.8; parts.push(ball); group.add(ball);
      const scorch = new THREE.Mesh(s.disc, new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.6, depthWrite: false }));
      scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.05; scorch.scale.setScalar(R * 0.7);
      parts.push(scorch); group.add(scorch);
    }
    const ring = new THREE.Mesh(s.ring, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
    group.add(ring);
    group.visible = false; trail.visible = false; trailLine.visible = false; origin.visible = false;
    this.dynGroup.add(group);
    this.utils.push({ u, group, proj, projGlow, parts, ring, trail, trailLine, trailT: tT, origin, smoke });
  }

  // ---------------------------------------------------------------------------
  // Frame

  /**
   * Dynamic resolution: if frames stay slow (under ~30 fps), render at a
   * lower pixel ratio (2 -> 1.5 -> 1), then use a smaller shadow map. Never goes back up within a session.
   */
  private sun: THREE.DirectionalLight | null = null;
  private flashLight = new THREE.PointLight(0xfff6e0, 0, 26, 1.6);
  private perf = { n: 0, sum: 0, ratio: Math.min(window.devicePixelRatio || 1, 2), lowShadow: false, frames: 0 };
  private adaptQuality(gap: number) {
    const P = this.perf;
    // Skip start-up (map build, shader compile) and stalls such as a hidden tab.
    if (++P.frames <= 30 || gap <= 0 || gap > 1000 || document.hidden) return;
    P.n++; P.sum += gap;
    if (P.n < 90 && (P.sum < 3000 || P.n < 5)) return;
    const avg = P.sum / P.n;
    P.n = 0; P.sum = 0;
    if (avg > 34 && P.ratio > 1) {
      P.ratio = P.ratio > 1.5 ? 1.5 : 1;
      this.renderer.setPixelRatio(P.ratio);
      this.resize();
    } else if (avg > 34 && !P.lowShadow && this.sun) {
      // Last step: a smaller shadow map.
      P.lowShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private worldOf(v: Vec): THREE.Vector3 {
    const p = this.cellToWorld(v[0], v[1]);
    p.y = this.groundAt(v[0], v[1]);
    return p;
  }

  render(t: number) {
    const now = performance.now();
    this.adaptQuality(now - this.lastFrame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;
    this.frameDt = dt;
    const tl = this.tl;
    if (tl) {
      this.updatePlayers(tl, t);
      this.updateShots(tl, t);
      this.updateUtility(t);
    }
    for (const a of this.anims) a.tick(this.elapsed);
    if (tl) {
      this.updateBomb(tl, t);
    }
    this.updateCamera(dt);
    this.scaleSprites();
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayers(tl: RoundTimeline, t: number) {
    const smokes = this.showVision ? activeSmokes(tl, t) : [];
    for (const rig of this.rigs) {
      const tr = rig.track;
      const pos = posAt(tr, t);
      const w = this.worldOf(pos);
      // Under a bridge the cell has two floors: stay on the one the player was on.
      const low = this.geo.under?.get(Math.floor(pos[1]) * this.geo.w + Math.floor(pos[0]));
      if (low !== undefined && Math.abs(rig.root.position.y - low * HEIGHT_UNIT) < Math.abs(rig.root.position.y - w.y)) w.y = low * HEIGHT_UNIT;
      rig.root.position.copy(w);
      const dead = tr.deathT !== null && t >= tr.deathT;
      const hp = hpAt(tr, t);
      if (dead) {
        const since = t - tr.deathT!;
        const fall = Math.min(1, since / 0.35);
        rig.body.rotation.set(-fall * Math.PI / 2, rig.body.rotation.y, 0);
        rig.body.position.y = 0.05 * fall;
        if (!rig.isDead) { setDead(rig.soldier, this.shared.dead); rig.isDead = true; }
        rig.ring.visible = false; rig.hpArc.visible = false; rig.label.visible = false; rig.glow.visible = false; rig.dot.visible = false; rig.cone.visible = false;
        rig.soundDisc.visible = false; for (const m of rig.ripples) m.visible = false;
        rig.legL.rotation.x = 0; rig.legR.rotation.x = 0;
        continue;
      }
      if (rig.isDead) { setDead(rig.soldier, null); rig.isDead = false; }
      rig.body.rotation.x = 0; rig.body.position.y = 0;
      const heading = aimAt(tr, t);
      const spotted = isSpotted(tr, t);
      rig.cone.visible = this.showVision;
      if (this.showVision) this.updateCone(rig, pos, heading, w.y, smokes);
      // three.js: model faces +z; map heading is atan2(dy, dx) in cell space (x right, y down = +z).
      const yaw = Math.atan2(Math.cos(heading), Math.sin(heading));
      rig.body.rotation.y = yaw;
      const moving = isMoving(tr, t);
      const pace = paceAt(tr, t);
      const sd = rig.soldier;
      setGun(this.kit, sd, gunClassOf(weaponAt(tr, t)));
      // Gait: a crouched, short-stepping walk (silent) or a run. Cadence, stride and bounce grow with the pace.
      const gait = !moving ? 0 : pace === 'walk' ? 1 : 2;
      const step = t - rig.lastT;
      rig.lastT = t;
      if (step > 0 && step < 0.3) rig.stride += step * [0, 6, 8.5, 11.5][gait]!;
      // Aiming: shouldered from just before a shot until a moment after the burst.
      let aimWant = 0;
      { const st = rig.shotTimes; let lo = 0, hi = st.length; while (lo < hi) { const m = (lo + hi) >> 1; if (st[m]! < t - 0.9) lo = m + 1; else hi = m; } if (lo < st.length && st[lo]! < t + 0.35) aimWant = 1; }
      const ease = Math.min(1, this.frameDt * 9);
      rig.aim += (aimWant - rig.aim) * ease;
      const carryWant = CARRY[gait]!;
      rig.carry += (carryWant - rig.carry) * ease;
      const kick = Math.exp(-Math.max(0, t - rig.lastShot) * 18);
      poseSoldier(sd, { gait: gait as Gait, p: rig.stride + rig.phase, aim: rig.aim, carry: rig.carry, kick });
      // Grenade throws: wind up behind the head, release at the throw time, then recover.
      let arm = 0, lead = 0, holding = false;
      for (const th of rig.throws) {
        const d = t - th;
        if (d < -0.45 || d > 0.6) continue;
        const ease = (x: number) => 1 - (1 - x) * (1 - x);
        if (d < 0) { arm = 2.3 * ease((d + 0.45) / 0.45); lead = -0.5 * ease((d + 0.45) / 0.45); holding = true; }
        else if (d < 0.25) { arm = 2.3 - 3.7 * ease(d / 0.25); lead = -0.5 + 0.5 * (d / 0.25); }
        else { arm = -1.4 * (1 - (d - 0.25) / 0.35); }
      }
      sd.armR.rotation.x = arm; sd.nade.rotation.x = arm; sd.nade.visible = holding;
      sd.armL.rotation.x = lead + (moving ? Math.sin(rig.stride + rig.phase) * 0.05 : 0);
      if (arm !== 0) sd.carry.rotation.x *= 0.3; // throwing: shoulders square up
      sd.gun.visible = !holding && Math.abs(arm) < 0.5;
      rig.ring.visible = true; rig.hpArc.visible = true;
      // Pace ring: small around a walker, out to 20 m (how far the steps carry) around a runner,
      // with one slow ripple. Kept faint: enough to read the pace, not to cover the map.
      const ringOn = this.showSound && pace !== 'still';
      rig.soundDisc.visible = ringOn;
      rig.ripples[1]!.visible = false;
      if (ringOn) {
        const run = pace === 'run';
        const R = (run ? HEAR_RUN : WALK_RING) * CELL;
        // Drawn over the walls so it reads like a radar; softer when the camera is close in.
        const near = Math.min(1, Math.max(0.3, (this.cur.dist - 8) / 40));
        rig.soundDisc.position.set(w.x, w.y + 0.12, w.z); rig.soundDisc.scale.setScalar(R);
        (rig.soundDisc.material as THREE.MeshBasicMaterial).opacity = (run ? 0.38 : 0.6) * near;
        const m = rig.ripples[0]!;
        const ph = (t * 0.8 + rig.phase * 0.41) % 1;
        m.visible = run && ph > 0.02;
        m.position.set(w.x, w.y + 0.14, w.z); m.scale.setScalar(Math.max(0.5, R * ph));
        (m.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.25 * near;
      } else rig.ripples[0]!.visible = false;
      // HP arc around the feet: shrinks as HP drops.
      const frac = hp / 100;
      const prev = rig.hpArc.userData.hp as number | undefined;
      if (prev !== hp) {
        rig.hpArc.geometry.dispose();
        rig.hpArc.geometry = new THREE.RingGeometry(0.78, 0.92, 40, 1, Math.PI / 2, Math.PI * 2 * frac);
        (rig.hpArc.material as THREE.MeshBasicMaterial).color.set(hp > 50 ? 0x4cc38a : hp > 20 ? 0xe8c547 : 0xf06a5f);
        rig.hpArc.userData.hp = hp;
      }
      // Hit flash on the body.
      const recentHit = tr.hp.some(([ht]) => t >= ht && t - ht < 0.18);
      if (recentHit) rig.mat.emissive.setHex(0x8a1a12); else rig.mat.emissive.setHex(0x000000);
      const blind = blindAmount(tr, t);
      rig.glow.visible = blind > 0.02;
      if (rig.glow.visible) { rig.glow.position.set(w.x, w.y + 2.2, w.z); (rig.glow.material as THREE.SpriteMaterial).opacity = blind; }
      let status = '';
      const b = tl.bomb;
      if (b.plantT !== null && b.carrier === tr.id && t >= b.plantT - PLANT_SECONDS && t < b.plantT) status = `PLANTING ${Math.round(((t - (b.plantT - PLANT_SECONDS)) / PLANT_SECONDS) * 100)}%`;
      for (const [start, stop, by, need] of b.attempts) if (by === tr.id && t >= start && t < (stop ?? start + need)) status = `DEFUSING ${Math.round(Math.min(1, (t - start) / need) * 100)}%`;
      if (!status && tl.heard.some((h) => h.listener === tr.id && t >= h.t && t < h.t + 1.8)) status = 'HEARD STEPS';
      if (blind > 0.3) status = 'FLASHED';
      this.drawLabel(rig, hp, weaponAt(tr, t), status, spotted);
      rig.label.visible = this.showLabels || this.followId === tr.id;
      rig.label.position.set(w.x, w.y + 3.3, w.z);
      rig.dot.visible = true;
      rig.dot.position.set(w.x, w.y + 0.2, w.z);
    }
    // Who heard a runner: dashed lines from the listener to the steps, fading out.
    let nh = 0;
    if (this.showSound) for (const h of tl.heard) {
      if (t < h.t || t > h.t + 1.8 || nh >= 16) continue;
      const a = this.rigById.get(h.listener), b = this.rigById.get(h.source);
      if (!a || !b || a.isDead || b.isDead) continue;
      const fade = 1 - (t - h.t) / 1.8;
      const c = this.teamColor(a.track);
      this.heardPos.set([a.root.position.x, a.root.position.y + 1.6, a.root.position.z, b.root.position.x, b.root.position.y + 1.2, b.root.position.z], nh * 6);
      this.heardCol.set([c.r * fade * 0.6, c.g * fade * 0.6, c.b * fade * 0.6, c.r * fade * 0.35, c.g * fade * 0.35, c.b * fade * 0.35], nh * 6);
      this.heardDist[nh * 2] = 0; this.heardDist[nh * 2 + 1] = a.root.position.distanceTo(b.root.position);
      nh++;
    }
    const hg = this.heardLines.geometry;
    hg.setDrawRange(0, nh * 2);
    (hg.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (hg.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (hg.attributes.lineDistance as THREE.BufferAttribute).needsUpdate = true;
    this.heardLines.visible = nh > 0;
    const f = this.followId ? this.rigById.get(this.followId) : undefined;
    this.followRing.visible = !!f && (f.track.deathT === null || t < f.track.deathT);
    if (f && this.followRing.visible) {
      this.followRing.position.set(f.root.position.x, f.root.position.y + 0.06, f.root.position.z);
      const k = 1 + 0.08 * Math.sin(this.elapsed * 6);
      this.followRing.scale.set(k, k, k);
    }
  }

  private muzzleOf(rig: Rig): THREE.Vector3 {
    const yaw = rig.body.rotation.y;
    return new THREE.Vector3(rig.root.position.x + Math.sin(yaw) * 1.1 + Math.cos(yaw) * 0.09, rig.root.position.y + 1.69, rig.root.position.z + Math.cos(yaw) * 1.1 - Math.sin(yaw) * 0.09);
  }

  private updateShots(tl: RoundTimeline, t: number) {
    let n = 0, mz = 0;
    const WINDOW = 0.09;
    for (const s of tl.shots) {
      if (s.t > t) break;
      if (s.t < t - WINDOW) continue;
      const a = this.rigById.get(s.from), b = this.rigById.get(s.to);
      if (a && s.t > a.lastShot) a.lastShot = s.t;
      if (!a || !b || n >= 96) continue;
      const from = this.muzzleOf(a);
      const to = b.root.position.clone(); to.y += s.headshot ? 2.2 : 1.6;
      if (!s.hit) { const side = ((s.t * 1000) % 7) / 7 - 0.5; to.x += side * 1.6; to.z -= side * 1.2; to.y += 0.4; }
      const fade = 1 - (t - s.t) / WINDOW;
      const tail = from.clone().lerp(to, Math.max(0, 0.15 + (1 - fade) * 0.6));
      this.tracerPos.set([tail.x, tail.y, tail.z, to.x, to.y, to.z], n * 6);
      const c = s.lethal ? [1, 0.55, 0.4] : [1, 0.85, 0.45];
      this.tracerCol.set([c[0]! * 0.3 * fade, c[1]! * 0.3 * fade, c[2]! * 0.3 * fade, c[0]! * fade, c[1]! * fade, c[2]! * fade], n * 6);
      n++;
      if (mz < this.muzzles.length && t - s.t < 0.05) {
        const m = this.muzzles[mz++]!;
        m.visible = true; m.position.copy(from); m.scale.setScalar(s.weapon === 'AWP' ? 2.2 : 1.3);
      }
    }
    for (let i = mz; i < this.muzzles.length; i++) this.muzzles[i]!.visible = false;
    this.tracerGeo.setDrawRange(0, n * 2);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Grenades follow the engine's flight model (flightAt): thrown at throwT,
   * an arc through the air, landing (and for smokes a short roll), then the
   * pop at the simulated time. The trail shows the arc travelled so far and
   * disappears the moment the grenade pops. Effects last exactly as long as
   * the simulation's smoke, fire and flash.
   */
  private updateUtility(t: number) {
    let flashI = 0, flashPos: THREE.Vector3 | null = null;
    for (const ur of this.utils) {
      const u = ur.u;
      const endT = u.t + (u.kind === 'flash' ? 0.7 : u.kind === 'he' ? 3 : u.duration);
      const live = t >= u.throwT && t <= endT;
      const flying = t >= u.throwT && t < u.t;
      ur.group.visible = live;
      ur.trail.visible = flying; ur.trailLine.visible = flying; ur.origin.visible = flying && t - u.throwT < 1.2;
      if (!live) continue;
      if (flying) {
        const f = flightAt(u.flight, t);
        const w = this.cellToWorld(f.x, f.y, f.h);
        ur.group.position.set(0, 0, 0);
        ur.proj.visible = true; ur.projGlow.visible = true;
        ur.proj.position.copy(w); ur.projGlow.position.copy(w);
        // Reveal the trail up to now; the newest point is the grenade itself.
        let n = 0;
        while (n < TRAIL_N && ur.trailT[n]! <= t) n++;
        const pos = ur.trail.geometry.attributes.position as THREE.BufferAttribute;
        if (n < TRAIL_N) { pos.setXYZ(n, w.x, w.y, w.z); pos.needsUpdate = true; n++; }
        ur.trail.geometry.setDrawRange(0, n);
        for (const p of ur.parts) p.visible = false;
        ur.ring.visible = false;
        continue;
      }
      ur.group.position.copy(this.worldOf(u.at));
      ur.proj.visible = u.kind === 'smoke' || u.kind === 'molotov';
      ur.projGlow.visible = false;
      ur.proj.position.set(0, 0.08, 0);
      ur.ring.visible = u.kind === 'smoke' || u.kind === 'molotov';
      const since = t - u.t;
      if (u.kind === 'smoke' && ur.smoke) {
        const sm = ur.smoke;
        const grow = 1 - Math.exp(-since * 3.2);
        const fade = Math.max(0, Math.min(1, (u.duration - since) / 3));
        const geo = sm.points.geometry;
        const P = geo.attributes.position as THREE.BufferAttribute, Z = geo.attributes.size as THREE.BufferAttribute;
        const A = geo.attributes.alpha as THREE.BufferAttribute, H = geo.attributes.shade as THREE.BufferAttribute;
        for (let i = 0; i < SMOKE_N; i++) {
          const sd = sm.seed[i]!;
          const dx = Math.sin(this.elapsed * 0.35 + sd) * 0.2, dz = Math.cos(this.elapsed * 0.3 + sd * 1.3) * 0.2;
          const lift = (1 - fade) * 0.8;
          const bx = sm.base[i * 3]!, by = sm.base[i * 3 + 1]!, bz = sm.base[i * 3 + 2]!;
          P.setXYZ(i, bx * grow * (1 + (1 - fade) * 0.15) + dx, 0.3 + (by - 0.3) * Math.min(1, grow * 1.15) + lift, bz * grow * (1 + (1 - fade) * 0.15) + dz);
          Z.setX(i, sm.size[i]! * (0.35 + 0.65 * grow) * (1 + (1 - fade) * 0.35));
          A.setX(i, 0.85 * Math.min(1, since / 0.12) * Math.pow(fade, 1.4));
          H.setX(i, Math.min(1, 0.35 + by / 3.2));
        }
        P.needsUpdate = true; Z.needsUpdate = true; A.needsUpdate = true; H.needsUpdate = true;
        sm.points.visible = true;
        ur.ring.scale.setScalar(u.radius * CELL * 0.9);
        (ur.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 * fade;
      } else if (u.kind === 'molotov') {
        const fade = Math.min(1, (u.duration - since) / 1.2);
        for (const p of ur.parts) {
          p.visible = true;
          if (p.userData.seed !== undefined) {
            const k = 0.75 + 0.35 * Math.sin(this.elapsed * 13 + (p.userData.seed as number));
            p.scale.set(1, k * fade, 1);
          } else {
            p.scale.setScalar(u.radius * CELL * Math.min(1, since / 0.4) * (0.95 + 0.05 * Math.sin(this.elapsed * 20)));
            ((p as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade;
          }
        }
        ur.ring.scale.setScalar(u.radius * CELL);
        (ur.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * fade;
      } else if (u.kind === 'flash') {
        // A short white burst where it popped in the air, a light pool on the floor, and a real light.
        const k = Math.min(1, since / 0.5);
        const sp = ur.parts[0] as THREE.Sprite, pool = ur.parts[1] as THREE.Mesh;
        sp.visible = since < 0.5; pool.visible = since < 0.7;
        sp.position.y = FLASH_POP_H + 0.1; sp.scale.setScalar(5 + 11 * Math.sqrt(k));
        (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, 1.3 * Math.pow(1 - k, 1.2));
        sp.material.rotation = since * 0.8;
        pool.position.y = 0.08; pool.scale.setScalar(4 + 6 * k);
        (pool.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.max(0, 1 - since / 0.7);
        if (since < 0.4 && since >= flashI) { flashI = since; flashPos = ur.group.position.clone(); flashPos.y += FLASH_POP_H; }
        if (since < 0.4 && !flashPos) { flashPos = ur.group.position.clone(); flashPos.y += FLASH_POP_H; flashI = since; }
      } else {
        const ball = ur.parts[0] as THREE.Mesh, scorch = ur.parts[1] as THREE.Mesh;
        const k = Math.min(1, since / 0.45);
        ball.visible = since < 0.45; ball.scale.setScalar(0.5 + u.radius * CELL * 0.8 * k);
        (ball.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        scorch.visible = true;
        (scorch.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0, 1 - since / 3);
      }
    }
    // One pooled light for flash bursts (kept in the scene so shaders never recompile).
    if (flashPos) { this.flashLight.position.copy(flashPos); this.flashLight.intensity = 220 * Math.pow(1 - flashI / 0.4, 2); }
    else this.flashLight.intensity = 0;
  }

  private updateBomb(tl: RoundTimeline, t: number) {
    const b = bombAt(tl, t);
    this.bomb.visible = !!b.at && b.state !== 'exploded';
    this.bombRing.visible = false;
    this.blast.visible = false;
    this.beacon.visible = false;
    if (!b.at) return;
    const w = this.worldOf(b.at);
    if (b.state === 'carried' && b.carrier) {
      const rig = this.rigById.get(b.carrier);
      if (rig) {
        const yaw = rig.body.rotation.y;
        this.bomb.position.set(rig.root.position.x - Math.sin(yaw) * 0.42, rig.root.position.y + 1.62, rig.root.position.z - Math.cos(yaw) * 0.42);
        this.bomb.rotation.y = yaw;
      }
      this.bombLed.color.set(b.progress > 0 && Math.sin(this.elapsed * 20) > 0 ? 0xff2a2a : 0x661010);
      if (b.progress > 0) {
        this.bombRing.visible = true;
        this.bombRing.position.set(w.x, w.y + 0.08, w.z);
        this.bombRing.scale.setScalar(0.6 + b.progress * 0.8);
        this.bombRingMat.color.set(0xff3b30); this.bombRingMat.opacity = 0.7;
      }
      return;
    }
    this.bomb.position.set(w.x, w.y + 0.14, w.z);
    this.bomb.rotation.y = 0.4;
    if (b.state === 'dropped') { this.bombLed.color.set(0x661010); return; }
    const plantT = tl.bomb.plantT ?? t;
    const left = BOMB_SECONDS - (t - plantT);
    const rate = left > 20 ? 1 : left > 10 ? 2 : left > 5 ? 4 : 8;
    const on = Math.sin((t - plantT) * Math.PI * 2 * rate) > 0;
    this.bombLed.color.set(on ? 0xff2a2a : 0x551010);
    if (b.state === 'planted' || b.state === 'defusing') {
      this.bombRing.visible = true;
      this.bombRing.position.set(w.x, w.y + 0.08, w.z);
      const pulse = ((t - plantT) * rate) % 1;
      this.bombRing.scale.setScalar(1 + pulse * 2.2);
      this.bombRingMat.color.set(b.state === 'defusing' ? 0x5aa9e6 : 0xff3b30);
      this.bombRingMat.opacity = 0.65 * (1 - pulse);
      this.beacon.visible = true;
      this.beacon.position.set(w.x, w.y, w.z);
      const bm = this.beacon.material as THREE.MeshBasicMaterial;
      bm.color.set(b.state === 'defusing' ? 0x5aa9e6 : 0xff3b30);
      bm.opacity = 0.2 + 0.15 * (on ? 1 : 0);
    }
    if (b.state === 'defused') { this.bombLed.color.set(0x2a7fff); }
    if (b.state === 'exploded' || (tl.bomb.exploded && t >= plantT + BOMB_SECONDS - 0.01)) {
      const since = t - (plantT + BOMB_SECONDS);
      if (since >= 0 && since < 1.6) {
        this.blast.visible = true;
        this.blast.position.set(w.x, w.y + 1, w.z);
        this.blast.scale.setScalar(2 + since * 14);
        (this.blast.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - since / 1.6);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Camera

  setTilt(t: Tilt) { this.tilt = t; this.pitch = t === 'top' ? 1.52 : this.mode === 'follow' ? 1.2 : 0.95; this.resize(); }

  setMode(mode: CameraMode) {
    this.mode = mode;
    if (mode === 'overview') this.resetView(false);
    if (mode === 'follow') { this.dist = Math.min(this.dist, this.canvas.clientWidth < 520 ? 19 : 26); if (this.tilt === 'iso') this.pitch = 1.2; if (!this.followId) this.followId = this.rigs.find((r) => r.track.deathT === null)?.track.id ?? this.rigs[0]?.track.id ?? null; }
    this.events.onCameraMode?.(mode);
  }

  follow(id: string | null) {
    this.followId = id;
    if (id) { this.mode = 'follow'; this.dist = Math.min(this.dist, this.canvas.clientWidth < 520 ? 19 : 26); if (this.tilt === 'iso') this.pitch = 1.2; this.events.onCameraMode?.('follow'); }
  }

  resetView(instant: boolean) {
    this.target.set(0, 0, 0);
    this.dist = this.overviewDist;
    this.yaw = 0;
    this.pitch = this.tilt === 'top' ? 1.52 : 0.95;
    if (instant) { this.cur.target.copy(this.target); this.cur.dist = this.dist; this.cur.yaw = this.yaw; this.cur.pitch = this.pitch; }
  }

  /** Dev-only camera presets for screenshot audits. */
  debugCam(name: string) {
    const g = this.geo;
    this.mode = 'free';
    const site = (k: 'A' | 'B') => { const c = g.sites[k].center; return this.cellToWorld(c[0] + 0.5, c[1] + 0.5, g.height[c[1] * g.w + c[0]]!); };
    if (name === 'top') { this.resetView(false); this.pitch = 1.52; }
    else if (name === 'close') { this.target.copy(site('A')); this.dist = 34; this.pitch = 0.9; this.yaw = 0.5; }
    else if (name === 'closeB') { this.target.copy(site('B')); this.dist = 34; this.pitch = 0.9; this.yaw = -0.6; }
    else if (name === 'low') { this.resetView(false); this.pitch = 0.42; this.dist = this.overviewDist * 1.05; this.yaw = 0.7; }
    else if (name === 'edge') { this.target.copy(this.cellToWorld(g.w * 0.92, g.h * 0.9)); this.dist = 60; this.pitch = 0.75; this.yaw = -0.6; }
    else if (name === 'player' || name === 'playerCT') {
      const alive = this.rigs.filter((x) => x.track.deathT === null);
      const r = alive.find((x) => x.track.side === (name === 'player' ? 'T' : 'CT')) ?? alive[0] ?? this.rigs[0];
      if (r) { this.target.copy(r.root.position); this.target.y += 1.2; this.dist = 7; this.pitch = 0.6; this.yaw = r.body.rotation.y + 0.5; }
    }
  }

  /** Slow cinematic orbit for the title screen, low and wide around the middle of the map. */
  titleCam(sec: number, instant = false) {
    const g = this.geo;
    const a = g.sites.A.center, b = g.sites.B.center;
    this.mode = 'free';
    this.target.copy(this.cellToWorld((a[0] + b[0]) / 2 + 0.5, (a[1] + b[1]) / 2 + 0.5));
    this.yaw = 0.5 + sec * 0.04;
    this.pitch = 0.58 + Math.sin(sec * 0.11) * 0.07;
    this.dist = this.overviewDist * (0.6 + Math.sin(sec * 0.07) * 0.05);
    if (instant) { this.cur.target.copy(this.target); this.cur.dist = this.dist; this.cur.yaw = this.yaw; this.cur.pitch = this.pitch; }
  }

  zoomBy(f: number) { this.dist = Math.max(10, Math.min(this.overviewDist * 1.6, this.dist * f)); }

  private updateCamera(dt: number) {
    if (this.mode === 'follow' && this.followId) {
      const rig = this.rigById.get(this.followId);
      if (rig) this.target.set(rig.root.position.x, rig.root.position.y, rig.root.position.z);
    }
    const k = 1 - Math.exp(-dt * 7);
    this.cur.target.lerp(this.target, k);
    this.cur.dist += (this.dist - this.cur.dist) * k;
    this.cur.yaw += (this.yaw - this.cur.yaw) * k;
    this.cur.pitch += (this.pitch - this.cur.pitch) * k;
    const { target, dist, yaw, pitch } = this.cur;
    this.camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.up.copy(UP);
    this.camera.lookAt(target);
    // Callouts fade when zoomed out far, labels stay readable.
    for (const o of this.mapGroup.children) if (o.userData.callout) o.visible = this.showLabels && dist < this.overviewDist * 1.1;
  }

  /** Keep sprites a constant size on screen whatever the zoom. */
  private scaleSprites() {
    const h = Math.max(1, this.canvas.clientHeight);
    const px = (world: THREE.Vector3, sizePx: number) => {
      const d = this.camera.position.distanceTo(world);
      return (2 * Math.tan((this.camera.fov * Math.PI) / 360) * d * sizePx) / h;
    };
    const small = this.canvas.clientWidth < 520;
    // Name plates: scale to a fixed pixel size, then nudge overlapping ones apart
    // along the screen's vertical so stacked players stay readable.
    this.camera.updateMatrixWorld();
    const camUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const lh = small ? 20 : 25;
    const plates: { r: Rig; x: number; y: number; w: number; s: number }[] = [];
    const sv = new THREE.Vector3();
    for (const r of this.rigs) {
      if (!r.label.visible) continue;
      const s = px(r.label.position, lh);
      r.label.scale.set(s * (r.label.userData.aspect as number), s, 1);
      sv.copy(r.label.position).project(this.camera);
      plates.push({ r, x: (sv.x + 1) / 2 * this.canvas.clientWidth, y: (1 - sv.y) / 2 * h, w: lh * (r.label.userData.aspect as number) * 0.55, s });
    }
    plates.sort((a, b) => b.y - a.y);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const done: { x: number; y: number; w: number }[] = [];
    const lead = this.leaderPos;
    let segs = 0;
    for (const p of plates) {
      const cw = this.canvas.clientWidth;
      const free = (x: number, y: number) => y > 64 && (x === p.x || (x - p.w > 2 && x + p.w < cw - 2)) && !done.some((d) => Math.abs(d.x - x) < d.w + p.w && Math.abs(d.y - y) < lh * 1.02);
      // Candidate spots nearest first: up/down (two rows), then sideways, then further out.
      const step = lh * 1.05, side = p.w * 2 + 6;
      const cands: [number, number][] = [[0, 0], [0, -step], [0, step], [0, -2 * step], [0, 2 * step], [-side, 0], [side, 0], [-side, -step], [side, -step], [-side, step], [side, step], [0, -3 * step], [0, 3 * step]];
      let dx = 0, dy = 0;
      for (const [cx, cy] of cands) if (free(p.x + cx, p.y + cy)) { dx = cx; dy = cy; break; }
      if (dx || dy) {
        p.r.label.position.addScaledVector(camUp, -dy / lh * p.s).addScaledVector(camRight, dx / lh * p.s);
        // Thin leader from the player's head to the moved plate.
        if (segs < 16) {
          const a = p.r.root.position, b = p.r.label.position;
          lead.set([a.x, a.y + 2.9, a.z, b.x, b.y - p.s * 0.45, b.z], segs * 6);
          const c = this.teamColor(p.r.track);
          this.leaderCol.set([c.r, c.g, c.b, c.r * 0.6, c.g * 0.6, c.b * 0.6], segs * 6);
          segs++;
        }
      }
      done.push({ x: p.x + dx, y: p.y + dy, w: p.w });
    }
    this.leaders.geometry.setDrawRange(0, segs * 2);
    (this.leaders.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.leaders.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.leaders.visible = segs > 0;
    for (const r of this.rigs) {
      if (!r.dot.visible) continue;
      // A dot of ~13px, hidden once the model itself is bigger than that on screen.
      const s = px(r.dot.position, small ? 13 : 15);
      r.dot.visible = s > 1.1;
      r.dot.scale.set(s, s, 1);
    }
    // Callouts: biggest areas first; skip any that would overlap one already shown.
    this.camera.updateMatrixWorld();
    const placed: [number, number, number, number][] = [];
    const W = this.canvas.clientWidth;
    const pv = new THREE.Vector3();
    for (const r of this.rigs) {
      if (!r.label.visible) continue;
      pv.copy(r.label.position).project(this.camera);
      const lh = small ? 20 : 25;
      placed.push([(pv.x + 1) / 2 * W, (1 - pv.y) / 2 * h, lh * (r.label.userData.aspect as number) / 2, lh / 2]);
    }
    const callouts = this.mapGroup.children.filter((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible);
    callouts.sort((a, b) => ((b.userData.area as number) ?? 0) - ((a.userData.area as number) ?? 0));
    const v = new THREE.Vector3();
    for (const o of callouts) {
      const hPx = small ? 15 : 18;
      const s = px(o.position, hPx);
      o.scale.set(s * (o.userData.aspect as number), s, 1);
      if (!o.userData.callout) continue;
      v.copy(o.position).project(this.camera);
      const cx = (v.x + 1) / 2 * W, cy = (1 - v.y) / 2 * h;
      const bw = hPx * (o.userData.aspect as number) / 2 + 3, bh = hPx / 2 + 3;
      if (placed.some(([x, y, w2, h2]) => Math.abs(x - cx) < w2 + bw && Math.abs(y - cy) < h2 + bh)) { o.visible = false; continue; }
      placed.push([cx, cy, bw, bh]);
    }
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Nudge the picture down a little: the score bug covers the top of the stage.
    this.camera.setViewOffset(w, h, 0, -h * 0.035, w, h);
    this.overviewDist = this.fitDistance(w / h);
    if (this.mode === 'overview') this.dist = this.overviewDist;
    this.camera.updateProjectionMatrix();
    this.shared.smokePts.uniforms.scale!.value = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Closest overview distance at which every corner of the diorama is on screen. */
  private fitDistance(aspect: number): number {
    const cam = new THREE.PerspectiveCamera(this.camera.fov, aspect, 0.5, 2000);
    cam.setViewOffset(aspect * 100, 100, 0, -3.5, aspect * 100, 100);
    const pitch = this.tilt === 'top' ? 1.52 : 0.95;
    const hw = (this.geo.w * CELL) / 2 + 1.5, hh = (this.geo.h * CELL) / 2 + 1.5;
    const corners: THREE.Vector3[] = [];
    for (const x of [-hw, hw]) for (const z of [-hh, hh]) for (const y of [-1.3, WALL_HEIGHT]) corners.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      cam.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d);
      cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      return corners.every((c) => { v.copy(c).project(cam); return Math.abs(v.x) <= 0.97 && v.y <= 0.8 && v.y >= -0.86 && v.z < 1; });
    };
    let lo = 10, hi = 2000;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  private toFree() {
    if (this.mode !== 'free') { this.mode = 'free'; this.events.onCameraMode?.('free'); }
  }

  private panPixels(dx: number, dy: number) {
    const h = Math.max(1, this.canvas.clientHeight);
    const worldPerPx = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.cur.dist) / h;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const tiltK = 1 / Math.max(0.6, Math.sin(this.cur.pitch));
    this.target.addScaledVector(right, -dx * worldPerPx).addScaledVector(fwd, dy * worldPerPx * tiltK);
    const lim = Math.max(this.geo.w, this.geo.h) * CELL * 0.6;
    this.target.x = Math.max(-lim, Math.min(lim, this.target.x));
    this.target.z = Math.max(-lim, Math.min(lim, this.target.z));
    this.cur.target.copy(this.target);
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button === 2 || e.shiftKey ? 2 : 0 };
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), a: Math.atan2(b!.y - a!.y, b!.x - a!.x) }; this.drag = null; }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const ang = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      if (d > 0 && this.pinch.d > 0) this.zoomBy(this.pinch.d / d);
      this.yaw += ang - this.pinch.a;
      this.pinch = { d, a: ang };
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.drag.moved < 4) return;
    if (this.drag.button === 2) { this.yaw -= dx * 0.008; this.pitch = Math.max(0.55, Math.min(1.52, this.pitch + dy * 0.006)); return; }
    this.toFree();
    this.panPixels(dx, dy);
  };

  private onUp = (e: PointerEvent) => {
    const wasClick = this.drag && this.drag.moved < 5 && this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (wasClick && e.type === 'pointerup') this.pick(e);
    if (this.pointers.size === 0) this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.exp(e.deltaY * 0.0012));
  };

  private onDbl = () => { this.followId = null; this.setMode('overview'); };
  private onCtx = (e: Event) => e.preventDefault();
  private onLost = (e: Event) => { e.preventDefault(); this.events.onContextLost?.(); };

  private pick(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    // Screen-space pick (generous on touch): nearest living player to the tap.
    let best: Rig | null = null, bd = e.pointerType === 'touch' ? 0.12 : 0.07;
    for (const r of this.rigs) {
      if (!r.ring.visible) continue;
      const p = r.root.position.clone(); p.y += 1; p.project(this.camera);
      const d = Math.hypot(p.x - ndc.x, (p.y - ndc.y) * (rect.height / rect.width));
      if (d < bd) { bd = d; best = r; }
    }
    if (best) { this.follow(best.track.id); this.events.onPick?.(best.track.id); }
  }

  /** Renders one frame to a data URL (used by tests and screenshots). */
  snapshot(): string { return this.canvas.toDataURL('image/png'); }

  dispose() {
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('dblclick', this.onDbl);
    c.removeEventListener('contextmenu', this.onCtx);
    c.removeEventListener('webglcontextlost', this.onLost);
    this.clearRound();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
    releaseSurfaces();
    this.renderer.dispose();
    const w = window as unknown as { __vinfo?: unknown };
    if (w.__vinfo) delete w.__vinfo;
  }
}
