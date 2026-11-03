import * as THREE from 'three';
import { F } from '../../core/fonts';
import type { Brand } from './brand';
import { fmtSatang } from './brand';

/* ============================================================================================
 * Canvas textures for the ATM: lit header sign, key-label atlas, stickers, the debit card,
 * the thermal receipt and a bottom-dirt gradient. All Thai text uses looped faces (F.*).
 * ========================================================================================== */

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d')! };
}

export function toTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function memo(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

/** deterministic noise for wear / specks */
function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function rr(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  x.beginPath();
  x.moveTo(X + R, Y);
  x.arcTo(X + W, Y, X + W, Y + H, R);
  x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R);
  x.arcTo(X, Y, X + W, Y, R);
  x.closePath();
}

/** wear: scratches + faded specks over an existing drawing (printed vinyl in the sun) */
function weather(x: CanvasRenderingContext2D, w: number, h: number, seed: number, k = 1) {
  const r = rnd(seed);
  x.save();
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70 * k; i++) {
    x.globalAlpha = 0.15 + r() * 0.5;
    x.lineWidth = 0.6 + r() * 1.6;
    x.beginPath();
    const px = r() * w, py = r() * h, l = 4 + r() * 26, a = (r() - 0.5) * 0.8;
    x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  for (let i = 0; i < 120 * k; i++) { x.globalAlpha = 0.2 + r() * 0.5; x.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5); }
  // chipped corner
  x.globalAlpha = 1;
  x.beginPath(); x.moveTo(w, h); x.lineTo(w - 8 - r() * 14, h); x.lineTo(w, h - 6 - r() * 12); x.fill();
  x.restore();
  // sun fade + grime film
  x.save();
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,250,235,0.10)');
  g.addColorStop(1, 'rgba(60,45,25,0.16)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.restore();
}

// ------------------------------------------------------------------ logo

/** Original logo: a gold coin ring with a three-petal lotus and a square "pod duang" hole. */
export function drawLogo(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, b: Brand, light = false) {
  x.save();
  const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, b.accent2); g.addColorStop(0.65, b.accent); g.addColorStop(1, '#8a6410');
  x.fillStyle = g;
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.fillStyle = light ? '#ffffff' : b.bg0;
  x.beginPath(); x.arc(cx, cy, r * 0.8, 0, Math.PI * 2); x.fill();
  x.fillStyle = g;
  for (const a of [-0.62, 0, 0.62]) {
    x.save();
    x.translate(cx, cy + r * 0.32);
    x.rotate(a);
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(r * 0.3, -r * 0.25, r * 0.22, -r * 0.62, 0, -r * 0.82);
    x.bezierCurveTo(-r * 0.22, -r * 0.62, -r * 0.3, -r * 0.25, 0, 0);
    x.fill();
    x.restore();
  }
  x.fillStyle = light ? '#ffffff' : b.bg0;
  x.fillRect(cx - r * 0.1, cy - r * 0.08, r * 0.2, r * 0.2);
  x.restore();
}

// ------------------------------------------------------------------ header sign (lightbox)

export function signTexture(b: Brand) {
  return memo('sign:' + b.id, () => {
    const W = 1024, H = 320;
    const { c, x } = canvas(W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, b.bg1); g.addColorStop(0.55, b.bg0); g.addColorStop(1, b.head);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // gold band
    x.fillStyle = b.accent; x.fillRect(0, H - 54, W, 54);
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, H - 54, W, 4);
    drawLogo(x, 150, 128, 92, b);
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#ffffff';
    x.font = `800 104px ${F.heavy}`;
    x.fillText(b.th, 270, 150);
    x.fillStyle = b.accent2;
    x.font = `700 46px ${F.heavy}`;
    x.fillText(b.en.split('').join(String.fromCharCode(8202)), 274, 210);
    x.fillStyle = b.ink;
    x.font = `800 38px ${F.heavy}`;
    x.fillText('ATM · บริการ 24 ชั่วโมง · ฝาก ถอน โอน', 40, H - 14);
    // lightbox hot-spots (fluorescent tubes behind the acrylic) + dead bugs at the bottom edge
    const lg = x.createRadialGradient(W * 0.3, H * 0.4, 20, W * 0.3, H * 0.4, W * 0.55);
    lg.addColorStop(0, 'rgba(255,255,255,0.18)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg; x.fillRect(0, 0, W, H);
    const r = rnd(77);
    x.fillStyle = 'rgba(10,8,6,0.55)';
    for (let i = 0; i < 9; i++) { const bx = 60 + r() * (W - 120), by = H - 60 - r() * 8; x.beginPath(); x.ellipse(bx, by, 3 + r() * 4, 1.5 + r() * 2, r() * 3, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(40,30,10,0.18)';
    x.fillRect(0, H - 70, W, 16);
    return toTex(c);
  });
}

/** small square logo panel for the header sides */
export function sideLogoTexture(b: Brand) {
  return memo('side:' + b.id, () => {
    const { c, x } = canvas(512, 256);
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, b.bg1); g.addColorStop(1, b.head);
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    drawLogo(x, 110, 118, 72, b);
    x.fillStyle = '#ffffff';
    x.font = `800 74px ${F.heavy}`;
    x.fillText('ATM', 210, 138);
    x.fillStyle = b.accent2;
    x.font = `700 34px ${F.heavy}`;
    x.fillText('24 ชม.', 214, 186);
    return toTex(c);
  });
}

// ------------------------------------------------------------------ key labels

export const KEY_ATLAS = { cols: 4, rows: 5 };

/** cell index for a key id */
export function keyCell(id: string): number {
  const order = ['1', '2', '3', 'CANCEL', '4', '5', '6', 'CLEAR', '7', '8', '9', 'ENTER', 'B1', '0', 'B2', 'B3', 'FDK_L', 'FDK_R', 'BLANK', 'BLANK2'];
  const i = order.indexOf(id);
  return i < 0 ? 18 : i;
}

export function keyAtlas() {
  return memo('keys', () => {
    const C = 128, { cols, rows } = KEY_ATLAS;
    const { c, x } = canvas(C * cols, C * rows);
    const order = ['1', '2', '3', 'CANCEL', '4', '5', '6', 'CLEAR', '7', '8', '9', 'ENTER', 'B1', '0', 'B2', 'B3', 'FDK_L', 'FDK_R', 'BLANK', 'BLANK2'];
    order.forEach((id, i) => {
      const X = (i % cols) * C, Y = Math.floor(i / cols) * C;
      x.save();
      x.translate(X, Y);
      // label region is the middle 128 x 96 (key top is 4:3)
      if (/^\d$/.test(id)) {
        // engraved digit: dark fill + light lower-right bevel
        const worn = id === '0' || id === '5' || id === '1';
        x.font = `700 70px ${F.heavy}`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillStyle = 'rgba(255,255,255,0.35)';
        x.fillText(id, 66, 68);
        x.fillStyle = worn ? 'rgba(20,20,22,0.55)' : 'rgba(14,14,16,0.92)';
        x.fillText(id, 64, 65);
        if (id === '5') { x.fillStyle = 'rgba(25,25,25,0.7)'; x.beginPath(); x.arc(64, 101, 4, 0, Math.PI * 2); x.fill(); }
      } else if (id === 'CANCEL' || id === 'CLEAR' || id === 'ENTER') {
        const col = id === 'CANCEL' ? '#c8241e' : id === 'CLEAR' ? '#e8b818' : '#1c9a3a';
        const txt = id === 'CANCEL' ? '#ffffff' : id === 'CLEAR' ? '#1a1406' : '#ffffff';
        const g = x.createLinearGradient(0, 16, 0, 112);
        g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.25));
        x.fillStyle = g;
        rr(x, 2, 16, 124, 96, 10); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.18)'; rr(x, 6, 19, 116, 22, 8); x.fill();
        x.fillStyle = txt;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = `700 30px ${F.ui}`;
        x.fillText(id === 'CANCEL' ? 'ยกเลิก' : id === 'CLEAR' ? 'แก้ไข' : 'ยืนยัน', 64, 52);
        x.font = `700 21px ${F.heavy}`;
        x.fillText(id, 64, 86);
        if (id === 'CANCEL') { x.fillStyle = 'rgba(255,255,255,0.9)'; x.font = `700 18px ${F.heavy}`; x.fillText('✕', 112, 30); }
      } else if (id === 'FDK_L' || id === 'FDK_R') {
        // arrow pointing at the screen
        x.fillStyle = 'rgba(16,16,18,0.85)';
        x.beginPath();
        if (id === 'FDK_L') { x.moveTo(42, 38); x.lineTo(92, 64); x.lineTo(42, 90); }
        else { x.moveTo(86, 38); x.lineTo(36, 64); x.lineTo(86, 90); }
        x.closePath(); x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 2; x.stroke();
      }
      x.restore();
    });
    const t = toTex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new THREE.Color(1, 1, 1), k);
  return '#' + c.getHexString();
}

// ------------------------------------------------------------------ stickers

export type StickerId = '24h' | 'skimmer' | 'fee' | 'cctv' | 'loan' | 'cash' | 'card' | 'receipt' | 'service' | 'maker' | 'speaker';

export function sticker(id: StickerId, b: Brand): { tex: THREE.Texture; aspect: number } {
  const key = 'st:' + id + ':' + b.id;
  const asp: Record<StickerId, number> = { '24h': 1, skimmer: 0.72, fee: 0.72, cctv: 1.6, loan: 0.7, cash: 3.2, card: 1.4, receipt: 3.4, service: 2.6, maker: 3, speaker: 1 };
  const tex = memo(key, () => {
    const W = 512, H = Math.round(512 / asp[id]);
    const { c, x } = canvas(W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const seed = id.length * 977 + b.id.length * 31;
    switch (id) {
      case '24h': {
        x.fillStyle = b.accent; x.beginPath(); x.arc(256, 256, 250, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(256, 256, 214, 0, Math.PI * 2); x.fill();
        x.fillStyle = b.bg0;
        x.font = `800 200px ${F.heavy}`; x.fillText('24', 256, 222);
        x.font = `800 88px ${F.heavy}`; x.fillText('ชั่วโมง', 256, 352);
        x.font = `700 40px ${F.heavy}`; x.fillStyle = b.accent; x.fillText('HOURS', 256, 428);
        weather(x, W, H, seed, 0.6);
        break;
      }
      case 'skimmer': {
        x.fillStyle = '#ffd21a'; rr(x, 4, 4, W - 8, H - 8, 26); x.fill();
        x.strokeStyle = '#111'; x.lineWidth = 12; rr(x, 18, 18, W - 36, H - 36, 18); x.stroke();
        // warning triangle
        x.fillStyle = '#111';
        x.beginPath(); x.moveTo(256, 60); x.lineTo(346, 214); x.lineTo(166, 214); x.closePath(); x.fill();
        x.fillStyle = '#ffd21a'; x.font = `800 110px ${F.heavy}`; x.fillText('!', 256, 162);
        x.fillStyle = '#111';
        x.font = `800 56px ${F.ui}`; x.fillText('โปรดระวัง!', 256, 278);
        x.font = `600 34px ${F.ui}`;
        x.fillText('ตรวจสอบช่องสอดบัตร', 256, 340);
        x.fillText('ว่ามีอุปกรณ์แปลกปลอม', 256, 384);
        x.fillText('ติดอยู่หรือไม่ / ปิดบังขณะกดรหัส', 256, 428);
        x.font = `700 26px ${F.heavy}`;
        x.fillText('CHECK FOR SKIMMING DEVICES', 256, 486);
        x.fillText('COVER YOUR PIN', 256, 520);
        x.fillText('ก่อนใช้บริการทุกครั้ง', 256, 572);
        weather(x, W, H, seed);
        break;
      }
      case 'fee': {
        x.fillStyle = '#ffffff'; rr(x, 4, 4, W - 8, H - 8, 20); x.fill();
        x.fillStyle = b.bg0; rr(x, 4, 4, W - 8, 150, 20); x.fill(); x.fillRect(4, 100, W - 8, 54);
        x.fillStyle = '#fff'; x.font = `800 58px ${F.ui}`; x.fillText('อัตราค่าธรรมเนียม', 256, 64);
        x.font = `700 30px ${F.heavy}`; x.fillStyle = b.accent2; x.fillText('SERVICE FEE', 256, 124);
        x.fillStyle = '#1a1a1a';
        x.font = `600 34px ${F.ui}`;
        x.fillText(`บัตร${b.th}`, 256, 212);
        x.font = `800 60px ${F.heavy}`; x.fillStyle = '#1c7a32';
        x.fillText('ไม่มีค่าธรรมเนียม', 256, 274);
        x.fillStyle = '#1a1a1a'; x.font = `600 34px ${F.ui}`;
        x.fillText('บัตรต่างธนาคาร (ถอนเงิน)', 256, 360);
        x.font = `800 88px ${F.heavy}`; x.fillStyle = '#c8241e';
        x.fillText(`${b.fee || 15} บาท`, 256, 438);
        x.fillStyle = '#555'; x.font = `500 26px ${F.ui}`;
        x.fillText('ต่อรายการ / per transaction', 256, 500);
        x.fillText('สอบถามยอด · โอนเงินพร้อมเพย์ ฟรี', 256, 548);
        x.fillText('Balance · PromptPay transfer: free', 256, 586);
        weather(x, W, H, seed);
        break;
      }
      case 'cctv': {
        x.fillStyle = '#f4f4f0'; rr(x, 4, 4, W - 8, H - 8, 16); x.fill();
        x.fillStyle = '#c8241e'; rr(x, 4, 4, 150, H - 8, 16); x.fill();
        x.fillStyle = '#fff';
        // camera glyph
        x.fillRect(30, 110, 90, 50); x.beginPath(); x.moveTo(120, 120); x.lineTo(140, 108); x.lineTo(140, 162); x.lineTo(120, 150); x.fill();
        x.fillRect(66, 160, 14, 50);
        x.fillStyle = '#1a1a1a'; x.textAlign = 'left';
        x.font = `800 46px ${F.ui}`; x.fillText('บริเวณนี้มี', 176, 82);
        x.fillText('กล้องวงจรปิด', 176, 140);
        x.font = `700 28px ${F.heavy}`; x.fillStyle = '#c8241e'; x.fillText('CCTV 24 HRS', 178, 206);
        x.fillStyle = '#555'; x.font = `500 24px ${F.ui}`; x.fillText('บันทึกภาพตลอด 24 ชั่วโมง', 178, 252);
        weather(x, W, H, seed);
        break;
      }
      case 'loan': {
        // illegal loan sticker, half torn off
        x.fillStyle = '#fff36a'; x.fillRect(0, 0, W, H);
        x.fillStyle = '#d4141a'; x.font = `800 110px ${F.heavy}`; x.fillText('เงินด่วน', 256, 120);
        x.fillStyle = '#111'; x.font = `800 58px ${F.ui}`; x.fillText('ไม่เช็คบูโร', 256, 230);
        x.font = `700 44px ${F.ui}`; x.fillText('อนุมัติไว 5 นาที', 256, 306);
        x.fillText('ดอกถูก ผ่อนรายวัน', 256, 366);
        x.fillStyle = '#d4141a'; x.font = `800 64px ${F.heavy}`; x.fillText('โทร 08-', 200, 470);
        // torn: tear the right/bottom part away
        x.save(); x.globalCompositeOperation = 'destination-out';
        const r = rnd(5);
        x.beginPath(); x.moveTo(W, 360); let px = W; let py = 360;
        while (px > 150) { px -= 20 + r() * 30; py += (r() - 0.35) * 40; x.lineTo(px, py); }
        x.lineTo(150, H); x.lineTo(W, H); x.closePath(); x.fill();
        x.restore();
        // glue residue
        x.fillStyle = 'rgba(240,235,210,0.9)';
        for (let i = 0; i < 20; i++) x.fillRect(200 + r() * 300, 400 + r() * 300, 6 + r() * 30, 3 + r() * 8);
        weather(x, W, H, seed, 1.5);
        break;
      }
      case 'cash': {
        x.fillStyle = '#111316'; rr(x, 0, 0, W, H, 12); x.fill();
        x.fillStyle = '#e8e8e8'; x.textAlign = 'left';
        // stack-of-notes pictogram
        for (let i = 0; i < 3; i++) { x.fillStyle = i === 2 ? '#e8e8e8' : '#8a8a8a'; rr(x, 20 + i * 6, 40 - i * 8, 90, 50, 6); x.fill(); }
        x.fillStyle = '#111316'; x.beginPath(); x.arc(77, 57, 12, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#e8e8e8';
        x.font = `700 46px ${F.ui}`; x.fillText('รับเงิน / ฝากเงิน', 140, 64);
        x.font = `700 26px ${F.heavy}`; x.fillStyle = '#9fd8a8'; x.fillText('CASH OUT · CASH IN', 142, 118);
        break;
      }
      case 'card': {
        x.fillStyle = '#111316'; rr(x, 0, 0, W, H, 14); x.fill();
        // card + arrow pictogram
        x.fillStyle = '#e8e8e8'; rr(x, 40, 70, 150, 100, 10); x.fill();
        x.fillStyle = '#d9a830'; rr(x, 62, 100, 34, 26, 4); x.fill();
        x.fillStyle = '#111316'; x.fillRect(40, 140, 150, 14);
        x.fillStyle = '#e8e8e8';
        x.beginPath(); x.moveTo(230, 100); x.lineTo(300, 100); x.lineTo(300, 80); x.lineTo(340, 120); x.lineTo(300, 160); x.lineTo(300, 140); x.lineTo(230, 140); x.fill();
        x.textAlign = 'left';
        x.font = `700 40px ${F.ui}`; x.fillText('สอดบัตร', 360, 112);
        x.font = `700 24px ${F.heavy}`; x.fillStyle = '#9fd8a8'; x.fillText('INSERT CARD', 360, 160);
        x.fillStyle = '#e8e8e8'; x.font = `500 22px ${F.ui}`; x.textAlign = 'center';
        x.fillText('ด้านชิปการ์ดขึ้น · chip side up', 256, 300);
        break;
      }
      case 'receipt': {
        x.fillStyle = '#111316'; rr(x, 0, 0, W, H, 10); x.fill();
        x.fillStyle = '#e8e8e8';
        x.fillRect(26, 30, 60, 90); x.fillStyle = '#111316'; for (let i = 0; i < 4; i++) x.fillRect(36, 46 + i * 18, 40, 5);
        x.fillStyle = '#e8e8e8'; x.textAlign = 'left';
        x.font = `700 42px ${F.ui}`; x.fillText('ใบบันทึกรายการ', 108, 64);
        x.font = `700 24px ${F.heavy}`; x.fillStyle = '#9fd8a8'; x.fillText('RECEIPT', 110, 112);
        break;
      }
      case 'service': {
        x.fillStyle = '#f4f2ea'; rr(x, 0, 0, W, H, 10); x.fill();
        drawLogo(x, 70, H / 2, 46, b, true);
        x.fillStyle = '#1a1a1a'; x.textAlign = 'left';
        x.font = `700 32px ${F.ui}`; x.fillText('เครื่องขัดข้อง / บัตรติดเครื่อง', 130, 52);
        x.font = `800 40px ${F.heavy}`; x.fillStyle = b.bg0; x.fillText('☎ 0-2XXX-XXXX', 130, 110);
        x.font = `500 22px ${F.ui}`; x.fillStyle = '#444'; x.fillText(`ศูนย์บริการลูกค้า ${b.th} 24 ชม.`, 130, 158);
        weather(x, W, H, seed, 0.8);
        break;
      }
      case 'maker': {
        const g = x.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#d8dadc'); g.addColorStop(1, '#9a9ea2');
        x.fillStyle = g; rr(x, 0, 0, W, H, 8); x.fill();
        x.fillStyle = '#2a2c2e'; x.textAlign = 'left';
        x.font = `800 58px ${F.heavy}`; x.fillText('MONIMAX', 24, 78);
        x.font = `600 24px ${F.heavy}`; x.fillText('CDM 8800T  ·  S/N 26-1107-0419', 26, 130);
        x.fillStyle = '#555'; for (const px of [10, W - 18]) { x.beginPath(); x.arc(px + 4, H / 2, 5, 0, Math.PI * 2); x.fill(); }
        break;
      }
      case 'speaker': {
        x.fillStyle = '#16181a'; rr(x, 0, 0, W, H, 40); x.fill();
        x.fillStyle = '#050506';
        for (let iy = 0; iy < 9; iy++) for (let ix = 0; ix < 9; ix++) {
          const px = 96 + ix * 40, py = 96 + iy * 40;
          if (Math.hypot(px - 256, py - 256) > 170) continue;
          x.beginPath(); x.arc(px, py, 9, 0, Math.PI * 2); x.fill();
        }
        // headphone glyph (audio guidance jack)
        x.strokeStyle = '#9a9a9a'; x.lineWidth = 9; x.beginPath(); x.arc(430, 452, 34, Math.PI, 0); x.stroke();
        x.fillStyle = '#9a9a9a'; x.fillRect(390, 448, 18, 30); x.fillRect(452, 448, 18, 30);
        break;
      }
    }
    return toTex(c);
  });
  return { tex, aspect: asp[id] };
}

// ------------------------------------------------------------------ dirt / grime

/** dark bottom-up grime (rain splash, mop water, dust) for the cabinet base; alpha texture */
export function dirtTexture() {
  return memo('dirt', () => {
    const W = 512, H = 256;
    const { c, x } = canvas(W, H);
    const g = x.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, 'rgba(38,28,18,0.85)'); g.addColorStop(0.35, 'rgba(48,36,22,0.42)'); g.addColorStop(1, 'rgba(48,36,22,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const r = rnd(11);
    for (let i = 0; i < 500; i++) {
      const px = r() * W, py = H - Math.pow(r(), 1.8) * H * 0.75, s = 1 + r() * 4;
      x.fillStyle = `rgba(${30 + r() * 30},${22 + r() * 20},${12 + r() * 10},${0.15 + r() * 0.45})`;
      x.beginPath(); x.ellipse(px, py, s, s * (0.6 + r()), 0, 0, Math.PI * 2); x.fill();
    }
    // drips
    for (let i = 0; i < 26; i++) {
      const px = r() * W, py = H * (0.2 + r() * 0.4), l = 10 + r() * 50;
      x.strokeStyle = `rgba(40,30,18,${0.12 + r() * 0.2})`; x.lineWidth = 1 + r() * 2;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py + l); x.stroke();
    }
    return toTex(c);
  });
}

/** fingerprint / palm smudges (roughness variation) for the screen glass + keypad, linear */
export function smudgeTexture() {
  return memo('smudge', () => {
    const W = 512, H = 512;
    const { c, x } = canvas(W, H);
    x.fillStyle = 'rgb(40,40,40)'; x.fillRect(0, 0, W, H);   // base roughness ~0.16
    const r = rnd(23);
    for (let i = 0; i < 60; i++) {
      const px = 60 + r() * (W - 120), py = 120 + r() * (H - 160), s = 10 + r() * 22;
      const g = x.createRadialGradient(px, py, 1, px, py, s);
      g.addColorStop(0, 'rgba(150,150,150,0.55)'); g.addColorStop(1, 'rgba(150,150,150,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, s, s * 1.25, r() * 3, 0, Math.PI * 2); x.fill();
      // ridges
      x.strokeStyle = 'rgba(120,120,120,0.25)'; x.lineWidth = 1;
      for (let k = 2; k < s; k += 3) { x.beginPath(); x.ellipse(px, py, k, k * 1.25, 0.3, 0, Math.PI * 2); x.stroke(); }
    }
    // wiped arc
    x.strokeStyle = 'rgba(90,90,90,0.35)'; x.lineWidth = 50;
    x.beginPath(); x.arc(W * 0.7, H * 1.1, W * 0.6, Math.PI * 1.1, Math.PI * 1.45); x.stroke();
    return toTex(c, false);
  });
}

// ------------------------------------------------------------------ debit card

export function cardTexture(b: Brand, name: string, acctNo: string) {
  return memo('card:' + b.id + ':' + name + ':' + acctNo, () => {
    const W = 512, H = 323;
    const { c, x } = canvas(W, H);
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, b.bg1); g.addColorStop(0.6, b.bg0); g.addColorStop(1, b.head);
    rr(x, 0, 0, W, H, 26); x.fillStyle = g; x.fill();
    x.save(); rr(x, 0, 0, W, H, 26); x.clip();
    // guilloche waves
    x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1.2;
    for (let i = 0; i < 24; i++) { x.beginPath(); for (let px = 0; px <= W; px += 8) x.lineTo(px, 140 + i * 9 + Math.sin(px / 40 + i * 0.6) * 18); x.stroke(); }
    x.fillStyle = b.accent; x.globalAlpha = 0.9; x.beginPath(); x.arc(W + 40, -30, 230, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    x.restore();
    drawLogo(x, 52, 50, 30, b);
    x.fillStyle = '#fff'; x.font = `800 30px ${F.heavy}`; x.textBaseline = 'middle'; x.fillText(b.th, 92, 44);
    x.font = `700 15px ${F.heavy}`; x.fillStyle = b.accent2; x.fillText(b.en + '  DEBIT', 94, 72);
    // chip
    const cg = x.createLinearGradient(50, 120, 120, 175);
    cg.addColorStop(0, '#f4dc8a'); cg.addColorStop(0.5, '#c9a23e'); cg.addColorStop(1, '#f0d070');
    x.fillStyle = cg; rr(x, 50, 118, 70, 54, 9); x.fill();
    x.strokeStyle = 'rgba(90,60,10,0.6)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(50, 145); x.lineTo(120, 145); x.moveTo(85, 118); x.lineTo(85, 172); x.moveTo(50, 132); x.lineTo(72, 132); x.moveTo(98, 158); x.lineTo(120, 158); x.stroke();
    // contactless
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 3;
    for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(138, 145, 8 + i * 7, -0.7, 0.7); x.stroke(); }
    // embossed number + name
    const emb = (t: string, px: number, py: number, sz: number) => {
      x.font = `700 ${sz}px ${F.heavy}`;
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillText(t, px + 1.5, py + 1.5);
      x.fillStyle = '#f2efe6'; x.fillText(t, px, py);
    };
    emb(acctNo, 50, 222, 34);
    emb(name.toUpperCase().slice(0, 22), 50, 278, 22);
    x.font = `600 12px ${F.heavy}`; x.fillStyle = 'rgba(255,255,255,0.75)';
    x.fillText('VALID THRU 11/74', 330, 252);
    return toTex(c);
  });
}

// ------------------------------------------------------------------ receipt

export interface ReceiptData {
  bank: string;          // brand id
  atm: string;           // terminal id
  date: string; time: string;
  type: string;          // Thai label
  typeEn: string;
  amount: number;        // satang (0 for balance)
  fee: number;           // satang
  bal: number;           // satang
  acct: string;          // masked
  ref: string;
  to?: string;           // transfer recipient name
  name: string;
  interest?: number;
}

export function receiptTexture(d: ReceiptData, b: Brand) {
  return memo('rcpt:' + JSON.stringify(d), () => {
    const W = 384, H = 640;
    const { c, x } = canvas(W, H);
    x.fillStyle = '#f3f0e8'; x.fillRect(0, 0, W, H);
    // thermal paper: faint grey bands + slight yellowing at the edges
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(200,190,160,0.18)'); g.addColorStop(0.08, 'rgba(0,0,0,0)'); g.addColorStop(0.92, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(200,190,160,0.18)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const ink = 'rgba(28,30,40,0.9)';
    x.fillStyle = ink;
    drawLogo(x, W / 2, 46, 26, b, true);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.font = `700 26px ${F.body}`; x.fillText(b.th, W / 2, 102);
    x.font = `600 15px monospace`; x.fillText(b.en, W / 2, 122);
    const line = (y: number) => { x.fillStyle = ink; for (let px = 16; px < W - 16; px += 8) x.fillRect(px, y, 4, 1.5); };
    line(136);
    let y = 164;
    const row = (l: string, r: string, big = false) => {
      x.textAlign = 'left'; x.font = `${big ? 700 : 500} ${big ? 22 : 17}px ${F.body}`; x.fillStyle = ink; x.fillText(l, 20, y);
      x.textAlign = 'right'; x.font = `${big ? 700 : 500} ${big ? 24 : 17}px monospace`; x.fillText(r, W - 20, y);
      y += big ? 34 : 26;
    };
    row('วันที่ DATE', d.date);
    row('เวลา TIME', d.time);
    row('เครื่อง ATM ID', d.atm);
    row('เลขที่ REF', d.ref);
    row('บัญชี ACCT', d.acct);
    line(y - 10); y += 16;
    x.textAlign = 'center'; x.font = `700 24px ${F.body}`; x.fillText(d.type, W / 2, y); y += 22;
    x.font = `600 15px monospace`; x.fillText(d.typeEn, W / 2, y); y += 34;
    if (d.to) row('ผู้รับ TO', d.to.slice(0, 18));
    if (d.amount) row('จำนวนเงิน', fmtSatang(d.amount), true);
    if (d.fee) row('ค่าธรรมเนียม FEE', fmtSatang(d.fee));
    if (d.interest) row('ดอกเบี้ยรับ INT', fmtSatang(d.interest));
    row('ยอดคงเหลือ BAL', fmtSatang(d.bal), true);
    line(y - 6); y += 20;
    x.textAlign = 'center'; x.font = `500 15px ${F.body}`;
    x.fillText('ขอบคุณที่ใช้บริการ', W / 2, y); y += 22;
    x.fillText('โปรดเก็บใบบันทึกรายการไว้เป็นหลักฐาน', W / 2, y); y += 22;
    x.font = `500 13px monospace`; x.fillText('THANK YOU · KEEP THIS SLIP', W / 2, y); y += 26;
    // barcode
    const r = rnd(d.ref.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    let bx = 60;
    while (bx < W - 60) { const bw = 1 + Math.floor(r() * 3); if (r() > 0.4) x.fillRect(bx, y, bw, 36); bx += bw + 1; }
    // faded thermal print: random lighter streak
    x.fillStyle = 'rgba(243,240,232,0.35)'; x.fillRect(0, 300 + r() * 120, W, 6 + r() * 10);
    // torn perforated bottom
    x.save(); x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.moveTo(0, H); for (let px = 0; px <= W; px += 12) x.lineTo(px, H - 4 - (px / 12 % 2) * 5); x.lineTo(W, H); x.fill();
    x.restore();
    return toTex(c);
  });
}
