import * as THREE from 'three';
import { G, groups } from '../sim/physics';

/* ============================================================================================
 * Static-world queries for people that walk on rails (crowd walkers on sidewalk polylines,
 * host NPCs on nav paths): "is this spot inside a wall / prop / parked vehicle?" and "is the
 * way ahead blocked?". Cheap Rapier queries (one ball overlap, two short rays).
 * ========================================================================================== */

const BLOCKERS = groups(G.ALL, G.STATIC | G.VEHICLE);
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
let ballR = -1, ball: any = null;
const ROT = { x: 0, y: 0, z: 0, w: 1 };

/** a body-sized ball at hip/chest height overlaps a static collider or a vehicle */
export function insideStatic(phys: any, x: number, y: number, z: number, r = 0.22): boolean {
  if (!phys?.world) return false;
  if (ballR !== r) { ball = new phys.R.Ball(r); ballR = r; }
  try {
    const a = phys.world.intersectionWithShape({ x, y: y + 0.95, z }, ROT, ball, undefined, BLOCKERS);
    if (a) return true;
    return !!phys.world.intersectionWithShape({ x, y: y + 0.55, z }, ROT, ball, undefined, BLOCKERS);
  } catch { return false; }
}

/** distance to the first blocker straight ahead (knee + chest rays), or null when the way is clear */
export function blockedAhead(phys: any, x: number, y: number, z: number, dx: number, dz: number, len: number): number | null {
  if (!phys?.raycast) return null;
  const l = Math.hypot(dx, dz);
  if (l < 1e-5) return null;
  _d.set(dx / l, 0, dz / l);
  let best: number | null = null;
  for (const h of [0.5, 1.15]) {
    _o.set(x, y + h, z);
    const hit = phys.raycast(_o, _d, len, G.STATIC | G.VEHICLE);
    // ignore near-horizontal floor hits (ramps/steps): only wall-ish normals block
    if (hit && Math.abs(hit.normal.y) < 0.6) best = best === null ? hit.toi : Math.min(best, hit.toi);
  }
  return best;
}
