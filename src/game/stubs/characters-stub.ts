import * as THREE from 'three';
import type { AnimName, AttachPoint, CarryPose, CharacterFactory, CharacterRig, FaceVariant, Look } from '../contracts';
import { noiseMaterial } from '../../core/proctex';
import { dampTo } from '../../core/util';

/**
 * PLACEHOLDER characters (articulated mannequin) so modules can be developed before the real
 * `characters` module lands. The characters module replaces `game.chars` in its init().
 */
const DEFAULT_LOOKS: Look[] = [
  { sex: 'm', height: 1.72, build: 0.4, skin: '#c99a76', face: 'm01', hair: { style: 'short', color: '#141110' }, top: { id: 'shirt_stripe_white', color: '#e9e6df' }, bottom: { id: 'jeans', color: '#2c3446' }, shoes: { id: 'sneakers', color: '#eeeeee' }, acc: [] },
  { sex: 'm', height: 1.78, build: 0.45, skin: '#b9875f', face: 'm02', hair: { style: 'afro', color: '#18120e' }, top: { id: 'hawaiian_green', color: '#3f8a3a' }, bottom: { id: 'jeans', color: '#252b38' }, shoes: { id: 'sneakers', color: '#dddddd' }, acc: ['sunglasses', 'headband_white'] },
  { sex: 'm', height: 1.7, build: 0.5, skin: '#c4936d', face: 'm03', hair: { style: 'short', color: '#16120f' }, top: { id: 'polo_stripe_green', color: '#5d9a6a' }, bottom: { id: 'jeans', color: '#30384a' }, shoes: { id: 'sneakers', color: '#e5e5e5' }, acc: [] },
  { sex: 'm', height: 1.74, build: 0.35, skin: '#d2a582', face: 'm04', hair: { style: 'side_part', color: '#1a1512' }, top: { id: 'shirt_white', color: '#f2f0ea' }, bottom: { id: 'jeans', color: '#2a3142' }, shoes: { id: 'sneakers', color: '#f4f4f4' }, acc: [] },
];

class StubRig implements CharacterRig {
  root = new THREE.Group();
  /** body faces +Z internally; rotated so the rig faces -Z like cameras (contract) */
  private inner = new THREE.Group();
  look: Look;
  height: number;
  private bones: Record<string, THREE.Object3D> = {};
  private mats: THREE.MeshStandardMaterial[] = [];
  private anim: AnimName = 'idle';
  private oneShotT = -1;
  private onEnd?: () => void;
  private speed = 0;
  private t = Math.random() * 10;
  private carry: CarryPose = { r: false, l: false, two: false, head: false, load: 0 };
  private attachPts: Partial<Record<AttachPoint, THREE.Object3D>> = {};
  private loopAnim = true;

  constructor(look: Look) {
    this.look = look;
    this.height = look.height;
    this.inner.rotation.y = Math.PI;
    this.root.add(this.inner);
    this.build();
  }

  private part(parent: THREE.Object3D, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, y: number, x = 0) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    pivot.add(m);
    parent.add(pivot);
    this.bones[name] = pivot;
    return { pivot, mesh: m };
  }

  private build() {
    const L = this.look, s = L.height / 1.75;
    const skin = noiseMaterial(L.skin, 'skin', { roughness: 0.7 });
    const top = noiseMaterial(L.top.color ?? '#ddd', 'fabric', { roughness: 0.9 });
    const bot = noiseMaterial(L.bottom.color ?? '#334', 'fabric', { roughness: 0.9 });
    const hair = noiseMaterial(L.hair.color, 'fabric', { roughness: 0.6 });
    this.mats.push(skin, top, bot, hair);
    const cap = (r: number, h: number) => new THREE.CapsuleGeometry(r, h, 3, 7);
    const w = 1 + (L.build - 0.4) * 0.5;
    const hips = this.part(this.inner, 'hips', new THREE.BoxGeometry(0.32 * w, 0.18, 0.2), bot, 0.95 * s);
    const spine = this.part(hips.pivot, 'spine', cap(0.15 * w, 0.28), top, 0.12);
    spine.mesh.position.y = 0.2;
    spine.mesh.scale.set(1.15, 1, 0.75);
    const neck = this.part(spine.pivot, 'neck', cap(0.05, 0.06), skin, 0.47);
    const head = this.part(neck.pivot, 'head', new THREE.SphereGeometry(0.115, 10, 8), skin, 0.12);
    head.mesh.scale.set(0.92, 1.12, 1);
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(L.hair.style === 'afro' ? 0.17 : 0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairM.position.y = 0.025;
    head.pivot.add(hairM);
    for (const side of [-1, 1]) {
      const n = side < 0 ? 'l' : 'r';
      const sh = this.part(spine.pivot, 'upperarm_' + n, cap(0.05, 0.22), top, 0.4, side * 0.21 * w);
      sh.mesh.position.y = -0.14;
      const fa = this.part(sh.pivot, 'forearm_' + n, cap(0.042, 0.2), skin, -0.29);
      fa.mesh.position.y = -0.13;
      const hand = this.part(fa.pivot, 'hand_' + n, new THREE.BoxGeometry(0.07, 0.09, 0.035), skin, -0.27);
      hand.mesh.position.y = -0.03;
      const th = this.part(hips.pivot, 'thigh_' + n, cap(0.075 * w, 0.32), bot, -0.06, side * 0.095 * w);
      th.mesh.position.y = -0.22;
      const shin = this.part(th.pivot, 'shin_' + n, cap(0.055, 0.32), skin, -0.44);
      shin.mesh.position.y = -0.21;
      const foot = this.part(shin.pivot, 'foot_' + n, new THREE.BoxGeometry(0.09, 0.05, 0.24), noiseMaterial(L.shoes.color ?? '#eee', 'plastic'), -0.42);
      foot.mesh.position.set(0, -0.0, 0.05);
    }
    const ap = (name: AttachPoint, parent: string, pos: [number, number, number]) => {
      const o = new THREE.Group();
      o.name = 'attach_' + name;
      o.position.set(...pos);
      this.bones[parent].add(o);
      this.attachPts[name] = o;
    };
    ap('hand_r', 'hand_r', [0, -0.08, 0.05]);
    ap('hand_l', 'hand_l', [0, -0.08, 0.05]);
    ap('arm_r', 'upperarm_r', [0.06, -0.2, 0.02]);
    ap('arm_l', 'upperarm_l', [-0.06, -0.2, 0.02]);
    ap('head', 'head', [0, 0.17, 0]);
    ap('back', 'spine', [0, 0.25, -0.2]);
    ap('mouth', 'head', [0, -0.04, 0.13]);
    ap('chest', 'spine', [0, 0.25, 0.17]);
    ap('hip', 'hips', [0.18, 0, 0.05]);
    this.root.scale.setScalar(1);
  }

  setLook(look: Look) {
    this.look = look;
    for (const c of [...this.inner.children]) this.inner.remove(c);
    this.bones = {};
    this.build();
  }
  play(anim: AnimName, o: { loop?: boolean; onEnd?: () => void } = {}) {
    this.anim = anim;
    this.loopAnim = o.loop ?? !['slap', 'highfive', 'get_slapped', 'give', 'point', 'wave'].includes(anim);
    this.oneShotT = this.loopAnim ? -1 : 0;
    this.onEnd = o.onEnd;
  }
  setMove(speed: number) { this.speed = speed; }
  setCarry(p: CarryPose) { this.carry = p; }
  setFace(_v: FaceVariant) {}
  lookAt(_p: THREE.Vector3 | null) {}
  attach(p: AttachPoint) { return this.attachPts[p] ?? this.root; }
  setSilhouette(on: boolean) { for (const m of this.mats) { m.color.set(on ? 0x050403 : 0xffffff); m.map = on ? null : m.map; m.needsUpdate = true; } }
  setFirstPerson(on: boolean) {
    this.root.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = !on; o.material.depthWrite = !on; } });
  }

  update(dt: number) {
    this.t += dt;
    const b = this.bones, t = this.t;
    const set = (n: string, x = 0, y = 0, z = 0) => { const o = b[n]; if (o) o.rotation.set(dampTo(o.rotation.x, x, 12, dt), dampTo(o.rotation.y, y, 12, dt), dampTo(o.rotation.z, z, 12, dt)); };
    let a = this.anim;
    if (this.oneShotT >= 0) {
      this.oneShotT += dt;
      if (this.oneShotT > 0.8) { this.oneShotT = -1; a = this.anim = 'idle'; this.onEnd?.(); }
    }
    const moving = (a === 'idle' || a === 'walk' || a === 'run') && this.speed > 0.2;
    const sw = moving ? Math.sin(t * (this.speed > 3.5 ? 11 : 7.5)) * Math.min(1, this.speed / 3) : 0;
    b.hips.position.y = 0.95 * (this.look.height / 1.75) + (moving ? Math.abs(Math.cos(t * 7.5)) * 0.03 : Math.sin(t * 2) * 0.004);
    this.inner.rotation.z = 0;
    set('thigh_l', sw * 0.6); set('thigh_r', -sw * 0.6);
    set('shin_l', Math.max(0, -sw) * 0.8); set('shin_r', Math.max(0, sw) * 0.8);
    set('upperarm_l', -sw * 0.5, 0, 0.08); set('upperarm_r', sw * 0.5, 0, -0.08);
    set('forearm_l', -0.2); set('forearm_r', -0.2);
    set('spine', 0.03 + this.carry.load * 0.15); set('neck'); set('head');
    if (this.carry.two) { set('upperarm_l', -1.1, 0, 0.2); set('upperarm_r', -1.1, 0, -0.2); set('forearm_l', -0.5); set('forearm_r', -0.5); }
    else {
      if (this.carry.r) { set('upperarm_r', -0.6, 0, -0.1); set('forearm_r', -0.9); }
      if (this.carry.l) { set('upperarm_l', -0.6, 0, 0.1); set('forearm_l', -0.9); }
    }
    if (this.carry.head) { set('upperarm_l', -3.0, 0, 0.3); set('forearm_l', -0.4); }
    switch (a) {
      case 'tpose': set('upperarm_l', 0, 0, 1.57); set('upperarm_r', 0, 0, -1.57); set('forearm_l'); set('forearm_r'); set('thigh_l'); set('thigh_r'); set('shin_l'); set('shin_r'); break;
      case 'sit': set('thigh_l', -1.5); set('thigh_r', -1.5); set('shin_l', 1.5); set('shin_r', 1.5); b.hips.position.y = 0.5; break;
      case 'think': set('upperarm_r', -0.6, 0, -0.3); set('forearm_r', -2.2); set('head', -0.25, 0.2); break;
      case 'slap': set('upperarm_r', -1.4, Math.sin(this.oneShotT * 12) * 1.2, -0.6); set('forearm_r', -0.3); break;
      case 'highfive': set('upperarm_r', -2.9, 0, -0.2); set('forearm_r', -0.2); break;
      case 'celebrate': case 'casino_cheer': set('upperarm_l', -2.8 + Math.sin(t * 9) * 0.3, 0, 0.3); set('upperarm_r', -2.8 + Math.cos(t * 9) * 0.3, 0, -0.3); break;
      case 'drunk': this.inner.rotation.z = Math.sin(t * 1.3) * 0.08; set('head', 0.2, 0, Math.sin(t) * 0.3); break;
      case 'scream_run': set('upperarm_l', -2.9, 0, 0.5); set('upperarm_r', -2.9, 0, -0.5); break;
      case 'sleep': case 'lie_cardboard': b.hips.position.y = 0.15; this.inner.rotation.z = 0; set('spine', -1.55); set('thigh_l', 1.4); set('thigh_r', 1.4); break;
      case 'cook_stir': set('upperarm_r', -0.9, 0, -0.2); set('forearm_r', -0.8 + Math.sin(t * 10) * 0.4); break;
      case 'push_cart': set('upperarm_l', -1.2, 0, 0.1); set('upperarm_r', -1.2, 0, -0.1); set('spine', 0.25); break;
      default: break;
    }
  }
  dispose() { this.root.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); }); for (const m of this.mats) m.dispose(); }
}

export const stubCharacters: CharacterFactory = {
  create: (look) => new StubRig(look),
  randomLook: (_arch, seed = Math.random() * 1e6) => {
    const r = (n: number) => (Math.sin(seed * 9301 + n * 49297) * 0.5 + 0.5);
    const tops = ['#c94f3d', '#3d6fc9', '#e0d7c3', '#6a8f4e', '#e8a33d', '#7b4f9e'];
    return {
      sex: r(1) > 0.5 ? 'm' : 'f', height: 1.55 + r(2) * 0.25, build: r(3), skin: ['#d8ad8a', '#c4936d', '#a87652', '#8d5f3e'][Math.floor(r(4) * 4)],
      face: 'm01', hair: { style: 'short', color: '#151210' }, top: { id: 'tshirt', color: tops[Math.floor(r(5) * tops.length)] },
      bottom: { id: 'shorts', color: '#2d3340' }, shoes: { id: 'flipflops', color: '#3b6fb8' }, acc: [],
    };
  },
  playerLook: (slot) => JSON.parse(JSON.stringify(DEFAULT_LOOKS[slot % 4])),
  catalogue: () => ({ tops: [], bottoms: [], shoes: [], acc: [], hair: [], faces: [], skins: ['#e6c3a3', '#d2a582', '#c4936d', '#a87652', '#8d5f3e', '#6b4429'] }),
};
