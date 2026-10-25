import * as THREE from 'three';
import { U } from './mats';

/**
 * PLANAR STREET REFLECTION — the scene mirrored in the ground plane (y = PLANE_Y), rendered at reduced
 * resolution into a mip-mapped HDR target. The world material samples it projectively in puddles and on
 * wet ground (sharp in standing water, blurry mips on damp asphalt) — signs, lamps and facades shimmer in
 * the puddles day and night.
 *
 * Only objects on REFL_LAYER are drawn (world chunks, signs, sky, light glows). Every light in the scene
 * is put on the layer too (1 Hz sweep), so light counts — and therefore shader programs — stay identical to
 * the main pass (no recompiles). Shadow maps are reused from the main pass.
 */
export const REFL_LAYER = 5;
const PLANE_Y = 0.02;

export class PlanarReflection {
  readonly rt: THREE.WebGLRenderTarget;
  private cam = new THREE.PerspectiveCamera();
  private sweep = 0;
  private frame = 0;
  private size = new THREE.Vector2();

  /** scale = fraction of the drawing buffer size; every = render every n-th frame */
  constructor(private renderer: THREE.WebGLRenderer, private scale = 0.5, private every = 1) {
    this.rt = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.rt.texture.name = 'street-reflection';
    this.cam.layers.set(REFL_LAYER);
    U.uRefl.value = this.rt.texture;
    U.uReflOn.value = 1;
  }

  /** mark an object (and its descendants) as reflected */
  static tag(o: THREE.Object3D) { o.traverse((c) => c.layers.enable(REFL_LAYER)); }

  private _rp = new THREE.Vector3(); private _cp = new THREE.Vector3(); private _n = new THREE.Vector3(0, 1, 0);
  private _view = new THREE.Vector3(); private _look = new THREE.Vector3(); private _tgt = new THREE.Vector3();
  private _rot = new THREE.Matrix4(); private _plane = new THREE.Plane(); private _clip = new THREE.Vector4(); private _q = new THREE.Vector4();
  private _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  update(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number) {
    const R = this.renderer;
    // keep every light on the reflection layer (same light setup → same programs)
    this.sweep -= dt;
    if (this.sweep <= 0) { this.sweep = 1; scene.traverse((o) => { if ((o as any).isLight) o.layers.enable(REFL_LAYER); }); }
    if (this.frame++ % this.every !== 0) return;
    R.getDrawingBufferSize(this.size);
    const w = Math.max(16, Math.floor(this.size.x * this.scale)), h = Math.max(16, Math.floor(this.size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    // ---- mirror camera (three's Reflector math, plane normal +Y through (0, PLANE_Y, 0))
    const rp = this._rp.set(0, PLANE_Y, 0), n = this._n;
    const cp = this._cp.setFromMatrixPosition(camera.matrixWorld);
    if (cp.y < PLANE_Y + 0.05) { U.uReflOn.value = 0; return; }
    rp.x = cp.x; rp.z = cp.z;
    const view = this._view.subVectors(rp, cp).reflect(n).negate().add(rp);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(cp);
    const tgt = this._tgt.subVectors(rp, look).reflect(n).negate().add(rp);
    const vc = this.cam;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(n);
    vc.lookAt(tgt);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // projective lookup matrix for the material
    U.uReflMat.value.copy(this._bias).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane = the mirror plane (nothing below the street is drawn)
    this._plane.setFromNormalAndCoplanarPoint(n, rp).applyMatrix4(vc.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = vc.projectionMatrix.elements, q = this._q;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1.0;
    q.w = (1.0 + pm[10]) / pm[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1.0 - 0.003; pm[14] = clip.w;

    // ---- render (no feedback: the world material must not sample the target it is drawn into)
    const prevRT = R.getRenderTarget();
    const prevAuto = R.shadowMap.autoUpdate;
    const prevOn = U.uReflOn.value;
    const prevTex = U.uRefl.value;
    U.uReflOn.value = 0;
    U.uRefl.value = BLACK;
    R.shadowMap.autoUpdate = false;
    R.setRenderTarget(this.rt);
    R.state.buffers.depth.setMask(true);
    R.clear();
    R.render(scene, vc);
    R.setRenderTarget(prevRT);
    R.shadowMap.autoUpdate = prevAuto;
    U.uRefl.value = prevTex;
    U.uReflOn.value = prevOn || 1;
  }

  dispose() {
    U.uReflOn.value = 0;
    U.uRefl.value = BLACK;
    this.rt.dispose();
  }
}

const BLACK = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();

/**
 * Hook the reflection into the world scene: tags the static world chunks (base group + signs), the sky and the
 * light glows, and renders the mirror view right before each main-camera render of the scene (camera already
 * updated for this frame → no lag). Returns a disposer. Off at `low`.
 */
export function installReflection(game: { engine: { renderer: THREE.WebGLRenderer; quality: string; frame: number }; camera: THREE.Camera; scene: THREE.Scene | null },
  meshes: { mesh: THREE.Mesh; kind: string; group: string }[], extra: THREE.Object3D[]): () => void {
  const q = game.engine.quality;
  const qp = new URLSearchParams(location.search);
  // high / ultra (or ?refl to force); medium & low use env-map reflections on the wet ground only
  if (!(q === 'high' || q === 'ultra' || qp.has('refl')) || qp.has('norefl')) { U.uReflOn.value = 0; return () => {}; }
  const scene = game.scene!;
  const refl = new PlanarReflection(game.engine.renderer, q === 'ultra' ? 0.6 : q === 'high' ? 0.5 : 0.38, 1);
  for (const m of meshes) if (m.group === 'base' && (m.kind === 'world' || m.kind === 'sign' || m.kind === 'cut')) m.mesh.layers.enable(REFL_LAYER);
  for (const o of extra) PlanarReflection.tag(o);
  const prev = scene.onBeforeRender;
  let lastFrame = -1, lastT = performance.now();
  scene.onBeforeRender = function (renderer, sc, camera, rt) {
    prev.call(this, renderer, sc, camera, rt);
    if (camera !== game.camera || lastFrame === game.engine.frame) return;
    lastFrame = game.engine.frame;
    const now = performance.now();
    refl.update(scene, camera as THREE.PerspectiveCamera, (now - lastT) / 1000);
    lastT = now;
  };
  return () => { scene.onBeforeRender = prev; refl.dispose(); };
}
