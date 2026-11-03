import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../../core/assets';
import type { Brand } from './brand';
import { keyAtlas, keyCell, KEY_ATLAS, sticker, StickerId, signTexture, sideLogoTexture, dirtTexture, smudgeTexture } from './tex';

/* ============================================================================================
 * Standalone Thai street ATM ("cash deposit + withdrawal", the kind outside a corner store),
 * built in code to real scale: origin bottom centre, +Z = front, metres.
 *
 *   concrete pad → kick base → painted safe cabinet (door, lock, vents, maker plate, stickers)
 *   → silver fascia (one bevelled side-profile extrusion: cash slot face, keypad deck, slanted
 *     screen face, canopy lip) → painted privacy wings → lit header sign with canopy LED strip.
 *   Screen face: glossy black bezel, 15" LCD (canvas), 4+4 function keys, rear-view mirror strip,
 *     camera dome, card reader (green anti-skim bezel + LED), receipt slot, fee/skimmer stickers,
 *     speaker grille.  Deck: stainless EPP keypad (4x4, instanced, labelled) under a privacy hood.
 *
 * Static parts are merged per material (≈12 draw calls); keys are InstancedMeshes (press anim).
 * Frames (screenFrame / deckFrame / cashFrame) are Object3Ds whose local XY lies on that face
 * with +Z pointing out, so interactive bits are placed in face coordinates.
 * ========================================================================================== */

export const KEYPAD = [
  ['1', '2', '3', 'CANCEL'],
  ['4', '5', '6', 'CLEAR'],
  ['7', '8', '9', 'ENTER'],
  ['B1', '0', 'B2', 'B3'],
];
export const FDK_IDS = ['L0', 'L1', 'L2', 'L3', 'R0', 'R1', 'R2', 'R3'];
/** canvas rows (of 768) the FDKs line up with */
export const FDK_ROWS = [330, 440, 550, 660];
export const SCREEN = { w: 0.312, h: 0.234, cy: 0.022 };

export interface AtmModel {
  root: THREE.Group;
  screenFrame: THREE.Object3D;
  deckFrame: THREE.Object3D;
  cashFrame: THREE.Object3D;
  screen: THREE.Mesh;
  screenMat: THREE.MeshStandardMaterial;
  signMat: THREE.MeshStandardMaterial;
  keyCaps: THREE.InstancedMesh;
  keyLabels: THREE.InstancedMesh;
  keyBase: THREE.Matrix4[];
  keyIds: string[];
  fdkCaps: THREE.InstancedMesh;
  fdkLabels: THREE.InstancedMesh;
  fdkBase: THREE.Matrix4[];
  cardLed: THREE.MeshStandardMaterial;
  cashLed: THREE.MeshStandardMaterial;
  shutter: THREE.Mesh;
  /** slot anchors in their frames: position = mouth centre, +Z = out of the slot */
  cardSlot: THREE.Object3D;
  cashSlot: THREE.Object3D;
  receiptSlot: THREE.Object3D;
  /** invisible click boxes */
  hitCard: THREE.Mesh;
  hitCash: THREE.Mesh;
  hitReceipt: THREE.Mesh;
  ledWhite: THREE.MeshStandardMaterial;
  /** small detail meshes hidden at distance (stickers, keys, labels, lens, dirt…) */
  details: THREE.Object3D[];
  dispose(): void;
}

// ------------------------------------------------------------------ geometry helpers

function nonIndexed(g: THREE.BufferGeometry) { return g.index ? g.toNonIndexed() : g; }

/** Box-projected UVs in metres (per triangle, dominant axis) → consistent texel density across parts. */
function boxUV(g: THREE.BufferGeometry, tile: number) {
  g = nonIndexed(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u = 0, w = 0;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = w / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function rbox(w: number, h: number, d: number, r: number, seg = 2) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(r, 0.0002));
}

function rrect(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
function rrectPath(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Path();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** rounded-rect ring (frame / bezel) in XY, extruded +Z from 0 to depth, bevelled */
function ring(ow: number, oh: number, or: number, iw: number, ih: number, ir: number, depth: number, bevel = 0.0015) {
  const s = rrect(ow - bevel * 2, oh - bevel * 2, Math.max(0.0005, or - bevel));
  s.holes.push(rrectPath(iw + bevel * 2, ih + bevel * 2, Math.max(0.0005, ir + bevel)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, depth - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, bevel);
  return g;
}

/** side profile (u = z, v = y) extruded across X, centred: (u,v,w) → (x = depth/2 − w, y = v, z = u) */
function profileX(shape: THREE.Shape, width: number, bevel: number, xc = 0, curve = 5) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve });
  const m = new THREE.Matrix4().set(0, 0, -1, depth / 2 + xc, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  return g;
}

function shapeFrom(pts: [number, number][]) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** face frame on a profile segment P→Q (z,y), offset out by `off` along the outward normal */
function faceFrame(P: [number, number], Q: [number, number], off: number) {
  const dz = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dz, dy);
  const uz = dz / L, uy = dy / L;
  const nz = uy, ny = -uz;                       // outward normal (rotate d by −90°)
  const o = new THREE.Object3D();
  o.position.set(0, (P[1] + Q[1]) / 2 + ny * off, (P[0] + Q[0]) / 2 + nz * off);
  // local +Y → (0, uy, uz): R_x(φ)·(0,1,0) = (0, cosφ, sinφ) ⇒ φ = atan2(uz, uy)
  o.rotation.x = Math.atan2(uz, uy);
  o.updateMatrix();
  return { obj: o, len: L };
}

// ------------------------------------------------------------------ materials (shared)

const matCache = new Map<string, THREE.Material>();
function M<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T;
  if (!m) matCache.set(key, (m = make()));
  return m;
}
const tileOf = (id: string) => Assets.pbrManifest[id]?.tileMeters ?? 0.5;

function mats(b: Brand) {
  return {
    brand: M('atm:paint:' + b.id, () => { const m = Assets.pbr('metal_painted_chipped', { color: b.paint }).clone(); m.roughness = 0.9; return m; }),
    fascia: M('atm:fascia', () => { const m = Assets.pbr('aluminium_scratched', { color: 0xe4e7ea }).clone(); m.metalness = 0.65; return m; }),
    black: M('atm:black', () => { const m = Assets.pbr('plastic_glossy', { color: 0x16181b }).clone(); m.roughness = 0.6; return m; }),
    matte: M('atm:matte', () => Assets.pbr('plastic_rough', { color: 0x232528 })),
    steel: M('atm:steel', () => Assets.pbr('stainless_brushed')),
    chrome: M('atm:chrome', () => Assets.pbr('chrome')),
    rubber: M('atm:rubber', () => Assets.pbr('rubber_black')),
    concrete: M('atm:concrete', () => Assets.pbr('concrete_streaked')),
    galv: M('atm:galv', () => Assets.pbr('galvanized_steel')),
    dark: M('atm:dark', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 })),
    mirror: M('atm:mirror', () => new THREE.MeshStandardMaterial({ color: 0xcfd6dc, metalness: 1, roughness: 0.06 })),
    lens: M('atm:lens', () => new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 })),
    ledWhite: M('atm:ledw', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef6ff, emissiveIntensity: 2.2, roughness: 0.4 })),
  };
}

const TILE: Record<string, string> = { brand: 'metal_painted_chipped', fascia: 'aluminium_scratched', black: 'plastic_glossy', matte: 'plastic_rough', steel: 'stainless_brushed', chrome: 'chrome', rubber: 'rubber_black', concrete: 'concrete_streaked', galv: 'galvanized_steel' };

// ------------------------------------------------------------------ build

export function buildAtm(b: Brand): AtmModel {
  const MT = mats(b);
  const root = new THREE.Group();
  root.name = 'atm';
  const lists = new Map<string, THREE.BufferGeometry[]>();
  const details: THREE.Object3D[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  /** add a static part (geometry already in root space unless `parent` frame given) */
  const add = (key: keyof ReturnType<typeof mats>, g: THREE.BufferGeometry, parent?: THREE.Object3D) => {
    if (parent) { parent.updateMatrix(); g.applyMatrix4(parent.matrix); }
    let gg = nonIndexed(g);
    gg = boxUV(gg, TILE[key] ? tileOf(TILE[key]) : 0.5);
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    let l = lists.get(key);
    if (!l) lists.set(key, (l = []));
    l.push(gg);
  };
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    return g.applyMatrix4(m);
  };

  // ---------------------------------------------------------------- pad, base, safe cabinet
  add('concrete', at(rbox(0.9, 0.06, 0.86, 0.014), 0, 0.03, 0.03));
  add('matte', at(rbox(0.66, 0.07, 0.58, 0.008), 0, 0.095, -0.03));
  for (const [x, z] of [[-0.29, 0.25], [0.29, 0.25], [-0.29, -0.3], [0.29, -0.3]]) {
    add('steel', at(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 6), x, 0.066, z));
    add('galv', at(new THREE.CylinderGeometry(0.006, 0.006, 0.018, 8), x, 0.074, z));
  }
  add('brand', at(rbox(0.7, 0.8, 0.62, 0.024, 3), 0, 0.53, -0.02));
  // door: inset panel with a perimeter gap (dark) + lock + handle recess + vents
  add('dark', at(rbox(0.618, 0.652, 0.004, 0.006), 0, 0.535, 0.291));
  add('brand', at(rbox(0.608, 0.642, 0.016, 0.006), 0, 0.535, 0.296));
  add('chrome', at(new THREE.CylinderGeometry(0.014, 0.015, 0.012, 20), 0.245, 0.655, 0.307, Math.PI / 2));
  add('dark', at(rbox(0.0035, 0.013, 0.004, 0.001), 0.245, 0.655, 0.3135));
  add('dark', at(rbox(0.09, 0.022, 0.006, 0.006), 0.245, 0.6, 0.3035));
  for (let i = 0; i < 7; i++) add('dark', at(rbox(0.32, 0.007, 0.004, 0.0015), 0, 0.26 + i * 0.016, 0.3045));
  // back: cable conduit into the pavement
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.22, -0.02, -0.5), new THREE.Vector3(0.22, 0.03, -0.42), new THREE.Vector3(0.22, 0.12, -0.36), new THREE.Vector3(0.22, 0.24, -0.335)]);
  add('galv', new THREE.TubeGeometry(curve, 10, 0.016, 8, false));
  add('galv', at(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 10), 0.22, 0.24, -0.334, Math.PI / 2));

  // ---------------------------------------------------------------- fascia (one bevelled profile)
  const BV = 0.007;
  const P: Record<string, [number, number]> = {
    A: [-0.32, 0.93], B: [0.4, 0.93], C: [0.386, 1.035], D: [0.43, 1.05], E: [0.445, 1.075], F: [0.255, 1.12],
    G: [0.24, 1.145], H: [0.165, 1.565], I: [0.3, 1.605], J: [0.305, 1.64], K: [-0.32, 1.64],
  };
  const prof = shapeFrom(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((k) => P[k]));
  add('fascia', profileX(prof, 0.7, BV, 0, 2));
  // ---------------------------------------------------------------- privacy wings (painted)
  const wing = new THREE.Shape();
  wing.moveTo(-0.31, 0.935); wing.lineTo(0.42, 0.935);
  wing.quadraticCurveTo(0.51, 0.96, 0.525, 1.1);
  wing.quadraticCurveTo(0.53, 1.25, 0.42, 1.42);
  wing.quadraticCurveTo(0.34, 1.56, 0.33, 1.66);
  wing.lineTo(-0.31, 1.66); wing.closePath();
  for (const s of [-1, 1]) {
    add('brand', profileX(wing, 0.024, 0.005, s * 0.363, 8));
    // chrome edge trim on the wing front
    const trim = new THREE.CatmullRomCurve3([[0.42, 0.94], [0.5, 0.98], [0.53, 1.1], [0.5, 1.28], [0.42, 1.43], [0.34, 1.6]].map(([z, y]) => new THREE.Vector3(s * 0.363, y, z + 0.004)));
    add('chrome', new THREE.TubeGeometry(trim, 24, 0.0045, 6, false));
  }
  // ---------------------------------------------------------------- header sign box + canopy
  add('brand', at(rbox(0.76, 0.27, 0.68, 0.022, 3), 0, 1.775, -0.005));
  add('chrome', at(ring(0.725, 0.238, 0.012, 0.7, 0.215, 0.006, 0.006), 0, 1.778, 0.333));
  add('chrome', at(rbox(0.77, 0.012, 0.69, 0.005), 0, 1.642, -0.005));
  add('ledWhite', at(rbox(0.5, 0.006, 0.014, 0.002), 0, 1.632, 0.27));
  const signMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0xffffff, emissiveMap: signTexture(b), emissiveIntensity: 1.35, roughness: 0.28, map: signTexture(b) });
  signMat.userData.ink = 0;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.215), signMat);
  sign.position.set(0, 1.778, 0.3365);
  root.add(sign);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sideLogoTexture(b), emissiveIntensity: 0.9, map: sideLogoTexture(b), roughness: 0.35 });
  for (const s of [-1, 1]) {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), sideMat);
    sm.position.set(s * 0.3805, 1.775, -0.01);
    sm.rotation.y = s * Math.PI / 2;
    root.add(sm);
  }

  // ---------------------------------------------------------------- screen face
  const SF = faceFrame(P.G, P.H, BV);
  const screenFrame = SF.obj;
  root.add(screenFrame);
  // bezel with the LCD opening (glossy black), screen recessed inside
  add('black', ring(0.44, 0.366, 0.02, SCREEN.w, SCREEN.h, 0.005, 0.014).translate(0, 0.0, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.022, 0)), screenFrame);
  add('dark', at(new THREE.PlaneGeometry(SCREEN.w + 0.01, SCREEN.h + 0.01), 0, SCREEN.cy, 0.0015), screenFrame);
  const smudge = smudgeTexture();
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x020203, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 1, roughnessMap: smudge, metalness: 0 });
  screenMat.userData.ink = 0; screenMat.userData.cel = 0;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat);
  screen.position.set(0, SCREEN.cy, 0.0045);
  screen.name = 'atm-screen';
  screenFrame.add(screen);
  // mirror strip + camera dome
  add('chrome', at(rbox(0.27, 0.02, 0.004, 0.0015), 0, 0.172, 0.0145), screenFrame);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.262, 0.013), MT.mirror);
  mirror.position.set(0, 0.172, 0.0167);
  screenFrame.add(mirror);
  add('black', at(new THREE.SphereGeometry(0.012, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.192, 0.014, Math.PI / 2), screenFrame);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 12, 8), MT.lens);
  lens.position.set(0, 0.192, 0.0235);
  screenFrame.add(lens);
  // FDKs (4 + 4) with chrome surrounds
  const fdkY = FDK_ROWS.map((cy) => SCREEN.cy + SCREEN.h / 2 - (cy / 768) * SCREEN.h);
  const fdkBase: THREE.Matrix4[] = [];
  const capGeoF = rbox(0.034, 0.022, 0.008, 0.0028, 2);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = side * (SCREEN.w / 2 + 0.033), y = fdkY[i];
    add('chrome', at(rbox(0.041, 0.029, 0.003, 0.003), x, y, 0.0155), screenFrame);
    fdkBase.push(new THREE.Matrix4().makeTranslation(x, y, 0.0185));
  }
  const fdkCaps = new THREE.InstancedMesh(capGeoF, MT.steel, 8);
  const fdkLabels = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.031, 0.02).translate(0, 0, 0.0042), labelMaterial(), 8);
  const fdkCell = new Float32Array(16);
  for (let i = 0; i < 8; i++) {
    fdkCaps.setMatrixAt(i, fdkBase[i]); fdkLabels.setMatrixAt(i, fdkBase[i]);
    const cell = keyCell(i < 4 ? 'FDK_L' : 'FDK_R');
    fdkCell.set(cellOffset(cell), i * 2);
  }
  fdkLabels.geometry.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(fdkCell, 2));
  fdkCaps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24).fill(1), 3);
  screenFrame.add(fdkCaps, fdkLabels);
  // card reader (right): housing, green anti-skim bezel with LED, slot, pictogram, skimmer sticker
  const CR = { x: 0.29, y: -0.09 };
  add('black', at(rbox(0.1, 0.1, 0.03, 0.009), CR.x, CR.y, 0.015), screenFrame);
  const cardLed = new THREE.MeshStandardMaterial({ color: 0x1e8a44, emissive: 0x30ff70, emissiveIntensity: 0.6, roughness: 0.22, transparent: true, opacity: 0.9 });
  cardLed.userData.ink = 0.4;
  const bezel = new THREE.Mesh(ring(0.086, 0.036, 0.013, 0.064, 0.0065, 0.0025, 0.024), cardLed);
  bezel.position.set(CR.x, CR.y, 0.03);
  screenFrame.add(bezel);
  add('dark', at(new THREE.PlaneGeometry(0.066, 0.0085), CR.x, CR.y, 0.042), screenFrame);
  const cardSlot = new THREE.Object3D();
  cardSlot.position.set(CR.x, CR.y, 0.054);
  screenFrame.add(cardSlot);
  // receipt slot (left)
  const RS = { x: -0.29, y: -0.06 };
  add('black', at(rbox(0.11, 0.05, 0.016, 0.006), RS.x, RS.y, 0.008), screenFrame);
  add('chrome', at(ring(0.098, 0.026, 0.006, 0.084, 0.0055, 0.002, 0.008), RS.x, RS.y, 0.016), screenFrame);
  add('dark', at(new THREE.PlaneGeometry(0.086, 0.0075), RS.x, RS.y, 0.0195), screenFrame);
  const receiptSlot = new THREE.Object3D();
  receiptSlot.position.set(RS.x, RS.y, 0.024);
  screenFrame.add(receiptSlot);
  // speaker + headphone jack (left, low)
  add('black', at(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 14), -0.25, -0.165, 0.003, Math.PI / 2), screenFrame);
  add('dark', at(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 10), -0.25, -0.165, 0.0065, Math.PI / 2), screenFrame);
  // stickers on the screen face
  const st = (id: StickerId, w: number, x: number, y: number, z: number, parent: THREE.Object3D, rotY = 0, rotZ = 0) => {
    const s = sticker(id, b);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / s.aspect), stickerMat(id + b.id, s.tex));
    m.position.set(x, y, z); m.rotation.set(0, rotY, rotZ);
    m.renderOrder = 1;
    parent.add(m);
    details.push(m);
    return m;
  };
  st('skimmer', 0.075, 0.29, 0.1, 0.0012, screenFrame, 0, 0.02);
  st('card', 0.07, 0.29, -0.012, 0.0012, screenFrame);
  st('fee', 0.08, -0.29, 0.085, 0.0012, screenFrame, 0, -0.015);
  st('receipt', 0.09, -0.29, -0.1, 0.0012, screenFrame);
  st('speaker', 0.034, -0.3, -0.165, 0.0012, screenFrame);
  // ---------------------------------------------------------------- keypad deck
  const DF = faceFrame(P.E, P.F, BV);
  const deckFrame = DF.obj;
  root.add(deckFrame);
  add('steel', at(rbox(0.172, 0.146, 0.006, 0.004), 0, 0, 0.003), deckFrame);
  add('dark', at(rbox(0.178, 0.152, 0.002, 0.004), 0, 0, 0.001), deckFrame);
  for (const [x, y] of [[-0.078, -0.064], [0.078, -0.064], [-0.078, 0.064], [0.078, 0.064]]) add('chrome', at(new THREE.CylinderGeometry(0.003, 0.003, 0.0015, 10), x, y, 0.0065, Math.PI / 2), deckFrame);
  // privacy hood (three sides + partial roof), black plastic
  const hoodSide = shapeFrom([[-0.088, 0], [0.098, 0], [0.098, 0.078], [-0.088, 0.03]]);
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(hoodSide, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
    // shape (y, z) extruded along x
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, s * 0.095 - 0.003, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    add('matte', g, deckFrame);
  }
  add('matte', at(rbox(0.196, 0.006, 0.078, 0.002), 0, 0.099, 0.039), deckFrame);
  add('matte', at(rbox(0.196, 0.06, 0.005, 0.002), 0, 0.072, 0.076, -0.12), deckFrame);
  // keys (instanced caps + labels)
  const keyIds: string[] = [];
  const keyBase: THREE.Matrix4[] = [];
  KEYPAD.forEach((row, r) => row.forEach((id, c) => {
    keyIds.push(id);
    keyBase.push(new THREE.Matrix4().makeTranslation((c - 1.5) * 0.038, (1.5 - r) * 0.031 - 0.004, 0.0105));
  }));
  const keyCaps = new THREE.InstancedMesh(rbox(0.032, 0.025, 0.009, 0.003, 2), MT.steel, 16);
  const keyLabels = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.0305, 0.0235).translate(0, 0, 0.00465), labelMaterial(), 16);
  const kc = new Float32Array(32), col = new Float32Array(48);
  keyIds.forEach((id, i) => {
    keyCaps.setMatrixAt(i, keyBase[i]); keyLabels.setMatrixAt(i, keyBase[i]);
    kc.set(cellOffset(keyCell(id)), i * 2);
    const t = id === 'CANCEL' ? [1, 0.32, 0.28] : id === 'CLEAR' ? [1, 0.85, 0.35] : id === 'ENTER' ? [0.35, 0.95, 0.45] : id.startsWith('B') ? [0.62, 0.64, 0.66] : [1, 1, 1];
    col.set(t, i * 3);
  });
  keyLabels.geometry.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(kc, 2));
  keyCaps.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  deckFrame.add(keyCaps, keyLabels);
  // ---------------------------------------------------------------- cash slot (under the deck)
  const CF = faceFrame(P.B, P.C, BV);
  const cashFrame = CF.obj;
  root.add(cashFrame);
  add('chrome', ring(0.28, 0.072, 0.01, 0.25, 0.046, 0.006, 0.012), cashFrame);
  add('dark', at(new THREE.PlaneGeometry(0.252, 0.048), 0, 0, 0.0012), cashFrame);
  const cashLed = new THREE.MeshStandardMaterial({ color: 0x0e3a1c, emissive: 0x2cff66, emissiveIntensity: 0.0, roughness: 0.3 });
  cashLed.userData.ink = 0;
  const led = new THREE.Mesh(rbox(0.24, 0.003, 0.003, 0.001), cashLed);
  led.position.set(0, 0.0255, 0.008);
  cashFrame.add(led);
  const shutter = new THREE.Mesh(rbox(0.248, 0.046, 0.004, 0.0015).translate(0, -0.023, 0), MT.matte);
  shutter.position.set(0, 0.023, 0.004);
  cashFrame.add(shutter);
  const cashSlot = new THREE.Object3D();
  cashSlot.position.set(0, 0, 0.006);
  cashFrame.add(cashSlot);
  st('cash', 0.1, 0.205, 0.0, 0.0012, cashFrame);
  // ---------------------------------------------------------------- stickers / plates on the cabinet and wings
  add('steel', at(rbox(0.128, 0.045, 0.002, 0.002), -0.19, 0.83, 0.305));
  st('maker', 0.122, -0.19, 0.83, 0.3062, root);
  st('service', 0.2, 0.05, 0.735, 0.3052, root);
  st('24h', 0.11, -0.3765, 1.47, 0.22, root, -Math.PI / 2);
  st('cctv', 0.13, 0.3765, 1.47, 0.16, root, Math.PI / 2, 0.03);
  st('loan', 0.075, 0.3515, 0.74, -0.12, root, Math.PI / 2, -0.06);
  // dirt creeping up the cabinet (rain splash / mop water)
  const dirtM = M('atm:dirt', () => { const m = new THREE.MeshStandardMaterial({ map: dirtTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); m.userData.ink = 0; return m; });
  const dirtF = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.28), dirtM);
  dirtF.position.set(0, 0.27, 0.3056);
  root.add(dirtF);
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.28), dirtM);
    d.position.set(s * 0.3506, 0.27, -0.02); d.rotation.y = s * Math.PI / 2;
    root.add(d);
    details.push(d);
  }

  // ---------------------------------------------------------------- merge statics
  const matFor = (key: string): THREE.Material => (MT as any)[key];
  for (const [key, list] of lists) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    disposables.push(g);
    const mesh = new THREE.Mesh(g, matFor(key));
    mesh.name = 'atm:' + key;
    const big = key === 'brand' || key === 'fascia' || key === 'concrete' || key === 'black';
    mesh.castShadow = big; mesh.receiveShadow = true;
    root.add(mesh);
    list.forEach((x) => x.dispose());
  }
  for (const m of [keyCaps, fdkCaps]) { m.castShadow = false; m.receiveShadow = true; }
  details.push(keyCaps, keyLabels, fdkCaps, fdkLabels, lens, mirror, led, dirtF);
  for (const m of [keyLabels, fdkLabels]) { m.castShadow = false; m.renderOrder = 2; }
  // click boxes
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hb = (w: number, h: number, d: number, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const hitCard = hb(0.11, 0.1, 0.07, screenFrame, CR.x, CR.y, 0.035);
  const hitReceipt = hb(0.11, 0.06, 0.05, screenFrame, RS.x, RS.y, 0.02);
  const hitCash = hb(0.29, 0.08, 0.09, cashFrame, 0, 0, 0.04);
  root.traverse((o: any) => { if (o.isMesh && !o.name.startsWith('atm:')) { o.castShadow = false; o.receiveShadow = true; } });
  return {
    root, screenFrame, deckFrame, cashFrame, screen, screenMat, signMat, keyCaps, keyLabels, keyBase, keyIds, fdkCaps, fdkLabels, fdkBase,
    cardLed, cashLed, shutter, cardSlot, cashSlot, receiptSlot, hitCard, hitCash, hitReceipt, ledWhite: MT.ledWhite, details,
    dispose() { disposables.forEach((g) => g.dispose()); screen.geometry.dispose(); },
  };
}

// ------------------------------------------------------------------ label material (instanced UV offsets)

function cellOffset(cell: number): [number, number] {
  const { cols, rows } = KEY_ATLAS;
  const cx = cell % cols, cy = Math.floor(cell / cols);
  const H = 128 * rows;
  return [cx / cols, 1 - (cy * 128 + 112) / H];
}

function labelMaterial() {
  return M('atm:labels', () => {
    const m = new THREE.MeshStandardMaterial({ map: keyAtlas(), transparent: true, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false });
    m.userData.ink = 0; m.userData.cel = 0;
    const { cols, rows } = KEY_ATLAS;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCell = { value: new THREE.Vector2(1 / cols, 96 / (128 * rows)) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aUvOff;\nuniform vec2 uCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uv * uCell + aUvOff;\n#endif');
    };
    m.customProgramCacheKey = () => 'atm-labels';
    return m;
  });
}

function stickerMat(key: string, tex: THREE.Texture) {
  return M('atm:st:' + key, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.02, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.ink = 0;
    return m;
  });
}
