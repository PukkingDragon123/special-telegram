import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { AnimName, CharacterRig, Expression, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { buildCartModel } from '../cooking/cart';
import { Studio, settle, photo, hashStr, type ShotOpts } from './studio';

/* ============================================================================================
 * The poster set, laid out like real Thai printed bills (muay thai fight cards, luk thung vinyl
 * banners, election posters, shop notices): flat solid colour blocks, real photos, clean cut-outs of
 * the game's own 3D models (studio renders, natural light) and plain type — Sarabun ExtraBold for
 * headlines, IBM Plex Sans Thai Looped for body, solid fill only. No outlines, glows, gradients,
 * halftone, grunge or other "effects". Backdrops: real CC0 photos (references/credits/posters.md).
 * Original parodies only: no real people, brands or characters.
 * Run via scripts/posters.mjs (?only=characters,cooking,posters&posters=gen) → public/assets/gen/posters.
 * ========================================================================================== */

export const PW = 640, PH = 904;

export interface PosterDef { id: string; cat: string; draw: (c: Ctx) => Promise<void> }
interface Ctx { g: CanvasRenderingContext2D; game: Game; st: Studio; seed: number; paper?: null }

const SRC = (n: string) => '/scripts/posters-src/' + n;
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
function img(url: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    imgCache.set(url, p);
  }
  return p;
}
const asset = (p: string) => Assets.image(p).catch(() => null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** wait until every texture / model the last builds asked for has arrived */
async function loaded(maxMs = 20000) {
  const t0 = performance.now();
  await sleep(250);
  while (Assets.pending > 0 && performance.now() - t0 < maxMs) await sleep(150);
  await sleep(200);
}

// ------------------------------------------------------------------ 3D cut-outs

interface PersonOpts { anim?: AnimName; expr?: Expression; yaw?: number; seed?: number; look?: Partial<Look>; hold?: 'wok' | 'mic' | 'plate' | null; t?: number; speed?: number }

async function person(game: Game, arche: string, o: PersonOpts = {}): Promise<CharacterRig> {
  const base = arche === 'player' ? game.chars.playerLook(0) : game.chars.randomLook(arche, o.seed ?? 7);
  const look = { ...base, ...(o.look ?? {}) } as Look;
  const rig = game.chars.create(look, { lod: 'high', castShadow: false });
  rig.root.rotation.y = o.yaw ?? 0;
  if (o.hold) {
    const hand = rig.attach('hand_r');
    let obj: THREE.Object3D | null = null;
    if (o.hold === 'wok') {
      const def = game.items.def('wok');
      try { obj = def ? def.build({ id: -1, k: 'wok', data: {} } as any, game) : null; } catch { obj = null; }
      if (obj) { obj.rotation.set(0, Math.PI / 2, 0); obj.position.set(0.0, -0.02, 0.05); }
      rig.setCarry({ r: true, l: false, two: false, head: false, load: 0.1, gripR: 'handle' } as any);
    } else if (o.hold === 'mic') {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.17, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.35 }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 12), new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 0.9, roughness: 0.3 }));
      head.position.y = 0.1; m.add(body, head);
      m.rotation.set(-0.6, 0, 0);
      obj = m;
      rig.setCarry({ r: true, l: false, two: false, head: false, load: 0, gripR: 'bottle' } as any);
    } else if (o.hold === 'plate') {
      obj = dish(game, {});
      if (obj) { obj.position.set(0, 0.02, 0.06); }
      rig.setCarry({ r: true, l: false, two: false, head: false, load: 0.1, gripR: 'plate' } as any);
    }
    if (obj) hand.add(obj);
  }
  if (o.anim) rig.play(o.anim, { loop: true, speed: o.speed ?? 1 });
  if (o.expr) rig.setExpression?.(o.expr, { weight: 1 });
  await loaded();
  await settle(rig, o.t ?? 1.2);
  return rig;
}

function dish(game: Game, over: any): THREE.Object3D | null {
  const def = game.items.def('dish');
  if (!def) return null;
  const data = { recipe: 'kaphrao_moo', egg: 'crispy', rice: 1, portion: 150, taste: 0.9, salty: 0, spicy: 0.3, sweet: 0, cooked: 0, temp: 1, issues: [], vessel: 'plate', plate: 'flora', vis: { burn: 0, sauce: 0.5, herb: 1, chili: 0.6, size: 1, raw: 0 }, ...over };
  try {
    const e = { id: -2, k: 'dish', data } as any;
    const o = def.build(e, game);
    def.refresh?.(o, e, game);
    (o.userData as any).refresh = () => { try { def.refresh?.(o, e, game); } catch { /* visual only */ } };
    return o;
  } catch (err) { console.warn('[posters] dish', err); return null; }
}

/** full-body shot of a rig (camera in front: rigs face -z) */
function body(st: Studio, rig: CharacterRig, o: Partial<ShotOpts> & { low?: boolean; crop?: 'full' | 'waist' | 'bust' } = {}) {
  const h = rig.height || 1.7;
  const crop = o.crop ?? 'full';
  const cy = crop === 'bust' ? h - 0.25 : crop === 'waist' ? h * 0.72 : h * 0.52;
  const d = crop === 'bust' ? 1.6 : crop === 'waist' ? 2.4 : 3.9;
  const camY = o.low ? cy - (crop === 'full' ? 0.55 : 0.3) : cy + 0.05;
  const s = st.shot([rig.root], { w: 700, h: 1000, fov: 30, pos: [0.15, camY, -d], look: [0, cy, 0], key: [-1.4, 2.6, -2.4], keyCol: 0xfff4e8, keyI: 2.3, rimCol: 0xffffff, rimI: 0.7, ...o });
  return s;
}

async function objShot(st: Studio, obj: THREE.Object3D, o: Partial<ShotOpts> = {}) {
  await loaded();
  (obj.userData as any).refresh?.();
  await loaded();
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const r = Math.max(sz.x, sz.y, sz.z);
  return st.shot([obj], { w: 800, h: 600, fov: 28, pos: [c.x + r * 0.2, c.y + r * 1.15, c.z - r * 1.85], look: [c.x, c.y, c.z], ...o });
}

// ------------------------------------------------------------------ plain print helpers (solid fills only)

const HEAD = (px: number) => `800 ${px}px "HP Sign"`;                 // Sarabun ExtraBold
const HEAD7 = (px: number) => `700 ${px}px "HP Sign"`;                // Sarabun Bold
const BODY = (px: number, w = 400) => `${w} ${px}px "PL Body"`;       // IBM Plex Sans Thai Looped

/** a solid block */
function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) { g.fillStyle = col; g.fillRect(x, y, w, h); }

/** one line of type, solid fill; the size steps DOWN until it fits maxW (never squashed) */
function line(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: (px: number) => string, px: number, col: string, maxW = PW - 64, align: CanvasTextAlign = 'center') {
  let size = px;
  g.font = font(size);
  while (size > 10 && g.measureText(s).width > maxW) { size -= 2; g.font = font(size); }
  g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = col;
  g.fillText(s, x, y);
  return size;
}

/** a clean cut-out, no shadow / filter */
function cut(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number) {
  const h = img.height * (w / img.width);
  g.drawImage(img, x, y, w, h);
  return h;
}
/** cut-out by height, centred on cx, standing on bottomY */
function cutH(g: CanvasRenderingContext2D, img: HTMLCanvasElement, cx: number, bottomY: number, h: number) {
  const w = img.width * (h / img.height);
  g.drawImage(img, cx - w / 2, bottomY - h, w, h);
  return w;
}
/** cut-out clipped into a rectangle (photo window), bottom-aligned, by height */
function cutIn(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number, scale = 1) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const hh = h * scale, ww = img.width * (hh / img.height);
  g.drawImage(img, x + (w - ww) / 2, y + h - hh, ww, hh);
  g.restore();
}

// ------------------------------------------------------------------ designs

const RED = '#d0101a', BLUE = '#1240a8', YEL = '#ffd400', BLK = '#111111', WHT = '#ffffff';

export const POSTERS: PosterDef[] = [
  // ---------------------------------------------------------------- muay thai fight bill (yellow sheet, red/blue corners)
  { id: 'fight_night', cat: 'poster', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, YEL);
    box(g, 0, 0, PW, 150, RED);
    line(g, 'ศึกมวยไทย', PW / 2, 92, HEAD, 92, WHT);
    line(g, 'ลานจอดรถหลังตลาดสด', PW / 2, 134, BODY, 30, WHT, PW - 80, 'center');
    const a = await person(game, 'construction_worker', { seed: 21, anim: 'punch', expr: 'angry', yaw: -0.45, look: { top: { id: 'singlet_white', color: '#c81e1e' }, bottom: { id: 'basketball_shorts', color: '#c81e1e' }, shoes: { id: 'barefoot' }, acc: ['headband_white'] } });
    const b = await person(game, 'gangster_lite', { seed: 5, anim: 'punch', expr: 'angry', yaw: 0.45, look: { top: { id: 'singlet_white', color: '#1e40c8' }, bottom: { id: 'basketball_shorts', color: '#1e40c8' }, shoes: { id: 'barefoot' } } });
    const sa = body(st, a, { crop: 'waist' }), sb = body(st, b, { crop: 'waist' });
    a.dispose(); b.dispose();
    const top = 170, ph = 430, pw2 = (PW - 3 * 20) / 2;
    box(g, 20, top, pw2, ph, '#f4f4f4'); box(g, 40 + pw2, top, pw2, ph, '#f4f4f4');
    cutIn(g, sa, 20, top, pw2, ph, 1.02);
    g.save(); g.translate(40 + pw2 + pw2, 0); g.scale(-1, 1); cutIn(g, sb, 0, top, pw2, ph, 1.02); g.restore();
    box(g, 20, top + ph, pw2, 92, RED); box(g, 40 + pw2, top + ph, pw2, 92, BLUE);
    line(g, 'ไอ้ปูน ซีเมนต์', 20 + pw2 / 2, top + ph + 46, HEAD, 38, WHT, pw2 - 20);
    line(g, 'มุมแดง  62 กก.', 20 + pw2 / 2, top + ph + 78, BODY, 22, WHT, pw2 - 20);
    line(g, 'เด็กแว้น ขาลม', 40 + pw2 * 1.5, top + ph + 46, HEAD, 38, WHT, pw2 - 20);
    line(g, 'มุมน้ำเงิน  51 กก.', 40 + pw2 * 1.5, top + ph + 78, BODY, 22, WHT, pw2 - 20);
    box(g, PW / 2 - 44, top + ph / 2 - 36, 88, 72, BLK);
    line(g, 'VS', PW / 2, top + ph / 2 + 22, HEAD, 54, YEL);
    line(g, 'เสาร์นี้ 20.00 น.', PW / 2, top + ph + 160, HEAD, 52, BLK);
    line(g, 'บัตร 50 บาท  ·  ฟรีน้ำแข็งเปล่า', PW / 2, top + ph + 206, BODY, 28, BLK, PW - 80);
    box(g, 0, PH - 56, PW, 56, BLK);
    line(g, 'ห้ามเชียร์ด้วยไม้กวาด', PW / 2, PH - 19, BODY, 24, YEL, PW - 60);
  } },

  // ---------------------------------------------------------------- luk thung vinyl banner (stage photo + magenta blocks)
  { id: 'lukthung', cat: 'poster', draw: async ({ g, game, st }) => {
    const bg = await img(SRC('concert2.jpg'));
    box(g, 0, 0, PW, PH, '#c8187a');
    photo(g, bg, 0, 150, PW, 560);
    const s = await person(game, 'karaoke_uncle', { seed: 3, anim: 'talk', expr: 'happy', yaw: -0.2, hold: 'mic', look: { top: { id: 'shirt_satin', color: '#e8c040' }, acc: ['gold_chain'] } });
    const shot = body(st, s, { crop: 'waist' });
    s.dispose();
    cutH(g, shot, PW / 2, 710, 520);
    box(g, 0, 0, PW, 150, '#c8187a');
    line(g, 'คอนเสิร์ตลูกทุ่ง', PW / 2, 96, HEAD, 84, WHT);
    line(g, 'คืนวันศุกร์  ลานวัดซอยเจ็ด', PW / 2, 136, BODY, 28, '#ffe24a', PW - 80);
    box(g, 0, 710, PW, PH - 710, '#c8187a');
    line(g, 'ลุงเสียงทอง', PW / 2, 790, HEAD, 70, WHT);
    line(g, 'ร้องเพี้ยนทั้งคืน  ·  ฟรีตลอดงาน', PW / 2, 840, BODY, 30, '#ffe24a', PW - 80);
    line(g, 'ห้ามปาขวด', PW / 2, 880, BODY, 22, WHT, PW - 80);
  } },

  // ---------------------------------------------------------------- the movie (one-sheet: dark field, figure, title, billing block)
  { id: 'movie', cat: 'poster', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, '#0e0f12');
    box(g, 0, 0, PW, 650, '#1c2a3a');
    const h = await person(game, 'player', { anim: 'cook_stir', expr: 'determined', yaw: -0.4, hold: 'wok', look: { top: { id: 'chef_jacket', color: '#f2f0ea' } } });
    const shot = body(st, h, { crop: 'waist' });
    h.dispose();
    cutH(g, shot, PW / 2, 650, 560);
    line(g, 'เขาเคยเสียทุกอย่างให้บาคาร่า', PW / 2, 56, BODY, 26, '#d8d8d8', PW - 80);
    line(g, 'เฮียผัด', PW / 2, 760, HEAD, 120, WHT);
    line(g, 'ไฟแรง ใจแรงกว่า', PW / 2, 808, BODY, 30, '#e8b040', PW - 80);
    line(g, 'กำกับโดย ลุงเจ้าของรถเข็น  ·  นำแสดงโดย กระทะใบเดิม', PW / 2, 852, BODY, 16, '#9a9a9a', PW - 80);
    line(g, 'เร็วๆ นี้ ที่ลานจอดรถข้างตลาด', PW / 2, 882, HEAD7, 20, WHT, PW - 80);
  } },

  // ---------------------------------------------------------------- election-style street poster (white field, blue band, number box)
  { id: 'election', cat: 'poster', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, WHT);
    box(g, 0, 0, PW, 560, '#e9eef7');
    const c = await person(game, 'grandpa', { seed: 11, anim: 'wave', expr: 'happy', yaw: -0.2, look: { top: { id: 'dress_shirt', color: '#f4f6fa' }, bottom: { id: 'slacks', color: '#1d2230' } } });
    const shot = body(st, c, { crop: 'waist' });
    c.dispose();
    cutH(g, shot, PW * 0.62, 560, 470);
    box(g, 32, 40, 190, 230, BLUE);
    line(g, 'เบอร์', 127, 94, HEAD7, 40, WHT, 170);
    line(g, '9', 127, 250, HEAD, 170, WHT, 170);
    box(g, 0, 560, PW, 120, BLUE);
    line(g, 'ลุงสมหวัง ใจดี', PW / 2, 640, HEAD, 64, WHT);
    line(g, 'กะเพราจานละ 20 บาท', PW / 2, 744, HEAD, 50, BLK);
    line(g, 'ไข่ดาวฟรีทุกจาน', PW / 2, 800, HEAD, 50, RED);
    line(g, 'พูดจริง ทำจริง (บางวัน)', PW / 2, 860, BODY, 28, '#444', PW - 80);
  } },

  // ---------------------------------------------------------------- meme: expectation / reality (plain white meme layout)
  { id: 'meme_expect', cat: 'poster', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, WHT);
    const good = dish(game, { vis: { burn: 0, sauce: 0.6, herb: 1, chili: 0.7, size: 1.1, raw: 0 }, egg: 'crispy' });
    const bad = dish(game, { vis: { burn: 1, sauce: 0, herb: 0, chili: 0, size: 0.5, raw: 0 }, egg: 'none', portion: 70, issues: ['burnt'] });
    const half = async (y: number, label: string, obj: THREE.Object3D | null, burnt = false) => {
      line(g, label, PW / 2, y + 62, HEAD, 54, BLK);
      box(g, 24, y + 84, PW - 48, PH / 2 - 108, '#e9e4da');
      if (obj) { const s = await objShot(st, obj, { key: [-1, 2, -1.2], keyI: 2.2, rimI: 0.6, fov: 26 }); const w = PW * 0.7; if (burnt) g.filter = 'brightness(0.5) sepia(0.5)'; g.drawImage(s, (PW - w) / 2, y + 100, w, s.height * (w / s.width)); g.filter = 'none'; }
    };
    await half(0, 'สั่งตามรูป', good);
    await half(PH / 2, 'ได้ตามจริง', bad, true);
  } },

  // ---------------------------------------------------------------- meme: no / yes (two rows, plain)
  { id: 'meme_nope', cat: 'poster', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, WHT);
    const a = await person(game, 'player', { anim: 'shrug', expr: 'disgust', yaw: -0.5, t: 0.7 });
    const sa = body(st, a, { crop: 'bust' }); a.dispose();
    const b = await person(game, 'player', { anim: 'celebrate', expr: 'laugh', yaw: -0.5, t: 0.7 });
    const sb = body(st, b, { crop: 'bust' }); b.dispose();
    const frozen = dish(game, { vessel: 'box', recipe: 'khao_phat', egg: 'none', vis: { burn: 0, sauce: 0.2, herb: 0, chili: 0, size: 0.7, raw: 0 } });
    const krapow = dish(game, {});
    const ph = PH / 2;
    const row = async (y: number, shot: HTMLCanvasElement, col: string, words: string, obj: THREE.Object3D | null) => {
      box(g, 0, y, PW / 2, ph, col);
      cutIn(g, shot, 0, y, PW / 2, ph, 0.92);
      if (obj) { const s = await objShot(st, obj, { keyI: 2.2, rimI: 0.6 }); const w = PW / 2 - 60; g.drawImage(s, PW / 2 + 30, y + 60, w, s.height * (w / s.width)); }
      line(g, words, PW * 0.75, y + ph - 60, HEAD, 40, BLK, PW / 2 - 40);
    };
    await row(0, sa, '#f2a23a', 'ข้าวกล่องเวฟ', frozen);
    await row(ph, sb, '#f6cf4a', 'กะเพราเฮียผัด', krapow);
    box(g, 0, ph - 2, PW, 4, BLK); box(g, PW / 2 - 2, 0, 4, PH, BLK);
  } },

  // ---------------------------------------------------------------- meme: distracted customer (street photo + plain labels)
  { id: 'meme_distracted', cat: 'poster', draw: async ({ g, game, st }) => {
    const bgp = await asset('gen/menu/street/street_dusk.jpg');
    box(g, 0, 0, PW, PH, WHT);
    photo(g, bgp, 0, 0, PW, 720);
    const cart = buildCartModel().root;
    const sc = await objShot(st, cart, { fov: 30, key: [-2, 3, -2], keyI: 2.2, rimI: 0.6 });
    const man = await person(game, 'office_worker_m', { seed: 4, anim: 'walk', expr: 'shocked', yaw: Math.PI * 0.75 });
    const woman = await person(game, 'office_worker_f', { seed: 8, anim: 'angry', expr: 'angry', yaw: -0.4 });
    const sm = body(st, man, { crop: 'waist' }), sw = body(st, woman, { crop: 'waist' });
    man.dispose(); woman.dispose();
    cut(g, sc, -30, 330, PW * 0.6);
    cutH(g, sm, PW * 0.52, 720, 470);
    cutH(g, sw, PW * 0.82, 720, 450);
    const tag = (s: string, x: number, y: number) => { g.font = HEAD7(30); const w = g.measureText(s).width + 24; box(g, x - w / 2, y - 34, w, 46, WHT); line(g, s, x, y, HEAD7, 30, BLK, 300); };
    tag('กะเพราไข่ดาว', PW * 0.22, 300); tag('ฉัน', PW * 0.52, 230); tag('ไดเอท', PW * 0.84, 250);
    line(g, 'ตั้งใจลดน้ำหนักมา 3 วัน', PW / 2, 790, HEAD, 44, BLK);
    line(g, 'วันที่ 4 เดินผ่านร้านเฮียผัด', PW / 2, 846, BODY, 30, RED, PW - 60);
  } },

  // ---------------------------------------------------------------- casino wall: TV drama poster
  { id: 'casino_drama', cat: 'casino', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, '#7a0e2a');
    const f = await person(game, 'sexy_girl_who_screams', { seed: 2, anim: 'slap', expr: 'angry', yaw: 0.9, t: 0.55 });
    const m = await person(game, 'office_worker_m', { seed: 6, anim: 'get_slapped', expr: 'pain', yaw: -0.9, t: 0.6 });
    const sf = body(st, f, { crop: 'waist' }), sm = body(st, m, { crop: 'waist' });
    f.dispose(); m.dispose();
    cutH(g, sm, PW * 0.66, 660, 560);
    cutH(g, sf, PW * 0.3, 660, 560);
    box(g, 0, 660, PW, PH - 660, '#1a0a10');
    line(g, 'ตบให้สุด หยุดที่รัก', PW / 2, 752, HEAD, 64, WHT);
    line(g, 'ละครหลังข่าว  ตอนจบ EP.99', PW / 2, 806, BODY, 30, '#ffb8c8', PW - 80);
    line(g, 'จันทร์–อังคาร  20.30 น.', PW / 2, 856, HEAD7, 30, WHT, PW - 80);
  } },

  // ---------------------------------------------------------------- casino wall: standing pose championship
  { id: 'casino_pose', cat: 'casino', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, '#2a1846');
    const a = await person(game, 'anime_delinquent', { seed: 3, anim: 'cine_menace', expr: 'determined', yaw: -0.5 });
    const b = await person(game, 'anime_spiky', { seed: 9, anim: 'cine_point', expr: 'smug', yaw: 0.55 });
    const sa = body(st, a), sb = body(st, b);
    a.dispose(); b.dispose();
    box(g, 0, 0, PW, 170, YEL);
    line(g, 'ศึกยืนท่าเท่', PW / 2, 100, HEAD, 92, BLK);
    line(g, 'STANDING POSE CHAMPIONSHIP', PW / 2, 146, HEAD7, 26, BLK, PW - 80);
    cutH(g, sb, PW * 0.7, 760, 560);
    cutH(g, sa, PW * 0.3, 760, 570);
    box(g, 0, 760, PW, PH - 760, BLK);
    line(g, 'ไม่ต้องต่อย แค่ยืนให้น่ากลัวที่สุด', PW / 2, 820, HEAD7, 34, WHT, PW - 60);
    line(g, 'คืนวันเสาร์  ห้องวีไอพี', PW / 2, 866, BODY, 26, YEL, PW - 60);
  } },

  // ---------------------------------------------------------------- casino wall: WANTED notice (plain printed notice)
  { id: 'casino_wanted', cat: 'casino', draw: async ({ g, game, st }) => {
    box(g, 0, 0, PW, PH, '#f6f3ec');
    const a = await person(game, 'anime_delinquent', { seed: 3, anim: 'cine_cross', expr: 'smug', yaw: -0.1 });
    const s = body(st, a, { crop: 'bust' });
    a.dispose();
    line(g, 'ตามหา', PW / 2, 120, HEAD, 120, RED);
    const fx = 120, fy = 160, fw = PW - 240, fh = 400;
    box(g, fx, fy, fw, fh, '#d9d6cf');
    cutIn(g, s, fx, fy, fw, fh, 1);
    g.strokeStyle = BLK; g.lineWidth = 4; g.strokeRect(fx, fy, fw, fh);
    line(g, 'ชายหมวกดำ เสื้อโค้ทยาว', PW / 2, 630, HEAD, 42, BLK);
    line(g, 'ถอนหายใจทุก 5 นาที  ยืนท่าแปลกขวางโต๊ะ', PW / 2, 676, BODY, 26, '#333', PW - 80);
    box(g, 60, 720, PW - 120, 110, RED);
    line(g, 'ค่าหัว ข้าวมันไก่ 1 จาน', PW / 2, 792, HEAD, 48, WHT, PW - 150);
  } },

  // ---------------------------------------------------------------- restaurant: thank-you poster
  { id: 'shop_thanks', cat: 'shop', draw: async ({ g, game, st }) => {
    const food = await asset('img/newspaper/photos/kaprao_egg_closeup_color.jpg');
    box(g, 0, 0, PW, PH, YEL);
    photo(g, food, 0, 560, PW, 230);
    const c = await person(game, 'player', { anim: 'wave', expr: 'happy', yaw: -0.3, look: { top: { id: 'chef_jacket', color: '#f2f0ea' } } });
    const s = body(st, c, { crop: 'waist' });
    c.dispose();
    cutH(g, s, PW / 2, 560, 380);
    line(g, 'ขอบคุณที่อุดหนุน', PW / 2, 110, HEAD, 80, RED);
    line(g, 'ร้านเฮียผัด  อาหารตามสั่ง', PW / 2, 160, BODY, 30, BLK, PW - 80);
    box(g, 0, 790, PW, PH - 790, RED);
    line(g, 'อร่อยบอกเพื่อน ไม่อร่อยบอกเฮีย', PW / 2, 860, HEAD7, 36, WHT, PW - 60);
  } },
];

/** generate every poster → [{ id, cat, url (png data URL) }] */
export async function generatePosters(game: Game, only?: string[]) {
  const st = new Studio(game.engine.renderer);
  // body face (build-time only): IBM Plex Sans Thai Looped, Thai + Latin subsets
  const TH = 'U+0E01-0E5B, U+200C-200D, U+25CC', LA = 'U+0000-00FF, U+2000-206F, U+20AC, U+2122, U+2212';
  for (const [w, sub, range] of [['400', 'Thai', TH], ['400', 'Latin', LA], ['600', 'Thai', TH], ['600', 'Latin', LA]] as const) {
    try { const ff = new FontFace('PL Body', `url(${SRC('fonts/PlexLooped-' + sub + '-' + w + '.woff2')})`, { weight: w, unicodeRange: range } as any); await ff.load(); (document as any).fonts.add(ff); } catch (e) { console.warn('[posters] font', e); }
  }
  await Promise.all(['800 40px "HP Sign"', '700 40px "HP Sign"', '400 40px "PL Body"', '600 40px "PL Body"'].map((f) => (document as any).fonts.load(f, 'กขAB12').catch(() => null)));
  const out: { id: string; cat: string; url: string; w: number; h: number }[] = [];
  for (const p of POSTERS) {
    if (only && !only.includes(p.id)) continue;
    const cv = document.createElement('canvas');
    cv.width = PW; cv.height = PH;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const seed = hashStr(p.id);
    try {
      await p.draw({ g, game, st, seed, paper: null });
      out.push({ id: p.id, cat: p.cat, url: cv.toDataURL('image/png'), w: PW, h: PH });
      console.info('[posters] done', p.id);
    } catch (e) { console.error('[posters] failed', p.id, e); }
  }
  st.dispose();
  return out;
}
