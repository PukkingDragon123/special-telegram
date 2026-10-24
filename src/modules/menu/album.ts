import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Assets } from '../../core/assets';
import { Noise } from '../../core/rng';
import { mulberry } from './lettering';

/* ============================================================================================
 * The album-cover set (ref4 "Tattoo Colour – hong ser"), rebuilt in 3D.
 * three.js frame: camera at the origin looking down -Z (cover breakdown: "camera at origin looking +z"
 * → z_three = -z). All furniture uses REAL scanned/photographed materials (ambientCG CC0:
 * Carpet010 rug, Leather038 sofa, Wood052 table, Wood090A Jenga, Paper001 backdrop, Plastic010 chairs).
 * ========================================================================================== */

const G = 'gen/menu/';
const noise = new Noise(4242);

/** 2000s scanned-print grade (breakdown §6): warm, S-curve, +saturation. Passed to post.setLook(). */
export const ALBUM_GRADE = { lift: [-0.012, -0.012, -0.02] as [number, number, number], gamma: [1.02, 1.0, 0.92] as [number, number, number], gain: [1.12, 1.05, 0.84] as [number, number, number], saturation: 1.32, contrast: 1.14, tint: [1, 0.99, 0.93] as [number, number, number] };

export const ALBUM_CAM = { pos: new THREE.Vector3(0, 0.43, 0), look: new THREE.Vector3(0, 0.72, -3.0), fov: 41 };

/** Where the four guys go (slot 0..3 = G1..G4, left → right, matches characters.playerLook(slot)). */
export interface SlotDef { pos: THREE.Vector3; yaw: number; pose: 'sit' | 'stand_cool' | 'jenga_pull'; seat: number; lean?: number }
const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
export const SLOTS: SlotDef[] = [
  // G1: blue Panton chair, leans forward, holds a block, faces right (toward the tower)
  { pos: new THREE.Vector3(-0.74, 0, -2.2), yaw: yawOf(1, 0.32), pose: 'jenga_pull', seat: 0.43, lean: 0.5 },
  // G2: standing behind, faces the camera, slight turn to his left
  { pos: new THREE.Vector3(-0.36, 0, -3.28), yaw: yawOf(0.18, 1), pose: 'stand_cool', seat: 0 },
  // G3: on the sofa's front edge, reaching for the tower
  { pos: new THREE.Vector3(0.3, 0, -2.98), yaw: yawOf(-0.32, 1), pose: 'jenga_pull', seat: 0.38 },
  // G4: side-saddle on the orange shell chair, faces left toward the tower
  { pos: new THREE.Vector3(0.64, 0, -2.3), yaw: yawOf(-1, 0.34), pose: 'jenga_pull', seat: 0.45 },
];

function tex(path: string, repeat: number | [number, number], srgb = true) {
  return Assets.texture(G + path, { srgb, repeat });
}

// ------------------------------------------------------------------ backdrop (cyclorama + glow shader)

function sweepProfile(): { z: number; y: number }[] {
  // floor (front) → curve (radius 1.1) → wall
  const pts: { z: number; y: number }[] = [];
  const zWall = -5.0, R = 1.1;
  pts.push({ z: 1.5, y: 0 });
  for (let z = 1.0; z > zWall + R; z -= 0.5) pts.push({ z, y: 0 });
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI / 2;
    pts.push({ z: zWall + R - Math.sin(a) * R, y: R - Math.cos(a) * R });
  }
  for (let y = R + 0.5; y <= 7.01; y += 0.5) pts.push({ z: zWall, y });
  return pts;
}

export function buildBackdrop(refCam: THREE.PerspectiveCamera) {
  const prof = sweepProfile();
  const W = 18, NX = 36;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  for (let j = 0; j < prof.length; j++) {
    if (j > 0) acc += Math.hypot(prof[j].z - prof[j - 1].z, prof[j].y - prof[j - 1].y);
    for (let i = 0; i <= NX; i++) {
      const x = -W / 2 + (i / NX) * W;
      // tiny paper sag / ripples so the seamless never reads as CG-perfect
      const n = noise.fbm2(x * 0.35, acc * 0.35, 3) * 0.035 * Math.min(1, prof[j].y);
      pos.push(x, prof[j].y, prof[j].z + n);
      uv.push(x / 2.2, acc / 2.2);
    }
  }
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const paper = tex('paper_backdrop.jpg', 1);
  const paperN = tex('paper_backdrop_normal.jpg', 1, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe9e0c6, map: paper, normalMap: paperN, roughness: 0.96, metalness: 0 });
  mat.normalScale.set(0.35, 0.35);
  const uniforms = {
    uRefVP: { value: new THREE.Matrix4() },
    uAspect: { value: 16 / 9 },
    uGlow: { value: 1.0 },
    uTime: { value: 0 },
    uPulse: { value: 0 },
  };
  const updateRef = () => {
    refCam.updateMatrixWorld(true);
    uniforms.uRefVP.value.multiplyMatrices(refCam.projectionMatrix, refCam.matrixWorldInverse);
    uniforms.uAspect.value = refCam.aspect;
  };
  updateRef();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform mat4 uRefVP; uniform float uAspect; uniform float uGlow; uniform float uTime; uniform float uPulse;
        vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
        // ref4 backdrop (colours sampled from the cover, see references/ui/ALBUM_COVER_BREAKDOWN.md §6)
        vec3 albumGlow(vec2 uv){
          float d = distance(uv, vec2(0.49, 1.10));
          float disc = 1.0 - smoothstep(0.95, 1.05, d);
          float hot = exp(-pow(distance(uv, vec2(0.50, 0.45)) / 0.42, 2.0));
          vec3 inside = mix(vec3(0.992, 0.937, 0.318), vec3(1.0, 0.973, 0.627), hot);
          vec3 edge = vec3(0.937, 0.804, 0.463);
          inside = mix(edge, inside, smoothstep(1.02, 0.80, d));
          float vig = smoothstep(0.35, 0.95, distance(uv * vec2(0.8, 1.0), vec2(0.4, 0.55)));
          vec3 outside = mix(vec3(0.533, 0.471, 0.329), vec3(0.278, 0.243, 0.157), vig);
          return mix(outside, inside, disc);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec4 cp = uRefVP * vec4(vWPos, 1.0);
          vec2 ndc = cp.xy / max(cp.w, 1e-4);
          // cover-normalised coords: the square cover is the centre of the screen
          vec2 cuv = vec2(0.5 + ndc.x * uAspect * 0.5, 0.5 - ndc.y * 0.5);
          vec3 g = albumGlow(cuv);
          float paperL = dot(diffuseColor.rgb, vec3(0.3333)) / 0.86;
          float wall = smoothstep(0.08, 0.95, vWPos.y);
          float puls = 1.0 + uPulse * 0.25 * exp(-pow(distance(cuv, vec2(0.5, 0.45)) / 0.5, 2.0));
          totalEmissiveRadiance += s2l(g) * (0.85 + 0.15 * paperL) * wall * uGlow * 1.25 * puls;
          diffuseColor.rgb *= mix(1.0, 0.25, wall);
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'album_backdrop';
  return { mesh, uniforms, updateRef };
}

// ------------------------------------------------------------------ rug

export function buildRug() {
  const w = 3.1, d = 2.6, nx = 40, nz = 34;
  const geo = new THREE.PlaneGeometry(w, d, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const ca = Math.cos(Math.PI / 4), sa = Math.sin(Math.PI / 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const edge = Math.max(Math.abs(x) / (w / 2), Math.abs(z) / (d / 2));
    // low pile thickness, gentle lumps, edges sit flatter
    const y = 0.012 + noise.fbm2(x * 0.8, z * 0.8, 3) * 0.008 * (1 - edge) - Math.max(0, edge - 0.97) * 0.3;
    p.setY(i, y);
    // texture stripes are diagonal in the scan → rotate 45° so they run parallel to the front edge
    const u = (x * ca + z * sa) / 0.62, v = (-x * sa + z * ca) / 0.62;
    uv.setXY(i, u, v);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex('rug_albedo.jpg', 1), normalMap: tex('rug_normal.jpg', 1, false),
    roughnessMap: tex('rug_orm.jpg', 1, false), aoMap: tex('rug_orm.jpg', 1, false), roughness: 1, color: 0x767a5e,
  });
  mat.normalScale.set(1.2, 1.2);
  // ORM: R = AO, G = roughness
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        roughnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).g;
      #endif`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, -2.65);
  mesh.receiveShadow = true;
  mesh.name = 'album_rug';
  return mesh;
}

// ------------------------------------------------------------------ sofa (caramel leather)

function puff(geo: THREE.BufferGeometry, amt: number, seed: number) {
  geo.computeVertexNormals();
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const bb = new THREE.Box3().setFromBufferAttribute(p);
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // pillow: bulge in the middle of every face, plus a little organic noise
    const kx = 1 - Math.pow(Math.abs((x - c.x) / (s.x / 2)), 4);
    const ky = 1 - Math.pow(Math.abs((y - c.y) / (s.y / 2)), 4);
    const kz = 1 - Math.pow(Math.abs((z - c.z) / (s.z / 2)), 4);
    const k = Math.max(0, Math.min(kx * ky, kx * kz, ky * kz) + Math.max(kx * ky, kx * kz, ky * kz) * 0.5) * amt;
    const nn = noise.fbm3(x * 4 + seed, y * 4, z * 4, 2) * amt * 0.4;
    p.setXYZ(i, x + n.getX(i) * (k + nn), y + n.getY(i) * (k + nn), z + n.getZ(i) * (k + nn));
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildSofa() {
  const g = new THREE.Group();
  g.name = 'album_sofa';
  const leather = new THREE.MeshPhysicalMaterial({
    map: tex('sofa_leather_albedo.jpg', [2, 2]), normalMap: tex('sofa_leather_normal.jpg', [2, 2], false),
    roughnessMap: tex('sofa_leather_rough.jpg', [2, 2], false), roughness: 0.75, color: 0xc9a080, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.2, sheenColor: new THREE.Color(0xf8c48a),
  });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, leather);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(puff(new RoundedBoxGeometry(1.86, 0.2, 0.82, 3, 0.05), 0.006, 1), 0, 0.17, 0);
  add(puff(new RoundedBoxGeometry(0.8, 0.13, 0.64, 4, 0.05), 0.02, 2), -0.41, 0.33, 0.07);
  add(puff(new RoundedBoxGeometry(0.8, 0.13, 0.64, 4, 0.05), 0.02, 3), 0.41, 0.33, 0.07);
  add(puff(new RoundedBoxGeometry(0.8, 0.42, 0.2, 4, 0.06), 0.025, 4), -0.41, 0.56, -0.29, -0.16);
  add(puff(new RoundedBoxGeometry(0.8, 0.42, 0.2, 4, 0.06), 0.025, 5), 0.41, 0.56, -0.29, -0.16);
  add(puff(new RoundedBoxGeometry(0.16, 0.36, 0.84, 3, 0.06), 0.012, 6), -0.93, 0.36, 0);
  add(puff(new RoundedBoxGeometry(0.16, 0.36, 0.84, 3, 0.06), 0.012, 7), 0.93, 0.36, 0);
  add(new RoundedBoxGeometry(1.86, 0.5, 0.12, 2, 0.04), 0, 0.48, -0.37);
  const leg = new THREE.MeshStandardMaterial({ color: 0x281e18, roughness: 0.5 });
  for (const [x, z] of [[-0.85, 0.33], [0.85, 0.33], [-0.85, -0.33], [0.85, -0.33]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.07, 8), leg);
    m.position.set(x, 0.035, z);
    g.add(m);
  }
  g.position.set(0, 0, -3.22);
  return g;
}

// ------------------------------------------------------------------ coffee table (orange lacquer)

export function buildTable() {
  const g = new THREE.Group();
  g.name = 'album_table';
  const top = new THREE.MeshPhysicalMaterial({
    map: tex('table_wood_albedo.jpg', [1.2, 0.7]), normalMap: tex('table_wood_normal.jpg', [1.2, 0.7], false),
    color: 0xff9a6a, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12,
  });
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.032, 0.5, 2, 0.01), top);
  m.position.y = 0.364;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  const legM = new THREE.MeshStandardMaterial({ color: 0x281e18, roughness: 0.42, metalness: 0.3 });
  for (const [x, z] of [[-0.41, 0.2], [0.41, 0.2], [-0.41, -0.2], [0.41, -0.2]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.35, 8), legM);
    l.position.set(x, 0.175, z);
    l.castShadow = true;
    g.add(l);
  }
  g.position.set(0, 0, -2.5);
  return g;
}

// ------------------------------------------------------------------ Jenga tower (painted blocks)

export const JENGA_COLORS = ['#DD5A49', '#F49A3E', '#FEE15A', '#3E52C0', '#9952B4', '#E16CA7', '#ED7387', '#6CBF4B', '#3FA7D6'];

export interface Jenga {
  mesh: THREE.InstancedMesh;
  group: THREE.Group;
  /** block G3 is pulling (index), animated by update() */
  update(dt: number, t: number): void;
  collapse(): void;
  reset(): void;
  wobble(k: number): void;
}

export function buildJenga(levels = 18): Jenga {
  const L = 0.075, H = 0.015, Wd = 0.025;
  const geo = new RoundedBoxGeometry(L, H * 0.96, Wd * 0.97, 2, 0.0025);
  const mat = new THREE.MeshStandardMaterial({ map: Assets.texture(G + 'jenga_wood_grain.jpg', { srgb: true, repeat: [0.4, 0.15] }), roughness: 0.55, metalness: 0 });
  const rnd = mulberry(777);
  type B = { base: THREE.Matrix4; pos: THREE.Vector3; rot: number; out: number; missing: boolean; vel: THREE.Vector3; av: THREE.Vector3; q: THREE.Quaternion; fall: boolean };
  const blocks: B[] = [];
  for (let lv = 0; lv < levels; lv++) {
    const rot = lv % 2 ? Math.PI / 2 : 0;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * Wd;
      const pos = rot ? new THREE.Vector3(off, H / 2 + lv * H, 0) : new THREE.Vector3(0, H / 2 + lv * H, off);
      const missing = lv > 1 && lv < levels - 1 && rnd() < 0.09 && k !== 1;
      const out = !missing && rnd() < 0.12 ? (rnd() - 0.5) * 0.04 : 0;
      blocks.push({ base: new THREE.Matrix4(), pos, rot, out, missing, vel: new THREE.Vector3(), av: new THREE.Vector3(), q: new THREE.Quaternion(), fall: false });
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, blocks.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const col = new THREE.Color();
  blocks.forEach((b, i) => { col.set(JENGA_COLORS[Math.floor(rnd() * JENGA_COLORS.length)]); mesh.setColorAt(i, col); });
  const group = new THREE.Group();
  group.name = 'album_jenga';
  group.add(mesh);
  group.position.set(0.0, 0.38, -2.5);
  group.rotation.y = Math.PI / 4 + 0.08;
  // G3's block: a mid-height middle-row block on the camera-facing side
  const pullIdx = blocks.findIndex((b, i) => i > 21 && !b.missing && b.rot === 0 && i % 3 === 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  let wob = 0;
  let collapsing = false, ct = 0;
  const place = (t: number) => {
    blocks.forEach((b, i) => {
      if (b.missing) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); return; }
      if (b.fall) {
        q.copy(b.q);
        p.copy(b.pos);
      } else {
        let out = b.out;
        if (i === pullIdx) out = 0.006 + Math.max(0, Math.sin(t * 0.55)) * 0.03;
        p.copy(b.pos);
        if (b.rot) p.z += out; else p.x += out;
        // wobble: the higher, the more sway
        const sway = wob * (b.pos.y / (levels * H));
        p.x += Math.sin(t * 7.3) * sway * 0.006;
        p.z += Math.cos(t * 6.1) * sway * 0.004;
        q.setFromEuler(new THREE.Euler(Math.sin(t * 6.1) * sway * 0.04, b.rot, Math.sin(t * 7.3) * sway * 0.05));
      }
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  const api: Jenga = {
    mesh, group,
    update(dt, t) {
      if (collapsing) {
        ct += dt;
        for (const b of blocks) {
          if (b.missing) continue;
          if (!b.fall) {
            // release from the top down, quickly
            if (ct > (levels * H - b.pos.y) * 2.5 + rnd() * 0.05) {
              b.fall = true;
              b.q.setFromEuler(new THREE.Euler(0, b.rot, 0));
              b.vel.set((rnd() - 0.5) * 0.9, rnd() * 0.5, (rnd() - 0.3) * 0.9);
              b.av.set((rnd() - 0.5) * 14, (rnd() - 0.5) * 8, (rnd() - 0.5) * 14);
            }
            continue;
          }
          b.vel.y -= 9.8 * dt;
          b.pos.addScaledVector(b.vel, dt);
          const floorY = Math.abs(b.pos.x) < 0.3 && Math.abs(b.pos.z) < 0.3 ? H / 2 : -0.38 + H / 2;
          if (b.pos.y < floorY) {
            b.pos.y = floorY;
            b.vel.y *= -0.25; b.vel.x *= 0.6; b.vel.z *= 0.6; b.av.multiplyScalar(0.5);
          }
          const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.av.x * dt, b.av.y * dt, b.av.z * dt));
          b.q.multiply(dq);
        }
      }
      place(t);
    },
    collapse() { collapsing = true; ct = 0; },
    reset() {
      collapsing = false;
      let i = 0;
      for (let lv = 0; lv < levels; lv++) for (let k = 0; k < 3; k++, i++) {
        const b = blocks[i];
        const off = (k - 1) * Wd;
        b.fall = false;
        b.pos.set(b.rot ? off : 0, H / 2 + lv * H, b.rot ? 0 : off);
      }
    },
    wobble(k) { wob = k; },
  };
  return api;
}

// ------------------------------------------------------------------ molded plastic chairs

/**
 * Sweep a shell along a 2D profile (z forward, y up) in the chair's local frame.
 * width(t), dish(t) shape the cross-section (dish = how much the edges curl toward the sitter).
 */
function shellSweep(path: [number, number][], width: (t: number) => number, dish: (t: number) => number, thick: number, nx = 14, smooth = 4) {
  // resample with Catmull-Rom for a smooth molded look
  const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
  const N = path.length * smooth;
  const P = curve.getSpacedPoints(N);
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const ring = (nx + 1);
  const T = new THREE.Vector3(), Nn = new THREE.Vector3();
  const verts: THREE.Vector3[][] = [[], []];
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const a = P[Math.max(0, j - 1)], b = P[Math.min(N, j + 1)];
    T.subVectors(b, a).normalize();
    Nn.set(0, T.z, -T.y); // perpendicular in YZ (points "inside" for a backrest going down)
    const w = width(t), dsh = dish(t);
    for (let i = 0; i <= nx; i++) {
      const u = (i / nx) * 2 - 1;
      const c = P[j].clone();
      c.x += u * w / 2;
      c.addScaledVector(Nn, dsh * u * u);
      verts[0].push(c.clone().addScaledVector(Nn, thick / 2));
      verts[1].push(c.clone().addScaledVector(Nn, -thick / 2));
    }
  }
  const push = (v: THREE.Vector3, u: number, vv: number) => { pos.push(v.x, v.y, v.z); uvs.push(u, vv); return pos.length / 3 - 1; };
  // two faces
  for (let s = 0; s < 2; s++) {
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= nx; i++) push(verts[s][j * ring + i], i / nx, j / N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * ring + i, b = a + 1, c = a + ring, d = c + 1;
      if (s === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  // rims (sides + ends)
  const rim = (getA: (k: number) => THREE.Vector3, getB: (k: number) => THREE.Vector3, n: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) { push(getA(k), k / n, 0); push(getB(k), k / n, 0.02); }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  };
  rim((j) => verts[0][j * ring], (j) => verts[1][j * ring], N, false);
  rim((j) => verts[0][j * ring + nx], (j) => verts[1][j * ring + nx], N, true);
  rim((i) => verts[0][i], (i) => verts[1][i], nx, true);
  rim((i) => verts[0][N * ring + i], (i) => verts[1][N * ring + i], nx, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Panton-style S cantilever chair (cobalt blue glossy plastic). Faces +Z locally (rotated by caller). */
export function buildPanton(color = '#1f4cff') {
  const path: [number, number][] = [
    [-0.27, 0.86], [-0.24, 0.66], [-0.2, 0.5], [-0.12, 0.44], [0.06, 0.435], [0.2, 0.43], [0.25, 0.38],
    [0.2, 0.26], [0.08, 0.12], [-0.06, 0.03], [-0.2, 0.005], [-0.33, 0.0],
  ];
  const width = (t: number) => {
    // back 0.40 → seat 0.48 → waist 0.28 → base 0.52
    if (t < 0.25) return 0.38 + t * 0.4;
    if (t < 0.52) return 0.48;
    if (t < 0.72) return 0.48 - smoothstep(0.52, 0.72, t) * 0.2;
    return 0.28 + smoothstep(0.72, 1.0, t) * 0.26;
  };
  const dish = (t: number) => (t < 0.55 ? 0.035 : t < 0.75 ? 0.02 : 0.012);
  const geo = shellSweep(path, width, dish, 0.014, 16, 5);
  const mat = Assets.pbr('plastic_glossy', { color, repeat: 2, roughness: 0.4 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  g.name = 'album_panton';
  return g;
}

/** Mid-century molded shell chair (mustard-orange) on thin dark legs. Faces +Z locally. */
export function buildShellChair(color = '#d08a2a') {
  const path: [number, number][] = [
    [0.25, 0.405], [0.22, 0.44], [0.1, 0.45], [-0.06, 0.45], [-0.17, 0.48], [-0.22, 0.57], [-0.25, 0.7], [-0.27, 0.82],
  ];
  const width = (t: number) => 0.42 + Math.sin(t * Math.PI) * 0.06;
  const dish = (t: number) => 0.03 + smoothstep(0.4, 0.8, t) * 0.03;
  const geo = shellSweep(path, width, dish, 0.012, 16, 5);
  const mat = Assets.pbr('plastic_glossy', { color, repeat: 2, roughness: 0.6 });
  const g = new THREE.Group();
  const shell = new THREE.Mesh(geo, mat);
  shell.castShadow = shell.receiveShadow = true;
  g.add(shell);
  const legM = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.45, metalness: 0.4 });
  for (const [x, z] of [[-0.15, 0.13], [0.15, 0.13], [-0.15, -0.13], [0.15, -0.13]]) {
    const top = new THREE.Vector3(x * 0.8, 0.43, z * 0.8), bot = new THREE.Vector3(x * 1.45, 0, z * 1.45);
    const len = top.distanceTo(bot);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, len, 6), legM);
    l.position.copy(top).add(bot).multiplyScalar(0.5);
    l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    l.castShadow = true;
    g.add(l);
  }
  g.name = 'album_shellchair';
  return g;
}

// ------------------------------------------------------------------ lights

export function buildLights(scene: THREE.Scene) {
  const key = new THREE.DirectionalLight(0xfff2dc, 2.6);
  key.position.set(-2.2, 2.6, -0.4);
  key.target.position.set(0, 0.8, -2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -2.6; sc.right = 2.6; sc.top = 2.4; sc.bottom = -1.6; sc.near = 0.5; sc.far = 9;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xfff8ee, 0.55);
  fill.position.set(0.2, 0.7, 1.0);
  fill.target.position.set(0, 0.8, -2.6);
  scene.add(fill, fill.target);
  const rims: THREE.SpotLight[] = [];
  for (const sx of [-1, 1]) {
    const r = new THREE.SpotLight(0xfee976, 9, 7, 0.75, 0.85, 1.2);
    r.position.set(sx * 1.6, 1.9, -4.3);
    r.target.position.set(sx * 0.2, 0.95, -2.6);
    scene.add(r, r.target);
    rims.push(r);
  }
  const hemi = new THREE.HemisphereLight(0xfff3c0, 0x3a3a1c, 0.45);
  scene.add(hemi);
  return { key, fill, rims, hemi };
}
