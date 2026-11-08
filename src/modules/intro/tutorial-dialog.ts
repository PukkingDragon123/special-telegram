import type { Game } from '../../game/game';
import { tl } from '../../core/util';
import { Dialogues, DlgCtx, TalkTarget } from '../quests/api';
import { LESSON, pick } from './lines';

/* ============================================================================================
 * Talking to Uncle Heng during the tutorial ([E] "คุย" on him while he teaches): he repeats the current
 * cooking step (with extra nagging), tells stories, and answers your dumb questions. Registered with the
 * quests dialogue runtime (floating 3D text + response cards), priority above his everyday dialogue.
 * ========================================================================================== */

const T = tl;
const active = (game: Game) => { const s = (game.g as any).introStep; return s === 'lesson' || s === 'customer' || s === 'dog' || s === 'go_market'; };

let done = false;
export function registerTutorialDialogue() {
  if (done) return;
  done = true;
  Dialogues.register({
    id: 'tut_oldman', priority: 20, voice: 0.72,
    match: (t: TalkTarget, game: Game) => t.role === 'oldman' && active(game),
    barks: [T('ไฟแรงๆ ไอ้หนู!', 'High heat, kid!'), T('อย่ายืนเกาตูด!', "Don't stand there scratching your ass!"), T('ข้อมือ! ใช้ข้อมือ!', 'The wrist! Use the wrist!')],
    start: (c: DlgCtx) => ((c.game.g as any).introStep === 'lesson' ? 'lesson' : 'after'),
    nodes: [
      {
        id: 'lesson', anim: 'lecture',
        say: (c: DlgCtx) => {
          const st = (c.game.g as any).introLesson;
          const txt = st ? LESSON.stages[st] : null;
          return txt ? T(`${txt.say.th} …ฟังให้ดีนะ จะไม่พูดซ้ำ! (พูดซ้ำมาสามรอบแล้ว)`, `${txt.say.en} …listen properly, I won't repeat it! (third time now)`) : T('ฟังลุงพูดก่อน! เดี๋ยวลุงบอกขั้นต่อไป', "Listen first! I'll tell you the next step");
        },
        options: [
          { text: T('ลุงขายรถเข็นมากี่ปีแล้วครับ?', 'How long have you sold from this cart?'), next: 'years' },
          { text: T('ทำไมลุงไม่แจ้งตำรวจจับผมล่ะ?', "Why didn't you call the cops on me?"), next: 'cops' },
          { text: T('ลุงผัดให้ดูหน่อยได้ไหม?', 'Can you just do it for me?'), next: 'lazy' },
          { text: T('เข้าใจแล้วครับ!', 'Got it!'), end: true },
        ],
      },
      { id: 'years', face: 'think', say: T('สี่สิบปี! ตั้งแต่กะเพราจานละห้าบาท ส่งลูกสามคนจบมหาลัยด้วยรถคันนี้ แล้วมึงจะมาขโมยมันไปขายเศษเหล็ก! ไอ้เวร!', "Forty years! Since kaphrao was five baht. Put three kids through university with this cart. And you tried to sell it for scrap! You jerk!"), next: 'lesson' },
      { id: 'cops', anim: 'laugh', say: T('ตำรวจมาถึงก็ตีห้า กินกะเพราลุงฟรีอีก! เสียของ! เอามึงมาผัดให้ลุงคุ้มกว่า', "The cops would show up at five and eat my kaphrao for free! Waste! Making you cook is better value"), next: 'lesson' },
      { id: 'lazy', anim: 'angry', face: 'scream', say: T('ไอ้ขี้เกียจ! ลุงผัดมาสี่สิบปี หลังจะหักแล้ว! ทำเอง! ผิดก็ผิด ลุงด่าเอง!', "Lazy bum! Forty years of cooking, my back is broken! Do it yourself! Mess up and I'll yell, that's how you learn!"), next: 'lesson' },
      {
        id: 'after', anim: 'talk',
        say: (c: DlgCtx) => (c.game.g as any).introStep === 'customer'
          ? T('ยกจานไปให้ลูกค้าสิ! ยืนคุยกับลุงทำไม ลูกค้ารอ!', "Take the plate to the customer! Why are you chatting with me, he's waiting!")
          : T(pick(['ไปตลาดได้แล้ว! ป้าแดงแผงหมู บอกว่าลุงเฮงส่งมา', 'ลุงจะไปเกษียณแล้ว อย่ามาเกาะแข้งเกาะขา', 'ล้อซ้ายหยอดน้ำมันด้วยนะ อย่าลืม!']), pick(["Go to the market! Auntie Daeng, pork stall — say Heng sent you", "I'm retiring, stop clinging to my legs", "Oil the left wheel, don't forget!"])),
        options: [
          { text: T('ขอบคุณนะครับลุง… จริงๆ', 'Thank you, uncle… really'), next: 'thanks' },
          { text: T('ไปละครับ!', "I'm off!"), end: true },
        ],
      },
      { id: 'thanks', anim: 'sad', face: 'think', say: T('…เออๆ ไม่ต้องมาซึ้ง ตั้งใจทำมาหากิน อย่ากลับไปบ่อนอีก ไม่งั้นลุงตามไปเตะถึงชายแดน', "…yeah yeah, don't get sappy. Work hard, never go back to that casino, or I'll chase you to the border and kick your ass"), end: true },
    ],
  });
}
