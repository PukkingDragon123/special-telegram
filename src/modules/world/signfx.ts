/* ============================================================================================
 * Real-world signage feel for canvas-drawn signs, boards, posters and price cards: run AFTER the
 * lettering is drawn. Adds (deterministic per seed):
 *  - a slight emboss of everything already on the canvas (painted / vinyl-cut letters stand off
 *    the board instead of looking like crisp screen text)
 *  - print/paint grain, sun fade toward warm-white, grime at the edges, rain streaks running down
 *    from the top, a few light scratches, optional rust bloom (metal) or paper fibres (paper)
 * Cheap: one offscreen copy + a few hundred primitive draws, done once per texture.
 * ========================================================================================== */

export type SignSurface = 'paint' | 'vinyl' | 'paper' | 'metal' | 'card';

export interface WeatherOpts {
  seed?: number;
  surface?: SignSurface;
  /** 0..1 overall wear (default per surface) */
  wear?: number;
  /** embossed lettering strength (0 = none) */
  emboss?: number;
}

const DEF: Record<SignSurface, { wear: number; emboss: number }> = {
  paint: { wear: 0.55, emboss: 0.6 },
  vinyl: { wear: 0.35, emboss: 0.45 },
  paper: { wear: 0.45, emboss: 0.15 },
  metal: { wear: 0.65, emboss: 0.7 },
  card: { wear: 0.4, emboss: 0.25 },
};

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function weatherSign(ctx: CanvasRenderingContext2D, w: number, h: number, o: WeatherOpts = {}) {
  const surf = o.surface ?? 'paint';
  const wear = o.wear ?? DEF[surf].wear;
  const emb = o.emboss ?? DEF[surf].emboss;
  let seed = (o.seed ?? 1) >>> 0 || 1;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  const k = Math.max(w, h) / 512;   // scale details with the canvas size

  ctx.save();
  // ---- emboss: shadow below-right + highlight above-left of the existing artwork
  if (emb > 0) {
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const s = src.getContext('2d')!;
    s.drawImage(ctx.canvas, 0, 0);
    const d = Math.max(1, Math.round(1.6 * k));
    ctx.globalAlpha = 0.28 * emb; ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(src, d, d);
    ctx.globalAlpha = 0.16 * emb; ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(src, -d * 0.6, -d * 0.6);
  }
  ctx.globalAlpha = 1;
  // ---- grain (paint flecks / print dots)
  ctx.globalCompositeOperation = 'source-atop';
  const n = Math.round(w * h * 0.0016 * (0.5 + wear));
  for (let i = 0; i < n; i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.06})` : `rgba(255,250,240,${0.05 + rnd() * 0.07})`;
    const sz = (0.6 + rnd() * 1.6) * k;
    ctx.fillRect(rnd() * w, rnd() * h, sz, sz);
  }
  // ---- sun fade (washes saturated colours toward warm white, more at the top)
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, `rgba(255,246,228,${0.16 * wear})`);
  fade.addColorStop(1, `rgba(255,246,228,${0.05 * wear})`);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
  // ---- grime: darker edges + rain streaks from the top
  ctx.globalCompositeOperation = 'source-atop';
  const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  edge.addColorStop(0, 'rgba(40,30,20,0)');
  edge.addColorStop(1, `rgba(40,30,20,${0.32 * wear})`);
  ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  const streaks = Math.round(w / (28 * k) * wear);
  for (let i = 0; i < streaks; i++) {
    const x = rnd() * w, len = h * (0.15 + rnd() * 0.6), ww = (1.5 + rnd() * 5) * k;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(60,48,34,${0.18 * wear})`); g.addColorStop(1, 'rgba(60,48,34,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, ww, len);
  }
  // ---- scratches
  ctx.strokeStyle = `rgba(255,252,240,${0.22 * wear})`; ctx.lineWidth = Math.max(0.6, 0.8 * k);
  for (let i = 0; i < Math.round(6 * wear * (w / 512)); i++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI, l = (10 + rnd() * 40) * k;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  // ---- surface specific
  if (surf === 'metal') {
    for (let i = 0; i < Math.round(5 * wear); i++) {
      const x = rnd() < 0.5 ? rnd() * w * 0.12 : w - rnd() * w * 0.12, y = rnd() * h, r = (8 + rnd() * 22) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(120,58,22,0.55)'); g.addColorStop(1, 'rgba(120,58,22,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else if (surf === 'paper') {
    ctx.strokeStyle = 'rgba(120,100,70,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) { const x = rnd() * w, y = rnd() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 12 * k, y + (rnd() - 0.5) * 12 * k); ctx.stroke(); }
    // a fold crease
    if (rnd() < 0.6) { const y = h * (0.4 + rnd() * 0.2); ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, y, w, 2 * k); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, y + 2 * k, w, 1.5 * k); }
  }
  ctx.restore();
}
