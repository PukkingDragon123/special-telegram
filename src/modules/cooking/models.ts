import * as THREE from 'three';
import { T, foodMat, cachedMat, labelTex } from './assets';
import { M, mesh, gc } from './mats';
import { lathe, mound, leaf, scatter, merge, rbox, tube, bar, dent, blobDisc, planarUV } from './geo';
import { mulberry } from './util';

/**
 * Visual builders for ingredient packs & produce. Origin = bottom centre; front = +Z.
 * Named children are updated by refresh() (amount → heap size, fill level…).
 */

const G = () => new THREE.Group();

// ------------------------------------------------------------------ trays (meat)

function foamTray(w: number, d: number, h: number) {
  return gc(`tray${w}_${d}_${h}`, () => {
    const t = 0.006;
    const parts = [
      rbox(w, t, d, 0.004, 0.3).translate(0, t / 2, 0),
      rbox(w, h, t, 0.003, 0.3).translate(0, h / 2, -d / 2 + t / 2),
      rbox(w, h, t, 0.003, 0.3).translate(0, h / 2, d / 2 - t / 2),
      rbox(t, h, d, 0.003, 0.3).translate(-w / 2 + t / 2, h / 2, 0),
      rbox(t, h, d, 0.003, 0.3).translate(w / 2 - t / 2, h / 2, 0),
    ];
    // rolled rim
    parts.push(rbox(w + 0.008, 0.004, 0.008, 0.002, 0.3).translate(0, h, -d / 2), rbox(w + 0.008, 0.004, 0.008, 0.002, 0.3).translate(0, h, d / 2));
    return merge(parts);
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
    heap.add(mesh(sl, foodMat('porkRawSl', T.porkRaw(), { rough: 0.45, color: 0xffd6d0 })));
  } else if (kind === 'shrimp') {
    const shr = gc('shrimps', () => scatter(shrimpGeo(), 9, (i, m, r) => {
      m.makeRotationFromEuler(new THREE.Euler(0, r() * 6.28, 0));
      m.setPosition((i % 3 - 1) * 0.055, 0.008, (Math.floor(i / 3) - 1) * 0.038);
    }, 4));
    heap.add(mesh(shr, foodMat('shrimpRaw', T.shrimp(), { rough: 0.35, color: 0xd8c8c0 })));
  } else {
    const tint = kind === 'chicken_minced' ? 0xffe6da : 0xffffff;
    heap.add(mesh(gc('meatMound', () => mound(0.075, 0.032, { seed: 11, detail: 2, rough: 0.28, squash: [1.25, 0.85] })), foodMat('meatRaw' + tint, T.porkRaw(), { rough: 0.5, color: tint, flat: true }), [0, 0.006, 0]));
  }
  g.add(heap);
  // cling film + price sticker (real label photo when available)
  g.add(mesh(gc('film' + W, () => rbox(W + 0.004, 0.003, D + 0.004, 0.0015, 1).translate(0, H + 0.012, 0)), M.film()));
  const st = mesh(gc('sticker', () => new THREE.PlaneGeometry(0.07, 0.045)), M.label(kind === 'pork_minced' ? 'pork_minced' : kind), [0.045, H + 0.0145, 0.03], [-Math.PI / 2, 0, 0.12]);
  g.add(st);
  return g;
}

function shrimpGeo() {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 1.15; pts.push([Math.cos(a) * 0.022, 0.006 + Math.sin(i * 0.9) * 0.001, Math.sin(a) * 0.022]); }
  const t = tube(pts, 0.0075, 10, 6);
  // taper: scale radius toward the tail
  const pos = t.getAttribute('position');
  void pos;
  planarUV(t, 1 / 0.05);
  return t;
}

// ------------------------------------------------------------------ herbs & veg bunches

export function buildBasil(seed = 1) {
  const g = G();
  const rnd = mulberry(seed);
  const bunch = G();
  bunch.name = 'heap';
  const stems = gc('basilStems', () => {
    const parts: THREE.BufferGeometry[] = [];
    const r = mulberry(7);
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, sp = 0.012 + r() * 0.01;
      parts.push(tube([[0, 0.004, 0.06], [Math.cos(a) * sp * 0.5, 0.012, 0.02], [Math.cos(a) * sp, 0.02 + r() * 0.01, -0.03], [Math.cos(a) * sp * 1.6, 0.03 + r() * 0.015, -0.08]], 0.0022, 8, 4));
    }
    return merge(parts);
  });
  bunch.add(mesh(stems, M.stemPurple()));
  const leaves = gc('basilLeaves', () => scatter(leaf(0.032, 0.02, 0.35), 34, (i, m, r) => {
    const a = r() * 6.28, rr = 0.005 + r() * 0.032;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 1.2, r() * 6.28, (r() - 0.5) * 0.9));
    m.compose(new THREE.Vector3(Math.cos(a) * rr * 0.8, 0.018 + r() * 0.03, -0.03 - r() * 0.06 + Math.sin(a) * rr * 0.3), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + r() * 0.6));
  }, 9));
  bunch.add(mesh(leaves, foodMat('basilLeaf', T.basil(), { alpha: true, side: THREE.DoubleSide, rough: 0.5 })));
  // red rubber band
  bunch.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.01, 0.035], [0, 0, 0]));
  g.add(bunch);
  void rnd;
  return g;
}

export function buildBundle(kind: 'long_beans' | 'morning_glory' | 'spring_onion' | 'lemongrass' | 'kale') {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const r0 = mulberry(kind.length * 31);
  if (kind === 'long_beans') {
    const geo = gc('beans', () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 14; i++) {
        const ox = (r0() - 0.5) * 0.04, oy = 0.006 + r0() * 0.02, bend = (r0() - 0.5) * 0.05;
        parts.push(tube([[ox - 0.17, oy, bend], [ox - 0.06, oy + 0.004, bend * 0.3], [ox + 0.06, oy + 0.002, -bend * 0.2], [ox + 0.18, oy - 0.002, bend * 0.6]], 0.0045, 14, 5));
      }
      return planarUV(merge(parts), 1 / 0.36, 'z');
    });
    heap.add(mesh(geo, foodMat('beanSkin', T.longbean(), { rough: 0.5, color: 0xb8e090 })));
    heap.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.014, 0], [0, Math.PI / 2, 0], [2.2, 2.2, 2.2]));
  } else if (kind === 'morning_glory' || kind === 'spring_onion' || kind === 'lemongrass') {
    const n = kind === 'lemongrass' ? 6 : 16;
    const rad = kind === 'lemongrass' ? 0.008 : kind === 'spring_onion' ? 0.0035 : 0.004;
    const len = kind === 'lemongrass' ? 0.28 : kind === 'spring_onion' ? 0.3 : 0.36;
    const geo = gc('bundle' + kind, () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const ox = (r0() - 0.5) * 0.035, oy = 0.006 + r0() * 0.02;
        const g1 = new THREE.CylinderGeometry(rad * 0.75, rad, len, 5, 3);
        g1.rotateZ(Math.PI / 2);
        g1.translate(ox, oy, (r0() - 0.5) * 0.03);
        parts.push(dent(g1, rad * 0.25, 30, i));
      }
      return merge(parts);
    });
    const col = kind === 'lemongrass' ? 0xd8dca0 : kind === 'spring_onion' ? 0x6aa040 : 0x7fae4a;
    heap.add(mesh(geo, cachedMat('stalk' + kind, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }))));
    if (kind === 'morning_glory') {
      const lv = gc('mgLeaves', () => scatter(leaf(0.06, 0.028, 0.2), 16, (i, m, r) => {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.8, (r() - 0.5) * 0.8 + Math.PI, (r() - 0.5) * 0.6));
        m.compose(new THREE.Vector3(-0.15 + r() * 0.05, 0.02 + r() * 0.02, (r() - 0.5) * 0.06), q, new THREE.Vector3(1, 1, 1));
      }, 5));
      heap.add(mesh(lv, foodMat('greensLeaf', T.greens(), { side: THREE.DoubleSide, rough: 0.5 })));
    }
    heap.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0.05, 0.016, 0], [0, Math.PI / 2, 0], [2.4, 2.4, 2.4]));
  } else {
    // kale: thick pale stems + broad leaves
    const stems = gc('kaleStems', () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) { const g1 = new THREE.CylinderGeometry(0.005, 0.007, 0.22, 6); g1.rotateZ(Math.PI / 2); g1.translate(0.02, 0.008 + i * 0.004, (i - 2.5) * 0.012); parts.push(g1); }
      return merge(parts);
    });
    heap.add(mesh(stems, cachedMat('kaleStem', () => new THREE.MeshStandardMaterial({ color: 0xa9c78a, roughness: 0.5 }))));
    const lv = gc('kaleLeaves', () => scatter(leaf(0.12, 0.08, 0.3), 7, (i, m, r) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, Math.PI + (r() - 0.5) * 0.7, (r() - 0.5) * 0.4));
      m.compose(new THREE.Vector3(-0.07, 0.02 + i * 0.006, (i - 3) * 0.012), q, new THREE.Vector3(1, 1, 1));
    }, 6));
    heap.add(mesh(lv, foodMat('greensLeaf', T.greens(), { side: THREE.DoubleSide, rough: 0.5 })));
  }
  g.add(heap);
  return g;
}

// ------------------------------------------------------------------ bulbs & round produce

function bulbGeo(kind: 'garlic' | 'onion' | 'lime' | 'tomato' | 'egg' | 'galangal') {
  return gc('bulb' + kind, () => {
    switch (kind) {
      case 'garlic': return lathe([[0.0001, 0], [0.012, 0.002], [0.022, 0.012], [0.024, 0.022], [0.018, 0.032], [0.006, 0.04], [0.002, 0.048]], 12, { wobble: 0.18, freq: 60, seed: 2 });
      case 'onion': return lathe([[0.0001, 0], [0.02, 0.004], [0.036, 0.022], [0.037, 0.04], [0.026, 0.06], [0.008, 0.072], [0.003, 0.08]], 12, { wobble: 0.05, freq: 12, seed: 3 });
      case 'lime': return lathe([[0.0001, 0], [0.016, 0.004], [0.024, 0.02], [0.024, 0.032], [0.016, 0.048], [0.003, 0.054]], 10, { wobble: 0.04, freq: 20, seed: 4 });
      case 'tomato': return lathe([[0.0001, 0], [0.02, 0.003], [0.03, 0.018], [0.029, 0.034], [0.018, 0.046], [0.0001, 0.048]], 12, { wobble: 0.07, freq: 14, seed: 5 });
      case 'egg': return lathe([[0.0001, 0], [0.012, 0.002], [0.02, 0.012], [0.022, 0.026], [0.019, 0.042], [0.011, 0.054], [0.0001, 0.058]], 12, { wobble: 0.01, freq: 9, seed: 6 });
      default: return dent(new THREE.CapsuleGeometry(0.012, 0.05, 3, 6).rotateZ(Math.PI / 2).translate(0, 0.012, 0), 0.004, 40, 7);
    }
  });
}

const PRODUCE_MAT: Record<string, () => THREE.Material> = {
  garlic: () => foodMat('garlicSkin', T.garlic(), { rough: 0.7, color: 0xffffff }),
  onion: () => foodMat('onionSkin', T.onion(), { rough: 0.55, color: 0xd7a665 }),
  lime: () => cachedMat('limeSkin', () => new THREE.MeshStandardMaterial({ color: 0x5d9a2a, roughness: 0.45 })),
  tomato: () => cachedMat('tomatoSkin', () => new THREE.MeshStandardMaterial({ color: 0xc8261a, roughness: 0.3 })),
  egg: () => M.eggShell(),
  galangal: () => cachedMat('galangal', () => new THREE.MeshStandardMaterial({ color: 0xe8cbb0, roughness: 0.7 })),
};

/** A little pile of round produce; `count` children named heap reflect the amount. */
export function buildPile(kind: 'garlic' | 'onion' | 'lime' | 'tomato' | 'galangal', max = 5) {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const r = mulberry(kind.length * 17 + 3);
  const geo = bulbGeo(kind);
  const mat = PRODUCE_MAT[kind]();
  const spots: [number, number, number][] = [[0, 0, 0], [0.05, 0, 0.012], [-0.045, 0, 0.018], [0.01, 0, -0.045], [0.022, 0.038, -0.006], [-0.03, 0, -0.04]];
  for (let i = 0; i < max; i++) {
    const s = spots[i % spots.length];
    const m = mesh(geo, mat, [s[0], s[1], s[2]], [(r() - 0.5) * 0.4 + (kind === 'garlic' ? 0 : 0), r() * 6.28, (r() - 0.5) * 0.4], 0.92 + r() * 0.16);
    m.name = 'p' + i;
    heap.add(m);
  }
  if (kind === 'garlic') {
    // a red mesh bag hint: a band around the pile
    heap.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.03, 0], [Math.PI / 2, 0, 0], [5.5, 5.5, 3]));
  }
  g.add(heap);
  return g;
}

export function buildEgg() {
  const g = G();
  g.add(mesh(bulbGeo('egg'), M.eggShell(), [0, 0, 0], [0, 0, 0]));
  return g;
}

/** Molded pulp tray with eggs (data.n) — 30 cups. */
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
  return g;
}

// ------------------------------------------------------------------ chilies in a bag

export function buildChiliBag() {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  const chili = gc('chiliPod', () => lathe([[0.0001, 0], [0.003, 0.004], [0.0035, 0.018], [0.0025, 0.03], [0.0012, 0.034], [0.0016, 0.038]], 6, { wobble: 0.08, seed: 12 }));
  const red = gc('chiliPile', () => scatter(chili, 26, (i, m, r) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (r() - 0.5) * 0.8, r() * 6.28, (r() - 0.5) * 0.8));
    m.compose(new THREE.Vector3((r() - 0.5) * 0.06, 0.004 + r() * 0.025, (r() - 0.5) * 0.05), q, new THREE.Vector3(1, 1, 1));
  }, 21));
  heap.add(mesh(red, cachedMat('chiliRed', () => new THREE.MeshStandardMaterial({ color: 0xc81e14, roughness: 0.28 }))));
  const grn = gc('chiliPileG', () => scatter(chili, 9, (i, m, r) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (r() - 0.5) * 0.8, r() * 6.28, 0));
    m.compose(new THREE.Vector3((r() - 0.5) * 0.06, 0.01 + r() * 0.02, (r() - 0.5) * 0.05), q, new THREE.Vector3(1, 1, 1));
  }, 22));
  heap.add(mesh(grn, cachedMat('chiliGreen', () => new THREE.MeshStandardMaterial({ color: 0x3f8a1e, roughness: 0.3 }))));
  g.add(heap);
  // clear plastic bag, tied
  g.add(mesh(gc('chiliBag', () => lathe([[0.0001, 0], [0.04, 0.003], [0.046, 0.02], [0.038, 0.04], [0.012, 0.055], [0.006, 0.062], [0.012, 0.075]], 12, { wobble: 0.12, freq: 30, seed: 3 })), M.bagClear(), [0, 0, 0], [0, 0, 0], [1, 1, 0.8]));
  g.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.058, 0], [Math.PI / 2, 0, 0]));
  return g;
}

// ------------------------------------------------------------------ bottles & jars (real label photos)

export interface BottleSpec {
  h: number; r: number; neck?: number; neckH?: number; shoulder?: number;
  label: [number, number];     // label band v0..v1 (fraction of height)
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

/** Bottle/jar with a liquid core (fill level via `liquid` child scale), label band and cap. */
export function buildBottle(kind: string, s: BottleSpec) {
  const g = G();
  const prof = bottleProfile(s);
  const shell = gc('btl' + kind, () => lathe(prof, 18, { wobble: 0.006, seed: kind.length }));
  // liquid core: slightly inset copy, scaled in Y by fill (origin at bottom)
  const coreProf = prof.map(([r, y]) => [Math.max(0.0001, r * 0.93), y * 0.97 + 0.002] as [number, number]);
  const core = gc('btlc' + kind, () => lathe(coreProf, 14));
  const liq = mesh(core, M.liquid(s.liquid, s.shape === 'jar' ? 0.6 : 0.1));
  liq.name = 'liquid';
  g.add(liq);
  g.add(mesh(shell, M.glassBottle(s.glass ?? 0xeeeeee, s.glassOpacity ?? 0.3)));
  // label band (u wraps the real flattened label photo; front panel at u=0.5 faces +Z)
  const lr = prof.reduce((a, [r, y]) => (y >= s.h * s.label[0] && y <= s.h * s.label[1] ? Math.max(a, r) : a), 0) * 1.012 || s.r * 1.01;
  const band = gc('lbl' + kind, () => lathe([[lr, s.h * s.label[0]], [lr, s.h * s.label[1]]], 24));
  g.add(mesh(band, M.label(kind)));
  // cap with ridges
  const n = s.shape === 'jar' || s.shape === 'shaker' ? s.r * 0.88 : (s.neck ?? s.r * 0.35) * 1.15;
  const ch = s.capH ?? (s.shape === 'jar' || s.shape === 'shaker' ? 0.02 : 0.02);
  const cap = gc('cap' + kind, () => lathe([[0.0001, s.h + ch], [n * 0.96, s.h + ch], [n, s.h + ch * 0.85], [n, s.h - 0.002], [n * 0.9, s.h - 0.002]], 16, { wobble: 0.04, freq: 120, seed: 4 }));
  g.add(mesh(cap, M.plastic(s.cap)));
  return g;
}

/** Bag/packet (sugar, MSG, starch, noodles, rice sack): pillow body + real packaging photo on the front. */
export function buildPacket(kind: string, w: number, h: number, d: number, o: { body?: THREE.Material; clear?: boolean; filling?: THREE.Material; lying?: boolean } = {}) {
  const g = G();
  const body = gc('pk' + kind, () => {
    const b = rbox(w, h, d, Math.min(d * 0.45, 0.03), 0.3, 3);
    // pillow bulge
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
  // printed front (real packaging photo, slightly bulged quad)
  const front = gc('pkf' + kind, () => {
    const p = new THREE.PlaneGeometry(w * 0.92, h * 0.9, 6, 6);
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
  if (o.lying) { g.rotation.x = -Math.PI / 2; g.position.y = d * 0.4; const w2 = G(); w2.add(g); return w2; }
  return g;
}

/** Woven rice sack (5 kg) */
export function buildRiceSack() {
  const g = buildPacket('rice_bag', 0.3, 0.42, 0.12, { body: M.tarp(0xe9e2c8) });
  return g;
}

// ------------------------------------------------------------------ paste in a bag / jar

export function buildPasteBag(kind: string, color: number) {
  const g = G();
  const heap = G();
  heap.name = 'heap';
  heap.add(mesh(gc('pasteMound', () => mound(0.05, 0.04, { seed: 4, detail: 2, rough: 0.2 })), foodMat('paste' + color, T.curry(), { rough: 0.45, color }), [0, 0.002, 0]));
  g.add(heap);
  g.add(mesh(gc('pasteBag', () => lathe([[0.0001, 0], [0.055, 0.004], [0.058, 0.025], [0.042, 0.05], [0.012, 0.07], [0.006, 0.08], [0.014, 0.095]], 12, { wobble: 0.12, freq: 25, seed: 7 })), M.bagClear(), [0, 0, 0]));
  g.add(mesh(gc('band', () => new THREE.TorusGeometry(0.008, 0.0018, 4, 10)), M.rubberBand(), [0, 0.076, 0], [Math.PI / 2, 0, 0]));
  void kind;
  return g;
}

// ------------------------------------------------------------------ misc produce

export function buildCucumbers() {
  const g = G();
  const geo = gc('cucumber', () => planarUV(dent(new THREE.CapsuleGeometry(0.018, 0.14, 4, 8).rotateZ(Math.PI / 2), 0.0025, 45, 8).translate(0, 0.018, 0), 1 / 0.18, 'z'));
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
  g.add(mesh(gc('chiliBag', () => lathe([[0.0001, 0], [0.04, 0.003], [0.046, 0.02], [0.038, 0.04], [0.012, 0.055], [0.006, 0.062], [0.012, 0.075]], 12, { wobble: 0.12, freq: 30, seed: 3 })), M.bagClear(), [0, 0, 0], [0, 0, 0], [1.2, 0.9, 1]));
  return g;
}

export function buildKaffir() {
  const g = G();
  const heap = G(); heap.name = 'heap';
  const lv = gc('kaffirLeaves', () => scatter(leaf(0.045, 0.026, 0.15), 12, (i, m, r) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5));
    m.compose(new THREE.Vector3((r() - 0.5) * 0.04, 0.004 + i * 0.002, (r() - 0.5) * 0.04), q, new THREE.Vector3(1, 1, 1));
  }, 8));
  heap.add(mesh(lv, cachedMat('kaffirLeaf', () => new THREE.MeshStandardMaterial({ color: 0x2c5a1c, roughness: 0.3, side: THREE.DoubleSide }))));
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
  const sheets = cachedMat('noodleSheet', () => new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.35, transparent: true, opacity: 0.92 }));
  return buildPacket('noodles_wide', 0.24, 0.05, 0.16, { clear: true, filling: sheets, lying: false });
}

export { bar, blobDisc, labelTex };
