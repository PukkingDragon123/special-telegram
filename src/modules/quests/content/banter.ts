import type { TL } from '../../../core/util';
import type { DlgNode, DlgOption, TalkTarget } from '../api';
import { T, pick } from './common';

/* ============================================================================================
 * BANTER — quick player comebacks injected into the first node of every everyday conversation
 * (shopkeepers, aunties, uncles, moto guys, the old man, Clark, the landlord, the homeless uncle …).
 * The session adds up to two cards (one cocky/joke, one rude-but-funny); the NPC answers in their own
 * voice (laughs, gets offended, swears back) and you return to the conversation.
 * Street register on purpose: everyday Thai swearing, no slurs, nothing sexual, no real people.
 * Short lines only (the player asked for less text on screen).
 * ========================================================================================== */

type Group = 'auntie' | 'uncle' | 'young' | 'oldman' | 'clark' | 'clerk' | 'homeless' | 'landlord' | 'generic';

/** player lines */
const COCKY: TL[] = [
  T('การผัดคือศิลปะ', 'Stir-frying is art'),
  T('ผมไม่ได้ขี้เกียจ ผมประหยัดพลังงาน', "I'm not lazy, I'm energy-saving"),
  T('ใจเย็นๆ กระทะยังไม่ร้อน', 'Chill, the wok is not hot yet'),
  T('ไฟแรงๆ ชีวิตก็แรงครับ', 'High heat, high life'),
  T('เชฟมิชลินระดับแผงลอยครับ', 'Michelin chef, street-cart edition'),
  T('ผมไม่ได้จน ผมแค่รวยช้า', "I'm not broke, just rich slowly"),
  T('กะเพราผมหอมจนผีตื่น', 'My kaphrao wakes the dead'),
  T('กระทะผมร้อนกว่าข่าวในซอยอีก', 'My wok is hotter than soi gossip'),
  T('ทำกับข้าวด้วยใจ… กับผงชูรส', 'Cooked with love… and MSG'),
  T('อย่าดูถูกคนถือตะหลิว', 'Never underestimate a man with a spatula'),
];
const JOKE: TL[] = [
  T('ไข่ดาวด่าไข่เจียว: มึงอย่ามาเจียวกู', 'Fried egg to omelette: back off, scrambler'),
  T('ชีวิตเหมือนพริก ยิ่งเล็กยิ่งแสบ', "Life's like chili: the small ones hurt most"),
  T('เงินผมหายเร็วกว่าน้ำมันในกระทะ', 'My money vanishes faster than wok oil'),
  T('ร้อนชิบหาย นึกว่าอยู่ในกระทะเอง', "So hot, I thought I was the one frying"),
  T('ผมเล่นบาคาร่า แพ้จนบาคาร่าสงสาร', 'Lost so bad the baccarat table pitied me'),
  T('รถติดจนผมทอดไข่บนฝากระโปรงได้', 'Traffic so bad I could fry an egg on a hood'),
];
const RUDE: TL[] = [
  T('พูดมาก เดี๋ยวขึ้นราคานะ', 'Keep talking and prices go up'),
  T('เงียบแป๊บ กำลังอินกับกระทะ', "Shh, I'm in the zone with my wok"),
  T('ไอ้บ้า… ล้อเล่นๆ', 'You idiot… kidding, kidding'),
  T('บ่นเก่งจัง เปิดช่องยูทูบเลยไหม', 'Such a moaner, start a YouTube channel'),
  T('เชี่ย หน้าเหมือนกระทะไหม้เลย', 'Damn, you look like a burnt wok'),
  T('อย่ามากวนตีน กำลังยุ่ง', "Don't bug me, I'm busy as hell"),
];

/** NPC reactions: [laugh, offended] per group */
const REACT: Record<Group, { laugh: TL[]; mad: TL[] }> = {
  auntie: {
    laugh: [T('ฮ่าๆ ไอ้เด็กบ้า ปากดีจริง', 'Haha, cheeky brat'), T('ตายแล้ว ขำจนปวดท้อง', 'Oh my, my belly hurts'), T('ปากหวานแบบนี้ ป้าแถมพริกให้', 'Sweet mouth, free chili for you')],
    mad: [T('ไอ้เด็กเวร! ป้าตีด้วยตะหลิวนะ', "Brat! I'll smack you with a spatula"), T('ปากหมาจริงๆ ไอ้นี่', 'Such a dirty mouth'), T('ห่าเอ๊ย พูดกับผู้ใหญ่งี้เหรอ', 'Damn, talking to elders like that?')],
  },
  uncle: {
    laugh: [T('เออ ฮาว่ะ ไอ้สัส', 'Ha, that was good, you punk'), T('ฮ่าๆ มึงนี่มันเกรียนจริง', 'Haha, you little troll'), T('ขำแต่ไม่ลดราคานะ', "Funny, still no discount")],
    mad: [T('ห่าเอ๊ย ปากดีนักนะมึง', 'Hell, smart mouth, huh'), T('ไอ้ควาย ไปไกลๆ เลย', 'Get lost, you buffalo'), T('เดี๋ยวกูเอาเขียงฟาดหัว', "I'll whack you with my chopping block")],
  },
  young: {
    laugh: [T('5555 เชี่ย พี่โคตรเกรียน', 'LOL damn, you savage'), T('สัส ขำ เอาไปลงติ๊กต็อกดีกว่า', 'Lol, post that on TikTok'), T('พี่แม่งตลกว่ะ', "You're freaking hilarious")],
    mad: [T('เฮ้ย แรงไปป่ะพี่', 'Yo, too harsh, bro'), T('อะไรของพี่วะ เพี้ยนป่ะ', "What's wrong with you, bro"), T('เดี๋ยวโดนรีวิวหนึ่งดาวนะพี่', "You're getting one star, bro")],
  },
  oldman: {
    laugh: [T('ฮ่าๆ ไอ้หลานเวร เหมือนลุงตอนหนุ่มเลย', "Haha, little rascal, just like me young"), T('ศิลปะพ่องมึงสิ ผัดต่อไป', 'Art my ass, keep frying'), T('ปากดีขนาดนี้ น่าจะไปขายประกัน', 'With that mouth, go sell insurance')],
    mad: [T('ไอ้ควาย ลุงสอนให้พูดแบบนี้เหรอ', 'Buffalo, did I teach you that?'), T('เดี๋ยวลุงยึดรถเข็นคืนนะ', "I'll take my cart back"), T('ห่าเอ๊ย หลานใครวะเนี่ย', 'Hell, whose grandkid is this')],
  },
  clark: {
    laugh: [T('ตลกดีครับ… โต๊ะยังขำเลย', 'Funny. Even the tables laughed'), T('ผมจะจดลงสมุดมุกครับ', "I'll write that down"), T('หัวเราะในใจครับ', "I'm laughing on the inside")],
    mad: [T('เฟอร์นิเจอร์ยังมีมารยาทกว่าคุณครับ', 'The furniture has better manners'), T('อย่าให้ผมพาไปหลังร้านนะครับ', "Don't make me take you to the back room"), T('ไฟกะพริบแล้วครับ ระวังตัว', 'The lights are flickering. Careful')],
  },
  clerk: {
    laugh: [T('ฮ่าๆ… รับซาลาเปาเพิ่มไหมคะ', 'Haha… steamed bun with that?'), T('ขำค่ะ แต่ระบบไม่ให้ลด', 'Funny, but the system says no discount'), T('จดลงกลุ่มไลน์พนักงานแล้วค่ะ', 'Posted in the staff group chat')],
    mad: [T('ขอบคุณที่ใช้บริการค่ะ… ไอ้บ้า', 'Thank you for shopping… idiot'), T('ยิ้มให้แต่ในใจด่านะคะ', "Smiling outside, swearing inside"), T('เรียก รปภ. ได้นะคะ', 'I can call security, you know')],
  },
  homeless: {
    laugh: [T('ฮ่าๆ ปากดีแบบนี้ เดี๋ยวก็มานอนลังข้างลุง', "Haha, with that mouth you'll sleep next to me"), T('มุกนี้ห้าบาทนะหลาน', "That joke costs five baht"), T('ลุงขำจนลืมหิวเลย', 'Laughed so hard I forgot I was hungry')],
    mad: [T('ใจดำ… เหมือนกระทะไหม้', 'Heart as black as a burnt wok'), T('ไอ้เวร ลุงก็มีหัวใจนะ', "Jerk, I have feelings too"), T('ขอให้ไข่ดาวไม่กรอบไปตลอดชีวิต', 'May your eggs never be crispy')],
  },
  landlord: {
    laugh: [T('ฮ่าๆ ขำแต่ค่าเช่าเท่าเดิม', 'Funny, rent stays the same'), T('ปากดีดี ไปเปิดร้านเถอะ', 'Good mouth, go open the shop'), T('เจ๊ชอบคนกวนๆ แบบนี้', 'I like cheeky ones')],
    mad: [T('ค่าเช่าขึ้นสิบเปอร์เซ็นต์ เพราะปาก', 'Rent up ten percent. For the mouth'), T('ไอ้เด็กเวร อยากนอนข้างถนนต่อเหรอ', 'Brat, want to keep sleeping on the street?'), T('เจ๊ไม่ปล่อยเช่าให้ปากหมานะ', "I don't rent to potty mouths")],
  },
  generic: {
    laugh: [T('5555 บ้าไปแล้ว', 'Lol, crazy'), T('เชี่ย ขำว่ะ', 'Damn, that was funny'), T('ฮ่าๆ ไอ้บ้า', 'Haha, lunatic')],
    mad: [T('ไอ้บ้า พูดอะไรของมึง', "What the hell are you saying"), T('แม่ง กวนตีนจริง', 'Damn, so annoying'), T('ไปไกลๆ เลยไป', 'Get lost')],
  },
};

function groupOf(dlgId: string | undefined, t: TalkTarget): Group | null {
  const id = dlgId ?? '';
  if (/^tut_|^ritual_grandpa$|quest|__offer/.test(id)) return null;   // scripted conversations keep their own options
  if (id === 'p_oldman' || t.role === 'oldman') return 'oldman';
  if (/clark/.test(id)) return 'clark';
  if (id === 'landlord') return 'landlord';
  if (id === 'p_homeless' || t.role === 'homeless') return 'homeless';
  if (/^k_(auntie|veg|plastic|egg)$|^p_gossip$|^p_lotto_walker$|^ritual_lottery$/.test(id)) return 'auntie';
  if (/^k_(butcher|gas|kitchen)$/.test(id)) return 'uncle';
  if (/^k_(store|wholesale)$/.test(id)) return 'clerk';
  if (id === 'p_moto') return 'young';
  if (id === 'p_smalltalk' || !id) {
    const r = t.role.toLowerCase();
    if (/ghost|cat|dog|monk/.test(r)) return null;
    if (/student|teen|gamer|kid|delivery|rider|tourist|backpacker|moto/.test(r)) return 'young';
    if (/uncle|grandpa|construction|worker|gangster|guard|police|sweeper|karaoke/.test(r)) return 'uncle';
    if (/auntie|lady|housewife|grandma|vendor/.test(r)) return 'auntie';
    if (/office/.test(r)) return 'clerk';
    return 'generic';
  }
  return 'generic';
}

/**
 * Quick-reply cards for the FIRST node of a conversation + their reaction nodes.
 * `backTo` = node to return to after the NPC answers. `room` = how many cards may be added (0–2).
 */
export function banterFor(dlgId: string | undefined, t: TalkTarget, backTo: string, room: number): { options: DlgOption[]; nodes: DlgNode[] } | null {
  const g = groupOf(dlgId, t);
  if (!g || room <= 0) return null;
  const R = REACT[g];
  const back: DlgOption[] = [
    { text: T('555 ต่อๆ', 'Lol, go on'), next: backTo },
    { text: T('ไปละ บาย', 'Later'), end: true },
  ];
  const nodes: DlgNode[] = [
    { id: '__bt_laugh', say: () => pick(R.laugh), anim: 'laugh', options: back },
    { id: '__bt_mad', say: () => pick(R.mad), anim: 'angry', face: 'shock', options: back },
  ];
  // pick fresh lines each conversation (stable while the cards are on screen)
  const nice = pick(Math.random() < 0.6 ? COCKY : JOKE);
  const rude = pick(RUDE);
  const options: DlgOption[] = [{ text: nice, next: Math.random() < 0.8 ? '__bt_laugh' : '__bt_mad' }];
  if (room >= 2) options.push({ text: rude, next: Math.random() < 0.65 ? '__bt_mad' : '__bt_laugh' });
  return { options, nodes };
}
