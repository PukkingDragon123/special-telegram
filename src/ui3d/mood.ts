import type { Expression } from '../game/contracts';

/* ============================================================================================
 * Speaker hooks for floating 3D speech: a character rig (optional methods, see CharacterRig in
 * contracts) gets its mouth flapping while a line types out and a facial expression that matches
 * the line. The mood is either given by the caller or guessed from the Thai / English text.
 * ========================================================================================== */

export interface Speaker {
  setTalking?(on: boolean): void;
  setExpression?(e: Expression, opts?: { weight?: number; hold?: number; fade?: number }): void;
}

const RULES: [RegExp, Expression][] = [
  [/555|ฮ่า|ฮา{2,}|ขำ|😂|🤣|haha|lol/i, 'laugh'],
  [/ผี|กลัว|หลอน|ช่วยด้วย|😱|scared|ghost|help!/i, 'scared'],
  [/ห๊ะ|หา\?|อะไรนะ|จริงดิ|เฮ้ย!|ตายแล้ว|โอ้โห|ว้าว|\?!|!\?|what\?!|wow|whoa/i, 'shocked'],
  [/โว้ย|ไอ้|บ้าเอ๊ย|โกรธ|เดี๋ยวเหอะ|หนวกหู|ไปให้พ้น|😡|damn|angry|get out/i, 'angry'],
  [/เสียใจ|เศร้า|ร้องไห้|ฮือ|เฮ้อ|เหนื่อย|ซวย|TT|T_T|😢|sorry|sigh|sad/i, 'sad'],
  [/หึหึ|หึ\b|แน่นอน|ง่ายๆ|เรื่องเล็ก|เจ๋ง|😏|easy|of course/i, 'smug'],
  [/สู้|ลุย|ต้องทำได้|เอาล่ะ|พร้อม|💪|let'?s go|ready/i, 'determined'],
  [/ขอบคุณ|ขอบใจ|ดีใจ|เยี่ยม|สุดยอด|อร่อย|น่ารัก|ยินดี|เย้|😊|😄|thank|great|nice|yay|delicious/i, 'happy'],
  [/แหวะ|เหม็น|ยี้|disgust|gross|yuck/i, 'disgust'],
];

/** best-guess expression for a line (null = keep whatever face the character has) */
export function moodOf(th: string, en?: string | null): Expression | null {
  const t = `${th ?? ''} ${en ?? ''}`;
  for (const [re, e] of RULES) if (re.test(t)) return e;
  if (/!{2,}/.test(t)) return 'shocked';
  return null;
}

/** start speaking: mouth flap on + expression (held a little past the typing time) */
export function speakStart(sp: Speaker | null | undefined, th: string, en: string | null | undefined, mood: Expression | null | undefined, holdS: number) {
  if (!sp) return;
  try {
    sp.setTalking?.(true);
    const m = mood === undefined ? moodOf(th, en) : mood;
    if (m && m !== 'neutral') sp.setExpression?.(m, { hold: Math.max(1.5, holdS), fade: 0.18 });
  } catch (e) { console.warn('[ui3d] speaker', e); }
}

export function speakStop(sp: Speaker | null | undefined) {
  if (!sp) return;
  try { sp.setTalking?.(false); } catch {}
}
