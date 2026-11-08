import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { text3d } from '../../ui3d/text3d';
import { rbox, tube, merge, mesh, pbr, flat, mat } from '../restaurant/geo';
import { libFit, staffDoor } from './models';
import { FURN_BY_KIND, footprintOf } from './catalog';
import { ROW_SOI_E2, SW_H } from '../world/layout';
import { unitDims } from '../world/shophouse';

/* =============================================================================================
 * เจริญพาณิชย์เฟอร์นิเจอร์ — the furniture store showroom (two merged shophouse units on the east side of the soi,
 * just past the market, facade x = 6, z −90 … −82). The shops module runs the shop (keeper อาแปะเจริญ, stock,
 * paying, haggling, delivery of big pieces); this file swaps its generic stepped-table fixture for a real
 * showroom: terrazzo floor, fluorescent fittings, a lit Thai signboard, furniture vignettes (table + chairs sets),
 * wall pieces on the back wall, ceiling fans / lamps on the ceiling, counter-top pieces on the cashier counter,
 * a 3D price stand at every piece, the keeper behind the counter, colliders that follow the displayed pieces.
 * ============================================================================================= */

export const STORE = { id: 'furniture_store', anchor: { p: [7.2, SW_H, -86] as [number, number, number], yaw: -Math.PI / 2 } };

/** local shop frame (x across the shop, z into it, origin at the anchor 1.2 m inside the facade) */
class Fr {
  o = new THREE.Vector3(); f = new THREE.Vector3(); r = new THREE.Vector3();
  constructor(p: ArrayLike<number>, public yaw: number) { this.o.set(p[0], p[1], p[2]); this.f.set(-Math.sin(yaw), 0, -Math.cos(yaw)); this.r.set(Math.cos(yaw), 0, -Math.sin(yaw)); }
  at(x: number, y: number, z: number) { return this.o.clone().addScaledVector(this.r, x).addScaledVector(this.f, z).add(new THREE.Vector3(0, y, 0)); }
  arr(x: number, y: number, z: number): [number, number, number] { const v = this.at(x, y, z); return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; }
  /** world yaw for an ITEM whose front (+Z) faces the entrance / street */
  get toDoor() { return this.yaw; }
  /** world yaw for a CHARACTER looking out toward the entrance (rigs look along −Z) */
  get personToDoor() { return this.yaw + Math.PI; }
}

interface SlotSpec { stock: string; x: number; z: number; y?: number; face?: number }

/** the showroom layout (local metres: x ∈ [−3.8, 3.8] across, z ∈ [−1, 4.2] from the door to the back wall) */
function layout(ceil: number, bk: Backs): SlotSpec[] {
  // the two merged units can have different depths: the left half's back wall is bk.L, the right half's bk.R
  // (the STAFF ONLY door + counter live in the right half); vignettes fill the middle of the shallower one
  const B = bk.min, L = bk.L, Rb = bk.R, C = Rb - 1.6, M1 = Math.min(2.2, B * 0.34), M2 = Math.max(M1 + 1.6, B * 0.62);
  const cab = Math.max(0.55, bk.step + 0.6);
  return [
    // back wall, floor: fridge, food cabinet, dispenser, shelving, cabinet
    { stock: 'drinks_fridge', x: -3.35, z: L - 0.31 },
    { stock: 'food_cabinet', x: -2.4, z: L - 0.25 },
    { stock: 'water_dispenser', x: -1.6, z: L - 0.2 },
    { stock: 'shelf_steel', x: -0.95, z: L - 0.25 },
    { stock: 'shelf_wood', x: -0.3, z: L - 0.19 },
    { stock: 'cabinet_wood', x: cab, z: Rb - 0.28 },
    // back wall, mounted
    { stock: 'aircon', x: -2.35, z: L - 0.12, y: 2.45 },
    { stock: 'wall_fan', x: -0.95, z: L - 0.22, y: 2.05 },
    { stock: 'wall_clock', x: -0.3, z: L - 0.03, y: 2.15 },
    { stock: 'shrine_shelf', x: cab, z: Rb - 0.17, y: 1.9 },
    { stock: 'menu_lightbox', x: 3.2, z: Rb - 0.05, y: 1.85 },
    // tops: TV on the wooden shelf, register / lucky cats / plants on the counter
    { stock: 'tv_crt', x: -0.3, z: L - 0.2, y: 1.13 },
    // counter (front right) — the keeper sits behind it
    { stock: 'counter_desk', x: 2.85, z: C },
    { stock: 'cash_register', x: 3.25, z: C + 0.05, y: 0.9, face: Math.PI },
    { stock: 'lucky_cat', x: 2.4, z: C - 0.15, y: 0.9 },
    { stock: 'plant_small', x: 2.2, z: C + 0.2, y: 0.9 },
    // ceiling
    { stock: 'ceiling_fan', x: -1.6, z: M1, y: ceil - 0.46 },
    { stock: 'lamp_pendant', x: 0.55, z: M2, y: ceil - 1.0 },
    // vignettes on the floor: round wooden table + wooden chairs, formica table + stools, steel table
    { stock: 'table_round_wood', x: -1.75, z: M1 },
    { stock: 'chair_wood', x: -1.75, z: M1 - 0.7, face: Math.PI },
    { stock: 'chair_wood', x: -1.75, z: M1 + 0.7, face: 0 },
    { stock: 'table_formica', x: 0.55, z: M2 },
    { stock: 'stool_wood', x: 0.3, z: M2 - 0.57 }, { stock: 'stool_wood', x: 0.8, z: M2 - 0.57 },
    { stock: 'stool_metal', x: 0.3, z: M2 + 0.57 }, { stock: 'stool_metal', x: 0.8, z: M2 + 0.57 },
    { stock: 'table_steel', x: 2.6, z: M1 - 0.4 },
    { stock: 'stand_fan', x: -3.35, z: M2, face: Math.PI / 2 },
    // by the door
    { stock: 'chalkboard', x: -3.2, z: -0.65, face: 0 },
    { stock: 'plant_big', x: -2.25, z: -0.7 },
    { stock: 'planter_box', x: 3.1, z: -0.75 },
  ];
}

/** back wall lines (local z) of the two merged units: the world picks the interior depth per unit, so probe the
 *  real walls. L = left half (local x < 0), R = right half (x > 0), step = local x of the return wall between them */
export interface Backs { L: number; R: number; min: number; max: number; step: number }
export function probeBacks(game: Game): Backs {
  const fr = new Fr(STORE.anchor.p, STORE.anchor.yaw);
  const depth = (xs: number[]) => {
    let B = 99;
    for (const x of xs) {
      const h = game.physics?.raycast(fr.at(x, 1.4, 0.3), fr.f.clone(), 12, 1);
      if (h) B = Math.min(B, 0.3 + h.toi);
    }
    return B > 3 && B < 9 ? B : 4.15;
  };
  const L = depth([-3.0, -1.8, -0.6]), R = depth([0.6, 1.8, 3.0]);
  // the return wall between a shallow and a deep half: cast sideways (from the deep half toward the shallow one)
  let step = 0;
  if (Math.abs(L - R) > 0.3) {
    const z = (L + R) / 2, dir = L < R ? -1 : 1;
    const h = game.physics?.raycast(fr.at(dir < 0 ? 2.5 : -2.5, 1.4, z), fr.r.clone().multiplyScalar(dir), 5, 1);
    if (h) step = (dir < 0 ? 2.5 : -2.5) + dir * h.toi;
  }
  return { L, R, min: Math.min(L, R), max: Math.max(L, R), step };
}
/** back wall line on the door's side */
export function probeBack(game: Game): number { const b = probeBacks(game); return DOOR_X < 0 ? b.L : b.R; }

/** the STAFF ONLY door in the back wall (local x) — leads to the backrooms (backrooms module) */
export const DOOR_X = 1.65;
/** world anchor of the back door: on the wall face at floor level; yaw = facing into the shop (anchor convention:
 *  facing direction (−sin yaw, 0, −cos yaw) points from the door toward the shop floor / street) */
export function backdoorAnchor(game: Game, B = probeBack(game)): { p: [number, number, number]; yaw: number } {
  const fr = new Fr(STORE.anchor.p, STORE.anchor.yaw);
  return { p: fr.arr(DOOR_X, 0, B), yaw: fr.yaw + Math.PI };
}

export interface Showroom { backdoor: { p: [number, number, number]; yaw: number }; root: THREE.Group; slots: { stock: string; p: [number, number, number]; yaw: number }[]; keeper: { p: [number, number, number]; yaw: number; sit: boolean }; colliders: any[]; ceil: number }

export function buildShowroom(game: Game): Showroom {
  const fr = new Fr(STORE.anchor.p, STORE.anchor.yaw);
  const unit = ROW_SOI_E2.find((u) => u.name === 'furniture_store')!;
  const dims = unitDims(unit);
  const ceil = Math.min(3.4, dims.h0 - 0.35);      // ceiling over the ground floor (slab underside)
  const bk = probeBacks(game), B = bk.min, Rb = DOOR_X < 0 ? bk.L : bk.R;
  const D = bk.max + 1.15, mid = (bk.max - 1.15) / 2;   // floor / ceiling span from the facade to the deeper back wall
  const root = new THREE.Group(); root.name = 'build:showroom';
  // ---- floor: polished terrazzo with a skirting line
  const floor = mesh(rbox(7.66, 0.012, D, 0.004, 0, 0, 0), pbr('terrazzo_floor', { repeat: 2.2, rough: 0.35 }));
  floor.position.copy(fr.at(0, 0.001, mid)); floor.rotation.y = fr.yaw; floor.receiveShadow = true; floor.castShadow = false;
  root.add(floor);
  // ---- ceiling slab (painted) + fluorescent fittings
  const slab = mesh(rbox(7.7, 0.06, D, 0.01, 0, 0, 0), pbr('plaster_painted_clean', { repeat: 1.5, color: 0xf2efe6 }), false);
  slab.position.copy(fr.at(0, ceil, mid)); slab.rotation.y = fr.yaw;
  root.add(slab);
  const tubeGlow = mat('fluoroTube', () => new THREE.MeshStandardMaterial({ color: 0xf6fbff, emissive: 0xeef6ff, emissiveIntensity: 2.2, roughness: 0.3 }));
  for (const [x, z] of [[-2.2, 0.6], [0.4, 0.6], [2.6, 0.6], [-2.2, B * 0.5], [0.4, B * 0.5], [2.6, B * 0.5], [-2.2, bk.L - 0.8], [0.4, bk.R - 0.8], [2.6, bk.R - 0.8]]) {
    const fit = new THREE.Group();
    fit.add(mesh(rbox(1.24, 0.05, 0.13, 0.012, 0, -0.05, 0), pbr('aluminium_scratched', { repeat: 1 }), false));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.18, 10).rotateZ(Math.PI / 2).translate(0, -0.075, 0), tubeGlow);
    fit.add(t);
    fit.position.copy(fr.at(x, ceil, z)); fit.rotation.y = fr.yaw;
    root.add(fit);
  }
  // ---- red signboard with extruded yellow Thai lettering over the opening (lit at night)
  const signY = Math.min(dims.h0 + 0.15, 4.2);
  const board = mesh(rbox(5.6, 0.9, 0.09, 0.03, 0, 0, 0), pbr('metal_painted_chipped', { repeat: 1, color: 0xb81c1c }));
  board.position.copy(fr.at(0, signY, -1.38)); board.rotation.y = fr.yaw;
  root.add(board);
  const title = text3d('เจริญพาณิชย์ เฟอร์นิเจอร์', { font: 'display', size: 0.3, color: 0xffd23a, side: 0x7a4a08, emissive: 0.35, align: 'center', depth: 0.25, castShadow: true });
  title.position.copy(fr.at(0, signY + 0.58, -1.44)); title.rotation.y = fr.yaw;
  const sub = text3d('โต๊ะ เก้าอี้ ตู้ พัดลม แอร์ · ส่งฟรีในซอย!', { font: 'heavy', size: 0.1, color: 0xfff4dc, side: 0x5a1010, emissive: 0.3, align: 'center', depth: 0.2 });
  sub.position.copy(fr.at(0, signY + 0.2, -1.44)); sub.rotation.y = fr.yaw;
  root.add(title, sub);
  // ---- keeper corner: a metal stool behind the counter
  const kp = fr.arr(2.85, 0, Rb - 0.85);
  const kst = libFit('metal_stool_02', 0.46); kst.position.set(kp[0], kp[1], kp[2]); root.add(kst);
  // ---- the STAFF ONLY door in the back wall (behind the counter): no collider in its opening
  const door = staffDoor();
  door.position.copy(fr.at(DOOR_X, 0, Rb - 0.002)); door.rotation.y = fr.yaw;
  door.name = 'build:backdoor';
  root.add(door);
  // ---- display slots + price stands
  const slots: Showroom['slots'] = [];
  const tagsDone = new Set<string>();
  for (const s of layout(ceil, bk)) {
    const f = FURN_BY_KIND[s.stock] ?? footprintOf(s.stock);
    const p = fr.arr(s.x, s.y ?? 0, s.z);
    const yaw = fr.toDoor + (s.face ?? 0);
    slots.push({ stock: s.stock, p, yaw });
    if (tagsDone.has(s.stock)) continue;
    tagsDone.add(s.stock);
    const price = FURN_BY_KIND[s.stock]?.price ?? game.items.def(s.stock)?.price ?? 0;
    const name = game.items.def(s.stock)?.name.th ?? s.stock;
    const stand = priceStand(name, price, !!(f && (f.mount === 'wall' || f.mount === 'ceiling' || (s.y ?? 0) > 0)));
    // floor pieces: stand at their front-right corner; mounted / top pieces: a card on the floor below them
    const w = f?.size?.[0] ?? 0.5, d = f?.size?.[2] ?? 0.5;
    const sp = fr.at(s.x + w / 2 + 0.12, 0, s.z - d / 2 - 0.05 - (f?.mount === 'wall' ? 0.35 : 0));
    stand.position.copy(sp); stand.rotation.y = fr.toDoor;
    root.add(stand);
  }
  // ---- static colliders: counter is solid; ceiling slab (so ceiling fans / lamps can be hung here)
  const colliders = [
    game.physics.addBox(fr.arr(0, ceil + 0.03, mid), [7.7, 0.06, D], fr.yaw),
  ];
  // night glow
  (game.world as any)?.addLightPoint?.(fr.at(0, ceil - 0.3, 1.0), 0xf0f6ff, 14, 9, 0.4);
  (game.world as any)?.addLightPoint?.(fr.at(0, ceil - 0.3, B - 1.2), 0xf0f6ff, 12, 8, 0.25);
  (game.world as any)?.addLightPoint?.(fr.at(DOOR_X, ceil - 0.3, Rb - 0.6), 0xf0f6ff, 8, 5, 0.2);
  root.traverse((o: any) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  return { backdoor: backdoorAnchor(game, Rb), root, slots, keeper: { p: kp, yaw: fr.personToDoor, sit: false }, colliders, ceil };
}

/** acrylic price stand: chrome pole + white card with a red 3D price (and the Thai name) */
function priceStand(name: string, price: number, low: boolean) {
  const g = new THREE.Group();
  const h = low ? 0.02 : 0.55;
  if (!low) g.add(mesh(merge([tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0), 0.008, 8), new THREE.CylinderGeometry(0.07, 0.075, 0.012, 16)]), pbr('chrome', { repeat: 1, rough: 0.2 })));
  const card = mesh(rbox(0.3, 0.17, 0.008, 0.004, 0, h, 0), flat(0xfbf8f0, 0.5));
  if (low) { card.rotation.x = -0.9; }
  g.add(card);
  const t = text3d('฿' + price.toLocaleString(), { font: 'heavy', size: 0.055, color: 0xd01818, side: 0x6a0808, align: 'center', depth: 0.12, emissive: 0.15 });
  const n = text3d(name, { font: 'ui', size: 0.022, color: 0x2a2420, side: 0x101010, align: 'center', depth: 0.1, maxWidth: 0.27 });
  const face = new THREE.Group();
  face.position.set(0, h + 0.085, 0.006);
  if (low) { face.position.set(0, h + 0.06, 0.07); face.rotation.x = -0.9; }
  t.position.set(0, 0.012, 0.004); n.position.set(0, -0.045, 0.004);
  face.add(t, n);
  g.add(face);
  return g;
}

/** a static box at every floor display slot, enabled while a piece stands there (all peers: the player's
 *  controller collides locally). Static colliders are only ever disabled, never removed (world cleanup owns them). */
export class DisplayColliders {
  private cols: { c: any; i: number }[] = [];
  private t = 0;
  /** static display copies of every piece, shown while the shop is NOT stocked (locked day / after hours), so the
   *  showroom never shows price stands on an empty floor */
  private statics: { obj: THREE.Object3D; i: number }[] = [];
  private staticRoot: THREE.Group | null = null;
  constructor(private game: Game) {}
  init(slots: Showroom['slots']) {
    this.clear();
    const g = this.game;
    this.buildStatics(slots);
    if (!g.physics) return;
    slots.forEach((s, i) => {
      const f = footprintOf(s.stock);
      if (!f || f.mount !== 'floor' || s.p[1] > SW_H + 0.3) return;
      const c = g.physics.addBox([s.p[0], s.p[1] + f.size[1] / 2, s.p[2]], [Math.max(0.1, f.size[0] - 0.04), f.size[1], Math.max(0.1, f.size[2] - 0.04)], s.yaw);
      c.setEnabled(false);
      this.cols.push({ c, i });
    });
  }
  private buildStatics(slots: Showroom['slots']) {
    const g = this.game;
    if (!g.scene) return;
    const root = (this.staticRoot = new THREE.Group());
    root.name = 'build:showroom-static';
    slots.forEach((s, i) => {
      const def = g.items.def(s.stock);
      if (!def) return;
      try {
        const fake: any = { id: -1000 - i, t: 'item', k: s.stock, p: [...s.p], data: def.data?.() ?? {} };
        const o = def.build(fake, g);
        def.refresh?.(o, fake, g);
        o.position.set(s.p[0], s.p[1], s.p[2]); o.rotation.y = s.yaw;
        o.traverse((m: any) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        o.visible = false;
        root.add(o);
        this.statics.push({ obj: o, i });
      } catch (e) { console.warn('[showroom] static display', s.stock, e); }
    });
    g.scene.add(root);
  }
  update(dt: number) {
    this.t -= dt;
    if (this.t > 0 || (!this.cols.length && !this.statics.length)) return;
    this.t = 0.4;
    const filled = new Set<number>();
    for (const e of this.game.state.all('item')) if (e.disp && e.shop === STORE.id && e.holder == null && e.ss != null) filled.add(e.ss);
    const shop = this.game.state.find('shop', (e) => e.sid === STORE.id);
    const stocked = !!shop?.open;
    const shown = new Set<number>();
    for (const { obj, i } of this.statics) { const on = !stocked && !filled.has(i); if (obj.visible !== on) obj.visible = on; if (on) shown.add(i); }
    for (const { c, i } of this.cols) { const on = filled.has(i) || shown.has(i); if (c.isEnabled() !== on) c.setEnabled(on); }
  }
  clear() {
    for (const { c } of this.cols) { try { c.setEnabled(false); } catch {} }
    this.cols = [];
    this.staticRoot?.removeFromParent(); this.staticRoot = null; this.statics = [];
  }
}

/** HOST: move the shop's keeper entity to the new counter spot */
export function placeKeeper(game: Game, keeper: Ent | null, k: Showroom['keeper']) {
  if (!keeper || !game.isHost) return;
  keeper.p = [...k.p];
  keeper.yaw = k.yaw;
}
