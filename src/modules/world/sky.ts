import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { LOOKS } from '../../core/postfx';
import type { Game } from '../../game/game';
import { U } from './mats';

/**
 * ATMOSPHERE — procedural sky dome (gradient, sun disc + corona, fbm clouds, humid horizon haze,
 * stars + textured moon at night), HDRI environment blended by time of day and baked to PMREM,
 * haze fog, sun / moon directional light with a tight shadow box that follows the camera,
 * hemisphere fill, and post-grade look blending (thaiDay → golden → night).
 */

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir; uniform vec3 uMoonDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHaze; uniform vec3 uGround;
uniform vec3 uSunCol; uniform float uSunVis; uniform float uNight; uniform float uTime;
uniform float uCover; uniform vec3 uCloudLit; uniform vec3 uCloudDark; uniform float uHazeK;
uniform float uStars;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { s += a * vn(p); p = m * p; a *= 0.5; } return s; }
float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // --- base gradient (zenith → horizon), below horizon → hazy ground colour
  float t = pow(max(h, 0.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  if (h < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.18, h));
  // --- sun scattering + disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.55) * uSunVis;
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  vec3 sx = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
  vec3 sy = cross(sx, uSunDir);
  float corona = vn(vec2(atan(dot(d, sy), dot(d, sx)) * 6.0, uTime * 0.05)) * 0.5 + 0.5;
  float disc = 1.0 - smoothstep(0.0085, 0.0105 + corona * 0.0012, ang);
  // --- clouds (two fbm layers projected on a dome-plane)
  float cl = 0.0;
  vec3 ccol = vec3(0.0);
  if (h > -0.02) {
    vec2 uv = d.xz / (max(h, 0.0) + 0.14);
    vec2 w = vec2(uTime * 0.0065, uTime * 0.0022);
    float n = fbm(uv * 0.55 + w);
    float n2 = fbm(uv * 1.9 - w * 1.7 + 4.0) * 0.35;
    float dens = n + n2 * 0.5;
    float cov = mix(0.75, 0.38, uCover);
    cl = smoothstep(cov, cov + 0.28, dens) * smoothstep(-0.02, 0.16, h);
    // self shadowing: march one step toward the sun
    float ns = fbm((uv + uSunDir.xz * 0.35) * 0.55 + w) + n2 * 0.5;
    float lit = clamp(0.55 + (dens - ns) * 2.6, 0.0, 1.0);
    ccol = mix(uCloudDark, uCloudLit, lit);
    ccol += uSunCol * pow(sd, 7.0) * 0.55 * uSunVis * (1.0 - cl * 0.6); // silver lining
    // thin high cirrus streaks
    float ci = fbm(vec2(uv.x * 0.25 + w.x * 0.5, uv.y * 2.4) + 9.0);
    float cir = smoothstep(0.55, 0.8, ci) * 0.35 * smoothstep(0.05, 0.4, h) * (1.0 - uNight * 0.7);
    col = mix(col, uCloudLit * 1.05, cir);
  }
  col += uSunCol * disc * 22.0 * uSunVis * (1.0 - cl * 0.97);
  col = mix(col, ccol, cl * 0.95);
  // --- stars
  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 280.0;
    vec3 cell = floor(p);
    float r = h13(cell);
    if (r > 0.985) {
      vec3 c = cell + vec3(h13(cell + 1.3), h13(cell + 2.1), h13(cell + 3.7));
      float dd = length(p - c);
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 4.0) + r * 50.0);
      float s = smoothstep(0.55, 0.0, dd) * tw * (r - 0.985) * 66.0;
      col += vec3(0.9, 0.95, 1.0) * s * uStars * (1.0 - cl) * smoothstep(0.02, 0.25, h);
    }
    // faint milky band
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 0.93))) * 3.0, 2.0)) * fbm(d.xz * 9.0);
    col += vec3(0.25, 0.27, 0.35) * band * 0.06 * uStars * (1.0 - cl);
  }
  // --- moon (textured disc + glow)
  if (uNight > 0.01) {
    float md = dot(d, uMoonDir);
    float ma = acos(clamp(md, -1.0, 1.0));
    float mr = 0.022;
    if (ma < mr * 1.2) {
      vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))); vec3 my = cross(mx, uMoonDir);
      vec2 q = vec2(dot(d, mx), dot(d, my)) / mr;
      float maria = vn3(vec3(q * 2.2, 1.0)) * 0.6 + vn3(vec3(q * 6.0, 3.0)) * 0.3 + vn3(vec3(q * 15.0, 5.0)) * 0.1;
      float mdisc = 1.0 - smoothstep(0.9, 1.0, length(q));
      vec3 mc = vec3(0.95, 0.93, 0.86) * (0.65 + 0.35 * smoothstep(0.35, 0.75, maria));
      col = mix(col, mc * 2.2, mdisc * uNight * (1.0 - cl * 0.85));
    }
    col += vec3(0.55, 0.6, 0.75) * pow(max(md, 0.0), 220.0) * 0.6 * uNight * (1.0 - cl * 0.5);
  }
  // --- humid haze band over the horizon (matches fog colour)
  float hz = exp(-max(h + 0.01, 0.0) * mix(14.0, 5.0, uHazeK));
  col = mix(col, uHaze, clamp(hz * (0.55 + 0.4 * uHazeK), 0.0, 1.0));
  if (h < 0.0) col = mix(col, uHaze, 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

const ENV_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform sampler2D tA; uniform sampler2D tB; uniform float k; uniform float eA; uniform float eB; uniform vec3 tint; uniform float clampV;
vec2 eq(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
void main() {
  vec3 d = normalize(vDir);
  vec3 a = min(texture2D(tA, eq(d)).rgb * eA, vec3(clampV));
  vec3 b = min(texture2D(tB, eq(d)).rgb * eB, vec3(clampV));
  gl_FragColor = vec4(mix(a, b, k) * tint, 1.0);
}`;
const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface HdriInfo { key: string; file: string; exp: number; tex?: THREE.DataTexture }

let hdriPromise: Promise<Record<string, HdriInfo>> | null = null;
/** load the 4 time-of-day HDRIs once (started at boot by the module's init) */
export function preloadHdris(): Promise<Record<string, HdriInfo>> {
  if (hdriPromise) return hdriPromise;
  hdriPromise = (async () => {
    const out: Record<string, HdriInfo> = {};
    const man = await Assets.jsonSafe<any>('hdri/manifest.json', {});
    const want: Record<string, string> = { day: 'day_hazy_street', golden: 'golden_hour_riverside', dusk: 'dusk_blue_hour', night: 'night_street_sodium' };
    await Promise.all(Object.entries(want).map(async ([k, id]) => {
      const e = man[id];
      if (!e) return;
      try {
        const tex = await Assets.hdr('hdri/' + e.file1k);
        out[k] = { key: k, file: e.file1k, exp: e.recommendedExposure ?? 1, tex };
      } catch (err) { console.warn('[world] hdri', id, err); }
    }));
    return out;
  })();
  return hdriPromise;
}

/** time-of-day keyframes */
interface Key {
  t: number;
  zenith: number; horizon: number; haze: number; ground: number;
  cloudLit: number; cloudDark: number;
  fog: number; fogD: number;
  hemiSky: number; hemiGround: number; hemiI: number;
  env: [string, string, number]; envI: number;
}

const KEYS: Key[] = [
  { t: 4.0, zenith: 0x060a16, horizon: 0x101a2c, haze: 0x161c28, ground: 0x0b0c10, cloudLit: 0x2a3142, cloudDark: 0x10131b, fog: 0x141822, fogD: 0.0105, hemiSky: 0x1d2640, hemiGround: 0x120f0c, hemiI: 0.16, env: ['night', 'night', 0], envI: 0.32 },
  { t: 5.6, zenith: 0x1c2a4a, horizon: 0x7a6a78, haze: 0x6c6470, ground: 0x2a2624, cloudLit: 0x9a8aa0, cloudDark: 0x3a3a52, fog: 0x5a5866, fogD: 0.0085, hemiSky: 0x52608a, hemiGround: 0x2a221c, hemiI: 0.3, env: ['dusk', 'golden', 0.2], envI: 0.5 },
  { t: 6.6, zenith: 0x4f78a8, horizon: 0xe6b98a, haze: 0xd9b48e, ground: 0x6a5a4a, cloudLit: 0xffd2a0, cloudDark: 0x8a7a8a, fog: 0xcaa888, fogD: 0.0072, hemiSky: 0x9fb0c8, hemiGround: 0x6a5642, hemiI: 0.45, env: ['golden', 'day', 0.3], envI: 0.8 },
  { t: 8.5, zenith: 0x3f74b0, horizon: 0xb8bcb8, haze: 0xb4b2a6, ground: 0x7a7060, cloudLit: 0xf4f0e8, cloudDark: 0x8c929c, fog: 0xaeaca0, fogD: 0.0046, hemiSky: 0xb8c8dc, hemiGround: 0x6a5a48, hemiI: 0.42, env: ['day', 'day', 0], envI: 0.85 },
  { t: 12.5, zenith: 0x3d70ae, horizon: 0xbcbeb6, haze: 0xb8b4a6, ground: 0x7e7464, cloudLit: 0xf8f6f0, cloudDark: 0x9298a0, fog: 0xb2aea0, fogD: 0.0048, hemiSky: 0xbccbdc, hemiGround: 0x6e604c, hemiI: 0.42, env: ['day', 'day', 0], envI: 0.85 },
  { t: 16.0, zenith: 0x3c6aa4, horizon: 0xc8bca0, haze: 0xc0b090, ground: 0x7a6a54, cloudLit: 0xf8ead4, cloudDark: 0x8e8884, fog: 0xb8aa8c, fogD: 0.005, hemiSky: 0xbcc2cc, hemiGround: 0x705c44, hemiI: 0.42, env: ['day', 'golden', 0.35], envI: 0.85 },
  { t: 17.6, zenith: 0x4a6a98, horizon: 0xf0a868, haze: 0xe0a070, ground: 0x6a5240, cloudLit: 0xffbe80, cloudDark: 0x8a6a72, fog: 0xc89670, fogD: 0.0072, hemiSky: 0xb0a8b8, hemiGround: 0x6a5038, hemiI: 0.42, env: ['golden', 'golden', 0], envI: 0.8 },
  { t: 18.4, zenith: 0x2c3e6a, horizon: 0xc0706a, haze: 0x9a6a6c, ground: 0x3a2e2c, cloudLit: 0xe08a78, cloudDark: 0x4a3c50, fog: 0x7a5c62, fogD: 0.0082, hemiSky: 0x6a6a90, hemiGround: 0x3a2c24, hemiI: 0.3, env: ['golden', 'dusk', 0.6], envI: 0.6 },
  { t: 19.2, zenith: 0x121c38, horizon: 0x40384e, haze: 0x3a3444, ground: 0x18161a, cloudLit: 0x4a4258, cloudDark: 0x1c1a26, fog: 0x2c2a36, fogD: 0.0095, hemiSky: 0x2c3454, hemiGround: 0x1c1612, hemiI: 0.2, env: ['dusk', 'night', 0.5], envI: 0.42 },
  { t: 20.5, zenith: 0x070b18, horizon: 0x1a1c2a, haze: 0x1e1e2a, ground: 0x0e0d10, cloudLit: 0x2e2c38, cloudDark: 0x121218, fog: 0x1a1b24, fogD: 0.0105, hemiSky: 0x1e2640, hemiGround: 0x15110e, hemiI: 0.16, env: ['night', 'night', 0], envI: 0.34 },
  { t: 24.5, zenith: 0x05080f, horizon: 0x141622, haze: 0x181a24, ground: 0x0b0b0d, cloudLit: 0x26262e, cloudDark: 0x0f0f14, fog: 0x15161e, fogD: 0.011, hemiSky: 0x1a2038, hemiGround: 0x120e0b, hemiI: 0.14, env: ['night', 'night', 0], envI: 0.3 },
];

const _ca = new THREE.Color(), _cb = new THREE.Color(), _sc = new THREE.Color();
function lerpHex(a: number, b: number, k: number, out: THREE.Color) {
  _ca.setHex(a); _cb.setHex(b);
  return out.copy(_ca).lerp(_cb, k);
}

export class Atmosphere {
  readonly root = new THREE.Group();
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  private hdris: Record<string, HdriInfo> = {};
  private envScene = new THREE.Scene();
  private envMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envTimer = 0;
  private shadowHalf = 34;
  /** shadow frustum length along the view direction (the box is elongated so far facades keep their shadows) */
  private shadowLen = 80;
  /** blended values for this frame (read by other systems) */
  night = 0;
  sunElev = 0;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(-0.35, 0.72, -0.6).normalize();
  autoLook = true;
  overrideTime: number | null = null;
  /** lighting balance (key light vs ambient fill); tweakable from the console via window.__atmo */
  sunScale = 1;
  fillScale = 1;
  exposure = 1;
  cover = 0.45;

  constructor(private game: Game) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: this.moonDir },
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uSunVis: { value: 1 }, uNight: { value: 0 }, uTime: U.uTime,
        uCover: { value: 0.45 }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() }, uHazeK: { value: 0.6 },
        uStars: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), this.skyMat);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.root.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    const q = game.engine.quality;
    // non-square map: x = across the view, y = along the view (far side of the soi still gets shadows)
    const sq = new URLSearchParams(location.search).has('sqshadow');
    const ms = sq ? [2048, 2048] : q === 'ultra' ? [4096, 8192] : q === 'high' ? [2048, 4096] : q === 'medium' ? [2048, 3072] : [1024, 1536];
    this.shadowHalf = q === 'low' ? 24 : 32;
    this.shadowLen = q === 'low' ? 40 : q === 'medium' ? 62 : 76;
    this.sun.shadow.mapSize.set(ms[0], ms[1]);
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowHalf; sc.right = this.shadowHalf; sc.top = this.shadowLen; sc.bottom = -this.shadowLen;
    sc.near = 1; sc.far = 340;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.root.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xc8d6e6, 0x7a6a56, 0.5);
    this.root.add(this.hemi);
    this.fog = new THREE.FogExp2(0xd2cdbd, 0.006);

    this.envMat = new THREE.ShaderMaterial({
      vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: { tA: { value: null }, tB: { value: null }, k: { value: 0 }, eA: { value: 1 }, eB: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, clampV: { value: 7 } },
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.envMat));
    this.pmrem = new THREE.PMREMGenerator(game.engine.renderer);
    (window as any).__atmo = this;
  }

  async loadHdris() {
    this.hdris = await preloadHdris();
  }

  /** scene hookup */
  attach(scene: THREE.Scene) {
    scene.add(this.root);
    scene.fog = this.fog;
    scene.background = null;
  }

  private blend(t: number) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    if (t < KEYS[0].t) { a = b = KEYS[0]; }
    const k = a === b ? 0 : (t - a.t) / (b.t - a.t);
    const s = k * k * (3 - 2 * k);
    return { a, b, k: s };
  }

  update(dt: number, camera: THREE.Camera) {
    const game = this.game;
    const clock = game.clock;
    const t = this.overrideTime ?? clock.time;
    const { a, b, k } = this.blend(t);
    const u = this.skyMat.uniforms;
    lerpHex(a.zenith, b.zenith, k, u.uZenith.value);
    lerpHex(a.horizon, b.horizon, k, u.uHorizon.value);
    lerpHex(a.haze, b.haze, k, u.uHaze.value);
    lerpHex(a.ground, b.ground, k, u.uGround.value);
    lerpHex(a.cloudLit, b.cloudLit, k, u.uCloudLit.value);
    lerpHex(a.cloudDark, b.cloudDark, k, u.uCloudDark.value);
    lerpHex(a.fog, b.fog, k, this.fog.color);
    this.fog.density = a.fogD + (b.fogD - a.fogD) * k;
    lerpHex(a.hemiSky, b.hemiSky, k, this.hemi.color);
    lerpHex(a.hemiGround, b.hemiGround, k, this.hemi.groundColor);
    this.hemi.intensity = (a.hemiI + (b.hemiI - a.hemiI) * k) * 0.8 * this.fillScale;
    u.uCover.value = this.cover;

    // sun
    const sd = this.sunDirAt(t, this.sunDir);
    this.sunElev = Math.asin(sd.y);
    u.uSunDir.value.copy(sd);
    U.uSunDir.value.copy(sd);
    const elev = this.sunElev;
    const sunUp = THREE.MathUtils.smoothstep(elev, -0.04, 0.22);
    const night = clock.nightFactor !== undefined ? this.nightAt(t) : 0;
    this.night = night;
    u.uNight.value = night;
    u.uStars.value = THREE.MathUtils.smoothstep(night, 0.4, 1.0);
    u.uSunVis.value = THREE.MathUtils.smoothstep(elev, -0.06, 0.03);
    u.uHazeK.value = 0.55 + 0.35 * (1 - sunUp) * (1 - night);
    const warm = 1 - THREE.MathUtils.smoothstep(elev, 0.05, 0.6);
    const sunCol = u.uSunCol.value as THREE.Color;
    sunCol.setRGB(1.0, 0.93 - warm * 0.33, 0.82 - warm * 0.55);
    // moon light at night, sun by day (same light → one shadow map)
    const moonK = THREE.MathUtils.smoothstep(night, 0.6, 1.0);
    if (sunUp > 0.001) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 4.4 * sunUp * (1 - warm * 0.3) * this.sunScale;
      this.lightDir.copy(sd);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.16 * moonK;
      this.lightDir.copy(this.moonDir);
    }
    U.uNight.value = night;

    // environment (HDRI blend) — rebake when it changes enough
    this.envTimer -= dt;
    const [ea, eb, ek0] = a.env, [fa, fb, fk0] = b.env;
    // blend keyframe env pairs: pick the two most significant sources
    const wA: Record<string, number> = {};
    const add = (key: string, w: number) => { wA[key] = (wA[key] ?? 0) + w; };
    add(ea, (1 - ek0) * (1 - k)); add(eb, ek0 * (1 - k)); add(fa, (1 - fk0) * k); add(fb, fk0 * k);
    const sorted = Object.entries(wA).sort((x, y) => y[1] - x[1]);
    const s0 = sorted[0], s1 = sorted[1] ?? sorted[0];
    const mixK = s1 === s0 ? 0 : s1[1] / (s0[1] + s1[1]);
    const envI = a.envI + (b.envI - a.envI) * k;
    const key = `${s0[0]}|${s1[0]}|${mixK.toFixed(2)}`;
    if (key !== this.envKey && this.envTimer <= 0) this.bakeEnv(s0[0], s1[0], mixK, key);
    if (game.scene) game.scene.environmentIntensity = envI * this.fillScale;

    // sky follows camera
    this.sky.position.copy(camera.position);
    this.updateShadow(camera);

    // post look
    if (this.autoLook) this.applyLook(t, night, dt);
    // sun shafts between the buildings (strongest in the low morning sun) + humid Mie haze toward the sun
    const post = game.engine.post;
    const morning = Math.max(0, 1 - Math.abs(t - 7.6) / 2.4);
    const evening = Math.max(0, 1 - Math.abs(t - 17.2) / 1.6);
    const vis = u.uSunVis.value * (1 - night);
    _sc.copy(sunCol).multiplyScalar(1.0 + warm * 0.5);
    post.setSun(sd, _sc, vis * (0.05 + 0.3 * morning + 0.2 * evening), vis * (0.025 + 0.06 * warm), 150);
    if (this.autoLook) post.exposure = (1.0 + 0.12 * night) * this.exposure;
  }

  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private _f = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _mi = new THREE.Matrix4();

  private _up = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private updateShadow(camera: THREE.Camera) {
    const cam = camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(this._f);
    this._f.y = 0;
    if (this._f.lengthSq() < 1e-4) this._f.set(0, 0, -1);
    this._f.normalize();
    const L = this.lightDir.lengthSq() > 0 ? this.lightDir : this.sunDir;
    // light-space "up" = view forward projected onto the plane facing the light → the long side of the box
    const up = this._up.copy(this._f).addScaledVector(L, -this._f.dot(L));
    if (up.lengthSq() < 1e-4) up.set(0, 1, 0).addScaledVector(L, -L.y);
    up.normalize();
    const right = this._r.crossVectors(up, L).normalize();
    // box centre: ahead of the camera (most of the length in front, ~12 m behind)
    const fwd = this.shadowLen - 12;
    const c = this._c.copy(cam.position).addScaledVector(this._f, fwd * 0.92);
    c.y = 0;
    // snap to the texel grid in light space (no shimmering when walking)
    const tx = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x, ty = (this.shadowLen * 2) / this.sun.shadow.mapSize.y;
    const a = c.dot(right), b = c.dot(up);
    c.addScaledVector(right, Math.round(a / tx) * tx - a).addScaledVector(up, Math.round(b / ty) * ty - b);
    this.sun.shadow.camera.up.copy(up);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(L, 170);
    this.sun.target.updateMatrixWorld();
  }

  private bakeEnv(a: string, b: string, k: number, key: string) {
    const A = this.hdris[a] ?? this.hdris.day, B = this.hdris[b] ?? A;
    if (!A?.tex) return;
    this.envKey = key;
    this.envTimer = 1.5;
    const u = this.envMat.uniforms;
    u.tA.value = A.tex; u.tB.value = B.tex; u.k.value = k; u.eA.value = A.exp; u.eB.value = B.exp;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    const old = this.envRT;
    this.envRT = rt;
    if (this.game.scene) this.game.scene.environment = rt.texture;
    old?.dispose();
  }

  /** sun direction: the clock's model, but slightly rotated so shadows fall across the soi nicely */
  sunDirAt(t: number, out: THREE.Vector3) {
    const h = ((t - 6.2) / 12.3) * Math.PI;
    const elev = Math.sin(h) * (Math.PI / 2 - 0.36);
    const az = Math.PI * 0.5 - h;
    out.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.55 + 0.28).normalize();
    return out;
  }

  nightAt(t: number) {
    if (t < 6.3) return t < 5.2 ? 1 : 1 - (t - 5.2) / 1.1;
    if (t < 17.9) return 0;
    return Math.min(1, (t - 17.9) / 1.7);
  }

  private look = { lift: [0, 0, 0] as [number, number, number], gamma: [1, 1, 1] as [number, number, number], gain: [1, 1, 1] as [number, number, number], tint: [1, 1, 1] as [number, number, number], saturation: 1, contrast: 1, split: 0 };
  private applyLook(t: number, night: number, dt: number) {
    const post = this.game.engine.post;
    // weights
    const golden = Math.max(0, 1 - Math.abs(t - 17.6) / 1.1) + Math.max(0, 1 - Math.abs(t - 6.5) / 0.8);
    const g = Math.min(1, golden) * (1 - night);
    const n = night;
    const d = Math.max(0, 1 - g - n);
    const L: any = LOOKS;
    const mix3 = (key: 'lift' | 'gamma' | 'gain' | 'tint', def: number) => {
      const out = this.look[key];
      for (let i = 0; i < 3; i++) {
        const v = (L.thaiDay[key]?.[i] ?? def) * d + (L.golden[key]?.[i] ?? def) * g + (L.night[key]?.[i] ?? def) * n;
        out[i] = v;
      }
    };
    mix3('lift', 0); mix3('gamma', 1); mix3('gain', 1); mix3('tint', 1);
    this.look.saturation = (L.thaiDay.saturation ?? 1) * d + (L.golden.saturation ?? 1) * g + (L.night.saturation ?? 1) * n;
    this.look.contrast = (L.thaiDay.contrast ?? 1) * d + (L.golden.contrast ?? 1) * g + (L.night.contrast ?? 1) * n;
    this.look.split = (L.thaiDay.split ?? 0) * d + (L.golden.split ?? 0) * g + (L.night.split ?? 0) * n;
    post.setLook(this.look, 1 - Math.exp(-dt * 4));
  }

  dispose() {
    this.game.engine.post.setSun(null);
    this.game.engine.post.exposure = 1;
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.skyMat.dispose();
    this.envMat.dispose();
  }
}

