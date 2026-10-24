import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { tl, TL, dist2D } from '../../core/util';
import { Overlay } from '../../ui3d/overlay';
import { CART_LABEL, CASINO, HINTS } from './lines';
import { anchor, clamp01, ease, headOf, play, rigOf, smooth, tex } from './util';
import { isIntroActive } from './steps';
import { makeCoin } from './casino-fx';

/* ============================================================================================
 * Every peer: local presentation of the world intro (driven by g.introStep + one-shot events).
 *  - wake-up: lying on the sidewalk POV, blinking eyes, blurry DOF, getting up, hangover wobble
 *  - thought clouds (yours float in front of your eyes, friends' above their heads)
 *  - coins visibly flying from your hand into the old man's, shocked faces, the chalk arrows
 *  - interaction overrides (push the old man's cart → caught; [E] give coins)
 *  - light tutorial thoughts after the intro (recipe book, cook, open the sign, serve)
 * ========================================================================================== */

interface Flying { m: THREE.Mesh; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; spin: THREE.Vector3; done?: boolean }

export class IntroLocal {
  private step: string | undefined;
  private wakeT = -1;
  private hang = 0;
  private time = 0;
  private flying: Flying[] = [];
  private arrows: THREE.Group | null = null;
  private arrowsUntil = 0;
  private nudge: { to: number; t: number } | null = null;
  private hints: { id: string; text: TL; done: () => boolean; at: number; shown: number }[] = [];
  private hintT = 0;
  private bookOpened = false;
  private walletSeen = -1;
  private earned = false;
  private faceReset: { id: number; at: number }[] = [];
  private morningShown = false;

  constructor(private game: Game) {
    game.events.on('world:ready', () => this.onWorld());
    game.events.on('world:exit', () => this.onExit());
    game.on('intro:think', (d: { id: number; text: TL }) => this.think(d.id, d.text));
    game.on('intro:coins', (d: { from: number; to: number; n: number }) => this.coins(d.from, d.to, d.n));
    game.on('intro:shock', (d: { sec: number }) => this.shock(d.sec ?? 3));
    game.on('intro:caught', (d: { by: number; old: number }) => { if (d.by === game.localPlayerId) this.lookAtEnt(d.old); });
    game.events.on('cook:openBook', () => { this.bookOpened = true; });
    game.engine.onLate((f) => this.late(f.rawDt));
    game.interact.provide((ctx) => this.provide(ctx), 50);
  }

  // ------------------------------------------------------------------ scene hooks

  private onWorld() {
    const g = this.game.g;
    this.step = undefined;
    if (g.introStep === 'wake' || (!g.introStep && !this.skipping())) this.startWake();
  }

  private skipping() { return new URLSearchParams(location.search).has('skipintro') || new URLSearchParams(location.search).has('intro'); }

  private onExit() {
    this.wakeT = -1;
    this.hang = 0;
    this.removeArrows();
    for (const f of this.flying) f.m.removeFromParent();
    this.flying = [];
  }

  private startWake() {
    const game = this.game;
    const me = game.me;
    const pl = game.player;
    if (!pl || !me) return;
    const a = anchor(game, 'wake_' + ((me.slot ?? 0) % 4));
    const gy = game.world?.groundY(a.p[0], a.p[2]) ?? a.p[1];
    pl.teleport([a.p[0], gy, a.p[2]], a.yaw ?? -Math.PI / 2);
    pl.pitch = 0;
    pl.setMode('frozen');
    game.engine.post.fade = 1;
    this.wakeT = 0;
    this.morningShown = false;
  }

  // ------------------------------------------------------------------ per frame

  frame(dt: number) {
    const game = this.game;
    const g = game.g;
    this.time += dt;
    if (g.scene !== 'world' || !game.scene) return;
    if (g.introStep !== this.step) {
      const prev = this.step;
      this.step = g.introStep;
      game.events.emit('intro:step', { step: g.introStep, prev });
      this.onStep(g.introStep, prev);
    }
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
    // faces back to normal
    const now = this.time;
    this.faceReset = this.faceReset.filter((r) => { if (now < r.at) return true; rigOf(game, r.id)?.setFace?.(null); return false; });
    // chalk arrows live during go_market and a minute after
    if (this.arrows && g.introStep === 'done' && now > this.arrowsUntil) this.removeArrows();
    // tutorial thoughts
    if (g.introStep === 'done') this.tickHints(dt);
    // turn toward whoever caught you
    if (this.nudge && game.player) {
      this.nudge.t += dt;
      const p = game.player;
      let d = this.nudge.to - p.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.yaw += d * Math.min(1, dt * 5);
      if (this.nudge.t > 0.9) this.nudge = null;
    }
  }

  private onStep(step: string | undefined, prev: string | undefined) {
    const game = this.game;
    if (step === 'go_market') this.makeArrows();
    if (step === 'done') {
      this.arrowsUntil = this.time + 60;
      if (prev && prev !== 'done') this.setupHints();
      if (this.wakeT >= 0) this.endWake();
    }
    if (step === 'wake' && prev && prev !== 'wake' && game.player && this.wakeT < 0) this.startWake();
  }

  // ------------------------------------------------------------------ wake-up POV

  private late(raw: number) {
    const game = this.game;
    const pl = game.player;
    if (!pl || !game.scene || game.g.scene !== 'world') return;
    const post = game.engine.post;
    const cam = pl.camera as THREE.PerspectiveCamera;
    if (this.wakeT >= 0) {
      this.wakeT += Math.min(raw, 0.1);
      const t = this.wakeT;
      if (t > 0.3 && !this.morningShown) { this.morningShown = true; Overlay.subtitle(CASINO.morning.th, CASINO.morning.en, 2.8); play(['rooster'], { vol: 0.6 }); }
      // eyelids: two heavy blinks, then open
      const open = t < 1.0 ? 0 : t < 1.5 ? smooth(1.0, 1.5, t) * 0.55 : t < 1.8 ? 0.55 * (1 - smooth(1.5, 1.8, t)) : t < 2.4 ? smooth(1.8, 2.4, t) * 0.8 : t < 2.6 ? 0.8 - smooth(2.4, 2.6, t) * 0.5 : 0.3 + smooth(2.6, 3.4, t) * 0.7;
      post.fade = 1 - open;
      const up = smooth(3.6, 5.6, t), stand = smooth(5.6, 7.0, t);
      const eye = 1.6 * ((game.me?.look?.height ?? 1.72) / 1.72);
      const h = 0.2 + up * 0.75 + stand * (eye - 0.95);
      const pitch = 1.15 * (1 - up) + 0.12 * up * (1 - stand);
      const roll = 0.45 * (1 - up) + 0.12 * up * (1 - stand) + Math.sin(t * 1.3) * 0.05;
      const yaw = pl.yaw + Math.sin(t * 0.6) * 0.25 * (1 - stand);
      cam.position.set(pl.pos.x, pl.pos.y + h, pl.pos.z);
      cam.rotation.set(pitch, yaw, roll, 'YXZ');
      post.setDOF(true, 0.35 + stand * 3, 7 - stand * 4);
      if (t > 3.9 && t - Math.min(raw, 0.1) <= 3.9) play(['yawn', 'cough'], { vol: 0.6 });
      if (t >= 7.1) this.endWake();
      return;
    }
    // hangover wobble after getting up
    if (this.hang > 0.001 && pl.mode === 'play') {
      this.hang = Math.max(0, this.hang - raw / 28);
      const k = this.hang;
      cam.rotation.z += Math.sin(this.time * 1.1) * 0.04 * k;
      cam.position.y += Math.sin(this.time * 0.7) * 0.025 * k;
      cam.position.x += Math.sin(this.time * 0.43) * 0.02 * k;
      if (k < 0.75 && k + raw / 28 >= 0.75) post.setDOF(false);
      else if (k >= 0.75) post.setDOF(true, 3.5, (k - 0.75) * 8);
    }
  }

  private endWake() {
    const game = this.game;
    const pl = game.player;
    this.wakeT = -1;
    game.engine.post.fade = 0;
    if (pl) { pl.pitch = 0.05; pl.setMode('play'); }
    this.hang = 1;
  }

  // ------------------------------------------------------------------ thoughts & bubbles

  think(id: number, text: TL, sec = 3.4) {
    const game = this.game;
    if (!game.scene) return;
    if (id === game.localPlayerId && game.player?.firstPerson) {
      const cam = game.camera;
      const v = new THREE.Vector3();
      game.ui.think(() => {
        cam.getWorldPosition(v);
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        return v.addScaledVector(f, 1.55).addScaledVector(u, 0.36).addScaledVector(r, -0.42);
      }, text, { duration: sec, scale: 0.62 });
    } else {
      const tmp = new THREE.Vector3();
      game.ui.think(() => headOf(game, id, tmp)?.add(new THREE.Vector3(0, 0.25, 0)) ?? null, text, { duration: sec });
    }
  }

  private shock(sec: number) {
    const game = this.game;
    for (const pl of game.players()) {
      rigOf(game, pl.id)?.setFace?.('shock');
      this.faceReset.push({ id: pl.id, at: this.time + sec });
    }
    play(['gasp'], { vol: 0.7 });
  }

  private lookAtEnt(id: number) {
    const game = this.game;
    const e = game.state.get(id);
    const p = game.player;
    if (!e?.p || !p) return;
    this.nudge = { to: Math.atan2(-(e.p[0] - p.pos.x), -(e.p[2] - p.pos.z)), t: 0 };
  }

  // ------------------------------------------------------------------ coins into the old man's hand

  private handPos(id: number): THREE.Vector3 {
    const game = this.game;
    if (id === game.localPlayerId && game.player?.firstPerson) {
      const cam = game.camera;
      const v = cam.getWorldPosition(new THREE.Vector3());
      return v.add(new THREE.Vector3(0.16, -0.28, -0.45).applyQuaternion(cam.quaternion));
    }
    const r = rigOf(game, id);
    if (r?.attach) return r.attach('hand_r').getWorldPosition(new THREE.Vector3());
    const e = game.state.get(id);
    return e?.p ? new THREE.Vector3(e.p[0], e.p[1] + 1.0, e.p[2]) : new THREE.Vector3();
  }

  private coins(from: number, to: number, n: number) {
    const game = this.game;
    if (!game.scene) return;
    play(['coins_handful'], { pos: this.handPos(from), vol: 0.8 });
    for (let i = 0; i < n; i++) {
      const m = makeCoin(1.4);
      const start = this.handPos(from).add(new THREE.Vector3((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06));
      m.position.copy(start);
      game.scene.add(m);
      this.flying.push({ m, from: start, to: () => this.handPos(to).add(new THREE.Vector3(0, 0.02 + i * 0.003, 0)), t: -0.55 - i * 0.13, dur: 0.6, spin: new THREE.Vector3(14 + Math.random() * 10, 0, 6) });
    }
  }

  // ------------------------------------------------------------------ chalk arrows towards auntie's stall

  private makeArrows() {
    const game = this.game;
    if (this.arrows || !game.scene) return;
    const from = new THREE.Vector3(...(anchor(game, 'cart_start').p as [number, number, number]));
    const to = new THREE.Vector3(...(anchor(game, 'auntie_stall').p as [number, number, number]));
    let path: THREE.Vector3[] = [];
    try { path = game.world?.nav?.path(from, to, { avoidRoads: false }) ?? []; } catch {}
    path = [from, ...path];
    if (path.length < 2 || path[path.length - 1].distanceTo(to) > 1) path.push(to);
    const g = new THREE.Group();
    g.name = 'intro-chalk-arrows';
    const mat = new THREE.MeshStandardMaterial({ map: tex('chalk_arrow.png', { wrap: false }), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4 });
    const geo = new THREE.PlaneGeometry(1.0, 0.35).rotateX(-Math.PI / 2);
    let next = 1.2; // distance into the current segment of the next arrow
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
    const g = game.g;
    const step = g.introStep;
    if (!isIntroActive(step) || step === 'casino') return null;
    const acts: Action[] = [];
    const hit = ctx.hit;
    const cart = game.state.all('cart')[0];
    if (cart && cart.owner === 'oldman' && hit) {
      const onCart = hit.ent?.id === cart.id || hit.kind === 'cart' || (hit.ent?.t === 'item' && hit.ent.in === cart.id) || (cart.p && dist2D([hit.point.x, 0, hit.point.z], cart.p) < 1.25 && hit.kind !== 'npc' && hit.kind !== 'player');
      if (onCart) {
        if (step === 'wake' || step === 'see_cart') acts.push({ key: 'E', label: CART_LABEL.push, priority: 2000, run: () => game.intent('intro.tryCart', {}) });
        else acts.push({ key: 'E', label: CART_LABEL.push, priority: 2000, disabled: CART_LABEL.notYours });
        acts.push({ key: 'LMB', label: tl('ใช้', 'use'), priority: 2000, disabled: CART_LABEL.notYours });
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
    return acts;
  }

  private inView(e: Ent) {
    const cam = this.game.camera;
    const p = new THREE.Vector3(e.p![0], e.p![1] + 1.2, e.p![2]);
    const c = cam.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    return p.sub(c).normalize().dot(f) > 0.9;
  }

  // ------------------------------------------------------------------ tutorial thoughts (after the intro)

  private setupHints() {
    const game = this.game;
    const has = (k: string) => game.state.all('item').some((e) => e.k === k);
    const holding = (k: string) => { const me = game.me; return !!me && game.items.carried(me).some((e) => e.k === k); };
    this.hints = [
      { id: 'book', text: HINTS.book, done: () => this.bookOpened || holding('recipe_book'), at: 8, shown: 0 },
      { id: 'cook', text: HINTS.cook, done: () => has('dish'), at: 40, shown: 0 },
      { id: 'sign', text: HINTS.sign, done: () => !!game.g.shopOpen, at: 75, shown: 0 },
      { id: 'serve', text: HINTS.serve, done: () => this.earned, at: 110, shown: 0 },
    ];
    this.hintT = 0;
    this.walletSeen = game.me?.wallet ?? 0;
  }

  private tickHints(dt: number) {
    if (!this.hints.length) return;
    this.hintT += dt;
    const me = this.game.me;
    if (me) { if ((me.wallet ?? 0) > this.walletSeen) this.earned = true; this.walletSeen = me.wallet ?? 0; }
    const h = this.hints[0];
    if (h.done()) { this.hints.shift(); if (this.hints[0]) this.hints[0].at = Math.max(this.hints[0].at, this.hintT + 12); return; }
    if (this.hintT >= h.at && h.shown < 3) {
      h.shown++;
      h.at = this.hintT + 45;
      this.think(this.game.localPlayerId, h.text, 4.5);
    }
  }
}
