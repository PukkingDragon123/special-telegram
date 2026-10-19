import * as THREE from 'three';
import { makeCloudMaterial, CLOUD_STYLE } from './cloud';
import { renderText, canvasTexture, TS, TextStyle } from './text';
import { Sound } from '../core/audio';
import { Ease, TL, clamp } from '../core/util';
import { ChoicePrompt, ChoiceOpts } from './choice';

/**
 * Diegetic 3D UI: speech bubbles, thought puffs, shouts, floating pop-up text and small tags
 * (like Cooking Simulator's "1 g Pouring" label). Everything billboards toward the camera and
 * scales up slightly with distance so it stays readable.
 */
export type Anchor = THREE.Object3D | THREE.Vector3 | (() => THREE.Vector3 | null);

export interface SayOpts {
  style?: 'speech' | 'thought' | 'shout';
  /** seconds the bubble stays after the text is revealed (default from text length; Infinity = until closed) */
  duration?: number;
  /** metres above the anchor */
  offset?: number;
  /** small English subtitle */
  sub?: string;
  /** babble pitch; 0 = silent */
  voice?: number;
  fill?: THREE.ColorRepresentation;
  ink?: THREE.ColorRepresentation;
  tailX?: number;
  /** characters revealed per second (default 38) */
  cps?: number;
  textStyle?: TextStyle;
  onDone?: () => void;
  /** visible through walls */
  xray?: boolean;
  scale?: number;
}

export interface BubbleHandle { close(): void; readonly alive: boolean; mesh: THREE.Mesh }

export interface TagHandle { set(text: string, sub?: string): void; remove(): void; mesh: THREE.Mesh; visible: boolean }

const PX = 0.0015; // metres per canvas px at scale 1

interface Live {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  anchor: Anchor;
  offset: number;
  age: number;
  life: number;
  reveal: number;
  revealTotal: number;
  cps: number;
  closing: number;
  key: any;
  voice: number;
  lastBabble: number;
  onDone?: () => void;
  baseScale: number;
  kind: 'bubble' | 'popup' | 'tag';
  rise?: number;
  tex?: THREE.Texture;
}

function anchorPos(a: Anchor, out: THREE.Vector3): boolean {
  if (typeof a === 'function') { const v = a(); if (!v) return false; out.copy(v); return true; }
  if ((a as THREE.Object3D).isObject3D) { (a as THREE.Object3D).getWorldPosition(out); return true; }
  out.copy(a as THREE.Vector3);
  return true;
}

export class UI3D {
  readonly root = new THREE.Group();
  private live: Live[] = [];
  private byKey = new Map<any, Live>();
  private camera: THREE.Camera | null = null;
  private tmp = new THREE.Vector3();
  private time = 0;

  constructor() { this.root.name = 'ui3d'; this.root.renderOrder = 10; }

  /** Attach to the active scene. */
  setScene(scene: THREE.Scene, camera: THREE.Camera) {
    scene.add(this.root);
    this.camera = camera;
  }

  private build(text: string, sub: string | undefined, style: keyof typeof CLOUD_STYLE, o: { fill?: any; ink?: any; tailX?: number; textStyle?: TextStyle; xray?: boolean; tail?: boolean }) {
    const isTag = style === 'tag';
    const main: TextStyle = o.textStyle ?? (isTag ? TS.tag : TS.bubble);
    const blocks = [{ text, style: main }];
    if (sub) blocks.push({ text: sub, style: isTag ? TS.tagSub : TS.bubbleSub });
    const mt = renderText(blocks, { pad: 2, scale: 1.5 });
    const padX = isTag ? 26 : style === 'thought' ? 90 : 62;
    const padY = isTag ? 16 : style === 'thought' ? 70 : 44;
    const tailSpace = isTag || o.tail === false ? 0 : style === 'thought' ? 0.3 : 0.22;
    const tw = mt.width / 1.5, th = mt.height / 1.5;
    const W = tw + padX * 2;
    const bodyH = th + padY * 2;
    const H = bodyH / (1 - tailSpace);
    const mat = makeCloudMaterial({ style, fill: o.fill ?? (isTag ? 0x15120f : 0xfffbf2), ink: o.ink, fillAlpha: isTag ? 0.8 : 1, tailSpace, tailX: o.tailX ?? -0.45, depthTest: !(o.xray || isTag), puff: isTag ? 0.3 : 1 });
    const tex = canvasTexture(mt.canvas);
    mat.uniforms.uText.value = tex;
    mat.uniforms.uHasText.value = 1;
    mat.uniforms.uSize.value.set(W, H);
    mat.uniforms.uTextRect.value.set(padX / W, tailSpace + (padY / H), 1 - padX / W, 1 - padY / H);
    mat.uniforms.uLines.value = mt.lines;
    const geo = new THREE.PlaneGeometry(W * PX, H * PX);
    geo.translate(0, (H * PX) / 2, 0); // pivot at the tail tip
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = isTag ? 1001 : 1000;
    mesh.frustumCulled = false;
    return { mesh, mat, tex, lines: mt.lines };
  }

  /** Speech bubble above an anchor. One bubble per anchor: saying again replaces it. */
  say(anchor: Anchor, text: string | TL, o: SayOpts = {}): BubbleHandle {
    const th = typeof text === 'string' ? text : text.th;
    const sub = o.sub ?? (typeof text === 'string' ? undefined : text.en);
    const key = (anchor as any).isObject3D || typeof anchor === 'function' ? anchor : null;
    if (key && this.byKey.has(key)) this.kill(this.byKey.get(key)!, true);
    const style = o.style ?? 'speech';
    const { mesh, mat, tex, lines } = this.build(th, sub, style, { fill: o.fill, ink: o.ink, tailX: o.tailX, textStyle: o.textStyle, xray: o.xray });
    this.root.add(mesh);
    const chars = th.length + (sub?.length ?? 0) * 0.3;
    const L: Live = {
      mesh, mat, tex, anchor, offset: o.offset ?? 0.35, age: 0,
      life: o.duration ?? clamp(2.2 + chars * 0.07, 2.5, 9),
      reveal: 0, revealTotal: lines, cps: o.cps ?? 38, closing: -1, key, voice: o.voice ?? 1, lastBabble: 0,
      onDone: o.onDone, baseScale: o.scale ?? 1, kind: 'bubble',
    };
    // reveal speed in "lines per second" from chars per second
    (L as any).lps = Math.max(0.6, (o.cps ?? 38) / Math.max(6, th.length / lines));
    mat.uniforms.uReveal.value = 0;
    this.live.push(L);
    if (key) this.byKey.set(key, L);
    if (L.voice > 0) Sound.play('bubble_pop', { pos: this.posOf(L), vol: 0.5 });
    const h: BubbleHandle = { close: () => this.kill(L, false), get alive() { return L.closing < 0; }, mesh };
    return h;
  }

  /** Thought puff (cloud style). */
  think(anchor: Anchor, text: string | TL, o: SayOpts = {}) { return this.say(anchor, text, { ...o, style: 'thought', voice: 0 }); }
  /** Angry / loud shout bubble. */
  shout(anchor: Anchor, text: string | TL, o: SayOpts = {}) { return this.say(anchor, text, { ...o, style: 'shout', fill: o.fill ?? 0xfff3d6, cps: 70 }); }

  /** Floating pop-up text that rises and fades (money, "อร่อย!", XP …). */
  popup(pos: THREE.Vector3, text: string, o: { style?: TextStyle; dur?: number; rise?: number; scale?: number } = {}) {
    const mt = renderText([{ text, style: o.style ?? TS.popup }], { pad: 6, scale: 1.5 });
    const tex = canvasTexture(mt.canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const w = (mt.width / 1.5) * PX, h = (mt.height / 1.5) * PX;
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, mat as any);
    mesh.renderOrder = 1002;
    mesh.position.copy(pos);
    this.root.add(mesh);
    const L: Live = { mesh, mat: mat as any, tex, anchor: pos.clone(), offset: 0, age: 0, life: o.dur ?? 1.6, reveal: 0, revealTotal: 1, cps: 0, closing: -1, key: null, voice: 0, lastBabble: 0, baseScale: o.scale ?? 1, kind: 'popup', rise: o.rise ?? 0.9 };
    this.live.push(L);
  }

  /** Small dark label that follows an anchor (e.g. "หมูสับ 120 g", "[E] หยิบ"). */
  tag(anchor: Anchor, text: string, sub?: string, o: { offset?: number; scale?: number } = {}): TagHandle {
    let cur = '';
    let L: Live | null = null;
    const self = this;
    const make = (t: string, s?: string) => {
      const key = t + '|' + (s ?? '');
      if (key === cur && L) return;
      cur = key;
      const old = L;
      const { mesh, mat, tex } = this.build(t, s, 'tag', {});
      mesh.renderOrder = 1001;
      this.root.add(mesh);
      L = { mesh, mat, tex, anchor, offset: o.offset ?? 0.12, age: old ? 1 : 0, life: Infinity, reveal: 99, revealTotal: 1, cps: 0, closing: -1, key: null, voice: 0, lastBabble: 0, baseScale: o.scale ?? 0.55, kind: 'tag' };
      mat.uniforms.uReveal.value = 99;
      this.live.push(L);
      if (old) this.dispose(old);
      h.mesh = mesh;
    };
    const h: TagHandle = {
      mesh: null as any,
      set: (t, s) => make(t, s),
      remove: () => { if (L) self.kill(L, true); L = null; cur = ''; },
      get visible() { return !!L && L.mesh.visible; },
      set visible(v: boolean) { if (L) L.mesh.visible = v; },
    };
    make(text, sub);
    return h;
  }

  private posOf(L: Live) { anchorPos(L.anchor, this.tmp); return this.tmp.clone(); }

  private kill(L: Live, instant: boolean) {
    if (instant) { this.dispose(L); return; }
    if (L.closing < 0) L.closing = 0;
  }

  private dispose(L: Live) {
    const i = this.live.indexOf(L);
    if (i >= 0) this.live.splice(i, 1);
    if (L.key && this.byKey.get(L.key) === L) this.byKey.delete(L.key);
    L.mesh.removeFromParent();
    L.mesh.geometry.dispose();
    L.mat.dispose();
    L.tex?.dispose();
  }

  closeAll() { for (const L of [...this.live]) if (L.kind !== 'tag') this.dispose(L); this.choice?.cancel(); this.choice = null; }

  // ------------------------------------------------------------------ quick choice (mad system / bargaining)
  private choice: ChoicePrompt | null = null;
  /** true while a quick-choice is on screen (the player controller ignores slot keys). */
  get choosing() { return !!this.choice; }
  /** Show 2–3 reply options in front of the local camera with a burning fuse (default 3 s). */
  choose(o: ChoiceOpts): ChoicePrompt | null {
    this.choice?.cancel();
    if (!this.camera) { o.onPick(-1); return null; }
    this.choice = new ChoicePrompt(this.camera, o);
    return this.choice;
  }

  update(dt: number) {
    this.time += dt;
    const cam = this.camera;
    if (!cam) return;
    if (this.choice && !this.choice.update(dt)) this.choice = null;
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    for (const L of [...this.live]) {
      L.age += dt;
      if (!anchorPos(L.anchor, this.tmp)) { L.mesh.visible = false; continue; }
      if (L.kind === 'popup') {
        const k = L.age / L.life;
        L.mesh.position.copy(L.anchor as THREE.Vector3).add(new THREE.Vector3(0, Ease.outCubic(Math.min(1, k)) * (L.rise ?? 0.9), 0));
        const pop = k < 0.12 ? Ease.outBack(k / 0.12) : 1;
        const dist = L.mesh.position.distanceTo(camPos);
        L.mesh.scale.setScalar(pop * L.baseScale * clamp(dist / 3, 0.7, 3));
        (L.mat as any).opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        L.mesh.quaternion.copy(cam.quaternion);
        if (k >= 1) this.dispose(L);
        continue;
      }
      L.mesh.visible = true;
      L.mesh.position.copy(this.tmp).y += L.offset;
      L.mesh.quaternion.copy(cam.quaternion);
      const dist = L.mesh.position.distanceTo(camPos);
      const distK = L.kind === 'tag' ? clamp(dist / 2.2, 0.45, 2.0) : clamp(dist / 2.0, 0.8, 6);
      // far bubbles fade out (keeps the screen clean)
      if (L.kind === 'bubble') L.mat.uniforms.uOpacity.value = L.closing >= 0 ? L.mat.uniforms.uOpacity.value : clamp(1 - (dist - 22) / 8, 0, 1);
      let s = 1;
      if (L.age < 0.35) s = Ease.outBack(Math.min(1, L.age / 0.3), 2.2);
      const u = L.mat.uniforms;
      u.uTime.value = this.time;
      if (L.kind === 'bubble') {
        const lps = (L as any).lps as number;
        const before = Math.floor(L.reveal * 8);
        L.reveal = Math.min(L.revealTotal + 0.001, L.reveal + dt * lps);
        u.uReveal.value = L.reveal;
        if (L.voice > 0 && L.reveal < L.revealTotal && Math.floor(L.reveal * 8) !== before && L.age - L.lastBabble > 0.07) {
          L.lastBabble = L.age;
          Sound.play('babble', { pos: L.mesh.position, vol: 0.45, pitch: L.voice });
        }
        const revealedAt = L.revealTotal / lps;
        if (L.closing < 0 && L.age > revealedAt + L.life) L.closing = 0;
      }
      if (L.closing >= 0) {
        L.closing += dt;
        const k = Math.min(1, L.closing / 0.22);
        s *= 1 - Ease.inQuad(k) * 0.6;
        u.uOpacity.value = 1 - k;
        if (k >= 1) { L.onDone?.(); this.dispose(L); continue; }
      }
      L.mesh.scale.setScalar(s * distK * L.baseScale);
    }
  }
}
