import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Sound } from '../../core/audio';
import { Assets } from '../../core/assets';

/* Shared helpers for the escape module: own sounds (registered into the Sound manifest at runtime),
 * own GLB models (gen/escape/models, Poly Haven CC0), small math. */

export const GEN = 'gen/escape/';

/** key → [file in gen/escape/audio, volume, loop, bus] (sources: public/assets/gen/escape/CREDITS.md) */
const SND: Record<string, [string, number, boolean, string]> = {
  esc_siren_whoop: ['siren_whoop.mp3', 0.75, false, 'sfx'],
  esc_siren_loop: ['siren_loop.mp3', 0.55, false, 'sfx'],
  esc_whistle: ['whistle.mp3', 0.8, false, 'sfx'],
  esc_whistle_short: ['whistle_short.mp3', 0.8, false, 'sfx'],
  esc_car_door: ['car_door.mp3', 0.7, false, 'sfx'],
  esc_truck_stop: ['truck_stop.mp3', 0.65, false, 'sfx'],
  esc_truck_leave: ['truck_leave.mp3', 0.65, false, 'sfx'],
  esc_sneaky: ['sneaky_snitch.mp3', 0.6, false, 'music'],
  esc_relief: ['relief_breath.mp3', 0.75, false, 'voice'],
};

/** Add our sound keys to the shared manifest (no edit of the shared manifest file). Idempotent. */
export function registerSounds() {
  const m = Sound.manifest as Record<string, any>;
  for (const [k, [f, vol, loop, cat]] of Object.entries(SND)) {
    if (!m[k]) m[k] = { files: ['../' + GEN + 'audio/' + f], vol, loop, cat, pitchVar: 0.03 };
  }
}

/** first existing key */
export function sk(...keys: string[]) { for (const k of keys) if (Sound.has(k)) return k; return keys[keys.length - 1]; }

// ------------------------------------------------------------------ GLB models (own folder)

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const glbCache = new Map<string, Promise<THREE.Object3D | null>>();

/** Load one of our Poly Haven GLBs, normalised: origin bottom-centre. Returns a fresh clone. */
export function loadGlb(id: string, o: { shadow?: boolean } = {}): Promise<THREE.Object3D | null> {
  let p = glbCache.get(id);
  if (!p) {
    p = loader.loadAsync(Assets.url(`${GEN}models/${id}/${id}.glb`)).then((g) => {
      const root = g.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      wrap.name = 'glb:' + id;
      root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
      wrap.add(root);
      root.traverse((m: any) => {
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat) { mat.envMapIntensity = 0.6; if (mat.map) mat.map.anisotropy = 4; }
      });
      return wrap as THREE.Object3D;
    }).catch((e) => { console.warn('[escape] model failed', id, e); return null; });
    glbCache.set(id, p);
  }
  return p.then((m) => {
    if (!m) return null;
    const c = m.clone(true);
    c.traverse((x: any) => { if (x.isMesh) { x.castShadow = o.shadow ?? true; x.receiveShadow = true; } });
    return c;
  });
}

/** Bake a group's meshes into one merged mesh per material (few draw calls for prop clusters). */
export function mergeGroup(src: THREE.Object3D, shadow = true): THREE.Group {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o: any) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const g0 = o.geometry as THREE.BufferGeometry;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = g0.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      const n = a.itemSize, out = new Float32Array(a.count * n);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(out, n));
    }
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (g0.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g0.index.array as ArrayLike<number>), 1));
    else { const n = g.getAttribute('position').count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
  });
  const out = new THREE.Group();
  for (const [mat, gs] of byMat) {
    const g = gs.length > 1 ? mergeGeometries(gs, false) : gs[0];
    if (!g) continue;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

// ------------------------------------------------------------------ math

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOut = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function pick<T>(arr: readonly T[], r = Math.random()): T { return arr[Math.floor(r * arr.length) % arr.length]; }
