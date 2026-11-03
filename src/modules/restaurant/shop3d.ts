import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/game';
import { Assets } from '../../core/assets';
import { Sound, type SoundHandle } from '../../core/audio';
import { F } from '../../core/fonts';
import { tl } from '../../core/util';
import type { Action, Ctx } from '../../game/interact';
import { SW_H, CLOSED_HOUSE } from '../world/layout';
import { unitDims } from '../world/shophouse';
import { libModel } from '../world/lib';
import { UNITS, DEPTH, rs, unitToWorld, type UnitGeo } from './premises';
import { recipeInfo } from './data';

/* =============================================================================================
 * SHOP3D — the ground floor of the two rentable CLOSED_HOUSE units, built and animated here
 * (the world builds the upper storeys only: RESTAURANT_UNITS / noGround):
 *   facade pilasters + beam, a real roller shutter (rolls up into its housing, bottom bar + padlock),
 *   "ให้เช่า" signbox + taped notice → after renting the lit lightbox "ร้านเฮียผัด อาหารตามสั่ง" with real dish
 *   photos; inside: ceramic floor, white-tile dado + plaster walls, ceiling, ceiling fan, fluorescent battens,
 *   stainless back kitchen (sink + tap, built-in wok burner + wok, hood + duct, LPG tank + hose), spice shelf,
 *   shrine shelf with red lamps, steel shelving with rice sacks, the live wall menu (g.menu), a wall clock on
 *   game time, a calendar; the party wall to the unit next door is boarded up until the expansion.
 *   Upgrades show up for real: split air-con, wall TV (animated screen), LED chaser + OPEN sign.
 * Colliders on every peer (floor, walls, back block, counter, shutters while closed).
 * Unit space: x along the facade (0..W, world +z), y up, z outward (interior z < 0) — see premises.unitToWorld.
 * ============================================================================================= */

const PW = 0.16;

// ------------------------------------------------------------------ materials

const matCache = new Map<string, THREE.Material>();
function pbr(id: string, o: { color?: number; rough?: number; metal?: number; ns?: number } = {}) {
  const key = id + JSON.stringify(o);
  let m = matCache.get(key);
  if (!m) {
    const base = Assets.pbrWorld(id, { color: o.color, normalScale: o.ns }).clone() as THREE.MeshStandardMaterial;
    if (o.rough !== undefined) { base.roughness = o.rough; }
    if (o.metal !== undefined) { base.metalness = o.metal; base.metalnessMap = null; }
    matCache.set(key, (m = base));
  }
  return m as THREE.MeshStandardMaterial;
}
/** interior materials get a soft self-lit term from their own albedo while the tubes are on (fake bounce light:
 *  the world's night-light pool doesn't reach custom materials and real lights would recompile every shader) */
const INTERIOR: THREE.MeshStandardMaterial[] = [];
function interior(m: THREE.MeshStandardMaterial) {
  if (!INTERIOR.includes(m)) { m.emissive = new THREE.Color(0xfff6e8); m.emissiveMap = m.map; m.emissiveIntensity = 0.05; INTERIOR.push(m); }
  return m;
}
export function setInteriorGlow(k: number) { for (const m of INTERIOR) m.emissiveIntensity = k; }
const M = {
  facade: () => pbr('plaster_peeling', { color: 0xd8cbb0 }),
  plinth: () => pbr('concrete_streaked', { color: 0x8a847a }),
  floor: () => interior(pbr('tiles_floor_ceramic', { color: 0xf2eee6, metal: 0 })),
  dado: () => interior(pbr('tiles_wall_white_dirty', { metal: 0, rough: 0.35 })),
  wall: (tint = 0xf0ead6) => interior(pbr('plaster_painted_clean', { color: tint, metal: 0 })),
  ceil: () => interior(pbr('plaster_painted_clean', { color: 0xf4f2ea, metal: 0 })),
  steel: () => pbr('stainless_brushed', { rough: 0.32 }),
  steelGrease: () => pbr('stainless_dented_greasy', { rough: 0.4 }),
  paint: (c: number) => pbr('metal_painted_chipped', { color: c }),
  teak: () => pbr('wood_teak', { metal: 0 }),
  ply: () => pbr('plywood', { metal: 0 }),
  iron: () => pbr('cast_iron_wok', { rough: 0.55 }),
  gold: () => pbr('brass_gold', { rough: 0.3 }),
  galv: () => pbr('galvanized_steel'),
  door: () => pbr('wood_painted_weathered', { color: 0x8a6a4a, metal: 0 }),
  chrome: () => pbr('chrome', { rough: 0.15 }),
  plastic: (c: number) => pbr('plastic_glossy', { color: c, metal: 0 }),
  alu: () => pbr('aluminium_scratched', { rough: 0.35 }),
};

// ------------------------------------------------------------------ geometry helpers

/** UVs in metres by dominant normal axis (box projection) so world-scaled PBR tiles correctly */
function boxUV(g: THREE.BufferGeometry, s = 1) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
/** bevelled box by min/max corners (unit space) */
function rb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.008) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const rr = Math.max(0.0005, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
  const g = new RoundedBoxGeometry(w, h, d, 2, rr);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return boxUV(g.toNonIndexed());
}
/** flat panel facing +normal: 'x+'|'x-'|'y+'|'y-'|'z+'|'z-' */
function panel(face: string, a0: number, a1: number, b0: number, b1: number, at: number) {
  const g = new THREE.PlaneGeometry(Math.abs(a1 - a0), Math.abs(b1 - b0));
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  switch (face) {
    case 'z+': g.translate(ca, cb, at); break;                                   // a=x b=y
    case 'z-': g.rotateY(Math.PI); g.translate(ca, cb, at); break;
    case 'x+': g.rotateY(Math.PI / 2); g.translate(at, cb, ca); break;           // a=z b=y
    case 'x-': g.rotateY(-Math.PI / 2); g.translate(at, cb, ca); break;
    case 'y+': g.rotateX(-Math.PI / 2); g.translate(ca, at, cb); break;          // a=x b=z
    case 'y-': g.rotateX(Math.PI / 2); g.translate(ca, at, cb); break;
  }
  return boxUV(g.toNonIndexed());
}
/** panel with plain 0..1 UVs (canvas art: signs, menu, posters, screens) */
function art(face: string, a0: number, a1: number, b0: number, b1: number, at: number) {
  const g = new THREE.PlaneGeometry(Math.abs(a1 - a0), Math.abs(b1 - b0));
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  switch (face) {
    case 'z+': g.translate(ca, cb, at); break;
    case 'x+': g.rotateY(Math.PI / 2); g.translate(at, cb, ca); break;
    case 'x-': g.rotateY(-Math.PI / 2); g.translate(at, cb, ca); break;
  }
  return g;
}
function lathe(pts: [number, number][], seg = 20) {
  return boxUV(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).toNonIndexed());
}
function tubeG(pts: number[][], r: number, seg = 24, rs_ = 8) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return boxUV(new THREE.TubeGeometry(c, seg, r, rs_, false).toNonIndexed());
}
function cyl(r0: number, r1: number, h: number, seg = 16) { return boxUV(new THREE.CylinderGeometry(r1, r0, h, seg).toNonIndexed()); }

/** collects geometry per material and merges it (one draw call per material per unit) */
class Batch {
  private m = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, mat: THREE.Material, mx?: THREE.Matrix4) {
    if (mx) g.applyMatrix4(mx);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (g.index) g = g.toNonIndexed();
    let a = this.m.get(mat);
    if (!a) this.m.set(mat, (a = []));
    a.push(g);
  }
  flush(parent: THREE.Object3D, name: string) {
    for (const [mat, gs] of this.m) {
      const g = mergeGeometries(gs);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
    }
    this.m.clear();
  }
}

// ------------------------------------------------------------------ canvases

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { t, cv, c };
}
const FOOD = 'textures/food/';
const DISHES: [string, string][] = [['kaphrao_moo', 'kaphrao_full_tile.jpg'], ['khao_phat', 'fried_rice_tile.jpg'], ['rat_na', 'rat_na_tile.jpg'], ['phat_phrik_kaeng', 'phat_phrik_kaeng_tile.jpg'], ['phat_si_io', 'noodles_phat_si_io_tile.jpg'], ['phat_phak_bung', 'phak_bung_tile.jpg'], ['khai_jiao', 'omelette_tile.jpg'], ['tom_yam', 'tomyum_bowl_top.png'], ['khai_dao', 'egg_fried_crispy.png'], ['moo_kratiam', 'pork_minced_raw_tile.jpg']];

/** "ร้านเฮียผัด อาหารตามสั่ง" printed vinyl lightbox face (real dish photos in round frames) */
function signCanvas() {
  const ct = canvasTex(2048, 432, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 432);
    g.addColorStop(0, '#d11a1a'); g.addColorStop(0.62, '#b50f0f'); g.addColorStop(1, '#7a0808');
    c.fillStyle = g; c.fillRect(0, 0, 2048, 432);
    c.fillStyle = '#ffd21a'; c.fillRect(0, 352, 2048, 80);
    c.fillStyle = '#7a0808'; c.fillRect(0, 346, 2048, 8);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.font = `800 210px ${F.heavy}`;
    c.lineWidth = 22; c.strokeStyle = '#3a0505'; c.strokeText('ร้านเฮียผัด', 1024, 158);
    c.fillStyle = '#fff6d8'; c.fillText('ร้านเฮียผัด', 1024, 158);
    c.font = `700 74px ${F.heavy}`; c.fillStyle = '#5a0606';
    c.fillText('อาหารตามสั่ง · กะเพรา · ข้าวผัด · ราดหน้า · ต้มยำ', 1024, 393);
    c.font = `600 40px ${F.ui}`; c.fillStyle = '#ffe9a8';
    c.fillText('เปิดทุกวัน 06:00 – 24:00  โทร 08-1234-5678', 1024, 298);
  });
  const photo = (file: string, x: number) => Assets.image(FOOD + file).then((im) => {
    const c = ct.c, R = 120, y = 170;
    c.save(); c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.closePath(); c.clip();
    const s = Math.max((R * 2) / im.width, (R * 2) / im.height);
    c.drawImage(im, x - (im.width * s) / 2, y - (im.height * s) / 2, im.width * s, im.height * s);
    c.restore();
    c.lineWidth = 12; c.strokeStyle = '#ffd21a'; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    ct.t.needsUpdate = true;
  }).catch(() => {});
  photo('kaphrao_full_tile.jpg', 190); photo('rat_na_tile.jpg', 1858);
  return ct.t;
}

function noticeCanvas() {
  return canvasTex(420, 600, (c) => {
    c.fillStyle = '#f4f0e2'; c.fillRect(0, 0, 420, 600);
    c.fillStyle = 'rgba(120,100,60,0.12)'; for (let i = 0; i < 40; i++) c.fillRect(Math.random() * 420, Math.random() * 600, 30, 2);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 118px ${F.heavy}`; c.fillStyle = '#c01212'; c.fillText('ให้เช่า', 210, 92);
    c.font = `700 40px ${F.heavy}`; c.fillStyle = '#1b2b6b'; c.fillText('FOR RENT', 210, 170);
    c.font = `400 34px ${F.hand}`; c.fillStyle = '#222';
    ['ห้องแถว 1 คูหา ทำเลทอง', 'หน้าร้านมีรถเข็นกะเพรา', 'มัดจำ 3,000 บ. / วันละ 150', 'ติดต่อ เจ๊ลำไย', '08-1234-5678', '(ไม่รับคนผัดค่าเช่า)'].forEach((l, i) => c.fillText(l, 210, 238 + i * 44));
    // tear-off phone strips (two already torn)
    for (let i = 0; i < 8; i++) {
      const x = 14 + i * 50;
      if (i === 2 || i === 5) continue;
      c.save(); c.translate(x + 22, 560); c.rotate(-Math.PI / 2);
      c.font = `400 17px ${F.hand}`; c.fillStyle = '#333'; c.fillText('081-234-5678', 0, 0);
      c.restore();
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(x, 510); c.lineTo(x, 600); c.stroke(); c.setLineDash([]);
    }
    c.fillStyle = 'rgba(230,220,180,0.55)'; c.fillRect(150, -6, 120, 34); // tape
  }).t;
}

/** live wall menu (dish photos + names + prices from g.menu) */
class WallMenu {
  readonly tex: THREE.CanvasTexture;
  private cv: HTMLCanvasElement; private c: CanvasRenderingContext2D;
  private key = '';
  private imgs = new Map<string, HTMLImageElement>();
  constructor() {
    const ct = canvasTex(1536, 576, () => {});
    this.tex = ct.t; this.cv = ct.cv; this.c = ct.c;
    for (const [id, f] of DISHES) Assets.image(FOOD + f).then((im) => { this.imgs.set(id, im); this.key = ''; }).catch(() => {});
  }
  update(game: Game) {
    const menu = game.g.menu ?? {};
    const ids = DISHES.map((d) => d[0]).filter((r) => menu[r] !== undefined);
    const k = JSON.stringify(ids.map((r) => [r, menu[r]])) + this.imgs.size;
    if (k === this.key) return;
    this.key = k;
    const c = this.c;
    c.fillStyle = '#1d2b22'; c.fillRect(0, 0, 1536, 576);
    c.fillStyle = '#ffd21a'; c.fillRect(0, 0, 1536, 92);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 64px ${F.heavy}`; c.fillStyle = '#7a0808'; c.fillText('เมนูร้านเฮียผัด', 768, 48);
    const cols = 4, cw = 1536 / cols;
    ids.slice(0, 8).forEach((r, i) => {
      const x = (i % cols) * cw + cw / 2, y = 150 + Math.floor(i / cols) * 220;
      const im = this.imgs.get(r);
      if (im) {
        c.save(); c.beginPath(); c.arc(x - 110, y + 40, 62, 0, Math.PI * 2); c.clip();
        const s = Math.max(124 / im.width, 124 / im.height);
        c.drawImage(im, x - 110 - (im.width * s) / 2, y + 40 - (im.height * s) / 2, im.width * s, im.height * s);
        c.restore();
        c.strokeStyle = '#ffd21a'; c.lineWidth = 5; c.beginPath(); c.arc(x - 110, y + 40, 62, 0, Math.PI * 2); c.stroke();
      }
      let name = '';
      try { name = recipeInfo(game, r).name.th; } catch { name = r; }
      c.textAlign = 'left';
      c.font = `700 40px ${F.heavy}`; c.fillStyle = '#fff6d8';
      let nm = name; while (c.measureText(nm).width > cw - 190 && nm.length > 3) nm = nm.slice(0, -2) + '…';
      c.fillText(nm, x - 36, y + 18);
      c.font = `800 52px ${F.heavy}`; c.fillStyle = '#ffd21a'; c.fillText(`${menu[r]}.-`, x - 36, y + 74);
      c.textAlign = 'center';
    });
    c.font = `500 30px ${F.ui}`; c.fillStyle = '#9ab8a0';
    c.fillText('พิเศษ +10 · ไข่ดาว +10 · น้ำเปล่าฟรี (ถ้ามีแก้ว)', 768, 548);
    this.tex.needsUpdate = true;
  }
}

/** the TV upgrade: a Thai league match on a fake broadcast (animated canvas) */
class TvScreen {
  readonly tex: THREE.CanvasTexture;
  private c: CanvasRenderingContext2D;
  private t = 0; private acc = 0;
  constructor() { const ct = canvasTex(320, 180, () => {}); this.tex = ct.t; this.c = ct.c; }
  update(dt: number) {
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    const c = this.c, t = this.t;
    c.fillStyle = '#2f7d32'; c.fillRect(0, 0, 320, 180);
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#2a722d' : '#348a38'; c.fillRect(((i * 50 - t * 30) % 400 + 400) % 400 - 40, 0, 25, 180); }
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.strokeRect(10, 20, 300, 150); c.beginPath(); c.moveTo(160 - t * 30 % 320, 20); c.lineTo(160 - t * 30 % 320, 170); c.stroke();
    for (let i = 0; i < 10; i++) {
      const x = (i * 37 + Math.sin(t * 0.9 + i) * 40 - t * 25) % 320, y = 40 + ((i * 53) % 120) + Math.cos(t * 1.3 + i) * 10;
      c.fillStyle = i < 5 ? '#1a3ab8' : '#e01818'; c.beginPath(); c.arc((x + 320) % 320, y, 4, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#fff'; c.beginPath(); c.arc((180 + Math.sin(t * 2.1) * 60 - t * 25) % 320 + 320 * 0, 95 + Math.cos(t * 1.7) * 30, 2.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(6, 4, 132, 18);
    c.font = `700 13px ${F.ui}`; c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`ไทย ${1 + (Math.floor(t / 47) % 3)} - ${Math.floor(t / 61) % 2} เวียดนาม`, 10, 13);
    c.fillStyle = '#c01212'; c.fillRect(0, 160, 320, 20);
    c.font = `600 12px ${F.ui}`; c.fillStyle = '#fff';
    c.fillText('ข่าวด่วน: ร้านเฮียผัดกลางซอย กะเพราอร่อยจนผีต่อคิว · ราคาทองวันนี้ขึ้น · ', 320 - ((t * 60) % 900), 170);
    this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ one unit

interface UnitRT {
  u: UnitGeo;
  root: THREE.Group;
  yb: number; y1: number; hs: number;
  shutter: THREE.Mesh; shutterMat: THREE.MeshStandardMaterial; bar: THREE.Group; open: number; want: number;
  shutterCol: any; boardCol?: any; board?: THREE.Object3D;
  fan?: THREE.Object3D; tubes: THREE.Mesh[]; light?: any;
  rent?: THREE.Object3D; sign?: THREE.Mesh; signMat?: THREE.MeshStandardMaterial; banner?: THREE.Object3D;
  ups: Record<string, THREE.Object3D>;
  clock?: { h: THREE.Object3D; m: THREE.Object3D };
  menu?: WallMenu; tv?: TvScreen; led?: THREE.MeshStandardMaterial; open_sign?: THREE.MeshStandardMaterial;
  loops: Record<string, SoundHandle | null>;
}

export class ShopHouse3D {
  private units: UnitRT[] = [];
  private bodies: any[] = [];
  private root = new THREE.Group();
  private t = 0;
  private lastShutter: number[] = [];

  constructor(private game: Game) { this.root.name = 'restaurant:shophouse'; }

  private col(u: UnitGeo, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const ph = this.game.physics;
    if (!ph) return null;
    const c = unitToWorld(u, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const coll = ph.addBox(c, [Math.abs(z1 - z0), Math.abs(y1 - y0), Math.abs(x1 - x0)], 0, { tag: { restaurant: u.i } });
    const body = (coll as any)?.parent?.() ?? null;
    if (body) this.bodies.push(body);
    return body;
  }
  private uncol(body: any) {
    if (!body) return;
    const ph: any = this.game.physics;
    try { ph?.removeBody(body); } catch { /* physics world already rebuilt */ }
    if (ph?.staticBodies) ph.staticBodies = ph.staticBodies.filter((b: any) => b !== body);
    this.bodies = this.bodies.filter((b) => b !== body);
  }

  build() {
    const game = this.game;
    if (!game.scene) return;
    game.scene.add(this.root);
    for (const u of UNITS) this.units.push(this.buildUnit(u));
    this.sync(true);
  }

  private buildUnit(u: UnitGeo): UnitRT {
    const game = this.game;
    const spec = { face: 'W' as const, line: CLOSED_HOUSE.x0, a0: u.a0, a1: u.a0 + 4.83, storeys: 3 } as any;
    const dims = unitDims(spec);
    const y0 = SW_H, y1 = y0 + dims.h0, yb = y1 - 0.45;
    const W = u.W, D = DEPTH, main = u.i === 0;
    const root = new THREE.Group();
    root.name = 'restaurant:unit' + u.i;
    root.position.set(u.frontX, 0, u.a0);
    root.rotation.y = -Math.PI / 2;
    this.root.add(root);
    const B = new Batch();
    const wallTint = main ? 0xf2ead2 : 0xe2eedc;

    // ---------------- facade: pilasters with plinth + capital, beam band, inner beam soffit
    for (const [a, b] of [[0, PW], [W - PW, W]]) {
      B.add(rb(a, y0, -0.25, b, yb + 0.02, 0.13, 0.012), M.facade());
      B.add(rb(a - 0.012, y0, -0.02, b + 0.012, y0 + 0.34, 0.148, 0.01), M.plinth());
      B.add(rb(a - 0.008, yb - 0.16, -0.02, b + 0.008, yb - 0.04, 0.155, 0.008), M.plinth());
    }
    B.add(rb(0, yb, -0.2, W, y1, 0.03, 0.015), M.facade());
    B.add(rb(0.02, y1 - 0.06, 0.02, W - 0.02, y1 + 0.02, 0.09, 0.01), M.plinth());           // drip ledge
    // shutter housing + side guide rails + threshold track
    const shutTint = main ? 0x6a7a72 : 0x8a8478;
    B.add(rb(PW, yb - 0.32, -0.06, W - PW, yb, 0.22, 0.02), M.paint(shutTint));
    for (const x of [PW + 0.012, W - PW - 0.012]) B.add(rb(x - 0.022, y0, -0.07, x + 0.022, yb - 0.3, 0.0, 0.004), M.galv());
    B.add(rb(PW, y0, -0.06, W - PW, y0 + 0.012, 0.01, 0.003), M.alu());

    // ---------------- interior shell
    B.add(panel('y+', PW, W - PW, -D, 0, y0 + 0.003), M.floor());
    const dadoH = y0 + 1.3;
    const wallFace = (face: 'x+' | 'x-' | 'z+', at: number, a0: number, a1: number, skipA?: [number, number, number]) => {
      // [skipA] = opening (a0, a1, top) for the party wall
      const segs: [number, number, number, number][] = [];
      if (skipA) { segs.push([a0, skipA[0], y0, yb], [skipA[1], a1, y0, yb], [skipA[0], skipA[1], skipA[2], yb]); }
      else segs.push([a0, a1, y0, yb]);
      for (const [s0, s1, v0, v1] of segs) {
        if (s1 - s0 < 0.01 || v1 - v0 < 0.01) continue;
        if (v0 < dadoH) B.add(panel(face, s0, s1, v0, Math.min(v1, dadoH), at), M.dado());
        if (v1 > dadoH) B.add(panel(face, s0, s1, Math.max(v0, dadoH), v1, at), M.wall(wallTint));
      }
      // dado cap rail
      const capSegs = skipA ? [[a0, skipA[0]], [skipA[1], a1]] : [[a0, a1]];
      for (const [s0, s1] of capSegs) {
        if (s1 - s0 < 0.02) continue;
        const o = face === 'x+' ? 1 : face === 'x-' ? -1 : 1;
        if (face === 'z+') B.add(rb(s0, dadoH - 0.02, at, s1, dadoH + 0.02, at + 0.03, 0.008), M.paint(0x3a6a5a));
        else B.add(rb(at, dadoH - 0.02, s0, at + o * 0.03, dadoH + 0.02, s1, 0.008), M.paint(0x3a6a5a));
      }
    };
    const opening: [number, number, number] = [-4.6, -2.1, y0 + 2.3];
    wallFace('x+', PW, -D, 0, u.i === 1 ? opening : undefined);
    wallFace('x-', W - PW, -D, 0, u.i === 0 ? opening : undefined);
    const doorX0 = main ? 3.8 : 3.6, doorX1 = doorX0 + 0.78;
    // back wall with a door to the back room
    B.add(panel('z+', PW, doorX0, y0, dadoH, -D), M.dado()); B.add(panel('z+', doorX1, W - PW, y0, dadoH, -D), M.dado());
    B.add(panel('z+', PW, doorX0, dadoH, yb, -D), M.wall(wallTint)); B.add(panel('z+', doorX1, W - PW, dadoH, yb, -D), M.wall(wallTint));
    B.add(panel('z+', doorX0, doorX1, y0 + 2.08, yb, -D), M.wall(wallTint));
    B.add(rb(doorX0 - 0.06, y0, -D, doorX0, y0 + 2.14, -D + 0.05, 0.006), M.door());
    B.add(rb(doorX1, y0, -D, doorX1 + 0.06, y0 + 2.14, -D + 0.05, 0.006), M.door());
    B.add(rb(doorX0 - 0.06, y0 + 2.08, -D, doorX1 + 0.06, y0 + 2.14, -D + 0.05, 0.006), M.door());
    B.add(rb(doorX0 + 0.01, y0 + 0.01, -D - 0.04, doorX1 - 0.01, y0 + 2.07, -D - 0.005, 0.01), M.door());
    B.add(lathe([[0, 0], [0.022, 0], [0.024, 0.012], [0.012, 0.05], [0, 0.05]], 12).rotateX(Math.PI / 2).translate(doorX1 - 0.09, y0 + 1.0, -D + 0.04), M.chrome());
    // ceiling + soffit band at the front
    B.add(panel('y-', PW, W - PW, -D, -0.2, yb), M.ceil());
    // party-wall slab (thickness) so the boarded opening reads as a real wall
    if (u.i === 0) {
      for (const [z0, z1] of [[-D, opening[0]], [opening[1], -0.25]]) B.add(rb(W - PW, y0, z0, W + 0.01 + PW, yb, z1, 0.004), M.wall(0xdcd6c4));
      B.add(rb(W - PW, opening[2], opening[0], W + 0.01 + PW, yb, opening[1], 0.004), M.wall(0xdcd6c4));
    }

    // ---------------- ceiling fan + fluorescent battens
    const fan = new THREE.Group();
    fan.position.set(W / 2, yb, -D * 0.5);
    const fanB = new Batch();
    fanB.add(lathe([[0, 0], [0.07, 0], [0.07, -0.03], [0.012, -0.05], [0, -0.05]], 18), M.paint(0xf0eee6));
    fanB.add(cyl(0.012, 0.012, 0.32, 8).translate(0, -0.2, 0), M.paint(0xf0eee6));
    fanB.add(lathe([[0, -0.36], [0.1, -0.37], [0.12, -0.42], [0.1, -0.47], [0, -0.48]], 24), M.paint(0xf0eee6));
    fanB.flush(fan, 'fan-body');
    const blades = new THREE.Group(); blades.position.y = -0.43;
    const bB = new Batch();
    for (let k = 0; k < 3; k++) {
      const mx = new THREE.Matrix4().makeRotationY((k * Math.PI * 2) / 3);
      bB.add(rb(0.1, -0.008, -0.025, 0.24, 0.004, 0.025, 0.004), M.paint(0xd8d6ce), mx.clone());
      const blade = rb(0.22, -0.006, -0.075, 0.78, 0.004, 0.075, 0.005);
      blade.rotateX(0.14);
      bB.add(blade, M.paint(0xe8e6de), mx.clone());
    }
    bB.flush(blades, 'fan-blades');
    fan.add(blades);
    root.add(fan);
    const tubes: THREE.Mesh[] = [];
    for (const z of [-1.5, -D + 1.5]) {
      B.add(rb(W / 2 - 0.05, yb - 0.055, z - 0.62, W / 2 + 0.05, yb - 0.005, z + 0.62, 0.012), M.paint(0xeeeeea));
      const tm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f8ff, emissiveIntensity: 0, roughness: 0.3 });
      const tube = new THREE.Mesh(cyl(0.013, 0.013, 1.18, 10).rotateX(Math.PI / 2).translate(W / 2, yb - 0.075, z), tm);
      tube.castShadow = false;
      root.add(tube); tubes.push(tube);
    }
    const light = (game.world as any)?.addLightPoint?.(new THREE.Vector3(...unitToWorld(u, W / 2, yb - 0.3, -D * 0.5)), 0xeef6ff, 0, 8, 0.4);

    // ---------------- kitchen (main unit): stainless counter, sink + tap, built-in wok burner, hood, LPG, shelves
    const rt: Partial<UnitRT> = { ups: {}, loops: {} };
    if (main) {
      const kz0 = -D + 0.02, kz1 = -D + 0.7, top = y0 + 0.86, cx0 = 0.3, cx1 = 3.6;
      const sinkX0 = 0.55, sinkX1 = 1.1, burnX = 2.75;
      // cabinets (two door bays + an open bay for the gas tank under the burner)
      B.add(rb(cx0, y0, kz0, 2.35, top - 0.03, kz1 - 0.02, 0.01), M.steel());
      B.add(rb(3.2, y0, kz0, cx1, top - 0.03, kz1 - 0.02, 0.01), M.steel());
      B.add(rb(2.35, y0, kz0, 3.2, y0 + 0.06, kz1 - 0.02, 0.006), M.steel());
      for (const x of [0.86, 1.4, 1.88]) B.add(rb(x - 0.003, y0 + 0.08, kz1 - 0.025, x + 0.003, top - 0.07, kz1 - 0.017, 0.001), M.steelGrease());
      for (const x of [0.62, 1.14, 1.62, 2.12, 3.38]) B.add(tubeG([[x - 0.06, top - 0.16, kz1 - 0.015], [x - 0.06, top - 0.16, kz1 + 0.012], [x + 0.06, top - 0.16, kz1 + 0.012], [x + 0.06, top - 0.16, kz1 - 0.015]], 0.006, 12, 6), M.chrome());
      // worktop in pieces around the sink hole
      B.add(rb(cx0, top - 0.03, kz0, sinkX0, top, kz1, 0.006), M.steel());
      B.add(rb(sinkX1, top - 0.03, kz0, cx1, top, kz1, 0.006), M.steel());
      B.add(rb(sinkX0, top - 0.03, kz0, sinkX1, top, kz0 + 0.12, 0.004), M.steel());
      B.add(rb(sinkX0, top - 0.03, kz1 - 0.1, sinkX1, top, kz1, 0.004), M.steel());
      B.add(rb(cx0, top, kz0, cx1, top + 0.12, kz0 + 0.025, 0.006), M.steel());             // upstand
      // sink basin (open box) + drain + tap
      const sb = top - 0.22;
      B.add(rb(sinkX0, sb, kz0 + 0.12, sinkX1, sb + 0.01, kz1 - 0.1, 0.003), M.steelGrease());
      for (const [a, b, c2, d] of [[sinkX0, sinkX0 + 0.008, kz0 + 0.12, kz1 - 0.1], [sinkX1 - 0.008, sinkX1, kz0 + 0.12, kz1 - 0.1]] as const) B.add(rb(a, sb, c2, b, top - 0.03, d, 0.002), M.steelGrease());
      for (const [c2, d] of [[kz0 + 0.12, kz0 + 0.128], [kz1 - 0.108, kz1 - 0.1]] as const) B.add(rb(sinkX0, sb, c2, sinkX1, top - 0.03, d, 0.002), M.steelGrease());
      B.add(cyl(0.025, 0.025, 0.004, 16).translate((sinkX0 + sinkX1) / 2, sb + 0.012, (kz0 + kz1) / 2), M.iron());
      B.add(cyl(0.016, 0.018, 0.2, 12).translate(0.83, top + 0.1, kz0 + 0.06), M.chrome());
      B.add(tubeG([[0.83, top + 0.2, kz0 + 0.06], [0.83, top + 0.33, kz0 + 0.1], [0.83, top + 0.3, kz0 + 0.26], [0.83, top + 0.22, kz0 + 0.3]], 0.011, 20, 8), M.chrome());
      B.add(rb(0.81, top + 0.18, kz0 + 0.03, 0.85, top + 0.2, kz0 + 0.12, 0.006), M.chrome());
      // built-in burner: cast iron ring + pan supports + wok with loop handles, heat-stained top
      B.add(cyl(0.2, 0.2, 0.004, 32).translate(burnX, top + 0.002, (kz0 + kz1) / 2), M.iron());
      B.add(boxUV(new THREE.TorusGeometry(0.09, 0.022, 10, 28).rotateX(Math.PI / 2).toNonIndexed()).translate(burnX, top + 0.03, (kz0 + kz1) / 2), M.iron());
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + 0.4; B.add(rb(-0.015, 0, -0.17, 0.015, 0.07, -0.11, 0.004).applyMatrix4(new THREE.Matrix4().makeRotationY(a)).translate(burnX, top, (kz0 + kz1) / 2), M.iron()); }
      const wok = lathe([[0, 0], [0.12, 0.012], [0.21, 0.05], [0.25, 0.1], [0.252, 0.104], [0.246, 0.104], [0.205, 0.056], [0.118, 0.018], [0, 0.006]], 32);
      B.add(wok.translate(burnX, top + 0.07, (kz0 + kz1) / 2), M.iron());
      for (const s of [-1, 1]) B.add(boxUV(new THREE.TorusGeometry(0.035, 0.007, 6, 14, Math.PI).rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2).toNonIndexed()).translate(burnX + s * 0.255, top + 0.17, (kz0 + kz1) / 2), M.iron());
      // hood + duct
      const hood = cyl(0.62, 0.22, 0.42, 4).rotateY(Math.PI / 4).scale(1, 1, 0.75).translate(burnX, top + 1.35, kz0 + 0.38);
      B.add(hood, M.steel());
      B.add(rb(burnX - 0.13, top + 1.56, kz0 + 0.25, burnX + 0.13, yb, kz0 + 0.5, 0.008), M.steel());
      // LPG tank in the open bay + red hose up to the burner
      const lpg = libModel('lpg_15kg'); lpg.position.set(2.78, y0, kz0 + 0.33); root.add(lpg);
      B.add(tubeG([[2.86, y0 + 0.62, kz0 + 0.33], [2.98, y0 + 0.72, kz0 + 0.45], [3.05, top - 0.12, kz1 - 0.06], [2.95, top - 0.02, kz1 - 0.2], [burnX + 0.12, top + 0.02, (kz0 + kz1) / 2]], 0.009, 30, 8), M.plastic(0xc0201a));
      // spice shelf above the sink with real bottles
      B.add(rb(0.35, y0 + 1.62, kz0, 1.6, y0 + 1.655, kz0 + 0.24, 0.006), M.teak());
      for (const x of [0.45, 1.5]) B.add(rb(x - 0.012, y0 + 1.48, kz0, x + 0.012, y0 + 1.62, kz0 + 0.22, 0.004), M.paint(0x2a2a28));
      ['bottle_fish_sauce_tiparos', 'bottle_oyster_sauce', 'bottle_golden_mountain', 'bottle_dark_soy', 'bottle_light_soy', 'bottle_fish_sauce_squid'].forEach((id, k) => {
        const b = libModel(id); b.position.set(0.47 + k * 0.17, y0 + 1.655, kz0 + 0.12 + (k % 2) * 0.03); b.rotation.y = k * 0.7; root.add(b);
      });
      const caddy = libModel('condiment_caddy'); caddy.position.set(1.45, top, kz1 - 0.2); root.add(caddy);
      const khan = libModel('khan_bowl'); khan.position.set(0.82, sb + 0.012, (kz0 + kz1) / 2 + 0.05); root.add(khan);
      // shrine shelf (high on the back wall): red lacquer backboard, teak shelf, small gilded Buddha, red lamps, garland
      const sx = 2.2, sy = y0 + 2.35;
      B.add(rb(sx - 0.4, sy, -D + 0.005, sx + 0.4, sy + 0.62, -D + 0.025, 0.006), M.plastic(0x9a1010));
      B.add(rb(sx - 0.42, sy - 0.04, -D, sx + 0.42, sy, -D + 0.3, 0.01), M.teak());
      for (const x of [sx - 0.36, sx + 0.36]) B.add(rb(x - 0.015, sy - 0.2, -D, x + 0.015, sy - 0.04, -D + 0.24, 0.004), M.teak());
      B.add(lathe([[0, 0], [0.06, 0], [0.06, 0.03], [0.045, 0.035], [0.05, 0.09], [0.035, 0.13], [0.02, 0.135], [0.028, 0.155], [0.02, 0.18], [0.006, 0.2], [0, 0.205]], 20).translate(sx, sy, -D + 0.14), M.gold());
      B.add(boxUV(new THREE.TorusGeometry(0.05, 0.012, 8, 20).rotateX(Math.PI / 2.4).toNonIndexed()).translate(sx, sy + 0.115, -D + 0.16), M.plastic(0xf08a12));
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 1.2, roughness: 0.4 });
      for (const x of [sx - 0.26, sx + 0.26]) {
        B.add(cyl(0.025, 0.02, 0.12, 12).translate(x, sy + 0.06, -D + 0.12), M.gold());
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8).scale(1, 1.4, 1).translate(x, sy + 0.15, -D + 0.12), lampMat);
        root.add(bulb);
      }
      B.add(lathe([[0, 0], [0.03, 0], [0.04, 0.05], [0.025, 0.1], [0.03, 0.12], [0, 0.12]], 14).translate(sx + 0.16, sy, -D + 0.1), M.plastic(0x2a6aa8));
      (game.world as any)?.addLightPoint?.(new THREE.Vector3(...unitToWorld(u, sx, sy + 0.2, -D + 0.3)), 0xff4020, 1.2, 2.5, 0.3);
      // steel shelving with stock (left wall, near the kitchen)
      const shelf = libModel('steel_frame_shelves_02'); shelf.position.set(PW + 0.27, y0, -D + 1.3); shelf.rotation.y = Math.PI / 2; root.add(shelf);
      const rice = libModel('rice_sack'); rice.position.set(PW + 0.42, y0, -D + 2.05); rice.rotation.y = 0.3; root.add(rice);
      const rice2 = libModel('rice_sack'); rice2.position.set(PW + 0.44, y0 + 0.16, -D + 2.0); rice2.rotation.y = -0.2; root.add(rice2);
      const gal = libModel('plastic_bottle_gallon'); gal.position.set(W - PW - 0.3, y0, -D + 0.95); root.add(gal);
      const crate = libModel('plastic_crate_02'); crate.position.set(3.15, y0, -D + 1.1); crate.rotation.y = 0.2; root.add(crate);
      const broom = libModel('plastic_broom'); broom.position.set(PW + 0.22, y0, -0.55); broom.rotation.set(0.1, -0.6, 0.12); root.add(broom);
      // wall menu (right wall), clock + calendar (left wall)
      const menu = new WallMenu();
      menu.update(game);
      B.add(rb(PW, y0 + 1.5, -4.2, PW + 0.035, y0 + 2.48, -1.6, 0.01), M.alu());
      const mp = new THREE.Mesh(art('x+', -4.14, -1.66, y0 + 1.54, y0 + 2.44, PW + 0.037), new THREE.MeshStandardMaterial({ map: menu.tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: menu.tex, emissiveIntensity: 0.06 }));
      root.add(mp);
      rt.menu = menu;
      const clk = this.clock(root, PW + 0.012, y0 + 2.62, -1.05);
      rt.clock = clk;
      const cal = canvasTex(256, 360, (c) => {
        c.fillStyle = '#fbf8ee'; c.fillRect(0, 0, 256, 360);
        c.fillStyle = '#b8860b'; c.fillRect(0, 0, 256, 120);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `700 30px ${F.heavy}`; c.fillStyle = '#fff6d8'; c.fillText('ห้างทองเจ๊ลำไย', 128, 42);
        c.font = `500 20px ${F.ui}`; c.fillText('ทองแท้ 99.99% ผ่อนได้', 128, 84);
        c.font = `700 34px ${F.heavy}`; c.fillStyle = '#9a1010'; c.fillText('พฤศจิกายน', 128, 152);
        c.font = `500 20px ${F.ui}`; c.fillStyle = '#333';
        for (let d = 1; d <= 30; d++) c.fillText(String(d), 30 + ((d - 1) % 7) * 33, 196 + Math.floor((d - 1) / 7) * 34);
        c.strokeStyle = '#c01212'; c.lineWidth = 3; c.beginPath(); c.arc(30 + 2 * 33, 196, 15, 0, Math.PI * 2); c.stroke();
      });
      root.add(new THREE.Mesh(art('x+', -1.48, -1.18, y0 + 1.6, y0 + 2.02, PW + 0.012), new THREE.MeshStandardMaterial({ map: cal.t, roughness: 0.9 })));
      // upgrades (built now, shown when bought)
      rt.ups.aircon = this.aircon(root, PW + 0.02, yb - 0.5, -2.9);
      const tv = new TvScreen();
      rt.tv = tv;
      rt.ups.tv = this.tvSet(root, W - PW - 0.02, y0 + 2.45, -1.15, tv);
      const led = this.ledStrip(root, W, y1);
      rt.ups.led = led.obj; rt.led = led.mat; rt.open_sign = led.open;
    } else {
      // expansion: a potted plant, a poster and a wall fan on the bare room
      const plant = libModel('potted_plant_02'); plant.position.set(W - PW - 0.45, y0, -D + 0.5); root.add(plant);
      const poster = canvasTex(360, 500, (c) => {
        c.fillStyle = '#123a6a'; c.fillRect(0, 0, 360, 500);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `800 56px ${F.heavy}`; c.fillStyle = '#ffd21a'; c.fillText('ขอบคุณ', 180, 120);
        c.font = `700 34px ${F.heavy}`; c.fillStyle = '#fff'; c.fillText('ที่อุดหนุน', 180, 180);
        c.font = `500 26px ${F.ui}`; c.fillText('ร้านเฮียผัด อาหารตามสั่ง', 180, 300);
        c.fillText('ห้องแอร์ (ถ้าเปิด)', 180, 344);
      });
      root.add(new THREE.Mesh(art('z+', 1.2, 1.56, y0 + 1.55, y0 + 2.05, -D + 0.012), new THREE.MeshStandardMaterial({ map: poster.t, roughness: 0.8 })));
      // vinyl banner on its beam (after the expansion)
      const ban = canvasTex(1024, 180, (c) => {
        c.fillStyle = '#f4f0e0'; c.fillRect(0, 0, 1024, 180);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `800 92px ${F.heavy}`; c.fillStyle = '#c01212'; c.fillText('เฮียผัด (ห้องแอร์)', 512, 92);
        c.fillStyle = '#888'; for (const x of [24, 1000]) for (const y of [24, 156]) { c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fill(); }
      });
      const banner = new THREE.Mesh(art('z+', 0.5, W - 0.5, yb + 0.02, y1 - 0.02, 0.045), new THREE.MeshStandardMaterial({ map: ban.t, roughness: 0.75, side: THREE.DoubleSide }));
      root.add(banner);
      rt.banner = banner;
    }

    // ---------------- lightbox sign (main) / FOR RENT signbox + taped notice
    if (main) {
      const sy0 = 3.82, sy1 = sy0 + 0.95;
      B.add(rb(0.2, sy0 - 0.02, 0.03, W - 0.2, sy1 + 0.02, 0.26, 0.02), M.alu());
      const tex = signCanvas();
      const sm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.45 });
      const sign = new THREE.Mesh(art('z+', 0.24, W - 0.24, sy0 + 0.02, sy1 - 0.02, 0.262), sm);
      root.add(sign);
      rt.sign = sign; rt.signMat = sm;
      for (const x of [0.6, W - 0.6]) B.add(rb(x - 0.02, sy0 - 0.25, 0.0, x + 0.02, sy0 - 0.02, 0.12, 0.005), M.galv());
      const rent = new THREE.Group();
      const box = libModel('signbox_room_for_rent'); box.position.set(PW / 2, 2.55, 0.13 + 0.52); rent.add(box);
      const notice = new THREE.Mesh(art('z+', W / 2 + 0.35, W / 2 + 0.77, 1.15, 1.75, 0.012), new THREE.MeshStandardMaterial({ map: noticeCanvas(), roughness: 0.9 }));
      rent.add(notice);
      root.add(rent);
      rt.rent = rent;
    }

    // ---------------- the roller shutter (rolls into the housing) + bottom bar, handles, padlock
    const hs = yb - 0.32 - y0;
    const sMat = (Assets.pbr(main ? 'shutter_roller_painted' : 'shutter_roller_rusty', { color: main ? 0xd2dcd4 : 0xffffff }).clone()) as THREE.MeshStandardMaterial;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) { const t = sMat[k] as THREE.Texture | null; if (t) { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; (sMat as any)[k] = c; } }
    const sg = new THREE.BoxGeometry(W - 2 * PW - 0.04, hs, 0.018, 1, 1, 1);
    sg.translate(W / 2, -hs / 2, -0.035);
    const shutter = new THREE.Mesh(sg, sMat);
    shutter.position.y = yb - 0.32;
    shutter.castShadow = true; shutter.receiveShadow = true;
    root.add(shutter);
    game.interact.register(shutter, { kind: 'rest_shutter', data: { unit: u.i }, reach: 3.2 });
    const bar = new THREE.Group();
    const barB = new Batch();
    barB.add(rb(PW + 0.02, -0.035, -0.06, W - PW - 0.02, 0.01, 0.0, 0.006), M.galv());
    for (const x of [W / 2 - 0.6, W / 2 + 0.6]) barB.add(tubeG([[x - 0.06, 0.0, -0.005], [x - 0.06, 0.0, 0.03], [x + 0.06, 0.0, 0.03], [x + 0.06, 0.0, -0.005]], 0.007, 10, 6), M.galv());
    barB.add(rb(W / 2 - 0.035, -0.07, 0.0, W / 2 + 0.035, -0.005, 0.025, 0.006), M.gold());
    barB.add(boxUV(new THREE.TorusGeometry(0.022, 0.005, 6, 14, Math.PI).toNonIndexed()).translate(W / 2, -0.005, 0.012), M.chrome());
    barB.flush(bar, 'shutter-bar');
    root.add(bar);

    B.flush(root, 'shophouse');

    // ---------------- colliders: floor slab, side walls, back block, counter (+ shutter / board, toggled)
    this.col(u, 0, 0, -13.6, W, y0, 0);
    this.col(u, 0, y0, -D, PW, yb, 0);
    if (u.i === 1) this.col(u, W - PW, y0, -D, W, yb, 0);
    if (u.i === 0) { this.col(u, W - PW, y0, -D, W + 0.01 + PW, yb, opening[0]); this.col(u, W - PW, y0, opening[1], W + 0.01 + PW, yb, -0.2); }
    this.col(u, 0, y0, -13.6, W, yb, -D);
    if (main) this.col(u, 0.3, y0, -D, 3.6, y0 + 0.9, -D + 0.72);
    const out: UnitRT = {
      u, root, yb, y1, hs, shutter, shutterMat: sMat, bar, open: 0, want: 0, shutterCol: null, fan: blades, tubes, light,
      ups: rt.ups ?? {}, loops: {}, menu: rt.menu, tv: rt.tv, led: rt.led, open_sign: rt.open_sign, clock: rt.clock, sign: rt.sign, signMat: rt.signMat, rent: rt.rent, banner: rt.banner,
    };
    if (u.i === 0) {
      // plywood board over the opening to the unit next door (removed with the expansion)
      const bd = new THREE.Group();
      const bB = new Batch();
      bB.add(rb(W - PW + 0.01, y0, opening[0], W + PW, opening[2], opening[1], 0.004), M.ply());
      for (const z of [opening[0] + 0.2, opening[1] - 0.2]) bB.add(rb(W - PW - 0.01, y0 + 0.1, z - 0.04, W - PW + 0.01, opening[2] - 0.1, z + 0.04, 0.004), M.teak());
      bB.flush(bd, 'party-board');
      root.add(bd);
      out.board = bd;
      out.boardCol = this.col(u, W - PW, y0, opening[0], W + 0.01 + PW, opening[2], opening[1]);
    }
    return out;
  }

  private clock(root: THREE.Object3D, x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = Math.PI / 2;
    const B = new Batch();
    B.add(lathe([[0, 0], [0.17, 0], [0.175, 0.012], [0.17, 0.035], [0.155, 0.04], [0, 0.04]], 32).rotateX(Math.PI / 2), M.plastic(0x1a1a1a));
    B.flush(g, 'clock');
    const face = canvasTex(256, 256, (c) => {
      c.fillStyle = '#f6f2e6'; c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#222'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 28px ${F.heavy}`;
      for (let h = 1; h <= 12; h++) { const a = (h / 12) * Math.PI * 2; c.fillText(String(h), 128 + Math.sin(a) * 98, 128 - Math.cos(a) * 98); }
      c.font = `600 16px ${F.ui}`; c.fillStyle = '#9a1010'; c.fillText('เฮียผัด', 128, 170);
    });
    const fm = new THREE.Mesh(new THREE.CircleGeometry(0.155, 32).translate(0, 0, 0.041), new THREE.MeshStandardMaterial({ map: face.t, roughness: 0.6 }));
    g.add(fm);
    const hand = (len: number, w: number, c: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004).translate(0, len / 2 - 0.015, 0.046), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })); g.add(m); return m; };
    const h = hand(0.085, 0.012, 0x111111), m = hand(0.125, 0.008, 0x111111);
    root.add(g);
    return { h, m };
  }

  private aircon(root: THREE.Object3D, x: number, y: number, z: number) {
    const g = new THREE.Group();
    const B = new Batch();
    B.add(rb(x, y, z - 0.45, x + 0.24, y + 0.3, z + 0.45, 0.05), M.plastic(0xf2f2ee));
    B.add(rb(x + 0.2, y + 0.02, z - 0.4, x + 0.245, y + 0.07, z + 0.4, 0.01), M.plastic(0x3a3a3a));
    B.add(rb(x + 0.23, y + 0.21, z - 0.3, x + 0.242, y + 0.26, z + 0.3, 0.006), M.plastic(0xdcdcd8));
    B.add(tubeG([[x + 0.05, y, z + 0.4], [x + 0.03, y - 0.3, z + 0.42], [x + 0.02, y - 0.9, z + 0.45]], 0.012, 12, 6), M.plastic(0xe8e8e4));
    B.flush(g, 'aircon');
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6).translate(x + 0.242, y + 0.12, z + 0.32), new THREE.MeshStandardMaterial({ color: 0x40ff60, emissive: 0x40ff60, emissiveIntensity: 2 }));
    g.add(led);
    root.add(g);
    return g;
  }

  private tvSet(root: THREE.Object3D, x: number, y: number, z: number, tv: TvScreen) {
    const g = new THREE.Group();
    const B = new Batch();
    B.add(rb(x - 0.05, y - 0.06, z - 0.08, x, y + 0.06, z + 0.08, 0.006), M.paint(0x222222));
    B.add(rb(x - 0.095, y - 0.33, z - 0.56, x - 0.05, y + 0.33, z + 0.56, 0.012), M.plastic(0x101010));
    B.flush(g, 'tv');
    const scr = new THREE.Mesh(art('x-', z - 0.53, z + 0.53, y - 0.3, y + 0.3, x - 0.0955), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tv.tex, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0 }));
    g.add(scr);
    root.add(g);
    return g;
  }

  private ledStrip(root: THREE.Object3D, W: number, _y1: number) {
    const g = new THREE.Group();
    const ct = canvasTex(256, 8, (c) => { for (let i = 0; i < 32; i++) { c.fillStyle = ['#ff2020', '#ffd020', '#20ff60', '#20a0ff'][i % 4]; c.fillRect(i * 8 + 1, 1, 6, 6); } });
    ct.t.wrapS = THREE.RepeatWrapping; ct.t.repeat.set(6, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: ct.t, emissiveIntensity: 2.2 });
    const sy0 = 3.82, sy1 = sy0 + 0.95;
    for (const [a, b, c2, d] of [[0.18, sy0 - 0.04, W - 0.18, sy0 - 0.02], [0.18, sy1 + 0.02, W - 0.18, sy1 + 0.04]] as const) g.add(new THREE.Mesh(rb(a, b, 0.24, c2, d, 0.275, 0.004), mat));
    // "OPEN" LED sign hanging in the doorway
    const oc = canvasTex(256, 96, (c) => {
      c.fillStyle = '#0a0a0a'; c.fillRect(0, 0, 256, 96);
      c.strokeStyle = '#ff3030'; c.lineWidth = 6; c.strokeRect(6, 6, 244, 84);
      c.font = `800 60px ${F.heavy}`; c.fillStyle = '#ff4040'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OPEN', 128, 50);
    });
    const om = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: oc.t, emissiveIntensity: 1.8, roughness: 0.3 });
    const oy = 2.95;
    g.add(new THREE.Mesh(rb(W / 2 + 0.6, oy, -0.3, W / 2 + 1.25, oy + 0.25, -0.27, 0.01), M.plastic(0x111111)));
    g.add(new THREE.Mesh(art('z+', W / 2 + 0.62, W / 2 + 1.23, oy + 0.01, oy + 0.24, -0.268), om));
    g.add(new THREE.Mesh(cyl(0.002, 0.002, 0.42, 4).translate(W / 2 + 0.92, oy + 0.46, -0.285), M.chrome()));
    root.add(g);
    return { obj: g, mat, open: om };
  }

  // ------------------------------------------------------------------ per frame

  /** apply the replicated state: shutters, signs, board, upgrades, colliders */
  private sync(first = false) {
    const s = rs(this.game);
    for (const r of this.units) {
      const i = r.u.i;
      r.want = s.rented && (i === 0 || s.upgrades.includes('expand')) && !s.padlock ? (s.shutter[i] ?? 0) : 0;
      if (first) r.open = r.want;
      if (r.rent) r.rent.visible = !s.rented;
      if (r.sign) r.sign.visible = s.rented;
      if (r.banner) r.banner.visible = s.upgrades.includes('expand');
      if (r.board) {
        const show = !s.upgrades.includes('expand');
        r.board.visible = show;
        if (!show && r.boardCol) { this.uncol(r.boardCol); r.boardCol = null; }
        if (show && !r.boardCol) r.boardCol = this.col(r.u, r.u.W - PW, SW_H, -4.6, r.u.W + 0.01 + PW, SW_H + 2.3, -2.1);
      }
      for (const [id, o] of Object.entries(r.ups)) o.visible = s.upgrades.includes(id);
    }
  }

  frame(dt: number) {
    const game = this.game;
    this.t += dt;
    this.sync();
    const s = rs(game);
    const night = (game.world as any)?.night ?? 0;
    const cam = game.camera.getWorldPosition(_v);
    let anyOn = 0;
    for (const r of this.units) anyOn = Math.max(anyOn, r.open);
    setInteriorGlow(0.05 + 0.2 * Math.min(1, anyOn * 1.5));
    for (const r of this.units) {
      const i = r.u.i;
      // shutter roll (0.55 m/s, a little jerky like the real thing)
      const prev = r.open;
      const sp = 0.32 * (0.8 + 0.4 * Math.abs(Math.sin(this.t * 7.3 + i)));
      r.open += Math.max(-sp * dt, Math.min(sp * dt, r.want - r.open));
      const f = r.open;
      const vis = Math.max(0.002, 1 - f);
      r.shutter.scale.y = vis;
      r.shutter.visible = f < 0.995;
      // keep the slat texture scrolling with the shutter (texture repeat in metres)
      const rep = (r.hs * vis) / 0.5;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) { const t = r.shutterMat[k] as THREE.Texture | null; if (t) { t.repeat.set((r.u.W - 0.36) / 0.5, rep); t.offset.y = 0; } }
      r.bar.position.y = r.yb - 0.32 - r.hs * vis;
      if (Math.abs(prev - f) > 1e-4) {
        if (!r.loops.roll) r.loops.roll = Sound.loop('chain_rattle', { pos: new THREE.Vector3(...unitToWorld(r.u, r.u.W / 2, 2.6, 0)), vol: 0.55, ref: 3, max: 25 } as any);
      } else if (r.loops.roll) { r.loops.roll.stop(0.15); r.loops.roll = null; if (f > 0.99 || f < 0.01) Sound.play('drop_metal', { pos: new THREE.Vector3(...unitToWorld(r.u, r.u.W / 2, 0.4, 0)), vol: 0.5 }); }
      // collider while mostly closed
      if (f < 0.6 && !r.shutterCol) r.shutterCol = this.col(r.u, 0, SW_H, -0.12, r.u.W, r.yb, 0.02);
      else if (f >= 0.6 && r.shutterCol) { this.uncol(r.shutterCol); r.shutterCol = null; }
      // lights + fan + ambience when the unit is open
      const on = f > 0.3;
      const lit = on ? 1 : 0;
      for (const t of r.tubes) (t.material as THREE.MeshStandardMaterial).emissiveIntensity = lit * (1.6 + Math.sin(this.t * 120) * 0.04);
      if (r.light) r.light.intensity = lit * 9;
      if (r.fan && on) r.fan.rotation.y += dt * 7.5;
      const d = cam.distanceTo(_w.set(...unitToWorld(r.u, r.u.W / 2, 2, -DEPTH * 0.5)));
      const near = on && d < 22;
      this.loop(r, 'fan', near ? 'fan_loop' : '', unitToWorld(r.u, r.u.W / 2, r.yb - 0.4, -DEPTH * 0.5), 0.25);
      this.loop(r, 'tube', near ? 'fluorescent_buzz_loop' : '', unitToWorld(r.u, r.u.W / 2, r.yb - 0.1, -1.5), 0.08);
      this.loop(r, 'tv', near && i === 0 && s.upgrades.includes('tv') ? 'tv_muffled_loop' : '', unitToWorld(r.u, r.u.W - 0.3, 2.4, -1.2), 0.3);
      this.loop(r, 'ac', near && i === 0 && s.upgrades.includes('aircon') ? 'ac_hum_loop' : '', unitToWorld(r.u, 0.3, r.yb - 0.4, -2.9), 0.18);
      // signs glow after dusk (and a little by day)
      if (r.signMat) r.signMat.emissiveIntensity = s.rented ? 0.12 + night * 1.25 : 0;
      if (r.led) { r.led.emissiveMap!.offset.x = (this.t * 0.6) % 1; r.led.emissiveIntensity = 0.6 + night * 2.2; }
      if (r.open_sign) r.open_sign.emissiveIntensity = game.g.shopOpen && on ? (Math.floor(this.t * 1.5) % 6 === 0 ? 0.4 : 1.8) : 0.05;
      if (on && d < 18) { r.tv?.update(dt); r.menu?.update(game); }
      if (r.clock) {
        const tt = game.clock.time ?? 12;
        r.clock.h.rotation.z = -((tt % 12) / 12) * Math.PI * 2;
        r.clock.m.rotation.z = -((tt % 1)) * Math.PI * 2;
      }
    }
  }

  private loop(r: UnitRT, k: string, key: string, p: number[], vol: number) {
    const cur = r.loops[k];
    if (!key) { if (cur) { cur.stop(0.6); r.loops[k] = null; } return; }
    if (!cur) r.loops[k] = Sound.loop(key, { pos: new THREE.Vector3(p[0], p[1], p[2]), vol, ref: 1.5, max: 14 } as any);
  }

  dispose() {
    for (const r of this.units) { for (const k of Object.keys(r.loops)) r.loops[k]?.stop(0.1); this.game.interact.unregister(r.shutter); }
    for (const b of [...this.bodies]) this.uncol(b);
    this.bodies = [];
    this.units = [];
    this.root.removeFromParent();
  }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** interaction on the shutters: pull up / down (rented), read the notice (not yet) */
export function shutterProvider(game: Game) {
  return (ctx: Ctx): Action | null => {
    const h = ctx.hit;
    if (!h || h.kind !== 'rest_shutter') return null;
    const i = h.data?.unit ?? 0;
    const s = rs(game);
    const open = (s.shutter[i] ?? 0) > 0;
    if (!s.rented) return { key: 'E', label: tl('อ่านป้าย: ให้เช่า — ติดต่อเจ๊ลำไย', 'FOR RENT — ask the landlady'), priority: 3, run: () => game.ui.say(h.point.clone().add(new THREE.Vector3(0, 0.4, 0)), tl('ห้องว่างให้เช่า มัดจำ 3,000 วันละ 150 — เจ๊ลำไย 08-1234-5678', 'for rent: 3,000 deposit, 150/day — Jeh Lamyai'), { duration: 4 }) };
    if (i === 1 && !s.upgrades.includes('expand')) return { key: 'E', label: tl('ห้องข้างๆ (ยังไม่ได้เช่า)', 'next door (not rented)'), disabled: tl('ขอเช่าเพิ่มจากเจ๊ลำไย', 'rent it from the landlady'), priority: 3 };
    if (s.padlock) return { key: 'E', label: tl('ล่ามโซ่! ค้างค่าเช่า', 'padlocked! rent overdue'), disabled: tl('จ่ายค่าเช่าเจ๊ลำไยก่อน', 'pay the rent first'), priority: 3 };
    return { key: 'E', label: open ? tl('ดึงม่านเหล็กลง (ปิดร้าน)', 'pull the shutter down') : tl('ดึงม่านเหล็กขึ้น!', 'pull the shutter up!'), priority: 6, run: () => game.intent('rest.shutter', { unit: i, open: !open }) };
  };
}
