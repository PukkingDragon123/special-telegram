import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { tl, TL, dist2D } from '../../core/util';
import { F } from '../../core/fonts';
import { Input } from '../../core/input';
import { Overlay } from '../../ui3d/overlay';
import { hud, HudObjective } from '../hud/api';
import { CART_LABEL, CUSTOMER, DOG, HINTS, LESSON, PAY, SNEAK, WAKE } from './lines';
import { anchor, clamp01, ease, headOf, play, rigOf, smooth, tex } from './util';
import { isIntroActive, WAKE_T } from './steps';
import { makeCoin } from './casino-fx';
import { CineCam, Pose, Shot, closeUp, crane, easeOut, fixed, linear, orbit, ots, subject, track, twoShot } from './tutorial-cam';
import { Monologue } from './tutorial-mono';
import { registerTutorialDialogue } from './tutorial-dialog';

/* ============================================================================================
 * Every peer: local presentation of the in-world tutorial (driven by g.introStep + one-shot events).
 *  - cinematic cameras for every scripted beat (tutorial-cam.ts): the 03:00 wake-up, the squeak and the
 *    flashlight, the lecture, the haggling, the handshake, the lesson, the first customer, the dog
 *  - HUD objectives with markers (steal the cart → pay → each cooking stage → serve → market → first day)
 *  - talking to yourself (tutorial-mono.ts): your thoughts as subtitles, friends' as clouds over their heads
 *  - facial expressions / talking mouths on the characters, the old man's flashlight, the DEAL! title card,
 *    coins flying into his hand, the chalk arrows to the market, the excuse / haggling choices
 *  - interaction overrides (push the old man's cart → caught; [E] give coins; [E] serve the first customer)
 * ========================================================================================== */

interface Flying { m: THREE.Mesh; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; spin: THREE.Vector3; done?: boolean }

const FACE_FALLBACK: Record<string, string | null> = { shocked: 'shock', scared: 'shock', angry: 'scream', pain: 'scream', sleepy: 'sleep', drunk: 'drunk', determined: 'think', smug: 'think', sad: 'think', disgust: 'think' };
const STAGE_SPOT: Record<string, string> = { burner: 'burner', oil: 'rack5', aroma: 'disp2', pork: 'disp0', stir: 'spatula', season: 'rack0', basil: 'disp1', plate: 'rice' };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class IntroLocal {
  private step: string | undefined;
  private lessonStage: string | undefined;
  private paidSeen = -1;
  private time = 0;
  private flying: Flying[] = [];
  private arrows: THREE.Group | null = null;
  private arrowsUntil = 0;
  private nudge: { to: number; t: number } | null = null;
  private faceReset: { id: number; at: number }[] = [];
  private talking = new Map<number, number>();
  private wakeOn = false;
  private wakeT = 0;
  private hang = 0;
  private cine: CineCam;
  private mono: Monologue;
  private torch: { cone: THREE.Mesh; lens: THREE.Mesh; light: any; by: number; old: number; on: boolean; k: number } | null = null;
  private cardEl: HTMLDivElement | null = null;
  private objIds = new Set<string>();
  private custSub = '';
  private skipHold = 0;
  // first-day objectives after the intro
  private day: { id: string; o: HudObjective; done: () => boolean }[] = [];
  private dayT = 0;
  private bookOpened = false;
  private walletSeen = -1;
  private earned = false;

  constructor(private game: Game) {
    this.cine = new CineCam(game);
    registerTutorialDialogue();
    this.mono = new Monologue(game, (text, sec) => game.emit('intro:think', { id: game.localPlayerId, text, sec }));
    game.events.on('world:ready', () => this.onWorld());
    game.events.on('world:exit', () => this.onExit());
    game.on('intro:think', (d: { id: number; text: TL; sec?: number }) => this.think(d.id, d.text, d.sec));
    game.on('intro:coins', (d: { from: number; to: number; n: number }) => this.coins(d.from, d.to, d.n));
    game.on('intro:shock', (d: { sec: number }) => this.shock(d.sec ?? 3));
    game.on('intro:caught', (d: { by: number; old: number }) => { if (d.by === game.localPlayerId) this.lookAtEnt(d.old); });
    game.on('intro:cine', (d: any) => this.onCine(d));
    game.on('intro:expr', (d: { id: number; e: string; hold?: number }) => this.expr(d.id, d.e, d.hold));
    game.on('intro:talk', (d: { id: number; sec: number }) => this.talk(d.id, d.sec));
    game.on('intro:torch', (d: { on: boolean; by?: number; old?: number }) => this.setTorch(d));
    game.on('intro:choose', (d: { to: number; kind: string; prompt: TL; options: TL[]; sec: number }) => this.choose(d));
    game.on('intro:card', (d: { title: TL; sub?: TL }) => this.card(d.title, d.sub));
    game.events.on('cook:openBook', () => { this.bookOpened = true; });
    // during cutscenes the camera is close on faces, so spoken lines also run as cinematic subtitles
    game.on('say', (d: { id: number; text: string | TL; o?: any }) => this.subtitle(d));
    game.engine.onLate((f) => this.late(f.rawDt));
    game.interact.provide((ctx) => this.provide(ctx), 50);
  }

  // ------------------------------------------------------------------ scene hooks

  private onWorld() {
    const g = this.game.g;
    this.step = undefined;
    this.lessonStage = undefined;
    if (g.introStep === 'wake' || (!g.introStep && !this.skipping())) this.startWake();
  }

  private skipping() { const q = new URLSearchParams(location.search); return q.has('skipintro') || q.has('intro'); }

  private onExit() {
    this.wakeOn = false;
    this.hang = 0;
    this.removeArrows();
    for (const f of this.flying) f.m.removeFromParent();
    this.flying = [];
    this.setTorch({ on: false });
    if (this.torch) { this.torch.cone.removeFromParent(); this.torch.lens.removeFromParent(); }
    this.torch = null;
    this.clearObjectives();
  }

  // ------------------------------------------------------------------ HUD objectives

  private setObj(o: HudObjective) {
    const h = hud(this.game);
    this.objIds.add(o.id);
    if (h) { h.setObjective(o); return; }
    const t = typeof o.text === 'string' ? o.text : o.text.th;
    const s = o.sub ? (typeof o.sub === 'string' ? o.sub : o.sub.th) : '';
    Overlay.showHint(s ? `${t} · ${s}` : t, 6);
  }
  private clearObj(id: string, completed = false) {
    if (!this.objIds.has(id)) return;
    this.objIds.delete(id);
    hud(this.game)?.clearObjective(id, completed);
  }
  private clearObjectives() { for (const id of [...this.objIds]) this.clearObj(id); }

  private cartPos(y = 1.0): THREE.Vector3 | null {
    const c = this.game.state.all('cart')[0];
    if (!c?.p) return null;
    const o = this.game.views.objectOf(c.id);
    const v = o ? o.getWorldPosition(V()) : V(c.p[0], c.p[1], c.p[2]);
    return v.add(V(0, y, 0));
  }
  private entHead(id: number | null | undefined): THREE.Vector3 | null {
    if (id == null || !this.game.state.get(id)) return null;
    return headOf(this.game, id, V())?.add(V(0, 0.25, 0)) ?? null;
  }
  private cartSpot(spot: string): THREE.Vector3 | null {
    const c = this.game.state.all('cart')[0];
    const ck: any = (this.game as any).cooking;
    const p = c && ck?.cartSpot ? ck.cartSpot(c.id, spot) : null;
    return p ? V(p[0], p[1] + 0.12, p[2]) : this.cartPos();
  }

  private stepObjectives(step: string | undefined, prev: string | undefined) {
    const g: any = this.game.g;
    if (prev === 'sneak') this.clearObj('tut_steal', true);
    if (prev === 'pay') this.clearObj('tut_pay', true);
    if (prev === 'lesson') { this.clearObj('tut_stage', true); this.clearObj('tut_lesson', true); }
    if (prev === 'customer') this.clearObj('tut_serve', true);
    if (prev === 'go_market') this.clearObj('tut_market', true);
    switch (step) {
      case 'sneak': this.setObj({ id: 'tut_steal', text: SNEAK.obj, sub: SNEAK.sub, target: () => this.cartPos(1.1), priority: 0 }); break;
      case 'pay': this.paidSeen = -1; break;
      case 'lesson': this.setObj({ id: 'tut_lesson', text: LESSON.obj, priority: 0 }); break;
      case 'customer': this.custSub = ''; break;
      case 'go_market': this.setObj({ id: 'tut_market', text: DOG.marketObj, sub: DOG.marketSub, target: () => { const a = anchor(this.game, 'auntie_stall').p; return V(a[0], a[1] + 1.6, a[2]); }, priority: 0 }); break;
    }
    void g;
  }

  /** objectives that follow live state (pay counter, lesson stage, holding the plate) */
  private liveObjectives() {
    const game = this.game, g: any = game.g;
    const step = g.introStep;
    if (step === 'pay') {
      const paid = g.introPaid ?? 0;
      if (paid !== this.paidSeen) { this.paidSeen = paid; this.setObj({ id: 'tut_pay', text: PAY.obj(paid), sub: PAY.sub, target: () => this.entHead(g.introOld), priority: 0, progress: { have: paid, need: 100 } }); }
    } else if (step === 'lesson') {
      const st = g.introLesson;
      if (st !== this.lessonStage) {
        const prev = this.lessonStage;
        this.lessonStage = st;
        if (prev && LESSON.stages[prev]) this.clearObj('tut_stage', true);
        const txt = st ? LESSON.stages[st] : null;
        if (txt) {
          const spot = STAGE_SPOT[st];
          const idx = ['burner', 'oil', 'aroma', 'pork', 'stir', 'season', 'basil', 'plate'].indexOf(st);
          setTimeout(() => {
            if ((this.game.g as any).introLesson !== st) return;
            this.setObj({ id: 'tut_stage', text: txt.obj, sub: txt.sub, target: () => this.cartSpot(spot), priority: 1, progress: { have: idx + 1, need: 8 } });
          }, prev ? 900 : 0);
        }
      }
    } else if (step === 'customer') {
      const me = game.me;
      const holding = !!me && game.items.selected(me)?.k === 'dish';
      const key = holding ? 'serve' : 'pick';
      if (key !== this.custSub) {
        this.custSub = key;
        this.setObj({
          id: 'tut_serve', text: CUSTOMER.obj, sub: holding ? CUSTOMER.sub : CUSTOMER.subPick, priority: 0,
          target: holding ? () => this.entHead(g.introCust) : () => { const d = game.state.get(g.introDish); const p = d ? game.items.worldPos(d) : null; return p ? p.add(V(0, 0.2, 0)) : this.cartPos(); },
        });
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  frame(dt: number) {
    const game = this.game;
    const g: any = game.g;
    this.time += dt;
    if (g.scene !== 'world' || !game.scene) return;
    if (g.introStep !== this.step) {
      const prev = this.step;
      this.step = g.introStep;
      game.events.emit('intro:step', { step: g.introStep, prev });
      this.onStep(g.introStep, prev);
    }
    if (isIntroActive(g.introStep)) this.liveObjectives();
    // monologue (needs the old man / cart for context)
    const old = game.state.get(g.introOld);
    this.mono.frame(dt, g.introStep, { old: old?.p ? V(old.p[0], old.p[1], old.p[2]) : null, cart: this.cartPos(0), oldAsleep: old?.posture === 'floor' });
    // coins
    for (const f of this.flying) {
      f.t += dt;
      const k = clamp01(f.t / f.dur);
      if (f.t < 0) { f.m.visible = false; continue; }
      f.m.visible = true;
      const to = f.to();
      f.m.position.lerpVectors(f.from, to, ease(k));
      f.m.position.y += Math.sin(Math.PI * k) * 0.35;
      f.m.rotation.x += f.spin.x * dt; f.m.rotation.z += f.spin.z * dt;
      if (k >= 1 && !f.done) { f.done = true; f.m.removeFromParent(); play(['coin_on_table', 'coin_clink'], { pos: to, vol: 0.5, pitch: 0.9 + Math.random() * 0.3 }); }
    }
    this.flying = this.flying.filter((f) => !f.done);
    // faces / mouths back to normal
    const now = this.time;
    this.faceReset = this.faceReset.filter((r) => { if (now < r.at) return true; const rg = rigOf(game, r.id); rg?.setFace?.(null); return false; });
    for (const [id, until] of this.talking) if (now >= until) { rigOf(game, id)?.setTalking?.(false); this.talking.delete(id); }
    if (this.arrows && g.introStep === 'done' && now > this.arrowsUntil) this.removeArrows();
    if (g.introStep === 'done') this.tickDay(dt);
    // turn toward whoever you're facing in a scene
    if (this.nudge && game.player) {
      this.nudge.t += dt;
      const p = game.player;
      let d = this.nudge.to - p.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.yaw += d * Math.min(1, dt * 5);
      if (this.nudge.t > 1.2) this.nudge = null;
    }
    // hold Space to skip a cutscene camera (the scene itself keeps going)
    if (this.cine.active && !this.wakeOn) {
      this.skipHold = Input.isDown('Space') ? this.skipHold + dt : 0;
      if (this.skipHold > 0.8) { this.skipHold = 0; this.cine.skip(); }
    }
    this.tickTorch(dt);
  }

  private onStep(step: string | undefined, prev: string | undefined) {
    const game = this.game;
    this.stepObjectives(step, prev);
    if (step === 'go_market') this.makeArrows();
    if (step === 'done') {
      this.arrowsUntil = this.time + 60;
      if (prev && prev !== 'done') this.setupDay();
      if (this.wakeOn) this.endWake();
      this.cine.stop(0.5);
      this.clearObjectives();
      if (prev && prev !== 'done') setTimeout(() => this.setupDayObjectives(), 4000);
    }
    if (step === 'wake' && prev && prev !== 'wake' && game.player && !this.wakeOn) this.startWake();
    if (step === 'sneak' && this.wakeOn && this.wakeT > WAKE_T.end - 0.5) this.endWake();
    if (step === 'pay' || step === 'lesson') this.lookAtEnt((game.g as any).introOld);
  }

  // ------------------------------------------------------------------ wake-up (03:00): eyelids → crane → stretch → the cart

  private startWake() {
    const game = this.game;
    const me = game.me;
    const pl = game.player;
    if (!pl || !me) return;
    const a = anchor(game, 'wake_' + ((me.slot ?? 0) % 4));
    const gy = game.world?.groundY(a.p[0], a.p[2]) ?? a.p[1];
    pl.teleport([a.p[0], gy, a.p[2]], a.yaw ?? -Math.PI / 2);
    pl.pitch = 0;
    game.engine.post.fade = 1;
    this.wakeOn = true;
    this.wakeT = 0;
    const id = game.localPlayerId;
    const g: any = game.g;
    const post = game.engine.post;
    let cardShown = false;
    const pov: Shot = {
      dur: WAKE_T.up, ease: linear, noCollide: true, drift: 0, hideSelf: true,
      pose: (_k, t) => {
        // eyelids: two heavy blinks, then open
        const open = t < 1.0 ? 0 : t < 1.5 ? smooth(1.0, 1.5, t) * 0.55 : t < 1.8 ? 0.55 * (1 - smooth(1.5, 1.8, t)) : t < 2.4 ? smooth(1.8, 2.4, t) * 0.8 : t < 2.6 ? 0.8 - smooth(2.4, 2.6, t) * 0.5 : 0.3 + smooth(2.6, 3.3, t) * 0.7;
        post.fade = 1 - open;
        if (!cardShown && t > 0.35) { cardShown = true; this.card(WAKE.card, WAKE.cardSub, 3.0, true); play(['crickets', 'night_insects', 'dog_bark_far'], { vol: 0.4 }); }
        const p = game.player!;
        const f = V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const eye = V(p.pos.x, p.pos.y + 0.22, p.pos.z).addScaledVector(f, -0.55);
        const look = eye.clone().add(V(0, 1.6 - t * 0.12, 0)).addScaledVector(f, 1.2 + Math.sin(t * 0.7) * 0.2);
        return { p: eye, look, fov: 58, roll: 0.42 + Math.sin(t * 1.3) * 0.05 };
      },
      tick: (_k, t) => { const p: any = game.engine.post; p.setDOF?.(true, 0.35 + t * 0.5, 7); },
    };
    const shots: Shot[] = [
      pov,
      { dur: WAKE_T.stretch - WAKE_T.up, enter: () => { post.fade = 0; (post as any).setDOF?.(false); }, pose: crane(game, id, { h0: 5.2, h1: 1.9, r0: 0.4, r1: 2.6, az: 0.5, az1: 0.25, lookY: 0.45, fov: 52, fov1: 44 }), ease: easeOut },
      { dur: WAKE_T.look - WAKE_T.stretch, pose: orbit(game, id, { r: 2.5, h: 1.45, az0: 0.75, az1: 0.2, lookY: 1.1, fov: 40, fov1: 36 }), focus: () => subject(game, id)?.head ?? null },
      {
        dur: WAKE_T.end - WAKE_T.look, drift: 1.2,
        pose: (k) => (g.introOld && game.state.get(g.introOld) ? ots(game, id, g.introOld, { side: 1, back: 1.0, push: 0.45, fov: 44, fov1: 34, lift: 0.18 })(k) : fixed(V(), () => this.cartPos(1))(k)),
        focus: () => this.entHead(g.introOld) ?? this.cartPos(1),
      },
    ];
    this.cine.play('wake', shots, { handBack: 1.0, onEnd: () => this.endWake() });
  }

  private endWake() {
    const game = this.game;
    if (!this.wakeOn) return;
    this.wakeOn = false;
    game.engine.post.fade = 0;
    (game.engine.post as any).setDOF?.(false);
    if (this.cine.current === 'wake' && this.cine.active) this.cine.stop(0.9);
    const pl = game.player;
    if (pl) { pl.pitch = 0.05; if (pl.mode !== 'play' && !this.cine.active) pl.setMode('play'); }
    this.hang = 1;
  }

  // ------------------------------------------------------------------ cutscene beats → camera shots

  private onCine(d: any) {
    const game = this.game;
    if (!game.scene || game.g.scene !== 'world') return;
    if (d.k === 'wake') { if (!this.wakeOn && this.step !== 'sneak') this.startWake(); return; }
    if (d.k === 'stop') { if (this.wakeOn) this.endWake(); this.cine.stop(0.3); return; }
    const me = game.localPlayerId;
    const by: number = d.by ?? me;
    const old: number | null = d.old ?? (game.g as any).introOld ?? null;
    const focusOld = () => this.entHead(old);
    const focusBy = () => this.entHead(by);
    const hold = (pose: (k: number) => Pose | null, dur = 8, focus?: () => THREE.Vector3 | null): Shot => ({ dur, pose, focus, drift: 1.3 });
    const S: Record<string, () => Shot[] | null> = {
      // ---------------- caught
      c_squeak: () => {
        const c = game.state.all('cart')[0];
        const shots: Shot[] = [];
        if (c?.p && !d.woke) {
          const y = c.yaw ?? 0, cs = Math.cos(y), sn = Math.sin(y);
          const w = (lx: number, ly: number, lz: number) => V(c.p![0] + lx * cs + lz * sn, c.p![1] + ly, c.p![2] - lx * sn + lz * cs);
          shots.push({ dur: 1.3, pose: (k) => ({ p: w(1.15 - k * 0.15, 0.3, -1.25), look: w(0.28, 0.22, -0.36), fov: 34 - k * 4 }), noCollide: true, shake: 0.25 });
        }
        if (old != null) shots.push(hold(fixed(() => { const s = subject(game, old); return s ? s.pos.clone().addScaledVector(s.fwd, 2.4).add(V(0.6, 1.0, 0)) : V(); }, () => subject(game, old)?.head ?? null, 42), 4));
        return shots;
      },
      c_wake: () => old == null ? null : [
        { dur: 1.7, blend: 0.22, shake: 1.0, pose: closeUp(game, old, { toward: by, d0: 1.6, d1: 0.85, fov0: 40, fov1: 34 }), focus: focusOld },
        hold(twoShot(game, by, old, { side: 1, push: 0.3, fov: 46 }), 3),
      ],
      c_react: () => [
        { dur: 1.5, shake: 0.55, pose: closeUp(game, by, { toward: old, d0: 1.15, d1: 0.68, fov0: 38, fov1: 32 }), focus: focusBy },
        hold(old != null ? ots(game, old, by, { side: -1, push: 0.2, fov: 44 }) : closeUp(game, by), 4, focusBy),
      ],
      c_walk: () => old == null ? null : [
        { dur: 3.2, pose: ots(game, by, old, { side: 1, back: 1.0, push: 0.3, fov: 46, fov1: 40 }), focus: focusOld },
        hold(twoShot(game, by, old, { side: 1, push: 0.45, fov: 44, fov1: 40, arc: 0.25 }), 6),
      ],
      c_lecture: () => old == null ? null : [
        { dur: 7.2, ease: linear, pose: ots(game, by, old, { side: 1, back: 1.15, push: 0.6, fov: 44, fov1: 33, lift: 0.08 }), focus: focusOld },
        hold(closeUp(game, old, { toward: by, d0: 1.15, d1: 0.95, fov0: 36 }), 8, focusOld),
      ],
      c_excuse: () => old == null ? null : [hold(ots(game, old, by, { side: -1, push: 0.25, fov: 44, fov1: 38 }), 10, focusBy)],
      c_reply: () => old == null ? null : [
        { dur: 2.3, blend: 0.18, shake: 0.4, pose: closeUp(game, old, { toward: by, d0: 1.35, d1: 0.78, fov0: 38, fov1: 33 }), focus: focusOld },
        hold(twoShot(game, by, old, { side: -1, push: 0.25, fov: 44 }), 5),
      ],
      c_lecture2: () => old == null ? null : [hold(ots(game, by, old, { side: -1, back: 1.1, push: 0.45, fov: 42, fov1: 35 }), 6, focusOld)],
      c_soften: () => old == null ? null : [hold(twoShot(game, by, old, { side: -1, arc: 0.45, dist: 2.7, push: 0.35, fov: 40, fov1: 37 }), 8)],
      // ---------------- deal
      d_open: () => old == null ? null : [{ dur: 3.8, pose: twoShot(game, by, old, { side: 1, dist: 3.1, push: 0.5, fov: 42 }) }, hold(ots(game, by, old, { side: 1, fov: 42 }), 4, focusOld)],
      d_offer: () => old == null ? null : [
        { dur: 1.8, blend: 0.2, shake: 0.7, pose: closeUp(game, old, { toward: by, d0: 1.7, d1: 0.8, fov0: 40, fov1: 32 }), focus: focusOld },
        hold(closeUp(game, old, { toward: by, d0: 0.8, d1: 0.72, fov0: 32 }), 5, focusOld),
      ],
      d_haggle: () => old == null ? null : [hold(ots(game, old, by, { side: -1, push: 0.15, fov: 44, fov1: 40 }), 10, focusBy)],
      d_reply: () => old == null ? null : [{ dur: 1.6, blend: 0.18, shake: 0.25, pose: ots(game, by, old, { side: 1, push: 0.3, fov: 42, fov1: 37 }), focus: focusOld }, hold(twoShot(game, by, old, { side: 1, fov: 44 }), 5)],
      d_nag: () => old == null ? null : [hold(closeUp(game, old, { toward: by, d0: 2.3, d1: 0.95, fov0: 42, fov1: 35, side: 0.3 }), 10.5, focusOld)],
      d_final: () => old == null ? null : [hold(twoShot(game, by, old, { side: 1, push: 0.7, fov: 42, fov1: 36 }), 6)],
      d_shake: () => old == null ? null : [
        { dur: 1.6, pose: twoShot(game, by, old, { side: 1, dist: 1.7, height: -0.7, push: 0.2, fov: 42 }), drift: 0.6 },
        { dur: 2.2, ease: linear, pose: twoShot(game, by, old, { side: 1, dist: 1.5, height: -0.55, arc: 0.6, push: 0.15, fov: 38 }), shake: 0.3 },
        { dur: 1.6, pose: twoShot(game, by, old, { side: -1, dist: 2.4, push: 0.4, fov: 40 }) },
      ],
      // ---------------- lesson
      lesson: () => old == null ? null : [
        { dur: 4.4, blend: 0.6, pose: orbit(game, old, { r: 2.4, h: 1.55, az0: -0.7, az1: -0.2, lookY: 1.25, fov: 44, fov1: 40 }), focus: focusOld },
        { dur: 4.2, pose: closeUp(game, old, { d0: 1.5, d1: 1.05, side: -0.25, fov0: 38 }), focus: focusOld },
      ],
      taste: () => old == null ? null : [
        { dur: 2.8, blend: 0.5, pose: closeUp(game, old, { d0: 1.7, d1: 1.0, side: 0.3, fov0: 40, fov1: 36, lookDown: 0.1 }), focus: focusOld },
        { dur: 4.4, shake: d.verdict === 'good' ? 0.6 : 0.3, pose: closeUp(game, old, { d0: 0.85, d1: 0.72, side: -0.2, fov0: 34 }), focus: focusOld },
        { dur: 2.8, pose: twoShot(game, me, old, { side: 1, push: 0.3, fov: 44 }) },
      ],
      // ---------------- first customer
      cu_see: () => d.cust == null ? null : [
        { dur: 5.0, blend: 0.6, pose: old != null ? ots(game, old, d.cust, { side: 1, back: 1.1, fov: 44, fov1: 38 }) : orbit(game, d.cust, {}), focus: () => this.entHead(d.cust) },
        { dur: 4.2, pose: track(game, d.cust, { side: 1.5, back: -2.6, h: 1.2, lookY: 1.2, lead: 0, fov: 40 }) },
      ],
      cu_eat: () => d.cust == null ? null : [
        { dur: 1.3, pose: twoShot(game, by, d.cust, { side: 1, fov: 44 }) },
        { dur: 3.1, pose: closeUp(game, d.cust, { d0: 1.3, d1: 0.85, side: 0.25, fov0: 38, lookDown: 0.08 }), focus: () => this.entHead(d.cust) },
        { dur: 3.8, shake: d.verdict === 'good' ? 0.7 : 0.3, pose: closeUp(game, d.cust, { d0: 0.75, d1: 0.62, side: -0.2, fov0: 33 }), focus: () => this.entHead(d.cust) },
        hold(twoShot(game, by, d.cust, { side: -1, push: 0.2, fov: 44 }), 5),
      ],
      cu_paid: () => [
        { dur: 2.6, pose: closeUp(game, by, { toward: d.cust, d0: 1.1, d1: 0.85, fov0: 36 }), focus: focusBy },
        ...(old != null ? [{ dur: 5.0, pose: twoShot(game, by, old, { side: 1, push: 0.4, fov: 42 }) } as Shot, { dur: 4.8, pose: ots(game, by, old, { side: 1, push: 0.3, fov: 40 }), focus: focusOld } as Shot] : []),
      ],
      // ---------------- the dog
      dog_run: () => d.dog == null ? null : [
        { dur: 2.6, blend: 0.3, shake: 0.3, pose: track(game, d.dog, { side: 1.2, back: 1.8, h: 0.5, lookY: 0.35, fov: 52 }) },
        hold(this.nearPose(d.dog, 0.45, 3.2, 2.4, 0.6, 46), 3.5),
      ],
      dog_eat: () => d.dog == null ? null : [
        { dur: 1.6, blend: 0.15, shake: 0.85, pose: this.nearPose(d.dog, 0.4, 1.5, 0.85, 0.35, 40) },
        { dur: 1.6, blend: 0.18, shake: 0.7, pose: closeUp(game, me, { toward: d.dog, d0: 0.95, d1: 0.66, fov0: 36 }), focus: () => this.entHead(me) },
        { dur: 2.2, pose: this.nearPose(d.dog, 0.4, 1.9, 1.5, -0.4, 42) },
        hold(this.nearPose(d.dog, 0.4, 3.4, 3.0, 0.9, 46), 4),
      ],
      dog_laugh: () => old == null ? null : [
        { dur: 2.2, blend: 0.25, shake: 0.35, pose: closeUp(game, old, { toward: by, d0: 1.4, d1: 0.9, fov0: 38 }), focus: focusOld },
        { dur: 3.2, pose: twoShot(game, by, old, { side: -1, arc: 0.4, push: 0.3, fov: 44 }) },
      ],
      market: () => old == null ? null : [
        { dur: 3.0, pose: ots(game, me, old, { side: 1, push: 0.25, fov: 44 }), focus: focusOld },
        { dur: 3.4, ease: easeOut, pose: (k) => { const s = subject(game, old); if (!s) return null; const a = anchor(game, 'auntie_stall').p; const look = V(a[0], 1.2, a[2]); return { p: s.pos.clone().add(V(0, 2.2 + k * 3.2, 0)).addScaledVector(s.fwd, -1.2 - k * 1.5), look, fov: 50 - k * 6 }; } },
      ],
    };
    const make = S[d.k];
    if (!make) return;
    let shots: Shot[] | null = null;
    try { shots = make(); } catch (e) { console.warn('[intro] cine', d.k, e); }
    if (!shots || !shots.length) return;
    if (this.wakeOn) this.endWake();
    if (by === me && old != null && (d.k === 'c_walk' || d.k === 'd_open' || d.k === 'd_shake')) this.lookAtEnt(old);
    this.cine.play(d.k, shots, { handBack: 0.8 });
  }

  /** camera near an animal / small subject: look at its body (y), distance d0→d1, side offset */
  private nearPose(id: number, y: number, d0: number, d1: number, side: number, fov: number) {
    const game = this.game;
    return (k: number): Pose | null => {
      const s = subject(game, id);
      if (!s) return null;
      const look = s.pos.clone().add(V(0, y, 0));
      const cam = this.game.camera.getWorldPosition(V());
      const dir = cam.sub(look).setY(0);
      if (dir.lengthSq() < 1e-4) dir.copy(s.fwd);
      dir.normalize().applyAxisAngle(V(0, 1, 0), side * 0.4);
      const dd = THREE.MathUtils.lerp(d0, d1, k);
      return { p: look.clone().addScaledVector(dir, dd).add(V(0, 0.35 + dd * 0.18, 0)), look, fov };
    };
  }

  // ------------------------------------------------------------------ late (camera)

  private late(raw: number) {
    const game = this.game;
    const pl = game.player;
    if (!pl || !game.scene || game.g.scene !== 'world') return;
    if (this.wakeOn) this.wakeT += Math.min(raw, 0.1);
    this.cine.late(raw);
    // safety: if something else grabbed the camera mid-wake, never leave the screen black
    if (this.wakeOn && !this.cine.active && this.wakeT > 0.3) this.endWake();
    if (this.cine.active) return;
    // hangover wobble after getting up
    const post = game.engine.post;
    const cam = pl.camera as THREE.PerspectiveCamera;
    if (this.hang > 0.001 && pl.mode === 'play') {
      this.hang = Math.max(0, this.hang - raw / 24);
      const k = this.hang;
      cam.rotation.z += Math.sin(this.time * 1.1) * 0.035 * k;
      cam.position.y += Math.sin(this.time * 0.7) * 0.02 * k;
      cam.position.x += Math.sin(this.time * 0.43) * 0.016 * k;
      if (k < 0.75 && k + raw / 24 >= 0.75) post.setDOF(false);
    }
  }

  // ------------------------------------------------------------------ expressions, mouths, flashlight, title card

  private expr(id: number, e: string, hold?: number) {
    const r = rigOf(this.game, id);
    if (!r) return;
    if (typeof r.setExpression === 'function') { try { r.setExpression(e, { hold, fade: 0.22 }); } catch { /* */ } return; }
    const f = FACE_FALLBACK[e];
    r.setFace?.(f ?? null);
    if (hold) this.faceReset.push({ id, at: this.time + hold });
  }

  private talk(id: number, sec: number) {
    const r = rigOf(this.game, id);
    if (!r?.setTalking) return;
    r.setTalking(true);
    this.talking.set(id, this.time + Math.max(0.6, sec));
  }

  private setTorch(d: { on: boolean; by?: number; old?: number }) {
    const game = this.game;
    if (!game.scene) return;
    if (!this.torch && d.on) {
      const geo = new THREE.CylinderGeometry(0.025, 0.55, 1, 22, 1, true).translate(0, -0.5, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const cone = new THREE.Mesh(geo, mat);
      cone.renderOrder = 5;
      cone.frustumCulled = false;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfffbe8, fog: false }));
      game.scene.add(cone, lens);
      const W: any = game.world;
      const light = W?.addLightPoint ? W.addLightPoint(V(), 0xfff1d6, 0, 7, 0) : null;
      if (light) light.prio = 4;
      this.torch = { cone, lens, light, by: d.by ?? -1, old: d.old ?? -1, on: false, k: 0 };
    }
    if (!this.torch) return;
    this.torch.on = d.on;
    if (d.by != null) this.torch.by = d.by;
    if (d.old != null) this.torch.old = d.old;
    if (d.on) play(['flashlight_click', 'switch_click', 'click'], { vol: 0.7 });
  }

  private tickTorch(dt: number) {
    const t = this.torch;
    if (!t) return;
    const game = this.game;
    t.k = THREE.MathUtils.clamp(t.k + (t.on ? dt * 6 : -dt * 3), 0, 1);
    const vis = t.k > 0.01 && !!game.state.get(t.old);
    t.cone.visible = vis; t.lens.visible = vis;
    if (t.light) t.light.intensity = vis ? 16 * t.k : 0;
    if (!vis) return;
    const r = rigOf(game, t.old);
    const hand = r?.attach ? r.attach('hand_r').getWorldPosition(V()) : (headOf(game, t.old, V())?.add(V(0, -0.55, 0)) ?? V());
    const target = headOf(game, t.by, V())?.add(V(0, -0.3, 0)) ?? hand.clone().add(V(0, -0.5, 1.5));
    // a little handheld wobble
    target.x += Math.sin(this.time * 2.3) * 0.06; target.y += Math.sin(this.time * 1.7) * 0.05;
    const dir = target.clone().sub(hand);
    const len = Math.min(6, Math.max(0.3, dir.length()));
    dir.normalize();
    t.cone.position.copy(hand);
    t.cone.quaternion.setFromUnitVectors(V(0, -1, 0), dir);
    t.cone.scale.set(0.35 + len * 0.18, len * 1.15, 0.35 + len * 0.18);
    (t.cone.material as THREE.MeshBasicMaterial).opacity = 0.085 * t.k;
    t.lens.position.copy(hand);
    if (t.light) t.light.p.copy(target).addScaledVector(dir, -0.35);
  }

  /** Big cinematic title card (DOM, centre of the screen). */
  private card(title: TL, sub?: TL, sec = 2.6, soft = false) {
    if (!this.cardEl) {
      const st = document.createElement('style');
      st.textContent = `
        .hp-tcard{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:12;pointer-events:none;text-align:center;opacity:0}
        .hp-tcard b{display:block;font:800 clamp(56px,9vw,132px)/1 ${F.heavy},sans-serif;color:#fff6dc;letter-spacing:.02em;
          text-shadow:0 6px 0 #7a1d12,0 10px 30px rgba(0,0,0,.65);-webkit-text-stroke:2px #2a0d08;paint-order:stroke fill}
        .hp-tcard i{display:block;font-style:normal;font:600 clamp(14px,1.5vw,20px)/1.4 ${F.ui},sans-serif;color:#f1e4c8;margin-top:12px;text-shadow:0 2px 6px #000}
        .hp-tcard small{display:block;font:500 clamp(11px,1.1vw,15px) ${F.body},sans-serif;color:#d8cbb0;opacity:.85;margin-top:2px}
        .hp-tcard.slam{animation:hpSlam var(--d,2.6s) cubic-bezier(.2,1.4,.4,1) forwards}
        .hp-tcard.soft{animation:hpSoft var(--d,3s) ease forwards}
        .hp-tcard.soft b{font-size:clamp(30px,4.2vw,62px);text-shadow:0 3px 18px rgba(0,0,0,.8);-webkit-text-stroke:0;color:#f4ead2}
        @keyframes hpSlam{0%{opacity:0;transform:translate(-50%,-50%) scale(2.4) rotate(-6deg)}12%{opacity:1;transform:translate(-50%,-50%) scale(.94) rotate(-2deg)}
          20%{transform:translate(-50%,-50%) scale(1.04) rotate(-3deg)}82%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(-3deg)}100%{opacity:0;transform:translate(-50%,-60%) scale(1.02) rotate(-3deg)}}
        @keyframes hpSoft{0%{opacity:0;letter-spacing:.3em}25%{opacity:1;letter-spacing:.04em}80%{opacity:1}100%{opacity:0}}`;
      document.head.appendChild(st);
      this.cardEl = document.createElement('div');
      document.body.appendChild(this.cardEl);
    }
    const el = this.cardEl;
    el.className = 'hp-tcard';
    el.innerHTML = `<b>${esc(title.th)}</b>${title.en ? `<i>${esc(title.en)}</i>` : ''}${sub ? `<small>${esc(sub.th)}${sub.en ? ' · ' + esc(sub.en) : ''}</small>` : ''}`;
    el.style.setProperty('--d', sec + 's');
    void el.offsetWidth;
    el.classList.add(soft ? 'soft' : 'slam');
    if (!soft) { play(['impact_boom', 'bass_boom', 'whoosh_swing'], { vol: 0.6 }); this.cine.shake(0.6); }
  }

  // ------------------------------------------------------------------ choices (excuses / haggling)

  private choose(d: { to: number; kind: string; prompt: TL; options: TL[]; sec: number }) {
    const game = this.game;
    const me = game.localPlayerId;
    const culpritHere = !!game.state.get(d.to);
    if (d.to !== me && culpritHere) return;
    game.ui.choose({ prompt: d.prompt, options: d.options, seconds: d.sec, colors: [0x9fd8ff, 0xffe28a, 0xff8a7a], onPick: (i) => game.intent('intro.pick', { kind: d.kind, i }) });
  }

  // ------------------------------------------------------------------ thoughts & bubbles

  think(id: number, text: TL, sec = 3.4) {
    const game = this.game;
    if (!game.scene) return;
    if (id === game.localPlayerId) {
      const h = hud(game);
      if (h) { h.monologue(text, sec); return; }
      if (game.player?.firstPerson) {
        const cam = game.camera;
        const v = V();
        game.ui.think(() => {
          cam.getWorldPosition(v);
          const f = V(0, 0, -1).applyQuaternion(cam.quaternion);
          const u = V(0, 1, 0).applyQuaternion(cam.quaternion);
          const r = V(1, 0, 0).applyQuaternion(cam.quaternion);
          return v.addScaledVector(f, 1.55).addScaledVector(u, 0.36).addScaledVector(r, -0.42);
        }, text, { duration: sec, scale: 0.62 } as any);
        return;
      }
    }
    const tmp = V();
    game.ui.think(() => headOf(game, id, tmp)?.add(V(0, 0.25, 0)) ?? null, text, { duration: sec });
  }

  private subtitle(d: { id: number; text: string | TL; o?: any }) {
    if (!this.cine.active || d.o?.style === 'thought' || !isIntroActive((this.game.g as any).introStep)) return;
    const t: TL = typeof d.text === 'string' ? { th: d.text } : d.text;
    if (!t?.th || (d.o?.duration ?? 3) > 60) return;
    const e = this.game.state.get(d.id);
    const nm = e?.name ? (typeof e.name === 'string' ? e.name : e.name.th) : '';
    Overlay.subtitle(nm ? `${nm}: ${t.th}` : t.th, t.en, Math.min(6, Math.max(2.2, (d.o?.duration ?? 3) + 0.6)));
  }

  private shock(sec: number) {
    for (const pl of this.game.players()) this.expr(pl.id, 'shocked', sec);
    play(['gasp'], { vol: 0.7 });
  }

  private lookAtEnt(id: number | null | undefined) {
    const game = this.game;
    const e = id != null ? game.state.get(id) : null;
    const p = game.player;
    if (!e?.p || !p) return;
    this.nudge = { to: Math.atan2(-(e.p[0] - p.pos.x), -(e.p[2] - p.pos.z)), t: 0 };
  }

  // ------------------------------------------------------------------ coins into the old man's hand

  private handPos(id: number): THREE.Vector3 {
    const game = this.game;
    if (id === game.localPlayerId && game.player?.firstPerson) {
      const cam = game.camera;
      const v = cam.getWorldPosition(V());
      return v.add(V(0.16, -0.28, -0.45).applyQuaternion(cam.quaternion));
    }
    const r = rigOf(game, id);
    if (r?.attach) return r.attach('hand_r').getWorldPosition(V());
    const e = game.state.get(id);
    return e?.p ? V(e.p[0], e.p[1] + 1.0, e.p[2]) : V();
  }

  private coins(from: number, to: number, n: number) {
    const game = this.game;
    if (!game.scene) return;
    play(['coins_handful'], { pos: this.handPos(from), vol: 0.8 });
    for (let i = 0; i < n; i++) {
      const m = makeCoin(1.4);
      const start = this.handPos(from).add(V((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06));
      m.position.copy(start);
      game.scene.add(m);
      this.flying.push({ m, from: start, to: () => this.handPos(to).add(V(0, 0.02 + i * 0.003, 0)), t: -0.55 - i * 0.13, dur: 0.6, spin: V(14 + Math.random() * 10, 0, 6) });
    }
  }

  // ------------------------------------------------------------------ chalk arrows towards auntie's stall

  private makeArrows() {
    const game = this.game;
    if (this.arrows || !game.scene) return;
    const from = V(...(anchor(game, 'cart_start').p as [number, number, number]));
    const to = V(...(anchor(game, 'auntie_stall').p as [number, number, number]));
    let path: THREE.Vector3[] = [];
    try { path = game.world?.nav?.path(from, to, { avoidRoads: false }) ?? []; } catch { /* no nav */ }
    path = [from, ...path];
    if (path.length < 2 || path[path.length - 1].distanceTo(to) > 1) path.push(to);
    const g = new THREE.Group();
    g.name = 'intro-chalk-arrows';
    const mat = new THREE.MeshStandardMaterial({ map: tex('chalk_arrow.png', { wrap: false }), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4 });
    const geo = new THREE.PlaneGeometry(1.0, 0.35).rotateX(-Math.PI / 2);
    let next = 1.2;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const d = b.clone().sub(a); d.y = 0;
      const L = d.length();
      if (L < 0.01) continue;
      d.normalize();
      let s = next;
      for (; s < L; s += 3.6) {
        const p = a.clone().addScaledVector(d, s);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.x, (game.world?.groundY(p.x, p.z) ?? p.y) + 0.012, p.z);
        m.rotation.y = Math.atan2(-d.z, d.x) + (Math.random() - 0.5) * 0.12;
        m.receiveShadow = true;
        g.add(m);
      }
      next = s - L;
    }
    game.scene.add(g);
    this.arrows = g;
  }

  private removeArrows() {
    if (!this.arrows) return;
    this.arrows.removeFromParent();
    this.arrows.traverse((o: any) => o.geometry?.dispose?.());
    this.arrows = null;
  }

  // ------------------------------------------------------------------ interactions

  private provide(ctx: Ctx): Action[] | null {
    const game = this.game;
    const g: any = game.g;
    const step = g.introStep;
    if (!isIntroActive(step) || step === 'casino') return null;
    const acts: Action[] = [];
    const hit = ctx.hit;
    const cart = game.state.all('cart')[0];
    if (cart && cart.owner === 'oldman' && hit && (step === 'wake' || step === 'sneak')) {
      const onCart = hit.ent?.id === cart.id || hit.kind === 'cart' || (hit.ent?.t === 'item' && hit.ent.in === cart.id) || (cart.p && dist2D([hit.point.x, 0, hit.point.z], cart.p) < 1.25 && hit.kind !== 'npc' && hit.kind !== 'player');
      if (onCart) {
        acts.push({ key: 'E', label: CART_LABEL.push, priority: 2000, run: () => game.intent('intro.tryCart', {}) });
        acts.push({ key: 'LMB', label: tl('ใช้', 'use'), priority: 2000, disabled: CART_LABEL.notYours });
        acts.push({ key: 'F', label: tl('หยิบ', 'take'), priority: 2000, disabled: CART_LABEL.notYours });
      }
    }
    if (step === 'pay') {
      const old = game.state.get(g.introOld);
      if (old?.p && ctx.me?.p) {
        const aimed = hit?.eid === old.id || (dist2D(old.p, ctx.me.p) < 2.6 && this.inView(old));
        if (aimed) {
          const w = Math.round(ctx.me.wallet ?? 0);
          acts.push(w > 0
            ? { key: 'E', label: tl(`${CART_LABEL.give.th} ${w} ฿`, `${CART_LABEL.give.en} (${w} ฿)`), priority: 2000, run: () => game.intent('intro.pay', {}) }
            : { key: 'E', label: CART_LABEL.give, priority: 2000, disabled: tl('ให้หมดแล้ว', 'already paid') });
        }
      }
    }
    if (step === 'customer') {
      const cu = game.state.get(g.introCust);
      const held = ctx.held;
      if (cu?.p && ctx.me?.p) {
        const aimed = hit?.eid === cu.id || (dist2D(cu.p, ctx.me.p) < 2.8 && this.inView(cu));
        if (aimed) {
          acts.push(held?.k === 'dish'
            ? { key: 'E', label: CUSTOMER.serveLabel, priority: 2000, run: () => game.intent('intro.serve', { item: held.id }) }
            : { key: 'E', label: CUSTOMER.serveLabel, priority: 2000, disabled: tl('ถือจานกะเพราก่อน', 'hold the plate first') });
        }
      }
    }
    return acts;
  }

  private inView(e: Ent) {
    const cam = this.game.camera;
    const p = V(e.p![0], e.p![1] + 1.2, e.p![2]);
    const c = cam.getWorldPosition(V());
    const f = V(0, 0, -1).applyQuaternion(cam.quaternion);
    return p.sub(c).normalize().dot(f) > 0.9;
  }

  // ------------------------------------------------------------------ first day (after the intro): HUD objectives

  private setupDay() {
    this.dayT = 0;
    this.walletSeen = this.game.me?.wallet ?? 0;
    this.earned = false;
  }

  private setupDayObjectives() {
    const game = this.game;
    if ((game.g as any).introStep !== 'done') return;
    const holding = (k: string) => { const me = game.me; return !!me && game.items.carried(me).some((e) => e.k === k); };
    const sign = () => { const s = game.state.all('item').find((e) => e.k === 'shop_sign'); const p = s ? game.items.worldPos(s) : null; return p ? p.add(V(0, 0.6, 0)) : this.cartPos(); };
    this.day = [
      { id: 'day_book', o: { id: 'day_book', text: HINTS.book, target: () => this.cartSpot('book'), priority: 5 }, done: () => this.bookOpened || holding('recipe_book') },
      { id: 'day_sign', o: { id: 'day_sign', text: HINTS.sign, sub: HINTS.signSub, target: sign, priority: 5 }, done: () => !!(game.g as any).shopOpen },
      { id: 'day_serve', o: { id: 'day_serve', text: HINTS.serve, sub: HINTS.serveSub, priority: 5 }, done: () => this.earned },
    ];
    this.showDay();
  }

  private showDay() { const d = this.day[0]; if (d) this.setObj(d.o); }

  private tickDay(dt: number) {
    if (!this.day.length) return;
    this.dayT += dt;
    const me = this.game.me;
    if (me) { if ((me.wallet ?? 0) > this.walletSeen) this.earned = true; this.walletSeen = me.wallet ?? 0; }
    const d = this.day[0];
    // the book step is optional: it times out after a while
    const expired = d.id === 'day_book' && this.dayT > 90;
    if (d.done() || expired) {
      this.clearObj(d.id, !expired);
      this.day.shift();
      this.dayT = 0;
      setTimeout(() => this.showDay(), 1200);
    }
  }
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
