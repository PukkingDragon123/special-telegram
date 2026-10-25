import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { Ease, clamp, damp } from '../../core/util';
import { Overlay } from '../../ui3d/overlay';
import { text3d, Text3D } from '../../ui3d/text3d';
import { HeavenEnv } from './heavenenv';
import { SkillProps, PropInfo, PropNode, clusterCentre } from './heavenprops';
import { Branch, skillState } from './skills';
import { buildMoney } from './money';
import { Sparkles } from './fx';
import { lines } from './lines';

/* ============================================================================================
 * SKILL HEAVEN — a separate THREE.Scene shown as an overlay view while the street world stays
 * loaded and simulated underneath (engine.setView swaps what is rendered; nothing is rebuilt).
 * You stand on a little cloud island far above the street, look around with the mouse, aim at a
 * floating skill prop and click to learn it. Skill points float in front of you as real 10 ฿ coins.
 *   arrive(): fall in from the white light, camera settles from looking up
 *   leave():  look down and drop through the cloud sea into white → back to the body
 * ========================================================================================== */

/** heaven sits this far above the street so positional world sounds fade out */
export const HEAVEN_Y = 2600;
const EYE = 1.62;
const inCubic = (t: number) => t * t * t;

const HEAVEN_LOOK = { lift: [0.008, 0.004, 0.014] as [number, number, number], gamma: [1.0, 0.99, 1.02] as [number, number, number], gain: [1.06, 1.0, 0.98] as [number, number, number], saturation: 1.22, contrast: 1.08, tint: [1.02, 0.99, 1.0] as [number, number, number] };
export { HEAVEN_LOOK };

// ------------------------------------------------------------------ white veil in front of a camera

export class Veil {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(4), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 3000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  attach(cam: THREE.PerspectiveCamera) {
    if (this.mesh.parent !== cam) cam.add(this.mesh);
    const d = Math.max(cam.near * 1.5, 0.07);
    const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(Math.max(cam.fov, 90)) / 2) * 1.6;
    this.mesh.position.set(0, 0, -d);
    this.mesh.scale.set(h * 2.2, h, 1);
  }
  set k(v: number) { this.mat.opacity = clamp(v); this.mesh.visible = v > 0.002; }
  get k() { return this.mat.opacity; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------ skill points: real coins floating in front of you

class PointsHud {
  readonly group = new THREE.Group();
  private coins: THREE.Object3D[] = [];
  private text: Text3D;
  private key = '';
  private t = 0;
  shown = 0;
  constructor() {
    this.group.position.set(0, -0.3, -0.9);
    for (let i = 0; i < 8; i++) {
      const c = buildMoney(10);
      c.scale.setScalar(2.1);
      c.visible = false;
      c.traverse((o: any) => {
        if (!o.isMesh) return;
        o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m: any) => {
          const k = m.clone();
          if (k.metalness !== undefined) { k.metalness = 0.55; k.roughness = Math.max(0.3, k.roughness ?? 0.4); }
          if (k.emissive && k.map) { k.emissive.setScalar(0.35); k.emissiveMap = k.map; }
          return k;
        });
        if (o.material.length === 1) o.material = o.material[0];
      });
      this.group.add(c);
      this.coins.push(c);
    }
    this.text = text3d('', { font: 'ui', size: 0.022, color: 0xfff0cc, side: 0x5a3414, emissive: 0.4, align: 'center', valign: 'top', castShadow: false, rim: 0xffd890, rimStrength: 0.4 });
    this.text.position.set(0, -0.045, 0);
    this.group.add(this.text);
  }
  set(sp: number) {
    const key = String(sp);
    if (key === this.key) return;
    const first = !this.key;
    this.key = key;
    this.text.setText(sp > 0 ? `แต้มสกิล ${sp} แต้ม · skill points` : 'แต้มหมด… ไปผัดกะเพราก่อน! · no points');
    if (!first) this.text.popIn(0.015);
    this.shown = Math.min(8, sp);
  }
  /** world position of coin i (the one that flies away when you learn) */
  coinWorld(i: number, out: THREE.Vector3) { return this.coins[clamp(i, 0, 7)].getWorldPosition(out); }
  update(dt: number) {
    this.t += dt;
    const n = this.shown;
    this.coins.forEach((c, i) => {
      const want = i < n;
      const s = c.scale.x;
      const target = want ? 2.1 : 0.001;
      c.scale.setScalar(s + (target - s) * damp(10, dt));
      c.visible = c.scale.x > 0.01;
      c.position.set((i - (n - 1) / 2) * 0.058, Math.sin(this.t * 2 + i * 0.8) * 0.006, 0);
      c.rotation.set(Math.PI / 2 - 0.35, 0, this.t * 1.4 + i * 0.6);
    });
  }
  dispose() { this.text.dispose(); this.group.removeFromParent(); }
}

// ------------------------------------------------------------------ the heaven

interface Flyer { o: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done: () => void }
interface Thought { t: Text3D; life: number; v: THREE.Vector3 }

export class SkillHeaven {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 2600);
  readonly root = new THREE.Group();
  readonly env: HeavenEnv;
  readonly props: SkillProps;
  readonly info = new PropInfo();
  readonly sparks = new Sparkles();
  readonly veil = new Veil();
  private hud = new PointsHud();
  private welcome: Text3D[] = [];
  private flyers: Flyer[] = [];
  private thoughts: Thought[] = [];
  private nextThought = 7;
  private thoughtIdx = Math.floor(Math.random() * 50);
  /** heaven-local camera position */
  readonly camLocal = new THREE.Vector3(0, EYE, 0);
  private camRight = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private curYaw = 0;
  private curPitch = 0;
  phase: 'off' | 'arrive' | 'idle' | 'leave' = 'off';
  private t = 0;
  private leaveDur = 1;
  private fast = false;
  private flash: { text: string; t: number } | null = null;
  private hoverCool = 0;
  private ray = new THREE.Raycaster();
  private _v = new THREE.Vector3();
  private _ndc = new THREE.Vector2();
  /** bloom kick (0..1) read by the controller after a learn */
  kick = 0;

  constructor(private game: Game, private me: Ent) {
    this.scene.name = 'skill-heaven';
    this.root.position.set(0, HEAVEN_Y, 0);
    this.scene.add(this.root);
    this.root.add(this.camera);
    const spots = (['cook', 'prep', 'serve', 'clean', 'life'] as Branch[]).map((b) => clusterCentre(b));
    this.env = new HeavenEnv(spots);
    this.root.add(this.env.group);
    this.props = new SkillProps(game, me);
    this.root.add(this.props.group);
    this.root.add(this.info.group);
    this.sparks.points.renderOrder = 22;
    this.root.add(this.sparks.points);
    this.camera.add(this.hud.group);
    this.veil.attach(this.camera);
  }

  private prep: Promise<void> | null = null;
  prepare() { return (this.prep ??= this.env.loadEnvironment(this.game.engine.renderer, this.scene)); }

  /** called when the view switches to heaven (the veil is white) */
  arrive() {
    this.phase = 'arrive';
    this.t = 0;
    this.yaw = 0; this.pitch = 0; this.lookYaw = 0; this.lookPitch = 0; this.curYaw = 0; this.curPitch = 1.05;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.fov = 82;
    this.camera.updateProjectionMatrix();
    this.veil.attach(this.camera);
    this.veil.k = 1;
    this.props.hovered = null;
    this.props.refresh(true);
    this.props.arrive(0.35);
    const me = this.game.state.get(this.me.id) ?? this.me;
    this.hud.set(me.sp ?? 0);
    this.info.show(null, me, null);
    for (const w of this.welcome) w.dispose();
    const a = text3d('สวรรค์สกิล', { font: 'display', size: 0.42, color: 0xfff0c8, side: 0x8a5420, emissive: 0.4, rim: 0xffd27a, rimStrength: 0.8, align: 'center', valign: 'bottom', castShadow: false, anim: { pop: 0.5, rise: 0.8, spin: 1.2 } });
    const b = text3d('เล็งแล้วคลิกเพื่อเรียนสกิล · Tab กลับลงไป', { font: 'ui', size: 0.1, color: 0xfff6e6, side: 0x6a4024, emissive: 0.35, align: 'center', valign: 'top', castShadow: false });
    const c = text3d('SKILL HEAVEN — aim & click to learn · Tab to go back', { font: 'ui', size: 0.065, color: 0xf0e4ff, side: 0x4a3a5a, emissive: 0.3, align: 'center', valign: 'top', castShadow: false });
    a.position.set(0, 4.15, -7.5); b.position.set(0, 4.02, -7.5); c.position.set(0, 3.84, -7.5);
    for (const t of [a, b, c]) { t.reveal = 0; this.root.add(t); }
    this.welcome = [a, b, c];
    Sound.play('social_heaven_arrive', { vol: 0.8 });
    Sound.play('social_heaven_choir', { vol: 0.45, delay: 0.4 });
  }

  /** start dropping back down; returns seconds until the view should switch back to the world */
  leave(fast = false) {
    if (this.phase === 'leave') return Math.max(0, this.leaveDur - this.t);
    this.phase = 'leave';
    this.fast = fast;
    this.t = 0;
    this.leaveDur = fast ? 0.55 : 1.05;
    this.props.hovered = null;
    this.info.show(null, this.me, null);
    Overlay.crosshair(false);
    Sound.play('slide_whistle_down', { vol: fast ? 0.35 : 0.55, pitch: fast ? 1.4 : 1.0 });
    Sound.play('slowmo_whoosh', { vol: 0.4, pitch: 1.6 });
    return this.leaveDur;
  }
  get leaving() { return this.phase === 'leave'; }
  get done() { return this.phase === 'leave' && this.t >= this.leaveDur; }

  /** point the view at a skill prop (QA / screenshots) */
  lookAtSkill(id: string) {
    const n = this.props.nodes.find((x) => x.s.id === id);
    if (!n) return false;
    const d = this._v.copy(n.base).sub(this.camLocal);
    this.lookYaw = Math.atan2(-d.x, -d.z) - this.yaw;
    this.lookPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - this.basePitch();
    return true;
  }
  private basePitch() { return this.phase === 'arrive' ? THREE.MathUtils.lerp(1.05, 0.06, Ease.inOutCubic(clamp(this.t / 2.0))) : 0.06; }

  onUnlocked(skill: string) {
    const n = this.props.nodes.find((x) => x.s.id === skill);
    if (!n) return;
    this.props.celebrate(n);
    this.kick = 1;
    Sound.play('social_heaven_learn', { vol: 0.9 });
    Sound.play('sparkle_chime', { vol: 0.6, delay: 0.15 });
    this.sparks.burst(n.cur, 90, { color: 0xffe08a, color2: 0xffffff, speed: 1.8, size: 0.06, life: 1.3, up: 0.6 });
    this.sparks.burst(n.cur, 40, { color: 0xffffff, color2: 0xfff2d0, speed: 3.2, size: 0.04, life: 0.6, up: 0.2 });
    // the spent coins fly from your floating purse into the prop
    for (let i = 0; i < n.s.cost; i++) {
      const from = this.hud.coinWorld(this.hud.shown - 1 - i, new THREE.Vector3());
      this.root.worldToLocal(from);
      const o = buildMoney(10);
      o.scale.setScalar(2.4);
      o.position.copy(from);
      this.root.add(o);
      this.flyers.push({ o, from, to: n.cur.clone(), t: -i * 0.12, dur: 0.55, done: () => this.sparks.burst(n.cur, 14, { color: 0xffd36a, color2: 0xffffff, speed: 1.2, size: 0.045, life: 0.6 }) });
    }
  }

  private tryLearn(n: PropNode) {
    const me = this.game.state.get(this.me.id) ?? this.me;
    const st = skillState(me, n.s);
    if (st.st === 'ready') { this.game.intent('skill.unlock', { id: n.s.id }); return; }
    if (st.st === 'owned') { n.bounce = 0.6; Sound.play('bubble_pop', { vol: 0.4, pitch: 0.9 }); this.sparks.burst(n.cur, 12, { color: 0xffe9a8, speed: 0.8, size: 0.04, life: 0.6 }); return; }
    this.props.refuse(n);
    Sound.play('bubble_pop', { vol: 0.45, pitch: 0.55 });
    Sound.play('wrong_buzz', { vol: 0.16, pitch: 0.75 });
    this.flash = { text: st.why?.th ?? 'ยังไม่ได้', t: this.t };
  }

  /** per frame while heaven is the active view */
  update(dt: number, allowInput: boolean) {
    this.t += dt;
    const t = this.t;
    const me = this.game.state.get(this.me.id) ?? this.me;
    // ---- camera
    let basePitch = 0.06, y = EYE, fov = 66;
    if (this.phase === 'arrive') {
      const k = clamp(t / 2.0);
      basePitch = THREE.MathUtils.lerp(1.05, 0.06, Ease.inOutCubic(k));
      y = EYE + 5.5 * Math.pow(1 - clamp(t / 1.8), 3);
      fov = THREE.MathUtils.lerp(82, 66, Ease.outCubic(clamp(t / 1.6)));
      this.veil.k = 1 - Ease.inOutCubic(clamp(t / 1.0));
      if (t >= 2.0) this.phase = 'idle';
    } else if (this.phase === 'leave') {
      const k = clamp(t / this.leaveDur);
      basePitch = THREE.MathUtils.lerp(0.06, -1.32, Ease.inOutCubic(clamp(k * 1.5)));
      this.lookPitch *= 1 - inCubic(k);
      y = EYE - 13 * k * k;
      fov = THREE.MathUtils.lerp(66, 88, inCubic(k));
      this.veil.k = clamp((k - 0.4) / 0.55);
    }
    // ---- look input
    const locked = Input.locked;
    if (allowInput && this.phase !== 'leave') {
      if (locked) {
        const s = Input.sensitivity;
        this.lookYaw -= Input.mouseDX * s;
        this.lookPitch -= Input.mouseDY * s * (Input.invertY ? -1 : 1);
      } else {
        const nx = Input.ndc.x, ny = Input.ndc.y;
        const ex = Math.abs(nx) > 0.78 ? Math.sign(nx) * (Math.abs(nx) - 0.78) / 0.22 : 0;
        this.lookYaw -= ex * 1.5 * dt;
      }
    }
    this.lookPitch = clamp(this.lookPitch, -1.25 - basePitch, 1.2 - basePitch);
    let wantYaw = this.yaw + this.lookYaw, wantPitch = basePitch + this.lookPitch;
    if (!locked && allowInput && this.phase !== 'leave') { wantYaw += -Input.ndc.x * 0.35; wantPitch += Input.ndc.y * 0.22; }
    this.curYaw += (wantYaw - this.curYaw) * damp(locked ? 30 : 6, dt);
    this.curPitch += (wantPitch - this.curPitch) * damp(locked ? 30 : 6, dt);
    const sway = this.phase === 'leave' ? 0 : 1;
    this.camLocal.set(Math.sin(t * 0.31) * 0.05 * sway, y + Math.sin(t * 0.47) * 0.04 * sway, Math.cos(t * 0.23) * 0.04 * sway);
    this.camera.position.copy(this.camLocal);
    this.camera.rotation.set(this.curPitch + Math.sin(t * 0.37) * 0.008 * sway, this.curYaw + Math.sin(t * 0.29) * 0.01 * sway, Math.sin(t * 0.21) * 0.014 * sway, 'YXZ');
    if (Math.abs(this.camera.fov - fov) > 0.02) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (Math.abs(this.camera.aspect - innerWidth / innerHeight) > 0.001) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
    this.camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    // ---- aim + click
    let hovered: PropNode | null = null;
    if (allowInput && this.phase !== 'leave' && t > 0.9) {
      this._ndc.set(locked ? 0 : Input.ndc.x, locked ? 0 : Input.ndc.y);
      this.ray.setFromCamera(this._ndc, this.camera);
      this.ray.ray.origin.sub(this.root.position);
      hovered = this.props.pick(this.ray.ray);
      if (hovered !== this.props.hovered) {
        this.hoverCool -= dt;
        if (hovered) Sound.play('bubble_pop', { vol: 0.28, pitch: 1.5 + Math.random() * 0.3 });
        if (this.flash && hovered) this.flash = null;
      }
      this.props.hovered = hovered;
      if (Input.mousePressed(0)) {
        Input.consumeMouse(0);
        if (hovered) this.tryLearn(hovered);
      }
      Overlay.crosshair(locked, !!hovered);
    }
    if (this.flash && t - this.flash.t > 1.8) this.flash = null;
    this.info.show(this.props.hovered, me, this.flash?.text ?? null);
    this.info.update(dt, this.props.hovered, this.camLocal, this.camRight);
    // ---- world
    this.props.refresh();
    this.props.update(dt, this.camLocal, this.camera.quaternion, (p, n, o) => this.sparks.burst(p, n, o));
    this.env.update(dt, this.camLocal);
    this.sparks.update(dt);
    this.hud.set(me.sp ?? 0);
    this.hud.update(dt);
    this.hud.group.visible = this.phase !== 'leave';
    this.kick = Math.max(0, this.kick - dt * 1.6);
    // welcome title: pop in, float, vanish
    if (this.welcome.length) {
      const [a, b, c] = this.welcome;
      if (t > 0.6 && a.reveal === 0 && a.isReady) { a.popIn(0.06); b.popIn(0.012); c.popIn(0.008); }
      for (const w of this.welcome) w.position.y += Math.sin(t * 1.1) * 0.0008;
      if (t > 6.5 && !(a as any)._gone) { (a as any)._gone = true; for (const w of this.welcome) w.vanish(0.02); }
      if (t > 8.5) { for (const w of this.welcome) w.dispose(); this.welcome = []; }
    }
    // funny thoughts drifting past
    this.nextThought -= dt;
    if (this.nextThought <= 0 && this.phase === 'idle') {
      this.nextThought = 9 + Math.random() * 5;
      const ths = lines('skill_tree_thoughts');
      const th = ths[this.thoughtIdx++ % ths.length];
      const tt = text3d(th.th, { font: 'hand', size: 0.24, color: 0xfff8ff, side: 0xb07aa8, emissive: 0.35, align: 'center', castShadow: false, anim: { wobble: 0.06 } });
      const a = this.curYaw + (Math.random() - 0.5) * 1.6;
      tt.position.set(-Math.sin(a) * 8, 2.6 + Math.random() * 1.5, -Math.cos(a) * 8);
      tt.rotation.set(0, a, 0);
      tt.popIn(0.05);
      this.root.add(tt);
      this.thoughts.push({ t: tt, life: 7, v: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.12, 0) });
    }
    for (let i = this.thoughts.length - 1; i >= 0; i--) {
      const th = this.thoughts[i];
      th.life -= dt;
      th.t.position.addScaledVector(th.v, dt);
      if (th.life < 1.2 && !(th.t as any)._gone) { (th.t as any)._gone = true; th.t.vanish(0.03); }
      if (th.life <= 0) { th.t.dispose(); this.thoughts.splice(i, 1); }
    }
    // flying coins
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt;
      const k = clamp(f.t / f.dur);
      if (f.t < 0) continue;
      f.o.position.lerpVectors(f.from, f.to, inCubic(k));
      f.o.position.y += Math.sin(k * Math.PI) * 0.6;
      f.o.rotation.set(f.t * 9, f.t * 7, 0);
      if (k >= 1) { f.done(); f.o.removeFromParent(); this.flyers.splice(i, 1); }
    }
  }

  dispose() {
    this.props.dispose();
    this.info.dispose();
    this.env.dispose();
    this.hud.dispose();
    this.veil.dispose();
    for (const w of this.welcome) w.dispose();
    for (const th of this.thoughts) th.t.dispose();
    for (const f of this.flyers) f.o.removeFromParent();
    this.welcome = []; this.thoughts = []; this.flyers = [];
    this.scene.clear();
  }
}
