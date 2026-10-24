import type { TL } from '../../core/util';

/* =============================================================================================
 * SHOPS — ECONOMY TABLE (one file): shops, opening hours, unlock days, keepers & personalities,
 * stock (item kinds, prices, daily amounts, unlocks by day / by recipe).
 *
 * Prices are in-game baht based on real Bangkok 2025–26 prices (fresh market ≈ cheapest per
 * unit, 8-Twelve ≈ +25–45 %, wholesale "แม็กโคร่ง" ≈ −15–25 % but bulk packs only).
 *   minced pork ≈ 140–160 ฿/kg · holy basil 10 ฿/bunch · Thai garlic ≈ 100–120 ฿/kg ·
 *   bird's-eye chili ≈ 150–200 ฿/kg · eggs 4–5 ฿ (tray of 30 ≈ 110–130 ฿) · LPG 15 kg refill 423 ฿ ·
 *   red plastic stool 50–70 ฿ · carbon-steel wok 250–450 ฿ · Crystal water 600 ml 7 ฿.
 * A plate of กะเพราหมูสับ sells for 45–60 ฿ and costs ≈ 20–25 ฿ in ingredients.
 * ============================================================================================= */

export type ReplyCat = 'polite' | 'sweet' | 'funny' | 'rude';
export const REPLY_CATS: ReplyCat[] = ['polite', 'sweet', 'funny', 'rude'];

export interface Personality {
  id: string;
  /** false → robotic "ราคาตามระบบค่ะ", never bargains */
  bargain: boolean;
  /** best discount reachable by bargaining (0..1) */
  maxDiscount: number;
  /** mood change per reply category (positive = likes it) */
  likes: Record<ReplyCat, number>;
  /** bargaining rounds before the final price */
  patience: number;
  /** mood at/below which the keeper gets MAD */
  madAt: number;
  /** babble pitch */
  voice: number;
  /** keeper chases thieves (false: presses the alarm instead) */
  chases: boolean;
  /** how the keeper addresses the player (ไทย particle flavour) */
  callPlayer: string;
}

export const PERSONALITIES: Record<string, Personality> = {
  // ป้าใจดี — soft auntie: loves sweet talk, forgives a lot
  soft_auntie: { id: 'soft_auntie', bargain: true, maxDiscount: 0.2, likes: { polite: 1.2, sweet: 2.0, funny: 1.1, rude: -2.6 }, patience: 3, madAt: -3, voice: 1.28, chases: true, callPlayer: 'หนู' },
  // เจ๊ปากจัด — chatty auntie: loves jokes
  chatty_auntie: { id: 'chatty_auntie', bargain: true, maxDiscount: 0.15, likes: { polite: 0.9, sweet: 1.0, funny: 2.0, rude: -2.4 }, patience: 3, madAt: -3, voice: 1.2, chases: true, callPlayer: 'น้อง' },
  // ลุงขี้เหนียว — stingy uncle: sweet talk doesn't work, jokes a little
  stingy_uncle: { id: 'stingy_uncle', bargain: true, maxDiscount: 0.1, likes: { polite: 1.0, sweet: -0.6, funny: 1.5, rude: -3.0 }, patience: 2, madAt: -2.5, voice: 0.78, chases: true, callPlayer: 'ไอ้หนู' },
  // เฮียเครื่องครัว — Chinese-Thai shop owner: respects politeness
  polite_hia: { id: 'polite_hia', bargain: true, maxDiscount: 0.12, likes: { polite: 1.8, sweet: 0.4, funny: 0.6, rude: -3.0 }, patience: 2, madAt: -2.5, voice: 0.9, chases: true, callPlayer: 'อาตี๋' },
  // ลุงแก๊ส — gruff uncle: regulated prices, barely moves
  gruff_uncle: { id: 'gruff_uncle', bargain: true, maxDiscount: 0.05, likes: { polite: 1.4, sweet: 0.0, funny: 0.6, rude: -3.0 }, patience: 2, madAt: -2.5, voice: 0.72, chases: true, callPlayer: 'ไอ้น้อง' },
  // เจ๊ไข่ — business-like egg & dry-goods seller
  business_jeh: { id: 'business_jeh', bargain: true, maxDiscount: 0.08, likes: { polite: 1.5, sweet: 0.5, funny: 0.5, rude: -2.2 }, patience: 2, madAt: -2.5, voice: 1.1, chases: true, callPlayer: 'น้อง' },
  // 8-Twelve clerk — robot: "ราคาตามระบบค่ะ"
  robot_clerk: { id: 'robot_clerk', bargain: false, maxDiscount: 0, likes: { polite: 0, sweet: 0, funny: 0, rude: 0 }, patience: 1, madAt: -99, voice: 1.45, chases: false, callPlayer: 'คุณลูกค้า' },
  // แม็กโคร่ง cashier — "ราคาส่งแล้วค่ะ"
  cashier: { id: 'cashier', bargain: true, maxDiscount: 0.03, likes: { polite: 0.6, sweet: 0.3, funny: 0.4, rude: -1.6 }, patience: 1, madAt: -2, voice: 1.3, chases: false, callPlayer: 'คุณลูกค้า' },
};

export interface StockDef {
  /** stable id inside the shop */
  id: string;
  /** candidate item kinds (owned by cooking/restaurant…) — the first one that exists is sold */
  kinds: string[];
  /** fallback kind defined by the shops module when no candidate exists */
  fb: string;
  /** baht per unit */
  price: number;
  /** Thai price-card unit ("ถุงละ", "กำละ", "ฟองละ", "ตัวละ"…) */
  unit: string;
  /** units per day (restocked every morning) */
  qty: number;
  /** units displayed at once (default 2) — the keeper puts out the next one when taken */
  show?: number;
  /** unlock day (default: the shop's day) */
  day?: number;
  /** … or unlocked as soon as one of these recipes is unlocked (g.unlocks.recipes) */
  recipes?: string[];
  /** spawn data overrides (e.g. bulk packs) */
  data?: any;
  /** price-card name (default: item name) */
  label?: TL;
  /** big furniture: carried (multi-slot) or delivered to the cart for a fee */
  big?: boolean;
  /** 8-Twelve alcohol: only 11–14 & 17–24 (Thai law) */
  alcohol?: boolean;
  /** LPG swap: cheaper when you hand in an empty tank */
  swapPrice?: number;
}

export type ShopKind = 'stall' | 'shophouse' | 'store' | 'warehouse';

export interface ShopDef {
  id: string;
  name: TL;
  /** mapplan anchor: where the customer stands (door / counter position) */
  anchor: string;
  /** separate pay-counter anchor (8-Twelve, wholesale) */
  counter?: string;
  kind: ShopKind;
  /** opening hours (open ≥ close → 24 h) */
  open: number;
  close: number;
  /** unlock day */
  day: number;
  keeper: { name: TL; archetype: string; personality: string; seed: number; sit?: boolean };
  /** shop area radius around the shop centre (m) — leaving it with unpaid items = MAD */
  radius: number;
  /** debt book key (Day-1 credit) */
  debtKey?: string;
  /** shutter / closed-sign texts */
  closedNote?: TL;
  lockedNote?: TL;
  /** shutter width (m) for shophouses, centred at this offset along the facade */
  shutter?: { w: number; off: number; h: number };
  stock: StockDef[];
}

// recipe groups (ids from contracts.ts RecipeId)
const R_OMELET = ['khai_jiao'];
const R_FRIEDRICE = ['khao_phat'];
const R_CURRY = ['phat_phrik_kaeng'];
const R_SIIO = ['phat_si_io'];
const R_RATNA = ['rat_na'];
const R_TOMYAM = ['tom_yam'];
const R_GARLIC = ['moo_kratiam'];
const R_PHAKBUNG = ['phat_phak_bung'];

export const SHOPS: ShopDef[] = [
  // ------------------------------------------------------------------ FRESH MARKET (05–14)
  {
    id: 'auntie_stall', name: { th: 'แผงป้าแดง', en: "Auntie Daeng's stall" }, anchor: 'auntie_stall', kind: 'stall',
    open: 5, close: 14, day: 1, radius: 4.2, debtKey: 'auntie',
    keeper: { name: { th: 'ป้าแดง', en: 'Auntie Daeng' }, archetype: 'auntie_vendor', personality: 'soft_auntie', seed: 1101 },
    closedNote: { th: 'ตลาดวายแล้วจ้า พรุ่งนี้ตีห้า', en: 'Market closed — back at 5 am' },
    stock: [
      { id: 'pork', kinds: ['pork_minced'], fb: 'sfb_pork_minced', price: 75, unit: 'ถุงละ', qty: 12, show: 3 },
      { id: 'basil', kinds: ['holy_basil'], fb: 'sfb_holy_basil', price: 10, unit: 'กำละ', qty: 16, show: 3 },
      { id: 'garlic', kinds: ['garlic'], fb: 'sfb_garlic', price: 20, unit: 'ถุงละ', qty: 10, show: 2 },
      { id: 'chili', kinds: ['chili'], fb: 'sfb_chili', price: 15, unit: 'ถุงละ', qty: 10, show: 2 },
      { id: 'egg', kinds: ['egg'], fb: 'sfb_egg', price: 5, unit: 'ฟองละ', qty: 40, show: 4 },
      { id: 'beans', kinds: ['long_beans'], fb: 'sfb_long_beans', price: 15, unit: 'กำละ', qty: 8, show: 2 },
      { id: 'onion', kinds: ['onion'], fb: 'sfb_onion', price: 15, unit: 'ถุงละ', qty: 8, show: 2 },
      { id: 'garland', kinds: ['garland'], fb: 'sfb_garland', price: 20, unit: 'พวงละ', qty: 6, show: 2, label: { th: 'พวงมาลัย', en: 'jasmine garland' } },
    ],
  },
  {
    id: 'butcher_stall', name: { th: 'เขียงหมูลุงหมึก', en: "Uncle Muek's pork stall" }, anchor: 'butcher_stall', kind: 'stall',
    open: 5, close: 14, day: 1, radius: 3.8,
    keeper: { name: { th: 'ลุงหมึก', en: 'Uncle Muek' }, archetype: 'vendor_cook', personality: 'stingy_uncle', seed: 1202 },
    closedNote: { th: 'หมูหมดแล้ว พรุ่งนี้มาเช้าๆ', en: 'Sold out — come early tomorrow' },
    stock: [
      { id: 'pork', kinds: ['pork_minced'], fb: 'sfb_pork_minced', price: 70, unit: 'ถุงละ', qty: 14, show: 3 },
      { id: 'pork_sl', kinds: ['pork_sliced'], fb: 'sfb_pork_sliced', price: 85, unit: 'ถุงละ', qty: 10, show: 2, day: 2, recipes: [...R_GARLIC, ...R_SIIO, ...R_RATNA, ...R_CURRY] },
      { id: 'chicken', kinds: ['chicken_minced'], fb: 'sfb_chicken_minced', price: 55, unit: 'ถุงละ', qty: 10, show: 2, day: 2 },
      { id: 'shrimp', kinds: ['shrimp'], fb: 'sfb_shrimp', price: 95, unit: 'ถุงละ', qty: 6, show: 2, day: 99, recipes: R_TOMYAM },
    ],
  },
  {
    id: 'veg_stall', name: { th: 'แผงผักป้าศรี', en: "Auntie Sri's veg stall" }, anchor: 'veg_stall', kind: 'stall',
    open: 5, close: 14, day: 1, radius: 3.8,
    keeper: { name: { th: 'ป้าศรี', en: 'Auntie Sri' }, archetype: 'auntie_vendor', personality: 'chatty_auntie', seed: 1303 },
    closedNote: { th: 'ผักหมดแล้วจ้า', en: 'Out of veg' },
    stock: [
      { id: 'basil', kinds: ['holy_basil'], fb: 'sfb_holy_basil', price: 10, unit: 'กำละ', qty: 14, show: 2 },
      { id: 'beans', kinds: ['long_beans'], fb: 'sfb_long_beans', price: 15, unit: 'กำละ', qty: 8, show: 2 },
      { id: 'onion', kinds: ['onion'], fb: 'sfb_onion', price: 15, unit: 'ถุงละ', qty: 8, show: 1 },
      { id: 'garlic', kinds: ['garlic'], fb: 'sfb_garlic', price: 20, unit: 'ถุงละ', qty: 8, show: 1 },
      { id: 'chili', kinds: ['chili'], fb: 'sfb_chili', price: 15, unit: 'ถุงละ', qty: 8, show: 1 },
      { id: 'kale', kinds: ['kale'], fb: 'sfb_kale', price: 20, unit: 'กำละ', qty: 8, show: 2, day: 99, recipes: [...R_SIIO, ...R_RATNA] },
      { id: 'mglory', kinds: ['morning_glory'], fb: 'sfb_morning_glory', price: 15, unit: 'กำละ', qty: 8, show: 2, day: 99, recipes: R_PHAKBUNG },
      { id: 'tomato', kinds: ['tomato'], fb: 'sfb_tomato', price: 15, unit: 'ถุงละ', qty: 6, show: 1, day: 99, recipes: R_FRIEDRICE },
      { id: 'sonion', kinds: ['spring_onion'], fb: 'sfb_spring_onion', price: 10, unit: 'กำละ', qty: 6, show: 1, day: 99, recipes: R_FRIEDRICE },
      { id: 'cucumber', kinds: ['cucumber'], fb: 'sfb_cucumber', price: 10, unit: 'ถุงละ', qty: 6, show: 1, day: 99, recipes: R_FRIEDRICE },
      { id: 'lime', kinds: ['lime'], fb: 'sfb_lime', price: 10, unit: 'ลูกละ', qty: 10, show: 2, day: 99, recipes: [...R_TOMYAM, ...R_FRIEDRICE] },
      { id: 'lemongrass', kinds: ['lemongrass'], fb: 'sfb_lemongrass', price: 10, unit: 'กำละ', qty: 6, show: 1, day: 99, recipes: R_TOMYAM },
      { id: 'galangal', kinds: ['galangal'], fb: 'sfb_galangal', price: 10, unit: 'ถุงละ', qty: 6, show: 1, day: 99, recipes: R_TOMYAM },
      { id: 'kaffir', kinds: ['kaffir_lime'], fb: 'sfb_kaffir_lime', price: 10, unit: 'ถุงละ', qty: 6, show: 1, day: 99, recipes: [...R_TOMYAM, ...R_CURRY] },
      { id: 'mushroom', kinds: ['mushroom'], fb: 'sfb_mushroom', price: 30, unit: 'ถุงละ', qty: 5, show: 1, day: 99, recipes: R_TOMYAM },
    ],
  },
  {
    id: 'egg_stall', name: { th: 'ร้านไข่ & ของแห้งเจ๊หมวย', en: "Jeh Muay's eggs & dry goods" }, anchor: 'egg_stall', kind: 'stall',
    open: 5, close: 14, day: 1, radius: 3.8,
    keeper: { name: { th: 'เจ๊หมวย', en: 'Jeh Muay' }, archetype: 'housewife', personality: 'business_jeh', seed: 1404 },
    closedNote: { th: 'ปิดแล้ว พรุ่งนี้ตีห้า', en: 'Closed — 5 am tomorrow' },
    stock: [
      { id: 'egg', kinds: ['egg'], fb: 'sfb_egg', price: 4, unit: 'ฟองละ', qty: 60, show: 4 },
      { id: 'eggtray', kinds: ['egg_tray'], fb: 'sfb_egg_tray', price: 120, unit: 'แผงละ', qty: 4, show: 1 },
      { id: 'fish', kinds: ['fish_sauce'], fb: 'sfb_fish_sauce', price: 30, unit: 'ขวดละ', qty: 5, show: 1 },
      { id: 'oyster', kinds: ['oyster_sauce'], fb: 'sfb_oyster_sauce', price: 50, unit: 'ขวดละ', qty: 5, show: 1 },
      { id: 'soy', kinds: ['soy_light'], fb: 'sfb_soy_light', price: 42, unit: 'ขวดละ', qty: 4, show: 1 },
      { id: 'sugar', kinds: ['sugar'], fb: 'sfb_sugar', price: 26, unit: 'ถุงละ', qty: 4, show: 1 },
      { id: 'oil', kinds: ['cooking_oil'], fb: 'sfb_cooking_oil', price: 52, unit: 'ขวดละ', qty: 4, show: 1 },
      { id: 'rice', kinds: ['rice_bag'], fb: 'sfb_rice_bag', price: 185, unit: 'ถุงละ', qty: 3, show: 1 },
      { id: 'noodle', kinds: ['noodles_wide'], fb: 'sfb_noodles_wide', price: 25, unit: 'ถุงละ', qty: 6, show: 1, day: 99, recipes: [...R_SIIO, ...R_RATNA] },
      { id: 'soy_dark', kinds: ['soy_dark'], fb: 'sfb_soy_dark', price: 48, unit: 'ขวดละ', qty: 3, show: 1, day: 99, recipes: R_SIIO },
      { id: 'curry', kinds: ['curry_paste'], fb: 'sfb_curry_paste', price: 30, unit: 'ถุงละ', qty: 5, show: 1, day: 99, recipes: R_CURRY },
      { id: 'tomyum', kinds: ['tomyum_paste'], fb: 'sfb_tomyum_paste', price: 50, unit: 'กระปุกละ', qty: 4, show: 1, day: 99, recipes: R_TOMYAM },
      { id: 'starch', kinds: ['gravy_starch'], fb: 'sfb_gravy_starch', price: 18, unit: 'ถุงละ', qty: 4, show: 1, day: 99, recipes: R_RATNA },
      { id: 'pepper', kinds: ['white_pepper'], fb: 'sfb_white_pepper', price: 32, unit: 'ขวดละ', qty: 3, show: 1, day: 99, recipes: R_GARLIC },
    ],
  },
  // ------------------------------------------------------------------ SHOPHOUSES
  {
    id: 'plastic_shop', name: { th: 'ร้านพลาสติกเจ๊ติ๋ม', en: "Jeh Tim's plastic & furniture" }, anchor: 'plastic_shop', kind: 'shophouse',
    open: 8, close: 19, day: 1, radius: 5.2, shutter: { w: 11.6, off: 0, h: 3.1 },
    keeper: { name: { th: 'เจ๊ติ๋ม', en: 'Jeh Tim' }, archetype: 'housewife', personality: 'chatty_auntie', seed: 2101, sit: true },
    closedNote: { th: 'ปิดแล้วจ้า เปิด 8 โมง', en: 'Closed — opens 8 am' },
    stock: [
      { id: 'stool', kinds: ['stool_red', 'stool_plastic', 'stool'], fb: 'sfb_stool', price: 65, unit: 'ตัวละ', qty: 24, show: 4, label: { th: 'เก้าอี้พลาสติก', en: 'plastic stool' } },
      { id: 'chair', kinds: ['chair_plastic', 'chair_monobloc', 'chair'], fb: 'sfb_chair', price: 150, unit: 'ตัวละ', qty: 8, show: 2, big: true },
      { id: 'table', kinds: ['table_plastic', 'table_folding', 'table_steel', 'table'], fb: 'sfb_table', price: 390, unit: 'ตัวละ', qty: 6, show: 1, big: true },
      { id: 'umbrella', kinds: ['umbrella_garden', 'umbrella_big', 'umbrella'], fb: 'sfb_umbrella', price: 450, unit: 'คันละ', qty: 3, show: 1, big: true, day: 2 },
      { id: 'basket', kinds: ['shopping_basket'], fb: 'shopping_basket', price: 35, unit: 'ใบละ', qty: 10, show: 2 },
      { id: 'tub', kinds: ['wash_tub', 'tub', 'basin'], fb: 'sfb_tub', price: 60, unit: 'ใบละ', qty: 6, show: 1 },
      { id: 'rack', kinds: ['dish_rack'], fb: 'sfb_dish_rack', price: 180, unit: 'อันละ', qty: 4, show: 1, day: 2 },
      { id: 'cup', kinds: ['cup_plastic', 'cup_water', 'cup'], fb: 'sfb_cup', price: 8, unit: 'ใบละ', qty: 40, show: 3 },
      { id: 'bin', kinds: ['trash_bin', 'bin'], fb: 'sfb_trash_bin', price: 120, unit: 'ใบละ', qty: 4, show: 1, day: 2 },      // restaurant service gear (kinds defined by the restaurant module)
      { id: 'stool_blue', kinds: ['stool_blue'], fb: 'sfb_stool', price: 65, unit: 'ตัวละ', qty: 24, show: 2, label: { th: 'เก้าอี้พลาสติกสีน้ำเงิน', en: 'blue plastic stool' } },
      { id: 'sponge', kinds: ['sponge'], fb: 'sponge', price: 15, unit: 'อันละ', qty: 12, show: 2 },
      { id: 'tissue', kinds: ['tissue_box'], fb: 'tissue_box', price: 25, unit: 'ม้วนละ', qty: 12, show: 2 },
      { id: 'bus_tub', kinds: ['bus_tub'], fb: 'bus_tub', price: 55, unit: 'ใบละ', qty: 6, show: 1 },
      { id: 'ice_bucket', kinds: ['ice_bucket'], fb: 'ice_bucket', price: 90, unit: 'ใบละ', qty: 4, show: 1 },
      { id: 'water_dispenser', kinds: ['water_dispenser'], fb: 'water_dispenser', price: 1290, unit: 'เครื่องละ', qty: 2, show: 1, big: true, day: 2 },
    ],
  },
  {
    id: 'kitchen_shop', name: { th: 'ร้านเครื่องครัวเฮียเส็ง', en: "Hia Seng's kitchenware" }, anchor: 'kitchen_shop', kind: 'shophouse',
    open: 9, close: 18, day: 2, radius: 5.0, shutter: { w: 7.6, off: 0.5, h: 3.1 },
    keeper: { name: { th: 'เฮียเส็ง', en: 'Hia Seng' }, archetype: 'karaoke_uncle', personality: 'polite_hia', seed: 2202, sit: true },
    closedNote: { th: 'ปิดแล้ว เปิด 9 โมงเช้า', en: 'Closed — opens 9 am' },
    lockedNote: { th: 'วันนี้หยุด 1 วัน ไปงานบวชหลาน', en: "Closed today: nephew's ordination" },
    stock: [
      { id: 'wok', kinds: ['wok'], fb: 'sfb_wok', price: 350, unit: 'ใบละ', qty: 3, show: 1 },
      { id: 'spatula', kinds: ['spatula'], fb: 'sfb_spatula', price: 80, unit: 'อันละ', qty: 4, show: 1 },
      { id: 'ladle', kinds: ['ladle'], fb: 'sfb_ladle', price: 60, unit: 'อันละ', qty: 4, show: 1 },
      { id: 'cleaver', kinds: ['cleaver'], fb: 'sfb_cleaver', price: 250, unit: 'เล่มละ', qty: 3, show: 1 },
      { id: 'board', kinds: ['chopping_board'], fb: 'sfb_chopping_board', price: 320, unit: 'อันละ', qty: 3, show: 1 },
      { id: 'mortar', kinds: ['mortar'], fb: 'sfb_mortar', price: 150, unit: 'ชุดละ', qty: 3, show: 1 },
      { id: 'plate', kinds: ['plate'], fb: 'sfb_plate', price: 35, unit: 'ใบละ', qty: 24, show: 3 },
      { id: 'bowl', kinds: ['bowl'], fb: 'sfb_bowl', price: 45, unit: 'ใบละ', qty: 12, show: 2 },
      { id: 'spoon', kinds: ['spoon_fork'], fb: 'sfb_spoon_fork', price: 20, unit: 'คู่ละ', qty: 24, show: 3 },
      { id: 'paddle', kinds: ['rice_paddle'], fb: 'sfb_rice_paddle', price: 25, unit: 'อันละ', qty: 4, show: 1 },
      { id: 'ricepot', kinds: ['rice_pot', 'rice_cooker'], fb: 'sfb_rice_cooker', price: 1290, unit: 'ใบละ', qty: 2, show: 1, big: true },
      { id: 'burner', kinds: ['burner_hp', 'burner_high', 'stove_hp', 'burner'], fb: 'sfb_burner', price: 690, unit: 'ตัวละ', qty: 2, show: 1, day: 3 },
    ],
  },
  {
    id: 'gas_shop', name: { th: 'ร้านแก๊ส-น้ำดื่มลุงหนวด', en: "Uncle Nuat's gas & water" }, anchor: 'gas_shop', kind: 'shophouse',
    open: 7, close: 20, day: 2, radius: 4.8, shutter: { w: 7.6, off: 0, h: 3.1 },
    keeper: { name: { th: 'ลุงหนวด', en: 'Uncle Nuat' }, archetype: 'uncle_singlet', personality: 'gruff_uncle', seed: 2303, sit: true },
    closedNote: { th: 'ปิดแล้ว เปิด 7 โมงเช้า', en: 'Closed — opens 7 am' },
    lockedNote: { th: 'แก๊สหมด รอรถส่ง พรุ่งนี้เปิด', en: 'Out of gas — truck comes tomorrow' },
    stock: [
      { id: 'lpg', kinds: ['gas_tank'], fb: 'sfb_gas_tank', price: 1500, swapPrice: 423, unit: 'เติมถังละ', qty: 4, show: 2, label: { th: 'แก๊ส 15 กก. (แลกถัง 423)', en: 'LPG 15 kg (swap 423)' } },
      { id: 'water20', kinds: ['water_bottle_20l', 'water_20l', 'water_tank_20l'], fb: 'sfb_water20', price: 20, unit: 'ถังละ', qty: 8, show: 2 },
      { id: 'water', kinds: ['water_jug'], fb: 'sfb_water_jug', price: 12, unit: 'ขวดละ', qty: 10, show: 2 },
      { id: 'ice', kinds: ['ice_bag', 'ice'], fb: 'sfb_ice_bag', price: 15, unit: 'ถุงละ', qty: 10, show: 2 },
    ],
  },
  // ------------------------------------------------------------------ 8-TWELVE (24 h, expensive)
  {
    id: 'convenience_store', name: { th: '8-Twelve', en: '8-Twelve convenience store' }, anchor: 'convenience_store', counter: 'convenience_counter', kind: 'store',
    open: 0, close: 24, day: 1, radius: 6.5,
    keeper: { name: { th: 'น้องฟ้า (พนักงาน)', en: 'Fah, the clerk' }, archetype: 'shop_girl', personality: 'robot_clerk', seed: 3101 },
    stock: [
      { id: 'egg', kinds: ['egg'], fb: 'sfb_egg', price: 7, unit: 'ฟองละ', qty: 30, show: 2 },
      { id: 'fish', kinds: ['fish_sauce'], fb: 'sfb_fish_sauce', price: 35, unit: '', qty: 6, show: 2 },
      { id: 'oyster', kinds: ['oyster_sauce'], fb: 'sfb_oyster_sauce', price: 62, unit: '', qty: 6, show: 2 },
      { id: 'soy', kinds: ['soy_light'], fb: 'sfb_soy_light', price: 49, unit: '', qty: 4, show: 1 },
      { id: 'season', kinds: ['seasoning_sauce'], fb: 'sfb_seasoning_sauce', price: 49, unit: '', qty: 4, show: 1 },
      { id: 'sugar', kinds: ['sugar'], fb: 'sfb_sugar', price: 33, unit: '', qty: 4, show: 1 },
      { id: 'msg', kinds: ['msg'], fb: 'sfb_msg', price: 65, unit: '', qty: 4, show: 1 },
      { id: 'oil', kinds: ['cooking_oil'], fb: 'sfb_cooking_oil', price: 66, unit: '', qty: 4, show: 1 },
      { id: 'chiliflk', kinds: ['chili_flakes'], fb: 'sfb_chili_flakes', price: 29, unit: '', qty: 4, show: 1 },
      { id: 'pepper', kinds: ['white_pepper'], fb: 'sfb_white_pepper', price: 42, unit: '', qty: 3, show: 1 },
      { id: 'rice_i', kinds: ['instant_rice'], fb: 'instant_rice', price: 25, unit: '', qty: 10, show: 2, label: { th: 'ข้าวสวยพร้อมทาน', en: 'ready-to-eat rice' } },
      { id: 'mama', kinds: ['instant_noodle_cup', 'mama_cup'], fb: 'sfb_mama_cup', price: 16, unit: '', qty: 10, show: 2 },
      { id: 'water', kinds: ['water_bottle', 'water_small'], fb: 'sfb_water_bottle', price: 7, unit: '', qty: 20, show: 2 },
      { id: 'cola', kinds: ['soda_cola_can', 'soda_cola', 'soda_can'], fb: 'sfb_cola', price: 17, unit: '', qty: 12, show: 2 },
      { id: 'fanta', kinds: ['soda_fanta_can', 'soda_orange', 'soda_red'], fb: 'sfb_fanta', price: 15, unit: '', qty: 12, show: 2 },
      { id: 'fanta_green', kinds: ['soda_fanta_green'], fb: 'sfb_fanta', price: 15, unit: '', qty: 12, show: 2 },
      { id: 'soda_red', kinds: ['soda_red'], fb: 'sfb_fanta', price: 15, unit: '', qty: 12, show: 2 },
      { id: 'm150', kinds: ['energy_drink', 'm150'], fb: 'sfb_m150', price: 12, unit: '', qty: 10, show: 2 },
      { id: 'beer', kinds: ['beer_can', 'beer_chang'], fb: 'sfb_beer', price: 45, unit: '', qty: 8, show: 2, alcohol: true },
      { id: 'dogfood', kinds: ['dog_food'], fb: 'sfb_dog_food', price: 59, unit: '', qty: 6, show: 1, label: { th: 'อาหารหมา', en: 'dog food' } },
      { id: 'flashlight', kinds: ['flashlight'], fb: 'sfb_flashlight', price: 89, unit: '', qty: 4, show: 1, label: { th: 'ไฟฉาย', en: 'flashlight' } },
    ],
  },
  // ------------------------------------------------------------------ แม็กโคร่ง WHOLESALE (Day 3, cheap bulk, far away)
  {
    id: 'wholesale', name: { th: 'แม็กโคร่ง', en: 'Makrong wholesale' }, anchor: 'wholesale_door', counter: 'wholesale_counter', kind: 'warehouse',
    open: 7, close: 21, day: 3, radius: 13,
    keeper: { name: { th: 'พนักงานแคชเชียร์', en: 'cashier' }, archetype: 'shop_girl', personality: 'cashier', seed: 4101 },
    closedNote: { th: 'ปิดแล้ว เปิด 7 โมงเช้า', en: 'Closed — opens 7 am' },
    lockedNote: { th: 'ปิดปรับปรุงระบบ เปิดบริการวันที่ 3', en: 'Closed for upgrades — opens on day 3' },
    stock: [
      { id: 'pork1k', kinds: ['pork_minced'], fb: 'sfb_pork_minced', price: 135, unit: 'แพ็คละ', qty: 10, show: 2, data: { g: 1000 }, label: { th: 'หมูสับ 1 กก.', en: 'minced pork 1 kg' } },
      { id: 'chick1k', kinds: ['chicken_minced'], fb: 'sfb_chicken_minced', price: 99, unit: 'แพ็คละ', qty: 6, show: 2, data: { g: 1000 }, label: { th: 'ไก่สับ 1 กก.', en: 'minced chicken 1 kg' } },
      { id: 'eggtray', kinds: ['egg_tray'], fb: 'sfb_egg_tray', price: 110, unit: 'แผงละ', qty: 8, show: 2 },
      { id: 'rice15', kinds: ['rice_bag'], fb: 'sfb_rice_bag', price: 459, unit: 'กระสอบละ', qty: 3, show: 1, data: { g: 15000 }, label: { th: 'ข้าวหอมมะลิ 15 กก.', en: 'jasmine rice 15 kg' } },
      { id: 'garlic1k', kinds: ['garlic'], fb: 'sfb_garlic', price: 85, unit: 'ถุงละ', qty: 4, show: 1, data: { g: 1000 }, label: { th: 'กระเทียม 1 กก.', en: 'garlic 1 kg' } },
      { id: 'chili500', kinds: ['chili'], fb: 'sfb_chili', price: 55, unit: 'ถุงละ', qty: 4, show: 1, data: { g: 500 }, label: { th: 'พริกขี้หนู 500 ก.', en: 'chilies 500 g' } },
      { id: 'oil', kinds: ['cooking_oil'], fb: 'sfb_cooking_oil', price: 47, unit: 'ขวดละ', qty: 8, show: 2 },
      { id: 'fish', kinds: ['fish_sauce'], fb: 'sfb_fish_sauce', price: 27, unit: 'ขวดละ', qty: 8, show: 2 },
      { id: 'oyster', kinds: ['oyster_sauce'], fb: 'sfb_oyster_sauce', price: 45, unit: 'ขวดละ', qty: 8, show: 2 },
      { id: 'soy', kinds: ['soy_light'], fb: 'sfb_soy_light', price: 38, unit: 'ขวดละ', qty: 6, show: 1 },
      { id: 'season', kinds: ['seasoning_sauce'], fb: 'sfb_seasoning_sauce', price: 39, unit: 'ขวดละ', qty: 6, show: 1 },
      { id: 'sugar', kinds: ['sugar'], fb: 'sfb_sugar', price: 23, unit: 'ถุงละ', qty: 8, show: 1 },
      { id: 'msg', kinds: ['msg'], fb: 'sfb_msg', price: 47, unit: 'ถุงละ', qty: 6, show: 1 },
      { id: 'noodle', kinds: ['noodles_wide'], fb: 'sfb_noodles_wide', price: 22, unit: 'ถุงละ', qty: 8, show: 1, recipes: [...R_SIIO, ...R_RATNA], day: 99 },
      { id: 'plates', kinds: ['plate'], fb: 'sfb_plate', price: 29, unit: 'ใบละ', qty: 24, show: 2 },
      { id: 'cups', kinds: ['cup_plastic', 'cup_water', 'cup'], fb: 'sfb_cup', price: 5, unit: 'ใบละ', qty: 50, show: 2 },
      { id: 'cola', kinds: ['soda_cola_can', 'soda_cola', 'soda_can'], fb: 'sfb_cola', price: 13, unit: 'กระป๋องละ', qty: 24, show: 2 },
      { id: 'dogfood', kinds: ['dog_food'], fb: 'sfb_dog_food', price: 49, unit: 'ถุงละ', qty: 6, show: 1, label: { th: 'อาหารหมา (ราคาส่ง)', en: 'dog food (wholesale)' } },
    ],
  },
];

export const SHOP_BY_ID: Record<string, ShopDef> = Object.fromEntries(SHOPS.map((s) => [s.id, s]));

/** Is the clock time inside opening hours? */
export function inHours(s: ShopDef, t: number): boolean {
  if (s.open <= 0 && s.close >= 24) return true;
  return t >= s.open && t < s.close;
}

/** Thai alcohol sale hours: 11:00–14:00 and 17:00–24:00. */
export function alcoholHours(t: number) { return (t >= 11 && t < 14) || t >= 17; }

/** Reference (market) price of an item kind: the cheapest fresh-market / shop price in this table. */
export function basePrice(kind: string): number | null {
  let best: number | null = null;
  for (const s of SHOPS) for (const st of s.stock) {
    if (!st.kinds.includes(kind) && st.fb !== kind) continue;
    if (st.data) continue; // bulk packs don't count as the reference price
    if (best === null || st.price < best) best = st.price;
  }
  return best;
}

// ------------------------------------------------------------------ tuning

export const TUNE = {
  /** seconds before the keeper puts the next unit out */
  refill: 1.4,
  /** regular customer levels (relationship points) → discount */
  regular: [{ at: 3, disc: 0.05 }, { at: 6, disc: 0.1 }],
  /** delivery fee for big furniture */
  deliveryFee: 20,
  /** seconds a delivery takes */
  deliveryTime: 14,
  /** ban length (game hours) after a mad episode; day 1 is shorter so the intro can't soft-lock */
  banHours: 6,
  banHoursDay1: 1.2,
  /** bargaining: wait between rounds (s) */
  roundGap: 1.6,
  /** credit: auntie lets the gang "แปะโป้ง" once */
  creditMax: 400,
  /** debt reminder interval (real seconds) */
  remindEvery: 75,
};
