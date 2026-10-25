import * as THREE from 'three';
import type { Game } from '../../game/game';
import { SOI, MAIN, CROAD, MARKET, SW_H } from '../world/layout';
import { realProps } from '../world/realprops';

/* ============================================================================================
 * Where the critters live: kerb bases, shophouse wall bases, drains & manholes (game.world.drains,
 * published by the buildings agent; kerb fallback when absent), trash bags (the props agent's
 * placements), the butcher / market floor. Flattened into ~1k anchor points with a running
 * direction (along a kerb / wall) for cheap sampling near the camera.
 * ========================================================================================== */

export type SpotKind = 'kerb' | 'wall' | 'drain' | 'trash' | 'butcher' | 'market';

export interface Spot {
  x: number; y: number; z: number;
  /** unit direction along the kerb / wall (0,0 for point spots) */
  dx: number; dz: number;
  /** direction of the "crack" to flee into (toward the wall / kerb face) */
  cx: number; cz: number;
  kind: SpotKind;
  w: number;
}

export interface Lamp { x: number; y: number; z: number }

export class Spots {
  readonly list: Spot[] = [];
  readonly drains: Spot[] = [];
  readonly trash: Spot[] = [];
  readonly lamps: Lamp[] = [];
  /** butcher meat table centre + other fly magnets (world points) */
  readonly meat: THREE.Vector3[] = [];

  constructor(private game: Game) {}

  build() {
    const L = this.list;
    const line = (x0: number, z0: number, x1: number, z1: number, y: number, kind: SpotKind, cx: number, cz: number, step = 3.5, skip?: (x: number, z: number) => boolean) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      for (let s = step * 0.5; s < len; s += step) {
        const x = x0 + dx * s, z = z0 + dz * s;
        if (skip?.(x, z)) continue;
        L.push({ x, y, z, dx, dz, cx, cz, kind, w: 1 });
      }
    };
    const soiMouth = (x: number) => x > -6.5 && x < 6.5;
    // kerb bases on the road side (y = road)
    line(SOI.x0 + 0.05, -156, SOI.x0 + 0.05, 5, 0.0, 'kerb', -1, 0);
    line(SOI.x1 - 0.05, -156, SOI.x1 - 0.05, 5, 0.0, 'kerb', 1, 0);
    line(-127, MAIN.z0 + 0.05, 127, MAIN.z0 + 0.05, 0.0, 'kerb', 0, -1, 3.5, (x) => soiMouth(x));
    line(-127, MAIN.z1 - 0.05, 127, MAIN.z1 - 0.05, 0.0, 'kerb', 0, 1);
    line(-127, CROAD.sw0 - 0.05, 127, CROAD.sw0 - 0.05, 0.0, 'kerb', 0, 1, 4, (x) => soiMouth(x));
    // shophouse wall bases on the sidewalk
    line(-5.93, -156, -5.93, -1, SW_H, 'wall', -1, 0, 3.2, (_x, z) => z < -75 && z > -98);
    line(5.93, -156, 5.93, -1, SW_H, 'wall', 1, 0, 3.2, (_x, z) => z < -40 && z > -80);
    line(-127, 0.08, 127, 0.08, SW_H, 'wall', 0, -1, 4, (x) => soiMouth(x) || (x > -66 && x < -22));
    line(-127, MAIN.swS1 - 0.08, 127, MAIN.swS1 - 0.08, SW_H, 'wall', 0, 1, 4);
    line(-127, CROAD.sw1 - 0.08, 127, CROAD.sw1 - 0.08, SW_H, 'wall', 0, 1, 4.5, (x) => soiMouth(x));
    // drains & manholes
    const drains = ((this.game.world as any)?.drains ?? []) as { p: number[]; kind: string }[];
    for (const d of drains) {
      if (!d?.p) continue;
      const s: Spot = { x: d.p[0], y: d.p[1] ?? 0, z: d.p[2], dx: 0, dz: 0, cx: 0, cz: 0, kind: 'drain', w: 3 };
      L.push(s); this.drains.push(s);
    }
    if (!this.drains.length) {
      // fallback: storm-drain inlets along the kerbs every ~14 m
      for (let z = -150; z < 0; z += 14) for (const x of [SOI.x0 + 0.2, SOI.x1 - 0.2]) { const s: Spot = { x, y: 0, z, dx: 0, dz: 0, cx: 0, cz: 0, kind: 'drain', w: 3 }; L.push(s); this.drains.push(s); }
      for (let x = -120; x < 120; x += 16) { const s: Spot = { x, y: 0, z: MAIN.z0 + 0.25, dx: 0, dz: 0, cx: 0, cz: 0, kind: 'drain', w: 3 }; L.push(s); this.drains.push(s); }
    }
    // trash bags / cardboard / cans (props agent placements)
    const rp = realProps();
    const v = new THREE.Vector3();
    if (rp) for (const pl of rp.placements) {
      if (pl.id !== 'trashbag' && pl.id !== 'cardboard' && pl.id !== 'can') continue;
      v.setFromMatrixPosition(pl.m);
      const s: Spot = { x: v.x, y: v.y, z: v.z, dx: 0, dz: 0, cx: 0, cz: 0, kind: 'trash', w: pl.id === 'trashbag' ? 3 : 1.5 };
      L.push(s); this.trash.push(s);
    }
    // fresh market: butcher + floor
    const a = this.game.world?.anchors?.butcher_stall;
    if (a) {
      const yaw = a.yaw ?? 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const mx = a.p[0] + fx * 0.95, mz = a.p[2] + fz * 0.95;
      this.meat.push(new THREE.Vector3(mx, a.p[1] + 0.86, mz));
      for (let i = 0; i < 6; i++) L.push({ x: mx + (i - 2.5) * 0.5, y: MARKET.floor, z: mz - fz * 0.7, dx: 1, dz: 0, cx: fx, cz: fz, kind: 'butcher', w: 3 });
    }
    const au = this.game.world?.anchors?.auntie_stall;
    if (au) {
      const yaw = au.yaw ?? 0;
      this.meat.push(new THREE.Vector3(au.p[0] - Math.sin(yaw) * 0.95, au.p[1] + 0.86, au.p[2] - Math.cos(yaw) * 0.95));
    }
    for (let x = MARKET.x0 + 3; x < MARKET.x1 - 2; x += 6) for (let z = MARKET.z0 + 3; z < MARKET.z1 - 2; z += 7) L.push({ x, y: MARKET.floor, z, dx: 0, dz: 0, cx: 0, cz: 0, kind: 'market', w: 0.7 });
    this.findLamps();
  }

  /** street lamp heads, read from the world's merged light-cone mesh (one cone per lamp) */
  private findLamps() {
    const root = this.game.scene;
    if (!root) return;
    let cones: THREE.Mesh | null = null;
    root.traverse((o: any) => { if (!cones && o.isMesh && o.name === 'light-cones') cones = o; });
    const mesh = cones as THREE.Mesh | null;
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position'), at = mesh.geometry.getAttribute('aT');
    if (!pos || !at) return;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (at.getX(i) < 0.5) { sx += pos.getX(i); sy += pos.getY(i); sz += pos.getZ(i); n++; }
      else if (n) { this.lamps.push({ x: sx / n, y: sy / n, z: sz / n }); sx = sy = sz = 0; n = 0; }
    }
  }

  /** is (x,z) inside a lamp's light pool at night? */
  lit(x: number, z: number, r = 2.4) {
    for (const l of this.lamps) { const dx = l.x - x, dz = l.z - z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }

  /** random spot within [rMin, rMax] of (x,z); weighted by kind */
  sample(x: number, z: number, rMin: number, rMax: number, rnd: () => number, filter?: (s: Spot) => boolean): Spot | null {
    let total = 0;
    const cand = this.cand;
    cand.length = 0;
    const r0 = rMin * rMin, r1 = rMax * rMax;
    for (const s of this.list) {
      const dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz;
      if (d < r0 || d > r1) continue;
      if (filter && !filter(s)) continue;
      cand.push(s); total += s.w;
    }
    if (!cand.length) return null;
    let r = rnd() * total;
    for (const s of cand) { r -= s.w; if (r <= 0) return s; }
    return cand[cand.length - 1];
  }
  private cand: Spot[] = [];

  nearestOf(list: Spot[], x: number, z: number, max = 30): Spot | null {
    let best: Spot | null = null, bd = max * max;
    for (const s of list) { const dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = s; } }
    return best;
  }
}
