import * as THREE from 'three';
import { text3d, Text3D } from '../../ui3d/text3d';
import { addInkHull, setInk } from '../../core/ink';

/* =============================================================================================
 * Goofy anime effects — real 3D objects in the world (inked by the screen-space pass / hulls),
 * except the speed lines, which are a screen-edge effect by nature.
 *   SpeedLines   radial streaks at the screen edges (sprint)
 *   Puffs        low-poly "poof" dust clouds (opaque → they get ink outlines), one InstancedMesh
 *   Sparkles     4-point HDR stars that twinkle (bloom), one InstancedMesh
 *   sweatDrop()  glossy blue teardrop with ink hull + highlight, slides down
 *   angerVein()  red 💢 (4 bent tubes) with ink hull, throbs
 *   popMark()    "!" / "?" in real 3D text, springs in
 *   soundWord()  comic onomatopoeia stamp (looped Thai, text3d 'talk'), squash-and-stretch pop
 * ============================================================================================= */

export interface Fx { obj: THREE.Object3D; t: number; dur: number; update(dt: number, cam: THREE.Camera): boolean; dispose?(): void }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
export const camRight = (cam: THREE.Camera, out = new THREE.Vector3()) => out.set(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(_q));
export const camUp = (cam: THREE.Camera, out = new THREE.Vector3()) => out.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q));

/** springy overshoot 0→1 */
export function springIn(t: number, k = 9) { return t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(t * k * 1.6); }

// ------------------------------------------------------------------ speed lines

export class SpeedLines {
  readonly mesh: THREE.Mesh;
  private u = { uT: { value: 0 }, uK: { value: 0 }, uAspect: { value: 16 / 9 } };
  k = 0;
  constructor(n = 64) {
    const pos = new Float32Array(n * 4 * 3);
    const corner = new Float32Array(n * 4 * 2);
    const seed = new Float32Array(n * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i + Math.random() * 0.8) / n, r = Math.random(), w = 0.004 + Math.random() * 0.012;
      const C = [[0, -1], [0, 1], [1, -1], [1, 1]];
      for (let c = 0; c < 4; c++) {
        const j = i * 4 + c;
        corner[j * 2] = C[c][0]; corner[j * 2 + 1] = C[c][1];
        seed[j * 3] = a; seed[j * 3 + 1] = r; seed[j * 3 + 2] = w;
      }
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec2 corner; attribute vec3 seed;
        uniform float uT, uK, uAspect;
        varying float vA; varying float vAlong; varying float vDark;
        float h(float x) { return fract(sin(x) * 43758.5453); }
        void main() {
          float tick = floor(uT * 15.0 + seed.y * 7.0);
          float rnd = h(seed.x * 91.7 + tick * 13.1);
          float on = step(0.42, rnd);
          float ang = seed.x * 6.2831853 + (rnd - 0.5) * 0.05;
          vec2 dir = vec2(cos(ang), sin(ang));
          float r0 = mix(0.62, 0.9, fract(seed.y * 3.7 + rnd * 0.4)) + (1.0 - uK) * 0.6;
          float r = mix(r0, 1.9, corner.x);
          vec2 p = dir * r;
          vec2 perp = normalize(vec2(-dir.y * uAspect, dir.x)) ;
          p += vec2(perp.x / uAspect, perp.y) * seed.z * (0.2 + corner.x) * corner.y * (1.0 + 0.8 * uK);
          vA = on * uK; vAlong = corner.x; vDark = step(0.72, fract(seed.y * 7.3));
          gl_Position = vec4(p, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vAlong; varying float vDark;
        void main() {
          float a = vA * smoothstep(0.0, 0.3, vAlong);
          vec3 c = mix(vec3(1.0, 0.99, 0.96), vec3(0.015, 0.012, 0.01), vDark);
          gl_FragColor = vec4(c, a * 0.8);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.name = 'anime-speedlines';
    this.mesh.raycast = () => {};
  }
  update(dt: number, target: number, aspect: number) {
    this.k += (target - this.k) * (1 - Math.exp(-(target > this.k ? 7 : 4) * dt));
    this.u.uT.value += dt;
    this.u.uK.value = this.k;
    this.u.uAspect.value = aspect;
    this.mesh.visible = this.k > 0.01;
  }
}

// ------------------------------------------------------------------ puffs

interface Puff { p: THREE.Vector3; v: THREE.Vector3; s: number; t: number; dur: number; rot: number }

export class Puffs {
  readonly mesh: THREE.InstancedMesh;
  private list: Puff[] = [];
  private m = new THREE.Matrix4();
  constructor(cap = 160) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xeee2cf, roughness: 1, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
    mat.name = 'anime-puff';
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'anime-puffs';
    this.mesh.raycast = () => {};
  }
  /** a ring/burst of dust puffs at p (ground point). size ≈ puff radius, n puffs, spread m/s */
  burst(p: THREE.Vector3, n = 7, size = 0.09, spread = 1.2, dir?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.mesh.instanceMatrix.count) this.list.shift();
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const v = new THREE.Vector3(Math.cos(a), 0.25 + Math.random() * 0.45, Math.sin(a)).multiplyScalar(spread * (0.6 + Math.random() * 0.6));
      if (dir) v.addScaledVector(dir, spread * 1.2);
      this.list.push({ p: p.clone().add(new THREE.Vector3(Math.cos(a) * size, size * 0.6, Math.sin(a) * size)), v, s: size * (0.7 + Math.random() * 0.7), t: 0, dur: 0.45 + Math.random() * 0.35, rot: Math.random() * 6 });
    }
  }
  update(dt: number) {
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      q.t += dt;
      if (q.t >= q.dur) continue;
      q.v.multiplyScalar(Math.exp(-5 * dt));
      q.v.y += 0.6 * dt;
      q.p.addScaledVector(q.v, dt);
      const k = q.t / q.dur;
      // pop up fast, linger, shrink away (no transparency: stays inked)
      const sc = q.s * Math.min(1, k * 7) * (1 - k * k) * (1 + k * 0.9);
      this.m.makeRotationY(q.rot + k * 1.5).scale(_v.set(sc, sc * 0.85, sc)).setPosition(q.p);
      this.mesh.setMatrixAt(n, this.m);
      L[n++] = q;
    }
    L.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

// ------------------------------------------------------------------ sparkles

interface Spark { p: THREE.Vector3; s: number; t: number; dur: number; spin: number; follow?: () => THREE.Vector3 | null; off: THREE.Vector3 }

function starGeometry() {
  const sh = new THREE.Shape();
  const N = 4, R = 1, r = 0.2;
  for (let i = 0; i < N * 2; i++) {
    const a = (i / (N * 2)) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ShapeGeometry(sh);
}

export class Sparkles {
  readonly mesh: THREE.InstancedMesh;
  private list: Spark[] = [];
  private m = new THREE.Matrix4();
  constructor(cap = 96) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.7, 1.5), side: THREE.DoubleSide, toneMapped: true });
    mat.name = 'anime-sparkle';
    setInk(mat, 0.35, 0);
    this.mesh = new THREE.InstancedMesh(starGeometry(), mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'anime-sparkles';
    this.mesh.raycast = () => {};
  }
  add(p: THREE.Vector3, size = 0.06, follow?: () => THREE.Vector3 | null) {
    if (this.list.length >= this.mesh.instanceMatrix.count) this.list.shift();
    const base = follow?.() ?? p;
    this.list.push({ p: p.clone(), s: size * (0.6 + Math.random() * 0.8), t: 0, dur: 0.45 + Math.random() * 0.4, spin: (Math.random() - 0.5) * 4, follow, off: p.clone().sub(base) });
  }
  update(dt: number, cam: THREE.Camera) {
    const L = this.list;
    cam.getWorldQuaternion(_q);
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      s.t += dt;
      if (s.t >= s.dur) continue;
      if (s.follow) { const b = s.follow(); if (b) s.p.copy(b).add(s.off); }
      s.off.y += dt * 0.08;
      const k = s.t / s.dur;
      const sc = s.s * Math.sin(Math.PI * k) * (1 + 0.25 * Math.sin(s.t * 40));
      this.m.compose(s.p, _q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_v2.set(0, 0, 1), s.spin * s.t)), _v.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, this.m);
      L[n++] = s;
    }
    L.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

// ------------------------------------------------------------------ sweat drop

let dropGeo: THREE.BufferGeometry | null = null;
let dropMat: THREE.MeshPhysicalMaterial | null = null;
let hiGeo: THREE.BufferGeometry | null = null;
let hiMat: THREE.MeshBasicMaterial | null = null;
function dropAssets() {
  if (!dropGeo) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      // teardrop: round bottom, pointed top
      const y = -Math.cos(t * Math.PI);
      const r = Math.sin(t * Math.PI) * (0.55 + 0.45 * (1 - t)) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 * 0.75 : 1);
      pts.push(new THREE.Vector2(Math.max(0, r * 0.62), y * 0.5 + 0.5 + t * 0.35));
    }
    dropGeo = new THREE.LatheGeometry(pts, 14);
    dropGeo.computeVertexNormals();
    dropMat = new THREE.MeshPhysicalMaterial({ color: 0x8fd6ff, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x2a6a9a, emissiveIntensity: 0.55 });
    dropMat.name = 'anime-sweat';
    dropMat.userData.cel = 1;
    hiGeo = new THREE.SphereGeometry(0.12, 8, 6);
    hiMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) });
    setInk(hiMat, 0, 0);
  }
  return { dropGeo: dropGeo!, dropMat: dropMat!, hiGeo: hiGeo!, hiMat: hiMat! };
}

/** big anime sweat drop beside a head. `anchor()` returns the head-top world point (null = owner gone). */
export function sweatDrop(anchor: () => THREE.Vector3 | null, size = 0.085, side = 1): Fx {
  const A = dropAssets();
  const g = new THREE.Group();
  const m = new THREE.Mesh(A.dropGeo, A.dropMat);
  m.scale.setScalar(size);
  m.position.y = -size * 0.5;
  const hi = new THREE.Mesh(A.hiGeo, A.hiMat);
  hi.position.set(-0.2, 0.42, 0.42);
  m.add(hi);
  g.add(m);
  const unhull = addInkHull(g, 1.4, { maxDist: 22, refDist: 2.5 });
  const dur = 1.5;
  let slide = 0;
  return {
    obj: g, t: 0, dur,
    update(dt, cam) {
      this.t += dt;
      const p = anchor();
      if (!p) return false;
      const k = this.t / dur;
      slide += dt * (k > 0.25 ? 0.07 : 0.01);
      camRight(cam, _v).multiplyScalar(0.16 * side);
      g.position.copy(p).add(_v).add(_v2.set(0, -0.06 - slide, 0));
      cam.getWorldQuaternion(g.quaternion);
      const pop = springIn(this.t, 11);
      const out = 1 - THREE.MathUtils.smoothstep(k, 0.8, 1);
      g.scale.set(pop * out * (1 + 0.08 * Math.sin(this.t * 9)), pop * out * (1 - 0.06 * Math.sin(this.t * 9)), pop * out);
      return this.t < dur;
    },
    dispose() { unhull(); },
  };
}

// ------------------------------------------------------------------ anger vein 💢

let veinGeo: THREE.BufferGeometry | null = null;
let veinMat: THREE.MeshStandardMaterial | null = null;
function veinAssets() {
  if (!veinGeo) {
    const parts: THREE.BufferGeometry[] = [];
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? 1 : -1, sy = q < 2 ? 1 : -1;
      // a bent bracket per quadrant: corner toward the centre, arms curling outward
      const c = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0.22 * sx, 1.0 * sy, 0), new THREE.Vector3(0.16 * sx, 0.16 * sy, 0), new THREE.Vector3(1.0 * sx, 0.22 * sy, 0));
      const tg = new THREE.TubeGeometry(c, 14, 0.12, 7, false);
      parts.push(tg);
      // rounded caps
      for (const end of [c.getPoint(0), c.getPoint(1)]) {
        const s = new THREE.SphereGeometry(0.12, 8, 6);
        s.translate(end.x, end.y, end.z);
        parts.push(s);
      }
    }
    // merge (positions + normals only)
    let count = 0;
    for (const p of parts) { const gi = p.index ? p.toNonIndexed() : p; count += gi.attributes.position.count; }
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) {
      const gi = p.index ? p.toNonIndexed() : p;
      pos.set(gi.attributes.position.array as Float32Array, o * 3);
      nor.set(gi.attributes.normal.array as Float32Array, o * 3);
      o += gi.attributes.position.count;
    }
    veinGeo = new THREE.BufferGeometry();
    veinGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    veinGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    veinMat = new THREE.MeshStandardMaterial({ color: 0xff2a1e, roughness: 0.35, metalness: 0, emissive: 0xc0100a, emissiveIntensity: 0.6 });
    veinMat.name = 'anime-vein';
  }
  return { veinGeo: veinGeo!, veinMat: veinMat! };
}

export function angerVein(anchor: () => THREE.Vector3 | null, size = 0.075, dur = 1.8): Fx {
  const A = veinAssets();
  const g = new THREE.Group();
  const m = new THREE.Mesh(A.veinGeo, A.veinMat);
  m.scale.setScalar(size);
  g.add(m);
  const unhull = addInkHull(g, 1.5, { maxDist: 24, refDist: 2.5 });
  return {
    obj: g, t: 0, dur,
    update(dt, cam) {
      this.t += dt;
      const p = anchor();
      if (!p) return false;
      camRight(cam, _v).multiplyScalar(0.13);
      g.position.copy(p).add(_v).add(_v2.set(0, 0.05, 0));
      cam.getWorldQuaternion(g.quaternion);
      const k = this.t / this.dur;
      const throb = 1 + 0.22 * Math.max(0, Math.sin(this.t * 15));
      const s = springIn(this.t, 12) * throb * (1 - THREE.MathUtils.smoothstep(k, 0.85, 1));
      g.scale.setScalar(s);
      m.rotation.z = Math.sin(this.t * 3) * 0.12;
      return this.t < this.dur;
    },
    dispose() { unhull(); },
  };
}

// ------------------------------------------------------------------ "!" / "?" marks

export function popMark(anchor: () => THREE.Vector3 | null, mark: '!' | '?' | '!!' | '!?', color: THREE.ColorRepresentation = '#ffd23a', dur = 1.5): Fx {
  const t3 = text3d(mark, { font: 'heavy', size: 0.2, depth: 0.35, bevel: 0.06, color, side: '#5a1c06', emissive: 0.35, roughness: 0.3, castShadow: false, keyLight: 0.6 });
  const g = new THREE.Group();
  g.add(t3);
  let vanished = false;
  return {
    obj: g, t: 0, dur,
    update(dt, cam) {
      this.t += dt;
      const p = anchor();
      if (!p) return false;
      const k = this.t / this.dur;
      g.position.copy(p).add(_v.set(0, 0.32 + 0.05 * Math.sin(this.t * 6), 0));
      cam.getWorldQuaternion(g.quaternion);
      const s = springIn(this.t, 13);
      // squash on landing, stretch on the way up
      g.scale.set(s * (1 + 0.25 * Math.exp(-this.t * 8) * Math.sin(this.t * 30)), s * (1 - 0.2 * Math.exp(-this.t * 8) * Math.sin(this.t * 30)), s);
      t3.rotation.z = Math.sin(this.t * 7) * 0.12 * (1 - k);
      if (!vanished && k > 0.8) { vanished = true; t3.vanish(0.01); }
      return this.t < this.dur;
    },
    dispose() { t3.dispose(); },
  };
}

// ------------------------------------------------------------------ comic sound words

export function soundWord(at: THREE.Vector3, word: string, color: THREE.ColorRepresentation = '#fff07a', size = 0.22, dur = 1.0): Fx {
  const t3: Text3D = text3d(word, { font: 'talk', size, depth: 0.32, bevel: 0.05, color, side: '#3a0f04', emissive: 0.3, roughness: 0.35, castShadow: false, keyLight: 0.65, anim: { pop: 0.18, spin: 0.4, rise: 0.2 } });
  const g = new THREE.Group();
  g.add(t3);
  const tilt = (Math.random() - 0.5) * 0.5;
  const drift = new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.35, 0);
  const base = at.clone();
  let vanished = false;
  t3.popIn(0.025);
  return {
    obj: g, t: 0, dur,
    update(dt, cam) {
      this.t += dt;
      const k = this.t / this.dur;
      g.position.copy(base).addScaledVector(drift, Math.min(1, this.t * 2.2) * 0.6);
      cam.getWorldQuaternion(g.quaternion);
      g.rotateZ(tilt);
      // stamp: squashed wide → stretched tall → settle
      const e = Math.exp(-this.t * 7);
      const pop = Math.min(1, this.t * 14);
      g.scale.set(pop * (1 + 0.45 * e * Math.cos(this.t * 24)), pop * (1 - 0.35 * e * Math.cos(this.t * 24)), pop);
      if (!vanished && k > 0.72) { vanished = true; t3.vanish(0.015); }
      return this.t < this.dur;
    },
    dispose() { t3.dispose(); },
  };
}
