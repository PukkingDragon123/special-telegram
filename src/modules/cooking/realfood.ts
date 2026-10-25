import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Assets } from '../../core/assets';
import { T, cachedMat } from './assets';
import { gc } from './mats';
import { mulberry, fbm3 } from './util';

/* =============================================================================================
 * HYPER-REAL FOOD — photoscan-style geometry & materials built from REAL photos:
 *  - relief meshes: real alpha cut-out photos displaced by heightmaps derived from those photos
 *    (gen/cooking/relief/*_h.png, see CREDITS.md) + photo-derived detail normal maps
 *  - 3D basil leaves (real leaf crop on a folded/curled grid), 3D bird's-eye chilies (real chili
 *    photo straightened into an unwrap strip), eggs (real shell speckle tile)
 *  - ไข่ดาว: lacy relief white + separate glossy domed yolk (jiggles), subsurface on white/yolk
 *  - subsurface / translucency lighting patch (wrap diffuse + back light) for egg, yolk, raw meat,
 *    basil, chili, rice; clearcoat oil sheen helpers for stir-fry
 *  - Poly Haven CC0 food scans (lime, onion, ginger→galangal), decimated to ~500 tris, late-bound
 * Everything is shared (geometry cache + material cache) → a few programs and uploads for all food.
 * ============================================================================================= */

export const GEN = 'gen/cooking/';

// ------------------------------------------------------------------ subsurface / translucency

export interface SSSOpts { color: THREE.ColorRepresentation; wrap?: number; back?: number; amt?: number }

/**
 * Cheap subsurface look for food: wrapped diffuse (light bleeds past the terminator, tinted) +
 * back-light translucency (leaves / egg white / yolk glow when lit from behind). Chains any
 * existing onBeforeCompile (e.g. the raw→cooked blend material).
 */
export function withSSS<M extends THREE.MeshStandardMaterial>(m: M, o: SSSOpts): M {
  const u = {
    sssColor: { value: new THREE.Color(o.color) },
    sssWrap: { value: o.wrap ?? 0.5 },
    sssBack: { value: o.back ?? 0.5 },
    sssAmt: { value: o.amt ?? 1 },
  };
  const prev = m.onBeforeCompile;
  const hadKey = m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
  const prevKey = hadKey ? m.customProgramCacheKey.bind(m) : null;
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sssColor; uniform float sssWrap; uniform float sssBack; uniform float sssAmt;')
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `float sNL = dot( geometryNormal, directLight.direction );
  float wrapNL = saturate( ( sNL + sssWrap ) / ( 1.0 + sssWrap ) );
  float backT = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 3.0 ) * sssBack * saturate( 0.35 - sNL );
  vec3 sssIrr = ( max( wrapNL - dotNL, 0.0 ) + backT ) * sssAmt * directLight.color * sssColor;
  reflectedLight.directDiffuse += ( irradiance + sssIrr ) * BRDF_Lambert( material.diffuseColor );`));
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|foodSSS';
  (m.userData as any).sss = u;
  m.needsUpdate = true;
  return m;
}

// ------------------------------------------------------------------ relief photo meshes

const HM = 64;
const heights = new Map<string, Float32Array>();
const heightWait = new Map<string, Promise<Float32Array | null>>();
let reliefMeta: Record<string, { yolk?: [number, number, number] }> = {};

export const RELIEF_NAMES = [
  'egg_fried_crispy', 'egg_fried_runny', 'egg_fried_burnt', 'rice_mound_top', 'basil_bunch_fresh', 'basil_bunch_cooked', 'chili_red_bunch',
  'chili_green_pile', 'garlic_bulbs_bunch', 'garlic_crushed', 'garlic_minced_pile', 'shrimp_raw_pile', 'omelette_whole', 'long_beans_bundle',
  'kale_leaf', 'onion_slices', 'shallots_sliced',
];

function loadHeight(name: string): Promise<Float32Array | null> {
  let p = heightWait.get(name);
  if (!p) {
    p = Assets.image(GEN + 'relief/' + name + '_h.png').then((img) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = HM;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, HM, HM);
      const d = ctx.getImageData(0, 0, HM, HM).data;
      const out = new Float32Array(HM * HM);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
      heights.set(name, out);
      return out;
    }).catch(() => null);
    heightWait.set(name, p);
  }
  return p;
}

/** Preload all relief height maps + meta (call from init; tiny files). */
export async function preloadRealFood() {
  reliefMeta = (await Assets.jsonSafe<any>(GEN + 'relief/meta.json', {})) ?? {};
  await Promise.all(RELIEF_NAMES.map(loadHeight));
}

/** bilinear sample, (u, v) with v = 0 at the TOP row of the image */
function sampleH(h: Float32Array, u: number, v: number) {
  const x = Math.min(HM - 1.001, Math.max(0, u * (HM - 1))), y = Math.min(HM - 1.001, Math.max(0, v * (HM - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = h[y0 * HM + x0], b = h[y0 * HM + x0 + 1], c = h[(y0 + 1) * HM + x0], d = h[(y0 + 1) * HM + x0 + 1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function reliefHeightAt(name: string, u: number, vTop: number) {
  const h = heights.get(name);
  return h ? sampleH(h, u, vTop) : 0;
}

export function yolkInfo(name: string): [number, number, number] {
  return (reliefMeta[name]?.yolk as [number, number, number]) ?? [0.5, 0.52, 0.11];
}

function displace(g: THREE.BufferGeometry, h: Float32Array, hmax: number, curl: number, w: number, d: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const x = pos.getX(i), z = pos.getZ(i);
    const r2 = (x / (w / 2)) ** 2 + (z / (d / 2)) ** 2;
    pos.setY(i, sampleH(h, u, 1 - v) * hmax + curl * r2 * hmax);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/**
 * Real photo cut-out displaced into a lumpy relief (decimated-photoscan look). Lies in XZ, image top
 * → -Z, origin at the centre of the base. `curl` lifts the rim (cupped leaves, curling egg lace).
 */
export function reliefGeo(name: string, w: number, d: number, hmax: number, seg = 24, curl = 0): THREE.BufferGeometry {
  return gc(`relief:${name}:${w}:${d}:${hmax}:${seg}:${curl}`, () => {
    const g = new THREE.PlaneGeometry(w, d, seg, seg);
    g.rotateX(-Math.PI / 2);
    const h = heights.get(name);
    if (h) displace(g, h, hmax, curl, w, d);
    else loadHeight(name).then((hh) => { if (hh) displace(g, hh, hmax, curl, w, d); });
    return g;
  });
}

export function reliefNormal(name: string) {
  return Assets.texture(GEN + 'relief/' + name + '_n.jpg', { srgb: false, wrap: false });
}

export interface ReliefMatOpts { rough?: number; color?: THREE.ColorRepresentation; sss?: SSSOpts; nScale?: number; clearcoat?: number; ccRough?: number; alphaTest?: number }

/** Shared material for a relief photo (photo map + photo-derived normal map, alpha cut-out). */
export function reliefMat(key: string, name: string, map: THREE.Texture, o: ReliefMatOpts = {}) {
  return cachedMat('relief:' + key, () => {
    const P = o.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const m = new P({ map, normalMap: reliefNormal(name), alphaTest: o.alphaTest ?? 0.42, side: THREE.DoubleSide, roughness: o.rough ?? 0.5, color: o.color ?? 0xffffff, metalness: 0 });
    m.normalScale.set(o.nScale ?? 1, o.nScale ?? 1);
    if (o.clearcoat && m instanceof THREE.MeshPhysicalMaterial) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = o.ccRough ?? 0.3; }
    if (o.sss) withSSS(m, o.sss);
    return m;
  });
}

// ------------------------------------------------------------------ photo textures (own processed files)

export const RT = {
  leaf: () => Assets.texture(GEN + 'leaf_basil.png', { srgb: true, wrap: false }),
  leafN: () => Assets.texture(GEN + 'leaf_basil_n.jpg', { srgb: false, wrap: false }),
  chiliRed: () => Assets.texture(GEN + 'chili_red_strip.jpg', { srgb: true, wrap: false }),
  chiliRedN: () => Assets.texture(GEN + 'chili_red_strip_n.jpg', { srgb: false, wrap: false }),
  chiliGreen: () => Assets.texture(GEN + 'chili_green_strip.jpg', { srgb: true, wrap: false }),
  chiliGreenN: () => Assets.texture(GEN + 'chili_green_strip_n.jpg', { srgb: false, wrap: false }),
  shell: () => Assets.texture(GEN + 'egg_shell.jpg', { srgb: true, repeat: [2, 1] }),
  shellN: () => Assets.texture(GEN + 'egg_shell_n.jpg', { srgb: false, repeat: [2, 1] }),
  fried: (v: EggVariant) => (v === 'burnt' ? T.eggBurnt() : v === 'crispy' ? T.eggCrispy() : T.eggRunny()),
};

// ------------------------------------------------------------------ basil leaves (3D, real leaf photo)

/**
 * One leaf: a folded (midrib V), curled, slightly twisted grid; the real leaf photo's alpha gives the
 * outline. Stem end at the origin, tip along +X. `t0` skips the cut base of the photo crop.
 */
export function leafGeo(len: number, wid: number, o: { fold?: number; curl?: number; twist?: number; droop?: number } = {}) {
  const NA = 5, NC = 3;
  const fold = o.fold ?? 0.35, curl = o.curl ?? 0.22, twist = o.twist ?? 0.15, droop = o.droop ?? 0;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const t0 = 0.12;
  for (let i = 0; i <= NA; i++) {
    const a = i / NA;
    for (let j = 0; j <= NC; j++) {
      const c = j / NC - 0.5; // -0.5..0.5 across
      const x = a * len;
      const z = c * wid;
      let y = Math.abs(c) * 2 * wid * fold * 0.5 * Math.sin(Math.PI * Math.min(1, a * 1.2 + 0.1));
      y += Math.sin(a * Math.PI * 0.9) * len * curl * 0.35 - a * a * len * droop;
      const tw = twist * a;
      pos.push(x, y * Math.cos(tw) - z * Math.sin(tw) * 0.3, z * Math.cos(tw) + y * Math.sin(tw) * 0.3);
      uv.push(j / NC, t0 + a * (1 - t0));
    }
  }
  for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
    const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Merge many leaves (rosette / pile / wilted scatter). */
export function leafScatter(key: string, n: number, place: (i: number, m: THREE.Matrix4, r: () => number) => { len: number; wid: number; curl?: number; droop?: number }, seed = 1) {
  return gc('leaves:' + key, () => {
    const r = mulberry(seed);
    const parts: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.identity();
      const s = place(i, m, r);
      const g = leafGeo(s.len, s.wid, { curl: s.curl ?? 0.15 + r() * 0.2, twist: (r() - 0.5) * 0.6, droop: s.droop ?? 0, fold: 0.25 + r() * 0.3 });
      parts.push(g.applyMatrix4(m));
    }
    return mergeSimple(parts);
  });
}

export function leafMat(state: 'fresh' | 'cooked' | 'soggy' | 'burnt' = 'fresh') {
  const col = state === 'fresh' ? 0xffffff : state === 'cooked' ? 0x7f9468 : state === 'soggy' ? 0x5c6a48 : 0x3a3428;
  return cachedMat('basilLeaf:' + state, () => withSSS(new THREE.MeshStandardMaterial({
    map: RT.leaf(), normalMap: RT.leafN(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: state === 'fresh' ? 0.42 : 0.3, color: col,
  }), { color: state === 'fresh' ? 0x9be05a : 0x6a8a3a, wrap: 0.6, back: state === 'fresh' ? 0.9 : 0.4 }));
}

// ------------------------------------------------------------------ bird's-eye chilies (3D)

/** A curved, tapered chili body (stem end at origin, along +X) mapped with the straightened photo strip. */
export function chiliGeo(len = 0.042, r = 0.0042, bend = 0.25, seed = 1) {
  const NA = 9, NR = 6;
  const rnd = mulberry(seed);
  const side = (rnd() - 0.5) * 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const P = (t: number) => new THREE.Vector3(t * len, Math.sin(t * Math.PI) * bend * len * 0.15, side * t * t * bend * len * 0.5);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= NA; i++) {
    const t = i / NA;
    const c = P(t), tg = P(Math.min(1, t + 0.01)).sub(P(Math.max(0, t - 0.01))).normalize();
    const nx = new THREE.Vector3().crossVectors(tg, up).normalize(), ny = new THREE.Vector3().crossVectors(nx, tg).normalize();
    const prof = t < 0.12 ? 0.72 + t * 2.3 : Math.max(0.04, 1 - Math.pow((t - 0.12) / 0.88, 2.4));
    const rr = r * prof;
    for (let j = 0; j <= NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const v = new THREE.Vector3().addScaledVector(nx, Math.cos(a) * rr).addScaledVector(ny, Math.sin(a) * rr * 0.92).add(c);
      pos.push(v.x, v.y, v.z);
      const s = j / NR, across = s < 0.5 ? s * 2 : (1 - s) * 2;
      uv.push(across, 1 - t * 0.94 - 0.03);
    }
  }
  for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // little green stem stub (same strip's stem rows)
  const st = new THREE.CylinderGeometry(r * 0.22, r * 0.3, len * 0.18, 4, 1);
  st.rotateZ(Math.PI / 2);
  st.translate(-len * 0.08, 0, 0);
  const suv = st.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, 0.5, 0.995);
  return mergeSimple([g.toNonIndexed(), st.toNonIndexed()]);
}

export function chiliMat(color: 'red' | 'green', cooked = 0) {
  const k = Math.round(cooked * 2) / 2;
  return cachedMat(`chili:${color}:${k}`, () => {
    const m = new THREE.MeshPhysicalMaterial({
      map: color === 'red' ? RT.chiliRed() : RT.chiliGreen(), normalMap: color === 'red' ? RT.chiliRedN() : RT.chiliGreenN(),
      roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25, color: k > 0 ? new THREE.Color(1 - k * 0.3, 1 - k * 0.4, 1 - k * 0.35) : 0xffffff,
    });
    return withSSS(m, { color: color === 'red' ? 0xff3a1a : 0x7acc3a, wrap: 0.45, back: 0.6 });
  });
}

/** Pile of chilies (merged), `nRed` red + `nGreen` green, scattered in a heap of radius `rad`. */
export function chiliPile(key: string, nRed: number, nGreen: number, rad: number, seed = 3) {
  const mk = (n: number, s: number) => gc(`chiliPile:${key}:${n}:${s}`, () => {
    const r = mulberry(s);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = chiliGeo(0.036 + r() * 0.016, 0.0046 + r() * 0.0016, 0.15 + r() * 0.35, s * 31 + i);
      const a = r() * 6.28, rr = Math.sqrt(r()) * rad;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.35));
      m.setPosition(Math.cos(a) * rr - 0.02, 0.004 + (1 - rr / rad) * 0.012 + r() * 0.006, Math.sin(a) * rr);
      parts.push(g.applyMatrix4(m));
    }
    return mergeSimple(parts);
  });
  return { red: nRed ? mk(nRed, seed) : null, green: nGreen ? mk(nGreen, seed + 17) : null };
}

/** Short chili pieces / rings for stir-fries (cut chili, both colours). */
export function chiliBits(key: string, n: number, rad: number, seed = 5) {
  return gc('chiliBits:' + key + n + rad, () => {
    const r = mulberry(seed);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = chiliGeo(0.014 + r() * 0.01, 0.0045, 0.1, seed * 7 + i);
      const a = r() * 6.28, rr = Math.sqrt(r()) * rad;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
      m.setPosition(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      parts.push(g.applyMatrix4(m));
    }
    return mergeSimple(parts);
  });
}

// ------------------------------------------------------------------ eggs

export function eggGeo() {
  return gc('egg3d', () => {
    const prof: [number, number][] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // bottom (blunt) → top (pointy)
      const y = t * 0.057;
      const s = Math.sin(Math.PI * t);
      const r = 0.0215 * Math.pow(s, 0.85) * (1 - 0.13 * t) + (i === 0 || i === N ? 0 : 0.0004);
      prof.push([Math.max(0.0001, r), y]);
    }
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 16);
    g.computeVertexNormals();
    return g;
  });
}

/** a free egg lies on its side (long axis along X), resting on the counter */
export function eggGeoLying() {
  return gc('egg3dLying', () => {
    const g = eggGeo().clone();
    g.translate(0, -0.0285, 0);
    g.rotateZ(Math.PI / 2 + 0.08);
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox!.min.y, 0);
    return g;
  });
}

export function eggShellMat(variant = 0) {
  const tints = [0xfff4ec, 0xffeee2, 0xf2e6dc];
  return cachedMat('eggShell3d:' + (variant % 3), () => withSSS(new THREE.MeshStandardMaterial({
    map: RT.shell(), normalMap: RT.shellN(), roughness: 0.55, color: tints[variant % 3],
  }), { color: 0xffc89a, wrap: 0.35, back: 0.25 }));
}

// ------------------------------------------------------------------ ไข่ดาว (fried egg)

export type EggVariant = 'crispy' | 'runny' | 'burnt';
const EGG_NAME: Record<EggVariant, string> = { crispy: 'egg_fried_crispy', runny: 'egg_fried_runny', burnt: 'egg_fried_burnt' };

/** `curl` > 0 lifts the lacy rim (in a wok / flat plate), < 0 drapes it over a rice mound */
export function friedWhiteGeo(v: EggVariant, size = 0.14, curl = 0.18) {
  return reliefGeo(EGG_NAME[v], size, size, size * 0.075, 26, curl);
}

/** Domed yolk exactly over the photo's yolk, UVs projected from the top so the photo lines up. */
export function yolkGeo(v: EggVariant, size = 0.14) {
  return gc(`yolk:${v}:${size}`, () => {
    const [u, vv, R] = yolkInfo(EGG_NAME[v]);
    const r = R * size * 0.98, hdome = r * (v === 'runny' ? 0.62 : 0.5);
    const prof: [number, number][] = [];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push([Math.max(0.0001, Math.cos(a) * r * (1 + 0.04 * (1 - i / 6))), Math.sin(a) * hdome]); }
    prof.reverse();
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18);
    const cx = (u - 0.5) * size, cz = (0.5 - vv) * size;
    g.translate(cx, 0, cz);
    const pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / size + 0.5, 0.5 - pos.getZ(i) / size);
    g.computeVertexNormals();
    return g;
  });
}

/** where the yolk sits (local x, base height, z) for a white of `size` */
export function yolkBase(v: EggVariant, size = 0.14): [number, number, number] {
  const [u, vv] = yolkInfo(EGG_NAME[v]);
  const hmax = size * 0.075;
  const r2 = 0; void r2;
  return [(u - 0.5) * size, reliefHeightAt(EGG_NAME[v], u, 1 - vv) * hmax * 0.8, (0.5 - vv) * size];
}

export function friedWhiteMat(v: EggVariant, key = '') {
  return reliefMat('eggWhite:' + v + key, EGG_NAME[v], RT.fried(v), {
    rough: v === 'burnt' ? 0.55 : 0.34, sss: { color: 0xfff3dc, wrap: 0.5, back: 0.55 }, nScale: 1.2, alphaTest: 0.4,
  });
}

export function yolkMat(v: EggVariant, key = '') {
  return cachedMat('yolk:' + v + key, () => {
    const m = new THREE.MeshPhysicalMaterial({ map: RT.fried(v), roughness: 0.2, clearcoat: 1, clearcoatRoughness: v === 'runny' ? 0.06 : 0.18, color: 0xffffff });
    return withSSS(m, { color: 0xff9a1a, wrap: 0.6, back: 0.8, amt: 1.2 });
  });
}

/** A ready fried egg (white relief + yolk named 'yolk' for the jiggle). Origin centre-bottom. */
export function buildFriedEgg(v: EggVariant, size = 0.14, curl = 0.18) {
  const g = new THREE.Group();
  g.name = 'friedEgg';
  const w = new THREE.Mesh(friedWhiteGeo(v, size, curl), friedWhiteMat(v));
  w.name = 'white';
  const yolk = new THREE.Group();
  yolk.name = 'yolk';
  const b = yolkBase(v, size);
  yolk.position.set(b[0], b[1], b[2]);
  const ym = new THREE.Mesh(yolkGeo(v, size), yolkMat(v));
  ym.position.set(-b[0], 0, -b[2]);
  yolk.add(ym);
  g.add(w, yolk);
  return g;
}

// ------------------------------------------------------------------ rice mound

export function riceMoundGeoReal() { return reliefGeo('rice_mound_top', 0.155, 0.155, 0.036, 24, 0); }
export function riceMatReal() {
  return reliefMat('riceMound', 'rice_mound_top', T.riceMound(), { rough: 0.6, sss: { color: 0xfff8ec, wrap: 0.25, back: 0.2 }, nScale: 1.6, alphaTest: 0.35 });
}

// ------------------------------------------------------------------ Poly Haven food scans (late-bound)

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const phDone = new Map<string, Promise<void>>();

export interface PHModel { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }
const phModels = new Map<string, PHModel>();

/**
 * A Poly Haven scan as {geometry, material} available immediately: `placeholder` geometry first, its
 * attributes are swapped in place for the real scan (normalised to the placeholder's bounds so the
 * physics collider fitted on the first spawn stays right) and the material gets the scan's maps.
 */
export function phModel(id: string, placeholder: () => THREE.BufferGeometry, o: { rot?: [number, number, number]; tint?: THREE.ColorRepresentation; rough?: number; sss?: SSSOpts } = {}): PHModel {
  let pm = phModels.get(id);
  if (pm) return pm;
  const geo = placeholder();
  geo.computeBoundingBox();
  const target = geo.boundingBox!.clone();
  const mat = new THREE.MeshStandardMaterial({ color: o.tint ?? 0xffffff, roughness: o.rough ?? 1 });
  if (o.sss) withSSS(mat, o.sss);
  pm = { geo, mat };
  phModels.set(id, pm);
  if (!phDone.has(id)) phDone.set(id, loader.loadAsync(Assets.url(GEN + `models/${id}/${id}.glb`)).then((gl) => {
    let src: THREE.Mesh | null = null;
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse((m: any) => { if (m.isMesh && !src) src = m; });
    if (!src) return;
    const s = src as THREE.Mesh;
    const fg = floatGeom(s.geometry, s.matrixWorld);
    if (o.rot) fg.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)));
    fg.computeBoundingBox();
    const bb = fg.boundingBox!, size = bb.getSize(new THREE.Vector3()), tsz = target.getSize(new THREE.Vector3());
    const k = Math.min(tsz.x / size.x, tsz.y / size.y, tsz.z / size.z);
    const c = bb.getCenter(new THREE.Vector3());
    fg.translate(-c.x, -bb.min.y, -c.z);
    fg.scale(k, k, k);
    fg.translate((target.min.x + target.max.x) / 2, target.min.y, (target.min.z + target.max.z) / 2);
    for (const name of Object.keys(geo.attributes)) if (!fg.getAttribute(name)) geo.deleteAttribute(name);
    for (const name of ['position', 'normal', 'uv']) { const a = fg.getAttribute(name); if (a) geo.setAttribute(name, a); }
    geo.setIndex(fg.index);
    geo.clearGroups();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const sm = s.material as THREE.MeshStandardMaterial;
    mat.map = sm.map ?? null; mat.normalMap = sm.normalMap ?? null; mat.roughnessMap = sm.roughnessMap ?? null;
    if (mat.map) { mat.map.anisotropy = 4; mat.map.colorSpace = THREE.SRGBColorSpace; }
    mat.roughness = o.rough ?? 1;
    mat.needsUpdate = true;
  }).catch((e) => console.warn('[cooking] scan', id, e)));
  return pm;
}

function floatGeom(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const n = a.itemSize, out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  g.applyMatrix4(m);
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nor) { for (let i = 0; i < nor.count; i++) { const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i); const l = Math.hypot(x, y, z) || 1; nor.setXYZ(i, x / l, y / l, z / l); } }
  else g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ misc geometry helpers

/** merge non-indexed position/normal/uv geometries (cheap, no attribute checks) */
export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      P[(o + i) * 3] = p.getX(i); P[(o + i) * 3 + 1] = p.getY(i); P[(o + i) * 3 + 2] = p.getZ(i);
      N[(o + i) * 3] = nn.getX(i); N[(o + i) * 3 + 1] = nn.getY(i); N[(o + i) * 3 + 2] = nn.getZ(i);
      if (uv) { U[(o + i) * 2] = uv.getX(i); U[(o + i) * 2 + 1] = uv.getY(i); }
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return g;
}

/**
 * Crumbly chunks (stir-fry crumbs, mince bits) as a merged geometry: little faceted noise rocks spread
 * over a mound of radius r / height h, UVs projected from the top (u = x, v = -z, scale `uvs`).
 */
export function chunkScatter(key: string, n: number, r: number, h: number, size: number, uvs: number, seed = 1) {
  return gc(`chunks:${key}:${n}:${r}:${h}:${size}`, () => {
    const rnd = mulberry(seed);
    const base = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = base.clone();
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const s = size * (0.6 + rnd() * 0.8), sd = rnd() * 100;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const f = 1 + fbm3(x * 1.3 + sd, y * 1.3, z * 1.3 - sd, 2) * 0.55;
        pos.setXYZ(k, x * s * f * (1 + rnd() * 0.3), y * s * f * 0.6, z * s * f);
      }
      const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * r * 0.92;
      const hy = h * Math.max(0, 1 - (rr / r) ** 2) ** 0.7;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 6.28, rnd() * 0.6));
      m.setPosition(Math.cos(a) * rr, hy - size * 0.15, Math.sin(a) * rr);
      g.applyMatrix4(m);
      parts.push(g);
    }
    const out = mergeSimple(parts);
    const p = out.getAttribute('position');
    const uv = out.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * uvs + 0.5, -p.getZ(i) * uvs + 0.5);
    out.computeVertexNormals();
    return out;
  });
}
