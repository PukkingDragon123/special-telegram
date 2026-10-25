import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  SMAAEffect, SMAAPreset, ChromaticAberrationEffect, DepthOfFieldEffect, Effect, BlendFunction, EffectAttribute,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { InkEdgePass, InkEffect, InkSettings, CEL, installMaterialPatch, updateInkHulls, InkParams } from './ink';

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

/**
 * Film grain whose cell is a fixed fraction of the screen height (1/1080), so it looks the same at 720p, 4K or
 * supersampled — never a fizzing per-pixel noise at high resolutions. Mid-tones only, very subtle.
 */
class GrainEffect extends Effect {
  constructor() {
    super('GrainEffect', /* glsl */ `
      uniform float grainK;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float cell = max(1.0, resolution.y / 1080.0);
        vec2 c = floor(uv * resolution / cell);
        float t = floor(time * 24.0);
        float n = fract(sin(dot(c + t * vec2(17.13, 41.71), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        float l = clamp(dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        float w = 0.35 + 2.6 * l * (1.0 - l);
        outputColor = vec4(inputColor.rgb + n * grainK * w, inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([['grainK', new THREE.Uniform(0.022)]]),
    });
  }
  u(name: string) { return this.uniforms.get(name)!; }
}

/**
 * Last pass, internal resolution → screen:
 *  - supersampled (ultra): 4 bilinear taps per output pixel (≈ tent over the footprint) = clean downsample
 *  - upscaled (adaptive resolution under load): bilinear, then sharpened
 *  - contrast-adaptive sharpening (AMD CAS-style, lite) after the resample
 *  - anime IMPACT FRAME: 2–3 frames of inverted / black-ink-on-paper flash with a radial burst, then a
 *    halftone burst that fades (driven by PostFX.impact())
 */
class FinalEffect extends Effect {
  constructor() {
    super('FinalEffect', /* glsl */ `
      uniform vec2 dstTexel;
      uniform vec2 outRes;
      uniform float ss;
      uniform float sharp;
      uniform float impT;
      uniform float impK;
      uniform vec2 impC;
      uniform float impSeed;
      vec3 S(vec2 uv) {
        if (ss > 1.05) {
          vec2 o = dstTexel * 0.375;
          return 0.25 * (texture2D(inputBuffer, uv + vec2(-o.x, -o.y)).rgb + texture2D(inputBuffer, uv + vec2(o.x, -o.y)).rgb
                       + texture2D(inputBuffer, uv + vec2(-o.x, o.y)).rgb + texture2D(inputBuffer, uv + vec2(o.x, o.y)).rgb);
        }
        return texture2D(inputBuffer, uv).rgb;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = S(uv);
        if (sharp > 0.001) {
          vec3 n = S(uv + vec2(0.0, dstTexel.y)), s = S(uv - vec2(0.0, dstTexel.y));
          vec3 e = S(uv + vec2(dstTexel.x, 0.0)), w = S(uv - vec2(dstTexel.x, 0.0));
          vec3 mn = min(c, min(min(n, s), min(e, w)));
          vec3 mx = max(c, max(max(n, s), max(e, w)));
          vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
          vec3 wgt = -amp * mix(0.07, 0.2, clamp(sharp, 0.0, 1.0));
          c = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);
        }
        if (impT >= 0.0 && impK > 0.0) {
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 d = (uv - impC) * vec2(outRes.x / outRes.y, 1.0);
          float r = length(d);
          float a = atan(d.y, d.x) / 6.2831853 * 46.0;
          float id = floor(a);
          float rnd = fract(sin(id * 12.9898 + impSeed * 78.233) * 43758.5453);
          float ray = step(abs(fract(a) - 0.5), 0.08 + 0.3 * rnd) * smoothstep(0.06 + 0.22 * rnd, 0.55, r);
          float cell = 7.0 * outRes.y / 1080.0;
          vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (uv * outRes / cell);
          float dd = length(fract(g) - 0.5);
          float rad = clamp(0.64 - r * 0.85, 0.0, 0.64);
          float dots = 1.0 - smoothstep(rad - 0.07, rad + 0.07, dd);
          vec3 o;
          if (impT < 0.05) {
            float bw = smoothstep(0.3, 0.42, l);
            o = mix(vec3(1.0 - bw), vec3(1.0), ray * 0.9);
          } else if (impT < 0.1) {
            float bw = smoothstep(0.16, 0.3, l);
            o = mix(vec3(0.015, 0.012, 0.01), vec3(1.0, 0.97, 0.92), bw);
            o = mix(o, vec3(0.015, 0.012, 0.01), ray * 0.85);
          } else {
            float k = 1.0 - smoothstep(0.1, 0.34, impT);
            o = mix(c, c * 0.2, dots * k * 0.75);
            o = mix(o, vec3(1.0, 0.98, 0.94), ray * k * 0.3);
          }
          c = mix(c, o, impK);
        }
        outputColor = vec4(c, inputColor.a);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['dstTexel', new THREE.Uniform(new THREE.Vector2(1 / 1280, 1 / 720))],
        ['outRes', new THREE.Uniform(new THREE.Vector2(1280, 720))],
        ['ss', new THREE.Uniform(1)],
        ['sharp', new THREE.Uniform(0)],
        ['impT', new THREE.Uniform(-1)],
        ['impK', new THREE.Uniform(0)],
        ['impC', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['impSeed', new THREE.Uniform(0)],
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
  // anime-sunny Thai afternoon: warm saturated highlights, clean teal-leaning shadows, punchy but not crushed
  thaiDay: { lift: [0.008, 0.01, 0.014], gamma: [1.03, 1.01, 0.97], gain: [1.08, 1.03, 0.95], saturation: 1.17, contrast: 1.1, tint: [1.01, 1, 0.98], split: 0.42 },
  golden: { lift: [0.018, 0.01, 0.004], gamma: [1.04, 0.99, 0.9], gain: [1.16, 1.01, 0.8], saturation: 1.22, contrast: 1.13, tint: [1.01, 0.98, 0.92], split: 0.55 },
  // moody teal night with neon that pops: teal-lifted shadows, warm/neon highlights split off, extra saturation
  night: { lift: [0.0, 0.009, 0.016], gamma: [0.96, 1.0, 1.04], gain: [1.03, 1.0, 1.04], saturation: 1.14, contrast: 1.18, tint: [0.98, 1, 1.02], split: 0.7 },
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
  /** film grain (resolution-independent; was a NoiseEffect) */
  noise: GrainEffect;
  ca: ChromaticAberrationEffect;
  smaa: SMAAEffect;
  dof: DepthOfFieldEffect;
  shafts: SunShaftsEffect;
  /** screen-space ink: edge mask pass (after the RenderPass) + composite (first effect of the main pass) */
  inkPass: InkEdgePass;
  ink: InkEffect;
  final: FinalEffect;
  private shaftsPass: EffectPass | null = null;
  private mainPass: EffectPass;
  private shaftsOn = true;
  private sunStamp = 0;
  private caPass: EffectPass;
  private smaaPass: EffectPass;
  private dofPass: EffectPass;
  private finalPass: EffectPass;
  quality: Quality = 'high';
  /** internal render scale relative to the drawing buffer (ultra supersamples > 1, adaptive < 1) */
  scale = 1;
  /** contrast-adaptive sharpening after the resample (0..1) */
  sharpen = 0;
  private cssW = 1;
  private cssH = 1;
  private intW = 1;
  private intH = 1;
  private impStart = -1;
  private impDur = 0.34;
  private finalOnScreen = true;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    installMaterialPatch();
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.autoRenderToScreen = false;
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // ink edge mask: reads the RenderPass colour (ink-mask alpha) + depth, writes its own R8 target (no swap)
    this.inkPass = new InkEdgePass(camera);
    this.inkPass.setScene(scene);
    this.inkPass.enabled = InkSettings.ink;
    this.composer.addPass(this.inkPass);

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

    this.ink = new InkEffect(this.inkPass.target.texture);
    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.55, luminanceThreshold: 0.88, luminanceSmoothing: 0.22, radius: 0.68 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.5 });
    this.noise = new GrainEffect();
    this.shafts = new SunShaftsEffect(28);
    this.mainPass = this.makeMainPass(camera, true);
    this.composer.addPass(this.mainPass);
    this.shaftsPass = new EffectPass(camera, this.shafts);
    this.composer.addPass(this.shaftsPass);

    // subtle: crisp ink lines should not grow colour fringes
    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0003, 0.00025), radialModulation: true, modulationOffset: 0.45 });
    this.caPass = new EffectPass(camera, this.ca);
    this.composer.addPass(this.caPass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.smaaPass);

    this.final = new FinalEffect();
    this.finalPass = new EffectPass(camera, this.final);
    this.composer.addPass(this.finalPass);
    this.syncOutput(true);
    this.setLook('thaiDay');
  }

  private makeMainPass(camera: THREE.Camera, _shafts: boolean) {
    return new EffectPass(camera, this.ink, this.bloom, this.tone, this.grade, this.vignette, this.noise);
  }
  /** shafts read the depth texture: they run in their own pass right after the main pass. With AO on and DOF
   *  off that is an even number of buffer swaps, so they read the buffer that owns the depth attachment and
   *  write the other one (no feedback loop). Any other pass layout → shafts off. (The ink pass never swaps.) */
  private syncShaftsPass() {
    if (this.shaftsPass) this.shaftsPass.enabled = this.shaftsOn && this.ao.enabled && !this.dofPass.enabled;
  }

  /** The final resample/sharpen/impact pass only runs when it has something to do; otherwise SMAA goes to screen. */
  private syncOutput(force = false) {
    const need = Math.abs(this.scale - 1) > 0.01 || this.sharpen > 0.001 || this.impStart >= 0;
    if (!force && need === this.finalOnScreen) return;
    this.finalOnScreen = need;
    this.finalPass.enabled = need;
    this.finalPass.renderToScreen = need;
    this.smaaPass.renderToScreen = !need;
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
    this.inkPass.setScene(scene);
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
    // shafts/haze: off at low (and with ?noshafts)
    this.shaftsOn = q !== 'low' && !new URLSearchParams(location.search).has('noshafts');
    this.syncShaftsPass();
    // ink: creases are the expensive/noisy part → lighter at low; ultra gets the finest SMAA
    this.inkPass.setParams(q === 'low' ? { creaseK: 0.5, jitter: 0.4 } : { creaseK: 0.85, jitter: 0.6 });
    this.smaa.applyPreset(q === 'ultra' ? SMAAPreset.ULTRA : q === 'low' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH);
    this.noise.u('grainK').value = q === 'low' ? 0 : 0.022;
    this.sharpen = q === 'high' ? 0.3 : q === 'ultra' ? 0.18 : 0;
    this.syncOutput();
  }

  /** Internal render scale (1 = native drawing buffer). Engine drives this (ultra supersampling, adaptive). */
  setScale(s: number) {
    const v = Math.max(0.5, Math.min(2.5, s));
    if (Math.abs(v - this.scale) < 1e-3) return;
    this.scale = v;
    this.setSize(this.cssW, this.cssH);
  }

  /** Tune the screen-space ink (widths, thresholds, fade). */
  setInk(p: Partial<InkParams> & { on?: boolean; strength?: number; tint?: number; glow?: number }) {
    this.inkPass.setParams(p);
    if (p.on !== undefined) { InkSettings.ink = p.on; this.inkPass.enabled = p.on; this.ink.u('inkK').value = p.on ? (p.strength ?? 1) : 0; }
    else if (p.strength !== undefined) this.ink.u('inkK').value = InkSettings.ink ? p.strength : 0;
    if (p.tint !== undefined) this.ink.u('tintK').value = p.tint;
    if (p.glow !== undefined) this.ink.u('glowK').value = p.glow;
  }
  /** Cel banding strength (0 = plain PBR). */
  setCel(k: number, shadow = k > 0 ? 0.6 : 0) { CEL.uCelK.value = k; CEL.uCelShadow.value = shadow; }

  /**
   * Anime impact frame: 2–3 frames of inverted / ink-on-paper flash + radial burst, then a fading halftone burst.
   * `at` = world point (projected with the current camera) or null for the screen centre.
   */
  impact(at: THREE.Vector3 | null = null, strength = 1) {
    if (params_noImpact) return;
    const now = performance.now() / 1000;
    if (this.impStart >= 0 && now - this.impStart < 0.5 && strength <= this.final.u('impK').value) return;
    let x = 0.5, y = 0.5;
    if (at) {
      const p = _p.copy(at).project(this.camera as THREE.PerspectiveCamera);
      if (p.z < 1) { x = THREE.MathUtils.clamp(p.x * 0.5 + 0.5, 0.1, 0.9); y = THREE.MathUtils.clamp(p.y * 0.5 + 0.5, 0.1, 0.9); }
    }
    this.impStart = now;
    this.final.u('impC').value.set(x, y);
    this.final.u('impK').value = Math.max(0, Math.min(1, strength));
    this.final.u('impSeed').value = Math.random() * 100;
    this.syncOutput();
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

  /** CSS size; buffers = drawing buffer × scale. */
  setSize(w: number, h: number) {
    this.cssW = w; this.cssH = h;
    this.composer.setSize(w, h, false);
    const db = this.renderer.getDrawingBufferSize(_sz);
    const ow = Math.max(1, db.x), oh = Math.max(1, db.y);
    this.intW = Math.max(1, Math.round(ow * this.scale));
    this.intH = Math.max(1, Math.round(oh * this.scale));
    if (this.intW !== ow || this.intH !== oh) {
      this.composer.inputBuffer.setSize(this.intW, this.intH);
      this.composer.outputBuffer.setSize(this.intW, this.intH);
      for (const p of this.composer.passes) p.setSize(this.intW, this.intH);
    }
    this.final.u('dstTexel').value.set(1 / ow, 1 / oh);
    this.final.u('outRes').value.set(ow, oh);
    this.final.u('ss').value = this.scale;
    this.final.u('sharp').value = this.scale < 0.99 ? Math.max(this.sharpen, 0.45) : this.sharpen;
    this.syncOutput();
  }
  /** internal (render) resolution in pixels */
  get renderSize() { return { w: this.intW, h: this.intH }; }

  render(dt: number) {
    // nobody fed the sun recently (menu / other scenes): no shafts or haze
    if (performance.now() - this.sunStamp > 400) { this.shafts.u('shaftK').value = 0; this.shafts.u('hazeK').value = 0; }
    else this.shafts.u('projInv').value.copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    // modules toggle ao / dof directly: re-check the buffer-swap parity every frame (and skip the pass when idle)
    if (this.shaftsPass) this.shaftsPass.enabled = this.shaftsOn && this.ao.enabled && !this.dofPass.enabled
      && (this.shafts.u('shaftK').value > 0.001 || this.shafts.u('hazeK').value > 0.001);
    // impact frame clock (real time: slow-mo must not stretch the flash)
    if (this.impStart >= 0) {
      const t = performance.now() / 1000 - this.impStart;
      if (t > this.impDur) { this.impStart = -1; this.final.u('impT').value = -1; this.final.u('impK').value = 0; }
      else this.final.u('impT').value = t;
    }
    this.final.u('sharp').value = this.scale < 0.99 ? Math.max(this.sharpen, 0.45) : this.sharpen;
    this.syncOutput();
    this.inkPass.enabled = InkSettings.ink;
    updateInkHulls(this.intH, this.intW);
    this.composer.render(dt);
  }
}

const params_noImpact = new URLSearchParams(location.search).has('noimpact');
const _sz = new THREE.Vector2();
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
