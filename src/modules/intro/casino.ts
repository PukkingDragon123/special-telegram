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
import { CASINO } from './lines';
import { CineCam, Menace, ScreenFX, CINE_LINES, SHOUT, animPicker, path } from './casino-cine';
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

export const CASINO_LEN = 54.2;

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
  private cine = new CineCam();
  private menace = new Menace();
  private fx: ScreenFX | null = null as any;
  private freezeUntil = -1;
  private posesAt: { a: Actor; t: number; pose: string; side: number; done?: boolean }[] = [];
  private walkWaitress: ((dt: number) => void) | null = null;

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
    s.add(this.menace.group);
    this.fx = new ScreenFX();
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
    Sound.preload(['casino_ambience_loop', 'casino_lounge', 'slowmo_whoosh', 'slowmo_dramatic', 'crowd_cheer', 'cheers_glass_clink', 'champagne_pop', 'chips_clatter', 'card_shuffle', 'heartbeat_slow', 'roulette_spin', 'slot_win', 'sad_trombone', 'record_scratch', 'hiccup', 'body_thud', 'wow_crowd', 'crowd_aww', 'lose_sting', 'bass_boom']);
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
    this.cine.restoreAll();
    this.menace.dispose();
    this.fx?.dispose(); this.fx = null;
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
    const x = Math.cos(a) * 1.7, z = -0.55 + Math.sin(a) * 1.66;
    return { p: V(x, 0, z), yaw: yawTo(-x, -0.55 - z) };
  }

  /** Where player i of n starts the night: in the corridor behind the archway, walking in. */
  private walkStart(i: number, n: number) { return V((i - (n - 1) / 2) * 0.66, 0, -16.2 + (i % 2) * 0.35); }

  private cast() {
    const game = this.game;
    const chars = game.chars;
    let pls = game.players();
    if (!pls.length) pls = [{ id: -1, slot: 0, look: null } as any];
    const n = pls.length;
    pls.forEach((pl: Ent, i: number) => {
      const slot = pl.slot ?? i;
      const base = pl.look ?? chars.playerLook(slot);
      const a = this.addActor(suitLook(base, slot), this.walkStart(i, n), Math.PI, 'idle', false);
      a.pid = pl.id; a.slot = slot;
      a.speed = 1.25;
      this.players.push(a);
    });
    const look = (arch: string, seed: number, over: any = {}) => ({ ...chars.randomLook(arch, seed), ...over });
    // dealer & croupier: dove-grey shirts (pure white blew out under the table spot), black slacks
    const staff = { top: { id: 'dress_shirt', color: '#c4beb2' }, bottom: { id: 'slacks', color: '#1d1d1f' }, shoes: { id: 'leather', color: '#1a1512' }, acc: [] };
    this.dealer = this.addActor(look('office_worker_f', 11, staff), V(0, 0, -1.05), Math.PI);
    this.croupier = this.addActor(look('office_worker_m', 23, staff), V(ROULETTE.x + 0.3, 0, ROULETTE.z - 1.0), Math.PI);
    // onlookers behind the players (well clear of the camera orbit around the table)
    this.addActor(look('karaoke_uncle', 5), V(-2.7, 0, 2.9), yawTo(2.7, -3.3), 'idle');
    this.addActor(look('auntie_vendor', 9, { top: { id: 'shirt_satin', color: '#a8202e' } }), V(2.6, 0, 3.0), yawTo(-2.6, -3.4), 'idle');
    // roulette regulars (ends of the table, facing it)
    this.addActor(look('gangster_lite', 31), V(ROULETTE.x - 1.85, 0, ROULETTE.z + 0.15), -Math.PI / 2 + 0.25, 'idle');
    this.addActor(look('tourist_backpacker', 41, { acc: [] }), V(ROULETTE.x + 2.05, 0, ROULETTE.z + 0.3), Math.PI / 2 - 0.3, 'idle');
    // slot players (seated on the machines' stools)
    for (const [idx, seed, arch] of [[2, 51, 'old_lady'], [5, 52, 'karaoke_uncle'], [10, 53, 'housewife']] as [number, number, string][]) {
      const s = SLOTS_POS[idx];
      if (!s) continue;
      const p = V(s.p[0] + Math.sin(s.yaw) * 0.95, 0, s.p[2] + Math.cos(s.yaw) * 0.95);
      const a = this.addActor(look(arch, seed), p, s.yaw, 'sit');   // facing the machine (they used to sit with their backs to it)
      a.rig.setPosture?.('sit');
      a.rig.seat = 0.66;
    }
    this.addActor(look('security_guard', 61), V(3.9, 0, -11.2), 0.2, 'stand_cool');
    this.waitress = this.addActor(look('office_worker_f', 71, { top: { id: 'blouse_office', color: '#1d1d1f' }, bottom: { id: 'skirt', color: '#1d1d1f' } }), V(10, 0, 3), -Math.PI / 2);
    const tray = makeBottle('champagne');
    tray.rotation.set(-0.15, 0, 0); tray.position.set(0, -0.04, 0.02);
    this.waitress.rig.attach('hand_r').add(tray);
  }

  private props() {
    // pot & bets
    const st = this.stacks;
    st.pot1 = this.chips.stack(V(-0.28, TABLE_Y + 0.03, -0.42), 14, 1, 3);
    st.pot2 = this.chips.stack(V(0.18, TABLE_Y + 0.03, -0.42), 12, 0, 3);
    const n = this.players.length;
    this.players.forEach((_, i) => {
      // in front of the player's table spot (they only walk up to it later)
      const sp = this.tableSpot(i, n).p;
      st['bet' + i] = this.chips.stack(V(sp.x * 0.68, TABLE_Y, -0.55 + (sp.z + 0.55) * 0.68), 6 + i * 2, (i + 2) % 4, 1);
    });
    st.rouletteBank = this.chips.stack(V(ROULETTE.x + 0.95, ROULETTE.y, ROULETTE.z - 0.45), 16, 3, 6);
    // two cards face down in front of the dealer
    for (let i = 0; i < 2; i++) {
      const c = makeCard(i);
      c.position.set(-0.05 + i * 0.075, TABLE_Y + 0.002, -0.1);
      c.rotation.set(0, 0.06 * (i ? 1 : -1), Math.PI);
      this.scene.add(c);
      this.cards.push(c);
    }
    // drinks on the table (on the felt, clear of the arm rail)
    const drinks = new THREE.Group();
    drinks.position.set(0.66, TABLE_Y, 0.12);
    const kinds = ['singha', 'chang', 'sangsom', 'wine', 'leo'];
    kinds.forEach((k, i) => { const b = makeBottle(k); b.position.set((i % 3) * 0.1 - 0.1, 0, Math.floor(i / 3) * 0.1); b.rotation.y = 0.4 + i; drinks.add(b); });
    const g1 = makeGlass('beer'); g1.position.set(-0.25, 0, 0.05); drinks.add(g1);
    const g2 = makeGlass('wine'); g2.position.set(-0.2, 0, 0.16); drinks.add(g2);
    drinks.rotation.y = -0.5;
    this.scene.add(drinks);
  }

  /** Put a prop in the right hand. Bottles/glasses are authored base-down: tip them so they sit in a fist. */
  private holdProp(a: Actor | undefined, obj: THREE.Object3D | null, rot: [number, number, number] = [0, 0, 0], off: [number, number, number] = [0, -0.06, 0.03]) {
    if (!a) return;
    for (const p of a.props) p.removeFromParent();
    a.props = [];
    if (!obj) return;
    obj.rotation.set(...rot);
    obj.position.set(...off);
    a.rig.attach('hand_r').add(obj);
    a.props.push(obj);
  }

  // ------------------------------------------------------------------ helpers

  private shot(from: THREE.Vector3, to: THREE.Vector3, lookA: THREE.Vector3, lookB: THREE.Vector3, fovA = 42, fovB = fovA, roll = 0, e = ease) {
    const cam = this.camera;
    return (k: number) => {
      const q = e(clamp01(k));
      cam.position.lerpVectors(from, to, q);
      this.look.lerpVectors(lookA, lookB, q);
      this.aim(lerp(fovA, fovB, q), roll);
    };
  }

  /** Point the camera at this.look with a fov and roll (called by every shot every frame). */
  private aim(fov: number, roll = 0) {
    const cam = this.camera;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (roll) cam.rotateZ(roll);
    cam.fov = fov; cam.updateProjectionMatrix();
    this.focus.copy(this.look);
  }

  /** A cut inside a beat: sub-shots over k ranges. */
  private cuts(list: [number, (k: number) => void][]) {
    return (k: number) => {
      for (let i = list.length - 1; i >= 0; i--) if (k >= list[i][0]) { const a = list[i][0], b = list[i + 1]?.[0] ?? 1; list[i][1]((k - a) / Math.max(1e-4, b - a)); return; }
    };
  }

  private sub(t: { th: string; en?: string }, sec = 3.2) { Overlay.subtitle(t.th, t.en, sec); }

  private center() {
    const c = V(0, 0, 0);
    for (const a of this.players) c.add(a.root.position);
    return c.multiplyScalar(1 / Math.max(1, this.players.length));
  }

  private head(a: Actor, out = new THREE.Vector3()) {
    return a.rig.headWorld ? a.rig.headWorld(out) : out.copy(a.root.position).add(V(0, 1.62, 0));
  }

  private expr(a: Actor | undefined, e: string, hold?: number) { try { a?.rig.setExpression?.(e, hold ? { hold } : undefined); } catch {} }

  /** Hard freeze frame (animation time stops; the cutscene clock keeps running). */
  private freeze(sec: number) { this.freezeUntil = this.t + sec; this.slow = 0.012; }

  private buildBeats() {
    const P = this.players;
    const n = P.length;
    const W = this.waitress;
    const fired = new Set<string>();
    const once = (id: string, fn: () => void) => { if (!fired.has(id)) { fired.add(id); fn(); } };
    const pick = animPicker((this.game.chars as any).anims?.());
    const anim = (a: Actor, name: string, loop = true, fade = 0.3) => a?.rig.play(name as any, { loop, fade });
    const face = (a: Actor, f: string | null) => a?.rig.setFace?.(f as any);
    const R = ROULETTE;
    const wc = this.set.wheelCenter;
    const cine = this.cine;
    const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const shoutAt = (a: Actor | undefined, lines: { th: string; en?: string }[]) => { if (a) this.bubble(a, rnd(lines)); };
    // walking in (open + walk beats): straight through the archway, the last guy stumbles on the carpet edge
    const walkIn = (dt: number, k: number, beat: 'open' | 'walk') => {
      P.forEach((a, i) => {
        const tripper = beat === 'walk' && i === n - 1 && n > 1;
        if (tripper && k > 0.42) once('trip', () => {
          anim(a, pick('get_slapped'), false, 0.06); a.speed = 0.25; play('body_thud', { vol: 0.5, pitch: 1.3 });
          this.expr(a, 'shocked', 1.2); cine.snap(0.78, 0.5); shoutAt(a, SHOUT.trip);
        });
        if (tripper && k > 0.6) once('trip2', () => { anim(a, 'idle', true, 0.35); a.speed = 1.55; });
        const sp = a.speed;
        a.root.position.z += sp * dt;
        a.root.rotation.y = Math.PI;
        a.rig.setMove(sp);
      });
    };

    this.beats = [
      {
        name: 'open', at: 0, dur: 4.6,
        enter: () => { this.slowTarget = 1; this.dof = 0; cine.handheld = 0.15; P.forEach((a) => anim(a, 'idle')); },
        tick: (k, dt) => { walkIn(dt, k, 'open'); if (k > 0.12) once('s0', () => this.sub(CINE_LINES.open, 3.6)); },
        // crane down from the coffers to the archway the guys are walking through
        cam: (k) => {
          const q = ease(k);
          const pth = path([V(-6.2, 4.3, 7.5), V(-4.6, 3.1, 5.4), V(-2.6, 1.9, 3.6), V(-1.6, 1.45, 2.4)]);
          pth(q, this.camera.position);
          this.look.lerpVectors(V(0, 3.4, -9), V(0, 1.2, -8.5), q);
          this.aim(lerp(48, 34, q));
        },
      },
      {
        name: 'walk', at: 4.6, dur: 4.4,
        enter: () => {
          this.dof = 1; cine.handheld = 0.4;
          // late peers / jumps: start the walk where the open beat would have left them
          if (this.center().z < -11.5) P.forEach((a, i) => { a.root.position.z = this.walkStart(i, n).z + 5.75; });
        },
        tick: (k, dt) => {
          if (k > 0.06) { this.slowTarget = 0.5; once('w0', () => { play('slowmo_whoosh', { vol: 0.7 }); this.sub(CINE_LINES.walk(n), 3.4); }); }
          walkIn(dt, k, 'walk');
        },
        // low tracking hero shot, walking backwards in front of them
        cam: (k) => {
          const c = this.center();
          this.camera.position.set(c.x + 0.35, 0.5 + k * 0.08, c.z + 3.1 - k * 0.25);
          this.look.set(c.x, 1.3, c.z);
          this.aim(lerp(40, 34, ease(k)));
        },
      },
      {
        // homage to the dramatic "standing pose" panels of 80s/90s action manga
        name: 'pose', at: 9.0, dur: 3.8,
        enter: () => {
          this.slowTarget = 1;
          const POSES = ['cine_point', 'cine_twist', 'cine_lean', 'cine_menace'];
          const FALL = ['point', 'stand_cool', 'celebrate', 'angry'];
          P.forEach((a) => { a.speed = 0; a.rig.setMove(0); });
          // line up (tiny corrections only — they were already walking in a row; snap if we jumped here)
          const c = this.center();
          if (Math.abs(c.z + 7.4) > 0.9) c.z = -7.4;
          P.forEach((a, i) => { a.root.position.x = c.x + (i - (n - 1) / 2) * 0.72; a.root.position.z = c.z + (i % 2 ? 0.25 : -0.1); a.root.rotation.y = Math.PI + (i - (n - 1) / 2) * 0.12; });
          this.fx.flash(0.16);
          this.fx.duotone(true);
          this.fx.focusLines(true, 'focus');
          play('bass_boom', { vol: 0.9 }); play('slowmo_whoosh', { vol: 0.6, pitch: 0.8 });
          this.music?.setVolume(0.3, 0.3);
          P.forEach((a, i) => {
            const s = (a.slot ?? i) % 4;
            this.posesAt.push({ a, t: 0.12 + i * 0.13, pose: pick(POSES[s], FALL[s]), side: i < n / 2 ? -1 : 1 });
          });
          cine.dutch(-0.16);
          cine.handheld = 0.2;
          this.dof = 0;
        },
        tick: (k) => {
          for (const p of this.posesAt) {
            if (k >= p.t && !p.done) {
              p.done = true;
              anim(p.a, p.pose, true, 0.12);
              this.expr(p.a, 'smug');
              cine.snap(0.86, 0.42);
              play('bass_boom', { vol: 0.45, pitch: 1.4 });
              const a = p.a;
              const tmp = new THREE.Vector3();
              this.menace.emit(() => this.head(a, tmp).clone().add(V(0, 0.1, 0)), p.a.slot! % 2 ? 'do' : 'go', 2.6, p.side);
            }
          }
          if (k > 0.55) once('poseSub', () => { this.sub(CINE_LINES.poseN(n), 2.4); cine.crash(0.8, 1.4, 0.35); });
          if (k > 0.93) once('poseEnd', () => { this.menace.stop(); this.fx.flash(0.12); });
        },
        // worm's-eye low angle, dutch tilt, slow push
        cam: (k) => {
          const c = this.center();
          this.camera.position.set(c.x + 0.25 - k * 0.3, 0.4, c.z + 3.9 - k * 0.45);
          this.look.set(c.x, 1.32, c.z);
          this.aim(lerp(48, 42, ease(k)));
          this.focus.set(c.x, 1.4, c.z);
        },
      },
      {
        name: 'bet', at: 12.8, dur: 5.2,
        enter: () => {
          this.slowTarget = 1;
          this.fx.duotone(false); this.fx.focusLines(false);
          this.menace.clear();
          cine.dutch(0); cine.handheld = 0.3;
          this.music?.setVolume(0.8, 0.6);
          P.forEach((a, i) => { const sp = this.tableSpot(i, n); a.root.position.copy(sp.p); a.root.rotation.y = sp.yaw; a.speed = 0; a.rig.setMove(0); anim(a, 'idle', true, 0.4); this.expr(a, 'determined'); });
          play('card_shuffle', { vol: 0.7 });
          this.loops.push(play('heartbeat_slow', { vol: 0.8 }));
          this.dof = 1;
          cine.pushIn(0.16, 1.8);
        },
        tick: (k) => {
          once('s2', () => this.sub(CINE_LINES.bet, 3.4));
          // bets slide into the circles
          P.forEach((_, i) => {
            const g = this.stacks['bet' + i];
            if (!g) return;
            if (!g.userData.from) g.userData.from = g.position.clone();
            const to = g.userData.from.clone().lerp(V(0, TABLE_Y, -0.55), 0.18);
            g.position.lerpVectors(g.userData.from, to, smooth(0.05, 0.28, k));
          });
          if (k > 0.1) once('chip', () => play('chips_clatter', { vol: 0.7 }));
          const flip = (c: THREE.Group, a: number, b: number) => {
            const q = smooth(a, b, k);
            c.rotation.z = Math.PI * (1 - q);
            c.position.y = TABLE_Y + 0.002 + Math.sin(Math.PI * q) * 0.07;
          };
          flip(this.cards[0], 0.36, 0.5);
          if (k > 0.36) once('f1', () => { play('card_shuffle', { vol: 0.4, pitch: 1.6 }); anim(this.dealer, 'give', false); cine.pushIn(0, 0.1); });
          if (k > 0.6) { this.slowTarget = 0.35; once('f2', () => { play('slowmo_whoosh', { vol: 0.5, pitch: 1.2 }); anim(this.dealer, 'give', false); cine.pushIn(0.28, 2.2); }); }
          flip(this.cards[1], 0.64, 0.95);
          if (k > 0.95) once('ace', () => cine.snap(0.75, 0.4));
        },
        cam: this.cuts([
          // over the OUTER shoulder of the end guy (away from his mates): the dealer's hands, slow push
          [0, (q) => {
            const a = P[0], y = a.root.rotation.y;
            const f = V(-Math.sin(y), 0, -Math.cos(y)), r = V(-f.z, 0, f.x);
            const out = n > 1 && a.root.position.x < 0 ? -1 : 1;   // P[0] is the leftmost guy: his left shoulder
            this.camera.position.copy(a.root.position).addScaledVector(f, -0.9 + q * 0.12).addScaledVector(r, 0.4 * out).add(V(0, 1.8 - q * 0.05, 0));
            this.look.set(0, 0.95, -0.4);
            this.aim(38);
            this.focus.set(0, 1.0, -0.6);
          }],
          // overhead on the felt: the cards dead centre
          [0.32, this.shot(V(0.03, 1.5, 0.02), V(0.0, 1.3, -0.04), V(-0.01, TABLE_Y, -0.09), V(-0.01, TABLE_Y, -0.1), 34, 30, 0.12)],
          // card-level extreme close-up
          [0.58, this.shot(V(0.42, 0.9, 0.42), V(0.3, 0.86, 0.3), V(0.0, 0.8, -0.1), V(0.03, 0.79, -0.1), 30, 26)],
        ]),
      },
      {
        name: 'win', at: 18.0, dur: 3.0,
        enter: () => {
          this.slowTarget = 1;
          for (const l of this.loops) l.stop(0.3);
          this.loops = [];
          play('crowd_cheer', { vol: 1 }); play('slot_win', { vol: 0.7 }); play('bass_boom', { vol: 0.5 });
          P.forEach((a) => { anim(a, 'casino_cheer', true, 0.12); this.expr(a, 'laugh'); });
          this.extras.forEach((a, i) => { if (a !== this.dealer && a !== this.croupier && a !== W && i < 4) anim(a, 'celebrate'); });
          this.chips.burst(V(0, TABLE_Y + 0.15, -0.2), 70, 4.6, 2.2);   // behind the lens: they arc over it into the shot
          cine.crash(0.6, 1.1, 0.9);
          this.dof = 0;
          this.sub(CINE_LINES.win, 2.8);
          P.forEach((a, i) => { if (i < 2) setTimeout(() => { if (this.ready) shoutAt(a, SHOUT.win); }, 150 + i * 650); });
        },
        tick: (k) => {
          // the dealer pushes the pot to the players
          const to = V(0, TABLE_Y, 0.35);
          for (const id of ['pot1', 'pot2']) { const g = this.stacks[id]; if (!g.userData.from) g.userData.from = g.position.clone(); g.position.lerpVectors(g.userData.from, to.clone().add(V(id === 'pot1' ? -0.15 : 0.15, 0, 0)), smooth(0.1, 0.6, k)); }
          if (k > 0.1) once('dealerGive', () => anim(this.dealer, 'give', false));
        },
        // worm's-eye from the felt: chips explode past the lens
        cam: (k) => {
          const c = this.center();
          this.camera.position.set(lerp(-0.12, 0.12, k), TABLE_Y + 0.14 + k * 0.05, 0.08);
          this.look.set(c.x, 1.58, c.z);
          this.aim(58);
        },
      },
      {
        name: 'slowmo', at: 21.0, dur: 8.0,
        enter: () => {
          this.slowTarget = 0.22;
          play('slowmo_whoosh', { vol: 0.9 });
          this.music?.setVolume(0.0, 0.8);
          this.loops.push(Sound.play(key('slowmo_dramatic'), { loop: true, bus: 'music', vol: 0.85, offset: 0 }));
          const c = this.center();
          this.parts.confetti(V(c.x, 0, c.z - 0.4), 280, 2.4, 2.8);
          this.chips.burst(V(0, TABLE_Y + 0.2, 0.4), 80, 5.2, 2.6);
          this.holdProp(P[0], makeBottle('champagne'), [0.2, 0, 0]);
          this.holdProp(P[1], makeGlass('beer'));
          this.holdProp(P[2], makeGlass('wine'));
          if (P[3]) this.holdProp(P[3], makeBottle('chang'), [0.1, 0, 0]);
          if (n > 2) anim(P[2], 'dance');
          this.dof = 1;
          cine.handheld = 0.25;
        },
        tick: (k) => {
          if (k > 0.05) once('pop', () => {
            play('champagne_pop', { vol: 1 });
            const a = P[0];
            const p = a.rig.attach('hand_r').getWorldPosition(new THREE.Vector3()).add(V(0, 0.32, 0));
            this.parts.spray(p, V(Math.sin(a.root.rotation.y + Math.PI) * 0.6, 1.4, Math.cos(a.root.rotation.y + Math.PI) * 0.6), 120, 3.2, 0xfff1c8);
            cine.snap(0.82, 0.6);
          });
          if (k > 0.2) once('s4', () => this.sub(CINE_LINES.slowmo, 4.2));
          // turn in toward each other for the toast
          const c = this.center(); c.z -= 0.55;
          P.forEach((a, i) => {
            const sp = this.tableSpot(i, n);
            const want = yawTo(c.x - a.root.position.x, c.z - a.root.position.z);
            let d = want - sp.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
            a.root.rotation.y = sp.yaw + d * smooth(0.3, 0.5, k);
          });
          if (k > 0.5) once('clink', () => {
            play('cheers_glass_clink', { vol: 1 });
            const c2 = this.center();
            this.parts.spray(V(c2.x, 1.75, c2.z - 0.2), V(0, 1, 0), 60, 1.6, 0xd8a038);
            P.forEach((a, i) => { if (i !== 2 || n <= 2) anim(a, 'celebrate'); });
          });
          if (k > 0.72) once('wow', () => play('wow_crowd', { vol: 0.6 }));
        },
        // slow orbit over the felt, facing the guys (they face the table)
        cam: (k) => {
          const c = this.center();
          const ang = lerp(-0.18 * Math.PI, -0.82 * Math.PI, ease(k));
          const r = 1.75 - k * 0.3;
          this.camera.position.set(c.x + Math.cos(ang) * r, 1.42 + Math.sin(k * 3) * 0.06, c.z - 0.1 + Math.sin(ang) * r);
          this.look.set(c.x, 1.45, c.z - 0.05);
          this.aim(42, Math.sin(k * 5) * 0.025);
        },
      },
      {
        name: 'drink', at: 29.0, dur: 6.0,
        enter: () => {
          this.slowTarget = 1;
          for (const l of this.loops) l.stop(0.6);
          this.loops = [];
          this.music?.setVolume(0.8, 0.5);
          this.chips.clearRain();
          P.forEach((a, i) => {
            const sp = this.tableSpot(i, n); a.root.rotation.y = sp.yaw;
            this.holdProp(a, i % 2 ? makeGlass('beer') : makeBottle(['singha', 'leo', 'chang', 'sangsom'][a.slot! % 4]), i % 2 ? [0, 0, 0] : [0.1, 0, 0]);
            anim(a, 'drink');
          });
          this.dof = 1;
          P.forEach((a) => { face(a, 'drunk'); this.expr(a, 'drunk'); }); // while the camera is on the bottles
          this.sub(CINE_LINES.drink, 3.2);
          play('cheers_glass_clink', { vol: 0.5 });
        },
        tick: (k) => {
          if (k > 0.4) once('drunk', () => P.forEach((a) => anim(a, 'drunk')));
          for (const id of ['h1', 'h2', 'h3']) {
            const at = { h1: 0.45, h2: 0.62, h3: 0.8 }[id]!;
            if (k > at) once(id, () => {
              play('hiccup', { vol: 0.8, pitch: 0.9 + Math.random() * 0.3 });
              const a = P[Math.floor(Math.random() * n)];
              if (a && Math.random() < 0.75) shoutAt(a, SHOUT.drink);
              cine.snap(0.88, 0.35);
            });
          }
        },
        cam: this.cuts([
          [0, this.shot(V(1.2, 0.98, 0.72), V(1.02, 0.95, 0.6), V(0.58, 0.9, 0.15), V(0.56, 0.9, 0.15), 32, 28)],
          // in front of the dealer, over the felt: the whole drunk row, swaying
          [0.32, (q) => {
            this.shot(V(-0.7, 1.5, -0.45), V(0.6, 1.48, -0.5), V(0, 1.4, 1.0), V(0, 1.35, 1.0), 44, 46, Math.sin(q * 5) * 0.08 * q)(q);
          }],
        ]),
      },
      {
        name: 'roulette', at: 35.0, dur: 7.0,
        enter: () => {
          this.slowTarget = 1;
          P.forEach((a, i) => {
            const x = R.x + 0.05 + (i - (n - 1) / 2) * 0.6;
            a.root.position.set(x, 0, R.z + 1.08);
            a.root.rotation.y = 0;
            this.holdProp(a, null);
            anim(a, 'drunk');
          });
          this.wheelW = 7; this.ballW = -11; this.ballR = 0.385; this.ballSettled = false;
          this.sub(CINE_LINES.allin, 2.8);
          this.dof = 0;
          cine.handheld = 0.35;
          shoutAt(P[0], SHOUT.allin);
        },
        tick: (k) => {
          const g = this.stacks.rouletteBank;
          if (!g.userData.from) g.userData.from = g.position.clone();
          g.position.lerpVectors(g.userData.from, V(R.x + 0.35, R.y, R.z + 0.05), smooth(0.05, 0.22, k));
          if (k > 0.08) once('push', () => { play('chips_clatter', { vol: 0.9 }); P.forEach((a) => anim(a, 'point', false)); });
          if (k > 0.26) once('spin', () => { play('roulette_spin', { vol: 1 }); this.loops.push(play('heartbeat_slow', { vol: 0.7 })); cine.pushIn(0.2, 3.2); });
          if (k > 0.45) once('s6', () => this.sub(CINE_LINES.spin, 3));
          if (k > 0.5) once('preshock', () => { P.forEach((a) => { face(a, 'shock'); this.expr(a, 'scared'); }); shoutAt(P[n - 1], SHOUT.spin); cine.pushIn(0.22, 1.2); });
          if (k > 0.64) once('wheel2', () => cine.pushIn(0.3, 2.4));
          if (k > 0.78) this.slowTarget = 0.4;
        },
        cam: this.cuts([
          // from the croupier's side: the guys shove everything in
          [0, this.shot(V(R.x + 1.7, 1.6, R.z - 1.45), V(R.x + 1.5, 1.55, R.z - 1.3), V(R.x - 0.1, 1.2, R.z + 1.0), V(R.x - 0.1, 1.2, R.z + 1.0), 46, 42)],
          // the wheel
          [0.26, this.shot(V(wc.x + 0.85, wc.y + 0.6, wc.z + 0.75), V(wc.x + 0.7, wc.y + 0.5, wc.z + 0.62), wc.clone().add(V(0.12, 0, 0.1)), wc.clone().add(V(0.15, 0, 0.12)), 34, 32)],
          // sweaty faces, slow pan along the row
          [0.5, (q) => {
            const xs = P.map((a) => a.root.position.x);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const x = lerp(x0, x1, q);
            this.camera.position.set(x + 0.15, 1.48, R.z + 0.15);
            this.look.set(x, 1.5, R.z + 1.08);
            this.aim(n > 1 ? 46 : 42);
          }],
          // the ball slowing down
          [0.64, this.shot(V(wc.x + 0.55, wc.y + 0.36, wc.z + 0.45), V(wc.x + 0.42, wc.y + 0.3, wc.z + 0.36), wc.clone().add(V(0.15, 0, 0.12)), wc.clone().add(V(0.18, 0, 0.14)), 30, 28)],
        ]),
      },
      {
        name: 'lose', at: 42.0, dur: 6.0,
        enter: () => {
          for (const l of this.loops) l.stop(0.1);
          this.loops = [];
          // freeze frame: record scratch, sepia, the "to be continued" arrow
          play('record_scratch', { vol: 0.9 });
          this.freeze(2.3);
          this.slowTarget = 1;
          this.fx.flash(0.1);
          this.fx.sepiaFreeze(true);
          cine.handheld = 0;
          const m = this.music;
          if (m) { m.setPitch(0.25, 0.9); setTimeout(() => m.stop(0.3), 900); }
          this.amb?.setVolume(0.25, 0.5);
          this.sub(CINE_LINES.tbcIntro, 2.2);
          this.dof = 0;
        },
        tick: (k) => {
          const after = 2.3 / 6.0;
          if (k > after) once('unfreeze', () => {
            this.fx.sepiaFreeze(false);
            this.fx.flash(0.1);
            cine.handheld = 0.45;
            cine.crash(0.66, 1.2, 0.7);
            play('sad_trombone', { vol: 1 });
            P.forEach((a) => { anim(a, 'casino_despair', true, 0.15); face(a, 'shock'); this.expr(a, 'shocked'); });
            anim(this.croupier, 'wipe');
            this.sub(CINE_LINES.lose, 3.2);
            P.forEach((a, i) => { if (i < 3) setTimeout(() => { if (this.ready) shoutAt(a, [SHOUT.lose[(i + 0) % SHOUT.lose.length]]); }, 120 + i * 500); });
          });
          if (k > after + 0.25) once('sad', () => P.forEach((a) => this.expr(a, 'sad')));
          const kk = clamp01((k - after) / (1 - after));
          const g = this.stacks.rouletteBank;
          const from = V(R.x + 0.35, R.y, R.z + 0.05);
          g.position.lerpVectors(from, V(R.x + 0.4, R.y, R.z - 0.5), smooth(0.25, 0.7, kk));
          g.scale.setScalar(1 - smooth(0.65, 0.85, kk) * 0.999);
          if (kk > 0.3) once('rake', () => { play('chips_clatter', { vol: 0.8, pitch: 0.8 }); play('crowd_aww', { vol: 0.6 }); });
        },
        // across the table from the croupier's side: faces + the wheel in the foreground
        cam: (k) => {
          const c = this.center();
          this.camera.position.set(R.x - 0.75 + k * 0.1, 1.58, R.z - 1.55);
          this.look.set(c.x - 0.2, 1.25, c.z);
          this.aim(40);
        },
      },
      {
        name: 'black', at: 48.0, dur: 6.2,
        enter: () => {
          this.slowTarget = 0.7;
          P.forEach((a) => { anim(a, 'drunk'); face(a, 'drunk'); this.expr(a, 'drunk'); });
          this.dof = 1;
          cine.handheld = 0;
          this.sub(CINE_LINES.black, 4.4);
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
        // drunk POV of the first guy (his own body is hidden by the lens check)
        cam: (k) => {
          const a = P[0];
          const cam = this.camera;
          const eye = a.root.position.clone().add(V(0, 1.55 - k * 0.5, 0));
          const fw = V(-Math.sin(a.root.rotation.y), 0, -Math.cos(a.root.rotation.y));
          cam.position.copy(eye).addScaledVector(fw, 0.12);
          const ang = a.root.rotation.y + k * 2.4 + Math.sin(k * 7) * 0.15;
          this.look.set(eye.x - Math.sin(ang) * 2, eye.y + Math.sin(k * 5) * 0.2 - k * 0.4, eye.z - Math.cos(ang) * 2);
          this.aim(44 + k * 20, Math.sin(k * 4) * 0.25 + k * 0.6);
          this.focus.copy(this.look).lerp(eye, 0.9);
        },
      },
    ];
    // the waitress strolls between the bar and the tables the whole time (around the tables, not through them)
    const wpath = [V(10, 0, 3), V(4.2, 0, 3.4), V(2.7, 0, -1.5), V(8.6, 0, -1.25)];
    let wi = 0;
    let wyaw = W.root.rotation.y;
    this.walkWaitress = (dt: number) => {
      const to = wpath[(wi + 1) % wpath.length];
      const p = W.root.position;
      const d = to.clone().sub(p); d.y = 0;
      const L = d.length();
      if (L < 0.1) { wi = (wi + 1) % wpath.length; return; }
      const sp = 1.0;
      p.addScaledVector(d.normalize(), Math.min(L, sp * dt));
      // turn smoothly at the corners instead of snapping
      const want = yawTo(d.x, d.z);
      let dy = want - wyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      wyaw += dy * Math.min(1, dt * 4);
      W.root.rotation.y = wyaw;
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

    // slow motion (eased); freeze frames override it
    if (this.t < this.freezeUntil) this.slow = 0.012;
    else this.slow += (this.slowTarget - this.slow) * (1 - Math.exp(-raw * 5));
    game.engine.timeScale = this.slow;
    Sound.timeScale = 0.6 + Math.max(0.2, this.slow) * 0.4;
    const dt = raw * this.slow;

    // beats (enter every beat we pass, even when jumping)
    let target = this.beats.length - 1;
    for (let i = 0; i < this.beats.length; i++) if (this.t < this.beats[i].at + this.beats[i].dur) { target = i; break; }
    while (this.bi < target) {
      this.bi++;
      this.cine.clear();
      try { this.beats[this.bi].enter?.(); } catch (e) { console.error('[intro] beat', e); }
    }
    const b = this.beats[this.bi];
    const k = clamp01((this.t - b.at) / b.dur);
    try { b.tick?.(k, dt, raw); } catch (e) { console.error('[intro] tick', e); }
    try { b.cam(k, this.t); } catch (e) { console.error('[intro] cam', e); }
    // camera post: crash/snap zooms, push-ins, handheld, dutch; then hide whoever blocks the lens
    this.cine.apply(this.camera, raw);
    this.camera.updateMatrixWorld();
    this.cine.cheat(this.camera, this.look, [...this.players, ...this.extras], new Set(b.name === 'black' ? [] : this.players.map((a) => a.root)));

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
    this.walkWaitress?.(dt);
    for (const a of [...this.players, ...this.extras]) a.rig.update(dt);
    this.menace.update(raw, this.camera);
    this.fx.update(raw);

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
