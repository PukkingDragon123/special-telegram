import type { DishData, RecipeId } from '../../game/contracts';
import type { TL } from '../../core/util';
import { ING, Flavor } from './data';
import { clamp01 } from './util';

/* =============================================================================================
 * RECIPES + DISH EVALUATION
 * Ideal grams per single serving (street-cart อาหารตามสั่ง), tolerances, method & evaluation weights.
 * Targets for salty/sweet/spicy/oil/portion are DERIVED from each recipe's own ideal grams so the
 * scoring is always self-consistent: cook exactly the book → ~95–100 %.
 * ============================================================================================= */

export interface WokItem { g: number; c: number; b: number; p?: number }
/** Fried egg(s) (ไข่ดาว): white set, crispy edge, yolk set, burn */
export interface EggState { n: number; wh: number; cr: number; yk: number; b: number }
/** Omelette (ไข่เจียว) from whisked eggs */
export interface OmeletState { n: number; c: number; cr: number; b: number; f: number; w: number; fish: number }
export interface WokData {
  T: number; oil: number; w: number;
  it: Record<string, WokItem>;
  sa: Record<string, number>;
  egg?: EggState | null;
  om?: OmeletState | null;
  /** wok hei (flare-ups) 0..1 */
  wh?: number;
  /** oil burnt / smoking too long 0..1 */
  ob?: number;
  st?: number; sm?: number;
}

/** Cooking params for things that only exist inside the wok. */
export const COOK_EXTRA: Record<string, { t: number; b: number; tMin?: number; loss?: number; char?: boolean; soggy?: number }> = {
  egg_scr: { t: 9, b: 22, tMin: 80, loss: 0.1 },
  rice_cooked: { t: 14, b: 36, tMin: 85, loss: 0.05, char: true },
};
export function cookParams(k: string) { return ING[k]?.cook ?? COOK_EXTRA[k] ?? { t: 10, b: 25, tMin: 85, loss: 0.1 }; }

export interface RecipeIng { g: number; req?: boolean; imp?: number }
export interface Recipe {
  id: RecipeId;
  name: TL;
  vessel: 'plate' | 'bowl';
  /** grams of steamed rice on the plate (0 = none) */
  rice: number;
  /** fried egg: optional topping / the main thing; omelette; scrambled egg inside */
  egg?: 'topping' | 'main' | 'omelet';
  ing: Record<string, RecipeIng>;
  sa: Record<string, number>;
  oil: number;
  /** water added (ml); soups keep most of it */
  water?: number;
  soup?: boolean;
  heat: TL;
  /** typical cooking time, seconds */
  time: number;
  /** evaluation weights */
  w: { salt: number; sweet: number; spice: number; cooked: number; aroma: number; texture: number; oil: number; portion: number; sour?: number };
  /** suggested menu price (baht, soi baseline) */
  price: number;
  /** lazy recipe-book steps (Thai, spoken) */
  steps: string[];
  tips?: string[];
  /** scribbled note at the bottom of the page */
  note?: string;
}

const W = (o: Partial<Recipe['w']> = {}): Recipe['w'] => ({ salt: 0.24, sweet: 0.1, spice: 0.1, cooked: 0.24, aroma: 0.1, texture: 0.08, oil: 0.06, portion: 0.08, ...o });

export const RECIPES: Record<string, Recipe> = {
  kaphrao_moo: {
    id: 'kaphrao_moo', name: { th: 'กะเพราหมูสับ', en: 'Holy basil minced pork' }, vessel: 'plate', rice: 200, egg: 'topping',
    ing: { pork_minced: { g: 120, req: true, imp: 3 }, holy_basil: { g: 18, req: true, imp: 2 }, garlic: { g: 15, imp: 1.5 }, chili: { g: 6, imp: 1.5 } },
    sa: { oyster_sauce: 10, soy_light: 5, fish_sauce: 5, soy_dark: 2, sugar: 4 },
    oil: 20, water: 15, heat: { th: 'ไฟแรงสุด', en: 'max heat' }, time: 75, w: W({ aroma: 0.12 }), price: 50,
    steps: [
      'ตำกระเทียม 15 ก. + พริก 6 ก. ในครก หยาบๆพอ',
      'น้ำมัน 20 มล. ไฟแรงๆ รอควันขึ้นนิดนึง',
      'กระเทียมพริกลงก่อน ผัดแป๊บเดียว อย่าให้ไหม้!!',
      'หมูสับ 120 ก. ผัดๆๆ จนหายชมพู',
      'หอยนางรม 10 ซีอิ๊วขาว 5 น้ำปลา 5 ซีอิ๊วดำ 2 น้ำตาล 4 (กรัม)',
      'น้ำเปล่านิดนึง 15 มล. ให้ฉ่ำๆ',
      'ใบกะเพรา 18 ก. ใส่ท้ายสุด คลุก 3 วิ ปิดไฟ',
      'ข้าว 200 ก. ใส่จาน ราด + ไข่ดาว ฟินนน',
    ],
    note: 'ซอสโดนกระทะร้อนๆ ไฟพรึ่บ = หอมกระทะ',
  },
  khai_dao: {
    id: 'khai_dao', name: { th: 'ข้าวไข่ดาว', en: 'Fried egg on rice' }, vessel: 'plate', rice: 200, egg: 'main',
    ing: {}, sa: {}, oil: 120, heat: { th: 'ไฟแรง น้ำมันท่วมๆ', en: 'high heat, lots of oil' }, time: 50,
    w: W({ salt: 0, sweet: 0, spice: 0, cooked: 0.4, aroma: 0.05, texture: 0.35, oil: 0.1, portion: 0.1 }), price: 15,
    steps: [
      'น้ำมันเยอะๆ 120 มล. ไฟแรง ร้อนจัด',
      'ตอกไข่ลงไปเลย ระวังกระเด็น 555',
      'ทอดจนขอบกรอบๆ สีน้ำตาล ประมาณ 40 วิ',
      'ไข่แดงเยิ้มๆ อร่อยกว่า ไม่ต้องกลับ',
      'ตักขึ้นวางบนข้าว ราดซอสแม็กกี้หน่อย (ถ้ามี)',
    ],
    note: 'ไข่ดาวไม่กรอบ = ไม่ใช่ไข่ดาวร้านเฮีย',
  },
  khai_jiao: {
    id: 'khai_jiao', name: { th: 'ข้าวไข่เจียว', en: 'Thai omelette on rice' }, vessel: 'plate', rice: 200, egg: 'omelet',
    ing: {}, sa: { fish_sauce: 4 }, oil: 150, heat: { th: 'ไฟแรง น้ำมันร้อนจัด', en: 'very hot deep oil' }, time: 60,
    w: W({ salt: 0.2, sweet: 0, spice: 0, cooked: 0.3, aroma: 0.05, texture: 0.3, oil: 0.08, portion: 0.07 }), price: 25,
    steps: [
      'ไข่ 2 ฟอง ใส่ชาม + น้ำปลา 4 ก. (1 ช้อนชา)',
      'ตีให้แตกฟูๆ จนฟอง',
      'น้ำมัน 150 มล. ร้อนจัดๆๆ',
      'เทไข่จากสูงๆ ฟูพองเป็นสะดิ้ง',
      'ขอบเหลืองกรอบ กลับด้าน (R) แล้วทอดอีกนิด',
      'ตักวางบนข้าว 200 ก. + ซอสศรีราชา',
    ],
  },
  khao_phat: {
    id: 'khao_phat', name: { th: 'ข้าวผัดหมู', en: 'Pork fried rice' }, vessel: 'plate', rice: 0,
    ing: { rice_cooked: { g: 230, req: true, imp: 3 }, pork_sliced: { g: 80, imp: 2 }, egg_scr: { g: 50, imp: 1.5 }, garlic: { g: 10, imp: 1 }, onion: { g: 30, imp: 1 }, tomato: { g: 30, imp: 0.5 }, spring_onion: { g: 5, imp: 0.5 } },
    sa: { soy_light: 8, oyster_sauce: 6, sugar: 3, fish_sauce: 2 },
    oil: 25, heat: { th: 'ไฟแรง', en: 'high heat' }, time: 90, w: W({ spice: 0.02, texture: 0.12 }), price: 50,
    steps: [
      'หั่นหอมใหญ่ 30 ก. มะเขือเทศ 30 ก. ต้นหอม 5 ก.',
      'น้ำมัน 25 มล. กระเทียม 10 ก. เจียวให้หอม',
      'หมู 80 ก. ผัดจนสุก',
      'ตอกไข่ 1 ฟอง คนๆให้เป็นไข่คน',
      'ข้าวสวย 230 ก. (ตักจากหม้อใส่จานแล้วเทลงกระทะ)',
      'ซีอิ๊วขาว 8 หอยนางรม 6 น้ำตาล 3 น้ำปลา 2',
      'ผัดแรงๆให้ข้าวร่วน ใส่ผัก ต้นหอม ตักเลย',
    ],
    note: 'ข้าวค้างคืนผัดอร่อยสุด (เชื่อเฮีย)',
  },
  phat_phrik_kaeng: {
    id: 'phat_phrik_kaeng', name: { th: 'ผัดพริกแกงหมู', en: 'Red curry stir-fry' }, vessel: 'plate', rice: 200, egg: 'topping',
    ing: { pork_sliced: { g: 120, req: true, imp: 3 }, curry_paste: { g: 25, req: true, imp: 2.5 }, long_beans: { g: 50, imp: 1.5 }, kaffir_lime: { g: 2, imp: 0.7 } },
    sa: { fish_sauce: 8, sugar: 8 },
    oil: 25, water: 20, heat: { th: 'ไฟกลาง-แรง', en: 'medium-high' }, time: 90, w: W({ spice: 0.14 }), price: 55,
    steps: [
      'หั่นถั่วฝักยาว 50 ก. เป็นท่อนๆ',
      'น้ำมัน 25 มล. ไฟกลาง ผัดพริกแกง 25 ก. ให้หอม แต่ไม่ไหม้',
      'หมูสไลซ์ 120 ก. ผัดจนสุก',
      'น้ำปลา 8 น้ำตาล 8 น้ำนิดหน่อย 20 มล.',
      'ถั่วฝักยาวลง ผัดพอสุกกรอบ',
      'ใบมะกรูดฉีก 2 ก. โรยท้าย',
    ],
  },
  phat_si_io: {
    id: 'phat_si_io', name: { th: 'ผัดซีอิ๊วหมู', en: 'Pad see ew' }, vessel: 'plate', rice: 0,
    ing: { noodles_wide: { g: 200, req: true, imp: 3 }, pork_sliced: { g: 80, imp: 2 }, kale: { g: 60, imp: 1.5 }, egg_scr: { g: 50, imp: 1 }, garlic: { g: 10, imp: 1 } },
    sa: { soy_dark: 10, soy_light: 8, oyster_sauce: 8, sugar: 6, white_pepper: 0.5 },
    oil: 25, heat: { th: 'ไฟแรงสุด ให้เส้นไหม้นิดๆ', en: 'max heat, a bit of char' }, time: 90, w: W({ spice: 0.03, texture: 0.14 }), price: 55,
    steps: [
      'หั่นคะน้า 60 ก. เป็นท่อน',
      'น้ำมัน 25 มล. กระเทียม 10 ก. + หมู 80 ก.',
      'ตอกไข่ คนให้แตก',
      'เส้นใหญ่ 200 ก. + ซีอิ๊วดำ 10 ให้เส้นสีสวย',
      'ซีอิ๊วขาว 8 หอยนางรม 8 น้ำตาล 6 พริกไทยนิด',
      'คะน้าลง ผัดแรงๆ เส้นติดกระทะไหม้นิดๆ = หอม',
    ],
  },
  rat_na: {
    id: 'rat_na', name: { th: 'ราดหน้าหมู', en: 'Rad na' }, vessel: 'plate', rice: 0,
    ing: { noodles_wide: { g: 180, req: true, imp: 3 }, pork_sliced: { g: 80, imp: 2 }, kale: { g: 70, imp: 1.5 }, garlic: { g: 8, imp: 0.7 } },
    sa: { oyster_sauce: 15, soy_light: 10, sugar: 6, soy_dark: 5, gravy_starch: 15, white_pepper: 0.5 },
    oil: 20, water: 250, heat: { th: 'ไฟกลาง', en: 'medium' }, time: 120, w: W({ spice: 0.02, texture: 0.12 }), price: 55,
    steps: [
      'เส้นใหญ่ 180 ก. ผัดกับซีอิ๊วดำ 5 ก. ให้หอม',
      'กระเทียม 8 ก. หมู 80 ก. ผัดจนสุก',
      'เติมน้ำ 250 มล. รอเดือด',
      'คะน้า 70 ก. หอยนางรม 15 ซีอิ๊วขาว 10 น้ำตาล 6',
      'แป้งมันละลายน้ำ 15 ก. ค่อยๆเท คนจนข้นใส',
      'พริกไทยนิด ตักราดเส้นเลย',
    ],
    note: 'น้ำราดหน้าต้องข้นๆ ไม่ใช่น้ำซุป!!',
  },
  tom_yam: {
    id: 'tom_yam', name: { th: 'ต้มยำกุ้ง', en: 'Tom yum goong' }, vessel: 'bowl', rice: 0, soup: true,
    ing: { shrimp: { g: 120, req: true, imp: 3 }, lemongrass: { g: 15, req: true, imp: 1.5 }, galangal: { g: 10, imp: 1 }, kaffir_lime: { g: 3, imp: 1 }, mushroom: { g: 60, imp: 1 }, chili: { g: 6, imp: 1 } },
    sa: { fish_sauce: 15, lime: 15, tomyum_paste: 15, sugar: 2 },
    oil: 0, water: 450, heat: { th: 'ต้มเดือด', en: 'boil' }, time: 120,
    w: W({ salt: 0.2, sweet: 0.05, spice: 0.15, cooked: 0.2, aroma: 0.15, texture: 0.05, oil: 0, portion: 0.08, sour: 0.15 }), price: 70,
    steps: [
      'น้ำ 450 มล. ต้มให้เดือด',
      'ตะไคร้ 15 ข่า 10 ใบมะกรูด 3 (ทุบๆหั่นๆ)',
      'เห็ดฟาง 60 ก. กุ้ง 120 ก. รอสุก แป๊บเดียว อย่านาน',
      'น้ำปลา 15 น้ำพริกเผา 15 น้ำตาล 2',
      'พริกขี้หนูบุบ 6 ก.',
      'ปิดไฟก่อน แล้วค่อยบีบมะนาว 15 มล. (ไม่งั้นขม!)',
      'ตักใส่ชาม',
    ],
  },
  moo_kratiam: {
    id: 'moo_kratiam', name: { th: 'หมูทอดกระเทียม', en: 'Garlic pork' }, vessel: 'plate', rice: 200, egg: 'topping',
    ing: { pork_sliced: { g: 130, req: true, imp: 3 }, garlic: { g: 30, req: true, imp: 2.5 }, cucumber: { g: 30, imp: 0.4 } },
    sa: { oyster_sauce: 10, soy_light: 6, sugar: 3, white_pepper: 1 },
    oil: 30, water: 10, heat: { th: 'ไฟกลาง', en: 'medium' }, time: 80, w: W({ spice: 0.03, aroma: 0.16 }), price: 50,
    steps: [
      'ตำกระเทียม 30 ก. (เยอะๆ ไม่ต้องเสียดาย)',
      'น้ำมัน 30 มล. ไฟกลาง เจียวกระเทียมเหลืองทอง',
      'หมูสไลซ์ 130 ก. ผัดจนสุกหอม',
      'หอยนางรม 10 ซีอิ๊วขาว 6 น้ำตาล 3 พริกไทย 1',
      'น้ำนิดเดียว 10 มล.',
      'ตักบนข้าว 200 ก. แตงกวาข้างจาน',
    ],
    note: 'กระเทียมดำ = ขม = ลูกค้าด่า',
  },
  phat_phak_bung: {
    id: 'phat_phak_bung', name: { th: 'ผัดผักบุ้งไฟแดง', en: 'Flaming morning glory' }, vessel: 'plate', rice: 0,
    ing: { morning_glory: { g: 160, req: true, imp: 3 }, garlic: { g: 10, imp: 1.2 }, chili: { g: 5, imp: 1 } },
    sa: { oyster_sauce: 15, soy_light: 5, sugar: 4 },
    oil: 25, water: 15, heat: { th: 'ไฟแรงสุด ไฟลุก!', en: 'max heat, flames!' }, time: 45, w: W({ spice: 0.08, texture: 0.14 }), price: 45,
    steps: [
      'ผักบุ้ง 160 ก. หั่นเป็นท่อนยาวๆ',
      'ตำกระเทียม 10 ก. พริก 5 ก. หยาบๆ',
      'น้ำมัน 25 มล. ร้อนจัดๆๆ จนควันขึ้น',
      'โยนผักบุ้ง + กระเทียมพริก + หอยนางรม 15 ซีอิ๊วขาว 5 น้ำตาล 4',
      'น้ำ 15 มล. ไฟลุกพรึ่บ!! ผัด 10 วิ พอ',
      'ตักใส่จานเร็วๆ ผักยังกรอบเขียว',
    ],
  },
};

export const RECIPE_IDS = Object.keys(RECIPES);
export const DEFAULT_UNLOCKED = ['kaphrao_moo', 'khai_dao'];

// ------------------------------------------------------------------------------------------ profile

export interface Profile {
  portion: number;   // cooked grams of the food (no plate rice)
  salt: number; sweet: number; spice: number; umami: number; sour: number; // per 100 g
  oil: number;       // ml per 100 g
  water: number;     // ml remaining
  solids: number;    // raw grams of solids
}

function addFlav(acc: Flavor, f: Flavor | undefined, g: number) {
  if (!f) return;
  acc.salt! += (f.salt ?? 0) * g; acc.sweet! += (f.sweet ?? 0) * g; acc.spice! += (f.spice ?? 0) * g;
  acc.umami! += (f.umami ?? 0) * g; acc.sour! += (f.sour ?? 0) * g;
}

export function profileOf(w: WokData, soup = false): Profile {
  const acc: Flavor = { salt: 0, sweet: 0, spice: 0, umami: 0, sour: 0 };
  let portion = 0, solids = 0;
  for (const [k, it] of Object.entries(w.it ?? {})) {
    if (!it || it.g <= 0) continue;
    const cp = cookParams(k);
    const loss = (cp.loss ?? 0.1) * Math.min(1, it.c);
    portion += it.g * (1 - loss);
    solids += it.g;
    addFlav(acc, ING[k]?.flav, it.g);
  }
  let sauces = 0;
  for (const [k, g] of Object.entries(w.sa ?? {})) {
    if (!g) continue;
    sauces += g;
    addFlav(acc, ING[k]?.flav, g);
  }
  const water = Math.max(0, w.w ?? 0);
  portion += sauces * 0.7 + (w.oil ?? 0) * 0.6 + (soup ? water : water * 0.8);
  const per = 100 / Math.max(30, portion);
  return {
    portion, solids, water,
    salt: acc.salt! * per, sweet: acc.sweet! * per, spice: acc.spice! * per, umami: acc.umami! * per, sour: acc.sour! * per,
    oil: (w.oil ?? 0) * 0.85 * per,
  };
}

/** What a perfect wok for a recipe looks like (used to derive targets). */
export function idealWok(r: Recipe): WokData {
  const it: Record<string, WokItem> = {};
  for (const [k, v] of Object.entries(r.ing)) it[k] = { g: v.g, c: 1.2, b: 0, p: 1 };
  return { T: 200, oil: r.oil, w: r.soup ? (r.water ?? 0) * 0.85 : (r.water ?? 0) * 0.3, it, sa: { ...r.sa } };
}

const targets = new Map<string, Profile>();
export function targetOf(r: Recipe): Profile {
  let t = targets.get(r.id);
  if (!t) { t = profileOf(idealWok(r), !!r.soup); targets.set(r.id, t); }
  return t;
}

// ------------------------------------------------------------------------------------------ matching

export function matchRecipe(w: WokData, allowed?: string[]): { id: string; score: number } {
  const it = w.it ?? {};
  let best = { id: 'kaphrao_moo', score: -1 };
  for (const r of Object.values(RECIPES)) {
    if (r.egg === 'main' || r.egg === 'omelet') continue;
    if (allowed && !allowed.includes(r.id)) continue;
    let tot = 0, have = 0;
    for (const [k, v] of Object.entries(r.ing)) {
      const imp = v.imp ?? (v.req ? 3 : 1);
      tot += imp;
      have += imp * Math.min(1, (it[k]?.g ?? 0) / (0.3 * v.g));
    }
    if (r.soup) { tot += 2; have += 2 * Math.min(1, (w.w ?? 0) / 150); }
    else if ((w.w ?? 0) > 120 && r.id !== 'rat_na') have -= 1.5;
    if (r.id === 'rat_na') { tot += 1.5; have += 1.5 * Math.min(1, (w.w ?? 0) / 100) * Math.min(1, (w.sa?.gravy_starch ?? 0) / 5); }
    let extras = 0;
    for (const [k, v] of Object.entries(it)) if (v.g > 10 && !r.ing[k] && !(ING[k]?.tags?.includes('aroma'))) extras++;
    const score = have / Math.max(1, tot) - extras * 0.12;
    if (score > best.score) best = { id: r.id, score };
  }
  return best;
}

// ------------------------------------------------------------------------------------------ evaluation

export interface EvalOpts {
  /** grams of steamed rice already on the vessel */
  rice?: number;
  /** rice quality 0..1 (water ratio) & -1 hard … +1 mushy */
  riceQ?: number;
  riceWet?: number;
  /** fried egg to put on top (already classified) */
  egg?: EggState | null;
  cook?: number;
  spoon?: boolean;
  takeaway?: boolean;
  /** restrict recipe matching (e.g. menu) */
  allowed?: string[];
  /** force recipe */
  recipe?: string;
}

export interface DishVis {
  /** burn 0..1, sauce darkness 0..1, basil/veg amount 0..1, chili 0..1, size (portion / ideal) */
  burn: number; sauce: number; herb: number; chili: number; size: number; raw: number;
  yolk?: 'runny' | 'set';
}

export type Dish = DishData & { vis: DishVis; label?: string; plate?: string; vessel?: string; bag?: boolean; score?: number };

export function classifyEgg(e: EggState | null | undefined): DishData['egg'] {
  if (!e || e.n <= 0) return 'none';
  if (e.b > 0.75) return 'burnt';
  if (e.wh < 0.8) return 'raw';
  if (e.cr >= 0.45) return 'crispy';
  return 'runny';
}

function eggScore(e: EggState): { s: number; issues: string[] } {
  const issues: string[] = [];
  const white = clamp01((e.wh - 0.3) / 0.7);
  const crisp = clamp01(e.cr / 0.6);
  const yolk = e.yk < 0.6 ? 1 : e.yk < 1.2 ? 0.75 : 0.55;
  const burn = clamp01(1 - Math.max(0, e.b - 0.25) * 1.6);
  if (e.wh < 0.8) issues.push('raw_egg');
  if (e.b > 0.75) issues.push('burnt_egg');
  if (e.cr < 0.25 && e.wh >= 0.8) issues.push('soggy_egg');
  return { s: white * 0.35 + crisp * 0.3 + yolk * 0.15 + burn * 0.2, issues };
}

const dev = (v: number, t: number, k = 1.25) => Math.max(-1, Math.min(1, ((v - t) / Math.max(t, 0.25)) * k));
const sc = (d: number, p = 1.3) => 1 - Math.min(1, Math.abs(d) ** p);

/**
 * Evaluate a wok's contents as a plated dish. Returns DishData (+ visual hints).
 * `w` = wok data at plating time. The fried egg (if any) is passed via opts.egg.
 */
export function evaluate(w: WokData, o: EvalOpts = {}): Dish {
  const issues: string[] = [];
  const it = w.it ?? {};
  const solids = Object.values(it).reduce((a, v) => a + (v?.g ?? 0), 0);
  const tempFood = clamp01(((w.T ?? 25) - 35) / 75);
  const rice = o.rice ?? 0;
  let recipeId: string;
  let taste = 0;
  let salty = 0, sweet = 0, spicyAbs = 0, cooked = 0;
  let portion = 0;
  const vis: DishVis = { burn: 0, sauce: 0, herb: 0, chili: 0, size: 1, raw: 0 };
  const eggOnly = solids < 5 && !!(w.om || w.egg || o.egg);
  let eggType: DishData['egg'] = classifyEgg(o.egg ?? null);

  if (eggOnly && (w.om?.n ?? 0) > 0) {
    // ------------------------------------------------ ไข่เจียว
    recipeId = 'khai_jiao';
    const r = RECIPES.khai_jiao;
    const om = w.om!;
    const salt = (om.fish * 0.23 + (w.sa?.fish_sauce ?? 0) * 0.23 + (w.sa?.soy_light ?? 0) * 0.16 + (w.sa?.seasoning_sauce ?? 0) * 0.17) / Math.max(1, om.n);
    salty = dev(salt, (4 * 0.23) / 2);
    const puff = clamp01(om.cr / 0.7);
    const done = om.c < 0.8 ? -(0.8 - om.c) / 0.8 : om.b > 0.3 ? Math.min(1, (om.b - 0.3) * 1.5) : 0;
    cooked = done;
    if (om.c < 0.8) issues.push('raw_egg');
    if (om.b > 0.7) issues.push('burnt');
    if (!om.f && om.c > 0.6) issues.push('not_flipped');
    if (om.w < 0.5) issues.push('not_whisked');
    const oilOk = clamp01((w.oil + 40) / (r.oil + 40));
    if (w.oil < 40) issues.push('dry');
    taste = sc(salty) * 0.22 + puff * 0.25 + sc(done) * 0.25 + clamp01(om.w) * 0.1 + oilOk * 0.08 + (om.f ? 0.1 : 0.02);
    portion = om.n * 55;
    vis.burn = clamp01(om.b); vis.raw = clamp01(1 - om.c); vis.size = om.n / 2;
    eggType = 'none';
  } else if (eggOnly) {
    // ------------------------------------------------ ไข่ดาว
    recipeId = 'khai_dao';
    const e = o.egg ?? w.egg!;
    const es = eggScore(e);
    issues.push(...es.issues);
    taste = es.s;
    const salt = ((w.sa?.seasoning_sauce ?? 0) * 0.17 + (w.sa?.fish_sauce ?? 0) * 0.23 + (w.sa?.soy_light ?? 0) * 0.16) / Math.max(1, e.n);
    salty = salt > 0 ? dev(salt, 0.6) * 0.6 : -0.15;
    cooked = e.wh < 0.8 ? -(0.8 - e.wh) : e.b > 0.4 ? Math.min(1, e.b - 0.4) : 0;
    portion = e.n * 50;
    eggType = classifyEgg(e);
    vis.burn = clamp01(e.b); vis.yolk = e.yk < 0.6 ? 'runny' : 'set';
  } else {
    // ------------------------------------------------ stir-fries & soups
    const m = o.recipe ? { id: o.recipe, score: 1 } : matchRecipe(w, o.allowed);
    recipeId = m.id;
    const r = RECIPES[recipeId];
    if (m.score < 0.45) issues.push('wrong_dish');
    const P = profileOf(w, !!r.soup);
    const Tg = targetOf(r);
    portion = P.portion;
    salty = dev(P.salt, Tg.salt);
    sweet = Tg.sweet > 0.3 ? dev(P.sweet, Tg.sweet, 1.0) : Math.max(-1, Math.min(1, (P.sweet - 1) / 4));
    spicyAbs = clamp01(P.spice / 9);
    const spiceDev = Tg.spice > 0.3 ? dev(P.spice, Tg.spice, 0.9) : Math.min(1, P.spice / 6);
    const sourDev = Tg.sour > 0.3 ? dev(P.sour, Tg.sour, 1.0) : 0;
    // cooking state
    let wsum = 0, cookAcc = 0, burnAcc = 0, rawAcc = 0;
    let aroma = 0, aromaN = 0, texture = 1;
    for (const [k, v] of Object.entries(it)) {
      if (!v || v.g < 1) continue;
      const def = ING[k];
      const cp = cookParams(k);
      const tags = def?.tags ?? [];
      const role = tags.includes('meat') ? 1 : tags.includes('starch') || k === 'rice_cooked' ? 0.7 : tags.includes('veg') ? 0.55 : tags.includes('aroma') ? 0.35 : 0.4;
      const wt = role * Math.sqrt(v.g);
      const raw = clamp01(1 - v.c);
      const burn = clamp01(v.b);
      wsum += wt; rawAcc += raw * wt; burnAcc += burn * wt;
      cookAcc += (burn - raw) * wt;
      if (tags.includes('meat') && v.c < 0.75) issues.push(k.startsWith('pork') ? 'raw_pork' : k === 'shrimp' ? 'raw_shrimp' : 'raw_meat');
      if (k === 'garlic' && v.b > 0.45) issues.push('burnt_garlic');
      if (cp.soggy && v.c > cp.soggy) { issues.push(k === 'holy_basil' ? 'soggy_basil' : 'soggy_veg'); texture -= 0.35; }
      if (def?.prep === 'chop' && (v.p ?? 0) < 0.5 && r.ing[k]) { issues.push('unchopped'); texture -= 0.25; }
      if (def?.prep === 'pound' && (v.p ?? 0) < 0.3 && (k === 'garlic' || k === 'chili') && r.ing[k]) { issues.push('unpounded'); texture -= 0.08; }
      if (cp.char && v.b > 0.08 && v.b < 0.4) texture += 0.1; // nice wok char
      if (tags.includes('aroma') || tags.includes('herb')) {
        aromaN++;
        aroma += v.b > 0.45 ? 0.1 : v.c < 0.4 && !cp.soggy ? 0.5 : 1;
      }
      if (!r.ing[k] && v.g > Math.max(10, P.portion * 0.08) && !tags.includes('aroma')) issues.push('weird_' + k);
    }
    for (const [k, v] of Object.entries(r.ing)) {
      const g = it[k]?.g ?? 0;
      if (v.req && g < v.g * 0.3) issues.push(k === 'holy_basil' ? 'no_basil' : 'no_' + k.split('_')[0]);
      else if (k === 'holy_basil' && g < v.g * 0.3) issues.push('no_basil');
    }
    cooked = wsum > 0 ? Math.max(-1, Math.min(1, cookAcc / wsum * 1.2)) : 0;
    const burnAvg = wsum > 0 ? burnAcc / wsum : 0;
    if (burnAvg > 0.5) issues.push('burnt');
    if ((w.ob ?? 0) > 0.5) issues.push('smoky');
    const expectedAroma = Object.keys(r.ing).filter((k) => ING[k]?.tags?.some((t) => t === 'aroma' || t === 'herb')).length;
    const aromaS = expectedAroma ? clamp01((aroma / Math.max(1, expectedAroma))) : 1;
    // oil
    const oilR = Tg.oil > 0.5 ? (P.oil + 1) / (Tg.oil + 1) : 1;
    if (Tg.oil > 0.5 && oilR > 2.2) issues.push('too_oily');
    if (Tg.oil > 0.5 && oilR < 0.3 && !r.soup) issues.push('dry');
    const oilS = Tg.oil > 0.5 ? 1 - Math.min(1, Math.abs(Math.log(oilR)) / Math.log(3)) : 1;
    // water
    if (!r.soup && recipeId !== 'rat_na' && P.water > Math.max(40, P.portion * 0.25)) { issues.push('watery'); texture -= 0.2; }
    if (r.soup && P.water < 200) issues.push('no_soup');
    // portion
    const pr = P.portion / Math.max(50, Tg.portion);
    vis.size = pr;
    if (pr < 0.65) issues.push('small_portion');
    if (pr > 1.7) issues.push('huge_portion');
    const portionS = pr >= 1 ? 1 : 1 - Math.min(1, Math.abs(Math.log(pr)) / Math.log(2.2));
    // flavour issues
    if (salty > 0.4) issues.push('too_salty');
    if (salty < -0.45) issues.push('bland');
    if (sweet > 0.55) issues.push('too_sweet');
    if (spicyAbs > 0.78) issues.push('too_spicy');
    if (Tg.spice > 1 && P.spice < Tg.spice * 0.25) issues.push('not_spicy');
    if (r.w.sour && sourDev < -0.5) issues.push('not_sour');
    if (r.w.sour && sourDev > 0.8) issues.push('too_sour');
    const ww = r.w;
    let num = ww.salt * sc(salty) + ww.sweet * sc(sweet) + ww.spice * sc(spiceDev, 1.1) + ww.cooked * sc(cooked * 1.3, 1.1)
      + ww.aroma * aromaS + ww.texture * clamp01(texture) + ww.oil * oilS + ww.portion * portionS + (ww.sour ?? 0) * sc(sourDev);
    let den = ww.salt + ww.sweet + ww.spice + ww.cooked + ww.aroma + ww.texture + ww.oil + ww.portion + (ww.sour ?? 0);
    taste = num / den;
    const pen: Record<string, number> = { raw_pork: 0.35, raw_meat: 0.3, raw_shrimp: 0.25, burnt: 0.25, burnt_garlic: 0.1, wrong_dish: 0.3, no_basil: 0.12, smoky: 0.08, watery: 0.05, no_soup: 0.2, too_salty: 0.08, bland: 0.08, small_portion: 0.08, too_oily: 0.05, too_sweet: 0.05, too_spicy: 0.04, dry: 0.04 };
    for (const i of issues) taste -= pen[i] ?? (i.startsWith('no_') ? 0.15 : i.startsWith('weird_') ? 0.05 : 0);
    taste += clamp01(w.wh ?? 0) * 0.06;
    // visuals
    vis.burn = burnAvg;
    vis.raw = wsum > 0 ? rawAcc / wsum : 0;
    vis.sauce = clamp01(((w.sa?.soy_dark ?? 0) * 2 + (w.sa?.oyster_sauce ?? 0) + (w.sa?.soy_light ?? 0) * 0.5) / 30);
    const herbG = (it.holy_basil?.g ?? 0) + (it.kale?.g ?? 0) + (it.morning_glory?.g ?? 0) + (it.long_beans?.g ?? 0) + (it.kaffir_lime?.g ?? 0) * 3;
    vis.herb = clamp01(herbG / Math.max(15, Object.entries(r.ing).filter(([k]) => ['holy_basil', 'kale', 'morning_glory', 'long_beans'].includes(k)).reduce((a, [, v]) => a + v.g, 0) || 18));
    vis.chili = clamp01(((it.chili?.g ?? 0) + (w.sa?.chili_flakes ?? 0)) / 10);
    // fried egg on top
    if (o.egg && o.egg.n > 0) {
      const es = eggScore(o.egg);
      for (const i of es.issues) issues.push(i);
      taste = taste * 0.82 + es.s * 0.18 + 0.04; // ไข่ดาวช่วยชีวิต
      vis.yolk = o.egg.yk < 0.6 ? 'runny' : 'set';
    }
  }

  const R = RECIPES[recipeId];
  if (R.rice > 0 && rice < 60) issues.push('no_rice');
  if (rice > 0 && (o.riceWet ?? 0) > 0.35) issues.push('mushy_rice');
  if (rice > 0 && (o.riceWet ?? 0) < -0.35) issues.push('hard_rice');
  if (rice > 0 && (o.riceQ ?? 1) < 0.5) taste -= 0.08;
  if (R.rice > 0 && rice > 0) taste = taste * 0.92 + 0.08 * clamp01(1 - Math.abs(Math.log(rice / R.rice)) / Math.log(2.5));
  const temp = rice > 0 ? tempFood * 0.75 + 0.25 * 0.8 : tempFood;
  if (temp < 0.35) issues.push('cold');
  if (!o.spoon) issues.push('no_spoon');
  const uniq = [...new Set(issues)];
  return {
    recipe: recipeId,
    egg: eggType,
    rice: Math.round(rice),
    portion: Math.round(portion),
    taste: Math.round(clamp01(taste) * 100) / 100,
    salty: Math.round(salty * 100) / 100,
    spicy: Math.round(spicyAbs * 100) / 100,
    sweet: Math.round(sweet * 100) / 100,
    cooked: Math.round(cooked * 100) / 100,
    temp: Math.round(temp * 100) / 100,
    issues: uniq,
    cook: o.cook,
    spoon: !!o.spoon,
    takeaway: !!o.takeaway,
    vis: { burn: r2(vis.burn), sauce: r2(vis.sauce), herb: r2(vis.herb), chili: r2(vis.chili), size: r2(vis.size), raw: r2(vis.raw), yolk: vis.yolk },
  };
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Human (Thai) words for a dish's main problem, used on labels. */
export const ISSUE_TH: Record<string, string> = {
  raw_pork: 'หมูยังดิบ!', raw_meat: 'เนื้อยังดิบ!', raw_shrimp: 'กุ้งยังดิบ', burnt: 'ไหม้!', burnt_garlic: 'กระเทียมไหม้ ขม', soggy_basil: 'กะเพราเละ',
  no_basil: 'ไม่มีกะเพรา?!', too_oily: 'มันเยิ้ม', dry: 'แห้งไป', too_salty: 'เค็มปี๋', bland: 'จืด', too_sweet: 'หวานเจี๊ยบ', too_spicy: 'เผ็ดตายห่า',
  not_spicy: 'ไม่เผ็ดเลย', cold: 'เย็นชืด', no_rice: 'ไม่มีข้าว', small_portion: 'น้อยจัง', wrong_dish: 'อะไรเนี่ย?', watery: 'แฉะ', raw_egg: 'ไข่ดิบ',
  burnt_egg: 'ไข่ไหม้', soggy_egg: 'ไข่ไม่กรอบ', smoky: 'เหม็นควัน', unchopped: 'ไม่ได้หั่น', unpounded: 'กระเทียมเม็ดๆ', no_soup: 'น้ำแห้ง',
  not_sour: 'ไม่เปรี้ยว', too_sour: 'เปรี้ยวจี๊ด', mushy_rice: 'ข้าวแฉะ', hard_rice: 'ข้าวแข็ง', not_flipped: 'ไม่ได้กลับ', not_whisked: 'ตีไข่ไม่แตก', soggy_veg: 'ผักเละ',
};

export function qualityWord(taste: number): string {
  return taste >= 0.88 ? 'อร่อยเหาะ!' : taste >= 0.75 ? 'อร่อย' : taste >= 0.6 ? 'พอกินได้' : taste >= 0.42 ? 'งั้นๆ' : 'แย่มาก';
}
