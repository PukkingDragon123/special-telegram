import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/game';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import type { ShopDef, StockDef } from './data';
import { canvasMat, mat, photo, photoMat, priceCardTex, signTex, CardStyle } from './tex';
import { buildShape } from './items';

/**
 * FIXTURES — the physical shops: stall tables + canopies, shophouse display steps + counters +
 * roller shutters, the 8-Twelve gondolas/fridge/counter, แม็กโคร่ง pallet racks. Built on every
 * peer from the anchors (deterministic), static geometry merged per material.
 *
 * Local shop frame: x = right, y = up, z = forward (the direction the anchor faces = into the shop).
 */

export interface Slot { stock: string; p: [number, number, number]; yaw: number }
export interface ShopFix {
  sid: string;
  root: THREE.Group;
  slots: Slot[];
  keeper: { p: [number, number, number]; yaw: number; sit: boolean };
  center: [number, number, number];
  radius: number;
  /** rect test for stores/warehouses (world x/z) */
  rect?: [number, number, number, number];
  counter: THREE.Object3D[];
  cards: Map<string, THREE.Mesh>;
  cardStyle: CardStyle;
  shutter?: { obj: THREE.Object3D; mesh: THREE.Mesh; h: number; tex: THREE.Texture | null; k: number; collider: any; box: { c: number[]; s: number[]; yaw: number } };
  tarp?: THREE.Object3D;
  closedSign?: THREE.Mesh;
  door?: [number, number, number];
  colliders: any[];
  /** idle "life" spots (props) */
  calc?: THREE.Object3D;
}

// ------------------------------------------------------------------ frame helpers
class Frame {
  o: THREE.Vector3; yaw: number; f: THREE.Vector3; r: THREE.Vector3;
  constructor(p: ArrayLike<number>, yaw: number) {
    this.o = new THREE.Vector3(p[0], p[1], p[2]);
    this.yaw = yaw;
    this.f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  }
  at(x: number, y: number, z: number) { return this.o.clone().addScaledVector(this.r, x).addScaledVector(this.f, z).add(new THREE.Vector3(0, y, 0)); }
  arr(x: number, y: number, z: number): [number, number, number] { const v = this.at(x, y, z); return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; }
  /** world yaw for something facing back toward the customer */
  get back() { return this.yaw + Math.PI; }
}

/** Collect geometries per material, merge at the end (few draw calls). */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material, fr?: Frame, x = 0, y = 0, z = 0, rotY = 0) {
    if (fr) {
      const p = fr.at(x, y, z);
      const mtx = new THREE.Matrix4().makeRotationY(fr.yaw + rotY).setPosition(p);
      g.applyMatrix4(mtx);
    }
    const x2 = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x2.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x2.deleteAttribute(k);
    if (!x2.getAttribute('uv')) x2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x2.getAttribute('position').count * 2), 2));
    let a = this.parts.get(m);
    if (!a) this.parts.set(m, (a = []));
    a.push(x2);
  }
  flush(root: THREE.Object3D, shadows = true) {
    for (const [m, gs] of this.parts) {
      const g = gs.length === 1 ? gs[0] : mergeGeometries(gs, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      root.add(mesh);
    }
    this.parts.clear();
  }
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
/** Box with UVs in metres / tile (keeps PBR texel density). */
function mbox(w: number, h: number, d: number, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.getAttribute('normal'), p = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay > 0.5) uv.setXY(i, x / tile, z / tile); else if (ax > 0.5) uv.setXY(i, z / tile, y / tile); else uv.setXY(i, x / tile, y / tile);
  }
  return g.translate(0, h / 2, 0);
}
const pbr = (id: string, color?: number, fallback = 0x8a8478) => mat(`pbr:${id}:${color ?? ''}`, () => Assets.pbr(id, { repeat: 1, color, fallback }));
const flat = (c: number, rough = 0.8, metal = 0) => mat(`fx:${c}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }));
const glow = (c: number, k = 2.2) => mat(`glow:${c}:${k}`, () => new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: k, roughness: 0.4 }));
const glass = () => mat('fx:glass', () => new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }));

function plane(w: number, h: number) { return new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0); }

/** A photo panel (real shop interior photo) as a slightly curved card (no flat lazy quad). */
function photoPanel(key: string, w: number, h: number, curve = 0.06) {
  const g = new THREE.PlaneGeometry(w, h, 8, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2); p.setZ(i, -curve * x * x); }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return { g, m: photoMat(key, { rough: 0.8 }) };
}

function card(style: CardStyle, st: StockDef, name: string, w: number, seed: number) {
  const tex = priceCardTex(style, name, st.unit, st.price, seed);
  const ar = style === 'star' ? 1 : style === 'card' ? 320 / 448 : 192 / 512;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * ar), canvasMat(tex, { alpha: style === 'star' }));
  m.castShadow = false;
  m.name = 'price:' + st.id;
  return m;
}

/** Group the shop's stock into display "lanes" along a surface. */
function lanes(stock: StockDef[], rows: number) {
  const per = Math.ceil(stock.length / rows);
  const out: StockDef[][] = [];
  for (let r = 0; r < rows; r++) out.push(stock.slice(r * per, (r + 1) * per));
  return out;
}

/** Units grid inside a lane cell: returns local (x,z) offsets for `n` units. */
function unitGrid(n: number, cw: number, cd: number): [number, number][] {
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * (cw / Math.max(cd, 0.1))))));
  const rows = Math.ceil(n / cols);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push([(c - (cols - 1) / 2) * (cw / cols) * 0.86, (r - (rows - 1) / 2) * (cd / rows) * 0.8]);
  }
  return out;
}

function nameOf(game: Game, st: StockDef, kind: string) {
  return st.label?.th ?? game.items.def(kind)?.name.th ?? kind;
}

// ------------------------------------------------------------------ STALL (fresh market)
const STALL_STYLE: Record<string, { tarp: number; sheet: number; backdrop: string; decor: string[]; sign: string }> = {
  auntie_stall: { tarp: 0xc8502a, sheet: 0x2f62b8, backdrop: 'garlic_backdrop', decor: ['heap_garlic', 'heap_shallot', 'heap_chili'], sign: 'แผงป้าแดง' },
  butcher_stall: { tarp: 0x2f5fa8, sheet: 0xc42a22, backdrop: 'pork_stall', decor: ['pork_table'], sign: 'หมูสด เขียงลุงหมึก' },
  veg_stall: { tarp: 0x3f8a3a, sheet: 0x2f62b8, backdrop: 'veg_backdrop', decor: ['heap_beans', 'heap_basil', 'heap_onion'], sign: 'ผักสด ป้าศรี' },
  egg_stall: { tarp: 0xd9a12a, sheet: 0xe8e0d0, backdrop: 'egg_display', decor: ['heap_eggs'], sign: 'ไข่สด ของแห้ง' },
};

function buildStall(game: Game, s: ShopDef, fr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  const st = STALL_STYLE[s.id] ?? STALL_STYLE.auntie_stall;
  const W = 2.6, D = 1.05, H = 0.8, zc = 0.95;
  // table: steel legs, plank top, plastic sheet with overhang skirt
  const legs = flat(0x55585c, 0.6, 0.5);
  for (const [x, z] of [[-W / 2 + 0.06, zc - D / 2 + 0.06], [W / 2 - 0.06, zc - D / 2 + 0.06], [-W / 2 + 0.06, zc + D / 2 - 0.06], [W / 2 - 0.06, zc + D / 2 - 0.06]]) B.add(box(0.05, H - 0.04, 0.05), legs, fr, x, 0, z);
  B.add(mbox(W, 0.04, D, 1.2), pbr('wood_planks_old'), fr, 0, H - 0.04, zc);
  const sheet = pbr('canvas_tarp', st.sheet, st.sheet);
  B.add(mbox(W + 0.08, 0.012, D + 0.06, 0.6), sheet, fr, 0, H, zc);
  // front skirt (cloth hanging), slightly wavy
  const skirt = new THREE.PlaneGeometry(W + 0.08, 0.42, 16, 1);
  { const p = skirt.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.015); skirt.computeVertexNormals(); }
  skirt.translate(0, H - 0.21, 0);
  B.add(skirt, mat('skirt:' + st.sheet, () => { const m = (sheet as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; }), fr, 0, 0, zc - D / 2 - 0.035, 0);
  // raised back tier (crate) for a second row of goods
  const tier = pbr('plastic_rough', 0x2f62b8, 0x2f62b8);
  B.add(mbox(W - 0.1, 0.16, 0.42, 0.5), tier, fr, 0, H + 0.012, zc + 0.27);
  // canopy: 4 bamboo poles + slanted tarp
  const pole = pbr('bamboo_poles', undefined, 0xb89a62);
  const ph = 2.35;
  for (const [x, z] of [[-W / 2 - 0.05, zc - D / 2 - 0.05], [W / 2 + 0.05, zc - D / 2 - 0.05], [-W / 2 - 0.05, zc + D / 2 + 0.55], [W / 2 + 0.05, zc + D / 2 + 0.55]]) B.add(new THREE.CylinderGeometry(0.03, 0.035, ph + (z > zc ? 0.25 : 0), 6).translate(0, (ph + (z > zc ? 0.25 : 0)) / 2, 0), pole, fr, x, 0, z);
  const tarp = new THREE.PlaneGeometry(W + 0.5, D + 0.9, 10, 4);
  { const p = tarp.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -0.06 * Math.sin((x / (W + 0.5)) * Math.PI * 3) * Math.cos(y * 2) - 0.08 * (1 - Math.abs(x) / ((W + 0.5) / 2))); } tarp.computeVertexNormals(); }
  tarp.rotateX(-Math.PI / 2 + 0.16);
  B.add(tarp, mat('tarp:' + st.tarp, () => { const m = Assets.pbr('canvas_tarp', { repeat: 2, color: st.tarp, fallback: st.tarp }).clone(); m.side = THREE.DoubleSide; return m; }), fr, 0, ph + 0.1, zc + 0.25);
  // hanging fluorescent tube
  B.add(new THREE.CylinderGeometry(0.016, 0.016, 1.1, 6).rotateZ(Math.PI / 2), glow(0xfff3dc, 1.6), fr, 0, ph - 0.25, zc + 0.2);
  // keeper stool (red plastic)
  const stool = buildShape('sfb_stool');
  if (stool) { stool.position.copy(fr.at(0.55, 0, zc + D / 2 + 0.75)); root.add(stool); }
  // decorative heaps on the back tier (real produce photos) + baskets on the floor
  st.decor.forEach((key, i) => {
    const heap = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    { const p = heap.getAttribute('position') as THREE.BufferAttribute; for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k); p.setY(k, p.getY(k) * (0.9 + Math.sin(x * 13 + i) * Math.cos(z * 11) * 0.12)); } heap.computeVertexNormals(); }
    heap.scale(0.5, 0.22, 0.34);
    const x = (i - (st.decor.length - 1) / 2) * 0.62 + 0.05;
    B.add(heap, photoMat(key), fr, x, 0.06, zc + D / 2 + 0.35);
    B.add(new THREE.CylinderGeometry(0.29, 0.24, 0.12, 12, 1, true).translate(0, 0.06, 0), mat('basket:' + i, () => { const t = photo('kradong'); const m = new THREE.MeshStandardMaterial({ map: t, color: t ? 0xffffff : 0xb8955a, roughness: 0.8, side: THREE.DoubleSide }); return m; }), fr, x, 0, zc + D / 2 + 0.35);
  });
  // backdrop: a real photo of the neighbouring stall (depth + density behind the keeper)
  const bd = photoPanel(st.backdrop, 3.2, 2.0, 0.12);
  B.add(bd.g, bd.m, fr, 0, 0.15, zc + D / 2 + 1.35, 0);
  B.flush(root);
  // scale + calculator on the table (real cut-out photos)
  const scale = new THREE.Mesh(plane(0.26, 0.34), photoMat('scale', { alpha: true, side: THREE.DoubleSide }));
  scale.position.copy(fr.at(W / 2 - 0.25, H + 0.012, zc + 0.3)); scale.rotation.y = fr.yaw - 0.3;
  root.add(scale);
  const calc = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.15).translate(0, 0.009, 0), [flat(0x333336), flat(0x333336), photoMat('calculator'), flat(0x333336), flat(0x333336), flat(0x333336)]);
  calc.position.copy(fr.at(-W / 2 + 0.22, H + 0.012, zc + 0.36)); calc.rotation.y = fr.back + 0.25;
  root.add(calc);
  // shop name sign hanging from the canopy (hand-painted on cardboard)
  const sign = new THREE.Mesh(plane(0.86, 0.32), canvasMat(signTex('stall:' + s.id, [{ text: st.sign, size: 120, color: '#8c1414' }], 'card_kraft', 640, 240)));
  sign.position.copy(fr.at(0, ph - 0.36, zc - D / 2 - 0.12)); sign.rotation.y = fr.yaw;
  root.add(sign);
  // display slots: 2 rows (front on the sheet, back on the tier)
  const slots: Slot[] = [];
  const cards = new Map<string, THREE.Mesh>();
  const rows = lanes(s.stock, s.stock.length > 7 ? 2 : 1);
  const style: CardStyle = 'star';
  rows.forEach((row, ri) => {
    const cw = (W - 0.2) / Math.max(1, row.length);
    const zRow = rows.length === 1 ? zc - 0.05 : (ri === 0 ? zc - 0.2 : zc + 0.27);
    const y = rows.length === 1 || ri === 0 ? H + 0.014 : H + 0.172;
    row.forEach((stk, i) => {
      const xc = -W / 2 + 0.1 + cw * (i + 0.5);
      const grid = unitGrid(stk.show ?? 2, cw, rows.length === 1 ? 0.6 : 0.36);
      for (const [dx, dz] of grid) slots.push({ stock: stk.id, p: fr.arr(xc + dx, y, zRow + dz), yaw: fr.yaw + (Math.sin(slots.length * 3.7) * 0.4) });
      const kind = kinds.get(stk.id) ?? stk.fb;
      const c = card(style, stk, nameOf(game, stk, kind), 0.2, i + ri * 3 + s.id.length);
      c.position.copy(fr.at(xc, y + (ri === 0 || rows.length === 1 ? 0.13 : 0.2), zRow - (rows.length === 1 ? 0.32 : 0.18)));
      c.rotation.set(0, fr.yaw, 0, 'YXZ');
      c.rotateX(-0.35);
      root.add(c);
      cards.set(stk.id, c);
    });
  });
  // closed: blue tarp draped over the table
  const cover = new THREE.Mesh((() => { const g = new THREE.BoxGeometry(W + 0.2, 0.5, D + 0.25, 10, 2, 4); const p = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * (1 + (y < 0 ? 0.04 : 0)), y + Math.sin(x * 7 + z * 5) * 0.03, z); } g.computeVertexNormals(); return g.translate(0, H + 0.02, 0); })(), pbr('canvas_tarp', 0x2a58b0, 0x2a58b0));
  cover.position.copy(fr.at(0, 0, zc)); cover.rotation.y = fr.yaw; cover.visible = false; cover.castShadow = true;
  root.add(cover);
  const colliders = [game.physics.addBox(fr.arr(0, H / 2, zc + 0.05), [W + 0.1, H, D + 0.1], fr.yaw)];
  return {
    sid: s.id, root, slots, cards, cardStyle: style, counter: [cover, sign],
    keeper: { p: fr.arr(-0.25, 0, zc + D / 2 + 0.55), yaw: fr.back, sit: false },
    center: fr.arr(0, 0, zc), radius: s.radius, tarp: cover, colliders, calc,
  };
}

// ------------------------------------------------------------------ SHOPHOUSE (open front + shutter)
const HOUSE_STYLE: Record<string, { wall: string; side: string; hang?: string[]; table: number; counterTop: number }> = {
  plastic_shop: { wall: 'plastic_wall2', side: 'plastic_wall', hang: ['tub_blue', 'basin_navy', 'basket_red', 'tub_blue'], table: 0x6b4a2a, counterTop: 0x9a7a52 },
  kitchen_shop: { wall: 'kitchen_wall', side: 'kitchen_plates', hang: ['kradong'], table: 0x5a4030, counterTop: 0x8a6a4a },
  gas_shop: { wall: 'gas_row', side: 'gas_row', table: 0x4a4a48, counterTop: 0x6a6a66 },
};

function buildShophouse(game: Game, s: ShopDef, fr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  const hs = HOUSE_STYLE[s.id] ?? HOUSE_STYLE.plastic_shop;
  const sw = s.shutter ?? { w: 7.6, off: 0, h: 3.1 };
  const zFront = -1.2; // facade line (anchors are 1 m inside, the facade is at ±6)
  // floor tiles inside (in case the world interior is plain) — thin, slightly above the slab
  B.add(mbox(sw.w - 0.3, 0.012, 4.6, 1.5), pbr('tiles_floor_ceramic'), fr, sw.off, 0.0, zFront + 2.4);
  // back wall photo panel + two side racks with photos (real shop interiors)
  const back = photoPanel(hs.wall, Math.min(sw.w - 0.6, 6.5), 2.6, 0.18);
  B.add(back.g, back.m, fr, sw.off, 0.1, zFront + 4.7, 0);
  for (const side of [-1, 1]) {
    const x = sw.off + side * (sw.w / 2 - 0.35);
    const p = photoPanel(hs.side, 2.6, 2.3, 0.05);
    B.add(p.g, p.m, fr, x, 0.2, zFront + 3.0, -side * Math.PI / 2);
    B.add(mbox(0.45, 2.4, 3.0, 1), pbr('metal_painted_chipped', 0x6a7a80, 0x6a7a80), fr, x + side * 0.25, 0, zFront + 3.0);
  }
  // stepped display tables left & right of the entrance aisle
  const slots: Slot[] = [];
  const cards = new Map<string, THREE.Mesh>();
  const tableMat = pbr('wood_painted_weathered', undefined, hs.table);
  const steps: { x: number; z: number; w: number; d: number; h: number }[] = [
    { x: sw.off - 1.55, z: zFront + 1.25, w: 2.0, d: 0.9, h: 0.62 },
    { x: sw.off + 1.55, z: zFront + 1.25, w: 2.0, d: 0.9, h: 0.62 },
  ];
  for (const t of steps) {
    B.add(mbox(t.w, t.h, t.d, 1.2), tableMat, fr, t.x, 0, t.z);
    B.add(mbox(t.w, 0.3, t.d * 0.45, 1.2), tableMat, fr, t.x, t.h, t.z + t.d * 0.27);
  }
  // keeper counter (glass-top wooden desk with cash box) at the back right
  const cx = sw.off + 1.7, cz = zFront + 3.05;
  B.add(mbox(1.3, 0.85, 0.62, 1), pbr('plywood', undefined, hs.counterTop), fr, cx, 0, cz);
  B.add(box(1.32, 0.01, 0.64), glass(), fr, cx, 0.86, cz);
  B.add(box(0.32, 0.12, 0.24), flat(0x2a5a9a, 0.4, 0.3), fr, cx + 0.3, 0.86, cz);
  // hanging goods at the facade (real product cut-outs)
  (hs.hang ?? []).forEach((k, i) => {
    const n = (hs.hang ?? []).length;
    const x = sw.off + (i - (n - 1) / 2) * (sw.w / (n + 1));
    const g = plane(0.55, 0.5);
    B.add(g, photoMat(k, { alpha: true, side: THREE.DoubleSide }), fr, x, 2.15, zFront + 0.15, 0);
  });
  // a long fluorescent tube inside
  B.add(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 6).rotateZ(Math.PI / 2), glow(0xf3fbff, 1.8), fr, sw.off, 2.75, zFront + 2.2);
  B.flush(root);
  // keeper stool
  const stool = buildShape('sfb_stool');
  if (stool) { stool.position.copy(fr.at(cx, 0, cz + 0.62)); root.add(stool); }
  // stock slots: spill-out (big items / stacks) on the sidewalk, rest on the steps
  const big = s.stock.filter((x) => x.big || /stool|lpg|water20|ice|chair|table|umbrella|bin/.test(x.id));
  const small = s.stock.filter((x) => !big.includes(x));
  const style: CardStyle = 'card';
  // sidewalk spill-out row
  const spillW = Math.min(sw.w - 1.0, 5.6);
  big.forEach((stk, i) => {
    const cw = spillW / Math.max(1, big.length);
    const xc = sw.off - spillW / 2 + cw * (i + 0.5);
    const n = stk.show ?? 1;
    for (let k = 0; k < n; k++) {
      const stack = /stool|cup/.test(stk.id);
      const dx = stack ? 0 : (k - (n - 1) / 2) * Math.min(0.42, cw / n);
      slots.push({ stock: stk.id, p: fr.arr(xc + dx, stack ? k * 0.12 : 0, zFront - 0.75), yaw: fr.yaw + (stack ? k * 0.4 : 0) });
    }
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(style, stk, nameOf(game, stk, kind), 0.3, i);
    c.position.copy(fr.at(xc, 1.05, zFront - 0.42)); c.rotation.y = fr.yaw;
    root.add(c); cards.set(stk.id, c);
  });
  // steps: front ledge + raised back ledge
  const ledges = steps.flatMap((t) => [{ x: t.x, y: t.h + 0.004, z: t.z - t.d * 0.2, w: t.w }, { x: t.x, y: t.h + 0.304, z: t.z + t.d * 0.27, w: t.w }]);
  const perLedge = Math.ceil(small.length / ledges.length);
  small.forEach((stk, i) => {
    const L = ledges[Math.min(ledges.length - 1, Math.floor(i / perLedge))];
    const j = i % perLedge;
    const cw = (L.w - 0.1) / perLedge;
    const xc = L.x - L.w / 2 + 0.05 + cw * (j + 0.5);
    const grid = unitGrid(stk.show ?? 1, cw, 0.3);
    for (const [dx, dz] of grid) slots.push({ stock: stk.id, p: fr.arr(xc + dx, L.y, L.z + dz), yaw: fr.yaw });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(style, stk, nameOf(game, stk, kind), 0.2, i + 5);
    c.position.copy(fr.at(xc, L.y + 0.02, L.z - 0.2)); c.rotation.set(0, fr.yaw, 0, 'YXZ'); c.rotateX(-0.9);
    root.add(c); cards.set(stk.id, c);
  });
  const { shut, sign } = makeShutter(game, root, fr, sw.off, sw.w, sw.h, zFront, s.closedNote?.th ?? 'ปิด');
  const colliders = [
    game.physics.addBox(fr.arr(steps[0].x, 0.47, steps[0].z), [steps[0].w, 0.94, steps[0].d], fr.yaw),
    game.physics.addBox(fr.arr(steps[1].x, 0.47, steps[1].z), [steps[1].w, 0.94, steps[1].d], fr.yaw),
    game.physics.addBox(fr.arr(cx, 0.45, cz), [1.3, 0.9, 0.62], fr.yaw),
  ];
  return {
    sid: s.id, root, slots, cards, cardStyle: style,
    counter: [],
    keeper: { p: fr.arr(cx - 0.05, 0, cz + 0.62), yaw: fr.back, sit: !!s.keeper.sit },
    center: fr.arr(sw.off, 0, zFront + 1.4), radius: s.radius,
    shutter: shut,
    closedSign: sign, colliders,
  };
}


/** Animated roller shutter across an opening (local frame), with a hand-written closed sign. */
function makeShutter(game: Game, root: THREE.Object3D, fr: Frame, off: number, w: number, h: number, zFront: number, note: string) {
  const shMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide, color: 0xb9b7b0 });
  const shMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1).translate(0, -h / 2, 0), shMat); // origin at the top
  shMesh.castShadow = true; shMesh.receiveShadow = true;
  const shObj = new THREE.Group();
  shObj.position.copy(fr.at(off, h, zFront - 0.02)); shObj.rotation.y = fr.yaw;
  shObj.add(shMesh);
  const rollBox = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.26, 0.3).translate(0, 0.13, 0), flat(0x8a8a86, 0.5, 0.4));
  rollBox.position.set(0, -0.02, -0.12); shObj.add(rollBox);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8), canvasMat(signTex('closed:' + note, [{ text: note, size: 76, color: '#b11414' }], 'card_board', 640, 400)));
  sign.position.set(0, -h * 0.55, 0.03); shMesh.add(sign);
  root.add(shObj);
  const shut: NonNullable<ShopFix['shutter']> = { obj: shObj, mesh: shMesh, h, tex: null, k: 0, collider: null, box: { c: fr.arr(off, h / 2, zFront + 0.05), s: [w, h, 0.12], yaw: fr.yaw } };
  Assets.loadTexture('textures/pbr/shutter_roller_painted/albedo.jpg', { srgb: true, repeat: [w / 2, h / 2] }).then((t) => {
    shMat.map = t; shMat.color.set(0xdedcd6); shMat.needsUpdate = true; shut.tex = t;
    t.repeat.y = Math.max(0.001, (h * shut.k) / 2); t.offset.y = 1 - t.repeat.y;
  }).catch(() => {});
  return { shut, sign };
}

// ------------------------------------------------------------------ 8-TWELVE
function buildStore(game: Game, s: ShopDef, door: Frame, ctr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  // counter (white laminate + 7-11-ish colour stripes, glass top display)
  const cw = 3.2;
  B.add(mbox(0.72, 1.0, cw, 1), flat(0xf2f0ea, 0.5), ctr, 0, 0, 0.75, Math.PI / 2);
  for (const [y, c] of [[0.62, 0xe8681e], [0.7, 0x1e8a4a], [0.78, 0xd8231a]] as [number, number][]) B.add(box(cw + 0.004, 0.06, 0.004), flat(c, 0.5), ctr, 0, y, 0.385 - 0.002);
  B.add(box(cw, 0.02, 0.74), flat(0xd9d6cf, 0.3), ctr, 0, 1.0, 0.75);
  // POS screen + scanner
  B.add(box(0.36, 0.26, 0.04), flat(0x111214, 0.3), ctr, -0.6, 1.02, 0.95);
  B.add(box(0.33, 0.22, 0.005), glow(0x9fd0ff, 0.8), ctr, -0.6, 1.04, 0.928);
  B.add(box(0.12, 0.05, 0.16), flat(0x202020, 0.4), ctr, -0.2, 1.02, 0.7);
  // salapao steamer on the counter (real photo of buns behind glass)
  B.add(box(0.5, 0.42, 0.42), flat(0xb8bcc0, 0.3, 0.7), ctr, 1.0, 1.02, 0.85);
  B.add(plane(0.44, 0.34).translate(0, 0.04, 0), photoMat('salapao', { emissive: 0.15 }), ctr, 1.0, 1.02, 0.635, 0);
  // back counter shelf behind the clerk: real 7-11 shelf photo
  const bk = photoPanel('seven_bottles', 3.0, 1.9, 0.04);
  B.add(bk.g, bk.m, ctr, 0, 0.2, 2.35, 0);
  // gondolas: 2 double-sided runs between the door and the counter (door frame: x = right, z = forward)
  const slots: Slot[] = [];
  const cards = new Map<string, THREE.Mesh>();
  const gond = (x: number, z0: number, len: number, photoA: string, photoB: string) => {
    B.add(mbox(0.9, 0.12, len, 1), flat(0x2a2c30, 0.6, 0.3), door, x, 0, z0 + len / 2);
    B.add(mbox(0.08, 1.55, len, 1), flat(0xe8e8e4, 0.5, 0.4), door, x, 0, z0 + len / 2);
    for (const side of [-1, 1]) {
      const p = photoPanel(side < 0 ? photoA : photoB, len, 1.4, 0.0);
      B.add(p.g, p.m, door, x + side * 0.05, 0.12, z0 + len / 2, side < 0 ? -Math.PI / 2 : Math.PI / 2);
      for (const y of [0.42, 0.82, 1.22]) B.add(mbox(0.4, 0.02, len, 1), flat(0xf4f4f0, 0.4, 0.4), door, x + side * 0.24, y, z0 + len / 2);
    }
  };
  gond(-3.0, 1.0, 3.4, 'seven_snacks', 'seven_noodles');
  gond(-5.6, 1.0, 3.4, 'seven_snacks2', 'seven_snacks');
  // drinks fridge along the south wall (door frame right = +z world… we use x = +5.6)
  const fx = 6.2;
  B.add(mbox(0.75, 2.1, 3.6, 1), flat(0xdedfe0, 0.4, 0.5), door, fx + 0.3, 0, 2.8);
  const fp = photoPanel('seven_fridge', 3.4, 1.85, 0.0);
  B.add(fp.g, mat('fridgephoto', () => { const m = photoMat('seven_fridge', { emissive: 0.35 }).clone(); return m; }), door, fx - 0.08, 0.12, 2.8, -Math.PI / 2);
  B.add(plane(3.4, 1.85).translate(0, 0.12, 0), glass(), door, fx - 0.12, 0, 2.8, -Math.PI / 2);
  // ceiling tubes
  for (const z of [1.5, 3.2]) B.add(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6).rotateX(Math.PI / 2), glow(0xf4fbff, 2.2), door, -2, 2.9, z);
  B.flush(root);
  // stock slots: snacks/sauces on gondola shelf fronts, drinks at the fridge front ledge
  const drinks = s.stock.filter((x) => /water|cola|fanta|m150|beer/.test(x.id));
  const dry = s.stock.filter((x) => !drinks.includes(x));
  const style: CardStyle = 'yellow';
  const shelfSpots: { x: number; y: number; z0: number; len: number; face: number }[] = [];
  for (const gx of [-3.0, -5.6]) for (const side of [-1, 1]) for (const y of [0.442, 0.842]) shelfSpots.push({ x: gx + side * 0.34, y, z0: 1.1, len: 3.2, face: side });
  dry.forEach((stk, i) => {
    const sp = shelfSpots[i % shelfSpots.length];
    const per = Math.ceil(dry.length / shelfSpots.length);
    const j = Math.floor(i / shelfSpots.length);
    const cwz = sp.len / Math.max(1, per + 1);
    const zc = sp.z0 + cwz * (j + 0.5) + (i % 3) * 0.9;
    const n = stk.show ?? 1;
    for (let k = 0; k < n; k++) slots.push({ stock: stk.id, p: door.arr(sp.x, sp.y, Math.min(sp.z0 + sp.len - 0.1, zc + k * 0.14)), yaw: door.yaw + sp.face * Math.PI / 2 });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(style, stk, nameOf(game, stk, kind), 0.16, i);
    c.position.copy(door.at(sp.x + sp.face * 0.21, sp.y - 0.03, zc)); c.rotation.y = door.yaw + sp.face * Math.PI / 2;
    root.add(c); cards.set(stk.id, c);
  });
  drinks.forEach((stk, i) => {
    const zc = 1.4 + i * 0.6;
    const n = stk.show ?? 2;
    for (let k = 0; k < n; k++) slots.push({ stock: stk.id, p: door.arr(fx - 0.22, 0.62 + (k % 2) * 0.004, zc + (k - (n - 1) / 2) * 0.1), yaw: door.yaw - Math.PI / 2 });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(style, stk, nameOf(game, stk, kind), 0.16, i + 9);
    c.position.copy(door.at(fx - 0.3, 0.52, zc)); c.rotation.y = door.yaw - Math.PI / 2;
    root.add(c); cards.set(stk.id, c);
  });
  // a ledge in front of the fridge for drinks
  const ledge = new THREE.Mesh(mbox(0.3, 0.6, 3.4, 1), flat(0xdcdcd8, 0.4, 0.5));
  ledge.position.copy(door.at(fx - 0.22, 0, 2.8)); ledge.rotation.y = door.yaw;
  root.add(ledge);
  const counterMesh = root.children[0];
  const colliders = [
    game.physics.addBox(ctr.arr(0, 0.5, 0.75), [cw, 1.0, 0.72], ctr.yaw),
    game.physics.addBox(door.arr(-3.0, 0.78, 2.7), [0.9, 1.56, 3.4], door.yaw),
    game.physics.addBox(door.arr(-5.6, 0.78, 2.7), [0.9, 1.56, 3.4], door.yaw),
    game.physics.addBox(door.arr(fx + 0.1, 1.05, 2.8), [1.0, 2.1, 3.6], door.yaw),
  ];
  // store rect (world) from the door: forward 0..7.5, right -7.5..6.8
  const c1 = door.at(-7.2, 0, -0.3), c2 = door.at(6.8, 0, 7.6);
  return {
    sid: s.id, root, slots, cards, cardStyle: style, counter: [counterMesh],
    keeper: { p: ctr.arr(0.2, 0, 1.6), yaw: ctr.back, sit: false },
    center: door.arr(0, 0, 3.2), radius: s.radius,
    rect: [Math.min(c1.x, c2.x), Math.min(c1.z, c2.z), Math.max(c1.x, c2.x), Math.max(c1.z, c2.z)],
    door: door.arr(0, 0, -0.3), colliders,
  };
}

// ------------------------------------------------------------------ แม็กโคร่ง
function buildWarehouse(game: Game, s: ShopDef, door: Frame, ctr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  // checkout lanes (conveyor counters)
  for (let lane = 0; lane < 3; lane++) {
    const x = lane * 3.2;
    B.add(mbox(2.6, 0.9, 0.8, 1), flat(0x3a3d42, 0.5, 0.4), ctr, x, 0, 0.75, Math.PI / 2 * 0);
    B.add(box(2.5, 0.02, 0.5), flat(0x111111, 0.7), ctr, x, 0.9, 0.75);
    B.add(box(0.05, 1.6, 0.05), flat(0x9a9a9a, 0.4, 0.6), ctr, x + 1.25, 0.9, 1.1);
    B.add(box(0.5, 0.3, 0.04), glow(lane === 0 ? 0x34c759 : 0xd8231a, 1.2), ctr, x + 1.25, 2.3, 1.1);
  }
  // pallet racks (orange beams, blue uprights) — 3 rows deeper inside
  const rackRows = [7, 10.5, 14];
  const rackLen = 10;
  for (const rz of rackRows) {
    for (let i = 0; i <= 4; i++) B.add(box(0.09, 3.6, 1.1), flat(0x1f4fa8, 0.5, 0.4), door, -1 + i * (rackLen / 4), 0, rz);
    for (const y of [1.2, 2.4]) for (const dz of [-0.5, 0.5]) B.add(box(rackLen, 0.1, 0.08), flat(0xe8681e, 0.5, 0.3), door, -1 + rackLen / 2, y, rz + dz);
    // pallets + bulk cartons on upper levels (cardboard PBR)
    for (let i = 0; i < 4; i++) {
      B.add(mbox(1.2, 0.14, 1.0, 1), pbr('wood_planks_old'), door, -1 + rackLen / 8 + i * (rackLen / 4), 0, rz);
      for (const y of [1.3, 2.5]) B.add(mbox(1.6, 0.8, 0.9, 0.6), pbr('cardboard_worn'), door, -1 + rackLen / 8 + i * (rackLen / 4), y, rz);
    }
  }
  // far wall photo: a real Makro aisle (depth illusion)
  const aisle = photoPanel('makro_aisle', 14, 6, 0.3);
  B.add(aisle.g, aisle.m, door, 4, 0, 19);
  B.flush(root);
  // stock: on the pallets (lowest level) of the 3 rows, both faces
  const slots: Slot[] = [];
  const cards = new Map<string, THREE.Mesh>();
  const style: CardStyle = 'shelf';
  const spots: { x: number; z: number; face: number }[] = [];
  for (const rz of rackRows) for (const face of [-1, 1]) for (let i = 0; i < 4; i++) spots.push({ x: -1 + rackLen / 8 + i * (rackLen / 4), z: rz + face * 0.25, face });
  s.stock.forEach((stk, i) => {
    const sp = spots[i % spots.length];
    const n = stk.show ?? 1;
    for (let k = 0; k < n; k++) slots.push({ stock: stk.id, p: door.arr(sp.x + (k - (n - 1) / 2) * 0.3, 0.145, sp.z), yaw: sp.face < 0 ? door.yaw : door.back });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(style, stk, nameOf(game, stk, kind), 0.4, i);
    c.position.copy(door.at(sp.x, 1.12, sp.z + sp.face * 0.31)); c.rotation.y = sp.face < 0 ? door.yaw : door.back;
    root.add(c); cards.set(stk.id, c);
  });
  const colliders: any[] = [];
  for (let lane = 0; lane < 3; lane++) colliders.push(game.physics.addBox(ctr.arr(lane * 3.2, 0.45, 0.75), [2.6, 0.9, 0.8], ctr.yaw));
  for (const rz of rackRows) for (let i = 0; i <= 4; i++) colliders.push(game.physics.addBox(door.arr(-1 + i * (rackLen / 4), 1.8, rz), [0.1, 3.6, 1.1], door.yaw));
  const c1 = door.at(-10, 0, -0.5), c2 = door.at(16, 0, 22);
  const { shut, sign } = makeShutter(game, root, door, 0, 5.2, 3.2, -0.2, (game.g.day ?? 1) < s.day ? (s.lockedNote?.th ?? 'ปิด') : (s.closedNote?.th ?? 'ปิด'));
  return {
    shutter: shut, closedSign: sign,
    sid: s.id, root, slots, cards, cardStyle: style, counter: [root.children[0]],
    keeper: { p: ctr.arr(0, 0, 1.45), yaw: ctr.back, sit: false },
    center: door.arr(3, 0, 9), radius: s.radius,
    rect: [Math.min(c1.x, c2.x), Math.min(c1.z, c2.z), Math.max(c1.x, c2.x), Math.max(c1.z, c2.z)],
    door: door.arr(0, 0, -0.3), colliders,
  };
}

// ------------------------------------------------------------------ entry
export function buildFixture(game: Game, s: ShopDef, kinds: Map<string, string>): ShopFix | null {
  const W = game.world;
  const a = W?.anchors[s.anchor];
  if (!a) return null;
  const fr = new Frame(a.p, a.yaw ?? 0);
  let fix: ShopFix;
  if (s.kind === 'stall') fix = buildStall(game, s, fr, kinds);
  else if (s.kind === 'shophouse') fix = buildShophouse(game, s, fr, kinds);
  else {
    const c = W!.anchors[s.counter ?? s.anchor] ?? a;
    const cf = new Frame(c.p, c.yaw ?? 0);
    fix = s.kind === 'store' ? buildStore(game, s, fr, cf, kinds) : buildWarehouse(game, s, fr, cf, kinds);
  }
  fix.root.traverse((o: any) => { if (o.isMesh && o.material?.transparent) o.castShadow = false; });
  return fix;
}

/** Animate a shutter towards closed amount k (0 open … 1 closed). */
export function setShutter(game: Game, fix: ShopFix, k: number) {
  const sh = fix.shutter;
  if (!sh) return;
  k = Math.max(0.0001, Math.min(1, k));
  if (Math.abs(sh.k - k) < 1e-4) return;
  sh.k = k;
  sh.mesh.scale.y = k;
  if (sh.tex) { sh.tex.repeat.y = (sh.h * k) / 2; sh.tex.offset.y = 1 - sh.tex.repeat.y; }
  if (fix.closedSign) fix.closedSign.visible = k > 0.95;
  const want = k > 0.9;
  if (want && !sh.collider && game.physics) sh.collider = game.physics.addBox(sh.box.c, sh.box.s, sh.box.yaw);
  else if (!want && sh.collider && game.physics) { try { game.physics.removeBody(sh.collider.parent()); } catch {} sh.collider = null; }
}

/** Re-render a product's price card (price change / sold out). */
export function updateCard(fix: ShopFix, st: StockDef, name: string, price: number, soldOut: boolean) {
  const m = fix.cards.get(st.id);
  if (!m) return;
  const key = `${price}|${soldOut}`;
  if (m.userData.key === key) return;
  m.userData.key = key;
  const tex = soldOut
    ? signTex('soldout:' + fix.sid + st.id, [{ text: name, size: 64, color: '#222' }, { text: 'หมดแล้ว', size: 96, color: '#c4121a', font: F.scrawl }], 'card_kraft', 448, 320)
    : priceCardTex(fix.cardStyle, name, st.unit, price, st.id.length);
  const mm = m.material as THREE.MeshStandardMaterial;
  mm.map = tex; mm.needsUpdate = true;
}
