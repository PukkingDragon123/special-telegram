import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/* ============================================================================================
 * Laundry hardware: plastic clothes pegs (two bevelled jaws + wire spring), plastic and wire hangers
 * (hook, neck, sloped shoulders, trouser bar), nylon clothes-line rope with a real sag.
 * Instanced / merged; real sizes in metres.
 * ========================================================================================== */

let pegGeo: THREE.BufferGeometry | null = null;
/** origin = the line contact point; jaws hang down -y, peg depth across z */
export function pegGeometry() {
  if (pegGeo) return pegGeo;
  const jaw = (side: number) => {
    const g = new RoundedBoxGeometry(0.0105, 0.072, 0.0075, 2, 0.0028);
    // jaws taper toward the grip end and open slightly at the bottom (they clamp the cloth at the top)
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = (y + 0.036) / 0.072;           // 0 bottom … 1 top
      p.setX(i, p.getX(i) * (0.75 + 0.25 * t));
      p.setZ(i, p.getZ(i) + side * (0.0035 + 0.0045 * (1 - t)));
    }
    g.computeVertexNormals();
    return g.translate(0, -0.03, 0);
  };
  const spring = new THREE.TorusGeometry(0.0055, 0.0011, 5, 12).rotateY(Math.PI / 2).translate(0, -0.038, 0);
  const g = mergeGeometries([jaw(-1).toNonIndexed(), jaw(1).toNonIndexed(), spring.toNonIndexed()]);
  pegGeo = g;
  return g;
}

let hangerGeo: { plastic: THREE.BufferGeometry; wire: THREE.BufferGeometry } | null = null;
/** origin = the top of the hook (hangs on the rail), shoulders in the x-y plane, -y down */
export function hangerGeometry() {
  if (hangerGeo) return hangerGeo;
  const hook = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.075, 0), new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.004, -0.012, 0),
    new THREE.Vector3(0.018, 0.0, 0), new THREE.Vector3(0.03, -0.012, 0), new THREE.Vector3(0.028, -0.028, 0),
  ]);
  const hookG = new THREE.TubeGeometry(hook, 16, 0.0018, 5, false);
  const sh = 0.205, drop = 0.075, armDrop = 0.06;
  // plastic hanger: thick moulded shoulders + trouser bar
  const pa = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-sh, -drop - armDrop, 0), new THREE.Vector3(-sh * 0.55, -drop - armDrop * 0.55, 0), new THREE.Vector3(0, -drop, 0),
    new THREE.Vector3(sh * 0.55, -drop - armDrop * 0.55, 0), new THREE.Vector3(sh, -drop - armDrop, 0),
  ]);
  const armP = new THREE.TubeGeometry(pa, 24, 0.0055, 6, false);
  armP.scale(1, 1.6, 0.7);
  const bar = new THREE.CylinderGeometry(0.004, 0.004, sh * 1.85, 6).rotateZ(Math.PI / 2).translate(0, -drop - armDrop - 0.01, 0);
  const tipL = new THREE.SphereGeometry(0.008, 8, 6).translate(-sh, -drop - armDrop, 0);
  const tipR = new THREE.SphereGeometry(0.008, 8, 6).translate(sh, -drop - armDrop, 0);
  const plastic = mergeGeometries([hookG.clone().toNonIndexed(), armP.toNonIndexed(), bar.toNonIndexed(), tipL.toNonIndexed(), tipR.toNonIndexed()]);
  // wire hanger: one bent wire (shoulders + straight bottom)
  const wa = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -drop + 0.01, 0), new THREE.Vector3(-sh * 0.5, -drop - armDrop * 0.5, 0), new THREE.Vector3(-sh, -drop - armDrop, 0),
    new THREE.Vector3(-sh + 0.01, -drop - armDrop - 0.012, 0), new THREE.Vector3(0, -drop - armDrop - 0.012, 0), new THREE.Vector3(sh - 0.01, -drop - armDrop - 0.012, 0),
    new THREE.Vector3(sh, -drop - armDrop, 0), new THREE.Vector3(sh * 0.5, -drop - armDrop * 0.5, 0), new THREE.Vector3(0, -drop + 0.01, 0),
  ], false, 'catmullrom', 0.1);
  const wireG = new THREE.TubeGeometry(wa, 48, 0.0016, 5, false);
  const wire = mergeGeometries([hookG.toNonIndexed(), wireG.toNonIndexed()]);
  hangerGeo = { plastic, wire };
  return hangerGeo;
}
/** shoulder line of the hanger (local): y at x */
export function hangerShoulderY(x: number) { const sh = 0.205; return -0.075 - 0.06 * Math.min(1, Math.abs(x) / sh) - 0.004; }

/** sag of a line between a and b at t (0..1): parabola approximating the catenary */
export function linePoint(a: THREE.Vector3, b: THREE.Vector3, t: number, sag: number, out: THREE.Vector3) {
  return out.lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
}

export const PEG_COLORS = [0xe8508a, 0x3a8ae0, 0x46b85a, 0xf2c838, 0xf08a2a, 0xb070d0, 0xf2f2ee];
export const HANGER_COLORS = [0xe8508a, 0x3a8ae0, 0x46b85a, 0xf2c838, 0xf2f2ee, 0x2a2a2a, 0x9a60c8];
