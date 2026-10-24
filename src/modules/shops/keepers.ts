import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { dist2D, followEnt } from './util';
import type { ShopRT } from './trade';
import { PERSONALITIES } from './data';
import { GOSSIP_PAIRS, NAP, TALK, GREET, REGULAR_GREET, fill, pickLine } from './lines';

/**
 * SHOPKEEPERS — npc entities (role 'shopkeeper:<id>') drawn by the characters module; the shops
 * module owns their AI: idle life (fanning, phone, electric fly-swatter, gossip, counting money,
 * afternoon naps), greeting, chasing thieves. Props are item kinds in `hold` (shop_fan…).
 */

export type KState = 'idle' | 'fan' | 'phone' | 'swat' | 'count' | 'chat' | 'nap' | 'closed' | 'talk' | 'bargain' | 'mad' | 'chase' | 'return' | 'march';

export function setAnim(game: Game, e: Ent, anim: string, loop = false) {
  e.anim = anim; e.animLoop = loop; e.animT = (game.g.time ?? 0) + Math.random() * 1e-3;
}

export function spawnKeeper(game: Game, rt: ShopRT): Ent {
  const s = rt.def;
  const existing = game.state.find('npc', (n) => n.role === 'shopkeeper:' + s.id);
  const post = rt.fix!.keeper;
  if (existing) {
    existing.p = [...post.p]; existing.yaw = post.yaw;
    return existing;
  }
  const look = game.chars.randomLook(s.keeper.archetype, s.keeper.seed);
  const e = game.state.spawn('npc', {
    role: 'shopkeeper:' + s.id, sid: s.id, look, name: s.keeper.name,
    p: [...post.p], yaw: post.yaw, anim: post.sit ? 'sit' : 'idle', animLoop: true, animT: 0, face: 'neutral', lookAt: null, hold: null, kst: 'idle',
  });
  return e;
}

/** How the player addresses this keeper (ป้า / ลุง / เจ๊ / เฮีย / น้อง). */
export function keeperCall(s: { keeper: { name: { th: string } } }) {
  const n = s.keeper.name.th;
  for (const k of ['ป้า', 'ลุง', 'เจ๊', 'เฮีย', 'น้อง']) if (n.startsWith(k)) return k;
  return 'พี่';
}
export function keeperSex(rt: ShopRT): 'f' | 'm' { return rt.keeper?.look?.sex ?? 'f'; }

/** HOST: idle life. Called ~10 Hz per shop. */
export function keeperLife(game: Game, rt: ShopRT, now: number) {
  const k = rt.keeper;
  if (!k) return;
  const pers = PERSONALITIES[rt.def.keeper.personality];
  const post = rt.fix!.keeper;
  const t = game.clock.time;
  const busy = k.kst === 'talk' || k.kst === 'bargain' || k.kst === 'mad' || k.kst === 'chase' || k.kst === 'return' || k.kst === 'march';
  // nearest player
  let near: Ent | null = null, nd = 1e9;
  for (const pl of game.players()) { if (!pl.p) continue; const d = dist2D(pl.p, k.p!); if (d < nd) { nd = d; near = pl; } }
  if (!busy) {
    // keep the post (after chases etc.)
    if (dist2D(k.p!, post.p) > 0.25 && !game.npcs.isMoving(k)) game.npcs.go(k, post.p, { speed: 1.3, direct: true, face: post.yaw });
    // look at a close customer
    const lookId = near && nd < 4.5 ? near.id : null;
    if (k.lookAt !== lookId && k.kst !== 'nap' && k.kst !== 'closed') k.lookAt = lookId;
    // greet once per visit
    if (near && nd < 3.6 && rt.ent.open && k.kst !== 'nap' && k.kst !== 'closed') {
      const last = rt.greeted.get(near.id) ?? -1e9;
      if (now - last > 90) {
        rt.greeted.set(near.id, now);
        const rel = rt.relOf(near);
        const line = rel >= 3 ? fill(pickLine(REGULAR_GREET, REGULAR_GREET), { n: near.name }) : fill(pickLine(GREET[pers.id], GREET._), { c: pers.callPlayer });
        rt.say(line);
        if (k.kst === 'phone' || k.kst === 'fan') { /* keep fanning while talking */ }
      }
    } else if (near && nd > 7) rt.greeted.delete(near.id);
  }
  if (now < rt.idleNext || busy) return;
  // ---- choose a new idle activity
  if (!rt.ent.open) {
    if (k.kst !== 'closed') {
      k.kst = 'closed';
      k.hold = null;
      k.lookAt = null;
      if (rt.def.kind === 'stall' || rt.def.kind === 'shophouse') { setAnim(game, k, post.sit ? 'sleep' : 'sleep', true); k.face = 'sleep'; }
      else { setAnim(game, k, 'idle', true); k.face = 'neutral'; }
    }
    if (k.face === 'sleep' && near && nd < 6 && Math.random() < 0.4) game.say(k.id, pickLine(NAP, NAP), { style: 'thought', voice: 0, duration: 2.2 });
    rt.idleNext = now + 6 + Math.random() * 4;
    return;
  }
  const robot = pers.id === 'robot_clerk' || pers.id === 'cashier';
  const nap = !robot && t >= 13 && t < 15.2 && Math.random() < 0.45;
  const r = Math.random();
  let next: KState;
  if (nap) next = 'nap';
  else if (robot) next = r < 0.5 ? 'idle' : r < 0.8 ? 'phone' : 'count';
  else next = r < 0.28 ? 'fan' : r < 0.48 ? 'phone' : r < 0.62 ? 'swat' : r < 0.78 ? 'chat' : r < 0.9 ? 'count' : 'idle';
  k.kst = next;
  k.face = next === 'nap' ? 'sleep' : 'neutral';
  const sit = post.sit;
  switch (next) {
    case 'fan': k.hold = 'shop_fan'; setAnim(game, k, 'wave', true); break;
    case 'phone': k.hold = 'shop_phone'; setAnim(game, k, sit ? 'sit' : 'idle', true); k.lookAt = null; break;
    case 'swat': k.hold = 'shop_racket'; setAnim(game, k, 'slap'); rt.zapAt = now + 0.35; break;
    case 'count': k.hold = null; setAnim(game, k, 'count_coins', true); break;
    case 'nap': k.hold = null; setAnim(game, k, sit ? 'sleep' : 'sleep', true); k.lookAt = null; break;
    case 'chat': {
      k.hold = null; setAnim(game, k, 'talk', true);
      // gossip with the nearest other keeper (market stalls face each other)
      const other = rt.neighbour?.();
      if (other && Math.random() < 0.7) {
        const [a, b] = GOSSIP_PAIRS[Math.floor(Math.random() * GOSSIP_PAIRS.length)];
        if (near && nd < 14) { game.say(k.id, a, { voice: pers.voice, duration: 3 }); setTimeout(() => { if (game.state.get(other.id)) game.say(other.id, b, { voice: 1.1, duration: 3.2 }); }, 2600); }
      } else if (near && nd < 6) game.say(k.id, fill(pickLine(TALK[pers.id], TALK._), {}), { voice: pers.voice });
      break;
    }
    default: k.hold = null; setAnim(game, k, sit ? 'sit' : 'idle', true);
  }
  rt.idleNext = now + (next === 'nap' ? 40 + Math.random() * 30 : 7 + Math.random() * 9);
}

/** Wake a napping keeper (E on them). */
export function wakeKeeper(game: Game, rt: ShopRT) {
  const k = rt.keeper;
  if (!k) return;
  k.kst = 'idle'; k.face = 'shock'; k.hold = null;
  setAnim(game, k, 'wake_up');
  rt.idleNext = rt.now + 12;
  setTimeout(() => { if (k.face === 'shock') k.face = 'neutral'; }, 1600);
}

// ------------------------------------------------------------------ client-side visuals

interface Proxy { obj: THREE.Mesh; id: number; snore: any; buzz: any }
const proxies = new Map<number, Proxy>();
const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const proxyGeo = new THREE.CapsuleGeometry(0.38, 1.1, 2, 6).translate(0, 0.95, 0);

/** Interaction proxies + local loops (snore, fly buzz) for every keeper entity (all peers). */
export function keeperFrame(game: Game, dt: number) {
  if (!game.scene) return;
  const seen = new Set<number>();
  game.state.each('npc', (e) => {
    if (!e.role?.startsWith?.('shopkeeper:')) return;
    seen.add(e.id);
    let px = proxies.get(e.id);
    if (!px) {
      const obj = new THREE.Mesh(proxyGeo, proxyMat);
      obj.name = 'keeper-proxy';
      obj.renderOrder = -1;
      game.scene!.add(obj);
      game.interact.register(obj, { kind: 'shopkeeper', eid: e.id, data: { name: e.name, sid: e.sid }, reach: 3.2 });
      px = { obj, id: e.id, snore: null, buzz: null };
      proxies.set(e.id, px);
    }
    if (e.p) px.obj.position.set(e.p[0], e.p[1], e.p[2]);
    // snore loop while napping/closed-sleeping
    const sleeping = e.face === 'sleep';
    if (sleeping && !px.snore) px.snore = Sound.loop('snore_loop', { pos: px.obj.position, vol: 0.45, ref: 2, max: 14 } as any);
    else if (!sleeping && px.snore) { px.snore.stop(0.4); px.snore = null; }
    px.snore?.setPos(px.obj.position);
    // flies buzzing around the fresh market stalls
    const fly = (e.sid === 'butcher_stall' || e.sid === 'auntie_stall') && game.g.time > 9 && game.g.time < 14;
    if (fly && !px.buzz) px.buzz = Sound.loop('shop_fly_buzz', { pos: px.obj.position, vol: 0.18, ref: 1.5, max: 8 } as any);
    else if (!fly && px.buzz) { px.buzz.stop(0.5); px.buzz = null; }
  });
  for (const [id, px] of proxies) if (!seen.has(id)) {
    game.interact.unregister(px.obj); px.obj.removeFromParent(); px.snore?.stop(0.2); px.buzz?.stop(0.2); proxies.delete(id);
  }
}

export function clearKeeperProxies(game: Game) {
  for (const px of proxies.values()) { game.interact.unregister(px.obj); px.obj.removeFromParent(); px.snore?.stop(0.1); px.buzz?.stop(0.1); }
  proxies.clear();
}

/**
 * Fallback NPC view for shopkeepers when the characters module isn't loaded (stub rig):
 * follows p/yaw, plays anims, attaches the held prop. The characters module replaces this.
 */
export function registerFallbackKeeperView(game: Game) {
  game.registerView('npc', (e: Ent) => {
    if (!e.role?.startsWith?.('shopkeeper:')) return null;
    if (game.module('characters')) return null;
    const root = new THREE.Group();
    root.name = 'keeper:' + e.sid;
    const rig = game.chars.create(e.look);
    root.add(rig.root);
    root.userData.headHeight = (e.look?.height ?? 1.6) + 0.25;
    if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
    let lastT = -1, hold = '', prop: THREE.Object3D | null = null;
    const prev = root.position.clone();
    let speed = 0;
    return {
      object: root,
      rig,
      update: (e: Ent, dt: number) => {
        followEnt(root, e, dt, 10);
        const d = root.position.distanceTo(prev) / Math.max(dt, 1e-4);
        prev.copy(root.position);
        speed += (Math.min(d, 6) - speed) * Math.min(1, dt * 8);
        if (e.animT !== undefined && e.animT !== lastT) { lastT = e.animT; if (e.anim) rig.play(e.anim, { loop: !!e.animLoop }); }
        rig.setMove(speed);
        rig.setFace(e.face ?? 'neutral');
        if ((e.hold ?? '') !== hold) {
          hold = e.hold ?? '';
          prop?.removeFromParent(); prop = null;
          const def = hold ? game.items.def(hold) : null;
          if (def) { try { prop = def.build(e, game); rig.attach('hand_r').add(prop); } catch { prop = null; } }
        }
        rig.update(dt);
      },
      dispose: () => { prop?.removeFromParent(); rig.dispose(); },
    };
  });
}
