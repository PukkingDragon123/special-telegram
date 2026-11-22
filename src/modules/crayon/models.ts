import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { crayonText, hashStr } from './wax';

/* Crayon (wax stick + printed paper wrapper) and the hand-written cardboard sign. */

export const CRAYON_COLORS: { c: string; th: string; en: string }[] = [
  { c: '#d42d26', th: 'แดง', en: 'red' },
  { c: '#2457cf', th: 'น้ำเงิน', en: 'blue' },
  { c: '#1d1b1c', th: 'ดำ', en: 'black' },
  { c: '#25953f', th: 'เขียว', en: 'green' },
  { c: '#7b39b8', th: 'ม่วง', en: 'purple' },
  { c: '#ee7a12', th: 'ส้ม', en: 'orange' },
];
export const colorOf = (i: number) => CRAYON_COLORS[((i % CRAYON_COLORS.length) + CRAYON_COLORS.length) % CRAYON_COLORS.length];

const wrapTex = new Map<string, THREE.Texture>();
function wrapperTex(col: string) {
  let t = wrapTex.get(col);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = col; g.fillRect(0, 0, 256, 64);
  // printed wrapper: dark bands, a little brand-less label, paper fibres
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 6, 256, 4); g.fillRect(0, 54, 256, 4);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(70, 18, 116, 28);
  g.fillStyle = col; g.font = `800 20px ${F.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('สีเทียน', 128, 33);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 64, 2, 1); }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  wrapTex.set(col, t);
  return t;
}

/** a crayon lying along X, origin bottom centre */
export function buildCrayon(ci: number): THREE.Group {
  const col = colorOf(ci).c;
  const g = new THREE.Group();
  const R = 0.0052, L = 0.088;
  const wax = new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L - 0.012, 14), wax);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.07, R * 1.07, L * 0.66, 14, 1, true), new THREE.MeshStandardMaterial({ map: wrapperTex(col), roughness: 0.85, side: THREE.DoubleSide }));
  wrap.position.y = -L * 0.08;
  // worn, slanted tip
  const tipG = new THREE.ConeGeometry(R, 0.013, 14, 1);
  const p = tipG.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.003) { p.setX(i, p.getX(i) * 0.45 + 0.0012); p.setY(i, p.getY(i) - 0.0025); }
  tipG.computeVertexNormals();
  const tip = new THREE.Mesh(tipG, wax);
  tip.position.y = (L - 0.012) / 2 + 0.0063;
  const stick = new THREE.Group();
  stick.add(body, wrap, tip);
  stick.rotation.z = -Math.PI / 2;     // lie along +X (tip at +X)
  stick.position.y = R;
  g.add(stick);
  g.userData.tip = tip;
  return g;
}

// ---------------------------------------------------------------- cardboard sign
export const SIGN_W = 0.56, SIGN_H = 0.4;
const TEX_W = 896, TEX_H = Math.round(896 * SIGN_H / SIGN_W);

/** blank kraft board (no printing: the printed box flaps fight with the writing) */
function kraftTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 368;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 512, 368);
  grd.addColorStop(0, '#c49a64'); grd.addColorStop(0.55, '#b98d58'); grd.addColorStop(1, '#a97d4b');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 368);
  // fibres, blotches, a crease and a scuffed corner
  for (let i = 0; i < 2600; i++) { const v = Math.random(); g.fillStyle = v < 0.5 ? `rgba(90,58,25,${Math.random() * 0.12})` : `rgba(235,205,160,${Math.random() * 0.12})`; g.fillRect(Math.random() * 512, Math.random() * 368, 1 + Math.random() * 6, 1); }
  for (let i = 0; i < 14; i++) { const x = Math.random() * 512, y = Math.random() * 368, r = 20 + Math.random() * 70; const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(110,70,30,${0.05 + Math.random() * 0.07})`); rg.addColorStop(1, 'rgba(110,70,30,0)'); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(80,50,20,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 40 + Math.random() * 20); g.lineTo(512, 30 + Math.random() * 30); g.stroke();
  g.strokeStyle = 'rgba(255,235,200,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 44); g.lineTo(512, 36); g.stroke();
  g.fillStyle = 'rgba(70,45,20,0.18)'; g.fillRect(0, 0, 512, 4); g.fillRect(0, 364, 512, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let boardMats: THREE.Material[] | null = null;
function boardMaterials(): THREE.Material[] {
  if (boardMats) return boardMats;
  const face = new THREE.MeshStandardMaterial({ map: kraftTex(), normalMap: Assets.texture('textures/props/cardboard_corrugated_tile_n.jpg', { srgb: false, repeat: 2 }), roughness: 0.92, color: 0xffffff });
  face.normalScale.set(0.35, 0.35);
  const side = new THREE.MeshStandardMaterial({ map: Assets.texture('textures/props/cardboard_corrugated_tile.jpg', { repeat: 4 }), roughness: 0.95, color: 0xd9b98c });
  const back = new THREE.MeshStandardMaterial({ map: Assets.texture('textures/props/cardboard_mat_mama.jpg', { wrap: false }), roughness: 0.92 });
  return (boardMats = [side, side, side, side, face, back]);
}

/** a hand-written cardboard sign, standing upright (front = +Z), origin bottom centre */
export function buildSign(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(SIGN_W, SIGN_H, 0.006, 10, 8, 1);
  // a little warp (old box flap) + torn-ish corners
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / SIGN_W, y = p.getY(i) / SIGN_H;
    p.setZ(i, p.getZ(i) + Math.sin(x * 3.1 + 0.7) * Math.cos(y * 2.3) * 0.008 - x * x * 0.012);
    if (Math.abs(x) > 0.46 && Math.abs(y) > 0.42) p.setY(i, p.getY(i) * 0.97);
  }
  geo.computeVertexNormals();
  const board = new THREE.Mesh(geo, boardMaterials());
  board.position.y = SIGN_H / 2;
  g.add(board);
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ink = new THREE.Mesh(
    (() => {
      const pg = new THREE.PlaneGeometry(SIGN_W * 0.98, SIGN_H * 0.98, 10, 8);
      const q = pg.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < q.count; i++) { const x = q.getX(i) / SIGN_W, y = q.getY(i) / SIGN_H; q.setZ(i, Math.sin(x * 3.1 + 0.7) * Math.cos(y * 2.3) * 0.008 - x * x * 0.012 + 0.0034); }
      return pg;
    })(),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  ink.position.y = SIGN_H / 2;
  ink.renderOrder = 2;
  g.add(ink);
  g.userData.signCanvas = c;
  g.userData.signTex = tex;
  g.userData.signMsg = null;
  return g;
}

/** (re)draw the crayon writing on a sign built by buildSign */
export function drawSign(obj: THREE.Object3D, msg: string, color: string, seed?: number) {
  const c = obj.userData.signCanvas as HTMLCanvasElement | undefined;
  if (!c) return;
  const key = msg + '|' + color;
  if (obj.userData.signMsg === key) return;
  obj.userData.signMsg = key;
  crayonText(c, msg, { color, seed: seed ?? hashStr(msg), maxSize: TEX_H * 0.34, weight: 560 });
  (obj.userData.signTex as THREE.Texture).needsUpdate = true;
}
