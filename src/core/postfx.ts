import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, NoiseEffect,
  SMAAEffect, SMAAPreset, ChromaticAberrationEffect, DepthOfFieldEffect, Effect, BlendFunction, EffectAttribute,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Colour grading (lift / gamma / gain / saturation / contrast / tint) applied after tone mapping. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform vec3 lift; uniform vec3 gammaV; uniform vec3 gain; uniform vec3 tint;
      uniform float saturation; uniform float contrast; uniform float fade;
      uniform vec3 shadowTint; uniform vec3 highTint; uniform float split;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        c = c * gain + lift * (1.0 - c);
        c = pow(max(c, vec3(0.0)), 1.0 / gammaV);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split toning: cool/teal shadows, warm highlights (film look), luminance preserving
        vec3 st = mix(shadowTint, highTint, smoothstep(0.05, 0.75, l));
        c = mix(c, c * st / max(dot(st, vec3(0.2126, 0.7152, 0.0722)), 0.001), split);
        l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        // contrast as a soft S-curve around mid grey (no hard clipping of highlights / crushed blacks)
        vec3 s = clamp(c, 0.0, 1.0);
        vec3 sc = s * s * (3.0 - 2.0 * s);
        c = mix(c, mix(s, sc, 0.5), clamp(contrast - 1.0, 0.0, 1.0) * 2.0);
        c = (c - 0.5) * min(contrast, 1.0) + 0.5;
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
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.94, 1.0, 1.06))],
        ['highTint', new THREE.Uniform(new THREE.Vector3(1.05, 1.0, 0.93))],
        ['split', new THREE.Uniform(0.0)],
      ]),
    });
  }
  u(name: string) { return this.uniforms.get(name)!; }
}

/**
 * Sun shafts + aerial haze (one full-screen effect, HDR, before tone mapping).
 *  - crepuscular rays: march the depth buffer toward the sun's screen position, open sky (depth = 1)
 *    between buildings / through the cable tangle scatters light back along the ray
 *  - Mie glow: distant geometry seen toward the sun picks up warm in-scattered light (humid haze)
 * Driven by PostFX.setSun() (the world's sky); fades to nothing when no scene feeds it.
 */
class SunShaftsEffect extends Effect {
  constructor(samples = 28) {
    super('SunShaftsEffect', /* glsl */ `
      uniform vec2 sunUv; uniform vec3 sunDirV; uniform vec3 sunCol; uniform float shaftK; uniform float hazeK; uniform float hazeDist;
      uniform mat4 projInv;
      float sHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec3 col = inputColor.rgb;
        // view ray of this pixel
        vec4 ndc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
        vec4 vr = projInv * ndc; vec3 rd = normalize(vr.xyz / vr.w);
        float mu = max(dot(rd, sunDirV), 0.0);
        // --- aerial Mie haze toward the sun (geometry only; the sky shader has its own glow)
        if (depth < 0.9999 && hazeK > 0.0) {
          float vz = -getViewZ(depth);
          float fk = 1.0 - exp(-vz / hazeDist);
          float phase = pow(mu, 6.0) * 0.8 + pow(mu, 32.0) * 1.2 + 0.06;
          col += sunCol * phase * fk * hazeK;
        }
        // --- crepuscular rays
        if (shaftK > 0.0) {
          vec2 d = sunUv - uv;
          float len = length(d);
          float reach = 0.85;
          vec2 stepv = d * min(1.0, reach / max(len, 1e-4)) / float(SHAFT_SAMPLES);
          vec2 p = uv + stepv * sHash(uv * 917.0 + fract(time));
          float acc = 0.0, w = 1.0, wsum = 0.0;
          for (int i = 0; i < SHAFT_SAMPLES; i++) {
            vec2 q = clamp(p, 0.001, 0.999);
            float open = step(0.99995, readDepth(q));
            acc += open * w; wsum += w; w *= 0.955; p += stepv;
          }
          acc /= wsum;
          // only rays that actually got occluded somewhere read as shafts; open sky itself is handled by the sky shader
          float occl = depth < 0.9999 ? 1.0 : 0.35;
          float fall = pow(mu, 3.0) * smoothstep(1.4, 0.15, len);
          col += sunCol * acc * fall * occl * shaftK;
        }
        outputColor = vec4(col, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      defines: new Map([['SHAFT_SAMPLES', String(samples)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['sunUv', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['sunDirV', new THREE.Uniform(new THREE.Vector3(0, 0, -1))],
        ['sunCol', new THREE.Uniform(new THREE.Color(1, 0.9, 0.75))],
        ['shaftK', new THREE.Uniform(0)],
        ['hazeK', new THREE.Uniform(0)],
        ['hazeDist', new THREE.Uniform(120)],
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
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
  /** split-toning strength (cool shadows / warm highlights) */
  split?: number;
}

/** Named looks. Modules may blend between them (day cycle, night, casino, dream). */
export const LOOKS: Record<string, GradeParams> = {
  // hot hazy Thai afternoon: warm highlights, slightly lifted blacks, a touch desaturated
  thaiDay: { lift: [0.012, 0.011, 0.01], gamma: [1.02, 1.0, 0.97], gain: [1.06, 1.01, 0.95], saturation: 1.02, contrast: 1.12, tint: [1, 1, 1], split: 0.35 },
  golden: { lift: [0.02, 0.01, 0.0], gamma: [1.03, 0.98, 0.9], gain: [1.14, 1.0, 0.8], saturation: 1.1, contrast: 1.14, tint: [1, 0.98, 0.93], split: 0.5 },
  night: { lift: [0.0, 0.004, 0.014], gamma: [0.97, 1.0, 1.05], gain: [1.0, 1.0, 1.06], saturation: 0.98, contrast: 1.16, tint: [0.99, 1, 1.03], split: 0.55 },
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
  shafts: SunShaftsEffect;
  private shaftsPass: EffectPass | null = null;
  private mainPass: EffectPass;
  private shaftsOn = true;
  private sunStamp = 0;
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
    // street-scale AO: wide enough to darken recesses, balcony soffits and the gap under awnings,
    // with a warm-black tint (bounce light in the soi is dusty/brown, never pure black)
    Object.assign(this.ao.configuration, {
      aoRadius: 2.2, distanceFalloff: 1.1, intensity: 2.6, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10,
      halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color(0x0e0907), screenSpaceRadius: false,
    });
    this.composer.addPass(this.ao);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.05, bokehScale: 3.0, height: 480 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.55, luminanceThreshold: 0.88, luminanceSmoothing: 0.22, radius: 0.68 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.5 });
    this.noise = new NoiseEffect({ premultiply: true });
    this.noise.blendMode.opacity.value = 0.28;
    this.shafts = new SunShaftsEffect(28);
    this.mainPass = this.makeMainPass(camera, true);
    this.composer.addPass(this.mainPass);
    this.shaftsPass = new EffectPass(camera, this.shafts);
    this.composer.addPass(this.shaftsPass);

    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.00055, 0.00045), radialModulation: true, modulationOffset: 0.35 });
    this.caPass = new EffectPass(camera, this.ca);
    this.composer.addPass(this.caPass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.smaaPass);
    this.setLook('thaiDay');
  }

  private makeMainPass(camera: THREE.Camera, _shafts: boolean) {
    return new EffectPass(camera, this.bloom, this.tone, this.grade, this.vignette, this.noise);
  }
  /** shafts read the depth texture: they run in their own pass right after the main pass. With AO on and DOF
   *  off that is an even number of buffer swaps, so they read the buffer that owns the depth attachment and
   *  write the other one (no feedback loop). Any other pass layout → shafts off. */
  private syncShaftsPass() {
    if (this.shaftsPass) this.shaftsPass.enabled = this.shaftsOn && this.ao.enabled && !this.dofPass.enabled;
  }

  /** Sun for shafts + aerial haze: world-space direction to the sun, colour (HDR), strengths. Call every frame. */
  setSun(dir: THREE.Vector3 | null, color?: THREE.Color, shafts = 0.25, haze = 0.15, hazeDist = 140) {
    const u = (n: string) => this.shafts.u(n);
    if (!dir) { u('shaftK').value = 0; u('hazeK').value = 0; return; }
    this.sunStamp = performance.now();
    const cam = this.camera as THREE.PerspectiveCamera;
    const v = _v.copy(dir).transformDirection(cam.matrixWorldInverse);
    u('sunDirV').value.copy(v);
    const p = _p.copy(cam.position).addScaledVector(dir, 1000).project(cam);
    // behind the camera: push the point far away (no rays)
    if (v.z > 0) p.set(p.x * -50, p.y * -50, 1);
    u('sunUv').value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    if (color) u('sunCol').value.copy(color);
    u('shaftK').value = this.shaftsOn ? shafts : 0;
    u('hazeK').value = haze;
    u('hazeDist').value = hazeDist;
  }

  /** filmic exposure (applied by the tone mapper) */
  set exposure(v: number) { this.renderer.toneMappingExposure = v; }
  get exposure() { return this.renderer.toneMappingExposure; }

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
    // shafts/haze: off at low
    this.shaftsOn = q !== 'low';
    this.syncShaftsPass();
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
    g.u('split').value += ((L.split ?? 0) - g.u('split').value) * k;
  }

  /** 0 = normal, 1 = black (used for fades through the grade pass, no DOM overlay needed). */
  set fade(v: number) { this.grade.u('fade').value = v; }
  get fade() { return this.grade.u('fade').value; }

  /** Depth of field for menus / skill tree / cutscenes. focusDist in metres. */
  setDOF(on: boolean, focusDist = 3, bokeh = 3) {
    this.dofPass.enabled = on;
    this.syncShaftsPass();
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
  render(dt: number) {
    // nobody fed the sun recently (menu / other scenes): no shafts or haze
    if (performance.now() - this.sunStamp > 400) { this.shafts.u('shaftK').value = 0; this.shafts.u('hazeK').value = 0; }
    else this.shafts.u('projInv').value.copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    this.composer.render(dt);
  }
}

const _v = new THREE.Vector3(), _p = new THREE.Vector3();
