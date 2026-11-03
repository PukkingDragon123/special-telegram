import type * as THREE from 'three';

/* ============================================================================================
 * cloth — public registry (no dependencies, safe to import from any module).
 *
 * World builders publish WHERE laundry hangs; the cloth module fills those spots with real simulated
 * garments (position-based dynamics, wind, gravity, pegs / hangers, collisions with people):
 *
 *   ClothSpots.line({ a, b, seed, wall })   clothesline between two world points (pegged garments, rope sags)
 *   ClothSpots.rail({ a, b, seed, wall })   pole / grille rail: garments on hangers
 *
 * Moving props attach their own cloth (follows the object every frame, swings with its motion):
 *
 *   registerClothAnchor(object, { garment: 'towel', fabric: 'phakhaoma_red_yellow', drape: { a, b }, fallback })
 *
 * `fallback` is the old static mesh: it stays visible until the cloth module takes over (and if the module
 * is not loaded at all). All coordinates are metres; anchor coordinates are local to `object`.
 * ========================================================================================== */

export type V3 = [number, number, number];

export type GarmentKind =
  | 'tshirt' | 'singlet' | 'shirt' | 'vest' | 'jacket' | 'shorts' | 'boxers' | 'pants'
  | 'towel' | 'phakhaoma' | 'sarong' | 'socks' | 'sheet';

/** half-space the cloth may not enter: dot(n, p) >= d (e.g. the facade behind a balcony line) */
export interface ClothWall { n: V3; d: number }

export interface LineSpot {
  kind: 'line' | 'rail';
  a: V3;
  b: V3;
  seed: number;
  wall?: ClothWall;
  /** 0..1 how full the line is (default 0.8) */
  fill?: number;
  /** where it hangs: changes what is hung (balconies: everything; shops: towels + shirts; alleys: work clothes) */
  style?: 'balcony' | 'grille' | 'street' | 'alley' | 'shop';
}

export const ClothSpots = {
  lines: [] as LineSpot[],
  line(s: Omit<LineSpot, 'kind'>) { this.lines.push({ ...s, kind: 'line' }); },
  rail(s: Omit<LineSpot, 'kind'>) { this.lines.push({ ...s, kind: 'rail' }); },
  clear() { this.lines.length = 0; },
};

export interface AnchorSpec {
  garment: GarmentKind;
  /** fabric id from public/assets/textures/clothing (default by garment) */
  fabric?: string;
  /** draped over a bar from a → b (object-local); both halves hang down */
  drape?: { a: V3; b: V3; r?: number };
  /** pinned at these object-local points instead (garment top edge, left → right) */
  pins?: V3[];
  /** garment size override [width, length] in metres */
  size?: [number, number];
  /** static mesh to hide while the simulated cloth is alive */
  fallback?: THREE.Object3D | null;
  /** object-local capsules the cloth collides with: [a, b, radius] */
  capsules?: [V3, V3, number][];
  seed?: number;
}

export interface AnchorRec { obj: THREE.Object3D; spec: AnchorSpec; live?: any }

export const ClothAnchors = new Set<AnchorRec>();

/** Attach a simulated cloth to a (moving) object. Returns an unregister function. */
export function registerClothAnchor(obj: THREE.Object3D, spec: AnchorSpec): () => void {
  const rec: AnchorRec = { obj, spec };
  ClothAnchors.add(rec);
  return () => { rec.live?.dispose?.(); ClothAnchors.delete(rec); };
}
