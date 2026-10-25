import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Assets } from '../../core/assets';
import { tl, round } from '../../core/util';
import { makeSurfaceMat, surfaceDisc } from './surface';
import type { Volumes } from './volumes';

/**
 * WASH CORNER + TAPS + HOSE
 * Static props (every peer): a brass wall tap over an aluminium basin, a blue 200 L water drum,
 * a glazed water jar (โอ่ง), a floor drain, and a galvanised standpipe with a green garden hose.
 * Each container has hollow colliders + a water volume, so thrown items really go in and float.
 * Tap state is replicated as g.wtaps (0/1 per tap). The hose nozzle is an item (water_hose);
 * the hose itself is a local verlet rope from the standpipe to wherever the nozzle is.
 */

export interface TapDef { i: number; spout: [number, number, number]; yaw: number; kind: 'wall' | 'stand'; hose?: boolean; name: string }

export const WASH = { x: 13.4, z: -16.3, floor: 0.15 };

export const TAPS: TapDef[] = [
  { i: 0, spout: [13.25, 0.79, -16.3], yaw: Math.PI / 2, kind: 'wall', name: 'ก๊อกน้ำ' },
  { i: 1, spout: [8.32, 0.98, -15.9], yaw: Math.PI / 2, kind: 'stand', hose: true, name: 'ก๊อกสายยาง' },
];

export const HOSE_LEN = 9;

export interface WashProps {
  root: THREE.Group;
  surfaces: THREE.Mesh[];
  drains: { x: number; z: number; y: number }[];
  tapObjs: THREE.Object3D[];
  hoseAnchor: THREE.Vector3;
}

function lathe(pts: [number, number][], seg: number, mat: THREE.Material) {
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** brass bib tap: wall plate, body, lever, spout (origin = spout outlet, spout faces -X after yaw) */
function tapModel(kind: 'wall' | 'stand'): THREE.Group {
  const g = new THREE.Group();
  const brass = Assets.pbr('brass_gold', { repeat: 0.25 });
  const galv = Assets.pbr('galvanized_steel', { repeat: 0.3 });
  // body sits 0.11 m behind the outlet (toward +X = the wall), 0.07 m above it
  const body = lathe([[0.0001, -0.02], [0.016, -0.02], [0.02, -0.005], [0.021, 0.02], [0.012, 0.032], [0.0001, 0.034]], 12, brass);
  body.position.set(0.1, 0.07, 0); g.add(body);
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.08, 10), brass);
  inlet.rotation.z = Math.PI / 2; inlet.position.set(0.15, 0.07, 0); g.add(inlet);
  // spout: horizontal arm + bend down
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.09, 10), brass);
  arm.rotation.z = Math.PI / 2; arm.position.set(0.05, 0.07, 0); g.add(arm);
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 10, Math.PI / 2), brass);
  bend.position.set(0.005, 0.035, 0); bend.rotation.set(0, 0, Math.PI / 2); g.add(bend);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.008, 0.03, 10), brass);
  nose.position.set(-0.03, 0.017, 0); g.add(nose);
  const lever = new THREE.Group(); lever.name = 'lever';
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6), brass); stem.position.y = 0.015; lever.add(stem);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.009, 0.012), Assets.pbr('plastic_glossy', { color: 0xc82020, repeat: 0.2 }));
  bar.position.y = 0.032; lever.add(bar);
  lever.position.set(0.1, 0.1, 0); g.add(lever);
  if (kind === 'wall') {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 14), brass);
    plate.rotation.z = Math.PI / 2; plate.position.set(0.19, 0.07, 0); g.add(plate);
    // galvanised supply pipe down the wall to the floor
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.8, 8), galv);
    pipe.position.set(0.205, -0.33, 0); g.add(pipe);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), galv);
    elbow.position.set(0.205, 0.07, 0); g.add(elbow);
  } else {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.98, 8), galv);
    pipe.position.set(0.15, -0.42, 0); g.add(pipe);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), Assets.pbr('concrete_old_cracked', { repeat: 0.3 }));
    base.position.set(0.15, -0.92, 0); g.add(base);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), galv);
    top.position.set(0.15, 0.07, 0); g.add(top);
    // hose coupling on the spout
    const coup = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 10), Assets.pbr('plastic_glossy', { color: 0xe0b020, repeat: 0.2 }));
    coup.position.set(-0.03, 0.005, 0); g.add(coup);
  }
  g.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function ringColliders(game: Game, x: number, y: number, z: number, r: number, h: number, t = 0.03, n = 10) {
  const ph = game.physics;
  if (!ph) return;
  const chord = 2 * (r + t) * Math.tan(Math.PI / n) + 0.01;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ph.addBox([x + Math.cos(a) * (r + t / 2), y + h / 2, z + Math.sin(a) * (r + t / 2)], [t, h, chord], -a, { friction: 0.6 });
  }
  ph.addBox([x, y + 0.01, z], [r * 1.9, 0.02, r * 1.9], 0, { friction: 0.7 });
}

/** build the wash corner (every peer) */
export function buildWashCorner(game: Game, vols: Volumes, parent: THREE.Object3D): WashProps {
  const root = new THREE.Group();
  root.name = 'water-washcorner';
  parent.add(root);
  const F = WASH.floor;
  const surfaces: THREE.Mesh[] = [];
  const tapObjs: THREE.Object3D[] = [];
  const surf = (x: number, y: number, z: number, r: number, color: number, opacity: number, murk = 0.2) => {
    const m = new THREE.Mesh(surfaceDisc(), makeSurfaceMat({ color, opacity, tile: 0.45, nmK: 0.1, ripK: 1.2 }));
    m.position.set(x, y, z); m.scale.set(r, 1, r); m.renderOrder = 3; m.receiveShadow = true; m.raycast = () => {};
    m.name = 'water-static'; m.userData.r = r; m.userData.murk = murk;
    root.add(m); surfaces.push(m);
    return m;
  };
  // ---- wall tap + basin
  const t0 = TAPS[0];
  const tap0 = tapModel('wall');
  tap0.position.set(t0.spout[0], t0.spout[1], t0.spout[2]);
  tap0.rotation.y = t0.yaw - Math.PI / 2;
  root.add(tap0); tapObjs.push(tap0);
  const bx = 13.06, bz = -16.3;
  const alu = Assets.pbr('aluminium_scratched', { repeat: [4, 1], side: THREE.DoubleSide, roughness: 0.75 });
  const basin = lathe([[0.0001, 0], [0.2, 0], [0.22, 0.012], [0.3, 0.125], [0.314, 0.131], [0.31, 0.137], [0.296, 0.128], [0.215, 0.014], [0.0001, 0.012]], 34, alu);
  basin.position.set(bx, F, bz); root.add(basin);
  surf(bx, F + 0.105, bz, 0.285, 0x7d9294, 0.55);
  ringColliders(game, bx, F, bz, 0.29, 0.13, 0.02, 10);
  vols.add({ kind: 'basin', x: bx, z: bz, r: 0.28, y0: F + 0.012, level: F + 0.105, local: true, murk: 0.15 });
  // ---- blue 200 L drum (open top)
  const dx = 12.98, dz = -15.52, dr = 0.29, dh = 0.88;
  const blue = Assets.pbr('plastic_glossy', { color: 0x1d58b0, repeat: [3, 2], side: THREE.DoubleSide });
  const prof: [number, number][] = [[0.0001, 0], [dr - 0.02, 0], [dr, 0.02]];
  for (const ry of [0.22, 0.44, 0.66]) prof.push([dr, ry - 0.03], [dr + 0.012, ry - 0.012], [dr + 0.012, ry + 0.012], [dr, ry + 0.03]);
  prof.push([dr, dh - 0.02], [dr + 0.01, dh], [dr - 0.012, dh + 0.004], [dr - 0.018, dh - 0.03], [dr - 0.018, 0.03], [0.0001, 0.03]);
  const drum = lathe(prof, 32, blue);
  drum.position.set(dx, F, dz); root.add(drum);
  surf(dx, F + 0.78, dz, dr - 0.02, 0x4a6a70, 0.72);
  ringColliders(game, dx, F, dz, dr - 0.01, dh, 0.03, 12);
  vols.add({ kind: 'drum', x: dx, z: dz, r: dr - 0.03, y0: F + 0.03, level: F + 0.78, local: true, murk: 0.25 });
  // ---- glazed water jar (โอ่ง) with a plastic dipper bowl floating
  const jx = 12.92, jz = -17.3;
  const glaze = Assets.pbr('plastic_glossy', { color: 0x5a2c16, repeat: [4, 2], side: THREE.DoubleSide, roughness: 0.6 });
  const jar = lathe([[0.0001, 0], [0.22, 0], [0.3, 0.06], [0.4, 0.26], [0.42, 0.4], [0.38, 0.58], [0.3, 0.7], [0.26, 0.75], [0.275, 0.78], [0.265, 0.8], [0.245, 0.78], [0.24, 0.72], [0.3, 0.6], [0.38, 0.4], [0.28, 0.08], [0.0001, 0.06]], 32, glaze);
  jar.position.set(jx, F, jz); root.add(jar);
  surf(jx, F + 0.68, jz, 0.27, 0x3a4c4c, 0.78);
  ringColliders(game, jx, F, jz, 0.25, 0.8, 0.05, 12);
  ringColliders(game, jx, F, jz, 0.41, 0.6, 0.04, 12);
  vols.add({ kind: 'jar', x: jx, z: jz, r: 0.23, y0: F + 0.06, level: F + 0.68, local: true, murk: 0.3 });
  const dip = lathe([[0.0001, 0], [0.05, 0], [0.075, 0.04], [0.078, 0.045], [0.072, 0.044], [0.048, 0.006], [0.0001, 0.006]], 16, Assets.pbr('plastic_glossy', { color: 0xe8c020, repeat: 0.3, side: THREE.DoubleSide }));
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.022), dip.material as THREE.Material);
  handle.position.set(0.13, 0.04, 0); dip.add(handle);
  dip.position.set(jx - 0.05, F + 0.665, jz + 0.04); dip.name = 'float-dipper'; dip.userData.baseY = dip.position.y; root.add(dip);
  // ---- floor drain (real cast concrete drain cover photo)
  const drx = 12.5, drz = -16.8;
  const dcov = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshStandardMaterial({
    map: Assets.texture('textures/world/drain_cover_concrete_holes_albedo.jpg', { srgb: true }),
    normalMap: Assets.texture('textures/world/drain_cover_concrete_holes_normal.jpg', { srgb: false }), roughness: 0.8,
  }));
  dcov.rotation.x = -Math.PI / 2; dcov.position.set(drx, F + 0.006, drz); dcov.receiveShadow = true; root.add(dcov);
  // ---- standpipe + hose
  const t1 = TAPS[1];
  const tap1 = tapModel('stand');
  tap1.position.set(t1.spout[0], t1.spout[1], t1.spout[2]);
  tap1.rotation.y = t1.yaw - Math.PI / 2;
  root.add(tap1); tapObjs.push(tap1);
  game.physics?.addBox([t1.spout[0] + 0.15, F + 0.4, t1.spout[2]], [0.06, 0.8, 0.06]);
  for (const [i, o] of tapObjs.entries()) game.interact?.register(o, { kind: 'water_tap', data: { i, name: tl(TAPS[i].name, 'tap') }, reach: 2.6 });
  return { root, surfaces, drains: [{ x: drx, z: drz, y: F }], tapObjs, hoseAnchor: new THREE.Vector3(t1.spout[0] - 0.045, t1.spout[1] + 0.002, t1.spout[2]) };
}

// ------------------------------------------------------------------ hose rope (local verlet)

const RN = 30;
export class HoseRope {
  readonly mesh: THREE.InstancedMesh;
  private P = new Float32Array(RN * 3);
  private O = new Float32Array(RN * 3);
  private init = false;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private v = new THREE.Vector3(); private d = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  constructor(private ground: (x: number, z: number) => number) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
    const mat = Assets.pbr('rubber_black', { color: 0x58b060, repeat: 0.2, roughness: 0.45 });
    this.mesh = new THREE.InstancedMesh(g, mat, RN - 1);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'water-hose';
  }
  update(dt: number, a: THREE.Vector3, b: THREE.Vector3) {
    const P = this.P, O = this.O, seg = HOSE_LEN / (RN - 1);
    if (!this.init) {
      for (let i = 0; i < RN; i++) {
        const t = i / (RN - 1);
        // coil-ish initial layout on the ground between the ends
        const x = a.x + (b.x - a.x) * t + Math.sin(t * 9) * 0.5, z = a.z + (b.z - a.z) * t + Math.cos(t * 9) * 0.5;
        P[i * 3] = O[i * 3] = x; P[i * 3 + 2] = O[i * 3 + 2] = z; P[i * 3 + 1] = O[i * 3 + 1] = this.ground(x, z) + 0.02;
      }
      this.init = true;
    }
    const h = Math.min(dt, 1 / 30);
    for (let i = 1; i < RN - 1; i++) {
      const o = i * 3;
      const vx = (P[o] - O[o]) * 0.96, vy = (P[o + 1] - O[o + 1]) * 0.96, vz = (P[o + 2] - O[o + 2]) * 0.96;
      O[o] = P[o]; O[o + 1] = P[o + 1]; O[o + 2] = P[o + 2];
      P[o] += vx; P[o + 1] += vy - 9.81 * h * h; P[o + 2] += vz;
    }
    P[0] = a.x; P[1] = a.y; P[2] = a.z;
    const e = (RN - 1) * 3; P[e] = b.x; P[e + 1] = b.y; P[e + 2] = b.z;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < RN - 1; i++) {
        const o = i * 3, o2 = o + 3;
        const dx = P[o2] - P[o], dy = P[o2 + 1] - P[o + 1], dz = P[o2 + 2] - P[o + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d <= seg) continue;                   // a hose bends freely, only resists stretching
        const k = (d - seg) / d * 0.5;
        const w0 = i === 0 ? 0 : 1, w1 = i + 1 === RN - 1 ? 0 : 1;
        const sw = w0 + w1 || 1;
        P[o] += dx * k * 2 * w0 / sw; P[o + 1] += dy * k * 2 * w0 / sw; P[o + 2] += dz * k * 2 * w0 / sw;
        P[o2] -= dx * k * 2 * w1 / sw; P[o2 + 1] -= dy * k * 2 * w1 / sw; P[o2 + 2] -= dz * k * 2 * w1 / sw;
      }
      for (let i = 1; i < RN - 1; i++) {
        const o = i * 3;
        const gy = this.ground(P[o], P[o + 2]) + 0.013;
        if (P[o + 1] < gy) { P[o + 1] = gy; O[o] += (P[o] - O[o]) * 0.3; O[o + 2] += (P[o + 2] - O[o + 2]) * 0.3; }
      }
    }
    for (let i = 0; i < RN - 1; i++) {
      const o = i * 3;
      this.v.set((P[o] + P[o + 3]) / 2, (P[o + 1] + P[o + 4]) / 2, (P[o + 2] + P[o + 5]) / 2);
      this.d.set(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]);
      const len = this.d.length() || 1e-4;
      this.q.setFromUnitVectors(this.up, this.d.divideScalar(len));
      this.s.set(0.0115, len + 0.01, 0.0115);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function defineHose(game: Game, build: () => THREE.Object3D) {
  game.items.define({
    kind: 'water_hose', name: tl('สายยางฉีดน้ำ', 'garden hose'), weight: 0.6, carry: 'hand', price: 0, tags: ['tool', 'water', 'hose'],
    shape: { type: 'box', size: [0.04, 0.04, 0.22] }, mass: 0.6, density: 1100,
    build: () => build(),
    label: () => tl('สายยางฉีดน้ำ', 'garden hose'),
    hold: { pos: [0.04, -0.06, 0.02], rot: [0.05, 0.0, 0], scale: 1.6 },
  });
}

/** helpers shared by host + client */
export function tapOn(game: Game, i: number) { return !!(game.g.wtaps?.[i]); }
export function hoseEnt(game: Game): Ent | null { return game.state.find('item', (e) => e.k === 'water_hose') ?? null; }
export const r2 = (v: number) => round(v, 2);
