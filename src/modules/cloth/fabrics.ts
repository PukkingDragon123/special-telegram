import * as THREE from 'three';
import { Assets } from '../../core/assets';
import type { GarmentKind } from './api';
import type { RNG } from '../../core/rng';

/* ============================================================================================
 * FABRICS — real fabric photos from public/assets/textures/clothing (see its manifest.json for sources):
 * albedo + OpenGL weave normal maps, MeshStandardMaterial, double sided (both faces lit correctly).
 * `tile` = metres of cloth one texture repeat covers (plaid check, knit, print scale).
 * Recolourable knits (grey jersey, white terry, white pique) are tinted per garment through vertex colours.
 * ========================================================================================== */

export interface FabricDef {
  id: string;
  file: string;
  normal?: string;
  tile: number;
  rough?: number;
  sheen?: number;
  /** 'panel' = the texture is a whole garment panel (mapped to the garment's bounding box) */
  uv?: 'tile' | 'panel';
  /** neutral base: per-garment tint colours (hex) */
  tints?: number[];
  /** average colour of the photo (for tint maths) */
  avg?: number;
}

const D = 'textures/clothing/';
const BRIGHT = [0xd23a32, 0x2f63b8, 0x2a8a4a, 0xe8a33d, 0x7b4f9e, 0xe0457b, 0x1d1d1f, 0xf2f0ea, 0x46a0c8, 0xe86a2a, 0x5a6a7a, 0xc8c040];
const PASTEL = [0xf4c6d0, 0xb8d8f0, 0xf6e6a8, 0xc8eccc, 0xf2f0ea, 0xe8c8f0, 0xffd8b0];

export const FABRICS: Record<string, FabricDef> = {
  jersey: { id: 'jersey', file: 'jersey_grey.jpg', normal: 'jersey_grey_normal.jpg', tile: 0.16, tints: BRIGHT, avg: 0x8a8a8a, sheen: 0.4 },
  stripe_thin: { id: 'stripe_thin', file: 'stripe_white_grey_thin.jpg', normal: 'stripe_white_grey_thin_normal.jpg', tile: 0.22 },
  stripe_heather: { id: 'stripe_heather', file: 'stripe_heather_wide.jpg', normal: 'stripe_heather_wide_normal.jpg', tile: 0.26 },
  stripe_green: { id: 'stripe_green', file: 'stripe_green_white_pique.jpg', normal: 'stripe_green_white_pique_normal.jpg', tile: 0.22 },
  pique: { id: 'pique', file: 'pique_white.jpg', normal: 'pique_white_normal.jpg', tile: 0.14, tints: BRIGHT, avg: 0xe6e4de },
  black: { id: 'black', file: 'cotton_black.jpg', normal: 'cotton_black_normal.jpg', tile: 0.2 },
  hawaii_red: { id: 'hawaii_red', file: 'hawaiian_red_hibiscus.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.34, rough: 0.78 },
  hawaii_blue: { id: 'hawaii_blue', file: 'hawaiian_blue_floral.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.34, rough: 0.78 },
  hawaii_sage: { id: 'hawaii_sage', file: 'hawaiian_sage_hibiscus.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.34, rough: 0.78 },
  songkran: { id: 'songkran', file: 'thai_songkran_floral.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.32, rough: 0.8 },
  auntie_pink: { id: 'auntie_pink', file: 'auntie_blouse_pink_ditsy.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.2, rough: 0.7 },
  auntie_mint: { id: 'auntie_mint', file: 'auntie_blouse_mint_ditsy.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.2, rough: 0.7 },
  poplin: { id: 'poplin', file: 'shirt_white_poplin.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.16, rough: 0.82 },
  pinstripe: { id: 'pinstripe', file: 'stripe_blue_shirting.jpg', normal: 'stripe_blue_shirting_normal.jpg', tile: 0.18, rough: 0.8 },
  paisley: { id: 'paisley', file: 'paisley_blue_white.jpg', normal: 'shirt_white_poplin_normal.jpg', tile: 0.24, rough: 0.8 },
  rib_white: { id: 'rib_white', file: 'singlet_rib_white.jpg', normal: 'singlet_rib_white_normal.jpg', tile: 0.12 },
  rib_yellow: { id: 'rib_yellow', file: 'singlet_rib_yellowed.jpg', normal: 'singlet_rib_yellowed_normal.jpg', tile: 0.12 },
  rib_sweaty: { id: 'rib_sweaty', file: 'singlet_rib_sweaty.jpg', normal: 'singlet_rib_sweaty_normal.jpg', tile: 0.4 },
  moto_vest: { id: 'moto_vest', file: 'win_vest_back_505.jpg', normal: 'vest_orange_poly_normal.jpg', tile: 1, uv: 'panel', rough: 0.7 },
  vest_orange: { id: 'vest_orange', file: 'vest_orange_poly.jpg', normal: 'vest_orange_poly_normal.jpg', tile: 0.2, rough: 0.7 },
  rider_green: { id: 'rider_green', file: 'rider_green_poly.jpg', normal: 'rider_green_poly_normal.jpg', tile: 0.22, rough: 0.6, sheen: 0.2 },
  rider_pink: { id: 'rider_pink', file: 'rider_pink_poly.jpg', normal: 'rider_pink_poly_normal.jpg', tile: 0.22, rough: 0.6, sheen: 0.2 },
  khaki: { id: 'khaki', file: 'cotton_khaki_twill.jpg', normal: 'cotton_khaki_twill_normal.jpg', tile: 0.2 },
  school_navy: { id: 'school_navy', file: 'school_navy_twill.jpg', normal: 'school_navy_twill_normal.jpg', tile: 0.2 },
  denim: { id: 'denim', file: 'denim_mid_seam.jpg', normal: 'denim_mid_seam_normal.jpg', tile: 0.32, rough: 0.88 },
  denim_dark: { id: 'denim_dark', file: 'denim_dark.jpg', normal: 'denim_dark_normal.jpg', tile: 0.24, rough: 0.88 },
  khakuay: { id: 'khakuay', file: 'khakuay_indigo_cotton.jpg', normal: 'khakuay_indigo_cotton_normal.jpg', tile: 0.25 },
  police: { id: 'police', file: 'police_khaki_brown.jpg', normal: 'police_khaki_brown_normal.jpg', tile: 0.2 },
  boxer_nb: { id: 'boxer_nb', file: 'boxer_plaid_navy_beige.jpg', normal: 'boxer_plaid_navy_beige_normal.jpg', tile: 0.2 },
  boxer_bw: { id: 'boxer_bw', file: 'boxer_plaid_black_white.jpg', normal: 'boxer_plaid_black_white_normal.jpg', tile: 0.2 },
  boxer_ng: { id: 'boxer_ng', file: 'boxer_plaid_navy_green.jpg', normal: 'boxer_plaid_navy_green_normal.jpg', tile: 0.2 },
  terry: { id: 'terry', file: 'terry_white_headband.jpg', normal: 'terry_white_headband_normal.jpg', tile: 0.12, tints: PASTEL, avg: 0xeeeeea, rough: 0.97, sheen: 0.6 },
  pkm_blue: { id: 'pkm_blue', file: 'phakhaoma_blue_white.jpg', normal: 'phakhaoma_blue_white_normal.jpg', tile: 0.3 },
  pkm_red: { id: 'pkm_red', file: 'phakhaoma_red_yellow.jpg', normal: 'phakhaoma_red_yellow_normal.jpg', tile: 0.3 },
  pkm_rainbow: { id: 'pkm_rainbow', file: 'phakhaoma_rainbow.jpg', normal: 'phakhaoma_rainbow_normal.jpg', tile: 0.3 },
  pkm_green: { id: 'pkm_green', file: 'phakhaoma_green_yellow.jpg', normal: 'phakhaoma_green_yellow_normal.jpg', tile: 0.3 },
  sarong: { id: 'sarong', file: 'sarong_red_purple.jpg', normal: 'sarong_red_purple_normal.jpg', tile: 0.34 },
};

/** accepts both the short ids above and the clothing file stems ('phakhaoma_red_yellow') */
export function fabricId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (FABRICS[id]) return id;
  for (const f of Object.values(FABRICS)) if (f.file.replace(/\.jpg$/, '') === id) return f.id;
  return undefined;
}

/** What hangs on Thai laundry lines: fabric choices per garment kind. */
export const GARMENT_FABRICS: Record<GarmentKind, string[]> = {
  tshirt: ['jersey', 'jersey', 'jersey', 'stripe_thin', 'stripe_heather', 'stripe_green', 'black', 'pique', 'songkran', 'hawaii_red', 'hawaii_blue'],
  shirt: ['poplin', 'poplin', 'pinstripe', 'paisley', 'hawaii_sage', 'songkran', 'auntie_pink', 'auntie_mint'],
  singlet: ['rib_white', 'rib_white', 'rib_yellow', 'rib_sweaty'],
  vest: ['moto_vest', 'moto_vest', 'vest_orange'],
  jacket: ['rider_green', 'rider_pink'],
  shorts: ['khaki', 'school_navy', 'denim', 'black', 'khaki'],
  boxers: ['boxer_nb', 'boxer_bw', 'boxer_ng'],
  pants: ['khakuay', 'denim_dark', 'denim', 'police', 'black'],
  towel: ['terry', 'terry', 'pkm_blue'],
  phakhaoma: ['pkm_blue', 'pkm_red', 'pkm_rainbow', 'pkm_green'],
  sarong: ['sarong', 'pkm_rainbow', 'auntie_pink'],
  socks: ['black', 'jersey', 'rib_white'],
  sheet: ['jersey', 'auntie_mint', 'songkran', 'terry'],
};

/** kg of a damp garment of this kind (wet laundry hangs heavy, light things flutter) */
export const GARMENT_MASS: Record<GarmentKind, number> = {
  tshirt: 0.22, shirt: 0.24, singlet: 0.12, vest: 0.16, jacket: 0.45, shorts: 0.3, boxers: 0.12, pants: 0.6,
  towel: 0.3, phakhaoma: 0.32, sarong: 0.4, socks: 0.03, sheet: 0.9,
};

const mats = new Map<string, THREE.MeshStandardMaterial>();

export function fabricMaterial(id: string): THREE.MeshStandardMaterial {
  let m = mats.get(id);
  if (m) return m;
  const f = FABRICS[id] ?? FABRICS.jersey;
  const map = Assets.texture(D + f.file, { srgb: true, wrap: f.uv !== 'panel' });
  map.anisotropy = 8;
  const normalMap = f.normal ? Assets.texture(D + f.normal, { srgb: false }) : null;
  // (MeshPhysicalMaterial sheen produced NaN pixels through the post chain → black frames; plain PBR is safe)
  m = new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: f.rough ?? 0.93, metalness: 0, envMapIntensity: 0.9,
    vertexColors: true, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  });
  m.name = 'fabric:' + id;
  mats.set(id, m);
  return m;
}

/** per-garment tint (linear multiplier applied through vertex colours) */
export function fabricTint(id: string, rng: RNG): THREE.Color {
  const f = FABRICS[id] ?? FABRICS.jersey;
  const c = new THREE.Color(1, 1, 1);
  if (f.tints) {
    const want = new THREE.Color(rng.pick(f.tints));
    const avg = new THREE.Color(f.avg ?? 0x888888);
    c.setRGB(want.r / Math.max(0.05, avg.r), want.g / Math.max(0.05, avg.g), want.b / Math.max(0.05, avg.b));
  }
  // sun-faded / washed a hundred times
  const fade = rng.range(0.86, 1.0);
  c.multiplyScalar(fade);
  return c;
}
