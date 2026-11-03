import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { Ease, tl, TL } from '../../core/util';
import { Text3D, Text3DOpts } from '../../ui3d/text3d';
import { RECIPES } from '../cooking/recipes';
import { Quests, QuestDef, QuestState, TalkTarget, LocalTalkers } from './api';
import { questAvailable, questState, sourceText } from './runtime';
import { entityTarget, headOfTarget } from './targets';
import { textOf } from './session';

/* ============================================================================================
 * Quest visuals (all local):
 *  - floating gold "!" over NPCs with a quest to give, silver-blue "?" where an active quest is handed in
 *  - QUEST NOTE: a little taped paper note in the lower-left corner of the view (camera-attached 3D),
 *    handwritten objectives in blue ballpoint, updated live; hidden in conversations / cutscenes
 *  - objective pointer: a bobbing gold arrow over the current objective's location + distance in metres
 *  - quest start / quest done cards (3D, centre of the view) with fanfare + reward lines
 *  - RECIPE UNLOCK cinematic: a recipe card spins in with the real 3D dish on it, gold title, source line
 * ========================================================================================== */

const BANG: Text3DOpts = { font: 'display', size: 0.34, depth: 0.5, bevel: 0.12, color: 0xffc83a, metalness: 0.75, roughness: 0.22, emissive: 0.55, bevelFace: true, align: 'center', valign: 'bottom', castShadow: false, rim: 0xfff0b0, rimStrength: 1.1 };
const ASK: Partial<Text3DOpts> = { color: 0x9fd8ff, emissive: 0.65, rim: 0xe8f6ff };
const PAPER_INK: Text3DOpts = { font: 'hand', size: 0.0145, depth: 0.08, bevel: 0.02, color: 0x24408f, roughness: 0.6, emissive: 0.1, xray: true, castShadow: false, align: 'left', valign: 'top', maxWidth: 0.25 };
const PAPER_TITLE: Text3DOpts = { font: 'heavy', size: 0.0135, depth: 0.12, bevel: 0.03, color: 0x8a1c14, roughness: 0.5, emissive: 0.12, xray: true, castShadow: false, align: 'left', valign: 'top', maxWidth: 0.25 };
const CARD_BIG: Text3DOpts = { font: 'display', size: 0.05, depth: 0.45, bevel: 0.1, color: 0xffd25a, metalness: 0.8, roughness: 0.22, emissive: 0.45, bevelFace: true, xray: true, castShadow: false, align: 'center', valign: 'middle', rim: 0xfff2c0, rimStrength: 1.0, anim: { pop: 0.4, rise: 0.6, spin: 1.6, vanish: 0.3, drift: 0.6 } };
const CARD_MID: Text3DOpts = { font: 'heavy', size: 0.028, depth: 0.32, bevel: 0.07, color: 0xfff1d8, side: 0x4a2a16, roughness: 0.4, emissive: 0.4, shadow: 0.6, xray: true, castShadow: false, align: 'center', valign: 'middle', maxWidth: 0.9, anim: { pop: 0.3, rise: 0.4, spin: 0.8, vanish: 0.25, drift: 0.4 } };
const CARD_SMALL: Text3DOpts = { font: 'ui', size: 0.0145, depth: 0.2, bevel: 0.05, color: 0xe9dfcd, side: 0x33271f, roughness: 0.5, emissive: 0.32, shadow: 0.55, xray: true, castShadow: false, align: 'center', valign: 'middle', maxWidth: 0.9, anim: { pop: 0.25, rise: 0.3, spin: 0.5, vanish: 0.2, drift: 0.3 } };

const _v = new THREE.Vector3();

function paperTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f3ecd9'; x.fillRect(0, 0, 256, 320);
  // ruled lines + red margin (a page torn from a cheap Thai exercise book)
  x.strokeStyle = 'rgba(70,110,170,0.35)'; x.lineWidth = 1.2;
  for (let y = 46; y < 320; y += 22) { x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
  x.strokeStyle = 'rgba(200,60,60,0.45)'; x.beginPath(); x.moveTo(30, 0); x.lineTo(30, 320); x.stroke();
  // grubby fingerprints / curry stain
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(150,110,60,${0.03 + Math.random() * 0.04})`; x.beginPath(); x.ellipse(Math.random() * 256, Math.random() * 320, 10 + Math.random() * 30, 8 + Math.random() * 20, Math.random(), 0, 6.3); x.fill(); }
  // torn top edge
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.moveTo(0, 0);
  for (let i = 0; i <= 256; i += 8) x.lineTo(i, Math.random() * 7);
  x.lineTo(256, 0); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Marker { obj: THREE.Group; text: Text3D; kind: '!' | '?'; role: string; t: number }
interface Card { group: THREE.Group; parts: Text3D[]; extra: THREE.Object3D[]; t: number; life: number; kind: 'start' | 'done' | 'recipe'; light?: THREE.PointLight }

export class QuestFX {
  private markers = new Map<string, Marker>();
  private note: { group: THREE.Group; paper: THREE.Mesh; lines: Text3D[]; sig: string } | null = null;
  private pointer: { group: THREE.Group; cone: THREE.Mesh; dist: Text3D; target: THREE.Vector3 | null } | null = null;
  private cards: Card[] = [];
  private queue: (() => void)[] = [];
  private acc = 0;
  private t = 0;
  hidden = false;

  constructor(private game: Game) {}

  /** call on world enter */
  build() {
    this.dispose();
    const cam = this.game.camera;
    // ---- the note
    const group = new THREE.Group();
    group.name = 'quest-note';
    group.renderOrder = 2050;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.2), new THREE.MeshBasicMaterial({ map: paperTexture(), transparent: true, depthWrite: false, toneMapped: false, color: 0xe8e2d2 }));
    paper.renderOrder = 2040;
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.022), new THREE.MeshBasicMaterial({ color: 0xf6e6a0, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
    tape.position.set(0.0, 0.1, 0.001); tape.rotation.z = 0.08; tape.renderOrder = 2041;
    group.add(paper, tape);
    group.visible = false;
    cam.add(group);
    this.note = { group, paper, lines: [], sig: '' };
    // ---- objective pointer
    const pg = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 4, 1).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.7, roughness: 0.25, emissive: 0xffa020, emissiveIntensity: 0.6 }));
    cone.castShadow = false;
    const dist = new Text3D('', { ...CARD_SMALL, size: 0.13, xray: false, color: 0xfff1d8 });
    dist.position.y = -0.36;
    pg.add(cone, dist);
    pg.visible = false;
    this.game.scene?.add(pg);
    this.pointer = { group: pg, cone, dist, target: null };
  }

  // ------------------------------------------------------------------ markers

  private markerFor(role: string, kind: '!' | '?') {
    let m = this.markers.get(role);
    if (m && m.kind !== kind) { m.obj.removeFromParent(); m.text.dispose(); this.markers.delete(role); m = undefined; }
    if (!m) {
      const obj = new THREE.Group();
      const text = new Text3D(kind, { ...BANG, ...(kind === '?' ? ASK : {}) });
      text.popIn(0);
      obj.add(text);
      this.game.scene?.add(obj);
      m = { obj, text, kind, role, t: 0 };
      this.markers.set(role, m);
      Sound.play('sparkle_chime', { vol: 0.15, pitch: 1.4 });
    }
    return m;
  }

  private targetOfRole(role: string): TalkTarget | null {
    const e = this.game.state.find('npc', (n) => n.role === role);
    if (e) return entityTarget(this.game, e);
    for (const { target } of LocalTalkers.map.values()) if (target.role === role) return target;
    return null;
  }

  /** which roles want a "!" / "?" right now */
  private wantedMarkers(): Map<string, '!' | '?'> {
    const out = new Map<string, '!' | '?'>();
    for (const def of Quests.defs) {
      const st = questState(this.game, def.id);
      if (!st && def.giver && questAvailable(this.game, def)) { if (!out.has(def.giver)) out.set(def.giver, '!'); continue; }
      if (st?.status === 'active') {
        const step = def.steps[st.step];
        if (step?.at) out.set(step.at, '?');
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ note + pointer

  private activeQuests(): { def: QuestDef; st: QuestState }[] {
    const q = (this.game.g as any).quests ?? {};
    return Object.values<QuestState>(q).filter((s) => s?.status === 'active').map((st) => ({ def: Quests.get(st.id)!, st })).filter((x) => !!x.def)
      .sort((a, b) => (a.def.order ?? 50) - (b.def.order ?? 50)).slice(0, 3);
  }

  private stepText(def: QuestDef, st: QuestState): TL {
    const s = def.steps[st.step];
    if (!s) return { th: '' };
    const v: any = typeof s.text === 'function' ? (s.text as any)(this.game) : s.text;
    return typeof v === 'string' ? { th: v } : v;
  }

  private updateNote(play: boolean) {
    const n = this.note;
    if (!n) return;
    const act = this.activeQuests();
    const sig = act.map((a) => a.def.id + ':' + a.st.step + ':' + this.stepText(a.def, a.st).th).join('|');
    if (sig !== n.sig) {
      n.sig = sig;
      for (const l of n.lines) l.dispose();
      n.lines = [];
      let y = 0.082;
      for (const a of act) {
        const title = new Text3D('• ' + a.def.title.th, PAPER_TITLE);
        title.position.set(-0.118, y, 0.002);
        n.group.add(title); n.lines.push(title);
        y -= 0.024;
        const step = new Text3D('   ' + this.stepText(a.def, a.st).th, PAPER_INK);
        step.position.set(-0.118, y, 0.002);
        n.group.add(step); n.lines.push(step);
        y -= 0.034;
      }
      if (act.length) Sound.play('paper_rustle', { vol: 0.25 });
    }
    const show = play && act.length > 0 && !this.hidden;
    n.group.visible = show || n.group.scale.x > 0.02;
    const want = show ? 1 : 0.001;
    n.group.scale.setScalar(n.group.scale.x + (want - n.group.scale.x) * 0.18);
    if (!n.group.visible) return;
    // lower-left corner of the view, a little tilted like a sticky note on the screen edge
    const cam = this.game.camera;
    const z = -0.62;
    const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * -z, hw = hh * cam.aspect;
    const rows = act.length;
    const ph = 0.06 + rows * 0.058;
    n.paper.scale.set(1, ph / 0.2, 1);
    n.paper.position.y = 0.1 - ph / 2;
    n.group.position.set(-hw + 0.17, -hh + ph + 0.03, z);
    n.group.rotation.set(0, 0.08, 0.035 + Math.sin(this.t * 0.6) * 0.004);
  }

  private updatePointer(play: boolean) {
    const P = this.pointer;
    if (!P) return;
    let target: THREE.Vector3 | null = null;
    for (const a of this.activeQuests()) {
      const step = a.def.steps[a.st.step];
      let w: [number, number, number] | null = null;
      try { w = step?.where?.(this.game) ?? null; } catch { w = null; }
      if (!w && step?.at) { const t = this.targetOfRole(step.at); const h = t ? headOfTarget(t) : null; if (h) w = [h.x, h.y + 0.35, h.z]; }
      if (w) { target = _v.set(w[0], w[1], w[2]).clone(); break; }
    }
    const me = this.game.player;
    const show = play && !!target && !!me && !this.hidden;
    P.group.visible = !!show;
    if (!show || !target || !me) return;
    const d = Math.hypot(target.x - me.pos.x, target.z - me.pos.z);
    if (d < 2.2) { P.group.visible = false; return; }
    P.group.position.set(target.x, target.y + 1.1 + Math.sin(this.t * 3) * 0.08, target.z);
    P.cone.rotation.y = this.t * 2;
    const label = `${Math.round(d)} ม.`;
    if ((P.dist as any)._lbl !== label) { (P.dist as any)._lbl = label; P.dist.setText(label); }
    P.group.quaternion.copy(this.game.camera.quaternion);
    P.cone.quaternion.identity(); P.cone.rotation.set(0, this.t * 2, 0);
    const s = THREE.MathUtils.clamp(d / 14, 0.6, 3);
    P.group.scale.setScalar(s);
  }

  // ------------------------------------------------------------------ cards

  private card(kind: Card['kind'], build: (g: THREE.Group) => { parts: Text3D[]; extra?: THREE.Object3D[]; light?: THREE.PointLight }, life: number) {
    const run = () => {
      const group = new THREE.Group();
      group.renderOrder = 2200;
      const b = build(group);
      group.scale.setScalar(0.001);
      this.game.camera.add(group);
      this.cards.push({ group, parts: b.parts, extra: b.extra ?? [], t: 0, life, kind, light: b.light });
    };
    // one big card at a time (queue)
    if (this.cards.some((c) => c.kind !== 'start')) this.queue.push(run); else run();
  }

  questStart(id: string) {
    const def = Quests.get(id);
    if (!def) return;
    this.card('start', (g) => {
      const a = new Text3D('ภารกิจใหม่!', { ...CARD_MID, color: 0xffd25a, size: 0.026 });
      const b = new Text3D(def.title.th, { ...CARD_MID, size: 0.032 });
      const c = new Text3D(def.title.en ?? '', CARD_SMALL);
      a.position.set(0, 0.05, 0); b.position.set(0, 0.012, 0); c.position.set(0, -0.022, 0);
      for (const t of [a, b, c]) { t.popIn(0.02); g.add(t); }
      return { parts: [a, b, c] };
    }, 2.6);
    Sound.play('paper_rustle', { vol: 0.5 });
    Sound.play('whoosh_text', { vol: 0.4 });
  }

  questDone(d: { id: string; money: number; recipes: string[]; items: string[]; rep: number; note: any }) {
    const def = Quests.get(d.id);
    if (!def) return;
    this.card('done', (g) => {
      const a = new Text3D('ภารกิจสำเร็จ!', CARD_BIG);
      const b = new Text3D(def.title.th, { ...CARD_MID, size: 0.03 });
      const rew: string[] = [];
      if (d.money) rew.push(`+${d.money} ฿`);
      for (const r of d.recipes ?? []) rew.push(`สูตร${RECIPES[r]?.name.th ?? r}`);
      if (d.rep) rew.push(`ชื่อเสียง +${d.rep}`);
      if (d.note) rew.push(typeof d.note === 'string' ? d.note : d.note.th);
      const c = new Text3D(rew.join('  ·  ') || 'ขอบคุณ!', { ...CARD_MID, color: 0x9fe6a0, size: 0.024 });
      const e = new Text3D(def.title.en ?? '', CARD_SMALL);
      a.position.set(0, 0.075, 0); b.position.set(0, 0.022, 0); c.position.set(0, -0.016, 0); e.position.set(0, -0.046, 0);
      for (const t of [a, b, c, e]) { t.popIn(0.02); g.add(t); }
      return { parts: [a, b, c, e] };
    }, 3.4);
    Sound.play('tada', { vol: 0.7 });
    if (d.money) Sound.play('coins_handful', { vol: 0.5, delay: 0.4 });
  }

  recipeUnlock(id: string, source: string) {
    const R = RECIPES[id];
    if (!R) return;
    const game = this.game;
    this.card('recipe', (g) => {
      // the recipe card: cream paper, red header band, a little tilted
      const card = new THREE.Group();
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.003), new THREE.MeshStandardMaterial({ color: 0xf2e7cf, roughness: 0.85 }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.0035), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 }));
      band.position.set(0, 0.09, 0.0005);
      card.add(paper, band);
      card.position.set(0, -0.02, -0.02);
      g.add(card);
      // the real dish, spinning on top
      let dish: THREE.Object3D | null = null;
      try {
        const def = game.items.def('dish');
        if (def) {
          const data = { ...(def.data?.() ?? {}), recipe: id, rice: R.rice, vessel: R.vessel, egg: R.egg === 'topping' || R.egg === 'main' ? 'crispy' : 'none', portion: 180, taste: 0.95, temp: 1, issues: [], vis: { burn: 0.12, sauce: 0.45, herb: 0.6, chili: 0.3, size: 1, raw: 0 } };
          dish = def.build({ id: -9000, t: 'item', k: 'dish', p: [0, 0, 0], data } as any, game);
          dish.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; } });
          dish.scale.setScalar(0.62);
          dish.position.set(0, -0.055, 0.07);
          dish.rotation.x = 0.55;
          g.add(dish);
        }
      } catch (e) { console.warn('[quests] dish preview', e); dish = null; }
      const light = new THREE.PointLight(0xfff0d8, 2.2, 1.6, 1.5);
      light.position.set(0.1, 0.12, 0.35);
      g.add(light);
      const a = new Text3D('สูตรใหม่!', CARD_BIG);
      const b = new Text3D(R.name.th, { ...CARD_MID, size: 0.036, color: 0xfff6e2 });
      const c = new Text3D(R.name.en ?? '', CARD_SMALL);
      const st = sourceText(source);
      const s = new Text3D(st.th, { ...CARD_SMALL, color: 0xffd38a, size: 0.013 });
      a.position.set(0, 0.135, 0.02); b.position.set(0, 0.088, 0.02); c.position.set(0, 0.062, 0.02); s.position.set(0, -0.135, 0.02);
      for (const t of [a, b, c, s]) { t.popIn(0.025); g.add(t); }
      g.userData.dish = dish;
      g.userData.card = card;
      return { parts: [a, b, c, s], extra: dish ? [dish, card] : [card], light };
    }, 4.2);
    Sound.play('level_up_fanfare', { vol: 0.6 });
    Sound.play('page_turn', { vol: 0.6, delay: 0.25 });
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    this.t += dt;
    const game = this.game;
    const play = game.player?.mode === 'play';
    // markers (refresh the wanted set 3×/s)
    this.acc += dt;
    if (this.acc > 0.33) {
      this.acc = 0;
      const want = this.wantedMarkers();
      for (const [role, m] of this.markers) if (want.get(role) !== m.kind) { m.obj.removeFromParent(); m.text.dispose(); this.markers.delete(role); }
      for (const [role, k] of want) this.markerFor(role, k);
    }
    for (const m of this.markers.values()) {
      const t = this.targetOfRole(m.role);
      const h = t ? headOfTarget(t) : null;
      m.obj.visible = !!h && !this.hidden;
      if (!h) continue;
      m.t += dt;
      const camPos = game.camera.getWorldPosition(_v);
      const d = camPos.distanceTo(h);
      m.obj.position.set(h.x, h.y + 0.42 + Math.sin(m.t * 2.6) * 0.05, h.z);
      m.obj.rotation.set(0, m.t * 1.6, 0);
      m.obj.scale.setScalar(THREE.MathUtils.clamp(0.55 + d * 0.035, 0.6, 1.8) * (1 + Math.max(0, Math.sin(m.t * 5)) * 0.06));
      if (d > 45) m.obj.visible = false;
    }
    this.updateNote(play);
    this.updatePointer(play);
    // cards
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const c = this.cards[i];
      c.t += dt;
      const k = c.t / c.life;
      const g = c.group;
      const inK = Ease.outBack(Math.min(1, c.t / 0.45));
      const outK = c.t > c.life - 0.45 ? 1 - Math.min(1, (c.t - (c.life - 0.45)) / 0.45) : 1;
      g.scale.setScalar(Math.max(0.001, inK * outK));
      const y = c.kind === 'start' ? 0.24 : 0.02;
      g.position.set(0, y + (1 - outK) * 0.12, -0.72);
      if (c.kind === 'recipe') {
        // spin in, then sway; the dish turns slowly
        const spin = Math.max(0, 1 - c.t / 0.9);
        g.rotation.set(0.05, Math.PI * 2 * Ease.inOutCubic(spin) + Math.sin(c.t * 1.1) * 0.12, Math.sin(c.t * 0.7) * 0.03);
        const dish = g.userData.dish as THREE.Object3D | null;
        if (dish) dish.rotation.y = c.t * 1.2;
      } else g.rotation.set(0, Math.sin(c.t * 1.2) * 0.06, Math.sin(c.t * 0.8) * 0.015);
      if (k >= 1) {
        g.removeFromParent();
        for (const p of c.parts) p.dispose();
        this.cards.splice(i, 1);
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  dispose() {
    for (const m of this.markers.values()) { m.obj.removeFromParent(); m.text.dispose(); }
    this.markers.clear();
    if (this.note) { this.note.group.removeFromParent(); for (const l of this.note.lines) l.dispose(); this.note = null; }
    if (this.pointer) { this.pointer.group.removeFromParent(); this.pointer.dist.dispose(); this.pointer = null; }
    for (const c of this.cards) { c.group.removeFromParent(); for (const p of c.parts) p.dispose(); }
    this.cards = []; this.queue = [];
  }
}

export { textOf, tl };
