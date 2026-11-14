import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig, Look } from '../../game/contracts';
import { h01, hashN, hweighted, bump, qmul, quality } from './util';
import { line } from './lines';
import { play } from './sounds';
import type { Life } from './index';
import { LocalTalkers, TalkTarget } from '../quests/api';
import { ARCHETYPES } from '../characters/defs';
import { blockedAhead, insideStatic } from '../../game/steer';

/** set pieces being talked to (key 'f'+setPieceKey → anim): they stop walking, face the player and talk */
export const CrowdHold = new Map<string, string>();
const TALK_ROLE = (key: string, arch: string) => (key.startsWith('win') ? 'moto_taxi' : key.startsWith('gos') ? 'gossip' : key === 'lotto' ? 'lottery_walker' : arch);
const TALK_NAME = (key: string, arch: string) => (key.startsWith('win') ? { th: 'พี่วิน', en: 'moto-taxi guy' } : key.startsWith('gos') ? { th: 'ป้าเม้าท์', en: 'gossip auntie' } : key === 'lotto' ? { th: 'ป้าลอตเตอรี่', en: 'lottery lady' } : ARCHETYPES[arch]?.name ?? { th: 'คนแถวนี้', en: 'local' });
const talkProxyGeo = new THREE.CapsuleGeometry(0.32, 1.0, 2, 6).translate(0, 0.85, 0);
const talkProxyMat = new THREE.MeshBasicMaterial({ visible: false });

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
interface Walker {
  key: string; path: Path; slot: number; dir: 1 | -1; speed: number; t0: number; lat: number; arch: string; seed: number; pos: THREE.Vector3; yaw: number; flee: number; fleeDir: THREE.Vector3 | null; laugh: number; gone: boolean;
  /** obstacle avoidance: current / wanted lateral detour (m), hold timer, probe timer, time lost waiting, stuck timer */
  av: number; avT: number; hold: number; chk: number; delay: number; stuck: number;
}
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
  private rigs = new Map<string, { rig: CharacterRig; anim: string; last: THREE.Vector3; bubbleT: number; low?: boolean; fresh?: boolean }>();
  private looks = new Map<string, Look>();
  private group: THREE.Group | null = null;
  private imp: { body: THREE.InstancedMesh; legs: THREE.InstancedMesh; head: THREE.InstancedMesh } | null = null;
  /** baked real-character impostors: VARIANTS looks × 2 stride frames (replace the capsule figures once ready) */
  private bakedImp: { frames: [THREE.InstancedMesh, THREE.InstancedMesh]; rig: CharacterRig; n: [number, number] }[] = [];
  private bakeTried = false;
  private bakePending: { rig: CharacterRig; n: number; vi: number }[] = [];
  private seed = 1;
  private nearCap = 12;
  private built = false;
  private tmpV = new THREE.Vector2();
  private tmpT = new THREE.Vector2();
  private laughAt: { p: THREE.Vector3; t: number } | null = null;
  private createBudget = 0;
  private fullFaces = false;

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
    this.nearCap = q === 'low' ? 6 : q === 'medium' ? 10 : q === 'ultra' ? 20 : 15;
    this.fullFaces = q === 'high' || q === 'ultra';
    const k = 1 / qmul();
    // sidewalk paths (walking lanes kept clear by world/dressing: soi ±4.6, main road z 3.55 / 23.6, market aisles between the stall islands, temple, canal, rural road)
    this.paths = [
      mkPath(0, [[-4.6, 1], [-4.6, -157]], 4.6 * k, 'soi', 0.8),
      mkPath(1, [[4.6, 1], [4.6, -19], [6.3, -21], [6.3, -27], [4.6, -29], [4.6, -157]], 4.8 * k, 'soi', 0.8),
      mkPath(2, [[-128, 3.55], [-3.8, 3.55]], 3.8 * k, 'mainroad', 0.8),
      mkPath(3, [[3.8, 3.55], [128, 3.55]], 4 * k, 'mainroad', 0.8),
      mkPath(4, [[-128, 23.6], [128, 23.6]], 6 * k, 'mainroad', 1.2),
      mkPath(5, [[7, -46.4], [48, -46.4]], 4.5 * k, 'market', 1.0),
      mkPath(6, [[7, -64.4], [48, -64.4]], 4.5 * k, 'market', 1.0),
      mkPath(7, [[7, -74.5], [48, -74.5]], 5 * k, 'market', 1.0),
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
    this.clearTalkers();
    for (const r of this.rigs.values()) { r.rig.root.removeFromParent(); r.rig.dispose(); }
    this.rigs.clear();
    this.walkers.clear();
    this.group?.removeFromParent();
    this.group = null;
    this.imp = null;
    for (const b of this.bakedImp) { if (!b) continue; for (const f of b.frames) f.geometry.dispose(); b.rig.dispose(); }
    this.bakedImp = [];
    for (const p of this.bakePending) p.rig.dispose();
    this.bakePending = [];
    this.bakeTried = false;
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

  private bakedReady() { let n = 0; for (const b of this.bakedImp) if (b) n++; return n; }

  private lookFor(key: string, arch: string, seed: number): Look {
    // walkers are cast members (same person as their far impostor); set pieces keep their own looks
    if (key.startsWith('w') && this.ensureVariants()) return this.variants[this.variantOf(arch, seed)].look;
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

  /**
   * Far walkers used to be capsules (a lathe body, a cylinder for legs, a ball head): they read as "lazy simple
   * shapes" at 15-40 m. Bake a handful of REAL character rigs (low LOD, real fabric atlas) into static meshes at two
   * opposite walk-cycle phases and draw them instanced; walkers alternate frames with their stride.
   */
  /**
   * The crowd's cast: a fixed list of variant looks (archetype + look), created once. EVERY walker is one of these
   * people — the far baked impostor and the near real rig use the SAME look, so nobody "changes person" when the
   * LOD swaps (it used to: impostor = variant look, rig = the walker's own random look).
   */
  private variants: { arch: string | undefined; look: Look }[] = [];
  private ensureVariants() {
    if (this.variants.length) return true;
    const chars: any = this.game.chars;
    if (!chars?.randomLook) return false;
    const all: string[] = chars.archetypes?.() ?? [];
    const want = ['office', 'auntie', 'student', 'worker', 'uncle', 'teen', 'grandma', 'vendor', 'tourist', 'rider', 'housewife', 'grandpa'];
    const archs = [...want.map((w) => all.find((a) => a.includes(w))).filter(Boolean) as string[], ...all].filter((a, i, A) => A.indexOf(a) === i).slice(0, 12);
    while (archs.length < 6) archs.push(undefined as any);
    this.variants = archs.map((arch, i) => ({ arch, look: chars.randomLook(arch, 7919 * (i + 3) + this.seed) as Look }));
    return true;
  }
  /** stable variant index for a walker: same archetype when the cast has one, else by seed */
  private variantOf(arch: string, seed: number) {
    const V = this.variants;
    const same: number[] = [];
    V.forEach((v, i) => { if (v.arch === arch) same.push(i); });
    const pool = same.length ? same : V.map((_, i) => i);
    return pool[seed % pool.length];
  }
  private bakeImpostors() {
    if (this.bakeTried || !this.group) return;
    const chars: any = this.game.chars;
    if (!chars?.create || !this.ensureVariants()) return;
    this.bakeTried = true;
    this.bakedImp = this.variants.map(() => null as any);
    this.variants.forEach((v, i) => {
      try {
        const rig: CharacterRig = chars.create(v.look, { lod: 'low', castShadow: false });
        rig.play('idle' as any, { loop: true });
        rig.setMove(1.25);
        this.bakePending.push({ rig, n: 0, vi: i });
      } catch (e) { console.warn('[life] impostor rig failed', e); }
    });
  }

  /** Bake pending impostor rigs once their animation clips are really playing (clips stream in per body
   *  template: a too-early bake captured the bind T-pose). A bake wider than 1.1 m is still a T-pose → retry. */
  private bakeStep() {
    if (!this.bakePending.length || !this.group) return;
    for (const p of [...this.bakePending]) {
      p.rig.update(1 / 30);
      p.n++;
      if (p.n < 30 || p.n % 10) continue;
      const sm: THREE.SkinnedMesh | undefined = (p.rig as any).mesh_ ?? (p.rig as any).mesh;
      const drop = () => { this.bakePending.splice(this.bakePending.indexOf(p), 1); };
      if (!sm?.isSkinnedMesh) { p.rig.dispose(); drop(); continue; }
      const geos: THREE.BufferGeometry[] = [];
      for (const ph of [0.12, 0.62]) {
        (p.rig as any).phase = ph;
        p.rig.update(1e-4);
        geos.push(bakeSkinned(sm, p.rig.root));
      }
      geos[0].computeBoundingBox();
      const bb = geos[0].boundingBox!;
      if (bb.max.x - bb.min.x > 1.1) {                      // arms straight out: clips not playing yet
        for (const g of geos) g.dispose();
        if (p.n > 900) { p.rig.dispose(); drop(); }
        continue;
      }
      const cap = 90;
      const frames = geos.map((geo) => {
        const bodyMat = new THREE.MeshStandardMaterial({ map: (Array.isArray(sm.material) ? sm.material[0] : sm.material as any).map, roughness: 0.82, metalness: 0 });
        const mats = Array.isArray(sm.material) ? [bodyMat, sm.material[1] ?? bodyMat] : bodyMat;
        const im = new THREE.InstancedMesh(geo, mats as any, cap);
        im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
        im.name = 'crowd-impostor';
        this.group!.add(im);
        return im;
      }) as [THREE.InstancedMesh, THREE.InstancedMesh];
      this.bakedImp[p.vi] = { frames, rig: p.rig, n: [0, 0] };
      drop();
    }
    // capsules only stay as a fallback until a few real variants are ready
    if (this.bakedReady() >= 3 && this.imp) for (const m of [this.imp.body, this.imp.legs, this.imp.head]) m.visible = false;
  }

  // ------------------------------------------------------------------ public hooks (combat / scripted scenes)

  /** the walker nearest `p` within `r` (optionally inside a forward cone around `dir`), with its exact look */
  find(p: THREE.Vector3, r: number, dir?: THREE.Vector3, cone = 0.45): { key: string; p: [number, number, number]; yaw: number; arch: string; look: Look } | null {
    let best: Walker | null = null, bd = Infinity;
    for (const w of this.walkers.values()) {
      if (w.gone || w.pos.lengthSq() === 0) continue;
      const dx = w.pos.x - p.x, dz = w.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > r || d < 0.05) continue;
      if (dir && (dx * dir.x + dz * dir.z) / d < cone) continue;
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) return null;
    return { key: best.key, p: [best.pos.x, best.pos.y, best.pos.z], yaw: best.yaw, arch: best.arch, look: this.lookFor('w' + best.key, best.arch, best.seed) };
  }
  /** take a walker out of the ambient crowd (an entity takes its place); returns its data or null */
  takeOver(key: string) {
    const w = this.walkers.get(key);
    if (!w || w.gone) return null;
    w.gone = true;
    return { key, p: [w.pos.x, w.pos.y, w.pos.z] as [number, number, number], yaw: w.yaw, arch: w.arch, look: this.lookFor('w' + w.key, w.arch, w.seed) };
  }
  /** give a taken-over walker back to the crowd (it resumes its schedule) */
  release(key: string) { const w = this.walkers.get(key); if (w) { w.gone = false; w.stuck = 0; } }

  // ------------------------------------------------------------------ obstacle avoidance

  /** positions of near walkers from the previous frame (separation) */
  private nearPrev: { w: Walker; x: number; z: number }[] = [];
  private nearNow: { w: Walker; x: number; z: number }[] = [];
  /** debug counters (window.__crowdStats): walker-frames inside static colliders / overlapping another walker */
  stats = { frames: 0, checked: 0, inside: 0, insideLane: 0, overlap: 0, overlapLane: 0 };

  private avoid(w: Walker, target: THREE.Vector3, nx: number, nz: number, tx: number, tz: number, lat: number, cam: THREE.Vector3, dt: number) {
    const phys: any = this.game.physics;
    const dcam = Math.hypot(target.x - cam.x, target.z - cam.z);
    if (!phys || dcam > 55) { w.av += (0 - w.av) * Math.min(1, dt * 2); w.avT = 0; return; }
    const y = w.pos.y || this.game.world?.groundY(target.x, target.z) || 0.15;
    const half = w.path.width / 2 + 2.4;            // how far off the lane a detour may go
    w.hold -= dt; w.chk -= dt;
    // separation: someone close ahead/beside in my lane → slide to the free side
    for (const o of this.nearPrev) {
      if (o.w === w) continue;
      const dx = o.x - target.x - nx * w.av, dz = o.z - target.z - nz * w.av;
      const fwd = dx * tx + dz * tz, side = dx * nx + dz * nz;
      if (fwd > -0.3 && fwd < 1.6 && Math.abs(side) < 0.62) {
        const push = side >= 0 ? -0.7 : 0.7;
        if (Math.abs(lat + w.av + push) < half) { w.avT = w.av + push; w.hold = Math.max(w.hold, 1.0); }
      }
    }
    if (w.chk <= 0) {
      w.chk = 0.12 + (w.seed % 9) * 0.008;
      const at = (a: number) => [target.x + nx * a, target.z + nz * a] as const;
      const free = (a: number) => {
        const [qx, qz] = at(a);
        return !insideStatic(phys, qx, y, qz, 0.26) && blockedAhead(phys, qx, y, qz, tx, tz, 1.7) === null;
      };
      if (!free(w.avT)) {
        let best: number | null = null;
        for (const o of [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4]) {
          const a = w.avT + o;
          if (Math.abs(lat + a) > half) continue;
          if (free(a)) { best = a; break; }
        }
        if (best !== null) { w.avT = best; w.hold = 1.4; w.stuck = 0; }
        else w.stuck += 0.16;
      } else {
        w.stuck = 0;
        if (w.hold <= 0 && Math.abs(w.avT) > 0.01 && free(0)) w.avT = 0;   // back to the lane once it's clear
      }
    }
    // fully blocked: wait (the schedule is delayed) — far away walkers that stay stuck just leave
    if (w.stuck > 0) { w.delay += dt; if (w.stuck > 5 && dcam > 16) w.gone = true; }
    w.av += (w.avT - w.av) * Math.min(1, dt * 4);
    this.nearNow.push({ w, x: target.x + nx * w.av, z: target.z + nz * w.av });
    // metrics
    if (dcam < 30) {
      this.stats.checked++;
      if (insideStatic(phys, target.x + nx * w.av, y, target.z + nz * w.av, 0.18)) this.stats.inside++;
      if (insideStatic(phys, target.x, y, target.z, 0.18)) this.stats.insideLane++;   // where it would stand without avoidance
    }
  }

  // ------------------------------------------------------------------ frame

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();
  private _c = new THREE.Color();
  private _p = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);
  private _fwd = new THREE.Vector3();

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
      const maxDur = P.len / 0.9 + 25;   // + slack for walkers that waited behind an obstacle
      const i0 = Math.max(0, Math.floor((T - maxDur) / P.gap)), i1 = Math.floor(T / P.gap);
      for (let i = i0; i <= i1; i++) {
        const t0 = i * P.gap + h01(this.seed, P.id, i, 1) * P.gap * 0.6;
        if (t0 > T) continue;
        const hourAt = hour - (T - t0) / 66.7;
        if (h01(this.seed, P.id, i, 2) > this.density(P.zone, hourAt)) continue;
        const speed = 1.0 + h01(this.seed, P.id, i, 3) * 0.55;
        const key = P.id + ':' + i;
        let w = this.walkers.get(key);
        const s = (T - t0 - (w?.delay ?? 0)) * speed;
        if (s > P.len) continue;
        if (!w) {
          const dir: 1 | -1 = h01(this.seed, P.id, i, 4) < 0.5 ? 1 : -1;
          w = { key, path: P, slot: i, dir, speed, t0, lat: (h01(this.seed, P.id, i, 5) - 0.5) * P.width, arch: this.archFor(P.zone, hourAt, this.seed, P.id, i, 6), seed: hashN(this.seed, P.id, i), pos: new THREE.Vector3(), yaw: 0, flee: 0, fleeDir: null, laugh: 0, gone: false, av: 0, avT: 0, hold: 0, chk: h01(this.seed, P.id, i, 7) * 0.2, delay: 0, stuck: 0 };
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
        // ---- don't walk through things: steer around props / parked vehicles / walls / other walkers (near the camera)
        if (w.flee <= 0) this.avoid(w, target, nx, nz, this.tmpT.x, this.tmpT.y, lat, cam, dt);
        target.x += nx * w.av; target.z += nz * w.av;
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
    // separation uses last frame's near positions; count walker overlaps for the stats
    for (let a = 0; a < this.nearNow.length; a++) for (let b = a + 1; b < this.nearNow.length; b++) {
      const A = this.nearNow[a], Bq = this.nearNow[b];
      if (Math.abs(A.x - Bq.x) < 0.4 && Math.abs(A.z - Bq.z) < 0.4 && Math.hypot(A.x - Bq.x, A.z - Bq.z) < 0.38) this.stats.overlap++;
    }
    this.nearPrev = this.nearNow; this.nearNow = [];
    this.stats.frames++;
    (window as any).__crowdStats = this.stats;

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
    const me = game.player;
    for (const f of this.fixed) {
      if (hour < f.from || hour > f.to) continue;
      const held = CrowdHold.get('f' + f.key);
      if (held) {
        // talking: stand still, turn to the player
        if (me) f.yaw = Math.atan2(me.pos.x - f.pos.x, me.pos.z - f.pos.z);
        cands.push({ key: 'f' + f.key, arch: f.arch, seed: f.seed, pos: f.pos, yaw: f.yaw, anim: held, moving: false, laugh: 0, flee: false, lines: f.lines });
        continue;
      }
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
    // who gets a real rig: nearest first, but people in front of the camera count as ~2.5x closer than people behind it
    const fwd = game.camera.getWorldDirection(this._fwd);
    const scored = cands.map((c) => {
      const d = c.pos.distanceToSquared(cam);
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, inv = 1 / Math.max(0.01, Math.hypot(dx, dz));
      const front = (dx * fwd.x + dz * fwd.z) * inv;            // -1 behind … 1 ahead
      return { c, d, s: d * (front > 0.35 ? 0.16 : front > -0.2 ? 0.5 : 1) };
    }).filter((o) => o.d < 46 * 46).sort((a, b) => a.s - b.s).slice(0, this.nearCap);
    const want = new Set(scored.map((o) => o.c.key));
    for (const [k, r] of this.rigs) if (!want.has(k)) { r.rig.root.removeFromParent(); r.rig.dispose(); this.rigs.delete(k); }
    this.createBudget = Math.min(1, this.createBudget + dt * 3);
    for (const { c, d } of scored) {
      let r = this.rigs.get(c.key);
      // close up (≤ 11 m, high/ultra): swap the low-LOD body for a full rig with the scanned 3D face
      const wantFull = this.fullFaces && d < 11 * 11;
      if (r && r.low && wantFull && this.createBudget >= 1) {
        this.createBudget = 0;
        r.rig.root.removeFromParent(); r.rig.dispose(); this.rigs.delete(c.key); r = undefined;
      }
      if (!r) {
        if (this.createBudget < 1) continue;
        this.createBudget = 0;
        try {
          const rig = this.game.chars.create(this.lookFor(c.key, c.arch, c.seed), wantFull ? { castShadow: d < 8 * 8 } : { lod: 'low', castShadow: false });
          this.group.add(rig.root);
          // hidden until its clothing atlas is painted (no naked skin-coloured bodies) and posed (no T-pose frame)
          rig.root.visible = false;
          r = { rig, anim: '', last: c.pos.clone(), bubbleT: 0, low: !wantFull, fresh: true };
          this.rigs.set(c.key, r);
        } catch { continue; }
      }
      const rig = r.rig;
      if (!rig.root.visible && !r.fresh && (rig as any).atlasE?.painted !== false) rig.root.visible = true;
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
      if (r.fresh || d < 20 * 20 || (RigFrame & 1) === 0) { rig.update(d < 20 * 20 || r.fresh ? dt : dt * 2); r.fresh = false; }
    }
    RigFrame++;
    this.syncTalkers();

    // ---- impostors for the rest (real baked characters; capsules only as a fallback)
    if (!this.bakeTried && this.game.chars && T > 0.5) this.bakeImpostors();
    this.bakeStep();
    if (this.bakedReady() >= 3) {
      const B = this.bakedImp;
      for (const b of B) if (b) b.n[0] = b.n[1] = 0;
      for (const w of this.walkers.values()) {
        if (w.gone || this.rigs.has('w' + w.key)) continue;
        const d = w.pos.distanceTo(cam);
        if (d > 130) continue;
        const b = B[this.variantOf(w.arch, w.seed)];
        if (!b) continue;                          // that person's impostor isn't baked yet: never show someone else
        const stride = Math.floor((T * 1.9 * w.speed + (w.seed % 97) * 0.013) % 2) as 0 | 1;
        const im = b.frames[stride];
        if (b.n[stride] >= im.instanceMatrix.count) continue;
        const L = this.lookFor('w' + w.key, w.arch, w.seed);
        const hs = (L.height ?? 1.65) / 1.65;
        this._q.setFromAxisAngle(this._up, w.yaw + (w.flee > 0 ? 0 : 0));
        this._s.set(hs * (0.96 + (w.seed % 7) * 0.012), hs, hs);
        const bob = Math.abs(Math.sin(T * 6 * w.speed + (w.seed % 100))) * 0.02;
        this._m.compose(this._p.set(w.pos.x, w.pos.y + bob, w.pos.z), this._q, this._s);
        im.setMatrixAt(b.n[stride]++, this._m);
      }
      for (const b of B) if (b) for (let f = 0; f < 2; f++) { const im = b.frames[f]; im.count = b.n[f]; im.instanceMatrix.needsUpdate = true; }
      return;
    }
    // with real characters available, far walkers simply wait for their baked impostors (never capsules)
    if (this.game.chars) { if (this.imp) for (const m of [this.imp.body, this.imp.legs, this.imp.head]) { m.visible = false; m.count = 0; } return; }
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

  // ------------------------------------------------------------------ talkable set pieces (quests module)
  private talkers = new Map<string, THREE.Mesh>();
  private syncTalkers() {
    if (!this.group) return;
    for (const [k, r] of this.rigs) {
      if (!k.startsWith('f') || this.talkers.has(k)) continue;
      const f = this.fixed.find((x) => 'f' + x.key === k);
      if (!f) continue;
      const proxy = new THREE.Mesh(talkProxyGeo, talkProxyMat);
      proxy.name = 'crowd-talk-proxy';
      this.group.add(proxy);
      const name = TALK_NAME(f.key, f.arch);
      const target: TalkTarget = {
        kind: 'local', key: 'crowd:' + f.key, role: TALK_ROLE(f.key, f.arch), name,
        head: () => { const rr = this.rigs.get(k); const hw = (rr?.rig as any)?.headWorld; if (hw) { try { return hw.call(rr!.rig, new THREE.Vector3()); } catch {} } return f.pos.clone().setY(f.pos.y + 1.55); },
        act: (anim) => { if (!anim || anim === 'idle') CrowdHold.delete(k); else CrowdHold.set(k, anim); },
      };
      this.game.interact.register(proxy, { kind: 'local_talk', data: { key: target.key, name }, reach: 3 });
      LocalTalkers.add(target, proxy);
      this.talkers.set(k, proxy);
      void r;
    }
    for (const [k, proxy] of this.talkers) {
      const r = this.rigs.get(k);
      if (!r) { this.game.interact.unregister(proxy); proxy.removeFromParent(); LocalTalkers.remove('crowd:' + k.slice(1)); CrowdHold.delete(k); this.talkers.delete(k); continue; }
      proxy.position.copy(r.rig.root.position);
      proxy.visible = r.rig.root.visible;
    }
  }
  private clearTalkers() {
    for (const [k, proxy] of this.talkers) { this.game.interact.unregister(proxy); proxy.removeFromParent(); LocalTalkers.remove('crowd:' + k.slice(1)); }
    this.talkers.clear();
    CrowdHold.clear();
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

/**
 * CPU-skin a SkinnedMesh in its current pose into a static geometry in `root`'s local space (positions +
 * normals skinned with the blended bone matrices; uv, groups and other attributes copied).
 */
function bakeSkinned(sm: THREE.SkinnedMesh, root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  sm.skeleton.update();
  const src = sm.geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const si = src.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = src.getAttribute('skinWeight') as THREE.BufferAttribute;
  const bm = sm.skeleton.boneMatrices!;
  // exactly what the skinning shader does: modelMatrix · bindMatrixInverse · Σ wₖBₖ · bindMatrix · p, then into root space
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(sm.matrixWorld).multiply(sm.bindMatrixInverse);
  const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
  const M = new THREE.Matrix4(), Mk = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3(), N3 = new THREE.Matrix3();
  for (let i = 0; i < pos.count; i++) {
    M.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      Mk.fromArray(bm, si.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) M.elements[e] += Mk.elements[e] * w;
    }
    M.premultiply(toLocal).multiply(sm.bindMatrix);
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (nrm) {
      n.fromBufferAttribute(nrm, i).applyMatrix3(N3.getNormalMatrix(M)).normalize();
      N[i * 3] = n.x; N[i * 3 + 1] = n.y; N[i * 3 + 2] = n.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  for (const name of Object.keys(src.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'skinIndex' || name === 'skinWeight') continue;
    g.setAttribute(name, (src.getAttribute(name) as THREE.BufferAttribute).clone());
  }
  if (src.index) g.setIndex(src.index.clone());
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  if (!nrm) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
