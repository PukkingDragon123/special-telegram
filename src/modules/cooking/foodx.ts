import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ItemDef } from '../../game/items';
import { Assets } from '../../core/assets';
import { M, mesh, gc } from './mats';
import { cachedMat } from './assets';
import { lathe, mound, rbox, scatter, merge, planarUV, tube } from './geo';
import { buildWok } from './models-tools';
import { withSSS } from './realfood';
import { ING, TOOL_META } from './data';

/* =============================================================================================
 * ROUND 5 food: seafood stall goods, premium ingredients, dessert ingredients + the stainless
 * dessert basin (กะละมังผสมขนม — a "cold wok": no fire, desserts are assembled in it, then plated).
 *
 * Hero scans (Sketchfab, see public/assets/gen/cooking/models/CREDITS.md): blue manna crab, river
 * prawn, whole fish (CC0 ffish.asia photogrammetry), mango (CC-BY Meerschaum Digital). They load
 * async into an empty group (`scan()`), auto-oriented: longest axis → X, shortest → Y (lying flat).
 * Everything else is modelled here (shells, squid, slices, tubs, cans, cartons) with canvas labels.
 * ============================================================================================= */

const G = () => new THREE.Group();
const GEN = 'gen/cooking/';

// ------------------------------------------------------------------ scans

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
interface Scan { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }
const scans = new Map<string, Promise<Scan | null>>();

function loadScan(id: string, url: string, rough: number, sss?: number): Promise<Scan | null> {
  let p = scans.get(id);
  if (p) return p;
  p = loader.loadAsync(url).then((gl) => {
    gl.scene.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null, best = 0;
    gl.scene.traverse((m: any) => {
      if (!m.isMesh) return;
      const n = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.getAttribute('position').count / 3;
      if (n < 60) return; // scale bars / platforms in the photogrammetry files
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'uv']) {
        const a = m.geometry.getAttribute(name);
        if (!a) continue;
        const out = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
        g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      }
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array as ArrayLike<number>));
      g.applyMatrix4(m.matrixWorld);
      parts.push(g.index ? g.toNonIndexed() : g);
      if (n > best && m.material?.map) { best = n; map = m.material.map; }
    });
    if (!parts.length) return null;
    const geo = merge(parts);
    // orient: longest extent → X, shortest → Y (the thing lies flat), centred, sitting on y = 0
    geo.computeBoundingBox();
    const s = geo.boundingBox!.getSize(new THREE.Vector3());
    const ax = [['x', s.x], ['y', s.y], ['z', s.z]].sort((a, b) => (b[1] as number) - (a[1] as number)).map((a) => a[0]);
    const R = new THREE.Matrix4();
    const basis: Record<string, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    // rows: new X = old longest, new Z = old middle, new Y = old shortest
    const L = basis[ax[0]], Mi = basis[ax[1]], S = basis[ax[2]];
    R.set(L.x, L.y, L.z, 0, S.x, S.y, S.z, 0, Mi.x, Mi.y, Mi.z, 0, 0, 0, 0, 1);
    if (R.determinant() < 0) R.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));
    geo.applyMatrix4(R);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, c = bb.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -bb.min.y, -c.z);
    geo.computeBoundingBox();
    const len = geo.boundingBox!.getSize(new THREE.Vector3()).x || 1;
    geo.scale(1 / len, 1 / len, 1 / len); // unit length along X
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0 });
    if (map) { (map as THREE.Texture).colorSpace = THREE.SRGBColorSpace; (map as THREE.Texture).anisotropy = 4; }
    if (sss) withSSS(mat, { color: 0xffb8a0, wrap: sss, back: sss * 0.6 });
    return { geo, mat };
  }).catch((e) => { console.warn('[cooking] scan', id, e); return null; });
  scans.set(id, p);
  return p;
}

/** A scan placed at `len` metres long (async: the group fills in when the GLB arrives). */
export function scan(id: string, len: number, pos: [number, number, number], yaw = 0, o: { rough?: number; sss?: number; url?: string; tilt?: number; tint?: number } = {}) {
  const g = G();
  g.position.set(...pos);
  g.rotation.set(o.tilt ?? 0, yaw, 0);
  g.scale.setScalar(len);
  loadScan(id, o.url ?? Assets.url(GEN + `models/${id}/${id}.glb`), o.rough ?? 0.5, o.sss).then((s) => {
    if (!s) return;
    let mat = s.mat;
    if (o.tint != null) mat = cachedMat(`scanTint:${id}:${o.tint}`, () => { const c = s.mat.clone(); c.color.setHex(o.tint!); return c; }) as THREE.MeshStandardMaterial;
    const m = new THREE.Mesh(s.geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

// ------------------------------------------------------------------ canvas labels

const labelTexCache = new Map<string, THREE.CanvasTexture>();
function labelTex(key: string, th: string, en: string, bg: string, fg: string, accent = '#ffffff', w = 256, h = 160) {
  let t = labelTexCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  // read back below (paper grain): a CPU canvas avoids a synchronous GPU readback per label during the world build
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, bg); gr.addColorStop(1, shade(bg, -0.18));
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
  x.fillStyle = accent; x.globalAlpha = 0.9; x.fillRect(0, h * 0.68, w, h * 0.08); x.globalAlpha = 1;
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `800 ${Math.round(h * 0.26)}px "Noto Sans Thai Looped", sans-serif`;
  x.fillText(th, w / 2, h * 0.36, w * 0.92);
  x.font = `600 ${Math.round(h * 0.12)}px "Noto Sans Thai Looped", sans-serif`;
  x.globalAlpha = 0.85; x.fillText(en.toUpperCase(), w / 2, h * 0.86, w * 0.9); x.globalAlpha = 1;
  // printed-paper grain
  const id = x.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  x.putImageData(id, 0, 0);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  labelTexCache.set(key, t);
  return t;
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
export const labelMat = (key: string, th: string, en: string, bg: string, fg: string, accent?: string, rough = 0.45) =>
  cachedMat('fxlabel:' + key, () => new THREE.MeshStandardMaterial({ map: labelTex(key, th, en, bg, fg, accent), roughness: rough, metalness: 0 }));

/** speckle / pattern canvas textures for food surfaces */
const patTexCache = new Map<string, THREE.CanvasTexture>();
export function patTex(key: string, size: number, draw: (x: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  let t = patTexCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  patTexCache.set(key, t);
  return t;
}
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// ------------------------------------------------------------------ materials

export const MX = {
  ice: () => cachedMat('fx:ice', () => { const m = new THREE.MeshStandardMaterial({ color: 0xe8f4fa, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.86 }); return m; }),
  squid: () => cachedMat('fx:squid', () => withSSS(new THREE.MeshStandardMaterial({
    map: patTex('squidskin', 256, (x, s) => { x.fillStyle = '#f1e6e8'; x.fillRect(0, 0, s, s); const r = rnd(7); for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${120 + r() * 60},${40 + r() * 30},${70 + r() * 50},${0.25 + r() * 0.5})`; x.beginPath(); x.arc(r() * s, r() * s, 0.6 + r() * 2.4, 0, 7); x.fill(); } }, 2),
    roughness: 0.22, metalness: 0 }), { color: 0xffd8e0, wrap: 0.6, back: 0.5 })),
  musselShell: () => cachedMat('fx:mussel', () => new THREE.MeshStandardMaterial({
    map: patTex('musselshell', 128, (x, s) => { const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#16201a'); g.addColorStop(0.7, '#1f3a26'); g.addColorStop(1, '#4f8a3a'); x.fillStyle = g; x.fillRect(0, 0, s, s); x.strokeStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 18; i++) { x.beginPath(); x.moveTo(0, i * s / 18); x.lineTo(s, i * s / 18 + 4); x.stroke(); } }),
    roughness: 0.16, metalness: 0.15 })),
  clamShell: () => cachedMat('fx:clam', () => new THREE.MeshStandardMaterial({
    map: patTex('clamshell', 128, (x, s) => { x.fillStyle = '#d9c7a4'; x.fillRect(0, 0, s, s); x.strokeStyle = '#6a4a2e'; x.lineWidth = 2.2; for (let k = 0; k < 9; k++) { x.beginPath(); for (let i = 0; i <= 16; i++) { const px = i * s / 16, py = k * s / 9 + (i % 2 ? 5 : -5); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); } }),
    roughness: 0.4, metalness: 0 })),
  oyster: () => cachedMat('fx:oyster', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.12, metalness: 0 }), { color: 0xe8e0d0, wrap: 0.6, back: 0.4 })),
  salmon: () => cachedMat('fx:salmon', () => withSSS(new THREE.MeshStandardMaterial({
    map: patTex('salmonflesh', 256, (x, s) => { x.fillStyle = '#f2763e'; x.fillRect(0, 0, s, s); x.strokeStyle = 'rgba(255,236,220,0.85)'; x.lineWidth = 3; for (let i = -4; i < 14; i++) { x.beginPath(); x.moveTo(i * s / 10, 0); x.quadraticCurveTo(i * s / 10 + 30, s / 2, i * s / 10 - 10, s); x.stroke(); } }),
    roughness: 0.25 }), { color: 0xff9060, wrap: 0.5, back: 0.4 })),
  wagyu: () => cachedMat('fx:wagyu', () => new THREE.MeshStandardMaterial({
    map: patTex('wagyu', 256, (x, s) => { x.fillStyle = '#b8323a'; x.fillRect(0, 0, s, s); const r = rnd(11); x.strokeStyle = 'rgba(255,240,236,0.9)'; for (let i = 0; i < 220; i++) { x.lineWidth = 0.6 + r() * 2.2; x.beginPath(); const a = r() * s, b = r() * s; x.moveTo(a, b); x.bezierCurveTo(a + r() * 30 - 15, b + r() * 30 - 15, a + r() * 30 - 15, b + r() * 30 - 15, a + r() * 40 - 20, b + r() * 40 - 20); x.stroke(); } }),
    roughness: 0.32 })),
  scallop: () => cachedMat('fx:scallop', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xf4ead8, roughness: 0.2 }), { color: 0xfff0dc, wrap: 0.6, back: 0.4 })),
  crabMeat: () => cachedMat('fx:crabmeat', () => new THREE.MeshStandardMaterial({
    map: patTex('crabmeat', 128, (x, s) => { x.fillStyle = '#f6efe4'; x.fillRect(0, 0, s, s); const r = rnd(5); for (let i = 0; i < 140; i++) { x.strokeStyle = `rgba(232,${90 + r() * 60},60,${0.3 + r() * 0.5})`; x.lineWidth = 1 + r() * 2; x.beginPath(); const a = r() * s, b = r() * s; x.moveTo(a, b); x.lineTo(a + r() * 16 - 8, b + r() * 6); x.stroke(); } }),
    roughness: 0.4 })),
  stickyRice: () => cachedMat('fx:sticky', () => new THREE.MeshStandardMaterial({
    map: patTex('stickyrice', 256, (x, s) => { x.fillStyle = '#f3efe2'; x.fillRect(0, 0, s, s); const r = rnd(3); for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(${235 + r() * 20},${232 + r() * 20},${215 + r() * 25},0.9)`; x.save(); x.translate(r() * s, r() * s); x.rotate(r() * 6.3); x.beginPath(); x.ellipse(0, 0, 3.4, 1.4, 0, 0, 7); x.fill(); x.restore(); } }, 1),
    roughness: 0.3 })),
  dough: () => cachedMat('fx:dough', () => new THREE.MeshStandardMaterial({ color: 0xf2e2c2, roughness: 0.25, metalness: 0 })),
  ruby: () => cachedMat('fx:ruby', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.15, transparent: true, opacity: 0.94 }), { color: 0xff3050, wrap: 0.6, back: 0.6 })),
  pandan: () => cachedMat('fx:pandan', () => withSSS(new THREE.MeshStandardMaterial({ color: 0x4fae3a, roughness: 0.18, transparent: true, opacity: 0.95 }), { color: 0x80e060, wrap: 0.6, back: 0.6 })),
  coconutCream: () => cachedMat('fx:ccream', () => new THREE.MeshStandardMaterial({ color: 0xfbf8ef, roughness: 0.2, metalness: 0 })),
  icecream: () => cachedMat('fx:icecream', () => new THREE.MeshStandardMaterial({
    map: patTex('icecream', 128, (x, s) => { x.fillStyle = '#f8f5ea'; x.fillRect(0, 0, s, s); const r = rnd(9); for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(210,200,170,${r() * 0.35})`; x.beginPath(); x.arc(r() * s, r() * s, 1 + r() * 3, 0, 7); x.fill(); } }),
    roughness: 0.55 })),
  peanut: () => cachedMat('fx:peanut', () => new THREE.MeshStandardMaterial({ color: 0xc58a4a, roughness: 0.55 })),
  balls: (i: number) => cachedMat('fx:bualoi' + i, () => new THREE.MeshStandardMaterial({ color: [0xf4f0e6, 0xf2b7c8, 0x9fd38a, 0xf7d36a][i % 4], roughness: 0.3 })),
  bananaPeel: () => cachedMat('fx:banana', () => new THREE.MeshStandardMaterial({ color: 0xe8c64a, roughness: 0.5 })),
  can: (key: string, th: string, en: string, bg: string, fg: string) => labelMat('can:' + key, th, en, bg, fg, '#d8d8d8', 0.3),
  tubLid: (hex: number) => cachedMat('fx:lid' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35 })),
  foil: () => cachedMat('fx:foil', () => new THREE.MeshStandardMaterial({ color: 0xe8c86a, roughness: 0.3, metalness: 0.8 })),
  palm: () => cachedMat('fx:palm', () => new THREE.MeshStandardMaterial({ color: 0x9a5a24, roughness: 0.5 })),
  sprout: () => cachedMat('fx:sprout', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xf2efdc, roughness: 0.35 }), { color: 0xfff8d0, wrap: 0.5, back: 0.4 })),
  saltedEgg: () => cachedMat('fx:segg', () => new THREE.MeshStandardMaterial({ color: 0xe9f0f2, roughness: 0.55 })),
};

// ------------------------------------------------------------------ shared geometry

const foamTrayGeo = (W: number, D: number, H: number) => gc(`fxTray${W}${D}`, () => {
  const g = rbox(W, H, D, 0.012, 1);
  g.translate(0, H / 2, 0);
  return g;
});
function tray(W = 0.22, D = 0.15, H = 0.022, dark = false) {
  const g = G();
  g.add(mesh(foamTrayGeo(W, D, H), dark ? M.black() : M.foam()));
  return g;
}
function iceBed(W: number, D: number, y: number, seed = 1) {
  return mesh(gc(`fxIce${W}${D}${seed}`, () => scatter(new THREE.IcosahedronGeometry(0.009, 0), Math.round(W * D * 5200), (_i, m, r) => {
    m.makeRotationFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6));
    m.setPosition((r() - 0.5) * W, y + r() * 0.012, (r() - 0.5) * D);
    m.scale(new THREE.Vector3(0.6 + r() * 0.9, 0.5 + r() * 0.6, 0.6 + r() * 0.9));
  }, seed)), MX.ice());
}
const filmLid = (W: number, D: number, y: number) => mesh(gc(`fxFilm${W}${D}${y}`, () => rbox(W + 0.004, 0.002, D + 0.004, 0.001, 1).translate(0, y, 0)), M.film());
function sticker(key: string, th: string, en: string, bg: string, fg: string, pos: [number, number, number], w = 0.07) {
  return mesh(gc('fxSticker' + w, () => new THREE.PlaneGeometry(w, w * 0.62)), labelMat(key, th, en, bg, fg), pos, [-Math.PI / 2, 0, 0.1]);
}
/** clear deli tub with a coloured lid */
function tub(r: number, h: number, lid: number, content?: THREE.Object3D) {
  const g = G();
  g.add(mesh(gc(`fxTub${r}${h}`, () => lathe([[0.0001, 0], [r * 0.86, 0], [r, h], [r * 1.04, h]], 20)), M.bagClear(0xffffff, 0.28)));
  g.add(mesh(gc(`fxTubLid${r}${h}`, () => new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.008, 22).translate(0, h + 0.004, 0)), MX.tubLid(lid)));
  if (content) { content.name = 'heap'; g.add(content); }
  return g;
}
/** tin can with a printed wrap label */
function can(r: number, h: number, mat: THREE.Material) {
  const g = G();
  g.add(mesh(gc(`fxCan${r}${h}`, () => { const c = new THREE.CylinderGeometry(r, r, h * 0.9, 24, 1, true); c.translate(0, h / 2, 0); return c; }), mat));
  g.add(mesh(gc(`fxCanEnds${r}${h}`, () => merge([new THREE.CylinderGeometry(r * 0.97, r * 0.97, h * 0.05, 24).translate(0, h * 0.025, 0), new THREE.CylinderGeometry(r * 0.97, r * 0.97, h * 0.05, 24).translate(0, h * 0.975, 0)])), M.alu()));
  return g;
}
/** paper / laminated carton */
function carton(w: number, h: number, d: number, mat: THREE.Material) {
  const g = G();
  g.add(mesh(gc(`fxCarton${w}${h}${d}`, () => rbox(w, h, d, 0.004, 1).translate(0, h / 2, 0)), mat));
  return g;
}
/** clear pillow bag holding something */
function clearBag(w: number, h: number, content?: THREE.Object3D, tint = 0xffffff) {
  const g = G();
  g.add(mesh(gc(`fxBag${w}${h}`, () => { const b = lathe([[0.0001, 0], [w * 0.45, 0.004], [w * 0.5, h * 0.35], [w * 0.42, h * 0.75], [w * 0.16, h * 0.92], [0.0001, h]], 12); b.scale(1, 1, 0.62); return b; }), M.bagClear(tint, 0.3)));
  if (content) { content.name = 'heap'; g.add(content); }
  return g;
}

// ------------------------------------------------------------------ item models

function squidGeo() {
  return gc('fxSquid', () => {
    const mantle = lathe([[0.0001, 0], [0.012, 0.012], [0.017, 0.05], [0.016, 0.09], [0.011, 0.12], [0.0001, 0.135]], 12);
    mantle.rotateZ(-Math.PI / 2).translate(0.0, 0.016, 0);
    const fin = new THREE.BufferGeometry();
    fin.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0.018, 0, 0.135, 0.018, 0.028, 0.135, 0.018, -0.028, 0.1, 0.018, 0], 3));
    fin.setIndex([0, 1, 2, 0, 2, 1]); fin.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0], 2)); fin.computeVertexNormals();
    const head = new THREE.SphereGeometry(0.011, 8, 6).translate(-0.006, 0.014, 0);
    const tents: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8 - 0.5) * 0.9;
      tents.push(tube([[-0.01, 0.012, 0], [-0.04, 0.008, Math.sin(a) * 0.018], [-0.07, 0.005, Math.sin(a) * 0.03 + 0.004 * Math.cos(i)]], 0.0022, 8, 4));
    }
    return merge([mantle.toNonIndexed(), fin.toNonIndexed(), head.toNonIndexed(), ...tents.map((t) => (t.index ? t.toNonIndexed() : t))]);
  });
}
function musselGeo() {
  return gc('fxMussel', () => {
    const half = new THREE.SphereGeometry(0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    half.scale(1.55, 0.42, 0.75);
    const top = half.clone().rotateX(Math.PI).translate(0, 0.016, 0);
    return merge([half.toNonIndexed(), top.toNonIndexed()]).translate(0, 0.008, 0);
  });
}
function clamGeo() {
  return gc('fxClam', () => {
    const h = new THREE.SphereGeometry(0.014, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); h.scale(1.15, 0.5, 0.95);
    return merge([h.toNonIndexed(), h.clone().rotateX(Math.PI).translate(0, 0.013, 0).toNonIndexed()]).translate(0, 0.007, 0);
  });
}
function scatterOn(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, W: number, D: number, y: number, seed: number, layers = 2) {
  return mesh(gc(`fxScat${geo.uuid}${n}${W}${D}${seed}`, () => scatter(geo, n, (i, m, r) => {
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.3, (r() - 0.5) * 0.5));
    m.setPosition((r() - 0.5) * W, y + Math.floor(i / Math.ceil(n / layers)) * 0.012, (r() - 0.5) * D);
  }, seed)), mat);
}

export const FOODX_BUILD: Record<string, () => THREE.Object3D> = {
  squid: () => { const g = tray(0.24, 0.16, 0.022); const h = G(); h.name = 'heap'; h.add(iceBed(0.2, 0.13, 0.018, 3)); for (let i = 0; i < 3; i++) h.add(mesh(squidGeo(), MX.squid(), [0.0, 0.026, (i - 1) * 0.04], [0, (i - 1) * 0.15, 0])); g.add(h); g.add(filmLid(0.24, 0.16, 0.062)); return g; },
  mussels: () => { const g = tray(0.22, 0.15); const h = G(); h.name = 'heap'; h.add(scatterOn(musselGeo(), MX.musselShell(), 12, 0.17, 0.11, 0.022, 4)); g.add(h); g.add(filmLid(0.22, 0.15, 0.07)); return g; },
  clams: () => clearBag(0.18, 0.2, (() => { const h = G(); h.add(scatterOn(clamGeo(), MX.clamShell(), 26, 0.1, 0.06, 0.004, 5, 4)); return h; })()),
  oysters: () => tub(0.06, 0.07, 0x2f62b8, (() => { const h = G(); h.add(mesh(gc('fxOysterBlob', () => scatter(mound(0.022, 0.012, { seed: 3, detail: 2, rough: 0.35, squash: [1.3, 0.9] }), 8, (i, m, r) => { m.makeRotationY(r() * 6); m.setPosition((r() - 0.5) * 0.06, 0.006 + Math.floor(i / 4) * 0.012, (r() - 0.5) * 0.06); }, 6)), MX.oyster())); return h; })()),
  sea_bass: () => { const g = tray(0.42, 0.18); const h = G(); h.name = 'heap'; h.add(iceBed(0.38, 0.15, 0.018, 7)); h.add(scan('fish_whole', 0.38, [0, 0.026, 0], 0.08, { rough: 0.22 })); g.add(h); return g; },
  crab_blue: () => { const g = tray(0.26, 0.2); const h = G(); h.name = 'heap'; h.add(scan('crab_blue', 0.17, [-0.04, 0.02, -0.03], 0.4, { rough: 0.35, tint: 0x86a6cc })); h.add(scan('crab_blue', 0.16, [0.05, 0.022, 0.04], -2.6, { rough: 0.35, tint: 0x86a6cc })); g.add(h); g.add(filmLid(0.26, 0.2, 0.11)); return g; },
  river_prawn: () => { const g = tray(0.3, 0.2, 0.022, true); const h = G(); h.name = 'heap'; h.add(iceBed(0.26, 0.17, 0.018, 9)); h.add(scan('river_prawn', 0.24, [0, 0.026, -0.035], 0.12, { rough: 0.3, sss: 0.4 })); h.add(scan('river_prawn', 0.23, [0.01, 0.028, 0.04], -0.1, { rough: 0.3, sss: 0.4 })); g.add(h); g.add(sticker('prawnS', 'พรีเมียม', 'premium', '#1d1d1f', '#e8c86a', [0.1, 0.06, 0.07])); return g; },
  crab_meat: () => tub(0.055, 0.06, 0xc8231a, (() => { const h = G(); h.add(mesh(gc('fxCrabMeat', () => planarUV(mound(0.05, 0.032, { seed: 9, detail: 3, rough: 0.4 }), 1 / 0.08)), MX.crabMeat(), [0, 0.004, 0])); return h; })()),
  salmon: () => { const g = tray(0.22, 0.14, 0.02, true); const h = G(); h.name = 'heap'; h.add(mesh(gc('fxSalmon', () => planarUV(rbox(0.17, 0.035, 0.09, 0.012, 1), 1 / 0.18)), MX.salmon(), [0, 0.038, 0])); g.add(h); g.add(filmLid(0.22, 0.14, 0.068)); return g; },
  scallop: () => { const g = tray(0.2, 0.14, 0.02, true); const h = G(); h.name = 'heap'; h.add(mesh(gc('fxScallops', () => scatter(new THREE.CylinderGeometry(0.018, 0.02, 0.02, 16), 6, (i, m) => { m.makeRotationY(i); m.setPosition(((i % 3) - 1) * 0.055, 0.03, (Math.floor(i / 3) - 0.5) * 0.05); }, 2)), MX.scallop())); g.add(h); g.add(filmLid(0.2, 0.14, 0.05)); return g; },
  wagyu: () => { const g = tray(0.24, 0.16, 0.016, true); const h = G(); h.name = 'heap'; h.add(mesh(gc('fxWagyu', () => scatter(planarUV(rbox(0.18, 0.004, 0.06, 0.002, 1), 1 / 0.1), 5, (i, m) => { m.makeRotationFromEuler(new THREE.Euler(0.04 * i, 0, 0.3)); m.setPosition(0, 0.02 + i * 0.004, (i - 2) * 0.022); }, 3)), MX.wagyu())); g.add(h); g.add(sticker('wagyuS', 'A5 วากิว', 'wagyu', '#1d1d1f', '#e8c86a', [0.08, 0.05, 0.06])); return g; },
  truffle_oil: () => { const g = G(); g.add(mesh(gc('fxTruffleBottle', () => lathe([[0.0001, 0], [0.028, 0], [0.03, 0.01], [0.03, 0.14], [0.012, 0.17], [0.011, 0.2], [0.0001, 0.2]], 18)), M.glassBottle(0x6a7a30, 0.55))); g.add(mesh(gc('fxTruffleLabel', () => { const c = new THREE.CylinderGeometry(0.0305, 0.0305, 0.06, 18, 1, true); c.translate(0, 0.07, 0); return c; }), labelMat('truffle', 'ทรัฟเฟิล', 'truffle oil', '#1d1d1f', '#e8c86a'))); g.add(mesh(gc('fxTruffleCap', () => new THREE.CylinderGeometry(0.013, 0.013, 0.02, 12).translate(0, 0.21, 0)), MX.foil())); return g; },
  hommali_rice: () => { const g = G(); g.add(mesh(gc('fxRiceSack', () => rbox(0.3, 0.42, 0.11, 0.04, 1).translate(0, 0.21, 0)), labelMat('hommali', 'หอมมะลิ 100%', 'premium jasmine rice', '#f6f2e2', '#1f6a2a', '#c8a23a', 0.6))); return g; },
  butter: () => carton(0.11, 0.035, 0.055, labelMat('butter', 'เนยสด', 'butter', '#f6e6a0', '#2a3a8a', '#ffffff')),
  salted_egg: () => tub(0.05, 0.05, 0xf2c200, (() => { const h = G(); h.add(mesh(gc('fxSEggs', () => scatter(new THREE.SphereGeometry(0.02, 12, 8).scale(1, 1.25, 1), 2, (i, m) => m.setPosition((i - 0.5) * 0.045, 0.025, 0), 1)), MX.saltedEgg())); return h; })()),
  curry_powder: () => carton(0.08, 0.11, 0.025, labelMat('curry', 'ผงกะหรี่', 'curry powder', '#f2c200', '#8a1c14')),
  evaporated_milk: () => can(0.037, 0.105, MX.can('evap', 'นมข้นจืด', 'evaporated milk', '#ffffff', '#2f5fa8')),
  condensed_milk: () => can(0.037, 0.08, MX.can('cond', 'นมข้นหวาน', 'condensed milk', '#f6f0d6', '#c8231a')),
  coconut_milk: () => carton(0.07, 0.11, 0.045, labelMat('coco', 'กะทิ 100%', 'coconut milk', '#2f8a3a', '#ffffff', '#f6f2e2')),
  palm_sugar: () => tub(0.055, 0.05, 0x8a5a2a, (() => { const h = G(); h.add(mesh(gc('fxPalm', () => scatter(new THREE.CylinderGeometry(0.02, 0.022, 0.012, 14), 5, (i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 0.4, 0, r() * 0.4)); m.setPosition((r() - 0.5) * 0.04, 0.008 + i * 0.009, (r() - 0.5) * 0.04); }, 3)), MX.palm())); return h; })()),
  red_syrup: () => { const g = G(); g.add(mesh(gc('fxSyrupBottle', () => lathe([[0.0001, 0], [0.032, 0], [0.034, 0.02], [0.032, 0.17], [0.014, 0.21], [0.013, 0.24], [0.0001, 0.24]], 16)), M.glassBottle(0xd0101e, 0.82))); g.add(mesh(gc('fxSyrupLabel', () => { const c = new THREE.CylinderGeometry(0.0345, 0.0345, 0.07, 16, 1, true); c.translate(0, 0.09, 0); return c; }), labelMat('syrup', 'น้ำแดง', 'red syrup', '#ffffff', '#c8231a'))); return g; },
  batter: () => clearBag(0.15, 0.2, (() => { const h = G(); h.add(mesh(gc('fxBatter', () => mound(0.06, 0.06, { seed: 4, detail: 2, rough: 0.1 })), MX.dough(), [0, 0.003, 0])); return h; })()),
  bean_sprouts: () => clearBag(0.16, 0.2, (() => { const h = G(); h.add(mesh(gc('fxSprouts', () => scatter(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 4), 60, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)); m.setPosition((r() - 0.5) * 0.08, 0.02 + r() * 0.06, (r() - 0.5) * 0.05); }, 8)), MX.sprout())); return h; })()),
  sticky_rice: () => tub(0.07, 0.05, 0xffffff, (() => { const h = G(); h.add(mesh(gc('fxStickyMound', () => planarUV(mound(0.06, 0.04, { seed: 2, detail: 3, rough: 0.12, flat: true }), 1 / 0.1)), MX.stickyRice(), [0, 0.003, 0])); return h; })()),
  mango: () => { const g = G(); const h = G(); h.name = 'heap'; h.add(scan('mango', 0.12, [-0.035, 0, 0], 0.3, { rough: 0.45, sss: 0.3 })); h.add(scan('mango', 0.115, [0.04, 0, 0.02], 2.2, { rough: 0.45, sss: 0.3 })); g.add(h); return g; },
  bua_loi_balls: () => { const g = tray(0.2, 0.14, 0.02); const h = G(); h.name = 'heap'; for (let c = 0; c < 4; c++) h.add(mesh(gc('fxBalls' + c, () => scatter(new THREE.SphereGeometry(0.008, 8, 6), 14, (_i, m, r) => m.setPosition((c - 1.5) * 0.045 + (r() - 0.5) * 0.03, 0.03 + r() * 0.01, (r() - 0.5) * 0.09), c + 3)), MX.balls(c))); g.add(h); g.add(filmLid(0.2, 0.14, 0.05)); return g; },
  banana: () => { const g = G(); const h = G(); h.name = 'heap'; h.add(scan('bananas', 0.2, [0, 0, 0], 0, { rough: 0.6, url: Assets.url('gen/world/models/bananas/bananas.glb') })); g.add(h); return g; },
  roti_dough: () => { const g = tray(0.2, 0.14, 0.02); const h = G(); h.name = 'heap'; h.add(mesh(gc('fxRotiBalls', () => scatter(new THREE.SphereGeometry(0.022, 14, 10).scale(1, 0.75, 1), 5, (i, m) => m.setPosition(((i % 3) - 1) * 0.055, 0.034, (Math.floor(i / 3) - 0.4) * 0.05), 1)), MX.dough())); g.add(h); g.add(filmLid(0.2, 0.14, 0.06)); return g; },
  thapthim: () => tub(0.05, 0.06, 0xc8231a, (() => { const h = G(); h.add(mesh(gc('fxRubies', () => scatter(new THREE.BoxGeometry(0.009, 0.009, 0.009), 60, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)); m.setPosition((r() - 0.5) * 0.07, 0.006 + r() * 0.045, (r() - 0.5) * 0.07); }, 2)), MX.ruby())); return h; })()),
  lot_chong: () => clearBag(0.14, 0.18, (() => { const h = G(); h.add(mesh(gc('fxLotChong', () => scatter(tube([[0, 0, 0], [0.01, 0.003, 0.004], [0.02, 0, 0.002]], 0.003, 6, 5), 60, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)); m.setPosition((r() - 0.5) * 0.08, 0.015 + r() * 0.05, (r() - 0.5) * 0.05); }, 4)), MX.pandan())); return h; })()),
  icecream_coconut: () => { const g = G(); g.add(mesh(gc('fxIceTub', () => lathe([[0.0001, 0], [0.07, 0], [0.08, 0.11], [0.0001, 0.11]], 22)), labelMat('icecream', 'ไอติมกะทิ', 'coconut ice cream', '#ffffff', '#2f8a3a', '#9fd38a'))); g.add(mesh(gc('fxIceTubLid', () => new THREE.CylinderGeometry(0.082, 0.082, 0.01, 22).translate(0, 0.115, 0)), MX.tubLid(0x2f8a3a))); return g; },
  shaved_ice: () => clearBag(0.18, 0.22, (() => { const h = G(); h.add(mesh(gc('fxShaved', () => mound(0.075, 0.13, { seed: 6, detail: 3, rough: 0.35 })), MX.ice(), [0, 0.004, 0])); return h; })()),
  peanuts: () => clearBag(0.1, 0.13, (() => { const h = G(); h.add(mesh(gc('fxPeanuts', () => scatter(new THREE.SphereGeometry(0.005, 6, 4).scale(1.4, 0.9, 1), 50, (_i, m, r) => m.setPosition((r() - 0.5) * 0.06, 0.006 + r() * 0.04, (r() - 0.5) * 0.035), 3)), MX.peanut())); return h; })()),
};

/** hold style per new kind */
export const FOODX_HOLD: Record<string, string> = {
  truffle_oil: 'bottle', red_syrup: 'bottle', evaporated_milk: 'jar', condensed_milk: 'jar', coconut_milk: 'packet', curry_powder: 'packet', butter: 'packet',
  hommali_rice: 'big', icecream_coconut: 'jar', mango: 'bag', banana: 'bunch', clams: 'bag', batter: 'bag', bean_sprouts: 'bag', lot_chong: 'bag', shaved_ice: 'bag', peanuts: 'bag',
};

// ------------------------------------------------------------------ dessert basin (cold wok)

/** Stainless dessert basin: the wok's bowl shape (so wok food layers render inside) without handles. */
export function buildMixBowl() {
  const g = buildWok();
  // children: [0] bowl, [1] steel socket, [2] grip, [3] loop handle, [4] 'wokfood'
  const kill = g.children.filter((c, i) => i > 0 && c.name !== 'wokfood');
  for (const c of kill) g.remove(c);
  const bowl = g.children[0] as THREE.Mesh;
  bowl.material = M.steelDent();
  // rolled rim
  g.add(mesh(gc('fxBasinRim', () => { const t = new THREE.TorusGeometry(0.168, 0.004, 6, 40); t.rotateX(Math.PI / 2); return t; }), M.steel(), [0, wokTopY(bowl), 0]));
  return g;
}
function wokTopY(m: THREE.Mesh) { m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.max.y; }

/** Item definitions for the new kinds (called from defineCookingItems with its helpers). */
export function defineFoodX(def: (d: ItemDef) => void, ingBase: (k: string) => any, h: { anim: (f?: any) => ItemDef['animate']; refreshHeap: (full: number) => ItemDef['refresh']; refreshLiquid: (full: number) => ItemDef['refresh']; HOLD: Record<string, any>; wokRefresh: ItemDef['refresh']; wokLabel: ItemDef['label'] }) {
  for (const [k, build] of Object.entries(FOODX_BUILD)) {
    const g = ING[k];
    if (!g) continue;
    const liquid = g.unit === 'ml' && (k === 'truffle_oil' || k === 'red_syrup' || k === 'evaporated_milk' || k === 'coconut_milk');
    def({
      ...ingBase(k),
      carry: k === 'hommali_rice' ? 'underarm' : 'hand',
      tags: ['ingredient', ...(g.tags ?? []), ...(k === 'hommali_rice' ? ['heavy'] : [])],
      build: () => build(),
      refresh: liquid ? h.refreshLiquid(g.amount) : h.refreshHeap(g.amount),
      animate: h.anim(),
      hold: h.HOLD[FOODX_HOLD[k] ?? 'tray'],
    });
  }
  def({
    kind: 'mix_bowl', name: TOOL_META.mix_bowl.name, weight: 0.6, price: TOOL_META.mix_bowl.price, carry: 'hand', tags: ['tool', 'metal', 'vessel', 'basin'],
    data: () => ({ T: 28, oil: 0, w: 0, it: {}, sa: {} }), build: () => buildMixBowl(), refresh: h.wokRefresh, animate: h.anim(), hold: h.HOLD.wok,
    label: h.wokLabel,
  });
}
