import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { CarryStyle } from '../../game/items';
import { tl, type TL } from '../../core/util';
import { messMaterial } from '../restaurant/fx';
import { SEAT_KINDS, TABLE_KINDS, SEAT_H, TABLE_H, TABLE_SIZE } from '../restaurant/furniture';
import { libFit, standFan, wallFan, drinksFridge, foodCabinet, shrineShelf, menuLightbox, formicaTable, animateFan, animateCandles } from './models';

/* =============================================================================================
 * BUILD — the furniture catalogue (เจริญพาณิชย์เฟอร์นิเจอร์). Every piece is a real model at real scale:
 * Poly Haven CC0 photoscans + Sketchfab CC-BY imports from the shared library (public/assets/gen/lib), or custom
 * Thai builds (models.ts). Furniture is an ordinary item (fixed, carried by its carry style) with a FOOTPRINT used
 * by build mode for snapping / overlap checks, a MOUNT (floor / wall / ceiling / top of a counter), and a decor
 * value that the restaurant uses for comfort & ambience (decorScore in index.ts).
 * ============================================================================================= */

export type Mount = 'floor' | 'wall' | 'ceiling' | 'top';
export type Role = 'seat' | 'table' | 'decor' | 'appliance' | 'counter' | 'storage' | 'light' | 'fan';

export interface FurnDef {
  kind: string;
  name: TL;
  price: number;
  weight: number;
  slots: number;
  carry: CarryStyle;
  /** footprint w × h × d (m); origin bottom centre (wall items: bottom centre of the back, +Z out of the wall) */
  size: [number, number, number];
  mount: Mount;
  role: Role;
  /** ambience points (decorScore); comfort = cooling / seating comfort points */
  decor: number;
  comfort?: number;
  /** wall items: default height of the bottom above the floor */
  wallY?: number;
  seatH?: number;
  tableH?: number;
  tableSize?: [number, number];
  build: (e: Ent, game: Game) => THREE.Object3D;
  animate?: (o: THREE.Object3D, e: Ent, dt: number, game: Game) => void;
  /** shop stock */
  day?: number; qty?: number; show?: number; big?: boolean; unit?: string;
}

const on = (game: Game) => (game.g.time ?? 12) > 5.5;   // fans run all day; they spin down in the small hours

/** table builder with the restaurant's dirt layer (customers make tables messy, the sponge cleans them) */
function withMess(o: THREE.Object3D, e: Ent, W: number, Dp: number, H: number) {
  const m = messMaterial((e.id * 0.37) % 10);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, Dp - 0.06), m);
  p.rotation.x = -Math.PI / 2; p.position.y = H + 0.003; p.name = 'mess'; p.renderOrder = 2;
  p.raycast = () => {};
  o.add(p);
  return o;
}

export const FURNITURE: FurnDef[] = [
  // ------------------------------------------------------------------ seats
  { kind: 'stool_wood', name: tl('เก้าอี้ไม้พับ', 'folding wooden stool'), price: 150, weight: 1.6, slots: 1, carry: 'head', size: [0.5, 0.44, 0.5], mount: 'floor', role: 'seat', decor: 0.3, seatH: 0.44,
    build: () => libFit('folding_wooden_stool', 0.44), qty: 16, show: 2 },
  { kind: 'stool_metal', name: tl('เก้าอี้เหล็กกลม', 'round metal stool'), price: 220, weight: 2.4, slots: 1, carry: 'head', size: [0.44, 0.46, 0.44], mount: 'floor', role: 'seat', decor: 0.3, seatH: 0.46,
    build: () => libFit('metal_stool_02', 0.46), qty: 12, show: 2 },
  { kind: 'chair_wood', name: tl('เก้าอี้ไม้มีพนัก', 'wooden chair'), price: 450, weight: 3.5, slots: 2, carry: 'head', size: [0.44, 0.92, 0.5], mount: 'floor', role: 'seat', decor: 0.8, seatH: 0.46,
    build: () => libFit('painted_wooden_chair_01', 0.92), qty: 12, show: 2 },
  // ------------------------------------------------------------------ tables
  { kind: 'table_formica', name: tl('โต๊ะพับโฟเมก้า', 'formica folding table'), price: 690, weight: 7, slots: 3, carry: 'twohand', size: [0.9, 0.72, 0.6], mount: 'floor', role: 'table', decor: 0.5, tableH: 0.72, tableSize: [0.9, 0.6],
    build: (e) => withMess(formicaTable(), e, 0.9, 0.6, 0.72), qty: 8, show: 1, big: true },
  { kind: 'table_round_wood', name: tl('โต๊ะไม้กลม', 'round wooden table'), price: 1590, weight: 14, slots: 3, carry: 'twohand', size: [0.8, 0.75, 0.8], mount: 'floor', role: 'table', decor: 1.2, tableH: 0.75, tableSize: [0.8, 0.8],
    build: (e) => withMess(libFit('round_wooden_table_02', 0.75), e, 0.62, 0.62, 0.75), qty: 6, show: 1, big: true },
  // ------------------------------------------------------------------ counter & storage
  { kind: 'counter_desk', name: tl('เคาน์เตอร์คิดเงิน', 'cashier counter'), price: 2900, weight: 30, slots: 3, carry: 'twohand', size: [1.6, 0.9, 0.7], mount: 'floor', role: 'counter', decor: 1,
    build: () => libFit('metal_office_desk', 0.9, { size: [1.6, 0.9, 0.7] }), qty: 3, show: 1, big: true },
  { kind: 'cabinet_wood', name: tl('ตู้ไม้ทาสี', 'painted wooden cabinet'), price: 1890, weight: 28, slots: 3, carry: 'twohand', size: [1.1, 1.1, 0.56], mount: 'floor', role: 'storage', decor: 1.2,
    build: () => libFit('painted_wooden_cabinet', 1.1, { size: [1.1, 1.1, 0.56] }), qty: 3, show: 1, big: true },
  { kind: 'shelf_wood', name: tl('ชั้นวางไม้', 'wooden shelf'), price: 690, weight: 9, slots: 2, carry: 'twohand', size: [0.5, 1.13, 0.37], mount: 'floor', role: 'storage', decor: 0.6,
    build: () => libFit('painted_wooden_shelves', 1.13), qty: 4, show: 1, big: true },
  { kind: 'shelf_steel', name: tl('ชั้นเหล็ก 5 ชั้น', 'steel shelving'), price: 990, weight: 14, slots: 2, carry: 'twohand', size: [0.6, 1.8, 0.5], mount: 'floor', role: 'storage', decor: 0.3,
    build: () => libFit('steel_frame_shelves_02', 1.8), qty: 4, show: 1, big: true },
  // ------------------------------------------------------------------ appliances
  { kind: 'drinks_fridge', name: tl('ตู้แช่เครื่องดื่ม', 'drinks fridge'), price: 4500, weight: 60, slots: 3, carry: 'twohand', size: [0.6, 1.85, 0.62], mount: 'floor', role: 'appliance', decor: 2, comfort: 0.5,
    build: () => drinksFridge(), qty: 2, show: 1, big: true },
  { kind: 'food_cabinet', name: tl('ตู้กับข้าวกระจก', 'glass food cabinet'), price: 1900, weight: 22, slots: 3, carry: 'twohand', size: [0.9, 1.5, 0.5], mount: 'floor', role: 'appliance', decor: 1.5,
    build: () => foodCabinet(), qty: 3, show: 1, big: true },
  { kind: 'stand_fan', name: tl('พัดลมตั้งพื้น 16 นิ้ว', '16" stand fan'), price: 790, weight: 4, slots: 2, carry: 'twohand', size: [0.42, 1.4, 0.42], mount: 'floor', role: 'fan', decor: 0.4, comfort: 1,
    build: () => standFan(), animate: (o, _e, dt, g) => animateFan(o, dt, on(g)), qty: 6, show: 1 },
  { kind: 'wall_fan', name: tl('พัดลมติดผนัง', 'wall fan'), price: 890, weight: 3, slots: 2, carry: 'twohand', size: [0.44, 0.5, 0.45], mount: 'wall', wallY: 2.0, role: 'fan', decor: 0.4, comfort: 1,
    build: () => wallFan(), animate: (o, _e, dt, g) => animateFan(o, dt, on(g)), qty: 6, show: 1 },
  { kind: 'ceiling_fan', name: tl('พัดลมเพดาน', 'ceiling fan'), price: 1490, weight: 6, slots: 2, carry: 'twohand', size: [1.3, 0.46, 1.3], mount: 'ceiling', role: 'fan', decor: 1, comfort: 1.6,
    build: () => { const o = libFit('ceiling_fan', 0.46); o.children[0].name = 'rotor'; return o; }, animate: (o, _e, dt, g) => animateFan(o, dt, on(g), false), qty: 4, show: 1 },
  { kind: 'aircon', name: tl('แอร์ 12000 BTU', 'split air-con'), price: 9900, weight: 11, slots: 3, carry: 'twohand', size: [0.82, 0.3, 0.24], mount: 'wall', wallY: 2.3, role: 'appliance', decor: 1, comfort: 4,
    build: () => libFit('aircon_split', 0.3, { size: [0.82, 0.3, 0.24], z: 0.12 }), qty: 2, show: 1, big: true, day: 3 },
  { kind: 'tv_crt', name: tl('ทีวีจอตู้ 21 นิ้ว', '21" CRT TV'), price: 1800, weight: 18, slots: 2, carry: 'twohand', size: [0.56, 0.44, 0.44], mount: 'top', role: 'decor', decor: 2,
    build: () => libFit('Television_01', 0.44), qty: 3, show: 1 },
  // ------------------------------------------------------------------ decor
  { kind: 'cash_register', name: tl('เครื่องคิดเงิน', 'cash register'), price: 1200, weight: 6, slots: 1, carry: 'twohand', size: [0.36, 0.38, 0.38], mount: 'top', role: 'decor', decor: 1,
    build: () => libFit('CashRegister_01', 0.38), qty: 3, show: 1 },
  { kind: 'lucky_cat', name: tl('แมวกวัก', 'lucky cat'), price: 199, weight: 0.6, slots: 1, carry: 'hand', size: [0.16, 0.24, 0.15], mount: 'top', role: 'decor', decor: 1.5,
    build: () => libFit('lucky_cat_gold', 0.24), animate: (o, _e, dt) => { const u = o.userData as any; u.t = (u.t ?? 0) + dt; o.children[0].rotation.z = Math.sin(u.t * 2.2) * 0.02; }, qty: 10, show: 2 },
  { kind: 'wall_clock', name: tl('นาฬิกาแขวน', 'wall clock'), price: 159, weight: 0.8, slots: 1, carry: 'hand', size: [0.32, 0.32, 0.05], mount: 'wall', wallY: 2.05, role: 'decor', decor: 0.6,
    build: () => libFit('wall_clock', 0.32, { z: 0.025 }), qty: 8, show: 1 },
  { kind: 'shrine_shelf', name: tl('หิ้งพระ', 'shrine shelf'), price: 590, weight: 5, slots: 2, carry: 'twohand', size: [0.82, 0.78, 0.34], mount: 'wall', wallY: 1.85, role: 'decor', decor: 2,
    build: () => shrineShelf(), animate: (o, _e, dt) => { const u = o.userData as any; u.t = (u.t ?? 0) + dt; animateCandles(o, u.t); }, qty: 3, show: 1 },
  { kind: 'menu_lightbox', name: tl('ป้ายไฟเมนู', 'menu lightbox'), price: 1500, weight: 6, slots: 2, carry: 'twohand', size: [1.2, 0.8, 0.1], mount: 'wall', wallY: 1.75, role: 'decor', decor: 2,
    build: (_e, game) => menuLightbox(game), animate: (o) => { const s = (o.userData as any).sync ?? (o.children[0]?.userData as any)?.sync; s?.(); }, qty: 3, show: 1 },
  { kind: 'chalkboard', name: tl('กระดานดำตั้งพื้น', 'standing chalkboard'), price: 350, weight: 4, slots: 2, carry: 'twohand', size: [0.7, 1.15, 0.6], mount: 'floor', role: 'decor', decor: 1,
    build: () => libFit('standing_chalkboard_01', 1.15), qty: 4, show: 1 },
  { kind: 'planter_box', name: tl('กระบะต้นไม้', 'planter box'), price: 390, weight: 12, slots: 2, carry: 'twohand', size: [0.9, 0.42, 0.41], mount: 'floor', role: 'decor', decor: 1.5,
    build: () => libFit('planter_box_01', 0.42), qty: 6, show: 1 },
  { kind: 'plant_big', name: tl('ต้นไม้กระถางใหญ่', 'big potted plant'), price: 290, weight: 8, slots: 2, carry: 'twohand', size: [0.6, 0.84, 0.6], mount: 'floor', role: 'decor', decor: 1.5,
    build: () => libFit('potted_plant_02', 0.84), qty: 8, show: 1 },
  { kind: 'plant_small', name: tl('ต้นไม้กระถางเล็ก', 'small potted plant'), price: 79, weight: 0.8, slots: 1, carry: 'hand', size: [0.17, 0.27, 0.19], mount: 'top', role: 'decor', decor: 0.5,
    build: () => libFit('potted_plant_04', 0.27), qty: 12, show: 2 },
  { kind: 'lamp_pendant', name: tl('โคมไฟห้อย', 'pendant lamp'), price: 450, weight: 2, slots: 1, carry: 'hand', size: [0.4, 1.0, 0.4], mount: 'ceiling', role: 'light', decor: 1,
    build: () => libFit('hanging_industrial_lamp', 1.0), qty: 8, show: 1 },
];

export const FURN_BY_KIND: Record<string, FurnDef> = Object.fromEntries(FURNITURE.map((f) => [f.kind, f]));

/** Footprints of the restaurant's own furniture kinds (for snapping / overlap in build mode). */
export const BASE_FOOTPRINT: Record<string, { size: [number, number, number]; mount: Mount; role: Role; decor: number; comfort?: number; wallY?: number }> = {
  stool_red: { size: [0.36, 0.44, 0.36], mount: 'floor', role: 'seat', decor: 0.1 },
  stool_blue: { size: [0.36, 0.44, 0.36], mount: 'floor', role: 'seat', decor: 0.1 },
  chair_plastic: { size: [0.5, 0.84, 0.5], mount: 'floor', role: 'seat', decor: 0.2 },
  table_plastic: { size: [0.8, 0.66, 0.62], mount: 'floor', role: 'table', decor: 0.2 },
  table_steel: { size: [0.9, 0.71, 0.62], mount: 'floor', role: 'table', decor: 0.4 },
  umbrella_big: { size: [0.4, 2.4, 0.4], mount: 'floor', role: 'decor', decor: 0.5, comfort: 0.5 },
  menu_poster: { size: [0.82, 1.05, 0.42], mount: 'floor', role: 'decor', decor: 0.5 },
  shop_sign: { size: [0.36, 1.35, 0.36], mount: 'floor', role: 'decor', decor: 0.2 },
  water_dispenser: { size: [0.34, 1.12, 0.34], mount: 'floor', role: 'appliance', decor: 0.5 },
  trash_bin: { size: [0.42, 0.62, 0.42], mount: 'floor', role: 'storage', decor: 0 },
  wash_tub: { size: [0.62, 0.27, 0.62], mount: 'floor', role: 'storage', decor: 0 },
  dish_rack: { size: [0.48, 0.22, 0.34], mount: 'top', role: 'storage', decor: 0 },
  ice_bucket: { size: [0.32, 0.26, 0.32], mount: 'top', role: 'storage', decor: 0 },
};

export interface Footprint { size: [number, number, number]; mount: Mount; role: Role; decor: number; comfort?: number; wallY?: number }
export function footprintOf(kind: string): Footprint | null {
  const f = FURN_BY_KIND[kind];
  if (f) return f;
  return BASE_FOOTPRINT[kind] ?? null;
}
export const isFurniture = (kind: string) => !!footprintOf(kind);

/** Register every catalogue piece as an item + join the restaurant's seat / table lists. */
export function defineCatalog(game: Game) {
  for (const f of FURNITURE) {
    if (game.items.def(f.kind)) continue;
    const [w, h, d] = f.size;
    game.items.define({
      kind: f.kind, name: f.name, weight: f.weight, slots: f.slots, price: f.price, carry: f.carry, fixed: true,
      tags: ['furniture', f.role, 'build:' + f.mount],
      shape: { type: 'box', size: [w, h, d] },
      data: f.role === 'table' ? () => ({ mess: 0 }) : undefined,
      build: (e, g) => {
        const o = f.build(e, g);
        // wall pieces are modelled from the wall outward (+Z); the item origin stays bottom centre of the box
        if (f.mount === 'wall') { const w0 = new THREE.Group(); o.position.z -= d / 2; w0.add(o); return w0; }
        return o;
      },
      refresh: f.role === 'table' ? (o, e) => { const m = o.getObjectByName('mess') as THREE.Mesh; if (m) (m.material as THREE.ShaderMaterial).uniforms.uMess.value = e.data?.mess ?? 0; } : undefined,
      animate: f.animate ? (o, e, dt, g) => f.animate!(o, e, dt, g) : undefined,
      label: f.role === 'table' ? (e) => tl((e.data?.mess ?? 0) > 0.25 ? f.name.th + ' (สกปรก)' : f.name.th, f.name.en ?? '') : undefined,
      hold: { pos: [0, -Math.min(0.5, h * 0.35), -0.15], rot: [0.25, 0.3, 0], scale: Math.min(1, 0.32 / Math.max(w, h, d) + 0.18) },
    });
    if (f.role === 'seat' && !SEAT_KINDS.includes(f.kind)) { SEAT_KINDS.push(f.kind); SEAT_H[f.kind] = f.seatH ?? 0.45; }
    if (f.role === 'table' && !TABLE_KINDS.includes(f.kind)) { TABLE_KINDS.push(f.kind); TABLE_H[f.kind] = f.tableH ?? 0.72; TABLE_SIZE[f.kind] = f.tableSize ?? [f.size[0], f.size[2]]; }
  }
}
