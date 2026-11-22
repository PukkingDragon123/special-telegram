import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { AnimName, CharacterRig, Expression, Look } from '../../game/contracts';
import { F } from '../../core/fonts';
import { Assets } from '../../core/assets';
import { buildCartModel } from '../cooking/cart';
import {
  Studio, settle, sticker, place, rays, bokeh, text, halftone, printFinish, vgrad, radial, photo, hashStr, rng, type ShotOpts,
} from './studio';

/* ============================================================================================
 * The poster set. Every figure is a studio render of the game's own 3D models (people from
 * game.chars, the real dish items, the wok, the cart); backdrops are real CC0 photos (see
 * references/credits/posters.md). Original parodies only: no real people, brands or characters.
 * Run via scripts/posters.mjs (?only=characters,cooking,posters&posters=gen) → public/assets/gen/posters.
 * ========================================================================================== */

export const PW = 640, PH = 904;

export interface PosterDef { id: string; cat: string; draw: (c: Ctx) => Promise<void> }
interface Ctx { g: CanvasRenderingContext2D; game: Game; st: Studio; seed: number; paper: HTMLImageElement | null }

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
  const s = st.shot([rig.root], { w: 700, h: 1000, fov: 30, pos: [0.15, camY, -d], look: [0, cy, 0], ...o });
  return s;
}

/** place a cut-out by HEIGHT, centred on cx, standing on bottomY */
function placeH(g: CanvasRenderingContext2D, img: HTMLCanvasElement, cx: number, bottomY: number, h: number, o: Parameters<typeof place>[5] = {}) {
  const w = img.width * (h / img.height);
  place(g, img, cx - w / 2, bottomY - h, w, o);
  return w;
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

// ------------------------------------------------------------------ type helpers

const DISPLAY = (px: number) => `400 ${px}px ${F.display}`;      // Chonburi: luk thung / movie display
const SERIF = (px: number, w = 900) => `${w} ${px}px ${F.news}`;  // Taviraj Black
const SERIF2 = (px: number, w = 900) => `${w} ${px}px ${F.news2}`; // Trirong Black
const ROUND = (px: number, w = 700) => `${w} ${px}px ${F.bubbly}`; // Kodchasan
const JP = (px: number) => `400 ${px}px "Dela Gothic One"`;       // Latin/kana display
const BODY = (px: number, w = 600) => `${w} ${px}px ${F.ui}`;

/** gradients are in the lettering's local space (baseline at y = 0): pass the font size */
function gold(g: CanvasRenderingContext2D, size: number) {
  const gr = g.createLinearGradient(0, -size * 0.8, 0, size * 0.12);
  gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.35, '#ffd34a'); gr.addColorStop(0.55, '#c88a12'); gr.addColorStop(0.75, '#ffe58a'); gr.addColorStop(1, '#b0700a');
  return gr;
}
function chrome(g: CanvasRenderingContext2D, size: number) {
  const gr = g.createLinearGradient(0, -size * 0.8, 0, size * 0.12);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#d8dde4'); gr.addColorStop(0.5, '#6a7480'); gr.addColorStop(0.7, '#f0f2f6'); gr.addColorStop(1, '#9aa4b0');
  return gr;
}

function strip(g: CanvasRenderingContext2D, y: number, h: number, col: string) { g.fillStyle = col; g.fillRect(0, y, PW, h); }

// ------------------------------------------------------------------ designs

export const POSTERS: PosterDef[] = [
  // ---------------------------------------------------------------- Muay Thai fight night
  { id: 'fight_night', cat: 'poster', draw: async ({ g, game, st, seed }) => {
    const bg = await img(SRC('boxing.jpg'));
    g.fillStyle = '#120404'; g.fillRect(0, 0, PW, PH);
    photo(g, bg, -120, 0, PW + 240, PH * 0.82, { filter: 'blur(2.5px) brightness(0.5) saturate(1.5) sepia(0.35) hue-rotate(-18deg) contrast(1.2)' });
    vgrad(g, 0, 0, PW, PH, [[0, 'rgba(150,0,0,0.25)'], [0.55, 'rgba(40,0,0,0.1)'], [0.8, 'rgba(10,0,0,0.85)'], [1, '#0a0202']]);
    rays(g, PW / 2, PH * 0.47, 28, 900, 'rgba(255,60,30,0.09)', 0.05);
    const a = await person(game, 'construction_worker', { seed: 21, anim: 'punch', expr: 'angry', yaw: -0.55, look: { top: { id: 'singlet_white', color: '#c81e1e' }, bottom: { id: 'basketball_shorts', color: '#c81e1e' }, shoes: { id: 'barefoot' }, acc: ['headband_white'] } });
    const b = await person(game, 'gangster_lite', { seed: 5, anim: 'kick', expr: 'angry', yaw: 0.7, t: 0.45, look: { top: { id: 'singlet_white', color: '#1e40c8' }, bottom: { id: 'basketball_shorts', color: '#1e40c8' }, shoes: { id: 'barefoot' } } });
    const sa = body(st, a, { low: true, key: [-2, 2.2, -1.5], keyCol: 0xffd0a0, rimCol: 0xff4030, rimI: 3 });
    const sb = body(st, b, { low: true, key: [2, 2.2, -1.5], keyCol: 0xffd0a0, rimCol: 0x4080ff, rimI: 3 });
    a.dispose(); b.dispose();
    const H0 = PH * 0.62;
    const wA = H0 * sa.width / sa.height, wB = H0 * sb.width / sb.height;
    // (draw order: blue corner behind, red corner in front; bottom-aligned)
    radial(g, 0, PH * 0.2, PW, PH * 0.6, 'rgba(255,80,40,0.18)', 'rgba(0,0,0,0)');
    place(g, sb, PW - wB + 10, PH * 0.78 - H0, wB, { shadow: 'rgba(0,0,0,0.75)', blur: 26 });
    place(g, sa, -10, PH * 0.78 - H0 + 6, wA, { shadow: 'rgba(0,0,0,0.75)', blur: 26 });
    halftone(g, 0, Math.round(PH * 0.15), PW, Math.round(PH * 0.65), 5, 0.22);
    // title block
    text(g, 'ศึกมวยมันส์ข้างซอย', PW / 2, 58, { font: SERIF(40), fill: '#ffe14a', stroke: '#2a0000', sw: 8, maxW: PW - 60 });
    text(g, 'คืนนี้ต้องมีคนหลับ', PW / 2, 140, { font: DISPLAY(78), fill: gold(g, 78), stroke2: '#000', sw2: 18, stroke: '#7a0a0a', sw: 8, maxW: PW - 40, extrude: '#3a0000', ex: 7 });
    text(g, 'VS', PW / 2 + 6, PH * 0.47, { font: JP(120), fill: chrome(g, 120), stroke2: '#000', sw2: 20, stroke: '#c81e1e', sw: 8, rot: -0.08, extrude: '#200', ex: 8 });
    // name bars
    const bar = (x: number, w: number, y: number, col: string, name: string, sub: string, al: CanvasTextAlign) => {
      g.save(); g.fillStyle = col; g.transform(1, 0, -0.25, 1, 0, 0); g.fillRect(x + 30, y, w, 62); g.restore();
      const tx = al === 'left' ? x + 18 : x + w + 6;
      text(g, name, tx, y + 34, { font: SERIF(30), fill: '#fff', align: al, maxW: w - 20, stroke: 'rgba(0,0,0,0.5)', sw: 4 });
      text(g, sub, tx, y + 56, { font: BODY(15, 700), fill: '#ffe9a0', align: al, maxW: w - 20 });
    };
    bar(0, 330, PH * 0.705, '#b5121b', 'ไอ้ปูน หมัดปูนซีเมนต์', 'มุมแดง · 62 กก. · ชนะ 0 แพ้ 14', 'left');
    bar(PW - 330, 330, PH * 0.705 + 70, '#1739b0', 'เด็กแว้น ขาลม', 'มุมน้ำเงิน · 51 กก. · หนีเก่ง', 'right');
    // info strip
    strip(g, PH - 92, 92, '#0a0202');
    strip(g, PH - 92, 5, '#ffd21f');
    text(g, 'เสาร์นี้ 2 ทุ่มตรง · เวทีลานจอดรถหลังตลาดสด', PW / 2, PH - 56, { font: SERIF(27), fill: '#ffd21f', maxW: PW - 40 });
    text(g, 'บัตร 50.-  ฟรีน้ำแข็งเปล่า  ·  ห้ามเชียร์ด้วยไม้กวาด  ·  ห้ามพนัน (แต่รู้ๆ กัน)', PW / 2, PH - 24, { font: BODY(16, 600), fill: '#fff', maxW: PW - 40 });
    void seed;
  } },

  // ---------------------------------------------------------------- luk thung concert
  { id: 'lukthung', cat: 'poster', draw: async ({ g, game, st, seed }) => {
    const bg = await img(SRC('concert2.jpg'));
    g.fillStyle = '#1a0420'; g.fillRect(0, 0, PW, PH);
    photo(g, bg, -200, 120, PW + 400, PH * 0.78, { filter: 'saturate(1.6) hue-rotate(-38deg) brightness(0.95) contrast(1.1)' });
    vgrad(g, 0, 0, PW, PH, [[0, '#2a0638'], [0.18, 'rgba(60,8,80,0.55)'], [0.55, 'rgba(120,10,90,0.15)'], [0.85, 'rgba(40,4,40,0.8)'], [1, '#14021a']]);
    bokeh(g, 0, 60, PW, PH * 0.6, seed, ['#ffd36a', '#ff5fbf', '#ffffff', '#7fd8ff'], 34, 8, 40);
    rays(g, PW / 2, PH * 0.32, 22, 900, 'rgba(255,210,120,0.07)');
    const s = await person(game, 'karaoke_uncle', { seed: 3, anim: 'talk', expr: 'laugh', yaw: -0.25, hold: 'mic', look: { top: { id: 'shirt_satin', color: '#e8c040' }, acc: ['sunglasses', 'gold_chain'] } });
    const shot = body(st, s, { crop: 'waist', low: true, key: [-1.4, 2.6, -2], keyCol: 0xfff0d0, rimCol: 0xff60c0, rimI: 3.2 });
    s.dispose();
    placeH(g, shot, PW / 2 + 10, PH * 0.86, PH * 0.6, { shadow: 'rgba(255,90,200,0.6)', blur: 40 });
    // sparkles
    const r = rng(seed + 9);
    g.save(); g.fillStyle = '#fff8d0';
    for (let i = 0; i < 40; i++) { const x = r() * PW, y = 220 + r() * PH * 0.45, k = 2 + r() * 7; g.globalAlpha = 0.5 + r() * 0.5; g.beginPath(); for (let j = 0; j < 8; j++) { const a = j * Math.PI / 4, rr = j % 2 ? k * 0.25 : k; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
    g.restore();
    text(g, 'คอนเสิร์ตใหญ่ ลานวัดซอยเจ็ด', PW / 2, 52, { font: SERIF(30), fill: '#fff', stroke: '#5a0060', sw: 6, maxW: PW - 60 });
    text(g, 'ลูกทุ่ง', PW / 2, 168, { font: DISPLAY(128), fill: gold(g, 128), stroke2: '#fff', sw2: 22, stroke: '#7a0a6a', sw: 10, extrude: '#3a0040', ex: 9 });
    text(g, 'ร้องเพี้ยน... ทั้งคืน', PW / 2, 226, { font: ROUND(40, 700), fill: '#ffe0f4', stroke: '#6a0058', sw: 8, skew: -0.18, maxW: PW - 80 });
    // artist banner
    g.save(); g.translate(PW / 2, PH * 0.8); g.rotate(-0.04);
    vgrad(g, -280, -36, 560, 72, [[0, '#ff3fa8'], [1, '#b0106a']]);
    g.strokeStyle = '#ffe58a'; g.lineWidth = 4; g.strokeRect(-280, -36, 560, 72);
    g.restore();
    text(g, 'ลุงเสียงทอง ไม่เคยตรงคีย์', PW / 2, PH * 0.8 + 14, { font: SERIF(38), fill: '#fff', stroke: '#5a0040', sw: 5, rot: -0.04, maxW: 520 });
    strip(g, PH - 96, 96, 'rgba(20,2,26,0.92)');
    text(g, 'พร้อมหางเครื่อง 20 ชีวิต (มาจริง 3)  ·  เปิดฟลอร์ 3 ทุ่ม', PW / 2, PH - 58, { font: BODY(20, 700), fill: '#ffd36a', maxW: PW - 40 });
    text(g, 'ฟรีตลอดงาน · ห้ามปาขวด · ขอเพลงได้ (ร้องได้ไม่ได้อีกเรื่อง)', PW / 2, PH - 26, { font: BODY(16, 600), fill: '#fff', maxW: PW - 40 });
  } },

  // ---------------------------------------------------------------- the movie
  { id: 'movie', cat: 'poster', draw: async ({ g, game, st }) => {
    const fire = await asset('img/newspaper/photos/wok_fire_color.jpg');
    g.fillStyle = '#05080a'; g.fillRect(0, 0, PW, PH);
    photo(g, fire, -60, PH * 0.3, PW + 120, PH * 0.7, { filter: 'saturate(1.6) contrast(1.2) brightness(1.1)' });
    vgrad(g, 0, 0, PW, PH, [[0, '#04121a'], [0.3, 'rgba(4,18,26,0.92)'], [0.5, 'rgba(10,20,26,0.2)'], [0.78, 'rgba(0,0,0,0.25)'], [0.9, 'rgba(0,0,0,0.85)'], [1, '#000']]);
    bokeh(g, 0, PH * 0.3, PW, PH * 0.5, 77, ['#ff9a30', '#ffd070', '#ff5a10'], 22, 4, 14);
    const h = await person(game, 'player', { anim: 'cook_stir', expr: 'determined', yaw: -0.45, hold: 'wok', look: { top: { id: 'chef_jacket', color: '#f2f0ea' }, acc: ['towel_neck'] } });
    const shot = body(st, h, { low: true, key: [0.8, 0.5, -1.8], keyCol: 0xff8a3a, keyI: 4.5, rimCol: 0x5ad8ff, rimI: 3.6 });
    h.dispose();
    placeH(g, shot, PW / 2, PH * 0.92, PH * 0.74, { shadow: 'rgba(255,120,40,0.5)', blur: 46 });
    // teal/orange grade over the figure + film grain
    g.save(); g.globalCompositeOperation = 'soft-light'; vgrad(g, 0, 0, PW, PH, [[0, 'rgba(0,140,170,0.55)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(255,110,20,0.55)']]); g.restore();
    text(g, 'เขาเคยเสียทุกอย่างให้บาคาร่า', PW / 2, 46, { font: SERIF(24, 700), fill: '#cfe6ee', spacing: 1 });
    text(g, 'คืนนี้... เขาจะเอาคืนด้วยกะเพรา', PW / 2, 78, { font: SERIF(24, 700), fill: '#cfe6ee', spacing: 1 });
    text(g, 'เฮียผัด', PW / 2, PH * 0.79, { font: SERIF(150), fill: gold(g, 150), stroke2: 'rgba(0,0,0,0.85)', sw2: 16, shadow: 'rgba(255,140,40,0.9)', blur: 30, sdy: 0 });
    text(g, 'ไฟแรง... ใจแรงกว่า', PW / 2, PH * 0.79 + 52, { font: SERIF2(34, 700), fill: '#ffd9a0', spacing: 3 });
    // billing block
    g.save(); g.fillStyle = 'rgba(200,210,214,0.75)';
    const bill = ['ค่ายหนังซอยเจ็ด ภูมิใจเสนอ  ภาพยนตร์ที่ไม่มีใครขอ  "เฮียผัด"', 'กำกับโดย ลุงเจ้าของรถเข็น  เขียนบทโดย ตาชั่งตลาดสด  ดนตรีประกอบ หมาในซอย', 'ร่วมด้วย ป้าแม่ค้า · เด็กแว้นขาลม · ไข่ดาว (รับเชิญพิเศษ) · กระทะใบเดิม'];
    bill.forEach((l, i) => text(g, l, PW / 2, PH - 74 + i * 18, { font: BODY(13, 600), fill: 'rgba(200,214,220,0.8)', maxW: PW - 60 }));
    g.restore();
    text(g, 'เร็วๆ นี้ ในโรงภาพยนตร์ (ลานจอดรถข้างตลาด)', PW / 2, PH - 16, { font: SERIF(20, 700), fill: '#ffb060', maxW: PW - 60 });
    // rating badge
    g.save(); g.fillStyle = '#c01212'; g.fillRect(PW - 98, PH - 152, 76, 46); g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(PW - 98, PH - 152, 76, 46); g.restore();
    text(g, 'ฉ 18+', PW - 60, PH - 124, { font: SERIF(22), fill: '#fff' });
    text(g, '(เผ็ดมาก)', PW - 60, PH - 92, { font: BODY(12, 700), fill: '#ffb4a0' });
  } },

  // ---------------------------------------------------------------- election-style street poster (pure nonsense)
  { id: 'election', cat: 'poster', draw: async ({ g, game, st }) => {
    vgrad(g, 0, 0, PW, PH, [[0, '#0a3fa8'], [0.62, '#1660d8'], [0.62, '#ffffff'], [1, '#f2f4f8']]);
    rays(g, PW * 0.5, PH * 0.42, 30, 900, 'rgba(255,255,255,0.07)');
    const c = await person(game, 'grandpa', { seed: 11, anim: 'wave', expr: 'happy', yaw: -0.25, look: { top: { id: 'dress_shirt', color: '#f4f6fa' }, bottom: { id: 'slacks', color: '#1d2230' } } });
    const shot = body(st, c, { crop: 'waist', key: [-1.6, 2.4, -2.4] });
    c.dispose();
    placeH(g, shot, PW * 0.56, PH * 0.62 + 4, PH * 0.42, { shadow: 'rgba(0,0,30,0.4)', blur: 20 });
    // the big number
    g.save(); g.beginPath(); g.arc(118, 190, 92, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#ffd21f'; g.stroke(); g.restore();
    text(g, 'เบอร์', 118, 148, { font: SERIF(30), fill: '#0a3fa8' });
    text(g, '9', 118, 258, { font: SERIF(130), fill: '#c01212' });
    text(g, 'เลือกลุง', PW * 0.68, 120, { font: SERIF(72), fill: '#fff', stroke: '#06235e', sw: 10, maxW: 380 });
    text(g, 'ลุงพูดจริง ทำจริง (บางวัน)', PW * 0.68, 172, { font: SERIF(26, 700), fill: '#ffe14a', maxW: 360 });
    text(g, 'ลุงสมหวัง ใจดีเกิน', PW / 2, PH * 0.69, { font: SERIF(54), fill: '#0a3fa8', maxW: PW - 60 });
    const lines = ['กะเพราจานละ 20 บาท ไข่ดาวฟรีทุกจาน', 'ซอยไหนน้ำท่วม ลุงพายเรือไปส่งข้าวเอง', 'ห้ามหมาเห่าหลังสี่ทุ่ม (จะคุยกับหมาให้)'];
    lines.forEach((l, i) => { text(g, '✔ ' + l, 46, PH * 0.76 + i * 44, { font: SERIF(26, 700), fill: '#1d2230', align: 'left', maxW: PW - 80 }); });
    strip(g, PH - 62, 62, '#0a3fa8');
    text(g, 'กาเบอร์ 9 · ลุงไม่ได้หาเสียง ลุงหาข้าวกิน', PW / 2, PH - 22, { font: SERIF(26), fill: '#fff', maxW: PW - 40 });
  } },

  // ---------------------------------------------------------------- meme: expectation / reality
  { id: 'meme_expect', cat: 'poster', draw: async ({ g, game, st }) => {
    g.fillStyle = '#fbf6ea'; g.fillRect(0, 0, PW, PH);
    const good = dish(game, { vis: { burn: 0, sauce: 0.6, herb: 1, chili: 0.7, size: 1.1, raw: 0 }, egg: 'crispy' });
    const bad = dish(game, { vis: { burn: 1, sauce: 0.1, herb: 0.2, chili: 0.1, size: 0.55, raw: 0 }, egg: 'none', issues: ['burnt'] });
    const half = async (y: number, col: string, label: string, sub: string, obj: THREE.Object3D | null, flip: boolean) => {
      g.fillStyle = col; g.fillRect(16, y, PW - 32, PH / 2 - 24);
      if (obj) {
        const s = await objShot(st, obj, { key: [-1, 2, -1.2], fov: 26 });
        const w = PW * 0.74;
        place(g, s, (PW - w) / 2, y + 96, w, { shadow: 'rgba(0,0,0,0.35)', blur: 16, dy: 8, filter: flip ? 'saturate(0.7) brightness(0.85)' : 'saturate(1.25) contrast(1.05)' });
      }
      text(g, label, PW / 2, y + 66, { font: SERIF(52), fill: '#fff', stroke: '#000', sw: 10, maxW: PW - 60 });
      text(g, sub, PW / 2, y + PH / 2 - 44, { font: SERIF(26, 700), fill: '#fff', stroke: '#000', sw: 7, maxW: PW - 70 });
    };
    await half(16, '#2e7d3a', 'สั่งตามรูป', 'กะเพราหมูสับ ไข่ดาวกรอบ ราดข้าวสวย', good, false);
    await half(PH / 2 + 8, '#6a2a1a', 'ได้ตามจริง', 'กะเพรา (เคย) หมูสับ · ไข่ดาวไปไหน', bad, true);
    halftone(g, 0, 0, PW, PH, 6, 0.1);
  } },

  // ---------------------------------------------------------------- meme: no / yes (original two-panel)
  { id: 'meme_nope', cat: 'poster', draw: async ({ g, game, st }) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, PW, PH);
    const a = await person(game, 'player', { anim: 'shrug', expr: 'disgust', yaw: -0.5, t: 0.7 });
    const sa = body(st, a, { crop: 'bust', key: [-1.6, 2.2, -2] });
    a.dispose();
    const b = await person(game, 'player', { anim: 'celebrate', expr: 'laugh', yaw: -0.5, t: 0.7 });
    const sb = body(st, b, { crop: 'bust', key: [-1.6, 2.2, -2] });
    b.dispose();
    const ph = (PH - 48) / 2;
    const panel = (y: number, shot: HTMLCanvasElement, col: string, words: string, food: HTMLCanvasElement | null, small: string) => {
      g.fillStyle = col; g.fillRect(16, y, PW / 2 - 24, ph);
      g.fillStyle = '#fffaf0'; g.fillRect(PW / 2, y, PW / 2 - 16, ph);
      const w = PW / 2 - 40, h = shot.height * (w / shot.width);
      g.save(); g.beginPath(); g.rect(16, y, PW / 2 - 24, ph); g.clip();
      place(g, shot, 28, y + Math.max(12, ph - h), w);
      g.restore();
      if (food) place(g, food, PW / 2 + 30, y + 40, PW / 2 - 76, { shadow: 'rgba(0,0,0,0.3)', blur: 10, dy: 6 });
      text(g, words, PW * 0.75, y + ph - 76, { font: SERIF(34), fill: '#1a1210', maxW: PW / 2 - 50 });
      text(g, small, PW * 0.75, y + ph - 36, { font: SERIF(20, 700), fill: '#6a5a4a', maxW: PW / 2 - 50 });
    };
    const frozen = dish(game, { vessel: 'box', recipe: 'khao_phat', egg: 'none', vis: { burn: 0, sauce: 0.2, herb: 0, chili: 0, size: 0.7, raw: 0 } });
    const krapow = dish(game, {});
    panel(16, sa, '#e8a33d', 'ข้าวกล่องเวฟ', frozen ? await objShot(st, frozen) : null, '2 นาที อร่อยครึ่งนาที');
    panel(32 + ph, sb, '#f2c94c', 'กะเพราเฮียผัด', krapow ? await objShot(st, krapow) : null, 'ไข่ดาวกรอบ ขอบไหม้นิดๆ');
  } },

  // ---------------------------------------------------------------- meme: distracted customer
  { id: 'meme_distracted', cat: 'poster', draw: async ({ g, game, st, seed }) => {
    const bgp = await asset('gen/menu/street/street_dusk.jpg');
    photo(g, bgp, 0, 0, PW, PH, { filter: 'blur(4px) brightness(0.95) saturate(1.1)' });
    const cart = buildCartModel().root;
    const sc = await objShot(st, cart, { fov: 30, key: [-2, 3, -2] });
    const man = await person(game, 'office_worker_m', { seed: 4, anim: 'walk', expr: 'shocked', yaw: Math.PI * 0.75 });
    const woman = await person(game, 'office_worker_f', { seed: 8, anim: 'angry', expr: 'angry', yaw: -0.4 });
    const sm = body(st, man, { crop: 'waist' }), sw = body(st, woman, { crop: 'waist' });
    man.dispose(); woman.dispose();
    place(g, sc, -40, PH * 0.34, PW * 0.62, { shadow: 'rgba(0,0,0,0.4)', blur: 14 });
    place(g, sm, PW * 0.3, PH * 0.3, PW * 0.42, { shadow: 'rgba(0,0,0,0.35)', blur: 14 });
    place(g, sw, PW * 0.62, PH * 0.3, PW * 0.4, { shadow: 'rgba(0,0,0,0.35)', blur: 14 });
    const lab = (s: string, x: number, y: number) => text(g, s, x, y, { font: SERIF(38), fill: '#fff', stroke: '#000', sw: 9, maxW: 260 });
    lab('กะเพรา', PW * 0.2, PH * 0.36); lab('ไข่ดาว', PW * 0.2, PH * 0.36 + 42);
    lab('ฉัน', PW * 0.5, PH * 0.3);
    lab('ไดเอท', PW * 0.82, PH * 0.3);
    halftone(g, 0, 0, PW, PH, 5, 0.12);
    strip(g, PH - 96, 96, '#fff');
    text(g, 'ตั้งใจลดน้ำหนักมา 3 วัน', PW / 2, PH - 54, { font: SERIF(34), fill: '#111', maxW: PW - 40 });
    text(g, 'วันที่ 4 ดันเดินผ่านร้านเฮียผัด', PW / 2, PH - 18, { font: SERIF(24, 700), fill: '#c01212', maxW: PW - 40 });
    void seed;
  } },

  // ---------------------------------------------------------------- casino wall: slap drama
  { id: 'casino_drama', cat: 'casino', draw: async ({ g, game, st, seed }) => {
    radial(g, 0, 0, PW, PH, '#c22a5a', '#1a0410', 0.5, 0.4);
    bokeh(g, 0, 0, PW, PH * 0.6, seed, ['#ffb0d0', '#ffffff', '#ff6090'], 26, 10, 60);
    const f = await person(game, 'sexy_girl_who_screams', { seed: 2, anim: 'slap', expr: 'angry', yaw: 0.9, t: 0.55, speed: 1 });
    const m = await person(game, 'office_worker_m', { seed: 6, anim: 'get_slapped', expr: 'pain', yaw: -0.9, t: 0.6 });
    const sf = body(st, f, { crop: 'waist', key: [-1, 2.4, -2.2], rimCol: 0xff70a0 });
    const sm = body(st, m, { crop: 'waist', key: [1, 2.4, -2.2], rimCol: 0xff70a0 });
    f.dispose(); m.dispose();
    place(g, sm, PW * 0.4, PH * 0.2, PW * 0.62, { shadow: 'rgba(40,0,20,0.6)', blur: 30 });
    place(g, sf, -PW * 0.04, PH * 0.2, PW * 0.6, { shadow: 'rgba(40,0,20,0.6)', blur: 30 });
    text(g, 'เพี๊ยะ!!', PW * 0.62, PH * 0.2, { font: SERIF(96), fill: '#ffe14a', stroke2: '#fff', sw2: 18, stroke: '#7a0010', sw: 9, rot: -0.12, extrude: '#3a0008', ex: 6 });
    vgrad(g, 0, PH * 0.62, PW, PH * 0.38, [[0, 'rgba(26,4,16,0)'], [0.3, 'rgba(26,4,16,0.9)'], [1, '#14020c']]);
    text(g, 'ตบให้สุด หยุดที่รัก', PW / 2, PH * 0.79, { font: DISPLAY(66), fill: '#fff', stroke: '#7a0030', sw: 8, shadow: 'rgba(255,80,140,0.9)', blur: 22, sdy: 0, maxW: PW - 40 });
    text(g, 'ละครหลังข่าว · ตอนจบ (อีกแล้ว) EP.99', PW / 2, PH * 0.79 + 46, { font: SERIF(26, 700), fill: '#ffd0e0', maxW: PW - 60 });
    text(g, 'จันทร์–อังคาร 2 ทุ่มครึ่ง · ตบจริง เจ็บจริง ร้องไห้จริง', PW / 2, PH - 34, { font: BODY(18, 700), fill: '#fff', maxW: PW - 40 });
  } },

  // ---------------------------------------------------------------- casino wall: standing pose championship
  { id: 'casino_pose', cat: 'casino', draw: async ({ g, game, st }) => {
    vgrad(g, 0, 0, PW, PH, [[0, '#3a1660'], [1, '#0c0618']]);
    rays(g, PW / 2, PH * 0.46, 36, 1000, 'rgba(255,200,90,0.12)');
    const a = await person(game, 'anime_delinquent', { seed: 3, anim: 'cine_menace', expr: 'determined', yaw: -0.5 });
    const b = await person(game, 'anime_spiky', { seed: 9, anim: 'cine_point', expr: 'smug', yaw: 0.55 });
    const sa = body(st, a, { low: true, key: [-2, 2, -1.4], keyCol: 0xffe0a0, rimCol: 0xb060ff, rimI: 3.5 });
    const sb = body(st, b, { low: true, key: [2, 2, -1.4], keyCol: 0xffe0a0, rimCol: 0xb060ff, rimI: 3.5 });
    a.dispose(); b.dispose();
    const H0 = PH * 0.66;
    place(g, sb, PW - H0 * sb.width / sb.height + 30, PH * 0.84 - H0, H0 * sb.width / sb.height, { shadow: 'rgba(0,0,0,0.8)', blur: 30 });
    place(g, sa, -30, PH * 0.84 - H0, H0 * sa.width / sa.height, { shadow: 'rgba(0,0,0,0.8)', blur: 30 });
    for (const [x, y, s, r] of [[70, 300, 64, -0.2], [560, 360, 58, 0.15], [110, 520, 50, -0.1], [540, 600, 70, 0.2]] as const) {
      text(g, 'ゴ', x, y, { font: JP(s), fill: '#c890ff', stroke: '#1a0630', sw: 8, rot: r });
    }
    halftone(g, 0, 140, PW, Math.round(PH * 0.7), 5, 0.18);
    text(g, 'ศึกยืนท่าเท่', PW / 2, 104, { font: DISPLAY(80), fill: gold(g, 80), stroke2: '#000', sw2: 16, stroke: '#4a0a6a', sw: 8, extrude: '#1a0028', ex: 7, maxW: PW - 40 });
    text(g, 'STANDING POSE CHAMPIONSHIP', PW / 2, 146, { font: JP(26), fill: '#fff', spacing: 2, maxW: PW - 60 });
    strip(g, PH - 110, 110, 'rgba(10,4,20,0.92)');
    text(g, 'ไม่ต้องต่อย แค่ยืนให้น่ากลัวที่สุด', PW / 2, PH - 66, { font: SERIF(32), fill: '#fff', maxW: PW - 40 });
    text(g, 'NO PUNCHES. JUST MENACE.  ·  คืนวันเสาร์ ห้องวีไอพี', PW / 2, PH - 26, { font: SERIF(20, 700), fill: '#ffd34a', maxW: PW - 40 });
  } },

  // ---------------------------------------------------------------- casino wall: WANTED (the long-coat guy who sighs)
  { id: 'casino_wanted', cat: 'casino', draw: async ({ g, game, st, paper }) => {
    g.fillStyle = '#e8dcbc'; g.fillRect(0, 0, PW, PH);
    if (paper) photo(g, paper, 0, 0, PW, PH, { alpha: 0.9, filter: 'sepia(0.5) brightness(1.08)' });
    const a = await person(game, 'anime_delinquent', { seed: 3, anim: 'cine_cross', expr: 'smug', yaw: -0.15 });
    const s = body(st, a, { crop: 'bust', key: [-1.2, 2.4, -2.2] });
    a.dispose();
    text(g, 'ตามหา!', PW / 2, 128, { font: SERIF(120), fill: '#5a1a0a' });
    text(g, 'W A N T E D', PW / 2, 172, { font: SERIF(32, 700), fill: '#3a2010' });
    const fx = 110, fy = 200, fw = PW - 220, fh = 400;
    g.fillStyle = '#cbb890'; g.fillRect(fx, fy, fw, fh);
    g.save(); g.beginPath(); g.rect(fx, fy, fw, fh); g.clip();
    const sh = fh * 0.98, sw = s.width * (sh / s.height);
    place(g, s, fx + (fw - sw) / 2, fy + fh - sh + 6, sw, { filter: 'grayscale(1) sepia(0.6) contrast(1.25) brightness(0.95)' });
    g.restore();
    halftone(g, fx, fy, fw, fh, 4, 0.3);
    g.strokeStyle = '#2a1a10'; g.lineWidth = 5; g.strokeRect(fx, fy, fw, fh);
    text(g, 'ชายหมวกดำ เสื้อโค้ทยาว', PW / 2, 660, { font: SERIF(38), fill: '#3a2010', maxW: PW - 80 });
    text(g, 'ถอนหายใจ "เฮ้อ…" ทุก 5 นาที ยืนท่าแปลกขวางโต๊ะ', PW / 2, 704, { font: SERIF(24, 700), fill: '#3a2010', maxW: PW - 80 });
    text(g, 'ค่าหัว: ข้าวมันไก่ 1 จาน', PW / 2, 780, { font: SERIF(52), fill: '#8a1a10', maxW: PW - 60 });
    text(g, '(ไม่เอาเครื่องใน)', PW / 2, 820, { font: SERIF(24, 700), fill: '#5a3a20' });
  } },

  // ---------------------------------------------------------------- restaurant: thank-you poster
  { id: 'shop_thanks', cat: 'shop', draw: async ({ g, game, st, seed }) => {
    const bgp = await asset('img/newspaper/photos/kaprao_egg_closeup_color.jpg');
    g.fillStyle = '#ffd21f'; g.fillRect(0, 0, PW, PH);
    photo(g, bgp, 0, PH * 0.42, PW, PH * 0.58, { filter: 'saturate(1.3) contrast(1.1)' });
    vgrad(g, 0, PH * 0.42, PW, 140, [[0, '#ffd21f'], [1, 'rgba(255,210,31,0)']]);
    rays(g, PW / 2, PH * 0.3, 24, 800, 'rgba(255,255,255,0.22)', 0.1);
    const c = await person(game, 'player', { anim: 'give', expr: 'happy', yaw: -0.3, hold: 'plate', look: { top: { id: 'chef_jacket', color: '#f2f0ea' } } });
    const s = body(st, c, { crop: 'waist', key: [-1.4, 2.4, -2.4] });
    c.dispose();
    const w = PW * 0.86;
    place(g, s, (PW - w) / 2 + 20, PH * 0.2, w, { shadow: 'rgba(80,40,0,0.45)', blur: 24 });
    text(g, 'ขอบคุณ', PW / 2, 112, { font: SERIF(108), fill: '#c01212', stroke2: '#fff', sw2: 18, extrude: '#7a0808', ex: 6 });
    text(g, 'ที่อุดหนุน', PW / 2, 168, { font: SERIF(48), fill: '#1a1210' });
    strip(g, PH - 120, 120, '#c01212');
    text(g, 'อร่อยบอกเพื่อน', PW / 2, PH - 72, { font: SERIF(40), fill: '#ffd21f' });
    text(g, 'ไม่อร่อย... บอกเฮีย (เบาๆ นะ)', PW / 2, PH - 28, { font: SERIF(26, 700), fill: '#fff' });
    void seed;
  } },
];

/** generate every poster → [{ id, cat, url (webp data URL) }] */
export async function generatePosters(game: Game, only?: string[]) {
  const st = new Studio(game.engine.renderer);
  const paper = await Assets.image('textures/pbr/paper_creased/albedo.jpg').catch(() => null);
  await (document as any).fonts?.ready;
  await Promise.all([`400 40px ${F.display}`, `900 40px ${F.news}`, `900 40px ${F.news2}`, `700 40px ${F.bubbly}`, '400 40px "Dela Gothic One"'].map((f) => (document as any).fonts.load(f, 'กขAB').catch(() => null)));
  const out: { id: string; cat: string; url: string; w: number; h: number }[] = [];
  for (const p of POSTERS) {
    if (only && !only.includes(p.id)) continue;
    const cv = document.createElement('canvas');
    cv.width = PW; cv.height = PH;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const seed = hashStr(p.id);
    try {
      await p.draw({ g, game, st, seed, paper });
      printFinish(g, PW, PH, seed, paper, { mis: 1.6, wear: 0.5, fold: true });
      out.push({ id: p.id, cat: p.cat, url: cv.toDataURL('image/png'), w: PW, h: PH });
      console.info('[posters] done', p.id);
    } catch (e) { console.error('[posters] failed', p.id, e); }
  }
  st.dispose();
  return out;
}
