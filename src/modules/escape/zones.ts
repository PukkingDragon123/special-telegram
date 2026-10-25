import * as THREE from 'three';
import { MAP_BOUNDS } from '../../game/mapplan';

/* ============================================================================================
 * Where the neighbourhood ends. The walkable edges (see world/dressing.ts + rural.ts + layout.ts):
 *  - main road (z 0..26) and canal road (z -165..-155.5) closures at x = ±128.5 (barriers + parked pickup)
 *  - invisible bounds at x = ±130.5 (rural strip / paddies north of the canal), z = -270 (north), z = 89 (south)
 * Trigger zones run a few metres inside every one of them. Each zone knows its inward normal `n`,
 * the tangent `t` (n rotated so a vehicle driving along +t shows its right side to the camera inside)
 * and how the police are staged there ('road': a pickup rolls up the road to the barrier; 'open': it
 * patrols along the edge outside the map).
 * ========================================================================================== */

export type Edge = 'E' | 'W' | 'N' | 'S';
export type HideKind = 'crates' | 'drum' | 'trash' | 'pickup';

export interface EdgeHit {
  edge: Edge;
  /** inward unit normal (into the neighbourhood) */
  n: THREE.Vector3;
  /** tangent along the edge */
  t: THREE.Vector3;
  /** coordinate of the edge line (x for E/W, z for N/S) */
  line: number;
  stage: 'road' | 'open';
  /** road centre lane (z) for road staging */
  lane?: number;
}

const ROAD_X = 128.4;
const TRIG_ROAD = 123.6;      // main/canal road: ~5 m before the barriers
const TRIG_X = 124.5;         // rural strip: ~6 m before the invisible wall
const TRIG_N = MAP_BOUNDS.minZ + 5.5;
const TRIG_S = MAP_BOUNDS.maxZ - 5;

const isMainRoad = (z: number) => z > -1 && z < 27.5;
const isCanalRoad = (z: number) => z > -166 && z < -154.5;

function mk(edge: Edge, line: number, stage: 'road' | 'open', lane?: number): EdgeHit {
  const n = edge === 'E' ? new THREE.Vector3(-1, 0, 0) : edge === 'W' ? new THREE.Vector3(1, 0, 0) : edge === 'N' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
  const t = new THREE.Vector3(n.z, 0, -n.x);
  return { edge, n, t, line, stage, lane };
}

/** Is (x,z) inside a trigger zone? */
export function edgeAt(x: number, z: number): EdgeHit | null {
  if (isMainRoad(z) || isCanalRoad(z)) {
    const lane = isMainRoad(z) ? 17.6 : -160;
    if (x > TRIG_ROAD) return mk('E', ROAD_X, 'road', lane);
    if (x < -TRIG_ROAD) return mk('W', -ROAD_X, 'road', lane);
    return null;
  }
  if (x > TRIG_X) return mk('E', MAP_BOUNDS.maxX, 'open');
  if (x < -TRIG_X) return mk('W', MAP_BOUNDS.minX, 'open');
  if (z < TRIG_N) return mk('N', MAP_BOUNDS.minZ, 'open');
  if (z > TRIG_S) return mk('S', MAP_BOUNDS.maxZ, 'open');
  return null;
}

/** distance from the edge line, positive inside */
export function insideDist(h: EdgeHit, x: number, z: number) {
  return h.edge === 'E' ? h.line - x : h.edge === 'W' ? x - h.line : h.edge === 'N' ? z - h.line : h.line - z;
}

export interface HideDef { kind: HideKind; x: number; z: number; yaw: number; edge: Edge }

/** Hiding places dressed a few metres inside every walkable edge (client-local, deterministic). */
export function hideDefs(): HideDef[] {
  const out: HideDef[] = [];
  const H = (kind: HideKind, x: number, z: number, yaw: number, edge: Edge) => out.push({ kind, x, z, yaw, edge });
  for (const s of [1, -1]) {
    const e: Edge = s > 0 ? 'E' : 'W';
    // main road: north sidewalk (z 0..6) + south sidewalk (z 22..26)
    H('crates', s * 121.4, 1.5, 0, e);
    H('drum', s * 123.0, 4.6, 0.4, e);
    H('trash', s * 121.6, 24.7, 0, e);
    H('pickup', s * 117.2, 24.2, s > 0 ? -Math.PI / 2 : Math.PI / 2, e);
    // canal road sidewalk + canal bank walk
    H('drum', s * 122.6, -156.5, 1.1, e);
    H('crates', s * 121.2, -163.4, 0, e);
    // rural strip
    for (const z of [-192, -221, -250]) H((['drum', 'crates', 'trash'] as HideKind[])[Math.abs(z) % 3], s * (s > 0 ? 126.2 : 128.4), z, 0.3 * s, e);
  }
  // north edge (behind the paddies / banana grove)
  const kinds: HideKind[] = ['crates', 'drum', 'trash', 'drum', 'crates', 'trash', 'drum', 'crates', 'drum'];
  let i = 0;
  for (let x = -112; x <= 116; x += 28.5) H(kinds[i++ % kinds.length], x, -265.6, 0.2 * i, 'N');
  // south (behind the wholesale parking)
  H('drum', 92, 84.8, 0, 'S');
  H('crates', 116, 84.6, 0, 'S');
  H('trash', 64, 84.8, 0, 'S');
  return out;
}

/** Poster poles next to some hiding places (dressing; the cinematic brings its own). */
export function posterSpots(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (const s of [1, -1]) {
    out.push({ x: s * 124.6, z: 2.2, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    out.push({ x: s * 124.6, z: 23.6, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    out.push({ x: s * 124.6, z: -157.2, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  return out;
}
