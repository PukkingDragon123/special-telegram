import * as THREE from 'three';
import { ProcModel, tex, lathe, tubeGeom, plasticMat, clean, mergeAll } from './realprops-proc';

/**
 * Street-restaurant tables and everything that lives on them, properly modelled (bevels, rolled
 * edges, leg braces) with the real PP-plastic / brushed-stainless / styrofoam photo textures:
 *  thai_table  — moulded plastic table: rolled rim, skirt, ribbed underside, splayed legs + braces
 *  steel_table — stainless folding table: folded-edge sheet top, round tube legs, H-frame, rubber feet
 *  caddy       — พริกน้ำปลา condiment set: wire rack + 4 glass jars (fish sauce & chilies, sugar,
 *                chili flakes, vinegar & green chilies) with spoons
 *  spoon_cup   — stainless cup of spoons & forks;  jug — plastic water jug;  glass — drinking glass
 *  tissue      — pink tissue box;  styro_box — styrofoam ice box with lid
 * Origin bottom centre, +Z front. Exported sizes match the restaurant item kinds.
 */

export const THAI_TABLE = { W: 0.8, D: 0.62, H: 0.66 };
export const STEEL_TABLE = { W: 0.9, D: 0.62, H: 0.71 };

function roundRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
function roundRectPath(w: number, d: number, r: number, y: number, n = 6): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const cs: [number, number, number][] = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); }
  pts.push(pts[0].clone());
  return pts;
}
/** horizontal slab from a shape: top at y1, thickness t, bevel b (rolled edge) */
function slab(shape: THREE.Shape, y1: number, t: number, b: number, curve = 6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: curve });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y1 - t + b, 0);
  return g;
}
/** closed polyline tube (rims, frames) */
function ring(pts: THREE.Vector3[], r: number, radial = 6) {
  const c = new THREE.CatmullRomCurve3(pts.slice(0, -1), true, 'catmullrom', 0.05);
  return new THREE.TubeGeometry(c, pts.length * 3, r, radial, true);
}
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 8) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), radial, 1, false);
  g.translate(0, a.distanceTo(b) / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
  g.translate(a.x, a.y, a.z);
  return g;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

async function ppTextures(color: 'red' | 'blue' = 'blue') {
  return Promise.all([tex(`textures/props/plastic_pp_${color}.jpg`, true, true), tex('textures/props/plastic_pp_n.jpg', false), tex('textures/props/plastic_pp_r.jpg', false)]);
}
async function stainless(rep = 1.5, grimy = false) {
  const [map, nrm, rgh] = await Promise.all([tex(grimy ? 'textures/props/stainless_grimy.jpg' : 'textures/props/stainless_brushed_dented.jpg'), tex('textures/props/stainless_brushed_dented_n.jpg', false), tex(grimy ? 'textures/props/stainless_grimy_r.jpg' : 'textures/props/stainless_brushed_dented_r.jpg', false)]);
  const cl = (t: THREE.Texture) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rep, rep); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({ map: cl(map), normalMap: cl(nrm), roughnessMap: cl(rgh), metalness: 0.85, roughness: 1, envMapIntensity: 1.0 });
  m.normalScale.set(0.4, 0.4);
  return m;
}
const rubber = () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0 });

// ------------------------------------------------------------------ Thai plastic table
async function thaiTable(): Promise<ProcModel> {
  const { W, D, H } = THAI_TABLE;
  const [map, nrm, rgh] = await ppTextures('blue');
  const top = slab(roundRect(W, D, 0.07), H, 0.028, 0.009, 8);
  const rim = ring(roundRectPath(W + 0.004, D + 0.004, 0.072, H - 0.016), 0.011, 6);
  // skirt under the top (shape with a hole = a ring wall) + two cross ribs
  const sk = roundRect(W - 0.05, D - 0.05, 0.05);
  const hole = roundRect(W - 0.066, D - 0.066, 0.045);
  sk.holes.push(new THREE.Path(hole.getPoints(8).reverse()));
  const skirt = new THREE.ExtrudeGeometry(sk, { depth: 0.055, bevelEnabled: false, curveSegments: 8 });
  skirt.rotateX(-Math.PI / 2); skirt.translate(0, H - 0.028 - 0.055, 0);
  const ribs = [new THREE.BoxGeometry(W - 0.07, 0.03, 0.012).translate(0, H - 0.043, 0), new THREE.BoxGeometry(0.012, 0.03, D - 0.07).translate(0, H - 0.043, 0)];
  // splayed, tapered legs with foot caps and two side braces
  const legs: THREE.BufferGeometry[] = [];
  const lx = W / 2 - 0.075, lz = D / 2 - 0.07, splay = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = V(sx * lx, H - 0.06, sz * lz), b = V(sx * (lx + splay), 0.012, sz * (lz + splay));
    const g = new THREE.CylinderGeometry(0.026, 0.02, a.distanceTo(b), 10, 1, false);
    g.translate(0, a.distanceTo(b) / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), a.clone().sub(b).normalize())));
    g.translate(b.x, b.y, b.z);
    legs.push(g);
    legs.push(lathe([[0.0, 0.0], [0.024, 0.0], [0.026, 0.006], [0.022, 0.014], [0.0, 0.014]], 10).translate(b.x, 0, b.z));
  }
  const yb = 0.16, t = (yb - 0.012) / (H - 0.06 - 0.012);
  for (const sz of [-1, 1]) legs.push(rod(V(-(lx + splay * (1 - t)), yb, sz * (lz + splay * (1 - t))), V(lx + splay * (1 - t), yb, sz * (lz + splay * (1 - t))), 0.011));
  const body = mergeAll([top, rim, skirt, ...ribs, ...legs]);
  return { parts: [{ geom: body, mat: plasticMat(map, nrm, rgh, 2.5), tint: true }] };
}

// ------------------------------------------------------------------ stainless folding table
async function steelTable(): Promise<ProcModel> {
  const { W, D, H } = STEEL_TABLE;
  const steel = await stainless(1.2);
  const tubeM = await stainless(3, true);
  const top = slab(roundRect(W, D, 0.03), H, 0.01, 0.003, 4);
  // folded-down edge (apron) with an inward hem
  const ap = roundRect(W + 0.006, D + 0.006, 0.032);
  ap.holes.push(new THREE.Path(roundRect(W - 0.004, D - 0.004, 0.028).getPoints(4).reverse()));
  const apron = new THREE.ExtrudeGeometry(ap, { depth: 0.038, bevelEnabled: false, curveSegments: 4 });
  apron.rotateX(-Math.PI / 2); apron.translate(0, H - 0.046, 0);
  const hem = ring(roundRectPath(W - 0.004, D - 0.004, 0.03, H - 0.046, 4), 0.004, 4);
  const frame: THREE.BufferGeometry[] = [];
  const lx = W / 2 - 0.06, lz = D / 2 - 0.05, r = 0.0125;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    frame.push(rod(V(sx * lx, 0.02, sz * lz), V(sx * lx, H - 0.046, sz * lz), r, 10));
  }
  // H-frame: side rails low, a centre stretcher, a support rail under the top
  for (const sx of [-1, 1]) { frame.push(rod(V(sx * lx, 0.14, -lz), V(sx * lx, 0.14, lz), 0.01)); frame.push(rod(V(sx * lx, H - 0.06, -lz), V(sx * lx, H - 0.06, lz), 0.009)); }
  frame.push(rod(V(-lx, 0.14, 0), V(lx, 0.14, 0), 0.01));
  // folding hinge plates
  for (const sx of [-1, 1]) frame.push(new THREE.BoxGeometry(0.05, 0.012, 0.06).translate(sx * lx, H - 0.052, 0));
  const feet: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) feet.push(lathe([[0, 0], [0.016, 0], [0.017, 0.012], [0.0135, 0.026], [0, 0.026]], 10).translate(sx * lx, 0, sz * lz));
  return { parts: [{ geom: mergeAll([top, apron, hem]), mat: steel, tint: false }, { geom: mergeAll(frame), mat: tubeM, tint: false }, { geom: mergeAll(feet), mat: rubber(), tint: false }] };
}

// ------------------------------------------------------------------ condiment caddy
async function caddy(): Promise<ProcModel> {
  const steel = await stainless(4);
  const [chili, sty] = await Promise.all([tex('gen/shops/heap_chili.jpg'), tex('textures/props/styrofoam_tile.jpg')]);
  const glass = new THREE.MeshStandardMaterial({ color: 0xe8f2f0, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.4 });
  const jarR = 0.031, jarH = 0.085, gap = 0.072;
  const pos: [number, number][] = [[-gap / 2, -gap / 2], [gap / 2, -gap / 2], [-gap / 2, gap / 2], [gap / 2, gap / 2]];
  const jars: THREE.BufferGeometry[] = [];
  const lids: THREE.BufferGeometry[] = [];
  const fill: THREE.BufferGeometry[][] = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    const [x, z] = pos[i];
    jars.push(lathe([[0, 0.012], [jarR - 0.004, 0.012], [jarR, 0.018], [jarR, jarH - 0.01], [jarR - 0.004, jarH], [jarR - 0.006, jarH], [jarR - 0.0045, jarH - 0.01], [jarR - 0.0045, 0.018], [0, 0.016]], 10).translate(x, 0, z));
    lids.push(lathe([[jarR - 0.003, jarH - 0.006], [jarR + 0.002, jarH - 0.004], [jarR + 0.002, jarH + 0.008], [jarR - 0.004, jarH + 0.011], [0.0, jarH + 0.012]], 10).translate(x, 0, z));
    // spoon handle through the lid notch
    lids.push(new THREE.BoxGeometry(0.008, 0.07, 0.0025).rotateZ(0.25).translate(x + 0.012, jarH + 0.03, z));
    const lvl = [0.06, 0.055, 0.05, 0.064][i];
    fill[i].push(lathe([[0, 0.016], [jarR - 0.0055, 0.016], [jarR - 0.0055, lvl], [0, lvl + (i === 1 || i === 2 ? 0.006 : 0)]], 8).translate(x, 0, z));
  }
  // wire rack: base plate + rails + carry handle
  const base = slab(roundRect(0.165, 0.165, 0.02), 0.012, 0.006, 0.002, 4);
  const rail = ring(roundRectPath(0.16, 0.16, 0.025, 0.05), 0.0025, 4);
  const handle = tubeGeom([V(0, 0.012, 0), V(0, 0.09, 0), V(0, 0.15, 0)], 0.004, 6, 5);
  const grip = new THREE.TorusGeometry(0.022, 0.004, 5, 14).translate(0, 0.165, 0);
  const liquid = (c: number, rough = 0.15) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
  const chiliM = new THREE.MeshStandardMaterial({ map: chili, roughness: 0.75 });
  const sugarM = new THREE.MeshStandardMaterial({ map: sty, color: 0xfffaf0, roughness: 0.6 });
  return {
    parts: [
      { geom: mergeAll([base, rail, handle, grip, ...lids]), mat: steel },
      { geom: mergeAll(fill[0]), mat: liquid(0x6a2e0c) },       // น้ำปลาพริก
      { geom: mergeAll(fill[1]), mat: sugarM },                 // sugar
      { geom: mergeAll(fill[2]), mat: chiliM },                 // chili flakes
      { geom: mergeAll(fill[3]), mat: liquid(0xc8c890, 0.1) },  // vinegar + green chili
      { geom: mergeAll(jars), mat: glass },
    ],
  };
}

async function spoonCup(): Promise<ProcModel> {
  const steel = await stainless(3);
  const cup = lathe([[0, 0], [0.034, 0], [0.036, 0.006], [0.038, 0.11], [0.041, 0.115], [0.036, 0.115], [0.034, 0.012], [0, 0.01]], 18);
  const tools: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = 0.016;
    const tilt = 0.18 + (i % 3) * 0.05;
    const g = new THREE.BoxGeometry(0.009, 0.15, 0.0025).translate(0, 0.075, 0);
    const head = i % 2 ? new THREE.SphereGeometry(0.018, 8, 4).scale(0.75, 1.15, 0.3).translate(0, 0.165, 0) : new THREE.BoxGeometry(0.02, 0.035, 0.0025).translate(0, 0.165, 0);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)).setPosition(Math.cos(a) * r, 0.01, Math.sin(a) * r);
    tools.push(g.applyMatrix4(m), head.applyMatrix4(m));
  }
  return { parts: [{ geom: mergeAll([cup, ...tools]), mat: steel }] };
}

async function jug(): Promise<ProcModel> {
  const [map, nrm, rgh] = await ppTextures('red');
  const body = lathe([[0, 0], [0.058, 0], [0.062, 0.006], [0.066, 0.17], [0.07, 0.205], [0.074, 0.212], [0.07, 0.214], [0.064, 0.208], [0.06, 0.17], [0.056, 0.01], [0, 0.008]], 20);
  const lid = lathe([[0.066, 0.21], [0.072, 0.214], [0.07, 0.226], [0.03, 0.234], [0.02, 0.244], [0, 0.246]], 18);
  const handle = tubeGeom([V(0, 0.19, -0.068), V(0, 0.2, -0.11), V(0, 0.13, -0.12), V(0, 0.06, -0.09), V(0, 0.05, -0.062)], 0.009, 16, 6);
  return { parts: [{ geom: mergeAll([body, lid, handle]), mat: plasticMat(map, nrm, rgh, 4, THREE.DoubleSide), tint: true }] };
}

async function glassCup(): Promise<ProcModel> {
  const g = lathe([[0, 0], [0.03, 0], [0.032, 0.008], [0.038, 0.12], [0.036, 0.12], [0.028, 0.012], [0, 0.012]], 16);
  const ice = new THREE.IcosahedronGeometry(0.014, 0).translate(0.006, 0.07, 0.004);
  const ice2 = new THREE.IcosahedronGeometry(0.012, 0).translate(-0.01, 0.085, -0.005);
  const glass = new THREE.MeshStandardMaterial({ color: 0xf0e2c8, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false, envMapIntensity: 1.4 });
  const iceM = new THREE.MeshStandardMaterial({ color: 0xeaf6fb, roughness: 0.1, transparent: true, opacity: 0.7 });
  return { parts: [{ geom: mergeAll([ice, ice2]), mat: iceM }, { geom: clean(g), mat: glass }] };
}

async function tissue(): Promise<ProcModel> {
  const [map, nrm, rgh] = await ppTextures('red');
  const box = slab(roundRect(0.15, 0.12, 0.022), 0.11, 0.11, 0.012, 6);
  const tuft = new THREE.PlaneGeometry(0.07, 0.07, 4, 4);
  const p = tuft.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.035; p.setXYZ(i, p.getX(i) * (1 - y * 3), 0.112 + y * 0.8, Math.sin(p.getX(i) * 40) * 0.006 + y * 0.2); }
  tuft.computeVertexNormals();
  const paper = new THREE.MeshStandardMaterial({ color: 0xfaf6f4, roughness: 0.95, side: THREE.DoubleSide });
  return { parts: [{ geom: box, mat: plasticMat(map, nrm, rgh, 6), tint: true }, { geom: clean(tuft), mat: paper }] };
}

async function styroBox(): Promise<ProcModel> {
  const [sty, nrm] = await Promise.all([tex('textures/props/styrofoam_tile.jpg'), tex('textures/props/styrofoam_tile_n.jpg', false)]);
  const cl = (t: THREE.Texture) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(3, 3); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({ map: cl(sty), normalMap: cl(nrm), roughness: 0.9, color: 0xf4f0e6 });
  const body = slab(roundRect(0.52, 0.36, 0.03), 0.27, 0.27, 0.012, 4);
  const lid = slab(roundRect(0.54, 0.38, 0.035), 0.31, 0.045, 0.015, 4);
  return { parts: [{ geom: mergeAll([body, lid]), mat: m }] };
}

export const TABLE_MODELS: Record<string, () => Promise<ProcModel>> = {
  thai_table: thaiTable, steel_table: steelTable, caddy, spoon_cup: spoonCup, jug, glass_cup: glassCup, tissue, styro_box: styroBox,
};
