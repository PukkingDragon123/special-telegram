import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { ItemDef } from '../../game/items';
import { tl, damp, TL } from '../../core/util';
import { Sound } from '../../core/audio';
import { ING, TOOL_META } from './data';
import { T } from './assets';
import { M } from './mats';
import {
  buildMeatTray, buildBasil, buildChiliBag, buildGarlic, buildLongBeans, buildKale, buildBundle, buildPile, buildEgg, buildEggTray,
  buildBottle, buildPacket, buildPasteBag, buildCucumbers, buildMushrooms, buildKaffir, buildGalangal, buildNoodleBag, BottleSpec, foodPhoto,
} from './models';
import {
  buildWok, buildFoodLayers, setFoodSet, FoodLayers, HeapKind, wokY, WOK_R, WOK_D, buildSpatula, buildLadle, buildCleaver, buildRicePaddle,
  buildSpoonFork, buildBoard, buildMortar, buildPlate, buildBowl, buildTakeaway, buildPlasticBag, buildRicePot, buildGasTank, buildBook, setFriedVariant,
} from './models-tools';
import type { WokData } from './recipes';
import { cookParams } from './recipes';
import { pickKey, clamp01 } from './util';
import type { CookFX } from './fx';
import { juice, juiceKick, JP, JuiceKind } from './juice';
import { riceMoundGeoReal, riceMatReal, leafMat, chiliMat, reliefGeo, reliefMat } from './realfood';

/* ---- juice (squash/stretch/jiggle + impact sound/bits) and Rapier tuning per item kind ---- */

const JUICE: Record<string, JuiceKind> = {
  pork_minced: 'meat', chicken_minced: 'meat', pork_sliced: 'meat', shrimp: 'shrimp',
  holy_basil: 'herb', kaffir_lime: 'herb', spring_onion: 'herb', morning_glory: 'herb', kale: 'herb',
  long_beans: 'veg', lemongrass: 'veg', cucumber: 'veg', mushroom: 'veg',
  chili: 'chili', garlic: 'bulb', onion: 'bulb', lime: 'bulb', tomato: 'bulb', galangal: 'bulb',
  egg: 'egg', egg_tray: 'eggTray',
  sugar: 'packet', msg: 'packet', gravy_starch: 'packet', noodles_wide: 'packet', rice_bag: 'sack',
  spatula: 'metal', ladle: 'metal', cleaver: 'metal', spoon_fork: 'metal', rice_paddle: 'plastic',
  chopping_board: 'wood', mortar: 'clay', wok: 'wok', plate: 'plate', bowl: 'plate', takeaway_box: 'foam', plastic_bag: 'paper',
  rice_pot: 'appliance', recipe_book: 'paper', dish: 'dish',
};
type Phys = NonNullable<ItemDef['phys']>;
const PHYS: Partial<Record<JuiceKind, Phys>> = {
  meat: { restitution: 0.03, friction: 0.95, linDamp: 0.12, angDamp: 1.3 },
  shrimp: { restitution: 0.04, friction: 0.9, linDamp: 0.12, angDamp: 1.2 },
  herb: { restitution: 0.05, friction: 0.9, linDamp: 0.9, angDamp: 2.2 },
  veg: { restitution: 0.12, friction: 0.8, linDamp: 0.3, angDamp: 1.0 },
  chili: { restitution: 0.58, friction: 0.45, linDamp: 0.08, angDamp: 0.25, bouncy: true },
  bulb: { restitution: 0.36, friction: 0.55, linDamp: 0.06, angDamp: 0.35, bouncy: true },
  egg: { restitution: 0.24, friction: 0.35, linDamp: 0.05, angDamp: 0.55, bouncy: true },
  eggTray: { restitution: 0.06, friction: 0.85, linDamp: 0.1, angDamp: 1.0 },
  glass: { restitution: 0.18, friction: 0.45, linDamp: 0.05, angDamp: 0.35 },
  plastic: { restitution: 0.36, friction: 0.5, linDamp: 0.05, angDamp: 0.3, bouncy: true },
  packet: { restitution: 0.03, friction: 0.95, linDamp: 0.15, angDamp: 1.4 },
  sack: { restitution: 0.0, friction: 1.0, linDamp: 0.25, angDamp: 2.5 },
  metal: { restitution: 0.32, friction: 0.4, linDamp: 0.05, angDamp: 0.3, bouncy: true },
  wok: { restitution: 0.12, friction: 0.55, linDamp: 0.05, angDamp: 0.5 },
  plate: { restitution: 0.3, friction: 0.4, linDamp: 0.05, angDamp: 0.4, bouncy: true },
  foam: { restitution: 0.2, friction: 0.7, linDamp: 0.4, angDamp: 0.8 },
  wood: { restitution: 0.15, friction: 0.7, linDamp: 0.05, angDamp: 0.6 },
  clay: { restitution: 0.04, friction: 0.9, linDamp: 0.05, angDamp: 1.2 },
  dish: { restitution: 0.06, friction: 0.85, linDamp: 0.1, angDamp: 0.9 },
  paper: { restitution: 0.05, friction: 0.8, linDamp: 0.8, angDamp: 1.5 },
  appliance: { restitution: 0.05, friction: 0.8, linDamp: 0.05, angDamp: 1.0 },
};
export function juiceOf(kind: string, tags?: string[]) {
  const j = JUICE[kind] ?? (tags?.includes('sauce') ? (tags.includes('glass') ? 'glass' : 'plastic') : undefined);
  return j ? JP[j] : undefined;
}
export function physOf(kind: string, tags?: string[]): Phys | undefined {
  const j = JUICE[kind] ?? (tags?.includes('sauce') ? (tags.includes('glass') ? 'glass' : 'plastic') : undefined);
  return j ? PHYS[j] : undefined;
}

/* =============================================================================================
 * ITEM KINDS owned by the cooking module: ingredients (data.g / data.ml), tools, vessels.
 * ============================================================================================= */

/** Local (immediate) action flags for snappy viewmodel feedback: itemId → act. */
export const localAct = new Map<number, string>();
export const amountOf = (e: Ent | null | undefined) => (e?.data?.g ?? e?.data?.ml ?? 0) as number;
export const unitOf = (k: string) => ING[k]?.unit ?? 'g';

let FX: CookFX | null = null;
export function setItemFX(fx: CookFX) { FX = fx; }

type AnimFn = (obj: THREE.Object3D, e: Ent, dt: number, game: Game, act: string | undefined, st: any) => void;

/** Shared animate: cart yaw fix (items on carts keep their placed yaw) + pour tilt + per-kind anim. */
function anim(extra?: AnimFn): ItemDef['animate'] {
  return (obj, e, dt, game) => {
    const st = (obj.userData.st ??= { tilt: 0, t: Math.random() * 10, snd: 0, ph: 0 });
    st.t += dt;
    let baseYaw = 0;
    if (e.in != null && e.at) {
      const c = game.state.get(e.in);
      if (c?.t === 'cart') baseYaw = (e.at[3] ?? 0) - ((e.id * 1.7) % 6.28);
    }
    const act = localAct.get(e.id) ?? e.act;
    const pouring = act === 'pour' && e.holder != null;
    st.tilt += ((pouring ? 1 : 0) - st.tilt) * damp(pouring ? 10 : 7, dt);
    obj.rotation.set(0, baseYaw, 0);
    obj.position.set(0, 0, 0);
    if (st.tilt > 0.002) {
      obj.rotation.z = -1.95 * st.tilt;
      obj.position.set(-0.05 * st.tilt, 0.09 * st.tilt, 0);
    }
    if (pouring) {
      st.snd -= dt;
      if (st.snd <= 0) {
        const def = ING[e.k];
        const keys = def?.snd ?? ['sauce_glug'];
        const k = pickKey(keys);
        st.snd = k === 'oil_pour' ? 1.4 : k === 'sprinkle' ? 0.45 : k === 'sauce_glug' ? 0.7 : 0.55;
        Sound.play(k, { pos: obj.getWorldPosition(new THREE.Vector3()), vol: 0.55 });
      }
    }
    extra?.(obj, e, dt, game, act, st);
    if (st.jp === undefined) st.jp = juiceOf(e.k, game.items.def(e.k)?.tags) ?? false;
    if (st.jp) juice(obj, e, dt, game, st.jp);
  };
}

const heapScale = (e: Ent, full: number, min = 0.18) => {
  const a = amountOf(e);
  return a <= 0.01 ? 0 : Math.max(min, Math.min(1.15, Math.sqrt(a / full)));
};

function refreshHeap(full: number) {
  return (obj: THREE.Object3D, e: Ent) => {
    const h = obj.getObjectByName('heap');
    if (!h) return;
    const s = heapScale(e, full);
    h.visible = s > 0;
    if (s > 0) h.scale.set(s, Math.max(0.35, s), s);
    (h.userData.bs ??= new THREE.Vector3()).copy(h.scale);
  };
}

function refreshLiquid(full: number) {
  return (obj: THREE.Object3D, e: Ent) => {
    const l = obj.getObjectByName('liquid');
    if (!l) return;
    const f = Math.max(0, Math.min(1, amountOf(e) / full));
    l.visible = f > 0.01;
    l.scale.set(1, Math.max(0.03, f), 1);
  };
}

const lbl = (name: string) => (e: Ent): TL => {
  const a = amountOf(e);
  const u = unitOf(e.k) === 'ml' ? 'มล.' : 'ก.';
  return tl(a > 0.4 ? `${name} ${Math.round(a)} ${u}` : `${name} (หมดแล้ว)`);
};

// ------------------------------------------------------------------ hold poses (first-person viewmodel)

const HOLD = {
  bottle: { pos: [0.02, -0.08, 0] as [number, number, number], rot: [0.05, -0.4, 0] as [number, number, number], scale: 0.85 },
  jar: { pos: [0.02, -0.04, 0] as [number, number, number], rot: [0.1, -0.4, 0] as [number, number, number], scale: 1 },
  tray: { pos: [-0.02, -0.02, 0.02] as [number, number, number], rot: [0.75, -0.35, 0] as [number, number, number], scale: 0.95 },
  bunch: { pos: [-0.02, -0.02, 0.02] as [number, number, number], rot: [0.9, -0.3, 0] as [number, number, number], scale: 0.85 },
  bag: { pos: [0, -0.04, 0] as [number, number, number], rot: [0.5, -0.4, 0] as [number, number, number], scale: 1 },
  packet: { pos: [0, -0.1, 0] as [number, number, number], rot: [0.2, -0.45, 0] as [number, number, number], scale: 0.8 },
  egg: { pos: [-0.02, 0.0, 0.05] as [number, number, number], rot: [0.3, 0, 0] as [number, number, number], scale: 1.4 },
  tool: { pos: [-0.04, -0.03, 0.08] as [number, number, number], rot: [0.25, 0.25, -0.15] as [number, number, number], scale: 0.85 },
  wok: { pos: [-0.06, -0.06, -0.06] as [number, number, number], rot: [0.55, -2.3, 0] as [number, number, number], scale: 0.55 },
  plate: { pos: [-0.05, -0.02, -0.02] as [number, number, number], rot: [0.75, 0, 0] as [number, number, number], scale: 0.85 },
  big: { pos: [-0.08, -0.12, -0.1] as [number, number, number], rot: [0.35, -0.5, 0] as [number, number, number], scale: 0.55 },
  book: { pos: [-0.04, -0.02, 0.04] as [number, number, number], rot: [0.95, -0.25, 0.05] as [number, number, number], scale: 0.9 },
};

// ------------------------------------------------------------------ definitions

const BOTTLES: Record<string, BottleSpec & { hold?: keyof typeof HOLD }> = {
  cooking_oil: { h: 0.3, r: 0.042, neck: 0.016, shape: 'pet', labelY: 0.48, liquid: 0xe8b830, glass: 0xfff6d0, glassOpacity: 0.32, cap: 0x1d7a3a },
  oyster_sauce: { h: 0.255, r: 0.038, neck: 0.015, labelY: 0.32, liquid: 0x2a170c, glass: 0x3a2a1a, glassOpacity: 0.55, cap: 0xb5121b },
  soy_light: { h: 0.27, r: 0.035, neck: 0.014, labelY: 0.33, liquid: 0x3a1c08, glass: 0x5a3a20, glassOpacity: 0.45, cap: 0xf2d22e },
  soy_dark: { h: 0.26, r: 0.038, neck: 0.015, shape: 'pet', labelY: 0.4, liquid: 0x0e0806, glass: 0x221410, glassOpacity: 0.6, cap: 0xc8161d },
  fish_sauce: { h: 0.29, r: 0.0375, neck: 0.015, shape: 'pet', labelY: 0.42, liquid: 0x9a4a12, glass: 0xffe0b0, glassOpacity: 0.3, cap: 0xf2f2f2 },
  seasoning_sauce: { h: 0.245, r: 0.036, neck: 0.014, labelY: 0.36, liquid: 0x2a140a, glass: 0x3a2a1a, glassOpacity: 0.5, cap: 0x1f8a3c },
  white_pepper: { h: 0.13, r: 0.0275, shape: 'shaker', labelY: 0.42, liquid: 0xe8e2d2, glass: 0xffffff, glassOpacity: 0.3, cap: 0x1d5a3a, capH: 0.022, hold: 'jar' },
  chili_flakes: { h: 0.115, r: 0.0275, shape: 'shaker', labelY: 0.42, liquid: 0xa82a14, glass: 0xffffff, glassOpacity: 0.3, cap: 0xc8161d, capH: 0.022, hold: 'jar' },
  tomyum_paste: { h: 0.105, r: 0.035, shape: 'jar', labelY: 0.45, labelH: 0.045, liquid: 0x8a240c, glass: 0xffffff, glassOpacity: 0.25, cap: 0x2a50a8, hold: 'jar' },
  curry_paste: { h: 0.11, r: 0.054, shape: 'jar', labelY: 0.5, labelH: 0.09, liquid: 0xa8341c, glass: 0xffffff, glassOpacity: 0.2, cap: 0xf4f4f0, capH: 0.012, hold: 'jar' },
  water_jug: { h: 0.32, r: 0.045, neck: 0.015, shape: 'pet', labelY: 0.45, labelH: 0.07, liquid: 0xd8ecf2, glass: 0xe8f6ff, glassOpacity: 0.25, cap: 0x5ab0e8 },
};

export function defineCookingItems(game: Game) {
  const items = game.items;
  const def = (d: ItemDef) => {
    if (items.def(d.kind) && d.kind === 'plastic_bag') return; // shops may own it
    if (!d.phys) d.phys = physOf(d.kind, d.tags);
    items.define(d);
  };
  const ingBase = (k: string) => {
    const g = ING[k];
    return {
      kind: k, name: g.name, weight: g.weight, price: g.price, carry: 'hand' as const,
      tags: ['ingredient', ...(g.tags ?? [])],
      data: () => (g.unit === 'ml' ? { ml: g.amount } : { g: g.amount }),
      label: lbl(g.name.th),
    };
  };

  // ---- bottles & jars
  for (const [k, spec] of Object.entries(BOTTLES)) {
    const g = ING[k];
    def({
      ...ingBase(k),
      tags: ['ingredient', 'sauce', spec.glassOpacity && spec.glassOpacity > 0.4 ? 'glass' : 'plastic', ...(g.tags ?? [])],
      build: () => buildBottle(k, spec),
      shape: { type: 'cyl', r: spec.r * 1.02, h: spec.h + (spec.capH ?? 0.02) },
      refresh: refreshLiquid(g.amount),
      animate: anim(),
      hold: HOLD[spec.hold ?? 'bottle'],
    });
  }
  // ---- packets / bags (real packaging photo on the front)
  def({ ...ingBase('sugar'), tags: ['ingredient', 'seasoning', 'bag'], build: () => buildPacket('sugar', 0.13, 0.26, 0.07, { clear: true, filling: M.plasticRough(0xfbfaf6) }), animate: anim(), hold: HOLD.packet });
  def({ ...ingBase('msg'), tags: ['ingredient', 'seasoning', 'bag'], build: () => buildPacket('msg', 0.16, 0.19, 0.05), animate: anim(), hold: HOLD.packet });
  def({ ...ingBase('gravy_starch'), tags: ['ingredient', 'seasoning', 'bag'], build: () => buildPacket('gravy_starch', 0.13, 0.2, 0.05), animate: anim(), hold: HOLD.packet });
  def({ ...ingBase('rice_bag'), carry: 'underarm', tags: ['ingredient', 'starch', 'bag', 'heavy'], build: () => buildPacket('rice_bag', 0.3, 0.44, 0.12, { body: M.plasticRough(0xf6f2e2) }), animate: anim(), hold: HOLD.big });
  def({ ...ingBase('noodles_wide'), tags: ['ingredient', 'starch', 'bag'], build: () => buildNoodleBag(), refresh: refreshHeap(500), animate: anim(), hold: HOLD.tray });
  // ---- meat trays
  for (const k of ['pork_minced', 'chicken_minced', 'pork_sliced', 'shrimp']) {
    def({ ...ingBase(k), build: () => buildMeatTray(k), refresh: refreshHeap(ING[k].amount), animate: anim(), hold: HOLD.tray });
  }
  // ---- produce
  def({ ...ingBase('holy_basil'), build: () => buildBasil(), refresh: refreshHeap(100), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('chili'), build: () => buildChiliBag(), refresh: refreshHeap(100), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('garlic'), build: () => buildGarlic(), refresh: refreshHeap(200), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('long_beans'), build: () => buildLongBeans(), refresh: refreshHeap(250), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('kale'), build: () => buildKale(), refresh: refreshHeap(250), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('morning_glory'), build: () => buildBundle('morning_glory'), refresh: refreshHeap(300), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('spring_onion'), build: () => buildBundle('spring_onion'), refresh: refreshHeap(80), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('lemongrass'), build: () => buildBundle('lemongrass'), refresh: refreshHeap(150), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('onion'), build: () => buildPile('onion', 4), refresh: refreshPile(300, 4), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('tomato'), build: () => buildPile('tomato', 5), refresh: refreshPile(250, 5), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('lime'), build: () => buildPile('lime', 3), refresh: refreshPile(45, 3), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('galangal'), build: () => buildGalangal(), refresh: refreshHeap(120), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('kaffir_lime'), build: () => buildKaffir(), refresh: refreshHeap(30), animate: anim(), hold: HOLD.bunch });
  def({ ...ingBase('mushroom'), build: () => buildMushrooms(), refresh: refreshHeap(200), animate: anim(), hold: HOLD.bag });
  def({ ...ingBase('cucumber'), build: () => buildCucumbers(), refresh: refreshHeap(300), animate: anim(), hold: HOLD.bag });
  // ---- eggs
  def({ kind: 'egg', name: tl('ไข่ไก่', 'egg'), weight: 0.06, price: 5, carry: 'hand', tags: ['ingredient', 'egg'], pickRadius: 0.1, build: (e) => buildEgg(e?.id ?? 0), animate: anim(), hold: HOLD.egg, data: () => ({}), shape: { type: 'ball', r: 0.025 } });
  def({
    kind: 'egg_tray', name: TOOL_META.egg_tray.name, weight: 1.9, price: 130, carry: 'twohand', tags: ['ingredient', 'egg'],
    data: () => ({ n: 10 }), build: () => buildEggTray(),
    refresh: (obj, e) => { const eg = obj.getObjectByName('eggs'); eg?.children.forEach((c, i) => (c.visible = i < (e.data?.n ?? 0))); },
    label: (e) => tl(`แผงไข่ (${e.data?.n ?? 0} ฟอง)`), animate: anim(), hold: HOLD.tray,
  });

  // ---- tools
  const tool = (kind: string, build: () => THREE.Object3D, extra: Partial<ItemDef> = {}) => def({
    kind, name: TOOL_META[kind].name, weight: TOOL_META[kind].weight, price: TOOL_META[kind].price, carry: 'hand', tags: ['tool', 'metal'],
    build, animate: anim(), hold: HOLD.tool, ...extra,
  });
  tool('spatula', buildSpatula, { animate: anim(stirAnim), tags: ['tool', 'metal', 'stirrer'] });
  tool('ladle', buildLadle, { animate: anim(stirAnim), tags: ['tool', 'metal', 'stirrer'] });
  tool('cleaver', buildCleaver, { animate: anim(chopAnim), tags: ['tool', 'metal', 'knife'] });
  tool('rice_paddle', buildRicePaddle, { tags: ['tool', 'plastic'] });
  tool('spoon_fork', buildSpoonFork, { tags: ['tool', 'metal', 'cutlery'], pickRadius: 0.1, hold: { pos: [-0.02, 0, 0.06], rot: [0.5, 0.2, 0], scale: 1.1 } });
  def({
    kind: 'chopping_board', name: TOOL_META.chopping_board.name, weight: 2.4, price: 320, carry: 'twohand', tags: ['tool', 'wood', 'board'],
    data: () => ({ it: {}, chop: 0 }), build: () => buildBoard(), refresh: refreshBoard, animate: anim(), hold: HOLD.plate,
    label: (e) => contentsLabel('เขียง', e.data?.it, e.data?.chop, 'หั่น'),
  });
  def({
    kind: 'mortar', name: TOOL_META.mortar.name, weight: 3.2, price: 150, carry: 'twohand', tags: ['tool', 'clay', 'mortar'],
    data: () => ({ it: {}, pound: 0 }), build: () => buildMortar(), refresh: refreshMortar, animate: anim(mortarAnim), hold: HOLD.big,
    label: (e) => contentsLabel('ครก', e.data?.it, e.data?.pound, 'ตำ'),
  });
  def({
    kind: 'wok', name: TOOL_META.wok.name, weight: 2.2, price: 350, carry: 'hand', tags: ['tool', 'metal', 'burner', 'vessel'],
    data: () => ({ T: 28, oil: 0, w: 0, it: {}, sa: {} }), build: () => { const o = buildWok(); return o; },
    refresh: (obj, e) => wokRefresh(obj, e), animate: anim(wokAnim), hold: HOLD.wok,
    label: (e) => wokLabel(e.data),
  });
  // ---- vessels
  def({
    kind: 'plate', name: TOOL_META.plate.name, weight: 0.25, price: 35, carry: 'hand', tags: ['vessel', 'plate', 'stack'],
    data: () => ({ dirty: false, rice: 0, style: 'flora' }), build: (e) => buildPlate(e.data?.style ?? 'flora'), shape: { type: 'cyl', r: 0.12, h: 0.024 },
    refresh: (obj, e) => refreshVesselRice(obj, e), animate: anim(), hold: HOLD.plate,
    label: (e) => tl(e.data?.dirty ? 'จานสกปรก' : (e.data?.rice ?? 0) > 1 ? `จาน (ข้าว ${Math.round(e.data.rice)} ก.)` : 'จานเปล่า'),
  });
  def({
    kind: 'bowl', name: TOOL_META.bowl.name, weight: 0.32, price: 45, carry: 'hand', tags: ['vessel', 'bowl', 'stack'],
    data: () => ({ dirty: false, rice: 0, egg: 0, whisk: 0, sa: {} }), build: () => buildBowl(), shape: { type: 'cyl', r: 0.078, h: 0.076 },
    refresh: (obj, e) => refreshBowl(obj, e), animate: anim(), hold: HOLD.plate,
    label: (e) => bowlLabel(e.data),
  });
  def({
    kind: 'takeaway_box', name: TOOL_META.takeaway_box.name, weight: 0.03, price: 3, carry: 'hand', tags: ['vessel', 'box', 'stack', 'takeaway'],
    data: () => ({ rice: 0 }), build: () => buildTakeaway(), refresh: (obj, e) => refreshVesselRice(obj, e), animate: anim(), hold: HOLD.plate,
    label: (e) => tl((e.data?.rice ?? 0) > 1 ? `กล่องข้าว (ข้าว ${Math.round(e.data.rice)} ก.)` : 'กล่องข้าวเปล่า'),
  });
  def({ kind: 'plastic_bag', name: TOOL_META.plastic_bag.name, weight: 0.01, price: 1, carry: 'hand', tags: ['takeaway', 'bag'], build: () => buildPlasticBag(), animate: anim(), hold: HOLD.bag });
  // ---- appliances
  def({
    kind: 'rice_pot', name: TOOL_META.rice_pot.name, weight: 5.5, price: 1500, carry: 'twohand', slots: 2, tags: ['appliance', 'pot', 'metal'],
    data: () => ({ g: 0, raw: 0, water: 0, cook: 0, on: false, q: 1, wet: 0 }), build: () => buildRicePot(),
    refresh: (obj, e) => refreshRicePot(obj, e), animate: anim(ricePotAnim), hold: HOLD.big,
    label: (e) => ricePotLabel(e.data),
  });
  def({
    kind: 'gas_tank', name: TOOL_META.gas_tank.name, weight: 18, price: 450, carry: 'twohand', slots: 2, tags: ['heavy', 'metal'],
    data: () => ({ gas: 1 }), build: () => buildGasTank(), animate: anim(), hold: HOLD.big,
    label: (e) => tl(`ถังแก๊ส (${Math.round((e.data?.gas ?? 0) * 100)}%)`),
  });
  def({
    kind: 'recipe_book', name: TOOL_META.recipe_book.name, weight: 0.3, price: 0, carry: 'hand', tags: ['book'],
    data: () => ({ page: 0 }), build: () => buildBook(), animate: anim(bookAnim), hold: HOLD.book,
  });
}

// ------------------------------------------------------------------ per-kind refresh / anim

function refreshPile(full: number, max: number) {
  return (obj: THREE.Object3D, e: Ent) => {
    const h = obj.getObjectByName('heap');
    if (!h) return;
    const n = Math.ceil(Math.min(1, amountOf(e) / full) * max - 0.01);
    h.children.forEach((c, i) => { if (c.name.startsWith('p')) c.visible = i < n; });
  };
}

function stirAnim(obj: THREE.Object3D, e: Ent, _dt: number, game: Game, act: string | undefined, st: any) {
  if (act !== 'stir' || e.holder == null) return;
  const t = st.t * 9;
  obj.rotation.x = Math.sin(t) * 0.45 + 0.3;
  obj.rotation.z = Math.cos(t * 0.5) * 0.25;
  obj.position.set(Math.cos(t * 0.5) * 0.04, -0.02 + Math.abs(Math.sin(t)) * 0.02, Math.sin(t) * 0.05);
  const ph = Math.floor(t / Math.PI);
  if (ph !== st.ph) { st.ph = ph; Sound.play(pickKey(['spatula_scrape', 'metal_scrape']), { pos: obj.getWorldPosition(new THREE.Vector3()), vol: 0.45 }); }
  void game;
}

function chopAnim(obj: THREE.Object3D, e: Ent, _dt: number, _game: Game, act: string | undefined, st: any) {
  if (act !== 'chop' || e.holder == null) return;
  const t = st.t * 11;
  const k = Math.abs(Math.sin(t));
  obj.position.y = k * 0.09;
  obj.rotation.x = -k * 0.55;
  const ph = Math.floor(t / Math.PI);
  if (ph !== st.ph) { st.ph = ph; Sound.play(pickKey(['knife_chop_board', 'chop']), { pos: obj.getWorldPosition(new THREE.Vector3()), vol: 0.6 }); }
}

function mortarAnim(obj: THREE.Object3D, e: Ent, _dt: number, _game: Game, act: string | undefined, st: any) {
  const pestle = obj.getObjectByName('pestle');
  if (!pestle) return;
  if (act === 'pound') {
    const t = st.t * 8.5;
    const k = Math.abs(Math.sin(t));
    pestle.position.set(0, 0.045 + k * 0.13, 0);
    pestle.rotation.set(0, 0, -0.08);
    const ph = Math.floor(t / Math.PI);
    if (ph !== st.ph) { st.ph = ph; Sound.play(pickKey(['mortar_pound', 'thud']), { pos: obj.getWorldPosition(new THREE.Vector3()), vol: 0.7 }); }
  } else { pestle.position.set(0.02, 0.045, 0); pestle.rotation.set(0, 0, -0.55); }
}

function ricePotAnim(obj: THREE.Object3D, e: Ent, dt: number, _game: Game, _act: string | undefined, st: any) {
  const lid = obj.getObjectByName('lid');
  const on = !!e.data?.on;
  if (lid) lid.rotation.x += ((on ? 0 : -1.75) - lid.rotation.x) * damp(6, dt);
  const lamp = obj.getObjectByName('lamp') as THREE.Mesh | undefined;
  if (lamp) lamp.visible = on || (e.data?.g ?? 0) > 0;
  if (FX && (on || (e.data?.g ?? 0) > 50)) {
    const p = obj.localToWorld(new THREE.Vector3(0, on ? 0.31 : 0.24, on ? 0 : 0.02));
    FX.rate('rp' + e.id, on ? 5 : 1.2, dt, () => FX!.steam(p, on ? 0.9 : 0.6, 0.12));
  }
  void st;
}

function bookAnim(obj: THREE.Object3D, e: Ent, dt: number, game: Game) {
  const cover = obj.getObjectByName('cover');
  if (!cover) return;
  const pl = e.holder != null ? game.state.get(e.holder) : null;
  const open = pl?.mode === 'book';
  cover.rotation.z += ((open ? Math.PI * 0.92 : 0) - cover.rotation.z) * damp(7, dt);
}

// ------------------------------------------------------------------ board / mortar / bowl / vessels

const BOARD_VIS: Record<string, THREE.Texture | (() => THREE.Texture)> = {};
const boardMats = new Map<string, THREE.Material>();
function boardMat(k: string) {
  let m = boardMats.get(k);
  if (!m) {
    const tex = k === 'long_beans' ? T.beansCut() : k === 'onion' ? T.onionCard() : k === 'kale' || k === 'morning_glory' ? T.kaleCard() : k === 'chili' ? T.chiliCard() : k === 'garlic' ? T.garlicMinced() : k === 'tomato' ? T.chiliCard() : k === 'pork_sliced' ? T.porkRaw() : T.beansCut();
    const tile = k === 'long_beans' || k === 'pork_sliced';
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, alphaTest: tile ? 0 : 0.42, side: THREE.DoubleSide, color: k === 'tomato' ? 0xff8070 : k === 'spring_onion' ? 0xa8ff90 : k === 'lemongrass' ? 0xe8f0b0 : 0xffffff });
    boardMats.set(k, m);
  }
  return m;
}
void BOARD_VIS;

function refreshBoard(obj: THREE.Object3D, e: Ent) {
  const top = obj.getObjectByName('chopped');
  if (!top) return;
  for (const c of [...top.children]) top.remove(c);
  const it: Record<string, { g: number }> = e.data?.it ?? {};
  const chop = e.data?.chop ?? 0;
  let i = 0;
  for (const [k, v] of Object.entries(it)) {
    if (!v || v.g < 0.5) continue;
    const s = Math.min(1, Math.sqrt(v.g / 120));
    const rel = boardRelief(k, chop);
    if (rel) {
      // real photo relief of the (chopped) ingredient, piling up as it is cut
      const m = new THREE.Mesh(reliefGeo(rel, 0.13, 0.13, 0.016, 14), reliefMat('board:' + rel, rel, foodPhoto(rel), { rough: 0.45, sss: k === 'garlic' ? undefined : { color: k === 'chili' ? 0xff3a1a : 0x8ad84a, wrap: 0.4, back: 0.4 } }));
      const sc = 0.55 + s * 0.6 + chop * 0.25;
      m.scale.set(sc, 0.7 + s * 0.5, sc);
      m.position.set((i % 2 ? 1 : -1) * 0.03 * (i > 0 ? 1 : 0), 0.002 + i * 0.004, 0.012 * i);
      m.rotation.y = i * 1.3 + chop * 2;
      top.add(m);
    } else if (chop < 0.25 && (k === 'long_beans')) {
      // still whole: the real bundle photo
      const m = new THREE.Mesh(boardCard(0.28), new THREE.MeshStandardMaterial({ map: T.beansCard(), alphaTest: 0.42, side: THREE.DoubleSide }));
      m.scale.setScalar(0.6 + s * 0.4);
      m.position.set(0, 0.006 + i * 0.006, 0);
      top.add(m);
    } else {
      const spread = 0.06 + chop * 0.05;
      const m = new THREE.Mesh(boardCard(0.1 + s * 0.08), boardMat(k));
      m.position.set((i % 2 ? 1 : -1) * spread * 0.5 * (i > 0 ? 1 : 0), 0.006 + i * 0.006, 0.01 * i);
      m.rotation.y = i * 1.3;
      top.add(m);
      if (chop > 0.5) { const m2 = m.clone(); m2.position.x += 0.04; m2.rotation.y += 2; m2.scale.setScalar(0.75); top.add(m2); }
    }
    i++;
  }
}
/** which real relief photo shows an ingredient on the board at this chop progress */
function boardRelief(k: string, chop: number): string | null {
  switch (k) {
    case 'garlic': return chop < 0.45 ? 'garlic_crushed' : 'garlic_minced_pile';
    case 'chili': return 'chili_red_bunch';
    case 'onion': return 'onion_slices';
    case 'kale': case 'morning_glory': return 'kale_leaf';
    case 'long_beans': return chop < 0.25 ? 'long_beans_bundle' : null;
    default: return null;
  }
}
const _boardCards = new Map<number, THREE.BufferGeometry>();
function boardCard(w: number) {
  const k = Math.round(w * 100);
  let g = _boardCards.get(k);
  if (!g) {
    g = new THREE.PlaneGeometry(w, w, 3, 3);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (w / 2); pos.setZ(i, 0.01 * Math.max(0, 1 - x * x) * Math.max(0, 1 - y * y)); }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);
    _boardCards.set(k, g);
  }
  return g;
}

function refreshMortar(obj: THREE.Object3D, e: Ent) {
  const paste = obj.getObjectByName('paste');
  if (!paste) return;
  const it: Record<string, { g: number }> = e.data?.it ?? {};
  const total = Object.values(it).reduce((a, v) => a + (v?.g ?? 0), 0);
  paste.visible = total > 0.5;
  const s = Math.min(1.2, Math.sqrt(total / 25));
  paste.scale.set(0.5 + s * 0.5, 0.4 + s * 0.6, 0.5 + s * 0.5);
  paste.position.y = 0.035 + Math.min(0.03, total / 1500);
  const pound = e.data?.pound ?? 0;
  const cr = paste.getObjectByName('crushed') as THREE.Mesh;
  if (cr) {
    cr.visible = (it.garlic?.g ?? 0) > 0.5;
    (cr.material as THREE.MeshStandardMaterial).map = pound > 0.45 ? T.garlicMinced() : T.garlicCard();
  }
  const ch = paste.getObjectByName('chili') as THREE.Mesh;
  if (ch) { ch.visible = (it.chili?.g ?? 0) > 0.5; ch.scale.setScalar(pound > 0.5 ? 0.7 : 1); }
}

function refreshVesselRice(obj: THREE.Object3D, e: Ent) {
  const top = obj.getObjectByName('ontop');
  if (!top) return;
  let r = top.getObjectByName('rice') as THREE.Mesh | undefined;
  const g = e.data?.rice ?? 0;
  if (!r && g > 1) {
    r = new THREE.Mesh(riceMoundGeo(), riceMat());
    r.name = 'rice';
    top.add(r);
  }
  if (r) {
    r.visible = g > 1;
    const s = Math.cbrt(Math.max(0.01, g) / 200);
    r.scale.set(s, s, s);
  }
  // dirty plate: sauce stains
  let d = top.getObjectByName('stain') as THREE.Mesh | undefined;
  if (e.data?.dirty && !d) {
    d = new THREE.Mesh(boardCard(0.16), new THREE.MeshStandardMaterial({ map: T.burnt(), transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false }));
    d.name = 'stain';
    d.position.y = 0.001;
    top.add(d);
  }
  if (d) d.visible = !!e.data?.dirty;
}

/** real rice-mound photo relief (one ทัพพี ≈ 200 g at scale 1) */
export function riceMoundGeo() { return riceMoundGeoReal(); }
export function riceMat() { return riceMatReal(); }

function refreshBowl(obj: THREE.Object3D, e: Ent) {
  refreshVesselRice(obj, e);
  const liq = obj.getObjectByName('bowlliquid') as THREE.Mesh | undefined;
  if (!liq) return;
  const n = e.data?.egg ?? 0;
  const sauces = Object.values(e.data?.sa ?? {}).reduce((a: number, v: any) => a + (v ?? 0), 0) as number;
  const vol = n * 50 + sauces;
  liq.visible = vol > 1;
  if (vol > 1) {
    const h = Math.min(0.05, 0.012 + vol / 6000);
    const r = 0.035 + h * 0.75;
    liq.position.y = h;
    liq.scale.set(r, 1, r);
    const m = liq.material as THREE.MeshStandardMaterial;
    const w = e.data?.whisk ?? 0;
    m.color.setHex(n > 0 ? (w > 0.6 ? 0xf2b838 : 0xf6d870) : 0x8a4a1a);
    m.opacity = n > 0 ? 0.96 : 0.8;
  }
}

function bowlLabel(d: any) {
  const n = d?.egg ?? 0;
  if (d?.dirty) return tl('ชามสกปรก');
  if (n > 0) return tl(`ชาม (ไข่ ${n} ฟอง${(d?.whisk ?? 0) > 0.6 ? ' ตีแล้ว' : ''})`);
  if ((d?.rice ?? 0) > 1) return tl(`ชาม (ข้าว ${Math.round(d.rice)} ก.)`);
  return tl('ชามตราไก่');
}

function contentsLabel(name: string, it: Record<string, { g: number }> | undefined, prog: number | undefined, verb: string) {
  const parts = Object.entries(it ?? {}).filter(([, v]) => v && v.g >= 0.5).map(([k, v]) => `${ING[k]?.name.th ?? k} ${Math.round(v.g)}`);
  if (!parts.length) return tl(name);
  const p = Math.round((prog ?? 0) * 100);
  return tl(`${name}: ${parts.join(' · ')} ก. (${verb} ${p}%)`);
}

function ricePotLabel(d: any) {
  if (!d) return tl('หม้อหุงข้าว');
  if (d.on) return tl(`หม้อหุงข้าว · กำลังหุง ${Math.round((d.cook ?? 0) * 100)}%`);
  const parts: string[] = [];
  if ((d.g ?? 0) > 1) parts.push(`ข้าวสวย ${Math.round(d.g)} ก.`);
  if ((d.raw ?? 0) > 1) parts.push(`ข้าวสาร ${Math.round(d.raw)} ก.`);
  if ((d.water ?? 0) > 1) parts.push(`น้ำ ${Math.round(d.water)} มล.`);
  return tl(parts.length ? 'หม้อหุงข้าว · ' + parts.join(' · ') : 'หม้อหุงข้าว (ว่าง)');
}

function refreshRicePot(obj: THREE.Object3D, e: Ent) {
  const d = e.data ?? {};
  const rice = obj.getObjectByName('rice');
  const raw = obj.getObjectByName('raw');
  const water = obj.getObjectByName('water');
  const H = 0.22;
  if (rice) {
    rice.visible = (d.g ?? 0) > 10;
    const k = Math.min(1, (d.g ?? 0) / 5000);
    rice.position.y = 0.05 + k * (H - 0.08);
    rice.scale.set(1, 0.5 + k, 1);
  }
  if (raw) { raw.visible = (d.raw ?? 0) > 5; raw.position.y = 0.05 + Math.min(1, (d.raw ?? 0) / 2500) * 0.06; }
  if (water) { water.visible = (d.water ?? 0) > 10; water.position.y = 0.055 + Math.min(1, ((d.raw ?? 0) + (d.water ?? 0)) / 4000) * 0.08; }
}

// ------------------------------------------------------------------ wok visuals

function wokLabel(d: WokData | undefined): TL {
  if (!d) return tl('กระทะ');
  const parts: string[] = [];
  const T0 = Math.round(d.T ?? 25);
  if ((d.oil ?? 0) > 0.5) parts.push(`น้ำมัน ${Math.round(d.oil)}`);
  const solids = Object.entries(d.it ?? {}).filter(([, v]) => v && v.g > 0.5);
  for (const [k, v] of solids.slice(0, 4)) parts.push(`${ING[k]?.name.th ?? (k === 'egg_scr' ? 'ไข่คน' : k === 'rice_cooked' ? 'ข้าว' : k)} ${Math.round(v.g)}`);
  if (solids.length > 4) parts.push('…');
  if (d.egg?.n) parts.push(`ไข่ดาว ${d.egg.n}`);
  if (d.om?.n) parts.push(`ไข่เจียว`);
  if ((d.w ?? 0) > 5) parts.push(`น้ำ ${Math.round(d.w)}`);
  return tl(`กระทะ ${T0}°C${parts.length ? ' · ' + parts.join(' ') : ''}`);
}

interface WokVis { layers: FoodLayers; sig: string }

function wokRefresh(obj: THREE.Object3D, e: Ent) {
  const food = obj.getObjectByName('wokfood');
  if (!food) return;
  let wv = obj.userData.wv as WokVis | undefined;
  if (!wv) {
    const layers = buildFoodLayers(e.id);
    food.add(layers.root);
    wv = { layers, sig: '' };
    obj.userData.wv = wv;
  }
  applyFoodVisual(wv.layers, e.data as WokData, 'wok');
}

/** Map wok-style data onto the food layer meshes (also used for previews). */
export function applyFoodVisual(L: FoodLayers, d: WokData | undefined, where: 'wok' | 'plate') {
  if (!d) return;
  const it = d.it ?? {};
  let solids = 0;
  const cat: Record<HeapKind, number> = { meat: 0, rice: 0, noodle: 0, veg: 0, shrimp: 0, paste: 0, none: 0 };
  let cSum = 0, bSum = 0, wSum = 0;
  for (const [k, v] of Object.entries(it)) {
    if (!v || v.g < 0.5) continue;
    solids += v.g;
    const tags = ING[k]?.tags ?? [];
    const kind: HeapKind = k === 'rice_cooked' ? 'rice' : k === 'noodles_wide' ? 'noodle' : k === 'shrimp' ? 'shrimp' : k === 'curry_paste' ? 'paste' : tags.includes('meat') ? 'meat' : tags.includes('veg') && k !== 'holy_basil' ? 'veg' : k === 'egg_scr' ? 'rice' : 'none';
    if (kind !== 'none') cat[kind] += v.g;
    const cp = cookParams(k);
    const w = v.g * (cp.t > 8 ? 1 : 0.3);
    cSum += Math.min(1.3, v.c) * w; bSum += v.b * w; wSum += w;
  }
  let dom: HeapKind = 'none', dg = 0;
  for (const k of Object.keys(cat) as HeapKind[]) if (k !== 'none' && cat[k] > dg) { dg = cat[k]; dom = k; }
  // ---- heap
  const showHeap = solids > 3 && dom !== 'none';
  L.heap.visible = showHeap;
  if (showHeap) {
    setFoodSet(L.heapMat, dom);
    const u = (L.heapMat as any).userData.u;
    const c = wSum ? cSum / wSum : 0, b = wSum ? bSum / wSum : 0;
    u.k2.value = Math.min(1, Math.max(0, (c - 0.15) / 0.8));
    u.k3.value = Math.min(0.92, Math.max(0, b * 0.95));
    const sauce = ((d.sa?.oyster_sauce ?? 0) + (d.sa?.soy_dark ?? 0) * 2 + (d.sa?.soy_light ?? 0) * 0.5 + (d.sa?.seasoning_sauce ?? 0) * 0.5) / Math.max(40, solids * 0.12);
    u.gloss.value = Math.min(0.8, sauce * 0.6 + (d.oil ?? 0) / 120);
    L.heapMat.clearcoat = 0.05 + u.gloss.value * 1.1 * (1 - u.k3.value * 0.6);
    L.heapMat.clearcoatRoughness = 0.22 + u.k3.value * 0.4;
    const dark = Math.min(0.35, sauce * 0.18);
    const curry = (it.curry_paste?.g ?? 0) / Math.max(1, solids);
    L.heapMat.color.setRGB(1 - dark * 0.6 + curry * 0.2, 1 - dark - curry * 0.35, 1 - dark - curry * 0.5);
    const s = Math.cbrt(Math.min(1.6, solids / 220));
    const r = 0.55 + s * 0.5;
    L.heap.scale.set(r, 0.5 + s * 0.7, r);
    L.heap.position.y = where === 'wok' ? wokY(0) - 0.002 : 0;
  }
  // ---- basil cards
  const basil = it.holy_basil?.g ?? 0;
  L.leaves.visible = basil > 1.5;
  if (L.leaves.visible) {
    const c = it.holy_basil!.c;
    const soggy = c > (cookParams('holy_basil').soggy ?? 3.4);
    const burn = Math.min(1, it.holy_basil!.b);
    L.leaves.material = leafMat(burn > 0.55 ? 'burnt' : c < 0.35 ? 'fresh' : soggy ? 'soggy' : 'cooked');
    const k = Math.min(1.25, Math.sqrt(basil / 18));
    L.leaves.scale.set(0.6 + k * 0.45, 0.8 + k * 0.2, 0.6 + k * 0.45);
    L.leaves.position.y = (where === 'wok' ? wokY(0) : 0) + (showHeap ? 0.004 + Math.cbrt(solids / 220) * 0.018 : -0.012);
  }
  const chili = (it.chili?.g ?? 0) + (d.sa?.chili_flakes ?? 0);
  L.chili.visible = chili > 1.5;
  if (L.chili.visible) {
    L.chili.position.y = (where === 'wok' ? wokY(0) : 0) + (showHeap ? 0.02 + Math.cbrt(solids / 220) * 0.02 : 0.006);
    const k = Math.min(1.2, chili / 8); L.chili.scale.set(0.7 + k * 0.3, 1, 0.7 + k * 0.3);
    L.chili.material = chiliMat('red', Math.min(1, (it.chili?.c ?? 0.6)));
  }
  const garlic = it.garlic?.g ?? 0;
  L.bits.visible = garlic > 1.5;
  if (L.bits.visible) {
    const b = Math.min(1, it.garlic!.b), c = Math.min(1, it.garlic!.c);
    (L.bits.material as THREE.MeshStandardMaterial).color.setRGB(1 - b * 0.75 - c * 0.1, 1 - b * 0.8 - c * 0.25, 1 - b * 0.85 - c * 0.45);
    L.bits.position.y = (where === 'wok' ? wokY(0) : 0) + (showHeap ? 0.016 + Math.cbrt(solids / 220) * 0.012 : 0.0);
    const gk = Math.min(1.3, Math.sqrt(garlic / 15)); L.bits.scale.set(0.6 + gk * 0.5, 1, 0.6 + gk * 0.5);
  }
  // ---- oil (puddle at the bottom of the paraboloid)
  const oil = d.oil ?? 0;
  L.oil.visible = where === 'wok' && oil > 0.4;
  if (L.oil.visible) {
    const V = oil * 1e-6;
    const h = Math.sqrt((2 * WOK_D * V) / (Math.PI * WOK_R * WOK_R));
    const rs = Math.max(0.035, WOK_R * Math.sqrt(Math.min(1, h / WOK_D)));
    L.oil.scale.set(rs, 1, rs);
    L.oil.position.y = wokY(0) + h * 0.85 + 0.0006;
    const om = L.oil.material as THREE.MeshStandardMaterial;
    const burnt = Math.min(1, d.ob ?? 0);
    om.color.setRGB(1 - burnt * 0.5, 1 - burnt * 0.6, 1 - burnt * 0.7);
  }
  // ---- water / broth / gravy
  const w = d.w ?? 0;
  L.liquid.visible = w > 4;
  if (L.liquid.visible) {
    const V = w * 1e-6;
    const h = Math.sqrt((2 * WOK_D * V) / (Math.PI * WOK_R * WOK_R));
    const rs = Math.max(0.04, WOK_R * Math.sqrt(Math.min(1, h / WOK_D)));
    L.liquid.scale.set(rs, 1, rs);
    L.liquid.position.y = (where === 'wok' ? wokY(0) : 0.01) + h;
    const m = L.liquidMat;
    const red = ((d.sa?.tomyum_paste ?? 0) + (it.chili?.g ?? 0) * 0.5 + (it.curry_paste?.g ?? 0)) / Math.max(50, w * 0.1);
    const brown = ((d.sa?.oyster_sauce ?? 0) + (d.sa?.soy_dark ?? 0) * 2 + (d.sa?.soy_light ?? 0)) / Math.max(30, w * 0.08);
    const starch = (d.sa?.gravy_starch ?? 0) / Math.max(10, w * 0.03);
    const col = new THREE.Color(0xd8e2dc);
    col.lerp(new THREE.Color(0xd8642a), Math.min(1, red));
    col.lerp(new THREE.Color(0x6a3a14), Math.min(0.9, brown * 0.6));
    m.color.copy(col);
    m.opacity = Math.min(0.95, 0.55 + red * 0.3 + brown * 0.2 + starch * 0.4);
    m.roughness = starch > 0.5 ? 0.15 : 0.05;
  }
  // ---- fried eggs (real cut-out photos)
  const n = Math.min(3, d.egg?.n ?? 0);
  const e = d.egg;
  for (let i = 0; i < 3; i++) {
    const m = L.eggs[i];
    m.visible = i < n;
    if (!m.visible || !e) continue;
    const ang = i * 2.1 + 0.4;
    const off = n > 1 ? 0.055 : 0;
    m.position.set(Math.cos(ang) * off, (where === 'wok' ? wokY(off) : 0.004) + 0.002 + i * 0.0015, Math.sin(ang) * off);
    m.rotation.y = i * 1.7;
  }
  if (e && n > 0) {
    const v = e.b > 0.75 ? 'burnt' : e.cr >= 0.45 ? 'crispy' : 'runny';
    for (let i = 0; i < n; i++) setFriedVariant(L.eggs[i], v);
    // raw egg white sits flatter (it puffs and the lace curls up as it fries)
    const raw = clamp01(1 - e.wh);
    for (let i = 0; i < n; i++) L.eggs[i].scale.set(1, 0.55 + (1 - raw) * 0.45, 1);
  }
  // ---- omelette
  const om = d.om;
  L.omelet.visible = !!om && om.n > 0;
  if (om && om.n > 0) {
    const c = Math.min(1, om.c), b = Math.min(1, om.b);
    const mm = L.omelet.material as THREE.MeshStandardMaterial;
    mm.color.setRGB(1.0 - b * 0.6, 1.0 - b * 0.65 - (1 - c) * 0.05, 1.0 - b * 0.7 - (1 - c) * 0.35);
    const s = 0.75 + Math.min(1, om.cr) * 0.35 + (om.n - 2) * 0.08;
    L.omelet.scale.set(s, 0.6 + Math.min(1, om.cr) * 0.9, s);
    L.omelet.position.y = (where === 'wok' ? wokY(0) : 0) + 0.004;
    L.omelet.rotation.y = om.f ? Math.PI : 0;
  }
}

/** colours of little bits that jump out of the wok, per ingredient (sampled from the real photos) */
const BIT_COL: Record<string, number[]> = {
  pork_minced: [0xc98a78, 0x9a5a3c, 0xe0b0a0], chicken_minced: [0xe8c8b0, 0xc8a080], pork_sliced: [0xd89a88, 0xb07060], shrimp: [0xf09070, 0xffc0a0],
  holy_basil: [0x2f6a1c, 0x4a8a2a, 0x20501a], chili: [0xd8261a, 0xb01810, 0x4a8a24], garlic: [0xf2e6c8, 0xe0c890], long_beans: [0x4f8a2c, 0x6aa040],
  onion: [0xf0e8d8, 0xe8d0b0], kale: [0x3f7a2c, 0x6a9a50], morning_glory: [0x3f7a26, 0x5a9a30], rice_cooked: [0xf6f2e8, 0xece4d2], egg_scr: [0xf6d040, 0xfff2c0],
  noodles_wide: [0xe8d8b8, 0xb08850], mushroom: [0x8a7a6a], tomato: [0xd83020], curry_paste: [0xa8341c], lemongrass: [0xd8dca0], galangal: [0xe8cbb0],
  spring_onion: [0x6aa040], cucumber: [0xc8e0a0], kaffir_lime: [0x4a7a30],
};
const SAUCE_COL: Record<string, number> = { oyster_sauce: 0x2a160a, soy_dark: 0x140a06, soy_light: 0x5a2c10, fish_sauce: 0xa85a1a, seasoning_sauce: 0x3a1c0a, sugar: 0xffffff, msg: 0xffffff, white_pepper: 0xe8e0d0, chili_flakes: 0xa82a14, gravy_starch: 0xf0f0f0, lime: 0xe8f0a0, tomyum_paste: 0x8a240c };

interface WokJuice { prev: Record<string, number>; sa: number; oil: number; eggN: number; st: number; hy: number; hv: number; q: number; qv: number; popT: number; hopT: number; y0: number }

function wokAnim(obj: THREE.Object3D, e: Ent, dt: number, game: Game, act: string | undefined, st: any) {
  const wv = obj.userData.wv as WokVis | undefined;
  const d = e.data as WokData | undefined;
  if (!wv || !d) return;
  const L = wv.layers;
  const it = d.it ?? {};
  const T0 = d.T ?? 25;
  const solids = Object.values(it).reduce((a, v) => a + (v?.g ?? 0), 0) + (d.egg?.n ?? 0) * 50 + (d.om?.n ?? 0) * 50;
  const saTot = Object.values(d.sa ?? {}).reduce((a: number, v: any) => a + (v ?? 0), 0) as number;
  const J: WokJuice = (st.wj ??= { prev: {}, sa: saTot, oil: d.oil ?? 0, eggN: d.egg?.n ?? 0, st: d.st ?? 0, hy: 0, hv: 0, q: 0, qv: 0, popT: 0, hopT: 0, y0: 0 });
  if (!st.wjInit) { st.wjInit = true; for (const [k, v] of Object.entries(it)) J.prev[k] = v?.g ?? 0; }
  const stir = act === 'stir' || (d.st ?? 0) > 0.3;
  // world points: food surface centre
  const surfY = wokY(0) + 0.012 + Math.cbrt(Math.min(1.6, solids / 220)) * 0.025;
  const p = FX ? obj.localToWorld(new THREE.Vector3(0, surfY, 0)) : null;
  const hot = T0 > 120;
  J.popT -= dt; J.hopT -= dt;
  // ---- ingredients dropped in → they pop, bounce and settle; oil spits; steam bursts
  if (FX && p) {
    for (const [k, v] of Object.entries(it)) {
      const g = v?.g ?? 0, dg = g - (J.prev[k] ?? 0);
      if (dg > 1.5 && J.popT <= 0) {
        J.popT = 0.11;
        const col = BIT_COL[k] ?? [0xb08060];
        FX.bits(p, col, Math.min(9, 2 + Math.round(dg / 3)), { speed: 0.35, up: hot ? 1.3 : 0.8, size: k === 'holy_basil' ? 0.007 : 0.0045, floor: p.y - 0.01, spread: 0.08, flat: k === 'holy_basil' ? 0.15 : 0.7, life: 0.7 });
        J.qv -= Math.min(2.2, 0.5 + dg / 12);
        if (hot && (d.oil ?? 0) > 4) FX.droplets(p, 0xe8b830, 2 + Math.round(Math.min(6, (T0 - 120) / 25)), { speed: 0.9, up: 1.8, floor: p.y - 0.05 });
        if (hot) FX.steamBurst(p, 2, 0.8);
      }
      if (dg > 1.5 || dg < -1.5) J.prev[k] = g;
    }
    for (const k of Object.keys(J.prev)) if (!it[k]) J.prev[k] = 0;
    // sauces splash
    if (saTot - J.sa > 1.2 && J.popT <= 0) {
      J.popT = 0.12;
      const top = Object.entries(d.sa ?? {}).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ?? 'soy_light';
      FX.droplets(p, SAUCE_COL[top] ?? 0x3a1c0a, hot ? 5 : 2, { speed: 0.6, up: hot ? 1.6 : 0.8, floor: p.y - 0.03, size: 0.002 });
      if (hot) FX.steamBurst(p, 3, 1);
      J.qv -= 0.4;
    }
    if (Math.abs(saTot - J.sa) > 1.2) J.sa = saTot;
    // oil in → shimmering spits when hot
    const oil = d.oil ?? 0;
    if (oil - J.oil > 2 && hot) FX.droplets(p, 0xf0c040, 3, { speed: 0.8, up: 1.5, floor: p.y - 0.05 });
    if (Math.abs(oil - J.oil) > 2) J.oil = oil;
    // egg cracked in → white splatter + oil burst
    const en = d.egg?.n ?? 0;
    if (en > J.eggN) { FX.droplets(p, 0xfff6e8, 4, { speed: 0.5, up: 0.9, floor: p.y - 0.02, size: 0.003 }); if (hot) FX.droplets(p, 0xf0c040, 6, { speed: 1.1, up: 2, floor: p.y - 0.05 }); J.qv -= 0.6; juiceKick(obj, 0, 0, -0.4); }
    J.eggN = en;
    // continuous oil spitting on a very hot wok
    if (T0 > 175 && oil > 8) FX.rate('spit' + e.id, Math.min(6, (T0 - 170) / 30) * (stir ? 2 : 1), dt, () => FX!.droplets(p!, 0xf0c040, 1, { speed: 0.7, up: 1.6, floor: p!.y - 0.05, size: 0.0018 }));
  }
  // ---- toss (big jump, chunks fly, lands with a squash) / stir hops
  const sNow = d.st ?? 0;
  if (sNow - J.st > 0.75 && solids > 5) {
    J.hv = 1.25 + Math.min(0.5, solids / 800);
    if (FX && p) {
      const cols = Object.keys(it).flatMap((k) => BIT_COL[k] ?? []);
      FX.bits(p, cols.length ? cols : [0xb08060], 18, { speed: 0.5, up: 1.9, size: 0.005, floor: p.y - 0.01, spread: 0.12, life: 0.9 });
      if ((d.oil ?? 0) > 3) FX.droplets(p, 0xf0c040, 8, { speed: 1.2, up: 2.2, floor: p.y - 0.06 });
      if (hot) FX.steamBurst(p, 4, 1.1);
    }
    juiceKick(obj, 0, 0.6, -0.6);
  }
  J.st = sNow;
  if (J.hy > 0 || J.hv !== 0) {
    J.hv -= 9.81 * dt; J.hy += J.hv * dt;
    if (J.hy <= 0) { J.hy = 0; if (J.hv < -0.3) { J.qv -= Math.min(3, -J.hv * 1.6); if (FX && p) FX.bits(p, Object.keys(it).flatMap((k) => BIT_COL[k] ?? [0xb08060]).slice(0, 6), 6, { speed: 0.4, up: 0.6, floor: p.y - 0.01, spread: 0.1 }); juiceKick(obj, 0, 0, -0.5); } J.hv = 0; }
  }
  if (stir && solids > 10 && J.hopT <= 0 && FX && p) {
    J.hopT = 0.16 + Math.random() * 0.14;
    const cols = Object.keys(it).flatMap((k) => BIT_COL[k] ?? []);
    FX.bits(p, cols.length ? cols : [0xb08060], 2 + Math.floor(Math.random() * 3), { speed: 0.3, up: 0.75, size: 0.0045, floor: p.y - 0.008, spread: 0.1, life: 0.5 });
    J.qv -= 0.35;
  }
  // squash spring of the whole food layer (pivot = wok bottom)
  const n = Math.min(10, Math.ceil(dt * 150)), h = dt / Math.max(1, n);
  for (let i = 0; i < n; i++) { J.qv += (-140 * J.q - 7 * J.qv) * h; J.q += J.qv * h; }
  J.q = Math.max(-0.35, Math.min(0.35, J.q));
  L.root.scale.set(1 - J.q * 0.45, 1 + J.q, 1 - J.q * 0.45);
  if (stir) {
    const t = st.t * 12;
    J.y0 = Math.abs(Math.sin(t)) * 0.008;
    L.root.rotation.y = Math.sin(t * 0.37) * 0.25;
    if (e.holder == null) obj.rotation.z = Math.sin(t * 0.5) * 0.02;
  } else J.y0 *= 0.8;
  L.root.position.y = J.y0 + J.hy;
  // smoke / steam / sizzle cues (client-local)
  if (!FX) return;
  const pp = obj.localToWorld(new THREE.Vector3(0, 0.06, 0));
  const smoke = (d.sm ?? 0);
  if (smoke > 0.05) FX.rate('wsm' + e.id, smoke * 14, dt, () => FX!.smokePuff(pp, 0.7 + smoke * 0.6, (d.ob ?? 0) > 0.4 || Object.values(d.it ?? {}).some((v) => (v?.b ?? 0) > 0.6), 0.16));
  if ((d.w ?? 0) > 20 && T0 > 92) FX.rate('wst' + e.id, 6 + (d.w ?? 0) / 60, dt, () => FX!.steam(pp, 1, 0.2));
  else if (solids > 20 && T0 > 105) FX.rate('wst' + e.id, Math.min(9, (T0 - 100) / 12), dt, () => FX!.steam(pp, 0.8, 0.18));
}
