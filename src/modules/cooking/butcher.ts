import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { tl, TL } from '../../core/util';
import { ING } from './data';

/* =============================================================================================
 * BUTCHER (client side): whole cuts from the butcher stall must be RINSED (tap / wash tub / basin /
 * bucket), then cut on the board with the cleaver in RHYTHM: every LMB is one chop; hits ~0.3–0.6 s
 * apart are "on beat" (big progress, satisfying thunk + camera kick), mashing or dawdling slips
 * (little progress + a swearing joke). Stage 1 = sliced, stage 2 = minced (sim.ts advanceCut).
 * ============================================================================================= */

const WASH_TARGETS = new Set(['wash_tub', 'water_basin', 'bucket']);

const L = (th: string, en: string): TL => tl(th, en);
const UNWASHED = [
  L('ล้างก่อนสิวะ ไอ้บ้า! เลือดยังเยิ้มอยู่เลย', 'Rinse it first, you idiot! It\'s still bloody'),
  L('หมูยังไม่ล้างจะวางเขียงเหรอ ลูกค้าท้องเสียแม่งฟ้องตายเลย', 'Unwashed meat on the board? Customers get the runs and sue your ass'),
  L('เอาไปล้างที่ก๊อกก่อน เดี๋ยวลุงบ่นหูชาเลยนะมึง', 'Wash it at the tap first, or the old man will nag your ears off'),
];
const TOO_FAST = [
  L('ใจเย็นๆ เดี๋ยวนิ้วขาด!', 'Easy! You\'ll chop a finger off!'),
  L('สับเหมือนหมาบ้า… จังหวะสิวะ', 'Chopping like a mad dog… find the rhythm, damn it'),
  L('เกือบโดนนิ้วแล้วไอ้ควาย!', 'Nearly got your finger, dumbass!'),
  L('มีดไม่ใช่กลองนะเว้ย ตีมั่วซั่ว', 'It\'s a cleaver, not a drum, stop bashing'),
];
const TOO_SLOW = [
  L('หั่นช้าเหมือนเต่าคลาน ลูกค้ารอแม่งหลับแล้ว', 'Slow as a turtle, the customer fell asleep'),
  L('ฟันทีนึงพักทีนึง… นี่หั่นหมูหรือนั่งสมาธิ', 'One chop, one nap… cutting meat or meditating?'),
];
const ON_BEAT = [
  L('ฉับ! ฉับ! ฉับ! โคตรโปร', 'Chop! Chop! Chop! Pro as hell'),
  L('จังหวะดีชิบหาย เชฟมิชลินยังอาย', 'Rhythm so good a Michelin chef would cry'),
  L('การผัดคือศิลปะ แต่การหั่นคือดนตรี!', 'Stir-frying is art, but chopping is music!'),
];
const STAGE = [
  L('สไลซ์เสร็จ! สวยเหมือนร้านดัง', 'Sliced! Pretty as a famous shop'),
  L('สับละเอียดแล้ว! พร้อมลงกระทะ', 'Minced fine! Ready for the wok'),
];
const WASHED = [
  L('ล้างสะอาดแล้ว ไม่ต้องกลัวท้องร่วง', 'Rinsed clean, no food poisoning today'),
  L('สะอาดกว่าชีวิตกูอีก', 'Cleaner than my life'),
];
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

export function installButcher(game: Game) {
  let lastHit = 0;
  let streak = 0;
  let bad = 0;
  let lastJoke = -99;
  const now = () => performance.now() / 1000;
  const joke = (t: TL, gap = 2.5) => {
    const n = now();
    if (n - lastJoke < gap) return;
    lastJoke = n;
    (game as any).hud?.monologue?.(t, 2.4);
    if (game.me) game.say(game.me.id, t, { style: 'shout', duration: 2.2 } as any);
  };
  const popAt = (b: Ent, text: string, good: boolean) => {
    const p = game.items.worldPos(b);
    if (!p) return;
    p.y += 0.12;
    try { (game.ui as any).popup?.(p, text, { style: { size: 40, weight: 900, color: good ? '#ffffff' : '#ffb0a0' } as any, dur: 0.6, scale: 0.5 }); } catch { /* visual only */ }
  };

  game.on('cook:cutStage', (d: { by: number; stage: number }) => { if (d.by === game.localPlayerId) joke(STAGE[d.stage - 1] ?? STAGE[0], 0); });
  game.on('cook:washed', (d: { by: number }) => { if (d.by === game.localPlayerId) joke(pick(WASHED), 0); });

  return (ctx: Ctx): Action[] | null => {
    const held = ctx.held;
    const h = ctx.hit;
    const acts: Action[] = [];
    const hdef = held ? ING[held.k] : null;
    const t: Ent | null = h?.ent?.t === 'item' ? h.ent : null;
    // ---- rinse a whole cut
    if (held && hdef?.needsWash && !held.data?.washed && (h?.kind === 'water_tap' || (t && (WASH_TARGETS.has(t.k) || (t.data?.water ?? 0) > 0.3)))) {
      acts.push({ key: 'E', label: L('ล้างเนื้อ', 'rinse the meat'), priority: 9, run: () => game.intent('cook.wash', { id: held.id }) });
    }
    // ---- unwashed onto the board: the old man's voice in your head
    if (held && hdef?.needsWash && !held.data?.washed && t?.k === 'chopping_board') {
      acts.push({ key: 'LMB', label: L('ต้องล้างก่อน!', 'rinse it first!'), priority: 9, run: () => joke(pick(UNWASHED), 0.5) });
    }
    // ---- rhythm cleaver chops on a board holding a whole cut
    if (held?.k === 'cleaver' && t?.k === 'chopping_board' && t.data?.cutKind) {
      const cut = t.data?.cut ?? 0;
      const stage = cut < 1 ? 'สไลซ์' : 'สับ';
      acts.push({
        key: 'LMB', label: L(`ฟัน! (${stage} ${Math.round((cut % 1) * 100)}%)`, `chop! (${cut < 1 ? 'slice' : 'mince'})`), priority: 10,
        run: () => {
          const n = now();
          const gap = n - lastHit;
          lastHit = n;
          // beat window ~0.28–0.65 s between hits; the first hit of a run counts as fair
          let q: number;
          if (gap > 2) q = 0.55;
          else if (gap < 0.16) q = 0.05;
          else if (gap < 0.28) q = 0.35;
          else if (gap <= 0.65) q = 1 - Math.abs(gap - 0.42) * 1.6;
          else if (gap <= 1.2) q = 0.4;
          else q = 0.25;
          q = Math.max(0, Math.min(1, q));
          game.intent('cook.chopHit', { board: t.id, cleaver: held.id, q });
          (game as any).cookCam?.kick?.(0.35 + q * 0.65);
          if (q > 0.75) { streak++; bad = 0; popAt(t, streak > 2 ? `ฉับ! ×${streak}` : 'ฉับ!', true); if (streak === 6 || streak === 14) joke(pick(ON_BEAT), 0); }
          else { streak = 0; bad++; popAt(t, gap < 0.28 ? 'มั่ว!' : 'ช้า!', false); if (bad >= 2) { bad = 0; joke(pick(gap < 0.28 ? TOO_FAST : TOO_SLOW)); } }
        },
      });
    }
    return acts.length ? acts : null;
  };
}

export const _bv = new THREE.Vector3();
