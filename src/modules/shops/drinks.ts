import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Convenience-store DRINKS — ring-pull cans, PET bottles, brown beer bottles and glass energy-drink
 * bottles, all PARODY brands (the repo is public: no real trademarks; puns in the spirit of Thai
 * shelves). Real packaging conventions are painted on each wrap label: logo block + flavour colour,
 * product photo-ish illustration, volume, a Thai GDA nutrition badge, ingredient lines, barcode,
 * a fake อย. registration box. One atlas (drinks label wraps + metal + glass tints), one physical
 * material with a cold-condensation normal map; geometry is merged into the shop's batch.
 *   drinkGeo(kind, variant) → geometry (origin bottom centre) with atlas UVs
 * ========================================================================================== */

export type DrinkKind = 'can' | 'pet' | 'beer' | 'energy';

interface Brand { th: string; en: string; c: string; c2: string; ink: string; vol: string; liquid: string; kind: DrinkKind; tag?: string }
/** parody brands only */
export const BRANDS: Brand[] = [
  { th: 'โค้กกี้', en: 'Cokey', c: '#c8141a', c2: '#ffffff', ink: '#ffffff', vol: '325 ml', liquid: '#2a120a', kind: 'can', tag: 'ซ่าสะใจ' },
  { th: 'เป๊ปซี่ย์', en: 'Pepsy', c: '#0b3a9a', c2: '#e8202a', ink: '#ffffff', vol: '325 ml', liquid: '#2a120a', kind: 'can', tag: 'MAX ไม่มีน้ำตาล' },
  { th: 'สไปร์ทตี้', en: 'Sprity', c: '#0e8a3a', c2: '#f2e21a', ink: '#ffffff', vol: '325 ml', liquid: '#e8f2d8', kind: 'can', tag: 'มะนาว·เลมอน' },
  { th: 'แฟนซ่า', en: 'Fanza', c: '#f07a10', c2: '#1a4ab0', ink: '#ffffff', vol: '325 ml', liquid: '#f08a10', kind: 'can', tag: 'ส้มซ่า' },
  { th: 'กาแฟเย็นเฉียบ', en: 'BIRDEE COFFEE', c: '#6a2a12', c2: '#e8c070', ink: '#fff2d8', vol: '180 ml', liquid: '#3a1a0a', kind: 'can', tag: 'เอสเปรสโซ่' },
  { th: 'ชาเขียวโอ้อิ่ม', en: 'OH-IM GREEN TEA', c: '#3a9a2a', c2: '#f4f0d8', ink: '#ffffff', vol: '380 ml', liquid: '#c8b84a', kind: 'pet', tag: 'น้ำผึ้งมะนาว' },
  { th: 'น้ำดื่มสิงโต', en: 'SINGTO WATER', c: '#2a8ad8', c2: '#ffffff', ink: '#ffffff', vol: '600 ml', liquid: '#e8f4ff', kind: 'pet', tag: 'น้ำดื่มสะอาด' },
  { th: 'นมเปรี้ยวดัชหมู', en: 'DUTCH-MOO', c: '#e8285a', c2: '#ffffff', ink: '#ffffff', vol: '400 ml', liquid: '#f4e8f0', kind: 'pet', tag: 'รสสตรอว์เบอร์รี่' },
  { th: 'น้ำส้มคั้นใจ', en: 'ORANGE HEART', c: '#f2a21a', c2: '#2a8a2a', ink: '#ffffff', vol: '350 ml', liquid: '#f2a21a', kind: 'pet', tag: '100%' },
  { th: 'วัวแดง', en: 'RED COW', c: '#f2c21a', c2: '#c8141a', ink: '#c8141a', vol: '150 ml', liquid: '#c87a10', kind: 'energy', tag: 'ลุยได้ทั้งวัน' },
  { th: 'เอ็ม-151', en: 'M-151', c: '#2a2a2a', c2: '#e8c21a', ink: '#f2c21a', vol: '150 ml', liquid: '#8a4a10', kind: 'energy', tag: 'สู้ๆ' },
  { th: 'ลีโอ้', en: 'LEOH', c: '#c8141a', c2: '#f2d06a', ink: '#ffffff', vol: '620 ml', liquid: '#5a2a0a', kind: 'beer', tag: 'LAGER' },
  { th: 'ช้างน้อย', en: 'CHANG NOI', c: '#0e5a2a', c2: '#d8b04a', ink: '#f2e2a8', vol: '620 ml', liquid: '#5a2a0a', kind: 'beer', tag: 'CLASSIC' },
  { th: 'สิงห์โต', en: 'SINGHTO', c: '#f4f0e2', c2: '#c8a040', ink: '#8a1a14', vol: '620 ml', liquid: '#5a2a0a', kind: 'beer', tag: 'PREMIUM' },
  { th: 'เกลือแร่ซ่า', en: 'SPONSORRY', c: '#1a5ad8', c2: '#f2f2f2', ink: '#ffffff', vol: '250 ml', liquid: '#cfe8ff', kind: 'pet', tag: 'เกลือแร่' },
  { th: 'โซดาตราช้าง', en: 'SODA', c: '#e8eef2', c2: '#1a8a3a', ink: '#1a6a2a', vol: '325 ml', liquid: '#f4fbff', kind: 'can', tag: 'โซดา' },
];

const N = BRANDS.length;           // 16 label cells
const LW = 256, LH = 256;          // label wrap cell (u = around, v = height)
const AW = 2048, AH = 768;         // 8 × 2 label cells + a strip of utility cells
let atlas: THREE.CanvasTexture | null = null;
let normal: THREE.CanvasTexture | null = null;
let mat: THREE.MeshPhysicalMaterial | null = null;

function rng(s: number) { let x = s >>> 0 || 1; return () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 8) / 16777216; }; }

function fit(x: CanvasRenderingContext2D, t: string, maxW: number, px: number, weight = 900, font: string = F.heavy) {
  let s = px;
  do { x.font = `${weight} ${s}px ${font}`; s -= 2; } while (s > 8 && x.measureText(t).width > maxW);
}

function barcode(x: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, seed: number) {
  x.fillStyle = '#fff'; x.fillRect(ox, oy, w, h);
  const r = rng(seed);
  let px = ox + 3;
  while (px < ox + w - 4) { const bw = 1 + Math.floor(r() * 3); if (r() > 0.45) { x.fillStyle = '#111'; x.fillRect(px, oy + 2, bw, h - 9); } px += bw; }
  x.fillStyle = '#111'; x.font = `600 7px ${F.ui}`; x.textAlign = 'center'; x.fillText('8 850' + (100000 + seed * 37).toString().slice(0, 5), ox + w / 2, oy + h - 2);
}

/** Thai GDA ("หวาน มัน เค็ม") nutrition badge */
function gda(x: CanvasRenderingContext2D, ox: number, oy: number, w: number, seed: number) {
  const labels = ['พลังงาน', 'น้ำตาล', 'ไขมัน', 'โซเดียม'];
  const r = rng(seed * 3 + 1);
  const cw = w / 4;
  x.fillStyle = '#fff'; x.fillRect(ox, oy, w, 30);
  x.strokeStyle = '#111'; x.lineWidth = 1; x.strokeRect(ox + 0.5, oy + 0.5, w - 1, 29);
  labels.forEach((l, i) => {
    x.fillStyle = '#111'; x.font = `600 6.5px ${F.ui}`; x.textAlign = 'center'; x.fillText(l, ox + cw * (i + 0.5), oy + 9);
    x.font = `800 8px ${F.ui}`; x.fillText(String(Math.round(r() * (i === 0 ? 180 : 30))), ox + cw * (i + 0.5), oy + 19);
    x.font = `500 6px ${F.ui}`; x.fillText(`${Math.round(r() * 20)}%`, ox + cw * (i + 0.5), oy + 27);
    if (i) { x.beginPath(); x.moveTo(ox + cw * i, oy + 3); x.lineTo(ox + cw * i, oy + 27); x.stroke(); }
  });
}

function label(x: CanvasRenderingContext2D, ox: number, oy: number, b: Brand, i: number) {
  const W = LW, H = LH;
  x.save();
  x.beginPath(); x.rect(ox, oy, W, H); x.clip();
  // base: flavour colour with a soft gradient (front at u = 0.5)
  const g = x.createLinearGradient(ox, 0, ox + W, 0);
  g.addColorStop(0, b.c); g.addColorStop(0.5, b.c); g.addColorStop(1, b.c);
  x.fillStyle = g; x.fillRect(ox, oy, W, H);
  // design swoosh band (the "dynamic ribbon" every drink brand has)
  x.fillStyle = b.c2;
  x.beginPath(); x.moveTo(ox, oy + H * 0.62); x.bezierCurveTo(ox + W * 0.3, oy + H * 0.52, ox + W * 0.6, oy + H * 0.78, ox + W, oy + H * 0.66); x.lineTo(ox + W, oy + H * 0.74);
  x.bezierCurveTo(ox + W * 0.6, oy + H * 0.86, ox + W * 0.3, oy + H * 0.6, ox, oy + H * 0.7); x.closePath(); x.fill();
  // bubbles / fruit hints
  const r = rng(i * 17 + 3);
  for (let k = 0; k < 18; k++) { x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.arc(ox + W * 0.3 + r() * W * 0.4, oy + H * (0.15 + r() * 0.75), 1.5 + r() * 4, 0, Math.PI * 2); x.fill(); }
  // front logo block (centred at u = 0.5)
  const cx = ox + W * 0.5;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = b.ink; fit(x, b.th, W * 0.42, 40); x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.25)'; x.strokeText(b.th, cx, oy + H * 0.34); x.fillText(b.th, cx, oy + H * 0.34);
  x.fillStyle = b.ink; fit(x, b.en, W * 0.4, 18, 800, F.ui); x.fillText(b.en, cx, oy + H * 0.47);
  if (b.tag) { x.fillStyle = b.c2 === '#ffffff' ? b.c : b.c2; x.beginPath(); x.roundRect(cx - 34, oy + H * 0.86 - 9, 68, 18, 9); x.fill(); x.fillStyle = b.c2 === '#ffffff' ? '#fff' : b.c; fit(x, b.tag, 60, 11, 800, F.ui); x.fillText(b.tag, cx, oy + H * 0.86); }
  x.fillStyle = b.ink; x.font = `700 11px ${F.ui}`; x.fillText(b.vol, cx, oy + H * 0.95);
  // back panel (u ≈ 0 / 1 wraps behind): ingredients, GDA, barcode, อย.
  x.textAlign = 'left'; x.fillStyle = b.ink; x.font = `500 6.5px ${F.ui}`;
  const lines = ['ส่วนประกอบ: น้ำ, น้ำตาล, กรดซิตริก,', 'แต่งกลิ่นเลียนธรรมชาติ, วัตถุกันเสีย', 'ผลิตโดย บจก. เฮียผัดเบฟเวอเรจ (ล้อเลียน)', 'เก็บในที่เย็น เขย่าก่อนดื่ม'];
  lines.forEach((l, k) => x.fillText(l, ox + 6, oy + 30 + k * 9));
  gda(x, ox + 6, oy + 72, 58, i);
  barcode(x, ox + W - 60, oy + H * 0.52, 52, 30, i + 11);
  x.strokeStyle = b.ink; x.lineWidth = 1; x.strokeRect(ox + W - 60.5, oy + 30.5, 52, 16);
  x.font = `700 7px ${F.ui}`; x.fillText('อย. 99-9-' + (10000 + i * 731), ox + W - 58, oy + 41);
  x.restore();
}

function buildAtlas() {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const x = cv.getContext('2d')!;
  BRANDS.forEach((b, i) => label(x, (i % 8) * LW, Math.floor(i / 8) * LH, b, i));
  // utility strip (y 512..768): [0] brushed aluminium (can top/bottom) with a ring-pull, [1] clear PET plastic,
  // [2] brown glass, [3] cap colours, [4] crown cap gold, [5..] liquid tints are vertex-free: clear PET reads the liquid band
  const uy = 512;
  const alu = x.createLinearGradient(0, uy, 256, uy + 256); alu.addColorStop(0, '#c8ccd0'); alu.addColorStop(0.5, '#f2f4f6'); alu.addColorStop(1, '#a8acb0');
  x.fillStyle = alu; x.fillRect(0, uy, 256, 256);
  x.strokeStyle = 'rgba(80,84,88,0.6)'; x.lineWidth = 3; x.beginPath(); x.arc(128, uy + 128, 100, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.arc(128, uy + 128, 84, 0, Math.PI * 2); x.stroke();
  // ring-pull tab
  x.fillStyle = '#d8dce0'; x.strokeStyle = '#8a8e92'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(128, uy + 92, 22, 34, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  x.fillStyle = '#6a6e72'; x.beginPath(); x.ellipse(128, uy + 80, 9, 13, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#9a9ea2'; x.beginPath(); x.ellipse(128, uy + 150, 26, 18, 0, 0, Math.PI * 2); x.fill();
  // clear PET (pale blue-white, a little gradient)
  const pet = x.createLinearGradient(256, uy, 512, uy); pet.addColorStop(0, '#dde8ee'); pet.addColorStop(0.5, '#f6fbff'); pet.addColorStop(1, '#d0dde4');
  x.fillStyle = pet; x.fillRect(256, uy, 256, 256);
  // brown beer glass
  const br = x.createLinearGradient(512, uy, 768, uy); br.addColorStop(0, '#2a1204'); br.addColorStop(0.45, '#6a3410'); br.addColorStop(1, '#2a1204');
  x.fillStyle = br; x.fillRect(512, uy, 256, 256);
  // caps: red / blue / green / white / gold crown (4 × 64 wide strips)
  ['#c8141a', '#1a4ab0', '#1a8a3a', '#f2f2ee'].forEach((c, k) => { x.fillStyle = c; x.fillRect(768 + k * 64, uy, 64, 256); });
  const gold = x.createLinearGradient(1024, uy, 1280, uy); gold.addColorStop(0, '#8a6a20'); gold.addColorStop(0.5, '#f2d27a'); gold.addColorStop(1, '#8a6a20');
  x.fillStyle = gold; x.fillRect(1024, uy, 256, 256);
  // energy glass (amber, clear-ish)
  const am = x.createLinearGradient(1280, uy, 1536, uy); am.addColorStop(0, '#5a2a08'); am.addColorStop(0.5, '#b0661a'); am.addColorStop(1, '#5a2a08');
  x.fillStyle = am; x.fillRect(1280, uy, 256, 256);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** cold-drink condensation: tiny droplets in a tiling normal map */
function buildNormal() {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d')!;
  x.fillStyle = 'rgb(128,128,255)'; x.fillRect(0, 0, S, S);
  const r = rng(99);
  for (let i = 0; i < 520; i++) {
    const px = r() * S, py = r() * S, rad = 0.8 + r() * 2.6;
    const g = x.createRadialGradient(px - rad * 0.3, py - rad * 0.3, 0, px, py, rad);
    g.addColorStop(0, 'rgb(96,96,255)'); g.addColorStop(0.6, 'rgb(150,150,240)'); g.addColorStop(1, 'rgb(128,128,255)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function drinksMaterial(): THREE.MeshPhysicalMaterial {
  if (mat) return mat;
  atlas = buildAtlas();
  normal = buildNormal();
  mat = new THREE.MeshPhysicalMaterial({
    map: atlas, roughness: 0.28, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.25,
    normalMap: normal, normalScale: new THREE.Vector2(0.25, 0.25),
  });
  return mat;
}

// UV helpers: atlas pixel rect → uv
const U = (px: number) => px / AW;
const Vv = (py: number) => 1 - py / AH;   // canvas y down → v up (flipY)
function cellRect(i: number) { const ox = (i % 8) * LW, oy = Math.floor(i / 8) * LH; return { u0: U(ox + 1), u1: U(ox + LW - 1), v0: Vv(oy + LH - 1), v1: Vv(oy + 1) }; }
const UTIL = { alu: 0, pet: 1, brown: 2, cap: 3, gold: 4, amber: 5 } as const;
function utilUV(k: number, sub = 0.5) {
  // utility cells are 256 px wide (caps are 64 px strips inside cell 3)
  const ox = k * 256 + (k === 3 ? sub * 192 + 8 : 64), uy = 512 + 128;
  return [U(ox), Vv(uy)] as [number, number];
}

/** lathe from a (radius, y, labelV|-1, util) profile: label rows wrap the brand cell, others take a utility texel */
function latheUV(profile: [number, number, number, number][], seg: number, brand: number, capCol = 0) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const c = cellRect(brand);
  const rows = profile.length;
  for (let i = 0; i < uv.count; i++) {
    const s = Math.floor(i / rows), j = i % rows;
    const [, , lv, util] = profile[j];
    const around = (s / seg + 0.25) % 1;   // u = 0.5 (logo) faces +z
    if (lv >= 0) uv.setXY(i, c.u0 + around * (c.u1 - c.u0), c.v0 + lv * (c.v1 - c.v0));
    else if (util === UTIL.alu) {
      // top / bottom: polar mapping onto the ring-pull disc
      const a = (s / seg) * Math.PI * 2, rr = Math.min(1, profile[j][0] / 0.033) * 0.42;
      uv.setXY(i, U(128 + Math.cos(a) * rr * 256), Vv(512 + 128 + Math.sin(a) * rr * 256));
    } else { const [u, v] = utilUV(util, capCol); uv.setXY(i, u, v); }
  }
  g.computeVertexNormals();
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** a drink of `kind` with label variant `v` (wraps around BRANDS of that kind), origin bottom centre */
export function drinkGeo(kind: DrinkKind, v: number): THREE.BufferGeometry {
  const pool = BRANDS.map((b, i) => [b, i] as const).filter(([b]) => b.kind === kind);
  const [b, bi] = pool[((v % pool.length) + pool.length) % pool.length];
  const key = kind + bi;
  const hit = cache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  const A = UTIL.alu;
  if (kind === 'can') {
    const tall = b.vol === '180 ml' ? 0.095 : 0.122, R = b.vol === '180 ml' ? 0.026 : 0.033;
    g = latheUV([[0, 0, -1, A], [R * 0.7, 0.001, -1, A], [R * 0.95, 0.006, -1, A], [R, 0.012, 0, -1], [R, tall * 0.5, 0.5, -1], [R, tall - 0.012, 1, -1], [R * 0.86, tall - 0.004, -1, A], [R * 0.84, tall, -1, A], [R * 0.6, tall - 0.002, -1, A], [0, tall - 0.002, -1, A]], 24, bi);
  } else if (kind === 'pet') {
    const big = b.vol === '600 ml' ? 1.15 : 1;
    const R = 0.032 * big, H = 0.2 * big;
    const cap = b.c === '#f2a21a' ? 2 : b.c === '#2a8ad8' || b.c === '#1a5ad8' ? 1 : b.c === '#3a9a2a' ? 2 : 0;
    g = latheUV([[0, 0, -1, UTIL.pet], [R * 0.75, 0.002, -1, UTIL.pet], [R, 0.012, -1, UTIL.pet], [R, H * 0.22, 0, -1], [R, H * 0.62, 1, -1], [R * 0.96, H * 0.7, -1, UTIL.pet], [R * 0.55, H * 0.86, -1, UTIL.pet], [R * 0.4, H * 0.9, -1, UTIL.pet], [R * 0.4, H * 0.93, -1, UTIL.cap], [R * 0.42, H * 0.94, -1, UTIL.cap], [R * 0.42, H, -1, UTIL.cap], [0, H, -1, UTIL.cap]], 20, bi, cap);
  } else if (kind === 'beer') {
    const R = 0.036, H = 0.29;
    g = latheUV([[0, 0, -1, UTIL.brown], [R, 0.004, -1, UTIL.brown], [R, H * 0.12, 0, -1], [R, H * 0.48, 1, -1], [R, H * 0.58, -1, UTIL.brown], [R * 0.45, H * 0.8, -1, UTIL.brown], [R * 0.36, H * 0.96, -1, UTIL.brown], [R * 0.4, H * 0.97, -1, UTIL.gold], [R * 0.4, H, -1, UTIL.gold], [0, H, -1, UTIL.gold]], 18, bi);
  } else {
    const R = 0.026, H = 0.125;
    g = latheUV([[0, 0, -1, UTIL.amber], [R, 0.004, -1, UTIL.amber], [R, H * 0.12, 0, -1], [R, H * 0.62, 1, -1], [R * 0.95, H * 0.7, -1, UTIL.amber], [R * 0.55, H * 0.85, -1, UTIL.amber], [R * 0.55, H * 0.88, -1, UTIL.gold], [R * 0.56, H, -1, UTIL.gold], [0, H, -1, UTIL.gold]], 16, bi);
  }
  cache.set(key, g);
  return g;
}

/** a tidy shelf run: n facings × deep rows, labels toward +z, grouped by brand (blocks of `block`), origin at the run's left-front */
export function drinkRow(kind: DrinkKind, n: number, deep: number, pitch: number, depthPitch: number, first: number, block = 4, gapEvery = 0): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < deep; k++) {
    if (gapEvery && k === 0 && (i * 7 + first) % gapEvery === 0) continue;   // a bought-out front facing
    const g = drinkGeo(kind, first + Math.floor(i / block)).clone();
    g.rotateY((Math.sin(i * 12.9 + k * 3.1) * 0.12));
    g.translate(i * pitch + pitch / 2, 0, -k * depthPitch);
    gs.push(g);
  }
  return mergeGeometries(gs, false)!;
}
