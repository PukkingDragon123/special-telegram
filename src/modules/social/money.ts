import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { GEN } from './fx';

/* ============================================================================================
 * THAI MONEY, 3D — coins (5 ฿, 10 ฿ bimetal) and banknotes (20 green / 50 blue / 100 red) with
 * real photo textures (public/assets/gen/social/money/, sources in references/credits/social.md).
 * Only temple / numeral / guilloche areas of real notes and coins are used (no portraits,
 * no royal emblems — brief §4). Real sizes in metres; callers scale for UI use.
 * Other modules may reuse: (game as any).social.money(amount) → THREE.Group (origin = centre).
 * ========================================================================================== */

export const AMOUNTS = [5, 10, 20, 50, 100] as const;
export type Amount = (typeof AMOUNTS)[number];

const DIR = GEN + 'money/';

function tex(file: string) {
  const t = Assets.texture(DIR + file, { wrap: false });
  t.anisotropy = 8;
  return t;
}

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}

// ------------------------------------------------------------------ coins

const COIN: Record<number, { d: number; t: number; face: string; edgeColor: number; metal: number; rough: number }> = {
  5: { d: 0.024, t: 0.0026, face: 'coin5.jpg', edgeColor: 0xc9c4bb, metal: 0.9, rough: 0.38 },
  10: { d: 0.026, t: 0.00215, face: 'coin10.jpg', edgeColor: 0xd8c27a, metal: 0.9, rough: 0.34 },
};

const coinGeo = new Map<number, { face: THREE.BufferGeometry; edge: THREE.BufferGeometry }>();
function coinGeometry(v: number) {
  let g = coinGeo.get(v);
  if (g) return g;
  const c = COIN[v];
  const r = c.d / 2, h = c.t;
  // faces: a disc with a raised rim (slight dome) — UVs map the photo disc
  const face = new THREE.CircleGeometry(r * 0.985, 40);
  const pos = face.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const rr = Math.hypot(x, y) / r;
    pos.setZ(i, (rr > 0.9 ? 0.00025 : 0.00008 * (1 - rr * rr)));
  }
  face.computeVertexNormals();
  // edge: reeded cylinder band with a rounded lip (Lathe)
  const lip = 0.0004;
  const edge = new THREE.LatheGeometry([new THREE.Vector2(r * 0.97, -h / 2), new THREE.Vector2(r, -h / 2 + lip), new THREE.Vector2(r, h / 2 - lip), new THREE.Vector2(r * 0.97, h / 2)], 48);
  g = { face, edge };
  coinGeo.set(v, g);
  return g;
}

export function buildCoin(v: 5 | 10) {
  const c = COIN[v];
  const g = coinGeometry(v);
  const faceMat = mat('coinface' + v, () => new THREE.MeshStandardMaterial({ map: tex(c.face), metalness: c.metal, roughness: c.rough, envMapIntensity: 1.3 }));
  const edgeMat = mat('coinedge' + v, () => {
    const m = Assets.pbr(v === 10 ? 'brass_gold' : 'aluminium_scratched', { repeat: [8, 0.2] }).clone();
    m.color = new THREE.Color(c.edgeColor);
    return m;
  });
  const grp = new THREE.Group();
  grp.name = 'coin' + v;
  const top = new THREE.Mesh(g.face, faceMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = c.t / 2;
  const bot = new THREE.Mesh(g.face, faceMat);
  bot.rotation.x = Math.PI / 2;
  bot.rotation.z = 2.1;
  bot.position.y = -c.t / 2;
  const edge = new THREE.Mesh(g.edge, edgeMat);
  grp.add(top, bot, edge);
  grp.userData.size = c.d;
  return grp;
}

// ------------------------------------------------------------------ banknotes

const NOTE: Record<number, { w: number; h: number; file: string; tint: number }> = {
  20: { w: 0.138, h: 0.072, file: 'note20.jpg', tint: 0x6f9a62 },
  50: { w: 0.144, h: 0.072, file: 'note50.jpg', tint: 0x5f7fb0 },
  100: { w: 0.150, h: 0.072, file: 'note100.jpg', tint: 0xc0584c },
};

const noteGeo = new Map<number, THREE.BufferGeometry>();
function noteGeometry(v: number) {
  let g = noteGeo.get(v);
  if (g) return g;
  const n = NOTE[v];
  g = new THREE.PlaneGeometry(n.w, n.h, 12, 4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // soft centre fold + slight curl (paper money is never flat)
    const fx = x / (n.w / 2);
    pos.setZ(i, -Math.abs(fx) * 0.004 + Math.pow(fx, 2) * 0.006 + Math.sin(y * 40 + x * 13) * 0.0004);
  }
  g.computeVertexNormals();
  noteGeo.set(v, g);
  return g;
}

export function buildNote(v: 20 | 50 | 100) {
  const n = NOTE[v];
  const front = mat('notef' + v, () => new THREE.MeshStandardMaterial({ map: tex(n.file), roughness: 0.78, metalness: 0, side: THREE.FrontSide }));
  const back = mat('noteb' + v, () => {
    const t = tex(n.file).clone();
    t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1;
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0, side: THREE.BackSide, color: 0xe8e8e8 });
  });
  const grp = new THREE.Group();
  grp.name = 'note' + v;
  const g = noteGeometry(v);
  grp.add(new THREE.Mesh(g, front), new THREE.Mesh(g, back));
  grp.userData.size = n.w;
  return grp;
}

export function buildMoney(amount: number): THREE.Group {
  if (amount === 5 || amount === 10) return buildCoin(amount);
  if (amount === 20 || amount === 50 || amount === 100) return buildNote(amount);
  // any other amount: a little fan of notes + coins
  const g = new THREE.Group();
  let left = Math.round(amount), i = 0;
  for (const v of [100, 50, 20, 10, 5] as const) {
    while (left >= v && i < 6) {
      const m = buildMoney(v);
      m.position.set(i * 0.012, i * 0.002, -i * 0.006);
      m.rotation.z = i * 0.18;
      g.add(m);
      left -= v; i++;
    }
  }
  if (!g.children.length) g.add(buildCoin(5));
  return g;
}

/** Thai label for an amount. */
export function moneyLabel(v: number) {
  return v <= 10 ? `เหรียญ ${v} บาท` : `แบงก์ ${v}`;
}
