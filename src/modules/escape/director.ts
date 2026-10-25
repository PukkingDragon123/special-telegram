import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig, Look } from '../../game/contracts';
import { Sound, SoundHandle } from '../../core/audio';
import { Input } from '../../core/input';
import { Overlay } from '../../ui3d/overlay';
import type { TL } from '../../core/util';
import { yawTo } from '../../game/mapplan';
import { G } from '../../sim/physics';
import { EdgeHit, edgeAt, insideDist, posterSpots } from './zones';
import { HideSpots, HideSpot } from './hides';
import { Police } from './police';
import { PosterArt, PosterPole, renderMugshot } from './poster';
import * as LINES from './lines';
import { sk, pick, clamp01, smooth, easeOut, easeInOut, lerp } from './util';

/* ============================================================================================
 * "WANTED" — the cinematic that replaces the invisible wall at the map edges.
 * Local to the player who walks into an edge zone; everyone else just sees that player run, crouch
 * and hide (replicated p / yaw + an `escape.state` intent that sets mode/anim on the host).
 *
 * Full version (~15 s): freeze → letterbox + record-scratch music drop → a police pickup rolls up with
 * its light bar flashing (real red/blue light) → push-in on the หมายจับ poster (the player's own
 * mugshot) → "ตำรวจ!!" → the hero dives into the nearest hiding place (crates / blue drum / trash
 * bags / behind a parked pickup) → two officers sweep a real SpotLight flashlight over it, chat about
 * noodles, leave → peek, sigh of relief → walk back in and blend to first person facing inward.
 * Short version (tried again within REPEAT_S): far whistle, duck, back in (~4 s).
 * Skippable with Esc / click after the first full viewing. Watchdog + abort paths: never soft-locks.
 * ========================================================================================== */

const SEEN_KEY = 'hp.escape.seen';
const REPEAT_S = 75;
const UP = new THREE.Vector3(0, 1, 0);

type HideMode = 'crouch' | 'drum' | 'trash';

interface Path { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number }

interface Cine {
  short: boolean;
  t: number;
  hit: EdgeHit;
  spot: HideSpot | null;
  mode: HideMode;
  A: THREE.Vector3;          // start (ground)
  run: THREE.Vector3;        // where the run ends (ground)
  H: THREE.Vector3;          // hidden position (ground)
  ret: THREE.Vector3;        // return point (ground, walkable)
  retYaw: number;
  outYaw: number;            // facing the edge
  side: number;              // camera side along t (open side)
  runDur: number;
  tHide: number;             // time the hero is hidden (cops shot starts)
  fired: Set<string>;
  prevMusic: string;
  snd: SoundHandle[];
  sneaky: SoundHandle | null;
  heart: SoundHandle | null;
  siren: SoundHandle | null;
  truckFrom: THREE.Vector3; truckStop: THREE.Vector3; truckAway: THREE.Vector3; truckYaw: number;
  cops: { a: THREE.Vector3; b: THREE.Vector3; home: THREE.Vector3 }[];
  copPaths: (Path | null)[];
  copStep: number[];
  lines: { gasp: TL; suspect: TL; dismiss: TL; agree: TL; relief: TL; again: TL };
  camPos: THREE.Vector3; camLook: THREE.Vector3; camFov: number; camRoll: number;
  blendFrom: { p: THREE.Vector3; q: THREE.Quaternion; fov: number } | null;
  skippable: boolean;
  actorY: number;            // extra vertical offset (drum)
  walkFrom: THREE.Vector3 | null;
}

export class EscapeDirector {
  readonly root = new THREE.Group();
  readonly hides: HideSpots;
  readonly police: Police;
  readonly art = new PosterArt();
  private poles: PosterPole[] = [];
  private cinePole: PosterPole;
  private actor: CharacterRig | null = null;
  private actorKey = '';
  private cine: Cine | null = null;
  private lastEndAt = -1e9;
  private clock = 0;
  private hist: THREE.Vector3[] = [];
  private histT = 0;
  private mugKey = '';
  private warmT = 0;
  private seen = false;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private hiddenRig: CharacterRig | null = null;
  private built = false;

  constructor(private game: Game) {
    this.root.name = 'escape';
    this.hides = new HideSpots(game);
    this.police = new Police(game);
    this.cinePole = new PosterPole(this.art);
    this.cinePole.group.visible = false;
    this.root.add(this.hides.root, this.cinePole.group);
    try { this.seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { this.seen = false; }
  }

  get active() { return !!this.cine; }

  async build() {
    const game = this.game;
    game.scene!.add(this.root);
    this.police.attachLights(game.scene!);
    for (const s of posterSpots()) {
      const pp = new PosterPole(this.art);
      const y = game.world?.groundY(s.x, s.z) ?? 0.15;
      pp.group.position.set(s.x, y, s.z);
      pp.group.rotation.y = s.yaw;
      pp.flap = 0.18;
      this.root.add(pp.group);
      this.poles.push(pp);
    }
    await this.hides.build();
    this.built = true;
  }

  dispose() {
    if (this.cine) this.abort();
    this.police.dispose();
    this.actor?.dispose();
    this.actor = null;
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------------ per frame

  frame(dt: number) {
    const game = this.game;
    this.clock += dt;
    const pl = game.player, me = game.me;
    if (!pl || !me || game.g.scene !== 'world' || !game.scene) return;
    const cam = game.camera.position;
    const night = (game.world as any)?.night ?? game.clock.nightFactor ?? 0;
    this.hides.frame(dt, cam);
    for (const p of this.poles) {
      const d2 = p.group.position.distanceToSquared(cam);
      p.group.visible = d2 < 70 * 70;
      if (d2 < 20 * 20) p.update(this.clock);
    }
    if (this.cinePole.group.visible) this.cinePole.update(this.clock);
    this.police.update(dt, night);
    if (this.cine) {
      try { this.step(dt, night); } catch (e) { console.error('[escape] cinematic', e); this.finish(true); }
      return;
    }
    // remember where the player has walked (return points are always walkable)
    this.histT -= dt;
    if (this.histT <= 0 && pl.mode === 'play') {
      this.histT = 0.25;
      const last = this.hist[this.hist.length - 1];
      if (!last || last.distanceToSquared(pl.pos) > 0.36) { this.hist.push(pl.pos.clone()); if (this.hist.length > 60) this.hist.shift(); }
    }
    // warm-up: actor rig + mugshot for the dressing posters
    this.warmT += dt;
    if (this.warmT > 6 && this.built) this.refreshMugshot();
    // trigger
    if (pl.mode !== 'play' || (me.mode && me.mode !== 'free') || game.ui.choosing) return;
    if (this.clock - this.lastEndAt < 1.2) return;
    const hit = edgeAt(pl.pos.x, pl.pos.z);
    if (hit) this.start(hit, this.clock - this.lastEndAt < REPEAT_S);
  }

  /** dev / tests: play now at the current position (or force a hit) */
  trigger(short = false) {
    const pl = this.game.player;
    if (!pl || this.cine) return false;
    const hit = edgeAt(pl.pos.x, pl.pos.z) ?? edgeAt(127, 3)!;
    this.start(hit, short);
    return true;
  }

  // ------------------------------------------------------------------ actor (local stand-in for the player's body)

  private ensureActor(look: Look) {
    const game = this.game;
    if (!game.chars) return null;
    const key = JSON.stringify(look);
    if (!this.actor) {
      this.actor = game.chars.create(look, { castShadow: true });
      this.actor.root.visible = false;
      this.actor.root.name = 'escape-actor';
      this.root.add(this.actor.root);
      this.actorKey = key;
    } else if (key !== this.actorKey) {
      this.actor.setLook(look);
      this.actorKey = key;
    }
    return this.actor;
  }

  private refreshMugshot() {
    const me = this.game.me;
    if (!me?.look) return;
    const key = JSON.stringify(me.look) + '|' + (me.name ?? '');
    if (key === this.mugKey) return;
    const a = this.ensureActor(me.look);
    if (!a) return;
    // wait for the photo face / fabrics to stream in before taking the photo
    if (this.warmT < 9 && !this.cine) return;
    this.mugKey = key;
    const shot = renderMugshot(this.game, a);
    this.art.paint(shot, me.name ?? '');
  }

  // ------------------------------------------------------------------ start / finish

  private start(hit: EdgeHit, short: boolean) {
    const game = this.game, pl = game.player!, me = game.me!;
    const actor = this.ensureActor(me.look);
    const A = pl.pos.clone();
    A.y = game.world?.groundY(A.x, A.z) ?? A.y;
    const n = hit.n, t = hit.t;
    // return point: last remembered position comfortably inside
    let ret: THREE.Vector3 | null = null;
    for (let i = this.hist.length - 1; i >= 0; i--) if (insideDist(hit, this.hist[i].x, this.hist[i].z) > 6.5) { ret = this.hist[i].clone(); break; }
    if (!ret) ret = A.clone().addScaledVector(n, Math.max(2, 7 - insideDist(hit, A.x, A.z)));
    ret.y = game.world?.groundY(ret.x, ret.z) ?? ret.y;
    if (!actor) {
      // no character factory (headless tests): just push the player back in
      pl.teleport([ret.x, ret.y, ret.z], yawTo(n.x, n.z));
      this.lastEndAt = this.clock;
      return;
    }
    const spot = short ? null : this.hides.nearest(A, 17);
    let mode: HideMode = 'crouch';
    let H = A.clone(), run = A.clone();
    if (spot) {
      if (spot.kind === 'drum') { mode = 'drum'; H = spot.p.clone(); run = spot.p.clone().addScaledVector(n, 0.62); }
      else if (spot.kind === 'trash') { mode = 'trash'; H = spot.p.clone().addScaledVector(n, 0.15); run = spot.p.clone().addScaledVector(n, 1.0); }
      else { H = spot.p.clone().addScaledVector(n, spot.half + 0.42); run = H.clone(); }
      run.y = game.world?.groundY(run.x, run.z) ?? run.y;
      H.y = spot.p.y;
    }
    const side = this.openSide(A, t, n);
    const outYaw = yawTo(-n.x, -n.z);
    const runDur = Math.min(1.5, Math.max(0.45, A.distanceTo(run) / 5.2));
    // police staging
    const dEdge = Math.max(1, insideDist(hit, H.x, H.z));
    const onEdge = H.clone().addScaledVector(n, -dEdge);
    let truckStop: THREE.Vector3, truckYaw: number, truckFrom: THREE.Vector3, truckAway: THREE.Vector3;
    const cops: { a: THREE.Vector3; b: THREE.Vector3; home: THREE.Vector3 }[] = [];
    if (hit.stage === 'road') {
      truckStop = new THREE.Vector3(hit.line, 0, hit.lane ?? onEdge.z).addScaledVector(n, -6);
      truckYaw = yawTo(n.x, n.z);
      truckFrom = truckStop.clone().addScaledVector(n, -30);
      truckAway = truckStop.clone().addScaledVector(n, -34);
      const stand = onEdge.clone().addScaledVector(n, -1.1);
      cops.push({ home: truckStop.clone().addScaledVector(t, 1.3).addScaledVector(n, 0.6), a: stand.clone(), b: stand.clone() });
      cops.push({ home: truckStop.clone().addScaledVector(t, -1.3).addScaledVector(n, 0.6), a: stand.clone().addScaledVector(t, 1.5).addScaledVector(n, -0.3), b: stand.clone() });
    } else {
      truckStop = onEdge.clone().addScaledVector(n, -6.5).addScaledVector(t, -7);
      truckYaw = yawTo(t.x, t.z);
      truckFrom = truckStop.clone().addScaledVector(t, -32);
      truckAway = truckStop.clone().addScaledVector(t, 40);
      const stand = onEdge.clone().addScaledVector(n, -1.4);
      cops.push({ home: truckStop.clone().addScaledVector(n, 1.4).addScaledVector(t, 0.6), a: stand.clone().addScaledVector(t, -0.2), b: stand.clone() });
      cops.push({ home: truckStop.clone().addScaledVector(n, 1.4).addScaledVector(t, -0.9), a: stand.clone().addScaledVector(t, 1.4).addScaledVector(n, -0.4), b: stand.clone() });
    }
    for (const v of [truckStop, truckFrom, truckAway]) v.y = game.world?.groundY(v.x, v.z) ?? 0;
    for (const c of cops) for (const v of [c.a, c.home]) v.y = game.world?.groundY(v.x, v.z) ?? 0;
    if (short) {
      // far patrol only: two silhouettes with a torch walking the beat outside
      const far = A.clone().addScaledVector(n, -(insideDist(hit, A.x, A.z) + 9));
      cops[0] = { home: far.clone().addScaledVector(t, -7), a: far.clone().addScaledVector(t, 5), b: far.clone() };
      cops[1] = { home: far.clone().addScaledVector(t, -8.2).addScaledVector(n, -0.7), a: far.clone().addScaledVector(t, 3.8).addScaledVector(n, -0.7), b: far.clone() };
      for (const c of cops) for (const v of [c.a, c.home]) v.y = game.world?.groundY(v.x, v.z) ?? 0;
    }
    const c: Cine = {
      short, t: 0, hit, spot, mode, A, run, H, ret, retYaw: yawTo(n.x, n.z), outYaw, side, runDur,
      tHide: 5.5 + runDur + 0.75,
      fired: new Set(), prevMusic: (Sound as any).musicKey ?? '', snd: [], sneaky: null, heart: null, siren: null,
      truckFrom, truckStop, truckAway, truckYaw, cops, copPaths: [null, null], copStep: [0, 0],
      lines: { gasp: pick(LINES.GASP), suspect: pick(LINES.COP_SUSPECT), dismiss: pick(LINES.COP_DISMISS), agree: pick(LINES.COP_AGREE), relief: pick(LINES.RELIEF), again: pick(LINES.AGAIN) },
      camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camFov: 60, camRoll: 0, blendFrom: null,
      skippable: this.seen, actorY: 0, walkFrom: null,
    };
    this.cine = c;
    // ---- freeze + hand the camera to us
    pl.setMode('external');
    Input.setWantLock(false);
    this.hiddenRig = pl.rig();
    if (this.hiddenRig) this.hiddenRig.root.visible = false;
    // actor = the player's body for the cinematic
    actor.root.visible = true;
    actor.root.position.copy(A);
    actor.root.rotation.set(0, pl.yaw, 0);
    actor.setFace('neutral' as any);
    actor.setCarry({ r: false, l: false, two: false, head: false, load: 0 });
    actor.play('idle', { loop: true });
    actor.setMove(0);
    Overlay.letterbox(true);
    Overlay.crosshair(false);
    // ---- music drop
    Sound.music('', 0.4);
    if (!short) {
      Sound.play(sk('record_scratch'), { vol: 0.6 });
      this.refreshMugshot();
      this.police.ensureOfficers();
      this.police.show(true);
      this.police.placeTruck(truckFrom, truckYaw);
      this.police.bar = true;
      c.siren = Sound.play('esc_siren_loop', { pos: truckFrom, ref: 8, max: 90, vol: 0.9 });
      Sound.play('esc_truck_stop', { pos: truckFrom, ref: 6, max: 60, vol: 0.8 });
      for (let i = 0; i < 2; i++) { const o = this.police.officers[i]; if (o) { o.root.visible = false; o.root.position.copy(cops[i].home); } }
      // the poster pole right next to the hero, facing him
      const pp = this.cinePole.group;
      const pos = A.clone().addScaledVector(t, 1.6 * -side).addScaledVector(n, -0.55);
      pos.y = game.world?.groundY(pos.x, pos.z) ?? A.y;
      pp.position.copy(pos);
      pp.rotation.y = yawTo(n.x, n.z) + 0.25 * side;
      pp.visible = true;
      this.cinePole.flap = 0.55;
    } else {
      this.police.ensureOfficers();
      this.police.show(false);
      for (let i = 0; i < 2; i++) { const o = this.police.officers[i]; if (o) { o.root.visible = true; o.root.position.copy(cops[i].home); } }
      this.police.flash = true;
      Sound.play('esc_whistle_short', { pos: cops[0].home, ref: 10, max: 80, vol: 1 });
    }
    game.intent('escape.state', { mode: 'free', anim: 'idle', loop: true });
  }

  /** which side along t is open (no wall within 3 m) */
  private openSide(p: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3) {
    const phys = this.game.physics;
    if (!phys) return 1;
    const o = this.v1.copy(p).addScaledVector(n, 1.5); o.y += 1.4;
    const a = phys.raycast(o, t, 3.5, G.STATIC), b = phys.raycast(o, this.v2.copy(t).negate(), 3.5, G.STATIC);
    const da = a ? a.toi : 99, db = b ? b.toi : 99;
    return da >= db ? 1 : -1;
  }

  /** end the cinematic: back inside, first person, everything restored */
  private finish(skipped = false) {
    const c = this.cine;
    if (!c) return;
    this.cine = null;
    const game = this.game, pl = game.player;
    try {
      if (pl) {
        pl.teleport([c.ret.x, c.ret.y, c.ret.z], c.retYaw);
        pl.pitch = 0;
      }
    } catch (e) { console.warn('[escape] teleport', e); }
    this.restore(c);
    if (pl && pl.mode === 'external') pl.setMode('play');
    try { game.intent('escape.state', { mode: 'free', anim: 'idle', loop: true }); } catch { /* offline */ }
    this.lastEndAt = this.clock;
    if (!c.short && !this.seen) { this.seen = true; try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } }
    if (skipped) Sound.play(sk('whoosh_text'), { vol: 0.4 });
  }

  /** world left mid-cinematic: restore without touching the (gone) player */
  abort() {
    const c = this.cine;
    if (!c) return;
    this.cine = null;
    this.restore(c);
    this.lastEndAt = this.clock;
  }

  private restore(c: Cine) {
    const game = this.game;
    if (this.hiddenRig) { this.hiddenRig.root.visible = true; this.hiddenRig = null; }
    if (this.actor) { this.actor.root.visible = false; this.actor.lookAt(null); this.actor.setFace(null as any); }
    this.police.show(false);
    this.police.flash = false;
    this.cinePole.group.visible = false;
    if (c.spot?.lid && c.spot.lidRest) { c.spot.lid.position.copy(c.spot.lidRest); c.spot.lid.rotation.set(0, 0, 0); }
    if (c.spot?.bags) for (const b of c.spot.bags) b.visible = false;
    Overlay.letterbox(false);
    Overlay.clearSubtitle();
    try {
      game.engine.post.setDOF(false);
      const cam = game.camera;
      cam.fov = game.player?.baseFov ?? 72;
      cam.updateProjectionMatrix();
    } catch { /* no camera */ }
    for (const h of c.snd) h.stop(0.4);
    c.siren?.stop(0.6);
    c.heart?.stop(0.6);
    c.sneaky?.stop(1.4);
    Sound.music(c.prevMusic || '', 1.6);
  }

  // ------------------------------------------------------------------ the timeline

  private once(c: Cine, k: string) { if (c.fired.has(k)) return false; c.fired.add(k); return true; }

  private step(dt: number, night: number) {
    const c = this.cine!;
    const game = this.game, pl = game.player!, actor = this.actor!;
    if (pl.mode !== 'external') { this.abort(); return; }   // somebody else took the camera (sleep, …)
    c.t += dt;
    if (c.t > 32) { this.finish(true); return; }
    if (c.skippable && (Input.wasPressed('Escape') || Input.mousePressed(0))) { this.finish(true); return; }
    if (c.short) this.stepShort(c, dt, night); else this.stepFull(c, dt, night);
    if (!this.cine) return;
    // keep the player entity on the actor (friends see the run / hide)
    const ap = actor.root.position;
    const gy = game.world?.groundY(ap.x, ap.z) ?? ap.y;
    pl.teleport([ap.x, gy, ap.z], actor.root.rotation.y);
    actor.update(dt);
    this.applyCamera(c, dt);
  }

  // ---- full
  private stepFull(c: Cine, dt: number, night: number) {
    const game = this.game, actor = this.actor!, P = this.police;
    const t = c.t, n = c.hit.n, tt = c.hit.t;
    const head = () => (actor as any).headWorld ? (actor as any).headWorld(new THREE.Vector3()) : actor.root.position.clone().add(new THREE.Vector3(0, 1.7, 0));
    const T_POSTER = 2.6, T_FACE = 4.3, T_RUN = 5.5, T_DIVE = T_RUN + c.runDur, T_H = c.tHide;
    const T_STOP = T_H + 2.7, T_SUS = T_STOP + 0.2, T_DIS = T_SUS + 2.5, T_AGR = T_DIS + 2.5, T_BACK = T_AGR + 1.3;
    const T_LEAVE = T_BACK + 1.9, T_PEEK = T_LEAVE + 0.7, T_REL = T_PEEK + 0.9, T_WALK = T_REL + 1.9;
    // ---------------- truck arrives (0 … 2.4)
    const tk = easeOut(clamp01(t / 2.4));
    if (t < T_LEAVE) P.placeTruck(this.v1.lerpVectors(c.truckFrom, c.truckStop, tk), c.truckYaw);
    c.siren?.setPos(P.truck.position);
    if (t > 2.2 && this.once(c, 'whoop1')) { Sound.play('esc_siren_whoop', { pos: c.truckStop, ref: 8, max: 90 }); c.siren?.stop(1.2); c.siren = null; }
    // the hero notices
    if (t < T_RUN) {
      const yaw = actor.root.rotation.y;
      const want = t < 0.25 ? yaw : c.outYaw;
      actor.root.rotation.y = yaw + angDiff(want, yaw) * Math.min(1, dt * 5);
      actor.lookAt(t > 0.2 ? P.truck.position.clone().add(new THREE.Vector3(0, 1.4, 0)) : null);
    }
    if (t > 1.1 && this.once(c, 'shock')) actor.setFace('shock');
    // cops get out (off-screen, during the poster shot)
    if (t > T_POSTER + 0.2 && this.once(c, 'out')) {
      Sound.play('esc_car_door', { pos: c.truckStop, ref: 5, max: 60 });
      for (let i = 0; i < 2; i++) { const o = P.officers[i]; if (o) { o.root.visible = true; o.root.position.copy(c.cops[i].home); } }
    }
    if (t > T_POSTER + 0.7 && this.once(c, 'door2')) Sound.play('esc_car_door', { pos: c.truckStop, ref: 5, max: 60, pitch: 0.9 });
    // ---------------- poster push-in sting
    if (t > T_POSTER && this.once(c, 'sting')) {
      Sound.play(sk('dun_dun_dunn'), { vol: 0.75 });
      Sound.play(sk('paper_rustle'), { pos: this.cinePole.centre(this.v2), vol: 0.6 });
      this.cinePole.flap = 0.9;
    }
    // ---------------- gasp
    if (t > T_FACE + 0.1 && this.once(c, 'gasp')) {
      actor.setFace('scream');
      game.ui.shout(() => head().add(this.v3.set(0, 0.18, 0)), c.lines.gasp, { duration: 1.6, scale: 0.9 });
      Sound.play(sk(c.lines.gasp.th.startsWith('ตำรวจ') ? 'tamruat' : 'gasp'), { pos: actor.root.position, vol: 0.9 });
      Sound.play(sk('gasp'), { pos: actor.root.position, vol: 0.5, delay: 0.05 });
    }
    // ---------------- run + dive
    if (t >= T_RUN && t < T_DIVE) {
      if (this.once(c, 'run')) {
        actor.play('scream_run', { loop: true });
        actor.lookAt(null);
        game.intent('escape.state', { mode: 'free', anim: 'scream_run', loop: true });
        Sound.play(sk('whoosh_swing'), { pos: actor.root.position, vol: 0.5 });
      }
      const k = clamp01((t - T_RUN) / c.runDur);
      actor.root.position.lerpVectors(c.A, c.run, k);
      const d = this.v1.subVectors(c.run, c.A);
      if (d.lengthSq() > 0.01) actor.root.rotation.y = yawTo(d.x, d.z);
      actor.setMove(5.4);
      c.copStep[0] += dt;
      if (c.copStep[0] > 0.18) { c.copStep[0] = 0; Sound.play(sk('footstep_flipflop'), { pos: actor.root.position, vol: 0.4 }); }
    }
    if (t >= T_DIVE && t < T_H + 0.2) this.dive(c, t - T_DIVE);
    // ---------------- cops sweep the area
    if (t >= T_H) {
      if (this.once(c, 'cops')) {
        c.heart = Sound.play(sk('heartbeat_slow'), { vol: 0.55 });
        c.sneaky = Sound.play('esc_sneaky', { bus: 'music', vol: 1 });
        P.flash = true;
        for (let i = 0; i < 2; i++) c.copPaths[i] = { from: c.cops[i].home.clone(), to: c.cops[i].a.clone(), t0: T_H - 1.6 + i * 0.25, dur: Math.max(1.6, c.cops[i].home.distanceTo(c.cops[i].a) / 1.25) };
      }
      // sweep target
      const H = c.H;
      const tgt = P.spotTarget.position;
      if (t < T_SUS) tgt.copy(H).addScaledVector(tt, Math.sin(t * 1.25) * 2.2).addScaledVector(n, Math.cos(t * 0.9) * 0.8 - 0.3).setY(H.y + 0.1);
      else if (t < T_DIS + 0.6) tgt.lerp(this.v1.copy(H).setY(H.y + 0.45), Math.min(1, dt * 4));
      else tgt.lerp(this.v1.copy(H).addScaledVector(tt, 3 * Math.sin(t * 0.8)).addScaledVector(n, -2).setY(H.y), Math.min(1, dt * 2));
      // the lid trembles in the beam
      if (c.mode === 'drum' && c.spot?.lid && c.spot.lidRest && t > T_SUS && t < T_DIS + 0.8 && t > T_H + 1.2) {
        c.spot.lid.position.y = c.spot.lidRest.y + Math.abs(Math.sin(t * 38)) * 0.007;
      }
    }
    if (t > T_SUS && this.once(c, 'sus')) this.copSay(0, c.lines.suspect, 2.3);
    if (t > T_DIS && this.once(c, 'dis')) this.copSay(1, c.lines.dismiss, 2.4);
    if (t > T_AGR && this.once(c, 'agr')) this.copSay(0, c.lines.agree, 1.4);
    if (t > T_BACK && this.once(c, 'back')) {
      for (let i = 0; i < 2; i++) { const o = P.officers[i]; if (o) c.copPaths[i] = { from: o.root.position.clone(), to: c.cops[i].home.clone(), t0: T_BACK + i * 0.15, dur: Math.max(1.4, o.root.position.distanceTo(c.cops[i].home) / 1.5) }; }
    }
    this.moveCops(c, dt, t >= T_STOP && t < T_BACK ? c.H : null);
    // ---------------- they leave
    if (t > T_LEAVE && this.once(c, 'leave')) {
      for (const o of P.officers) o.root.visible = false;
      P.flash = false;
      Sound.play('esc_car_door', { pos: c.truckStop, ref: 5, max: 60 });
      Sound.play('esc_truck_leave', { pos: c.truckStop, ref: 6, max: 70, delay: 0.25 });
      Sound.play('esc_siren_whoop', { pos: c.truckStop, ref: 8, max: 90, delay: 0.6 });
      c.heart?.stop(1.0); c.heart = null;
    }
    if (t > T_LEAVE) {
      const k = clamp01((t - T_LEAVE - 0.3) / 3.2);
      P.placeTruck(this.v1.lerpVectors(c.truckStop, c.truckAway, k * k), c.truckYaw);
      if (k >= 1) P.show(false);
    }
    // ---------------- peek + relief
    if (t > T_PEEK) this.peek(c, t - T_PEEK);
    if (t > T_REL && this.once(c, 'relief')) {
      game.ui.think(() => head().add(this.v3.set(0, 0.25, 0)), c.lines.relief, { duration: 2.4 });
      Sound.play('esc_relief', { pos: actor.root.position, vol: 0.9 });
      actor.setFace(null as any);
    }
    // ---------------- walk back in → first person
    if (t > T_WALK) {
      if (this.once(c, 'walk')) {
        c.walkFrom = actor.root.position.clone();
        c.walkFrom.y = this.game.world?.groundY(c.walkFrom.x, c.walkFrom.z) ?? c.walkFrom.y;
        c.actorY = 0;
        if (c.spot?.lid && c.spot.lidRest) { c.spot.lid.position.copy(c.spot.lidRest); c.spot.lid.rotation.set(0, 0, 0); }
        if (c.spot?.bags) for (const b of c.spot.bags) b.visible = false;
        actor.play('idle', { loop: true });
        game.intent('escape.state', { mode: 'free', anim: 'idle', loop: true });
        c.blendFrom = { p: game.camera.position.clone(), q: game.camera.quaternion.clone(), fov: game.camera.fov };
      }
      this.walkIn(c, t - T_WALK);
    }
    // ---------------- cameras
    if (t < T_POSTER) {
      // over the shoulder: hero in the foreground, the patrol rolling up beyond
      const A = c.A;
      c.camPos.copy(A).addScaledVector(n, 2.3).addScaledVector(tt, 1.0 * c.side).setY(A.y + 1.75 + t * 0.03);
      c.camLook.copy(P.truck.position).lerp(this.v1.copy(A).addScaledVector(n, -5), 0.35).setY(A.y + 1.15);
      c.camFov = 58; c.camRoll = 0;
      this.safeCam(c, this.v2.copy(A).setY(A.y + 1.6));
    } else if (t < T_FACE) {
      const k = easeInOut((t - T_POSTER) / (T_FACE - T_POSTER));
      const pc = this.cinePole.centre(this.v1);
      const f = this.v2.set(-Math.sin(this.cinePole.group.rotation.y), 0, -Math.cos(this.cinePole.group.rotation.y));
      c.camPos.copy(pc).addScaledVector(f, lerp(1.7, 0.55, k)).add(this.v3.set(0, lerp(0.12, 0.02, k), 0));
      c.camLook.copy(pc);
      c.camFov = lerp(50, 40, k); c.camRoll = lerp(0.06, -0.03, k) * c.side;
      if (this.once(c, 'dof')) game.engine.post.setDOF(true, 1.2, 2);
    } else if (t < T_RUN) {
      if (this.once(c, 'nodof')) game.engine.post.setDOF(false);
      const hp = head();
      const f = this.v2.set(-Math.sin(actor.root.rotation.y), 0, -Math.cos(actor.root.rotation.y));
      const r = this.v3.set(Math.cos(actor.root.rotation.y), 0, -Math.sin(actor.root.rotation.y));
      const k = (t - T_FACE) / (T_RUN - T_FACE);
      c.camPos.copy(hp).addScaledVector(f, lerp(1.25, 0.95, k)).addScaledVector(r, 0.18 * c.side).add(this.v1.set(0, -0.06, 0));
      c.camLook.copy(hp).add(this.v1.set(0, -0.04, 0));
      c.camFov = 45; c.camRoll = Math.sin(t * 31) * 0.006;
      this.safeCam(c, hp);
    } else if (t < T_H) {
      // wide: the dash and the dive
      const mid = this.v1.addVectors(c.A, c.H).multiplyScalar(0.5);
      const d = this.v2.subVectors(c.H, c.A);
      const perp = d.lengthSq() > 0.25 ? this.v3.set(-d.z, 0, d.x).normalize() : this.v3.copy(tt);
      if (perp.dot(n) < 0) perp.negate();
      c.camPos.copy(mid).addScaledVector(perp, 4.2).addScaledVector(n, 1.5).setY(mid.y + 1.7);
      c.camLook.copy(actor.root.position).setY(actor.root.position.y + 0.8);
      c.camFov = 55; c.camRoll = 0;
      this.safeCam(c, this.v2.copy(mid).setY(mid.y + 1.2));
    } else if (t < T_LEAVE) {
      // low, behind the hiding place: the beam sweeping over it, the cops beyond
      const H = c.H;
      const o0 = P.officers[0]?.root.position ?? c.cops[0].a;
      c.camPos.copy(H).addScaledVector(n, 1.75).addScaledVector(tt, 1.15 * c.side).setY(H.y + 0.62);
      c.camLook.copy(H).lerp(o0, 0.55).setY(H.y + 1.0);
      c.camFov = 52; c.camRoll = -0.02 * c.side;
      this.safeCam(c, this.v2.copy(H).addScaledVector(n, 0.8).setY(H.y + 0.8));
    } else if (t < T_WALK) {
      const H = c.H;
      c.camPos.copy(H).addScaledVector(n, 2.0).addScaledVector(tt, -0.9 * c.side).setY(H.y + 1.15);
      c.camLook.copy(H).addScaledVector(n, -1.5).setY(H.y + 0.75);
      c.camFov = 50; c.camRoll = 0;
      this.safeCam(c, this.v2.copy(H).addScaledVector(n, 0.8).setY(H.y + 0.9));
    }
  }

  private copSay(i: number, line: TL, dur: number) {
    const o = this.police.officers[i];
    if (!o) return;
    const v = new THREE.Vector3();
    this.game.ui.say(() => ((o.rig as any).headWorld ? (o.rig as any).headWorld(v) : v.copy(o.root.position).setY(o.root.position.y + 1.7)).add(new THREE.Vector3(0, 0.3, 0)), line, { duration: dur, scale: 1.9, voice: i === 0 ? 0.85 : 0.7 });
    o.rig.play('talk', { loop: true });
  }

  /** officers follow their paths; face `look` when standing */
  private moveCops(c: Cine, dt: number, look: THREE.Vector3 | null) {
    const P = this.police;
    for (let i = 0; i < 2; i++) {
      const o = P.officers[i], path = c.copPaths[i];
      if (!o || !o.root.visible) continue;
      o.rig.setCarry({ r: i === 0, l: false, two: false, head: false, load: 0 });
      if (path) {
        const k = clamp01((c.t - path.t0) / path.dur);
        if (c.t >= path.t0) {
          o.root.position.lerpVectors(path.from, path.to, easeInOut(k));
          const d = this.v1.subVectors(path.to, path.from);
          if (k < 1 && d.lengthSq() > 0.01) { o.root.rotation.y = yawTo(d.x, d.z); o.rig.setMove(d.length() / path.dur * 1.3); }
          else o.rig.setMove(0);
          if (k > 0 && k < 1) {
            c.copStep[i] += dt;
            if (c.copStep[i] > 0.52) { c.copStep[i] = 0; Sound.play(sk('footstep_concrete'), { pos: o.root.position, vol: 0.3, pitch: 0.85 + i * 0.1 }); }
          }
          if (k >= 1) c.copPaths[i] = null;
        }
      } else o.rig.setMove(0);
      if (look && !path) {
        const d = this.v1.subVectors(look, o.root.position);
        const want = yawTo(d.x, d.z);
        o.root.rotation.y += angDiff(want, o.root.rotation.y) * Math.min(1, dt * 3);
        o.rig.lookAt(this.v2.copy(look).setY(look.y + 0.5));
      } else o.rig.lookAt(null);
    }
  }

  /** the dive into the hiding place (k = seconds since the run ended) */
  private dive(c: Cine, k: number) {
    const actor = this.actor!, game = this.game, n = c.hit.n;
    const sp = c.spot;
    if (this.once(c, 'dive')) {
      actor.setMove(0);
      Sound.play(sk('whoosh_swing'), { pos: actor.root.position, vol: 0.6, pitch: 0.8 });
      if (c.mode === 'trash') { actor.play('fall', {}); game.intent('escape.state', { mode: 'hiding', anim: 'fall', loop: false }); }
      else { actor.play('sit_floor', { loop: true }); game.intent('escape.state', { mode: 'hiding', anim: 'sit_floor', loop: true }); }
      if (c.mode === 'drum') Sound.play(sk('drop_plastic'), { pos: sp!.p, vol: 0.8, pitch: 0.7, delay: 0.3 });
    }
    if (c.mode === 'drum' && sp) {
      // hop up and drop in; the lid flips off and lands back on top
      const u = clamp01(k / 0.6);
      const arc = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.95;
      actor.root.position.lerpVectors(c.run, c.H, easeOut(u));
      c.actorY = u < 0.55 ? arc : lerp(arc, -0.5, (u - 0.55) / 0.45);
      actor.root.position.y = c.H.y + c.actorY;
      actor.root.rotation.y = c.outYaw + Math.PI;
      if (sp.lid && sp.lidRest) {
        const l = clamp01(k / 0.9);
        sp.lid.position.copy(sp.lidRest);
        sp.lid.position.y += Math.sin(Math.PI * l) * 0.75;
        sp.lid.position.x += Math.sin(Math.PI * l) * 0.35;
        sp.lid.rotation.x = l < 1 ? l * Math.PI * 2 : 0;
        if (l >= 1 && this.once(c, 'lidland')) Sound.play(sk('drop_plastic'), { pos: sp.p, vol: 0.9, pitch: 1.15 });
      }
    } else if (c.mode === 'trash' && sp) {
      const u = clamp01(k / 0.45);
      actor.root.position.lerpVectors(c.run, c.H, easeOut(u));
      actor.root.position.y = c.H.y + Math.sin(Math.PI * u) * 0.35 + 0.12 * u;
      actor.root.rotation.y = yawTo(-n.x, -n.z);
      if (u >= 1 && this.once(c, 'thud')) Sound.play(sk('drop_soft'), { pos: sp.p, vol: 0.9 });
      if (sp.bags) sp.bags.forEach((b, i) => {
        const v = clamp01((k - 0.25 - i * 0.18) / 0.4);
        b.visible = v > 0;
        b.position.set((i - 0.5) * 0.35, lerp(1.6, 0.42 + i * 0.12, v * v), 0.05);
        b.rotation.set(0.6 * v, i * 1.7, 0.4 * v * (i ? -1 : 1));
        if (v >= 1 && this.once(c, 'bag' + i)) Sound.play(sk('drop_soft'), { pos: sp.p, vol: 0.6, pitch: 1.2 });
      });
    } else {
      // crouch behind (crates / pickup / plain sight)
      const u = clamp01(k / 0.35);
      actor.root.position.lerpVectors(c.run, c.H, u);
      actor.root.rotation.y = yawTo(c.hit.n.x, c.hit.n.z);
      if (this.once(c, 'thud')) Sound.play(sk('body_thud'), { pos: actor.root.position, vol: 0.4 });
    }
  }

  private peek(c: Cine, k: number) {
    const actor = this.actor!, sp = c.spot, P = this.police;
    actor.lookAt(P.truck.visible ? this.v1.copy(P.truck.position).setY(P.truck.position.y + 1.2) : null);
    if (c.mode === 'drum' && sp?.lid && sp.lidRest) {
      const u = smooth(0, 0.6, k);
      sp.lid.position.copy(sp.lidRest);
      sp.lid.position.y += 0.17 * u;
      sp.lid.rotation.z = 0.12 * u;
      actor.root.position.y = c.H.y + lerp(-0.5, -0.22, u);
    } else if (c.mode === 'trash') {
      if (this.once(c, 'wake')) { actor.play('wake_up', {}); this.game.intent('escape.state', { mode: 'hiding', anim: 'wake_up', loop: false }); }
      if (sp?.bags) sp.bags.forEach((b, i) => { const u = smooth(0.2, 0.9, k); b.position.y = lerp(0.42 + i * 0.12, 0.18, u); b.position.x = (i - 0.5) * lerp(0.35, 1.1, u); });
    } else if (this.once(c, 'stand')) {
      actor.play('idle', { loop: true });
      this.game.intent('escape.state', { mode: 'hiding', anim: 'idle', loop: true });
    }
  }

  /** walk back into the neighbourhood while the camera slides into the eyes */
  private walkIn(c: Cine, k: number) {
    const actor = this.actor!, game = this.game;
    const from = c.walkFrom ?? c.H;
    const dist = from.distanceTo(c.ret);
    const dur = Math.min(2.2, Math.max(0.9, dist / 1.7));
    const u = clamp01(k / dur);
    actor.root.position.lerpVectors(from, c.ret, u);
    const d = this.v1.subVectors(c.ret, from);
    const yaw = d.lengthSq() > 0.05 ? yawTo(d.x, d.z) : c.retYaw;
    const targetYaw = u > 0.75 ? c.retYaw : yaw;
    actor.root.rotation.y += angDiff(targetYaw, actor.root.rotation.y) * Math.min(1, 0.12 + u * 0.3);
    actor.setMove(u < 1 ? Math.max(1.2, dist / dur) : 0);
    // FP target pose: eye height, facing inward
    const eye = (game.player?.eye ?? 1.6);
    const target = this.v2.copy(c.ret).setY(c.ret.y + eye);
    const q = this.q1.setFromEuler(new THREE.Euler(0, c.retYaw, 0, 'YXZ'));
    const b = c.blendFrom!;
    const e = easeInOut(u);
    const cam = game.camera;
    cam.position.lerpVectors(b.p, target, e);
    cam.quaternion.slerpQuaternions(b.q, q, e);
    const fov = lerp(b.fov, game.player?.baseFov ?? 72, e);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    actor.root.visible = u < 0.82;   // don't see the inside of our own head
    c.camFov = -1;                   // camera handled here
    if (u >= 1) this.finish(false);
  }

  // ---- short version
  private stepShort(c: Cine, dt: number, _night: number) {
    const game = this.game, actor = this.actor!, P = this.police;
    const t = c.t, n = c.hit.n, tt = c.hit.t, A = c.A;
    const head = () => (actor as any).headWorld ? (actor as any).headWorld(new THREE.Vector3()) : actor.root.position.clone().add(new THREE.Vector3(0, 1.7, 0));
    if (this.once(c, 'paths')) {
      for (let i = 0; i < 2; i++) c.copPaths[i] = { from: c.cops[i].home.clone(), to: c.cops[i].a.clone(), t0: 0, dur: 4.5 };
      game.ui.shout(() => head().add(this.v3.set(0, 0.2, 0)), c.lines.again, { duration: 1.8, scale: 0.9 });
      actor.setFace('shock');
    }
    P.spotTarget.position.copy(A).addScaledVector(n, -2.5).addScaledVector(tt, Math.sin(t * 1.6) * 3).setY(A.y);
    this.moveCops(c, dt, null);
    const yaw = actor.root.rotation.y;
    actor.root.rotation.y = yaw + angDiff(t < 1.0 ? c.outYaw : c.retYaw, yaw) * Math.min(1, dt * 6);
    if (t > 0.9 && this.once(c, 'duck')) {
      actor.play('sit_floor', { loop: true });
      game.intent('escape.state', { mode: 'hiding', anim: 'sit_floor', loop: true });
      Sound.play(sk('body_thud'), { pos: A, vol: 0.4 });
    }
    if (t > 1.2 && this.once(c, 'whistle')) Sound.play('esc_whistle', { pos: c.cops[0].home, ref: 10, max: 80 });
    if (t > 2.5) {
      if (this.once(c, 'walk')) {
        actor.play('idle', { loop: true });
        actor.setFace(null as any);
        c.walkFrom = actor.root.position.clone();
        game.intent('escape.state', { mode: 'free', anim: 'idle', loop: true });
        c.blendFrom = { p: game.camera.position.clone(), q: game.camera.quaternion.clone(), fov: game.camera.fov };
        P.flash = false;
        for (const o of P.officers) o.root.visible = false;
      }
      this.walkIn(c, t - 2.5);
      return;
    }
    if (t < 1.1) {
      c.camPos.copy(A).addScaledVector(n, 2.2).addScaledVector(tt, 0.85 * c.side).setY(A.y + 1.7);
      c.camLook.copy(A).addScaledVector(n, -10).setY(A.y + 1.0);
      c.camFov = 55;
      this.safeCam(c, this.v2.copy(A).setY(A.y + 1.5));
    } else {
      c.camPos.copy(A).addScaledVector(n, 1.9).addScaledVector(tt, -0.7 * c.side).setY(A.y + 0.75);
      c.camLook.copy(A).setY(A.y + 0.6);
      c.camFov = 50;
      this.safeCam(c, this.v2.copy(A).setY(A.y + 0.8));
    }
  }

  // ------------------------------------------------------------------ camera

  /** keep the camera out of walls: pull it toward `subject` if something static is in between */
  private safeCam(c: Cine, subject: THREE.Vector3) {
    const phys = this.game.physics;
    if (!phys) return;
    const d = this.v3.subVectors(c.camPos, subject);
    const len = d.length();
    if (len < 0.05) return;
    d.divideScalar(len);
    const hit = phys.raycast(subject, d, len, G.STATIC);
    if (hit && hit.toi < len) c.camPos.copy(subject).addScaledVector(d, Math.max(0.3, hit.toi - 0.25));
  }

  private applyCamera(c: Cine, _dt: number) {
    if (c.camFov < 0) return;   // walk-in blend drives the camera itself
    const cam = this.game.camera;
    cam.position.copy(c.camPos);
    // subtle hand-held drift
    const tt = this.clock;
    cam.position.x += Math.sin(tt * 0.9) * 0.012; cam.position.y += Math.sin(tt * 1.3 + 1) * 0.008;
    cam.up.copy(UP);
    cam.lookAt(c.camLook);
    if (c.camRoll) cam.rotateZ(c.camRoll);
    if (Math.abs(cam.fov - c.camFov) > 0.01) { cam.fov = c.camFov; cam.updateProjectionMatrix(); }
  }
}

function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
