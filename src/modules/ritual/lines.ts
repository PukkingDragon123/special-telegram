import type { TL } from '../../core/util';

/* ============================================================================================
 * ritual — every funny line (Thai first, English gloss). The ghost is ผีนางรีวิว ("Nang Review"):
 * a food-review influencer who died mid live-stream reviewing a too-spicy kaphrao and still needs content.
 * ========================================================================================== */

const t = (th: string, en: string): TL => ({ th, en });

/** The chant: 3 rounds × 3 options. `ok` = the right words (from ตำราเรียกผี); the rest summon nonsense. */
export interface ChantOpt { text: TL; ok?: boolean; oops?: Oops }
export type Oops = 'dog' | 'mosquito' | 'greedy' | 'ex' | 'seen' | 'dance' | 'silent';

export const CHANT: { prompt: TL; opts: ChantOpt[] }[] = [
  {
    prompt: t('ท่องคาถาบทที่ 1 — อัญเชิญ', 'Chant 1 — the calling'),
    opts: [
      { text: t('โอม… ผีเอ๋ยผีจ๋า ได้ยินแล้วโปรดมา', 'Om… dear ghost, if you hear me, come'), ok: true },
      { text: t('โอมเพี้ยง! หายป่วยไวๆ', 'Abracadabra! Get well soon'), oops: 'dog' },
      { text: t('สวัสดีวันจันทร์ ขอให้รวยๆ', 'Happy Monday, get rich'), oops: 'mosquito' },
    ],
  },
  {
    prompt: t('ท่องคาถาบทที่ 2 — ถวายของ', 'Chant 2 — the offering'),
    opts: [
      { text: t('น้ำแดงก็มี ไข่ต้มก็มา ม้าลายก็พร้อม', 'Red soda: here. Eggs: here. Zebra: ready'), ok: true },
      { text: t('ขอเลขเด็ดงวดนี้ด้วยเถิด', 'Please give me lucky lottery numbers'), oops: 'greedy' },
      { text: t('อัญเชิญแฟนเก่าของท่าน', "We summon… your ex"), oops: 'ex' },
    ],
  },
  {
    prompt: t('ท่องคาถาบทที่ 3 — สัญญา', 'Chant 3 — the promise'),
    opts: [
      { text: t('มาเถิดนะ จะเลี้ยงกะเพราไข่ดาวเผ็ดๆ', "Come, we'll treat you to spicy kaphrao + fried egg"), ok: true },
      { text: t('ทักแชทมาก็ได้นะ', 'Or just DM us'), oops: 'seen' },
      { text: t('มาเต้นโชว์ลงคลิปกัน', "Let's dance for a clip"), oops: 'dance' },
    ],
  },
];

export const L = {
  // ---- shrine / prompts
  notYet: t('ยังไม่ถึงเวลา… ตำราว่า 5 ทุ่มตรง', 'Not yet… the book says 11 PM'),
  tooLate: t('ดึกเกิน! ผีเลิกงานเที่ยงคืน', 'Too late, ghosts clock off at midnight'),
  missing: (list: string) => t('ของไหว้ยังไม่ครบ: ' + list, 'Offerings missing: ' + list),
  offered: t('ถวายแล้ว สาธุ', 'Offered. Sathu.'),
  incenseLit: t('แช่ะ! จุดธูปแล้ว', '*click* incense lit'),
  begin: t('ตั้งนะโม… เริ่มพิธี!', 'Namo… the ritual begins!'),
  timeSlows: t('เวลา… เหมือนจะเดินช้าลง…', 'Time… seems to slow down…'),
  silent: t('…เงียบ ผีงง ไม่มีใครท่อง', '…silence. The ghost is confused.'),

  // ---- oops outcomes
  oops: {
    dog: [t('อ้าว! หมาซอยมาแทน!', 'Wait — the soi dog came instead!'), t('มันกินไข่ต้มของไหว้หมดเลย!!', 'It ate ALL the offering eggs!!')],
    mosquito: [t('ยุง! ยุงมาแทนผี!!', 'Mosquitoes! Mosquitoes came instead!!'), t('ตบยุงกันให้วุ่น', '*slap slap slap*')],
    greedy: [t('(เสียงจากความมืด) ยังไม่เจอหน้า ขอหวยแล้วเหรอ!?', "(from the dark) We haven't even met and you want lottery numbers!?"), t('ลมเย็นพัดธูปดับหมด…', 'A cold wind blows the incense out…')],
    ex: [t('นั่น…แฟนเก่าเขา!!', "That's… her EX!!"), t('ไม่มีหัว…ใจ', 'No head… no heart')],
    seen: [t('ติ๊ง! ผีอ่านแล้ว', 'Ding! The ghost read your message'), t('…แต่ไม่ตอบ', '…and left you on read')],
    dance: [t('ทุกคนเต้นเองโดยไม่ได้ตั้งใจ!', 'Everyone starts dancing involuntarily!'), t('ผีไม่เล่นคลิปนะ', "Ghosts don't do clips")],
  } as Record<Exclude<Oops, 'silent'>, TL[]>,
  tryAgain: t('ลองใหม่ได้… ถ้าของไหว้ยังครบ', 'Try again… if the offerings are still complete'),

  // ---- the ghost
  arrive: [
    t('ใครเรียกฉัน!!!', 'WHO SUMMONED ME!!!'),
    t('นี่มันห้าทุ่มกว่าแล้วนะ! ผีก็มีเวลาเลิกงาน OT ใครจ่าย!?', "It's past 11! Ghosts have office hours too. Who pays my OT!?"),
    t('…เดี๋ยวนะ กลิ่นอะไรน่ะ… กะเพรา?', '…wait. What is that smell… kaphrao?'),
    t('ฉันคือ ผีนางรีวิว! อดีตรีวิวเวอร์อาหารชื่อดัง ตายตอนไลฟ์ชิมกะเพราเผ็ดเกิน', "I am NANG REVIEW! Famous food reviewer. Died live on stream tasting a too-spicy kaphrao"),
    t('เอากะเพราหมูสับไข่ดาว เผ็ดๆ มาให้ชิม! ไม่งั้นจะหลอนรถเข็นทั้งปี!', "Bring me spicy kaphrao moo + fried egg! Or I haunt your cart all year!"),
  ],
  goWait: t('เดี๋ยวไปรอที่ร้านนะ ฟิ้ววว~', "I'll wait at your stall. Whoosh~"),
  frozen: t('ผีหยุดเวลาให้แล้ว รีบทำ!', 'The ghost froze time for you. HURRY!'),
  waiting: [
    t('หิวแล้วนะ…', 'Hungry…'),
    t('ผีรอเป็นร้อยปีได้ แต่ไม่อยากรอ', "Ghosts CAN wait 100 years. I don't want to."),
    t('ไข่ดาวกรอบๆ นะ ไม่เอาเยิ้ม… เอ๊ะ เยิ้มก็ได้', 'Crispy egg please. Not runny… ok runny is fine too'),
    t('ผู้ติดตามรอชมอยู่นะ 3 คน', '3 followers are watching the stream'),
    t('เผ็ดๆ นะ ตายไปแล้วไม่กลัวตายอีก', "Make it SPICY. I'm already dead"),
  ],
  prayed: t('ไหว้ทำไม! ไปผัดกะเพรามา!', "Don't wai me! Go stir-fry!"),
  notKaphrao: t('นี่ไม่ใช่กะเพรา!! รีวิวเวอร์ไม่กินนอกเมนู', "That's NOT kaphrao!! Reviewers don't go off-menu"),
  notDish: t('จะให้ผีกินอะไร อากาศเหรอ', 'What am I supposed to eat, air?'),
  eat: [t('ง่ำ… ง่ำ…', '*nom… nom…*'), t('(ไลฟ์สด) ทุกคน ดูนะคะ ซูมเข้าไป…', '(live) Everyone, look, zoom in…')],
  review: {
    5: [t('ห้าดาว!!! แซ่บถึงวิญญาณ!', 'FIVE STARS!!! Spicy down to my soul!'), t('อร่อยจนอยากกลับมาเกิด… แต่ไม่ได้', 'So good I want to be reborn… but I can\'t')],
    4: [t('สี่ดาว! ใกล้แล้ว ขาดแค่ความหลอน', 'Four stars! Close. Missing a little… haunting'), t('ไข่ดาวผ่าน เผ็ดผ่าน', 'Egg: pass. Spice: pass.')],
    3: [t('สามดาว กลางๆ แบบชีวิตหลังความตาย', 'Three stars. Mid. Like the afterlife.'), t('ใส่พริกเพิ่มอีกนิดจะดีมาก', 'More chili next time')],
    2: [t('สองดาว… ผีก็ร้องไห้ได้นะ', "Two stars… ghosts can cry, you know"), t('ไข่ดาวไปไหน!?', 'Where is my egg!?')],
    1: [t('หนึ่งดาว!! ฉันตายรอบสองแล้ว', "ONE star!! I just died a second time"), t('จะลงเพจเตือนภัย', 'Posting a warning on my page')],
  } as Record<number, TL[]>,
  selfie: [t('มาๆ ถ่ายรูปลงเพจหน่อย!', 'Come, selfie for my page!'), t('ยิ้มมม… ชีส~!', 'Smiiile… CHEESE~!')],
  numbers: [t('เลขเด็ด… ผีบอก', 'Lucky numbers… from a ghost'), t('ซื้อเองนะ ผีไม่รับประกัน ผีไม่รับผิดชอบ', "Buy at your own risk. Ghost not liable.")],
  bye: t('ไปละ! OT หมดละ บ๊ายบาย~ กดติดตามด้วยนะ', "Bye! OT's over! Smash that follow button~"),
  timeout: [t('หมดเวลา!! ช้ากว่าเน็ตบ้านผีอีก', "TIME'S UP!! Slower than ghost wifi"), t('หนึ่งดาว! ไม่มาอีกแล้ว!', 'One star! Never coming back!')],
  faint: t('(เป็นลม)', '(fainted)'),
  wake: t('ตื่นๆ! ผีมาจริง!!', 'Wake up! The ghost is REAL!!'),
  frameGift: t('ทิ้งใบรับรองไว้ให้ ติดผนังร้านนะ', 'Here, a certificate. Hang it in your shop.'),

  // ---- lottery
  lottoDraw: t('หวยออกแล้วจ้า!! เลขท้ายสองตัว…', 'The lottery is out!! Last two digits…'),
  lottoWin: (n: string, who: string) => t(`${n}!!! ${who} ถูกหวยเลขผี!! รับไป 2,000 บาท!`, `${n}!!! ${who} won with the GHOST numbers!! 2,000 baht!`),
  lottoNobody: (n: string) => t(`${n}! เลขผีออกจริง… แต่ไม่มีใครซื้อ!!`, `${n}! The ghost numbers came out… and nobody bought them!!`),
  lottoMirror: (mine: string, drawn: string) => t(`สามตัวบนออก ${drawn}… ผีบอก ${mine} — ผีเขียนกลับด้าน!!`, `Top three: ${drawn}… the ghost said ${mine} — ghosts write backwards!!`),

  // ---- news (g.dayStats.events, the morning newspaper)
  newsReview: (stars: number) => `ผีนางรีวิวโผล่ศาลท้ายซอย ชิมกะเพราเฮียผัด ให้ ${stars} ดาว พร้อมเซลฟี่หลอนสะท้านโซเชียล`,
  newsTimeout: 'ผีนางรีวิวรอกะเพรานานเกิน ให้ร้านเฮียผัด 1 ดาว ข้อหาเสิร์ฟช้ากว่าเน็ตผี',
  newsLottoWin: (n: string) => `ฮือฮา! หนุ่มซอยถูกหวยเลขผี "${n}" เจ้าตัวเผย ผีบอกตอนห้าทุ่ม`,
  newsLottoNobody: (n: string) => `เลขผี "${n}" ออกจริง แต่ไม่มีใครซื้อ แม่ค้าหวยเสียดายแทน`,
};

/** the readable pocket manual (ตำราเรียกผี ฉบับพกพา) */
export const MANUAL_PAGES: string[][] = [
  ['ตำราเรียกผี ฉบับพกพา', '(พิมพ์ครั้งที่ 47 · ห้ามใช้ในทางที่ผิด)', '', 'สถานที่: ศาลพระภูมิท้ายซอย', 'เวลา: 5 ทุ่มตรง ถึงก่อนเที่ยงคืน', '', 'ของไหว้ (ครบ 5 อย่าง):', '• น้ำแดงใส่หลอด', '• ไข่ต้ม', '• พวงมาลัย', '• ม้าลาย', '• ธูป 3 ดอก'],
  ['คาถา (ท่องให้ถูกทุกคำ!)', '', 'บทที่ 1: "โอม… ผีเอ๋ยผีจ๋า ได้ยินแล้วโปรดมา"', 'บทที่ 2: "น้ำแดงก็มี ไข่ต้มก็มา ม้าลายก็พร้อม"', 'บทที่ 3: "มาเถิดนะ จะเลี้ยงกะเพราไข่ดาวเผ็ดๆ"', '', 'คำเตือน: ห้ามขอหวยก่อนเจอหน้า', 'ห้ามเรียกแฟนเก่าของผี (เด็ดขาด!)', '', 'หมายเหตุ: ผีบางตนชอบรีวิวอาหาร', 'เตรียมกระทะไว้ด้วย'],
];

/** the torn flyer on the stake by the spirit house (half of the info, the rest torn off) */
export const FLYER_LINES = ['ประกาศ!! ใครเคยเห็น', 'ผู้หญิงชุดขาว ถือมือถือ', 'ถามว่า "ร้านนี้อร่อยไหม"', '', 'คนแถวนี้ว่า… เรียกได้ที่ศาลท้ายซอย', 'ตอน 5 ทุ่ม ด้วย น้ำแดง ไข่ต้ม', 'มาลัย ม้าลาย ธูป 3 ดอก', '"โอม… ผีเอ๋ยผีจ๋า…"', '(ส่วนที่เหลือขาดหายไป…)'];

export const OFFER_KINDS = ['red_soda', 'boiled_eggs', 'garland', 'zebra_figurine', 'incense'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];
export const OFFER_NAME: Record<OfferKind, TL> = {
  red_soda: t('น้ำแดง', 'red soda'), boiled_eggs: t('ไข่ต้ม', 'boiled eggs'), garland: t('มาลัย', 'garland'),
  zebra_figurine: t('ม้าลาย', 'zebra'), incense: t('ธูป 3 ดอก', 'incense ×3'),
};

/** the amulet grandpa's shop (also sells the ritual set; the garland too, for lazy summoners) */
export const GRANDPA_SHOP: { id: string; kinds: string[]; price: number; name: TL }[] = [
  { id: 'manual', kinds: ['ghost_manual'], price: 99, name: t('ตำราเรียกผี ฉบับพกพา', 'pocket summoning manual') },
  { id: 'set', kinds: ['red_soda', 'boiled_eggs', 'zebra_figurine', 'incense', 'garland'], price: 149, name: t('ชุดของไหว้จัดเต็ม 5 อย่าง', 'full offering set (5 items)') },
  { id: 'incense', kinds: ['incense'], price: 10, name: t('ธูป 3 ดอก', 'incense ×3') },
  { id: 'zebra', kinds: ['zebra_figurine'], price: 59, name: t('ม้าลาย', 'zebra figurine') },
];
