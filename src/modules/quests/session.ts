import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { tl, TL } from '../../core/util';
import { Overlay } from '../../ui3d/overlay';
import { DialogueView, DlgViewOption } from '../../ui3d/dialogue3d';
import { PERSONALITIES, SHOP_BY_ID } from '../shops/data';
import { Dialogues, Dialogue, DlgCtx, DlgNode, DlgOption, Line, Quests, TalkTarget } from './api';
import { questAvailable, questState } from './runtime';
import { headOfTarget } from './targets';

/* ============================================================================================
 * Local conversation: resolve the dialogue for a target (+ quest offers / quest options), run the nodes,
 * drive the 3D view, frame a cinematic over-the-shoulder two-shot with a soft focus on the speaker.
 * Other players see the NPC's lines as normal 3D speech ('talk:line' event).
 * ========================================================================================== */

export function textOf(l: Line | undefined | null, c: DlgCtx): TL {
  if (l == null) return { th: '' };
  const v = typeof l === 'function' ? l(c) : l;
  return typeof v === 'string' ? { th: v } : v;
}

const NAME_COL = [0xffc94a, 0x8fd3ff, 0xff9a8a, 0xb6f08a, 0xf3a6ff, 0xffe08a, 0x9ff0d9];
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

export function voiceOf(t: TalkTarget, d: Dialogue | null): number {
  if (d?.voice) return d.voice;
  if (t.role.startsWith('shopkeeper:')) {
    const def = SHOP_BY_ID[t.role.slice(11)];
    const p = def ? PERSONALITIES[def.keeper.personality] : null;
    if (p) return p.voice;
  }
  if (t.role.startsWith('ghost')) return 0.55;
  return 0.85 + (hashStr(t.key) % 40) / 100;
}

/** the best dialogue for a target (highest priority match) */
export function resolveDialogue(game: Game, t: TalkTarget, minPriority = -Infinity): Dialogue | null {
  let best: Dialogue | null = null;
  for (const d of Dialogues.list) {
    let ok = false;
    try { ok = d.match(t, game); } catch { ok = false; }
    if (!ok || (d.priority ?? 0) < minPriority) continue;
    if (!best || (d.priority ?? 0) > (best.priority ?? 0)) best = d;
  }
  return best;
}

/** quest offers / quest options that would be injected for this target */
function questExtras(game: Game, t: TalkTarget, c: DlgCtx): { options: DlgOption[]; nodes: DlgNode[] } {
  const options: DlgOption[] = [];
  const nodes: DlgNode[] = [];
  const defs = [...Quests.defs].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  for (const def of defs) {
    // quest-specific dialogue (hand-ins, deliveries…)
    for (const dg of def.dialog ?? []) {
      let ok = false;
      try { ok = dg.who(t, game); } catch { ok = false; }
      if (!ok) continue;
      try { options.push(...dg.options(c, questState(game, def.id))); } catch (e) { console.warn('[quests] dialog options', def.id, e); }
      nodes.push(...(dg.nodes ?? []));
    }
    // auto offer from the giver
    if (def.giver && def.giver === t.role && questAvailable(game, def)) {
      const offerId = `__offer:${def.id}`, okId = `__ok:${def.id}`, noId = `__no:${def.id}`;
      options.push({ text: tl(`มีอะไรให้ช่วยไหม? (${def.title.th})`, `Need any help? (${def.title.en ?? def.title.th})`), next: offerId });
      nodes.push({
        id: offerId, say: def.offer ?? def.startLine ?? def.title, face: 'think',
        options: [
          { text: tl('ได้เลย! เดี๋ยวจัดให้', "Sure! I'm on it"), next: okId, do: () => game.intent('quest.start', { id: def.id }) },
          { text: tl('ไว้ก่อนนะ ยุ่งอยู่', "Maybe later, I'm busy"), next: noId },
        ],
      });
      nodes.push({ id: okId, say: def.startLine ? tl('ขอบใจมาก! ฝากด้วยนะ', 'Thanks! Counting on you') : tl('เยี่ยม! ฝากด้วยนะ', 'Great! Counting on you'), anim: 'celebrate' });
      nodes.push({ id: noId, say: tl('อ้าว… ก็ได้ ว่างเมื่อไหร่มาหานะ', 'Aww… okay, come back when you are free'), face: 'neutral', anim: 'sad' });
    }
  }
  return { options, nodes };
}

/** can the local player talk to this target right now? */
export function canTalk(game: Game, t: TalkTarget, minPriority = -Infinity): boolean {
  if (resolveDialogue(game, t, minPriority)) return true;
  const c = { game, target: t, npc: null, me: game.me!, vars: {} } as DlgCtx;
  return questExtras(game, t, c).options.length > 0;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();

export class DialogueSession {
  view: DialogueView | null = null;
  target: TalkTarget | null = null;
  private ctx: DlgCtx | null = null;
  private dlg: Dialogue | null = null;
  private nodes = new Map<string, DlgNode>();
  private node: DlgNode | null = null;
  private visOpts: DlgOption[] = [];
  private extra: DlgOption[] = [];
  private firstNode = true;
  private camFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 72 };
  private camCur = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 72 };
  private camK = 0;
  private leaving = 0;
  private t = 0;
  private savedCursor = '';
  private dofOn = false;
  onClosed: (() => void) | null = null;

  constructor(private game: Game) {}

  get active() { return !!this.target; }

  start(t: TalkTarget): boolean {
    const game = this.game, pl = game.player, me = game.me;
    if (this.target || !pl || !me || pl.mode !== 'play' || !game.scene) return false;
    const npc = t.kind === 'entity' && t.eid !== undefined ? game.state.get(t.eid) ?? null : null;
    const ctx: DlgCtx = { game, target: t, npc, me, vars: {} };
    const dlg = resolveDialogue(game, t);
    const ex = questExtras(game, t, ctx);
    if (!dlg && !ex.options.length) return false;
    this.target = t; this.ctx = ctx; this.dlg = dlg;
    this.nodes.clear();
    for (const n of dlg?.nodes ?? []) this.nodes.set(n.id, n);
    for (const n of ex.nodes) this.nodes.set(n.id, n);
    this.extra = ex.options;
    if (!dlg) this.nodes.set('__root', { id: '__root', say: tl('ว่าไง?', "What's up?") });
    let first = '__root';
    if (dlg) { try { first = dlg.start(ctx); } catch (e) { console.warn('[quests] start', dlg.id, e); first = dlg.nodes[0]?.id; } }
    // camera: from the current first-person pose
    const cam = game.camera;
    this.camFrom.p.copy(cam.getWorldPosition(_a)); this.camFrom.q.copy(cam.getWorldQuaternion(new THREE.Quaternion())); this.camFrom.fov = cam.fov;
    this.camCur.p.copy(this.camFrom.p); this.camCur.q.copy(this.camFrom.q); this.camCur.fov = cam.fov;
    this.camK = 0; this.leaving = 0; this.t = 0;
    // face the speaker
    const h = headOfTarget(t);
    if (h) pl.yaw = Math.atan2(-(h.x - pl.pos.x), -(h.z - pl.pos.z));
    pl.setMode('external');
    this.savedCursor = game.engine.canvas.style.cursor;
    if (t.kind === 'entity' && t.eid !== undefined) game.intent('talk.begin', { eid: t.eid });
    else t.act?.('talk');
    this.view = new DialogueView(cam, game.scene);
    this.firstNode = true;
    this.go(first);
    game.interact.hintOnce('dlg.keys', 'คุย: 1-9 / คลิกเลือกคำตอบ · E ข้าม/ต่อ · Esc ออก', 6);
    return true;
  }

  private go(id: string | undefined) {
    const n = id ? this.nodes.get(id) : undefined;
    if (!n) { this.close(); return; }
    const c = this.ctx!;
    this.node = n;
    try { n.do?.(c); } catch (e) { console.warn('[quests] node.do', n.id, e); }
    const t = this.target!;
    if (n.anim || n.face) t.act?.(n.anim, n.face);
    const text = textOf(n.say, c);
    const nm = t.name;
    this.view!.setLine({
      name: nm.th, nameEn: nm.en, th: text.th, en: text.en,
      color: NAME_COL[hashStr(t.role) % NAME_COL.length], voice: voiceOf(t, this.dlg), head: () => headOfTarget(t),
    });
    // everybody else hears it as ordinary 3D speech
    this.game.emit('talk:line', { by: this.game.localPlayerId, eid: t.eid ?? null, key: t.key, th: text.th, en: text.en ?? null, voice: voiceOf(t, this.dlg) });
    // options (first node also gets the quest extras + a goodbye)
    let opts = (n.options ?? []).filter((o) => { try { return !o.if || o.if(c); } catch { return false; } });
    if (this.firstNode) {
      opts = [...this.extra.filter((o) => { try { return !o.if || o.if(c); } catch { return false; } }), ...opts];
      if (opts.length && !opts.some((o) => o.end)) opts.push({ text: tl('ไปละ!', 'Bye!'), end: true });
      this.firstNode = false;
    }
    this.visOpts = opts;
    this.optsPending = true;
  }
  private optsPending = false;

  private showOptions() {
    const c = this.ctx!;
    const vis: DlgViewOption[] = this.visOpts.map((o) => {
      const tx = textOf(o.text, c);
      let lock: string | null = null;
      try { const r = o.lock?.(c); lock = r ? String(r) : null; } catch { lock = null; }
      const isQuest = !!(o.next && (o.next.startsWith('__offer') || o.next.includes(':'))) || /ภารกิจ|ช่วย/.test(tx.th) && !!o.next;
      return { th: tx.th, en: tx.en, locked: lock, tone: o.end ? 'leave' : isQuest ? 'quest' : /฿/.test(tx.th) ? 'money' : null };
    });
    if (!vis.length) {
      const n = this.node!;
      vis.push(n.next && !n.end ? { th: 'ต่อ ▸', en: 'continue' } : { th: 'จบการสนทนา', en: 'leave', tone: 'leave' });
    }
    this.view!.setOptions(vis);
  }

  private pick(i: number) {
    const c = this.ctx!;
    const n = this.node!;
    if (!this.visOpts.length) { if (n.end) this.close(); else this.go(n.next); return; }
    const o = this.visOpts[i];
    if (!o) return;
    // the player says the chosen line (short floating text from you)
    const tx = textOf(o.text, c);
    if (!o.end) this.game.say(this.game.localPlayerId, tx.th, { duration: 1.6, voice: 0, scale: 0.8 } as any);
    try { o.do?.(c); } catch (e) { console.warn('[quests] option.do', e); }
    if (o.end || (!o.next)) { this.close(); return; }
    this.go(o.next);
  }

  /** world speech bubbles (shop chatter, barks, the player's own echoed answer) would float through the two-shot:
   *  hide them locally while we talk; whatever is still waiting when we leave just closes */
  private hush(on: boolean) {
    const ui: any = this.game.ui;
    for (const L of (ui?.live ?? []) as any[]) {
      if (!L || (L.kind !== 'say' && L.kind !== 'think' && L.kind !== 'shout')) continue;
      if (on) { if (!L.hidden) { L.hidden = true; L._hushed = true; } }
      else if (L._hushed) { L.hidden = false; L._hushed = false; try { ui.kill?.(L, false); } catch { /* internals changed */ } }
    }
  }

  close() {
    if (!this.target || this.leaving) return;
    this.hush(false);
    this.leaving = 0.0001;
    this.camK = 0;
    this.camFrom.p.copy(this.camCur.p); this.camFrom.q.copy(this.camCur.q); this.camFrom.fov = this.camCur.fov;
    this.view?.dispose();
    this.view = null;
    const t = this.target;
    if (t.kind === 'entity' && t.eid !== undefined) this.game.intent('talk.end', { eid: t.eid });
    else t.act?.('idle');
    if (this.dofOn) { this.game.engine.post.setDOF(false); this.dofOn = false; }
  }

  private finish() {
    const game = this.game, pl = game.player;
    game.engine.canvas.style.cursor = this.savedCursor;
    this.target = null; this.ctx = null; this.node = null; this.dlg = null;
    if (pl && pl.mode === 'external') {
      pl.setMode('play');
      game.camera.fov = pl.baseFov; game.camera.updateProjectionMatrix();
    }
    this.onClosed?.();
  }

  /** two-shot over the player's right shoulder: the speaker sits on the right third, their line floats left of them */
  private shot(out: { p: THREE.Vector3; q: THREE.Quaternion; fov: number }) {
    const pl = this.game.player!;
    const head = headOfTarget(this.target!) ?? _a.set(pl.pos.x, pl.pos.y + 1.6, pl.pos.z - 1);
    const eye = _b.set(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
    const d = new THREE.Vector3(head.x - eye.x, 0, head.z - eye.z);
    const dist = Math.max(0.5, d.length());
    d.normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const back = Math.min(1.25, 0.75 + dist * 0.22);
    out.p.copy(eye).addScaledVector(d, -back).addScaledVector(right, 0.58).addScaledVector(UP, 0.14 + Math.max(0, head.y - eye.y) * 0.3);
    // aim left of the speaker so they sit on the right third; their words float in the space to their left
    const look = head.clone().addScaledVector(right, -0.2 * (dist + back)).addScaledVector(UP, -0.12);
    _m.lookAt(out.p, look, UP);
    out.q.setFromRotationMatrix(_m);
    out.fov = THREE.MathUtils.clamp(46 + dist * 3, 46, 58);
    return { head, dist: out.p.distanceTo(head) };
  }

  update(dt: number) {
    if (!this.target) return;
    const game = this.game, cam = game.camera, pl = game.player;
    if (!pl) return;
    this.t += dt;
    Overlay.crosshair(false);
    if (!this.leaving) this.hush(true);
    // keep the player's body visible in the over-the-shoulder shot
    const rg = pl.rig();
    if (rg) { rg.setFirstPerson(false); rg.root.visible = true; }
    const tgt = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
    const info = this.shot(tgt);
    // gentle handheld drift + parallax toward the cursor
    tgt.p.add(new THREE.Vector3(Math.sin(this.t * 0.5) * 0.008 + Input.ndc.x * 0.01, Math.sin(this.t * 0.37) * 0.006 + Input.ndc.y * 0.006, 0).applyQuaternion(tgt.q));
    if (this.leaving) {
      this.leaving += dt;
      const fp = new THREE.Vector3(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
      const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pl.pitch, pl.yaw, 0, 'YXZ'));
      const k = THREE.MathUtils.smootherstep(Math.min(1, this.leaving / 0.5), 0, 1);
      cam.position.lerpVectors(this.camFrom.p, fp, k);
      cam.quaternion.slerpQuaternions(this.camFrom.q, fq, k);
      cam.fov = THREE.MathUtils.lerp(this.camFrom.fov, pl.baseFov, k);
      cam.updateProjectionMatrix();
      if (this.leaving >= 0.5) this.finish();
      return;
    }
    this.camK = Math.min(1, this.camK + dt / 0.65);
    const k = THREE.MathUtils.smootherstep(this.camK, 0, 1);
    if (this.camK < 1) {
      this.camCur.p.lerpVectors(this.camFrom.p, tgt.p, k);
      this.camCur.q.slerpQuaternions(this.camFrom.q, tgt.q, k);
      this.camCur.fov = THREE.MathUtils.lerp(this.camFrom.fov, tgt.fov, k);
    } else {
      const f = 1 - Math.exp(-dt * 4);
      this.camCur.p.lerp(tgt.p, f); this.camCur.q.slerp(tgt.q, f); this.camCur.fov += (tgt.fov - this.camCur.fov) * f;
    }
    cam.position.copy(this.camCur.p);
    cam.quaternion.copy(this.camCur.q);
    if (Math.abs(cam.fov - this.camCur.fov) > 0.01) { cam.fov = this.camCur.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // soft focus on the speaker once framed (background melts away, the cards stay crisp)
    const post = game.engine.post as any;
    if (this.camK >= 1 && !this.dofOn && !new URLSearchParams(location.search).has('nodof')) {
      post.setDOF(true, info.dist, 1.6);
      this.dofOn = true;
    }
    if (this.dofOn && post.dof?.cocMaterial) {
      try {
        post.dof.cocMaterial.worldFocusDistance = cam.getWorldPosition(_a).distanceTo(info.head);
        post.dof.cocMaterial.worldFocusRange = 7;
      } catch { /* older postprocessing */ }
    }
    // options appear once the line is revealed
    const v = this.view!;
    if (this.optsPending && v.lineDone) { this.optsPending = false; this.showOptions(); }
    const ev = v.update(dt, this.camK > 0.5);
    if (ev.leave) { Sound.play('bubble_pop', { vol: 0.3, pitch: 0.7 }); this.close(); return; }
    if (ev.cont) { if (this.node?.next && !this.node.end) this.go(this.node.next); else this.close(); return; }
    if (ev.picked !== undefined) this.pick(ev.picked);
    // the speaker walked away / vanished
    const h = headOfTarget(this.target);
    if (!h || h.distanceTo(new THREE.Vector3(pl.pos.x, pl.pos.y + 1.5, pl.pos.z)) > 7) this.close();
  }
}
