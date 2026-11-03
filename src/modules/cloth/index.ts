import * as THREE from 'three';
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { RNG } from '../../core/rng';
import { params } from '../../core/util';
import { U } from '../world/mats';
import { ClothSpots, ClothAnchors, type AnchorRec, type GarmentKind, type LineSpot, type TarpSpot, type CurtainSpot } from './api';
import { Cloth, type ClothEnv } from './sim';
import { pattern, meshGarment, nearestNode, topRow, rowAt, rect, type GarmentMesh } from './garments';
import { FABRICS, GARMENT_FABRICS, GARMENT_MASS, fabricMaterial, fabricTint, fabricId } from './fabrics';
import { pegGeometry, hangerGeometry, hangerShoulderY, linePoint, PEG_COLORS, HANGER_COLORS } from './props';

/* ============================================================================================
 * cloth — REAL cloth physics for everything hanging in the soi:
 *   - balcony clothes-lines and grille / pole rails published by the world builders (ClothSpots):
 *     T-shirts, school shirts, singlets, moto-taxi vests, rider jackets, shorts, boxers, trousers, towels,
 *     ผ้าขาวม้า, sarongs and socks, cut from real sewing-pattern outlines, pegged or on hangers
 *   - cloth attached to moving props (registerClothAnchor): the ผ้าขาวม้า over the food cart handle swings
 *     and trails when you push the cart
 * Simulation: sim.ts (PBD + per-triangle aerodynamics, gusty wind, collisions with people and walls).
 * Rendering: one dynamic merged mesh per fabric (≈ a dozen draw calls for the whole map), real fabric
 * photo textures + weave normal maps + sheen. LOD: only garments near + in view are simulated, at full
 * rate within 15 m and half rate to 34 m; the rest keep their last pose.
 *
 * Debug: ?clothlab (spawns a test line + rail in front of you), window.__cloth for stats.
 * ========================================================================================== */

interface Garment {
  cloth: Cloth;
  batch: Batch;
  vOff: number;
  mesh: GarmentMesh;
  uv: Float32Array;
  col: Float32Array;
  lastStep: number;
  anchor?: AnchorRec;
  pinLocal?: Float32Array;
  capsLocal?: number[];
}

/** one dynamic mesh per fabric holding every garment of that fabric */
class Batch {
  garments: Garment[] = [];
  mesh: THREE.Mesh | null = null;
  pos!: THREE.BufferAttribute;
  nrm!: THREE.BufferAttribute;
  dirty = false;
  constructor(readonly fabric: string) {}
  finalize(parent: THREE.Object3D) {
    let nv = 0, ni = 0;
    for (const g of this.garments) { g.vOff = nv; nv += g.cloth.n; ni += g.mesh.tris.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), C = new Float32Array(nv * 3);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let io = 0;
    for (const g of this.garments) {
      g.cloth.computeNormals();
      P.set(g.cloth.x, g.vOff * 3); N.set(g.cloth.nrm, g.vOff * 3); UV.set(g.uv, g.vOff * 2); C.set(g.col, g.vOff * 3);
      const t = g.mesh.tris;
      for (let k = 0; k < t.length; k++) I[io++] = t[k] + g.vOff;
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', this.nrm);
    geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, fabricMaterial(this.fabric));
    m.name = 'cloth:' + this.fabric;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.raycast = () => {};
    parent.add(m);
    this.mesh = m;
  }
  write(g: Garment) {
    (this.pos.array as Float32Array).set(g.cloth.x, g.vOff * 3);
    (this.nrm.array as Float32Array).set(g.cloth.nrm, g.vOff * 3);
    this.pos.addUpdateRange(g.vOff * 3, g.cloth.n * 3);
    this.nrm.addUpdateRange(g.vOff * 3, g.cloth.n * 3);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.pos.needsUpdate = true; this.nrm.needsUpdate = true;
    this.dirty = false;
  }
  dispose() { this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); }
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();
const _u = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** what hangs where (weights) */
const LINE_KINDS: Record<string, [GarmentKind, number][]> = {
  balcony: [['tshirt', 5], ['singlet', 3], ['shorts', 3], ['boxers', 3], ['towel', 3], ['phakhaoma', 2], ['shirt', 2], ['socks', 2], ['sarong', 1.5], ['pants', 1.5], ['sheet', 0.5]],
  shop: [['towel', 5], ['phakhaoma', 3], ['tshirt', 2], ['singlet', 1]],
  alley: [['tshirt', 3], ['singlet', 3], ['shorts', 2], ['pants', 2], ['phakhaoma', 2], ['vest', 1], ['boxers', 2]],
  street: [['tshirt', 3], ['towel', 2], ['phakhaoma', 2], ['shorts', 2]],
};
const RAIL_KINDS: [GarmentKind, number][] = [['tshirt', 5], ['shirt', 4], ['singlet', 2], ['vest', 1.5], ['jacket', 1]];
const DRAPED = new Set<GarmentKind>(['towel', 'phakhaoma', 'sarong', 'sheet']);

function weighted<T>(rng: RNG, list: [T, number][]): T {
  let s = 0;
  for (const [, w] of list) s += w;
  let r = rng.next() * s;
  for (const [k, w] of list) { r -= w; if (r <= 0) return k; }
  return list[0][0];
}

export class ClothWorld {
  garments: Garment[] = [];
  batches = new Map<string, Batch>();
  anchorBatches: Batch[] = [];
  root = new THREE.Group();
  frameN = 0;
  time = 0;
  spheres = new Float32Array(4 * 16);
  nSpheres = 0;
  env: ClothEnv = { dt: 1 / 60, wx: 0, wy: 0, wz: 0, turb: 0.6, time: 0, spheres: this.spheres, nSpheres: 0 };
  frustum = new THREE.Frustum();
  stats = { garments: 0, active: 0, stepped: 0, ms: 0, buildMs: 0, spots: 0 };
  windDir = new THREE.Vector3(1, 0, 0.4).normalize();

  constructor(readonly game: Game) { this.root.name = 'cloth'; }

  batch(fabric: string) {
    let b = this.batches.get(fabric);
    if (!b) this.batches.set(fabric, (b = new Batch(fabric)));
    return b;
  }

  // ------------------------------------------------------------------ garment construction

  /** UVs + vertex colours (tint, hem/seam shading, grime) for a garment */
  private dress(m: GarmentMesh, fabric: string, rng: RNG, color?: number) {
    const f = FABRICS[fabric] ?? FABRICS.jersey;
    const uv = new Float32Array(m.n * 2), col = new Float32Array(m.n * 3);
    const ox = rng.next(), oy = rng.next();
    const tint = fabricTint(fabric, rng, color);
    let ymax = -1e9, ymin = 1e9, xmin = 1e9, xmax = -1e9;
    for (let i = 0; i < m.n; i++) { ymax = Math.max(ymax, m.xy[i * 2 + 1]); ymin = Math.min(ymin, m.xy[i * 2 + 1]); xmin = Math.min(xmin, m.xy[i * 2]); xmax = Math.max(xmax, m.xy[i * 2]); }
    for (let i = 0; i < m.n; i++) {
      const x = m.xy[i * 2], y = m.xy[i * 2 + 1];
      if (f.uv === 'panel') { uv[i * 2] = (x - xmin) / (xmax - xmin); uv[i * 2 + 1] = (y - ymin) / (ymax - ymin); }
      else { uv[i * 2] = x / f.tile + ox; uv[i * 2 + 1] = y / f.tile + oy; }
      // hems and seams read darker (double layer, stitching shadow); dirtier toward the bottom edge
      const e = m.edge[i];
      const hem = 0.74 + 0.26 * Math.min(1, e / 0.022);
      const low = 1 - 0.06 * Math.max(0, (ymax - y) / Math.max(0.1, ymax - ymin) - 0.6);
      const k = hem * low;
      col[i * 3] = tint.r * k; col[i * 3 + 1] = tint.g * k; col[i * 3 + 2] = tint.b * k;
    }
    return { uv, col };
  }

  private pickFabric(kind: GarmentKind, rng: RNG, want?: string) {
    return fabricId(want) ?? rng.pick(GARMENT_FABRICS[kind]);
  }

  private makeGarment(kind: GarmentKind, rng: RNG, place: (m: GarmentMesh) => { pos: Float32Array; pins: number[] }, opts: { fabric?: string; walls?: number[]; ground?: number; caps?: number[]; size?: [number, number] } = {}) {
    const pat = pattern(kind, rng, opts.size);
    const m = meshGarment(kind, pat, pat.key);
    const fabric = this.pickFabric(kind, rng, opts.fabric);
    const { pos, pins } = place(m);
    const cloth = new Cloth(m, pos, pins, GARMENT_MASS[kind] * rng.range(0.85, 1.2), rng.next() * 100);
    if (opts.walls) cloth.setWalls(opts.walls);
    if (opts.caps) cloth.setCapsules(opts.caps);
    if (opts.ground !== undefined) cloth.ground = opts.ground;
    const { uv, col } = this.dress(m, fabric, rng);
    const g: Garment = { cloth, batch: null as any, vOff: 0, mesh: m, uv, col, lastStep: -1 };
    return { g, fabric };
  }

  /** settle a fresh garment into a natural hang (a second of light breeze) */
  private settle(c: Cloth, steps = 14) {
    const env: ClothEnv = { dt: 1 / 45, wx: this.windDir.x * 0.6, wy: 0, wz: this.windDir.z * 0.6, turb: 0.4, time: Math.random() * 100, spheres: this.spheres, nSpheres: 0 };
    const it = c.iters;
    c.iters = 3;
    for (let i = 0; i < steps; i++) { env.time += env.dt; c.step(env); }
    c.iters = it;
  }

  /** garments pegged along a sagging clothes-line, or draped over it */
  private buildLine(spot: LineSpot, pegs: THREE.Matrix4[], pegCol: THREE.Color[], ropes: THREE.BufferGeometry[]) {
    const rng = new RNG(spot.seed);
    const a = new THREE.Vector3(...spot.a), b = new THREE.Vector3(...spot.b);
    const L = a.distanceTo(b);
    if (L < 0.5) return;
    const sag = 0.015 + 0.022 * L;
    const u = _u.subVectors(b, a).normalize().clone();
    // garments face away from the wall (or sideways from the line)
    const out = spot.wall ? new THREE.Vector3(...spot.wall.n).setY(0).normalize() : new THREE.Vector3().crossVectors(UP, u).normalize();
    const walls = spot.wall ? [...spot.wall.n, spot.wall.d] : [];
    const ground = (spot as any).floor ?? (this.game.world?.groundY(a.x, a.z) ?? 0) + 0.02;
    // the rope itself
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => linePoint(a, b, i / 8, sag, new THREE.Vector3()).addScaledVector(UP, 0.004)));
    ropes.push(new THREE.TubeGeometry(curve, 16, 0.0028, 5, false));
    const kinds = LINE_KINDS[spot.style ?? 'balcony'] ?? LINE_KINDS.balcony;
    const fill = spot.fill ?? 0.8;
    let s = rng.range(0.06, 0.3);
    const yaw = Math.atan2(out.x, out.z);
    let guard = 0;
    while (s < L - 0.15 && guard++ < 30) {
      if (rng.next() > fill) { s += rng.range(0.2, 0.5); continue; }
      let kind = weighted(rng, kinds);
      const pat = pattern(kind, rng);
      const gw = (kind === 'socks' ? 0.2 : pat.outline.reduce((m, p) => Math.max(m, Math.abs(p[0])), 0) * 2);
      if (s + gw > L - 0.05) { if (L - s > 0.24) kind = 'socks'; else break; }
      const sc = s + (kind === 'socks' ? 0.1 : gw / 2);
      const draped = DRAPED.has(kind);
      const flipped = !draped && kind !== 'socks' && rng.chance(0.3);      // shirts pegged by the hem, upside down
      const depth = rng.range(-0.004, 0.004);
      const wph = rng.range(0, 6.28);
      // pegs / the fold hold the cloth a little narrower than it is: the edge between them gathers into folds
      const gather = rng.range(0.82, 0.93);
      const { g, fabric } = this.makeGarment(kind, rng, (m) => {
        const pos = new Float32Array(m.n * 3);
        const pins: number[] = [];
        const ymax = m.xy.reduce((mx, v, i) => (i & 1 ? Math.max(mx, v) : mx), -1e9);
        const ymin = m.xy.reduce((mn, v, i) => (i & 1 ? Math.min(mn, v) : mn), 1e9);
        const fold = (ymax + ymin) * 0.5 + (ymax - ymin) * rng.range(-0.08, 0.08);
        for (let i = 0; i < m.n; i++) {
          const x = m.xy[i * 2], y = m.xy[i * 2 + 1];
          const t = Math.max(0, Math.min(1, (sc + x * gather) / L));
          linePoint(a, b, t, sag, _p);
          if (draped) {
            const dy = y - fold, side = dy >= 0 ? 1 : -1;
            _p.addScaledVector(out, side * (0.006 + Math.min(Math.abs(dy), 0.01)) + depth).addScaledVector(UP, -Math.abs(dy) + 0.004);
          } else {
            // pegged by the top edge (or upside down by the hem: shoulders hang lowest)
            const drop = flipped ? y - ymin : ymax - y;
            _p.addScaledVector(UP, -drop - 0.008).addScaledVector(out, 0.008 + depth);
          }
          // seed organic wrinkles: a smooth out-of-plane ripple that the solver relaxes into folds
          const wr = 0.012 * Math.sin(x * 17 + wph) * Math.cos(y * 9 + wph * 2) + 0.005 * Math.sin(x * 43 + y * 31 + wph);
          _p.addScaledVector(out, wr);
          pos.set([_p.x, _p.y, _p.z], i * 3);
        }
        if (draped) {
          for (const k of rowAt(m, fold)) pins.push(k);
        } else {
          const top = flipped ? ymin : ymax;
          // pegs where people really peg them: shoulder seams, waistband corners (+ middle), hem corners when upside down
          const P = m.pins;
          const cand = flipped ? P.hem ?? [] : P.top ?? (P.shoulders ? [P.shoulders[0], P.shoulders[P.shoulders.length - 1]] : []);
          const xs = cand.length ? cand.map((c) => c[0]) : [0];
          for (const px of xs) {
            const k = nearestNode(m, [px, top + (flipped ? 0.005 : -0.005)]);
            pins.push(k);
            // the jaws hold ~2 cm of cloth: pin the neighbours on the edge too
            for (let j = 0; j < m.n; j++) if (j !== k && Math.abs(m.xy[j * 2] - m.xy[k * 2]) < 0.022 && Math.abs(m.xy[j * 2 + 1] - top) < m.step * 0.6) pins.push(j);
            const t = Math.max(0, Math.min(1, (sc + m.xy[k * 2] * gather) / L));
            linePoint(a, b, t, sag, _p).addScaledVector(out, 0.004);
            _q.setFromAxisAngle(UP, yaw);
            pegs.push(new THREE.Matrix4().compose(_p.clone().addScaledVector(UP, 0.012), _q.clone(), _s));
            pegCol.push(new THREE.Color(rng.pick(PEG_COLORS)));
          }
        }
        return { pos, pins: [...new Set(pins)] };
      }, { walls, ground });
      this.settle(g.cloth);
      const bt = this.batch(fabric);
      g.batch = bt;
      bt.garments.push(g);
      this.garments.push(g);
      s += (kind === 'socks' ? 0.2 : gw) + rng.range(0.03, 0.16);
    }
  }

  /** garments on hangers hooked on a pole / grille rail */
  private buildRail(spot: LineSpot, hangers: { m: THREE.Matrix4; wire: boolean; c: THREE.Color }[]) {
    const rng = new RNG(spot.seed);
    const a = new THREE.Vector3(...spot.a), b = new THREE.Vector3(...spot.b);
    const L = a.distanceTo(b);
    if (L < 0.4) return;
    const u = new THREE.Vector3().subVectors(b, a).normalize();
    const out = spot.wall ? new THREE.Vector3(...spot.wall.n).setY(0).normalize() : new THREE.Vector3().crossVectors(UP, u).normalize();
    const walls = spot.wall ? [...spot.wall.n, spot.wall.d] : [];
    const ground = (spot as any).floor ?? (this.game.world?.groundY(a.x, a.z) ?? 0) + 0.02;
    const fill = spot.fill ?? 0.8;
    let s = rng.range(0.15, 0.3), i = 0;
    while (s < L - 0.15 && i < 14) {
      if (rng.next() > fill) { s += rng.range(0.2, 0.4); continue; }
      const kind: GarmentKind = spot.style === 'moto' ? 'vest' : weighted(rng, RAIL_KINDS);
      const hp = new THREE.Vector3().copy(a).addScaledVector(u, s).addScaledVector(out, (i & 1 ? 0.014 : -0.008));
      const jitter = rng.range(-0.18, 0.18);
      const hu = u.clone().applyAxisAngle(UP, jitter);
      const wire = rng.chance(0.35);
      // hanger: local x along hu, y up, z = hu × up
      const hz = new THREE.Vector3().crossVectors(hu, UP);
      const hm = new THREE.Matrix4().makeBasis(hu, UP, hz.negate()).setPosition(hp.x, hp.y + 0.012, hp.z);
      hangers.push({ m: hm, wire, c: new THREE.Color(wire ? 0xb8b8b4 : rng.pick(HANGER_COLORS)) });
      const { g, fabric } = this.makeGarment(kind, rng, (m) => {
        const pos = new Float32Array(m.n * 3);
        const pins: number[] = [];
        for (let k = 0; k < m.n; k++) {
          const x = m.xy[k * 2], y = m.xy[k * 2 + 1];
          // sleeves already falling: nodes outside the shoulder width swing down toward the body
          const sw = 0.2, over = Math.max(0, Math.abs(x) - sw);
          const xx = Math.sign(x) * (Math.min(Math.abs(x), sw) + over * 0.45), drop = over * 0.85;
          _p.copy(hp).addScaledVector(hu, xx).addScaledVector(UP, 0.012 + hangerShoulderY(xx) + Math.min(0, y) - drop - 0.004 + Math.max(0, y) * 0.5);
          _p.addScaledVector(out, 0.004 + 0.01 * Math.sin(x * 15 + i * 0.7) * Math.cos(y * 8 + i));
          pos.set([_p.x, _p.y, _p.z], k * 3);
        }
        // the shoulder seams rest on the hanger arms
        for (const sp of m.pins.shoulders ?? m.pins.top ?? []) {
          const k = nearestNode(m, sp);
          pins.push(k);
          for (let j = 0; j < m.n; j++) if (Math.abs(m.xy[j * 2] - m.xy[k * 2]) < 0.03 && Math.abs(m.xy[j * 2 + 1] - m.xy[k * 2 + 1]) < m.step * 0.7) pins.push(j);
        }
        return { pos, pins: [...new Set(pins)] };
      }, { walls, ground, fabric: spot.style === 'moto' ? (rng.chance(0.8) ? 'moto_vest' : 'vest_orange') : undefined });
      this.settle(g.cloth);
      const bt = this.batch(fabric);
      g.batch = bt;
      bt.garments.push(g);
      this.garments.push(g);
      s += spot.style === 'moto' ? rng.range(0.2, 0.28) : rng.range(0.22, 0.42);
      i++;
    }
  }

  /** a canvas tarp tied at its corners / back edge: sags under its own weight, billows and flaps in gusts */
  private buildTarp(sp: TarpSpot) {
    const rng = new RNG(sp.seed);
    const [A, B, C, Dd] = sp.corners.map((c) => new THREE.Vector3(...c));
    const Wd = (A.distanceTo(B) + Dd.distanceTo(C)) / 2, Dp = (A.distanceTo(Dd) + B.distanceTo(C)) / 2;
    if (Wd < 0.3 || Dp < 0.3) return;
    const slack = 1 + (sp.slack ?? 0.03);
    const step = Math.max(0.12, Math.sqrt((Wd * Dp) / 320));
    const pat = rect(Wd * slack, Dp * slack, step);
    const m = meshGarment('sheet', pat, 'tarp:' + Wd.toFixed(2) + 'x' + Dp.toFixed(2) + ':' + step.toFixed(3));
    const pos = new Float32Array(m.n * 3);
    const uOf = (i: number) => (m.xy[i * 2] - m.x0) / m.w, vOf = (i: number) => -m.xy[i * 2 + 1] / m.h;
    const top = new THREE.Vector3(), bot = new THREE.Vector3();
    for (let i = 0; i < m.n; i++) {
      const u = Math.max(0, Math.min(1, uOf(i))), v = Math.max(0, Math.min(1, vOf(i)));
      top.lerpVectors(A, B, u); bot.lerpVectors(Dd, C, u);
      _p.lerpVectors(top, bot, v);
      _p.y -= 0.06 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * (Wd + Dp) * 0.5;
      pos.set([_p.x, _p.y, _p.z], i * 3);
    }
    // ties
    const pins = new Set<number>();
    const near = (u: number, v: number) => nearestNode(m, [m.x0 + u * m.w, -v * m.h]);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) pins.add(near(u, v));
    if ((sp.tie ?? 'corners') === 'back') {
      // back edge laced to the awning bar every other grommet, front edge roped to the frame at the thirds
      for (let i = 0; i < m.n; i++) if (vOf(i) > 1 - step / m.h * 0.5 && (Math.round(uOf(i) * m.w / step) & 1) === 0) pins.add(i);
      pins.add(near(1 / 3, 0)); pins.add(near(2 / 3, 0));
    } else {
      pins.add(near(0.5, 0)); pins.add(near(0.5, 1));
    }
    // pinned nodes sit exactly on their tie points (no initial sag there)
    for (const k of pins) {
      const u = Math.max(0, Math.min(1, uOf(k))), v = Math.max(0, Math.min(1, vOf(k)));
      top.lerpVectors(A, B, u); bot.lerpVectors(Dd, C, u);
      _p.lerpVectors(top, bot, v);
      pos.set([_p.x, _p.y, _p.z], k * 3);
    }
    // PVC-coated canvas: heavy (~0.55 kg/m²), taut between its ties; it ripples and lifts in gusts, never sails off
    const cloth = new Cloth(m, pos, [...pins], Wd * Dp * 0.55, rng.next() * 100);
    cloth.drag = 0.16;
    cloth.iters = 6;
    cloth.damping = 0.975;
    cloth.ground = Math.min(A.y, B.y, C.y, Dd.y) - 2.2;
    const { uv, col } = this.dress(m, 'tarp', rng, sp.color);
    const g: Garment = { cloth, batch: null as any, vOff: 0, mesh: m, uv, col, lastStep: -1 };
    this.settle(cloth, 24);
    const bt = this.batch('tarp');
    g.batch = bt;
    bt.garments.push(g);
    this.garments.push(g);
  }

  /** a curtain on rings across a window, gathered, blowing out of the opening in the breeze */
  private buildCurtain(sp: CurtainSpot) {
    const rng = new RNG(sp.seed);
    const A = new THREE.Vector3(...sp.a), B = new THREE.Vector3(...sp.b);
    const Wd = A.distanceTo(B);
    if (Wd < 0.2 || sp.h < 0.3) return;
    const out = new THREE.Vector3(...sp.out).setY(0).normalize();
    const pat = rect(Wd * 1.3, sp.h, 0.06);
    const m = meshGarment('sheet', pat, 'curtain:' + Wd.toFixed(2) + 'x' + sp.h.toFixed(2));
    const pos = new Float32Array(m.n * 3);
    const pins: number[] = [];
    let ymax = -1e9;
    for (let i = 0; i < m.n; i++) ymax = Math.max(ymax, m.xy[i * 2 + 1]);
    for (let i = 0; i < m.n; i++) {
      const x = m.xy[i * 2], y = m.xy[i * 2 + 1];
      const u = (x - m.x0) / m.w;
      _p.lerpVectors(A, B, u).addScaledVector(UP, y - ymax);
      // gathered on the rod: pleats in and out
      _p.addScaledVector(out, 0.025 * Math.sin(u * Math.PI * 2 * Math.max(2, Math.round(Wd * 7))) + 0.03);
      pos.set([_p.x, _p.y, _p.z], i * 3);
      if (y > ymax - 0.01 && (Math.round(u * m.w / 0.06) % 2) === 0) pins.push(i);
    }
    const fabric = rng.pick(['auntie_pink', 'auntie_mint', 'songkran', 'pkm_blue', 'sarong', 'paisley', 'terry']);
    const cloth = new Cloth(m, pos, pins, Wd * sp.h * 0.18, rng.next() * 100);
    cloth.ground = Math.min(A.y, B.y) - sp.h - 0.3;
    const { uv, col } = this.dress(m, fabric, rng, fabric === 'terry' ? sp.color : undefined);
    const g: Garment = { cloth, batch: null as any, vOff: 0, mesh: m, uv, col, lastStep: -1 };
    this.settle(cloth, 12);
    const bt = this.batch(fabric);
    g.batch = bt; bt.garments.push(g); this.garments.push(g);
  }

  build(only?: LineSpot[]) {
    const t0 = performance.now();
    const game = this.game;
    game.scene!.add(this.root);
    const pegs: THREE.Matrix4[] = [], pegCol: THREE.Color[] = [], ropes: THREE.BufferGeometry[] = [];
    const hangers: { m: THREE.Matrix4; wire: boolean; c: THREE.Color }[] = [];
    const spots = only ? [...only] : [...ClothSpots.lines];
    if (params.has('clothlab')) spots.push(...labSpots(game));
    this.stats.spots = spots.length;
    for (const s of spots) {
      try { if (s.kind === 'line') this.buildLine(s, pegs, pegCol, ropes); else this.buildRail(s, hangers); }
      catch (e) { console.warn('[cloth] spot failed', e); }
    }
    if (!only) for (const t of ClothSpots.tarps) { try { this.buildTarp(t); } catch (e) { console.warn('[cloth] tarp failed', e); } }
    if (!only) for (const c of ClothSpots.curtains) { try { this.buildCurtain(c); } catch (e) { console.warn('[cloth] curtain failed', e); } }
    for (const b of this.batches.values()) b.finalize(this.root);
    // pegs (instanced)
    if (pegs.length) {
      const im = new THREE.InstancedMesh(pegGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 }), pegs.length);
      pegs.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, pegCol[i]); });
      im.castShadow = true; im.receiveShadow = true; im.name = 'cloth:pegs';
      im.computeBoundingSphere();
      this.root.add(im);
    }
    // hangers (instanced: plastic + wire)
    const hg = hangerGeometry();
    for (const wire of [false, true]) {
      const hs = hangers.filter((h) => h.wire === wire);
      if (!hs.length) continue;
      const mat = wire ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.9 }) : new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
      const im = new THREE.InstancedMesh(wire ? hg.wire : hg.plastic, mat, hs.length);
      hs.forEach((h, i) => { im.setMatrixAt(i, h.m); im.setColorAt(i, h.c); });
      im.castShadow = true; im.receiveShadow = true; im.name = wire ? 'cloth:hangers-wire' : 'cloth:hangers';
      im.computeBoundingSphere();
      this.root.add(im);
    }
    // ropes (merged)
    if (ropes.length) {
      const { mergeGeometries } = BGU;
      const g = mergeGeometries(ropes.map((r) => r.toNonIndexed()));
      const rope = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x5a7ab0, roughness: 0.7 }));
      rope.name = 'cloth:ropes'; rope.castShadow = true; rope.receiveShadow = true;
      this.root.add(rope);
    }
    this.stats.garments = this.garments.length;
    this.stats.buildMs = Math.round(performance.now() - t0);
    console.info(`[cloth] ${this.garments.length} garments + tarps on ${spots.length} lines/rails and ${ClothSpots.tarps.length} tarps, ${this.batches.size} fabrics, built in ${this.stats.buildMs} ms`);
  }

  // ------------------------------------------------------------------ anchors (moving props)

  private liveAnchor(rec: AnchorRec, scene: THREE.Object3D) {
    const sp = rec.spec;
    const rng = new RNG(sp.seed ?? 7);
    const obj = rec.obj;
    obj.updateWorldMatrix(true, false);
    const M = obj.matrixWorld;
    const kind = sp.garment;
    let pinLocal: Float32Array | null = null;
    const capsLocal: number[] = [];
    for (const c of sp.capsules ?? []) capsLocal.push(...c[0], ...c[1], c[2]);
    const { g, fabric } = this.makeGarment(kind, rng, (m) => {
      const pos = new Float32Array(m.n * 3);
      const pins: number[] = [];
      const local: number[] = [];
      if (sp.drape) {
        const A = new THREE.Vector3(...sp.drape.a), B = new THREE.Vector3(...sp.drape.b), r = sp.drape.r ?? 0.015;
        const len = A.distanceTo(B);
        const bu = new THREE.Vector3().subVectors(B, A).normalize();
        const side = new THREE.Vector3().crossVectors(UP, bu).normalize();
        const ymax = m.xy.reduce((mx, v, i) => (i & 1 ? Math.max(mx, v) : mx), -1e9), ymin = m.xy.reduce((mn, v, i) => (i & 1 ? Math.min(mn, v) : mn), 1e9);
        const fold = ymin + (ymax - ymin) * 0.42;
        const row = new Set(rowAt(m, fold));
        for (let i = 0; i < m.n; i++) {
          const x = m.xy[i * 2], y = m.xy[i * 2 + 1];
          const t = 0.5 + (x * 0.9) / Math.max(0.05, len);                 // bunched a little on the bar
          _p.copy(A).lerp(B, Math.max(0, Math.min(1, t)));
          const dy = y - fold, sd = dy >= 0 ? 1 : -1, ad = Math.abs(dy);
          if (row.has(i)) { _p.addScaledVector(UP, r + 0.004); local.push(_p.x, _p.y, _p.z); pins.push(i); }
          else _p.addScaledVector(side, sd * (r + 0.006)).addScaledVector(UP, r - ad + 0.004);
          _v.copy(_p).applyMatrix4(M);
          pos.set([_v.x, _v.y, _v.z], i * 3);
        }
        capsLocal.push(...sp.drape.a, ...sp.drape.b, r);
      } else if (sp.pins?.length) {
        const top = topRow(m);
        const P = sp.pins.map((p) => new THREE.Vector3(...p));
        for (let i = 0; i < m.n; i++) {
          const x = m.xy[i * 2], y = m.xy[i * 2 + 1];
          const t = (x - m.x0) / Math.max(0.01, m.w);
          _p.copy(P[0]).lerp(P[P.length - 1], t).addScaledVector(UP, y - m.y0 - m.h);
          _v.copy(_p).applyMatrix4(M);
          pos.set([_v.x, _v.y, _v.z], i * 3);
        }
        for (const p of P) {
          const t = P.length > 1 ? P.indexOf(p) / (P.length - 1) : 0.5;
          const k = top.reduce((best, n) => (Math.abs((m.xy[n * 2] - m.x0) / m.w - t) < Math.abs((m.xy[best * 2] - m.x0) / m.w - t) ? n : best), top[0]);
          pins.push(k); local.push(p.x, p.y, p.z);
        }
      }
      pinLocal = new Float32Array(local);
      return { pos, pins };
    }, { fabric: sp.fabric, ground: 0.01, size: sp.size });
    // pins must be in the order the cloth stored them (Cloth keeps the order passed in)
    g.pinLocal = pinLocal!;
    g.capsLocal = capsLocal;
    g.anchor = rec;
    this.updateAnchor(g);
    this.settle(g.cloth, 40);
    const bt = new Batch(fabric);
    bt.garments.push(g);
    g.batch = bt;
    bt.finalize(scene);
    this.anchorBatches.push(bt);
    if (sp.fallback) sp.fallback.visible = false;
    rec.live = { g, bt, lost: 0, dispose: () => { bt.dispose(); this.anchorBatches = this.anchorBatches.filter((x) => x !== bt); if (sp.fallback) sp.fallback.visible = true; rec.live = null; } };
  }

  private updateAnchor(g: Garment) {
    const M = g.anchor!.obj.matrixWorld;
    const pl = g.pinLocal!, c = g.cloth;
    for (let i = 0; i < c.pinIdx.length; i++) {
      _v.set(pl[i * 3], pl[i * 3 + 1], pl[i * 3 + 2]).applyMatrix4(M);
      c.pinT[i * 3] = _v.x; c.pinT[i * 3 + 1] = _v.y; c.pinT[i * 3 + 2] = _v.z;
    }
    const cl = g.capsLocal!;
    if (cl.length) {
      const W: number[] = [];
      for (let i = 0; i < cl.length; i += 7) {
        _a.set(cl[i], cl[i + 1], cl[i + 2]).applyMatrix4(M); _b.set(cl[i + 3], cl[i + 4], cl[i + 5]).applyMatrix4(M);
        W.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, cl[i + 6]);
      }
      c.setCapsules(W);
    }
    // ground under a moving prop
    const w = this.game.world;
    if (w) c.ground = w.groundY(c.cx, c.cz) + 0.01;
  }

  private anchorsFrame(dt: number) {
    for (const rec of ClothAnchors) {
      const scene = sceneOf(rec.obj);
      if (!rec.live) {
        if (scene) { try { this.liveAnchor(rec, scene); } catch (e) { console.warn('[cloth] anchor failed', e); ClothAnchors.delete(rec); } }
        continue;
      }
      const L = rec.live;
      if (!scene) { L.lost += dt; if (L.lost > 2) { L.dispose(); if (L.lost > 30) ClothAnchors.delete(rec); } continue; }
      L.lost = 0;
      const g: Garment = L.g;
      this.updateAnchor(g);
      const d = g.cloth.x.length ? this.camPos.distanceTo(_v.set(g.cloth.cx, g.cloth.cy, g.cloth.cz)) : 99;
      if (d > 40) continue;
      this.stepGarment(g, dt);
      L.bt.flush();
    }
  }

  // ------------------------------------------------------------------ frame

  private camPos = new THREE.Vector3();

  private wind(t: number) {
    const rain = (this.game.world as any)?.rain ?? 0;
    // slow swell + occasional gusts (afternoon thunderstorm squalls with rain)
    const swell = 0.5 + 0.5 * Math.sin(t * 0.11) * Math.sin(t * 0.047 + 1.7);
    const gust = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1.3) * Math.sin(t * 0.071 + 0.4)) * 3.2;
    const sp = 0.6 + 1.5 * swell + gust + rain * 2.5;
    const dir = this.windDir;
    const wv = U.uWind.value as THREE.Vector3;
    if (wv) dir.set(wv.x, 0, wv.z).normalize();
    const veer = Math.sin(t * 0.05) * 0.45;
    const c = Math.cos(veer), s = Math.sin(veer);
    return { x: (dir.x * c - dir.z * s) * sp, z: (dir.x * s + dir.z * c) * sp, gust };
  }

  private stepGarment(g: Garment, dt: number) {
    const c = g.cloth;
    const env = this.env;
    // each garment feels the wind with its own lag (sheltered balconies, the gust front travelling down the soi)
    const w = this.wind(this.time - (c.cx * 0.06 + c.cz * 0.035));
    const shelter = g.anchor ? 0.75 : 0.85;
    env.wx = w.x * shelter; env.wz = w.z * shelter; env.wy = 0.15 * Math.sin(this.time * 0.7 + c.cx);
    env.turb = 0.45 + Math.min(0.5, w.gust * 0.2);
    env.dt = Math.min(1 / 20, Math.max(1 / 120, dt));
    env.time = this.time;
    env.nSpheres = this.nSpheres;
    c.step(env);
    c.computeNormals();
    g.batch.write(g);
    this.stats.stepped++;
  }

  private gatherPeople() {
    let n = 0;
    const S = this.spheres;
    const add = (x: number, y: number, z: number, r: number) => { if (n < 16) { S.set([x, y, z, r], n * 4); n++; } };
    const game = this.game;
    const me = game.localPlayerId;
    for (const pl of game.players()) {
      if (!pl.p) continue;
      let x = pl.p[0], y = pl.p[1], z = pl.p[2];
      if (pl.id === me && game.player) { const P = (game.player as any).pos as THREE.Vector3 | undefined; if (P) { x = P.x; y = P.y; z = P.z; } }
      add(x, y + 1.55, z, 0.2); add(x, y + 1.15, z, 0.27); add(x, y + 0.6, z, 0.22);
    }
    this.nSpheres = n;
  }

  frame(dt: number) {
    const t0 = performance.now();
    this.time += dt;
    this.frameN++;
    this.stats.stepped = 0;
    const cam = this.game.engine.camera;
    cam.getWorldPosition(this.camPos);
    this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.gatherPeople();
    let active = 0;
    const sph = new THREE.Sphere();
    for (const g of this.garments) {
      const c = g.cloth;
      const dx = c.cx - this.camPos.x, dy = c.cy - this.camPos.y, dz = c.cz - this.camPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 34 + c.rad) continue;
      sph.center.set(c.cx, c.cy, c.cz); sph.radius = c.rad + 0.3;
      if (d > 5 && !this.frustum.intersectsSphere(sph)) continue;
      active++;
      if (active > 72) continue;                                        // budget: the nearest dense balconies
      // full rate up close, then every 2nd / 3rd frame with a longer step (cloth far away needs less detail)
      const every = d > 22 ? 3 : d > 12 ? 2 : 1;
      if (every > 1 && (this.frameN + g.vOff) % every) continue;
      this.stepGarment(g, dt * every);
    }
    for (const b of this.batches.values()) b.flush();
    this.anchorsFrame(dt);
    this.stats.active = active;
    this.stats.ms = +(this.stats.ms * 0.9 + (performance.now() - t0) * 0.1).toFixed(2);
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.garments = [];
    this.root.removeFromParent();
    this.root.traverse((o: any) => { if (o.isInstancedMesh || o.isMesh) o.geometry?.dispose?.(); });
    this.root.clear();
  }
}


function sceneOf(o: THREE.Object3D): THREE.Scene | null {
  let p: THREE.Object3D | null = o;
  while (p) { if ((p as any).isScene) return p as THREE.Scene; p = p.parent; }
  return null;
}

/** ?clothlab: a test clothes-line and a hanger rail right in front of the spawn */
function labSpots(game: Game): LineSpot[] {
  const P = game.player?.pos ?? new THREE.Vector3(0, 0.15, 0);
  const yaw = game.player?.yaw ?? 0;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const base = new THREE.Vector3(P.x, (game.world?.groundY(P.x, P.z) ?? 0.15), P.z).addScaledVector(f, 2.6);
  const A = base.clone().addScaledVector(r, -1.6).setY(base.y + 1.95), B = base.clone().addScaledVector(r, 1.6).setY(base.y + 1.95);
  const C = base.clone().addScaledVector(f, 1.3).addScaledVector(r, -1.4).setY(base.y + 2.1), D = C.clone().addScaledVector(r, 2.8);
  return [
    { kind: 'line', a: A.toArray() as any, b: B.toArray() as any, seed: 11, fill: 1, style: 'balcony' },
    { kind: 'rail', a: C.toArray() as any, b: D.toArray() as any, seed: 23, fill: 1 },
  ];
}

let CW: ClothWorld | null = null;

export default defineModule({
  id: 'cloth',
  deps: ['world'],
  init(game) {
    game.events.on('world:exit', () => { CW?.dispose(); CW = null; });
    (window as any).__cloth = () => CW?.stats;
  },
  async buildWorld(game) {
    CW?.dispose();
    CW = new ClothWorld(game);
    CW.build();
  },
  frame(game, dt) {
    if (!CW) {
      // anchors can live in other scenes too (menu, intro): keep them simulated without a world
      if (ClothAnchors.size && game.engine?.camera) { CW = new ClothWorld(game); }
      else return;
    }
    if (dt > 0) CW.frame(Math.min(dt, 0.1));
  },
});
