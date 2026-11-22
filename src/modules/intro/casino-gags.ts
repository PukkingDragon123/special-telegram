import * as THREE from 'three';
import { F } from '../../core/fonts';
import { weatherSign } from '../world/signfx';
import { Assets } from '../../core/assets';

/* ============================================================================================
 * Casino set gags (homage only — original names, no real people, no copied characters):
 *  - parody posters / lightboxes on the walls: a Thai prime-time "slap-kiss" drama, a "standing pose
 *    championship" fight night with dramatic silhouettes, a "NO DRAMATIC POSING" house rule, a
 *    WANTED notice for a tall guy in a long coat + cap who sighs all night, a cocktail menu of puns
 *  - a karaoke TV with an original parody song (bouncing-ball lyrics, redrawn a few times a second)
 *  - a long dark coat tail for the background "menacing" guy (attached to his hips by casino.ts)
 * All printed/matte (no glowing text).
 * ========================================================================================== */

type Draw = (x: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasMat(w: number, h: number, draw: Draw, rough = 0.75) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { mat: new THREE.MeshStandardMaterial({ map: t, roughness: rough, metalness: 0 }), cv, tex: t };
}

/** a framed print: canvas picture + thin dark frame, origin at the picture centre, facing +z */
let posterSeed = 11;
function framed(wm: number, hm: number, px: number, draw: Draw, frameCol = 0x1c1410) {
  const g = new THREE.Group();
  const seed = posterSeed++;
  const { mat } = canvasMat(px, Math.round((px * hm) / wm), (x, w, h) => { draw(x, w, h); weatherSign(x, w, h, { seed, surface: 'paper', wear: 0.35 }); });
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), mat);
  pic.position.z = 0.012;
  const fr = new THREE.Mesh(new THREE.BoxGeometry(wm + 0.06, hm + 0.06, 0.02), new THREE.MeshStandardMaterial({ color: frameCol, roughness: 0.5, metalness: 0.3 }));
  g.add(fr, pic);
  return g;
}

/** a framed print of a pre-rendered poster (public/assets/gen/posters, made by scripts/posters.mjs) */
function framedPoster(wm: number, hm: number, id: string, frameCol = 0x1c1410) {
  const g = new THREE.Group();
  const map = Assets.texture(`gen/posters/${id}.webp`, { srgb: true, wrap: false });
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0 }));
  pic.position.z = 0.012;
  const fr = new THREE.Mesh(new THREE.BoxGeometry(wm + 0.06, hm + 0.06, 0.02), new THREE.MeshStandardMaterial({ color: frameCol, roughness: 0.5, metalness: 0.3 }));
  g.add(fr, pic);
  return g;
}

const center = (x: CanvasRenderingContext2D, s: string, y: number, w: number, font: string, fill: string, stroke?: string, lw = 0) => {
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (stroke && lw) { x.lineWidth = lw; x.strokeStyle = stroke; x.lineJoin = 'round'; x.strokeText(s, w / 2, y); }
  x.fillStyle = fill; x.fillText(s, w / 2, y);
};

export interface GagSet { root: THREE.Group; update(t: number): void; dispose(): void }

const SONG = [
  ['♪ บ่อนนี้… ไม่มีรักแท้ ♪', 'This casino… has no true love'],
  ['♪ มีแต่ไพ่… ที่หักหลังฉัน ♪', 'only cards… that betray me'],
  ['♪ หมดตัวตอนตีสาม ร้องไห้ตอนตีห้า ♪', 'broke at 3 a.m., crying at 5'],
  ['♪ โอ้ยยย ใจสลาย (ใจสลาย) ♪', 'ohhh heartbreak (heartbreak)'],
];

export function buildCasinoGags(): GagSet {
  const root = new THREE.Group();
  root.name = 'casino-gags';
  const H = 5.2, Z1 = 10, X0 = -14;

  // ---- south wall (behind the players), facing the room (-z)
  const southWall = (o: THREE.Object3D, x: number, y: number) => { o.scale.setScalar(1.35); o.position.set(x, y, Z1 - 0.05); o.rotation.y = Math.PI; root.add(o); };

  // 1) prime-time slap-kiss drama poster + 2) "standing pose championship" fight night (studio renders of the cast)
  southWall(framedPoster(1.1, 1.1 * 904 / 640, 'casino_drama'), -9.5, 2.5);
  southWall(framedPoster(1.15, 1.15 * 904 / 640, 'casino_pose'), -5.4, 2.55);

  // 3) house rules lightbox (matte print, not glowing)
  southWall(framed(1.3, 0.62, 512, (x, w, h) => {
    x.fillStyle = '#f4ecd8'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#8a1a14'; x.fillRect(0, 0, w, 46);
    center(x, 'กฎของบ่อน · HOUSE RULES', 24, w, `800 28px ${F.ui}`, '#ffffff');
    const rules = ['1. ห้ามยืนท่าแปลกๆ ขวางโต๊ะ (no dramatic posing at the tables)', '2. ห้ามตะโกน "โอะระๆ" เกินวันละ 3 ครั้ง', '3. ห้ามตบกันในบ่อน ไปตบในละคร', '4. เสียแล้วห้ามร้องไห้ใส่ดีลเลอร์'];
    rules.forEach((r, i) => { x.font = `600 19px ${F.ui}`; x.textAlign = 'left'; x.fillStyle = '#2a1a10'; x.fillText(r, 24, 82 + i * 34); });
  }, 0x3a2a1a), 5.6, 2.35);

  // 4) WANTED notice: the tall guy in the long coat who sighs all night
  southWall(framedPoster(0.72, 0.72 * 904 / 640, 'casino_wanted', 0x4a3420), 8.2, 2.45);

  // 5) cocktail menu of puns on the west wall above the slot banks
  {
    const m = framed(1.5, 0.9, 512, (x, w, h) => {
      x.fillStyle = '#121a14'; x.fillRect(0, 0, w, h);
      center(x, 'ค็อกเทลประจำบ่อน', 40, w, `800 34px ${F.heavy}`, '#f2e2b0');
      const items = [['หมดตัว ออน เดอะ ร็อค', '199.-'], ['บลูส์หนี้บัตรเครดิต', '249.-'], ['มาร์การิต้า ตีสาม', '159.-'], ['เบียร์ยืนท่าเท่ (เสิร์ฟพร้อมเสียง ゴゴゴ)', '129.-']];
      items.forEach(([n, p], i) => {
        x.font = `600 22px ${F.ui}`; x.fillStyle = '#f2ead8'; x.textAlign = 'left'; x.fillText(n, 30, 100 + i * 52);
        x.textAlign = 'right'; x.fillStyle = '#e8c070'; x.fillText(p, w - 30, 100 + i * 52);
      });
    }, 0x3a2a16);
    m.position.set(X0 + 0.04, 3.55, -2.4);
    m.rotation.y = Math.PI / 2;
    root.add(m);
  }

  // ---- karaoke TV on a stand by the south wall (screen redrawn ~4×/s, bouncing ball)
  const tvW = 1.4, tvH = 0.8;
  const tv = canvasMat(512, 292, () => {}, 0.35);
  const tvG = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(tvW + 0.08, tvH + 0.08, 0.07), new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.4, metalness: 0.4 }));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), tv.mat);
  scr.position.z = 0.037;
  (tv.mat as THREE.MeshStandardMaterial).emissive.set(0xffffff);
  (tv.mat as THREE.MeshStandardMaterial).emissiveMap = tv.tex;
  (tv.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.55;   // a lit screen, not glowing text
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 10), body.material);
  pole.position.y = -0.75 - tvH / 2;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.04, 20), body.material);
  foot.position.y = -1.5 - tvH / 2;
  tvG.add(body, scr, pole, foot);
  tvG.position.set(10.6, 1.5 + tvH / 2, Z1 - 0.7);
  tvG.rotation.y = Math.PI + 0.35;
  root.add(tvG);
  let lastDraw = -1;
  const drawTv = (t: number) => {
    const x = tv.cv.getContext('2d')!, w = tv.cv.width, h = tv.cv.height;
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2a3a6a'); g.addColorStop(1, '#6a2a5a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // slow-mo "music video" bokeh
    for (let i = 0; i < 14; i++) { const px = (i * 97 + t * 18) % w, py = (i * 53) % (h * 0.6); x.fillStyle = `rgba(255,${180 + (i % 3) * 20},200,0.18)`; x.beginPath(); x.arc(px, py, 14 + (i % 4) * 6, 0, Math.PI * 2); x.fill(); }
    center(x, 'เพลง: บ่อนนี้ไม่มีรัก (เวอร์ชันเมาค้าง)', 24, w, `700 18px ${F.ui}`, '#ffffff');
    const li = Math.floor(t / 4) % SONG.length, frac = (t % 4) / 4;
    const [th, en] = SONG[li];
    x.font = `800 30px ${F.heavy}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = x.measureText(th).width, sx = w / 2 - tw / 2;
    x.lineWidth = 6; x.strokeStyle = '#000'; x.strokeText(th, w / 2, h * 0.68);
    x.fillStyle = '#ffffff'; x.fillText(th, w / 2, h * 0.68);
    // sung part in yellow (clip)
    x.save(); x.beginPath(); x.rect(sx, 0, tw * frac, h); x.clip(); x.fillStyle = '#ffd84a'; x.fillText(th, w / 2, h * 0.68); x.restore();
    x.beginPath(); x.arc(sx + tw * frac, h * 0.56 - Math.abs(Math.sin(t * 6)) * 14, 7, 0, Math.PI * 2); x.fillStyle = '#ff4a6a'; x.fill();
    center(x, en, h * 0.84, w, `600 16px ${F.ui}`, '#e8e0ff');
    tv.tex.needsUpdate = true;
  };
  drawTv(0);
  // a mic stand in front of it
  {
    const ms = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.35, metalness: 0.8 });
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), m); p.position.y = 0.72;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), m); b.position.y = 0.015;
    const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.12, 4, 10), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5, metalness: 0.5 }));
    mic.position.set(0, 1.48, 0.05); mic.rotation.x = 1.0;
    ms.add(p, b, mic);
    ms.position.set(10.0, 0, Z1 - 1.6);
    root.add(ms);
  }

  return {
    root,
    update(t: number) { if (t - lastDraw > 0.25 || t < lastDraw) { lastDraw = t; drawTv(t); } },
    dispose() { root.traverse((o: any) => { if (o.isMesh) { o.geometry?.dispose?.(); const mm = o.material; if (mm?.map) mm.map.dispose(); mm?.dispose?.(); } }); },
  };
}

/** Long dark coat skirt for the background "menacing" guy: open at the front, flared, attached at the hips. */
export function coatTail(color = 0x1b1d26): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.2, 0.33, 0.78, 22, 3, true, Math.PI * 0.22, Math.PI * 1.56);
  geo.translate(0, -0.39, 0);
  // slight flare + a soft fold ripple
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const a = Math.atan2(z, x), k = -y / 0.78;
    const r = 1 + Math.sin(a * 7) * 0.035 * k;
    p.setXYZ(i, x * r, y, z * r);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.78, side: THREE.DoubleSide }));
  m.castShadow = true;
  return m;
}
