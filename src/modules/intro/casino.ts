import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SceneDef } from '../../game/scenes';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { Sound, SoundHandle } from '../../core/audio';
import { Input } from '../../core/input';
import { F } from '../../core/fonts';
import { params } from '../../core/util';
import { Overlay } from '../../ui3d/overlay';
import { buildCasino, CasinoSet, makeBottle, makeGlass, ROULETTE, SLOTS_POS, TABLE_Y } from './casino-set';
import { Chips, Particles, makeCard } from './casino-fx';
import { CASINO, CASINO_SHOUTS } from './lines';
import { clamp01, ease, key, lerp, play, smooth, suitLook } from './util';

/* ============================================================================================
 * Scene 'casino' — the ~50 s slow-motion intro cutscene (skippable: hold Space / E).
 * Every peer plays the same timeline locally; the host publishes its clock in g.casinoT so late
 * or slow peers jump ahead, and ends it with g.introStep='wake', g.scene='world'.
 * ========================================================================================== */

const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Actor {
  rig: any;
  root: THREE.Group;
  pid?: number;
  slot?: number;
  props: THREE.Object3D[];
  move?: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number };
  speed: number;
  hold?: number;
}

interface Beat {
  name: string;
  at: number;
  dur: number;
  enter?(): void;
  tick?(k: number, dt: number, raw: number): void;
  cam(k: number, t: number): void;
}

export const CASINO_LEN = 49.2;

export class CasinoScene implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.03, 120);
  fade = true;
  private set!: CasinoSet;
  private chips!: Chips;
  private parts!: Particles;
  private players: Actor[] = [];
  private extras: Actor[] = [];
  private dealer!: Actor;
  private croupier!: Actor;
  private waitress!: Actor;
  private beats: Beat[] = [];
  private bi = -1;
  private t = 0;
  private ready = false;
  private done = false;
  private last = performance.now();
  private skipHold = 0;
  private skipEl: HTMLDivElement | null = null;
  private music: SoundHandle | null = null;
  private amb: SoundHandle | null = null;
  private loops: SoundHandle[] = [];
  private envTex: THREE.Texture | null = null;
  private look = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private dof = 0;
  private slow = 1;
  private slowTarget = 1;
  private cards: THREE.Group[] = [];
  private stacks: Record<string, THREE.Group> = {};
  private wheelW = 0;
  private ballA = 0;
  private ballW = 0;
  private ballR = 0.385;
  private ballSettled = false;
  private shake = 0;
  private caBase = new THREE.Vector2(0.00055, 0.00045);
  private pubT = 0;
  private offFrame: (() => void) | null = null;

  constructor(private game: Game) {}

  // ------------------------------------------------------------------ lifecycle

  async enter() {
    const game = this.game;
    const s = this.scene;
    s.name = 'casino';
    s.background = new THREE.Color(0x0c0605);
    s.fog = new THREE.FogExp2(0x1c0c06, 0.016);
    s.add(this.camera);
    game.engine.setView(s, this.camera);
    game.ui.setScene(s, this.camera);
    const post = game.engine.post;
    post.setLook('casino', 1);
    post.setDOF(false);
    post.fade = 0;
    this.caBase.copy(post.ca.offset);
    if (game.isHost) { game.g.introStep = 'casino'; game.g.phase = 'intro'; game.g.casinoT = 0; game.g.skipVotes = []; }

    this.set = buildCasino();
    s.add(this.set.root);
    this.chips = new Chips();
    s.add(this.chips.group);
    this.parts = new Particles();
    s.add(this.parts.group);
    try {
      const hdr = await Promise.race([Assets.hdr('hdri/interior_warm_casino_1k.hdr'), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      if (hdr) {
        const pm = new THREE.PMREMGenerator(game.engine.renderer);
        this.envTex = pm.fromEquirectangular(hdr as THREE.Texture).texture;
        pm.dispose();
        (hdr as THREE.Texture).dispose();
        s.environment = this.envTex;
        (s as any).environmentIntensity = 0.7;
      }
    } catch (e) { console.warn('[intro] casino hdri', e); }

    this.cast();
    this.props();
    this.buildBeats();
    Overlay.letterbox(true);
    Overlay.crosshair(false);
    Input.setWantLock(false);
    Sound.preload(['casino_ambience_loop', 'casino_lounge', 'slowmo_whoosh', 'slowmo_dramatic', 'crowd_cheer', 'cheers_glass_clink', 'champagne_pop', 'chips_clatter', 'card_shuffle', 'heartbeat_slow', 'roulette_spin', 'slot_win', 'sad_trombone', 'record_scratch', 'hiccup', 'body_thud', 'wow_crowd', 'crowd_aww', 'lose_sting']);
    this.amb = Sound.loop(key('casino_ambience_loop', 'crowd_chatter_loop'), { vol: 0.55, bus: 'amb' });
    this.music = Sound.play(key('casino_lounge'), { loop: true, bus: 'music', vol: 0.8, offset: 0 });
    this.makeSkipHint();
    this.last = performance.now();
    this.offFrame = game.engine.onFrame((f) => this.frame(f.rawDt));
    // warm up: the first update places the camera before the curtain lifts
    this.t = Math.max(0, Number(params.get('casinoT')) || 0); this.bi = -1;
    this.ready = true;
    this.frame(0);
    if (params.get('intro') && game.isHost) setTimeout(() => this.finish(), 50); // ?intro=<step>: test the world part
  }

  exit() {
    const game = this.game;
    this.ready = false;
    this.offFrame?.();
    game.engine.timeScale = 1;
    Sound.timeScale = 1;
    const post = game.engine.post;
    post.setDOF(false);
    post.fade = 0;
    post.ca.offset.copy(this.caBase);
    Overlay.letterbox(false);
    Overlay.clearSubtitle();
    this.skipEl?.remove();
    this.skipEl = null;
    this.music?.stop(0.4); this.amb?.stop(0.4);
    for (const l of this.loops) l.stop(0.2);
    for (const a of [...this.players, ...this.extras]) { try { a.rig.dispose(); } catch {} }
    this.chips.dispose();
    this.parts.dispose();
    this.set.dispose();
    this.envTex?.dispose();
    this.scene.traverse((o: any) => o.geometry?.dispose?.());
  }

  update() { /* driven by our own onFrame (needs real dt for pacing) */ }

  // ------------------------------------------------------------------ cast

  private addActor(look: any, p: THREE.Vector3, yaw: number, anim = 'idle', extra = true): Actor {
    const rig = this.game.chars.create(look, { castShadow: true } as any);
    const root = new THREE.Group();
    root.add(rig.root);
    root.position.copy(p);
    root.rotation.y = yaw;
    this.scene.add(root);
    rig.play(anim as any, { loop: true, fade: 0 });
    const a: Actor = { rig, root, props: [], speed: 0 };
    if (extra) this.extras.push(a);
    return a;
  }

  /** Card-table spot i of n (arc on the players' side), facing the dealer. */
  private tableSpot(i: number, n: number) {
    const span = Math.min(0.42, 0.14 * (n - 1));
    const a = Math.PI / 2 + (n === 1 ? 0 : span * Math.PI * (0.5 - i / (n - 1)));
    const x = Math.cos(a) * 1.68, z = -0.55 + Math.sin(a) * 1.62;
    return { p: V(x, 0, z), yaw: yawTo(-x, -0.55 - z) };
  }

  private cast() {
    const game = this.game;
    const chars = game.chars;
    let pls = game.players();
    if (!pls.length) pls = [{ id: -1, slot: 0, look: null } as any];
    const n = pls.length;
    pls.forEach((pl: Ent, i: number) => {
      const slot = pl.slot ?? i;
      const base = pl.look ?? chars.playerLook(slot);
      const sp = this.tableSpot(i, n);
      const a = this.addActor(suitLook(base, slot), sp.p, sp.yaw, 'idle', false);
      a.pid = pl.id; a.slot = slot;
      this.players.push(a);
    });
    const look = (arch: string, seed: number, over: any = {}) => ({ ...chars.randomLook(arch, seed), ...over });
    // dealer & croupier: white shirts, black slacks
    this.dealer = this.addActor(look('office_worker_f', 11, { top: { id: 'dress_shirt', color: '#f3f1ec' }, bottom: { id: 'slacks', color: '#1d1d1f' }, shoes: { id: 'leather', color: '#1a1512' }, acc: [] }), V(0, 0, -1.02), Math.PI);
    this.croupier = this.addActor(look('office_worker_m', 23, { top: { id: 'dress_shirt', color: '#f3f1ec' }, bottom: { id: 'slacks', color: '#1d1d1f' }, shoes: { id: 'leather', color: '#1a1512' }, acc: [] }), V(ROULETTE.x + 0.3, 0, ROULETTE.z - 0.98), Math.PI);
    // onlookers behind the players
    this.addActor(look('karaoke_uncle', 5), V(-1.9, 0, 1.9), yawTo(1.9, -2.4), 'idle');
    this.addActor(look('auntie_vendor', 9, { top: { id: 'shirt_satin', color: '#a8202e' } }), V(1.8, 0, 2.0), yawTo(-1.8, -2.5), 'idle');
    // roulette regulars
    this.addActor(look('gangster_lite', 31), V(ROULETTE.x - 1.75, 0, ROULETTE.z + 0.2), -Math.PI / 2 + 0.2, 'idle');
    this.addActor(look('tourist_backpacker', 41, { acc: [] }), V(ROULETTE.x + 1.9, 0, ROULETTE.z + 0.35), Math.PI / 2 - 0.3, 'idle');
    // slot players (seated)
    for (const [idx, seed, arch] of [[2, 51, 'old_lady'], [5, 52, 'karaoke_uncle'], [10, 53, 'housewife']] as [number, number, string][]) {
      const s = SLOTS_POS[idx];
      if (!s) continue;
      const p = V(s.p[0] + Math.sin(s.yaw) * 0.95, 0, s.p[2] + Math.cos(s.yaw) * 0.95);
      const a = this.addActor(look(arch, seed), p, s.yaw + Math.PI, 'sit');
      a.rig.setPosture?.('sit');
      a.rig.seat = 0.66;
    }
    this.addActor(look('security_guard', 61), V(3.9, 0, -11.2), 0.2, 'stand_cool');
    this.waitress = this.addActor(look('office_worker_f', 71, { top: { id: 'blouse_office', color: '#1d1d1f' }, bottom: { id: 'skirt', color: '#1d1d1f' } }), V(10, 0, 3), -Math.PI / 2);
    const tray = makeBottle('champagne');
    this.waitress.rig.attach('hand_r').add(tray);
  }

  private props() {
    // pot & bets
    const st = this.stacks;
    st.pot1 = this.chips.stack(V(-0.28, TABLE_Y + 0.03, -0.42), 14, 1, 3);
    st.pot2 = this.chips.stack(V(0.18, TABLE_Y + 0.03, -0.42), 12, 0, 3);
    this.players.forEach((a, i) => { st['bet' + i] = this.chips.stack(V(a.root.position.x * 0.72, TABLE_Y, -0.55 + (a.root.position.z + 0.55) * 0.72), 6 + i * 2, (i + 2) % 4, 1); });
    st.rouletteBank = this.chips.stack(V(ROULETTE.x + 0.95, ROULETTE.y, ROULETTE.z - 0.45), 16, 3, 6);
    // two cards face down in front of the dealer
    for (let i = 0; i < 2; i++) {
      const c = makeCard(i);
      c.position.set(-0.05 + i * 0.075, TABLE_Y + 0.002, -0.1);
      c.rotation.set(0, 0.06 * (i ? 1 : -1), Math.PI);
      this.scene.add(c);
      this.cards.push(c);
    }
    // drinks on the table
    const drinks = new THREE.Group();
    drinks.position.set(0.72, TABLE_Y, 0.22);
    const kinds = ['singha', 'chang', 'sangsom', 'wine', 'leo'];
    kinds.forEach((k, i) => { const b = makeBottle(k); b.position.set((i % 3) * 0.1 - 0.1, 0, Math.floor(i / 3) * 0.1); b.rotation.y = 0.4 + i; drinks.add(b); });
    const g1 = makeGlass('beer'); g1.position.set(-0.25, 0, 0.05); drinks.add(g1);
    const g2 = makeGlass('wine'); g2.position.set(-0.2, 0, 0.16); drinks.add(g2);
    drinks.rotation.y = -0.5;
    this.scene.add(drinks);
  }

  private holdProp(a: Actor | undefined, obj: THREE.Object3D | null, rot: [number, number, number] = [0, 0, 0], off: [number, number, number] = [0, 0, 0]) {
    if (!a) return;
    for (const p of a.props) p.removeFromParent();
    a.props = [];
    if (!obj) return;
    obj.rotation.set(...rot);
    obj.position.set(...off);
    a.rig.attach('hand_r').add(obj);
    a.props.push(obj);
  }

  // ------------------------------------------------------------------ timeline

  private shot(from: THREE.Vector3, to: THREE.Vector3, lookA: THREE.Vector3, lookB: THREE.Vector3, fovA = 42, fovB = fovA, roll = 0, e = ease) {
    const cam = this.camera;
    return (k: number) => {
      const q = e(clamp01(k));
      cam.position.lerpVectors(from, to, q);
      this.look.lerpVectors(lookA, lookB, q);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      if (roll) cam.rotateZ(roll);
      const fov = lerp(fovA, fovB, q);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      this.focus.copy(this.look);
    };
  }

  private sub(t: { th: string; en?: string }, sec = 3.2) { Overlay.subtitle(t.th, t.en, sec); }

  private center() {
    const c = V(0, 0, 0);
    for (const a of this.players) c.add(a.root.position);
    return c.multiplyScalar(1 / Math.max(1, this.players.length));
  }

  private buildBeats() {
    const P = this.players;
    const n = P.length;
    const W = this.waitress;
    const fired = new Set<string>();
    const once = (id: string, fn: () => void) => { if (!fired.has(id)) { fired.add(id); fn(); } };
    const anim = (a: Actor, name: string, loop = true) => a?.rig.play(name as any, { loop, fade: 0.25 });
    const face = (a: Actor, f: string | null) => a?.rig.setFace?.(f as any);
    const tbl = V(0, TABLE_Y, 0.1);
    const R = ROULETTE;
    const wc = this.set.wheelCenter;
    let walkFrom: THREE.Vector3[] = [];

    this.beats = [
      {
        name: 'open', at: 0, dur: 4.6,
        enter: () => { this.slowTarget = 1; this.dof = 0; },
        tick: (k) => { if (k > 0.12) once('s0', () => this.sub(CASINO.open, 3.6)); },
        cam: this.shot(V(-5.2, 3.4, 8.2), V(-2.5, 1.85, 4.3), V(0, 2.6, -6), V(0, 1.0, 0), 50, 40),
      },
      {
        name: 'walk', at: 4.6, dur: 4.6,
        enter: () => {
          walkFrom = P.map((_, i) => V(-3.4 + i * 0.62 + (n < 3 ? 0.4 : 0), 0, -9.6));
          P.forEach((a, i) => { a.root.position.copy(walkFrom[i]); a.root.rotation.y = Math.PI; a.speed = 1.25; anim(a, 'idle'); });
          this.dof = 1;
        },
        tick: (k, dt) => {
          if (k > 0.1) { this.slowTarget = 0.5; once('w0', () => { play('slowmo_whoosh', { vol: 0.7 }); this.sub(CASINO.walk(n), 3.4); }); }
          P.forEach((a, i) => {
            const tripping = i === n - 1 && n > 1 && k > 0.45 && k < 0.7;
            if (i === n - 1 && n > 1 && k > 0.45) once('trip', () => { anim(a, 'fall', false); play('body_thud', { vol: 0.6 }); });
            if (i === n - 1 && n > 1 && k > 0.7) once('trip2', () => anim(a, 'idle'));
            if (tripping) { a.rig.setMove(0); return; }
            a.root.position.z += a.speed * dt;
            a.rig.setMove(a.speed);
          });
        },
        cam: (k) => {
          const c = this.center();
          this.shot(V(c.x + 0.3, 0.55, c.z + 3.4), V(c.x + 0.3, 0.6, c.z + 3.2), V(c.x, 1.25, c.z), V(c.x, 1.3, c.z), 38, 34)(k);
        },
      },
      {
        name: 'bet', at: 9.2, dur: 5.0,
        enter: () => {
          this.slowTarget = 1;
          P.forEach((a, i) => { const sp = this.tableSpot(i, n); a.root.position.copy(sp.p); a.root.rotation.y = sp.yaw; a.rig.setMove(0); anim(a, 'idle'); });
          play('card_shuffle', { vol: 0.7 });
          this.loops.push(play('heartbeat_slow', { vol: 0.8 }));
          this.dof = 1;
        },
        tick: (k) => {
          once('s2', () => this.sub(CASINO.bet, 3.4));
          // bets slide into the circles
          P.forEach((_, i) => {
            const g = this.stacks['bet' + i];
            if (!g) return;
            if (!g.userData.from) g.userData.from = g.position.clone();
            const to = g.userData.from.clone().lerp(V(0, TABLE_Y, -0.55), 0.18);
            g.position.lerpVectors(g.userData.from, to, smooth(0, 0.25, k));
          });
          if (k > 0.25) once('chip', () => play('chips_clatter', { vol: 0.7 }));
          const flip = (c: THREE.Group, a: number, b: number) => {
            const q = smooth(a, b, k);
            c.rotation.z = Math.PI * (1 - q);
            c.position.y = TABLE_Y + 0.002 + Math.sin(Math.PI * q) * 0.07;
          };
          flip(this.cards[0], 0.3, 0.45);
          if (k > 0.3) once('f1', () => { play('card_shuffle', { vol: 0.4, pitch: 1.6 }); anim(this.dealer, 'give', false); });
          if (k > 0.55) { this.slowTarget = 0.35; once('f2', () => { play('slowmo_whoosh', { vol: 0.5, pitch: 1.2 }); anim(this.dealer, 'give', false); }); }
          flip(this.cards[1], 0.6, 0.95);
        },
        cam: (k) => {
          if (k < 0.5) this.shot(V(0.05, 2.5, 0.42), V(0.05, 2.1, 0.36), V(0.0, TABLE_Y, 0.2), V(0.0, TABLE_Y, 0.18), 40, 36)(k / 0.5);
          else this.shot(V(0.42, 0.9, 0.42), V(0.3, 0.86, 0.3), V(0.0, 0.8, -0.1), V(0.03, 0.79, -0.1), 30, 24)((k - 0.5) / 0.5);
          this.camera.rotateZ(k < 0.5 ? k * 0.4 : 0);
        },
      },
      {
        name: 'win', at: 14.2, dur: 3.0,
        enter: () => {
          this.slowTarget = 1;
          for (const l of this.loops) l.stop(0.3);
          this.loops = [];
          play('crowd_cheer', { vol: 1 }); play('slot_win', { vol: 0.7 }); play('bass_boom', { vol: 0.5 });
          P.forEach((a) => anim(a, 'casino_cheer'));
          this.extras.forEach((a, i) => { if (a !== this.dealer && a !== this.croupier && i < 4) anim(a, 'celebrate'); });
          this.chips.burst(V(0, TABLE_Y + 0.15, 0.2), 70, 4.6, 2.2);
          this.shake = 0.6;
          this.dof = 0;
          this.sub(CASINO.win, 2.8);
          const sh = P[Math.floor(Math.random() * n)];
          if (sh?.pid != null && sh.pid >= 0) this.bubble(sh, CASINO_SHOUTS[0]);
        },
        tick: (k) => {
          // dealer pushes the pot to the players
          const to = V(0, TABLE_Y, 0.35);
          for (const id of ['pot1', 'pot2']) { const g = this.stacks[id]; if (!g.userData.from) g.userData.from = g.position.clone(); g.position.lerpVectors(g.userData.from, to.clone().add(V(id === 'pot1' ? -0.15 : 0.15, 0, 0)), smooth(0.1, 0.6, k)); }
        },
        cam: this.shot(V(-0.5, 1.45, -1.75), V(0.4, 1.5, -1.6), V(0, 1.35, 1.0), V(0, 1.4, 1.0), 44, 40),
      },
      {
        name: 'slowmo', at: 17.2, dur: 8.0,
        enter: () => {
          this.slowTarget = 0.22;
          play('slowmo_whoosh', { vol: 0.9 });
          this.music?.setVolume(0.0, 0.8);
          this.loops.push(Sound.play(key('slowmo_dramatic'), { loop: true, bus: 'music', vol: 0.85, offset: 0 }));
          this.parts.confetti(V(this.center().x, 0, this.center().z - 0.4), 280, 2.4, 2.8);
          this.chips.burst(V(0, TABLE_Y + 0.2, 0.4), 80, 5.2, 2.6);
          this.holdProp(P[0], makeBottle('champagne'), [-0.6, 0, 0], [0, -0.05, 0.05]);
          this.holdProp(P[1], makeGlass('beer'));
          this.holdProp(P[2], makeGlass('wine'));
          if (P[3]) this.holdProp(P[3], makeBottle('chang'), [-0.3, 0, 0]);
          if (n > 2) anim(P[2], 'dance');
          this.dof = 1;
        },
        tick: (k) => {
          if (k > 0.05) once('pop', () => {
            play('champagne_pop', { vol: 1 });
            const a = P[0];
            const p = a.root.position.clone().add(V(0, 1.6, 0));
            this.parts.spray(p, V(Math.sin(a.root.rotation.y + Math.PI) * 0.6, 1.4, Math.cos(a.root.rotation.y + Math.PI) * 0.6), 120, 3.2, 0xfff1c8);
          });
          if (k > 0.2) once('s4', () => this.sub(CASINO.slowmo, 4.2));
          if (k > 0.5) once('clink', () => {
            play('cheers_glass_clink', { vol: 1 });
            const c = this.center();
            this.parts.spray(V(c.x, 1.75, c.z - 0.2), V(0, 1, 0), 60, 1.6, 0xd8a038);
            P.forEach((a, i) => { if (i !== 2 || n <= 2) anim(a, 'celebrate'); });
          });
          if (k > 0.72) once('wow', () => play('wow_crowd', { vol: 0.6 }));
        },
        cam: (k) => {
          const c = this.center();
          const a0 = Math.PI * 0.2, a1 = Math.PI * 0.85;
          const ang = lerp(a0, a1, ease(k));
          const r = 2.5 - k * 0.5;
          const cam = this.camera;
          cam.position.set(c.x + Math.cos(ang) * r, 1.35 + Math.sin(k * 3) * 0.08, c.z - 0.3 + Math.sin(ang) * r * 0.9);
          this.look.set(c.x, 1.45, c.z - 0.1);
          cam.up.set(0, 1, 0);
          cam.lookAt(this.look);
          cam.rotateZ(Math.sin(k * 5) * 0.03);
          if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
          this.focus.copy(this.look);
        },
      },
      {
        name: 'drink', at: 25.2, dur: 6.0,
        enter: () => {
          this.slowTarget = 1;
          for (const l of this.loops) l.stop(0.6);
          this.loops = [];
          this.music?.setVolume(0.8, 0.5);
          this.chips.clearRain();
          P.forEach((a, i) => { this.holdProp(a, i % 2 ? makeGlass('beer') : makeBottle(['singha', 'leo', 'chang', 'sangsom'][a.slot! % 4]), i % 2 ? [0, 0, 0] : [-0.3, 0, 0]); anim(a, 'drink'); });
          this.dof = 1;
          this.sub(CASINO.drink, 3.2);
          play('cheers_glass_clink', { vol: 0.5 });
        },
        tick: (k) => {
          if (k > 0.4) once('drunk', () => P.forEach((a) => { anim(a, 'drunk'); face(a, 'drunk'); }));
          for (const id of ['h1', 'h2', 'h3']) {
            const at = { h1: 0.45, h2: 0.62, h3: 0.8 }[id]!;
            if (k > at) once(id, () => { play('hiccup', { vol: 0.8, pitch: 0.9 + Math.random() * 0.3 }); const a = P[Math.floor(Math.random() * n)]; if (a && Math.random() < 0.6) this.bubble(a, CASINO_SHOUTS[3]); });
          }
        },
        cam: (k) => {
          if (k < 0.32) this.shot(V(1.25, 0.98, 0.85), V(1.05, 0.95, 0.7), V(0.62, 0.9, 0.25), V(0.6, 0.9, 0.25), 32, 28)(k / 0.32);
          else {
            const q = (k - 0.32) / 0.68;
            this.shot(V(-0.6, 1.55, -1.25), V(0.5, 1.5, -1.3), V(0, 1.4, 1.0), V(0, 1.35, 1.0), 40, 44, Math.sin(q * 5) * 0.08 * q)(q);
          }
        },
      },
      {
        name: 'roulette', at: 31.2, dur: 7.0,
        enter: () => {
          this.slowTarget = 1;
          P.forEach((a, i) => {
            const x = R.x - 0.55 + (i - (n - 1) / 2) * 0.55 + 0.35;
            a.root.position.set(x, 0, R.z + 1.05);
            a.root.rotation.y = 0;
            this.holdProp(a, null);
            anim(a, 'drunk');
          });
          this.wheelW = 7; this.ballW = -11; this.ballR = 0.385; this.ballSettled = false;
          this.sub(CASINO.allin, 2.8);
          this.dof = 0;
        },
        tick: (k) => {
          const g = this.stacks.rouletteBank;
          if (!g.userData.from) g.userData.from = g.position.clone();
          g.position.lerpVectors(g.userData.from, V(R.x + 0.35, R.y, R.z + 0.05), smooth(0.05, 0.22, k));
          if (k > 0.08) once('push', () => { play('chips_clatter', { vol: 0.9 }); P.forEach((a) => anim(a, 'point', false)); });
          if (k > 0.3) once('spin', () => { play('roulette_spin', { vol: 1 }); this.loops.push(play('heartbeat_slow', { vol: 0.7 })); });
          if (k > 0.45) once('s6', () => this.sub(CASINO.spin, 3));
          if (k > 0.78) this.slowTarget = 0.4;
        },
        cam: (k) => {
          if (k < 0.28) this.shot(V(R.x + 1.9, 1.55, R.z - 1.3), V(R.x + 1.7, 1.5, R.z - 1.15), V(R.x - 0.2, 1.05, R.z + 0.8), V(R.x - 0.2, 1.1, R.z + 0.8), 46, 42)(k / 0.28);
          else this.shot(V(wc.x + 0.85, wc.y + 0.6, wc.z + 0.75), V(wc.x + 0.55, wc.y + 0.36, wc.z + 0.45), wc.clone().add(V(0.12, 0, 0.1)), wc.clone().add(V(0.18, 0, 0.14)), 32, 28)((k - 0.28) / 0.72);
          this.dof = k > 0.28 ? 1 : 0;
        },
      },
      {
        name: 'lose', at: 38.2, dur: 4.8,
        enter: () => {
          this.slowTarget = 1;
          for (const l of this.loops) l.stop(0.1);
          this.loops = [];
          play('record_scratch', { vol: 0.9 });
          const m = this.music;
          if (m) { m.setPitch(0.25, 0.9); setTimeout(() => m.stop(0.3), 900); }
          this.amb?.setVolume(0.25, 0.5);
          setTimeout(() => { if (this.ready) play('sad_trombone', { vol: 1 }); }, 650);
          P.forEach((a) => { anim(a, 'casino_despair'); face(a, 'shock'); });
          anim(this.croupier, 'wipe');
          this.sub(CASINO.lose, 3.6);
          this.dof = 0;
        },
        tick: (k) => {
          const g = this.stacks.rouletteBank;
          const from = V(R.x + 0.35, R.y, R.z + 0.05);
          g.position.lerpVectors(from, V(R.x + 0.4, R.y, R.z - 0.5), smooth(0.25, 0.7, k));
          g.scale.setScalar(1 - smooth(0.65, 0.85, k) * 0.999);
          if (k > 0.3) once('rake', () => { play('chips_clatter', { vol: 0.8, pitch: 0.8 }); play('crowd_aww', { vol: 0.6 }); });
        },
        cam: this.shot(V(R.x - 0.2, 1.6, R.z + 3.5), V(R.x - 0.1, 1.55, R.z + 3.2), V(R.x, 1.05, R.z + 0.4), V(R.x, 1.05, R.z + 0.4), 44, 44),
      },
      {
        name: 'black', at: 43.0, dur: 6.2,
        enter: () => {
          this.slowTarget = 0.7;
          P.forEach((a) => { anim(a, 'drunk'); face(a, 'drunk'); });
          this.dof = 1;
          this.sub(CASINO.black, 4.4);
        },
        tick: (k) => {
          if (k > 0.15) once('hic', () => play('hiccup', { vol: 1, pitch: 0.8 }));
          if (k > 0.55) once('hic2', () => play('hiccup', { vol: 0.7, pitch: 0.7 }));
          const post = this.game.engine.post;
          post.ca.offset.set(this.caBase.x + k * 0.012, this.caBase.y + k * 0.008); // double vision
          post.fade = smooth(0.5, 0.97, k);
          this.amb?.setVolume(0.25 * (1 - k), 0.2);
          if (k > 0.93) once('thud', () => play('body_thud', { vol: 0.9 }));
        },
        cam: (k) => {
          const a = P[0];
          const cam = this.camera;
          const eye = a.root.position.clone().add(V(0, 1.55 - k * 0.5, 0));
          cam.position.copy(eye);
          const ang = a.root.rotation.y + k * 2.4 + Math.sin(k * 7) * 0.15;
          this.look.set(eye.x - Math.sin(ang) * 2, eye.y + Math.sin(k * 5) * 0.2 - k * 0.4, eye.z - Math.cos(ang) * 2);
          cam.up.set(0, 1, 0);
          cam.lookAt(this.look);
          cam.rotateZ(Math.sin(k * 4) * 0.25 + k * 0.6);
          if (Math.abs(cam.fov - (44 + k * 20)) > 0.1) { cam.fov = 44 + k * 20; cam.updateProjectionMatrix(); }
          this.focus.copy(this.look).lerp(eye, 0.9);
        },
      },
    ];
    // the waitress strolls between the bar and the tables the whole time
    const wpath = [V(10, 0, 3), V(4, 0, 3.2), V(2.6, 0, -1.6), V(8.5, 0, -1.2)];
    let wi = 0;
    (this as any).walkWaitress = (dt: number) => {
      const to = wpath[(wi + 1) % wpath.length];
      const p = W.root.position;
      const d = to.clone().sub(p); d.y = 0;
      const L = d.length();
      if (L < 0.1) { wi = (wi + 1) % wpath.length; return; }
      const sp = 1.0;
      p.addScaledVector(d.normalize(), Math.min(L, sp * dt));
      W.root.rotation.y = yawTo(d.x, d.z);
      W.rig.setMove(sp);
    };
  }

  // ------------------------------------------------------------------ frame

  private frame(raw: number) {
    if (!this.ready) return;
    const game = this.game;
    raw = Math.min(raw, 0.1);
    // host publishes the clock; others catch up when behind
    if (game.isHost) {
      this.pubT += raw;
      if (this.pubT > 0.5) { this.pubT = 0; game.g.casinoT = Math.round(this.t * 10) / 10; }
    } else if ((game.g.casinoT ?? 0) > this.t + 1.5) this.t = game.g.casinoT;
    if (!this.done) this.t += raw;

    // slow motion (eased)
    this.slow += (this.slowTarget - this.slow) * (1 - Math.exp(-raw * 5));
    game.engine.timeScale = this.slow;
    Sound.timeScale = 0.6 + this.slow * 0.4;
    const dt = raw * this.slow;

    // beats (enter every beat we pass, even when jumping)
    let target = this.beats.length - 1;
    for (let i = 0; i < this.beats.length; i++) if (this.t < this.beats[i].at + this.beats[i].dur) { target = i; break; }
    while (this.bi < target) { this.bi++; try { this.beats[this.bi].enter?.(); } catch (e) { console.error('[intro] beat', e); } }
    const b = this.beats[this.bi];
    const k = clamp01((this.t - b.at) / b.dur);
    try { b.tick?.(k, dt, raw); } catch (e) { console.error('[intro] tick', e); }
    try { b.cam(k, this.t); } catch (e) { console.error('[intro] cam', e); }

    // camera shake (win)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - raw * 1.5);
      this.camera.position.add(V((Math.random() - 0.5) * 0.03 * this.shake, (Math.random() - 0.5) * 0.03 * this.shake, 0));
    }
    // depth of field follows the shot's focus
    const post = game.engine.post;
    if (this.dof > 0.5) {
      post.setDOF(true, Math.max(0.2, this.camera.position.distanceTo(this.focus)), b.name === 'black' ? 5 + k * 6 : 3.2);
    } else post.setDOF(false);

    // world
    this.set.update(this.t, dt);
    this.updateWheel(dt);
    this.chips.update(dt);
    this.parts.update(dt);
    (this as any).walkWaitress?.(dt);
    for (const a of [...this.players, ...this.extras]) a.rig.update(dt);

    // skip (hold Space / E)
    const holding = Input.isDown('Space') || Input.isDown('KeyE');
    this.skipHold = holding ? this.skipHold + raw : Math.max(0, this.skipHold - raw * 2);
    this.renderSkip();
    if (this.skipHold > 1.0 && !this.done) { this.skipHold = 0; this.requestSkip(); }

    if (this.t >= CASINO_LEN && !this.done) this.finish();
  }

  private updateWheel(dt: number) {
    const s = this.set;
    this.wheelW *= Math.exp(-dt * 0.18);
    s.wheel.rotation.y += this.wheelW * dt;
    if (!this.ballSettled) {
      this.ballW *= Math.exp(-dt * 0.42);
      this.ballA += this.ballW * dt;
      if (Math.abs(this.ballW) < 3.2) this.ballR = Math.max(0.31, this.ballR - dt * 0.12);
      if (Math.abs(this.ballW) < 1.6 && this.wheelW > 0) { this.ballSettled = true; this.ballA -= s.wheel.rotation.y; }
    }
    const a = this.ballSettled ? this.ballA + s.wheel.rotation.y : this.ballA;
    const bounce = !this.ballSettled && this.ballR < 0.36 ? Math.abs(Math.sin(this.ballA * 3)) * 0.012 : 0;
    s.ball.position.set(s.wheelCenter.x - ROULETTE.x + Math.cos(a) * this.ballR, s.wheelCenter.y - 0.06 + 0.03 + bounce, Math.sin(a) * this.ballR);
    s.ball.position.add(V(0, 0, 0));
    // ball lives in the roulette group (local to the table)
    s.ball.position.x = ROULETTE.wheelX + Math.cos(a) * this.ballR;
    s.ball.position.y = ROULETTE.y + 0.085 + bounce;
    s.ball.position.z = Math.sin(a) * this.ballR;
  }

  private bubble(a: Actor, text: { th: string; en?: string }) {
    const head = () => (a.rig.headWorld ? a.rig.headWorld(new THREE.Vector3()) : a.root.position.clone().add(V(0, 1.85, 0)));
    this.game.ui.shout(head, text, { duration: 1.6, scale: 0.8 });
  }

  // ------------------------------------------------------------------ skip & end

  private makeSkipHint() {
    const d = (this.skipEl = document.createElement('div'));
    d.style.cssText = `position:absolute;right:3.2vw;bottom:calc(9vh + 14px);display:flex;align-items:center;gap:10px;color:#f5ecd9;font:400 clamp(12px,1.05vw,15px) ${F.body};text-shadow:0 1px 3px #000;opacity:0;transition:opacity .5s;pointer-events:none`;
    d.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2.4"/><circle class="ring" cx="13" cy="13" r="10" fill="none" stroke="#f2d27a" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="62.8" stroke-dashoffset="62.8" transform="rotate(-90 13 13)"/></svg><span>${CASINO.skip} <kbd style="display:inline-block;padding:0 .4em;border:1px solid rgba(255,255,255,.55);border-bottom-width:2px;border-radius:4px;font:600 .9em ${F.ui};background:rgba(0,0,0,.35)">Space</kbd> ${CASINO.skipTail}<small class="votes" style="opacity:.75;margin-left:6px"></small></span>`;
    (Overlay.root ?? document.body).appendChild(d);
    setTimeout(() => { if (this.skipEl) this.skipEl.style.opacity = '0.8'; }, 1200);
    setTimeout(() => { if (this.skipEl && this.skipHold <= 0) this.skipEl.style.opacity = '0.35'; }, 7000);
  }

  private renderSkip() {
    const d = this.skipEl;
    if (!d) return;
    const ring = d.querySelector('.ring') as SVGCircleElement | null;
    if (ring) ring.setAttribute('stroke-dashoffset', String(62.8 * (1 - clamp01(this.skipHold / 1.0))));
    if (this.skipHold > 0) d.style.opacity = '1';
    const votes = (this.game.g.skipVotes ?? []) as number[];
    const v = d.querySelector('.votes') as HTMLElement | null;
    const np = this.game.players().length;
    if (v) v.textContent = votes.length && np > 1 ? `(${votes.length}/${np})` : '';
  }

  private requestSkip() {
    const game = this.game;
    if (game.isHost) this.finish();
    else game.intent('intro.skipCasino', {});
    play('whoosh_text', { vol: 0.5 });
  }

  /** HOST: end the cutscene for everyone. */
  finish() {
    const game = this.game;
    if (this.done) return;
    this.done = true;
    if (!game.isHost) return;
    game.engine.post.fade = 1;
    game.g.introStep = params.get('intro') ? undefined : 'wake';
    game.g.introT0 = game.g.time;
    game.setScene('world', 'intro');
  }
}

/** HOST intent: a client asked to skip. Everyone must agree (the host's own skip ends it at once). */
export function installCasinoIntents(game: Game, current: () => CasinoScene | null) {
  game.onIntent('intro.skipCasino', (pl) => {
    if (game.g.scene !== 'casino') return;
    const v: number[] = [...(game.g.skipVotes ?? [])];
    if (!v.includes(pl.id)) v.push(pl.id);
    game.g.skipVotes = v;
    const others = game.players().filter((p) => p.peer !== game.session.selfId);
    if (others.every((p) => v.includes(p.id))) current()?.finish();
  });
  if (params.has('casinolab')) console.info('[intro] casino lab');
}
