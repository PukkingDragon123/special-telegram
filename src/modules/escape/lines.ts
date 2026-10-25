import { tl, TL } from '../../core/util';

/* Dialogue for the "wanted" cinematic (natural spoken Thai first, short English gloss). */

/** the hero sees the cops / the poster */
export const GASP: TL[] = [
  tl('ตำรวจ!!', 'Police!!'),
  tl('หมายจับ!?', 'A WARRANT!?'),
  tl('หน้าเรานี่หว่า!', "That's MY face!"),
  tl('ซวยแล้ว!!', "We're done for!!"),
];

/** cop #1 thinks he saw something */
export const COP_SUSPECT: TL[] = [
  tl('เมื่อกี้เหมือนเห็นใครนะ…', 'Did I just see someone…?'),
  tl('ใครอยู่ตรงนั้นน่ะ!?', "Who's over there!?"),
  tl('เสียงอะไรน่ะ… ออกมานะ!', 'What was that… come out!'),
];

/** cop #2 can't be bothered */
export const COP_DISMISS: TL[] = [
  tl('ช่างมันเถอะ ไปกินก๋วยเตี๋ยวกัน', "Forget it, let's go eat noodles."),
  tl('แมวมั้ง… ไปหาข้าวมันไก่กินเถอะ', 'Probably a cat… chicken rice?'),
  tl('หมาจรน่ะ เลิกเวรแล้ว หิว!', "Stray dog. Shift's over, I'm starving!"),
];

/** cop #1 agrees (short) */
export const COP_AGREE: TL[] = [
  tl('เออ ๆ หิวพอดี', 'Yeah yeah, I’m hungry anyway.'),
  tl('ร้านเจ๊ไก่นะ เผ็ด ๆ', "Auntie Kai's place. Extra spicy."),
  tl('ไปก็ไป', 'Fine, let’s go.'),
];

/** relief after the cops leave */
export const RELIEF: TL[] = [
  tl('เฮ้อ… รอดตัวไป', 'Phew… that was close.'),
  tl('เกือบไปแล้ว…', 'Too close…'),
  tl('กลับไปผัดกะเพราดีกว่า', 'Back to frying kaphrao.'),
  tl('ออกไปไม่ได้จริง ๆ แฮะ', "Guess I really can't leave."),
];

/** short version (tried again too soon) */
export const AGAIN: TL[] = [
  tl('ไม่ไหว ๆ ตำรวจยังอยู่!', 'Nope nope, cops are still there!'),
  tl('อย่าเพิ่งดีกว่า…', 'Better not…'),
  tl('ได้ยินนกหวีดอีกแล้ว!', 'The whistle again!'),
];

/** reward line on the poster (they're broke: the reward is funny) */
export const REWARDS = ['500', '999', '1,500', '300'];
