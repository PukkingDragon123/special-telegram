import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { tl, round } from '../../core/util';
import { makeSurfaceMat, surfaceDisc, SurfMat } from './surface';
import type { Volumes, WaterVolume } from './volumes';

/**
 * WATER CONTAINERS
 *  - item kinds owned here: water_bucket (ถังน้ำ, PP plastic + galvanised bail), water_basin
 *    (กะละมังอลูมิเนียม). Replicated state: data.water (litres) only.
 *  - spec table for other modules' liquid vessels (cup, bowl, rice pot, wash tub): visual slosh;
 *    cups also really spill (data.fill) when knocked over.
 *  - host: spill when tipped past the critical angle, pour (hold R / LMB into a container),
 *    fill from any water volume (LMB), throw the whole bucket (F), catch small items that land
 *    in an open container (they float or sink inside).
 *  - client: spring-damper liquid surface that stays level and sloshes with container motion.
 */

export interface ContSpec {
  cap: number;              // litres
  r: number; rb: number;    // rim / bottom inner radius (m)
  h: number;                // rim height
  floor: number;            // inner floor height
  mine?: boolean;           // our item (data.water)
  field?: 'water' | 'fill'; // data field holding the amount ('fill' = 0..1 of cap)
  surface?: string;         // name of the liquid mesh in other modules' visuals
  levelOnly?: boolean;      // other module's disc: we only slosh it
  column?: boolean;         // liquid is a lathe column (cup): tiny slosh only
  fixedLevel?: number;      // level (local y) for vessels without an amount
}

export const CONT: Record<string, ContSpec> = {
  water_bucket: { cap: 10, r: 0.137, rb: 0.112, h: 0.27, floor: 0.014, mine: true, field: 'water' },
  water_basin: { cap: 8, r: 0.29, rb: 0.19, h: 0.125, floor: 0.008, mine: true, field: 'water' },
  cup_plastic: { cap: 0.3, r: 0.04, rb: 0.033, h: 0.113, floor: 0.008, field: 'fill', surface: 'water', column: true },
  wash_tub: { cap: 30, r: 0.3, rb: 0.22, h: 0.26, floor: 0.016, surface: 'water', levelOnly: true, fixedLevel: 0.2 },
  bowl: { cap: 0.6, r: 0.07, rb: 0.04, h: 0.07, floor: 0.01, surface: 'bowlliquid', levelOnly: true },
  rice_pot: { cap: 4, r: 0.15, rb: 0.15, h: 0.2, floor: 0.02, surface: 'water', levelOnly: true },
};

export function amountOf(e: Ent): number {
  const s = CONT[e.k];
  if (!s) return 0;
  if (s.field === 'fill') return Math.max(0, (e.data?.fill ?? 0)) * s.cap;
  if (s.field === 'water') return Math.max(0, e.data?.water ?? 0);
  return 0;
}
export function setAmount(e: Ent, l: number) {
  const s = CONT[e.k];
  if (!s) return;
  l = Math.max(0, Math.min(s.cap, l));
  if (s.field === 'fill') e.data = { ...e.data, fill: round(l / s.cap, 2) };
  else if (s.field === 'water') e.data = { ...e.data, water: round(l, 2) };
}
/** local y of the liquid surface */
export function levelY(s: ContSpec, l: number) {
  if (s.fixedLevel !== undefined) return s.fixedLevel;
  return s.floor + Math.min(1, l / s.cap) * (s.h - s.floor - 0.02);
}
export function radiusAt(s: ContSpec, y: number) { return s.rb + (s.r - s.rb) * Math.min(1, Math.max(0, y / s.h)); }

// ------------------------------------------------------------------ item visuals

const BUCKET_COLORS = [0xc8202a, 0x2a62c8, 0x1f8a4a, 0xe0a020, 0x3aa8d8];

function latheMesh(pts: [number, number][], seg: number, mat: THREE.Material) {
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function waterSurface(color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(surfaceDisc(), makeSurfaceMat({ color, opacity, tile: 0.35, nmK: 0.1, ripK: 1.1 }));
  m.name = 'wsurf';
  m.renderOrder = 3;
  m.castShadow = false; m.receiveShadow = true;
  m.raycast = () => {};
  return m;
}

export function buildBucket(e: Ent): THREE.Object3D {
  const g = new THREE.Group();
  const col = BUCKET_COLORS[(e.data?.color ?? e.id) % BUCKET_COLORS.length];
  const mat = Assets.pbr('plastic_glossy', { color: col, repeat: [3, 1], side: THREE.DoubleSide });
  const s = CONT.water_bucket;
  g.add(latheMesh([[0.0001, 0], [s.rb + 0.004, 0], [s.rb + 0.006, 0.01], [s.r + 0.006, s.h - 0.012], [s.r + 0.014, s.h - 0.004], [s.r + 0.013, s.h + 0.004], [s.r + 0.004, s.h + 0.002], [s.r, s.h - 0.006], [s.rb, s.floor], [0.0001, s.floor]], 30, mat));
  // reinforcing ring + lugs
  const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r + 0.0075, 0.004, 5, 30), mat);
  ring.rotation.x = Math.PI / 2; ring.position.y = s.h * 0.62; g.add(ring);
  const galv = Assets.pbr('galvanized_steel', { repeat: 0.25 });
  for (const sx of [-1, 1]) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.022), mat);
    lug.position.set(sx * (s.r + 0.013), s.h - 0.03, 0); g.add(lug);
  }
  // steel bail handle (rests tipped to one side)
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push(new THREE.Vector3(-Math.cos(a) * (s.r + 0.018), Math.sin(a) * 0.13, 0)); }
  const bail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.0032, 5), galv);
  bail.position.y = s.h - 0.03; bail.rotation.x = -0.9; bail.castShadow = true;
  bail.name = 'bail';
  g.add(bail);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.09, 8), Assets.pbr('plastic_rough', { color: 0x202020, repeat: 0.3 }));
  grip.rotation.z = Math.PI / 2; grip.position.set(0, 0.13, 0); bail.add(grip);
  g.add(waterSurface(0x7d989c, 0.5));
  const c = new THREE.Group(); c.name = 'contents'; g.add(c);
  refreshContainer(g, e);
  return g;
}

export function buildBasin(e: Ent): THREE.Object3D {
  const g = new THREE.Group();
  const s = CONT.water_basin;
  const mat = Assets.pbr('aluminium_scratched', { repeat: [4, 1], side: THREE.DoubleSide, roughness: 0.75 });
  g.add(latheMesh([[0.0001, 0], [s.rb, 0], [s.rb + 0.02, 0.012], [s.r + 0.004, s.h - 0.004], [s.r + 0.016, s.h + 0.002], [s.r + 0.012, s.h + 0.008], [s.r - 0.002, s.h], [s.rb + 0.015, s.floor + 0.004], [s.rb - 0.004, s.floor], [0.0001, s.floor]], 34, mat));
  g.add(waterSurface(0x7c8f90, 0.55));
  const c = new THREE.Group(); c.name = 'contents'; g.add(c);
  refreshContainer(g, e);
  return g;
}

export function buildHoseNozzle(): THREE.Object3D {
  const g = new THREE.Group();
  const brass = Assets.pbr('brass_gold', { repeat: 0.3 });
  const hose = Assets.pbr('rubber_black', { color: 0x4aa052, repeat: 0.2, roughness: 0.55 });
  const body = latheMesh([[0.0001, 0], [0.011, 0], [0.012, 0.03], [0.016, 0.035], [0.016, 0.07], [0.009, 0.11], [0.006, 0.125], [0.0001, 0.125]], 14, brass);
  body.rotation.x = -Math.PI / 2; body.position.set(0, 0.017, 0.05);
  g.add(body);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.12, 10), hose);
  stub.rotation.x = Math.PI / 2; stub.position.set(0, 0.017, 0.1); g.add(stub);
  const tip = new THREE.Object3D(); tip.name = 'tip'; tip.position.set(0, 0.017, -0.078); g.add(tip);
  return g;
}

export function refreshContainer(obj: THREE.Object3D, e: Ent) {
  const s = CONT[e.k];
  if (!s) return;
  const l = amountOf(e);
  const surf = obj.getObjectByName('wsurf') as THREE.Mesh | undefined;
  if (surf) {
    const y = levelY(s, l);
    surf.visible = l > 0.05;
    surf.position.y = y;
    const r = radiusAt(s, y) - 0.002;
    surf.scale.set(r, 1, r);
    surf.userData.r = r;
  }
}

// ------------------------------------------------------------------ item definitions

export function defineContainers(game: Game) {
  const small = (c: Ent) => { const d = game.items.defOf(c); return !!d && (d.weight ?? 0.5) <= 0.8 && !d.tags?.includes('furniture') && !CONT[c.k]?.mine && !d.slots; };
  game.items.define({
    kind: 'water_bucket', name: tl('ถังน้ำ', 'water bucket'), weight: 1.4, carry: 'hand', price: 59, tags: ['container', 'water', 'plastic', 'bucket'],
    shape: { type: 'cyl', r: 0.15, h: 0.28 }, mass: 1.6, density: 280,
    data: () => ({ water: 0 }),
    container: { capacity: 3, layout: 'pile', accepts: (c) => small(c) },
    build: (e) => buildBucket(e),
    refresh: (o, e) => refreshContainer(o, e),
    animate: (o, e, dt) => animatePour(o, e, dt),
    label: (e) => { const l = amountOf(e); return tl(l > 0.05 ? `ถังน้ำ (${l.toFixed(1)} ล.)` : 'ถังน้ำ (ว่าง)', 'water bucket'); },
    hold: { pos: [0.02, -0.12, -0.06], rot: [0.12, -0.4, 0], scale: 0.9 },
  });
  game.items.define({
    kind: 'water_basin', name: tl('กะละมัง', 'basin'), weight: 0.9, carry: 'twohand', price: 45, tags: ['container', 'water', 'metal', 'basin'],
    shape: { type: 'cyl', r: 0.3, h: 0.13 }, mass: 0.9, density: 400,
    data: () => ({ water: 0 }),
    container: { capacity: 5, layout: 'pile', accepts: (c) => small(c) },
    build: (e) => buildBasin(e),
    refresh: (o, e) => refreshContainer(o, e),
    animate: (o, e, dt) => animatePour(o, e, dt),
    label: (e) => { const l = amountOf(e); return tl(l > 0.05 ? `กะละมัง (${l.toFixed(1)} ล.)` : 'กะละมัง (ว่าง)', 'basin'); },
    hold: { pos: [0, -0.2, -0.12], rot: [0.35, 0, 0], scale: 0.55 },
  });
}

/** held container tilts forward while pouring (visual child of the item holder) */
function animatePour(o: THREE.Object3D, e: Ent, dt: number) {
  const want = e.pour ? (e.k === 'water_basin' ? 0.75 : 1.15) : 0;
  const cur = o.userData.tilt ?? 0;
  const nv = cur + (want - cur) * Math.min(1, dt * 6);
  o.userData.tilt = nv;
  o.rotation.x = -nv;
  if (e.k === 'water_bucket') { const b = o.getObjectByName('bail'); if (b) b.rotation.x = e.holder != null ? 0 : -0.9; }
}

// ------------------------------------------------------------------ client: slosh

interface Slosh {
  eid: number;
  mesh: THREE.Mesh;
  base: THREE.Quaternion;
  last: THREE.Vector3; vel: THREE.Vector3; acc: THREE.Vector3;
  sx: number; sz: number; vx: number; vz: number;
  wob: number;
  init: boolean;
  seen: number;
}

const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _iq = new THREE.Quaternion(), _yq = new THREE.Quaternion();
const _a = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _tq = new THREE.Quaternion(), _sq = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0), _az = new THREE.Vector3(0, 0, 1);

export class SloshSys {
  private st = new Map<number, Slosh>();
  private frameNo = 0;
  private cb: (e: Ent) => void;
  private dt = 0;
  /** called when a slosh is violent (container slammed) */
  onSlam: ((p: THREE.Vector3, k: number, e: Ent) => void) | null = null;

  constructor(private game: Game) {
    this.cb = (e: Ent) => this.one(e);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.dt = Math.min(dt, 0.05);
    this.frameNo++;
    this.game.state.each('item', this.cb);
    if (this.frameNo % 60 === 0) for (const [id, s] of this.st) if (this.frameNo - s.seen > 120) this.st.delete(id);
  }

  private one(e: Ent) {
    const spec = CONT[e.k];
    if (!spec) return;
    const obj = this.game.views.objectOf(e.id);
    if (!obj || !obj.parent) return;
    let s = this.st.get(e.id);
    if (!s || !s.mesh.parent) {
      const name = spec.mine ? 'wsurf' : spec.surface!;
      const mesh = obj.getObjectByName(name) as THREE.Mesh | undefined;
      if (!mesh) return;
      s = { eid: e.id, mesh, base: mesh.quaternion.clone(), last: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3(), sx: 0, sz: 0, vx: 0, vz: 0, wob: 0, init: false, seen: 0 };
      this.st.set(e.id, s);
    }
    s.seen = this.frameNo;
    const dt = this.dt;
    const mesh = s.mesh;
    if (!mesh.visible && !spec.levelOnly) return;
    const par = mesh.parent!;
    par.getWorldPosition(_wp);
    if (!s.init) { s.last.copy(_wp); s.vel.set(0, 0, 0); s.init = true; }
    // velocity / acceleration (filtered — network interpolation is jittery)
    _a.subVectors(_wp, s.last).divideScalar(dt);
    s.last.copy(_wp);
    if (_a.lengthSq() > 400) _a.set(0, 0, 0);          // teleport / reparent
    const ax = (_a.x - s.vel.x) / dt, az = (_a.z - s.vel.z) / dt;
    s.vel.lerp(_a, Math.min(1, dt * 25));
    s.acc.x += (ax - s.acc.x) * Math.min(1, dt * 14);
    s.acc.z += (az - s.acc.z) * Math.min(1, dt * 14);
    // into the container's yaw frame
    par.getWorldQuaternion(_wq);
    _e.setFromQuaternion(_wq, 'YXZ');
    const cy = Math.cos(_e.y), sy = Math.sin(_e.y);
    const lax = s.acc.x * cy - s.acc.z * sy, laz = s.acc.x * sy + s.acc.z * cy;
    // spring-damper slope (dh/dx, dh/dz); equilibrium slope = -a/g
    const k = 70, c = 1.6;
    const tx = Math.max(-0.5, Math.min(0.5, -lax / 9.81)), tz = Math.max(-0.5, Math.min(0.5, -laz / 9.81));
    s.vx += ((tx - s.sx) * k - s.vx * c) * dt;
    s.vz += ((tz - s.sz) * k - s.vz * c) * dt;
    s.sx += s.vx * dt; s.sz += s.vz * dt;
    const lim = spec.column ? 0.12 : 0.35;
    s.sx = Math.max(-lim, Math.min(lim, s.sx)); s.sz = Math.max(-lim, Math.min(lim, s.sz));
    const jerk = Math.hypot(ax, az);
    if (jerk > 25 && s.wob < 0.4 && spec.mine && amountOf(e) > 0.5) this.onSlam?.(_wp, Math.min(1, jerk / 80), e);
    s.wob = Math.min(1, s.wob * Math.exp(-dt * 2.2) + Math.min(0.5, jerk * 0.004) * dt * 10);
    // keep the surface level in the world (remove the container's tilt, keep its yaw), clamp ±40°
    _yq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, _e.y);
    _iq.copy(_wq).invert().multiply(_yq);            // parent-local rotation that makes it level
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_iq.w)));
    if (ang > 0.7) _iq.slerp(_tq.identity(), 1 - 0.7 / ang);
    if (spec.column) _iq.identity();
    if (spec.mine) {
      const u = (mesh.material as SurfMat).userData?.wob;
      if (u) u.value.set(s.sx, s.sz, mesh.userData.r ?? 0.1, s.wob);
      mesh.quaternion.copy(_iq).multiply(s.base);
    } else {
      // other modules' meshes: small tilt rotation (slope → angle) on top of their own orientation
      _sq.setFromAxisAngle(_az, Math.atan(s.sx)).multiply(_tq.setFromAxisAngle(_ax, -Math.atan(s.sz)));
      mesh.quaternion.copy(_iq).multiply(_sq).multiply(s.base);
    }
  }
}

// ------------------------------------------------------------------ host: spill / pour / fill / throw / catch

export interface WaterHostCtx {
  game: Game;
  vols: Volumes;
  /** find a water target (container / volume) near a world point */
  emitPuddle(p: number[], litres: number): void;
}


/** dynamic water volumes for open containers lying in the world (every peer, ~10 Hz) */
export class DynVolumes {
  readonly dyn = new Map<number, WaterVolume>();
  private seen = new Set<number>();
  private cb: (e: Ent) => void;
  constructor(private game: Game, private vols: Volumes) { this.cb = (e) => this.one(e); }
  refresh() {
    this.seen.clear();
    this.game.state.each('item', this.cb);
    for (const [id, v] of this.dyn) if (!this.seen.has(id)) { this.vols.remove(v); this.dyn.delete(id); }
  }
  private one(e: Ent) {
    const s = CONT[e.k];
    if (!s || !(s.mine || e.k === 'wash_tub') || e.holder != null || e.in != null || !e.p) return;
    const q = e.q ?? [0, 0, 0, 1];
    const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
    const l = e.k === 'wash_tub' ? 20 : amountOf(e);
    let v = this.dyn.get(e.id);
    if (upY < 0.85 || l < 0.05) return;
    this.seen.add(e.id);
    const y = levelY(s, l);
    if (!v) { v = this.vols.add({ kind: e.k === 'wash_tub' ? 'washtub' : e.k === 'water_basin' ? 'basin' : 'bucket', x: e.p[0], z: e.p[2], y0: e.p[1] + s.floor, level: e.p[1] + y, r: radiusAt(s, y), eid: e.id, dynamic: true, local: true, murk: e.k === 'wash_tub' ? 0.5 : 0.1 }); this.dyn.set(e.id, v); }
    v.x = e.p[0]; v.z = e.p[2]; v.y0 = e.p[1] + s.floor; v.level = e.p[1] + y; v.r = radiusAt(s, y);
  }
}

interface Pour { id: number; p: number[]; acc: number; t: number; mode: 'pour' | 'fill'; vid?: number }

const _up = new THREE.Vector3();
const _q4 = new THREE.Quaternion();

export class ContainerHost {
  private pours = new Map<number, Pour>();        // playerId → pour/fill
  private spillAcc = new Map<number, { l: number; t: number }>();
  private time = 0;

  constructor(private game: Game, private vols: Volumes, private puddle: (p: number[], l: number) => void, private dynv: DynVolumes) {}

  /** intent wt.pour (registered once by index.ts) */
  onPour(pl: Ent, d: { id: number; on: boolean; p?: number[]; mode?: 'pour' | 'fill' }) {
    const g = this.game;
    const it = g.state.get(d?.id);
    if (!d?.on || !it || it.holder !== pl.id) { this.stop(pl.id); return; }
    if (!Array.isArray(d.p) || d.p.length !== 3 || !d.p.every(Number.isFinite)) return;
    if (!pl.p || Math.hypot(pl.p[0] - d.p[0], pl.p[2] - d.p[2]) > 4.5) return;
    const prev = this.pours.get(pl.id);
    this.pours.set(pl.id, { id: it.id, p: d.p.map((v) => round(v, 2)), acc: prev?.acc ?? 0, t: prev?.t ?? 0, mode: d.mode === 'fill' ? 'fill' : 'pour' });
    if (d.mode !== 'fill') it.pour = d.p.map((v) => round(v, 2));
  }

  private stop(pid: number) {
    const p = this.pours.get(pid);
    if (!p) return;
    const it = this.game.state.get(p.id);
    if (it && it.pour) it.pour = null;
    if (p.acc > 0.01) this.flushPour(p);
    this.pours.delete(pid);
  }

  private flushPour(p: Pour) { this.puddle(p.p, p.acc); p.acc = 0; }

  host(dt: number) {
    this.time += dt;
    const g = this.game;
    // ---- pours & fills
    for (const [pid, p] of [...this.pours]) {
      const pl = g.state.get(pid), it = g.state.get(p.id);
      if (!pl || !it || it.holder !== pid || g.items.selected(pl)?.id !== it.id) { this.stop(pid); continue; }
      const s = CONT[it.k];
      if (!s) { this.stop(pid); continue; }
      const have = amountOf(it);
      if (p.mode === 'fill') {
        if (have >= s.cap - 0.01) { this.stop(pid); g.sfx('wt_plop', pl.p, { vol: 0.4, pitch: 1.4 }); continue; }
        setAmount(it, have + dt * (it.k === 'water_basin' ? 3.2 : 2.6));
        p.t += dt;
        if (p.t > 0.45) { p.t = 0; g.emit('wt:fx', { k: 'fill', p: p.p }); }
        continue;
      }
      if (have <= 0.01) { this.stop(pid); continue; }
      const out = Math.min(have, dt * (it.k === 'water_basin' ? 2.4 : 1.8));
      setAmount(it, have - out);
      const left = this.deliver(p.p, out, it.id);
      p.acc += left;
      p.t += dt;
      if (p.t > 0.3) { p.t = 0; if (p.acc > 0.01) this.flushPour(p); }
    }
    // ---- spills + catches (free containers)
    g.state.each('item', (e) => {
      const s = CONT[e.k];
      if (!s || e.holder != null || e.in != null || !e.p || s.levelOnly) return;
      const q = e.q ?? [0, 0, 0, 1];
      _q4.set(q[0], q[1], q[2], q[3]);
      _up.set(0, 1, 0).applyQuaternion(_q4);
      const have = amountOf(e);
      const tilt = Math.acos(Math.max(-1, Math.min(1, _up.y)));
      const fill = have / s.cap;
      const crit = Math.max(0.06, Math.atan2(s.h * (1 - fill) * 1.15, s.r));
      const kids = s.mine ? g.items.contents(e) : null;
      if (tilt > crit + 0.05 && (have > 0.005 || kids?.length)) {
        const rate = s.cap * 0.85 * Math.max(0.12, Math.min(1, (tilt - crit) / 0.7));
        const out = Math.min(have, rate * dt);
        if (out > 0) setAmount(e, have - out);
        const rec = this.spillAcc.get(e.id) ?? { l: 0, t: 0 };
        rec.l += out; rec.t += dt;
        this.spillAcc.set(e.id, rec);
        const hl = Math.hypot(_up.x, _up.z) || 1;
        const dx = _up.x / hl, dz = _up.z / hl;
        const rim = [e.p[0] + _up.x * s.h + dx * s.r, e.p[1] + _up.y * s.h, e.p[2] + _up.z * s.h + dz * s.r];
        if (rec.t > 0.14 && (rec.l > 0.004 || kids?.length)) {
          const land = [rim[0] + dx * 0.18, 0, rim[2] + dz * 0.18];
          land[1] = g.physics?.groundY(land[0], land[2], rim[1] + 0.3) ?? e.p[1];
          const first = !e._spilling;
          e._spilling = true;
          g.emit('wt:spill', { id: e.id, p: rim.map((v) => round(v, 3)), g: land.map((v) => round(v, 3)), d: [round(dx, 2), round(dz, 2)], l: round(rec.l, 3), first: first ? 1 : 0 });
          const left = this.deliver(land, rec.l * 0.8, e.id, true);
          if (left > 0) this.puddle(land, left);
          rec.l = 0; rec.t = 0;
          // contents tumble out
          if (kids?.length) for (const k of kids) g.items.toWorld(k, [rim[0] + dx * 0.05, rim[1] + 0.02, rim[2] + dz * 0.05], [dx * 1.2, 0.4, dz * 1.2]);
        }
      } else if (e._spilling && tilt < crit) e._spilling = false;
      // catch small items landing in an upright open container
      if (s.mine && tilt < 0.35) this.catchInto(e, s, have);
    });
    // keep floating contents at the waterline
    for (const v of this.dynv.dyn.values()) {
      const c = v.eid != null ? g.state.get(v.eid) : null;
      if (!c || !CONT[c.k]?.mine) continue;
      for (const k of g.items.contents(c)) {
        if (!k.at || k._wsink) continue;
        const want = round(levelY(CONT[c.k], amountOf(c)) - 0.025, 3);
        if (Math.abs((k.at[1] ?? 0) - want) > 0.012) k.at = [k.at[0], want, k.at[2], k.at[3] ?? 0];
      }
    }
  }

  private catchInto(c: Ent, s: ContSpec, have: number) {
    const g = this.game;
    const cp = c.p!;
    const rimY = cp[1] + s.h;
    if (g.items.contents(c).length >= 3) return;
    g.state.each('item', (k) => {
      if (k === c || k.holder != null || k.in != null || !k.p || CONT[k.k]?.mine) return;
      const dy = k.p[1] - rimY;
      if (dy < -0.04 || dy > 0.22) return;
      const dx = k.p[0] - cp[0], dz = k.p[2] - cp[2];
      if (dx * dx + dz * dz > (s.r * 0.85) ** 2) return;
      const def = g.items.defOf(k);
      if (!def || (def.weight ?? 0.5) > 0.8 || def.tags?.includes('furniture') || def.slots) return;
      const rho = (def as any).density ?? (def.tags?.includes('egg') ? 1080 : def.tags?.includes('metal') ? 3000 : 600);
      const sink = rho > 1000 || have < 0.3;
      const y = sink ? s.floor + 0.005 : levelY(s, have) - 0.025;
      const a = Math.random() * 6.28, r = Math.random() * s.r * 0.45;
      if (g.items.toContainer(k, c, [round(Math.cos(a) * r, 3), round(y, 3), round(Math.sin(a) * r, 3), round(Math.random() * 6.28, 2)])) {
        k._wsink = sink;
        if (have > 0.2) g.emit('wt:splash', { p: [cp[0], round(cp[1] + levelY(s, have), 3), cp[2]], s: 0.32, k: 'bucket', sink: sink ? 1 : 0, id: k.id });
        else g.sfx('drop_plastic', cp, { vol: 0.5 });
      }
    });
  }

  /**
   * Put `litres` of water at world point p into whatever can hold it (open container, wash tub,
   * cup, static volume). Returns the litres left over for a puddle.
   */
  deliver(p: number[], litres: number, exclude?: number, groundOnly = false): number {
    const g = this.game;
    let best: Ent | null = null, bd = 1e9;
    g.state.each('item', (e) => {
      if (e.id === exclude || e.holder != null || e.in != null || !e.p) return;
      const s = CONT[e.k];
      if (!s || !(s.mine || e.k === 'cup_plastic' || e.k === 'wash_tub')) return;
      const dx = e.p[0] - p[0], dz = e.p[2] - p[2], d = Math.hypot(dx, dz);
      const rr = s.r + (groundOnly ? 0 : 0.06);
      if (d > rr) return;
      if (p[1] < e.p[1] - 0.1 || p[1] > e.p[1] + s.h + 0.6) return;
      if (d < bd) { bd = d; best = e; }
    });
    const tgt = best as Ent | null;
    if (tgt) {
      const s = CONT[tgt.k];
      if (tgt.k === 'wash_tub') {
        // fresh water clears murky wash water a little (visual only)
        const dirt = tgt.data?.dirt ?? 0;
        if (dirt > 0) tgt.data = { ...tgt.data, dirt: round(Math.max(0, dirt - litres * 0.04), 2) };
        return 0;
      }
      if (tgt.k === 'cup_plastic' && tgt.data?.dirty) return litres;
      const have = amountOf(tgt);
      const room = Math.max(0, s.cap - have);
      const put = Math.min(room, litres);
      if (put > 0) setAmount(tgt, have + put);
      return litres - put;
    }
    // static volumes swallow it
    for (const v of this.vols.list) if (!v.dynamic && this.vols.inside(v, p[0], p[2]) && Math.abs(p[1] - v.level) < 0.5) return 0;
    return litres;
  }

  throwWater(pl: Ent, id: number) {
    const g = this.game;
    const it = g.state.get(id);
    if (!it || it.holder !== pl.id || !CONT[it.k]?.mine || !pl.p) return;
    const l = amountOf(it);
    if (l < 0.3) return;
    setAmount(it, 0);
    const yaw = pl.yaw ?? 0, pitch = Math.max(-0.4, Math.min(0.6, pl.pitch ?? 0));
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const p0 = [pl.p[0] + fx * 0.5, pl.p[1] + 1.15, pl.p[2] + fz * 0.5];
    const sp = 5.2;
    const v0 = [fx * sp, fy * sp + 1.8, fz * sp];
    // trace the arc
    let hit = [p0[0] + v0[0] * 0.6, pl.p[1], p0[2] + v0[2] * 0.6], T = 0.6;
    let px = p0[0], py = p0[1], pz = p0[2];
    for (let t = 0.03; t < 1.6; t += 0.03) {
      const x = p0[0] + v0[0] * t, y = p0[1] + v0[1] * t - 4.905 * t * t, z = p0[2] + v0[2] * t;
      const gy = g.physics?.groundY(x, z, Math.max(py, y) + 0.5) ?? 0;
      const wv = this.vols.at(x, y, z, 0.0);
      if (y <= gy || wv) { hit = [x, wv ? wv.level : gy, z]; T = t; break; }
      px = x; py = y; pz = z;
    }
    void px; void pz;
    g.emit('wt:throw', { p: p0.map((v) => round(v, 3)), v: v0.map((v) => round(v, 3)), l: round(l, 2), hit: hit.map((v) => round(v, 3)), T: round(T, 3), by: pl.id });
    g.sfx('wt_splash_l', p0, { vol: 0.5, pitch: 1.3 });
    // land: fill / puddle / soak somebody
    setTimeout(() => {
      const left = this.deliver(hit, l * 0.7, it.id, true);
      if (left > 0 && !this.vols.at(hit[0], hit[1], hit[2], 0.05)) this.puddle(hit, left);
      const victims = [...g.state.all('npc'), ...g.players()].filter((e) => e.id !== pl.id && e.p && Math.hypot(e.p[0] - hit[0], e.p[2] - hit[2]) < 1.1);
      for (const v of victims.slice(0, 2)) {
        const lines = [['เฮ้ย! เปียกหมดเลย!', 'hey! I’m soaked!'], ['อะไรของมึงเนี่ย!', 'what the—!'], ['ว้ายยย น้ำ!', 'eek, water!'], ['สงกรานต์ยังไม่ถึงนะ!', 'it’s not Songkran yet!']];
        const ln = lines[(v.id + Math.floor(this.time)) % lines.length];
        g.say(v.id, tl(ln[0], ln[1]), { style: 'shout', duration: 2.2 } as any);
      }
    }, T * 1000);
  }

  /** tipped containers this tick (for debug) */
  pouring() { return this.pours.size; }
}
