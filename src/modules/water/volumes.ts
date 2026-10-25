/**
 * WATER VOLUMES — every body of water the world knows about. Static ones (canal, drums, jars,
 * tubs, basins, the wash-corner basin) are registered when the world is built; dynamic ones
 * follow an item entity (bucket / basin / wash tub) and are refreshed every host tick.
 *
 * A volume is an upright box or cylinder: footprint (x,z + half extents or radius), floor y0 and
 * a surface `level` (world y). The canal has a current (`flow`) and small waves.
 */
export type VolKind = 'canal' | 'drum' | 'jar' | 'tub' | 'icetub' | 'basin' | 'bucket' | 'sink' | 'puddle' | 'washtub';

export interface WaterVolume {
  id: number;
  kind: VolKind;
  shape: 'box' | 'cyl';
  x: number; z: number;
  hx: number; hz: number;
  r: number;
  y0: number;
  level: number;
  /** current, m/s */
  flow: [number, number];
  /** wave amplitude, m */
  waves: number;
  /** dynamic volume following this item entity */
  eid?: number;
  /** has a small local surface that uses the ripple heightfield */
  local: boolean;
  /** murkiness 0..1 (visual) */
  murk: number;
  dynamic?: boolean;
}

let nextId = 1;

export class Volumes {
  readonly list: WaterVolume[] = [];

  add(v: Partial<WaterVolume> & { kind: VolKind; x: number; z: number; y0: number; level: number }): WaterVolume {
    const full: WaterVolume = {
      id: nextId++, shape: 'cyl', hx: 0, hz: 0, r: 0.3, flow: [0, 0], waves: 0, local: true, murk: 0.2, ...v,
    } as WaterVolume;
    this.list.push(full);
    return full;
  }

  remove(v: WaterVolume) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); }

  clear() { this.list.length = 0; }

  inside(v: WaterVolume, x: number, z: number, pad = 0): boolean {
    if (v.shape === 'box') return Math.abs(x - v.x) <= v.hx + pad && Math.abs(z - v.z) <= v.hz + pad;
    const dx = x - v.x, dz = z - v.z, r = v.r + pad;
    return dx * dx + dz * dz <= r * r;
  }

  /** wavy surface height at x,z (time t seconds) */
  surface(v: WaterVolume, x: number, z: number, t: number): number {
    if (!v.waves) return v.level;
    return v.level + v.waves * (Math.sin(x * 1.31 + t * 1.7) * 0.55 + Math.sin(z * 1.87 - t * 1.23 + x * 0.4) * 0.3 + Math.sin((x + z) * 3.1 + t * 2.9) * 0.15);
  }

  /** the volume containing a point (y between floor and surface + above) */
  at(x: number, y: number, z: number, above = 0.02): WaterVolume | null {
    let best: WaterVolume | null = null;
    for (const v of this.list) {
      if (v.level - v.y0 < 0.005) continue;
      if (y < v.y0 - 0.1 || y > v.level + above) continue;
      if (!this.inside(v, x, z)) continue;
      if (!best || v.level > best.level) best = v;
    }
    return best;
  }

  /** water surface under/around x,z within a vertical window (for splashes & wading) */
  surfaceAt(x: number, z: number, yMin: number, yMax: number): WaterVolume | null {
    for (const v of this.list) if (v.level >= yMin && v.level <= yMax && v.level - v.y0 > 0.005 && this.inside(v, x, z)) return v;
    return null;
  }
}
