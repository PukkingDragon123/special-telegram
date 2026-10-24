import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Ctx, Action } from '../../game/interact';
import { tl, Ease } from '../../core/util';
import { Sound } from '../../core/audio';
import { Radial } from './radial';
import { Sparkles, cheekPrint, shake, lensSmack, headPos, handPos, rigOf } from './fx';
import { buildMoney, AMOUNTS } from './money';
import { pick } from './lines';
import { hostTimers, localTimers, READING_MODES, bump, dist2, anim, isPlayer } from './state';

/* ============================================================================================
 * SOCIAL ACTIONS — right-click a friend: ตบ SLAP / ไฮไฟว์ HIGH-FIVE / ให้เงิน GIVE MONEY, and
 * [E] แย่ง on a friend's body to snatch what they hold (→ tug-of-war, tug.ts).
 *   intents  social.slap {to} · social.highfive {to} · social.give {to, amount} · social.snatch {to}
 *   events   social:slap {by,to,drop,iron,was} · social:hf_offer {by,to} · social:hf_clap {a,b}
 *            social:hf_hang {by} · social:give {by,to,amount} · social:interrupt {id,by,reason}
 * ========================================================================================== */

const SLAP_IMPACT = 0.42;
const HF_WINDOW = 2.4;

let radial: Radial | null = null;
export function radialOpen() { return !!radial; }

/** pending high-five offers (host) : by → { to, until } */
const offers = new Map<number, { to: number; until: number }>();
/** what every peer knows about live offers (for prompts): by → to */
export const liveOffers = new Map<number, { to: number; t: number }>();

export function installActions(game: Game, sparks: Sparkles, onKnockOut: (victim: Ent, reason: string) => void) {
  // ------------------------------------------------------------------ interaction (local)
  game.interact.provide((ctx: Ctx) => {
    const h = ctx.hit;
    if (!h || h.kind !== 'player' || h.eid === undefined || h.eid === ctx.me.id) return;
    const other = game.state.get(h.eid);
    if (!isPlayer(other)) return;
    if (radial) return;
    const acts: Action[] = [];
    const offer = liveOffers.get(other.id);
    if (offer && offer.to === ctx.me.id) {
      acts.push({ key: 'RMB', label: tl('ไฮไฟว์!', 'high five!'), priority: 20, run: () => game.intent('social.highfive', { to: other.id }) });
    } else if (other.mode === 'tug' || ctx.me.mode === 'tug') {
      // nothing during a tug-of-war
    } else {
      const title = other.mode === 'think' ? tl('ตบให้ตื่นจากภวังค์', 'slap them out of it') : other.mode === 'sleep' ? tl('ตบปลุก', 'slap awake') : tl('ตบ · ไฮไฟว์ · ให้เงิน', 'slap · high five · money');
      acts.push({ key: 'RMB', label: title, priority: 10, run: () => openRadial(game, other.id) });
      const held = game.items.selected(other);
      if (held && other.mode !== 'sleep') {
        acts.push({ key: 'E', label: tl('แย่ง' + game.items.name(held).th + '!', 'snatch!'), priority: 6, run: () => game.intent('social.snatch', { to: other.id }) });
      }
    }
    return acts;
  }, 10);

  // ------------------------------------------------------------------ HOST: slap
  game.onIntent('social.slap', (pl, d: { to: number }) => {
    const v = game.state.get(d?.to);
    if (!isPlayer(v) || v.id === pl.id || !pl.p || !v.p) return;
    if (dist2(pl.p, v.p) > 3.0 || pl.mode === 'tug' || v.mode === 'tug' || pl.mode === 'sleep') return;
    const now = hostTimers.now;
    if ((pl._slapT ?? -9) > now - 1.3) return;
    pl._slapT = now;
    anim(pl, 'slap');
    const iron = game.hasSkill(v, 'iron_cheek');
    const held = game.items.selected(v);
    const drop = !iron && held && Math.random() < 0.38 ? held.id : null;
    const was = v.mode ?? 'free';
    game.emit('social:slap', { by: pl.id, to: v.id, drop, iron, was });
    bump(game, 'slaps');
    const line = was === 'think' ? pick('slap_think') : READING_MODES.includes(was) ? pick('slap_book') : was === 'sleep' ? pick('slap') : pick('slap');
    game.say(pl.id, line, { style: 'shout', duration: 1.6, voice: 1.1 });
    hostTimers.after(SLAP_IMPACT, () => {
      if (!game.state.get(v.id)) return;
      anim(v, 'get_slapped');
      if (drop) {
        const it = game.state.get(drop);
        if (it && it.holder === v.id && v.p) {
          const yaw = (pl.yaw ?? 0) + Math.PI / 2;
          const side = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          game.items.toWorld(it, [v.p[0] + side.x * 0.3, v.p[1] + 1.3, v.p[2] + side.z * 0.3], [side.x * 2.2, 2.4, side.z * 2.2]);
          game.events.emit('item:dropped', { player: v.id, item: it.id, thrown: true });
        }
      }
      if (was === 'think' || READING_MODES.includes(was) || was === 'sleep') onKnockOut(v, was);
      hostTimers.after(0.65, () => {
        if (!game.state.get(v.id)) return;
        if (iron) game.say(pl.id, pick('iron_cheek'), { style: 'shout', duration: 2 });
        else game.say(v.id, was === 'sleep' ? pick('slapped_awake') : pick('slapped'), { style: 'shout', duration: 2, voice: 0.9 });
      });
    });
  });

  // ------------------------------------------------------------------ HOST: high five
  game.onIntent('social.highfive', (pl, d: { to: number }) => {
    const v = game.state.get(d?.to);
    if (!isPlayer(v) || v.id === pl.id || !pl.p || !v.p || dist2(pl.p, v.p) > 3.2) return;
    if (pl.mode === 'sleep' || pl.mode === 'tug') return;
    const now = hostTimers.now;
    const theirs = offers.get(v.id);
    if (theirs && theirs.to === pl.id && theirs.until >= now) {
      // accept → perfect clap
      offers.delete(v.id);
      game.emit('social:hf_clap', { a: v.id, b: pl.id });
      anim(v, 'highfive'); anim(pl, 'highfive');
      bump(game, 'highfives');
      for (const p of [v, pl]) {
        p._hypeUntil = now + 60;
        p.hype = 1;
      }
      hostTimers.after(0.6, () => { for (const p of [v, pl]) if (game.state.get(p.id)) anim(p, 'celebrate', true); });
      hostTimers.after(2.0, () => { for (const p of [v, pl]) if (game.state.get(p.id) && p.anim === 'celebrate') anim(p, 'idle', true); });
      hostTimers.after(0.5, () => game.say(pl.id, pick('high_five'), { duration: 1.6 }));
      return;
    }
    if (offers.has(pl.id)) return;
    offers.set(pl.id, { to: v.id, until: now + HF_WINDOW });
    game.emit('social:hf_offer', { by: pl.id, to: v.id });
    hostTimers.after(HF_WINDOW + 0.05, () => {
      const o = offers.get(pl.id);
      if (!o || o.to !== v.id) return;
      offers.delete(pl.id);
      if (!game.state.get(pl.id)) return;
      game.emit('social:hf_hang', { by: pl.id, to: v.id });
      bump(game, 'hanging');
      anim(pl, 'sad', true);
      game.say(pl.id, pick('left_hanging'), { style: 'thought', duration: 2.4, voice: 0 });
      hostTimers.after(2.6, () => { if (game.state.get(pl.id) && pl.anim === 'sad') anim(pl, 'idle', true); });
    });
  });

  // ------------------------------------------------------------------ HOST: give money
  game.onIntent('social.give', (pl, d: { to: number; amount: number }) => {
    const v = game.state.get(d?.to);
    const amount = Math.round(Number(d?.amount));
    if (!isPlayer(v) || v.id === pl.id || !(AMOUNTS as readonly number[]).includes(amount)) return;
    if (dist2(pl.p, v.p) > 3.4) return;
    if (!game.money(pl.id, -amount, 'gift')) { game.say(pl.id, pick('broke'), { style: 'thought', duration: 2 }); return; }
    anim(pl, 'give');
    game.emit('social:give', { by: pl.id, to: v.id, amount });
    bump(game, 'given', amount);
    game.say(pl.id, pick('give_money'), { duration: 2 });
    hostTimers.after(0.8, () => {
      if (!game.state.get(v.id)) { game.money(pl.id, amount, 'refund'); return; }
      game.money(v.id, amount, 'gift');
      hostTimers.after(0.5, () => game.say(v.id, pick('receive_money'), { duration: 2 }));
    });
  });

  // ------------------------------------------------------------------ HOST: snatch what a friend holds
  game.onIntent('social.snatch', (pl, d: { to: number }) => {
    const v = game.state.get(d?.to);
    if (!isPlayer(v) || v.id === pl.id || dist2(pl.p, v.p) > 3.0) return;
    const it = game.items.selected(v) ?? game.items.carried(v)[0];
    if (!it) return;
    game.events.emit('item:snatch', { by: pl.id, from: v.id, item: it.id });
  });

  // ------------------------------------------------------------------ ALL PEERS: visuals
  game.on('social:slap', (d: { by: number; to: number; drop: number | null; iron: boolean; was: string }) => {
    const local = d.to === game.localPlayerId;
    localTimers.after(0.12, () => { const p = handPos(game, d.by); if (p) Sound.play('whoosh_swing', { pos: p, vol: 0.7, pitch: 1.15 }); });
    localTimers.after(SLAP_IMPACT, () => {
      const hp = headPos(game, d.to) ?? new THREE.Vector3();
      hp.y -= 0.15;
      Sound.play('slap_hard', { pos: hp, vol: 1 });
      Sound.play('social_crowd_ouch', { pos: hp, vol: 0.75, delay: 0.12 });
      if (d.iron) Sound.play('bonk', { pos: hp, vol: 0.6, delay: 0.05 });
      sparks.burst(hp, 18, { color: 0xffffff, color2: 0xffd0c0, speed: 2.4, size: 0.035, life: 0.35, up: 0.2 });
      cheekPrint(game, d.to);
      if (local) {
        shake(game, 0.075, 0.55, 0.14, 30);
        if (game.player?.firstPerson) lensSmack(game);
        spinLocal(game, (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 2 + Math.random() * 0.8));
      } else if (d.by === game.localPlayerId) shake(game, 0.02, 0.2, 0, 24);
    });
  });

  game.on('social:hf_offer', (d: { by: number; to: number }) => {
    liveOffers.set(d.by, { to: d.to, t: performance.now() });
    const rig = rigOf(game, d.by);
    rig?.play('highfive', { loop: false, speed: 0.36 });
    const p = headPos(game, d.by);
    if (p) Sound.play('slide_whistle_up', { pos: p, vol: 0.5 });
    if (d.to === game.localPlayerId) {
      const o = game.views.objectOf(d.by);
      if (o) game.ui.think(() => headPos(game, d.by)?.add(new THREE.Vector3(0, 0.15, 0)) ?? null, tl('ไฮไฟว์! (คลิกขวา)', 'high five! (right click)'), { duration: 2.2 });
    }
  });
  game.on('social:hf_clap', (d: { a: number; b: number }) => {
    liveOffers.delete(d.a);
    const pa = handPos(game, d.a), pb = handPos(game, d.b);
    const mid = pa && pb ? pa.clone().lerp(pb, 0.5) : pa ?? pb;
    if (mid) {
      mid.y += 0.35;
      Sound.play('high_five', { pos: mid, vol: 1 });
      Sound.play('sparkle_chime', { pos: mid, vol: 0.6, delay: 0.08 });
      Sound.play('crowd_cheer', { pos: mid, vol: 0.35, delay: 0.2 });
      sparks.burst(mid, 60, { color: 0xffe28a, color2: 0xffffff, speed: 2.6, size: 0.06, life: 1.0, up: 1.0 });
    }
    if (d.a === game.localPlayerId || d.b === game.localPlayerId) shake(game, 0.025, 0.25, 0, 20);
  });
  game.on('social:hf_hang', (d: { by: number }) => {
    liveOffers.delete(d.by);
    const p = headPos(game, d.by);
    Sound.play('sad_trombone', { pos: p ?? undefined, vol: 0.85 });
    if (p) Sound.play('crowd_aww', { pos: p, vol: 0.3, delay: 0.4 });
  });

  game.on('social:give', (d: { by: number; to: number; amount: number }) => {
    flyMoney(game, d.by, d.to, d.amount, sparks);
  });
}

// ------------------------------------------------------------------ local helpers

function openRadial(game: Game, target: number) {
  radial?.dispose();
  radial = new Radial(game, target, (id, amount) => {
    if (id === 'slap') game.intent('social.slap', { to: target });
    else if (id === 'highfive') game.intent('social.highfive', { to: target });
    else if (id === 'money' && amount) game.intent('social.give', { to: target, amount });
  });
}

export function updateRadial(dt: number) {
  if (radial && !radial.update(dt)) radial = null;
}
export function closeRadial() { radial?.dispose(); radial = null; }

/** Spin the local player around (slap victim). Client owns its yaw. */
function spinLocal(game: Game, turns: number) {
  const pl = game.player;
  if (!pl || !pl.firstPerson) return;
  const y0 = pl.yaw;
  let last = 0;
  game.engine.tween(0.75, (k) => {
    const dk = k - last; last = k;
    pl.yaw += turns * dk;
  }, Ease.outCubic).then(() => { void y0; });
}

/** A real coin / banknote flies from giver's hand to receiver's hand (all peers). */
function flyMoney(game: Game, by: number, to: number, amount: number, sparks: Sparkles) {
  const scene = game.scene;
  if (!scene) return;
  const obj = buildMoney(amount);
  const s = amount <= 10 ? 2.2 : 1.4;
  obj.scale.setScalar(s);
  scene.add(obj);
  const p0 = handPos(game, by) ?? new THREE.Vector3();
  const isCoin = amount <= 10;
  const spin = (Math.random() < 0.5 ? -1 : 1) * (isCoin ? 14 : 5);
  Sound.play(isCoin ? 'coin_clink' : 'banknote', { pos: p0, vol: 0.7 });
  game.engine.tween(0.8, (k) => {
    const a = handPos(game, by, 'r', new THREE.Vector3()) ?? p0;
    const b = handPos(game, to, 'r', new THREE.Vector3()) ?? a;
    obj.position.copy(a).lerp(b, k);
    obj.position.y += Math.sin(k * Math.PI) * 0.55;
    if (isCoin) { obj.rotation.set(Math.PI / 2 + k * spin, 0, 0); }
    else { obj.rotation.set(Math.sin(k * 12) * 0.5, k * spin, Math.cos(k * 9) * 0.35); }
  }, Ease.inOutQuad).then(() => {
    const b = handPos(game, to) ?? obj.position;
    Sound.play(isCoin ? 'coin_on_table' : 'banknote', { pos: b, vol: 0.8 });
    sparks.burst(b, 14, { color: 0xffe9a0, speed: 1.2, size: 0.03, life: 0.6 });
    obj.removeFromParent();
  });
}
