import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { params, tl, round } from '../../core/util';
import { Sound, SoundHandle } from '../../core/audio';
import { G } from '../../sim/physics';
import { CANAL } from '../world/layout';
import { registerWaterSounds, wsnd, wloop } from './sounds';
import { Volumes, WaterVolume } from './volumes';
import { RippleField } from './ripples';
import { SHARED, makeSurfaceMat } from './surface';
import { Droplets, Crowns, Rings, Stream, Swirls, FXU } from './fx';
import { Puddles } from './puddles';
import { Buoyancy } from './buoyancy';
import { CONT, defineContainers, buildHoseNozzle, amountOf, SloshSys, ContainerHost, DynVolumes, levelY } from './containers';
import { buildWashCorner, TAPS, defineHose, HoseRope, HOSE_LEN, tapOn, hoseEnt, WashProps } from './taps';
import { RainWater } from './rain';
import { waterLab } from './lab';

/* =============================================================================================
 * MODULE: water — volumes + buoyancy (items float, bob, drift with the canal current or sink),
 * splashes (crown, instanced droplets, rings, ripple heightfield, impact-scaled sounds), sloshing
 * liquid in containers, spills → spreading puddles that dry and creep into drains (swirl), rain
 * rings/drips/gutter gushes, taps + a garden hose, buckets/basins you fill, pour and throw.
 * Replicated: data.water on our containers, g.wtaps, item.pour / item.spray flags. All visuals local.
 * Dev: ?waterlab (wash corner) · ?waterlab=canal · ?waterlab=spill · ?rain=1 · window.__water
 * ============================================================================================= */

const vols = new Volumes();
let game: Game;
let field: RippleField | null = null;
let drops: Droplets | null = null, crowns: Crowns | null = null, rings: Rings | null = null, swirls: Swirls | null = null;
let puddles: Puddles | null = null;
let slosh: SloshSys | null = null;
let rainW: RainWater | null = null;
let wash: WashProps | null = null;
let rope: HoseRope | null = null;
let canalPatch: THREE.Mesh | null = null;
let fxRoot: THREE.Group | null = null;
let buoy: Buoyancy | null = null;
let chost: ContainerHost | null = null;
let dynv: DynVolumes | null = null;
let canalVol: WaterVolume | null = null;
const streams: Stream[] = [];
const owner: (string | null)[] = [];
const usedF: number[] = [];
let frameNo = 0;
let volT = 0, drainT = 0;
const spills = new Map<number, { until: number; p: number[]; g: number[]; d: number[]; l: number; acc: number }>();
const loops = new Map<string, { h: SoundHandle; f: number }>();
const lastY = new Map<number, number>();
const sprayCool = new Map<number, number>();
let sprayAcc = 0, tapAcc = 0, dribbleAcc = 0;
const ownDrains: { x: number; z: number; y: number }[] = [];
const low = () => game.engine.quality === 'low';
const now = () => performance.now() / 1000;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _cam = new THREE.Vector3(), _q = new THREE.Quaternion();

// ------------------------------------------------------------------ helpers

function ground(x: number, z: number) { return game.world?.groundY(x, z) ?? 0; }

function useStream(key: string): Stream | null {
  let i = owner.indexOf(key);
  if (i < 0) { i = owner.indexOf(null); if (i < 0) return null; owner[i] = key; }
  usedF[i] = frameNo;
  return streams[i];
}
function endStreams() { for (let i = 0; i < streams.length; i++) if (owner[i] && usedF[i] !== frameNo) { owner[i] = null; streams[i].hide(); } }

/** keep a looping sound alive for this frame */
function loopAt(key: string, snd: string, p: THREE.Vector3 | number[], vol: number, pitch = 1) {
  let l = loops.get(key);
  if (!l) { l = { h: wloop(snd, p as any, { vol, pitch }), f: frameNo }; loops.set(key, l); }
  l.f = frameNo;
  l.h.setPos?.(p as any);
  l.h.setVolume?.(vol, 0.1);
}
function endLoops() { for (const [k, l] of loops) if (l.f !== frameNo) { l.h.stop?.(0.25); loops.delete(k); } }

/** splash: crown + droplets + rings + heightfield + sound (strength s ≈ 0..1.5) */
export function splash(x: number, y: number, z: number, s: number, sink = false, quiet = false) {
  if (!drops || !crowns || !rings) return;
  if (Math.hypot(x - _cam.x, z - _cam.z) > 70) return;
  s = Math.max(0.03, Math.min(1.6, s));
  const R = Math.random;
  if (s > 0.14) crowns.spawn(x, y, z, 0.04 + s * 0.2, 0.07 + s * 0.42, 0.42 + s * 0.28);
  const n = Math.round((4 + s * 38) * (low() ? 0.5 : 1));
  for (let i = 0; i < n; i++) {
    const a = R() * 6.283, sp = (0.3 + R() * 1.5) * (0.35 + s), up = (0.9 + R() * 2.6) * (0.4 + s * 0.85);
    drops.spawn(x + Math.cos(a) * 0.03, y + 0.01, z + Math.sin(a) * 0.03, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.0045 + R() * 0.009 * (0.6 + s), y - 0.005, 0, 2.2);
  }
  rings.spawn(x, y, z, 0.25 + s * 1.1, 1, 0.9 + s * 0.8);
  if (s > 0.4) rings.spawn(x, y, z, 0.12 + s * 0.6, 0.7, 0.6 + s * 0.4);
  if (field?.covers(x, z)) field.drop(x, z, 1.4 + s * 5, 0.06 + s * 0.16);
  if (!quiet) {
    const key = s < 0.22 ? 'wt_plop' : s < 0.65 ? 'wt_splash_m' : 'wt_splash_l';
    wsnd(key, [x, y, z], { vol: Math.min(1, 0.25 + s * 0.6), pitch: 1.2 - Math.min(0.4, s * 0.28) + R() * 0.1 });
  }
  if (sink) for (let k = 0; k < 3; k++) setTimeout(() => { rings?.spawn(x + (R() - 0.5) * 0.1, y, z + (R() - 0.5) * 0.1, 0.08 + R() * 0.08, 0.8, 0.5); if (field?.covers(x, z)) field.drop(x, z, 0.5, 0.04); if (k < 2) wsnd('wt_bubble', [x, y, z], { vol: 0.22 }); }, 450 + k * 420 + R() * 200);
}

/** footstep-sized splash on a wet floor */
function stepSplash(x: number, y: number, z: number, k = 0.5) {
  if (!drops || !rings) return;
  const R = Math.random;
  for (let i = 0; i < 7 * k + 3; i++) { const a = R() * 6.283, sp = 0.3 + R() * 0.8; drops.spawn(x, y + 0.01, z, Math.cos(a) * sp, 0.5 + R() * 1.1 * k, Math.sin(a) * sp, 0.004 + R() * 0.004, y, 3, 0.8); }
  rings.spawn(x, y, z, 0.18 + k * 0.25, 0.8, 0.7);
  if (field?.covers(x, z)) field.drop(x, z, 1.2 * k + 0.4, 0.08);
}

function landed(x: number, y: number, z: number, size: number, kind: number) {
  if (kind === 2) { rainW?.dripLanded(x, y, z, { rings: rings!, field: field!, puddles: puddles! }, _cam); return; }
  if (kind === 3) return;
  if (field?.covers(x, z)) field.drop(x, z, size * 55, 0.035);
  if (Math.random() < 0.12) rings?.spawn(x, y, z, 0.05 + size * 6, 0.6, 0.45);
}

/** parabola start velocity to land on target from p0 with a given launch vy */
function aimVel(p0: THREE.Vector3, tgt: THREE.Vector3, vy: number, out: THREE.Vector3) {
  const dy = p0.y - tgt.y;
  const a = 4.905, disc = vy * vy + 4 * a * Math.max(-0.2, dy);
  const T = Math.max(0.08, (vy + Math.sqrt(Math.max(0, disc))) / (2 * a));
  return out.set((tgt.x - p0.x) / T, vy, (tgt.z - p0.z) / T);
}

/** world rim point (front) of a container's visual, for pour streams */
function rimWorld(e: Ent, out: THREE.Vector3): boolean {
  const s = CONT[e.k];
  const obj = game.views.objectOf(e.id);
  if (!s || !obj) return false;
  const vis = obj.children[0] ?? obj;
  vis.updateWorldMatrix(true, false);
  out.set(0, s.h + 0.005, -s.r - 0.008);
  vis.localToWorld(out);
  return true;
}

function emitPuddle(p: number[], l: number) {
  if (l <= 0.005) return;
  game.emit('wt:puddle', { p: [round(p[0], 2), round(p[1], 3), round(p[2], 2)], l: round(l, 3) });
}

/** camera ray vs water volume surfaces (for "fill") */
function rayWater(cam: THREE.Camera, max = 3.4, exclude?: number): { v: WaterVolume; p: THREE.Vector3; d: number } | null {
  cam.getWorldPosition(_v);
  cam.getWorldDirection(_v2);
  let best: { v: WaterVolume; p: THREE.Vector3; d: number } | null = null;
  for (const v of vols.list) {
    if (v.eid != null && v.eid === exclude) continue;
    if (Math.abs(_v2.y) < 1e-3) continue;
    const t = (v.level - _v.y) / _v2.y;
    if (t <= 0 || t > max) continue;
    const x = _v.x + _v2.x * t, z = _v.z + _v2.z * t;
    if (!vols.inside(v, x, z, 0.02)) continue;
    if (!best || t < best.d) best = { v, p: new THREE.Vector3(x, v.level, z), d: t };
  }
  if (best && game.physics) {
    const h = game.physics.raycast(_v, _v2, best.d, G.STATIC);
    if (h && h.toi < best.d - 0.15) return null;   // a wall in between
  }
  return best;
}

/** where the player is aiming (physics hit or 2 m ahead on the ground) */
function aimPoint(cam: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  cam.getWorldPosition(_v);
  cam.getWorldDirection(_v2);
  const h = game.physics?.raycast(_v, _v2, 3.6, G.STATIC | G.ITEM);
  if (h) return out.copy(h.point);
  out.copy(_v).addScaledVector(_v2, 2.0);
  out.y = ground(out.x, out.z);
  return out;
}

// ------------------------------------------------------------------ client: interaction

function provider(ctx: Ctx): Action[] | null {
  const acts: Action[] = [];
  const hit = ctx.hit, held = ctx.held;
  if (hit?.kind === 'water_tap') {
    const i = hit.data?.i ?? 0;
    const on = tapOn(game, i);
    acts.push({ key: 'E', label: on ? tl('ปิดก๊อก', 'turn off') : tl('เปิดก๊อก', 'turn on'), priority: 6, status: () => (tapOn(game, i) ? 'ก๊อกน้ำ (เปิดอยู่)' : 'ก๊อกน้ำ'), run: () => game.intent('wt.tap', { i }) });
  }
  if (held && CONT[held.k]?.mine) {
    const s = CONT[held.k];
    const have = amountOf(held);
    const t = hit?.ent;
    const contTarget = t && t.t === 'item' && t.id !== held.id && (CONT[t.k]?.mine || t.k === 'wash_tub' || (t.k === 'cup_plastic' && !t.data?.dirty)) ? t : null;
    const status = () => { const e = game.state.get(held.id); return `${s === CONT.water_bucket ? 'ถังน้ำ' : 'กะละมัง'} ${(e ? amountOf(e) : 0).toFixed(1)} / ${s.cap} ล.`; };
    if (contTarget && have > 0.05) {
      acts.push(holdPour('LMB', tl('เทใส่' + (game.items.defOf(contTarget)?.name.th ?? ''), 'pour in'), held, status, () => { const p = game.items.worldPos(contTarget); const cs = CONT[contTarget.k]; return p ? [p.x, p.y + (cs ? cs.h : 0.2), p.z] : null; }, 7));
    } else {
      const w = have < s.cap - 0.05 ? rayWater(ctx.camera, 3.4, held.id) : null;
      if (w) acts.push(holdFill(held, w.p, status));
    }
    if (have > 0.05) {
      acts.push(holdPour('R', tl('เทน้ำ', 'pour'), held, status, () => { const p = aimPoint(ctx.camera, _v3); return [p.x, p.y, p.z]; }, 4));
      acts.push({ key: 'F', label: tl('สาดน้ำ!', 'throw the water!'), priority: 5, status, run: () => game.intent('wt.throw', { id: held.id }) });
    }
  }
  if (held?.k === 'water_hose') {
    if (!tapOn(game, 1)) acts.push({ key: 'LMB', label: tl('ฉีดน้ำ', 'spray'), priority: 6, disabled: tl('เปิดก๊อกสายยางก่อน', 'turn the tap on first') });
    else acts.push({
      key: 'LMB', label: tl('ฉีดน้ำ', 'spray'), hold: true, priority: 6, status: () => 'ฉีดน้ำ ซู่ๆๆ',
      run: () => game.intent('wt.spray', { id: held.id, on: true }),
      end: () => game.intent('wt.spray', { id: held.id, on: false }),
    });
  }
  return acts.length ? acts : null;
}

function holdPour(key: 'LMB' | 'R', label: { th: string; en?: string }, held: Ent, status: () => string, target: () => number[] | null, prio: number): Action {
  let last: number[] | null = null, acc = 0;
  return {
    key, label, hold: true, priority: prio, status,
    run: () => { last = target(); if (last) game.intent('wt.pour', { id: held.id, on: true, p: last, mode: 'pour' }); acc = 0; },
    tick: (_c, dt) => {
      acc += dt;
      if (acc < 0.18) return;
      acc = 0;
      const p = target();
      if (p && (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.2)) { last = p; game.intent('wt.pour', { id: held.id, on: true, p, mode: 'pour' }); }
    },
    end: () => game.intent('wt.pour', { id: held.id, on: false }),
  };
}

function holdFill(held: Ent, p: THREE.Vector3, status: () => string): Action {
  const pp = [round(p.x, 2), round(p.y, 3), round(p.z, 2)];
  return {
    key: 'LMB', label: tl('ตักน้ำ', 'scoop water'), hold: true, priority: 6, status,
    run: () => { game.intent('wt.pour', { id: held.id, on: true, p: pp, mode: 'fill' }); splash(pp[0], pp[1], pp[2], 0.35); },
    end: () => game.intent('wt.pour', { id: held.id, on: false }),
  };
}

// ------------------------------------------------------------------ host

function installIntents(g: Game) {
  g.onIntent('wt.pour', (pl, d: any) => chost?.onPour(pl, d));
  g.onIntent('wt.throw', (pl, d: any) => chost?.throwWater(pl, d?.id));
  g.events.on('physics:pre', (dt: number) => buoy?.apply(dt ?? 1 / 60));
  g.events.on('world:exit', () => {
    rainW?.dispose(); rainW = null;
    for (const l of loops.values()) l.h.stop?.(0.2);
    loops.clear();
    field = null; drops = null; crowns = null; rings = null; swirls = null; puddles = null; wash = null; rope = null; canalPatch = null; fxRoot = null;
    buoy = null; chost = null; dynv = null; slosh = null; canalVol = null;
  });
  g.onIntent('wt.tap', (pl, d: { i: number }) => {
    const t = TAPS[d?.i];
    if (!t || !pl.p || Math.hypot(pl.p[0] - t.spout[0], pl.p[2] - t.spout[2]) > 3.2) return;
    const cur: number[] = Array.isArray(g.g.wtaps) ? g.g.wtaps : TAPS.map(() => 0);
    g.g.wtaps = cur.map((v, k) => (k === t.i ? (v ? 0 : 1) : v));
    g.sfx('pickup', t.spout, { vol: 0.5, pitch: 1.7 });
  });
  g.onIntent('wt.spray', (pl, d: { id: number; on: boolean }) => {
    const h = g.state.get(d?.id);
    if (!h || h.k !== 'water_hose' || h.holder !== pl.id) return;
    h.spray = d.on && tapOn(g, 1) ? 1 : 0;
  });
}

function hostTaps(dt: number) {
  tapAcc += dt;
  if (tapAcc < 0.1) return;
  const step = tapAcc; tapAcc = 0;
  for (const t of TAPS) {
    if (!tapOn(game, t.i) || t.hose) continue;
    const left = chost!.deliver([t.spout[0] - 0.03, t.spout[1] - 0.2, t.spout[2]], 0.55 * step);
    if (left > 0) emitPuddle([t.spout[0] - 0.03, ground(t.spout[0], t.spout[2]), t.spout[2]], left);
  }
  // hose: dribbles where it lies when the tap is on and nobody sprays
  const h = hoseEnt(game);
  if (h && tapOn(game, 1) && !h.spray && h.p && h.holder == null && h.in == null) {
    dribbleAcc += step * 0.12;
    if (dribbleAcc > 0.15) { emitPuddle([h.p[0], ground(h.p[0], h.p[2]), h.p[2]], dribbleAcc); dribbleAcc = 0; }
  }
}

function sprayTrace(pl: Ent, out: number[]): number {
  const yaw = pl.yaw ?? 0, pitch = pl.pitch ?? 0;
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  const p0 = [pl.p![0] + fx * 0.5, pl.p![1] + 1.25, pl.p![2] + fz * 0.5];
  const sp = 8.5;
  let T = 1.5;
  for (let t = 0.04; t < 1.5; t += 0.04) {
    const x = p0[0] + fx * sp * t, y = p0[1] + fy * sp * t - 4.905 * t * t, z = p0[2] + fz * sp * t;
    const v = vols.at(x, y, z, 0);
    if (y <= ground(x, z) || v) { out[0] = x; out[1] = v ? v.level : ground(x, z); out[2] = z; T = t; return T; }
  }
  out[0] = p0[0] + fx * sp * T; out[2] = p0[2] + fz * sp * T; out[1] = ground(out[0], out[2]);
  return T;
}

const _land = [0, 0, 0];
function hostSpray(dt: number) {
  const h = hoseEnt(game);
  if (!h) return;
  const pl = h.holder != null ? game.state.get(h.holder) : null;
  // hose length leash
  const a = TAPS[1].spout;
  const hp = pl?.p ?? h.p;
  if (hp && Math.hypot(hp[0] - a[0], hp[2] - a[2]) > HOSE_LEN + 0.4) {
    if (pl) { game.items.toWorld(h, [pl.p![0], pl.p![1] + 0.9, pl.p![2]], [(a[0] - pl.p![0]) * 0.3, 0.5, (a[2] - pl.p![2]) * 0.3]); game.say(pl.id, tl('สายยางไม่ถึงแล้ว!', 'the hose won’t reach!'), { duration: 1.8 }); }
    h.spray = 0;
    return;
  }
  if (!h.spray || !pl?.p) { if (h.spray && !pl) h.spray = 0; return; }
  if (!tapOn(game, 1)) { h.spray = 0; return; }
  sprayTrace(pl, _land);
  sprayAcc += dt;
  const left = chost!.deliver(_land, 0.45 * dt);
  if (left > 0 && !vols.at(_land[0], _land[1], _land[2], 0.05)) {
    (h as any)._pud = ((h as any)._pud ?? 0) + left;
    if (sprayAcc > 0.35) { emitPuddle(_land, (h as any)._pud); (h as any)._pud = 0; sprayAcc = 0; }
  }
  // push light things around + soak people
  const yaw = pl.yaw ?? 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  game.state.each('item', (e) => {
    if (e.holder != null || e.in != null || !e.p) return;
    if (Math.hypot(e.p[0] - _land[0], e.p[2] - _land[2]) > 0.45) return;
    const b = game.items.bodyOf?.(e.id);
    if (!b) return;
    const m = b.mass();
    const dv = 0.22 * Math.min(1, 1.2 / Math.max(0.05, m));
    b.applyImpulse({ x: fx * m * dv, y: m * dv * 0.35, z: fz * m * dv }, true);
  });
  const tnow = now();
  for (const v of [...game.state.all('npc'), ...game.players()]) {
    if (v.id === pl.id || !v.p) continue;
    if (Math.hypot(v.p[0] - _land[0], v.p[2] - _land[2]) > 0.9) continue;
    if ((sprayCool.get(v.id) ?? 0) > tnow) continue;
    sprayCool.set(v.id, tnow + 5);
    const L = [['เฮ้ย! อย่าฉีด!', 'hey! stop spraying!'], ['เปียกหมดแล้วโว้ย!', 'I’m drenched!'], ['สงกรานต์เหรอ!?', 'is it Songkran!?'], ['ว้ายย เย็น!', 'eek, cold!']][v.id % 4];
    game.say(v.id, tl(L[0], L[1]), { duration: 2 } as any);
  }
}

function hostBodiesIntoCanal() {
  for (const e of game.players()) intoCanal(e);
  game.state.each('npc', intoCanal);
}
function intoCanal(e: Ent) {
  {
    if (!e.p) return;
    const v = vols.surfaceAt(e.p[0], e.p[2], e.p[1] - 3, e.p[1] + 3);
    const ly = lastY.get(e.id);
    lastY.set(e.id, e.p[1]);
    if (!v || ly === undefined) return;
    if (ly > v.level - 0.05 && e.p[1] < v.level - 0.25) {
      const sp = Math.min(1.6, (ly - e.p[1]) * 6 + 0.8);
      game.emit('wt:splash', { p: [round(e.p[0], 2), v.level, round(e.p[2], 2)], s: round(sp, 2), k: v.kind, sink: 0 });
    }
  }
}

function waterKit() {
  if (!game.isHost || game.g.waterKit || !wash) return;
  game.g.waterKit = true;
  const F = 0.15;
  game.items.spawn('water_bucket', [12.4, F + 0.02, -15.75], { yaw: 0.4, data: { water: 0, color: 0 } });
  game.items.spawn('water_basin', [11.85, F + 0.02, -17.15], { yaw: 0, data: { water: 3 } });
  game.items.spawn('water_hose', [8.8, F + 0.03, -16.45], { yaw: 1.2 });
}

// ------------------------------------------------------------------ client frame pieces

function frameTaps(dt: number) {
  const cam = _cam;
  for (const t of TAPS) {
    if (!tapOn(game, t.i)) continue;
    const sp = _v.set(t.spout[0] - 0.03, t.spout[1] - 0.005, t.spout[2]);
    if (sp.distanceTo(cam) > 40) continue;
    if (t.hose) continue; // the hose carries this tap's water
    // what's under the spout?
    let yEnd = ground(sp.x, sp.z);
    for (const v of vols.list) if (vols.inside(v, sp.x, sp.z) && v.level < sp.y && v.level > yEnd) yEnd = v.level;
    const s = useStream('tap' + t.i);
    if (!s) continue;
    s.set(sp, _v2.set(-0.05, -0.15, 0), yEnd, 0.016, 0.022, cam, 0);
    impact(s.end, 1.0, dt, 'tap' + t.i);
    loopAt('tap' + t.i, 'wt_stream_loop', s.end, 0.45);
  }
}

const impAcc = new Map<string, number>();
/** continuous stream impact: droplets, foam rings, heightfield */
function impact(p: THREE.Vector3, k: number, dt: number, key: string) {
  const a = (impAcc.get(key) ?? 0) + dt;
  if (a < 0.045) { impAcc.set(key, a); return; }
  impAcc.set(key, 0);
  const R = Math.random;
  const n = Math.round((2 + k * 3) * (low() ? 0.6 : 1));
  for (let i = 0; i < n; i++) { const ang = R() * 6.283, sp = (0.3 + R() * 0.9) * k; drops!.spawn(p.x, p.y + 0.01, p.z, Math.cos(ang) * sp, (0.5 + R() * 1.2) * k, Math.sin(ang) * sp, 0.003 + R() * 0.004, p.y - 0.003, 0, 1); }
  if (field?.covers(p.x, p.z)) field.drop(p.x + (R() - 0.5) * 0.03, p.z + (R() - 0.5) * 0.03, 0.9 * k, 0.05);
  if (R() < 0.18) rings!.spawn(p.x, p.y, p.z, 0.12 + R() * 0.15 * k, 0.7, 0.55);
}

function frameHose(dt: number) {
  const h = hoseEnt(game);
  if (!h || !rope) { if (rope) rope.mesh.visible = false; return; }
  const a = _v.set(TAPS[1].spout[0] - 0.045, TAPS[1].spout[1] - 0.012, TAPS[1].spout[2]);
  if (a.distanceTo(_cam) > 35) { rope.mesh.visible = false; return; }
  rope.mesh.visible = true;
  const obj = game.views.objectOf(h.id);
  const b = _v2;
  if (obj && obj.parent) {
    const vis = obj.children[0] ?? obj;
    b.set(0, 0.017, 0.16);
    vis.updateWorldMatrix(true, false);
    vis.localToWorld(b);
  } else if (h.p) b.set(h.p[0], h.p[1] + 0.02, h.p[2]);
  rope.update(dt, a, b);
  // spray / dribble
  const pl = h.holder != null ? game.state.get(h.holder) : null;
  const tip = _v3;
  if (obj && obj.parent) { const vis = obj.children[0] ?? obj; tip.set(0, 0.017, -0.085); vis.localToWorld(tip); } else if (h.p) tip.set(h.p[0], h.p[1] + 0.02, h.p[2]);
  if (h.spray && pl) {
    let fx: number, fy: number, fz: number;
    if (pl.id === game.localPlayerId && game.player?.firstPerson) {
      game.camera.getWorldDirection(_dir); fx = _dir.x; fy = _dir.y; fz = _dir.z;
    } else {
      const yaw = pl.yaw ?? 0, pitch = pl.pitch ?? 0;
      fx = -Math.sin(yaw) * Math.cos(pitch); fy = Math.sin(pitch); fz = -Math.cos(yaw) * Math.cos(pitch);
    }
    const s = useStream('hose');
    if (s) {
      _vel.set(fx * 8.5, fy * 8.5, fz * 8.5);
      // find landing height along the arc
      let yEnd = ground(tip.x, tip.z) - 0.02;
      for (let t = 0.04; t < 1.5; t += 0.04) {
        const x = tip.x + _vel.x * t, y = tip.y + _vel.y * t - 4.905 * t * t, z = tip.z + _vel.z * t;
        const v = vols.at(x, y, z, 0);
        const gy = ground(x, z);
        if (v) { yEnd = v.level; break; }
        if (y <= gy) { yEnd = gy; break; }
      }
      s.set(tip, _vel, yEnd, 0.012, 0.09, _cam, 0, 1.5);
      impact(s.end, 1.3, dt, 'hose');
      loopAt('hose', 'wt_stream_loop', tip, 0.55, 1.25);
      loopAt('hoseHit', 'wt_trickle_loop', s.end, 0.55, 1.1);
    }
  } else if (tapOn(game, 1) && !h.spray) {
    const s = useStream('hoseDribble');
    if (s) {
      s.set(tip, _vel.set(0, -0.2, 0.25), ground(tip.x, tip.z), 0.01, 0.016, _cam, 0, 0.6);
      impact(s.end, 0.6, dt, 'hoseD');
      loopAt('hoseD', 'wt_trickle_loop', s.end, 0.35, 1.3);
    }
  }
}
const _dir = new THREE.Vector3(), _vel = new THREE.Vector3(), _tgt = new THREE.Vector3();

function framePours(dt: number) {
  game.state.each('item', (e) => {
    if (!e.pour || !CONT[e.k]?.mine) return;
    if (!rimWorld(e, _v)) return;
    _tgt.set(e.pour[0], e.pour[1], e.pour[2]);
    const s = useStream('pour' + e.id);
    if (!s) return;
    aimVel(_v, _tgt, 0.35, _vel);
    s.set(_v, _vel, _tgt.y, 0.03, 0.045, _cam, 0.05);
    impact(s.end, 0.9, dt, 'pour' + e.id);
    loopAt('pour' + e.id, 'wt_stream_loop', s.end, 0.5, 0.9);
  });
}

function frameSpills(dt: number) {
  const t = now();
  for (const [id, sp] of spills) {
    if (t > sp.until) { spills.delete(id); continue; }
    const e = game.state.get(id);
    const s = useStream('spill' + id);
    if (!s) continue;
    // rim from the visual if we can (smoother than the 8 Hz event point)
    const p0 = _v.set(sp.p[0], sp.p[1], sp.p[2]);
    if (e) {
      const obj = game.views.objectOf(id);
      const cs = CONT[e.k];
      if (obj && cs) {
        obj.getWorldQuaternion(_q);
        const up = _v2.set(0, 1, 0).applyQuaternion(_q);
        const hl = Math.hypot(up.x, up.z) || 1;
        obj.getWorldPosition(p0);
        p0.addScaledVector(up, cs.h);
        p0.x += up.x / hl * cs.r; p0.z += up.z / hl * cs.r;
      }
    }
    const rate = Math.min(1.5, sp.l / 0.14);
    _vel.set(sp.d[0] * (0.4 + rate * 0.6), 0.05, sp.d[1] * (0.4 + rate * 0.6));
    s.set(p0, _vel, sp.g[1], 0.02 + rate * 0.03, 0.05 + rate * 0.06, _cam, 0.05, 1);
    impact(s.end, 0.6 + rate * 0.5, dt, 'spill' + id);
    loopAt('spill' + id, 'wt_stream_loop', s.end, Math.min(0.6, 0.15 + rate * 0.4), 0.85);
  }
}

function frameWading(dt: number) {
  // ripples around anyone standing in water (local visuals)
  for (const e of game.players()) {
    if (!e.p) continue;
    const v = vols.surfaceAt(e.p[0], e.p[2], e.p[1] + 0.02, e.p[1] + 1.6);
    if (!v || !field?.covers(e.p[0], e.p[2])) continue;
    const prev = (e as any)._wadeP as number[] | undefined;
    const moved = prev ? Math.hypot(e.p[0] - prev[0], e.p[2] - prev[2]) : 0;
    (e as any)._wadeP = [e.p[0], e.p[1], e.p[2]];
    if (moved > 0.002) field.drop(e.p[0], e.p[2], Math.min(3, moved / dt * 0.8), 0.22);
    else if (Math.random() < dt * 2) field.drop(e.p[0], e.p[2], 0.4, 0.2);
  }
}

function frameFloatProps(t: number) {
  if (!wash) return;
  const d = wash.root.getObjectByName('float-dipper');
  if (d) { d.position.y = (d.userData.baseY ?? d.position.y) + Math.sin(t * 1.3) * 0.004; d.rotation.z = Math.sin(t * 0.9) * 0.05; d.rotation.y += 0.0008; }
}

function refreshDrains() {
  const wd: any[] = (game.world as any)?.drains ?? [];
  const list = ownDrains.slice();
  for (const d of wd) { const p = d?.p; if (Array.isArray(p) && p.length >= 3) list.push({ x: p[0], y: p[1], z: p[2] }); }
  if (puddles) puddles.drains = list;
}

// ------------------------------------------------------------------ module

export default defineModule({
  id: 'water',
  deps: ['world', 'cooking', 'restaurant'],

  init(g) {
    game = g;
    registerWaterSounds();
    defineContainers(g);
    defineHose(g, buildHoseNozzle);
    installIntents(g);
    g.interact.provide(provider, 5);
    // ---- networked one-shots → local visuals
    g.on('wt:splash', (d: any) => { if (Array.isArray(d?.p)) splash(d.p[0], d.p[1], d.p[2], d.s ?? 0.3, !!d.sink); });
    g.on('wt:puddle', (d: any) => { if (Array.isArray(d?.p)) puddles?.add(d.p[0], d.p[1], d.p[2], d.l ?? 0.1); });
    g.on('wt:spill', (d: any) => {
      if (!Array.isArray(d?.p) || !Array.isArray(d?.g)) return;
      spills.set(d.id, { until: now() + 0.32, p: d.p, g: d.g, d: d.d ?? [0, 1], l: d.l ?? 0.1, acc: 0 });
      if (d.first) { wsnd('wt_spill', d.p, { vol: 0.75 }); crowns?.spawn(d.g[0], d.g[1], d.g[2], 0.12, 0.18, 0.5); }
    });
    g.on('wt:throw', (d: any) => {
      if (!Array.isArray(d?.p) || !drops) return;
      const R = Math.random, n = Math.min(160, Math.round(30 + (d.l ?? 5) * 12) * (low() ? 0.5 : 1));
      const gy = d.hit?.[1] ?? 0;
      for (let i = 0; i < n; i++) {
        const sp = 0.75 + R() * 0.45, sx = (R() - 0.5) * 1.6, sy = (R() - 0.5) * 1.2, sz = (R() - 0.5) * 1.6;
        drops.spawn(d.p[0] + (R() - 0.5) * 0.1, d.p[1] + (R() - 0.5) * 0.1, d.p[2] + (R() - 0.5) * 0.1, d.v[0] * sp + sx, d.v[1] * sp + sy, d.v[2] * sp + sz, 0.008 + R() * 0.018, gy - 0.01, 0, 2.5);
      }
      const h = d.hit;
      if (Array.isArray(h)) setTimeout(() => splash(h[0], h[1] + 0.01, h[2], Math.min(1.4, 0.5 + (d.l ?? 5) * 0.08)), (d.T ?? 0.5) * 1000);
    });
    g.on('wt:fx', (d: any) => { if (d?.k === 'fill' && Array.isArray(d.p)) { splash(d.p[0], d.p[1], d.p[2], 0.2, false, true); wsnd('wt_plop', d.p, { vol: 0.35, pitch: 0.8 + Math.random() * 0.3 }); } });
    // wet footsteps (any player's networked footstep sound)
    g.on('sfx', (d: any) => {
      if (!d?.k || typeof d.k !== 'string' || !d.k.startsWith('footstep') || d.k === 'footstep_wet' || !Array.isArray(d.p) || !puddles) return;
      const [x, y, z] = d.p;
      const v = vols.surfaceAt(x, z, y + 0.02, y + 1.6);
      if (v) { splash(x, v.level, z, 0.3 + Math.min(0.5, (v.level - y) * 0.4), false, true); wsnd('wt_splash_m', [x, v.level, z], { vol: 0.35, pitch: 1.1 + Math.random() * 0.2 }); return; }
      const rain = g.g.rain ?? 0;
      const pud = puddles.wetAt(x, y, z);
      if (pud || (rain > 0.3 && Math.random() < rain * 0.8)) {
        Sound.play('footstep_wet', { pos: new THREE.Vector3(x, y, z), vol: pud ? 0.5 : 0.3 });
        stepSplash(x, pud ? pud.y + 0.012 : y + 0.005, z, pud ? 0.8 : 0.35);
      }
    });
    (window as any).__water = { vols, splash, get field() { return field; }, get puddles() { return puddles; }, get buoy() { return buoy; }, get chost() { return chost; }, TAPS };
  },

  async buildWorld(g) {
    game = g;
    registerWaterSounds();
    const scene = g.scene!;
    vols.clear();
    spills.clear();
    fxRoot = new THREE.Group();
    fxRoot.name = 'water-fx';
    scene.add(fxRoot);
    const N = low() ? 64 : 96;
    field = new RippleField(N, low() ? 0.14 : 0.105);
    SHARED.uRipTex.value = field.tex;
    SHARED.uRipO.value = field.uniforms.uRipO.value;
    SHARED.uRipSpan.value = field.span;
    drops = new Droplets(low() ? 260 : 700);
    drops.onLand = landed;
    crowns = new Crowns(16);
    rings = new Rings(low() ? 48 : 96);
    swirls = new Swirls(6);
    puddles = new Puddles();
    fxRoot.add(drops.mesh, crowns.mesh, rings.mesh, swirls.mesh, puddles.mesh);
    streams.length = 0; owner.length = 0; usedF.length = 0;
    for (let i = 0; i < 10; i++) { const s = new Stream(); streams.push(s); owner.push(null); usedF.push(-1); fxRoot.add(s.mesh); }
    slosh = new SloshSys(g);
    slosh.onSlam = (p, k) => { if (k > 0.3) { for (let i = 0; i < 6 * k; i++) { const a = Math.random() * 6.28; drops!.spawn(p.x, p.y + 0.25, p.z, Math.cos(a) * 0.6, 0.8 + Math.random(), Math.sin(a) * 0.6, 0.006, ground(p.x, p.z), 0, 1.5); } wsnd('wt_plop', p, { vol: 0.3 * k, pitch: 0.7 }); } };
    puddles.onSwirl = (d, k) => swirls?.feed(d.x, d.y, d.z, k);
    // ---- volumes: the canal
    if (g.world && (g.world as any).anchors?.canal_bridge) {
      canalVol = vols.add({ kind: 'canal', shape: 'box', x: 0, z: (CANAL.zS + CANAL.zN) / 2, hx: 420, hz: (CANAL.zS - CANAL.zN) / 2, y0: CANAL.bed, level: CANAL.water, flow: [0.14, 0], waves: 0.022, local: false, murk: 0.8 });
      // canal ripple patch: transparent overlay that shows the heightfield on the canal near the camera
      const pg = new THREE.PlaneGeometry(field.span, field.span, 1, 1);
      pg.rotateX(-Math.PI / 2);
      canalPatch = new THREE.Mesh(pg, makeSurfaceMat({ color: 0x24301e, opacity: 0.85, overlay: true, ripK: 1.6, nmK: 0.0, tile: 3, nm: 'canal' }));
      canalPatch.renderOrder = 3; canalPatch.name = 'water-canal-ripples'; canalPatch.visible = false; canalPatch.raycast = () => {};
      fxRoot.add(canalPatch);
      // ---- wash corner (static props, volumes, taps) + hose rope
      try {
        wash = buildWashCorner(g, vols, fxRoot);
        ownDrains.length = 0; ownDrains.push(...wash.drains);
        rope = new HoseRope((x, z) => ground(x, z));
        fxRoot.add(rope.mesh);
      } catch (e) { console.error('[water] wash corner', e); }
      rainW = new RainWater((x, z) => ground(x, z), (x, y, z) => {
        const h = g.physics?.raycast(_v.set(x, y + 0.25, z), _v2.set(0, 1, 0), 14, G.STATIC);
        return !!h;
      });
    }
    refreshDrains();
    dynv = new DynVolumes(g, vols);
    if (g.isHost) {
      buoy = new Buoyancy(g, vols);
      chost = new ContainerHost(g, vols, emitPuddle, dynv);
      if (!Array.isArray(g.g.wtaps)) g.g.wtaps = TAPS.map(() => 0);
      setTimeout(() => { waterKit(); if (params.has('waterlab')) waterLab(g, { splash }); }, 600);
    }
  },

  hostUpdate(g, dt) {
    if (g.g.scene !== 'world' || !g.scene || !chost) return;
    buoy?.scan(dt);
    chost.host(dt);
    hostTaps(dt);
    hostSpray(dt);
    hostBodiesIntoCanal();
  },

  frame(g, dt) {
    if (!g.scene || !field || !drops) return;
    frameNo++;
    const t = performance.now() / 1000;
    SHARED.uTime.value = t;
    FXU.uTime.value = t;
    g.camera.getWorldPosition(_cam);
    const night = g.clock?.nightFactor ?? 0;
    FXU.uLit.value = 1 - night * 0.72;
    const fog: any = g.scene.fog;
    if (fog?.color && puddles) puddles.sky.value.copy(fog.color);
    // dynamic container volumes (every peer, ~10 Hz)
    volT += dt;
    if (volT > 0.1) { volT = 0; dynv?.refresh(); }
    drainT += dt;
    if (drainT > 2) { drainT = 0; refreshDrains(); }
    field.follow(_cam.x, _cam.z);
    // canal ripple patch follows the field window
    if (canalPatch && canalVol) {
      const near = Math.abs(_cam.z - canalVol.z) < 16 && _cam.y < canalVol.level + 9;
      canalPatch.visible = near;
      if (near) canalPatch.position.set(field.ox + field.span / 2, canalVol.level + 0.006, field.oz + field.span / 2);
    }
    const rain = g.g.rain ?? 0;
    rainW?.update(dt, rain, _cam, { drops, rings: rings!, field, vols, puddles: puddles!, stream: useStream, canalLevel: CANAL.water });
    frameTaps(dt);
    frameHose(dt);
    framePours(dt);
    frameSpills(dt);
    frameWading(dt);
    frameFloatProps(t);
    slosh?.update(dt);
    puddles?.update(dt, rain);
    swirls?.update(dt);
    for (const s of swirls?.active() ?? []) if (s.k > 0.08 && Math.hypot(s.x - _cam.x, s.z - _cam.z) < 20) loopAt('sw' + s.x.toFixed(1) + s.z.toFixed(1), 'wt_gurgle_loop', [s.x, s.y, s.z], 0.2 + s.k * 0.4);
    field.update(dt);
    drops.update(dt);
    crowns!.update(dt);
    rings!.update(dt);
    endStreams();
    endLoops();
  },

  onNewDay(g) {
    if (!g.isHost) return;
    g.g.wtaps = TAPS.map(() => 0);
  },
});

void levelY; void _v3;
