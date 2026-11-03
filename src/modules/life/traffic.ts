import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SoundHandle } from '../../core/audio';
import { G, groups } from '../../sim/physics';
import { Assets } from '../../core/assets';
import { VDEFS, VDef, vehicleModel, wheelModel, riderGeometries } from './vehicles';
import { h01, hashN, hweighted, bump, qmul } from './util';
import { loop, play } from './sounds';
import { line } from './lines';
import { glowTexture, lifeTex } from './tex';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { libLoad } from '../world/lib';
import { rbox as krbox, tube as ktube, lathe as klathe, mergeLoose } from '../shops/kit';
import type { Life } from './index';

/* ============================================================================================
 * AMBIENT TRAFFIC — client-local & deterministic. Each lane has a seeded schedule of slots
 * (spawn time, type, speed) → ideal position s(t) = (t - t0)·v along the lane polyline, from
 * g.seed + g.lifeT, identical on every peer. Locally, vehicles brake for players standing in
 * the lane (and queue behind each other), honk angrily, then catch up to their schedule.
 * Rendering: one InstancedMesh per vehicle type (+ wheels / riders / lamp glows instanced),
 * pooled positional engine loops, pooled kinematic colliders near the local player.
 * Special passes in the soi: the ice-cream cart (bell) and the junk-buyer truck (loudspeaker).
 * ========================================================================================== */

interface Lane {
  id: number;
  name: string;
  pts: THREE.Vector2[];        // x,z polyline
  cum: number[];
  len: number;
  headway: number;             // seconds between slots (before density)
  speed: number;               // nominal m/s
  soi: boolean;
  motoOnly?: boolean;
  w: number;                   // half width for blocking checks
}

interface Veh {
  key: string;
  lane: Lane;
  def: VDef;
  t0: number;
  v: number;
  s: number;           // actual arc position
  lag: number;
  speedNow: number;
  honkT: number;
  blockedT: number;
  lat: number;         // lateral offset (moto weaving)
  seed: number;
  pos: THREE.Vector3;
  yaw: number;
  alive: boolean;
  rider?: { helmet: boolean; shirt: THREE.Color; pants: THREE.Color; helm: THREE.Color; box: number; pax: boolean; skin: THREE.Color };
  special?: 'icecream' | 'junk';
}

const SHIRTS = ['#2f63b8', '#c8423a', '#f2f0ea', '#1d1d1f', '#e8682a', '#3a8a4a', '#d6b25a', '#7b4f9e', '#5a6a7a', '#e0457b'];
const PANTS = ['#2c3a58', '#1d2230', '#26272c', '#5a5040', '#3d4752'];
const HELMS = ['#f2f0ea', '#1d1d1f', '#c8423a', '#2f63b8', '#e8c040', '#d0d0d0'];
const SKINS = ['#d2a582', '#c4936d', '#a87652', '#8d5f3e', '#b98a64'];
const HAIR = new THREE.Color('#141110');

function laneOf(id: number, name: string, pts: [number, number][], headway: number, speed: number, soi = false, motoOnly = false): Lane {
  const P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  return { id, name, pts: P, cum, len: cum[cum.length - 1], headway, speed, soi, motoOnly, w: soi ? 1.4 : 1.6 };
}

export class Traffic {
  private lanes: Lane[] = [];
  private veh = new Map<string, Veh>();
  private group: THREE.Group | null = null;
  /** body = first part; extra = further material parts of the real (GLB) model */
  private inst = new Map<string, { body: THREE.InstancedMesh; extra?: THREE.InstancedMesh[]; cut?: THREE.InstancedMesh; cap: number; n: number }>();
  /** ice-cream sidecar cart parts (instanced, one per ice-cream bike) */
  private side: THREE.InstancedMesh[] = [];
  private wheels: THREE.InstancedMesh | null = null;
  private riders: Record<string, THREE.InstancedMesh> = {};
  /** baked real-character riders (seated, hands on the bars): [rider, passenger] instanced meshes per variant */
  private bakedRiders: { arch: string; ride: THREE.InstancedMesh[]; pax: THREE.InstancedMesh[]; n: number; np: number }[] = [];
  private riderBake: { arch: string; rig: any; n: number }[] = [];
  private riderBakeStarted = false;
  private boxes: THREE.InstancedMesh | null = null;
  private glowHead: THREE.InstancedMesh | null = null;
  private glowTail: THREE.InstancedMesh | null = null;
  private spots: THREE.SpotLight[] = [];
  private loops: { v: Veh | null; h: SoundHandle | null; key: string }[] = [];
  private colliders: { body: any; v: Veh | null }[] = [];
  private seed = 1;
  private tAudio = 0;
  private hornT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private specialBubble: any = null;
  built = false;

  constructor(private game: Game, private life: Life) {}

  init() {}

  build() {
    const game = this.game;
    if (!game.scene || this.built) return;
    this.built = true;
    this.seed = (game.g.seed ?? 1) | 0;
    const q = qmul();
    // ---- lanes (Thailand drives on the LEFT)
    this.lanes = [
      laneOf(0, 'E_curb', [[-150, 7.9], [150, 7.9]], 3.4 / q, 10.5),
      laneOf(1, 'E_fast', [[-150, 11.4], [150, 11.4]], 4.6 / q, 13),
      laneOf(2, 'W_fast', [[150, 16.6], [-150, 16.6]], 4.6 / q, 13),
      laneOf(3, 'W_curb', [[150, 20.1], [-150, 20.1]], 3.4 / q, 10.5),
      laneOf(4, 'E_moto', [[-150, 7.1], [150, 7.1]], 5.5 / q, 11.5, false, true),
      laneOf(5, 'W_moto', [[150, 20.9], [-150, 20.9]], 5.5 / q, 11.5, false, true),
      // soi: in from the main road (left turn), out at the canal road (left turn) and back
      laneOf(6, 'soi_N', [[-150, 7.9], [-7, 7.9], [-2.8, 5.0], [-1.75, 1.5], [-1.75, -156.5], [-3.5, -159.3], [-8, -159.3], [-150, -159.3]], 26 / q, 7.5, true),
      laneOf(7, 'soi_S', [[-150, -161], [-6, -161], [-0.4, -160.6], [1.75, -157], [1.75, 2.0], [3.0, 5.6], [8, 7.9], [150, 7.9]], 26 / q, 7.5, true),
    ];
    const g = (this.group = new THREE.Group());
    g.name = 'life:traffic';
    game.scene.add(g);
    // ---- instanced bodies
    const caps: Record<string, number> = { moto_red: 40, moto_blue: 34, tuktuk: 10, taxi_pink: 12, taxi_gy: 10, pickup: 12, songthaew: 8, bus_red: 5, icecream: 2, junk: 2 };
    for (const id of Object.keys(VDEFS)) {
      const mdl = vehicleModel(id);
      const cap = caps[id] ?? 8;
      const body = new THREE.InstancedMesh(mdl.geo, mdl.mat, cap);
      body.castShadow = id === 'bus_red' || id === 'songthaew' || id === 'pickup';
      body.receiveShadow = true;
      body.frustumCulled = false;
      body.count = 0;
      // motorbikes stay out of the scene until the real scooter model replaces them (loadRealMotos)
      if (!isMotoKind(VDEFS[id].kind)) g.add(body);
      let cut: THREE.InstancedMesh | undefined;
      if (mdl.cutout) {
        cut = new THREE.InstancedMesh(mdl.cutout.geo, mdl.cutout.mat, cap);
        cut.frustumCulled = false;
        cut.count = 0;
        cut.castShadow = true;
        g.add(cut);
      }
      this.inst.set(id, { body, cut, cap, n: 0 });
    }
    const wm = wheelModel();
    this.wheels = new THREE.InstancedMesh(wm.geo, wm.mat, 400);
    this.wheels.frustumCulled = false; this.wheels.count = 0; g.add(this.wheels);
    // riders (instanceColor per part)
    const rg = riderGeometries();
    const rmat = (rough = 0.85) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough });
    for (const [k, geo] of Object.entries(rg)) {
      const im = new THREE.InstancedMesh(geo, rmat(k === 'helmet' ? 0.3 : 0.85), 140);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(140 * 3).fill(1), 3);
      im.frustumCulled = false; im.count = 0; im.castShadow = true;
      g.add(im);
      this.riders[k] = im;
    }
    // delivery boxes (instanced, colour per instance)
    this.boxes = new THREE.InstancedMesh(deliveryBagGeometry(), deliveryBagMaterial(), 40);
    this.boxes.castShadow = true;
    this.boxes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3).fill(1), 3);
    this.boxes.frustumCulled = false; this.boxes.count = 0; g.add(this.boxes);
    // lamp glows (additive camera-facing quads)
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = (c: number) => new THREE.MeshBasicMaterial({ map: glowTexture(), color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowHead = new THREE.InstancedMesh(glowGeo, glowMat(0xfff2c8), 160);
    this.glowTail = new THREE.InstancedMesh(glowGeo, glowMat(0xff2a1a), 160);
    for (const gl of [this.glowHead, this.glowTail]) { gl.frustumCulled = false; gl.count = 0; gl.renderOrder = 4; g.add(gl); }
    // pooled spot lights for the nearest oncoming headlights (night)
    const nSpots = q >= 1 ? 3 : 1;
    for (let i = 0; i < nSpots; i++) {
      const s = new THREE.SpotLight(0xfff0d0, 0, 28, 0.55, 0.6, 1.4);
      s.visible = false;
      g.add(s, s.target);
      this.spots.push(s);
    }
    // pooled kinematic colliders
    const phys = game.physics;
    if (phys) {
      for (let i = 0; i < 8; i++) {
        const R = phys.R;
        const body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -200 - i * 5, 0));
        const col = phys.world.createCollider(R.ColliderDesc.cuboid(1, 0.8, 2.3).setCollisionGroups(groups(G.VEHICLE, G.PLAYER | G.ITEM | G.NPC)), body);
        this.colliders.push({ body: { body, col, hx: 1, hy: 0.8, hz: 2.3 }, v: null });
      }
    }
    for (let i = 0; i < 4; i++) this.loops.push({ v: null, h: null, key: '' });
    this.loadRealMotos();
    this.loadRealCars();
  }

  /**
   * Motorbikes (+ the ice-cream sidecar bike) are only ever drawn with a real scooter model: the photoscanned library
   * Honda Wave (moto_red, ice-cream) and Super Cub (moto_blue) — the bikes every Bangkok win / delivery rider uses —
   * or, if the library can't load, the sculpted ghost_scooter.glb. Until a model is in, moto traffic is not rendered,
   * heard or collided with at all (no placeholder boxes).
   */
  private loadRealMotos() {
    type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; tint: boolean };
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);   // models face +Z; traffic vehicles face -Z
    const fromGhost = (): Promise<Part[]> => Assets.glb('gen/life/models/ghost_scooter.glb').then((gl: any) => {
      gl.scene.updateMatrixWorld(true);
      let mesh: THREE.Mesh | null = null;
      gl.scene.traverse((o: any) => { if (o.isMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
      if (!mesh) throw new Error('ghost_scooter: no mesh');
      const m = mesh as THREE.Mesh;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
      return [{ geo: m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(flip), mat, tint: true }];
    });
    const fromLib = (id: string): Promise<Part[]> => libLoad(id).then((a) => {
      if (!a || !a.parts.length) throw new Error(id + ': not loaded');
      // photoscans carry their own paint (one baked material): no instance tint
      return a.parts.map((p) => ({ geo: p.geom.clone().applyMatrix4(flip), mat: p.mat, tint: false }));
    });
    const pick = async (id: string): Promise<Part[]> => {
      try { return await fromLib(id); } catch (e: any) {
        console.warn('[life] traffic scooter: library', id, 'failed, using ghost_scooter.glb', e?.message ?? e);
        return fromGhost();
      }
    };
    // (the library Super Cub photoscan's texture rebake is shattered up close: every traffic moto uses the Wave)
    Promise.all([pick('scooter_wave')]).then(([wave]) => {
      const cub = wave;
      if (!this.group) return;
      for (const id of Object.keys(VDEFS)) {
        if (!isMotoKind(VDEFS[id].kind)) continue;
        const it = this.inst.get(id);
        if (!it) continue;
        const parts = id === 'moto_blue' ? cub : wave;
        const ims = parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geo, p.tint ? p.mat.clone() : p.mat, it.cap);
          im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.count = 0;
          this.group!.add(im);
          return im;
        });
        if (parts[0].tint) {
          // sculpted fallback: paint variation per instance
          const body = ims[0];
          body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(it.cap * 3).fill(1), 3);
          const tints = id === 'moto_red' ? ['#ffffff', '#c8c8d0', '#ffd0c0'] : ['#7a90ff', '#9a9a9a', '#3a3a3a'];
          for (let i = 0; i < it.cap; i++) body.setColorAt(i, new THREE.Color(tints[i % tints.length]));
        }
        it.body.removeFromParent();
        it.cut?.removeFromParent();
        it.body = ims[0];
        it.extra = ims.slice(1);
        it.cut = undefined;
      }
      // ice-cream sidecar cart
      const cap = this.inst.get('icecream')?.cap ?? 2;
      for (const p of icecreamSidecar()) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, cap);
        im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.count = 0;
        this.group.add(im);
        this.side.push(im);
      }
      this.realMotos = true;
    }).catch((e) => console.warn('[life] traffic scooter: no real model, motorbike traffic stays hidden', e?.message ?? e));
  }
  private realMotos = false;
  /** vehicle ids whose real model carries its own wheels (no generic spinning wheels drawn) */
  private ownWheels = new Set<string>();

  /**
   * Cars, pickups, songthaews, the junk truck, buses and tuk-tuks are real models too (shared library): the photoscan-ish
   * sedan repainted as Bangkok taxis (all-pink / green-and-yellow two-tone) with a TAXI-METER roof sign, the Hilux (pickup,
   * + a built canopy and benches = songthaew, + a load of scrap = รถรับซื้อของเก่า), the city bus, the tuk-tuk. The old
   * lofted photo boxes stay only until (or if) a model fails to load.
   */
  private loadRealCars() {
    type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };
    const CARS: Record<string, { lib: string; flip: boolean; own: boolean; paint?: 'pink' | 'gy'; add?: (h: number) => Part[] }> = {
      taxi_pink: { lib: 'car_sedan', flip: false, own: false, paint: 'pink', add: taxiSign },
      taxi_gy: { lib: 'car_sedan', flip: false, own: false, paint: 'gy', add: taxiSign },
      pickup: { lib: 'pickup_hilux', flip: true, own: true },
      songthaew: { lib: 'pickup_hilux', flip: true, own: true, add: songthaewCanopy },
      junk: { lib: 'pickup_hilux', flip: true, own: true, add: junkLoad },
      bus_red: { lib: 'bus_city', flip: false, own: true },
      tuktuk: { lib: 'tuktuk', flip: true, own: true },
    };
    for (const [id, c] of Object.entries(CARS)) {
      libLoad(c.lib).then((a) => {
        if (!a || !a.parts.length || !this.group) return;
        const it = this.inst.get(id);
        if (!it) return;
        const d = VDEFS[id];
        const size = a.box.getSize(new THREE.Vector3());
        const k = d.len / Math.max(0.1, size.z);
        const M = new THREE.Matrix4().makeScale(k, k, k);
        if (c.flip) M.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
        // biggest textured part = painted body
        let bodyIdx = 0, best = -1;
        a.parts.forEach((p, i) => { const n = p.geom.getAttribute('position').count * ((p.mat as any).map ? 2 : 1); if (n > best) { best = n; bodyIdx = i; } });
        const parts: Part[] = a.parts.map((p, i) => ({ geo: p.geom.clone().applyMatrix4(M), mat: c.paint && i === bodyIdx ? taxiPaint(p.mat as THREE.MeshStandardMaterial, c.paint, size.y * k) : p.mat }));
        if (c.add) parts.push(...c.add(size.y * k));
        const ims = parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geo, p.mat, it.cap);
          im.frustumCulled = false; im.castShadow = id === 'bus_red' || id === 'songthaew' || id === 'pickup' || id.startsWith('taxi'); im.receiveShadow = true; im.count = 0;
          this.group!.add(im);
          return im;
        });
        it.body.removeFromParent(); it.cut?.removeFromParent();
        it.body = ims[0]; it.extra = ims.slice(1); it.cut = undefined;
        if (c.own) this.ownWheels.add(id);
      }).catch((e) => console.warn('[life] traffic car model', id, e?.message ?? e));
    }
  }

  dispose() {
    for (const l of this.loops) l.h?.stop(0.3);
    this.loops = [];
    const phys = this.game.physics;
    for (const c of this.colliders) { try { phys?.removeBody(c.body.body); } catch {} }
    this.colliders = [];
    this.group?.removeFromParent();
    this.group?.traverse((o: any) => { if (o.isInstancedMesh && o.geometry && !o.geometry.userData?.shared) {} });
    this.group = null;
    this.inst.clear();
    this.side = [];
    this.realMotos = false;
    this.veh.clear();
    this.specialBubble?.close?.();
    this.built = false;
  }

  // ------------------------------------------------------------------ schedule

  /** traffic density 0..1.4 by hour */
  private density(hour: number, soi: boolean) {
    const base = 0.35 + bump(hour, 7.6, 1.0, 0.75) + bump(hour, 12.2, 1.3, 0.35) + bump(hour, 17.8, 1.4, 0.8) + bump(hour, 20.5, 1.5, 0.25);
    const late = hour > 22 ? Math.max(0.25, 1 - (hour - 22) * 0.35) : 1;
    return Math.min(1.25, base * late) * (soi ? 0.8 : 1);
  }

  private pickType(lane: Lane, i: number): VDef {
    if (lane.motoOnly) return VDEFS[h01(this.seed, lane.id, i, 3) < 0.55 ? 'moto_red' : 'moto_blue'];
    const ids = Object.keys(VDEFS).filter((k) => (lane.soi ? (VDEFS[k].soi ?? 0) : VDEFS[k].weight) > 0);
    const w = ids.map((k) => (lane.soi ? VDEFS[k].soi ?? 0 : VDEFS[k].weight) * (lane.name.includes('fast') && VDEFS[k].kind === 'moto' ? 0.4 : 1) * (lane.name.includes('fast') && k === 'bus_red' ? 0.2 : 1));
    return VDEFS[hweighted(ids, w, this.seed, lane.id, i, 5)];
  }

  /** special soi passes (ice-cream cart, junk truck) — slots on soi lanes reserved by schedule */
  private specialFor(lane: Lane, i: number, hour: number): 'icecream' | 'junk' | null {
    if (!lane.soi) return null;
    const day = this.game.g.day ?? 1;
    const r = h01(this.seed, day, lane.id, i, 99);
    if (hour >= 9.5 && hour < 17 && r < 0.09) return h01(this.seed, day, i, 98) < 0.55 ? 'icecream' : 'junk';
    return null;
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    if (!this.built || !this.group) return;
    const game = this.game;
    const T = this.life.clock.t;
    const hour = game.clock.time;
    const cam = game.camera.getWorldPosition(this.tmp).clone();
    const players = game.players().filter((p) => p.p).map((p) => new THREE.Vector3(p.p[0], p.p[1], p.p[2]));
    const seen = new Set<string>();
    const lpos = new THREE.Vector2(), ltan = new THREE.Vector2();

    for (const lane of this.lanes) {
      const maxDur = lane.len / (lane.speed * 0.5);
      const i0 = Math.max(0, Math.floor((T - maxDur) / lane.headway)), i1 = Math.floor(T / lane.headway);
      // vehicles in this lane, front first (largest s)
      const laneVeh: Veh[] = [];
      for (let i = i1; i >= i0; i--) {
        const hourAt = hour - (T - i * lane.headway) / 66.7;
        const jitter = h01(this.seed, lane.id, i, 1) * lane.headway * 0.55;
        const t0 = i * lane.headway + jitter;
        if (t0 > T) continue;
        const special = this.specialFor(lane, i, hourAt);
        if (!special && h01(this.seed, lane.id, i, 2) > this.density(hourAt, lane.soi) * (lane.soi ? 0.55 : 0.85)) continue;
        const def = special ? VDEFS[special] : this.pickType(lane, i);
        const v = special ? def.speed[0] : Math.min(lane.speed * (0.94 + h01(this.seed, lane.id, i, 4) * 0.08), def.speed[1]);
        const sIdeal = (T - t0) * v;
        const key = lane.id + ':' + i;
        let vh = this.veh.get(key);
        if (sIdeal > lane.len + 6) { if (vh && vh.s > lane.len + 4) { this.veh.delete(key); continue; } if (!vh) continue; }
        if (!vh) {
          vh = { key, lane, def, t0, v, s: sIdeal, lag: 0, speedNow: v, honkT: 0, blockedT: 0, lat: 0, seed: hashN(this.seed, lane.id, i), pos: new THREE.Vector3(), yaw: 0, alive: true, special: special ?? undefined };
          if (def.rider) {
            const sd = vh.seed;
            const pick = (a: string[], n: number) => new THREE.Color(a[Math.floor(h01(sd, n) * a.length)]);
            const box = h01(sd, 11) < 0.26 ? 1 + Math.floor(h01(sd, 12) * 3) : 0;
            vh.rider = { helmet: h01(sd, 10) < 0.62, shirt: box === 1 ? new THREE.Color('#14a83c') : box === 2 ? new THREE.Color('#0fae5c') : box === 3 ? new THREE.Color('#e0217a') : pick(SHIRTS, 13), pants: pick(PANTS, 14), helm: pick(HELMS, 15), box, pax: h01(sd, 16) < 0.22 && box === 0, skin: pick(SKINS, 17) };
            if (lane.id === 4 || lane.id === 5) { if (h01(sd, 18) < 0.3) { vh.rider.shirt = new THREE.Color('#e8682a'); } } // win-moto orange vests
          }
          this.veh.set(key, vh);
        }
        laneVeh.push(vh);
      }
      laneVeh.sort((a, b) => b.s - a.s);
      // advance with braking
      let ahead: Veh | null = null;
      for (const vh of laneVeh) {
        const sIdeal = (T - vh.t0) * vh.v;
        let want = vh.v * (vh.lag > 0.05 ? 1.3 : 1);
        const target = sIdeal - vh.lag;
        // obstacles: players in the lane ahead
        let block = Infinity;
        this.at(lane, vh.s, lpos, ltan);
        for (const pp of players) {
          const rel = new THREE.Vector2(pp.x - lpos.x, pp.z - lpos.y);
          const along = rel.dot(ltan);
          const lat = Math.abs(rel.x * -ltan.y + rel.y * ltan.x);
          if (along > 0 && along < 16 && lat < lane.w + 0.4 && pp.y < 2.5) block = Math.min(block, along - vh.def.len / 2 - 1.2);
        }
        if (ahead) block = Math.min(block, ahead.s - ahead.def.len / 2 - (vh.s + vh.def.len / 2) - 1.6);
        let sp: number;
        if (block < 0.4) sp = 0;
        else if (block < 9) sp = Math.min(want, block * 1.1);
        else sp = want;
        // don't run ahead of schedule
        if (vh.s + sp * dt > target && vh.lag <= 0.05) sp = Math.max(0, (target - vh.s) / dt);
        vh.speedNow += (sp - vh.speedNow) * Math.min(1, dt * (sp < vh.speedNow ? 5 : 2));
        vh.s += vh.speedNow * dt;
        vh.lag = Math.max(0, sIdeal - vh.s);
        // honk at players blocking the way
        if (block < 6 && vh.speedNow < 2) {
          vh.blockedT += dt;
          if (vh.blockedT > 0.6 && T > vh.honkT) {
            vh.honkT = T + 1.4 + h01(vh.seed, Math.floor(T)) * 2.5;
            this.honk(vh, true);
          }
        } else vh.blockedT = 0;
        // moto weaving
        if (vh.def.kind === 'moto') vh.lat = Math.sin(T * 0.37 + (vh.seed % 1000) * 0.01) * 0.45 + Math.sin(T * 0.11 + vh.seed % 77) * 0.3;
        // world transform
        this.at(lane, vh.s, lpos, ltan);
        const nx = -ltan.y, nz = ltan.x;
        vh.pos.set(lpos.x + nx * vh.lat, this.game.world?.groundY(lpos.x, lpos.y) ?? 0, lpos.y + nz * vh.lat);
        vh.yaw = Math.atan2(-ltan.x, -ltan.y);
        seen.add(vh.key);
        ahead = vh;
      }
    }
    for (const k of [...this.veh.keys()]) if (!seen.has(k)) this.veh.delete(k);
    this.render(dt, cam, hour);
    this.audio(dt, cam, T);
    this.physicsSync(cam);
  }

  /** point & unit tangent at arc length s */
  private at(l: Lane, s: number, out: THREE.Vector2, tan: THREE.Vector2) {
    const P = l.pts, C = l.cum;
    if (s <= 0) { out.copy(P[0]); tan.subVectors(P[1], P[0]).normalize(); out.addScaledVector(tan, s); return; }
    if (s >= l.len) { const n = P.length; tan.subVectors(P[n - 1], P[n - 2]).normalize(); out.copy(P[n - 1]).addScaledVector(tan, s - l.len); return; }
    let i = 1;
    while (i < C.length - 1 && C[i] < s) i++;
    const t = (s - C[i - 1]) / (C[i] - C[i - 1]);
    out.lerpVectors(P[i - 1], P[i], t);
    tan.subVectors(P[i], P[i - 1]).normalize();
    // smooth corners: blend tangent with the next segment near its end
    if (i < P.length - 1 && C[i] - s < 3) {
      const nt = new THREE.Vector2().subVectors(P[i + 1], P[i]).normalize();
      tan.lerp(nt, 1 - (C[i] - s) / 3).normalize();
    }
  }

  private honk(vh: Veh, angry: boolean) {
    play(vh.def.horn, { pos: vh.pos.clone().setY(1), vol: angry ? 0.9 : 0.5, max: 70 });
    if (angry && h01(vh.seed, Math.floor(this.life.clock.t)) < 0.35) {
      const p = vh.pos.clone().setY(vh.def.hgt + 0.6);
      this.game.ui.shout(p, line('horn_angry'), { duration: 1.6 });
    }
  }

  // ------------------------------------------------------------------ rendering

  /** archetypes that ride: win drivers in orange vests, delivery riders, everyday commuters */
  private static RIDER_ARCHS = ['moto_taxi', 'delivery_rider', 'office_worker_m', 'student_f', 'uncle_singlet', 'construction_worker', 'housewife', 'office_worker_f'];
  private startRiderBake() {
    this.riderBakeStarted = true;
    const chars: any = this.game.chars;
    if (!chars?.create) return;
    const all: string[] = chars.archetypes?.() ?? [];
    for (const [i, arch] of Traffic.RIDER_ARCHS.entries()) {
      if (all.length && !all.includes(arch)) continue;
      try {
        const rig = chars.create(chars.randomLook(arch, 4411 + i * 977 + this.seed), { lod: 'low', castShadow: false });
        rig.play('sit', { loop: true });
        this.riderBake.push({ arch, rig, n: 0 });
      } catch (e) { console.warn('[life] rider rig failed', arch, e); }
    }
  }
  /** pose (sit + reach for the handlebars), validate (no bind T-pose), bake to instanced meshes */
  private riderBakeStep() {
    if (!this.group) return;
    for (const p of [...this.riderBake]) {
      p.rig.update(1 / 30); p.n++;
      if (p.n < 30 || p.n % 10) continue;
      const done = () => this.riderBake.splice(this.riderBake.indexOf(p), 1);
      const sm: THREE.SkinnedMesh | undefined = p.rig.mesh_ ?? p.rig.mesh;
      if (!sm?.isSkinnedMesh) { p.rig.dispose(); done(); continue; }
      const root: THREE.Object3D = p.rig.root;
      root.updateMatrixWorld(true);
      const bone = (n: string) => sm.skeleton.bones.find((b) => b.name === n);
      const pelvis = bone('pelvis');
      if (!pelvis) { p.rig.dispose(); done(); continue; }
      const pv = pelvis.getWorldPosition(new THREE.Vector3());
      const pax = bakeSkinned(sm, root);
      pax.computeBoundingBox();
      if (pax.boundingBox!.max.x - pax.boundingBox!.min.x > 1.1) { pax.dispose(); if (p.n > 900) { p.rig.dispose(); done(); } continue; }   // clips not in yet
      // the hip sits ~0.88 m above the road; hands reach the grips (rig faces +Z here)
      const lift = 0.88 - pv.y;
      for (const side of ['l', 'r']) {
        const ua = bone('upperarm_' + side), la = bone('lowerarm_' + side), hd = bone('hand_' + side);
        if (!ua || !la || !hd) continue;
        const sx = ua.getWorldPosition(new THREE.Vector3()).x;
        const grip = new THREE.Vector3(Math.sign(sx || (side === 'l' ? 1 : -1)) * 0.27, 1.0 - lift, pv.z + 0.6);
        const sh = ua.getWorldPosition(new THREE.Vector3());
        const elbow = sh.clone().lerp(grip, 0.5).add(new THREE.Vector3(Math.sign(sx) * 0.07, -0.1, -0.04));
        aimBone(ua, la, elbow);
        aimBone(la, hd, grip);
      }
      const ride = bakeSkinned(sm, root);
      const place = new THREE.Matrix4().makeTranslation(0, lift, 0.18).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, 0, -pv.z));
      const paxPlace = new THREE.Matrix4().makeTranslation(0, lift + 0.04, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, 0, -pv.z));
      ride.applyMatrix4(place); pax.applyMatrix4(paxPlace);
      const mats = Array.isArray(sm.material) ? sm.material : [sm.material];
      const body = new THREE.MeshStandardMaterial({ map: (mats[0] as any).map, roughness: 0.82 });
      const matArr = mats.length > 1 ? [body, mats[1]] : body;
      const mk = (g: THREE.BufferGeometry, cap: number) => { const im = new THREE.InstancedMesh(g, matArr as any, cap); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.name = 'rider:' + p.arch; this.group!.add(im); return im; };
      this.bakedRiders.push({ arch: p.arch, ride: [mk(ride, 40)], pax: [mk(pax, 12)], n: 0, np: 0 });
      done();
    }
    // the capsule riders are a fallback only
    if (this.bakedRiders.length >= 3) for (const k of Object.keys(this.riders)) this.riders[k].visible = false;
  }

  private render(dt: number, cam: THREE.Vector3, hour: number) {
    const night = this.game.clock.nightFactor;
    if (this.realMotos && !this.riderBakeStarted) this.startRiderBake();
    if (this.riderBake.length) this.riderBakeStep();
    const useBaked = this.bakedRiders.length >= 3;
    for (const b of this.bakedRiders) { b.n = 0; b.np = 0; }
    for (const it of this.inst.values()) it.n = 0;
    let nw = 0, nr = 0, nb = 0, ngh = 0, ngt = 0, ns = 0;
    const camQ = this.game.camera.getWorldQuaternion(new THREE.Quaternion());
    const wheelsIM = this.wheels!, R = this.riders, boxes = this.boxes!;
    const near: Veh[] = [];
    for (const vh of this.veh.values()) {
      const dx = vh.pos.x - cam.x, dz = vh.pos.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 170 * 170) continue;
      if (!this.realMotos && isMotoKind(vh.def.kind)) continue;
      const it = this.inst.get(vh.def.id);
      if (!it || it.n >= it.cap) continue;
      // body tilt for motorbikes in turns / weaving
      const lean = vh.def.kind === 'moto' ? Math.sin(this.life.clock.t * 0.37 + (vh.seed % 1000) * 0.01 + 1.57) * 0.08 : 0;
      this.e.set(0, vh.yaw, lean, 'YXZ');
      this.q.setFromEuler(this.e);
      this.m.compose(vh.pos, this.q, this.one);
      it.body.setMatrixAt(it.n, this.m);
      it.cut?.setMatrixAt(it.n, this.m);
      if (it.extra) for (const x of it.extra) x.setMatrixAt(it.n, this.m);
      it.n++;
      if (vh.def.id === 'icecream' && this.side.length && ns < this.side[0].instanceMatrix.count) { for (const x of this.side) x.setMatrixAt(ns, this.m); ns++; }
      // wheels
      const spin = vh.s;
      const ownWheels = (this.realMotos && (vh.def.kind === 'moto' || vh.def.kind === 'icecream')) || this.ownWheels.has(vh.def.id);
      if (!ownWheels) for (const w of vh.def.wheels) {
        const xs = w.x > 0 ? [w.x, -w.x] : [0];
        for (const x of xs) {
          if (nw >= 400) break;
          const lp = this.tmp.set(x, w.r, w.z).applyQuaternion(this.q).add(vh.pos);
          const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-spin / w.r, vh.yaw, lean, 'YXZ'));
          // order: yaw first then spin around local X
          const qy = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, vh.yaw, lean, 'YXZ'));
          const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -spin / w.r);
          wq.copy(qy).multiply(qs);
          const width = vh.def.kind === 'moto' || vh.def.kind === 'icecream' || (vh.def.kind === 'tuktuk' && x === 0) ? 0.11 : vh.def.kind === 'bus' ? 0.32 : 0.21;
          this.m.compose(lp, wq, new THREE.Vector3(width, w.r, w.r));
          wheelsIM.setMatrixAt(nw++, this.m);
        }
      }
      // rider(s)
      if (vh.rider && nr < 138) {
        const rd = vh.rider;
        const place = (zoff: number, scale = 1, passenger = false) => {
          const off = this.tmp.set(0, 0, zoff).applyQuaternion(this.q);
          const at = vh.pos.clone().add(off).setY(vh.pos.y + (vh.def.kind === 'tuktuk' ? -0.1 : -0.12));
          this.m.compose(at, this.q, new THREE.Vector3(scale, scale, scale));
          if (useBaked) {
            // a real character: delivery riders, win drivers in their orange vests, everyone else by seed
            const B = this.bakedRiders;
            const want = rd.box ? 'delivery_rider' : rd.shirt.getHex() === 0xe8682a ? 'moto_taxi' : null;
            const b = (want && B.find((x) => x.arch === want)) || B[(vh.seed + (passenger ? 3 : 0)) % B.length];
            const list = passenger ? b.pax : b.ride;
            const cnt = passenger ? b.np : b.n;
            if (cnt < list[0].instanceMatrix.count) { for (const im of list) im.setMatrixAt(cnt, this.m); if (passenger) b.np++; else b.n++; }
            nr++;
            return;
          }
          for (const k of ['shirt', 'skin', 'pants']) R[k].setMatrixAt(nr, this.m);
          const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
          R.helmet.setMatrixAt(nr, rd.helmet ? this.m : hidden);
          R.hair.setMatrixAt(nr, rd.helmet ? hidden : this.m);
          R.shirt.setColorAt(nr, rd.shirt);
          R.skin.setColorAt(nr, rd.skin);
          R.pants.setColorAt(nr, rd.pants);
          R.helmet.setColorAt(nr, rd.helm);
          R.hair.setColorAt(nr, HAIR);
          nr++;
        };
        place(vh.def.kind === 'tuktuk' ? -0.75 : 0);
        if (rd.pax && nr < 138) place(0.42, 0.97, true);
        if (rd.box && nb < 40) {
          this.m.compose(vh.pos, this.q, this.one);
          boxes.setMatrixAt(nb, this.m);
          boxes.setColorAt(nb, rd.box === 3 ? new THREE.Color('#e0217a') : new THREE.Color('#12a14a'));
          nb++;
        }
      }
      // lamps
      if (night > 0.05) {
        for (const hp of vh.def.head) {
          const p = this.tmp.set(hp[0], hp[1], hp[2] - 0.04).applyQuaternion(this.q).add(vh.pos);
          this.m.compose(p, camQ, new THREE.Vector3(0.9, 0.9, 0.9).multiplyScalar(0.6 + night * 0.6));
          this.glowHead!.setMatrixAt(ngh++, this.m);
        }
        for (const tp of vh.def.tail) {
          const p = this.tmp.set(tp[0], tp[1], tp[2] + 0.04).applyQuaternion(this.q).add(vh.pos);
          this.m.compose(p, camQ, new THREE.Vector3(0.45, 0.45, 0.45).multiplyScalar(0.6 + night * 0.6));
          this.glowTail!.setMatrixAt(ngt++, this.m);
        }
        if (d2 < 45 * 45) near.push(vh);
      }
    }
    for (const it of this.inst.values()) {
      it.body.count = it.n; it.body.instanceMatrix.needsUpdate = true;
      if (it.cut) { it.cut.count = it.n; it.cut.instanceMatrix.needsUpdate = true; }
      if (it.extra) for (const x of it.extra) { x.count = it.n; x.instanceMatrix.needsUpdate = true; }
    }
    wheelsIM.count = nw; wheelsIM.instanceMatrix.needsUpdate = true;
    for (const k of Object.keys(R)) { R[k].count = nr; R[k].instanceMatrix.needsUpdate = true; if (R[k].instanceColor) R[k].instanceColor!.needsUpdate = true; }
    for (const b of this.bakedRiders) { for (const im of b.ride) { im.count = b.n; im.instanceMatrix.needsUpdate = true; } for (const im of b.pax) { im.count = b.np; im.instanceMatrix.needsUpdate = true; } }
    boxes.count = nb; boxes.instanceMatrix.needsUpdate = true; if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    for (const x of this.side) { x.count = ns; x.instanceMatrix.needsUpdate = true; }
    this.glowHead!.count = ngh; this.glowHead!.instanceMatrix.needsUpdate = true;
    this.glowTail!.count = ngt; this.glowTail!.instanceMatrix.needsUpdate = true;
    // headlight spots on the nearest vehicles
    near.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    this.spots.forEach((s, i) => {
      const vh = near[i];
      if (!vh || night < 0.2) { s.visible = false; return; }
      s.visible = true;
      s.intensity = 22 * night;
      const fwd = new THREE.Vector3(-Math.sin(vh.yaw), 0, -Math.cos(vh.yaw));
      s.position.copy(vh.pos).addScaledVector(fwd, vh.def.len / 2).setY(vh.pos.y + 0.9);
      s.target.position.copy(s.position).addScaledVector(fwd, 10).setY(vh.pos.y);
    });
  }

  // ------------------------------------------------------------------ audio

  private audio(dt: number, cam: THREE.Vector3, T: number) {
    this.tAudio -= dt;
    // keep loop positions fresh every frame
    for (const l of this.loops) if (l.v && l.h) {
      if (!this.veh.has(l.v.key)) { l.h.stop(0.4); l.h = null; l.v = null; continue; }
      l.h.setPos(l.v.pos.clone().setY(0.8));
      l.h.setPitch(0.75 + Math.min(1, l.v.speedNow / Math.max(1, l.v.v)) * 0.5, 0.2);
    }
    if (this.tAudio > 0) return;
    this.tAudio = 0.3;
    const list = [...this.veh.values()].filter((v) => this.realMotos || !isMotoKind(v.def.kind)).map((v) => ({ v, d: v.pos.distanceToSquared(cam) })).filter((o) => o.d < 38 * 38).sort((a, b) => a.d - b.d).slice(0, this.loops.length);
    const want = new Set(list.map((o) => o.v.key));
    for (const l of this.loops) if (l.v && !want.has(l.v.key)) { l.h?.stop(0.5); l.h = null; l.v = null; }
    for (const o of list) {
      if (this.loops.some((l) => l.v === o.v)) continue;
      const slot = this.loops.find((l) => !l.v);
      if (!slot) break;
      const name = o.v.special === 'icecream' ? 'icecream_bell' : o.v.special === 'junk' ? 'junk_speaker' : o.v.def.engine;
      slot.v = o.v;
      slot.h = loop(name, { pos: o.v.pos.clone().setY(0.8), vol: o.v.special ? 0.9 : o.v.def.kind === 'moto' ? 0.55 : 0.7, ref: o.v.special ? 6 : 3, max: o.v.special ? 60 : 40 });
      slot.key = name;
      if (o.v.special === 'junk' || o.v.special === 'icecream') {
        const vv = o.v;
        this.specialBubble?.close?.();
        this.specialBubble = this.game.ui.say(() => vv.pos.clone().setY(vv.def.hgt + 0.7), line(o.v.special === 'junk' ? 'junk' : 'icecream'), { duration: 5, style: 'shout' });
      }
    }
    // ambient honks & passes
    this.hornT -= 0.3;
    if (this.hornT < 0) {
      this.hornT = 1.5 + Math.random() * 5;
      const cand = list.filter((o) => o.d < 30 * 30 && !o.v.special);
      if (cand.length) { const o = cand[Math.floor(Math.random() * cand.length)]; this.honk(o.v, false); }
    }
    for (const o of list) {
      if (o.v.def.kind === 'moto' && o.d < 7 * 7 && !(o.v as any)._passed) { (o.v as any)._passed = true; play('moto_pass', { pos: o.v.pos.clone().setY(0.8), vol: 0.7 }); }
    }
  }

  // ------------------------------------------------------------------ physics

  private physicsSync(cam: THREE.Vector3) {
    if (!this.colliders.length) return;
    const me = this.game.player?.pos ?? cam;
    const list = [...this.veh.values()].filter((v) => (this.realMotos || !isMotoKind(v.def.kind)) && v.pos.distanceToSquared(me) < 30 * 30).sort((a, b) => a.pos.distanceToSquared(me) - b.pos.distanceToSquared(me)).slice(0, this.colliders.length);
    this.colliders.forEach((c, i) => {
      const vh = list[i];
      const b = c.body.body;
      if (!vh) { b.setNextKinematicTranslation({ x: 0, y: -200 - i * 5, z: 0 }); return; }
      const hx = vh.def.wid / 2, hy = vh.def.hgt / 2, hz = vh.def.len / 2;
      if (Math.abs(c.body.hx - hx) > 0.05 || Math.abs(c.body.hz - hz) > 0.05) {
        try { c.body.col.setHalfExtents({ x: hx, y: hy, z: hz }); } catch {}
        c.body.hx = hx; c.body.hy = hy; c.body.hz = hz;
      }
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), vh.yaw);
      b.setNextKinematicTranslation({ x: vh.pos.x, y: vh.pos.y + hy, z: vh.pos.z });
      b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    });
  }

  /** dev: drop a static copy of a vehicle model (screenshots / checks) */
  debugPlace(id: string, p: ArrayLike<number>, yaw = 0) {
    const mdl = vehicleModel(id);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(mdl.geo, mdl.mat));
    if (mdl.cutout) g.add(new THREE.Mesh(mdl.cutout.geo, mdl.cutout.mat));
    g.position.set(p[0], p[1], p[2]); g.rotation.y = yaw;
    this.game.scene?.add(g);
    return g;
  }

  /** for other systems: vehicles near a point */
  near(p: THREE.Vector3, r: number) { const out: { pos: THREE.Vector3; yaw: number; kind: string }[] = []; for (const v of this.veh.values()) if (v.pos.distanceToSquared(p) < r * r) out.push({ pos: v.pos, yaw: v.yaw, kind: v.def.kind }); return out; }
  get count() { return this.veh.size; }
}

// ------------------------------------------------------------------ real-model helpers (no placeholder boxes)

function isMotoKind(k: string) { return k === 'moto' || k === 'icecream'; }

let bagGeo: THREE.BufferGeometry | null = null;
/** insulated food-delivery bag on the rear rack: padded body, lid flap with a rolled edge, carry strap (vehicle space, -Z forward) */
function deliveryBagGeometry() {
  if (bagGeo) return bagGeo;
  const body = new RoundedBoxGeometry(0.42, 0.34, 0.4, 3, 0.045).translate(0, 1.15, 0.62);
  const lid = new RoundedBoxGeometry(0.44, 0.06, 0.42, 2, 0.025).translate(0, 1.34, 0.62);
  const seam = new RoundedBoxGeometry(0.43, 0.025, 0.41, 1, 0.01).translate(0, 1.035, 0.62);
  const strap = new THREE.TorusGeometry(0.11, 0.012, 5, 14, Math.PI).rotateY(Math.PI / 2).translate(0, 1.37, 0.62);
  const parts = [body, lid, seam, strap].map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  bagGeo = mergeGeometries(parts, false) ?? body;
  return bagGeo;
}
function deliveryBagMaterial() {
  // polyester rider fabric (photo normal map), colour from the instance (green / pink), slight sheen
  const n = lifeTex('textures/clothing/rider_green_poly_normal.jpg', { srgb: false, repeat: [2, 2] });
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.0, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6) });
}

/**
 * Coconut ice-cream sidecar (รถพ่วงข้าง) on the bike's left: stainless freezer cabinet with a lid and handle on a
 * galvanised frame, a small third wheel with a mudguard, a cash tin. Vehicle space (-Z forward, left = -X).
 */
function icecreamSidecar(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const X = -0.7;
  const clean = (gs: THREE.BufferGeometry[]) => {
    const ps = gs.map((g) => { const h = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') h.deleteAttribute(k); return h; });
    return mergeGeometries(ps, false) ?? ps[0];
  };
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const L = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, L, 8, 1, false).translate(0, L / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
    return g.translate(a.x, a.y, a.z);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // cabinet + lid (stainless)
  const cab = new RoundedBoxGeometry(0.56, 0.5, 0.82, 3, 0.04).translate(X, 0.62, 0.05);
  const lid = new RoundedBoxGeometry(0.6, 0.05, 0.86, 2, 0.02).translate(X, 0.895, 0.05);
  const handle = rod(V(X - 0.12, 0.935, 0.05), V(X + 0.12, 0.935, 0.05), 0.012);
  const tin = new RoundedBoxGeometry(0.18, 0.1, 0.14, 2, 0.015).translate(X, 0.97, -0.25);
  const steel = Assets.pbr('aluminium_scratched', { repeat: 1 });
  // frame + mudguard + rim (painted / galvanised)
  const frame = [
    rod(V(-0.12, 0.32, -0.45), V(X, 0.32, -0.45), 0.02), rod(V(-0.12, 0.32, 0.5), V(X, 0.32, 0.5), 0.02),
    rod(V(X - 0.3, 0.34, -0.42), V(X - 0.3, 0.34, 0.5), 0.02), rod(V(X + 0.3, 0.34, -0.42), V(X + 0.3, 0.34, 0.5), 0.02),
    rod(V(X - 0.3, 0.34, -0.42), V(X - 0.3, 0.36, -0.42), 0.02),
    new THREE.CylinderGeometry(0.235, 0.235, 0.1, 16, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(X - 0.36, 0.2, 0.05),
    new THREE.CylinderGeometry(0.11, 0.11, 0.065, 12).rotateZ(Math.PI / 2).translate(X - 0.36, 0.2, 0.05),
  ];
  const paint = new THREE.MeshStandardMaterial({ color: 0x2f6fb8, roughness: 0.45, metalness: 0.3 });
  const tyre = new THREE.TorusGeometry(0.17, 0.045, 8, 20).rotateY(Math.PI / 2).translate(X - 0.36, 0.2, 0.05);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.92, metalness: 0 });
  return [{ geo: clean([cab, lid, handle, tin]), mat: steel }, { geo: clean(frame), mat: paint }, { geo: clean([tyre]), mat: rubber }];
}

// ------------------------------------------------------------------ baking real riders

/** rotate `bone` (world space) so its child points at `target` */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  bone.updateMatrixWorld(true);
  const bp = bone.getWorldPosition(new THREE.Vector3()), cp = child.getWorldPosition(new THREE.Vector3());
  const cur = cp.sub(bp).normalize(), want = target.clone().sub(bp).normalize();
  if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
  const dq = new THREE.Quaternion().setFromUnitVectors(cur, want);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
  bone.updateMatrixWorld(true);
}

/** CPU-skin a SkinnedMesh in its current pose (same maths as the skinning shader) into `root` space */
function bakeSkinned(sm: THREE.SkinnedMesh, root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  sm.skeleton.update();
  const src = sm.geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const si = src.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = src.getAttribute('skinWeight') as THREE.BufferAttribute;
  const bm = sm.skeleton.boneMatrices!;
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
    if (nrm) { n.fromBufferAttribute(nrm, i).applyMatrix3(N3.getNormalMatrix(M)).normalize(); N[i * 3] = n.x; N[i * 3 + 1] = n.y; N[i * 3 + 2] = n.z; }
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

// ------------------------------------------------------------------ real car dressing

/** repaint a car body: keep the texture's shading (panel lines, AO, dirt) as luminance, apply the taxi colours.
 *  'gy' = Bangkok two-tone (green below the belt line, yellow above). */
function taxiPaint(base: THREE.MeshStandardMaterial, mode: 'pink' | 'gy', height: number): THREE.Material {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBelt = { value: height * 0.62 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vObjY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vObjY;\nuniform float uBelt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        ${mode === 'pink' ? 'vec3 paint = vec3(0.93, 0.32, 0.55);' : 'vec3 paint = vObjY < uBelt ? vec3(0.1, 0.42, 0.16) : vec3(0.96, 0.76, 0.1);'}
        diffuseColor.rgb = paint * clamp(lum * 1.9, 0.12, 1.25);
      }`);
  };
  m.customProgramCacheKey = () => 'taxipaint:' + mode;
  return m;
}

let signMat: THREE.Material | null = null;
/** the TAXI-METER roof sign (white plastic box, printed both sides) — traffic vehicle space (front −Z) */
function taxiSign(h: number): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  if (!signMat) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#c81e1e'; x.font = 'bold 40px "K2D", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TAXI-METER', 128, 34);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    signMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, emissive: new THREE.Color(0xffffff), emissiveMap: t, emissiveIntensity: 0.15 });
  }
  const g = new RoundedBoxGeometry(0.62, 0.13, 0.2, 2, 0.03);
  // printed faces (±z): map the canvas, the rest takes a white strip of it
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(n.getZ(i)) > 0.6) uv.setXY(i, 0.5 + (p.getX(i) / 0.62) * (n.getZ(i) > 0 ? 1 : -1), 0.5 + p.getY(i) / 0.13);
    else uv.setXY(i, 0.02, 0.05);
  }
  g.rotateY(Math.PI / 2).translate(0, h + 0.055, 0.15);   // across the roof, read from the side (as in Bangkok)
  return [{ geo: g, mat: signMat }];
}

let canopyMats: { paint: THREE.Material; vinyl: THREE.Material; steel: THREE.Material } | null = null;
/** สองแถว: two bench rows under a painted steel canopy on the Hilux bed (vehicle space, front −Z, rear +Z) */
function songthaewCanopy(h: number): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  canopyMats ??= {
    paint: Assets.pbr('metal_painted_chipped', { repeat: 1, color: 0x2f5aa8, fallback: 0x2f5aa8 }),
    vinyl: new THREE.MeshStandardMaterial({ color: 0x8a1e1a, roughness: 0.45 }),
    steel: Assets.pbr('aluminium_scratched', { repeat: 1, fallback: 0xc0c0c0 }),
  };
  const z0 = 0.35, z1 = 2.55, y0 = h * 0.52, yR = h + 0.42, hw = 0.84;
  const posts: THREE.BufferGeometry[] = [], roof: THREE.BufferGeometry[] = [], seats: THREE.BufferGeometry[] = [];
  for (const x of [-hw, hw]) for (const z of [z0, (z0 + z1) / 2, z1]) posts.push(ktube([x, y0, z], [x, yR, z], 0.025, 8));
  for (const x of [-hw, hw]) posts.push(ktube([x, y0 + 0.62, z0], [x, y0 + 0.62, z1], 0.018, 8), ktube([x, yR - 0.05, z0], [x, yR - 0.05, z1], 0.02, 8));
  roof.push(krbox(hw * 2 + 0.12, 0.06, z1 - z0 + 0.25, 0.025, 1).translate(0, yR, (z0 + z1) / 2));
  for (const x of [-hw + 0.22, hw - 0.22]) {
    seats.push(krbox(0.34, 0.08, z1 - z0 - 0.15, 0.03, 1).translate(x, y0 + 0.36, (z0 + z1) / 2));
    seats.push(krbox(0.05, 0.3, z1 - z0 - 0.15, 0.02, 1).translate(x + Math.sign(x) * 0.2, y0 + 0.42, (z0 + z1) / 2));
  }
  const step = krbox(1.0, 0.04, 0.32, 0.01, 1).translate(0, 0.42, z1 + 0.12);
  return [
    { geo: mergeLoose([...posts, step]), mat: canopyMats.steel },
    { geo: mergeLoose(roof), mat: canopyMats.paint },
    { geo: mergeLoose(seats), mat: canopyMats.vinyl },
  ];
}

let junkMats: { tyre: THREE.Material; card: THREE.Material; drum: THREE.Material; horn: THREE.Material } | null = null;
/** รถรับซื้อของเก่า: tyres, flattened cartons, a rusty drum and a loudspeaker horn on the cab roof */
function junkLoad(h: number): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const b = h * 0.52 - 0.86;   // bed floor offset from the 0.86 m the load was laid out for
  junkMats ??= {
    tyre: Assets.pbr('rubber_black', { repeat: 1, fallback: 0x1c1c1c }),
    card: Assets.pbr('cardboard_worn', { repeat: 1, fallback: 0xa88660 }),
    drum: Assets.pbr('corrugated_rusty', { repeat: 1, fallback: 0x7a4a2a }),
    horn: Assets.pbr('metal_painted_chipped', { repeat: 1, color: 0xd8d8d0, fallback: 0xd8d8d0 }),
  };
  const tyres = [new THREE.TorusGeometry(0.28, 0.1, 8, 16).rotateX(Math.PI / 2).translate(-0.35, 1.0 + b, 1.1), new THREE.TorusGeometry(0.28, 0.1, 8, 16).rotateX(Math.PI / 2 + 0.3).translate(-0.3, 1.18 + b, 1.25)];
  const cards = [krbox(0.8, 0.25, 0.6, 0.02, 0.5).translate(0.35, 0.9 + b, 1.0), krbox(0.7, 0.2, 0.5, 0.02, 0.5).rotateY(0.4).translate(0.3, 1.15 + b, 1.9), krbox(0.5, 0.35, 0.45, 0.02, 0.5).translate(-0.4, 0.9 + b, 2.1)];
  const drum = [new THREE.CylinderGeometry(0.28, 0.28, 0.85, 14).translate(0.4, 1.32 + b, 1.7)];
  const horn = [klathe([[0.02, 0], [0.04, 0.05], [0.18, 0.28], [0.19, 0.3]], 14).rotateX(-Math.PI / 2 + 0.15).translate(0, h + 0.12, -0.3), ktube([0, h, -0.3], [0, h + 0.14, -0.3], 0.015, 6)];
  return [
    { geo: mergeLoose(tyres), mat: junkMats.tyre },
    { geo: mergeLoose(cards), mat: junkMats.card },
    { geo: mergeLoose(drum), mat: junkMats.drum },
    { geo: mergeLoose(horn), mat: junkMats.horn },
  ];
}
