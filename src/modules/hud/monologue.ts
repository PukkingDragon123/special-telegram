import type { Game } from '../../game/game';
import type { TL } from '../../core/util';

/* ============================================================================================
 * "Talk to yourself" (key T): context-driven inner monologue lines, Thai street register with
 * everyday swearing (no slurs). Picked by situation: broke / rich, night / dawn / rush hour,
 * overloaded, holding something, intro step, tired, raining…
 * ========================================================================================== */

type L = [string, string];
const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

const BROKE: L[] = [
  ['ตังค์เหลือแค่นี้เองเหรอวะ… ชีวิตแม่งยากจริง', 'This is all the money I have left? Life is damn hard'],
  ['ไอ้เวรเอ๊ย ทำไมกูต้องไปเล่นบาคาร่าวะ', 'Damn it, why did I have to play baccarat'],
  ['กระเป๋าตังค์เบากว่าใจกูอีก', 'My wallet is lighter than my soul'],
  ['ถ้ามีมาม่าซักซองก็ดีนะ… ไม่มีเว้ย', 'A pack of instant noodles would be nice… nope'],
  ['เจ้าหนี้โทรมาอีกแล้ว ห่าเอ๊ย ไม่รับ', 'The loan shark is calling again. Hell no'],
  ['เงินเหลือแค่ค่ามาม่า… ซองเดียว', 'Money left for one pack of noodles'],
  ['บัญชีกูติดลบจนธนาคารโทรมาปลอบ', 'Bank called to comfort me'],
  ['ตังค์ในกระเป๋าเหลือแต่ใบเสร็จ', 'My wallet only holds receipts now'],
  ['ถ้าความจนเป็นกีฬา กูได้เหรียญทอง', "If being broke were a sport, I'd win gold"],
  ['บาคาร่าเอาเงินไป ทิ้งไว้แต่บทเรียน', 'Baccarat took my money, left me a lesson'],
];
const RICH: L[] = [
  ['เชี่ย… ตังค์เยอะขนาดนี้ ใครจะเชื่อว่ากูเคยหมดตัว', 'Damn… who would believe I was broke'],
  ['อย่าเอาไปเล่นพนันอีกนะมึง อย่า!', 'Don\'t you dare gamble this again. Don\'t!'],
  ['เปิดร้านใหญ่เลยดีไหมวะ', 'Should I open a proper restaurant?'],
];
const NIGHT: L[] = [
  ['มืดชิบหาย ผีออกมั้ยวะเนี่ย', 'Pitch dark… are ghosts coming out?'],
  ['ตีสามแล้ว คนปกติเขานอนกันหมดแล้วมั้ง', 'It\'s 3 a.m., normal people are asleep'],
  ['หมาเห่าอีกแล้ว เงียบหน่อยได้ไหมไอ้ด่าง', 'The dogs again. Shut up, you spotty mutt'],
  ['ง่วงฉิบหาย แต่ต้องไปต่อ', 'Sleepy as hell, but I have to keep going'],
  ['มืดจนเห็นแต่ฟันหมา', 'So dark I only see dog teeth'],
  ['ผีมาก็ดี จะได้มีลูกค้า', "Ghosts are welcome, they're customers too"],
  ['ผีในซอยคงหิวเหมือนกู', 'The soi ghost is probably as hungry as me'],
  ['มืดแบบนี้ หมาขโมยหมูง่ายชิบหาย', 'This dark, the dog can steal pork so easily'],
];
const DAWN: L[] = [
  ['ฟ้าเริ่มสว่างแล้ว ตลาดเปิดแน่ๆ', 'The sky is getting light, the market must be open'],
  ['กลิ่นข้าวเหนียวหมูปิ้ง… ท้องร้องเลยกู', 'Smell of grilled pork and sticky rice… my stomach'],
];
const DAY: L[] = [
  ['ร้อนแม่ง… ร้อนจนอยากละลาย', 'Bloody hot… hot enough to melt'],
  ['คนเยอะดีวะ ขายของได้แน่', 'Lots of people, I can sell for sure'],
  ['ป้าร้านข้างๆ มองกูแปลกๆ หรือกูคิดไปเอง', 'Is the auntie next door giving me looks or is it just me'],
  ['ทำไมกะเพราร้านอื่นขายดีกว่าวะ… ต้องสู้!', 'Why does the other stall sell more krapow… fight!'],
  ['การผัดคือศิลปะ… ศิลปะที่ร้อนชิบหาย', 'Frying is art… very hot art'],
  ['ถ้าวันนี้ขายหมด จะซื้อพัดลมให้ตัวเอง', "Sell out today, I'm buying myself a fan"],
  ['ร้อนจนเหงื่อผมเค็มกว่าน้ำปลา', 'So hot my sweat is saltier than fish sauce'],
  ['รถติดจนผมนั่งสมาธิได้', 'Traffic so bad I meditated'],
  ['ข้าวไหม้อีกแล้ว… เรียกว่าเมนูพิเศษละกัน', 'Burnt again… call it a special'],
];
const EVENING: L[] = [
  ['ชั่วโมงเร่งด่วน คนหิวเยอะ โอกาสทองมาแล้ว', 'Rush hour, hungry people everywhere — golden chance'],
  ['รถติดชิบหาย ดีแล้วที่กูเดิน', 'Traffic is a nightmare, good thing I walk'],
  ['ลูกค้าหิว กูก็หิว ใครจะได้กินก่อน', 'Customers are hungry, so am I. Who eats first?'],
];
const HEAVY: L[] = [
  ['หนักฉิบหาย หลังจะหักแล้ว', 'Heavy as hell, my back is breaking'],
  ['ขนอะไรมาเยอะแยะวะกู ไอ้ควาย', 'Why am I carrying so much, you idiot'],
  ['ขนของเยอะยังกับย้ายบ้าน', "Carrying like I'm moving house"],
];
const HOLD: L[] = [
  ['ถือ{x}อยู่ เอาไปทำอะไรดีวะ', 'Holding the {x} — what do I do with it'],
  ['{x}… อย่าทำหล่นนะมึง', 'The {x}… don\'t drop it, dumbass'],
];
const INTRO: Record<string, L[]> = {
  wake: [['ตื่นมาตีสาม หัวยังตึ้บๆ อยู่เลย… เมื่อคืนเสียไปเท่าไหร่วะ', 'Awake at 3 a.m., head pounding… how much did I lose last night'],
    ['ไม่มีตังค์ ไม่มีงาน… แต่รถเข็นลุงจอดอยู่ตรงนั้น…', 'No money, no job… but the old man\'s cart is parked right there…']],
  sneak: [['เบาๆ นะมึง ย่องเข้าไป อย่าให้ลุงตื่น', 'Easy now, sneak in, don\'t wake the old man'],
    ['ขโมยรถเข็นคนแก่… กูนี่มันเลวจริงๆ แต่ท้องมันหิวไง', 'Stealing an old man\'s cart… I\'m scum, but I\'m hungry'],
    ['ลุงกรนดังชิบหาย… ดีแล้ว กรนต่อไปนะลุง', 'He snores like hell… good, keep snoring, old man']],
  caught: [['ซวยแล้วกู… ไฟฉายส่องหน้าเลย', 'I\'m screwed… flashlight right in my face'],
    ['คิดข้ออ้างเร็วๆ ไอ้ควาย คิด!', 'Think of an excuse, you idiot, think!']],
  deal: [['ลุงแม่งต่อราคาเก่งกว่าแม่ค้าตลาดอีก', 'This old man haggles harder than the market aunties'],
    ['จับมือแล้วนะ… ห้ามเบี้ยวนะมึง', 'We shook on it… don\'t you dare back out']],
  pay: [['ร้อยบาทสุดท้ายในชีวิต… ลาก่อน', 'My last hundred baht on earth… farewell'],
    ['ดีกว่าโดนตำรวจจับ… มั้ง', 'Better than getting arrested… probably']],
  lesson: [['ลุงบ่นทุกขั้นตอนเลย… แต่ก็หอมดีนะ', 'He nags every single step… but it smells damn good'],
    ['กระเทียมไหม้อีกแล้ว เชี่ย', 'Burnt the garlic again, dammit'],
    ['ไฟแรงไปป่ะวะ… เออ ช่างมัน ผัดต่อ', 'Is the flame too high… whatever, keep stirring']],
  customer: [['ลูกค้าคนแรก! อย่าทำพังนะมึง', 'First customer! Don\'t screw this up'],
    ['ห้าสิบบาทแรกของกู… ร้องไห้แป๊บ', 'My first fifty baht… gonna cry a little']],
  dog: [['ไอ้หมาเวร! นั่นของกูนะเว้ย!', 'Damn dog! That\'s mine!']],
  go_market: [['ไปตลาดซื้อของ ต่อราคาให้เก่งๆ นะมึง', 'To the market — haggle hard, dude']],
};

export function thinkLine(game: Game): TL {
  const me = game.me;
  const step = (game.g as any).introStep as string | undefined;
  const pools: L[][] = [];
  if (step && step !== 'done' && INTRO[step]) pools.push(INTRO[step], INTRO[step]);
  const t: number = (game.g as any).time ?? 12;
  if (t < 5.5 || t >= 21) pools.push(NIGHT); else if (t < 7.5) pools.push(DAWN); else if (t >= 16.5) pools.push(EVENING); else pools.push(DAY);
  const wallet = me?.wallet ?? 0;
  if (wallet < 60) pools.push(BROKE, BROKE); else if (wallet > 2500) pools.push(RICH);
  if (me && game.items.isOverloaded(me)) pools.push(HEAVY, HEAVY, HEAVY);
  const held = me ? game.items.selected(me) : null;
  if (held) {
    const n = game.items.name(held);
    pools.push(HOLD.map(([th, en]) => [th.replace('{x}', n.th), en.replace('{x}', n.en ?? n.th)] as L));
  }
  const [th, en] = pick(pick(pools));
  return { th, en };
}
