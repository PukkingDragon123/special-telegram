import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Action, Ctx } from '../../game/interact';
import { Sound, SoundHandle } from '../../core/audio';
import { tl, angleDiff, clamp, damp } from '../../core/util';
import { G, groups } from '../../sim/physics';
import { CART, SPOTS, CART_BOUNDS, surfaceAt } from './cartspec';
import { M, mesh, gc } from './mats';
import { lathe, merge, rbox, tube, bar, dent, planarUV } from './geo';
import { cachedMat, lateTex, pbr } from './assets';
import { makeFlameMaterial, flameGeometry, CookFX } from './fx';
import { buildGasTank } from './models-tools';
import { pickKey, sfx, noRaycast, rd } from './util';

/* =============================================================================================
 * THE FOOD CART (entity t:'cart') — stainless อาหารตามสั่ง cart with glass display, high-pressure
 * burner + red LPG tank, wheels, push handle, roof + tube light. Pushable by players.
 *  { t:'cart', p, yaw, owner:'oldman'|'players', gas:0..1, burner:{on, heat}, pusher:playerId|null }
 * Items sitting on the cart are children of the cart (item.in = cartId, item.at = [x,y,z,yaw]).
 * ============================================================================================= */

export const GAS_SECONDS = 1500; // a full 15 kg tank at full roar (real seconds)
const PUSH_SPEED = 2.2;
const PUSH_TURN = 1.6;

export function spawnCart(game: Game, p: ArrayLike<number>, yaw = 0, owner: 'oldman' | 'players' = 'oldman'): Ent {
  return game.state.spawn('cart', {
    p: [p[0], p[1], p[2]], yaw, owner, gas: 1, burner: { on: false, heat: 0.65 }, pusher: null, name: 'รถเข็นอาหารตามสั่ง',
  });
}

export function carts(game: Game) { return game.state.all('cart'); }

/** Cart-local → world (uses the live view when available). */
export function cartLocalToWorld(game: Game, cart: Ent, local: ArrayLike<number>, out = new THREE.Vector3()) {
  const o = game.views.objectOf(cart.id);
  out.set(local[0], local[1], local[2]);
  if (o) { o.updateMatrixWorld(); return out.applyMatrix4(o.matrixWorld); }
  const y = cart.yaw ?? 0, c = Math.cos(y), s = Math.sin(y);
  const p = cart.p ?? [0, 0, 0];
  return out.set(p[0] + local[0] * c + local[2] * s, p[1] + local[1], p[2] - local[0] * s + local[2] * c);
}
export function worldToCartLocal(cart: Ent, w: THREE.Vector3, out = new THREE.Vector3()) {
  const y = cart.yaw ?? 0, c = Math.cos(y), s = Math.sin(y);
  const p = cart.p ?? [0, 0, 0];
  const dx = w.x - p[0], dz = w.z - p[2];
  return out.set(dx * c - dz * s, w.y - p[1], dx * s + dz * c);
}

/** Item on the cart's burner (wok / pot). */
export function itemOnBurner(game: Game, cart: Ent): Ent | null {
  const b = SPOTS.burner;
  for (const e of game.state.all('item')) {
    if (e.in !== cart.id || !e.at) continue;
    if (Math.hypot(e.at[0] - b[0], e.at[2] - b[2]) < 0.12 && Math.abs(e.at[1] - b[1]) < 0.08) return e;
  }
  return null;
}

/** Which cart (and is it on the burner) holds this item? */
export function burnerOf(game: Game, item: Ent): Ent | null {
  if (item.in == null || !item.at) return null;
  const c = game.state.get(item.in);
  if (!c || c.t !== 'cart') return null;
  const b = SPOTS.burner;
  return Math.hypot(item.at[0] - b[0], item.at[2] - b[2]) < 0.12 && Math.abs(item.at[1] - b[1]) < 0.08 ? c : null;
}

export function partAt(local: THREE.Vector3): 'knob' | 'handle' | 'tank' | 'burner' | 'body' {
  const k = CART.knob;
  if (Math.hypot(local.x - k.x, local.y - k.y, local.z - k.z) < 0.1) return 'knob';
  if (local.x > 1.13) return 'handle';
  if (Math.hypot(local.x - CART.tank.x, local.z - CART.tank.z) < 0.21 && local.y < 0.68) return 'tank';
  if (Math.hypot(local.x - CART.burner.x, local.z - CART.burner.z) < 0.26 && local.y > 0.45 && local.y < 1.0) return 'burner';
  return 'body';
}

// ------------------------------------------------------------------ model

function towelTex() {
  return lateTex('towel', ['pha khao ma', 'phakhaoma', 'ผ้าขาวม้า', 'plaid cloth', 'checkered cloth', 'towel'], (ctx, S) => {
    ctx.fillStyle = '#c8402e'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < S; i += S / 8) { ctx.fillRect(i, 0, S / 24, S); ctx.fillRect(0, i, S, S / 24); }
  }, { dirs: ['textures/props/', 'gen/cooking/'] });
}

export function buildCartModel() {
  const root = new THREE.Group();
  root.name = 'cart';
  const B = CART.body, S = CART.slab, F = CART.flap;
  // ---- stainless body (dented, greasy) — merged
  const steel = gc('cartSteel', () => {
    const p: THREE.BufferGeometry[] = [];
    const w = B.x1 - B.x0, d = B.z1 - B.z0, h = B.y1 - B.y0;
    p.push(dent(rbox(w, h, 0.012, 0.004, 0.5, 2).translate(0, B.y0 + h / 2, B.z0), 0.004, 3, 1)); // customer side panel
    p.push(dent(rbox(0.012, h, d, 0.004, 0.5, 2).translate(B.x0, B.y0 + h / 2, 0), 0.004, 3, 2));
    p.push(dent(rbox(0.012, h, d, 0.004, 0.5, 2).translate(B.x1, B.y0 + h / 2, 0), 0.004, 3, 3));
    // vendor side: two sliding doors with a gap
    p.push(dent(rbox(w * 0.5, h * 0.96, 0.01, 0.004, 0.5, 2).translate(-w * 0.24, B.y0 + h / 2, B.z1 - 0.01), 0.003, 3, 4));
    p.push(dent(rbox(w * 0.5, h * 0.96, 0.01, 0.004, 0.5, 2).translate(w * 0.27, B.y0 + h / 2, B.z1 - 0.025), 0.003, 3, 5));
    p.push(rbox(w, 0.012, d, 0.004, 0.5).translate(0, B.y0, 0)); // floor
    p.push(rbox(w - 0.04, 0.008, d - 0.04, 0.003, 0.5).translate(0, B.y0 + (B.y1 - B.y0) * 0.5, 0)); // inner shelf
    // counter slab with lip
    p.push(rbox(S.x1 - S.x0, 0.03, S.z1 - S.z0, 0.008, 0.5).translate(0, CART.top - 0.015, 0));
    p.push(rbox(S.x1 - S.x0, 0.022, 0.012, 0.004, 0.5).translate(0, CART.top + 0.008, S.z0 + 0.006));
    p.push(rbox(0.012, 0.022, S.z1 - S.z0, 0.004, 0.5).translate(S.x0 + 0.006, CART.top + 0.008, 0));
    // fold-out flap + brackets
    p.push(rbox(F.x1 - F.x0, 0.02, F.z1 - F.z0, 0.006, 0.5).translate((F.x0 + F.x1) / 2, F.y - 0.01, 0));
    p.push(bar([F.x0 + 0.01, F.y - 0.02, 0.24], [F.x0, F.y - 0.25, 0.24], 0.009), bar([F.x0 + 0.01, F.y - 0.02, -0.24], [F.x0, F.y - 0.25, -0.24], 0.009));
    // burner platform (lower) at the -X end
    const bx = CART.burner.x;
    p.push(rbox(0.4, 0.016, 0.44, 0.004, 0.5).translate(bx, CART.burner.y - 0.07, CART.burner.z));
    p.push(rbox(0.4, 0.2, 0.012, 0.004, 0.5).translate(bx, CART.burner.y - 0.17, CART.burner.z - 0.22)); // wind shield
    for (const [x, z] of [[bx - 0.18, -0.2], [bx - 0.18, 0.22], [bx + 0.18, -0.2]] as [number, number][]) p.push(bar([x, CART.burner.y - 0.07, z], [x, 0.0, z], 0.012));
    // corner legs + caster forks
    for (const [x, z] of [[B.x0 + 0.04, B.z0 + 0.04], [B.x0 + 0.04, B.z1 - 0.04]] as [number, number][]) p.push(bar([x, B.y0, z], [x, 0.11, z], 0.015));
    // axle housing
    p.push(bar([CART.wheelX, CART.wheelR, -0.4], [CART.wheelX, CART.wheelR, 0.4], 0.016));
    // glass-box shelf (perforated stainless sheet)
    const Gb = CART.glass;
    p.push(rbox(Gb.x1 - Gb.x0 - 0.03, 0.006, Gb.z1 - Gb.z0 - 0.03, 0.002, 0.5).translate((Gb.x0 + Gb.x1) / 2, Gb.shelf - 0.003, (Gb.z0 + Gb.z1) / 2));
    // condiment caddy base (customer side)
    p.push(rbox(0.2, 0.012, 0.07, 0.004, 0.5).translate(0.66, CART.top + 0.006, -0.28));
    return merge(p);
  });
  root.add(mesh(steel, M.steelDent()));
  // ---- tube frame: glass box edges, roof poles, handle — merged
  const frame = gc('cartFrame', () => {
    const p: THREE.BufferGeometry[] = [];
    const Gb = CART.glass, t = CART.top;
    const xs = [Gb.x0, Gb.x1], zs = [Gb.z0, Gb.z1];
    for (const x of xs) for (const z of zs) p.push(bar([x, t, z], [x, Gb.y1, z], 0.009, 5));
    for (const z of zs) { p.push(bar([Gb.x0, Gb.y1, z], [Gb.x1, Gb.y1, z], 0.009, 5)); p.push(bar([Gb.x0, Gb.shelf, z], [Gb.x1, Gb.shelf, z], 0.007, 5)); }
    for (const x of xs) p.push(bar([x, Gb.y1, Gb.z0], [x, Gb.y1, Gb.z1], 0.009, 5));
    // roof poles (vendor side taller → sloped roof)
    // (the vendor-side pole near the burner sits inboard so it never blocks the cook's view of the wok)
    const poles: [number, number, number][] = [[-0.78, -0.37, 1.98], [0.78, -0.37, 1.98], [-0.32, 0.37, 2.1], [0.78, 0.37, 2.1]];
    for (const [x, z, h] of poles) p.push(bar([x, t, z], [x, h, z], 0.014, 6));
    p.push(bar([-0.78, 2.08, 0.37], [0.78, 2.08, 0.37], 0.012, 6), bar([-0.78, 1.96, -0.37], [0.78, 1.96, -0.37], 0.012, 6), bar([-0.78, 1.96, -0.37], [-0.78, 2.08, 0.37], 0.012, 6));
    // push handle: U-tube off the flap end
    p.push(tube([[1.08, 0.78, -0.27], [1.22, 0.86, -0.27], [1.28, 0.92, -0.2], [1.28, 0.92, 0.2], [1.22, 0.86, 0.27], [1.08, 0.78, 0.27]], 0.014, 24, 7));
    // condiment caddy rails
    p.push(bar([0.56, t + 0.1, -0.28], [0.76, t + 0.1, -0.28], 0.005, 5), bar([0.66, t, -0.28], [0.66, t + 0.14, -0.28], 0.006, 5));
    return merge(p);
  });
  root.add(mesh(frame, M.steel()));
  // ---- glass panes (no raycast so items behind are reachable)
  const glass = gc('cartGlass', () => {
    const Gb = CART.glass, t = CART.top, h = Gb.y1 - t, w = Gb.x1 - Gb.x0, d = Gb.z1 - Gb.z0;
    const pl = (w2: number, h2: number) => new THREE.PlaneGeometry(w2, h2);
    const p: THREE.BufferGeometry[] = [];
    p.push(pl(w, h).translate((Gb.x0 + Gb.x1) / 2, t + h / 2, Gb.z0));
    p.push(pl(d, h).rotateY(Math.PI / 2).translate(Gb.x0, t + h / 2, (Gb.z0 + Gb.z1) / 2));
    p.push(pl(d, h).rotateY(Math.PI / 2).translate(Gb.x1, t + h / 2, (Gb.z0 + Gb.z1) / 2));
    p.push(pl(w, d).rotateX(-Math.PI / 2).translate((Gb.x0 + Gb.x1) / 2, Gb.y1, (Gb.z0 + Gb.z1) / 2));
    // vendor-side sliding glass (half open)
    p.push(pl(w * 0.5, h * 0.9).translate(Gb.x0 + w * 0.25, t + h * 0.47, Gb.z1 - 0.01));
    return merge(p);
  });
  const glassM = mesh(glass, M.glass());
  glassM.renderOrder = 3;
  noRaycast(glassM);
  root.add(glassM);
  // ---- wheels: big bicycle wheels with green rims + spokes, small casters
  const wx = CART.wheelX, wr = CART.wheelR;
  const tyre = gc('cartTyre', () => merge([-0.41, 0.41].map((z) => new THREE.TorusGeometry(wr - 0.02, 0.022, 6, 22).translate(0, 0, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(wx, wr, z)))));
  const rim = gc('cartRim', () => merge([-0.41, 0.41].map((z) => new THREE.TorusGeometry(wr - 0.045, 0.01, 4, 22).applyMatrix4(new THREE.Matrix4().makeTranslation(wx, wr, z)))));
  const spokes = gc('cartSpokes', () => {
    const p: THREE.BufferGeometry[] = [];
    for (const z of [-0.41, 0.41]) for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      p.push(bar([wx, wr, z + (i % 2 ? 0.012 : -0.012)], [wx + Math.cos(a) * (wr - 0.05), wr + Math.sin(a) * (wr - 0.05), z], 0.0018, 3));
    }
    for (const z of [-0.41, 0.41]) p.push(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8).rotateX(Math.PI / 2).translate(wx, wr, z));
    return merge(p);
  });
  const wheels = new THREE.Group();
  wheels.name = 'wheels';
  // wheel meshes rotate about their axle: put them in pivot groups centred at the axle
  const wpivot = new THREE.Group();
  wpivot.position.set(wx, wr, 0);
  const off = new THREE.Matrix4().makeTranslation(-wx, -wr, 0);
  for (const [g, m] of [[tyre, M.rubber()], [rim, M.paint(0x2f8a3a)], [spokes, M.chrome()]] as [THREE.BufferGeometry, THREE.Material][]) {
    const mm = new THREE.Mesh(g, m);
    mm.matrixAutoUpdate = false;
    mm.matrix.copy(off);
    wpivot.add(mm);
  }
  wheels.add(wpivot);
  root.add(wheels);
  const casters = gc('cartCasters', () => merge([[CART.body.x0 + 0.04, CART.body.z0 + 0.04], [CART.body.x0 + 0.04, CART.body.z1 - 0.04]].map(([x, z]) => new THREE.TorusGeometry(0.045, 0.018, 5, 12).translate(x, 0.062, z))));
  root.add(mesh(casters, M.rubber()));
  // ---- burner: cast-iron high-pressure ring burner + 3-prong wok stand
  const bx = CART.burner.x, by = CART.burner.y, bz = CART.burner.z;
  const iron = gc('cartBurner', () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(lathe([[0.0001, by - 0.06], [0.07, by - 0.06], [0.09, by - 0.02], [0.075, by], [0.05, by + 0.005], [0.045, by - 0.01], [0.0001, by - 0.012]], 16, { wobble: 0.03, seed: 3 }).translate(bx, 0, bz));
    // stand ring + prongs
    p.push(new THREE.TorusGeometry(0.17, 0.012, 5, 18).rotateX(Math.PI / 2).translate(bx, CART.stand - 0.02, bz));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      p.push(rbox(0.05, 0.05, 0.016, 0.004, 0.2).translate(bx + Math.cos(a) * 0.13, CART.stand - 0.02, bz + Math.sin(a) * 0.13));
      p.push(bar([bx + Math.cos(a) * 0.17, CART.stand - 0.02, bz + Math.sin(a) * 0.17], [bx + Math.cos(a) * 0.19, by - 0.07, bz + Math.sin(a) * 0.19], 0.01, 5));
    }
    // gas pipe from the knob to the burner
    p.push(bar([CART.knob.x, CART.knob.y, CART.knob.z - 0.03], [bx + 0.03, by - 0.04, bz + 0.03], 0.009, 6));
    return merge(p);
  });
  root.add(mesh(iron, M.castIron()));
  // knob (red bakelite) — target part 'knob'
  const knob = mesh(gc('cartKnob', () => lathe([[0.0001, 0], [0.026, 0], [0.028, 0.012], [0.024, 0.03], [0.0001, 0.032]], 10, { wobble: 0.08, freq: 80 }).rotateX(Math.PI / 2).translate(CART.knob.x, CART.knob.y, CART.knob.z)), cachedMat('knobRed', () => new THREE.MeshStandardMaterial({ color: 0xa8140e, roughness: 0.35 })));
  knob.name = 'knob';
  root.add(knob);
  // ---- LPG tank + regulator + hose
  const tank = buildGasTank();
  tank.position.set(CART.tank.x, 0, CART.tank.z);
  tank.rotation.y = 0.6;
  root.add(tank);
  const hose = gc('cartHose', () => tube([[CART.tank.x + 0.01, 0.6, CART.tank.z], [CART.tank.x + 0.05, 0.75, CART.tank.z - 0.05], [CART.knob.x - 0.04, 0.72, CART.knob.z + 0.12], [CART.knob.x, CART.knob.y, CART.knob.z + 0.02]], 0.009, 18, 6));
  root.add(mesh(hose, M.plasticRough(0xd25a1c)));
  root.add(mesh(gc('cartReg', () => new THREE.CylinderGeometry(0.03, 0.03, 0.035, 10).translate(CART.tank.x + 0.01, 0.6, CART.tank.z)), M.black()));
  // ---- roof (galvanized sheet) + tube light
  const roof = gc('cartRoof', () => {
    const r = new THREE.PlaneGeometry(1.9, 1.05, 8, 2);
    r.rotateX(-Math.PI / 2 + Math.atan2(0.12, 0.74));
    r.translate(0, 2.04, 0);
    return planarUV(r, 1 / 1.1, 'y');
  });
  root.add(mesh(roof, M.roof()));
  const tubeL = mesh(gc('cartTube', () => new THREE.CylinderGeometry(0.014, 0.014, 0.9, 6).rotateZ(Math.PI / 2).translate(0, 1.95, 0.25)), M.emissive(0xfff4dc, 0.0));
  tubeL.name = 'tube';
  noRaycast(tubeL);
  root.add(tubeL);
  // ---- condiment caddy: 4 jars (sugar, fish sauce w/ chili, chili flakes, vinegar w/ chili)
  const jarG = gc('caddyJar', () => lathe([[0.0001, 0], [0.024, 0], [0.026, 0.01], [0.026, 0.07], [0.024, 0.075]], 10));
  const lidG = gc('caddyLid', () => lathe([[0.0001, 0.085], [0.026, 0.082], [0.027, 0.075], [0.025, 0.074]], 10));
  const fills = [0xf4f1ea, 0xb06a22, 0xa82418, 0xe9e2c0];
  fills.forEach((c, i) => {
    const x = 0.585 + i * 0.05;
    root.add(mesh(jarG, M.liquid(c, 0.4), [x, CART.top + 0.012, -0.28], undefined, [0.92, 0.85, 0.92]));
    root.add(mesh(jarG, M.glassBottle(0xffffff, 0.25), [x, CART.top + 0.012, -0.28]));
    root.add(mesh(lidG, M.steel(), [x, CART.top + 0.012, -0.28]));
  });
  // ---- towel (ผ้าขาวม้า) hanging on the handle
  const towel = gc('cartTowel', () => {
    const t = new THREE.PlaneGeometry(0.42, 0.34, 10, 8);
    const pos = t.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 38) * 0.012 + (y > 0.12 ? (y - 0.12) * 0.8 : 0) + Math.sin(y * 20 + x * 9) * 0.004);
    }
    t.computeVertexNormals();
    t.rotateY(Math.PI / 2);
    t.translate(1.29, 0.76, 0.0);
    return t;
  });
  root.add(mesh(towel, cachedMat('towelM', () => new THREE.MeshStandardMaterial({ map: towelTex(), roughness: 0.95, side: THREE.DoubleSide }))));
  // ---- flame (noise shader) + light
  const flameMat = makeFlameMaterial();
  const flame = new THREE.Mesh(flameGeometry(0.045, 0.16, 0.2), flameMat);
  flame.position.set(bx, by - 0.005, bz);
  flame.renderOrder = 4;
  noRaycast(flame);
  root.add(flame);
  const flameLight = new THREE.PointLight(0xff8a3a, 0, 3.2, 1.8);
  flameLight.position.set(bx, by + 0.25, bz);
  root.add(flameLight);
  const tubeLight = new THREE.PointLight(0xfff0d8, 0, 7, 1.6);
  tubeLight.position.set(0, 1.85, 0.25);
  root.add(tubeLight);
  root.traverse((o: any) => { if (o.isMesh && o !== glassM && o !== flame) { o.castShadow = true; o.receiveShadow = true; } });
  const contents = new THREE.Group();
  contents.name = 'contents';
  root.add(contents);
  return { root, flame, flameMat, flameLight, tubeLight, tubeL, wheels: wpivot, contents };
}

// ------------------------------------------------------------------ view + physics

interface CartLocal { phys: { body: RAPIER.RigidBody; colliders: RAPIER.Collider[] } | null; pred: { x: number; y: number; z: number; yaw: number; sendT: number } | null }
const local = new Map<number, CartLocal>();
const getLocal = (id: number) => { let l = local.get(id); if (!l) local.set(id, (l = { phys: null, pred: null })); return l; };

function makeCartBody(game: Game, cart: Ent) {
  const phys = game.physics;
  if (!phys) return null;
  const R = phys.R;
  const p = cart.p ?? [0, 0, 0];
  const body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]));
  const gr = groups(G.STATIC, G.ALL);
  const mk = (d: RAPIER.ColliderDesc) => { const c = phys.world.createCollider(d.setCollisionGroups(gr).setFriction(0.8), body); phys.tags.set(c.handle, { eid: cart.id, cart: true }); return c; };
  const cs = [
    mk(R.ColliderDesc.cuboid(0.8, 0.43, 0.38).setTranslation(0, 0.43, 0)),
    mk(R.ColliderDesc.cuboid(0.2, 0.33, 0.23).setTranslation(CART.burner.x, 0.33, CART.burner.z)),
    mk(R.ColliderDesc.cuboid(0.46, 0.22, 0.18).setTranslation((CART.glass.x0 + CART.glass.x1) / 2, CART.top + 0.22, (CART.glass.z0 + CART.glass.z1) / 2)),
    mk(R.ColliderDesc.cuboid(0.16, 0.02, 0.3).setTranslation((CART.flap.x0 + CART.flap.x1) / 2, CART.flap.y - 0.02, 0)),
    mk(R.ColliderDesc.cylinder(0.3, 0.15).setTranslation(CART.tank.x, 0.3, CART.tank.z)),
  ];
  return { body, colliders: cs };
}

function setBodyTf(b: RAPIER.RigidBody, x: number, y: number, z: number, yaw: number) {
  b.setTranslation({ x, y, z }, true);
  b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
}

export function cartView(game: Game, fx: CookFX) {
  return (e: Ent) => {
    const m = buildCartModel();
    const root = m.root;
    root.userData.eid = e.id;
    game.interact.register(root, { kind: 'cart', eid: e.id, data: { name: tl('รถเข็นอาหารตามสั่ง', 'food cart') } });
    if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
    root.rotation.y = e.yaw ?? 0;
    const L = getLocal(e.id);
    if (L.phys) { game.physics?.removeBody(L.phys.body); L.phys = null; }
    L.phys = makeCartBody(game, e);
    let roar: SoundHandle | null = null, hiss: SoundHandle | null = null, roll: SoundHandle | null = null;
    let flareK = 0, t = 0;
    const offFlare = game.on('cook:flare', (d: { cart?: number; k: number }) => { if (d.cart === e.id) flareK = Math.max(flareK, d.k); });
    const prev = new THREE.Vector3().copy(root.position);
    let wheelA = 0;
    const tmp = new THREE.Vector3();
    let wasPushing = false;
    const view = {
      object: root,
      update: (e: Ent, dt: number) => {
        t += dt;
        // ---- transform: predicted when I push it, else replicated
        const pred = L.pred && e.pusher === game.localPlayerId ? L.pred : null;
        if (pred) {
          root.position.set(pred.x, pred.y, pred.z);
          root.rotation.y = pred.yaw;
        } else if (e.p) {
          const k = damp(10, dt);
          tmp.set(e.p[0], e.p[1], e.p[2]);
          if (root.position.distanceToSquared(tmp) > 16) root.position.copy(tmp); else root.position.lerp(tmp, k);
          root.rotation.y += angleDiff(root.rotation.y, e.yaw ?? 0) * k;
        }
        // ---- physics proxy follows the visual
        if (L.phys) {
          setBodyTf(L.phys.body, root.position.x, root.position.y, root.position.z, root.rotation.y);
          const pushingMe = e.pusher != null && e.pusher === game.localPlayerId;
          if (pushingMe !== wasPushing) {
            wasPushing = pushingMe;
            const gr = pushingMe ? groups(G.STATIC, G.ALL & ~G.PLAYER) : groups(G.STATIC, G.ALL);
            for (const c of L.phys.colliders) c.setCollisionGroups(gr);
          }
        }
        // ---- wheels roll
        const moved = root.position.distanceTo(prev);
        if (moved > 1e-4 && moved < 1) {
          const fwd = new THREE.Vector3(-Math.cos(root.rotation.y), 0, Math.sin(root.rotation.y));
          const sgn = Math.sign(fwd.dot(tmp.copy(root.position).sub(prev))) || 1;
          wheelA += (moved / CART.wheelR) * sgn;
          m.wheels.rotation.z = wheelA;
        }
        const speed = moved / Math.max(dt, 1e-4);
        prev.copy(root.position);
        // ---- burner flame
        const on = !!e.burner?.on && (e.gas ?? 0) > 0;
        const heat = on ? clamp(e.burner?.heat ?? 0.6, 0.05, 1) : 0;
        const wok = itemOnBurner(game, e);
        const u = m.flameMat.uniforms;
        u.uTime.value = t;
        u.uOn.value += ((on ? 1 : 0) - u.uOn.value) * damp(on ? 14 : 6, dt);
        u.uHeat.value += (heat - u.uHeat.value) * damp(5, dt);
        u.uWok.value = wok ? 1 : 0;
        m.flame.visible = u.uOn.value > 0.01;
        m.flame.scale.setScalar(0.85 + u.uHeat.value * 0.35);
        flareK = Math.max(0, flareK - dt * 2.5);
        const flick = 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 17.3);
        m.flameLight.intensity = (u.uOn.value * (0.6 + heat * 2.2) * flick + flareK * 9) * 1.0;
        if (on && heat > 0.55 && wok) {
          const bp = root.localToWorld(tmp.set(CART.burner.x, CART.stand + 0.02, CART.burner.z));
          fx.rate('lick' + e.id, (heat - 0.5) * 30, dt, () => fx.lick(bp, heat));
        }
        // ---- night tube light
        const night = game.clock?.nightFactor ?? 0;
        m.tubeLight.intensity = night * 2.4;
        (m.tubeL.material as THREE.MeshStandardMaterial).emissiveIntensity = night * 2.5;
        // ---- sounds (local loops near the listener)
        const camD = game.camera ? game.camera.getWorldPosition(tmp).distanceTo(root.position) : 99;
        if (on && camD < 22) {
          const bp = root.localToWorld(new THREE.Vector3(CART.burner.x, CART.burner.y, CART.burner.z));
          if (!roar) roar = Sound.loop(pickKey(['burner_roar_loop', 'gas_burner_loop', 'fire_roar_loop']), { pos: bp, vol: 0 });
          roar.setPos(bp);
          roar.setVolume(0.25 + heat * 0.9, 0.2);
          roar.setPitch(0.85 + heat * 0.3, 0.2);
          if (!hiss) hiss = Sound.loop(pickKey(['gas_hiss_loop', 'gas_hiss']), { pos: bp, vol: 0.15 });
          hiss.setPos(bp);
        } else {
          roar?.stop(0.4); roar = null;
          hiss?.stop(0.3); hiss = null;
        }
        if (speed > 0.25 && camD < 25) {
          if (!roll) roll = Sound.loop(pickKey(['cart_roll_loop', 'cart_rattle_loop', 'wheel_roll_loop']), { pos: root.position, vol: 0 });
          roll.setPos(root.position);
          roll.setVolume(Math.min(1, speed / 2) * 0.8, 0.15);
        } else if (roll) { roll.stop(0.3); roll = null; }
      },
      dispose: () => {
        offFlare();
        roar?.stop(0.2); hiss?.stop(0.2); roll?.stop(0.2);
        game.interact.unregister(root);
        if (L.phys) { game.physics?.removeBody(L.phys.body); L.phys = null; }
        local.delete(e.id);
      },
    };
    return view;
  };
}

// ------------------------------------------------------------------ pushing (pusher's client)

let pushHint = false;
export function pushLateUpdate(game: Game, dt: number) {
  const me = game.me;
  const lp = game.player;
  if (!me || !lp || !game.physics) return;
  const cart = game.state.find('cart', (c) => c.pusher === me.id);
  if (!cart) { for (const l of local.values()) l.pred = null; return; }
  const L = getLocal(cart.id);
  if (!L.pred) {
    const p = cart.p ?? [0, 0, 0];
    L.pred = { x: p[0], y: p[1], z: p[2], yaw: cart.yaw ?? 0, sendT: 0 };
    if (!pushHint) { pushHint = true; game.interact.hintOnce('cook.push', 'เข็นรถ: เดิน [W] หันเมาส์เลี้ยว · [E] ปล่อย', 6); }
  }
  const P = L.pred;
  const want = lp.yaw - Math.PI / 2;
  const dyaw = clamp(angleDiff(P.yaw, want), -PUSH_TURN * dt, PUSH_TURN * dt);
  const len = CART.pushLen;
  const tryYaw = P.yaw + dyaw;
  const dirX = Math.cos(tryYaw), dirZ = -Math.sin(tryYaw);
  let mx = lp.pos.x - dirX * len - P.x, mz = lp.pos.z - dirZ * len - P.z;
  const ml = Math.hypot(mx, mz), max = PUSH_SPEED * dt;
  if (ml > max) { mx *= max / ml; mz *= max / ml; }
  const body = L.phys?.body;
  const blocked = (x: number, z: number, yaw: number) => cartBlocked(game, x, P.y, z, yaw, body);
  let yaw = tryYaw;
  if (blocked(P.x + mx, P.z + mz, yaw)) {
    if (!blocked(P.x + mx, P.z, yaw)) mz = 0;
    else if (!blocked(P.x, P.z + mz, yaw)) mx = 0;
    else { mx = 0; mz = 0; if (blocked(P.x, P.z, yaw)) yaw = P.yaw; }
  }
  P.x += mx; P.z += mz; P.yaw = yaw;
  // ground follow (wheels over curbs)
  const gy = game.physics.raycast(new THREE.Vector3(P.x, P.y + 1.2, P.z), new THREE.Vector3(0, -1, 0), 3, G.STATIC, undefined, body ?? undefined);
  const ty = gy ? gy.point.y : P.y;
  P.y += (ty - P.y) * damp(14, dt);
  // keep the pusher at the handle
  const hx = P.x + Math.cos(P.yaw) * len, hz = P.z - Math.sin(P.yaw) * len;
  lp.pos.x = hx; lp.pos.z = hz;
  const lb = (lp as any).body as RAPIER.RigidBody | null;
  lb?.setNextKinematicTranslation({ x: lp.pos.x, y: lp.pos.y + lp.height / 2, z: lp.pos.z });
  me.p = [rd(lp.pos.x, 3), rd(lp.pos.y, 3), rd(lp.pos.z, 3)];
  lp.placeCamera(dt, false);
  // tell the host (≈15 Hz)
  P.sendT -= dt;
  if (P.sendT <= 0) {
    P.sendT = 1 / 15;
    game.intent('cart.move', { id: cart.id, p: [rd(P.x, 3), rd(P.y, 3), rd(P.z, 3)], yaw: rd(P.yaw, 3) });
  }
}

const _shape = new Map<string, any>();
function cartBlocked(game: Game, x: number, y: number, z: number, yaw: number, exclude?: RAPIER.RigidBody | null) {
  const phys = game.physics;
  const R = phys.R;
  let box = _shape.get('box');
  if (!box) { box = new R.Cuboid(0.98, 0.3, 0.4); _shape.set('box', box); }
  // shape centre: covers burner end → flap, from 0.22 m (curbs pass under) up to ~0.82
  const cx = -0.05, cz = 0.02, cy = 0.52;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pos = { x: x + cx * c + cz * s, y: y + cy, z: z - cx * s + cz * c };
  const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const hit = phys.world.intersectionWithShape(pos, rot, box, undefined, groups(G.ALL, G.STATIC), undefined, exclude ?? undefined);
  return !!hit;
}

// ------------------------------------------------------------------ host

export function cartHostUpdate(game: Game, dt: number) {
  for (const c of game.state.all('cart')) {
    if (c.burner?.on) {
      c.gas = Math.max(0, (c.gas ?? 1) - (c.burner.heat ?? 0.5) * dt / GAS_SECONDS);
      if (c.gas <= 0) {
        c.burner = { ...c.burner, on: false };
        const bp = cartLocalToWorld(game, c, [CART.burner.x, CART.burner.y, CART.burner.z]);
        sfx(game, ['gas_sputter', 'knob_click'], bp, { vol: 0.8 });
        game.popup([bp.x, bp.y + 0.6, bp.z], 'แก๊สหมด!');
      }
    }
    if (c.pusher != null) {
      const pl = game.state.get(c.pusher);
      if (!pl || pl.mode !== 'push') stopPush(game, c);
    }
  }
}

export function stopPush(game: Game, c: Ent) {
  const pl = game.state.get(c.pusher);
  c.pusher = null;
  if (pl && pl.mode === 'push') { pl.mode = 'free'; pl.anim = 'idle'; pl.animT = game.g.time + Math.random(); pl.animLoop = true; }
}

export function installCartIntents(game: Game) {
  const near = (pl: Ent, c: Ent, max = 3.2) => {
    if (!pl.p || !c.p) return false;
    return Math.hypot(pl.p[0] - c.p[0], pl.p[2] - c.p[2]) < max;
  };
  game.onIntent('cart.burner', (pl, d: { id: number; on: boolean }) => {
    const c = game.state.get(d.id);
    if (!c || c.t !== 'cart' || !near(pl, c)) return;
    const bp = cartLocalToWorld(game, c, [CART.knob.x, CART.knob.y, CART.knob.z]);
    if (d.on && (c.gas ?? 0) <= 0.001) {
      sfx(game, ['gas_click', 'knob_click'], bp, { vol: 0.8 });
      game.say(pl.id, tl('แก๊สหมดแล้ว! ต้องไปเปลี่ยนถัง', 'out of gas!'), { duration: 2.2 });
      return;
    }
    c.burner = { ...(c.burner ?? { heat: 0.6 }), on: !!d.on };
    sfx(game, d.on ? ['gas_ignite', 'burner_ignite', 'lighter_click'] : ['knob_click', 'gas_click'], bp, { vol: 0.9 });
  });
  game.onIntent('cart.heat', (pl, d: { id: number; v: number }) => {
    const c = game.state.get(d.id);
    if (!c || c.t !== 'cart' || !near(pl, c)) return;
    c.burner = { ...(c.burner ?? { on: false }), heat: rd(clamp(+d.v || 0, 0.08, 1), 2) };
  });
  game.onIntent('cart.push', (pl, d: { id: number; on: boolean }) => {
    const c = game.state.get(d.id);
    if (!c || c.t !== 'cart') return;
    if (!d.on) { if (c.pusher === pl.id) stopPush(game, c); return; }
    if (c.pusher != null && c.pusher !== pl.id) { game.say(pl.id, tl('มีคนเข็นอยู่!', 'someone is pushing'), { duration: 1.6 }); return; }
    if (!near(pl, c, 2.8)) return;
    if (game.items.isOverloaded(pl)) return;
    c.pusher = pl.id;
    pl.mode = 'push';
    pl.anim = 'push_cart'; pl.animT = game.g.time + Math.random(); pl.animLoop = true;
    sfx(game, ['cart_grab', 'metal_clank', 'drop_soft'], c.p, { vol: 0.7 });
  });
  game.onIntent('cart.move', (pl, d: { id: number; p: number[]; yaw: number }) => {
    const c = game.state.get(d.id);
    if (!c || c.pusher !== pl.id || !Array.isArray(d.p) || !d.p.every(Number.isFinite)) return;
    if (pl.p && Math.hypot(pl.p[0] - d.p[0], pl.p[2] - d.p[2]) > 3.5) return;
    c.p = [d.p[0], d.p[1], d.p[2]];
    c.yaw = +d.yaw || 0;
  });
  game.onIntent('cart.put', (pl, d: { id: number; slot?: number; at: number[] }) => {
    const c = game.state.get(d.id);
    const it = game.state.get(pl.inv?.[d.slot ?? pl.sel ?? 0]);
    if (!c || c.t !== 'cart' || !it || it.holder !== pl.id || !near(pl, c, 3.4) || !Array.isArray(d.at)) return;
    putOnCart(game, it, c, d.at);
    const w = cartLocalToWorld(game, c, d.at);
    const def = game.items.defOf(it);
    sfx(game, def?.tags?.includes('metal') ? ['metal_clank', 'plate_down'] : def?.tags?.includes('glass') ? ['bottle_down', 'plate_down'] : ['plate_down', 'drop_soft'], w, { vol: 0.6 });
    game.events.emit('item:placed', { player: pl.id, item: it.id, cart: c.id });
  });
  game.onIntent('cart.gas', (pl, d: { id: number }) => {
    const c = game.state.get(d.id);
    const tank = game.items.selected(pl);
    if (!c || c.t !== 'cart' || !tank || tank.k !== 'gas_tank' || !near(pl, c, 3)) return;
    const full = tank.data?.gas ?? 0;
    tank.data = { ...(tank.data ?? {}), gas: rd(c.gas ?? 0, 3) };
    c.gas = full;
    if (c.burner?.on && full <= 0) c.burner = { ...c.burner, on: false };
    const w = cartLocalToWorld(game, c, [CART.tank.x, 0.5, CART.tank.z]);
    sfx(game, ['tank_clank', 'metal_clank'], w, { vol: 0.9 });
    sfx(game, ['gas_hiss', 'gas_hiss_loop'], w, { vol: 0.5, delay: 0.4 } as any);
    game.popup([w.x, w.y + 0.5, w.z], full > 0.5 ? 'เปลี่ยนถังแก๊สแล้ว!' : 'ถังนี้ก็หมด…');
  });
}

/** HOST: attach an item to a cart at a local spot (with stacking for plates & co). */
export function putOnCart(game: Game, it: Ent, c: Ent, at: ArrayLike<number>) {
  let x = clamp(at[0], CART_BOUNDS.x0, CART_BOUNDS.x1), y = clamp(at[1], CART_BOUNDS.y0, CART_BOUNDS.y1), z = clamp(at[2], CART_BOUNDS.z0, CART_BOUNDS.z1);
  let yaw = at[3] ?? 0;
  const def = game.items.defOf(it);
  const stack = def?.tags?.includes('stack');
  if (stack) {
    let top = -1;
    for (const o of game.state.all('item')) {
      if (o === it || o.in !== c.id || !o.at || o.k !== it.k) continue;
      if (Math.hypot(o.at[0] - x, o.at[2] - z) < 0.09) top = Math.max(top, o.at[1]);
    }
    if (top >= 0) { const s = SPOTS; void s; y = top + (it.k === 'bowl' ? 0.04 : it.k === 'takeaway_box' ? 0.05 : 0.024); }
  }
  // burner snap for woks / pots
  const b = SPOTS.burner;
  if (def?.tags?.includes('burner') && Math.hypot(x - b[0], z - b[2]) < 0.32) { x = b[0]; y = b[1]; z = b[2]; yaw = b[3]; }
  game.items.detach(it);
  it.in = c.id;
  it.at = [rd(x, 3), rd(y, 3), rd(z, 3), rd(yaw, 3)];
  const kids = game.state.all('item').filter((o) => o.in === c.id);
  it.ord = kids.reduce((a, o) => Math.max(a, o.ord ?? 0), 0) + 1;
}

/** Local spot → snapped `at` for a click on the cart (client side). */
export function snapCartPoint(local: THREE.Vector3, heldTags: string[] | undefined, yawLocal: number): number[] {
  const b = SPOTS.burner;
  if (heldTags?.includes('burner') && Math.hypot(local.x - b[0], local.z - b[2]) < 0.32) return [b[0], b[1], b[2], b[3]];
  const s = surfaceAt(local.x, local.z, local.y);
  const y = s ? s.y : local.y;
  return [rd(local.x, 3), rd(y + 0.002, 3), rd(local.z, 3), rd(yawLocal, 3)];
}

// ------------------------------------------------------------------ interaction provider (client)

export function cartProvider(game: Game, heatState: { v: number; t: number }) {
  return (ctx: Ctx): Action[] | null => {
    const me = ctx.me;
    const acts: Action[] = [];
    // while pushing: E releases (wins everything)
    const pushing = game.state.find('cart', (c) => c.pusher === me.id);
    if (pushing) {
      acts.push({ key: 'E', label: tl('ปล่อยรถเข็น', 'let go'), priority: 1000, run: () => game.intent('cart.push', { id: pushing.id, on: false }) });
      return acts;
    }
    const hit = ctx.hit;
    if (!hit || hit.kind !== 'cart' || !hit.ent) return null;
    const cart = hit.ent;
    const obj = hit.object;
    const lp = obj.worldToLocal(hit.point.clone());
    const part = partAt(lp);
    const held = ctx.held;
    const hdef = held ? game.items.defOf(held) : null;
    if (part === 'knob') {
      const on = !!cart.burner?.on;
      const status = () => {
        const c = game.state.get(cart.id) ?? cart;
        const h = Math.round((c.burner?.heat ?? 0.6) * 100);
        return `เตาแก๊ส · ${c.burner?.on ? 'ไฟ ' + h + '%' : 'ปิดอยู่'} · แก๊ส ${Math.round((c.gas ?? 0) * 100)}%`;
      };
      acts.push({ key: 'E', label: tl(on ? 'ปิดเตา' : 'เปิดเตา', on ? 'turn off' : 'ignite'), priority: 20, status, run: () => game.intent('cart.burner', { id: cart.id, on: !on }) });
      const adj = (dir: number): Action => ({
        key: dir > 0 ? 'LMB' : 'RMB', label: tl(dir > 0 ? 'เร่งไฟ' : 'หรี่ไฟ', dir > 0 ? 'more heat' : 'less heat'), priority: 20, hold: true, status,
        run: () => { heatState.v = game.state.get(cart.id)?.burner?.heat ?? 0.6; heatState.t = 0; Sound.play(pickKey(['knob_click', 'click']), { vol: 0.4 }); },
        tick: (_c, dt) => {
          heatState.v = clamp(heatState.v + dir * dt * 0.75, 0.08, 1);
          heatState.t -= dt;
          if (heatState.t <= 0) { heatState.t = 0.08; game.intent('cart.heat', { id: cart.id, v: rd(heatState.v, 2) }); }
        },
        end: () => game.intent('cart.heat', { id: cart.id, v: rd(heatState.v, 2) }),
      });
      acts.push(adj(1), adj(-1));
      return acts;
    }
    if (part === 'handle') {
      let t0 = 0;
      let sent = false;
      acts.push({
        key: 'E', label: tl('กดค้าง: เข็นรถ', 'hold: push cart'), priority: 20, hold: true,
        status: () => (sent ? 'เข็น!' : `จับรถเข็น… ${Math.min(100, Math.round((t0 / 0.35) * 100))}%`),
        run: () => { t0 = 0; sent = false; },
        tick: (_c, dt) => { t0 += dt; if (!sent && t0 >= 0.35) { sent = true; game.intent('cart.push', { id: cart.id, on: true }); } },
      });
      return acts;
    }
    if (part === 'tank') {
      if (held?.k === 'gas_tank') acts.push({ key: 'E', label: tl('เปลี่ยนถังแก๊ส', 'swap gas tank'), priority: 20, run: () => game.intent('cart.gas', { id: cart.id }) });
      acts.push({ key: 'F', label: tl('ดูแก๊ส', 'check gas'), priority: 3, status: () => `ถังแก๊ส · เหลือ ${Math.round(((game.state.get(cart.id) ?? cart).gas ?? 0) * 100)}%`, run: () => {} });
    }
    // place the held item onto the cart surface
    if (held && hit.normal.y > 0.5 && !hdef?.noPickup) {
      const yawLocal = (me.yaw ?? 0) - (obj.rotation.y ?? 0);
      const at = snapCartPoint(lp, hdef?.tags, yawLocal);
      const onBurner = at[0] === SPOTS.burner[0] && at[2] === SPOTS.burner[2];
      acts.push({ key: 'LMB', label: tl(onBurner ? 'วางบนเตา' : 'วางบนรถเข็น', onBurner ? 'put on burner' : 'put on cart'), priority: 2, run: () => game.intent('cart.put', { id: cart.id, slot: me.sel ?? 0, at }) });
    }
    return acts;
  };
}

export { tube, bar, pbr };
