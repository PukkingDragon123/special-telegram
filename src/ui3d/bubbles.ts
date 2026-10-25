import * as THREE from 'three';
import type { TextStyle } from './text';
import { Text3D, Text3DOpts, Font3D, preloadText3D } from './text3d';
import { Sound } from '../core/audio';
import { Ease, TL, clamp } from '../core/util';
import { ChoicePrompt, ChoiceOpts } from './choice';

/**
 * Diegetic 3D UI — NO bubbles, panels or plates: every line is real extruded 3D lettering floating in the
 * world (see text3d.ts). say = warm cream letters typing in above the speaker's head, think = soft pastel
 * translucent letters drifting up, shout = big hot letters that slam in and shake, popup = chunky metal
 * numbers that spring up and sink away, tag = small clean label lettering. Lines face the camera with a
 * little lag + tilt (objects in space, not stickers) and scale gently with distance to stay readable.
 */
export type Anchor = THREE.Object3D | THREE.Vector3 | (() => THREE.Vector3 | null);

export interface SayOpts {
  style?: 'speech' | 'thought' | 'shout';
  /** seconds the line stays after the text is revealed (default from text length; Infinity = until closed) */
  duration?: number;
  /** metres above the anchor */
  offset?: number;
  /** small English subtitle */
  sub?: string;
  /** babble pitch; 0 = silent */
  voice?: number;
  /** (legacy bubble fill — ignored, there is no bubble any more) */
  fill?: THREE.ColorRepresentation;
  /** side / extrusion colour of the lettering */
  ink?: THREE.ColorRepresentation;
  /** (legacy, ignored) */
  tailX?: number;
  /** characters revealed per second (default 38) */
  cps?: number;
  /** font family + colour are mapped onto the 3D lettering */
  textStyle?: TextStyle;
  onDone?: () => void;
  /** visible through walls */
  xray?: boolean;
  scale?: number;
}

export interface BubbleHandle { close(): void; readonly alive: boolean; mesh: THREE.Object3D }

export interface TagHandle { set(text: string, sub?: string): void; remove(): void; mesh: THREE.Object3D; visible: boolean }

type Kind = 'say' | 'think' | 'shout' | 'popup' | 'tag';

interface Live {
  kind: Kind;
  group: THREE.Group;
  main: Text3D;
  sub: Text3D | null;
  anchor: Anchor;
  offset: number;
  age: number;
  life: number;
  cps: number;
  revF: number;
  revealedAt: number;
  closing: number;
  closeDur: number;
  key: any;
  voice: number;
  lastBabble: number;
  onDone?: () => void;
  baseScale: number;
  seed: number;
  quat: THREE.Quaternion;
  init: boolean;
  rise: number;
}

/** looks (letter sizes are metres at the reference distance; lines grow with distance like before) */
const LOOK: Record<string, Text3DOpts> = {
  say: {
    font: 'talk', size: 0.042, depth: 0.34, bevel: 0.075, color: 0xfff0d2, side: 0x6a3418, roughness: 0.36, emissive: 0.24,
    maxWidth: 0.95, valign: 'bottom', anim: { pop: 0.3, rise: 0.45, spin: 1, vanish: 0.26, drift: 0.4 },
  },
  saySub: {
    font: 'ui', size: 0.0175, depth: 0.2, bevel: 0.05, color: 0xefe3cf, side: 0x3b2c22, roughness: 0.5, emissive: 0.2,
    maxWidth: 0.95, valign: 'bottom', anim: { pop: 0.25, rise: 0.3, spin: 0.6, vanish: 0.22, drift: 0.3 },
  },
  shout: {
    font: 'heavy', size: 0.056, depth: 0.42, bevel: 0.08, color: 0xff6526, side: 0x7d1006, roughness: 0.32, emissive: 0.32,
    maxWidth: 1.1, valign: 'bottom', anim: { pop: 0.16, rise: 0.0, spin: 0.35, vanish: 0.22, drift: 0.2, shake: 0.012 },
  },
  shoutSub: {
    font: 'ui', size: 0.02, depth: 0.22, bevel: 0.05, color: 0xffd8bf, side: 0x6a1c0c, roughness: 0.45, emissive: 0.25,
    maxWidth: 1.1, valign: 'bottom', anim: { pop: 0.2, rise: 0.2, spin: 0.5, vanish: 0.2, drift: 0.2 },
  },
  think: {
    font: 'hand', size: 0.04, depth: 0.22, bevel: 0.06, color: 0xdfe8ff, side: 0x8e9bd6, roughness: 0.3, emissive: 0.42,
    opacity: 0.84, rim: 0xc9b8ff, rimStrength: 0.55, maxWidth: 0.9, valign: 'bottom',
    anim: { pop: 0.5, rise: 0.25, spin: 0.5, vanish: 0.4, drift: 0.9, wobble: 0.035 },
  },
  thinkSub: {
    font: 'ui', size: 0.017, depth: 0.16, bevel: 0.04, color: 0xe9e1ff, side: 0x7d74ad, roughness: 0.4, emissive: 0.35,
    opacity: 0.8, maxWidth: 0.9, valign: 'bottom', anim: { pop: 0.4, rise: 0.2, spin: 0.4, vanish: 0.35, drift: 0.7, wobble: 0.02 },
  },
  popup: {
    font: 'heavy', size: 0.06, depth: 0.38, bevel: 0.09, color: 0xffd45a, metalness: 0.85, roughness: 0.24, emissive: 0.16,
    bevelFace: true, maxWidth: 1.6, valign: 'middle', anim: { pop: 0.36, rise: 0.5, spin: 1.3, vanish: 0.34, drift: -0.7 },
  },
  tag: {
    font: 'ui', size: 0.06, depth: 0.22, bevel: 0.05, color: 0xfffaf0, side: 0x2a231d, roughness: 0.45, emissive: 0.38,
    xray: true, castShadow: false, maxWidth: 1.6, valign: 'bottom', anim: { pop: 0.22, rise: 0.2, spin: 0.4, vanish: 0.18, drift: 0.2 },
  },
  tagSub: {
    font: 'ui', size: 0.032, depth: 0.16, bevel: 0.04, color: 0xd8cdbb, side: 0x26201b, roughness: 0.5, emissive: 0.3,
    xray: true, castShadow: false, maxWidth: 1.6, valign: 'bottom', anim: { pop: 0.2, rise: 0.15, spin: 0.3, vanish: 0.15, drift: 0.15 },
  },
};

/** map a canvas font family (F.*) onto the closest 3D face */
export function font3DFromFamily(f?: string): Font3D | null {
  if (!f) return null;
  if (/Krub/i.test(f)) return 'talk';
  if (/K2D/i.test(f)) return 'heavy';
  if (/Kodchasan|KoHo|Mali/i.test(f)) return 'bubbly';
  if (/Chonburi/i.test(f)) return 'display';
  if (/Itim|Sriracha/i.test(f)) return 'hand';
  if (/Taviraj|Trirong|Serif|Charm|Srisakdi|Fahkwang|Maitree|Pridi/i.test(f)) return 'news';
  if (/IBM|Sarabun|Noto Sans/i.test(f)) return 'ui';
  return null;
}

function anchorPos(a: Anchor, out: THREE.Vector3): boolean {
  if (typeof a === 'function') { const v = a(); if (!v) return false; out.copy(v); return true; }
  if ((a as THREE.Object3D).isObject3D) { (a as THREE.Object3D).getWorldPosition(out); return true; }
  out.copy(a as THREE.Vector3);
  return true;
}

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _e = new THREE.Euler();
const _cam = new THREE.Vector3();

export class UI3D {
  readonly root = new THREE.Group();
  private live: Live[] = [];
  private byKey = new Map<any, Live>();
  private camera: THREE.Camera | null = null;
  private tmp = new THREE.Vector3();
  private time = 0;

  constructor() {
    this.root.name = 'ui3d';
    this.root.renderOrder = 10;
    preloadText3D();
  }

  /** Attach to the active scene. */
  setScene(scene: THREE.Scene, camera: THREE.Camera) {
    scene.add(this.root);
    this.camera = camera;
  }

  private makeLive(kind: Kind, main: Text3D, sub: Text3D | null, anchor: Anchor, extra: Partial<Live>): Live {
    const group = new THREE.Group();
    group.name = 'ui3d-' + kind;
    group.add(main);
    if (sub) group.add(sub);
    group.visible = false; // until first update positions it
    this.root.add(group);
    const L: Live = {
      kind, group, main, sub, anchor, offset: 0.35, age: 0, life: 3, cps: 38, revF: 0, revealedAt: -1, closing: -1, closeDur: 0.3,
      key: null, voice: 0, lastBabble: 0, baseScale: 1, seed: Math.random() * 100, quat: new THREE.Quaternion(), init: false, rise: 0,
      ...extra,
    };
    this.live.push(L);
    return L;
  }

  /** Speech above an anchor — floating 3D words. One line per anchor: saying again replaces it. */
  say(anchor: Anchor, text: string | TL, o: SayOpts = {}): BubbleHandle {
    const th = typeof text === 'string' ? text : text.th;
    const subText = o.sub ?? (typeof text === 'string' ? undefined : text.en);
    const key = (anchor as any).isObject3D || typeof anchor === 'function' ? anchor : null;
    if (key && this.byKey.has(key)) {
      const old = this.byKey.get(key)!;
      old.onDone = undefined;
      this.byKey.delete(key);
      this.kill(old, false, 0.004);
    }
    const style = o.style ?? 'speech';
    const kind: Kind = style === 'thought' ? 'think' : style === 'shout' ? 'shout' : 'say';
    const base = kind === 'say' ? LOOK.say : LOOK[kind];
    const mo: Text3DOpts = { ...base, xray: o.xray ?? base.xray };
    const fam = font3DFromFamily(o.textStyle?.font);
    if (fam) mo.font = fam;
    if (o.textStyle?.color) mo.color = o.textStyle.color;
    if (o.ink !== undefined) mo.side = o.ink;
    const main = new Text3D(th, mo);
    main.reveal = 0;
    let sub: Text3D | null = null;
    if (subText) {
      const so = kind === 'say' ? LOOK.saySub : LOOK[kind + 'Sub'];
      sub = new Text3D(subText, { ...so, xray: o.xray ?? so.xray });
      sub.reveal = 0;
    }
    const chars = th.length + (subText?.length ?? 0) * 0.3;
    const L = this.makeLive(kind, main, sub, anchor, {
      offset: o.offset ?? 0.35,
      life: o.duration ?? clamp(2.2 + chars * 0.07, 2.5, 9),
      cps: o.cps ?? (kind === 'shout' ? 70 : 38),
      key, voice: kind === 'think' ? 0 : o.voice ?? 1,
      onDone: o.onDone, baseScale: o.scale ?? 1,
    });
    if (key) this.byKey.set(key, L);
    if (L.voice > 0) {
      this.posOf(L);
      Sound.play('bubble_pop', { pos: this.tmp.clone(), vol: 0.5, pitch: kind === 'shout' ? 0.75 : 1 });
    }
    return { close: () => this.kill(L, false), get alive() { return L.closing < 0; }, mesh: L.group };
  }

  /** Thought — soft pastel translucent letters that drift up and wobble. */
  think(anchor: Anchor, text: string | TL, o: SayOpts = {}) { return this.say(anchor, text, { ...o, style: 'thought', voice: 0 }); }
  /** Angry / loud shout — big hot letters that slam in and shake. */
  shout(anchor: Anchor, text: string | TL, o: SayOpts = {}) { return this.say(anchor, text, { ...o, style: 'shout', cps: o.cps ?? 70 }); }

  /** Floating pop-up — chunky metal lettering that springs up, spins a little and sinks away (money, "อร่อย!", XP …). */
  popup(pos: THREE.Vector3, text: string, o: { style?: TextStyle; dur?: number; rise?: number; scale?: number } = {}) {
    const st = o.style;
    const po: Text3DOpts = { ...LOOK.popup };
    const fam = font3DFromFamily(st?.font);
    if (fam) po.font = fam;
    if (st?.color) {
      po.color = st.color;
      po.side = new THREE.Color(st.color as any).multiplyScalar(0.5);
    }
    if (st?.size) po.size = LOOK.popup.size! * clamp(st.size / 64, 0.55, 1.4);
    const main = new Text3D(text, po);
    main.popIn(0.035);
    const L = this.makeLive('popup', main, null, pos.clone(), { offset: 0, life: o.dur ?? 1.6, rise: o.rise ?? 0.9, baseScale: o.scale ?? 1 });
    L.revealedAt = 0;
  }

  /** Small floating label lettering that follows an anchor (e.g. "หมูสับ 120 g", "[E] หยิบ"). */
  tag(anchor: Anchor, text: string, sub?: string, o: { offset?: number; scale?: number } = {}): TagHandle {
    let L: Live | null = null;
    let cur = '';
    const self = this;
    const make = (t: string, s?: string) => {
      const k = t + '|' + (s ?? '');
      if (k === cur && L) return;
      cur = k;
      if (L && L.closing < 0) {
        // live update: relayout in place (glyph geometry is cached, no new materials)
        L.main.setText(t);
        if (s) {
          if (L.sub) L.sub.setText(s);
          else { L.sub = new Text3D(s, LOOK.tagSub); L.group.add(L.sub); }
        } else if (L.sub) { L.sub.dispose(); L.sub = null; }
        return;
      }
      const main = new Text3D(t, LOOK.tag);
      main.popIn(0.012);
      const subT = s ? new Text3D(s, LOOK.tagSub) : null;
      subT?.popIn(0.01);
      L = this.makeLive('tag', main, subT, anchor, { offset: o.offset ?? 0.12, life: Infinity, baseScale: o.scale ?? 0.55 });
      L.revealedAt = 0;
      h.mesh = L.group;
    };
    const h: TagHandle = {
      mesh: null as any,
      set: (t, s) => make(t, s),
      remove: () => { if (L) self.kill(L, false, 0.004); L = null; cur = ''; },
      get visible() { return !!L && L.group.visible; },
      set visible(v: boolean) { if (L) (L as any).hidden = !v; },
    };
    make(text, sub);
    return h;
  }

  private posOf(L: Live) { anchorPos(L.anchor, this.tmp); return this.tmp; }

  private kill(L: Live, instant: boolean, stagger = 0.012) {
    if (instant) { this.dispose(L); return; }
    if (L.closing >= 0) return;
    L.closing = 0;
    L.closeDur = Math.max(L.main.vanish(stagger), L.sub ? L.sub.vanish(stagger) : 0) + 0.05;
  }

  private dispose(L: Live) {
    const i = this.live.indexOf(L);
    if (i >= 0) this.live.splice(i, 1);
    if (L.key && this.byKey.get(L.key) === L) this.byKey.delete(L.key);
    L.main.dispose();
    L.sub?.dispose();
    L.group.removeFromParent();
  }

  closeAll() { for (const L of [...this.live]) if (L.kind !== 'tag') this.dispose(L); this.choice?.cancel(); this.choice = null; }

  // ------------------------------------------------------------------ quick choice (mad system / bargaining)
  private choice: ChoicePrompt | null = null;
  /** true while a quick-choice is on screen (the player controller ignores slot keys). */
  get choosing() { return !!this.choice; }
  /** Show 2–3 reply options as floating 3D words in front of the local camera, with a burning incense stick (default 3 s). */
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
    cam.getWorldPosition(_cam);
    for (let li = this.live.length - 1; li >= 0; li--) {
      const L = this.live[li];
      if (!L) continue;
      L.age += dt;
      const g = L.group;
      if ((L as any).hidden || !anchorPos(L.anchor, this.tmp)) { g.visible = false; continue; }
      g.visible = true;
      const main = L.main, sub = L.sub;
      // stack: main line sits on top of the small English line
      if (sub) main.position.y = sub.height + main.height * 0.04 + 0.004;

      if (L.kind === 'popup') { this.updatePopup(L, dt); continue; }

      // ---- typewriter reveal (glyph by glyph, babble)
      if (L.revealedAt < 0 && main.isReady) {
        const n = main.glyphCount;
        const before = Math.floor(L.revF);
        L.revF = Math.min(n, L.revF + dt * L.cps);
        main.reveal = L.revF;
        if (sub && sub.isReady) sub.reveal = n ? (sub.glyphCount * L.revF) / n : Infinity;
        const after = Math.floor(L.revF);
        if (L.voice > 0 && after !== before && after < n && L.age - L.lastBabble > 0.075) {
          L.lastBabble = L.age;
          Sound.play('babble', { pos: g.position, vol: 0.45, pitch: L.voice });
        }
        if (L.revF >= n && (!sub || sub.isReady)) { L.revealedAt = L.age; if (sub) sub.reveal = Infinity; }
      }
      if (L.closing < 0 && L.revealedAt >= 0 && L.age > L.revealedAt + L.life) this.kill(L, false);

      // ---- placement
      const p = g.position.copy(this.tmp);
      p.y += L.offset;
      const dist = p.distanceTo(_cam);
      let s = L.baseScale;
      if (L.kind === 'tag') s *= clamp(dist / 2.2, 0.45, 2.0);
      else {
        s *= clamp(dist / 2.0, 0.8, 6);
        s *= clamp(1 - (dist - 22) / 8, 0, 1); // far lines shrink away (keeps the screen clean)
      }
      if (L.kind === 'think') p.y += Math.min(L.age, 6) * 0.03 * s;
      if (L.kind !== 'tag') p.y += Math.sin(L.age * 1.7 + L.seed) * 0.012 * s;
      if (L.kind === 'shout') {
        // slam in: starts big, lands with a punch + tiny recoil
        const k = Math.min(1, L.age / 0.17);
        s *= k < 1 ? 1 + (1 - Ease.outCubic(k)) * 1.1 : 1 - Math.sin(Math.min(1, (L.age - 0.17) / 0.18) * Math.PI) * 0.06;
      }
      if (L.closing >= 0) {
        L.closing += dt;
        if (L.closing >= L.closeDur) { const cb = L.onDone; this.dispose(L); cb?.(); continue; }
      }
      if (s < 0.004) { g.visible = false; continue; }
      g.scale.setScalar(s);

      // ---- face the camera with a little lag + living tilt (an object in space, not a sticker)
      _m.lookAt(_cam, p, UP);
      _q.setFromRotationMatrix(_m);
      const t = L.age, sd = L.seed;
      if (L.kind === 'tag') _e.set(0, 0, 0);
      else if (L.kind === 'shout') _e.set(Math.sin(t * 2.3 + sd) * 0.05, Math.sin(t * 1.9 + sd) * 0.1, Math.sin(t * 2.7 + sd) * 0.05);
      else _e.set(-0.05 + Math.sin(t * 0.6 + sd * 2) * 0.05, Math.sin(t * 0.8 + sd) * 0.13, Math.sin(t * 0.9 + sd) * 0.035);
      _q.multiply(_qt.setFromEuler(_e));
      if (!L.init) { L.quat.copy(_q); L.init = true; }
      else L.quat.slerp(_q, 1 - Math.exp(-dt * (L.kind === 'tag' ? 14 : 5)));
      g.quaternion.copy(L.quat);
    }
  }

  private updatePopup(L: Live, dt: number) {
    const g = L.group;
    const k = L.age / L.life;
    const base = L.anchor as THREE.Vector3;
    const up = k < 0.45 ? Ease.outBack(k / 0.45, 1.4) : 1 + Math.sin((k - 0.45) * 6) * 0.03;
    g.position.copy(base);
    g.position.y += up * L.rise * 0.75;
    const dist = g.position.distanceTo(_cam);
    g.scale.setScalar(L.baseScale * clamp(dist / 3, 0.7, 3));
    if (L.closing < 0 && k > 0.66) this.kill(L, false, 0.02);
    if (L.closing >= 0) {
      L.closing += dt;
      if (L.closing >= L.closeDur) { this.dispose(L); return; }
    }
    _m.lookAt(_cam, g.position, UP);
    _q.setFromRotationMatrix(_m);
    const spin = (1 - Ease.outBack(Math.min(1, L.age / 0.6), 2.4)) * 2.4 + Math.sin(L.age * 3 + L.seed) * 0.08;
    _q.multiply(_qt.setFromEuler(_e.set(0, spin, Math.sin(L.age * 2.2 + L.seed) * 0.04)));
    g.quaternion.copy(_q);
  }
}
