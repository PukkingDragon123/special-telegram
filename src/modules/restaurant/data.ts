import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { TL } from '../../core/util';

/* =============================================================================================
 * Restaurant data: recipe fallbacks, customer archetype pools by zone/time, budgets, patience.
 * The cooking module is the source of truth for recipes (game.cooking.recipes); this table is
 * only a fallback so the restaurant works (and can be tested) without it.
 * ============================================================================================= */

export type DishGroup = 'main' | 'seafood' | 'premium' | 'dessert';
export interface RecipeInfo { id: string; name: TL; price: number; egg?: 'topping' | 'main' | 'omelet'; rice?: number; vessel?: 'plate' | 'bowl'; soup?: boolean; group?: DishGroup }

export const RECIPE_FALLBACK: Record<string, RecipeInfo> = {
  kaphrao_moo: { id: 'kaphrao_moo', name: { th: 'กะเพราหมูสับ', en: 'Holy basil minced pork' }, price: 50, egg: 'topping', rice: 200 },
  khai_dao: { id: 'khai_dao', name: { th: 'ข้าวไข่ดาว', en: 'Fried egg on rice' }, price: 15, egg: 'main', rice: 200 },
  khai_jiao: { id: 'khai_jiao', name: { th: 'ข้าวไข่เจียว', en: 'Thai omelette on rice' }, price: 25, egg: 'omelet', rice: 200 },
  khao_phat: { id: 'khao_phat', name: { th: 'ข้าวผัดหมู', en: 'Pork fried rice' }, price: 50 },
  phat_phrik_kaeng: { id: 'phat_phrik_kaeng', name: { th: 'ผัดพริกแกงหมู', en: 'Red curry stir-fry' }, price: 55, egg: 'topping', rice: 200 },
  phat_si_io: { id: 'phat_si_io', name: { th: 'ผัดซีอิ๊วหมู', en: 'Pad see ew' }, price: 55 },
  rat_na: { id: 'rat_na', name: { th: 'ราดหน้าหมู', en: 'Rad na' }, price: 55 },
  tom_yam: { id: 'tom_yam', name: { th: 'ต้มยำกุ้ง', en: 'Tom yum goong' }, price: 70, vessel: 'bowl', soup: true },
  moo_kratiam: { id: 'moo_kratiam', name: { th: 'หมูทอดกระเทียม', en: 'Garlic pork' }, price: 50, egg: 'topping', rice: 200 },
  phat_phak_bung: { id: 'phat_phak_bung', name: { th: 'ผัดผักบุ้งไฟแดง', en: 'Flaming morning glory' }, price: 45 },
  // round 5: seafood / premium / desserts (cooking/recipes.ts is the source of truth)
  kaphrao_talay: { id: 'kaphrao_talay', name: { th: 'กะเพราทะเล', en: 'Holy basil seafood' }, price: 90, egg: 'topping', rice: 200, group: 'seafood' },
  muek_khai_khem: { id: 'muek_khai_khem', name: { th: 'ปลาหมึกผัดไข่เค็ม', en: 'Squid with salted egg' }, price: 120, rice: 200, group: 'seafood' },
  hoi_thot: { id: 'hoi_thot', name: { th: 'หอยทอด', en: 'Crispy oyster pancake' }, price: 120, group: 'seafood' },
  pu_phat_phong_kari: { id: 'pu_phat_phong_kari', name: { th: 'ปูผัดผงกะหรี่', en: 'Curry-powder blue crab' }, price: 380, group: 'premium' },
  khao_phat_pu: { id: 'khao_phat_pu', name: { th: 'ข้าวผัดปู', en: 'Crab fried rice' }, price: 180, group: 'premium' },
  kung_phao: { id: 'kung_phao', name: { th: 'กุ้งแม่น้ำเผา', en: 'Grilled river prawns' }, price: 450, group: 'premium' },
  tom_yam_nam_khon: { id: 'tom_yam_nam_khon', name: { th: 'ต้มยำกุ้งแม่น้ำน้ำข้น', en: 'Creamy river-prawn tom yum' }, price: 220, vessel: 'bowl', soup: true, group: 'premium' },
  pla_neung_manao: { id: 'pla_neung_manao', name: { th: 'ปลากะพงนึ่งมะนาว', en: 'Steamed sea bass, lime & chili' }, price: 280, vessel: 'bowl', soup: true, group: 'premium' },
  hoi_shell_noei: { id: 'hoi_shell_noei', name: { th: 'หอยเชลล์ผัดเนยกระเทียม', en: 'Garlic-butter scallops' }, price: 420, group: 'premium' },
  kaphrao_wagyu: { id: 'kaphrao_wagyu', name: { th: 'กะเพราวากิว A5 ราดน้ำมันทรัฟเฟิล', en: 'A5 wagyu kaphrao, truffle oil' }, price: 590, egg: 'topping', rice: 200, group: 'premium' },
  yam_salmon: { id: 'yam_salmon', name: { th: 'ยำแซลมอน', en: 'Spicy salmon salad' }, price: 260, group: 'premium' },
  khao_niao_mamuang: { id: 'khao_niao_mamuang', name: { th: 'ข้าวเหนียวมะม่วง', en: 'Mango sticky rice' }, price: 120, group: 'dessert' },
  bua_loi: { id: 'bua_loi', name: { th: 'บัวลอยน้ำกะทิ', en: 'Bua loi in coconut milk' }, price: 40, vessel: 'bowl', soup: true, group: 'dessert' },
  kluay_buat_chi: { id: 'kluay_buat_chi', name: { th: 'กล้วยบวชชี', en: 'Bananas in coconut milk' }, price: 45, vessel: 'bowl', soup: true, group: 'dessert' },
  thapthim_krop: { id: 'thapthim_krop', name: { th: 'ทับทิมกรอบ', en: 'Tub tim krob' }, price: 45, vessel: 'bowl', group: 'dessert' },
  lot_chong_nam_kathi: { id: 'lot_chong_nam_kathi', name: { th: 'ลอดช่องน้ำกะทิ', en: 'Lot chong in coconut milk' }, price: 40, vessel: 'bowl', group: 'dessert' },
  itim_kathi: { id: 'itim_kathi', name: { th: 'ไอติมกะทิข้าวเหนียว', en: 'Coconut ice cream, sticky rice' }, price: 50, vessel: 'bowl', group: 'dessert' },
  bingsu_mamuang: { id: 'bingsu_mamuang', name: { th: 'บิงซูมะม่วง', en: 'Mango bingsu' }, price: 120, vessel: 'bowl', group: 'dessert' },
  roti_kluay_khai: { id: 'roti_kluay_khai', name: { th: 'โรตีกล้วยไข่', en: 'Banana-egg roti' }, price: 50, group: 'dessert' },
};

/** Spoken short names used when ordering ("กะเพราหมูสับ ไข่ดาว จานนึงครับ"). */
export const ORDER_NAME: Record<string, string[]> = {
  kaphrao_moo: ['กะเพราหมูสับ', 'กะเพราหมู', 'ผัดกะเพราหมูสับ'],
  khai_dao: ['ข้าวไข่ดาว', 'ไข่ดาวราดข้าว'],
  khai_jiao: ['ข้าวไข่เจียว', 'ไข่เจียวราดข้าว'],
  khao_phat: ['ข้าวผัดหมู', 'ข้าวผัด'],
  phat_phrik_kaeng: ['ผัดพริกแกงหมู', 'พริกแกงหมู'],
  phat_si_io: ['ผัดซีอิ๊วหมู', 'ผัดซีอิ๊ว'],
  rat_na: ['ราดหน้าหมู', 'ราดหน้า'],
  tom_yam: ['ต้มยำกุ้ง', 'ต้มยำกุ้งน้ำข้น'],
  moo_kratiam: ['ข้าวหมูกระเทียม', 'หมูกระเทียม'],
  phat_phak_bung: ['ผัดผักบุ้ง', 'ผักบุ้งไฟแดง'],
  kaphrao_talay: ['กะเพราทะเล', 'กะเพรารวมมิตรทะเล'],
  muek_khai_khem: ['ปลาหมึกผัดไข่เค็ม', 'หมึกไข่เค็ม'],
  hoi_thot: ['หอยทอด', 'หอยทอดกรอบๆ', 'ออส่วน'],
  pu_phat_phong_kari: ['ปูผัดผงกะหรี่', 'ปูผัดผงกะหรี่ตัวนึง'],
  khao_phat_pu: ['ข้าวผัดปู', 'ข้าวผัดปูเนื้อเยอะๆ'],
  kung_phao: ['กุ้งแม่น้ำเผา', 'กุ้งเผาตัวโตๆ'],
  tom_yam_nam_khon: ['ต้มยำกุ้งน้ำข้น', 'ต้มยำกุ้งแม่น้ำน้ำข้น'],
  pla_neung_manao: ['ปลากะพงนึ่งมะนาว', 'ปลานึ่งมะนาว'],
  hoi_shell_noei: ['หอยเชลล์ผัดเนย', 'หอยเชลล์เนยกระเทียม'],
  kaphrao_wagyu: ['กะเพราวากิว', 'กะเพราเนื้อวากิวทรัฟเฟิล'],
  yam_salmon: ['ยำแซลมอน', 'ยำแซลมอนแซ่บๆ'],
  khao_niao_mamuang: ['ข้าวเหนียวมะม่วง', 'ข้าวเหนียวมะม่วงมูนเยอะๆ'],
  bua_loi: ['บัวลอย', 'บัวลอยน้ำกะทิ'],
  kluay_buat_chi: ['กล้วยบวชชี'],
  thapthim_krop: ['ทับทิมกรอบ', 'ทับทิมกรอบน้ำแข็งเยอะๆ'],
  lot_chong_nam_kathi: ['ลอดช่อง', 'ลอดช่องน้ำกะทิ'],
  itim_kathi: ['ไอติมกะทิ', 'ไอติมกะทิใส่ข้าวเหนียว'],
  bingsu_mamuang: ['บิงซูมะม่วง', 'บิงซู'],
  roti_kluay_khai: ['โรตีกล้วยไข่', 'โรตีกล้วย'],
};

export const DEFAULT_UNLOCKED = ['kaphrao_moo', 'khai_dao'];
export const DEFAULT_EXTRAS = { egg: 10, soda: 15, special: 10 };

/** Recipe lookup: cooking module first, fallback table second. */
export function recipeInfo(game: Game, id: string): RecipeInfo {
  const ck: any = (game as any).cooking;
  const r = ck?.recipes?.[id] ?? ck?.RECIPES?.[id];
  const fb = RECIPE_FALLBACK[id];
  if (r) return { id, name: r.name ?? fb?.name ?? { th: id }, price: r.price ?? fb?.price ?? 50, egg: r.egg ?? fb?.egg, rice: r.rice ?? fb?.rice, vessel: r.vessel ?? fb?.vessel, soup: r.soup ?? fb?.soup, group: r.group ?? fb?.group };
  return fb ?? { id, name: { th: id }, price: 50 };
}

export function allRecipeIds(game: Game): string[] {
  const ck: any = (game as any).cooking;
  const rs = ck?.recipes ?? ck?.RECIPES;
  const ids = rs ? Object.keys(rs) : [];
  for (const k of Object.keys(RECIPE_FALLBACK)) if (!ids.includes(k)) ids.push(k);
  return ids;
}

export function unlockedRecipes(game: Game): string[] {
  const u = game.g.unlocks?.recipes;
  return Array.isArray(u) && u.length ? u : DEFAULT_UNLOCKED;
}

// ------------------------------------------------------------------ customer archetypes

export interface ArchDef {
  /** budget multiplier on the zone's expected price (office people pay more, students less) */
  budget: number;
  /** patience multiplier */
  patience: number;
  /** eating speed multiplier (higher = faster) */
  eat: number;
  /** chance to order take-away */
  takeaway: number;
  /** pickiness (multiplies negative factors) */
  picky: number;
  /** favourite recipes (weights) */
  likes?: Record<string, number>;
  /** chance to ask for a spicy / mild dish */
  hot?: number; mild?: number;
  /** speech particle */
  particle?: 'krub' | 'ka' | 'ja' | 'casual';
}

export const ARCH: Record<string, ArchDef> = {
  office_worker_m: { budget: 1.2, patience: 0.8, eat: 1.2, takeaway: 0.2, picky: 1.1, likes: { kaphrao_moo: 3, khao_phat: 1.5, phat_phrik_kaeng: 1.5 }, hot: 0.35, mild: 0.08, particle: 'krub' },
  office_worker_f: { budget: 1.2, patience: 0.8, eat: 0.9, takeaway: 0.25, picky: 1.2, likes: { kaphrao_moo: 2, khai_jiao: 1.5, phat_si_io: 1.5 }, hot: 0.2, mild: 0.2, particle: 'ka' },
  student_m: { budget: 0.75, patience: 1.0, eat: 1.4, takeaway: 0.1, picky: 0.8, likes: { khai_dao: 3, kaphrao_moo: 2, khai_jiao: 2 }, hot: 0.4, mild: 0.1, particle: 'krub' },
  student_f: { budget: 0.75, patience: 1.0, eat: 1.0, takeaway: 0.15, picky: 0.9, likes: { khai_jiao: 3, khai_dao: 2, kaphrao_moo: 1.5 }, hot: 0.15, mild: 0.3, particle: 'ka' },
  uncle_singlet: { budget: 0.9, patience: 1.1, eat: 1.1, takeaway: 0.1, picky: 1.0, likes: { kaphrao_moo: 3, moo_kratiam: 1.5 }, hot: 0.5, mild: 0.02, particle: 'casual' },
  auntie_vendor: { budget: 0.85, patience: 1.2, eat: 0.9, takeaway: 0.35, picky: 1.4, likes: { kaphrao_moo: 2, khai_jiao: 2, phat_phak_bung: 1.5 }, hot: 0.3, mild: 0.1, particle: 'ja' },
  housewife: { budget: 0.9, patience: 1.0, eat: 0.9, takeaway: 0.5, picky: 1.3, likes: { khai_jiao: 2, kaphrao_moo: 2 }, hot: 0.2, mild: 0.25, particle: 'ka' },
  old_lady: { budget: 0.8, patience: 1.3, eat: 0.7, takeaway: 0.2, picky: 1.3, likes: { khai_jiao: 2, khai_dao: 2 }, hot: 0.05, mild: 0.5, particle: 'ja' },
  grandpa: { budget: 0.85, patience: 1.3, eat: 0.7, takeaway: 0.1, picky: 1.2, likes: { kaphrao_moo: 2, moo_kratiam: 2 }, hot: 0.1, mild: 0.3, particle: 'krub' },
  temple_lady: { budget: 0.9, patience: 1.2, eat: 0.8, takeaway: 0.3, picky: 1.2, likes: { khai_jiao: 2, phat_phak_bung: 2 }, hot: 0.1, mild: 0.4, particle: 'ja' },
  moto_taxi: { budget: 0.9, patience: 0.9, eat: 1.5, takeaway: 0.15, picky: 0.9, likes: { kaphrao_moo: 4 }, hot: 0.6, mild: 0.02, particle: 'casual' },
  delivery_rider: { budget: 1.0, patience: 0.6, eat: 1.5, takeaway: 1.0, picky: 0.8, likes: { kaphrao_moo: 3, khao_phat: 2 }, hot: 0.2, mild: 0.1, particle: 'krub' },
  construction_worker: { budget: 0.8, patience: 1.0, eat: 1.6, takeaway: 0.1, picky: 0.8, likes: { kaphrao_moo: 4, khai_dao: 1 }, hot: 0.55, mild: 0.02, particle: 'casual' },
  teen_gamer: { budget: 0.7, patience: 0.9, eat: 1.3, takeaway: 0.3, picky: 0.9, likes: { khai_dao: 3, khao_phat: 2 }, hot: 0.2, mild: 0.3, particle: 'casual' },
  gangster_lite: { budget: 0.8, patience: 0.7, eat: 1.4, takeaway: 0.2, picky: 1.0, likes: { kaphrao_moo: 3 }, hot: 0.7, mild: 0, particle: 'casual' },
  karaoke_uncle: { budget: 1.35, patience: 1.2, eat: 0.9, takeaway: 0.05, picky: 1.0, likes: { kaphrao_moo: 2, moo_kratiam: 2, tom_yam: 2 }, hot: 0.4, mild: 0.05, particle: 'casual' },
  security_guard: { budget: 0.9, patience: 1.0, eat: 1.2, takeaway: 0.3, picky: 0.9, likes: { kaphrao_moo: 3, khai_jiao: 1 }, hot: 0.3, mild: 0.05, particle: 'krub' },
  tourist_backpacker: { budget: 1.5, patience: 1.1, eat: 0.8, takeaway: 0.1, picky: 0.7, likes: { kaphrao_moo: 3, khao_phat: 2, tom_yam: 2 }, hot: 0.1, mild: 0.55, particle: 'casual' },
  street_sweeper: { budget: 0.75, patience: 1.0, eat: 1.3, takeaway: 0.2, picky: 0.8, likes: { kaphrao_moo: 2, khai_dao: 2 }, hot: 0.3, mild: 0.1, particle: 'casual' },
  shop_girl: { budget: 0.95, patience: 0.9, eat: 1.1, takeaway: 0.4, picky: 1.0, likes: { khai_jiao: 2, kaphrao_moo: 2 }, hot: 0.2, mild: 0.2, particle: 'ka' },
};
/** round 5: who likes the seafood / premium plates and which desserts (merged into ARCH[..].likes) */
const LIKES_X: Record<string, Record<string, number>> = {
  office_worker_m: { khao_phat_pu: 2, kaphrao_talay: 2, kaphrao_wagyu: 1.5, kung_phao: 1.5, tom_yam_nam_khon: 1.5, khao_niao_mamuang: 1.2 },
  office_worker_f: { yam_salmon: 2.5, hoi_shell_noei: 1.5, pla_neung_manao: 1.5, bingsu_mamuang: 2, thapthim_krop: 2, khao_niao_mamuang: 2 },
  student_m: { kaphrao_talay: 1.5, roti_kluay_khai: 2.5, itim_kathi: 2 },
  student_f: { bingsu_mamuang: 3, thapthim_krop: 2, roti_kluay_khai: 2, itim_kathi: 2 },
  uncle_singlet: { muek_khai_khem: 1.5, hoi_thot: 2, kluay_buat_chi: 1.5 },
  auntie_vendor: { hoi_thot: 1.5, bua_loi: 2, kluay_buat_chi: 2, lot_chong_nam_kathi: 1.5 },
  housewife: { kaphrao_talay: 1.5, thapthim_krop: 1.5, lot_chong_nam_kathi: 1.5 },
  old_lady: { pla_neung_manao: 1.5, bua_loi: 3, kluay_buat_chi: 3, lot_chong_nam_kathi: 2 },
  grandpa: { hoi_thot: 1.5, pla_neung_manao: 2, bua_loi: 2 },
  temple_lady: { pla_neung_manao: 1.5, bua_loi: 2, kluay_buat_chi: 2 },
  karaoke_uncle: { kung_phao: 3, pu_phat_phong_kari: 3, hoi_shell_noei: 2, kaphrao_wagyu: 2, tom_yam_nam_khon: 2 },
  tourist_backpacker: { khao_niao_mamuang: 3, pu_phat_phong_kari: 2, tom_yam_nam_khon: 2, kung_phao: 1.5, roti_kluay_khai: 2 },
  teen_gamer: { roti_kluay_khai: 3, itim_kathi: 2, bingsu_mamuang: 2 },
  gangster_lite: { kaphrao_talay: 1.5, kaphrao_wagyu: 1.5 },
  shop_girl: { yam_salmon: 1.5, bingsu_mamuang: 2.5, thapthim_krop: 2 },
  moto_taxi: { kaphrao_talay: 1.5 },
  construction_worker: { kaphrao_talay: 1.2 },
};
for (const [k, v] of Object.entries(LIKES_X)) if (ARCH[k]) ARCH[k].likes = { ...(ARCH[k].likes ?? {}), ...v };
/** "can afford it" weight for an expensive plate (≥ 150 ฿): office people, karaoke bosses and tourists order them */
export const richness = (arch: string | undefined) => Math.min(2, Math.max(0.06, ((ARCH[arch ?? '']?.budget ?? 1) - 0.8) * 2.6));
export const RICH_ARCHES = ['office_worker_m', 'office_worker_f', 'karaoke_uncle', 'tourist_backpacker'];

export const ARCH_DEFAULT: ArchDef = { budget: 1, patience: 1, eat: 1, takeaway: 0.2, picky: 1, hot: 0.25, mild: 0.15 };
export const archDef = (id: string | undefined) => ARCH[id ?? ''] ?? ARCH_DEFAULT;

/** Weighted archetype pool for a zone kind and the time of day. */
export function archetypePool(zoneKind: string | undefined, t: number, premium = 0): [string, number][] {
  const P: [string, number][] = [];
  const add = (id: string, w: number) => { if (w > 0) P.push([id, w]); };
  const morning = t < 10.5, lunch = t >= 10.5 && t < 14, afternoon = t >= 14 && t < 17.5, evening = t >= 17.5 && t < 20.5, night = t >= 20.5;
  const z = zoneKind ?? 'soi';
  // everywhere
  add('uncle_singlet', 3); add('housewife', morning || afternoon ? 3 : 1); add('moto_taxi', 2); add('delivery_rider', lunch || evening ? 3 : 1.2);
  add('construction_worker', morning || lunch ? 2.5 : 0.6); add('security_guard', night ? 2 : 0.6); add('street_sweeper', morning ? 1 : 0.2);
  if (morning) { add('auntie_vendor', 4); add('old_lady', 2.5); add('grandpa', 2); add('temple_lady', t < 8.5 ? 2 : 0.6); }
  if (lunch) { add('office_worker_m', 4); add('office_worker_f', 4); add('shop_girl', 1.5); }
  if (afternoon) { add('student_m', 4); add('student_f', 4); add('teen_gamer', 2); add('old_lady', 1); }
  if (evening) { add('office_worker_m', 3); add('office_worker_f', 3); add('student_m', 1.5); add('student_f', 1.5); add('karaoke_uncle', 1); add('gangster_lite', 1); }
  if (night) { add('teen_gamer', 3); add('gangster_lite', 2.5); add('karaoke_uncle', 2.5); add('tourist_backpacker', 1); }
  else add('tourist_backpacker', 0.5);
  // zone flavour
  const boost = (ids: string[], k: number) => { for (const p of P) if (ids.includes(p[0])) p[1] *= k; };
  if (z === 'office') boost(['office_worker_m', 'office_worker_f', 'security_guard'], 3);
  if (z === 'market') boost(['auntie_vendor', 'housewife', 'old_lady'], 2.5);
  if (z === 'mainroad') boost(['moto_taxi', 'delivery_rider', 'office_worker_m', 'tourist_backpacker'], 2);
  if (z === 'rural') { boost(['uncle_singlet', 'grandpa', 'old_lady', 'construction_worker'], 3); boost(['office_worker_m', 'office_worker_f', 'tourist_backpacker', 'delivery_rider'], 0.2); }
  if (z === 'temple') boost(['temple_lady', 'old_lady', 'grandpa'], 3);
  if (z === 'canal') boost(['uncle_singlet', 'housewife', 'grandpa'], 2);
  // premium plates on the menu (word gets around): more office people, karaoke bosses and tourists show up
  if (premium > 0) { boost(RICH_ARCHES, Math.min(2.6, 1 + 0.4 * premium)); if (!P.some((p) => p[0] === 'karaoke_uncle')) add('karaoke_uncle', 0.6 * Math.min(3, premium)); }
  return P;
}

export function weighted<T>(items: [T, number][], r = Math.random): T {
  const tot = items.reduce((a, b) => a + b[1], 0);
  let x = r() * tot;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
}

export const pick = <T>(a: readonly T[], r = Math.random): T => a[Math.floor(r() * a.length) % a.length];

/** Is it raining? (the world module owns weather; we check the plausible places it may live). */
export function isRaining(game: Game): boolean {
  const g = game.g as any;
  const w: any = game.world as any;
  const v = g.rain ?? g.weather?.rain ?? w?.weather?.rain ?? w?.rain;
  if (typeof v === 'number') return v > 0.3;
  if (typeof v === 'boolean') return v;
  return g.weather === 'rain' || g.weather === 'storm' || w?.weather === 'rain';
}

/** Expected price of a dish for a customer at a zone. */
export function expectedPrice(game: Game, recipe: string, zoneFactor: number, arch: string): number {
  return recipeInfo(game, recipe).price * zoneFactor * archDef(arch).budget;
}

/** Speech particle for an NPC look. */
export function particle(e: Ent): string {
  const a = archDef(e.arch).particle;
  const sex = e.look?.sex ?? 'm';
  if (a === 'ja') return pick(['จ้ะ', 'นะจ๊ะ', 'จ้ะ']);
  if (a === 'casual') return pick(['', 'ดิ', 'เลย', 'นะ', '']);
  if (a === 'ka' || (a !== 'krub' && sex === 'f')) return pick(['ค่ะ', 'ค่ะ', 'นะคะ']);
  return pick(['ครับ', 'ครับ', 'ครับผม']);
}

/** Polite "I/me" for lines that need it. */
export const me = (e: Ent) => (e.look?.sex === 'f' ? (archDef(e.arch).particle === 'ja' ? 'ป้า' : 'หนู') : archDef(e.arch).particle === 'casual' ? 'กู' : 'ผม');
