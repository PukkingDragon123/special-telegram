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

interface Entry { id: string; file: string; text: string; alpha?: boolean; dir: string; meta?: any; normal?: string }
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
  let normal: string | undefined;
  if (!file && Array.isArray(node.files)) {
    const fs = node.files.filter(isImg) as string[];
    const isN = (f: string) => /_n\.(jpe?g|png|webp)$/i.test(f);
    normal = fs.find(isN);
    // prefer the clean (non-worn) albedo variant
    file = fs.find((f) => !isN(f) && !/worn|grease|dirty/i.test(f)) ?? fs.find((f) => !isN(f)) ?? null;
  }
  if (file) {
    const text = [id, node.product, node.desc, node.description, node.brand, node.brand_th, node.brand_en, node.kind, node.topic, node.use, (node.tags ?? []).join?.(' '), file]
      .filter(Boolean).join(' ').toLowerCase();
    out.push({ id: id.toLowerCase(), file, text, alpha: !!(node.alpha ?? /\.png$/i.test(file)), dir, meta: node, normal });
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
    for (const e of out) { e.file = resolvePath(dir, e.file); if (e.normal) e.normal = resolvePath(dir, e.normal); }
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
export function lateTex(slot: string, keys: string[], fallback: (ctx: CanvasRenderingContext2D, S: number) => void, o: LateOpts & { not?: string[]; dirs?: string[]; size?: number; normal?: boolean } = {}): THREE.Texture {
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
    const file = o.normal ? e.normal : e.file;
    if (!file) return;
    Assets.image(file).then((img) => {
      // dispose first: the GPU storage is immutable and sized for the placeholder canvas
      tex.dispose();
      tex.source = new THREE.Source(img);
      if (o.flipY !== undefined) tex.flipY = o.flipY;
      tex.needsUpdate = true;
      (tex as any).userData = { slot, real: true, file };
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
const ph = (base: string, seed: number) => speckle(base, [['rgba(255,255,255,0.12)', 120, 3], ['rgba(0,0,0,0.12)', 90, 3]], seed);

/** Real food photo textures (textures/food/manifest.json). Tiles wrap; *Card = alpha cut-outs. */
export const T = {
  rice: () => lateTex('rice', ['rice_cooked_tile', 'rice cooked', 'cooked jasmine rice'], ph('#efe9dc', 3), { dirs: FOOD }),
  riceN: () => lateTex('riceN', ['rice_cooked_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  riceMound: () => lateTex('riceMound', ['rice_mound_top', 'rice mound'], ph('#efe9dc', 4), { dirs: FOOD, clamp: true }),
  porkRaw: () => lateTex('porkRaw', ['pork_minced_raw_tile', 'raw minced pork'], ph('#d98c8c', 5), { dirs: FOOD }),
  porkRawN: () => lateTex('porkRawN', ['pork_minced_raw_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  porkCooked: () => lateTex('porkCooked', ['kaphrao_pork_tile', 'cooked minced pork'], ph('#7a4a2a', 6), { dirs: FOOD }),
  porkCookedN: () => lateTex('porkCookedN', ['kaphrao_pork_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  kaphrao: () => lateTex('kaphrao', ['kaphrao_full_tile', 'kaphrao_pork_tile'], ph('#6e3f22', 7), { dirs: FOOD }),
  kaphraoN: () => lateTex('kaphraoN', ['kaphrao_full_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  basil: () => lateTex('basil', ['basil_sprig_fresh', 'basil_bunch_fresh'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  basilBunch: () => lateTex('basilBunch', ['basil_bunch_fresh', 'basil_sprig_fresh'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  basilCooked: () => lateTex('basilCooked', ['basil_sprig_cooked', 'basil_bunch_cooked'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  basilSoggy: () => lateTex('basilSoggy', ['basil_bunch_cooked', 'basil_sprig_cooked'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  chiliCard: () => lateTex('chiliCard', ['chili_red_bunch'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  chiliGreenCard: () => lateTex('chiliGreenCard', ['chili_green_pile'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  garlicCard: () => lateTex('garlicCard', ['garlic_crushed'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  garlicMinced: () => lateTex('garlicMinced', ['garlic_minced_pile', 'garlic_crushed'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  eggCrispy: () => lateTex('eggCrispy', ['egg_fried_crispy'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  eggRunny: () => lateTex('eggRunny', ['egg_fried_runny'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  eggBurnt: () => lateTex('eggBurnt', ['egg_fried_burnt'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  omeletteCard: () => lateTex('omeletteCard', ['omelette_whole'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  omelette: () => lateTex('omelette', ['omelette_tile', 'omelette'], ph('#d9a43a', 12), { dirs: FOOD }),
  friedRice: () => lateTex('friedRice', ['fried_rice_tile', 'fried rice'], ph('#d6b27a', 13), { dirs: FOOD }),
  friedRiceN: () => lateTex('friedRiceN', ['fried_rice_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  noodles: () => lateTex('noodles', ['noodles_phat_si_io_tile', 'noodles'], ph('#a8763f', 14), { dirs: FOOD }),
  beansCard: () => lateTex('beansCard', ['long_beans_bundle'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  beansCut: () => lateTex('beansCut', ['long_beans_cut_tile'], ph('#4f8a2c', 16), { dirs: FOOD }),
  onionCard: () => lateTex('onionCard', ['onion_slices', 'shallots_sliced'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  shallotCard: () => lateTex('shallotCard', ['shallots_sliced', 'onion_slices'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  kaleCard: () => lateTex('kaleCard', ['kale_leaf'], (c, S) => { c.clearRect(0, 0, S, S); }, { dirs: FOOD, clamp: true }),
  burnt: () => lateTex('burnt', ['burnt_residue_tile', 'burnt'], ph('#2a1a12', 19), { dirs: FOOD }),
  oil: () => lateTex('oil', ['oil_frying_tile', 'frying oil'], ph('#c9a23a', 21), { dirs: FOOD }),
  oilN: () => lateTex('oilN', ['oil_frying_tile'], (c, S) => { c.fillStyle = '#8080ff'; c.fillRect(0, 0, S, S); }, { dirs: FOOD, normal: true, srgb: false }),
  greens: () => lateTex('greens', ['phak_bung_tile', 'morning glory'], ph('#3f7a26', 23), { dirs: FOOD }),
  // not shipped by research yet → closest real photo, tinted by the material
  curry: () => lateTex('curry', ['phat_phrik_kaeng', 'red curry', 'kaphrao_pork_tile'], ph('#a8341c', 22), { dirs: FOOD }),
  shrimp: () => lateTex('shrimp', ['shrimp', 'prawn', 'pork_minced_raw_tile'], ph('#e98a6a', 24), { dirs: FOOD }),
  tomyum: () => lateTex('tomyum', ['tom yum', 'tomyum', 'oil_frying_tile'], ph('#d4602a', 15), { dirs: FOOD }),
  gravy: () => lateTex('gravy', ['rat na', 'gravy', 'noodles_phat_si_io_tile'], ph('#8a5a26', 25), { dirs: FOOD }),
};

/** Real flattened label photos per product kind (img/labels/manifest.json); exact ids first. */
export const LABELS: Record<string, { keys: string[]; not?: string[]; th: string; bg: string }> = {
  oyster_sauce: { keys: ['oyster_sauce_maekrua', 'oyster sauce', 'แม่ครัว'], th: 'ซอสหอยนางรม', bg: '#b5121b' },
  soy_light: { keys: ['light_soy_healthy_boy', 'thin soy', 'light soy'], th: 'ซีอิ๊วขาว', bg: '#e8b81e' },
  soy_dark: { keys: ['dark_soy_healthy_boy', 'dark soy'], th: 'ซีอิ๊วดำหวาน', bg: '#5a1a12' },
  fish_sauce: { keys: ['fish_sauce_tiparos', 'fish_sauce_squid', 'fish sauce'], th: 'น้ำปลา', bg: '#c22a1d' },
  seasoning_sauce: { keys: ['seasoning_sauce_golden_mountain', 'seasoning sauce', 'golden mountain'], th: 'ซอสปรุงรส', bg: '#1f8a3c' },
  cooking_oil: { keys: ['palm_oil_morakot_1l', 'soybean_oil_angoon_1l', 'palm oil', 'cooking oil'], not: ['oyster'], th: 'น้ำมันพืช', bg: '#e0b01a' },
  white_pepper: { keys: ['white_pepper_hand_brand_jar', 'white pepper', 'white_pepper_hand_brand_tin'], th: 'พริกไทยป่น', bg: '#1d5a3a' },
  chili_flakes: { keys: ['chili_powder_hand_brand', 'ground chili', 'chili powder'], th: 'พริกป่น', bg: '#8a140e' },
  sugar: { keys: ['sugar_mitr_phol_1kg', 'sugar'], th: 'น้ำตาลทราย', bg: '#2a6ab8' },
  msg: { keys: ['msg_ajinomoto_500g', 'ajinomoto', 'msg'], th: 'ผงชูรส', bg: '#d8231a' },
  vinegar: { keys: ['vinegar_osor', 'vinegar'], th: 'น้ำส้มสายชู', bg: '#e6e6e6' },
  rice_bag: { keys: ['rice_5kg_tra_chat', 'rice_5kg_hong_thong', 'jasmine rice bag'], th: 'ข้าวหอมมะลิ 5 กก.', bg: '#e8d27a' },
  water_jug: { keys: ['water_crystal_600ml', 'drinking water'], not: ['sauce', 'soy'], th: 'น้ำดื่ม', bg: '#2a8ad8' },
  egg_tray: { keys: ['eggs_cp_pack_label', 'eggs pack'], th: 'ไข่ไก่', bg: '#e8c070' },
  gas_tank: { keys: ['lpg_cylinder_world_gas', 'lpg'], th: 'ก๊าซหุงต้ม', bg: '#c4161c' },
  pork_minced: { keys: ['pork_tray_cp_price_sticker', 'scale label'], th: 'หมูสับ', bg: '#f2f2f2' },
  pork_top: { keys: ['pork_tray_cp_top'], th: 'หมูสด', bg: '#f2f2f2' },
  holy_basil: { keys: ['basil_pack_sleeve'], th: 'ใบกะเพรา', bg: '#3a8a2a' },
  curry_paste: { keys: ['red_curry_paste_mae_ploy', 'red curry paste', 'พริกแกง'], th: 'พริกแกงเผ็ด', bg: '#a8241a' },
  tomyum_paste: { keys: ['chili_paste_mae_pranom', 'chili paste', 'น้ำพริกเผา'], th: 'น้ำพริกเผา', bg: '#b8361a' },
  gravy_starch: { keys: ['tapioca_starch_fish_brand', 'tapioca', 'starch'], th: 'แป้งมันสำปะหลัง', bg: '#3a6ad8' },
  noodles_wide: { keys: ['noodle_sen_yai_pack', 'sen yai', 'เส้นใหญ่'], th: 'เส้นใหญ่', bg: '#f0f0f0' },
};

/** Label photo aspect (w/h) and real size hints, once the manifest is in. */
export function labelInfo(kind: string): { aspect: number; meta: any } | null {
  const L = LABELS[kind];
  if (!L) return null;
  const e = findEntry(L.keys, L.not ?? [], LAB);
  if (!e?.meta) return null;
  const sz = e.meta.size_px ?? e.meta.size;
  return { aspect: sz ? sz[0] / sz[1] : 1, meta: e.meta };
}

export function labelTex(kind: string): THREE.Texture {
  const L = LABELS[kind] ?? { keys: [kind], th: kind, bg: '#888' };
  return lateTex('label:' + kind, L.keys, placeholderLabel(L.th, L.bg), { dirs: LAB, not: L.not, size: 128, clamp: true });
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
