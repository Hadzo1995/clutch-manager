/**
 * Cinematic post-processing for the 3D match viewer: ground-truth ambient occlusion (contact
 * shadows in corners, under boxes and along walls), a soft bloom on bright things (muzzle flashes,
 * molotovs, the bomb beacon), filmic tone mapping and a light broadcast grade with a vignette.
 * Only used where the GPU can afford it; Viewer3D drops it first when frames run slow.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.32 },
    saturation: { value: 1.08 },
    contrast: { value: 1.05 },
    tint: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, saturation, contrast;
    uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= tint;
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/** Whether this device should get the full post-processing chain by default. */
export function wantsPostFx(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return false; // phones and tablets: keep the frame rate
  return Math.min(window.innerWidth, window.screen?.width ?? window.innerWidth) >= 1000;
}

export class PostFX {
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.updateGtaoMaterial({ radius: 2.4, distanceExponent: 1.4, thickness: 2.5, scale: 1.25, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.blendIntensity = 1;
    // AO comes from solid geometry only: labels, cones, rings, smoke and tracers stay out of it.
    const pass = this.gtao as unknown as { overrideVisibility(): void; restoreVisibility(): void; scene: THREE.Scene };
    const cache = new Map<THREE.Object3D, boolean>();
    pass.overrideVisibility = () => {
      pass.scene.traverse((o) => {
        cache.set(o, o.visible);
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite || (m && (m.transparent || !m.depthWrite))) o.visible = false;
      });
    };
    pass.restoreVisibility = () => {
      for (const [o, v] of cache) o.visible = v;
      cache.clear();
    };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.4, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.gtao.dispose();
    this.bloom.dispose();
    this.grade.material.dispose();
    this.composer.dispose();
  }
}
