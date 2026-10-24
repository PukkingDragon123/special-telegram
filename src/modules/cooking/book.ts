import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';
import { Ease } from '../../core/util';
import { RECIPES, RECIPE_IDS, DEFAULT_UNLOCKED, Recipe } from './recipes';
import { ING } from './data';
import { mulberry, pickKey } from './util';

/* =============================================================================================
 * THE OLD MAN'S RECIPE BOOK — the one deliberately lazy / ugly / human-made art asset (client).
 * Read with F (or LMB into the sky) while holding it: first person freezes, a 3D spiral notebook
 * fills the view, LMB / RMB flip pages (animated curl), F / Esc closes. Others see you holding the
 * open book (player mode 'book'). Locked recipes are scribbled "???".
 * ============================================================================================= */

const PW = 512, PH = 700;
const INK = '#1b2b6b', RED = '#a8201a', PENCIL = '#55524c';

function paper(c: CanvasRenderingContext2D, seed: number) {
  const r = mulberry(seed);
  c.fillStyle = '#f2ead4';
  c.fillRect(0, 0, PW, PH);
  // yellowing & grime blotches
  for (let i = 0; i < 26; i++) {
    const g = c.createRadialGradient(r() * PW, r() * PH, 0, r() * PW, r() * PH, 40 + r() * 160);
    g.addColorStop(0, `rgba(150,110,50,${0.03 + r() * 0.05})`);
    g.addColorStop(1, 'rgba(150,110,50,0)');
    c.fillStyle = g; c.fillRect(0, 0, PW, PH);
  }
  // ruled lines + margin
  c.strokeStyle = 'rgba(80,120,190,0.32)'; c.lineWidth = 1.4;
  for (let y = 92; y < PH - 20; y += 30) { c.beginPath(); c.moveTo(0, y + (r() - 0.5)); c.lineTo(PW, y + (r() - 0.5) * 2); c.stroke(); }
  c.strokeStyle = 'rgba(200,60,60,0.38)'; c.beginPath(); c.moveTo(64, 0); c.lineTo(66, PH); c.stroke();
  // coffee ring
  if (r() < 0.55) {
    const x = 120 + r() * 300, y = 140 + r() * 420, rr = 38 + r() * 26;
    c.strokeStyle = `rgba(110,70,30,${0.18 + r() * 0.15})`; c.lineWidth = 5 + r() * 4;
    c.beginPath(); c.arc(x, y, rr, r() * 2, r() * 2 + 5.4); c.stroke();
    c.fillStyle = 'rgba(120,80,40,0.06)'; c.beginPath(); c.arc(x, y, rr - 3, 0, 7); c.fill();
  }
  // oil splash dots (it's a kitchen book)
  for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(190,150,60,${0.08 + r() * 0.1})`; c.beginPath(); c.ellipse(r() * PW, r() * PH, 4 + r() * 12, 3 + r() * 9, r() * 3, 0, 7); c.fill(); }
}

/** Ballpoint handwriting with per-word jitter; returns the x where it ended. */
function scrawl(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, r: () => number, o: { color?: string; font?: string; maxW?: number; cross?: boolean } = {}) {
  c.save();
  c.fillStyle = o.color ?? INK;
  c.font = `400 ${size}px ${o.font ?? F.hand}, "Sarabun", sans-serif`;
  c.textBaseline = 'alphabetic';
  const seg: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;
  const words: string[] = seg ? [...seg.segment(text)].map((s: any) => s.segment) : text.split(/(\s+)/);
  let cx = x, cy = y;
  const maxW = o.maxW ?? PW - x - 20;
  for (const w of words) {
    const wdt = c.measureText(w).width;
    if (cx + wdt > x + maxW && cx > x) { cx = x + 8; cy += size * 1.25; }
    c.save();
    c.translate(cx, cy + (r() - 0.5) * size * 0.12);
    c.rotate((r() - 0.5) * 0.06);
    c.globalAlpha = 0.82 + r() * 0.18;
    c.fillText(w, 0, 0);
    c.restore();
    cx += wdt + (r() - 0.5) * 1.5;
  }
  if (o.cross) {
    c.strokeStyle = o.color ?? INK; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(x - 4, y - size * 0.3); c.lineTo(cx + 4, y - size * 0.36 + (r() - 0.5) * 6); c.stroke();
  }
  c.restore();
  return { x: cx, y: cy };
}

function wobblyLine(c: CanvasRenderingContext2D, pts: [number, number][], r: () => number, color = INK, w = 2.2) {
  c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => { const jx = x + (r() - 0.5) * 2.5, jy = y + (r() - 0.5) * 2.5; if (i === 0) c.moveTo(jx, jy); else c.lineTo(jx, jy); });
  c.stroke();
}

function doodle(c: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number, r: () => number) {
  const circ = (cx: number, cy: number, rr: number, n = 22, color = INK) => wobblyLine(c, Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * 6.283) * rr * (0.95 + r() * 0.1), cy + Math.sin(i / n * 6.283) * rr * (0.9 + r() * 0.1)] as [number, number]), r, color);
  switch (kind) {
    case 'wok':
      wobblyLine(c, Array.from({ length: 16 }, (_, i) => { const a = Math.PI * (i / 15); return [x - Math.cos(a) * s, y + Math.sin(a) * s * 0.5] as [number, number]; }), r);
      wobblyLine(c, [[x - s, y], [x + s, y]], r);
      wobblyLine(c, [[x + s, y], [x + s * 1.8, y - s * 0.25]], r, INK, 3);
      for (let i = 0; i < 3; i++) wobblyLine(c, [[x - s * 0.5 + i * s * 0.5, y + s * 0.7], [x - s * 0.6 + i * s * 0.5, y + s * 0.95], [x - s * 0.45 + i * s * 0.5, y + s * 1.15]], r, RED, 2);
      break;
    case 'chili':
      wobblyLine(c, [[x, y], [x + s * 0.4, y + s * 0.2], [x + s * 0.8, y + s * 0.6], [x + s, y + s * 1.1]], r, RED, 5);
      wobblyLine(c, [[x, y], [x - s * 0.15, y - s * 0.25]], r, '#2a6a2a', 3);
      break;
    case 'egg':
      circ(x, y, s, 26);
      circ(x + s * 0.1, y - s * 0.05, s * 0.36, 16, '#c88a10');
      break;
    case 'fire':
      wobblyLine(c, [[x - s, y], [x - s * 0.6, y - s * 0.9], [x - s * 0.2, y - s * 0.3], [x, y - s * 1.3], [x + s * 0.3, y - s * 0.4], [x + s * 0.65, y - s * 1.0], [x + s, y]], r, RED, 2.5);
      break;
    case 'face':
      circ(x, y, s);
      wobblyLine(c, [[x - s * 0.4, y - s * 0.2], [x - s * 0.3, y - s * 0.25]], r);
      wobblyLine(c, [[x + s * 0.3, y - s * 0.25], [x + s * 0.4, y - s * 0.2]], r);
      wobblyLine(c, [[x - s * 0.45, y + s * 0.3], [x, y + s * 0.5], [x + s * 0.45, y + s * 0.3]], r);
      break;
    case 'arrow':
      wobblyLine(c, [[x, y], [x + s, y + s * 0.2]], r, RED, 2.5);
      wobblyLine(c, [[x + s * 0.75, y - s * 0.1], [x + s, y + s * 0.2], [x + s * 0.7, y + s * 0.4]], r, RED, 2.5);
      break;
  }
}

function scribbleOut(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number) {
  c.strokeStyle = 'rgba(27,43,107,0.85)'; c.lineWidth = 2.5;
  c.beginPath();
  let cx = x, cy = y;
  c.moveTo(cx, cy);
  for (let i = 0; i < 26; i++) { cx = x + r() * w; cy = y + (i / 26) * h + (r() - 0.5) * 20; c.lineTo(cx, cy); }
  c.stroke();
}

function unitTH(k: string) { return ING[k]?.unit === 'ml' ? 'มล.' : 'ก.'; }

function drawIndex(c: CanvasRenderingContext2D, unlocked: string[], seed: number) {
  const r = mulberry(seed);
  paper(c, seed);
  scrawl(c, 'สารบัญ (มั้ง)', 90, 70, 40, r, { font: F.scrawl });
  let y = 140;
  RECIPE_IDS.forEach((id, i) => {
    const R = RECIPES[id];
    const ok = unlocked.includes(id);
    if (ok) scrawl(c, `${i + 1}. ${R.name.th} ........ หน้า ${i + 1}`, 82, y, 26, r);
    else { scrawl(c, `${i + 1}. ??? ........`, 82, y, 26, r, { color: PENCIL }); scribbleOut(c, 112, y - 22, 170, 26, r); }
    y += 46;
  });
  scrawl(c, '* ทำทีละจาน อย่าใจร้อน', 90, PH - 60, 24, r, { color: RED });
}

function drawIntro(c: CanvasRenderingContext2D, seed: number) {
  const r = mulberry(seed);
  paper(c, seed);
  scrawl(c, 'สมุดของเฮีย', 100, 86, 46, r, { font: F.scrawl });
  scrawl(c, 'ใครเก็บได้ช่วยคืนด้วย!!', 96, 128, 24, r, { color: RED });
  const lines = [
    'กฎของร้าน:',
    '1. ไฟต้องแรง กระทะต้องร้อน',
    '2. น้ำมันก่อน ค่อยใส่ของ',
    '3. ชั่งให้เป๊ะ (กรัม!) ป้ายมันบอก',
    '4. อย่าเผลอ เดี๋ยวไหม้',
    '5. ตักข้าวใส่จานก่อน แล้วค่อยตักกับ',
    '6. อย่าลืมช้อนส้อม ลูกค้าด่า',
  ];
  let y = 200;
  for (const l of lines) { scrawl(c, l, 84, y, 26, r); y += 44; }
  scrawl(c, 'ค้างค่าไข่ป้าศรี 35 บาท', 100, y + 30, 22, r, { cross: true, color: PENCIL });
  doodle(c, 'face', 380, 560, 40, r);
  doodle(c, 'wok', 160, 600, 46, r);
}

function drawRecipeLeft(c: CanvasRenderingContext2D, R: Recipe, ok: boolean, n: number, seed: number) {
  const r = mulberry(seed);
  paper(c, seed);
  if (!ok) {
    scrawl(c, '???', 120, 120, 70, r, { font: F.scrawl, color: PENCIL });
    scribbleOut(c, 80, 170, 360, 360, r);
    scrawl(c, 'ยังอ่านไม่ออก... (ปลดล็อกก่อน)', 90, 600, 24, r, { color: RED });
    return;
  }
  scrawl(c, `${n}. ${R.name.th}`, 80, 80, 44, r, { font: F.scrawl });
  scrawl(c, `(${R.name.en})`, 96, 116, 20, r, { color: PENCIL, font: F.hand2 });
  let y = 168;
  scrawl(c, 'ของที่ต้องใช้ (1 จาน):', 80, y, 26, r, { color: RED });
  y += 42;
  const rows: string[] = [];
  for (const [k, v] of Object.entries(R.ing)) rows.push(`${k === 'rice_cooked' ? 'ข้าวสวย' : k === 'egg_scr' ? 'ไข่ (คน)' : ING[k]?.name.th ?? k}  ${v.g} ก.${v.req ? ' !!' : ''}`);
  if (R.oil) rows.push(`น้ำมัน  ${R.oil} มล.`);
  for (const [k, g] of Object.entries(R.sa)) rows.push(`${ING[k]?.name.th ?? k}  ${g} ${unitTH(k)}`);
  if (R.water) rows.push(`น้ำเปล่า  ${R.water} มล.`);
  if (R.egg === 'main') rows.push('ไข่ 1 ฟอง');
  if (R.egg === 'omelet') rows.push('ไข่ 2 ฟอง');
  if (R.rice) rows.push(`ข้าวสวย ${R.rice} ก. (ใส่จาน)`);
  for (const row of rows) { scrawl(c, '- ' + row, 90, y, 25, r); y += 37; if (y > PH - 120) break; }
  scrawl(c, `ไฟ: ${R.heat.th}`, 90, Math.min(y + 18, PH - 70), 24, r, { color: RED });
  const dk = R.id === 'khai_dao' || R.id === 'khai_jiao' ? 'egg' : R.id === 'phat_phak_bung' ? 'fire' : r() < 0.5 ? 'chili' : 'wok';
  doodle(c, dk, 400, 120, 34, r);
}

function drawRecipeRight(c: CanvasRenderingContext2D, R: Recipe, ok: boolean, seed: number) {
  const r = mulberry(seed);
  paper(c, seed);
  if (!ok) { scribbleOut(c, 70, 90, 380, 520, r); scrawl(c, '???', 200, 380, 60, r, { font: F.scrawl, color: PENCIL }); return; }
  scrawl(c, 'วิธีทำ', 84, 76, 38, r, { font: F.scrawl });
  let y = 132;
  R.steps.forEach((s, i) => {
    const end = scrawl(c, `${i + 1}) ${s}`, 76, y, 24, r, { maxW: PW - 100 });
    y = end.y + 40;
  });
  if (R.note) { scrawl(c, '★ ' + R.note, 84, Math.min(y + 10, PH - 90), 23, r, { color: RED, maxW: PW - 110 }); }
  if (R.price) scrawl(c, `ขาย ~${R.price} บาท (ถูกไปมั้ย?)`, 200, PH - 34, 22, r, { color: PENCIL });
  if (r() < 0.6) doodle(c, 'arrow', 380, PH - 120, 50, r);
}

// ------------------------------------------------------------------ 3D book

export class RecipeBook {
  private group: THREE.Group | null = null;
  private left!: THREE.Mesh; private right!: THREE.Mesh; private flipper!: THREE.Mesh;
  private flipGeo!: THREE.BufferGeometry; private flipBase!: Float32Array;
  private cache = new Map<string, THREE.CanvasTexture>();
  open = false;
  private bookId = -1;
  private spread = 0;
  private flip: { dir: number; t: number; to: number } | null = null;
  private t = 0;
  private openK = 0;

  constructor(private game: Game) {}

  private unlocked(): string[] {
    const u = this.game.g.unlocks?.recipes;
    return Array.isArray(u) && u.length ? u : DEFAULT_UNLOCKED;
  }
  private spreads() { return 1 + RECIPE_IDS.length; }
  private pageTex(spread: number, side: 0 | 1): THREE.CanvasTexture {
    const unl = this.unlocked();
    const key = `${spread}:${side}:${unl.join(',')}`;
    let t = this.cache.get(key);
    if (t) return t;
    const cv = document.createElement('canvas');
    cv.width = PW; cv.height = PH;
    const c = cv.getContext('2d')!;
    const seed = 1000 + spread * 7 + side;
    if (spread === 0) { if (side === 0) drawIntro(c, seed); else drawIndex(c, unl, seed); }
    else {
      const id = RECIPE_IDS[spread - 1];
      const R = RECIPES[id];
      const ok = unl.includes(id);
      if (side === 0) drawRecipeLeft(c, R, ok, spread, seed); else drawRecipeRight(c, R, ok, seed);
    }
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.cache.set(key, t);
    if (this.cache.size > 10) { const k0 = this.cache.keys().next().value; if (k0 && k0 !== key) { this.cache.get(k0)?.dispose(); this.cache.delete(k0); } }
    return t;
  }

  private build() {
    const g = new THREE.Group();
    g.name = 'recipebook';
    const W = 0.2, H = 0.27;
    const pageGeo = (sign: number) => {
      const p = new THREE.PlaneGeometry(W, H, 12, 1);
      const pos = p.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + W / 2; // 0 at spine → W at edge
        const u = x / W;
        pos.setX(i, sign * x);
        pos.setZ(i, Math.sin(Math.min(1, u * 2.2) * Math.PI / 2) * 0.012 - u * 0.004);
      }
      if (sign < 0) { const uv = p.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
      p.computeVertexNormals();
      return p;
    };
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xf4f0e6, side: THREE.DoubleSide });
    this.left = new THREE.Mesh(pageGeo(-1), mat());
    this.right = new THREE.Mesh(pageGeo(1), mat());
    g.add(this.left, this.right);
    // the turning page
    this.flipGeo = pageGeo(1);
    this.flipBase = new Float32Array((this.flipGeo.getAttribute('position') as THREE.BufferAttribute).array);
    this.flipper = new THREE.Mesh(this.flipGeo, new THREE.MeshBasicMaterial({ color: 0xf4f0e6, side: THREE.DoubleSide }));
    this.flipper.visible = false;
    g.add(this.flipper);
    // cover boards + spiral
    const cover = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.03, H + 0.02, 0.004), new THREE.MeshBasicMaterial({ color: 0x8a2a1a }));
    cover.position.z = -0.006;
    g.add(cover);
    const ringG = new THREE.TorusGeometry(0.009, 0.0016, 4, 10);
    const ringM = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });
    for (let i = 0; i < 12; i++) { const ring = new THREE.Mesh(ringG, ringM); ring.rotation.y = Math.PI / 2; ring.position.set(0, -H / 2 + 0.015 + i * 0.022, 0.004); g.add(ring); }
    g.traverse((o: any) => { if (o.isMesh) { o.renderOrder = 2000; o.material.depthTest = false; o.raycast = () => {}; } });
    this.group = g;
    return g;
  }

  private setSpread(s: number) {
    this.spread = Math.max(0, Math.min(this.spreads() - 1, s));
    (this.left.material as THREE.MeshBasicMaterial).map = this.pageTex(this.spread, 0);
    (this.right.material as THREE.MeshBasicMaterial).map = this.pageTex(this.spread, 1);
    (this.left.material as THREE.Material).needsUpdate = true;
    (this.right.material as THREE.Material).needsUpdate = true;
  }

  openBook(bookId: number) {
    const game = this.game;
    if (this.open || !game.player || !game.camera) return;
    const book = game.state.get(bookId);
    this.bookId = bookId;
    this.open = true;
    this.openK = 0;
    game.intent('cook.read', { on: true });
    game.player.setMode('frozen');
    game.items.viewModel.visible = false;
    if (!this.group) this.build();
    game.camera.add(this.group!);
    this.setSpread(book?.data?.page ?? 0);
    Sound.play(pickKey(['book_open', 'page_turn']), { vol: 0.7 });
    game.interact.hintOnce('cook.book', 'พลิกหน้า: [คลิก] / [คลิกขวา] · ปิด: [F]', 5);
  }

  close() {
    const game = this.game;
    if (!this.open) return;
    this.open = false;
    this.group?.removeFromParent();
    game.items.viewModel.visible = true;
    game.intent('cook.read', { on: false });
    if (game.player && game.player.mode === 'frozen') game.player.setMode('play');
    const book = game.state.get(this.bookId);
    if (book && book.holder === game.localPlayerId && (book.data?.page ?? 0) !== this.spread) game.intent('cook.page', { page: this.spread });
    Sound.play(pickKey(['page_turn', 'book_open']), { vol: 0.5, pitch: 0.8 });
  }

  private turn(dir: number) {
    if (this.flip) return;
    const to = this.spread + dir;
    if (to < 0 || to >= this.spreads()) { Sound.play(pickKey(['paper_rustle', 'page_turn']), { vol: 0.3, pitch: 1.4 }); return; }
    this.flip = { dir, t: 0, to };
    const fm = this.flipper.material as THREE.MeshBasicMaterial;
    // the page that turns shows the old right page (forward) or new right page (back)
    fm.map = dir > 0 ? this.pageTex(this.spread, 1) : this.pageTex(to, 1);
    fm.needsUpdate = true;
    if (dir > 0) { (this.right.material as THREE.MeshBasicMaterial).map = this.pageTex(to, 1); }
    else { (this.left.material as THREE.MeshBasicMaterial).map = this.pageTex(to, 0); }
    (this.right.material as THREE.Material).needsUpdate = true;
    (this.left.material as THREE.Material).needsUpdate = true;
    this.flipper.visible = true;
    Sound.play(pickKey(['page_turn']), { vol: 0.7 });
  }

  frame(dt: number) {
    if (!this.open) return;
    const game = this.game;
    this.t += dt;
    const me = game.me;
    const book = game.state.get(this.bookId);
    // closed by others (snatched), resumed from pause, or book gone
    if (!me || !book || book.holder !== me.id || (game.player && game.player.mode !== 'frozen') || (this.openK > 0.5 && me.mode !== 'book' && this.t > 1.5)) { this.close(); return; }
    if (Input.wasPressed('KeyF') || Input.wasPressed('Escape')) { Input.consume('KeyF'); this.close(); return; }
    if (Input.mousePressed(0)) { Input.consumeMouse(0); this.turn(1); }
    if (Input.mousePressed(2)) { Input.consumeMouse(2); this.turn(-1); }
    this.openK = Math.min(1, this.openK + dt * 3.2);
    const k = Ease.outBack(this.openK, 1.2);
    const g = this.group!;
    const aspect = game.camera.aspect || 1.7;
    const fit = Math.min(1, aspect / 1.35);
    g.position.set(0, -0.012 - (1 - k) * 0.25 + Math.sin(this.t * 1.3) * 0.002, -0.34);
    g.rotation.set(-0.08 + (1 - k) * 0.6, 0, Math.sin(this.t * 0.9) * 0.006);
    g.scale.setScalar(fit);
    // page flip animation
    if (this.flip) {
      this.flip.t += dt / 0.42;
      const p = Math.min(1, this.flip.t);
      const e = Ease.inOutCubic(p);
      const ang = this.flip.dir > 0 ? e * Math.PI : (1 - e) * Math.PI;
      const pos = this.flipGeo.getAttribute('position') as THREE.BufferAttribute;
      const base = this.flipBase;
      const curl = Math.sin(e * Math.PI) * 0.35;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const u = x / 0.2;
        const a = ang + curl * u * (this.flip.dir > 0 ? 1 : -1);
        pos.setXYZ(i, Math.cos(a) * x, y, Math.sin(a) * x * 0.9 + 0.003);
      }
      pos.needsUpdate = true;
      this.flipGeo.computeVertexNormals();
      if (p >= 1) {
        this.flipper.visible = false;
        this.setSpread(this.flip.to);
        this.flip = null;
      }
    }
  }
}
