import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { Overlay } from '../../ui3d/overlay';
import { tl } from '../../core/util';
import { buildNote } from '../social/money';
import { BRANDS, HOME, Brand, fmtSatang, fmtBaht, gameDate } from './brand';
import { buildAtm, AtmModel, FDK_IDS } from './model';
import { AtmScreen, ScreenSpec, Opt, L2 } from './screen';
import { cardTexture, receiptTexture, ReceiptData } from './tex';
import { atmSfx, AtmSfx } from './sfx';
import { accountOf, atmBrand, Res } from './bank';

/* ============================================================================================
 * AtmUnit  — one placed machine: model, screen canvas, physical animations (card, notes, receipt,
 *            shutter, LEDs, key presses). Shows "in service" to everyone else while a friend uses it.
 * AtmUI    — the LOCAL player's session: E → focus mode (camera eases to the machine, cursor free),
 *            state machine of a real Thai ATM, mouse on the real keys / touch screen, keyboard
 *            0-9 · Enter · Backspace · Esc. Money goes through host intents (bank.ts).
 * ========================================================================================== */

type Focus = 'screen' | 'keypad' | 'cash' | 'card' | 'receipt';
const POSE: Record<Focus, { cam: [number, number, number]; look: [number, number, number]; fov: number }> = {
  screen: { cam: [0, 1.5, 0.9], look: [0, 1.29, 0.2], fov: 46 },
  keypad: { cam: [0, 1.46, 0.8], look: [0, 1.17, 0.28], fov: 48 },
  cash: { cam: [0, 1.3, 0.88], look: [0, 0.99, 0.4], fov: 48 },   // look down at the dispenser (sight line passes under the shelf lip)
  card: { cam: [0.1, 1.42, 0.78], look: [0.25, 1.25, 0.22], fov: 44 },
  receipt: { cam: [-0.1, 1.42, 0.78], look: [-0.26, 1.24, 0.22], fov: 44 },
};
const STAND: [number, number, number] = [0, 0, 0.82];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// ================================================================== unit

export class AtmUnit {
  readonly root: THREE.Group;
  readonly m: AtmModel;
  readonly screen: AtmScreen;
  readonly brand: Brand;
  private keyPress = new Float32Array(16);
  private fdkPress = new Float32Array(8);
  hoverKey = -1;
  hoverFdk = -1;
  // physical props
  card: THREE.Group | null = null;
  cardPhase: 'none' | 'in' | 'inside' | 'out' | 'take' | 'swallow' = 'none';
  cardK = 0;
  private cardFrom = new THREE.Matrix4();
  notes: THREE.Group | null = null;
  notesPhase: 'none' | 'out' | 'ready' | 'take' | 'retract' | 'deposit' = 'none';
  notesK = 0;
  shutterOpen = 0;
  shutterTarget = 0;
  receipt: THREE.Mesh | null = null;
  receiptK = 0;
  receiptPhase: 'none' | 'print' | 'ready' | 'take' = 'none';
  ledCard: 'off' | 'slow' | 'fast' = 'slow';
  ledCash = false;
  private detailOn = true;

  constructor(private game: Game, readonly id: string, brandId: string, p: ArrayLike<number>, yaw: number) {
    this.brand = BRANDS[brandId] ?? HOME;
    atmBrand.set(id, this.brand.id);
    this.m = buildAtm(this.brand);
    this.root = this.m.root;
    this.root.name = 'atm:' + id;
    this.root.position.set(p[0], p[1], p[2]);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    this.screen = new AtmScreen(this.brand);
    this.m.screenMat.emissiveMap = this.screen.tex;
    this.m.screenMat.needsUpdate = true;
    game.interact.register(this.root, { kind: 'atm', data: { name: tl(`ตู้ ATM ${this.brand.th}`, `${this.brand.en} ATM`), atm: id }, reach: 2.6 });
  }

  /** world-space pose helpers (ATM local) */
  local(p: ArrayLike<number>, out = new THREE.Vector3()) { return out.set(p[0], p[1], p[2]).applyMatrix4(this.root.matrixWorld); }
  get yaw() { return this.root.rotation.y; }
  sfx(k: AtmSfx, vol = 1) { atmSfx(k, this.m.screenFrame.getWorldPosition(_v2), vol); }

  press(kind: 'key' | 'fdk', i: number) {
    if (kind === 'key') this.keyPress[i] = 1; else this.fdkPress[i] = 1;
    this.sfx('beep');
  }

  // ---------------------------------------------------------------- card
  private makeCard(name: string, acct: string) {
    const g = new THREE.Group();
    const tex = cardTexture(HOME, name, acct);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.0008, 0.0856), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.0856, 0.054), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.1 }));
    face.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    face.position.y = 0.00045;
    g.add(body, face);
    g.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
    return g;
  }
  /** card pose in screenFrame: depth = how far it sticks out of the mouth (m) */
  private cardLocal(depth: number, out: THREE.Matrix4) {
    const s = this.m.cardSlot.position;
    return out.makeTranslation(s.x, s.y, s.z - 0.0428 + depth);
  }
  insertCard(cam: THREE.Camera, name: string, acct: string) {
    if (this.card) this.card.removeFromParent();
    this.card = this.makeCard(name, acct);
    this.m.screenFrame.add(this.card);
    // start in front of the camera (world) → expressed in screenFrame
    const start = new THREE.Matrix4().compose(
      _v.set(0.07, -0.13, -0.32).applyMatrix4(cam.matrixWorld),
      cam.getWorldQuaternion(_q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0.3, 0))),
      new THREE.Vector3(1, 1, 1));
    this.m.screenFrame.updateMatrixWorld(true);
    this.cardFrom.copy(this.m.screenFrame.matrixWorld).invert().multiply(start);
    this.cardPhase = 'in'; this.cardK = 0;
    this.ledCard = 'fast';
  }
  ejectCard(name: string, acct: string) {
    if (!this.card) { this.card = this.makeCard(name, acct); this.m.screenFrame.add(this.card); }
    this.card.visible = true;
    this.cardPhase = 'out'; this.cardK = 0;
    this.ledCard = 'fast';
    this.sfx('cardOut');
  }
  takeCard(cam: THREE.Camera) {
    if (!this.card) return;
    this.cardPhase = 'take'; this.cardK = 0;
    this.cardFrom.copy(this.card.matrix);
    this.camRef = cam;
    this.ledCard = 'slow';
  }
  swallowCard() { this.cardPhase = 'swallow'; this.cardK = 0; this.ledCard = 'off'; this.sfx('swallow'); }
  private camRef: THREE.Camera | null = null;

  // ---------------------------------------------------------------- notes
  private makeNotes(count: number) {
    const g = new THREE.Group();
    const n = Math.min(count, 14);
    for (let i = 0; i < n; i++) {
      const note = buildNote(100);
      note.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.05);
      note.position.set((Math.random() - 0.5) * 0.004, i * 0.00022 + (count > 14 ? i * 0.00025 : 0), (Math.random() - 0.5) * 0.003);
      g.add(note);
    }
    g.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
    g.userData.count = count;
    return g;
  }
  dispense(baht: number) {
    this.notes?.removeFromParent();
    this.notes = this.makeNotes(Math.max(1, Math.round(baht / 100)));
    this.notes.position.set(0, -0.004, -0.05);
    this.m.cashSlot.add(this.notes);
    this.shutterTarget = 1;
    this.notesPhase = 'out'; this.notesK = 0;
    this.sfx('shutterOpen');
  }
  takeNotes(cam: THREE.Camera) { if (!this.notes) return; this.notesPhase = 'take'; this.notesK = 0; this.camRef = cam; this.notes.userData.from = this.notes.position.clone(); }
  retractNotes() { if (!this.notes) return; this.notesPhase = 'retract'; this.notesK = 0; this.sfx('warn'); }
  /** deposit: notes fly from the camera into the open shutter */
  depositNotes(cam: THREE.Camera, baht: number) {
    this.notes?.removeFromParent();
    this.notes = this.makeNotes(Math.max(1, Math.round(baht / 100)));
    this.m.cashSlot.add(this.notes);
    this.camRef = cam;
    this.notesPhase = 'deposit'; this.notesK = 0;
  }
  /** start of a session: finish any leftover prop animation from the previous customer */
  resetProps() {
    this.card?.removeFromParent(); this.card = null; this.cardPhase = 'none';
    this.notes?.removeFromParent(); this.notes = null; this.notesPhase = 'none';
    this.receipt?.removeFromParent(); this.receipt = null; this.receiptPhase = 'none';
    this.shutterTarget = 0; this.ledCash = false; this.ledCard = 'slow';
  }
  openShutter(on: boolean) { if ((this.shutterTarget > 0.5) !== on) this.sfx(on ? 'shutterOpen' : 'shutterClose'); this.shutterTarget = on ? 1 : 0; }

  // ---------------------------------------------------------------- receipt
  printReceipt(d: ReceiptData) {
    this.receipt?.removeFromParent();
    const tex = receiptTexture(d, BRANDS[d.bank] ?? this.brand);
    const geo = new THREE.PlaneGeometry(0.078, 0.13, 1, 16);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
    mat.userData.ink = 0.3;
    this.receipt = new THREE.Mesh(geo, mat);
    this.receipt.userData.base = (geo.attributes.position as THREE.BufferAttribute).array.slice();
    this.receipt.raycast = THREE.Mesh.prototype.raycast;
    this.m.receiptSlot.add(this.receipt);
    this.receiptPhase = 'print'; this.receiptK = 0;
    this.sfx('printer');
  }
  takeReceipt(cam: THREE.Camera) { if (!this.receipt) return; this.receiptPhase = 'take'; this.receiptK = 0; this.camRef = cam; }

  /** bend the receipt strip out of the slot: visible length = k * L, curling down */
  private shapeReceipt(k: number) {
    const r = this.receipt!;
    const pos = r.geometry.attributes.position as THREE.BufferAttribute;
    const base = r.userData.base as Float32Array;
    const L = 0.13, vis = Math.max(0.002, k * L);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const t = (by + L / 2) / L;                     // 0 = bottom edge (comes out first) … 1 = header (stays by the slot, reads upright)
      const s = vis - t * L;                          // arc length out of the slot (<0 = still inside)
      if (s <= 0) { pos.setXYZ(i, bx, 0, s * 0.3 - 0.002); continue; }
      // arc of radius R out of the slot, then a straight hanging tail (tangent continues)
      const R = 0.075, a = Math.min(s / R, 1.15), ex = s - R * a;
      const z = R * Math.sin(a) + ex * Math.cos(a), y = -R * (1 - Math.cos(a)) - ex * Math.sin(a);
      pos.setXYZ(i, bx * (1 - 0.03 * a), y, z);
    }
    pos.needsUpdate = true;
    r.geometry.computeVertexNormals();
  }

  // ---------------------------------------------------------------- frame
  frame(dt: number, t: number, spec: ScreenSpec | null, camPos: THREE.Vector3) {
    const m = this.m;
    const d = this.root.position.distanceTo(camPos);
    // distance LOD: whole machine beyond 90 m, small detail beyond 16 m
    const vis = d < 90;
    if (this.root.visible !== vis) this.root.visible = vis;
    if (!vis) return;
    const det = d < 16;
    if (this.detailOn !== det) { this.detailOn = det; for (const o of m.details) o.visible = det; }
    // screen
    if (spec && d < 28) {
      const cl = gameDate(this.game.g.day ?? 1, this.game.clock.time);
      this.screen.clock = { date: cl.date, time: cl.time };
      this.screen.draw(spec, d < 6 ? t : Math.floor(t * 5) / 5);
    }
    const night = (this.game.clock as any).nightFactor ?? 0;
    m.screenMat.emissiveIntensity = 1.05 + 0.25 * night;
    m.signMat.emissiveIntensity = 1.1 + 1.3 * night;
    m.ledWhite.emissiveIntensity = 0.6 + 2.4 * night;
    // LEDs
    const blink = this.ledCard === 'fast' ? (Math.sin(t * 14) > 0 ? 1 : 0.15) : this.ledCard === 'slow' ? 0.45 + 0.4 * Math.sin(t * 2.4) : 0.05;
    m.cardLed.emissiveIntensity = 0.15 + 1.6 * blink;
    m.cashLed.emissiveIntensity = this.ledCash ? (Math.sin(t * 9) > 0 ? 1.1 : 0.2) : 0.02;
    // shutter
    this.shutterOpen += (this.shutterTarget - this.shutterOpen) * Math.min(1, dt * 7);
    m.shutter.scale.y = Math.max(0.04, 1 - this.shutterOpen * 0.96);
    // key presses
    let dirty = false;
    for (let i = 0; i < 16; i++) {
      if (this.keyPress[i] > 0 || i === this.hoverKey || (this as any)._hk === i) {
        this.keyPress[i] = Math.max(0, this.keyPress[i] - dt * 7);
        const p = Math.sin(Math.min(1, this.keyPress[i]) * Math.PI) * 0.0026;
        _m.copy(m.keyBase[i]).multiply(new THREE.Matrix4().makeTranslation(0, 0, -p));
        m.keyCaps.setMatrixAt(i, _m); m.keyLabels.setMatrixAt(i, _m);
        dirty = true;
      }
    }
    if (dirty) { m.keyCaps.instanceMatrix.needsUpdate = true; m.keyLabels.instanceMatrix.needsUpdate = true; }
    dirty = false;
    for (let i = 0; i < 8; i++) if (this.fdkPress[i] > 0) {
      this.fdkPress[i] = Math.max(0, this.fdkPress[i] - dt * 7);
      const p = Math.sin(Math.min(1, this.fdkPress[i]) * Math.PI) * 0.0024;
      _m.copy(m.fdkBase[i]).multiply(new THREE.Matrix4().makeTranslation(0, 0, -p));
      m.fdkCaps.setMatrixAt(i, _m); m.fdkLabels.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) { m.fdkCaps.instanceMatrix.needsUpdate = true; m.fdkLabels.instanceMatrix.needsUpdate = true; }
    // hover tint on caps
    if ((this as any)._hk !== this.hoverKey) {
      const prev = (this as any)._hk ?? -1;
      const col = m.keyCaps.instanceColor!;
      if (prev >= 0) col.setXYZ(prev, col.getX(prev) / 1.28, col.getY(prev) / 1.22, col.getZ(prev) / 1.1);
      if (this.hoverKey >= 0) col.setXYZ(this.hoverKey, col.getX(this.hoverKey) * 1.28, col.getY(this.hoverKey) * 1.22, col.getZ(this.hoverKey) * 1.1);
      col.needsUpdate = true;
      (this as any)._hk = this.hoverKey;
    }
    if ((this as any)._hf !== this.hoverFdk) {
      const col = m.fdkCaps.instanceColor!;
      for (let i = 0; i < 8; i++) col.setXYZ(i, 1, 1, 1);
      if (this.hoverFdk >= 0) col.setXYZ(this.hoverFdk, 1.3, 1.2, 1.05);
      col.needsUpdate = true;
      (this as any)._hf = this.hoverFdk;
    }
    this.animCard(dt);
    this.animNotes(dt);
    this.animReceipt(dt);
  }

  private camLocal(parent: THREE.Object3D, off: [number, number, number], out: THREE.Vector3) {
    const cam = this.camRef ?? this.game.camera;
    out.set(off[0], off[1], off[2]).applyMatrix4(cam.matrixWorld);
    parent.updateMatrixWorld(true);
    return parent.worldToLocal(out);
  }

  private animCard(dt: number) {
    const c = this.card;
    if (!c) return;
    const sm = THREE.MathUtils.smootherstep;
    if (this.cardPhase === 'in') {
      this.cardK += dt;
      const pre = this.cardLocal(0.13, new THREE.Matrix4());
      if (this.cardK < 0.5) {
        const k = sm(this.cardK / 0.5, 0, 1);
        lerpMatrix(this.cardFrom, pre, k, c);
      } else {
        if (!(c.userData.sfx)) { c.userData.sfx = 1; this.sfx('cardIn'); }
        const k = sm((this.cardK - 0.5) / 0.75, 0, 1);
        this.cardLocal(0.13 - k * 0.2, _m);
        _m.decompose(c.position, c.quaternion, c.scale);
        if (this.cardK > 1.25) { this.cardPhase = 'inside'; c.visible = false; c.userData.sfx = 0; this.ledCard = 'off'; }
      }
    } else if (this.cardPhase === 'out') {
      this.cardK += dt;
      const k = sm(Math.min(1, this.cardK / 0.65), 0, 1);
      this.cardLocal(-0.07 + k * 0.115, _m);
      _m.decompose(c.position, c.quaternion, c.scale);
    } else if (this.cardPhase === 'take') {
      this.cardK += dt;
      const k = sm(Math.min(1, this.cardK / 0.45), 0, 1);
      const p = this.camLocal(this.m.screenFrame, [0.06, -0.16, -0.25], _v);
      c.position.lerp(p, k * 0.35 + 0.05);
      c.scale.setScalar(1 - k * 0.6);
      if (this.cardK > 0.45) { c.removeFromParent(); this.card = null; this.cardPhase = 'none'; this.ledCard = 'slow'; }
    } else if (this.cardPhase === 'swallow') {
      this.cardK += dt;
      if (this.cardK > 1.1) { c.removeFromParent(); this.card = null; this.cardPhase = 'none'; }
    }
  }

  private animNotes(dt: number) {
    const n = this.notes;
    if (!n) return;
    const sm = THREE.MathUtils.smootherstep;
    if (this.notesPhase === 'out') {
      this.notesK += dt;
      const k = sm(Math.min(1, Math.max(0, this.notesK - 0.35) / 0.7), 0, 1);
      n.position.set(0, -0.004, -0.05 + k * 0.078);
      if (this.notesK > 1.05) { this.notesPhase = 'ready'; this.ledCash = true; }
    } else if (this.notesPhase === 'ready') {
      // fluttering in the fan of the dispenser
      n.rotation.z = Math.sin(performance.now() / 180) * 0.004;
    } else if (this.notesPhase === 'take') {
      this.notesK += dt;
      const k = sm(Math.min(1, this.notesK / 0.5), 0, 1);
      const p = this.camLocal(this.m.cashSlot, [0.0, -0.2, -0.3], _v);
      n.position.lerpVectors(n.userData.from, p, k);
      n.scale.setScalar(1 - k * 0.5);
      this.ledCash = false;
      if (this.notesK > 0.5) { n.removeFromParent(); this.notes = null; this.notesPhase = 'none'; this.openShutter(false); }
    } else if (this.notesPhase === 'retract') {
      this.notesK += dt;
      const k = sm(Math.min(1, this.notesK / 0.8), 0, 1);
      n.position.z = 0.028 - k * 0.08;
      this.ledCash = false;
      if (this.notesK > 0.8) { n.removeFromParent(); this.notes = null; this.notesPhase = 'none'; this.openShutter(false); }
    } else if (this.notesPhase === 'deposit') {
      this.notesK += dt;
      const from = this.camLocal(this.m.cashSlot, [0.0, -0.18, -0.3], _v2).clone();
      const k1 = sm(Math.min(1, this.notesK / 0.45), 0, 1);
      if (this.notesK < 0.45) { n.position.lerpVectors(from, new THREE.Vector3(0, -0.004, 0.05), k1); n.scale.setScalar(0.6 + 0.4 * k1); }
      else {
        const k2 = sm(Math.min(1, (this.notesK - 0.45) / 0.5), 0, 1);
        n.position.set(0, -0.004, 0.05 - k2 * 0.1);
        n.scale.setScalar(1);
        if (this.notesK > 0.95) { n.removeFromParent(); this.notes = null; this.notesPhase = 'none'; this.openShutter(false); this.sfx('counter'); }
      }
    }
  }

  private animReceipt(dt: number) {
    const r = this.receipt;
    if (!r) return;
    if (this.receiptPhase === 'print') {
      this.receiptK += dt / 1.45;
      this.shapeReceipt(Math.min(1, this.receiptK));
      if (this.receiptK >= 1) this.receiptPhase = 'ready';
    } else if (this.receiptPhase === 'ready') {
      r.rotation.x = Math.sin(performance.now() / 300) * 0.015;
    } else if (this.receiptPhase === 'take') {
      this.receiptK += dt / 0.45;
      const k = Math.min(1, this.receiptK);
      const p = this.camLocal(this.m.receiptSlot, [-0.05, -0.18, -0.28], _v);
      r.position.lerp(p, k * 0.3 + 0.05);
      r.scale.setScalar(1 - k * 0.5);
      if (k >= 1) { r.removeFromParent(); this.receipt = null; this.receiptPhase = 'none'; }
    }
  }

  dispose() {
    this.game.interact.unregister(this.root);
    this.root.removeFromParent();
    this.m.dispose();
    this.screen.tex.dispose();
  }
}

function lerpMatrix(a: THREE.Matrix4, b: THREE.Matrix4, k: number, o: THREE.Object3D) {
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
  const pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  a.decompose(pa, qa, sa); b.decompose(pb, qb, sb);
  o.position.lerpVectors(pa, pb, k);
  o.quaternion.slerpQuaternions(qa, qb, k);
  o.scale.lerpVectors(sa, sb, k);
}

// ================================================================== local session

type St =
  | 'attract' | 'inserting' | 'reading' | 'lang' | 'pinNew' | 'pinNew2' | 'pin' | 'wait' | 'menu'
  | 'wd' | 'wdOther' | 'wdFee' | 'cash' | 'rcptQ' | 'printing' | 'rcptTake' | 'more' | 'balance'
  | 'dep' | 'depOther' | 'depInsert' | 'depConfirm' | 'xfer' | 'xferAmt' | 'xferConfirm'
  | 'cpOld' | 'cpNew' | 'cpNew2' | 'msg' | 'eject' | 'thanks' | 'retained' | 'timeoutQ';

interface Tx { type: L2; amount: number; fee: number; bal: number; ref: string; to?: string; interest?: number }

export class AtmUI {
  unit: AtmUnit | null = null;
  st: St = 'attract';
  private buf = '';
  private pin1 = '';
  private oldPin = '';
  private amount = 0;
  private xferTo = -1;
  private seq = 1;
  private waitSeq = 0;
  private waitCb: ((r: Res) => void) | null = null;
  private waitT = 0;
  private msgSpec: ScreenSpec | null = null;
  private timer: { t: number; fn: () => void; st: St } | null = null;
  private idle = 0;
  private prevSt: St = 'menu';
  private tx: Tx | null = null;
  private focus: Focus = 'screen';
  private camK = 0;
  private camFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 70 };
  private camCur = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 46 };
  private leaving = 0;
  private ray = new THREE.Raycaster();
  private hoverSel: { kind: string; i?: number; side?: 'L' | 'R' } | null = null;
  private t = 0;
  private savedCursor = '';
  private wrongNote: L2 | null = null;
  private langPicked = false;
  /** re-hide our own body for a few frames (the player view re-shows it right after the mode switch) */
  private fpFix = 0;

  constructor(private game: Game) {}

  get active() { return !!this.unit; }

  // ---------------------------------------------------------------- enter / exit
  enter(u: AtmUnit) {
    const game = this.game, pl = game.player, me = game.me;
    if (!pl || !me || this.unit || pl.mode !== 'play') return;
    const busy = (game.g as any).atm?.busy?.[u.id];
    if (busy && busy.id !== me.id && game.state.get(busy.id)) { game.interact.hintOnce('atm.busy' + Math.floor(game.engine.time / 8), 'มีคนใช้ตู้นี้อยู่ รอสักครู่นะ / someone is using this ATM', 3); return; }
    this.unit = u;
    game.intent('atm.use', { atm: u.id, on: true });
    const cam = game.camera;
    this.camFrom.p.copy(cam.getWorldPosition(_v)); this.camFrom.q.copy(cam.getWorldQuaternion(_q)); this.camFrom.fov = cam.fov;
    this.camCur.p.copy(this.camFrom.p); this.camCur.q.copy(this.camFrom.q); this.camCur.fov = cam.fov;
    this.camK = 0; this.leaving = 0;
    pl.setMode('external');
    this.fpFix = 6;
    const sp = u.local(STAND, new THREE.Vector3());
    sp.y = game.world?.groundY(sp.x, sp.z) ?? u.root.position.y;
    pl.teleport([sp.x, sp.y, sp.z], u.yaw);
    this.savedCursor = game.engine.canvas.style.cursor;
    this.reset();
    u.resetProps();
    u.screen.lang = 'th';
    this.go('attract');
    game.interact.hintOnce('atm.keys', 'เมาส์: กดปุ่มจริงบนตู้ / แตะหน้าจอ · คีย์บอร์ด 0-9 · Enter ยืนยัน · Backspace แก้ไข · Esc ยกเลิก', 7);
  }

  private reset() {
    this.buf = ''; this.pin1 = ''; this.oldPin = ''; this.amount = 0; this.xferTo = -1; this.tx = null;
    this.waitCb = null; this.timer = null; this.idle = 0; this.wrongNote = null; this.langPicked = false;
  }

  exit() {
    if (!this.unit || this.leaving) return;
    const u = this.unit;
    // hand back anything still in the machine
    if (u.notesPhase === 'ready' || u.notesPhase === 'out') { if (!this.cashIsReturn) this.op('take', {}, () => {}); u.takeNotes(this.game.camera); this.cashIsReturn = false; }
    if (u.receiptPhase === 'ready' || u.receiptPhase === 'print') this.giveReceipt();
    if (u.card && u.cardPhase !== 'swallow') { u.card.removeFromParent(); u.card = null; u.cardPhase = 'none'; u.ledCard = 'slow'; }
    this.leaving = 0.0001;
    this.camK = 0;
    this.camFrom.p.copy(this.camCur.p); this.camFrom.q.copy(this.camCur.q); this.camFrom.fov = this.camCur.fov;
  }

  private finishExit() {
    const game = this.game, u = this.unit!, pl = game.player;
    game.intent('atm.use', { atm: u.id, on: false });
    u.hoverKey = -1; u.hoverFdk = -1; u.screen.hover = null;
    game.engine.canvas.style.cursor = this.savedCursor;
    this.unit = null;
    this.st = 'attract';
    const rg = pl?.rig();
    if (rg) rg.root.visible = true;
    if (pl && pl.mode === 'external') {
      pl.pitch = 0.08;
      pl.setMode('play');
      game.camera.fov = pl.baseFov; game.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- helpers
  private go(st: St, msg?: ScreenSpec) {
    if (st !== 'timeoutQ' && st !== 'msg') this.prevSt = st;
    this.st = st;
    this.timer = null;
    this.idle = 0;
    if (msg) this.msgSpec = msg;
    if (st === 'pin' || st === 'pinNew' || st === 'pinNew2' || st === 'cpOld' || st === 'cpNew' || st === 'cpNew2' || st === 'wdOther' || st === 'depOther' || st === 'xferAmt') this.buf = '';
    this.focus = st === 'pin' || st === 'pinNew' || st === 'pinNew2' || st === 'cpOld' || st === 'cpNew' || st === 'cpNew2' || st === 'wdOther' || st === 'depOther' || st === 'xferAmt' ? 'keypad'
      : st === 'cash' || st === 'depInsert' ? 'cash'
      : st === 'eject' || st === 'inserting' || st === 'attract' || st === 'retained' ? 'card'
      : st === 'rcptTake' || st === 'printing' ? 'receipt' : 'screen';
  }
  private after(sec: number, fn: () => void) { this.timer = { t: this.t + sec, fn, st: this.st }; }
  private message(spec: ScreenSpec, sec: number, then: () => void) {
    this.go('msg', spec);
    this.after(sec, then);
    if (spec.tone === 'err') this.unit?.sfx('err');
    else if (spec.tone === 'ok') this.unit?.sfx('ok');
  }

  private me() { return this.game.me; }
  private acc() { const me = this.me(); return me ? accountOf(this.game, me.slot) : null; }
  private name() { return this.me()?.name ?? 'PLAYER'; }
  private acctMasked() { const no = this.acc()?.no ?? '811-1-00000-0'; return 'XXX-X-X' + no.slice(-6); }
  private cardNo() { const no = (this.acc()?.no ?? '0000').replace(/\D/g, ''); return `6011 81${no.slice(0, 2)} XXXX ${no.slice(-4).padStart(4, '0')}`; }
  private fee() { const u = this.unit!; return u.brand.id === HOME.id ? 0 : u.brand.fee; }

  /** send an op and run cb with the host's answer */
  private op(op: string, data: any, cb: (r: Res) => void) {
    const seq = this.seq++ + Math.floor(Math.random() * 1000) * 100000;
    this.waitSeq = seq; this.waitCb = cb; this.waitT = this.t;
    this.game.intent('atm.op', { ...data, op, seq, atm: this.unit?.id });
    this.pollReply();
  }
  private pollReply() {
    if (!this.waitCb) return;
    const r = this.acc()?.res;
    if (r && r.seq === this.waitSeq) { const cb = this.waitCb; this.waitCb = null; cb(r); }
    else if (this.t - this.waitT > 8) {
      this.waitCb = null;
      this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['ระบบขัดข้องชั่วคราว', 'Temporarily unavailable'], sub: ['กรุณาทำรายการใหม่อีกครั้ง', 'Please try again'] }, 3, () => this.endSession());
    }
  }
  /** processing screen that waits at least `minSec` for realism, then delivers the reply */
  private process(op: string, data: any, minSec: number, cb: (r: Res) => void, title?: L2) {
    this.go('wait', { kind: 'spinner', title: title ?? ['กำลังดำเนินการ', 'Processing'], sub: ['กรุณารอสักครู่', 'Please wait'] });
    const t0 = this.t;
    let res: Res | null = null;
    this.op(op, data, (r) => { res = r; });
    const tick = () => {
      if (res && this.t - t0 >= minSec) { cb(res); return; }
      this.after(0.1, tick);
    };
    this.after(0.1, tick);
  }

  private endSession() {
    if (!this.unit) return;
    this.op('end', {}, () => {});
    this.go('eject', { kind: 'message', icon: 'card', title: ['กรุณารับบัตรคืน', 'Please take your card'], sub: ['อย่าลืมบัตรของท่าน', "Don't forget your card"], anim: true });
    this.unit.ejectCard(this.name(), this.cardNo());
    this.after(20, () => this.takeCard());
  }
  private takeCard() {
    if (this.st !== 'eject' || !this.unit) return;
    this.unit.takeCard(this.game.camera);
    Sound.play('paper_rustle', { vol: 0.25, pitch: 1.6 });
    this.go('thanks', { kind: 'message', tone: 'ok', icon: 'ok', title: ['ขอบคุณที่ใช้บริการ', 'Thank you'], sub: [this.unit.brand.th, this.unit.brand.en] });
    this.after(2.2, () => { this.go('attract'); this.exit(); });
  }

  private retainCard() {
    const u = this.unit!;
    u.swallowCard();
    this.go('retained', { kind: 'retained', tone: 'err', title: ['บัตรของท่านถูกเก็บไว้', 'Your card has been retained'], sub: ['กดรหัสผิดเกิน 3 ครั้ง · รับบัตรคืนได้พรุ่งนี้', 'Wrong PIN 3 times · card returned tomorrow'] });
    this.after(4.5, () => { this.go('attract'); this.exit(); });
  }

  // ---------------------------------------------------------------- transactions
  private startWithdraw(baht: number) {
    const fee = this.fee();
    this.amount = baht;
    if (fee > 0) { this.go('wdFee'); return; }
    this.doWithdraw();
  }
  private doWithdraw() {
    const baht = this.amount;
    this.unit!.sfx('counter');
    this.process('withdraw', { amount: baht }, 1.7, (r) => {
      if (!r.ok) { this.fail(r); return; }
      this.tx = { type: ['ถอนเงิน', 'WITHDRAWAL'], amount: r.amount ?? baht * 100, fee: r.fee ?? 0, bal: r.bal ?? 0, ref: r.ref ?? '' };
      this.unit!.dispense(baht);
      this.go('cash', { kind: 'cash', icon: 'cash', title: ['กรุณารับเงิน', 'Please take your cash'], sub: [`฿${fmtBaht(baht)}`, `฿${fmtBaht(baht)}`], anim: true });
      this.after(26, () => this.retract());
    }, ['กำลังทำรายการถอนเงิน', 'Processing withdrawal']);
  }
  private takeCash() {
    const u = this.unit!;
    if (u.notesPhase !== 'ready' && u.notesPhase !== 'out') return;
    u.takeNotes(this.game.camera);
    Sound.play('banknote', { vol: 0.7 });
    this.op('take', {}, () => {});
    this.go('rcptQ');
  }
  private retract() {
    if (this.st !== 'cash') return;
    this.unit!.retractNotes();
    this.op('retract', {}, () => {});
    this.tx = null;
    this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['เครื่องเก็บเงินคืนแล้ว', 'Cash retracted'], sub: ['ท่านไม่ได้รับเงินภายในเวลาที่กำหนด เงินคืนเข้าบัญชี', 'Not taken in time — returned to your account'] }, 3.5, () => this.go('more'));
  }
  private fail(r: Res) {
    const map: Record<string, [L2, L2]> = {
      funds: [['ยอดเงินในบัญชีไม่เพียงพอ', 'Insufficient funds'], [`ยอดคงเหลือ ฿${fmtSatang(r.bal ?? 0)}`, `Available ฿${fmtSatang(r.bal ?? 0)}`]],
      notes: [['จำนวนเงินไม่ถูกต้อง', 'Invalid amount'], ['เครื่องจ่าย/รับธนบัตรตามที่กำหนดเท่านั้น', 'Notes only, see the amounts allowed']],
      limit: [['เกินวงเงินต่อรายการ', 'Over the transaction limit'], ['สูงสุด 20,000 บาท ต่อรายการ', 'Max ฿20,000 per transaction']],
      nocash: [['เงินสดในกระเป๋าไม่พอ', 'Not enough cash in your wallet'], ['ลองนับเงินในกระเป๋าใหม่อีกที', 'Count your wallet again']],
      noacct: [['ไม่พบบัญชีปลายทาง', 'Recipient account not found'], ['เพื่อนต้องอยู่ในเกมเดียวกัน', 'Your friend must be in this game']],
      auth: [['หมดเวลาการทำรายการ', 'Session expired'], ['กรุณาสอดบัตรใหม่', 'Please insert your card again']],
      pending: [['กรุณารับเงินก่อนหน้า', 'Please take your previous cash'], ['', '']],
      retained: [['บัตรถูกระงับ', 'Card retained'], ['', '']],
    };
    if (r.code === 'retained') { this.retainCard(); return; }
    const m = map[r.code ?? ''] ?? [['ไม่สามารถทำรายการได้', 'Transaction failed'], ['กรุณาลองใหม่', 'Please try again']];
    this.message({ kind: 'message', tone: 'err', icon: 'err', title: m[0], sub: m[1] }, 3.2, () => (r.code === 'auth' ? this.endSession() : this.go('more')));
  }
  private receiptData(): ReceiptData | null {
    if (!this.tx || !this.unit) return null;
    const cl = gameDate(this.game.g.day ?? 1, this.game.clock.time);
    return {
      bank: this.unit.brand.id, atm: `${this.unit.brand.code}-${this.unit.id.slice(-4).toUpperCase()}`, date: cl.date, time: cl.time,
      type: this.tx.type[0], typeEn: this.tx.type[1], amount: this.tx.amount, fee: this.tx.fee, bal: this.tx.bal, acct: this.acctMasked(), ref: this.tx.ref,
      to: this.tx.to, name: this.name(), interest: this.tx.interest,
    };
  }
  private print() {
    const d = this.receiptData();
    if (!d) { this.go('more'); return; }
    this.unit!.printReceipt(d);
    this.go('printing', { kind: 'spinner', title: ['กำลังพิมพ์ใบบันทึกรายการ', 'Printing your receipt'], sub: ['กรุณารอสักครู่', 'Please wait'] });
    this.after(1.6, () => {
      this.go('rcptTake', { kind: 'message', icon: 'receipt', title: ['กรุณารับใบบันทึกรายการ', 'Please take your receipt'], sub: ['ใบบันทึกรายการอยู่ที่ช่องด้านซ้าย', 'Receipt slot on the left'], anim: true });
      this.after(15, () => this.takeReceipt());
    });
  }
  private giveReceipt() {
    const d = this.receiptData();
    if (d) this.op('receipt', { rcpt: d }, () => {});
    this.tx = null;
  }
  private takeReceipt() {
    if (this.st !== 'rcptTake' || !this.unit) return;
    this.unit.takeReceipt(this.game.camera);
    Sound.play('paper_rustle', { vol: 0.5 });
    this.giveReceipt();
    this.go('more');
  }

  // ---------------------------------------------------------------- screen specs per state
  spec(): ScreenSpec {
    const acc = this.acc();
    const wallet = this.me()?.wallet ?? 0;
    const back: Opt = { t: ['ย้อนกลับ', 'Back'], act: () => this.go('menu') };
    const cancel: Opt = { t: ['ยกเลิก', 'Cancel'], act: () => this.endSession(), tone: 'err' };
    switch (this.st) {
      case 'attract': return { kind: 'attract' };
      case 'inserting': case 'reading': return { kind: 'spinner', title: ['กำลังอ่านบัตร', 'Reading your card'], sub: ['กรุณารอสักครู่', 'Please wait'] };
      case 'lang': return {
        kind: 'menu', title: ['กรุณาเลือกภาษา', 'Please select your language'], sub: [`สวัสดีครับ คุณ${this.name()}`, `Welcome, ${this.name()}`],
        right: [null, { t: ['ภาษาไทย', 'Thai'], act: () => this.pickLang('th') }, { t: ['English', 'อังกฤษ'], act: () => this.pickLang('en') }, null],
        left: [null, null, null, cancel],
      };
      case 'pinNew': return { kind: 'pin', pin: this.buf.length, title: ['ตั้งรหัสบัตร ATM ใหม่ (4 หลัก)', 'Set a new 4-digit PIN'], sub: ['ใช้บัตรครั้งแรก · ห้ามใช้วันเกิดนะ', 'First use · not your birthday please'], footer: ['กด "ยืนยัน" เมื่อครบ 4 หลัก · "แก้ไข" เพื่อลบ', 'ENTER when done · CLEAR to delete'] };
      case 'pinNew2': return { kind: 'pin', pin: this.buf.length, title: ['กรุณากดรหัสใหม่อีกครั้ง', 'Re-enter your new PIN'], sub: ['เพื่อยืนยันรหัส', 'To confirm'] };
      case 'pin': return { kind: 'pin', pin: this.buf.length, tone: this.wrongNote ? 'err' : undefined, title: ['กรุณากดรหัสบัตร ATM', 'Please enter your PIN'], sub: this.wrongNote ?? ['ปิดบังแป้นขณะกดรหัส', 'Cover the keypad'], footer: this.wrongNote ? this.wrongNote : undefined };
      case 'cpOld': return { kind: 'pin', pin: this.buf.length, title: ['กรุณากดรหัสเดิม', 'Enter your current PIN'], sub: ['เปลี่ยนรหัส', 'Change PIN'] };
      case 'cpNew': return { kind: 'pin', pin: this.buf.length, title: ['กรุณากดรหัสใหม่ 4 หลัก', 'Enter a new 4-digit PIN'], sub: ['เปลี่ยนรหัส', 'Change PIN'] };
      case 'cpNew2': return { kind: 'pin', pin: this.buf.length, title: ['กรุณากดรหัสใหม่อีกครั้ง', 'Re-enter the new PIN'], sub: ['เปลี่ยนรหัส', 'Change PIN'] };
      case 'menu': return {
        kind: 'menu', title: ['กรุณาเลือกรายการ', 'Please select a transaction'], sub: [`บัญชี ${this.acctMasked()}`, `Account ${this.acctMasked()}`],
        left: [
          { t: ['ถอนเงิน', 'Withdrawal'], act: () => this.go('wd') },
          { t: ['ฝากเงิน', 'Cash deposit'], act: () => this.go('dep') },
          { t: ['โอนเงิน / พร้อมเพย์', 'Transfer / PromptPay'], act: () => this.go('xfer') },
          { t: ['ถอนด่วน 500', 'Fast cash ฿500'], act: () => this.startWithdraw(500) },
        ],
        right: [
          { t: ['สอบถามยอด', 'Balance inquiry'], act: () => this.balance() },
          { t: ['เปลี่ยนรหัส', 'Change PIN'], act: () => this.go('cpOld') },
          null,
          { t: ['จบรายการ', 'End'], act: () => this.endSession(), tone: 'err' },
        ],
      };
      case 'wd': {
        const a = (n: number): Opt => ({ t: [fmtBaht(n), fmtBaht(n)], act: () => this.startWithdraw(n) });
        const f = this.fee();
        return {
          kind: 'menu', title: ['ถอนเงิน — เลือกจำนวนเงิน', 'Withdrawal — select amount'],
          sub: f ? [`บัตรต่างธนาคาร ค่าธรรมเนียม ${f} บาท/รายการ`, `Other-bank card: ฿${f} fee`] : ['เครื่องจ่ายธนบัตร 100 บาท', 'Dispenses ฿100 notes'],
          left: [a(100), a(500), a(1000), a(2000)],
          right: [a(5000), a(10000), { t: ['จำนวนอื่น', 'Other amount'], act: () => this.go('wdOther') }, back],
        };
      }
      case 'wdOther': return { kind: 'amount', amount: this.buf, title: ['ระบุจำนวนเงินที่ต้องการถอน', 'Enter the amount to withdraw'], sub: ['ทีละ 100 บาท · สูงสุด 20,000 บาท', 'Multiples of ฿100 · max ฿20,000'], footer: ['กด "ยืนยัน" เพื่อทำรายการ · "ยกเลิก" เพื่อย้อนกลับ', 'ENTER to confirm · CANCEL to go back'] };
      case 'wdFee': return {
        kind: 'table', title: ['ยืนยันการถอนเงิน', 'Confirm withdrawal'],
        rows: [['จำนวนเงิน', 'Amount', '฿' + fmtBaht(this.amount)], ['ค่าธรรมเนียมต่างธนาคาร', 'Other-bank fee', '฿' + fmtBaht(this.fee())], ['รวมหักจากบัญชี', 'Total debit', '฿' + fmtBaht(this.amount + this.fee())]],
        left: [null, null, null, { t: ['ยกเลิก', 'Cancel'], act: () => this.go('wd'), tone: 'err' }],
        right: [null, null, null, { t: ['ยืนยัน', 'Confirm'], act: () => this.doWithdraw(), tone: 'ok' }],
      };
      case 'rcptQ': return {
        kind: 'menu', title: ['ต้องการใบบันทึกรายการหรือไม่?', 'Would you like a receipt?'], sub: ['ไม่รับสลิป ช่วยลดขยะกระดาษ', 'No slip = less paper waste'],
        right: [null, null, { t: ['ต้องการ', 'Yes, print'], act: () => this.print() }, { t: ['ไม่ต้องการ', 'No thanks'], act: () => { this.tx = null; this.go('more'); } }],
      };
      case 'more': return {
        kind: 'menu', title: ['ต้องการทำรายการอื่นหรือไม่?', 'Another transaction?'],
        right: [null, null, { t: ['ทำรายการต่อ', 'Yes'], act: () => this.go('menu') }, { t: ['ไม่ทำรายการ', 'No, finish'], act: () => this.endSession(), tone: 'err' }],
      };
      case 'balance': {
        const bal = acc?.bal ?? 0;
        return {
          kind: 'table', title: ['ยอดเงินในบัญชี', 'Account balance'],
          rows: [['ยอดเงินคงเหลือ', 'Ledger balance', '฿' + fmtSatang(bal)], ['ยอดเงินที่ใช้ได้', 'Available balance', '฿' + fmtSatang(bal - (acc?.pending ?? 0) * 0)], ['ดอกเบี้ยรับล่าสุด', 'Last interest paid', '฿' + fmtSatang(acc?.lastInt ?? 0)], ['เงินสดในกระเป๋า', 'Cash in wallet', '฿' + fmtBaht(wallet)]],
          left: [null, null, null, { t: ['จบรายการ', 'End'], act: () => this.endSession(), tone: 'err' }],
          right: [null, null, { t: ['พิมพ์ใบบันทึกรายการ', 'Print receipt'], act: () => this.print() }, { t: ['ทำรายการต่อ', 'Continue'], act: () => { this.tx = null; this.go('menu'); } }],
        };
      }
      case 'dep': {
        const max = depositable(wallet);
        const a = (n: number): Opt => ({ t: [fmtBaht(n), fmtBaht(n)], act: () => this.startDeposit(n), dim: n > max });
        return {
          kind: 'menu', title: ['ฝากเงินสดเข้าบัญชี', 'Cash deposit'], sub: [`รับธนบัตร 20 / 50 / 100 · เงินสดในกระเป๋า ฿${fmtBaht(wallet)}`, `Notes 20/50/100 · wallet ฿${fmtBaht(wallet)}`],
          left: [{ t: [`ฝากทั้งหมด ฿${fmtBaht(max)}`, `Deposit all ฿${fmtBaht(max)}`], act: () => this.startDeposit(max), dim: max < 20 }, a(100), a(500), a(1000)],
          right: [null, null, { t: ['จำนวนอื่น', 'Other amount'], act: () => this.go('depOther') }, back],
        };
      }
      case 'depOther': return { kind: 'amount', amount: this.buf, title: ['ระบุจำนวนเงินที่ต้องการฝาก', 'Enter the amount to deposit'], sub: [`ธนบัตรเท่านั้น (ขั้นต่ำ 20) · ในกระเป๋า ฿${fmtBaht(wallet)}`, `Notes only (min ฿20) · wallet ฿${fmtBaht(wallet)}`] };
      case 'depConfirm': return {
        kind: 'table', title: ['ยืนยันการฝากเงิน', 'Confirm deposit'],
        rows: [['จำนวนเงินฝาก', 'Deposit amount', '฿' + fmtBaht(this.amount)], ['เข้าบัญชี', 'To account', this.acctMasked()], ['ชื่อบัญชี', 'Account name', this.name().slice(0, 16)]],
        left: [null, null, null, { t: ['ยกเลิก (รับเงินคืน)', 'Cancel (return notes)'], act: () => this.cancelDeposit(), tone: 'err' }],
        right: [null, null, null, { t: ['ยืนยัน', 'Confirm'], act: () => this.confirmDeposit(), tone: 'ok' }],
      };
      case 'xfer': {
        const others = this.game.players().filter((p) => p.id !== this.me()?.id).slice(0, 3);
        const opts: (Opt | null)[] = others.map((p) => ({ t: [`คุณ${p.name}`, String(p.name)] as L2, act: () => { this.xferTo = p.slot; this.go('xferAmt'); } }));
        while (opts.length < 3) opts.push(null);
        return {
          kind: 'menu', title: ['โอนเงินพร้อมเพย์ — เลือกผู้รับ', 'PromptPay transfer — select recipient'],
          sub: others.length ? ['โอนฟรี ไม่มีค่าธรรมเนียม', 'Free transfer'] : ['ยังไม่มีเพื่อนในเกมนี้ · ชวนเพื่อนมาเล่นด้วยกัน', 'No friends in this game yet · invite them'],
          left: opts, right: [null, null, null, back],
        };
      }
      case 'xferAmt': return { kind: 'amount', amount: this.buf, title: [`ระบุจำนวนเงินที่โอนให้ คุณ${this.xferName()}`, `Amount to send to ${this.xferName()}`], sub: [`ยอดที่ใช้ได้ ฿${fmtSatang(acc?.bal ?? 0)}`, `Available ฿${fmtSatang(acc?.bal ?? 0)}`] };
      case 'xferConfirm': return {
        kind: 'table', title: ['ยืนยันการโอนเงิน', 'Confirm transfer'],
        rows: [['โอนให้', 'To', this.xferName().slice(0, 16)], ['จำนวนเงิน', 'Amount', '฿' + fmtBaht(this.amount)], ['ค่าธรรมเนียม', 'Fee', 'ฟรี 0.00']],
        left: [null, null, null, { t: ['ยกเลิก', 'Cancel'], act: () => this.go('menu'), tone: 'err' }],
        right: [null, null, null, { t: ['ยืนยัน', 'Confirm'], act: () => this.confirmTransfer(), tone: 'ok' }],
      };
      case 'timeoutQ': {
        const left = Math.max(0, (this.timer?.t ?? this.t) - this.t);
        return {
          kind: 'menu', title: ['คุณต้องการทำรายการต่อหรือไม่?', 'Do you need more time?'], countdown: left,
          right: [null, null, { t: ['ต้องการ', 'Yes, continue'], act: () => this.go(this.prevSt) }, { t: ['ไม่ต้องการ', 'No'], act: () => this.endSession(), tone: 'err' }],
        };
      }
      default: return this.msgSpec ?? { kind: 'menu' };
    }
  }

  private xferName() { const p = this.game.players().find((pp) => pp.slot === this.xferTo); return String(p?.name ?? '—'); }

  private pickLang(l: 'th' | 'en') {
    this.unit!.screen.lang = l;
    this.langPicked = true;
    const acc = this.acc();
    this.go(acc?.pin ? 'pin' : 'pinNew');
  }
  private balance() {
    this.process('balance', {}, 0.9, (r) => {
      if (!r.ok) { this.fail(r); return; }
      this.tx = { type: ['สอบถามยอดเงิน', 'BALANCE INQUIRY'], amount: 0, fee: 0, bal: r.bal ?? 0, ref: r.ref ?? '', interest: r.interest };
      this.go('balance');
    });
  }
  private startDeposit(n: number) {
    const wallet = this.me()?.wallet ?? 0;
    if (n < 20 || n > depositable(wallet)) { this.fail({ seq: 0, op: 'deposit', ok: false, code: n > wallet ? 'nocash' : 'notes' }); return; }
    this.amount = n;
    this.unit!.openShutter(true);
    this.unit!.ledCash = true;
    this.go('depInsert', { kind: 'cash', icon: 'deposit', title: ['กรุณาใส่ธนบัตรในช่องรับเงิน', 'Please insert your notes'], sub: [`฿${fmtBaht(n)} · คลิกที่ช่องรับเงิน หรือกด "ยืนยัน"`, `฿${fmtBaht(n)} · click the cash slot or press ENTER`], anim: true });
    this.after(30, () => { this.unit!.openShutter(false); this.unit!.ledCash = false; this.go('more'); });
  }
  private insertNotes() {
    if (this.st !== 'depInsert') return;
    this.unit!.ledCash = false;
    this.unit!.depositNotes(this.game.camera, this.amount);
    Sound.play('banknote', { vol: 0.6 });
    this.go('wait', { kind: 'spinner', title: ['กำลังตรวจนับธนบัตร', 'Counting your notes'], sub: [`฿${fmtBaht(this.amount)}`, `฿${fmtBaht(this.amount)}`] });
    this.after(2.2, () => this.go('depConfirm'));
  }
  private confirmDeposit() {
    this.process('deposit', { amount: this.amount }, 1.0, (r) => {
      if (!r.ok) { this.fail(r); return; }
      this.tx = { type: ['ฝากเงินสด', 'CASH DEPOSIT'], amount: r.amount ?? this.amount * 100, fee: 0, bal: r.bal ?? 0, ref: r.ref ?? '' };
      this.message({ kind: 'message', tone: 'ok', icon: 'ok', title: ['ฝากเงินเรียบร้อยแล้ว', 'Deposit complete'], sub: [`ยอดคงเหลือ ฿${fmtSatang(r.bal ?? 0)}`, `Balance ฿${fmtSatang(r.bal ?? 0)}`] }, 2.2, () => this.go('rcptQ'));
    });
  }
  private cancelDeposit() {
    const u = this.unit!;
    u.dispense(this.amount);
    this.go('cash', { kind: 'cash', icon: 'cash', title: ['กรุณารับธนบัตรคืน', 'Please take back your notes'], sub: ['ยกเลิกการฝากเงิน', 'Deposit cancelled'], anim: true });
    // notes were never debited: taking them back is purely visual
    this.after(20, () => { u.takeNotes(this.game.camera); this.go('more'); });
    this.cashIsReturn = true;
  }
  private cashIsReturn = false;
  private confirmTransfer() {
    this.process('transfer', { to: this.xferTo, amount: this.amount }, 1.4, (r) => {
      if (!r.ok) { this.fail(r); return; }
      this.tx = { type: ['โอนเงินพร้อมเพย์', 'PROMPTPAY TRANSFER'], amount: r.amount ?? 0, fee: 0, bal: r.bal ?? 0, ref: r.ref ?? '', to: r.to };
      this.message({ kind: 'message', tone: 'ok', icon: 'ok', title: ['โอนเงินสำเร็จ', 'Transfer successful'], sub: [`฿${fmtBaht(this.amount)} → คุณ${r.to}`, `฿${fmtBaht(this.amount)} → ${r.to}`] }, 2.4, () => this.go('rcptQ'));
    });
  }

  // ---------------------------------------------------------------- input
  private digit(d: string) {
    const st = this.st;
    if (st === 'attract') { this.insert(); return; }
    const pinSt = st === 'pin' || st === 'pinNew' || st === 'pinNew2' || st === 'cpOld' || st === 'cpNew' || st === 'cpNew2';
    if (pinSt) { if (this.buf.length < 4) this.buf += d; this.idle = 0; return; }
    if (st === 'wdOther' || st === 'depOther' || st === 'xferAmt') { if (this.buf.length < 5 && !(this.buf === '' && d === '0')) this.buf += d; this.idle = 0; }
  }
  private clear() {
    if (this.buf.length) this.buf = this.buf.slice(0, -1);
    this.idle = 0;
  }
  private enterKey() {
    const st = this.st;
    const n = Number(this.buf || 0);
    switch (st) {
      case 'attract': this.insert(); return;
      case 'pinNew': if (this.buf.length === 4) { this.pin1 = this.buf; this.go('pinNew2'); } else this.unit!.sfx('err'); return;
      case 'pinNew2':
        if (this.buf.length !== 4) { this.unit!.sfx('err'); return; }
        if (this.buf !== this.pin1) { this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['รหัสไม่ตรงกัน', 'PINs do not match'], sub: ['กรุณาตั้งรหัสใหม่อีกครั้ง', 'Please set it again'] }, 2.2, () => this.go('pinNew')); return; }
        this.process('setpin', { pin: this.buf }, 1.0, (r) => r.ok
          ? this.message({ kind: 'message', tone: 'ok', icon: 'ok', title: ['ตั้งรหัสเรียบร้อย', 'PIN set'], sub: ['จำรหัสไว้ให้ดี ห้ามจดไว้หลังบัตร!', "Remember it — don't write it on the card!"] }, 2.2, () => this.go('menu'))
          : this.fail(r));
        return;
      case 'pin':
        if (this.buf.length !== 4) { this.unit!.sfx('err'); return; }
        this.process('verify', { pin: this.buf }, 1.1, (r) => {
          if (r.ok) { this.wrongNote = null; this.go('menu'); return; }
          if (r.code === 'retained') { this.retainCard(); return; }
          const left = 3 - (r.tries ?? 1);
          this.unit!.sfx('err');
          this.wrongNote = [`รหัสไม่ถูกต้อง เหลืออีก ${left} ครั้ง`, `Incorrect PIN — ${left} ${left === 1 ? 'try' : 'tries'} left`];
          this.go('pin');
        }, ['กำลังตรวจสอบรหัส', 'Verifying PIN']);
        return;
      case 'cpOld': if (this.buf.length === 4) { this.oldPin = this.buf; this.go('cpNew'); } return;
      case 'cpNew': if (this.buf.length === 4) { this.pin1 = this.buf; this.go('cpNew2'); } return;
      case 'cpNew2':
        if (this.buf !== this.pin1) { this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['รหัสไม่ตรงกัน', 'PINs do not match'] }, 2, () => this.go('cpNew')); return; }
        this.process('changepin', { old: this.oldPin, pin: this.buf }, 1.0, (r) => r.ok
          ? this.message({ kind: 'message', tone: 'ok', icon: 'ok', title: ['เปลี่ยนรหัสเรียบร้อย', 'PIN changed'] }, 2, () => this.go('more'))
          : r.code === 'wrong' ? this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['รหัสเดิมไม่ถูกต้อง', 'Current PIN incorrect'] }, 2.2, () => this.go('more')) : this.fail(r));
        return;
      case 'wdOther':
        if (n <= 0 || n % 100 !== 0) { this.message({ kind: 'message', tone: 'err', icon: 'err', title: ['กรุณาระบุจำนวนทีละ 100 บาท', 'Multiples of ฿100 only'] }, 2, () => this.go('wdOther')); return; }
        if (n > 20000) { this.fail({ seq: 0, op: 'withdraw', ok: false, code: 'limit' }); return; }
        this.startWithdraw(n); return;
      case 'depOther': this.startDeposit(n); return;
      case 'xferAmt':
        if (n <= 0) { this.unit!.sfx('err'); return; }
        this.amount = n; this.go('xferConfirm'); return;
      case 'cash': this.takeCash(); return;
      case 'depInsert': this.insertNotes(); return;
      case 'rcptTake': this.takeReceipt(); return;
      case 'eject': this.takeCard(); return;
    }
  }
  private cancelKey() {
    const st = this.st;
    if (st === 'attract' || st === 'thanks' || st === 'retained') { this.exit(); return; }
    if (st === 'wait' || st === 'inserting' || st === 'reading' || st === 'printing' || st === 'msg') return;
    if (st === 'cash') { if (this.cashIsReturn) { this.unit!.takeNotes(this.game.camera); this.cashIsReturn = false; this.go('more'); } else this.takeCash(); return; }
    if (st === 'rcptTake') { this.takeReceipt(); return; }
    if (st === 'eject') { this.takeCard(); return; }
    if (st === 'wdOther' || st === 'depOther' || st === 'xferAmt' || st === 'wdFee' || st === 'xferConfirm') { this.go('menu'); return; }
    if (st === 'depInsert') { this.unit!.openShutter(false); this.unit!.ledCash = false; this.go('menu'); return; }
    if (st === 'depConfirm') { this.cancelDeposit(); return; }
    if (st === 'lang' && !this.langPicked) { this.endSession(); return; }
    this.endSession();
  }
  private insert() {
    const u = this.unit;
    if (!u || u.cardPhase !== 'none') return;
    this.go('inserting');
    u.insertCard(this.game.camera, this.name(), this.cardNo());
    this.after(1.3, () => {
      this.go('reading');
      this.op('insert', {}, (r) => {
        this.after(0.9, () => {
          if (!r.ok && r.code === 'retained') {
            this.message({ kind: 'retained', tone: 'err', title: ['บัตรนี้ถูกระงับการใช้งานวันนี้', 'This card is blocked today'], sub: ['กดรหัสผิดเกิน 3 ครั้ง · ใช้ได้อีกครั้งพรุ่งนี้', 'Wrong PIN 3 times · try again tomorrow'] }, 3.5, () => this.endSession());
            return;
          }
          this.go('lang');
        });
      });
    });
  }
  private fdk(side: 'L' | 'R', i: number) {
    if (!this.unit) return;
    const spec = this.spec();
    const o = (side === 'L' ? spec.left : spec.right)?.[i];
    if (o && !o.dim && o.act) { this.idle = 0; o.act(); }
  }

  private keyId(id: string) {
    if (!this.unit || this.leaving) return;
    if (/^\d$/.test(id)) this.digit(id);
    else if (id === 'ENTER') this.enterKey();
    else if (id === 'CLEAR') this.clear();
    else if (id === 'CANCEL') this.cancelKey();
  }

  // ---------------------------------------------------------------- frame (local, only while in focus)
  frame(dt: number) {
    const u = this.unit;
    this.t += dt;
    if (!u) return;
    const game = this.game, cam = game.camera;
    if (this.fpFix > 0 && !this.leaving) { this.fpFix--; const rg = game.player?.rig(); if (rg) { rg.setFirstPerson(true); rg.root.visible = false; } }
    if (!this.leaving) Overlay.crosshair(false);
    this.pollReply();
    if (this.timer && this.t >= this.timer.t && this.timer.st === this.st) { const fn = this.timer.fn; this.timer = null; fn(); }
    // idle timeout in input states
    const inputSt = this.st === 'menu' || this.st === 'wd' || this.st === 'dep' || this.st === 'xfer' || this.st === 'wdOther' || this.st === 'depOther' || this.st === 'xferAmt' || this.st === 'balance' || this.st === 'more' || this.st === 'rcptQ' || this.st === 'pin' || this.st === 'lang' || this.st === 'pinNew' || this.st === 'pinNew2';
    if (inputSt && !this.leaving) {
      this.idle += dt;
      if (this.idle > 35) {
        const back = this.st;
        this.go('timeoutQ');
        this.prevSt = back;
        this.after(15, () => this.endSession());
      }
    }
    // ---- camera ease
    const pose = POSE[this.focus];
    const tp = u.local(pose.cam, _v.set(0, 0, 0)).clone();
    const lk = u.local(pose.look, _v2);
    _m.lookAt(tp, lk, new THREE.Vector3(0, 1, 0));
    const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
    // gentle parallax toward the cursor
    const nx = Input.ndc.x, ny = Input.ndc.y;
    tp.add(new THREE.Vector3(nx * 0.018, ny * 0.012, 0).applyQuaternion(tq));
    if (this.leaving) {
      this.leaving += dt;
      const pl = game.player!;
      const fp = new THREE.Vector3(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
      const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, pl.yaw, 0, 'YXZ'));
      const k = THREE.MathUtils.smootherstep(Math.min(1, this.leaving / 0.55), 0, 1);
      cam.position.lerpVectors(this.camFrom.p, fp, k);
      cam.quaternion.slerpQuaternions(this.camFrom.q, fq, k);
      cam.fov = THREE.MathUtils.lerp(this.camFrom.fov, pl.baseFov, k);
      cam.updateProjectionMatrix();
      u.frame(dt, this.t, this.spec(), cam.position);
      if (this.leaving >= 0.55) this.finishExit();
      return;
    }
    this.camK = Math.min(1, this.camK + dt / 0.75);
    const k = THREE.MathUtils.smootherstep(this.camK, 0, 1);
    const follow = 1 - Math.exp(-dt * 6);
    if (this.camK < 1) {
      this.camCur.p.lerpVectors(this.camFrom.p, tp, k);
      this.camCur.q.slerpQuaternions(this.camFrom.q, tq, k);
      this.camCur.fov = THREE.MathUtils.lerp(this.camFrom.fov, pose.fov, k);
    } else {
      this.camCur.p.lerp(tp, follow);
      this.camCur.q.slerp(tq, follow);
      this.camCur.fov += (pose.fov - this.camCur.fov) * follow;
    }
    cam.position.copy(this.camCur.p);
    cam.quaternion.copy(this.camCur.q);
    if (Math.abs(cam.fov - this.camCur.fov) > 0.01) { cam.fov = this.camCur.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // ---- mouse picking
    this.ray.setFromCamera(new THREE.Vector2(Input.ndc.x, Input.ndc.y), cam);
    const m = u.m;
    const targets: THREE.Object3D[] = [m.keyCaps, m.fdkCaps, m.screen, m.hitCard, m.hitCash, m.hitReceipt];
    if (u.receipt) targets.push(u.receipt);
    const hits = this.ray.intersectObjects(targets, false);
    let sel: AtmUI['hoverSel'] = null;
    u.hoverKey = -1; u.hoverFdk = -1; u.screen.hover = null;
    const h = hits[0];
    if (h && this.camK > 0.6) {
      if (h.object === m.keyCaps && h.instanceId !== undefined) { sel = { kind: 'key', i: h.instanceId }; u.hoverKey = h.instanceId; }
      else if (h.object === m.fdkCaps && h.instanceId !== undefined) {
        sel = { kind: 'fdk', i: h.instanceId }; u.hoverFdk = h.instanceId;
        const side = h.instanceId < 4 ? 'L' : 'R';
        u.screen.hover = { side, i: h.instanceId % 4 };
      } else if (h.object === m.screen && h.uv) {
        const pk = u.screen.pick(h.uv.x * 1024, (1 - h.uv.y) * 768);
        if (pk) { sel = { kind: 'touch', side: pk.side, i: pk.i }; u.screen.hover = pk; }
      } else if (h.object === m.hitCard) sel = { kind: 'card' };
      else if (h.object === m.hitCash) sel = { kind: 'cash' };
      else if (h.object === m.hitReceipt || h.object === u.receipt) sel = { kind: 'receipt' };
    }
    const clickable = !!sel && (sel.kind === 'key' || sel.kind === 'fdk' || sel.kind === 'touch'
      || (sel.kind === 'card' && (this.st === 'attract' || this.st === 'eject'))
      || (sel.kind === 'cash' && (this.st === 'cash' || this.st === 'depInsert'))
      || (sel.kind === 'receipt' && this.st === 'rcptTake'));
    game.engine.canvas.style.cursor = clickable ? 'pointer' : 'default';
    if (Input.mousePressed(0) && sel && this.camK > 0.6) {
      Input.consumeMouse(0);
      this.idle = 0;
      if (sel.kind === 'key') { u.press('key', sel.i!); this.keyId(m.keyIds[sel.i!]); }
      else if (sel.kind === 'fdk') { u.press('fdk', sel.i!); this.fdk(sel.i! < 4 ? 'L' : 'R', sel.i! % 4); }
      else if (sel.kind === 'touch') { u.sfx('beep'); this.fdk(sel.side!, sel.i!); }
      else if (sel.kind === 'card') { if (this.st === 'attract') this.insert(); else if (this.st === 'eject') this.takeCard(); }
      else if (sel.kind === 'cash') { if (this.st === 'cash') this.cancelKeyOrTake(); else if (this.st === 'depInsert') this.insertNotes(); }
      else if (sel.kind === 'receipt' && this.st === 'rcptTake') this.takeReceipt();
    }
    // ---- keyboard
    const pressKey = (id: string) => { const i = m.keyIds.indexOf(id); if (i >= 0) u.press('key', i); this.keyId(id); };
    for (let d = 0; d <= 9; d++) if (Input.wasPressed('Digit' + d) || Input.wasPressed('Numpad' + d)) pressKey(String(d));
    if (Input.wasPressed('Enter') || Input.wasPressed('NumpadEnter')) pressKey('ENTER');
    if (Input.wasPressed('Backspace') || Input.wasPressed('Delete')) pressKey('CLEAR');
    if (Input.wasPressed('Escape')) { Input.consume('Escape'); pressKey('CANCEL'); }
    if (Input.wasPressed('KeyE') && (this.st === 'attract' || this.st === 'thanks')) { Input.consume('KeyE'); this.exit(); }
    u.frame(dt, this.t, this.spec(), cam.position);
  }
  private cancelKeyOrTake() {
    if (this.cashIsReturn) { this.unit!.takeNotes(this.game.camera); this.cashIsReturn = false; Sound.play('banknote', { vol: 0.6 }); this.go('more'); return; }
    this.takeCash();
  }
}

/** largest amount payable with 20/50/100 notes that does not exceed the wallet */
export function depositable(wallet: number) {
  // 20/50/100 notes make any multiple of 10 from 20 up, except 30
  const w = Math.floor(Math.max(0, wallet) / 10) * 10;
  if (w < 20) return 0;
  return w === 30 ? 20 : w;
}
