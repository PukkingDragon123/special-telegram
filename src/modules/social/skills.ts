import type { Ent } from '../../sim/state';
import { TL, tl } from '../../core/util';

/* ============================================================================================
 * SKILL TREE DATA — four branches (cook / prep / serve / clean) + three "life" roots.
 *
 * Speed skills follow the core convention: an id starting with `<action>_fast` adds +25 % to
 * game.skillMul(pl, '<action>') (stir, chop, pound, whisk, scoop, wash, serve, clean, carry).
 * Everything else is a flag other modules test with game.hasSkill(pl, id).
 * ========================================================================================== */

export type Branch = 'cook' | 'prep' | 'serve' | 'clean' | 'life';
export const BRANCHES: Exclude<Branch, 'life'>[] = ['cook', 'prep', 'serve', 'clean'];

export const BRANCH_NAME: Record<Branch, TL> = {
  cook: tl('ทำอาหาร', 'cooking'),
  prep: tl('เตรียมของ', 'prep'),
  serve: tl('เสิร์ฟ', 'serving'),
  clean: tl('ล้าง-เก็บ', 'cleaning'),
  life: tl('ชีวิต', 'life'),
};

export interface SkillDef {
  id: string;
  branch: Branch;
  /** position along the branch 0..4 (life: 0..2) */
  tier: number;
  cost: number;
  /** parent skill id that must be unlocked first */
  req: string | null;
  /** minimum branch level (life: minimum TOTAL level) */
  minLv: number;
  name: TL;
  desc: TL;
  /** item kinds whose real model floats in the Skill Heaven (first one that exists wins; '__coin10' / '__slapwok' are composites) */
  icon: string[];
}

const S = (id: string, branch: Branch, tier: number, cost: number, req: string | null, minLv: number, name: TL, desc: TL, icon: string[]): SkillDef =>
  ({ id, branch, tier, cost, req, minLv, name, desc, icon });

export const SKILLS: SkillDef[] = [
  // ---------------------------------------------------------------- cook
  S('stir_fast', 'cook', 0, 1, null, 1, tl('ตะหลิวสายฟ้า', 'Lightning Spatula'),
    tl('ผัดเร็วขึ้น 25% ตะหลิวไวจนเห็นแต่เงา', 'Stir 25% faster. The spatula is just a blur.'), ['spatula']),
  S('taste_preview', 'cook', 1, 1, 'stir_fast', 2, tl('ลิ้นเทวดา', "Angel's Tongue"),
    tl('ชิมด้วยใจ เห็นรสเค็ม เผ็ด หวาน ลอยอยู่เหนือกระทะ', 'See salty / spicy / sweet hints floating over your wok.'), ['spoon_fork', 'ladle']),
  S('stir_fast2', 'cook', 2, 2, 'taste_preview', 3, tl('แขนเหล็กเจ้าพ่อกระทะ', 'Iron Arm of the Wok Godfather'),
    tl('ผัดเร็วขึ้นอีก 25% แขนขวาใหญ่กว่าแขนซ้ายแล้ว', '+25% stir speed. Your right arm is now bigger than your left.'), ['wok']),
  S('burn_slow', 'cook', 3, 2, 'stir_fast2', 4, tl('กระทะร้อน ใจเย็น', 'Hot Wok, Cool Heart'),
    tl('ของไหม้ช้าลง แอบเช็คไลน์ได้แป๊บนึง', 'Food burns slower. You can check your phone for a sec.'), ['gas_tank', 'chili']),
  S('egg_master', 'cook', 4, 3, 'burn_slow', 5, tl('ไข่ดาวไม่แตก แม้ใจจะแตก', 'Unbroken Egg, Broken Heart'),
    tl('ไข่ดาวเยิ้มง่ายขึ้น ช่วงทองของไข่นานขึ้น', 'A much wider window for the perfect runny fried egg.'), ['egg_tray', 'egg']),
  // ---------------------------------------------------------------- prep
  S('chop_fast', 'prep', 0, 1, null, 1, tl('มือไวกว่าแม่ค้าออนไลน์', "Faster Than an Online Seller's CF"),
    tl('หั่นเร็วขึ้น 25% ลูกค้ากดซีเอฟยังไม่ทัน', 'Chop 25% faster than anyone can type "CF".'), ['cleaver']),
  S('pound_fast', 'prep', 1, 1, 'chop_fast', 2, tl('ครกสะเทือนซอย', 'The Mortar That Shakes the Soi'),
    tl('ตำเร็วขึ้น 25% บ้านข้างๆ นึกว่าแผ่นดินไหว', 'Pound 25% faster. The neighbours think it\'s an earthquake.'), ['mortar']),
  S('chop_fast2', 'prep', 2, 2, 'pound_fast', 3, tl('ซามูไรหมูสับ', 'Minced-Pork Samurai'),
    tl('หั่นเร็วขึ้นอีก 25% นิ้วยังครบ... มั้ง', '+25% chopping. All fingers still attached... probably.'), ['chopping_board']),
  S('whisk_fast', 'prep', 3, 2, 'chop_fast2', 4, tl('ตีไข่ฟูจนลอยได้', 'Eggs So Fluffy They Float'),
    tl('ตีไข่เร็วขึ้น 25% ไข่เจียวฟูเหมือนเมฆ', 'Whisk 25% faster. Omelettes as fluffy as clouds.'), ['bowl', 'egg']),
  S('carry_fast', 'prep', 4, 3, 'whisk_fast', 5, tl('หลังเหล็กสายแบก', 'Iron Back, Pro Carrier'),
    tl('แบกของหนักแล้วช้าลงน้อยลงมาก ถังแก๊สก็เหมือนถุงขนม', 'Much less slowdown when carrying. A gas tank feels like a bag of chips.'), ['gas_tank', 'rice_bag']),
  // ---------------------------------------------------------------- serve
  S('serve_fast', 'serve', 0, 1, null, 1, tl('เดินเสิร์ฟสายลม', 'Serving Like the Wind'),
    tl('เสิร์ฟเร็วขึ้น 25% ลูกค้าได้กินก่อนจะหิว', 'Serve 25% faster. Customers eat before they get hungry.'), ['plate']),
  S('patience', 'serve', 1, 1, 'serve_fast', 2, tl('ยิ้มสยาม', 'The Siamese Smile'),
    tl('ลูกค้ารอได้นานขึ้น เพราะยิ้มหวานกว่าน้ำตาลทราย', 'Customers wait longer — your smile is sweeter than sugar.'), ['sugar']),
  S('tips_big', 'serve', 2, 2, 'patience', 3, tl('ปากหวานเรียกทิป', 'Sweet-Talk Tips'),
    tl('ได้ทิปเยอะขึ้น แค่พูดว่า "ขอบคุณครับพี่"', 'Bigger tips. All it takes is "thank you, boss!"'), ['__coin10']),
  S('serve_fast2', 'serve', 3, 2, 'tips_big', 4, tl('สามจานบนแขนเดียว', 'Three Plates, One Arm'),
    tl('เสิร์ฟเร็วขึ้นอีก 25% แขนเดียวถือได้สามจาน', '+25% serving. Three plates balanced on one arm.'), ['takeaway_box', 'bowl']),
  S('haggle', 'serve', 4, 3, 'serve_fast2', 5, tl('ต่อราคาจนแม่ค้าร้องไห้', 'Haggle Till Auntie Cries'),
    tl('ต่อราคาที่ร้านค้าได้ถูกลง แม่ค้ายอมเพราะสงสาร', 'Better bargains at the shops — out of pure pity.'), ['shopping_basket', 'plastic_bag']),
  // ---------------------------------------------------------------- clean
  S('wash_fast', 'clean', 0, 1, null, 1, tl('ล้างจานด้วยใจ', 'Washing Dishes With Heart'),
    tl('ล้างจานเร็วขึ้น 25% ใจก็สะอาดไปด้วย', 'Wash 25% faster. Your heart gets cleaner too.'), ['sponge', 'bowl']),
  S('clean_fast', 'clean', 1, 1, 'wash_fast', 2, tl('ผ้าขี้ริ้วพลังจิต', 'The Psychic Rag'),
    tl('เช็ดโต๊ะ เก็บจาน เร็วขึ้น 25%', 'Wipe tables and clear dishes 25% faster.'), ['rag', 'tissue_box', 'trash_bag']),
  S('wash_fast2', 'clean', 2, 2, 'clean_fast', 3, tl('ล้างไวจนจานงง', 'So Fast the Plates Get Confused'),
    tl('ล้างจานเร็วขึ้นอีก 25%', '+25% washing speed.'), ['dish_rack', 'plate']),
  S('no_break', 'clean', 3, 2, 'wash_fast2', 4, tl('จานไม่แตก แม้ใจแตก', "Plates Don't Break (Hearts Do)"),
    tl('ทำจานหล่นแล้วไม่แตก', 'Dropped plates and glasses never break.'), ['plate', 'bowl']),
  S('clean_fast2', 'clean', 4, 3, 'no_break', 5, tl('ร้านสะอาดจนแมลงวันย้ายบ้าน', 'So Clean the Flies Moved Out'),
    tl('เก็บกวาดเร็วขึ้นอีก 25%', '+25% cleaning speed.'), ['trash_bag', 'sponge']),
  // ---------------------------------------------------------------- life (roots on the trunk)
  S('iron_cheek', 'life', 0, 1, null, 6, tl('แก้มหนาทนตบ', 'Slap-Proof Cheeks'),
    tl('โดนตบแล้วของไม่หล่น แถมคนตบเจ็บมือเอง', 'Slaps never make you drop things — and the slapper hurts their hand.'), ['__slapwok']),
  S('tug_strong', 'life', 1, 1, null, 8, tl('แรงช้างสาร', 'Strength of a Bull Elephant'),
    tl('ชักเย่อแย่งของ ทุกคลิกแรงขึ้น 30%', 'Every click in a snatch tug-of-war counts 30% more.'), ['rice_bag', 'gas_tank']),
  S('sleep_well', 'life', 2, 2, null, 12, tl('หลับบนลังเหมือนโรงแรมห้าดาว', 'Five-Star Cardboard Sleeper'),
    tl('ตื่นมาสดชื่น ได้บัฟขยันทุกเช้า', 'Wake up refreshed with a morning hustle buff.'), ['cardboard']),
];

export const SKILL = new Map(SKILLS.map((s) => [s.id, s]));

/** Exported list for other modules / docs. */
export const SKILL_IDS = SKILLS.map((s) => s.id);

// ------------------------------------------------------------------ levels

export type XpSkill = 'cook' | 'prep' | 'serve' | 'clean';
export const MAX_LV = 15;
/** XP scale per skill (cook dishes give 6-40 xp, a chop gives ~4). */
const SCALE: Record<XpSkill, number> = { cook: 1.4, prep: 0.6, serve: 0.8, clean: 0.6 };

/** cumulative XP needed to REACH level `lv` (lv 1 = 0) */
export function xpFor(skill: XpSkill, lv: number) {
  const n = Math.max(0, lv - 1);
  return Math.round(SCALE[skill] * 25 * n * (n + 1) / 2);
}
export function levelOf(skill: XpSkill, xp: number) {
  let lv = 1;
  while (lv < MAX_LV && xp >= xpFor(skill, lv + 1)) lv++;
  return lv;
}
export function lvProgress(skill: XpSkill, xp: number) {
  const lv = levelOf(skill, xp);
  if (lv >= MAX_LV) return { lv, cur: 1, need: 1, k: 1 };
  const a = xpFor(skill, lv), b = xpFor(skill, lv + 1);
  return { lv, cur: Math.round(xp - a), need: b - a, k: (xp - a) / (b - a) };
}
export function levels(pl: Ent | undefined | null): Record<XpSkill, number> {
  const xp = pl?.xp ?? {};
  return { cook: levelOf('cook', xp.cook ?? 0), prep: levelOf('prep', xp.prep ?? 0), serve: levelOf('serve', xp.serve ?? 0), clean: levelOf('clean', xp.clean ?? 0) };
}
export function totalLevel(pl: Ent | undefined | null) {
  const l = levels(pl);
  return l.cook + l.prep + l.serve + l.clean;
}

export type SkillState = 'owned' | 'ready' | 'poor' | 'locked';
/** Can this player unlock it now? Returns a state + reason. */
export function skillState(pl: Ent | undefined | null, s: SkillDef): { st: SkillState; why?: TL } {
  const owned: string[] = pl?.skills ?? [];
  if (owned.includes(s.id)) return { st: 'owned' };
  if (s.req && !owned.includes(s.req)) return { st: 'locked', why: tl(`ต้องปลด "${SKILL.get(s.req)?.name.th}" ก่อน`, `needs "${SKILL.get(s.req)?.name.en}" first`) };
  if (s.branch === 'life') {
    const t = totalLevel(pl);
    if (t < s.minLv) return { st: 'locked', why: tl(`เลเวลรวมต้องถึง ${s.minLv} (ตอนนี้ ${t})`, `total level ${s.minLv} needed`) };
  } else {
    const lv = levels(pl)[s.branch as XpSkill];
    if (lv < s.minLv) return { st: 'locked', why: tl(`${BRANCH_NAME[s.branch].th} ต้องเลเวล ${s.minLv}`, `${BRANCH_NAME[s.branch].en} level ${s.minLv} needed`) };
  }
  if ((pl?.sp ?? 0) < s.cost) return { st: 'poor', why: tl(`แต้มไม่พอ (ต้องใช้ ${s.cost})`, `not enough points (${s.cost})`) };
  return { st: 'ready' };
}
