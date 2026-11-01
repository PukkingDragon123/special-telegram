import * as THREE from 'three';
import { RNG } from '../../core/rng';
import type { Game } from '../../game/game';
import type { AnchorPt } from '../../game/contracts';
import { MAP_BOUNDS } from '../../game/mapplan';
import { G, groups } from '../../sim/physics';
import { MODELS, type RealProps, type PlaceOpts } from './realprops';
import { libEntry } from './lib';
import { PLASTIC_COLORS } from './props';
import { ROWS, MARKET, ZEBRAS, OFFICE, CROAD, TEMPLE, POLES_MAIN_N, POLES_MAIN_S, groundHeight, type UnitSpec } from './layout';

/**
 * CLUTTER PASS (assets agent, docs/ART_STYLE.md §5) — the lived-in layer of shared-library models on top of the props
 * agent's dressing: every shophouse doorstep gets what a Bangkok soi has in front of it (flip-flops at the door, a โอ่ง
 * jar and a coiled hose, pots of plants, bottle crates and stool stacks at eateries, rice sacks and basket stacks at
 * groceries, sign boards leaning on shutters, laundry racks, trash bags), scooters park in rows along the soi edge and
 * the main-road kerb, a tuk-tuk waits at the soi mouth, the office plaza at the soi entrance has its spirit house, and
 * the two side alleys are packed with drums, crates and laundry.
 *
 * Seeded and deterministic (same on every peer). Never overlaps earlier dressing: every RealProps placement already
 * registered is claimed first (`real.claim`), each candidate must be `real.free()` and must not touch a static collider
 * (Rapier probe: walls, stalls, the props agent's bike rows). Keeps clear of the market shed, the cart / tables area,
 * every mapplan anchor, the zebra crossings and the nav walking lanes. Physics and distance culling come from the
 * catalog via the RealProps instancer (`lib:<id>`).
 */

const SEED = 'clutter-2026-11';
const BIKES = ['scooter_wave', 'scooter_cub', 'scooter_wave'];
const BEERS = ['bottle_beer_chang', 'bottle_beer_singha', 'bottle_beer_leo'];
const SMALL_POTS = ['plant_aloe', 'pot_clay', 'plant_aloe'];
const CRATE_COLS = [0xc0302a, 0x2a62b8, 0x2a8a4a, 0xe0b020, 0x1f4f9a];
const DRUM_COLS = [0x2a5ab0, 0x1f4f9a, 0x2a7a3a, 0x3a6ac0];
/** footprint radius of non-library RealProps ids already placed by the props agent */
const OTHER_R: Record<string, number> = {
  scooter: 0.95, food_cart: 1.1, thai_table: 0.45, steel_table: 0.45, monobloc: 0.35, drum: 0.32, drum_red: 0.3, hand_truck: 0.4,
  utility_box: 0.45, hydrant: 0.35, tyre: 0.32, tyre_up: 0.32, plant_taro: 0.35, pot_ceramic: 0.32, cement: 0.36, wood_crate: 0.42,
};
/** sizes [w,h,d] of the RealProps ids this pass uses (library ids read the catalog) */
const OTHER_SIZE: Record<string, [number, number, number]> = {
  crate: [0.506, 0.254, 0.406], drum: [0.634, 0.93, 0.639], bucket: [0.32, 0.3, 0.32], trashbag: [0.53, 0.58, 0.46], cardboard: [0.39, 0.34, 0.52],
  broom: [0.42, 1.2, 0.3], broom_wood: [0.49, 1.45, 0.2], plant_aloe: [0.17, 0.27, 0.19], pot_clay: [0.27, 0.22, 0.26], plant_taro: [0.7, 0.84, 0.66],
  jerrycan: [0.27, 0.32, 0.34], thai_stool: [0.37, 0.45, 0.37], tyre: [0.6, 0.165, 0.6],
};

interface Stats { placed: number; tries: number; kinds: Record<string, number> }

const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export function buildClutter(game: Game, real: RealProps, anchors: Record<string, AnchorPt>): Stats {
  const rng = new RNG(SEED);
  const stats: Stats = { placed: 0, tries: 0, kinds: {} };
  // RealProps ids first (same batch as the props agent's copies of a model), else the library id
  const pid = (id: string) => (MODELS[id] ? id : MODELS['lib:' + id] ? 'lib:' + id : null);
  const sizeOf = (id: string): [number, number, number] => libEntry(id)?.size_m ?? OTHER_SIZE[id] ?? [0.4, 0.4, 0.4];

  // ---------------------------------------------------------------- occupancy: everything placed before me
  for (const p of real.placements) {
    const e = p.m.elements;
    let r = OTHER_R[p.id] ?? 0.22;
    if (p.id.startsWith('lib:')) { const s = sizeOf(p.id.slice(4)); r = Math.max(s[0], s[2]) * 0.5; }
    real.claim(e[12], e[14], r * 0.9);
  }

  // ---------------------------------------------------------------- keep-out
  const keep: [number, number, number][] = [];
  for (const [n, a] of Object.entries(anchors)) {
    let r = 1.6;
    if (/_shop$|_stall$|^convenience|^wholesale/.test(n)) r = 3.0;
    else if (n === 'tables_area') r = (a.r ?? 3.6) + 0.8;
    else if (n === 'cart_start' || n === 'item_respawn') r = 3.0;
    else if (a.r) r = a.r + 0.5;
    else if (/_spot$|bus_stop|moto_taxi|temple_gate|canal_bridge/.test(n)) r = 2.6;
    keep.push([a.p[0], a.p[2], r]);
  }
  const cz = (CROAD.sw0 + CROAD.sw1) / 2;
  const blocked = (x: number, z: number, r: number) => {
    if (x < MAP_BOUNDS.minX + 3 || x > MAP_BOUNDS.maxX - 3 || z < MAP_BOUNDS.minZ + 3 || z > MAP_BOUNDS.maxZ - 3) return true;
    if (x > MARKET.x0 - 0.3 - r && x < MARKET.x1 + 0.3 + r && z > MARKET.z0 - 0.3 - r && z < MARKET.z1 + 0.3 + r) return true;
    for (const [kx, kz, kr] of keep) if (Math.hypot(x - kx, z - kz) < kr + r) return true;
    for (const zb of ZEBRAS) {
      if (zb.axis === 'z') { if (Math.abs(x) < 6.5 && Math.abs(z - zb.at) < zb.w / 2 + 1.0 + r) return true; }
      else if (z > -1 && z < 27 && Math.abs(x - zb.at) < zb.w / 2 + 1.0 + r) return true;
    }
    // nav walking lanes (src/modules/world/nav.ts): soi ±4.75, main road z 3 / 24, office plaza z -4.5, canal sidewalk
    if (z > -157.5 && z < 2 && Math.abs(Math.abs(x) - 4.75) < 0.5 + r) return true;
    if (Math.abs(x) > 3 && Math.abs(z - 3.0) < 0.65 + r) return true;
    if (Math.abs(z - 24.0) < 0.65 + r) return true;
    if (x > OFFICE.plazaX0 && x < OFFICE.plazaX1 + 1 && Math.abs(z + 4.5) < 0.6 + r) return true;
    if (Math.abs(z - cz) < 0.5 + r && Math.abs(x) > 3) return true;
    if (x > -48 && x < -38 && z > -1 && z < 27) return true;   // overpass stairs
    return false;
  };

  // ---------------------------------------------------------------- static-collider probe (walls, stalls, bike rows)
  const phys = game.physics;
  try { phys?.world.updateSceneQueries(); } catch { /* older rapier: queries update on step */ }
  const hitsStatic = (x: number, y: number, z: number, yaw: number, w: number, d: number, h: number) => {
    if (!phys) return false;
    const hh = Math.max(0.03, Math.min(h, 1.0) / 2 - 0.04);
    const probe = new phys.R.Cuboid(Math.max(0.02, w / 2 - 0.03), hh, Math.max(0.02, d / 2 - 0.03));
    _q.setFromAxisAngle(_up, yaw);
    return !!phys.world.intersectionWithShape({ x, y: y + 0.07 + hh, z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, probe, undefined, groups(G.ALL, G.STATIC));
  };

  /** try to place one model: free + not blocked + no static hit → add + claim. Returns false when skipped. */
  const put = (id: string, x: number, z: number, yaw: number, o: PlaceOpts & { y?: number; probe?: boolean; pad?: number; tag?: string } = {}) => {
    const p = pid(id);
    if (!p) return false;
    stats.tries++;
    const s = sizeOf(id), sc = o.scale ?? 1;
    const r = Math.max(0.08, Math.max(s[0], s[2]) * 0.5 * sc * 0.85) + (o.pad ?? 0);
    if (blocked(x, z, r) || !real.free(x, z, r)) return false;
    const y = o.y ?? groundHeight(x, z);
    if (o.probe !== false && hitsStatic(x, y, z, yaw, s[0] * sc, s[2] * sc, s[1] * sc)) return false;
    real.add(p, x, y, z, yaw, o);
    real.claim(x, z, r);
    stats.placed++;
    const k = o.tag ?? id;
    stats.kinds[k] = (stats.kinds[k] ?? 0) + 1;
    return true;
  };
  /** stacked / leaning / contained extras on top of something already accepted (no footprint test) */
  const add = (id: string, x: number, y: number, z: number, yaw: number, o: PlaceOpts & { tag?: string } = {}) => {
    const p = pid(id);
    if (!p) return;
    real.add(p, x, y, z, yaw, o);
    stats.placed++;
    const k = o.tag ?? id;
    stats.kinds[k] = (stats.kinds[k] ?? 0) + 1;
  };
  /** long things (scooters, racks): a chain of footprint circles along the local z axis */
  const putLong = (id: string, x: number, z: number, yaw: number, o: PlaceOpts & { y?: number } = {}) => {
    const p = pid(id);
    if (!p) return false;
    stats.tries++;
    const s = sizeOf(id);
    const w = Math.min(s[0], s[2]), L = Math.max(s[0], s[2]);
    const alongZ = s[2] >= s[0];
    const fx = alongZ ? Math.sin(yaw) : Math.cos(yaw), fz = alongZ ? Math.cos(yaw) : -Math.sin(yaw);
    const n = Math.max(2, Math.ceil(L / w));
    const cs: [number, number][] = [];
    for (let i = 0; i < n; i++) { const t = (i / (n - 1) - 0.5) * (L - w); cs.push([x + fx * t, z + fz * t]); }
    const r = w * 0.5;
    for (const [cx, cz2] of cs) if (blocked(cx, cz2, r) || !real.free(cx, cz2, r)) return false;
    const y = o.y ?? groundHeight(x, z);
    if (hitsStatic(x, y, z, yaw, s[0], s[2], s[1])) return false;
    real.add(p, x, y, z, yaw, o);
    for (const [cx, cz2] of cs) real.claim(cx, cz2, r);
    stats.placed++;
    stats.kinds[id] = (stats.kinds[id] ?? 0) + 1;
    return true;
  };

  // ---------------------------------------------------------------- frontage frames
  /** point at distance d out from the facade, a = coordinate along the street; yaw of a model facing the street */
  const front = (u: UnitSpec) => {
    const n: [number, number] = u.face === 'E' ? [1, 0] : u.face === 'W' ? [-1, 0] : u.face === 'S' ? [0, 1] : [0, -1];
    const at = (a: number, d: number): [number, number] => (n[0] !== 0 ? [u.line + n[0] * d, a] : [a, u.line + n[1] * d]);
    const out = Math.atan2(n[0], n[1]);
    // usable sidewalk depth in front of this row (soi 2.5 m; main north 6 m; main south 4 m; canal 2.5 m)
    const depth = u.face === 'S' && u.line === 0 ? 2.2 : u.face === 'N' && u.line === 26 ? 1.25 : 0.62;
    return { at, out, depth, along: n[0] !== 0 ? 'z' : 'x' };
  };

  // ---------------------------------------------------------------- doorsteps of every shophouse
  for (const row of ROWS) for (const u of row) {
    if (u.name === 'gap' || u.far || u.noGround) continue;
    const f = front(u);
    const W = u.a1 - u.a0;
    const A = (t: number) => u.a0 + W * t;
    const ground = u.ground ?? rng.pick(['open', 'gate', 'half', 'shutter', 'open'] as const);
    const shop = u.shop ?? (ground === 'gate' || ground === 'half' ? 'residence' : ground === 'shutter' ? 'closed' : 'generic');
    const side = rng.chance(0.5) ? 0.14 : 0.86;   // the cluttered side of the frontage
    const nearSide = (spread = 0.12) => A(side < 0.5 ? side + rng.range(0, spread) : side - rng.range(0, spread));
    const wallD = (r: number) => r + 0.06 + rng.range(0, 0.05);

    // a cluster of potted plants against the wall on the cluttered side
    const plants = (n: number) => {
      for (let k = 0; k < n; k++) {
        const id = rng.chance(0.25) && f.depth > 1 ? 'plant_taro' : rng.pick(SMALL_POTS);
        const [x, z] = f.at(nearSide(0.1) + (k - n / 2) * 0.32 * (side < 0.5 ? 1 : -1), wallD(0.15) + (k % 2) * 0.22);
        put(id, x, z, rng.range(0, 6), { scale: rng.range(0.85, 1.15), tag: 'potted plants' });
      }
    };
    const sandals = (n: number, t0 = 0.5) => {
      for (let k = 0; k < n; k++) {
        const [x, z] = f.at(A(t0 + rng.range(-0.12, 0.12)), rng.range(0.2, 0.42));
        put('sandals_pair', x, z, f.out + Math.PI + rng.range(-0.7, 0.7), { pad: -0.04 });
      }
    };
    const ong = () => {
      const [x, z] = f.at(nearSide(0.05), wallD(0.32));
      if (put('ong_jar', x, z, rng.range(0, 6), { tag: 'ong jar' })) {
        const [hx, hz] = f.at(nearSide(0.05) + (side < 0.5 ? 0.6 : -0.6), wallD(0.24));
        if (rng.chance(0.55)) put('hose_coil', hx, hz, rng.range(0, 6));
      }
    };
    const leanSign = (id: string, t: number) => {
      const s = sizeOf(id);
      if (!pid(id)) return;
      const lean = 0.14 + rng.range(0, 0.06);
      const [x, z] = f.at(A(t), Math.sin(lean) * s[1] + 0.04);
      put(id, x, z, f.out, { rx: -lean, probe: false, tag: 'sign boards' });
    };
    const leanKradong = (t: number) => {
      const R = sizeOf('kradong')[0] / 2, th = 1.3;
      const [x, z] = f.at(A(t), 0.06 + Math.cos(th) * R);
      put('kradong', x, z, f.out, { rx: th, y: groundHeight(x, z) + Math.sin(th) * R + 0.005, probe: false, tag: 'kradong' });
    };
    const bottleCrates = (t: number) => {
      const [x, z] = f.at(A(t), wallD(0.24));
      const yaw = f.out + rng.range(-0.15, 0.15);
      if (!put('crate', x, z, yaw, { color: rng.pick(CRATE_COLS), phys: 'static', tag: 'bottle crates' })) return;
      const y0 = groundHeight(x, z);
      let top = y0 + 0.254;
      if (rng.chance(0.6)) { add('crate', x, top, z, yaw + rng.range(-0.08, 0.08), { color: rng.pick(CRATE_COLS), phys: 'static', tag: 'bottle crates' }); top += 0.254; }
      // empty beer bottles standing in the top crate (necks show above the rim)
      const beer = rng.pick(BEERS), c = Math.cos(yaw), s = Math.sin(yaw);
      for (let i = 0; i < 6; i++) {
        if (rng.chance(0.2)) continue;
        const lx = (i % 3 - 1) * 0.13, lz = (Math.floor(i / 3) - 0.5) * 0.15;
        add(beer, x + lx * c + lz * s, top - 0.235, z - lx * s + lz * c, rng.range(0, 6), { phys: 'none', tag: 'beer bottles' });
      }
    };
    const stoolStack = (t: number) => {
      const [x, z] = f.at(A(t), wallD(0.19));
      const col = rng.pick(PLASTIC_COLORS);
      if (!put('thai_stool', x, z, rng.range(0, 6), { color: col, phys: 'static', tag: 'stool stacks' })) return;
      const n = rng.int(3, 8), y0 = groundHeight(x, z);
      for (let i = 1; i < n; i++) add('thai_stool', x, y0 + i * 0.068, z, rng.range(-0.25, 0.25), { color: col, phys: 'none', tag: 'stool stacks' });
    };
    const sacks = (t: number) => {
      const [x, z] = f.at(A(t), wallD(0.33));
      const yaw = f.out + Math.PI / 2 + rng.range(-0.2, 0.2);
      if (!put('rice_sack', x, z, yaw, { tag: 'rice sacks' })) return;
      const y0 = groundHeight(x, z);
      for (let i = 1; i < rng.int(1, 4); i++) add('rice_sack', x + rng.range(-0.03, 0.03), y0 + i * 0.16, z + rng.range(-0.03, 0.03), yaw + rng.range(-0.25, 0.25), { tag: 'rice sacks' });
    };
    const baskets = (t: number) => {
      const [x, z] = f.at(A(t), wallD(0.24));
      const col = rng.pick([0x2a62b8, 0xc0302a, 0x2a8a4a, 0xe86a8a]);
      const yaw = f.out + rng.range(-0.2, 0.2);
      if (!put('plastic_basket', x, z, yaw, { color: col, tag: 'basket stacks' })) return;
      const y0 = groundHeight(x, z);
      for (let i = 1; i < rng.int(2, 6); i++) add('plastic_basket', x, y0 + i * 0.075, z, yaw + rng.range(-0.06, 0.06), { color: col, phys: 'none', tag: 'basket stacks' });
    };
    const trash = (t: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const [x, z] = f.at(A(t) + rng.range(-0.4, 0.4), wallD(0.24) + rng.range(0, 0.15));
        put('trashbag', x, z, rng.range(0, 6), { scale: rng.range(0.75, 1.05), tag: 'trash bags' });
      }
    };
    const broomLean = (t: number) => {
      const [x, z] = f.at(A(t), 0.16);
      put(rng.chance(0.5) ? 'broom' : 'broom_wood', x, z, f.out + Math.PI, { rx: -0.22, probe: false, tag: 'brooms' });
    };
    const bucket = (t: number) => { const [x, z] = f.at(A(t), wallD(0.16)); put('bucket', x, z, rng.range(0, 6), { color: rng.pick(PLASTIC_COLORS), tag: 'buckets' }); };
    const laundry = (t: number) => {
      if (f.depth < 0.6) return;
      const [x, z] = f.at(A(t), 0.34 + (f.depth > 1 ? rng.range(0, 0.5) : 0));
      putLong('laundry_rack', x, z, f.out + rng.range(-0.08, 0.08));   // long axis along the facade
    };
    const scooterIn = (t: number) => {
      // main road: nose to the shop, tail toward the kerb (6 m sidewalk only)
      if (f.depth < 2) return;
      const [x, z] = f.at(A(t), 1.12);
      putLong(rng.pick(BIKES), x, z, f.out + Math.PI + rng.range(-0.18, 0.18));
    };

    switch (ground) {
      case 'gate': case 'half': {
        sandals(rng.int(1, 3), 0.5 + rng.range(-0.1, 0.1));
        if (rng.chance(0.6)) ong();
        plants(rng.int(1, 4));
        if (rng.chance(0.3)) laundry(1 - side);
        if (rng.chance(0.35)) broomLean(side < 0.5 ? 0.04 : 0.96);
        if (rng.chance(0.5)) scooterIn(0.5);
        break;
      }
      case 'shutter': case 'closed': {
        if (rng.chance(0.4)) leanSign(rng.pick(['signbox_coffee', 'signbox_chicken_rice', 'signbox_barber']), rng.range(0.3, 0.7));
        if (rng.chance(0.45)) trash(side, rng.int(1, 3));
        if (rng.chance(0.35)) plants(rng.int(1, 2));
        if (rng.chance(0.55)) { scooterIn(0.35); scooterIn(0.65); }
        break;
      }
      case 'eatery': {
        stoolStack(side); if (rng.chance(0.5)) stoolStack(side + (side < 0.5 ? 0.12 : -0.12));
        bottleCrates(1 - side);
        if (rng.chance(0.5)) { const [x, z] = f.at(A(1 - side + (side < 0.5 ? -0.12 : 0.12)), wallD(0.15)); put('lpg_15kg', x, z, rng.range(0, 6), { tag: 'lpg' }); }
        if (rng.chance(0.4)) bucket(side + (side < 0.5 ? 0.2 : -0.2));
        if (rng.chance(0.4)) trash(1 - side, 1);
        break;
      }
      default: {   // open shops
        if (/grocery/.test(shop)) { sacks(side); bottleCrates(1 - side); baskets(side + (side < 0.5 ? 0.17 : -0.17)); if (rng.chance(0.6)) leanKradong(1 - side + (side < 0.5 ? -0.15 : 0.15)); }
        else if (/hardware|plastic|kitchen/.test(shop)) { baskets(side); baskets(side + (side < 0.5 ? 0.15 : -0.15)); bucket(1 - side); if (rng.chance(0.6)) leanKradong(1 - side + (side < 0.5 ? -0.17 : 0.17)); if (rng.chance(0.5)) { const [x, z] = f.at(A(1 - side), wallD(0.24) + 0.3); put('hose_coil', x, z, rng.range(0, 6)); } }
        else if (/laundry/.test(shop)) { laundry(side); baskets(1 - side); bucket(1 - side + (side < 0.5 ? -0.1 : 0.1)); }
        else if (/massage|salon/.test(shop)) { sandals(rng.int(3, 5), side < 0.5 ? 0.3 : 0.7); plants(2); }
        else if (/repair/.test(shop)) { for (let k = 0; k < 2; k++) { const [x, z] = f.at(A(side + (k ? (side < 0.5 ? 0.2 : -0.2) : 0)), wallD(0.17)); put('jerrycan', x, z, rng.range(0, 6), { color: rng.pick([0xc03020, 0x2a62b8, 0xe0b020]), tag: 'jerrycans' }); } bucket(1 - side); scooterIn(0.5); }
        else if (/pharmacy|gold|clinic|phone|coffee|print|barber/.test(shop)) { plants(rng.int(2, 3)); if (rng.chance(0.4)) { const [x, z] = f.at(A(1 - side), wallD(0.3)); put('plant_taro', x, z, rng.range(0, 6), { tag: 'potted plants' }); } }
        else { plants(rng.int(1, 3)); if (rng.chance(0.4)) sandals(1, side); if (rng.chance(0.4)) bucket(1 - side); }
        if (f.depth > 2 && rng.chance(0.5)) scooterIn(rng.chance(0.5) ? 0.2 : 0.8);
      }
    }
  }

  // ---------------------------------------------------------------- scooter rows along the soi edge (road side, parallel)
  // Thailand drives on the left: bikes on the west edge face north, on the east edge face south. Soi traffic lanes are
  // at x ±1.75 (1.4 m wide), so a scooter centred at |x| 3.05 (0.73 m wide) stays clear of them.
  for (const sx of [-1, 1]) {
    let z = -9 - rng.range(0, 4);
    while (z > -147) {
      const n = rng.int(2, 6);
      for (let k = 0; k < n && z > -147; k++) {
        putLong(rng.pick(BIKES), sx * 3.05 + rng.range(-0.06, 0.06), z, (sx < 0 ? Math.PI : 0) + sx * rng.range(0.04, 0.16), { y: 0 });
        z -= 2.0 + rng.range(0, 0.35);
      }
      z -= rng.range(6, 16);
    }
  }
  // ---------------------------------------------------------------- main road north sidewalk: perpendicular rows at the kerb
  for (let x = -124; x < 124;) {
    const n = rng.int(3, 8);
    for (let k = 0; k < n; k++, x += 0.86 + rng.range(0, 0.12)) {
      if (Math.abs(x) < 8 || POLES_MAIN_N.some(([px]) => Math.abs(px - x) < 0.7)) continue;
      putLong(rng.pick(BIKES), x, 4.95, Math.PI + rng.range(-0.15, 0.15));
    }
    x += rng.range(7, 18);
  }
  // main road south sidewalk (4 m, nav at z 24): a few parallel at the kerb
  for (let x = -122; x < 124; x += rng.range(9, 22)) if (!POLES_MAIN_S.some(([px]) => Math.abs(px - x) < 1.5)) putLong(rng.pick(BIKES), x, 22.5, (rng.chance(0.5) ? 1 : -1) * Math.PI / 2 + rng.range(-0.08, 0.08));

  // ---------------------------------------------------------------- tuk-tuks: waiting at the soi mouth, the office plaza, the temple
  putLong('tuktuk', -20, 5.15, -Math.PI / 2 + 0.05);
  putLong('tuktuk', -25.5, -1.4, Math.PI / 2 - 0.05);
  putLong('tuktuk', TEMPLE.gateX + 16, TEMPLE.forecourtZ + 5.6, -Math.PI / 2 + 0.06);

  // ---------------------------------------------------------------- the spirit house at the soi entrance (office plaza corner)
  if (put('spirit_house', -24.0, -7.6, Math.PI / 2, { pad: 0.5 })) {
    for (const [dx, dz] of [[0.75, -0.7], [0.75, 0.7]]) put('plant_taro', -24.0 + dx, -7.6 + dz, rng.range(0, 6), { tag: 'potted plants' });
    for (let i = 0; i < 4; i++) add('bottle_fanta_red', -23.45, groundHeight(-23.45, -7.6), -7.6 - 0.18 + i * 0.12, 0, { phys: 'none', tag: 'red soda offerings' });
  }

  // ---------------------------------------------------------------- side alleys (gaps between rows): drums, crates, laundry
  const alleys: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const row of [ROWS[0], ROWS[2]]) {
    const last = row[row.length - 1];
    const dir = row[0].face === 'E' ? -1 : 1;   // depth direction away from the soi
    const za = Math.min(last.a0, last.a1) - (row === ROWS[0] ? 2.0 : 1.5), zb = Math.min(last.a0, last.a1);
    alleys.push({ x0: Math.min(last.line, last.line + dir * 13), x1: Math.max(last.line, last.line + dir * 13), z0: za, z1: zb });
  }
  for (const al of alleys) {
    const west = al.x1 <= 0;
    const zWall = west ? al.z0 + 0.32 : al.z1 - 0.32;   // west alley: south wall; east alley: north wall (market shed side stays clear)
    for (let k = 0; k < 12; k++) {
      const x = west ? al.x1 - 0.7 - k * 1.05 : al.x0 + 0.7 + k * 1.05;
      if (x < al.x0 + 0.4 || x > al.x1 - 0.4) break;
      const t = rng.int(0, 6);
      const yaw = rng.range(0, 6);
      if (t === 0) put('drum', x, zWall + 0.02, yaw, { color: rng.pick(DRUM_COLS), tag: 'alley drums' });
      else if (t === 1) put('ong_jar', x, zWall + 0.02, yaw, { tag: 'ong jar' });
      else if (t === 2) { if (put('crate', x, zWall, 0.05, { color: rng.pick(CRATE_COLS), tag: 'alley crates' })) for (let i = 1; i < rng.int(2, 4); i++) add('crate', x, groundHeight(x, zWall) + i * 0.254, zWall, rng.range(-0.1, 0.1), { color: rng.pick(CRATE_COLS), tag: 'alley crates' }); }
      else if (t === 3) { put('trashbag', x, zWall, yaw, { tag: 'trash bags' }); put('trashbag', x + 0.35, zWall + 0.1, yaw + 1, { scale: 0.85, tag: 'trash bags' }); }
      else if (t === 4) put('hose_coil', x, zWall, yaw);
      else if (t === 5) put('cardboard', x, zWall, Math.PI / 2 + rng.range(-0.2, 0.2), { tag: 'cardboard' });
      else put('jerrycan', x, zWall, yaw, { color: rng.pick([0xc03020, 0x2a62b8, 0xe0b020]), tag: 'jerrycans' });
    }
    if (west && al.z1 - al.z0 > 1.8) putLong('laundry_rack', (al.x0 + al.x1) / 2, al.z1 - 0.38, 0.03);
  }

  console.info(`[clutter] ${stats.placed} library props placed (${stats.tries} tries)`, stats.kinds);
  (window as any).__clutter = stats;
  return stats;
}
