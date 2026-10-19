import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, NoiseEffect,
  SMAAEffect, SMAAPreset, ChromaticAberrationEffect, DepthOfFieldEffect, Effect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Colour grading (lift / gamma / gain / saturation / contrast / tint) applied after tone mapping. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform vec3 lift; uniform vec3 gammaV; uniform vec3 gain; uniform vec3 tint;
      uniform float saturation; uniform float contrast; uniform float fade;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        c = c * gain + lift * (1.0 - c);
        c = pow(max(c, vec3(0.0)), 1.0 / gammaV);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        c *= tint;
        c = mix(c, vec3(0.0), fade);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(new THREE.Vector3(0.0, 0.0, 0.0))],
        ['gammaV', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['saturation', new THREE.Uniform(1.0)],
        ['contrast', new THREE.Uniform(1.0)],
        ['fade', new THREE.Uniform(0.0)],
      ]),
    });
  }
  u(name: string) { return this.uniforms.get(name)!; }
}

export interface GradeParams {
  lift?: [number, number, number];
  gamma?: [number, number, number];
  gain?: [number, number, number];
  tint?: [number, number, number];
  saturation?: number;
  contrast?: number;
}

/** Named looks. Modules may blend between them (day cycle, night, casino, dream). */
export const LOOKS: Record<string, GradeParams> = {
  // hot hazy Thai afternoon: warm highlights, slightly lifted blacks, a touch desaturated
  thaiDay: { lift: [0.02, 0.018, 0.012], gamma: [1.0, 1.0, 0.98], gain: [1.04, 1.0, 0.94], saturation: 0.94, contrast: 1.04, tint: [1, 1, 1] },
  golden: { lift: [0.025, 0.012, 0.0], gamma: [1.02, 0.98, 0.92], gain: [1.12, 1.0, 0.82], saturation: 1.05, contrast: 1.06, tint: [1, 0.98, 0.94] },
  night: { lift: [0.0, 0.006, 0.02], gamma: [0.96, 1.0, 1.06], gain: [0.96, 1.0, 1.08], saturation: 0.86, contrast: 1.1, tint: [0.98, 1, 1.03] },
  casino: { lift: [0.02, 0.0, 0.0], gamma: [1.04, 0.98, 0.9], gain: [1.12, 0.98, 0.8], saturation: 1.15, contrast: 1.08, tint: [1, 0.97, 0.9] },
  dream: { lift: [0.06, 0.05, 0.08], gamma: [1.06, 1.02, 1.1], gain: [1.0, 0.98, 1.05], saturation: 1.2, contrast: 0.92, tint: [1, 0.98, 1.04] },
  album: { lift: [0.03, 0.02, 0.0], gamma: [1.05, 1.0, 0.86], gain: [1.08, 1.0, 0.8], saturation: 1.08, contrast: 1.05, tint: [1, 0.98, 0.9] },
  neutral: {},
};

export class PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  ao: any;
  bloom: BloomEffect;
  tone: ToneMappingEffect;
  grade: GradeEffect;
  vignette: VignetteEffect;
  noise: NoiseEffect;
  ca: ChromaticAberrationEffect;
  smaa: SMAAEffect;
  dof: DepthOfFieldEffect;
  private mainPass: EffectPass;
  private caPass: EffectPass;
  private smaaPass: EffectPass;
  private dofPass: EffectPass;
  quality: Quality = 'high';
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    const w = renderer.domElement.width, h = renderer.domElement.height;
    this.ao = new N8AOPostPass(scene, camera, w, h);
    Object.assign(this.ao.configuration, {
      aoRadius: 1.4, distanceFalloff: 0.7, intensity: 2.4, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10,
      halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color(0x0b0705),
    });
    this.composer.addPass(this.ao);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.05, bokehScale: 3.0, height: 480 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.55, luminanceThreshold: 0.92, luminanceSmoothing: 0.18, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.52 });
    this.noise = new NoiseEffect({ premultiply: true });
    this.noise.blendMode.opacity.value = 0.32;
    this.mainPass = new EffectPass(camera, this.bloom, this.tone, this.grade, this.vignette, this.noise);
    this.composer.addPass(this.mainPass);

    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.00055, 0.00045), radialModulation: true, modulationOffset: 0.35 });
    this.caPass = new EffectPass(camera, this.ca);
    this.composer.addPass(this.caPass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.smaaPass);
    this.setLook('thaiDay');
  }

  setView(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.mainScene = scene;
    this.renderPass.mainCamera = camera;
    this.ao.scene = scene;
    this.ao.camera = camera;
    for (const p of this.composer.passes) (p as any).mainCamera = camera;
    (this.dof as any).camera = camera;
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.ao.enabled = q !== 'low';
    if (q !== 'low') {
      this.ao.configuration.halfRes = q !== 'ultra';
      this.ao.configuration.aoSamples = q === 'ultra' ? 16 : q === 'high' ? 12 : 8;
      this.ao.configuration.denoiseSamples = q === 'medium' ? 4 : 6;
    }
    this.caPass.enabled = q === 'high' || q === 'ultra';
    this.bloom.intensity = q === 'low' ? 0.35 : 0.55;
    this.smaa.applyPreset(q === 'low' ? SMAAPreset.LOW : q === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH);
  }

  /** Blend towards a grading look. `k`=1 → fully that look. */
  setLook(name: string | GradeParams, k = 1) {
    const L = typeof name === 'string' ? LOOKS[name] ?? {} : name;
    const g = this.grade;
    const mix3 = (u: string, v: [number, number, number] | undefined, def: number) => {
      const cur = g.u(u).value as THREE.Vector3;
      const t = v ?? [def, def, def];
      cur.set(cur.x + (t[0] - cur.x) * k, cur.y + (t[1] - cur.y) * k, cur.z + (t[2] - cur.z) * k);
    };
    mix3('lift', L.lift, 0);
    mix3('gammaV', L.gamma, 1);
    mix3('gain', L.gain, 1);
    mix3('tint', L.tint, 1);
    g.u('saturation').value += ((L.saturation ?? 1) - g.u('saturation').value) * k;
    g.u('contrast').value += ((L.contrast ?? 1) - g.u('contrast').value) * k;
  }

  /** 0 = normal, 1 = black (used for fades through the grade pass, no DOM overlay needed). */
  set fade(v: number) { this.grade.u('fade').value = v; }
  get fade() { return this.grade.u('fade').value; }

  /** Depth of field for menus / skill tree / cutscenes. focusDist in metres. */
  setDOF(on: boolean, focusDist = 3, bokeh = 3) {
    this.dofPass.enabled = on;
    if (on) {
      const cam = this.camera as THREE.PerspectiveCamera;
      this.dof.cocMaterial.focusDistance = this.dof.calculateFocusDistance ? (this.dof as any).calculateFocusDistance(new THREE.Vector3(0, 0, -focusDist).applyMatrix4(cam.matrixWorld)) : focusDist / cam.far;
      this.dof.bokehScale = bokeh;
    }
  }
  /** Focus DOF on a world point. */
  focusOn(p: THREE.Vector3) {
    if (this.dofPass.enabled) (this.dof as any).target = p;
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h, false); }
  render(dt: number) { this.composer.render(dt); }
}
