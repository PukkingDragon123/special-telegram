import * as THREE from 'three';
import type { Game } from '../../game/game';
import { loadModel } from '../world/realprops';
import { vehicleModel, wheelModel, VDEFS } from '../life/vehicles';
import { RNG } from '../../core/rng';
import { HideDef, HideKind, hideDefs } from './zones';
import { loadGlb, mergeGroup } from './util';

/* ============================================================================================
 * Hiding places near the map edges, built from REAL models (read-only): Poly Haven plastic crates,
 * trash bags (props agent's optimised GLBs), our own blue plastic drum (Poly Haven Barrel_02) and the
 * life module's photo-textured pickup. Each cluster is merged (≈1–3 draw calls), distance-culled and
 * gets static colliders. The drum's lid is split off the scan so it can pop off and land back on.
 * ========================================================================================== */

export interface HideSpot {
  def: HideDef;
  kind: HideKind;
  /** ground centre of the hiding prop */
  p: THREE.Vector3;
  group: THREE.Group;
  /** drum: the separate lid (local to group) */
  lid?: THREE.Object3D;
  lidRest?: THREE.Vector3;
  /** trash: two loose bags that land on the hero */
  bags?: THREE.Object3D[];
  /** half extent of the prop along the inward normal (for "behind" positions) */
  half: number;
  ready: boolean;
}

const tintCache = new Map<string, THREE.Material>();
function tinted(m: THREE.Material, color: number) {
  const k = (m as any).uuid + ':' + color;
  let t = tintCache.get(k);
  if (!t) { t = (m as THREE.MeshStandardMaterial).clone(); (t as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(color)); tintCache.set(k, t); }
  return t;
}

/** realprops model → plain meshes in a group (origin bottom centre, faces +Z) */
async function prop(id: string, color?: number): Promise<THREE.Group | null> {
  const m = await loadModel(id);
  if (!m) return null;
  const g = new THREE.Group();
  for (const p of m.parts) g.add(new THREE.Mesh(p.geom, color !== undefined && p.tint ? tinted(p.mat, color) : p.mat));
  return g;
}

const CRATE_COLS = [0xc8302a, 0x2f5fb8, 0xe0b020, 0x2f8a46, 0xc8302a, 0x2f5fb8];

export class HideSpots {
  readonly root = new THREE.Group();
  readonly spots: HideSpot[] = [];
  private timer = 0;

  constructor(private game: Game) {
    this.root.name = 'escape-hides';
  }

  async build() {
    const game = this.game;
    const defs = hideDefs();
    await Promise.all(defs.map(async (d, i) => {
      const rng = new RNG(4711 + i * 13);
      const y = game.world?.groundY(d.x, d.z) ?? 0;
      const sp: HideSpot = { def: d, kind: d.kind, p: new THREE.Vector3(d.x, y, d.z), group: new THREE.Group(), half: 0.5, ready: false };
      sp.group.position.copy(sp.p);
      sp.group.rotation.y = d.yaw;
      sp.group.name = 'hide:' + d.kind + ':' + i;
      this.spots.push(sp);
      this.root.add(sp.group);
      try { await this.dress(sp, rng); } catch (e) { console.warn('[escape] hide spot', d, e); }
      sp.ready = true;
    }));
  }

  private async dress(sp: HideSpot, rng: RNG) {
    const phys = this.game.physics;
    const g = sp.group, P = sp.p, yaw = sp.def.yaw;
    const raw = new THREE.Group();
    if (sp.kind === 'crates') {
      // two columns of stacked bottle crates + one fallen on the side
      for (let c = 0; c < 2; c++) {
        const hN = 3 + ((c + Math.floor(P.x)) & 1);
        for (let k = 0; k < hN; k++) {
          const m = await prop('crate', CRATE_COLS[(c * 3 + k + Math.abs(Math.floor(P.z))) % CRATE_COLS.length]);
          if (!m) continue;
          m.position.set((c - 0.5) * 0.54 + (rng.next() - 0.5) * 0.04, k * 0.255, (rng.next() - 0.5) * 0.05);
          m.rotation.y = (rng.next() - 0.5) * 0.12;
          raw.add(m);
        }
      }
      const f = await prop('crate', 0x2f5fb8);
      if (f) { f.position.set(0.15, 0.2, 0.62); f.rotation.set(Math.PI / 2, 0.4, 0); raw.add(f); }
      sp.half = 0.45;
      phys?.addBox([P.x, 0.55 + P.y, P.z], [1.15, 1.1, 0.55], yaw);
    } else if (sp.kind === 'drum') {
      const drum = await loadGlb('Barrel_02');
      if (drum) {
        // split the lid (top slice of the scan) into its own mesh
        const merged = mergeGroup(drum);
        const box = new THREE.Box3().setFromObject(merged);
        const top = box.max.y;
        const body = new THREE.Group(), lid = new THREE.Group();
        for (const m of merged.children as THREE.Mesh[]) {
          const [lo, hi] = splitByY(m.geometry, top - 0.075);
          if (lo) { const a = new THREE.Mesh(lo, m.material); a.castShadow = true; a.receiveShadow = true; body.add(a); }
          if (hi) { const b = new THREE.Mesh(hi, m.material); b.castShadow = true; lid.add(b); }
        }
        g.add(body);
        lid.name = 'drum-lid';
        g.add(lid);
        sp.lid = lid; sp.lidRest = lid.position.clone();
        const deco = await loadGlb('Barrel_02');
        if (deco) { deco.position.set(0.62, 0, 0.18); deco.rotation.y = 1.3; raw.add(deco); }
        phys?.addBox([P.x, 0.45 + P.y, P.z], [0.52, 0.9, 0.52], yaw);
        const off = new THREE.Vector3(0.62, 0, 0.18).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        phys?.addBox([P.x + off.x, 0.45 + P.y, P.z + off.z], [0.52, 0.9, 0.52], yaw);
      }
      sp.half = 0.3;
    } else if (sp.kind === 'trash') {
      const spots: [number, number, number, number][] = [[0, 0, 0, 0], [0.45, 0, 0.12, 0.8], [-0.42, 0, 0.08, 2.2], [0.1, 0, -0.42, 1.4], [-0.2, 0, 0.45, 3.1], [0.5, 0, -0.35, 0.3], [-0.55, 0, -0.32, 4]];
      for (const [x, , z, r] of spots) {
        const m = await prop('trashbag');
        if (!m) continue;
        m.position.set(x, 0, z); m.rotation.set((rng.next() - 0.5) * 0.4, r, (rng.next() - 0.5) * 0.4);
        const s = 0.85 + rng.next() * 0.35; m.scale.setScalar(s);
        raw.add(m);
      }
      sp.bags = [];
      for (let k = 0; k < 2; k++) {
        const b = await prop('trashbag');
        if (!b) continue;
        b.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        b.visible = false;
        g.add(b);
        sp.bags.push(b);
      }
      sp.half = 0.6;
      phys?.addBox([P.x, 0.25 + P.y, P.z], [1.3, 0.5, 1.1], yaw);
    } else if (sp.kind === 'pickup') {
      const vm = vehicleModel('pickup');
      raw.add(new THREE.Mesh(vm.geo, vm.mat));
      const wm = wheelModel();
      for (const w of VDEFS.pickup.wheels) for (const s of [1, -1]) {
        const wh = new THREE.Mesh(wm.geo, wm.mat);
        wh.scale.set(0.26, w.r, w.r);
        wh.position.set(s * w.x, w.r, w.z);
        raw.add(wh);
      }
      sp.half = 2.6;
      phys?.addBox([P.x, 0.9 + P.y, P.z], [1.85, 1.8, 5.1], yaw);
    }
    const merged = mergeGroup(raw);
    g.add(merged);
  }

  /** nearest spot to p within r (ready ones only) */
  nearest(p: THREE.Vector3, r = 16): HideSpot | null {
    let best: HideSpot | null = null, bd = r;
    for (const s of this.spots) {
      if (!s.ready) continue;
      const d = Math.hypot(s.p.x - p.x, s.p.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  frame(dt: number, cam: THREE.Vector3) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    for (const s of this.spots) s.group.visible = s.p.distanceToSquared(cam) < 75 * 75;
  }
}

/** split an indexed geometry into triangles whose 3 vertices are below / above y */
function splitByY(geo: THREE.BufferGeometry, y: number): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  const idx = geo.getIndex();
  const pos = geo.getAttribute('position');
  if (!idx) return [geo, null];
  const lo: number[] = [], hi: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const up = pos.getY(a) > y && pos.getY(b) > y && pos.getY(c) > y;
    (up ? hi : lo).push(a, b, c);
  }
  const mk = (list: number[]) => {
    if (!list.length) return null;
    const g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv']) { const a = geo.getAttribute(n); if (a) g.setAttribute(n, a); }
    g.setIndex(list);
    g.computeBoundingSphere();
    return g;
  };
  return [mk(lo), mk(hi)];
}
