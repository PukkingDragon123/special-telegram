import type { CatalogItem, Look, Sex } from '../../game/contracts';
import { RNG } from '../../core/rng';
import { TL, tl } from '../../core/util';

/* ============================================================================================
 * Characters: clothing / hair / accessory specs, the magazine catalogue, Thai NPC archetypes and
 * the four album-cover player looks. Geometry (body.ts) and the atlas painter (atlas.ts) both
 * read these specs, so a clothing id fully describes shape + print.
 * ========================================================================================== */

export type SleeveKind = 'none' | 'cap' | 'short' | 'elbow' | 'long' | 'rolled';
export type CollarKind = 'none' | 'crew' | 'vneck' | 'scoop' | 'polo' | 'shirt' | 'camp' | 'suit' | 'mandarin' | 'robe';

export interface TopSpec {
  id: string; name: TL; price?: number; colors?: string[]; sex?: Sex | 'u'; color: string;
  sleeve: SleeveKind;
  /** extra torso radius (m) – loose shirts stand off the body */
  loose: number;
  sleeveLoose?: number;
  /** hem height (m, 1.70 m reference body); tucked tops end under the waistband */
  hem: number;
  collar: CollarKind;
  /** painter key */
  pattern: string;
  /** open shirt over an undershirt of this colour */
  under?: string;
  /** secondary colour (stripes, vest, trims) */
  color2?: string;
  hidden?: boolean;
}

export interface BottomSpec {
  id: string; name: TL; price?: number; colors?: string[]; sex?: Sex | 'u'; color: string;
  kind: 'shorts' | 'trousers' | 'skirt' | 'wrap';
  /** hem height (m, reference body) */
  hem: number;
  loose: number;
  /** skirts: extra radius at the hem */
  flare?: number;
  /** waistband height */
  waist: number;
  pattern: string;
  color2?: string;
  hidden?: boolean;
}

export type ShoeKind = 'barefoot' | 'flipflop' | 'sandal' | 'sneaker' | 'leather' | 'school' | 'boot' | 'slipper';
export interface ShoeSpec { id: string; name: TL; price?: number; colors?: string[]; color: string; kind: ShoeKind; sex?: Sex | 'u'; color2?: string; socks?: string }

export type AccKind = 'sunglasses' | 'glasses' | 'headband' | 'cap' | 'cap_back' | 'bucket' | 'straw' | 'helmet' | 'police_cap'
  | 'chain' | 'watch' | 'towel' | 'mask' | 'backpack' | 'apron' | 'lanyard' | 'sash' | 'earrings';
export interface AccSpec { id: string; name: TL; price?: number; colors?: string[]; color: string; kind: AccKind; slot: 'hat' | 'eyes' | 'neck' | 'wrist' | 'face' | 'back' | 'body' | 'band' | 'ears'; hidden?: boolean; sex?: Sex | 'u' }

export interface HairSpec { id: string; name: TL; price?: number; sex?: Sex | 'u'; hidden?: boolean }

// ------------------------------------------------------------------ palettes

export const SKINS = ['#ecc9a8', '#e2b893', '#d8aa84', '#cd9c76', '#c28e69', '#b6815d', '#a67250', '#956345', '#82553a'];
export const HAIR_COLORS = ['#141110', '#1c1511', '#2a1d16', '#3b281c', '#4d3021', '#5c2c1c', '#8a6a44', '#b08a52', '#8f8b86', '#c8c4bd'];
const BRIGHT = ['#c8423a', '#2f5fa8', '#e2d9c6', '#4f7d3c', '#e8a33d', '#7b4f9e', '#1d1d1f', '#f2efe8', '#d86b8c', '#3a8f9a', '#9c3a2d', '#5b6b7a'];
const DULL = ['#7d7466', '#5a5650', '#3d4752', '#6b5b4a', '#8e8576', '#4a4f3a', '#2d3036', '#a39883'];
const PASTEL = ['#f3c8d2', '#c9e0f2', '#f7e7b0', '#cfe8cf', '#e4d2f0', '#f6f2ea'];

// ------------------------------------------------------------------ tops

const T = (id: string, th: string, en: string, o: Partial<TopSpec>): TopSpec => ({
  id, name: tl(th, en), sleeve: 'short', loose: 0.012, hem: 0.9, collar: 'crew', pattern: 'jersey', color: '#e9e6df', sex: 'u', ...o,
});

export const TOPS: TopSpec[] = [
  T('singlet_white', 'เสื้อกล้ามสีขาว', 'white ribbed singlet', { price: 59, sleeve: 'none', loose: 0.004, hem: 0.9, collar: 'scoop', pattern: 'rib', color: '#f1eee6', colors: ['#f1eee6', '#e8e2d2', '#1d1d1f', '#8a8f96'] }),
  T('tshirt', 'เสื้อยืด', 't-shirt', { price: 99, pattern: 'jersey', color: '#c8423a', colors: BRIGHT }),
  T('tshirt_print', 'เสื้อยืดสกรีนลาย', 'printed tee', { price: 129, pattern: 'tee_print', color: '#1d1d1f', colors: ['#1d1d1f', '#f2efe8', '#2f5fa8', '#c8423a', '#e8a33d'] }),
  T('shirt_stripe_white', 'เสื้อแขนยาวลายขวาง', 'white/grey striped shirt', { price: 290, sleeve: 'long', loose: 0.016, hem: 0.86, collar: 'crew', pattern: 'stripe_h', color: '#ece9e2', color2: '#55585e', colors: ['#ece9e2', '#e6e0d0', '#d9e2ea'] }),
  T('hawaiian_green', 'เสื้อฮาวายสีเขียว', 'green hawaiian shirt', { price: 350, sleeve: 'short', loose: 0.022, sleeveLoose: 0.02, hem: 0.84, collar: 'camp', pattern: 'hawaiian', color: '#7fbf5a', color2: '#2d6a2a', under: '#f4f2ec', colors: ['#7fbf5a', '#5fa0c8', '#e07a4a', '#e8c64a'] }),
  T('hawaiian', 'เสื้อฮาวายลายดอก', 'floral hawaiian shirt', { price: 320, sleeve: 'short', loose: 0.022, sleeveLoose: 0.02, hem: 0.84, collar: 'camp', pattern: 'hawaiian', color: '#3f6fb0', color2: '#f2e6c8', colors: ['#3f6fb0', '#c8423a', '#2d6a4a', '#e8a33d', '#1d1d1f'] }),
  T('polo_stripe_green', 'เสื้อโปโลลายขวางเขียว-ขาว', 'green-white striped polo', { price: 250, sleeve: 'short', loose: 0.014, hem: 0.86, collar: 'polo', pattern: 'polo_stripe', color: '#4f9a62', color2: '#f2f0ea', colors: ['#4f9a62', '#2f5fa8', '#c8423a', '#1d1d1f'] }),
  T('polo', 'เสื้อโปโล', 'polo shirt', { price: 220, sleeve: 'short', loose: 0.013, hem: 0.86, collar: 'polo', pattern: 'pique', color: '#2f4f86', colors: BRIGHT }),
  T('shirt_white', 'เสื้อเชิ้ตขาว', 'white button shirt', { price: 390, sleeve: 'rolled', loose: 0.016, hem: 0.84, collar: 'shirt', pattern: 'oxford', color: '#f3f1ec', color2: '#c9ccd2', colors: ['#f3f1ec', '#dfe8f2', '#f0e6dc'] }),
  T('dress_shirt', 'เสื้อเชิ้ตทำงาน', 'office shirt', { price: 350, sleeve: 'long', loose: 0.012, hem: 0.98, collar: 'shirt', pattern: 'oxford', color: '#cfe0f1', color2: '#9fb1c6', colors: ['#cfe0f1', '#f3f1ec', '#f2d9de', '#e2e2e2', '#d9e8d2'] }),
  T('blouse_office', 'เสื้อเบลาส์ทำงาน', 'office blouse', { price: 320, sex: 'f', sleeve: 'short', loose: 0.012, hem: 0.98, collar: 'mandarin', pattern: 'satin_plain', color: '#f3f1ec', colors: ['#f3f1ec', '#f2d9de', '#cfe0f1', '#1d1d1f', '#e9dcc6'] }),
  T('suit_black', 'สูทดำ', 'black suit', { price: 2500, sleeve: 'long', loose: 0.03, sleeveLoose: 0.016, hem: 0.8, collar: 'suit', pattern: 'suit', color: '#1e1f24', color2: '#f3f1ec', colors: ['#1e1f24', '#2b3550', '#4a4d52'] }),
  T('suit_maroon', 'สูทสีเลือดหมู', 'maroon casino suit', { price: 3200, sleeve: 'long', loose: 0.03, sleeveLoose: 0.016, hem: 0.8, collar: 'suit', pattern: 'suit', color: '#5e1a22', color2: '#1d1d1f', colors: ['#5e1a22', '#3c1a4a'] }),
  T('suit_gold', 'สูทสีทองเงาวับ', 'shiny gold suit', { price: 4900, sleeve: 'long', loose: 0.03, sleeveLoose: 0.016, hem: 0.8, collar: 'suit', pattern: 'suit_shiny', color: '#b8923a', color2: '#1d1d1f', colors: ['#b8923a', '#c0c3c8'] }),
  T('moto_vest', 'เสื้อวินมอเตอร์ไซค์', 'motorbike-taxi vest', { price: 150, sleeve: 'short', loose: 0.022, hem: 0.88, collar: 'vneck', pattern: 'moto_vest', color: '#e8682a', color2: '#d9d4c8', colors: ['#e8682a', '#e2a02a', '#3a7fc8'] }),
  T('school_shirt', 'เสื้อนักเรียน', 'school shirt', { price: 180, sleeve: 'short', loose: 0.014, hem: 0.97, collar: 'shirt', pattern: 'school', color: '#f5f4f0', color2: '#1f3a8a' }),
  T('school_blouse', 'เสื้อนักเรียนหญิง', 'school blouse', { price: 180, sex: 'f', sleeve: 'short', loose: 0.014, hem: 0.96, collar: 'mandarin', pattern: 'school_girl', color: '#f5f4f0', color2: '#1f3a8a' }),
  T('auntie_blouse', 'เสื้อลายดอกป้า', 'auntie floral blouse', { price: 159, sex: 'f', sleeve: 'short', loose: 0.026, sleeveLoose: 0.022, hem: 0.84, collar: 'vneck', pattern: 'floral', color: '#b84a6a', color2: '#f1d9a0', colors: ['#b84a6a', '#3f6fb0', '#2d6a4a', '#7b4f9e', '#c8423a', '#d98a2a'] }),
  T('house_dress', 'ชุดอยู่บ้านลายดอก', 'house dress top', { price: 129, sex: 'f', sleeve: 'cap', loose: 0.03, sleeveLoose: 0.02, hem: 0.74, collar: 'scoop', pattern: 'floral_small', color: '#6d8fbf', color2: '#f2efe2', colors: ['#6d8fbf', '#c46a7a', '#7fae7a', '#d6b25a'] }),
  T('police_shirt', 'เสื้อตำรวจ', 'police uniform', { price: undefined, hidden: true, sleeve: 'short', loose: 0.008, hem: 0.98, collar: 'shirt', pattern: 'police', color: '#6f5236' }),
  T('security_shirt', 'เสื้อ รปภ.', 'security guard shirt', { price: 260, sleeve: 'short', loose: 0.012, hem: 0.98, collar: 'shirt', pattern: 'security', color: '#2a3550', color2: '#d8c27a', colors: ['#2a3550', '#f3f1ec'] }),
  T('rider_jacket', 'เสื้อแจ็คเก็ตไรเดอร์', 'delivery rider jacket', { price: 450, sleeve: 'long', loose: 0.03, sleeveLoose: 0.02, hem: 0.86, collar: 'mandarin', pattern: 'rider', color: '#2f9a4a', color2: '#1d2a22', colors: ['#2f9a4a', '#e0457b', '#e8682a'] }),
  T('work_shirt', 'เสื้อแขนยาวคนงาน', 'long-sleeve work shirt', { price: 120, sleeve: 'long', loose: 0.02, hem: 0.86, collar: 'crew', pattern: 'work', color: '#7a6f5f', colors: ['#7a6f5f', '#5a6a7a', '#8a3a2a', '#4a5a3a'] }),
  T('sweeper_uniform', 'ชุดพนักงานกวาดถนน', 'street sweeper uniform', { price: undefined, hidden: true, sleeve: 'long', loose: 0.02, hem: 0.86, collar: 'mandarin', pattern: 'sweeper', color: '#e86a1e', color2: '#d8e04a' }),
  T('tank_elephant', 'เสื้อกล้ามลายช้าง', 'elephant tank top', { price: 120, sleeve: 'none', loose: 0.01, hem: 0.88, collar: 'scoop', pattern: 'elephant_tank', color: '#2f5fa8', colors: ['#2f5fa8', '#1d1d1f', '#c8423a', '#4f7d3c'] }),
  T('shirt_satin', 'เสื้อเชิ้ตผ้ามันวาว', 'shiny satin shirt', { price: 499, sleeve: 'long', loose: 0.02, hem: 0.86, collar: 'shirt', pattern: 'satin', color: '#5b2a86', colors: ['#5b2a86', '#b8923a', '#a8202e', '#1d1d1f'] }),
  T('blouse_cute', 'เสื้อน่ารักแขนตุ๊กตา', 'cute puff-sleeve top', { price: 290, sex: 'f', sleeve: 'cap', loose: 0.014, sleeveLoose: 0.03, hem: 0.98, collar: 'scoop', pattern: 'cute', color: '#f3c8d2', colors: PASTEL }),
  T('tshirt_ragged', 'เสื้อยืดเก่าขาด', 'old torn t-shirt', { price: 5, sleeve: 'short', loose: 0.02, hem: 0.84, collar: 'crew', pattern: 'ragged', color: '#8a8270', colors: ['#8a8270', '#6b6a5e', '#7d5a4a'] }),
  T('temple_white', 'เสื้อขาวไปวัด', 'white temple blouse', { price: 199, sex: 'f', sleeve: 'long', loose: 0.016, hem: 0.88, collar: 'mandarin', pattern: 'white_blouse', color: '#f6f5f0' }),
  T('gamer_tee', 'เสื้อยืดเกมเมอร์', 'gamer tee', { price: 159, sleeve: 'short', loose: 0.022, hem: 0.84, collar: 'crew', pattern: 'gamer', color: '#1d1d1f', colors: ['#1d1d1f', '#2a2a40', '#3a1d3f'] }),
  T('monk_robe', 'จีวร', 'saffron robe', { hidden: true, sleeve: 'none', loose: 0.028, hem: 0.8, collar: 'robe', pattern: 'robe', color: '#d9781f' }),
];

// ------------------------------------------------------------------ bottoms

const B = (id: string, th: string, en: string, o: Partial<BottomSpec>): BottomSpec => ({
  id, name: tl(th, en), kind: 'shorts', hem: 0.6, loose: 0.015, waist: 1.0, pattern: 'plain', color: '#3d4752', sex: 'u', ...o,
});

export const BOTTOMS: BottomSpec[] = [
  B('boxer_plaid', 'กางเกงบ็อกเซอร์ลายสก็อต', 'plaid boxer shorts', { price: 79, kind: 'shorts', hem: 0.67, loose: 0.026, pattern: 'plaid', color: '#3a5aa0', color2: '#d8d2c0', colors: ['#3a5aa0', '#a03a3a', '#3a7a4a', '#5a4a7a'] }),
  B('cloth_shorts', 'กางเกงขาสั้นผ้า', 'cloth shorts', { price: 150, kind: 'shorts', hem: 0.57, loose: 0.02, pattern: 'twill', color: '#a8956e', colors: ['#a8956e', '#3d4752', '#5a5a4a', '#6b5b4a'] }),
  B('basketball_shorts', 'กางเกงบาส', 'basketball shorts', { price: 199, kind: 'shorts', hem: 0.5, loose: 0.032, pattern: 'mesh', color: '#1d3a8a', color2: '#f2efe8', colors: ['#1d3a8a', '#a8202e', '#1d1d1f', '#e8a33d', '#2f7a3a'] }),
  B('jeans', 'กางเกงยีนส์', 'jeans', { price: 490, kind: 'trousers', hem: 0.05, loose: 0.01, pattern: 'denim', color: '#2c3a58', colors: ['#2c3a58', '#3e5578', '#1d2230', '#5f7896'] }),
  B('slacks', 'กางเกงสแล็ค', 'slacks', { price: 390, kind: 'trousers', hem: 0.05, loose: 0.013, pattern: 'twill_fine', color: '#26272c', colors: ['#26272c', '#3d4752', '#5a5650', '#6f5236', '#a39883'] }),
  B('khaki_pants', 'กางเกงขายาวสีกากี', 'khaki trousers', { price: 350, kind: 'trousers', hem: 0.05, loose: 0.014, pattern: 'twill', color: '#b9a57e', colors: ['#b9a57e', '#8a7a5a'] }),
  B('sarong_m', 'โสร่ง', "men's plaid sarong", { price: 120, sex: 'm', kind: 'wrap', hem: 0.1, loose: 0.03, flare: 0.0, pattern: 'sarong_plaid', color: '#3a4a7a', color2: '#7a2a2a', colors: ['#3a4a7a', '#4a6a4a', '#6a3a3a'] }),
  B('pha_khao_ma', 'ผ้าขาวม้า', 'checked cloth wrap', { price: 89, kind: 'wrap', hem: 0.47, loose: 0.03, flare: 0.01, pattern: 'checker', color: '#c8423a', color2: '#2f5fa8', colors: ['#c8423a', '#2f5fa8', '#3a8a4a'] }),
  B('pha_thung', 'ผ้าถุง', "women's batik sarong", { price: 150, sex: 'f', kind: 'wrap', hem: 0.08, loose: 0.025, flare: 0.005, pattern: 'batik', color: '#5a3a2a', color2: '#d9b25a', colors: ['#5a3a2a', '#2a3a5a', '#3a5a3a', '#6a2a3a'] }),
  B('skirt', 'กระโปรง', 'knee skirt', { price: 250, sex: 'f', kind: 'skirt', hem: 0.47, loose: 0.02, flare: 0.05, pattern: 'plain_fabric', color: '#1d1d1f', colors: ['#1d1d1f', '#3d4752', '#7a2a3a', '#a39883', '#2f5fa8'] }),
  B('skirt_school', 'กระโปรงนักเรียน', 'school skirt', { price: 220, sex: 'f', kind: 'skirt', hem: 0.45, loose: 0.02, flare: 0.07, pattern: 'pleat', color: '#1f2a4a', colors: ['#1f2a4a', '#1d1d1f'] }),
  B('shorts_school', 'กางเกงนักเรียน', 'school shorts', { price: 200, sex: 'm', kind: 'shorts', hem: 0.6, loose: 0.02, pattern: 'twill_fine', color: '#24305a', colors: ['#24305a', '#a8956e', '#1d1d1f'] }),
  B('elephant_pants', 'กางเกงช้าง', 'elephant pants', { price: 150, kind: 'trousers', hem: 0.07, loose: 0.035, pattern: 'elephant', color: '#2a4a8a', color2: '#e8d9a0', colors: ['#2a4a8a', '#1d1d1f', '#8a2a3a', '#2a6a5a'] }),
  B('denim_shorts', 'กางเกงยีนส์ขาสั้น', 'denim shorts', { price: 290, kind: 'shorts', hem: 0.72, loose: 0.012, pattern: 'denim_light', color: '#6f8fb8', colors: ['#6f8fb8', '#2c3a58', '#e9e6df'] }),
  B('khakuay', 'กางเกงขาก๊วย', 'fisherman pants', { price: 129, kind: 'trousers', hem: 0.24, loose: 0.04, pattern: 'plain_fabric', color: '#2a2a2e', colors: ['#2a2a2e', '#3a4a6a', '#6a4a3a'] }),
  B('monk_robe_lower', 'สบง', 'robe (lower)', { hidden: true, kind: 'wrap', hem: 0.2, loose: 0.03, flare: 0.02, pattern: 'robe', color: '#d9781f' }),
];

// ------------------------------------------------------------------ shoes

export const SHOES: ShoeSpec[] = [
  { id: 'flipflops', name: tl('รองเท้าแตะฟองน้ำ', 'rubber flip-flops'), price: 49, kind: 'flipflop', color: '#2f63b8', color2: '#f2f0ea', colors: ['#2f63b8', '#c8423a', '#2f8a4a', '#1d1d1f'] },
  { id: 'sneakers', name: tl('รองเท้าผ้าใบ', 'sneakers'), price: 890, kind: 'sneaker', color: '#f2f1ee', color2: '#2a2f3a', colors: ['#f2f1ee', '#1d1d1f', '#c8423a', '#2f5fa8'], socks: '#f4f4f0' },
  { id: 'leather', name: tl('รองเท้าหนัง', 'leather shoes'), price: 1200, kind: 'leather', color: '#1a1512', colors: ['#1a1512', '#5a3520'], socks: '#1d1d1f' },
  { id: 'sandals', name: tl('รองเท้ารัดส้น', 'sandals'), price: 250, kind: 'sandal', color: '#5a3a22', colors: ['#5a3a22', '#1d1d1f', '#8a6a3a'] },
  { id: 'slippers', name: tl('รองเท้าแตะสวม', 'slide slippers'), price: 99, kind: 'slipper', color: '#1d1d1f', colors: ['#1d1d1f', '#c8423a', '#2f5fa8', '#f2f0ea'] },
  { id: 'school_shoes', name: tl('รองเท้านักเรียน', 'school shoes'), price: 390, kind: 'school', color: '#1a1512', colors: ['#1a1512', '#6a4a2a'], socks: '#f4f4f0' },
  { id: 'rubber_boots', name: tl('รองเท้าบูทยาง', 'rubber boots'), price: 220, kind: 'boot', color: '#1d1d1f', colors: ['#1d1d1f', '#f2f0ea', '#2f5f3a'] },
  { id: 'barefoot', name: tl('เท้าเปล่า', 'barefoot'), price: 0, kind: 'barefoot', color: '#000000' },
];

// ------------------------------------------------------------------ accessories

const A = (id: string, th: string, en: string, kind: AccKind, slot: AccSpec['slot'], color: string, price?: number, colors?: string[], extra: Partial<AccSpec> = {}): AccSpec =>
  ({ id, name: tl(th, en), kind, slot, color, price, colors, ...extra });

export const ACCS: AccSpec[] = [
  A('sunglasses', 'แว่นกันแดด', 'sunglasses', 'sunglasses', 'eyes', '#b0642a', 199, ['#b0642a', '#1d1d1f', '#3a4a5a']),
  A('glasses', 'แว่นสายตา', 'glasses', 'glasses', 'eyes', '#2a2420', 350, ['#2a2420', '#8a6a3a', '#b8923a']),
  A('headband_white', 'ผ้าคาดหัวสีขาว', 'white headband', 'headband', 'band', '#f4f2ee', 39, ['#f4f2ee', '#c8423a', '#1d1d1f']),
  A('cap_red', 'หมวกแก๊ปแดง', 'red cap', 'cap', 'hat', '#b8302a', 150),
  A('cap_navy', 'หมวกแก๊ปกรมท่า', 'navy cap', 'cap', 'hat', '#1f2a4a', 150),
  A('cap_black', 'หมวกแก๊ปดำ', 'black cap', 'cap', 'hat', '#1d1d1f', 150),
  A('cap_white', 'หมวกแก๊ปขาว', 'white cap', 'cap', 'hat', '#eeece6', 150),
  A('cap_yellow', 'หมวกแก๊ปเหลือง', 'yellow cap', 'cap', 'hat', '#e2b32a', 150),
  A('cap_back_black', 'หมวกแก๊ปใส่กลับหลัง', 'backwards cap', 'cap_back', 'hat', '#1d1d1f', 150, ['#1d1d1f', '#b8302a', '#eeece6']),
  A('bucket_hat', 'หมวกบักเก็ต', 'bucket hat', 'bucket', 'hat', '#c9b88f', 180, ['#c9b88f', '#1d1d1f', '#4f6a3a', '#2f5fa8']),
  A('straw_hat', 'หมวกสาน', 'woven straw hat', 'straw', 'hat', '#cfae6a', 80),
  A('helmet', 'หมวกกันน็อค', 'helmet', 'helmet', 'hat', '#d8d6d0', 450, ['#d8d6d0', '#1d1d1f', '#b8302a', '#2f5fa8', '#e8682a']),
  A('police_cap', 'หมวกตำรวจ', 'police cap', 'police_cap', 'hat', '#5f4630', undefined, undefined, { hidden: true }),
  A('gold_chain', 'สร้อยทอง (ปลอม)', 'gold chain (fake)', 'chain', 'neck', '#d8b04a', 99),
  A('watch_casio', 'นาฬิกาดิจิตอล', 'cheap digital watch', 'watch', 'wrist', '#2a2a2c', 299, ['#2a2a2c', '#c0c3c8', '#b8923a']),
  A('towel_neck', 'ผ้าขนหนูพาดคอ', 'towel around neck', 'towel', 'neck', '#f2f0ea', 59, ['#f2f0ea', '#e2b32a', '#6fa8d8', '#e07a8a']),
  A('face_mask', 'หน้ากากอนามัย', 'face mask', 'mask', 'face', '#bcd6e8', 10, ['#bcd6e8', '#f2f2f0', '#1d1d1f', '#e8c8d0']),
  A('apron', 'ผ้ากันเปื้อน', 'apron', 'apron', 'body', '#2f5fa8', 89, ['#2f5fa8', '#c8423a', '#f2f0ea', '#4a4a4a', '#e8a33d']),
  A('backpack', 'กระเป๋าเป้', 'backpack', 'backpack', 'back', '#3a4a3a', 590, ['#3a4a3a', '#1d1d1f', '#c8423a', '#2f5fa8']),
  A('lanyard', 'สายคล้องบัตรพนักงาน', 'staff ID lanyard', 'lanyard', 'neck', '#2f5fa8', 49, ['#2f5fa8', '#c8423a', '#1d1d1f']),
  A('sash', 'ผ้าสไบ', 'shoulder sash', 'sash', 'body', '#f6f5f0', 120, ['#f6f5f0', '#d8b04a', '#d86b8c'], { sex: 'f' }),
  A('earrings', 'ต่างหูทอง', 'gold earrings', 'earrings', 'ears', '#d8b04a', 390, undefined, { sex: 'f' }),
];

// ------------------------------------------------------------------ hair

export const HAIRS: HairSpec[] = [
  { id: 'buzz', name: tl('ทรงเกรียน', 'buzz cut'), price: 50 },
  { id: 'short', name: tl('ทรงสั้น', 'short'), price: 100 },
  { id: 'side_part', name: tl('ทรงแสกข้าง', 'side part'), price: 150 },
  { id: 'school_cut', name: tl('ทรงนักเรียน', 'school cut'), price: 80, sex: 'm' },
  { id: 'bowl', name: tl('ทรงกะลาครอบ', 'bowl cut'), price: 80 },
  { id: 'spiky', name: tl('ทรงตั้งชี้ฟู', 'spiky'), price: 160 },
  { id: 'mullet', name: tl('ทรงมัลเล็ต', 'mullet'), price: 180 },
  { id: 'shaggy', name: tl('ผมยาวประบ่า', 'shaggy shoulder-length'), price: 220 },
  { id: 'afro', name: tl('ทรงแอฟโฟร', 'afro'), price: 350 },
  { id: 'long', name: tl('ผมยาวตรง', 'long straight'), price: 250 },
  { id: 'ponytail', name: tl('ผมหางม้า', 'ponytail'), price: 120 },
  { id: 'bob', name: tl('ผมบ็อบ', 'bob'), price: 150 },
  { id: 'school_bob', name: tl('ผมบ็อบนักเรียน', 'school bob'), price: 100, sex: 'f' },
  { id: 'auntie_perm', name: tl('ผมดัดป้า', 'auntie perm'), price: 200 },
  { id: 'bun', name: tl('ผมมวย', 'bun'), price: 80 },
  { id: 'salt_pepper', name: tl('ผมสั้นสีดอกเลา', 'salt & pepper'), price: 100 },
  { id: 'bald', name: tl('หัวล้าน', 'bald (with fringe)'), price: 0 },
  { id: 'shaved', name: tl('โกนเกลี้ยง', 'shaved'), price: 0 },
];

// ------------------------------------------------------------------ lookup helpers

const byId = <T extends { id: string }>(a: T[]) => new Map(a.map((x) => [x.id, x]));
const TOP_MAP = byId(TOPS), BOT_MAP = byId(BOTTOMS), SHOE_MAP = byId(SHOES), ACC_MAP = byId(ACCS), HAIR_MAP = byId(HAIRS);

/** Resolve any (also unknown / legacy) clothing id to a spec. */
export function topSpec(id: string | undefined): TopSpec {
  if (id && TOP_MAP.has(id)) return TOP_MAP.get(id)!;
  const s = (id ?? '').toLowerCase();
  if (/singlet|tank|kl?am/.test(s)) return TOP_MAP.get('singlet_white')!;
  if (/hawai/.test(s)) return TOP_MAP.get('hawaiian')!;
  if (/polo/.test(s)) return TOP_MAP.get('polo')!;
  if (/suit/.test(s)) return TOP_MAP.get('suit_black')!;
  if (/vest|moto|win/.test(s)) return TOP_MAP.get('moto_vest')!;
  if (/school|student/.test(s)) return TOP_MAP.get('school_shirt')!;
  if (/blouse|auntie/.test(s)) return TOP_MAP.get('auntie_blouse')!;
  if (/stripe/.test(s)) return TOP_MAP.get('shirt_stripe_white')!;
  if (/shirt/.test(s) && !/t-?shirt/.test(s)) return TOP_MAP.get('dress_shirt')!;
  return TOP_MAP.get('tshirt')!;
}
export function bottomSpec(id: string | undefined): BottomSpec {
  if (id && BOT_MAP.has(id)) return BOT_MAP.get(id)!;
  const s = (id ?? '').toLowerCase();
  if (/boxer/.test(s)) return BOT_MAP.get('boxer_plaid')!;
  if (/basket/.test(s)) return BOT_MAP.get('basketball_shorts')!;
  if (/jean|denim/.test(s)) return BOT_MAP.get(/short/.test(s) ? 'denim_shorts' : 'jeans')!;
  if (/school/.test(s)) return BOT_MAP.get(/skirt/.test(s) ? 'skirt_school' : 'shorts_school')!;
  if (/skirt/.test(s)) return BOT_MAP.get('skirt')!;
  if (/sarong/.test(s)) return BOT_MAP.get('sarong_m')!;
  if (/thung|batik/.test(s)) return BOT_MAP.get('pha_thung')!;
  if (/khao.?ma|checker/.test(s)) return BOT_MAP.get('pha_khao_ma')!;
  if (/slack|trouser|pant/.test(s)) return BOT_MAP.get('slacks')!;
  return BOT_MAP.get('cloth_shorts')!;
}
export function shoeSpec(id: string | undefined): ShoeSpec {
  if (id && SHOE_MAP.has(id)) return SHOE_MAP.get(id)!;
  const s = (id ?? '').toLowerCase();
  if (/flip|thong/.test(s)) return SHOE_MAP.get('flipflops')!;
  if (/sneak|canvas/.test(s)) return SHOE_MAP.get('sneakers')!;
  if (/leather|oxford|dress/.test(s)) return SHOE_MAP.get('leather')!;
  if (/sandal/.test(s)) return SHOE_MAP.get('sandals')!;
  if (/boot/.test(s)) return SHOE_MAP.get('rubber_boots')!;
  if (/bare|none/.test(s)) return SHOE_MAP.get('barefoot')!;
  return SHOE_MAP.get('flipflops')!;
}
export function accSpec(id: string): AccSpec | null {
  if (ACC_MAP.has(id)) return ACC_MAP.get(id)!;
  const m = /^cap_(back_)?(.+)$/.exec(id);
  if (m) {
    const named: Record<string, string> = { red: '#b8302a', blue: '#2f5fa8', navy: '#1f2a4a', black: '#1d1d1f', white: '#eeece6', green: '#2f6a3a', yellow: '#e2b32a', orange: '#e8682a', pink: '#e07a9a', grey: '#7a7a7a' };
    const c = m[2].startsWith('#') ? m[2] : named[m[2]] ?? '#5a5a5a';
    return { id, name: tl('หมวกแก๊ป', 'cap'), kind: m[1] ? 'cap_back' : 'cap', slot: 'hat', color: c, price: 150 };
  }
  if (/sunglass/.test(id)) return ACC_MAP.get('sunglasses')!;
  if (/glass/.test(id)) return ACC_MAP.get('glasses')!;
  if (/headband/.test(id)) return ACC_MAP.get('headband_white')!;
  if (/chain|necklace/.test(id)) return ACC_MAP.get('gold_chain')!;
  if (/watch/.test(id)) return ACC_MAP.get('watch_casio')!;
  if (/towel/.test(id)) return ACC_MAP.get('towel_neck')!;
  if (/mask/.test(id)) return ACC_MAP.get('face_mask')!;
  if (/helmet/.test(id)) return ACC_MAP.get('helmet')!;
  if (/bucket/.test(id)) return ACC_MAP.get('bucket_hat')!;
  return null;
}
export function hairSpec(id: string | undefined): HairSpec { return HAIR_MAP.get(id ?? '') ?? HAIR_MAP.get('short')!; }

// ------------------------------------------------------------------ faces (photo manifest + procedural fallback)

export interface FaceEntry {
  id: string; sex: Sex; age: 'teen' | 'young' | 'middle' | 'old'; roles: string[];
  name: TL;
  /** photo face (from public/assets/textures/faces/manifest.json) */
  photo?: { base: string; detail?: string; mask?: string; variants: Record<string, { base: string; detail?: string; mask?: string }>; avg?: [number, number, number]; chinY?: number };
  /** procedural face parameters seed */
  seed?: number;
}

const PROC_FACES: FaceEntry[] = [];
{
  const ages: FaceEntry['age'][] = ['young', 'young', 'young', 'young', 'young', 'teen', 'young', 'young', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'old', 'old', 'old', 'old'];
  for (let i = 1; i <= 18; i++) PROC_FACES.push({ id: 'm' + String(i).padStart(2, '0'), sex: 'm', age: ages[i - 1], roles: [], name: tl(`หน้าผู้ชาย ${i}`, `male face ${i}`), seed: i * 7919 });
  const fages: FaceEntry['age'][] = ['young', 'young', 'young', 'teen', 'young', 'young', 'young', 'middle', 'middle', 'middle', 'middle', 'old', 'old', 'old', 'old'];
  for (let i = 1; i <= 15; i++) PROC_FACES.push({ id: 'f' + String(i).padStart(2, '0'), sex: 'f', age: fages[i - 1], roles: [], name: tl(`หน้าผู้หญิง ${i}`, `female face ${i}`), seed: i * 104729 });
}

export const FACES: { list: FaceEntry[]; photos: boolean } = { list: PROC_FACES.slice(), photos: false };

const AGE_TH: Record<string, string> = { teen: 'วัยรุ่น', young: 'หนุ่มสาว', middle: 'วัยกลางคน', old: 'สูงวัย' };

/** Parse the research agent's face manifest (format tolerant). */
export function ingestFaceManifest(m: any, base = 'textures/faces/') {
  if (!m) return;
  const rawList: any[] = Array.isArray(m) ? m : Array.isArray(m.faces) ? m.faces : typeof m === 'object' ? Object.entries(m.faces ?? m).filter(([k]) => !k.startsWith('_')).map(([k, v]: any) => ({ id: k, ...(v ?? {}) })) : [];
  const out: FaceEntry[] = [];
  const path = (f: string | undefined) => (!f ? undefined : /^(textures|https?:|data:)/.test(f) ? f : base + f);
  for (const r of rawList) {
    if (!r || !r.id) continue;
    const files = r.files ?? {};
    const baseFile = r.base ?? r.file ?? r.image ?? files.base ?? files.neutral ?? (typeof files === 'object' && Array.isArray(files) ? files.find((f: string) => !/_detail|_mask/.test(f) && f.startsWith(r.id + '.')) : undefined) ?? `${r.id}.jpg`;
    const detail = r.detail ?? files.detail ?? (Array.isArray(files) ? files.find((f: string) => f === `${r.id}_detail.jpg`) : undefined) ?? `${r.id}_detail.jpg`;
    const mask = r.mask ?? files.mask ?? (Array.isArray(files) ? files.find((f: string) => f === `${r.id}_mask.png`) : undefined) ?? `${r.id}_mask.png`;
    const variants: Record<string, { base: string; detail?: string; mask?: string }> = {};
    const vsrc = r.variants ?? files.variants ?? {};
    const addVar = (name: string, v: any) => {
      const key = name === 'dumb_thinking' || name === 'thinking' ? 'think' : name;
      if (typeof v === 'string') variants[key] = { base: path(v)!, detail: path(v.replace(/\.(jpg|png|webp)$/, '_detail.jpg')), mask: path(v.replace(/\.(jpg|png|webp)$/, '_mask.png')) };
      else if (v && typeof v === 'object') variants[key] = { base: path(v.base ?? v.file ?? v.image ?? `${r.id}_${name}.jpg`)!, detail: path(v.detail ?? `${r.id}_${name}_detail.jpg`), mask: path(v.mask ?? `${r.id}_${name}_mask.png`) };
      else variants[key] = { base: path(`${r.id}_${name}.jpg`)!, detail: path(`${r.id}_${name}_detail.jpg`), mask: path(`${r.id}_${name}_mask.png`) };
    };
    if (Array.isArray(vsrc)) for (const v of vsrc) addVar(typeof v === 'string' ? v : v.name ?? v.id, typeof v === 'string' ? null : v);
    else for (const [k, v] of Object.entries(vsrc)) addVar(k, v);
    const sex: Sex = r.sex === 'f' ? 'f' : 'm';
    const age = (['teen', 'young', 'middle', 'old'].includes(r.ageGroup ?? r.age) ? (r.ageGroup ?? r.age) : 'young') as FaceEntry['age'];
    const avg = r.avgSkinRGB ?? r.avgSkin ?? null;
    out.push({
      id: r.id, sex, age, roles: r.roles ?? [],
      name: r.name ? (typeof r.name === 'string' ? tl(r.name) : r.name) : tl(`หน้า${sex === 'f' ? 'ผู้หญิง' : 'ผู้ชาย'}${AGE_TH[age] ?? ''}`, `${sex === 'f' ? 'female' : 'male'} ${age} face`),
      photo: { base: path(baseFile)!, detail: path(detail), mask: path(mask), variants, avg: avg ? [avg[0], avg[1], avg[2]] : undefined, chinY: r.chinY },
    });
  }
  if (out.length) {
    FACES.list = [...out, ...PROC_FACES];
    FACES.photos = true;
  }
}

export function faceEntry(id: string | undefined, sex: Sex = 'm'): FaceEntry {
  const L = FACES.list;
  if (id) {
    const exact = L.find((f) => f.id === id);
    if (exact) return exact;
    // legacy short ids ('m01') → photo face with the same prefix, if any
    const pre = L.find((f) => f.photo && f.id.startsWith(id + '_'));
    if (pre) return pre;
  }
  const seedFace = PROC_FACES.find((f) => f.id === id);
  if (seedFace) return seedFace;
  // unknown → deterministic procedural face
  let h = 0;
  for (const c of id ?? 'x') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pool = PROC_FACES.filter((f) => f.sex === sex);
  return pool[h % pool.length];
}

// ------------------------------------------------------------------ catalogue

export function catalogue() {
  const ci = (x: { id: string; name: TL; price?: number; colors?: string[]; sex?: any }): CatalogItem => ({ id: x.id, name: x.name, price: x.price, colors: x.colors, sex: x.sex ?? 'u' });
  const faces = FACES.list.filter((f) => FACES.photos ? !!f.photo : true).map((f) => ({ id: f.id, name: f.name, price: 0, sex: f.sex } as CatalogItem));
  return {
    tops: TOPS.filter((t) => !t.hidden).map(ci),
    bottoms: BOTTOMS.filter((t) => !t.hidden).map(ci),
    shoes: SHOES.map(ci),
    acc: ACCS.filter((a) => !a.hidden).map(ci),
    hair: HAIRS.filter((h) => !h.hidden).map(ci),
    faces,
    skins: SKINS.slice(),
  };
}

// ------------------------------------------------------------------ player looks (album cover, ref4)

export function playerLook(slot: number): Look {
  const L: Look[] = [
    // G1 left: shaggy shoulder-length hair, white long-sleeve shirt with grey stripes, jeans, white sneakers
    { sex: 'm', height: 1.72, build: 0.32, skin: '#d8aa84', face: 'm01', hair: { style: 'shaggy', color: '#17120f' }, top: { id: 'shirt_stripe_white', color: '#ece9e2' }, bottom: { id: 'jeans', color: '#33415e' }, shoes: { id: 'sneakers', color: '#f2f1ee' }, acc: [] },
    // G2 standing: afro + white headband + amber sunglasses, green hawaiian shirt open over white tee, jeans
    { sex: 'm', height: 1.78, build: 0.4, skin: '#c28e69', face: 'm02', hair: { style: 'afro', color: '#16110d' }, top: { id: 'hawaiian_green', color: '#86c25e' }, bottom: { id: 'jeans', color: '#27324a' }, shoes: { id: 'sneakers', color: '#e9e7e2' }, acc: ['sunglasses', 'headband_white'] },
    // G3 back right: green-white striped polo, jeans
    { sex: 'm', height: 1.7, build: 0.5, skin: '#cd9c76', face: 'm03', hair: { style: 'short', color: '#16120f' }, top: { id: 'polo_stripe_green', color: '#4f9a62' }, bottom: { id: 'jeans', color: '#2f3d5a' }, shoes: { id: 'sneakers', color: '#ecebe6' }, acc: [] },
    // G4 front right: white button shirt (rolled sleeves), dark jeans, white sneakers, digital watch
    { sex: 'm', height: 1.75, build: 0.36, skin: '#e2b893', face: 'm04', hair: { style: 'spiky', color: '#1a1512' }, top: { id: 'shirt_white', color: '#f3f1ec' }, bottom: { id: 'jeans', color: '#222a3c' }, shoes: { id: 'sneakers', color: '#f4f4f2' }, acc: ['watch_casio'] },
  ];
  return JSON.parse(JSON.stringify(L[((slot % 4) + 4) % 4]));
}

// ------------------------------------------------------------------ archetypes

type Gen = (r: RNG) => Look;
const pick = <T>(r: RNG, a: readonly T[]) => a[Math.floor(r.next() * a.length)];
const chance = (r: RNG, p: number) => r.next() < p;
const range = (r: RNG, a: number, b: number) => a + (b - a) * r.next();

function pickFace(r: RNG, sex: Sex, ages: FaceEntry['age'][], roles: string[] = []): string {
  const L = FACES.list.filter((f) => f.sex === sex && (FACES.photos ? !!f.photo : true));
  let pool = L.filter((f) => roles.some((ro) => f.roles.includes(ro)));
  if (pool.length < 2) pool = L.filter((f) => ages.includes(f.age));
  if (!pool.length) pool = L.length ? L : PROC_FACES.filter((f) => f.sex === sex);
  return pick(r, pool).id;
}

const SKIN_FAIR = SKINS.slice(0, 5), SKIN_MID = SKINS.slice(2, 7), SKIN_TAN = SKINS.slice(4, 9);
const HAIR_BLACK = ['#141110', '#1c1511', '#2a1d16'];
const HAIR_DYED = ['#3b281c', '#4d3021', '#5c2c1c', '#8a6a44'];
const HAIR_OLD = ['#8f8b86', '#c8c4bd', '#6e6a66'];

function base(r: RNG, sex: Sex, o: Partial<Look> = {}): Look {
  const h = sex === 'm' ? range(r, 1.62, 1.8) : range(r, 1.5, 1.66);
  return {
    sex, height: +h.toFixed(3), build: +range(r, 0.25, 0.65).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, sex, ['young']),
    hair: { style: sex === 'm' ? 'short' : 'long', color: pick(r, HAIR_BLACK) },
    top: { id: 'tshirt', color: pick(r, BRIGHT) }, bottom: { id: 'cloth_shorts', color: pick(r, DULL) }, shoes: { id: 'flipflops', color: pick(r, ['#2f63b8', '#2f63b8', '#c8423a', '#1d1d1f']) }, acc: [], ...o,
  };
}

export const ARCHETYPES: Record<string, { name: TL; gen: Gen }> = {
  auntie_vendor: { name: tl('ป้าแม่ค้า', 'auntie vendor'), gen: (r) => base(r, 'f', {
    height: +range(r, 1.48, 1.6).toFixed(3), build: +range(r, 0.55, 0.95).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'f', ['middle', 'old'], ['market_auntie', 'vendor', 'cook']),
    hair: { style: pick(r, ['auntie_perm', 'auntie_perm', 'bun', 'short']), color: pick(r, [...HAIR_BLACK, ...HAIR_DYED]) },
    top: { id: 'auntie_blouse', color: pick(r, ['#b84a6a', '#3f6fb0', '#2d6a4a', '#7b4f9e', '#c8423a', '#d98a2a']) },
    bottom: { id: chance(r, 0.6) ? 'pha_thung' : 'slacks', color: pick(r, ['#5a3a2a', '#2a3a5a', '#3a5a3a', '#26272c']) },
    shoes: { id: pick(r, ['flipflops', 'slippers', 'sandals']), color: pick(r, ['#2f63b8', '#1d1d1f', '#5a3a22']) },
    acc: [...(chance(r, 0.7) ? ['apron'] : []), ...(chance(r, 0.25) ? ['face_mask'] : [])],
  }) },
  uncle_singlet: { name: tl('ลุงเสื้อกล้าม', 'uncle in a singlet'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.6, 1.74).toFixed(3), build: +range(r, 0.55, 1.0).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'm', ['middle', 'old'], ['uncle', 'vendor']),
    hair: { style: pick(r, ['short', 'buzz', 'bald', 'salt_pepper']), color: pick(r, [...HAIR_BLACK, '#8f8b86']) },
    top: { id: 'singlet_white', color: pick(r, ['#f1eee6', '#e8e2d2', '#ebe6da']) },
    bottom: { id: pick(r, ['boxer_plaid', 'pha_khao_ma', 'cloth_shorts', 'sarong_m']), color: pick(r, ['#3a5aa0', '#a03a3a', '#c8423a', '#a8956e', '#3a4a7a']) },
    shoes: { id: 'flipflops', color: '#2f63b8' }, acc: chance(r, 0.35) ? ['towel_neck'] : chance(r, 0.2) ? ['gold_chain'] : [],
  }) },
  office_worker_m: { name: tl('หนุ่มออฟฟิศ', 'office worker (m)'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.25, 0.6).toFixed(2), skin: pick(r, SKIN_FAIR), face: pickFace(r, 'm', ['young', 'middle'], ['office']),
    hair: { style: pick(r, ['side_part', 'short', 'side_part']), color: pick(r, HAIR_BLACK) },
    top: { id: 'dress_shirt', color: pick(r, ['#cfe0f1', '#f3f1ec', '#f2d9de', '#e2e2e2']) }, bottom: { id: 'slacks', color: pick(r, ['#26272c', '#3d4752', '#5a5650']) },
    shoes: { id: 'leather', color: '#1a1512' }, acc: [...(chance(r, 0.7) ? ['lanyard'] : []), ...(chance(r, 0.3) ? ['glasses'] : [])],
  }) },
  office_worker_f: { name: tl('สาวออฟฟิศ', 'office worker (f)'), gen: (r) => base(r, 'f', {
    build: +range(r, 0.2, 0.5).toFixed(2), skin: pick(r, SKIN_FAIR), face: pickFace(r, 'f', ['young', 'middle'], ['office']),
    hair: { style: pick(r, ['long', 'ponytail', 'bob', 'bun']), color: pick(r, [...HAIR_BLACK, '#3b281c', '#4d3021']) },
    top: { id: 'blouse_office', color: pick(r, ['#f3f1ec', '#f2d9de', '#cfe0f1', '#1d1d1f']) }, bottom: { id: chance(r, 0.6) ? 'skirt' : 'slacks', color: pick(r, ['#1d1d1f', '#3d4752', '#26272c']) },
    shoes: { id: 'leather', color: '#1a1512' }, acc: [...(chance(r, 0.7) ? ['lanyard'] : []), ...(chance(r, 0.25) ? ['glasses'] : []), ...(chance(r, 0.3) ? ['earrings'] : [])],
  }) },
  student_m: { name: tl('นักเรียนชาย', 'schoolboy'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.55, 1.74).toFixed(3), build: +range(r, 0.15, 0.55).toFixed(2), face: pickFace(r, 'm', ['teen', 'young'], ['student']),
    hair: { style: pick(r, ['school_cut', 'school_cut', 'buzz', 'bowl']), color: '#141110' },
    top: { id: 'school_shirt' }, bottom: { id: 'shorts_school', color: pick(r, ['#24305a', '#a8956e']) }, shoes: { id: 'school_shoes', color: pick(r, ['#1a1512', '#6a4a2a']) }, acc: chance(r, 0.15) ? ['backpack'] : [],
  }) },
  student_f: { name: tl('นักเรียนหญิง', 'schoolgirl'), gen: (r) => base(r, 'f', {
    height: +range(r, 1.48, 1.64).toFixed(3), build: +range(r, 0.15, 0.45).toFixed(2), face: pickFace(r, 'f', ['teen', 'young'], ['student']),
    hair: { style: pick(r, ['school_bob', 'school_bob', 'ponytail']), color: '#141110' },
    top: { id: 'school_blouse' }, bottom: { id: 'skirt_school', color: '#1f2a4a' }, shoes: { id: 'school_shoes', color: '#1a1512' }, acc: chance(r, 0.2) ? ['backpack'] : [],
  }) },
  moto_taxi: { name: tl('พี่วินมอเตอร์ไซค์', 'motorbike-taxi rider'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.3, 0.75).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'm', ['young', 'middle'], ['moto_taxi', 'driver']),
    hair: { style: pick(r, ['short', 'buzz', 'mullet']), color: pick(r, HAIR_BLACK) },
    top: { id: 'moto_vest', color: '#e8682a' }, bottom: { id: chance(r, 0.6) ? 'jeans' : 'slacks', color: pick(r, ['#2c3a58', '#26272c']) },
    shoes: { id: pick(r, ['sneakers', 'flipflops', 'sandals']), color: pick(r, ['#1d1d1f', '#2f63b8']) }, acc: [...(chance(r, 0.5) ? ['helmet'] : chance(r, 0.4) ? ['cap_black'] : []), ...(chance(r, 0.3) ? ['face_mask'] : [])],
  }) },
  delivery_rider: { name: tl('ไรเดอร์ส่งอาหาร', 'delivery rider'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.25, 0.6).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'm', ['young'], ['delivery', 'rider']),
    hair: { style: pick(r, ['short', 'side_part', 'mullet']), color: pick(r, HAIR_BLACK) },
    top: { id: 'rider_jacket', color: pick(r, ['#2f9a4a', '#e0457b', '#e8682a']) }, bottom: { id: 'jeans', color: pick(r, ['#2c3a58', '#1d2230']) },
    shoes: { id: 'sneakers', color: pick(r, ['#1d1d1f', '#f2f1ee']) }, acc: [...(chance(r, 0.6) ? ['helmet'] : []), ...(chance(r, 0.4) ? ['face_mask'] : [])],
  }) },
  construction_worker: { name: tl('คนงานก่อสร้าง', 'construction worker'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.2, 0.55).toFixed(2), skin: pick(r, SKIN_TAN.slice(1)), face: pickFace(r, 'm', ['young', 'middle'], ['construction']),
    hair: { style: pick(r, ['short', 'buzz']), color: '#141110' },
    top: { id: 'work_shirt', color: pick(r, ['#7a6f5f', '#5a6a7a', '#8a3a2a', '#4a5a3a']) }, bottom: { id: chance(r, 0.6) ? 'khakuay' : 'jeans', color: pick(r, ['#2a2a2e', '#3a4a6a', '#2c3a58']) },
    shoes: { id: pick(r, ['rubber_boots', 'flipflops', 'sneakers']), color: '#1d1d1f' }, acc: [...(chance(r, 0.6) ? ['straw_hat'] : ['cap_yellow']), ...(chance(r, 0.6) ? ['towel_neck'] : [])],
  }) },
  monk: { name: tl('พระสงฆ์', 'monk'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.2, 0.55).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'm', ['young', 'middle', 'old'], []),
    hair: { style: 'shaved', color: '#2a2420' }, top: { id: 'monk_robe', color: pick(r, ['#d9781f', '#c8641a', '#b85a1e']) }, bottom: { id: 'monk_robe_lower', color: '#c8641a' },
    shoes: { id: 'barefoot' }, acc: [],
  }) },
  police: { name: tl('ตำรวจ', 'police officer'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.35, 0.8).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'm', ['young', 'middle'], ['office']),
    hair: { style: 'school_cut', color: '#141110' }, top: { id: 'police_shirt' }, bottom: { id: 'slacks', color: '#5f4630' }, shoes: { id: 'leather', color: '#1a1512' },
    acc: [...(chance(r, 0.7) ? ['police_cap'] : []), ...(chance(r, 0.5) ? ['sunglasses'] : [])],
  }) },
  tourist_backpacker: { name: tl('นักท่องเที่ยวแบกเป้', 'backpacker tourist'), gen: (r) => {
    const sex: Sex = chance(r, 0.5) ? 'm' : 'f';
    return base(r, sex, {
      height: +(sex === 'm' ? range(r, 1.75, 1.92) : range(r, 1.62, 1.78)).toFixed(3), build: +range(r, 0.25, 0.7).toFixed(2), skin: pick(r, ['#f0d2bc', '#ecc9a8', '#e8c0a0', '#6b4a35']),
      face: pickFace(r, sex, ['young', 'middle'], ['tourist']), hair: { style: sex === 'm' ? pick(r, ['short', 'shaggy', 'bald']) : pick(r, ['ponytail', 'long', 'bun']), color: pick(r, ['#b08a52', '#c9a66b', '#6a4a2a', '#8a3a1a', '#2a1d16']) },
      top: { id: 'tank_elephant', color: pick(r, ['#2f5fa8', '#1d1d1f', '#c8423a', '#4f7d3c']) }, bottom: { id: chance(r, 0.6) ? 'elephant_pants' : 'cloth_shorts', color: pick(r, ['#2a4a8a', '#1d1d1f', '#8a2a3a', '#a8956e']) },
      shoes: { id: 'sandals', color: '#5a3a22' }, acc: ['backpack', ...(chance(r, 0.5) ? ['bucket_hat'] : []), ...(chance(r, 0.5) ? ['sunglasses'] : [])],
    });
  } },
  old_lady: { name: tl('ยายแก่', 'old lady'), gen: (r) => base(r, 'f', {
    height: +range(r, 1.42, 1.54).toFixed(3), build: +range(r, 0.15, 0.6).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'f', ['old'], ['grandma', 'garland_seller']),
    hair: { style: pick(r, ['bun', 'auntie_perm', 'short']), color: pick(r, HAIR_OLD) },
    top: { id: 'auntie_blouse', color: pick(r, ['#7b4f9e', '#3f6fb0', '#b84a6a', '#5a6a4a']) }, bottom: { id: 'pha_thung', color: pick(r, ['#5a3a2a', '#2a3a5a', '#3a5a3a']) },
    shoes: { id: pick(r, ['flipflops', 'slippers']), color: pick(r, ['#2f63b8', '#1d1d1f']) }, acc: [],
  }) },
  grandpa: { name: tl('คุณตา', 'grandpa'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.55, 1.68).toFixed(3), build: +range(r, 0.1, 0.5).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'm', ['old'], ['uncle', 'cart_old_man']),
    hair: { style: pick(r, ['salt_pepper', 'bald', 'buzz']), color: pick(r, HAIR_OLD) },
    top: { id: pick(r, ['singlet_white', 'dress_shirt', 'polo']), color: pick(r, ['#f1eee6', '#e2e2e2', '#8a8f96', '#a39883']) }, bottom: { id: pick(r, ['slacks', 'pha_khao_ma', 'sarong_m']), color: pick(r, ['#5a5650', '#c8423a', '#3a4a7a']) },
    shoes: { id: 'sandals', color: '#5a3a22' }, acc: chance(r, 0.4) ? ['glasses'] : [],
  }) },
  housewife: { name: tl('แม่บ้าน', 'housewife'), gen: (r) => base(r, 'f', {
    build: +range(r, 0.35, 0.8).toFixed(2), face: pickFace(r, 'f', ['young', 'middle'], ['vendor', 'shopkeeper']),
    hair: { style: pick(r, ['ponytail', 'bun', 'bob', 'long']), color: pick(r, [...HAIR_BLACK, ...HAIR_DYED]) },
    top: { id: pick(r, ['house_dress', 'tshirt']), color: pick(r, ['#6d8fbf', '#c46a7a', '#7fae7a', '#d6b25a', '#e8a33d']) }, bottom: { id: pick(r, ['pha_thung', 'cloth_shorts', 'skirt']), color: pick(r, ['#5a3a2a', '#3d4752', '#2a3a5a']) },
    shoes: { id: 'slippers', color: pick(r, ['#1d1d1f', '#c8423a', '#2f5fa8']) }, acc: chance(r, 0.4) ? ['apron'] : [],
  }) },
  teen_gamer: { name: tl('เด็กติดเกม', 'teen gamer'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.58, 1.76).toFixed(3), build: +range(r, 0.1, 0.9).toFixed(2), skin: pick(r, SKIN_FAIR), face: pickFace(r, 'm', ['teen', 'young'], ['student']),
    hair: { style: pick(r, ['bowl', 'shaggy', 'spiky']), color: pick(r, [...HAIR_BLACK, '#4d3021']) },
    top: { id: 'gamer_tee', color: pick(r, ['#1d1d1f', '#2a2a40', '#3a1d3f']) }, bottom: { id: 'basketball_shorts', color: pick(r, ['#1d1d1f', '#1d3a8a']) },
    shoes: { id: 'slippers', color: '#1d1d1f' }, acc: [...(chance(r, 0.5) ? ['glasses'] : []), ...(chance(r, 0.4) ? ['cap_back_black'] : [])],
  }) },
  gangster_lite: { name: tl('เด็กแว้นสายเก๋า', 'wannabe gangster'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.1, 0.45).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'm', ['teen', 'young'], ['rider', 'construction']),
    hair: { style: pick(r, ['mullet', 'mullet', 'spiky']), color: pick(r, ['#8a6a44', '#b08a52', '#141110', '#5c2c1c']) },
    top: { id: pick(r, ['tshirt_print', 'singlet_white']), color: '#1d1d1f' }, bottom: { id: 'jeans', color: pick(r, ['#1d2230', '#2c3a58']) },
    shoes: { id: pick(r, ['sneakers', 'slippers']), color: pick(r, ['#1d1d1f', '#f2f1ee']) }, acc: ['gold_chain', ...(chance(r, 0.5) ? ['sunglasses'] : [])],
  }) },
  temple_lady: { name: tl('ป้าไปทำบุญ', 'temple-going lady'), gen: (r) => base(r, 'f', {
    height: +range(r, 1.48, 1.6).toFixed(3), build: +range(r, 0.3, 0.75).toFixed(2), face: pickFace(r, 'f', ['middle', 'old'], ['grandma', 'market_auntie']),
    hair: { style: pick(r, ['bun', 'auntie_perm']), color: pick(r, [...HAIR_BLACK, ...HAIR_OLD]) },
    top: { id: 'temple_white' }, bottom: { id: 'pha_thung', color: '#f2f0e8' }, shoes: { id: 'sandals', color: '#5a3a22' }, acc: ['sash'],
  }) },
  street_sweeper: { name: tl('พนักงานกวาดถนน', 'street sweeper'), gen: (r) => {
    const sex: Sex = chance(r, 0.6) ? 'f' : 'm';
    return base(r, sex, {
      build: +range(r, 0.3, 0.7).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, sex, ['middle', 'old'], ['market_auntie', 'construction']),
      hair: { style: sex === 'f' ? 'bun' : 'short', color: pick(r, HAIR_BLACK) },
      top: { id: 'sweeper_uniform' }, bottom: { id: 'slacks', color: '#e86a1e' }, shoes: { id: 'rubber_boots', color: '#1d1d1f' }, acc: ['straw_hat', 'face_mask'],
    });
  } },
  security_guard: { name: tl('ยาม รปภ.', 'security guard'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.6, 1.75).toFixed(3), build: +range(r, 0.3, 0.85).toFixed(2), skin: pick(r, SKIN_TAN), face: pickFace(r, 'm', ['middle', 'old'], ['uncle', 'shopkeeper']),
    hair: { style: pick(r, ['school_cut', 'buzz', 'salt_pepper']), color: pick(r, [...HAIR_BLACK, '#8f8b86']) },
    top: { id: 'security_shirt', color: '#2a3550' }, bottom: { id: 'slacks', color: '#26272c' }, shoes: { id: 'leather', color: '#1a1512' }, acc: chance(r, 0.6) ? ['police_cap'] : [],
  }) },
  karaoke_uncle: { name: tl('ลุงสายคาราโอเกะ', 'karaoke uncle'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.6, 1.74).toFixed(3), build: +range(r, 0.55, 0.95).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'm', ['middle', 'old'], ['uncle', 'boss']),
    hair: { style: pick(r, ['side_part', 'salt_pepper', 'bald']), color: pick(r, [...HAIR_BLACK, '#8f8b86']) },
    top: { id: 'shirt_satin', color: pick(r, ['#5b2a86', '#b8923a', '#a8202e']) }, bottom: { id: 'slacks', color: '#1d1d1f' }, shoes: { id: 'leather', color: '#1a1512' },
    acc: ['gold_chain', ...(chance(r, 0.5) ? ['sunglasses'] : []), ...(chance(r, 0.5) ? ['watch_casio'] : [])],
  }) },
  sexy_girl_who_screams: { name: tl('สาวน้อยกรี๊ดแตก', 'the girl who screams'), gen: (r) => base(r, 'f', {
    height: +range(r, 1.55, 1.65).toFixed(3), build: 0.28, skin: pick(r, SKIN_FAIR), face: pickFace(r, 'f', ['young'], ['screaming_girl']),
    hair: { style: pick(r, ['long', 'ponytail']), color: pick(r, ['#2a1d16', '#3b281c', '#141110']) },
    top: { id: 'blouse_cute', color: pick(r, PASTEL) }, bottom: { id: chance(r, 0.5) ? 'skirt' : 'denim_shorts', color: pick(r, ['#e9e6df', '#6f8fb8', '#1d1d1f']) },
    shoes: { id: 'sneakers', color: '#f2f1ee' }, acc: chance(r, 0.4) ? ['earrings'] : [],
  }) },
  old_man_cart_owner: { name: tl('ลุงเจ้าของรถเข็น', 'the old cart man'), gen: (r) => base(r, 'm', {
    height: 1.6, build: 0.1, skin: '#a67250', face: pickFace(r, 'm', ['old'], ['cart_old_man']),
    hair: { style: 'salt_pepper', color: '#9a968f' }, top: { id: 'singlet_white', color: '#ebe6d6' }, bottom: { id: 'sarong_m', color: '#3a4a7a' },
    shoes: { id: 'flipflops', color: '#2f63b8' }, acc: ['towel_neck'],
  }) },
  homeless_man: { name: tl('ลุงคนไร้บ้าน', 'homeless man'), gen: (r) => base(r, 'm', {
    height: +range(r, 1.6, 1.72).toFixed(3), build: 0.08, skin: '#8a5a3c', face: pickFace(r, 'm', ['old', 'middle'], ['homeless']),
    hair: { style: pick(r, ['shaggy', 'long']), color: pick(r, ['#3a332c', '#6e6a66']) }, top: { id: 'tshirt_ragged', color: pick(r, ['#8a8270', '#6b6a5e', '#7d5a4a']) }, bottom: { id: 'cloth_shorts', color: '#5a5040' },
    shoes: { id: 'barefoot' }, acc: chance(r, 0.6) ? ['towel_neck'] : [],
  }) },
  vendor_cook: { name: tl('พ่อค้าอาหารตามสั่ง', 'made-to-order cook'), gen: (r) => base(r, 'm', {
    build: +range(r, 0.4, 0.9).toFixed(2), skin: pick(r, SKIN_MID), face: pickFace(r, 'm', ['middle'], ['vendor', 'shopkeeper']),
    hair: { style: pick(r, ['short', 'buzz']), color: '#141110' }, top: { id: pick(r, ['singlet_white', 'tshirt', 'polo']), color: pick(r, ['#f1eee6', '#1d1d1f', '#5b6b7a']) },
    bottom: { id: pick(r, ['cloth_shorts', 'slacks']), color: pick(r, DULL) }, shoes: { id: pick(r, ['flipflops', 'rubber_boots']), color: '#1d1d1f' }, acc: ['apron', ...(chance(r, 0.5) ? ['towel_neck'] : [])],
  }) },
  shop_girl: { name: tl('พนักงานร้านสะดวกซื้อ', 'convenience store clerk'), gen: (r) => base(r, chance(r, 0.6) ? 'f' : 'm', {
    face: pickFace(r, 'f', ['young'], ['shop_staff', 'office']), hair: { style: pick(r, ['ponytail', 'bun', 'short']), color: '#1c1511' },
    top: { id: 'polo', color: pick(r, ['#2f7a4a', '#c8423a']) }, bottom: { id: 'slacks', color: '#1d1d1f' }, shoes: { id: 'sneakers', color: '#1d1d1f' }, acc: ['lanyard'],
  }) },
};

/** Common pool for generic customers / crowds (weights). */
const COMMON: [string, number][] = [
  ['office_worker_m', 8], ['office_worker_f', 8], ['student_m', 6], ['student_f', 6], ['uncle_singlet', 7], ['auntie_vendor', 4], ['housewife', 6],
  ['moto_taxi', 4], ['delivery_rider', 5], ['construction_worker', 5], ['teen_gamer', 4], ['gangster_lite', 3], ['grandpa', 3], ['old_lady', 3],
  ['tourist_backpacker', 3], ['karaoke_uncle', 2], ['security_guard', 2], ['temple_lady', 2], ['street_sweeper', 1], ['shop_girl', 2],
];

export function resolveArchetype(a: string | undefined, r: RNG): string {
  if (a && ARCHETYPES[a]) return a;
  const s = (a ?? '').toLowerCase();
  const rules: [RegExp, string | string[]][] = [
    [/old.?man|cart_owner|oldman/, 'old_man_cart_owner'], [/homeless/, 'homeless_man'], [/monk|phra/, 'monk'], [/police|cop/, 'police'],
    [/auntie|market|vendor_f|garland/, 'auntie_vendor'], [/butcher|cook|vendor/, 'vendor_cook'], [/office/, ['office_worker_m', 'office_worker_f']],
    [/student|school/, ['student_m', 'student_f']], [/moto|win/, 'moto_taxi'], [/rider|deliver/, 'delivery_rider'], [/construct|worker|labour/, 'construction_worker'],
    [/tourist|farang|backpack/, 'tourist_backpacker'], [/grandma|old_lady|yai/, 'old_lady'], [/grandpa|ta\b/, 'grandpa'], [/house|mom/, 'housewife'],
    [/gamer|teen/, 'teen_gamer'], [/gang|waen/, 'gangster_lite'], [/temple|merit/, 'temple_lady'], [/sweep|clean/, 'street_sweeper'], [/guard|security|yam/, 'security_guard'],
    [/karaoke|uncle_rich|boss/, 'karaoke_uncle'], [/scream|girl/, 'sexy_girl_who_screams'], [/uncle|lung/, 'uncle_singlet'], [/clerk|shop/, 'shop_girl'],
  ];
  for (const [re, v] of rules) if (re.test(s)) return Array.isArray(v) ? pick(r, v) : v;
  // generic customer / unknown → weighted common pool
  return r.weighted(COMMON.map((c) => c[0]), COMMON.map((c) => c[1]));
}

export function randomLook(archetype?: string, seed?: number): Look {
  const r = new RNG(seed === undefined ? (Math.random() * 2 ** 31) | 0 : (Math.abs(Math.floor(seed)) * 2654435761 + 12345) >>> 0 || 1);
  const id = resolveArchetype(archetype, r);
  const look = ARCHETYPES[id].gen(r);
  (look as any).arch = id;
  return look;
}

export function archetypeIds() { return Object.keys(ARCHETYPES); }
