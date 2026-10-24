import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { Ease, tl } from '../../core/util';
import { canvasTexture } from '../../ui3d/text';
import { allRecipeIds, recipeInfo, unlockedRecipes, DEFAULT_EXTRAS } from './data';

/* =============================================================================================
 * MENU POSTER (real laminated อาหารตามสั่ง photo menu from img/posters, prices written into its
 * yellow price circles) + the diegetic close-up where players toggle dishes & set prices, and the
 * real-chalkboard เปิด/ปิด sign faces.
 * ============================================================================================= */

const POSTER = 'img/posters/menu_laminated_photo.png';
const CHALK = 'img/posters/aframe_chalkboard.jpg';
/** recipe order of the poster's 10 photo slots */
export const SLOT_RECIPES = ['kaphrao_moo', 'khai_dao', 'khai_jiao', 'khao_phat', 'phat_phrik_kaeng', 'phat_si_io', 'rat_na', 'tom_yam', 'moo_kratiam', 'phat_phak_bung'];
interface Slot { price: { x: number; y: number; w: number; h: number; cx: number; cy: number; size: number; color: string }; hit: { x: number; y: number; w: number; h: number } }
let slots: Slot[] = [];
let manifestReq = false;
let posterImg: HTMLImageElement | null = null;
let chalkImg: HTMLImageElement | null = null;
const PW = 1500, PH = 1076;
const EXTRA_BOXES: { k: string; x: number; w: number; th: string }[] = [
  { k: 'egg', x: 175, w: 190, th: 'ไข่ดาว' }, { k: 'special', x: 380, w: 190, th: 'พิเศษ' }, { k: 'soda', x: 585, w: 250, th: 'น้ำอัดลม' },
];

function loadAssets(onReady: () => void) {
  if (manifestReq) return;
  manifestReq = true;
  Assets.jsonSafe<any>('img/posters/manifest.json', null).then((m) => {
    const s = m?.files?.['menu_laminated_photo.png']?.regions?.slots;
    if (Array.isArray(s)) slots = s;
    onReady();
  });
  Assets.image(POSTER).then((im) => { posterImg = im; onReady(); }).catch(() => {});
  Assets.image(CHALK).then((im) => { chalkImg = im; onReady(); }).catch(() => {});
}

// ------------------------------------------------------------------ poster canvas

const cv = document.createElement('canvas');
cv.width = 1200; cv.height = Math.round(1200 * PH / PW);
let tex: THREE.CanvasTexture | null = null;
let posterMat: THREE.MeshStandardMaterial | null = null;
let lastSig = '';

export function menuSig(game: Game) { return JSON.stringify([game.g.menu ?? null, unlockedRecipes(game)]); }

function drawPoster(game: Game) {
  const c = cv.getContext('2d')!;
  const k = cv.width / PW;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (posterImg) c.drawImage(posterImg, 0, 0, cv.width, cv.height);
  else { c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, cv.width, cv.height); }
  c.setTransform(k, 0, 0, k, 0, 0);
  const menu = game.g.menu ?? {};
  const unl = unlockedRecipes(game);
  SLOT_RECIPES.forEach((rid, i) => {
    const s = slots[i];
    if (!s) return;
    const on = menu[rid] !== undefined;
    const price = menu[rid] ?? game.g.menuPrices?.[rid] ?? recipeInfo(game, rid).price;
    const P = s.price, H = s.hit;
    if (!unl.includes(rid)) {
      // not on the menu yet: greyed photo + marker scribble "เร็วๆ นี้"
      c.fillStyle = 'rgba(240,238,230,0.72)'; c.fillRect(H.x, H.y, H.w, H.h);
      c.save(); c.translate(H.x + H.w / 2, H.y + H.h * 0.42); c.rotate(-0.18);
      c.font = `400 54px ${F.scrawl}`; c.fillStyle = '#1b2b6b'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('เร็วๆ นี้', 0, 0); c.restore();
      return;
    }
    // price in the yellow circle (looped heavy numerals, like the printed example)
    c.save();
    c.font = `900 ${P.size + 4}px ${F.looped}`; c.fillStyle = P.color ?? '#D41E2A'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.translate(P.cx, P.cy + 8); c.scale(0.8, 1);
    c.fillText(String(price), 0, 0); c.restore();
    c.font = `700 22px ${F.looped}`; c.fillStyle = P.color ?? '#D41E2A'; c.textAlign = 'center'; c.fillText('บาท', P.cx, P.cy + 38);
    if (!on) {
      // sold out: big red marker cross + "หมด"
      c.save(); c.strokeStyle = 'rgba(200,20,20,0.85)'; c.lineWidth = 12; c.lineCap = 'round';
      c.beginPath(); c.moveTo(H.x + 30, H.y + 40); c.lineTo(H.x + H.w - 30, H.y + H.h - 120); c.moveTo(H.x + H.w - 30, H.y + 40); c.lineTo(H.x + 30, H.y + H.h - 120); c.stroke();
      c.translate(H.x + H.w / 2, H.y + H.h * 0.38); c.rotate(-0.12);
      c.font = `400 92px ${F.scrawl}`; c.fillStyle = '#c8141a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('หมด', 0, 0);
      c.restore();
    }
  });
  // extras bar: repaint the printed add-ons with the live prices
  const ex = { ...DEFAULT_EXTRAS, ...(menu.extras ?? {}) };
  c.fillStyle = '#1e1e1f'; c.fillRect(70, 972, 800, 52);
  c.font = `700 32px ${F.looped}`; c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText('เพิ่ม:', 78, 999);
  for (const b of EXTRA_BOXES) c.fillText(`${b.th} ${b.k === 'soda' ? '' : '+'}${ex[b.k as keyof typeof ex]}`, b.x, 999);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (tex) tex.needsUpdate = true;
}

export function posterMaterial(game: Game) {
  if (!posterMat) {
    tex = canvasTexture(cv);
    posterMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0 });
    loadAssets(() => { lastSig = ''; });
    drawPoster(game);
  }
  return posterMat;
}

/** Call every frame: redraws the poster texture when the menu/unlocks change. */
export function refreshPosters(game: Game) {
  if (signDirty && chalkImg && signMats) drawSigns();
  if (!posterMat) return;
  const sig = menuSig(game) + (posterImg ? 1 : 0) + slots.length;
  if (sig !== lastSig) { lastSig = sig; drawPoster(game); }
}

// ------------------------------------------------------------------ chalkboard open/closed sign

let signMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] | null = null;
const signCv = [document.createElement('canvas'), document.createElement('canvas')];
let signDirty = true;
function drawSigns() {
  signDirty = false;
  const texts: [string, string][] = [['เปิด', 'OPEN แล้วจ้า'], ['ปิด', 'พรุ่งนี้มาใหม่นะ']];
  signCv.forEach((s, i) => {
    s.width = 512; s.height = 320;
    const c = s.getContext('2d')!;
    // real chalkboard photo: the empty price column, rotated to landscape
    if (chalkImg) { c.save(); c.translate(256, 160); c.rotate(Math.PI / 2); c.drawImage(chalkImg, 600, 270, 270, 500, -170, -270, 340, 540); c.restore(); }
    else { c.fillStyle = '#2b2d2a'; c.fillRect(0, 0, 512, 320); }
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `400 170px ${F.scrawl}`; c.fillStyle = i === 0 ? '#f6f3e6' : '#f2c9c0';
    c.translate(256, 140); c.rotate(-0.05); c.fillText(texts[i][0], 0, 0); c.restore();
    c.font = `400 44px ${F.scrawl}`; c.fillStyle = '#f0e7a8'; c.textAlign = 'center'; c.fillText(texts[i][1], 256, 272);
    // chalk grain: knock out tiny speckles from the strokes
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 2600; k++) { c.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.4})`; c.fillRect(Math.random() * 512, Math.random() * 320, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    c.globalCompositeOperation = 'destination-over';
    if (chalkImg) { c.save(); c.translate(256, 160); c.rotate(Math.PI / 2); c.drawImage(chalkImg, 600, 270, 270, 500, -170, -270, 340, 540); c.restore(); }
    c.globalCompositeOperation = 'source-over';
  });
  if (signMats) for (const m of signMats) if (m.map) m.map.needsUpdate = true;
}
export function signMaterials(game: Game): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  if (!signMats) {
    loadAssets(() => { signDirty = true; lastSig = ''; });
    drawSigns(); signDirty = true;
    signMats = signCv.map((s) => new THREE.MeshStandardMaterial({ map: canvasTexture(s), roughness: 0.9 })) as any;
  }
  void game;
  return signMats!;
}

// ------------------------------------------------------------------ close-up editor (local)

export class MenuCloseup {
  private group = new THREE.Group();
  private board: THREE.Mesh;
  private hi: THREE.Mesh;
  private dot: THREE.Mesh;
  private note: THREE.Mesh;
  private noteCv = document.createElement('canvas');
  private noteTex: THREE.CanvasTexture;
  private cur = new THREE.Vector2(0.5, 0.5);
  private t = 0;
  private closing = -1;
  private lastNote = '';
  open = true;
  private W = 0.74;
  private H = 0.74 * PH / PW;

  constructor(private game: Game, private onClose: () => void) {
    const cam = game.camera;
    const mk = (m: THREE.Material) => { (m as any).depthTest = false; (m as any).depthWrite = false; (m as any).transparent = true; return m; };
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.H), mk(new THREE.MeshBasicMaterial({ map: posterMaterial(game).map, toneMapped: false })));
    this.board.renderOrder = 3000;
    this.hi = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mk(new THREE.ShaderMaterial({
      transparent: true, uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uT; varying vec2 vUv; void main(){ vec2 d=min(vUv,1.0-vUv); float e=min(d.x,d.y); float a=smoothstep(0.035,0.0,e)*(0.65+0.35*sin(uT*6.0)); gl_FragColor=vec4(1.0,0.82,0.15,a); }',
    })));
    this.hi.renderOrder = 3001;
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), mk(new THREE.MeshBasicMaterial({ color: 0xd41e2a, toneMapped: false })));
    this.dot.renderOrder = 3002;
    this.noteCv.width = 640; this.noteCv.height = 150;
    this.noteTex = canvasTexture(this.noteCv);
    this.note = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42 * 150 / 640), mk(new THREE.MeshBasicMaterial({ map: this.noteTex, toneMapped: false })));
    this.note.renderOrder = 3003;
    this.note.position.set(0.18, -this.H / 2 - 0.035, 0.01);
    this.note.rotation.z = 0.03;
    this.group.add(this.board, this.hi, this.dot, this.note);
    this.group.position.set(0, -0.015, -0.53);
    cam.add(this.group);
    Sound.play('paper_rustle', { vol: 0.7 });
    game.player?.setMode('frozen');
  }

  /** hovered element in poster px */
  private hover(): { kind: 'dish' | 'price' | 'extra' | null; i: number; key?: string } {
    const x = this.cur.x * PW, y = (1 - this.cur.y) * PH;
    if (y > 960 && y < 1035) for (const b of EXTRA_BOXES) if (x >= b.x - 10 && x <= b.x + b.w) return { kind: 'extra', i: -1, key: b.k };
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const P = s.price;
      if (Math.hypot(x - P.cx, y - P.cy) < 60) return { kind: 'price', i };
      const H = s.hit;
      if (x >= H.x && x <= H.x + H.w && y >= H.y && y <= H.y + H.h) return { kind: 'dish', i };
    }
    return { kind: null, i: -1 };
  }

  private writeNote(text: string, sub: string) {
    const key = text + sub;
    if (key === this.lastNote) return;
    this.lastNote = key;
    const c = this.noteCv.getContext('2d')!;
    c.clearRect(0, 0, 640, 150);
    c.fillStyle = '#f7e98a'; c.fillRect(6, 6, 628, 138);
    c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(6, 132, 628, 12);
    c.fillStyle = '#1b2b6b'; c.font = `400 40px ${F.hand}`; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(text, 22, 16);
    c.fillStyle = '#4a3a2a'; c.font = `400 27px ${F.hand}`; c.fillText(sub, 22, 84);
    this.noteTex.needsUpdate = true;
  }

  close() {
    if (this.closing >= 0) return;
    this.closing = 0;
    Sound.play('paper_rustle', { vol: 0.5, pitch: 1.2 });
  }

  update(dt: number) {
    const game = this.game;
    this.t += dt;
    (this.hi.material as THREE.ShaderMaterial).uniforms.uT.value = this.t;
    if (this.closing >= 0) {
      this.closing += dt;
      const k = Math.min(1, this.closing / 0.25);
      this.group.position.y = -0.02 - Ease.inQuad(k) * 0.7;
      if (k >= 1) { this.dispose(); return false; }
      return true;
    }
    const k = Math.min(1, this.t / 0.3);
    this.group.position.y = -0.02 - (1 - Ease.outBack(k)) * 0.6;
    // mouse moves the marker cursor; swallow the look delta so the camera stays put
    this.cur.x = Math.max(0, Math.min(1, this.cur.x + Input.mouseDX * 0.0011));
    this.cur.y = Math.max(0, Math.min(1, this.cur.y - Input.mouseDY * 0.0015));
    Input.mouseDX = 0; Input.mouseDY = 0;
    const wheel = Input.wheel; Input.wheel = 0;
    this.dot.position.set((this.cur.x - 0.5) * this.W, (this.cur.y - 0.5) * this.H, 0.002);
    const h = this.hover();
    const menu = game.g.menu ?? {};
    const unl = unlockedRecipes(game);
    const zone = game.world?.zoneAt(cartPos(game));
    const pf = zone?.priceFactor ?? 1;
    this.hi.visible = false;
    if (h.kind === 'dish' || h.kind === 'price') {
      const s = slots[h.i], rid = SLOT_RECIPES[h.i];
      const H = s.hit;
      this.hi.visible = true;
      this.hi.scale.set(H.w / PW * this.W, H.h / PH * this.H, 1);
      this.hi.position.set(((H.x + H.w / 2) / PW - 0.5) * this.W, (0.5 - (H.y + H.h / 2) / PH) * this.H, 0.001);
      const info = recipeInfo(game, rid);
      const fair = Math.round(info.price * pf / 5) * 5;
      if (!unl.includes(rid)) this.writeNote(`${info.name.th}: ยังทำไม่เป็น`, 'ต้องปลดล็อกสูตรก่อน (locked)');
      else {
        const on = menu[rid] !== undefined;
        const price = menu[rid] ?? game.g.menuPrices?.[rid] ?? info.price;
        this.writeNote(`${info.name.th} ${price}.- ${on ? '' : '(หมด)'}`, `แถว${zone?.name.th ?? 'นี้'} ราคากลาง ~${fair}.-  · คลิก=${h.kind === 'price' ? '+5' : on ? 'ปิดเมนู' : 'เปิดเมนู'} คลิกขวา=-5`);
        if (Input.mousePressed(0)) { Input.consumeMouse(0); if (h.kind === 'price') game.intent('rest.menu', { op: 'price', r: rid, d: 5 }); else game.intent('rest.menu', { op: 'toggle', r: rid }); Sound.play(h.kind === 'price' ? 'pickup' : 'paper_rustle', { vol: 0.4, pitch: 1.4 }); }
        if (Input.mousePressed(2)) { Input.consumeMouse(2); game.intent('rest.menu', { op: 'price', r: rid, d: -5 }); Sound.play('pickup', { vol: 0.4, pitch: 1.1 }); }
        if (wheel) { game.intent('rest.menu', { op: 'price', r: rid, d: -wheel * 5 }); Sound.play('pickup', { vol: 0.3, pitch: 1.3 }); }
      }
    } else if (h.kind === 'extra') {
      const ex = { ...DEFAULT_EXTRAS, ...(menu.extras ?? {}) } as any;
      const b = EXTRA_BOXES.find((x) => x.k === h.key)!;
      this.hi.visible = true;
      this.hi.scale.set(b.w / PW * this.W, 60 / PH * this.H, 1);
      this.hi.position.set(((b.x + b.w / 2 - 10) / PW - 0.5) * this.W, (0.5 - 999 / PH) * this.H, 0.001);
      this.writeNote(`${b.th} ${ex[b.k]}.-`, 'คลิก/ล้อเมาส์ = ปรับราคา ±5  · E = เสร็จ');
      if (Input.mousePressed(0)) { Input.consumeMouse(0); game.intent('rest.menu', { op: 'extra', k: b.k, d: 5 }); Sound.play('pickup', { vol: 0.4, pitch: 1.4 }); }
      if (Input.mousePressed(2)) { Input.consumeMouse(2); game.intent('rest.menu', { op: 'extra', k: b.k, d: -5 }); Sound.play('pickup', { vol: 0.4, pitch: 1.1 }); }
      if (wheel) game.intent('rest.menu', { op: 'extra', k: b.k, d: -wheel * 5 });
    } else {
      const n = Object.keys(menu).filter((k) => k !== 'extras').length;
      this.writeNote(`เมนูวันนี้ ${n} อย่าง`, 'ชี้รูปอาหาร: คลิก=เปิด/ปิด · วงเหลือง=ราคา · E/F=เสร็จ');
    }
    if (Input.wasPressed('KeyE') || Input.wasPressed('KeyF') || Input.wasPressed('KeyQ') || Input.wasPressed('Escape') || Input.wasPressed('Tab')) {
      Input.consume('KeyE'); Input.consume('KeyF'); Input.consume('KeyQ');
      this.close();
    }
    return true;
  }

  dispose() {
    this.group.removeFromParent();
    this.board.geometry.dispose(); this.hi.geometry.dispose(); this.dot.geometry.dispose(); this.note.geometry.dispose();
    this.noteTex.dispose();
    this.open = false;
    if (this.game.player?.mode === 'frozen') this.game.player.setMode('play');
    this.onClose();
  }
}

export function cartPos(game: Game): number[] {
  const c = game.state.find('cart', () => true);
  return c?.p ?? game.world?.anchor('cart_start').p ?? [4.9, 0.15, -23];
}

/** HOST: apply a menu edit. */
export function applyMenuEdit(game: Game, d: { op: string; r?: string; k?: string; d?: number }) {
  const g = game.g;
  const menu = { ...(g.menu ?? {}) };
  const prices = { ...(g.menuPrices ?? {}) };
  const clampP = (v: number) => Math.max(5, Math.min(300, Math.round(v / 5) * 5));
  if (d.op === 'toggle' && d.r && unlockedRecipes(game).includes(d.r)) {
    if (menu[d.r] !== undefined) { prices[d.r] = menu[d.r]; delete menu[d.r]; }
    else menu[d.r] = prices[d.r] ?? recipeInfo(game, d.r).price;
  } else if (d.op === 'price' && d.r && unlockedRecipes(game).includes(d.r)) {
    if (menu[d.r] !== undefined) menu[d.r] = clampP(menu[d.r] + (d.d ?? 0));
    else prices[d.r] = clampP((prices[d.r] ?? recipeInfo(game, d.r).price) + (d.d ?? 0));
  } else if (d.op === 'extra' && d.k) {
    const ex = { ...DEFAULT_EXTRAS, ...(menu.extras ?? {}) } as any;
    ex[d.k] = Math.max(0, Math.min(100, Math.round(((ex[d.k] ?? 0) + (d.d ?? 0)) / 5) * 5));
    menu.extras = ex;
  }
  g.menu = menu;
  g.menuPrices = prices;
  void allRecipeIds; void tl;
}
