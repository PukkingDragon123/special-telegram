import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig, Look } from '../../game/contracts';
import { h01, hashN, hweighted, bump, qmul, quality } from './util';
import { line } from './lines';
import { play } from './sounds';
import type { Life } from './index';

/* ============================================================================================
 * AMBIENT CROWDS — client-local & deterministic (g.seed + g.lifeT), never entities.
 *  - walkers: seeded slot schedules on sidewalk polylines; density by zone & hour (morning
 *    market rush, lunch office crowd, evening, near-empty late night); archetype by place/time.
 *  - set pieces: bus-stop waiters, motorbike-taxi guys playing bottle-cap checkers, gossiping
 *    aunties, kids after school, the lottery seller ("ลอตเตอรี่จ้า"), the monk's morning alms
 *    round (with a kneeling lady offering food — respectful, no interactions).
 *  - reactions: dodge players, glance at them, laugh at slaps (any 'slap_hard' sfx nearby),
 *    flee from visible ghosts.
 * LOD: nearest N get real character rigs (game.chars, lod 'low', no shadows; N by quality);
 * farther walkers are instanced low-poly figures (one draw call per part).
 * ========================================================================================== */

interface Path { id: number; pts: THREE.Vector2[]; cum: number[]; len: number; gap: number; zone: string; width: number }
interface Walker { key: string; path: Path; slot: number; dir: 1 | -1; speed: number; t0: number; lat: number; arch: string; seed: number; pos: THREE.Vector3; yaw: number; flee: number; fleeDir: THREE.Vector3 | null; laugh: number; gone: boolean }
interface Fixed { key: string; arch: string; pos: THREE.Vector3; yaw: number; anim: string; from: number; to: number; seed: number; lines?: string; talkT?: number; walk?: { path: THREE.Vector2[]; speed: number; cum: number[]; len: number } ; bubble?: string }

const SKIN = ['#d2a582', '#c4936d', '#a87652', '#8d5f3e', '#e0b896'];
const TOPS = ['#2f63b8', '#c8423a', '#f2f0ea', '#1d1d1f', '#e8a33d', '#3a8a4a', '#7b4f9e', '#e0457b', '#5a6a7a', '#d6b25a'];
const BOTS = ['#2c3a58', '#1d2230', '#26272c', '#5a5040', '#3d4752', '#a8956e'];

function mkPath(id: number, pts: [number, number][], gap: number, zone: string, width = 1.6): Path {
  const P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  return { id, pts: P, cum, len: cum[cum.length - 1], gap, zone, width };
}
function along(P: THREE.Vector2[], cum: number[], s: number, out: THREE.Vector2, tan: THREE.Vector2) {
  const len = cum[cum.length - 1];
  s = Math.max(0, Math.min(len, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  out.lerpVectors(P[i - 1], P[i], t);
  tan.subVectors(P[i], P[i - 1]).normalize();
}

export class Crowd {
  private paths: Path[] = [];
  private walkers = new Map<string, Walker>();
  private fixed: Fixed[] = [];
  private rigs = new Map<string, { rig: CharacterRig; anim: string; last: THREE.Vector3; bubbleT: number }>();
  private looks = new Map<string, Look>();
  private group: THREE.Group | null = null;
  private imp: { body: THREE.InstancedMesh; legs: THREE.InstancedMesh; head: THREE.InstancedMesh } | null = null;
  private seed = 1;
  private nearCap = 12;
  private built = false;
  private tmpV = new THREE.Vector2();
  private tmpT = new THREE.Vector2();
  private laughAt: { p: THREE.Vector3; t: number } | null = null;
  private createBudget = 0;

  constructor(private game: Game, private life: Life) {}

  init() {
    // laugh when someone gets slapped nearby (works with whatever module plays the slap)
    this.game.on('sfx', (d: { k: string; p: number[] | null }) => {
      if (d?.k === 'slap_hard' && d.p) this.laughAt = { p: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), t: this.life.clock.t };
    });
  }

  build() {
    const game = this.game;
    if (this.built || !game.scene) return;
    this.built = true;
    this.seed = (game.g.seed ?? 1) | 0;
    const q = quality();
    this.nearCap = q === 'low' ? 5 : q === 'medium' ? 9 : q === 'ultra' ? 18 : 13;
    const k = 1 / qmul();
    // sidewalk paths (from the map plan: soi sidewalks ±4.8, main-road sidewalks z≈3.6 / 24, market aisles, temple, canal, rural road)
    this.paths = [
      mkPath(0, [[-4.9, 1], [-4.9, -157]], 4.6 * k, 'soi', 1.6),
      mkPath(1, [[4.9, 1], [4.9, -19], [6.3, -21], [6.3, -27], [4.9, -29], [4.9, -157]], 4.8 * k, 'soi', 1.4),
      mkPath(2, [[-128, 3.6], [-3.8, 3.6]], 3.8 * k, 'mainroad', 2.2),
      mkPath(3, [[3.8, 3.6], [128, 3.6]], 4 * k, 'mainroad', 2.2),
      mkPath(4, [[-128, 24.2], [128, 24.2]], 6 * k, 'mainroad', 2.4),
      mkPath(5, [[7, -50], [48, -50]], 4.5 * k, 'market', 1.4),
      mkPath(6, [[7, -58], [48, -58]], 4.5 * k, 'market', 1.4),
      mkPath(7, [[7, -66], [48, -66]], 5 * k, 'market', 1.4),
      mkPath(8, [[-60, -4], [-30, -4], [-22, 2.6]], 6 * k, 'office', 3),
      mkPath(9, [[6.5, -154.5], [22, -154.5], [22, -150]], 14 * k, 'temple', 2),
      mkPath(10, [[-120, -163.5], [120, -163.5]], 16 * k, 'canal', 1.5),
      mkPath(11, [[0.8, -180], [0.8, -266]], 30 * k, 'rural', 1.8),
    ];
    this.group = new THREE.Group();
    this.group.name = 'life:crowd';
    game.scene.add(this.group);
    this.buildImpostors();
    this.buildFixed();
  }

  dispose() {
    for (const r of this.rigs.values()) { r.rig.root.removeFromParent(); r.rig.dispose(); }
    this.rigs.clear();
    this.walkers.clear();
    this.group?.removeFromParent();
    this.group = null;
    this.imp = null;
    this.built = false;
  }

  // ------------------------------------------------------------------ density & archetypes

  private density(zone: string, h: number): number {
    const late = h >= 22 ? Math.max(0.05, 1 - (h - 22) * 0.45) : 1;
    let d = 0.25;
    switch (zone) {
      case 'market': d = (h < 14 ? 0.45 + bump(h, 7.5, 1.4, 0.55) : 0.08); break;
      case 'office': d = 0.15 + bump(h, 12.1, 0.8, 0.85) + bump(h, 8.2, 0.6, 0.4) + bump(h, 17.6, 0.7, 0.55); break;
      case 'mainroad': d = 0.35 + bump(h, 7.8, 1, 0.35) + bump(h, 12.2, 1, 0.3) + bump(h, 18.2, 1.3, 0.45); break;
      case 'soi': d = 0.3 + bump(h, 7.2, 1, 0.4) + bump(h, 12, 1, 0.25) + bump(h, 18.5, 1.5, 0.45); break;
      case 'temple': d = 0.15 + bump(h, 7, 1, 0.5) + bump(h, 17, 1.2, 0.2); break;
      case 'canal': d = 0.15 + bump(h, 17.5, 1.5, 0.25); break;
      case 'rural': d = 0.08 + bump(h, 7, 1.2, 0.2) + bump(h, 17, 1.2, 0.15); break;
    }
    return Math.min(1, d * late);
  }

  private archFor(zone: string, h: number, ...n: number[]): string {
    const school = bump(h, 7.3, 0.6, 1) + bump(h, 15.8, 0.8, 1);
    const lunch = bump(h, 12.1, 0.9, 1);
    const night = h > 20 ? 1 : 0;
    const A: [string, number][] = [
      ['office_worker_m', zone === 'office' ? 10 : 2 + lunch * 3], ['office_worker_f', zone === 'office' ? 10 : 2 + lunch * 3],
      ['student_m', 1 + school * 6], ['student_f', 1 + school * 6], ['uncle_singlet', 5 + night * 3], ['auntie_vendor', zone === 'market' ? 9 : 3],
      ['housewife', zone === 'market' ? 7 : 4], ['old_lady', zone === 'temple' ? 6 : 2], ['grandpa', 2], ['temple_lady', zone === 'temple' ? 8 : 0.5],
      ['delivery_rider', 2 + lunch * 2], ['construction_worker', zone === 'rural' ? 4 : 2], ['teen_gamer', 1 + night * 2], ['gangster_lite', 0.5 + night * 2],
      ['tourist_backpacker', zone === 'mainroad' ? 2.5 : 0.6], ['street_sweeper', h < 9 ? 2 : 0.2], ['security_guard', 0.8],
    ];
    return hweighted(A.map((a) => a[0]), A.map((a) => a[1]), ...n);
  }

  private lookFor(key: string, arch: string, seed: number): Look {
    let L = this.looks.get(key);
    if (!L) {
      L = this.game.chars.randomLook(arch, seed);
      this.looks.set(key, L);
      if (this.looks.size > 300) { const first = this.looks.keys().next().value; if (first) this.looks.delete(first); }
    }
    return L;
  }

  // ------------------------------------------------------------------ set pieces

  private buildFixed() {
    const S = this.seed;
    const add = (f: Omit<Fixed, 'seed'>) => this.fixed.push({ ...f, seed: hashN(S, this.fixed.length, 31) });
    // bus stop (x -30): people waiting, one sitting
    add({ key: 'bus0', arch: 'office_worker_f', pos: new THREE.Vector3(-30.8, 0.15, 3.0), yaw: Math.PI, anim: 'sit', from: 6.5, to: 22 });
    add({ key: 'bus1', arch: 'student_m', pos: new THREE.Vector3(-29.2, 0.15, 3.8), yaw: Math.PI * 0.9, anim: 'idle', from: 6.5, to: 19 });
    add({ key: 'bus2', arch: 'old_lady', pos: new THREE.Vector3(-31.9, 0.15, 3.9), yaw: Math.PI * 1.1, anim: 'idle', from: 7, to: 18 });
    // motorbike-taxi stand (x -8): orange vests, bottle-cap checkers on a crate
    add({ key: 'win0', arch: 'moto_taxi', pos: new THREE.Vector3(-8.6, 0.15, 1.3), yaw: -Math.PI / 2, anim: 'sit', from: 6, to: 23.5, lines: 'moto_taxi' });
    add({ key: 'win1', arch: 'moto_taxi', pos: new THREE.Vector3(-7.3, 0.15, 1.3), yaw: Math.PI / 2, anim: 'sit', from: 6, to: 23.5, lines: 'moto_taxi' });
    add({ key: 'win2', arch: 'moto_taxi', pos: new THREE.Vector3(-8.0, 0.15, 2.4), yaw: Math.PI, anim: 'idle', from: 6, to: 22 });
    // gossiping aunties at the market entrance
    add({ key: 'gos0', arch: 'auntie_vendor', pos: new THREE.Vector3(7.2, 0.15, -56.0), yaw: -Math.PI * 0.75, anim: 'talk', from: 7, to: 17, lines: 'crowd_gossip' });
    add({ key: 'gos1', arch: 'housewife', pos: new THREE.Vector3(8.0, 0.15, -56.8), yaw: Math.PI * 0.25, anim: 'talk', from: 7, to: 17, lines: 'crowd_gossip' });
    add({ key: 'gos2', arch: 'old_lady', pos: new THREE.Vector3(8.1, 0.15, -55.7), yaw: Math.PI * 0.75, anim: 'idle', from: 8, to: 15 });
    // kids after school on the vacant lot
    add({ key: 'kid0', arch: 'student_m', pos: new THREE.Vector3(-14, 0.15, -88), yaw: 0.6, anim: 'celebrate', from: 15.5, to: 19 });
    add({ key: 'kid1', arch: 'student_f', pos: new THREE.Vector3(-15.2, 0.15, -86.8), yaw: -2.4, anim: 'wave', from: 15.5, to: 19 });
    // other vendors at their stalls along the soi
    add({ key: 'ven0', arch: 'vendor_cook', pos: new THREE.Vector3(-6.8, 0.15, -54), yaw: -Math.PI / 2, anim: 'cook_stir', from: 6, to: 21 });
    add({ key: 'ven1', arch: 'auntie_vendor', pos: new THREE.Vector3(12, 0.15, -50.5), yaw: 0, anim: 'idle', from: 5, to: 14 });
    add({ key: 'ven2', arch: 'auntie_vendor', pos: new THREE.Vector3(20, 0.15, -64.5), yaw: Math.PI, anim: 'chop', from: 5, to: 14 });
    // the lottery seller walking the soi with her board
    add({ key: 'lotto', arch: 'old_lady', pos: new THREE.Vector3(), yaw: 0, anim: 'walk', from: 9, to: 18, lines: 'lottery', walk: this.walkPath([[-4.6, -2], [-4.6, -120], [4.6, -120], [4.6, -2], [-4.6, -2]], 0.55) });
    // monk alms round (silent, slow, barefoot) + a lady kneeling with a food offering
    add({ key: 'monk', arch: 'monk', pos: new THREE.Vector3(), yaw: 0, anim: 'walk', from: 6.2, to: 8.2, walk: this.walkPath([[3.2, -150], [3.2, -40], [-3.2, -40], [-3.2, -150]], 0.45) });
    add({ key: 'give', arch: 'temple_lady', pos: new THREE.Vector3(-4.7, 0.15, -70), yaw: -Math.PI / 2, anim: 'sit_floor', from: 6.2, to: 8.2 });
  }
  private walkPath(pts: [number, number][], speed: number) {
    const P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
    return { path: P, speed, cum, len: cum[cum.length - 1] };
  }

  // ------------------------------------------------------------------ impostors (far walkers)

  private buildImpostors() {
    const cap = 220;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const body = new THREE.LatheGeometry([[0, 0], [0.17, 0.02], [0.19, 0.25], [0.17, 0.5], [0.12, 0.58], [0, 0.6]].map((p) => new THREE.Vector2(p[0], p[1])), 7);
    body.scale(1, 1, 0.72); body.translate(0, 0.86, 0);
    const legs = new THREE.CylinderGeometry(0.11, 0.09, 0.86, 6); legs.scale(1.25, 1, 0.8); legs.translate(0, 0.43, 0);
    const head = new THREE.IcosahedronGeometry(0.11, 1); head.scale(0.9, 1.1, 1); head.translate(0, 1.57, 0);
    const mk = (g: THREE.BufferGeometry) => { const m = new THREE.InstancedMesh(g, mat, cap); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.count = 0; m.frustumCulled = false; this.group!.add(m); return m; };
    this.imp = { body: mk(body), legs: mk(legs), head: mk(head) };
  }

  // ------------------------------------------------------------------ frame

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();
  private _c = new THREE.Color();

  frame(dt: number) {
    if (!this.built || !this.group) return;
    const game = this.game;
    const T = this.life.clock.t;
    const hour = game.clock.time;
    const cam = game.camera.getWorldPosition(new THREE.Vector3());
    const players = game.players().filter((p) => p.p).map((p) => new THREE.Vector3(p.p[0], p.p[1], p.p[2]));
    const ghosts = game.state.all('ghost').filter((g) => g.p && (g.vis ?? 0) > 0.4).map((g) => new THREE.Vector3(g.p[0], g.p[1], g.p[2]));
    const seen = new Set<string>();

    // ---- walkers from schedules
    for (const P of this.paths) {
      const maxDur = P.len / 0.9;
      const i0 = Math.max(0, Math.floor((T - maxDur) / P.gap)), i1 = Math.floor(T / P.gap);
      for (let i = i0; i <= i1; i++) {
        const t0 = i * P.gap + h01(this.seed, P.id, i, 1) * P.gap * 0.6;
        if (t0 > T) continue;
        const hourAt = hour - (T - t0) / 66.7;
        if (h01(this.seed, P.id, i, 2) > this.density(P.zone, hourAt)) continue;
        const speed = 1.0 + h01(this.seed, P.id, i, 3) * 0.55;
        const s = (T - t0) * speed;
        if (s > P.len) continue;
        const key = P.id + ':' + i;
        let w = this.walkers.get(key);
        if (!w) {
          const dir: 1 | -1 = h01(this.seed, P.id, i, 4) < 0.5 ? 1 : -1;
          w = { key, path: P, slot: i, dir, speed, t0, lat: (h01(this.seed, P.id, i, 5) - 0.5) * P.width, arch: this.archFor(P.zone, hourAt, this.seed, P.id, i, 6), seed: hashN(this.seed, P.id, i), pos: new THREE.Vector3(), yaw: 0, flee: 0, fleeDir: null, laugh: 0, gone: false };
          this.walkers.set(key, w);
        }
        if (w.gone) { seen.add(key); continue; }
        along(P.pts, P.cum, w.dir > 0 ? s : P.len - s, this.tmpV, this.tmpT);
        if (w.dir < 0) this.tmpT.negate();
        const nx = -this.tmpT.y, nz = this.tmpT.x;
        let lat = w.lat;
        // dodge players (lateral push) & glance
        for (const pp of players) {
          const dx = pp.x - this.tmpV.x, dz = pp.z - this.tmpV.y;
          const fwd = dx * this.tmpT.x + dz * this.tmpT.y;
          const side = dx * nx + dz * nz;
          if (fwd > -1 && fwd < 3 && Math.abs(side - lat) < 0.9) lat += side > lat ? -(0.9 - Math.abs(side - lat)) : 0.9 - Math.abs(side - lat);
        }
        const target = new THREE.Vector3(this.tmpV.x + nx * lat, 0, this.tmpV.y + nz * lat);
        // flee from ghosts
        for (const g of ghosts) if (w.flee <= 0 && Math.hypot(g.x - target.x, g.z - target.z) < 12) { w.flee = 6; w.fleeDir = target.clone().sub(g).setY(0).normalize(); if (h01(w.seed, Math.floor(T)) < 0.4) this.say(w.pos, line('ghost_flee')); }
        if (w.flee > 0) {
          w.flee -= dt;
          w.pos.addScaledVector(w.fleeDir!, 5.2 * dt);
          w.pos.y = game.world?.groundY(w.pos.x, w.pos.z) ?? 0.15;
          w.yaw = Math.atan2(-w.fleeDir!.x, -w.fleeDir!.z);
          if (w.flee <= 0) w.gone = true;
        } else {
          if (w.pos.lengthSq() === 0) w.pos.copy(target); else w.pos.lerp(target, Math.min(1, dt * 6));
          w.pos.y = game.world?.groundY(w.pos.x, w.pos.z) ?? 0.15;
          w.yaw = Math.atan2(-this.tmpT.x, -this.tmpT.y);
        }
        seen.add(key);
      }
    }
    for (const k of [...this.walkers.keys()]) if (!seen.has(k)) this.walkers.delete(k);

    // ---- laugh at slaps
    if (this.laughAt) {
      const la = this.laughAt;
      this.laughAt = null;
      let witness: Walker | null = null;
      for (const w of this.walkers.values()) if (!w.gone && w.pos.distanceTo(la.p) < 12) { w.laugh = 2.2; witness = witness ?? w; }
      if (witness) { this.say(witness.pos, line('crowd_laugh')); play('laugh', { pos: witness.pos, vol: 0.6 }); }
    }

    // ---- choose who gets a real rig (nearest walkers + active set pieces)
    type Cand = { key: string; arch: string; seed: number; pos: THREE.Vector3; yaw: number; anim: string; moving: boolean; laugh: number; flee: boolean; lines?: string };
    const cands: Cand[] = [];
    for (const w of this.walkers.values()) if (!w.gone) cands.push({ key: 'w' + w.key, arch: w.arch, seed: w.seed, pos: w.pos, yaw: w.yaw, anim: w.flee > 0 ? 'scream_run' : w.laugh > 0 ? 'celebrate' : 'walk', moving: true, laugh: w.laugh, flee: w.flee > 0 });
    for (const f of this.fixed) {
      if (hour < f.from || hour > f.to) continue;
      if (f.walk) {
        const W = f.walk;
        const s = ((T * W.speed) % W.len);
        along(W.path, W.cum, s, this.tmpV, this.tmpT);
        f.pos.set(this.tmpV.x, game.world?.groundY(this.tmpV.x, this.tmpV.y) ?? 0.15, this.tmpV.y);
        f.yaw = Math.atan2(-this.tmpT.x, -this.tmpT.y);
      }
      cands.push({ key: 'f' + f.key, arch: f.arch, seed: f.seed, pos: f.pos, yaw: f.yaw, anim: f.anim, moving: !!f.walk, laugh: 0, flee: false, lines: f.lines });
      if (f.lines && f.pos.distanceTo(cam) < 14 && T > (f.talkT ?? 0)) { f.talkT = T + 9 + h01(f.seed, Math.floor(T)) * 10; this.say(f.pos.clone().setY(f.pos.y + 1.9), line(f.lines)); }
    }
    for (const w of this.walkers.values()) if (w.laugh > 0) w.laugh -= dt;
    const scored = cands.map((c) => ({ c, d: c.pos.distanceToSquared(cam) })).filter((o) => o.d < 42 * 42).sort((a, b) => a.d - b.d).slice(0, this.nearCap);
    const want = new Set(scored.map((o) => o.c.key));
    for (const [k, r] of this.rigs) if (!want.has(k)) { r.rig.root.removeFromParent(); r.rig.dispose(); this.rigs.delete(k); }
    this.createBudget = Math.min(1, this.createBudget + dt * 3);
    for (const { c, d } of scored) {
      let r = this.rigs.get(c.key);
      if (!r) {
        if (this.createBudget < 1) continue;
        this.createBudget = 0;
        try {
          const rig = this.game.chars.create(this.lookFor(c.key, c.arch, c.seed), { lod: 'low', castShadow: false });
          this.group.add(rig.root);
          r = { rig, anim: '', last: c.pos.clone(), bubbleT: 0 };
          this.rigs.set(c.key, r);
        } catch { continue; }
      }
      const rig = r.rig;
      rig.root.position.copy(c.pos);
      rig.root.rotation.y = c.yaw;
      const sp = c.moving ? Math.min(6, c.pos.distanceTo(r.last) / Math.max(dt, 1e-4)) : 0;
      r.last.copy(c.pos);
      const anim = c.anim === 'walk' ? 'idle' : c.anim;
      if (anim !== r.anim) { r.anim = anim; try { rig.play(anim as any, { loop: true }); } catch {} }
      rig.setMove(c.anim === 'walk' || c.anim === 'scream_run' ? Math.max(sp, c.flee ? 4.5 : 1.1) : 0);
      // glance at nearby players
      let lookP: THREE.Vector3 | null = null;
      for (const pp of players) if (pp.distanceTo(c.pos) < 4.5) { lookP = pp.clone().setY(pp.y + 1.55); break; }
      rig.lookAt(lookP);
      if (d < 20 * 20 || (RigFrame & 1) === 0) rig.update(d < 20 * 20 ? dt : dt * 2);
    }
    RigFrame++;

    // ---- impostors for the rest (40–110 m)
    const imp = this.imp!;
    let n = 0;
    for (const w of this.walkers.values()) {
      if (w.gone || this.rigs.has('w' + w.key)) continue;
      const d = w.pos.distanceTo(cam);
      if (d > 110 || n >= imp.body.instanceMatrix.count) continue;
      const step = Math.sin(T * 7 * w.speed + (w.seed % 100)) * 0.025;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
      const L = this.lookFor('w' + w.key, w.arch, w.seed);
      const h = (L.height ?? 1.65) / 1.65;
      this._s.set(1 + (L.build ?? 0.4) * 0.3, h, 1 + (L.build ?? 0.4) * 0.3);
      this._m.compose(new THREE.Vector3(w.pos.x, w.pos.y + Math.abs(step), w.pos.z), this._q, this._s);
      imp.body.setMatrixAt(n, this._m); imp.legs.setMatrixAt(n, this._m); imp.head.setMatrixAt(n, this._m);
      imp.body.setColorAt(n, this._c.set(L.top?.color ?? TOPS[w.seed % TOPS.length]));
      imp.legs.setColorAt(n, this._c.set(L.bottom?.color ?? BOTS[w.seed % BOTS.length]));
      imp.head.setColorAt(n, this._c.set(L.skin ?? SKIN[w.seed % SKIN.length]));
      n++;
    }
    for (const m of [imp.body, imp.legs, imp.head]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private sayT = 0;
  private say(p: THREE.Vector3, text: any) {
    const t = this.life.clock.t;
    if (t < this.sayT) return;
    this.sayT = t + 1.5;
    this.game.ui.say(p.clone().setY(p.y + (p.y < 1 ? 1.9 : 0)), text, { duration: 2.6 });
  }

  get count() { return this.walkers.size; }
  get rigCount() { return this.rigs.size; }
}

let RigFrame = 0;
