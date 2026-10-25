import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Ctx } from '../../game/interact';
import { tl, round, angleDiff, damp, params } from '../../core/util';
import { Assets } from '../../core/assets';
import type { SceneDef } from '../../game/scenes';
import { yawTo } from '../../game/mapplan';
import { buildQuad, QuadAnimator, QuadInput, QuadPose, QuadRig } from './quad';
import { Creature, loadCreature, SPECS } from './creature';
import { lifeTex } from './tex';
import { anchorP, dist2, isFoodItem, itemName, playerNear, proxyMaterial, h01, qmul } from './util';
import { line } from './lines';
import { sfx, play } from './sounds';
import { hearts } from './fx';
import type { Life } from './index';

/* ============================================================================================
 * STRAY DOG (t:'dog') & STRAY CAT (t:'cat') — host AI, feeding & adoption, views.
 *
 * Entity: { t, p, yaw, st, act, actT, aff 0..100, feeds, adopted, name, follow:playerId|null,
 *           look:eid|null, scared }
 *   st: 'idle'|'sit'|'lie'|'sleep'|'beg'|'eat'|'bark'|'scratch'|'sniff'|'wag'|'guard'|'flee'|'swat'
 *   act/actT: one-shot triggers for the view ('bark' | 'meow' | 'hearts' | 'hiss').
 * The dog doubles as the intro's food thief — see DogAPI (game.life.dog).
 * ========================================================================================== */

const DOG_ADOPT_FEEDS = 4;
const CAT_ADOPT_FEEDS = 3;
const CAT_DAY = 5;
export const DOG_NAME = 'ไอ้หมูสับ';
export const CAT_NAME = 'น้องนิล';

interface Brain {
  next: number;            // next decision time (ambient seconds)
  plan: string;
  until: number;
  target: THREE.Vector3 | null;
  barkT: number;
  whineT: number;
  stealT: number;
  followUntil: number;
  eatUntil: number;
  eatDone: (() => void) | null;
  script: boolean;
  jump: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; done?: () => void } | null;
  perch: 'cart' | 'table' | null;
  perchItem: number | null;
  meowT: number;
  petT: Map<number, number>;
  idleT: number;
}

const brains = new WeakMap<Ent, Brain>();
function brain(e: Ent): Brain {
  let b = brains.get(e);
  if (!b) {
    b = { next: 0, plan: 'idle', until: 0, target: null, barkT: 0, whineT: 0, stealT: 20 + Math.random() * 20, followUntil: 0, eatUntil: 0, eatDone: null, script: false, jump: null, perch: null, perchItem: null, meowT: 0, petT: new Map(), idleT: 0 };
    brains.set(e, b);
  }
  return b;
}

/** cart-local → world (same convention as the cooking module) */
export function cartLocal(cart: Ent, lx: number, ly: number, lz: number): THREE.Vector3 {
  const y = cart.yaw ?? 0, c = Math.cos(y), s = Math.sin(y);
  const p = cart.p ?? [0, 0, 0];
  return new THREE.Vector3(p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c);
}

export class Pets {
  constructor(private game: Game, private life: Life) {}

  get now() { return this.life.clock.t; }
  dog(): Ent | null { return this.game.state.all('dog')[0] ?? null; }
  cat(): Ent | null { return this.game.state.all('cat')[0] ?? null; }
  cart(): Ent | null { return this.game.state.all('cart')[0] ?? null; }
  cartPos(): THREE.Vector3 {
    const c = this.cart();
    return c?.p ? new THREE.Vector3(c.p[0], c.p[1], c.p[2]) : anchorP(this.game, 'cart_start', [4.9, 0.15, -23]);
  }

  // ------------------------------------------------------------------ init (every peer)

  init() {
    const game = this.game;
    game.registerView('dog', (e: Ent) => this.makeView(e, 'dog'));
    game.registerView('cat', (e: Ent) => this.makeView(e, 'cat'));
    game.scenes.register('petlab', () => new PetLab(game));
    if (params.has('petlab')) {
      let done = false;
      game.events.on('net:session', () => { if (done) return; done = true; setTimeout(() => { if (game.isHost) game.g.scene = 'petlab'; }, 0); });
    }

    game.onIntent('life.feed', (pl, d: { id: number; slot?: number }) => this.hostFeed(pl, d.id, d.slot ?? pl.sel ?? 0));
    game.onIntent('life.pet', (pl, d: { id: number }) => this.hostPet(pl, d.id));
    game.onIntent('life.shoo', (pl, d: { id: number }) => this.hostShoo(pl, d.id));

    game.interact.provide((ctx: Ctx) => {
      const k = ctx.hit?.kind;
      if (k !== 'dog' && k !== 'cat') return;
      const ent = ctx.hit!.ent;
      if (!ent) return;
      const acts: any[] = [];
      const sp = k as 'dog' | 'cat';
      if (ctx.held && isFoodItem(game, ctx.held, sp)) {
        acts.push({ key: 'LMB', label: tl(`ป้อน${itemName(game, ctx.held)}`, 'feed'), priority: 9, run: () => game.intent('life.feed', { id: ent.id, slot: ctx.me.sel ?? 0 }) });
      }
      acts.push({ key: 'E', label: tl(sp === 'dog' ? 'ลูบหัว' : 'เกาคาง', 'pet'), priority: 6, run: () => game.intent('life.pet', { id: ent.id }) });
      if (sp === 'cat' && ent.p && ent.p[1] > 0.4) acts.push({ key: 'R', label: tl('ไล่ลง', 'shoo'), priority: 4, run: () => game.intent('life.shoo', { id: ent.id }) });
      return acts;
    }, 12);
  }

  // ------------------------------------------------------------------ host

  hostEnsure() {
    const game = this.game;
    if (!this.dog()) {
      const p = anchorP(game, 'dog_home', [-11, 0.15, -90]);
      const g = game.g;
      game.state.spawn('dog', {
        p: [p.x, p.y, p.z], yaw: 0, st: 'sleep', act: '', actT: 0, aff: g.dogAff ?? 0, feeds: g.dogFeeds ?? 0,
        adopted: !!g.dogAdopted, name: g.dogAdopted ? (g.dogName ?? DOG_NAME) : '', follow: null, look: null, scared: false,
      });
    }
    if (!this.cat() && ((game.g.day ?? 1) >= CAT_DAY || game.g.catHere || this.life.lab)) {
      const p = anchorP(game, 'cat_spot', [7.5, 0.15, -95]);
      const g = game.g;
      game.g.catHere = true;
      game.state.spawn('cat', {
        p: [p.x, p.y, p.z], yaw: Math.PI / 2, st: 'sit', act: '', actT: 0, aff: g.catAff ?? 0, feeds: g.catFeeds ?? 0,
        adopted: !!g.catAdopted, name: g.catAdopted ? CAT_NAME : '', follow: null, look: null, scared: false,
      });
    }
  }

  private act(e: Ent, a: string) { e.act = a; e.actT = round(this.now + Math.random() * 0.01, 3); }

  private say(e: Ent, key: string) { this.game.say(e.id, line(key), { duration: 2.4 }); }

  private go(e: Ent, to: THREE.Vector3, speed: number, onArrive?: () => void) {
    const d = dist2(e.p!, [to.x, to.y, to.z]);
    this.game.npcs.go(e, to, { speed, onArrive, direct: d < 10 || !this.game.world });
  }
  private stop(e: Ent) { this.game.npcs.stop(e); }
  private face(e: Ent, p: ArrayLike<number>) { this.game.npcs.faceTo(e, p); }

  hostUpdate(dt: number) {
    const dog = this.dog();
    if (dog) this.dogBrain(dog, dt);
    const cat = this.cat();
    if (cat) this.catBrain(cat, dt);
  }

  /** shared per-tick bits (jumps, eating timers) */
  private tick(e: Ent, b: Brain) {
    const now = this.now;
    if (b.jump) {
      const j = b.jump;
      const t = Math.min(1, (now - j.t0) / j.dur);
      const p = j.from.clone().lerp(j.to, t);
      p.y += Math.sin(Math.PI * t) * 0.45;
      e.p = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
      if (t >= 1) { const cb = j.done; b.jump = null; cb?.(); }
      return true;
    }
    if (b.eatUntil > 0) {
      if (now >= b.eatUntil) { b.eatUntil = 0; e.st = 'idle'; const cb = b.eatDone; b.eatDone = null; cb?.(); }
      else { e.st = 'eat'; return true; }
    }
    return false;
  }

  private night() { const t = this.game.clock.time; return t >= 21 || t < 5.8; }

  private ghostNear(p: ArrayLike<number>, r: number): Ent | null {
    let best: Ent | null = null, bd = r;
    for (const gh of this.game.state.all('ghost')) {
      if (!gh.p || (gh.vis ?? 1) < 0.3) continue;
      const d = dist2(gh.p, p);
      if (d < bd) { bd = d; best = gh; }
    }
    return best;
  }

  /** nearest player holding something this animal wants */
  private foodHolder(e: Ent, r: number, sp: 'dog' | 'cat'): Ent | null {
    let best: Ent | null = null, bd = r;
    for (const pl of this.game.players()) {
      if (!pl.p) continue;
      const d = dist2(pl.p, e.p!);
      if (d < bd && isFoodItem(this.game, this.game.items.selected(pl), sp)) { bd = d; best = pl; }
    }
    return best;
  }

  /** unattended food lying around (free, on a plate or on the cart) with nobody close */
  private unattendedFood(e: Ent, r: number, sp: 'dog' | 'cat'): Ent | null {
    const game = this.game;
    let best: Ent | null = null, bd = r;
    for (const it of game.state.all('item')) {
      if (it.holder != null) continue;
      if (!isFoodItem(game, it, sp)) continue;
      const wp = game.items.worldPos(it);
      if (!wp || wp.y > 1.35) continue;
      const d = dist2([wp.x, 0, wp.z], e.p!);
      if (d > bd) continue;
      if (playerNear(game, [wp.x, 0, wp.z], 5.5)) continue;
      bd = d; best = it;
    }
    return best;
  }

  // ------------------------------------------------------------------ dog brain

  private dogBrain(e: Ent, dt: number) {
    const b = brain(e);
    const game = this.game;
    const now = this.now;
    if (this.tick(e, b)) return;
    if (b.script) return;
    if (now < b.next) return;
    b.next = now + 0.25;
    const p = e.p!;

    // 1. ghosts → bark (adopted: brave; stray: barks from afar, flees when close)
    const gh = this.ghostNear(p, 18);
    if (gh) {
      const d = dist2(gh.p, p);
      e.look = gh.id;
      if (!e.adopted && d < 3.5 && Math.random() < 0.08 && e.st !== 'dead') {
        // too scared to run: plays dead (authored clip on the sculpted dog)
        this.stop(e); e.st = 'dead'; e.scared = true; this.act(e, 'dead');
        b.next = now + 6;
        return;
      }
      if (!e.adopted && d < 6) {
        e.st = 'flee'; e.scared = true;
        const away = new THREE.Vector3(p[0] - gh.p[0], 0, p[2] - gh.p[2]).normalize().multiplyScalar(10).add(new THREE.Vector3(p[0], p[1], p[2]));
        if (!game.npcs.isMoving(e)) this.go(e, away, 5);
        if (now > b.whineT) { b.whineT = now + 2.5; sfx(game, 'whine', p, { vol: 0.8 }); }
        return;
      }
      this.stop(e); this.face(e, gh.p);
      e.st = 'bark'; e.scared = false;
      if (now > b.barkT) {
        b.barkT = now + 0.9 + Math.random() * 0.6;
        this.act(e, 'bark');
        sfx(game, 'bark', p, { vol: 1, max: 60 });
        if (e.adopted && d < 13) this.life.ghosts?.scare(gh, 'dog');
      }
      return;
    }
    e.scared = false;

    // 2. someone holding food → beg
    const fh = this.foodHolder(e, 7, 'dog');
    if (fh) {
      e.look = fh.id;
      const pp = new THREE.Vector3(fh.p[0], fh.p[1], fh.p[2]);
      const fwd = new THREE.Vector3(-Math.sin(fh.yaw ?? 0), 0, -Math.cos(fh.yaw ?? 0));
      const spot = pp.clone().addScaledVector(fwd, 1.1);
      if (dist2(p, [spot.x, 0, spot.z]) > 0.8) { if (!game.npcs.isMoving(e) || now > b.until) { b.until = now + 1; this.go(e, spot, 2.6); } e.st = 'idle'; }
      else { this.stop(e); this.face(e, fh.p); e.st = 'beg'; }
      if (now > b.whineT && !game.npcs.isMoving(e)) { b.whineT = now + 5 + Math.random() * 5; sfx(game, 'whine', p, { vol: 0.7 }); if (Math.random() < 0.3) this.say(e, 'dog_beg'); }
      return;
    }

    // 3. steal unattended food (strays mostly)
    if (now > b.stealT) {
      b.stealT = now + (e.adopted ? 90 : 25) + Math.random() * 20;
      if (!e.adopted || Math.random() < 0.15) {
        const it = this.unattendedFood(e, 22, 'dog');
        if (it) { this.stealItems([it.id], {}); return; }
      }
    }

    // 4. following someone (after being fed / petted)
    if (e.follow != null && now < b.followUntil) {
      const pl = game.state.get(e.follow);
      if (pl?.p) {
        e.look = pl.id;
        const d = dist2(pl.p, p);
        if (d > 3.2) { if (!game.npcs.isMoving(e) || now > b.until) { b.until = now + 0.8; this.go(e, new THREE.Vector3(pl.p[0], pl.p[1], pl.p[2]), d > 8 ? 5 : 2.4); } e.st = 'wag'; }
        else if (d < 2.2) { this.stop(e); e.st = e.adopted ? 'sit' : 'wag'; }
        return;
      }
    }
    e.follow = null;
    e.look = null;

    // 5. night → sleep (adopted: guard the cart)
    if (this.night()) {
      const spot = e.adopted ? cartLocal(this.cart() ?? ({ p: this.cartPos().toArray(), yaw: Math.PI / 2 } as any), 0.2, 0, 1.0) : anchorP(game, 'dog_home', [-11, 0.15, -90]);
      if (dist2(p, [spot.x, 0, spot.z]) > 1.2) { if (!game.npcs.isMoving(e)) this.go(e, spot, 2); e.st = 'idle'; }
      else { e.st = e.adopted ? 'guard' : 'sleep'; }
      return;
    }

    // 6. the wok is roaring and people are around → sit by the cart and beg
    const cart = this.cart();
    if (cart?.burner?.on && playerNear(game, cart.p, 4)) {
      const spot = cartLocal(cart, -0.2, 0, -1.6);
      if (dist2(p, [spot.x, 0, spot.z]) > 1) { if (!game.npcs.isMoving(e)) this.go(e, spot, 2.2); e.st = 'idle'; }
      else { this.face(e, cart.p); e.st = Math.sin(now * 0.3) > 0.2 ? 'beg' : 'sit'; if (now > b.whineT) { b.whineT = now + 9 + Math.random() * 6; sfx(game, 'whine', p, { vol: 0.5 }); } }
      return;
    }

    // 7. wander / idle
    if (game.npcs.isMoving(e)) { e.st = 'sniff'; return; }
    if (now > b.until) {
      const home = e.adopted ? cartLocal(cart ?? ({ p: this.cartPos().toArray(), yaw: Math.PI / 2 } as any), 0, 0, 1.2) : anchorP(game, 'dog_home', [-11, 0.15, -90]);
      const r = Math.random();
      if (r < 0.45) {
        // wander near home / along the west sidewalk
        const t = Math.random();
        let to: THREE.Vector3;
        if (!e.adopted && t < 0.4) to = new THREE.Vector3(-4.6 - Math.random() * 1.2, 0.15, -98 + Math.random() * 70);
        else to = home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9));
        to.y = this.game.world?.groundY(to.x, to.z) ?? to.y;
        this.go(e, to, Math.random() < 0.2 ? 2.4 : 1.05);
        b.until = now + 25;
        e.st = 'sniff';
      } else {
        const pick = Math.random();
        e.st = pick < 0.45 ? 'sit' : pick < 0.75 ? 'lie' : pick < 0.88 ? 'scratch' : 'idle';
        b.until = now + (e.st === 'scratch' ? 2.2 : 6 + Math.random() * 12);
        // occasionally bark at something (passing traffic, a stranger)
        if (Math.random() < 0.18) { this.act(e, 'bark'); sfx(game, 'bark', p, { vol: 0.8, max: 60 }); }
      }
      // look at a nearby player now and then
      const pl = playerNear(game, p, 6);
      if (pl && Math.random() < 0.6) { e.look = pl.id; if (Math.random() < 0.5) e.st = 'wag'; }
    }
  }

  // ------------------------------------------------------------------ cat brain

  private catBrain(e: Ent, dt: number) {
    const b = brain(e);
    const game = this.game;
    const now = this.now;
    if (this.tick(e, b)) return;
    if (b.script) return;
    if (now < b.next) return;
    b.next = now + 0.3;
    const p = e.p!;
    const perched = p[1] > 0.4;

    // ghosts → hiss and run
    const gh = this.ghostNear(p, 9);
    if (gh) {
      e.look = gh.id;
      if (now > b.barkT) { b.barkT = now + 2.5; this.act(e, 'hiss'); sfx(game, 'hiss', p, { vol: 0.8 }); }
      if (perched) { this.jumpDown(e); return; }
      const away = new THREE.Vector3(p[0] - gh.p[0], 0, p[2] - gh.p[2]).normalize().multiplyScalar(8).add(new THREE.Vector3(p[0], p[1], p[2]));
      if (!game.npcs.isMoving(e)) this.go(e, away, 3.5);
      e.st = 'flee';
      return;
    }

    // food in hand → follow & meow (only when on the ground)
    const fh = !perched ? this.foodHolder(e, 6, 'cat') : null;
    if (fh) {
      e.look = fh.id;
      const pp = new THREE.Vector3(fh.p[0], fh.p[1], fh.p[2]);
      if (dist2(p, fh.p) > 1.0) { if (!game.npcs.isMoving(e) || now > b.until) { b.until = now + 1; this.go(e, pp, 1.6); } }
      else { this.stop(e); this.face(e, fh.p); e.st = 'sit'; }
      if (now > b.meowT) { b.meowT = now + 3 + Math.random() * 3; this.act(e, 'meow'); sfx(game, 'meow', p, { vol: 0.8 }); }
      return;
    }

    // following after petting
    if (e.follow != null && now < b.followUntil && !perched) {
      const pl = game.state.get(e.follow);
      if (pl?.p) {
        e.look = pl.id;
        const d = dist2(pl.p, p);
        if (d > 2.4) { if (!game.npcs.isMoving(e) || now > b.until) { b.until = now + 1; this.go(e, new THREE.Vector3(pl.p[0], pl.p[1], pl.p[2]), d > 6 ? 3 : 1.3); } e.st = 'idle'; }
        else { this.stop(e); e.st = 'sit'; }
        return;
      }
    }
    e.follow = null;

    if (game.npcs.isMoving(e)) { e.st = 'idle'; return; }
    if (now < b.until) return;
    const cart = this.cart();

    if (e.adopted && cart) {
      // adopted: lives on the cart; sometimes knocks small items off tables
      if (!perched) {
        const top = cartLocal(cart, 0.55, 0.862, -0.05);
        const below = cartLocal(cart, 0.55, 0, -0.75);
        below.y = game.world?.groundY(below.x, below.z) ?? below.y;
        if (dist2(p, [below.x, 0, below.z]) > 0.5) { this.go(e, below, 1.4); b.until = now + 12; e.st = 'idle'; return; }
        this.jump(e, top, () => { b.perch = 'cart'; e.st = 'sit'; });
        b.until = now + 3;
        return;
      }
      // on a perch
      const r = Math.random();
      if (b.perch === 'cart' && r < 0.12 && !this.night()) {
        const it = this.smallItemOnTable();
        if (it) { this.knockQuest(e, it); return; }
      }
      e.st = this.night() ? 'sleep' : r < 0.5 ? 'sit' : r < 0.8 ? 'lie' : 'scratch';
      b.until = now + (e.st === 'scratch' ? 2 : 8 + Math.random() * 14);
      if (Math.random() < 0.25 && playerNear(game, p, 5)) { this.act(e, 'meow'); sfx(game, 'meow', p, { vol: 0.6 }); }
      return;
    }

    // stray: hang around cat_spot
    const home = anchorP(game, 'cat_spot', [7.5, 0.15, -95]);
    if (Math.random() < 0.35) {
      const to = home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
      to.y = game.world?.groundY(to.x, to.z) ?? to.y;
      this.go(e, to, 0.7);
      b.until = now + 15;
    } else {
      e.st = this.night() ? 'sleep' : (['sit', 'lie', 'sit', 'scratch', 'sleep'] as const)[Math.floor(Math.random() * 5)];
      b.until = now + 6 + Math.random() * 14;
      const pl = playerNear(game, p, 4);
      if (pl) { e.look = pl.id; if (Math.random() < 0.5) { this.act(e, 'meow'); sfx(game, 'meow', p, { vol: 0.6 }); } }
      else e.look = null;
    }
  }

  private jump(e: Ent, to: THREE.Vector3, done?: () => void) {
    const b = brain(e);
    this.stop(e);
    const from = new THREE.Vector3(e.p![0], e.p![1], e.p![2]);
    this.face(e, [to.x, to.y, to.z]);
    b.jump = { from, to: to.clone(), t0: this.now, dur: 0.45, done };
    e.st = 'jump';
  }
  private jumpDown(e: Ent) {
    const b = brain(e);
    const p = e.p!;
    const yaw = e.yaw ?? 0;
    const to = new THREE.Vector3(p[0] - Math.sin(yaw) * 0.9, 0, p[2] - Math.cos(yaw) * 0.9);
    to.y = this.game.world?.groundY(to.x, to.z) ?? 0.15;
    b.perch = null;
    this.jump(e, to, () => { e.st = 'idle'; });
    b.until = this.now + 4;
  }

  private smallItemOnTable(): Ent | null {
    const game = this.game;
    const tables = game.state.all('item').filter((t) => /^table/.test(String(t.k)) && t.holder == null && t.in == null);
    for (const t of tables) {
      for (const it of game.state.all('item')) {
        if (it === t || it.holder != null || it.in != null || !it.p || !t.p) continue;
        const def = game.items.defOf(it);
        if (def?.fixed || (def?.weight ?? 0.5) > 1.2) continue;
        if (it.p[1] < t.p[1] + 0.4) continue;
        if (Math.hypot(it.p[0] - t.p[0], it.p[2] - t.p[2]) < 0.65) return it;
      }
    }
    return null;
  }

  /** jump down, walk to the table, hop up next to the item, SWAT it off, sit innocently */
  private knockQuest(e: Ent, it: Ent) {
    const game = this.game;
    const b = brain(e);
    const ip = new THREE.Vector3(it.p![0], it.p![1], it.p![2]);
    this.jumpDown(e);
    b.until = this.now + 30;
    setTimeout(() => {
      if (!game.state.get(e.id) || !game.state.get(it.id) || it.holder != null) return;
      const side = new THREE.Vector3(ip.x + 0.7, game.world?.groundY(ip.x + 0.7, ip.z) ?? 0.15, ip.z);
      this.go(e, side, 1.4, () => {
        if (!game.state.get(it.id) || it.holder != null || !it.p) return;
        const top = new THREE.Vector3(it.p[0] + 0.28, it.p[1], it.p[2]);
        this.jump(e, top, () => {
          b.perch = 'table';
          this.face(e, it.p);
          e.st = 'sit';
          this.act(e, 'meow');
          sfx(game, 'meow', e.p, { vol: 0.7 });
          setTimeout(() => {
            if (!game.state.get(it.id) || it.holder != null || it.in != null || !it.p) return;
            e.st = 'swat';
            setTimeout(() => {
              if (!game.state.get(it.id) || it.holder != null || it.in != null || !it.p) { e.st = 'sit'; return; }
              const yaw = e.yaw ?? 0;
              const push = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(2.2);
              game.items.toWorld(it, [it.p[0], it.p[1] + 0.02, it.p[2]], [push.x, 1.2, push.z]);
              sfx(game, 'knock', it.p, { vol: 0.8 });
              e.st = 'sit';
              this.say(e, 'cat_knock');
              b.until = this.now + 8;
            }, 900);
          }, 1500);
        });
      });
    }, 900);
  }

  // ------------------------------------------------------------------ interactions (host)

  private hostFeed(pl: Ent, id: number, slot: number) {
    const game = this.game;
    const e = game.state.get(id);
    if (!e || (e.t !== 'dog' && e.t !== 'cat') || !pl.p || !e.p) return;
    if (dist2(pl.p, e.p) > 3.5) return;
    const item = game.state.get(pl.inv?.[slot]);
    const sp = e.t as 'dog' | 'cat';
    if (!item || !isFoodItem(game, item, sp)) return;
    const k = String(item.k);
    const value = k === 'dog_food' ? 34 : game.items.defOf(item)?.tags?.includes('dish') || k === 'dish' ? 30 : 22;
    game.items.remove(item);
    const b = brain(e);
    this.stop(e);
    this.face(e, pl.p);
    b.eatUntil = this.now + 3.2;
    b.eatDone = () => {
      b.followUntil = this.now + (e.adopted ? 90 : 45);
      e.follow = pl.id;
      this.act(e, 'hearts');
      if (sp === 'dog') sfx(game, 'pant', e.p, { vol: 0.8 }); else sfx(game, 'purr', e.p, { vol: 0.8 });
    };
    e.st = 'eat';
    e.aff = Math.min(100, (e.aff ?? 0) + value);
    e.feeds = (e.feeds ?? 0) + 1;
    sfx(game, sp === 'dog' ? 'dog_eat' : 'dog_eat', e.p, { vol: 0.9, pitch: sp === 'cat' ? 1.4 : 1 });
    this.say(e, sp === 'dog' ? 'dog_fed' : 'cat_meow');
    const g = game.g;
    if (sp === 'dog') { g.dogAff = e.aff; g.dogFeeds = e.feeds; } else { g.catAff = e.aff; g.catFeeds = e.feeds; }
    const need = sp === 'dog' ? DOG_ADOPT_FEEDS : CAT_ADOPT_FEEDS;
    if (!e.adopted && e.feeds >= need) setTimeout(() => this.adopt(e, pl), 3400);
    game.events.emit('life:fed', { pet: e.id, species: sp, player: pl.id, feeds: e.feeds });
  }

  adopt(e: Ent, pl?: Ent) {
    const game = this.game;
    if (!game.state.get(e.id) || e.adopted) return;
    e.adopted = true;
    const sp = e.t;
    e.name = sp === 'dog' ? DOG_NAME : CAT_NAME;
    if (sp === 'dog') { game.g.dogAdopted = true; game.g.dogName = e.name; } else { game.g.catAdopted = true; }
    this.act(e, 'hearts');
    game.say(e.id, line(sp === 'dog' ? 'dog_adopted' : 'cat_adopted'), { duration: 4, style: 'shout' } as any);
    if (e.p) game.popup([e.p[0], e.p[1] + 1.2, e.p[2]], sp === 'dog' ? 'รับเลี้ยงแล้ว! ♥' : 'ได้ทาสแมวแล้ว! ♥', { font: '"Kodchasan"', size: 64, weight: 700, color: '#ffe0ea', stroke: '#7a1630', strokeWidth: 8 });
    sfx(game, sp === 'dog' ? 'bark' : 'meow', e.p, { vol: 1 });
    game.events.emit('life:adopted', { pet: e.id, species: sp, player: pl?.id });
  }

  private hostPet(pl: Ent, id: number) {
    const game = this.game;
    const e = game.state.get(id);
    if (!e || !pl.p || !e.p || dist2(pl.p, e.p) > 3) return;
    const b = brain(e);
    const last = b.petT.get(pl.id) ?? -99;
    if (this.now - last > 15) { e.aff = Math.min(100, (e.aff ?? 0) + 2); b.petT.set(pl.id, this.now); }
    this.face(e, pl.p);
    if (e.t === 'dog') {
      e.st = 'wag';
      const r = Math.random();
      this.act(e, e.adopted ? (r < 0.4 ? 'shake' : r < 0.65 ? 'roll' : 'hearts') : (e.aff ?? 0) > 30 ? 'hearts' : 'wag');
      sfx(game, 'pant', e.p, { vol: 0.7 });
      if (e.adopted || (e.aff ?? 0) > 40) { e.follow = pl.id; b.followUntil = this.now + 90; }
    } else {
      this.act(e, 'meow');
      sfx(game, (e.aff ?? 0) > 30 ? 'purr' : 'meow', e.p, { vol: 0.7 });
      if (e.adopted) { e.follow = pl.id; b.followUntil = this.now + 40; }
    }
    b.until = this.now + 3;
  }

  private hostShoo(pl: Ent, id: number) {
    const e = this.game.state.get(id);
    if (!e || e.t !== 'cat' || !e.p || !pl.p || dist2(pl.p, e.p) > 3) return;
    this.game.say(pl.id, line('shoo'), { duration: 1.6 });
    this.act(e, 'meow');
    sfx(this.game, 'meow', e.p, { vol: 0.7, pitch: 1.2 });
    this.jumpDown(e);
  }

  // ------------------------------------------------------------------ scripted control (intro & others, HOST)

  setScript(e: Ent, on: boolean) { const b = brain(e); b.script = on; if (on) this.stop(e); }
  scripted(e: Ent) { return brain(e).script; }

  runTo(e: Ent, target: ArrayLike<number> | THREE.Vector3, onArrive?: () => void, speed = 5.2) {
    const t = (target as any).isVector3 ? (target as THREE.Vector3).clone() : new THREE.Vector3(target[0], target[1] ?? 0, target[2]);
    this.setScript(e, true);
    e.st = 'idle';
    this.go(e, t, speed, () => { onArrive?.(); });
  }
  eat(e: Ent, sec = 3, onDone?: () => void) {
    const b = brain(e);
    this.stop(e);
    b.eatUntil = this.now + sec;
    b.eatDone = onDone ?? null;
    e.st = 'eat';
    sfx(this.game, 'dog_eat', e.p, { vol: 1 });
  }
  /** run to the food, eat it all, run away. Items are removed when eaten. */
  stealItems(ids: number[], o: { onEaten?: () => void; onDone?: () => void; away?: ArrayLike<number>; keepScript?: boolean; speed?: number } = {}) {
    const game = this.game;
    const e = this.dog();
    if (!e) return;
    const first = ids.map((i) => game.state.get(i)).find(Boolean);
    const wp = first ? game.items.worldPos(first) : null;
    if (!wp) { o.onDone?.(); return; }
    const to = new THREE.Vector3(wp.x, game.world?.groundY(wp.x, wp.z) ?? 0.15, wp.z);
    // stand ~0.45 m short of the food
    const dir = new THREE.Vector3(e.p![0] - to.x, 0, e.p![2] - to.z);
    if (dir.lengthSq() > 0.01) to.addScaledVector(dir.normalize(), 0.45);
    this.runTo(e, to, () => {
      this.face(e, [wp.x, wp.y, wp.z]);
      this.eat(e, 3.2, () => {
        for (const id of ids) { const it = game.state.get(id); if (it) game.items.remove(it); }
        o.onEaten?.();
        const near = game.nearestPlayer(e.p!, 14);
        if (near) game.say(near.id, line('dog_thief'), { style: 'shout', duration: 2.4 } as any);
        sfx(game, 'bark', e.p, { vol: 1 });
        this.act(e, 'bark');
        const away = o.away ? new THREE.Vector3(o.away[0], o.away[1], o.away[2]) : anchorP(game, 'dog_home', [-11, 0.15, -90]);
        this.go(e, away, o.speed ?? 5.5, () => {
          if (!o.keepScript) this.setScript(e, false);
          o.onDone?.();
        });
      });
    }, o.speed ?? 5.4);
    game.events.emit('life:dog_steal', { items: ids });
  }

  // ------------------------------------------------------------------ view

  private makeView(e: Ent, sp: 'dog' | 'cat') {
    const game = this.game;
    // holder: positioned by the entity; contains the interaction proxy + the visual (procedural
    // placeholder first, swapped for the sculpted creature as soon as the GLB is ready)
    const root = new THREE.Group();
    root.name = sp + ':' + e.id;
    const H = sp === 'dog' ? 0.62 : 0.3, L = sp === 'dog' ? 0.85 : 0.5;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(sp === 'dog' ? 0.3 : 0.18, H, L), proxyMaterial());
    proxy.position.set(0, H * 0.5, 0);
    root.add(proxy);
    const nameOf = () => (e.adopted ? tl(`${e.name || (sp === 'dog' ? DOG_NAME : CAT_NAME)} ♥`, sp === 'dog' ? 'your dog' : 'your cat') : tl(sp === 'dog' ? 'หมาจร' : 'แมวจร', sp === 'dog' ? 'stray dog' : 'stray cat'));
    game.interact.register(root, { kind: sp, eid: e.id, data: { name: nameOf() } });
    root.userData.headHeight = H + 0.2;
    if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
    root.rotation.y = e.yaw ?? 0;

    // ---- visual adapters
    interface Vis { obj: THREE.Object3D; anim: QuadAnimator; update(dt: number, inp: QuadInput): void; setCollar(on: boolean): void; once(k: 'shake' | 'roll' | 'dead'): boolean; setHappy(v: number): void; dispose(): void }
    const procVis = (): Vis => {
      const colors = sp === 'dog'
        ? { base: '#c08a55', light: '#ead2b0', dark: '#6b4524', nose: '#1a1412', eye: '#2a1608', inner: '#b0646a', mask: '#3b2416', socks: null, tailTip: null }
        : { base: '#2a2726', light: '#4a4644', dark: '#151313', nose: '#3a2a2a', eye: '#a8a020', inner: '#b07a7a', socks: null, tailTip: null };
      const fur = lifeTex(sp === 'dog' ? 'fur_dog.jpg' : 'fur_cat.jpg', { fallback: sp === 'dog' ? '#c8a27a' : '#2a2726', kind: 'fabric' });
      const rig: QuadRig = buildQuad({ species: sp, fur, colors, build: sp === 'dog' ? 0.35 : 0.5 });
      const anim = new QuadAnimator(rig);
      return {
        obj: rig.root, anim,
        update: (dt, inp) => anim.update(dt, inp),
        setCollar: (on) => { rig.collar.visible = on; },
        once: () => false,
        setHappy: () => {},
        dispose: () => rig.dispose(),
      };
    };
    const creatureVis = (c: Creature): Vis => {
      const collar = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.17, 6, 16), new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.6 }));
      collar.add(ring);
      const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12), new THREE.MeshStandardMaterial({ color: '#e0b440', roughness: 0.25, metalness: 0.9 }));
      tag.rotation.x = Math.PI / 2;
      tag.position.set(0, -1.12, 0.1);
      collar.add(tag);
      let collarOn = false;
      return {
        obj: c.root, anim: c.anim,
        update: (dt, inp) => c.update(dt, inp, game.camera?.getWorldPosition(camV) ?? null),
        setCollar: (on) => {
          if (on && !collarOn) collarOn = c.attachCollar(collar, sp === 'dog' ? 0.072 : 0.04);
          collar.visible = on;
        },
        once: (k) => c.playOnce(k),
        setHappy: (v) => { c.happy = v; },
        dispose: () => { c.dispose(); ring.geometry.dispose(); tag.geometry.dispose(); },
      };
    };
    const camV = new THREE.Vector3();
    let vis: Vis = procVis();
    root.add(vis.obj);
    let disposed = false;
    loadCreature(sp).then((gltf) => {
      if (disposed) return;
      try {
        const c = new Creature(gltf, SPECS[sp], this.life.lab || qmul() >= 1 ? 1 : 0.6);
        root.remove(vis.obj);
        vis.dispose();
        vis = creatureVis(c);
        root.add(vis.obj);
        vis.setCollar(!!e.adopted);
      } catch (err) { console.warn('[life] creature failed, keeping procedural', err); }
    }).catch((err) => console.warn('[life] creature load failed', sp, err));

    let lastAct = -1;
    let adopted = !!e.adopted;
    vis.setCollar(adopted);
    const prev = root.position.clone();
    let speed = 0, turn = 0, prevYaw = root.rotation.y;
    const lookV = new THREE.Vector3();
    const inp: QuadInput = { speed: 0, turn: 0, pose: 'stand', wag: 0, eat: false, scratch: false, sniff: false, pant: false, alert: 0, tail: 0.2, look: null };
    let wagT = 0, happyT = 0, happyK = 0, glanceT = 2, glanceAway = false;
    return {
      object: root,
      update: (e: Ent, dt: number) => {
        if (!e.p) return;
        const k = 1 - Math.exp(-14 * dt);
        const tgt = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
        if (root.position.distanceToSquared(tgt) > 16) root.position.copy(tgt); else root.position.lerp(tgt, k);
        const dy = angleDiff(root.rotation.y, e.yaw ?? 0);
        root.rotation.y += dy * (1 - Math.exp(-10 * dt));
        const d = Math.hypot(root.position.x - prev.x, root.position.z - prev.z) / Math.max(dt, 1e-4);
        speed += (Math.min(d, 9) - speed) * damp(8, dt);
        turn += (angleDiff(prevYaw, root.rotation.y) / Math.max(dt, 1e-4) - turn) * damp(6, dt);
        prev.copy(root.position);
        prevYaw = root.rotation.y;
        const st = e.st as string;
        const pose: QuadPose = st === 'sit' || st === 'scratch' || st === 'swat' ? 'sit' : st === 'lie' || st === 'guard' || st === 'dead' ? 'lie' : st === 'sleep' ? 'sleep' : st === 'beg' ? (sp === 'cat' ? 'sit' : 'beg') : 'stand';
        if (e.actT !== lastAct) {
          lastAct = e.actT;
          if (lastAct > 0 || e.act) {
            if (e.act === 'bark') vis.anim.bark(sp === 'dog' ? 2 : 1);
            else if (e.act === 'meow' || e.act === 'hiss') vis.anim.bark(1);
            else if (e.act === 'hearts') { hearts(game, root, 6); wagT = 3; happyT = 4; }
            else if (e.act === 'wag') { wagT = 2.5; happyT = 2; }
            else if (e.act === 'shake' || e.act === 'roll' || e.act === 'dead') { if (!vis.once(e.act)) wagT = 2.5; happyT = e.act === 'dead' ? 0 : 3; }
          }
        }
        wagT -= dt; happyT -= dt;
        const happy = e.adopted || st === 'wag' || st === 'beg' || wagT > 0 || (e.follow != null);
        happyK += ((happyT > 0 || st === 'eat' ? 1 : e.adopted ? 0.35 : 0) - happyK) * damp(4, dt);
        vis.setHappy(happyK);
        inp.speed = speed; inp.turn = turn; inp.pose = pose;
        inp.wag = st === 'flee' || st === 'dead' ? 0 : sp === 'cat' ? (st === 'swat' || st === 'beg' ? 0.8 : 0.25) : happy ? 1 : st === 'sleep' ? 0 : 0.2;
        inp.eat = st === 'eat';
        inp.scratch = st === 'scratch';
        inp.sniff = st === 'sniff' && speed < 1.6;
        inp.pant = sp === 'dog' && (speed > 2.5 || (happy && st !== 'sleep' && st !== 'eat'));
        inp.alert = st === 'bark' || st === 'guard' ? 1 : st === 'flee' || st === 'dead' ? -1 : st === 'beg' ? 0.5 : 0;
        inp.tail = st === 'flee' || e.scared ? -1 : st === 'bark' ? 1 : happy ? 0.6 : 0.1;
        inp.swat = st === 'swat';
        const lt = e.look != null ? game.state.get(e.look) : null;
        inp.snarl = st === 'bark' && lt?.t === 'ghost' ? 1 : 0;
        if (lt?.p) { lookV.set(lt.p[0], lt.p[1] + (lt.t === 'player' ? 1.5 : 0.8), lt.p[2]); inp.look = lookV; }
        else {
          // client-local: watch the local player's face when they are close (glancing away now and then)
          inp.look = null;
          const cam = game.camera;
          glanceT -= dt;
          if (glanceT < 0) { glanceAway = !glanceAway; glanceT = glanceAway ? 0.8 + Math.random() * 1.6 : 2.5 + Math.random() * 5; }
          if (cam && !glanceAway && st !== 'sleep' && st !== 'eat' && st !== 'flee' && st !== 'dead' && speed < 1.2) {
            cam.getWorldPosition(lookV);
            if (lookV.distanceToSquared(root.position) < 4.5 * 4.5) inp.look = lookV;
          }
        }
        vis.update(dt, inp);
        if (adopted !== !!e.adopted) {
          adopted = !!e.adopted;
          vis.setCollar(adopted);
          root.userData.interact.data = { name: nameOf() };
        }
      },
      dispose: () => {
        disposed = true;
        game.interact.unregister(root);
        proxy.geometry.dispose();
        vis.dispose();
      },
    };
  }

  // ------------------------------------------------------------------ new day (host)

  onNewDay(day: number) {
    const game = this.game;
    const dog = this.dog();
    if (dog) {
      const b = brain(dog);
      b.script = false; dog.follow = null;
      const p = dog.adopted ? cartLocal(this.cart() ?? ({ p: this.cartPos().toArray(), yaw: Math.PI / 2 } as any), 0.2, 0, 1.0) : anchorP(game, 'dog_home', [-11, 0.15, -90]);
      dog.p = [p.x, p.y, p.z];
      dog.st = 'sleep';
    }
    if (day >= CAT_DAY) this.hostEnsure();
    const cat = this.cat();
    if (cat && cat.adopted) {
      const top = this.cart() ? cartLocal(this.cart()!, 0.55, 0.862, -0.05) : null;
      if (top) { cat.p = [top.x, top.y, top.z]; brain(cat).perch = 'cart'; cat.st = 'sleep'; }
    }
  }
}

/* ============================================================================================
 * DogAPI — host-side scripting surface for other modules (the intro's food thief).
 *   const dog = (game as any).life.dog;
 *   dog.script(true); dog.runTo(cartPos, () => dog.eat(3, () => { …remove food…; dog.runTo(away) }));
 *   dog.steal([riceId, porkId], { onEaten, onDone, away })   // run → eat (items removed) → run off
 *   dog.free()                                               // back to its own AI
 * ========================================================================================== */
export class DogAPI {
  constructor(private pets: Pets, private game: Game) {}
  get ent(): Ent | null { return this.pets.dog(); }
  get id(): number { return this.pets.dog()?.id ?? -1; }
  get pos(): THREE.Vector3 | null { const e = this.ent; return e?.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null; }
  /** HOST: make sure the dog exists (spawns at dog_home). */
  ensure(): Ent | null { if (this.game.isHost) this.pets.hostEnsure(); return this.ent; }
  /** HOST: pause/resume its AI (scripted control). */
  script(on = true) { const e = this.ensure(); if (e) this.pets.setScript(e, on); return this; }
  free() { return this.script(false); }
  teleport(p: ArrayLike<number>, yaw?: number) { const e = this.ensure(); if (!e) return this; this.game.npcs.stop(e); e.p = [p[0], p[1], p[2]]; if (yaw !== undefined) e.yaw = yaw; return this; }
  face(p: ArrayLike<number>) { const e = this.ent; if (e) this.game.npcs.faceTo(e, p); return this; }
  runTo(target: ArrayLike<number> | THREE.Vector3, onArrive?: () => void, opts: { speed?: number } = {}) { const e = this.ensure(); if (e) this.pets.runTo(e, target, onArrive, opts.speed ?? 5.2); return this; }
  walkTo(target: ArrayLike<number> | THREE.Vector3, onArrive?: () => void) { return this.runTo(target, onArrive, { speed: 1.1 }); }
  eat(sec = 3, onDone?: () => void) { const e = this.ensure(); if (e) { this.pets.setScript(e, true); this.pets.eat(e, sec, onDone); } return this; }
  steal(items: (number | Ent)[], o: { onEaten?: () => void; onDone?: () => void; away?: ArrayLike<number>; keepScript?: boolean; speed?: number } = {}) {
    this.ensure();
    this.pets.stealItems(items.map((i) => (typeof i === 'number' ? i : i.id)), o);
    return this;
  }
  bark(n = 1) {
    const e = this.ent; if (!e) return this;
    for (let i = 0; i < n; i++) setTimeout(() => { if (!this.game.state.get(e.id)) return; e.act = 'bark'; e.actT = Math.random() + this.game.engine.time; sfx(this.game, 'bark', e.p, { vol: 1, max: 60 }); }, i * 450);
    return this;
  }
  pose(st: 'sit' | 'lie' | 'sleep' | 'beg' | 'wag' | 'idle' | 'scratch' | 'bark') { const e = this.ensure(); if (e) { this.pets.setScript(e, true); this.game.npcs.stop(e); e.st = st; } return this; }
  sit() { return this.pose('sit'); }
  lie() { return this.pose('lie'); }
  beg() { return this.pose('beg'); }
  wag() { return this.pose('wag'); }
  get adopted() { return !!this.ent?.adopted; }
  /** HOST: force adoption (debug / story). */
  adopt() { const e = this.ensure(); if (e) this.pets.adopt(e); return this; }
}

/* ============================================================================================
 * ?petlab — isolated close-up scene for the sculpted dog & cat (fur / face / animation checks).
 *   &sp=dog|cat|both  &pose=stand|sit|lie|sleep|beg|walk|trot|run|eat|scratch|sniff|pant|bark|wag
 *   &cam=x,y,z,lx,ly,lz  &look=x,y,z (head tracking target)  &tod=day|night
 * window.__petlab = { dog, cat, inp, cam(x,y,z,lx,ly,lz), set(partialInput), adv(seconds) }
 * ========================================================================================== */
export class PetLab implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.02, 200);
  fade = false;
  private pets: { c: Creature; inp: QuadInput; base: THREE.Vector3; t: number }[] = [];
  private camT = new THREE.Vector3(0, 0.4, 0);
  constructor(private game: Game) {}
  async enter() {
    const g = this.game;
    const night = params.get('tod') === 'night';
    this.scene.background = new THREE.Color(night ? 0x10141c : 0xb9c2c4);
    g.engine.setView(this.scene, this.camera);
    g.engine.post.setLook(night ? 'night' : 'thaiDay');
    const hemi = new THREE.HemisphereLight(0xe6eef5, 0x6a5a48, night ? 0.15 : 0.7);
    const sun = new THREE.DirectionalLight(night ? 0xffb070 : 0xfff0d8, night ? 1.2 : 2.6);
    sun.position.set(-3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.far = 20;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.01;
    this.scene.add(hemi, sun, sun.target);
    const gm = Assets.pbr('concrete_soi_road', { repeat: 3 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), gm);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    try {
      const hdr = await Assets.hdr(night ? 'hdri/night_street_sodium_1k.hdr' : 'hdri/day_hazy_street_1k.hdr');
      const pm = new THREE.PMREMGenerator(g.engine.renderer);
      this.scene.environment = pm.fromEquirectangular(hdr).texture;
      this.scene.environmentIntensity = night ? 0.5 : 0.8;
      pm.dispose();
    } catch { /* hemi only */ }
    const which = params.get('sp') ?? 'dog';
    const pose = params.get('pose') ?? 'stand';
    const add = async (sp: 'dog' | 'cat', x: number, z: number, yaw: number) => {
      const gltf = await loadCreature(sp);
      const c = new Creature(gltf, SPECS[sp], 1);
      c.root.position.set(x, 0, z);
      c.root.rotation.y = yaw;
      this.scene.add(c.root);
      const inp: QuadInput = { speed: 0, turn: 0, pose: 'stand', wag: 0.2, eat: false, scratch: false, sniff: false, pant: false, alert: 0, tail: 0.2, look: null };
      const P = pose;
      if (P === 'sit' || P === 'lie' || P === 'sleep' || P === 'beg') inp.pose = P as QuadPose;
      if (P === 'walk') inp.speed = 0.9; if (P === 'trot') inp.speed = 1.8; if (P === 'run') inp.speed = 4.5;
      if (P === 'eat') inp.eat = true; if (P === 'scratch') { inp.scratch = true; inp.pose = 'sit'; }
      if (P === 'sniff') inp.sniff = true; if (P === 'pant') { inp.pant = true; inp.wag = 1; c.happy = 1; }
      if (P === 'wag') { inp.wag = 1; inp.tail = 0.6; c.happy = 1; }
      const lk = params.get('look')?.split(',').map(Number);
      if (lk && lk.length === 3) inp.look = new THREE.Vector3(lk[0], lk[1], lk[2]);
      if (params.get('look') === 'cam') inp.look = this.camera.position;
      this.pets.push({ c, inp, base: c.root.position.clone(), t: 0 });
      if (P === 'bark') c.anim.bark(30);
      return c;
    };
    const lab: any = { inp: null, cam: (x: number, y: number, z: number, lx: number, ly: number, lz: number) => { this.camera.position.set(x, y, z); this.camT.set(lx, ly, lz); this.camera.lookAt(this.camT); } };
    if (which === 'dog' || which === 'both') { lab.dog = await add('dog', 0, 0, Math.PI / 2); lab.inp = this.pets[this.pets.length - 1].inp; }
    if (which === 'cat' || which === 'both') { lab.cat = await add('cat', which === 'both' ? 0.9 : 0, which === 'both' ? 0.5 : 0, Math.PI / 2); lab.inp ??= this.pets[this.pets.length - 1].inp; }
    lab.set = (o: Partial<QuadInput>) => { for (const p of this.pets) Object.assign(p.inp, o); };
    lab.adv = (s: number) => { for (let i = 0; i < s * 30; i++) this.step(1 / 30); };
    lab.pets = this.pets;
    (window as any).__petlab = lab;
    const cam = params.get('cam')?.split(',').map(Number);
    if (cam && cam.length >= 6) lab.cam(...cam);
    else lab.cam(0.2, 0.55, 1.6, 0, 0.38, 0);
    // settle poses before the first frame
    lab.adv(2.5);
  }
  private step(dt: number) {
    for (const p of this.pets) {
      p.t += dt;
      p.c.update(dt, p.inp, this.camera.position);
    }
  }
  update(dt: number) { this.step(Math.min(dt, 1 / 20)); }
  exit() {
    for (const p of this.pets) { p.c.dispose(); p.c.root.removeFromParent(); }
    this.scene.environment?.dispose();
    delete (window as any).__petlab;
  }
}
