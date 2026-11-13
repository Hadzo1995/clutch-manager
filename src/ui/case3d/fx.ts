/**
 * Light effects shared by the 3D scenes: soft shafts of light and the rays of a burst.
 */
import * as THREE from 'three';

/**
 * A soft shaft of light for an open cylinder or cone: brightest along its axis and fading to
 * nothing at the silhouette, so it never shows a hard edge. `fade` sets which end is bright:
 * 'base' for light pouring up out of something, 'tip' for a spotlight's cone from above.
 */
export function shaftMaterial(color: THREE.ColorRepresentation, fade: 'base' | 'tip', power = 1.8): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uPower: { value: power },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vY = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uPower;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), uPower);
        float along = ${fade === 'base' ? 'pow(1.0 - vY, 1.7) * smoothstep(0.0, 0.04, vY)' : 'pow(vY, 1.25)'};
        gl_FragColor = vec4(uColor * facing * along * uOpacity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    // Additive on colour only: the canvas's alpha is left alone, so over a transparent canvas the
    // light adds to the page behind instead of turning that patch of canvas opaque.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** A ray of light, bright and narrow at its base, widening and fading towards its tip. */
export function rayTexture(): THREE.CanvasTexture {
  const W = 64, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // 0 at the base (bottom row), 1 at the tip
    const along = Math.pow(1 - v, 1.4) * Math.min(1, v * 30);
    const width = 0.12 + v * 0.3;
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1;
      const a = Math.exp(-(u * u) / (2 * width * width)) * along;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Rays fanning out of a point, kept facing the camera; a slow turn makes them shimmer. */
export class RayBurst {
  readonly group = new THREE.Group();
  private fan = new THREE.Group();
  private mats: THREE.MeshBasicMaterial[] = [];
  private spec: { len: number; phase: number }[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(color: THREE.ColorRepresentation, count = 11, spread = Math.PI * 0.86) {
    const map = rayTexture();
    this.disposables.push(map);
    for (let i = 0; i < count; i++) {
      const len = 2.6 + ((i * 7) % 5) * 0.45;
      const w = 0.34 + ((i * 3) % 4) * 0.12;
      const geo = new THREE.PlaneGeometry(w, len);
      geo.translate(0, len / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.z = -spread / 2 + (spread * (i + 0.5)) / count + (((i * 5) % 3) - 1) * 0.05;
      m.renderOrder = 2;
      this.fan.add(m);
      this.mats.push(mat);
      this.spec.push({ len, phase: i * 1.7 });
      this.disposables.push(geo, mat);
    }
    this.group.add(this.fan);
  }

  /** `k` 0..1 is the burst's strength, `t` the time in seconds. */
  update(k: number, t: number, camera: THREE.Camera) {
    this.group.quaternion.copy(camera.quaternion);
    this.fan.rotation.z = Math.sin(t * 0.35) * 0.08;
    this.fan.children.forEach((m, i) => {
      const s = this.spec[i]!;
      const flicker = 0.8 + Math.sin(t * 3 + s.phase) * 0.2;
      this.mats[i]!.opacity = k * flicker;
      m.scale.y = 0.35 + k * 0.65;
    });
    this.group.visible = k > 0.002;
  }

  dispose() { for (const d of this.disposables) d.dispose(); }
}
