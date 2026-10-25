import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../../core/assets';
import type { Game } from '../../game/game';
import { G, groups } from '../../sim/physics';
import { MODELS, type ModelDef } from './realprops';

/**
 * SHARED ASSET LIBRARY (docs/ART_STYLE.md §10) — owned by the assets agent.
 *
 * Every imported (Sketchfab via the Objaverse mirror) or custom (headless Blender, scripts/thai/) model lives in
 * public/assets/gen/lib/<category>/<id>.glb and has an entry in public/assets/gen/lib/catalog.json:
 *   { id, file, category, tags, size_m:[w,h,d], tris, license, author, source_url, physics:'dynamic'|'static'|'none', mass_kg,
 *     tint?, friction?, far?, collider?, anchor?, alpha?, title?, uid? }
 * Models are normalised: metres, origin at the bottom centre, +Z forward, meshopt geometry + WebP textures, most of them
 * one baked PBR material (albedo×AO, ORM, normal) = one draw call. Search the catalog before importing anything
 * (`python3 scripts/libpub.py list <pattern>`).
 *
 * API
 *   await loadLib()                 catalog (once); also registers every entry with the RealProps instancer as `lib:<id>`
 *   libEntry(id) / libFind({category, tag, text})
 *   libModel(id, {color, shadow})   sync THREE.Group clone (shared geometry/materials), meshes fill in when loaded
 *   await libModelAsync(id)         same, resolved when loaded
 *   libInstanced(id, matrices)      THREE.Group of InstancedMeshes (one per material) — static repeats
 *   libPropId(id)                   'lib:<id>' — use with RealProps.add() for culled, physical, client-local clutter
 *   libHull(id) / libBody(game, id, matrix, kind?) / syncToBody(obj, body)    Rapier helpers (convex hull, catalog mass)
 */

export interface LibEntry {
  id: string; file: string; category: string; tags: string[];
  size_m: [number, number, number]; tris: number;
  license: string; author: string; source_url: string;
  physics: 'dynamic' | 'static' | 'none'; mass_kg: number;
  tint?: boolean; friction?: number; far?: number; collider?: 'hull' | 'box' | 'cyl'; anchor?: 'bottom' | 'back' | 'top';
  alpha?: 'mask'; title?: string; uid?: string; bytes?: number;
}

export interface LibPart { geom: THREE.BufferGeometry; mat: THREE.Material; name: string }
export interface LibAsset { entry: LibEntry; parts: LibPart[]; box: THREE.Box3; hull: Float32Array; scene: THREE.Group }

const BASE = 'gen/lib/';
let catalogP: Promise<LibEntry[]> | null = null;
const byId = new Map<string, LibEntry>();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const assetP = new Map<string, Promise<LibAsset | null>>();
const ready = new Map<string, LibAsset>();

/** physics kind in the RealProps vocabulary */
const physKind = (e: LibEntry) => (e.physics === 'dynamic' ? 'dyn' : e.physics === 'static' ? 'static' : 'none') as ModelDef['phys'];

/** visible-distance factor from the object size (small things vanish sooner) */
function farFactor(e: LibEntry) {
  if (e.far) return e.far;
  const s = Math.max(...e.size_m);
  return s < 0.15 ? 0.35 : s < 0.35 ? 0.55 : s < 0.8 ? 0.8 : s < 2.5 ? 1.1 : 1.5;
}

/** Load the catalog (once) and register every model as `lib:<id>` with the RealProps instancer. */
export function loadLib(): Promise<LibEntry[]> {
  if (!catalogP) {
    catalogP = Assets.jsonSafe<LibEntry[]>(BASE + 'catalog.json', []).then((cat) => {
      const list = Array.isArray(cat) ? cat : [];
      for (const e of list) {
        byId.set(e.id, e);
        const def: ModelDef = {
          file: e.id, path: BASE + e.file, phys: physKind(e), mass: e.mass_kg || undefined, friction: e.friction,
          recolor: !!e.tint, far: farFactor(e), shadow: Math.max(...e.size_m) > 0.3, collider: e.collider,
          anchor: e.anchor, env: 0.6, dirt: 1,
        };
        MODELS[libPropId(e.id)] = def;
      }
      return list;
    });
  }
  return catalogP;
}

export const libPropId = (id: string) => 'lib:' + id;
export function libEntry(id: string) { return byId.get(id) ?? null; }
export function libReady() { return byId.size > 0; }

/** catalog search: every given criterion must match */
export function libFind(q: { category?: string; tag?: string; text?: string } = {}): LibEntry[] {
  const out: LibEntry[] = [];
  const t = q.text?.toLowerCase();
  for (const e of byId.values()) {
    if (q.category && e.category !== q.category) continue;
    if (q.tag && !e.tags.includes(q.tag)) continue;
    if (t && !(e.id + ' ' + e.tags.join(' ') + ' ' + (e.title ?? '')).toLowerCase().includes(t)) continue;
    out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------ loading
function prepMat(src: THREE.Material, e: LibEntry): THREE.Material {
  const m = src as THREE.MeshStandardMaterial;
  const glass = /glass/i.test(m.name) || (m.transparent && m.opacity < 0.95 && !m.map);
  if (glass) {
    m.transparent = true; m.depthWrite = false; m.roughness = Math.min(m.roughness, 0.12); m.envMapIntensity = 1.0;
    m.side = THREE.DoubleSide;
  } else {
    if (m.transparent && e.alpha !== 'mask') { m.transparent = false; m.depthWrite = true; if (m.map) m.alphaTest = Math.max(m.alphaTest, 0.5); }
    if (e.alpha === 'mask') { m.alphaTest = Math.max(m.alphaTest, 0.5); m.transparent = false; m.side = THREE.DoubleSide; }
    m.envMapIntensity = 0.6;
  }
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) { const t = (m as any)[k] as THREE.Texture | null; if (t) t.anisotropy = 4; }
  return m;
}

function hullOf(parts: LibPart[]): Float32Array {
  const pts: THREE.Vector3[] = [];
  let total = 0;
  for (const p of parts) total += p.geom.getAttribute('position').count;
  const step = Math.max(1, Math.floor(total / 3000));
  for (const p of parts) {
    const a = p.geom.getAttribute('position');
    for (let i = 0; i < a.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(a, i));
  }
  let hp = pts;
  try {
    const h = new ConvexHull().setFromPoints(pts);
    const uniq = new Map<string, THREE.Vector3>();
    for (const f of h.faces) { let ed = f.edge; do { const v = ed.head().point; uniq.set(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`, v); ed = ed.next; } while (ed !== f.edge); }
    hp = [...uniq.values()];
  } catch { /* all points */ }
  const out = new Float32Array(hp.length * 3);
  hp.forEach((v, i) => { out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; });
  return out;
}

/** load + prepare a library model (once). Geometry is baked to world space of the GLB and merged per material. */
export function libLoad(id: string): Promise<LibAsset | null> {
  let p = assetP.get(id);
  if (!p) {
    p = loadLib().then(async () => {
      const e = byId.get(id);
      if (!e) { console.warn('[lib] unknown model', id); return null; }
      const gltf = await loader.loadAsync(Assets.url(BASE + e.file));
      gltf.scene.updateMatrixWorld(true);
      const byMat = new Map<THREE.Material, { gs: THREE.BufferGeometry[]; name: string }>();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
        const g = toFloat(mesh.geometry).applyMatrix4(mesh.matrixWorld);
        const slot = byMat.get(mat) ?? { gs: [], name: mesh.name };
        slot.gs.push(g);
        byMat.set(mat, slot);
      });
      const parts: LibPart[] = [];
      for (const [mat, { gs, name }] of byMat) {
        const geom = gs.length > 1 ? (mergeGeometries(gs, false) ?? gs[0]) : gs[0];
        geom.computeBoundingBox(); geom.computeBoundingSphere();
        parts.push({ geom, mat: prepMat(mat, e), name });
      }
      // opaque parts first (glass drawn last)
      parts.sort((a, b) => Number(a.mat.transparent) - Number(b.mat.transparent));
      const box = new THREE.Box3();
      for (const pt of parts) box.union(pt.geom.boundingBox!);
      const asset: LibAsset = { entry: e, parts, box, hull: hullOf(parts), scene: gltf.scene };
      ready.set(id, asset);
      return asset;
    }).catch((err) => { console.warn('[lib] load failed', id, err); return null; });
    assetP.set(id, p);
  }
  return p;
}

/** float copy of position/normal/uv (meshopt-quantised attributes → Float32) */
function toFloat(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const n = a.itemSize, out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ objects
const tintCache = new Map<string, THREE.Material>();
function tinted(id: string, mat: THREE.Material, color: THREE.ColorRepresentation | undefined, e: LibEntry) {
  if (color === undefined || !e.tint || (mat as any).transparent) return mat;
  const c = new THREE.Color(color);
  const key = id + ':' + c.getHexString() + ':' + mat.uuid;
  let m = tintCache.get(key);
  if (!m) {
    const mm = (mat as THREE.MeshStandardMaterial).clone();
    // the baked albedo is a real colour (e.g. red plastic): shift it toward the wanted colour, keep its shading/print
    if (mm.map) mm.map = greyMap(mm.map);
    mm.color.copy(c);
    m = mm; tintCache.set(key, m);
  }
  return m;
}
const greyCache = new Map<THREE.Texture, THREE.Texture>();
function greyMap(t: THREE.Texture): THREE.Texture {
  let o = greyCache.get(t);
  if (o) return o;
  const img = t.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return t;
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height), p = d.data;
  let sum = 0; for (let i = 0; i < p.length; i += 4) sum += Math.max(p[i], p[i + 1], p[i + 2]);
  const k = (0.82 * 255) / Math.max(1, sum / (p.length / 4));
  for (let i = 0; i < p.length; i += 4) { const l = Math.min(255, Math.max(p[i], p[i + 1], p[i + 2]) * k); p[i] = p[i + 1] = p[i + 2] = l; }
  ctx.putImageData(d, 0, 0);
  o = new THREE.CanvasTexture(cv);
  o.flipY = t.flipY; o.colorSpace = THREE.SRGBColorSpace; o.wrapS = t.wrapS; o.wrapT = t.wrapT; o.anisotropy = 4;
  greyCache.set(t, o);
  return o;
}

export interface LibObjOpts { color?: THREE.ColorRepresentation; shadow?: boolean; receive?: boolean }

function fillGroup(g: THREE.Group, id: string, a: LibAsset, o: LibObjOpts) {
  for (const p of a.parts) {
    const mesh = new THREE.Mesh(p.geom, tinted(id, p.mat, o.color, a.entry));
    mesh.name = p.name || id;
    mesh.castShadow = (o.shadow ?? true) && !p.mat.transparent;
    mesh.receiveShadow = o.receive ?? true;
    g.add(mesh);
  }
}

/** A clone of a library model (shared geometry & materials). Sync: meshes are added once the model is loaded. */
export function libModel(id: string, o: LibObjOpts = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lib:' + id;
  const a = ready.get(id);
  if (a) fillGroup(g, id, a, o); else libLoad(id).then((x) => x && fillGroup(g, id, x, o));
  return g;
}
export async function libModelAsync(id: string, o: LibObjOpts = {}): Promise<THREE.Group> {
  await libLoad(id);
  return libModel(id, o);
}

/** Static instanced repeats of one model (one InstancedMesh per material). Matrices are world (or parent) space. */
export function libInstanced(id: string, matrices: THREE.Matrix4[], o: LibObjOpts & { colors?: THREE.ColorRepresentation[] } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'libI:' + id;
  const build = (a: LibAsset) => {
    const n = matrices.length;
    if (!n) return;
    const sph = new THREE.Sphere(); const bb = new THREE.Box3();
    for (const m of matrices) bb.union(a.box.clone().applyMatrix4(m));
    bb.getBoundingSphere(sph);
    for (const p of a.parts) {
      const im = new THREE.InstancedMesh(p.geom, p.mat, n);
      for (let i = 0; i < n; i++) im.setMatrixAt(i, matrices[i]);
      if (o.colors && a.entry.tint && !p.mat.transparent) {
        im.material = tinted(id, p.mat, 0xffffff, a.entry);
        for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(o.colors[i % o.colors.length]));
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = (o.shadow ?? true) && !p.mat.transparent;
      im.receiveShadow = true;
      im.boundingSphere = sph.clone();
      im.name = 'libI:' + id;
      g.add(im);
    }
  };
  const a = ready.get(id);
  if (a) build(a); else libLoad(id).then((x) => x && build(x));
  return g;
}

// ------------------------------------------------------------------ physics
/** convex hull points (model space) once loaded, else null */
export function libHull(id: string): Float32Array | null { return ready.get(id)?.hull ?? null; }

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
/**
 * A Rapier body for a library model placed with `matrix` (uniform scale): dynamic = convex hull with the catalog mass &
 * friction (created asleep), static = fixed box. The model must be loaded (await libLoad). Returns null without physics.
 */
export function libBody(game: Game, id: string, matrix: THREE.Matrix4, kind?: 'dynamic' | 'static'): RAPIER.RigidBody | null {
  const phys = game.physics, a = ready.get(id);
  if (!phys || !a) return null;
  const R = phys.R, W = phys.world, e = a.entry;
  const k = kind ?? (e.physics === 'none' ? null : e.physics);
  if (!k) return null;
  matrix.decompose(_v, _q, _s);
  const sc = _s.x;
  const size = a.box.getSize(new THREE.Vector3()).multiplyScalar(sc);
  const ctr = a.box.getCenter(new THREE.Vector3()).multiplyScalar(sc);
  const box = () => R.ColliderDesc.cuboid(Math.max(0.01, size.x / 2), Math.max(0.01, size.y / 2), Math.max(0.01, size.z / 2)).setTranslation(ctr.x, ctr.y, ctr.z);
  if (k === 'dynamic') {
    let cd: RAPIER.ColliderDesc | null = null;
    if (e.collider === 'box') cd = box();
    else if (e.collider === 'cyl') cd = R.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2).setTranslation(ctr.x, ctr.y, ctr.z);
    else cd = R.ColliderDesc.convexHull(sc === 1 ? a.hull : (a.hull.map((v) => v * sc) as Float32Array)) ?? box();
    cd.setMass(e.mass_kg || 1).setFriction(e.friction ?? 0.6).setRestitution(0.08)
      .setCollisionGroups(groups(G.ITEM, G.STATIC | G.ITEM | G.PLAYER | G.NPC | G.VEHICLE));
    const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y, _v.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setSleeping(true).setLinearDamping(0.12).setAngularDamping(0.35));
    W.createCollider(cd, body);
    return body;
  }
  const body = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(_v.x, _v.y, _v.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
  W.createCollider(box().setFriction(e.friction ?? 0.7).setCollisionGroups(groups(G.STATIC, G.ALL)), body);
  return body;
}

/** copy a body's pose onto an Object3D (call per frame for awake dynamic bodies) */
export function syncToBody(obj: THREE.Object3D, body: RAPIER.RigidBody) {
  const t = body.translation(), r = body.rotation();
  obj.position.set(t.x, t.y, t.z);
  obj.quaternion.set(r.x, r.y, r.z, r.w);
}
