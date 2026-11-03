import type { Game } from '../../game/game';
import { tl, type TL } from '../../core/util';
import { Dialogues, Quests, questApi, type TalkTarget, type DlgCtx } from '../quests/api';
import { GRANDPA_SHOP } from './lines';
import { rstate } from './state';

/* ============================================================================================
 * ritual — the two talkable easter-egg sellers (life/eggs.ts registers them as LocalTalkers):
 *   ตาเปลี่ยน (amulet_grandpa, temple, 7–17): rumours about the spirit house, sells the pocket summoning
 *     manual, the full offering set and incense.
 *   ป้าสมพร (lottery_lady, soi mouth, 7:30–18:30): after the ghost wrote her numbers, sells that ticket;
 *     announces the draw at noon.
 * Conversations go through the quests runtime (floating 3D dialogue). Without it, E opens a quick
 * 3D choice instead (fallbackTalk).
 * ========================================================================================== */

const wallet = (c: DlgCtx) => c.me?.wallet ?? 0;
const cant = (price: number) => (c: DlgCtx) => (wallet(c) < price ? `ต้องมี ${price} ฿` : null);

export function registerRitualTalk(game: Game) {
  const buy = (what: string) => () => game.intent('ritual.buy', { what });
  const item = (id: string) => GRANDPA_SHOP.find((x) => x.id === id)!;

  Dialogues.register({
    id: 'ritual_grandpa',
    match: (t) => t.role === 'amulet_grandpa',
    priority: 5,
    voice: 0.78,
    barks: [tl('พระเครื่องจ้า แท้ทุกองค์', 'Amulets! All genuine'), tl('ตำราเรียกผี ไม่ได้ผลยินดีคืนเงิน… มั้ง', 'Ghost manual: money back if it fails… probably')],
    start: () => 'hi',
    nodes: [
      {
        id: 'hi', say: tl('มาๆ หลาน ดูพระก่อน… หรือจะ "เรียกผี"?', 'Come, kid. Amulets… or do you want to "call a ghost"?'), anim: 'talk',
        options: [
          { text: tl('เรียกผีได้จริงเหรอตา?', 'You can really summon ghosts?'), next: 'rumor' },
          { text: tl(`ขอ${item('manual').name.th} (99 ฿)`, 'The summoning manual (99 ฿)'), lock: cant(99), do: buy('manual'), next: 'sold' },
          { text: tl('ขอชุดของไหว้จัดเต็ม (149 ฿)', 'The full offering set (149 ฿)'), lock: cant(149), do: buy('set'), next: 'soldSet' },
          { text: tl('ธูป 3 ดอก (10 ฿)', 'Incense ×3 (10 ฿)'), lock: cant(10), do: buy('incense'), next: 'soldSmall' },
          { text: tl('ไว้ก่อนนะตา', 'Maybe later, grandpa'), end: true },
        ],
      },
      {
        id: 'rumor', say: tl('ศาลท้ายซอยน่ะ… ห้าทุ่มตรง ของไหว้ครบห้าอย่าง ท่องคาถาให้ถูก… ผีจะมา', 'The spirit house at the back of the soi… 11 PM sharp, five offerings, the right chant… and she comes'), anim: 'think',
        options: [
          { text: tl('แล้วผีที่มาเป็นใคร?', 'Who comes?'), next: 'who' },
          { text: tl('ท่องผิดจะเป็นไง?', 'What if I get the chant wrong?'), next: 'wrong' },
          { text: tl('ขอซื้อตำราเลย!', 'Sell me the manual!'), lock: cant(99), do: buy('manual'), next: 'sold' },
        ],
      },
      { id: 'who', say: tl('เขาว่าเป็นสาวชุดขาว ถือมือถือ ชอบถามว่า "ร้านนี้อร่อยไหม"… ตาก็ไม่รู้ว่าอะไร', 'They say a lady in white with a phone, asking "is this place any good?"… no idea what that means'), anim: 'shrug', next: 'hi' },
      { id: 'wrong', say: tl('เคยมีคนท่องผิด ได้หมามากินไข่ต้มไปทั้งจาน อีกคนได้แฟนเก่าผีมาแทน… ไม่มีหัวด้วยนะ', 'One guy got it wrong: a dog ate all the eggs. Another got the ghost\'s EX instead… no head, either'), anim: 'talk', next: 'hi' },
      { id: 'sold', say: tl('เอาไป! อ่านให้ดีนะ (กดซ้ายค้างไว้เพื่ออ่าน) ท่องผิดเดี๋ยวได้แฟนเก่าผีมาแทน', "Here! Read it carefully (LMB to read). Get it wrong and you'll get her ex"), anim: 'give' },
      { id: 'soldSet', say: tl('ครบห้าอย่าง น้ำแดง ไข่ต้ม มาลัย ม้าลาย ธูป วางบนโต๊ะหน้าศาลนะ', 'All five: red soda, eggs, garland, zebra, incense. Put them on the table at the shrine'), anim: 'give' },
      { id: 'soldSmall', say: tl('เอาไปปักกระถางหน้าศาล ไฟแช่ะเดียวติด', 'Stick them in the pot at the shrine, one click and they light'), anim: 'give' },
    ],
  });

  Dialogues.register({
    id: 'ritual_lottery',
    match: (t) => t.role === 'lottery_lady',
    priority: 5,
    voice: 1.2,
    barks: [tl('หวยจ้า หวย! เลขสวยๆ', 'Lottery! Pretty numbers!'), tl('งวดนี้รวยแน่ๆ จ้า', "This one's a winner, dear")],
    start: (c) => {
      const r = rstate(c.game);
      const n = r?.nums;
      if (n && r?.drawn) return 'drawn';
      if (n && (c.game.g.day ?? 1) === n.day && (c.game.g.time ?? 7) < 12) return r?.tix?.[String(c.me.id)] ? 'waitDraw' : 'ghostnum';
      return 'hi';
    },
    nodes: [
      {
        id: 'hi', say: tl('หวยจ้า หวย! เลขสวยๆ ทั้งนั้น', 'Lottery! Pretty numbers only!'), anim: 'talk',
        options: [
          { text: tl('มีเลขเด็ดไหมป้า?', 'Got any lucky numbers?'), next: 'tip' },
          { text: tl('ไว้ก่อนครับป้า', 'Not today'), end: true },
        ],
      },
      { id: 'tip', say: tl('เลขเด็ดต้องไปขอผีโน่น ศาลท้ายซอย… ป้าล้อเล่น! (มั้ง)', 'For REAL lucky numbers you ask a ghost at the back of the soi… just kidding! (maybe)'), anim: 'shrug' },
      {
        id: 'ghostnum', say: (c) => { const n = rstate(c.game)!.nums!; return tl(`เมื่อคืนได้ยินว่ามีผีมาบอกเลข ${n.two}… จริงเหรอ!?`, `I heard a ghost told you ${n.two} last night… is that true!?`); }, anim: 'talk', face: 'shock',
        options: [
          { text: (c) => tl(`ขอเลข ${rstate(c.game)?.nums?.two} ใบนึงครับ (80 ฿)`, `One ticket, ${rstate(c.game)?.nums?.two} (80 ฿)`), lock: cant(80), do: () => game.intent('ritual.lotto', {}), next: 'bought' },
          { text: tl('ไม่ซื้อดีกว่า กลัวผีหลอก', "No, the ghost's probably trolling"), next: 'nobuy' },
        ],
      },
      { id: 'bought', say: (c) => tl(`เลข ${rstate(c.game)?.nums?.two}… ขนลุกเลย! หวยออกเที่ยงนะ มาฟังด้วย`, `${rstate(c.game)?.nums?.two}… goosebumps! The draw is at noon, come listen`), anim: 'count_coins' },
      { id: 'nobuy', say: tl('เดี๋ยวออกมาจะร้องไห้นะ', "Don't cry when it comes out"), anim: 'shrug' },
      { id: 'waitDraw', say: tl('ใจเย็นๆ หวยออกเที่ยง ป้าก็ลุ้นด้วย', 'Patience, the draw is at noon. I\'m nervous too'), anim: 'talk' },
      { id: 'drawn', say: (c) => tl(`งวดนี้ออก ${rstate(c.game)?.nums?.two}… ป้ายังขนลุกอยู่เลย`, `It came out ${rstate(c.game)?.nums?.two}… I still have goosebumps`), anim: 'talk' },
    ],
  });

  // a hidden side quest: shows up only once someone owns the pocket manual
  Quests.register({
    id: 'ritual_nang_review',
    title: tl('เรียกผีนางรีวิว', 'Summon the Review Ghost'),
    giver: 'amulet_grandpa',
    order: 90,
    available: (g) => !!(g.g as any).ritual?.manual,
    offer: tl('อยากลองของจริงไหมหลาน? ห้าทุ่ม ศาลท้ายซอย', 'Want to try it for real, kid? 11 PM, the shrine at the back of the soi'),
    startLine: tl('ตาเตือนแล้วนะ', "Don't say I didn't warn you"),
    doneLine: tl('จริงเหรอ!? ตาขายตำรามาสามสิบปี เพิ่งเคยได้ผล', "Really!? I've sold that book for 30 years, first time it ever worked"),
    steps: [
      { id: 'offer', text: tl('วางของไหว้ 5 อย่างบนโต๊ะหน้าศาลท้ายซอย', 'Put the 5 offerings on the table at the back-soi shrine'), done: (g) => { const o = (g.g as any).ritual?.off ?? {}; return ['red_soda', 'boiled_eggs', 'garland', 'zebra_figurine', 'incense'].every((k) => o[k]) || ((g.g as any).ritual?.st ?? 'idle') !== 'idle'; }, where: () => [-6.5, 0.15, -152.4] },
      { id: 'chant', text: tl('ห้าทุ่ม: ไหว้แล้วท่องคาถาให้ถูก', '11 PM: pray and chant the right words'), done: (g) => ['summon', 'demand', 'eat', 'review', 'selfie', 'numbers', 'bye'].includes((g.g as any).ritual?.st) },
      { id: 'serve', text: tl('เสิร์ฟกะเพราหมูสับไข่ดาว เผ็ดๆ ให้ผี', 'Serve the ghost spicy kaphrao + fried egg'), done: (g) => ['review', 'selfie', 'numbers', 'bye'].includes((g.g as any).ritual?.st) || (g.g as any).ritual?.done === (g.g.day ?? 1) },
    ],
    reward: { rep: 1, note: tl('ใบรับรองจากโลกหลังความตาย + เลขเด็ด', 'a certificate from the afterlife + lucky numbers') },
  });
}

/** E on a seller without the quests runtime: a quick 3D choice menu (same actions) */
export function fallbackTalk(game: Game, t: TalkTarget) {
  const head = t.head();
  const say = (x: TL) => head && game.ui.say(() => t.head(), x, { duration: 3.5 });
  if (t.role === 'amulet_grandpa') {
    say(tl('มาๆ หลาน ดูพระ… หรือจะ "เรียกผี"?', 'Amulets… or do you want to "call a ghost"?'));
    t.act?.('talk');
    game.ui.choose({
      prompt: tl('ตาเปลี่ยน', 'Grandpa Plian'), seconds: 12,
      options: [tl('เรียกผีได้จริงเหรอ', 'Ghosts, really?'), tl('ตำราเรียกผี 99 ฿', 'manual 99 ฿'), tl('ชุดของไหว้ 149 ฿', 'offering set 149 ฿'), tl('ธูป 10 ฿', 'incense 10 ฿')],
      onPick: (i) => {
        if (i === 0) say(tl('ศาลท้ายซอย ห้าทุ่มตรง ของไหว้ครบห้าอย่าง ท่องให้ถูก… ผีจะมา', 'Back-soi shrine, 11 PM, five offerings, the right chant… she comes'));
        if (i === 1) game.intent('ritual.buy', { what: 'manual' });
        if (i === 2) game.intent('ritual.buy', { what: 'set' });
        if (i === 3) game.intent('ritual.buy', { what: 'incense' });
      },
    });
    return;
  }
  if (t.role === 'lottery_lady') {
    const r = rstate(game);
    const n = r?.nums;
    const canBuy = n && !r?.drawn && (game.g.day ?? 1) === n.day && (game.g.time ?? 7) < 12 && !r?.tix?.[String(game.localPlayerId)];
    t.act?.('talk');
    if (!canBuy) { say(n && r?.drawn ? tl(`งวดนี้ออก ${n.two}… ขนลุก`, `It came out ${n.two}… goosebumps`) : tl('เลขเด็ดต้องไปขอผีโน่น… ป้าล้อเล่น!', 'Lucky numbers? Ask a ghost… kidding!')); return; }
    say(tl(`ได้ยินว่าผีบอกเลข ${n!.two}… จริงเหรอ!?`, `A ghost told you ${n!.two}… really!?`));
    game.ui.choose({ prompt: tl('ป้าสมพร', 'Auntie Somporn'), seconds: 10, options: [tl(`ซื้อเลข ${n!.two} (80 ฿)`, `buy ${n!.two} (80 ฿)`), tl('ไม่ซื้อ', 'no')], onPick: (i) => { if (i === 0) game.intent('ritual.lotto', {}); } });
  }
}

export function talkTo(game: Game, t: TalkTarget) {
  const q = questApi(game);
  if (q) q.talk(t); else fallbackTalk(game, t);
}
