import * as THREE from 'three';
import { RNG } from '../../core/rng';
import type { PlaceOpts } from './realprops';
import { ROWS, TEMPLE, CANAL, CROAD, RROAD, LOT, WHOLESALE, OFFICE, groundHeight, type UnitSpec } from './layout';

/* ============================================================================================
 * ROUND 5 FILL PASS ("make the world feel absolutely filled") — a third, independently seeded layer
 * of real CC0 photoscans (Poly Haven, fill5-models.ts) on top of clutter.ts's doorstep + density
 * passes. Everything goes through the same put() (occupancy + keep-out + walking lanes + static-
 * collider probe) as the earlier passes, so nothing lands in a lane, a shop door kept free for
 * gameplay, a road or a wall. Small things ride on top of accepted bigger things with add().
 * Zones: every shophouse frontage (per shop type), main-road vendor corners, the office plaza,
 * the temple forecourt, the canal bank, the vacant lot, the rural road, the wholesale apron.
 * ========================================================================================== */

type Put = (id: string, x: number, z: number, yaw: number, o?: PlaceOpts & { y?: number; probe?: boolean; pad?: number; tag?: string }) => boolean;
type Add = (id: string, x: number, y: number, z: number, yaw: number, o?: PlaceOpts & { tag?: string }) => void;
type Front = (u: UnitSpec) => { at: (a: number, d: number) => [number, number]; out: number; depth: number; along: string };

export interface FillApi {
  put: Put;
  add: Add;
  has: (id: string) => boolean;
  front: Front;
  /** [w,h,d] metres */
  size: (id: string) => [number, number, number];
  treeAt?: (x: number, z: number, id: string) => boolean;
  /** long things (bicycles, carts): a chain of footprint circles along the model's long axis */
  putLong?: (id: string, x: number, z: number, yaw: number, o?: PlaceOpts & { y?: number }) => boolean;
}

const POT_PLANTS = ['fern', 'anthurium', 'calathea', 'sorrel'];
const SMALL_GOODS = ['food_box', 'cans_food', 'oil_tin', 'bleach', 'cleaner_all', 'cleaner_spray', 'thermos'];
const PRODUCE = ['sweet_potato', 'onion_y', 'lemon', 'lime_w', 'ginger'];
const TABLE_TOPS = ['jug_clay', 'metal_jug', 'enamel_pot', 'wood_bowl', 'thermos', 'kettle'];
const THAI_FRUIT = ['durian', 'coconut_g', 'coconut_g', 'lemon', 'lime_w', 'sweet_potato'];
const UMBRELLAS = ['umbrella_w', 'parasol'];
const UMB_COLS = [0xd8382c, 0x2a62b8, 0xf2f0ea, 0x2a8a4a, 0xe8a020];

export function fill5(api: FillApi, seed: string) {
  const { put, add, has, front, size } = api;
  const r = new RNG(seed);
  const top = (id: string) => size(id)[1];
  /** stack a few small things on top of something already accepted at (x,z) */
  const onTop = (base: string, x: number, z: number, yaw: number, ids: string[], n: number, tag: string) => {
    const s = size(base), y = groundHeight(x, z) + s[1] + 0.003;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < n; i++) {
      const id = r.pick(ids);
      if (!has(id)) continue;
      const lx = (r.range(-0.5, 0.5)) * Math.max(0.05, s[0] - 0.15), lz = (r.range(-0.5, 0.5)) * Math.max(0.05, s[2] - 0.15);
      add(id, x + lx * c + lz * sn, y, z - lx * sn + lz * c, r.range(0, 6), { phys: 'none', tag });
    }
  };
  /** a little pile of produce pieces on a crate top (two layers) */
  const pile = (x: number, y: number, z: number, w: number, d: number, yaw: number, id: string, n: number) => {
    if (!has(id)) return;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const ph = size(id)[1] * 0.8;
    for (let i = 0; i < n; i++) {
      const layer = i < n * 0.65 ? 0 : 1;
      const k = layer ? 0.55 : 1;
      const lx = r.range(-0.5, 0.5) * w * k, lz = r.range(-0.5, 0.5) * d * k;
      add(id, x + lx * c + lz * sn, y + layer * ph, z - lx * sn + lz * c, r.range(0, 6), { phys: 'none', rx: r.range(-0.5, 0.5), tag: 'produce' });
    }
  };

  // ================================================================ 1. every shophouse frontage, by type
  for (const row of ROWS) for (const u of row) {
    if (u.name === 'gap' || u.far || u.noGround) continue;
    const f = front(u);
    const W = u.a1 - u.a0;
    if (W < 2.5) continue;
    const A = (t: number) => u.a0 + W * t;
    const ground = u.ground ?? 'open';
    const shop = u.shop ?? (ground === 'gate' || ground === 'half' ? 'residence' : ground === 'shutter' ? 'closed' : 'generic');
    const resid = ground === 'gate' || ground === 'half' || /residence/.test(shop);
    const sideT = r.chance(0.5) ? 0.2 : 0.8;          // this pass works the inner thirds
    const at = (dt: number, d: number) => f.at(A(sideT + dt), d);

    // ---- wall light: a caged bulb / wall lamp / bare socket under every few awnings (on the pier, high)
    if (r.chance(0.45)) {
      const id = r.pick(['wall_lamp2', 'cage_light', 'socket_bulb']);
      if (has(id)) {
        const [x, z] = f.at(A(r.chance(0.5) ? 0.03 : 0.97), id === 'wall_lamp2' ? 0.02 : 0.25);
        const y = groundHeight(x, z) + (id === 'wall_lamp2' ? 2.45 : 2.85);
        add(id, x, y, z, f.out, { tag: 'awning lights' });
      }
    }
    // ---- the electricity meter on the pier at eye height
    if (has('elec_meter') && r.chance(0.35)) {
      const [x, z] = f.at(A(r.chance(0.5) ? 0.035 : 0.965), 0.02);
      add('elec_meter', x, groundHeight(x, z) + 1.05, z, f.out, { tag: 'electric meters' });
    }
    // ---- a fluorescent tube under the awning of open shops (Bangkok: one bare tube per shopfront)
    if (!resid && ground !== 'shutter' && has('tube_light') && r.chance(0.55)) {
      const [x, z] = f.at(A(r.range(0.35, 0.65)), 0.5);
      add('tube_light', x, groundHeight(x, z) + 2.95, z, f.out + Math.PI / 2, { tag: 'tube lights' });
    }
    // ---- a manhole / drain cover in front (sidewalk), occasionally
    if (has('manhole') && r.chance(0.12)) {
      const [x, z] = f.at(A(r.range(0.2, 0.8)), Math.min(f.depth, 1.2) + 0.3);
      put('manhole', x, z, r.range(0, 6), { y: groundHeight(x, z) + 0.004, probe: false, pad: -0.15, tag: 'manholes' });
    }

    if (/eatery|noodle|food|coffee/.test(shop)) {
      // a second eating spot: round chinese stools around a small table, water jug + cups on top
      if (f.depth >= 0.9 && r.chance(0.8)) {
        const tid = r.pick(['side_table', 'table_w1', 'tea_table']);
        const [x, z] = at(0, 0.75);
        const yaw = f.out + r.range(-0.2, 0.2);
        if (put(tid, x, z, yaw, { tag: 'eatery tables', pad: 0.05 })) {
          onTop(tid, x, z, yaw, TABLE_TOPS, r.int(1, 3), 'table tops');
          for (const s2 of [-1, 1]) { const [cx, cz] = at(s2 * 0.12, 0.75); put(r.chance(0.6) ? 'cn_stool' : 'bar_stool', cx, cz, r.range(0, 6), { tag: 'eatery stools' }); }
        }
      }
      if (r.chance(0.5)) { const [x, z] = at(0.12, 0.28); put(r.pick(['enamel_pot', 'brass_pot', 'jug_clay']), x, z, r.range(0, 6), { tag: 'pots by the door' }); }
      if (r.chance(0.4)) { const [x, z] = at(-0.12, 0.25); put('cut_board', x, z, f.out, { rx: -0.25, probe: false, tag: 'chopping boards' }); }
      if (r.chance(0.5)) { const [x, z] = at(0.22 * (sideT < 0.5 ? 1 : -1), 0.25); put(r.pick(['cooler', 'esky', 'foam_cooler']), x, z, f.out + r.range(-0.3, 0.3), { tag: 'ice coolers' }); }
      if (r.chance(0.4)) { const [x, z] = at(-0.2 * (sideT < 0.5 ? 1 : -1), 0.22); put('lpg_scan', x, z, r.range(0, 6), { tag: 'lpg' }); }
      for (let k = 0, n = r.chance(0.5) ? r.int(2, 4) : 0; k < n; k++) { const [x, z] = at(r.range(-0.2, 0.2), r.range(0.3, Math.max(0.35, f.depth))); put('vn_stool', x, z, r.range(0, 6), { tag: 'red stools' }); }
    } else if (/grocery|rice|food/.test(shop)) {
      // wooden produce crates with real veg on top, a tin shelf by the door
      for (let k = 0; k < 2; k++) {
        const [x, z] = at(k * (sideT < 0.5 ? 0.14 : -0.14), 0.32);
        const yaw = f.out + r.range(-0.15, 0.15);
        if (put('crate_wood2', x, z, yaw, { phys: 'static', tag: 'produce crates' })) {
          const s = size('crate_wood2');
          pile(x, groundHeight(x, z) + s[1] - 0.02, z, s[0] * 0.7, s[2] * 0.7, yaw, r.pick(PRODUCE), r.int(8, 14));
        }
      }
      if (r.chance(0.6)) { const [x, z] = at(0.3 * (sideT < 0.5 ? 1 : -1), 0.3); if (put('shelf_frame', x, z, f.out + Math.PI, { tag: 'grocery shelves', pad: 0.05 })) onTop('shelf_frame', x, z, f.out, SMALL_GOODS, r.int(3, 6), 'shelf goods'); }
      if (r.chance(0.5)) { const [x, z] = at(-0.08, 0.4); put('fert_bags', x, z, f.out + Math.PI / 2, { tag: 'bag stacks' }); }
    } else if (/hardware|repair|gas|plastic|kitchen/.test(shop)) {
      const pick = r.int(0, 4);
      const [x, z] = at(0, 0.38);
      if (pick === 0) put('tool_cart', x, z, f.out + r.range(-0.3, 0.3), { tag: 'tool carts' });
      else if (pick === 1) { if (put('tool_chest', x, z, f.out + Math.PI, { tag: 'tool chests' })) onTop('tool_chest', x, z, f.out, ['toolbox', 'spray_paint', 'oil_tin'], r.int(1, 3), 'workbench things'); }
      else if (pick === 2) put('storage_cart', x, z, f.out + Math.PI / 2, { tag: 'storage carts' });
      else put('ladder_wood', x, z, f.out + Math.PI, { rx: -0.2, probe: false, pad: -0.2, tag: 'wooden ladders' });
      if (r.chance(0.6)) { const [bx, bz] = at(0.12 * (sideT < 0.5 ? 1 : -1), 0.22); put(r.pick(['spade', 'sledge']), bx, bz, f.out + Math.PI, { rx: -0.25, probe: false, pad: -0.1, tag: 'leaning tools' }); }
      if (r.chance(0.5)) { const [bx, bz] = at(-0.1, 0.3); put('boots', bx, bz, r.range(0, 6), { tag: 'rubber boots' }); }
      if (r.chance(0.4)) { const [bx, bz] = at(0.2, 0.28); put(r.pick(['bleach', 'cleaner_all', 'spray_paint', 'plunger']), bx, bz, r.range(0, 6), { tag: 'cleaners' }); }
    } else if (/barber/.test(shop)) {
      // street barber: the chair outside, a mirror-side stool, a fan of combs is too small to see
      const [x, z] = at(0, 0.7);
      put('barber_chair', x, z, f.out + Math.PI + r.range(-0.3, 0.3), { tag: 'barber chairs', pad: 0.05 });
    } else if (/massage|salon|gold|pharmacy|clinic|phone/.test(shop)) {
      if (r.chance(0.6)) { const [x, z] = at(0, 0.3); put(r.pick(['pachira', 'calathea', 'anthurium']), x, z, r.range(0, 6), { tag: 'shop plants' }); }
      if (r.chance(0.5)) { const [x, z] = at(0.12, 0.2); put('extinguisher', x, z, f.out, { tag: 'extinguishers' }); }
      if (has('cctv2') && r.chance(0.4)) { const [x, z] = f.at(A(0.04), 0.02); add('cctv2', x, groundHeight(x, z) + 2.6, z, f.out, { tag: 'cctv' }); }
    } else if (resid) {
      // the classic: an old sofa or armchair out front, plants, a jar, the kids' stuff
      if (f.depth >= 0.8 && r.chance(0.3)) {
        const id = r.chance(0.55) ? 'armchair' : 'sofa';
        const [x, z] = at(0, 0.55);
        if (put(id, x, z, f.out + r.range(-0.15, 0.15), { tag: 'old sofas', pad: 0.05 }) && r.chance(0.6)) onTop(id, x, z, f.out, ['pillows'], 1, 'pillows');
      }
      for (let k = 0, n = r.int(1, 3); k < n; k++) { const [x, z] = at(k * 0.07 * (sideT < 0.5 ? 1 : -1), 0.22 + (k % 2) * 0.2); put(r.pick(POT_PLANTS), x, z, r.range(0, 6), { scale: r.range(0.8, 1.2), tag: 'home plants' }); }
      if (r.chance(0.4)) { const [x, z] = at(-0.1, 0.25); put(r.pick(['bucket_wood1', 'bucket_wood2', 'jar_2', 'jar_3']), x, z, r.range(0, 6), { tag: 'jars & buckets' }); }
      if (r.chance(0.35)) { const [x, z] = at(0.15, 0.3); if (put('cn_stool', x, z, r.range(0, 6), { tag: 'door stools' }) && r.chance(0.6)) onTop('cn_stool', x, z, 0, ['thermos', 'kettle', 'alarm_clock'], 1, 'stool things'); }
      if (r.chance(0.18)) { const [x, z] = at(0.05, 0.35); put(r.pick(['football', 'duck', 'boots']), x, z, r.range(0, 6), { tag: 'kids & boots' }); }
      if (r.chance(0.15)) { const [x, z] = at(-0.05, 0.3); put('sprinkler', x, z, r.range(0, 6), { tag: 'garden bits' }); }
      // a bicycle parked along the facade
      if (api.putLong && r.chance(0.3)) { const [x, z] = f.at(A(0.5 + r.range(-0.15, 0.15)), 0.32); api.putLong(r.pick(['bike_city', 'bike_red']), x, z, f.out + Math.PI / 2 + r.range(-0.06, 0.06)); }
      // a song-bird cage on its hook stand by the door (very Thai)
      if (r.chance(0.22)) { const [x, z] = f.at(A(r.chance(0.5) ? 0.12 : 0.88), 0.3); put('birdcage', x, z, r.range(0, 6), { tag: 'bird cages' }); }
      if (r.chance(0.2)) { const [x, z] = at(0.08, 0.3); if (put('plastic_chair', x, z, f.out + r.range(-0.6, 0.6), { tag: 'plastic chairs' }) && r.chance(0.4)) onTop('plastic_chair', x, z, 0, ['helmet', 'helmet2'], 1, 'helmets'); }
    } else {
      // closed / shuttered: the junk pile next to the shutter (old TV, microwave, drawers, barrels, suitcase)
      if (r.chance(0.55)) {
        const pick = r.int(0, 5);
        const [x, z] = at(0, 0.4);
        if (pick === 0) { if (put('drawers', x, z, f.out + Math.PI, { tag: 'junk' })) onTop('drawers', x, z, f.out, ['tv_old', 'microwave', 'kettle'], 1, 'junk'); }
        else if (pick === 1) put('barrels_wood', x, z, r.range(0, 6), { tag: 'wooden barrels' });
        else if (pick === 2) put('wine_barrel', x, z, r.range(0, 6), { tag: 'wooden barrels' });
        else if (pick === 3) { put('suitcase', x, z, r.range(0, 6), { tag: 'junk' }); const [x2, z2] = at(0.1, 0.35); put('tv_old', x2, z2, f.out + r.range(-0.6, 0.6), { tag: 'junk' }); }
        else put('stove_el', x, z, f.out + Math.PI, { tag: 'junk' });
      }
      if (r.chance(0.35)) { const [x, z] = at(-0.12, 0.35); put('fert_bags', x, z, f.out + Math.PI / 2, { tag: 'bag stacks' }); }
      // a wheelie bin out front on the wide sidewalks
      if (f.depth >= 1.2 && r.chance(0.3)) { const [x, z] = f.at(A(0.5), 0.6); put('wheelie', x, z, f.out + r.range(-0.3, 0.3), { tag: 'wheelie bins' }); }
    }
  }

  // ================================================================ 1b. soi kerb strip: the sidewalk edge between the parked bikes (road, |x| 3.05)
  // and the walking lane (|x| 4.6): bins, plants, coolers, gas tanks, stools — what actually lines a Bangkok soi
  const KERB = ['wheelie', 'wheelie', 'fern', 'calathea', 'anthurium', 'crate_wood2', 'lpg_scan', 'cn_stool', 'vn_stool', 'vn_stool', 'foam_cooler', 'bucket_wood2', 'esky', 'jar_3'];
  for (const sx of [-1, 1]) for (let z = -9 - r.range(0, 3); z > -150; z -= r.range(3, 6.5)) {
    const id = r.pick(KERB);
    if (put(id, sx * 3.78 + r.range(-0.04, 0.04), z, r.range(0, 6), { tag: 'soi kerb' }) && id === 'vn_stool' && r.chance(0.5)) put('vn_stool', sx * 3.78, z - 0.55, r.range(0, 6), { tag: 'soi kerb' });
  }

  // ================================================================ 2. main road: coffee carts + vendor corners on the wide north sidewalk
  for (let x = -120; x < 120; x += r.range(8, 15)) {
    if (Math.abs(x) < 10) continue;   // the soi mouth (the overpass stairs are kept out by put())
    const z = 1.6 + r.range(-0.2, 0.3);
    const kind = r.int(0, 6);
    const umbrella = (ux: number, uz: number) => { const id = r.pick(UMBRELLAS); if (has(id)) add(id, ux, groundHeight(ux, uz), uz, r.range(0, 6), { color: r.pick(UMB_COLS), tag: 'umbrellas' }); };
    if (kind >= 3) {
      // a proper street-food setup: stall / cart, umbrella, red stools, an ice cooler and a gas tank
      const sid = r.pick(['cart_sf', 'fruit_stand', 'fruit_stand2', 'fruit_stand2']);
      if (put(sid, x, z, Math.PI + r.range(-0.15, 0.15), { tag: 'street stalls', pad: 0.15 })) {
        if (sid === 'cart_sf' || r.chance(0.4)) umbrella(x + r.range(-0.4, 0.4), z + 0.4);
        if (/fruit/.test(sid)) onTop(sid, x, z, Math.PI, THAI_FRUIT, r.int(6, 12), 'stall fruit');
        for (let k = 0, n = r.int(2, 5); k < n; k++) put('vn_stool', x + r.range(-1.6, 1.6), z + r.range(1.0, 2.0), r.range(0, 6), { tag: 'red stools' });
        put(r.pick(['cooler', 'esky', 'foam_cooler']), x + 1.35, z - 0.2, r.range(0, 6), { tag: 'ice coolers' });
        put('lpg_scan', x - 1.3, z - 0.3, r.range(0, 6), { tag: 'lpg' });
      }
    } else if (kind === 0 && has('coffee_cart')) {
      if (put('coffee_cart', x, z, Math.PI + r.range(-0.2, 0.2), { tag: 'coffee carts', pad: 0.1 })) {
        for (const dx of [-1.3, 1.3]) put('bar_stool', x + dx, z + r.range(-0.2, 0.2), r.range(0, 6), { tag: 'bar stools' });
      }
    } else if (kind === 1) {
      // fruit & veg on wooden crates (sidewalk greengrocer)
      for (let k = 0; k < 3; k++) {
        const cx = x + (k - 1) * 0.72, yaw = r.range(-0.1, 0.1);
        if (put('crate_wood2', cx, z, yaw, { phys: 'static', tag: 'produce crates' })) {
          const s = size('crate_wood2');
          pile(cx, groundHeight(cx, z) + s[1] - 0.02, z, s[0] * 0.7, s[2] * 0.7, yaw, r.pick([...PRODUCE, ...THAI_FRUIT]), r.int(6, 12));
        }
      }
      put('cn_stool', x + 1.5, z + 0.3, r.range(0, 6), { tag: 'vendor stools' });
      umbrella(x, z + 0.25);
    } else {
      // a picnic table under a tree / by the kerb, someone's thermos and enamel pot
      if (put('picnic_table', x, z + 0.2, r.range(-0.15, 0.15) + Math.PI / 2, { tag: 'picnic tables', pad: 0.1 })) onTop('picnic_table', x, z + 0.2, Math.PI / 2, TABLE_TOPS, r.int(1, 3), 'table tops');
    }
  }
  // south sidewalk: crates, barrels and plants along the shop fronts' kerb side
  for (let x = -118; x < 118; x += r.range(10, 18)) {
    const z = 24.9 + r.range(-0.15, 0.15);
    put(r.pick(['fern', 'calathea', 'anthurium', 'crate_mil', 'wine_barrel', 'bucket_wood2', 'wheelie', 'wheelie', 'mailbox']), x, z, r.range(0, 6), { tag: 'south kerb things' });
  }

  // ================================================================ 3. office plaza: coffee kiosk with bar stools, big plants, extinguisher by the lobby
  {
    const zP = OFFICE.z1 + 2.2;
    for (const x of [-60, -50, -38, -30]) put(r.pick(['pachira', 'calathea']), x, zP + r.range(-0.3, 0.3), r.range(0, 6), { scale: r.range(1.1, 1.4), tag: 'plaza plants' });
    if (put('coffee_cart', -55, zP + 1.6, Math.PI / 2, { tag: 'coffee carts', pad: 0.2 })) for (const dz of [-1.1, 1.1]) put('bar_stool', -53.6, zP + 1.6 + dz, r.range(0, 6), { tag: 'bar stools' });
    put('extinguisher', -44.5, OFFICE.z1 + 0.65, Math.PI, { tag: 'extinguishers' });
    // a row along the lobby: big pots, parked bicycles, bins, a smokers' corner with plastic stools
    for (let x = OFFICE.plazaX0 + 3; x < OFFICE.plazaX1 - 2; x += r.range(3.2, 5)) {
      if (Math.abs(x + 44.5) < 3) continue;   // the lobby doors
      const pick = r.int(0, 5), z = OFFICE.z1 + 1.1 + r.range(-0.1, 0.2);
      if (pick === 0 && api.putLong) api.putLong(r.pick(['bike_city', 'bike_red']), x, z, Math.PI / 2 + r.range(-0.08, 0.08));
      else if (pick === 1) put('wheelie', x, z, r.range(-0.3, 0.3), { tag: 'wheelie bins' });
      else if (pick === 2) { put('vn_stool', x, z, r.range(0, 6), { tag: 'red stools' }); put('vn_stool', x + 0.6, z + 0.2, r.range(0, 6), { tag: 'red stools' }); put('foam_cooler', x + 0.3, z + 0.7, r.range(0, 6), { tag: 'ice coolers' }); }
      else put(r.pick(['pachira', 'calathea', 'anthurium']), x, z, r.range(0, 6), { scale: r.range(1.1, 1.4), tag: 'plaza plants' });
    }
    put('dining_table', -34, zP + 1.8, 0, { tag: 'plaza tables' }) && onTop('dining_table', -34, zP + 1.8, 0, ['metal_jug', 'thermos'], 1, 'table tops');
  }

  // ================================================================ 4. temple forecourt: elephant offerings, brass lanterns, vases, lanterns on posts
  {
    const zF = TEMPLE.forecourtZ + 1.1;   // just inside the forecourt edge
    const gx = TEMPLE.gateX;
    // carved elephants offered in rows beside the gate (scaled up: devotees' elephant statues)
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const x = gx + side * (2.2 + k * 0.45), z = TEMPLE.forecourtZ + 2.2 + (k % 2) * 0.35;
        put('elephant', x, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, { scale: r.range(5.5, 8), tag: 'elephant offerings' });
      }
      put('cat_statue', gx + side * 1.6, TEMPLE.forecourtZ + 1.6, Math.PI, { scale: 1.5, tag: 'temple statues' });
    }
    for (let x = TEMPLE.x0 + 10; x < TEMPLE.x1 - 8; x += r.range(6, 9)) {
      if (Math.abs(x - gx) < 4) continue;
      const pick = r.int(0, 4);
      if (pick === 0) put('diya', x, zF, r.range(0, 6), { scale: 2.5, tag: 'brass lanterns' });
      else if (pick === 1) { put('brass_vase1', x, zF, r.range(0, 6), { scale: 1.8, tag: 'brass vases' }); put('brass_vase2', x + 0.4, zF + 0.15, r.range(0, 6), { scale: 1.6, tag: 'brass vases' }); }
      else if (pick === 2) put('wood_lantern', x, zF, r.range(0, 6), { scale: 1.6, tag: 'wooden lanterns' });
      else put(r.pick(['jar_1', 'jar_4', 'vase_antique']), x, zF, r.range(0, 6), { scale: 1.8, tag: 'temple jars' });
    }
    put('buddha_happy', TEMPLE.x1 - 6, TEMPLE.forecourtZ + 2.0, Math.PI, { tag: 'temple statues' });
    if (api.treeAt) for (const x of [TEMPLE.x0 + 8, TEMPLE.x0 + 30, TEMPLE.x1 - 14]) api.treeAt(x, TEMPLE.forecourtZ + 0.9, 'palm');
    // garland & flower stalls by the gate (umbrella, stools), big plants along the temple wall
    for (const sx of [-1, 1]) {
      const x = gx + sx * 7, z = TEMPLE.forecourtZ + 2.6;
      if (put('fruit_stand2', x, z, Math.PI, { tag: 'flower stalls', pad: 0.1 })) {
        onTop('fruit_stand2', x, z, Math.PI, ['brass_vase1', 'brass_vase2', 'jar_1'], r.int(3, 6), 'stall vases');
        const id = r.pick(UMBRELLAS); if (has(id)) add(id, x + 0.6, groundHeight(x, z), z + 0.9, r.range(0, 6), { color: r.pick(UMB_COLS), tag: 'umbrellas' });
        for (let k = 0; k < 2; k++) put('vn_stool', x + r.range(-1.2, 1.2), z + 1.4 + r.range(0, 0.4), r.range(0, 6), { tag: 'red stools' });
      }
    }
    for (let x = TEMPLE.x0 + 6; x < TEMPLE.x1 - 4; x += r.range(5, 8)) if (Math.abs(x - gx) > 3.5) put(r.pick(['pachira', 'calathea', 'jar_4']), x, TEMPLE.forecourtZ + 3.3, r.range(0, 6), { scale: r.range(1.2, 1.6), tag: 'temple wall plants' });
  }

  // ================================================================ 5. canal bank (between the canal road and the water): fishermen's things
  {
    const zB = (CROAD.z0 + CANAL.zS) / 2;   // the grass/concrete bank strip
    for (let x = -120; x < 120; x += r.range(7, 13)) {
      if (Math.abs(x) < 5) continue;   // the bridge
      const pick = r.int(0, 6);
      if (pick === 0) put('buoy', x, zB, r.range(0, 6), { tag: 'buoys' });
      else if (pick === 1) { if (put('cn_stool', x, zB, r.range(0, 6), { tag: 'fishing stools' })) onTop('cn_stool', x, zB, 0, ['fisher_hat', 'thermos'], 1, 'fisher things'); put('bucket_wood1', x + 0.5, zB + 0.1, r.range(0, 6), { tag: 'fishing buckets' }); }
      else if (pick === 2) put('life_jacket', x, zB, r.range(0, 6), { tag: 'life jackets' });
      else if (pick === 3) put('barrels_wood', x, zB, r.range(0, 6), { tag: 'wooden barrels' });
      else if (pick === 4) put(r.pick(['fern', 'sorrel', 'stump']), x, zB, r.range(0, 6), { scale: r.range(0.9, 1.3), tag: 'bank greenery' });
      else put('boots', x, zB, r.range(0, 6), { tag: 'rubber boots' });
    }
    if (api.treeAt) for (let x = -105; x < 105; x += r.range(24, 36)) if (Math.abs(x) > 8) api.treeAt(x, zB - 0.2, 'palm');
    // lifebuoys hung on the road side of the canal railing (canal.ts: pipes at zS + 0.12, rails at 0.55 / 1.0 m)
    for (let x = -110; x < 110; x += r.range(20, 30)) { if (Math.abs(x) < 6 || !has('lifebuoy')) continue; add('lifebuoy', x, 0.42, CANAL.zS + 0.2, 0, { tag: 'lifebuoys' }); }
  }

  // ================================================================ 6. vacant lot: the junk heap around the edges (homeless camp stays clear: put() keeps out)
  {
    const junk = ['sofa', 'armchair', 'tv_old', 'microwave', 'drawers', 'suitcase', 'barrels_wood', 'wine_barrel', 'crate_mil', 'fert_bags', 'stove_el', 'stump', 'seed_tray'];
    for (let k = 0; k < 26; k++) {
      const e = r.int(0, 3);
      const x = e === 0 ? LOT.x0 + 0.8 + r.range(0, 1.2) : e === 1 ? r.range(LOT.x0 + 1, LOT.x1 - 1.5) : r.range(LOT.x0 + 1, LOT.x1 - 1.5);
      const z = e === 0 ? r.range(LOT.z0 + 1, LOT.z1 - 1) : e === 1 ? LOT.z0 + 0.8 + r.range(0, 1.2) : LOT.z1 - 0.9 - r.range(0, 1.2);
      put(r.pick(junk), x, z, r.range(0, 6), { rz: r.chance(0.25) ? r.range(-0.3, 0.3) : 0, tag: 'lot junk' });
    }
    put('dumpster', LOT.x1 - 1.4, LOT.z1 - 1.2, Math.PI / 2, { tag: 'dumpsters' });
    for (let k = 0; k < 10; k++) put(r.pick(['fern', 'sorrel', 'shrub']), r.range(LOT.x0 + 1, LOT.x1 - 1), r.range(LOT.z0 + 1, LOT.z1 - 1), r.range(0, 6), { scale: r.range(0.9, 1.5), tag: 'lot weeds' });
  }

  // ================================================================ 7. rural road: farm things along both verges
  for (let z = RROAD.zS - 6; z > RROAD.zN + 4; z -= r.range(5, 9)) {
    for (const sx of [-1, 1]) {
      if (!r.chance(0.7)) continue;
      const x = sx * r.range(RROAD.x1 + 1.3, RROAD.x1 + 3.2);
      const pick = r.int(0, 8);
      if (pick === 0) put('fert_bags', x, z, r.range(0, 6), { tag: 'farm bags' });
      else if (pick === 1) put('barrels_wood', x, z, r.range(0, 6), { tag: 'farm barrels' });
      else if (pick === 2) { put('seed_tray', x, z, r.range(0, 6), { tag: 'seed trays' }); put('seed_tray', x + 0.45, z + 0.1, r.range(0, 6), { tag: 'seed trays' }); }
      else if (pick === 3) put('stump', x, z, r.range(0, 6), { tag: 'stumps' });
      else if (pick === 4) put('spade', x, z, r.range(0, 6), { rx: -1.45, probe: false, tag: 'farm tools' });
      else if (pick === 5) put('bucket_wood2', x, z, r.range(0, 6), { tag: 'farm buckets' });
      else if (pick === 6 && has('bamboo_basket')) { put('bamboo_basket', x, z, r.range(0, 6), { tag: 'bamboo baskets' }); }
      else put(r.pick(['fern', 'sorrel', 'pachira']), x, z, r.range(0, 6), { scale: r.range(1, 1.6), tag: 'roadside plants' });
      if (api.treeAt && r.chance(0.12)) api.treeAt(sx * r.range(RROAD.x1 + 4, RROAD.x1 + 7), z + r.range(-2, 2), 'palm');
    }
  }

  // ================================================================ 8. wholesale apron (between the main-road sidewalk and the warehouse face)
  {
    const zA = WHOLESALE.z0 - 2.9;   // the corrugated cladding sits ~1.4 m in front of the layout box face
    for (let x = WHOLESALE.x0 + 14; x < WHOLESALE.x1 - 2; x += r.range(3.5, 6)) {
      const pick = r.int(0, 5);
      if (pick === 0) { if (put('crate_mil', x, zA, r.range(-0.1, 0.1), { tag: 'apron crates' })) add('crate_mil', x, groundHeight(x, zA) + size('crate_mil')[1], zA, r.range(-0.15, 0.15), { phys: 'none', tag: 'apron crates' }); }
      else if (pick === 1) put('storage_cart', x, zA, r.range(0, 6), { tag: 'storage carts' });
      else if (pick === 2) put('fert_bags', x, zA, r.range(0, 6), { tag: 'apron bags' });
      else if (pick === 3) put('barrels_wood', x, zA, r.range(0, 6), { tag: 'apron barrels' });
      else put('crate_wood2', x, zA, r.range(0, 6), { tag: 'apron crates' });
    }
    put('extinguisher', WHOLESALE.doorX + 3.2, WHOLESALE.z0 - 1.9, Math.PI, { tag: 'extinguishers' });
    put('dumpster', WHOLESALE.x1 - 3, WHOLESALE.z0 - 2.9, 0, { tag: 'dumpsters' });
    for (const dx of [-1.2, -2.1]) put('wheelie', WHOLESALE.x1 - 3 + dx - 1.2, WHOLESALE.z0 - 2.6, r.range(-0.3, 0.3), { tag: 'wheelie bins' });
  }
  void THREE;
}
