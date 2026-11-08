import * as THREE from 'three';
import { Text3D, Text3DOpts } from './text3d';
import { Input } from '../core/input';
import { Sound } from '../core/audio';
import { Ease } from '../core/util';
import { Speaker, speakStart, speakStop } from './mood';
import type { Expression } from '../game/contracts';

/* ============================================================================================
 * DIALOGUE 3D — the "talk to an NPC" presentation (used by the quests module).
 *
 *  - the NPC's line: real extruded Thai lettering floating beside the speaker's head (world space, always
 *    faces the camera, constant on-screen size), typewriter reveal with every glyph popping in + voice
 *    blips, the speaker's name tag in their colour above it and a smaller English line under it;
 *  - the player's responses: 3D cards floating at the bottom of the view (camera space) with a gold number
 *    badge, Thai + English, a dark glassy plate; hover with the mouse (or ↑↓ / wheel), pick with 1-9 / click /
 *    E; locked answers are greyed out with their reason; no options → a "ต่อ ▸" card.
 *  - everything bobs a little and pops in / out (juicy, never a flat DOM panel).
 * Local-only UI: the caller decides what a pick means.
 * ========================================================================================== */

export interface DlgViewOption { th: string; en?: string; locked?: string | null; tone?: 'quest' | 'money' | 'leave' | null }
export interface DlgLineSpec {
  name: string; nameEn?: string; th: string; en?: string; color?: number; voice?: number; head: () => THREE.Vector3 | null;
  /** the speaking character (mouth flap while the line types + expression); optional */
  speaker?: () => Speaker | null;
  /** expression for the line (default: guessed from the text; null = leave the face alone) */
  mood?: Expression | null;
}
export interface DlgEvents { picked?: number; cont?: boolean; leave?: boolean; buzz?: number }

const LINE: Text3DOpts = {
  font: 'talk', size: 0.043, depth: 0.28, bevel: 0.06, color: 0xfff4de, side: 0x41281a, roughness: 0.35, emissive: 0.42, shadow: 0.65,
  xray: true, castShadow: false, align: 'left', valign: 'top', lineHeight: 1.36, anim: { pop: 0.26, rise: 0.5, spin: 0.8, vanish: 0.34, drift: 0.5, wave: 0.035, squash: 1.1, glint: 0.55 },
};
const LINE_EN: Text3DOpts = {
  font: 'ui', size: 0.02, depth: 0.2, bevel: 0.05, color: 0xd9cfbd, side: 0x2c231c, roughness: 0.5, emissive: 0.3, shadow: 0.55,
  xray: true, castShadow: false, align: 'left', valign: 'top', anim: { pop: 0.22, rise: 0.3, spin: 0.4, vanish: 0.3, drift: 0.3, wave: 0.025, glint: 0.3 },
};
const NAME: Text3DOpts = {
  font: 'heavy', size: 0.032, depth: 0.42, bevel: 0.08, color: 0xffc94a, metalness: 0.5, roughness: 0.3, emissive: 0.35, shadow: 0.6, bevelFace: true,
  xray: true, castShadow: false, align: 'left', valign: 'bottom', anim: { pop: 0.3, rise: 0.4, spin: 1.2, vanish: 0.3, drift: 0.3, squash: 1.3, glint: 0.8 },
};
const OPT: Text3DOpts = {
  font: 'talk', size: 0.021, depth: 0.3, bevel: 0.07, color: 0xfff0d2, side: 0x5a2c14, roughness: 0.38, emissive: 0.36, shadow: 0.5,
  xray: true, castShadow: false, align: 'left', valign: 'middle', maxWidth: 0.62, anim: { pop: 0.26, rise: 0.4, spin: 0.9, vanish: 0.26, drift: 0.3, squash: 0.9 },
};
const OPT_HOT: Partial<Text3DOpts> = { color: 0xffe28a, side: 0x8a3c0a, emissive: 0.85, rim: 0xffb347, rimStrength: 1.3 };
const OPT_LOCK: Partial<Text3DOpts> = { color: 0x8f8780, side: 0x2a2522, emissive: 0.12, rim: undefined, rimStrength: 0 };
const OPT_EN: Text3DOpts = {
  font: 'ui', size: 0.0105, depth: 0.2, bevel: 0.05, color: 0xd6cbb9, side: 0x2e241d, roughness: 0.5, emissive: 0.3, shadow: 0.5,
  xray: true, castShadow: false, align: 'left', valign: 'top', maxWidth: 0.62, anim: { pop: 0.22, rise: 0.3, spin: 0.4, vanish: 0.18, drift: 0.2 },
};
const NUM: Text3DOpts = {
  font: 'display', size: 0.026, depth: 0.42, bevel: 0.1, color: 0xffcf5a, metalness: 0.85, roughness: 0.25, emissive: 0.25, bevelFace: true,
  xray: true, castShadow: false, align: 'center', valign: 'middle', anim: { pop: 0.3, rise: 0.4, spin: 1.4, vanish: 0.26, drift: 0.3, squash: 1.4, glint: 0.9 },
};
const TONE: Record<string, number> = { quest: 0xffd36a, money: 0x9fe6a0, leave: 0xc9b9a6 };
/** NPC line wrap width in local units (the block is scaled so this spans ≈ 40 % of the screen width) */
const LINE_W = 1.0;
/** NDC width the wrap width maps to (compact: the old 1.3 read as a wall of text) */
const LINE_NDC = 0.8;
/** answer cards: on-screen size relative to the original design */
const CARD_K = 0.78;

function roundRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(s, 6);
}

/** free the per-card plate meshes (the Text3D parts dispose themselves) */
function disposePlates(obj: THREE.Object3D) {
  obj.traverse((o: any) => { if (o.isMesh && o.material?.userData?.cardPlate) { o.geometry.dispose(); o.material.dispose(); } });
}

interface Card {
  root: THREE.Group; plate: THREE.Mesh; edge: THREE.Mesh; num: Text3D; main: Text3D; sub: Text3D | null; reason: Text3D | null;
  opt: DlgViewOption; hot: boolean; t0: number; w: number; h: number; picked?: number;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3();

export class DialogueView {
  /** world-space group for the NPC line (child of the scene) */
  readonly lineGroup = new THREE.Group();
  /** camera-space group for the answer cards */
  readonly cardGroup = new THREE.Group();
  private line: Text3D | null = null;
  private lineEn: Text3D | null = null;
  private name: Text3D | null = null;
  private spec: DlgLineSpec | null = null;
  private rev = 0;
  private lastBlip = 0;
  private t = 0;
  private lineT = 0;
  private fit = 1;
  private cardsTopNdc = -1;
  private cards: Card[] = [];
  private hover = -1;
  private ray = new THREE.Raycaster();
  private dying: { obj: THREE.Object3D; parts: Text3D[]; t: number; dur: number; mode: 'line' | 'card' | 'picked' }[] = [];
  private speaker: Speaker | null = null;
  /** glyphs per second */
  cps = 32;
  private mouseMoved = false;
  private lastNdc = new THREE.Vector2(9, 9);

  constructor(private camera: THREE.Camera, private scene: THREE.Object3D) {
    this.lineGroup.name = 'dialogue-line';
    this.cardGroup.name = 'dialogue-cards';
    this.lineGroup.renderOrder = 2100;
    this.cardGroup.renderOrder = 2100;
    scene.add(this.lineGroup);
    camera.add(this.cardGroup);
  }

  /** the NPC says something (replaces the previous line with a vanish) */
  setLine(spec: DlgLineSpec) {
    this.retire(this.lineGroup.children.slice(), [this.line, this.lineEn, this.name]);
    // the previous answers no longer apply: the chosen one flies off, the rest slide away
    if (this.cards.length) this.setOptions(null);
    speakStop(this.speaker);
    this.spec = spec;
    let sp: Speaker | null = null;
    try { sp = spec.speaker?.() ?? null; } catch { sp = null; }
    this.speaker = sp;
    speakStart(sp, spec.th, spec.en, spec.mood, spec.th.length / this.cps + 1.4);
    const maxW = LINE_W;
    this.line = new Text3D(spec.th, { ...LINE, maxWidth: maxW });
    this.line.reveal = 0;
    this.lineEn = spec.en ? new Text3D(spec.en, { ...LINE_EN, maxWidth: maxW }) : null;
    this.lineEn && (this.lineEn.reveal = 0);
    this.name = new Text3D(spec.name, { ...NAME, color: spec.color ?? (NAME.color as number) });
    this.name.popIn(0.03);
    const holder = new THREE.Group();
    holder.add(this.line, this.name);
    if (this.lineEn) holder.add(this.lineEn);
    this.lineGroup.add(holder);
    this.rev = 0;
    this.lineT = 0;
    Sound.play('whoosh_text', { vol: 0.25, pitch: 1.2 });
  }

  /** has the whole line been revealed? */
  get lineDone() { return !!this.line && this.line.isReady && this.rev >= this.line.glyphCount; }
  skipLine() { if (this.line?.isReady) { this.rev = this.line.glyphCount; this.line.reveal = Infinity; if (this.lineEn) this.lineEn.reveal = Infinity; } }

  /** answer cards (null → none). `cont` adds a single "continue" card when there are no options. */
  setOptions(opts: DlgViewOption[] | null) {
    for (const c of this.cards) this.retire([c.root], [c.num, c.main, c.sub, c.reason], c.picked !== undefined ? 'picked' : 'card');
    this.cards = [];
    this.hover = -1;
    if (!opts?.length) return;
    const n = opts.length;
    opts.forEach((o, i) => {
      const root = new THREE.Group();
      const locked = !!o.locked;
      const tint = locked ? (OPT_LOCK.color as number) : o.tone ? new THREE.Color(TONE[o.tone]).lerp(new THREE.Color(0xfff0d2), 0.35).getHex() : (OPT.color as number);
      const main = new Text3D(o.th, { ...OPT, color: tint, ...(locked ? OPT_LOCK : {}) });
      const sub = o.en ? new Text3D(o.en, OPT_EN) : null;
      const num = new Text3D(n === 1 && !o.en && o.th.length < 12 ? 'E' : String(i + 1), { ...NUM, ...(locked ? { color: 0x7d746c, metalness: 0.2, emissive: 0.05 } : {}) });
      const reason = locked ? new Text3D('🔒 ' + o.locked, { ...OPT_EN, color: 0xff9a7a, size: 0.0115 }) : null;
      main.popIn(0.018); sub?.popIn(0.01); num.popIn(0); reason?.popIn(0.01);
      const plateMat = new THREE.MeshBasicMaterial({ color: 0x140d09, transparent: true, opacity: 0.6, depthWrite: false });
      plateMat.userData.cardPlate = true;
      const plate = new THREE.Mesh(roundRect(1, 1, 0.12), plateMat);
      plate.renderOrder = 2090;
      const edgeMat = new THREE.MeshBasicMaterial({ color: o.tone ? TONE[o.tone] : 0xffc94a, transparent: true, opacity: 0.0, depthWrite: false });
      edgeMat.userData.cardPlate = true;
      const edge = new THREE.Mesh(roundRect(1, 1, 0.14), edgeMat);
      edge.renderOrder = 2089;
      edge.position.z = -0.002;
      root.add(edge, plate, num, main);
      if (sub) root.add(sub);
      if (reason) root.add(reason);
      root.scale.setScalar(0.001);
      this.cardGroup.add(root);
      this.cards.push({ root, plate, edge, num, main, sub, reason, opt: o, hot: false, t0: this.t + i * 0.07, w: 0.3, h: 0.05 });
    });
    Sound.play('paper_rustle', { vol: 0.3, pitch: 1.3 });
  }

  get hasOptions() { return this.cards.length > 0; }

  private retire(objs: THREE.Object3D[], parts: (Text3D | null)[], mode: 'line' | 'card' | 'picked' = 'line') {
    const ps = parts.filter(Boolean) as Text3D[];
    let dur = 0;
    for (const p of ps) dur = Math.max(dur, p.vanish(mode === 'picked' ? 0.01 : 0.006));
    const t = Math.max(mode === 'picked' ? 0.5 : 0.3, dur);
    for (const o of objs) this.dying.push({ obj: o, parts: ps, t, dur: t, mode });
  }

  /** per frame: layout + input. Returns what the player did this frame. */
  update(dt: number, inputOn = true): DlgEvents {
    this.t += dt;
    this.lineT += dt;
    const ev: DlgEvents = {};
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    // ---- retire old pieces
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t -= dt;
      const k = 1 - Math.max(0, d.t) / d.dur;
      if (d.mode === 'picked') {
        // the chosen answer: a little punch, then it lifts away while its letters burn off
        const punch = 1 + Math.sin(Math.min(1, k * 2.5) * Math.PI) * 0.12;
        d.obj.scale.setScalar(Math.max(0.001, (d.obj.userData.s0 ??= d.obj.scale.x) * punch));
        d.obj.position.y += dt * 0.06;
        d.obj.position.x += dt * 0.03;
      } else if (d.mode === 'card') {
        d.obj.position.x -= dt * 0.35 * (0.3 + k);
        d.obj.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      }
      if (d.mode !== 'line') d.obj.traverse((o: any) => { if (o.isMesh && o.material?.userData?.cardPlate) o.material.opacity *= Math.max(0, 1 - dt * 7); });
      if (d.t <= 0) { d.obj.removeFromParent(); for (const p of d.parts) p.dispose(); disposePlates(d.obj); this.dying.splice(i, 1); }
    }
    // ---- NPC line: typewriter + placement beside the head, constant screen size, faces the camera
    const s = this.spec;
    if (s && this.line) {
      if (this.line.isReady && this.rev < this.line.glyphCount) {
        const before = Math.floor(this.rev);
        this.rev = Math.min(this.line.glyphCount, this.rev + dt * this.cps);
        this.line.reveal = this.rev;
        if (this.lineEn) this.lineEn.reveal = this.lineEn.isReady ? Math.floor((this.rev / Math.max(1, this.line.glyphCount)) * this.lineEn.glyphCount + 0.5) : 0;
        if (Math.floor(this.rev) !== before && this.t - this.lastBlip > 0.07 && (s.voice ?? 1) > 0) {
          this.lastBlip = this.t;
          Sound.play('babble', { vol: 0.32, pitch: (s.voice ?? 1) * (0.92 + Math.random() * 0.16) });
        }
        if (this.lineEn && this.rev >= this.line.glyphCount) this.lineEn.reveal = Infinity;
        if (this.rev >= this.line.glyphCount) { speakStop(this.speaker); }
      }
      const head = s.head();
      const holder = this.lineGroup.children[this.lineGroup.children.length - 1];
      if (head && holder) {
        // screen-space layout at the speaker's depth: the block's right edge sits just left of their head,
        // its top a little above eye level, never off screen; it still lives in the world (parallax, depth)
        const ndc = _v.copy(head).project(cam);
        const right = THREE.MathUtils.clamp(ndc.x - 0.1, -0.2, 0.55);
        const left = Math.max(-0.95, right - LINE_NDC);
        const top = THREE.MathUtils.clamp(ndc.y + 0.55, 0.42, 0.88);   // the line lives in the top band, answers in the bottom
        const z = THREE.MathUtils.clamp(ndc.z, -1, 0.9999);
        const pL = _r.set(left, top, z).unproject(cam);
        const pR = _u.set(right, top, z).unproject(cam);
        const span = pL.distanceTo(pR);
        // long lines shrink (eased) so they never run into the answer column underneath
        const blockH = this.line.height + (this.lineEn ? this.lineEn.height + 0.014 : 0);
        const ndcPerUnit = ((right - left) * cam.aspect) / LINE_W;   // local unit → NDC height
        const avail = top - (this.cardsTopNdc + 0.05);
        const fitT = this.cards.length && blockH > 0 ? THREE.MathUtils.clamp(avail / (blockH * ndcPerUnit), 0.55, 1) : 1;
        this.fit += (fitT - this.fit) * Math.min(1, dt * 7);
        const k = (span / LINE_W) * this.fit;                      // world metres per local unit
        const w = Math.max(this.line.width, this.lineEn?.width ?? 0, 0.1);
        cam.getWorldQuaternion(_q);
        const camRight = _cr.set(1, 0, 0).applyQuaternion(_q);
        const bob = Math.sin(this.t * 1.7) * 0.004 * k;
        holder.position.copy(pR).addScaledVector(camRight, -Math.min(w, LINE_W) * k);
        holder.position.addScaledVector(_cu.set(0, 1, 0).applyQuaternion(_q), bob);
        holder.quaternion.copy(_q);
        const pop = Ease.outBack(Math.min(1, this.lineT / 0.35));
        holder.scale.setScalar(k * Math.max(0.001, pop));
        this.name!.position.set(0, 0.014, 0);
        this.line.position.set(0, 0, 0);
        if (this.lineEn) this.lineEn.position.set(0, -this.line.height - 0.014, 0);
        holder.rotateZ(Math.sin(this.t * 0.9) * 0.004);
      }
    }
    // ---- cards: stacked bottom-centre of the view
    const n = this.cards.length;
    const gap = 0.012;
    let total = 0;
    for (const c of this.cards) {
      const tw = Math.max(c.main.width, c.sub?.width ?? 0, c.reason?.width ?? 0, 0.12);
      c.w = tw + 0.078;
      c.h = Math.max(0.036, c.main.height * 1.22 + (c.sub ? c.sub.height + 0.008 : 0) + (c.reason ? c.reason.height + 0.006 : 0) + 0.02);
      total += c.h + gap;
    }
    // layout is designed for a 72° view at z -0.75 (half height 0.545); the group scales to the real FOV so the
    // stack always sits at the bottom of the screen at the same on-screen size
    const zBase = -0.75;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * -zBase;
    const ks = (halfH / 0.545) * 0.86 * CARD_K;
    this.cardGroup.scale.setScalar(ks);
    this.cardGroup.position.set(0, 0, zBase * (1 - ks));
    // the answers form a column under the speaker's line, on the left of the frame
    const leftX = -(halfH * cam.aspect / ks) * 0.9;
    let y = -0.5 + total + 0.01;     // bottom of the stack just above the bottom edge (design units)
    this.cardsTopNdc = n ? (ks * y) / halfH : -1;   // card plane sits at z = zBase in camera space
    // input: hover
    if (inputOn && n) {
      const ndc = Input.ndc;
      if (Math.abs(ndc.x - this.lastNdc.x) > 0.002 || Math.abs(ndc.y - this.lastNdc.y) > 0.002) { this.mouseMoved = true; this.lastNdc.set(ndc.x, ndc.y); }
      if (this.mouseMoved) {
        this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
        const hit = this.ray.intersectObjects(this.cards.map((c) => c.plate), false)[0];
        const hi = hit ? this.cards.findIndex((c) => c.plate === hit.object) : -1;
        if (hi !== this.hover && hi >= 0) Sound.play('bubble_pop', { vol: 0.18, pitch: 1.6 });
        if (hit || this.hover >= 0) this.hover = hi;
      }
      if (Input.wasPressed('ArrowDown') || Input.wheel > 0) { this.mouseMoved = false; this.hover = (this.hover + 1 + n) % n; Sound.play('bubble_pop', { vol: 0.18, pitch: 1.6 }); }
      if (Input.wasPressed('ArrowUp') || Input.wheel < 0) { this.mouseMoved = false; this.hover = (this.hover - 1 + n) % n; Sound.play('bubble_pop', { vol: 0.18, pitch: 1.6 }); }
    }
    this.cards.forEach((c, i) => {
      y -= c.h + gap;
      const hot = i === this.hover;
      if (hot !== c.hot) {
        c.hot = hot;
        if (!c.opt.locked) c.main.setLook(hot ? OPT_HOT : { color: c.opt.tone ? new THREE.Color(TONE[c.opt.tone]).lerp(new THREE.Color(0xfff0d2), 0.35).getHex() : (OPT.color as number), side: OPT.side, emissive: OPT.emissive, rim: undefined, rimStrength: 0 });
        c.num.setLook(hot && !c.opt.locked ? { emissive: 0.9 } : { emissive: c.opt.locked ? 0.05 : (NUM.emissive as number) });
      }
      const pop = Ease.outBack(Math.min(1, Math.max(0, (this.t - c.t0) / 0.3)));
      const sc = Math.max(0.001, pop) * (hot ? 1.06 : 1);
      const r = c.root;
      r.scale.setScalar(r.scale.x + (sc - r.scale.x) * Math.min(1, dt * 16));
      const slide = (1 - Math.min(1, Math.max(0, (this.t - c.t0) / 0.32))) ** 2;   // staggered slide-in from the left
      const x = leftX + (hot ? 0.014 : 0) - slide * 0.12;
      r.position.set(r.position.x ? r.position.x + (x - r.position.x) * Math.min(1, dt * 12) : x, y + c.h / 2 + Math.sin(this.t * 2 + i * 1.3) * 0.0016, zBase + (hot ? 0.025 : 0));
      r.rotation.set(Math.sin(this.t * 1.2 + i) * 0.025 - 0.03, Math.sin(this.t * 0.8 + i * 2) * 0.03, 0);
      // plate behind the text block (local origin = left edge, vertical centre)
      c.plate.scale.set(c.w + 0.03, c.h, 1);
      c.plate.position.set(c.w / 2 - 0.005, 0, -0.004);
      (c.plate.material as THREE.MeshBasicMaterial).opacity = hot ? 0.78 : 0.58;
      c.edge.scale.set(c.w + 0.036, c.h + 0.006, 1);
      c.edge.position.set(c.w / 2 - 0.005, 0, -0.005);
      (c.edge.material as THREE.MeshBasicMaterial).opacity = hot && !c.opt.locked ? 0.7 + Math.sin(this.t * 7) * 0.18 : c.opt.tone ? 0.28 : 0.0;
      c.num.position.set(0.02, 0, 0.004);
      const tx = 0.05;
      const top = c.h / 2 - 0.01;
      const mh = c.main.height * 1.22;                 // Thai marks / descenders reach below the em box
      c.main.position.set(tx, top - mh / 2, 0.004);
      if (c.sub) c.sub.position.set(tx, top - mh - 0.004, 0.004);
      if (c.reason) c.reason.position.set(tx, top - mh - (c.sub ? c.sub.height + 0.01 : 0.006), 0.004);
    });
    // ---- input: picks
    if (!inputOn) return ev;
    if (Input.wasPressed('Escape')) { Input.consume('Escape'); ev.leave = true; return ev; }
    const typing = !!this.line && !this.lineDone && this.lineT < 30;
    const confirm = Input.wasPressed('KeyE') || Input.wasPressed('Space') || Input.wasPressed('Enter') || Input.wasPressed('NumpadEnter');
    const click = Input.mousePressed(0);
    if (confirm) { Input.consume('KeyE'); Input.consume('Space'); }
    if (click) Input.consumeMouse(0);
    if (typing && (confirm || click)) { this.skipLine(); return ev; }
    if (typing) return ev;
    if (n === 0) { if (confirm || click) ev.cont = true; return ev; }
    for (let i = 0; i < Math.min(9, n); i++) {
      if (Input.wasPressed('Digit' + (i + 1)) || Input.wasPressed('Numpad' + (i + 1))) { Input.consume('Digit' + (i + 1)); return this.tryPick(i, ev); }
    }
    if (click && this.hover >= 0) return this.tryPick(this.hover, ev);
    if (confirm) {
      if (this.hover >= 0) return this.tryPick(this.hover, ev);
      if (n === 1) return this.tryPick(0, ev);
    }
    return ev;
  }

  private tryPick(i: number, ev: DlgEvents): DlgEvents {
    const c = this.cards[i];
    if (!c) return ev;
    if (c.opt.locked) {
      ev.buzz = i;
      Sound.play('wrong_buzz', { vol: 0.35 });
      c.root.position.x += 0.01;
      return ev;
    }
    Sound.play('ding_correct', { vol: 0.35, pitch: 1.15 });
    c.picked = this.t;
    c.main.setLook(OPT_HOT);
    ev.picked = i;
    return ev;
  }

  dispose() {
    speakStop(this.speaker);
    this.speaker = null;
    this.setOptions(null);
    this.retire(this.lineGroup.children.slice(), [this.line, this.lineEn, this.name]);
    this.line = this.lineEn = this.name = null;
    this.spec = null;
    const kill = () => {
      for (const d of this.dying) { d.obj.removeFromParent(); for (const p of d.parts) p.dispose(); }
      this.dying = [];
      this.lineGroup.removeFromParent();
      this.cardGroup.removeFromParent();
    };
    // let the vanish play a moment (the caller keeps calling update while closing, or we just cut)
    setTimeout(kill, 350);
  }
}
