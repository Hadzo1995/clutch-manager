/**
 * Cinematic post-processing for the 3D match viewer, built on pmndrs/postprocessing and N8AO.
 *
 * - "full" (desktop): N8AO ambient occlusion (contact shadows in corners, under boxes and along
 *   walls), soft mipmap bloom on bright things (muzzle flashes, molotovs, the bomb beacon), ACES
 *   tone mapping, the broadcast grade and vignette, then SMAA edge smoothing.
 * - "lite" (phones and tablets): the same chain without ambient occlusion. Bloom, tone mapping,
 *   grade and vignette are merged into one full-screen pass, so it costs little more than a plain
 *   render. Phones used to get no post-processing at all.
 *
 * Viewer3D steps down when frames run slow: full -> lite -> off.
 */
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type PostFxTier = 'full' | 'lite';

/** The light broadcast grade the viewer has always had: a touch of saturation, contrast and warmth. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      uniform float saturation, contrast;
      uniform vec3 tint;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // Grade in display space (as before), then hand linear colour back to the chain.
        vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        c *= tint;
        outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['saturation', new THREE.Uniform(1.08)],
          ['contrast', new THREE.Uniform(1.05)],
          ['tint', new THREE.Uniform(new THREE.Vector3(1.0, 0.99, 0.97))],
        ]),
      },
    );
  }
}

/** Which post-processing tier this device should start with. */
export function postFxTier(): PostFxTier {
  if (typeof window === 'undefined') return 'lite';
  if (window.matchMedia?.('(pointer: coarse)').matches) return 'lite'; // phones and tablets: keep the frame rate
  return Math.min(window.innerWidth, window.screen?.width ?? window.innerWidth) >= 1000 ? 'full' : 'lite';
}

export class PostFX {
  private composer: EffectComposer;
  private ao: N8AOPostPass | null = null;
  private _tier: PostFxTier;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, tier: PostFxTier) {
    this._tier = tier;
    // Hardware MSAA does not mix with screen-space AO, so edges are smoothed by SMAA instead.
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    if (tier === 'full') {
      const ao = new N8AOPostPass(scene, camera, w, h);
      ao.setQualityMode('Medium');
      ao.configuration.aoRadius = 2.4;
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 3.4;
      ao.configuration.color = new THREE.Color(0x0d0a08); // a hint of warm bounce, not pure black
      ao.configuration.gammaCorrection = false; // the composer encodes output once, at the end
      this.composer.addPass(ao);
      this.ao = ao;
    }

    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.12, intensity: 0.55, radius: 0.6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    const look = new EffectPass(camera, bloom, tone, new GradeEffect(), vignette);
    const smaa = new EffectPass(camera, new SMAAEffect({ preset: tier === 'full' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    this.composer.addPass(look);
    this.composer.addPass(smaa);
  }

  get tier(): PostFxTier {
    return this._tier;
  }

  /** Drops ambient occlusion (the expensive part) and keeps the rest of the look. */
  toLite() {
    if (!this.ao) return;
    this.composer.removePass(this.ao);
    this.ao.dispose();
    this.ao = null;
    this._tier = 'lite';
  }

  setSize(w: number, h: number) {
    // The composer reads the renderer's pixel ratio itself.
    this.composer.setSize(w, h, false);
  }

  render(dt?: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose(); // disposes every pass still in the chain, AO included
  }
}
