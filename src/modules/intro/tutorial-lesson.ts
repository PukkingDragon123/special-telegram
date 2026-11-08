import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { TL } from '../../core/util';
import { addToWok, _test as cookSim } from '../cooking/sim';
import { LESSON, pick } from './lines';
import { playAnim } from './util';

/* ============================================================================================
 * HOST: the guided first kaphrao. Uncle Heng stands at the vendor side of the cart and walks the
 * players through the real cooking interactions, stage by stage, reading the wok's live data:
 *   burner → oil → aroma (garlic/chili) → pork → stir (pork cooked) → season → basil → plate → taste
 * g.introLesson = current stage (replicated; every peer shows the HUD objective + marker).
 * Each stage has nags while you're slow and a takeover ("move, I'll do it!") so nobody soft-locks.
 * Mistakes (burning, the flame going out, a lake of oil) get yelled at; a fire flare gets praise.
 * ========================================================================================== */

export const STAGES = ['burner', 'oil', 'aroma', 'pork', 'stir', 'season', 'basil', 'plate'] as const;
export type Stage = (typeof STAGES)[number] | 'intro' | 'taste' | 'done';

/** seconds before the old man starts nagging / takes over the stage himself */
const NAG_AT = 22;
const TAKEOVER_AT: Record<string, number> = { burner: 45, oil: 60, aroma: 60, pork: 60, stir: 70, season: 70, basil: 60, plate: 90 };

export interface LessonCtx {
  old(): Ent | null;
  cart(): Ent | null;
  say(e: Ent, text: TL, sec: number, style?: 'speech' | 'thought' | 'shout'): void;
  expr(id: number, e: string, hold?: number): void;
  think(id: number, text: TL): void;
  cine(k: string, d?: any): void;
}

export class LessonHost {
  stage: Stage = 'intro';
  private t = 0;
  private nags = 0;
  private nagT = 0;
  private burnT = 0;
  private flareSaid = false;
  private oilSaid = false;
  private fireSaid = 0;
  private jobs: { t: number; fn: () => void }[] = [];
  private tt = 0;
  dish: number | null = null;
  onDone: ((dish: Ent | null, verdict: 'good' | 'ok' | 'bad') => void) | null = null;

  constructor(private game: Game, private ctx: LessonCtx) {
    game.events.on('cook:dish', (d: { player: number; dish: number }) => {
      if (this.stage !== 'plate' && this.stage !== 'basil' && this.stage !== 'season' && this.stage !== 'stir') return;
      this.dish = d.dish;
      if (this.stage !== 'plate') this.set('plate');
      this.complete();
    });
    game.on('cook:flare', () => {
      if (this.stage === 'intro' || this.stage === 'done' || this.flareSaid) return;
      const o = ctx.old();
      if (!o) return;
      this.flareSaid = true;
      ctx.say(o, LESSON.flare, 3, 'shout');
      playAnim(game, o, 'celebrate', false);
      ctx.expr(o.id, 'happy', 2.5);
    });
  }

  private get g() { return this.game.g as any; }
  private after(sec: number, fn: () => void) { this.jobs.push({ t: this.tt + sec, fn }); }

  start() {
    this.jobs = [];
    this.dish = null;
    this.flareSaid = false; this.oilSaid = false;
    this.set('intro');
    const o = this.ctx.old();
    this.ctx.cine('lesson');
    if (o) {
      this.after(0.4, () => { this.ctx.say(o, LESSON.intro[0], 4.2, 'shout'); playAnim(this.game, o, 'lecture', true); this.ctx.expr(o.id, 'determined', 4); });
      this.after(4.8, () => { this.ctx.say(o, LESSON.intro[1], 3.6); playAnim(this.game, o, 'point', false); this.ctx.expr(o.id, 'smug', 3); });
    }
    this.after(8.6, () => this.set('burner'));
  }

  stop() { this.jobs = []; this.set('done'); }
  /** forget everything without touching replicated state (new session) */
  halt() { this.jobs = []; this.stage = 'done'; this.dish = null; }

  private set(s: Stage) {
    this.stage = s;
    this.g.introLesson = s;
    this.t = 0; this.nags = 0; this.nagT = 0;
    const o = this.ctx.old();
    const txt = LESSON.stages[s as string];
    if (o && txt) {
      this.ctx.say(o, txt.say, 4.2);
      playAnim(this.game, o, s === 'stir' ? 'cook_stir' : 'point', false);
      this.ctx.expr(o.id, 'determined', 3);
      this.faceWork(o);
    }
  }

  // ------------------------------------------------------------------ world helpers

  wok(): Ent | null {
    const c = this.ctx.cart();
    const woks = this.game.state.all('item').filter((e) => e.k === 'wok');
    if (!woks.length) return null;
    const onCart = woks.find((w) => c && w.in === c.id);
    if (onCart) return onCart;
    const held = woks.find((w) => w.holder != null);
    if (held) return held;
    if (!c?.p) return woks[0];
    let best = woks[0], bd = Infinity;
    for (const w of woks) { const p = this.game.items.worldPos(w); if (!p) continue; const d = p.distanceTo(new THREE.Vector3(c.p[0], c.p[1], c.p[2])); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  private wd(): any { const w = this.wok(); if (!w) return {}; try { return cookSim.S(w) ?? w.data ?? {}; } catch { return w.data ?? {}; } }
  private g_(k: string) { return this.wd().it?.[k]?.g ?? 0; }

  /** stand at the vendor side, turned toward the burner */
  private faceWork(o: Ent) {
    const c = this.ctx.cart();
    if (!c?.p) return;
    const y = c.yaw ?? 0, cs = Math.cos(y), sn = Math.sin(y);
    const w = (lx: number, lz: number) => [c.p![0] + lx * cs + lz * sn, c.p![1], c.p![2] - lx * sn + lz * cs];
    this.game.npcs.faceTo(o, w(-0.9, 0.2));
  }

  /** where the old man stands during the lesson (cart-local vendor side) */
  standSpot(): number[] | null {
    const c = this.ctx.cart();
    if (!c?.p) return null;
    const y = c.yaw ?? 0, cs = Math.cos(y), sn = Math.sin(y);
    const lx = 0.7, lz = 1.05;
    const p = [c.p[0] + lx * cs + lz * sn, c.p[1], c.p[2] - lx * sn + lz * cs];
    p[1] = this.game.world?.groundY(p[0], p[2]) ?? p[1];
    return p;
  }

  // ------------------------------------------------------------------ stage logic

  private done(): boolean {
    const d = this.wd();
    const c = this.ctx.cart();
    switch (this.stage) {
      case 'burner': return !!c?.burner?.on;
      case 'oil': return (d.oil ?? 0) >= 10;
      case 'aroma': return this.g_('garlic') >= 4 || this.g_('chili') >= 2;
      case 'pork': return this.g_('pork_minced') >= 50;
      case 'stir': { const p = d.it?.pork_minced; return !!p && p.g > 5 && (p.c ?? 0) >= 0.5; }
      case 'season': { const sa = d.sa ?? {}; const tot = Object.values<any>(sa).reduce((a, v) => a + (+v || 0), 0); return tot >= 8; }
      case 'basil': return this.g_('holy_basil') >= 5;
      case 'plate': return this.dish != null;
    }
    return false;
  }

  private complete() {
    const o = this.ctx.old();
    const txt = LESSON.stages[this.stage as string];
    if (o && txt) { this.ctx.say(o, txt.done, 3.2); playAnim(this.game, o, 'nod', false); this.ctx.expr(o.id, 'happy', 2.4); }
    const i = STAGES.indexOf(this.stage as any);
    if (this.stage === 'plate' || i < 0) { this.taste(); return; }
    this.stage = 'intro';           // hold while the praise line plays (g.introLesson keeps the ticked objective)
    this.after(2.6, () => {
      // skip stages that are already satisfied (players who know how to cook race ahead)
      let n = i + 1;
      while (n < STAGES.length - 1) { this.stage = STAGES[n]; if (!this.done()) break; n++; }
      this.set(STAGES[n]);
    });
  }

  /** the old man does the stage himself */
  private takeover() {
    const game = this.game;
    const o = this.ctx.old();
    const c = this.ctx.cart();
    const w = this.wok();
    if (o) { this.ctx.say(o, pick(LESSON.takeover), 3.4, 'shout'); playAnim(game, o, this.stage === 'burner' ? 'point' : 'cook_stir', false); this.ctx.expr(o.id, 'angry', 2.5); }
    const pub = () => { if (w) { try { cookSim.publish(w); } catch { /* */ } } };
    switch (this.stage) {
      case 'burner': if (c) { c.burner = { ...(c.burner ?? { heat: 0.8 }), on: true, heat: Math.max(0.75, c.burner?.heat ?? 0.8) }; game.sfx('gas_ignite', c.p ?? null, { vol: 0.9 }); } break;
      case 'oil': if (w) { addToWok(game, w, 'cooking_oil', 20); pub(); } break;
      case 'aroma': if (w) { addToWok(game, w, 'garlic', 15); addToWok(game, w, 'chili', 6); pub(); } break;
      case 'pork': if (w) { addToWok(game, w, 'pork_minced', 120); pub(); } break;
      case 'stir': if (w) { const s = cookSim.S(w); const p = s.it?.pork_minced; if (p) p.c = Math.max(p.c ?? 0, 0.75); else addToWok(game, w, 'pork_minced', 120, { c: 0.75 }); pub(); } break;
      case 'season': if (w) { addToWok(game, w, 'oyster_sauce', 10); addToWok(game, w, 'fish_sauce', 5); addToWok(game, w, 'sugar', 4); pub(); } break;
      case 'basil': if (w) { addToWok(game, w, 'holy_basil', 18); pub(); } break;
      case 'plate': {
        const ck: any = (game as any).cooking;
        if (ck && c) {
          const top = ck.spots?.plates?.[1] ?? 0.86;
          const dish = ck.spawnDish('kaphrao_moo', [c.p![0], c.p![1] + 1, c.p![2]], { taste: 0.82, issues: ['no_spoon'] });
          if (dish) { ck.putOnCart(dish.id, c.id, [0.34, top, -0.06, 0]); this.dish = dish.id; }
        }
        break;
      }
    }
    if (this.stage === 'plate') { if (this.dish != null) this.complete(); }
    else this.after(1.2, () => { if (this.done()) this.complete(); });
  }

  private taste() {
    const game = this.game;
    this.stage = 'taste';
    this.g.introLesson = 'taste';
    const o = this.ctx.old();
    const dish = this.dish != null ? game.state.get(this.dish) ?? null : null;
    const data = dish?.data ?? {};
    const taste = typeof data.taste === 'number' ? data.taste : 0.6;
    const issues: string[] = Array.isArray(data.issues) ? data.issues : [];
    const verdict: 'good' | 'ok' | 'bad' = taste >= 0.72 ? 'good' : taste >= 0.45 ? 'ok' : 'bad';
    this.ctx.cine('taste', { dish: this.dish, verdict });
    if (o) {
      this.after(0.3, () => { this.ctx.say(o, LESSON.taste, 2.2); playAnim(game, o, 'eat', false); this.ctx.expr(o.id, 'neutral', 2); });
      this.after(2.9, () => {
        const salty = issues.some((i) => /salt/.test(i)) || (data.salty ?? 0) > 0.35;
        const line = salty && verdict !== 'good' ? LESSON.salty : LESSON[verdict];
        this.ctx.say(o, line, 4, verdict === 'good' ? 'shout' : 'speech');
        playAnim(game, o, verdict === 'good' ? 'laugh' : verdict === 'ok' ? 'shrug' : 'facepalm', false);
        this.ctx.expr(o.id, verdict === 'good' ? 'laugh' : verdict === 'ok' ? 'smug' : 'disgust', 3.5);
      });
      this.after(7.4, () => { this.ctx.say(o, LESSON.proud, 2.6); playAnim(game, o, 'nod', false); this.ctx.expr(o.id, 'happy', 2.5); });
    }
    this.after(10.2, () => { this.stage = 'done'; this.g.introLesson = 'done'; this.onDone?.(dish, verdict); });
  }

  update(dt: number) {
    this.tt += dt;
    if (this.jobs.length) {
      const due = this.jobs.filter((j) => j.t <= this.tt);
      if (due.length) { this.jobs = this.jobs.filter((j) => j.t > this.tt); for (const j of due) { try { j.fn(); } catch (e) { console.error('[lesson] job', e); } } }
    }
    if (this.stage === 'intro' || this.stage === 'taste' || this.stage === 'done') return;
    this.t += dt;
    const o = this.ctx.old();
    // keep the teacher at his spot (players may have bumped him)
    if (o?.p && !this.game.npcs.isMoving(o)) {
      const s = this.standSpot();
      if (s && Math.hypot(o.p[0] - s[0], o.p[2] - s[2]) > 0.9) this.game.npcs.go(o, s, { speed: 1.2, direct: true, onArrive: () => this.faceWork(o) });
    }
    if (this.done()) { this.complete(); return; }
    // mistakes (any stage)
    const d = this.wd();
    const c = this.ctx.cart();
    this.burnT -= dt;
    if (o && this.burnT <= 0) {
      const burnt = Object.values<any>(d.it ?? {}).some((v) => (v?.b ?? 0) > 0.3 && (v?.g ?? 0) > 3);
      if (burnt) { this.burnT = 16; this.ctx.say(o, LESSON.burn, 3, 'shout'); playAnim(this.game, o, 'angry', false); this.ctx.expr(o.id, 'shocked', 2.5); return; }
      if (!this.oilSaid && (d.oil ?? 0) > 70) { this.oilSaid = true; this.ctx.say(o, LESSON.tooMuchOil, 3, 'shout'); playAnim(this.game, o, 'facepalm', false); this.ctx.expr(o.id, 'angry', 2.5); return; }
      const solids = Object.values<any>(d.it ?? {}).reduce((a, v) => a + (v?.g ?? 0), 0);
      if (this.fireSaid < 2 && solids > 20 && c && !c.burner?.on && this.stage !== 'plate' && this.stage !== 'burner') { this.fireSaid++; this.burnT = 14; this.ctx.say(o, LESSON.noFire, 3); playAnim(this.game, o, 'lecture', false); this.ctx.expr(o.id, 'angry', 2); return; }
    }
    // nagging while slow
    this.nagT -= dt;
    if (o && this.t > NAG_AT && this.nagT <= 0) {
      this.nagT = 15;
      const txt = LESSON.stages[this.stage as string];
      const line = txt && this.nags < txt.slow.length ? txt.slow[this.nags] : pick(LESSON.nag);
      this.nags++;
      this.ctx.say(o, line, 3.4);
      playAnim(this.game, o, this.nags % 2 ? 'lecture' : 'point', false);
      this.ctx.expr(o.id, this.nags > 1 ? 'angry' : 'determined', 2.4);
    }
    const tk = TAKEOVER_AT[this.stage as string] ?? 70;
    if (this.t > tk) { this.t = tk - 20; this.takeover(); }
  }
}
