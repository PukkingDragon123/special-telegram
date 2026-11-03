import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Action, Ctx } from '../../game/interact';
import { params, tl } from '../../core/util';
import type { ChoicePrompt } from '../../ui3d/choice';
import { defineRitualItems } from '../life/items';
import { LocalTalkers } from '../quests/api';
import { Shrine, shrineFrame } from './shrine';
import { RitualHost } from './host';
import { RitualFx, play } from './fx';
import { rstate, ensureState, type Phase } from './state';
import { CHANT, L, OFFER_KINDS, OFFER_NAME, MANUAL_PAGES, FLYER_LINES, type OfferKind } from './lines';
import { registerRitualTalk, talkTo } from './talk';

/* ============================================================================================
 * MODULE `ritual` — a hidden, very silly Thai ghost-summoning easter egg.
 *
 *  Clues: the homeless man (quests module), the amulet grandpa at the temple (sells ตำราเรียกผี ฉบับพกพา,
 *  99 ฿, and the offering set), a torn flyer on a bamboo stake by the spirit house at the back of the soi.
 *
 *  1. Put 5 offerings on the offering table in front of the ศาลพระภูมิ: น้ำแดงใส่หลอด, ไข่ต้ม, มาลัย, ม้าลาย,
 *     ธูป 3 ดอก (LMB with each).
 *  2. 23:00–23:59, E → everyone near kneels; 3 chant rounds (3D choices). Wrong words summon nonsense: the
 *     soi dog eats the eggs, a mosquito swarm, a voice from the dark that blows the incense out, the ghost's
 *     headless EX roaring by on his scooter, "seen" with no reply, an involuntary dance.
 *  3. Right words: wind howls, a rain squall, the laundry flaps, the street flickers, lightning, mist — and
 *     ผีนางรีวิว appears (a food-review influencer who died mid live-stream). People faint. She's annoyed about
 *     overtime, smells kaphrao, demands kaphrao moo + fried egg, extra spicy, waits at your cart (time frozen,
 *     5 minutes) — serve it (LMB with the dish).
 *  4. She eats on stream, reviews with ghostly 3D stars, takes a group selfie (your camera, flash, polaroid),
 *     writes lucky numbers in the air, leaves. ≥4★: a framed afterlife certificate + tomorrow's tips ×1.35.
 *  5. Next morning the lottery lady sells her number (80 ฿); at noon the draw: the two digits come out
 *     (+2,000 ฿), the three digits come out MIRRORED ("ghosts write backwards"). Both make the newspaper.
 *
 *  Dev: ?ritual=ready (offerings in hand, 23:05, at the shrine) · chant · summon · demand · serve (a perfect
 *  dish in hand) · window.__ritual
 * ========================================================================================== */

let G: Game;
let shrine: Shrine | null = null;
let fx: RitualFx | null = null;
let host: RitualHost | null = null;
let choice: ChoicePrompt | null = null;
let offLate: (() => void) | null = null;
let loops: any[] = [];
let lastPhase: Phase | '' = '';
let phaseStart = 0;
let now = 0;
let storm = 0, stormOn = false;

const V = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);
function ghostHead(gid?: number | null): THREE.Vector3 | null {
  if (gid == null) return null;
  const o = G.views.objectOf(gid);
  if (o) return o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.85, 0));
  const e = G.state.get(gid);
  return e?.p ? new THREE.Vector3(e.p[0], e.p[1] + 1.85, e.p[2]) : null;
}
function camFront(d = 1.2) {
  const cam = G.camera;
  return cam.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.05, -d).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())));
}
function meNear(p: THREE.Vector3, r: number) { const me = G.me; return !!me?.p && Math.hypot(me.p[0] - p.x, me.p[2] - p.z) < r; }

function stopLoops() { for (const l of loops) l?.stop?.(1.2); loops = []; }

// ------------------------------------------------------------------ client events

function installClient(game: Game) {
  game.on('ritual:chant', (d: { round: number; order: number[] }) => {
    const f = shrine?.frame ?? shrineFrame(game);
    play('bells_eerie|temple_bell', { pos: f.pos, vol: 0.5 });
    if (!meNear(f.pos, 9)) return;
    const R = CHANT[d.round];
    choice?.cancel();
    choice = game.ui.choose({
      prompt: R.prompt, seconds: 24,
      options: d.order.map((i) => R.opts[i].text),
      colors: [0xd8c8ff, 0xd8c8ff, 0xd8c8ff],
      onPick: (i) => { choice = null; if (i >= 0) game.intent('ritual.pick', { round: d.round, opt: d.order[i] }); },
    });
  });
  game.on('ritual:close', () => { choice?.cancel(); choice = null; });
  game.on('ritual:fx', (d: any) => {
    if (!fx) return;
    const f = shrine?.frame ?? shrineFrame(game);
    switch (d.k) {
      case 'storm':
        stormOn = !!d.on;
        stopLoops();
        if (d.on) {
          loops.push(play('eerie_drone_loop', { loop: true, vol: 0.75 }), play('wind_howl|wind_loop', { loop: true, vol: 0.8, pos: f.pos }));
          play('bells_eerie', { vol: 0.7 });
          setTimeout(() => play('heartbeat_slow', { vol: 0.6 }), 1500);
        }
        break;
      case 'lightning': if (meNear(f.pos, 80)) fx.lightning(d.power ?? 1); break;
      case 'appear':
        play('ghost_scare_sting', { vol: 0.9 });
        setTimeout(() => play('female_scream_comedic|gasp', { vol: 0.7 }), 350);
        fx.shake(0.7);
        if ((d.faint ?? []).includes(game.localPlayerId)) {
          fx.faint();
          setTimeout(() => game.ui.shout(camFront(1.1), L.wake, { duration: 2 }), 2700);
        }
        break;
      case 'word': { const h = ghostHead(d.gid); if (h) (window as any).__anime?.word?.(h, d.w, '#ffffff', 0.18); break; }
      case 'stars': fx.stars(() => ghostHead(d.gid), d.n); if (d.n >= 4) setTimeout(() => play('level_up_fanfare|crowd_cheer', { vol: 0.6 }), 2800); break;
      case 'selfie': fx.startSelfie(d.gid); break;
      case 'mosquito': if (meNear(V(d.p), 12)) fx.mosquitoes(V(d.p), 8); break;
      case 'words': fx.words(V(d.p), d.text, d.dur ?? 4); break;
    }
  });
  game.on('ritual:lotto', (d: { two: string; three: string; mirror: string; winners: string[] }) => {
    const lady = (game as any).life?.eggs?.talker?.('lottery_lady');
    const at = () => lady?.target?.head?.() ?? camFront(1.4);
    const far = !lady || !meNear(lady.pos, 40);
    const anchor = far ? () => camFront(1.4) : at;
    const pre = far ? '(วิทยุ) ' : '';
    play('icecream_cart_bell|ding_correct', { vol: 0.5 });
    game.ui.shout(anchor, { th: pre + L.lottoDraw.th, en: L.lottoDraw.en }, { duration: 2.6 });
    setTimeout(() => {
      const t = d.winners.length ? L.lottoWin(d.two, d.winners.join(', ')) : L.lottoNobody(d.two);
      game.ui.shout(anchor, { th: pre + t.th, en: t.en }, { duration: 4 });
      play(d.winners.length ? 'level_up_fanfare|crowd_cheer' : 'crowd_aww|lose_sting', { vol: 0.7 });
    }, 2900);
    if (d.mirror !== d.three) setTimeout(() => { const t = L.lottoMirror(d.three, d.mirror); game.ui.say(anchor, { th: pre + t.th, en: t.en }, { duration: 4.5 }); play('laugh_track', { vol: 0.5 }); }, 7600);
  });

  // ---- interactions
  game.interact.provide((ctx: Ctx) => {
    const acts: Action[] = [];
    const r = rstate(game);
    if (fx?.reading) acts.push({ key: 'E', label: tl('พลิกหน้า / ปิด', 'flip page / close'), priority: 30, run: () => fx!.flip() });
    const held = ctx.held;
    if (held?.k === 'ghost_manual' && !fx?.reading) acts.push({ key: 'LMB', label: tl('อ่านตำรา', 'read the manual'), priority: 6, run: () => fx?.paper(MANUAL_PAGES) });
    const hit = ctx.hit;
    if (!hit) return acts;
    if (hit.kind === 'ritual_flyer' && !fx?.reading) acts.push({ key: 'E', label: tl('อ่านใบปลิว', 'read the flyer'), priority: 8, run: () => fx?.paper([FLYER_LINES]) });
    if (hit.kind === 'ritual_shrine') {
      const off = r?.off ?? {};
      const missing = OFFER_KINDS.filter((k) => !off[k]);
      const status = () => (missing.length ? 'ยังขาด: ' + missing.map((k) => OFFER_NAME[k].th).join(' · ') : 'ของไหว้ครบแล้ว — ห้าทุ่มค่อยไหว้');
      const st = r?.st ?? 'idle';
      if (held && (OFFER_KINDS as readonly string[]).includes(held.k) && !off[held.k as OfferKind] && (st === 'idle' || st === 'oops')) {
        const n = OFFER_NAME[held.k as OfferKind];
        acts.push({ key: 'LMB', label: tl('ถวาย' + n.th, 'offer ' + (n.en ?? '')), priority: 10, status, run: () => game.intent('ritual.offer', { id: held.id }) });
      }
      if (st === 'idle') {
        const t = game.g.time ?? 7;
        const label = tl('ไหว้… เริ่มพิธีเรียกผี', 'pray… begin the summoning');
        if (missing.length) acts.push({ key: 'E', label, priority: 5, status, disabled: L.missing(missing.map((k) => OFFER_NAME[k].th).join(' ')) });
        else if (t < 23) acts.push({ key: 'E', label, priority: 5, status, disabled: L.notYet });
        else if (t >= 23.98) acts.push({ key: 'E', label, priority: 5, status, disabled: L.tooLate });
        else if (r?.done === (game.g.day ?? 1)) acts.push({ key: 'E', label, priority: 5, status, disabled: tl('คืนนี้เรียกไปแล้ว ผีเลิกงานแล้ว', 'already summoned tonight') });
        else acts.push({ key: 'E', label, priority: 9, status, run: () => game.intent('ritual.begin', {}) });
      }
    }
    if (hit.kind === 'ghost' && hit.ent?.kind === 'review' && r?.st === 'demand') {
      const status = () => { const left = Math.max(0, 300 - (now - phaseStart)); return `อยากกิน: กะเพราหมูสับไข่ดาว เผ็ดๆ · เหลือ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`; };
      if (held?.k === 'dish') acts.push({ key: 'LMB', label: tl('เสิร์ฟให้ผี', 'serve the ghost'), priority: 12, status, run: () => game.intent('ritual.serve', { id: held.id }) });
      else acts.push({ key: 'R', label: tl('อยากกินอะไรนะ?', 'what do you want?'), priority: 3, status, run: () => {} });
    }
    if (hit.kind === 'talker' && hit.data?.key) {
      const rec = LocalTalkers.map.get(hit.data.key);
      if (rec && (rec.target.role === 'amulet_grandpa' || rec.target.role === 'lottery_lady')) acts.push({ key: 'E', label: tl('คุย', 'talk'), priority: 4, run: () => talkTo(game, rec.target) });
    }
    return acts;
  }, 14);
}

// ------------------------------------------------------------------ dev

function devStart(game: Game, what: string) {
  let tries = 0;
  const go = () => {
    if (!game.player || !game.me?.p || !shrine) { if (tries++ < 600) setTimeout(go, 500); return; }
    const f = shrine.frame;
    game.player.teleport([f.kneel.x + 0.6, f.kneel.y, f.kneel.z], Math.PI / 2);
    host?.devJump(what, game.me);
    if (what === 'serve' || what === 'demand') setTimeout(() => {
      const gid = rstate(game)?.gid; const g = gid != null ? game.state.get(gid) : null;
      if (g?.p && game.player) {
        const yaw = g.yaw ?? 0;
        const p = [g.p[0] - Math.sin(yaw) * 2.2, game.world?.groundY(g.p[0], g.p[2]) ?? g.p[1], g.p[2] - Math.cos(yaw) * 2.2];
        game.player.teleport(p, yaw + Math.PI);
      }
    }, 600);
  };
  setTimeout(go, 800);
}

// ------------------------------------------------------------------ module

export default defineModule({
  id: 'ritual',
  deps: ['world', 'characters', 'life', 'cooking', 'restaurant'],
  init(game) {
    G = game;
    defineRitualItems(game);
    host = new RitualHost(game, () => shrine?.frame ?? shrineFrame(game));
    host.install();
    registerRitualTalk(game);
    installClient(game);
    game.events.on('world:exit', () => {
      offLate?.(); offLate = null;
      stopLoops();
      choice?.cancel(); choice = null;
      fx?.dispose(); fx = null;
      shrine?.dispose(); shrine = null;
      lastPhase = '';
    });
    (window as any).__ritual = {
      state: () => rstate(game), host: () => host, fx: () => fx, shrine: () => shrine,
      jump: (w: string) => { host?.devJump(w, game.me); },
    };
  },
  async buildWorld(game) {
    shrine = new Shrine(game);
    game.scene!.add(shrine.root);
    fx = new RitualFx(game);
    fx.attach(game.scene!);
    offLate?.();
    offLate = game.engine.onLate((f) => fx?.late(f.rawDt > 0 ? Math.min(0.1, f.rawDt) : 0)) as any;
    if (game.isHost) {
      // a save made mid-ritual: start clean (no stale phase, no leftover scripted ghost, time running)
      const r = ensureState(game);
      for (const gh of game.state.all('ghost')) if (gh.rit) game.state.despawn(gh);
      if (r.st !== 'idle') { (game.g as any).ritual = { ...r, st: 'idle', gid: undefined, t0: 0 }; delete (game.g as any).freezeTime; }
    }
    const dev = params.get('ritual');
    if (dev && game.isHost) devStart(game, dev);
  },
  hostUpdate(game, dt) {
    if (!host || game.g.scene !== 'world') return;
    host.update(dt);
  },
  frame(game, dt) {
    if (!shrine || !fx) return;
    now += dt;
    const r = rstate(game);
    const st = (r?.st ?? 'idle') as Phase;
    if (st !== lastPhase) { lastPhase = st; phaseStart = now; }
    const el = now - phaseStart;
    // atmosphere: the summoning storm (mist, smoke spiral, power flicker)
    const want = stormOn || st === 'summon' ? 1 : st === 'chant' ? 0.25 : 0;
    storm += (want - storm) * Math.min(1, dt * (want > storm ? 1.2 : 0.4));
    shrine.storm = storm;
    fx.setFlicker(st === 'summon' ? (el < 6 ? (el / 6) * 0.6 : el < 33 ? 0.85 : 0) : st === 'bye' && el > 5 && el < 7 ? 0.6 : 0);
    shrine.sync(r);
    shrine.showNumbers(r, game.g.day ?? 1);
    shrine.tick(dt, r, game.camera);
    fx.frame(dt);
  },
  onNewDay(_game, day) { host?.onNewDay(day); },
});
