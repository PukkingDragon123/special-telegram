import type { TL } from '../../core/util';
import type { ReplyCat } from './data';

/* =============================================================================================
 * Shop dialogue (natural spoken Thai first, short English gloss). Templates:
 *   {p} price · {n} player name · {d} debt · {c} how the keeper calls you (หนู/น้อง/อาตี๋…)
 * Grouped by personality id (see data.ts PERSONALITIES); `_` = generic fallback.
 * ============================================================================================= */

type Pool = TL[];
const L = (th: string, en?: string): TL => ({ th, en });

export const GREET: Record<string, Pool> = {
  soft_auntie: [L('มาจ้ะ{c} ซื้ออะไรดี', 'Come, dear, what are you buying?'), L('ผักสดๆ หมูสดๆ จ้า', 'Fresh veg, fresh pork!'), L('เลือกเลยจ้ะ ของป้าสดทุกอย่าง', 'Pick anything, all fresh')],
  chatty_auntie: [L('มาๆ น้อง ดูก่อนได้ ไม่ซื้อไม่ว่า', "Come look, no need to buy"), L('วันนี้ผักสวยมาก ปลูกเองกับมือ!', 'Veg is gorgeous today, grew it myself!'), L('เอาอะไรจ๊ะ บอกเจ๊มา', 'Tell me what you need')],
  stingy_uncle: [L('จะเอาอะไร ว่ามา', "What d'you want? Say it."), L('หมูสดเพิ่งเชือดเมื่อเช้า', 'Fresh pork, this morning'), L('ดูได้ จับได้ แต่ซื้อด้วยนะ', 'Look, touch… but buy')],
  polite_hia: [L('เชิญครับอาตี๋ ดูตามสบาย', 'Welcome, take your time'), L('กระทะเหล็กแท้ ใช้ได้ยันหลาน', 'Real steel wok, lasts generations')],
  gruff_uncle: [L('แก๊สเหรอ น้ำเหรอ', 'Gas? Water?'), L('ถังเปล่ามีไหม เอามาแลก', 'Got an empty tank? Bring it to swap')],
  business_jeh: [L('ไข่สดค่ะ ฟองใหญ่ ไม่แตก', 'Fresh eggs, big, no cracks'), L('ของแห้งครบค่ะ น้ำปลา ซอส น้ำมัน', 'All dry goods here')],
  robot_clerk: [L('สวัสดีค่ะ ยินดีต้อนรับค่ะ', 'Hello, welcome!')],
  cashier: [L('เชิญค่ะ ช่องนี้ว่างค่ะ', 'This lane is free'), L('มีบัตรสมาชิกไหมคะ', 'Member card?')],
  _: [L('มาจ้า เลือกได้เลย', 'Welcome, pick anything')],
};

export const REGULAR_GREET: Pool = [L('อ้าว {n} มาอีกแล้ว ขาประจำป้า!', '{n} again! My regular!'), L('{n} มาแล้ว วันนี้ลดให้นิดนึง', "{n}'s here, small discount today")];

export const TALK: Record<string, Pool> = {
  soft_auntie: [L('กะเพราต้องใบกะเพราแท้นะ ไม่ใช่โหระพา!', 'Real holy basil, not sweet basil!'), L('หมูสับต้องติดมันนิดๆ ถึงจะอร่อย', 'Minced pork needs a bit of fat'), L('ได้ข่าวว่าพวกหนูซื้อรถเข็นลุงเขามา 100 บาทเหรอ', 'Heard you bought the old cart for 100?')],
  chatty_auntie: [L('รู้ไหม ร้านก๋วยเตี๋ยวฝั่งโน้นเพิ่งขึ้นราคา', 'The noodle shop across just raised prices'), L('เมื่อคืนผีมอไซค์ขี่ผ่านหน้าบ้านเจ๊อีกแล้ว!', 'The headless biker passed my house again!'), L('ผักบุ้งวันนี้กรอบมาก ผัดไฟแดงอร่อยแน่', 'Morning glory is crisp today')],
  stingy_uncle: [L('สมัยก่อนหมูกิโลละ 80 เอง', 'Pork used to be 80 a kilo…'), L('อย่ามาต่อเยอะ ลุงก็ต้องกินต้องใช้', "Don't haggle too much, I gotta eat too")],
  polite_hia: [L('กระทะใหม่ต้องเผาก่อนใช้นะ', 'Season a new wok before using'), L('ครกดินเผาตำพริกหอมกว่าครกหิน', 'Clay mortar smells better for chili')],
  gruff_uncle: [L('แก๊สรัฐบาลคุมราคา ต่อไม่ได้นะ', 'Gas price is regulated. No haggling.'), L('ร้อนขนาดนี้ น้ำแข็งขายดี', 'Hot like this, ice sells well')],
  business_jeh: [L('ไข่เบอร์ศูนย์ฟองใหญ่ ทอดไข่ดาวสวย', 'Size-0 eggs, pretty fried eggs'), L('ซื้อเป็นแผงถูกกว่านะ', 'Cheaper by the tray')],
  robot_clerk: [L('รับซาลาเปาเพิ่มไหมคะ', 'Would you like a steamed bun?'), L('มีบัตรสมาชิกไหมคะ', 'Do you have a member card?'), L('ตอนนี้มีโปรซื้อ 2 ชิ้นถูกกว่าค่ะ', 'Buy 2, cheaper, today only')],
  cashier: [L('ซื้อยกลังคุ้มกว่าค่ะ', 'Buying by the case is cheaper'), L('รถเข็นอยู่ทางเข้านะคะ', 'Trolleys are by the entrance')],
  _: [L('ช่วงนี้ของขึ้นราคาทุกอย่าง', 'Everything is getting pricier')],
};

export const QUOTE: Record<string, Pool> = {
  soft_auntie: [L('ทั้งหมด {p} บาทจ้ะ', '{p} baht in total'), L('{p} บาทจ้ะ{c}', '{p} baht, dear')],
  chatty_auntie: [L('{p} บาทจ้ะน้อง ถูกสุดในตลาดแล้ว', '{p} — cheapest in the market'), L('ให้ {p} ละกัน', 'Let’s say {p}')],
  stingy_uncle: [L('{p} บาท', '{p} baht.'), L('{p} ไม่ขาดไม่เกิน', '{p}, exactly')],
  polite_hia: [L('{p} บาทครับอาตี๋', '{p} baht'), L('ราคาเฮียให้ {p}', 'My price: {p}')],
  gruff_uncle: [L('{p}', '{p}.'), L('{p} บาท จ่ายมา', '{p}. Pay up.')],
  business_jeh: [L('{p} บาทค่ะ', '{p} baht')],
  robot_clerk: [L('ทั้งหมด {p} บาทค่ะ', '{p} baht, please')],
  cashier: [L('ทั้งหมด {p} บาทค่ะ', '{p} baht, please')],
  _: [L('{p} บาท', '{p} baht')],
};

/** Player reply options, {c} = how to call the keeper (ป้า/ลุง/เจ๊/เฮีย/น้อง). */
export const REPLIES: Record<ReplyCat, Pool> = {
  polite: [L('ลดหน่อยได้ไหมครับ{k}', 'Could you lower it a bit?'), L('ปัดเศษให้หน่อยได้ไหมครับ', 'Round it down for me?'), L('ซื้อหลายอย่างเลย ลดนิดนึงนะครับ', "I'm buying a lot, small discount?"), L('รบกวนลดให้หน่อยนะครับ{k}', 'Please, a little discount')],
  sweet: [L('{k}สวย/หล่อที่สุดในตลาดเลย ลดให้หน่อยน้า', 'Best-looking in the market, discount?'), L('ของ{k}สดที่สุดในโลก!', 'Freshest stuff in the world!'), L('เดี๋ยวมาอุดหนุนทุกวันเลยครับ', "I'll come every single day"), L('ใจดีที่สุดในซอยเลย{k}', 'Kindest in the whole soi')],
  funny: [L('ผมจนกว่าหมาข้างทางอีกครับ', "I'm poorer than the street dog"), L('เพิ่งหมดตัวที่บ่อนมาครับ ลดหน่อย', 'Just lost it all at the casino…'), L('ลดให้ เดี๋ยวผมเต้นให้ดูเลย', "Discount and I'll dance for you"), L('ถ้าลด ผมจะเรียก{k}ว่าแม่!', "Discount and I'll call you Mom!")],
  rude: [L('แพงชิบ! ปล้นกันเหรอ', 'So expensive! Is this a robbery?'), L('ราคานี้ ไปแม็กโคร่งดีกว่า', "At this price I'd go to Makrong"), L('ของแค่นี้ ขายแพงจัง', 'This little for that much?'), L('โกงชัวร์ๆ', "You're totally ripping me off")],
};
export const CAT_COLORS: Record<ReplyCat, number> = { polite: 0xfffbf2, sweet: 0xffe3ec, funny: 0xfff1b8, rude: 0xffd6c8 };

/** Reactions: [good, bad] per personality (good = mood went up). */
export const REACT: Record<string, { good: Pool; bad: Pool; sweetFail?: Pool }> = {
  soft_auntie: {
    good: [L('อุ๊ย ปากหวานจริง เอา {p} ก็ได้', 'Oh you sweet talker, {p} then'), L('ฮ่าๆ ตลกดี ป้าให้ {p}', 'Haha, funny — {p}'), L('เออๆ ลดให้ก็ได้ {p} บาท', 'Fine, fine, {p}')],
    bad: [L('พูดแบบนี้ป้าไม่ลดนะ!', "Talk like that and no discount!"), L('อะไรของเธอเนี่ย! {p} ไม่ต้องต่อ', 'What is wrong with you! {p}, no haggling'), L('งั้นขึ้นราคาเลยดีไหม {p}!', 'Shall I RAISE it then? {p}!')],
  },
  chatty_auntie: {
    good: [L('ฮ่าๆๆ ตลกจริง! เอาไป {p}', 'Hahaha! Take it for {p}'), L('ปากดีนะเรา เจ๊ให้ {p}', 'Smooth! {p} for you')],
    bad: [L('อ้าว! พูดดีๆ หน่อยสิ {p}', 'Hey! Say it nicely. {p}'), L('ไม่ลดแล้ว! {p}', 'No discount now! {p}')],
  },
  stingy_uncle: {
    good: [L('ฮึ่ม… {p} ก็ได้ ห้ามบอกใครนะ', 'Hmph… {p}. Tell no one.'), L('ฮ่าๆ ไอ้นี่ตลก {p}', 'Haha, funny kid. {p}')],
    bad: [L('ไม่ลด! ไม่ซื้อก็ไป!', "No discount! Don't buy then!"), L('ขึ้นราคา! {p}', 'Price up! {p}')],
    sweetFail: [L('ปากหวานไม่ช่วยหรอก {p}', "Sweet talk won't help. {p}")],
  },
  polite_hia: {
    good: [L('อาตี๋พูดจาดี เฮียให้ {p}', 'Polite kid, {p} for you'), L('เอาๆ {p} ถือว่าเปิดร้าน', 'OK, {p}, first sale of the day')],
    bad: [L('พูดไม่เพราะ เฮียไม่ลด {p}', 'Rude. No discount. {p}'), L('ไม่มีมารยาท! {p}', 'No manners! {p}')],
  },
  gruff_uncle: {
    good: [L('เออ… {p} พอ', 'Yeah… {p} then'), L('ลดได้แค่นี้แหละ {p}', "That's the most I can do: {p}")],
    bad: [L('บอกแล้วว่าต่อไม่ได้! {p}', 'Told you, no haggling! {p}'), L('ไปซื้อที่อื่นไป! {p}', 'Go buy elsewhere! {p}')],
  },
  business_jeh: {
    good: [L('โอเคค่ะ {p} ราคาพิเศษ', 'OK, special price {p}')],
    bad: [L('ไม่ได้ค่ะ ราคานี้ต้นทุนแล้ว {p}', "Can't, that's cost price. {p}")],
  },
  robot_clerk: {
    good: [L('ราคาตามระบบค่ะ', 'The price is set by the system.')],
    bad: [L('ราคาตามระบบค่ะ ขอบคุณค่ะ', 'The price is set by the system. Thank you.')],
  },
  cashier: {
    good: [L('ราคาส่งแล้วค่ะ… โอเค ลดให้ {p}', 'Already wholesale… OK, {p}')],
    bad: [L('ราคาส่งแล้วค่ะ ลดไม่ได้จริงๆ {p}', "It's wholesale price, really can't. {p}")],
  },
  _: { good: [L('{p} ก็ได้', '{p} then')], bad: [L('ไม่ลด {p}', 'No. {p}')] },
};

export const ROBOT_NO_BARGAIN: Pool = [L('ราคาตามระบบค่ะ', 'The price is set by the system.'), L('ราคาตามระบบค่ะ 😊', 'The price is set by the system :)'), L('…ราคาตามระบบค่ะ', '…the price is set by the system.')];
export const FINAL: Pool = [L('ขาดตัว {p} บาท! ห้ามต่อแล้ว', 'Final: {p}. No more haggling!'), L('เอา {p} นะ จบ!', '{p}. Done!')];
export const TIMEOUT: Pool = [L('ว่าไง? จะเอาไม่เอา', 'Well? Buying or not?'), L('เงียบทำไม?', 'Why so quiet?')];
export const AGAIN: Pool = [L('ต่อไปแล้วไง! จะเอาไม่เอา', 'You already haggled! Take it or leave it')];
export const BUSY: Pool = [L('รอแป๊บนะ คุยกับลูกค้าอยู่', 'Wait a sec, serving someone')];
export const NOTHING: Pool = [L('ยังไม่ได้หยิบอะไรเลยนี่', "You haven't picked anything")];

// ------------------------------------------------------------------ paying
export const THANKS: Record<string, Pool> = {
  soft_auntie: [L('ขอบใจจ้ะ ไว้มาอีกนะ', 'Thanks dear, come again'), L('ขอให้ขายดีๆ นะลูก', 'May you sell lots!')],
  chatty_auntie: [L('ขอบใจจ้า! ไว้มาเม้าท์กันอีกนะ', 'Thanks! Come gossip again')],
  stingy_uncle: [L('เออ ขอบใจ', 'Yeah. Thanks.')],
  polite_hia: [L('ขอบคุณครับ ขอให้รวยๆ', 'Thank you, get rich!')],
  gruff_uncle: [L('เออ', 'Yeah.')],
  business_jeh: [L('ขอบคุณค่ะ', 'Thank you')],
  robot_clerk: [L('ขอบคุณค่ะ', 'Thank you')],
  cashier: [L('ขอบคุณที่ใช้บริการค่ะ', 'Thank you for shopping')],
  _: [L('ขอบใจจ้า', 'Thanks!')],
};
export const BROKE: Pool = [L('เงินไม่พอนะ{c} เอาของไปคืนบ้าง', "Not enough money — put something back"), L('ขาดอีก {p} บาทนะ', "You're {p} short")];
export const ASK_BAG: Record<string, TL> = { robot_clerk: L('รับถุงไหมคะ ใบละ 1 บาทค่ะ', 'Bag? 1 baht each'), _: L('ใส่ถุงไหมจ๊ะ', 'Want a bag?') };
export const BAG_OPTS: TL[] = [L('ใส่ถุงเลย', 'Bag it'), L('ไม่ต้อง ลดโลกร้อน', 'No thanks, save the planet')];
export const ASK_SALAPAO = L('รับซาลาเปาเพิ่มไหมคะ', 'Would you like a steamed bun with that?');
export const SALAPAO_OPTS: TL[] = [L('ไม่รับครับ', 'No thanks'), L('รับ! (+15 ฿)', 'Yes! (+15 ฿)')];
export const ASK_DELIVER = L('ของใหญ่ ให้ไปส่งที่ร้านไหม 20 บาท', 'Big stuff — deliver to your cart for 20?');
export const DELIVER_OPTS: TL[] = [L('ส่งเลย (+20 ฿)', 'Deliver (+20 ฿)'), L('แบกเองครับ', "I'll carry it")];
export const DELIVERED: Pool = [L('ของมาส่งแล้วจ้า!', 'Delivery!')];
export const NO_ALCOHOL = L('ขออภัยค่ะ ขายแอลกอฮอล์ได้ 11–14 น. และ 17–24 น. ค่ะ', 'Sorry, alcohol only 11–14 & 17–24');
export const SWAP_TANK: Pool = [L('ถังเปล่าเอามาแลก เหลือ {p}', 'Swapped your empty tank: {p}')];
export const PUT_BACK: Pool = [L('เอาคืนเหรอ ได้ๆ', 'Putting it back? OK'), L('ไม่เอาแล้วเหรอ', "Don't want it?")];
export const DROPPED: Pool = [L('อย่าทำของป้าหล่นสิ!', "Don't drop my stuff!"), L('เดี๋ยวเก็บคืนเอง', "I'll put it back myself")];
export const SOLD_OUT: Pool = [L('หมดแล้วจ้า พรุ่งนี้มาใหม่', 'Sold out, come tomorrow')];
export const NEW_STOCK: Pool = [L('ของใหม่มาแล้วจ้า!', 'New stuff just arrived!')];

// ------------------------------------------------------------------ hours
export const CLOSED: Record<string, Pool> = {
  stall: [L('ตลาดวายแล้ว พรุ่งนี้มาใหม่นะ', 'Market’s over, come tomorrow'), L('ปิดแล้วจ้า ป้าจะนอน', 'Closed, auntie wants to nap')],
  _: [L('ปิดแล้ว! พรุ่งนี้มาใหม่', 'Closed! Come back tomorrow')],
};
export const CLOSING_SOON: Pool = [L('จะปิดแล้วนะ จ่ายมาเร็วๆ', 'Closing soon, pay quick!')];
export const OPENING: Pool = [L('เปิดร้านแล้วจ้า!', 'Open for business!')];
export const NAP: Pool = [L('ครอก… ฟี้…', 'Zzz…'), L('ครอกกก…', 'Snore…')];
export const WOKE: Pool = [L('ห๊ะ! อะไร! ตกใจหมด!', 'Huh?! You scared me!'), L('อุ๊ย! หลับไปแป๊บเดียวเอง', 'Oops, just a tiny nap')];

// ------------------------------------------------------------------ MAD SYSTEM
export const MAD_LEAVE: Record<string, Pool> = {
  robot_clerk: [L('ติ๊ดๆๆ! ขออภัยค่ะ กรุณาชำระเงินก่อนค่ะ!', 'BEEP! Please pay first!')],
  _: [L('เฮ้ย! ยังไม่จ่าย!', "HEY! You haven't paid!"), L('เดี๋ยวๆๆ! ของยังไม่ได้จ่ายตังค์!', "Wait wait! That's not paid!"), L('จะไปไหน! จ่ายเงินก่อน!', 'Where are you going?! Pay first!')],
};
export const WARN_LEAVE: Pool = [L('จะไปไหนจ๊ะ ยังไม่จ่ายเงินนะ', "Where to? You haven't paid")];
export const MAD_RUDE: Pool = [L('พอเลย! ไม่ขายแล้ว!', "That's it! Not selling!"), L('ไปซื้อที่อื่นเลยไป!', 'Go buy somewhere else!')];
export const MAD_DEBT: Pool = [L('เงินป้าล่ะ!!!', 'WHERE IS MY MONEY!!!'), L('ไหนว่าจะคืนวันนี้!', 'You said you’d pay today!')];

/** Mad-system reply sets: one right answer (index 0 before shuffling) per situation and personality. */
export interface MadSet { right: TL[]; wrong: TL[] }
export const MAD_OPTS: Record<'leave' | 'rude' | 'debt', Record<string, MadSet>> = {
  leave: {
    robot_clerk: { right: [L('ขอโทษครับ ลืมจริงๆ จ่ายเลยครับ', 'Sorry, forgot! Paying now')], wrong: [L('ผมเป็นเพื่อนผู้จัดการนะ', "I'm the manager's friend"), L('ของฟรีไม่ใช่เหรอครับ', "Isn't it free?"), L('วิ่ง!!!', 'RUN!!!')] },
    soft_auntie: { right: [L('ขอโทษครับป้า ลืมจ่าย! จ่ายเลยครับ', 'Sorry auntie, forgot! Paying now'), L('ป้าคนสวย ผมแค่ลืม จ่ายเลยครับ', 'Pretty auntie, I just forgot, paying!')], wrong: [L('ของฟรีไม่ใช่เหรอครับ', "Isn't it free?"), L('ยืมไปก่อน เดี๋ยวเอามาคืน', "Just borrowing, I'll bring it back"), L('วิ่ง!!!', 'RUN!!!')] },
    stingy_uncle: { right: [L('ขอโทษครับลุง ลืมจริงๆ จ่ายเลย', 'Sorry uncle, really forgot, paying')], wrong: [L('ลุงใจดีจัง ให้ฟรีเหรอครับ', "So kind, it's free?"), L('ไปเอาเงินที่รถแป๊บ', 'Getting money from the cart…'), L('วิ่ง!!!', 'RUN!!!')] },
    _: { right: [L('ขอโทษครับ ลืมจ่าย! จ่ายเลยครับ', 'Sorry! Forgot to pay! Paying now')], wrong: [L('ของฟรีไม่ใช่เหรอครับ', "Isn't it free?"), L('เดี๋ยวมาจ่ายพรุ่งนี้', "I'll pay tomorrow"), L('วิ่ง!!!', 'RUN!!!')] },
  },
  rude: {
    _: { right: [L('ขอโทษครับ ผมปากไม่ดีเอง', 'Sorry, I have a big mouth')], wrong: [L('ก็มันแพงจริงนี่', "But it IS expensive"), L('ใจร้อนจังเลย', 'So hot-tempered'), L('ไม่ขายก็ไม่ง้อ!', "Fine, who needs you!")] },
  },
  debt: {
    _: { right: [L('นี่ครับป้า คืนเลยครับ', 'Here, paying you back now')], wrong: [L('พรุ่งนี้นะป้า พรุ่งนี้แน่นอน', 'Tomorrow, auntie, for sure'), L('ป้าครับ หมากินเงินไปแล้ว', 'Auntie, a dog ate the money'), L('ใครยืมครับ? จำไม่ได้', 'Who borrowed? Don’t remember')] },
  },
};
export const MAD_CALM: Record<string, Pool> = {
  leave: [L('เออ! คราวหน้าอย่าลืมอีกนะ', "Fine! Don't forget next time")],
  rude: [L('เออ รู้ตัวก็ดี ราคาเดิมนะ', 'At least you know it. Normal price.')],
  debt: [L('เออ! ดีมาก คนรักษาคำพูด', 'Good! A person of their word')],
};
export const MAD_ANGRY: Record<string, Pool> = {
  robot_clerk: [L('ระบบไม่อนุญาตให้ขายค่ะ วันนี้ห้ามเข้าร้านนะคะ', 'The system won’t allow sales. You’re banned today.')],
  _: [L('ไอ้หัวขโมย! อย่าให้เห็นหน้าอีกนะ!', 'Thief! Never show your face again!'), L('ไม่ขายให้แล้ววันนี้! ไปไกลๆ!', 'Not selling to you today! Get lost!')],
};
export const BANNED: Pool = [L('ไม่ขาย! ไปไกลๆ!', 'Not selling! Go away!'), L('ยังมีหน้ามาอีกเหรอ!', 'You dare come back?!')];
export const SLAP_POP = 'เพี๊ยะ!';

// ------------------------------------------------------------------ CREDIT (Day 1)
export const CREDIT_ASK = L('แปะโป้งไว้ก่อนได้ไหมป้า', 'Can I put it on credit?');
export const CREDIT_YES: Pool = [L('โธ่ หมากินหมดเลยใช่ไหม… เออ ติดไว้ก่อน! พรุ่งนี้เอามาคืนนะ', 'Oh, the dog ate it all? Fine, on credit — pay me tomorrow!'), L('ป้าจดไว้แล้วนะ {d} บาท ห้ามเบี้ยว!', "I've written it down: {d}. Don't skip out!")];
export const CREDIT_NO: Pool = [L('ติดได้ทีเดียวพอ! ครั้งนี้จ่ายสด', 'Credit only once! Cash this time')];
export const CREDIT_OFFER: Pool = [L('มาจ้ะหนู ป้าได้ข่าวแล้ว หมาข้างทางกินข้าวหมดเลยใช่ไหม', 'Come, dears, I heard the street dog ate everything'), L('ไม่มีตังค์ไม่เป็นไร ติดป้าไว้ก่อน', 'No money? Put it on my tab')];
export const DEBT_REMIND1: Pool = [L('อย่าลืมเงินป้านะ {d} บาท!', "Don't forget my {d} baht!")];
export const DEBT_REMIND2: Pool = [L('วันนี้ต้องคืนเงินป้าแล้วนะ {d} บาท!', 'Today you pay me back, {d} baht!')];
export const DEBT_MARCH: Pool = [L('ไหนล่ะเงินป้า!? ป้ามาทวงถึงร้านแล้วนะ!', "Where's my money?! I came all the way to your cart!"), L('{d} บาท! คืนมาเดี๋ยวนี้!', '{d} baht! Now!')];
export const DEBT_REPAID: Pool = [L('ครบแล้ว! ไว้มาอุดหนุนป้าอีกนะ', 'All paid! Come buy from me again'), L('เออ! ดีมาก คนรักษาคำพูด ป้าชอบ', 'Good! I like people who keep their word')];
export const DEBT_PART: Pool = [L('ยังขาดอีก {d} บาทนะ', 'Still {d} baht to go')];
export const DEBT_FUNNY_ONCE = L('ฮ่าๆๆ หมากินเงิน! เอาเถอะ ให้อีกวัน', 'Hahaha, a dog ate the money! Fine, one more day');

// ------------------------------------------------------------------ 8-Twelve
export const DOOR_IN = L('สวัสดีค่ะ ยินดีต้อนรับค่ะ', 'Hello, welcome!');
export const DOOR_OUT = L('ขอบคุณค่ะ', 'Thank you');
export const GOSSIP_PAIRS: [TL, TL][] = [
  [L('เจ๊ศรี เมื่อคืนดูละครไหม', 'Sri, watch the soap last night?'), L('ดูสิ! นางร้ายตบนางเอกสามที!', 'Of course! The villain slapped her three times!')],
  [L('หมูขึ้นราคาอีกแล้วนะ', 'Pork went up again'), L('ทุกอย่างขึ้นหมด ยกเว้นเงินเดือน', 'Everything goes up except salaries')],
  [L('พวกเด็กใหม่ที่ซื้อรถเข็นลุงน่ะ', 'Those new kids with the old cart…'), L('ผัดกะเพราจะรอดไหมเนี่ย', 'Will their kaphrao survive?')],
];

export function fill(t: TL, v: Record<string, string | number>): TL {
  const rep = (s?: string) => s?.replace(/\{(\w)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
  return { th: rep(t.th)!, en: rep(t.en) };
}

export function pickLine(pool: Pool | undefined, fallback: Pool, r = Math.random): TL {
  const p = pool && pool.length ? pool : fallback;
  return p[Math.floor(r() * p.length) % p.length];
}
