import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../game/game';
import { tl } from '../../core/util';

/* ============================================================================================
 * Hand props for the combat module (built procedurally, shared geometry/materials):
 *   cb_pistol  — a generic compact polymer-frame pistol (no brand, no markings)
 *   cb_slipper — the auntie's foam slipper (the weapon of choice)
 *   cb_phone   — a bystander filming the fight
 * Registered as item kinds so npc entities can show them with `hold`; never spawned as items.
 * Model space: origin at the grip/hand, +Z = forward (the barrel / where the hand points).
 * ========================================================================================== */

let pistolGeo: { frame: THREE.BufferGeometry; slide: THREE.BufferGeometry; metal: THREE.BufferGeometry } | null = null;
let mats: Record<string, THREE.Material> | null = null;

function M() {
  return (mats ??= {
    polymer: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.62, metalness: 0.05 }),
    slide: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.32, metalness: 0.75 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.28, metalness: 0.9 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x2f63b8, roughness: 0.85 }),
    sole2: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 }),
    strap: new THREE.MeshStandardMaterial({ color: 0xc8423a, roughness: 0.7 }),
    phone: new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.25, metalness: 0.4 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.1, metalness: 0.1, emissive: new THREE.Color(0x6f8fb8), emissiveIntensity: 0.55 }),
  });
}

function pistolGeometry() {
  if (pistolGeo) return pistolGeo;
  const parts = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  // frame: dust cover + trigger guard + grip (raked back ~18°)
  const dust = new RoundedBoxGeometry(0.03, 0.022, 0.13, 2, 0.006).translate(0, 0.045, 0.045);
  const grip = new RoundedBoxGeometry(0.03, 0.105, 0.05, 2, 0.008).rotateX(-0.32).translate(0, -0.015, -0.012);
  const guard = new THREE.TorusGeometry(0.019, 0.004, 5, 12, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(0, 0.03, 0.03);
  const mag = new RoundedBoxGeometry(0.026, 0.012, 0.046, 1, 0.003).rotateX(-0.32).translate(0, -0.07, -0.03);
  // slide: long block with rear serrations and sights
  const slide = new RoundedBoxGeometry(0.028, 0.03, 0.18, 2, 0.005).translate(0, 0.072, 0.04);
  const ser: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) ser.push(new THREE.BoxGeometry(0.0295, 0.022, 0.0025).translate(0, 0.072, -0.03 + i * 0.006));
  const sightF = new THREE.BoxGeometry(0.004, 0.006, 0.006).translate(0, 0.09, 0.125);
  const sightR = new THREE.BoxGeometry(0.02, 0.007, 0.006).translate(0, 0.09, -0.04);
  // metal: barrel crown, trigger, slide release
  const barrel = new THREE.CylinderGeometry(0.0065, 0.0065, 0.01, 10).rotateX(Math.PI / 2).translate(0, 0.074, 0.13);
  const bore = new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 10).rotateX(Math.PI / 2).translate(0, 0.074, 0.131);
  const trig = new THREE.BoxGeometry(0.006, 0.02, 0.006).rotateX(0.25).translate(0, 0.028, 0.03);
  pistolGeo = { frame: parts([dust, grip, guard, mag]), slide: parts([slide, ...ser, sightF, sightR]), metal: parts([barrel, bore, trig]) };
  return pistolGeo;
}

export function pistolModel(): THREE.Group {
  const g = new THREE.Group();
  const G = pistolGeometry(), m = M();
  g.add(new THREE.Mesh(G.frame, m.polymer), new THREE.Mesh(G.slide, m.slide), new THREE.Mesh(G.metal, m.metal));
  g.userData.muzzle = new THREE.Vector3(0, 0.074, 0.14);
  return g;
}

let slipperGeo: THREE.BufferGeometry[] | null = null;
export function slipperModel(): THREE.Group {
  const m = M();
  if (!slipperGeo) {
    const shape = new THREE.Shape();
    // foot outline (toe at +y), 26 cm long
    shape.moveTo(0, -0.13);
    shape.bezierCurveTo(0.042, -0.13, 0.046, -0.06, 0.04, 0.0);
    shape.bezierCurveTo(0.036, 0.06, 0.05, 0.1, 0.03, 0.125);
    shape.bezierCurveTo(0.012, 0.138, -0.03, 0.135, -0.04, 0.11);
    shape.bezierCurveTo(-0.05, 0.06, -0.036, 0.0, -0.04, -0.06);
    shape.bezierCurveTo(-0.044, -0.12, -0.03, -0.13, 0, -0.13);
    const top = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 10 }).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
    const bottom = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2);
    const strap = new THREE.TorusGeometry(0.03, 0.009, 6, 14, Math.PI).rotateY(Math.PI / 2).scale(1, 0.9, 1).translate(0, 0.026, 0.035);
    slipperGeo = [top, bottom, strap];
  }
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.add(new THREE.Mesh(slipperGeo[0], m.sole2), new THREE.Mesh(slipperGeo[1], m.sole), new THREE.Mesh(slipperGeo[2], m.strap));
  // held by the heel, sole facing forward like a raised paddle
  s.rotation.set(-1.2, 0, 0);
  s.position.set(0, 0.02, 0.06);
  g.add(s);
  return g;
}

let phoneGeo: THREE.BufferGeometry[] | null = null;
export function phoneModel(): THREE.Group {
  const m = M();
  phoneGeo ??= [new RoundedBoxGeometry(0.072, 0.15, 0.009, 2, 0.006), new THREE.PlaneGeometry(0.064, 0.138).translate(0, 0, 0.0047)];
  const g = new THREE.Group();
  const p = new THREE.Group();
  const body = new THREE.Mesh(phoneGeo[0], m.phone), scr = new THREE.Mesh(phoneGeo[1], m.screen);
  // screen faces the holder, camera faces the fight (forward)
  scr.rotation.y = Math.PI;
  p.add(body, scr);
  p.position.set(0, 0.06, 0.05);
  g.add(p);
  return g;
}

/** Register the hand props as item kinds (npc `hold` builds them through the item system). */
export function defineProps(game: Game) {
  const def = (kind: string, th: string, en: string, build: () => THREE.Object3D) => {
    if (game.items.defOf({ k: kind } as any)) return;
    game.items.define({ kind, name: tl(th, en), weight: 0.6, tags: ['combat', 'nospawn'], noPickup: true, build: () => build() });
  };
  def('cb_pistol', 'ปืนพก', 'pistol', pistolModel);
  def('cb_slipper', 'รองเท้าแตะ', 'slipper', slipperModel);
  def('cb_phone', 'มือถือ', 'phone', phoneModel);
}
