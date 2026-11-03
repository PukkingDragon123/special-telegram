import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { Sound } from '../../core/audio';
import { tl, params } from '../../core/util';
import { RNG } from '../../core/rng';
import { text3d } from '../../ui3d/text3d';
import { libModel } from '../world/lib';
import { generate, type Layout } from './gen';
import { Dialogues, LocalTalkers, questApi, type TalkTarget } from '../quests/api';

/* ============================================================================================
 * backrooms — "หลังร้าน": the back room of บ่าวคลาร์ค's furniture store is much bigger than it should be.
 *
 * A walkable, seeded liminal office maze (mono-yellow damp wallpaper, wet mustard carpet, acoustic ceiling
 * tiles, humming fluorescent panels — some flicker), built far outside the map (beyond the camera far plane,
 * so neither place renders the other). The store's back door (world anchor `furniture_backdoor`, published by
 * the build module) teleports you in; the EXIT door in the first room takes you back. Deep inside, at the
 * farthest room, บ่าวคลาร์ค sits at an office desk ("แผนกรับคืนสินค้า") — he was here before you, somehow.
 *
 * While the local camera is inside: sun / sky light / IBL are switched off, the fog turns yellow-grey, a sickly
 * grade is applied, and a synthesised fluorescent hum plays. Real light comes from the world's fixed light pool
 * (registered light points with day = 1 → no shader recompiles).
 * Multiplayer: the layout is seeded from g.seed (identical everywhere); teleports are local to each player.
 * Dev: ?backrooms (start inside), window.__backrooms.
 * ========================================================================================== */

const N = 22;            // cells per side
const C = 3.2;           // cell size (m)
const H = 2.72;          // ceiling height
const T = 0.14;          // wall thickness
const O = new THREE.Vector3(1000, 40, 1000);   // centre of the floor
const HALF = (N * C) / 2;
const TEX = 'gen/backrooms/tex/';

const cellCenter = (i: number, j: number, out = new THREE.Vector3()) => out.set(O.x - HALF + (i + 0.5) * C, O.y, O.z - HALF + (j + 0.5) * C);

// ------------------------------------------------------------------ geometry writer (world-scaled UVs)

class GW {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  constructor(private uvScale: number) {}
  private quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][], cl = 1) {
    const o = this.pos.length / 3;
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]] as [number[], number[]][]) {
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(t[0] / this.uvScale, t[1] / this.uvScale); this.col.push(cl, cl, cl);
    }
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  /** axis-aligned box, all faces except the ones listed in `skip` ('y-' bottom, 'y+' top…) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = '') {
    if (!skip.includes('x+')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[z1, y0], [z0, y0], [z0, y1], [z1, y1]]);
    if (!skip.includes('x-')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    if (!skip.includes('z+')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    if (!skip.includes('z-')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[x1, y0], [x0, y0], [x0, y1], [x1, y1]]);
    if (!skip.includes('y+')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]);
    if (!skip.includes('y-')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  }
  /** horizontal grid plane at y (normal up or down) with per-vertex shade from fn(x, z) */
  plane(x0: number, z0: number, x1: number, z1: number, y: number, seg: number, up: boolean, shade: (x: number, z: number) => number) {
    const o = this.pos.length / 3;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const x = x0 + ((x1 - x0) * i) / seg, z = z0 + ((z1 - z0) * j) / seg, s = shade(x, z);
      this.pos.push(x, y, z); this.nrm.push(0, up ? 1 : -1, 0); this.uv.push(x / this.uvScale, z / this.uvScale); this.col.push(s, s, s);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = o + j * (seg + 1) + i, b = a + 1, c = a + seg + 2, d = a + seg + 1;
      if (up) this.idx.push(a, d, c, a, c, b); else this.idx.push(a, b, c, a, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function tex(name: string, srgb = true) {
  const t = Assets.texture(TEX + name, { srgb });
  t.anisotropy = 8;
  return t;
}

/** smooth value noise-ish field for damp patches (deterministic, no allocs) */
function damp(x: number, z: number, s: number) {
  const a = Math.sin(x * 0.21 + s) * Math.sin(z * 0.17 - s * 1.3) + 0.6 * Math.sin(x * 0.53 + z * 0.41 + s * 2.1) * Math.sin(z * 0.37 - x * 0.11);
  return Math.max(0, Math.min(1, (a - 0.55) * 2.2));
}

// sickly fluorescent grade (applied through the post grade while inside)
const LOOK = { lift: [0.012, 0.01, 0.0] as [number, number, number], gamma: [1.0, 1.0, 0.9] as [number, number, number], gain: [1.05, 1.02, 0.86] as [number, number, number], tint: [1.02, 1.0, 0.86] as [number, number, number], saturation: 0.88, contrast: 1.05, split: 0.15 };

interface Panel { p: THREE.Vector3; lp: any; base: number; faulty: number }

class Backrooms {
  root = new THREE.Group();
  layout!: Layout;
  panels: Panel[] = [];
  panelMesh: THREE.InstancedMesh | null = null;
  inside = false;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private t = 0;
  private surgeT = 0;
  private nextSurge = 30;
  private hum: { g: GainNode; nodes: AudioScheduledSourceNode[]; filt: BiquadFilterNode } | null = null;
  private door: { p: THREE.Vector3; yaw: number } | null = null;
  private exitPos = new THREE.Vector3();
  private exitYaw = 0;
  private clark: { root: THREE.Group; rig: any; head: THREE.Vector3 } | null = null;
  private proxies: THREE.Object3D[] = [];
  private fading = false;
  private _c = new THREE.Color();

  constructor(readonly game: Game) { this.root.name = 'backrooms'; }

  build() {
    const game = this.game;
    const seed = ((game.g.seed ?? 1) | 0) + 505;
    const L = (this.layout = generate(N, seed));
    const rng = new RNG(seed);
    const phys = game.physics;
    // ---------------------------------------------------------------- walls (+ skirting) as merged runs
    const wall = new GW(1.6), skirt = new GW(1.6);
    const X0 = O.x - HALF, Z0 = O.z - HALF, y0 = O.y, y1 = O.y + H;
    const addWall = (x0: number, z0: number, x1: number, z1: number) => {
      wall.box(x0, y0, z0, x1, y1, z1, 'y-');
      const e = 0.012;
      skirt.box(x0 - e, y0, z0 - e, x1 + e, y0 + 0.095, z1 + e, 'y-y+');
      skirt.box(x0 - e, y0 + 0.095, z0 - e, x1 + e, y0 + 0.1, z1 + e, 'y-');     // tiny top lip
      phys?.addBox([(x0 + x1) / 2, y0 + H / 2, (z0 + z1) / 2], [x1 - x0, H, z1 - z0]);
    };
    // walls between rows (along x)
    for (let j = 0; j < N - 1; j++) {
      let i = 0;
      while (i < N) {
        if (!L.h[j * N + i]) { i++; continue; }
        const a = i;
        while (i < N && L.h[j * N + i]) i++;
        const z = Z0 + (j + 1) * C;
        addWall(X0 + a * C - T / 2, z - T / 2, X0 + i * C + T / 2, z + T / 2);
      }
    }
    // walls between columns (along z)
    for (let i = 0; i < N - 1; i++) {
      let j = 0;
      while (j < N) {
        if (!L.v[j * N + i]) { j++; continue; }
        const a = j;
        while (j < N && L.v[j * N + i]) j++;
        const x = X0 + (i + 1) * C;
        addWall(x - T / 2, Z0 + a * C - T / 2, x + T / 2, Z0 + j * C + T / 2);
      }
    }
    // outer walls
    const B = 0.3;
    addWall(X0 - B, Z0 - B, X0 + HALF * 2 + B, Z0);
    addWall(X0 - B, Z0 + HALF * 2, X0 + HALF * 2 + B, Z0 + HALF * 2 + B);
    addWall(X0 - B, Z0, X0, Z0 + HALF * 2);
    addWall(X0 + HALF * 2, Z0, X0 + HALF * 2 + B, Z0 + HALF * 2);
    // pillars
    for (const [i, j] of L.pillars) {
      const x = X0 + i * C, z = Z0 + j * C, s = 0.29;
      addWall(x - s, z - s, x + s, z + s);
    }
    // ---------------------------------------------------------------- floor + ceiling (damp patches, water stains)
    const floor = new GW(1.5), ceil = new GW(1.22);
    floor.plane(X0, Z0, X0 + HALF * 2, Z0 + HALF * 2, y0, N * 2, true, (x, z) => 1 - 0.42 * damp(x, z, 1.7));
    ceil.plane(X0, Z0, X0 + HALF * 2, Z0 + HALF * 2, y1, N * 2, false, (x, z) => 1 - 0.3 * damp(x * 1.3, z * 1.3, 4.2));
    phys?.addBox([O.x, y0 - 0.25, O.z], [HALF * 2 + 2, 0.5, HALF * 2 + 2]);
    phys?.addBox([O.x, y1 + 0.25, O.z], [HALF * 2 + 2, 0.5, HALF * 2 + 2]);
    // ---------------------------------------------------------------- materials (real CC0 scans, ambientCG)
    const wallMat = new THREE.MeshStandardMaterial({ map: tex('wall_albedo.jpg'), normalMap: tex('wall_normal.jpg', false), roughnessMap: tex('wall_rough.jpg', false), color: 0xe3cf7c, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, envMapIntensity: 0.4 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x8a7442, roughness: 0.55, metalness: 0, envMapIntensity: 0.4 });
    const carpetMat = new THREE.MeshStandardMaterial({ map: tex('carpet_albedo.jpg'), normalMap: tex('carpet_normal.jpg', false), roughnessMap: tex('carpet_rough.jpg', false), color: 0xb79d58, roughness: 1, vertexColors: true, envMapIntensity: 0.3 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: tex('ceiling_albedo.jpg'), normalMap: tex('ceiling_normal.jpg', false), roughnessMap: tex('ceiling_rough.jpg', false), color: 0xeee3bf, roughness: 1, vertexColors: true, envMapIntensity: 0.3 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string, cast = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'backrooms:' + name; mesh.castShadow = cast; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      return mesh;
    };
    add(wall.build(), wallMat, 'walls');
    add(skirt.build(), skirtMat, 'skirting', false);
    add(floor.build(), carpetMat, 'carpet', false);
    add(ceil.build(), ceilMat, 'ceiling');
    // ---------------------------------------------------------------- fluorescent panels (instanced) + pooled lights
    const spots: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      spots.push(c.clone().setY(y1 - 0.02));
    }
    const panelG = new RoundedBoxGeometry(1.2, 0.03, 0.6, 2, 0.008);
    const frameG = new RoundedBoxGeometry(1.27, 0.022, 0.67, 2, 0.006).translate(0, 0.008, 0);
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.2, 1.85) });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xc4c0b4, roughness: 0.45, metalness: 0.5 });
    const im = new THREE.InstancedMesh(panelG, panelMat, spots.length);
    const fm = new THREE.InstancedMesh(frameG, frameMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach((p, k) => {
      const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
      m4.compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), one);
      im.setMatrixAt(k, m4); fm.setMatrixAt(k, m4);
      const dead = rng.chance(0.09);
      im.setColorAt(k, this._c.setScalar(dead ? 0.06 : 1));
      const faulty = !dead && rng.chance(0.07) ? rng.range(0.5, 1) : 0;
      let lp: any = null;
      const W: any = this.game.world;
      if (!dead && W?.addLightPoint) {
        lp = W.addLightPoint(p.clone().setY(y1 - 0.15), 0xfff0c4, 7.5, 8.5, 0);
        if (lp) { lp.day = 1; lp.prio = 1; }
      }
      this.panels.push({ p, lp, base: dead ? 0.06 : 1, faulty });
    });
    for (const m of [im, fm]) { m.name = 'backrooms:panels'; m.computeBoundingSphere(); this.root.add(m); }
    im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.panelMesh = im;
    // ---------------------------------------------------------------- the EXIT door in the first room (on the south wall)
    const [ei, ej] = L.entrance;
    const dc = cellCenter(ei, ej);
    const doorP = new THREE.Vector3(dc.x, y0, Z0);
    this.root.add(buildDoor(doorP, 0, true));
    this.exitPos.copy(doorP).add(new THREE.Vector3(0, 0.05, 1.3));
    this.exitYaw = Math.PI;   // facing +z (into the rooms)
    const exitProxy = proxyBox(doorP.clone().add(new THREE.Vector3(0, 1.05, 0.2)), 0);
    this.root.add(exitProxy);
    game.interact.register(exitProxy, { kind: 'backrooms_door', data: { dir: 'out' } });
    this.proxies.push(exitProxy);
    // ---------------------------------------------------------------- store back door (anchor from the build module)
    const a: any = game.world?.anchor?.('furniture_backdoor');
    if (a?.p && (a.p[0] || a.p[2])) {
      this.door = { p: new THREE.Vector3(a.p[0], a.p[1], a.p[2]), yaw: a.yaw ?? 0 };
      const f = new THREE.Vector3(-Math.sin(this.door.yaw), 0, -Math.cos(this.door.yaw));
      const pr = proxyBox(this.door.p.clone().addScaledVector(f, 0.15).setY(this.door.p.y + 1.05), this.door.yaw);
      game.scene!.add(pr);
      game.interact.register(pr, { kind: 'backrooms_door', data: { dir: 'in' } });
      this.proxies.push(pr);
    } else console.warn('[backrooms] no furniture_backdoor anchor: the back room has no entrance (use ?backrooms)');
    // ---------------------------------------------------------------- บ่าวคลาร์ค at the farthest room
    this.buildClark();
    game.scene!.add(this.root);
    this.root.updateMatrixWorld(true);
    for (const o of this.root.children) o.matrixAutoUpdate = false;
  }

  private buildClark() {
    const game = this.game;
    const [fi, fj] = this.layout.far;
    const c = cellCenter(fi, fj);
    const g = new THREE.Group();
    g.position.copy(c);
    const desk = libModel('metal_office_desk');
    desk.position.set(0, 0, -0.55);
    const chair = libModel('plastic_monobloc_chair_01');
    chair.position.set(0, 0, -1.25);
    g.add(desk, chair);
    // an acrylic desk sign: the returns department at the end of the universe
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.2, 0.014, 2, 0.006), new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.25, metalness: 0 }));
    plate.position.set(0, 0.86, -0.2);
    plate.rotation.x = -0.12;
    plate.castShadow = true;
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.012, 0.09, 2, 0.004), plate.material);
    foot.position.set(0, 0.762, -0.2);
    const sign = text3d('แผนกรับคืนสินค้า', { font: 'heavy', size: 0.058, color: 0x1e3c8c, depth: 0.08, align: 'center' });
    sign.position.set(0, 0.012, 0.009);
    const sub = text3d('RETURNS · กรุณารอสักครู่', { font: 'ui', size: 0.024, color: 0x3a3a3a, depth: 0.05, align: 'center' });
    sub.position.set(0, -0.062, 0.009);
    plate.add(sign, sub);
    g.add(plate, foot);
    game.physics?.addBox([c.x, O.y + 0.4, c.z - 0.55], [1.3, 0.8, 0.7]);
    // the man himself: created on your first visit with his shop look (the keeper entity spawns after the world)
    this.root.add(g);
    const head = new THREE.Vector3(c.x, O.y + 1.35, c.z - 1.15);
    this.clark = { root: g, rig: null, head };
    const target: TalkTarget = { kind: 'local', key: 'backrooms_clark', role: 'backrooms_clark', name: tl('บ่าวคลาร์ค', 'Bao Clark'), head: () => head.clone(), act: (anim) => { const r = this.clark?.rig; if (anim && r) r.play(anim, { loop: anim === 'sit' }); } };
    const proxy = proxyBox(new THREE.Vector3(c.x, O.y + 0.8, c.z - 1.2), 0, [0.8, 1.6, 0.8]);
    this.root.add(proxy);
    game.interact.register(proxy, { kind: 'backrooms_clark', data: { name: target.name } });
    this.proxies.push(proxy);
    LocalTalkers.add(target, proxy);
    this.clarkTarget = target;
  }
  clarkTarget: TalkTarget | null = null;

  /** build Clark's rig with the furniture keeper's look (falls back to a tidy office worker) */
  private ensureClark() {
    const cl = this.clark;
    if (!cl || cl.rig) return;
    const game = this.game;
    try {
      const keeper = game.state.all('npc').find((e: Ent) => e.role === 'shopkeeper:furniture_store' || /คลาร์ค|clark/i.test(JSON.stringify(e.name ?? '')));
      const look = keeper?.look ?? game.chars?.randomLook?.('office_worker_m', 2404);
      const rig: any = game.chars?.create(look, { castShadow: true });
      if (!rig) return;
      rig.root.position.set(0, 0.02, -1.22);
      rig.root.rotation.y = Math.PI;          // rigs face −Z: turn him toward the visitor (+Z)
      rig.play('sit', { loop: true });
      cl.root.add(rig.root);
      cl.rig = rig;
    } catch (e) { console.warn('[backrooms] clark rig', e); }
  }

  // ------------------------------------------------------------------ teleports

  enter() {
    const L = this.layout;
    if (!L || !this.game.player) return;
    const c = cellCenter(L.entrance[0], L.entrance[1]);
    this.travel(c.clone().setZ(O.z - HALF + 1.4).setY(O.y + 0.05), this.exitYaw, 'in');
  }
  exit() {
    if (!this.game.player) return;
    if (this.door) {
      const f = new THREE.Vector3(-Math.sin(this.door.yaw), 0, -Math.cos(this.door.yaw));
      this.travel(this.door.p.clone().addScaledVector(f, 1.0).setY(this.door.p.y + 0.05), this.door.yaw, 'out');
    } else {
      const sp = this.game.world?.anchor('player_spawn')?.p ?? [0, 0.2, 0];
      this.travel(new THREE.Vector3(sp[0], sp[1], sp[2]), 0, 'out');
    }
  }
  private travel(p: THREE.Vector3, yaw: number, dir: 'in' | 'out') {
    if (this.fading) return;
    this.fading = true;
    const post = this.game.engine.post;
    playDoor(dir);
    this.game.engine.tween(0.45, (k) => { post.fade = k; }).then(() => {
      this.game.player?.teleport([p.x, p.y, p.z], yaw);
      return this.game.engine.wait(0.25);
    }).then(() => this.game.engine.tween(0.7, (k) => { post.fade = 1 - k; })).then(() => {
      this.fading = false;
      if (dir === 'in' && !this.game.g.backrooms?.seen?.[this.game.localPlayerId]) this.game.intent('backrooms.seen', {});
    });
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    this.t += dt;
    const cam = this.game.engine.camera.position;
    const inside = Math.abs(cam.x - O.x) < HALF + 4 && Math.abs(cam.z - O.z) < HALF + 4 && cam.y > O.y - 6 && cam.y < O.y + 12;
    if (inside !== this.inside) { this.inside = inside; this.onSwitch(inside); if (inside) this.ensureClark(); }
    (this.game as any).backrooms = { inside, enter: () => this.enter(), exit: () => this.exit() };
    if (!inside) return;
    // flicker: faulty tubes stutter; every so often a surge ripples through every panel near you
    const im = this.panelMesh!;
    this.surgeT = Math.max(0, this.surgeT - dt);
    if (this.t > this.nextSurge) { this.nextSurge = this.t + 35 + Math.random() * 55; this.surgeT = 1.4; surgeSound(); }
    for (let k = 0; k < this.panels.length; k++) {
      const P = this.panels[k];
      if (P.base < 0.5) continue;
      let b = 1;
      if (P.faulty) {
        const s = Math.sin(this.t * (17 + P.faulty * 23) + k) * Math.sin(this.t * 3.1 * P.faulty + k * 0.7);
        b = s > 0.35 ? 0.12 : s > 0.25 ? 0.6 : 1;
      }
      if (this.surgeT > 0) {
        const d = P.p.distanceTo(cam);
        if (d < 18) b *= Math.sin(this.surgeT * 40 + d * 0.9) > 0 ? 0.15 : 1;
      }
      im.setColorAt(k, this._c.setScalar(b));
      if (P.lp) P.lp.intensity = 7.5 * b;
    }
    im.instanceColor!.needsUpdate = true;
    if (this.hum) {
      const flick = this.surgeT > 0 ? 0.5 + 0.5 * Math.sin(this.t * 60) : 1;
      this.hum.g.gain.setTargetAtTime(0.055 * flick, Sound.ctx!.currentTime, 0.05);
    }
    // Clark breathes, glances at you
    const cl = this.clark;
    if (cl?.rig) {
      const d = cl.head.distanceTo(cam);
      if (d < 25) { try { cl.rig.lookAt?.(d < 6 ? cam.clone() : null); cl.rig.update(dt); } catch {} }
    }
  }

  /** after the world updated its lights / fog / grade this frame: replace them with the back room's */
  late(dt: number) {
    if (!this.inside) return;
    const sc = this.game.scene;
    if (!sc) return;
    if (!this.sun || !this.hemi) sc.traverse((o: any) => { if (o.isDirectionalLight && !this.sun) this.sun = o; if (o.isHemisphereLight && !this.hemi) this.hemi = o; });
    if (this.sun) this.sun.intensity = 0;
    if (this.hemi) this.hemi.intensity = 0.06;
    sc.environmentIntensity = 0.12;
    const fog = sc.fog as THREE.FogExp2 | null;
    if (fog) { fog.color.setRGB(0.24, 0.215, 0.12); (fog as any).density = 0.05; }
    const post = this.game.engine.post;
    post.setSun(null);
    post.setLook(LOOK, 1 - Math.exp(-dt * 3));
  }

  private onSwitch(inside: boolean) {
    const w: any = this.game.world;
    if (w) w.autoLook = !inside;
    if (inside) startHum(this); else stopHum(this);
  }
  setHum(h: Backrooms['hum']) { this.hum = h; }
  getHum() { return this.hum; }

  dispose() {
    stopHum(this);
    for (const p of this.proxies) { this.game.interact.unregister(p); p.removeFromParent(); }
    LocalTalkers.remove('backrooms_clark');
    this.root.removeFromParent();
    this.root.traverse((o: any) => { if (o.isMesh) o.geometry?.dispose?.(); });
    const w: any = this.game.world;
    if (w && this.inside) w.autoLook = true;
  }
}

// ------------------------------------------------------------------ props

const doorMats = {
  frame: new THREE.MeshStandardMaterial({ color: 0x9b8452, roughness: 0.5, metalness: 0 }),
  slab: new THREE.MeshStandardMaterial({ color: 0xd8cfa8, roughness: 0.62, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc8c4b8, roughness: 0.3, metalness: 0.9 }),
  sign: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.45) }),
};
/** a plain, slightly too normal office door in its frame, with a lever handle, kick plate and a lit EXIT sign */
function buildDoor(p: THREE.Vector3, yaw: number, exitSign: boolean) {
  const g = new THREE.Group();
  g.position.copy(p); g.rotation.y = yaw;
  const parts: [THREE.BufferGeometry, THREE.Material][] = [];
  const rb = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0.008) => parts.push([new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z), m]);
  rb(0.08, 2.18, 0.12, -0.5, 1.09, 0.02, doorMats.frame);
  rb(0.08, 2.18, 0.12, 0.5, 1.09, 0.02, doorMats.frame);
  rb(1.08, 0.08, 0.12, 0, 2.14, 0.02, doorMats.frame);
  rb(0.92, 2.06, 0.045, 0, 1.04, 0.04, doorMats.slab, 0.01);
  rb(0.86, 0.22, 0.004, 0, 0.13, 0.065, doorMats.metal, 0.001);                                    // kick plate
  rb(0.03, 0.16, 0.012, 0.36, 1.02, 0.07, doorMats.metal, 0.004);                                   // rose
  parts.push([new THREE.CylinderGeometry(0.011, 0.011, 0.13, 10).rotateZ(Math.PI / 2).translate(0.31, 1.06, 0.09), doorMats.metal]);  // lever
  for (const [geo, m] of parts) { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); }
  if (exitSign) {
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.16, 0.06, 2, 0.01), doorMats.metal);
    box.position.set(0, 2.42, 0.05);
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.39, 0.13, 0.01, 1, 0.003), doorMats.sign);
    face.position.set(0, 2.42, 0.082);
    const t = text3d('ทางออก EXIT', { font: 'heavy', size: 0.055, color: 0xf4fff4, depth: 0.05, align: 'center' });
    t.position.set(0, 2.395, 0.09);
    g.add(box, face, t);
  }
  return g;
}

const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
function proxyBox(p: THREE.Vector3, yaw: number, size: [number, number, number] = [1.0, 2.1, 0.3]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), proxyMat);
  m.position.copy(p); m.rotation.y = yaw;
  m.name = 'backrooms:proxy';
  return m;
}

// ------------------------------------------------------------------ sound (synthesised: no fitting recordings in the library)

function startHum(b: Backrooms) {
  const ctx = Sound.ctx;
  if (!ctx || b.getHum()) return;
  const g = ctx.createGain(); g.gain.value = 0;
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1400;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 120;
  const o1g = ctx.createGain(); o1g.gain.value = 0.35;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 240;
  const o2g = ctx.createGain(); o2g.gain.value = 0.5;
  // ballast buzz: band-passed noise
  const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 3;
  const ng = ctx.createGain(); ng.gain.value = 0.08;
  o1.connect(o1g).connect(filt); o2.connect(o2g).connect(filt); ns.connect(bp).connect(ng).connect(filt);
  filt.connect(g).connect(Sound.buses.amb ?? Sound.master);
  o1.start(); o2.start(); ns.start();
  g.gain.setTargetAtTime(0.055, ctx.currentTime, 0.6);
  b.setHum({ g, nodes: [o1, o2, ns], filt });
}
function stopHum(b: Backrooms) {
  const h = b.getHum();
  const ctx = Sound.ctx;
  if (!h || !ctx) return;
  h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  const nodes = h.nodes;
  setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch {} } h.g.disconnect(); }, 1200);
  b.setHum(null);
}
function surgeSound() {
  const ctx = Sound.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const g = ctx.createGain(); g.connect(Sound.buses.amb ?? Sound.master);
  for (let k = 0; k < 7; k++) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 60 + Math.random() * 40;
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t0 + k * 0.17); og.gain.linearRampToValueAtTime(0.05, t0 + k * 0.17 + 0.01); og.gain.exponentialRampToValueAtTime(0.0005, t0 + k * 0.17 + 0.12);
    o.connect(og).connect(g); o.start(t0 + k * 0.17); o.stop(t0 + k * 0.17 + 0.15);
  }
  // a distant thud somewhere in the rooms
  const th = ctx.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(70, t0 + 1.1); th.frequency.exponentialRampToValueAtTime(32, t0 + 1.6);
  const tg = ctx.createGain(); tg.gain.setValueAtTime(0, t0 + 1.1); tg.gain.linearRampToValueAtTime(0.25, t0 + 1.12); tg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8);
  th.connect(tg).connect(g); th.start(t0 + 1.1); th.stop(t0 + 1.9);
}
function playDoor(dir: 'in' | 'out') {
  if (Sound.has?.('door_open')) { Sound.play('door_open', { vol: 0.7 }); return; }
  const ctx = Sound.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  // latch click + creak + soft slam
  const g = ctx.createGain(); g.connect(Sound.buses.sfx ?? Sound.master);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(dir === 'in' ? 380 : 300, t0 + 0.05); o.frequency.linearRampToValueAtTime(dir === 'in' ? 520 : 240, t0 + 0.55);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
  const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(0.06, t0 + 0.1); og.gain.linearRampToValueAtTime(0, t0 + 0.6);
  o.connect(f).connect(og).connect(g); o.start(t0); o.stop(t0 + 0.65);
  const th = ctx.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(110, t0 + 0.7); th.frequency.exponentialRampToValueAtTime(45, t0 + 0.9);
  const tg = ctx.createGain(); tg.gain.setValueAtTime(0, t0 + 0.7); tg.gain.linearRampToValueAtTime(0.3, t0 + 0.71); tg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
  th.connect(tg).connect(g); th.start(t0 + 0.7); th.stop(t0 + 1.05);
}

// ------------------------------------------------------------------ dialogue: บ่าวคลาร์ค at the returns desk

function registerClarkDialogue() {
  const rewarded = (c: any) => !!c.game.g.backrooms?.found?.[c.me?.id];
  Dialogues.register({
    id: 'backrooms_clark',
    priority: 30,
    match: (t) => t.role === 'backrooms_clark',
    start: (c) => (rewarded(c) ? 'again' : 'hello'),
    nodes: [
      { id: 'hello', say: tl('อ้าว… มาถึงนี่ได้ยังไงครับ', 'Oh. How did you get all the way out here?'), anim: 'idle', options: [
        { text: tl('ผมหลงทางครับ', "I'm lost."), next: 'lost' },
        { text: tl('เดี๋ยว! คุณมาถึงก่อนผมได้ยังไง!?', 'Wait! How did you get here before me?!'), next: 'before' },
        { text: tl('เก้าอี้ตัวนั้นขายไหม', 'Is that chair for sale?'), next: 'chair' },
      ] },
      { id: 'lost', say: tl('ทุกคนหลงครับ ผมก็หลงมาตั้งแต่ปี 47', 'Everyone gets lost. I have been lost since 2004.'), next: 'reward' },
      { id: 'before', say: tl('ผมอยู่ทั้งสองที่แหละครับ ร้านมันกว้าง', "I'm in both places. It's a big shop."), options: [{ text: tl('…โอเค', '…okay.'), next: 'reward' }] },
      { id: 'chair', say: tl('ตัวนี้ไม่ขายครับ ตัวนี้นั่งรอลูกค้ามาสิบเก้าปีแล้ว', "Not for sale. This one has been waiting for customers for nineteen years."), next: 'reward' },
      { id: 'reward', say: tl('เอานี่ไปครับ ค่าเดินทาง… แล้วเดินตามไฟดวงที่ไม่กะพริบนะครับ', 'Here, travel money. And follow the lights that do not flicker.'), do: (c) => c.game.intent('backrooms.found', {}), options: [
        { text: tl('พาผมออกไปหน่อยครับ', 'Walk me out, please.'), do: (c) => (c.game as any).backrooms?.exit?.() },
        { text: tl('ขอเดินเล่นต่ออีกนิด', "I'll look around a bit more."), end: true },
      ] },
      { id: 'again', say: tl('ยังไม่ออกไปอีกเหรอครับ… ประตูอยู่ทางที่คุณเดินมานั่นแหละ ถ้ามันยังอยู่', 'Still here? The door is back the way you came. If it is still there.'), options: [
        { text: tl('พาผมออกไปที', 'Walk me out.'), do: (c) => (c.game as any).backrooms?.exit?.() },
        { text: tl('ไว้เจอกันครับ', 'See you around.'), end: true },
      ] },
    ],
  });
}

// ------------------------------------------------------------------ module

let BR: Backrooms | null = null;

export default defineModule({
  id: 'backrooms',
  // 'build' publishes the furniture_backdoor anchor in its buildWorld (when it is loaded)
  deps: ['world', 'characters', 'build'],
  init(game) {
    registerClarkDialogue();
    // HOST: first visit + Clark's travel money (once per player)
    game.onIntent('backrooms.seen', (pl: Ent) => {
      const b = (game.g.backrooms ??= { seen: {}, found: {} });
      b.seen = { ...(b.seen ?? {}), [pl.id]: true };
    });
    game.onIntent('backrooms.found', (pl: Ent) => {
      const b = (game.g.backrooms ??= { seen: {}, found: {} });
      if (b.found?.[pl.id]) return;
      b.found = { ...(b.found ?? {}), [pl.id]: true };
      game.money(pl.id, 250, 'backrooms');
    });
    // E on the doors / Clark
    game.interact.provide((ctx: any) => {
      const meta = ctx.hit ? { kind: ctx.hit.kind, data: ctx.hit.data } : null;
      if (!meta || !BR) return null;
      if (meta.kind === 'backrooms_door') {
        return meta.data?.dir === 'out'
          ? { key: 'E', label: tl('ออกไปหน้าร้าน', 'back to the shop'), priority: 20, run: () => BR?.exit() }
          : { key: 'E', label: tl('เข้าไปหลังร้าน', 'go into the back room'), priority: 20, run: () => BR?.enter() };
      }
      if (meta.kind === 'backrooms_clark') {
        return { key: 'E', label: tl('คุยกับบ่าวคลาร์ค', 'talk to Bao Clark'), priority: 15, run: () => {
          const rt = questApi(game);
          if (rt && BR?.clarkTarget) { rt.talk(BR.clarkTarget); return; }
          // no dialogue runtime: a short exchange through the 3D choice prompt
          const head = BR?.clarkTarget?.head() ?? null;
          if (head) game.ui.say(head, tl('อ้าว… มาถึงนี่ได้ยังไงครับ ร้านมันกว้างครับ', 'Oh. How did you get here? It is a big shop.'), { duration: 4 });
          game.intent('backrooms.found', {});
          game.ui.choose({ prompt: tl('บ่าวคลาร์ค', 'Bao Clark'), options: [tl('พาผมออกไปที', 'Walk me out'), tl('เดินเล่นต่อ', 'Stay a bit')], seconds: 12, onPick: (i: number) => { if (i === 0) BR?.exit(); } });
        } };
      }
      return null;
    }, 5);
    game.engine.onLate((f) => { if (BR) BR.late(f.rawDt); });
    game.events.on('world:exit', () => { BR?.dispose(); BR = null; });
    (window as any).__backrooms = () => BR;
  },
  async buildWorld(game) {
    BR?.dispose();
    BR = new Backrooms(game);
    try { BR.build(); } catch (e) { console.error('[backrooms] build failed', e); }
    if (params.has('backrooms')) setTimeout(() => BR?.enter(), 1500);
  },
  frame(game, dt) {
    if (!BR || !game.scene) return;
    BR.frame(dt);
  },
});

