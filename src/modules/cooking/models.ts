import * as THREE from 'three';
import { T, foodMat, cachedMat, labelInfo } from './assets';
import { M, mesh, gc } from './mats';
import { lathe, mound, scatter, merge, rbox, tube, dent, planarUV, card, leaf } from './geo';
import { mulberry } from './util';

/**
 * Visual builders for ingredient packs & produce — real photos everywhere: alpha cut-out photo
 * "cards" for produce (basil bunch, chilies, beans, garlic, kale), photo tiles projected on faceted
 * mounds (decimated-photoscan look), real flattened label photos on packaging.
 * Origin = bottom centre; front = +Z. Children named 'heap' are scaled by amount in refresh().
 */

const G = () => new THREE.Group();

/** Alpha-cut photo card material (double sided, alpha tested). */
export function cardMat(key: string, tex: THREE.Texture, rough = 0.55, color: THREE.ColorRepresentation = 0xffffff) {
  return cachedMat('card:' + key, () => new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: rough, color }));
}

/** Food photo tile material (+ normal map when shipped). */
export function tileMat(key: string, tex: THREE.Texture, normal?: THREE.Texture, o: { rough?: number; color?: THREE.ColorRepresentation; flat?: boolean } = {}) {
  return cachedMat('tile:' + key, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.rough ?? 0.5, color: o.color ?? 0xffffff, flatShading: o.flat ?? true });
    if (normal) { m.normalMap = normal; m.normalScale.set(0.8, 0.8); }
    return m;
  });
}

// ------------------------------------------------------------------ trays (meat)

function foamTray(w: number, d: number, h: number) {
  return gc(`tray${w}_${d}_${h}`, () => {
    const t = 0.006;
    return merge([
      rbox(w, t, d, 0.004, 0.3).translate(0, t / 2, 0),
      rbox(w, h, t, 0.003, 0.3).translate(0, h / 2, -d / 2 + t / 2),
      rbox(w, h, t, 0.003, 0.3).translate(0, h / 2, d / 2 - t / 2),
      rbox(t, h, d, 0.003, 0.3).translate(-w / 2 + t / 2, h / 2, 0),
      rbox(t, h, d, 0.003, 0.3).translate(w / 2 - t / 2, h / 2, 0),
      rbox(w + 0.008, 0.004, 0.008, 0.002, 0.3).translate(0, h, -d / 2),
      rbox(w + 0.008, 0.004, 0.008, 0.002, 0.3).translate(0, h, d / 2),
    ]);
  });
}

export function buildMeatTray(kind: string) {
  const g = G();
  const W = 0.2, D = 0.14, H = 0.028;
  g.add(mesh(foamTray(W, D, H), M.foam()));
  const heap = G();
  heap.name = 'heap';
  if (kind === 'pork_sliced') {
    const sl = gc('slices', () => scatter(planarUV(rbox(0.07, 0.007, 0.045, 0.003, 1), 1 / 0.08), 7, (i, m, r) => {
      m.makeRotationFromEuler(new THREE.Euler(0.15 * (r() - 0.5), r() * 0.6 - 0.3, 0.25 * (r() - 0.5)));
      m.setPosition((i % 3 - 1) * 0.055 + (r() - 0.5) * 0.01, 0.006 + Math.floor(i / 3) * 0.006, (Math.floor(i / 3) % 2 - 0.5) * 0.04);
    }, 3));
    heap.add(mesh(sl, tileMat('porkSl', T.porkRaw(), T.porkRawN(), { rough: 0.45, color: 0xffd0c8, flat: false })));
  } else if (kind === 'shrimp') {
    const shr = gc('shrimps', () => scatter(shrimpGeo(), 9, (i, m, r) => {
      m.makeRotationFromEuler(new THREE.Euler(0, r() * 6.28, 0));
      m.setPosition((i % 3 - 1) * 0.055, 0.008, (Math.floor(i / 3) - 1) * 0.038);
    }, 4));
    heap.add(mesh(shr, tileMat('shrimpRaw', T.shrimp(), undefined, { rough: 0.3, color: 0xc8b0a8, flat: false })));
  } else {
    const tint = kind === 'chicken_minced' ? 0xffe2d4 : 0xffffff;
    heap.add(mesh(gc('meatMound', () => planarUV(mound(0.078, 0.032, { seed: 11, detail: 2, rough: 0.28, squash: [1.22, 0.85] }), 1 / 0.12)), tileMat('meatRaw' + tint, T.porkRaw(), T.porkRawN(), { rough: 0.5, color: tint }), [0, 0.006, 0]));
  }
  g.add(heap);
  // cling film + real scale/price sticker photo
  g.add(mesh(gc('film' + W, () => rbox(W + 0.004, 0.003, D + 0.004, 0.0015, 1).translate(0, H + 0.012, 0)), M.film()));
  g.add(mesh(gc('sticker', () => new THREE.PlaneGeometry(0.06, 0.06)), M.label('pork_minced'), [0.05, H + 0.0145, 0.028], [-Math.PI / 2, 0, 0.12]));
  return g;
}

function shrimpGeo() {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 1.15; pts.push([Math.cos(a) * 0.022, 0.006 + Math.sin(i * 0.9) * 0.001, Math.sin(a) * 0.022]); }
  return planarUV(tube(pts, 0.0075, 10, 6), 1 / 0.05);
}

// ------------------------------------------------------------------ produce as real photo cards

/** Layered photo cards (2–3 slightly rotated/raised copies) → looks like a real bunch from any angle. */
function cardStack(key: string, tex: THREE.Texture, w: number, d: number, layers = 3, dome = 0.012, seed = 1) {
  const geo = gc('cards' + key, () => scatter(card(w, d, dome, 4), layers, (i, m, r) => {
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.12, (r() - 0.5) * 0.5 + i * 0.35, (r() - 0.5) * 0.12));
    m.setPosition((r() - 0.5) * w * 0.08, 0.004 + i * 0.008, (r() - 0.5) * d * 0.08);
  }, seed));
  return mesh(geo, cardMat(key, tex));
}

export function buildBasil() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(cardStack('basilBunch', T.basilBunch(), 0.24, 0.24, 3, 0.02, 7));
  heap.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.012, 0.06], [0, 0, 0], [1.6, 1.6, 1.6]));
  g.add(heap);
  return g;
}

export function buildChiliBag() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(cardStack('chiliRed', T.chiliCard(), 0.11, 0.11, 3, 0.012, 3));
  heap.add(mesh(gc('chiliG', () => card(0.07, 0.07, 0.008).translate(0.025, 0.026, 0.02)), cardMat('chiliGreen', T.chiliGreenCard())));
  g.add(heap);
  g.add(mesh(gc('smallBag', () => lathe([[0.0001, 0], [0.055, 0.003], [0.062, 0.02], [0.05, 0.04], [0.014, 0.06], [0.007, 0.066], [0.014, 0.08]], 12, { wobble: 0.12, freq: 30, seed: 3 })), M.bagClear(), [0, 0, 0], [0, 0, 0], [1, 1, 0.85]));
  g.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.062, 0], [Math.PI / 2, 0, 0]));
  return g;
}

/** Peeled garlic in a clear market bag. */
export function buildGarlic() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(mesh(gc('garlicMound', () => planarUV(mound(0.045, 0.022, { seed: 5, detail: 1, rough: 0.3 }), 1 / 0.09)), cachedMat('garlicBase', () => new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, flatShading: true }))));
  heap.add(cardStack('garlicCloves', T.garlicCard(), 0.1, 0.1, 2, 0.02, 5));
  g.add(heap);
  g.add(mesh(gc('smallBag', () => lathe([[0.0001, 0], [0.055, 0.003], [0.062, 0.02], [0.05, 0.04], [0.014, 0.06], [0.007, 0.066], [0.014, 0.08]], 12, { wobble: 0.12, freq: 30, seed: 3 })), M.bagClear(), [0, 0, 0], [0, 0, 0], [1, 1, 0.85]));
  g.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.062, 0], [Math.PI / 2, 0, 0]));
  return g;
}

export function buildLongBeans() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(cardStack('beans', T.beansCard(), 0.36, 0.36, 2, 0.015, 9));
  g.add(heap);
  return g;
}

export function buildKale() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const geo = gc('kaleCards', () => scatter(card(0.2, 0.2, 0.025, 4), 4, (i, m, r) => {
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.2, i * 0.5 - 0.7, (r() - 0.5) * 0.2));
    m.setPosition((i - 1.5) * 0.02, 0.006 + i * 0.01, (r() - 0.5) * 0.02);
  }, 6));
  heap.add(mesh(geo, cardMat('kale', T.kaleCard())));
  g.add(heap);
  return g;
}

export function buildBundle(kind: 'morning_glory' | 'spring_onion' | 'lemongrass') {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const r0 = mulberry(kind.length * 31);
  const n = kind === 'lemongrass' ? 6 : 16;
  const rad = kind === 'lemongrass' ? 0.008 : kind === 'spring_onion' ? 0.0035 : 0.004;
  const len = kind === 'lemongrass' ? 0.28 : kind === 'spring_onion' ? 0.3 : 0.36;
  const geo = gc('bundle' + kind, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g1 = new THREE.CylinderGeometry(rad * 0.75, rad, len, 5, 3);
      g1.rotateZ(Math.PI / 2);
      g1.translate((r0() - 0.5) * 0.035, 0.006 + r0() * 0.02, (r0() - 0.5) * 0.03);
      parts.push(dent(g1, rad * 0.25, 30, i));
    }
    return merge(parts);
  });
  const col = kind === 'lemongrass' ? 0xd8dca0 : kind === 'spring_onion' ? 0x6aa040 : 0x7fae4a;
  heap.add(mesh(geo, cachedMat('stalk' + kind, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }))));
  if (kind === 'morning_glory') {
    // real stir-fried morning glory photo is the closest shipped texture → tint it fresh green
    const lv = gc('mgLeaves', () => scatter(leaf(0.06, 0.028, 0.2), 16, (i, m, r) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.8, (r() - 0.5) * 0.8 + Math.PI, (r() - 0.5) * 0.6));
      m.compose(new THREE.Vector3(-0.15 + r() * 0.05, 0.02 + r() * 0.02, (r() - 0.5) * 0.06), q, new THREE.Vector3(1, 1, 1));
    }, 5));
    heap.add(mesh(lv, cachedMat('mgLeaf', () => new THREE.MeshStandardMaterial({ map: T.greens(), color: 0xb8ffa0, roughness: 0.5, side: THREE.DoubleSide }))));
  }
  heap.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0.05, 0.016, 0], [0, Math.PI / 2, 0], [2.4, 2.4, 2.4]));
  g.add(heap);
  return g;
}

// ------------------------------------------------------------------ round produce (onion, lime, tomato, galangal, egg)

function bulbGeo(kind: 'onion' | 'lime' | 'tomato' | 'egg' | 'galangal') {
  return gc('bulb' + kind, () => {
    switch (kind) {
      case 'onion': return lathe([[0.0001, 0], [0.02, 0.004], [0.036, 0.022], [0.037, 0.04], [0.026, 0.06], [0.008, 0.072], [0.003, 0.08]], 12, { wobble: 0.05, freq: 12, seed: 3 });
      case 'lime': return lathe([[0.0001, 0], [0.016, 0.004], [0.024, 0.02], [0.024, 0.032], [0.016, 0.048], [0.003, 0.054]], 10, { wobble: 0.04, freq: 20, seed: 4 });
      case 'tomato': return lathe([[0.0001, 0], [0.02, 0.003], [0.03, 0.018], [0.029, 0.034], [0.018, 0.046], [0.0001, 0.048]], 12, { wobble: 0.07, freq: 14, seed: 5 });
      case 'egg': return lathe([[0.0001, 0], [0.012, 0.002], [0.02, 0.012], [0.022, 0.026], [0.019, 0.042], [0.011, 0.054], [0.0001, 0.058]], 12, { wobble: 0.01, freq: 9, seed: 6 });
      default: return dent(new THREE.CapsuleGeometry(0.012, 0.05, 3, 6).rotateZ(Math.PI / 2).translate(0, 0.012, 0), 0.004, 40, 7);
    }
  });
}

const PRODUCE_MAT: Record<string, () => THREE.Material> = {
  onion: () => cachedMat('onionSkin', () => new THREE.MeshStandardMaterial({ color: 0xc9894a, roughness: 0.5 })),
  lime: () => cachedMat('limeSkin', () => new THREE.MeshStandardMaterial({ color: 0x5d9a2a, roughness: 0.45 })),
  tomato: () => cachedMat('tomatoSkin', () => new THREE.MeshStandardMaterial({ color: 0xc8261a, roughness: 0.3 })),
  egg: () => M.eggShell(),
  galangal: () => cachedMat('galangal', () => new THREE.MeshStandardMaterial({ color: 0xe8cbb0, roughness: 0.7 })),
};

export function buildPile(kind: 'onion' | 'lime' | 'tomato' | 'galangal', max = 5) {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const r = mulberry(kind.length * 17 + 3);
  const geo = bulbGeo(kind);
  const mat = PRODUCE_MAT[kind]();
  const spots: [number, number, number][] = [[0, 0, 0], [0.05, 0, 0.012], [-0.045, 0, 0.018], [0.01, 0, -0.045], [0.022, 0.038, -0.006], [-0.03, 0, -0.04]];
  for (let i = 0; i < max; i++) {
    const s = spots[i % spots.length];
    const m = mesh(geo, mat, [s[0], s[1], s[2]], [(r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4], 0.92 + r() * 0.16);
    m.name = 'p' + i;
    heap.add(m);
  }
  g.add(heap);
  return g;
}

export function buildEgg() {
  const g = G();
  g.add(mesh(bulbGeo('egg'), M.eggShell()));
  return g;
}

/** Molded pulp tray (30 cups) with the eggs left (data.n) + real egg-pack label. */
export function buildEggTray() {
  const g = G();
  const S = 0.3;
  const tray = gc('eggTray', () => {
    const parts: THREE.BufferGeometry[] = [rbox(S, 0.006, S, 0.003, 0.3).translate(0, 0.003, 0)];
    const cup = lathe([[0.0001, 0.004], [0.016, 0.006], [0.022, 0.02], [0.025, 0.026]], 8, { wobble: 0.05, seed: 9 });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) parts.push(cup.clone().translate((i - 2.5) * 0.05, 0, (j - 2) * 0.058));
    return merge(parts);
  });
  g.add(mesh(tray, M.pulp()));
  const eggs = G();
  eggs.name = 'eggs';
  const r = mulberry(5);
  for (let k = 0; k < 30; k++) {
    const i = k % 6, j = Math.floor(k / 6);
    const e = mesh(bulbGeo('egg'), M.eggShell(), [(i - 2.5) * 0.05, 0.012, (j - 2) * 0.058], [(r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3], 0.95);
    e.name = 'e' + k;
    eggs.add(e);
  }
  g.add(eggs);
  // real CP-style egg sleeve label stuck on the front edge
  g.add(mesh(gc('eggLabel', () => new THREE.PlaneGeometry(0.075, 0.1)), M.label('egg_tray'), [0.105, 0.03, 0.152], [-0.2, 0, 0]));
  return g;
}

// ------------------------------------------------------------------ bottles & jars (real label photos, front patch)

export interface BottleSpec {
  h: number; r: number; neck?: number; shoulder?: number;
  /** label centre (fraction of height) — height comes from the real label's dims when known */
  labelY: number; labelH?: number;
  liquid: number; glass?: number; glassOpacity?: number; cap: number; capH?: number;
  shape?: 'bottle' | 'jar' | 'shaker' | 'pet' | 'jug';
}

function bottleProfile(s: BottleSpec): [number, number][] {
  const h = s.h, r = s.r, n = s.neck ?? r * 0.35, sh = s.shoulder ?? 0.62;
  switch (s.shape) {
    case 'jar': return [[0.0001, 0], [r * 0.92, 0.002], [r, h * 0.06], [r, h * 0.86], [r * 0.9, h * 0.93], [r * 0.86, h]];
    case 'shaker': return [[0.0001, 0], [r * 0.9, 0.002], [r, h * 0.05], [r * 0.96, h * 0.5], [r, h * 0.85], [r * 0.85, h * 0.92], [r * 0.82, h]];
    case 'jug': return [[0.0001, 0], [r * 0.9, 0.003], [r, h * 0.06], [r * 0.97, h * 0.55], [r * 0.85, h * 0.75], [n * 1.2, h * 0.92], [n, h]];
    case 'pet': return [[0.0001, 0], [r * 0.85, 0.003], [r, h * 0.05], [r * 0.93, h * 0.2], [r, h * 0.32], [r, h * sh], [r * 0.7, h * (sh + 0.12)], [n * 1.1, h * 0.9], [n, h]];
    default: return [[0.0001, 0], [r * 0.92, 0.002], [r, h * 0.04], [r, h * sh], [r * 0.82, h * (sh + 0.08)], [n * 1.15, h * (sh + 0.2)], [n, h * 0.9], [n * 1.08, h * 0.93], [n, h]];
  }
}

/** Bottle/jar: liquid core (fill via 'liquid' scale), shell, real front label patch, cap. */
export function buildBottle(kind: string, s: BottleSpec) {
  const g = G();
  const prof = bottleProfile(s);
  const shell = gc('btl' + kind, () => lathe(prof, 18, { wobble: 0.006, seed: kind.length }));
  const coreProf = prof.map(([r, y]) => [Math.max(0.0001, r * 0.93), y * 0.97 + 0.002] as [number, number]);
  const core = gc('btlc' + kind, () => lathe(coreProf, 14));
  const liq = mesh(core, M.liquid(s.liquid, s.shape === 'jar' ? 0.6 : 0.1));
  liq.name = 'liquid';
  g.add(liq);
  g.add(mesh(shell, M.glassBottle(s.glass ?? 0xeeeeee, s.glassOpacity ?? 0.3)));
  // front label patch: real label photo, width from its aspect, wrapped on the body
  const info = labelInfo(kind);
  const realH = info?.meta?.real_dims_cm?.label_h ? info.meta.real_dims_cm.label_h / 100 : s.labelH ?? s.h * 0.35;
  const lh = Math.min(realH * (s.h / ((info?.meta?.real_dims_cm?.bottle_h ?? info?.meta?.real_dims_cm?.jar_h ?? s.h * 100) / 100)), s.h * 0.6);
  const y0 = s.h * s.labelY - lh / 2, y1 = s.h * s.labelY + lh / 2;
  const lr = prof.reduce((a, [r, y]) => (y >= y0 - 0.005 && y <= y1 + 0.005 ? Math.max(a, r) : a), 0) * 1.015 || s.r * 1.015;
  const aspect = info?.aspect ?? 1.6;
  const arc = Math.min(Math.PI * 2 * 0.98, (lh * aspect) / lr);
  const band = gc('lbl' + kind + arc.toFixed(2), () => {
    const lg = new THREE.LatheGeometry([new THREE.Vector2(lr, y0), new THREE.Vector2(lr, y1)], 20, -arc / 2, arc);
    return lg;
  });
  g.add(mesh(band, M.label(kind)));
  // cap with ridges
  const n = s.shape === 'jar' || s.shape === 'shaker' ? s.r * 0.88 : (s.neck ?? s.r * 0.35) * 1.15;
  const ch = s.capH ?? 0.02;
  const cap = gc('cap' + kind, () => lathe([[0.0001, s.h + ch], [n * 0.96, s.h + ch], [n, s.h + ch * 0.85], [n, s.h - 0.002], [n * 0.9, s.h - 0.002]], 16, { wobble: 0.04, freq: 120, seed: 4 }));
  g.add(mesh(cap, M.plastic(s.cap)));
  return g;
}

/** Bag/packet (sugar, MSG, starch, noodles, rice sack): pillow body + real packaging photo on the front. */
export function buildPacket(kind: string, w: number, h: number, d: number, o: { body?: THREE.Material; clear?: boolean; filling?: THREE.Material; lying?: boolean } = {}) {
  const g = G();
  const body = gc('pk' + kind, () => {
    const b = rbox(w, h, d, Math.min(d * 0.45, 0.03), 0.3, 3);
    const pos = b.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = (1 - (x / (w / 2)) ** 2) * (1 - (y / (h / 2)) ** 2);
      pos.setZ(i, z * (0.55 + 0.6 * Math.max(0, k)));
    }
    b.computeVertexNormals();
    dent(b, 0.002, 30, kind.length);
    b.translate(0, h / 2, 0);
    return b;
  });
  if (o.filling) g.add(mesh(body, o.filling, [0, 0, 0], [0, 0, 0], [0.96, 0.97, 0.9]));
  g.add(mesh(body, o.body ?? (o.clear ? M.bagClear(0xffffff, 0.4) : M.plasticRough(0xf2f2f2))));
  const front = gc('pkf' + kind, () => {
    const p = new THREE.PlaneGeometry(w * 0.94, h * 0.94, 6, 6);
    const pos = p.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, d * 0.5 * 0.92 * Math.max(0, (1 - (x / (w / 2)) ** 2) * (1 - (y / (h / 2)) ** 2)) ** 0.5 + 0.002);
    }
    p.computeVertexNormals();
    p.translate(0, h / 2, 0);
    return p;
  });
  g.add(mesh(front, M.label(kind)));
  if (o.lying) { g.rotation.x = -Math.PI / 2; g.position.set(0, d * 0.45, h / 2); const w2 = G(); w2.add(g); return w2; }
  return g;
}

// ------------------------------------------------------------------ paste in a bag

export function buildPasteBag(color: number, tex: THREE.Texture) {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(mesh(gc('pasteMound', () => planarUV(mound(0.05, 0.04, { seed: 4, detail: 2, rough: 0.2 }), 1 / 0.1)), tileMat('paste' + color, tex, undefined, { rough: 0.45, color }), [0, 0.002, 0]));
  g.add(heap);
  g.add(mesh(gc('pasteBag', () => lathe([[0.0001, 0], [0.055, 0.004], [0.058, 0.025], [0.042, 0.05], [0.012, 0.07], [0.006, 0.08], [0.014, 0.095]], 12, { wobble: 0.12, freq: 25, seed: 7 })), M.bagClear()));
  g.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.076, 0], [Math.PI / 2, 0, 0]));
  return g;
}

// ------------------------------------------------------------------ misc produce

export function buildCucumbers() {
  const g = G();
  const geo = gc('cucumber', () => dent(new THREE.CapsuleGeometry(0.018, 0.14, 4, 8).rotateZ(Math.PI / 2), 0.0025, 45, 8).translate(0, 0.018, 0));
  const mat = cachedMat('cucSkin', () => new THREE.MeshStandardMaterial({ color: 0x4e7f2a, roughness: 0.45 }));
  const heap = G(); heap.name = 'heap';
  heap.add(mesh(geo, mat, [0, 0, -0.02], [0, 0.2, 0]), mesh(geo, mat, [0.01, 0, 0.022], [0, -0.15, 0]));
  g.add(heap);
  return g;
}

export function buildMushrooms() {
  const g = G();
  const cap = gc('mush', () => lathe([[0.0001, 0], [0.01, 0.002], [0.013, 0.012], [0.011, 0.024], [0.0001, 0.03]], 8, { wobble: 0.06, freq: 30, seed: 3 }));
  const pile = gc('mushPile', () => scatter(cap, 10, (i, m, r) => {
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 1.4, r() * 6.28, (r() - 0.5) * 1.4));
    m.setPosition((r() - 0.5) * 0.07, 0.004 + r() * 0.02, (r() - 0.5) * 0.06);
  }, 5));
  const heap = G(); heap.name = 'heap';
  heap.add(mesh(pile, cachedMat('mushSkin', () => new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.6 }))));
  g.add(heap);
  g.add(mesh(gc('smallBag', () => lathe([[0.0001, 0], [0.055, 0.003], [0.062, 0.02], [0.05, 0.04], [0.014, 0.06], [0.007, 0.066], [0.014, 0.08]], 12, { wobble: 0.12, freq: 30, seed: 3 })), M.bagClear()));
  return g;
}

export function buildKaffir() {
  const g = G();
  const heap = G(); heap.name = 'heap';
  const lv = gc('kaffirLeaves', () => scatter(leaf(0.045, 0.026, 0.15), 12, (i, m, r) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5));
    m.compose(new THREE.Vector3((r() - 0.5) * 0.04, 0.004 + i * 0.002, (r() - 0.5) * 0.04), q, new THREE.Vector3(1, 1, 1));
  }, 8));
  heap.add(mesh(lv, cachedMat('kaffirLeaf', () => new THREE.MeshStandardMaterial({ map: T.kaleCard(), color: 0x6a9a50, alphaTest: 0.3, roughness: 0.3, side: THREE.DoubleSide }))));
  g.add(heap);
  return g;
}

export function buildGalangal() {
  const g = G();
  const heap = G(); heap.name = 'heap';
  const knob = bulbGeo('galangal');
  const mat = PRODUCE_MAT.galangal();
  heap.add(mesh(knob, mat, [0, 0, 0], [0, 0.3, 0]), mesh(knob, mat, [0.01, 0.012, 0.02], [0.4, -0.5, 0.2], 0.8), mesh(knob, mat, [-0.02, 0, -0.02], [0, 1.2, 0], 0.7));
  g.add(heap);
  return g;
}

export function buildNoodleBag() {
  const sheets = tileMat('noodleSheets', T.noodles(), undefined, { color: 0xfff6ea, rough: 0.35, flat: false });
  return buildPacket('noodles_wide', 0.2, 0.28, 0.045, { clear: true, filling: sheets, lying: true });
}

export { foodMat };
