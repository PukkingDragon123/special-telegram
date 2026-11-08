import * as THREE from 'three';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Retail package art — a procedurally painted atlas of FICTIONAL Thai convenience-store products
 * (snack bags, cup noodles, cartons, sachets), so shelves are stocked with crisp, distinct 3D packs
 * instead of slices of shelf photos. One 2048×1024 canvas, 16 columns × 4 rows:
 *   row 0, 1 : pillow snack bags (128×256 px faces)
 *   row 2    : cup noodles / tubs (band artwork wrapped around the cup)
 *   row 3    : cartons / boxes (tea, milk, biscuits, tissues)
 * cell(kind, i) → [u0, u1, v0, v1] for packRow({ cellUV }).
 * ========================================================================================== */

const COLS = 16, ROWS = 4, CW = 128, CH = 256;
let tex: THREE.CanvasTexture | null = null;
let matC: THREE.MeshStandardMaterial | null = null;

const SNACK_NAMES = ['กรอบมาก', 'ปูทอง', 'มันเจ๋ง', 'ข้าวโพดหวาน', 'สาหร่ายเด็ด', 'ถั่วซ่า', 'หมึกย่าง', 'เผ็ดจี๊ด', 'ขาไก่', 'ชีสบอล', 'ปลาเส้น', 'กุ้งกรอบ', 'มันฝรั่งแท่ง', 'ข้าวเกรียบ', 'ป๊อปคอร์น', 'ทาโร่'];
const SNACK_EN = ['CRUNCHY', 'GOLD CRAB', 'POTATO', 'SWEET CORN', 'SEAWEED', 'PEANUT', 'SQUID', 'SPICY!', 'CHICKEN', 'CHEESE', 'FISH SNACK', 'SHRIMP', 'STICKS', 'CRACKER', 'POPCORN', 'TARO'];
const BAG_COL = ['#e8241c', '#f2b81a', '#1f62c8', '#1d9a48', '#7a2fb0', '#f06a1a', '#0e9fb0', '#d81e6a', '#3a3a3c', '#f5d21a', '#2a7a3a', '#c8461a', '#1a3a8a', '#e8901a', '#b01a2a', '#5a2a8a'];
const CUP_NAMES = ['ต้มยำกุ้ง', 'หมูสับ', 'เย็นตาโฟ', 'ไก่พะโล้', 'ผัดขี้เมา', 'ต้มโคล้ง', 'น้ำใส', 'เป็ดพะโล้'];
const BOX_NAMES = ['ชาเขียว', 'นมจืด', 'บิสกิต', 'ทิชชู่', 'น้ำผลไม้', 'นมเปรี้ยว', 'ขนมปัง', 'กาแฟ 3in1'];

function hsl(c: string, k: number) {
  // lighten (k>0) / darken (k<0) a #rrggbb colour
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function fitText(x: CanvasRenderingContext2D, t: string, maxW: number, px: number, weight = 900, font: string = F.heavy) {
  let s = px;
  do { x.font = `${weight} ${s}px ${font}`; s -= 2; } while (s > 10 && x.measureText(t).width > maxW);
}

function rnd(s: number) { const v = Math.sin(s * 91.37 + 17.1) * 43758.5453; return v - Math.floor(v); }

function bag(x: CanvasRenderingContext2D, ox: number, oy: number, i: number) {
  const c = BAG_COL[i % BAG_COL.length];
  const g = x.createLinearGradient(ox, oy, ox + CW, oy + CH);
  g.addColorStop(0, hsl(c, 0.18)); g.addColorStop(0.55, c); g.addColorStop(1, hsl(c, -0.35));
  x.fillStyle = g; x.fillRect(ox, oy, CW, CH);
  // crimp seals
  x.fillStyle = hsl(c, -0.45);
  for (let k = 0; k < CW; k += 6) { x.fillRect(ox + k, oy, 3, 14); x.fillRect(ox + k, oy + CH - 14, 3, 14); }
  // product: a pile of chips / balls / sticks in a bowl-ish cluster
  const cx = ox + CW / 2, cy = oy + CH * 0.62;
  const chip = ['#f3c64a', '#e8a33a', '#d9822a', '#f7dc8a'][i % 4];
  for (let k = 0; k < 14; k++) {
    const a = rnd(i * 13 + k) * Math.PI * 2, r = rnd(i * 7 + k * 3) * 34;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.55;
    const gr = x.createRadialGradient(px - 5, py - 5, 2, px, py, 18);
    gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.5, chip); gr.addColorStop(1, hsl(chip.length === 7 ? chip : '#e8a33a', -0.4));
    x.fillStyle = gr; x.beginPath(); x.ellipse(px, py, 17, 11, a, 0, Math.PI * 2); x.fill();
  }
  // brand band
  x.fillStyle = 'rgba(255,255,255,0.92)';
  x.beginPath(); x.roundRect(ox + 8, oy + 34, CW - 16, 64, 12); x.fill();
  x.fillStyle = c; x.textAlign = 'center'; x.textBaseline = 'middle';
  fitText(x, SNACK_NAMES[i % SNACK_NAMES.length], CW - 26, 34);
  x.fillText(SNACK_NAMES[i % SNACK_NAMES.length], cx, oy + 58);
  x.fillStyle = '#1a1a1a'; fitText(x, SNACK_EN[i % SNACK_EN.length], CW - 30, 14, 800, F.ui);
  x.fillText(SNACK_EN[i % SNACK_EN.length], cx, oy + 84);
  // starburst flash
  if (i % 3 === 0) {
    x.save(); x.translate(ox + CW - 28, oy + 118); x.fillStyle = '#ffe23a';
    x.beginPath(); for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2, r = k % 2 ? 13 : 21; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.fill();
    x.fillStyle = '#d0141a'; x.font = `900 11px ${F.heavy}`; x.fillText(i % 2 ? 'ใหม่!' : 'NEW', 0, 1); x.restore();
  }
  // weight / price strip
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(ox, oy + CH - 40, CW, 22);
  x.fillStyle = '#fff'; x.font = `700 12px ${F.ui}`; x.fillText(`${[20, 30, 48, 62, 75][i % 5]} g  •  ${[5, 10, 20][i % 3]} ฿`, cx, oy + CH - 29);
  // gloss highlight
  const hl = x.createLinearGradient(ox, oy, ox + CW, oy);
  hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.28, 'rgba(255,255,255,0.22)'); hl.addColorStop(0.36, 'rgba(255,255,255,0)');
  x.fillStyle = hl; x.fillRect(ox, oy, CW, CH);
}

function cup(x: CanvasRenderingContext2D, ox: number, oy: number, i: number) {
  const c = ['#d8231a', '#f2a21a', '#1f8a3a', '#1f5ac8', '#e8641a', '#8a1f6a', '#2a2a2a', '#c8a21a'][i % 8];
  x.fillStyle = '#f7f3ea'; x.fillRect(ox, oy, CW, CH);
  x.fillStyle = c; x.fillRect(ox, oy + 40, CW, CH * 0.55);
  x.fillStyle = hsl(c, -0.3); x.fillRect(ox, oy + 40 + CH * 0.55 - 10, CW, 10);
  // bowl of noodles illustration
  const cx = ox + CW / 2, cy = oy + 168;
  x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, cy, 44, 18, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f2d27a'; for (let k = 0; k < 9; k++) { x.beginPath(); x.ellipse(cx - 30 + k * 7.5, cy - 4 + Math.sin(k) * 3, 9, 5, k, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#e04a2a'; x.beginPath(); x.arc(cx + 18, cy - 6, 7, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#3a8a2a'; x.beginPath(); x.ellipse(cx - 14, cy - 8, 8, 4, 0.6, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  fitText(x, 'มาม่าซ่า', CW - 20, 24); x.fillText('มาม่าซ่า', cx, oy + 70);
  x.fillStyle = '#fff6c8'; fitText(x, CUP_NAMES[i % CUP_NAMES.length], CW - 18, 20, 800, F.ui); x.fillText(CUP_NAMES[i % CUP_NAMES.length], cx, oy + 100);
  x.fillStyle = c; x.font = `800 12px ${F.ui}`; x.fillText('CUP 60g', cx, oy + 24);
}

function carton(x: CanvasRenderingContext2D, ox: number, oy: number, i: number) {
  const c = ['#2a8a3a', '#2a62c8', '#c8461a', '#f2f0ea', '#e8a21a', '#d8231a', '#7a4a2a', '#3a2a1a'][i % 8];
  x.fillStyle = c; x.fillRect(ox, oy, CW, CH);
  x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(ox, oy + CH * 0.18, CW, CH * 0.3);
  x.fillStyle = c === '#f2f0ea' ? '#2a62c8' : c; x.textAlign = 'center'; x.textBaseline = 'middle';
  fitText(x, BOX_NAMES[i % BOX_NAMES.length], CW - 18, 28); x.fillText(BOX_NAMES[i % BOX_NAMES.length], ox + CW / 2, oy + CH * 0.33);
  // illustration: glass / leaf / biscuit
  const cx = ox + CW / 2, cy = oy + CH * 0.68;
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.roundRect(cx - 26, cy - 36, 52, 70, 8); x.fill();
  x.fillStyle = ['#7ac85a', '#ffffff', '#d9a05a', '#e8e8e8', '#f2a21a', '#f7e8c8', '#c89a5a', '#6a3a1a'][i % 8];
  x.fillRect(cx - 22, cy - 6, 44, 36);
  x.fillStyle = '#fff'; x.font = `700 11px ${F.ui}`; x.fillText(['250 ml', '1 L', '6 ชิ้น', '200 แผ่น'][i % 4], cx, oy + CH - 18);
}

/** the shared package atlas texture (built once) */
export function packTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const cv = document.createElement('canvas');
  cv.width = COLS * CW; cv.height = ROWS * CH;
  const x = cv.getContext('2d')!;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ox = c * CW, oy = r * CH, i = r * COLS + c;
    if (r < 2) bag(x, ox, oy, i);
    else if (r === 2) cup(x, ox, oy, c);
    else carton(x, ox, oy, c);
  }
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

export function packMaterial(): THREE.MeshStandardMaterial {
  return (matC ??= new THREE.MeshStandardMaterial({ map: packTexture(), roughness: 0.38, metalness: 0.05 }));
}

/** uv cell [u0,u1,v0,v1] of a package face; kind picks the atlas row, i the variant */
export function packCell(kind: 'bag' | 'cup' | 'box', i: number): [number, number, number, number] {
  const row = kind === 'bag' ? (i >> 4) & 1 : kind === 'cup' ? 2 : 3;
  const col = kind === 'bag' ? i % COLS : i % 8 + (Math.floor(i / 8) % 2) * 8;
  const u0 = col / COLS, u1 = (col + 1) / COLS;
  // canvas y down → uv v up (flipY)
  const v1 = 1 - row / ROWS, v0 = 1 - (row + 1) / ROWS;
  const e = 0.004;
  return [u0 + e, u1 - e, v0 + e, v1 - e];
}
