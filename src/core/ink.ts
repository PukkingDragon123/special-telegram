import * as THREE from 'three';
import { Pass, Effect, BlendFunction } from 'postprocessing';
import { params } from './util';

/* =============================================================================================
 * INK — the "inked realism" layer (docs/ART_STYLE.md §1).
 *
 *  1. InkEdgePass   screen-space outlines + creases from the depth buffer. Runs right after the
 *                   RenderPass (reads its colour + depth, writes a small R8 line mask), so it never
 *                   touches the composer's buffer-swap parity. Edges come from the second difference
 *                   of 1/z (exactly zero on any plane, at any slant): big jumps relative to the nearer
 *                   surface = silhouettes (thick), kinks in the slope per radian of view = creases (thin).
 *                   Line width is in 1080p pixels × resolution, thins + fades with distance and fog,
 *                   wobbles a little from world-anchored noise (hand-inked, stable when still).
 *  2. InkEffect     composites the mask before bloom/tone mapping: very dark ink tinted toward the
 *                   local colour; near bright (HDR) lights the line takes the light's colour (neon).
 *  3. Material patch (global, onBeforeCompile on built-in mesh materials):
 *                   - ink mask in the alpha of the scene buffer (material.userData.ink 0..1, default 1;
 *                     alpha-tested foliage 0.45) → no lines where a material opts out (3D text, FX…)
 *                   - soft cel lighting: per-light Lambert stepped toward 3 soft bands (normal-map
 *                     relief kept on top) + crisper shadow edges. material.userData.cel = 0 opts out.
 *                   ShaderMaterial / RawShaderMaterial are never touched.
 *  4. addInkHull()  inverted-hull silhouettes (back faces pushed out a constant number of screen
 *                   pixels, SkinnedMesh-aware: same skeleton, same bind) for characters, animals and
 *                   hero props. Hulls are children of their source mesh (LOD / visibility follow it).
 *
 *  ?ink=0 disables outlines + hulls, ?cel=0 disables the cel banding (for comparisons).
 * ============================================================================================= */

export const InkSettings = {
  ink: params.get('ink') !== '0',
  cel: params.get('cel') !== '0',
};

// ------------------------------------------------------------------ shared uniforms

/** global cel controls (shared by every patched material) */
export const CEL = {
  uCelK: { value: InkSettings.cel ? 0.45 : 0 },
  uCelShadow: { value: InkSettings.cel ? 0.6 : 0 },
  uCelSoft: { value: 0.075 },
};

// ------------------------------------------------------------------ material patch

const RAW = Symbol('ink.raw');
const WRAP = Symbol('ink.wrap');
const WRAP_RAW = Symbol('ink.wrapRaw');
const MU = Symbol('ink.mu');
let installed = false;

interface MatU { uInkMask: { value: number }; uCelMat: { value: number } }

function matUniforms(m: any): MatU {
  let u: MatU = m[MU];
  if (!u) {
    const ink = m.userData?.ink ?? (m.alphaTest > 0 ? 0.45 : 1);
    const cel = m.userData?.cel ?? (m.userData?.noCel ? 0 : 1);
    u = m[MU] = { uInkMask: { value: ink }, uCelMat: { value: cel } };
  }
  return u;
}

/** Change ink (0 = no screen-space lines on/around it) and/or cel (0 = plain PBR) of a material or of
 *  every material under an object. Works before or after the material compiled. */
export function setInk(target: THREE.Object3D | THREE.Material | THREE.Material[], ink?: number, cel?: number) {
  const apply = (m: any) => {
    if (!m) return;
    m.userData ??= {};
    if (ink !== undefined) m.userData.ink = ink;
    if (cel !== undefined) m.userData.cel = cel;
    const u: MatU | undefined = m[MU];
    if (u) { if (ink !== undefined) u.uInkMask.value = ink; if (cel !== undefined) u.uCelMat.value = cel; }
  };
  if (Array.isArray(target)) { target.forEach(apply); return; }
  if ((target as any).isMaterial) { apply(target); return; }
  (target as THREE.Object3D).traverse((o: any) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) o.material.forEach(apply); else apply(o.material);
  });
}

const CEL_HEAD = /* glsl */ `
uniform float uInkMask;
uniform float uCelK;
uniform float uCelShadow;
uniform float uCelSoft;
uniform float uCelMat;
vec3 celGeoN = vec3( 0.0, 0.0, 1.0 );
// per-light Lambert → 3 soft bands (0 / .5 / 1) on the smooth geometric normal; the normal-map relief rides on top
float celBand( float nl, vec3 L ) {
  float k = uCelK * uCelMat;
  if ( k <= 0.0 ) return nl;
  float g = saturate( dot( celGeoN, L ) );
  float w = uCelSoft;
  float b = 0.5 * smoothstep( 0.1 - w, 0.1 + w, g ) + 0.5 * smoothstep( 0.52 - w, 0.52 + w, g );
  b = max( b + ( nl - g ) * 0.85, 0.0 );
  return mix( nl, b, k );
}
// crisper (anime) shadow edges from the soft PCF result
float celShadowSharp( float s ) {
  float k = uCelShadow * uCelMat;
  return mix( s, smoothstep( 0.28, 0.72, s ), k );
}
`;
const MASK_HEAD = /* glsl */ `
uniform float uInkMask;
`;

const DOTNL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const SHADOW_RET = 'return mix( 1.0, shadow, shadowIntensity );';

function expand(fs: string, chunk: string, edit: (s: string) => string) {
  const inc = `#include <${chunk}>`;
  if (!fs.includes(inc)) return fs;
  return fs.replace(inc, edit((THREE.ShaderChunk as any)[chunk] as string));
}

function patchShader(m: any, sh: any) {
  if (sh.__ink) return;
  sh.__ink = true;
  if (m.isShaderMaterial || m.isRawShaderMaterial) return;
  const lit = !!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
  const masked = lit || m.isMeshBasicMaterial || m.isMeshToonMaterial || m.isMeshMatcapMaterial;
  if (!masked) return;
  let fs: string = sh.fragmentShader;
  if (!fs.includes('#include <common>')) return;
  const u = matUniforms(m);
  sh.uniforms.uInkMask = u.uInkMask;
  if (fs.includes('#include <opaque_fragment>')) {
    fs = fs.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n#ifdef OPAQUE\ngl_FragColor.a = uInkMask;\n#endif');
  }
  if (lit) {
    sh.uniforms.uCelK = CEL.uCelK;
    sh.uniforms.uCelShadow = CEL.uCelShadow;
    sh.uniforms.uCelSoft = CEL.uCelSoft;
    sh.uniforms.uCelMat = u.uCelMat;
    fs = fs.replace('#include <common>', '#include <common>\n' + CEL_HEAD);
    fs = expand(fs, 'shadowmap_pars_fragment', (s) => s.split(SHADOW_RET).join('return mix( 1.0, celShadowSharp( shadow ), shadowIntensity );'));
    for (const c of ['lights_physical_pars_fragment', 'lights_lambert_pars_fragment', 'lights_phong_pars_fragment']) {
      fs = expand(fs, c, (s) => s.split(DOTNL).join('float dotNL = celBand( saturate( dot( geometryNormal, directLight.direction ) ), directLight.direction );'));
    }
    fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\ncelGeoN = normal;');
  } else {
    fs = fs.replace('#include <common>', '#include <common>\n' + MASK_HEAD);
  }
  sh.fragmentShader = fs;
}

/**
 * Global onBeforeCompile hook. Material.prototype.onBeforeCompile becomes an accessor: whatever a module
 * assigns is kept as the "raw" hook and runs first, then the ink/cel patch. Program cache keys keep using
 * the raw hook's source (as three does by default), so materials with different hooks never share programs.
 * Safe with hook chaining (`const prev = m.onBeforeCompile; m.onBeforeCompile = (s, r) => { prev(s, r); … }`).
 */
export function installMaterialPatch() {
  if (installed) return;
  installed = true;
  const proto = THREE.Material.prototype as any;
  const base = proto.onBeforeCompile as (...a: any[]) => void;
  const protoWrap = function (this: any, shader: any) { patchShader(this, shader); };
  (protoWrap as any).__inkRaw = null;
  Object.defineProperty(proto, 'onBeforeCompile', {
    configurable: true,
    get(this: any) {
      if (this === proto) return protoWrap;
      const raw = this[RAW] ?? null;
      if (!raw) return protoWrap;
      if (this[WRAP] && this[WRAP_RAW] === raw) return this[WRAP];
      const w = function (this: any, shader: any, renderer: any) {
        raw.call(this, shader, renderer);
        patchShader(this, shader);
      };
      (w as any).__inkRaw = raw;
      this[WRAP] = w;
      this[WRAP_RAW] = raw;
      return w;
    },
    set(this: any, fn: any) {
      if (fn && Object.prototype.hasOwnProperty.call(fn, '__inkRaw')) fn = fn.__inkRaw;
      this[RAW] = fn === base ? null : fn ?? null;
    },
  });
  proto.customProgramCacheKey = function (this: any) {
    const r = this[RAW];
    return r ? r.toString() : base.toString();
  };
}

// ------------------------------------------------------------------ edge pass

const FS_TRI = /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const EDGE_FRAG = /* glsl */ `
precision highp float;
uniform highp sampler2D tDepth;
uniform sampler2D tColor;
uniform vec2 res;
uniform vec2 nearFar;
uniform float pxScale;
uniform float pixAngle;
uniform float silPx;
uniform float creasePx;
uniform vec2 silT;
uniform vec2 crT;
uniform float creaseK;
uniform vec2 fade;
uniform float fogD;
uniform float jitter;
uniform mat4 projInv;
uniform mat4 viewInv;
varying vec2 vUv;

float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// 1/z (view distance) from the perspective depth buffer: exact and planar-linear in screen space
float W(vec2 uv) { return mix(1.0 / nearFar.x, 1.0 / nearFar.y, texture2D(tDepth, uv).r); }
float M(vec2 uv) { return texture2D(tColor, uv).a; }

void main() {
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(0.0); return; }        // sky: no ink on the sky itself
  float w0 = mix(1.0 / nearFar.x, 1.0 / nearFar.y, d0);
  float z0 = 1.0 / w0;
  // ---- distance: thinner, fainter, fog-aware
  float vis = exp(-fogD * fogD * z0 * z0 * 0.7);
  float dk = (1.0 - smoothstep(fade.x, fade.y, z0)) * vis;
  if (dk < 0.01) { gl_FragColor = vec4(0.0); return; }
  float farK = smoothstep(2.5, 28.0, z0);
  // ---- hand-inked wobble, anchored to the world (no shimmer when still)
  vec4 vp = projInv * vec4(vUv * 2.0 - 1.0, d0 * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (viewInv * vec4(vp.xyz, 1.0)).xyz;
  float n1 = vnoise(wp * 3.1);
  float n2 = vnoise(wp * 0.9 + 17.0);
  float wob = mix(1.0, 0.62 + 0.76 * n1, jitter);
  float op = mix(1.0, 0.78 + 0.22 * n2, jitter);
  vec2 px = 1.0 / res;
  // ---- silhouettes (thick): 4 pairs at radius rs; |second difference of 1/z| relative to the nearer side
  float rsD = silPx * pxScale * mix(1.0, 0.42, farK) * wob;
  float rs = max(1.0, rsD);
  vec2 ox = vec2(rs, 0.0) * px, oy = vec2(0.0, rs) * px;
  vec2 od = vec2(rs, rs) * px * 0.7071, oe = vec2(rs, -rs) * px * 0.7071;
  float a1 = W(vUv + ox), b1 = W(vUv - ox), a2 = W(vUv + oy), b2 = W(vUv - oy);
  float a3 = W(vUv + od), b3 = W(vUv - od), a4 = W(vUv + oe), b4 = W(vUv - oe);
  vec4 sd = abs(vec4(a1 + b1, a2 + b2, a3 + b3, a4 + b4) - 2.0 * w0);
  vec4 wn = max(max(vec4(a1, a2, a3, a4), vec4(b1, b2, b3, b4)), vec4(w0));
  vec4 rel = sd / wn;
  float sil = smoothstep(silT.x, silT.y, max(max(rel.x, rel.y), max(rel.z, rel.w))) * min(1.0, rsD);
  // ---- creases (thin): kink of the 1/z slope per radian of view (resolution independent)
  float rcD = creasePx * pxScale * mix(1.0, 0.6, farK) * wob;
  float rc = max(1.0, floor(rcD + 0.5));
  vec2 cx = vec2(rc, 0.0) * px, cy = vec2(0.0, rc) * px;
  float c1 = W(vUv + cx) + W(vUv - cx) - 2.0 * w0;
  float c2 = W(vUv + cy) + W(vUv - cy) - 2.0 * w0;
  float cm = abs(c1) > abs(c2) ? c1 : c2;
  float curv = abs(cm) / (w0 * rc * pixAngle);
  // convex edges (closer in the middle) ink fully, concave inside corners a bit lighter
  float crease = smoothstep(crT.x, crT.y, curv) * creaseK * (cm < 0.0 ? 1.0 : 0.7) * min(1.0, rcD);
  // ---- mask: materials that opted out (alpha < 1 in the scene buffer) suppress lines on and around them
  float m = min(M(vUv), min(min(M(vUv + ox), M(vUv - ox)), min(M(vUv + oy), M(vUv - oy))));
  m = clamp(m, 0.0, 1.0);
  float line = max(sil, crease) * m * dk * op;
  gl_FragColor = vec4(line, 0.0, 0.0, 1.0);
}`;

export interface InkParams {
  /** silhouette half-width, px at 1080p */
  silPx: number;
  /** crease half-width, px at 1080p */
  creasePx: number;
  /** silhouette thresholds on 1 - z_near/z_far */
  silT: [number, number];
  /** crease thresholds (slope kink per radian) */
  crT: [number, number];
  creaseK: number;
  /** distance fade start/end, metres */
  fade: [number, number];
  /** hand-inked wobble 0..1 */
  jitter: number;
}

export const INK_DEFAULTS: InkParams = {
  silPx: 1.6, creasePx: 1.0, silT: [0.012, 0.045], crT: [0.75, 1.6], creaseK: 0.85, fade: [30, 85], jitter: 0.6,
};

export class InkEdgePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  readonly u: Record<string, THREE.IUniform>;
  private cam: THREE.Camera;
  private sceneRef: THREE.Scene | null = null;

  constructor(camera: THREE.Camera, p: InkParams = INK_DEFAULTS) {
    super('InkEdgePass');
    this.cam = camera;
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.target.texture.name = 'ink.mask';
    this.u = {
      tDepth: { value: null }, tColor: { value: null },
      res: { value: new THREE.Vector2(1, 1) }, nearFar: { value: new THREE.Vector2(0.05, 900) },
      pxScale: { value: 1 }, pixAngle: { value: 0.001 },
      silPx: { value: p.silPx }, creasePx: { value: p.creasePx },
      silT: { value: new THREE.Vector2(...p.silT) }, crT: { value: new THREE.Vector2(...p.crT) },
      creaseK: { value: p.creaseK }, fade: { value: new THREE.Vector2(...p.fade) }, fogD: { value: 0 },
      jitter: { value: p.jitter },
      projInv: { value: new THREE.Matrix4() }, viewInv: { value: new THREE.Matrix4() },
    };
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: 'InkEdge', uniforms: this.u, vertexShader: FS_TRI, fragmentShader: EDGE_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
  }

  set mainCamera(c: THREE.Camera) { this.cam = c; }
  set mainScene(s: THREE.Scene) { this.sceneRef = s; }
  setScene(s: THREE.Scene) { this.sceneRef = s; }

  setParams(p: Partial<InkParams>) {
    const u = this.u;
    if (p.silPx !== undefined) u.silPx.value = p.silPx;
    if (p.creasePx !== undefined) u.creasePx.value = p.creasePx;
    if (p.silT) u.silT.value.set(...p.silT);
    if (p.crT) u.crT.value.set(...p.crT);
    if (p.creaseK !== undefined) u.creaseK.value = p.creaseK;
    if (p.fade) u.fade.value.set(...p.fade);
    if (p.jitter !== undefined) u.jitter.value = p.jitter;
  }

  override setDepthTexture(t: THREE.Texture) { this.u.tDepth.value = t; }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    const cam = this.cam as THREE.PerspectiveCamera;
    const u = this.u;
    u.tColor.value = inputBuffer.texture;
    u.nearFar.value.set(cam.near, cam.far);
    const h = u.res.value.y;
    u.pxScale.value = h / 1080;
    u.pixAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 70) * 0.5))) / Math.max(1, h) / Math.max(0.1, cam.zoom ?? 1);
    u.projInv.value.copy(cam.projectionMatrixInverse);
    u.viewInv.value.copy(cam.matrixWorld);
    const fog = this.sceneRef?.fog as any;
    u.fogD.value = fog?.isFogExp2 ? fog.density : fog?.isFog ? 1.6 / Math.max(1, fog.far) : 0;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
  }

  override setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
    this.u.res.value.set(Math.max(1, w), Math.max(1, h));
  }

  override dispose() { this.target.dispose(); super.dispose(); }
}

// ------------------------------------------------------------------ composite

export class InkEffect extends Effect {
  constructor(mask: THREE.Texture) {
    super('InkEffect', /* glsl */ `
      uniform sampler2D tInk;
      uniform vec3 inkCol;
      uniform float inkK;
      uniform float tintK;
      uniform float glowK;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float a = texture2D(tInk, uv).r * inkK;
        vec3 c = inputColor.rgb;
        if (a <= 0.001) { outputColor = inputColor; return; }
        float mx = max(c.r, max(c.g, c.b));
        vec3 hue = c / max(mx, 1e-4);
        // very dark ink, tinted toward the local colour (never pure #000)
        vec3 ink = inkCol * mix(vec3(1.0), hue * 1.7 + 0.15, tintK);
        // next to bright (HDR) lights the stroke takes the light's colour: warm bulbs / neon at night
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        ink += c * smoothstep(0.7, 3.5, l) * glowK;
        outputColor = vec4(mix(c, ink, a), inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['tInk', new THREE.Uniform(mask)],
        ['inkCol', new THREE.Uniform(new THREE.Color(0.0085, 0.006, 0.005))],
        ['inkK', new THREE.Uniform(InkSettings.ink ? 1 : 0)],
        ['tintK', new THREE.Uniform(0.55)],
        ['glowK', new THREE.Uniform(0.12)],
      ]),
    });
  }
  u(name: string) { return this.uniforms.get(name)!; }
}

// ------------------------------------------------------------------ inverted hulls

const HULL_U = {
  uRes: { value: new THREE.Vector2(1920, 1080) },
  uPxScale: { value: 1 },
  uOn: { value: InkSettings.ink ? 1 : 0 },
};

const HULL_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec2 uRes;
uniform float uPxScale;
uniform float uPx;
uniform float uWorld;
uniform float uRef;
uniform float uMaxDist;
uniform float uOn;
#ifdef HULL_FAT
attribute float afat;
uniform float uFat;
#endif
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #ifdef HULL_FAT
  transformed += normal * afat * uFat;
  #endif
  transformed += normal * uWorld;
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec3 nv = normalize(normalMatrix * objectNormal);
  vec4 clip = projectionMatrix * mv;
  vec2 dir = (projectionMatrix * vec4(nv, 0.0)).xy;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(0.0);
  float z = max(-mv.z, 0.05);
  // constant screen width up close, constant world width further away, gone before it turns to mush
  float px = uPx * uPxScale * clamp(uRef / z, 0.28, 1.0) * (1.0 - smoothstep(uMaxDist * 0.6, uMaxDist, z)) * uOn;
  clip.xy += dir * (px * 2.0) / uRes * clip.w;
  gl_Position = clip;
}`;

const HULL_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }`;

export interface HullOpts {
  /** extra world-space push along the normal (fur, fuzzy surfaces), metres */
  world?: number;
  /** line colour (linear), default warm near-black */
  color?: THREE.ColorRepresentation;
  /** only SkinnedMesh descendants (characters) */
  skinnedOnly?: boolean;
  /** hull fades out by this distance (m), default 32 */
  maxDist?: number;
  /** distance (m) under which the width is constant in pixels, default 3.5 */
  refDist?: number;
  /** extra filter */
  filter?: (m: THREE.Mesh) => boolean;
}

interface Track { root: THREE.Object3D; px: number; o: HullOpts; hulls: Set<THREE.Mesh>; orphan: number; stagger: number }
const tracks = new Map<THREE.Object3D, Track>();
const DEF_COL = new THREE.Color(0.006, 0.0042, 0.0034);
let frameN = 0;

function firstMat(m: THREE.Mesh): THREE.Material | null {
  const mm = m.material as any;
  return Array.isArray(mm) ? mm[0] ?? null : mm ?? null;
}

function eligible(m: any, t: Track) {
  if (!m.isMesh || m.isInstancedMesh || m.isBatchedMesh || m.userData?.inkHull || m.userData?.noHull) return false;
  if (m.userData?.inkHullRef) return false;
  if (!m.geometry?.attributes?.normal || !m.geometry.attributes.position) return false;
  if (t.o.skinnedOnly && !m.isSkinnedMesh) return false;
  if ((m.renderOrder ?? 0) !== 0) return false;
  if (/proxy/i.test(m.name || '')) return false;
  const mat: any = firstMat(m);
  if (!mat || mat.visible === false || mat.transparent || mat.colorWrite === false) return false;
  if (mat.userData?.noHull || mat.userData?.ink === 0) return false;
  if (mat.isShaderMaterial && !mat.isMeshStandardMaterial) return false;
  if (t.o.filter && !t.o.filter(m)) return false;
  return true;
}

function makeHull(src: THREE.Mesh, t: Track): THREE.Mesh {
  const mat0: any = firstMat(src);
  const fat = !!(src.geometry.attributes.afat && mat0?.userData?.uFat);
  const mat = new THREE.ShaderMaterial({
    name: 'InkHull',
    uniforms: {
      uRes: HULL_U.uRes, uPxScale: HULL_U.uPxScale, uOn: HULL_U.uOn,
      uPx: { value: t.px }, uWorld: { value: t.o.world ?? 0 }, uRef: { value: t.o.refDist ?? 3.5 },
      uMaxDist: { value: t.o.maxDist ?? 32 },
      uColor: { value: new THREE.Color(t.o.color ?? DEF_COL) },
      ...(fat ? { uFat: mat0.userData.uFat } : {}),
    },
    defines: fat ? { HULL_FAT: '' } : {},
    vertexShader: HULL_VERT, fragmentShader: HULL_FRAG,
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
  });
  let h: THREE.Mesh;
  if ((src as any).isSkinnedMesh) {
    const s = src as THREE.SkinnedMesh;
    const sk = new THREE.SkinnedMesh(s.geometry, mat);
    sk.bindMode = s.bindMode;
    sk.bind(s.skeleton, s.bindMatrix);
    h = sk;
  } else {
    h = new THREE.Mesh(src.geometry, mat);
  }
  h.name = 'ink-hull';
  h.userData.inkHull = true;
  h.renderOrder = 3;
  h.castShadow = false;
  h.receiveShadow = false;
  h.frustumCulled = src.frustumCulled;
  if ((src as any).boundingSphere) (h as any).boundingSphere = (src as any).boundingSphere;
  else if ((src as any).isSkinnedMesh) h.frustumCulled = false;
  h.layers.mask = src.layers.mask;
  h.raycast = () => {};
  src.add(h);
  src.userData.inkHullRef = h;
  return h;
}

function scan(t: Track) {
  t.root.traverse((o: any) => { if (eligible(o, t)) t.hulls.add(makeHull(o, t)); });
}

/**
 * Inverted-hull ink silhouette for an object (characters, animals, hero props). New meshes that appear
 * under `object` later (LOD swaps, rebuilt rigs, async model swaps) get a hull on the next rescan.
 * Returns a remover. `widthPx` is the line width in pixels at 1080p within `refDist` metres.
 */
export function addInkHull(object: THREE.Object3D, widthPx = 2.2, opts: HullOpts = {}): () => void {
  let t = tracks.get(object);
  if (!t) {
    t = { root: object, px: widthPx, o: opts, hulls: new Set(), orphan: 0, stagger: (Math.random() * 30) | 0 };
    tracks.set(object, t);
  } else { t.px = widthPx; t.o = { ...t.o, ...opts }; }
  scan(t);
  return () => removeInkHull(object);
}

export function removeInkHull(object: THREE.Object3D) {
  const t = tracks.get(object);
  if (!t) return;
  for (const h of t.hulls) {
    const src = h.parent;
    h.removeFromParent();
    (h.material as THREE.Material).dispose();
    if (src && src.userData.inkHullRef === h) delete src.userData.inkHullRef;
  }
  tracks.delete(object);
}

function inScene(o: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  while (p) { if ((p as any).isScene) return true; p = p.parent; }
  return false;
}

/** Per frame (called by PostFX before rendering): resolution uniforms, rescans, visibility sync. */
export function updateInkHulls(renderH: number, renderW: number) {
  frameN++;
  HULL_U.uRes.value.set(Math.max(1, renderW), Math.max(1, renderH));
  HULL_U.uPxScale.value = renderH / 1080;
  HULL_U.uOn.value = InkSettings.ink ? 1 : 0;
  for (const t of tracks.values()) {
    if ((frameN + t.stagger) % 30 === 0) {
      if (!inScene(t.root)) {
        if (++t.orphan > 40) { removeInkHull(t.root); continue; }     // ~20 s detached → forget it
      } else { t.orphan = 0; scan(t); }
    }
    for (const h of t.hulls) {
      const src = h.parent as THREE.Mesh | null;
      if (!src) { t.hulls.delete(h); (h.material as THREE.Material).dispose(); continue; }
      const m: any = firstMat(src);
      // first-person owner (colorWrite off), invisible materials → no hull
      h.visible = InkSettings.ink && !!m && m.colorWrite !== false && m.visible !== false;
    }
  }
}

export function inkHullCount() { let n = 0; for (const t of tracks.values()) n += t.hulls.size; return n; }
