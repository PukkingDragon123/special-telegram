import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { tl } from '../../core/util';
import { lifeTex } from './tex';

/* ============================================================================================
 * life item kinds: dog_food (real product bag photo), garland (พวงมาลัย, real photo),
 * flashlight (ไฟฉาย — shines at ghosts; a real spot light at night), amulet (เหรียญพระ —
 * ghosts keep their distance). Shops may stock them; the homeless man gifts some.
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
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.17, 10), photoMat('flashlight_body.jpg', '#1d1d1f', { roughness: 0.4, metalness: 0.5 }));
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
