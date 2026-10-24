import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { RNG } from '../../core/rng';
import { WB, ALL, SIDES, PX, NX, PY, NY, PZ, NZ } from './geo';
import type { SpecialCtx } from './buildings';
import { flat } from './streets';
import { card, bananaTree, coconutPalm, pottedPlant } from './foliage';
import { PLASTIC_COLORS } from './props';
import { EMIS, U } from './mats';
import { CANAL, BRIDGE, CROAD, SW_H, RURAL_Y, groundHeight } from './layout';

/**
 * CANAL (คลอง) — murky green water shader with two scrolling normal layers + algae patches,
 * mossy concrete banks with railings, wooden stilt houses with decks/ladders/water jars, a moored
 * long-tail boat, floating hyacinth & trash, and the small arched bridge at x 0.
 */

const VIS = 420;

export function makeWaterMaterial(color = 0x2c3a24, deep = 0x161f14): THREE.MeshStandardMaterial {
  const normal = Assets.hasPbr('water_canal_calm')
    ? Assets.texture('textures/pbr/water_canal_calm/normal.jpg', { srgb: false })
    : null;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.07, metalness: 0.0, envMapIntensity: 1.1 });
  m.name = 'world-water';
  if (normal) { normal.wrapS = normal.wrapT = THREE.RepeatWrapping; }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWN = { value: normal };
    shader.uniforms.uDeep = { value: new THREE.Color(deep) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWP;`).replace('#include <fog_vertex>', `#include <fog_vertex>
vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime; uniform sampler2D uWN; uniform vec3 uDeep; varying vec3 vWP;
float wh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float wn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `
float algae = wn(vWP.xz * 0.18) * 0.6 + wn(vWP.xz * 0.9 + 3.0) * 0.4;
diffuseColor.rgb = mix(uDeep, diffuseColor.rgb * 1.25, smoothstep(0.35, 0.8, algae));
`)
      .replace('#include <normal_fragment_maps>', `
{
  vec2 uv1 = vWP.xz / 6.0 + vec2(uTime * 0.012, uTime * 0.004);
  vec2 uv2 = vWP.xz / 3.3 + vec2(-uTime * 0.009, uTime * 0.011);
  vec3 n1 = texture2D(uWN, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWN, uv2).xyz * 2.0 - 1.0;
  vec3 nn = normalize(vec3(n1.xy + n2.xy, 1.6));
  vec3 wN = normalize(vec3(nn.x, nn.z, -nn.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
}`);
  };
  m.customProgramCacheKey = () => 'world-water-v1';
  return m;
}

export function buildCanal(c: SpecialCtx) {
  const w = c.w, rng = c.rng, F = c.fol;
  const zS = CANAL.zS, zN = CANAL.zN, wy = CANAL.water, bed = CANAL.bed;
  // ---------------------------------------------------------------- water plane (own mesh, chunked strips)
  const water = new THREE.Group();
  water.name = 'canal-water';
  const wm = makeWaterMaterial();
  for (let x = -VIS; x < VIS; x += 60) {
    const g = new THREE.PlaneGeometry(60, zS - zN, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, wm);
    m.position.set(x + 30, wy, (zS + zN) / 2);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    water.add(m);
  }
  pendingWater.push(water);
  c.holes.push({ x0: -VIS, z0: zN - 4.5, x1: VIS, z1: zS });
  // bed + walls
  w.mat('mud', { tint: 0x4a4a3a, autoDirt: false });
  flat(w, -VIS, zN, VIS, zS, bed, 30);
  w.mat('concrete_mossy', { ov: 'plaster_moldy', ovAmt: 0.85 });
  for (let x = -VIS; x < VIS; x += 20) {
    const x1 = x + 20;
    w.quad(x1, bed, zS, x, bed, zS, x, SW_H, zS, x1, SW_H, zS);       // south wall faces -z (water side)
    w.quad(x, bed, zN, x1, bed, zN, x1, RURAL_Y, zN, x, RURAL_Y, zN); // north wall faces +z
  }
  // waterline grime band (dark algae) just above the water on both walls
  w.mat('concrete_mossy', { tint: 0x5a6a4a, autoDirt: false });
  for (let x = -VIS; x < VIS; x += 20) {
    w.quad(x + 20, wy, zS - 0.01, x, wy, zS - 0.01, x, wy + 0.45, zS - 0.01, x + 20, wy + 0.45, zS - 0.01);
    w.quad(x, wy, zN + 0.01, x + 20, wy, zN + 0.01, x + 20, wy + 0.4, zN + 0.01, x, wy + 0.4, zN + 0.01);
  }
  // north bank ground strip (rural level) to the stilt house row
  w.mat('dirt', { autoDirt: false, ov: 'grass', ovAmt: 0.7 });
  flat(w, -VIS, CANAL.bankN, VIS, zN, RURAL_Y, 20);
  // colliders: water floor (players who climb in stand in the water), walls/railings keep them out
  c.phys.box([0, bed - 0.5, (zS + zN) / 2], [840, 1, zS - zN]);
  // ---------------------------------------------------------------- south railing (steel pipes) + north low wall
  w.setGroup('detail');
  w.mat('metal_paint', { tint: 0xd8d4c8, ov: 'steel_rust', ovAmt: 0.6, uv: 'local' });
  for (let x = -VIS; x < VIS; x += 2.4) {
    if (x > BRIDGE.x0 - 2.6 && x < BRIDGE.x1 + 0.2) continue;
    w.box(x - 0.04, SW_H, zS + 0.08, x + 0.04, SW_H + 1.05, zS + 0.16, SIDES | PY);
    w.tube([x, SW_H + 1.0, zS + 0.12, x + 2.4, SW_H + 1.0, zS + 0.12], 0.025, 4);
    w.tube([x, SW_H + 0.55, zS + 0.12, x + 2.4, SW_H + 0.55, zS + 0.12], 0.02, 4);
  }
  w.setGroup('base');
  c.phys.box([(-VIS + BRIDGE.x0) / 2 - 1, 0.7, zS + 0.12], [VIS + BRIDGE.x0 - 2, 1.4, 0.12]);
  c.phys.box([(BRIDGE.x1 + VIS) / 2 + 1, 0.7, zS + 0.12], [VIS - BRIDGE.x1 - 2, 1.4, 0.12]);
  w.mat('cement_block', { ov: 'concrete_mossy', ovAmt: 0.8 });
  for (let x = -VIS; x < VIS; x += 20) {
    if (x + 20 > BRIDGE.x0 - 1 && x < BRIDGE.x1 + 1) { w.box(x, RURAL_Y, zN - 0.25, BRIDGE.x0 - 1.2, RURAL_Y + 0.7, zN, ALL & ~NY); w.box(BRIDGE.x1 + 1.2, RURAL_Y, zN - 0.25, x + 20, RURAL_Y + 0.7, zN, ALL & ~NY); continue; }
    w.box(x, RURAL_Y, zN - 0.25, x + 20, RURAL_Y + 0.7, zN, PY | PZ | NZ);
  }
  c.phys.box([(-VIS + BRIDGE.x0) / 2 - 1, 0.6, zN - 0.12], [VIS + BRIDGE.x0 - 2, 1.2, 0.25]);
  c.phys.box([(BRIDGE.x1 + VIS) / 2 + 1, 0.6, zN - 0.12], [VIS - BRIDGE.x1 - 2, 1.2, 0.25]);
  // ---------------------------------------------------------------- bridge
  bridge(c);
  // ---------------------------------------------------------------- stilt houses on the north bank (over the water)
  const xs: number[] = [];
  for (let x = -96; x < -12; x += rng.range(8.5, 12)) xs.push(x);
  for (let x = 14; x < 96; x += rng.range(8.5, 12)) xs.push(x);
  for (const x of xs) stiltHouse(c, x, rng);
  // long-tail boat moored + floating hyacinth / trash
  boat(c, -9, zN + 1.3, rng);
  boat(c, 26, zN + 1.1, rng);
  if (F) for (let i = 0; i < 60; i++) {
    const r = F.rect('hyacinth', rng) ?? F.rect('leaf_cluster', rng);
    if (!r) break;
    const x = rng.range(-140, 140), z = rng.range(zN + 0.4, zS - 0.4);
    for (let k = 0; k < 3; k++) card(w, r, x + rng.range(-0.6, 0.6), wy - 0.05, z + rng.range(-0.4, 0.4), rng.range(0.6, 1.1), rng.range(0.35, 0.6), rng.range(0, 6), { wind: 0.15, flutter: 0.3, tint: 0xd8e8c0 });
  }
  w.setGroup('detail');
  for (let i = 0; i < 40; i++) {
    w.mat(rng.chance(0.5) ? 'plastic_gloss' : 'plastic', { tint: rng.pick([0xe8f0f0, 0x6ab0d8, 0xf0f0e8, 0x2a8a3e, 0xe8e0c0]), uv: 'local' });
    const x = rng.range(-120, 120), z = rng.range(zN + 0.3, zS - 0.3);
    w.pushTR(x, wy + 0.02, z, Math.PI / 2, rng.range(0, 6), 0);
    w.cyl(0, -0.1, 0, 0.035, 0.035, 0.2, 6, 3);
    w.pop();
  }
  w.setGroup('base');
}

/** water meshes created by buildCanal (added to the world root by index.ts) */
export const pendingWater: THREE.Object3D[] = [];

function bridge(c: SpecialCtx) {
  const w = c.w;
  const x0 = BRIDGE.x0, x1 = BRIDGE.x1, zA = BRIDGE.zS, zB = BRIDGE.zN;
  const n = 18;
  const yAt = (z: number) => groundHeight(0, z);
  // deck surface (concrete) as strips following the arch, + underside
  for (let i = 0; i < n; i++) {
    const za = zA + ((zB - zA) * i) / n, zb = zA + ((zB - zA) * (i + 1)) / n;
    const ya = yAt(za), yb = yAt(zb);
    w.mat('concrete_road', { autoDirt: false, tint: 0xb8b2a8 });
    w.quad(x0, ya, za, x1, ya, za, x1, yb, zb, x0, yb, zb);
    w.mat('concrete_mossy', { ov: 'plaster_moldy', ovAmt: 0.6 });
    w.quad(x1, ya - 0.55, za, x0, ya - 0.55, za, x0, yb - 0.55, zb, x1, yb - 0.55, zb);
    // side faces
    w.quad(x0, ya - 0.55, za, x0, ya, za, x0, yb, zb, x0, yb - 0.55, zb);
    w.quad(x1, ya, za, x1, ya - 0.55, za, x1, yb - 0.55, zb, x1, yb, zb);
    // balustrade with pillars
    w.mat('concrete_old', { tint: 0xd0cac0, ov: 'concrete_mossy', ovAmt: 0.6 });
    for (const xs of [x0 + 0.1, x1 - 0.1]) {
      w.quad(xs, ya + 0.85, za, xs, ya + 0.85, zb, xs, yb + 1.0, zb, xs, ya + 1.0, za);
      w.box(xs - 0.12, Math.min(ya, yb), za - 0.12, xs + 0.12, Math.max(ya, yb) + 1.05, za + 0.12, SIDES | PY);
    }
    // collider step (keeps the walkable surface consistent with groundY)
    const ym = Math.max(ya, yb);
    c.phys.box([0, ym / 2 - 0.3, (za + zb) / 2], [x1 - x0, ym + 0.6, Math.abs(zb - za)]);
    for (const xs of [x0 + 0.1, x1 - 0.1]) c.phys.box([xs, ym + 0.5, (za + zb) / 2], [0.25, 1.1, Math.abs(zb - za)]);
  }
  // bridge piers in the water
  w.mat('concrete_mossy', { ov: 'plaster_moldy', ovAmt: 0.8 });
  for (const z of [-168, -172]) w.box(x0 + 0.3, CANAL.bed, z - 0.4, x1 - 0.3, yAt(z) - 0.5, z + 0.4, SIDES);
  // lamps on the bridge
  for (const z of [-163, -177]) {
    w.mat('galv', { tint: 0xc8c8c0, uv: 'local' });
    w.cyl(x1 - 0.1, yAt(z) + 1.0, z, 0.06, 0.05, 3.2, 6, 1);
    w.mat('glass', { tint: 0xfff0d8, emis: EMIS.warm.i, emisK: 0.9, uv: 'local' });
    w.cyl(x1 - 0.1, yAt(z) + 4.2, z, 0.16, 0.2, 0.32, 8, 3);
    c.lights.add({ p: new THREE.Vector3(x1 - 0.1, yAt(z) + 4.3, z), color: new THREE.Color(0xffc070), intensity: 14, range: 12, glow: 0.8, kind: 'lamp' });
  }
}

function stiltHouse(c: SpecialCtx, x: number, rng: RNG) {
  const w = c.w, F = c.fol;
  const W = rng.range(5.5, 8), D = rng.range(5.5, 7.5);
  const z0 = CANAL.zN + rng.range(1.2, 2.4);   // front over the water
  const z1 = z0 - D;
  const fy = rng.range(0.7, 1.2);              // floor height
  const wallH = 2.6;
  const plank = rng.pick(['wood_old', 'wood_paint', 'wood_old']);
  const pt = plank === 'wood_paint' ? rng.pick([0x6a8a7a, 0x8a6a4a, 0x5a6a8a, 0xa09078]) : 0xffffff;
  // stilts
  w.mat('wood_old', { tint: 0x8a7a68, uv: 'local' });
  for (let xx = x; xx <= x + W + 0.01; xx += W / 3) for (let zz = z1; zz <= z0 + 0.01; zz += D / 2) w.box(xx - 0.09, CANAL.bed, zz - 0.09, xx + 0.09, fy, zz + 0.09, SIDES);
  // deck platform over the water (front) + floor
  w.mat('wood_old', { uv: 'world' });
  w.box(x - 0.3, fy - 0.12, z0, x + W + 0.3, fy, z0 + 1.6, ALL);
  w.box(x, fy - 0.12, z1, x + W, fy, z0, PY | NY);
  // walls with a door and window holes (wooden planks, painted or raw)
  w.mat(plank, { tint: pt, ov: 'plaster_moldy', ovAmt: 0.5, uv: 'world' });
  const holesF = [[x + 0.8, x + 1.7, fy, fy + 2.0], [x + W - 2.4, x + W - 0.9, fy + 0.9, fy + 1.9]];
  frontWall(w, x, x + W, fy, fy + wallH, z0, holesF);
  w.quad(x, fy, z1, x, fy, z0, x, fy + wallH, z0, x, fy + wallH, z1);
  w.quad(x + W, fy, z0, x + W, fy, z1, x + W, fy + wallH, z1, x + W, fy + wallH, z0);
  w.quad(x + W, fy, z1, x, fy, z1, x, fy + wallH, z1, x + W, fy + wallH, z1);
  // dark interior behind the openings
  w.mat('wood_old', { tint: 0x2a2620, ao: 0.4 });
  w.quad(x + 0.2, fy, z0 - 1.5, x + W - 0.2, fy, z0 - 1.5, x + W - 0.2, fy + wallH, z0 - 1.5, x + 0.2, fy + wallH, z0 - 1.5);
  // window shutters (one open)
  w.mat('wood_paint', { tint: rng.pick([0x3a5a4a, 0x6a3a2a, 0x2a4a6a]), uv: 'local' });
  w.box(x + W - 2.4 - 0.75, fy + 0.9, z0 + 0.02, x + W - 2.4, fy + 1.9, z0 + 0.06, ALL);
  // gable roof (corrugated rusty or clay tiles)
  const roofL = rng.pick(['corr_rust', 'roof_galv', 'roof_tiles', 'corr_rust']);
  w.mat(roofL, { uv: 'world', ao: 0.95 });
  const ry = fy + wallH, rh = rng.range(1.2, 1.8), xm = x + W / 2;
  w.quad(x - 0.5, ry - 0.1, z0 + 0.6, x - 0.5, ry - 0.1, z1 - 0.6, xm, ry + rh, z1 - 0.6, xm, ry + rh, z0 + 0.6);
  w.quad(x + W + 0.5, ry - 0.1, z1 - 0.6, x + W + 0.5, ry - 0.1, z0 + 0.6, xm, ry + rh, z0 + 0.6, xm, ry + rh, z1 - 0.6);
  w.mat(roofL, { uv: 'world', ao: 0.5, tint: 0x8a8a8a });
  w.quad(x - 0.5, ry - 0.11, z1 - 0.6, x - 0.5, ry - 0.11, z0 + 0.6, xm, ry + rh - 0.01, z0 + 0.6, xm, ry + rh - 0.01, z1 - 0.6);
  w.quad(x + W + 0.5, ry - 0.11, z0 + 0.6, x + W + 0.5, ry - 0.11, z1 - 0.6, xm, ry + rh - 0.01, z1 - 0.6, xm, ry + rh - 0.01, z0 + 0.6);
  w.mat(plank, { tint: pt, uv: 'world' });
  w.tri(x, ry, z0, x + W, ry, z0, xm, ry + rh, z0);
  w.tri(x + W, ry, z1, x, ry, z1, xm, ry + rh, z1);
  // deck railing + ladder to the water + water jars + plants + laundry
  w.setGroup('detail');
  w.mat('wood_old', { uv: 'local' });
  for (let xx = x - 0.2; xx < x + W + 0.3; xx += 0.9) w.box(xx - 0.04, fy, z0 + 1.5, xx + 0.04, fy + 0.85, z0 + 1.58, SIDES);
  w.box(x - 0.3, fy + 0.8, z0 + 1.5, x + W + 0.3, fy + 0.88, z0 + 1.58, ALL);
  w.box(x + W * 0.5 - 0.3, CANAL.water - 0.6, z0 + 1.6, x + W * 0.5 - 0.25, fy, z0 + 1.65, ALL);
  w.box(x + W * 0.5 + 0.25, CANAL.water - 0.6, z0 + 1.6, x + W * 0.5 + 0.3, fy, z0 + 1.65, ALL);
  for (let y = CANAL.water - 0.4; y < fy; y += 0.3) w.box(x + W * 0.5 - 0.3, y, z0 + 1.6, x + W * 0.5 + 0.3, y + 0.04, z0 + 1.66, ALL);
  w.mat('tiles_terracotta', { tint: 0x6a3a22, uv: 'local' });
  for (let k = 0; k < rng.int(1, 3); k++) { const jx = x + 0.4 + k * 0.7; w.cyl(jx, fy, z0 + 0.6, 0.28, 0.36, 0.5, 9, 0, 0, 0.03); w.cyl(jx, fy + 0.5, z0 + 0.6, 0.36, 0.22, 0.22, 9, 1, 0, 0.03); }
  if (rng.chance(0.6)) {
    w.mat('rubber', { uv: 'local' });
    w.tube([x, fy + 2.0, z0 + 1.2, x + W, fy + 2.0, z0 + 1.2], 0.005, 3);
    let lx = x + 0.3;
    while (lx < x + W - 0.6) {
      const cw = rng.range(0.35, 0.65), ch = rng.range(0.4, 0.8);
      w.mat('fabric', { tint: rng.pick([0xffffff, 0xd03030, 0x3050c0, 0xe0c020, 0x30a050, 0x202020, 0xe08030]), uv: 'local' });
      w.quad(lx, fy + 2.0 - ch, z0 + 1.2, lx + cw, fy + 2.0 - ch, z0 + 1.2, lx + cw, fy + 2.0, z0 + 1.2, lx, fy + 2.0, z0 + 1.2);
      w.quad(lx + cw, fy + 2.0 - ch, z0 + 1.19, lx, fy + 2.0 - ch, z0 + 1.19, lx, fy + 2.0, z0 + 1.19, lx + cw, fy + 2.0, z0 + 1.19);
      lx += cw + rng.range(0.1, 0.3);
    }
  }
  w.setGroup('base');
  if (F) { if (rng.chance(0.6)) pottedPlant(w, F, x + W - 0.4, fy, z0 + 1.1, rng); if (rng.chance(0.4)) bananaTree(w, F, x + W + 1.4, RURAL_Y, z1 - 1.5, rng, 0.85); if (rng.chance(0.25)) coconutPalm(w, F, x - 1.5, RURAL_Y, z1 - 2, rng, 0.9); }
  // light at night (warm bulb on the deck)
  if (rng.chance(0.7)) {
    w.mat('glass', { tint: 0xfff0d0, emis: EMIS.warm.i, emisK: 0.8, uv: 'local' });
    w.cyl(x + W * 0.3, fy + 2.3, z0 + 0.3, 0.05, 0.05, 0.1, 6, 3);
    c.lights.add({ p: new THREE.Vector3(x + W * 0.3, fy + 2.2, z0 + 0.4), color: new THREE.Color(0xffb870), intensity: 6, range: 7, glow: 0.4, kind: 'custom' });
  }
  c.phys.box([x + W / 2, fy + 1.5, (z0 + z1) / 2], [W, 3.2, D]);
}

function frontWall(w: WB, x0: number, x1: number, y0: number, y1: number, z: number, holes: number[][]) {
  const ys = [...new Set([y0, y1, ...holes.flatMap((h) => [h[2], h[3]])])].sort((a, b) => a - b);
  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i], yb = ys[i + 1];
    const cov = holes.filter((h) => h[2] <= ya + 1e-4 && h[3] >= yb - 1e-4).sort((a, b) => a[0] - b[0]);
    let x = x0;
    for (const h of cov) { if (h[0] > x) w.quad(x, ya, z, h[0], ya, z, h[0], yb, z, x, yb, z); x = Math.max(x, h[1]); }
    if (x < x1) w.quad(x, ya, z, x1, ya, z, x1, yb, z, x, yb, z);
  }
}

function boat(c: SpecialCtx, x: number, z: number, rng: RNG) {
  const w = c.w;
  const y = CANAL.water - 0.15, L = rng.range(6, 8), Wd = 1.1;
  w.setGroup('detail');
  w.mat('wood_paint', { tint: rng.pick([0x8a4a2a, 0x2a5a8a, 0x6a6a2a]), uv: 'local', ov: 'plaster_moldy', ovAmt: 0.4 });
  // hull: tapered prism (pointed bow), length along x
  const pts: [number, number][] = [[x - L / 2, z], [x - L / 2 + 0.6, z - Wd / 2], [x + L / 2 - 1.4, z - Wd / 2], [x + L / 2, z - 0.05], [x + L / 2 - 1.4, z + Wd / 2], [x - L / 2 + 0.6, z + Wd / 2]];
  w.prism(pts, y, y + 0.45, false, true);
  w.mat('wood_old', { uv: 'local' });
  w.fan(pts.map(([px, pz]) => [x + (px - x) * 0.92, z + (pz - z) * 0.85] as [number, number]), y + 0.25, true);
  // bow ribbons + long-tail engine shaft
  w.mat('fabric', { tint: 0xe03030, uv: 'local' });
  w.tube([x + L / 2, y + 0.45, z, x + L / 2 + 0.2, y + 0.9, z], 0.03, 4);
  w.mat('steel_rust', { uv: 'local' });
  w.box(x - L / 2 + 0.2, y + 0.4, z - 0.25, x - L / 2 + 0.8, y + 0.8, z + 0.25, ALL);
  w.tube([x - L / 2 + 0.5, y + 0.6, z, x - L / 2 - 2.2, y - 0.2, z], 0.03, 5);
  w.setGroup('base');
  void PLASTIC_COLORS; void PX; void NX; void PZ; void NZ; void CROAD;
}
