import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { dist2D, params, TL } from '../../core/util';
import { OLD, OLDMAN_NAME, PLAYER, WAKE, pick } from './lines';
import { anchor, nsfx, playAnim, singletLook } from './util';

/* ============================================================================================
 * HOST state machine for the in-world intro (g.introStep):
 *   wake → see_cart → pay → starter → dog → go_market → done
 * g fields: introStep, introPaid (0..100), introOld (old man npc id), introT0 (g.time at step start)
 * player fields: introLook (saved customised look, restored at 'done'), introPaid (bool)
 * Clients only follow g.introStep (their local effects live in local.ts).
 * ========================================================================================== */

export const STEPS = ['casino', 'wake', 'see_cart', 'pay', 'starter', 'dog', 'go_market', 'done'] as const;
export type Step = (typeof STEPS)[number];
export const isIntroActive = (s: any) => s && s !== 'done';
export const stepIndex = (s: any) => Math.max(0, STEPS.indexOf(s));

interface Job { t: number; fn: () => void }

export class IntroHost {
  private stepT = 0;
  private jobs: Job[] = [];
  private nearT = new Map<number, number>();
  private zzzT = 0;
  private waitCart = 0;
  private caught = false;
  private finishing = false;
  private dogPhase = '';
  private skipPending = false;
  private lastStep: string | undefined = undefined;
  private cur: string | undefined = undefined;

  constructor(private game: Game) {
    game.onIntent('intro.tryCart', (pl) => this.tryCart(pl));
    game.onIntent('intro.pay', (pl) => this.pay(pl));
    game.onIntent('intro.skip', () => this.skipAll());
    game.events.on('player:joined', (pl: Ent) => this.onJoin(pl));
    game.events.on('player:left', (pl: Ent) => this.onLeave(pl));
  }

  get g() { return this.game.g; }
  cart(): Ent | null { return this.game.state.all('cart')[0] ?? null; }
  old(): Ent | null { const e = this.game.state.get(this.g.introOld); return e && e.t === 'npc' ? e : null; }
  private cooking(): any { return (this.game as any).cooking ?? null; }
  private dogApi(): any { return (this.game as any).life?.dog ?? null; }
  private after(sec: number, fn: () => void) { this.jobs.push({ t: this.stepT + sec, fn }); }

  // ------------------------------------------------------------------ step control

  go(step: Step) {
    const g = this.g;
    if (g.introStep === step && this.cur === step) return;
    g.introStep = step;
    this.adopt(step);
  }

  /** Run a step's entry (also when someone else — the casino scene, a console — set g.introStep). */
  private adopt(step: Step) {
    this.cur = step;
    this.g.introT0 = this.g.time;
    this.stepT = 0;
    this.jobs = [];
    this.nearT.clear();
    if (step === 'wake') { this.caught = false; this.finishing = false; this.dogPhase = ''; }
    this.enter(step);
  }

  /** New session / state: forget everything. */
  reset() { this.cur = undefined; this.jobs = []; this.caught = false; this.finishing = false; this.skipPending = false; this.lastStep = undefined; this.waitCart = 0; this.dogPhase = ''; }

  /** HOST: dev/test skip: straight to 'done' with the cart owned + starter kit minus pork/rice. */
  skipAll() {
    this.skipPending = true;
  }

  private doSkip(): boolean {
    const game = this.game;
    const cart = this.cart();
    if (!cart && this.cooking() && this.waitCart < 6) return false; // wait for cooking to spawn its cart
    const g = this.g;
    g.introStep = 'done';
    this.cur = 'done';
    g.phase = 'play';
    g.introPaid = 100;
    if (cart) {
      cart.owner = 'players';
      const ck = this.cooking();
      const has = game.state.all('item').some((e) => e.in === cart.id && e.k === 'recipe_book');
      if (ck && !has) { try { ck.spawnStarterKit(cart.id); ck.eatFoodFromCart(cart.id); } catch (e) { console.warn('[intro] skip kit', e); } }
    }
    for (const pl of game.players()) { this.restoreLook(pl); pl.wallet = 0; pl.introPaid = true; }
    const o = this.old();
    if (o) game.state.despawn(o);
    this.dogApi()?.free?.();
    game.events.emit('intro:done', { skipped: true });
    return true;
  }

  private enter(step: Step) {
    const game = this.game;
    const g = this.g;
    console.info('[intro] step', step);
    switch (step) {
      case 'wake': {
        g.phase = 'intro';
        g.introPaid = 0;
        for (const pl of game.players()) {
          this.dressDown(pl);
          pl.introPaid = false;
          pl.mode = 'free';
          playAnim(game, pl, 'sleep', true);
        }
        this.rebalance();
        const cart = this.cart();
        if (cart) { cart.owner = 'oldman'; cart.pusher = null; }
        this.spawnOld();
        const dog = this.dogApi();
        try { dog?.ensure(); dog?.pose('sleep'); } catch {}
        this.after(3.4, () => { for (const pl of game.players()) playAnim(game, pl, 'wake_up', false); nsfx(game, ['yawn'], null, { vol: 0.5 }); });
        this.after(6.2, () => game.players().forEach((pl, i) => this.think(pl.id, WAKE.thoughts[(pl.slot ?? i) % WAKE.thoughts.length])));
        this.after(8.5, () => this.go('see_cart'));
        break;
      }
      case 'see_cart': {
        for (const pl of game.players()) if (pl.anim === 'sleep' || pl.anim === 'wake_up') playAnim(game, pl, 'idle', true);
        this.after(3.5, () => { const pl = game.players()[0]; if (pl) this.think(pl.id, pick(WAKE.seeCart)); });
        this.after(9, () => { const ps = game.players(); const pl = ps[1] ?? ps[0]; if (pl) this.think(pl.id, pick(WAKE.seeCart, 1)); });
        break;
      }
      case 'pay': {
        this.rebalance();
        this.counter();
        break;
      }
      case 'starter': {
        const cart = this.cart();
        const ck = this.cooking();
        if (cart && ck) {
          const has = game.state.all('item').some((e) => e.in === cart.id && e.k === 'recipe_book');
          if (!has) { try { ck.spawnStarterKit(cart.id); } catch (e) { console.warn('[intro] starter kit', e); } }
        }
        nsfx(game, ['cardboard', 'drop_soft'], cart?.p ?? null, { vol: 0.6 });
        const ps = game.players();
        PLAYER.starter.forEach((l, i) => this.after(1.2 + i * 1.6, () => { const pl = ps[i % Math.max(1, ps.length)]; if (pl) this.think(pl.id, l); }));
        const o = this.old();
        if (o) {
          this.after(3.6, () => { this.say(o, OLD.bye, 3); playAnim(game, o, 'wave', false); });
          this.after(5.0, () => { const t = anchor(game, 'auntie_stall').p; game.npcs.go(o, [3.4, 0.15, t[2] + 6], { speed: 1.05, onArrive: () => { o.lookAt = null; } }); });
        }
        break;
      }
      case 'dog': this.dogScene(); break;
      case 'go_market': {
        game.emit('intro:goMarket', { stall: anchor(game, 'auntie_stall').p });
        const o = this.old();
        if (o) {
          game.npcs.stop(o);
          const ps = game.players();
          if (ps[0]?.p) game.npcs.faceTo(o, ps[0].p);
          this.say(o, OLD.dog, 5.5);
          playAnim(game, o, 'point', false);
          this.after(2.6, () => { const t = anchor(game, 'auntie_stall').p; game.npcs.faceTo(o, t); playAnim(game, o, 'point', false); });
          this.after(6.5, () => game.npcs.go(o, [2.8, 0.15, -125], { speed: 1.1, onArrive: () => { if (game.state.get(o.id)) game.state.despawn(o); } }));
        }
        game.players().forEach((pl, i) => this.after(2.5 + i * 2.2, () => this.think(pl.id, PLAYER.market[i % 2])));
        break;
      }
      case 'done': {
        g.phase = 'play';
        for (const pl of game.players()) this.restoreLook(pl);
        game.events.emit('intro:done', { skipped: false });
        const o = this.old();
        if (o && !game.npcs.isMoving(o)) game.npcs.go(o, [2.8, 0.15, -125], { speed: 1.1, onArrive: () => { if (game.state.get(o.id)) game.state.despawn(o); } });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ per tick

  update(dt: number) {
    const game = this.game;
    const g = this.g;
    if (g.scene !== 'world' || !game.scene) return;
    this.waitCart += dt;
    if (this.skipPending || (params.has('skipintro') && g.introStep !== 'done' && this.lastStep === undefined && !g.introStep)) {
      if (this.doSkip()) { this.skipPending = false; this.lastStep = 'done'; }
      else this.skipPending = true;
      return;
    }
    // first time in the world without an intro step → start waking up (unless a ?intro=<step> test jump)
    if (!g.introStep || g.introStep === 'casino') {
      const want = params.get('intro') as Step | null;
      if (want && STEPS.includes(want) && want !== 'casino') this.jump(want);
      else this.go('wake');
    } else if (g.introStep !== this.cur) this.adopt(g.introStep);
    this.lastStep = g.introStep;
    if (g.introStep === 'done') return;
    this.stepT += dt;
    if (this.jobs.length) {
      const due = this.jobs.filter((j) => j.t <= this.stepT);
      if (due.length) { this.jobs = this.jobs.filter((j) => j.t > this.stepT); for (const j of due) { try { j.fn(); } catch (e) { console.error('[intro] job', e); } } }
    }
    switch (g.introStep) {
      case 'wake': case 'see_cart': {
        const o = this.old();
        if (o && !this.caught && (this.zzzT -= dt) <= 0) { this.zzzT = 6; this.say(o, OLD.zzz, 2.5, 'thought'); nsfx(game, ['snore_loop', 'yawn'], o.p, { vol: 0.45 }); }
        if (g.introStep === 'see_cart' && !this.caught) this.watchCart(dt);
        break;
      }
      case 'starter': {
        if (this.stepT > 9.5) this.go('dog');
        else if (this.stepT > 5) { const c = this.cart(); if (c?.p && game.players().some((p) => p.p && dist2D(p.p, c.p!) < 2.4)) this.go('dog'); }
        break;
      }
      case 'dog': if (this.stepT > 22 && this.dogPhase !== 'done') { this.dogPhase = 'done'; this.go('go_market'); } break;
      case 'go_market': {
        const a = anchor(game, 'auntie_stall').p;
        if (game.players().some((p) => p.p && dist2D(p.p, a) < 4.2)) this.go('done');
        break;
      }
    }
    // never let the old man's cart be wheeled away before it's sold
    const c = this.cart();
    if (c && c.owner === 'oldman' && c.pusher != null) {
      const pl = game.state.get(c.pusher);
      c.pusher = null;
      if (pl) { pl.mode = 'free'; playAnim(game, pl, 'idle', true); if (g.introStep === 'see_cart' || g.introStep === 'wake') this.tryCart(pl); }
    }
  }

  /** Test helper: set up the world as if the intro had reached `step`. */
  jump(step: Step) {
    const game = this.game;
    this.go('wake');
    if (step === 'wake') return;
    this.jobs = [];
    for (const pl of game.players()) playAnim(game, pl, 'idle', true);
    const order: Step[] = ['see_cart', 'pay', 'starter', 'dog', 'go_market', 'done'];
    const idx = order.indexOf(step);
    if (idx >= 1) { this.caught = true; const o = this.old(); if (o) { o.posture = 'stand'; o.face = null; playAnim(game, o, 'idle', true); } }
    if (idx >= 2) {
      this.g.introPaid = 100;
      for (const pl of game.players()) { pl.wallet = 0; pl.introPaid = true; }
      const c = this.cart(); if (c) c.owner = 'players';
    }
    if (step === 'pay') { this.g.introStep = 'see_cart'; this.go('pay'); return; }
    if (idx >= 3) { const ck = this.cooking(), c = this.cart(); if (ck && c && !game.state.all('item').some((e) => e.in === c.id && e.k === 'recipe_book')) ck.spawnStarterKit(c.id); }
    this.g.introStep = order[Math.max(0, idx - 1)];
    this.go(step);
  }

  // ------------------------------------------------------------------ wake helpers

  private dressDown(pl: Ent) {
    if (!pl.introLook) pl.introLook = pl.look ?? this.game.chars.playerLook(pl.slot ?? 0);
    pl.look = singletLook(pl.introLook, pl.slot ?? 0);
  }

  private restoreLook(pl: Ent) {
    if (pl.introLook) { pl.look = pl.introLook; delete pl.introLook; }
  }

  private spawnOld() {
    const game = this.game;
    if (this.old()) return;
    const a = anchor(game, 'old_man_spot');
    const gy = game.world?.groundY(a.p[0], a.p[2]) ?? a.p[1];
    const e = game.state.spawn('npc', {
      role: 'oldman', name: OLDMAN_NAME, look: game.chars.randomLook('old_man_cart_owner', 1717),
      p: [a.p[0], gy, a.p[2]], yaw: a.yaw ?? Math.PI / 2, posture: 'floor', face: 'sleep', lookAt: null, hold: null,
      anim: 'sit_floor', animT: Math.random(), animLoop: true,
    });
    this.g.introOld = e.id;
  }

  // ------------------------------------------------------------------ see_cart: caught!

  private watchCart(dt: number) {
    const game = this.game;
    const c = this.cart();
    const cp = c?.p ?? anchor(game, 'cart_start').p;
    for (const pl of game.players()) {
      if (!pl.p) continue;
      const d = dist2D(pl.p, cp);
      const t = d < 1.45 ? (this.nearT.get(pl.id) ?? 0) + dt : 0;
      this.nearT.set(pl.id, t);
      if (t > 4.5) { this.tryCart(pl); return; } // lingering at the cart counts as trying to take it
    }
  }

  tryCart(pl: Ent) {
    const game = this.game;
    const g = this.g;
    if (this.caught || (g.introStep !== 'see_cart' && g.introStep !== 'wake')) return;
    if (g.introStep === 'wake') this.go('see_cart');
    this.caught = true;
    this.stepT = 0; this.jobs = [];
    const o = this.old() ?? (this.spawnOld(), this.old());
    if (!o) { this.go('pay'); return; }
    o.posture = 'stand'; o.face = null; o.lookAt = pl.id;
    playAnim(game, o, 'angry', false);
    this.say(o, pick(OLD.catch), 3.2, 'shout');
    nsfx(game, ['gasp', 'record_scratch'], o.p, { vol: 0.8 });
    game.emit('intro:caught', { by: pl.id, old: o.id });
    const c = this.cart();
    if (c?.pusher != null) { const pp = game.state.get(c.pusher); c.pusher = null; if (pp) { pp.mode = 'free'; playAnim(game, pp, 'idle', true); } }
    this.after(0.6, () => {
      if (!pl.p || !o.p) return;
      const dir = new THREE.Vector3(o.p[0] - pl.p[0], 0, o.p[2] - pl.p[2]);
      const L = dir.length();
      const to = L > 1.6 ? new THREE.Vector3(pl.p[0], o.p[1], pl.p[2]).addScaledVector(dir.normalize(), 1.3) : new THREE.Vector3(o.p[0], o.p[1], o.p[2]);
      game.npcs.go(o, to, { speed: 1.5, direct: true, onArrive: () => { if (pl.p) game.npcs.faceTo(o, pl.p); } });
    });
    this.after(2.3, () => { this.think(pl.id, pick(OLD.excuse)); playAnim(game, pl, 'shrug', false); });
    this.after(4.6, () => { this.say(o, OLD.look, 3); playAnim(game, o, 'talk', false); });
    this.after(7.4, () => { this.say(o, OLD.offer1, 2.8); playAnim(game, o, 'shrug', false); });
    this.after(10.0, () => { this.say(o, OLD.offer2, 4); playAnim(game, o, 'point', false); });
    this.after(13.0, () => this.go('pay'));
  }

  // ------------------------------------------------------------------ pay: exactly 100 baht

  /** Wallets so that the group holds exactly what's still owed (25/25/25/25 · 33/33/34 · 50/50 · 100). */
  rebalance(leaving?: number) {
    const game = this.game;
    const g = this.g;
    if (!['wake', 'see_cart', 'pay'].includes(g.introStep)) return;
    const ps = game.players().filter((p) => p.id !== leaving);
    if (!ps.length) return;
    const paid = g.introPaid ?? 0;
    const due = Math.max(0, 100 - paid);
    let unpaid = ps.filter((p) => !p.introPaid);
    if (!unpaid.length && due > 0) { for (const p of ps) p.introPaid = false; unpaid = ps; }
    const base = Math.floor(due / Math.max(1, unpaid.length));
    let rest = due - base * unpaid.length;
    unpaid.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    unpaid.forEach((p, i) => { p.wallet = base + (i >= unpaid.length - rest ? 1 : 0); });
    rest = 0;
    for (const p of ps) if (p.introPaid) p.wallet = 0;
  }

  private counter() {
    const o = this.old();
    if (o) this.say(o, OLD.pay(this.g.introPaid ?? 0), 999);
  }

  pay(pl: Ent) {
    const game = this.game;
    const g = this.g;
    if (g.introStep !== 'pay' || this.finishing) return;
    const o = this.old();
    if (!o?.p || !pl.p || dist2D(pl.p, o.p) > 3.4) return;
    const amount = Math.round(pl.wallet ?? 0);
    if (amount <= 0) { this.say(o, OLD.noCoins, 2.5); return; }
    game.money(pl.id, -amount, 'intro:cart', [o.p[0], o.p[1] + 1.85, o.p[2]]);
    pl.introPaid = true;
    g.introPaid = Math.min(100, (g.introPaid ?? 0) + amount);
    playAnim(game, pl, 'count_coins', false);
    o.lookAt = pl.id;
    game.npcs.faceTo(o, pl.p);
    game.emit('intro:coins', { from: pl.id, to: o.id, n: Math.max(3, Math.min(9, Math.round(amount / 5))) });
    nsfx(game, ['coins_handful', 'coin_clink'], pl.p, { vol: 0.9 });
    this.think(pl.id, amount === 25 ? tlx('ผมมียี่สิบห้า', "I've got twenty-five") : amount >= 50 ? tlx(`${amount} บาท… หมดตัวแล้วนะ`, `${amount} baht… that's everything`) : pick(PLAYER.coins));
    this.after(1.4, () => playAnim(game, pl, 'give', false));
    this.after(1.9, () => {
      this.counter();
      playAnim(game, o, 'count_coins', false);
    });
    if (g.introPaid >= 100) {
      this.finishing = true;
      this.after(2.6, () => { this.say(o, OLD.full, 2.6, 'shout'); nsfx(game, ['cash_drawer', 'coins_handful'], o.p, { vol: 0.8 }); });
      this.after(5.4, () => { this.say(o, OLD.wise, 5.2); playAnim(game, o, 'talk', false); });
      this.after(10.8, () => {
        const c = this.cart();
        if (c) { c.owner = 'players'; game.emit('intro:cartOwned', { cart: c.id }); }
        this.say(o, OLD.handover, 3.6);
        playAnim(game, o, 'give', false);
        o.lookAt = null;
        this.go('starter');
      });
    } else {
      this.after(2.4, () => { if (Math.random() < 0.6) this.say(o, pick(OLD.thanks), 2.2); this.after(2.4, () => this.counter()); });
    }
  }

  // ------------------------------------------------------------------ dog eats the rice & pork

  private dogScene() {
    const game = this.game;
    const cart = this.cart();
    const dog = this.dogApi();
    const ck = this.cooking();
    this.dogPhase = 'run';
    const shock = () => {
      game.emit('intro:shock', { sec: 3.2 });
      const ps = game.players();
      ps.forEach((pl, i) => this.after(0.3 + i * 0.5, () => this.say(pl, PLAYER.dog[i % PLAYER.dog.length], 2.4, 'shout')));
    };
    const eatNow = () => {
      if (cart && ck) { try { ck.eatFoodFromCart(cart.id); } catch (e) { console.warn('[intro] eat', e); } }
    };
    const end = () => { if (this.dogPhase !== 'done') { this.dogPhase = 'done'; this.after(1.2, () => this.go('go_market')); } };
    if (!dog || !cart?.p) {
      // no life module: an off-screen thief (sounds + bubbles), food still disappears
      nsfx(game, ['dog_bark'], cart?.p ?? null, { vol: 1 });
      this.after(1.0, () => { nsfx(game, ['dog_eat', 'eat_chomp'], cart?.p ?? null, { vol: 1 }); shock(); });
      this.after(3.6, () => { eatNow(); nsfx(game, ['dog_bark'], cart?.p ?? null, { vol: 0.8 }); end(); });
      return;
    }
    const e = dog.ensure();
    if (!e) { end(); return; }
    const yaw = cart.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw), p = cart.p;
    const local = (lx: number, ly: number, lz: number) => new THREE.Vector3(p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c);
    const below = local(0.55, 0, -0.85);
    below.y = game.world?.groundY(below.x, below.z) ?? below.y;
    const top = local(0.55, 0.862, -0.05);
    const start = new THREE.Vector3(p[0] - 3.5, 0.15, p[2] + 9);
    start.y = game.world?.groundY(start.x, start.z) ?? 0.15;
    dog.script(true).teleport([start.x, start.y, start.z]);
    dog.bark(2);
    const pets = (game as any).life?.pets;
    this.after(0.6, () => dog.runTo(below, () => {
      this.dogPhase = 'jump';
      const land = () => {
        this.dogPhase = 'eat';
        const rice = game.state.all('item').find((it) => it.in === cart.id && (it.k === 'rice_pot' || it.k === 'pork_minced'));
        const wp = rice ? game.items.worldPos(rice) : null;
        if (wp) dog.face([wp.x, wp.y, wp.z]);
        game.emit('intro:dogEat', { dog: e.id, cart: cart.id });
        shock();
        dog.eat(3.6, () => {
          eatNow();
          dog.bark(1);
          try { pets?.jumpDown?.(e); } catch {}
          this.dogPhase = 'flee';
          this.after(0.9, () => dog.runTo(anchor(game, 'dog_home').p, () => { dog.free(); }, { speed: 6.2 }));
          end();
        });
      };
      if (pets?.jump) { try { pets.jump(e, top, land); } catch { land(); } } else land();
    }, { speed: 6.4 }));
  }

  // ------------------------------------------------------------------ joins / leaves

  private onJoin(pl: Ent) {
    if (!this.game.isHost) return;
    const s = this.g.introStep;
    if (!isIntroActive(s) || s === 'casino') return;
    this.dressDown(pl);
    pl.introPaid = stepIndex(s) > stepIndex('pay');
    if (pl.introPaid) pl.wallet = 0;
    this.rebalance();
    if (s === 'pay') this.counter();
  }

  private onLeave(pl: Ent) {
    if (!this.game.isHost) return;
    const s = this.g.introStep;
    if (!isIntroActive(s)) return;
    this.rebalance(pl.id);
    if (s === 'pay') this.counter();
  }

  // ------------------------------------------------------------------ networked bubbles

  /** Thought bubble for a player: owner sees it in front of the camera, others above the head. */
  think(id: number, text: TL) { this.game.emit('intro:think', { id, text }); }
  say(e: Ent, text: TL, sec: number, style: 'speech' | 'thought' | 'shout' = 'speech') {
    this.game.say(e.id, text, { style, duration: sec, voice: style === 'thought' ? 0 : e.t === 'npc' ? 0.75 : 1.1 } as any);
  }
}

const tlx = (th: string, en: string): TL => ({ th, en });
