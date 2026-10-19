import * as THREE from 'three';
import { F } from '../core/fonts';

/**
 * Canvas text rendering with proper Thai shaping (the browser shapes Thai; we only lay out lines).
 * Thai has no spaces between words → line breaking uses Intl.Segmenter word boundaries.
 */
export interface TextStyle {
  font?: string;          // family, e.g. F.ui
  size?: number;          // px (canvas space)
  weight?: number | string;
  italic?: boolean;
  color?: string;
  stroke?: string;        // outline colour
  strokeWidth?: number;   // px
  shadow?: string;        // css colour
  shadowBlur?: number;
  shadowOffset?: [number, number];
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;    // multiplier
  maxWidth?: number;      // px, wrap beyond this
  letterSpacing?: number; // px
}

const seg: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;

export function fontStr(s: TextStyle) {
  return `${s.italic ? 'italic ' : ''}${s.weight ?? 500} ${s.size ?? 48}px ${s.font ?? F.ui}, "Sarabun", sans-serif`;
}

/** Split into lines that fit maxWidth (Thai-aware). Explicit \n always breaks. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth || ctx.measureText(para).width <= maxWidth) { out.push(para); continue; }
    const words: string[] = seg ? [...seg.segment(para)].map((s: any) => s.segment) : para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // a single huge "word" → hard break by characters
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = test;
    }
    if (line) out.push(line.trimEnd());
  }
  return out;
}

export interface TextBlock { text: string; style: TextStyle }

export interface MeasuredText { canvas: HTMLCanvasElement; width: number; height: number; lines: number }

/**
 * Render one or more text blocks (e.g. Thai line + small English subtitle) into a tight canvas.
 * `pad` adds transparent margin. `scale` renders at higher resolution for crispness.
 */
export function renderText(blocks: TextBlock[], opts: { pad?: number; scale?: number; minWidth?: number; gap?: number; canvas?: HTMLCanvasElement } = {}): MeasuredText {
  const scale = opts.scale ?? 1;
  const pad = (opts.pad ?? 8) * scale;
  const gap = (opts.gap ?? 4) * scale;
  const cv = opts.canvas ?? document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  type L = { text: string; style: TextStyle; w: number; h: number; asc: number; b: number };
  const lines: L[] = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const st = { ...b.style, size: (b.style.size ?? 48) * scale, strokeWidth: (b.style.strokeWidth ?? 0) * scale, maxWidth: b.style.maxWidth ? b.style.maxWidth * scale : 0 };
    ctx.font = fontStr(st);
    const ls = wrapText(ctx, b.text, st.maxWidth);
    for (const t of ls) {
      const m = ctx.measureText(t || ' ');
      const lh = st.size! * (st.lineHeight ?? 1.32);
      lines.push({ text: t, style: st, w: m.width + st.strokeWidth! * 2 + (st.letterSpacing ?? 0) * t.length, h: lh, asc: st.size! * 0.98, b: bi });
    }
  }
  const W = Math.ceil(Math.max(opts.minWidth ? opts.minWidth * scale : 0, ...lines.map((l) => l.w)) + pad * 2);
  const H = Math.ceil(lines.reduce((a, l) => a + l.h, 0) + gap * Math.max(0, blocks.length - 1) + pad * 2);
  cv.width = Math.max(2, W);
  cv.height = Math.max(2, H);
  ctx.clearRect(0, 0, cv.width, cv.height);
  let y = pad;
  let prevBlock = 0;
  for (const l of lines) {
    if (l.b !== prevBlock) { y += gap; prevBlock = l.b; }
    const st = l.style;
    ctx.font = fontStr(st);
    ctx.textBaseline = 'alphabetic';
    const align = st.align ?? 'center';
    ctx.textAlign = align;
    const x = align === 'center' ? cv.width / 2 : align === 'left' ? pad : cv.width - pad;
    const by = y + l.h * 0.5 + st.size! * 0.36;
    if (st.letterSpacing) (ctx as any).letterSpacing = `${st.letterSpacing}px`;
    else (ctx as any).letterSpacing = '0px';
    if (st.shadow) {
      ctx.save();
      ctx.shadowColor = st.shadow;
      ctx.shadowBlur = (st.shadowBlur ?? 8) * scale;
      ctx.shadowOffsetX = (st.shadowOffset?.[0] ?? 0) * scale;
      ctx.shadowOffsetY = (st.shadowOffset?.[1] ?? 3) * scale;
      ctx.fillStyle = st.shadow;
      ctx.fillText(l.text, x, by);
      ctx.restore();
    }
    if (st.stroke && st.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = st.strokeWidth * 2;
      ctx.strokeText(l.text, x, by);
    }
    ctx.fillStyle = st.color ?? '#1d1a16';
    ctx.fillText(l.text, x, by);
    y += l.h;
  }
  return { canvas: cv, width: cv.width, height: cv.height, lines: lines.length };
}

export function canvasTexture(cv: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Common presets. */
export const TS = {
  bubble: { font: F.ui, size: 46, weight: 500, color: '#24201b', maxWidth: 560, lineHeight: 1.28 } as TextStyle,
  bubbleSub: { font: F.body, size: 26, weight: 400, color: '#6b6258', maxWidth: 560 } as TextStyle,
  tag: { font: F.ui, size: 34, weight: 500, color: '#f6f1e7', maxWidth: 520 } as TextStyle,
  tagSub: { font: F.body, size: 22, weight: 400, color: '#cfc5b5' } as TextStyle,
  popup: { font: F.heavy, size: 64, weight: 800, color: '#fff7e0', stroke: '#2a1a08', strokeWidth: 7, shadow: 'rgba(0,0,0,0.45)', shadowBlur: 10 } as TextStyle,
  sign: { font: F.heavy, size: 72, weight: 800, color: '#ffffff' } as TextStyle,
  hand: { font: F.hand, size: 44, weight: 400, color: '#1b2b6b' } as TextStyle,
};
