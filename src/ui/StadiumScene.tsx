/**
 * The menu backdrop: a 3D esports arena built in code. A lit stage with both team booths and their
 * monitors, a giant LED wall showing your club, a tiered crowd with phone lights, moving light beams in
 * the haze, your starting five (and your next opponent's) lined up with name plates, and a camera that
 * drifts slowly around the room. Desktop only, about 30 fps, paused while
 * hidden or during a match; reduced motion shows one still frame.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { webglAvailable } from './arena/Viewer3D';
import { buildSoldier, soldierKit } from './arena/models';
import type { Soldier } from './arena/models';
import { ROLE_LABEL } from '../engine/types';
import type { Role } from '../engine/types';

/** One of your starting five, as shown on stage. */
export interface StagePlayer { id: string; handle: string; role: Role }

const KEY = 'clutch-manager.stadium';
export const stadiumOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setStadiumOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

const T = new THREE.Color('#f0a33a'), CT = new THREE.Color('#5aa9e6');

function screenTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, g, c };
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function buildArena(scene: THREE.Scene, teamName: string, teamTag: string) {
  const disposables: { dispose(): void }[] = [];
  const keep = <X extends { dispose(): void }>(x: X) => { disposables.push(x); return x; };
  scene.background = new THREE.Color('#05070b');
  scene.fog = new THREE.FogExp2('#0a0d14', 0.012);

  scene.add(new THREE.HemisphereLight(0x8090b0, 0x0a0806, 0.35));
  const key = new THREE.SpotLight(0xffe2b0, 900, 90, 0.5, 0.6, 1.6);
  key.position.set(0, 30, 26); key.target.position.set(0, 2, 0);
  scene.add(key, key.target);
  for (const [x, c] of [[-16, T], [16, CT]] as const) {
    const l = new THREE.PointLight(c, 260, 40, 1.8);
    l.position.set(x, 7, 4); scene.add(l);
  }

  // Floor and stage.
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(240, 240)), keep(new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.45, metalness: 0.3 })));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const stageMat = keep(new THREE.MeshStandardMaterial({ color: 0x151b24, roughness: 0.5, metalness: 0.4 }));
  const stage = new THREE.Mesh(keep(new THREE.BoxGeometry(34, 1.6, 13)), stageMat);
  stage.position.set(0, 0.8, -2); scene.add(stage);
  const edgeMat = keep(new THREE.MeshBasicMaterial({ color: 0xf0a33a }));
  const edge = new THREE.Mesh(keep(new THREE.BoxGeometry(34.2, 0.12, 0.12)), edgeMat);
  edge.position.set(0, 1.6, 4.55); scene.add(edge);
  const step = new THREE.Mesh(keep(new THREE.BoxGeometry(14, 0.5, 2)), stageMat);
  step.position.set(0, 0.25, 5.4); scene.add(step);

  // Team booths: a desk, five glowing monitors and chairs on each side.
  const deskMat = keep(new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.6, metalness: 0.3 }));
  const chairMat = keep(new THREE.MeshStandardMaterial({ color: 0x0f1318, roughness: 0.7 }));
  const deskGeo = keep(new THREE.BoxGeometry(11, 1.1, 1.8));
  const monGeo = keep(new THREE.BoxGeometry(1.4, 0.85, 0.08));
  const chairGeo = keep(new THREE.BoxGeometry(0.8, 1.6, 0.8));
  for (const [x, c] of [[-9.5, T], [9.5, CT]] as const) {
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(x, 2.15, -1); scene.add(desk);
    const strip = new THREE.Mesh(keep(new THREE.BoxGeometry(11, 0.1, 0.05)), keep(new THREE.MeshBasicMaterial({ color: c })));
    strip.position.set(x, 1.75, -0.08); scene.add(strip);
    const monMat = keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.9) }));
    for (let i = 0; i < 5; i++) {
      const mx = x - 4.4 + i * 2.2;
      const mon = new THREE.Mesh(monGeo, monMat);
      mon.position.set(mx, 3.25, -1.5); mon.rotation.y = Math.PI; scene.add(mon);
      const chair = new THREE.Mesh(chairGeo, chairMat);
      chair.position.set(mx, 2.4, -3); scene.add(chair);
    }
  }

  // The LED wall: your club in big type, redrawn with a moving scan line.
  const wall = screenTexture(() => {}, 1024, 400);
  let vsTag = '', vsColor = '#5aa9e6', lastT = 0;
  const drawWall = (t: number) => {
    lastT = t;
    const { g, c } = wall;
    const W = c.width, H = c.height;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a0f05'); bg.addColorStop(0.5, '#0b0f16'); bg.addColorStop(1, '#06101c');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.25; g.fillStyle = '#f0a33a';
    for (let i = 0; i < 14; i++) g.fillRect(((i * 97 + t * 160) % (W + 200)) - 100, 0, 3, H);
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (vsTag) {
      // Match day: your tag in amber, theirs in blue.
      g.font = "700 130px 'Chakra Petch', 'Segoe UI', sans-serif";
      g.fillStyle = '#ffcf80'; g.shadowColor = '#f0a33a'; g.shadowBlur = 30;
      g.fillText(teamTag.toUpperCase(), W * 0.27, H * 0.42);
      g.fillStyle = vsColor === '#5aa9e6' ? '#bfe2ff' : '#ffffff'; g.shadowColor = vsColor;
      g.fillText(vsTag.toUpperCase(), W * 0.73, H * 0.42);
      g.shadowBlur = 0;
      g.font = "600 56px 'Chakra Petch', 'Segoe UI', sans-serif"; g.fillStyle = 'rgba(232,237,243,0.7)';
      g.fillText('VS', W / 2, H * 0.42);
    } else {
      g.font = "700 150px 'Chakra Petch', 'Segoe UI', sans-serif";
      g.fillStyle = '#ffcf80'; g.shadowColor = '#f0a33a'; g.shadowBlur = 30;
      g.fillText(teamTag.toUpperCase(), W / 2, H * 0.42);
      g.shadowBlur = 0;
    }
    g.font = "600 46px 'Chakra Petch', 'Segoe UI', sans-serif";
    g.fillStyle = '#e8edf3';
    g.fillText(vsTag ? 'NEXT MATCH' : teamName.toUpperCase(), W / 2, H * 0.74);
    const y = ((t * 0.35) % 1) * H;
    const sg = g.createLinearGradient(0, y - 30, 0, y + 30);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.12)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(0, y - 30, W, 60);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let r = 0; r < H; r += 4) g.fillRect(0, r, W, 1);
    wall.tex.needsUpdate = true;
  };
  drawWall(0);
  keep(wall.tex);
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 10.2)), keep(new THREE.MeshBasicMaterial({ map: wall.tex })));
  screen.position.set(0, 10.5, -9.2); scene.add(screen);
  const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(27, 11.2, 0.5)), deskMat);
  frame.position.set(0, 10.5, -9.6); scene.add(frame);

  // Overhead truss.
  const trussMat = keep(new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.5, metalness: 0.7 }));
  for (const z of [-6, 6]) {
    const tr = new THREE.Mesh(keep(new THREE.BoxGeometry(44, 0.6, 0.6)), trussMat);
    tr.position.set(0, 19, z); scene.add(tr);
  }

  // Crowd: a bowl of tiers in front of the stage, as instanced figures in dark clothes.
  const personGeo = keep(new THREE.CapsuleGeometry(0.32, 0.7, 2, 6));
  const crowdMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.9 }));
  const seats: THREE.Vector3[] = [];
  for (let row = 0; row < 16; row++) {
    const r = 22 + row * 1.6;
    const y = 0.9 + row * 0.75;
    const n = Math.floor(r * 2.4);
    for (let i = 0; i < n; i++) {
      const a = -1.25 + (i / (n - 1)) * 2.5 + (Math.random() - 0.5) * 0.02;
      seats.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r - 2));
    }
  }
  // A standing crowd on the floor in front of the stage: heads and shoulders along the bottom of the shot.
  for (let i = 0; i < 520; i++) {
    const r = 9 + Math.random() * 9, a = (Math.random() - 0.5) * 1.9;
    seats.push(new THREE.Vector3(Math.sin(a) * r, -0.1 + Math.random() * 0.25, Math.cos(a) * r - 2));
  }
  const crowd = new THREE.InstancedMesh(personGeo, crowdMat, seats.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const shirts = ['#1d2430', '#2a2f37', '#3a2c22', '#232a22', '#30262d', '#5a3a1a', '#1a2c40'];
  seats.forEach((p, i) => {
    m.makeTranslation(p.x, p.y + 0.6, p.z);
    crowd.setMatrixAt(i, m);
    col.set(shirts[i % shirts.length]!).multiplyScalar(0.6 + Math.random() * 0.6);
    crowd.setColorAt(i, col);
  });
  scene.add(crowd);
  const tiers = new THREE.Mesh(keep(new THREE.CylinderGeometry(48, 22, 12, 48, 1, true, -1.35 + Math.PI, 2.7)), keep(new THREE.MeshStandardMaterial({ color: 0x0c1016, side: THREE.DoubleSide, roughness: 0.9 })));
  tiers.rotation.y = Math.PI; tiers.position.set(0, 6, -2); scene.add(tiers);

  // Phone lights in the crowd: points that twinkle.
  const lights = seats.filter(() => Math.random() < 0.08);
  const lg = keep(new THREE.BufferGeometry());
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lights.flatMap((p) => [p.x, p.y + 1.5, p.z])), 3));
  const lmat = keep(new THREE.PointsMaterial({ size: 0.5, map: keep(dotTexture()), color: 0xfff1d6, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  const phones = new THREE.Points(lg, lmat);
  scene.add(phones);

  // Moving beams in the haze from the truss.
  const beamTex = keep(beamTexture());
  const beamGeo = keep(new THREE.ConeGeometry(2.6, 26, 24, 1, true));
  beamGeo.translate(0, -13, 0);
  const beams: { mesh: THREE.Mesh; base: number; speed: number }[] = [];
  [-15, -7, 7, 15].forEach((x, i) => {
    const mat = keep(new THREE.MeshBasicMaterial({ map: beamTex, color: i % 2 ? CT : T, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const b = new THREE.Mesh(beamGeo, mat);
    b.position.set(x, 18.6, i < 2 ? 6 : -6);
    scene.add(b);
    beams.push({ mesh: b, base: i * 1.7, speed: 0.35 + i * 0.07 });
  });

  // Your starting five, lined up centre stage like a team walk-out, each on a pool of light with a name plate.
  const kit = soldierKit();
  const lineup = new THREE.Group();
  scene.add(lineup);
  const poolGeo = keep(new THREE.CircleGeometry(1, 40));
  const poolTex = keep(dotTexture());
  let five: { soldier: Soldier; plate: THREE.Sprite; tex: THREE.CanvasTexture; mats: THREE.Material[]; seed: number; plateY: number }[] = [];
  const clearFive = () => {
    for (const f of five) { f.tex.dispose(); f.mats.forEach((mm) => mm.dispose()); f.soldier.accent.dispose(); }
    lineup.clear(); five = [];
  };
  const addPlayer = (p: StagePlayer, i: number, side: 'T' | 'CT', cx: number, turn: number) => {
    let seed = 0;
    for (const ch of p.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const col = side === 'T' ? T : CT;
    const soldier = buildSoldier(kit, side, col, seed);
    const x = cx + (i - 2) * (cx ? 2.15 : 2.6), z = 2.6 - Math.abs(i - 2) * 0.35;
    soldier.body.position.set(x, 1.6, z);
    soldier.body.scale.setScalar(cx ? 1.3 : 1.45);
    // Face the room, angled a touch toward the middle of the stage.
    soldier.body.rotation.y = turn - (i - 2) * 0.1;
    soldier.carry.rotation.x = 0.42;
    lineup.add(soldier.body);
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 1.62, z); pool.scale.setScalar(1.5);
    lineup.add(pool);
    const plate = screenTexture((g, w, h) => {
      g.fillStyle = 'rgba(8,11,15,0.82)'; g.fillRect(0, 8, w, h - 16);
      g.fillStyle = side === 'T' ? '#f0a33a' : vsColor; g.fillRect(0, 8, 8, h - 16);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "700 40px 'Chakra Petch', 'Segoe UI', sans-serif"; g.fillStyle = '#ffffff';
      g.fillText(p.handle.toUpperCase(), w / 2 + 4, h * 0.4, w - 30);
      g.font = "600 26px 'Chakra Petch', 'Segoe UI', sans-serif"; g.fillStyle = side === 'T' ? '#ffcf80' : '#a9d6f7';
      g.fillText(ROLE_LABEL[p.role].toUpperCase(), w / 2 + 4, h * 0.75, w - 30);
    }, 320, 96);
    const plateMat = new THREE.SpriteMaterial({ map: plate.tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(plateMat);
    const k = cx ? 0.9 : 1;
    sprite.scale.set(2.3 * k, 0.69 * k, 1);
    const y = 1.6 + (cx ? 3.05 : 3.35);
    sprite.position.set(x, y, z);
    lineup.add(sprite);
    five.push({ soldier, plate: sprite, tex: plate.tex, mats: [poolMat, plateMat], seed: i + (side === 'CT' ? 5 : 0), plateY: y });
  };
  /** Your five (amber); with an opponent, both teams stand in front of their booths and the wall shows the matchup. */
  const setFive = (players: StagePlayer[], opponent?: { tag: string; color?: string; five: StagePlayer[] }) => {
    clearFive();
    vsColor = opponent?.color ?? '#5aa9e6';
    const vs = !!opponent && opponent.five.length > 0;
    players.slice(0, 5).forEach((p, i) => addPlayer(p, i, 'T', vs ? -8.4 : 0, vs ? 0.22 : 0));
    if (vs) opponent.five.slice(0, 5).forEach((p, i) => addPlayer(p, i, 'CT', 8.4, -0.22));
    vsTag = vs ? opponent.tag : '';
    drawWall(lastT);
  };

  return {
    setFive,
    tick(t: number) {
      // Idle: breathing, a little weight shift, a glance around the room now and then.
      for (const f of five) {
        const k = t * 1.3 + f.seed * 1.7;
        f.soldier.waist.rotation.x = Math.sin(k) * 0.025;
        f.soldier.waist.rotation.y = Math.sin(k * 0.37) * 0.08;
        f.soldier.helmet.rotation.y = Math.sin(t * 0.45 + f.seed * 2.3) * 0.35 * Math.max(0, Math.sin(t * 0.2 + f.seed));
        f.soldier.carry.rotation.x = 0.42 + Math.sin(k * 0.8) * 0.03;
        f.plate.position.y = f.plateY + Math.sin(k * 0.6) * 0.03;
      }
      for (const b of beams) {
        b.mesh.rotation.z = Math.sin(t * b.speed + b.base) * 0.55;
        b.mesh.rotation.x = Math.cos(t * b.speed * 0.8 + b.base) * 0.35;
      }
      lmat.opacity = 0.7 + Math.sin(t * 2.1) * 0.15;
      edgeMat.color.setHSL(0.09, 0.85, 0.5 + Math.sin(t * 1.4) * 0.08);
      if (Math.floor(t * 15) !== Math.floor((t - 1 / 30) * 15)) drawWall(t);
    },
    dispose() { clearFive(); kit.dispose(); crowd.dispose(); disposables.forEach((d) => d.dispose()); },
  };
}

export function StadiumScene({ teamName, teamTag, active, five = [], opponent }: { teamName: string; teamTag: string; active: boolean; five?: StagePlayer[]; opponent?: { tag: string; color?: string; five: StagePlayer[] } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<ReturnType<typeof buildArena> | null>(null);
  const fiveRef = useRef(five);
  fiveRef.current = five;
  const oppRef = useRef(opponent);
  oppRef.current = opponent;
  const fiveKey = [...five, ...(opponent?.five ?? [])].map((p) => `${p.id}:${p.handle}:${p.role}`).join('|') + (opponent?.tag ?? '') + (opponent?.color ?? '');
  const [shown, setShown] = useState(false);
  const live = useRef(active);
  live.current = active;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !webglAvailable()) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); } catch { return; }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    const scene = new THREE.Scene();
    const arena = buildArena(scene, teamName, teamTag);
    arena.setFive(fiveRef.current, oppRef.current);
    arenaRef.current = arena;
    const cam = new THREE.PerspectiveCamera(56, 1, 0.5, 400);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0, last = 0, first = true;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!first && (!live.current || document.hidden || now - last < 33)) return;
      last = now;
      const t = reduced ? 8 : (now - start) / 1000;
      // Stay inside the bowl (the crowd starts 22 m out) so the stands frame the stage instead of blocking it.
      const a = -0.1 + Math.sin(t * 0.05) * 0.5;
      cam.position.set(Math.sin(a) * 20.5, 5.2 + Math.sin(t * 0.08) * 0.8, Math.cos(a) * 20.5 - 2);
      cam.lookAt(Math.sin(a) * 3, 6.4, -6);
      arena.tick(t);
      renderer.render(scene, cam);
      if (first) { first = false; setShown(true); if (reduced) cancelAnimationFrame(raf); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); arena.dispose(); arenaRef.current = null; renderer.dispose(); };
  }, [teamName, teamTag]);
  // A lineup change swaps the figures on stage without rebuilding the arena.
  useEffect(() => { arenaRef.current?.setFive(fiveRef.current, oppRef.current); }, [fiveKey]);

  return <canvas ref={ref} className={`stadium${shown ? ' on' : ''}`} aria-hidden="true" />;
}
