import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../../core/assets';

/**
 * Properly modelled Thai street props that have no photoscan on Poly Haven, textured with the real
 * PP-plastic / band photo textures in textures/props (see its manifest). Origin bottom centre.
 *  - thai_stool : the classic moulded red/blue plastic stool (arched 4-leg skirt, rounded seat with
 *                 grip hole, embossed floral band) — colour comes from instance colours
 *  - bucket     : PP bucket with a rolled rim, inner wall, lugs and a steel bail handle
 *  - cone       : traffic cone, rounded-square foot with bevels, reflective collars
 */

export interface ProcPart { geom: THREE.BufferGeometry; mat: THREE.Material; tint?: boolean }
export interface ProcModel { parts: ProcPart[] }

const texCache = new Map<string, Promise<THREE.Texture>>();
function tex(path: string, srgb = true, neutral = false): Promise<THREE.Texture> {
  const key = path + srgb + neutral;
  let p = texCache.get(key);
  if (!p) {
    p = Assets.loadTexture(path, { srgb, repeat: 1 }).then((t) => (neutral ? greyed(t) : t));
    texCache.set(key, p);
  }
  return p;
}

/** grey-normalised copy (instance colours recolour it) */
function greyed(t: THREE.Texture, target = 0.8): THREE.Texture {
  const img = t.image as HTMLImageElement;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height), p = d.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += Math.max(p[i], p[i + 1], p[i + 2]);
  const k = (target * 255) / Math.max(1, sum / (p.length / 4));
  for (let i = 0; i < p.length; i += 4) { const l = Math.min(255, Math.max(p[i], p[i + 1], p[i + 2]) * k); p[i] = p[i + 1] = p[i + 2] = l; }
  ctx.putImageData(d, 0, 0);
  const o = new THREE.CanvasTexture(cv);
  o.colorSpace = THREE.SRGBColorSpace; o.wrapS = o.wrapT = THREE.RepeatWrapping; o.anisotropy = 4;
  return o;
}

/**
 * Lathe with tiling-friendly UVs: u = arc length at radius `uR` (m), v = profile length (m), both × `k`.
 * Profile points (r, y) must run counter-clockwise around the solid cross-section (outward normals).
 */
export function lathe(pts: [number, number][], segs: number, o: { k?: number; uR?: number; arc?: number } = {}): THREE.BufferGeometry {
  const k = o.k ?? 1, arc = o.arc ?? Math.PI * 2;
  const uR = o.uR ?? Math.max(...pts.map((p) => p[0]));
  const vs: number[] = [0];
  for (let i = 1; i < pts.length; i++) vs.push(vs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const a = (s / segs) * arc, sn = Math.sin(a), cs = Math.cos(a);
    for (let i = 0; i < pts.length; i++) {
      pos.push(pts[i][0] * sn, pts[i][1], pts[i][0] * cs);
      uv.push(a * uR * k, vs[i] * k);
    }
  }
  const n = pts.length;
  for (let s = 0; s < segs; s++) for (let i = 0; i < n - 1; i++) {
    const a = s * n + i, b = (s + 1) * n + i;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubeGeom(points: THREE.Vector3[], r: number, segs = 24, radial = 6) {
  const c = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(c, segs, r, radial, false);
}

function plasticMat(map: THREE.Texture, normal: THREE.Texture, rough: THREE.Texture, repeat: number, side: THREE.Side = THREE.FrontSide) {
  const cl = (t: THREE.Texture) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({ map: cl(map), normalMap: cl(normal), roughnessMap: cl(rough), roughness: 0.85, metalness: 0, side });
  m.normalScale.set(0.5, 0.5);
  m.envMapIntensity = 0.6;
  return m;
}

/** strip the attributes down to position/normal/uv so parts merge cleanly */
function clean(g: THREE.BufferGeometry) {
  const o = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv'].includes(k)) o.deleteAttribute(k);
  if (!o.getAttribute('normal')) o.computeVertexNormals();
  return o;
}
const mergeAll = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(clean), false)!;

// ------------------------------------------------------------------ the Thai plastic stool
async function thaiStool(): Promise<ProcModel> {
  const [map, nrm, rgh, band] = await Promise.all([
    tex('textures/props/plastic_pp_red.jpg', true, true), tex('textures/props/plastic_pp_n.jpg', false), tex('textures/props/plastic_pp_r.jpg', false),
    tex('textures/props/stool_band_floral_red.jpg', true, true),
  ]);
  const H = 0.44, rTop = 0.148, rBase = 0.188, Hs = H - 0.03;
  // seat: rounded rim, slightly domed top, grip hole, ribbed underside lip (CCW cross-section)
  const seat = lathe([
    [0.140, H - 0.034], [0.150, H - 0.031], [0.155, H - 0.022], [0.1555, H - 0.011], [0.152, H - 0.003], [0.144, H],
    [0.09, H + 0.0015], [0.034, H + 0.001], [0.027, H - 0.002], [0.024, H - 0.008], [0.024, H - 0.024], [0.032, H - 0.027],
    [0.128, H - 0.027], [0.140, H - 0.034],
  ], 40, { k: 1 });
  // skirt: unwrapped outline with 4 round-topped arches, tessellated and wrapped onto the cone
  const L = 2 * Math.PI * rBase, a = 0.098, ys = 0.165;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  for (let k = 0; k < 4; k++) {
    const c = L * (k + 0.5) / 4;
    sh.lineTo(c - a, 0);
    sh.lineTo(c - a, ys);
    sh.absarc(c, ys, a, Math.PI, 0, true);
    sh.lineTo(c + a, 0);
  }
  sh.lineTo(L, 0); sh.lineTo(L, Hs); sh.lineTo(0, Hs); sh.lineTo(0, 0);
  let flat: THREE.BufferGeometry = new THREE.ShapeGeometry(sh, 12);
  flat = new TessellateModifier(0.03, 10).modify(flat);
  const fp = flat.getAttribute('position') as THREE.BufferAttribute;
  const n = fp.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  const slope = (rBase - rTop) / Hs;
  for (let i = 0; i < n; i++) {
    const U = fp.getX(i), y = fp.getY(i);
    const th = (U / L) * Math.PI * 2;
    // the leg feet flare a touch, the top rolls into the seat
    const r = rBase + (rTop - rBase) * (y / Hs) + (y < 0.02 ? (0.02 - y) * 0.15 : 0);
    pos[i * 3] = r * Math.sin(th); pos[i * 3 + 1] = y; pos[i * 3 + 2] = r * Math.cos(th);
    const nl = Math.hypot(1, slope);
    nor[i * 3] = Math.sin(th) / nl; nor[i * 3 + 1] = slope / nl; nor[i * 3 + 2] = Math.cos(th) / nl;
    uvs[i * 2] = U; uvs[i * 2 + 1] = y;
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  skirt.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  skirt.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  // thickened rims: a rolled bead along the bottom of every leg and a stiffening ring under the band
  const beads: THREE.BufferGeometry[] = [];
  const legHalf = (L / 4 - 2 * a) / 2;
  for (let k = 0; k < 4; k++) {
    const c0 = L * k / 4;
    const pts: THREE.Vector3[] = [];
    for (let t = -1; t <= 1.001; t += 0.25) {
      const U = c0 + t * legHalf, th = (U / L) * Math.PI * 2, r = rBase + 0.003;
      pts.push(new THREE.Vector3(r * Math.sin(th), 0.006, r * Math.cos(th)));
    }
    beads.push(tubeGeom(pts, 0.006, 8, 5));
  }
  const ring = lathe([[rBase - (rBase - rTop) * (Hs - 0.085) / Hs + 0.004, Hs - 0.088], [rBase - (rBase - rTop) * (Hs - 0.083) / Hs + 0.007, Hs - 0.084], [rBase - (rBase - rTop) * (Hs - 0.079) / Hs + 0.004, Hs - 0.08]], 40);
  const body = mergeAll([seat, ...beads, ring]);
  // embossed floral band: a strip just proud of the skirt, between the ring and the seat
  const by0 = Hs - 0.078, by1 = Hs - 0.004;
  const r0 = rBase - (rBase - rTop) * by0 / Hs + 0.0018, r1 = rBase - (rBase - rTop) * by1 / Hs + 0.0018;
  const bandG = lathe([[r0, by0], [r1, by1]], 48, { k: 1 });
  const bu = bandG.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < bu.count; i++) { const s = Math.floor(i / 2); bu.setXY(i, (s / 48) * 2, i % 2); }
  const plastic = plasticMat(map, nrm, rgh, 3);
  const plasticD = plasticMat(map, nrm, rgh, 3, THREE.DoubleSide);
  const bandMat = new THREE.MeshStandardMaterial({ map: band, normalMap: nrm, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  bandMat.envMapIntensity = 0.6;
  return { parts: [{ geom: clean(body), mat: plastic, tint: true }, { geom: clean(skirt), mat: plasticD, tint: true }, { geom: clean(bandG), mat: bandMat, tint: true }] };
}

// ------------------------------------------------------------------ PP bucket with a steel bail
async function bucket(): Promise<ProcModel> {
  const [map, nrm, rgh] = await Promise.all([tex('textures/props/plastic_pp_blue.jpg', true, true), tex('textures/props/plastic_pp_n.jpg', false), tex('textures/props/plastic_pp_r.jpg', false)]);
  const shell = lathe([
    [0.0, 0.0], [0.108, 0.0], [0.116, 0.004], [0.119, 0.012], [0.146, 0.262], [0.149, 0.268], [0.158, 0.272], [0.161, 0.281],
    [0.157, 0.29], [0.149, 0.291], [0.143, 0.284], [0.141, 0.27], [0.113, 0.02], [0.105, 0.012], [0.0, 0.012],
  ], 32, { k: 1 });
  // horizontal stiffening ribs
  const rib = (y: number) => lathe([[0.119 + (y / 0.262) * 0.027, y - 0.006], [0.123 + (y / 0.262) * 0.027, y - 0.002], [0.123 + (y / 0.262) * 0.027, y + 0.002], [0.119 + (y / 0.262) * 0.027, y + 0.006]], 32);
  const lugs: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) { const b = new THREE.BoxGeometry(0.018, 0.034, 0.03); b.translate(s * 0.158, 0.255, 0); lugs.push(b); }
  const body = mergeAll([shell, rib(0.09), rib(0.18), ...lugs]);
  // bail: half circle flopped over to one side, with a plastic grip
  const pts: THREE.Vector3[] = [];
  const tilt = 1.05;
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI;
    const x = Math.cos(t) * 0.16, h = Math.sin(t) * 0.15;
    pts.push(new THREE.Vector3(x, 0.255 + h * Math.cos(tilt), h * Math.sin(tilt)));
  }
  const bail = tubeGeom(pts, 0.0028, 32, 5);
  const grip = new THREE.CylinderGeometry(0.009, 0.009, 0.1, 8);
  grip.rotateZ(Math.PI / 2); grip.translate(0, 0.255 + 0.15 * Math.cos(tilt), 0.15 * Math.sin(tilt));
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8b8b4, metalness: 0.85, roughness: 0.45 });
  return { parts: [{ geom: body, mat: plasticMat(map, nrm, rgh, 2, THREE.DoubleSide), tint: true }, { geom: mergeAll([bail, grip]), mat: steel, tint: false }] };
}

// ------------------------------------------------------------------ traffic cone
async function cone(): Promise<ProcModel> {
  const [map, nrm, rgh] = await Promise.all([tex('textures/props/plastic_pp_red.jpg', true, true), tex('textures/props/plastic_pp_n.jpg', false), tex('textures/props/plastic_pp_r.jpg', false)]);
  // rounded-square bevelled foot
  const s = new THREE.Shape();
  const hw = 0.175, rr = 0.04;
  s.moveTo(-hw + rr, -hw); s.lineTo(hw - rr, -hw); s.quadraticCurveTo(hw, -hw, hw, -hw + rr); s.lineTo(hw, hw - rr); s.quadraticCurveTo(hw, hw, hw - rr, hw);
  s.lineTo(-hw + rr, hw); s.quadraticCurveTo(-hw, hw, -hw, hw - rr); s.lineTo(-hw, -hw + rr); s.quadraticCurveTo(-hw, -hw, -hw + rr, -hw);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.115, 0, Math.PI * 2, true); s.holes.push(hole);
  const foot = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
  foot.rotateX(-Math.PI / 2); foot.translate(0, 0.006, 0);
  const body = lathe([[0.135, 0.02], [0.128, 0.05], [0.04, 0.66], [0.032, 0.685], [0.02, 0.692], [0.0, 0.693], [0.0, 0.62], [0.03, 0.62], [0.12, 0.035], [0.126, 0.02]], 28, { k: 1 });
  const band = (y0: number, y1: number) => {
    const r = (y: number) => 0.128 - ((y - 0.05) / 0.61) * 0.088 + 0.0015;
    return lathe([[r(y0), y0], [r(y1), y1]], 28);
  };
  const reflect = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, metalness: 0.1, emissive: 0x111111 });
  return { parts: [{ geom: mergeAll([foot, body]), mat: plasticMat(map, nrm, rgh, 2), tint: true }, { geom: mergeAll([band(0.33, 0.43), band(0.5, 0.56)]), mat: reflect, tint: false }] };
}

export const PROC_MODELS: Record<string, () => Promise<ProcModel>> = { thai_stool: thaiStool, bucket, cone };
