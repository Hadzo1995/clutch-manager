/**
 * Pictures of the 3D cases for the case list: each case is rendered once with a shared
 * offscreen renderer and kept as an image, so the list costs one WebGL context and no
 * animation loop. The list falls back to the drawn case if WebGL is missing or fails.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CaseId } from '../../engine/cases';
import type { Role } from '../../engine/types';
import { buildCase } from './caseModel';
import { fontsReady, shadowTexture } from './textures';

const W = 480, H = 360;
let shared: { renderer: THREE.WebGLRenderer; env: THREE.Texture } | null = null;
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function setup() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  shared = { renderer, env };
  return shared;
}

function render(id: CaseId, role?: Role): string {
  const { renderer, env } = setup();
  const scene = new THREE.Scene();
  scene.environment = env;
  const rig = buildCase(id, role, 'high');
  rig.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.9;
  });
  rig.root.rotation.y = -0.55;
  scene.add(rig.root);
  const key = new THREE.SpotLight('#fff1dc', 75, 0, 0.5, 0.6, 2);
  key.position.set(1.6, 6, 3);
  key.target.position.set(0, 0.3, 0);
  const rim = new THREE.DirectionalLight(rig.accent, 2.6);
  rim.position.set(-3.5, 2.6, -4);
  const rim2 = new THREE.DirectionalLight('#9fc4ff', 0.8);
  rim2.position.set(4, 1.5, -3);
  const front = new THREE.DirectionalLight('#ffffff', 0.7);
  front.position.set(0, 1.5, 6);
  scene.add(key, key.target, rim, rim2, front, new THREE.HemisphereLight('#b9c8e8', '#07090c', 0.4));
  const shadowMap = shadowTexture();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.3), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, opacity: 0.85, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.002;
  scene.add(blob);
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 50);
  cam.position.set(0, 1.95, 4.95);
  cam.lookAt(0, 0.34, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  rig.dispose();
  shadowMap.dispose();
  blob.geometry.dispose();
  blob.material.dispose();
  return url;
}

/** A picture of the case (PNG data URL), rendered once per case and role. */
export function caseThumb(id: CaseId, role?: Role): Promise<string> {
  const key = `${id}:${role ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = queue.then(() => fontsReady()).then(() => render(id, role));
    queue = p.catch(() => undefined);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
