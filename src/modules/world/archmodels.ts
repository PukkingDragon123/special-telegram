import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Assets } from '../../core/assets';
import { DetailCull } from '../../core/detailcull';

/**
 * ARCHITECTURE MODELS — real models from the shared library (public/assets/gen/lib/arch/*.glb, see catalog.json)
 * placed by the world builders (AC condensers on every facade, rooftop units, …). Builders record placements
 * during the build (world matrices); after the build the GLBs are loaded once and drawn as InstancedMeshes,
 * one per primitive per 16 m cell (tight bounds → three's frustum culling drops the cells behind the camera),
 * distance-culled by DetailCull (follows the quality / frame-budget scale), shadows only within ~24 m.
 */

const CELL = 16;
/** draw distance of facade units (AC condensers, pole arms…) before DetailCull's quality scale */
const FAR = 80;
const SHADOW_NEAR = 24;

interface Cell { meshes: THREE.InstancedMesh[]; center: THREE.Vector3; radius: number }

export class ArchModels {
  private placements = new Map<string, THREE.Matrix4[]>();
  private cells: Cell[] = [];
  private root: THREE.Group | null = null;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _v = new THREE.Vector3(); private _s = new THREE.Vector3();

  /** forget placements (new world build) */
  reset() { for (const c of this.cells) for (const m of c.meshes) DetailCull.remove(m); this.placements.clear(); this.cells = []; this.root = null; }

  /** record a placement: parent (current builder transform) × T(x,y,z) × Ry(yaw) × S */
  add(id: string, parent: THREE.Matrix4, x: number, y: number, z: number, yaw = 0, s: number | [number, number, number] = 1) {
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), yaw);
    if (typeof s === 'number') this._s.set(s, s, s); else this._s.set(s[0], s[1], s[2]);
    this._m.compose(this._v.set(x, y, z), this._q, this._s);
    const m = parent.clone().multiply(this._m);
    let a = this.placements.get(id);
    if (!a) { a = []; this.placements.set(id, a); }
    a.push(m);
  }

  count(id?: string) { return id ? this.placements.get(id)?.length ?? 0 : [...this.placements.values()].reduce((s, a) => s + a.length, 0); }

  /** load the models and create the instanced meshes under `parent` (non-blocking for the caller) */
  async build(parent: THREE.Object3D) {
    const root = (this.root = new THREE.Group());
    root.name = 'arch-models';
    parent.add(root);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    await Promise.all([...this.placements.entries()].map(async ([id, list]) => {
      let gltf: any;
      try { gltf = await loader.loadAsync(Assets.url(`gen/lib/arch/${id}.glb`)); } catch (e) { console.warn('[world] arch model', id, e); return; }
      if (this.root !== root) return;          // world rebuilt meanwhile
      const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat.map) mat.map.anisotropy = Assets.maxAnisotropy;
          mat.envMapIntensity = 1.0;
          // blended grilles → alpha-tested (no sorting issues, correct shadows)
          if (mat.transparent) { mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; }
        }
        parts.push({ geo: o.geometry, mat: mats[0], local: o.matrixWorld.clone() });
      });
      // bucket placements into cells
      const byCell = new Map<string, THREE.Matrix4[]>();
      for (const m of list) {
        const k = Math.floor(m.elements[12] / CELL) + ',' + Math.floor(m.elements[14] / CELL);
        let a = byCell.get(k); if (!a) byCell.set(k, (a = []));
        a.push(m);
      }
      for (const ms of byCell.values()) {
        const cell: Cell = { meshes: [], center: new THREE.Vector3(), radius: 0 };
        for (const m of ms) cell.center.add(this._v.setFromMatrixPosition(m));
        cell.center.multiplyScalar(1 / ms.length);
        for (const m of ms) cell.radius = Math.max(cell.radius, this._v.setFromMatrixPosition(m).distanceTo(cell.center) + 1.5);
        for (const p of parts) {
          const im = new THREE.InstancedMesh(p.geo, p.mat, ms.length);
          for (let i = 0; i < ms.length; i++) im.setMatrixAt(i, this._m.copy(ms[i]).multiply(p.local));
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          im.castShadow = true; im.receiveShadow = true;
          im.name = 'arch:' + id;
          root.add(im);
          DetailCull.add(im, FAR);
          cell.meshes.push(im);
        }
        this.cells.push(cell);
      }
    }));
  }

  /** per frame (cheap): shadows only near the camera (visibility is DetailCull's) */
  update(cam: THREE.Vector3) {
    for (const c of this.cells) {
      const sh = c.center.distanceTo(cam) - c.radius < SHADOW_NEAR;
      for (const m of c.meshes) m.castShadow = sh;
    }
  }
}

/** the world's instance registry (filled by shophouse.ts etc. during buildWorld) */
export const ARCH = new ArchModels();
