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
  T('ผมเกิดมาเพื่อผัด', 'I was born to stir-fry'),
  T('ไฟผมแรงกว่าแฟนเก่าอีก', 'My flame is hotter than my ex'),
  T('ผมไม่ได้หยิ่ง ผมแค่เก่ง', "I'm not arrogant, I'm just good"),
  T('ตะหลิวนี้ผ่านศึกมาเยอะ', 'This spatula has seen wars'),
  T('ผมผัดได้แม้ไฟดับ', 'I can fry in a blackout'),
  T('มีผมอยู่ ซอยนี้ไม่อดตาย', 'While I live, this soi never starves'),
];
const JOKE: TL[] = [
  T('ไข่ดาวด่าไข่เจียว: มึงอย่ามาเจียวกู', 'Fried egg to omelette: back off, scrambler'),
  T('ชีวิตเหมือนพริก ยิ่งเล็กยิ่งแสบ', "Life's like chili: the small ones hurt most"),
  T('เงินผมหายเร็วกว่าน้ำมันในกระทะ', 'My money vanishes faster than wok oil'),
  T('ร้อนชิบหาย นึกว่าอยู่ในกระทะเอง', "So hot, I thought I was the one frying"),
  T('ผมเล่นบาคาร่า แพ้จนบาคาร่าสงสาร', 'Lost so bad the baccarat table pitied me'),
  T('รถติดจนผมทอดไข่บนฝากระโปรงได้', 'Traffic so bad I could fry an egg on a hood'),
  T('ทำไมกระทะไม่มีเพื่อน? เพราะมันชอบเหวี่ยง', 'Why has the wok no friends? It flips out'),
  T('หมูสับเครียดเพราะชีวิตมันแหลก', 'Minced pork is stressed: its life is crushed'),
  T('ไข่เจียวฟูเหมือนหนี้ผม', 'Fluffy omelette, like my debt'),
  T('ผมเล่นหวยจนเลขจำหน้าผมได้', 'Played the lottery so much the numbers know me'),
  T('ผีในซอยยังจนกว่าผม', 'Even the soi ghost is richer than me'),
  T('หมาขโมยหมูผมบ่อยจนต้องจ่ายเงินเดือนมัน', 'The dog steals so often I owe it a salary'),
  T('ร้อนจนไข่ดาวสุกบนหัวผม', 'So hot I could fry an egg on my head'),
  T('รถติดจนผมแก่ไปสองปี', 'Traffic so bad I aged two years'),
  T('ข้าวไหม้ไม่ใช่ความผิดผม เป็นความผิดไฟ', "Burnt rice isn't my fault, blame the fire"),
  T('บ่อนกินเงินผมไปหมด เหลือแต่ความหล่อ', 'The casino took everything but my looks'),
  T('ผมไม่ได้ทำไหม้ ผมทำรมควัน', "I didn't burn it, I smoked it"),
  T('กระเป๋าตังค์ผมเงียบยิ่งกว่าป่าช้า', 'My wallet is quieter than a cemetery'),
  T('พริกเผ็ดไม่เท่าบิลค่าไฟ', 'Chili is less painful than the electric bill'),
  T('ตังค์ผมเหมือนผี ได้ยินแต่ไม่เคยเห็น', 'My money is like a ghost: heard of, never seen'),
];
const RUDE: TL[] = [
  T('พูดมาก เดี๋ยวขึ้นราคานะ', 'Keep talking and prices go up'),
  T('เงียบแป๊บ กำลังอินกับกระทะ', "Shh, I'm in the zone with my wok"),
  T('ไอ้บ้า… ล้อเล่นๆ', 'You idiot… kidding, kidding'),
  T('บ่นเก่งจัง เปิดช่องยูทูบเลยไหม', 'Such a moaner, start a YouTube channel'),
  T('เชี่ย หน้าเหมือนกระทะไหม้เลย', 'Damn, you look like a burnt wok'),
  T('อย่ามากวนตีน กำลังยุ่ง', "Don't bug me, I'm busy as hell"),
  T('หน้ามึงเหมือนหมูสับที่ลืมเก็บ', 'Your face looks like pork left out overnight'),
  T('พูดอีกคำ ผมใส่พริกสิบเม็ด', 'One more word and you get ten chilies'),
  T('ปากดีขนาดนี้ เอาไปทำน้ำปลาได้', 'With that mouth you could make fish sauce'),
  T('แก่แล้วอย่าเครียด เดี๋ยวหน้าย่นเหมือนพริกแห้ง', "Relax, or you'll wrinkle like dried chili"),
  T('มึงบ่นเก่งกว่าแม่กูอีก', 'You complain more than my mom'),
  T('ไอ้สัส ล้อเล่น รักนะ', 'Ass… kidding, love you'),
  T('หุบปากแล้วกินซะ', 'Shut up and eat'),
  T('ราคานี้ถูกกว่าค่ารักษาความหน้าด้านของมึงอีก', 'Cheaper than therapy for your nerve'),
];

/** NPC reactions: [laugh, offended] per group */
const REACT: Record<Group, { laugh: TL[]; mad: TL[] }> = {
  auntie: {
    laugh: [T('ฮ่าๆ ไอ้เด็กบ้า ปากดีจริง', 'Haha, cheeky brat'), T('ตายแล้ว ขำจนปวดท้อง', 'Oh my, my belly hurts'), T('ปากหวานแบบนี้ ป้าแถมพริกให้', 'Sweet mouth, free chili for you'), T('ไอ้เด็กบ้า มุกห่วยแต่ป้าขำ', 'Brat, terrible joke but I laughed'), T('มุกแป้กจนแป้งทอดเขิน', 'So unfunny the batter blushed')],
    mad: [T('ไอ้เด็กเวร! ป้าตีด้วยตะหลิวนะ', "Brat! I'll smack you with a spatula"), T('ปากหมาจริงๆ ไอ้นี่', 'Such a dirty mouth'), T('ห่าเอ๊ย พูดกับผู้ใหญ่งี้เหรอ', 'Damn, talking to elders like that?'), T('ปากแบบนี้ไม่มีใครเอาไปทำผัวหรอก', "No one's marrying that mouth"), T('เดี๋ยวป้าเอาครกฟาดปาก', "I'll whack that mouth with a mortar")],
  },
  uncle: {
    laugh: [T('เออ ฮาว่ะ ไอ้สัส', 'Ha, that was good, you punk'), T('ฮ่าๆ มึงนี่มันเกรียนจริง', 'Haha, you little troll'), T('ขำแต่ไม่ลดราคานะ', "Funny, still no discount"), T('ห่า มุกพ่อแต่ฮา', 'Damn, dad joke but funny'), T('เออๆ ขำ ไปผัดต่อไป', 'Fine, funny, go fry')],
    mad: [T('ห่าเอ๊ย ปากดีนักนะมึง', 'Hell, smart mouth, huh'), T('ไอ้ควาย ไปไกลๆ เลย', 'Get lost, you buffalo'), T('เดี๋ยวกูเอาเขียงฟาดหัว', "I'll whack you with my chopping block"), T('มึงอยากโดนสับใช่ป่ะ', 'You wanna get chopped?'), T('ไอ้เวร หน้ามึงเหมือนตูดกระทะ', 'Jerk, your face looks like a wok bottom')],
  },
  young: {
    laugh: [T('5555 เชี่ย พี่โคตรเกรียน', 'LOL damn, you savage'), T('สัส ขำ เอาไปลงติ๊กต็อกดีกว่า', 'Lol, post that on TikTok'), T('พี่แม่งตลกว่ะ', "You're freaking hilarious"), T('ห่วยแตกจนขำ 555', "So bad it's funny lol"), T('มุกพ่อเกิน แต่ชอบ', 'Dad joke overload, love it')],
    mad: [T('เฮ้ย แรงไปป่ะพี่', 'Yo, too harsh, bro'), T('อะไรของพี่วะ เพี้ยนป่ะ', "What's wrong with you, bro"), T('เดี๋ยวโดนรีวิวหนึ่งดาวนะพี่', "You're getting one star, bro"), T('พี่ไปนอนเถอะ เพลียแล้ว', "Go sleep bro, you're tired"), T('cringe ชิบหาย', 'So damn cringe')],
  },
  oldman: {
    laugh: [T('ฮ่าๆ ไอ้หลานเวร เหมือนลุงตอนหนุ่มเลย', "Haha, little rascal, just like me young"), T('ศิลปะพ่องมึงสิ ผัดต่อไป', 'Art my ass, keep frying'), T('ปากดีขนาดนี้ น่าจะไปขายประกัน', 'With that mouth, go sell insurance'), T('มุกนี้ลุงเล่นตั้งแต่สมัยจอมพล', 'I told that joke decades ago'), T('ห่วยแต่ขำ เหมือนกะเพราหลาน', 'Bad but funny, like your kaphrao')],
    mad: [T('ไอ้ควาย ลุงสอนให้พูดแบบนี้เหรอ', 'Buffalo, did I teach you that?'), T('เดี๋ยวลุงยึดรถเข็นคืนนะ', "I'll take my cart back"), T('ห่าเอ๊ย หลานใครวะเนี่ย', 'Hell, whose grandkid is this'), T('ลุงแก่แต่ยังเตะได้นะ', "I'm old but I can still kick"), T('ไอ้หลานปากหมา', 'Potty-mouthed grandkid')],
  },
  clark: {
    laugh: [T('ตลกดีครับ… โต๊ะยังขำเลย', 'Funny. Even the tables laughed'), T('ผมจะจดลงสมุดมุกครับ', "I'll write that down"), T('หัวเราะในใจครับ', "I'm laughing on the inside"), T('มุกนี้ควรวางขายลดราคาครับ', 'That joke belongs on clearance'), T('ผมยิ้มแล้วครับ ดูไม่ออกเฉยๆ', "I smiled. You just can't tell")],
    mad: [T('เฟอร์นิเจอร์ยังมีมารยาทกว่าคุณครับ', 'The furniture has better manners'), T('อย่าให้ผมพาไปหลังร้านนะครับ', "Don't make me take you to the back room"), T('ไฟกะพริบแล้วครับ ระวังตัว', 'The lights are flickering. Careful'), T('มุกนี้ไม่รับเปลี่ยนคืนครับ', 'No refunds on that joke'), T('เดินเข้าห้องหลังร้านไปคนเดียวเลยครับ', 'Feel free to walk into the back room alone')],
  },
  clerk: {
    laugh: [T('ฮ่าๆ… รับซาลาเปาเพิ่มไหมคะ', 'Haha… steamed bun with that?'), T('ขำค่ะ แต่ระบบไม่ให้ลด', 'Funny, but the system says no discount'), T('จดลงกลุ่มไลน์พนักงานแล้วค่ะ', 'Posted in the staff group chat'), T('ฮ่าๆ รับถุงเพิ่มไหมคะ', 'Haha, need a bag?'), T('มุกนี้สะสมแต้มได้ไหมคะ', 'Can I collect points for that joke?')],
    mad: [T('ขอบคุณที่ใช้บริการค่ะ… ไอ้บ้า', 'Thank you for shopping… idiot'), T('ยิ้มให้แต่ในใจด่านะคะ', "Smiling outside, swearing inside"), T('เรียก รปภ. ได้นะคะ', 'I can call security, you know'), T('บัตรสมาชิกคุณถูกระงับค่ะ', 'Your member card is suspended'), T('ระบบด่าคุณในใจแล้วค่ะ', 'The system swore at you silently')],
  },
  homeless: {
    laugh: [T('ฮ่าๆ ปากดีแบบนี้ เดี๋ยวก็มานอนลังข้างลุง', "Haha, with that mouth you'll sleep next to me"), T('มุกนี้ห้าบาทนะหลาน', "That joke costs five baht"), T('ลุงขำจนลืมหิวเลย', 'Laughed so hard I forgot I was hungry'), T('มุกนี้แลกข้าวได้กี่จาน', 'How many plates is that joke worth?'), T('ฮ่าๆ จนแต่ตลก เหมือนลุง', 'Broke but funny, like me')],
    mad: [T('ใจดำ… เหมือนกระทะไหม้', 'Heart as black as a burnt wok'), T('ไอ้เวร ลุงก็มีหัวใจนะ', "Jerk, I have feelings too"), T('ขอให้ไข่ดาวไม่กรอบไปตลอดชีวิต', 'May your eggs never be crispy'), T('ลุงสาปให้ไข่แตกทุกฟอง', 'I curse all your eggs to crack'), T('ปากแบบนี้ ผียังไม่อยากหลอก', "Even ghosts won't haunt that mouth")],
  },
  landlord: {
    laugh: [T('ฮ่าๆ ขำแต่ค่าเช่าเท่าเดิม', 'Funny, rent stays the same'), T('ปากดีดี ไปเปิดร้านเถอะ', 'Good mouth, go open the shop'), T('เจ๊ชอบคนกวนๆ แบบนี้', 'I like cheeky ones'), T('ตลกดี ลดค่าเช่าให้… ห้าบาท', 'Funny. Rent discount… five baht'), T('มุกห่วยแต่จ่ายตรงเวลา โอเค', 'Bad jokes but pays on time, fine')],
    mad: [T('ค่าเช่าขึ้นสิบเปอร์เซ็นต์ เพราะปาก', 'Rent up ten percent. For the mouth'), T('ไอ้เด็กเวร อยากนอนข้างถนนต่อเหรอ', 'Brat, want to keep sleeping on the street?'), T('เจ๊ไม่ปล่อยเช่าให้ปากหมานะ', "I don't rent to potty mouths"), T('ปากดีจัง ค่ามัดจำเพิ่ม', 'Smart mouth, bigger deposit'), T('เจ๊ไล่ออกได้นะจ๊ะ', 'I can evict you, sweetie')],
  },
  generic: {
    laugh: [T('5555 บ้าไปแล้ว', 'Lol, crazy'), T('เชี่ย ขำว่ะ', 'Damn, that was funny'), T('ฮ่าๆ ไอ้บ้า', 'Haha, lunatic'), T('มุกห่วยชิบหาย แต่ขำ', 'Terrible joke, still laughed'), T('ฮาแบบเศร้าๆ', 'Funny in a sad way')],
    mad: [T('ไอ้บ้า พูดอะไรของมึง', "What the hell are you saying"), T('แม่ง กวนตีนจริง', 'Damn, so annoying'), T('ไปไกลๆ เลยไป', 'Get lost'), T('ปากหมาจริงๆ', 'Real potty mouth'), T('ไอ้เวร อย่ามาใกล้', 'Jerk, stay away')],
  },
};

/** shuffle-bag: lines don't repeat until the whole pool has been used */
const bags = new Map<TL[], TL[]>();
function draw(pool: TL[]): TL {
  let b = bags.get(pool);
  if (!b || !b.length) { b = [...pool].sort(() => Math.random() - 0.5); bags.set(pool, b); }
  return b.pop()!;
}

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
    { id: '__bt_laugh', say: () => draw(R.laugh), anim: 'laugh', options: back },
    { id: '__bt_mad', say: () => draw(R.mad), anim: 'angry', face: 'shock', options: back },
  ];
  // pick fresh lines each conversation (stable while the cards are on screen)
  const nice = draw(Math.random() < 0.5 ? COCKY : JOKE);
  const rude = draw(RUDE);
  const options: DlgOption[] = [{ text: nice, next: Math.random() < 0.8 ? '__bt_laugh' : '__bt_mad' }];
  if (room >= 2) options.push({ text: rude, next: Math.random() < 0.65 ? '__bt_mad' : '__bt_laugh' });
  return { options, nodes };
}
