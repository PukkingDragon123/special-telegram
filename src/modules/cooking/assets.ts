import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { mulberry } from './util';

/**
 * Texture lookup for the cooking module.
 *
 * CLIENT RULE: all art is real photos from the internet. The research agents ship them in
 *   textures/food/, textures/props/, img/labels/ (+ my own processed downloads in gen/cooking/).
 * Every texture here is LATE-BOUND: a THREE.Texture is returned immediately (with a tiny neutral
 * placeholder canvas), and its image is swapped for the real photo as soon as a manifest entry
 * matching the slot's keywords is found — so materials never need rebuilding.
 */

interface Entry { id: string; file: string; text: string; alpha?: boolean; dir: string; meta?: any }
const entries: Entry[] = [];
let ready = false;
const waiting: (() => void)[] = [];

const MANIFESTS: [string, string][] = [
  ['gen/cooking/', 'gen/cooking/manifest.json'],
  ['textures/food/', 'textures/food/manifest.json'],
  ['textures/props/', 'textures/props/manifest.json'],
  ['img/labels/', 'img/labels/manifest.json'],
];

function isImg(s: any) { return typeof s === 'string' && /\.(jpe?g|png|webp)$/i.test(s); }

/** Walk any manifest shape and collect {id, file, text} records. */
function harvest(dir: string, node: any, idHint: string, out: Entry[], depth = 0) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) { node.forEach((n, i) => harvest(dir, n, idHint, out, depth + 1)); return; }
  if (typeof node !== 'object') return;
  const id = String(node.id ?? node.name ?? node.key ?? idHint ?? '');
  let file: string | null = null;
  for (const k of ['file', 'albedo', 'image', 'path', 'src', 'png', 'jpg', 'webp', 'texture', 'flat', 'label']) if (isImg(node[k])) { file = node[k]; break; }
  if (!file && Array.isArray(node.files)) {
    const fs = node.files.filter(isImg) as string[];
    // prefer the clean (non-worn) variant
    file = fs.find((f) => !/worn|grease|dirty/i.test(f)) ?? fs[0] ?? null;
  }
  if (file) {
    const text = [id, node.product, node.desc, node.description, node.brand, node.brand_th, node.brand_en, node.kind, node.topic, node.use, (node.tags ?? []).join?.(' '), file]
      .filter(Boolean).join(' ').toLowerCase();
    out.push({ id: id.toLowerCase(), file, text, alpha: !!(node.alpha ?? /\.png$/i.test(file)), dir, meta: node });
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'note' || k === 'license') continue;
    if (typeof v === 'object') harvest(dir, v, k, out, depth + 1);
    else if (isImg(v)) out.push({ id: k.toLowerCase(), file: v as string, text: (k + ' ' + v).toLowerCase(), alpha: /\.png$/i.test(v as string), dir });
  }
}

function resolvePath(dir: string, f: string) {
  const s = f.replace(/^\.?\//, '').replace(/^(public\/)?assets\//, '');
  return /^(textures|img|gen|audio|models)\//.test(s) ? s : dir + s;
}

export async function loadCookingManifests() {
  await Promise.all(MANIFESTS.map(async ([dir, path]) => {
    const js = await Assets.jsonSafe<any>(path, null);
    if (!js) return;
    const out: Entry[] = [];
    harvest(dir, js, '', out);
    // relative paths inside the manifest are relative to its folder
    for (const e of out) e.file = resolvePath(dir, e.file);
    entries.push(...out);
  }));
  ready = true;
  for (const w of waiting.splice(0)) w();
}

export function manifestEntries() { return entries; }

/**
 * Find the best entry for a slot. `keys` are tried in order (earlier = better); each key may be a
 * phrase of words that must ALL appear. `not` words exclude entries.
 */
export function findEntry(keys: string[], not: string[] = [], dirs?: string[]): Entry | null {
  let best: Entry | null = null, bestScore = 0;
  for (const e of entries) {
    if (dirs && !dirs.some((d) => e.dir.startsWith(d))) continue;
    if (not.some((n) => e.text.includes(n))) continue;
    for (let i = 0; i < keys.length; i++) {
      const words = keys[i].toLowerCase().split(/\s+/);
      if (!words.every((w) => e.text.includes(w))) continue;
      let score = (keys.length - i) * 10 + (e.id === keys[i].toLowerCase() ? 50 : 0) + (e.dir.startsWith('gen/') ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
      break;
    }
  }
  return best;
}

// ------------------------------------------------------------------ late-bound textures

const lateCache = new Map<string, THREE.Texture>();

export interface LateOpts { srgb?: boolean; repeat?: [number, number]; clamp?: boolean; flipY?: boolean }

/**
 * Texture for a slot: placeholder now, real photo when found. `fallback` paints a temporary
 * neutral canvas (only visible until the real asset arrives).
 */
export function lateTex(slot: string, keys: string[], fallback: (ctx: CanvasRenderingContext2D, S: number) => void, o: LateOpts & { not?: string[]; dirs?: string[]; size?: number } = {}): THREE.Texture {
  const hit = lateCache.get(slot);
  if (hit) return hit;
  const S = o.size ?? 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  try { fallback(ctx, S); } catch {}
  const tex = new THREE.Texture(cv);
  tex.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  (tex as any).userData = { slot, real: false };
  lateCache.set(slot, tex);
  const bind = () => {
    const e = findEntry(keys, o.not ?? [], o.dirs);
    if (!e) return;
    Assets.image(e.file).then((img) => {
      tex.image = img;
      if (o.flipY !== undefined) tex.flipY = o.flipY;
      tex.needsUpdate = true;
      (tex as any).userData = { slot, real: true, file: e.file };
    }).catch(() => {});
  };
  if (ready) bind(); else waiting.push(bind);
  return tex;
}

/** Was a real photo found for this slot yet? */
export function isReal(t: THREE.Texture | null | undefined) { return !!(t as any)?.userData?.real; }

// ------------------------------------------------------------------ placeholder painters (TEMP — replaced by real photos)

export function speckle(base: string, dots: [string, number, number][], seed = 1) {
  return (ctx: CanvasRenderingContext2D, S: number) => {
    const r = mulberry(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    for (const [col, n, size] of dots) {
      ctx.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const x = r() * S, y = r() * S, s = size * (0.5 + r());
        ctx.beginPath();
        ctx.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 6.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
}

/** Plain placeholder label: product name on a colour band (TEMP until the real label photo lands). */
export function placeholderLabel(th: string, bg: string, fg = '#fff') {
  return (ctx: CanvasRenderingContext2D, S: number) => {
    ctx.canvas.width = S * 2; ctx.canvas.height = S;
    const W = S * 2;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, S);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(0, S * 0.1, W, S * 0.08);
    ctx.fillStyle = fg;
    ctx.font = `700 ${Math.round(S * 0.22)}px ${F.heavy}, "Sarabun", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(th, W / 2, S * 0.55);
  };
}

// ------------------------------------------------------------------ food & label slots

const FOOD = ['textures/food/', 'gen/cooking/'];
const LAB = ['img/labels/', 'gen/cooking/', 'textures/props/'];

export const T = {
  rice: () => lateTex('rice', ['rice_close', 'cooked rice', 'steamed rice', 'rice grains', 'jasmine rice cooked', 'rice'], speckle('#f1ece0', [['#fffdf6', 260, 3], ['#d9d1c0', 90, 2]], 3), { dirs: FOOD, not: ['raw', 'sack', 'bag', 'fried', 'paddy', 'field'] }),
  riceMound: () => lateTex('riceMound', ['rice_mound', 'rice plate top', 'rice_close', 'rice'], speckle('#efe9dc', [['#fffef8', 260, 3], ['#d6cdbb', 90, 2]], 4), { dirs: FOOD, not: ['raw', 'sack', 'bag', 'fried', 'paddy', 'field'] }),
  porkRaw: () => lateTex('porkRaw', ['pork_raw', 'minced pork raw', 'raw minced', 'ground pork', 'pork mince'], speckle('#d98c8c', [['#efb4ad', 240, 3], ['#b45f63', 140, 3], ['#f6e3dc', 60, 2]], 5), { dirs: FOOD, not: ['cooked', 'tray'] }),
  porkCooked: () => lateTex('porkCooked', ['pork_cooked', 'minced pork cooked', 'kaphrao_close', 'kaphrao', 'pad kra pao'], speckle('#7a4a2a', [['#9c6a42', 260, 3], ['#4e2c17', 160, 3], ['#c49060', 40, 2]], 6), { dirs: FOOD }),
  kaphrao: () => lateTex('kaphrao', ['kaphrao_close', 'kaphrao', 'pad kra pao', 'holy basil stir fry', 'basil pork'], speckle('#6e3f22', [['#8f5a33', 220, 3], ['#2f5a1f', 70, 5], ['#c0281f', 26, 2], ['#4a2914', 120, 3]], 7), { dirs: FOOD }),
  basil: () => lateTex('basil', ['basil_white', 'holy basil leaves', 'basil leaf', 'basil'], (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#2f6b26';
    ctx.beginPath(); ctx.ellipse(S / 2, S / 2, S * 0.42, S * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  }, { dirs: FOOD, not: ['cooked', 'stir'] }),
  basilCooked: () => lateTex('basilCooked', ['basil_cooked', 'stir fried basil', 'basil_white', 'basil'], (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#244a1b';
    ctx.beginPath(); ctx.ellipse(S / 2, S / 2, S * 0.42, S * 0.2, 0.2, 0, Math.PI * 2); ctx.fill();
  }, { dirs: FOOD }),
  chili: () => lateTex('chili', ['chili_red_white', 'red bird eye chili', 'chili red', 'chili'], speckle('#b8231b', [['#e0372a', 60, 6], ['#6d1410', 40, 4]], 8), { dirs: FOOD, not: ['flake', 'powder', 'paste'] }),
  chiliGreen: () => lateTex('chiliGreen', ['chili_green_white', 'green chili', 'chili green'], speckle('#3f7a1e', [['#5c9a2c', 60, 6]], 9), { dirs: FOOD }),
  garlic: () => lateTex('garlic', ['garlic_white', 'garlic cloves', 'garlic'], speckle('#e9e0cf', [['#f8f3e8', 80, 6], ['#c9b89b', 60, 3]], 10), { dirs: FOOD, not: ['crushed', 'fried'] }),
  garlicCrushed: () => lateTex('garlicCrushed', ['garlic_crushed', 'crushed garlic', 'pounded garlic', 'garlic_white'], speckle('#e6d9b8', [['#f6eed9', 160, 3], ['#b89e6a', 60, 2], ['#c22a1d', 30, 2]], 11), { dirs: FOOD }),
  eggFried: () => lateTex('eggFried', ['egg_crispy', 'crispy fried egg', 'egg_fried_white', 'fried egg'], (ctx, S) => {
    ctx.fillStyle = '#f7f2e6'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#e7a23a'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.16, 0, Math.PI * 2); ctx.fill();
  }, { dirs: FOOD, not: ['omelet'] }),
  omelette: () => lateTex('omelette', ['omelette', 'omelet', 'kai jeow', 'khai jiao'], speckle('#d9a43a', [['#b97a22', 120, 6], ['#f0c860', 80, 5]], 12), { dirs: FOOD }),
  friedRice: () => lateTex('friedRice', ['friedrice_close', 'fried rice', 'khao phat'], speckle('#d6b27a', [['#efd7a6', 220, 3], ['#8a5a30', 60, 3], ['#f2c84a', 40, 4]], 13), { dirs: FOOD }),
  noodles: () => lateTex('noodles', ['noodles_wide', 'pad see ew', 'wide rice noodles', 'noodle'], speckle('#a8763f', [['#c99a5e', 90, 8], ['#5e3a1c', 60, 5], ['#3d6a24', 30, 6]], 14), { dirs: FOOD }),
  tomyum: () => lateTex('tomyum', ['tomyum_top', 'tom yum', 'tomyum'], speckle('#d4602a', [['#e98a3a', 80, 8], ['#f2c9a0', 20, 9], ['#3f7a2a', 20, 5]], 15), { dirs: FOOD }),
  longbean: () => lateTex('longbean', ['longbean_white', 'yardlong bean', 'long bean'], speckle('#4f8a2c', [['#6aa63c', 60, 6]], 16), { dirs: FOOD }),
  cucumber: () => lateTex('cucumber', ['cucumber_white', 'cucumber slices', 'cucumber'], speckle('#d9e8b0', [['#5f8f35', 40, 8], ['#eef6d8', 60, 5]], 17), { dirs: FOOD }),
  onion: () => lateTex('onion', ['onion_white', 'sliced onion', 'onion'], speckle('#efe6d2', [['#d8c9a8', 50, 6]], 18), { dirs: FOOD }),
  burnt: () => lateTex('burnt', ['burnt', 'charred', 'burned'], speckle('#2a1a12', [['#120a06', 160, 4], ['#4a3022', 60, 3]], 19), { dirs: FOOD }),
  sauce: () => lateTex('sauce', ['sauce_glossy', 'glossy sauce', 'brown sauce'], speckle('#5a3216', [['#7a4a22', 80, 6]], 20), { dirs: FOOD }),
  oil: () => lateTex('oil', ['oil_pan', 'hot oil', 'oil'], speckle('#c9a23a', [['#e8c860', 50, 6]], 21), { dirs: FOOD, not: ['bottle', 'label'] }),
  curry: () => lateTex('curry', ['phat phrik kaeng', 'red curry stir', 'curry paste', 'phrik kaeng'], speckle('#a8341c', [['#c9532a', 120, 5], ['#4a8a2a', 40, 6]], 22), { dirs: FOOD }),
  greens: () => lateTex('greens', ['kale', 'morning glory', 'phak bung', 'greens'], speckle('#3f7a26', [['#5b9a34', 90, 7], ['#2a5418', 60, 5]], 23), { dirs: FOOD }),
  shrimp: () => lateTex('shrimp', ['shrimp', 'prawn'], speckle('#e98a6a', [['#f4b39a', 60, 6]], 24), { dirs: FOOD }),
  gravy: () => lateTex('gravy', ['rat na', 'radna', 'gravy'], speckle('#8a5a26', [['#a8783a', 70, 7], ['#3f7a26', 30, 6]], 25), { dirs: FOOD }),
};

/** Label (real flattened label photos) per product kind. */
export const LABELS: Record<string, { keys: string[]; not?: string[]; th: string; bg: string }> = {
  oyster_sauce: { keys: ['oyster', 'แม่ครัว', 'maekrua', 'mae krua', 'หอยนางรม'], th: 'ซอสหอยนางรม', bg: '#b5121b' },
  soy_light: { keys: ['light soy', 'thin soy', 'light_soy', 'ซีอิ๊วขาว', 'hb_lightsoy'], th: 'ซีอิ๊วขาว', bg: '#e8b81e' },
  soy_dark: { keys: ['dark soy', 'dark_soy', 'ซีอิ๊วดำ', 'hb_darksoy'], th: 'ซีอิ๊วดำหวาน', bg: '#5a1a12' },
  fish_sauce: { keys: ['fish sauce', 'fish_sauce', 'น้ำปลา', 'tiparos', 'ทิพรส'], th: 'น้ำปลา', bg: '#c22a1d' },
  seasoning_sauce: { keys: ['seasoning sauce', 'golden mountain', 'ภูเขาทอง', 'gm_sauce', 'seasoning'], th: 'ซอสปรุงรส', bg: '#1f8a3c' },
  cooking_oil: { keys: ['palm oil', 'soybean oil', 'cooking oil', 'cooking_oil', 'น้ำมัน', 'angoon', 'morakot', 'oil'], not: ['oyster'], th: 'น้ำมันพืช', bg: '#e0b01a' },
  white_pepper: { keys: ['white pepper', 'pepper', 'พริกไทย'], th: 'พริกไทยป่น', bg: '#1d5a3a' },
  chili_flakes: { keys: ['chili powder', 'chili flakes', 'chili_powder', 'chili_flakes', 'พริกป่น'], th: 'พริกป่น', bg: '#8a140e' },
  sugar: { keys: ['sugar', 'mitr phol', 'mitrphol', 'มิตรผล', 'น้ำตาล'], th: 'น้ำตาลทราย', bg: '#2a6ab8' },
  msg: { keys: ['ajinomoto', 'msg', 'อายิโนะโมะโต๊ะ', 'ผงชูรส'], th: 'ผงชูรส', bg: '#d8231a' },
  vinegar: { keys: ['vinegar', 'น้ำส้มสายชู'], th: 'น้ำส้มสายชู', bg: '#e6e6e6' },
  rice_bag: { keys: ['rice5', 'jasmine rice bag', 'ข้าวหอมมะลิ', 'rice bag', 'rice sack', 'rice15'], th: 'ข้าวหอมมะลิ 5 กก.', bg: '#e8d27a' },
  water_jug: { keys: ['drinking water', 'water bottle', 'น้ำดื่ม', 'water'], not: ['sauce', 'soy'], th: 'น้ำดื่ม', bg: '#2a8ad8' },
  egg_tray: { keys: ['eggs', 'egg pack', 'ไข่ไก่', 'egg'], not: ['fried', 'omelet'], th: 'ไข่ไก่', bg: '#e8c070' },
  gas_tank: { keys: ['lpg', 'gas cylinder', 'ถังแก๊ส', 'ปตท'], th: 'ก๊าซหุงต้ม', bg: '#c4161c' },
  pork_minced: { keys: ['pork_tray', 'minced pork tray', 'หมูบด', 'หมูสับ'], th: 'หมูสับ', bg: '#f2f2f2' },
  holy_basil: { keys: ['basil_pack', 'ใบกะเพรา'], th: 'ใบกะเพรา', bg: '#3a8a2a' },
  curry_paste: { keys: ['curry paste', 'พริกแกง'], th: 'พริกแกงเผ็ด', bg: '#a8241a' },
  tomyum_paste: { keys: ['tom yum paste', 'chili paste', 'น้ำพริกเผา'], th: 'น้ำพริกเผา', bg: '#b8361a' },
  gravy_starch: { keys: ['tapioca', 'starch', 'แป้งมัน'], th: 'แป้งมันสำปะหลัง', bg: '#3a6ad8' },
  noodles_wide: { keys: ['sen yai', 'wide rice noodle pack', 'เส้นใหญ่'], th: 'เส้นใหญ่', bg: '#f0f0f0' },
};

export function labelTex(kind: string): THREE.Texture {
  const L = LABELS[kind] ?? { keys: [kind], th: kind, bg: '#888' };
  return lateTex('label:' + kind, L.keys, placeholderLabel(L.th, L.bg), { dirs: LAB, not: L.not, size: 128, clamp: false });
}

// ------------------------------------------------------------------ materials

const matCache = new Map<string, THREE.Material>();
export function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T;
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

/** PBR library material (falls back to a tinted noise if missing). */
export function pbr(id: string, o: { repeat?: number | [number, number]; color?: THREE.ColorRepresentation; roughness?: number; metalness?: number; fallback?: THREE.ColorRepresentation; side?: THREE.Side } = {}) {
  return Assets.pbr(id, { repeat: o.repeat ?? 1, color: o.color, roughness: o.roughness, metalness: o.metalness, fallback: o.fallback, side: o.side });
}

export function foodMat(key: string, tex: THREE.Texture, o: { rough?: number; color?: THREE.ColorRepresentation; alpha?: boolean; side?: THREE.Side; flat?: boolean; emissive?: number } = {}) {
  return cachedMat('food:' + key, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.rough ?? 0.55, metalness: 0, color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide, flatShading: o.flat ?? false });
    if (o.alpha) { m.alphaTest = 0.45; m.transparent = false; }
    return m;
  });
}
