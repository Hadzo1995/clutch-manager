/**
 * The home screen's lobby: your starting five standing on a lit stage in your club's colours,
 * like a game's main menu. Each player has a name tag (handle, role, OVR) that opens their
 * profile. The five are counter-terrorist operators (the match viewer's figures with their idle
 * animation) in three unit looks, shirts and patches in the club colour, each holding a carbine
 * low across the body; the AWPer holds a sniper rifle.
 *
 * The scene only renders while it is on screen and the tab is visible, at about 30 frames a
 * second (pacing.ts). On machines that can't keep up it draws fewer pixels, then stops redrawing
 * shadows, then lets the five stand still. Without WebGL, with reduced motion or if the figure
 * cannot load, the caller's fallback is shown instead.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Rarity, Role } from '../../engine/types';
import { ROLE_LABEL } from '../../engine/types';
import { carryMatrix, driveHuman, humanFailed, loadHuman, makeHuman } from '../arena/human';
import type { Human } from '../arena/human';
import { addRim } from '../arena/models';
import { carryAcross, weaponMaterial, weaponModel } from '../arena/weapons';
import { webglAvailable } from '../arena/Viewer3D';
import { shaftMaterial } from '../case3d/fx';
import { FrameWatch, frameDue } from './pacing';
import { RoleIcon } from '../common';
import { reducedMotion } from '../motion';
import '../styles/lobby.css';

export interface LineupMember { cardId: string; handle: string; role: Role; ovr: number; rarity: Rarity }

/** Where each of the five stands: the middle player in front, the others fanned out behind. */
const SPOTS: [number, number, number][] = [
  [-2.6, -1.1, 0.34], [-1.32, -0.48, 0.18], [0, 0, 0], [1.32, -0.48, -0.18], [2.6, -1.1, -0.34],
];
/** Which operator look each spot wears: urban unit in the middle, gas masks beside it, rangers outside. */
const LOOK_AT = [1, 2, 0, 2, 1];

interface Figure {
  h: Human;
  head: THREE.Object3D;
  gun: THREE.Mesh;
  /** The weapon's place on the chest (bind space) and the wrist targets on it (gun space). */
  carry: THREE.Matrix4;
  grip: THREE.Vector3;
  guard: THREE.Vector3;
  /** The figure's right, for the elbows. */
  right: THREE.Vector3;
}

function floorTexture(tag: string, color: THREE.Color): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const hex = `#${color.getHexString()}`;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.03)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // Rings and tick marks, like a stage floor.
  g.strokeStyle = hex; g.globalAlpha = 0.55; g.lineWidth = 6;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.22; g.lineWidth = 2;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, r0 = S * 0.47, r1 = S * (i % 6 === 0 ? 0.5 : 0.485);
    g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0); g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1); g.stroke();
  }
  // The club tag written large across the floor.
  g.globalAlpha = 0.16; g.fillStyle = hex;
  g.font = `700 ${Math.round(S * 0.2)}px "Chakra Petch", "Segoe UI", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(tag.toUpperCase().slice(0, 4), S / 2, S * 0.66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class Lobby {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private figures: Figure[] = [];
  private disposables: { dispose(): void }[] = [];
  private shafts: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>[] = [];
  private raf = 0;
  private last = 0;
  private t = 0;
  private running = false;
  private size = { w: 1, h: 1 };
  private v = new THREE.Vector3();
  private gw = new THREE.Vector3();
  private lw = new THREE.Vector3();
  labels: (HTMLElement | null)[] = [];
  private hoverAt = -1;
  /** The tag under the pointer; its player lights up. */
  get hover() { return this.hoverAt; }
  set hover(i: number) { if (i !== this.hoverAt) { this.hoverAt = i; this.redraw = Math.max(this.redraw, 15); } }
  /** On machines that can't keep up the five stand still and the stage only redraws for a hover or a resize. */
  private still = false;
  /** Frames still to draw in that mode (enough for the light under a player to fade in or out). */
  private redraw = 0;

  constructor(canvas: HTMLCanvasElement, roles: Role[], color: THREE.Color, tag: string, hq: boolean) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = hq;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hq ? 1.5 : 1.25));
    this.renderer = r;
    const keep = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = keep(pmrem.fromScene(new RoomEnvironment(r), 0.04).texture);
    pmrem.dispose();

    // Floor: a dark glossy stage with rings and the club tag.
    const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(4.6, hq ? 96 : 48)), keep(new THREE.MeshPhysicalMaterial({ color: '#07090c', roughness: 0.42, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.18 })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const deco = new THREE.Mesh(keep(new THREE.PlaneGeometry(9.2, 9.2)), keep(new THREE.MeshBasicMaterial({ map: keep(floorTexture(tag, color)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
    deco.rotation.x = -Math.PI / 2;
    deco.position.y = 0.004;
    this.scene.add(deco);

    // Light: a key from the front, the club colour behind, and a shaft of light over each player.
    const key = new THREE.SpotLight('#fff3e2', 150, 0, 0.55, 0.75, 2);
    key.position.set(1.5, 7.5, 6);
    key.target.position.set(0, 0.8, -0.4);
    key.castShadow = hq;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key, key.target);
    const rimL = new THREE.DirectionalLight(color, 3.2); rimL.position.set(-5, 3, -5);
    const rimR = new THREE.DirectionalLight(color, 2.4); rimR.position.set(5, 2.5, -4.5);
    const fill = new THREE.DirectionalLight('#9fb8d8', 0.28); fill.position.set(0, 2, 8);
    this.scene.add(rimL, rimR, fill, new THREE.HemisphereLight('#b9c8e8', '#05070a', 0.2));

    // Shirts in a dark, muted shade of the club colour and patches in the club colour; the coloured
    // rim light does the rest.
    const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
    const shirt = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.35) * 0.7, 0.15, THREE.SRGBColorSpace);
    const gunMat = keep(weaponMaterial());
    roles.forEach((role, i) => {
      const h = makeHuman('CT', (m) => addRim(m, color), LOOK_AT[i] ?? i);
      if (!h) return;
      for (const m of h.kit) m.color.copy(shirt);
      h.accent.color.copy(color);
      // Less fill from the room, so the key and rim lights shape the figures as in a game menu.
      for (const m of h.meshes) (m.material as THREE.MeshStandardMaterial).envMapIntensity = 0.55;
      const [x, z, yaw] = SPOTS[i] ?? [0, 0, 0];
      h.root.position.set(x, 0, z);
      h.root.rotation.y = Math.PI + yaw; // the figure faces -z; turn it to the camera
      this.scene.add(h.root);
      const head = h.root.getObjectByName('mixamorigHead') ?? h.root;
      const w = weaponModel(role === 'awp' ? 'sniper' : 'carbine');
      const gun = new THREE.Mesh(w.geo, gunMat);
      gun.castShadow = true;
      gun.matrixAutoUpdate = false;
      this.scene.add(gun);
      const c = carryAcross(w);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(h.root.quaternion);
      this.figures.push({ h, head, gun, carry: c.m, grip: c.grip, guard: c.guard, right });
      const shaft = new THREE.Mesh(keep(new THREE.ConeGeometry(0.85, 5.2, 32, 1, true)), keep(shaftMaterial(new THREE.Color('#ffffff').lerp(color, 0.35), 'tip', 1.4)));
      shaft.material.uniforms.uOpacity!.value = i === 2 ? 0.2 : 0.13;
      shaft.position.set(x, 2.6, z);
      this.scene.add(shaft);
      this.shafts.push(shaft);
    });
    this.camera.position.set(0, 1.6, 7.6);
  }

  resize(w: number, h: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    // Keep all five in frame on narrow screens by pulling the camera back.
    const fitW = 6.3, fitH = 2.3;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const distH = fitH / 2 / Math.tan(vfov / 2);
    const distW = fitW / 2 / (Math.tan(vfov / 2) * this.camera.aspect);
    this.dist = Math.max(distH, distW) + 1.2;
    // On small stages, aim a little higher so the five sit lower in the frame and two rows of
    // name tags fit above their heads.
    const pxPerM = this.size.h / (2 * this.dist * Math.tan(vfov / 2));
    const room = (this.size.h / 2 / pxPerM - (1.78 - 1.02)) * pxPerM;
    const need = 0.4 * pxPerM + 2 * (this.tagH || 30) + 16;
    this.lookY = 1.02 + THREE.MathUtils.clamp((need - room) / pxPerM, 0, 0.5);
    this.tagW = 0; // measure the tags again at the new size
    this.redraw = Math.max(this.redraw, 2); // a resize clears the picture
    this.camera.updateProjectionMatrix();
  }
  private dist = 7.6;
  private lookY = 1.02;
  private tagW = 0;
  private tagH = 0;
  private stacked = false;
  private lift = 0;
  private pts: { x: number; y: number; up: number }[] = [];

  setRunning(on: boolean) {
    if (on === this.running) return;
    this.running = on;
    if (on) {
      this.last = 0;
      const loop = (now: number) => {
        if (!this.running) return;
        this.raf = requestAnimationFrame(loop);
        if (!frameDue(now, this.last)) return;
        if (this.still) { if (this.redraw <= 0) return; this.redraw--; }
        const gap = this.last ? now - this.last : 0;
        this.last = now;
        this.adapt(gap);
        this.frame(gap ? Math.min(0.05, gap / 1000) : 0.016);
      };
      this.raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(this.raf);
  }

  /**
   * If frames keep coming slower than about 24 a second, first draw at one pixel per screen pixel,
   * then keep the last shadow picture instead of redrawing it (the five barely move), and last let
   * the five stand still. The same idea as the match viewer's quality steps; it never steps back up
   * while the stage is open.
   */
  private watch = new FrameWatch();
  private adapt(gap: number) {
    if (!this.watch.stepDown(gap)) return;
    const r = this.renderer;
    if (r.getPixelRatio() > 1) r.setPixelRatio(1);
    else if (r.shadowMap.enabled && r.shadowMap.autoUpdate) { r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; }
    else { this.still = true; this.watch.done = true; }
  }

  private frame(dt: number) {
    this.t += dt;
    const t = this.t;
    // A slow drift, as if a camera on a crane were sweeping the stage.
    const sway = Math.sin(t * 0.12) * 0.3;
    this.camera.position.set(Math.sin(sway) * this.dist, 1.5 + Math.sin(t * 0.2) * 0.05, Math.cos(sway) * this.dist - 0.4);
    this.camera.lookAt(0, this.lookY, -0.45);
    this.figures.forEach((f, i) => {
      // Idle animation, then the weapon on the chest and the hands on the weapon.
      driveHuman(f.h, { gait: 0, dt, dead: false, hold: () => {
        carryMatrix(f.h, 'Spine2', f.carry, f.gun.matrix);
        f.gun.matrixWorld.copy(f.gun.matrix);
        return { grip: this.gw.copy(f.grip).applyMatrix4(f.gun.matrix), guard: this.lw.copy(f.guard).applyMatrix4(f.gun.matrix), right: f.right };
      } });
      const lit = this.hover === i;
      f.h.body.emissive?.setScalar(lit ? 0.06 : 0);
      const s = this.shafts[i];
      if (s) s.material.uniforms.uOpacity!.value += ((lit ? 0.32 : i === 2 ? 0.2 : 0.13) - s.material.uniforms.uOpacity!.value) * Math.min(1, dt * 6);
    });
    this.renderer.render(this.scene, this.camera);
    // Name tags follow the heads, every other one a little higher. When the stage is too narrow
    // for the tags to sit side by side (phones), every other tag moves up a whole row instead.
    if (!this.tagW) for (const el of this.labels) if (el) { this.tagW = Math.max(this.tagW, el.offsetWidth); this.tagH = Math.max(this.tagH, el.offsetHeight); }
    let gap = Infinity;
    this.figures.forEach((f, i) => {
      f.head.getWorldPosition(this.v);
      const hy = this.v.y;
      this.v.y = hy + 0.4;
      this.v.project(this.camera);
      const x = (this.v.x * 0.5 + 0.5) * this.size.w, y = (-this.v.y * 0.5 + 0.5) * this.size.h;
      f.head.getWorldPosition(this.v);
      this.v.y = hy + 0.66;
      this.v.project(this.camera);
      this.pts[i] = { x, y, up: y - (-this.v.y * 0.5 + 0.5) * this.size.h };
      if (i) gap = Math.min(gap, Math.abs(x - this.pts[i - 1]!.x) - this.tagW);
    });
    if (this.tagW) this.stacked = this.stacked ? gap < 14 : gap < 4;
    this.lift += ((this.stacked ? 1 : 0) - this.lift) * Math.min(1, dt * 8);
    this.figures.forEach((_, i) => {
      const el = this.labels[i], p = this.pts[i];
      if (!el || !p) return;
      const up = i % 2 ? p.up + (this.tagH + 6 - p.up) * this.lift : 0;
      el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${(p.y - up).toFixed(1)}px)`;
    });
  }

  dispose() {
    this.setRunning(false);
    for (const d of this.disposables) d.dispose();
    for (const f of this.figures) {
      f.h.mixer.stopAllAction();
      for (const m of f.h.meshes) (m.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }
}

/** True when the lobby can be shown: WebGL, full motion and the figure available. */
export function lobbyPossible(): boolean {
  return webglAvailable() && !reducedMotion() && !humanFailed();
}

export function LineupStage({ members, color, tag, onOpen, fallback, children, title, subtitle, onEdit, stats, side }: {
  members: LineupMember[];
  /** The club colour (CSS colour string). */
  color: string;
  tag: string;
  onOpen: (cardId: string) => void;
  fallback: ReactNode;
  /** Shown over the stage (the next-match panel). */
  children?: ReactNode;
  /** On wide screens: the club name written large over the stage, with a line under it. */
  title?: string;
  subtitle?: string;
  /** On wide screens: an "Edit lineup" button over the stage. */
  onEdit?: () => void;
  /** On wide screens: a row of team numbers along the bottom of the stage. */
  stats?: { label: string; value: ReactNode }[];
  /** More panels for the column beside the stage, under the children. */
  side?: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lobbyRef = useRef<Lobby | null>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() => (lobbyPossible() ? 'loading' : 'failed'));
  const key = members.map((m) => m.cardId).join('|');

  useEffect(() => {
    if (state === 'failed') return;
    let alive = true;
    let lobby: Lobby | null = null;
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    const host = hostRef.current!, canvas = canvasRef.current!;
    let visible = true;
    const sync = () => lobby?.setRunning(visible && !document.hidden);
    const lost = (e: Event) => { e.preventDefault(); setState('failed'); };
    canvas.addEventListener('webglcontextlost', lost);
    void Promise.all([loadHuman(), document.fonts?.load('700 40px "Chakra Petch"').catch(() => undefined)]).then(() => {
      if (!alive) return;
      if (humanFailed()) { setState('failed'); return; }
      try {
        const hq = !window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth >= 900;
        lobby = new Lobby(canvas, members.map((m) => m.role), new THREE.Color(color), tag, hq);
      } catch {
        setState('failed');
        return;
      }
      lobbyRef.current = lobby;
      lobby.labels = labelRefs.current;
      const fit = () => { const r = host.getBoundingClientRect(); lobby?.resize(r.width, r.height); };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(host);
      io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); sync(); });
      io.observe(host);
      document.addEventListener('visibilitychange', sync);
      sync();
      setState('ready');
    });
    return () => {
      alive = false;
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      canvas.removeEventListener('webglcontextlost', lost);
      lobby?.dispose();
      lobbyRef.current = null;
    };
    // The scene is rebuilt when the five change or the club colour changes.
  }, [key, color, tag, state === 'failed']);

  if (state === 'failed') return <>{fallback}{children}{side}</>;
  return (
    <div className={`lb-lobby ${state}`} style={{ ['--club' as string]: color }}>
      <div className="lb-kicker"><span>Starting five</span><b>{tag}</b></div>
      <div className="lb-stage" ref={hostRef}>
        <canvas ref={canvasRef} aria-hidden="true" />
        {(title || onEdit || stats) && (
          <div className="lb-over">
            {title && <div className="lb-title"><span>Starting five</span><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>}
            {onEdit && <button type="button" className="btn lb-edit" onClick={onEdit}>Edit lineup</button>}
            {stats && <dl className="lb-stats">{stats.map((x) => <div key={x.label}><dt>{x.label}</dt><dd className="num">{x.value}</dd></div>)}</dl>}
          </div>
        )}
        <div className="lb-tags">
          {members.map((m, i) => (
            <button key={m.cardId} ref={(el) => { labelRefs.current[i] = el; }} className={`lb-tag r-${m.rarity}`}
              onClick={() => onOpen(m.cardId)}
              onPointerEnter={() => { if (lobbyRef.current) lobbyRef.current.hover = i; }}
              onPointerLeave={() => { if (lobbyRef.current) lobbyRef.current.hover = -1; }}
              aria-label={`${m.handle}, ${ROLE_LABEL[m.role]}, ${m.ovr} OVR. Open profile`}>
              <span className="lb-ovr num">{m.ovr}</span>
              <span className="lb-name">{m.handle}</span>
              <span className="lb-role"><RoleIcon role={m.role} />{ROLE_LABEL[m.role]}</span>
            </button>
          ))}
        </div>
      </div>
      {(children || side) && <div className="lb-side">{children}{side}</div>}
    </div>
  );
}
