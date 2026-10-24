import * as THREE from 'three';
import type { Game } from '../../game/game';
import { asset } from '../../core/util';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { loadImg } from './lettering';
import { sfx } from './sfx';
import { headlineTemplates, HeadlineTpl, SIDE_STORIES } from './lines';

/* ============================================================================================
 * "ไทยรั่ว" – the parody Thai tabloid (R4 newspaper kit: public/assets/img/newspaper + layout.json,
 * real halftoned photos). The front page is composed on a 1448×2048 canvas from the day's stats
 * (g.dayStats from the restaurant module) + lines.json headline templates, then shown as a 3D
 * newspaper the player holds and reads: flies in, sways, click turns the page, click again folds away.
 *   (game as any).newspaper.show(stats?) → Promise<void>   (social module calls it every new day)
 * ========================================================================================== */

export interface DayStatsIn { [k: string]: any }
interface Stats { day: number; money: number; customers: number; dish: string; rating: number; events: string[]; mood: 'day1' | 'good' | 'bad' | 'neutral' }

const K = 'img/newspaper/';
const DISH_TH: Record<string, string> = {
  kaphrao_moo: 'กะเพราหมูสับ', khai_dao: 'ไข่ดาว', khai_jiao: 'ไข่เจียว', khao_phat: 'ข้าวผัด', phat_phrik_kaeng: 'ผัดพริกแกง', phat_si_io: 'ผัดซีอิ๊ว',
  rat_na: 'ราดหน้า', tom_yam: 'ต้มยำ', moo_kratiam: 'หมูกระเทียม', phat_phak_bung: 'ผัดผักบุ้ง',
};

function normStats(game: Game, s?: DayStatsIn | null): Stats {
  const g: any = s ?? (game.g as any).dayStats ?? {};
  const num = (...ks: string[]) => { for (const k of ks) { const v = g[k]; if (typeof v === 'number' && isFinite(v)) return v; } return undefined; };
  const day = num('day') ?? (game.g.day as number) ?? 1;
  const money = Math.round(num('revenue', 'money', 'income', 'earned', 'sales') ?? 0);
  const customers = Math.round(num('customers', 'served', 'customerCount', 'guests') ?? 0);
  let rating = num('rating', 'avgRating', 'stars', 'ratingAvg') ?? 0;
  if (rating > 5) rating = rating / 20; // 0..100 → stars
  let dish: string = g.bestDish ?? g.topDish ?? g.dish ?? g.best ?? 'kaphrao_moo';
  if (typeof dish === 'object') dish = (dish as any).th ?? (dish as any).name?.th ?? (dish as any).recipe ?? 'kaphrao_moo';
  dish = DISH_TH[dish] ?? dish;
  const events: string[] = Array.isArray(g.events) ? g.events.map((e: any) => (typeof e === 'string' ? e : e?.th ?? e?.text ?? '')).filter(Boolean) : [];
  const mood: Stats['mood'] = day <= 1 && money < 200 ? 'day1' : rating >= 3.6 || money >= 1500 ? 'good' : (rating > 0 && rating < 2.6) || (customers > 0 && customers < 5) ? 'bad' : 'neutral';
  return { day, money, customers, dish, rating: Math.round(rating * 10) / 10, events, mood };
}

function fill(t: string, s: Stats) {
  return t.replace(/\{money\}/g, s.money.toLocaleString('th-TH')).replace(/\{customers\}/g, String(s.customers)).replace(/\{dish\}/g, s.dish)
    .replace(/\{rating\}/g, s.rating.toFixed(1)).replace(/\{day\}/g, String(s.day));
}

// ------------------------------------------------------------------ front page canvas

export async function renderFrontPage(s: Stats): Promise<HTMLCanvasElement> {
  const layout: any = await fetch(asset(K + 'layout.json')).then((r) => r.json()).catch(() => null);
  const R = layout?.regions ?? {};
  const W = layout?.page?.width ?? 1448, H = layout?.page?.height ?? 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const tpl = await loadImg(asset(K + (layout?.page?.template ?? 'front_template_blank.jpg')));
  if (tpl) ctx.drawImage(tpl, 0, 0, W, H); else { ctx.fillStyle = '#e9e3d4'; ctx.fillRect(0, 0, W, H); }
  const INK = '#1F1C1C', RED = '#D5271A', BLUE = '#1C2A7A', PAPER = '#E6E1D3';
  const fnt = (w: number, size: number, fam: string = F.looped) => `${w} ${size}px ${fam}, ${F.body}`;
  // condensed text that fits a region
  const fit = (text: string, r: any, size: number, w: number, color: string, o: { minSX?: number; maxSX?: number; align?: string; fam?: string; mode?: GlobalCompositeOperation; dy?: number } = {}) => {
    if (!r) return;
    ctx.save();
    ctx.font = fnt(w, size, o.fam);
    let m = ctx.measureText(text);
    const minSX = o.minSX ?? 0.62;
    // still too wide at the narrowest condense → shrink the type
    if (m.width * minSX > r.w) { size = Math.floor(size * r.w / (m.width * minSX)); ctx.font = fnt(w, size, o.fam); m = ctx.measureText(text); }
    const sx = Math.max(minSX, Math.min(o.maxSX ?? 1, r.w / Math.max(1, m.width)));
    const realW = m.width * sx;
    let x = r.x;
    if (o.align === 'center') x = r.x + (r.w - realW) / 2; else if (o.align === 'right') x = r.x + r.w - realW;
    ctx.globalCompositeOperation = o.mode ?? 'multiply';
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.translate(x, r.y + r.h * 0.5 + size * 0.36 + (o.dy ?? 0));
    ctx.scale(sx, 1);
    ctx.filter = 'blur(0.35px)';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const para = (text: string, r: any, size: number, lh: number, color: string, w = 400, fam: string = F.looped, maxLines = 99) => {
    if (!r) return;
    ctx.save();
    ctx.font = fnt(w, size, fam);
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = 'multiply';
    ctx.filter = 'blur(0.3px)';
    const seg: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;
    const words: string[] = seg ? [...seg.segment(text)].map((x: any) => x.segment) : text.split(/(\s+)/);
    let line = '', y = r.y + size, n = 0;
    for (const wd of words) {
      if (line && ctx.measureText(line + wd).width > r.w) {
        ctx.fillText(line.trim(), r.x, y); y += lh; line = wd.trimStart(); n++;
        if (n >= maxLines || y > r.y + r.h) { line = ''; break; }
      } else line += wd;
    }
    if (line && n < maxLines && y <= r.y + r.h + size * 0.3) ctx.fillText(line.trim(), r.x, y);
    ctx.restore();
  };
  const photo = async (key: string, r: any) => {
    if (!r) return;
    const ph = layout?.photos?.[key]?.color ?? `photos/${key}_color.jpg`;
    const im = await loadImg(asset(K + ph));
    if (!im) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const k = Math.max(r.w / im.width, r.h / im.height);
    const sw = r.w / k, sh = r.h / k;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    ctx.restore();
  };
  // ---- pick the story
  const tpls = headlineTemplates();
  const pool = tpls.filter((t) => (t.mood ?? 'neutral') === s.mood);
  const pickT: HeadlineTpl = (pool.length ? pool : tpls)[Math.floor(Math.random() * (pool.length || tpls.length))];
  const parts = fill(pickT.th, s).split('|');
  let h1 = parts[0] ?? '', h2 = parts[1] ?? '';
  if (!h2) { // split a single-line template in two: after "!" if there is one, else at the space nearest the middle
    const bang = h1.indexOf('!');
    let cut = bang > 3 && bang < h1.length - 3 ? bang + 1 : -1;
    if (cut < 0) {
      let best = -1;
      for (let i = 0; i < h1.length; i++) if (h1[i] === ' ' && (best < 0 || Math.abs(i - h1.length / 2) < Math.abs(best - h1.length / 2))) best = i;
      cut = best;
    }
    if (cut > 0) { h2 = h1.slice(cut).trim(); h1 = h1.slice(0, cut).trim(); }
  }
  // ---- dynamic regions
  fit(String(s.day), R.day_number, 96, 900, INK, { align: 'center', minSX: 0.6 });
  const now = new Date();
  const wd = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][now.getDay()];
  const months = layout?.date_format?.months ?? ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const dl = R.dateline;
  if (dl) {
    const mid = `วัน${wd}ที่ ${now.getDate()} ${months[now.getMonth()]} พ.ศ. ${now.getFullYear() + 543}`;
    fit(`ปีที่ 1 ฉบับที่ ${s.day}`, { ...dl, w: dl.w * 0.3 }, 22, 600, INK, { fam: F.body });
    fit(mid, { ...dl, x: dl.x + dl.w * 0.3, w: dl.w * 0.4 }, 22, 600, INK, { fam: F.body, align: 'center' });
    fit('ราคา 10 บาท  ·  ไทยรั่วออนไลน์', { ...dl, x: dl.x + dl.w * 0.7, w: dl.w * 0.3 }, 22, 600, INK, { fam: F.body, align: 'right' });
  }
  if (R.kicker && (pickT.kicker || s.mood)) {
    const kt = pickT.kicker ?? (s.mood === 'good' ? 'ข่าวดี!' : s.mood === 'bad' ? 'สลด!' : 'ข่าวเด่น');
    ctx.save();
    ctx.font = fnt(900, 34);
    const kw = Math.min(R.kicker.w, ctx.measureText(kt).width * 0.8 + 40);
    ctx.fillStyle = R.kicker.bg ?? '#D5271A';
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillRect(R.kicker.x, R.kicker.y, kw, R.kicker.h);
    ctx.restore();
    fit(kt, { ...R.kicker, x: R.kicker.x + 18, w: kw - 36 }, 34, 900, PAPER, { mode: 'source-over', maxSX: 0.8 });
  }
  fit(h1, R.headline_1, 170, 900, INK, { maxSX: 0.78 });
  fit(h2, R.headline_2, 170, 900, RED, { maxSX: 0.78 });
  const ph = layout?.photo_suggestions?.[s.mood === 'neutral' ? 'event' : s.mood] ?? ['kaprao_egg'];
  await photo(ph[Math.floor(Math.random() * ph.length)], R.photo_main);
  const cap = s.mood === 'day1' ? 'บรรยากาศหน้าร้านเฮียผัดวันแรก ลูกค้ายังงง ๆ ว่าใครเป็นพ่อครัว (ภาพประกอบ)'
    : s.mood === 'good' ? `ลูกค้า ${s.customers} คนต่อคิวยาวเหยียด เพื่อ${s.dish}จานเด็ด (ภาพประกอบ)`
      : s.mood === 'bad' ? 'เตาร้อนแต่ร้านเงียบ เฮียผัดยืนพัดเตารอลูกค้าทั้งบ่าย (ภาพประกอบ)' : `${s.dish} จานนี้ ราคานี้ ซอยนี้เท่านั้น (ภาพประกอบ)`;
  para(cap, R.caption_main, 23, 30, INK, 600, F.body, 2);
  const deck = s.mood === 'good' ? ['ยอดขายพุ่งกระฉูด ลูกค้าแน่นซอย', `${s.dish} ขายดีเป็นเทน้ำเทท่า`, 'ป้าข้างบ้านเริ่มอิจฉา!']
    : s.mood === 'bad' ? ['ขายไม่ออก! กระทะเย็นเฉียบ', `ลูกค้าบ่น ${s.dish} รสชาติแปลก`, 'สี่หนุ่มประชุมด่วนกลางดึก']
      : s.mood === 'day1' ? ['ตื่นมากลางซอยในชุดเสื้อกล้าม', 'ลุงจับได้คาหนังคาเขา ขายให้ร้อยเดียว', 'หมาจรฉกหมูสับ วิ่งหนีเข้าซอย!']
        : ['ชีวิตพ่อค้ากะเพราไม่ง่าย', `วันที่ ${s.day} ขายได้ ${s.money.toLocaleString('th-TH')} บาท`, 'พรุ่งนี้สู้ใหม่!'];
  const D = R.deck;
  if (D) deck.forEach((t, i) => fit(t, { x: D.x, y: D.y + i * (D.h / 3), w: D.w, h: D.h / 3 }, 44, 800, [RED, BLUE, INK][i], { maxSX: 0.85 }));
  const body = s.events.length ? `ผู้สื่อข่าวรายงานว่า วันนี้ที่ร้านเฮียผัด ${s.events.slice(0, 3).join(' ')} ทั้งนี้ยอดขายรวมอยู่ที่ ${s.money.toLocaleString('th-TH')} บาท จากลูกค้า ${s.customers} คน`
    : `ผู้สื่อข่าวรายงานว่า เมื่อวานนี้ร้านอาหารตามสั่งของสี่หนุ่มหมดตัวในซอยเก่า มีลูกค้าแวะเวียนมาทั้งหมด ${s.customers} คน ทำยอดขายได้ ${s.money.toLocaleString('th-TH')} บาท เมนูที่ขายดีที่สุดคือ ${s.dish} ได้คะแนนรีวิวเฉลี่ย ${s.rating.toFixed(1)} ดาว ชาวบ้านละแวกนั้นต่างพากันวิจารณ์ทั้งรสชาติและความวุ่นวายหน้าเตา`;
  para(body, R.body_main, 20, 27, INK, 400, F.looped);
  // stats box (erase the dotted leader first)
  const stat = (r: any, text: string, color = INK) => {
    if (!r) return;
    ctx.save();
    ctx.font = fnt(900, 34);
    const tw = Math.min(r.w, ctx.measureText(text).width * Math.max(0.62, Math.min(0.9, r.w / Math.max(1, ctx.measureText(text).width))));
    ctx.fillStyle = r.bg ?? '#F1ECDF';
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillRect(r.x + r.w - tw - 14, r.y + 4, tw + 14, r.h - 8);
    ctx.restore();
    fit(text, r, 34, 900, color, { align: 'right', maxSX: 0.9 });
  };
  stat(R.stat_money, s.money.toLocaleString('th-TH'), RED);
  stat(R.stat_customers, String(s.customers));
  stat(R.stat_dish, s.dish);
  const stars = Math.round(Math.max(0, Math.min(5, s.rating)));
  stat(R.stat_rating, `${s.rating.toFixed(1)} ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`, RED);
  // side story under the black bar
  const side = SIDE_STORIES[(s.day + Math.floor(Math.random() * 3)) % SIDE_STORIES.length];
  fit(side.head, R.headline_bar, 64, 900, PAPER, { mode: 'source-over', minSX: 0.62, maxSX: 0.92 });
  const sp = layout?.photo_suggestions?.event ?? ['soi_dog_sitting'];
  await photo(side.head.includes('หมา') ? 'soi_dog' : side.head.includes('ผี') ? 'traffic_night' : sp[Math.floor(Math.random() * sp.length)], R.photo_second);
  para(side.head.split('!')[0], R.caption_second, 19, 24, INK, 600, F.body, 1);
  para(side.body, R.text_second, 18, 24, INK, 400, F.looped, 3);
  const n1 = String(Math.floor(Math.random() * 100)).padStart(2, '0'), n2 = String((s.money + s.customers) % 100).padStart(2, '0');
  fit(`${n1} · ${n2}`, R.lotto_numbers, 64, 900, INK, { align: 'center', maxSX: 0.85 });
  return cv;
}

/** Back page: newsprint + classified ads from the kit + a funny big headline. */
async function renderBackPage(s: Stats): Promise<HTMLCanvasElement> {
  const cv = document.createElement('canvas');
  cv.width = 1448; cv.height = 2048;
  const ctx = cv.getContext('2d')!;
  const tile = await loadImg(asset(K + 'newsprint_tile_2048.jpg'));
  if (tile) { ctx.drawImage(tile, 0, 0, 1448, 2048); } else { ctx.fillStyle = '#e6e1d3'; ctx.fillRect(0, 0, 1448, 2048); }
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#1F1C1C';
  ctx.font = `900 120px ${F.looped}`;
  ctx.save(); ctx.translate(60, 190); ctx.scale(0.72, 1); ctx.fillText('ประกาศ · ซื้อ-ขาย · หางาน', 0, 0); ctx.restore();
  ctx.fillRect(60, 220, 1328, 8);
  const ads = ['ad_herbal.png', 'ad_lottery.png', 'ad_room_for_rent.png', 'ad_takrut.png'];
  for (let i = 0; i < 12; i++) {
    const im = await loadImg(asset(K + 'parts/' + ads[i % 4]));
    if (im) ctx.drawImage(im, 60 + (i % 3) * 450, 270 + Math.floor(i / 3) * 400, 420, 330);
  }
  ctx.font = `800 40px ${F.looped}`;
  ctx.fillStyle = '#D5271A';
  ctx.fillText(`รับสมัครคนผัดกะเพรา ด่วน! ไม่ต้องมีประสบการณ์ ทักเฮียหน้าซอย (วันที่ ${s.day})`, 60, 1960);
  return cv;
}

// ------------------------------------------------------------------ 3D presenter

export class Newspaper {
  private showing: Promise<void> | null = null;
  constructor(private game: Game) {}

  /** The composed front page as a canvas (1448×2048) – e.g. to lay the paper on a table in the world. */
  async frontPage(stats?: DayStatsIn | null): Promise<HTMLCanvasElement> { return renderFrontPage(normStats(this.game, stats)); }

  show(stats?: DayStatsIn | null): Promise<void> {
    if (this.showing) return this.showing;
    this.showing = this.run(stats).catch((e) => console.error('[newspaper]', e)).finally(() => { this.showing = null; });
    return this.showing;
  }

  private async run(stats?: DayStatsIn | null) {
    const game = this.game;
    const s = normStats(game, stats);
    const [front, back] = await Promise.all([renderFrontPage(s), renderBackPage(s)]);
    const scene = game.engine.scene;
    const cam = game.engine.camera;
    const mk = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const tf = mk(front), tb = mk(back);
    // a broadsheet half (portrait), slightly cupped like paper held in two hands
    const PW = 0.36, PH = PW * 2048 / 1448;
    const geo = new THREE.PlaneGeometry(PW, PH, 24, 24);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const cup = Math.pow(x / (PW / 2), 2) * 0.018 + Math.sin(y * 9 + x * 3) * 0.0012;
      // the old centre fold shows as a soft ridge
      pos.setZ(i, cup - Math.exp(-Math.pow(x / 0.012, 2)) * 0.002);
    }
    geo.computeVertexNormals();
    const mf = new THREE.MeshLambertMaterial({ map: tf, emissiveMap: tf, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.FrontSide });
    // back page: same sheet, back faces, texture mirrored so it reads correctly after the flip
    tb.wrapS = THREE.RepeatWrapping;
    tb.repeat.x = -1;
    tb.offset.x = 1;
    const mb = new THREE.MeshLambertMaterial({ map: tb, emissiveMap: tb, emissive: 0xffffff, emissiveIntensity: 0.5, side: THREE.BackSide });
    const paper = new THREE.Group();
    const a = new THREE.Mesh(geo, mf), b = new THREE.Mesh(geo, mb);
    paper.add(a, b);
    paper.renderOrder = 5;
    const holder = new THREE.Group();
    holder.add(paper);
    scene.add(holder);
    // freeze gameplay, focus
    const pl = game.player;
    const prevMode = pl?.mode;
    if (pl && prevMode === 'play') pl.setMode('frozen');
    const post = game.engine.post;
    const dofWas = !!(post as any).dofPass?.enabled;
    post.setDOF(true, 0.45, 3.5);
    sfx.whoosh();
    sfx.paper();
    let t = 0, state: 'in' | 'read' | 'flip' | 'back' | 'out' = 'in', st = 0, flip = 0, zoom = 1, zoomT = 1, panX = 0, panY = 0;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const hint = { el: null as HTMLDivElement | null };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    const off = game.engine.onLate((f) => {
      const dt = Math.min(0.05, f.rawDt);
      t += dt; st += dt;
      // follow the camera
      cam.updateMatrixWorld();
      holder.position.setFromMatrixPosition(cam.matrixWorld);
      holder.quaternion.setFromRotationMatrix(m4.extractRotation(cam.matrixWorld));
      const inK = state === 'in' ? Math.min(1, st / 0.55) : 1;
      const outK = state === 'out' ? Math.min(1, st / 0.45) : 0;
      const e = 1 - Math.pow(1 - inK, 3);
      if (Input.locked) { panX = Math.max(-1, Math.min(1, panX + Input.mouseDX * 0.003)); panY = Math.max(-1, Math.min(1, panY - Input.mouseDY * 0.003)); }
      else { panX = Input.ndc.x; panY = Input.ndc.y; }
      if (Input.wheel) zoomT = Math.max(1, Math.min(2.2, zoomT - Input.wheel * 0.25));
      if (Input.wasPressed('Equal') || Input.wasPressed('NumpadAdd')) zoomT = Math.min(2.2, zoomT + 0.4);
      if (Input.wasPressed('Minus') || Input.wasPressed('NumpadSubtract')) zoomT = Math.max(1, zoomT - 0.4);
      zoom += (zoomT - zoom) * Math.min(1, dt * 8);
      const pc = cam as THREE.PerspectiveCamera;
      const halfH = Math.tan(THREE.MathUtils.degToRad((pc.fov || 60) / 2));
      // distance at which the whole page fills ~92% of the view height, divided by the zoom
      const dist = (PH / (2 * halfH * 0.92)) / zoom;
      const zk = (zoom - 1) / 1.2;
      const visH = 2 * dist * halfH, visW = visH * (pc.aspect || 1.78);
      const px = -panX * Math.max(0, PW - visW) * 0.5 * Math.min(1, zk * 2), py = -panY * Math.max(0, PH - visH) * 0.5;
      paper.position.set(px + Math.sin(t * 0.9) * 0.004 * dist, py + (1 - e) * -0.55 * dist * 2 + outK * -0.6 * dist * 2 + Math.sin(t * 1.3) * 0.003 * dist, -dist - (1 - e) * 0.2);
      paper.rotation.set(-0.04 + (1 - e) * -1.1 + outK * -0.9 + panY * 0.03 * (1 - zk), (1 - e) * 0.5 + panX * 0.05 * (1 - zk) + flip * Math.PI, (1 - e) * 0.3 + Math.sin(t * 0.7) * 0.01 + outK * 0.4);
      // advance
      if (state === 'in' && st > 0.55) { state = 'read'; st = 0; showHint(hint, 'คลิกเพื่อพลิกหน้า · ลูกกลิ้งเมาส์ซูม — click to turn the page · wheel to zoom'); }
      const pressed = Input.mousePressed(0) || Input.wasPressed('Space') || Input.wasPressed('KeyE') || Input.wasPressed('Enter') || Input.wasPressed('KeyF');
      const esc = Input.wasPressed('Escape') || Input.wasPressed('KeyQ');
      if ((state === 'read' || state === 'back') && esc) { state = 'out'; st = 0; sfx.paper(); }
      else if (state === 'read' && pressed && st > 0.25) { state = 'flip'; st = 0; sfx.page(); }
      else if (state === 'flip') { flip = Math.min(1, st / 0.6); flip = flip < 0.5 ? 2 * flip * flip : 1 - Math.pow(-2 * flip + 2, 2) / 2; if (st > 0.6) { state = 'back'; st = 0; flip = 1; showHint(hint, 'คลิกเพื่อพับเก็บ · click to fold it away'); } }
      else if (state === 'back' && pressed && st > 0.25) { state = 'out'; st = 0; sfx.paper(); sfx.whoosh(); }
      else if (state === 'out' && st > 0.45) {
        off();
        scene.remove(holder);
        geo.dispose(); mf.dispose(); mb.dispose(); tf.dispose(); tb.dispose();
        hideHint(hint);
        if (!dofWas) post.setDOF(false);
        if (pl && prevMode === 'play' && game.player === pl) pl.setMode('play');
        resolve();
      }
      void q; void v;
    });
    Sound.preload(['page_turn', 'paper_rustle']);
    await done;
  }
}

function showHint(h: { el: HTMLDivElement | null }, text: string) {
  if (!h.el) {
    h.el = document.createElement('div');
    h.el.style.cssText = `position:fixed;left:50%;bottom:5vh;transform:translateX(-50%);z-index:11;pointer-events:none;color:#fff8e6;font:600 clamp(13px,1.3vw,18px) ${F.body};text-shadow:0 2px 4px #000;opacity:0;transition:opacity .4s`;
    document.body.appendChild(h.el);
  }
  h.el.textContent = text;
  requestAnimationFrame(() => { if (h.el) h.el.style.opacity = '0.9'; });
}
function hideHint(h: { el: HTMLDivElement | null }) { const el = h.el; if (!el) return; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); h.el = null; }

export const SAMPLE_STATS = { day: 3, revenue: 1840, customers: 37, bestDish: 'kaphrao_moo', rating: 4.2, events: ['หมาจรขโมยไข่ดาวไปหนึ่งฟอง', 'ลูกค้าสั่งเผ็ดสิบเม็ดแล้วร้องไห้'] };
