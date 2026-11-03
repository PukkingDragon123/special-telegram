import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl } from '../../core/util';
import { Dialogues, type DlgOption } from '../quests/api';

/* =============================================================================================
 * บ่าวคลาร์ค (Bao Clark) — the furniture store's salesman. An ORIGINAL character: calm, deadpan, polite to a
 * fault, never blinks at anything strange. Neat and utilitarian (khaki work shirt, dark slacks, staff lanyard).
 * Everything he says suggests the back of his shop is much bigger than a shophouse should be (the "STAFF ONLY"
 * door behind his counter leads to the backrooms module).
 * Dialogue goes through the shared quests contract (priority 30: beats generic shopkeeper chit-chat).
 * ============================================================================================= */

export const CLARK_ROLE = 'shopkeeper:furniture_store';

/** HOST: give the keeper his tidy work look (the shops module spawns him from the archetype + seed) */
export function dressClark(game: Game, keeper: Ent | null) {
  if (!keeper || !game.isHost) return;
  const base = keeper.look ?? game.chars?.randomLook?.('office_worker_m', 2404);
  if (!base) return;
  keeper.look = {
    ...base,
    height: 1.78,
    build: 0.38,
    hair: { style: 'side_part', color: '#1d1a18' },
    top: { id: 'dress_shirt', color: '#c9bc94' },
    bottom: { id: 'slacks', color: '#2b2d30' },
    shoes: { id: 'leather', color: '#17130f' },
    acc: ['lanyard'],
  };
  keeper.face = 'neutral';
}

const menu = (): DlgOption[] => [
  { text: tl('มีอะไรแนะนำบ้าง?', 'any recommendations?'), next: 'rec' },
  { text: tl('หลังร้านมีอะไร?', "what's in the back?"), next: 'back1' },
  { text: tl('จัดร้านยังไง?', 'how do I arrange furniture?'), next: 'howto' },
  { text: tl('ของใหญ่ส่งไหม?', 'do you deliver?'), next: 'deliver' },
  { text: tl('ไปก่อนนะ', 'see you'), next: 'bye' },
];

export function registerClarkDialogue() {
  Dialogues.register({
    id: 'bao_clark',
    priority: 30,
    voice: 0.8,
    match: (t) => t.role === CLARK_ROLE,
    start: (c) => {
      const seen = (c.game.g as any).clarkMet?.[c.me.id];
      return seen ? 'hi2' : 'hi';
    },
    barks: [
      tl('ยินดีต้อนรับครับ', 'Welcome.'),
      tl('เดินดูตามสบายครับ อย่าเดินลึกเกินไปนะครับ', 'Browse freely. Not too deep.'),
      tl('ทุกอย่างในร้านลดราคาครับ… ยกเว้นทางออก', 'Everything is on sale… except the exit.'),
      tl('ไฟกะพริบนิดหน่อยครับ ปกติครับ', 'The lights flicker a little. Normal.'),
      tl('หลังร้านมีของอีกเยอะครับ… เยอะมาก', 'There is more in the back… much more.'),
    ],
    nodes: [
      { id: 'hi', say: tl('สวัสดีครับ ยินดีต้อนรับสู่เจริญพาณิชย์เฟอร์นิเจอร์ ผมชื่อบ่าวคลาร์คครับ', "Hello. Welcome to Charoen Panich Furniture. I'm Bao Clark."), face: 'neutral',
        do: (c) => { const g: any = c.game.g; if (c.game.isHost) g.clarkMet = { ...(g.clarkMet ?? {}), [c.me.id]: true }; else c.game.intent('build.clarkMet', {}); },
        options: menu() },
      { id: 'hi2', say: tl('กลับมาแล้วเหรอครับ ดีครับ… หลายคนไม่กลับมา', 'You came back. Good… many do not.'), face: 'neutral', options: menu() },
      { id: 'menu', say: tl('มีอะไรให้ช่วยอีกไหมครับ', 'Anything else I can help with?'), options: menu() },
      // ---- recommendations
      { id: 'rec', say: tl('โต๊ะสแตนเลสครับ ล้างง่าย ทนทาน ยังไม่มีใครเอามาคืน… ไม่มีใครกลับมาคืนเลยครับ', 'The stainless table. Easy to clean, durable. Nobody ever returned one… nobody ever came back.'),
        options: [{ text: tl('แล้วพัดลมล่ะ?', 'and the fans?'), next: 'fan' }, { text: tl('แมวกวักตัวนั้นล่ะ?', 'that lucky cat?'), next: 'cat' }, { text: tl('โอเค', 'okay'), next: 'menu' }] },
      { id: 'fan', say: tl('พัดลมเพดานครับ ลูกค้านั่งนานขึ้น อากาศเย็นลง เสียงหึ่งๆ ช่วยให้ไม่ได้ยินเสียงอื่นครับ', 'Ceiling fans. Customers stay longer, it is cooler, and the hum covers the other sounds.'),
        options: [{ text: tl('เสียงอื่นอะไร?', 'what other sounds?'), next: 'sounds' }, { text: tl('กลับ', 'back'), next: 'menu' }] },
      { id: 'sounds', say: tl('เสียงอื่นครับ', 'The other ones.'), face: 'neutral', next: 'menu' },
      { id: 'cat', say: tl('แมวกวักกวักเงินเข้าร้านครับ ตัวนี้กวักทั้งคืน ผมไม่เคยเปิดสวิตช์ให้มันครับ', 'The lucky cat beckons money in. This one beckons all night. I never switched it on.'), next: 'menu' },
      // ---- the back of the shop (backrooms tease; the door itself is the backrooms module's)
      { id: 'back1', say: tl('หลังร้านมีของอีกเยอะครับ… เยอะมาก', 'There is a lot more stock in the back… a lot.'), face: 'neutral', next: 'back2' },
      { id: 'back2', say: tl('เดินเข้าไปแล้วอย่าลืมทางกลับนะครับ', "If you go in, don't forget the way back."),
        options: [{ text: tl('นายเคยเข้าไปไหม?', 'have you been in?'), next: 'back3' }, { text: tl('ขอเข้าไปดูได้ไหม?', 'can I take a look?'), next: 'back5' }, { text: tl('ช่างมันเถอะ', 'never mind'), next: 'menu' }] },
      { id: 'back3', say: tl('ผมเคยเดินไปสุดทางครั้งนึง… ไม่มีสุดทางครับ', 'I walked to the end once… there is no end.'), face: 'neutral',
        options: [{ text: tl('แล้วออกมาได้ยังไง?', 'how did you get out?'), next: 'back4' }, { text: tl('ขนลุกเลย…', 'that is creepy…'), next: 'back6' }] },
      { id: 'back4', say: tl('ผมยังไม่แน่ใจว่าออกมาแล้วครับ', "I'm still not sure I did."), face: 'neutral', next: 'menu' },
      { id: 'back5', say: tl('ประตูอยู่ข้างหลังผมครับ ป้าย STAFF ONLY ไม่ได้ห้ามใครหรอกครับ มันแค่เตือน', 'The door is behind me. The STAFF ONLY plate does not forbid anything. It only warns.'),
        options: [{ text: tl('เข้าใจแล้ว', 'understood'), end: true }, { text: tl('มีแผนที่ไหม?', 'is there a map?'), next: 'map' }] },
      { id: 'map', say: tl('เคยมีครับ แผนที่ยาวขึ้นทุกครั้งที่กางครับ', 'There was. It got longer every time I unfolded it.'), next: 'menu' },
      { id: 'back6', say: tl('ไม่ต้องกลัวครับ ร้านเราปลอดภัย ส่วนที่ไม่ปลอดภัยไม่ใช่ร้านเราครับ', 'No need to worry. The shop is safe. The unsafe part is not the shop.'), next: 'menu' },
      // ---- practical help
      { id: 'howto', say: tl('ถือเฟอร์นิเจอร์แล้วเล็งที่พื้นครับ เขียวคือวางได้ แดงคือไม่ได้ คลิกเพื่อวาง R หมุน กด B จัดร้าน คลิกค้างที่ของเพื่อลากย้าย X ขายคืนครึ่งราคาครับ',
        'Hold a piece and aim at the floor: green fits, red does not. Click to place, R rotates, B arranges, hold-click to drag, X sells back for half.'), next: 'menu' },
      { id: 'deliver', say: tl('ของใหญ่จ่ายเงินแล้วผมส่งให้ในซอยครับ 20 บาท คนส่งของเราไม่เคยหลงทาง… ยกเว้นตอนที่เขาหลงครับ', 'Big pieces are delivered in the soi for 20 baht. Our driver never gets lost… except when he does.'), next: 'menu' },
      { id: 'bye', say: tl('ขอบคุณครับ ขอให้วันนี้เป็นวันที่ปกติครับ', 'Thank you. Have a normal day.'), face: 'neutral', end: true },
    ],
  });
}
