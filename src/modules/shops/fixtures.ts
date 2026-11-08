import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/game';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import type { ShopDef, StockDef } from './data';
import { canvasMat, mat, photo, photoMat, signTex, CardStyle, CardAtlas } from './tex';
import { buildShape } from './items';
import { libModel, libInstanced } from '../world/lib';
import { rbox, tube, lathe, packRow, tagRail } from './kit';
import { packCell, packMaterial } from './packs';
import { realPropObject } from '../world/realprops';
import { PileBatch } from '../world/realprops-market';

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
  cards: Map<string, number>;
  cardStyle: CardStyle;
  atlas: CardAtlas;
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

/** Price card placeholder: positioned like a mesh, baked into the shop's card atlas mesh later. */
function card(atlas: CardAtlas, style: CardStyle, st: StockDef, name: string, w: number, seed: number) {
  const ar = style === 'star' ? 1 : style === 'card' ? 320 / 448 : 192 / 512;
  const o = new THREE.Object3D();
  o.userData.card = { i: atlas.add(style, name, st.unit, st.price, seed), w, h: w * ar };
  o.name = 'price:' + st.id;
  return o;
}

/** Merge all card placeholders of a shop into one mesh (one draw call). */
function bakeCards(root: THREE.Object3D, atlas: CardAtlas, cards: Map<string, number>) {
  const geos: THREE.BufferGeometry[] = [];
  const ph = root.children.filter((c) => c.userData.card);
  for (const o of ph) {
    o.updateMatrix();
    const { i, w, h } = o.userData.card;
    const g = new THREE.PlaneGeometry(w, h);
    const { u0, u1, v0, v1 } = atlas.uv(i);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) < 0.5 ? u0 : u1, uv.getY(k) < 0.5 ? v0 : v1);
    g.applyMatrix4(o.matrix);
    geos.push(g);
    cards.set(o.name.slice(6), i);
    o.removeFromParent();
  }
  if (!geos.length) return;
  const m = new THREE.Mesh(mergeGeometries(geos, false)!, new THREE.MeshStandardMaterial({ map: atlas.tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85 }));
  m.name = 'price-cards';
  m.castShadow = false; m.receiveShadow = true;
  root.add(m);
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

/** what each functional stall keeps on its back shelf (pile keys from realprops-market PILES) */
const STALL_BACK: Record<string, string[]> = {
  auntie_stall: ['heap_garlic', 'heap_shallot', 'heap_chili', 'heap_lime', 'heap_onion', 'heap_tomato'],
  butcher_stall: ['pork_table', 'heap_garlic', 'heap_chili', 'pork_table'],
  veg_stall: ['heap_beans', 'heap_basil', 'heap_onion', 'heap_tomato', 'heap_lime', 'heap_chili'],
  egg_stall: ['heap_eggs', 'heap_eggs', 'heap_garlic', 'heap_eggs', 'heap_shallot', 'heap_eggs'],
};
const CRATE_COLS = [0x2f62b8, 0xc42a22, 0x2a9a4a, 0xe8b820, 0x2f62b8, 0xe8508a];

/**
 * The back of a market stall (local frame of the stall: z = into the stall). A plank shelf on angle-steel legs
 * (two levels) holding plastic crates heaped with real produce, rice sacks + a stacked crate tower on the floor,
 * and a canvas curtain on a bamboo rail behind it all — the stall reads as a deep, busy shop, not a photo.
 */
function backDisplay(B: Batch, root: THREE.Object3D, fr: Frame, sid: string, st: { tarp: number; sheet: number }, z: number, W: number, piles: PileBatch) {
  const legs = flat(0x55585c, 0.6, 0.5);
  const plank = pbr('wood_planks_old');
  const D = 0.5, H1 = 0.55, H2 = 1.05, L = W - 0.1;
  for (const x of [-L / 2 + 0.04, L / 2 - 0.04, 0]) for (const dz of [-D / 2 + 0.04, D / 2 - 0.04]) B.add(tube([0, 0, 0], [0, H2 + 0.03, 0], 0.018, 8), legs, fr, x, 0, z + dz);
  for (const y of [H1, H2]) B.add(rbox(L, 0.035, D, 0.008, 1.2), plank, fr, 0, y, z);
  // crates on both levels, each heaped with produce
  const keys = STALL_BACK[sid] ?? STALL_BACK.auntie_stall;
  const n = Math.max(3, Math.floor(L / 0.52));
  const crates: THREE.Matrix4[] = [], cols: number[] = [];
  for (const [li, y] of [H1 + 0.035, H2 + 0.035].entries()) {
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (L / n) * (i + 0.5);
      const yaw = fr.yaw + Math.sin(i * 2.1 + li) * 0.08;
      crates.push(new THREE.Matrix4().makeRotationY(yaw).setPosition(fr.at(x, y, z)));
      cols.push(CRATE_COLS[(i + li * 2 + sid.length) % CRATE_COLS.length]);
      const key = keys[(i + li * 3) % keys.length];
      if (PileBatch.has(key)) piles.add(key, fr.at(x, y + 0.2, z), fr.yaw, 0.2, 0.15, sid.length * 13 + i * 5 + li * 31);
    }
  }
  root.add(libInstanced('plastic_crate_02', crates, { colors: cols, cull: 34 }));
  // floor: a rice sack pair + a crate tower at the end
  const sacks = [new THREE.Matrix4().makeRotationY(fr.yaw + 0.2).setPosition(fr.at(-L / 2 + 0.3, 0, z + 0.55)), new THREE.Matrix4().makeRotationY(fr.yaw - 0.15).multiply(new THREE.Matrix4().makeTranslation(0, 0.16, 0)).setPosition(fr.at(-L / 2 + 0.34, 0.16, z + 0.56))];
  root.add(libInstanced('rice_sack', sacks, { cull: 34 }));
  const tower: THREE.Matrix4[] = [], tc: number[] = [];
  for (let k = 0; k < 4; k++) { tower.push(new THREE.Matrix4().makeRotationY(fr.yaw + (k % 2) * 0.06).setPosition(fr.at(L / 2 + 0.2, k * 0.25, z + 0.45))); tc.push(CRATE_COLS[(k + 1) % CRATE_COLS.length]); }
  root.add(libInstanced('plastic_crate_02', tower, { colors: tc, cull: 34 }));
  // canvas curtain on a bamboo rail (gentle folds), 0.35 m behind the shelf
  const cz = z + D / 2 + 0.35, ch = 2.15;
  const cur = new THREE.PlaneGeometry(W + 0.4, ch, 24, 4);
  { const p = cur.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin(x * 7.5) * 0.045 * (0.6 + 0.4 * (0.5 - y / ch))); } cur.computeVertexNormals(); }
  cur.translate(0, ch / 2 + 0.05, 0).rotateY(Math.PI);
  B.add(cur, mat('curtain:' + st.tarp, () => { const m = Assets.pbr('canvas_tarp', { repeat: 2, color: st.tarp, fallback: st.tarp }).clone(); m.side = THREE.DoubleSide; m.color.multiplyScalar(0.8); return m; }), fr, 0, 0, cz, 0);
  B.add(new THREE.CylinderGeometry(0.025, 0.025, W + 0.6, 8).rotateZ(Math.PI / 2), pbr('bamboo_poles', undefined, 0xb89a62), fr, 0, ch + 0.1, cz);
  // plastic bags of chillies / garlic hanging from the shelf's top rail
  for (let i = 0; i < 5; i++) {
    const x = -L / 2 + 0.25 + i * (L - 0.5) / 4;
    B.add(tube([0, H2 + 0.6, 0], [0, H2 + 0.38, 0], 0.003, 4), legs, fr, x, 0, z - D / 2 + 0.05);
    const bag = lathe([[0.0001, 0], [0.05, 0.01], [0.065, 0.06], [0.06, 0.13], [0.03, 0.17], [0.012, 0.2], [0.0001, 0.21]], 10);
    B.add(bag, mat('hangbag:' + (i % 3), () => new THREE.MeshStandardMaterial({ color: [0xd8231a, 0xe8dcc8, 0x3a8a2a][i % 3], roughness: 0.35, metalness: 0, transparent: true, opacity: 0.92 })), fr, x, H2 + 0.17, z - D / 2 + 0.05);
  }
  B.add(tube([-L / 2, H2 + 0.6, 0], [L / 2, H2 + 0.6, 0], 0.012, 8), legs, fr, 0, 0, z - D / 2 + 0.05);
}

function buildStall(game: Game, s: ShopDef, fr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  const st = STALL_STYLE[s.id] ?? STALL_STYLE.auntie_stall;
  const W = 2.6, D = 1.05, H = 0.8, zc = 0.95;
  // table: steel legs, plank top, plastic sheet with overhang skirt
  const legs = flat(0x55585c, 0.6, 0.5);
  for (const [x, z] of [[-W / 2 + 0.06, zc - D / 2 + 0.06], [W / 2 - 0.06, zc - D / 2 + 0.06], [-W / 2 + 0.06, zc + D / 2 - 0.06], [W / 2 - 0.06, zc + D / 2 - 0.06]]) {
    B.add(tube([0, 0.02, 0], [0, H - 0.04, 0], 0.022, 10), legs, fr, x, 0, z);
    B.add(lathe([[0.03, 0], [0.03, 0.02], [0.0001, 0.02]], 10), pbr('rubber_black', undefined, 0x202020), fr, x, 0, z);
  }
  // long-side rails under the top (welded angle) + plank top with bevelled edges
  for (const z of [zc - D / 2 + 0.06, zc + D / 2 - 0.06]) B.add(tube([-W / 2 + 0.06, H - 0.07, 0], [W / 2 - 0.06, H - 0.07, 0], 0.016, 8), legs, fr, 0, 0, z);
  B.add(rbox(W, 0.04, D, 0.008, 1.2), pbr('wood_planks_old'), fr, 0, H - 0.04, zc);
  const sheet = pbr('canvas_tarp', st.sheet, st.sheet);
  B.add(rbox(W + 0.08, 0.012, D + 0.06, 0.004, 0.6), sheet, fr, 0, H, zc);
  // front skirt (cloth hanging), slightly wavy
  const skirt = new THREE.PlaneGeometry(W + 0.08, 0.42, 16, 1);
  { const p = skirt.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.015); skirt.computeVertexNormals(); }
  skirt.translate(0, H - 0.21, 0);
  B.add(skirt, mat('skirt:' + st.sheet, () => { const m = (sheet as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; }), fr, 0, 0, zc - D / 2 - 0.035, 0);
  // raised back tier (crate) for a second row of goods
  const tier = pbr('plastic_rough', 0x2f62b8, 0x2f62b8);
  B.add(rbox(W - 0.1, 0.16, 0.42, 0.02, 0.5), tier, fr, 0, H + 0.012, zc + 0.27);
  // canopy: 4 bamboo poles + slanted tarp
  const pole = pbr('bamboo_poles', undefined, 0xb89a62);
  const ph = 2.35;
  for (const [x, z] of [[-W / 2 - 0.05, zc - D / 2 - 0.05], [W / 2 + 0.05, zc - D / 2 - 0.05], [-W / 2 - 0.05, zc + D / 2 + 0.55], [W / 2 + 0.05, zc + D / 2 + 0.55]]) B.add(new THREE.CylinderGeometry(0.03, 0.035, ph + (z > zc ? 0.25 : 0), 6).translate(0, (ph + (z > zc ? 0.25 : 0)) / 2, 0), pole, fr, x, 0, z);
  const tarp = new THREE.PlaneGeometry(W + 0.5, D + 0.9, 10, 4);
  { const p = tarp.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -0.06 * Math.sin((x / (W + 0.5)) * Math.PI * 3) * Math.cos(y * 2) - 0.08 * (1 - Math.abs(x) / ((W + 0.5) / 2))); } tarp.computeVertexNormals(); }
  tarp.rotateX(-Math.PI / 2 + 0.16);
  B.add(tarp, mat('tarp:' + st.tarp, () => { const m = Assets.pbr('canvas_tarp', { repeat: 2, color: st.tarp, fallback: st.tarp }).clone(); m.side = THREE.DoubleSide; return m; }), fr, 0, ph + 0.1, zc + 0.25);
  // hanging fluorescent tube
  B.add(rbox(1.18, 0.04, 0.07, 0.012, 1), pbr('metal_painted_chipped', 0xf0efe8, 0xf0efe8), fr, 0, ph - 0.23, zc + 0.2);
  B.add(new THREE.CylinderGeometry(0.014, 0.014, 1.1, 10).rotateZ(Math.PI / 2), glow(0xfff3dc, 1.6), fr, 0, ph - 0.25, zc + 0.2);
  B.add(tube([0, ph - 0.19, 0], [0, ph + 0.05, 0], 0.003, 4), legs, fr, -0.45, 0, zc + 0.2);
  B.add(tube([0, ph - 0.19, 0], [0, ph + 0.05, 0], 0.003, 4), legs, fr, 0.45, 0, zc + 0.2);
  // keeper stool (red plastic)
  const stool = buildShape('sfb_stool');
  if (stool) { stool.position.copy(fr.at(0.55, 0, zc + D / 2 + 0.75)); root.add(stool); }
  // decorative heaps on the back tier (real produce photos) + baskets on the floor
  const piles = new PileBatch();
  st.decor.forEach((key, i) => {
    const x = (i - (st.decor.length - 1) / 2) * 0.62 + 0.05;
    const bz = zc + D / 2 + 0.35;
    const bk = libModel('wicker_basket_01');   // real photoscanned wicker basket (shared library)
    bk.scale.set(1.4, 1, 1.4); bk.position.copy(fr.at(x, 0, bz)); bk.rotation.y = fr.yaw + i * 0.4;
    root.add(bk);
    piles.add(key, fr.at(x, 0.06, bz), fr.yaw, 0.25, 0.19, s.id.length * 7 + i);   // real produce heaped in it
  });
  // back display behind the keeper (real 3D, no photo): a 2-level plank shelf on steel legs stocked with
  // crates of produce, sacks on the floor, and a hanging canvas curtain closing the stall off
  backDisplay(B, root, fr, s.id, st, zc + D / 2 + 1.2, W, piles);
  piles.flush(root);
  B.flush(root);
  // spring scale hanging from the canopy (real model) + a rubber-keyed calculator on the table
  const scale = realPropObject('hanging_scale');
  scale.position.copy(fr.at(W / 2 - 0.25, ph - 0.95, zc - 0.05)); scale.rotation.y = fr.yaw - 0.3;
  root.add(scale);
  const calc = new THREE.Group();
  calc.add(new THREE.Mesh(rbox(0.12, 0.018, 0.15, 0.006, 1), pbr('plastic_rough', 0x333336, 0x333336)));
  { const face = new THREE.Mesh(plane(0.104, 0.134).rotateX(-Math.PI / 2).translate(0, 0.0185, 0), photoMat('calculator')); calc.add(face); }
  calc.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  calc.position.copy(fr.at(-W / 2 + 0.22, H + 0.012, zc + 0.36)); calc.rotation.y = fr.back + 0.25;
  root.add(calc);
  // shop name sign hanging from the canopy (hand-painted on cardboard)
  const sign = new THREE.Mesh(plane(0.86, 0.32), canvasMat(signTex('stall:' + s.id, [{ text: st.sign, size: 120, color: '#8c1414' }], 'card_kraft', 640, 240)));
  sign.position.copy(fr.at(0, ph - 0.36, zc - D / 2 - 0.12)); sign.rotation.y = fr.yaw;
  root.add(sign);
  // display slots: 2 rows (front on the sheet, back on the tier)
  const slots: Slot[] = [];
  const cards = new Map<string, number>();
  const atlas = new CardAtlas(s.stock.length);
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
      const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.2, i + ri * 3 + s.id.length);
      c.position.copy(fr.at(xc, y + (ri === 0 || rows.length === 1 ? 0.13 : 0.2), zRow - (rows.length === 1 ? 0.32 : 0.18)));
      c.rotation.set(0, fr.yaw, 0, 'YXZ');
      c.rotateX(-0.35);
      root.add(c);
    });
  });
  // closed: blue tarp draped over the table
  const cover = new THREE.Mesh((() => { const g = new THREE.BoxGeometry(W + 0.2, 0.5, D + 0.25, 10, 2, 4); const p = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * (1 + (y < 0 ? 0.04 : 0)), y + Math.sin(x * 7 + z * 5) * 0.03, z); } g.computeVertexNormals(); return g.translate(0, H + 0.02, 0); })(), pbr('canvas_tarp', 0x2a58b0, 0x2a58b0));
  cover.position.copy(fr.at(0, 0, zc)); cover.rotation.y = fr.yaw; cover.visible = false; cover.castShadow = true;
  root.add(cover);
  bakeCards(root, atlas, cards);
  const colliders = [game.physics.addBox(fr.arr(0, H / 2, zc + 0.05), [W + 0.1, H, D + 0.1], fr.yaw)];
  return {
    sid: s.id, root, slots, cards, cardStyle: style, atlas, counter: [cover, sign],
    keeper: { p: fr.arr(-0.25, 0, zc + D / 2 + 0.55), yaw: fr.back, sit: false },
    center: fr.arr(0, 0, zc), radius: s.radius, tarp: cover, colliders, calc,
  };
}

// ------------------------------------------------------------------ SHOPHOUSE (open front + shutter)
interface Good { id: string; w: number; h?: number; stack?: number; colors?: number[]; drop?: number; /** pitch (flat things hung on a hook stand upright) */ rx?: number }
const PLASTICS = [0x2f6fd8, 0xc42a22, 0x2a9a4a, 0xe8b820, 0xe8508a, 0xf2f0ea, 0x7a4fb0];
/** what fills each functional shop's racks, floor and facade hooks (shared library models) */
const SHOP_DRESS: Record<string, { rack: Good[]; floor: Good[]; hang: Good[] }> = {
  plastic_shop: {
    rack: [{ id: 'plastic_basket', w: 0.29, h: 0.09, stack: 3, colors: PLASTICS }, { id: 'plastic_crate_02', w: 0.43, h: 0.25, colors: PLASTICS }, { id: 'plastic_bottle_gallon', w: 0.14, colors: [0xffffff] }, { id: 'plastic_jerrycan', w: 0.29, colors: [0x2f6fd8, 0xe8b820, 0xc42a22] }],
    floor: [{ id: 'industrial_pastic_container', w: 0.5, h: 0.4, stack: 2, colors: [0x2f6fd8, 0xf2f0ea] }, { id: 'plastic_crate_02', w: 0.5, h: 0.25, stack: 4, colors: PLASTICS }, { id: 'plastic_broom', w: 0.4 }, { id: 'thai_stool', w: 0.37, h: 0.12, stack: 6, colors: [0xc42a22, 0x2f6fd8] }],
    hang: [{ id: 'plastic_basket', w: 0.4, drop: 0.12, h: 0.19, colors: PLASTICS }, { id: 'plastic_broom', w: 0.4, drop: 0.08, h: 1.2 }, { id: 'plastic_basket', w: 0.4, drop: 0.18, h: 0.19, colors: PLASTICS }, { id: 'dustpan', w: 0.33, drop: 0.1, h: 0.1 }, { id: 'plastic_basket', w: 0.4, drop: 0.12, h: 0.19, colors: PLASTICS }],
  },
  kitchen_shop: {
    rack: [{ id: 'khan_bowl', w: 0.21, h: 0.04, stack: 4 }, { id: 'kradong', w: 0.42, h: 0.02, stack: 5 }, { id: 'ceramic_pot', w: 0.45 }, { id: 'tamarind_board', w: 0.4, h: 0.075, stack: 3 }, { id: 'cleaner_tin_01', w: 0.1, stack: 2, h: 0.13 }],
    floor: [{ id: 'ong_jar', w: 0.65 }, { id: 'ceramic_pot', w: 0.6 }, { id: 'small_lpg_tank', w: 0.42 }, { id: 'wooden_crate_01', w: 0.8, h: 0.35, stack: 2 }],
    hang: [{ id: 'kradong', w: 0.72, drop: 0.05, h: 0.36, rx: Math.PI / 2 }, { id: 'fish_knife', w: 0.1, drop: 0.08, h: 0.22 }, { id: 'kradong', w: 0.72, drop: 0.09, h: 0.36, rx: Math.PI / 2 }, { id: 'wooden_broom', w: 0.5, drop: 0.08, h: 1.4 }],
  },
  gas_shop: {
    rack: [{ id: 'small_lpg_tank', w: 0.42 }, { id: 'propane_tank', w: 0.34 }, { id: 'plastic_bottle_gallon', w: 0.17, colors: [0xffffff] }, { id: 'cleaner_tin_01', w: 0.1, h: 0.13, stack: 2 }],
    floor: [{ id: 'lpg_15kg', w: 0.3 }, { id: 'lpg_15kg', w: 0.3 }, { id: 'propane_tank', w: 0.34 }, { id: 'lpg_15kg', w: 0.3 }, { id: 'hand_truck', w: 0.6 }],
    hang: [{ id: 'hose_coil', w: 0.48, drop: 0.05, h: 0.24, rx: Math.PI / 2 }],
  },
};

/**
 * Slotted-angle steel shelving unit (the grey Thai shop rack): 4 bevelled angle uprights with base feet,
 * `levels` galvanised decks with folded lips, X-brace on the back. Faces -side*x (toward the aisle).
 * Returns the deck top heights.
 */
function steelRack(B: Batch, fr: Frame, x: number, z: number, d: number, w: number, h: number, levels: number, side: number) {
  const ang = pbr('metal_painted_chipped', 0x7a8288, 0x7a8288);
  const deck = pbr('galvanized_steel', 0xcfd2d2, 0xb8bcbc);
  for (const dx of [-d / 2 + 0.02, d / 2 - 0.02]) for (const dz of [-w / 2 + 0.02, w / 2 - 0.02]) {
    B.add(rbox(0.035, h, 0.035, 0.004, 0.5), ang, fr, x + dx, 0, z + dz);
    B.add(rbox(0.06, 0.008, 0.06, 0.002, 0.5), ang, fr, x + dx, 0, z + dz);
  }
  const ys: number[] = [];
  for (let i = 0; i < levels; i++) {
    const y = 0.12 + (i * (h - 0.25)) / (levels - 1);
    B.add(rbox(d, 0.012, w, 0.003, 1), deck, fr, x, y, z);
    B.add(rbox(0.012, 0.035, w, 0.003, 1), deck, fr, x - side * (d / 2 - 0.006), y - 0.025, z);
    ys.push(y + 0.012);
  }
  // back X brace
  const bx = x + side * (d / 2 - 0.02);
  B.add(tube([0, 0.15, -w / 2 + 0.03], [0, h - 0.1, w / 2 - 0.03], 0.006, 5), ang, fr, bx, 0, z);
  B.add(tube([0, 0.15, w / 2 - 0.03], [0, h - 0.1, -w / 2 + 0.03], 0.006, 5), ang, fr, bx, 0, z);
  return ys;
}

const HOUSE_STYLE: Record<string, { wall: string; side: string; hang?: string[]; table: number; counterTop: number }> = {
  plastic_shop: { wall: 'plastic_wall2', side: 'plastic_wall', hang: ['tub_blue', 'basin_navy', 'basket_red', 'tub_blue'], table: 0x6b4a2a, counterTop: 0x9a7a52 },
  kitchen_shop: { wall: 'kitchen_wall', side: 'kitchen_plates', hang: ['kradong'], table: 0x5a4030, counterTop: 0x8a6a4a },
  gas_shop: { wall: 'gas_row', side: 'gas_row', table: 0x4a4a48, counterTop: 0x6a6a66 },
};

const ROOM_STYLE: Record<string, { wall: number; tile: number; ceil: number }> = {
  plastic_shop: { wall: 0xdfe9d8, tile: 0xf2f2ee, ceil: 0xf4f2ea },
  kitchen_shop: { wall: 0xf0e2c4, tile: 0xe8eef2, ceil: 0xf6f2e8 },
  gas_shop: { wall: 0xd8e2ea, tile: 0xe6e6e2, ceil: 0xf2f2ee },
};

/** a Thai wall calendar (gold-red header, big month grid) painted once */
function calendarMat() {
  return mat('shop-calendar', () => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 360;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#fbf8f0'; x.fillRect(0, 0, 256, 360);
    const g = x.createLinearGradient(0, 0, 0, 120); g.addColorStop(0, '#c8141a'); g.addColorStop(1, '#8a0c10');
    x.fillStyle = g; x.fillRect(0, 0, 256, 120);
    x.fillStyle = '#f7c84a'; x.beginPath(); x.arc(128, 56, 34, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#8a0c10'; x.font = `900 30px ${F.heavy}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('福', 128, 58);
    x.fillStyle = '#ffe9a8'; x.font = `800 16px ${F.ui}`; x.fillText('ร้านเจริญ ขอบคุณลูกค้า', 128, 104);
    x.fillStyle = '#c8141a'; x.font = `900 26px ${F.heavy}`; x.fillText('พฤศจิกายน', 128, 146);
    x.font = `700 15px ${F.ui}`;
    for (let i = 0; i < 35; i++) {
      const cx = 22 + (i % 7) * 35, cy = 182 + Math.floor(i / 7) * 34, d = i - 2;
      if (d < 1 || d > 30) continue;
      x.fillStyle = i % 7 === 0 ? '#c8141a' : '#2a2420'; x.fillText(String(d), cx, cy);
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide });
  });
}

/**
 * The shop's ROOM: a full interior instead of photo panels — plastered side walls, a half-tiled back wall,
 * a painted ceiling slab with two fluorescent fittings that really light the room (world light pool, on by day),
 * a ceiling fan, two slotted-steel racks along the back wall full of goods, a wall clock, a Thai calendar and the
 * red shrine shelf with a lucky cat, garland and candles over the counter, a real cash register on the counter.
 */
function shopRoom(game: Game, B: Batch, root: THREE.Object3D, fr: Frame, sid: string, sw: { w: number; off: number; h: number }, zFront: number,
  dress: { rack: Good[] }, put: (id: string, x: number, y: number, z: number, yaw: number, color?: number, rx?: number) => void) {
  const st = ROOM_STYLE[sid] ?? ROOM_STYLE.plastic_shop;
  const ceilY = sw.h + 0.12;
  const zBack = zFront + 4.95;
  const halfW = sw.w / 2 - 0.04;
  const depth = zBack - (zFront + 0.02);
  const zMid = (zBack + zFront) / 2;
  const wallM = pbr('plaster_painted_clean', st.wall, st.wall);
  const tileM = pbr('tiles_wall_white_dirty', st.tile, st.tile);
  // side walls (inside faces), full height
  for (const side of [-1, 1]) B.add(mbox(0.04, ceilY, depth, 1.6), wallM, fr, sw.off + side * halfW, 0, zMid);
  // back wall: tiles up to 1.25 m, plaster above, a skirting strip
  B.add(mbox(sw.w - 0.08, 1.25, 0.04, 0.6), tileM, fr, sw.off, 0, zBack);
  B.add(mbox(sw.w - 0.08, ceilY - 1.25, 0.04, 1.6), wallM, fr, sw.off, 1.25, zBack + 0.004);
  B.add(rbox(sw.w - 0.1, 0.03, 0.02, 0.006, 1), pbr('metal_painted_chipped', 0x8a7a62, 0x8a7a62), fr, sw.off, 1.24, zBack - 0.025);
  // ceiling slab (painted underside) + a cornice line
  B.add(mbox(sw.w - 0.04, 0.06, depth + 0.04, 1.6), pbr('plaster_painted_clean', st.ceil, st.ceil), fr, sw.off, ceilY, zMid);
  // two fluorescent fittings (batten + diffuser tube) and their light
  const fitM = pbr('metal_painted_chipped', 0xf2f2f0, 0xf2f2f0);
  for (const fz of [zFront + 1.4, zFront + 3.5]) {
    B.add(rbox(1.26, 0.05, 0.12, 0.012, 1), fitM, fr, sw.off, ceilY - 0.05, fz);
    B.add(new THREE.CylinderGeometry(0.016, 0.016, 1.18, 10).rotateZ(Math.PI / 2), glow(0xf3fbff, 2.4), fr, sw.off, ceilY - 0.075, fz);
    const lp = (game.world as any)?.addLightPoint?.(fr.at(sw.off, ceilY - 0.25, fz), 0xeef6ff, 9, 7.5, 0);
    if (lp) { lp.day = 0.85; lp.kind = 'store'; }
  }
  const fan = libModel('ceiling_fan'); fan.position.copy(fr.at(sw.off - 1.2, ceilY - 0.52, zFront + 2.45)); fan.rotation.y = fr.yaw; root.add(fan);
  // two racks along the back wall, facing the street, full of goods
  const rackLen = Math.min(2.4, (sw.w - 1.0) / 2);
  for (const side of [-1, 1]) {
    const xc = sw.off + side * (rackLen / 2 + 0.25);
    const ys = backRack(B, fr, xc, zBack - 0.3, rackLen, 2.05, 4);
    ys.forEach((y, li) => {
      const row = dress.rack[(li + (side > 0 ? 2 : 0)) % dress.rack.length];
      const n = Math.max(1, Math.floor((rackLen - 0.1) / row.w));
      for (let i = 0; i < n; i++) {
        const xx = xc - rackLen / 2 + 0.05 + row.w * (i + 0.5);
        for (let k = 0; k < (row.stack ?? 1); k++) put(row.id, xx, y + k * (row.h ?? 0.1), zBack - 0.32, Math.sin(i * 2.7 + li) * 0.12, row.colors ? row.colors[(i + li + k) % row.colors.length] : undefined);
      }
    });
  }
  // wall clock (left wall) + calendar (right wall) + shrine shelf over the counter corner
  const clock = libModel('wall_clock'); clock.position.copy(fr.at(sw.off - halfW + 0.03, 2.35, zFront + 2.2)); clock.rotation.y = fr.yaw + Math.PI / 2; root.add(clock);
  B.add(plane(0.36, 0.5), calendarMat(), fr, sw.off + halfW - 0.025, 1.55, zFront + 2.0, -Math.PI / 2);
  const shX = sw.off + halfW - 0.4, shZ = zBack - 0.22, shY = 2.15;
  const red = pbr('wood_painted_weathered', 0xb81c1c, 0xb81c1c);
  B.add(rbox(0.62, 0.03, 0.32, 0.008, 1), red, fr, shX, shY, shZ);
  B.add(rbox(0.62, 0.32, 0.02, 0.006, 1), red, fr, shX, shY, shZ + 0.15);
  for (const dx of [-0.29, 0.29]) B.add(rbox(0.03, 0.32, 0.32, 0.006, 1), red, fr, shX + dx, shY, shZ);
  B.add(rbox(0.66, 0.035, 0.34, 0.008, 1), pbr('metal_painted_chipped', 0xd8a838, 0xd8a838), fr, shX, shY + 0.32, shZ);
  const cat = libModel('lucky_cat_gold'); cat.position.copy(fr.at(shX, shY + 0.03, shZ + 0.02)); cat.rotation.y = fr.yaw; root.add(cat);
  for (const dx of [-0.2, 0.2]) {
    B.add(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8).translate(0, 0.045, 0), flat(0xc8141a, 0.5), fr, shX + dx, shY + 0.03, shZ - 0.05);
    B.add(new THREE.SphereGeometry(0.008, 6, 4).scale(1, 1.8, 1).translate(0, 0.105, 0), glow(0xffb040, 3), fr, shX + dx, shY + 0.03, shZ - 0.05);
  }
  B.add(new THREE.TorusGeometry(0.07, 0.016, 6, 16).rotateX(Math.PI / 2), mat('garland-orange', () => new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.7 })), fr, shX - 0.12, shY + 0.045, shZ + 0.02);
  const sp = (game.world as any)?.addLightPoint?.(fr.at(shX, shY + 0.2, shZ - 0.15), 0xff9a40, 1.2, 1.6, 0.12);
  if (sp) sp.day = 0.6;
}

/** slotted-steel rack along the BACK wall (long axis = local x), faces the street (−z). Returns deck tops. */
function backRack(B: Batch, fr: Frame, xc: number, z: number, len: number, h: number, levels: number) {
  const ang = pbr('metal_painted_chipped', 0x7a8288, 0x7a8288);
  const deck = pbr('galvanized_steel', 0xcfd2d2, 0xb8bcbc);
  const d = 0.48;
  for (const dx of [-len / 2 + 0.02, len / 2 - 0.02]) for (const dz of [-d / 2 + 0.02, d / 2 - 0.02]) B.add(rbox(0.035, h, 0.035, 0.004, 0.5), ang, fr, xc + dx, 0, z + dz);
  const ys: number[] = [];
  for (let i = 0; i < levels; i++) {
    const y = 0.12 + (i * (h - 0.25)) / (levels - 1);
    B.add(rbox(len, 0.012, d, 0.003, 1), deck, fr, xc, y, z);
    B.add(rbox(len, 0.035, 0.012, 0.003, 1), deck, fr, xc, y - 0.025, z - d / 2 + 0.006);
    ys.push(y + 0.012);
  }
  B.add(tube([-len / 2 + 0.03, 0.15, 0], [len / 2 - 0.03, h - 0.1, 0], 0.006, 5), ang, fr, xc, 0, z + d / 2 - 0.02);
  B.add(tube([len / 2 - 0.03, 0.15, 0], [-len / 2 + 0.03, h - 0.1, 0], 0.006, 5), ang, fr, xc, 0, z + d / 2 - 0.02);
  return ys;
}

function buildShophouse(game: Game, s: ShopDef, fr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  const hs = HOUSE_STYLE[s.id] ?? HOUSE_STYLE.plastic_shop;
  const sw = s.shutter ?? { w: 7.6, off: 0, h: 3.1 };
  const zFront = -1.2; // facade line (anchors are 1 m inside, the facade is at ±6)
  // floor tiles inside (in case the world interior is plain) — thin, slightly above the slab
  B.add(mbox(sw.w - 0.3, 0.012, 4.6, 1.5), pbr('tiles_floor_ceramic'), fr, sw.off, 0.0, zFront + 2.4);
  const dress = SHOP_DRESS[s.id] ?? SHOP_DRESS.plastic_shop;
  const goods = new Map<string, { m: THREE.Matrix4[]; c: number[] }>();
  const put = (id: string, x: number, y: number, z: number, yaw: number, color?: number, rx = 0) => {
    let e = goods.get(id); if (!e) goods.set(id, (e = { m: [], c: [] }));
    const m = new THREE.Matrix4().makeRotationY(fr.yaw + yaw);
    if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
    e.m.push(m.setPosition(fr.at(x, y, z))); e.c.push(color ?? 0xffffff);
  };
  for (const side of [-1, 1]) {
    const x = sw.off + side * (sw.w / 2 - 0.42);
    for (let k = 0; k < 3; k++) {
      const z = zFront + 1.85 + k * 0.98;
      const lv = steelRack(B, fr, x, z, 0.5, 0.94, 2.0, 4, side);
      lv.forEach((y, li) => {
        const row = dress.rack[(li + k + (side > 0 ? 1 : 0)) % dress.rack.length];
        const n = Math.max(1, Math.floor(0.86 / row.w));
        for (let i = 0; i < n; i++) {
          const zz = z - 0.43 + row.w * (i + 0.5);
          for (let st = 0; st < (row.stack ?? 1); st++) put(row.id, x + side * 0.02, y + st * (row.h ?? 0.1), zz, side * Math.PI / 2 + Math.sin(i * 2.3 + li) * 0.15, row.colors ? row.colors[(i + li + st) % row.colors.length] : undefined);
        }
      });
    }
  }
  // goods on the floor along the counter side + by the entrance
  dress.floor.forEach((f, i) => {
    const xx = sw.off + (i % 2 ? 1 : -1) * (0.5 + (i >> 1) * 0.55), zz = zFront + 4.1 - (i % 3) * 0.12;
    for (let st = 0; st < (f.stack ?? 1); st++) put(f.id, xx, st * (f.h ?? 0.1), zz, i * 0.7, f.colors ? f.colors[(i + st) % f.colors.length] : undefined);
  });
  // ---- the room: plastered side walls, tiled back wall, painted ceiling, lights, back shelving + Thai shop details
  shopRoom(game, B, root, fr, s.id, sw, zFront, dress, put);
  // stepped display tables left & right of the entrance aisle
  const slots: Slot[] = [];
  const cards = new Map<string, number>();
  const atlas = new CardAtlas(s.stock.length);
  const tableMat = pbr('wood_painted_weathered', undefined, hs.table);
  const steps: { x: number; z: number; w: number; d: number; h: number }[] = [
    { x: sw.off - 1.55, z: zFront + 1.25, w: 2.0, d: 0.9, h: 0.62 },
    { x: sw.off + 1.55, z: zFront + 1.25, w: 2.0, d: 0.9, h: 0.62 },
  ];
  for (const t of steps) {
    // stepped display stand: plank tops with bevelled edges on a framed base with a recessed kick
    B.add(rbox(t.w - 0.06, t.h - 0.08, t.d - 0.06, 0.02, 1.2), tableMat, fr, t.x, 0.06, t.z);
    B.add(rbox(t.w - 0.12, 0.06, t.d - 0.12, 0.01, 1.2), pbr('metal_painted_chipped', 0x2a2a2a, 0x2a2a2a), fr, t.x, 0, t.z);
    B.add(rbox(t.w, 0.035, t.d, 0.012, 1.2), tableMat, fr, t.x, t.h - 0.035, t.z);
    B.add(rbox(t.w - 0.04, 0.27, t.d * 0.45, 0.015, 1.2), tableMat, fr, t.x, t.h, t.z + t.d * 0.27);
    B.add(rbox(t.w, 0.03, t.d * 0.47, 0.01, 1.2), tableMat, fr, t.x, t.h + 0.27, t.z + t.d * 0.27);
  }
  // keeper counter (glass-top wooden desk with cash box) at the back right
  const cx = sw.off + 1.7, cz = zFront + 3.05;
  B.add(rbox(1.3, 0.84, 0.62, 0.02, 1), pbr('plywood', undefined, hs.counterTop), fr, cx, 0, cz);
  B.add(rbox(1.24, 0.05, 0.56, 0.01, 1), pbr('metal_painted_chipped', 0x2a2a2a, 0x2a2a2a), fr, cx, 0, cz);
  for (const [gx, gz] of [[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]]) B.add(lathe([[0.012, 0], [0.012, 0.012], [0.0001, 0.012]], 8), pbr('aluminium_scratched'), fr, cx + gx, 0.84, cz + gz);
  B.add(rbox(1.32, 0.008, 0.64, 0.003, 1), glass(), fr, cx, 0.852, cz);
  // tin cash box: body, hinged lid with a handle, keyhole
  B.add(rbox(0.32, 0.09, 0.24, 0.012, 1), pbr('metal_painted_chipped', 0x2a5a9a, 0x2a5a9a), fr, cx + 0.3, 0.86, cz);
  B.add(rbox(0.33, 0.03, 0.25, 0.01, 1), pbr('metal_painted_chipped', 0x2a5a9a, 0x2a5a9a), fr, cx + 0.3, 0.95, cz);
  B.add(tube([-0.06, 0.985, 0], [0.06, 0.985, 0], 0.006, 6), pbr('aluminium_scratched'), fr, cx + 0.3, 0, cz);
  B.add(rbox(0.13, 0.02, 0.16, 0.006, 1), flat(0x2c2c2e, 0.45), fr, cx - 0.02, 0.86, cz - 0.08, 0.3);
  B.add(plane(0.11, 0.14).rotateX(-Math.PI / 2).translate(0, 0.0205, 0), photoMat('calculator'), fr, cx - 0.02, 0.86, cz - 0.08, 0.3);
  // ---- a real cash register on the counter
  const reg = libModel('CashRegister_01'); reg.scale.setScalar(0.62); reg.position.copy(fr.at(cx - 0.42, 0.86, cz + 0.06)); reg.rotation.y = fr.back; root.add(reg);
  // hanging goods at the facade (real product cut-outs)
  B.add(tube([-sw.w / 2 + 0.3, 2.6, 0], [sw.w / 2 - 0.3, 2.6, 0], 0.006, 6), pbr('aluminium_scratched'), fr, sw.off, 0, zFront + 0.18);
  dress.hang.forEach((hg, i) => {
    const n = dress.hang.length;
    const x = sw.off + (i - (n - 1) / 2) * Math.min(0.75, (sw.w - 0.8) / n);
    B.add(tube([0, 2.6, 0], [0, 2.6 - (hg.drop ?? 0.1), 0], 0.004, 5), pbr('aluminium_scratched'), fr, x, 0, zFront + 0.18);
    put(hg.id, x, 2.6 - (hg.drop ?? 0.1) - (hg.h ?? 0.2), zFront + 0.18, hg.rx ? 0 : i * 0.9, hg.colors ? hg.colors[i % hg.colors.length] : undefined, hg.rx ?? 0);
  });
  B.flush(root);
  for (const [id, e] of goods) root.add(libInstanced(id, e.m, { colors: e.c, cull: 32 }));
  // keeper stool (real moulded Thai stool)
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
    const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.3, i);
    c.position.copy(fr.at(xc, 1.05, zFront - 0.42)); c.rotation.y = fr.yaw;
    root.add(c);
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
    const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.2, i + 5);
    c.position.copy(fr.at(xc, L.y + 0.02, L.z - 0.2)); c.rotation.set(0, fr.yaw, 0, 'YXZ'); c.rotateX(-0.9);
    root.add(c);
  });
  bakeCards(root, atlas, cards);
  const { shut, sign } = makeShutter(game, root, fr, sw.off, sw.w, sw.h, zFront, s.closedNote?.th ?? 'ปิด');
  const colliders = [
    game.physics.addBox(fr.arr(steps[0].x, 0.47, steps[0].z), [steps[0].w, 0.94, steps[0].d], fr.yaw),
    game.physics.addBox(fr.arr(steps[1].x, 0.47, steps[1].z), [steps[1].w, 0.94, steps[1].d], fr.yaw),
    game.physics.addBox(fr.arr(cx, 0.45, cz), [1.3, 0.9, 0.62], fr.yaw),
  ];
  return {
    sid: s.id, root, slots, cards, cardStyle: style, atlas,
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
  const shGeo = (() => {   // corrugated steel slat curtain (horizontal ribs), origin at the top
    const g = new THREE.PlaneGeometry(w, h, 1, Math.max(8, Math.round(h / 0.0375)));
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.007 * Math.sin((p.getY(i) / 0.075) * Math.PI * 2));
    g.computeVertexNormals();
    return g.translate(0, -h / 2, 0);
  })();
  const shMesh = new THREE.Mesh(shGeo, shMat); // origin at the top
  shMesh.castShadow = true; shMesh.receiveShadow = true;
  const shObj = new THREE.Group();
  shObj.position.copy(fr.at(off, h, zFront - 0.02)); shObj.rotation.y = fr.yaw;
  shObj.add(shMesh);
  const rollBox = new THREE.Mesh(rbox(w + 0.1, 0.26, 0.3, 0.03, 1), pbr('metal_painted_chipped', 0x9a9a94, 0x8a8a86));
  rollBox.castShadow = rollBox.receiveShadow = true;
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
/** a canvas POS screen (till UI), drawn once */
function posScreenMat() {
  return mat('pos-screen', () => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 192;
    const x = cv.getContext('2d')!;
    const gr = x.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, '#0e3a6e'); gr.addColorStop(1, '#0a2546');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 192);
    x.fillStyle = '#f0a21e'; x.fillRect(0, 0, 256, 22);
    x.fillStyle = '#10223a'; x.font = `bold 14px ${F.ui}`; x.fillText('8-TWELVE  POS 03', 8, 16);
    x.font = `13px ${F.ui}`;
    const rows = [['มาม่าคัพ', '15.00'], ['น้ำดื่ม 600ml', '7.00'], ['ซาลาเปาหมูสับ', '22.00'], ['ถุง', '0.00']];
    rows.forEach(([a, b], i) => { x.fillStyle = i % 2 ? '#123f78' : '#164a8a'; x.fillRect(6, 30 + i * 24, 244, 22); x.fillStyle = '#e8f1ff'; x.fillText(a, 12, 46 + i * 24); x.fillText(b, 200, 46 + i * 24); });
    x.fillStyle = '#ffe36a'; x.font = `bold 20px ${F.ui}`; x.fillText('รวม 44.00', 120, 178);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color(0xffffff), emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.25 });
  });
}

/**
 * A real supermarket gondola run (door frame, long axis = z): steel base plinth with kick plate, perforated
 * centre panel, 4 shelf levels each side with PVC price-tag rails, end caps, and real 3D stock on every
 * shelf (pillow snack bags / cup noodles whose fronts are slices of real 8-Twelve shelf photos).
 */
function gondola(B: Batch, fr: Frame, x: number, z0: number, len: number, photos: [string, string], shapes: [('bag' | 'cup' | 'box')[], ('bag' | 'cup' | 'box')[]], seed: number) {
  const steel = pbr('metal_painted_chipped', 0xeeeeea, 0xeeeeea);
  const dark = pbr('metal_painted_chipped', 0x2a2c30, 0x2a2c30);
  const zc = z0 + len / 2;
  B.add(rbox(0.86, 0.11, len, 0.012, 1), dark, fr, x, 0, zc);                     // plinth
  B.add(rbox(0.88, 0.035, len + 0.02, 0.008, 1), pbr('rubber_black', undefined, 0x202020), fr, x, 0, zc);   // kick strip
  B.add(rbox(0.05, 1.62, len, 0.008, 0.5), steel, fr, x, 0.11, zc);                // centre panel
  for (const ez of [z0 + 0.012, z0 + len - 0.012]) B.add(rbox(0.9, 1.7, 0.024, 0.008, 0.5), steel, fr, x, 0, ez);   // end uprights
  B.add(rbox(0.09, 0.05, len + 0.03, 0.01, 1), steel, fr, x, 1.73, zc);             // top cap
  for (const side of [-1, 1]) {
    const sh: ('bag' | 'cup' | 'box')[] = shapes[side < 0 ? 0 : 1];
    const ph = photos[side < 0 ? 0 : 1];
    const levels = [0.11, 0.42, 0.82, 1.22];
    levels.forEach((y, li) => {
      const deck = li === 0 ? rbox(0.4, 0.012, len - 0.06, 0.004, 1) : rbox(0.4, 0.02, len - 0.06, 0.005, 1);
      B.add(deck, steel, fr, x + side * 0.235, y, zc);
      B.add(tagRail(len - 0.06), pbr('plastic_glossy', 0xf2c21e, 0xf2c21e), fr, x + side * 0.44, y - 0.012, zc, side * Math.PI / 2);
      // stock: packs on this shelf, 2 deep against the centre panel (the front half stays free for the
      // real buyable items + their price cards)
      const shape = sh[li % sh.length];
      const pw = shape === 'cup' ? 0.095 : shape === 'box' ? 0.12 : 0.13;
      const phh = shape === 'cup' ? 0.1 : shape === 'box' ? 0.18 : 0.21;
      const n = Math.floor((len - 0.12) / (pw + 0.008));
      // every pack its own (fictional) product: runs of 2–4 facings of the same item, like a real planogram
      const base = seed * 5 + li * 11 + (side > 0 ? 37 : 0);
      const g = packRow({ u0: 0, u1: 1, v0: 0, v1: 1, n, w: pw, h: phh, d: shape === 'cup' ? pw : 0.06, shape, x0: -(len - 0.12) / 2, y: 0, z: 0, seed: seed + li * 13 + side, deep: 1,
        cellUV: (i) => packCell(shape, base + Math.floor(i / (2 + ((base + i) % 3)))) });
      g.rotateY(side * Math.PI / 2);
      B.add(g, packMaterial(), fr, x + side * 0.05, y + (li === 0 ? 0.012 : 0.02), zc, 0);
      void ph;
    });
  }
}

/** printed backlit header of the drinks cooler */
function coolerSignMat() {
  return mat('cooler-sign', () => {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 72;
    const x = cv.getContext('2d')!;
    const gr = x.createLinearGradient(0, 0, 0, 72); gr.addColorStop(0, '#27a35a'); gr.addColorStop(1, '#156a38');
    x.fillStyle = gr; x.fillRect(0, 0, 1024, 72);
    x.fillStyle = '#f7c21a'; x.fillRect(0, 62, 1024, 10);
    x.fillStyle = '#ffffff'; x.font = `bold 44px ${F.heavy}`; x.textBaseline = 'middle';
    x.fillText('เครื่องดื่มเย็นๆ', 40, 33); x.font = `bold 30px ${F.ui}`; x.fillStyle = '#dff7e6'; x.fillText('COLD DRINKS · ICE COLD · 24 ชม.', 520, 34);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color(0xffffff), emissiveMap: t, emissiveIntensity: 0.45, roughness: 0.4 });
  });
}

/** Upright glass-door drinks cooler: real 3D bottles on lit shelves behind 4 glass doors. */
function drinksCooler(B: Batch, root: THREE.Object3D, fr: Frame, x: number, zc: number, len: number) {
  const body = pbr('metal_painted_chipped', 0xe4e4e2, 0xe4e4e2);
  const alu = pbr('aluminium_scratched', 0xd8d8d8, 0xc0c0c0);
  // cabinet: a hollow shell open toward -x (into the store): back, end panels, top, plinth
  const D = 0.75;
  B.add(rbox(0.04, 2.1, len, 0.01, 1), body, fr, x + D - 0.02, 0, zc);
  for (const ez of [zc - len / 2 + 0.02, zc + len / 2 - 0.02]) B.add(rbox(D, 2.1, 0.04, 0.012, 1), body, fr, x + D / 2, 0, ez);
  B.add(rbox(D, 0.3, len, 0.015, 1), body, fr, x + D / 2, 1.8, zc);
  B.add(rbox(D, 0.16, len, 0.015, 1), body, fr, x + D / 2, 0, zc);
  // header sign (printed, softly backlit)
  { const sign = new THREE.Mesh(plane(len - 0.1, 0.24), coolerSignMat());
    sign.position.copy(fr.at(x - 0.002, 1.83, zc)); sign.rotation.y = fr.yaw - Math.PI / 2; root.add(sign);
    B.add(rbox(0.012, 0.26, len - 0.06, 0.004, 1), pbr('plastic_glossy', 0x1e8a4a, 0x1e8a4a), fr, x + 0.004, 1.82, zc); }
  B.add(rbox(0.012, 0.02, len - 0.12, 0.004, 1), glow(0xf3fff6, 1.6), fr, x + 0.09, 1.76, zc);     // interior LED strip
  // lit interior back + shelves with bottles
  // lit white interior (back + LED columns) — the bottles in front are real 3D
  B.add(plane(len - 0.1, 1.62).translate(0, 0.16, 0), mat('cooler-back', () => new THREE.MeshStandardMaterial({ color: 0xf4f8fa, emissive: new THREE.Color(0xe8f4ff), emissiveIntensity: 0.55, roughness: 0.4 })), fr, x + 0.7, 0, zc, -Math.PI / 2);
  for (let k = 0; k <= 4; k++) B.add(rbox(0.02, 1.6, 0.025, 0.004, 1), glow(0xeef8ff, 1.4), fr, x + 0.68, 0.17, zc - len / 2 + 0.06 + k * ((len - 0.12) / 4));
  const ids = ['bottle_beer_chang', 'bottle_beer_leo', 'bottle_beer_singha', 'bottle_fanta_red'];
  const mats: Record<string, THREE.Matrix4[]> = {};
  const shelfY = [0.17, 0.58, 0.99, 1.4];
  for (const [si, y] of shelfY.entries()) {
    B.add(rbox(0.6, 0.012, len - 0.12, 0.003, 1), pbr('metal_painted_chipped', 0xf0f0ee, 0xf0f0ee), fr, x + 0.38, y - 0.012, zc);
    B.add(tagRail(len - 0.12, 0.03), pbr('plastic_glossy', 0xf4f4f0, 0xf4f4f0), fr, x + 0.075, y - 0.03, zc, -Math.PI / 2);
    const id = ids[si % ids.length];
    const step = 0.085;
    const n = Math.floor((len - 0.2) / step);
    for (let i = 0; i < n; i++) for (const dx of [0.13, 0.22, 0.31, 0.4]) {
      if ((i * 7 + si * 3 + Math.round(dx * 100)) % 11 === 0) continue;   // a few gaps: people bought some
      const p = fr.at(x + dx, y, zc - (len - 0.2) / 2 + i * step);
      (mats[ids[(si + Math.floor(i / 9)) % ids.length]] ??= []).push(new THREE.Matrix4().makeRotationY(fr.yaw - Math.PI / 2 + Math.sin(i * 3.1) * 0.3).setPosition(p));
    }
  }
  for (const [id, m] of Object.entries(mats)) root.add(libInstanced(id, m, { shadow: false, cull: 32 }));
  // 4 glass doors with aluminium frames and long pull handles
  const dl = len / 4;
  for (let k = 0; k < 4; k++) {
    const dz = zc - len / 2 + dl * (k + 0.5);
    // door: aluminium frame (4 rails) around the glass, long pull handle
    for (const [fy, fh] of [[0.16, 0.04], [1.76, 0.04]] as [number, number][]) B.add(rbox(0.035, fh, dl - 0.02, 0.006, 1), alu, fr, x + 0.02, fy, dz);
    for (const ez of [dz - dl / 2 + 0.03, dz + dl / 2 - 0.03]) B.add(rbox(0.035, 1.64, 0.04, 0.006, 1), alu, fr, x + 0.02, 0.16, ez);
    B.add(plane(dl - 0.08, 1.56).translate(0, 0.19, 0), glass(), fr, x + 0.01, 0, dz, -Math.PI / 2);
    B.add(tube([0, 0.62, 0], [0, 1.42, 0], 0.012, 8), alu, fr, x - 0.03, 0, dz + (k % 2 ? -1 : 1) * (dl / 2 - 0.09));
  }
  // kick grille + compressor vent
  B.add(rbox(0.03, 0.12, len - 0.04, 0.006, 0.3), pbr('metal_painted_chipped', 0x2a2a2a, 0x2a2a2a), fr, x + 0.02, 0.02, zc);
}

/** distance (m) to the nearest static wall from `from` along `dir` (world), or `def` */
function probeWall(game: Game, from: THREE.Vector3, dir: THREE.Vector3, max: number, def: number) {
  const h = game.physics?.raycast(from, dir.clone().normalize(), max, 1);
  return h ? h.toi : def;
}

function storeCladding(game: Game, B: Batch, door: Frame) {
  const tile = pbr('tiles_wall_white_dirty', 0xf6f6f2, 0xf2f2ee);
  const H = 2.95;
  const o = door.at(0, 1.4, 3.6);
  const right = probeWall(game, o, door.r, 10, 6.9) - 0.035;            // local +x wall
  const left = probeWall(game, o, door.r.clone().negate(), 10, 7.3) - 0.035;
  const back = probeWall(game, o, door.f, 10, 4.1) - 0.035;             // local +z wall
  const zb = 3.6 + back, xr = right, xl = -left;
  const zf = -0.25;
  const lenZ = zb - zf, midZ = (zb + zf) / 2;
  // side walls (inner faces) and back wall
  B.add(mbox(0.03, H, lenZ, 0.6), tile, door, xr, 0, midZ);
  B.add(mbox(0.03, H, lenZ, 0.6), tile, door, xl, 0, midZ);
  B.add(mbox(xr - xl, H, 0.03, 0.6), tile, door, (xr + xl) / 2, 0, zb);
  // brand stripes at 2.2 m around the three walls + a dark skirting
  for (const [y, c] of [[2.16, 0xe8681e], [2.24, 0x1e8a4a], [2.32, 0xd8231a]] as [number, number][]) {
    const m = pbr('plastic_glossy', c, c);
    B.add(rbox(0.012, 0.07, lenZ, 0.003, 1), m, door, xr - 0.02, y, midZ);
    B.add(rbox(0.012, 0.07, lenZ, 0.003, 1), m, door, xl + 0.02, y, midZ);
    B.add(rbox(xr - xl, 0.07, 0.012, 0.003, 1), m, door, (xr + xl) / 2, y, zb - 0.02);
  }
  const sk = pbr('rubber_black', undefined, 0x202020);
  B.add(rbox(0.012, 0.1, lenZ, 0.003, 1), sk, door, xr - 0.02, 0, midZ);
  B.add(rbox(0.012, 0.1, lenZ, 0.003, 1), sk, door, xl + 0.02, 0, midZ);
  B.add(rbox(xr - xl, 0.1, 0.012, 0.003, 1), sk, door, (xr + xl) / 2, 0, zb - 0.02);
}

function buildStore(game: Game, s: ShopDef, door: Frame, ctr: Frame, kinds: Map<string, string>): ShopFix {
  const root = new THREE.Group(); root.name = 'shop:' + s.id;
  const B = new Batch();
  const C = new Batch();
  // ---- counter: bevelled white laminate body with the 3 brand stripes, stone-look top, POS, scanner, steamer
  const cw = 3.2;
  C.add(rbox(0.72, 0.97, cw, 0.025, 1), pbr('plastic_rough', 0xf2f0ea, 0xf2f0ea), ctr, 0, 0, 0.75, Math.PI / 2);
  for (const [y, c] of [[0.62, 0xe8681e], [0.7, 0x1e8a4a], [0.78, 0xd8231a]] as [number, number][]) B.add(rbox(cw + 0.004, 0.055, 0.008, 0.003, 1), pbr('plastic_glossy', c, c), ctr, 0, y, 0.385);
  B.add(rbox(cw + 0.06, 0.035, 0.78, 0.012, 1), pbr('marble_beige_polished', 0xd9d6cf, 0xd9d6cf), ctr, 0, 0.97, 0.75);
  B.add(rbox(cw - 0.1, 0.06, 0.03, 0.01, 1), pbr('rubber_black', undefined, 0x202020), ctr, 0, 0.0, 0.4);    // kick strip
  // POS: base, column, angled screen with the till UI, customer display, cash drawer
  B.add(rbox(0.34, 0.07, 0.3, 0.015, 1), flat(0x1c1d20, 0.35, 0.2), ctr, -0.6, 1.005, 0.95);
  B.add(rbox(0.05, 0.16, 0.05, 0.01, 1), flat(0x1c1d20, 0.35, 0.2), ctr, -0.6, 1.07, 0.98);
  { const scr = rbox(0.36, 0.25, 0.035, 0.012, 1).rotateX(-0.28); B.add(scr, flat(0x18191c, 0.3, 0.2), ctr, -0.6, 1.2, 0.97); }
  { const g = plane(0.32, 0.21).rotateX(-0.28).translate(0, 0.02, -0.02); B.add(g, posScreenMat(), ctr, -0.6, 1.2, 0.947, Math.PI); }
  B.add(rbox(0.42, 0.11, 0.42, 0.01, 1), flat(0x2a2a2c, 0.4, 0.3), ctr, -0.6, 0.83, 0.9);        // cash drawer under the top lip
  // barcode scanner on its stand (glowing red window)
  B.add(rbox(0.09, 0.03, 0.12, 0.01, 1), flat(0x202020, 0.4), ctr, -0.2, 1.005, 0.7);
  { const h = rbox(0.06, 0.14, 0.05, 0.015, 1).rotateX(0.35); B.add(h, flat(0x232326, 0.35), ctr, -0.2, 1.03, 0.72); }
  B.add(rbox(0.045, 0.02, 0.004, 0.002, 1), glow(0xff2a1a, 2.4), ctr, -0.2, 1.135, 0.69);
  // salapao steamer: stainless cabinet, glass front with the real buns photo behind it, domed vent lid
  B.add(rbox(0.5, 0.42, 0.42, 0.02, 1), pbr('aluminium_scratched', 0xe0e0e0, 0xbcbcbc), ctr, 1.0, 1.005, 0.85);
  // steamer inside: two lit trays of 3D salapao buns (soft white domes with a pinched top)
  for (const [ti, ty] of [0.07, 0.24].entries()) {
    B.add(rbox(0.44, 0.012, 0.36, 0.004, 1), pbr('aluminium_scratched', 0xe0e0e0, 0xbcbcbc), ctr, 1.0, 1.005 + ty, 0.85);
    for (let i = 0; i < 6; i++) {
      const bun = new THREE.SphereGeometry(0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1);
      B.add(bun, mat('salapao-bun', () => new THREE.MeshStandardMaterial({ color: 0xf6f0e2, roughness: 0.75, emissive: new THREE.Color(0x3a3020), emissiveIntensity: 0.25 })), ctr, 0.87 + (i % 3) * 0.13, 1.017 + ty, 0.78 + Math.floor(i / 3) * 0.13 + ti * 0.02);
    }
  }
  B.add(rbox(0.46, 0.008, 0.38, 0.003, 1), glow(0xfff2d8, 0.9), ctr, 1.0, 1.4, 0.85);
  B.add(plane(0.44, 0.34).translate(0, 0.04, 0), glass(), ctr, 1.0, 1.005, 0.635, Math.PI);
  B.add(lathe([[0.2, 0], [0.19, 0.03], [0.12, 0.07], [0.03, 0.08], [0, 0.08]], 16).scale(1.15, 1, 0.95), pbr('aluminium_scratched', 0xe0e0e0, 0xbcbcbc), ctr, 1.0, 1.425, 0.85);
  // impulse rack by the till: gum / sweets on a small wire stand
  B.add(rbox(0.32, 0.36, 0.2, 0.01, 1), pbr('metal_painted_chipped', 0x303032, 0x303032), ctr, 0.35, 1.005, 0.62);
  for (const [li, y] of [0.1, 0.22].entries()) {
    const g = packRow({ u0: 0, u1: 1, v0: 0, v1: 1, n: 5, w: 0.05, h: 0.08, d: 0.025, shape: 'box', x0: -0.14, y: 0, z: 0, seed: 77 + li, cellUV: (i) => packCell('box', 3 + li * 5 + i) });
    g.rotateY(Math.PI);
    B.add(g, packMaterial(), ctr, 0.35, 1.005 + y, 0.53, 0);
  }
  // back shelf behind the clerk: a real bottle wall (cups/bottles cut from the real photo) on a laminate unit
  const back = pbr('plastic_rough', 0xece9e2, 0xece9e2);
  C.add(rbox(3.0, 2.0, 0.42, 0.02, 1), back, ctr, 0, 0, 2.55, Math.PI / 2 * 0);
  const wall: Record<string, THREE.Matrix4[]> = {};
  const WALL_IDS = ['bottle_light_soy', 'bottle_dark_soy', 'bottle_oyster_sauce', 'bottle_fish_sauce_tiparos', 'bottle_golden_mountain', 'bottle_fish_sauce_squid', 'bottle_beer_leo', 'bottle_beer_singha'];
  for (const [li, y] of [0.5, 0.95, 1.4].entries()) {
    B.add(rbox(2.9, 0.025, 0.36, 0.006, 1), back, ctr, 0, y, 2.38);
    if (li === 2) {
      // top shelf: cup noodles (package atlas) in runs
      const g = packRow({ u0: 0, u1: 1, v0: 0, v1: 1, n: 26, w: 0.095, h: 0.1, d: 0.095, shape: 'cup', x0: -1.4, y: 0, z: 0, seed: 31 + li, cellUV: (i) => packCell('cup', Math.floor(i / 3)) });
      g.rotateY(Math.PI);
      B.add(g, packMaterial(), ctr, 0, y + 0.025, 2.3, 0);
      continue;
    }
    // sauces & beer: real bottles, 2 deep, grouped by kind
    for (let i = 0; i < 30; i++) for (const dz of [2.27]) {
      const id = WALL_IDS[(Math.floor(i / 4) + li * 3) % WALL_IDS.length];
      (wall[id] ??= []).push(new THREE.Matrix4().makeRotationY(ctr.yaw + Math.PI + Math.sin(i * 1.7) * 0.25).setPosition(ctr.at(-1.38 + i * 0.094, y + 0.025, dz)));
    }
  }
  for (const [id, m] of Object.entries(wall)) root.add(libInstanced(id, m, { shadow: false, cull: 30 }));
  // ---- gondolas: 2 double-sided runs between the door and the counter (door frame: x = right, z = forward)
  const slots: Slot[] = [];
  const cards = new Map<string, number>();
  const atlas = new CardAtlas(s.stock.length);
  gondola(B, door, -3.0, 1.0, 3.4, ['seven_snacks2', 'seven_noodles'], [['bag', 'bag', 'bag', 'box'], ['cup', 'cup', 'cup', 'cup']], 11);
  gondola(B, door, -5.6, 1.0, 3.4, ['seven_snacks', 'seven_snacks2'], [['bag', 'bag', 'box', 'box'], ['bag', 'bag', 'bag', 'box']], 29);
  // ---- drinks cooler along the south wall
  const fx = 6.2;
  drinksCooler(B, root, door, fx, 2.8, 3.6);
  // ---- clean store walls: white tiled cladding with the three brand stripes, set just inside the building's own
  // walls (probed), so the shop never shows the raw building interior (rusty / mouldy plaster) behind the shelves
  storeCladding(game, B, door);
  // ---- ceiling: recessed fluorescent troffers
  for (const z of [1.5, 3.2, 4.9]) for (const xx of [-4.3, -1.2, 2.0]) {
    B.add(rbox(0.6, 0.05, 1.2, 0.01, 1), pbr('metal_painted_chipped', 0xf2f2f0, 0xf2f2f0), door, xx, 2.92, z);
    B.add(rbox(0.5, 0.012, 1.1, 0.004, 1), glow(0xf4fbff, 2.0), door, xx, 2.905, z);
  }
  C.flush(root);
  B.flush(root);
  // stock slots: snacks/sauces on gondola shelf fronts, drinks at the cooler's front ledge
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
    const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.16, i);
    c.position.copy(door.at(sp.x + sp.face * 0.12, sp.y - 0.03, zc)); c.rotation.y = door.yaw + sp.face * Math.PI / 2;
    root.add(c);
  });
  drinks.forEach((stk, i) => {
    const zc = 1.4 + i * 0.6;
    const n = stk.show ?? 2;
    for (let k = 0; k < n; k++) slots.push({ stock: stk.id, p: door.arr(fx - 0.22, 0.62 + (k % 2) * 0.004, zc + (k - (n - 1) / 2) * 0.1), yaw: door.yaw - Math.PI / 2 });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.16, i + 9);
    c.position.copy(door.at(fx - 0.375, 0.52, zc)); c.rotation.y = door.yaw - Math.PI / 2;
    root.add(c);
  });
  // promo ledge in front of the cooler (where the buyable drinks stand): bevelled, with a price rail
  const ledge = new THREE.Mesh(rbox(0.3, 0.6, 3.4, 0.015, 1), pbr('plastic_rough', 0xdcdcd8, 0xdcdcd8));
  ledge.position.copy(door.at(fx - 0.22, 0, 2.8)); ledge.rotation.y = door.yaw; ledge.castShadow = ledge.receiveShadow = true;
  root.add(ledge);
  bakeCards(root, atlas, cards);
  const counterMesh = root.children[0];
  const colliders = [
    game.physics.addBox(ctr.arr(0, 0.5, 0.75), [cw, 1.0, 0.72], ctr.yaw),
    game.physics.addBox(ctr.arr(0, 1.0, 2.55), [3.0, 2.0, 0.42], ctr.yaw),
    game.physics.addBox(door.arr(-3.0, 0.78, 2.7), [0.9, 1.56, 3.4], door.yaw),
    game.physics.addBox(door.arr(-5.6, 0.78, 2.7), [0.9, 1.56, 3.4], door.yaw),
    game.physics.addBox(door.arr(fx + 0.1, 1.05, 2.8), [1.0, 2.1, 3.6], door.yaw),
  ];
  // store rect (world) from the door: forward 0..7.5, right -7.5..6.8
  const c1 = door.at(-7.2, 0, -0.3), c2 = door.at(6.8, 0, 7.6);
  return {
    sid: s.id, root, slots, cards, cardStyle: style, atlas, counter: [counterMesh],
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
  // checkout lanes: bevelled counters with a rubber belt, end rollers, scanner, card terminal, lane-number pole
  for (let lane = 0; lane < 3; lane++) {
    const x = lane * 3.2;
    B.add(rbox(2.6, 0.86, 0.8, 0.02, 1), pbr('metal_painted_chipped', 0x3a3d42, 0x3a3d42), ctr, x, 0, 0.75);
    B.add(rbox(2.5, 0.025, 0.5, 0.01, 1), pbr('rubber_black', undefined, 0x181818), ctr, x, 0.86, 0.75);
    for (const ex of [-1.25, 1.25]) B.add(tube([ex, 0.875, 0.5], [ex, 0.875, 1.0], 0.02, 10), pbr('aluminium_scratched'), ctr, x, 0, 0);
    B.add(rbox(2.6, 0.06, 0.06, 0.01, 1), pbr('aluminium_scratched'), ctr, x, 0.86, 0.47);
    B.add(rbox(0.3, 0.05, 0.3, 0.01, 1), flat(0x202022, 0.35), ctr, x + 0.95, 0.88, 0.75);
    B.add(rbox(0.26, 0.004, 0.26, 0.002, 1), glow(0xff3020, 0.9), ctr, x + 0.95, 0.932, 0.75);
    B.add(tube([x + 1.25, 0.9, 1.1], [x + 1.25, 2.25, 1.1], 0.025, 10), pbr('aluminium_scratched'), ctr, 0, 0, 0);
    B.add(rbox(0.5, 0.3, 0.06, 0.02, 1), pbr('plastic_glossy', 0x222222, 0x222222), ctr, x + 1.25, 2.22, 1.1);
    B.add(rbox(0.44, 0.24, 0.004, 0.004, 1), glow(lane === 0 ? 0x34c759 : 0xd8231a, 1.2), ctr, x + 1.25, 2.25, 1.068);
  }
  // pallet racks: perforated blue uprights (2 frames per bay with bracing), orange step beams, wooden
  // pallets (slats + blocks) loaded with real cardboard cartons (library model, instanced)
  const rackRows = [7, 10.5, 14];
  const allRows = [7, 10.5, 14, 17.5];   // the 4th row (back) is stock-only decoration
  const rackLen = 10;
  const blue = pbr('metal_painted_chipped', 0x1f4fa8, 0x1f4fa8), orange = pbr('metal_painted_chipped', 0xe8681e, 0xe8681e), wood = pbr('wood_planks_old');
  const cartons: THREE.Matrix4[] = [];
  for (const rz of allRows) {
    for (let i = 0; i <= 4; i++) {
      const ux = -1 + i * (rackLen / 4);
      for (const dz of [-0.5, 0.5]) B.add(rbox(0.09, 3.6, 0.07, 0.008, 0.5), blue, door, ux, 0, rz + dz);
      for (let k = 0; k < 6; k++) B.add(tube([ux, 0.2 + k * 0.55, rz - 0.47], [ux, 0.45 + k * 0.55, rz + 0.47], 0.012, 6), blue, door, 0, 0, 0);
      B.add(rbox(0.16, 0.012, 1.12, 0.004, 1), blue, door, ux, 0, rz);
    }
    for (const y of [1.2, 2.4]) for (const dz of [-0.5, 0.5]) B.add(rbox(rackLen, 0.12, 0.05, 0.008, 1), orange, door, -1 + rackLen / 2, y, rz + dz);
    for (let i = 0; i < 4; i++) {
      const px = -1 + rackLen / 8 + i * (rackLen / 4);
      for (const y of [0, 1.32, 2.52]) {
        // pallet: 3 bottom boards, 9 blocks, 5 top slats
        for (const dz of [-0.42, 0, 0.42]) B.add(rbox(1.2, 0.022, 0.1, 0.004, 1), wood, door, px, y, rz + dz);
        for (const dx of [-0.55, 0, 0.55]) for (const dz of [-0.42, 0, 0.42]) B.add(rbox(0.1, 0.078, 0.1, 0.006, 1), wood, door, px + dx, y + 0.022, rz + dz);
        for (let k = 0; k < 5; k++) B.add(rbox(0.1, 0.022, 1.0, 0.004, 1), wood, door, px - 0.5 + k * 0.25, y + 0.1, rz);
        if (y === 0 && rz !== 17.5) continue;   // ground level: the buyable bulk stock stands here (front rows)
        // 2×2×2 cartons per pallet
        for (let cx2 = 0; cx2 < 2; cx2++) for (let cz2 = 0; cz2 < 2; cz2++) for (let cy2 = 0; cy2 < 2; cy2++) {
          if ((i + cx2 + cz2 * 2 + cy2 + rz) % 7 === 0) continue;
          const pp = door.at(px - 0.27 + cx2 * 0.54, y + 0.122 + cy2 * 0.345, rz - 0.22 + cz2 * 0.44);
          cartons.push(new THREE.Matrix4().makeRotationY(door.yaw + Math.PI / 2 + ((cx2 + cz2 + cy2) % 2) * 0.04).setPosition(pp));
        }
      }
    }
  }
  root.add(libInstanced('cardboard_box_01', cartons, { shadow: true, cull: 45 }));
  // back wall (painted corrugated sheet on a block plinth) with the store's painted slogan + high-bay lamps
  B.add(mbox(26, 1.0, 0.2, 1.2), pbr('cement_block_wall', 0xd8d4cc, 0xd8d4cc), door, 3, 0, 19.6);
  B.add(mbox(26, 3.8, 0.08, 2), pbr('corrugated_painted', 0xdfe6ea, 0xdfe6ea), door, 3, 1.0, 19.62);
  { const sign = new THREE.Mesh(plane(9, 1.2), canvasMat(signTex('mk-wall', [{ text: 'แม็กโคร่ง · ขายส่ง ถูกทั้งโกดัง', size: 92, color: '#c8141a' }], 'card_board', 1600, 220), { rough: 0.7 }));
    sign.position.copy(door.at(3, 3.6, 19.5)); sign.rotation.y = door.yaw + Math.PI; root.add(sign); }
  for (const lz of [5, 10, 15]) for (const lx of [-0.5, 4, 8.5]) {
    const lamp = libModel('hanging_industrial_lamp'); lamp.position.copy(door.at(lx, 3.0, lz)); root.add(lamp);
    const lp = (game.world as any)?.addLightPoint?.(door.at(lx, 2.9, lz), 0xf2f6ff, 12, 11, 0);
    if (lp) { lp.day = 0.9; lp.kind = 'store'; }
  }
  B.flush(root);
  // stock: on the pallets (lowest level) of the 3 rows, both faces
  const slots: Slot[] = [];
  const cards = new Map<string, number>();
  const atlas = new CardAtlas(s.stock.length);
  const style: CardStyle = 'shelf';
  const spots: { x: number; z: number; face: number }[] = [];
  for (const rz of rackRows) for (const face of [-1, 1]) for (let i = 0; i < 4; i++) spots.push({ x: -1 + rackLen / 8 + i * (rackLen / 4), z: rz + face * 0.25, face });
  s.stock.forEach((stk, i) => {
    const sp = spots[i % spots.length];
    const n = stk.show ?? 1;
    for (let k = 0; k < n; k++) slots.push({ stock: stk.id, p: door.arr(sp.x + (k - (n - 1) / 2) * 0.3, 0.145, sp.z), yaw: sp.face < 0 ? door.yaw : door.back });
    const kind = kinds.get(stk.id) ?? stk.fb;
    const c = card(atlas, style, stk, nameOf(game, stk, kind), 0.4, i);
    c.position.copy(door.at(sp.x, 1.12, sp.z + sp.face * 0.31)); c.rotation.y = sp.face < 0 ? door.yaw : door.back;
    root.add(c);
  });
  bakeCards(root, atlas, cards);
  const colliders: any[] = [];
  for (let lane = 0; lane < 3; lane++) colliders.push(game.physics.addBox(ctr.arr(lane * 3.2, 0.45, 0.75), [2.6, 0.9, 0.8], ctr.yaw));
  for (const rz of allRows) for (let i = 0; i <= 4; i++) colliders.push(game.physics.addBox(door.arr(-1 + i * (rackLen / 4), 1.8, rz), [0.1, 3.6, 1.1], door.yaw));
  const c1 = door.at(-10, 0, -0.5), c2 = door.at(16, 0, 22);
  const { shut, sign } = makeShutter(game, root, door, 0, 5.2, 3.2, -0.2, (game.g.day ?? 1) < s.day ? (s.lockedNote?.th ?? 'ปิด') : (s.closedNote?.th ?? 'ปิด'));
  return {
    shutter: shut, closedSign: sign,
    sid: s.id, root, slots, cards, cardStyle: style, atlas, counter: [root.children[0]],
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

/** Re-render a product's price card (price change / sold out / hidden while locked). */
export function updateCard(fix: ShopFix, st: StockDef, name: string, price: number, soldOut: boolean, hidden = false) {
  const i = fix.cards.get(st.id);
  if (i === undefined) return;
  fix.atlas.set(i, { price, sold: soldOut, hidden, name });
}
