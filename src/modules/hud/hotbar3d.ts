import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';

/* ============================================================================================
 * 3D inventory hotbar: the REAL item models (ItemDef.build) float in a row at the bottom of the
 * screen, slowly turning, lit like a little product shot; the selected one is bigger, lifted
 * and spins faster; items pop in when picked up and shrink away when dropped. Drawn straight
 * onto the canvas after post-processing (engine.onOverlay) with its own ortho camera in CSS
 * pixels, so it costs one tiny render of ≤5 objects. No boxes, no panels.
 * ========================================================================================== */

interface Item {
  eid: number;
  sig: string;
  root: THREE.Group;        // positioned per slot
  spin: THREE.Group;        // rotates
  obj: THREE.Object3D | null;
  radius: number;           // model bounding radius (model units)
  center: THREE.Vector3;
  scale: number; scaleV: number;
  lift: number;
  retry: number;
  dataSig: string;
  refreshT: number;
  leaving: boolean;
  slot: number; span: number;
}

const ACES = THREE.ACESFilmicToneMapping;

export class Hotbar3D {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  private items = new Map<number, Item>();
  private dots: THREE.Mesh[] = [];
  private glow: THREE.Mesh;
  private size = new THREE.Vector2();
  visible = false;
  /** slot centres in CSS px from the bottom-centre (read by the DOM labels) */
  readonly slotX: number[] = [0, 0, 0, 0, 0];
  slotSize = 70;
  baseY = 60;
  private t = 0;
  private sel = 0;

  constructor(private game: Game) {
    const hemi = new THREE.HemisphereLight(0xfff4e2, 0x2a2420, 1.25);
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-0.6, 1, 1.4);
    const rim = new THREE.DirectionalLight(0xffd9a0, 1.6); rim.position.set(1.2, 0.6, -1);
    this.scene.add(hemi, key, rim);
    const dotGeo = new THREE.CircleGeometry(1, 24);
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
      d.renderOrder = -1;
      this.scene.add(d); this.dots.push(d);
    }
    // soft warm glow under the selected item
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    const x = gc.getContext('2d')!;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,120,0.55)'); gr.addColorStop(0.45, 'rgba(255,190,80,0.18)'); gr.addColorStop(1, 'rgba(255,180,60,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.glow.renderOrder = -2;
    this.scene.add(this.glow);
    game.engine.onOverlay(() => this.render());
  }

  /** sync with the local player's inventory (call every frame) */
  update(dt: number, me: Ent | undefined, show: boolean) {
    this.t += dt;
    this.visible = show && !!me;
    if (!me) return;
    const R = this.game.engine.renderer;
    R.getSize(this.size);
    const W = this.size.x, H = this.size.y;
    this.cam.left = -W / 2; this.cam.right = W / 2; this.cam.top = H / 2; this.cam.bottom = -H / 2;
    this.cam.updateProjectionMatrix();
    this.slotSize = Math.max(54, Math.min(84, W * 0.052));
    const gap = this.slotSize * 1.12;
    this.baseY = Math.max(46, H * 0.075);
    for (let i = 0; i < 5; i++) this.slotX[i] = (i - 2) * gap;
    const y0 = -H / 2 + this.baseY;

    const inv: (number | null)[] = me.inv ?? [null, null, null, null, null];
    this.sel = me.sel ?? 0;
    // ---- which entities, where (big items span consecutive slots)
    const want = new Map<number, { slot: number; span: number }>();
    for (let i = 0; i < 5; i++) {
      const id = inv[i];
      if (id == null) continue;
      const w = want.get(id);
      if (w) w.span = i - w.slot + 1; else want.set(id, { slot: i, span: 1 });
    }
    for (const [eid, it] of this.items) if (!want.has(eid) && !it.leaving) it.leaving = true;
    for (const [eid, pos] of want) {
      const e = this.game.state.get(eid);
      if (!e) continue;
      // rebuild only when the KIND changes; data changes (wok contents, temperature…) refresh in place, ≤ 4×/s
      const sig = e.k;
      let it = this.items.get(eid);
      if (it && it.leaving) { it.leaving = false; }
      if (!it) {
        const root = new THREE.Group(), spin = new THREE.Group();
        root.add(spin); this.scene.add(root);
        it = { eid, sig: '', root, spin, obj: null, radius: 0, center: new THREE.Vector3(), scale: 0, scaleV: 0, lift: 0, retry: 0, dataSig: '', refreshT: 0, leaving: false, slot: pos.slot, span: pos.span };
        this.items.set(eid, it);
        spin.rotation.y = Math.random() * 6.28;
      }
      it.slot = pos.slot; it.span = pos.span;
      if (it.sig !== sig) { it.sig = sig; it.dataSig = ''; this.build(it, e); }
      else if (it.obj && (it.refreshT -= dt) <= 0) {
        it.refreshT = 0.25;
        const ds = JSON.stringify(e.data ?? null);
        if (ds !== it.dataSig) {
          const first = it.dataSig === '';
          it.dataSig = ds;
          if (!first) { try { this.game.items.defOf(e)?.refresh?.(it.obj, e, this.game); } catch { /* visual only */ } }
        }
      }
      else if (!it.radius && (it.retry -= dt) <= 0) this.fit(it);
    }
    // ---- animate
    for (const d of this.dots) d.visible = false;
    for (let i = 0; i < 5; i++) {
      const d = this.dots[i];
      if (inv[i] != null) continue;
      d.visible = true;
      const s = i === this.sel ? 4.2 : 2.6;
      d.scale.setScalar(s);
      d.position.set(this.slotX[i], y0, -500);
      (d.material as THREE.MeshBasicMaterial).opacity = i === this.sel ? 0.55 : 0.22;
    }
    for (const [eid, it] of this.items) {
      const selected = !it.leaving && this.sel >= it.slot && this.sel < it.slot + it.span;
      const cx = (this.slotX[it.slot] + this.slotX[Math.min(4, it.slot + it.span - 1)]) / 2;
      const target = it.leaving ? 0 : selected ? 1.28 : 1;
      // springy scale (pop in with overshoot, shrink out)
      // stable at any frame rate: fixed 1/120 s sub-steps (semi-implicit), long frames just settle
      const k = 140, c = 16;
      let rem = Math.min(dt, 0.25);
      while (rem > 1e-5) {
        const h = Math.min(rem, 1 / 120); rem -= h;
        it.scaleV += ((target - it.scale) * k - it.scaleV * c) * h;
        it.scale += it.scaleV * h;
      }
      if (dt > 0.25) { it.scale = target; it.scaleV = 0; }
      it.scale = Math.max(0, Math.min(1.6, it.scale));
      if (it.leaving && it.scale < 0.02) { this.scene.remove(it.root); this.items.delete(eid); continue; }
      it.lift += ((selected ? 1 : 0) - it.lift) * Math.min(1, dt * 10);
      const px = this.slotSize * 0.5 * Math.max(1, it.span * 0.8);
      const s = it.radius > 0 ? (px / it.radius) * Math.max(0, it.scale) : 0;
      it.root.position.set(cx, y0 + it.lift * this.slotSize * 0.14 + Math.sin(this.t * 2 + it.slot) * 2, 0);
      it.root.scale.setScalar(s);
      it.spin.rotation.y += dt * (selected ? 1.1 : 0.45);
      it.spin.rotation.x = 0.32 + Math.sin(this.t * 0.9 + it.slot) * 0.04;
    }
    // glow under the selected slot
    const selIt = [...this.items.values()].find((it) => !it.leaving && this.sel >= it.slot && this.sel < it.slot + it.span);
    const gx = selIt ? (this.slotX[selIt.slot] + this.slotX[Math.min(4, selIt.slot + selIt.span - 1)]) / 2 : this.slotX[this.sel];
    this.glow.position.set(gx, y0 - this.slotSize * 0.08, -900);
    this.glow.scale.setScalar(this.slotSize * (selIt ? 1.9 * Math.max(1, selIt.span * 0.8) : 1.2));
    this.glow.visible = true;
  }

  private build(it: Item, e: Ent) {
    const def = this.game.items.defOf(e);
    if (it.obj) { it.spin.remove(it.obj); it.obj = null; }
    it.radius = 0;
    if (!def) return;
    try {
      const o = def.build(e, this.game);
      def.refresh?.(o, e, this.game);
      o.traverse((c: any) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; } });
      it.obj = o;
      it.spin.add(o);
      this.fit(it);
    } catch (err) { console.warn('[hud] item model', e.k, err); }
  }

  /** centre the model on the spin pivot and remember its size (async GLB visuals fill in later) */
  private fit(it: Item) {
    if (!it.obj) return;
    // measure in the model's own space (the parents may be scaled to 0 while popping in)
    const o = it.obj;
    it.spin.remove(o);
    o.position.set(0, 0, 0);
    o.updateMatrixWorld(true);
    // only VISIBLE meshes count (items keep hidden parts: contents, steam, alternate states …)
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    o.traverseVisible((c: any) => {
      if (!c.isMesh || !c.geometry) return;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld);
      box.union(tmp);
    });
    it.spin.add(o);
    if (box.isEmpty() || !isFinite(box.min.x) || box.getSize(new THREE.Vector3()).length() < 1e-4) { it.retry = 0.4; return; }
    const sph = box.getBoundingSphere(new THREE.Sphere());
    it.radius = Math.max(1e-3, sph.radius);
    it.obj.position.copy(sph.center).negate();
  }

  private render() {
    if (!this.visible || this.game.scenes.currentName !== 'world') return;
    const R = this.game.engine.renderer;
    const world = (this.game.scenes.current as any)?.scene as THREE.Scene | undefined;
    this.scene.environment = world?.environment ?? null;
    (this.scene as any).environmentIntensity = 0.7;
    const prevAuto = R.autoClear, prevTone = R.toneMapping, prevExp = R.toneMappingExposure, prevShadow = R.shadowMap.autoUpdate;
    R.setRenderTarget(null);
    R.setViewport(0, 0, this.size.x, this.size.y);
    R.autoClear = false;
    R.toneMapping = ACES; R.toneMappingExposure = 1.05;
    R.shadowMap.autoUpdate = false;
    R.clearDepth();
    R.render(this.scene, this.cam);
    R.autoClear = prevAuto; R.toneMapping = prevTone; R.toneMappingExposure = prevExp; R.shadowMap.autoUpdate = prevShadow;
  }
}
