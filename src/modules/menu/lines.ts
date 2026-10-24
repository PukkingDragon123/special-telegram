/* ============================================================================================
 * Text lines for the menu module. If the culture research ships references/culture/lines.json
 * (keys `girl_scream`, `newspaper_headlines`, …) it is bundled automatically (import.meta.glob
 * returns {} while the file doesn't exist) and preferred over these fallbacks.
 * ========================================================================================== */

export interface TLine { th: string; en?: string }

const found = import.meta.glob('../../../references/culture/lines.json', { eager: true, import: 'default' }) as Record<string, any>;
const LJ: any = Object.values(found)[0] ?? {};

function norm(a: any): TLine[] {
  if (!Array.isArray(a)) return [];
  return a.map((x) => (typeof x === 'string' ? { th: x } : { th: x.th ?? x.text ?? '', en: x.en })).filter((x) => x.th);
}

const SCREAM_FALLBACK: TLine[] = [
  { th: 'ว้ายยย! โรคจิต!!', en: 'Eeek! Pervert!!' },
  { th: 'กรี๊ดดด! ใส่เสื้อผ้าก่อนสิ!', en: 'Aaah! Put some clothes on!' },
  { th: 'แม่จ๋า! มีคนแก้ผ้ากลางถนน!', en: 'Mom! A half-naked man in the street!' },
  { th: 'ว้าย! ตาฉันนน!', en: 'Argh! My eyes!' },
  { th: 'ตำรวจ! ตำรวจ! ช่วยด้วย!', en: 'Police! Help!' },
  { th: 'ยืนกางแขนทำไมเนี่ย!?', en: 'Why are you standing like that?!' },
];

export function screamLines(): TLine[] {
  const a = norm(LJ.girl_scream ?? LJ.girlScream ?? LJ.scream);
  return a.length ? a : SCREAM_FALLBACK;
}

/** Newspaper headline templates with {money} {customers} {dish} {rating} {day} placeholders. */
export interface HeadlineTpl { th: string; en?: string; mood?: 'good' | 'bad' | 'day1' | 'neutral' | 'event'; kicker?: string }

const HEAD_FALLBACK: HeadlineTpl[] = [
  { mood: 'day1', kicker: 'ระทึกกลางซอยเก่า!', th: '4 หนุ่มหมดตัว! ควักเหรียญ|ซื้อรถเข็นลุง 100 บาท' },
  { mood: 'good', kicker: 'ร้อนแรงที่สุดในซอย!', th: 'กะเพราเฮียผัดฟีเวอร์!|ลูกค้า {customers} คน แห่ต่อคิว' },
  { mood: 'good', kicker: 'ข่าวดีวงการกะเพรา', th: 'โกยเรียบ {money} บาท!|{dish} ขายดีจนกระทะไหม้' },
  { mood: 'good', kicker: 'อร่อยจนต้องจดหมายเหตุ', th: 'รีวิวพุ่ง {rating} ดาว!|ป้าข้างบ้านยอมรับ "อร่อยจริง"' },
  { mood: 'bad', kicker: 'วิกฤตกระทะร้อน!', th: 'ขายได้แค่ {money} บาท!|เฮียผัดนั่งซึมหน้าเตา' },
  { mood: 'bad', kicker: 'ดราม่าข้าวกล่อง', th: 'ลูกค้าบ่นอุบ! {dish} เค็มปี๋|รีวิวร่วงเหลือ {rating} ดาว' },
  { mood: 'bad', kicker: 'สลด!', th: 'ลูกค้าแค่ {customers} คน|หมาจรกินเหลือมากกว่าคนกิน' },
  { mood: 'neutral', kicker: 'ชีวิตยังต้องผัดต่อ', th: 'วันที่ {day} ของเฮียผัด|ขายได้ {money} บาท ไม่รวยแต่ไม่อด' },
  { mood: 'neutral', kicker: 'รายงานพิเศษ', th: 'ซอยเก่าคึกคัก! {customers} ชีวิต|อิ่มท้องด้วย {dish}' },
];

export function headlineTemplates(): HeadlineTpl[] {
  const raw = LJ.newspaper_headlines ?? LJ.newspaperHeadlines ?? LJ.headlines;
  const a: HeadlineTpl[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string') a.push({ th: x });
      else if (x && (x.th || x.text)) a.push({ th: x.th ?? x.text, en: x.en, mood: x.mood ?? x.type ?? x.tone, kicker: x.kicker });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [mood, list] of Object.entries(raw)) if (Array.isArray(list)) for (const x of list as any[]) {
      if (typeof x === 'string') a.push({ th: x, mood: mood as any });
      else if (x && (x.th || x.text)) a.push({ th: x.th ?? x.text, en: x.en, mood: mood as any, kicker: x.kicker });
    }
  }
  return a.length ? a.concat(HEAD_FALLBACK.filter((h) => h.mood === 'day1')) : HEAD_FALLBACK;
}

export const SIDE_STORIES: { head: string; body: string }[] = [
  { head: 'หมาจรฉกหมูสับ 2 กิโล หนีเข้าซอย! สี่หนุ่มต้องวิ่งไปตลาดป้า', body: 'เจ้าตูบผู้ต้องสงสัย ทำหน้าไม่รู้ไม่ชี้หลังกินหมูสับไปทั้งถุง ก่อนนอนอืดใต้ต้นมะม่วง' },
  { head: 'ป้าแผงผักขึ้นราคากะเพรา อ้างใบสวยกว่าเมื่อวาน', body: 'ลูกค้าต่อราคาจนป้าน้ำตาซึม สุดท้ายแถมพริกให้อีกกำมือหนึ่ง' },
  { head: 'วินมอไซค์หน้าปากซอย ยืนยันกลิ่นผัดกะเพราลอยไปถึงถนนใหญ่', body: 'พี่วินรายหนึ่งเผยว่าจอดรถรอลูกค้าไม่ได้เลย เพราะท้องร้องตลอดเวลา' },
  { head: 'ผีมอไซค์ไร้หัว โผล่ซอยเปลี่ยวตีสอง ขอซื้อกะเพราไข่ดาว', body: 'ชาวบ้านยืนยันเห็นกับตา แต่ไม่มีใครกล้าถามว่าจะกินทางไหน' },
  { head: 'แมวส้มประจำซอย แอบนอนบนกล่องกระดาษของเฮียทั้งคืน', body: 'เจ้าของกล่องตัวจริงต้องนอนบนพื้นปูนแทน เพราะไม่กล้าปลุกเจ้านาย' },
];
