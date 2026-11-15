/* ============================================================================================
 * UI language (per player, local, never replicated): 'th' (default) or 'en'.
 * Every UI text renderer picks ONE language through T(): the game never shows Thai + English
 * together. In-world signage / posters / newspaper art stay Thai (diegetic).
 *   T(tl | string)  → the string in the current language (falls back to Thai when en is missing)
 *   TT(th, en)      → same for a literal pair
 *   onLang(fn)      → re-render on change (returns an unsubscribe)
 * Persisted in localStorage 'hp.lang'; 'hp.langChosen' marks that the first-launch picker ran.
 * ========================================================================================== */

export type Lang = 'th' | 'en';
type TLike = { th: string; en?: string | null } | string | null | undefined;

const KEY = 'hp.lang';
const CHOSEN = 'hp.langChosen';

function load(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'th') return q;
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'th') return v;
  } catch { /* storage blocked */ }
  return 'th';
}

let cur: Lang = load();
const subs = new Set<(l: Lang) => void>();

export function getLang(): Lang { return cur; }
export const isEn = () => cur === 'en';

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); localStorage.setItem(CHOSEN, '1'); } catch { /* storage blocked */ }
  if (l === cur) return;
  cur = l;
  for (const f of [...subs]) { try { f(l); } catch (e) { console.warn('[lang]', e); } }
}

export function langChosen(): boolean {
  try { return localStorage.getItem(CHOSEN) === '1' || new URLSearchParams(location.search).has('lang'); } catch { return true; }
}

export function onLang(fn: (l: Lang) => void): () => void { subs.add(fn); return () => subs.delete(fn); }

/** One string in the current UI language (Thai fallback). */
export function T(t: TLike): string {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (cur === 'en' && t.en) return t.en;
  return t.th ?? '';
}

export const TT = (th: string, en?: string | null) => (cur === 'en' && en ? en : th);

const THAI = /[฀-๿]/;
/**
 * Plain strings that carry both languages in one ("กดค้าง [Space] ข้าม · hold [Space] to skip",
 * "ไทย / English", "ไทย (English)") → only the current language's half. Strings that are not a
 * clean Thai/Latin pair are returned unchanged.
 */
export function bi(s: string | null | undefined): string {
  if (!s) return '';
  for (const sep of [' · ', ' / ', ' | ', '\n']) {
    const i = s.indexOf(sep);
    if (i <= 0) continue;
    const a = s.slice(0, i).trim(), b = s.slice(i + sep.length).trim();
    if (!a || !b) continue;
    const at = THAI.test(a), bt = THAI.test(b);
    if (at && !bt) return cur === 'en' ? b : a;
    if (bt && !at) return cur === 'en' ? a : b;
  }
  // "ไทย (English gloss)"
  const m = /^(.*[฀-๿].*?)\s*\(([^()฀-๿]+)\)\s*$/.exec(s);
  if (m) return cur === 'en' ? m[2].trim() : m[1].trim();
  return s;
}

/** T() for TL objects, bi() for plain strings. */
export function L(t: { th: string; en?: string | null } | string | null | undefined): string {
  return typeof t === 'string' ? bi(t) : T(t);
}
