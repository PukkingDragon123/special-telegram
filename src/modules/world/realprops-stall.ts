import * as THREE from 'three';
import { ProcModel, tex, lathe, tubeGeom, plasticMat, clean, mergeAll } from './realprops-proc';

/**
 * Market-stall micro detail, modelled and textured from real photos:
 *  meat_* (belly slabs, ribs, chicken pieces, minced pork, dark cuts — gen/world/models/_stall/meat.jpg
 *  cut from CC photos, wet clear-coat look), chop_block (เขียงมะขาม, real tamarind end-grain),
 *  cleaver, hanging_scale (dial from the real market-scale photo), egg_tray (pulp tray + real
 *  egg-shell texture), egg_shell (cracked), mist_bottle, bag_bundle (real PE film), fridge (old red
 *  drinks fridge, real fridge-front photo + cola label), and the fly-repelling fan (animated object).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const MEAT = 'gen/world/models/_stall/meat.jpg';
/** atlas regions in meat.jpg: [u0, v0, u1, v1] */
const R = {
  bellyA: [0.03, 0.56, 0.42, 0.93], bellyB: [0.06, 0.06, 0.45, 0.42], ribs: [0.56, 0.53, 0.97, 0.86],
  chicken: [0.51, 0.03, 0.74, 0.47], dark: [0.77, 0.05, 0.98, 0.45],
} as const;

function planarUV(g: THREE.BufferGeometry, r: readonly number[], sx: number, sz: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = r[0] + (p.getX(i) / sx + 0.5) * (r[2] - r[0]);
    uv[i * 2 + 1] = r[1] + (0.5 - p.getZ(i) / sz) * (r[3] - r[1]);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function hash(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
/** organic wobble (displace along normals by smooth-ish noise) */
function wobble(g: THREE.BufferGeometry, amt: number, freq: number, seed: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + seed) * Math.cos(z * freq * 1.3 + seed * 2) * 0.6 + Math.sin((x + z) * freq * 2.1 + seed * 3) * 0.4;
    p.setXYZ(i, x + n * amt * 0.5, y + n * amt * (y > 0.004 ? 1 : 0), z + n * amt * 0.5);
  }
  g.computeVertexNormals();
  return g;
}
function roundRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
function slab(shape: THREE.Shape, t: number, b: number, curve = 6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: curve, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return g;
}

let meatMat: Promise<THREE.Material> | null = null;
function wetMeat() {
  if (!meatMat) meatMat = tex(MEAT).then((t) => {
    const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.42, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.18, envMapIntensity: 1.1, sheen: 0.2, sheenColor: new THREE.Color(0xffd0c8) });
    return m;
  });
  return meatMat;
}

async function meatSlab(region: readonly number[], L: number, W: number, T: number, seed: number): Promise<ProcModel> {
  const g = slab(roundRect(L, W, Math.min(W, L) * 0.22), T, T * 0.35, 5);
  // subdivide-ish wobble for an organic, slumped slab
  const tess = g.index ? g.toNonIndexed() : g;
  wobble(tess, T * 0.35, 18, seed);
  planarUV(tess, region, L, W);
  return { parts: [{ geom: clean(tess), mat: await wetMeat() }] };
}
async function meatHeap(region: readonly number[], r: number, h: number, seed: number, texPath?: string): Promise<ProcModel> {
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([r * Math.cos(t * Math.PI / 2) * (1 + (hash(i + seed) - 0.5) * 0.12), h * Math.sin(t * Math.PI / 2) * (t < 0.2 ? t / 0.2 * 0.6 + 0.4 : 1)]); }
  pts.push([0, h]);
  const prof = pts.slice(1).reverse();   // outer wall upward → dome (CCW)
  prof.unshift([0, 0]);
  const g = lathe([[0, 0], ...pts.slice(1, -1), [0, h]] as [number, number][], 18);
  const n = g.index ? g.toNonIndexed() : g;
  wobble(n, h * 0.18, 30, seed);
  let mat: THREE.Material = await wetMeat();
  if (texPath) {
    const t = (await tex(texPath)).clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    mat = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1 });
    planarUV(n, [0, 0, 2, 2], r * 2, r * 2);
  } else planarUV(n, region, r * 2, r * 2);
  void prof;
  return { parts: [{ geom: clean(n), mat }] };
}

// ------------------------------------------------------------------ chopping block + cleaver
async function chopBlock(): Promise<ProcModel> {
  const [top, side, sideN] = await Promise.all([tex('textures/props/tamarind_board_top_used.jpg'), tex('textures/props/tamarind_board_side_tile.jpg'), tex('textures/props/tamarind_board_side_tile_n.jpg', false)]);
  const r = 0.24, h = 0.11;
  const disc = new THREE.CircleGeometry(r - 0.006, 28);
  disc.rotateX(-Math.PI / 2); disc.translate(0, h, 0);
  const wall = lathe([[r - 0.012, 0], [r, 0.006], [r + 0.002, h * 0.5], [r, h - 0.006], [r - 0.006, h]], 28, { k: 1 });
  const s = side.clone(); s.wrapS = s.wrapT = THREE.RepeatWrapping; s.repeat.set(1.5, 1.5); s.needsUpdate = true;
  const sn = sideN.clone(); sn.wrapS = sn.wrapT = THREE.RepeatWrapping; sn.repeat.set(1.5, 1.5); sn.needsUpdate = true;
  return {
    parts: [
      { geom: clean(disc), mat: new THREE.MeshStandardMaterial({ map: top, roughness: 0.8, color: 0xd8c8b8 }) },
      { geom: clean(wall), mat: new THREE.MeshStandardMaterial({ map: s, normalMap: sn, roughness: 0.85 }) },
    ],
  };
}
async function cleaver(): Promise<ProcModel> {
  const [steelT, wood] = await Promise.all([tex('textures/props/stainless_grimy.jpg'), tex('textures/props/tamarind_board_side_tile.jpg')]);
  // blade in the XY plane, edge along the bottom (y = 0), spine at the top, handle toward -X
  const s = new THREE.Shape();
  s.moveTo(-0.09, 0.008); s.quadraticCurveTo(0.0, -0.004, 0.09, 0.0); s.lineTo(0.092, 0.085); s.quadraticCurveTo(0.09, 0.095, 0.08, 0.095);
  s.lineTo(-0.085, 0.095); s.lineTo(-0.092, 0.07); s.lineTo(-0.09, 0.008);
  const hole = new THREE.Path(); hole.absarc(0.066, 0.075, 0.008, 0, Math.PI * 2, true); s.holes.push(hole);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 6 });
  blade.translate(0, 0, -0.001);
  const uv = blade.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
  const handle = new THREE.CylinderGeometry(0.0125, 0.014, 0.115, 10).rotateZ(Math.PI / 2).translate(-0.15, 0.078, 0);
  const ferrule = new THREE.CylinderGeometry(0.015, 0.015, 0.012, 10).rotateZ(Math.PI / 2).translate(-0.095, 0.078, 0);
  const steel = new THREE.MeshStandardMaterial({ map: steelT, metalness: 0.9, roughness: 0.38, color: 0x9a9a98, envMapIntensity: 1.2 });
  return { parts: [{ geom: mergeAll([blade, ferrule]), mat: steel }, { geom: clean(handle), mat: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7, color: 0x8a6a50 }) }] };
}

// ------------------------------------------------------------------ hanging dial scale (origin = top hook)
async function hangingScale(): Promise<ProcModel> {
  const photo = await tex('gen/shops/scale.png');
  const body = lathe([[0, -0.03], [0.1, -0.03], [0.112, -0.022], [0.115, 0.0], [0.112, 0.022], [0.1, 0.03], [0, 0.03]], 28);
  body.rotateX(Math.PI / 2);
  const face = new THREE.CircleGeometry(0.098, 28);
  // dial region in the real scale photo (382×512): centre (191, 330), radius ≈ 92 px
  const fu = face.getAttribute('uv') as THREE.BufferAttribute, fp = face.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fu.count; i++) fu.setXY(i, (191 + (fp.getX(i) / 0.098) * 92) / 382, 1 - (330 - (fp.getY(i) / 0.098) * 92) / 512);
  face.translate(0, 0, 0.0305);
  const hook = new THREE.TorusGeometry(0.018, 0.004, 5, 12, Math.PI * 1.5).rotateZ(Math.PI * 0.75).translate(0, 0.13, 0);
  const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.02, 6).translate(0, 0.122, 0);
  const lowHook = new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6).translate(0, -0.135, 0);
  const pan = lathe([[0, -0.36], [0.06, -0.358], [0.13, -0.34], [0.165, -0.31], [0.168, -0.305], [0.16, -0.308], [0.125, -0.335], [0.06, -0.352], [0, -0.354]], 24);
  const chains: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; chains.push(tubeGeom([V(0, -0.16, 0), V(Math.cos(a) * 0.16, -0.31, Math.sin(a) * 0.16)], 0.0018, 2, 3)); }
  const paint = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.45, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  const faceM = new THREE.MeshStandardMaterial({ map: photo, roughness: 0.25 });
  return { parts: [{ geom: clean(body), mat: paint }, { geom: clean(face), mat: faceM }, { geom: mergeAll([hook, stem, lowHook, pan, ...chains]), mat: steel }] };
}

// ------------------------------------------------------------------ eggs
let eggMat: Promise<THREE.MeshStandardMaterial> | null = null;
function eggShellMat() {
  if (!eggMat) eggMat = tex('gen/cooking/egg_shell.jpg').then((t) => new THREE.MeshStandardMaterial({ map: t, color: 0xf0d2b0, roughness: 0.55 }));
  return eggMat;
}
async function eggTray(): Promise<ProcModel> {
  const card = await tex('textures/props/cardboard_corrugated_tile.jpg', true, true);
  const pulp = new THREE.MeshStandardMaterial({ map: card, color: 0xb8b0a0, roughness: 0.95 });
  // pulp tray: a 6×5 grid of cups (lathe) on a thin sheet, with raised posts between cups
  const W = 0.3, cups: THREE.BufferGeometry[] = [], eggs: THREE.BufferGeometry[] = [];
  const sheet = slab(roundRect(W, W, 0.015), 0.006, 0.002, 3).translate(0, 0.012, 0);
  cups.push(sheet);
  const egg = lathe([[0, 0], [0.012, 0.002], [0.02, 0.012], [0.022, 0.026], [0.019, 0.042], [0.011, 0.054], [0, 0.057]], 10);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
    const x = -W / 2 + 0.025 + i * 0.05, z = -W / 2 + 0.03 + j * 0.06;
    cups.push(lathe([[0.0, 0.0], [0.016, 0.0], [0.022, 0.012], [0.024, 0.018]], 8).translate(x, 0, z));
    if (i < 5 && j < 4) cups.push(new THREE.ConeGeometry(0.011, 0.04, 6).translate(x + 0.025, 0.035, z + 0.03));
    const tilt = (hash(i * 7 + j) - 0.5) * 0.3;
    eggs.push(egg.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt + (j % 2 ? 1.5 : 1.3), hash(i + j * 3) * 3, 0)).setPosition(x, 0.028, z)));
  }
  return { parts: [{ geom: mergeAll(cups), mat: pulp }, { geom: mergeAll(eggs), mat: await eggShellMat() }] };
}
async function eggShell(): Promise<ProcModel> {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([0.022 * Math.sin(t * Math.PI / 2 + 0.01), 0.026 * (1 - Math.cos(t * Math.PI / 2))]); }
  const outer = lathe(pts, 12);
  const p = outer.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.02) p.setY(i, p.getY(i) - hash(i) * 0.008);   // jagged crack rim
  outer.computeVertexNormals();
  outer.rotateX(Math.PI); outer.translate(0, 0.026, 0);
  const m = (await eggShellMat()).clone(); m.side = THREE.DoubleSide;
  return { parts: [{ geom: clean(outer), mat: m }] };
}

// ------------------------------------------------------------------ mist sprayer, plastic bags
async function mistBottle(): Promise<ProcModel> {
  const [map, nrm, rgh] = await Promise.all([tex('textures/props/plastic_pp_blue.jpg', true, true), tex('textures/props/plastic_pp_n.jpg', false), tex('textures/props/plastic_pp_r.jpg', false)]);
  const body = lathe([[0, 0], [0.036, 0], [0.04, 0.008], [0.04, 0.15], [0.03, 0.18], [0.016, 0.195], [0.016, 0.205], [0, 0.205]], 16);
  const water = lathe([[0, 0.004], [0.036, 0.004], [0.036, 0.11], [0, 0.11]], 12);
  const head: THREE.BufferGeometry[] = [
    lathe([[0.017, 0.2], [0.02, 0.205], [0.02, 0.23], [0, 0.232]], 12),
    new THREE.BoxGeometry(0.03, 0.03, 0.075).translate(0, 0.245, 0.018),
    new THREE.BoxGeometry(0.014, 0.05, 0.012).rotateX(0.35).translate(0, 0.215, 0.042),
    new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8).rotateX(Math.PI / 2).translate(0, 0.248, 0.06),
  ];
  const shell = new THREE.MeshStandardMaterial({ color: 0xdfeef2, roughness: 0.2, transparent: true, opacity: 0.45, depthWrite: false });
  return { parts: [{ geom: mergeAll(head), mat: plasticMat(map, nrm, rgh, 6), tint: true }, { geom: clean(water), mat: new THREE.MeshStandardMaterial({ color: 0xbfd8e0, roughness: 0.1 }) }, { geom: clean(body), mat: shell }] };
}
async function bagBundle(): Promise<ProcModel> {
  const film = await tex('textures/props/plastic_film_clear.png');
  const sheets: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.PlaneGeometry(0.2 + hash(i) * 0.06, 0.32, 4, 6);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k) - 0.16;
      const pinch = 1 - Math.min(1, Math.max(0, -y / 0.08)) * 0;   // top gathered at the nail
      const gather = Math.max(0.15, (y + 0.32) / 0.32);
      p.setXYZ(k, x * (1 - (y > -0.04 ? 0.85 : 0)) * pinch + Math.sin(y * 20 + i) * 0.01, y, Math.sin(x * 25 + i * 2) * 0.012 * gather + i * 0.004);
    }
    g.computeVertexNormals();
    g.rotateY((hash(i * 3) - 0.5) * 0.9);
    sheets.push(g);
  }
  const m = new THREE.MeshStandardMaterial({ map: film, color: 0xfff4f2, roughness: 0.25, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  return { parts: [{ geom: mergeAll(sheets), mat: m, tint: true }] };
}

// ------------------------------------------------------------------ old drinks fridge
async function fridge(): Promise<ProcModel> {
  const [paint, front, label] = await Promise.all([tex('textures/props/lpg_paint_red_tile.jpg'), tex('gen/shops/seven_fridge2.jpg'), tex('img/labels/cola_coke_can_325.png')]);
  const W = 0.62, D = 0.6, H = 1.72;
  const body = slab(roundRect(W, D, 0.035), H, 0.012);
  const pu = body.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * 1.5, pu.getY(i) * 1.5);
  const glass = new THREE.PlaneGeometry(W - 0.1, H - 0.48).translate(0, 0.16 + (H - 0.48) / 2, D / 2 + 0.003);
  const header = new THREE.PlaneGeometry(W - 0.06, 0.2).translate(0, H - 0.15, D / 2 + 0.003);
  const hu = header.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < hu.count; i++) hu.setXY(i, 0.08 + hu.getX(i) * 0.5, 0.25 + hu.getY(i) * 0.5);
  const handle = new THREE.BoxGeometry(0.03, 0.4, 0.03).translate(W / 2 - 0.08, 0.95, D / 2 + 0.02);
  const grille = new THREE.PlaneGeometry(W - 0.1, 0.1).translate(0, 0.07, D / 2 + 0.003);
  const pm = paint.clone(); pm.wrapS = pm.wrapT = THREE.RepeatWrapping; pm.needsUpdate = true;
  return {
    parts: [
      { geom: clean(body), mat: new THREE.MeshStandardMaterial({ map: pm, roughness: 0.55, metalness: 0.3 }) },
      { geom: clean(glass), mat: new THREE.MeshStandardMaterial({ map: front, roughness: 0.15, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.35 }) },
      { geom: clean(header), mat: new THREE.MeshStandardMaterial({ map: label, roughness: 0.35, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: 0.25 }) },
      { geom: mergeAll([handle, grille]), mat: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }) },
    ],
  };
}

export const STALL_MODELS: Record<string, () => Promise<ProcModel>> = {
  meat_belly: () => meatSlab(R.bellyA, 0.3, 0.13, 0.045, 1),
  meat_belly2: () => meatSlab(R.bellyB, 0.26, 0.12, 0.04, 2),
  meat_ribs: () => meatSlab(R.ribs, 0.36, 0.17, 0.03, 3),
  meat_dark: () => meatSlab(R.dark, 0.16, 0.11, 0.035, 4),
  meat_chicken: () => meatHeap(R.chicken, 0.16, 0.08, 5),
  meat_minced: () => meatHeap(R.chicken, 0.13, 0.07, 6, 'textures/food/pork_minced_raw_tile.jpg'),
  chop_block: chopBlock, cleaver, hanging_scale: hangingScale,
  egg_tray: eggTray, egg_shell: eggShell, mist_bottle: mistBottle, bag_bundle: bagBundle, fridge,
};

// ------------------------------------------------------------------ fly-repelling fan (animated, not instanced)
export function makeFlyFan(): { object: THREE.Group; spin: THREE.Object3D } {
  const g = new THREE.Group();
  g.name = 'flyfan';
  const plastic = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.45 });
  const base = lathe([[0, 0], [0.07, 0], [0.072, 0.012], [0.05, 0.03], [0.012, 0.04], [0, 0.04]], 16);
  const pole = new THREE.CylinderGeometry(0.007, 0.007, 0.32, 8).translate(0, 0.19, 0);
  const motor = lathe([[0, 0.34], [0.024, 0.34], [0.026, 0.37], [0.018, 0.4], [0, 0.402]], 12);
  g.add(new THREE.Mesh(mergeAll([base, pole, motor]), plastic));
  const spin = new THREE.Group();
  spin.position.y = 0.4;
  const arms: THREE.BufferGeometry[] = [], strips: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    arms.push(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5).rotateZ(Math.PI / 2).translate(0.08, 0.004, 0).rotateY(a));
    for (let s = 0; s < 3; s++) {
      const st = new THREE.PlaneGeometry(0.012, 0.2, 1, 6);
      const p = st.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) - 0.1; p.setXYZ(i, p.getX(i), y, Math.sin(y * 18 + s) * 0.008); }
      st.translate(0.06 + s * 0.04, 0, 0).rotateY(a);
      strips.push(st);
    }
  }
  spin.add(new THREE.Mesh(mergeAll(arms), plastic));
  const foil = new THREE.Mesh(mergeAll(strips), new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: 0.18, side: THREE.DoubleSide, envMapIntensity: 1.6 }));
  spin.add(foil);
  g.add(spin);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  return { object: g, spin };
}
