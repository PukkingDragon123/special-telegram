import { tl, TL } from '../../core/util';

/* All intro text (Thai first, short English gloss). Old-man lines adapted from references/culture/lines.json. */

export const pick = <T>(a: T[], i?: number): T => a[(i ?? Math.floor(Math.random() * a.length)) % a.length];

export const OLDMAN_NAME = tl('ลุงเฮง', 'Uncle Heng');

const COUNT_TH = ['', 'หนุ่มหล่อหนึ่งคน (เพื่อนเท)', 'สองหนุ่ม', 'สามหนุ่ม', 'สี่หนุ่ม'];
const COUNT_EN = ['', 'One handsome guy (friends bailed)', 'Two guys', 'Three guys', 'Four guys'];

/** Casino subtitles. n = number of players (1–4). */
export const CASINO = {
  open: tl('เมื่อคืนนี้… บ่อนชายแดน', 'Last night… a casino on the border'),
  walk: (n: number) => tl(`${COUNT_TH[Math.max(1, Math.min(4, n))]} สูทเช่า เงินเก็บทั้งชีวิต`, `${COUNT_EN[Math.max(1, Math.min(4, n))]}. Rented suits. Life savings.`),
  bet: tl('ลงหมดหน้าตัก… ใบสุดท้าย', 'All of it on the table… the last card'),
  win: tl('แบล็คแจ็ค!! รวยแล้วโว้ย!!', 'BLACKJACK!! WE\'RE RICH!!'),
  slowmo: tl('ช่วงเวลาที่ดีที่สุดในชีวิต…', 'The best moment of our lives…'),
  drink: tl('อีกแก้ว! อีกแก้ว! เจ้ามือเลี้ยง!', 'One more! One more! The house is buying!'),
  allin: tl('เอาให้สุด! ลงเลข 17 ทั้งหมด!', 'Go big! Everything on 17!'),
  spin: tl('17… 17… 17…', '17… 17… 17…'),
  lose: tl('…ศูนย์เขียว เจ้ามือกินเรียบ', '…green zero. The house takes it all.'),
  black: tl('แล้วหลังจากนั้น… ก็จำอะไรไม่ได้อีกเลย', 'And after that… we remember nothing.'),
  morning: tl('เช้าวันต่อมา…', 'The next morning…'),
  skip: 'กดค้าง',
  skipTail: 'เพื่อข้าม',
};

/** Speech bubbles in the casino (3D, above heads). */
export const CASINO_SHOUTS: TL[] = [tl('เฮ้!!', 'Hey!!'), tl('รวยแล้ว!', 'Rich!'), tl('เจ้ามือเลี้ยง!', 'On the house!'), tl('ฮิ๊ก!', 'hic!')];

export const WAKE = {
  thoughts: [tl('โอ๊ย… หัวจะแตก…', 'Ugh… my head…'), tl('เมื่อคืนเกิดอะไรขึ้น…', 'What happened last night…'), tl('สูทกูหายไปไหน?!', 'Where did my suit go?!'), tl('กระเป๋าตังค์… มีแต่เหรียญ', 'Wallet… just coins')],
  seeCart: [tl('รถเข็นใครจอดทิ้งไว้…', 'Whose cart is that…'), tl('เข็นไปขายได้กี่บาทวะ…', 'How much could we get for that cart…'), tl('หิว… ไปดูรถเข็นนั่นกัน', 'Hungry… let\'s check out that cart')],
};

export const OLD = {
  zzz: tl('Zzz…', 'Zzz…'),
  catch: [tl('เฮ้ย! ไอ้หนู! จะเข็นไปไหน!', 'Hey! Boys! Where are you pushing that!'), tl('ตัวโตกันเท่าควาย มาขโมยรถเข็นคนแก่!', 'Big as buffaloes, stealing an old man\'s cart!')],
  excuse: [tl('เปล่าครับลุง แค่… ช่วยเข็นให้', 'No uncle, we were just… helping push it'), tl('นึกว่าไม่มีเจ้าของครับ', 'We thought it had no owner'), tl('ทางลาดครับ มันไหลมาเอง', 'It\'s a slope, it rolled by itself')],
  look: tl('แต่งตัวงี้… หมดตัวมาจากบ่อนล่ะสิ', 'Dressed like that… lost it all at the casino, huh?'),
  offer1: tl('เอางี้ ลุงแก่แล้ว ผัดไม่ไหวแล้ว…', 'Tell you what. I\'m old, can\'t cook anymore…'),
  offer2: tl('ลุงขายให้ ร้อยบาทพอ! ได้ทั้งรถเข็น กระทะ สมุดสูตรลับ', 'I\'ll sell it to you — one hundred baht! Cart, wok and my secret recipe book'),
  pay: (paid: number) => tl(`เหรียญมาเลย… ${paid}/100 ฿`, `Coins, please… ${paid}/100 ฿`),
  thanks: [tl('อือ… เหรียญบาทเยอะจริง', 'Hmm… so many one-baht coins'), tl('ขาดอีกนิดเดียว', 'Almost there'), tl('นับดีๆ นะ ลุงตาไม่ดี', 'Count properly, my eyes are bad')],
  full: tl('ร้อยพอดีเป๊ะ! ฟ้าลิขิต!', 'Exactly a hundred! It\'s fate!'),
  wise: tl('จำไว้นะไอ้หนู… การพนันไม่เคยทำให้ใครรวย แต่กะเพราทำได้', 'Remember, boys… gambling never made anyone rich. Kaphrao can.'),
  handover: tl('สมุดอยู่บนรถ ข้าว หมูสับ กะเพรา ลุงทิ้งไว้ให้ ดูแลมันดีๆ นะ', 'The book\'s on the cart, rice, pork, basil too. Take good care of her.'),
  bye: tl('ลุงไปเกษียณละ… โชคดีนะไอ้หนู!', 'I\'m off to retire… good luck, boys!'),
  dog: tl('ฮ่าๆ หมาตัวนั้นมันขโมยของลุงทุกวัน! ไปตลาดป้าแดงสิ ป้าแกให้เชื่อได้!', 'Haha, that dog robs me every day! Go to Auntie Daeng at the market — she gives credit!'),
  noCoins: tl('ไม่มีตังค์ก็ไปค้นกระเป๋าดูก่อน', 'No money? Check your pockets first'),
};

export const PLAYER = {
  coins: [tl('ค้นกระเป๋า… เจอเหรียญ!', 'Checking pockets… coins!'), tl('ยี่สิบ… แล้วก็เหรียญบาทอีกห้าเหรียญ', 'Twenty… and five one-baht coins'), tl('สามสิบ… บวกเหรียญห้าที่เจอในรองเท้า', 'Thirty… plus a five I found in my shoe')],
  starter: [tl('มีสมุดสูตรด้วย!', 'There\'s a recipe book!'), tl('ข้าว หมูสับ กะเพรา… ครบ!', 'Rice, pork, basil… all here!'), tl('รวยแล้วโว้ย… อีกรอบ', 'We\'re rich… again')],
  dog: [tl('หมาาาาา!!', 'DOOOG!!'), tl('หมูสับกู!!', 'MY PORK!!'), tl('ไอ้หมา! คายออกมา!', 'Dog! Spit it out!'), tl('ข้าวหมดหม้อเลย…', 'The whole pot of rice…')],
  market: [tl('ต้องไปตลาด… หาป้าแดง', 'Gotta go to the market… find Auntie Daeng'), tl('ตลาดอยู่ทางไหนวะ… ตามลูกศรชอล์กไป', 'Which way is the market… follow the chalk arrows')],
};

export const HINTS = {
  book: tl('ลองเปิดสมุดสูตรของลุงดู… [F]', 'Read the old man\'s recipe book… [F]'),
  cook: tl('จุดเตา ตั้งกระทะ ผัดกะเพรากันเถอะ!', 'Light the burner and stir-fry some kaphrao!'),
  sign: tl('เปิดป้ายร้าน… ให้ลูกค้ารู้ว่าเปิดแล้ว', 'Flip the shop sign so customers know we\'re open'),
  serve: tl('ยกจานไปเสิร์ฟลูกค้าเลย!', 'Take the plate to a customer!'),
};

export const CART_LABEL = { push: tl('เข็นไปเลย!', 'push it away!'), notYours: tl('รถของคนอื่น', 'not your cart'), give: tl('ให้เหรียญลุง', 'give coins') };
