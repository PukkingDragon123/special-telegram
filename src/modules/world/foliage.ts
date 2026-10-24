import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { RNG } from '../../core/rng';
import { Atlas, AtlasRect } from './atlas';
import { WB } from './geo';

/**
 * FOLIAGE — alpha cut-outs from real plant photos (public/assets/gen/world/foliage.json, plus the
 * research agent's textures/foliage when present) on low-poly cards with wind sway (see mats.ts).
 * Builders: banana tree, coconut palm, rain tree / banyan / bodhi canopies, bougainvillea,
 * weeds, grass tufts, rice rows, potted plants, water hyacinth.
 */

export class FoliageSys {
  constructor(public atlas: Atlas, public kinds: Record<string, string[]>) {}
  rect(kind: string, rng: RNG): AtlasRect | null {
    const ids = this.kinds[kind] ?? [];
    if (!ids.length) return null;
    return this.atlas.get(ids[rng.int(0, ids.length - 1)]) ?? null;
  }
  has(kind: string) { return (this.kinds[kind] ?? []).length > 0; }
}

export async function loadFoliage(): Promise<FoliageSys | null> {
  const items: { id: string; url: string; w: number; h: number }[] = [];
  const kinds: Record<string, string[]> = {};
  const add = (kind: string, id: string, url: string, w: number, h: number) => {
    items.push({ id, url, w, h });
    (kinds[kind] ??= []).push(id);
  };
  const gen = await Assets.jsonSafe<any>('gen/world/foliage.json', null);
  for (const it of gen?.items ?? []) add(it.kind, 'g:' + it.id, 'gen/world/' + it.file, it.w ?? 512, it.h ?? 512);
  const man = await Assets.jsonSafe<any>('textures/foliage/manifest.json', null);
  if (man) {
    const arr = Array.isArray(man) ? man : man.items ?? Object.entries(man).map(([k, v]: any) => ({ id: k, ...v }));
    for (const it of arr) {
      const f = it.file ?? it.albedo ?? it.src;
      if (!f || !/\.(png|webp)$/i.test(f)) continue;
      const kind = it.kind ?? it.type ?? it.tags?.[0] ?? it.id;
      add(String(kind), 'f:' + (it.id ?? f), f.startsWith('textures') ? f : 'textures/foliage/' + f, it.w ?? 512, it.h ?? 512);
    }
  }
  if (!items.length) return null;
  const atlas = await Atlas.build(items, 4096, 4);
  return new FoliageSys(atlas, kinds);
}

// ------------------------------------------------------------------ builders

/** one alpha card; base at (x,y,z), oriented by yaw, optional tilt; uv from rect; wind weights per vertex row */
export function card(w: WB, r: AtlasRect, x: number, y: number, z: number, width: number, height: number, yaw: number, opts: { tilt?: number; wind?: number; phase?: number; flutter?: number; tint?: number | [number, number, number]; ao?: number; bend?: number } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const tilt = opts.tilt ?? 0;
  const hw = width / 2;
  const segs = opts.bend ? 3 : 1;
  const ph = opts.phase ?? Math.random();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const bend0 = (opts.bend ?? 0) * t0 * t0, bend1 = (opts.bend ?? 0) * t1 * t1;
    const y0 = y + height * t0 * Math.cos(tilt) - bend0, y1 = y + height * t1 * Math.cos(tilt) - bend1;
    const f0 = height * t0 * Math.sin(tilt) + bend0 * 0.4, f1 = height * t1 * Math.sin(tilt) + bend1 * 0.4;
    // forward offset along the card normal direction (−sin, −cos rotated) so tilted cards lean outward
    const fx = -s, fz = -c;
    const ax = x - c * hw + fx * f0, az = z + s * hw + fz * f0;
    const bx = x + c * hw + fx * f0, bz = z - s * hw + fz * f0;
    const cx = x + c * hw + fx * f1, cz = z - s * hw + fz * f1;
    const dx = x - c * hw + fx * f1, dz = z + s * hw + fz * f1;
    const v0 = r.v0 + (r.v1 - r.v0) * t0, v1 = r.v0 + (r.v1 - r.v0) * t1;
    w.atlas('fol', { tint: opts.tint ?? 0xffffff, ao: opts.ao ?? 1, e0: (opts.wind ?? 0.6) * t1, e1: ph, e2: opts.flutter ?? 0.4 });
    w.quad(ax, y0, az, bx, y0, bz, cx, y1, cz, dx, y1, dz, [r.u0, v0, r.u1, v1]);
  }
}

/** two crossed cards */
export function cross(w: WB, r: AtlasRect, x: number, y: number, z: number, width: number, height: number, yaw: number, opts: any = {}) {
  card(w, r, x, y, z, width, height, yaw, opts);
  card(w, r, x, y, z, width, height, yaw + Math.PI / 2, opts);
}

export function bananaTree(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, scale = 1) {
  const leaf = () => F.rect('banana_leaf', rng) ?? F.rect('leaf', rng);
  if (!leaf()) return;
  const h = rng.range(2.4, 3.6) * scale;
  w.mat('bamboo', { tint: 0x8a9a5a, uv: 'local', ov: 'leaves', ovAmt: 0.6, group: 'detail' });
  w.cyl(x, y, z, 0.16 * scale, 0.11 * scale, h, 7, 1, rng.range(0, 3), 0.15);
  const n = rng.int(6, 10);
  for (let i = 0; i < n; i++) {
    const r = leaf()!;
    const yaw = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dead = rng.chance(0.22);
    const len = rng.range(1.6, 2.4) * scale;
    card(w, r, x, y + h - 0.15, z, len * 0.32, len, yaw, {
      tilt: dead ? 2.4 : rng.range(0.55, 1.05), bend: dead ? 0 : len * rng.range(0.25, 0.5), wind: 0.9, flutter: 0.9,
      tint: dead ? 0x9a7a4a : rng.pick([0xffffff, 0xe8f0d8, 0xd8e8c0]),
    });
  }
}

export function coconutPalm(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, scale = 1) {
  const fr = () => F.rect('palm_frond', rng) ?? F.rect('banana_leaf', rng);
  if (!fr()) return;
  const h = rng.range(7, 12) * scale;
  const lean = rng.range(0, 0.25), ly = rng.range(0, Math.PI * 2);
  const pts: number[] = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const off = lean * h * t * t;
    pts.push(x + Math.cos(ly) * off, y + h * t, z + Math.sin(ly) * off);
  }
  w.mat('wood_old', { tint: 0x9a8a78, uv: 'local', ov: 'concrete_old', ovAmt: 0.5, group: 'detail' });
  // segmented trunk with rings (tube with slight taper is emulated by two radii)
  w.tube(pts, 0.17 * scale, 7);
  const top = [pts[N * 3], pts[N * 3 + 1], pts[N * 3 + 2]];
  w.mat('plastic', { tint: 0x6a7a2a, uv: 'local', group: 'detail' });
  for (let i = 0; i < 5; i++) w.cyl(top[0] + Math.cos(i * 1.3) * 0.2, top[1] - 0.45, top[2] + Math.sin(i * 1.3) * 0.2, 0.1, 0.11, 0.2, 6, 3, i, 0.2);
  const n = rng.int(11, 16);
  for (let i = 0; i < n; i++) {
    const r = fr()!;
    const yaw = (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const len = rng.range(2.8, 4.0) * scale;
    const dead = i < 2 && rng.chance(0.5);
    card(w, r, top[0], top[1] - 0.2, top[2], len * 0.4, len, yaw, {
      tilt: dead ? 2.6 : rng.range(0.9, 1.5), bend: dead ? 0 : len * rng.range(0.35, 0.6), wind: 1.0, flutter: 0.7,
      tint: dead ? 0x8a6a3a : rng.pick([0xffffff, 0xe0e8c8]),
    });
  }
}

/** broad canopy tree (rain tree / banyan / bodhi) */
export function canopyTree(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, o: { h: number; r: number; trunk: number; roots?: boolean; tint?: number }) {
  const cl = () => F.rect('leaf_cluster', rng) ?? F.rect('tree', rng);
  w.mat('wood_old', { tint: 0x6a5a4a, uv: 'local', ov: 'concrete_mossy', ovAmt: 0.6, group: 'base' });
  // trunk + 4-6 main branches
  w.cyl(x, y, z, o.trunk * 1.25, o.trunk, o.h * 0.38, 9, 0, rng.range(0, 3), 0.25);
  const branches = rng.int(4, 6);
  const tips: number[][] = [];
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const rr = o.r * rng.range(0.45, 0.8);
    const tip = [x + Math.cos(a) * rr, y + o.h * rng.range(0.62, 0.8), z + Math.sin(a) * rr];
    w.tube([x, y + o.h * 0.34, z, x + Math.cos(a) * rr * 0.4, y + o.h * 0.52, z + Math.sin(a) * rr * 0.4, tip[0], tip[1], tip[2]], o.trunk * 0.45, 6);
    tips.push(tip);
  }
  if (o.roots) {
    w.mat('wood_old', { tint: 0x5a4a3a, uv: 'local', group: 'detail' });
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2), rr = rng.range(0.5, o.r * 0.7);
      const top = y + o.h * rng.range(0.4, 0.62);
      w.tube([x + Math.cos(a) * rr, top, z + Math.sin(a) * rr, x + Math.cos(a) * rr * 1.02, y + rng.range(0, 1.2), z + Math.sin(a) * rr * 1.02], rng.range(0.01, 0.035), 3);
    }
  }
  if (!cl()) return;
  // canopy: leaf cluster cards spread over an umbrella dome
  const n = Math.round(o.r * o.r * 2.2);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * o.r;
    const yy = y + o.h * 0.62 + (1 - (d / o.r) ** 2) * o.h * 0.36 + rng.range(-0.6, 0.6);
    const s = rng.range(1.6, 2.8);
    const r = cl()!;
    const yaw = rng.range(0, Math.PI * 2);
    card(w, r, x + Math.cos(a) * d, yy - s * 0.5, z + Math.sin(a) * d, s, s, yaw, { tilt: rng.range(-0.5, 0.5), wind: 0.35, flutter: 0.5, tint: o.tint ?? rng.pick([0xffffff, 0xe0e8d0, 0xd0dcc0]), ao: d < o.r * 0.5 ? 0.75 : 1 });
  }
}

export function weeds(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, s = 1) {
  const r = F.rect('weeds', rng) ?? F.rect('grass', rng);
  if (!r) return;
  const hh = rng.range(0.25, 0.6) * s;
  cross(w, r, x, y, z, hh * r.aspect, hh, rng.range(0, 3), { wind: 0.3, flutter: 0.6, tint: rng.pick([0xffffff, 0xd8d0a0, 0xc8d8a0]) });
}

export function grassPatch(w: WB, F: FoliageSys, x0: number, z0: number, x1: number, z1: number, y: number, density: number, rng: RNG, kind = 'grass') {
  const area = (x1 - x0) * (z1 - z0);
  const n = Math.round(area * density);
  for (let i = 0; i < n; i++) {
    const r = F.rect(kind, rng) ?? F.rect('weeds', rng);
    if (!r) return;
    const hh = rng.range(0.35, 0.9);
    const x = rng.range(x0, x1), z = rng.range(z0, z1);
    cross(w, r, x, y, z, hh * Math.min(2, r.aspect), hh, rng.range(0, 3), { wind: 0.5, flutter: 0.6, tint: rng.pick([0xffffff, 0xe0d8a8, 0xd0e0b0]) });
  }
}

export function bougainvillea(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, s = 1) {
  const r = F.rect('bougainvillea', rng) ?? F.rect('leaf_cluster', rng);
  if (!r) return;
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, 0.6) * s;
    const ss = rng.range(0.9, 1.5) * s;
    card(w, r, x + Math.cos(a) * d, y + rng.range(0, 1.6) * s, z + Math.sin(a) * d, ss, ss, rng.range(0, 6.28), { tilt: rng.range(-0.4, 0.4), wind: 0.4, flutter: 0.7 });
  }
}

export function pottedPlant(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG) {
  const r = F.rect('plant', rng) ?? F.rect('leaf_cluster', rng) ?? F.rect('banana_leaf', rng);
  w.mat(rng.chance(0.5) ? 'plastic' : 'tiles_terracotta', { tint: rng.pick([0x9a4a2a, 0x2a2a2a, 0x4a6a3a, 0x8a3a2a, 0xb0a090]), uv: 'local', group: 'detail' });
  const pr = rng.range(0.15, 0.3);
  w.cyl(x, y, z, pr * 0.8, pr, pr * 1.6, 8, 1, 0, 0.05);
  if (!r) return;
  const hh = rng.range(0.5, 1.2);
  for (let i = 0; i < 3; i++) card(w, r, x, y + pr * 1.4, z, hh * Math.min(1.4, r.aspect), hh, (i / 3) * Math.PI + rng.range(0, 1), { tilt: rng.range(-0.2, 0.2), wind: 0.4, flutter: 0.6 });
}

export function riceRows(w: WB, F: FoliageSys, x0: number, z0: number, x1: number, z1: number, y: number, rng: RNG) {
  const r = F.rect('rice', rng) ?? F.rect('grass', rng);
  if (!r) return;
  const sp = 0.45;
  const uv = [r.u0, r.v0, r.u1, r.v1];
  // rows along x (cards sized to the photo aspect, back to back) + sparse cross rows along z
  for (let z = z0 + 0.3; z < z1 - 0.2; z += sp) {
    const hh = rng.range(0.5, 0.7);
    const seg = hh * Math.max(0.6, r.aspect);
    for (let x = x0 + 0.2; x + seg < x1 - 0.1; x += seg * rng.range(0.92, 1.0)) {
      w.atlas('fol', { tint: rng.pick([0xffffff, 0xe8f0c8, 0xd8e8b8]), e0: 0.6, e1: rng.next(), e2: 0.5, group: 'detail' });
      const zz = z + rng.range(-0.07, 0.07);
      w.quad(x, y, zz, x + seg, y, zz, x + seg, y + hh, zz, x, y + hh, zz, uv);
    }
  }
  for (let x = x0 + 0.5; x < x1 - 0.3; x += sp * 3.2) {
    const hh = rng.range(0.45, 0.65);
    const seg = hh * Math.max(0.6, r.aspect);
    for (let z = z0 + 0.2; z + seg < z1 - 0.1; z += seg) {
      w.atlas('fol', { tint: rng.pick([0xffffff, 0xe8f0c8]), e0: 0.6, e1: rng.next(), e2: 0.5, group: 'detail' });
      w.quad(x, y, z + seg, x, y, z, x, y + hh, z, x, y + hh, z + seg, uv);
    }
  }
}

void THREE;
