import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { round, tl, type TL } from '../../core/util';
import { CHANT, L, OFFER_KINDS, OFFER_NAME, GRANDPA_SHOP, type OfferKind, type Oops } from './lines';
import { rstate, ensureState, patch, type Phase, type RitualState } from './state';
import type { ShrineFrame } from './shrine';
import { fwdOf } from './fx';

/* ============================================================================================
 * ritual — HOST state machine (see state.ts for the phases). Everything replicated goes through
 * g.ritual + the ghost entity (life/ghosts.ts summon()); one-shot cinematics through game.emit('ritual:fx').
 * Time is frozen (g.freezeTime) from the first chant until she leaves: midnight would otherwise put
 * everyone to sleep mid-ritual.
 * ========================================================================================== */

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const dist2 = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const DEMAND_SECONDS = 300;

export interface Judged { stars: number; why: string[] }

/** ghost critic: kaphrao moo + a properly fried egg + real heat; burnt / raw costs a star */
export function judgeKaphrao(d: any): Judged {
  const why: string[] = [];
  let s = 1 + 4 * Math.max(0, Math.min(1, d?.taste ?? 0.5));
  if (d?.egg === 'crispy' || d?.egg === 'runny') { s += 0.6; why.push('egg'); } else { s -= 1; why.push('no_egg'); }
  const sp = d?.spicy ?? 0;
  if (sp >= 0.55) { s += 0.6; why.push('spicy'); } else if (sp < 0.3) { s -= 0.8; why.push('bland'); }
  const iss: string[] = d?.issues ?? [];
  if (iss.some((x) => /burnt|raw/.test(x))) { s -= 1; why.push('burnt_raw'); }
  return { stars: Math.max(1, Math.min(5, Math.round(s))), why };
}

export class RitualHost {
  T = 0;
  private fired = new Set<string>();
  private nextLine = 0;
  private visTarget = 0;

  constructor(private game: Game, private frame: () => ShrineFrame) {}

  private get life(): any { return (this.game as any).life; }
  private s(): RitualState { return ensureState(this.game); }
  private ghost(): Ent | null { const id = rstate(this.game)?.gid; return id != null ? this.game.state.get(id) ?? null : null; }
  private go(st: Phase, extra: Partial<RitualState> = {}) { this.fired.clear(); patch(this.game, { st, t0: this.T, ...extra }); }
  private once(key: string, at: number, fn: () => void) {
    const r = rstate(this.game);
    if (!r || this.fired.has(key) || this.T - r.t0 < at) return;
    this.fired.add(key);
    try { fn(); } catch (e) { console.error('[ritual]', key, e); }
  }
  private fx(k: string, d: any = {}) { this.game.emit('ritual:fx', { k, ...d }); }
  private sayG(text: TL, dur = 4, style?: 'shout' | 'speech') { const g = this.ghost(); if (g) this.game.say(g.id, text, { duration: dur, style: style ?? 'speech', voice: 1.35 } as any); }
  private anim(e: Ent | null, a: string, loop = false) { if (!e) return; e.anim = a; e.animT = this.T + Math.random() * 0.001; e.animLoop = loop; }
  private near(r = 7): Ent[] { const f = this.frame(); return this.game.players().filter((p) => p.p && dist2(p.p, f.pos.toArray()) < r); }
  private freeze(on: boolean) { (this.game.g as any).freezeTime = on ? true : undefined; if (!on) delete (this.game.g as any).freezeTime; }

  // ------------------------------------------------------------------ intents

  install() {
    const game = this.game;
    game.onIntent('ritual.offer', (pl, d: { id: number }) => {
      const r = this.s();
      const it = game.state.get(d.id);
      const f = this.frame();
      if (!it || it.holder !== pl.id || !pl.p || dist2(pl.p, f.pos.toArray()) > 3.2) return;
      const k = it.k as OfferKind;
      if (!OFFER_KINDS.includes(k) || r.off?.[k] || (r.st !== 'idle' && r.st !== 'oops')) return;
      game.items.remove(it);
      patch(game, { off: { ...(r.off ?? {}), [k]: true } });
      game.sfx(k === 'incense' ? 'fire_whoosh' : 'plate_down', f.pos.toArray(), { vol: 0.35, pitch: k === 'incense' ? 2.2 : 1.2 });
      game.say(pl.id, k === 'incense' ? L.incenseLit : L.offered, { duration: 2 });
      this.anim(pl, 'pray');
    });
    game.onIntent('ritual.begin', (pl) => {
      const r = this.s();
      const f = this.frame();
      const t = game.g.time ?? 7;
      if (!pl.p || dist2(pl.p, f.pos.toArray()) > 4 || r.st !== 'idle') return;
      if (OFFER_KINDS.some((k) => !r.off?.[k])) return;
      if ((t < 23 || t >= 23.98) && !this.dev) return;
      if (r.done === (game.g.day ?? 1)) return;
      this.freeze(true);
      for (const p of this.near()) this.anim(p, 'pray', true);
      game.say(pl.id, L.begin, { duration: 2.5 });
      game.sfx('gong', f.pos.toArray(), { vol: 0.8 });
      this.startRound(0, pl.id);
    });
    game.onIntent('ritual.pick', (_pl, d: { round: number; opt: number }) => {
      const r = this.s();
      if (r.st !== 'chant' || r.round !== d.round) return;
      this.game.emit('ritual:close', {});
      const o = CHANT[d.round]?.opts[d.opt];
      if (!o) return;
      if (o.ok) {
        this.game.sfx('ding_correct', this.frame().pos.toArray(), { vol: 0.5 });
        if (d.round + 1 < CHANT.length) this.startRound(d.round + 1, r.by);
        else this.startSummon();
      } else this.startOops(o.oops ?? 'silent');
    });
    game.onIntent('ritual.serve', (pl, d: { id: number }) => {
      const r = this.s();
      const g = this.ghost();
      const it = game.state.get(d.id);
      if (r.st !== 'demand' || !g || !it || it.holder !== pl.id || !pl.p || dist2(pl.p, g.p) > 3.8) return;
      if (it.k !== 'dish') { this.sayG(L.notDish, 3); return; }
      if (it.data?.recipe !== 'kaphrao_moo') { this.sayG(L.notKaphrao, 3.5, 'shout'); this.anim(g, 'angry'); return; }
      const j = judgeKaphrao(it.data);
      const data = { ...it.data };
      game.items.remove(it);
      g.hold = 'dish'; g.holdData = data;
      this.anim(g, 'eat', true);
      game.sfx('plate_down', g.p, { vol: 0.6 });
      game.xp(pl.id, 'serve', 6);
      this.go('eat', { stars: j.stars, by: pl.id });
    });
    game.onIntent('ritual.buy', (pl, d: { what: string }) => {
      const it = GRANDPA_SHOP.find((x) => x.id === d.what);
      const t = game.g.time ?? 7;
      const stall = this.stallPos('amulet_grandpa');
      if (!it || !pl.p || (stall && dist2(pl.p, stall) > 7) || (!this.dev && (t < 7 || t > 17))) return;
      if (!game.money(pl.id, -it.price, 'ritual', pl.p ? [pl.p[0], pl.p[1] + 1.9, pl.p[2]] : null)) { game.say(pl.id, tl('เงินไม่พอ…', 'not enough money…'), { duration: 2 }); return; }
      for (const k of it.kinds) game.items.give(pl, k, k === 'incense' ? { data: { lit: false } } : {});
      if (d.what === 'manual') patch(game, { ...this.s(), manual: true } as any);
    });
    game.onIntent('ritual.lotto', (pl) => {
      const r = this.s();
      const n = r.nums;
      const t = game.g.time ?? 7;
      const stall = this.stallPos('lottery_lady');
      if (!n || r.drawn || (game.g.day ?? 1) !== n.day || t >= 12 || !pl.p || (stall && dist2(pl.p, stall) > 7)) return;
      if (r.tix?.[String(pl.id)]) return;
      if (!game.money(pl.id, -80, 'lottery', [pl.p[0], pl.p[1] + 1.9, pl.p[2]])) { game.say(pl.id, tl('เงินไม่พอซื้อหวย…', "can't afford a ticket…"), { duration: 2 }); return; }
      patch(game, { tix: { ...(r.tix ?? {}), [String(pl.id)]: n.two } });
      game.items.give(pl, 'lotto_ticket', { data: { num: n.two } });
    });
    game.events.on('life:ghost_prayed', (d: { id: number }) => {
      const g = this.ghost();
      if (g && d.id === g.id) { this.sayG(L.prayed, 2.6, 'shout'); this.anim(g, 'angry'); }
    });
  }

  dev = false;

  private stallPos(role: string): number[] | null {
    const t = this.life?.eggs?.talker?.(role);
    return t ? [t.pos.x, t.pos.y, t.pos.z] : null;
  }

  // ------------------------------------------------------------------ phases

  private startRound(round: number, by?: number) {
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    this.go('chant', { round, order, by: by ?? this.s().by });
    this.game.emit('ritual:chant', { round, order });
  }

  private startOops(kind: Oops) {
    this.go('oops', { oops: kind });
    const f = this.frame();
    const g = this.game;
    switch (kind) {
      case 'dog': {
        const dog = this.life?.dog;
        const front = f.pos.clone().add(new THREE.Vector3(0.7, 0, 0));
        try {
          // the soi dog trots in from the dark, barks at the shrine and wolfs down the offering eggs
          const from = f.pos.clone().add(new THREE.Vector3(6.5, 0, 3.5));
          dog?.teleport([from.x, this.game.world?.groundY(from.x, from.z) ?? f.pos.y, from.z]);
          dog?.runTo(front, () => {
            dog.bark(2);
            dog.eat(3, () => {
              const r = this.s();
              if (r.st === 'oops' || r.st === 'idle') { patch(g, { off: { ...r.off, boiled_eggs: false } }); g.sfx('dog_eat', front.toArray(), { vol: 0.7 }); }
              setTimeout(() => dog.free(), 1500);
            });
          });
        } catch {}
        break;
      }
      case 'mosquito': this.fx('mosquito', { p: f.pos.toArray() }); break;
      case 'greedy': this.fx('words', { p: f.pos.clone().add(new THREE.Vector3(0, 1.6, 0)).toArray(), text: L.oops.greedy[0], dur: 5 }); g.sfx('ghost_laugh_female', f.pos.toArray(), { vol: 0.6 }); break;
      case 'ex': try { this.life?.ghosts?.rideMoto(true); } catch {} break;
      case 'seen': this.fx('words', { p: f.pos.clone().add(new THREE.Vector3(0, 1.5, 0)).toArray(), text: tl('อ่านแล้ว ✓', 'Read ✓'), dur: 5 }); g.sfx('timer_ding', f.pos.toArray(), { vol: 0.8 }); break;
      case 'dance': for (const p of this.near()) this.anim(p, 'dance', true); g.sfx('laugh_track', f.pos.toArray(), { vol: 0.6 }); break;
      case 'silent': break;
    }
  }

  private startSummon() {
    this.go('summon');
    const g: any = this.game.g;
    g.rain = Math.max(g.rain ?? 0, 0.85);         // the weather eases it back by itself: a summoning squall
    this.fx('storm', { on: true });
  }

  /** where she waits for her food: beside the cart (customer side), or the shrine without a cart */
  private waitSpot(): { p: THREE.Vector3; yaw: number } {
    const cart = this.game.state.find('cart', () => true);
    const f = this.frame();
    if (cart?.p) {
      const yaw = cart.yaw ?? 0;
      // customer side is -Z in cart space
      const off = new THREE.Vector3(0.2, 0, -1.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const p = new THREE.Vector3(cart.p[0], cart.p[1], cart.p[2]).add(off);
      p.y = this.game.world?.groundY(p.x, p.z) ?? p.y;
      return { p, yaw: Math.atan2(-(cart.p[0] - p.x), -(cart.p[2] - p.z)) };
    }
    return { p: f.kneel.clone().add(new THREE.Vector3(0.6, 0, 0.8)), yaw: -Math.PI / 2 };
  }

  private spawnGhost() {
    const f = this.frame();
    const p = f.pos.clone().add(new THREE.Vector3(0.55, 0.06, 0));
    const ppl = this.near(12);
    const c = ppl.length ? ppl.reduce((a, pl) => a.add(new THREE.Vector3(pl.p[0], 0, pl.p[2])), new THREE.Vector3()).multiplyScalar(1 / ppl.length) : f.kneel.clone();
    const yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
    const g = this.life?.ghosts?.summon?.('review', p.toArray(), yaw, { vis: 0, name: 'ผีนางรีวิว' });
    if (!g) return;
    patch(this.game, { gid: g.id });
    this.visTarget = 0.95;
    this.anim(g, 'idle', true);
  }

  private moveGhost(p: THREE.Vector3, yaw: number) { const g = this.ghost(); if (!g) return; g.p = [round(p.x, 3), round(p.y + 0.05, 3), round(p.z, 3)]; g.yaw = round(yaw, 3); }

  private faceGroup() {
    const g = this.ghost(); if (!g?.p) return;
    const ppl = this.game.players().filter((p) => p.p && dist2(p.p, g.p) < 20);
    if (!ppl.length) return;
    const c = ppl.reduce((a, pl) => a.add(new THREE.Vector3(pl.p[0], 0, pl.p[2])), new THREE.Vector3()).multiplyScalar(1 / ppl.length);
    g.yaw = round(Math.atan2(-(c.x - g.p[0]), -(c.z - g.p[2])), 3);
  }

  private finish(success: boolean) {
    const game = this.game;
    const r = this.s();
    const day = game.g.day ?? 1;
    const g = this.ghost();
    const stars = success ? r.stars ?? 3 : 1;
    // newspaper
    const ds: any = (game.g as any).dayStats;
    if (ds) ds.events = [...(ds.events ?? []), success ? L.newsReview(stars) : L.newsTimeout];
    // permanent reward + tomorrow's blessing (tips ×1.35) for a great review
    const extra: Partial<RitualState> & Record<string, any> = {};
    if (success && stars >= 4) {
      const at = g?.p ?? this.frame().kneel.toArray();
      game.items.spawn('ghost_review_frame', [at[0] + 0.4, (at[1] ?? 0) + 0.6, at[2]]);
      extra.bless = day + 1;
      const gg: any = game.g;
      gg.luckTip = 1.35; gg.luckTipDay = day + 1;
    }
    if (g) this.life?.ghosts?.dismiss?.(g);
    this.freeze(false);
    for (const p of game.players()) if (p.anim === 'pray' || p.anim === 'dance') this.anim(p, 'idle');
    this.fx('storm', { on: false });
    this.go('idle', { off: {}, gid: undefined, done: day, stars, timeout: false, ...extra } as any);
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    this.T += dt;
    const game = this.game;
    const r = rstate(game);
    if (!r) return;
    // ghost visibility easing
    const gh = this.ghost();
    if (gh) { const v = gh.vis ?? 0; if (Math.abs(v - this.visTarget) > 0.01) gh.vis = round(v + Math.sign(this.visTarget - v) * Math.min(Math.abs(this.visTarget - v), dt * 1.1), 2); }
    const el = this.T - r.t0;
    switch (r.st) {
      case 'chant':
        if (el > 28) { this.game.emit('ritual:close', {}); this.startOops('silent'); }
        break;
      case 'oops': {
        const by = r.by != null ? game.state.get(r.by) : game.players()[0];
        const lines = r.oops && r.oops !== 'silent' ? L.oops[r.oops] : [L.silent];
        this.once('l0', 1.2, () => by && game.say(by.id, lines[0], { duration: 3 }));
        this.once('l1', 4.5, () => { const p = game.players().find((x) => x.id !== by?.id) ?? by; if (p && lines[1]) game.say(p.id, lines[1], { duration: 3 }); });
        if (r.oops === 'greedy') this.once('blow', 3, () => { patch(game, { off: { ...this.s().off, incense: false } }); game.sfx('wind_howl', this.frame().pos.toArray(), { vol: 0.8 }); });
        if (r.oops === 'mosquito') { const k = Math.floor(el / 1.6); this.once('slap' + k, k * 1.6, () => { for (const p of this.near()) this.anim(p, 'slap'); game.sfx('slap_hard', this.frame().pos.toArray(), { vol: 0.3, pitch: 1.4 }); }); }
        this.once('retry', 7.5, () => by && game.say(by.id, L.tryAgain, { duration: 3, style: 'thought' } as any));
        if (el > 9) { for (const p of game.players()) if (p.anim === 'pray' || p.anim === 'dance') this.anim(p, 'idle'); this.freeze(false); this.go('idle'); }
        break;
      }
      case 'summon': {
        const A = L.arrive;
        this.once('lz1', 2.5, () => this.fx('lightning', { power: 0.8 }));
        this.once('howl', 3.5, () => game.sfx('dog_howl_night', this.frame().pos.toArray(), { vol: 0.8 }));
        this.once('lz2', 5.2, () => this.fx('lightning', { power: 1 }));
        this.once('spawn', 6.5, () => { this.spawnGhost(); this.fx('appear', { gid: rstate(game)?.gid, faint: this.near(9).map((p) => p.id) }); for (const p of this.near(9)) this.anim(p, 'fall'); });
        this.once('lz3', 7.4, () => this.fx('lightning', { power: 1 }));
        this.once('a0', 8.6, () => { this.sayG(A[0], 3, 'shout'); this.anim(this.ghost(), 'angry'); });
        this.once('wake', 10.5, () => { for (const p of this.near(9)) this.anim(p, 'wake_up'); });
        this.once('a1', 12, () => { this.sayG(A[1], 4.2); this.anim(this.ghost(), 'angry'); });
        this.once('a2', 16.8, () => { this.sayG(A[2], 3.2); this.anim(this.ghost(), 'think'); });
        this.once('a3', 20.5, () => { this.sayG(A[3], 5); this.anim(this.ghost(), 'talk'); });
        this.once('a4', 26, () => { this.sayG(A[4], 4.6, 'shout'); this.anim(this.ghost(), 'point'); });
        this.once('wait', 31.5, () => { this.sayG(L.goWait, 2.4); this.anim(this.ghost(), 'wave'); });
        this.once('fadeout', 33.5, () => { this.visTarget = 0; this.fx('storm', { on: false }); });
        this.once('move', 35, () => {
          const w = this.waitSpot(); this.moveGhost(w.p, w.yaw); this.visTarget = 0.95;
          this.anim(this.ghost(), 'idle', true);
          const by = r.by != null ? game.state.get(r.by) : null;
          if (by) game.say(by.id, L.frozen, { duration: 3 });
          this.go('demand', { until: this.T + DEMAND_SECONDS });
          this.nextLine = this.T + 18;
        });
        break;
      }
      case 'demand': {
        if (this.T > this.nextLine) { this.nextLine = this.T + 22 + Math.random() * 10; this.sayG(pick(L.waiting), 3.2); this.anim(this.ghost(), pick(['think', 'idle', 'shrug'])); }
        if (r.until != null && this.T > r.until) {
          this.go('bye', { stars: 1, timeout: true } as any);
        }
        break;
      }
      case 'eat': {
        this.once('e0', 0.6, () => this.sayG(L.eat[0], 2));
        this.once('e1', 3.0, () => { this.sayG(L.eat[1], 3); this.fx('word', { gid: r.gid, w: 'ง่ำ ง่ำ' }); });
        for (let i = 0; i < 5; i++) this.once('chomp' + i, 0.8 + i * 1.1, () => { const g = this.ghost(); if (g) game.sfx('eat_chomp', g.p, { vol: 0.6 }); });
        if (el > 6.5) {
          const g = this.ghost(); if (g) { g.hold = null; g.holdData = null; }
          this.go('review');
        }
        break;
      }
      case 'review': {
        const n = r.stars ?? 3;
        this.once('stars', 0.3, () => { this.fx('stars', { gid: r.gid, n }); this.anim(this.ghost(), n >= 4 ? 'celebrate' : n <= 2 ? 'sad' : 'shrug'); });
        this.once('r0', 3.2, () => { this.sayG(L.review[n][0], 3.4, n >= 4 || n <= 1 ? 'shout' : 'speech'); const g = this.ghost(); if (g) game.sfx(n >= 4 ? 'crowd_cheer' : n <= 2 ? 'fail_buzzer' : 'crowd_aww', g.p, { vol: 0.7 }); });
        this.once('r1', 6.8, () => this.sayG(L.review[n][1], 3.4));
        if (el > 10.2) this.go('selfie');
        break;
      }
      case 'selfie': {
        this.once('face', 0, () => { this.faceGroup(); this.anim(this.ghost(), 'stand_cool', true); this.sayG(L.selfie[0], 2.6); this.fx('selfie', { gid: r.gid }); });
        this.once('cheese', 2.6, () => this.sayG(L.selfie[1], 1.6, 'shout'));
        if (el > 12.5) this.go('numbers');
        break;
      }
      case 'numbers': {
        this.once('nums', 0.2, () => {
          const g = this.ghost();
          const day = game.g.day ?? 1;
          const two = String(Math.floor(Math.random() * 100)).padStart(2, '0');
          const three = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
          const p = g?.p ?? this.frame().pos.toArray();
          patch(game, { nums: { two, three, day: day + 1, p: [p[0], p[1], p[2]] }, tix: {}, drawn: false });
          this.anim(g, 'point');
          if (g) game.sfx('sparkle_chime', g.p, { vol: 0.8, pitch: 0.7 });
        });
        this.once('n0', 0.8, () => this.sayG(L.numbers[0], 2.6));
        this.once('n1', 3.8, () => this.sayG(L.numbers[1], 3.6));
        if (el > 8) this.go('bye');
        break;
      }
      case 'bye': {
        const timeout = (r as any).timeout;
        if (timeout) {
          this.once('t0', 0.2, () => { this.sayG(L.timeout[0], 3, 'shout'); this.anim(this.ghost(), 'angry'); });
          this.once('t1', 3.4, () => this.sayG(L.timeout[1], 3));
          this.once('fade', 6.5, () => { this.visTarget = 0; });
          if (el > 8) this.finish(false);
        } else {
          this.once('b0', 0.2, () => { this.sayG((r.stars ?? 3) >= 4 ? L.frameGift : L.bye, 3); this.anim(this.ghost(), 'wave'); });
          this.once('b1', 3.0, () => { if ((r.stars ?? 3) >= 4) this.sayG(L.bye, 3); });
          this.once('fade', 5.6, () => { this.visTarget = 0; const g = this.ghost(); if (g) game.sfx('slowmo_whoosh', g.p, { vol: 0.6 }); });
          if (el > 7) this.finish(true);
        }
        break;
      }
    }
    this.lottoTick();
  }

  /** the next day at noon the lottery lady announces the draw: the ghost's two digits come out */
  private lottoTick() {
    const game = this.game;
    const r = rstate(game);
    const n = r?.nums;
    if (!r || !n || r.drawn || (game.g.day ?? 1) !== n.day || (game.g.time ?? 7) < 12) return;
    const winners: string[] = [];
    for (const [pid, num] of Object.entries(r.tix ?? {})) {
      const pl = game.state.get(Number(pid));
      if (!pl || num !== n.two) continue;
      game.money(pl.id, 2000, 'lottery', pl.p ? [pl.p[0], pl.p[1] + 2, pl.p[2]] : null);
      winners.push(pl.name ?? 'เพื่อน');
    }
    const mirror = n.three.split('').reverse().join('');
    patch(game, { drawn: true });
    game.emit('ritual:lotto', { two: n.two, three: n.three, mirror, winners });
    const ds: any = (game.g as any).dayStats;
    if (ds) ds.events = [...(ds.events ?? []), winners.length ? L.newsLottoWin(n.two) : L.newsLottoNobody(n.two)];
  }

  onNewDay(day: number) {
    const r = rstate(this.game);
    if (!r) return;
    // the ghost blessing survives the homeless man's own morning tip reset
    if ((r as any).bless === day) { const g: any = this.game.g; g.luckTip = Math.max(g.luckTipDay === day ? g.luckTip ?? 1 : 1, 1.35); g.luckTipDay = day; }
    if (r.st !== 'idle') { const g = this.ghost(); if (g) this.life?.ghosts?.dismiss?.(g); this.freeze(false); this.go('idle', { gid: undefined }); }
  }

  /** dev: jump into a phase */
  devJump(what: string, me: Ent | null) {
    const game = this.game;
    this.dev = true;
    const all: any = {}; for (const k of OFFER_KINDS) all[k] = true;
    if (what === 'ready' && me) {
      for (const k of OFFER_KINDS) game.items.give(me, k, k === 'incense' ? { data: { lit: true } } : {});
      (game.g as any).time = 23.05;
      return;
    }
    (game.g as any).time = 23.1;
    patch(game, { off: all, by: me?.id });
    this.freeze(true);
    if (what === 'chant') { this.startRound(0, me?.id); return; }
    this.startSummon();
    if (what === 'serve' || what === 'demand') {
      // skip the speech: ghost straight to the cart, a perfect dish in hand
      this.T += 40;
      this.spawnGhost();
      const w = this.waitSpot(); this.moveGhost(w.p, w.yaw);
      this.go('demand', { until: this.T + DEMAND_SECONDS });
      this.fx('storm', { on: false });
      this.visTarget = 0.95;
      this.nextLine = this.T + 10;
      if (what === 'serve' && me) game.items.give(me, 'dish', { data: { recipe: 'kaphrao_moo', egg: 'crispy', rice: 200, portion: 150, taste: 0.88, salty: 0, spicy: 0.72, sweet: 0, cooked: 0, temp: 1, issues: [], spoon: true } });
    }
  }
}

export { OFFER_NAME, fwdOf };
