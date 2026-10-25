import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { RNG } from '../../core/rng';
import type { AnchorPt } from '../../game/contracts';
import { ALL, SIDES } from './geo';
import type { ShopCtx } from './shophouse';
import { groundDecal, wallDecal } from './streets';
import { wallShrine } from './archkit';
import { RealProps, realPropObject } from './realprops';
import { makeFlyFan } from './realprops-stall';
import { STEEL_TABLE } from './realprops-table';
import { PLASTIC_COLORS } from './props';

/**
 * MARKET LIFE — micro detail around the four functional stalls (the shops module builds their
 * tables, goods and keepers; this adds the world around them) plus helpers shared by the
 * decorative stalls: wind-blown sagging tarps & umbrellas (one draw call, vertex wind), photo heaps,
 * handwritten price cards on sticks, bulbs on cords, cash tins, radios, calendars, shrine shelves.
 *
 * Butcher: stainless meat counters with real cuts, swinging meat on hooks, tamarind chopping block
 * with a cleaver stuck in it, knives on a magnetic strip, blood smears/drips/puddle, hanging dial
 * scale, plastic bags on a nail, spinning fly-repelling fan, bare bulb, styrofoam ice boxes.
 * Veg: crate stands with kradong trays and wicker baskets heaped with chilies, garlic, shallots,
 * limes, holy basil, long beans; price cards; mist sprayer. Egg: stacked pulp trays, cracked shells.
 * Auntie: steel shelf crammed with real Thai packaging, hanging snack strips, old Coke fridge.
 */

type Ctx = ShopCtx & { rng: RNG };

/** stall frame: x = right, z = forward into the stall (as in shops/fixtures.ts), y up */
class Frame {
  o: THREE.Vector3; yaw: number; f: THREE.Vector3; r: THREE.Vector3;
  constructor(a: AnchorPt) {
    this.o = new THREE.Vector3(a.p[0], a.p[1], a.p[2]);
    this.yaw = a.yaw ?? 0;
    this.f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  at(x: number, y: number, z: number) { return this.o.clone().addScaledVector(this.r, x).addScaledVector(this.f, z).add(new THREE.Vector3(0, y, 0)); }
}

// ------------------------------------------------------------------ geometry batches for one-off photo meshes
class Merge {
  private parts = new Map<string, { mat: THREE.Material; gs: THREE.BufferGeometry[] }>();
  add(key: string, mat: () => THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { mat: mat(), gs: [] }));
    if (m) g.applyMatrix4(m);
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    p.gs.push(n);
  }
  build(name: string, shadows = false): THREE.Group {
    const root = new THREE.Group(); root.name = name;
    for (const [, p] of this.parts) {
      const g = mergeGeometries(p.gs, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, p.mat);
      mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    return root;
  }
}
const M4 = (p: THREE.Vector3, yaw = 0, rx = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), new THREE.Vector3(s, s, s));
const photoMat = (path: string, o: { alpha?: boolean; rough?: number; side?: THREE.Side; color?: number } = {}) => () => {
  const m = new THREE.MeshStandardMaterial({ map: Assets.texture(path, { wrap: true }), roughness: o.rough ?? 0.75, side: o.side ?? THREE.FrontSide, color: o.color ?? 0xffffff });
  if (o.alpha) m.alphaTest = 0.45;
  return m;
};

// ------------------------------------------------------------------ wind cloth (tarps + umbrellas)
export class WindCloth {
  private pos: number[] = []; private uv: number[] = []; private col: number[] = []; private wgt: number[] = []; private idx: number[] = [];
  readonly uTime = { value: 0 };
  /** sagging tarp over 4 corners (a,b = front edge, c,d = back edge), corners pinned */
  tarp(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number, sag = 0.12, nu = 10, nv = 6) {
    const o = this.pos.length / 3;
    const col = new THREE.Color(color);
    const P = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      P.copy(a).lerp(b, u).lerp(new THREE.Vector3().copy(d).lerp(c, u), v);
      const s = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const scallop = (j === 0 || j === nv) ? Math.abs(Math.sin(u * Math.PI * 4)) * 0.03 : 0;
      P.y -= sag * s + scallop;
      this.pos.push(P.x, P.y, P.z);
      this.uv.push(u * a.distanceTo(b) * 0.7, v * a.distanceTo(d) * 0.7);
      this.col.push(col.r, col.g, col.b);
      // pinned at the 4 poles, edges flap most
      const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      this.wgt.push(Math.min(1, s * 1.6 + edge * 0.5) * (1 - Math.pow(Math.max(Math.abs(u - 0.5), 0) * 2 * Math.max(Math.abs(v - 0.5), 0) * 2, 6)));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = o + j * (nu + 1) + i;
      this.idx.push(k, k + nu + 1, k + 1, k + 1, k + nu + 1, k + nu + 2);
    }
  }
  /** street umbrella canopy: 8 ribs, scalloped sagging panels, alternating colours */
  umbrella(c: THREE.Vector3, R: number, top: number, color: number, color2 = 0xf2ede0) {
    const o = this.pos.length / 3;
    const ribs = 8, seg = 4, rings = 4;
    const ca = new THREE.Color(color), cb = new THREE.Color(color2);
    this.pos.push(c.x, c.y + top + 0.04, c.z); this.uv.push(0.5, 0.5); this.col.push(ca.r, ca.g, ca.b); this.wgt.push(0);
    const N = ribs * seg;
    for (let k = 1; k <= rings; k++) for (let i = 0; i < N; i++) {
      const t = k / rings, a = (i / N) * Math.PI * 2;
      const between = Math.abs(Math.sin((i / seg) * Math.PI));
      const r = R * t * (1 - between * 0.04 * t);
      const y = c.y + top - 0.42 * Math.pow(t, 1.4) - between * 0.05 * t * t;
      this.pos.push(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
      this.uv.push(0.5 + Math.cos(a) * t * 0.5, 0.5 + Math.sin(a) * t * 0.5);
      const cc = Math.floor(i / seg) % 2 ? cb : ca;
      this.col.push(cc.r, cc.g, cc.b);
      this.wgt.push(t * t * (0.4 + between * 0.6));
    }
    for (let i = 0; i < N; i++) this.idx.push(o, o + 1 + ((i + 1) % N), o + 1 + i);
    for (let k = 1; k < rings; k++) for (let i = 0; i < N; i++) {
      const a0 = o + 1 + (k - 1) * N + i, a1 = o + 1 + (k - 1) * N + ((i + 1) % N);
      const b0 = a0 + N, b1 = a1 + N;
      this.idx.push(a0, a1, b0, a1, b1, b0);
    }
  }
  build(): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wgt, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = Assets.pbr('canvas_tarp', { repeat: 1, fallback: 0xffffff }).clone() as THREE.MeshStandardMaterial;
    m.vertexColors = true; m.color.set(0xffffff); m.side = THREE.DoubleSide; m.roughness = Math.max(0.75, m.roughness);
    const uT = this.uTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWindT = uT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWind;\nuniform float uWindT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wph = position.x * 0.9 + position.z * 0.7;
          float gust = 0.6 + 0.4 * sin(uWindT * 0.37 + position.x * 0.05);
          transformed.y += aWind * gust * (sin(uWindT * 2.3 + wph) * 0.045 + sin(uWindT * 4.1 + wph * 2.3) * 0.018);
          transformed.x += aWind * gust * sin(uWindT * 1.7 + wph * 1.3) * 0.02;
          transformed.z += aWind * gust * cos(uWindT * 1.9 + wph) * 0.02;`);
    };
    m.customProgramCacheKey = () => 'windcloth';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'windcloth'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    return mesh;
  }
}

// ------------------------------------------------------------------ price cards (handwritten Thai, looped fonts)
export class PriceCards {
  private items: { text: string; sub?: string; p: THREE.Vector3; yaw: number; s: number; stick: number }[] = [];
  add(text: string, p: THREE.Vector3, yaw: number, o: { sub?: string; s?: number; stick?: number } = {}) { this.items.push({ text, sub: o.sub, p, yaw, s: o.s ?? 1, stick: o.stick ?? 0.16 }); }
  build(): THREE.Group | null {
    if (!this.items.length) return null;
    const n = this.items.length, cols = 4, rows = Math.ceil(n / cols), cw = 256, ch = 180;
    const cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * ch;
    const ctx = cv.getContext('2d')!;
    const card = new Image();
    const draw = () => {
      this.items.forEach((it, i) => {
        const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
        if (card.complete && card.naturalWidth) ctx.drawImage(card, x, y, cw, ch);
        else { ctx.fillStyle = '#d8b88a'; ctx.fillRect(x, y, cw, ch); }
        ctx.save();
        ctx.translate(x + cw / 2, y + ch / 2);
        ctx.rotate(((i * 37) % 7 - 3) * 0.012);
        ctx.fillStyle = i % 3 === 1 ? '#b0121a' : '#141210';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `400 ${it.sub ? 64 : 84}px ${F.hand}`;
        ctx.fillText(it.text, 0, it.sub ? -22 : 4);
        if (it.sub) { ctx.font = `400 40px ${F.hand2 ?? F.hand}`; ctx.fillText(it.sub, 0, 48); }
        ctx.restore();
      });
      tex.needsUpdate = true;
    };
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    card.onload = draw;
    card.src = Assets.url('gen/shops/card_kraft.jpg');
    draw();
    const gs: THREE.BufferGeometry[] = [], sticks: THREE.BufferGeometry[] = [];
    this.items.forEach((it, i) => {
      const w = 0.1 * it.s, h = 0.07 * it.s;
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const u0 = (i % cols) / cols, v0 = 1 - (Math.floor(i / cols) + 1) / rows;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / cols, v0 + uv.getY(k) / rows);
      g.translate(0, it.stick + h / 2, 0);
      g.applyMatrix4(M4(it.p, it.yaw, -0.12));
      gs.push(g);
      const st = new THREE.CylinderGeometry(0.0025, 0.0025, it.stick + 0.03, 4).translate(0, (it.stick + 0.03) / 2 - 0.03, 0);
      st.applyMatrix4(M4(it.p, it.yaw));
      sticks.push(st);
    });
    const root = new THREE.Group(); root.name = 'pricecards';
    const cards = new THREE.Mesh(mergeGeometries(gs, false)!, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
    const st = new THREE.Mesh(mergeGeometries(sticks, false)!, new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 0.8 }));
    for (const m of [cards, st]) { m.matrixAutoUpdate = false; root.add(m); }
    return root;
  }
}

// ------------------------------------------------------------------ calendar (real temple-fair poster + month grid)
function calendarTexture(): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 384;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (img?: HTMLImageElement) => {
    ctx.fillStyle = '#f6f2ea'; ctx.fillRect(0, 0, 256, 384);
    if (img) ctx.drawImage(img, 8, 8, 240, 200);
    ctx.fillStyle = '#b01818'; ctx.fillRect(8, 212, 240, 34);
    ctx.fillStyle = '#fff'; ctx.font = `700 24px ${F.ui}`; ctx.textAlign = 'center'; ctx.fillText('ตุลาคม ๒๕๖๙', 128, 238);
    ctx.font = `600 18px ${F.ui}`;
    for (let d = 1; d <= 31; d++) { const c = (d + 2) % 7, r = Math.floor((d + 2) / 7); ctx.fillStyle = c === 0 ? '#c01818' : '#222'; ctx.fillText(String(d), 26 + c * 34, 270 + r * 22); }
    tex.needsUpdate = true;
  };
  draw();
  Assets.image('img/posters/poster_temple_fair.png').then(draw).catch(() => {});
  return tex;
}

// ------------------------------------------------------------------ shared small helpers
function bulbOnCord(c: Ctx, real: RealProps, top: THREE.Vector3, len: number, warm = true) {
  const w = c.w;
  w.mat('rubber', { uv: 'local', group: 'detail' });
  w.tube([top.x, top.y, top.z, top.x + 0.01, top.y - len * 0.5, top.z, top.x, top.y - len, top.z], 0.004, 3);
  real.add('bulb', top.x, top.y - len, top.z, 0);
  c.lights.add({ p: new THREE.Vector3(top.x, top.y - len - 0.08, top.z), color: new THREE.Color(warm ? 0xffc890 : 0xf0f4ff), intensity: 7, range: 7, glow: 0.45, kind: 'custom' });
}
function cord(c: Ctx, pts: THREE.Vector3[], sag = 0.12) {
  const w = c.w;
  w.mat('rubber', { uv: 'local', group: 'detail' });
  const flat: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = (a.y > 0.3 || b.y > 0.3) ? WBsag(a, b, sag) : [a.x, a.y, a.z, b.x, b.y, b.z];
    flat.push(...(i ? seg.slice(3) : seg));
  }
  w.tube(flat, 0.005, 3);
}
function WBsag(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const out: number[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t); }
  return out;
}
/** stand of n×m upside-down crates; returns the top surface height */
function crateStand(real: RealProps, F0: Frame, x: number, z: number, nx: number, ny: number, color: number, rng: RNG) {
  const yaw = F0.yaw + Math.PI / 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = F0.at(x + (i - (nx - 1) / 2) * 0.41, 0, z);
    real.add('crate', p.x, p.y + j * 0.254, p.z, yaw + (rng.next() - 0.5) * 0.06, { color });
  }
  return F0.o.y + ny * 0.254;
}
/** photo heap (dome) — merged */
function heap(mg: Merge, path: string, p: THREE.Vector3, r: number, h: number, seed: number) {
  const g = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const pa = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const n = 1 + Math.sin(x * 9 + seed) * Math.cos(z * 7 + seed) * 0.08; pa.setXYZ(i, x * r * n, y * h * n, z * r * n); }
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + pa.getX(i) / (2.2 * r), 0.5 + pa.getZ(i) / (2.2 * r));
  g.computeVertexNormals();
  mg.add('heap:' + path, photoMat(path, { rough: 0.7 }), g, M4(p, seed));
}
function kradong(mg: Merge, p: THREE.Vector3, r: number, yaw: number) {
  const g = new THREE.CircleGeometry(r, 20);
  g.rotateX(-Math.PI / 2);
  // slight dish shape
  const pa = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) { const d = Math.hypot(pa.getX(i), pa.getZ(i)) / r; pa.setY(i, d * d * 0.035); }
  g.computeVertexNormals();
  mg.add('kradong', photoMat('gen/shops/kradong.png', { alpha: true, side: THREE.DoubleSide }), g, M4(p.clone().add(new THREE.Vector3(0, 0.005, 0)), yaw));
}

// ------------------------------------------------------------------ the four functional stalls
export function dressMarketStalls(c: Ctx, cloth: WindCloth) {
  const real = c.props.real, A = c.anchors, rng = c.rng, w = c.w, D = c.decals;
  const mg = new Merge();
  const cards = new PriceCards();
  const calTex = calendarTexture();
  const calMat = () => new THREE.MeshStandardMaterial({ map: calTex, roughness: 0.8 });
  const calendar = (F0: Frame, x: number, y: number, z: number) => { const g = new THREE.PlaneGeometry(0.26, 0.39); mg.add('calendar', calMat, g, M4(F0.at(x, y, z), F0.yaw, 0, (rng.next() - 0.5) * 0.06)); };
  const H = 0.8, poleY = 2.35, zFront = 0.375, zBack = 2.03, px = 1.35;

  // =============================================================== BUTCHER
  if (A.butcher_stall) {
    const B = new Frame(A.butcher_stall);
    const y0 = B.o.y, ct = y0 + STEEL_TABLE.H;
    const side = B.yaw + Math.PI / 2;
    // two stainless side counters (static: blood decals live on them)
    for (const sx of [-1, 1]) { const p = B.at(sx * 2.05, 0, 0.95); real.add('steel_table', p.x, p.y, p.z, side, { phys: 'static' }); }
    // right counter: raw cuts on a wet top
    const cut = (id: string, x: number, z: number, dy = 0, a = 0) => { const p = B.at(x, 0, z); real.add(id, p.x, ct + dy, p.z, side + a + (rng.next() - 0.5) * 0.25); };
    cut('meat_belly', 1.93, 0.66); cut('meat_belly2', 2.2, 0.7, 0, 0.1); cut('meat_belly', 1.96, 0.68, 0.045, 0.3);
    cut('meat_ribs', 2.05, 1.0, 0, 0.05); cut('meat_dark', 1.86, 1.22); cut('meat_dark', 1.9, 1.26, 0.035, 0.6);
    cut('meat_minced', 2.2, 1.22);
    if (D) {
      const st = D.get('decal_oil_stains_photo'), pud = D.cell('decal_puddles', 1, 0, 2, 2), drip = D.get('decal_wall_grime_streaks_photo');
      for (let k = 0; k < 3; k++) { const p = B.at(2.05 + (rng.next() - 0.5) * 0.4, 0, 0.6 + k * 0.32); groundDecal(w, st, p.x, ct + 0.002, p.z, 0.32, 0.26, rng.range(0, 6), { tint: 0x8a1010, alpha: 0.75, wet: 1 }); }
      const pf = B.at(1.95, 0, 0.35); groundDecal(w, pud, pf.x, y0 + 0.006, pf.z, 0.9, 0.6, 0.4, { tint: 0x5a0606, alpha: 0.85, wet: 1 });
      const pf2 = B.at(-0.4, 0, 0.15); groundDecal(w, pud, pf2.x, y0 + 0.006, pf2.z, 0.5, 0.35, 1.2, { tint: 0x4a0606, alpha: 0.7, wet: 1 });
      // drips down the front of the counter and the stall skirt
      const n = B.f.clone().negate();
      for (const [x, z, y, sw] of [[2.05, 0.5 - 0.006, ct - 0.035, 0.4], [-0.6, 0.39 - 0.03, y0 + H - 0.2, 0.35], [0.7, 0.39 - 0.03, y0 + H - 0.22, 0.3]] as [number, number, number, number][]) {
        const p = B.at(x, 0, z); wallDecal(w, drip, p.x, y, p.z, n.x, n.z, sw, 0.3, { tint: 0x7a0c0c, alpha: 0.8 });
      }
    }
    // hook rail with swinging meat over the right counter
    const r0 = B.at(1.42, 0, 0.5), r1 = B.at(2.68, 0, 0.5);
    w.mat('stainless', { uv: 'local', group: 'detail' });
    w.tube([r0.x, y0 + 2.08, r0.z, r1.x, y0 + 2.08, r1.z], 0.016, 6);
    w.cyl(r1.x, y0, r1.z, 0.025, 0.025, 2.1, 8, 1);
    c.phys.box([r1.x, y0 + 1.05, r1.z], [0.06, 2.1, 0.06]);
    const swing: THREE.Object3D[] = [];
    [['meat_belly', 1.6], ['meat_ribs', 1.95], ['meat_belly2', 2.3], ['meat_dark', 2.55]].forEach(([id, x], i) => {
      const hp = B.at(x as number, 0, 0.5); hp.y = y0 + 2.065;
      w.mat('steel_rust', { uv: 'local', group: 'detail' });
      w.tube([hp.x, hp.y, hp.z, hp.x, hp.y - 0.05, hp.z + 0.01, hp.x, hp.y - 0.09, hp.z], 0.003, 4);
      const pivot = new THREE.Group();
      pivot.position.set(hp.x, hp.y - 0.09, hp.z); pivot.rotation.y = B.yaw;
      const meat = realPropObject(id as string, { shadow: true });
      meat.rotation.z = Math.PI / 2; meat.position.set(0.02, -0.17 - i * 0.01, 0);
      pivot.add(meat);
      real.addObject(pivot); swing.push(pivot);
    });
    real.animate(B.at(2, 1.5, 0.5), 30, (_dt, t) => { swing.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.25 + i * 1.7) * 0.07; p.rotation.x = Math.sin(t * 0.83 + i * 2.3) * 0.05; }); });
    // left counter: tamarind block + cleaver stuck in it, a second cleaver, knives on a magnetic strip
    const bp = B.at(-2.05, 0, 0.85);
    real.add('chop_block', bp.x, ct, bp.z, rng.range(0, 6));
    real.add('cleaver', bp.x + 0.02, ct + 0.11 - 0.024, bp.z, side + 0.5, { rz: 0.1, phys: 'none' });
    const c2 = B.at(-2.2, 0, 1.22); real.add('cleaver', c2.x, ct + 0.002, c2.z, side + 0.3, { rx: -Math.PI / 2, phys: 'none' });
    const kb0 = B.at(-2.05, 0, 1.36);
    w.mat('wood_old', { uv: 'local', group: 'detail' });
    w.pushT(kb0.x, ct, kb0.z, B.yaw);
    w.box(-0.3, 0.05, -0.02, 0.3, 0.62, 0.0, ALL);
    w.mat('stainless', { uv: 'local' });
    w.box(-0.27, 0.48, 0.0, 0.27, 0.52, 0.012, ALL);
    w.pop();
    for (let k = 0; k < 4; k++) { const p = B.at(-2.25 + k * 0.13, 0, 1.335); real.add('knife', p.x, ct + 0.31, p.z, B.yaw + Math.PI / 2, { rz: (rng.next() - 0.5) * 0.08 }); }
    const ctin = B.at(-1.85, 0, 1.2); real.add('cash_tin', ctin.x, ct, ctin.z, rng.range(0, 6));
    // ice boxes + bucket under / beside the left counter
    const ib = B.at(-2.1, 0, 1.8); real.add('styro_box', ib.x, y0, ib.z, side + 0.1); real.add('styro_box', ib.x, y0 + 0.31, ib.z, side - 0.05);
    const bk = B.at(-1.6, 0, 1.55); real.add('bucket', bk.x, y0, bk.z, 0, { color: 0xc03028 });
    // hanging dial scale, plastic bags on nails, fly-repelling fan, bare bulb, calendar, shrine shelf
    const sp = B.at(0.85, 0, 0.45);
    w.mat('rubber', { uv: 'local', group: 'detail' });
    w.tube([sp.x, y0 + poleY + 0.05, sp.z, sp.x, y0 + 2.12, sp.z], 0.003, 3);
    real.add('hanging_scale', sp.x, y0 + 2.12, sp.z, B.yaw);
    for (const [sx, col] of [[1, 0xfff6f4], [-1, 0xffc8d8]] as [number, number][]) { const p = B.at(sx * px, 0, zFront - 0.04); real.add('bag_bundle', p.x, y0 + 1.72, p.z, B.yaw, { color: col }); }
    const fan = makeFlyFan();
    fan.object.position.copy(B.at(2.32, 0, 1.3)); fan.object.position.y = ct;
    real.addObject(fan.object);
    real.animate(fan.object.position, 25, (dt) => { fan.spin.rotation.y += dt * 9; });
    bulbOnCord(c, real, B.at(2.05, 0, 0.5).setY(y0 + 2.07), 0.3);
    calendar(B, px - 0.02, y0 + 1.45, zBack - 0.04);
    w.put(wallShrine(w), ...B.at(-0.9, 0, 2.76).setY(y0 + 1.85).toArray() as [number, number, number], B.yaw);
    const rc = B.at(1.0, 0, 2.5); const top = crateStand(real, new Frame({ p: [rc.x, y0, rc.z], yaw: B.yaw }), 0, 0, 1, 1, 0x2a62b8, rng);
    real.add('radio', rc.x, top, rc.z, B.yaw + 0.2);
  }

  // =============================================================== VEG
  if (A.veg_stall) {
    const V = new Frame(A.veg_stall);
    const y0 = V.o.y;
    // left: crate stand with kradong trays of chilies, garlic, shallots
    const t1 = crateStand(real, V, -2.05, 0.95, 2, 2, 0x2a8a4a, rng);
    const goods: [string, string, string][] = [['gen/shops/heap_chili.jpg', 'พริก', 'ขีดละ 15.-'], ['gen/shops/heap_garlic.jpg', 'กระเทียม', 'โลละ 80'], ['gen/shops/heap_shallot.jpg', 'หอมแดง', 'โล 60.-']];
    goods.forEach(([ph, name, price], i) => {
      const p = V.at(-2.05 + (i - 1) * 0.36, 0, 0.8 + (i % 2) * 0.32); p.y = t1;
      kradong(mg, p, 0.21, rng.range(0, 6));
      heap(mg, ph, p.clone().setY(t1 + 0.02), 0.16, 0.07 + rng.next() * 0.03, i * 3 + 1);
      cards.add(name, p.clone().add(V.f.clone().multiplyScalar(-0.12)).setY(t1 + 0.05), V.yaw + (rng.next() - 0.5) * 0.3, { sub: price });
    });
    // right: wicker baskets on crates — limes, holy basil, long beans
    const t2 = crateStand(real, V, 2.05, 0.95, 2, 1, 0xd03030, rng);
    const bx = (i: number) => V.at(1.85 + i * 0.42, 0, 0.95);
    for (let i = 0; i < 2; i++) { const p = bx(i); real.add('basket', p.x, t2, p.z, V.yaw + (rng.next() - 0.5) * 0.3, { phys: 'none' }); }
    { const p = bx(0); for (let k = 0; k < 22; k++) { const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * 0.13; real.add('lime', p.x + Math.cos(a) * r * 1.2, t2 + 0.03 + (0.13 - r) * 0.5 + (k > 14 ? 0.04 : 0), p.z + Math.sin(a) * r * 0.85, rng.range(0, 6), { rx: rng.range(0, 3), scale: rng.range(0.9, 1.1) }); }
      cards.add('มะนาว', p.clone().add(V.f.clone().multiplyScalar(-0.15)).setY(t2 + 0.06), V.yaw, { sub: '4 ลูก 20.-' }); }
    { const p = bx(1); heap(mg, 'gen/shops/heap_basil.jpg', p.clone().setY(t2 + 0.04), 0.16, 0.1, 9); cards.add('กะเพรา', p.clone().add(V.f.clone().multiplyScalar(-0.15)).setY(t2 + 0.06), V.yaw, { sub: 'กำละ 10.-' }); }
    const bb = V.at(2.05, 0, 1.45); real.add('basket_lid', bb.x, y0, bb.z, V.yaw + 0.4, { phys: 'none' });
    heap(mg, 'gen/shops/heap_beans.jpg', bb.clone().setY(y0 + 0.16), 0.12, 0.08, 12);
    // mist sprayer, bananas, styrofoam boxes, a cash tin, radio
    const ms = V.at(2.42, 0, 0.7); real.add('mist_bottle', ms.x, t2, ms.z, V.yaw + 0.8, { color: 0x2a62b8 });
    const bn = V.at(-1.7, 0, 1.25); real.add('bananas', bn.x, t1, bn.z, V.yaw + 0.3);
    const sb = V.at(-2.1, 0, 1.75); real.add('styro_box', sb.x, y0, sb.z, V.yaw + Math.PI / 2 + 0.1);
    const ct2 = V.at(-1.6, 0, 1.75); real.add('cash_tin', ct2.x, y0 + 0.31, ct2.z, 0);
    for (let k = 0; k < 2; k++) { const p = V.at(-1.7 + k * 0.05, 0, 1.7 + k * 0.05); real.add('styro_box', p.x, y0, p.z, V.yaw + k); }
    calendar(V, -px + 0.02, y0 + 1.5, zBack - 0.04);
    bulbOnCord(c, real, V.at(-0.4, 0, 0.6).setY(y0 + poleY - 0.05), 0.4);
    w.put(wallShrine(w), ...V.at(1.0, 0, 2.76).setY(y0 + 1.85).toArray() as [number, number, number], V.yaw);
  }

  // =============================================================== EGG
  if (A.egg_stall) {
    const E = new Frame(A.egg_stall);
    const y0 = E.o.y;
    for (const sx of [-1, 1]) {
      const top = crateStand(real, E, sx * 2.0, 0.95, 2, 1, sx > 0 ? 0xe0b020 : 0x2a62b8, rng);
      for (let s = 0; s < 2; s++) {
        const n = rng.int(4, 8), p = E.at(sx * 2.0 + (s - 0.5) * 0.36, 0, 0.95 + (rng.next() - 0.5) * 0.06);
        for (let k = 0; k < n; k++) real.add('egg_tray', p.x, top + k * 0.068, p.z, E.yaw + (rng.next() - 0.5) * 0.12 + (k % 2) * 0.04);
        cards.add(['ไข่เบอร์ 0', 'ไข่เบอร์ 1', 'ไข่เบอร์ 2', 'ไข่เบอร์ 3'][(s + (sx > 0 ? 2 : 0)) % 4], p.clone().add(E.f.clone().multiplyScalar(-0.2)).setY(top + n * 0.068 - 0.05), E.yaw, { sub: `แผงละ ${[135, 125, 118, 110][(s + (sx > 0 ? 2 : 0)) % 4]}.-`, stick: 0.04 });
      }
    }
    for (let k = 0; k < 7; k++) { const p = E.at(rng.range(-1.6, 1.6), 0, rng.range(0.1, 0.35)); real.add('egg_shell', p.x, y0 + 0.002, p.z, rng.range(0, 6), { rx: rng.chance(0.5) ? Math.PI : 0.3 }); }
    if (D) { const pf = E.at(0.6, 0, 0.2); groundDecal(w, D.cell('decal_puddles', 0, 1, 2, 2), pf.x, y0 + 0.006, pf.z, 0.4, 0.3, 0.5, { tint: 0xd8a830, alpha: 0.6, wet: 1 }); }
    const sb = E.at(-2.1, 0, 1.7); real.add('styro_box', sb.x, y0, sb.z, E.yaw);
    const rd = E.at(2.0, 0, 1.75); real.add('radio', rd.x, y0, rd.z, E.yaw - 0.3);
    calendar(E, px - 0.02, y0 + 1.5, zBack - 0.04);
    bulbOnCord(c, real, E.at(0.4, 0, 0.6).setY(y0 + poleY - 0.05), 0.4);
  }

  // =============================================================== AUNTIE (dry goods)
  if (A.auntie_stall) {
    const Au = new Frame(A.auntie_stall);
    const y0 = Au.o.y;
    // steel shelf crammed with real Thai packaging
    const sp = Au.at(-2.0, 0, 1.55);
    real.add('shelf_steel', sp.x, y0, sp.z, Au.yaw);
    shelfGoods(mg, Au, -2.0, 1.55, y0, rng);
    // old drinks fridge + radio on top
    const fp = Au.at(2.0, 0, 1.6);
    real.add('fridge', fp.x, y0, fp.z, Au.yaw);
    real.add('radio', fp.x, y0 + 1.72, fp.z, Au.yaw + 0.15, { phys: 'none' });
    c.lights.add({ p: Au.at(2.0, 1.0, 1.0).add(new THREE.Vector3(0, y0, 0)), color: new THREE.Color(0xf4f8ff), intensity: 3, range: 3, glow: 0.3, kind: 'store', day: 0.4 });
    // hanging snack strips from the canopy front beam
    snackStrips(mg, Au, y0, rng);
    const bn = Au.at(-1.0, 0, 2.6); real.add('bananas', bn.x, y0 + 0.51, bn.z, Au.yaw + 0.5);
    crateStand(real, Au, -1.0, 2.6, 1, 2, 0x2a8a4a, rng);
    calendar(Au, -px + 0.02, y0 + 1.5, zBack - 0.04);
    bulbOnCord(c, real, Au.at(0.3, 0, 0.6).setY(y0 + poleY - 0.05), 0.35);
    const ct = Au.at(1.62, 0, 0.75); const top = crateStand(real, new Frame({ p: [ct.x, y0, ct.z], yaw: Au.yaw }), 0, 0, 1, 2, 0xd03030, rng);
    real.add('cash_tin', ct.x, top, ct.z, 0.4);
    w.put(wallShrine(w), ...Au.at(0.2, 0, 2.76).setY(y0 + 1.9).toArray() as [number, number, number], Au.yaw);
  }

  // extension cords along the canopy poles to a power strip on the floor
  for (const n of ['butcher_stall', 'veg_stall', 'egg_stall', 'auntie_stall']) {
    const a = A[n]; if (!a) continue;
    const Fr = new Frame(a), y0 = Fr.o.y;
    const top = Fr.at(px + 0.04, 0, zBack).setY(y0 + poleY);
    const bot = Fr.at(px + 0.04, 0, zBack).setY(y0 + 0.02);
    const strip = Fr.at(px - 0.2, 0, zBack + 0.25).setY(y0 + 0.02);
    cord(c, [Fr.at(0, 0, 0.6).setY(y0 + poleY - 0.05), top, bot, strip], 0.15);
    w.mat('plastic', { tint: 0xe8e4dc, uv: 'local', group: 'detail' });
    w.pushT(strip.x, y0, strip.z, Fr.yaw); w.box(-0.14, 0, -0.025, 0.14, 0.035, 0.025, ALL & ~8); w.pop();
  }

  const extra = [mg.build('marketlife'), cards.build()];
  for (const o of extra) if (o) real.addObject(o);
  void SIDES; void PLASTIC_COLORS;
}

/** packaging boxes / bottles from real label photos on the 4 shelf levels (one merged mesh per label) */
function shelfGoods(mg: Merge, Fr: Frame, x: number, z: number, y0: number, rng: RNG) {
  const labels = ['rice_5kg_hong_thong', 'rice_5kg_tra_chat', 'sugar_mitr_phol_1kg', 'msg_ajinomoto_500g', 'fish_sauce_tiparos', 'oyster_sauce_maekrua', 'light_soy_healthy_boy', 'dark_soy_healthy_boy',
    'palm_oil_morakot_1l', 'soybean_oil_angoon_1l', 'instant_noodle_mama_cup', 'carton_mama_face', 'chili_paste_mae_pranom', 'red_curry_paste_mae_ploy', 'tapioca_starch_fish_brand', 'white_pepper_hand_brand_jar',
    'energy_m150', 'energy_krating_daeng', 'seasoning_sauce_golden_mountain', 'vinegar_osor', 'water_crystal_600ml', 'whisky_sangsom', 'beer_leo_can', 'beer_chang_can'];
  const bottle = new Set(['fish_sauce_tiparos', 'oyster_sauce_maekrua', 'light_soy_healthy_boy', 'dark_soy_healthy_boy', 'palm_oil_morakot_1l', 'soybean_oil_angoon_1l', 'seasoning_sauce_golden_mountain', 'vinegar_osor', 'water_crystal_600ml', 'whisky_sangsom', 'energy_m150', 'energy_krating_daeng', 'beer_leo_can', 'beer_chang_can', 'white_pepper_hand_brand_jar']);
  const levels = [0.07, 0.52, 0.97, 1.42];
  const W = 0.54, Dd = 0.42;
  for (const ly of levels) {
    let lx = -W / 2 + 0.02;
    while (lx < W / 2 - 0.06) {
      const id = labels[rng.int(0, labels.length - 1)];
      const isB = bottle.has(id);
      const bw = isB ? 0.065 : rng.range(0.1, 0.16), bh = isB ? rng.range(0.16, 0.24) : rng.range(0.12, 0.3), bd = isB ? 0.065 : rng.range(0.06, 0.1);
      if (lx + bw > W / 2) break;
      for (let row = 0; row < 2; row++) {
        const lz = Dd / 2 - bd / 2 - 0.02 - row * (bd + 0.02);
        const p = Fr.at(x + lx + bw / 2, 0, z - lz).setY(y0 + ly + 0.025);
        const g = isB ? new THREE.CylinderGeometry(bw / 2 * 0.8, bw / 2, bh, 10).translate(0, bh / 2, 0) : new THREE.BoxGeometry(bw, bh, bd).translate(0, bh / 2, 0);
        mg.add('pack:' + id, photoMat(`img/labels/${id}.png`, { rough: 0.55 }), g, M4(p, Fr.yaw + (rng.next() - 0.5) * 0.15));
      }
      lx += bw + 0.012;
    }
  }
}

/** strips of chip bags hanging from the canopy beam (real Lay's bag photos) */
function snackStrips(mg: Merge, Fr: Frame, y0: number, rng: RNG) {
  const bags = ['gen/shops/lays_green.png', 'gen/shops/lays_orange.png', 'gen/shops/lays_red.png'];
  for (const sx of [-1.18, -0.95, 0.95, 1.18]) {
    const n = rng.int(4, 6);
    for (let k = 0; k < n; k++) {
      const g = new THREE.PlaneGeometry(0.13, 0.19, 2, 3);
      const pa = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) pa.setZ(i, (1 - Math.abs(pa.getX(i)) / 0.065) * 0.02);
      g.computeVertexNormals();
      const p = Fr.at(sx, 0, 0.36).setY(y0 + 2.2 - k * 0.2);
      const bag = bags[(((k + Math.round(sx * 10)) % 3) + 3) % 3];
      mg.add('bag:' + bag, photoMat(bag, { alpha: true, rough: 0.35, side: THREE.DoubleSide }), g, M4(p, Fr.yaw + (rng.next() - 0.5) * 0.3, 0.05));
    }
  }
}
