import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { ItemDef } from '../../game/items';
import { tl } from '../../core/util';
import { lathe, rbox, leg, tube, merge, mesh, group, mat, plastic, pbr, photo, flat, frontArc, band, wobble } from './geo';
import { messMaterial, waterMaterial } from './fx';
import { posterMaterial, signMaterials } from './menuposter';

/* =============================================================================================
 * Furniture & service item kinds owned by the restaurant (see docs/ARCHITECTURE.md §13).
 * Real textures: PP-plastic photo scans (textures/props), PBR scans (stainless, canvas, paper,
 * concrete), real product labels (img/labels), real photos in gen/restaurant (sponge) and the
 * shops module's real product cut-outs (water bottle). Every placed furniture item is `fixed`.
 * ============================================================================================= */

export const SEAT_KINDS = ['stool_red', 'stool_blue', 'chair_plastic'];
export const TABLE_KINDS = ['table_plastic', 'table_steel'];
export const SEAT_H: Record<string, number> = { stool_red: 0.44, stool_blue: 0.44, chair_plastic: 0.44 };
export const TABLE_H: Record<string, number> = { table_plastic: 0.66, table_steel: 0.71 };
export const TABLE_SIZE: Record<string, [number, number]> = { table_plastic: [0.8, 0.62], table_steel: [0.9, 0.62] };
export const SODA_KINDS = ['soda_cola_can', 'soda_fanta_can', 'soda_fanta_green', 'soda_red', 'water_bottle'];
export const VESSELS = ['plate', 'bowl', 'cup_plastic'];
export const isTrash = (e: Ent, def?: ItemDef) => !!(def?.tags?.includes('trash') || e.data?.empty || (e.k === 'takeaway_box' && e.data?.dirty) || e.k === 'plastic_bag');

const D2 = THREE.DoubleSide;
const plasticD = (c: 'red' | 'blue' | number) => mat('pld:' + c, () => { const m = (plastic(c) as THREE.MeshStandardMaterial).clone(); m.side = D2; return m; });
const steel = () => pbr('stainless_brushed', { repeat: 1, rough: 0.55 });
const galv = () => pbr('galvanized_steel', { repeat: 1 });
const pinkPaper = () => pbr('paper_creased', { repeat: 1, color: 0xf6b9cb });

// ------------------------------------------------------------------ builders

function stool(color: 'red' | 'blue') {
  const H = 0.44, R = 0.155;
  const seat = lathe([[0, H], [R - 0.012, H], [R + 0.002, H - 0.008], [R + 0.006, H - 0.032], [R - 0.008, H - 0.036], [0.02, H - 0.036]], 22, { wob: 0.008, seed: color === 'red' ? 2 : 5 });
  const parts: THREE.BufferGeometry[] = [seat];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(R - 0.004, R + 0.04, H - 0.034, 5, 1, true, i * Math.PI / 2 + 0.33, Math.PI / 2 - 0.66);
    g.translate(0, (H - 0.034) / 2, 0);
    parts.push(g);
  }
  const ring = new THREE.TorusGeometry(R + 0.026, 0.009, 4, 24); ring.rotateX(Math.PI / 2); ring.translate(0, 0.12, 0);
  parts.push(ring);
  const body = mesh(merge(parts), plasticD(color));
  const hole = mesh(new THREE.CircleGeometry(0.03, 12), flat(0x120806, 1), false);
  hole.scale.set(1.6, 0.55, 1); hole.rotation.x = -Math.PI / 2; hole.position.y = H + 0.001;
  return group(body, hole);
}

function chair() {
  const m = plastic(0xe6e1d4);
  const seat = rbox(0.44, 0.035, 0.42, 0.014, 0, 0.42, 0);
  const back = new THREE.CylinderGeometry(0.32, 0.31, 0.38, 12, 2, true, -0.8, 1.6);
  back.translate(0, 0.19, -0.1); back.rotateX(-0.1); back.translate(0, 0.47, 0);
  wobble(back, 0.01, 6, 3);
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => leg(sx * 0.25, sz * 0.24, sx * 0.19, sz * 0.18, 0.43, 0.04, 0.055));
  const arms = [-1, 1].flatMap((s) => [tube(new THREE.Vector3(s * 0.22, 0.62, 0.17), new THREE.Vector3(s * 0.22, 0.62, -0.12), 0.018), tube(new THREE.Vector3(s * 0.22, 0.62, -0.12), new THREE.Vector3(s * 0.21, 0.44, -0.16), 0.018)]);
  const gm = merge([seat, ...legs, ...arms]);
  return group(mesh(gm, m), mesh(back, mat('chairD', () => { const x = (m as THREE.MeshStandardMaterial).clone(); x.side = D2; return x; })));
}

function plasticTable() {
  const [W, Dp] = TABLE_SIZE.table_plastic, H = TABLE_H.table_plastic;
  const top = rbox(W, 0.035, Dp, 0.014, 0, H - 0.035, 0);
  const apron = [rbox(W - 0.06, 0.06, 0.025, 0.006, 0, H - 0.09, Dp / 2 - 0.04), rbox(W - 0.06, 0.06, 0.025, 0.006, 0, H - 0.09, -Dp / 2 + 0.04), rbox(0.025, 0.06, Dp - 0.08, 0.006, W / 2 - 0.04, H - 0.09, 0), rbox(0.025, 0.06, Dp - 0.08, 0.006, -W / 2 + 0.04, H - 0.09, 0)];
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => leg(sx * (W / 2 - 0.03), sz * (Dp / 2 - 0.03), sx * (W / 2 - 0.06), sz * (Dp / 2 - 0.06), H - 0.03, 0.05, 0.06));
  return group(mesh(merge([top, ...apron, ...legs]), plastic('blue')));
}

function steelTable() {
  const [W, Dp] = TABLE_SIZE.table_steel, H = TABLE_H.table_steel;
  const top = rbox(W, 0.03, Dp, 0.008, 0, H - 0.03, 0);
  const lip = rbox(W + 0.01, 0.04, Dp + 0.01, 0.004, 0, H - 0.06, 0);
  const legs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(tube(new THREE.Vector3(sx * (W / 2 - 0.05), 0, sz * (Dp / 2 - 0.05)), new THREE.Vector3(sx * (W / 2 - 0.05), H - 0.06, sz * (Dp / 2 - 0.05)), 0.016));
  for (const sx of [-1, 1]) legs.push(tube(new THREE.Vector3(sx * (W / 2 - 0.05), 0.16, -Dp / 2 + 0.05), new THREE.Vector3(sx * (W / 2 - 0.05), 0.16, Dp / 2 - 0.05), 0.012));
  legs.push(tube(new THREE.Vector3(-W / 2 + 0.05, 0.16, 0), new THREE.Vector3(W / 2 - 0.05, 0.16, 0), 0.012));
  return group(mesh(merge([top, lip]), steel()), mesh(merge(legs), galv()));
}

function addMess(g: THREE.Object3D, e: Ent, W: number, Dp: number, H: number) {
  const m = messMaterial((e.id * 0.37) % 10);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, Dp - 0.04), m);
  p.rotation.x = -Math.PI / 2; p.position.y = H + 0.002; p.name = 'mess'; p.renderOrder = 2;
  p.raycast = () => {};
  g.add(p);
}

function umbrella() {
  const pole = tube(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 2.4, 0), 0.022, 8);
  // concrete-filled paint bucket base (the classic street-vendor umbrella stand)
  const bucket = lathe([[0.15, 0], [0.17, 0.27], [0.175, 0.28], [0.16, 0.28], [0.15, 0.02]], 16, { wob: 0.01 });
  const concrete = new THREE.CircleGeometry(0.16, 14); concrete.rotateX(-Math.PI / 2); concrete.translate(0, 0.25, 0);
  // canopy: scalloped 8-panel cone with alternating real-canvas panels
  const segs = 32, R = 1.25, top = 2.42, drop = 0.42;
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const ca = new THREE.Color(0xc23a2e), cb = new THREE.Color(0xf1ece0);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const sc = (a: number) => drop - Math.abs(Math.sin(a * 4)) * 0.06; // scallops between ribs
    const pA = [Math.cos(a0) * R, top - sc(a0), Math.sin(a0) * R], pB = [Math.cos(a1) * R, top - sc(a1), Math.sin(a1) * R];
    pos.push(0, top + 0.03, 0, ...pB, ...pA);
    uv.push(0.5, 1, a1 * 0.7, 0, a0 * 0.7, 0);
    const c = Math.floor(i / 4) % 2 ? ca : cb;
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  cg.computeVertexNormals();
  const canvas = mat('umbCanvas', () => { const m = (pbr('canvas_tarp', { repeat: 3 }) as THREE.MeshStandardMaterial).clone(); m.vertexColors = true; m.side = D2; m.color.set(0xffffff); return m; });
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; ribs.push(tube(new THREE.Vector3(0, top - 0.02, 0), new THREE.Vector3(Math.cos(a) * R * 0.98, top - drop + 0.02, Math.sin(a) * R * 0.98), 0.006, 4)); ribs.push(tube(new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(Math.cos(a) * 0.6, top - 0.2, Math.sin(a) * 0.6), 0.005, 4)); }
  const g = group(mesh(merge([pole, ...ribs]), galv()), mesh(bucket, plastic('blue')), mesh(concrete, pbr('concrete_old_cracked', { repeat: 0.2 })), mesh(cg, canvas));
  return g;
}

function menuStand(e: Ent, game: Game) {
  const W = 0.78, Hh = 0.56;
  const board = rbox(W + 0.04, Hh + 0.04, 0.018, 0.006, 0, 0, 0);
  board.translate(0, -0.02 - Hh / 2, 0);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), posterMaterial(game));
  front.position.set(0, -0.02 - Hh / 2, 0.011);
  const panel = group(mesh(board, pbr('plywood', { repeat: 1 })), front);
  panel.position.set(0, 1.0, 0.05); panel.rotation.x = -0.18;
  const legs = [tube(new THREE.Vector3(-0.38, 0, 0.16), new THREE.Vector3(-0.38, 1.0, 0.04), 0.012), tube(new THREE.Vector3(0.38, 0, 0.16), new THREE.Vector3(0.38, 1.0, 0.04), 0.012),
    tube(new THREE.Vector3(-0.36, 0, -0.26), new THREE.Vector3(-0.36, 0.98, 0.0), 0.012), tube(new THREE.Vector3(0.36, 0, -0.26), new THREE.Vector3(0.36, 0.98, 0.0), 0.012),
    tube(new THREE.Vector3(-0.36, 0.35, -0.17), new THREE.Vector3(0.36, 0.35, -0.17), 0.009), tube(new THREE.Vector3(-0.38, 1.0, 0.04), new THREE.Vector3(0.38, 1.0, 0.04), 0.012)];
  return group(mesh(merge(legs), pbr('metal_painted_chipped', { repeat: 1, color: 0x6a6460 })), panel);
}

function signStand(game: Game) {
  const base = lathe([[0.17, 0], [0.18, 0.03], [0.15, 0.06], [0.03, 0.07]], 14, { wob: 0.02 });
  const pole = tube(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 1.32, 0), 0.016);
  const arm = tube(new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(0, 1.3, 0.26), 0.012);
  const hook = tube(new THREE.Vector3(-0.15, 1.3, 0.24), new THREE.Vector3(0.15, 1.3, 0.24), 0.008);
  const frame = group(mesh(merge([pole, arm, hook]), pbr('metal_painted_chipped', { repeat: 1, color: 0x4a4440 })), mesh(base, pbr('concrete_old_cracked', { repeat: 0.3 })));
  // swinging board (front = เปิด, back = ปิด)
  const [mOpen, mClosed] = signMaterials(game);
  const Wb = 0.42, Hb = 0.26;
  const boardBox = mesh(rbox(Wb + 0.03, Hb + 0.03, 0.022, 0.006, 0, -Hb - 0.03, 0), pbr('wood_planks_old', { repeat: 0.5 }));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(Wb, Hb), mOpen); f.position.set(0, -Hb / 2 - 0.015, 0.012);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(Wb, Hb), mClosed); b.position.set(0, -Hb / 2 - 0.015, -0.012); b.rotation.y = Math.PI;
  const chains = mesh(merge([tube(new THREE.Vector3(-0.15, 0, 0), new THREE.Vector3(-0.15, -0.05, 0), 0.003, 3), tube(new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(0.15, -0.05, 0), 0.003, 3)]), galv());
  const swing = group(boardBox, f, b, chains);
  swing.name = 'swing';
  swing.position.set(0, 1.3 - 0.05, 0.24);
  boardBox.position.y = 0.0; f.position.y -= 0.0;
  frame.add(swing);
  return frame;
}

function dispenser() {
  const body = rbox(0.31, 0.95, 0.31, 0.02);
  const collar = lathe([[0.13, 0.95], [0.12, 0.99], [0.06, 1.0]], 16);
  const m = plastic(0xe9e7e0, 0.6);
  const recess = mesh(rbox(0.2, 0.22, 0.03, 0.01, 0, 0.47, 0.145), flat(0x2a2b2e, 0.6));
  const tray = mesh(rbox(0.2, 0.025, 0.08, 0.006, 0, 0.47, 0.16), flat(0x3a3b3e, 0.5, 0.2));
  const tapR = mesh(rbox(0.04, 0.05, 0.05, 0.01, -0.05, 0.66, 0.175), flat(0xc0261d, 0.4));
  const tapB = mesh(rbox(0.04, 0.05, 0.05, 0.01, 0.05, 0.66, 0.175), flat(0x1f4fb8, 0.4));
  // real 20 L bottle cut-out (shops module photo) wrapped on a lathe, upside down
  const bot = lathe([[0.01, 0], [0.05, 0.0], [0.05, 0.05], [0.135, 0.12], [0.14, 0.3], [0.135, 0.33], [0.14, 0.42], [0.13, 0.47], [0.02, 0.48]], 20);
  frontArc(bot, 200);
  const bm = new THREE.Mesh(bot, photo('gen/shops/water20.png', { alpha: true, rough: 0.15, side: D2 }));
  bm.name = 'bottle';
  bm.position.y = 0.97; bm.rotation.x = Math.PI; bm.position.y = 1.47;
  return group(mesh(merge([body, collar]), m), recess, tray, tapR, tapB, bm);
}

function cup() {
  const g = lathe([[0, 0], [0.031, 0], [0.033, 0.004], [0.041, 0.11], [0.043, 0.113], [0.04, 0.113], [0.0385, 0.007], [0, 0.007]], 16);
  const shell = new THREE.Mesh(g, mat('cupShell', () => new THREE.MeshStandardMaterial({ color: 0xc7782e, roughness: 0.3, transparent: true, opacity: 0.62, depthWrite: false, side: D2 })));
  const water = new THREE.Mesh(lathe([[0, 0.008], [0.037, 0.008], [0.0395, 0.1], [0, 0.1]], 14), mat('cupWater', () => new THREE.MeshStandardMaterial({ color: 0xa9d2e0, roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false })));
  water.name = 'water';
  const ice = new THREE.Group(); ice.name = 'ice';
  const cube = rbox(0.019, 0.017, 0.019, 0.004);
  for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(cube, mat('iceCube', () => new THREE.MeshStandardMaterial({ color: 0xeaf6fb, roughness: 0.08, transparent: true, opacity: 0.75 }))); c.position.set(Math.cos(i * 2.1) * 0.014, 0.06 + i * 0.012, Math.sin(i * 2.1) * 0.014); c.rotation.set(i, i * 2, i * 0.5); ice.add(c); }
  return group(shell, water, ice);
}
function refreshCup(o: THREE.Object3D, e: Ent) {
  const f = Math.max(0, Math.min(1, e.data?.fill ?? 0));
  const w = o.getObjectByName('water');
  if (w) { w.visible = f > 0.03; w.scale.set(1, Math.max(0.02, f), 1); w.position.y = 0.008 * (1 - f); }
  const ice = o.getObjectByName('ice');
  if (ice) ice.children.forEach((c, i) => { c.visible = i < (e.data?.ice ?? 0); c.position.y = Math.min(0.006 + 0.1 * f, 0.1) - 0.01 + i * 0.012; });
  const sh = o.children[0] as THREE.Mesh;
  if (sh && e.data?.dirty) (sh.material as THREE.MeshStandardMaterial) = mat('cupDirty', () => new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.6, transparent: true, opacity: 0.75, depthWrite: false, side: D2 }));
  else if (sh) (sh.material as THREE.MeshStandardMaterial) = mat('cupShell', () => new THREE.MeshStandardMaterial({ color: 0xc7782e, roughness: 0.3, transparent: true, opacity: 0.62, depthWrite: false, side: D2 }));
}

function iceBucket() {
  const b = lathe([[0.13, 0], [0.155, 0.24], [0.165, 0.25], [0.16, 0.255], [0.145, 0.245], [0.12, 0.02], [0, 0.02]], 18, { wob: 0.01 });
  const pile = new THREE.Group(); pile.name = 'pile';
  const cube = rbox(0.03, 0.026, 0.03, 0.006);
  const im = mat('iceCube2', () => new THREE.MeshStandardMaterial({ color: 0xe8f4fa, roughness: 0.1, transparent: true, opacity: 0.85 }));
  for (let i = 0; i < 26; i++) { const a = i * 2.39, r = 0.02 + Math.sqrt(i) * 0.024; const c = new THREE.Mesh(cube, im); c.position.set(Math.cos(a) * r, 0.03 + (i % 3) * 0.02, Math.sin(a) * r); c.rotation.set(i * 0.7, i * 1.3, i * 0.2); pile.add(c); }
  const scoop = mesh(merge([lathe([[0.03, 0], [0.034, 0.05], [0.0, 0.052]], 8, { arc: [0, Math.PI] }), tube(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, 0.12, 0), 0.008)]), flat(0xe8e2d0, 0.5));
  scoop.position.set(0.05, 0.12, 0.02); scoop.rotation.z = 0.5;
  return group(mesh(b, plasticD('red')), pile, scoop);
}

function iceBag() {
  const body = rbox(0.24, 0.32, 0.09, 0.04);
  wobble(body, 0.08, 8, 4);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), photo('img/labels/ice_bag_siri_mit_tube_ice.png', { alpha: true, rough: 0.2 }));
  front.position.set(0, 0.16, 0.047);
  const back = front.clone(); back.position.z = -0.047; back.rotation.y = Math.PI;
  return group(mesh(body, mat('bagPl', () => new THREE.MeshStandardMaterial({ color: 0xf2f6f8, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false }))), front, back);
}

const LABEL: Record<string, string> = {
  soda_cola_can: 'img/labels/cola_coke_can_325.png', soda_fanta_can: 'img/labels/soda_fanta_orange_can.png', soda_fanta_green: 'img/labels/soda_fanta_green_can.png',
  soda_red: 'img/labels/soda_fanta_red_bottle.png', water_bottle: 'img/labels/water_crystal_600ml.png',
};
function can(kind: string) {
  const side = lathe([[0.026, 0], [0.033, 0.008], [0.033, 0.11], [0.028, 0.122]], 18);
  band(side, 0.0, 1.0);
  frontArc(side, 200);
  const top = lathe([[0.028, 0.122], [0.0, 0.12]], 14);
  const s = new THREE.Mesh(side, photo(LABEL[kind], { rough: 0.35 }));
  const t = new THREE.Mesh(top, pbr('aluminium_scratched', { repeat: 0.3 }));
  return group(s, t);
}
function bottle(kind: string) {
  const glass = kind === 'soda_red';
  const prof: [number, number][] = glass
    ? [[0.0, 0], [0.03, 0], [0.032, 0.012], [0.032, 0.1], [0.026, 0.14], [0.013, 0.19], [0.013, 0.21], [0.0, 0.21]]
    : [[0.0, 0], [0.031, 0], [0.033, 0.015], [0.031, 0.06], [0.033, 0.12], [0.03, 0.15], [0.014, 0.19], [0.013, 0.215], [0.0, 0.215]];
  const g = lathe(prof, 16);
  const shell = new THREE.Mesh(g, mat('btl:' + kind, () => new THREE.MeshStandardMaterial({ color: glass ? 0xd9473a : 0xd8eef6, roughness: 0.08, metalness: 0, transparent: true, opacity: glass ? 0.85 : 0.45, depthWrite: !glass ? false : true })));
  const lb = new THREE.CylinderGeometry(0.0335, 0.0335, 0.055, 18, 1, true, Math.PI, Math.PI * 2);
  frontArc(lb, 200);
  const label = new THREE.Mesh(lb, photo(LABEL[kind], { rough: 0.4, side: D2 }));
  label.position.y = glass ? 0.07 : 0.085;
  const capG = rbox(0.03, 0.016, 0.03, 0.006, 0, glass ? 0.205 : 0.212, 0);
  const cap = mesh(capG, flat(glass ? 0xd8c040 : 0x2a64c8, 0.4, glass ? 0.6 : 0));
  cap.name = 'cap';
  return group(shell, label, cap);
}

function tissueBox() {
  const box = rbox(0.15, 0.11, 0.12, 0.018);
  const slot = mesh(rbox(0.09, 0.004, 0.012, 0.002, 0, 0.11, 0), flat(0x200a10, 1), false);
  const tongue = new THREE.PlaneGeometry(0.07, 0.07, 3, 3);
  const p = tongue.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.035; p.setXYZ(i, p.getX(i), y, Math.sin(y * 30) * 0.008 + y * y * 2); }
  tongue.computeVertexNormals();
  const t = new THREE.Mesh(tongue, mat('pinkPaperD', () => { const m = (pinkPaper() as THREE.MeshStandardMaterial).clone(); m.side = D2; return m; }));
  t.position.set(0, 0.112, 0);
  return group(mesh(box, plastic(0xf3c4d4, 0.5)), slot, t);
}

function crumpled() {
  const g = new THREE.IcosahedronGeometry(0.024, 1);
  wobble(g, 0.35, 40, Math.random() * 10);
  g.translate(0, 0.02, 0);
  return group(mesh(g, pinkPaper()));
}

function trashBin() {
  const b = lathe([[0.16, 0], [0.2, 0.6], [0.212, 0.61], [0.205, 0.62], [0.19, 0.61], [0.15, 0.02], [0, 0.02]], 20, { wob: 0.012 });
  const bagRim = new THREE.TorusGeometry(0.196, 0.012, 4, 20); bagRim.rotateX(Math.PI / 2); bagRim.translate(0, 0.615, 0);
  wobble(bagRim, 0.08, 10, 2);
  const contents = new THREE.Group(); contents.name = 'contents'; contents.position.y = 0.42;
  return group(mesh(b, plasticD(0x2f6e3c)), mesh(bagRim, pbr('rubber_black', { repeat: 1, rough: 0.35 })), contents);
}

function trashBag() {
  const g = new THREE.IcosahedronGeometry(0.2, 2);
  g.scale(1, 1.15, 0.9);
  wobble(g, 0.18, 6, 7);
  g.translate(0, 0.21, 0);
  const knot = new THREE.ConeGeometry(0.05, 0.12, 6); wobble(knot, 0.3, 20, 3); knot.translate(0, 0.48, 0);
  return group(mesh(merge([g, knot]), pbr('rubber_black', { repeat: 1, rough: 0.3 })));
}

function sponge() {
  const base = rbox(0.1, 0.03, 0.068, 0.008);
  const top = rbox(0.1, 0.01, 0.068, 0.003, 0, 0.03, 0);
  return group(mesh(base, photo('gen/restaurant/sponge_yellow.jpg', { rough: 0.95 })), mesh(top, photo('gen/restaurant/sponge_scour.jpg', { rough: 0.9 })));
}

function washTub(e: Ent) {
  const t = lathe([[0.22, 0], [0.3, 0.25], [0.32, 0.26], [0.315, 0.27], [0.29, 0.258], [0.21, 0.016], [0, 0.016]], 22, { wob: 0.015, seed: 3 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.278, 24), waterMaterial());
  water.rotation.x = -Math.PI / 2; water.position.y = 0.2; water.name = 'water'; water.renderOrder = 3;
  water.raycast = () => {};
  const contents = new THREE.Group(); contents.name = 'contents'; contents.position.y = 0.05;
  void e;
  return group(mesh(t, plasticD('blue')), water, contents);
}

function dishRack() {
  const tray = rbox(0.48, 0.03, 0.34, 0.01);
  const wires: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) { const x = -0.2 + i * 0.05; wires.push(tube(new THREE.Vector3(x, 0.03, -0.15), new THREE.Vector3(x, 0.03, 0.15), 0.004, 4)); }
  for (const z of [-0.15, 0, 0.15]) for (let i = 0; i < 9; i++) { const x = -0.2 + i * 0.05; wires.push(tube(new THREE.Vector3(x, 0.03, z), new THREE.Vector3(x, 0.2, z), 0.004, 4)); }
  for (const z of [-0.15, 0.15]) wires.push(tube(new THREE.Vector3(-0.22, 0.2, z), new THREE.Vector3(0.22, 0.2, z), 0.005, 4));
  const contents = new THREE.Group(); contents.name = 'contents';
  return group(mesh(tray, plastic(0xdfe3e6, 0.5)), mesh(merge(wires), steel()), contents);
}

function busTub() {
  const W = 0.5, Dp = 0.36, H = 0.16, t = 0.012;
  const g = merge([rbox(W, t, Dp, 0.004), rbox(W, H, t, 0.004, 0, 0, Dp / 2 - t / 2), rbox(W, H, t, 0.004, 0, 0, -Dp / 2 + t / 2), rbox(t, H, Dp, 0.004, W / 2 - t / 2, 0, 0), rbox(t, H, Dp, 0.004, -W / 2 + t / 2, 0, 0)]);
  const contents = new THREE.Group(); contents.name = 'contents'; contents.position.y = 0.02;
  return group(mesh(g, plastic(0x6b7177, 0.7)), contents);
}

function water20() {
  const bot = lathe([[0.01, 0], [0.135, 0.0], [0.14, 0.05], [0.135, 0.16], [0.14, 0.3], [0.135, 0.36], [0.05, 0.43], [0.05, 0.48], [0.01, 0.48]], 20);
  frontArc(bot, 200);
  return group(new THREE.Mesh(bot, photo('gen/shops/water20.png', { alpha: true, rough: 0.15, side: D2 })));
}

// ------------------------------------------------------------------ definitions

export function defineFurniture(game: Game) {
  const def = (d: ItemDef) => game.items.define(d);
  const stack = (n: number, dy: number, cols = 1, dx = 0.2): [number, number, number][] => Array.from({ length: n }, (_, i) => [cols > 1 ? ((i % cols) - (cols - 1) / 2) * dx : 0, 0.035 + Math.floor(i / cols) * dy, 0] as [number, number, number]);

  for (const c of ['red', 'blue'] as const) def({
    kind: 'stool_' + c, name: tl(c === 'red' ? 'เก้าอี้พลาสติกแดง' : 'เก้าอี้พลาสติกฟ้า', `${c} plastic stool`), weight: 0.7, price: 65, carry: 'head', fixed: true,
    tags: ['furniture', 'seat'], shape: { type: 'box', size: [0.36, 0.44, 0.36] }, build: () => stool(c), hold: { pos: [0, -0.1, 0], rot: [0.2, 0.4, 0], scale: 0.6 },
  });
  def({ kind: 'chair_plastic', name: tl('เก้าอี้พลาสติกมีพนัก', 'plastic chair'), weight: 1.6, price: 150, carry: 'head', fixed: true, tags: ['furniture', 'seat'], shape: { type: 'box', size: [0.5, 0.84, 0.5] }, build: () => chair(), hold: { pos: [0, -0.2, -0.1], rot: [0.3, 0.4, 0], scale: 0.5 } });
  def({
    kind: 'table_plastic', name: tl('โต๊ะพลาสติก', 'plastic table'), weight: 4, slots: 2, price: 390, carry: 'twohand', fixed: true, tags: ['furniture', 'table'],
    shape: { type: 'box', size: [0.8, 0.66, 0.62] }, data: () => ({ mess: 0 }),
    build: (e) => { const g = plasticTable(); addMess(g, e, 0.8, 0.62, TABLE_H.table_plastic); return g; },
    refresh: (o, e) => { const m = o.getObjectByName('mess') as THREE.Mesh; if (m) (m.material as THREE.ShaderMaterial).uniforms.uMess.value = e.data?.mess ?? 0; },
    label: (e) => tl((e.data?.mess ?? 0) > 0.25 ? 'โต๊ะ (สกปรก)' : 'โต๊ะพลาสติก', 'table'), hold: { pos: [0, -0.35, -0.2], rot: [0.3, 0, 0], scale: 0.45 },
  });
  def({
    kind: 'table_steel', name: tl('โต๊ะสแตนเลส', 'stainless table'), weight: 9, slots: 3, price: 1290, carry: 'twohand', fixed: true, tags: ['furniture', 'table'],
    shape: { type: 'box', size: [0.9, 0.71, 0.62] }, data: () => ({ mess: 0 }),
    build: (e) => { const g = steelTable(); addMess(g, e, 0.9, 0.62, TABLE_H.table_steel); return g; },
    refresh: (o, e) => { const m = o.getObjectByName('mess') as THREE.Mesh; if (m) (m.material as THREE.ShaderMaterial).uniforms.uMess.value = e.data?.mess ?? 0; },
    label: (e) => tl((e.data?.mess ?? 0) > 0.25 ? 'โต๊ะสแตนเลส (สกปรก)' : 'โต๊ะสแตนเลส', 'stainless table'), hold: { pos: [0, -0.35, -0.2], rot: [0.3, 0, 0], scale: 0.4 },
  });
  def({ kind: 'umbrella_big', name: tl('ร่มสนาม', 'big street umbrella'), weight: 6, slots: 2, price: 450, carry: 'back', fixed: true, tags: ['furniture', 'shade'], shape: { type: 'box', size: [0.36, 2.4, 0.36] }, build: () => umbrella(), hold: { pos: [0.1, -0.6, -0.3], rot: [0.5, 0, 0.3], scale: 0.25 } });
  def({
    kind: 'menu_poster', name: tl('ป้ายเมนู', 'menu board'), weight: 2.5, slots: 2, price: 120, carry: 'twohand', fixed: true, tags: ['furniture', 'sign'],
    shape: { type: 'box', size: [0.82, 1.05, 0.42] }, build: (e, g) => menuStand(e, g), hold: { pos: [0, -0.35, -0.1], rot: [0.2, 0, 0], scale: 0.4 },
  });
  def({
    kind: 'shop_sign', name: tl('ป้ายเปิด-ปิด', 'open/closed sign'), weight: 3, slots: 2, price: 90, carry: 'twohand', fixed: true, tags: ['furniture', 'sign'],
    shape: { type: 'box', size: [0.36, 1.35, 0.36] }, data: () => ({ open: false }), build: (_e, g) => signStand(g),
    animate: (o, e, dt) => {
      const s = o.getObjectByName('swing'); if (!s) return;
      const want = e.data?.open ? 0 : Math.PI;
      const u = s.userData as any;
      u.v = (u.v ?? 0) + ((want - s.rotation.y) * 60 - (u.v ?? 0) * 7) * dt;
      s.rotation.y += u.v * dt;
      u.sw = (u.sw ?? 0) * Math.exp(-2 * dt) + Math.abs(u.v) * dt * 0.05;
      s.rotation.x = Math.sin(performance.now() / 180) * Math.min(0.25, u.sw);
    },
    label: (e) => tl(e.data?.open ? 'ป้าย: เปิด' : 'ป้าย: ปิด', e.data?.open ? 'sign: OPEN' : 'sign: CLOSED'), hold: { pos: [0, -0.5, -0.1], rot: [0.2, 0, 0], scale: 0.35 },
  });
  def({
    kind: 'water_dispenser', name: tl('ตู้กดน้ำ', 'water dispenser'), weight: 12, slots: 3, price: 1890, carry: 'twohand', fixed: true, tags: ['furniture', 'appliance'],
    shape: { type: 'box', size: [0.32, 1.45, 0.32] }, data: () => ({ water: 18.9 }), build: () => dispenser(),
    refresh: (o, e) => { const b = o.getObjectByName('bottle'); if (b) b.visible = (e.data?.water ?? 0) > 0.05; },
    label: (e) => tl((e.data?.water ?? 0) > 0.05 ? `ตู้กดน้ำ (${(e.data.water).toFixed(1)} ล.)` : 'ตู้กดน้ำ (น้ำหมด!)', 'water dispenser'), hold: { pos: [0, -0.6, -0.2], rot: [0.2, 0, 0], scale: 0.3 },
  });
  def({ kind: 'water_bottle_20l', name: tl('ถังน้ำดื่ม 20 ลิตร', '20 L water bottle'), weight: 19, slots: 2, price: 20, carry: 'head', tags: ['water', 'heavy'], shape: { type: 'cyl', r: 0.14, h: 0.48 }, build: () => water20(), hold: { pos: [0, -0.2, -0.1], rot: [0.2, 0, 0], scale: 0.5 } });
  def({
    kind: 'cup_plastic', name: tl('แก้วพลาสติก', 'plastic cup'), weight: 0.08, price: 8, carry: 'hand', tags: ['vessel', 'cup', 'stack', 'drink'],
    shape: { type: 'cyl', r: 0.042, h: 0.113 }, data: () => ({ fill: 0, ice: 0, dirty: false }), build: () => cup(), refresh: (o, e) => refreshCup(o, e),
    label: (e) => tl(e.data?.dirty ? 'แก้วสกปรก' : (e.data?.fill ?? 0) > 0.1 ? `น้ำ${(e.data?.ice ?? 0) > 0 ? 'แข็ง' : 'เปล่า'} ${Math.round((e.data?.fill ?? 0) * 100)}%` : (e.data?.ice ?? 0) > 0 ? 'แก้วน้ำแข็ง' : 'แก้วเปล่า', 'cup'),
    hold: { pos: [0, 0.02, 0], rot: [0.1, 0, 0], scale: 1.2 },
  });
  def({
    kind: 'ice_bucket', name: tl('ถังน้ำแข็ง', 'ice bucket'), weight: 3, price: 160, carry: 'twohand', fixed: true, tags: ['furniture', 'ice'],
    shape: { type: 'cyl', r: 0.16, h: 0.26 }, data: () => ({ ice: 40 }), build: () => iceBucket(),
    refresh: (o, e) => { const p = o.getObjectByName('pile'); if (p) { const k = Math.max(0, Math.min(1, (e.data?.ice ?? 0) / 40)); p.visible = k > 0.02; p.scale.set(1, 0.3 + k * 2.2, 1); p.position.y = k * 0.1; } },
    label: (e) => tl(`ถังน้ำแข็ง (${Math.round(e.data?.ice ?? 0)} ก้อน)`, 'ice bucket'), hold: { pos: [0, -0.15, -0.05], rot: [0.2, 0, 0], scale: 0.6 },
  });
  def({ kind: 'ice_bag', name: tl('น้ำแข็งหลอด 1 ถุง', 'bag of tube ice'), weight: 3, price: 15, carry: 'hand', tags: ['ice'], shape: { type: 'box', size: [0.24, 0.32, 0.1] }, data: () => ({ ice: 40 }), build: () => iceBag(), hold: { pos: [0, -0.08, 0], rot: [0.1, 0, 0], scale: 0.6 } });
  const SODA_NAMES: Record<string, [string, string, number]> = {
    soda_cola_can: ['โค้กกระป๋อง', 'cola can', 17], soda_fanta_can: ['แฟนต้าส้ม', 'orange soda', 15], soda_fanta_green: ['แฟนต้าเขียว', 'green soda', 15],
    soda_red: ['แฟนต้าน้ำแดง', 'strawberry soda', 15], water_bottle: ['น้ำดื่มขวด', 'bottled water', 7],
  };
  for (const k of SODA_KINDS) {
    const [th, en, price] = SODA_NAMES[k];
    const isCan = k.includes('can') || k === 'soda_fanta_green';
    def({
      kind: k, name: tl(th, en), weight: 0.36, price, carry: 'hand', tags: ['drink', 'soda'],
      shape: isCan ? { type: 'cyl', r: 0.033, h: 0.122 } : { type: 'cyl', r: 0.033, h: 0.21 }, data: () => ({ empty: false }),
      build: () => (isCan ? can(k) : bottle(k)),
      refresh: (o, e) => { const em = !!e.data?.empty; o.scale.set(em && isCan ? 1.08 : 1, em && isCan ? 0.72 : 1, em && isCan ? 0.9 : 1); o.rotation.z = em && isCan ? 0.12 : 0; const c = o.getObjectByName('cap'); if (c) c.visible = !em; },
      label: (e) => tl(e.data?.empty ? th + ' (หมดแล้ว)' : th, en), hold: { pos: [0, 0, 0], rot: [0.1, 0, 0], scale: 1.1 },
    });
  }
  def({ kind: 'tissue_box', name: tl('กล่องทิชชู่', 'tissue box'), weight: 0.3, price: 35, carry: 'hand', fixed: true, tags: ['table_item', 'tissue'], shape: { type: 'box', size: [0.15, 0.12, 0.12] }, build: () => tissueBox(), hold: { scale: 0.8 } });
  def({ kind: 'trash_tissue', name: tl('ทิชชู่ใช้แล้ว', 'used tissue'), weight: 0.01, carry: 'hand', tags: ['trash'], pickRadius: 0.08, shape: { type: 'ball', r: 0.025 }, build: () => crumpled(), hold: { scale: 1.5 } });
  def({
    kind: 'trash_bin', name: tl('ถังขยะ', 'trash bin'), weight: 2.5, slots: 2, price: 120, carry: 'twohand', fixed: true, tags: ['furniture', 'bin'],
    shape: { type: 'cyl', r: 0.2, h: 0.62 }, container: { capacity: 14, layout: 'pile', accepts: (c, d) => isTrash(c, d) },
    label: (e) => tl(`ถังขยะ (${game.items.contents(e).length}/14)`, 'trash bin'), build: () => trashBin(), hold: { pos: [0, -0.3, -0.1], rot: [0.2, 0, 0], scale: 0.45 },
  });
  def({ kind: 'trash_bag', name: tl('ถุงขยะ', 'trash bag'), weight: 3, carry: 'back', tags: ['trash', 'bag'], shape: { type: 'box', size: [0.4, 0.5, 0.36] }, build: () => trashBag(), hold: { pos: [0, -0.25, -0.1], rot: [0, 0, 0], scale: 0.4 } });
  def({ kind: 'sponge', name: tl('ฟองน้ำล้างจาน', 'dish sponge'), weight: 0.03, price: 15, carry: 'hand', tags: ['tool', 'sponge', 'clean'], shape: { type: 'box', size: [0.1, 0.04, 0.07] }, data: () => ({ wet: 0 }), build: () => sponge(), hold: { pos: [0, 0, 0], rot: [0.3, 0.3, 0], scale: 1.4 } });
  def({
    kind: 'wash_tub', name: tl('กะละมังล้างจาน', 'washing-up tub'), weight: 3, slots: 2, price: 60, carry: 'twohand', fixed: true, tags: ['furniture', 'wash'],
    shape: { type: 'cyl', r: 0.31, h: 0.27 }, data: () => ({ soap: 1, dirt: 0, scrub: 0, busy: null }),
    container: { capacity: 10, layout: 'stack', accepts: (c) => VESSELS.includes(c.k) || c.k === 'spoon_fork' || c.k === 'wok' },
    build: (e) => washTub(e),
    refresh: (o, e) => { const w = o.getObjectByName('water') as THREE.Mesh; if (w) { const u = (w.material as THREE.ShaderMaterial).uniforms; u.uSoap.value = e.data?.soap ?? 1; u.uDirt.value = e.data?.dirt ?? 0; } },
    animate: (o, e, dt) => { const w = o.getObjectByName('water') as THREE.Mesh; if (w) { const u = (w.material as THREE.ShaderMaterial).uniforms; u.uTime.value += dt; u.uStir.value += ((e.data?.busy != null ? 1 : 0) - u.uStir.value) * Math.min(1, dt * 4); } },
    label: (e) => { const n = game.items.contents(e); const d = n.filter((x) => x.data?.dirty).length; return tl(d ? `กะละมัง (จานสกปรก ${d})` : n.length ? `กะละมัง (สะอาด ${n.length})` : 'กะละมังล้างจาน', 'wash tub'); },
    hold: { pos: [0, -0.3, -0.15], rot: [0.3, 0, 0], scale: 0.45 },
  });
  def({
    kind: 'dish_rack', name: tl('ที่คว่ำจาน', 'dish rack'), weight: 1.6, slots: 2, price: 180, carry: 'twohand', fixed: true, tags: ['furniture', 'rack'],
    shape: { type: 'box', size: [0.48, 0.22, 0.34] }, container: { capacity: 16, layout: 'stack', spots: stack(16, 0.03, 2, 0.21), accepts: (c) => VESSELS.includes(c.k) && !c.data?.dirty },
    label: (e) => tl(`ที่คว่ำจาน (${game.items.contents(e).length})`, 'dish rack'), build: () => dishRack(), hold: { pos: [0, -0.2, -0.1], rot: [0.3, 0, 0], scale: 0.6 },
  });
  def({
    kind: 'bus_tub', name: tl('กะละมังเก็บจาน', 'bus tub'), weight: 1.2, slots: 2, price: 50, carry: 'twohand', tags: ['container', 'bus'],
    shape: { type: 'box', size: [0.5, 0.16, 0.36] }, container: { capacity: 8, layout: 'pile', accepts: (c, d) => VESSELS.includes(c.k) || c.k === 'spoon_fork' || isTrash(c, d) || c.k === 'dish' },
    label: (e) => tl(`กะละมังเก็บจาน (${game.items.contents(e).length}/8)`, 'bus tub'), build: () => busTub(), hold: { pos: [0, -0.2, -0.1], rot: [0.3, 0, 0], scale: 0.6 },
  });
}
