import * as THREE from 'three';
import { F } from '../../core/fonts';
import { weatherSign } from '../world/signfx';

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

const center = (x: CanvasRenderingContext2D, s: string, y: number, w: number, font: string, fill: string, stroke?: string, lw = 0) => {
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (stroke && lw) { x.lineWidth = lw; x.strokeStyle = stroke; x.lineJoin = 'round'; x.strokeText(s, w / 2, y); }
  x.fillStyle = fill; x.fillText(s, w / 2, y);
};

/** dramatic standing-pose silhouette (original stick-figure-ish shapes) */
function poseSilhouette(x: CanvasRenderingContext2D, cx: number, base: number, s: number, kind: number, col: string) {
  x.save();
  x.translate(cx, base); x.scale(s, s);
  x.fillStyle = col; x.strokeStyle = col; x.lineCap = 'round'; x.lineJoin = 'round';
  const limb = (pts: number[][], wdt: number) => { x.lineWidth = wdt; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) x.lineTo(p[0], p[1]); x.stroke(); };
  // long coat body
  x.beginPath();
  if (kind === 0) { x.moveTo(-18, -150); x.lineTo(18, -150); x.lineTo(34, -40); x.lineTo(-30, -40); }
  else { x.moveTo(-16, -150); x.lineTo(20, -148); x.lineTo(40, -38); x.lineTo(-38, -46); }
  x.closePath(); x.fill();
  // head + cap
  x.beginPath(); x.arc(0, -168, 15, 0, Math.PI * 2); x.fill();
  x.fillRect(-20, -186, 40, 9); x.fillRect(-6, -182, 30, 5);
  if (kind === 0) {
    limb([[-16, -140], [-40, -110], [-14, -160]], 10);   // hand framing the face
    limb([[16, -140], [52, -150], [70, -168]], 10);      // pointing up and out
    limb([[-12, -40], [-26, 0]], 12); limb([[12, -40], [30, 0]], 12);
  } else {
    limb([[-16, -140], [-48, -128], [-60, -96]], 10);
    limb([[18, -140], [10, -175]], 10);                  // hand on the cap brim
    limb([[-14, -44], [-6, 0]], 12); limb([[16, -42], [44, -4]], 12);
  }
  x.restore();
}

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
  const southWall = (o: THREE.Object3D, x: number, y: number) => { o.position.set(x, y, Z1 - 0.04); o.rotation.y = Math.PI; root.add(o); };

  // 1) prime-time slap-kiss drama poster
  southWall(framed(1.1, 1.55, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a0a18'); g.addColorStop(1, '#14040a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // two faces in profile, one slapping (abstract shapes)
    x.fillStyle = '#e8b49a'; x.beginPath(); x.ellipse(w * 0.32, h * 0.42, 70, 92, -0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#d9a088'; x.beginPath(); x.ellipse(w * 0.7, h * 0.4, 66, 88, 0.35, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8b49a'; x.beginPath(); x.ellipse(w * 0.5, h * 0.33, 34, 18, -0.6, 0, Math.PI * 2); x.fill();   // the hand
    x.strokeStyle = '#fff4c8'; x.lineWidth = 5; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(w * 0.55 + i * 6, h * 0.24 + i * 9); x.lineTo(w * 0.62 + i * 8, h * 0.2 + i * 9); x.stroke(); }
    center(x, 'เพี๊ยะ!!', h * 0.16, w, `900 64px ${F.heavy}`, '#ffe14a', '#3a0000', 10);
    center(x, 'ตบให้สุด หยุดที่รัก', h * 0.7, w, `900 56px ${F.heavy}`, '#ffffff', '#3a0010', 10);
    center(x, 'ละครหลังข่าว · ตอนจบ (อีกแล้ว) EP.99', h * 0.79, w, `700 26px ${F.ui}`, '#ffd0d8');
    center(x, 'จันทร์–อังคาร 20.30 น. · ตบจริง เจ็บจริง ร้องไห้จริง', h * 0.86, w, `600 22px ${F.ui}`, '#ffffff');
    center(x, '"SLAP ME TILL I LOVE YOU" — prime-time drama', h * 0.93, w, `600 20px ${F.ui}`, '#ff9fb2');
  }), -9.5, 2.5);

  // 2) "standing pose championship" fight-night poster
  southWall(framed(1.2, 1.6, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2a1a4a'); g.addColorStop(1, '#0e0a1a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // speed rays
    x.strokeStyle = 'rgba(255,220,120,0.18)'; x.lineWidth = 3;
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; x.beginPath(); x.moveTo(w / 2, h * 0.45); x.lineTo(w / 2 + Math.cos(a) * 700, h * 0.45 + Math.sin(a) * 700); x.stroke(); }
    poseSilhouette(x, w * 0.3, h * 0.66, 1.25, 0, '#0a0610');
    poseSilhouette(x, w * 0.72, h * 0.66, 1.2, 1, '#0a0610');
    center(x, 'ศึกยืนท่าเท่', h * 0.1, w, `900 66px ${F.heavy}`, '#ffd34a', '#2a0a00', 10);
    center(x, 'STANDING POSE CHAMPIONSHIP', h * 0.18, w, `800 26px ${F.ui}`, '#ffffff');
    center(x, 'ไม่ต้องต่อย แค่ยืนให้น่ากลัวที่สุด', h * 0.76, w, `800 30px ${F.ui}`, '#ffffff', '#000', 6);
    center(x, 'ゴゴゴゴ  ·  คืนวันเสาร์ ห้องวีไอพี', h * 0.84, w, `700 26px ${F.ui}`, '#ffb4f0');
    center(x, 'NO PUNCHES. JUST MENACE.', h * 0.92, w, `800 24px ${F.ui}`, '#ffd34a');
  }), -5.4, 2.55);

  // 3) house rules lightbox (matte print, not glowing)
  southWall(framed(1.3, 0.62, 512, (x, w, h) => {
    x.fillStyle = '#f4ecd8'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#8a1a14'; x.fillRect(0, 0, w, 46);
    center(x, 'กฎของบ่อน · HOUSE RULES', 24, w, `800 28px ${F.ui}`, '#ffffff');
    const rules = ['1. ห้ามยืนท่าแปลกๆ ขวางโต๊ะ (no dramatic posing at the tables)', '2. ห้ามตะโกน "โอะระๆ" เกินวันละ 3 ครั้ง', '3. ห้ามตบกันในบ่อน ไปตบในละคร', '4. เสียแล้วห้ามร้องไห้ใส่ดีลเลอร์'];
    rules.forEach((r, i) => { x.font = `600 19px ${F.ui}`; x.textAlign = 'left'; x.fillStyle = '#2a1a10'; x.fillText(r, 24, 82 + i * 34); });
  }, 0x3a2a1a), 5.6, 2.35);

  // 4) WANTED notice: the tall guy in the long coat who sighs all night
  southWall(framed(0.72, 0.98, 384, (x, w, h) => {
    x.fillStyle = '#e6d6b0'; x.fillRect(0, 0, w, h);
    center(x, 'ตามหา!', 48, w, `900 64px ${F.heavy}`, '#5a1a0a');
    x.fillStyle = '#cbb890'; x.fillRect(60, 90, w - 120, 240);
    poseSilhouette(x, w / 2, 320, 1.0, 1, '#2a2018');
    center(x, 'ชายหมวกดำ เสื้อโค้ทยาว', 362, w, `800 26px ${F.ui}`, '#3a2010');
    center(x, 'ถอนหายใจ "เฮ้อ… ยาเระๆ" ทุก 5 นาที', 398, w, `600 20px ${F.ui}`, '#3a2010');
    center(x, 'ค่าหัว: ข้าวมันไก่ 1 จาน', 440, w, `800 22px ${F.ui}`, '#8a1a10');
    center(x, 'WANTED: tall man, long coat, sighs a lot', 478, w, `600 16px ${F.ui}`, '#5a4020');
  }, 0x4a3420), 8.2, 2.45);

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
