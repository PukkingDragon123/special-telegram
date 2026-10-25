import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Volumes, WaterVolume } from './volumes';

/**
 * BUOYANCY (host only). hostUpdate scans free item bodies against the water volumes (30 Hz);
 * physics:pre applies multi-point buoyancy + drag impulses every 60 Hz physics step:
 *   buoyant force per sample = m·g·(ρw/ρ)·submerged fraction / samples  (applied AT the sample → bob & roll)
 *   drag ∝ velocity relative to the current (canal drifts), angular damping while wet.
 * ρ comes from ItemDef.density (if set), else a kind/tag table, else mass / collider volume.
 * Entering water with speed emits 'wt:splash' (all peers draw it).
 */

interface Rec {
  id: number;
  body: RAPIER.RigidBody;
  vol: WaterVolume | null;
  rho: number;
  hx: number; hy: number; hz: number; ball: boolean;
  wet: boolean;
  lastSplash: number;
  sub: number;
}

/** effective density (kg/m³) by kind / tag — items are hollow, porous, shaped… */
const KIND_RHO: Record<string, number> = {
  egg: 1080, egg_tray: 600, wok: 2600, rice_pot: 1900, gas_tank: 1400, mortar: 2200, plate: 2300, bowl: 1700,
  spoon_fork: 4000, chopping_board: 700, cup_plastic: 260, takeaway_box: 120, plastic_bag: 60, recipe_book: 650,
  cardboard: 450, trash_tissue: 300, trash_bag: 700, sponge: 90, lime: 920, garlic: 950, shallot: 980, chili: 700,
  cucumber: 950, tomato: 960, mushroom: 880, basil: 400, morning_glory: 500, pork_minced: 1060, pork_belly: 1050,
  shrimp: 1070, chicken: 1060, rice_bag: 1300, sugar: 1300, water_jug: 990, cooking_oil: 920, fish_sauce: 1150,
  soy_light: 1120, soy_dark: 1150, oyster_sauce: 1200, seasoning_sauce: 1120, soda_cola_can: 1040,
  soda_fanta_can: 1040, soda_fanta_green: 1040, soda_red: 1150, water_bottle: 990, ice_bag: 920,
  stool_red: 320, stool_blue: 320, chair_plastic: 330, table_plastic: 400, umbrella_big: 600, sign: 700,
  water_bucket: 280, water_basin: 900, water_hose: 1100, dog_food: 800, garland: 300, shopping_basket: 300,
};
const TAG_RHO: [string, number][] = [
  ['metal', 3500], ['heavy', 1600], ['clay', 2000], ['egg', 1080], ['meat', 1060], ['ice', 917], ['veg', 900],
  ['herb', 500], ['plastic', 300], ['paper', 500], ['trash', 400], ['wood', 650], ['money', 1600], ['cash', 900],
];

const _wq = { x: 0, y: 0, z: 0, w: 1 };
const _pt = { x: 0, y: 0, z: 0 };
const _imp = { x: 0, y: 0, z: 0 };
const OFFS = [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]];

export class Buoyancy {
  private recs = new Map<number, Rec>();
  private time = 0;
  private scanCb = (e: Ent) => this.scanOne(e);
  private seen = new Set<number>();

  constructor(private game: Game, private vols: Volumes) {}

  private bodyOf(id: number): RAPIER.RigidBody | null {
    const it: any = this.game.items;
    if (typeof it.bodyOf === 'function') return it.bodyOf(id) ?? null;
    const r = it.bodies?.get?.(id);
    return r && !r.fixed ? r.body : null;
  }

  density(e: Ent, mass: number, vol: number): number {
    const def: any = this.game.items.defOf(e);
    if (def?.density) return def.density;
    const k = KIND_RHO[e.k];
    if (k) return k;
    const tags: string[] = def?.tags ?? [];
    for (const [t, r] of TAG_RHO) if (tags.includes(t)) return r;
    if (tags.includes('ingredient')) return 980;
    return Math.max(120, Math.min(3000, mass / Math.max(1e-5, vol)));
  }

  /** HOST 30 Hz: find item bodies near/in water. */
  scan(dt: number) {
    this.time += dt;
    if (!this.vols.list.length) return;
    this.seen.clear();
    this.game.state.each('item', this.scanCb);
    for (const [id, r] of this.recs) if (!this.seen.has(id)) this.release(r);
  }

  private scanOne(e: Ent) {
    if (e.holder != null || e.in != null || !e.p) return;
    const p = e.p;
    let v: WaterVolume | null = null;
    for (const w of this.vols.list) {
      if (w.eid === e.id) continue;               // a bucket is not inside itself
      if (p[1] > w.level + 0.6 || p[1] < w.y0 - 0.4) continue;
      if (!this.vols.inside(w, p[0], p[2])) continue;
      if (w.level - w.y0 < 0.02) continue;
      if (w.dynamic) continue;                    // container items: solid colliders (handled by containers.ts catch)
      if (w.level - w.y0 < 0.25 && (e.k === 'water_bucket' || e.k === 'water_basin')) continue;
      v = w; break;
    }
    if (!v) return;
    let r = this.recs.get(e.id);
    if (!r) {
      const body = this.bodyOf(e.id);
      if (!body) return;
      const c = body.collider(0);
      if (!c) return;
      let hx = 0.08, hy = 0.08, hz = 0.08, ball = false, V = 0.004;
      const sh: any = c.shape;
      const T = (this.game.physics.R as any).ShapeType;
      try {
        if (sh.type === T.Cuboid) { const he = sh.halfExtents; hx = he.x; hy = he.y; hz = he.z; V = 8 * hx * hy * hz; }
        else if (sh.type === T.Cylinder) { hx = hz = sh.radius; hy = sh.halfHeight; V = Math.PI * hx * hx * 2 * hy; }
        else if (sh.type === T.Ball) { hx = hy = hz = sh.radius; ball = true; V = 4.19 * hx * hx * hx; }
        else if (sh.type === T.Capsule) { hx = hz = sh.radius; hy = sh.halfHeight + sh.radius; V = Math.PI * hx * hx * (2 * sh.halfHeight + 1.33 * hx); }
      } catch { /* keep defaults */ }
      r = { id: e.id, body, vol: v, rho: this.density(e, body.mass(), V), hx, hy, hz, ball, wet: false, lastSplash: -9, sub: 0 };
      this.recs.set(e.id, r);
    }
    if (!r.body.isValid?.() && (r.body as any).isValid !== undefined) { this.recs.delete(e.id); return; }
    r.vol = v;
    this.seen.add(e.id);
    // entering the water → splash
    const t = r.body.translation();
    const bottom = t.y - r.hy;
    const wetNow = bottom < this.vols.surface(v, t.x, t.z, this.time) && t.y > v.y0 - 0.2;
    if (wetNow && !r.wet) {
      const lv = r.body.linvel();
      const sp = Math.max(0, -lv.y) + Math.hypot(lv.x, lv.z) * 0.3;
      if (sp > 0.6 && this.time - r.lastSplash > 0.4) {
        r.lastSplash = this.time;
        const m = r.body.mass();
        const s = Math.min(1.5, sp * Math.sqrt(Math.max(0.05, m)) / 7 + 0.04);
        this.game.emit('wt:splash', { p: [round3(t.x), round3(v.level), round3(t.z)], s: round3(s), k: v.kind, sink: r.rho > 1000 ? 1 : 0, id: e.id });
      }
    }
    r.wet = wetNow;
  }

  private release(r: Rec) {
    this.recs.delete(r.id);
  }

  /** every physics step (60 Hz; index.ts forwards physics:pre) */
  apply(dt: number) {
    if (!this.recs.size) return;
    const t = this.time;
    for (const r of this.recs.values()) {
      const v = r.vol;
      if (!v) continue;
      const b = r.body;
      let tr;
      try { tr = b.translation(); } catch { this.recs.delete(r.id); continue; }
      const q = b.rotation();
      // rotation matrix rows (only what we need)
      const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
      const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2, yy = q.y * y2, yz = q.y * z2, zz = q.z * z2, wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
      const m00 = 1 - (yy + zz), m01 = xy - wz, m02 = xz + wy;
      const m10 = xy + wz, m11 = 1 - (xx + zz), m12 = yz - wx;
      const m20 = xz - wy, m21 = yz + wx, m22 = 1 - (xx + yy);
      const hY = Math.abs(m10) * r.hx + Math.abs(m11) * r.hy + Math.abs(m12) * r.hz;
      const mass = b.mass();
      const lift = mass * 9.81 * (1000 / r.rho);
      const n = r.ball ? 1 : 4;
      let subSum = 0;
      for (let i = 0; i < n; i++) {
        let px = tr.x, py = tr.y, pz = tr.z;
        if (!r.ball) {
          const ox = OFFS[i][0] * r.hx, oz = OFFS[i][1] * r.hz;
          px += m00 * ox + m02 * oz; py += m10 * ox + m12 * oz; pz += m20 * ox + m22 * oz;
        }
        const lvl = this.vols.surface(v, px, pz, t);
        const sub = Math.max(0, Math.min(1, (lvl - (py - hY)) / Math.max(0.01, 2 * hY)));
        if (sub <= 0) continue;
        subSum += sub;
        _imp.x = 0; _imp.y = lift * sub / n * dt; _imp.z = 0;
        _pt.x = px; _pt.y = py; _pt.z = pz;
        b.applyImpulseAtPoint(_imp, _pt, true);
      }
      const sub = subSum / n;
      r.sub = sub;
      if (sub <= 0) continue;
      // drag relative to the current
      const lv = b.linvel();
      const rx = lv.x - v.flow[0] * sub, ry = lv.y, rz = lv.z - v.flow[1] * sub;
      const sp = Math.hypot(rx, ry, rz);
      const k = Math.min(0.85, (1.6 + sp * 2.2) * sub * dt);
      _imp.x = -rx * mass * k; _imp.y = -ry * mass * Math.min(0.9, k * 1.7); _imp.z = -rz * mass * k;
      b.applyImpulse(_imp, true);
      const av = b.angvel();
      const ak = 1 - Math.min(0.6, 2.8 * sub * dt);
      _wq.x = av.x * ak; _wq.y = av.y * ak; _wq.z = av.z * ak;
      b.setAngvel(_wq as any, true);
    }
  }

  /** submerged fraction of an item (host; 0 if not tracked) */
  submerged(id: number) { return this.recs.get(id)?.sub ?? 0; }
  trackedCount() { return this.recs.size; }
}

function round3(v: number) { return Math.round(v * 1000) / 1000; }
