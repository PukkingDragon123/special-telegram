import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { REWARDS } from './lines';

/* ============================================================================================
 * หมายจับ — the WANTED poster. Printed on a real creased-paper photo (ambientCG Paper003), with a
 * real render of the player's own character (mugshot: the rig with its photo face, hair, clothes)
 * and looped Thai type (F.*). Taped to a concrete pole next to a cluster of real loan flyers
 * (world decal photo). The paper flaps in the wind (CPU vertex wave, only when near the camera).
 * ========================================================================================== */

const PW = 0.42, PH = 0.594;
const CW = 512, CH = 724;

/** Render a mugshot of a character rig to a canvas (sRGB, transparent background). */
export function renderMugshot(game: Game, rig: CharacterRig, w = 256, h = 320): HTMLCanvasElement | null {
  const R = game.engine.renderer;
  const root = rig.root;
  const prevParent = root.parent;
  const prevPos = root.position.clone(), prevRot = root.rotation.clone(), prevVis = root.visible;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfff4e8, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(0.8, 2.6, -2.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.7); fill.position.set(-1.5, 1.5, -1.0); scene.add(fill);
  scene.add(root);
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.visible = true;
  for (let i = 0; i < 3; i++) rig.update(0.05);
  root.updateMatrixWorld(true);
  const hh = (rig as any).headHeight ?? rig.look?.height ?? 1.7;
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.05, 10);
  const cy = hh - 0.2;
  cam.position.set(0, cy + 0.02, -1.55);
  cam.lookAt(0, cy, 0);
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevRT = R.getRenderTarget();
  const prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
  const buf = new Uint8Array(w * h * 4);
  let ok = true;
  try {
    R.setRenderTarget(rt);
    R.setClearColor(0x000000, 0);
    R.clear(true, true, true);
    R.render(scene, cam);
    R.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  } catch (e) { console.warn('[escape] mugshot', e); ok = false; }
  R.setRenderTarget(prevRT);
  R.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  scene.remove(root);
  if (prevParent) prevParent.add(root);
  root.position.copy(prevPos); root.rotation.copy(prevRot); root.visible = prevVis;
  if (!ok) return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  return cv;
}

let paperImg: HTMLImageElement | null = null;
let paperReq: Promise<HTMLImageElement | null> | null = null;
function paper(): Promise<HTMLImageElement | null> {
  if (!paperReq) paperReq = Assets.image('textures/pbr/paper_creased/albedo.jpg').then((i) => (paperImg = i)).catch(() => null);
  return paperReq;
}

/** One shared poster texture (repainted when the mugshot / name changes). */
export class PosterArt {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  readonly mat: THREE.MeshStandardMaterial;
  private reward = REWARDS[Math.floor(Math.random() * REWARDS.length)];

  constructor() {
    this.canvas.width = CW; this.canvas.height = CH;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const nrm = Assets.texture('textures/pbr/paper_creased/normal.jpg', { srgb: false, repeat: [1.2, 1.6] });
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, normalMap: nrm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    this.mat.name = 'escape-poster';
    this.paint(null, '');
    paper().then(() => this.paint(this.lastShot, this.lastName));
  }

  private lastShot: HTMLCanvasElement | null = null;
  private lastName = '';

  paint(shot: HTMLCanvasElement | null, name: string) {
    this.lastShot = shot; this.lastName = name;
    const c = this.canvas.getContext('2d')!;
    c.save();
    c.fillStyle = '#ece6d6';
    c.fillRect(0, 0, CW, CH);
    if (paperImg) { c.globalAlpha = 1; c.drawImage(paperImg, 0, 0, paperImg.width, paperImg.height * 0.72, 0, 0, CW, CH); }
    // slightly lighter print area
    c.globalAlpha = 0.38; c.fillStyle = '#fbf8ef'; c.fillRect(18, 18, CW - 36, CH - 36); c.globalAlpha = 1;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    // header
    c.fillStyle = '#b0141c';
    c.font = `800 128px ${F.heavy}`;
    c.fillText('หมายจับ', CW / 2, 132);
    c.fillStyle = '#1b1612';
    c.font = `700 30px ${F.ui}`;
    spaced(c, 'W A N T E D', CW / 2, 172);
    // photo frame
    const px = 106, py = 192, pw = 300, ph = 368;
    c.fillStyle = '#d9d4c8'; c.fillRect(px, py, pw, ph);
    if (shot) {
      c.filter = 'contrast(1.12) saturate(0.8) sepia(0.12)';
      c.drawImage(shot, px, py, pw, ph);
      c.filter = 'none';
    }
    c.lineWidth = 4; c.strokeStyle = '#1b1612'; c.strokeRect(px, py, pw, ph);
    // text block
    c.fillStyle = '#1b1612';
    c.font = `700 32px ${F.ui}`;
    c.fillText(name ? `ชื่อ: ${name.slice(0, 16)}` : 'ชื่อ: ไม่ทราบ', CW / 2, 604);
    c.font = `500 25px ${F.body}`;
    c.fillText('ข้อหา: หนีการจับกุมจากบ่อนเถื่อน', CW / 2, 640);
    c.fillStyle = '#b0141c';
    c.font = `800 44px ${F.heavy}`;
    c.fillText(`รางวัลนำจับ ${this.reward} บาท`, CW / 2, 688);
    c.fillStyle = '#3a332a';
    c.font = `400 17px ${F.body}`;
    c.fillText('พบเห็นแจ้ง สน.เจริญผัด โทร. 191', CW / 2, 712);
    // red "urgent" stamp
    c.save();
    c.translate(420, 250); c.rotate(-0.32);
    c.strokeStyle = 'rgba(176,20,28,0.78)'; c.lineWidth = 6;
    c.strokeRect(-62, -30, 124, 60);
    c.fillStyle = 'rgba(176,20,28,0.78)';
    c.font = `800 40px ${F.heavy}`;
    c.textAlign = 'center';
    c.fillText('ด่วน!', 0, 14);
    c.restore();
    // print sinks into the paper fibres
    if (paperImg) { c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.45; c.drawImage(paperImg, 0, paperImg.height * 0.2, paperImg.width, paperImg.height * 0.72, 0, 0, CW, CH); }
    c.restore();
    this.tex.needsUpdate = true;
  }
}

function spaced(c: CanvasRenderingContext2D, s: string, x: number, y: number) { c.fillText(s, x, y); }

// ------------------------------------------------------------------ pole + flapping poster

let poleMat: THREE.MeshStandardMaterial | null = null;
let flyerMat: THREE.MeshStandardMaterial | null = null;
let tapeMat: THREE.MeshStandardMaterial | null = null;

export class PosterPole {
  readonly group = new THREE.Group();
  readonly poster: THREE.Mesh;
  private geo: THREE.PlaneGeometry;
  private base: Float32Array;
  /** 0..1 flap strength */
  flap = 0.25;
  private seed = Math.random() * 100;

  constructor(art: PosterArt, o: { pole?: boolean; height?: number } = {}) {
    this.group.name = 'wanted-poster';
    const y0 = o.height ?? 1.55;
    if (o.pole !== false) {
      poleMat ??= Assets.pbr('concrete_old_cracked', { repeat: [1, 4] });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.135, 4.6, 12, 1), poleMat);
      pole.position.y = 2.3; pole.castShadow = true; pole.receiveShadow = true;
      this.group.add(pole);
      // loan flyers stuck under the poster (real photo decal from the world set)
      flyerMat ??= new THREE.MeshStandardMaterial({ map: Assets.texture('textures/world/decal_flyers_loan_cluster_photo.png', { wrap: false }), transparent: true, alphaTest: 0.25, roughness: 0.9, side: THREE.DoubleSide });
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), flyerMat);
      fl.position.set(0, 0.95, -0.137); fl.rotation.y = Math.PI;
      this.group.add(fl);
    }
    this.geo = new THREE.PlaneGeometry(PW, PH, 6, 9);
    this.base = (this.geo.getAttribute('position').array as Float32Array).slice();
    this.poster = new THREE.Mesh(this.geo, art.mat);
    this.poster.position.set(0, y0, o.pole !== false ? -0.142 : 0);
    this.poster.rotation.y = Math.PI;   // faces -Z of the group → group yaw = facing direction
    this.poster.castShadow = true; this.poster.receiveShadow = true;
    this.group.add(this.poster);
    // two strips of tape across the top corners
    tapeMat ??= new THREE.MeshStandardMaterial({ map: Assets.texture('textures/pbr/paper_creased/albedo.jpg', { repeat: [0.2, 0.05] }), color: 0xe9dfb8, transparent: true, opacity: 0.72, roughness: 0.35, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.035), tapeMat);
      tp.position.set(s * (PW / 2 - 0.02), PH / 2 - 0.02, 0.003);
      tp.rotation.z = s * 0.6;
      this.poster.add(tp);
    }
  }

  /** world position of the poster centre */
  centre(out = new THREE.Vector3()) { return this.poster.getWorldPosition(out); }

  update(t: number) {
    const k = this.flap;
    if (k <= 0.001) return;
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array, b = this.base;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.7 + this.seed) * Math.sin(t * 1.9 + this.seed * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1];
      const v = (y + PH / 2) / PH;             // 0 bottom … 1 top (taped)
      const free = Math.pow(1 - v, 1.35);
      const corner = Math.abs(x) / (PW / 2);
      const w = Math.sin(t * 5.2 + x * 7 + v * 3.2 + this.seed) * 0.035 + Math.sin(t * 9.3 + x * 15 + this.seed) * 0.012;
      a[i * 3 + 2] = b[i * 3 + 2] + free * k * gust * (w + 0.05 + corner * 0.05 * Math.sin(t * 7.1 + x * 4));
      a[i * 3 + 1] = y + free * k * gust * 0.02 * Math.sin(t * 6.3 + x * 5);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
