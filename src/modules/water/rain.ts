import * as THREE from 'three';
import { ROWS, CLOSED_HOUSE, SW_H, CANAL, MARKET } from '../world/layout';
import type { Droplets, Rings, Stream } from './fx';
import type { RippleField } from './ripples';
import type { Volumes } from './volumes';
import type { Puddles } from './puddles';
import { wsnd, wloop } from './sounds';
import type { SoundHandle } from '../../core/audio';

/**
 * RAIN ON WATER (local, every peer; reads g.rain written by world/weather.ts):
 *  - ring ripples on the canal around the camera, raindrop impulses into the ripple heightfield
 *    (tubs, buckets, drums, puddles all ring), tiny splash droplets on the ground,
 *  - drips off every shophouse canopy edge and the big corrugated awning's gutter (+ two gutter
 *    overflow streams), with splash spots and puddles slowly forming under them.
 */

interface Line { x0: number; z0: number; x1: number; z1: number; y: number; k: number; acc: number }
interface Gush { p: THREE.Vector3; v: THREE.Vector3; snd: SoundHandle | null; acc: number }

const _p = new THREE.Vector3();

export class RainWater {
  private lines: Line[] = [];
  private gush: Gush[] = [];
  private acc = { canal: 0, ground: 0, field: 0 };
  private dripSnd = 0;
  private wet = 0;

  constructor(private ground: (x: number, z: number) => number, private roofed: (x: number, y: number, z: number) => boolean) {
    // canopy lips along every near shophouse row
    for (const row of ROWS) for (const u of row) {
      if (u.far || u.noCanopy || u.noGround) continue;
      if (u.line === CLOSED_HOUSE.x0) continue;          // under the big awning
      const o = 0.93, y = SW_H + 3.5;
      if (u.face === 'E') this.lines.push({ x0: u.line + o, z0: u.a0, x1: u.line + o, z1: u.a1, y, k: 1, acc: 0 });
      else if (u.face === 'W') this.lines.push({ x0: u.line - o, z0: u.a0, x1: u.line - o, z1: u.a1, y, k: 1, acc: 0 });
      else if (u.face === 'N') this.lines.push({ x0: u.a0, z0: u.line - o, x1: u.a1, z1: u.line - o, y, k: 1, acc: 0 });
      else this.lines.push({ x0: u.a0, z0: u.line + o, x1: u.a1, z1: u.line + o, y, k: 1, acc: 0 });
    }
    // the closed shophouse's big awning: gutter along x 7.83, plus overflow at both ends
    const gz0 = CLOSED_HOUSE.z0 + 0.4, gz1 = CLOSED_HOUSE.z1 - 0.4, gx = 7.79, gy = 3.02;
    this.lines.push({ x0: gx, z0: gz0, x1: gx, z1: gz1, y: gy, k: 1.6, acc: 0 });
    this.gush.push({ p: new THREE.Vector3(gx, gy, gz0 + 0.05), v: new THREE.Vector3(-0.35, -0.1, -0.25), snd: null, acc: 0 });
    this.gush.push({ p: new THREE.Vector3(gx, gy, gz1 - 0.05), v: new THREE.Vector3(-0.35, -0.1, 0.25), snd: null, acc: 0 });
  }

  update(dt: number, rain: number, cam: THREE.Vector3, o: { drops: Droplets; rings: Rings; field: RippleField; vols: Volumes; puddles: Puddles; stream: (key: string) => Stream | null; canalLevel: number }) {
    this.wet = Math.max(0, Math.min(1, this.wet + (rain > 0.05 ? dt * rain * 0.05 : -dt * 0.004)));
    if (rain < 0.03) { for (const g of this.gush) if (g.snd) { g.snd.stop(1); g.snd = null; } return; }
    const R = Math.random;
    // ---- canal ring ripples
    if (Math.abs(cam.z - (CANAL.zS + CANAL.zN) / 2) < 22) {
      this.acc.canal += dt * rain * 55;
      while (this.acc.canal >= 1) {
        this.acc.canal--;
        const x = cam.x + (R() - 0.5) * 30, z = CANAL.zN + 0.3 + R() * (CANAL.zS - CANAL.zN - 0.6);
        o.rings.spawn(x, o.canalLevel, z, 0.12 + R() * 0.22, 0.6 + R() * 0.4, 0.7 + R() * 0.5);
        if (o.field.covers(x, z)) o.field.drop(x, z, 0.5, 0.05);
      }
    }
    // ---- heightfield raindrops (every local water surface rings)
    this.acc.field += dt * rain * 140;
    const f = o.field;
    while (this.acc.field >= 1) {
      this.acc.field--;
      f.drop(f.ox + R() * f.span, f.oz + R() * f.span, 0.45 + R() * 0.4, 0.04);
    }
    // ---- splash droplets on open ground
    this.acc.ground += dt * rain * 45;
    while (this.acc.ground >= 1) {
      this.acc.ground--;
      const x = cam.x + (R() - 0.5) * 14, z = cam.z + (R() - 0.5) * 14;
      const y = this.ground(x, z);
      if (y < cam.y - 4 || this.inMarket(x, z) || this.roofed(x, y, z)) continue;
      for (let k = 0; k < 2; k++) o.drops.spawn(x, y + 0.01, z, (R() - 0.5) * 0.8, 0.6 + R() * 0.7, (R() - 0.5) * 0.8, 0.0035 + R() * 0.002, y, 3, 0.6);
    }
    // ---- canopy & gutter drips
    for (const L of this.lines) {
      const d = segDist(cam.x, cam.z, L);
      if (d > 13) continue;
      const len = Math.hypot(L.x1 - L.x0, L.z1 - L.z0);
      L.acc += dt * rain * len * 1.3 * L.k;
      while (L.acc >= 1) {
        L.acc--;
        const t = R();
        const x = L.x0 + (L.x1 - L.x0) * t, z = L.z0 + (L.z1 - L.z0) * t;
        if (Math.hypot(x - cam.x, z - cam.z) > 14) continue;
        const gy = this.ground(x, z);
        o.drops.spawn(x, L.y, z, 0, -0.4, 0, 0.0065 + R() * 0.003, gy, 2, 2.5);
      }
    }
    // ---- gutter overflow streams
    for (let i = 0; i < this.gush.length; i++) {
      const g = this.gush[i];
      const near = g.p.distanceTo(cam) < 22;
      if (!near || rain < 0.2) { if (g.snd) { g.snd.stop(0.8); g.snd = null; } continue; }
      const s = o.stream('gush' + i);
      if (!s) continue;
      const gy = this.ground(g.p.x - 0.4, g.p.z);
      _p.copy(g.v).multiplyScalar(0.6 + rain * 0.6);
      s.set(g.p, _p, gy, 0.022 + rain * 0.02, 0.05 + rain * 0.04, cam, 0.15);
      const e = s.end;
      g.acc += dt;
      if (g.acc > 0.05) {
        g.acc = 0;
        for (let k = 0; k < 3; k++) o.drops.spawn(e.x, e.y + 0.01, e.z, (R() - 0.5) * 1.6, 0.8 + R() * 1.4, (R() - 0.5) * 1.6, 0.005 + R() * 0.005, e.y, 0, 1);
        if (f.covers(e.x, e.z)) f.drop(e.x, e.z, 1.4, 0.1);
        if (R() < 0.25) o.rings.spawn(e.x, e.y, e.z, 0.35 + R() * 0.3, 0.8, 0.8);
        o.puddles.add(e.x, e.y, e.z, 0.02 * rain, 'drip');
      }
      if (!g.snd) g.snd = wloop('wt_trickle_loop', e, { vol: 0.5 });
      g.snd.setVolume?.(0.3 + rain * 0.5);
    }
  }

  /** a drip landed (called by the droplet sim): ring, ripple, tiny puddle, occasional plink */
  dripLanded(x: number, y: number, z: number, o: { rings: Rings; field: RippleField; puddles: Puddles }, cam: THREE.Vector3) {
    if (o.field.covers(x, z)) o.field.drop(x, z, 0.9, 0.05);
    if (Math.random() < 0.3) o.rings.spawn(x, y, z, 0.16 + Math.random() * 0.12, 0.7, 0.7);
    o.puddles.add(x, y, z, 0.03, 'drip');
    const now = performance.now();
    if (now - this.dripSnd > 140 && Math.hypot(x - cam.x, z - cam.z) < 7) { this.dripSnd = now; wsnd('wt_drip', [x, y, z], { vol: 0.25 + Math.random() * 0.2, pitch: 0.9 + Math.random() * 0.4 }); }
  }

  private inMarket(x: number, z: number) { return x > MARKET.x0 + 0.5 && x < MARKET.x1 && z > MARKET.z0 && z < MARKET.z1; }

  dispose() { for (const g of this.gush) { g.snd?.stop(0.2); g.snd = null; } }
}

function segDist(px: number, pz: number, L: Line) {
  const dx = L.x1 - L.x0, dz = L.z1 - L.z0;
  const t = Math.max(0, Math.min(1, ((px - L.x0) * dx + (pz - L.z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (L.x0 + dx * t), pz - (L.z0 + dz * t));
}
