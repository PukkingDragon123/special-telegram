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
  /** puddles collect on this (flat, outdoors) 0..1 — default from the name */
  pud?: number;
  /** rising damp / moss / algae at the foot of walls 0..1 — default from the name */
  moss?: number;
}

/** default puddle / weathering response per layer name */
function layerPud(L: LayerDef) {
  if (L.pud !== undefined) return L.pud;
  const n = L.name;
  if (n.startsWith('asphalt')) return 1;
  if (n === 'concrete_road' || n === 'concrete_wet' || n === 'mud') return 1;
  if (n === 'concrete_old' || n === 'footpath' || n === 'laterite' || n === 'roof_slab') return 0.75;
  if (n.startsWith('tile_') || n.startsWith('pavers') || n === 'tiles_terracotta' || n === 'dirt') return 0.55;
  if (n === 'gravel' || n === 'tactile' || n === 'grate' || n === 'drain_cover') return 0.35;
  return 0;
}
function layerMoss(L: LayerDef) {
  if (L.moss !== undefined) return L.moss;
  const n = L.name;
  if (n.startsWith('plaster') || n.startsWith('wall_') || n.startsWith('concrete') || n === 'cement_block' || n === 'temple_wall') return 1;
  if (n === 'brick' || n === 'curb' || n.startsWith('curb_')) return 0.7;
  if (n === 'tiles_wall' || n === 'marble' || n === 'footpath') return 0.35;
  return 0;
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
  { name: 'concrete_streaked', src: ['w:wall_concrete_black_streaks', 'p:concrete_streaked'], tile: 2 },
  { name: 'concrete_mossy', src: ['p:concrete_mossy'], tile: 1.8 },
  { name: 'cement_block', src: ['p:cement_block_wall'], tile: 2 },
  { name: 'brick', src: ['p:brick_exposed_red'], tile: 1.5 },
  { name: 'tiles_wall', src: ['p:tiles_wall_white_dirty'], tile: 1 },
  { name: 'temple_wall', src: ['p:temple_white_wall'], tile: 2 },
  { name: 'marble', src: ['p:marble_white'], tile: 1.5 },
  // real-photo walls (streets research agent, textures/world) — used untinted
  { name: 'wall_peel_teal', src: ['w:wall_peeling_paint_teal', 'p:plaster_peeling'], tile: 1.5 },
  { name: 'wall_peel_orange', src: ['w:wall_peeling_paint_orange', 'p:plaster_peeling_red'], tile: 1.5 },
  { name: 'wall_peel_cream', src: ['w:wall_peeling_paint_red_over_cream', 'p:plaster_peeling'], tile: 1.2 },
  { name: 'wall_mould', src: ['w:wall_concrete_mould_stained', 'p:plaster_moldy_stained'], tile: 2 },
  // ---------------------------------------------------------------- metal
  { name: 'shutter', src: ['p:shutter_roller_painted'], tile: 2 },
  { name: 'shutter_rust', src: ['w:shutter_slats_rusty_scan', 'p:shutter_roller_rusty'], tile: 2 },
  // whole-bay photos (uv 0..1 on one quad)
  { name: 'shutter_bay_white', src: ['w:shutter_closed_rusty_white', 'p:shutter_roller_rusty'], tile: 1 },
  { name: 'shutter_bay_graffiti', src: ['w:shutter_closed_graffiti', 'p:shutter_roller_painted'], tile: 1 },
  { name: 'ac_front_a', src: ['w:ac_outdoor_unit_front_a', 'p:metal_painted_chipped'], tile: 1 },
  { name: 'ac_front_b', src: ['w:ac_outdoor_unit_front_b', 'p:metal_painted_chipped'], tile: 1 },
  { name: 'win_wood_shutters', src: ['w:window_wood_shutters_old', 'p:wood_painted_weathered'], tile: 1 },
  { name: 'corr_rust', src: ['w:corrugated_zinc_rusty', 'p:corrugated_rusty'], tile: 1.5 },
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
  { name: 'tarp_blue', src: ['w:tarp_blue_photo', 'p:canvas_tarp'], tile: 1.5, color: 0x2a5ab0 },
  { name: 'awning_ry', src: ['w:awning_stripes_red_yellow_photo', 'p:canvas_tarp'], tile: 1.5 },
  { name: 'awning_gw', src: ['w:awning_stripes_green_white_photo', 'p:canvas_tarp'], tile: 1.5 },
  { name: 'awning_rp', src: ['w:awning_stripes_red_pink_photo', 'p:canvas_tarp'], tile: 1.5 },
  { name: 'plastic', src: ['p:plastic_rough'], tile: 0.5 },
  { name: 'plastic_gloss', src: ['p:plastic_glossy'], tile: 0.5 },
  { name: 'rubber', src: ['p:rubber_black'], tile: 0.75 },
  { name: 'leather', src: ['p:leather_black'], tile: 0.5 },
  { name: 'cardboard', src: ['p:cardboard_worn'], tile: 0.6 },
  { name: 'fabric', src: ['p:cotton_jersey'], tile: 0.5 },
  { name: 'denim', src: ['p:denim'], tile: 0.5 },
  { name: 'glass', src: ['p:glass_dirty'], tile: 1, rough: 1, metal: 0 },
  { name: 'paper', src: ['p:paper_creased'], tile: 0.4 },
  // ---------------------------------------------------------------- buildings agent extras (tools/bake_arch.py, real photos)
  { name: 'drain_round', src: ['g:drain_round'], tile: 1, metal: 0.6, pud: 0 },
  { name: 'drain_square', src: ['g:drain_square'], tile: 1, metal: 0.55, pud: 0 },
  { name: 'drain_slots', src: ['g:drain_slots'], tile: 1, metal: 0.5, pud: 0 },
  { name: 'grate_iron', src: ['g:grate_iron'], tile: 0.6, metal: 0.5, pud: 0 },
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

export interface WorldTex { alb: THREE.DataArrayTexture; nra: THREE.DataArrayTexture; metal: Float32Array; rough: Float32Array; tiles: [number, number][]; size: number; pud: Float32Array; moss: Float32Array }

/** shared uniforms for every world material */
export const U = {
  uTime: { value: 0 },
  /** world-space radius per metre of distance that makes a cable ~1 px wide (set per frame) */
  uWirePx: { value: 0.0006 },
  uNight: { value: 0 },
  uWet: { value: 0 },
  uWind: { value: new THREE.Vector3(1, 0, 0.4) },
  uEmisCol: { value: Array.from({ length: 16 }, () => new THREE.Color(0, 0, 0)) },
  uEmisDay: { value: new Float32Array(16) },
  uEmisScale: { value: 6.0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** base dampness of the streets (Thai puddles never dry) 0..1; rain adds on top (uWet) */
  uDamp: { value: 0.32 },
  /** planar reflection of the street (reflect.ts): texture + projective matrix + on/off */
  uRefl: { value: null as THREE.Texture | null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  /** tileable mask noise (see noiseTex) */
  uNoise: { value: null as THREE.Texture | null },
};
for (const k in EMIS) {
  const e = EMIS[k];
  U.uEmisCol.value[e.i].set(e.c);
  U.uEmisDay.value[e.i] = e.day;
}

// ------------------------------------------------------------------ mask noise (procedural masks only, not art)

let _noiseTex: THREE.DataTexture | null = null;
/**
 * Tileable 256² RGBA value-noise fbm used as cheap MASKS in the world shader (puddle shapes, moss breakup,
 * streaks, wheel-track wear): one texture fetch instead of dozens of hash evaluations per pixel.
 * R = large blobs (period 64 px), G = medium (32), B = fine (16), A = very fine (8).
 */
export function noiseTex(): THREE.DataTexture {
  if (_noiseTex) return _noiseTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  let seed = 1337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lattice = (P: number) => { const g = new Float32Array(P * P); for (let i = 0; i < P * P; i++) g[i] = rnd(); return g; };
  const fbmChan = (basePeriod: number, oct: number) => {
    const out = new Float32Array(N * N);
    let amp = 0.5, total = 0;
    for (let o = 0; o < oct; o++) {
      const cells = Math.max(2, Math.round(N / (basePeriod / (1 << o))));
      const g = lattice(cells);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells, fy = (y / N) * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x0 = ix % cells, y0 = iy % cells, x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
        const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
        out[y * N + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
      total += amp; amp *= 0.5;
    }
    for (let i = 0; i < N * N; i++) out[i] /= total;
    return out;
  };
  const ch = [fbmChan(64, 4), fbmChan(32, 4), fbmChan(16, 3), fbmChan(8, 2)];
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 4; k++) data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(ch[k][i] * 255)));
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  _noiseTex = t;
  return t;
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
  const metal = new Float32Array(N);
  const rough = new Float32Array(N).fill(1);
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
  const pud = Float32Array.from(LAYERS.map(layerPud));
  const moss = Float32Array.from(LAYERS.map(layerMoss));
  return { alb: mk(alb, true), nra: mk(nra, false), metal, rough, tiles, size, pud, moss };
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
    .replace('#include <begin_vertex>', `#include <begin_vertex>
if (aExtra.y < -0.5) {
  // thin cable: keep it at least ~1 px wide far away (otherwise it breaks into dashes)
  vec3 wcp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  transformed += normalize(objectNormal) * max(0.0, distance(cameraPosition, wcp) * uWirePx - 0.007);
}
if (aExtra.z > 2.999) {
  // cloth (laundry, curtains, awning valances): sway in the breeze, weight grows toward the free edge
  float cw = fract(aExtra.z) * 1.05;
  vec3 cp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float ph = dot(cp0.xz, vec2(0.63, 0.91)) + cp0.y * 0.4;
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + cp0.x * 0.05) * sin(uTime * 0.23 + cp0.z * 0.04);
  float sw = (sin(uTime * 1.9 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.25) * gust;
  transformed += (normalize(objectNormal) * sw * 0.07 + vec3(uWind.x, 0.0, uWind.z) * (0.02 + 0.035 * sw)) * cw;
}`)
    .replace('#include <common>', `#include <common>
attribute vec4 aExtra;
uniform float uWirePx;
uniform float uTime;
uniform vec3 uWind;
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

/** layer index helper for shader defines */
const LI = (n: string) => (LAYER_INDEX.get(n) ?? 0).toFixed(1);

/**
 * FAKE INTERIORS ("interior mapping"): a window pane quad (uv 0..1, aExtra = [paneW, paneH, 2 + variant, emissive])
 * shows a whole room behind the glass by ray-casting a box in the fragment shader: floor (tiles / terrazzo /
 * wood), plaster walls & ceiling from the texture arrays, a wardrobe / shelf and a bed or table at different
 * depths, curtains, a ceiling tube at night. Rooms are seeded from the pane position — every window differs.
 */
const INTERIOR_GLSL = /* glsl */`
vec3 wRoomTex(vec2 uv, float layer) { return texture(uAlb, vec3(uv, layer)).rgb; }
vec3 wInterior(vec3 wp, vec3 nW, vec2 uv, vec4 ex, out float glassDirt) {
  float W = max(ex.x, 0.3), H = max(ex.y, 0.3);
  vec3 N = normalize(nW);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
  vec3 org = wp - T * (uv.x * W) - vec3(0.0, uv.y * H, 0.0);
  vec3 sp = floor(org * 2.0 + 0.5);
  float s1 = wHash13(sp + 0.31), s2 = wHash13(sp + 17.3), s3 = wHash13(sp + 41.9), s4 = wHash13(sp + 73.1), s5 = wHash13(sp + 5.7);
  vec3 V = normalize(wp - cameraPosition);
  vec3 rd = vec3(dot(V, T), V.y, max(-dot(V, N), 0.02));
  rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x; rd.y = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  vec3 ro = vec3(uv.x * W, uv.y * H, 0.0);
  float sill = 0.85 + s2 * 0.3;
  float D = 3.0 + s1 * 3.0;
  float x0 = -0.3 - s3 * 1.1, x1 = W + 0.3 + s4 * 1.1;
  float y0 = -sill, y1 = 2.8 - sill;
  float tX = ((rd.x > 0.0 ? x1 : x0) - ro.x) / rd.x;
  float tY = ((rd.y > 0.0 ? y1 : y0) - ro.y) / rd.y;
  float tZ = (D - ro.z) / rd.z;
  float t = min(min(tX, tY), tZ);
  vec3 p = ro + rd * t;
  // wall paint: pastel blues, greens, creams, pinks (Thai rooms), tinted plaster photo
  vec3 paint = mix(mix(vec3(0.86, 0.84, 0.76), vec3(0.62, 0.78, 0.84), step(0.5, s5)), mix(vec3(0.72, 0.84, 0.66), vec3(0.9, 0.74, 0.72), step(0.5, s4)), step(0.62, s3));
  float flL = s2 < 0.4 ? ${LI('tiles_floor')} : s2 < 0.7 ? ${LI('terrazzo')} : ${LI('wood_old')};
  vec3 col;
  float edge;
  if (t == tZ) { col = wRoomTex(p.xy * 0.45, ${LI('plaster_dirty')}) * paint; edge = min(min(p.x - x0, x1 - p.x), min(p.y - y0, y1 - p.y)); }
  else if (t == tY) {
    if (rd.y < 0.0) { col = wRoomTex(p.xz * 0.7, flL) * 0.85; edge = min(min(p.x - x0, x1 - p.x), D - p.z); }
    else { col = wRoomTex(p.xz * 0.4, ${LI('plaster')}) * vec3(0.92); edge = min(min(p.x - x0, x1 - p.x), D - p.z); }
  } else { col = wRoomTex(p.zy * 0.45, ${LI('plaster_dirty')}) * paint * 0.92; edge = min(min(p.y - y0, y1 - p.y), D - p.z); }
  float ao = 0.55 + 0.45 * smoothstep(0.0, 0.6, edge);
  // wardrobe / shelf against the back wall
  float fa = x0 + (x1 - x0) * (0.1 + 0.5 * s4), fb = fa + 0.8 + s5 * 1.0, fh = 1.6 + s3 * 0.6, fd = 0.55;
  float tf = (D - fd - ro.z) / rd.z; vec3 pf = ro + rd * tf;
  if (tf < t && pf.x > fa && pf.x < fb && pf.y < y0 + fh) {
    t = tf; p = pf; ao = 0.8;
    col = s1 > 0.5 ? wRoomTex(pf.xy * 0.8, ${LI('wood_paint')}) * vec3(0.75, 0.6, 0.45) : wRoomTex(pf.xy * 0.8, ${LI('plastic')}) * vec3(0.8, 0.82, 0.86);
    col *= 0.85 + 0.15 * step(0.04, abs(fract((pf.x - fa) / max(0.3, (fb - fa) * 0.5)) - 0.5));
  }
  // bed / table top
  float th = y0 + 0.5 + s2 * 0.25, tz0 = 0.9 + s5 * 0.8, tz1 = tz0 + 1.2 + s1 * 0.8;
  float ta = x0 + (x1 - x0) * 0.55 * s3, tb = ta + 1.0 + s4 * 0.9;
  float tt = (th - ro.y) / rd.y; vec3 pt = ro + rd * tt;
  if (rd.y < 0.0 && tt > 0.0 && tt < t && pt.z > tz0 && pt.z < tz1 && pt.x > ta && pt.x < tb) {
    t = tt; p = pt; ao = 0.9;
    col = wRoomTex(pt.xz * 1.2, ${LI('fabric')}) * mix(vec3(0.85, 0.5, 0.5), vec3(0.5, 0.6, 0.85), s5);
  }
  // lighting: daylight from the window falling off with depth / the room lamp at night
  float lit = step(0.5, ex.w);
  vec3 lampC = lit > 0.5 ? uEmisCol[int(floor(ex.w))] : vec3(1.0);
  bool tv = int(floor(ex.w)) == 4;
  if (fract(ex.z) > 0.9) {
    // OFFICE floor: deep open plan, carpet, grey partitions, a grid of ceiling panels, venetian blinds
    float Do = 9.0;
    float tYo = ((rd.y > 0.0 ? 2.6 - 0.9 : -0.9) - ro.y) / rd.y;
    float tZo = (Do - ro.z) / rd.z;
    float to = min(tYo, tZo);
    vec3 q = ro + rd * to;
    vec3 oc;
    float lightK = (1.0 - uNight) * 0.3 + lit * uNight * 1.1;
    if (to == tZo) oc = wRoomTex(q.xy * 0.5, ${LI('plaster')}) * 0.7;
    else if (rd.y < 0.0) {
      oc = wRoomTex(q.xz * 1.5, ${LI('fabric')}) * vec3(0.32, 0.34, 0.38);
      // desks / partitions: dark bands across the floor
      float dk = step(0.62, fract(q.z * 0.42 + s1)) * step(0.3, fract(q.x * 0.33 + s2));
      oc = mix(oc, vec3(0.25, 0.26, 0.27), dk * 0.8);
    } else {
      oc = vec3(0.75);
      vec2 g = fract(q.xz * vec2(0.5, 0.42) + s3);
      float panel = step(0.7, g.x) * step(0.6, g.y);
      oc += vec3(4.0) * panel * (0.3 * (1.0 - uNight) + lit * uNight);
    }
    vec3 room = oc * lightK * vec3(0.92, 0.97, 1.0) * (0.5 + 0.5 * exp(-q.z * 0.12));
    // blinds: horizontal slats partly lowered
    float bl = step(uv.y, 0.35 + 0.6 * s4);
    float slat = 0.6 + 0.4 * step(0.5, fract(uv.y * H * 9.0));
    room = mix(room, vec3(0.62, 0.62, 0.6) * slat * (0.45 * (1.0 - uNight) + lit * uNight * 0.6), (1.0 - bl) * 0.9);
    glassDirt = texture(uNoise, vec2(wp.x + wp.z, wp.y) * 0.2).a * 0.3;
    return room * 0.9;
  }
  if (tv) {
    // a TV is the only light: flickering cold blue, cuts between "scenes"
    float sc = floor(uTime * 0.7 + s1 * 10.0);
    float fl = 0.55 + 0.25 * wHash13(vec3(sc, s2, 1.0)) + 0.2 * wNoise(vec3(uTime * 9.0, s3 * 20.0, 0.0));
    lampC = mix(vec3(0.45, 0.62, 1.0), vec3(0.9, 0.8, 0.7), wHash13(vec3(sc, 3.0, s4))) * fl * 0.7;
  }
  float dayL = (0.38 * exp(-p.z * 0.35) + 0.08) * (1.0 - uNight);
  vec3 L = vec3(dayL) * vec3(1.0, 0.98, 0.94) + lampC * (lit * uNight * (0.5 + 0.35 * exp(-abs(p.z - D * 0.5) * 0.4)));
  vec3 room = col * ao * L;
  // ceiling tube (not in TV rooms) / the TV screen glowing on the back wall
  if (!tv && t == tY && rd.y > 0.0 && abs(p.z - D * 0.45) < 0.05 && abs(p.x - W * 0.5) < 0.6) room += lampC * lit * uNight * 3.0;
  if (tv && t == tZ && abs(p.x - (x0 + x1) * 0.5) < 0.42 && abs(p.y - (y0 + 0.95)) < 0.26) room = lampC * 2.2 * lit * uNight + room * (1.0 - uNight);
  // curtains just behind the glass: half drawn, fully drawn sheer, or none
  float cs = s4;
  float tc = (0.06 - ro.z) / rd.z; vec3 pc = ro + rd * tc;
  float cov = cs < 0.3 ? step(pc.x, W * (0.25 + 0.4 * s1)) : cs < 0.55 ? step(W * (0.45 + 0.4 * s2), pc.x) : cs < 0.75 ? 1.0 : 0.0;
  if (cov > 0.0) {
    float folds = 0.72 + 0.28 * sin(pc.x * 26.0 + sin(pc.y * 3.0 + s1 * 6.0) * 1.5);
    vec3 cc = wRoomTex(pc.xy * 1.5, ${LI('fabric')}) * mix(mix(vec3(0.9, 0.86, 0.75), vec3(0.75, 0.25, 0.22), step(0.6, s5)), vec3(0.35, 0.5, 0.75), step(0.82, s2)) * folds;
    float sheer = cs > 0.55 ? 0.62 : 0.94;
    // lit from inside at night (glows), from the window by day
    vec3 cl = cc * ((0.36 + 0.1 * folds) * (1.0 - uNight) + lampC * lit * uNight * 0.75);
    room = mix(room, cl, sheer * cov);
  }
  glassDirt = texture(uNoise, vec2(wp.x + wp.z, wp.y) * 0.3).a;
  return room;
}
`;

/** rain ripples on puddles (expanding rings in a jittered grid) → normal xy offset */
const RIPPLE_GLSL = /* glsl */`
vec2 wRipple(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 q = p * 2.6 + float(i) * 7.31;
    vec2 c = floor(q); vec2 f = fract(q) - 0.5;
    float h = wHash13(vec3(c, float(i) * 3.7));
    f -= (vec2(wHash13(vec3(c, 9.1)), wHash13(vec3(c, 4.3))) - 0.5) * 0.5;
    float ph = fract(t * 0.9 + h);
    float r = length(f);
    float R = ph * 0.45;
    float ring = sin((r - R) * 46.0) * smoothstep(0.09, 0.0, abs(r - R)) * (1.0 - ph);
    acc += f / max(r, 1e-3) * ring;
  }
  return acc * 0.35;
}
`;

/**
 * The world PBR material (texture arrays). cutout=true → alpha tested (albedo.a) variant.
 * Extras: procedural puddles & wet sheen with planar reflections (reflect.ts), rain ripples, rising damp + moss
 * at the foot of walls, grime overlay, fake interiors behind windows, night emissive palette.
 */
export function makeWorldMaterial(tex: WorldTex, cutout = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true, side: cutout ? THREE.DoubleSide : THREE.FrontSide });
  m.name = cutout ? 'world-cut' : 'world';
  const uniforms = {
    uAlb: { value: tex.alb }, uNra: { value: tex.nra },
    uMetal: { value: tex.metal }, uRoughL: { value: tex.rough },
    uPud: { value: tex.pud }, uMoss: { value: tex.moss },
    uNormalScale: { value: 1.0 },
  };
  const NL = Math.max(1, tex.metal.length);   // one entry per texture-array layer
  m.onBeforeCompile = (shader) => {
    if (!U.uNoise.value) U.uNoise.value = noiseTex();
    Object.assign(shader.uniforms, uniforms, U);
    if (!U.uRefl.value) U.uRefl.value = dummyTex();
    injectWorldVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2DArray uAlb;
uniform sampler2DArray uNra;
uniform float uMetal[${NL}];
uniform float uRoughL[${NL}];
uniform float uPud[${NL}];
uniform float uMoss[${NL}];
uniform float uNormalScale;
uniform vec3 uEmisCol[16];
uniform float uEmisDay[16];
uniform float uEmisScale;
uniform float uNight;
uniform float uWet;
uniform float uDamp;
uniform float uTime;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform sampler2D uNoise;
varying vec2 vUvT;
varying vec4 vExt;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE_GLSL}
${TANGENT_GLSL}
${RIPPLE_GLSL}`)
      .replace('#include <map_fragment>', `
vec3 wp = vWPos;
float wL0 = floor(vExt.x + 0.5);
float wL1 = max(0.0, floor(vExt.y + 0.5));
vec4 albT = vec4(1.0);
vec4 nraT = vec4(0.5, 0.5, 0.08, 1.0);
vec3 baseCol;
float ovA = 0.0;
float puddle = 0.0, damp = 0.0;
{
  albT = texture(uAlb, vec3(vUvT, wL0));
  nraT = texture(uNra, vec3(vUvT, wL0));
  ${cutout ? 'if (albT.a < 0.5) discard;' : ''}
  baseCol = albT.rgb * vColor.rgb;
  if (vExt.z > 0.001 && vExt.z < 1.5) {
    vec2 nuv = abs(vWNrm.y) > 0.5 ? wp.xz : vec2(wp.x + wp.z, wp.y * 0.4);
    float blot = texture(uNoise, nuv * 0.011 + 0.31).r;
    float streak = texture(uNoise, vec2((wp.x + wp.z) * 0.16, wp.y * 0.011)).b * texture(uNoise, vec2((wp.x - wp.z) * 0.05, wp.y * 0.004 + 0.5)).g;
    float bottom = 1.0 - smoothstep(0.0, 1.7, wp.y - 0.1);
    float m = blot * 1.15 + streak * 0.7 + bottom * 0.55 - 0.42;
    ovA = smoothstep(0.18, 0.62, m) * min(vExt.z, 1.0);
    vec2 ouv = vUvT * 0.71 + vec2(0.37, 0.11);
    vec4 albO = texture(uAlb, vec3(ouv, wL1));
    vec4 nraO = texture(uNra, vec3(ouv, wL1));
    baseCol = mix(baseCol, albO.rgb * mix(vec3(1.0), vColor.rgb, 0.25), ovA);
    nraT = mix(nraT, nraO, ovA);
  }
  // --- weathering at the foot of walls: rising damp band, black algae, green moss in the cracks
  float mossK = uMoss[int(wL0)];
  if (mossK > 0.0 && abs(vWNrm.y) < 0.6) {
    float hb = wp.y - 0.12;
    vec4 mn = texture(uNoise, vec2((wp.x + wp.z) * 0.045, wp.y * 0.09 + 0.17));
    float nb = mn.r;
    float band = 1.0 - smoothstep(0.0, 0.55 + 0.6 * nb, hb);
    float n = mn.g * 0.7 + mn.a * 0.3;
    float moss = smoothstep(0.42, 0.72, band * (0.55 + n * 0.9)) * mossK;
    baseCol *= 1.0 - band * 0.32 * mossK;
    baseCol = mix(baseCol, baseCol * vec3(0.5, 0.58, 0.34) + vec3(0.006, 0.012, 0.0), moss * 0.85);
    // dark water streaks running down from ledges (stretched vertical noise)
    float st = texture(uNoise, vec2((wp.x + wp.z) * 0.45, wp.y * 0.02 + 0.7)).b;
    baseCol *= 1.0 - smoothstep(0.62, 0.9, st) * 0.22 * mossK;
  }
  // --- wheel tracks: polished darker lanes where tyres run, an oil-drip line in the middle of each lane
  //     (soi: x -3.5..3.5 running N-S; main road: z 6..22 running E-W, median 13.25..14.75)
  if (wL0 > 0.5 && wL0 < 4.5 && vWNrm.y > 0.9) {
    float across = -1.0, lane = 0.0;
    if (abs(wp.x) < 3.5 && wp.z < 6.0) { across = wp.x + 3.5; lane = 3.5; }
    else if (wp.z > 6.0 && wp.z < 13.25) { across = wp.z - 6.0; lane = 3.62; }
    else if (wp.z > 14.75 && wp.z < 22.0) { across = wp.z - 14.75; lane = 3.62; }
    if (across > -50.0) {
      float lp = fract(across / lane);          // 0..1 within a lane
      float tr = exp(-pow((lp - 0.27) * 9.0, 2.0)) + exp(-pow((lp - 0.73) * 9.0, 2.0));
      vec4 tn = texture(uNoise, wp.xz * 0.037 + 0.63);
      float br = 0.55 + 0.45 * tn.g;
      float oilL = exp(-pow((lp - 0.5) * 14.0, 2.0)) * smoothstep(0.45, 0.7, tn.b);
      baseCol *= 1.0 - tr * br * 0.16 - oilL * 0.22;
      nraT.b *= 1.0 - tr * br * 0.28 - oilL * 0.35;
    }
  }
  // --- puddles & wet ground (outdoor flat surfaces): organic blobs, a darker damp rim, mirror water
  float pudK = uPud[int(wL0)] * smoothstep(0.84, 0.95, vColor.a);
  if (pudK > 0.0 && vWNrm.y > 0.85) {
    float wetAmt = clamp(max(uDamp, uWet * 1.1), 0.0, 1.0);
    vec4 pn = texture(uNoise, wp.xz * 0.0125);
    float n = pn.r * 0.9 + texture(uNoise, wp.xz * 0.11).a * 0.12 + pn.b * 0.05 - 0.035;
    float thr = mix(0.78, 0.5, wetAmt);
    puddle = smoothstep(thr, thr + 0.035, n) * pudK;
    damp = smoothstep(thr - 0.14 - 0.1 * wetAmt, thr, n) * pudK;
  }
}
float wetK = max(uWet * smoothstep(0.55, 0.95, vWNrm.y), damp * 0.85);
baseCol *= mix(1.0, 0.58, wetK);
baseCol *= mix(1.0, 0.5, puddle);
diffuseColor.rgb *= baseCol * (0.52 + 0.48 * vColor.a);
`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = clamp(roughness * nraT.b * uRoughL[int(wL0)] * mix(1.0, 0.32, wetK), 0.03, 1.0);
roughnessFactor = mix(roughnessFactor, 0.035, puddle);`)
      .replace('#include <metalnessmap_fragment>', `
float metalnessFactor = metalness * mix(uMetal[int(wL0)], uMetal[int(wL1)], ovA);`)
      .replace('#include <normal_fragment_maps>', `
{
  vec3 mapN = vec3(nraT.xy * 2.0 - 1.0, 0.0);
  mapN.xy *= uNormalScale * (1.0 - wetK * 0.55) * (1.0 - puddle * 0.97);
  if (puddle > 0.01 && uWet > 0.03) mapN.xy += wRipple(wp.xz, uTime) * puddle * min(1.0, uWet * 2.0);
  mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
  normal = wPerturb(-vViewPosition, normal, vUvT, mapN, faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vExt.w > 0.5) {
  int pi = int(floor(vExt.w));
  float ek = fract(vExt.w);
  totalEmissiveRadiance += uEmisCol[pi] * ek * mix(uEmisDay[pi], 1.0, uNight) * uEmisScale;
}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
{
  // planar street reflection in puddles and on wet ground (rough wet → blurrier mip)
  float mirK = clamp(puddle + wetK * 0.7, 0.0, 1.0);
  if (uReflOn > 0.5 && mirK > 0.002) {
    vec4 rp = uReflMat * vec4(wp, 1.0);
    vec2 ruv = rp.xy / rp.w;
    vec3 nWr = inverseTransformDirection(normal, viewMatrix);
    ruv += nWr.xz * (0.025 + 0.04 * (1.0 - puddle));
    vec3 rc = textureLod(uRefl, ruv, material.roughness * 6.0).rgb;
    float inb = smoothstep(0.0, 0.03, ruv.x) * smoothstep(1.0, 0.97, ruv.x) * smoothstep(0.0, 0.03, ruv.y) * smoothstep(1.0, 0.97, ruv.y);
    radiance = mix(radiance, rc, mirK * inb);
  }
}
#endif`)
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
  m.customProgramCacheKey = () => (cutout ? 'world-cut-v4' : 'world-v4');
  return m;
}

/**
 * Window panes with fake interiors (WB.roomPane, kind 'room'): glass that reflects the sky (low roughness,
 * fresnel from the PBR model) over a ray-cast room drawn as emissive (INTERIOR_GLSL). Own small program so
 * the main world shader stays lean.
 */
export function makeRoomMaterial(tex: WorldTex): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, vertexColors: false, envMapIntensity: 1.1 });
  m.name = 'world-room';
  m.onBeforeCompile = (shader) => {
    if (!U.uNoise.value) U.uNoise.value = noiseTex();
    Object.assign(shader.uniforms, { uAlb: { value: tex.alb } }, U);
    injectWorldVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2DArray uAlb;
uniform sampler2D uNoise;
uniform vec3 uEmisCol[16];
uniform float uNight;
uniform float uTime;
varying vec2 vUvT;
varying vec4 vExt;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE_GLSL}
${INTERIOR_GLSL}`)
      .replace('#include <map_fragment>', `
float glassDirt = 0.0;
vec3 roomEmis = wInterior(vWPos, vWNrm, vUvT, vExt, glassDirt);
diffuseColor.rgb = vec3(0.012, 0.013, 0.014);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = 0.04 + 0.22 * glassDirt;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += roomEmis;`);
  };
  m.customProgramCacheKey = () => 'world-room-v1';
  return m;
}

let _dummy: THREE.Texture | null = null;
function dummyTex() {
  if (!_dummy) { _dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); _dummy.needsUpdate = true; }
  return _dummy;
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
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
vDWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`).replace('#include <common>', `#include <common>
varying vec3 vDWPos;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uWet; varying vec4 vExt; varying vec3 vDWPos;
uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn;`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vColor.rgb; diffuseColor.a *= vColor.a;
float dWet = clamp(vExt.x, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, 0.55, dWet);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(vExt.y > 0.0 ? vExt.y : roughness, 0.04, dWet);`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
if (uReflOn > 0.5 && dWet > 0.01) {
  vec4 rp = uReflMat * vec4(vDWPos, 1.0);
  vec2 ruv = rp.xy / rp.w + inverseTransformDirection(normal, viewMatrix).xz * 0.02;
  radiance = mix(radiance, textureLod(uRefl, ruv, 0.5).rgb, dWet);
}
#endif`);
  };
  m.customProgramCacheKey = () => 'world-decal-v2';
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
