import * as THREE from 'three';
import { T, lateTex, cachedMat, foodMat, speckle } from './assets';
import { M, mesh, gc } from './mats';
import { lathe, mound, leaf, scatter, merge, rbox, tube, bar, dent, blobDisc, planarUV, card } from './geo';
import { F } from '../../core/fonts';
import { mulberry } from './util';

/** Visual builders for tools, vessels and appliances. Origin bottom centre, front = +Z. */

const G = () => new THREE.Group();

// ------------------------------------------------------------------ wok

export const WOK_R = 0.19;
export const WOK_D = 0.105;
/** inner bowl height at radius r (paraboloid-ish) */
export const wokY = (r: number) => 0.006 + WOK_D * Math.pow(Math.min(1, r / WOK_R), 2.1);

export function wokBowlGeo() {
  return gc('wokBowl', () => {
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) { const r = (i / n) * WOK_R; outer.push([Math.max(0.0001, r), wokY(r) - 0.004]); }
    outer.push([WOK_R + 0.006, WOK_D + 0.004]);
    for (let i = n; i >= 0; i--) { const r = (i / n) * (WOK_R - 0.002); inner.push([Math.max(0.0001, r), wokY(r) + 0.0005]); }
    const g = lathe([...outer, ...inner], 28, { wobble: 0.004, seed: 2, freq: 5 });
    return planarUV(g, 1 / 0.4);
  });
}

export function buildWok() {
  const g = G();
  g.add(mesh(wokBowlGeo(), M.wok()));
  // long handle: steel socket + wooden grip (Thai street wok)
  const steel = gc('wokHandleSteel', () => merge([
    bar([WOK_R - 0.01, WOK_D - 0.01, 0], [WOK_R + 0.09, WOK_D + 0.03, 0], 0.011, 7),
    bar([WOK_R - 0.03, WOK_D - 0.025, 0.012], [WOK_R + 0.01, WOK_D + 0.002, 0.012], 0.006, 5),
  ]));
  g.add(mesh(steel, M.steelDark()));
  const grip = gc('wokGrip', () => dent(bar([WOK_R + 0.085, WOK_D + 0.028, 0], [WOK_R + 0.23, WOK_D + 0.075, 0], 0.016, 8), 0.0015, 40, 3));
  g.add(mesh(grip, M.wood()));
  // small loop handle opposite
  const loop = gc('wokLoop', () => { const t = new THREE.TorusGeometry(0.03, 0.005, 5, 10, Math.PI); t.rotateY(Math.PI / 2); t.rotateZ(Math.PI / 2); t.translate(-WOK_R - 0.004, WOK_D - 0.004, 0); return t; });
  g.add(mesh(loop, M.steelDark()));
  const food = G();
  food.name = 'wokfood';
  g.add(food);
  return g;
}

// ------------------------------------------------------------------ food layers (wok contents / dishes)

export type HeapKind = 'meat' | 'rice' | 'noodle' | 'veg' | 'shrimp' | 'paste' | 'none';

const FOOD_SETS: Record<Exclude<HeapKind, 'none'>, () => [THREE.Texture, THREE.Texture]> = {
  meat: () => [T.porkRaw(), T.porkCooked()],
  rice: () => [T.rice(), T.friedRice()],
  noodle: () => [T.noodles(), T.noodles()],
  veg: () => [T.greens(), T.greens()],
  shrimp: () => [T.shrimp(), T.shrimp()],
  paste: () => [T.curry(), T.curry()],
};

/** A food material blending raw → cooked → burnt textures (per-instance uniforms). */
export function blendFoodMat() {
  const m = new THREE.MeshStandardMaterial({ map: T.porkRaw(), roughness: 0.5, metalness: 0, flatShading: true });
  const u = { map2: { value: T.porkCooked() }, map3: { value: T.burnt() }, k2: { value: 0 }, k3: { value: 0 }, gloss: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D map2; uniform sampler2D map3; uniform float k2; uniform float k3; uniform float gloss;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  vec3 c2 = texture2D(map2, vMapUv).rgb; vec3 c3 = texture2D(map3, vMapUv).rgb;
  diffuseColor.rgb = mix(mix(diffuseColor.rgb, c2 * diffuse, k2), c3 * diffuse, k3);
#endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, gloss);');
  };
  m.customProgramCacheKey = () => 'blendFood';
  (m as any).userData.u = u;
  return m;
}

export function setFoodSet(m: THREE.MeshStandardMaterial, kind: HeapKind) {
  if (kind === 'none') return;
  const [a, b] = FOOD_SETS[kind]();
  if (m.map !== a) { m.map = a; m.needsUpdate = false; }
  (m as any).userData.u.map2.value = b;
}

export interface FoodLayers {
  root: THREE.Group;
  heap: THREE.Mesh; heapMat: THREE.MeshStandardMaterial;
  leaves: THREE.Mesh; leafMat: THREE.MeshStandardMaterial;
  chili: THREE.Mesh; bits: THREE.Mesh;
  oil: THREE.Mesh; liquid: THREE.Mesh; liquidMat: THREE.MeshStandardMaterial;
  eggs: THREE.Mesh[]; eggMat: THREE.MeshStandardMaterial;
  omelet: THREE.Mesh;
}

/** Build the (initially hidden) food layer meshes that live inside a wok or on a plate. */
export function buildFoodLayers(seed = 1): FoodLayers {
  const root = G();
  root.name = 'foodlayers';
  const heapMat = blendFoodMat();
  const heap = mesh(gc('heap' + (seed % 4), () => planarUV(mound(0.1, 0.03, { seed: 20 + (seed % 4), detail: 2, rough: 0.3 }), 1 / 0.16)), heapMat);
  heap.visible = false;
  // real stir-fried basil sprig photos as little cards on top of the heap
  const leafMat = new THREE.MeshStandardMaterial({ map: T.basilCooked(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.38 });
  const leaves = mesh(gc('wokLeafCards', () => scatter(card(0.07, 0.07, 0.01, 2), 14, (i, m, r) => {
    const a = r() * 6.28, rr = Math.sqrt(r()) * 0.08;
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7));
    m.setPosition(Math.cos(a) * rr, 0.024 + (1 - rr / 0.08) * 0.016, Math.sin(a) * rr);
  }, 33)), leafMat);
  leaves.visible = false;
  const chili = mesh(gc('wokChiliCards', () => scatter(card(0.045, 0.045, 0.004, 1), 7, (i, m, r) => {
    const a = r() * 6.28, rr = Math.sqrt(r()) * 0.075;
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5));
    m.setPosition(Math.cos(a) * rr, 0.03 + (1 - rr / 0.075) * 0.01, Math.sin(a) * rr);
  }, 34)), new THREE.MeshStandardMaterial({ map: T.chiliCard(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.3 }));
  chili.visible = false;
  const bits = mesh(gc('wokGarlicCards', () => scatter(card(0.05, 0.05, 0.004, 1), 6, (i, m, r) => {
    const a = r() * 6.28, rr = Math.sqrt(r()) * 0.07;
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4));
    m.setPosition(Math.cos(a) * rr, 0.012 + (1 - rr / 0.07) * 0.01, Math.sin(a) * rr);
  }, 35)), new THREE.MeshStandardMaterial({ map: T.garlicMinced(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.5 }));
  bits.visible = false;
  const oilM = new THREE.MeshStandardMaterial({ map: T.oil(), normalMap: T.oilN(), color: 0xffffff, transparent: true, opacity: 0.82, roughness: 0.05, metalness: 0.15, depthWrite: false });
  const oil = mesh(gc('oilDisc', () => blobDisc(1, { seed: 3, rough: 0.05, thick: 0.001, seg: 22 })), oilM);
  oil.visible = false;
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0xc8d6d0, transparent: true, opacity: 0.72, roughness: 0.06, metalness: 0.05, depthWrite: false });
  const liquid = mesh(gc('liqDisc', () => { const c = new THREE.CircleGeometry(1, 24); c.rotateX(-Math.PI / 2); return planarUV(c, 0.5); }), liquidMat);
  liquid.visible = false;
  // fried eggs: real ไข่ดาว cut-out photos on a slightly domed card (texture swapped by doneness)
  const eggMat = new THREE.MeshStandardMaterial({ map: T.eggRunny(), alphaTest: 0.4, roughness: 0.3, side: THREE.DoubleSide });
  const eggs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const e = mesh(gc('eggCard' + i, () => card(0.15, 0.15, 0.012, 6)), eggMat);
    e.visible = false;
    eggs.push(e);
  }
  const omelet = mesh(gc('omeletCard', () => card(0.2, 0.2, 0.03, 6)), new THREE.MeshStandardMaterial({ map: T.omeletteCard(), alphaTest: 0.4, roughness: 0.45, side: THREE.DoubleSide }));
  omelet.visible = false;
  root.add(heap, oil, liquid, leaves, chili, bits, ...eggs, omelet);
  root.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return { root, heap, heapMat, leaves, leafMat, chili, bits, oil, liquid, liquidMat, eggs, eggMat, omelet };
}

// ------------------------------------------------------------------ utensils

export function buildSpatula() {
  const g = G();
  const blade = gc('spatBlade', () => {
    const p = new THREE.PlaneGeometry(0.1, 0.095, 6, 6);
    const pos = p.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      // curl the sides and back up like a real ตะหลิว
      pos.setZ(i, (x / 0.05) ** 2 * 0.012 + Math.max(0, -y / 0.0475) ** 2 * 0.01);
      pos.setX(i, x * (0.82 + 0.18 * (y / 0.095 + 0.5)));
    }
    p.computeVertexNormals();
    p.rotateX(-Math.PI / 2);
    p.translate(0, 0.004, -0.05);
    return p;
  });
  g.add(mesh(blade, cachedMat('spatBladeM', () => { const m = (M.steel() as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; })));
  g.add(mesh(gc('spatShaft', () => bar([0, 0.01, 0], [0, 0.07, 0.26], 0.005, 6)), M.steelDark()));
  g.add(mesh(gc('spatGrip', () => dent(bar([0, 0.068, 0.25], [0, 0.11, 0.4], 0.013, 7), 0.0012, 40, 2)), M.wood()));
  return g;
}

export function buildLadle() {
  const g = G();
  g.add(mesh(gc('ladleBowl', () => lathe([[0.0001, 0], [0.025, 0.004], [0.042, 0.018], [0.046, 0.034], [0.044, 0.035], [0.04, 0.019], [0.023, 0.007], [0.0001, 0.004]], 14)), cachedMat('ladleM', () => { const m = (M.steel() as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; })));
  g.add(mesh(gc('ladleShaft', () => bar([0, 0.034, 0.044], [0, 0.1, 0.26], 0.005, 6)), M.steelDark()));
  g.add(mesh(gc('ladleGrip', () => bar([0, 0.098, 0.25], [0, 0.13, 0.38], 0.013, 7)), M.wood()));
  return g;
}

export function buildCleaver() {
  const g = G();
  const blade = gc('cleaverBlade', () => {
    const b = rbox(0.2, 0.095, 0.005, 0.002, 0.2, 1);
    // taper the edge
    const pos = b.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < -0.03) pos.setZ(i, pos.getZ(i) * 0.35); }
    b.computeVertexNormals();
    b.rotateX(-Math.PI / 2);
    b.translate(-0.06, 0.004, 0);
    return b;
  });
  g.add(mesh(blade, M.steelDark()));
  g.add(mesh(gc('cleaverGrip', () => dent(bar([0.04, 0.004, -0.035], [0.17, 0.008, -0.035], 0.014, 7), 0.0012, 40, 9)), M.wood()));
  return g;
}

export function buildRicePaddle() {
  const g = G();
  const p = gc('paddle', () => {
    const d = new THREE.CircleGeometry(0.04, 12);
    d.scale(1, 1.25, 1);
    const pos = d.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, ((pos.getX(i) / 0.04) ** 2) * 0.004);
    d.rotateX(-Math.PI / 2);
    d.translate(0, 0.006, -0.05);
    return merge([d, bar([0, 0.006, 0], [0, 0.02, 0.15], 0.008, 6)]);
  });
  g.add(mesh(p, cachedMat('paddleM', () => { const m = (M.plastic(0xf4f2ea) as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; })));
  return g;
}

export function buildSpoonFork() {
  const g = G();
  const spoon = gc('spoon', () => {
    const b = lathe([[0.0001, 0], [0.012, 0.002], [0.02, 0.006], [0.021, 0.007]], 10);
    b.scale(1, 1, 1.45);
    b.translate(0, 0.002, -0.05);
    return merge([b, bar([0, 0.006, -0.02], [0, 0.012, 0.11], 0.003, 5)]);
  });
  const fork = gc('fork', () => {
    const parts: THREE.BufferGeometry[] = [bar([0, 0.006, -0.02], [0, 0.012, 0.11], 0.003, 5), rbox(0.022, 0.003, 0.02, 0.001, 1).translate(0, 0.005, -0.03)];
    for (let i = 0; i < 4; i++) parts.push(rbox(0.003, 0.002, 0.035, 0.0008, 1).translate((i - 1.5) * 0.006, 0.005, -0.055));
    return merge(parts);
  });
  const m = cachedMat('cutlery', () => { const x = (M.steel() as THREE.MeshStandardMaterial).clone(); x.side = THREE.DoubleSide; return x; });
  g.add(mesh(spoon, m, [-0.018, 0, 0], [0, 0.12, 0]), mesh(fork, m, [0.02, 0, 0], [0, -0.1, 0]));
  return g;
}

// ------------------------------------------------------------------ board, mortar

export function buildBoard() {
  const g = G();
  const R = 0.16, H = 0.05;
  const cyl = gc('boardCyl', () => dent(new THREE.CylinderGeometry(R, R * 1.01, H, 22, 1), 0.002, 12, 4).translate(0, H / 2, 0));
  // materials: side = wood, top/bottom = end-grain disc photo
  g.add(new THREE.Mesh(cyl, [M.boardSide(), M.board(), M.board()]));
  const top = G();
  top.name = 'chopped';
  top.position.y = H;
  g.add(top);
  return g;
}

export function buildMortar() {
  const g = G();
  const prof: [number, number][] = [[0.0001, 0], [0.07, 0.002], [0.078, 0.02], [0.085, 0.06], [0.1, 0.11], [0.112, 0.125], [0.106, 0.13], [0.09, 0.118], [0.07, 0.08], [0.045, 0.045], [0.0001, 0.035]];
  g.add(mesh(gc('mortarBody', () => lathe(prof, 20, { wobble: 0.025, freq: 9, seed: 6 })), M.clay()));
  const paste = new THREE.Group();
  paste.name = 'paste';
  paste.position.y = 0.035;
  paste.add(mesh(gc('mortarPaste', () => mound(0.052, 0.016, { seed: 7, detail: 2, rough: 0.35 })), new THREE.MeshStandardMaterial({ color: 0xe0cfa8, roughness: 0.55, flatShading: true })));
  const crushed = mesh(gc('mortarCard', () => card(0.1, 0.1, 0.012, 3).translate(0, 0.014, 0)), new THREE.MeshStandardMaterial({ map: T.garlicCard(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.5 }));
  crushed.name = 'crushed';
  const chiliC = mesh(gc('mortarChili', () => card(0.07, 0.07, 0.01, 2).translate(0.01, 0.02, -0.005)), new THREE.MeshStandardMaterial({ map: T.chiliCard(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.35 }));
  chiliC.name = 'chili';
  paste.add(crushed, chiliC);
  paste.visible = false;
  g.add(paste);
  const pestle = G();
  pestle.name = 'pestle';
  pestle.add(mesh(gc('pestle', () => lathe([[0.0001, 0], [0.02, 0.004], [0.028, 0.03], [0.022, 0.08], [0.016, 0.2], [0.018, 0.22], [0.0001, 0.225]], 10, { wobble: 0.04, seed: 3 })), M.woodRaw()));
  pestle.position.set(0.02, 0.045, 0);
  pestle.rotation.set(0, 0, -0.55);
  g.add(pestle);
  return g;
}

// ------------------------------------------------------------------ plates, bowls, boxes (real dishware photos)

export const PLATE_STYLES = ['flora', 'blue', 'green'];

export function plateTex(style: string) {
  const keys: Record<string, string[]> = {
    flora: ['melamine plate flower', 'melamine plate flora', 'flora rim', 'plate flower', 'melamine plate', 'จานเมลามีน'],
    blue: ['blue white plate', 'blue pattern plate', 'chinese plate blue', 'plate blue'],
    green: ['green melamine plate', 'plate green', 'plate light blue', 'melamine plate'],
  };
  const tint: Record<string, string> = { flora: '#d84a8a', blue: '#2a5aa8', green: '#4a9a6a' };
  return lateTex('plate:' + style, keys[style] ?? keys.flora, (ctx, S) => {
    ctx.fillStyle = '#f7f5ef'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = tint[style] ?? '#888'; ctx.lineWidth = S * 0.05;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); ctx.stroke();
  }, { dirs: ['textures/props/', 'gen/cooking/', 'textures/food/'], clamp: true, not: ['food', 'rice', 'dish_'] });
}

export function plateMat(style: string) {
  return cachedMat('plate:' + style, () => new THREE.MeshStandardMaterial({ map: plateTex(style), roughness: 0.32, metalness: 0 }));
}

export function buildPlate(style = 'flora') {
  const g = G();
  g.add(mesh(gc('plate', () => plateGeoSimple()), plateMat(style)));
  const top = G();
  top.name = 'ontop';
  top.position.y = 0.012;
  g.add(top);
  return g;
}

function plateGeoSimple() {
  const r = 0.12, h = 0.022;
  const outer: [number, number][] = [[0.0001, 0], [r * 0.6, 0], [r * 0.82, h * 0.45], [r * 0.97, h * 0.9], [r, h]];
  const inner: [number, number][] = [[r * 0.985, h * 0.98], [r * 0.82, h * 0.62], [r * 0.6, h * 0.24], [r * 0.4, h * 0.2], [0.0001, h * 0.2]];
  const g = lathe([...outer, ...inner], 24, { wobble: 0.004, seed: 1 });
  return planarUV(g, 1 / (2 * r));
}

export function bowlTex() {
  return lateTex('bowl:rooster', ['rooster bowl', 'ชามตราไก่', 'rooster', 'chicken bowl'], (ctx, S) => {
    ctx.fillStyle = '#f6f3ea'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#c8281e'; ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.55, S * 0.12, S * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a8a3a'; ctx.fillRect(S * 0.75, S * 0.3, S * 0.05, S * 0.5);
  }, { dirs: ['textures/props/', 'gen/cooking/'] });
}

export function buildBowl() {
  const g = G();
  const prof: [number, number][] = [[0.0001, 0], [0.035, 0], [0.038, 0.008], [0.06, 0.03], [0.075, 0.062], [0.078, 0.075], [0.074, 0.075], [0.07, 0.062], [0.055, 0.032], [0.03, 0.012], [0.0001, 0.01]];
  g.add(mesh(gc('bowl', () => lathe(prof, 22, { wobble: 0.006, seed: 3 })), cachedMat('rooster', () => new THREE.MeshStandardMaterial({ map: bowlTex(), roughness: 0.25 }))));
  const top = G();
  top.name = 'ontop';
  top.position.y = 0.012;
  g.add(top);
  const liq = mesh(gc('bowlLiq', () => { const c = new THREE.CircleGeometry(1, 20); c.rotateX(-Math.PI / 2); return planarUV(c, 0.5); }), new THREE.MeshStandardMaterial({ color: 0xf0c050, roughness: 0.25, transparent: true, opacity: 0.92 }));
  liq.name = 'bowlliquid';
  liq.visible = false;
  g.add(liq);
  return g;
}

export function buildTakeaway() {
  const g = G();
  const W = 0.18, D = 0.15, H = 0.05, t = 0.006;
  const half = gc('foamHalf', () => merge([
    rbox(W, t, D, 0.004, 0.3).translate(0, t / 2, 0),
    rbox(W, H, t, 0.004, 0.3).translate(0, H / 2, -D / 2 + t / 2), rbox(W, H, t, 0.004, 0.3).translate(0, H / 2, D / 2 - t / 2),
    rbox(t, H, D, 0.004, 0.3).translate(-W / 2 + t / 2, H / 2, 0), rbox(t, H, D, 0.004, 0.3).translate(W / 2 - t / 2, H / 2, 0),
  ]));
  g.add(mesh(half, M.foam()));
  const lid = G();
  lid.name = 'lid';
  lid.position.set(0, H, -D / 2);
  const lm = mesh(half, M.foam(), [0, 0, D / 2], [Math.PI, 0, 0]);
  lid.add(lm);
  lid.rotation.x = -1.9;
  g.add(lid);
  const top = G();
  top.name = 'ontop';
  top.position.y = 0.008;
  g.add(top);
  return g;
}

export function buildPlasticBag() {
  const g = G();
  g.add(mesh(gc('pbag', () => dent(lathe([[0.0001, 0], [0.07, 0.004], [0.09, 0.05], [0.085, 0.14], [0.06, 0.2], [0.04, 0.23], [0.05, 0.26]], 14, { wobble: 0.15, freq: 18, seed: 4 }), 0.006, 25, 3)), M.bagClear(0xffffff, 0.45)));
  return g;
}

// ------------------------------------------------------------------ rice cooker

export function buildRicePot() {
  const g = G();
  const R = 0.17, H = 0.22;
  g.add(mesh(gc('rcBody', () => lathe([[0.0001, 0], [R * 0.9, 0], [R * 0.95, 0.012], [R, 0.03], [R, H * 0.92], [R * 0.97, H]], 24, { wobble: 0.004, seed: 5 })), M.paint(0xd8692a)));
  g.add(mesh(gc('rcRim', () => lathe([[R * 0.97, H], [R * 0.99, H + 0.01], [R * 0.88, H + 0.012], [R * 0.86, H - 0.02]], 24)), M.alu()));
  // inner pot wall
  g.add(mesh(gc('rcInner', () => lathe([[R * 0.86, H - 0.005], [R * 0.85, 0.05], [0.0001, 0.045]], 22)), cachedMat('rcInnerM', () => { const m = (M.alu() as THREE.MeshStandardMaterial).clone(); m.side = THREE.BackSide; return m; })));
  // control panel (front +Z)
  g.add(mesh(gc('rcPanel', () => rbox(0.09, 0.05, 0.02, 0.006, 1).translate(0, 0.085, R - 0.004)), M.black()));
  const lamp = mesh(gc('rcLamp', () => new THREE.SphereGeometry(0.006, 6, 4).translate(0.025, 0.095, R + 0.007)), M.emissive(0xff7a20, 3));
  lamp.name = 'lamp';
  g.add(lamp);
  // rice surface (scaled by amount)
  const rice = mesh(gc('rcRice', () => planarUV(mound(R * 0.84, 0.03, { seed: 3, detail: 2, rough: 0.12 }), 1 / (2 * R * 0.84))), foodMat('rcRiceM', T.rice(), { rough: 0.7, flat: true }));
  rice.name = 'rice';
  g.add(rice);
  const raw = mesh(gc('rcRaw', () => { const c = new THREE.CircleGeometry(R * 0.84, 20); c.rotateX(-Math.PI / 2); return planarUV(c, 1 / (2 * R * 0.84)); }), cachedMat('rawRice', () => new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.6, map: T.rice() })));
  raw.name = 'raw';
  raw.visible = false;
  g.add(raw);
  const water = mesh(gc('rcWater', () => { const c = new THREE.CircleGeometry(R * 0.845, 20); c.rotateX(-Math.PI / 2); return c; }), M.glassBottle(0xc8dcd8, 0.55));
  water.name = 'water';
  water.visible = false;
  g.add(water);
  // hinged lid (hinge at the back, -Z)
  const lid = G();
  lid.name = 'lid';
  lid.position.set(0, H + 0.01, -R * 0.9);
  lid.add(mesh(gc('rcLid', () => lathe([[0.0001, 0.07], [R * 0.4, 0.062], [R * 0.8, 0.035], [R * 0.98, 0.006], [R, 0], [R * 0.9, -0.004], [0.0001, 0.02]], 22, { wobble: 0.003 }).translate(0, 0, R * 0.9)), M.alu()));
  lid.add(mesh(gc('rcKnob', () => lathe([[0.0001, 0.07], [0.02, 0.07], [0.016, 0.085], [0.0001, 0.09]], 10).translate(0, 0, R * 0.9)), M.black()));
  lid.rotation.x = -1.75;
  g.add(lid);
  // handles
  g.add(mesh(gc('rcHandles', () => merge([rbox(0.05, 0.02, 0.025, 0.008, 1).translate(R + 0.01, H * 0.8, 0), rbox(0.05, 0.02, 0.025, 0.008, 1).translate(-R - 0.01, H * 0.8, 0)])), M.black()));
  return g;
}

// ------------------------------------------------------------------ LPG tank

export function buildGasTank() {
  const g = G();
  const R = 0.15;
  g.add(mesh(gc('lpgFoot', () => lathe([[R * 0.9, 0], [R * 0.95, 0], [R * 0.95, 0.05], [R * 0.9, 0.05]], 18)), M.paint(0x1d58a8)));
  g.add(mesh(gc('lpgBody', () => dent(lathe([[0.0001, 0.04], [R * 0.7, 0.045], [R, 0.09], [R, 0.42], [R * 0.75, 0.5], [0.04, 0.53], [0.0001, 0.535]], 20, { wobble: 0.01, seed: 8 }), 0.003, 6, 2)), M.paint(0x2266b8)));
  g.add(mesh(gc('lpgCollar', () => lathe([[0.075, 0.5], [0.08, 0.5], [0.08, 0.6], [0.075, 0.6]], 14)), M.paint(0x2266b8)));
  g.add(mesh(gc('lpgValve', () => merge([new THREE.CylinderGeometry(0.014, 0.016, 0.05, 8).translate(0, 0.555, 0), new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6).rotateZ(Math.PI / 2).translate(0.02, 0.565, 0)])), cachedMat('brass', () => new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.9, roughness: 0.35 }))));
  g.add(mesh(gc('lpgLabel', () => lathe([[R * 1.008, 0.2], [R * 1.008, 0.36]], 24)), M.label('gas_tank')));
  return g;
}

// ------------------------------------------------------------------ recipe book (the ONLY self-drawn art: lazy, scribbled, human)

let coverCanvas: HTMLCanvasElement | null = null;
export function bookCoverTex() {
  return cachedMat('bookCover', () => {
    const cv = (coverCanvas = document.createElement('canvas'));
    cv.width = 256; cv.height = 360;
    const c = cv.getContext('2d')!;
    const r = mulberry(77);
    c.fillStyle = '#c94a2e'; c.fillRect(0, 0, 256, 360);
    // grime / coffee ring
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(40,20,10,${0.03 + r() * 0.05})`; c.beginPath(); c.arc(r() * 256, r() * 360, 10 + r() * 50, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(70,40,20,0.45)'; c.lineWidth = 6; c.beginPath(); c.arc(170, 260, 48, 0.3, 5.9); c.stroke();
    c.fillStyle = '#f2ead8'; c.fillRect(30, 70, 196, 120);
    c.save(); c.translate(128, 120); c.rotate(-0.06);
    c.fillStyle = '#1b2b6b'; c.font = `400 44px ${F.scrawl}`; c.textAlign = 'center';
    c.fillText('สูตรเฮีย', 0, 0);
    c.font = `400 22px ${F.hand}`; c.fillStyle = '#a01818';
    c.fillText('ห้ามแตะ!! (แตะแล้วล้างจาน)', 0, 40);
    c.restore();
    c.strokeStyle = '#1b2b6b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(60, 210); c.bezierCurveTo(90, 230, 150, 200, 200, 225); c.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  });
}

export function buildBook() {
  const g = G();
  const W = 0.16, Hh = 0.22, T0 = 0.024;
  const pages = mesh(gc('bookPages', () => rbox(W - 0.006, T0 - 0.006, Hh - 0.008, 0.002, 1).translate(0.003, T0 / 2, 0)), M.paper(0xf1ead6));
  g.add(pages);
  const cover = G();
  cover.name = 'cover';
  cover.position.set(-W / 2, T0, 0);
  const cm = mesh(gc('bookCover', () => new THREE.BoxGeometry(W, 0.003, Hh).translate(W / 2, 0.0015, 0)), bookCoverTex());
  cover.add(cm);
  g.add(cover);
  g.add(mesh(gc('bookBack', () => new THREE.BoxGeometry(W, 0.003, Hh).translate(0, 0.0015, 0)), M.paint(0x8a2a1a)));
  // spiral rings along the spine (-X edge)
  g.add(mesh(gc('bookSpiral', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 11; i++) { const t = new THREE.TorusGeometry(0.008, 0.0012, 4, 8); t.rotateY(Math.PI / 2); t.rotateX(Math.PI / 2); t.translate(-W / 2, T0 / 2, -Hh / 2 + 0.015 + i * 0.019); parts.push(t); }
    return merge(parts);
  }), M.chrome()));
  return g;
}

export { leaf, scatter, mound, tube, dent, speckle };
