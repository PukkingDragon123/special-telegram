import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { Spots, Spot } from './spots';
import { night, qmul, tex } from './util';

/* ============================================================================================
 * แมลงสาบ — cockroaches. One InstancedMesh (single draw call): a glossy low-poly body textured with a
 * real top-down photo of an American cockroach (Alex Wild, public domain) + 6 two-segment spiny legs +
 * 2 long antennae, animated in the vertex shader (tripod gait driven per instance by speed; antennae
 * twitch). Client-local, simulated only near the camera, no per-frame allocation.
 * Behaviour: they come out of drains / cracks along kerbs, wall bases, trash and the butcher (many more
 * at night), dash-and-freeze along the kerb, scatter from feet and from being looked at in the dark,
 * avoid lamp pools, vanish back into cracks. Walking over one = crunch + splat decal + 3D text.
 * Rarely (night) one takes off and flies straight at your face.
 * ========================================================================================== */

const MAX = 72;
const BL = 0.021, BW = 0.0095, BH = 0.0052;       // half extents (≈ 4.2 cm long)
const U0 = 0.273, U1 = 0.781, VH = 0.879, VT = 0.137;   // body region in roach.png

const ST_OFF = 0, ST_WANDER = 1, ST_FLEE = 2, ST_HIDE = 3, ST_EMERGE = 4;

export class Roaches {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.MeshStandardMaterial;
  private uTime = { value: 0 };
  private anim: THREE.InstancedBufferAttribute;
  // sim state (struct of arrays)
  private st = new Uint8Array(MAX);
  private x = new Float32Array(MAX); private y = new Float32Array(MAX); private z = new Float32Array(MAX);
  private h = new Float32Array(MAX); private v = new Float32Array(MAX); private vt = new Float32Array(MAX);
  private tmr = new Float32Array(MAX); private life = new Float32Array(MAX); private sc = new Float32Array(MAX);
  private size = new Float32Array(MAX); private ph = new Float32Array(MAX);
  private hx = new Float32Array(MAX); private hz = new Float32Array(MAX);   // home
  private ldx = new Float32Array(MAX); private ldz = new Float32Array(MAX); // line dir (0 = point spot)
  private cx = new Float32Array(MAX); private cz = new Float32Array(MAX);   // crack dir
  private spawnT = 0;
  private skitterT = 0;
  private flyT = 120 + Math.random() * 120;
  private rnd = Math.random;
  // scratch
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private pv = new THREE.Vector3(); private sv = new THREE.Vector3();
  private e = new THREE.Euler();
  private fwd = new THREE.Vector3();
  /** called when the local player squashes one */
  onSquash: ((x: number, y: number, z: number, local: boolean) => void) | null = null;
  /** called to launch a flying roach from (x,y,z) */
  onFly: ((x: number, y: number, z: number) => void) | null = null;
  kills = 0;

  constructor(private game: Game, private spots: Spots) {
    const geo = buildRoachGeometry();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', this.anim);
    const map = tex('roach.png');
    this.mat = new THREE.MeshStandardMaterial({ map, roughness: 0.32, metalness: 0.05, envMapIntensity: 1.5 });
    const uTime = this.uTime;
    this.mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = uTime;
      s.uniforms.uLeg = { value: new THREE.Color(0x6a3a1c) };
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
attribute float aPart; attribute vec3 aRoot; attribute vec2 aAnim; uniform float uTime; varying float vPart;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vPart = aPart;
float gait = aAnim.y;
if (aPart > 0.5 && aPart < 6.5) {
  float side = aRoot.x > 0.0 ? 1.0 : -1.0;
  float tri = mod(aPart + (side > 0.0 ? 1.0 : 0.0), 2.0) * 3.14159;
  float ph = uTime * (9.0 + 38.0 * gait) + aAnim.x + tri;
  float sw = sin(ph) * (0.08 + 0.5 * gait);
  vec3 p = transformed - aRoot;
  float c = cos(sw), s = sin(sw);
  p.xz = mat2(c, -s, s, c) * p.xz;
  p.y += max(0.0, cos(ph)) * 0.0035 * gait * clamp(length(p.xz) * 60.0, 0.0, 1.0);
  transformed = aRoot + p;
} else if (aPart > 6.5) {
  float side = aPart > 7.5 ? 1.0 : -1.0;
  float tw = sin(uTime * (2.3 + gait * 6.0) + aAnim.x * 1.7 + side * 1.3) * 0.32 + sin(uTime * 13.0 + aAnim.x + side) * 0.06;
  vec3 p = transformed - aRoot;
  float c = cos(tw), s = sin(tw);
  p.xz = mat2(c, -s, s, c) * p.xz;
  p.y += sin(uTime * 3.7 + aAnim.x + side * 2.0) * 0.25 * length(p.xz);
  transformed = aRoot + p;
} else {
  transformed.y += sin(uTime * 55.0 + aAnim.x) * 0.0005 * gait;
}`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uLeg; varying float vPart;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
if (vPart > 0.5) diffuseColor.rgb = uLeg;`);
    };
    this.mat.customProgramCacheKey = () => 'critters-roach-v1';
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'critters-roaches';
  }

  private spawn(i: number, s: Spot) {
    const r = this.rnd;
    this.st[i] = ST_EMERGE;
    const along = s.dx || s.dz ? (r() - 0.5) * 3 : 0;
    this.x[i] = s.x + s.dx * along + (s.dx || s.dz ? 0 : (r() - 0.5) * 0.6);
    this.z[i] = s.z + s.dz * along + (s.dx || s.dz ? 0 : (r() - 0.5) * 0.6);
    this.y[i] = s.y + 0.001;
    this.hx[i] = this.x[i]; this.hz[i] = this.z[i];
    this.ldx[i] = s.dx; this.ldz[i] = s.dz;
    this.cx[i] = s.cx; this.cz[i] = s.cz;
    this.h[i] = s.dx || s.dz ? Math.atan2(-s.dx, -s.dz) + (r() < 0.5 ? Math.PI : 0) : r() * Math.PI * 2;
    this.v[i] = 0; this.vt[i] = 0;
    this.tmr[i] = 0.3 + r() * 0.5;
    this.life[i] = 9 + r() * 26;
    this.sc[i] = 0;
    this.size[i] = 0.75 + r() * 0.45;
    this.ph[i] = r() * 100;
  }

  update(dt: number, cam: THREE.Vector3) {
    const game = this.game, r = this.rnd;
    this.uTime.value += dt;
    const nt = night(game);
    const pl = game.player;
    const px = pl?.pos.x ?? cam.x, pz = pl?.pos.z ?? cam.z;
    const pSpeed = pl?.speedNow ?? 0;
    const playing = pl?.mode === 'play';
    game.camera.getWorldDirection(this.fwd);
    // ---- spawn near the camera
    const target = Math.round(MAX * 0.5 * qmul(game) * (0.12 + 0.88 * nt));
    let active = 0;
    for (let i = 0; i < MAX; i++) if (this.st[i] !== ST_OFF) active++;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && active < target) {
      this.spawnT = 0.12 + r() * 0.25;
      const s = this.spots.sample(cam.x, cam.z, 2.2, 18, r, (sp) => nt < 0.35 || !this.spots.lit(sp.x, sp.z));
      if (s) for (let i = 0; i < MAX; i++) if (this.st[i] === ST_OFF) { this.spawn(i, s); break; }
    }
    // ---- simulate
    this.skitterT -= dt;
    let n = 0;
    const others = game.players();
    for (let i = 0; i < MAX; i++) {
      const st = this.st[i];
      if (st === ST_OFF) continue;
      let x = this.x[i], z = this.z[i];
      const dcx = x - cam.x, dcz = z - cam.z, dc2 = dcx * dcx + dcz * dcz;
      if (dc2 > 30 * 30) { this.st[i] = ST_OFF; continue; }
      this.life[i] -= dt;
      this.tmr[i] -= dt;
      const dpx = x - px, dpz = z - pz, dp2 = dpx * dpx + dpz * dpz;
      // ---- squash: feet
      if (st !== ST_HIDE && dp2 < 0.15 * 0.15 && pSpeed > 0.35 && playing) { this.squash(i, true); continue; }
      let squashed = false;
      for (const o of others) {
        if (o.id === game.localPlayerId || !o.p) continue;
        const ox = x - o.p[0], oz = z - o.p[2];
        if (ox * ox + oz * oz < 0.13 * 0.13) { this.squash(i, false); squashed = true; break; }
      }
      if (squashed) continue;
      if (st === ST_EMERGE) {
        this.sc[i] = Math.min(1, this.sc[i] + dt * 3.5);
        if (this.sc[i] >= 1) this.st[i] = ST_WANDER;
      }
      if (st === ST_WANDER || st === ST_EMERGE) {
        // threats: moving feet, being stared at in the dark, light pools
        const stare = nt > 0.45 && dc2 < 2.6 * 2.6 && this.lookedAt(x, this.y[i], z, cam) && r() < dt * 2.5;
        if ((dp2 < 1.7 * 1.7 && (pSpeed > 0.25 || dp2 < 0.5 * 0.5)) || stare) {
          this.st[i] = ST_FLEE;
          this.tmr[i] = 0.9 + r() * 0.8;
          const away = Math.atan2(-(x - px), -(z - pz));
          this.h[i] = away + Math.PI + (r() - 0.5) * 0.9;
          this.vt[i] = 1.7 + r() * 0.8;
          if (dc2 < 3 * 3) this.skitter(x, this.y[i], z);
        } else if (this.tmr[i] <= 0) {
          if (this.vt[i] > 0.01) { this.vt[i] = 0; this.tmr[i] = 0.2 + r() * 1.4; }
          else {
            this.vt[i] = 0.4 + r() * 0.95;
            this.tmr[i] = 0.25 + r() * 1.1;
            if (this.ldx[i] || this.ldz[i]) { if (r() < 0.3) this.h[i] += Math.PI; }
            else {
              const hx = this.hx[i] - x, hz = this.hz[i] - z;
              this.h[i] = hx * hx + hz * hz > 1.4 * 1.4 ? Math.atan2(-hx, -hz) + (r() - 0.5) * 0.6 : this.h[i] + (r() - 0.5) * 2.4;
            }
            if (dc2 < 2.5 * 2.5) this.skitter(x, this.y[i], z);
          }
        }
        // stay on the kerb / wall line
        if (this.ldx[i] || this.ldz[i]) {
          const lx = this.ldx[i], lz = this.ldz[i];
          const ox = x - this.hx[i], oz = z - this.hz[i];
          const perp = ox * -lz + oz * lx;             // signed offset from the line
          const dirSign = Math.sign((-Math.sin(this.h[i])) * lx + (-Math.cos(this.h[i])) * lz) || 1;
          const base = Math.atan2(-lx * dirSign, -lz * dirSign);
          this.h[i] = base - THREE.MathUtils.clamp(perp * 6, -0.6, 0.6) * dirSign + Math.sin(this.uTime.value * 3 + this.ph[i]) * 0.15;
        }
        if (nt > 0.35 && this.vt[i] > 0 && this.spots.lit(x, z, 2.2)) this.h[i] += Math.PI * dt * 3;
        if (this.life[i] <= 0) { this.st[i] = ST_HIDE; this.tmr[i] = 0.4; }
      } else if (st === ST_FLEE) {
        this.h[i] += (r() - 0.5) * dt * 6;
        if (this.tmr[i] <= 0) { this.st[i] = ST_HIDE; this.tmr[i] = 0.35; if (this.cx[i] || this.cz[i]) this.h[i] = Math.atan2(-this.cx[i], -this.cz[i]); }
      } else if (st === ST_HIDE) {
        this.vt[i] = 1.2;
        this.sc[i] = Math.max(0, this.tmr[i] / 0.4);
        if (this.tmr[i] <= 0) { this.st[i] = ST_OFF; continue; }
      }
      // ---- integrate (roaches accelerate almost instantly)
      this.v[i] += (this.vt[i] - this.v[i]) * Math.min(1, dt * 18);
      const v = this.v[i], hh = this.h[i];
      x += -Math.sin(hh) * v * dt; z += -Math.cos(hh) * v * dt;
      this.x[i] = x; this.z[i] = z;
      // ---- write instance
      const s = this.size[i] * Math.max(0.001, this.sc[i]);
      this.q.setFromEuler(this.e.set(0, hh, 0));
      this.m4.compose(this.pv.set(x, this.y[i], z), this.q, this.sv.set(s, s, s));
      this.mesh.setMatrixAt(n, this.m4);
      this.anim.setXY(n, this.ph[i], Math.min(1, v / 1.4));
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.anim.needsUpdate = true; }
    // ---- rare: one flies at your face (night, playing)
    this.flyT -= dt * (nt > 0.5 ? 1 : 0);
    if (this.flyT <= 0 && playing && this.onFly) {
      this.flyT = 160 + r() * 200;
      for (let i = 0; i < MAX; i++) {
        if (this.st[i] !== ST_WANDER) continue;
        const dx = this.x[i] - cam.x, dz = this.z[i] - cam.z, d = Math.hypot(dx, dz);
        if (d < 2 || d > 6.5) continue;
        if ((dx * this.fwd.x + dz * this.fwd.z) / d < 0.6) continue;
        this.st[i] = ST_OFF;
        this.onFly(this.x[i], this.y[i], this.z[i]);
        break;
      }
    }
  }

  /** dev: force a flying roach soon */
  forceFly() { this.flyT = 0; }

  private lookedAt(x: number, y: number, z: number, cam: THREE.Vector3) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return (dx * this.fwd.x + dy * this.fwd.y + dz * this.fwd.z) / d > 0.97;
  }

  private skitter(x: number, y: number, z: number) {
    if (this.skitterT > 0) return;
    this.skitterT = 0.3;
    Sound.play('crit_skitter', { pos: this.pv.set(x, y, z), vol: 0.5, pitch: 0.9 + this.rnd() * 0.5, ref: 0.8, max: 6 });
  }

  private squash(i: number, local: boolean) {
    this.st[i] = ST_OFF;
    this.kills++;
    this.onSquash?.(this.x[i], this.y[i], this.z[i], local);
  }

  /** active count (debug) */
  get active() { let n = 0; for (let i = 0; i < MAX; i++) if (this.st[i] !== ST_OFF) n++; return n; }

  /** dev: spawn n roaches right in front of the camera */
  spawnNear(cam: THREE.Vector3, n = 8) {
    this.game.camera.getWorldDirection(this.fwd);
    for (let k = 0; k < n; k++) {
      const i = this.st.findIndex((s) => s === ST_OFF);
      if (i < 0) return;
      const d = 1.6 + this.rnd() * 1.8;
      const x = cam.x + this.fwd.x * d + (this.rnd() - 0.5) * 1.6, z = cam.z + this.fwd.z * d + (this.rnd() - 0.5) * 1.6;
      const y = this.game.world?.groundY(x, z) ?? 0;
      this.spawn(i, { x, y, z, dx: 0, dz: 0, cx: 0, cz: 0, kind: 'market', w: 1 });
      this.life[i] = 25;
    }
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

// ------------------------------------------------------------------ geometry

/** body ellipsoid + legs + antennae, attributes: position normal uv aPart aRoot */
export function buildRoachGeometry(): THREE.BufferGeometry {
  const P: number[] = [], N: number[] = [], UV: number[] = [], PART: number[] = [], ROOT: number[] = [], I: number[] = [];
  const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, part: number, root: number[]) => {
    P.push(x, y, z); N.push(nx, ny, nz); UV.push(u, v); PART.push(part); ROOT.push(root[0], root[1], root[2]);
    return P.length / 3 - 1;
  };
  // ---- body: flattened ellipsoid, top-down planar UVs onto the photo
  const SEG = 14, RINGS = 8;
  const base = P.length / 3;
  for (let r = 0; r <= RINGS; r++) {
    const th = (r / RINGS) * Math.PI;           // 0 top … π bottom
    for (let s = 0; s <= SEG; s++) {
      const ph = (s / SEG) * Math.PI * 2;
      let nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      // tail slightly wider than the head (wings), head end tapered
      const taper = nz < 0 ? 0.82 + 0.18 * (1 + nz) : 1;
      const x = nx * BW * taper, z = nz * BL, y = (ny > 0 ? ny * BH : ny * BH * 0.3) + BH * 0.55;
      const u = U0 + (x / BW * 0.5 + 0.5) * (U1 - U0);
      const v = VH + (z / BL * 0.5 + 0.5) * (VT - VH);
      add(x, y, z, nx, ny > 0 ? ny : ny * 0.5, nz, u, v, 0, [0, 0, 0]);
    }
  }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
    const a = base + r * (SEG + 1) + s, b = a + SEG + 1;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // ---- thin prism between two points
  const seg = (a: number[], b: number[], r0: number, r1: number, part: number, root: number[]) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const s1 = new THREE.Vector3().crossVectors(d, up).normalize(), s2 = new THREE.Vector3().crossVectors(d, s1).normalize();
    const i0 = P.length / 3;
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2;
      const o = s1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s2, Math.sin(ang));
      add(a[0] + o.x * r0, a[1] + o.y * r0, a[2] + o.z * r0, o.x, o.y, o.z, 0.5, 0.5, part, root);
      add(b[0] + o.x * r1, b[1] + o.y * r1, b[2] + o.z * r1, o.x, o.y, o.z, 0.5, 0.5, part, root);
    }
    for (let k = 0; k < 3; k++) {
      const a0 = i0 + k * 2, b0 = a0 + 1, a1 = i0 + ((k + 1) % 3) * 2, b1 = a1 + 1;
      I.push(a0, a1, b0, b0, a1, b1);
    }
  };
  // ---- legs (front, mid, hind) × (left, right)
  const legs: [number, number[], number[]][] = [
    [-0.008, [0.017, 0, -0.024], [0.011, 0.007, -0.014]],
    [0.0, [0.021, 0, 0.002], [0.014, 0.008, -0.001]],
    [0.007, [0.02, 0, 0.03], [0.014, 0.008, 0.015]],
  ];
  let li = 1;
  for (const [rz, foot, knee] of legs) for (const sx of [-1, 1]) {
    const root = [sx * 0.0055, BH * 0.7, rz];
    const k = [sx * knee[0], knee[1], knee[2]], f = [sx * foot[0], foot[1], foot[2]];
    seg(root, k, 0.0011, 0.0009, li, root);
    seg(k, f, 0.0008, 0.0003, li, root);
    li++;
  }
  // ---- antennae (long, curving out)
  for (const sx of [-1, 1]) {
    const root = [sx * 0.0016, BH * 0.9, -BL * 0.96];
    const a1 = [sx * 0.005, BH * 1.1, -BL - 0.01], a2 = [sx * 0.011, BH * 1.2, -BL - 0.021], a3 = [sx * 0.019, BH * 1.0, -BL - 0.03];
    const part = sx < 0 ? 7 : 8;
    seg(root, a1, 0.00045, 0.0004, part, root);
    seg(a1, a2, 0.0004, 0.0003, part, root);
    seg(a2, a3, 0.0003, 0.00018, part, root);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(ROOT, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}
