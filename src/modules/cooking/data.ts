import type { TL } from '../../core/util';

/**
 * Ingredient table: how each ingredient pours, cooks, burns and tastes.
 * Prices (baht, Bangkok fresh-market / wholesale 2025-26 ballpark) and weights (kg) are the base values
 * the shops module sells at (it applies its own bargaining / day multipliers).
 */
export interface Flavor { salt?: number; sweet?: number; spice?: number; umami?: number; sour?: number }

export interface IngDef {
  kind: string;
  name: TL;
  unit: 'g' | 'ml';
  /** default pack amount */
  amount: number;
  /** where it goes in a wok: items (cook), sauces, oil, water, raw rice (rice pot) */
  into: 'it' | 'sa' | 'oil' | 'w' | 'raw' | 'egg';
  /** pour rate unit/s, ramp seconds to reach it */
  rate: number;
  ramp?: number;
  /** temperature when it goes in (°C) */
  temp?: number;
  /** cooking: t = seconds at ~200 °C to be done, b = seconds of hard frying (dry, unstirred) to burn after done */
  cook?: { t: number; b: number; tMin?: number; loss?: number; soggy?: number; char?: boolean; soup?: boolean };
  prep?: 'pound' | 'chop';
  /** per gram flavour contributions (salt ≈ grams of salt per gram, spice ≈ fresh bird's-eye-chili equivalents) */
  flav?: Flavor;
  /** heat capacity factor (water 1) */
  cp?: number;
  mortar?: boolean;
  board?: boolean;
  bowl?: boolean;
  pot?: boolean;
  /** pour verb + sound */
  verb: 'ใส่' | 'เท' | 'โรย' | 'บีบ' | 'ตัก';
  snd: string[];
  weight: number;
  price: number;
  /** visual class for wok contents */
  vis?: 'meat' | 'meatSlice' | 'leaf' | 'bits' | 'veg' | 'noodle' | 'paste' | 'shrimp' | 'rice' | 'stick' | 'garnish';
  tags?: string[];
}

const S_SOLID = ['pour_solid', 'food_drop', 'drop_soft'];
const S_SAUCE = ['sauce_glug', 'liquid_pour', 'pour_liquid'];
const S_OIL = ['oil_pour', 'sauce_glug', 'liquid_pour'];
const S_WATER = ['water_pour', 'liquid_pour', 'sauce_glug'];
const S_SHAKE = ['shaker_shake', 'spice_shake', 'pour_solid'];

const ing = (d: IngDef) => d;

export const ING: Record<string, IngDef> = {
  // ---- proteins
  pork_minced: ing({ kind: 'pork_minced', name: { th: 'หมูสับ', en: 'minced pork' }, unit: 'g', amount: 500, into: 'it', rate: 65, ramp: 0.2, temp: 8, cook: { t: 26, b: 30, tMin: 75, loss: 0.25 }, cp: 0.8, verb: 'ใส่', snd: S_SOLID, weight: 0.55, price: 75, vis: 'meat', tags: ['meat'] }),
  chicken_minced: ing({ kind: 'chicken_minced', name: { th: 'ไก่สับ', en: 'minced chicken' }, unit: 'g', amount: 500, into: 'it', rate: 65, ramp: 0.2, temp: 8, cook: { t: 22, b: 28, tMin: 75, loss: 0.22 }, cp: 0.8, verb: 'ใส่', snd: S_SOLID, weight: 0.55, price: 60, vis: 'meat', tags: ['meat'] }),
  pork_sliced: ing({ kind: 'pork_sliced', name: { th: 'หมูสไลซ์', en: 'sliced pork' }, unit: 'g', amount: 500, into: 'it', rate: 55, ramp: 0.2, temp: 8, cook: { t: 24, b: 30, tMin: 75, loss: 0.25 }, cp: 0.8, board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.55, price: 85, vis: 'meatSlice', tags: ['meat'] }),
  shrimp: ing({ kind: 'shrimp', name: { th: 'กุ้งสด', en: 'shrimp' }, unit: 'g', amount: 300, into: 'it', rate: 50, ramp: 0.2, temp: 6, cook: { t: 12, b: 18, tMin: 70, loss: 0.15 }, cp: 0.85, verb: 'ใส่', snd: S_SOLID, weight: 0.35, price: 95, vis: 'shrimp', tags: ['meat', 'seafood'] }),
  egg: ing({ kind: 'egg', name: { th: 'ไข่ไก่', en: 'egg' }, unit: 'g', amount: 60, into: 'egg', rate: 0, verb: 'ใส่', snd: ['egg_crack'], weight: 0.06, price: 5, tags: ['egg'] }),
  // ---- aromatics
  garlic: ing({ kind: 'garlic', name: { th: 'กระเทียม', en: 'garlic' }, unit: 'g', amount: 200, into: 'it', rate: 16, ramp: 0.15, temp: 28, cook: { t: 6, b: 6, tMin: 90, loss: 0.3 }, prep: 'pound', mortar: true, board: true, cp: 0.7, verb: 'ใส่', snd: S_SOLID, weight: 0.22, price: 25, vis: 'bits', tags: ['aroma'] }),
  chili: ing({ kind: 'chili', name: { th: 'พริกขี้หนู', en: "bird's eye chili" }, unit: 'g', amount: 100, into: 'it', rate: 10, ramp: 0.15, temp: 28, cook: { t: 6, b: 10, tMin: 90, loss: 0.2 }, prep: 'pound', mortar: true, board: true, flav: { spice: 1 }, cp: 0.7, verb: 'ใส่', snd: S_SOLID, weight: 0.11, price: 20, vis: 'bits', tags: ['aroma', 'spice'] }),
  lemongrass: ing({ kind: 'lemongrass', name: { th: 'ตะไคร้', en: 'lemongrass' }, unit: 'g', amount: 150, into: 'it', rate: 25, temp: 28, cook: { t: 20, b: 25, tMin: 85, loss: 0.1, soup: true }, prep: 'chop', board: true, mortar: true, verb: 'ใส่', snd: S_SOLID, weight: 0.16, price: 10, vis: 'stick', tags: ['aroma', 'herb'] }),
  galangal: ing({ kind: 'galangal', name: { th: 'ข่า', en: 'galangal' }, unit: 'g', amount: 120, into: 'it', rate: 25, temp: 28, cook: { t: 20, b: 25, tMin: 85, loss: 0.1, soup: true }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.13, price: 10, vis: 'stick', tags: ['aroma', 'herb'] }),
  kaffir_lime: ing({ kind: 'kaffir_lime', name: { th: 'ใบมะกรูด', en: 'kaffir lime leaves' }, unit: 'g', amount: 30, into: 'it', rate: 6, temp: 28, cook: { t: 8, b: 15, tMin: 85, loss: 0.05, soup: true }, verb: 'ใส่', snd: S_SOLID, weight: 0.04, price: 10, vis: 'leaf', tags: ['herb'] }),
  // ---- herbs & veg
  holy_basil: ing({ kind: 'holy_basil', name: { th: 'ใบกะเพรา', en: 'holy basil' }, unit: 'g', amount: 100, into: 'it', rate: 22, ramp: 0.15, temp: 30, cook: { t: 4, b: 20, tMin: 80, loss: 0.35, soggy: 3.4 }, cp: 0.6, verb: 'ใส่', snd: S_SOLID, weight: 0.1, price: 10, vis: 'leaf', tags: ['herb', 'veg'] }),
  long_beans: ing({ kind: 'long_beans', name: { th: 'ถั่วฝักยาว', en: 'long beans' }, unit: 'g', amount: 250, into: 'it', rate: 40, temp: 28, cook: { t: 20, b: 30, tMin: 85, loss: 0.1 }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.26, price: 15, vis: 'veg', tags: ['veg'] }),
  onion: ing({ kind: 'onion', name: { th: 'หอมใหญ่', en: 'onion' }, unit: 'g', amount: 300, into: 'it', rate: 40, temp: 28, cook: { t: 14, b: 22, tMin: 85, loss: 0.25 }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.31, price: 15, vis: 'veg', tags: ['veg'] }),
  kale: ing({ kind: 'kale', name: { th: 'คะน้า', en: 'Chinese kale' }, unit: 'g', amount: 250, into: 'it', rate: 40, temp: 26, cook: { t: 10, b: 24, tMin: 85, loss: 0.2, soggy: 4 }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.26, price: 20, vis: 'veg', tags: ['veg'] }),
  morning_glory: ing({ kind: 'morning_glory', name: { th: 'ผักบุ้ง', en: 'morning glory' }, unit: 'g', amount: 300, into: 'it', rate: 50, temp: 26, cook: { t: 7, b: 20, tMin: 85, loss: 0.25, soggy: 3.5 }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.31, price: 15, vis: 'veg', tags: ['veg'] }),
  mushroom: ing({ kind: 'mushroom', name: { th: 'เห็ดฟาง', en: 'straw mushrooms' }, unit: 'g', amount: 200, into: 'it', rate: 40, temp: 26, cook: { t: 12, b: 25, tMin: 80, loss: 0.2, soup: true }, board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.21, price: 30, vis: 'veg', tags: ['veg'] }),
  tomato: ing({ kind: 'tomato', name: { th: 'มะเขือเทศ', en: 'tomato' }, unit: 'g', amount: 250, into: 'it', rate: 40, temp: 26, cook: { t: 10, b: 25, tMin: 80, loss: 0.2 }, prep: 'chop', board: true, flav: { sour: 0.05 }, verb: 'ใส่', snd: S_SOLID, weight: 0.26, price: 15, vis: 'veg', tags: ['veg'] }),
  spring_onion: ing({ kind: 'spring_onion', name: { th: 'ต้นหอม', en: 'spring onion' }, unit: 'g', amount: 80, into: 'it', rate: 15, temp: 26, cook: { t: 4, b: 20, tMin: 80, loss: 0.2 }, prep: 'chop', board: true, verb: 'โรย', snd: S_SOLID, weight: 0.09, price: 10, vis: 'garnish', tags: ['herb', 'veg'] }),
  cucumber: ing({ kind: 'cucumber', name: { th: 'แตงกวา', en: 'cucumber' }, unit: 'g', amount: 300, into: 'it', rate: 40, temp: 26, cook: { t: 12, b: 30, tMin: 85, loss: 0.1 }, prep: 'chop', board: true, verb: 'ใส่', snd: S_SOLID, weight: 0.31, price: 10, vis: 'garnish', tags: ['veg'] }),
  lime: ing({ kind: 'lime', name: { th: 'มะนาว', en: 'lime' }, unit: 'ml', amount: 45, into: 'sa', rate: 4, ramp: 0.2, flav: { sour: 1 }, bowl: true, verb: 'บีบ', snd: ['lime_squeeze', 'liquid_drip', 'sauce_glug'], weight: 0.12, price: 10, tags: ['sour'] }),
  // ---- starch
  noodles_wide: ing({ kind: 'noodles_wide', name: { th: 'เส้นใหญ่', en: 'wide rice noodles' }, unit: 'g', amount: 500, into: 'it', rate: 60, temp: 26, cook: { t: 10, b: 32, tMin: 85, loss: 0, char: true }, cp: 0.8, verb: 'ใส่', snd: S_SOLID, weight: 0.52, price: 25, vis: 'noodle', tags: ['starch'] }),
  rice_bag: ing({ kind: 'rice_bag', name: { th: 'ข้าวสาร', en: 'raw jasmine rice' }, unit: 'g', amount: 5000, into: 'raw', rate: 90, verb: 'เท', snd: ['rice_pour', 'pour_solid'], pot: true, weight: 5.1, price: 210, tags: ['starch'] }),
  // ---- pastes & sauces
  curry_paste: ing({ kind: 'curry_paste', name: { th: 'พริกแกงเผ็ด', en: 'red curry paste' }, unit: 'g', amount: 250, into: 'it', rate: 14, temp: 26, cook: { t: 8, b: 12, tMin: 90, loss: 0.05 }, flav: { salt: 0.07, spice: 0.35, sweet: 0.03 }, verb: 'ใส่', snd: S_SOLID, weight: 0.27, price: 30, vis: 'paste', tags: ['paste', 'spice'] }),
  tomyum_paste: ing({ kind: 'tomyum_paste', name: { th: 'น้ำพริกเผา', en: 'roasted chili paste' }, unit: 'g', amount: 230, into: 'sa', rate: 8, ramp: 0.3, flav: { salt: 0.05, sweet: 0.25, spice: 0.25, umami: 0.1 }, verb: 'ตัก', snd: S_SOLID, weight: 0.33, price: 50, tags: ['paste', 'spice'] }),
  oyster_sauce: ing({ kind: 'oyster_sauce', name: { th: 'ซอสหอยนางรม', en: 'oyster sauce' }, unit: 'g', amount: 770, into: 'sa', rate: 8, ramp: 0.45, flav: { salt: 0.1, sweet: 0.3, umami: 0.3 }, verb: 'เท', snd: S_SAUCE, weight: 1.05, price: 52, tags: ['sauce'] }),
  soy_light: ing({ kind: 'soy_light', name: { th: 'ซีอิ๊วขาว', en: 'light soy sauce' }, unit: 'ml', amount: 700, into: 'sa', rate: 7, ramp: 0.35, flav: { salt: 0.16, umami: 0.15 }, bowl: true, verb: 'เท', snd: S_SAUCE, weight: 0.95, price: 45, tags: ['sauce'] }),
  soy_dark: ing({ kind: 'soy_dark', name: { th: 'ซีอิ๊วดำหวาน', en: 'sweet dark soy sauce' }, unit: 'g', amount: 950, into: 'sa', rate: 4, ramp: 0.5, flav: { salt: 0.09, sweet: 0.45 }, verb: 'เท', snd: S_SAUCE, weight: 1.2, price: 50, tags: ['sauce'] }),
  fish_sauce: ing({ kind: 'fish_sauce', name: { th: 'น้ำปลา', en: 'fish sauce' }, unit: 'ml', amount: 700, into: 'sa', rate: 7, ramp: 0.35, flav: { salt: 0.23, umami: 0.2 }, bowl: true, verb: 'เท', snd: S_SAUCE, weight: 0.85, price: 32, tags: ['sauce'] }),
  seasoning_sauce: ing({ kind: 'seasoning_sauce', name: { th: 'ซอสปรุงรส', en: 'seasoning sauce' }, unit: 'ml', amount: 600, into: 'sa', rate: 6, ramp: 0.35, flav: { salt: 0.17, umami: 0.3, sweet: 0.05 }, bowl: true, verb: 'เท', snd: S_SAUCE, weight: 0.8, price: 45, tags: ['sauce'] }),
  sugar: ing({ kind: 'sugar', name: { th: 'น้ำตาลทราย', en: 'sugar' }, unit: 'g', amount: 1000, into: 'sa', rate: 5, ramp: 0.2, flav: { sweet: 1 }, verb: 'ใส่', snd: ['sugar_pour', 'spice_shake', 'pour_solid'], weight: 1.02, price: 27, tags: ['seasoning'] }),
  msg: ing({ kind: 'msg', name: { th: 'ผงชูรส', en: 'MSG' }, unit: 'g', amount: 500, into: 'sa', rate: 2, ramp: 0.2, flav: { salt: 0.12, umami: 2 }, verb: 'โรย', snd: S_SHAKE, weight: 0.5, price: 55, tags: ['seasoning'] }),
  white_pepper: ing({ kind: 'white_pepper', name: { th: 'พริกไทยป่น', en: 'ground white pepper' }, unit: 'g', amount: 60, into: 'sa', rate: 0.7, ramp: 0.1, flav: { spice: 0.6 }, verb: 'โรย', snd: S_SHAKE, weight: 0.15, price: 35, tags: ['seasoning', 'spice'] }),
  chili_flakes: ing({ kind: 'chili_flakes', name: { th: 'พริกป่น', en: 'chili flakes' }, unit: 'g', amount: 100, into: 'sa', rate: 2.2, ramp: 0.1, flav: { spice: 1.4 }, verb: 'โรย', snd: S_SHAKE, weight: 0.15, price: 25, tags: ['seasoning', 'spice'] }),
  gravy_starch: ing({ kind: 'gravy_starch', name: { th: 'แป้งมันละลายน้ำ', en: 'tapioca starch slurry' }, unit: 'g', amount: 500, into: 'sa', rate: 8, ramp: 0.3, verb: 'เท', snd: S_SAUCE, weight: 0.52, price: 20, tags: ['seasoning'] }),
  cooking_oil: ing({ kind: 'cooking_oil', name: { th: 'น้ำมันพืช', en: 'cooking oil' }, unit: 'ml', amount: 1000, into: 'oil', rate: 24, ramp: 0.3, temp: 28, cp: 0.45, verb: 'เท', snd: S_OIL, weight: 0.95, price: 55, tags: ['oil'] }),
  water_jug: ing({ kind: 'water_jug', name: { th: 'น้ำเปล่า', en: 'water' }, unit: 'ml', amount: 1500, into: 'w', rate: 32, ramp: 0.25, temp: 28, cp: 1, pot: true, bowl: true, verb: 'เท', snd: S_WATER, weight: 1.6, price: 15, tags: ['water'] }),
};

/** Fried-egg / omelette / scrambled egg are tracked separately in the wok. */
export const SALT_IDEAL_NOTE = 'salt-equivalents per 100 g of food';

/** Kinds that are tools/containers (defined in items-tools). Prices (baht) & weights (kg). */
export const TOOL_META: Record<string, { name: TL; price: number; weight: number }> = {
  wok: { name: { th: 'กระทะเหล็ก', en: 'carbon-steel wok' }, price: 350, weight: 2.2 },
  spatula: { name: { th: 'ตะหลิว', en: 'wok spatula' }, price: 80, weight: 0.35 },
  ladle: { name: { th: 'กระบวย', en: 'wok ladle' }, price: 60, weight: 0.3 },
  cleaver: { name: { th: 'มีดอีโต้', en: 'cleaver' }, price: 250, weight: 0.7 },
  chopping_board: { name: { th: 'เขียงไม้มะขาม', en: 'tamarind chopping board' }, price: 320, weight: 2.4 },
  mortar: { name: { th: 'ครกดินเผา', en: 'clay mortar & pestle' }, price: 150, weight: 3.2 },
  plate: { name: { th: 'จานเมลามีน', en: 'melamine plate' }, price: 35, weight: 0.25 },
  bowl: { name: { th: 'ชามตราไก่', en: 'rooster bowl' }, price: 45, weight: 0.32 },
  spoon_fork: { name: { th: 'ช้อนส้อม', en: 'spoon & fork' }, price: 20, weight: 0.06 },
  takeaway_box: { name: { th: 'กล่องข้าวกระดาษ', en: 'takeaway box' }, price: 3, weight: 0.03 },
  plastic_bag: { name: { th: 'ถุงพลาสติก', en: 'plastic bag' }, price: 1, weight: 0.01 },
  rice_paddle: { name: { th: 'ทัพพี', en: 'rice paddle' }, price: 25, weight: 0.08 },
  rice_pot: { name: { th: 'หม้อหุงข้าว', en: 'rice cooker' }, price: 1500, weight: 5.5 },
  egg_tray: { name: { th: 'แผงไข่', en: 'egg tray' }, price: 130, weight: 1.9 },
  gas_tank: { name: { th: 'ถังแก๊ส 15 กก.', en: '15 kg LPG tank' }, price: 450, weight: 18 },
  recipe_book: { name: { th: 'สมุดสูตรเฮีย', en: "Hia's recipe book" }, price: 0, weight: 0.3 },
};

export const SAUCE_KINDS = Object.values(ING).filter((d) => d.into === 'sa').map((d) => d.kind);

export function ingName(k: string): string {
  if (k === 'egg') return 'ไข่';
  return ING[k]?.name.th ?? TOOL_META[k]?.name.th ?? k;
}
