import * as THREE from 'three';
import { cachedMat } from './assets';
import { T } from './assets';
import { mesh, gc } from './mats';
import { mound, planarUV, scatter, tube, lathe } from './geo';
import { leafMat, chiliBits, chiliMat, withSSS } from './realfood';
import { heapGeo, heapMat, dishLeaves, limeWedge, shrimpGeo, cucumberSlice, cucumberMat } from './dish';
import { scan, MX, patTex } from './foodx';

/* =============================================================================================
 * Plated visuals for the round-5 recipes (seafood, premium, desserts). Same conventions as dish.ts:
 * plate food sits from y ≈ 0.004, bowl contents fill to y ≈ 0.045; `s` = cube-root portion scale.
 * ============================================================================================= */

export interface FoodCtx {
  fx: number; rx: number; s: number; burn: number; vis: any; bowl: boolean;
  add: (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], sc?: number) => THREE.Mesh;
}

const mat = (key: string, make: () => THREE.Material) => cachedMat('dx:' + key, make);
const glossy = (key: string, color: number, rough = 0.25, clear = 0.6) => mat(key, () => new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: clear, clearcoatRoughness: 0.2 }));
const broth = (key: string, color: number, op = 0.9) => mat('broth' + key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.05, transparent: true, opacity: op }));
const disc = (r: number) => gc('dxDisc' + r, () => { const c = new THREE.CircleGeometry(r, 30); c.rotateX(-Math.PI / 2); return c; });

const squidRings = () => gc('dxSquidRings', () => scatter(new THREE.TorusGeometry(0.009, 0.0035, 6, 14).rotateX(Math.PI / 2 + 0.3), 9, (_i, m, r) => {
  m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.9, r() * 6, (r() - 0.5) * 0.9));
  const a = r() * 6.3, rr = Math.sqrt(r()) * 0.045;
  m.setPosition(Math.cos(a) * rr, 0.022 + r() * 0.01, Math.sin(a) * rr);
}, 7));
const squidMat = () => mat('squidCooked', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xf6efe6, roughness: 0.25 }), { color: 0xffe8d8, wrap: 0.5, back: 0.4 }));
const musselsOpen = () => gc('dxMusselsOpen', () => scatter((() => { const h = new THREE.SphereGeometry(0.018, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); h.scale(1.5, 0.4, 0.75); h.rotateX(Math.PI); return h; })(), 3, (i, m) => { m.makeRotationY(i * 2.1); m.setPosition(Math.cos(i * 2.1) * 0.035, 0.03, Math.sin(i * 2.1) * 0.035); }, 3));
const musselMeat = () => mat('musselMeat', () => new THREE.MeshStandardMaterial({ color: 0xf2a25a, roughness: 0.35 }));
const crabChunk = () => gc('dxCrabChunks', () => scatter(new THREE.DodecahedronGeometry(0.016, 0).scale(1.4, 0.7, 1), 7, (_i, m, r) => {
  m.makeRotationFromEuler(new THREE.Euler(r() * 2, r() * 6, r() * 2));
  const a = r() * 6.3, rr = Math.sqrt(r()) * 0.05;
  m.setPosition(Math.cos(a) * rr, 0.03 + r() * 0.012, Math.sin(a) * rr);
}, 11));
const crabShell = () => mat('crabShell', () => new THREE.MeshPhysicalMaterial({
  map: patTex('crabshellCooked', 128, (x, S) => { x.fillStyle = '#e2502a'; x.fillRect(0, 0, S, S); for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(255,${180 + Math.random() * 60},120,${Math.random() * 0.5})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 0, 7); x.fill(); } }),
  roughness: 0.35, clearcoat: 0.6,
}));
const curryEgg = () => mat('curryEgg', () => new THREE.MeshPhysicalMaterial({
  map: patTex('curryEgg', 128, (x, S) => { x.fillStyle = '#f2c43a'; x.fillRect(0, 0, S, S); for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(255,${230 + Math.random() * 25},${150 + Math.random() * 60},0.7)`; x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, 3 + Math.random() * 6, 2 + Math.random() * 3, Math.random() * 3, 0, 7); x.fill(); } }),
  roughness: 0.45, clearcoat: 0.5,
}));
const ballsIn = (n: number, r: number, spread: number, y: number, seed: number) => gc(`dxBalls${n}${seed}`, () => scatter(new THREE.SphereGeometry(r, 10, 8), n, (_i, m, rnd) => {
  const a = rnd() * 6.3, rr = Math.sqrt(rnd()) * spread;
  m.setPosition(Math.cos(a) * rr, y + rnd() * 0.006, Math.sin(a) * rr);
}, seed));
const cubesIn = (n: number, size: number, spread: number, y: number, seed: number) => gc(`dxCubes${n}${size}${seed}`, () => scatter(new THREE.BoxGeometry(size, size, size), n, (_i, m, r) => {
  m.makeRotationFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
  const a = r() * 6.3, rr = Math.sqrt(r()) * spread;
  m.setPosition(Math.cos(a) * rr, y + r() * 0.01, Math.sin(a) * rr);
}, seed));
const mangoSlices = () => gc('dxMangoSlices', () => scatter((() => { const g = new THREE.CylinderGeometry(0.012, 0.012, 0.075, 12, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.scale(1, 1, 1.6); return g; })(), 5, (i, m) => { m.makeRotationY(0.15 * (i - 2)); m.setPosition(0.035, 0.012, (i - 2) * 0.017); }, 3));
const mangoMat = () => mat('mangoFlesh', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xffb21e, roughness: 0.25 }), { color: 0xffc040, wrap: 0.6, back: 0.6 }));
const bananaChunks = (n: number, seed: number, y: number) => gc('dxBanana' + n + seed, () => scatter(new THREE.CylinderGeometry(0.011, 0.011, 0.025, 12), n, (_i, m, r) => {
  m.makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + (r() - 0.5) * 0.8, r() * 6, 0));
  const a = r() * 6.3, rr = Math.sqrt(r()) * 0.04;
  m.setPosition(Math.cos(a) * rr, y + r() * 0.006, Math.sin(a) * rr);
}, seed));
const bananaMat = () => mat('bananaCooked', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xf2e2a8, roughness: 0.3 }), { color: 0xfff0c0, wrap: 0.5, back: 0.4 }));
const coconutSoup = () => broth('coco', 0xf8f2e2, 0.96);
const shavedIce = () => mat('shavedIce', () => new THREE.MeshStandardMaterial({ color: 0xf4fafc, roughness: 0.55, transparent: true, opacity: 0.94 }));
const syrupTop = () => mat('syrupTop', () => new THREE.MeshStandardMaterial({ color: 0xe8323a, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
const condensedDrizzle = () => mat('condensed', () => new THREE.MeshPhysicalMaterial({ color: 0xfaf3dc, roughness: 0.15, clearcoat: 1 }));
const drizzle = (key: string, n: number, spread: number, y: number) => gc('dxDrizzle' + key, () => {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([(t - 0.5) * spread * 2, y + 0.002 * Math.sin(t * 9 + k), (k - (n - 1) / 2) * 0.018 + Math.sin(t * 6 + k) * 0.008]); }
    const tb = tube(pts, 0.0022, 18, 5);
    parts.push(tb.index ? tb.toNonIndexed() : tb);
  }
  const out = new THREE.BufferGeometry();
  let len = 0; for (const p of parts) len += p.getAttribute('position').array.length;
  const pos = new Float32Array(len); let o = 0;
  for (const p of parts) { pos.set(p.getAttribute('position').array as Float32Array, o); o += p.getAttribute('position').array.length; }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
});

/** Fill `g` with the food for one of the new recipes. */
export function buildFoodX(d: any, g: THREE.Group, c: FoodCtx) {
  const { fx, s, burn, add } = c;
  switch (d.recipe) {
    // ------------------------------------------------------------- seafood mains
    case 'kaphrao_talay': {
      const hm = heapMat(T.kaphrao(), T.kaphraoN(), 0xfff0e0, burn, 'kapT', 0.4, 0.85);
      add(heapGeo('kapT', 0.058, 0.022, 5, [1.05, 0.9]), hm, [fx, 0.004, 0.005], s);
      add(squidRings(), squidMat(), [fx, 0.004, 0], s);
      const sm = mat('shrimpCookedDx', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }));
      for (let k = 0; k < 3; k++) add(shrimpGeo(), sm, [fx + Math.cos(k * 2.2) * 0.03, 0.03, Math.sin(k * 2.2) * 0.03]).rotation.set(0.2, k * 2, 0.1);
      add(musselsOpen(), MX.musselShell(), [fx, 0, 0], s);
      if ((c.vis.herb ?? 1) > 0.15) add(dishLeaves(7, 0.045, 0.024, 6), leafMat(burn > 0.5 ? 'burnt' : 'cooked'), [fx, 0.004, 0], s);
      if ((c.vis.chili ?? 0) > 0.2) add(chiliBits('dishT', 5, 0.04, 7), chiliMat('red', 0.6), [fx, 0.03, 0], s);
      break;
    }
    case 'muek_khai_khem': {
      add(heapGeo('mkk', 0.06, 0.022, 9, [1.1, 0.9]), curryEgg(), [fx, 0.004, 0.004], s);
      add(squidRings(), mat('squidSaltEgg', () => new THREE.MeshStandardMaterial({ color: 0xf6d27a, roughness: 0.4 })), [fx, 0.006, 0], s);
      add(dishLeaves(4, 0.04, 0.026, 9), leafMat('cooked'), [fx, 0.004, 0], s);
      break;
    }
    case 'hoi_thot': {
      const pancake = glossy('hoithot', 0xe0a548, 0.45, 0.4);
      add(gc('dxHoiThot', () => planarUV(mound(0.085, 0.016, { seed: 21, detail: 3, rough: 0.35, squash: [1.2, 1] }), 1 / 0.2)), mat('hoithotTex', () => new THREE.MeshPhysicalMaterial({ map: T.omelette(), roughness: 0.4, clearcoat: 0.5, color: 0xf0d090 })), [0, 0.004, 0], s);
      add(gc('dxOysters', () => scatter(mound(0.014, 0.008, { seed: 3, detail: 2, rough: 0.3, squash: [1.3, 0.9] }), 7, (_i, m, r) => { const a = r() * 6.3, rr = Math.sqrt(r()) * 0.055; m.setPosition(Math.cos(a) * rr, 0.018, Math.sin(a) * rr); }, 4)), MX.oyster(), [0, 0, 0], s);
      add(gc('dxSprouts', () => scatter(new THREE.CylinderGeometry(0.0016, 0.0016, 0.04, 4), 30, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(Math.PI / 2, r() * 6, r() * 0.4)); m.setPosition(0.07 + (r() - 0.5) * 0.03, 0.008, (r() - 0.5) * 0.06); }, 5)), MX.sprout(), [0, 0, 0]);
      void pancake;
      break;
    }
    // ------------------------------------------------------------- premium
    case 'pu_phat_phong_kari': {
      add(heapGeo('ppk2', 0.075, 0.03, 13, [1.15, 0.95]), curryEgg(), [0, 0.004, 0], s);
      add(crabChunk(), crabShell(), [0, 0, 0], s);
      g.add(scan('crab_blue', 0.13, [0.01, 0.03, -0.01], 0.6, { rough: 0.35, tint: 0xff8a5a }));
      add(dishLeaves(4, 0.05, 0.034, 12), leafMat('cooked'), [0, 0.004, 0], s);
      break;
    }
    case 'khao_phat_pu': {
      add(heapGeo('kpp', 0.072, 0.036, 11, [1.1, 0.95]), heapMat(T.friedRice(), T.friedRiceN(), 0xfff4e0, burn, 'kpp', 0.55), [0, 0.004, 0], s);
      add(gc('dxCrabLump', () => planarUV(mound(0.03, 0.016, { seed: 31, detail: 2, rough: 0.45 }), 1 / 0.05)), MX.crabMeat(), [0.005, 0.036, 0], s);
      { const lw = limeWedge(); lw.position.set(0.07, 0.022, 0.05); lw.rotation.y = 0.6; g.add(lw); }
      add(cucumberSlice(), cucumberMat(), [0.06, 0.0055, -0.06]); add(cucumberSlice(), cucumberMat(), [0.071, 0.008, -0.052]).rotation.set(-0.12, 1.1, 0.14);
      break;
    }
    case 'kung_phao': {
      g.add(scan('river_prawn', 0.2, [0, 0.006, -0.03], 0.1, { rough: 0.4, sss: 0.3, tint: 0xff9a70 }));
      g.add(scan('river_prawn', 0.19, [0, 0.008, 0.035], -0.15, { rough: 0.4, sss: 0.3, tint: 0xff9a70 }));
      // seafood dipping sauce in a small saucer
      add(gc('dxSaucer', () => lathe([[0.0001, 0], [0.022, 0], [0.028, 0.012], [0.03, 0.013]], 18)), mat('saucer', () => new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.2 })), [0.085, 0.003, 0.06]);
      add(disc(0.024), broth('seafoodSauce', 0x9ac24a, 0.92), [0.085, 0.012, 0.06]);
      add(chiliBits('dipK', 4, 0.014, 3), chiliMat('green', 0), [0.085, 0.014, 0.06]);
      { const lw = limeWedge(); lw.position.set(-0.08, 0.02, 0.06); g.add(lw); }
      break;
    }
    case 'tom_yam_nam_khon': {
      add(disc(0.066), broth('tyNamKhon', 0xe8823a, 0.96), [0, 0.045, 0]);
      g.add(scan('river_prawn', 0.11, [-0.03, 0.044, 0], 0.4, { rough: 0.4, tint: 0xff9a70 }));
      g.add(scan('river_prawn', 0.1, [0.028, 0.045, 0.01], 2.8, { rough: 0.4, tint: 0xff9a70 }));
      add(chiliBits('tyk', 3, 0.04, 9), chiliMat('red', 0.4), [0, 0.048, 0]);
      add(dishLeaves(4, 0.04, 0.047, 13), leafMat('cooked'), [0, 0, 0]);
      break;
    }
    case 'pla_neung_manao': {
      add(disc(0.066), broth('plaNeung', 0xe8eed2, 0.85), [0, 0.04, 0]);
      add(gc('dxFishFillet', () => planarUV(mound(0.05, 0.014, { seed: 41, detail: 3, rough: 0.2, squash: [1.6, 0.8] }), 1 / 0.1)), mat('fishFlesh', () => withSSS(new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.3 }), { color: 0xffffff, wrap: 0.5, back: 0.4 })), [0, 0.034, 0], s);
      for (let k = 0; k < 3; k++) { const lw = limeWedge(); lw.position.set(Math.cos(k * 2.1) * 0.045, 0.045, Math.sin(k * 2.1) * 0.045); lw.rotation.set(Math.PI / 2, k, 0); lw.scale.setScalar(0.8); g.add(lw); }
      add(chiliBits('pnm', 6, 0.05, 11), chiliMat('red', 0.2), [0, 0.046, 0]);
      add(cards3('garlicPN'), mat('garlicChop', () => new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.4 })), [0, 0.047, 0]);
      break;
    }
    case 'hoi_shell_noei': {
      add(gc('dxScallops', () => scatter(new THREE.CylinderGeometry(0.019, 0.021, 0.018, 18), 6, (i, m) => { const a = i * 1.05; m.setPosition(Math.cos(a) * 0.045, 0.013, Math.sin(a) * 0.045); }, 2)), mat('scallopSeared', () => new THREE.MeshPhysicalMaterial({
        map: patTex('scallopSear', 64, (x, S) => { const gr = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2); gr.addColorStop(0, '#c88a3a'); gr.addColorStop(1, '#f6e6c8'); x.fillStyle = gr; x.fillRect(0, 0, S, S); }),
        roughness: 0.3, clearcoat: 0.8,
      })), [0, 0, 0], s);
      add(disc(0.07), mat('butterSauce', () => new THREE.MeshStandardMaterial({ color: 0xf2c860, roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false })), [0, 0.005, 0]);
      add(dishLeaves(3, 0.03, 0.026, 15), leafMat('cooked'), [0, 0, 0]);
      break;
    }
    case 'kaphrao_wagyu': {
      const hm = heapMat(T.kaphrao(), T.kaphraoN(), 0xffe6d6, burn, 'kapW', 0.4, 0.9);
      add(heapGeo('kapW', 0.055, 0.02, 7, [1.05, 0.9]), hm, [fx, 0.004, 0.005], s);
      add(gc('dxWagyuSlices', () => scatter(planarUV(new THREE.BoxGeometry(0.05, 0.004, 0.022), 1 / 0.06), 5, (i, m, r) => { m.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.4, i * 1.2, (r() - 0.5) * 0.4)); m.setPosition(Math.cos(i * 1.2) * 0.02, 0.026 + i * 0.002, Math.sin(i * 1.2) * 0.02); }, 3)), mat('wagyuSeared', () => new THREE.MeshPhysicalMaterial({ map: (MX.wagyu() as THREE.MeshStandardMaterial).map, color: 0xd8a090, roughness: 0.3, clearcoat: 0.7 })), [fx, 0, 0], s);
      if ((c.vis.herb ?? 1) > 0.15) add(dishLeaves(7, 0.045, 0.026, 8), leafMat(burn > 0.5 ? 'burnt' : 'cooked'), [fx, 0.004, 0], s);
      // truffle-oil drizzle glints (the gag)
      add(drizzle('truffle', 2, 0.035, 0.034), mat('truffleOil', () => new THREE.MeshPhysicalMaterial({ color: 0x8a7a20, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.7 })), [fx, 0, 0]);
      break;
    }
    case 'yam_salmon': {
      add(gc('dxSalmonCubes', () => scatter(new THREE.BoxGeometry(0.016, 0.014, 0.016), 14, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 0.5, r() * 6, r() * 0.5)); const a = r() * 6.3, rr = Math.sqrt(r()) * 0.05; m.setPosition(Math.cos(a) * rr, 0.012 + r() * 0.01, Math.sin(a) * rr); }, 9)), MX.salmon(), [0, 0, 0], s);
      add(chiliBits('yamS', 6, 0.05, 13), chiliMat('red', 0), [0, 0.024, 0]);
      add(dishLeaves(5, 0.05, 0.022, 17), leafMat('fresh'), [0, 0, 0]);
      add(disc(0.075), broth('yamDressing', 0xd9a24a, 0.5), [0, 0.006, 0]);
      break;
    }
    // ------------------------------------------------------------- desserts
    case 'khao_niao_mamuang': {
      add(gc('dxStickyMound', () => planarUV(mound(0.045, 0.03, { seed: 2, detail: 3, rough: 0.12, flat: true, squash: [1.2, 1] }), 1 / 0.08)), MX.stickyRice(), [-0.035, 0.004, 0]);
      add(mangoSlices(), mangoMat(), [0, 0, 0]);
      add(drizzle('cocoKNM', 1, 0.03, 0.036), condensedDrizzle(), [-0.035, 0, 0]);
      add(gc('dxSesame', () => scatter(new THREE.SphereGeometry(0.0012, 4, 3).scale(1.6, 0.6, 1), 30, (_i, m, r) => m.setPosition((r() - 0.5) * 0.06, 0.036, (r() - 0.5) * 0.05), 2)), mat('sesame', () => new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.6 })), [-0.035, 0, 0]);
      break;
    }
    case 'bua_loi': {
      add(disc(0.066), coconutSoup(), [0, 0.044, 0]);
      for (let k = 0; k < 4; k++) add(ballsIn(5, 0.0085, 0.05, 0.042, 20 + k), MX.balls(k), [0, 0, 0]);
      break;
    }
    case 'kluay_buat_chi': {
      add(disc(0.066), coconutSoup(), [0, 0.044, 0]);
      add(bananaChunks(8, 4, 0.04), bananaMat(), [0, 0, 0]);
      break;
    }
    case 'thapthim_krop': {
      add(gc('dxIceBowl', () => mound(0.062, 0.03, { seed: 8, detail: 3, rough: 0.4 })), shavedIce(), [0, 0.03, 0]);
      add(disc(0.066), coconutSoup(), [0, 0.04, 0]);
      add(cubesIn(26, 0.009, 0.05, 0.05, 3), MX.ruby(), [0, 0, 0]);
      add(disc(0.06), syrupTop(), [0, 0.062, 0]);
      break;
    }
    case 'lot_chong_nam_kathi': {
      add(disc(0.066), mat('cocoPalm', () => new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.08, transparent: true, opacity: 0.95 })), [0, 0.042, 0]);
      add(gc('dxLotChongBowl', () => scatter(tube([[0, 0, 0], [0.01, 0.002, 0.004], [0.02, 0, 0.002]], 0.003, 6, 5), 30, (_i, m, r) => { m.makeRotationFromEuler(new THREE.Euler(r() * 0.6, r() * 6, r() * 0.6)); const a = r() * 6.3, rr = Math.sqrt(r()) * 0.05; m.setPosition(Math.cos(a) * rr, 0.044, Math.sin(a) * rr); }, 4)), MX.pandan(), [0, 0, 0]);
      add(gc('dxLCIce', () => mound(0.03, 0.025, { seed: 9, detail: 2, rough: 0.4 })), shavedIce(), [0.02, 0.044, 0.01]);
      break;
    }
    case 'itim_kathi': {
      add(gc('dxStickyBase', () => mound(0.05, 0.02, { seed: 5, detail: 2, rough: 0.1, flat: true })), MX.stickyRice(), [0, 0.022, 0]);
      add(ballsIn(3, 0.024, 0.026, 0.05, 31), MX.icecream(), [0, 0, 0]);
      add(gc('dxPeanutsTop', () => scatter(new THREE.SphereGeometry(0.004, 5, 4).scale(1.4, 0.9, 1), 18, (_i, m, r) => m.setPosition((r() - 0.5) * 0.05, 0.074 + r() * 0.01, (r() - 0.5) * 0.05), 6)), MX.peanut(), [0, 0, 0]);
      break;
    }
    case 'bingsu_mamuang': {
      add(gc('dxBingsuMountain', () => mound(0.064, 0.085, { seed: 12, detail: 3, rough: 0.45 })), shavedIce(), [0, 0.03, 0]);
      add(cubesIn(14, 0.013, 0.04, 0.09, 6), mangoMat(), [0, 0, 0]);
      add(drizzle('condB', 3, 0.04, 0.105), condensedDrizzle(), [0, 0, 0]);
      add(gc('dxSyrupCap', () => mound(0.04, 0.02, { seed: 13, detail: 2, rough: 0.3 })), syrupTop(), [0, 0.098, 0]);
      break;
    }
    case 'roti_kluay_khai': {
      const roti = mat('roti', () => new THREE.MeshPhysicalMaterial({
        map: patTex('rotiTop', 128, (x, S) => { x.fillStyle = '#e8b45a'; x.fillRect(0, 0, S, S); for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(${150 + Math.random() * 60},${90 + Math.random() * 40},30,${0.2 + Math.random() * 0.4})`; x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, 3 + Math.random() * 8, 2 + Math.random() * 4, Math.random() * 3, 0, 7); x.fill(); } }),
        roughness: 0.45, clearcoat: 0.6,
      }));
      for (let k = 0; k < 4; k++) add(gc('dxRotiPiece', () => planarUV(new THREE.BoxGeometry(0.045, 0.012, 0.045), 1 / 0.05)), roti, [((k % 2) - 0.5) * 0.05, 0.01 + (k > 1 ? 0.002 : 0), (Math.floor(k / 2) - 0.5) * 0.05]).rotation.y = k * 0.08;
      add(drizzle('condR', 4, 0.05, 0.02), condensedDrizzle(), [0, 0, 0]);
      add(gc('dxSugar', () => scatter(new THREE.BoxGeometry(0.002, 0.002, 0.002), 40, (_i, m, r) => m.setPosition((r() - 0.5) * 0.09, 0.019, (r() - 0.5) * 0.09), 9)), mat('sugarGrain', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })), [0, 0, 0]);
      break;
    }
    default: break;
  }
}

function cards3(key: string) {
  return gc('dxBits' + key, () => scatter(new THREE.BoxGeometry(0.004, 0.002, 0.004), 24, (_i, m, r) => m.setPosition((r() - 0.5) * 0.08, r() * 0.003, (r() - 0.5) * 0.08), 4));
}
