import * as THREE from 'three';
import { defineModule, type CharacterRig } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { Input } from '../../core/input';
import { params, tl, type TL } from '../../core/util';
import { standLook } from '../characters/defs';
import { Menace, ScreenFX } from '../intro/casino-cine';
import { G } from '../../sim/physics';
import { RewindOverlay, SmokeSuck, Aura } from './fx';

/* ============================================================================================
 * MODULE `stand` — "ข้าวไหม้ควีน / BURNT QUEEN": when the rice in a wok burns, the cook's
 * spirit-guardian (an ORIGINAL manga-style "stand": tall pink-and-cream humanoid, cat-eared helm,
 * gold skull motifs) appears behind the old man (tutorial) or the cooking player, presses its
 * thumb switch and REWINDS TIME: the smoke flies back into the wok and the dish un-burns.
 *
 * HOST: snapshots every wok's data 4×/s (ring buffer ~8 s). When a wok's burn level crosses the
 *       threshold and the rewind is allowed (tutorial lesson: up to 3×, 20 s apart; normal play:
 *       the first burn, then 25 % chance with a 150 s cooldown) it emits 'stand:go', poses the
 *       user, and at +4.4 s restores the wok to its state from ~3.5 s before the burn
 *       ('stand:restored'). Multiplayer-safe: only the host touches state.
 * EVERY PEER: ~7 s sequence — desaturate, manga focus lines, ゴゴゴ glyphs, the stand fades in,
 *       name card, thumb-click flash, VHS rewind + smoke sucked back into the wok, back to normal.
 *       Hold Space to skip the visuals. Debug: __hp.game.stand.test() (host) · ?standtest
 * ========================================================================================== */

const BURN_AT = 0.45;
const RESTORE_AT = 4.4;
const DUR = 7.0;

interface Snap { t: number; js: string; maxB: number }
interface Go { n: number; user: number; wok: number; cart: number | null; line: number }

const LINES: TL[] = [
  tl('ข้าวไหม้งั้นเหรอ… ย้อนเวลา!', 'Burnt rice, huh… REWIND!'),
  tl('กระทะนี้… ข้าไม่ยอมให้ไหม้!', 'Not on my wok!'),
  tl('ข้าวไหม้ควีน! กดสวิตช์!', 'Burnt Queen! Press the switch!'),
];
const AFTER: TL[] = [
  tl('เชี่ย… เวลาย้อนจริงดิ!?', 'Holy shit… time went back!?'),
  tl('ห่าเอ๊ย กูเห็นผีสีชมพู', 'Damn, I just saw a pink ghost'),
  tl('ไอ้บ้า… ข้าวกลับมาสวยเฉย', 'What the hell… the rice is perfect again'),
];
const OLD_AFTER: TL[] = [
  tl('ทีหลังอย่าเผลออีก ไอ้หนู ข้าใช้ได้วันละครั้ง', "Don't zone out again, kid. I get one of these a day"),
  tl('ไฟแรงไปแล้วมึง ลดไฟ!', 'Flame too high, dumbass. Turn it down!'),
];

// ------------------------------------------------------------------ host

class StandHost {
  private snaps = new Map<number, Snap[]>();
  private prevB = new Map<number, number>();
  private acc = 0;
  private count = 0;
  private lessonCount = 0;
  private lastT = -1e9;
  private active: { go: Go; t: number; restored: boolean; posed: boolean; done: boolean; snap: string | null; userEnt: Ent | null } | null = null;
  private n = 0;
  private time = 0;

  constructor(private game: Game) {
    game.onIntent('stand.test', () => this.test());
  }

  private woks(): Ent[] { return this.game.state.all('item').filter((e) => e.k === 'wok'); }

  private maxBurn(d: any): number {
    let m = 0;
    for (const v of Object.values<any>(d?.it ?? {})) if ((v?.g ?? 0) > 3) m = Math.max(m, v?.b ?? 0);
    if (d?.egg?.n) m = Math.max(m, d.egg.b ?? 0);
    if (d?.om?.n) m = Math.max(m, d.om.b ?? 0);
    return m;
  }

  update(dt: number) {
    const game = this.game;
    this.time += dt;
    // ---- snapshots (4×/s)
    this.acc += dt;
    if (this.acc >= 0.25) {
      this.acc = 0;
      for (const w of this.woks()) {
        let a = this.snaps.get(w.id);
        if (!a) this.snaps.set(w.id, (a = []));
        a.push({ t: this.time, js: JSON.stringify(w.data ?? {}), maxB: this.maxBurn(w.data) });
        while (a.length && this.time - a[0].t > 8) a.shift();
      }
    }
    // ---- burn detection
    if (!this.active) {
      for (const w of this.woks()) {
        const b = this.maxBurn(w.data), pb = this.prevB.get(w.id) ?? 0;
        this.prevB.set(w.id, b);
        if (pb < BURN_AT && b >= BURN_AT && this.allowed()) { this.trigger(w); break; }
      }
    }
    // ---- running sequence (host side state changes)
    const A = this.active;
    if (!A) return;
    A.t += dt;
    if (!A.posed && A.t > 0.2) { A.posed = true; if (A.userEnt) setAnim(game, A.userEnt, 'cine_menace', true); }
    if (!A.restored && A.t > RESTORE_AT) {
      A.restored = true;
      const w = game.state.get(A.go.wok);
      if (w) {
        // the snapshot from before the burn; if the history doesn't reach back far enough, un-burn the current pan
        const snapData = A.snap ? JSON.parse(A.snap) : null;
        w.data = snapData && this.maxBurn(snapData) < BURN_AT * 0.6 ? snapData : unburn(w.data);
        delete (w as any)._s; delete (w as any)._pub;
        this.prevB.set(w.id, this.maxBurn(w.data));
      }
      const c = A.go.cart != null ? game.state.get(A.go.cart) : null;
      if (c?.burner?.on) c.burner = { ...c.burner, heat: Math.min(c.burner.heat ?? 0.6, 0.5) };   // the stand turned the flame down too
      if (A.userEnt) setAnim(game, A.userEnt, 'cine_point', false);
      game.emit('stand:restored', { n: A.go.n, wok: A.go.wok });
    }
    if (!A.done && A.t > DUR - 0.3) {
      A.done = true;
      if (A.userEnt) setAnim(game, A.userEnt, 'idle', true);
      const isOld = A.userEnt?.t === 'npc';
      if (A.userEnt) game.say(A.userEnt.id, pick(isOld ? OLD_AFTER : AFTER), { style: 'shout', duration: 3.2 } as any);
      const cook = this.nearestPlayer(A.go.wok);
      if (isOld && cook) setTimeout(() => game.say(cook.id, pick(AFTER), { duration: 3 } as any), 1400);
    }
    if (A.t > DUR + 0.2) this.active = null;
  }

  private allowed(): boolean {
    const g: any = this.game.g;
    if (params.has('nostand')) return false;
    if (g.introStep === 'lesson') return this.lessonCount < 3 && this.time - this.lastT > 20;
    if (g.introStep && g.introStep !== 'done') return false;
    if (this.count === 0) return true;
    return this.time - this.lastT > 150 && Math.random() < 0.25;
  }

  private nearestPlayer(wokId: number): Ent | null {
    const w = this.game.state.get(wokId);
    const wp = worldPosOf(this.game, wokId) ?? (w?.p ? new THREE.Vector3(w.p[0], w.p[1], w.p[2]) : null);
    let best: Ent | null = null, bd = 1e9;
    for (const p of this.game.players()) {
      if (!p.p || !wp) continue;
      const d = Math.hypot(p.p[0] - wp.x, p.p[2] - wp.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ?? this.game.players()[0] ?? null;
  }

  /** start the rewind for this wok */
  trigger(w: Ent) {
    const game = this.game, g: any = game.g;
    const snaps = this.snaps.get(w.id) ?? [];
    // the newest snapshot ~3.5 s back that wasn't burnt yet (else the oldest we have)
    let snap: Snap | null = null;
    for (let i = snaps.length - 1; i >= 0; i--) if (this.time - snaps[i].t >= 3 && snaps[i].maxB < BURN_AT * 0.6) { snap = snaps[i]; break; }
    snap ??= snaps.find((s) => s.maxB < BURN_AT) ?? snaps[0] ?? null;
    // user: the old man in the tutorial (if he's near), else the cook
    let user: Ent | null = null;
    const old = g.introOld != null ? game.state.get(g.introOld) : null;
    const wp = worldPosOf(game, w.id);
    if (old?.p && wp && Math.hypot(old.p[0] - wp.x, old.p[2] - wp.z) < 14) user = old;
    user ??= this.nearestPlayer(w.id);
    if (!user) return;
    const cart = game.state.all('cart').find((c) => wp && c.p && Math.hypot(c.p[0] - wp.x, c.p[2] - wp.z) < 2.5) ?? null;
    this.count++; if (g.introStep === 'lesson') this.lessonCount++;
    this.lastT = this.time;
    const go: Go = { n: ++this.n, user: user.id, wok: w.id, cart: cart?.id ?? null, line: Math.floor(Math.random() * LINES.length) };
    this.active = { go, t: 0, restored: false, posed: false, done: false, snap: snap?.js ?? null, userEnt: user };
    game.emit('stand:go', go);
    game.say(user.id, LINES[go.line], { style: 'shout', duration: 3.2 } as any);
  }

  /** debug: rewind the nearest wok right now */
  test() {
    const w = this.woks()[0];
    if (w && !this.active) this.trigger(w);
  }
}

// ------------------------------------------------------------------ every peer: the sequence

class StandShow {
  private rig: CharacterRig | null = null;
  private overlay: RewindOverlay | null = null;
  private fx: ScreenFX | null = null;
  private menace = new Menace();
  private smoke = new SmokeSuck();
  private aura = new Aura();
  private run: { go: Go; t: number; ownCam: boolean; skipHold: number; clicked: boolean; rewind: boolean; tick: any; ended: boolean } | null = null;
  private v = new THREE.Vector3();
  private cam0 = { p: new THREE.Vector3(), look: new THREE.Vector3() };

  constructor(private game: Game) {
    game.on('stand:go', (d: Go) => this.start(d));
  }

  private ensureRig(): CharacterRig | null {
    if (this.rig) return this.rig;
    try {
      this.rig = this.game.chars.create(standLook(), { lod: 'high', castShadow: false });
      this.rig.root.name = 'stand:burnt-queen';
      (this.rig as any).ambient = false;
    } catch (e) { console.warn('[stand] rig', e); this.rig = null; }
    return this.rig;
  }

  /** translucent spirit look (no bloom glow: low emissive, tone-mapped) */
  private ghost(k: number) {
    const r = this.rig;
    if (!r) return;
    r.root.visible = k > 0.01;
    r.root.traverse((o: any) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        if (!m.userData.standGhost) {
          m.userData.standGhost = true;
          m.transparent = true;
          if (m.emissive) { m.emissive.set(0x7a2a4a); m.emissiveIntensity = 0.35; }
          m.needsUpdate = true;
        }
        m.opacity = 0.78 * k;
      }
      o.castShadow = false;
    });
  }

  start(go: Go) {
    const game = this.game;
    if (!game.scene) return;
    this.finish(true);
    const pl = game.player;
    const ownCam = !!pl && pl.mode === 'play';
    if (ownCam) pl.setMode('external');
    this.overlay ??= new RewindOverlay();
    this.fx ??= new ScreenFX();
    if (!this.menace.group.parent) game.scene.add(this.menace.group);
    if (!this.smoke.group.parent) game.scene.add(this.smoke.group);
    const rig = this.ensureRig();
    if (rig && !rig.root.parent) game.scene.add(rig.root);
    if (rig && !this.aura.points.parent) rig.root.add(this.aura.points);
    this.ghost(0);
    rig?.play('cine_cross' as any, { loop: true, fade: 0.1 });
    this.cam0.p.copy(game.camera.position);
    game.camera.getWorldDirection(this.v); this.cam0.look.copy(game.camera.position).add(this.v);
    this.run = { go, t: 0, ownCam, skipHold: 0, clicked: false, rewind: false, tick: null, ended: false };
    this.fx.flash(0.1);
    this.fx.focusLines(true, 'focus');
    this.overlay.gray(true);
    this.menace.emit(() => this.userHead().add(new THREE.Vector3(0, 0.2, 0)), 'go', 2.6, 1);
    this.menace.emit(() => this.userHead().add(new THREE.Vector3(0, 0.2, 0)), 'do', 1.6, -1);
    Sound.play(Sound.has('slowmo_dramatic') ? 'slowmo_dramatic' : 'bass_boom', { vol: 0.8 });
    Sound.play('heartbeat_slow', { vol: 0.5 });
  }

  private userObj(): THREE.Object3D | null { return this.run ? this.game.views.objectOf(this.run.go.user) : null; }
  private userHead(): THREE.Vector3 {
    const o = this.userObj();
    if (!o) return this.wokPos().add(new THREE.Vector3(0, 1.6, 0));
    const h = (o.userData.headHeight as number) ?? 1.7;
    return o.localToWorld(new THREE.Vector3(0, h - 0.25, 0));
  }
  private wokPos(): THREE.Vector3 {
    return (this.run && worldPosOf(this.game, this.run.go.wok)) ?? this.cam0.look.clone();
  }

  frame(raw: number) {
    this.overlay?.update(raw);
    this.fx?.update(raw);
    this.menace.update(raw, this.game.camera);
    this.smoke.update(raw);
    const R = this.run;
    if (!R) return;
    const game = this.game;
    R.t += raw;
    const t = R.t;
    // skip: hold Space
    if (Input.isDown('Space')) { R.skipHold += raw; if (R.skipHold > 0.4) { this.finish(); return; } } else R.skipHold = 0;

    // ---- stand: behind the user, floating, fades in 0.6–1.4 s, out 5.8–6.6 s
    const o = this.userObj();
    const k = t < 0.6 ? 0 : t < 1.4 ? (t - 0.6) / 0.8 : t < 5.8 ? 1 : Math.max(0, 1 - (t - 5.8) / 0.8);
    if (this.rig && o) {
      const yaw = o.getWorldQuaternion(new THREE.Quaternion());
      const back = new THREE.Vector3(0, 0, 0.55).applyQuaternion(yaw);   // characters face -Z: +Z is behind them
      const base = o.getWorldPosition(new THREE.Vector3()).add(back).add(new THREE.Vector3(0, 0.22 + Math.sin(t * 2.2) * 0.04, 0));
      this.rig.root.position.copy(base);
      this.rig.root.quaternion.copy(yaw);
      this.rig.root.scale.setScalar(0.9 + 0.1 * k);
      this.ghost(k);
      this.rig.update(raw);
      this.aura.update(t, k);
    }
    if (t > 1.2 && t - raw <= 1.2) this.overlay?.showCard(true);
    // ---- the thumb switch
    if (!R.clicked && t > 3.1) {
      R.clicked = true;
      this.rig?.play('point' as any, { loop: false, fade: 0.1 });
      this.fx?.flash(0.1);
      Sound.play(Sound.has('record_scratch') ? 'record_scratch' : 'whoosh_swing', { vol: 0.9 });
      this.overlay?.showCard(false);
    }
    // ---- rewind 3.4–5.8 s: VHS rewind, smoke flies back into the wok
    if (!R.rewind && t > 3.4) {
      R.rewind = true;
      this.overlay?.rewind(true);
      this.smoke.target.copy(this.wokPos()).add(new THREE.Vector3(0, 0.08, 0));
      this.smoke.active = true;
      R.tick = Sound.has('tick_tock_loop') ? Sound.loop('tick_tock_loop', { vol: 0.8 }) : null;
      Sound.play('slowmo_whoosh', { vol: 0.7 });
    }
    if (R.rewind && t > 5.8 && this.smoke.active) {
      this.smoke.active = false;
      this.overlay?.rewind(false);
      R.tick?.stop?.(0.3); R.tick = null;
      this.overlay?.gray(false);
      this.fx?.focusLines(false);
      this.menace.stop();
      Sound.play('sparkle_chime', { vol: 0.6 });
    }

    // ---- camera (only when we took it from gameplay)
    if (R.ownCam) {
      const cam = game.camera;
      const head = this.userHead();
      const yawQ = o ? o.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQ);   // the direction the user faces
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQ);
      let p: THREE.Vector3, look: THREE.Vector3;
      const shotNo = t < 3.0 ? 0 : t < 3.45 ? 1 : t < 5.9 ? 2 : 3;
      if (shotNo !== this.shotNo) { this.shotNo = shotNo; this.shotDir = null; }
      if (t < 3.0) {
        // slightly low hero angle on the user with the stand towering behind, slow push-in (clear line of sight)
        look = head.clone().add(new THREE.Vector3(0, 0.3, 0));
        p = this.clearShot(look, fwd.clone().addScaledVector(side, 0.35).setY(0).normalize(), 3.0 - t * 0.2, -0.45);
      } else if (t < 3.45) {
        // snap close-up on the stand's hand pressing the switch
        const hand = this.rig ? this.rig.attach('hand_r').getWorldPosition(new THREE.Vector3()) : head;
        p = hand.clone().addScaledVector(fwd, 0.9).add(new THREE.Vector3(0, 0.1, 0));
        look = hand;
      } else if (t < 5.9) {
        // over the wok: smoke sucked back in, slow orbit
        const w = this.wokPos();
        const a = (t - 3.45) * 0.35;
        look = w.clone().add(new THREE.Vector3(0, 0.05, 0));
        p = this.clearShot(look, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 1.0, 0.85);
      } else {
        // wide back on the user, then hand back
        look = head;
        p = this.clearShot(look, fwd, 3.0, 0.2);
      }
      if (t > 3.0 && t < 3.08) this.shake = 0.06;
      this.shake *= Math.exp(-raw * 9);
      p.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
      cam.position.lerp(p, t < 0.05 ? 1 : 1 - Math.exp(-raw * 9));
      cam.lookAt(look);
    }
    if (t >= DUR) this.finish();
  }
  private shake = 0;
  private shotNo = -1;
  private shotDir: THREE.Vector3 | null = null;

  /** camera position looking at `target` from about `dist` m, preferring `pref` (horizontal), picking the
   *  direction with the clearest line of sight (static geometry / vehicles / carts don't block the shot) */
  private clearShot(target: THREE.Vector3, pref: THREE.Vector3, dist: number, lift: number): THREE.Vector3 {
    const phys = this.game.physics;
    if (!this.shotDir) {
      let best = pref.clone(), bestD = -1;
      for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
        const d = pref.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a).normalize();
        const dir = d.clone().multiplyScalar(dist).add(new THREE.Vector3(0, lift, 0));
        const len = dir.length(); dir.normalize();
        const h = phys?.raycast(target, dir, len + 0.3, G.STATIC | G.VEHICLE | G.ITEM);
        const free = h ? h.toi : len + 0.3;
        const score = Math.min(free, len) - Math.abs(a) * 0.15;
        if (score > bestD) { bestD = score; best = d; }
      }
      this.shotDir = best;
    }
    const dir = this.shotDir.clone().multiplyScalar(dist).add(new THREE.Vector3(0, lift, 0));
    const len = dir.length(); dir.normalize();
    const h = phys?.raycast(target, dir, len, G.STATIC | G.VEHICLE | G.ITEM);
    return target.clone().addScaledVector(dir, Math.max(0.6, (h ? h.toi - 0.25 : len)));
  }

  private finish(silent = false) {
    const R = this.run;
    if (!R) return;
    this.run = null;
    R.tick?.stop?.(0.2);
    this.smoke.active = false;
    this.menace.clear();
    this.overlay?.gray(false); this.overlay?.rewind(false); this.overlay?.showCard(false);
    this.fx?.focusLines(false);
    this.ghost(0);
    if (this.rig) this.rig.root.visible = false;
    if (R.ownCam && this.game.player && this.game.player.mode === 'external') this.game.player.setMode('play');
    void silent;
  }
}

// ------------------------------------------------------------------ helpers

/** the wok's contents as if they had never burnt: burn levels back to a light toast, pan off the smoke point */
function unburn(d: any): any {
  const o = JSON.parse(JSON.stringify(d ?? {}));
  for (const v of Object.values<any>(o.it ?? {})) if (v) v.b = Math.min(v.b ?? 0, 0.12);
  if (o.egg) o.egg.b = Math.min(o.egg.b ?? 0, 0.12);
  if (o.om) o.om.b = Math.min(o.om.b ?? 0, 0.12);
  if (typeof o.T === 'number') o.T = Math.min(o.T, 185);
  o.sm = 0; o.ob = 0;
  return o;
}

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }

function setAnim(game: Game, e: Ent, anim: string, loop: boolean) {
  e.anim = anim;
  e.animT = (game.g.time ?? 0) + Math.random();
  e.animLoop = loop;
}

function worldPosOf(game: Game, id: number): THREE.Vector3 | null {
  const o = game.views.objectOf(id);
  if (o) return o.getWorldPosition(new THREE.Vector3());
  const e = game.state.get(id);
  return e?.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
}

/** HOST: anime-style NPCs (look.arch anime_*) strike an exaggerated anime pose now and then when a player is near */
class AnimeFlair {
  private t = 0;
  private next = new Map<number, number>();
  constructor(private game: Game) {}
  update(dt: number) {
    this.t += dt;
    if ((this.t % 1) > dt) return;               // ~1 Hz scan
    const players = this.game.players();
    for (const e of this.game.state.all('npc')) {
      const arch: string = (e.look as any)?.arch ?? '';
      if (!arch.startsWith('anime_') || !e.p) continue;
      const near = players.some((p) => p.p && Math.hypot(p.p[0] - e.p![0], p.p[2] - e.p![2]) < 14);
      if (!near) continue;
      const due = this.next.get(e.id) ?? this.t + 6 + Math.random() * 10;
      if (!this.next.has(e.id)) { this.next.set(e.id, due); continue; }
      if (this.t < due) continue;
      this.next.set(e.id, this.t + 18 + Math.random() * 25);
      const poses = arch === 'anime_delinquent' ? ['cine_menace', 'cine_point', 'cine_cross'] : arch === 'anime_magical' ? ['cine_hair', 'celebrate', 'wave'] : ['cine_point', 'cine_twist', 'cine_lean', 'cine_hair'];
      setAnim(this.game, e, pick(poses), false);
    }
  }
}

let host: StandHost | null = null;
let flair: AnimeFlair | null = null;
let show: StandShow | null = null;

export default defineModule({
  id: 'stand',
  deps: ['characters', 'cooking'],
  init(game: Game) {
    host = new StandHost(game);
    flair = new AnimeFlair(game);
    show = new StandShow(game);
    Sound.preload(['slowmo_dramatic', 'heartbeat_slow', 'record_scratch', 'tick_tock_loop', 'slowmo_whoosh', 'sparkle_chime', 'bass_boom']);
    (game as any).stand = {
      /** HOST: rewind the first wok now (debug / tests) */
      test: () => { if (game.isHost) host?.test(); else game.intent('stand.test', {}); },
      /** seconds into the running sequence on this peer (-1 = none) */
      t: () => (show as any)?.run?.t ?? -1,
    };
    if (params.has('standtest')) game.events.on('scene:entered', (n: string) => { if (n === 'world') setTimeout(() => game.isHost && host?.test(), 4000); });
  },
  hostUpdate(game: Game, dt: number) {
    try { host?.update(dt); flair?.update(dt); } catch (e) { console.warn('[stand] host', e); }
  },
  frame(game: Game, dt: number) {
    try { show?.frame(Math.min(params.has('standfast') ? 0.6 : 0.1, dt)); } catch (e) { console.warn('[stand] frame', e); }
  },
});
