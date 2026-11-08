import * as THREE from 'three';
import type { Game } from '../../game/game';
import { lathe, rbox, tube, merge, mesh, group, mat, plastic, pbr, flat } from '../restaurant/geo';
import { posterMaterial } from '../restaurant/menuposter';
import { libModel, libEntry, libInstanced } from '../world/lib';
import { F } from '../../core/fonts';
import { text3d } from '../../ui3d/text3d';
import { buildMeatTray, buildBasil, buildChiliBag, buildEggTray } from '../cooking/models';

/* =============================================================================================
 * BUILD — furniture models.
 *  - libFit(id, h): a shared-library model (Poly Haven CC0 photoscans / Sketchfab CC-BY imports / custom bpy
 *    builds) scaled to an exact real-world height, origin bottom centre, +Z forward.
 *  - custom Thai pieces built in code with bevels + PBR (docs/ART_STYLE.md §2 "Thai-specific objects are custom"):
 *    พัดลมตั้งพื้น / ติดผนัง (16" stand & wall fans, spinning blades, oscillating head), ตู้แช่เครื่องดื่ม (glass-door
 *    drinks fridge stocked with real bottle models), ตู้กับข้าว (aluminium & glass food display cabinet), หิ้งพระ
 *    (teak shrine shelf with garlands, candles and a gilded chedi), backlit menu lightbox (shows the live menu),
 *    โต๊ะพับโฟเมก้า (formica folding table on chromed legs).
 * ============================================================================================= */

/** Library model fitted to a target height (keeps proportions); `size` → independent axis fit [w, h, d].
 *  Whatever the source pivot (Poly Haven fans hang from their top, some scans sit off-centre), the model is
 *  re-centred from its real geometry bounds: bottom at y = 0, centred in x/z (+ optional z offset for wall pieces). */
export function libFit(id: string, h: number, o: { size?: [number, number, number]; yaw?: number; color?: number; y?: number; z?: number } = {}) {
  const outer = new THREE.Group();
  outer.name = 'fit:' + id;
  const inner = libModel(id, { color: o.color });
  if (o.yaw) inner.rotation.y = o.yaw;
  outer.add(inner);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  const fit = () => {
    const e = libEntry(id);
    if (!e || !inner.children.length) return false;
    // bounds of the filled model in inner space (children carry baked geometry, usually identity transforms)
    box.makeEmpty();
    inner.traverse((c: any) => {
      if (c === inner || !c.geometry) return;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      c.updateMatrix();
      tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrix);
      box.union(tmp);
    });
    if (box.isEmpty()) return false;
    const sz = box.getSize(new THREE.Vector3());
    const rot = Math.abs(Math.sin(o.yaw ?? 0)) > 0.7;
    if (o.size) inner.scale.set(o.size[0] / Math.max(1e-3, rot ? sz.z : sz.x), o.size[1] / Math.max(1e-3, sz.y), o.size[2] / Math.max(1e-3, rot ? sz.x : sz.z));
    else inner.scale.setScalar(h / Math.max(1e-3, sz.y));
    const c = box.getCenter(new THREE.Vector3());
    // centre (rotation about Y swaps x/z offsets)
    const cx = c.x * inner.scale.x, cz = c.z * inner.scale.z, cs = Math.cos(o.yaw ?? 0), sn = Math.sin(o.yaw ?? 0);
    inner.position.set(-(cx * cs + cz * sn), -box.min.y * inner.scale.y + (o.y ?? 0), -(-cx * sn + cz * cs) + (o.z ?? 0));
    return true;
  };
  if (!fit()) setTimeout(function retry() { if (!fit()) setTimeout(retry, 250); }, 250);
  return outer;
}

const D2 = THREE.DoubleSide;
const steel = () => pbr('stainless_brushed', { repeat: 1, rough: 0.45 });
const alu = () => pbr('aluminium_scratched', { repeat: 1, rough: 0.4 });
const chrome = () => pbr('chrome', { repeat: 1, rough: 0.18 });
const glass = (tint = 0xdfeef0, opacity = 0.18) => mat('glass:' + tint + opacity, () => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity, depthWrite: false, side: D2, envMapIntensity: 1.4 }));
const teak = () => pbr('wood_teak', { repeat: 1 });

// ------------------------------------------------------------------ fans

/** fan head (cage + 3 blades + motor), blades group named 'blades' (spins about local Z), facing +Z */
function fanHead(blade: number, body: number, R = 0.205) {
  const g = new THREE.Group();
  // rear cage: radial spokes + concentric rings (chromed wire)
  const wires: THREE.BufferGeometry[] = [];
  for (const [r, z] of [[R, 0.0], [R * 0.72, -0.045], [R * 0.42, -0.07]] as [number, number][]) {
    const t = new THREE.TorusGeometry(r, 0.0022, 4, 40); t.translate(0, 0, z); wires.push(t);
  }
  for (const [r, z] of [[R * 0.78, 0.05], [R * 0.5, 0.07], [R * 0.22, 0.078]] as [number, number][]) {
    const t = new THREE.TorusGeometry(r, 0.002, 4, 36); t.translate(0, 0, z); wires.push(t);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    wires.push(tube(new THREE.Vector3(c * R * 0.42, s * R * 0.42, -0.07), new THREE.Vector3(c * R, s * R, 0), 0.0016, 3));
    wires.push(tube(new THREE.Vector3(c * R, s * R, 0), new THREE.Vector3(c * R * 0.22, s * R * 0.22, 0.078), 0.0016, 3));
  }
  const rim = new THREE.TorusGeometry(R + 0.004, 0.006, 6, 48);
  g.add(mesh(merge([...wires.map((w) => w.toNonIndexed()), rim.toNonIndexed()]), chrome()));
  // front badge + motor housing behind the cage
  const badge = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24).rotateX(Math.PI / 2).translate(0, 0, 0.082);
  g.add(mesh(badge, flat(body, 0.35)));
  const motor = lathe([[0.0, -0.2], [0.045, -0.19], [0.065, -0.15], [0.07, -0.11], [0.06, -0.08], [0.03, -0.075]], 22);
  motor.rotateX(Math.PI / 2);
  g.add(mesh(motor, flat(body, 0.4)));
  // 3 translucent pitched blades (bevelled extrusion of a real 16" blade outline)
  const sh = new THREE.Shape();
  sh.moveTo(0.02, -0.012); sh.bezierCurveTo(0.09, -0.06, 0.17, -0.07, 0.185, -0.02); sh.bezierCurveTo(0.19, 0.03, 0.12, 0.06, 0.03, 0.02); sh.closePath();
  const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.002, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0012, bevelSegments: 1, curveSegments: 10 });
  const bm = mat('fanBlade:' + blade, () => new THREE.MeshStandardMaterial({ color: blade, roughness: 0.25, transparent: true, opacity: 0.72, side: D2 }));
  const blades = new THREE.Group(); blades.name = 'blades';
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(bg, bm); m.rotation.z = (i / 3) * Math.PI * 2; m.rotation.y = 0.32; m.castShadow = true; blades.add(m); }
  const hub = lathe([[0.0, 0.0], [0.03, 0.0], [0.032, 0.02], [0.02, 0.035], [0.0, 0.038]], 18); hub.rotateX(Math.PI / 2);
  blades.add(mesh(hub, flat(body, 0.35)));
  blades.position.z = 0.02;
  g.add(blades);
  return g;
}

/** 16" pedestal fan: round base with piano keys, telescopic pole, oscillating head ('head' group) */
export function standFan(body = 0xf2f0ea, blade = 0x4a8fd8) {
  const base = lathe([[0.17, 0], [0.175, 0.015], [0.16, 0.04], [0.06, 0.055], [0.03, 0.06]], 32);
  const keys: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) keys.push(rbox(0.024, 0.014, 0.05, 0.004, -0.042 + i * 0.028, 0.035, 0.11));
  const pole = tube(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.82, 0), 0.016, 12);
  const pole2 = tube(new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 1.12, 0), 0.012, 12);
  const collar = lathe([[0.024, 0.78], [0.026, 0.8], [0.024, 0.83]], 16);
  const yoke = rbox(0.06, 0.06, 0.08, 0.012, 0, 1.1, -0.03);
  const g = group(mesh(merge([base, collar, yoke]), flat(body, 0.45)), mesh(merge(keys), flat(0x3a6ab8, 0.4)), mesh(merge([pole]), flat(body, 0.35, 0.1)), mesh(pole2, chrome()));
  const head = fanHead(blade, body);
  head.name = 'head';
  head.position.set(0, 1.18, 0.02);
  g.add(head);
  return g;
}

/** wall fan on a bracket (origin bottom centre of the bracket plate at the wall, +Z out of the wall) */
export function wallFan(body = 0xf2f0ea, blade = 0x46a06a) {
  const plate = rbox(0.1, 0.16, 0.02, 0.006, 0, 0, 0.01);
  const arm = tube(new THREE.Vector3(0, 0.08, 0.02), new THREE.Vector3(0, 0.06, 0.16), 0.014, 10);
  const cord1 = tube(new THREE.Vector3(-0.03, 0.02, 0.2), new THREE.Vector3(-0.035, -0.32, 0.22), 0.0012, 3);
  const cord2 = tube(new THREE.Vector3(0.03, 0.02, 0.2), new THREE.Vector3(0.035, -0.42, 0.22), 0.0012, 3);
  const knob1 = new THREE.SphereGeometry(0.008, 8, 6).translate(-0.035, -0.33, 0.22), knob2 = new THREE.SphereGeometry(0.008, 8, 6).translate(0.035, -0.43, 0.22);
  const g = group(mesh(merge([plate, arm]), flat(body, 0.45)), mesh(merge([cord1, cord2]), flat(0xe8e2d0, 0.8)), mesh(merge([knob1, knob2]), flat(0xd04030, 0.4)));
  const head = fanHead(blade, body);
  head.name = 'head';
  head.position.set(0, 0.08, 0.26);
  head.rotation.x = 0.22;
  g.add(head);
  g.position.y = 0;
  return g;
}

/** spin blades + oscillate (shared animate for stand / wall / ceiling fans) */
export function animateFan(o: THREE.Object3D, dt: number, on: boolean, osc = true) {
  const u = o.userData as any;
  u.spd = (u.spd ?? 0) + ((on ? 26 : 0) - (u.spd ?? 0)) * Math.min(1, dt * 1.2);
  u.t = (u.t ?? Math.random() * 10) + dt;
  const b = u.blades ?? (u.blades = o.getObjectByName('blades'));
  if (b) b.rotation.z += u.spd * dt;
  const h = u.head ?? (u.head = o.getObjectByName('head'));
  if (h && osc && on) h.rotation.y = Math.sin(u.t * 0.35) * 0.7;
  const r = u.rotor ?? (u.rotor = o.getObjectByName('rotor'));
  if (r) r.rotation.y += u.spd * 0.35 * dt;
}

// ------------------------------------------------------------------ fridge

let fridgeSign: THREE.Texture | null = null;
function signTexture() {
  if (fridgeSign) return fridgeSign;
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d')!;
  const grd = x.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, '#d8262a'); grd.addColorStop(1, '#a8141a');
  x.fillStyle = grd; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff4e0'; x.font = `800 74px ${F.heavy}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('เย็นเจี๊ยบ!', 256, 58);
  x.font = `600 22px ${F.ui}`; x.fillText('ICE COLD · แช่เย็นทุกขวด', 256, 108);
  fridgeSign = new THREE.CanvasTexture(c); fridgeSign.colorSpace = THREE.SRGBColorSpace; fridgeSign.anisotropy = 8;
  // fonts may arrive later: redraw once
  (document as any).fonts?.ready?.then(() => { x.fillStyle = grd; x.fillRect(0, 0, 512, 128); x.fillStyle = '#fff4e0'; x.font = `800 74px ${F.heavy}`; x.fillText('เย็นเจี๊ยบ!', 256, 58); x.font = `600 22px ${F.ui}`; x.fillText('ICE COLD · แช่เย็นทุกขวด', 256, 108); fridgeSign!.needsUpdate = true; });
  return fridgeSign;
}

/** single glass-door beverage cooler (0.6 × 1.85 × 0.62 m), stocked with real bottle models, lit inside */
export function drinksFridge() {
  const W = 0.6, H = 1.85, Dp = 0.62;
  const white = pbr('metal_painted_chipped', { repeat: 1, color: 0xeeeeea, rough: 0.5 });
  const body = merge([
    rbox(W, 0.1, Dp, 0.02, 0, 0, 0),                 // plinth (grille)
    rbox(0.04, H - 0.32, Dp, 0.012, -W / 2 + 0.02, 0.1, 0), rbox(0.04, H - 0.32, Dp, 0.012, W / 2 - 0.02, 0.1, 0),
    rbox(W, 0.04, Dp, 0.012, 0, 0.1, 0), rbox(W, 0.04, Dp, 0.012, 0, H - 0.26, 0), rbox(W, H - 0.3, 0.03, 0.01, 0, 0.12, -Dp / 2 + 0.015),
  ]);
  const g = group(mesh(body, white));
  const grille: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) grille.push(rbox(W - 0.08, 0.006, 0.01, 0.002, 0, 0.02 + i * 0.009, Dp / 2 + 0.002));
  g.add(mesh(merge(grille), flat(0x2a2a2c, 0.6)));
  // lit header sign
  // red header box + the lit sign as a front decal plane
  const sign = new THREE.Mesh(rbox(W, 0.22, Dp + 0.01, 0.02, 0, H - 0.22, 0.005), flat(0xb81a20, 0.4));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, 0.2), mat('fridgeSignFace', () => new THREE.MeshStandardMaterial({ map: signTexture(), emissiveMap: signTexture(), emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.3 })));
  face.position.set(0, H - 0.11, Dp / 2 + 0.012);
  g.add(sign, face);
  // interior: back panel (white, glowing), wire shelves, bottles (instanced library models)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, H - 0.4), mat('fridgeBack', () => new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xdfeeff, emissiveIntensity: 0.35, roughness: 0.6 })));
  back.position.set(0, 0.14 + (H - 0.4) / 2, -Dp / 2 + 0.035);
  g.add(back);
  const shelves: THREE.BufferGeometry[] = [];
  const ys = [0.16, 0.5, 0.84, 1.18];
  for (const y of ys) {
    for (let i = 0; i < 9; i++) shelves.push(tube(new THREE.Vector3(-W / 2 + 0.05, y, -Dp / 2 + 0.06 + i * 0.055), new THREE.Vector3(W / 2 - 0.05, y, -Dp / 2 + 0.06 + i * 0.055), 0.0025, 3));
    shelves.push(tube(new THREE.Vector3(-W / 2 + 0.05, y + 0.03, Dp / 2 - 0.06), new THREE.Vector3(W / 2 - 0.05, y + 0.03, Dp / 2 - 0.06), 0.003, 3));
  }
  g.add(mesh(merge(shelves), chrome()));
  const kinds = ['bottle_beer_chang', 'bottle_beer_leo', 'bottle_beer_singha', 'bottle_fanta_red'];
  ys.forEach((y, row) => {
    const ms: THREE.Matrix4[] = [];
    for (let c = 0; c < 6; c++) for (let d = 0; d < 3; d++) ms.push(new THREE.Matrix4().makeTranslation(-W / 2 + 0.07 + c * 0.093, y + 0.004, -Dp / 2 + 0.11 + d * 0.15));
    g.add(libInstanced(kinds[row % kinds.length], ms, { shadow: false }));
  });
  // door: chrome frame + glass + vertical handle
  const door = new THREE.Group(); door.name = 'door';
  const fr = merge([rbox(0.035, H - 0.36, 0.03, 0.008, -W / 2 + 0.018, 0.12, 0), rbox(0.035, H - 0.36, 0.03, 0.008, W / 2 - 0.018, 0.12, 0), rbox(W, 0.05, 0.03, 0.01, 0, 0.12, 0), rbox(W, 0.05, 0.03, 0.01, 0, H - 0.29, 0)]);
  door.add(mesh(fr, alu()));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.07, H - 0.46), glass(0xe8f6ff, 0.16)); pane.position.set(0, 0.17 + (H - 0.46) / 2, 0); pane.castShadow = false;
  door.add(pane);
  door.add(mesh(tube(new THREE.Vector3(W / 2 - 0.06, 0.6, 0.03), new THREE.Vector3(W / 2 - 0.06, 1.3, 0.03), 0.011, 10), chrome()));
  door.position.z = Dp / 2;
  g.add(door);
  return g;
}

// ------------------------------------------------------------------ ตู้กับข้าว

/** floor-standing aluminium & glass food display cabinet (0.9 × 1.5 × 0.5) on a white base */
export function foodCabinet() {
  const W = 0.9, H = 1.5, Dp = 0.5, base = 0.72;
  const g = new THREE.Group();
  const white = pbr('metal_painted_chipped', { repeat: 1, color: 0xf0eee8, rough: 0.55 });
  g.add(mesh(merge([rbox(W, base, Dp, 0.015, 0, 0, 0), rbox(W + 0.02, 0.025, Dp + 0.02, 0.008, 0, base, 0)]), white));
  // sliding doors on the base (two panels, handles)
  g.add(mesh(merge([rbox(W / 2 - 0.02, base - 0.08, 0.01, 0.004, -W / 4, 0.04, Dp / 2 + 0.004), rbox(W / 2 - 0.02, base - 0.08, 0.01, 0.004, W / 4, 0.04, Dp / 2 + 0.012)]), flat(0xe6e2da, 0.45)));
  g.add(mesh(merge([rbox(0.012, 0.12, 0.012, 0.004, -0.06, base / 2, Dp / 2 + 0.014), rbox(0.012, 0.12, 0.012, 0.004, 0.06, base / 2, Dp / 2 + 0.022)]), chrome()));
  // aluminium frame of the glass box
  const y0 = base + 0.025, h = H - y0;
  const edges: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) edges.push(rbox(0.025, h, 0.025, 0.004, x * (W / 2 - 0.0125), y0, z * (Dp / 2 - 0.0125)));
  for (const y of [y0, y0 + h * 0.5, H - 0.025]) { edges.push(rbox(W, 0.025, 0.025, 0.004, 0, y, Dp / 2 - 0.0125), rbox(W, 0.025, 0.025, 0.004, 0, y, -Dp / 2 + 0.0125), rbox(0.025, 0.025, Dp, 0.004, -W / 2 + 0.0125, y, 0), rbox(0.025, 0.025, Dp, 0.004, W / 2 - 0.0125, y, 0)); }
  g.add(mesh(merge(edges), alu()));
  // glass panes + mid shelf
  const gl = glass(0xe4f2f0, 0.15);
  const panes: [number, number, number, number, number][] = [[0, y0 + h / 2, Dp / 2 - 0.012, W - 0.04, 0], [0, y0 + h / 2, -Dp / 2 + 0.012, W - 0.04, 0], [-W / 2 + 0.012, y0 + h / 2, 0, Dp - 0.04, Math.PI / 2], [W / 2 - 0.012, y0 + h / 2, 0, Dp - 0.04, Math.PI / 2]];
  for (const [x, y, z, w, ry] of panes) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h - 0.04), gl); p.position.set(x, y, z); p.rotation.y = ry; p.castShadow = false; g.add(p); }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, Dp - 0.04), gl); top.rotation.x = -Math.PI / 2; top.position.y = H - 0.012; g.add(top);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.05, 0.006, Dp - 0.05), glass(0xd8eeea, 0.28)); shelf.position.y = y0 + h * 0.5 + 0.012; g.add(shelf);
  // what's inside: the cook's mise en place with the REAL ingredient models of the cooking module (photo-real
  // minced pork / shrimp trays, basil bunch, chilies, an egg tray, limes) on steel trays
  const trays: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) trays.push(rbox(0.26, 0.012, 0.3, 0.004, -0.28 + i * 0.28, y0 + 0.004, 0));
  for (let i = 0; i < 2; i++) trays.push(rbox(0.32, 0.012, 0.3, 0.004, -0.18 + i * 0.36, y0 + h * 0.5 + 0.02, 0));
  g.add(mesh(merge(trays), steel()));
  const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, s = 1) => { o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); o.traverse((c: any) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; } }); g.add(o); };
  const lower = y0 + 0.016, upper = y0 + h * 0.5 + 0.032;
  put(buildMeatTray('pork_minced'), -0.28, lower, 0.02, 0.1, 1.1);
  put(buildMeatTray('shrimp'), 0, lower, -0.01, -0.08, 1.1);
  put(buildMeatTray('pork_sliced'), 0.28, lower, 0.02, 0.05, 1.1);
  put(buildBasil(), -0.2, upper, 0.0, 0.4);
  put(buildChiliBag(), -0.06, upper, 0.04, -0.3);
  put(buildEggTray(), 0.18, upper, 0.0, 0.0, 0.9);
  return g;
}

// ------------------------------------------------------------------ หิ้งพระ

/** teak wall shrine shelf (origin bottom centre at the wall): carved brackets, red velvet valance, gilded chedi,
 *  marigold & jasmine garlands, vases of flowers, two candles (flames named 'flame'), incense bowl */
export function shrineShelf() {
  const W = 0.8, Dp = 0.32;
  const g = new THREE.Group();
  const tk = teak();
  // shelf board + back board with a pointed (chofa) crest
  g.add(mesh(merge([rbox(W, 0.035, Dp, 0.008, 0, 0.18, Dp / 2), rbox(W, 0.42, 0.025, 0.008, 0, 0.18, 0.0125)]), tk));
  const crest = new THREE.Shape(); crest.moveTo(-W / 2, 0); crest.lineTo(W / 2, 0); crest.lineTo(W / 2 - 0.05, 0.06); crest.quadraticCurveTo(0.1, 0.07, 0, 0.16); crest.quadraticCurveTo(-0.1, 0.07, -W / 2 + 0.05, 0.06); crest.closePath();
  const cg = new THREE.ExtrudeGeometry(crest, { depth: 0.022, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  cg.translate(0, 0.6, 0.002);
  g.add(mesh(cg, pbr('brass_gold', { repeat: 1, rough: 0.35 })));
  // carved brackets
  const br = new THREE.Shape(); br.moveTo(0, 0); br.lineTo(0, 0.18); br.lineTo(0.2, 0.18); br.quadraticCurveTo(0.05, 0.12, 0, 0);
  const bg = new THREE.ExtrudeGeometry(br, { depth: 0.03, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  bg.rotateY(-Math.PI / 2);
  const b1 = bg.clone().translate(-W / 2 + 0.08, 0, 0.0), b2 = bg.clone().translate(W / 2 - 0.05, 0, 0.0);
  g.add(mesh(merge([b1, b2]), tk));
  // red velvet valance with gold fringe
  g.add(mesh(rbox(W + 0.02, 0.08, 0.008, 0.003, 0, 0.11, Dp + 0.004), pbr('velvet_red', { repeat: 1 })));
  g.add(mesh(rbox(W + 0.02, 0.012, 0.01, 0.003, 0, 0.1, Dp + 0.008), pbr('brass_gold', { repeat: 1, rough: 0.4 })));
  // gilded chedi in the middle
  const chedi = lathe([[0.07, 0], [0.07, 0.03], [0.055, 0.035], [0.06, 0.07], [0.045, 0.1], [0.05, 0.13], [0.03, 0.17], [0.018, 0.22], [0.006, 0.28], [0, 0.3]], 20);
  const cm = mesh(chedi, pbr('brass_gold', { repeat: 1, rough: 0.25 })); cm.position.set(0, 0.215, Dp * 0.45); g.add(cm);
  // vases with flowers, candles, incense bowl, garlands
  for (const x of [-0.26, 0.26]) {
    const v = mesh(lathe([[0.025, 0], [0.035, 0.03], [0.02, 0.08], [0.028, 0.11], [0.0, 0.11]], 14), pbr('brass_gold', { repeat: 1, rough: 0.3 }));
    v.position.set(x, 0.215, Dp * 0.5); g.add(v);
    const fl: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) fl.push(new THREE.IcosahedronGeometry(0.018, 0).translate(x + Math.cos(i * 0.9) * 0.025, 0.36 + (i % 3) * 0.02, Dp * 0.5 + Math.sin(i * 0.9) * 0.025));
    g.add(mesh(merge(fl.map((f) => f.toNonIndexed())), flat(0xf0a020, 0.7)));
  }
  for (const x of [-0.14, 0.14]) {
    const cnd = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10).translate(x, 0.26, Dp * 0.6), flat(0xf4eee0, 0.6)); g.add(cnd);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6).scale(1, 2.2, 1).translate(x, 0.32, Dp * 0.6), mat('flame', () => new THREE.MeshBasicMaterial({ color: 0xffb040 })));
    flame.name = 'flame'; g.add(flame);
  }
  const bowl = mesh(lathe([[0.0, 0], [0.04, 0.0], [0.05, 0.03], [0.045, 0.035], [0.0, 0.03]], 16), pbr('brass_gold', { repeat: 1, rough: 0.4 }));
  bowl.position.set(0.07, 0.215, Dp * 0.75); g.add(bowl);
  const sticks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) sticks.push(tube(new THREE.Vector3(0.07 + (i - 1) * 0.01, 0.24, Dp * 0.75), new THREE.Vector3(0.07 + (i - 1) * 0.02, 0.38, Dp * 0.75 + 0.01), 0.0015, 3));
  g.add(mesh(merge(sticks), flat(0xb03a2a, 0.8)));
  // marigold garlands draped along the front edge
  const gar: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 26; i++) { const t = i / 26; gar.push(new THREE.IcosahedronGeometry(0.014, 0).translate(-W / 2 + 0.04 + t * (W - 0.08), 0.2 - Math.sin(t * Math.PI * 2) ** 2 * 0.05, Dp + 0.015).toNonIndexed()); }
  g.add(mesh(merge(gar), flat(0xf08a10, 0.75)));
  return g;
}
export function animateCandles(o: THREE.Object3D, t: number) {
  o.traverse((c) => { if (c.name === 'flame') { c.scale.y = 1 + Math.sin(t * 13 + c.position.x * 40) * 0.15; } });
}

// ------------------------------------------------------------------ menu lightbox

/** backlit aluminium menu lightbox for the wall (1.2 × 0.8): shows the live menu poster */
export function menuLightbox(game: Game) {
  const W = 1.2, H = 0.8;
  const g = new THREE.Group();
  const frame = merge([rbox(W, H, 0.09, 0.02, 0, 0, 0.045)]);
  g.add(mesh(frame, alu()));
  const pm = posterMaterial(game) as THREE.MeshStandardMaterial;
  const lit = mat('lightboxFace', () => { const m = pm.clone(); m.emissive = new THREE.Color(0xffffff); m.emissiveMap = pm.map; m.emissiveIntensity = 0.55; return m; });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.06), lit);
  face.position.set(0, H / 2, 0.092);
  g.add(face);
  // keep the lit copy in sync when the poster redraws
  (g.userData as any).sync = () => { if (lit.map !== pm.map) { lit.map = pm.map; lit.emissiveMap = pm.map; lit.needsUpdate = true; } };
  return g;
}

// ------------------------------------------------------------------ formica folding table

/** โต๊ะพับขาเหล็ก: wood-grain formica top with a chrome edge band, folding chromed legs (0.9 × 0.6, 0.72 h) */
export function formicaTable() {
  const W = 0.9, Dp = 0.6, H = 0.72;
  const top = rbox(W, 0.022, Dp, 0.006, 0, H - 0.022, 0);
  const edge = merge([rbox(W + 0.006, 0.026, 0.006, 0.002, 0, H - 0.024, Dp / 2), rbox(W + 0.006, 0.026, 0.006, 0.002, 0, H - 0.024, -Dp / 2), rbox(0.006, 0.026, Dp, 0.002, W / 2, H - 0.024, 0), rbox(0.006, 0.026, Dp, 0.002, -W / 2, H - 0.024, 0)]);
  const legs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.08);
    legs.push(tube(new THREE.Vector3(x, 0.01, -Dp / 2 + 0.06), new THREE.Vector3(x, H - 0.03, -Dp / 2 + 0.08), 0.013, 8));
    legs.push(tube(new THREE.Vector3(x, 0.01, Dp / 2 - 0.06), new THREE.Vector3(x, H - 0.03, Dp / 2 - 0.08), 0.013, 8));
    legs.push(tube(new THREE.Vector3(x, 0.12, -Dp / 2 + 0.065), new THREE.Vector3(x, 0.12, Dp / 2 - 0.065), 0.008, 6));
    for (const z of [-Dp / 2 + 0.06, Dp / 2 - 0.06]) legs.push(new THREE.CylinderGeometry(0.016, 0.018, 0.02, 10).translate(x, 0.01, z));
  }
  legs.push(tube(new THREE.Vector3(-W / 2 + 0.08, H - 0.05, 0), new THREE.Vector3(W / 2 - 0.08, H - 0.05, 0), 0.01, 6));
  return group(mesh(top, pbr('wood_teak', { repeat: 0.8, rough: 0.35 })), mesh(edge, chrome()), mesh(merge(legs.map((l) => l.toNonIndexed())), chrome()));
}

/** tinted plastic for coloured accents (re-exported for the catalog) */
export { plastic };

// ------------------------------------------------------------------ the STAFF ONLY door

/** A plain, slightly-too-normal back door (0.86 × 2.05): spotless beige leaf with two shallow panels, brushed
 *  lever handle, kick plate, door closer, engraved "STAFF ONLY / ห้องเก็บของ" plate, and a thin warm glow leaking
 *  under it. Origin = bottom centre on the wall face, +Z out of the wall. */
export function staffDoor() {
  const W = 0.86, H = 2.05;
  const g = new THREE.Group();
  const paint = pbr('wood_painted_weathered', { repeat: 0.6, color: 0xe2d8c0, rough: 0.55 });
  const trim = pbr('plaster_painted_clean', { repeat: 0.5, color: 0xf2eee4 });
  // architrave (frame) proud of the wall
  g.add(mesh(merge([rbox(0.08, H + 0.08, 0.05, 0.01, -W / 2 - 0.04, 0, 0.025), rbox(0.08, H + 0.08, 0.05, 0.01, W / 2 + 0.04, 0, 0.025), rbox(W + 0.16, 0.08, 0.05, 0.01, 0, H, 0.025)]), trim));
  // the leaf, set 1 cm into the frame, a 1.5 cm gap at the floor
  const leaf = new THREE.Group();
  leaf.add(mesh(rbox(W - 0.02, H - 0.025, 0.04, 0.006, 0, 0.015, 0.02), paint));
  leaf.add(mesh(merge([rbox(W - 0.22, 0.7, 0.008, 0.004, 0, 1.18, 0.042), rbox(W - 0.22, 0.85, 0.008, 0.004, 0, 0.2, 0.042)]), pbr('wood_painted_weathered', { repeat: 0.6, color: 0xd9cfb6, rough: 0.5 })));
  leaf.add(mesh(rbox(W - 0.06, 0.18, 0.004, 0.002, 0, 0.03, 0.043), pbr('aluminium_scratched', { repeat: 1, rough: 0.35 })));
  // lever handle + rose + lock
  const lever = merge([new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20).rotateX(Math.PI / 2).translate(W / 2 - 0.1, 1.02, 0.047), tube(new THREE.Vector3(W / 2 - 0.1, 1.02, 0.05), new THREE.Vector3(W / 2 - 0.1, 1.02, 0.1), 0.009, 10), tube(new THREE.Vector3(W / 2 - 0.1, 1.02, 0.1), new THREE.Vector3(W / 2 - 0.24, 1.02, 0.1), 0.009, 10), new THREE.CylinderGeometry(0.015, 0.015, 0.012, 16).rotateX(Math.PI / 2).translate(W / 2 - 0.1, 0.92, 0.047)]);
  leaf.add(mesh(lever, pbr('stainless_brushed', { repeat: 1, rough: 0.3 })));
  // door closer arm at the top
  leaf.add(mesh(merge([rbox(0.26, 0.05, 0.05, 0.01, W / 2 - 0.22, H - 0.13, 0.065), tube(new THREE.Vector3(W / 2 - 0.12, H - 0.1, 0.09), new THREE.Vector3(W / 2 - 0.36, H - 0.05, 0.1), 0.008, 6)]), flat(0x8a8a86, 0.45, 0.6)));
  g.add(leaf);
  // engraved plate (brushed aluminium) + the text
  const plate = mesh(rbox(0.26, 0.09, 0.006, 0.004, 0, 1.5, 0.045), pbr('aluminium_scratched', { repeat: 1, rough: 0.3 }));
  g.add(plate);
  const t1 = text3d('STAFF ONLY', { font: 'heavy', size: 0.024, color: 0x1a1a1a, side: 0x0a0a0a, align: 'center', depth: 0.06, castShadow: false });
  const t2 = text3d('ห้องเก็บของ', { font: 'ui', size: 0.02, color: 0x1a1a1a, side: 0x0a0a0a, align: 'center', depth: 0.06, castShadow: false });
  t1.position.set(0, 1.562, 0.05); t2.position.set(0, 1.518, 0.05);
  g.add(t1, t2);
  // the light under the door: a thin, warm, slightly-wrong yellow
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, 0.015), mat('doorGlow', () => new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 })));
  glow.position.set(0, 0.009, 0.041); glow.name = 'glow';
  g.add(glow);
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, 0.32).rotateX(-Math.PI / 2), mat('doorSpill', () => new THREE.MeshBasicMaterial({ color: 0xffd870, transparent: true, opacity: 0.14, depthWrite: false })));
  spill.position.set(0, 0.004, 0.2); spill.renderOrder = 2;
  g.add(spill);
  return g;
}
