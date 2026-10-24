import { tl, TL } from '../../core/util';
import { Assets } from '../../core/assets';

/* ============================================================================================
 * Thai lines for life (natural spoken Thai + short English gloss). If the culture research
 * (references/culture/lines.json → public/assets/gen/life/data/lines.json) provides more, they
 * are merged at init (same keys).
 * ========================================================================================== */

export const L: Record<string, TL[]> = {
  dog_thief: [tl('เฮ้ย! หมาขโมยกิน!', 'hey! the dog stole it!'), tl('ไอ้ตูบบบ! ของกูวว!', 'doggo! that was mine!'), tl('หมาาา! คืนมาาา!', 'give it back!')],
  dog_fed: [tl('โฮ่ง! ♥', 'woof! ♥'), tl('งั่ม งั่ม งั่ม', 'nom nom nom'), tl('(กระดิกหางรัวๆ)', '(tail wagging wildly)')],
  dog_adopted: [tl('ได้น้องหมาแล้ว! ไอ้หมูสับ ♥', 'you adopted the dog!')],
  dog_beg: [tl('งื้ดดด…', 'whimper…'), tl('(ทำตาปริบๆ)', '(puppy eyes)'), tl('หงิงๆ', 'whine')],
  cat_meow: [tl('เมี้ยววว', 'meow'), tl('แง้ว!', 'mrrow!'), tl('เมี้ยว~ ♥', 'meow ♥')],
  cat_knock: [tl('(มองหน้า แล้วปัดตก)', '(stares… swats it off)'), tl('เมี้ยว (ไม่ได้ตั้งใจ)', 'meow (not sorry)')],
  cat_adopted: [tl('ได้ทาสแมวเพิ่ม! น้องไข่ตุ๋น ♥', 'the cat adopted YOU')],
  shoo: [tl('ชิ่วๆ', 'shoo shoo'), tl('ไปๆ ลงไป!', 'get down!')],

  homeless_ask: [tl('หลานๆ ขอตังค์ลุงซื้อข้าวหน่อยได้ไหม…', 'spare some coins for rice?'), tl('ลุงหิวข้าว… มีเศษเหรียญไหมหลาน', 'any spare coins?'), tl('ทำบุญกับลุงหน่อยนะ ได้บุญนะหลาน', 'make merit with me?')],
  homeless_thanks_small: [tl('บาทเดียว… เออ ขอบใจ ได้ลูกอมเม็ดนึง', 'one baht… thanks, that\'s a candy'), tl('น้อยแต่น่ารัก ขอบใจหลาน', 'small but cute, thanks')],
  homeless_thanks: [tl('ขอให้ขายดีเป็นเทน้ำเทท่านะหลาน!', 'may your shop overflow with customers!'), tl('ขอให้รวยๆ เฮงๆ ปังๆ', 'rich, lucky, booming!'), tl('บุญรักษานะหลาน ขอให้เจริญๆ', 'merit protects you'), tl('ขอบใจมากหลาน ใจบุญจริงๆ', 'thank you, kind soul')],
  homeless_big: [tl('โอ้โห! เทวดามาโปรด! ขอให้ถูกหวยรางวัลที่หนึ่ง!', 'an angel! may you win the lottery!'), tl('ยี่สิบบาท! พรุ่งนี้ลูกค้ามาเต็มร้านแน่นอน ลุงรับประกัน', 'twenty! full shop tomorrow, guaranteed'), tl('ใจถึงพึ่งได้! ลุงจะสวดให้ทั้งคืนเลย', 'big heart! i\'ll pray for you all night')],
  homeless_wisdom: [
    tl('ชีวิตก็เหมือนกะเพรา… ใส่พริกมากไปก็น้ำตาไหล', 'life is like kaphrao: too much chili, tears'),
    tl('อย่าเอาหมูสับไปวางไว้ใกล้หมา ลุงเตือนแล้วนะ', 'never leave pork near the dog'),
    tl('เงินซื้อความสุขไม่ได้ แต่ซื้อข้าวผัดได้', 'money can\'t buy happiness, but it buys fried rice'),
    tl('ลุงก็เคยมีร้าน… ก่อนจะไปบ่อน', 'i had a shop once… before the casino'),
    tl('ไข่ดาวต้องกรอบ ชีวิตต้องสู้', 'crispy egg, fighting spirit'),
    tl('ตอนเที่ยงคืนอย่าเดินท้ายซอยคนเดียวนะ…', 'don\'t walk the back of the soi alone at midnight…'),
    tl('ลูกค้าคือพระเจ้า แต่ป้าข้างบ้านคือซีอีโอ', 'customers are gods, but the auntie next door is the CEO'),
    tl('เห็นมอไซค์ไม่มีหัวอย่าโบกนะ มันไม่จอด', 'if you see a headless rider, don\'t wave. it won\'t stop'),
  ],
  homeless_ignored: [tl('เชอะ… เดินผ่านเฉยเลย', 'hmph… just walked past'), tl('ใจดำ… เหมือนกะทะไหม้', 'heart as black as a burnt wok'), tl('เดี๋ยวหมาก็ขโมยหมูสับหรอก', 'the dog will steal your pork, you\'ll see'), tl('ไม่เป็นไร… ลุงชินแล้ว', 'it\'s fine… i\'m used to it')],
  homeless_broke: [tl('ไม่มีตังค์เหมือนกันเหรอ… งั้นเรามาจนด้วยกัน', 'broke too? let\'s be broke together')],
  homeless_luck: [tl('เมื่อวานหลานใจดีกับลุง วันนี้ต้องขายดีแน่ๆ', 'you were kind yesterday — today will sell well')],

  ghost_white: [tl('พี่มาก…', 'Pi Mak…'), tl('พี่มากจ๋า…', 'Pi Mak, darling…'), tl('พี่มาก… กินข้าวยังจ๊ะ…', 'Pi Mak… have you eaten…')],
  ghost_pret: [tl('ขอส่วนบุญ… ขอส่วนบุญ…', 'share your merit…'), tl('หิววว… ข้าวสักเม็ด…', 'hungry… one grain of rice…'), tl('อุทิศให้ข้าที…', 'dedicate merit to me…')],
  ghost_pret_thanks: [tl('สาธุ… ได้รับแล้ว…', 'sadhu… received…'), tl('ขอบใจ… ขอให้เจริญ…', 'thank you… may you prosper…')],
  ghost_krasue: [tl('คิกๆๆ…', 'hee hee hee…'), tl('หมูสดๆ… หอมจัง…', 'raw pork… smells good…')],
  ghost_tani: [tl('ฮือๆๆ…', 'sob…'), tl('มาหาข้าใต้ต้นกล้วยสิ…', 'come to me under the banana tree…')],
  ghost_moto: [tl('บรื้นนนนนน!!', 'VROOOM!!')],
  ghost_flee: [tl('กรี๊ดดด! ผีหลอก!', 'aaah! ghost!'), tl('ผีๆๆๆ! วิ่ง!', 'ghost! run!'), tl('แม่จ๋าาา!', 'mommy!')],
  pray: [tl('สาธุ… ไปสู่สุคติเถิด', 'sadhu… rest in peace'), tl('ขอขมาครับ ไม่ได้ตั้งใจลบหลู่', 'forgive us, no offence meant'), tl('นะโม ตัสสะ…', 'namo tassa…')],
  ghost_stole: [tl('อ้าว! ใครเอาหมูไป!?', 'who took the pork!?'), tl('ของหายไปไหน… ขนลุกเลย', 'where did it go… goosebumps')],

  crowd_laugh: [tl('555555', 'lol'), tl('ฮ่าๆๆๆ', 'haha'), tl('ตบแรงจัด!', 'what a slap!'), tl('อุ๊ยตาย!', 'oh my!')],
  crowd_gossip: [tl('ได้ข่าวว่า…', 'i heard that…'), tl('จริงดิ!?', 'no way!?'), tl('ตายแล้ว…', 'oh dear…'), tl('ลูกสาวบ้านโน้นน่ะ…', 'that family\'s daughter…'), tl('หวยงวดนี้ออกอะไร', 'what number will win this draw?')],
  crowd_greet: [tl('กินข้าวยัง?', 'eaten yet?'), tl('ไปไหนมา?', 'where you been?'), tl('ร้อนจังวันนี้', 'so hot today')],
  lottery: [tl('ลอตเตอรี่จ้า! ใบละแปดสิบ!', 'lottery! 80 a ticket!'), tl('เลขสวยๆ จ้า งวดนี้รวยแน่!', 'pretty numbers! rich this draw!'), tl('ซื้อไว้ก่อน รวยไม่รู้ตัว!', 'buy now, get rich!')],
  icecream: [tl('ไอติมกะทิจ้า!', 'coconut ice cream!')],
  junk: [tl('รับซื้อ ตู้เย็น ทีวี เครื่องซักผ้า แอร์เก่า คอมพิวเตอร์เสีย…', 'buying old fridges, TVs, washing machines…'), tl('ของเก่า ขายได้ รับซื้อทุกชนิด…', 'old stuff, we buy everything…')],
  karaoke: [tl('♪ คืนนี้… ขอให้ได้ร้องเพลง… ♪', '♪ tonight… let me sing… ♪'), tl('♪ อ้ายยย… คิดฮอดดด… ♪', '♪ i miss you… ♪'), tl('♪ ลา ลา ล้า… (เพี้ยน) ♪', '♪ la la laa… (off-key) ♪'), tl('เพลงต่อไป! ใครจะร้องงง!', 'next song! who\'s singing!')],
  horn_angry: [tl('หลบหน่อยยย!', 'move it!'), tl('ยืนกลางถนนทำไม!', 'why stand in the road!'), tl('ไอ้บ้า! จะตายเหรอ!', 'you crazy!?'), tl('ปี๊นนน!', 'beeeep!')],
  monk_give: [tl('(พนมมือไหว้)', '(wai)')],
  moto_taxi: [tl('ไปไหนครับพี่?', 'where to, bro?'), tl('รุก! กินสองตัว!', 'jump! double capture!'), tl('ฮ่า! แพ้อีกแล้ว', 'ha! you lost again')],
};

export function line(key: string, i?: number): TL {
  const a = L[key];
  if (!a?.length) return tl(key);
  return a[(i ?? Math.floor(Math.random() * a.length)) % a.length];
}

export async function loadLines() {
  const extra = await Assets.jsonSafe<Record<string, TL[]>>('gen/life/data/lines.json', {});
  for (const [k, v] of Object.entries(extra)) if (Array.isArray(v) && v.length) L[k] = [...(L[k] ?? []), ...v.filter((x) => x && x.th)];
}
