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

export async function loadFoliage(atlasSize = 4096): Promise<FoliageSys | null> {
  const items: { id: string; url: string; w: number; h: number }[] = [];
  const kinds: Record<string, string[]> = {};
  const add = (kind: string, id: string, url: string, w: number, h: number) => {
    items.push({ id, url, w, h });
    (kinds[kind] ??= []).push(id);
  };
  const gen = await Assets.jsonSafe<any>('gen/world/foliage.json', null);
  for (const it of gen?.items ?? []) add(it.kind, 'g:' + it.id, 'gen/world/' + it.file, it.w ?? 512, it.h ?? 512);
  const man = await Assets.jsonSafe<any>('textures/foliage/manifest.json', null);
  const KIND: Record<string, string[]> = {
    banana_leaf_whole: ['banana_leaf'], banana_leaf_torn: ['banana_torn'], coconut_frond: ['palm_frond'], coconut_palm_crown: ['palm_crown'],
    canopy_broadleaf: ['leaf_cluster', 'tree'], canopy_feathery: ['leaf_feathery', 'tree'], bamboo_leaves_spray: ['bamboo', 'plant'], bamboo_leaves_branch: ['bamboo_branch'],
    bougainvillea_branch: ['bougainvillea_hang'], bougainvillea_cluster: ['bougainvillea'], bougainvillea_red: ['bougainvillea'],
    grass_tall_tuft: ['grass'], grass_clump_low: ['grass_low', 'weeds'], grass_dry_seedheads: ['grass_dry', 'grass'], weeds_roadside: ['weeds'],
    fern_rosette: ['plant', 'fern', 'hyacinth'], periwinkle_bush: ['plant', 'flowers'], potted_syngonium_cluster: ['plant'],
    rice_clump_young: ['rice'], rice_clump_ripe: ['rice_ripe'], hanging_vines_cascade: ['vines'], hanging_vines_ivy: ['vines_wide'], morning_glory_vine: ['vine_fence'],
    moss_patch_a: ['moss'], moss_patch_b: ['moss'],
  };
  if (man) for (const [id, it] of Object.entries<any>(man)) {
    const f = it.albedo ?? it.file;
    if (!f || !/\.(png|webp)$/i.test(f) || it.type === 'atlas') continue;
    const px = it.pixelSize ?? [1024, 1024];
    const sc = 512 / Math.max(px[0], px[1]);
    for (const k of KIND[id] ?? [id]) (kinds[k] ??= []).push('f:' + id);
    if (!items.some((q) => q.id === 'f:' + id)) items.push({ id: 'f:' + id, url: 'textures/foliage/' + f, w: Math.round(px[0] * sc), h: Math.round(px[1] * sc) });
  }
  // photo wire tangles (2x2 atlas) hang near poles as cut-out cards
  items.push({ id: 'f:wires', url: 'textures/world/wire_bundle_tangle_photo.png', w: 768, h: 768 });
  kinds.wires = ['f:wires'];
  if (!items.length) return null;
  const atlas = await Atlas.build(items, atlasSize, 4);
  return new FoliageSys(atlas, kinds);
}

// ------------------------------------------------------------------ builders

/** one alpha card; base at (x,y,z), oriented by yaw, optional tilt; uv from rect; wind weights per vertex row */
export function card(w: WB, r: AtlasRect, x: number, y: number, z: number, width: number, height: number, yaw: number, opts: { tilt?: number; wind?: number; phase?: number; flutter?: number; tint?: number | [number, number, number]; ao?: number; bend?: number; uvRot?: boolean; flipU?: boolean } = {}) {
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
    w.atlas('fol', { tint: opts.tint ?? 0xffffff, ao: opts.ao ?? 1, e0: (opts.wind ?? 0.6) * t1, e1: ph, e2: opts.flutter ?? 0.4 });
    if (opts.uvRot) {
      // image u (base → tip) runs up the card; image v across it
      const u0 = r.u0 + (r.u1 - r.u0) * t0, u1 = r.u0 + (r.u1 - r.u0) * t1;
      w.quad(ax, y0, az, bx, y0, bz, cx, y1, cz, dx, y1, dz, null);
      const B = w.lastBuf!, o = (B.nv - 4) * 2;
      const va = opts.flipU ? r.v0 : r.v1, vb = opts.flipU ? r.v1 : r.v0;
      B.uv[o] = u0; B.uv[o + 1] = va; B.uv[o + 2] = u0; B.uv[o + 3] = vb; B.uv[o + 4] = u1; B.uv[o + 5] = vb; B.uv[o + 6] = u1; B.uv[o + 7] = va;
    } else {
      const v0 = r.v0 + (r.v1 - r.v0) * t0, v1 = r.v0 + (r.v1 - r.v0) * t1;
      const ua = opts.flipU ? r.u1 : r.u0, ub = opts.flipU ? r.u0 : r.u1;
      w.quad(ax, y0, az, bx, y0, bz, cx, y1, cz, dx, y1, dz, [ua, v0, ub, v1]);
    }
  }
}

/** two crossed cards */
export function cross(w: WB, r: AtlasRect, x: number, y: number, z: number, width: number, height: number, yaw: number, opts: any = {}) {
  card(w, r, x, y, z, width, height, yaw, opts);
  card(w, r, x, y, z, width, height, yaw + Math.PI / 2, opts);
}

export function bananaTree(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, scale = 1) {
  if (!F.has('banana_leaf')) return;
  const h = rng.range(2.2, 3.4) * scale;
  w.mat('bamboo', { tint: 0x9aa86a, uv: 'local', ov: 'leaves', ovAmt: 0.7, group: 'detail' });
  w.cyl(x, y, z, 0.17 * scale, 0.1 * scale, h, 7, 1, rng.range(0, 3), 0.18);
  // dry brown sheaths hanging off the pseudostem
  const torn = F.rect('banana_torn', rng);
  const n = rng.int(6, 9);
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dead = rng.chance(0.2);
    const len = rng.range(1.7, 2.4) * scale;
    if (dead && torn) {
      card(w, torn, x, y + h - 0.4, z, len * 0.6, len * 0.75, yaw, { tilt: 2.5, wind: 0.6, flutter: 0.8, tint: 0xa08a5a });
      continue;
    }
    const r = F.rect('banana_leaf', rng)!;
    card(w, r, x, y + h - 0.12, z, len * 0.5, len, yaw, { uvRot: true, flipU: rng.chance(0.5), tilt: rng.range(0.45, 1.0), bend: len * rng.range(0.25, 0.45), wind: 0.9, flutter: 0.9, tint: rng.pick([0xffffff, 0xeef4e0, 0xdde8c8]) });
  }
  if (torn && rng.chance(0.6)) card(w, torn, x, y + h - 0.2, z, 1.4 * scale, 1.4 * scale, rng.range(0, 6), { tilt: 0.6, wind: 0.9, flutter: 1 });
}

export function coconutPalm(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, scale = 1) {
  const crown = F.rect('palm_crown', rng), fr = F.rect('palm_frond', rng);
  if (!crown && !fr) return;
  const h = rng.range(7, 12) * scale;
  const lean = rng.range(0, 0.22), ly = rng.range(0, Math.PI * 2);
  const pts: number[] = [];
  const N = 6;
  for (let i = 0; i <= N; i++) { const t = i / N; const off = lean * h * t * t; pts.push(x + Math.cos(ly) * off, y + h * t, z + Math.sin(ly) * off); }
  w.mat('wood_old', { tint: 0x9a8a78, uv: 'local', ov: 'concrete_old', ovAmt: 0.5, group: 'detail' });
  w.tube(pts, 0.16 * scale, 7);
  const top = [pts[N * 3], pts[N * 3 + 1], pts[N * 3 + 2]];
  w.mat('plastic', { tint: 0x6a7a2a, uv: 'local', group: 'detail' });
  for (let i = 0; i < 5; i++) w.cyl(top[0] + Math.cos(i * 1.3) * 0.18, top[1] - 0.4, top[2] + Math.sin(i * 1.3) * 0.18, 0.1, 0.11, 0.2, 6, 3, i, 0.2);
  if (crown) {
    const S = rng.range(5.5, 7) * scale;
    for (let k = 0; k < 3; k++) card(w, crown, top[0], top[1] - S * 0.04, top[2], S, S, ly + (k / 3) * Math.PI + rng.range(-0.2, 0.2), { wind: 0.5, flutter: 0.5, tint: rng.pick([0xffffff, 0xe8f0d8]) });
  }
  if (fr) for (let i = 0; i < 4; i++) {
    const yaw = rng.range(0, Math.PI * 2);
    card(w, fr, top[0], top[1] - 2.6 * scale, top[2], 2.6 * scale, 2.6 * scale, yaw, { tilt: rng.range(0.1, 0.5), wind: 0.8, flutter: 0.6 });
  }
}

/** broad canopy tree (rain tree / banyan / bodhi) */
export function canopyTree(w: WB, F: FoliageSys, x: number, y: number, z: number, rng: RNG, o: { h: number; r: number; trunk: number; roots?: boolean; tint?: number; kind?: string }) {
  const cl = () => (o.kind ? F.rect(o.kind, rng) : null) ?? F.rect('leaf_cluster', rng) ?? F.rect('tree', rng);
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
  const n = Math.round(o.r * o.r * 1.3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * o.r;
    const yy = y + o.h * 0.62 + (1 - (d / o.r) ** 2) * o.h * 0.36 + rng.range(-0.6, 0.6);
    const s = rng.range(2.4, 3.6);
    const r = cl()!;
    const yaw = rng.range(0, Math.PI * 2);
    card(w, r, x + Math.cos(a) * d, yy - s * 0.35, z + Math.sin(a) * d, s, s, yaw, { tilt: rng.range(-0.5, 0.5), wind: 0.35, flutter: 0.5, tint: o.tint ?? rng.pick([0xffffff, 0xe0e8d0, 0xd0dcc0]), ao: d < o.r * 0.5 ? 0.75 : 1 });
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
  const ripe = rng.chance(0.3);
  const pick = () => (ripe ? F.rect('rice_ripe', rng) : null) ?? F.rect('rice', rng) ?? F.rect('grass', rng);
  if (!pick()) return;
  // planted rows of clumps (cards side by side, slight random yaw), rows 0.5 m apart
  for (let z = z0 + 0.25; z < z1 - 0.2; z += 0.5) {
    for (let x = x0 + 0.3; x < x1 - 0.3; x += rng.range(0.5, 0.62)) {
      const r = pick()!;
      const hh = rng.range(0.55, 0.8);
      card(w, r, x, y, z + rng.range(-0.05, 0.05), hh * 0.85, hh, rng.range(-0.35, 0.35), { wind: 0.7, flutter: 0.5, tint: rng.pick([0xffffff, 0xeef6d8, 0xdde8c0]) });
    }
  }
  for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.6) for (let z = z0 + 0.4; z < z1 - 0.3; z += 0.6) {
    const r = pick()!;
    const hh = rng.range(0.5, 0.75);
    card(w, r, x, y, z, hh * 0.85, hh, Math.PI / 2 + rng.range(-0.3, 0.3), { wind: 0.7, flutter: 0.5 });
  }
}

/** vines hanging from a wall top (pivot top centre), facing direction yaw */
export function vines(w: WB, F: FoliageSys, x: number, yTop: number, z: number, yaw: number, rng: RNG, wide = false) {
  const r = F.rect(wide ? 'vines_wide' : 'vines', rng) ?? F.rect('vines', rng);
  if (!r) return;
  const hh = wide ? rng.range(1.4, 2.4) : rng.range(1.0, 2.2);
  const ww = hh * Math.min(1.2, r.aspect);
  card(w, r, x, yTop - hh, z, ww, hh, yaw, { wind: 0.25, flutter: 0.5 });
}

void THREE;
