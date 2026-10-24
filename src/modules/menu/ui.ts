import { asset } from '../../core/util';
import { albumText, AlbumCanvas, COVER, HOVER, PRESSED, DISABLED, LetterStyle, LineSpec } from './lettering';
import { sfx } from './sfx';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Sticker UI: album-cover lettering floating over the 3D set (exactly like the print on ref4).
 * No panels, no boxes: every control is a die-cut sticker of lettering (R4's pre-rendered PNGs in
 * public/assets/img/ui/ for the fixed buttons, runtime `albumText` for dynamic text).
 * Elements are DOM nodes under the fade curtain (z-index 9), animated with springs:
 * slap-in entrance, wobbly hover (yellow fill like the backdrop glow), squash on press.
 * 1 UI unit = 1 px at 1280×720 (scaled to the viewport).
 * ========================================================================================== */

export type Anchor = 'c' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
export type Look = 'normal' | 'hover' | 'pressed' | 'disabled';

export interface StickerOpts {
  /** R4 art base name in img/ui (e.g. 'btn_host' → btn_host.png / _hover / _pressed / _disabled) */
  img?: string;
  imgVariants?: boolean;
  /** runtime lettering */
  lines?: LineSpec[];
  style?: LetterStyle;
  /** custom canvas painter (called per look) */
  paint?: (look: Look) => HTMLCanvasElement;
  /** display width in UI units (height follows the art) — or height for lettering if widthMode = 'h' */
  width?: number;
  height?: number;
  x?: number; y?: number;
  anchor?: Anchor;
  /** screen-space position provider (px) – overrides anchor/x/y (labels that follow 3D points) */
  follow?: () => { x: number; y: number; visible: boolean } | null;
  tilt?: number;
  onClick?: () => void;
  delay?: number;
  disabled?: boolean;
  /** idle bob amplitude (UI units) */
  bob?: number;
  z?: number;
  clickSound?: string;
  /** don't react to the mouse */
  passive?: boolean;
}

const css = `
.hp-mui{position:fixed;inset:0;z-index:9;pointer-events:none;overflow:hidden;font-family:${F.ui},sans-serif;user-select:none;-webkit-user-select:none}
.hp-mui .stk{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform,opacity;pointer-events:auto;cursor:pointer;
  filter:drop-shadow(0 calc(var(--u)*3px) calc(var(--u)*3px) rgba(20,14,4,.35))}
.hp-mui .stk.passive{pointer-events:none;cursor:default}
.hp-mui .stk.dis{cursor:not-allowed}
.hp-mui .stk > img,.hp-mui .stk > canvas{display:block;width:100%;height:100%;pointer-events:none}
.hp-mui input.hp-hidden{position:absolute;opacity:0;pointer-events:none;width:10px;height:10px;left:-100px;top:0;font-size:16px}
`;

let styleEl: HTMLStyleElement | null = null;
const imgCache = new Map<string, HTMLImageElement>();
function img(name: string): HTMLImageElement {
  let im = imgCache.get(name);
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.src = asset('img/ui/' + name + '.png');
    imgCache.set(name, im);
  }
  return im;
}
export function preloadUi(names: string[]) { for (const n of names) for (const v of ['', '_hover', '_pressed', '_disabled']) img(n + v); }

export class Sticker {
  el: HTMLDivElement;
  opts: StickerOpts;
  // spring state
  s = 0; vs = 0; ts = 1;
  r = 0; vr = 0; tr = 0;
  a = 0; ta = 1;
  ox = 0; oy = 0; vox = 0; voy = 0;
  age = 0;
  hover = false; pressed = false;
  dead = false; leaving = false;
  w = 0; h = 0;
  look: Look = 'normal';
  private node: HTMLImageElement | HTMLCanvasElement | null = null;
  private cache = new Map<Look, HTMLCanvasElement>();
  shake = 0;
  bobT = Math.random() * 10;
  constructor(private ui: StickerUI, o: StickerOpts) {
    this.opts = o;
    const el = (this.el = document.createElement('div'));
    el.className = 'stk' + (o.passive ? ' passive' : '');
    if (o.z) el.style.zIndex = String(o.z);
    this.r = (o.tilt ?? 0) + (Math.random() < 0.5 ? -18 : 18);
    this.tr = o.tilt ?? 0;
    this.render();
    if (!o.passive) {
      el.addEventListener('pointerenter', () => { if (this.opts.disabled || this.leaving) return; this.hover = true; this.vr += (Math.random() < 0.5 ? -1 : 1) * 60; sfx.hover(); this.render(); });
      el.addEventListener('pointerleave', () => { this.hover = false; this.pressed = false; this.render(); });
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (this.opts.disabled || this.leaving) { if (this.opts.disabled) { this.shake = 0.4; sfx.error(); } return; } this.pressed = true; this.vs -= 2; this.render(); });
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (!this.pressed || this.opts.disabled || this.leaving) return;
        this.pressed = false;
        this.vs += 6; this.vr += (Math.random() - 0.5) * 120;
        this.render();
        if (this.opts.clickSound !== '') sfx.click(this.opts.clickSound);
        try { this.opts.onClick?.(); } catch (err) { console.error('[menu ui]', err); }
      });
    }
    ui.root.appendChild(el);
  }

  setDisabled(v: boolean) { if (this.opts.disabled === v) return; this.opts.disabled = v; this.el.classList.toggle('dis', v); this.render(); }
  setLines(lines: LineSpec[]) { this.opts.lines = lines; this.cache.clear(); this.render(); }
  repaint() { this.cache.clear(); this.render(); }

  private render() {
    const o = this.opts;
    const look: Look = o.disabled ? 'disabled' : this.pressed ? 'pressed' : this.hover ? 'hover' : 'normal';
    this.look = look;
    let node: HTMLImageElement | HTMLCanvasElement;
    if (o.img) {
      const name = o.img + (o.imgVariants === false || look === 'normal' ? '' : '_' + look);
      node = img(name).cloneNode() as HTMLImageElement;
      const base = img(o.img);
      const setSize = () => { const k = (o.width ?? 200) / (base.naturalWidth || 1); this.w = o.width ?? 200; this.h = (base.naturalHeight || 1) * k; };
      if (base.complete && base.naturalWidth) setSize(); else base.addEventListener('load', () => { setSize(); this.ui.layout(); }, { once: true });
    } else {
      let cv = this.cache.get(look);
      if (!cv) {
        if (o.paint) cv = o.paint(look);
        else {
          const st = look === 'disabled' ? DISABLED : look === 'pressed' ? PRESSED : look === 'hover' ? HOVER : (o.style ?? COVER);
          const lines = (o.lines ?? [{ text: '?', size: 60 }]).map((l) => ({ ...l, style: look === 'normal' ? l.style : (l.style && l.style !== COVER ? (look === 'hover' ? { ...l.style, fill: HOVER.fill, fillLo: HOVER.fillLo } : l.style) : st) }));
          cv = albumText(lines, { style: st, scale: Math.min(2.5, (window.devicePixelRatio || 1) * this.ui.u * 1.15) });
        }
        this.cache.set(look, cv);
      }
      node = cv;
      const ac = cv as AlbumCanvas;
      const cw = ac.cssW ?? cv.width, ch = ac.cssH ?? cv.height;
      if (o.width) { this.w = o.width; this.h = ch * (o.width / cw); }
      else if (o.height) { this.h = o.height; this.w = cw * (o.height / ch); }
      else { this.w = cw / Math.max(0.0001, this.ui.paintScale()); this.h = ch / Math.max(0.0001, this.ui.paintScale()); }
    }
    if (this.node) this.node.replaceWith(node); else this.el.appendChild(node);
    this.node = node;
    this.ui.layoutOne(this);
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.ts = 0; this.ta = 0; this.vr += (Math.random() - 0.5) * 300;
    this.el.style.pointerEvents = 'none';
  }
}

export class StickerUI {
  root: HTMLDivElement;
  list: Sticker[] = [];
  u = 1;
  private hidden: HTMLInputElement;
  constructor() {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl); }
    this.root = document.createElement('div');
    this.root.className = 'hp-mui';
    document.body.appendChild(this.root);
    this.hidden = document.createElement('input');
    this.hidden.className = 'hp-hidden';
    this.root.appendChild(this.hidden);
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }
  private onResize = () => {
    this.u = Math.min(innerWidth / 1280, innerHeight / 720);
    this.root.style.setProperty('--u', String(this.u));
    this.layout();
  };
  /** lettering is painted at 1 css px per canvas px / scale – return the css→ui factor */
  paintScale() { return 1; }

  add(o: StickerOpts) {
    const s = new Sticker(this, o);
    this.list.push(s);
    this.layoutOne(s);
    return s;
  }

  remove(s: Sticker | null | undefined) { if (s) s.leave(); }
  clear() { for (const s of this.list) s.leave(); }

  layout() { for (const s of this.list) this.layoutOne(s); }

  /** compute pixel position of a sticker */
  pos(s: Sticker): { x: number; y: number; visible: boolean } {
    const o = s.opts, u = this.u, W = innerWidth, H = innerHeight;
    if (o.follow) { const p = o.follow(); return p ?? { x: -9999, y: -9999, visible: false }; }
    const x = (o.x ?? 0) * u, y = (o.y ?? 0) * u;
    switch (o.anchor ?? 'c') {
      case 'tl': return { x, y, visible: true };
      case 'tr': return { x: W - x, y, visible: true };
      case 'bl': return { x, y: H - y, visible: true };
      case 'br': return { x: W - x, y: H - y, visible: true };
      case 't': return { x: W / 2 + x, y, visible: true };
      case 'b': return { x: W / 2 + x, y: H - y, visible: true };
      case 'l': return { x, y: H / 2 + y, visible: true };
      case 'r': return { x: W - x, y: H / 2 + y, visible: true };
      default: return { x: W / 2 + x, y: H / 2 + y, visible: true };
    }
  }

  layoutOne(s: Sticker) {
    const w = s.w * this.u, h = s.h * this.u;
    s.el.style.width = `${w}px`;
    s.el.style.height = `${h}px`;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    for (const s of this.list) {
      s.age += dt;
      const delay = s.opts.delay ?? 0;
      if (s.age < delay) { s.el.style.opacity = '0'; continue; }
      if (s.age - dt < delay && !s.leaving) { s.s = 0.2; s.vs = 0; sfx.pop(); }
      const hov = s.hover && !s.opts.disabled ? 1.07 : 1;
      const prs = s.pressed ? 0.9 : 1;
      const tgt = s.leaving ? 0 : s.ts * hov * prs;
      // springs (stiff + slightly underdamped = juicy)
      s.vs += ((tgt - s.s) * 260 - s.vs * 15) * dt;
      s.s += s.vs * dt;
      const tr = s.tr + (s.hover ? Math.sin(s.age * 9) * 1.6 : 0);
      s.vr += ((tr - s.r) * 180 - s.vr * 12) * dt;
      s.r += s.vr * dt;
      s.a += ((s.leaving ? 0 : s.ta) - s.a) * Math.min(1, dt * (s.leaving ? 10 : 14));
      if (s.shake > 0) s.shake = Math.max(0, s.shake - dt);
      const shx = s.shake > 0 ? Math.sin(s.age * 70) * 9 * s.shake * this.u : 0;
      s.bobT += dt;
      const bob = (s.opts.bob ?? 0) * Math.sin(s.bobT * 3.2) * this.u;
      const p = this.pos(s);
      const w = s.w * this.u, h = s.h * this.u;
      s.el.style.opacity = p.visible ? String(Math.max(0, Math.min(1, s.a))) : '0';
      s.el.style.transform = `translate(${(p.x - w / 2 + shx).toFixed(1)}px, ${(p.y - h / 2 + bob).toFixed(1)}px) rotate(${s.r.toFixed(2)}deg) scale(${Math.max(0, s.s).toFixed(3)})`;
      if (s.leaving && s.s < 0.03 && s.a < 0.05) s.dead = true;
    }
    for (const s of this.list) if (s.dead) s.el.remove();
    this.list = this.list.filter((s) => !s.dead);
  }

  /** Focus a hidden text input; returns a controller. */
  typeInto(o: { value: string; max: number; filter?: (s: string) => string; onChange: (v: string) => void; onSubmit: (v: string) => void; onCancel?: () => void }) {
    const inp = this.hidden;
    inp.value = o.value;
    inp.maxLength = o.max;
    const onInput = () => {
      let v = inp.value;
      if (o.filter) v = o.filter(v);
      v = v.slice(0, o.max);
      if (v !== inp.value) inp.value = v;
      o.onChange(v);
      sfx.type();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(); o.onSubmit(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(); o.onCancel?.(); }
    };
    const onBlur = () => { setTimeout(() => { if (document.activeElement !== inp && active) { cleanup(); o.onSubmit(inp.value); } }, 120); };
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      inp.removeEventListener('input', onInput);
      inp.removeEventListener('keydown', onKey);
      inp.removeEventListener('blur', onBlur);
      inp.blur();
    };
    inp.addEventListener('input', onInput);
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('blur', onBlur);
    setTimeout(() => inp.focus(), 0);
    return { close: cleanup, get active() { return active; }, focus: () => inp.focus() };
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.list = [];
  }
}

/** Plate art (R4 plate_room_code.png) with a code / text painted in its white region. */
export function plateCanvas(text: string, o: { plate?: string; caret?: boolean; placeholder?: string; size?: number; color?: string } = {}): HTMLCanvasElement {
  const plate = img(o.plate ?? 'plate_room_code');
  const cv = document.createElement('canvas') as AlbumCanvas;
  const W = plate.naturalWidth || 864, H = plate.naturalHeight || 274;
  cv.width = W; cv.height = H;
  cv.cssW = W / 2; cv.cssH = H / 2;
  const ctx = cv.getContext('2d')!;
  if (plate.complete && plate.naturalWidth) ctx.drawImage(plate, 0, 0);
  // text region (R4 manifest): x=pad+0.30h, y=pad+0.18h, w=w-0.6h, h=h-0.36h; pad 60 → derive from size
  const isCode = (o.plate ?? 'plate_room_code') === 'plate_room_code';
  const rx = W * (isCode ? 0.12 : 0.1), ry = H * (isCode ? 0.36 : 0.3), rw = W * (isCode ? 0.76 : 0.8), rh = H * (isCode ? 0.44 : 0.42);
  const t = text || o.placeholder || '';
  ctx.save();
  ctx.font = `900 ${Math.round(rh * (o.size ?? 0.92))}px ${F.looped}, ${F.heavy}`;
  (ctx as any).letterSpacing = isCode ? `${Math.round(rh * 0.18)}px` : '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = text ? (o.color ?? '#1E3314') : 'rgba(30,51,20,0.28)';
  const m = ctx.measureText(t);
  const sx = Math.min(1, rw / Math.max(1, m.width));
  ctx.translate(rx + rw / 2, ry + rh / 2 + rh * 0.04);
  ctx.scale(sx, 1);
  ctx.fillText(t, 0, 0);
  if (o.caret && (Math.floor(performance.now() / 500) % 2 === 0)) {
    ctx.fillStyle = '#4E9E3A';
    ctx.fillRect(m.width / 2 + rh * 0.12, -rh * 0.38, rh * 0.08, rh * 0.76);
  }
  ctx.restore();
  return cv;
}
