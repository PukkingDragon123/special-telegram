import type { TL } from '../../core/util';
import DB from './linesdb.json';

/* =============================================================================================
 * Customer dialogue. Base: references/culture/lines.json (copied into linesdb.json — customer
 * orders, waits, honest reviews, pay/angry lines, the customer mad-system situations).
 * Extra restaurant-specific lines below (menu price opinions, served reactions, reactions to
 * ghosts / dogs / slaps / rain, review fragments for every cooking issue code).
 * ============================================================================================= */

const db: any = DB;
export type Line = TL;
export const pickL = (a: Line[] | undefined, r = Math.random): Line => (a && a.length ? a[Math.floor(r() * a.length) % a.length] : { th: '…' });

export const L = {
  greet: db.customer_greet as Line[],
  order: db.customer_order as Record<string, Line[]>,
  waitLong: db.customer_wait_long as Line[],
  good: db.customer_review_good as Record<string, Line[]>,
  ok: db.customer_review_ok as Record<string, Line[]>,
  bad: db.customer_review_bad as Record<string, Line[]>,
  pay: db.customer_pay as Line[],
  angry: db.customer_angry as Line[],
  dog: db.dog as Line[],
  ghost: db.ghost as Line[],
};

export interface MadOption { th: string; en?: string; type: 'correct' | 'incorrect' | 'funny'; mood_delta: number; money_delta: number; outcome?: string }
export interface MadSituation { id: string; prompt: Line; options: MadOption[] }
export const MAD: Record<string, MadSituation> = {};
for (const m of db.mad as any[]) MAD[m.id] = m;

// ------------------------------------------------------------------ extra lines (restaurant module)

const t = (th: string, en?: string): Line => ({ th, en });

export const X = {
  waitThink: [t('หิวจัง…', 'so hungry…'), t('ได้กลิ่นกะเพราแล้วท้องร้อง', 'that smell… my stomach'), t('รอแป๊บนึงละกัน', "I'll wait a bit"), t('ดูคลิปรอไปก่อน', 'scrolling while I wait'), t('ข้าวจ๋า มาเร็ว ๆ', 'come to me, rice'), t('หิวจนไส้จะกินกันเองแล้ว', 'so hungry my guts are eating each other'), t('ร้านนี้ช้าแต่หอมชิบหาย', 'slow but smells damn good'), t('ถ้าข้าวไม่มาใน 5 นาที จะกินโต๊ะแทน', 'No rice in 5 min and I eat the table'), t('หิวจนเห็นหมาเป็นหมูกระทะ', 'So hungry the dog looks like BBQ')],
  waitNudge: [t('อีกนานมั้ยครับ', 'how much longer?'), t('ของหนูยังไม่ได้นะคะ', "mine hasn't come yet"), t('เฮีย ของผมอยู่ไหน', "hia, where's mine?"), t('ลืมของผมป่าวเนี่ย', 'did you forget me?'), t('เฮีย ผมแก่ตายก่อนได้กินมั้ยเนี่ย', 'hia, will I die of old age first?'), t('ข้าวผมไปเที่ยวไหนมาครับ', 'where did my rice go on holiday?'), t('เร็วๆ หน่อย หิวจะตายห่าแล้ว', "hurry, I'm starving to death"), t('ข้าวผมไปบวชแล้วเหรอ', 'Did my rice become a monk?'), t('ทำกะเพราหรือปลูกกะเพราอยู่ครับ', 'Cooking basil or growing it?')],
  waitShout: [t('จะได้กินมั้ยเนี่ย!', 'am I ever eating?!'), t('รอจนจะเป็นลมแล้ว!', "I'm about to faint!"), t('สั่งไปตั้งนานแล้วนะ!', 'I ordered ages ago!'), t('เร็ว ๆ หน่อยได้ป่ะ!', 'hurry up!'), t('เชี่ย! รอจนหนวดขึ้นแล้ว!', 'damn! grew a beard waiting!'), t('แม่ง ช้ายิ่งกว่ารถติดอีก!', 'slower than traffic, dammit!'), t('ทำอาหารหรือปลูกข้าวอยู่วะ!', 'cooking or farming the rice?!'), t('ช้าจนผมสอบใบขับขี่ผ่านแล้ว!', 'So slow I passed my driving test!'), t('ไอ้ร้านเต่าคลาน!', 'Turtle-speed shop!')],
  call: [t('มีใครอยู่มั้ยคะ', 'anyone here?'), t('เฮีย! สั่งข้าวหน่อย!', 'hia! I want to order!'), t('ร้านเปิดอยู่ป่ะเนี่ย', 'is this place open?'), t('พี่ครับ! สั่งอาหาร!', 'excuse me! order!')],
  cheap: [t('ถูกดีนะเนี่ย', 'cheap!'), t('ราคานี้ได้ไง ถูกจัง!', 'how is it this cheap?!'), t('{dish} {price} บาทเอง คุ้ม!', '{price} baht only, nice'), t('ราคาเป็นกันเองดี', 'friendly prices')],
  fair: [t('ราคาโอเคนะ', 'price is ok'), t('ก็ราคาปกติแหละ', 'normal price')],
  pricey: [t('แพงจัง', 'pricey'), t('{price} บาท? ใส่ทองมาด้วยเหรอ', '{price}? is there gold in it?'), t('แพงกว่าร้านในซอยอีก', 'pricier than the soi shop'), t('ราคาออฟฟิศชัด ๆ', 'office prices, huh'), t('{price}? ห่า ปล้นกันชัดๆ', "{price}? that's robbery"), t('ราคานี้ต้องมีเชฟหล่อแถม', 'at that price the chef better be hot'), t('ราคานี้ หมูมีปริญญาเหรอ', 'At this price, does the pig have a degree?')],
  tooPricey: [t('แพงขนาดนี้ ไปกินเซเว่นดีกว่า', "that price? I'll eat at the 7-Eleven"), t('ราคาโรงแรมห้าดาวเลยนะเนี่ย ไม่ไหว', 'five-star hotel prices, no way'), t('ขูดรีดกันชัด ๆ บาย', 'daylight robbery, bye'), t('แพงชิบหาย ไปกินมาม่าดีกว่า', "pricey as hell, I'll have noodles"), t('ไอ้บ้า ราคานี้ซื้อหมูได้ทั้งตัว', 'for that I could buy a whole pig')],
  served: [t('ขอบคุณครับ', 'thanks'), t('น่ากินจัง', 'looks good'), t('หอมมาก!', 'smells great!'), t('มาแล้ว ๆ', "here it comes"), t('ว้าว ไข่ดาวสวยมาก', 'wow, pretty egg'), t('มาซะที ไอ้เวร… ล้อเล่น ขอบคุณ', 'finally, jerk… kidding, thanks'), t('หอมฉิบหาย', 'smells freaking amazing'), t('ในที่สุด! ผมนึกว่าจะได้กินชาติหน้า', "Finally! Thought I'd eat in my next life")],
  servedFast: [t('เร็วมาก! ทันใจ', 'so fast!'), t('สั่งปุ๊บได้ปั๊บ', 'ordered, delivered')],
  water: [t('ขอบใจนะ น้ำเย็นชื่นใจ', 'thanks, ice water!'), t('น้ำมาพอดี', 'water just in time')],
  soda: [t('ซ่าส์ชื่นใจ', 'fizzy, refreshing'), t('เย็น ๆ ซ่า ๆ', 'cold and fizzy')],
  spicyEat: [t('เผ็ดดดด!', 'spicyyy!'), t('ซี๊ดดด ถึงใจ', 'sssss, that hits'), t('น้ำ! ขอน้ำ!', 'water! water!')],
  saltyEat: [t('เค็มมม', 'salty…')],
  yum: [t('อร่อยยย', 'yummm'), t('อืมมม ถึงเครื่อง', 'mmm, punchy'), t('ฟินนน', 'bliss'), t('เชี่ย อร่อยว่ะ', "damn, that's good"), t('อร่อยจนอยากด่า', 'so good I wanna swear'), t('แม่งเอ๊ย ฟินจัด', 'holy hell, bliss'), t('อร่อยจนลืมว่าตัวเองจน', "So good I forgot I'm broke"), t('อร่อยชิบหาย บอกแม่ด้วย', "Damn good, I'm telling my mom")],
  leaveGood: [t('อิ่มแล้ว ไปละ!', "full, I'm off!"), t('พรุ่งนี้มาใหม่นะเฮีย', 'see you tomorrow, hia'), t('อิ่มแปล้', 'stuffed'), t('อิ่มจนเดินไม่ไหว ขอบใจเฮีย', 'too stuffed to walk, thanks hia')],
  leaveBad: [t('ไม่มาอีกแล้ว', 'never again'), t('เสียดายตังค์', 'what a waste of money'), t('ห่วยแตก ไปละ', 'trash. bye'), t('เสียตังค์ฟรี แม่ง', 'money down the drain, dammit'), t('กินแล้วอยากไปวัด', 'Ate it, now I need to pray'), t('รสชาติเหมือนชีวิตกู ขม', 'Tastes like my life: bitter')],
  tip: [t('ไม่ต้องทอนนะ', 'keep the change'), t('ทิปให้ อร่อยมาก', 'a tip, it was great'), t('เก็บทอนไว้กินขนมนะ', 'keep the change for snacks')],
  closing: [t('อ้าว ปิดแล้วเหรอ', 'oh, closed already?'), t('ไม่ทันซะแล้ว', 'missed it')],
  noSeat: [t('ไม่มีที่นั่งเลย ยืนกินก็ได้', 'no seats, I’ll eat standing'), t('ไม่มีโต๊ะเหรอเนี่ย', 'no tables?')],
  dogShoo: [t('ชิ่ว ๆ ไปไกล ๆ เลย', 'shoo, go away'), t('หมาจ้องข้าวเราอะ', "the dog's staring at my rice"), t('ไอ้ตูบ! ไปไกลๆ ไอ้หมาเวร', 'scram, damn mutt!'), t('หมาตัวนี้จ้องข้าวกูอีกแล้ว', 'this dog is eyeing my rice again'), t('ไอ้ตูบ มึงจ่ายตังค์ด้วยป่ะ', 'Mutt, you paying for that?')],
  slapLaugh: [t('5555 ตบกันเฉย', 'lol they just slapped each other'), t('ตีกันทำไมเนี่ย', 'why are they fighting?'), t('เอาอีก! เอาอีก!', 'again! again!'), t('ร้านนี้มีโชว์ด้วยเหรอ', 'this place has a show?'), t('อิหยังวะ', 'what the heck'), t('เชี่ยยย ตบเสียงดังมาก', 'damn, loud slap'), t('ตบกันเหมือนละครหลังข่าว 555', 'slapping like a soap opera lol')],
  rain: [t('ฝนตกอีกแล้ว เปียกหมด!', 'raining again, soaked!'), t('ไม่มีร่มเหรอร้านนี้', 'no umbrella here?'), t('ฝนห่าอะไรเนี่ย เปียกหมดแล้ว', "what the hell rain, I'm soaked"), t('ฟ้ารั่วอีกแล้ว แม่ง', "the sky's leaking again, dammit"), t('ฝนตกทีไร หนี้กูเพิ่มทุกที', 'Every time it rains, my debt grows')],
  stoolPulled: [t('โอ๊ยยย!! ก้นกระแทก!', 'OW! my butt!'), t('ใครดึงเก้าอี้!!', 'who pulled my stool?!')],
  foodStolen: [t('เฮ้ย!! ของผม!!', 'HEY! that’s mine!'), t('ยังกินไม่เสร็จ!!', "I wasn't done!"), t('ไอ้หมาเวร!! ข้าวกู!!', 'damn dog!! my rice!!'), t('เชี่ยยย ยังไม่ได้กินซักคำ!', "dammit, didn't get one bite!")],
  ghostRun: [t('ผีีีี!!', 'GHOOOST!!'), t('แม่จ๋าาา!!', 'MOMMY!!'), t('ตังค์วางไว้บนโต๊ะนะ ไปละ!!', "money's on the table, BYE!!"), t('ผีก็ต้องจ่ายค่าข้าวนะ!', 'Ghosts pay for food too!')],
  calmGood: [t('เออ… ก็ได้ ๆ', 'fine… ok'), t('โอเคค่ะ ใจดีนะเนี่ย', "ok, that's kind"), t('งั้นไม่เป็นไรครับ', "then it's fine")],
  calmFunny: [t('555 บ้าไปแล้ว', 'lol you’re crazy'), t('ฮ่า ๆ เอาไปเลย', 'haha fine'), t('เออ ขำว่ะ ไอ้บ้า', "ok that's funny, lunatic"), t('ปากดีแต่ทำอร่อย ยอม', 'smart mouth but good food, fine')],
  stormOff: [t('ไม่กินแล้วโว้ย!! รีวิวหนึ่งดาวแน่!', "I'm out!! one star!!"), t('ร้านแย่ที่สุด ไม่มาอีกแล้ว!!', 'worst shop, never again!!'), t('โพสต์ลงกลุ่มแน่!', "I'm posting this in the group!"), t('ร้านห่าอะไรเนี่ย! ไปละ!', "what the hell kind of shop! I'm out!"), t('ไอ้ร้านเวร หนึ่งดาว!', 'damn shop, one star!')],
  wrongShout: [t('ผมสั่ง{ordered} นี่มัน{got}!', 'I ordered {ordered_en}, this is {got_en}!')],
  repeat: [t('บอกแล้วไง {order}', 'I told you: {order}')],
  // review fragments for issue codes (the cooking module's DishData.issues)
  issue: {
    raw_pork: [t('หมูยังดิบอยู่เลย! จะให้ท้องเสียเหรอ', 'raw pork! want me to get sick?')],
    raw_meat: [t('เนื้อยังดิบอยู่เลย', 'the meat is raw')], raw_shrimp: [t('กุ้งยังดิบ', 'raw shrimp')],
    burnt: [t('ไหม้!', 'burnt!'), t('ดำปี๋อย่างกับถ่าน', 'black as charcoal'), t('ไหม้ยิ่งกว่าชีวิตกูอีก', 'more burnt than my life'), t('นี่กะเพราหรือถ่านวะ', 'kaphrao or charcoal?'), t('ไหม้จนนักดับเพลิงต้องมา', 'Burnt enough to call the fire brigade'), t('ถ่านอร่อยดีครับ', 'Lovely charcoal')],
    burnt_garlic: [t('ขมเลย กระเทียมไหม้', 'bitter, burnt garlic')],
    soggy_basil: [t('กะเพราเละ ไม่หอมเลย', 'soggy basil, no aroma')],
    no_basil: [t('กะเพราไม่มีใบกะเพรา?! นี่มันผัดหมูสับ', 'kaphrao without basil?!')],
    too_oily: [t('มันเยิ้ม ต้องเอาทิชชู่ซับ', 'swimming in oil')], dry: [t('แห้งไป ฝืดคอ', 'too dry')],
    cold: [t('เย็นชืดเหมือนใจแฟนเก่า', 'cold as my ex'), t('เย็นชืดเหมือนบัญชีธนาคารกู', 'cold as my bank account')], no_rice: [t('ไม่มีข้าว! จะให้กินกับอากาศเหรอ', 'no rice?! eat it with air?')],
    watery: [t('แฉะ ๆ เหมือนข้าวต้ม', 'soggy like porridge')], raw_egg: [t('ไข่ยังดิบ ไข่ขาวใส ๆ', 'raw egg white')],
    burnt_egg: [t('ไข่ไหม้ดำ', 'burnt egg')], soggy_egg: [t('ไข่ดาวไม่กรอบเลย นิ่มเหมือนฟองน้ำ', 'egg not crispy at all')],
    smoky: [t('เหม็นควันไหม้', 'smells of smoke')], mushy_rice: [t('ข้าวแฉะเป็นโจ๊ก', 'mushy rice')], hard_rice: [t('ข้าวแข็งเป็นเม็ดทราย', 'rice hard as sand')],
    small_portion: [t('ให้น้อยไปนิด ไม่อิ่มเลย', 'small portion')], huge_portion: [t('ให้เยอะจุใจ อิ่มแปล้', 'huge portion!')],
    unchopped: [t('ผักไม่ได้หั่น ชิ้นโตเท่าบ้าน', 'veg not chopped')], unpounded: [t('กระเทียมเม็ดเบ้อเริ่ม', 'whole garlic cloves')],
    soggy_veg: [t('ผักเละ', 'mushy veg')], not_flipped: [t('ไข่เจียวไม่ได้กลับ ด้านนึงดิบ', 'omelette not flipped')],
    too_sweet: [t('หวานเจี๊ยบ เหมือนกินขนม', 'sweet like dessert')], wrong_dish: [t('นี่มันอะไรเนี่ย', 'what is this')],
  } as Record<string, Line[]>,
  req: {
    mildFail: [t('บอกแล้วว่าไม่เผ็ด! น้ำตาไหลเลย', 'I said NOT spicy!')],
    hotFail: [t('สั่งเผ็ดมาก ได้เผ็ดน้อย ผิดหวัง', 'ordered extra hot, got mild')],
    runnyFail: [t('บอกไข่ไม่สุก ได้ไข่สุกแข็งโป๊ก', 'asked runny, got rock-hard')],
    crispyFail: [t('ไข่ดาวไม่กรอบเลย', 'egg not crispy')],
    eggMissing: [t('สั่งไข่ดาว ไข่หายไปไหน?', 'ordered an egg, where is it?')],
    takeawayFail: [t('บอกว่าใส่ถุงไง', 'I said take-away')],
    anyOmelet: [t('อะไรก็ได้… แต่ไม่เอาไข่เจียวนะ!', 'whatever… but NOT omelette!')],
    noTissue: [t('ไม่มีทิชชู่ ต้องเช็ดปากกับแขนเสื้อ', 'no tissues, used my sleeve')],
    rainWet: [t('นั่งตากฝน เปียกหมดเลย', 'sat in the rain, soaked')],
    shade: [t('มีร่มนั่งสบายดี', 'nice shade')],
    slapShow: [t('อาหารโอเค แต่คนขายตบกันเอง ตลกดี', 'food ok, and the staff slap each other lol')],
    flies: [t('แมลงวันตอมเต็มเลย', 'flies everywhere')],
  } as Record<string, Line[]>,
};

/** Replace {dish} {price} {ordered} {got} … in a line. */
export function fillL(l: Line, v: Record<string, string | number>): Line {
  const f = (s?: string) => s?.replace(/\{(\w+)\}/g, (_m, k) => (v[k] !== undefined ? String(v[k]) : v[k + '_th'] !== undefined ? String(v[k + '_th']) : ''));
  return { th: f(l.th) ?? '', en: f(l.en) };
}

export function stars(n: number) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
