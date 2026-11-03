import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl } from '../../core/util';
import { lifeTex } from './tex';
import { Assets } from '../../core/assets';
import { F } from '../../core/fonts';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { libModel } from '../world/lib';
import { eggGeoLying, eggShellMat } from '../cooking/realfood';

/* ============================================================================================
 * life item kinds: dog_food (real product bag photo), garland (พวงมาลัย, real photo),
 * flashlight (ไฟฉาย — shines at ghosts; a real spot light at night), amulet (เหรียญพระ —
 * ghosts keep their distance). Shops may stock them; the homeless man gifts some.
 * Ritual (src/modules/ritual): incense (ธูป 3 ดอก), red_soda (น้ำแดงใส่หลอด), boiled_eggs (ไข่ต้ม),
 * zebra_figurine (ม้าลาย), ghost_manual (ตำราเรียกผี ฉบับพกพา), lotto_ticket (สลากเลขผี),
 * ghost_review_frame (กรอบรีวิวจากผี).
 * ========================================================================================== */

const mats = new Map<string, THREE.Material>();
function photoMat(file: string, fallback: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const k = file + JSON.stringify(o);
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: lifeTex(file, { fallback, kind: 'plastic', clamp: true }), roughness: 0.6, ...o }); mats.set(k, m); }
  return m;
}
const plain = (c: string, r = 0.6, metal = 0) => {
  const k = c + r + metal;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: metal }); mats.set(k, m); }
  return m;
};

/** pillow-like bag: box with bulged faces */
function bagGeo(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 8, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), z = p.getZ(i);
    const bulge = (1 - x * x) * (1 - y * y * 0.8);
    p.setZ(i, z * (0.55 + bulge * 0.65));
    p.setX(i, p.getX(i) * (1 - Math.max(0, y) * 0.06));
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

export function defineLifeItems(game: Game) {
  const I = game.items;
  if (!I.def('dog_food')) I.define({
    kind: 'dog_food', name: tl('อาหารหมา', 'dog food'), weight: 1.2, carry: 'hand', tags: ['food', 'pet'], price: 59,
    build: () => {
      const g = new THREE.Group();
      const geo = bagGeo(0.22, 0.32, 0.08);
      // front/back faces (groups 4/5 of a BoxGeometry) get the product photo, the rest a plain matching colour
      const front = photoMat('dogfood_bag.jpg', '#c8302a');
      const side = plain('#b0282a', 0.55);
      const m = new THREE.Mesh(geo, [side, side, side, side, front, front]);
      g.add(m);
      return g;
    },
    hold: { pos: [0.02, -0.06, 0], rot: [0, -0.35, 0], scale: 0.9 },
  });

  if (!I.def('garland')) I.define({
    kind: 'garland', name: tl('พวงมาลัย', 'jasmine garland'), weight: 0.08, carry: 'hand', tags: ['offering'], price: 20,
    build: () => {
      const g = new THREE.Group();
      // loop of jasmine buds (photo texture) + rose head + ribbon tassel
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 18), photoMat('garland_jasmine.jpg', '#f2efe4', { roughness: 0.8 }));
      loop.rotation.x = Math.PI / 2;
      loop.position.y = 0.02;
      g.add(loop);
      const rose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022, 1), photoMat('garland_rose.jpg', '#c02a3a', { roughness: 0.7 }));
      rose.position.set(0, 0.03, 0.08);
      g.add(rose);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.003), plain('#2e8b3a', 0.5));
      rib.position.set(0, 0.0, 0.1);
      rib.rotation.x = 0.4;
      g.add(rib);
      return g;
    },
    hold: { pos: [0, 0, 0], rot: [0.6, 0, 0], scale: 1.2 },
  });

  if (!I.def('flashlight')) I.define({
    kind: 'flashlight', name: tl('ไฟฉาย', 'flashlight'), weight: 0.3, carry: 'hand', tags: ['light', 'tool'], price: 89,
    build: () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.17, 10), Assets.pbr('aluminium_scratched', { fallback: 0x1d1d1f, color: '#3a3a40' }));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.022;
      g.add(body);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.05, 12), plain('#2a2a2c', 0.35, 0.6));
      head.rotation.z = -Math.PI / 2;
      head.position.set(0.105, 0.03, 0);
      g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 12), new THREE.MeshStandardMaterial({ color: '#fff8e0', emissive: '#fff4d0', emissiveIntensity: 0 }));
      lens.rotation.y = Math.PI / 2;
      lens.position.set(0.131, 0.03, 0);
      lens.name = 'lens';
      g.add(lens);
      // the real thing: Poly Haven's small plastic torch (CC0, gen/escape/models). The procedural body stays
      // as the fallback until it loads (and if it fails)
      torchModel().then((m) => {
        if (!m) return;
        const t = m.clone(true);
        t.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.add(t);
        body.visible = false; head.visible = false;
        lens.position.set(TORCH.len / 2 + 0.002, 0.03, 0);
        (lens.geometry as THREE.CircleGeometry).dispose();
        lens.geometry = new THREE.CircleGeometry(TORCH.lensR, 16);
      });
      return g;
    },
    animate: (obj: THREE.Object3D, e: Ent, _dt: number, game: Game) => {
      // a real light when carried at night (local only, no shadows)
      const on = e.holder != null && game.clock.nightFactor > 0.25;
      let L = obj.userData.light as THREE.SpotLight | undefined;
      if (on && !L) {
        L = new THREE.SpotLight(0xfff1d0, 30, 22, 0.42, 0.55, 1.6);
        L.position.set(0.13, 0.03, 0);
        L.target.position.set(1.5, 0.0, 0);
        obj.add(L, L.target);
        obj.userData.light = L;
      }
      if (L) L.visible = on;
      const lens = obj.getObjectByName('lens') as THREE.Mesh | undefined;
      if (lens) (lens.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0;
    },
    hold: { pos: [0.02, -0.02, 0], rot: [0, Math.PI / 2, 0], scale: 1.1 },
  });

  if (!I.def('amulet')) I.define({
    kind: 'amulet', name: tl('เหรียญพระ (ของขวัญจากลุง)', 'amulet (gift)'), weight: 0.02, carry: 'hand', tags: ['charm'], price: 0,
    build: () => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 14), [plain('#b8932e', 0.3, 0.9), photoMat('amulet_face.jpg', '#b8932e', { roughness: 0.35, metalness: 0.7 }), plain('#a8832a', 0.3, 0.9)]);
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 0.02;
      g.add(disc);
      const cord = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0015, 4, 16), plain('#c8102e', 0.7));
      cord.position.y = 0.05;
      g.add(cord);
      return g;
    },
    hold: { pos: [0, 0.02, 0], rot: [0, 0, 0], scale: 2.2 },
  });
}

// ------------------------------------------------------------------ ritual items (src/modules/ritual)

/** canvas texture helper (cached per key) */
const cvTex = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  let t = cvTex.get(key);
  if (t) return t;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx, w, h);
  t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  cvTex.set(key, t);
  // fonts may still be loading: redraw once they are
  (document as any).fonts?.ready?.then(() => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h); t!.needsUpdate = true; });
  return t;
}
/** aged paper ground with fibres and stains */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, base = '#efe2c0') {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(110,80,40,${0.03 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1); }
  for (let i = 0; i < 5; i++) { const g = ctx.createRadialGradient(r() * w, r() * h, 2, r() * w, r() * h, 20 + r() * 60); g.addColorStop(0, 'rgba(150,105,40,0.18)'); g.addColorStop(1, 'rgba(150,105,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
}

/** stripes along a lathe: alternating white / black slices of a radius profile, axis = local y */
function stripedLathe(prof: number[], len: number, segs = 12, first = 0) {
  const g = new THREE.Group();
  const white = plain('#f1ede3', 0.38), black = plain('#1d1b19', 0.4);
  const step = len / (prof.length - 1);
  for (let k = 0; k < prof.length - 1; k++) {
    const pts = [new THREE.Vector2(Math.max(1e-4, prof[k]), 0), new THREE.Vector2(Math.max(1e-4, prof[k + 1]), step)];
    if (k === 0) pts.unshift(new THREE.Vector2(1e-4, 0));
    if (k === prof.length - 2) pts.push(new THREE.Vector2(1e-4, step));
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, segs), (k + first) % 2 ? black : white);
    m.position.y = k * step;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** a painted plaster ม้าลาย (zebra) offering figurine, ~h metres tall, facing +z, origin at the hooves */
export function zebraFigurine(h = 0.26): THREE.Group {
  const s = h / 0.62;
  const z = new THREE.Group();
  const body = stripedLathe([0.03, 0.072, 0.09, 0.095, 0.093, 0.08, 0.036], 0.36, 14);
  body.rotation.x = Math.PI / 2; body.position.set(0, 0.36, -0.18);
  z.add(body);
  for (const lz of [-0.13, 0.13]) for (const lx of [-0.045, 0.045]) {
    const leg = stripedLathe([0.019, 0.017, 0.02, 0.021, 0.024, 0.03], 0.3, 8, 1);
    leg.position.set(lx, 0, lz);
    z.add(leg);
  }
  const neck = stripedLathe([0.046, 0.043, 0.04, 0.036], 0.18, 10);
  neck.position.set(0, 0.4, 0.15); neck.rotation.x = 0.42;
  z.add(neck);
  const head = stripedLathe([0.04, 0.036, 0.032, 0.026], 0.12, 10);
  head.position.set(0, 0.56, 0.2); head.rotation.x = Math.PI / 2 + 0.35;
  z.add(head);
  const mane = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.2, 0.05, 2, 0.006), plain('#1d1b19', 0.5));
  mane.position.set(0, 0.52, 0.15); mane.rotation.x = 0.42;
  z.add(mane);
  for (const ex of [-0.02, 0.02]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 6), plain('#f1ede3', 0.4));
    ear.position.set(ex, 0.62, 0.2);
    z.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.4, -0.18), new THREE.Vector3(0, 0.33, -0.23), new THREE.Vector3(0, 0.22, -0.24)]), 8, 0.007, 5), plain('#1d1b19', 0.5));
  z.add(tail);
  // a red ribbon (offering bow) round the neck
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.008, 6, 18), plain('#c8102e', 0.55));
  bow.position.set(0, 0.47, 0.17); bow.rotation.x = Math.PI / 2 - 0.42;
  z.add(bow);
  z.scale.setScalar(s);
  z.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return z;
}

/** 3 incense sticks (red bamboo stems, brown agarwood coating), lit tips glow */
function incenseBundle(lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const stem = plain('#b8221c', 0.6), coat = plain('#5a3a22', 0.95);
  const tipM = new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: lit ? '#ff5a12' : '#000000', emissiveIntensity: lit ? 2.4 : 0, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Group();
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.1, 5), stem); a.position.y = 0.05;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.003, 0.2, 6), coat); b.position.y = 0.2;
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 6, 4), tipM); t.position.y = 0.3; t.name = 'tip';
    s.add(a, b, t);
    s.position.set((i - 1) * 0.008, 0, (i % 2) * 0.004);
    s.rotation.z = (i - 1) * 0.06;
    g.add(s);
  }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 10, 1, true), plain('#d8b23a', 0.5, 0.3));
  band.position.y = 0.085; (band.material as THREE.Material).side = THREE.DoubleSide;
  g.add(band);
  return g;
}

function bendyStraw(): THREE.Mesh {
  const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.17, 0), new THREE.Vector3(0.006, 0.2, 0), new THREE.Vector3(0.035, 0.215, 0)]);
  const tex = canvasTex('straw', 64, 256, (ctx, w, h) => { ctx.fillStyle = '#f6f3ee'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#d42a2a'; for (let y = 0; y < h; y += 32) { ctx.save(); ctx.translate(0, y); ctx.transform(1, 0.4, 0, 1, 0, 0); ctx.fillRect(0, 0, w, 12); ctx.restore(); } });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 4);
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.0032, 8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  return m;
}

function manualCover() {
  return canvasTex('ghost_manual_cover', 384, 560, (ctx, w, h) => {
    paper(ctx, w, h, '#d8c08a');
    ctx.fillStyle = '#7a1414'; ctx.fillRect(18, 18, w - 36, h - 36);
    ctx.strokeStyle = '#e8c45a'; ctx.lineWidth = 6; ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.fillStyle = '#f2d77a'; ctx.textAlign = 'center';
    ctx.font = `700 64px ${F.fancy}`; ctx.fillText('ตำรา', w / 2, 140);
    ctx.font = `700 74px ${F.fancy}`; ctx.fillText('เรียกผี', w / 2, 230);
    ctx.font = `600 34px ${F.hand}`; ctx.fillText('ฉบับพกพา', w / 2, 290);
    // a goofy hand-drawn ghost
    ctx.strokeStyle = '#f6efe0'; ctx.fillStyle = 'rgba(246,239,224,0.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(w / 2 - 50, 470); ctx.quadraticCurveTo(w / 2 - 60, 330, w / 2, 330); ctx.quadraticCurveTo(w / 2 + 60, 330, w / 2 + 50, 470);
    for (let i = 0; i < 5; i++) ctx.quadraticCurveTo(w / 2 + 50 - i * 20 - 10, 450, w / 2 + 50 - (i + 1) * 20, 470);
    ctx.fill();
    ctx.fillStyle = '#1a1010'; ctx.beginPath(); ctx.arc(w / 2 - 18, 385, 7, 0, 6.28); ctx.arc(w / 2 + 18, 385, 7, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w / 2, 415, 9, 12, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#f2d77a'; ctx.font = `500 22px ${F.ui}`; ctx.fillText('ราคา 99.- พิมพ์ครั้งที่ 47', w / 2, h - 50);
  });
}

function lottoTex(num: string) {
  return canvasTex('lotto:' + num, 512, 256, (ctx, w, h) => {
    paper(ctx, w, h, '#f4ecd2');
    const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(60,140,90,0.25)'); g.addColorStop(1, 'rgba(200,120,60,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(40,90,60,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 40 + i * 6, 20 + i * 3, 0, 0, 6.28); ctx.stroke(); }
    ctx.fillStyle = '#2a4a2a'; ctx.textAlign = 'left'; ctx.font = `700 30px ${F.heavy}`; ctx.fillText('สลากกินแบ่งซอยเฮียผัด', 24, 44);
    ctx.font = `500 18px ${F.ui}`; ctx.fillText('งวดพิเศษ เลขผีบอก · ไม่มีการรับประกัน', 24, 70);
    ctx.fillStyle = '#b8141e'; ctx.textAlign = 'right'; ctx.font = `800 96px ${F.heavy}`; ctx.fillText(num, w - 30, 190);
    ctx.fillStyle = '#2a4a2a'; ctx.textAlign = 'left'; ctx.font = `600 22px ${F.ui}`; ctx.fillText('80 บาท', 24, 230);
  });
}

function reviewFrameTex() {
  return canvasTex('ghost_review_frame', 512, 640, (ctx, w, h) => {
    paper(ctx, w, h, '#f6f0e2');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4a3a5a'; ctx.font = `700 46px ${F.fancy}`; ctx.fillText('ใบรับรองจากโลกหลังความตาย', w / 2, 76);
    ctx.font = `600 30px ${F.ui}`; ctx.fillText('ผีนางรีวิว ขอมอบให้ ร้านเฮียผัด', w / 2, 128);
    // five gold stars
    const star = (cx: number, cy: number, r: number) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); };
    ctx.fillStyle = '#e8b62a'; ctx.strokeStyle = '#7a5410'; ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) star(w / 2 + (i - 2) * 84, 230, 34);
    ctx.fillStyle = '#2a2230'; ctx.font = `700 40px ${F.hand}`; ctx.fillText('"กะเพราแซ่บถึงวิญญาณ"', w / 2, 340);
    ctx.font = `500 26px ${F.hand}`; ctx.fillText('อร่อยจนอยากกลับมาเกิด… แต่ไม่ได้', w / 2, 390);
    ctx.fillText('ไข่ดาวกรอบ เผ็ดกำลังดี ผีแนะนำ', w / 2, 430);
    ctx.font = `600 22px ${F.ui}`; ctx.fillStyle = '#6a5a7a'; ctx.fillText('ลงชื่อ ……ผีนางรีวิว…… (ไม่มีลายเซ็น เพราะมือทะลุปากกา)', w / 2, 540);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#5a7a9a'; ctx.beginPath(); ctx.ellipse(w * 0.78, h * 0.86, 70, 40, -0.3, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1;
  });
}

export function defineRitualItems(game: Game) {
  const I = game.items;
  if (!I.def('incense')) I.define({
    kind: 'incense', name: tl('ธูป 3 ดอก', 'incense ×3'), weight: 0.02, carry: 'hand', tags: ['offering', 'ritual'], price: 10, pickRadius: 0.25,
    data: () => ({ lit: false }),
    build: (e) => incenseBundle(!!e.data?.lit),
    refresh: (obj, e) => { obj.traverse((o: any) => { if (o.name === 'tip') { o.material.emissive.set(e.data?.lit ? '#ff5a12' : '#000000'); o.material.emissiveIntensity = e.data?.lit ? 2.4 : 0; } }); },
    label: (e) => e.data?.lit ? tl('ธูป 3 ดอก (จุดแล้ว)', 'incense ×3 (lit)') : tl('ธูป 3 ดอก', 'incense ×3'),
    hold: { pos: [0, -0.05, 0], rot: [0.2, 0, 0.15], scale: 1.1 },
  });

  if (!I.def('red_soda')) I.define({
    kind: 'red_soda', name: tl('น้ำแดงใส่หลอด (ของไหว้)', 'red soda offering'), weight: 0.35, carry: 'hand', tags: ['offering', 'ritual', 'drink'], price: 15,
    build: () => {
      const g = new THREE.Group();
      const b = libModel('bottle_fanta_red');
      b.scale.setScalar(0.62);
      g.add(b);
      const st = bendyStraw(); st.position.set(0.004, 0.155, 0); g.add(st);
      return g;
    },
    hold: { pos: [0, -0.06, 0], rot: [0, 0.4, 0], scale: 1 },
  });

  if (!I.def('boiled_eggs')) I.define({
    kind: 'boiled_eggs', name: tl('ไข่ต้มแก้บน 5 ฟอง', 'boiled eggs offering'), weight: 0.4, carry: 'hand', tags: ['offering', 'ritual'], price: 25,
    build: () => {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.06, 0), new THREE.Vector2(0.075, 0.008), new THREE.Vector2(0.095, 0.02), new THREE.Vector2(0.1, 0.022), new THREE.Vector2(0.094, 0.018), new THREE.Vector2(0.07, 0.008), new THREE.Vector2(0.0001, 0.007)], 28), new THREE.MeshStandardMaterial({ color: '#f6f4ee', roughness: 0.18 }));
      plate.castShadow = true; plate.receiveShadow = true;
      g.add(plate);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.097, 0.0016, 4, 40), plain('#2a5ab8', 0.3));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.0215; g.add(rim);
      const pos = [[0, 0.03], [0.034, 0.0], [-0.034, 0.0], [0.018, -0.03], [-0.018, -0.03]];
      pos.forEach(([x, zz], i) => { const e = new THREE.Mesh(eggGeoLying(), eggShellMat(i)); e.position.set(x, 0.009, zz); e.rotation.y = i * 1.3; e.castShadow = true; g.add(e); });
      const top = new THREE.Mesh(eggGeoLying(), eggShellMat(4)); top.position.set(0, 0.034, 0.002); top.rotation.set(0.15, 0.7, 0); g.add(top);
      return g;
    },
    hold: { pos: [0, -0.04, 0], rot: [0, 0, 0], scale: 0.95 },
  });

  if (!I.def('zebra_figurine')) I.define({
    kind: 'zebra_figurine', name: tl('ม้าลายแก้บน', 'zebra figurine'), weight: 0.5, carry: 'hand', tags: ['offering', 'ritual'], price: 59,
    build: () => zebraFigurine(0.26),
    hold: { pos: [0, -0.08, 0], rot: [0, 0.6, 0], scale: 0.8 },
  });

  if (!I.def('ghost_manual')) I.define({
    kind: 'ghost_manual', name: tl('ตำราเรียกผี ฉบับพกพา', 'pocket ghost-summoning manual'), weight: 0.15, carry: 'hand', tags: ['book', 'ritual'], price: 99,
    build: () => {
      const g = new THREE.Group();
      const cover = new THREE.MeshStandardMaterial({ map: manualCover(), roughness: 0.75 });
      const pages = new THREE.MeshStandardMaterial({ color: '#e8dcbc', roughness: 0.9 });
      const back = new THREE.MeshStandardMaterial({ color: '#6a1212', roughness: 0.8 });
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.014, 0.16, 2, 0.003), [pages, pages, cover, back, pages, pages]);
      b.position.y = 0.007; b.castShadow = true;
      g.add(b);
      return g;
    },
    hold: { pos: [0, -0.02, 0], rot: [1.2, 0, 0], scale: 1.4 },
  });

  if (!I.def('lotto_ticket')) I.define({
    kind: 'lotto_ticket', name: tl('สลากเลขผี', 'ghost-number lottery ticket'), weight: 0.01, carry: 'hand', tags: ['paper', 'ritual'], price: 80, pickRadius: 0.2,
    data: () => ({ num: '00' }),
    build: (e) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.0012, 0.08, 1, 0.0005), [plain('#efe6cc', 0.9), plain('#efe6cc', 0.9), new THREE.MeshStandardMaterial({ map: lottoTex(String(e.data?.num ?? '00')), roughness: 0.85 }), plain('#e8dcc0', 0.9), plain('#efe6cc', 0.9), plain('#efe6cc', 0.9)]);
      m.position.y = 0.001; g.add(m);
      return g;
    },
    label: (e) => tl(`สลากเลขผี เลข ${e.data?.num ?? '??'}`, `ghost lottery ticket ${e.data?.num ?? ''}`),
    hold: { pos: [0, 0, 0], rot: [1.3, 0, 0], scale: 1.6 },
  });

  if (!I.def('ghost_review_frame')) I.define({
    kind: 'ghost_review_frame', name: tl('กรอบรีวิว 5 ดาวจากผี', "ghost's 5-star review (framed)"), weight: 0.8, carry: 'hand', tags: ['decor', 'ritual'], price: 0, fixed: true,
    build: () => {
      const g = new THREE.Group();
      const wood = Assets.pbr('wood_painted_weathered', { fallback: 0x3a2418, color: '#4a2a18' });
      const frame = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.42, 0.03, 2, 0.008), wood);
      frame.position.set(0, 0.21 + 0.02, 0); frame.rotation.x = -0.12; frame.castShadow = true;
      g.add(frame);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.35), new THREE.MeshStandardMaterial({ map: reviewFrameTex(), roughness: 0.4, emissive: '#cfd8ff', emissiveIntensity: 0.06 }));
      pic.position.set(0, 0, 0.0165); frame.add(pic);
      const stand = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.3, 0.012, 1, 0.003), wood);
      stand.position.set(0, 0.15, -0.09); stand.rotation.x = 0.45; g.add(stand);
      return g;
    },
    hold: { pos: [0, -0.1, 0], rot: [0, 0, 0], scale: 0.7 },
  });
}

/**
 * The library torch, normalised once: longest axis → +X, the wider end (the lamp head) facing +X, centred on
 * the old procedural body (x 0, y 0.03), real size kept. Resolves null if the model can't load.
 */
const TORCH = { len: 0.2, lensR: 0.024 };
let torchP: Promise<THREE.Object3D | null> | null = null;
function torchModel(): Promise<THREE.Object3D | null> {
  if (torchP) return torchP;
  torchP = Assets.glb('gen/escape/models/small_plastic_torch/small_plastic_torch.glb').then((gl: any) => {
    const src: THREE.Object3D = gl.scene;
    src.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    src.traverse((o: any) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    if (!pts.length) return null;
    const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const ax = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const L = size[ax];
    // which end is wider (the reflector head)?
    let r0 = 0, r1 = 0;
    for (const p of pts) {
      const t = (p[ax] - box.min[ax]) / L, q = p.clone().sub(c); q[ax] = 0;
      const r = q.length();
      if (t < 0.15) r0 = Math.max(r0, r); else if (t > 0.85) r1 = Math.max(r1, r);
    }
    const headPositive = r1 >= r0;
    const pivot = new THREE.Group();
    const inner = src.clone(true);
    inner.position.copy(c).multiplyScalar(-1);
    const rot = new THREE.Group();
    rot.add(inner);
    // map the long axis onto +X with the head forward
    if (ax === 'y') rot.rotation.z = headPositive ? -Math.PI / 2 : Math.PI / 2;
    else if (ax === 'z') rot.rotation.y = headPositive ? Math.PI / 2 : -Math.PI / 2;
    else if (!headPositive) rot.rotation.y = Math.PI;
    pivot.add(rot);
    pivot.position.set(0, 0.03, 0);
    TORCH.len = L;
    TORCH.lensR = Math.max(0.012, Math.min(0.04, Math.max(r0, r1) * 0.82));
    return pivot;
  }).catch(() => null);
  return torchP;
}
