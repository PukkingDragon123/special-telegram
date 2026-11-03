import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { CharacterRig, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { vehicleModel, wheelModel, VDEFS } from '../life/vehicles';
import { libLoad, libEntry } from '../world/lib';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GEN, loadGlb } from './util';

/* ============================================================================================
 * The Thai police: a patrol pickup (กระบะตำรวจ — the life module's lofted pickup body re-skinned
 * with a rectified photo of a real Royal Thai Police Hilux, CC BY-SA) with a red/blue light bar that
 * casts REAL coloured light (two PointLights), and two officers (character rigs, 'police' archetype:
 * brown uniform + cap) — one sweeps a REAL SpotLight flashlight (Poly Haven torch model + dusty
 * volumetric beam).
 * The three lights are created once at world build (visible, intensity 0) so the light count never
 * changes during play → no shader recompiles when the cinematic starts.
 * ========================================================================================== */

export interface Officer {
  rig: CharacterRig;
  root: THREE.Object3D;
  speed: number;
}

const BEAM_LEN = 7.5;

export class Police {
  readonly root = new THREE.Group();
  readonly truck = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private barRed: THREE.MeshStandardMaterial;
  private barBlue: THREE.MeshStandardMaterial;
  readonly red = new THREE.PointLight(0xff2020, 0, 20, 1.6);
  readonly blue = new THREE.PointLight(0x2050ff, 0, 20, 1.6);
  readonly spot = new THREE.SpotLight(0xfff2d8, 0, 26, 0.3, 0.55, 1.4);
  readonly spotTarget = new THREE.Object3D();
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private torch: THREE.Object3D | null = null;
  officers: Officer[] = [];
  /** light bar on/off */
  bar = false;
  /** flashlight on/off */
  flash = false;
  private t = 0;
  private wheelSpin = 0;
  private lastTruckPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private game: Game) {
    this.root.name = 'escape-police';
    this.root.visible = false;
    // ---- truck
    const vm = vehicleModel('pickup');
    const tex = Assets.texture(GEN + 'tex/police_pickup.jpg', { wrap: false });
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.28, envMapIntensity: 1.2 });
    const body = new THREE.Mesh(vm.geo, mat);
    body.castShadow = true; body.receiveShadow = true;
    const useLib = !!libEntry('pickup_hilux');
    if (!useLib) this.truck.add(body);
    const wm = wheelModel();
    if (!useLib) for (const w of VDEFS.pickup.wheels) for (const s of [1, -1]) {
      const wh = new THREE.Mesh(wm.geo, wm.mat);
      wh.scale.set(0.26, w.r, w.r);
      wh.position.set(s * w.x, w.r, w.z);
      wh.castShadow = true;
      this.wheels.push(wh);
      this.truck.add(wh);
    }
    // the real Hilux (shared library) in Thai patrol livery: brown below the belt line, cream above, ตำรวจ on the doors
    if (useLib) libLoad('pickup_hilux').then((a) => {
      if (!a) { this.truck.add(body); return; }
      const size = a.box.getSize(new THREE.Vector3());
      const k = VDEFS.pickup.len / size.z;
      const M = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(k, k, k));
      let bi = 0, best = -1;
      a.parts.forEach((p, i) => { const n = p.geom.getAttribute('position').count * ((p.mat as any).map ? 2 : 1); if (n > best) { best = n; bi = i; } });
      for (const [i, p] of a.parts.entries()) {
        const m = new THREE.Mesh(p.geom.clone().applyMatrix4(M), i === bi ? policePaint(p.mat as THREE.MeshStandardMaterial, size.y * k) : p.mat);
        m.castShadow = true; m.receiveShadow = true;
        this.truck.add(m);
      }
      const lbl = policeDoorMat();
      for (const sx of [1, -1]) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.26), lbl);
        d.position.set(sx * (size.x * k / 2 - 0.035), size.y * k * 0.5, -0.35); d.rotation.y = sx * Math.PI / 2;
        this.truck.add(d);
      }
    });
    // light bar on the cab roof: chrome base + two lens halves
    const baseMat = Assets.pbr('chrome', { color: 0x9a9a9a });
    const base = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.07, 0.26, 2, 0.025), baseMat);
    base.position.set(0, 1.8, -0.2);
    this.truck.add(base);
    const lensGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10, 1);
    lensGeo.rotateZ(Math.PI / 2);
    this.barRed = new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.25, transparent: true, opacity: 0.92 });
    this.barBlue = new THREE.MeshStandardMaterial({ color: 0x0a1a7a, emissive: 0x2040ff, emissiveIntensity: 0, roughness: 0.25, transparent: true, opacity: 0.92 });
    const lr = new THREE.Mesh(lensGeo, this.barRed); lr.position.set(0.31, 1.88, -0.2); lr.scale.set(1, 0.85, 1.2);
    const lb = new THREE.Mesh(lensGeo, this.barBlue); lb.position.set(-0.31, 1.88, -0.2); lb.scale.set(1, 0.85, 1.2);
    this.truck.add(lr, lb);
    this.root.add(this.truck);
    // ---- flashlight (shared by officer 0)
    this.spot.castShadow = false;
    this.spot.target = this.spotTarget;
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          vL = clamp(-position.z / ${BEAM_LEN.toFixed(1)}, 0.0, 1.0);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform float uK; uniform float uTime;
        varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main() {
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float dust = 0.55 + 0.45 * n3(vW * 2.2 + vec3(0.0, uTime * 0.35, uTime * 0.2));
          float a = uK * edge * (1.0 - vL) * (1.0 - vL) * smoothstep(0.0, 0.06, vL) * dust;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * a * 0.55, 1.0);
        }`,
    });
    const cone = new THREE.CylinderGeometry(1.35, 0.035, BEAM_LEN, 20, 1, true);
    cone.translate(0, -BEAM_LEN / 2, 0);
    cone.rotateX(Math.PI / 2);   // tip at origin, opens toward -Z
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 12;
    this.beam.visible = false;
    this.root.add(this.beam);
    loadGlb('small_plastic_torch', { shadow: false }).then((m) => {
      if (!m) return;
      this.torch = orientTorch(m);
      this.torch.visible = false;
      this.root.add(this.torch);
    });
  }

  /** add the permanent lights to the scene (call once per world) */
  attachLights(scene: THREE.Object3D) {
    // lights sit directly in the scene (an invisible parent would drop them from the light count)
    scene.add(this.spot, this.spotTarget, this.red, this.blue);
    // the bar lights live on the truck (in this.root); keep the root in the scene, hidden geometry only
    scene.add(this.root);
    this.root.visible = true;
    this.truck.visible = false;
  }

  /** lazily create the two officers */
  ensureOfficers() {
    if (this.officers.length || !this.game.chars) return;
    for (let i = 0; i < 2; i++) {
      const look = JSON.parse(JSON.stringify(this.game.chars.randomLook('police', 900 + i * 37))) as Look;
      look.acc = ['police_cap', ...(look.acc ?? []).filter((a) => a !== 'police_cap' && a !== 'sunglasses')];
      if (i === 1) look.build = Math.max(look.build ?? 0.5, 0.75);   // the chubby one who wants noodles
      const rig = this.game.chars.create(look, { castShadow: true });
      rig.root.visible = false;
      this.root.add(rig.root);
      this.officers.push({ rig, root: rig.root, speed: 0 });
    }
  }

  show(on: boolean) {
    this.truck.visible = on;
    for (const o of this.officers) o.root.visible = on;
    if (!on) { this.bar = false; this.flash = false; }
  }

  placeTruck(p: THREE.Vector3, yaw: number) {
    this.truck.position.copy(p);
    this.truck.rotation.set(0, yaw, 0);
  }

  /** advance visuals; night 0..1 */
  update(dt: number, night: number) {
    this.t += dt;
    const t = this.t;
    // ---- wheels roll with truck motion
    const moved = this.truck.position.distanceTo(this.lastTruckPos);
    if (moved < 3) {
      const fwd = this.tmp.set(-Math.sin(this.truck.rotation.y), 0, -Math.cos(this.truck.rotation.y));
      const sgn = Math.sign(this.tmp2.copy(this.truck.position).sub(this.lastTruckPos).dot(fwd)) || 1;
      this.wheelSpin -= (sgn * moved) / 0.36;
      for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    }
    this.lastTruckPos.copy(this.truck.position);
    // ---- light bar: alternating red / blue double flashes
    const vis = this.truck.visible && this.bar;
    const k = (t * 1.9) % 1;
    const sub = (u: number) => ((u * 6) % 1) < 0.55 ? 1 : 0;
    const r = vis && k < 0.46 ? sub(k / 0.46) : 0;
    const b = vis && k >= 0.5 && k < 0.96 ? sub((k - 0.5) / 0.46) : 0;
    const L = 10 + 26 * night;
    this.red.intensity = r * L;
    this.blue.intensity = b * L * 1.25;
    if (vis) {
      this.truck.updateMatrixWorld();
      this.red.position.set(0.45, 2.05, -0.2).applyMatrix4(this.truck.matrixWorld);
      this.blue.position.set(-0.45, 2.05, -0.2).applyMatrix4(this.truck.matrixWorld);
    }
    this.barRed.emissiveIntensity = 0.3 + r * 7;
    this.barBlue.emissiveIntensity = 0.3 + b * 7;
    // ---- flashlight follows officer 0's right hand
    const off = this.officers[0];
    const on = this.flash && !!off && off.root.visible;
    this.spot.intensity = on ? 30 + 90 * night : 0;
    this.beam.visible = on && night > 0.15;
    this.beamMat.uniforms.uK.value = night;
    this.beamMat.uniforms.uTime.value = t;
    if (on && off) {
      const hand = off.rig.attach('hand_r');
      hand.getWorldPosition(this.tmp);
      this.spot.position.copy(this.tmp);
      this.beam.position.copy(this.tmp);
      this.beam.lookAt(this.spotTarget.position);
      this.beam.rotateY(Math.PI);    // cone opens toward -Z; lookAt points +Z
      if (this.torch) {
        this.torch.visible = true;
        this.torch.position.copy(this.tmp);
        this.torch.lookAt(this.spotTarget.position);
      }
    } else if (this.torch) this.torch.visible = false;
    for (const o of this.officers) if (o.root.visible) o.rig.update(dt);
  }

  dispose() {
    for (const o of this.officers) o.rig.dispose();
    this.officers = [];
    for (const o of [this.spot, this.spotTarget, this.red, this.blue, this.root]) o.removeFromParent();
  }
}

/** rotate the torch so its long axis is +Z with the (wider) head forward; pivot at the grip */
function orientTorch(m: THREE.Object3D): THREE.Object3D {
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  // which end is wider? sample vertex radii near both ends
  let rLo = 0, rHi = 0;
  const c = box.getCenter(new THREE.Vector3());
  const v = new THREE.Vector3();
  const lo = (box.min as any)[axis] as number, hi = (box.max as any)[axis] as number, L = hi - lo;
  m.traverse((o: any) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const u = (((v as any)[axis] as number) - lo) / L;
      const d = v.clone().sub(c); (d as any)[axis] = 0;
      const r = d.length();
      if (u < 0.15) rLo = Math.max(rLo, r); else if (u > 0.85) rHi = Math.max(rHi, r);
    }
  });
  const dir = new THREE.Vector3(); (dir as any)[axis] = rHi >= rLo ? 1 : -1;
  const q = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, 0, 1));
  const inner = new THREE.Group();
  m.position.sub(c);
  inner.add(m);
  inner.quaternion.copy(q);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.name = 'police-torch';
  return outer;
}

/** repaint the library pickup in Royal Thai Police patrol colours (keeps the texture's shading as luminance) */
function policePaint(base: THREE.MeshStandardMaterial, height: number): THREE.Material {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBelt = { value: height * 0.55 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vObjY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vObjY;\nuniform float uBelt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 paint = vObjY < uBelt ? vec3(0.22, 0.09, 0.06) : vec3(0.92, 0.9, 0.84);
        diffuseColor.rgb = paint * clamp(0.35 + lum * 2.2, 0.2, 1.2);
      }`);
  };
  m.customProgramCacheKey = () => 'policepaint';
  return m;
}
let doorMat: THREE.Material | null = null;
function policeDoorMat() {
  if (doorMat) return doorMat;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 116;
  const x = cv.getContext('2d')!;
  x.clearRect(0, 0, 512, 116);
  x.fillStyle = '#f2efe6'; x.font = 'bold 64px "K2D", sans-serif'; x.textBaseline = 'middle'; x.fillText('ตำรวจ', 18, 56);
  x.fillStyle = '#e8c23a'; x.font = 'bold 44px "K2D", sans-serif'; x.fillText('POLICE 191', 230, 60);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  doorMat = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  return doorMat;
}
