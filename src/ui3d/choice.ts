import * as THREE from 'three';
import { Text3D, Text3DOpts } from './text3d';
import { Input } from '../core/input';
import { Sound } from '../core/audio';
import { Ease, TL } from '../core/util';

/**
 * QUICK CHOICE — the "mad system" / bargaining reply picker. The 2–3 replies float in front of the local
 * camera as real 3D words (no bubbles); the player has N seconds (default 3) to pick with 1/2/3, or by
 * sliding the mouse to highlight + LMB. The timer is a burning Thai incense stick (ธูป): the glowing ember
 * eats along the stick, smoke curls up, ash droops. Local-only UI: the caller sends the result to the host.
 *
 *   game.ui.choose({ prompt: tl('แพงไปไหมเนี่ย!?'), options: [tl('ขอโทษครับป้า'), tl('ลดให้หน่อยน้า'), tl('ก็ไม่ต้องซื้อสิ!')],
 *                    seconds: 3, onPick: (i) => …  (i = -1 when timed out) });
 */
export interface ChoiceOpts {
  prompt?: TL;
  options: TL[];
  seconds?: number;
  onPick: (index: number) => void;
  /** tint per option (e.g. polite/funny/rude), optional */
  colors?: number[];
}

const OPT: Text3DOpts = {
  font: 'talk', size: 0.021, depth: 0.32, bevel: 0.07, color: 0xfff0d2, side: 0x5a2c14, roughness: 0.38, emissive: 0.34, shadow: 0.5,
  xray: true, castShadow: false, maxWidth: 0.5, valign: 'bottom', anim: { pop: 0.3, rise: 0.4, spin: 1, vanish: 0.2, drift: 0.3 },
};
const OPT_HOT: Partial<Text3DOpts> = { color: 0xffe28a, side: 0x8a3c0a, emissive: 0.85, rim: 0xffb347, rimStrength: 1.3 };
const SUB: Text3DOpts = {
  font: 'ui', size: 0.0105, depth: 0.2, bevel: 0.05, color: 0xe9dfcd, side: 0x33271f, roughness: 0.5, emissive: 0.3, shadow: 0.5,
  xray: true, castShadow: false, maxWidth: 0.5, valign: 'top', anim: { pop: 0.25, rise: 0.3, spin: 0.5, vanish: 0.2, drift: 0.2 },
};
const NUM: Text3DOpts = {
  font: 'display', size: 0.03, depth: 0.4, bevel: 0.1, color: 0xffcf5a, metalness: 0.85, roughness: 0.25, emissive: 0.2, bevelFace: true,
  xray: true, castShadow: false, valign: 'bottom', anim: { pop: 0.35, rise: 0.4, spin: 1.4, vanish: 0.2, drift: 0.3 },
};

const smokeVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const smokeFrag = /* glsl */ `
uniform float uT; uniform float uA; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
void main(){
  vec2 p = vUv;
  float y = p.y;
  // a thin wisp that wanders sideways and widens as it rises
  float sway = (fbm(vec2(y * 2.5 - uT * 0.6, uT * 0.2)) - 0.5) * 0.9 * y + sin(y * 9.0 - uT * 2.0) * 0.05 * y;
  float w = 0.03 + 0.22 * y;
  float d = abs(p.x - 0.5 - sway) / w;
  float body = 1.0 - smoothstep(0.0, 1.0, d);
  float puff = fbm(vec2(p.x * 6.0, y * 5.0 - uT * 1.4));
  float a = body * (0.45 + 0.75 * puff) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.55, 1.0, y)) * uA;
  gl_FragColor = vec4(vec3(0.88, 0.87, 0.85), a * 0.8);
}`;

const glowFrag = /* glsl */ `
uniform float uA; varying vec2 vUv;
void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 5.0) * uA; gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * 1.6, a); }`;

/** A burning Thai incense stick (ธูป) in a little brass pot: the ember eats along the stick toward the pot. */
class Incense {
  readonly group = new THREE.Group();
  private arm = new THREE.Group();
  private paste: THREE.Mesh;
  private ember: THREE.Mesh;
  private ash: THREE.Mesh;
  private glow: THREE.Mesh;
  private smoke: THREE.Mesh;
  private emberMat: THREE.MeshBasicMaterial;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private tmp = new THREE.Vector3();
  constructor(readonly len: number) {
    const mk = <M extends THREE.Material>(m: M) => { m.transparent = true; m.depthTest = false; m.depthWrite = false; this.mats.push(m); return m; };
    const geo = <G extends THREE.BufferGeometry>(g: G) => { this.geos.push(g); return g; };
    const cyl = (r: number) => { const g = geo(new THREE.CylinderGeometry(r, r, 1, 12, 1)); g.rotateZ(Math.PI / 2); g.translate(0.5, 0, 0); return g; };
    const add = (m: THREE.Object3D, parent: THREE.Object3D = this.group, order = 2002) => { m.renderOrder = order; m.frustumCulled = false; parent.add(m); return m; };
    // brass incense pot (กระถางธูป) with ash-grey sand
    const prof = [[0, 0], [0.014, 0], [0.02, 0.004], [0.024, 0.014], [0.023, 0.024], [0.026, 0.027], [0.024, 0.029], [0, 0.029]].map(([x, y]) => new THREE.Vector2(x, y));
    const pot = add(new THREE.Mesh(geo(new THREE.LatheGeometry(prof, 18)), mk(new THREE.MeshStandardMaterial({ color: 0xd2a447, metalness: 0.9, roughness: 0.28, emissive: 0x2a1a04 }))));
    pot.position.set(-len / 2 - 0.02, -0.03, 0);
    pot.rotation.x = 0.35;
    // the stick: rises gently out of the pot to the right
    this.arm.position.set(-len / 2 - 0.02, -0.003, 0);
    this.arm.rotation.z = 0.09;
    this.group.add(this.arm);
    const handle = add(new THREE.Mesh(cyl(0.0032), mk(new THREE.MeshStandardMaterial({ color: 0xd0202e, roughness: 0.55, emissive: 0x400509 }))), this.arm);
    handle.scale.x = 0.05;
    this.paste = add(new THREE.Mesh(cyl(0.0058), mk(new THREE.MeshStandardMaterial({ color: 0x7e3d22, roughness: 0.95, emissive: 0x2c0f06 }))), this.arm) as THREE.Mesh;
    this.paste.position.x = 0.04;
    this.paste.scale.x = len;
    this.emberMat = mk(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.25, 0.3), toneMapped: false }));
    this.ember = add(new THREE.Mesh(geo(new THREE.SphereGeometry(0.0066, 14, 10)), this.emberMat), this.arm, 2003) as THREE.Mesh;
    this.ash = add(new THREE.Mesh(cyl(0.0052), mk(new THREE.MeshStandardMaterial({ color: 0xb2ada4, roughness: 1, emissive: 0x1c1a18 }))), this.arm) as THREE.Mesh;
    this.ash.scale.x = 0.02;
    const gm = mk(new THREE.ShaderMaterial({ vertexShader: smokeVert, fragmentShader: glowFrag, uniforms: { uA: { value: 1 } }, blending: THREE.AdditiveBlending }));
    this.glow = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(0.07, 0.07)), gm), this.group, 2004) as THREE.Mesh;
    const sg = geo(new THREE.PlaneGeometry(0.09, 0.26));
    sg.translate(0, 0.13, 0);
    this.smoke = add(new THREE.Mesh(sg, mk(new THREE.ShaderMaterial({ vertexShader: smokeVert, fragmentShader: smokeFrag, uniforms: { uT: { value: 0 }, uA: { value: 0 } } }))), this.group, 2005) as THREE.Mesh;
  }
  /** k: remaining fraction 1 → 0 */
  update(k: number, t: number, panic: number) {
    const L = this.len * Math.max(0.002, k);
    this.paste.scale.x = L;
    const x = 0.04 + L;
    const fl = 0.85 + 0.15 * Math.sin(t * (14 + panic * 30)) + 0.1 * Math.sin(t * 37);
    this.ember.position.set(x + 0.002, 0, 0);
    this.ember.scale.setScalar(fl * (1 + panic * 0.35));
    this.emberMat.color.setRGB(3.2 * fl, 1.2 * fl, 0.28);
    this.ash.position.set(x + 0.005, 0, 0);
    this.ash.rotation.z = -0.3 - Math.sin(t * 1.3) * 0.06;
    this.arm.updateMatrix();
    const tip = this.tmp.set(x + 0.004, 0, 0).applyMatrix4(this.arm.matrix);
    this.glow.position.copy(tip).setZ(0.004);
    this.smoke.position.copy(tip).add(this.tmp.set(0, 0.005, -0.01));
    (this.glow.material as THREE.ShaderMaterial).uniforms.uA.value = 0.75 * fl * (1 + panic * 0.5);
    const sm = this.smoke.material as THREE.ShaderMaterial;
    sm.uniforms.uT.value = t;
    sm.uniforms.uA.value = Math.min(1, t * 2) * (1 + panic * 0.6);
  }
  dispose() {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

interface Option { root: THREE.Group; num: Text3D; main: Text3D; sub: Text3D | null; baseX: number; hot: boolean; tint: number }

export class ChoicePrompt {
  readonly group = new THREE.Group();
  private items: Option[] = [];
  private incense: Incense;
  private t = 0;
  private sel = 1;
  private acc = 0;
  private done = false;
  private tick: any = null;
  readonly seconds: number;

  constructor(private camera: THREE.Camera, private o: ChoiceOpts) {
    this.seconds = o.seconds ?? 3;
    this.group.renderOrder = 2000;
    const n = o.options.length;
    const spacing = n >= 3 ? 0.6 : 0.68;
    o.options.forEach((opt, i) => {
      const root = new THREE.Group();
      const baseX = (i - (n - 1) / 2) * spacing;
      root.position.set(baseX, -0.2, -0.9);
      const tint = o.colors?.[i] !== undefined ? new THREE.Color(o.colors[i]).lerp(new THREE.Color(0xfff0d2), 0.45).getHex() : (OPT.color as number);
      const main = new Text3D(opt.th, { ...OPT, color: tint });
      const sub = opt.en ? new Text3D(opt.en, SUB) : null;
      const num = new Text3D(String(i + 1), NUM);
      main.popIn(0.025);
      sub?.popIn(0.012);
      num.popIn(0);
      root.add(main, num);
      if (sub) root.add(sub);
      root.scale.setScalar(0.001);
      this.group.add(root);
      this.items.push({ root, num, main, sub, baseX, hot: false, tint });
    });
    this.incense = new Incense(n >= 3 ? 0.62 : 0.5);
    this.incense.group.position.set(0.02, -0.305, -0.9);
    this.group.add(this.incense.group);
    camera.add(this.group);
    this.sel = Math.floor((n - 1) / 2);
    this.tick = Sound.loop('tick_tock_loop', { vol: 0.6 });
    Sound.play('whoosh_text', { vol: 0.45 });
  }

  /** returns false when finished */
  update(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const k = 1 - this.t / this.seconds;
    // input
    for (let i = 0; i < this.items.length; i++) if (Input.wasPressed('Digit' + (i + 1)) || Input.wasPressed('Numpad' + (i + 1))) { Input.consume('Digit' + (i + 1)); return this.pick(i); }
    this.acc += Input.mouseDX;
    if (Math.abs(this.acc) > 90) { this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + Math.sign(this.acc))); this.acc = 0; Sound.play('bubble_pop', { vol: 0.25, pitch: 1.5 }); }
    if (Input.wheel) this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + Input.wheel));
    if (Input.mousePressed(0)) { Input.consumeMouse(0); return this.pick(this.sel); }
    // visuals
    const panic = k < 0.35 ? 1 - k / 0.35 : 0;
    this.incense.update(Math.max(0, k), this.t, panic);
    this.items.forEach((b, i) => {
      const hot = i === this.sel;
      if (hot !== b.hot) {
        b.hot = hot;
        b.main.setLook(hot ? OPT_HOT : { color: b.tint, side: OPT.side, emissive: OPT.emissive, rim: undefined, rimStrength: 0 });
        b.num.setLook(hot ? { emissive: 0.8 } : { emissive: NUM.emissive });
      }
      const pop = Ease.outBack(Math.min(1, Math.max(0, (this.t - i * 0.06) / 0.3)));
      const s = Math.max(0.001, pop) * (hot ? 1.16 : 0.94);
      const r = b.root;
      r.scale.setScalar(r.scale.x + (s - r.scale.x) * Math.min(1, dt * 14));
      r.position.y = -0.2 + (hot ? 0.022 : 0) + Math.sin(this.t * 2.2 + i * 1.7) * 0.004;
      r.position.z = -0.9 + (hot ? 0.06 : 0);
      r.position.x = b.baseX + (panic ? Math.sin(this.t * 60 + i) * 0.004 * panic : 0);
      r.rotation.set(Math.sin(this.t * 1.3 + i) * 0.06 - 0.05, -b.baseX * 0.35 + Math.sin(this.t * 0.9 + i * 2) * 0.08, Math.sin(this.t * 1.1 + i) * 0.03);
      // number sits above the line, the English gloss under it
      b.num.position.set(0, b.main.height + 0.006, 0.004);
      if (b.sub) b.sub.position.y = -0.004;
    });
    if (k <= 0) return this.pick(-1);
    return true;
  }

  private pick(i: number): boolean {
    if (this.done) return false;
    this.done = true;
    Sound.play(i < 0 ? 'wrong_buzz' : 'ding_correct', { vol: 0.6 });
    this.tick?.stop(0.1);
    try { this.o.onPick(i); } catch (e) { console.error('[choice]', e); }
    this.dispose();
    return false;
  }

  cancel() { if (!this.done) { this.done = true; this.tick?.stop(0.1); this.dispose(); } }

  private dispose() {
    this.group.removeFromParent();
    for (const b of this.items) { b.main.dispose(); b.sub?.dispose(); b.num.dispose(); }
    this.incense.dispose();
  }
}
