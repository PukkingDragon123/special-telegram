import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../../core/assets';
import { ProcModel, tex, lathe, tubeGeom, clean, mergeAll } from './realprops-proc';

/**
 * Parked underbone scooter (Honda-Wave class — the Thai street's default vehicle), properly modelled:
 * bevelled side-profile body panels, torus tyres on 5-spoke cast rims, disc brake, telescopic fork,
 * coil-spring shocks, exhaust with heat shield, vinyl seat (real leather scan), mirrors, lights, rack,
 * side stand and a real Thai motorcycle plate photo. Length along Z (front +Z), origin on the ground.
 * Body colour comes from instance colours (clear-coated paint).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** extrude a side profile (points in z,y) across the bike width, centred on x = 0, with a bevel */
function side(pts: [number, number][], width: number, bevel = 0.025, curve = 8): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const depth = Math.max(0.002, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: curve });
  // shape x→z, shape y→y, extrusion (z)→x
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.translate(-depth / 2, 0, 0);
  // the basis swap mirrors winding → flip faces back
  const idx = g.index;
  if (idx) { for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); } }
  else { const p = g.getAttribute('position') as THREE.BufferAttribute; const n = g.getAttribute('normal') as THREE.BufferAttribute; const u = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) for (const at of [p, n, u]) { if (!at) continue; const k = at.itemSize; for (let c = 0; c < k; c++) { const t = at.getComponent(i + 1, c); at.setComponent(i + 1, c, at.getComponent(i + 2, c)); at.setComponent(i + 2, c, t); } } }
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}
/** rounded profile helper: samples a smooth closed curve through control points */
function smooth(ctrl: [number, number][], n = 22): [number, number][] {
  const c = new THREE.CatmullRomCurve3(ctrl.map(([z, y]) => V(z, y, 0)), true, 'centripetal');
  return c.getPoints(n).slice(0, -1).map((p) => [p.x, p.y]);
}
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 8) {
  const L = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, L, radial, 1, false).translate(0, L / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())));
  return g.translate(a.x, a.y, a.z);
}
function wheelX(g: THREE.BufferGeometry, z: number, y: number) { return g.rotateZ(Math.PI / 2).translate(0, y, z); }

async function scooter(): Promise<ProcModel> {
  const R = 0.29, zf = 0.62, zr = -0.62;
  const [paintScratch, leatherMap, plate] = await Promise.all([
    tex('textures/props/lpg_paint_red_tile.jpg', true, true),
    Promise.resolve(null as THREE.Texture | null),
    tex('img/signs/plate_moto_phlkh772_bangkok.png'),
  ]);
  void leatherMap;
  // ---- body panels (paint)
  const rear = side(smooth([[0.04, 0.47], [-0.25, 0.43], [-0.62, 0.52], [-0.9, 0.66], [-0.95, 0.74], [-0.8, 0.79], [-0.4, 0.77], [-0.02, 0.74], [0.08, 0.62]]), 0.3, 0.035);
  const shield = side(smooth([[0.3, 0.33], [0.42, 0.36], [0.5, 0.62], [0.54, 0.88], [0.5, 0.96], [0.42, 0.93], [0.38, 0.62], [0.33, 0.42]]), 0.4, 0.04);
  const tunnel = side(smooth([[-0.04, 0.3], [0.32, 0.3], [0.36, 0.38], [0.3, 0.5], [0.06, 0.53], [-0.04, 0.46]]), 0.22, 0.03);
  const cowl = side(smooth([[0.36, 0.92], [0.46, 0.9], [0.62, 0.95], [0.66, 1.02], [0.6, 1.08], [0.44, 1.09], [0.36, 1.03]]), 0.34, 0.04);
  const fend: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const a = 0.35 + (i / 10) * 1.9; fend.push([zf + Math.cos(a) * (R + 0.035), R + Math.sin(a) * (R + 0.035)]); }
  for (let i = 10; i >= 0; i--) { const a = 0.35 + (i / 10) * 1.9; fend.push([zf + Math.cos(a) * (R + 0.06), R + Math.sin(a) * (R + 0.06)]); }
  const fender = side(fend, 0.13, 0.012, 4);
  const rfend: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const a = 1.4 + (i / 8) * 1.3; rfend.push([zr + Math.cos(a) * (R + 0.04), R + Math.sin(a) * (R + 0.04)]); }
  for (let i = 8; i >= 0; i--) { const a = 1.4 + (i / 8) * 1.3; rfend.push([zr + Math.cos(a) * (R + 0.06), R + Math.sin(a) * (R + 0.06)]); }
  const rearFender = side(rfend, 0.14, 0.01, 4);
  const paint = new THREE.MeshPhysicalMaterial({ map: paintScratch, color: 0xffffff, roughness: 0.38, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1 });
  paint.map!.repeat.set(2, 2); paint.map!.wrapS = paint.map!.wrapT = THREE.RepeatWrapping;
  // ---- black plastic, seat, engine
  const seat = side(smooth([[-0.74, 0.78], [-0.7, 0.86], [-0.4, 0.88], [-0.06, 0.87], [0.04, 0.82], [0.0, 0.77], [-0.4, 0.765]]), 0.27, 0.04);
  const engine = side(smooth([[-0.28, 0.2], [0.16, 0.19], [0.24, 0.26], [0.2, 0.42], [-0.05, 0.46], [-0.3, 0.38]]), 0.24, 0.02);
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) fins.push(new THREE.BoxGeometry(0.2, 0.012, 0.06).rotateX(-0.6).translate(0, 0.32 + i * 0.025, 0.23 - i * 0.012));
  const swing = [rod(V(-0.08, 0.3, -0.2), V(-0.09, R, zr), 0.022), rod(V(0.08, 0.3, -0.2), V(0.09, R, zr), 0.022)];
  const pegs = [rod(V(-0.28, 0.27, 0.0), V(0.28, 0.27, 0.0), 0.012), rod(V(-0.2, 0.3, -0.4), V(0.2, 0.3, -0.4), 0.01)];
  const stand = [rod(V(-0.12, 0.26, -0.12), V(-0.26, 0.01, -0.2), 0.012)];
  const grips = [rod(V(-0.36, 1.0, 0.42), V(-0.27, 1.0, 0.42), 0.017), rod(V(0.27, 1.0, 0.42), V(0.36, 1.0, 0.42), 0.017)];
  const tireMat = await (async () => { const m = Assets.pbr('rubber_black', { repeat: 2, fallback: 0x1a1a1a }) as THREE.MeshStandardMaterial; return m; })();
  // ---- tyres + rims + brake disc
  const tyreProf: [number, number][] = [];
  for (let i = 0; i <= 9; i++) { const t = -Math.PI / 2 + (i / 9) * Math.PI * 2; tyreProf.push([R - 0.045 + Math.cos(t) * 0.045, Math.sin(t) * 0.048]); }
  const tyres = mergeAll([wheelX(lathe(tyreProf, 18, { k: 0.5 }), zf, R), wheelX(lathe(tyreProf, 18, { k: 0.5 }), zr, R)]);
  const rimParts: THREE.BufferGeometry[] = [];
  for (const z of [zf, zr]) {
    rimParts.push(wheelX(lathe([[0.2, -0.03], [0.215, -0.028], [0.215, 0.028], [0.2, 0.03], [0.19, 0.0]], 14), z, R));
    rimParts.push(wheelX(lathe([[0.0, -0.05], [0.045, -0.05], [0.05, 0.05], [0.0, 0.05]], 10), z, R));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; rimParts.push(rod(V(0, R + Math.cos(a) * 0.045, z + Math.sin(a) * 0.045), V(0, R + Math.cos(a + 0.25) * 0.195, z + Math.sin(a + 0.25) * 0.195), 0.012, 5)); }
  }
  const disc = wheelX(lathe([[0.06, -0.003], [0.11, -0.003], [0.11, 0.003], [0.06, 0.003]], 18), zf, R).translate(-0.06, 0, 0);
  // ---- chrome: fork, shocks, handlebar, exhaust, mirrors, rack
  const chrome: THREE.BufferGeometry[] = [];
  for (const sx of [-0.075, 0.075]) chrome.push(rod(V(sx, R, zf), V(sx, 0.93, 0.47), 0.02));
  chrome.push(rod(V(-0.27, 1.0, 0.42), V(0.27, 1.0, 0.42), 0.012));
  for (const sx of [-0.25, 0.25]) { chrome.push(rod(V(sx, 1.02, 0.43), V(sx * 1.25, 1.28, 0.36), 0.006)); chrome.push(new THREE.SphereGeometry(0.05, 8, 4).scale(1, 0.62, 0.25).translate(sx * 1.25, 1.3, 0.36)); }
  const ex: THREE.Vector3[] = [V(0.06, 0.24, 0.22), V(0.12, 0.17, 0.05), V(0.15, 0.2, -0.3), V(0.16, 0.33, -0.62), V(0.16, 0.37, -0.8)];
  chrome.push(tubeGeom(ex, 0.028, 12, 6));
  chrome.push(tubeGeom([V(0.17, 0.27, -0.42), V(0.17, 0.33, -0.62)], 0.036, 4, 8));
  for (const sx of [-0.12, 0.12]) chrome.push(rod(V(sx, 0.62, -0.95), V(sx, 0.83, -0.75), 0.008), rod(V(sx, 0.83, -0.95), V(sx, 0.83, -0.5), 0.008));
  chrome.push(rod(V(-0.12, 0.83, -0.95), V(0.12, 0.83, -0.95), 0.008));
  // coil springs on the rear shocks
  const springs: THREE.BufferGeometry[] = [];
  for (const sx of [-0.12, 0.12]) {
    const a = V(sx, 0.33, zr + 0.06), b = V(sx, 0.62, zr + 0.2);
    chrome.push(rod(a, b, 0.012));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 36; i++) { const t = i / 36, ang = t * Math.PI * 2 * 6; const p = a.clone().lerp(b, 0.15 + t * 0.7); pts.push(p.add(V(Math.cos(ang) * 0.026, 0, Math.sin(ang) * 0.026))); }
    springs.push(tubeGeom(pts, 0.005, 36, 3));
  }
  // ---- lights + plate
  const head = lathe([[0, 0], [0.05, 0.0], [0.055, 0.02], [0.0, 0.03]], 14).rotateX(Math.PI / 2).translate(0, 1.0, 0.655);
  const tail = new THREE.BoxGeometry(0.12, 0.05, 0.03).translate(0, 0.73, -0.955);
  const plateG = new THREE.PlaneGeometry(0.2, 0.13).rotateY(Math.PI).translate(0, 0.6, -0.965);
  const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.1 });
  const vinyl = Assets.pbr('leather_black', { repeat: 2, fallback: 0x141414 }) as THREE.MeshStandardMaterial;
  const chromeM = new THREE.MeshStandardMaterial({ color: 0xe0e2e4, metalness: 1, roughness: 0.18, envMapIntensity: 1.3 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.35 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.05, metalness: 0.3, emissive: 0x302820 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc01010, roughness: 0.2, emissive: 0x200000 });
  const plateM = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.6 });
  return {
    parts: [
      { geom: mergeAll([rear, shield, tunnel, cowl, fender, rearFender]), mat: paint, tint: true },
      { geom: mergeAll([engine, ...fins, ...swing, ...pegs, ...stand, ...grips]), mat: black },
      { geom: clean(seat), mat: vinyl },
      { geom: tyres, mat: tireMat },
      { geom: mergeAll([...rimParts, disc]), mat: alu },
      { geom: mergeAll([...chrome, ...springs]), mat: chromeM },
      { geom: mergeAll([head]), mat: lens },
      { geom: clean(tail), mat: red },
      { geom: clean(plateG), mat: plateM },
    ],
  };
}

// ------------------------------------------------------------------ street-food push cart (รถเข็น)
function roundRect(w: number, d: number, r: number): THREE.Shape {
  const sh = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  sh.moveTo(x0 + r, y0); sh.lineTo(x1 - r, y0); sh.quadraticCurveTo(x1, y0, x1, y0 + r); sh.lineTo(x1, y1 - r); sh.quadraticCurveTo(x1, y1, x1 - r, y1);
  sh.lineTo(x0 + r, y1); sh.quadraticCurveTo(x0, y1, x0, y1 - r); sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
  return sh;
}
function block(w: number, d: number, y0: number, h: number, r = 0.02, b = 0.012) {
  const g = new THREE.ExtrudeGeometry(roundRect(w, d, r), { depth: Math.max(0.002, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + b, 0);
  return g;
}
async function foodCart(): Promise<ProcModel> {
  const [st, stN, stR, paintT] = await Promise.all([tex('textures/props/stainless_grimy.jpg'), tex('textures/props/stainless_brushed_dented_n.jpg', false), tex('textures/props/stainless_grimy_r.jpg', false), tex('textures/props/lpg_paint_red_tile.jpg', true, true)]);
  const W = 1.5, D = 0.8;
  const body = block(W, D, 0.55, 0.42, 0.03);
  const counter = block(W + 0.08, D + 0.06, 0.97, 0.025, 0.03, 0.006);
  const roof = block(W + 0.06, D + 0.04, 1.52, 0.02, 0.03, 0.006);
  const frame: THREE.BufferGeometry[] = [];
  const gx = W / 2 - 0.02, gz = D / 2 - 0.02;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(rod(V(sx * gx, 0.995, sz * gz), V(sx * gx, 1.52, sz * gz), 0.01, 6));
  for (const y of [1.0, 1.25]) { frame.push(rod(V(-gx, y, gz), V(gx, y, gz), 0.006, 4)); frame.push(rod(V(-gx, y, -gz), V(gx, y, -gz), 0.006, 4)); }
  frame.push(block(W - 0.08, D - 0.08, 1.24, 0.012, 0.01, 0.003));   // glass shelf frame
  // push handle + legs + axle
  frame.push(tubeGeom([V(-W / 2, 0.9, -D / 2 + 0.05), V(-W / 2 - 0.3, 0.95, -D / 2 + 0.05), V(-W / 2 - 0.3, 0.95, D / 2 - 0.05), V(-W / 2, 0.9, D / 2 - 0.05)], 0.016, 16, 6));
  for (const sz of [-1, 1]) frame.push(rod(V(W / 2 - 0.08, 0.56, sz * (D / 2 - 0.06)), V(W / 2 - 0.08, 0.0, sz * (D / 2 - 0.06)), 0.016, 6));
  frame.push(rod(V(-0.35, 0.3, -D / 2 - 0.02), V(-0.35, 0.3, D / 2 + 0.02), 0.014, 6));
  // gas tank on the shelf under the cart + hose
  const tank = lathe([[0, 0.0], [0.13, 0.01], [0.14, 0.05], [0.14, 0.32], [0.1, 0.38], [0.04, 0.4], [0, 0.4]], 14).translate(0.3, 0.06, 0);
  const shelf = block(W - 0.1, D - 0.1, 0.05, 0.015, 0.01, 0.004);
  // spoked wheels
  const wheels: THREE.BufferGeometry[] = [], spokes: THREE.BufferGeometry[] = [];
  const Rw = 0.3;
  const tyreP: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const t = -Math.PI / 2 + (i / 8) * Math.PI * 2; tyreP.push([Rw - 0.022 + Math.cos(t) * 0.022, Math.sin(t) * 0.022]); }
  for (const sz of [-1, 1]) {
    const z = sz * (D / 2 + 0.06);
    wheels.push(lathe(tyreP, 20).rotateX(Math.PI / 2).translate(-0.35, Rw, z));
    spokes.push(lathe([[Rw - 0.05, -0.012], [Rw - 0.04, -0.012], [Rw - 0.04, 0.012], [Rw - 0.05, 0.012]], 20).rotateX(Math.PI / 2).translate(-0.35, Rw, z));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; spokes.push(rod(V(-0.35, Rw, z - sz * 0.02), V(-0.35 + Math.cos(a) * (Rw - 0.045), Rw + Math.sin(a) * (Rw - 0.045), z), 0.0025, 3)); }
  }
  const glassG: THREE.BufferGeometry[] = [];
  const gh = 0.52;
  glassG.push(new THREE.PlaneGeometry(W - 0.04, gh).translate(0, 0.995 + gh / 2, gz));
  glassG.push(new THREE.PlaneGeometry(W - 0.04, gh).rotateY(Math.PI).translate(0, 0.995 + gh / 2, -gz));
  for (const sx of [-1, 1]) glassG.push(new THREE.PlaneGeometry(D - 0.04, gh).rotateY(sx * Math.PI / 2).translate(sx * gx, 0.995 + gh / 2, 0));
  const trim = block(W + 0.07, D + 0.05, 1.54, 0.12, 0.03, 0.01);
  const cl = (t: THREE.Texture, r: number) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(r, r); c.needsUpdate = true; return c; };
  const steel = new THREE.MeshStandardMaterial({ map: cl(st, 1.5), normalMap: cl(stN, 1.5), roughnessMap: cl(stR, 1.5), metalness: 0.85, roughness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xdfeaea, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.3 });
  const paint = new THREE.MeshStandardMaterial({ map: cl(paintT, 2), roughness: 0.45, metalness: 0.2 });
  const tankM = new THREE.MeshStandardMaterial({ map: cl(paintT, 1), color: 0x3a6ac0, roughness: 0.5, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
  return {
    parts: [
      { geom: mergeAll([body, counter, roof, shelf, ...frame]), mat: steel },
      { geom: clean(trim), mat: paint, tint: true },
      { geom: mergeAll([...wheels]), mat: rubber },
      { geom: mergeAll(spokes), mat: new THREE.MeshStandardMaterial({ color: 0xb0b4b8, metalness: 0.9, roughness: 0.35 }) },
      { geom: clean(tank), mat: tankM },
      { geom: mergeAll(glassG), mat: glass },
    ],
  };
}

export const VEHICLE_MODELS: Record<string, () => Promise<ProcModel>> = { scooter, food_cart: foodCart };
