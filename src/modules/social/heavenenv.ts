import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { RNG } from '../../core/rng';
import { GEN } from './fx';

/* ============================================================================================
 * SKILL HEAVEN — the environment: pastel sunrise sky (real Poly Haven HDRI "belfast_sunset_puresky",
 * tonemapped JPG as the visible dome + the 1k HDR for PBR image lighting), an endless cauliflower
 * cloud sea (radial grid displaced by layered Voronoi domes in the vertex shader, fbm micro detail,
 * silver lining toward the sun, horizon haze), a patchy mist layer, towering cumulus billboards,
 * drifting wisps, a sunburst of god rays, light columns over each skill cluster, twinkles, and real
 * petals (ambientCG FlowerSet001 daisy petals) + real feathers (Flickr "Feather on black") tumbling
 * down — all instanced / one draw call each, animated on the GPU (no per-frame allocations).
 *
 * Heaven-local frame: the island you stand on is at the origin, you face -Z at start; the whole
 * heaven lives under `root` placed far above the world so world sounds fade out naturally.
 * ========================================================================================== */

export const HV = GEN + 'heaven/';

export const NOISE = /* glsl */ `
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 3.1; a *= 0.5; } return s; }
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
`;

/** Sun in heaven-local space: low on the horizon, ~35° left of the starting view (matches the sky dome). */
export const SUN_VIS = new THREE.Vector3(-0.574, 0.037, -0.818).normalize();
/** Light direction used for shading (sun lifted a bit so cloud tops catch it). */
export const SUN_L = new THREE.Vector3(-0.574, 0.3, -0.818).normalize();
/** dome rotation so the HDRI's sun (u≈0.604) lands on SUN_VIS */
const SKY_ROT = Math.atan2(SUN_VIS.z, SUN_VIS.x) - (0.6045 - 0.5) * Math.PI * 2;

export const COL = {
  sun: new THREE.Color(1.0, 0.58, 0.28),
  lit: new THREE.Color(1.0, 0.82, 0.66),
  shade: new THREE.Color(0.3, 0.29, 0.55),
  haze: new THREE.Color(0.7, 0.6, 0.74),
};

const SEA_Y = -12;

/** seeded so the heaven always has the same (art-directed) layout */
let R = new RNG(20261025);
const rand = () => R.next();
/** azimuth (atan2 z,x) helper: keep big clouds out of the sun's sector */
const SUN_AZ = Math.atan2(-0.818, -0.574);
function awayFromSun(a: number, half: number) {
  const d = Math.atan2(Math.sin(a - SUN_AZ), Math.cos(a - SUN_AZ));
  return Math.abs(d) < half ? SUN_AZ + Math.sign(d || 1) * half : a;
}

// ------------------------------------------------------------------ sky dome

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  gl_Position.z = gl_Position.w * 0.99999;
}`;
const skyFrag = /* glsl */ `
uniform sampler2D uSky;
uniform float uRot, uBright;
uniform vec3 uSun, uSunCol, uHaze, uTint;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float phi = atan(d.z, d.x) - uRot;
  float vv = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  vec2 uv = vec2(fract(phi / 6.2831853 + 0.5), clamp((vv - 0.4375) / 0.5625, 0.002, 0.998));
  vec3 c = texture2D(uSky, uv).rgb;
  vec3 cb = texture2D(uSky, uv, 3.5).rgb;            // soft version for the stormy patches
  c = mix(c, cb, smoothstep(0.5, 0.22, dot(cb, vec3(0.2126, 0.7152, 0.0722))));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.3), vec3(0.0));   // a bit richer than the scan (never negative: NaN in AgX)
  c *= mix(vec3(1.0), vec3(0.84, 0.88, 1.12), smoothstep(0.1, 0.95, d.y));   // bluer, deeper zenith
  c = mix(c, uTint * 0.8, smoothstep(0.5, 0.15, dot(c, vec3(0.2126, 0.7152, 0.0722))) * 0.75);   // lift the stormy grey undersides to pastel
  c = c * 0.94 + uTint * 0.03;
  c = mix(c, uHaze, smoothstep(0.03, -0.12, d.y));
  float s = max(dot(d, uSun), 0.0);
  c += uSunCol * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 1.1 + pow(s, 700.0) * 9.0);
  gl_FragColor = vec4(max(c * uBright, vec3(0.0)), 1.0);
}`;

// ------------------------------------------------------------------ cloud sea

function radialGrid(rings: number, segs: number, rMax: number) {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const r = 1.2 + rMax * Math.pow(i / rings, 2.15);
    for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = 1 + (i + 1) * segs + j, d = 1 + (i + 1) * segs + ((j + 1) % segs);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax + 50);
  return g;
}

const seaVert = /* glsl */ `
uniform float uTime;
uniform vec2 uDrift;
varying vec3 vW, vN;
varying float vH, vD;
${NOISE}
float dome(vec2 p) {
  vec2 i = floor(p), f = fract(p); float best = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + 0.15 + 0.7 * h22(i + o) - f;
    best = min(best, dot(r, r));
  }
  return sqrt(max(0.0, 1.0 - best * 1.55));
}
float seaH(vec2 p) {
  vec2 q = p + uDrift;
  float h = dome(q * 0.026) * 11.0 + dome(q * 0.07 + 3.7) * 4.0 + dome(q * 0.18 + 9.1) * 1.4 + dome(q * 0.45 + 1.3) * 0.35;
  h += (vn(vec3(q * 0.009, 0.0)) - 0.5) * 9.0;
  return h;
}
void main() {
  vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
  float d = length(w.xz - cameraPosition.xz);
  float k = mix(0.25, 1.0, 1.0 - smoothstep(240.0, 620.0, d));
  float e = 0.7;
  float h = seaH(w.xz) * k;
  float hx = seaH(w.xz + vec2(e, 0.0)) * k;
  float hz = seaH(w.xz + vec2(0.0, e)) * k;
  vN = normalize(vec3(h - hx, e, h - hz));
  w.y += h;
  vW = w; vH = h; vD = d;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const seaFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uL, uSunV, uSunCol, uLit, uShade, uHaze;
varying vec3 vW, vN;
varying float vH, vD;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  float near = 1.0 - smoothstep(50.0, 200.0, vD);
  vec3 q = vW * 0.32 + vec3(0.0, uTime * 0.06, 0.0);
  float n0 = fbm(q);
  if (near > 0.01) {
    float nx = fbm(q + vec3(0.4, 0.0, 0.0)), nz = fbm(q + vec3(0.0, 0.0, 0.4));
    N = normalize(N + vec3(n0 - nx, 0.0, n0 - nz) * 1.6 * near);
  }
  vec3 V = normalize(cameraPosition - vW);
  float wrap = clamp((dot(N, uL) + 0.35) / 1.35, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float back = pow(clamp(dot(-V, uSunV) * 0.5 + 0.5, 0.0, 1.0), 7.0);
  float rim = pow(1.0 - ndv, 3.0);
  float ao = mix(0.45, 1.0, smoothstep(-4.0, 11.0, vH)) * (0.84 + 0.3 * n0);
  vec3 col = mix(uShade, uLit, wrap * wrap * (3.0 - 2.0 * wrap)) * ao;
  col += uSunCol * rim * (0.18 + 1.5 * back);
  col += uSunCol * back * 0.3 * smoothstep(0.0, 7.0, vH);
  vec3 vd = normalize(vW - cameraPosition);
  vec3 haze = mix(uHaze, uSunCol * 1.25 + uHaze * 0.4, pow(max(dot(vd, uSunV), 0.0), 10.0));
  float f = 1.0 - exp(-vD * 0.0026);
  col = mix(col, haze, clamp(f * f * 1.15, 0.0, 1.0));
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

// ------------------------------------------------------------------ mist layer above the sea

const mistVert = /* glsl */ `
varying vec3 vW; varying float vD;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vD = length(w.xz - cameraPosition.xz); gl_Position = projectionMatrix * viewMatrix * w; }`;
const mistFrag = /* glsl */ `
uniform float uTime; uniform vec3 uCol, uHaze, uSunCol, uSunV;
varying vec3 vW; varying float vD;
${NOISE}
void main() {
  float n = fbm(vec3(vW.xz * 0.028 + vec2(uTime * 0.012, uTime * 0.004), uTime * 0.01));
  float a = smoothstep(0.5, 0.82, n) * 0.14;
  a *= smoothstep(14.0, 45.0, vD);            // keep it off the island
  vec3 vd = normalize(vW - cameraPosition);
  vec3 c = mix(uCol, uHaze, smoothstep(60.0, 380.0, vD)) + uSunCol * pow(max(dot(vd, uSunV), 0.0), 6.0) * 0.6;
  a *= 1.0 - smoothstep(380.0, 700.0, vD);
  if (a < 0.004) discard;
  gl_FragColor = vec4(c, a);
}`;

// ------------------------------------------------------------------ billboard clouds (cumulus towers + wisps)

const bbVert = /* glsl */ `
attribute vec4 aI;   // xyz base (local), w height
attribute vec4 aJ;   // x seed, y aspect, z drift speed, w kind (0 cumulus, 1 wisp)
uniform float uTime;
varying vec2 vUv; varying vec4 vJ; varying vec3 vW; varying float vEdge;
void main() {
  vUv = uv; vJ = aJ;
  vec3 b = aI.xyz;
  vEdge = 1.0;
  if (aJ.z != 0.0) {
    b.x = mod(b.x + uTime * aJ.z + 140.0, 280.0) - 140.0;
    vEdge = 1.0 - smoothstep(100.0, 135.0, abs(b.x));
  }
  vec3 base = (modelMatrix * vec4(b, 1.0)).xyz;
  vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float h = aI.w, w = aI.w * aJ.y;
  vec3 wp = base + right * position.x * w + vec3(0.0, 1.0, 0.0) * (position.y + (aJ.w > 0.5 ? 0.0 : 0.5)) * h;
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const bbFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uSunV, uSunCol, uLit, uShade, uHaze;
varying vec2 vUv; varying vec4 vJ; varying vec3 vW; varying float vEdge;
${NOISE}
float hs(float x) { return fract(sin(x) * 43758.5453); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float s = vJ.x * 17.0;
  vec3 vd = normalize(vW - cameraPosition);
  float dist = length(vW - cameraPosition);
  float back = pow(max(dot(vd, uSunV), 0.0), 3.0);
  vec3 col; float a;
  if (vJ.w < 0.5) {
    float d = 0.0; float top = -1.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      vec2 c = vec2((hs(s + fk * 3.1) - 0.5) * 1.05, -0.38 + 0.36 * hs(s * 1.7 + fk * 1.9) + fk * 0.07);
      float r = 0.36 + 0.22 * hs(s * 2.3 + fk * 7.7);
      float dd = 1.0 - length((p - c) / vec2(r * 1.15, r));
      if (dd > d) { d = dd; top = c.y + r; }
    }
    float n = fbm(vec3(p * 2.4 + vec2(s, uTime * 0.015), uTime * 0.025 + s));
    d += (n - 0.5) * 0.6;
    d *= smoothstep(-0.98, -0.62, p.y + (n - 0.5) * 0.25);
    a = smoothstep(0.02, 0.16, d);
    float up = smoothstep(-0.7, 0.85, p.y);
    float side = dot(normalize(vec3(p.x, 0.0, 0.6)), normalize(vec3(-uSunV.x, 0.0, -uSunV.z)));
    col = mix(uShade, uLit, 0.25 + 0.6 * up + 0.2 * side) * (0.8 + 0.4 * n);
    float edge = 1.0 - smoothstep(0.02, 0.28, d);
    col += uSunCol * (edge * (0.25 + 2.2 * back) + back * 0.25);
  } else {
    float n = fbm(vec3(p.x * 1.3 + uTime * 0.03 + s, p.y * 3.5, s + uTime * 0.02));
    a = smoothstep(0.4, 0.78, n) * (1.0 - p.y * p.y) * (1.0 - pow(abs(p.x), 3.0)) * 0.3;
    col = mix(uLit, uHaze, 0.25) + uSunCol * back * 0.8;
  }
  float f = 1.0 - exp(-dist * 0.0026);
  col = mix(col, uHaze + uSunCol * back * 0.4, clamp(f * f * 1.15, 0.0, 1.0));
  a *= vEdge * (1.0 - smoothstep(520.0, 760.0, dist)) * smoothstep(1.0, 3.5, dist);
  if (a < 0.004) discard;
  gl_FragColor = vec4(max(col, vec3(0.0)), a);
}`;

// ------------------------------------------------------------------ sunburst god rays

const rayFrag = /* glsl */ `
uniform float uTime, uK; uniform vec3 uCol;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float st = fbm(vec3(cos(ang) * 4.0, sin(ang) * 4.0, uTime * 0.05)) ;
  float streak = pow(smoothstep(0.35, 0.85, st), 2.0) * (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.02, 0.12, r);
  float glow = exp(-r * r * 9.0) * 0.55 + exp(-r * r * 60.0) * 0.8;
  float a = (streak * 0.5 + glow) * uK;
  gl_FragColor = vec4(uCol * a, a);
}`;

// ------------------------------------------------------------------ light columns + beams (shared with the world ascend)

export const beamVert = /* glsl */ `
varying vec3 vN, vW; varying vec2 vUv;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
export const beamFrag = /* glsl */ `
uniform float uTime, uK, uLo, uHi; uniform vec3 uCol;
varying vec3 vN, vW; varying vec2 vUv;
${NOISE}
void main() {
  float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
  float core = pow(ndv, 2.2);
  float along = smoothstep(0.0, uLo, vUv.y) * smoothstep(1.0, uHi, vUv.y);
  float st = 0.55 + 0.45 * fbm(vec3(vUv.x * 9.0, vUv.y * 2.0 - uTime * 0.25, uTime * 0.05));
  float a = core * along * st * uK;
  gl_FragColor = vec4(uCol * a, a);
}`;

export function beamMaterial(color: THREE.ColorRepresentation, k = 1, lo = 0.35, hi = 0.55) {
  return new THREE.ShaderMaterial({
    vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uK: { value: k }, uLo: { value: lo }, uHi: { value: hi }, uCol: { value: new THREE.Color(color) } },
  });
}

// ------------------------------------------------------------------ twinkles

const twVert = /* glsl */ `
attribute vec4 aD; uniform float uTime, uK; varying float vA;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uTime * 0.12 * aD.z + 6.0, 20.0) - 6.0;
  p.x += sin(uTime * aD.x + aD.y) * 0.25; p.z += cos(uTime * aD.x * 0.7 + aD.y) * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  float tw = pow(0.5 + 0.5 * sin(uTime * aD.x * 2.6 + aD.y * 7.0), 5.0);
  vA = (0.15 + tw) * uK;
  gl_PointSize = (0.03 + 0.07 * tw) * aD.w * 520.0 / max(0.5, -mv.z);
}`;
const twFrag = /* glsl */ `
varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
  float c = exp(-r * r * 10.0) + (exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.5) + exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.5)) * 0.6;
  float a = c * vA * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.74) * a * 1.6, a);
}`;

// ------------------------------------------------------------------ petals & feathers (real photo cut-outs)

const flakeVert = /* glsl */ `
attribute vec4 aS;            // xyz 0..1 box position, w random
uniform float uTime, uBox, uSize, uFall, uCurl, uCells;
uniform vec3 uCam;
varying vec2 vUv; varying vec3 vN; varying float vA; varying vec3 vTint; varying vec3 vW;
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
void main() {
  float r = aS.w;
  float cell = floor(fract(r * 7.31) * uCells);
  float cols = uCells > 1.5 ? 6.0 : 1.0;
  float rows = uCells > 1.5 ? 4.0 : 1.0;
  vec2 cuv = vec2(mod(cell, cols), floor(cell / cols));
  vUv = vec2((cuv.x + uv.x) / cols, 1.0 - (cuv.y + 1.0 - uv.y) / rows);
  vec3 base = (aS.xyz - 0.5) * uBox;
  vec3 vel = vec3(sin(r * 13.0) * 0.35, -uFall * (0.7 + 0.6 * fract(r * 5.3)), cos(r * 9.0) * 0.35);
  float t = uTime;
  vec3 p = base + vel * t + vec3(sin(t * 0.7 + r * 6.0) * 0.7, sin(t * 1.1 + r * 3.0) * 0.12, cos(t * 0.55 + r * 4.0) * 0.7);
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec3 rel = (p - uCam) / (uBox * 0.5);
  vA = (1.0 - smoothstep(0.75, 1.0, max(max(abs(rel.x), abs(rel.y)), abs(rel.z)))) * smoothstep(0.35, 0.9, length(p - uCam));
  float a = t * (0.6 + fract(r * 3.7) * 0.9) + r * 20.0;
  mat3 R = ry(a * 0.7) * rx(sin(a) * 1.3) * rz(a * 0.31);
  vec3 lp = position * uSize * (0.75 + 0.5 * fract(r * 11.0));
  lp.z += (position.x * position.x) * uCurl * uSize;
  vec3 wp = p + R * lp;
  vN = R * vec3(0.0, 0.0, 1.0);
  float tk = fract(r * 2.9);
  vTint = tk < 0.45 ? vec3(1.0, 0.78, 0.86) : tk < 0.75 ? vec3(1.0, 0.86, 0.74) : vec3(1.0, 0.97, 0.95);
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(wp, 1.0);
}`;
const flakeFrag = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uL, uSunCol; uniform float uTintK;
varying vec2 vUv; varying vec3 vN; varying float vA; varying vec3 vTint; varying vec3 vW;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.05) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float lit = 0.62 + 0.38 * abs(dot(N, uL));
  float trans = pow(max(dot(-V, uL), 0.0), 3.0) * 0.8;
  vec3 c = t.rgb * mix(vec3(1.0), vTint, uTintK) * lit * 1.05 + uSunCol * trans * 0.6;
  gl_FragColor = vec4(c, a);
}`;

function flakes(n: number, map: THREE.Texture, o: { box: number; size: number; fall: number; curl: number; cells: number; tint: number; aspect?: number }) {
  const plane = new THREE.PlaneGeometry(o.aspect ?? 0.6, 1, 2, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  const s = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) s[i] = rand();
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  g.instanceCount = n;
  const m = new THREE.ShaderMaterial({
    vertexShader: flakeVert, fragmentShader: flakeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uBox: { value: o.box }, uSize: { value: o.size }, uFall: { value: o.fall }, uCurl: { value: o.curl }, uCells: { value: o.cells },
      uCam: { value: new THREE.Vector3() }, uMap: { value: map }, uL: { value: SUN_L.clone() }, uSunCol: { value: COL.sun.clone() }, uTintK: { value: o.tint },
    },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}

// ------------------------------------------------------------------ the environment

export class HeavenEnv {
  readonly group = new THREE.Group();
  private sky: THREE.Mesh;
  private sea: THREE.Mesh;
  private mist: THREE.Mesh;
  private clouds: THREE.Mesh;
  private rays: THREE.Mesh;
  private tw: THREE.Points;
  private petals: THREE.Mesh;
  private feathers: THREE.Mesh;
  readonly columns: THREE.Mesh;
  private mats: THREE.ShaderMaterial[] = [];
  private t = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;

  constructor(columnSpots: THREE.Vector3[]) {
    R = new RNG(20261025);
    const g = this.group;
    // sky
    const skyTex = Assets.texture(HV + 'sky_pastel_4k.jpg', { wrap: false });
    skyTex.wrapS = THREE.RepeatWrapping;
    skyTex.generateMipmaps = true;
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uSky: { value: skyTex }, uRot: { value: SKY_ROT }, uBright: { value: 0.82 },
        uSun: { value: SUN_VIS.clone() }, uSunCol: { value: COL.sun.clone() }, uHaze: { value: COL.haze.clone() }, uTint: { value: new THREE.Color(1.0, 0.9, 0.96) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    g.add(this.sky);
    // cloud sea
    const common = () => ({
      uTime: { value: 0 }, uL: { value: SUN_L.clone() }, uSunV: { value: SUN_VIS.clone() }, uSunCol: { value: COL.sun.clone() },
      uLit: { value: COL.lit.clone() }, uShade: { value: COL.shade.clone() }, uHaze: { value: COL.haze.clone() },
    });
    const seaMat = new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms: { ...common(), uDrift: { value: new THREE.Vector2() } } });
    this.sea = new THREE.Mesh(radialGrid(72, 168, 700), seaMat);
    this.sea.position.y = SEA_Y;
    this.sea.frustumCulled = false;
    g.add(this.sea);
    // mist
    const mistMat = new THREE.ShaderMaterial({
      vertexShader: mistVert, fragmentShader: mistFrag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(1.05, 0.96, 1.0) }, uHaze: { value: COL.haze.clone() }, uSunCol: { value: COL.sun.clone() }, uSunV: { value: SUN_VIS.clone() } },
    });
    this.mist = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), mistMat);
    this.mist.position.y = SEA_Y + 6.5;
    this.mist.renderOrder = 2;
    g.add(this.mist);
    // cumulus towers + wisps (one instanced draw)
    this.clouds = this.makeBillboards();
    g.add(this.clouds);
    // sunburst
    const rayMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: rayFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uK: { value: 0.32 }, uCol: { value: new THREE.Color(1.0, 0.72, 0.42) } },
    });
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rayMat);
    this.rays.scale.setScalar(900);
    this.rays.position.copy(SUN_VIS).multiplyScalar(1100);
    this.rays.renderOrder = -5;
    this.rays.frustumCulled = false;
    g.add(this.rays);
    // light columns over the clusters (merged, one draw)
    const cols: THREE.BufferGeometry[] = [];
    for (const p of columnSpots) {
      const c = new THREE.CylinderGeometry(1.15, 1.7, 16, 24, 1, true);
      c.translate(p.x, p.y + 8 - 1.6, p.z);
      cols.push(c);
    }
    const merged = mergeGeos(cols);
    const colMat = beamMaterial(0xffd9a0, 0.2);
    this.columns = new THREE.Mesh(merged, colMat);
    this.columns.renderOrder = 7;
    g.add(this.columns);
    // twinkles
    const n = 380;
    const pos = new Float32Array(n * 3), d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = 2.5 + Math.pow(rand(), 0.7) * 26;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = -6 + rand() * 20; pos[i * 3 + 2] = Math.sin(a) * r;
      d[i * 4] = 0.5 + rand() * 1.5; d[i * 4 + 1] = rand() * 10; d[i * 4 + 2] = 0.4 + rand(); d[i * 4 + 3] = 0.6 + rand() * 0.9;
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tg.setAttribute('aD', new THREE.BufferAttribute(d, 4));
    this.tw = new THREE.Points(tg, new THREE.ShaderMaterial({ vertexShader: twVert, fragmentShader: twFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uK: { value: 1 } } }));
    this.tw.frustumCulled = false;
    this.tw.renderOrder = 8;
    g.add(this.tw);
    // petals + feathers
    const petalTex = Assets.texture(HV + 'petals_atlas.png', { wrap: false });
    const featherTex = Assets.texture(HV + 'feather.png', { wrap: false });
    this.petals = flakes(150, petalTex, { box: 26, size: 0.075, fall: 0.32, curl: 1.4, cells: 24, tint: 1 });
    this.feathers = flakes(16, featherTex, { box: 30, size: 0.26, fall: 0.16, curl: 0.5, cells: 1, tint: 0.25, aspect: 1 });
    g.add(this.petals, this.feathers);
    // lights
    this.hemi = new THREE.HemisphereLight(0xffeef4, 0xa898d0, 0.5);
    this.sun = new THREE.DirectionalLight(0xffc68a, 2.0);
    this.sun.position.copy(SUN_L).multiplyScalar(30);
    this.fill = new THREE.DirectionalLight(0xffeee4, 0.8);
    this.fill.position.set(0.3, 0.6, 1).multiplyScalar(30);
    g.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    g.traverse((o: any) => { if (o.material?.isShaderMaterial) this.mats.push(o.material); });
  }

  private makeBillboards() {
    const items: { b: THREE.Vector3; h: number; seed: number; asp: number; drift: number; kind: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const a = awayFromSun(rand() * Math.PI * 2, 0.42), r = 70 + Math.pow(rand(), 0.8) * 420;
      items.push({ b: new THREE.Vector3(Math.cos(a) * r, SEA_Y + 1 + rand() * 3, Math.sin(a) * r), h: 26 + rand() * 60 * (r / 300 + 0.4), seed: rand(), asp: 1.2 + rand() * 0.8, drift: 0, kind: 0 });
    }
    // a few nearer, smaller puffs rising out of the sea below the clusters
    for (let i = 0; i < 9; i++) {
      const a = awayFromSun(rand() * Math.PI * 2, 0.6), r = 22 + rand() * 30;
      items.push({ b: new THREE.Vector3(Math.cos(a) * r, SEA_Y + 2, Math.sin(a) * r), h: 9 + rand() * 8, seed: rand(), asp: 1.3 + rand() * 0.6, drift: 0, kind: 0 });
    }
    for (let i = 0; i < 18; i++) {
      const a = rand() * Math.PI * 2, r = 9 + rand() * 60;
      items.push({ b: new THREE.Vector3(Math.cos(a) * r, -5 + rand() * 14, Math.sin(a) * r), h: 1.6 + rand() * 2.8, seed: rand(), asp: 4 + rand() * 4, drift: (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.5), kind: 1 });
    }
    items.sort((p, q) => q.b.length() - p.b.length());
    const n = items.length;
    const aI = new Float32Array(n * 4), aJ = new Float32Array(n * 4);
    items.forEach((it, i) => {
      aI.set([it.b.x, it.b.y, it.b.z, it.h], i * 4);
      aJ.set([it.seed, it.asp, it.drift, it.kind], i * 4);
    });
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    g.setAttribute('aI', new THREE.InstancedBufferAttribute(aI, 4));
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(aJ, 4));
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      vertexShader: bbVert, fragmentShader: bbFrag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSunV: { value: SUN_VIS.clone() }, uSunCol: { value: COL.sun.clone() }, uLit: { value: COL.lit.clone() }, uShade: { value: COL.shade.clone() }, uHaze: { value: COL.haze.clone() } },
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  }

  /** PMREM image lighting from the real HDRI (async; the scene works without it). */
  async loadEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (this.envRT) { scene.environment = this.envRT.texture; return; }
    try {
      const hdr = await Assets.hdr(HV + 'sky_pastel_1k.hdr');
      const pm = new THREE.PMREMGenerator(renderer);
      this.envRT = pm.fromEquirectangular(hdr);
      pm.dispose();
      hdr.dispose();
      scene.environment = this.envRT.texture;
      (scene as any).environmentIntensity = 0.6;
      (scene as any).environmentRotation?.set?.(0, -SKY_ROT, 0);
    } catch (e) { console.warn('[heaven] env map failed', e); }
  }

  private tmp = new THREE.Vector3();
  /** camLocal: camera position in heaven-local space */
  update(dt: number, camLocal: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    for (const m of this.mats) if (m.uniforms.uTime) m.uniforms.uTime.value = t;
    (this.sea.material as THREE.ShaderMaterial).uniforms.uDrift.value.set(t * 0.9, t * 0.35);
    this.sky.position.copy(camLocal);
    this.rays.position.copy(SUN_VIS).multiplyScalar(1100).add(camLocal);
    this.rays.lookAt(this.group.localToWorld(this.tmp.copy(camLocal)));
    (this.petals.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(camLocal);
    (this.feathers.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(camLocal);
  }

  dispose() {
    this.group.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    this.group.removeFromParent();
  }
}

/** minimal merge for same-attribute non-indexed/indexed geometries */
export function mergeGeos(list: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  let vtot = 0, itot = 0;
  for (const g of list) { vtot += g.attributes.position.count; itot += g.index ? g.index.count : g.attributes.position.count; }
  for (const n of names) {
    const sz = list[0].attributes[n].itemSize;
    const arr = new Float32Array(vtot * sz);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array as Float32Array, o); o += g.attributes[n].count * sz; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, sz));
  }
  const idx = new Uint32Array(itot);
  let io = 0, vo = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo; io += ia.length; }
    else { for (let i = 0; i < c; i++) idx[io + i] = i + vo; io += c; }
    vo += c;
    g.dispose();
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
