import * as THREE from 'three';

/* ============================================================================================
 * Small-detail distance culling. Thousands of tiny instanced things (clothes pegs, fruit in
 * market piles, bottles on shop shelves, hangers…) used to be ONE map-wide InstancedMesh each,
 * so frustum culling could never drop them and every one was drawn (and shadow-rendered) every
 * frame: ~4–11 M triangles. Here:
 *   splitByGrid(im, cell)  → one InstancedMesh per grid cell (tight bounding spheres)
 *   DetailCull.add(obj, maxDist) → hidden when the camera is farther than maxDist from its
 *                                  bounding sphere (checked a few times per second, cheap)
 * ========================================================================================== */

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Sphere();
const _c = new THREE.Color();

/** Split an InstancedMesh into per-cell InstancedMeshes (same geometry/material, shared). */
export function splitByGrid(im: THREE.InstancedMesh, cell = 12): THREE.InstancedMesh[] {
  const n = im.count;
  if (n <= 24) { im.computeBoundingSphere(); return [im]; }
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, _m);
    _p.setFromMatrixPosition(_m);
    const k = Math.floor(_p.x / cell) + ',' + Math.floor(_p.z / cell);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(i);
  }
  if (buckets.size <= 1) { im.computeBoundingSphere(); return [im]; }
  const out: THREE.InstancedMesh[] = [];
  for (const idx of buckets.values()) {
    const part = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
    idx.forEach((src, j) => {
      im.getMatrixAt(src, _m); part.setMatrixAt(j, _m);
      if (im.instanceColor) { im.getColorAt(src, _c); part.setColorAt(j, _c); }
    });
    part.instanceMatrix.needsUpdate = true;
    if (part.instanceColor) part.instanceColor.needsUpdate = true;
    part.castShadow = im.castShadow; part.receiveShadow = im.receiveShadow;
    part.name = im.name; part.renderOrder = im.renderOrder; part.layers.mask = im.layers.mask;
    part.userData = { ...im.userData };
    part.computeBoundingSphere();
    out.push(part);
  }
  return out;
}

interface Entry { obj: THREE.Object3D; max: number; sphere: THREE.Sphere | null }

class DetailCuller {
  private list: Entry[] = [];
  private t = 0;
  private i = 0;
  /** quality scale for the distances (low quality pulls them in) */
  scale = 1;

  add(obj: THREE.Object3D, maxDist: number) { this.list.push({ obj, max: maxDist, sphere: null }); }
  remove(obj: THREE.Object3D) { this.list = this.list.filter((e) => e.obj !== obj); }
  clear() { this.list = []; }

  private sphereOf(e: Entry): THREE.Sphere | null {
    if (e.sphere) return e.sphere;
    const o: any = e.obj;
    o.updateMatrixWorld?.(true);
    if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); _s.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); }
    else if (o.isMesh) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); _s.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); }
    else { const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return null; b.getBoundingSphere(_s); }
    // static details: cache the world sphere
    e.sphere = _s.clone();
    return e.sphere;
  }

  /** call every frame; re-checks a slice of the list (all of it ~4× per second) */
  update(camera: THREE.Camera, dt: number) {
    const n = this.list.length;
    if (!n) return;
    this.t += dt;
    const per = Math.max(1, Math.ceil(n * Math.min(1, dt * 4)));
    camera.getWorldPosition(_p);
    for (let k = 0; k < per; k++) {
      if (this.i >= this.list.length) this.i = 0;
      const e = this.list[this.i++];
      if (!e.obj.parent) continue;
      const s = this.sphereOf(e);
      if (!s) continue;
      const d = _p.distanceTo(s.center) - s.radius;
      e.obj.visible = d < e.max * this.scale;
    }
  }
}

export const DetailCull = new DetailCuller();
