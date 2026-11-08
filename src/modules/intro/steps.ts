import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { dist2D, params, TL } from '../../core/util';
import { CAUGHT, CUSTOMER, DEAL, DOG, OLDMAN_NAME, OLD_ZZZ, PAY, SNEAK, WAKE, pick } from './lines';
import { anchor, nsfx, playAnim, singletLook } from './util';
import { LessonHost } from './tutorial-lesson';

/* ============================================================================================
 * HOST state machine for the in-world tutorial (g.introStep):
 *   wake (03:00, dark) → sneak (objective: steal the old man's cart) → caught (the squeak, flashlight,
 *   lecture, excuses) → deal (haggling, handshake) → pay (every coin you have, 100 ฿ for the group) →
 *   lesson (Uncle Heng teaches the first kaphrao, step by step) → customer (dawn: serve the first
 *   customer, first money, the cart is yours) → dog (the stray eats the rice & pork) → go_market → done
 * g fields: introStep, introPaid (0..100), introOld (old man npc id), introT0, introBy (the culprit),
 *   introLesson (lesson stage), introCust (first customer npc id), introDish, clockCap / clockRate
 *   (clock.ts: holds the night, then a fast sunrise when the first customer arrives)
 * player fields: introLook (saved customised look, restored at 'done'), introPaid (bool)
 * Network events: intro:think {id,text} · intro:cine {k,…} (cutscene beats, local cameras) ·
 *   intro:expr {id,e,hold} · intro:talk {id,sec} · intro:torch {on,by,old} · intro:choose {to,kind,prompt,options,sec} ·
 *   intro:card {title,sub} · intro:coins · intro:shock · intro:caught · intro:dogEat · intro:cartOwned · intro:goMarket
 * Clients only follow g.introStep and those events (their presentation lives in local.ts).
 * ========================================================================================== */

export const STEPS = ['casino', 'wake', 'sneak', 'caught', 'deal', 'pay', 'lesson', 'customer', 'dog', 'go_market', 'done'] as const;
export type Step = (typeof STEPS)[number];
export const isIntroActive = (s: any) => s && s !== 'done';
export const stepIndex = (s: any) => Math.max(0, STEPS.indexOf(s));

/** in-game hour each step is allowed to reach (the night holds; dawn breaks for the first customer) */
const CLOCK_CAP: Partial<Record<Step, number>> = { wake: 3.2, sneak: 3.55, caught: 3.8, deal: 4.15, pay: 4.4, lesson: 5.5, customer: 6.2, dog: 6.45, go_market: 6.9 };
const START_HOUR = 3.0;

/** wake-up cinematic timing (local.ts plays the camera on the same clock) */
export const WAKE_T = { up: 3.4, stretch: 6.4, look: 9.2, end: 12.6 };

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
  private noise = 0;
  private noiseT = 0;
  private spd = new Map<number, { p: number[]; v: number }>();
  private barkT = 0;
  private ask: { kind: string; to: number; n: number; until: number; cb: (i: number) => void } | null = null;
  private custWaitT = 0;
  private served = false;
  private lesson: LessonHost;
  private worldReady = false;

  constructor(private game: Game) {
    game.onIntent('intro.tryCart', (pl) => this.tryCart(pl));
    game.onIntent('intro.pay', (pl) => this.pay(pl));
    game.onIntent('intro.skip', () => this.skipAll());
    game.onIntent('intro.pick', (pl, d: { kind: string; i: number }) => this.picked(pl, d));
    game.onIntent('intro.serve', (pl, d: { item?: number }) => this.serve(pl, d.item));
    game.events.on('player:joined', (pl: Ent) => this.onJoin(pl));
    game.events.on('player:left', (pl: Ent) => this.onLeave(pl));
    game.events.on('world:ready', () => { this.worldReady = true; this.waitCart = 0; });
    game.events.on('world:exit', () => { this.worldReady = false; });
    this.lesson = new LessonHost(game, {
      old: () => this.old(),
      cart: () => this.cart(),
      say: (e, text, sec, style) => this.say(e, text, sec, style),
      expr: (id, e, hold) => this.expr(id, e, hold),
      think: (id, text) => this.think(id, text),
      cine: (k, d) => this.cine(k, d),
    });
    this.lesson.onDone = (dish) => { this.g.introDish = dish?.id ?? null; this.go('customer'); };
  }

  get g() { return this.game.g as any; }
  cart(): Ent | null { return this.game.state.all('cart')[0] ?? null; }
  old(): Ent | null { const e = this.game.state.get(this.g.introOld); return e && e.t === 'npc' ? e : null; }
  cust(): Ent | null { const e = this.game.state.get(this.g.introCust); return e && e.t === 'npc' ? e : null; }
  culprit(): Ent | null { const e = this.game.state.get(this.g.introBy); return e && e.t === 'player' ? e : this.game.players()[0] ?? null; }
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
    this.ask = null;
    this.nearT.clear();
    if (step === 'wake') { this.caught = false; this.finishing = false; this.dogPhase = ''; this.served = false; this.noise = 0; }
    const cap = CLOCK_CAP[step];
    if (cap !== undefined) this.g.clockCap = cap;
    this.enter(step);
  }

  /** New session / state: forget everything. */
  reset() { this.cur = undefined; this.jobs = []; this.caught = false; this.finishing = false; this.skipPending = false; this.lastStep = undefined; this.waitCart = 0; this.dogPhase = ''; this.ask = null; this.served = false; this.lesson.stop(); }

  /** HOST: dev/test skip: straight to 'done' with the cart owned + starter kit minus pork/rice. */
  skipAll() { this.skipPending = true; }

  private clearClock() {
    const g = this.g;
    delete g.clockCap; delete g.clockRate;
    if ((g.time ?? 7) < 6.3) g.time = 6.5;
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
    g.introLesson = 'done';
    this.lesson.stop();
    this.clearClock();
    if (cart) {
      cart.owner = 'players';
      const ck = this.cooking();
      const has = game.state.all('item').some((e) => e.in === cart.id && e.k === 'recipe_book');
      if (ck && !has) { try { ck.spawnStarterKit(cart.id); ck.eatFoodFromCart(cart.id); } catch (e) { console.warn('[intro] skip kit', e); } }
    }
    for (const pl of game.players()) { this.restoreLook(pl); pl.wallet = 0; pl.introPaid = true; }
    const o = this.old();
    if (o) game.state.despawn(o);
    const c = this.cust();
    if (c) game.state.despawn(c);
    this.dogApi()?.free?.();
    game.emit('intro:torch', { on: false });
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
        g.introLesson = null;
        g.time = START_HOUR;
        g.clockRate = 1;
        for (const pl of game.players()) {
          this.dressDown(pl);
          pl.introPaid = false;
          pl.mode = 'free';
          playAnim(game, pl, 'sleep', true);
        }
        this.rebalance();
        const cart = this.cart();
        if (cart) { cart.owner = 'oldman'; cart.pusher = null; if (cart.burner) cart.burner = { ...cart.burner, on: false }; }
        this.spawnOld();
        const dog = this.dogApi();
        try { dog?.ensure(); dog?.pose('sleep'); } catch { /* no dog */ }
        this.cine('wake');
        const ps = () => game.players();
        this.after(0.4, () => nsfx(game, ['crickets_loop', 'night_insects', 'crickets'], null, { vol: 0.35 }));
        this.after(1.2, () => ps().forEach((pl, i) => this.think(pl.id, WAKE.mono[(pl.slot ?? i) % 4][0])));
        this.after(WAKE_T.up, () => { for (const pl of ps()) { playAnim(game, pl, 'wake_up', false); this.expr(pl.id, 'sleepy', 3); } nsfx(game, ['yawn'], null, { vol: 0.5 }); });
        this.after(4.7, () => ps().forEach((pl, i) => this.think(pl.id, WAKE.mono[(pl.slot ?? i) % 4][1])));
        this.after(WAKE_T.stretch, () => { for (const pl of ps()) playAnim(game, pl, 'stretch', false); nsfx(game, ['yawn', 'cough'], null, { vol: 0.55 }); });
        this.after(7.6, () => ps().forEach((pl, i) => this.think(pl.id, WAKE.mono[(pl.slot ?? i) % 4][2])));
        this.after(WAKE_T.look, () => { for (const pl of ps()) { playAnim(game, pl, 'look_around', false); this.expr(pl.id, 'neutral'); } });
        this.after(10.3, () => ps().forEach((pl, i) => { this.think(pl.id, i === 0 ? WAKE.seeCart : WAKE.planFriend); this.expr(pl.id, 'smug', 3); }));
        this.after(WAKE_T.end, () => this.go('sneak'));
        break;
      }
      case 'sneak': {
        for (const pl of game.players()) if (['sleep', 'wake_up', 'stretch', 'look_around'].includes(pl.anim)) playAnim(game, pl, 'idle', true);
        this.after(1.6, () => game.players().forEach((pl) => { this.think(pl.id, WAKE.plan); this.expr(pl.id, 'determined', 3); }));
        break;
      }
      case 'caught': this.caughtScene(); break;
      case 'deal': this.dealScene(); break;
      case 'pay': {
        this.rebalance();
        this.counter();
        const o = this.old();
        if (o) { o.lookAt = this.culprit()?.id ?? null; playAnim(game, o, 'count_coins', true); }
        break;
      }
      case 'lesson': {
        const cart = this.cart(), ck = this.cooking();
        if (cart && ck && !game.state.all('item').some((e) => e.in === cart.id && e.k === 'recipe_book')) {
          try { ck.spawnStarterKit(cart.id); } catch (e) { console.warn('[intro] starter kit', e); }
          nsfx(game, ['cardboard', 'drop_soft'], cart.p ?? null, { vol: 0.6 });
        }
        game.emit('intro:torch', { on: false });
        const o = this.old();
        const s = this.lesson.standSpot();
        if (o && s) { o.lookAt = null; game.npcs.go(o, s, { speed: 1.2, direct: true }); }
        this.lesson.start();
        break;
      }
      case 'customer': this.customerScene(); break;
      case 'dog': this.dogScene(); break;
      case 'go_market': {
        game.emit('intro:goMarket', { stall: anchor(game, 'auntie_stall').p });
        const o = this.old();
        if (o) {
          game.npcs.stop(o);
          const pl = this.culprit();
          if (pl?.p) game.npcs.faceTo(o, pl.p);
          this.say(o, DOG.market, 5.5);
          playAnim(game, o, 'point', false);
          this.cine('market', { old: o.id });
          this.after(3.0, () => { const t = anchor(game, 'auntie_stall').p; game.npcs.faceTo(o, t); playAnim(game, o, 'point', false); this.expr(o.id, 'happy', 2); });
          this.after(6.2, () => { this.say(o, DOG.bye, 4); playAnim(game, o, 'wave', false); this.expr(o.id, 'laugh', 3); });
          this.after(10.4, () => game.npcs.go(o, [2.8, 0.15, -125], { speed: 1.1, onArrive: () => { if (game.state.get(o.id)) game.state.despawn(o); } }));
        }
        game.players().forEach((pl, i) => this.after(11 + i * 2.2, () => this.think(pl.id, DOG.think[i % 2])));
        break;
      }
      case 'done': {
        g.phase = 'play';
        g.introLesson = 'done';
        this.clearClock();
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
    if (g.scene !== 'world' || !game.scene || !this.worldReady) return;
    this.waitCart += dt;
    // cooking spawns its cart on world:ready; give it a moment before starting any step that needs it
    if (!this.cart() && this.cooking() && this.waitCart < 3) return;
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
    // clock: catch up quickly toward the step's hour (a visible sunrise), then normal speed
    const cap = g.clockCap;
    if (typeof cap === 'number') g.clockRate = Math.min(14, 1 + Math.max(0, cap - (g.time ?? cap) - 0.05) * 22);
    if (this.jobs.length) {
      const due = this.jobs.filter((j) => j.t <= this.stepT);
      if (due.length) { this.jobs = this.jobs.filter((j) => j.t > this.stepT); for (const j of due) { try { j.fn(); } catch (e) { console.error('[intro] job', e); } } }
    }
    // pending choice timed out → default answer
    if (this.ask && this.stepT > this.ask.until) { const a = this.ask; this.ask = null; a.cb(-1); }
    switch (g.introStep) {
      case 'wake': case 'sneak': {
        const o = this.old();
        if (o && !this.caught && (this.zzzT -= dt) <= 0) { this.zzzT = 6.5; this.say(o, OLD_ZZZ, 2.5, 'thought'); nsfx(game, ['snore_loop', 'yawn'], o.p, { vol: 0.45 }); }
        if (g.introStep === 'sneak' && !this.caught) this.watchSneak(dt);
        break;
      }
      case 'lesson': this.lesson.update(dt); break;
      case 'customer': this.watchCustomer(dt); break;
      case 'dog': if (this.stepT > 30 && this.dogPhase !== 'done') { this.dogPhase = 'done'; this.go('go_market'); } break;
      case 'go_market': {
        const a = anchor(game, 'auntie_stall').p;
        if (game.players().some((p) => p.p && dist2D(p.p, a) < 4.2)) this.go('done');
        break;
      }
    }
    // never let the old man's cart be wheeled away before it's handed over
    const c = this.cart();
    if (c && c.owner === 'oldman' && c.pusher != null) {
      const pl = game.state.get(c.pusher);
      c.pusher = null;
      if (pl) { pl.mode = 'free'; playAnim(game, pl, 'idle', true); if (g.introStep === 'sneak' || g.introStep === 'wake') this.tryCart(pl); }
    }
  }

  /** Test helper: set up the world as if the intro had reached `step`. */
  jump(step: Step) {
    const game = this.game;
    this.go('wake');
    if (step === 'wake') return;
    this.jobs = [];
    for (const pl of game.players()) playAnim(game, pl, 'idle', true);
    const order: Step[] = ['sneak', 'caught', 'deal', 'pay', 'lesson', 'customer', 'dog', 'go_market', 'done'];
    const idx = order.indexOf(step);
    this.g.introBy = game.players()[0]?.id ?? null;
    if (idx >= 1) { this.caught = true; const o = this.old(); if (o) { o.posture = 'stand'; o.face = null; playAnim(game, o, 'idle', true); } }
    if (idx >= 4) {
      this.g.introPaid = 100;
      for (const pl of game.players()) { pl.wallet = 0; pl.introPaid = true; }
    }
    if (idx >= 6) { const c = this.cart(); if (c) c.owner = 'players'; }
    const hour = CLOCK_CAP[step];
    if (hour !== undefined) this.g.time = Math.max(START_HOUR, hour - 0.15);
    if (idx >= 5) { const ck = this.cooking(), c = this.cart(); if (ck && c && !game.state.all('item').some((e) => e.in === c.id && e.k === 'recipe_book')) ck.spawnStarterKit(c.id); }
    if (step === 'customer') {
      const ck = this.cooking(), c = this.cart();
      if (ck && c?.p) { const d = ck.spawnDish('kaphrao_moo', [c.p[0], c.p[1] + 1, c.p[2]], { taste: 0.8 }); if (d) { ck.putOnCart(d.id, c.id, [0.34, ck.spots?.plates?.[1] ?? 0.86, -0.06, 0]); this.g.introDish = d.id; } }
    }
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

  // ------------------------------------------------------------------ sneak: noise, sneaking, the cart

  private watchSneak(dt: number) {
    const game = this.game;
    const c = this.cart();
    const o = this.old();
    const cp = c?.p ?? anchor(game, 'cart_start').p;
    this.noiseT -= dt;
    this.barkT -= dt;
    for (const pl of game.players()) {
      if (!pl.p) continue;
      const sp = this.speedOf(pl, dt);
      // crouch → sneaking walk
      if (pl.crouch && pl.anim !== 'sneak' && pl.mode === 'free') playAnim(game, pl, 'sneak', true);
      else if (!pl.crouch && pl.anim === 'sneak') playAnim(game, pl, 'idle', true);
      const d = dist2D(pl.p, cp);
      const t = d < 1.45 ? (this.nearT.get(pl.id) ?? 0) + dt : 0;
      this.nearT.set(pl.id, t);
      if (t > 5.5) { this.tryCart(pl); return; } // lingering at the cart counts as trying to take it
      // noise: running in flip-flops near the old man
      if (o?.p && this.noiseT <= 0) {
        const dOld = dist2D(pl.p, o.p);
        const loud = !pl.crouch && dOld < 7 && sp > 3.9;
        if (loud) {
          this.noise++;
          this.noiseT = 4;
          this.say(o, pick(SNEAK.stir), 2.6, 'thought');
          this.expr(o.id, 'sleepy', 2.6);
          this.think(pl.id, pick(SNEAK.stirThink));
          nsfx(game, ['snore_snort', 'grunt', 'yawn'], o.p, { vol: 0.6 });
          if (this.noise >= 4) { this.tryCart(pl, true); return; }
        }
      }
    }
    if (this.barkT <= 0 && Math.random() < 0.004) { this.barkT = 25; nsfx(game, ['dog_bark_far', 'dog_bark'], [cp[0] - 20, 0.5, cp[2] - 30], { vol: 0.35 }); }
  }

  /** smoothed horizontal speed of a player from replicated positions */
  private speedOf(pl: Ent, dt: number) {
    const r = this.spd.get(pl.id);
    if (!pl.p) return 0;
    if (!r) { this.spd.set(pl.id, { p: [pl.p[0], pl.p[1], pl.p[2]], v: 0 }); return 0; }
    const inst = Math.hypot(pl.p[0] - r.p[0], pl.p[2] - r.p[2]) / Math.max(dt, 1e-3);
    r.v += (Math.min(inst, 9) - r.v) * Math.min(1, dt * 3);
    r.p = [pl.p[0], pl.p[1], pl.p[2]];
    return r.v;
  }

  tryCart(pl: Ent, woke = false) {
    const g = this.g;
    if (this.caught || (g.introStep !== 'sneak' && g.introStep !== 'wake')) return;
    this.caught = true;
    g.introBy = pl.id;
    (this as any).wokeByNoise = woke;
    this.go('caught');
  }

  // ------------------------------------------------------------------ caught: squeak → flashlight → lecture → excuses

  private caughtScene() {
    const game = this.game;
    const pl = this.culprit();
    const o = this.old() ?? (this.spawnOld(), this.old());
    if (!pl || !o) { this.go('deal'); return; }
    const by = pl.id;
    const others = () => game.players().filter((p) => p.id !== by);
    const woke = !!(this as any).wokeByNoise;
    // 1. the squeak (the left wheel he warned about forty years ago)
    if (!woke) {
      playAnim(game, pl, 'push_cart', false);
      const c = this.cart();
      if (c?.p) {
        const y = c.yaw ?? 0;
        c.p = [c.p[0] + Math.cos(y) * 0.28, c.p[1], c.p[2] - Math.sin(y) * 0.28];
        nsfx(game, ['wheel_squeak', 'cart_squeak', 'metal_creak', 'door_creak'], c.p, { vol: 1 });
      }
      this.think(by, CAUGHT.squeak);
      this.expr(by, 'scared', 2);
    }
    this.cine('c_squeak', { by, old: o.id, woke });
    // 2. eyes snap open, flashlight
    this.after(1.3, () => {
      o.posture = 'stand'; o.face = null; o.lookAt = by;
      playAnim(game, o, 'angry', false);
      this.expr(o.id, 'angry', 6);
      game.emit('intro:torch', { on: true, by, old: o.id });
      this.say(o, CAUGHT.shout[0], 3, 'shout');
      nsfx(game, ['record_scratch', 'gasp'], o.p, { vol: 0.85 });
      game.emit('intro:caught', { by, old: o.id });
      this.cine('c_wake', { by, old: o.id });
      if (pl.p) game.npcs.faceTo(o, pl.p);
    });
    // 3. reaction
    this.after(2.9, () => {
      playAnim(game, pl, 'shrug', false);
      this.expr(by, 'shocked', 3);
      this.think(by, pick(CAUGHT.oops));
      others().forEach((p, i) => this.after(0.4 + i * 0.5, () => { this.say(p, CAUGHT.friendGasp[i % CAUGHT.friendGasp.length], 2.2); this.expr(p.id, 'scared', 2.5); }));
      this.cine('c_react', { by, old: o.id });
    });
    // 4. he marches over
    this.after(4.4, () => {
      if (pl.p && o.p) {
        const dir = new THREE.Vector3(o.p[0] - pl.p[0], 0, o.p[2] - pl.p[2]);
        const L = dir.length();
        const to = L > 1.5 ? new THREE.Vector3(pl.p[0], o.p[1], pl.p[2]).addScaledVector(dir.normalize(), 1.25) : new THREE.Vector3(o.p[0], o.p[1], o.p[2]);
        game.npcs.go(o, to, { speed: 1.55, direct: true, onArrive: () => { const p = this.culprit(); if (p?.p) game.npcs.faceTo(o, p.p); playAnim(game, o, 'lecture', true); } });
      }
      this.say(o, CAUGHT.shout[1], 3.2, 'shout');
      this.cine('c_walk', { by, old: o.id });
    });
    // 5. the lecture
    this.after(7.6, () => { this.say(o, CAUGHT.lecture[0], 3.4); playAnim(game, o, 'lecture', true); this.expr(o.id, 'disgust', 3.4); this.cine('c_lecture', { by, old: o.id }); });
    this.after(11.2, () => { this.say(o, CAUGHT.lecture[1], 3.4); this.expr(o.id, 'angry', 3.4); });
    // 6. excuses (the culprit picks)
    this.after(14.8, () => {
      this.cine('c_excuse', { by, old: o.id });
      this.choose(by, 'excuse', CAUGHT.excusePrompt, CAUGHT.excuses, 7, (i) => {
        if (i >= 0) this.say(pl, CAUGHT.excuses[i], 2.4);
        this.after(1.3, () => {
          this.say(o, i >= 0 ? CAUGHT.excuseReply[i] : CAUGHT.excuseTimeout, 3.6, i === 2 ? 'shout' : 'speech');
          playAnim(game, o, i === 2 ? 'angry' : 'facepalm', false);
          this.expr(o.id, i === 1 ? 'laugh' : 'angry', 3);
          this.cine('c_reply', { by, old: o.id });
        });
        this.after(5.3, () => { this.say(o, CAUGHT.lecture[2], 3.6); playAnim(game, o, 'lecture', true); this.expr(o.id, 'angry', 3.6); this.cine('c_lecture2', { by, old: o.id }); });
        this.after(9.3, () => { this.say(o, CAUGHT.soften, 4.2); playAnim(game, o, 'sad', false); this.expr(o.id, 'sad', 4.2); this.cine('c_soften', { by, old: o.id }); });
        this.after(13.8, () => this.go('deal'));
      });
    });
  }

  // ------------------------------------------------------------------ deal: haggling + handshake

  private dealScene() {
    const game = this.game;
    const pl = this.culprit();
    const o = this.old();
    if (!pl || !o) { this.go('pay'); return; }
    const by = pl.id;
    this.cine('d_open', { by, old: o.id });
    this.after(0.2, () => { this.say(o, DEAL.open, 3.4); playAnim(game, o, 'talk', true); this.expr(o.id, 'sad', 3); });
    this.after(3.8, () => { this.say(o, DEAL.offer, 3.8, 'shout'); playAnim(game, o, 'cine_point', false); this.expr(o.id, 'smug', 3.5); this.cine('d_offer', { by, old: o.id }); });
    this.after(8.0, () => {
      this.cine('d_haggle', { by, old: o.id });
      this.choose(by, 'r1', DEAL.r1Prompt, DEAL.r1, 7, (i) => {
        if (i >= 0) this.say(pl, DEAL.r1[i], 2.4);
        else this.say(o, DEAL.timeout, 2.6);
        this.after(1.3, () => { if (i >= 0) { this.say(o, DEAL.r1Reply[i], 3.8, i === 2 ? 'shout' : 'speech'); playAnim(game, o, i === 0 ? 'lecture' : i === 1 ? 'laugh' : 'angry', false); this.expr(o.id, i === 1 ? 'laugh' : 'angry', 3); } this.cine('d_reply', { by, old: o.id }); });
        this.after(5.4, () => { this.say(o, DEAL.nag[0], 5); playAnim(game, o, 'lecture', true); this.expr(o.id, 'angry', 5); this.cine('d_nag', { by, old: o.id }); });
        this.after(10.6, () => { this.say(o, DEAL.nag[1], 4.4); this.expr(o.id, 'disgust', 4); });
        this.after(15.2, () => {
          this.say(o, DEAL.r2Prompt, 3.4);
          playAnim(game, o, 'shrug', false);
          this.cine('d_haggle', { by, old: o.id });
          this.choose(by, 'r2', DEAL.r2Prompt, DEAL.r2, 7, (j) => {
            if (j >= 0) this.say(pl, DEAL.r2[j], 2.4);
            this.after(1.3, () => { this.say(o, j >= 0 ? DEAL.r2Reply[j] : DEAL.timeout, 3.6, j === 2 ? 'shout' : 'speech'); playAnim(game, o, j === 2 ? 'angry' : 'laugh', false); this.expr(o.id, j === 2 ? 'angry' : 'laugh', 3); this.cine('d_reply', { by, old: o.id }); });
            this.after(5.3, () => { this.say(o, DEAL.final, 5); playAnim(game, o, 'lecture', true); this.expr(o.id, 'determined', 5); this.cine('d_final', { by, old: o.id }); });
            this.after(10.6, () => this.handshake());
          });
        });
      });
    });
  }

  private handshake() {
    const game = this.game;
    const pl = this.culprit();
    const o = this.old();
    if (!pl?.p || !o?.p) { this.go('pay'); return; }
    // step up to arm's length, face each other
    const dir = new THREE.Vector3(o.p[0] - pl.p[0], 0, o.p[2] - pl.p[2]);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    const to = new THREE.Vector3(pl.p[0], o.p[1], pl.p[2]).addScaledVector(dir, 0.82);
    game.npcs.go(o, to, { speed: 1, direct: true, onArrive: () => { const p = this.culprit(); if (p?.p) game.npcs.faceTo(o, p.p); } });
    this.say(o, DEAL.shake, 2.6, 'shout');
    this.cine('d_shake', { by: pl.id, old: o.id });
    this.after(0.9, () => {
      const p = this.culprit();
      if (p?.p) game.npcs.faceTo(o, p.p);
      playAnim(game, o, 'handshake', false);
      if (p) playAnim(game, p, 'handshake', false);
      this.expr(o.id, 'happy', 3);
      if (p) this.expr(p.id, 'happy', 3);
      nsfx(game, ['handshake', 'clap_single', 'slap_light', 'whoosh_swing'], o.p, { vol: 0.8 });
    });
    this.after(1.7, () => game.emit('intro:card', { title: DEAL.card, sub: DEAL.cardSub }));
    this.after(2.6, () => this.think(pl.id, DEAL.shakeThink));
    this.after(5.6, () => this.go('pay'));
  }

  // ------------------------------------------------------------------ choices (the culprit picks on their screen)

  private choose(to: number, kind: string, prompt: TL, options: TL[], sec: number, cb: (i: number) => void) {
    this.ask = { kind, to, n: options.length, until: this.stepT + sec + 1.5, cb };
    this.game.emit('intro:choose', { to, kind, prompt, options, sec });
  }

  private picked(pl: Ent, d: { kind: string; i: number }) {
    const a = this.ask;
    if (!a || a.kind !== d.kind) return;
    const culpritHere = !!this.game.state.get(a.to);
    if (culpritHere && pl.id !== a.to) return;
    const i = Number.isInteger(d.i) && d.i >= 0 && d.i < a.n ? d.i : -1;
    this.ask = null;
    a.cb(i);
  }

  // ------------------------------------------------------------------ pay: exactly 100 baht

  /** Wallets so that the group holds exactly what's still owed (25/25/25/25 · 33/33/34 · 50/50 · 100). */
  rebalance(leaving?: number) {
    const game = this.game;
    const g = this.g;
    if (!['wake', 'sneak', 'caught', 'deal', 'pay'].includes(g.introStep)) return;
    const ps = game.players().filter((p) => p.id !== leaving);
    if (!ps.length) return;
    const paid = g.introPaid ?? 0;
    const due = Math.max(0, 100 - paid);
    let unpaid = ps.filter((p) => !p.introPaid);
    if (!unpaid.length && due > 0) { for (const p of ps) p.introPaid = false; unpaid = ps; }
    const base = Math.floor(due / Math.max(1, unpaid.length));
    const rest = due - base * unpaid.length;
    unpaid.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    unpaid.forEach((p, i) => { p.wallet = base + (i >= unpaid.length - rest ? 1 : 0); });
    for (const p of ps) if (p.introPaid) p.wallet = 0;
  }

  private counter() {
    const o = this.old();
    if (o) this.say(o, PAY.ask(this.g.introPaid ?? 0), 999);
  }

  pay(pl: Ent) {
    const game = this.game;
    const g = this.g;
    if (g.introStep !== 'pay' || this.finishing) return;
    const o = this.old();
    if (!o?.p || !pl.p || dist2D(pl.p, o.p) > 3.4) return;
    const amount = Math.round(pl.wallet ?? 0);
    if (amount <= 0) { this.say(o, PAY.noCoins, 2.5); return; }
    game.money(pl.id, -amount, 'intro:cart', [o.p[0], o.p[1] + 1.85, o.p[2]]);
    pl.introPaid = true;
    g.introPaid = Math.min(100, (g.introPaid ?? 0) + amount);
    playAnim(game, pl, 'count_coins', false);
    o.lookAt = pl.id;
    game.npcs.faceTo(o, pl.p);
    game.emit('intro:coins', { from: pl.id, to: o.id, n: Math.max(3, Math.min(9, Math.round(amount / 5))) });
    nsfx(game, ['coins_handful', 'coin_clink'], pl.p, { vol: 0.9 });
    this.think(pl.id, amount >= 50 ? PAY.all(amount) : pick(PAY.coins));
    this.after(1.4, () => playAnim(game, pl, 'give', false));
    this.after(1.9, () => { this.counter(); playAnim(game, o, 'count_coins', false); });
    if (g.introPaid >= 100) {
      this.finishing = true;
      this.after(2.6, () => { this.say(o, PAY.full, 4.4, 'shout'); playAnim(game, o, 'laugh', false); this.expr(o.id, 'laugh', 3); nsfx(game, ['cash_drawer', 'coins_handful'], o.p, { vol: 0.8 }); });
      this.after(7.4, () => { this.finishing = false; o.lookAt = null; this.go('lesson'); });
    } else {
      this.after(2.4, () => { if (Math.random() < 0.7) { this.say(o, pick(PAY.thanks), 2.6); this.expr(o.id, 'smug', 2); } this.after(2.8, () => this.counter()); });
    }
  }

  // ------------------------------------------------------------------ customer: dawn, the first sale

  private customerScene() {
    const game = this.game;
    const c = this.cart();
    const o = this.old();
    this.custWaitT = 0;
    this.served = false;
    if (!c?.p) { this.go('dog'); return; }
    const y = c.yaw ?? 0, cs = Math.cos(y), sn = Math.sin(y);
    const w = (lx: number, lz: number) => [c.p![0] + lx * cs + lz * sn, c.p![1], c.p![2] - lx * sn + lz * cs];
    const start = [c.p[0] - 2.2, 0.15, c.p[2] + 14];
    start[1] = game.world?.groundY(start[0], start[2]) ?? 0.15;
    const e = game.state.spawn('npc', {
      role: 'intro_customer', name: CUSTOMER.name, look: game.chars.randomLook('moto_taxi', 5151),
      p: start, yaw: Math.PI, posture: 'stand', face: null, lookAt: null, hold: null, anim: 'idle', animT: Math.random(), animLoop: true,
    });
    this.g.introCust = e.id;
    const stand = w(-0.25, -1.35);
    stand[1] = game.world?.groundY(stand[0], stand[2]) ?? stand[1];
    game.npcs.go(e, stand, { speed: 1.35, onArrive: () => { game.npcs.faceTo(e, c.p!); this.say(e, CUSTOMER.arrive, 3.6); playAnim(game, e, 'wave', false); this.expr(e.id, 'happy', 2.5); this.after(3.9, () => { const old = this.old(); if (old) { this.say(old, CUSTOMER.oldIntro, 3.6); playAnim(game, old, 'laugh', false); this.expr(old.id, 'smug', 3); } }); } });
    this.cine('cu_see', { old: o?.id ?? null, cust: e.id });
    if (o) {
      game.npcs.faceTo(o, start);
      this.after(0.6, () => { this.say(o, CUSTOMER.oldSees, 4.6, 'shout'); playAnim(game, o, 'point', false); this.expr(o.id, 'happy', 3); });
    }
  }

  private watchCustomer(dt: number) {
    const game = this.game;
    const e = this.cust();
    if (!e) { if (this.stepT > 3 && !this.served) this.go('dog'); return; }
    if (this.served) return;
    this.custWaitT += dt;
    if (!game.npcs.isMoving(e) && this.custWaitT > 18 && Math.floor((this.custWaitT - dt) / 17) !== Math.floor(this.custWaitT / 17)) {
      this.say(e, pick(CUSTOMER.wait), 3);
      this.expr(e.id, 'sad', 2.5);
    }
    // nobody serves → Uncle Heng hands over the plate himself
    if (this.custWaitT > 150) {
      const pl = this.culprit();
      const dish = game.state.get(this.g.introDish) ?? game.state.all('item').find((it) => it.k === 'dish') ?? null;
      if (pl) this.doServe(pl, dish);
    }
  }

  private serve(pl: Ent, itemId?: number) {
    if (this.g.introStep !== 'customer' || this.served) return;
    const e = this.cust();
    const it = this.game.state.get(itemId ?? pl.inv?.[pl.sel ?? 0]);
    if (!e?.p || !pl.p || !it || it.k !== 'dish' || it.holder !== pl.id) return;
    if (dist2D(pl.p, e.p) > 3.6) return;
    this.doServe(pl, it);
  }

  private doServe(pl: Ent, dish: Ent | null) {
    const game = this.game;
    const e = this.cust();
    const o = this.old();
    if (!e) return;
    this.served = true;
    const data = dish?.data ?? {};
    const taste = typeof data.taste === 'number' ? data.taste : 0.7;
    const verdict = taste >= 0.72 ? 'good' : taste >= 0.45 ? 'ok' : 'bad';
    if (dish) game.items.remove(dish);
    game.npcs.stop(e);
    if (pl.p) game.npcs.faceTo(e, pl.p);
    this.say(e, CUSTOMER.thanks, 2);
    playAnim(game, pl, 'give', false);
    this.cine('cu_eat', { by: pl.id, cust: e.id, old: o?.id ?? null, verdict });
    this.after(1.2, () => { playAnim(game, e, 'eat', true); this.expr(e.id, 'neutral'); nsfx(game, ['eat_chomp', 'slurp'], e.p, { vol: 0.7 }); });
    this.after(4.4, () => {
      this.say(e, CUSTOMER[verdict], 3.6, verdict === 'good' ? 'shout' : 'speech');
      playAnim(game, e, verdict === 'good' ? 'celebrate' : verdict === 'ok' ? 'nod' : 'facepalm', false);
      this.expr(e.id, verdict === 'good' ? 'laugh' : verdict === 'ok' ? 'smug' : 'disgust', 3);
    });
    this.after(8.2, () => {
      const head = e.p ? [e.p[0], e.p[1] + 1.9, e.p[2]] : null;
      game.money(pl.id, 50, 'intro:first_sale', head);
      this.say(e, CUSTOMER.pay, 2.4);
      playAnim(game, e, 'give', false);
      nsfx(game, ['coins_handful', 'cash_register'], e.p, { vol: 0.8 });
      this.cine('cu_paid', { by: pl.id, cust: e.id, old: o?.id ?? null });
    });
    this.after(10.8, () => { if (o) { this.say(o, CUSTOMER.firstMoney, 4.4); playAnim(game, o, 'lecture', false); this.expr(o.id, 'happy', 4); } });
    this.after(15.6, () => {
      const c = this.cart();
      if (c) { c.owner = 'players'; game.emit('intro:cartOwned', { cart: c.id }); }
      if (o) { this.say(o, CUSTOMER.handover, 4); playAnim(game, o, 'give', false); this.expr(o.id, 'happy', 3); }
      this.think(pl.id, CUSTOMER.think);
    });
    this.after(17.5, () => { const cu = this.cust(); if (cu) { playAnim(game, cu, 'wave', false); game.npcs.go(cu, [cu.p![0] - 3, 0.15, cu.p![2] + 30], { speed: 1.4, onArrive: () => { if (game.state.get(cu.id)) game.state.despawn(cu); } }); } });
    this.after(20.4, () => this.go('dog'));
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
      ps.forEach((pl, i) => this.after(0.3 + i * 0.5, () => { this.say(pl, DOG.shout[i % DOG.shout.length], 2.4, 'shout'); this.expr(pl.id, 'shocked', 3); }));
    };
    const eatNow = () => { if (cart && ck) { try { ck.eatFoodFromCart(cart.id); } catch (e) { console.warn('[intro] eat', e); } } };
    const end = () => {
      if (this.dogPhase === 'done') return;
      this.dogPhase = 'done';
      this.after(1.0, () => {
        const o = this.old();
        if (o) {
          const pl = this.culprit();
          if (pl?.p) game.npcs.faceTo(o, pl.p);
          this.say(o, DOG.laugh, 4.4, 'shout');
          playAnim(game, o, 'laugh', false);
          this.expr(o.id, 'laugh', 4);
          this.cine('dog_laugh', { old: o.id, by: this.culprit()?.id ?? null });
        }
      });
      this.after(5.8, () => this.go('go_market'));
    };
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
    this.cine('dog_run', { dog: e.id, cart: cart.id });
    const pets = (game as any).life?.pets;
    this.after(0.6, () => dog.runTo(below, () => {
      this.dogPhase = 'jump';
      const land = () => {
        this.dogPhase = 'eat';
        const rice = game.state.all('item').find((it) => it.in === cart.id && (it.k === 'rice_pot' || it.k === 'pork_minced'));
        const wp = rice ? game.items.worldPos(rice) : null;
        if (wp) dog.face([wp.x, wp.y, wp.z]);
        game.emit('intro:dogEat', { dog: e.id, cart: cart.id });
        this.cine('dog_eat', { dog: e.id, cart: cart.id, by: this.culprit()?.id ?? null });
        shock();
        dog.eat(3.6, () => {
          eatNow();
          dog.bark(1);
          try { pets?.jumpDown?.(e); } catch { /* */ }
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
    if (this.g.introBy === pl.id) this.g.introBy = this.game.players().find((p) => p.id !== pl.id)?.id ?? null;
  }

  // ------------------------------------------------------------------ networked presentation helpers

  /** Thought for a player: the owner gets the monologue subtitle, others a cloud above the head. */
  think(id: number, text: TL) { this.game.emit('intro:think', { id, text }); }
  say(e: Ent, text: TL, sec: number, style: 'speech' | 'thought' | 'shout' = 'speech') {
    this.game.say(e.id, text, { style, duration: sec, voice: style === 'thought' ? 0 : e.t === 'npc' ? (e.role === 'oldman' ? 0.72 : 0.92) : 1.1 } as any);
    if (style !== 'thought' && sec < 60) this.game.emit('intro:talk', { id: e.id, sec: Math.min(sec * 0.75, 4.5) });
  }
  expr(id: number, e: string, hold?: number) { this.game.emit('intro:expr', { id, e, hold }); }
  cine(k: string, d: any = {}) { this.game.emit('intro:cine', { k, ...d }); }
}
