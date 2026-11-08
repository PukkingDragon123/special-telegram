import * as THREE from 'three';
import type { Game } from '../../game/game';
import { G } from '../../sim/physics';
import { Overlay } from '../../ui3d/overlay';
import { hud } from '../hud/api';
import * as Rig from '../characters/rig';
import { headOf } from './util';

/* ============================================================================================
 * Tutorial cutscene camera (every peer, local). A tiny shot sequencer:
 *   cine.play('caught', [shot, shot, …], { onEnd })
 * Each shot computes a live Pose every frame (so it follows moving characters), with hard cuts or
 * blended camera moves between shots (whip pans = short blends + shake), punch-in zooms, slow
 * push-ins, over-the-shoulder two-shots, crane moves, handheld drift, depth of field on the subject
 * and camera collision (the lens is pulled in front of walls). When the sequence ends the camera
 * is handed back to the gameplay camera with a smooth blend from the last cutscene pose.
 * Builders (closeUp / ots / twoShot / crane / orbit / track) take entity ids and resolve the
 * character's root, head and facing on this peer.
 * ========================================================================================== */

export interface Pose { p: THREE.Vector3; look: THREE.Vector3; fov: number; roll?: number; /** collision is tested from here (default: look) */ pivot?: THREE.Vector3 }

export interface Shot {
  dur: number;
  /** camera pose at k (0..1 eased) / t (seconds into the shot); null = keep the last pose */
  pose: (k: number, t: number) => Pose | null;
  /** seconds to blend from the previous pose (0 = hard cut) */
  blend?: number;
  ease?: (k: number) => number;
  /** handheld shake at the start of the shot (decays) */
  shake?: number;
  /** constant handheld drift amplitude (default 1 = subtle) */
  drift?: number;
  /** depth-of-field focus target (null = DOF off) */
  focus?: () => THREE.Vector3 | null;
  enter?: () => void;
  tick?: (k: number, t: number) => void;
  /** don't run the collision check (shots that are meant to be very close / inside props) */
  noCollide?: boolean;
  /** hide the local player's own body (POV shots) */
  hideSelf?: boolean;
}

export interface PlayOpts { letterbox?: boolean; onEnd?: () => void; handBack?: number; skippable?: boolean }

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export const smoother = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);
export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeIn = (k: number) => k * k * k;
export const linear = (k: number) => k;

/** Facing direction (unit, horizontal) for a yaw in the game's convention (yawTo = atan2(-dx, -dz)). */
export function fwdOf(yaw: number, out = new THREE.Vector3()) { return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); }

export class CineCam {
  private shots: Shot[] = [];
  private si = -1;
  private st = 0;
  private opts: PlayOpts = {};
  private name = '';
  private prev: Pose | null = null;      // pose at the end of the previous shot (blend source)
  private cur: Pose = { p: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private shakeAmp = 0;
  private shakeT = 0;
  private dofOn = false;
  private back: { p: THREE.Vector3; q: THREE.Quaternion; fov: number; t: number; dur: number } | null = null;
  private owning = false;
  private time = 0;

  constructor(private game: Game) {
    game.events.on('world:exit', () => this.abort());
  }

  get active() { return this.owning; }
  get current() { return this.name; }

  /** Start a sequence. Returns false when the camera belongs to someone else (a conversation, the skill tree…). */
  play(name: string, shots: Shot[], o: PlayOpts = {}): boolean {
    const game = this.game, pl = game.player;
    if (!pl || !game.scene || !shots.length) { o.onEnd?.(); return false; }
    if (pl.mode === 'external' && !this.owning) { o.onEnd?.(); return false; }
    if (this.owning) this.endSeq(false);
    this.name = name;
    this.shots = shots;
    this.opts = o;
    this.si = -1;
    this.st = 0;
    this.back = null;
    // the blend source for a first shot with blend > 0 = the current gameplay camera
    const cam = game.camera;
    const look = cam.getWorldDirection(_a).multiplyScalar(4).add(cam.getWorldPosition(_b));
    this.prev = { p: cam.getWorldPosition(new THREE.Vector3()), look: look.clone(), fov: cam.fov };
    this.cur = { p: this.prev.p.clone(), look: this.prev.look.clone(), fov: this.prev.fov };
    this.owning = true;
    pl.setMode('external');
    const rg = pl.rig();
    if (rg) { rg.setFirstPerson(false); rg.root.visible = true; }
    if (o.letterbox !== false) this.letterbox(true);
    this.ambient(false);
    this.next();
    return true;
  }

  /** Shake the camera (whip pans, slaps, the dog landing on the cart). */
  shake(amp: number) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = 0; }

  /** Stop now and hand the camera back (blend). */
  stop(handBack = 0.7) {
    if (!this.owning) return;
    this.opts.handBack = handBack;
    this.endSeq(true);
  }

  /** Hard stop without callbacks (scene change). */
  abort() {
    if (!this.owning) { this.back = null; return; }
    this.owning = false;
    this.shots = [];
    this.setDof(null);
    this.letterbox(false);
    this.ambient(true);
    this.back = null;
  }

  /** idle NPCs glance at the camera when it's close — not while we're filming them */
  private ambient(on: boolean) {
    const W = (Rig as any).RigWorld;
    if (W && 'ambientCam' in W) W.ambientCam = on;
  }

  private letterbox(on: boolean) {
    const h = hud(this.game);
    if (h) h.setCinematic(on);
    else Overlay.letterbox(on);
    Overlay.crosshair(!on && this.game.player?.mode === 'play');
  }

  private next() {
    this.si++;
    this.st = 0;
    if (this.si >= this.shots.length) { this.endSeq(true); return; }
    const s = this.shots[this.si];
    if (s.shake) this.shake(s.shake);
    try { s.enter?.(); } catch (e) { console.warn('[cine] enter', e); }
  }

  private endSeq(callback: boolean) {
    const game = this.game, pl = game.player, cam = game.camera;
    const onEnd = this.opts.onEnd;
    this.owning = false;
    this.shots = [];
    this.setDof(null);
    this.letterbox(false);
    this.ambient(true);
    const dur = this.opts.handBack ?? 0.7;
    if (pl) {
      if (dur > 0) this.back = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, t: 0, dur };
      if (pl.mode === 'external') pl.setMode('play');
      cam.fov = pl.baseFov;
      cam.updateProjectionMatrix();
    }
    if (callback) { try { onEnd?.(); } catch (e) { console.warn('[cine] onEnd', e); } }
  }

  private setDof(target: THREE.Vector3 | null) {
    const post: any = this.game.engine.post;
    if (new URLSearchParams(location.search).has('nodof')) return;
    if (target) {
      const d = this.game.camera.getWorldPosition(_c).distanceTo(target);
      if (!this.dofOn) { post.setDOF(true, d, 2.2); this.dofOn = true; }
      try { if (post.dof?.cocMaterial) post.dof.cocMaterial.worldFocusDistance = d; } catch { /* older postprocessing */ }
    } else if (this.dofOn) {
      post.setDOF(false);
      try { if (post.dof) post.dof.target = null; } catch { /* */ }
      this.dofOn = false;
    }
  }

  /** Engine late hook (after the player placed the gameplay camera, before render). */
  late(raw: number) {
    const game = this.game, cam = game.camera;
    const dt = Math.min(raw, 0.1);
    this.time += dt;
    // ---- hand back: blend from the last cutscene pose into whatever the gameplay camera did this frame
    if (!this.owning && this.back) {
      const b = this.back;
      b.t += dt;
      const k = smoother(Math.min(1, b.t / b.dur));
      cam.position.lerpVectors(b.p, cam.position, k);
      cam.quaternion.slerpQuaternions(b.q, cam.quaternion, k);
      const fov = THREE.MathUtils.lerp(b.fov, cam.fov, k);
      if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      if (b.t >= b.dur) this.back = null;
      return;
    }
    if (!this.owning) return;
    const pl = game.player;
    if (!pl || pl.mode !== 'external') { this.abort(); return; }
    Overlay.crosshair(false);
    const s = this.shots[this.si];
    if (!s) return;
    const rg = pl.rig();
    if (rg) { rg.setFirstPerson(!!s.hideSelf); if (!s.hideSelf) rg.root.visible = true; }
    this.st += dt;
    const raw01 = Math.min(1, this.st / Math.max(0.001, s.dur));
    const k = (s.ease ?? smoother)(raw01);
    let pose: Pose | null = null;
    try { pose = s.pose(k, this.st); } catch (e) { console.warn('[cine] pose', e); }
    try { s.tick?.(k, this.st); } catch (e) { console.warn('[cine] tick', e); }
    if (pose) {
      if (!s.noCollide) this.collide(pose);
      // blend from the previous shot's final pose (camera move / whip pan)
      if (s.blend && this.prev && this.st < s.blend) {
        const bk = smoother(this.st / s.blend);
        pose = {
          p: this.prev.p.clone().lerp(pose.p, bk),
          look: this.prev.look.clone().lerp(pose.look, bk),
          fov: THREE.MathUtils.lerp(this.prev.fov, pose.fov, bk),
          roll: THREE.MathUtils.lerp(this.prev.roll ?? 0, pose.roll ?? 0, bk),
        };
      }
      this.cur.p.copy(pose.p); this.cur.look.copy(pose.look); this.cur.fov = pose.fov; this.cur.roll = pose.roll ?? 0;
    }
    // ---- apply with handheld drift + shake
    const P = this.cur;
    cam.position.copy(P.p);
    _m.lookAt(P.p, P.look, UP);
    cam.quaternion.setFromRotationMatrix(_m);
    const drift = (s.drift ?? 1) * 0.0045;
    this.shakeT += dt;
    const sh = this.shakeAmp * Math.exp(-this.shakeT * 5.5);
    if (sh < 0.002) this.shakeAmp = 0;
    const tt = this.time;
    const yawN = Math.sin(tt * 0.53) * drift + (Math.sin(tt * 37.1) * 0.6 + Math.sin(tt * 23.3) * 0.4) * sh * 0.05;
    const pitN = Math.sin(tt * 0.41 + 1.3) * drift * 0.8 + (Math.sin(tt * 31.7 + 2) * 0.6 + Math.sin(tt * 19.1) * 0.4) * sh * 0.04;
    const rollN = (P.roll ?? 0) + (Math.sin(tt * 27.9) * sh * 0.025);
    _e.set(pitN, yawN, rollN, 'YXZ');
    _q.setFromEuler(_e);
    cam.quaternion.multiply(_q);
    if (Math.abs(cam.fov - P.fov) > 0.01) { cam.fov = P.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // ---- depth of field on the subject
    const f = s.focus?.() ?? null;
    this.setDof(f);
    if (this.st >= s.dur) { this.prev = { p: P.p.clone(), look: P.look.clone(), fov: P.fov, roll: P.roll }; this.next(); }
  }

  /**
   * Keep the lens out of walls: cast from the pivot (subject) toward the camera. When the wanted spot is
   * badly blocked (a cart or a shutter right behind the subject), swing the camera around the pivot to
   * the first side with room (remembered for the rest of the shot so it doesn't flip-flop), else pull in.
   */
  private alt: { si: number; ang: number; up: number } = { si: -1, ang: 0, up: 0 };
  private collide(pose: Pose) {
    const phys = this.game.physics;
    if (!phys) return;
    const from = pose.pivot ?? pose.look;
    const dir0 = _a.subVectors(pose.p, from);
    const len = dir0.length();
    if (len < 0.05) return;
    dir0.multiplyScalar(1 / len);
    const s0 = Math.min(0.3, len * 0.3);
    const free = (dir: THREE.Vector3) => {
      const start = _b.copy(from).addScaledVector(dir, s0);
      const hit = phys.raycast(start, dir, len - s0, G.STATIC);
      return hit ? s0 + hit.toi - 0.18 : len;
    };
    if (this.alt.si !== this.si) this.alt = { si: this.si, ang: 0, up: 0 };
    const tryDir = (ang: number, up: number) => {
      const d = dir0.clone().applyAxisAngle(UP, ang);
      if (up) { d.y += up; d.normalize(); }
      return d;
    };
    let dir = tryDir(this.alt.ang, this.alt.up);
    let room = free(dir);
    if (room < len * 0.6 && len > 0.9) {
      // search once for a better angle; keep it for the shot
      let best = { ang: this.alt.ang, up: this.alt.up, room };
      for (const [ang, up] of [[0, 0], [0.6, 0], [-0.6, 0], [1.2, 0], [-1.2, 0], [0, 0.55], [0.8, 0.45], [-0.8, 0.45], [1.9, 0.2], [-1.9, 0.2]]) {
        const r = free(tryDir(ang, up));
        if (r > best.room + 0.05) best = { ang, up, room: r };
        if (r >= len * 0.95) break;
      }
      this.alt.ang = best.ang; this.alt.up = best.up;
      dir = tryDir(best.ang, best.up);
      room = best.room;
    }
    const keep = Math.max(0.22, Math.min(len, room));
    pose.p.copy(from).addScaledVector(dir, keep);
    // if we swung around the pivot, look at the same subject point
  }

  /** Skip input polled by the caller (local.ts) → stop with a quick blend. */
  skip() { if (this.owning) this.stop(0.35); }
}

// ------------------------------------------------------------------ subject helpers

export interface Subject { pos: THREE.Vector3; head: THREE.Vector3; fwd: THREE.Vector3; yaw: number }

/** Root, head and facing of an entity as seen on this peer (local player uses the controller). */
export function subject(game: Game, id: number | null | undefined, out?: Subject): Subject | null {
  if (id == null) return null;
  const o = out ?? { pos: new THREE.Vector3(), head: new THREE.Vector3(), fwd: new THREE.Vector3(), yaw: 0 };
  const pl = game.player;
  if (id === game.localPlayerId && pl) {
    o.pos.copy(pl.pos);
    o.yaw = (pl as any).bodyYaw ?? pl.yaw;   // third-person view: the body turns on its own
  } else {
    const obj = game.views.objectOf(id);
    const e = game.state.get(id);
    if (obj) { obj.getWorldPosition(o.pos); o.yaw = obj.rotation.y; }
    else if (e?.p) { o.pos.set(e.p[0], e.p[1], e.p[2]); o.yaw = e.yaw ?? 0; }
    else return null;
  }
  fwdOf(o.yaw, o.fwd);
  if (!headOf(game, id, o.head)) o.head.copy(o.pos).add(_c.set(0, 1.62, 0));
  // headWorld can lag a frame behind teleports — keep it sane
  if (o.head.distanceTo(o.pos) > 3) o.head.copy(o.pos).add(_c.set(0, 1.62, 0));
  return o;
}

const S1: Subject = { pos: new THREE.Vector3(), head: new THREE.Vector3(), fwd: new THREE.Vector3(), yaw: 0 };
const S2: Subject = { pos: new THREE.Vector3(), head: new THREE.Vector3(), fwd: new THREE.Vector3(), yaw: 0 };

const pose = (p: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0): Pose => ({ p, look, fov, roll });

/**
 * Face close-up / punch-in: camera in front of the face (facing = `toward` entity if given, else the
 * character's own facing), distance d0→d1 over the shot (punch-in when d1 < d0), slight side offset.
 */
export function closeUp(game: Game, id: number, o: { d0?: number; d1?: number; side?: number; up?: number; fov0?: number; fov1?: number; toward?: number | null; lookDown?: number } = {}) {
  return (k: number): Pose | null => {
    const s = subject(game, id, S1);
    if (!s) return null;
    const f = _a.copy(s.fwd);
    if (o.toward != null) {
      const t = subject(game, o.toward, S2);
      if (t) { f.subVectors(t.pos, s.pos); f.y = 0; if (f.lengthSq() > 1e-4) f.normalize(); else f.copy(s.fwd); }
    }
    const d = THREE.MathUtils.lerp(o.d0 ?? 1.4, o.d1 ?? 0.75, k);
    const right = _b.set(-f.z, 0, f.x);
    const look = s.head.clone().add(new THREE.Vector3(0, -0.04 - (o.lookDown ?? 0), 0));
    const p = look.clone().addScaledVector(f, d).addScaledVector(right, (o.side ?? 0.18) * d).add(new THREE.Vector3(0, (o.up ?? 0.02), 0));
    return { ...pose(p, look, THREE.MathUtils.lerp(o.fov0 ?? 40, o.fov1 ?? (o.fov0 ?? 40), k)), pivot: s.head.clone() };
  };
}

/** Free fraction (0..1) of the segment a→b against static geometry. */
export function room(game: Game, a: THREE.Vector3, b: THREE.Vector3): number {
  const phys = game.physics;
  if (!phys) return 1;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-3) return 1;
  dir.multiplyScalar(1 / len);
  const hit = phys.raycast(a, dir, len + 0.2, G.STATIC);
  return hit ? Math.max(0, (hit.toi - 0.2) / len) : 1;
}

/**
 * Over-the-shoulder: behind `fromId`'s shoulder looking at `toId`'s face; push = dolly in over the shot.
 * Wall right behind the speaker (sidewalk against a shutter)? Try the other shoulder, then rise above the head.
 */
export function ots(game: Game, fromId: number, toId: number, o: { side?: number; back?: number; push?: number; fov?: number; fov1?: number; lift?: number } = {}) {
  let chosen = 0, lastCheck = -1, t = 0;
  return (k: number): Pose | null => {
    const a = subject(game, fromId, S1), b = subject(game, toId, S2);
    if (!a || !b) return null;
    const d = _a.subVectors(b.head, a.head); d.y = 0;
    const dist = Math.max(0.4, d.length());
    d.normalize();
    const right = _b.set(-d.z, 0, d.x);
    const side0 = o.side ?? 1;
    const back = (o.back ?? 0.9) - (o.push ?? 0) * k;
    const lift0 = o.lift ?? 0.12;
    const cand = (sd: number, lift: number, bk: number) => a.head.clone().addScaledVector(d, -bk).addScaledVector(right, 0.5 * sd).add(new THREE.Vector3(0, lift, 0));
    t++;
    if (chosen === 0 || t - lastCheck > 20) {
      lastCheck = t;
      const r1 = room(game, a.head, cand(side0, lift0, back)), r2 = room(game, a.head, cand(-side0, lift0, back));
      chosen = r1 >= 0.8 || r1 >= r2 ? 1 : r2 >= 0.6 ? -1 : (Math.max(r1, r2) < 0.5 ? 2 : (r1 >= r2 ? 1 : -1));
    }
    const sd = chosen === -1 ? -side0 : side0;
    // 2 = no room behind: high shot from above the head, looking down past the shoulder
    const p = chosen === 2 ? a.head.clone().addScaledVector(d, -0.25).addScaledVector(right, 0.35 * sd).add(new THREE.Vector3(0, 0.75, 0)) : cand(sd, lift0, back);
    const look = b.head.clone().addScaledVector(right, -0.18 * sd * dist).add(new THREE.Vector3(0, -0.1, 0));
    return { p, look, fov: THREE.MathUtils.lerp(o.fov ?? 46, o.fov1 ?? (o.fov ?? 46), k), pivot: a.head.clone() };
  };
}

/** Side-on two-shot of a and b (profile), camera on `side` of the a→b line; dolly `push` metres in. */
export function twoShot(game: Game, aId: number, bId: number, o: { side?: number; dist?: number; push?: number; height?: number; fov?: number; fov1?: number; arc?: number } = {}) {
  return (k: number): Pose | null => {
    const a = subject(game, aId, S1), b = subject(game, bId, S2);
    if (!a || !b) return null;
    const mid = a.head.clone().add(b.head).multiplyScalar(0.5);
    const d = _a.subVectors(b.pos, a.pos); d.y = 0;
    const sep = Math.max(0.5, d.length());
    d.normalize();
    const perp = _b.set(-d.z, 0, d.x).multiplyScalar(o.side ?? 1);
    const arc = (o.arc ?? 0) * (k - 0.5);
    const dir = perp.clone().applyAxisAngle(UP, arc);
    const dist = (o.dist ?? Math.max(1.6, sep * 1.35 + 0.7)) - (o.push ?? 0) * k;
    const p = mid.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, o.height ?? -0.05, 0));
    return pose(p, mid.clone().add(new THREE.Vector3(0, -0.12, 0)), THREE.MathUtils.lerp(o.fov ?? 44, o.fov1 ?? (o.fov ?? 44), k));
  };
}

/** Crane: from high above (h0) down to h1 at radius r0→r1 in front of / around the subject, looking at a body point. */
export function crane(game: Game, id: number, o: { h0?: number; h1?: number; r0?: number; r1?: number; az?: number; az1?: number; lookY?: number; lookY1?: number; fov?: number; fov1?: number } = {}) {
  return (k: number): Pose | null => {
    const s = subject(game, id, S1);
    if (!s) return null;
    const az = THREE.MathUtils.lerp(o.az ?? 0, o.az1 ?? (o.az ?? 0), k);
    const dir = _a.copy(s.fwd).applyAxisAngle(UP, az);
    const r = THREE.MathUtils.lerp(o.r0 ?? 0.6, o.r1 ?? 2.2, k);
    const h = THREE.MathUtils.lerp(o.h0 ?? 7, o.h1 ?? 1.6, k);
    const look = s.pos.clone().add(new THREE.Vector3(0, THREE.MathUtils.lerp(o.lookY ?? 0.4, o.lookY1 ?? (o.lookY ?? 0.4), k), 0));
    const p = s.pos.clone().addScaledVector(dir, r).add(new THREE.Vector3(0, h, 0));
    return pose(p, look, THREE.MathUtils.lerp(o.fov ?? 50, o.fov1 ?? (o.fov ?? 50), k));
  };
}

/** Orbit around a subject's body point (az0→az1 relative to their facing). */
export function orbit(game: Game, id: number, o: { r?: number; h?: number; az0?: number; az1?: number; lookY?: number; fov?: number; fov1?: number } = {}) {
  return (k: number): Pose | null => {
    const s = subject(game, id, S1);
    if (!s) return null;
    const az = THREE.MathUtils.lerp(o.az0 ?? -0.5, o.az1 ?? 0.5, k);
    const dir = _a.copy(s.fwd).applyAxisAngle(UP, az);
    const look = s.pos.clone().add(new THREE.Vector3(0, o.lookY ?? 1.1, 0));
    const p = look.clone().addScaledVector(dir, o.r ?? 2.4).add(new THREE.Vector3(0, (o.h ?? 1.5) - (o.lookY ?? 1.1), 0));
    return pose(p, look, THREE.MathUtils.lerp(o.fov ?? 46, o.fov1 ?? (o.fov ?? 46), k));
  };
}

/** Low tracking shot alongside a moving subject (dog run, a walk), camera trails behind/side. */
export function track(game: Game, id: number, o: { side?: number; back?: number; h?: number; lookY?: number; lead?: number; fov?: number } = {}) {
  const sm = new THREE.Vector3();
  let init = false;
  return (_k: number): Pose | null => {
    const s = subject(game, id, S1);
    if (!s) return null;
    const right = _b.set(-s.fwd.z, 0, s.fwd.x);
    const want = s.pos.clone().addScaledVector(s.fwd, -(o.back ?? 1.6)).addScaledVector(right, o.side ?? 1.4).add(new THREE.Vector3(0, o.h ?? 0.55, 0));
    if (!init) { sm.copy(want); init = true; } else sm.lerp(want, 0.18);
    const look = s.pos.clone().addScaledVector(s.fwd, o.lead ?? 1.2).add(new THREE.Vector3(0, o.lookY ?? 0.35, 0));
    return pose(sm.clone(), look, o.fov ?? 52);
  };
}

/** Fixed camera at a point looking at a (possibly moving) target. */
export function fixed(p: THREE.Vector3 | (() => THREE.Vector3), look: () => THREE.Vector3 | null, fov = 50, fov1?: number) {
  return (k: number): Pose | null => {
    const l = look();
    if (!l) return null;
    return pose(typeof p === 'function' ? p() : p.clone(), l.clone(), THREE.MathUtils.lerp(fov, fov1 ?? fov, k));
  };
}

/** Point a bit in front of / above a world position (for wheels, woks, plates). */
export function spot(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z); }
