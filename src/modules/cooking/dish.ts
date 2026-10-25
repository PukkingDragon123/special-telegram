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
      add(gc('cuc', () => { const c = new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10); return c; }), cachedMat('cucSlice', () => new THREE.MeshStandardMaterial({ color: 0xd8e8b0, roughness: 0.4 })), [0.075, 0.005, 0.04]);
      break;
    case 'khao_phat':
      add(heapGeo('kp', 0.072, 0.036, 11, [1.1, 0.95]), heapMat(T.friedRice(), T.friedRiceN(), 0xffffff, burn, 'kp', 0.55), [0, 0.004, 0], s);
      add(gc('lime', () => { const l = new THREE.SphereGeometry(0.018, 8, 6, 0, Math.PI); l.rotateX(-Math.PI / 2); return l; }), cachedMat('limeWedge', () => new THREE.MeshStandardMaterial({ color: 0x8ac040, roughness: 0.35 })), [0.07, 0.006, 0.05]);
      add(gc('cuc', () => new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10)), cachedMat('cucSlice', () => new THREE.MeshStandardMaterial({ color: 0xd8e8b0, roughness: 0.4 })), [0.06, 0.005, -0.06]);
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
      const broth = cachedMat('broth', () => new THREE.MeshStandardMaterial({ color: 0xd8642a, transparent: true, opacity: 0.86, roughness: 0.06, metalness: 0.05 }));
      add(gc('brothDisc', () => { const c = new THREE.CircleGeometry(0.066, 20); c.rotateX(-Math.PI / 2); return c; }), broth, [0, 0.045, 0]);
      add(gc('shrimpBits', () => scatter(dent(new THREE.TorusGeometry(0.012, 0.006, 5, 8, Math.PI * 1.3), 0.002, 40, 3), 5, (i, m, rr) => {
        m.makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + (rr() - 0.5) * 0.4, rr() * 6.28, 0));
        m.setPosition((rr() - 0.5) * 0.08, 0.047, (rr() - 0.5) * 0.08);
      }, 5)), cachedMat('shrimpCooked', () => new THREE.MeshStandardMaterial({ color: 0xf08a5a, roughness: 0.4 })), [0, 0, 0]);
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
