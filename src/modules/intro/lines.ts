import { tl, TL } from '../../core/util';

/* ============================================================================================
 * All intro / tutorial text (Thai first, English gloss). Thai street register: the old man and the
 * broke gang swear like real people in a soi (เชี่ย แม่ง ไอ้บ้า ไอ้เวร ห่าเอ๊ย ไอ้ควาย ไอ้ลูกหมา…),
 * comedic and everyday — never slurs about ethnicity / religion / disability, nothing sexual.
 * ========================================================================================== */

export const pick = <T>(a: T[], i?: number): T => a[(i ?? Math.floor(Math.random() * a.length)) % a.length];

export const OLDMAN_NAME = tl('ลุงเฮง', 'Uncle Heng');

const COUNT_TH = ['', 'หนุ่มหล่อหนึ่งคน (เพื่อนเท)', 'สองหนุ่ม', 'สามหนุ่ม', 'สี่หนุ่ม'];
const COUNT_EN = ['', 'One handsome guy (friends bailed)', 'Two guys', 'Three guys', 'Four guys'];

/** Casino subtitles (used by the casino scene). n = number of players (1–4). */
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
  morning: tl('ตีสาม…', '3 AM…'),
  skip: 'กดค้าง',
  skipTail: 'เพื่อข้าม',
};

/** Speech bubbles in the casino (3D, above heads). */
export const CASINO_SHOUTS: TL[] = [tl('เฮ้!!', 'Hey!!'), tl('รวยแล้ว!', 'Rich!'), tl('เจ้ามือเลี้ยง!', 'On the house!'), tl('ฮิ๊ก!', 'hic!')];

// =============================================================================================
// 1. WAKE — 03:00, still dark
// =============================================================================================

export const WAKE = {
  card: tl('ตีสาม · ซอยหลังตลาด', '3:00 AM · the soi behind the market'),
  cardSub: tl('ราคาของความรวย: หมดตัว', 'The price of being rich: everything'),
  /** inner monologue, in order, per player slot (the owner sees subtitles, friends see clouds) */
  mono: [
    [tl('โอ๊ย… หัวจะระเบิด… ใครเอาค้อนมาทุบหัวกูวะ', 'Ugh… my head… who took a hammer to my skull'),
      tl('ตีสาม?! ยังมืดอยู่เลย… หนาวสัส', '3 AM?! Still pitch dark… freezing my ass off'),
      tl('สูทหาย เงินหาย เหลือกางเกงในลายสก๊อตตัวเดียว… ชีวิตแม่งดีจริงๆ', 'Suit gone, money gone, just plaid boxers left… life is f—ing great')],
    [tl('ฮึ่ย… ปากเหม็นเหล้าขาว…', 'Ugh… my breath is pure rice whisky…'),
      tl('นอนบนฟุตบาทกับลังกระดาษ… ระดับมหาเศรษฐีเลยนะเรา', 'Sleeping on a sidewalk on cardboard… billionaire lifestyle'),
      tl('เลข 17… ทำไมต้องเลข 17 วะ ไอ้บ้า!', '17… why the hell did I bet on 17, idiot!')],
    [tl('ใครปิดไฟ… อ้อ ฟ้ามันยังไม่สว่าง', "Who turned off the lights… oh, it's still night"),
      tl('ยุงกัดทั้งตัว… ยุงยังรวยกว่ากูอีก', 'Mosquitoes everywhere… even they ate better than me'),
      tl('ห่าเอ๊ย… กลับบ้านยังไงวะ ค่ารถก็ไม่มี', "Damn it… how do I get home, can't even pay the bus")],
    [tl('ฝันว่ารวย… ตื่นมาจนกว่าเดิม', 'Dreamt I was rich… woke up poorer'),
      tl('รองเท้าแตะคนละสี… ใครเปลี่ยนให้กูวะ', 'Mismatched flip-flops… who swapped them'),
      tl('ต้องหาทางรวยใหม่… ก่อนพระอาทิตย์ขึ้น', 'Gotta get rich again… before sunrise')],
  ] as TL[][],
  seeCart: tl('เดี๋ยวนะ… รถเข็นตามสั่งคันนั้น… ลุงแกหลับปุ๋ยเลย', 'Wait… that food cart… the old man is out cold'),
  plan: tl('เข็นไปขายต่อ ได้ซักพันมั้ง… ขอโทษนะลุง ชีวิตมันบีบ', "Push it off, sell it, a grand maybe… sorry uncle, life's squeezing me"),
  planFriend: tl('เฮ้ย… พวกเรา… รถเข็นคันนั้น…', 'Psst… guys… that cart over there…'),
};

// =============================================================================================
// 2. SNEAK — objective: steal the old man's cart
// =============================================================================================

export const SNEAK = {
  obj: tl('ขโมยรถเข็นของลุง', "Steal the old man's food cart"),
  sub: tl('ย่อตัว [C] เดินเบาๆ อย่าให้ลุงตื่น · ถึงรถแล้วกด [E]', "Crouch [C], walk softly, don't wake him · [E] at the cart"),
  approach: [tl('ใจเย็นๆ… ทำเหมือนในหนังปล้นธนาคาร', 'Easy… just like a bank heist movie'), tl('ย่องๆๆ… กูคือนินจาแห่งซอยสาม', 'Sneak sneak… I am the ninja of Soi 3'), tl('ถ้าโดนจับ… บอกว่าละเมอแล้วกัน', "If I get caught… I'll say I was sleepwalking"), tl('เงียบไว้… เหมือนตอนเดินผ่านเจ้าหนี้', 'Quiet… like walking past a loan shark')],
  near: [tl('ลุงกรนดังกว่าเครื่องปั่นไฟอีก', 'He snores louder than a generator'), tl('หลับลึกขนาดนี้ โจรขนบ้านไปลุงก็ไม่ตื่น', 'Sleeping this deep, thieves could take his whole house'), tl('ขอโทษนะลุง… พรุ่งนี้ผมจะไหว้ศาลพระภูมิให้', "Sorry uncle… I'll pray at the spirit house tomorrow")],
  running: [tl('เชี่ย! เบาๆ ไอ้ควาย!', 'Shit! Quiet, you buffalo!'), tl('รองเท้าแตะแม่งเสียงดังฉิบหาย', 'These flip-flops are loud as hell'), tl('วิ่งทำไมวะ! นี่ปล้นนะ ไม่ใช่วิ่งมาราธอน!', "Why am I running! It's a heist, not a marathon!")],
  idle: [tl('จะยืนเฉยทำห่าอะไร ไปสิ!', 'What the hell am I standing around for, go!'), tl('พระอาทิตย์ขึ้นเมื่อไหร่ ซวยแน่', "Once the sun's up, I'm screwed"), tl('คิดมาก… ทำไปเลย ไอ้ขี้ขลาด', 'Overthinking… just do it, coward')],
  sky: [tl('ดาวสวยดี… แต่กินไม่ได้', "Nice stars… can't eat them though"), tl('พระจันทร์ยังจนกว่ากู… ไม่มีแม้แต่รองเท้าแตะ', "Even the moon's broker than me… no flip-flops at all")],
  crouch: [tl('ย่อแบบนี้ปวดเข่าฉิบ…', 'Crouching like this kills my knees…'), tl('เหมือนแมว… แมวอ้วนๆ ที่หมดตัว', 'Like a cat… a fat, broke cat')],
  dog: [tl('หมาอย่าเห่านะ… ขอร้อง… พรุ่งนี้ให้กระดูก', "Dog, don't bark… please… bone tomorrow, promise")],
  stir: [tl('อืมม… หมูสับ… ห้าบาท…', 'Mmm… minced pork… five baht…'), tl('ใครน่ะ… เมียเหรอ… ไม่ใช่… ฝันไป', "Who's that… my wife… no… dreaming"), tl('ไฟแรงๆ… ไฟแรงสุด… ฟี้…', 'High heat… max heat… zzz…'), tl('อย่าแตะกระทะลุง… ฟี้…', "Don't touch my wok… zzz…")],
  stirThink: [tl('ชู่ววว! ลุงขยับ!', 'Shhh! He moved!'), tl('เชี่ยๆๆ ลุงจะตื่น!', "Shit shit shit, he's waking up!")],
  push: tl('เข็นหนีเลย!', 'push it away!'),
};

export const OLD_ZZZ = tl('Zzz…', 'Zzz…');

// =============================================================================================
// 3. CAUGHT — the squeak, the flashlight, the lecture
// =============================================================================================

export const CAUGHT = {
  squeak: tl('เอี๊ยดดด… ล้อซ้ายแม่งออด!!', 'SQUEEEAK… the damn left wheel!!'),
  shout: [tl('เฮ้ย!! ไอ้หัวขโมย!! วางรถกูเดี๋ยวนี้!!', 'HEY!! You little thief!! Hands off my cart!!'), tl('ตีสามมาขโมยรถเข็นคนแก่ ไอ้ลูกหมา!!', "Stealing an old man's cart at 3 AM, you little rat!!")],
  oops: [tl('…ซวยแล้วกู', "…I'm so screwed"), tl('เชี่ย… ตื่นแล้ว', 'Shit… he is awake'), tl('ไฟฉายแรงชิบ… ตาบอดแล้วกู', "That flashlight… I'm blind")],
  excusePrompt: tl('แก้ตัวเร็ว!', 'Quick, an excuse!'),
  excuses: [tl('ผมแค่… ช่วยเข็นให้ลุงครับ!', 'I was just… helping push it, uncle!'), tl('ผมละเมอครับ! ละเมอจริงๆ!', 'I was sleepwalking! Honest!'), tl('ใครขโมย? ลุงฝันไปเองแล้ว', "Steal? You're dreaming, old man")],
  excuseReply: [
    tl('ช่วยเข็น? ตีสาม? ช่วยเข็นไปขายร้านของเก่าเหรอ ไอ้เวร!', 'Helping? At 3 AM? Helping it to the junk shop, you jerk!'),
    tl('ละเมอแล้วเดินย่องเหรอ! ละเมอแบบนินจา! ไอ้บ้า!', 'Sleepwalking on tiptoe?! Ninja sleepwalking! You lunatic!'),
    tl('ฝันไปเองเหรอ!? เดี๋ยวลุงเอาไฟฉายฟาดหัวให้ตื่นทั้งคู่เลย!', "Dreaming?! I'll whack us both awake with this flashlight!"),
  ],
  excuseTimeout: tl('อึกอักๆ พูดไม่ออกเลยสิ ห่าเอ๊ย', 'Lost for words, huh? Damn it'),
  lecture: [
    tl('ดูสภาพ! เสื้อกล้าม กางเกงในลายสก๊อต รองเท้าแตะคนละสี…', 'Look at you! Singlet, plaid boxers, mismatched flip-flops…'),
    tl('หมดตัวมาจากบ่อนชายแดนล่ะสิ! กลิ่นเหล้ายังติดตัวอยู่เลย!', 'Lost everything at the border casino, huh?! You still reek of whisky!'),
    tl('พ่อแม่ส่งเรียนจนจบ ให้มาเป็นโจรขโมยรถเข็นเนี่ยนะ! ไอ้ควาย!', 'Your parents paid for school so you could steal food carts?! Buffalo!'),
  ],
  soften: tl('เฮ้อ… ลุงก็เคยโง่แบบนี้แหละ สมัยหนุ่มๆ เล่นไพ่หมดไปทั้งนา', 'Sigh… I was this stupid once. Lost a whole rice field to cards when I was young'),
  friendGasp: [tl('ซวยละ…', 'Uh-oh…'), tl('กูไม่รู้จักมันนะลุง!', "I don't know this guy, uncle!"), tl('วิ่ง!… ไม่ใช่ ไม่วิ่ง', 'Run!… no, no running')],
};

// =============================================================================================
// 4. DEAL — haggling + handshake
// =============================================================================================

export const DEAL = {
  open: tl('เอางี้… ลุงแก่แล้ว หลังจะหัก ผัดไม่ไหวแล้ว', "Here's the thing… I'm old, my back's shot, I can't cook anymore"),
  offer: tl('รถเข็นคันนี้ ลุงขายให้! ราคามิตรภาพ… ห้าพันบาท!', "I'll sell you this cart! Friendship price… five thousand baht!"),
  r1Prompt: tl('ห้าพันบาท!?', 'Five thousand?!'),
  r1: [tl('ห้าพัน!? รถสนิมเขรอะแบบนี้!?', 'Five grand?! For this rust bucket?!'), tl('ลุงครับ… ผมมีแต่เหรียญ', 'Uncle… all I have is coins'), tl('งั้นผมขโมยต่อละกัน', "Then I'll just keep stealing it")],
  r1Reply: [
    tl('สนิมนี่แหละความขลัง! สี่สิบปีนะเว้ย กะเพราผ่านกระทะใบนี้เป็นแสนจาน!', 'That rust is HERITAGE! Forty years! A hundred thousand plates went through this wok!'),
    tl('เหรียญก็เงินเว้ย! แต่ห้าพันเหรียญ ลุงนับถึงเที่ยง', "Coins are money too! But five thousand coins, I'd be counting till noon"),
    tl('กล้าพูดนะมึง! ลุงยังจับได้คาหนังคาเขาอยู่เลย!', "You've got some nerve! I literally just caught you red-handed!"),
  ],
  nag: [
    tl('สมัยลุงหนุ่มๆ กะเพราจานละห้าบาท ไข่ดาวแถมฟรี! เดี๋ยวนี้หมูสับโลละสองร้อย แก๊สถังละห้าร้อย! บ้าไปแล้ว!', 'In my day kaphrao was five baht and the egg was free! Now minced pork is 200 a kilo, gas 500 a tank! Madness!'),
    tl('เด็กสมัยนี้อยากรวยเร็ว เล่นบ่อน เล่นหุ้น เล่นคริปโต… ทำไมไม่มาผัดข้าวขายวะ!', 'Kids these days want to get rich quick — casinos, stocks, crypto… why not just sell fried rice, dammit!'),
  ],
  r2Prompt: tl('สามพัน! ต่ำกว่านี้ลุงไม่ไหว ล้อแท้จากญี่ปุ่นนะเว้ย', "Fine, three thousand! Can't go lower, genuine Japanese wheels!"),
  r2: [tl('ล้อซ้ายมันออดนะลุง ผมเพิ่งได้ยิน', 'The left wheel squeaks, uncle, I just heard it'), tl('ลดหน่อย ผมจะไหว้ลุงทุกเช้า', "Knock some off, I'll bow to you every morning"), tl('ห้าสิบบาท จบ!', 'Fifty baht, final!')],
  r2Reply: [
    tl('ออดก็เพราะมึงเข็นผิดท่า! …ก็ได้ๆ ลดก็ลด', "It squeaks 'cause you push it wrong! …fine, fine, I'll lower it"),
    tl('ไหว้แล้วได้อะไร ลุงไม่ใช่ศาลพระภูมินะเว้ย! …แต่ก็น่ารักดี', "What do I get from bows, I'm not a spirit house! …but that's sweet"),
    tl('ห้าสิบ!? ห้าสิบซื้อได้แค่ล้อ! ไอ้งก!', 'FIFTY?! Fifty buys you ONE wheel! You cheapskate!'),
  ],
  timeout: tl('เงียบทำไม! ต่อราคาไม่เป็นเหรอ ไอ้เด็กเมือง!', "Why so quiet! Can't haggle, city boy?!"),
  final: tl('เอางี้! เอาเงินในกระเป๋ามาให้หมด… แล้วมึงต้องเรียนผัดกะเพรากับลุงจนเป็น ห้ามเถียง!', "Deal: empty your pockets, every coin… and you learn to cook kaphrao from me properly. No arguing!"),
  shake: tl('ตกลง! จับมือ!', 'Deal! Shake on it!'),
  shakeThink: tl('มือลุงแข็งยังกับตะหลิว…', "His hand's as hard as a spatula…"),
  card: tl('ดีล!', 'DEAL!'),
  cardSub: tl('รถเข็นมือสอง · สภาพ 40 ปี · ล้อซ้ายออด', 'Second-hand cart · 40 years old · squeaky left wheel'),
};

// =============================================================================================
// 5. PAY — every coin in your pockets (the group holds exactly 100 ฿)
// =============================================================================================

export const PAY = {
  obj: (paid: number) => tl(`จ่ายเงินลุง · ${paid}/100 ฿`, `Pay the old man · ${paid}/100 ฿`),
  sub: tl('มองลุงแล้วกด [E] เพื่อให้เหรียญ', 'Look at him and press [E] to hand over your coins'),
  ask: (paid: number) => tl(`เอามา! ควักให้หมด… ${paid}/100 ฿`, `Hand it over! Every coin… ${paid}/100 ฿`),
  thanks: [tl('เหรียญบาทอีกแล้ว! ไปทุบกระปุกหมูใครมาวะ', "One-baht coins AGAIN! Whose piggy bank did you smash?"), tl('นับดีๆ นะ ลุงตาไม่ดี แต่ไม่ได้โง่นะเว้ย', "Count properly — my eyes are bad, I'm not stupid"), tl('เหรียญเหนียวๆ… อย่าบอกนะว่าเก็บจากใต้โต๊ะบ่อน', "Sticky coins… don't tell me you picked these up under a casino table")],
  noCoins: tl('ไม่มีตังค์ก็ไปค้นกระเป๋าดูก่อน ไอ้บ้า', 'No money? Check your pockets first, idiot'),
  full: tl('ร้อยพอดีเป๊ะ! ฟ้าลิขิต!… แต่รถยังไม่ใช่ของมึง จนกว่าจะผัดกะเพราเป็น!', "Exactly a hundred! It's fate!… but the cart isn't yours till you can cook kaphrao!"),
  coins: [tl('ค้นกระเป๋า… เจอเหรียญ!', 'Checking pockets… coins!'), tl('ยี่สิบ… แล้วก็เหรียญบาทอีกห้าเหรียญ', 'Twenty… plus five one-baht coins'), tl('สามสิบ… บวกเหรียญห้าที่เจอในรองเท้า', 'Thirty… plus a five I found in my shoe')],
  all: (n: number) => tl(`${n} บาท… หมดตัวแล้วจริงๆ นะ`, `${n} baht… that's literally everything`),
};

// =============================================================================================
// 6. LESSON — guided first kaphrao at the cart
// =============================================================================================

export type LessonStage = 'intro' | 'burner' | 'oil' | 'aroma' | 'pork' | 'stir' | 'season' | 'basil' | 'plate' | 'taste';

export interface StageText { obj: TL; sub: TL; say: TL; done: TL; slow: TL[] }

export const LESSON = {
  obj: tl('เรียนผัดกะเพรากับลุงเฮง', 'Learn kaphrao from Uncle Heng'),
  intro: [
    tl('ฟังนะไอ้หนู! กะเพราไม่ใช่แค่ผัดๆ แล้วจบ มันคือศิลปะ! มันคือชีวิต!', "Listen up, kid! Kaphrao isn't just tossing stuff in a pan. It's ART! It's LIFE!"),
    tl('ทำตามที่ลุงบอกทีละขั้น ผิดขั้นเดียว ลุงฟาดด้วยตะหลิว!', 'Follow me step by step. One mistake and I smack you with the spatula!'),
  ],
  stages: {
    burner: {
      obj: tl('จุดเตา', 'Light the burner'), sub: tl('มองลูกบิดเตาที่รถเข็น แล้วกด [E]', 'Look at the burner knob on the cart and press [E]'),
      say: tl('ขั้นแรก! จุดเตา! ลูกบิดตรงนั้น บิดเลย ไม่ต้องกลัว มันไม่ระเบิด… ส่วนใหญ่นะ', "Step one! Light the burner! That knob — turn it, don't be scared, it won't explode… usually"),
      done: tl('พรึ่บ! เสียงแบบนี้แหละ! ไฟต้องแรงเหมือนใจนักสู้!', "WHOOMPH! That's the sound! The flame must be strong like a fighter's heart!"),
      slow: [tl('บิดลูกบิดเตาไง ไอ้บ้า! ลูกบิดสีดำตรงนั้น!', 'Turn the knob, you lunatic! The black one, right there!'), tl('ยืนเกาตูดอยู่ได้ จุดเตาสิ!', 'Stop scratching your ass and light it!')],
    },
    oil: {
      obj: tl('ใส่น้ำมัน ~20 มล.', 'Add oil (~20 ml)'), sub: tl('หยิบขวดน้ำมัน [E] แล้วกดค้าง [LMB] ที่กระทะ', 'Pick up the oil bottle [E], hold [LMB] on the wok'),
      say: tl('น้ำมันนิดเดียวพอ! ยี่สิบมล. ไม่ใช่ทอดปาท่องโก๋!', "Just a splash! Twenty ml — we're not frying donuts!"),
      done: tl('ดี! รอให้ควันขึ้นนิดนึง… กระทะร้อนคือหัวใจ', 'Good! Let it smoke a little… a hot wok is the heart of it'),
      slow: [tl('ขวดน้ำมันอยู่บนชั้นรถเข็น! ตาไม่ดีเหรอ ลุงแก่กว่ายังเห็น!', "Oil's on the cart rack! I'm older and I can still see it!"), tl('เทน้ำมันลงกระทะ ไม่ใช่เทลงพื้น ไอ้ควาย!', 'Oil in the WOK, not on the floor, buffalo!')],
    },
    aroma: {
      obj: tl('กระเทียม + พริก ลงกระทะ', 'Garlic + chili into the wok'), sub: tl('หยิบกระเทียม / พริก [E] แล้วกดค้าง [LMB] ที่กระทะ', 'Pick up garlic / chili [E], hold [LMB] on the wok'),
      say: tl('กระเทียมพริกลงก่อน! ผัดแป๊บเดียว ไหม้แล้วขมเหมือนชีวิตลุง!', 'Garlic and chili first! Quick — burnt garlic is bitter like my life!'),
      done: tl('หอมไหม!? กลิ่นนี้แหละที่ทำให้คนทั้งซอยตื่น!', "Smell that?! That's the smell that wakes up the whole soi!"),
      slow: [tl('อีกอย่างด้วย! กระเทียมกับพริกเป็นผัวเมียกัน แยกกันไม่ได้!', "The other one too! Garlic and chili are husband and wife, you can't split them!"), tl('ช้าๆ แบบนี้ ลูกค้าตายก่อนได้กิน!', "This slow, the customers will die before they eat!")],
    },
    pork: {
      obj: tl('ใส่หมูสับ ~120 ก.', 'Add minced pork (~120 g)'), sub: tl('หยิบหมูสับ [E] แล้วกดค้าง [LMB] ที่กระทะ', 'Pick up the pork [E], hold [LMB] on the wok'),
      say: tl('หมูสับ! ร้อยยี่สิบกรัม ไม่ต้องเยอะ ลูกค้าไม่ใช่ญาติมึง!', "Minced pork! A hundred and twenty grams — the customers aren't your relatives!"),
      done: tl('ฉ่าาา! ได้ยินไหม ดนตรีของคนจน!', "Tsssshhh! Hear that? The music of the poor!"),
      slow: [tl('หมูสับอยู่ในถาดสแตนเลสนั่นไง! เร็วๆ!', "The pork's in the steel tray! Hurry!"), tl('กระเทียมจะไหม้แล้วเว้ย!', 'The garlic is going to burn, dammit!')],
    },
    stir: {
      obj: tl('ผัดจนหมูสุก', 'Stir-fry until the pork is cooked'), sub: tl('หยิบตะหลิว [E] แล้วกดค้าง [LMB] ที่กระทะ · [R] โยนกระทะ', 'Take the spatula [E], hold [LMB] on the wok · [R] to toss'),
      say: tl('ผัด! ผัด! ผัดดดด! ใช้ข้อมือ! ไม่ใช่ใช้ใจ!', 'Stir! Stir! STIR! Use your wrist, not your heart!'),
      done: tl('หายชมพูแล้ว ดีมาก! มือเริ่มเป็นแล้วนี่หว่า', "No more pink — good! Your hands are learning"),
      slow: [tl('ผัดสิวะ! ปล่อยไว้เดี๋ยวก็ไหม้ติดกระทะ!', "Stir it! Leave it and it'll weld to the wok!"), tl('ตะหลิวอยู่ข้างเตา! ข้างเตา!', "The spatula's next to the burner! NEXT TO IT!")],
    },
    season: {
      obj: tl('ปรุงรส: หอยนางรม + น้ำปลา', 'Season: oyster sauce + fish sauce'), sub: tl('ขวดซอสอยู่บนชั้นรถเข็น · หยิบ [E] กดค้าง [LMB] ที่กระทะ', 'Sauces are on the cart rack · take [E], hold [LMB] on the wok'),
      say: tl('ซอสหอยนางรม น้ำปลานิดๆ น้ำตาลหยิบมือ! เค็มนำ หวานตาม!', 'Oyster sauce, a little fish sauce, a pinch of sugar! Salty first, sweet behind!'),
      done: tl('ไฟพรึ่บ! หอมกระทะ! นั่นแหละความลับ!', "Flames! Wok hei! THAT is the secret!"),
      slow: [tl('ซอสไง ซอส! จะให้ลูกค้ากินหมูจืดๆ เหรอ!', 'Sauce! SAUCE! You want them eating bland pork?!'), tl('ขวดซอสเรียงอยู่ตรงนั้น อ่านภาษาไทยไม่ออกเหรอ!', "The bottles are lined up right there, can't you read Thai?!")],
    },
    basil: {
      obj: tl('ใบกะเพรา ใส่ท้ายสุด', 'Holy basil goes in last'), sub: tl('หยิบใบกะเพรา [E] แล้วกดค้าง [LMB] ที่กระทะ', 'Pick up the basil [E], hold [LMB] on the wok'),
      say: tl('กะเพรา! ใส่ตอนท้าย! คลุกสามวิพอ แล้วปิดไฟ!', 'Basil! At the very end! Toss three seconds, then flame off!'),
      done: tl('กลิ่นนี้…! น้ำตาลุงจะไหล…', "That smell…! I'm gonna cry…"),
      slow: [tl('ไม่ใส่กะเพรา ก็เรียกว่าหมูผัดซอสสิวะ!', "No basil and it's just pork in sauce, dammit!"), tl('ใบเขียวๆ ในถุงนั่นแหละ! เร็ว!', 'The green leaves in that bag! Quick!')],
    },
    plate: {
      obj: tl('ตักข้าว แล้วราดกะเพราใส่จาน', 'Rice on a plate, then the kaphrao on top'), sub: tl('หยิบจาน [E] → กดค้าง [LMB] ที่หม้อข้าว → [LMB] ที่กระทะ', 'Take a plate [E] → hold [LMB] at the rice pot → [LMB] at the wok'),
      say: tl('ข้าวลงจานก่อน! แล้วราดกะเพราลงไปให้สวยๆ ลูกค้ากินด้วยตาก่อน!', 'Rice on the plate first! Then the kaphrao on top, pretty — people eat with their eyes first!'),
      done: tl('จานแรกของมึง… ดูดีกว่าที่คิดนะเนี่ย', "Your first plate… looks better than I expected"),
      slow: [tl('จานอยู่ข้างหม้อข้าว! ตักข้าวก่อน!', "Plates are next to the rice pot! Rice first!"), tl('จะปล่อยให้กะเพราเย็นชืดเหรอ!', 'You gonna let it go cold?!')],
    },
  } as Record<string, StageText>,
  takeover: [tl('ช้าเป็นเต่าคลาน! หลบไป ลุงทำเอง!', "Slow as a crawling turtle! Move, I'll do it!"), tl('โอ๊ย ดูไม่ได้! เอามานี่ ลุงทำให้ดูทีเดียว!', "Ugh, I can't watch! Give it here, I'll show you once!"), tl('ห่าเอ๊ย ลุงแก่ตายพอดี! ดูนะ ทำแบบนี้!', "Damn it, I'll die of old age! Watch, like THIS!")],
  tooMuchOil: tl('พอๆๆ!! จะทอดตัวเองเหรอ ไอ้ควาย!', 'Stop stop stop!! You frying yourself, buffalo?!'),
  burn: tl('ไหม้!! ไหม้แล้วไอ้เวร! ผัดเร็วๆ หรี่ไฟ!', "BURNING!! It's burning, you idiot! Stir faster, lower the heat!"),
  noFire: tl('ไฟดับ! จะผัดด้วยพลังจิตเหรอ!', "The flame's off! You cooking with telepathy?!"),
  flare: tl('นั่นแหละ! ไฟลุกแบบนี้ ลูกค้าวิ่งมาเอง!', "THAT'S it! Flames like that bring customers running!"),
  salty: tl('เค็มยังกับน้ำทะเล! จะฆ่าลูกค้าเหรอ!', 'Salty as seawater! Trying to kill the customers?!'),
  nag: [tl('เร็วๆ หน่อย ฟ้าจะสว่างแล้ว!', "Hurry up, it's getting light!"), tl('สมัยลุง ลุงผัดสองกระทะพร้อมกัน มือเดียว!', 'In my day I worked two woks at once, one hand!'), tl('อย่ายืนเหม่อ! ลูกค้าตีห้าใจร้อน!', "Don't zone out! 5 AM customers have no patience!"), tl('ใจเย็นๆ… แต่มือต้องเร็ว', 'Calm heart… quick hands')],
  taste: tl('ไหน… ขอชิมคำนึง', "Let's see… one bite"),
  good: tl('อร่อยว่ะ!!… แต่ยังสู้ลุงไม่ได้หรอก ฮึ', "Damn, that's good!!… still not as good as mine, hmph"),
  ok: tl('ก็… กินได้ ลูกค้าตีห้าหิวจนไม่เลือกหรอก', "Well… edible. 5 AM customers are too hungry to care"),
  bad: tl('เชี่ย… อะไรวะเนี่ย… เอาเถอะ ลูกค้าคนแรกมันใจดี', "Shit… what the hell is this… whatever, the first customer is a kind soul"),
  proud: tl('ไม่เลว… ไม่เลวเลยไอ้หนู', 'Not bad… not bad at all, kid'),
};

// =============================================================================================
// 7. CUSTOMER — dawn, the first sale
// =============================================================================================

export const CUSTOMER = {
  name: tl('พี่วินเอก', 'Ek the moto-taxi guy'),
  obj: tl('เสิร์ฟลูกค้าคนแรก', 'Serve your first customer'),
  sub: tl('ถือจานกะเพรา แล้วมองพี่วิน กด [E]', 'Hold the plate, look at the moto-taxi guy, press [E]'),
  subPick: tl('หยิบจานกะเพราบนรถเข็น [E] ก่อน', 'Pick up the kaphrao plate from the cart [E] first'),
  oldSees: tl('นั่น! ลูกค้าคนแรก! วินมอไซค์ตีห้า หิวโซ ยิ้มให้เค้า อย่าทำหน้าเหมือนเพิ่งขโมยรถ!', "There! First customer! Moto-taxi guy, 5 AM, starving. Smile! Don't look like you just stole a cart!"),
  arrive: tl('ลุงเฮง! กะเพราหมูสับจานนึง… อ้าว ใครเนี่ย คนใหม่เหรอ?', "Uncle Heng! One kaphrao… oh, who's this, new guy?"),
  oldIntro: tl('ลูกศิษย์ใหม่! เพิ่งจับได้ว่าขโมยรถ… เอ้ย! เพิ่งรับมาฝึก!', 'My new apprentice! Just caught him stealing… I mean, just took him on!'),
  wait: [tl('น้อง… กะเพราพี่ได้ยัง หิวจนตาลายแล้ว', "Bro… my kaphrao? I'm seeing double"), tl('พี่ต้องไปรับลูกค้าหกโมงนะ', 'I gotta pick up a fare at six'), tl('กลิ่นหอมแต่ไม่ได้กิน ทรมานเว้ย', 'Smelling it without eating is torture')],
  serveLabel: tl('เสิร์ฟ', 'serve'),
  thanks: tl('ขอบใจน้อง!', 'Thanks, bro!'),
  good: tl('อร่อยเชี่ยๆ!! ไอ้น้อง พรุ่งนี้พี่มาอีกนะ!', "Damn delicious!! Kid, I'm coming back tomorrow!"),
  ok: tl('อื้ม… ใช้ได้ๆ ฝีมือยังอ่อนแต่ใจถึง', "Mm… not bad, your skills are raw but you've got guts"),
  bad: tl('แค่กๆ!… ก็… กินได้… มั้ง… ห้าสิบเอาไป', "Cough cough!… it's… edible… maybe… here's fifty"),
  pay: tl('ห้าสิบ ไม่ต้องทอน!', 'Fifty, keep the change!'),
  firstMoney: tl('เงินแรกของมึง! เก็บไว้ ห้ามเอาไปเล่นบ่อนอีกนะ ไอ้ลูกหมา!', 'Your first money! Keep it — and never take it back to a casino, you little rat!'),
  handover: tl('รถเข็นเป็นของมึงแล้ว… ดูแลมันดีๆ ล้อซ้ายหยอดน้ำมันด้วย', "The cart's yours now… treat her well, and oil that left wheel"),
  think: tl('เงินแรก… ห้าสิบบาท… หอมกว่าชิปบ่อนอีก', 'First money… fifty baht… smells better than casino chips'),
};

// =============================================================================================
// 8. DOG + MARKET
// =============================================================================================

export const DOG = {
  shout: [tl('หมาาาา!! ไอ้หมาเวร!!', 'DOOOG!! Damn dog!!'), tl('หมูสับกู!! คายออกมา!!', 'MY PORK!! Spit it out!!'), tl('ไอ้ด่าง! กูจะฆ่ามึง!', "Spot! I'm gonna kill you!"), tl('ข้าวหมดหม้อ… ชีวิตแม่ง…', 'The whole pot of rice… f— my life…')],
  laugh: tl('ฮ่าๆๆๆ ไอ้ด่างมันขโมยของลุงทุกเช้า! ยินดีด้วย มึงโดนรับน้องแล้ว!', 'HAHAHA! Spot robs me every morning! Congrats — that was your initiation!'),
  market: tl('ของหมดแล้วก็ไปตลาดสิ! หาป้าแดงแผงหมู ป้าแกให้เชื่อ บอกว่าลุงเฮงส่งมา!', "Out of stuff? Go to the market! Find Auntie Daeng at the pork stall, she gives credit — tell her Heng sent you!"),
  bye: tl('ลุงไปเกษียณละ… ไปนอนดูละครหลังข่าว ฮ่าๆ โชคดีนะไอ้หนู!', "I'm off to retire… soap operas after the news, haha. Good luck, kid!"),
  marketObj: tl('ไปตลาด หาป้าแดงแผงหมู', 'Go to the market — find Auntie Daeng'),
  marketSub: tl('ตามลูกศรชอล์กบนพื้นไป', 'Follow the chalk arrows on the ground'),
  think: [tl('ต้องไปตลาด… หาป้าแดง', 'Gotta go to the market… find Auntie Daeng'), tl('ตลาดอยู่ทางไหนวะ… ตามลูกศรชอล์กไป', 'Which way is the market… follow the chalk arrows')],
};

// =============================================================================================
// 9. after the intro: first-day objectives + talking to yourself
// =============================================================================================

export const HINTS = {
  book: tl('อ่านสมุดสูตรของลุง [F]', "Read the old man's recipe book [F]"),
  cook: tl('ผัดกะเพราขาย', 'Cook some kaphrao to sell'),
  sign: tl('เปิดป้ายร้าน', 'Flip the shop sign to OPEN'),
  signSub: tl('ป้ายอยู่ข้างรถเข็น · ให้ลูกค้ารู้ว่าเปิดแล้ว', "It's by the cart · tells customers you're open"),
  serve: tl('ขายให้ลูกค้า', 'Sell to customers'),
  serveSub: tl('ยกจานไปเสิร์ฟ กด [E] ที่ลูกค้า', 'Carry the plate over, [E] on the customer'),
};

export const CART_LABEL = { push: SNEAK.push, notYours: tl('รถของลุง', "the old man's cart"), give: tl('ให้เหรียญลุง', 'give coins') };

/** [T] talk to yourself — context lines (filled with {w} = wallet). */
export const MONO = {
  key: tl('พูดกับตัวเอง', 'talk to yourself'),
  broke: [tl('ตังค์เหลือ {w} บาท… ซื้อมาม่าได้สองซอง', '{w} baht left… two packs of instant noodles'), tl('จนแบบนี้ ขอทานยังสงสาร', "This broke, even beggars pity me"), tl('ถ้าเงินงอกจากต้นไม้ได้ กูจะปลูกทั้งซอย', "If money grew on trees I'd plant the whole soi")],
  rich: [tl('มีตังค์ {w} บาท! …ห้ามไปบ่อน ห้ามไปบ่อน ห้ามไปบ่อน', '{w} baht! …no casino, no casino, no casino'), tl('รวยแล้ว… ซื้อรองเท้าแตะสีเดียวกันได้แล้ว', 'Rich… I can finally afford matching flip-flops')],
  night: [tl('มืดแล้ว… ผีจะออกมั้ยวะ', 'Getting dark… are the ghosts coming out?'), tl('กลางคืนซอยนี้น่ากลัวชิบ', 'This soi is creepy as hell at night')],
  dawn: [tl('ฟ้าเริ่มสว่าง… เมื่อวานรวย วันนี้จน พรุ่งนี้ไม่รู้', 'Sky is getting light… rich yesterday, broke today, who knows tomorrow')],
  dish: [tl('กลิ่นหอมจัง… ขอชิมคำนึงได้ม้าย', 'Smells so good… can I sneak one bite'), tl('จานนี้ห้าสิบ… ห้ามกินเอง ห้ามกินเอง', 'This plate is fifty… do NOT eat it')],
  cook: [tl('ใช้ข้อมือ ไม่ใช่ใช้ใจ… ลุงพูดว่างั้นนะ', "Use the wrist, not the heart… that's what he said")],
  generic: [
    tl('ชีวิตคนเรามันขึ้นๆ ลงๆ… เหมือนราคาหมู', 'Life goes up and down… like pork prices'),
    tl('ถ้าลุงเฮงเห็นกูตอนนี้ คงด่าว่าไอ้ควาย', "If Uncle Heng saw me now he'd call me a buffalo"),
    tl('สักวันจะเปิดร้านอาหารจริงๆ มีแอร์ด้วย', 'Someday I\'ll open a real restaurant. With air-con.'),
    tl('คุยกับตัวเองแบบนี้… บ้ารึเปล่าวะเรา', 'Talking to myself like this… am I losing it'),
    tl('ปวดฉี่… ห้องน้ำ 8-Twelve ยังว่างมั้ยนะ', 'Need to pee… is the 8-Twelve toilet free'),
  ],
};
