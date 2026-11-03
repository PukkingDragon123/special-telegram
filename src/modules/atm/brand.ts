/* ============================================================================================
 * Fictional banks (no real bank names, colours or logos). Two brands so the market ATM can be
 * "another bank" with the ฿15 fee printed on its sticker.
 * ========================================================================================== */

export interface Brand {
  id: string;
  th: string;
  en: string;
  /** cabinet paint (linear-ish hex for MeshStandardMaterial.color) */
  paint: number;
  /** screen / sign colours (CSS) */
  bg0: string; bg1: string; head: string; accent: string; accent2: string; ink: string;
  /** withdrawal fee for a SOI THONG card at this machine (baht) */
  fee: number;
  /** account-number prefix printed on receipts */
  code: string;
}

export const BRANDS: Record<string, Brand> = {
  soithong: {
    id: 'soithong', th: 'ธนาคารซอยทอง', en: 'SOI THONG BANK',
    paint: 0x2ee6ee, bg0: '#04313a', bg1: '#0b5d66', head: '#03242a', accent: '#e2b23a', accent2: '#f6d77a', ink: '#083a40',
    fee: 0, code: '811',
  },
  taladsot: {
    id: 'taladsot', th: 'ธนาคารตลาดสด', en: 'TALAD SOT BANK',
    paint: 0xff5d54, bg0: '#3a0d10', bg1: '#7c2a26', head: '#2a0809', accent: '#f0c75a', accent2: '#ffe3a0', ink: '#4a1210',
    fee: 15, code: '622',
  },
};

/** The players' own bank (their cards). */
export const HOME = BRANDS.soithong;

/** Thai short month names (receipts / screen clock). */
export const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** satang → "1,234.50" */
export function fmtSatang(s: number) {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  const b = Math.floor(s / 100), st = s % 100;
  return (neg ? '-' : '') + b.toLocaleString('en-US') + '.' + String(st).padStart(2, '0');
}
export function fmtBaht(b: number) { return Math.round(b).toLocaleString('en-US'); }

/** In-game calendar: real date of "day 1" = today, + (day-1). Buddhist year. */
export function gameDate(day: number, hours: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(0, (day | 0) - 1));
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  const be = d.getFullYear() + 543;
  return {
    date: `${dd}/${mm}/${be}`,
    dateTh: `${d.getDate()} ${TH_MONTH[d.getMonth()]} ${String(be).slice(2)}`,
    time: `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  };
}
