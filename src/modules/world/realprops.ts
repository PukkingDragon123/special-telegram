import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { Assets } from '../../core/assets';
import { params } from '../../core/util';
import type { Game } from '../../game/game';
import { G, groups } from '../../sim/physics';
import { PROC_MODELS, ProcModel } from './realprops-proc';

/**
 * REAL PROPS — photoscanned Poly Haven models (CC0, public/assets/gen/world/models, fetched and
 * optimized by scripts/polyhaven.mjs) plus a few properly modelled Thai things that have no scan
 * (red plastic stool, bucket, traffic cone — realprops-proc.ts), rendered with ONE InstancedMesh per
 * model part and given real physics:
 *
 *  - small / medium props are Rapier DYNAMIC bodies (convex hull, real mass & friction), created
 *    asleep exactly where they rest; the player controller, remote players' capsules, traffic and
 *    NPCs (proximity kicks) wake them and knock them over.
 *  - big / heavy props (shelves, hydrants, barriers, utility boxes) get fixed colliders.
 *  - ambient clutter is CLIENT-LOCAL (ARCHITECTURE §3): every peer simulates its own copy from the
 *    same deterministic placement; everything is tidied back home at the start of a new day.
 *  - instances are culled per frame (distance + frustum) and compacted into the instance buffers,
 *    so a model costs one draw call (+ one shadow pass) however many copies the map has; only
 *    awake bodies write matrices.
 */

export type PhysKind = 'dyn' | 'static' | 'none';
export type PropId = string;

export interface ModelDef {
  /** Poly Haven id (GLB at gen/world/models/<id>/<id>.glb); absent → procedural (PROC_MODELS) */
  file?: string;
  phys: PhysKind;
  /** kg (dynamic) */
  mass?: number;
  friction?: number;
  restitution?: number;
  /** collider for dynamic props (default hull) */
  collider?: 'hull' | 'box' | 'cyl';
  /** grey-normalise the albedo so instance colours give coloured plastic variants */
  recolor?: boolean;
  /** visible distance factor (1 = normal, small props < 1) */
  far?: number;
  shadow?: boolean;
  /** albedo multiplier (street grime) */
  dirt?: number;
  /** base rotation applied to the model before normalising (radians, XYZ) */
  rot?: [number, number, number];
  /** extra uniform scale */
  scale?: number;
  /** origin: bottom centre (default) or bottom-back (wall-mounted, back at z=0) */
  anchor?: 'bottom' | 'back';
  /** env-map intensity */
  env?: number;
}

const M = (file: string, d: Omit<ModelDef, 'file'>): ModelDef => ({ file, ...d });
/** Every model the world uses. Masses are real (kg); frictions plastic≈0.5, rubber≈0.9, steel≈0.4. */
export const MODELS: Record<PropId, ModelDef> = {
  // ---- furniture
  monobloc: M('plastic_monobloc_chair_01', { phys: 'dyn', mass: 2.4, friction: 0.55, recolor: true, shadow: true }),
  metal_stool: M('metal_stool_02', { phys: 'dyn', mass: 3.5, friction: 0.5, shadow: true }),
  folding_stool: M('folding_wooden_stool', { phys: 'dyn', mass: 2.2, friction: 0.6, shadow: true }),
  thai_stool: { phys: 'dyn', mass: 0.7, friction: 0.55, recolor: true, shadow: true },
  // ---- containers
  crate: M('plastic_crate_02', { phys: 'dyn', mass: 1.6, friction: 0.55, recolor: true, shadow: true, collider: 'box' }),
  tote: M('industrial_pastic_container', { phys: 'dyn', mass: 2.5, friction: 0.55, recolor: true, shadow: true, collider: 'box' }),
  wood_crate: M('wooden_crate_01', { phys: 'dyn', mass: 6, friction: 0.7, shadow: true, collider: 'box' }),
  cardboard: M('cardboard_box_01', { phys: 'dyn', mass: 1.2, friction: 0.75, shadow: true, collider: 'box' }),
  jerrycan: M('plastic_jerrycan', { phys: 'dyn', mass: 4, friction: 0.5, recolor: true, far: 0.8, shadow: true }),
  gallon: M('plastic_bottle_gallon', { phys: 'dyn', mass: 1.0, friction: 0.45, far: 0.6 }),
  cleaner: M('multi_cleaner_5_litre', { phys: 'dyn', mass: 2.0, friction: 0.45, far: 0.6 }),
  lpg: M('small_lpg_tank', { phys: 'dyn', mass: 17, friction: 0.45, recolor: true, shadow: true, collider: 'cyl' }),
  lpg_small: M('propane_tank', { phys: 'dyn', mass: 9, friction: 0.45, recolor: true, shadow: true, collider: 'cyl' }),
  drum: M('barrel_03', { phys: 'dyn', mass: 22, friction: 0.5, recolor: true, shadow: true, collider: 'cyl' }),
  drum_red: M('Barrel_01', { phys: 'dyn', mass: 22, friction: 0.5, shadow: true, collider: 'cyl' }),
  bucket: { phys: 'dyn', mass: 0.6, friction: 0.5, recolor: true, far: 0.8, shadow: true },
  cone: { phys: 'dyn', mass: 1.1, friction: 0.7, recolor: true, far: 0.9, shadow: true },
  basket: M('wicker_basket_01', { phys: 'dyn', mass: 0.5, friction: 0.7, far: 0.7, collider: 'box' }),
  basket_lid: M('wicker_basket_02', { phys: 'dyn', mass: 0.8, friction: 0.7, far: 0.7 }),
  // ---- waste / cleaning
  trashbag: M('trashbag', { phys: 'dyn', mass: 3.5, friction: 0.9, restitution: 0.02, shadow: true, env: 0.8 }),
  broom: M('plastic_broom', { phys: 'dyn', mass: 0.5, friction: 0.6, far: 0.7 }),
  broom_wood: M('wooden_broom', { phys: 'dyn', mass: 0.6, friction: 0.6, far: 0.7 }),
  dustpan: M('dustpan', { phys: 'dyn', mass: 0.3, friction: 0.6, far: 0.6 }),
  wet_sign: M('WetFloorSign_01', { phys: 'dyn', mass: 0.9, friction: 0.6, far: 0.8, shadow: true }),
  // ---- junk
  tyre: M('old_tyre', { phys: 'dyn', mass: 8, friction: 0.95, restitution: 0.25, shadow: true, rot: [Math.PI / 2, 0, 0], collider: 'cyl' }),
  tyre_up: M('old_tyre', { phys: 'dyn', mass: 8, friction: 0.95, restitution: 0.25, shadow: true }),
  cement: M('cement_bag', { phys: 'dyn', mass: 25, friction: 0.9, restitution: 0, shadow: true, collider: 'box' }),
  can: M('can_rusted', { phys: 'dyn', mass: 0.3, friction: 0.5, far: 0.45 }),
  rat: M('street_rat', { phys: 'none', far: 0.4 }),
  // ---- plants
  plant_taro: M('potted_plant_02', { phys: 'dyn', mass: 9, friction: 0.7, shadow: true, collider: 'cyl' }),
  plant_aloe: M('potted_plant_04', { phys: 'dyn', mass: 1.5, friction: 0.7, far: 0.7, collider: 'cyl' }),
  pot_clay: M('planter_pot_clay', { phys: 'dyn', mass: 3, friction: 0.7, far: 0.7, collider: 'cyl' }),
  pot_ceramic: M('ceramic_pot', { phys: 'dyn', mass: 14, friction: 0.7, shadow: true }),
  // ---- big & heavy (static)
  shelf_steel: M('steel_frame_shelves_02', { phys: 'static', far: 1.4, shadow: true }),
  rack: M('worn_metal_rack', { phys: 'static', far: 1.4, shadow: true }),
  shelf_wood: M('wooden_display_shelves_01', { phys: 'static', far: 1.3, shadow: true }),
  hand_truck: M('hand_truck', { phys: 'static', far: 1.0, shadow: true }),
  utility_box: M('utility_box_01', { phys: 'static', far: 1.4, shadow: true }),
  power_box: M('power_box_01', { phys: 'static', far: 1.0, anchor: 'back' }),
  hydrant: M('fire_hydrant', { phys: 'static', far: 1.2, shadow: true }),
  barrier: M('concrete_road_barrier_02', { phys: 'static', far: 1.6, shadow: true }),
};

// ------------------------------------------------------------------ model loading

export interface ModelPart { geom: THREE.BufferGeometry; mat: THREE.Material; tint: boolean }
export interface Model { parts: ModelPart[]; box: THREE.Box3; hull: Float32Array; radius: number }

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map<string, Promise<Model | null>>();
const loaded = new Map<string, Model>();

/** float copy of every attribute (meshopt/quantized → Float32) so transforms can be baked */
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
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** grey-normalised copy of a texture (keeps scuffs, prints, dirt) so instance colours recolour it */
function neutralTexture(t: THREE.Texture, target = 0.82): THREE.Texture {
  const img = t.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return t;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  const p = d.data;
  let sum = 0;
  const n = p.length / 4;
  for (let i = 0; i < p.length; i += 4) sum += 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
  const k = (target * 255) / Math.max(1, sum / n);
  for (let i = 0; i < p.length; i += 4) {
    const l = Math.min(255, (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]) * k);
    p[i] = p[i + 1] = p[i + 2] = l;
  }
  ctx.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(cv);
  out.flipY = t.flipY; out.colorSpace = THREE.SRGBColorSpace;
  out.wrapS = t.wrapS; out.wrapT = t.wrapT; out.repeat.copy(t.repeat); out.offset.copy(t.offset);
  out.anisotropy = 4;
  return out;
}

function prepMaterial(src: THREE.Material, def: ModelDef): THREE.Material {
  const m = (src as THREE.MeshStandardMaterial).clone();
  if (m.transparent || (m as any).alphaMode === 'BLEND') { m.transparent = false; m.depthWrite = true; m.alphaTest = Math.max(m.alphaTest, 0.5); }
  if (m.map && def.recolor) m.map = neutralTexture(m.map);
  if (m.color) m.color.multiplyScalar(def.dirt ?? 0.92);
  m.envMapIntensity = def.env ?? 0.55;
  if (m.map) m.map.anisotropy = 4;
  return m;
}

/** normalise parts: base rotation, origin at bottom centre (or back), hull points, radius */
function finishModel(parts: ModelPart[], def: ModelDef): Model {
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(def.rot ?? [0, 0, 0])));
  const s = def.scale ?? 1;
  if (s !== 1) rot.premultiply(new THREE.Matrix4().makeScale(s, s, s));
  for (const p of parts) p.geom.applyMatrix4(rot);
  const box = new THREE.Box3();
  for (const p of parts) { p.geom.computeBoundingBox(); box.union(p.geom.boundingBox!); }
  const c = box.getCenter(new THREE.Vector3());
  const off = new THREE.Vector3(-c.x, -box.min.y, def.anchor === 'back' ? -box.min.z : -c.z);
  for (const p of parts) { p.geom.translate(off.x, off.y, off.z); p.geom.computeBoundingBox(); p.geom.computeBoundingSphere(); }
  box.translate(off);
  // convex hull points (subsampled for big meshes)
  const pts: THREE.Vector3[] = [];
  let total = 0;
  for (const p of parts) total += p.geom.getAttribute('position').count;
  const step = Math.max(1, Math.floor(total / 4000));
  for (const p of parts) {
    const a = p.geom.getAttribute('position');
    for (let i = 0; i < a.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(a, i));
  }
  let hullPts: THREE.Vector3[] = pts;
  try {
    const h = new ConvexHull().setFromPoints(pts);
    const set: THREE.Vector3[] = [];
    for (const f of h.faces) { let e = f.edge; do { set.push(e.head().point); e = e.next; } while (e !== f.edge); }
    const uniq = new Map<string, THREE.Vector3>();
    for (const v of set) uniq.set(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`, v);
    hullPts = [...uniq.values()];
  } catch { /* fall back to all points */ }
  const hull = new Float32Array(hullPts.length * 3);
  hullPts.forEach((v, i) => { hull[i * 3] = v.x; hull[i * 3 + 1] = v.y; hull[i * 3 + 2] = v.z; });
  const size = box.getSize(new THREE.Vector3());
  return { parts, box, hull, radius: Math.max(0.05, size.length() / 2) };
}

async function loadGlb(def: ModelDef): Promise<Model | null> {
  const gltf = await loader.loadAsync(Assets.url(`gen/world/models/${def.file}/${def.file}.glb`));
  gltf.scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const g = floatGeom(mesh.geometry, mesh.matrixWorld);
    const list = byMat.get(mats[0]) ?? [];
    list.push(g);
    byMat.set(mats[0], list);
  });
  const parts: ModelPart[] = [];
  for (const [mat, gs] of byMat) {
    let geom = gs[0];
    if (gs.length > 1) {
      const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
      geom = mergeGeometries(gs, false) ?? gs[0];
    }
    parts.push({ geom, mat: prepMaterial(mat, def), tint: !!def.recolor });
  }
  return finishModel(parts, def);
}

async function loadProc(id: string, def: ModelDef): Promise<Model | null> {
  const make = PROC_MODELS[id];
  if (!make) return null;
  const pm: ProcModel = await make();
  return finishModel(pm.parts.map((p) => ({ geom: p.geom, mat: p.mat, tint: p.tint ?? !!def.recolor })), { ...def, rot: undefined });
}

/** Load (once) and return a model; null if missing. */
export function loadModel(id: PropId): Promise<Model | null> {
  let p = modelCache.get(id);
  if (!p) {
    const def = MODELS[id];
    p = (def ? (def.file ? loadGlb(def) : loadProc(id, def)) : Promise.resolve(null))
      .then((m) => { if (m) loaded.set(id, m); return m; })
      .catch((e) => { console.warn('[realprops] model failed', id, e); return null; });
    modelCache.set(id, p);
  }
  return p;
}

/** Start loading the models the world always needs (call early, e.g. module init). */
export function preloadRealProps(ids: PropId[] = Object.keys(MODELS)) { for (const id of ids) loadModel(id); }

/**
 * A plain Object3D of a real prop for item visuals (restaurant chairs, shop goods…): sync, the meshes
 * fill in when the model is loaded. Origin bottom centre, facing +Z. `color` tints recolourable parts.
 */
export function realPropObject(id: PropId, o: { color?: THREE.ColorRepresentation; shadow?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'real:' + id;
  const fill = (m: Model) => {
    for (const p of m.parts) {
      let mat = p.mat;
      if (o.color !== undefined && p.tint) {
        const key = id + ':' + new THREE.Color(o.color).getHexString() + ':' + (p.mat as any).uuid;
        mat = tintCache.get(key) ?? (() => { const c = (p.mat as THREE.MeshStandardMaterial).clone(); c.color.multiply(new THREE.Color(o.color)); tintCache.set(key, c); return c; })();
      }
      const mesh = new THREE.Mesh(p.geom, mat);
      mesh.castShadow = o.shadow ?? true; mesh.receiveShadow = true;
      g.add(mesh);
    }
  };
  const ready = loaded.get(id);
  if (ready) fill(ready); else loadModel(id).then((m) => m && fill(m));
  return g;
}
const tintCache = new Map<string, THREE.Material>();

// ------------------------------------------------------------------ placement registry + runtime

export interface PlaceOpts {
  /** extra rotation (radians) around X / Z after yaw — leaning, tipped over */
  rx?: number; rz?: number;
  scale?: number;
  color?: THREE.ColorRepresentation;
  /** override the model's physics kind */
  phys?: PhysKind;
}

interface Placement { id: PropId; m: THREE.Matrix4; color: THREE.Color | null; phys: PhysKind }

interface Inst {
  batch: Batch;
  m: Float32Array;          // current world matrix (16)
  home: THREE.Matrix4;
  x: number; y: number; z: number; r: number; s: number;
  color: THREE.Color | null;
  body: RAPIER.RigidBody | null;
  dyn: boolean;
  moved: boolean;
  kickT: number;
  cell: number;
}

interface Batch {
  id: PropId;
  def: ModelDef;
  model: Model;
  meshes: THREE.InstancedMesh[];
  inst: Inst[];
  matAttr: THREE.InstancedBufferAttribute;
  colAttr: THREE.InstancedBufferAttribute | null;
  far: number;
  dirty: boolean;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();

/** One per built world. World builders register placements; build() turns them into instances + bodies. */
export class RealProps {
  readonly placements: Placement[] = [];
  private batches: Batch[] = [];
  private byHandle = new Map<number, Inst>();
  private dynList: Inst[] = [];
  private grid = new Map<number, Inst[]>();
  private game: Game | null = null;
  private root: THREE.Group | null = null;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private frameN = 0;
  private day = -1;
  private npcPrev = new Map<number, [number, number, number]>();
  /** my own scatter footprints (avoid overlapping clutter) */
  private occ = new Map<number, [number, number, number][]>();
  stats = { instances: 0, bodies: 0, dynamic: 0, awake: 0, visible: 0, drawn: 0, buildMs: 0 };

  /** world builders: register one prop. y = surface height. */
  add(id: PropId, x: number, y: number, z: number, yaw = 0, o: PlaceOpts = {}) {
    const def = MODELS[id];
    if (!def) { console.warn('[realprops] unknown prop', id); return; }
    _q.setFromEuler(_e.set(o.rx ?? 0, yaw, o.rz ?? 0, 'YXZ'));
    const s = o.scale ?? 1;
    const m = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(s, s, s));
    this.addMatrix(id, m, o);
  }
  addMatrix(id: PropId, m: THREE.Matrix4, o: PlaceOpts = {}) {
    const def = MODELS[id];
    if (!def) return;
    this.placements.push({ id, m, color: o.color !== undefined ? new THREE.Color(o.color) : null, phys: o.phys ?? def.phys });
  }

  // ---- scatter helpers (footprint bookkeeping so piles don't interpenetrate)
  private okey(x: number, z: number) { return (Math.floor(x) + 1000) * 4096 + (Math.floor(z) + 2000); }
  /** true if a circle (x,z,r) is free of my earlier scatter footprints */
  free(x: number, z: number, r: number) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.occ.get(this.okey(x + i, z + j));
      if (l) for (const [cx, cz, cr] of l) if (Math.hypot(x - cx, z - cz) < r + cr) return false;
    }
    return true;
  }
  claim(x: number, z: number, r: number) {
    const k = this.okey(x, z);
    const l = this.occ.get(k) ?? [];
    l.push([x, z, r]);
    this.occ.set(k, l);
  }

  // ------------------------------------------------------------------ build
  async build(game: Game, root: THREE.Group) {
    const t0 = performance.now();
    this.game = game;
    this.root = root;
    current = this;
    if (params.has('noreal')) { this.placements.length = 0; return; }
    const ids = [...new Set(this.placements.map((p) => p.id))];
    const models = await Promise.all(ids.map((id) => loadModel(id)));
    const q = game.engine.quality;
    const baseFar = q === 'low' ? 34 : q === 'medium' ? 48 : q === 'high' ? 64 : 85;
    const phys = game.physics;
    const R = phys?.R;
    if (phys) phys.world.updateSceneQueries();
    for (let k = 0; k < ids.length; k++) {
      const model = models[k];
      if (!model) continue;
      const id = ids[k], def = MODELS[id];
      const list = this.placements.filter((p) => p.id === id);
      const n = list.length;
      const matAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
      matAttr.setUsage(THREE.DynamicDrawUsage);
      const anyColor = model.parts.some((p) => p.tint);
      const colAttr = anyColor ? new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3) : null;
      colAttr?.setUsage(THREE.DynamicDrawUsage);
      const meshes = model.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geom, p.mat, n);
        im.instanceMatrix = matAttr;
        if (p.tint && colAttr) im.instanceColor = colAttr;
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = !!def.shadow;
        im.receiveShadow = true;
        im.name = 'real:' + id;
        im.matrixAutoUpdate = false;
        root.add(im);
        return im;
      });
      const batch: Batch = { id, def, model, meshes, inst: [], matAttr, colAttr, far: baseFar * (def.far ?? 1), dirty: true };
      this.batches.push(batch);
      for (const p of list) {
        const inst: Inst = { batch, m: new Float32Array(16), home: p.m.clone(), x: 0, y: 0, z: 0, r: model.radius * p.m.getMaxScaleOnAxis(), s: p.m.getMaxScaleOnAxis(), color: p.color, body: null, dyn: false, moved: false, kickT: 0, cell: -1 };
        p.m.toArray(inst.m);
        inst.x = inst.m[12]; inst.y = inst.m[13]; inst.z = inst.m[14];
        if (phys && R && p.phys !== 'none') this.makeBody(inst, p.phys, phys);
        batch.inst.push(inst);
      }
    }
    this.stats.instances = this.placements.length;
    this.stats.buildMs = Math.round(performance.now() - t0);
    console.info(`[realprops] ${this.placements.length} props, ${this.batches.length} models, ${this.stats.bodies} bodies (${this.stats.dynamic} dynamic) in ${this.stats.buildMs} ms`);
    (window as any).__realprops = this;
  }

  private makeBody(inst: Inst, kind: PhysKind, phys: NonNullable<Game['physics']>) {
    const R = phys.R, W = phys.world, def = inst.batch.def, model = inst.batch.model;
    const home = inst.home;
    home.decompose(_v, _q, _s);
    const sc = _s.x;
    const size = model.box.getSize(new THREE.Vector3()).multiplyScalar(sc);
    const ctr = model.box.getCenter(new THREE.Vector3()).multiplyScalar(sc);
    const boxDesc = () => R.ColliderDesc.cuboid(Math.max(0.02, size.x / 2), Math.max(0.02, size.y / 2), Math.max(0.02, size.z / 2)).setTranslation(ctr.x, ctr.y, ctr.z);
    let dyn = kind === 'dyn';
    if (dyn) {
      // a dynamic prop that starts inside static geometry would explode out when woken → keep it fixed
      const probe = new R.Cuboid(Math.max(0.01, size.x / 2 - 0.03), Math.max(0.01, size.y / 2 - 0.04), Math.max(0.01, size.z / 2 - 0.03));
      const c = _v.clone().add(new THREE.Vector3(ctr.x, ctr.y + 0.02, ctr.z).applyQuaternion(_q));
      const hit = W.intersectionWithShape({ x: c.x, y: c.y, z: c.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, probe, undefined, groups(G.ALL, G.STATIC));
      if (hit) dyn = false;
    }
    let cd: RAPIER.ColliderDesc | null;
    if (dyn) {
      const coll = def.collider ?? 'hull';
      if (coll === 'box') cd = boxDesc();
      else if (coll === 'cyl') cd = R.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2).setTranslation(ctr.x, ctr.y, ctr.z);
      else {
        let pts = model.hull;
        if (sc !== 1) pts = pts.map((v) => v * sc) as Float32Array;
        cd = R.ColliderDesc.convexHull(pts) ?? boxDesc();
      }
      cd.setMass(def.mass ?? 2).setFriction(def.friction ?? 0.6).setRestitution(def.restitution ?? 0.08)
        .setCollisionGroups(groups(G.ITEM, G.STATIC | G.ITEM | G.PLAYER | G.NPC | G.VEHICLE));
      const bd = R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y, _v.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setSleeping(true).setLinearDamping(0.12).setAngularDamping(0.35).setCcdEnabled(false);
      const body = W.createRigidBody(bd);
      W.createCollider(cd, body);
      inst.body = body;
      inst.dyn = true;
      this.byHandle.set(body.handle, inst);
      this.dynList.push(inst);
      this.gridInsert(inst);
      this.stats.dynamic++;
    } else {
      cd = boxDesc().setFriction(0.7).setCollisionGroups(groups(G.STATIC, G.ALL));
      const body = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(_v.x, _v.y, _v.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
      W.createCollider(cd, body);
      inst.body = body;
    }
    this.stats.bodies++;
  }

  private cellOf(x: number, z: number) { return (Math.floor(x / 2) + 500) * 2048 + (Math.floor(z / 2) + 1000); }
  private gridInsert(inst: Inst) {
    const c = this.cellOf(inst.x, inst.z);
    if (c === inst.cell) return;
    if (inst.cell >= 0) { const l = this.grid.get(inst.cell); if (l) { const i = l.indexOf(inst); if (i >= 0) l.splice(i, 1); } }
    let l = this.grid.get(c);
    if (!l) this.grid.set(c, (l = []));
    l.push(inst);
    inst.cell = c;
  }

  // ------------------------------------------------------------------ per frame
  frame(game: Game, dt: number) {
    const cam = game.camera;
    if (!cam || !this.batches.length) return;
    this.frameN++;
    // new day: the shopkeepers tidy everything back home overnight
    const day = (game.g as any).day ?? 0;
    if (this.day !== day) { if (this.day >= 0) this.resetAll(); this.day = day; }
    // awake bodies → instance matrices
    let awake = 0;
    const W = game.physics?.world;
    if (W) W.forEachActiveRigidBody((b) => {
      const inst = this.byHandle.get(b.handle);
      if (!inst) return;
      awake++;
      const t = b.translation(), r = b.rotation();
      if (t.y < -8 || Math.abs(t.x) > 400 || Math.abs(t.z) > 400) { this.resetInst(inst); return; }
      _m.compose(_v.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.setScalar(inst.s));
      _m.toArray(inst.m);
      inst.x = t.x; inst.y = t.y; inst.z = t.z;
      inst.moved = true;
      inst.batch.dirty = true;
      this.gridInsert(inst);
    });
    this.stats.awake = awake;
    this.kickByNpcs(game, dt);
    // culling / compaction
    cam.getWorldPosition(_v);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const camMoved = _v.distanceToSquared(this.lastCam) > 0.25 || dir.dot(this.lastDir) < 0.9985;
    if (!camMoved && (this.frameN % 8) !== 0 && !this.batches.some((b) => b.dirty)) return;
    if (camMoved) { this.lastCam.copy(_v); this.lastDir.copy(dir); }
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const cx = _v.x, cy = _v.y, cz = _v.z;
    let visible = 0, drawn = 0;
    for (const b of this.batches) {
      if (!camMoved && !b.dirty && (this.frameN % 8) !== 0) { visible += b.meshes[0]?.count ?? 0; continue; }
      b.dirty = false;
      const far2 = b.far * b.far;
      const ma = b.matAttr.array as Float32Array, ca = b.colAttr?.array as Float32Array | undefined;
      let n = 0;
      for (const it of b.inst) {
        const dx = it.x - cx, dy = it.y - cy, dz = it.z - cz;
        if (dx * dx + dy * dy + dz * dz > far2) continue;
        _sph.center.set(it.x, it.y + it.r * 0.5, it.z); _sph.radius = it.r + 1.2;
        if (!_frustum.intersectsSphere(_sph)) continue;
        ma.set(it.m, n * 16);
        if (ca) { const c = it.color; ca[n * 3] = c ? c.r : 1; ca[n * 3 + 1] = c ? c.g : 1; ca[n * 3 + 2] = c ? c.b : 1; }
        n++;
      }
      for (const m of b.meshes) { m.count = n; m.visible = n > 0; }
      if (n) { b.matAttr.clearUpdateRanges(); b.matAttr.addUpdateRange(0, n * 16); b.matAttr.needsUpdate = true; if (b.colAttr) { b.colAttr.clearUpdateRanges(); b.colAttr.addUpdateRange(0, n * 3); b.colAttr.needsUpdate = true; } }
      visible += n;
      if (n) drawn += b.meshes.length;
    }
    this.stats.visible = visible;
    this.stats.drawn = drawn;
  }

  /** NPCs have no physics bodies: kick the props they walk into (client-local, from replicated positions) */
  private kickByNpcs(game: Game, dt: number) {
    if (!dt) return;
    const now = performance.now() / 1000;
    const seen = new Set<number>();
    const ents = game.state.all('npc');
    for (const e of ents) {
      const p = e.p;
      if (!p) continue;
      seen.add(e.id);
      const prev = this.npcPrev.get(e.id);
      this.npcPrev.set(e.id, [p[0], p[1], p[2]]);
      if (!prev) continue;
      const vx = (p[0] - prev[0]) / dt, vz = (p[2] - prev[2]) / dt;
      const sp = Math.hypot(vx, vz);
      if (sp < 0.3 || sp > 12) continue;
      const cx = Math.floor(p[0] / 2), cz = Math.floor(p[2] / 2);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = this.grid.get((cx + i + 500) * 2048 + (cz + j + 1000));
        if (!l) continue;
        for (const it of l) {
          if (!it.body || now - it.kickT < 0.5) continue;
          const dx = it.x - p[0], dz = it.z - p[2];
          const d = Math.hypot(dx, dz);
          if (d > 0.32 + Math.min(0.35, it.r * 0.6) || it.y > p[1] + 0.9) continue;
          // push along the walking direction, a bit sideways away from the legs, plus a little lift
          const mass = it.body.mass();
          const k = mass * Math.min(2.2, sp) * 0.75;
          const nx = vx / sp + (dx / (d || 1)) * 0.6, nz = vz / sp + (dz / (d || 1)) * 0.6;
          it.body.applyImpulseAtPoint({ x: nx * k, y: k * 0.25, z: nz * k }, { x: it.x, y: it.y + 0.25, z: it.z }, true);
          it.kickT = now;
        }
      }
    }
    if (this.npcPrev.size > seen.size + 32) for (const id of [...this.npcPrev.keys()]) if (!seen.has(id)) this.npcPrev.delete(id);
  }

  private resetInst(inst: Inst) {
    const b = inst.body;
    inst.home.toArray(inst.m);
    inst.x = inst.m[12]; inst.y = inst.m[13]; inst.z = inst.m[14];
    inst.moved = false;
    inst.batch.dirty = true;
    this.gridInsert(inst);
    if (!b) return;
    inst.home.decompose(_v, _q, _s);
    b.setTranslation({ x: _v.x, y: _v.y, z: _v.z }, false);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, false);
    b.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.setAngvel({ x: 0, y: 0, z: 0 }, false);
    b.sleep();
  }
  resetAll() { for (const it of this.dynList) if (it.moved) this.resetInst(it); }

  dispose() {
    for (const b of this.batches) for (const m of b.meshes) m.removeFromParent();
    this.batches = [];
    this.byHandle.clear();
    this.dynList = [];
    this.grid.clear();
    if (current === this) current = null;
  }
}

let current: RealProps | null = null;
/** world module frame hook */
export function realPropsFrame(game: Game, dt: number) { if (current && game.scene && current["root"]?.parent === game.scene) current.frame(game, dt); }
export function realProps() { return current; }
