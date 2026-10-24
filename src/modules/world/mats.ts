import * as THREE from 'three';
import { Assets } from '../../core/assets';
import type { LayerInfo } from './geo';

/**
 * WORLD MATERIALS
 *
 * All opaque static world surfaces share ONE MeshStandardMaterial that samples two
 * DataArrayTextures (albedo, and normal.xy+roughness+AO), the layer index comes per vertex.
 * That lets the map use ~60 photo/PBR materials while each 40 m chunk is a single draw call.
 * Extra per-vertex data drives a procedural grime overlay (2nd layer blended by a world-space
 * noise wear mask), baked AO/dirt, and night emissive (palette index + strength).
 */

export interface LayerDef {
  name: string;
  /** candidate sources, first available wins: 'w:<base>' = textures/world/<base>_*.jpg, 'p:<id>' = PBR library */
  src: string[];
  /** metres per texture repeat [u, v] (overrides manifest) */
  tile?: number | [number, number];
  /** roughness multiplier */
  rough?: number;
  /** force metalness (else measured from the ORM blue channel) */
  metal?: number;
  /** fallback flat colour */
  color?: number;
}

/** The layer table. Order = array index. */
export const LAYERS: LayerDef[] = [
  { name: 'none', src: [], color: 0x8a8580, tile: 2 },
  // ---------------------------------------------------------------- ground
  { name: 'asphalt_main', src: ['w:asphalt_main_worn', 'p:asphalt_road_sunbleached'], tile: 4 },
  { name: 'asphalt_soi', src: ['w:asphalt_soi_patched', 'p:asphalt_patched'], tile: 5 },
  { name: 'asphalt_cracked', src: ['p:asphalt_cracked'], tile: 3 },
  { name: 'asphalt_patched', src: ['p:asphalt_patched'], tile: 5 },
  { name: 'concrete_road', src: ['p:concrete_soi_road'], tile: 2.5 },
  { name: 'footpath', src: ['w:concrete_slab_footpath', 'p:concrete_old_cracked'], tile: 2.4 },
  { name: 'tile_chain', src: ['w:sidewalk_tile_chain_grey', 'p:sidewalk_pavers_square'], tile: 1.2 },
  { name: 'tile_circles', src: ['w:sidewalk_tile_circles_grey', 'p:sidewalk_pavers_square'], tile: 1.2 },
  { name: 'tile_redband', src: ['w:sidewalk_tile_grid_grey_redband', 'p:sidewalk_pavers_square'], tile: 2.4 },
  { name: 'tile_redhex', src: ['w:sidewalk_tile_red_hex', 'p:sidewalk_pavers_interlocking'], tile: 1.2 },
  { name: 'pavers_inter', src: ['w:paver_interlock_I', 'p:sidewalk_pavers_interlocking'], tile: 1.6 },
  { name: 'pavers_square', src: ['p:sidewalk_pavers_square'], tile: 2 },
  { name: 'tactile', src: ['w:tactile_strip_yellow', 'p:sidewalk_tactile_yellow'], tile: [0.3, 0.6] },
  { name: 'concrete_old', src: ['p:concrete_old_cracked'], tile: 2 },
  { name: 'concrete_wet', src: ['p:concrete_wet_puddles'], tile: 1.9, rough: 1.6 },
  { name: 'curb', src: ['w:curb_bare_concrete', 'p:concrete_old_cracked'], tile: [3, 0.36] },
  { name: 'curb_rw', src: ['w:curb_red_white'], tile: [3, 0.36], color: 0xb04030 },
  { name: 'curb_yb', src: ['w:curb_yellow_black'], tile: [3, 0.36], color: 0xc8a020 },
  { name: 'curb_wy', src: ['w:curb_white_yellow'], tile: [3, 0.36], color: 0xd0c070 },
  { name: 'dirt', src: ['p:dirt_path_dry'], tile: 2.1 },
  { name: 'laterite', src: ['p:laterite_red_dirt'], tile: 2 },
  { name: 'mud', src: ['p:mud_wet_rural'], tile: 1.3 },
  { name: 'grass_dry', src: ['p:grass_dry'], tile: 2 },
  { name: 'grass', src: ['p:grass_lush'], tile: 1.4 },
  { name: 'gravel', src: ['p:gravel_crushed'], tile: 2 },
  { name: 'leaves', src: ['p:leaf_litter_dry'], tile: 2 },
  { name: 'terrazzo', src: ['p:terrazzo_floor'], tile: 1.2 },
  { name: 'tiles_floor', src: ['p:tiles_floor_ceramic'], tile: 1.5 },
  { name: 'tiles_terracotta', src: ['p:tiles_floor_terracotta'], tile: 2.08 },
  { name: 'grate', src: ['w:trench_grate_steel', 'p:galvanized_steel'], tile: [1, 0.3125] },
  { name: 'drain_cover', src: ['w:drain_cover_concrete_holes', 'p:concrete_old_cracked'], tile: 0.6 },
  // ---------------------------------------------------------------- walls
  { name: 'plaster', src: ['p:plaster_painted_clean'], tile: 2 },
  { name: 'plaster_dirty', src: ['p:plaster_painted_dirty'], tile: 1.6 },
  { name: 'plaster_moldy', src: ['p:plaster_moldy_stained'], tile: 3 },
  { name: 'plaster_peeling', src: ['p:plaster_peeling'], tile: 1.8 },
  { name: 'plaster_red', src: ['p:plaster_peeling_red'], tile: 1.8 },
  { name: 'plaster_brick', src: ['p:plaster_broken_brick'], tile: 2 },
  { name: 'concrete_streaked', src: ['p:concrete_streaked'], tile: 3 },
  { name: 'concrete_mossy', src: ['p:concrete_mossy'], tile: 1.8 },
  { name: 'cement_block', src: ['p:cement_block_wall'], tile: 2 },
  { name: 'brick', src: ['p:brick_exposed_red'], tile: 1.5 },
  { name: 'tiles_wall', src: ['p:tiles_wall_white_dirty'], tile: 1 },
  { name: 'temple_wall', src: ['p:temple_white_wall'], tile: 2 },
  { name: 'marble', src: ['p:marble_white'], tile: 1.5 },
  // ---------------------------------------------------------------- metal
  { name: 'shutter', src: ['p:shutter_roller_painted'], tile: 2 },
  { name: 'shutter_rust', src: ['p:shutter_roller_rusty'], tile: 1.9 },
  { name: 'corr_rust', src: ['p:corrugated_rusty'], tile: 2 },
  { name: 'corr_paint', src: ['p:corrugated_painted'], tile: 2 },
  { name: 'roof_galv', src: ['p:roof_corrugated_galvanized'], tile: 1.12 },
  { name: 'roof_fibre', src: ['p:roof_fibrecement_corrugated'], tile: 2 },
  { name: 'roof_slab', src: ['p:roof_concrete_slab'], tile: 5 },
  { name: 'roof_tiles', src: ['p:roof_clay_tiles'], tile: 2.6 },
  { name: 'metal_paint', src: ['p:metal_painted_chipped'], tile: 1 },
  { name: 'steel_rust', src: ['p:steel_rusty'], tile: 1 },
  { name: 'galv', src: ['p:galvanized_steel'], tile: 1 },
  { name: 'stainless', src: ['p:stainless_brushed'], tile: 0.6 },
  { name: 'stainless_dirty', src: ['p:stainless_dented_greasy'], tile: 0.5 },
  { name: 'alu', src: ['p:aluminium_scratched'], tile: 0.5 },
  { name: 'chrome', src: ['p:chrome'], tile: 0.5 },
  { name: 'brass', src: ['p:brass_gold'], tile: 0.5 },
  // ---------------------------------------------------------------- wood & misc
  { name: 'wood_old', src: ['p:wood_planks_old'], tile: 2 },
  { name: 'wood_paint', src: ['p:wood_painted_weathered'], tile: 1.6 },
  { name: 'plywood', src: ['p:plywood'], tile: 0.5 },
  { name: 'teak', src: ['p:wood_teak'], tile: 2 },
  { name: 'bamboo', src: ['p:bamboo_poles'], tile: 2 },
  { name: 'bamboo_woven', src: ['p:bamboo_woven'], tile: 1.85 },
  { name: 'tarp', src: ['p:canvas_tarp'], tile: 0.8 },
  { name: 'plastic', src: ['p:plastic_rough'], tile: 0.5 },
  { name: 'plastic_gloss', src: ['p:plastic_glossy'], tile: 0.5 },
  { name: 'rubber', src: ['p:rubber_black'], tile: 0.75 },
  { name: 'leather', src: ['p:leather_black'], tile: 0.5 },
  { name: 'cardboard', src: ['p:cardboard_worn'], tile: 0.6 },
  { name: 'fabric', src: ['p:cotton_jersey'], tile: 0.5 },
  { name: 'denim', src: ['p:denim'], tile: 0.5 },
  { name: 'glass', src: ['p:glass_dirty'], tile: 1, rough: 1, metal: 0 },
  { name: 'paper', src: ['p:paper_creased'], tile: 0.4 },
];

export const LAYER_INDEX = new Map<string, number>(LAYERS.map((l, i) => [l.name, i]));

/** Emissive palette (index 1..15). [colour (linear), daytime fraction] */
export const EMIS: Record<string, { i: number; c: number; day: number }> = {
  warm: { i: 1, c: 0xffc98a, day: 0 },       // incandescent / warm window
  cool: { i: 2, c: 0xdff4ff, day: 0 },       // fluorescent tube
  sodium: { i: 3, c: 0xffa040, day: 0 },     // street lamp
  tv: { i: 4, c: 0x9fc8ff, day: 0 },         // TV-lit window
  red: { i: 5, c: 0xff3030, day: 0 },        // neon red
  green: { i: 6, c: 0x40ff70, day: 0 },
  blue: { i: 7, c: 0x4080ff, day: 0 },
  store: { i: 8, c: 0xf4fbff, day: 0.85 },   // convenience store, always on
  amber: { i: 9, c: 0xffb000, day: 0.25 },   // indicator / blinking
  pink: { i: 10, c: 0xff60c0, day: 0 },
  white: { i: 11, c: 0xffffff, day: 0 },
  shopwarm: { i: 12, c: 0xffe2b0, day: 0.55 }, // shop interior tubes during the day
  coolday: { i: 13, c: 0xe6f6ff, day: 0.6 },  // market tubes (on in the morning)
  candle: { i: 14, c: 0xff8a30, day: 0.3 },   // spirit house / shrine
  traffic: { i: 15, c: 0xff4020, day: 1.0 },  // traffic lights
};

export interface WorldTex { alb: THREE.DataArrayTexture; nra: THREE.DataArrayTexture; metal: Float32Array; rough: Float32Array; tiles: [number, number][]; size: number }

/** shared uniforms for every world material */
export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWet: { value: 0 },
  uWind: { value: new THREE.Vector3(1, 0, 0.4) },
  uEmisCol: { value: Array.from({ length: 16 }, () => new THREE.Color(0, 0, 0)) },
  uEmisDay: { value: new Float32Array(16) },
  uEmisScale: { value: 6.0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
};
for (const k in EMIS) {
  const e = EMIS[k];
  U.uEmisCol.value[e.i].set(e.c);
  U.uEmisDay.value[e.i] = e.day;
}

// ------------------------------------------------------------------ loading

async function headOk(url: string) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok && !(r.headers.get('content-type') || '').includes('text/html'); } catch { return false; }
}

async function loadBitmap(url: string, size: number): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) return null;
    const blob = await r.blob();
    try {
      return await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as any);
    } catch {
      return await createImageBitmap(blob);
    }
  } catch { return null; }
}

let canvas2d: { cv: HTMLCanvasElement | OffscreenCanvas; ctx: any } | null = null;
function pixels(bmp: ImageBitmap, size: number): Uint8ClampedArray {
  if (!canvas2d || canvas2d.cv.width !== size) {
    const cv: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    canvas2d = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
  }
  const ctx = canvas2d.ctx;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

export interface WorldManifest { [k: string]: any }

/**
 * Load all layers into two texture arrays. `size` 256 (low) / 512.
 */
export async function loadWorldTextures(size: number, worldManifest: WorldManifest | null): Promise<WorldTex> {
  const N = LAYERS.length;
  const alb = new Uint8Array(size * size * 4 * N);
  const nra = new Uint8Array(size * size * 4 * N);
  const metal = new Float32Array(64);
  const rough = new Float32Array(64).fill(1);
  const tiles: [number, number][] = [];
  const pbr = Assets.pbrManifest;
  const worldFiles = new Set<string>(worldManifest ? Object.keys(worldManifest) : []);
  // pre-baked 512² layers (src/modules/world/tools/bake_layers.py) — much faster to decode
  const baked = (await Assets.jsonSafe<any>('gen/world/layers/layers.json', null))?.layers ?? {};

  // resolve sources
  type Res = { albedo?: string; normal?: string; orm?: string; tile?: [number, number] };
  const resolved: Res[] = await Promise.all(LAYERS.map(async (L): Promise<Res> => {
    const b = baked[L.name];
    if (b?.albedo && L.src.includes(b.src)) return { albedo: b.albedo, normal: b.normal, orm: b.orm, tile: b.tile ? [b.tile, b.tile] : undefined };
    for (const s of L.src) {
      if (s.startsWith('w:')) {
        const base = s.slice(2);
        const albedo = `textures/world/${base}_albedo.jpg`;
        const known = worldFiles.has(base);
        if (known || (await headOk(Assets.url(albedo)))) {
          const m = worldManifest?.[base];
          let tile: [number, number] | undefined;
          if (m?.real_world_m && Array.isArray(m.real_world_m)) tile = [m.real_world_m[0], m.real_world_m[1]];
          else if (m?.tileMeters) tile = [m.tileMeters, m.tileMeters];
          return { albedo, normal: `textures/world/${base}_normal.jpg`, orm: `textures/world/${base}_orm.jpg`, tile };
        }
      } else if (s.startsWith('p:')) {
        const id = s.slice(2);
        const e = pbr[id];
        if (!e) continue;
        const p = (f: string) => (f.startsWith('textures') ? f : f.includes('/') ? 'textures/pbr/' + f : `textures/pbr/${id}/${f}`);
        return { albedo: p(e.albedo), normal: e.normal ? p(e.normal) : undefined, orm: e.orm ? p(e.orm) : undefined, tile: e.tileMeters ? [e.tileMeters, e.tileMeters] : undefined };
      }
    }
    return {};
  }));

  const S2 = size * size;
  const flipCopy = (src: Uint8ClampedArray, dst: Uint8Array, layer: number, fn?: (si: number, di: number) => void) => {
    const base = layer * S2 * 4;
    for (let y = 0; y < size; y++) {
      const sy = (size - 1 - y) * size * 4, dy = base + y * size * 4;
      if (!fn) dst.set(src.subarray(sy, sy + size * 4), dy);
      else for (let x = 0; x < size * 4; x += 4) fn(sy + x, dy + x);
    }
  };

  await Promise.all(LAYERS.map(async (L, i) => {
    const r = resolved[i];
    const t = L.tile !== undefined ? (Array.isArray(L.tile) ? L.tile : [L.tile, L.tile]) : (r.tile ?? [2, 2]);
    // manifest real-world sizes win for world textures, explicit table values otherwise
    tiles[i] = (r.tile && L.src[0]?.startsWith('w:') && r.albedo?.includes('textures/world')) ? r.tile : (t as [number, number]);
    rough[i] = L.rough ?? 1;
    const [ba, bn, bo] = await Promise.all([
      r.albedo ? loadBitmap(Assets.url(r.albedo), size) : null,
      r.normal ? loadBitmap(Assets.url(r.normal), size) : null,
      r.orm ? loadBitmap(Assets.url(r.orm), size) : null,
    ]);
    // albedo
    if (ba) {
      const px = pixels(ba, size);
      flipCopy(px, alb, i);
      ba.close?.();
    } else {
      const c = new THREE.Color(L.color ?? 0x8a8580);
      const base = i * S2 * 4;
      for (let k = 0; k < S2; k++) {
        const n = 0.9 + 0.1 * Math.sin(k * 0.37) * Math.sin(k * 0.0123);
        alb[base + k * 4] = Math.min(255, c.r * 255 * n); alb[base + k * 4 + 1] = Math.min(255, c.g * 255 * n); alb[base + k * 4 + 2] = Math.min(255, c.b * 255 * n); alb[base + k * 4 + 3] = 255;
      }
    }
    // normal xy + roughness + ao
    const base = i * S2 * 4;
    let npx: Uint8ClampedArray | null = null, opx: Uint8ClampedArray | null = null;
    if (bn) { npx = pixels(bn, size).slice(); bn.close?.(); }
    if (bo) { opx = pixels(bo, size).slice(); bo.close?.(); }
    let msum = 0;
    for (let y = 0; y < size; y++) {
      const sy = (size - 1 - y) * size * 4, dy = base + y * size * 4;
      for (let x = 0; x < size * 4; x += 4) {
        const s = sy + x, d = dy + x;
        nra[d] = npx ? npx[s] : 128;
        nra[d + 1] = npx ? npx[s + 1] : 128;
        nra[d + 2] = opx ? opx[s + 1] : 200;
        nra[d + 3] = opx ? opx[s] : 255;
        if (opx) msum += opx[s + 2];
      }
    }
    metal[i] = L.metal ?? (opx ? Math.min(1, msum / S2 / 255) : 0);
    if (metal[i] < 0.08) metal[i] = 0;
  }));

  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, size, size, N);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Assets.maxAnisotropy;
    t.needsUpdate = true;
    return t;
  };
  return { alb: mk(alb, true), nra: mk(nra, false), metal, rough, tiles, size };
}

/** lookup for the geometry builder */
export function layerLookup(tex: WorldTex | null): (name: string) => LayerInfo {
  return (name: string) => {
    const i = LAYER_INDEX.get(name);
    if (i === undefined) { console.warn('[world] unknown layer', name); return { index: 0, tile: 2 }; }
    const t = tex?.tiles[i] ?? [2, 2];
    return { index: i, tile: t[0], tileV: t[1] } as any;
  };
}

// ------------------------------------------------------------------ shader snippets

export const NOISE_GLSL = /* glsl */`
float wHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash13(i), wHash13(i + vec3(1,0,0)), f.x), mix(wHash13(i + vec3(0,1,0)), wHash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wHash13(i + vec3(0,0,1)), wHash13(i + vec3(1,0,1)), f.x), mix(wHash13(i + vec3(0,1,1)), wHash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float wFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * wNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

const TANGENT_GLSL = /* glsl */`
vec3 wPerturb(vec3 eye_pos, vec3 N, vec2 uv, vec3 mapN, float faceDir) {
  vec3 q0 = dFdx(eye_pos); vec3 q1 = dFdy(eye_pos);
  vec2 st0 = dFdx(uv); vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N); vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = (det == 0.0) ? 0.0 : faceDir * inversesqrt(det);
  return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + N * mapN.z);
}
`;

/** vertex injection shared by world/cut materials */
function injectWorldVertex(shader: any) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec4 aExtra;
varying vec2 vUvT;
varying vec4 vExt;
varying vec3 vWPos;
varying vec3 vWNrm;`)
    .replace('#include <fog_vertex>', `#include <fog_vertex>
vUvT = uv;
vExt = aExtra;
vec4 wPos4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wPos4 = instanceMatrix * wPos4;
#endif
wPos4 = modelMatrix * wPos4;
vWPos = wPos4.xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
}

/**
 * The world PBR material (texture arrays). cutout=true → alpha tested (albedo.a) variant.
 */
export function makeWorldMaterial(tex: WorldTex, cutout = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true, side: cutout ? THREE.DoubleSide : THREE.FrontSide });
  m.name = cutout ? 'world-cut' : 'world';
  const uniforms = {
    uAlb: { value: tex.alb }, uNra: { value: tex.nra },
    uMetal: { value: tex.metal }, uRoughL: { value: tex.rough },
    uNormalScale: { value: 1.0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, U);
    injectWorldVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2DArray uAlb;
uniform sampler2DArray uNra;
uniform float uMetal[64];
uniform float uRoughL[64];
uniform float uNormalScale;
uniform vec3 uEmisCol[16];
uniform float uEmisDay[16];
uniform float uEmisScale;
uniform float uNight;
uniform float uWet;
uniform float uTime;
varying vec2 vUvT;
varying vec4 vExt;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE_GLSL}
${TANGENT_GLSL}`)
      .replace('#include <map_fragment>', `
float wL0 = floor(vExt.x + 0.5);
vec4 albT = texture(uAlb, vec3(vUvT, wL0));
vec4 nraT = texture(uNra, vec3(vUvT, wL0));
${cutout ? 'if (albT.a < 0.5) discard;' : ''}
vec3 baseCol = albT.rgb * vColor.rgb;
float ovA = 0.0;
float wL1 = floor(vExt.y + 0.5);
if (vExt.z > 0.001) {
  vec3 wp = vWPos;
  float blot = wFbm(wp * vec3(0.42, 0.16, 0.42) + vec3(3.1, 0.0, 7.7));
  float streak = wNoise(vec3((wp.x + wp.z) * 2.6, wp.y * 0.18, 1.3)) * wNoise(vec3((wp.x - wp.z) * 0.9, wp.y * 0.05, 4.1));
  float bottom = 1.0 - smoothstep(0.0, 1.7, wp.y - 0.1);
  float m = blot * 1.15 + streak * 0.55 + bottom * 0.55 - 0.42;
  ovA = smoothstep(0.18, 0.62, m) * vExt.z;
  vec2 ouv = vUvT * 0.71 + vec2(0.37, 0.11);
  vec4 albO = texture(uAlb, vec3(ouv, wL1));
  vec4 nraO = texture(uNra, vec3(ouv, wL1));
  baseCol = mix(baseCol, albO.rgb * mix(vec3(1.0), vColor.rgb, 0.25), ovA);
  nraT = mix(nraT, nraO, ovA);
}
// wet surfaces (rain) — darker and glossier on upward faces
float wetK = uWet * smoothstep(0.55, 0.95, vWNrm.y);
baseCol *= mix(1.0, 0.62, wetK);
diffuseColor.rgb *= baseCol * (0.52 + 0.48 * vColor.a);
`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = clamp(roughness * nraT.b * uRoughL[int(wL0)] * mix(1.0, 0.25, wetK), 0.03, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `
float metalnessFactor = metalness * mix(uMetal[int(wL0)], uMetal[int(wL1)], ovA);`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 mapN = vec3(nraT.xy * 2.0 - 1.0, 0.0);
  mapN.xy *= uNormalScale * (1.0 - wetK * 0.7);
  mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
  normal = wPerturb(-vViewPosition, normal, vUvT, mapN, faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vExt.w > 0.5) {
  int pi = int(floor(vExt.w));
  float ek = fract(vExt.w);
  totalEmissiveRadiance += uEmisCol[pi] * ek * mix(uEmisDay[pi], 1.0, uNight) * uEmisScale;
}`)
      .replace('#include <aomap_fragment>', `
{
  float ambientOcclusion = vColor.a * mix(1.0, nraT.a, 0.9);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}`);
  };
  m.customProgramCacheKey = () => (cutout ? 'world-cut-v1' : 'world-v1');
  return m;
}

/** Depth material for alpha-tested world geometry (shadows of grilles/fences). */
export function makeWorldCutDepth(tex: WorldTex) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAlb = { value: tex.alb };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aExtra; varying vec2 vUvT; varying float vL;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vUvT = uv; vL = aExtra.x;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2DArray uAlb; varying vec2 vUvT; varying float vL;`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (texture(uAlb, vec3(vUvT, floor(vL + 0.5))).a < 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'world-cut-depth-v1';
  return m;
}

/** Sign material: atlas map; light boxes glow at night (vertex extra.x = glow 0..1). */
export function makeSignMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.55, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 1 });
  m.name = 'world-sign';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aExtra; varying vec4 vExt;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vExt = aExtra;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNight; uniform float uTime; varying vec4 vExt;`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vColor.rgb * (0.55 + 0.45 * vColor.a);`)
      .replace('#include <emissivemap_fragment>', `
{
  vec3 sc = diffuseColor.rgb;
  float flick = 1.0 - step(0.985, fract(sin(floor(uTime * 9.0) + vExt.y * 91.7) * 43758.5)) * step(0.5, vExt.z);
  totalEmissiveRadiance = sc * vExt.x * (uNight * 2.2 + vExt.w) * flick;
}`);
  };
  m.customProgramCacheKey = () => 'world-sign-v1';
  return m;
}

/** Decal material (alpha blended atlas). extra.x = wet (puddle mirror), extra.y = roughness override. */
export function makeDecalMaterial(atlas: THREE.Texture, normalAtlas?: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  if (normalAtlas) m.normalMap = normalAtlas;
  m.name = 'world-decal';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aExtra; varying vec4 vExt;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vExt = aExtra;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uWet; varying vec4 vExt;`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vColor.rgb; diffuseColor.a *= vColor.a;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(vExt.y > 0.0 ? vExt.y : roughness, 0.04, clamp(vExt.x, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'world-decal-v1';
  return m;
}

/** Foliage (alpha-tested atlas cards with wind sway). extra.x = wind weight, y = phase, z = flutter. */
export const FOLIAGE_WIND_GLSL = /* glsl */`
vec3 folWind(vec3 wp, vec4 ex, float t, vec3 wind) {
  float w = ex.x;
  if (w <= 0.0) return vec3(0.0);
  float ph = ex.y * 6.2831 + dot(wp.xz, vec2(0.21, 0.17));
  float gust = 0.6 + 0.4 * sin(t * 0.37 + wp.x * 0.05) * sin(t * 0.23 + wp.z * 0.04);
  float sway = sin(t * 1.3 + ph) * 0.6 + sin(t * 2.1 + ph * 1.7) * 0.25;
  float flutter = sin(t * 7.0 + ph * 5.3 + wp.y * 3.0) * ex.z;
  vec3 d = wind * (sway * gust) * w * 0.12;
  d.y += flutter * w * 0.03;
  d.xz += vec2(flutter, -flutter) * w * 0.025;
  return d;
}
`;

export function makeFoliageMaterial(atlas: THREE.Texture): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
  m.name = 'world-foliage';
  const vtx = (shader: any) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aExtra;
uniform float uTime; uniform vec3 uWind;
${FOLIAGE_WIND_GLSL}`).replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
  transformed += folWind(wp0.xyz, aExtra, uTime, uWind);
}`);
  };
  m.onBeforeCompile = (shader) => {
    vtx(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vColor.rgb; float folAO = vColor.a;`)
      .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= folAO; reflectedLight.directDiffuse *= mix(0.6, 1.0, folAO);
// fake translucency: leaves lit from behind glow a little
reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.08 * folAO;`);
  };
  m.customProgramCacheKey = () => 'world-fol-v1';
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });
  d.onBeforeCompile = (shader) => { vtx(shader); };
  d.customProgramCacheKey = () => 'world-fol-depth-v1';
  return { mat: m, depth: d };
}

/** Transparent storefront glass: vertex colour = tint, vertex alpha = opacity; strong env reflections. */
export function makeGlassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, transparent: true, roughness: 0.06, metalness: 0.0, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 });
  m.name = 'world-glass';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `diffuseColor.rgb *= vColor.rgb; diffuseColor.a = vColor.a;`)
      .replace('#include <opaque_fragment>', `
      // fresnel: glass gets more opaque/reflective at grazing angles
      float fres = pow(1.0 - saturate(dot(normalize(vViewPosition), normal * (gl_FrontFacing ? 1.0 : -1.0))), 3.0);
      diffuseColor.a = clamp(diffuseColor.a + fres * 0.55, 0.0, 0.92);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'world-glass-v1';
  return m;
}
