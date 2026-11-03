import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl, TL } from '../../core/util';
import { T, cachedMat } from './assets';
import { M, mesh, gc } from './mats';
import { mound, planarUV, card, scatter, lathe, dent } from './geo';
import { buildPlate, buildBowl, buildTakeaway, buildSpoonFork, buildPlasticBag } from './models-tools';
import { riceMoundGeo, riceMat, juiceOf, physOf } from './items';
import { juice, juiceKick } from './juice';
import { Sound } from '../../core/audio';
import { pickKey } from './util';
import { leafScatter, leafMat, chiliBits, chiliMat, chunkScatter, reliefGeo, reliefMat, buildFriedEgg, EggVariant } from './realfood';
import { Assets } from '../../core/assets';
import { RECIPES, qualityWord, ISSUE_TH } from './recipes';
import type { CookFX } from './fx';

/* =============================================================================================
 * 'dish' item — finished food (DishData in e.data, see contracts.ts) in the ref5 decimated-photoscan
 * look: faceted low-poly mounds with REAL food photo tiles projected from the top, real ไข่ดาว /
 * basil / chili cut-out photo cards on top, on a melamine plate / rooster bowl / takeaway box.
 * ============================================================================================= */

let FX: CookFX | null = null;
export function setDishFX(fx: CookFX) { FX = fx; }

const heapGeo = (key: string, r: number, h: number, seed: number, squash: [number, number] = [1, 1]) =>
  gc('dishHeap' + key, () => planarUV(mound(r, h, { seed, detail: 2, rough: 0.3, squash }), 1 / (r * 2.2)));

/** glossy street-food heap: real photo tile, crumb normals, clearcoat = the oil/sauce sheen */
function heapMat(tex: THREE.Texture, normal: THREE.Texture | null, color: number, burn: number, key: string, rough = 0.42, oil = 0.7) {
  const b = Math.round(Math.min(1, burn) * 4) / 4;
  return cachedMat(`dishMat:${key}:${b}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: rough, flatShading: true, color, clearcoat: oil * (1 - b * 0.7), clearcoatRoughness: 0.25 + b * 0.4 });
    if (normal) { m.normalMap = normal; m.normalScale.set(0.9, 0.9); }
    m.color.multiplyScalar(1 - b * 0.55);
    return m;
  });
}
const photo = (name: string) => Assets.texture(`textures/food/${name}.png`, { srgb: true, wrap: false });
/** cooked basil leaves scattered over a heap (3D, real leaf photo) */
const dishLeaves = (n: number, spread: number, y: number, seed: number) => leafScatter(`dish${n}:${spread}:${seed}`, n, (i, m, r) => {
  const a = r() * 6.28, rr = Math.sqrt(r()) * spread;
  m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.6));
  m.setPosition(Math.cos(a) * rr, y + (1 - rr / spread) * 0.012, Math.sin(a) * rr);
  return { len: 0.03 + r() * 0.014, wid: 0.022 + r() * 0.008, curl: 0.08, droop: 0.2 };
}, seed);

const cardM = (key: string, tex: THREE.Texture, color = 0xffffff) => cachedMat('dcard:' + key + color, () => new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.38, color }));

function cards(key: string, n: number, size: number, spread: number, y: number, seed: number) {
  return gc(`dcards${key}${n}${size}${spread}`, () => scatter(card(size, size, size * 0.12, 2), n, (i, m, r) => {
    const a = r() * 6.28, rr = Math.sqrt(r()) * spread;
    m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.6, r() * 6.28, (r() - 0.5) * 0.6));
    m.setPosition(Math.cos(a) * rr, y + (1 - rr / spread) * 0.012, Math.sin(a) * rr);
  }, seed));
}

/** Build the food on top of a vessel for DishData. */
function buildFood(d: any): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dishfood';
  const r = RECIPES[d.recipe];
  const vis = d.vis ?? {};
  const burn = vis.burn ?? 0;
  const size = Math.max(0.55, Math.min(1.5, vis.size ?? 1));
  const hasRice = (d.rice ?? 0) > 20;
  const bowl = d.vessel === 'bowl';
  const fx = hasRice ? 0.032 : 0, rx = hasRice ? -0.032 : 0;
  if (hasRice && !bowl) {
    const rm = new THREE.Mesh(riceMoundGeo(), riceMat());
    const s = Math.cbrt(Math.max(0.01, d.rice) / 200);
    rm.scale.setScalar(s);
    rm.position.set(rx, 0, 0);
    g.add(rm);
  }
  const s = Math.cbrt(size);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], sc = 1) => { const m = mesh(geo, mat, pos, undefined, sc); g.add(m); return m; };
  switch (d.recipe) {
    case 'kaphrao_moo': {
      const hm = heapMat(T.kaphrao(), T.kaphraoN(), 0xffffff, burn, 'kap', 0.4, 0.85);
      add(heapGeo('kap', 0.06, 0.026, 3, [1.05, 0.9]), hm, [fx, 0.004, 0.005], s);
      add(chunkScatter('kapDish', 30, 0.056, 0.024, 0.005, 1 / (0.06 * 2.2), 9), hm, [fx, 0.004, 0.005], s);
      if ((vis.herb ?? 1) > 0.15) add(dishLeaves(7, 0.045, 0.02, 4), leafMat(burn > 0.5 ? 'burnt' : 'cooked'), [fx, 0.004, 0], s);
      if ((vis.chili ?? 0) > 0.2) add(chiliBits('dish', 5, 0.04, 6), chiliMat('red', 0.6), [fx, 0.028, 0], s);
      break;
    }
    case 'phat_phrik_kaeng':
      add(heapGeo('ppk', 0.06, 0.026, 5), heapMat(T.curry(), T.porkCookedN(), 0xffb090, burn, 'ppk', 0.4, 0.9), [fx, 0.004, 0.005], s);
      add(chunkScatter('ppkDish', 22, 0.055, 0.024, 0.005, 1 / (0.06 * 2.2), 11), heapMat(T.curry(), T.porkCookedN(), 0xffb090, burn, 'ppk', 0.4, 0.9), [fx, 0.004, 0.005], s);
      add(heapGeo('ppkb', 0.032, 0.018, 8), heapMat(T.beansCut(), null, 0xffffff, burn, 'beans', 0.35), [fx + 0.02, 0.012, -0.02], s);
      break;
    case 'moo_kratiam':
      add(heapGeo('mk', 0.058, 0.024, 7), heapMat(T.porkCooked(), T.porkCookedN(), 0xffe0b0, burn, 'mk'), [fx, 0.004, 0.005], s);
      add(reliefGeo('garlic_minced_pile', 0.07, 0.07, 0.012, 12), reliefMat('garlicGold' + (burn > 0.4 ? 'b' : ''), 'garlic_minced_pile', photo('garlic_minced_pile'), { rough: 0.35, color: burn > 0.4 ? 0x6a5030 : 0xffd890, clearcoat: 0.5 }), [fx, 0.022, 0], s);
      add(cucumberSlice(), cucumberMat(), [0.075, 0.0055, 0.04]); add(cucumberSlice(), cucumberMat(), [0.083, 0.008, 0.052]).rotation.set(0.15, 0.4, 0.1);
      break;
    case 'khao_phat':
      add(heapGeo('kp', 0.072, 0.036, 11, [1.1, 0.95]), heapMat(T.friedRice(), T.friedRiceN(), 0xffffff, burn, 'kp', 0.55), [0, 0.004, 0], s);
      { const lw = limeWedge(); lw.position.set(0.07, 0.022, 0.05); lw.rotation.y = 0.6; g.add(lw); }
      add(cucumberSlice(), cucumberMat(), [0.06, 0.0055, -0.06]); add(cucumberSlice(), cucumberMat(), [0.071, 0.008, -0.052]).rotation.set(-0.12, 1.1, 0.14);
      break;
    case 'phat_si_io':
    case 'rat_na': {
      add(heapGeo('nd', 0.075, 0.03, 13, [1.15, 0.95]), heapMat(T.noodles(), null, 0xffffff, burn, 'nd', 0.38), [0, 0.004, 0], s);
      for (let i = 0; i < 3; i++) add(reliefGeo('kale_leaf', 0.08, 0.08, 0.008, 10, 0.5), reliefMat('kaleCooked', 'kale_leaf', photo('kale_leaf'), { rough: 0.3, color: 0xb8d898, clearcoat: 0.6 }), [Math.cos(i * 2.1) * 0.03, 0.026 + i * 0.003, Math.sin(i * 2.1) * 0.03], s).rotation.y = i * 2.1;
      if (d.recipe === 'rat_na') {
        const gm = cachedMat('gravy', () => new THREE.MeshStandardMaterial({ color: 0x7a4a1c, transparent: true, opacity: 0.72, roughness: 0.08, depthWrite: false }));
        add(gc('gravyBlob', () => mound(0.085, 0.034, { seed: 15, detail: 2, rough: 0.12 })), gm, [0, 0.004, 0], s);
      }
      break;
    }
    case 'phat_phak_bung':
      add(heapGeo('pb', 0.075, 0.03, 17, [1.2, 0.9]), heapMat(T.greens(), null, 0xffffff, burn, 'pb', 0.32), [0, 0.004, 0], s);
      break;
    case 'tom_yam': {
      // the soup surface is a real top-down photo of a bowl of tom yum (oil sheen, herbs, chilies), glossy
      const broth = cachedMat('brothReal', () => new THREE.MeshStandardMaterial({ map: Assets.texture('textures/food/tomyum_bowl_top.png', { srgb: true, wrap: false }), roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.94 }));
      add(gc('brothDisc2', () => { const c = new THREE.CircleGeometry(0.066, 28); c.rotateX(-Math.PI / 2); return c; }), broth, [0, 0.045, 0]);
      const shrimpM = cachedMat('shrimpCooked2', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, color: 0xffffff }));
      for (let k = 0; k < 4; k++) {
        const sm = add(shrimpGeo(), shrimpM, [Math.cos(k * 1.7) * 0.034, 0.05, Math.sin(k * 1.7) * 0.034]);
        sm.rotation.set(0.2 * Math.sin(k), k * 1.9, 0.15 * Math.cos(k));
      }
      add(cards('chiliY', 2, 0.03, 0.04, 0.048, 7), cardM('chiliC', T.chiliCard()), [0, 0, 0]);
      add(cards('kaffirY', 3, 0.035, 0.045, 0.047, 8), cardM('kaffirC', T.kaleCard(), 0x7a9a5a), [0, 0, 0]);
      break;
    }
    case 'khai_jiao': {
      const om = mesh(reliefGeo('omelette_whole', 0.15, 0.15, 0.026, 18, 0.12), reliefMat('omDish' + (burn > 0.5 ? 'b' : ''), 'omelette_whole', photo('omelette_whole'), { rough: 0.42, color: burn > 0.5 ? 0x8a6040 : 0xffffff, clearcoat: 0.45 }), [0.012, 0.03, 0.0]);
      om.rotation.y = 0.4;
      g.add(om);
      break;
    }
    default: break;
  }
  // fried egg on top
  if (d.egg && d.egg !== 'none') {
    const v: EggVariant = d.egg === 'burnt' ? 'burnt' : d.egg === 'crispy' ? 'crispy' : 'runny';
    const onRice = hasRice && !bowl;
    const e = buildFriedEgg(v, 0.125, onRice ? -2.2 : 0.18);
    const rs = Math.cbrt(Math.max(0.01, d.rice ?? 0) / 200);
    e.position.set(onRice ? rx + 0.004 : 0.0, hasRice ? (bowl ? 0.05 : 0.037 * rs) : 0.004, 0.006);
    e.rotation.set(hasRice ? -0.08 : 0, 0.6, hasRice ? 0.05 : 0);
    if (d.egg === 'raw') e.scale.set(1, 0.6, 1);
    g.add(e);
  }
  // spoon & fork across the rim
  if (d.spoon && !bowl) {
    const sp = buildSpoonFork();
    sp.position.set(0.075, 0.004, 0.03);
    sp.rotation.set(0, -0.9, 0.12);
    g.add(sp);
  }
  return g;
}

function buildVessel(d: any) {
  if (d?.vessel === 'bowl') return buildBowl();
  if (d?.vessel === 'box') return buildTakeaway();
  return buildPlate(d?.plate ?? 'flora');
}

const sigOf = (d: any) => JSON.stringify([d?.recipe, d?.egg, Math.round((d?.rice ?? 0) / 20), !!d?.spoon, !!d?.bag, Math.round((d?.vis?.burn ?? 0) * 4), Math.round((d?.vis?.size ?? 1) * 4), Math.round((d?.vis?.herb ?? 1) * 2), Math.round((d?.vis?.chili ?? 0) * 2)]);

export function dishLabel(d: any): TL {
  if (!d) return tl('จานอาหาร');
  const name = RECIPES[d.recipe]?.name.th ?? 'อาหาร';
  const egg = d.egg && d.egg !== 'none' && d.recipe !== 'khai_dao' ? ' + ไข่ดาว' : '';
  const q = qualityWord(d.taste ?? 0);
  const issue = (d.issues ?? []).find((i: string) => i !== 'no_spoon' && ISSUE_TH[i]);
  const flags = [d.takeaway ? 'ใส่กล่อง' : '', d.bag ? 'ใส่ถุง' : '', d.spoon ? '' : 'ไม่มีช้อน'].filter(Boolean).join(' · ');
  return tl(`${name}${egg} · ${q}${issue ? ' (' + ISSUE_TH[issue] + ')' : ''}${flags ? ' · ' + flags : ''}`);
}

export function defineDish(game: Game) {
  game.items.define({
    kind: 'dish', name: tl('อาหาร', 'dish'), weight: 0.6, price: 0, carry: 'hand', tags: ['dish', 'food'], phys: physOf('dish'),
    data: () => ({ recipe: 'kaphrao_moo', egg: 'none', rice: 200, portion: 150, taste: 0.8, salty: 0, spicy: 0.3, sweet: 0, cooked: 0, temp: 1, issues: ['no_spoon'], vessel: 'plate', plate: 'flora', vis: {} }),
    build: (e) => {
      const g = buildVessel(e.data);
      const top = g.getObjectByName('ontop') ?? g;
      top.add(buildFood(e.data));
      if (e.data?.bag) addBag(g);
      g.userData.dsig = sigOf(e.data);
      return g;
    },
    refresh: (obj, e) => {
      const sig = sigOf(e.data);
      if (obj.userData.dsig === sig) return;
      obj.userData.dsig = sig;
      const top = obj.getObjectByName('ontop') ?? obj;
      const old = top.getObjectByName('dishfood');
      if (old) top.remove(old);
      top.add(buildFood(e.data));
      if (e.data?.bag && !obj.getObjectByName('dishbag')) addBag(obj);
      juiceKick(obj, -0.12, 0.5, -0.5);
    },
    animate: (obj, e, dt, game2) => {
      // cart yaw fix (same as other items)
      obj.rotation.set(0, e.in != null && e.at && game2.state.get(e.in)?.t === 'cart' ? (e.at[3] ?? 0) - ((e.id * 1.7) % 6.28) : 0, 0);
      const t = e.data?.temp ?? 0;
      if (FX && t > 0.42 && !e.data?.bag) {
        const p = obj.localToWorld(new THREE.Vector3(0, 0.06, 0));
        FX.rate('dish' + e.id, (t - 0.38) * 7, dt, () => FX!.steam(p, 0.45 + t * 0.3, 0.07));
      }
      // fresh off the wok: lands with a satisfying settle wobble, a puff of steam and a little sparkle
      if (!obj.userData.born) {
        obj.userData.born = true;
        if (t > 0.97) {
          juiceKick(obj, -0.32, 1.4, -0.9);
          const p = obj.localToWorld(new THREE.Vector3(0, 0.05, 0));
          const good = (e.data?.taste ?? 0) >= 0.75;
          if (FX) { FX.steamBurst(p, 5, 0.9); FX.sparkle(p, good ? 12 : 5, 0.1, good ? 0.2 : 0.6); }
          Sound.play(pickKey(['food_splat', 'food_soft']), { pos: p, vol: 0.4 });
          if (good) Sound.play(pickKey(['sparkle_chime']), { pos: p, vol: 0.35, delay: 0.12 });
        }
      }
      juice(obj, e, dt, game2, juiceOf('dish'));
    },
    label: (e) => dishLabel(e.data),
    hold: { pos: [-0.05, -0.02, -0.02], rot: [0.75, 0, 0], scale: 0.85 },
  });
}

function addBag(obj: THREE.Object3D) {
  const b = buildPlasticBag();
  b.name = 'dishbag';
  b.scale.set(1.5, 0.55, 1.5);
  obj.add(b);
}

/** HOST helper for the restaurant: turn an eaten dish back into a dirty plate/bowl (same spot). */
export function dishToDirtyPlate(game: Game, dish: Ent): Ent | null {
  const d = dish.data ?? {};
  const kind = d.vessel === 'bowl' ? 'bowl' : d.vessel === 'box' ? null : 'plate';
  const where = { holder: dish.holder, in: dish.in, at: dish.at, p: game.items.worldPos(dish), q: dish.q };
  game.items.remove(dish);
  if (!kind) return null;
  const data = kind === 'plate' ? { dirty: true, rice: 0, style: d.plate ?? 'flora' } : { dirty: true, rice: 0, egg: 0, whisk: 0, sa: {} };
  const p = where.p ?? new THREE.Vector3();
  if (where.holder != null) { const pl = game.state.get(where.holder); const e = game.items.spawn(kind, [p.x, p.y, p.z], { data, noPhysics: true }); if (e && pl && !game.items.putInInventory(pl, e)) game.items.toWorld(e, [p.x, p.y, p.z]); return e; }
  if (where.in != null) return game.items.spawn(kind, [0, 0, 0], { data, in: where.in, at: where.at ?? undefined, noPhysics: true });
  return game.items.spawn(kind, [p.x, p.y, p.z], { data, q: where.q });
}

void M; void lathe;

// ------------------------------------------------------------------ garnish (real shapes + real food photos)

/** a cucumber slice: 5 mm disc, both faces show one real slice from the photo, the edge is the dark skin */
function cucumberSlice() {
  return gc('cucSliceGeo', () => {
    const g = new THREE.CylinderGeometry(0.016, 0.016, 0.005, 16, 1, false);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, 0.42 + (p.getX(i) / 0.016) * 0.165, 0.745 - (p.getZ(i) / 0.016) * 0.165);
      else uv.setXY(i, 0.42 + Math.cos(Math.atan2(p.getZ(i), p.getX(i))) * 0.17, 0.745 + Math.sin(Math.atan2(p.getZ(i), p.getX(i))) * 0.17);
    }
    return g;
  });
}
function cucumberMat() {
  return cachedMat('cucSliceReal', () => new THREE.MeshStandardMaterial({
    map: Assets.texture('textures/food/cucumber_slices_tile.jpg', { srgb: true, wrap: false }),
    normalMap: Assets.texture('textures/food/cucumber_slices_tile_n.jpg', { srgb: false, wrap: false }),
    roughness: 0.32,
  }));
}
/** a lime wedge (1/6 of the fruit): peel outside, two cut flesh faces */
function limeWedge(): THREE.Group {
  const r = 0.019, arc = Math.PI / 3;
  const peel = gc('limePeel', () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; pts.push(new THREE.Vector2(Math.cos(a) * r * (1 + 0.04 * Math.sin(a * 3)), Math.sin(a) * r * 1.08)); }
    return new THREE.LatheGeometry(pts, 8, 0, arc);
  });
  const face = gc('limeFace', () => {
    const half = new THREE.CircleGeometry(r * 0.95, 12, -Math.PI / 2, Math.PI);
    half.scale(1, 1.08, 1);
    const a = half.clone().rotateY(-Math.PI / 2);                        // the face at phi = 0 (lathe profile plane)
    const b = half.clone().rotateY(-Math.PI / 2).rotateY(arc);           // the face at phi = arc
    const out = new THREE.BufferGeometry();
    const merged = [a.toNonIndexed(), b.toNonIndexed()];
    const pos = new Float32Array(merged.reduce((k, gg) => k + gg.getAttribute('position').array.length, 0));
    let o = 0; for (const gg of merged) { pos.set(gg.getAttribute('position').array as Float32Array, o); o += gg.getAttribute('position').array.length; }
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  });
  const g = new THREE.Group();
  g.add(mesh(peel, cachedMat('limePeelM', () => new THREE.MeshStandardMaterial({ color: 0x4f8a22, roughness: 0.5 }))));
  g.add(mesh(face, cachedMat('limeFleshM', () => new THREE.MeshStandardMaterial({ color: 0xd4e69a, roughness: 0.18, emissive: new THREE.Color(0x2a3a10), emissiveIntensity: 0.25, side: THREE.DoubleSide }))));
  g.rotation.set(0, 0, Math.PI / 2);                                       // lying on its peel
  return g;
}
/** cooked shrimp: curled, tapering body with white/orange segment bands and a fanned tail */
function shrimpGeo() {
  return gc('shrimpCurled', () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 1.25; pts.push(new THREE.Vector3(Math.cos(a) * 0.012, 0, Math.sin(a) * 0.012)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const TS = 18, RS = 8;
    const g = new THREE.TubeGeometry(curve, TS, 1, RS, false);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let ring = 0; ring <= TS; ring++) {
      const t = ring / TS, c = curve.getPointAt(t);
      const rad = 0.0062 * (1 - 0.62 * t) * (t < 0.06 ? 0.6 + t * 6 : 1);
      const band = (ring % 3 === 0) ? [0.98, 0.86, 0.74] : [0.95, 0.45, 0.24];
      for (let k = 0; k <= RS; k++) {
        const i = ring * (RS + 1) + k;
        const dx = p.getX(i) - c.x, dy = p.getY(i) - c.y, dz = p.getZ(i) - c.z;
        p.setXYZ(i, c.x + dx * rad, c.y + dy * rad * 1.15, c.z + dz * rad);
        const back = dy > 0 ? 1 : 0.86;                                   // back darker than the belly
        col.set([band[0] * back, band[1] * back, band[2] * back], i * 3);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    // tail fan at the thin end
    const end = curve.getPointAt(1), tan = curve.getTangentAt(1);
    const tail = new THREE.ConeGeometry(0.0055, 0.011, 6).scale(1, 1, 0.3);
    tail.lookAt(tan); tail.rotateX(Math.PI / 2);
    tail.translate(end.x + tan.x * 0.004, end.y, end.z + tan.z * 0.004);
    const tc = new Float32Array(tail.getAttribute('position').count * 3); for (let i = 0; i < tc.length; i += 3) tc.set([0.85, 0.22, 0.12], i);
    tail.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    const a = g.toNonIndexed(), b = tail.toNonIndexed();
    for (const x of [a, b]) for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'color'].includes(k)) x.deleteAttribute(k);
    const out = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color']) {
      const A2 = a.getAttribute(k).array as Float32Array, B2 = b.getAttribute(k).array as Float32Array;
      const m = new Float32Array(A2.length + B2.length); m.set(A2); m.set(B2, A2.length);
      out.setAttribute(k, new THREE.BufferAttribute(m, 3));
    }
    return out;
  });
}
