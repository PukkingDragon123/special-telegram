import * as THREE from 'three';
import { F } from '../../core/fonts';
import type { Brand } from './brand';
import { canvas, drawLogo, rr } from './tex';
import { FDK_ROWS } from './model';

/* ============================================================================================
 * The ATM LCD: a 1024×768 canvas laid out like a Thai bank ATM — brand header with logo + clock,
 * centred title (Thai big / English small, or the reverse), option "pills" against the left and
 * right edges lined up with the 4+4 function keys, footer hint. Plus PIN boxes, amount entry,
 * balance / confirmation tables, spinner, countdown, attract animation and a "busy" screen.
 * Redraws only when the spec changes or something on it animates (≤ 20 fps).
 * ========================================================================================== */

export type L2 = [string, string];           // [thai, english]
export interface Opt { t: L2; act?: () => void; dim?: boolean; tone?: 'ok' | 'err' }
export interface ScreenSpec {
  kind: 'attract' | 'busy' | 'menu' | 'pin' | 'amount' | 'spinner' | 'message' | 'table' | 'cash' | 'retained' | 'off';
  title?: L2;
  sub?: L2;
  left?: (Opt | null)[];
  right?: (Opt | null)[];
  /** pin: digits typed */
  pin?: number;
  /** amount: typed string */
  amount?: string;
  unit?: string;
  /** table rows [label th, label en, value] */
  rows?: [string, string, string][];
  tone?: 'ok' | 'err' | 'info' | 'warn';
  countdown?: number;
  footer?: L2;
  /** icon for message screens */
  icon?: 'card' | 'cash' | 'receipt' | 'ok' | 'err' | 'clock' | 'lock' | 'deposit';
  /** animate (spinner / attract / blinking) */
  anim?: boolean;
}

export interface HitRect { x: number; y: number; w: number; h: number; side: 'L' | 'R'; i: number }

const W = 1024, H = 768;

export class AtmScreen {
  readonly tex: THREE.CanvasTexture;
  private c: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private key = '';
  private lastT = -1;
  lang: 'th' | 'en' = 'th';
  rects: HitRect[] = [];
  hover: { side: 'L' | 'R'; i: number } | null = null;
  clock = { date: '', time: '' };

  constructor(private b: Brand) {
    const { c, x } = canvas(W, H);
    this.c = c; this.x = x;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }

  /** draw if needed; t = seconds */
  draw(spec: ScreenSpec, t: number) {
    const hv = this.hover ? this.hover.side + this.hover.i : '';
    const k = JSON.stringify(spec, (kk, v) => (typeof v === 'function' ? 1 : v)) + this.lang + hv + this.clock.time;
    const animating = spec.anim || spec.kind === 'attract' || spec.kind === 'spinner' || spec.kind === 'amount' || spec.kind === 'cash' || spec.countdown !== undefined;
    if (k === this.key && (!animating || t - this.lastT < 0.05)) return;
    this.key = k; this.lastT = t;
    this.render(spec, t);
    this.tex.needsUpdate = true;
  }

  private P(l: L2) { return this.lang === 'th' ? l[0] : l[1]; }
  private S(l: L2) { return this.lang === 'th' ? l[1] : l[0]; }
  private fontP(sz: number, w = 700) { return `${w} ${sz}px ${this.lang === 'th' ? F.ui : F.heavy}`; }
  private fontS(sz: number, w = 500) { return `${w} ${sz}px ${this.lang === 'th' ? F.heavy : F.ui}`; }

  private fit(text: string, font: (sz: number) => string, size: number, maxW: number) {
    const x = this.x;
    let s = size;
    x.font = font(s);
    while (s > 14 && x.measureText(text).width > maxW) { s -= 2; x.font = font(s); }
    return s;
  }

  private render(s: ScreenSpec, t: number) {
    const x = this.x, b = this.b;
    this.rects = [];
    // ---- background
    const g = x.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, b.bg1); g.addColorStop(1, b.bg0);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // soft light band + fine guilloche
    const lg = x.createLinearGradient(0, H * 0.2, W, H * 0.8);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.06)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,0.035)'; x.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) { x.beginPath(); for (let px = 0; px <= W; px += 16) x.lineTo(px, 520 + i * 18 + Math.sin(px / 90 + i * 0.5) * 26); x.stroke(); }
    if (s.kind === 'off') { x.fillStyle = '#020203'; x.fillRect(0, 0, W, H); return; }
    // ---- header
    x.fillStyle = b.head; x.fillRect(0, 0, W, 92);
    x.fillStyle = b.accent; x.fillRect(0, 92, W, 5);
    drawLogo(x, 54, 46, 32, b);
    x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillStyle = '#ffffff'; x.font = `800 38px ${F.heavy}`; x.fillText(b.th, 100, 38);
    x.fillStyle = b.accent2; x.font = `700 18px ${F.heavy}`; x.fillText(b.en, 102, 72);
    x.textAlign = 'right';
    x.fillStyle = '#ffffff'; x.font = `700 34px ${F.heavy}`; x.fillText(this.clock.time, W - 28, 36);
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.font = `500 20px ${F.heavy}`; x.fillText(this.clock.date, W - 28, 70);

    // ---- body
    const cx = W / 2;
    x.textAlign = 'center';
    const title = (yy: number, l?: L2, sz = 50) => {
      if (!l) return;
      x.fillStyle = '#ffffff';
      this.fit(this.P(l), (z) => this.fontP(z, 700), sz, W - 120);
      x.fillText(this.P(l), cx, yy);
      x.fillStyle = 'rgba(255,255,255,0.72)';
      this.fit(this.S(l), (z) => this.fontS(z, 500), Math.round(sz * 0.5), W - 160);
      x.fillText(this.S(l), cx, yy + sz * 0.78);
    };
    switch (s.kind) {
      case 'attract': {
        title(178, s.title ?? ['กรุณาสอดบัตร', 'Please insert your card'], 60);
        // animated card sliding into a slot
        const k = (t * 0.6) % 1;
        const slide = k < 0.6 ? k / 0.6 : 1;
        const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        x.save();
        x.translate(cx, 470);
        x.fillStyle = 'rgba(0,0,0,0.35)'; rr(x, -150, -14, 300, 28, 12); x.fill();
        x.fillStyle = '#1b1d20'; rr(x, -120, -6, 240, 12, 6); x.fill();
        x.globalAlpha = fade;
        x.save();
        x.beginPath(); x.rect(-200, -300, 400, 296); x.clip();
        const cy = -230 + slide * 140;
        const cg = x.createLinearGradient(-90, cy - 60, 90, cy + 60);
        cg.addColorStop(0, b.bg1); cg.addColorStop(1, b.head);
        x.fillStyle = cg; rr(x, -95, cy - 62, 190, 124, 12); x.fill();
        x.strokeStyle = b.accent; x.lineWidth = 3; x.stroke();
        x.fillStyle = b.accent; rr(x, -70, cy - 20, 40, 30, 5); x.fill();
        drawLogo(x, 55, cy - 30, 18, b);
        x.restore();
        x.globalAlpha = 1;
        // arrow
        x.fillStyle = b.accent2;
        const ay = 40 + Math.sin(t * 5) * 6;
        x.beginPath(); x.moveTo(-26, ay); x.lineTo(26, ay); x.lineTo(0, ay + 30); x.closePath(); x.fill();
        x.restore();
        x.fillStyle = 'rgba(255,255,255,0.85)';
        x.font = this.fontP(28, 600); x.fillText(this.lang === 'th' ? 'ถอนเงิน · ฝากเงิน · โอนเงินพร้อมเพย์ · สอบถามยอด' : 'Withdraw · Deposit · PromptPay transfer · Balance', cx, 628);
        x.fillStyle = b.accent2; x.font = this.fontS(22, 600);
        x.fillText(this.lang === 'th' ? 'บริการตลอด 24 ชั่วโมง' : 'Open 24 hours', cx, 668);
        break;
      }
      case 'busy': {
        title(330, s.title ?? ['กำลังให้บริการ', 'In service'], 56);
        title(470, s.sub ?? ['กรุณารอสักครู่', 'Please wait'], 34);
        break;
      }
      case 'pin': {
        title(170, s.title, 46);
        if (s.sub) title(262, s.sub, 28);
        const n = s.pin ?? 0;
        for (let i = 0; i < 4; i++) {
          const bx = cx - 2 * 96 + i * 96 + 8, by = 340;
          x.fillStyle = 'rgba(255,255,255,0.95)'; rr(x, bx, by, 80, 96, 12); x.fill();
          x.strokeStyle = i === n ? b.accent : 'rgba(0,0,0,0.25)'; x.lineWidth = i === n ? 5 : 2; rr(x, bx, by, 80, 96, 12); x.stroke();
          if (i < n) { x.fillStyle = b.ink; x.beginPath(); x.arc(bx + 40, by + 48, 15, 0, Math.PI * 2); x.fill(); }
          else if (i === n && Math.floor(t * 2.2) % 2 === 0) { x.fillStyle = b.ink; x.fillRect(bx + 38, by + 22, 4, 52); }
        }
        if (s.tone === 'err' && s.footer) { /* drawn in footer */ }
        break;
      }
      case 'amount': {
        title(170, s.title, 44);
        if (s.sub) title(258, s.sub, 26);
        x.fillStyle = 'rgba(255,255,255,0.96)'; rr(x, cx - 260, 330, 520, 120, 16); x.fill();
        x.strokeStyle = b.accent; x.lineWidth = 4; rr(x, cx - 260, 330, 520, 120, 16); x.stroke();
        x.fillStyle = b.ink; x.textAlign = 'right';
        x.font = `800 72px ${F.heavy}`;
        const am = s.amount ? Number(s.amount).toLocaleString('en-US') : '0';
        const caret = Math.floor(t * 2.2) % 2 === 0 ? '|' : ' ';
        x.fillText(am + caret, cx + 170, 394);
        x.textAlign = 'left'; x.font = this.fontP(34, 700); x.fillText(s.unit ?? (this.lang === 'th' ? 'บาท' : 'THB'), cx + 182, 396);
        x.textAlign = 'center';
        break;
      }
      case 'spinner': {
        title(250, s.title ?? ['กำลังดำเนินการ', 'Processing'], 50);
        title(340, s.sub ?? ['กรุณารอสักครู่', 'Please wait'], 30);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.floor(t * 12) * (Math.PI * 2 / 12);
          x.fillStyle = `rgba(255,255,255,${0.12 + 0.88 * (i / 11)})`;
          x.beginPath(); x.arc(cx + Math.cos(a) * 58, 530 + Math.sin(a) * 58, 9, 0, Math.PI * 2); x.fill();
        }
        break;
      }
      case 'message': case 'retained': case 'cash': {
        const icon = s.icon ?? (s.kind === 'retained' ? 'lock' : s.kind === 'cash' ? 'cash' : s.tone === 'err' ? 'err' : 'ok');
        this.icon(icon, cx, 300, t, s.tone);
        title(468, s.title, 48);
        if (s.sub) title(570, s.sub, 30);
        break;
      }
      case 'table': {
        title(160, s.title, 44);
        const rows = s.rows ?? [];
        const top = 244, rh = 64;
        x.fillStyle = 'rgba(255,255,255,0.93)'; rr(x, 120, top - 10, W - 240, rows.length * rh + 20, 14); x.fill();
        rows.forEach((r, i) => {
          const yy = top + i * rh + rh / 2;
          if (i > 0) { x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(140, top + i * rh, W - 280, 2); }
          x.textAlign = 'left'; x.fillStyle = '#2a3a3c';
          x.font = this.fontP(28, 600); x.fillText(this.lang === 'th' ? r[0] : r[1], 150, yy - 8);
          x.fillStyle = 'rgba(40,60,62,0.6)'; x.font = this.fontS(17, 500); x.fillText(this.lang === 'th' ? r[1] : r[0], 150, yy + 20);
          x.textAlign = 'right'; x.fillStyle = b.ink; x.font = `800 36px ${F.heavy}`; x.fillText(r[2], W - 150, yy + 2);
        });
        x.textAlign = 'center';
        if (s.sub) title(top + rows.length * rh + 70, s.sub, 28);
        break;
      }
      case 'menu': default: {
        title(s.sub ? 158 : 186, s.title, 50);
        if (s.sub) title(250, s.sub, 28);
        break;
      }
    }
    // ---- countdown ring
    if (s.countdown !== undefined) {
      const v = Math.max(0, s.countdown);
      x.save();
      x.translate(cx, s.kind === 'menu' ? 420 : 300);
      x.strokeStyle = 'rgba(255,255,255,0.2)'; x.lineWidth = 12; x.beginPath(); x.arc(0, 0, 60, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = b.accent; x.beginPath(); x.arc(0, 0, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((v % 1) || 1)); x.stroke();
      x.fillStyle = '#fff'; x.font = `800 58px ${F.heavy}`; x.fillText(String(Math.ceil(v)), 0, 4);
      x.restore();
    }
    // ---- side options
    const opt = (o: Opt | null | undefined, side: 'L' | 'R', i: number) => {
      if (!o) return;
      const yy = FDK_ROWS[i];
      const w = 404, h = 86;
      const X = side === 'L' ? 0 : W - w;
      const hov = this.hover && this.hover.side === side && this.hover.i === i && !o.dim;
      x.save();
      x.globalAlpha = o.dim ? 0.38 : 1;
      // pill with an arrow tab pointing at the key
      const g2 = x.createLinearGradient(0, yy - h / 2, 0, yy + h / 2);
      const base = o.tone === 'err' ? ['#ffe9e6', '#f3c9c2'] : o.tone === 'ok' ? ['#eafbea', '#c9ecca'] : ['#ffffff', '#dfe9ea'];
      g2.addColorStop(0, hov ? '#fff6d6' : base[0]); g2.addColorStop(1, hov ? '#f2d98a' : base[1]);
      x.fillStyle = g2;
      x.beginPath();
      if (side === 'L') { x.moveTo(0, yy - h / 2); x.lineTo(w - 24, yy - h / 2); x.quadraticCurveTo(w, yy - h / 2, w, yy - h / 2 + 24); x.lineTo(w, yy + h / 2 - 24); x.quadraticCurveTo(w, yy + h / 2, w - 24, yy + h / 2); x.lineTo(0, yy + h / 2); }
      else { x.moveTo(W, yy - h / 2); x.lineTo(X + 24, yy - h / 2); x.quadraticCurveTo(X, yy - h / 2, X, yy - h / 2 + 24); x.lineTo(X, yy + h / 2 - 24); x.quadraticCurveTo(X, yy + h / 2, X + 24, yy + h / 2); x.lineTo(W, yy + h / 2); }
      x.closePath(); x.fill();
      x.fillStyle = b.accent;
      if (side === 'L') x.fillRect(0, yy - h / 2, 12, h); else x.fillRect(W - 12, yy - h / 2, 12, h);
      // arrow glyph next to the physical key
      x.fillStyle = b.ink;
      x.beginPath();
      if (side === 'L') { x.moveTo(40, yy); x.lineTo(24, yy - 12); x.lineTo(24, yy + 12); }
      else { x.moveTo(W - 40, yy); x.lineTo(W - 24, yy - 12); x.lineTo(W - 24, yy + 12); }
      x.closePath(); x.fill();
      x.textAlign = side === 'L' ? 'left' : 'right';
      const tx = side === 'L' ? 58 : W - 58;
      x.fillStyle = o.tone === 'err' ? '#9a1a12' : b.ink;
      this.fit(this.P(o.t), (z) => this.fontP(z, 700), 36, w - 80);
      x.fillText(this.P(o.t), tx, yy - 11);
      x.fillStyle = 'rgba(20,50,54,0.62)';
      this.fit(this.S(o.t), (z) => this.fontS(z, 500), 19, w - 80);
      x.fillText(this.S(o.t), tx, yy + 24);
      x.restore();
      this.rects.push({ x: X, y: yy - h / 2, w, h, side, i });
    };
    (s.left ?? []).forEach((o, i) => opt(o, 'L', i));
    (s.right ?? []).forEach((o, i) => opt(o, 'R', i));
    // ---- footer
    x.fillStyle = 'rgba(0,0,0,0.32)'; x.fillRect(0, H - 52, W, 52);
    x.textAlign = 'center';
    const ft: L2 = s.footer ?? ['กด "ยกเลิก" เพื่อจบรายการ · ปิดบังขณะกดรหัสทุกครั้ง', 'Press CANCEL to end · Always cover your PIN'];
    x.fillStyle = s.tone === 'err' ? '#ffb3a8' : 'rgba(255,255,255,0.82)';
    this.fit(this.P(ft), (z) => this.fontP(z, 500), 24, W - 60);
    x.fillText(this.P(ft), cx, H - 26);
    // LCD subpixel feel + edge falloff
    const vg = x.createRadialGradient(cx, H / 2, H * 0.35, cx, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
  }

  private icon(kind: NonNullable<ScreenSpec['icon']>, cx: number, cy: number, t: number, tone?: string) {
    const x = this.x, b = this.b;
    x.save();
    x.translate(cx, cy);
    const ring = (col: string) => { x.fillStyle = col; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(255,255,255,0.15)'; x.beginPath(); x.arc(0, 0, 80, 0, Math.PI * 2); x.fill(); };
    switch (kind) {
      case 'ok': ring('#1f9a48'); x.strokeStyle = '#fff'; x.lineWidth = 16; x.lineCap = 'round'; x.beginPath(); x.moveTo(-38, 2); x.lineTo(-10, 30); x.lineTo(42, -28); x.stroke(); break;
      case 'err': ring('#c8302a'); x.strokeStyle = '#fff'; x.lineWidth = 16; x.lineCap = 'round'; x.beginPath(); x.moveTo(-30, -30); x.lineTo(30, 30); x.moveTo(30, -30); x.lineTo(-30, 30); x.stroke(); break;
      case 'lock': ring('#c8302a'); x.fillStyle = '#fff'; rr(x, -38, -10, 76, 58, 8); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 12; x.beginPath(); x.arc(0, -12, 24, Math.PI, 0); x.stroke(); break;
      case 'clock': ring(b.accent); x.strokeStyle = '#fff'; x.lineWidth = 10; x.beginPath(); x.arc(0, 0, 52, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -36); x.moveTo(0, 0); x.lineTo(28, 10); x.stroke(); break;
      case 'card': {
        ring(b.accent);
        const k = Math.sin(t * 4) * 10;
        x.fillStyle = '#fff'; rr(x, -50, -32 + k, 100, 64, 8); x.fill();
        x.fillStyle = b.accent; rr(x, -36, -14 + k, 22, 18, 3); x.fill();
        break;
      }
      case 'receipt': ring(b.accent); x.fillStyle = '#fff'; x.fillRect(-30, -50, 60, 96); x.fillStyle = b.accent; for (let i = 0; i < 4; i++) x.fillRect(-20, -34 + i * 18, 40, 6); break;
      case 'cash': case 'deposit': {
        ring(tone === 'err' ? '#c8302a' : '#1f9a48');
        const k = kind === 'cash' ? Math.sin(t * 5) * 8 : -Math.sin(t * 5) * 8;
        for (let i = 0; i < 3; i++) { x.fillStyle = i === 2 ? '#fff' : 'rgba(255,255,255,0.6)'; rr(x, -50 + i * 5, -30 - i * 7 + k, 100, 52, 6); x.fill(); }
        x.fillStyle = '#1f9a48'; x.beginPath(); x.arc(5, -9 + k, 12, 0, Math.PI * 2); x.fill();
        break;
      }
    }
    x.restore();
  }

  /** canvas pixel → option under it */
  pick(px: number, py: number): { side: 'L' | 'R'; i: number } | null {
    for (const r of this.rects) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return { side: r.side, i: r.i };
    return null;
  }
}
