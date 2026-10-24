import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { ItemDef, CarryStyle } from '../../game/items';
import { Assets } from '../../core/assets';
import { TL, tl } from '../../core/util';
import { photo, photoMat, mat } from './tex';

/**
 * Item kinds owned by the shops module (shopping basket, plastic bag, keeper props) plus
 * FALLBACK kinds for stock that no other module defines (yet): low-poly shapes wrapped in REAL
 * product photos (public/assets/img/labels, public/assets/gen/shops). Fallbacks are only defined
 * when the real kind is missing, so cooking/restaurant items always win.
 */

const LAB = 'img/labels/';

// ------------------------------------------------------------------ tiny geometry helpers (origin = bottom centre)

function wobble(g: THREE.BufferGeometry, amt: number, seed = 1) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 23.1 + seed) * Math.cos(z * 19.7 - seed) * Math.sin(y * 17.3 + seed * 2);
    p.setXYZ(i, x * (1 + n * amt), y, z * (1 + n * amt));
  }
  g.computeVertexNormals();
  return g;
}

/** Real label photos cover only the photographed front arc (~140°): squeeze u around the front (u = 0.5). */
function frontArc(g: THREE.BufferGeometry, deg = 140) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const k = 360 / deg;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) - 0.5) * k + 0.5);
  return g;
}

/** Cylinder whose side UV wraps 0..1 (label centred at the front), caps separate group. */
function cyl(r: number, h: number, seg = 14, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, false, Math.PI);
  g.translate(0, h / 2, 0);
  return g;
}

function lathe(profile: [number, number][], seg = 14) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg, -Math.PI);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, pos = g.getAttribute('position');
  const ymax = Math.max(...profile.map((p) => p[1])) || 1;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), pos.getY(i) / ymax);
  g.computeVertexNormals();
  return g;
}

function boxAt(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

function merge(gs: THREE.BufferGeometry[]) {
  const list = gs.map((g) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; });
  return mergeGeometries(list, false) ?? list[0];
}

function group(...objs: THREE.Object3D[]) { const g = new THREE.Group(); for (const o of objs) g.add(o); return g; }
function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; }

const plastic = (color: number) => mat('plastic:' + color, () => { const m = Assets.pbr('plastic_rough', { repeat: 1, color, fallback: color }).clone(); return m; });
const flat = (color: number, rough = 0.7, metal = 0) => mat(`flat:${color}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
const steel = () => mat('steel', () => Assets.pbr('stainless_brushed', { repeat: 1, fallback: 0xb8bcc0 }));
const labelMat = (file: string, o: { alpha?: boolean } = {}) => mat('label:' + file + (o.alpha ? 'a' : ''), () => {
  const t = Assets.texture(file.includes('/') ? file : LAB + file, { srgb: true, wrap: false });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0 });
  if (o.alpha) m.alphaTest = 0.4;
  return m;
});

// ------------------------------------------------------------------ shape builders

type Shape = 'tray' | 'bag' | 'bunch' | 'egg' | 'bottle' | 'jar' | 'can' | 'cup' | 'box' | 'sack' | 'tank' | 'jug' | 'pillow' | 'stool' | 'chair' | 'table' | 'umbrella' | 'tub' | 'rack' | 'bin' | 'wok' | 'utensil' | 'board' | 'mortar' | 'plate' | 'bowl' | 'cooker' | 'burner' | 'basket' | 'eggtray' | 'heap';

interface FbSpec { name: TL; shape: Shape; tex?: string; tex2?: string; size: [number, number, number]; color?: number; body?: number; weight: number; slots?: number; carry?: CarryStyle; tags?: string[]; data?: () => any }

function build(spec: FbSpec): THREE.Object3D {
  const [w, h, d] = spec.size;
  const c = spec.color ?? 0xcccccc;
  switch (spec.shape) {
    case 'tray': { // foam tray + cling film with the real top photo
      const base = mesh(boxAt(w, h * 0.6, d), flat(0xf1efe9, 0.8));
      const top = mesh(new THREE.PlaneGeometry(w * 0.96, d * 0.96).rotateX(-Math.PI / 2).translate(0, h * 0.62, 0), spec.tex ? labelMat(spec.tex) : flat(c));
      const lump = mesh(wobble(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(w * 0.9, h * 0.8, d * 0.9).translate(0, h * 0.5, 0), 0.08, 3), mat('film', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.18 })));
      return group(base, top, lump);
    }
    case 'bag': case 'heap': { // knotted plastic bag of produce: lumpy body textured with the real produce photo
      const g = wobble(new THREE.SphereGeometry(0.5, 12, 8).scale(w, h, d).translate(0, h * 0.48, 0), 0.12, w * 31);
      const body = mesh(g, spec.tex ? photoMat(spec.tex, { color: c }) : flat(c));
      if (spec.shape === 'heap') return group(body);
      const film = mesh(new THREE.SphereGeometry(0.52, 10, 7).scale(w, h * 1.05, d).translate(0, h * 0.5, 0), mat('bagfilm', () => new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.25, transparent: true, opacity: 0.28, depthWrite: false })));
      const knot = mesh(new THREE.ConeGeometry(w * 0.12, h * 0.35, 6).translate(0, h * 1.08, 0), mat('bagknot', () => new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, transparent: true, opacity: 0.7 })));
      return group(body, film, knot);
    }
    case 'bunch': { // bundle of leaf cards / sticks tied with a rubber band
      const leaves: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const p = new THREE.PlaneGeometry(w * 0.7, h).translate(0, h / 2, 0);
        p.rotateY((i / 7) * Math.PI);
        p.rotateZ((i % 2 ? 1 : -1) * 0.12);
        leaves.push(p);
      }
      const body = mesh(merge(leaves), photoMat(spec.tex ?? 'heap_basil', { color: c, side: THREE.DoubleSide, alpha: false }));
      const band = mesh(new THREE.TorusGeometry(w * 0.14, 0.006, 4, 10).rotateX(Math.PI / 2).translate(0, h * 0.18, 0), flat(0xd8343a, 0.5));
      return group(body, band);
    }
    case 'egg': return group(mesh(new THREE.SphereGeometry(0.5, 10, 8).scale(w, h, d).translate(0, h / 2, 0), flat(0xd9a77a, 0.55)));
    case 'eggtray': {
      const base = mesh(boxAt(w, h * 0.35, d), flat(0xb9a891, 0.95));
      const top = mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, h * 0.7, 0), photoMat(spec.tex ?? 'heap_eggs'));
      const eggs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) eggs.push(new THREE.SphereGeometry(w * 0.075, 7, 5).scale(1, 1.25, 1).translate((i - 2.5) * w * 0.16, h * 0.5, (j - 2) * d * 0.19));
      return group(base, top, mesh(merge(eggs), flat(0xd8a676, 0.6)));
    }
    case 'bottle': case 'jar': {
      const neck = spec.shape === 'bottle';
      const prof: [number, number][] = neck
        ? [[0, 0], [w / 2, 0.004], [w / 2, h * 0.62], [w * 0.38, h * 0.74], [w * 0.15, h * 0.86], [w * 0.15, h], [0, h]]
        : [[0, 0], [w / 2, 0.004], [w / 2, h * 0.86], [w * 0.42, h * 0.9], [w * 0.42, h], [0, h]];
      const body = mesh(lathe(prof, 14), mat('bottlebody:' + (spec.body ?? 0x3a2412), () => new THREE.MeshStandardMaterial({ color: spec.body ?? 0x3a2412, roughness: 0.18, metalness: 0.05, transparent: (spec.body ?? 0) > 0x808080, opacity: (spec.body ?? 0) > 0x808080 ? 0.75 : 1 })));
      const parts: THREE.Object3D[] = [body];
      if (spec.tex) {
        const y0 = neck ? 0.16 : 0.12, y1 = neck ? 0.6 : 0.84;
        const band = frontArc(cyl(w * 0.512, h * (y1 - y0), 18)).translate(0, h * y0, 0);
        parts.push(mesh(band, labelMat(spec.tex)));
      }
      parts.push(mesh(cyl(neck ? w * 0.17 : w * 0.44, h * 0.08).translate(0, h * 0.97, 0), flat(spec.color ?? 0xc4161c, 0.4)));
      return group(...parts);
    }
    case 'can': {
      const body = mesh(spec.tex ? frontArc(cyl(w / 2, h, 18), 160) : cyl(w / 2, h, 16), spec.tex ? labelMat(spec.tex) : flat(c, 0.3, 0.6));
      const top = mesh(cyl(w * 0.46, 0.006).translate(0, h, 0), steel());
      return group(body, top);
    }
    case 'cup': {
      const body = mesh(spec.tex ? frontArc(lathe([[0, 0], [w * 0.36, 0.004], [w / 2, h], [0, h]], 18), 180) : lathe([[0, 0], [w * 0.36, 0.004], [w / 2, h], [0, h]], 14), spec.tex ? labelMat(spec.tex) : flat(c, 0.6));
      return group(body);
    }
    case 'box': case 'pillow': case 'sack': {
      const g = new THREE.BoxGeometry(w, h, d, 3, 4, 2);
      if (spec.shape !== 'box') { // puffy
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const k = 1 - Math.pow(Math.abs(y) / (h / 2), 2) * 0.35;
          p.setXYZ(i, x * (spec.shape === 'sack' ? 1 : k), y, z * k * (spec.shape === 'pillow' ? 1.15 : 1));
        }
        g.computeVertexNormals();
      }
      g.translate(0, h / 2, 0);
      const front = spec.tex ? labelMat(spec.tex) : flat(c);
      const side = flat(spec.color ?? 0xe8e2d6, 0.7);
      // BoxGeometry groups: +x, -x, +y, -y, +z, -z → photo on +z and -z
      return group(mesh(g, [side, side, side, side, front, front]));
    }
    case 'tank': { // LPG cylinder with real label
      const body = mesh(frontArc(lathe([[0, 0], [w * 0.46, 0.01], [w / 2, h * 0.08], [w / 2, h * 0.78], [w * 0.38, h * 0.88], [w * 0.12, h * 0.9], [0, h * 0.9]], 18), 170), spec.tex ? labelMat(spec.tex) : flat(c, 0.5, 0.2));
      const ring = mesh(new THREE.TorusGeometry(w * 0.25, w * 0.04, 5, 12).rotateX(Math.PI / 2).translate(0, h * 0.97, 0), flat(spec.color ?? 0x2f6fb5, 0.5, 0.3));
      const valve = mesh(cyl(w * 0.05, h * 0.08).translate(0, h * 0.88, 0), flat(0xb08d3a, 0.35, 0.8));
      return group(body, ring, valve);
    }
    case 'jug': { // 20 L water bottle: real photo on a cylinder (front) + translucent body
      const body = mesh(cyl(w / 2, h * 0.86, 16), mat('jugbody', () => new THREE.MeshStandardMaterial({ color: 0x9fd1f0, roughness: 0.08, transparent: true, opacity: 0.55 })));
      const front = mesh(new THREE.PlaneGeometry(w * 1.02, h).translate(0, h / 2, w * 0.51), photoMat(spec.tex ?? 'water20', { alpha: true }));
      const cap = mesh(cyl(w * 0.16, h * 0.14).translate(0, h * 0.86, 0), flat(0x1f5fbf, 0.4));
      return group(body, front, cap);
    }
    case 'stool': {
      const legs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; legs.push(new THREE.BoxGeometry(0.05, h * 0.92, 0.07).translate(Math.cos(a) * w * 0.36, h * 0.46, Math.sin(a) * w * 0.36).rotateY(a)); }
      const seat = new THREE.CylinderGeometry(w / 2, w * 0.46, 0.035, 12).translate(0, h - 0.018, 0);
      const ring = new THREE.TorusGeometry(w * 0.38, 0.012, 4, 12).rotateX(Math.PI / 2).translate(0, h * 0.25, 0);
      return group(mesh(merge([...legs, seat, ring]), plastic(spec.color ?? 0xc42a22)));
    }
    case 'chair': {
      const seat = boxAt(w, 0.04, d * 0.9, 0, h * 0.44, 0.02);
      const back = boxAt(w, h * 0.5, 0.035, 0, h * 0.47, -d * 0.42).rotateX(-0.12);
      const legs: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) legs.push(boxAt(0.05, h * 0.45, 0.05, x * w * 0.42, 0, z * d * 0.4));
      return group(mesh(merge([seat, back, ...legs]), plastic(spec.color ?? 0xf0efe9)));
    }
    case 'table': {
      const top = boxAt(w, 0.04, d, 0, h - 0.04, 0);
      const legs: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) legs.push(boxAt(0.045, h - 0.04, 0.045, x * w * 0.44, 0, z * d * 0.42));
      return group(mesh(top, plastic(spec.color ?? 0x2f6fc4)), mesh(merge(legs), steel()));
    }
    case 'umbrella': { // folded garden umbrella (carried) — canopy bundle on a pole
      const pole = mesh(cyl(0.018, h), steel());
      const canopy = mesh(cyl(w * 0.5, h * 0.55, 8, w * 0.1).translate(0, h * 0.35, 0), mat('umb', () => Assets.pbr('canvas_tarp', { repeat: 1, color: 0x2a5fb0, fallback: 0x2a5fb0 })));
      return group(pole, canopy);
    }
    case 'tub': return group(mesh(lathe([[0, 0], [w * 0.36, 0.004], [w / 2, h], [w * 0.47, h], [w * 0.34, 0.03], [0, 0.03]], 18), plastic(spec.color ?? 0x2f6fd8)));
    case 'basket': {
      const tex = photo('basket_red');
      const side = mat('basketside', () => { const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide, alphaTest: 0.4, color: tex ? 0xffffff : 0xc42a22 }); return m; });
      const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
      g.translate(0, h / 2, 0);
      // drop the top face: groups 0..5 = +x,-x,+y,-y,+z,-z
      const m = mesh(g, [side, side, mat('invisible', () => new THREE.MeshBasicMaterial({ visible: false })), plastic(0xc42a22), side, side]);
      const handle = mesh(new THREE.TorusGeometry(w * 0.32, 0.01, 4, 10, Math.PI).translate(0, h, 0), flat(0x151515, 0.5));
      const contents = new THREE.Group(); contents.name = 'contents'; contents.position.y = 0.02;
      return group(m, handle, contents);
    }
    case 'rack': {
      const bars: THREE.BufferGeometry[] = [];
      for (let i = 0; i <= 8; i++) bars.push(boxAt(0.008, h, 0.008, -w / 2 + (w * i) / 8, 0, 0));
      bars.push(boxAt(w, 0.01, d, 0, 0, 0), boxAt(w, 0.01, 0.01, 0, h * 0.5, d / 2), boxAt(w, 0.01, 0.01, 0, h * 0.5, -d / 2));
      return group(mesh(merge(bars), steel()));
    }
    case 'bin': return group(mesh(lathe([[0, 0], [w * 0.42, 0.004], [w / 2, h], [w * 0.47, h], [w * 0.4, 0.03], [0, 0.03]], 14), plastic(spec.color ?? 0x2f7d3a)));
    case 'wok': {
      const bowl = mesh(lathe([[0, 0], [w * 0.2, 0.005], [w * 0.38, h * 0.45], [w / 2, h], [w * 0.48, h], [w * 0.36, h * 0.47], [0.0001, 0.02]], 18), mat('wok', () => Assets.pbr('cast_iron_wok', { repeat: 1, fallback: 0x2a2826 })));
      const handle = mesh(boxAt(0.25, 0.03, 0.035, w / 2 + 0.11, h * 0.8, 0), flat(0x4a2d1a, 0.7));
      return group(bowl, handle);
    }
    case 'utensil': {
      const head = mesh(boxAt(w, 0.01, d, 0, 0, d * 0.5), steel());
      const handle = mesh(boxAt(0.025, 0.025, h, 0, 0, d + h / 2), flat(0x5a3a22, 0.7));
      return group(head, handle);
    }
    case 'board': return group(mesh(cyl(w / 2, h, 16), mat('board', () => Assets.pbr('chopping_board_endgrain', { repeat: 1, fallback: 0x9a6a3a }))));
    case 'mortar': {
      const m = mesh(lathe([[0, 0], [w * 0.32, 0.005], [w / 2, h * 0.75], [w * 0.47, h], [w * 0.38, h], [w * 0.36, h * 0.45], [0, h * 0.35]], 14), flat(0x8a5a3c, 0.9));
      const pestle = mesh(cyl(0.025, 0.24, 7, 0.02).rotateZ(0.5).translate(0.05, h * 0.55, 0), flat(0x6b4a2a, 0.8));
      return group(m, pestle);
    }
    case 'plate': return group(mesh(lathe([[0, 0], [w * 0.32, 0.002], [w / 2, h], [w * 0.47, h], [w * 0.3, h * 0.25], [0, h * 0.25]], 18), flat(spec.color ?? 0xe8eef2, 0.35)));
    case 'bowl': return group(mesh(lathe([[0, 0], [w * 0.24, 0.002], [w / 2, h], [w * 0.47, h], [w * 0.22, h * 0.12], [0, h * 0.12]], 16), flat(spec.color ?? 0xf3efe6, 0.35)));
    case 'cooker': {
      const body = mesh(cyl(w / 2, h * 0.8, 16), flat(0xf0ede6, 0.4));
      const lid = mesh(new THREE.SphereGeometry(w / 2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, h * 0.8, 0), flat(0xe4e0d8, 0.4));
      const front = mesh(new THREE.PlaneGeometry(w * 0.3, h * 0.15).translate(0, h * 0.4, w / 2 + 0.002), flat(0x9a2a24, 0.5));
      return group(body, lid, front);
    }
    case 'burner': {
      const ring = mesh(cyl(w / 2, h * 0.3, 12), mat('castiron', () => new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.8, metalness: 0.4 })));
      const legs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; legs.push(boxAt(0.03, h, 0.03, Math.cos(a) * w * 0.42, 0, Math.sin(a) * w * 0.42)); }
      return group(ring, mesh(merge(legs), flat(0x2a2826, 0.8, 0.4)));
    }
  }
  return group(mesh(boxAt(w, h, d), flat(c)));
}

const L = tl;
/** Fallback kinds (only defined when no module defines the real kind). */
export const FALLBACKS: Record<string, FbSpec> = {
  sfb_pork_minced: { name: L('หมูสับ 500 ก.', 'minced pork 500 g'), shape: 'tray', tex: 'pork_tray_cp_top.png', size: [0.2, 0.05, 0.15], weight: 0.55, tags: ['ingredient', 'meat'], data: () => ({ g: 500 }) },
  sfb_pork_sliced: { name: L('หมูสไลซ์ 500 ก.', 'sliced pork 500 g'), shape: 'tray', tex: 'pork_tray_cheeva_sleeve.png', size: [0.2, 0.05, 0.15], weight: 0.55, tags: ['ingredient', 'meat'], data: () => ({ g: 500 }) },
  sfb_chicken_minced: { name: L('ไก่สับ 500 ก.', 'minced chicken 500 g'), shape: 'bag', tex: 'pork_table', color: 0xffe8d8, size: [0.14, 0.09, 0.12], weight: 0.55, tags: ['ingredient', 'meat'], data: () => ({ g: 500 }) },
  sfb_shrimp: { name: L('กุ้งสด', 'shrimp'), shape: 'bag', tex: 'heap_chili', color: 0xffc8b0, size: [0.14, 0.08, 0.12], weight: 0.35, tags: ['ingredient', 'meat'], data: () => ({ g: 300 }) },
  sfb_holy_basil: { name: L('ใบกะเพรา', 'holy basil'), shape: 'bunch', tex: 'heap_basil', size: [0.12, 0.2, 0.12], weight: 0.1, tags: ['ingredient', 'veg'], data: () => ({ g: 100 }) },
  sfb_garlic: { name: L('กระเทียม', 'garlic'), shape: 'bag', tex: 'heap_garlic', size: [0.13, 0.08, 0.11], weight: 0.22, tags: ['ingredient'], data: () => ({ g: 200 }) },
  sfb_chili: { name: L('พริกขี้หนู', "bird's eye chili"), shape: 'bag', tex: 'heap_chili', size: [0.11, 0.07, 0.09], weight: 0.11, tags: ['ingredient'], data: () => ({ g: 100 }) },
  sfb_egg: { name: L('ไข่ไก่', 'egg'), shape: 'egg', size: [0.045, 0.058, 0.045], weight: 0.06, tags: ['ingredient', 'egg'], data: () => ({ g: 60 }) },
  sfb_egg_tray: { name: L('ไข่ไก่ 1 แผง (30 ฟอง)', 'tray of 30 eggs'), shape: 'eggtray', tex: 'heap_eggs', size: [0.3, 0.08, 0.3], weight: 1.9, carry: 'twohand', tags: ['ingredient', 'egg'] },
  sfb_long_beans: { name: L('ถั่วฝักยาว', 'long beans'), shape: 'bunch', tex: 'heap_beans', size: [0.1, 0.32, 0.1], weight: 0.26, tags: ['ingredient', 'veg'], data: () => ({ g: 250 }) },
  sfb_onion: { name: L('หอมใหญ่', 'onions'), shape: 'bag', tex: 'heap_onion', size: [0.15, 0.1, 0.13], weight: 0.31, tags: ['ingredient', 'veg'], data: () => ({ g: 300 }) },
  sfb_kale: { name: L('คะน้า', 'Chinese kale'), shape: 'bunch', tex: 'heap_basil', color: 0xb8d8a8, size: [0.12, 0.28, 0.12], weight: 0.26, tags: ['ingredient', 'veg'] },
  sfb_morning_glory: { name: L('ผักบุ้ง', 'morning glory'), shape: 'bunch', tex: 'heap_beans', size: [0.12, 0.34, 0.12], weight: 0.31, tags: ['ingredient', 'veg'] },
  sfb_tomato: { name: L('มะเขือเทศ', 'tomatoes'), shape: 'bag', tex: 'heap_chili', color: 0xff8a7a, size: [0.13, 0.08, 0.11], weight: 0.26, tags: ['ingredient', 'veg'] },
  sfb_spring_onion: { name: L('ต้นหอม', 'spring onion'), shape: 'bunch', tex: 'heap_beans', size: [0.08, 0.28, 0.08], weight: 0.09, tags: ['ingredient', 'veg'] },
  sfb_cucumber: { name: L('แตงกวา', 'cucumbers'), shape: 'bag', tex: 'heap_beans', size: [0.15, 0.08, 0.12], weight: 0.31, tags: ['ingredient', 'veg'] },
  sfb_lime: { name: L('มะนาว', 'lime'), shape: 'egg', color: 0x6a9a2a, size: [0.05, 0.05, 0.05], weight: 0.12, tags: ['ingredient'] },
  sfb_lemongrass: { name: L('ตะไคร้', 'lemongrass'), shape: 'bunch', tex: 'heap_beans', color: 0xe8f0c0, size: [0.08, 0.34, 0.08], weight: 0.16, tags: ['ingredient', 'herb'] },
  sfb_galangal: { name: L('ข่า', 'galangal'), shape: 'bag', tex: 'heap_garlic', color: 0xf2d8b0, size: [0.12, 0.07, 0.1], weight: 0.13, tags: ['ingredient', 'herb'] },
  sfb_kaffir_lime: { name: L('ใบมะกรูด', 'kaffir lime leaves'), shape: 'bag', tex: 'heap_basil', size: [0.1, 0.05, 0.08], weight: 0.04, tags: ['ingredient', 'herb'] },
  sfb_mushroom: { name: L('เห็ดฟาง', 'straw mushrooms'), shape: 'bag', tex: 'heap_garlic', color: 0xb89a7a, size: [0.13, 0.07, 0.11], weight: 0.21, tags: ['ingredient', 'veg'] },
  sfb_fish_sauce: { name: L('น้ำปลา', 'fish sauce'), shape: 'bottle', tex: 'fish_sauce_tiparos.png', size: [0.075, 0.27, 0.075], color: 0xc4161c, weight: 0.85, tags: ['ingredient', 'sauce'] },
  sfb_oyster_sauce: { name: L('ซอสหอยนางรม', 'oyster sauce'), shape: 'bottle', tex: 'oyster_sauce_maekrua.png', size: [0.08, 0.26, 0.08], color: 0xc4161c, weight: 1.05, tags: ['ingredient', 'sauce'] },
  sfb_soy_light: { name: L('ซีอิ๊วขาว', 'light soy sauce'), shape: 'bottle', tex: 'light_soy_healthy_boy.png', size: [0.075, 0.27, 0.075], color: 0xf2c21e, body: 0x5a3010, weight: 0.95, tags: ['ingredient', 'sauce'] },
  sfb_soy_dark: { name: L('ซีอิ๊วดำหวาน', 'sweet dark soy'), shape: 'bottle', tex: 'dark_soy_healthy_boy.png', size: [0.075, 0.27, 0.075], color: 0x6a1a12, weight: 1.2, tags: ['ingredient', 'sauce'] },
  sfb_seasoning_sauce: { name: L('ซอสปรุงรส', 'seasoning sauce'), shape: 'bottle', tex: 'seasoning_sauce_golden_mountain.png', size: [0.07, 0.25, 0.07], color: 0x1f8a3c, weight: 0.8, tags: ['ingredient', 'sauce'] },
  sfb_cooking_oil: { name: L('น้ำมันพืช 1 ลิตร', 'cooking oil 1 L'), shape: 'bottle', tex: 'palm_oil_morakot_1l.png', size: [0.085, 0.29, 0.085], color: 0xe0b01a, body: 0xe8c040, weight: 0.95, tags: ['ingredient', 'oil'] },
  sfb_white_pepper: { name: L('พริกไทยป่น', 'ground white pepper'), shape: 'jar', tex: 'white_pepper_hand_brand_jar.png', size: [0.06, 0.1, 0.06], color: 0xb02a1a, weight: 0.15, tags: ['ingredient', 'seasoning'] },
  sfb_chili_flakes: { name: L('พริกป่น', 'chili flakes'), shape: 'jar', tex: 'chili_powder_hand_brand.png', size: [0.06, 0.1, 0.06], color: 0xb02a1a, weight: 0.15, tags: ['ingredient', 'seasoning'] },
  sfb_sugar: { name: L('น้ำตาลทราย 1 กก.', 'sugar 1 kg'), shape: 'pillow', tex: 'sugar_mitr_phol_1kg.png', size: [0.13, 0.2, 0.06], weight: 1.02, tags: ['ingredient', 'seasoning'] },
  sfb_msg: { name: L('ผงชูรส', 'MSG'), shape: 'pillow', tex: 'msg_ajinomoto_500g.png', size: [0.14, 0.2, 0.05], weight: 0.5, tags: ['ingredient', 'seasoning'] },
  sfb_rice_bag: { name: L('ข้าวหอมมะลิ 5 กก.', 'jasmine rice 5 kg'), shape: 'sack', tex: 'rice_5kg_hong_thong.png', size: [0.3, 0.42, 0.13], weight: 5.1, slots: 2, carry: 'twohand', tags: ['ingredient'], data: () => ({ g: 5000 }) },
  sfb_noodles_wide: { name: L('เส้นใหญ่', 'wide rice noodles'), shape: 'pillow', tex: 'heap_garlic', color: 0xfffaf0, size: [0.18, 0.06, 0.14], weight: 0.52, tags: ['ingredient'] },
  sfb_curry_paste: { name: L('พริกแกงเผ็ด', 'red curry paste'), shape: 'bag', tex: 'heap_chili', color: 0xb03a1a, size: [0.11, 0.06, 0.09], weight: 0.27, tags: ['ingredient'] },
  sfb_tomyum_paste: { name: L('น้ำพริกเผา', 'roasted chili paste'), shape: 'jar', tex: 'chili_powder_hand_brand.png', size: [0.07, 0.09, 0.07], weight: 0.33, tags: ['ingredient'] },
  sfb_gravy_starch: { name: L('แป้งมันสำปะหลัง', 'tapioca starch'), shape: 'pillow', tex: 'sugar_mitr_phol_1kg.png', color: 0xdde8ff, size: [0.13, 0.18, 0.05], weight: 0.52, tags: ['ingredient'] },
  sfb_water_jug: { name: L('น้ำดื่ม 1.5 ลิตร', 'drinking water 1.5 L'), shape: 'bottle', tex: 'water_crystal_600ml.png', size: [0.09, 0.32, 0.09], color: 0x2a6ad8, body: 0xd8eef8, weight: 1.6, tags: ['ingredient', 'water'] },
  sfb_water_bottle: { name: L('น้ำดื่มคริสตัล 600 มล.', 'Crystal water 600 ml'), shape: 'bottle', tex: 'water_crystal_600ml.png', size: [0.065, 0.22, 0.065], color: 0x2a6ad8, body: 0xd8eef8, weight: 0.62, tags: ['drink'] },
  sfb_water20: { name: L('น้ำดื่ม 20 ลิตร', 'drinking water 20 L'), shape: 'jug', tex: 'water20', size: [0.28, 0.5, 0.28], weight: 20, slots: 3, carry: 'twohand', tags: ['drink', 'water'] },
  sfb_ice_bag: { name: L('น้ำแข็งหลอด', 'tube ice bag'), shape: 'pillow', tex: 'ice_bag_siri_mit_tube_ice.png', size: [0.24, 0.32, 0.1], weight: 2.5, carry: 'twohand', tags: ['ice', 'drink'] },
  sfb_gas_tank: { name: L('ถังแก๊ส 15 กก.', '15 kg LPG tank'), shape: 'tank', tex: 'lpg_cylinder_world_gas.png', size: [0.32, 0.62, 0.32], color: 0x2f6fb5, weight: 18, slots: 4, carry: 'twohand', tags: ['gas'], data: () => ({ gas: 15 }) },
  sfb_mama_cup: { name: L('มาม่าคัพ', 'MAMA cup noodles'), shape: 'cup', tex: 'instant_noodle_mama_cup.png', size: [0.095, 0.1, 0.095], weight: 0.08, tags: ['snack'] },
  sfb_cola: { name: L('โค้ก 325 มล.', 'Coke can'), shape: 'can', tex: 'cola_coke_can_325.png', size: [0.066, 0.12, 0.066], weight: 0.35, tags: ['drink', 'soda'] },
  sfb_fanta: { name: L('แฟนต้าน้ำส้ม', 'Fanta orange'), shape: 'can', tex: 'soda_fanta_orange_can.png', size: [0.066, 0.12, 0.066], weight: 0.35, tags: ['drink', 'soda'] },
  sfb_m150: { name: L('เครื่องดื่มชูกำลัง', 'energy drink'), shape: 'bottle', tex: 'energy_m150.png', size: [0.05, 0.13, 0.05], color: 0xd4b22a, body: 0x6a3a0a, weight: 0.2, tags: ['drink'] },
  sfb_beer: { name: L('เบียร์ช้าง', 'Chang beer'), shape: 'can', tex: 'beer_chang_can.png', size: [0.066, 0.122, 0.066], weight: 0.36, tags: ['drink', 'alcohol'] },
  instant_rice: { name: L('ข้าวสวยพร้อมทาน', 'ready-to-eat jasmine rice'), shape: 'box', tex: 'gen/shops/rice_tray.png', size: [0.15, 0.045, 0.11], weight: 0.22, tags: ['ingredient', 'rice'], data: () => ({ g: 200 }) },
  // furniture & tools
  sfb_stool: { name: L('เก้าอี้พลาสติกสีแดง', 'red plastic stool'), shape: 'stool', size: [0.32, 0.46, 0.32], color: 0xc42a22, weight: 0.9, carry: 'head', tags: ['furniture', 'seat'] },
  sfb_chair: { name: L('เก้าอี้พลาสติก', 'plastic chair'), shape: 'chair', size: [0.46, 0.8, 0.46], color: 0xeceae4, weight: 2.2, slots: 2, carry: 'head', tags: ['furniture', 'seat'] },
  sfb_table: { name: L('โต๊ะพับ', 'folding table'), shape: 'table', size: [0.9, 0.72, 0.6], color: 0x2f6fc4, weight: 7, slots: 3, carry: 'twohand', tags: ['furniture', 'table'] },
  sfb_umbrella: { name: L('ร่มสนาม', 'garden umbrella'), shape: 'umbrella', size: [0.25, 1.9, 0.25], weight: 5, slots: 3, carry: 'back', tags: ['furniture'] },
  sfb_tub: { name: L('กะละมัง', 'plastic basin'), shape: 'tub', size: [0.5, 0.18, 0.5], color: 0x2f6fd8, weight: 0.7, tags: ['washing'] },
  sfb_dish_rack: { name: L('ที่คว่ำจาน', 'dish rack'), shape: 'rack', size: [0.45, 0.25, 0.32], weight: 1.4, tags: ['washing'] },
  sfb_cup: { name: L('แก้วพลาสติก', 'plastic cup'), shape: 'cup', size: [0.08, 0.11, 0.08], color: 0xc9e4f2, weight: 0.05, tags: ['cup'] },
  sfb_trash_bin: { name: L('ถังขยะ', 'trash bin'), shape: 'bin', size: [0.38, 0.55, 0.38], color: 0x2f7d3a, weight: 1.6, slots: 2, carry: 'twohand', tags: ['cleaning'] },
  sfb_wok: { name: L('กระทะเหล็ก', 'carbon-steel wok'), shape: 'wok', size: [0.38, 0.12, 0.38], weight: 2.2, tags: ['tool'] },
  sfb_spatula: { name: L('ตะหลิว', 'wok spatula'), shape: 'utensil', size: [0.1, 0.3, 0.09], weight: 0.35, tags: ['tool'] },
  sfb_ladle: { name: L('กระบวย', 'ladle'), shape: 'utensil', size: [0.09, 0.3, 0.09], weight: 0.3, tags: ['tool'] },
  sfb_cleaver: { name: L('มีดอีโต้', 'cleaver'), shape: 'utensil', size: [0.09, 0.14, 0.18], weight: 0.7, tags: ['tool'] },
  sfb_chopping_board: { name: L('เขียงไม้มะขาม', 'tamarind chopping board'), shape: 'board', size: [0.36, 0.06, 0.36], weight: 2.4, tags: ['tool'] },
  sfb_mortar: { name: L('ครกดินเผา', 'clay mortar'), shape: 'mortar', size: [0.2, 0.15, 0.2], weight: 3.2, tags: ['tool'] },
  sfb_plate: { name: L('จานเมลามีน', 'melamine plate'), shape: 'plate', size: [0.24, 0.03, 0.24], weight: 0.25, tags: ['dish'] },
  sfb_bowl: { name: L('ชามตราไก่', 'rooster bowl'), shape: 'bowl', size: [0.17, 0.08, 0.17], weight: 0.32, tags: ['dish'] },
  sfb_spoon_fork: { name: L('ช้อนส้อม', 'spoon & fork'), shape: 'utensil', size: [0.04, 0.16, 0.05], weight: 0.06, tags: ['tool'] },
  sfb_rice_paddle: { name: L('ทัพพี', 'rice paddle'), shape: 'utensil', size: [0.07, 0.15, 0.08], weight: 0.08, tags: ['tool'] },
  sfb_rice_cooker: { name: L('หม้อหุงข้าว', 'rice cooker'), shape: 'cooker', size: [0.32, 0.3, 0.32], weight: 5.5, slots: 2, carry: 'twohand', tags: ['tool'] },
  sfb_burner: { name: L('เตาแก๊สหัวฟู่', 'high-pressure burner'), shape: 'burner', size: [0.36, 0.22, 0.36], weight: 4, slots: 2, carry: 'twohand', tags: ['tool'] },
  shopping_basket: { name: L('ตะกร้าพลาสติก', 'plastic basket'), shape: 'basket', size: [0.42, 0.22, 0.28], weight: 0.4, tags: ['container'] },
};

/** Keeper props (drawn in NPC hands; not for sale). */
const PROPS: Record<string, { name: TL; make: () => THREE.Object3D }> = {
  shop_fan: { name: L('พัด', 'hand fan'), make: () => {
    const g = new THREE.CircleGeometry(0.11, 12, 0, Math.PI).translate(0, 0.09, 0);
    return group(mesh(g, mat('fanface', () => new THREE.MeshStandardMaterial({ map: photo('star_yellow'), color: 0xffffff, side: THREE.DoubleSide, roughness: 0.7 }))), mesh(boxAt(0.018, 0.1, 0.006), flat(0x8a6a3a)));
  } },
  shop_phone: { name: L('มือถือ', 'phone'), make: () => group(mesh(boxAt(0.072, 0.15, 0.008), [flat(0x151515, 0.3), flat(0x151515, 0.3), flat(0x151515, 0.3), flat(0x151515, 0.3), mat('phonescr', () => new THREE.MeshStandardMaterial({ map: photo('seven_snacks2'), emissive: new THREE.Color(0xffffff), emissiveMap: photo('seven_snacks2'), emissiveIntensity: 0.6 })), flat(0x222222, 0.4)])) },
  shop_racket: { name: L('ไม้ตียุงไฟฟ้า', 'electric fly swatter'), make: () => {
    const head = new THREE.TorusGeometry(0.1, 0.012, 4, 14).scale(1, 1.25, 1).translate(0, 0.34, 0);
    const handle = boxAt(0.03, 0.22, 0.03);
    const net = new THREE.PlaneGeometry(0.18, 0.23).translate(0, 0.34, 0);
    return group(mesh(merge([head, handle]), plastic(0xe0c21a)), mesh(net, mat('racketnet', () => new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))));
  } },
  shop_calculator: { name: L('เครื่องคิดเลข', 'calculator'), make: () => group(mesh(boxAt(0.12, 0.15, 0.02), [flat(0x333336), flat(0x333336), flat(0x333336), flat(0x333336), photoMat('calculator'), flat(0x333336)])) },
};

/** Define our own kinds (init) — basket, bag, props. */
export function defineOwnItems(game: Game) {
  const items = game.items;
  const small = (_child: Ent, def: ItemDef) => (def.slots ?? 1) <= 1 && (def.weight ?? 0.5) <= 2.6 && !def.container && !def.tags?.includes('furniture');
  if (!items.def('shopping_basket')) {
    const s = FALLBACKS.shopping_basket;
    items.define({
      kind: 'shopping_basket', name: s.name, weight: s.weight, carry: 'hand', tags: ['container', 'shop'], price: 35,
      build: () => build(s), container: { capacity: 8, accepts: small, layout: 'pile' }, hold: { pos: [0, -0.1, 0], scale: 0.8 },
    });
  }
  // the bag the keeper puts your shopping in ("ใส่ถุงไหมคะ")
  const bagKind = items.def('plastic_bag')?.container ? null : (items.def('plastic_bag') ? 'shop_bag' : 'plastic_bag');
  if (bagKind) {
    items.define({
      kind: bagKind, name: tl('ถุงก๊อบแก๊บ', 'plastic carrier bag'), weight: 0.02, carry: 'hand', tags: ['container', 'bag', 'shop'], price: 1,
      build: () => {
        const body = mesh(wobble(new THREE.SphereGeometry(0.5, 10, 8).scale(0.26, 0.3, 0.16).translate(0, 0.15, 0), 0.1, 7), mat('carrier', () => new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35, transparent: true, opacity: 0.82, side: THREE.DoubleSide })));
        const handles = mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI).translate(0, 0.3, 0), mat('carrier', () => new THREE.MeshStandardMaterial({ color: 0xf4f4f0 })));
        const contents = new THREE.Group(); contents.name = 'contents'; contents.position.y = 0.03;
        return group(body, handles, contents);
      },
      container: { capacity: 8, accepts: small, layout: 'pile' },
    });
  }
  (game as any)._shopBagKind = items.def('plastic_bag')?.container ? 'plastic_bag' : (bagKind ?? 'plastic_bag');
  for (const [kind, p] of Object.entries(PROPS)) {
    if (items.def(kind)) continue;
    items.define({ kind, name: p.name, weight: 0.1, noPickup: true, tags: ['prop'], build: () => p.make() });
  }
}

/** Define fallback kinds for every stock entry whose real kinds are missing (buildWorld — all inits are done). */
export function defineFallbacks(game: Game, needed: Set<string>) {
  for (const kind of needed) {
    if (game.items.def(kind)) continue;
    const s = FALLBACKS[kind];
    if (!s) continue;
    game.items.define({
      kind, name: s.name, weight: s.weight, slots: s.slots, carry: s.carry ?? 'hand', tags: [...(s.tags ?? []), 'shop_fallback'],
      data: s.data, build: () => build(s), fixed: (s.tags ?? []).includes('furniture') ? false : undefined,
    });
  }
}

/** Decorative copy of a fallback/prop shape (static stall dressing). */
export function buildShape(kind: string): THREE.Object3D | null {
  const s = FALLBACKS[kind];
  return s ? build(s) : null;
}
export { build as buildFallbackShape };
export type { FbSpec };
