import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { libModel } from '../world/lib';
import { garlandModel } from '../life/items';

/* ============================================================================================
 * A Thai shophouse shrine shelf (หิ้งบูชา) as seen above every shop counter: a wall bracket shelf in
 * red lacquer with a stepped two-tier altar, a carved gold kanok apron, a gold-edged back panel with an
 * arch, a red fringed valance, a lucky cat, two red lotus electric lamps, an incense bowl with stubs,
 * small vases of marigolds and a real braided jasmine garland. Origin: centre of the shelf's back edge
 * at shelf height, facing +z (out of the wall). ~0.66 m wide.
 * ========================================================================================== */

let kanok: THREE.CanvasTexture | null = null;
function kanokTex() {
  if (kanok) return kanok;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#7a1410'; c.fillRect(0, 0, 512, 64);
  const g = c.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#f2d27a'); g.addColorStop(0.5, '#c8962e'); g.addColorStop(1, '#8a6418');
  c.strokeStyle = g; c.fillStyle = g; c.lineWidth = 3;
  c.strokeRect(3, 4, 506, 56);
  for (let x = 16; x < 512; x += 32) {   // flame-like kanok leaves + dots
    c.beginPath(); c.moveTo(x, 54); c.bezierCurveTo(x - 12, 40, x - 4, 22, x + 4, 12); c.bezierCurveTo(x + 2, 26, x + 12, 38, x, 54); c.fill();
    c.beginPath(); c.arc(x + 16, 46, 3.2, 0, Math.PI * 2); c.fill();
  }
  kanok = new THREE.CanvasTexture(cv); kanok.colorSpace = THREE.SRGBColorSpace; kanok.anisotropy = 8;
  return kanok;
}

const M = {
  lac: () => new THREE.MeshPhysicalMaterial({ color: 0x8a1410, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xd2a23a, roughness: 0.3, metalness: 0.95 }),
};
let mats: { lac: THREE.Material; gold: THREE.Material; apron: THREE.Material; fringe: THREE.Material; lotus: THREE.Material; flame: THREE.Material; marigold: THREE.Material; vase: THREE.Material; stub: THREE.Material } | null = null;
function getMats() {
  if (mats) return mats;
  mats = {
    lac: M.lac(), gold: M.gold(),
    apron: new THREE.MeshStandardMaterial({ map: kanokTex(), roughness: 0.4, metalness: 0.35 }),
    fringe: new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.85, side: THREE.DoubleSide }),
    lotus: new THREE.MeshStandardMaterial({ color: 0xd8282a, roughness: 0.45, emissive: new THREE.Color(0xff3020), emissiveIntensity: 0.35 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffd080 }),
    marigold: new THREE.MeshStandardMaterial({ color: 0xf29a18, roughness: 0.8 }),
    vase: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.2, metalness: 0.1 }),
    stub: new THREE.MeshStandardMaterial({ color: 0xa8241c, roughness: 0.7 }),
  };
  return mats;
}

export function shrineShelf(): THREE.Group {
  const m = getMats();
  const g = new THREE.Group();
  g.name = 'shop-shrine';
  const W = 0.66, D = 0.32;
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0.006) => {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
    b.position.set(x, y + h / 2, z); g.add(b); return b;
  };
  // wall shelf board with a moulded front lip + two carved brackets underneath
  box(W, 0.03, D, m.lac, 0, 0, D / 2);
  box(W + 0.03, 0.012, 0.025, m.gold, 0, 0.03, D - 0.005, 0.004);
  for (const sx of [-1, 1]) {
    const br = new THREE.Shape(); br.moveTo(0, 0); br.lineTo(0.2, 0); br.quadraticCurveTo(0.05, -0.04, 0, -0.2); br.lineTo(0, 0);
    const bg = new THREE.ExtrudeGeometry(br, { depth: 0.025, bevelEnabled: false });
    const bm = new THREE.Mesh(bg, m.lac); bm.rotation.y = -Math.PI / 2; bm.position.set(sx * (W / 2 - 0.06) - 0.0125, 0, 0); g.add(bm);
  }
  // carved apron hanging from the shelf front + red fringe valance
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.07), m.apron); apron.position.set(0, -0.035, D + 0.001); g.add(apron);
  const fr = new THREE.PlaneGeometry(W - 0.02, 0.05, 24, 1);
  const fp = fr.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) if (fp.getY(i) < 0) fp.setY(i, fp.getY(i) - (i % 2) * 0.012);
  const fringe = new THREE.Mesh(fr, m.fringe); fringe.position.set(0, -0.095, D + 0.002); g.add(fringe);
  // back panel with a gold arch border
  box(W - 0.04, 0.38, 0.015, m.lac, 0, 0.03, 0.01);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, 6, 32, Math.PI), m.gold); arch.position.set(0, 0.24, 0.02); g.add(arch);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.21, 8), m.gold); p.position.set(sx * 0.17, 0.135, 0.02); g.add(p); }
  // stepped altar (two tiers) with gold edges
  box(0.42, 0.06, 0.16, m.lac, 0, 0.03, 0.1); box(0.43, 0.01, 0.17, m.gold, 0, 0.09, 0.1, 0.003);
  box(0.28, 0.05, 0.1, m.lac, 0, 0.1, 0.07); box(0.29, 0.008, 0.11, m.gold, 0, 0.15, 0.07, 0.003);
  // lucky cat on the top tier
  const cat = libModel('lucky_cat_gold'); cat.position.set(0, 0.158, 0.07); cat.scale.setScalar(0.8); g.add(cat);
  // two red lotus electric lamps on the lower tier ends
  for (const sx of [-1, 1]) {
    const L = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.08, 8), m.gold); stem.position.y = 0.04; L.add(stem);
    for (let k = 0; k < 8; k++) {
      const pet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.lotus);
      pet.scale.set(0.55, 1.4, 0.35); const a = (k / 8) * Math.PI * 2;
      pet.position.set(Math.cos(a) * 0.012, 0.085, Math.sin(a) * 0.012); pet.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); L.add(pet);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), m.flame); bulb.scale.y = 1.6; bulb.position.y = 0.112; L.add(bulb);
    L.position.set(sx * 0.17, 0.1, 0.13); g.add(L);
  }
  // incense bowl with stubs in front of the cat
  const bowl = libModel('khan_bowl'); bowl.scale.setScalar(0.45); bowl.position.set(0, 0.1, 0.16); g.add(bowl);
  for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05 + (k % 3) * 0.02, 4), m.stub); s.position.set(-0.02 + (k % 4) * 0.012, 0.15, 0.155 + Math.floor(k / 4) * 0.012); s.rotation.z = (k - 3) * 0.06; g.add(s); }
  // two small vases of marigolds on the shelf corners
  for (const sx of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.LatheGeometry([[0.0005, 0], [0.02, 0.002], [0.026, 0.03], [0.014, 0.06], [0.016, 0.075]].map(([x, y]) => new THREE.Vector2(x, y)), 12), m.vase);
    v.position.set(sx * 0.27, 0.03, 0.2); g.add(v);
    for (let k = 0; k < 5; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), m.marigold); f.position.set(sx * 0.27 + Math.cos(k * 1.3) * 0.02, 0.11 + (k % 2) * 0.015, 0.2 + Math.sin(k * 1.3) * 0.02); g.add(f); }
  }
  // a real braided jasmine garland draped on the front of the altar
  try { const gl = garlandModel(); gl.scale.setScalar(0.6); gl.rotation.x = -1.2; gl.position.set(0.08, 0.09, 0.19); g.add(gl); } catch { /* garland optional */ }
  g.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return g;
}
