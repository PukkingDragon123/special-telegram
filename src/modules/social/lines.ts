import { TL, tl } from '../../core/util';

/* ============================================================================================
 * Lines for the social module. references/culture/lines.json (friends_banter, skill_tree_thoughts,
 * sleeping_on_cardboard, …) is bundled at build time (import.meta.glob → {} if missing) and
 * merged over these fallbacks.
 * ========================================================================================== */

const found = import.meta.glob('../../../references/culture/lines.json', { eager: true, import: 'default' }) as Record<string, any>;
const LJ: any = Object.values(found)[0] ?? {};

function norm(a: any): TL[] {
  if (!Array.isArray(a)) return [];
  return a.map((x) => (typeof x === 'string' ? { th: x } : { th: x.th ?? x.text ?? '', en: x.en })).filter((x) => x.th);
}

const FB: Record<string, TL[]> = {
  slap: [tl('ตื่น!', 'Wake up!'), tl('ตั้งสติ!', 'Get it together!'), tl('เพียะ!', 'SLAP!')],
  slapped: [tl('โอ๊ย! อะไรของมึง', "Ow! What's your problem"), tl('เจ็บนะเว้ย', 'That hurt, man')],
  high_five: [tl('เยส!', 'Yes!'), tl('ทีมเวิร์ค!', 'Teamwork!'), tl('แปะ!', 'High five!')],
  left_hanging: [tl('...', '...'), tl('ไม่เป็นไร ไม่ได้อยากแปะหรอก', "It's fine, didn't want to anyway"), tl('มือค้างเลยกู', 'Left hanging...'), tl('(แกล้งเกาหัว)', '(pretends to scratch head)'), tl('โบกมือให้ยุงน่ะ', 'I was waving at a mosquito')],
  snatch: [tl('ขอยืมนะ', 'Borrowing this'), tl('ของกู!', 'Mine!'), tl('ช้าไป!', 'Too slow!')],
  snatched: [tl('เฮ้ย! คืนมา!', 'Hey! Give it back!'), tl('มาแย่งกันเลยมา!', 'Come on then, fight me for it!')],
  tug_win: [tl('ของกูแล้ว!', "It's mine now!"), tl('แรงช้างสาร!', 'Strength of an elephant!')],
  tug_lose: [tl('มือลื่น!', 'My hand slipped!'), tl('ปล่อยให้ชนะหรอก', 'I let you win'), tl('กินข้าวน้อยไป', "Didn't eat enough rice")],
  give_money: [tl('เอาไป ไปซื้อไข่', 'Here, go buy eggs'), tl('ยืมก่อน เดี๋ยวคืน... มั้ง', "A loan... I'll pay back... maybe")],
  receive_money: [tl('ขอบใจเพื่อน!', 'Thanks, buddy!'), tl('รวยแล้วโว้ย!', "I'm rich, baby!"), tl('แค่นี้เองเหรอ', "That's it?")],
  broke: [tl('ตังค์ไม่พอว่ะ', 'Not enough money'), tl('กระเป๋าแบนแล้ว', 'My wallet is flat')],
  skill_tree_thoughts: [tl('กะเพรา คือ ชีวิต', 'Kaprao. Is. Life.'), tl('กระทะร้อน ใจเย็น', 'Hot wok, cool heart'), tl('ลืมไปแล้วว่ามาคิดอะไร', 'Forgot what I came here to think about')],
  sleeping_on_cardboard: [tl('เที่ยงคืนแล้ว... หาลังกระดาษ', 'Midnight... find some cardboard'), tl('ฝันดีนะเพื่อน', 'Sweet dreams, buddy'), tl('ใครกรน!', "Who's snoring!")],
  bedtime: [tl('เที่ยงคืนแล้ว! หาลังกระดาษนอนเร็ว!', "It's midnight! Find some cardboard to sleep on!"), tl('ง่วงจนตาจะปิดแล้ว...', "Can't keep my eyes open...")],
  pass_out: [tl('นอนตรงนี้แหละ... ไม่ไหวแล้ว', "I'll sleep right here... can't go on"), tl('พื้นก็นุ่มดีนะ...', 'The ground is kinda soft...'), tl('ฝันดี... ถนน...', 'Good night... road...')],
  wake: [tl('ปวดหลังชิบ...', 'My back is killing me...'), tl('เช้าแล้วเหรอ!?', 'Morning already!?'), tl('ฝันว่ารวย... ตื่นมาก็จนเหมือนเดิม', 'Dreamt I was rich... woke up broke'), tl('วันนี้ต้องขายให้ได้!', "Today we'll sell it all!")],
  wake_sore: [tl('นอนพื้นปูนทั้งคืน... หลังพัง', 'Slept on concrete all night... back destroyed'), tl('ใครเอาลังกระดาษกูไป!', 'Who took my cardboard!')],
  slapped_awake: [tl('ใครตบกูวะ!', 'Who slapped me!?'), tl('กำลังฝันดีเลย!', 'I was having a nice dream!')],
  slap_think: [tl('ฝันอะไรอยู่!', 'What are you daydreaming!'), tl('ตื่นๆ! ลูกค้ารอ!', 'Wake up! Customers waiting!')],
  slap_book: [tl('อ่านอะไรนักหนา!', 'Enough reading!'), tl('สูตรจำได้แล้ว!', 'You know the recipe already!')],
  iron_cheek: [tl('โอ๊ย มือกู! แก้มทำด้วยอะไรวะ', 'Ow, my hand! What is your face made of'), tl('แก้มเหล็ก!', 'Iron cheek!')],
  levelup: [tl('รู้สึกเก่งขึ้นนิดนึง', 'Feeling a tiny bit better at this'), tl('เลเวลอัป! ตึงๆ', 'Level up! Hardcore')],
  unlock_old_man: [tl('ไอ้หนู! ลุงเอาสูตรใหม่มาให้', "Boys! I brought you a new recipe"), tl('ขายดีนี่ ลุงให้สูตรเพิ่มอีกหน้า', "Selling well, eh? Here's another page")],
};

export function lines(key: string): TL[] {
  const fb = FB[key] ?? [];
  const fromJ = norm(LJ.friends_banter?.[key] ?? LJ[key]);
  return fromJ.length ? fromJ : fb;
}

export function pick(key: string, seed = Math.random()): TL {
  const a = lines(key);
  if (!a.length) return { th: '...' };
  return a[Math.floor(seed * a.length) % a.length];
}
