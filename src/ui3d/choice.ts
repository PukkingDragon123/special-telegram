import * as THREE from 'three';
import { makeCloudMaterial } from './cloud';
import { renderText, canvasTexture, TS } from './text';
import { F } from '../core/fonts';
import { Input } from '../core/input';
import { Sound } from '../core/audio';
import { Ease, TL } from '../core/util';

/**
 * QUICK CHOICE — the "mad system" / bargaining reply picker. Three organic reply bubbles float in
 * front of the local camera; the player has N seconds (default 3) to pick with 1/2/3, or by
 * sliding the mouse to highlight + LMB. A noise-edged fuse ring burns down. Local-only UI: the
 * caller sends the result to the host (game.intent) itself.
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

const fuseVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const fuseFrag = `
uniform float uK; uniform float uT; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p), a = atan(p.y, p.x) / 6.28318 + 0.5;
  float w = 0.13 + 0.03 * n(vec2(a * 40.0, uT * 3.0));
  float ring = smoothstep(w, w - 0.03, abs(r - 0.8));
  float lit = step(a, uK);
  vec3 c = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.25, 0.1), 1.0 - uK);
  float spark = smoothstep(0.03, 0.0, abs(a - uK)) * ring * 2.5;
  float alpha = ring * (lit * 0.95 + 0.12) + spark;
  gl_FragColor = vec4(c * (0.8 + spark), alpha);
}`;

export class ChoicePrompt {
  readonly group = new THREE.Group();
  private bubbles: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; tex: THREE.Texture; baseX: number }[] = [];
  private fuse: THREE.Mesh;
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
    const spacing = 0.66;
    o.options.forEach((opt, i) => {
      const mt = renderText([
        { text: `${i + 1}. ${opt.th}`, style: { ...TS.bubble, font: F.ui, size: 46, weight: 600, maxWidth: 380 } },
        ...(opt.en ? [{ text: opt.en, style: { ...TS.bubbleSub, size: 26, maxWidth: 380 } }] : []),
      ], { pad: 2, scale: 1.5 });
      const padX = 44, padY = 34;
      const W = mt.width / 1.5 + padX * 2, H = mt.height / 1.5 + padY * 2;
      const mat = makeCloudMaterial({ style: 'speech', tailSpace: 0, fill: o.colors?.[i] ?? 0xfffbf2, depthTest: false });
      mat.uniforms.uText.value = canvasTexture(mt.canvas);
      mat.uniforms.uHasText.value = 1;
      mat.uniforms.uSize.value.set(W, H);
      mat.uniforms.uTextRect.value.set(padX / W, padY / H, 1 - padX / W, 1 - padY / H);
      mat.uniforms.uLines.value = mt.lines;
      const s = 0.00105;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * s, H * s), mat);
      mesh.renderOrder = 2001;
      const baseX = (i - (n - 1) / 2) * spacing;
      mesh.position.set(baseX, -0.2, -0.9);
      this.group.add(mesh);
      this.bubbles.push({ mesh, mat, tex: mat.uniforms.uText.value, baseX });
    });
    this.fuse = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), new THREE.ShaderMaterial({
      vertexShader: fuseVert, fragmentShader: fuseFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uK: { value: 1 }, uT: { value: 0 } },
    }));
    this.fuse.position.set(0, 0.02, -0.9);
    this.fuse.renderOrder = 2002;
    this.group.add(this.fuse);
    camera.add(this.group);
    this.sel = Math.floor((n - 1) / 2);
    this.tick = Sound.loop('tick_tock_loop', { vol: 0.6 });
    Sound.play('cloud_poof', { vol: 0.5 });
  }

  /** returns false when finished */
  update(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const k = 1 - this.t / this.seconds;
    (this.fuse.material as THREE.ShaderMaterial).uniforms.uK.value = Math.max(0, k);
    (this.fuse.material as THREE.ShaderMaterial).uniforms.uT.value = this.t;
    // input
    for (let i = 0; i < this.bubbles.length; i++) if (Input.wasPressed('Digit' + (i + 1)) || Input.wasPressed('Numpad' + (i + 1))) { Input.consume('Digit' + (i + 1)); return this.pick(i); }
    this.acc += Input.mouseDX;
    if (Math.abs(this.acc) > 90) { this.sel = Math.max(0, Math.min(this.bubbles.length - 1, this.sel + Math.sign(this.acc))); this.acc = 0; Sound.play('bubble_pop', { vol: 0.25, pitch: 1.5 }); }
    if (Input.wheel) this.sel = Math.max(0, Math.min(this.bubbles.length - 1, this.sel + Input.wheel));
    if (Input.mousePressed(0)) { Input.consumeMouse(0); return this.pick(this.sel); }
    // visuals
    this.bubbles.forEach((b, i) => {
      const pop = Ease.outBack(Math.min(1, (this.t - i * 0.06) / 0.25));
      const hi = i === this.sel ? 1 : 0;
      const s = Math.max(0.001, pop) * (1 + hi * 0.12);
      b.mesh.scale.setScalar(s);
      b.mesh.position.y = -0.2 + hi * 0.035 + Math.sin(this.t * 6 + i) * 0.004;
      b.mat.uniforms.uTime.value = this.t;
      b.mat.uniforms.uInk.value.set(hi ? 0xc0392b : 0x2a2420);
      // panic shake when time is nearly up
      if (k < 0.35) b.mesh.position.x = b.baseX + Math.sin(this.t * 60 + i) * 0.004 * (1 - k / 0.35);
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
    for (const b of this.bubbles) { b.mesh.geometry.dispose(); b.mat.dispose(); b.tex.dispose(); }
    this.fuse.geometry.dispose();
    (this.fuse.material as THREE.Material).dispose();
  }
}
