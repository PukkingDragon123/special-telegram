import * as THREE from 'three';
import { tl, TL } from '../../core/util';
import { F } from '../../core/fonts';
import { Overlay } from '../../ui3d/overlay';
import { CASINO } from './lines';

/* ============================================================================================
 * Casino cutscene "cinema" kit:
 *  - CineCam: post-modifiers on top of each beat's authored shot — crash/snap zooms (FOV punch +
 *    decaying shake), slow push-ins, smooth handheld sway, dutch roll; plus "cheating" like on a
 *    film set: actors that would block the lens or that the lens is inside are hidden for the shot.
 *  - Menace: manga-style floating "ゴゴゴ" / "ドドド" glyphs (drawn as brush strokes on a canvas,
 *    so no Japanese font is needed) drifting around a hero pose — an homage to the dramatic
 *    standing-pose beats of 80s/90s action manga, no characters or art copied.
 *  - ScreenFX (DOM, above the canvas): colour-inverted freeze flash, manga focus/speed lines,
 *    duotone "standing pose" grade, sepia freeze + "to be continued" arrow.
 *  - Comedic lines with everyday Thai street swearing (no slurs, nothing sexual).
 * ========================================================================================== */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------ lines (with swearing)

/** Narration overrides on top of lines.ts (punchier, sweary). */
export const CINE_LINES = {
  ...CASINO,
  pose: tl('สี่หนุ่ม… มาเพื่อรวย', 'Four guys… here to get rich'),
  poseN: (n: number) => (n <= 1 ? tl('ชายคนนี้… มาเพื่อรวย', 'This man… came to get rich') : n === 2 ? tl('สองหนุ่ม… มาเพื่อรวย', 'Two guys… here to get rich') : n === 3 ? tl('สามหนุ่ม… มาเพื่อรวย', 'Three guys… here to get rich') : tl('สี่หนุ่ม… มาเพื่อรวย', 'Four guys… here to get rich')),
  win: tl('เชี่ยยย!! แบล็คแจ็ค!! รวยแล้วโว้ย!!', 'HOLY SHIT!! BLACKJACK!! WE\'RE RICH!!'),
  lose: tl('…ศูนย์เขียว ห่าเอ๊ย เจ้ามือกินเรียบ', '…green zero. Shit. The house takes it all.'),
  tbc: tl('โปรดติดตามตอนต่อไป', 'to be continued'),
  tbcIntro: tl('ใช่… นั่นพวกเราเอง', 'Yep… that\'s us.'),
};

export const SHOUT = {
  trip: [tl('เชี่ย!', 'Shit!'), tl('ไอ้บ้า! ใครเอาพรมมาวาง!', 'Who the hell put a rug here!')],
  win: [tl('เชี่ยยยย!!', 'HOLY SHIT!!'), tl('รวยแล้วโว้ย ไอ้เวร!!', 'We\'re rich, you bastards!!'), tl('แม่งเอ๊ย! แบล็คแจ็ค!!', 'Damn! BLACKJACK!!'), tl('ไอ้บ้า! ทำได้ไงวะ!', 'You madman! How?!')],
  drink: [tl('ฮิ๊ก… แม่งอร่อย', 'hic… damn that\'s good'), tl('อีกแก้ว! ไอ้เวร อีกแก้ว!', 'Another one, damn it!'), tl('ฮิ๊ก!', 'hic!'), tl('เจ้ามือเลี้ยง ห่าเอ๊ย!', 'House is buying, hell yeah!')],
  allin: [tl('ลงหมด! กลัวห่าอะไร!', 'All of it! What the hell are we scared of!'), tl('17! 17 แม่ง!', '17! Damn 17!')],
  spin: [tl('17… 17… 17…', '17… 17… 17…'), tl('มาเลย มาเลย มาเลย…', 'come on come on come on…')],
  lose: [tl('ห่าเอ๊ยยยย!!', 'SHIIIIT!!'), tl('ไอ้เวร… ศูนย์เขียว…', 'Damn… green zero…'), tl('แม่ง… หมดตัว', 'Shit… we\'re broke'), tl('เชี่ย… เงินเก็บกู…', 'Oh hell… my savings…')],
  pose: [tl('ยืนเฉยๆ ก็หล่อ', 'Just standing here, looking great'), tl('คืนนี้… บ่อนแตก', 'Tonight… we break the house')],
};

// ------------------------------------------------------------------ camera post-modifiers

interface Punch { t: number; dur: number; fovMul: number; shake: number }

export class CineCam {
  /** smooth handheld amount 0..1 */
  handheld = 0.35;
  private punches: Punch[] = [];
  private push: { t: number; dur: number; amt: number } | null = null;
  private time = 0;
  private hidden = new Set<THREE.Object3D>();
  private rollT = 0; private roll = 0;

  /** Crash zoom: FOV snaps tighter (fovMul < 1), holds, then relaxes; with a decaying shake. */
  crash(fovMul = 0.62, dur = 0.9, shake = 0.5) { this.punches.push({ t: 0, dur, fovMul, shake }); }
  /** Snap zoom: smaller, quicker punch. */
  snap(fovMul = 0.8, dur = 0.45) { this.punches.push({ t: 0, dur, fovMul, shake: 0.15 }); }
  /** Slow push-in (FOV narrows by amt over dur seconds). */
  pushIn(amt = 0.18, dur = 3) { this.push = { t: 0, dur, amt }; }
  dutch(rad: number) { this.rollT = rad; }
  clear() { this.punches = []; this.push = null; this.rollT = 0; }

  /** Apply on top of the authored camera (call after the beat's cam()). raw = real seconds. */
  apply(cam: THREE.PerspectiveCamera, raw: number) {
    this.time += raw;
    const t = this.time;
    let fovMul = 1, shake = 0;
    for (const p of this.punches) {
      p.t += raw;
      const k = p.t / p.dur;
      // in fast (≈80 ms), hold, ease out over the last 55 %
      const env = k < 0.09 ? 1 - (1 - k / 0.09) ** 3 : k < 0.45 ? 1 : 1 - smoothstep(0.45, 1, k);
      fovMul *= 1 + (p.fovMul - 1) * env;
      shake = Math.max(shake, p.shake * (1 - clamp01(k * 1.4)));
    }
    this.punches = this.punches.filter((p) => p.t < p.dur);
    if (this.push) {
      this.push.t += raw;
      const k = smoothstep(0, 1, this.push.t / this.push.dur);
      fovMul *= 1 - this.push.amt * k;
    }
    this.roll += (this.rollT - this.roll) * (1 - Math.exp(-raw * 3));
    // handheld: sum of slow sines (smooth, no per-frame random jitter)
    const h = this.handheld;
    const yaw = (Math.sin(t * 0.71) * 0.6 + Math.sin(t * 1.37 + 1.2) * 0.3) * 0.006 * h;
    const pit = (Math.sin(t * 0.53 + 0.4) * 0.6 + Math.sin(t * 1.91) * 0.25) * 0.005 * h;
    const rol = Math.sin(t * 0.43 + 2.1) * 0.004 * h;
    // shake: fast but continuous noise
    const sx = (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3) * 0.6) * 0.012 * shake;
    const sy = (Math.sin(t * 41.3 + 0.7) + Math.sin(t * 29.9 + 2.2) * 0.6) * 0.012 * shake;
    cam.rotateY(yaw + sx); cam.rotateX(pit + sy); cam.rotateZ(rol + this.roll + sx * 0.5);
    if (fovMul !== 1) { cam.fov *= fovMul; cam.updateProjectionMatrix(); }
  }

  /**
   * Film-set cheating: hide actors the lens is inside, or that block the subject from very close.
   * `subjects` are never hidden unless the lens is literally inside them.
   */
  cheat(cam: THREE.Camera, look: THREE.Vector3, actors: { root: THREE.Object3D }[], subjects: Set<THREE.Object3D>) {
    const c = cam.position;
    const toLook = look.clone().sub(c);
    const L = toLook.length();
    toLook.normalize();
    const q = new THREE.Vector3();
    for (const a of actors) {
      const r = a.root;
      const p = r.position;
      const dx = c.x - p.x, dz = c.z - p.z;
      const inside = dx * dx + dz * dz < 0.34 * 0.34 && c.y > p.y - 0.1 && c.y < p.y + 1.95;
      let block = false;
      if (!subjects.has(r) && !inside) {
        // nearest point on the lens→subject segment to the actor's chest/head axis, within 1.6 m of the lens
        for (const hy of [1.0, 1.55]) {
          q.set(p.x, p.y + hy, p.z);
          const s = q.clone().sub(c).dot(toLook);
          if (s < 0.05 || s > Math.min(1.6, L - 0.3)) continue;
          const d = c.clone().addScaledVector(toLook, s).distanceTo(q);
          if (d < 0.28) { block = true; break; }
        }
      }
      const hide = inside || block;
      if (hide && r.visible) { r.visible = false; this.hidden.add(r); }
      else if (!hide && this.hidden.has(r)) { r.visible = true; this.hidden.delete(r); }
    }
  }

  restoreAll() { for (const r of this.hidden) r.visible = true; this.hidden.clear(); }
}

export function smoothstep(a: number, b: number, v: number) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }

/** Catmull-Rom camera path through points, eased. */
export function path(points: THREE.Vector3[]) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return (k: number, out = new THREE.Vector3()) => c.getPoint(clamp01(k), out);
}

// ------------------------------------------------------------------ menace glyphs

/** Brush-stroke katakana ゴ (go) / ド (do) drawn on a canvas — no CJK font required. */
function drawGlyph(ctx: CanvasRenderingContext2D, kind: 'go' | 'do', S: number) {
  const stroke = (pts: [number, number][], w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)));
    ctx.stroke();
  };
  const body = (w: number) => {
    if (kind === 'go') {
      stroke([[0.16, 0.28], [0.72, 0.24], [0.7, 0.8]], w);    // top bar + right side (コ)
      stroke([[0.2, 0.8], [0.72, 0.78]], w);                   // bottom bar
    } else {
      stroke([[0.34, 0.14], [0.36, 0.88]], w);                 // ト stem
      stroke([[0.38, 0.42], [0.68, 0.6]], w);                  // ト tick
    }
    // dakuten (two short strokes, top right)
    stroke([[0.76, 0.08], [0.82, 0.22]], w * 0.62);
    stroke([[0.88, 0.04], [0.94, 0.18]], w * 0.62);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#120318'; body(S * 0.2);                 // dark outline
  ctx.strokeStyle = '#b02ad6'; body(S * 0.13);                // magenta-purple fill
  ctx.strokeStyle = 'rgba(255,190,255,0.85)'; ctx.save(); ctx.translate(-S * 0.012, -S * 0.016); body(S * 0.035); ctx.restore(); // highlight
}

const glyphTex: Partial<Record<'go' | 'do', THREE.Texture>> = {};
function glyphTexture(kind: 'go' | 'do') {
  let t = glyphTex[kind];
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.translate(S * 0.04, S * 0.06);
  ctx.scale(0.9, 0.9);
  drawGlyph(ctx, kind, S);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  glyphTex[kind] = t;
  return t;
}

interface Glyph { s: THREE.Sprite; t: number; life: number; base: number; vel: THREE.Vector3; ph: number }

export class Menace {
  group = new THREE.Group();
  private glyphs: Glyph[] = [];
  private emitters: { at: () => THREE.Vector3; kind: 'go' | 'do'; acc: number; rate: number; side: number }[] = [];
  constructor() { this.group.name = 'menace-glyphs'; this.group.renderOrder = 20; }

  /** Start emitting glyphs beside an actor (side = +1 right of camera, -1 left). */
  emit(at: () => THREE.Vector3, kind: 'go' | 'do' = 'go', rate = 2.4, side = 1) { this.emitters.push({ at, kind, acc: 0.9, rate, side }); }
  stop() { this.emitters = []; }
  clear() { this.stop(); for (const g of this.glyphs) g.s.removeFromParent(); this.glyphs = []; }

  /** raw: real seconds (glyphs keep drifting during freeze frames, like on the page). */
  update(raw: number, cam: THREE.Camera) {
    const right = V(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize();
    for (const e of this.emitters) {
      e.acc += raw * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const mat = new THREE.SpriteMaterial({ map: glyphTexture(e.kind), transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
        const s = new THREE.Sprite(mat);
        const p = e.at();
        const i = this.glyphs.length;
        p.addScaledVector(right, e.side * (0.55 + (i % 3) * 0.18)).add(V(0, -0.25 + (i % 4) * 0.22, 0));
        s.position.copy(p);
        s.renderOrder = 20;
        const base = 0.32 + (i % 3) * 0.07;
        this.group.add(s);
        this.glyphs.push({ s, t: 0, life: 1.9, base, vel: right.clone().multiplyScalar(e.side * 0.12).add(V(0, 0.28, 0)), ph: Math.random() * 6 });
      }
    }
    for (const g of this.glyphs) {
      g.t += raw;
      const k = g.t / g.life;
      g.s.position.addScaledVector(g.vel, raw);
      // pop in with overshoot, throb, fade out
      const pop = k < 0.12 ? (k / 0.12) * 1.25 : k < 0.2 ? 1.25 - ((k - 0.12) / 0.08) * 0.25 : 1;
      const throb = 1 + Math.sin(g.t * 9 + g.ph) * 0.06;
      g.s.scale.setScalar(g.base * pop * throb);
      (g.s.material as THREE.SpriteMaterial).rotation = Math.sin(g.t * 3 + g.ph) * 0.08 - 0.12;
      (g.s.material as THREE.SpriteMaterial).opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    }
    this.glyphs = this.glyphs.filter((g) => { if (g.t < g.life) return true; g.s.removeFromParent(); (g.s.material as THREE.Material).dispose(); return false; });
  }

  dispose() { this.clear(); }
}

// ------------------------------------------------------------------ DOM screen effects

export class ScreenFX {
  private root: HTMLDivElement;
  private invert: HTMLDivElement;
  private tint: HTMLDivElement;
  private sepia: HTMLDivElement;
  private lines: HTMLCanvasElement;
  private tbcEl: HTMLDivElement;
  private flashT = -1; private flashDur = 0.18;
  private linesOn = 0; private linesTarget = 0; private linesAcc = 0; private linesKind: 'focus' | 'speed' = 'focus';
  private tintOn = 0; private tintTarget = 0;
  private sepiaOn = 0; private sepiaTarget = 0;

  constructor() {
    // a direct child of <body> just under the overlay layer (.hp-ov is z-index 10 and its own stacking
    // context, so blend modes inside it could not reach the WebGL canvas); subtitles stay un-inverted
    const host = document.body;
    const r = (this.root = document.createElement('div'));
    r.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9';
    const layer = (css: string) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;inset:0;opacity:0;' + css; r.appendChild(d); return d; };
    // duotone "standing pose" grade: purple shadows / gold highlights
    this.tint = layer('background:linear-gradient(160deg,#5b1a8a 0%,#b0308e 45%,#e6a43a 100%);mix-blend-mode:color;');
    // sepia freeze (backdrop filter → real sepia of the frame; colour layer as a fallback)
    this.sepia = layer('backdrop-filter:sepia(1) contrast(1.15) brightness(0.92);-webkit-backdrop-filter:sepia(1) contrast(1.15) brightness(0.92);background:rgba(120,82,40,0.18);');
    this.lines = document.createElement('canvas');
    this.lines.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;';
    r.appendChild(this.lines);
    this.invert = layer('background:#fff;mix-blend-mode:difference;');
    // "to be continued" arrow (slides in from the left, bottom-left above the letterbox)
    const tbc = (this.tbcEl = document.createElement('div'));
    tbc.style.cssText = `position:absolute;left:3.5vw;bottom:calc(9vh + 2.4vh);transform:translateX(-120%);transition:transform .45s cubic-bezier(.2,1.4,.4,1);display:flex;align-items:center;filter:drop-shadow(0 3px 0 rgba(0,0,0,.55))`;
    tbc.innerHTML = `<svg viewBox="0 0 520 120" style="width:clamp(240px,30vw,460px);height:auto;display:block">
      <path d="M8 34 L410 34 L410 8 L512 60 L410 112 L410 86 L8 86 Z" fill="#3b2a16" stroke="#e9d7a8" stroke-width="5" stroke-linejoin="round"/>
      <text x="30" y="58" font-family=${JSON.stringify(F.heavy.replace(/"/g, ''))} font-weight="800" font-size="30" fill="#f3e6c0" letter-spacing="1">${CINE_LINES.tbc.th}</text>
      <text x="32" y="79" font-family=${JSON.stringify(F.ui.replace(/"/g, ''))} font-weight="700" font-size="17" fill="#d8c08a" letter-spacing="4">TO BE CONTINUED</text>
    </svg>`;
    (Overlay.root ?? r).appendChild(tbc);
    this.tbcHost = tbc;
    host.appendChild(r);
  }

  /** Colour-inverted flash (freeze frame hit). */
  flash(dur = 0.18) { this.flashT = 0; this.flashDur = dur; }
  focusLines(on: boolean, kind: 'focus' | 'speed' = 'focus') { this.linesTarget = on ? 1 : 0; this.linesKind = kind; }
  duotone(on: boolean) { this.tintTarget = on ? 0.62 : 0; }
  sepiaFreeze(on: boolean) { this.sepiaTarget = on ? 1 : 0; this.tbcEl.style.transform = on ? 'translateX(0)' : 'translateX(-120%)'; }

  update(raw: number) {
    // invert flash: on, double-blink, off
    if (this.flashT >= 0) {
      this.flashT += raw;
      const k = this.flashT / this.flashDur;
      this.invert.style.opacity = k < 0.45 ? '1' : k < 0.6 ? '0' : k < 1 ? '1' : '0';
      if (k >= 1) this.flashT = -1;
    }
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-raw * rate));
    this.tintOn = ease(this.tintOn, this.tintTarget, 10);
    this.tint.style.opacity = this.tintOn.toFixed(3);
    this.sepiaOn = this.sepiaTarget > this.sepiaOn ? this.sepiaTarget : ease(this.sepiaOn, this.sepiaTarget, 6);
    this.sepia.style.opacity = this.sepiaOn.toFixed(3);
    this.linesOn = ease(this.linesOn, this.linesTarget, 14);
    this.lines.style.opacity = (this.linesOn * 0.85).toFixed(3);
    if (this.linesOn > 0.02) {
      this.linesAcc += raw;
      if (this.linesAcc > 1 / 15) { this.linesAcc = 0; this.drawLines(); }   // manga lines re-ink at ~15 fps
    }
  }

  private drawLines() {
    const cv = this.lines;
    const w = Math.max(320, Math.round(innerWidth / 2)), h = Math.max(180, Math.round(innerHeight / 2));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.46;
    const R = Math.hypot(w, h) * 0.6;
    ctx.fillStyle = 'rgba(12,6,14,0.9)';
    const n = this.linesKind === 'focus' ? 110 : 70;
    for (let i = 0; i < n; i++) {
      if (this.linesKind === 'focus') {
        // radial focus lines: thin tapered wedges from the edge toward a clear centre
        const a = Math.random() * Math.PI * 2;
        const inner = R * (0.42 + Math.random() * 0.2);
        const wd = 0.004 + Math.random() * 0.012;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a - wd) * R, cy + Math.sin(a - wd) * R);
        ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a + wd) * R, cy + Math.sin(a + wd) * R);
        ctx.fill();
      } else {
        // horizontal speed lines
        const y = Math.random() * h, x = Math.random() * w * 0.6, L = w * (0.15 + Math.random() * 0.4), t = 0.6 + Math.random() * 2;
        ctx.fillRect(x, y, L, t);
      }
    }
  }

  private tbcHost: HTMLElement | null = null;
  dispose() { this.root.remove(); this.tbcHost?.remove(); }
}

/** Pick the first anim name the characters module knows (new cinematic poses fall back gracefully). */
export function animPicker(list: string[] | undefined) {
  const have = new Set(list ?? []);
  return (...names: string[]) => names.find((n) => have.has(n)) ?? names[names.length - 1];
}

export type { TL };
