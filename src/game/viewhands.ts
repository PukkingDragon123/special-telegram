import * as THREE from 'three';
import type { Game } from './game';
import type { CharacterRig } from './contracts';

/* =============================================================================================
 * FIRST-PERSON HANDS — the player's own forearm + hand (same body, skin tone and sleeve as the
 * character: baked from a private copy of the player's rig in its carry/grip pose) actually holding
 * the selected item in the view model. One hand for normal items, both hands for big / two-handed
 * ones. The hand comes up with the item when you pick it / switch to it, and flicks forward when the
 * item leaves the hand (put in the wok, plated, dropped, thrown).
 *
 * Baking: the rig's skinned mesh in pose → static geometry (exactly the skinning shader's maths),
 * keeping only triangles weighted to the forearm / hand / finger bones of one side; the elbow →
 * wrist axis and the grip point (attach 'hand_r'/'hand_l') are measured in the same pose, so the
 * arm can be laid onto any item: grip point on the item, forearm running down-right toward the
 * camera.
 * ============================================================================================= */

interface Bake { geo: THREE.BufferGeometry; elbow: THREE.Vector3; wrist: THREE.Vector3; grip: THREE.Vector3; side: 1 | -1 }

const KEEP = (side: 'r' | 'l') => new RegExp(`^(lowerarm|hand|thumb|index|middle|ring|pinky)(_\\d+)?_${side}$`);

export class ViewHands {
  readonly group = new THREE.Group();
  private rig: CharacterRig | null = null;
  private lookKey = '';
  private steps = 0;
  private bakes: { r: Bake | null; l: Bake | null } = { r: null, l: null };
  private meshR: THREE.Mesh | null = null;
  private meshL: THREE.Mesh | null = null;
  private mats: THREE.Material[] = [];
  private rigMat: any = null;
  /** release flick (0 → 1) after the held item left the hand */
  private flick = 1;
  private lastHeld: number | null = null;
  private last = { r: new THREE.Matrix4(), l: new THREE.Matrix4(), two: false };
  /** forearm direction (toward the elbow, view-model space) + roll — exposed for tuning */
  tune = { x: 0.12, y: -0.95, z: 0.3, roll: -0.4, gx: 0.3, gy: 0.15, gz: 0.25 };
  /** while a hand is shown the view model moves in a bit (so the hand is in frame, not cut by the screen edge) */
  readonly vmShift = new THREE.Vector3(-0.09, 0.07, 0.02);
  get holding() { return !!this.meshR?.visible; }
  private _bb = new THREE.Box3();
  private _bt = new THREE.Box3();

  constructor(private game: Game, viewModel: THREE.Object3D) {
    this.group.name = 'vm-hands';
    viewModel.add(this.group);
  }

  dispose() {
    this.rig?.dispose(); this.rig = null;
    for (const m of [this.meshR, this.meshL]) if (m) { m.geometry.dispose(); m.removeFromParent(); }
    this.meshR = this.meshL = null;
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }

  /** keep a private rig of the player's look and bake once it has posed */
  private ensureBake() {
    const me = this.game.me;
    if (!me?.look) return false;
    const key = JSON.stringify(me.look);
    if (key !== this.lookKey) {
      this.dispose();
      this.lookKey = key;
      this.bakes = { r: null, l: null };
      this.steps = 0;
      try { this.rig = this.game.chars.create(me.look, { lod: 'high', castShadow: false }); } catch { this.rig = null; }
    }
    const rig = this.rig;
    if (!rig) return false;
    if (this.bakes.r && this.bakes.l) return true;
    // a two-hand carry curls both hands into a grip; let the pose settle a few updates (async clips/atlas)
    rig.setCarry({ r: true, l: true, two: false, head: false, load: 0 });
    rig.update(1 / 30);
    this.steps++;
    if (this.steps < 24 || this.steps % 8) return false;
    const sm: THREE.SkinnedMesh | undefined = (rig as any).mesh_ ?? (rig as any).mesh;
    if (!sm?.isSkinnedMesh) return false;
    const r = this.bakeSide(rig, sm, 'r'), l = this.bakeSide(rig, sm, 'l');
    if (!r || !l) return false;
    this.bakes = { r, l };
    this.rigMat = Array.isArray(sm.material) ? sm.material[0] : sm.material;
    const accMat = Array.isArray(sm.material) ? sm.material[1] : null;
    const mk = (src: any) => {
      const m = new THREE.MeshStandardMaterial({ map: src?.map ?? null, roughness: 0.75, metalness: 0 });
      m.name = 'vm-hand';
      return m;
    };
    const skin = mk(this.rigMat), acc = mk(accMat ?? this.rigMat);
    this.mats = [skin, acc];
    this.meshR = new THREE.Mesh(r.geo, [skin, acc]);
    this.meshL = new THREE.Mesh(l.geo, [skin, acc]);
    for (const m of [this.meshR, this.meshL]) {
      m.matrixAutoUpdate = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 1;
      m.visible = false;
      this.group.add(m);
    }
    return true;
  }

  private bakeSide(rig: CharacterRig, sm: THREE.SkinnedMesh, side: 'r' | 'l'): Bake | null {
    const re = KEEP(side);
    const bones = sm.skeleton.bones;
    const keep = new Uint8Array(bones.length);
    let lower: THREE.Bone | null = null, hand: THREE.Bone | null = null;
    bones.forEach((b, i) => {
      if (re.test(b.name)) keep[i] = 1;
      if (b.name === 'lowerarm_' + side) lower = b;
      if (b.name === 'hand_' + side) hand = b;
    });
    if (!lower || !hand) return null;
    const root = rig.root;
    root.updateMatrixWorld(true);
    sm.skeleton.update();
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const elbow = (lower as THREE.Bone).getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const wrist = (hand as THREE.Bone).getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const grip = rig.attach(side === 'r' ? 'hand_r' : 'hand_l').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    if (elbow.distanceTo(wrist) < 0.05) return null;
    const geo = bakeSkinnedMasked(sm, root, keep);
    if (!geo) return null;
    return { geo, elbow, wrist, grip, side: side === 'r' ? 1 : -1 };
  }

  /**
   * Lay one baked arm so its grip point sits at `grip` (view-model space) with the forearm coming in
   * from `from` (the direction toward the elbow, view-model space).
   */
  private place(b: Bake, grip: THREE.Vector3, toElbow: THREE.Vector3, roll: number, out: THREE.Matrix4) {
    // source basis: x = wrist→elbow, y = up orthogonalised
    const sx = b.elbow.clone().sub(b.wrist).normalize();
    const sy = new THREE.Vector3(0, 1, 0).addScaledVector(sx, -sx.y).normalize();
    const sz = new THREE.Vector3().crossVectors(sx, sy);
    const tx = toElbow.clone().normalize();
    const up = new THREE.Vector3(Math.sin(roll) * b.side, Math.cos(roll), 0);
    const ty = up.addScaledVector(tx, -up.dot(tx)).normalize();
    const tz = new THREE.Vector3().crossVectors(tx, ty);
    const S = new THREE.Matrix4().makeBasis(sx, sy, sz);
    const T = new THREE.Matrix4().makeBasis(tx, ty, tz);
    const R = T.multiply(S.transpose());
    out.makeTranslation(grip.x, grip.y, grip.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-b.grip.x, -b.grip.y, -b.grip.z));
  }

  /**
   * Per frame (first person only). `holder` = the view-model object of the selected item (or null),
   * `two` = hold it with both hands.
   */
  update(dt: number, holder: THREE.Object3D | null, heldId: number | null, two: boolean, show: boolean) {
    if (!show) { this.group.visible = false; return; }
    if (!this.ensureBake() || !this.meshR || !this.meshL) { this.group.visible = false; return; }
    // the atlas texture can be repainted / swapped (higher-res upgrade, outfit change): follow it
    const map = this.rigMat?.map ?? null;
    for (const m of this.mats) if ((m as any).map !== map) { (m as any).map = map; m.needsUpdate = true; }
    this.group.visible = true;
    if (heldId !== this.lastHeld) {
      if (this.lastHeld != null && heldId == null) this.flick = 0;    // the item left the hand → flick
      this.lastHeld = heldId;
    }
    if (holder && heldId != null) {
      this.flick = 1;
      // the item's bounds in view-model space
      this._bb.makeEmpty();
      holder.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(this.group.parent!.matrixWorld).invert();
      holder.traverseVisible((c: any) => {
        if (!c.isMesh || !c.geometry || c.name === 'vm-hand') return;
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        this._bt.copy(c.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        this._bb.union(this._bt);
      });
      if (this._bb.isEmpty()) { this.meshR.visible = this.meshL.visible = false; return; }
      const bb = this._bb, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      const lowY = bb.min.y + Math.min(0.09, sz.y * 0.32);
      if (two) {
        const gr = new THREE.Vector3(bb.max.x - Math.min(0.02, sz.x * 0.1), lowY, c.z + sz.z * 0.1);
        const gl = new THREE.Vector3(bb.min.x + Math.min(0.02, sz.x * 0.1), lowY, c.z + sz.z * 0.1);
        this.place(this.bakes.r!, gr, new THREE.Vector3(0.35, -0.55, 0.75), -1.2, this.last.r);
        this.place(this.bakes.l!, gl, new THREE.Vector3(-0.35, -0.55, 0.75), -1.2, this.last.l);
      } else {
        // wrap the right side of the item, a little below its middle
        // grip toward the lower right of the item (palm under/behind it), forearm running down toward the camera
        const T = this.tune;
        const gr = new THREE.Vector3(c.x + sz.x * T.gx, bb.min.y + sz.y * T.gy, c.z + sz.z * T.gz);
        this.place(this.bakes.r!, gr, new THREE.Vector3(this.tune.x, this.tune.y, this.tune.z), this.tune.roll, this.last.r);
      }
      this.last.two = two;
      this.meshR.matrix.copy(this.last.r);
      this.meshR.visible = true;
      this.meshL.matrix.copy(this.last.l);
      this.meshL.visible = two;
      return;
    }
    // nothing held: finish the release flick (hand pushes forward and drops out of view), then hide
    if (this.flick < 1) {
      this.flick = Math.min(1, this.flick + dt * 3.2);
      const f = this.flick;
      const push = new THREE.Matrix4().makeTranslation(0, -0.35 * f * f + 0.05 * Math.sin(f * Math.PI), -0.16 * Math.sin(Math.min(1, f * 1.6) * Math.PI * 0.5));
      this.meshR.matrix.copy(push).multiply(this.last.r);
      this.meshL.matrix.copy(push).multiply(this.last.l);
      this.meshR.visible = true; this.meshL.visible = this.last.two;
      return;
    }
    this.meshR.visible = this.meshL.visible = false;
  }
}

/** Skinned mesh in its current pose → static geometry in `root` space, only triangles whose three
 *  vertices are mostly weighted to the kept bones. */
function bakeSkinnedMasked(sm: THREE.SkinnedMesh, root: THREE.Object3D, keep: Uint8Array): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  sm.skeleton.update();
  const src = sm.geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const si = src.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = src.getAttribute('skinWeight') as THREE.BufferAttribute;
  const idx = src.index;
  if (!pos || !si || !sw) return null;
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let k = 0;
    for (let j = 0; j < 4; j++) { const wt = sw.getComponent(i, j); if (wt > 0 && keep[si.getComponent(i, j)]) k += wt; }
    w[i] = k;
  }
  const tri = (a: number, b: number, c: number) => w[a] > 0.5 && w[b] > 0.5 && w[c] > 0.5;
  // remap kept vertices
  const map = new Int32Array(pos.count).fill(-1);
  const out: number[] = [];
  const groups: { start: number; count: number; mat: number }[] = [];
  const ranges = src.groups.length ? src.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
  let nv = 0;
  for (const g of ranges) {
    const start = out.length;
    for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      if (!tri(a, b, c)) continue;
      for (const v of [a, b, c]) { if (map[v] < 0) map[v] = nv++; out.push(map[v]); }
    }
    if (out.length > start) groups.push({ start, count: out.length - start, mat: g.materialIndex ?? 0 });
  }
  if (!nv) return null;
  const bm = sm.skeleton.boneMatrices!;
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(sm.matrixWorld).multiply(sm.bindMatrixInverse);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  const M = new THREE.Matrix4(), Mk = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3(), N3 = new THREE.Matrix3();
  for (let i = 0; i < pos.count; i++) {
    const o = map[i];
    if (o < 0) continue;
    M.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const wt = sw.getComponent(i, k);
      if (wt <= 0) continue;
      Mk.fromArray(bm, si.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) M.elements[e] += Mk.elements[e] * wt;
    }
    M.premultiply(toLocal).multiply(sm.bindMatrix);
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
    if (nrm) { n.fromBufferAttribute(nrm, i).applyMatrix3(N3.getNormalMatrix(M)).normalize(); N[o * 3] = n.x; N[o * 3 + 1] = n.y; N[o * 3 + 2] = n.z; }
    if (uv) { U[o * 2] = uv.getX(i); U[o * 2 + 1] = uv.getY(i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(out);
  for (const gr of groups) g.addGroup(gr.start, gr.count, gr.mat);
  if (!nrm) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
