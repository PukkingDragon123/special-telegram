import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';
import { tl, type TL } from '../../core/util';
import { text3d, type Text3D } from '../../ui3d/text3d';

/* ============================================================================================
 * ritual — client-side cinematic FX (every peer, local):
 *  - exposure flicker (power dips) + lightning strobes (multiplies the grade's exposure each frame)
 *  - camera shake, fainting (fade to black + wake up)
 *  - ghostly 3D review stars, ghostly floating 3D words
 *  - the group SELFIE: local camera shot from the ghost's phone, countdown, flash, the real frame
 *    captured into a polaroid that floats in front of you (kept for the newspaper: (game as any).ritual.selfie)
 *  - a readable paper page in front of the camera (the flyer, the pocket manual)
 *  - a mosquito swarm
 * ========================================================================================== */

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export function play(key: string, o: any = {}) { for (const k of key.split('|')) if (Sound.has(k)) return Sound.play(k, o); return null; }

/** forward of an entity / player yaw (they face (-sin, 0, -cos)) */
export const fwdOf = (yaw: number, out = new THREE.Vector3()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
export const rightOf = (yaw: number, out = new THREE.Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

interface Floating { obj: THREE.Object3D; t: number; dur: number; texts: Text3D[]; update?: (k: number, dt: number) => void; meshes?: THREE.Mesh[] }

export class RitualFx {
  readonly root = new THREE.Group();
  private flick = 0;          // 0..1 flicker strength
  private flash = 0;          // lightning strobe
  private shakeK = 0;
  private faintT = -1;
  private lastWritten = -1; private lastBase = 1;
  private items: Floating[] = [];
  private paperObj: THREE.Mesh | null = null;
  private paperT = 0;
  private selfieRun: { t: number; done: boolean; ghost: number; restore: boolean; polaroid: THREE.Mesh | null; captured: boolean; text: Text3D | null; cdStep: number } | null = null;
  private swarm: { mesh: THREE.InstancedMesh; t: number; dur: number; center: THREE.Vector3; seeds: Float32Array; buzz: any } | null = null;
  private t = 0;
  selfie: HTMLCanvasElement | null = null;

  constructor(private game: Game) {
    this.root.name = 'ritual-fx';
  }

  attach(scene: THREE.Object3D) { scene.add(this.root); }

  // ------------------------------------------------------------------ atmosphere

  setFlicker(k: number) { this.flick = Math.max(0, Math.min(1, k)); }
  lightning(power = 1) {
    this.flash = Math.max(this.flash, power);
    const d = 250 + Math.random() * 500;
    setTimeout(() => play('thunder', { vol: 0.9 }), d);
  }
  shake(k = 0.5) { this.shakeK = Math.max(this.shakeK, k); }
  faint() { this.faintT = 0; this.shake(0.4); }

  /** called in engine.onLate (after the world wrote this frame's exposure) */
  late(dt: number) {
    this.t += dt;
    const post = this.game.engine.post;
    // exposure: base from whoever set it this frame, times our flicker / flash
    const cur = post.exposure;
    const base = Math.abs(cur - this.lastWritten) < 1e-6 ? this.lastBase : cur;
    let mul = 1;
    if (this.flick > 0) {
      const n = Math.sin(this.t * 41) * Math.sin(this.t * 13.7) + Math.sin(this.t * 87) * 0.5;
      mul *= n > 0.95 ? 0.25 : n > 0.6 ? 0.6 : 1 - this.flick * 0.15;
      mul = 1 + (mul - 1) * this.flick;
    }
    if (this.flash > 0.01) {
      const strobe = Math.sin(this.flash * 40) > -0.2 ? 1 : 0.2;
      mul *= 1 + this.flash * 7 * strobe;
      this.flash = Math.max(0, this.flash - dt * 2.8);
    }
    if (mul !== 1 || this.lastWritten >= 0) {
      const v = base * mul;
      post.exposure = v;
      this.lastWritten = v; this.lastBase = base;
      if (mul === 1) this.lastWritten = -1;
    }
    // faint: fade to black for 2 s, wobble back
    if (this.faintT >= 0) {
      this.faintT += dt;
      const k = this.faintT < 0.4 ? this.faintT / 0.4 : this.faintT < 2.0 ? 1 : Math.max(0, 1 - (this.faintT - 2.0) / 0.8);
      post.fade = Math.max(post.fade, k * 0.97);
      if (this.faintT > 2.8) { this.faintT = -1; post.fade = 0; }
    }
    // camera shake (+ selfie camera)
    const cam = this.game.camera;
    if (this.shakeK > 0 && cam) {
      cam.rotation.x += (Math.random() - 0.5) * 0.05 * this.shakeK;
      cam.rotation.y += (Math.random() - 0.5) * 0.05 * this.shakeK;
      this.shakeK = Math.max(0, this.shakeK - dt * 0.8);
    }
    this.selfieLate(dt);
    this.paperLate(dt);
  }

  // ------------------------------------------------------------------ floating ghostly 3D words / stars

  /** ghostly 3D words floating at a point (e.g. the voice from the dark) */
  words(at: THREE.Vector3, text: TL, dur = 4, color = '#d8ecff', size = 0.16) {
    const g = new THREE.Group();
    const a = text3d(text.th, { font: 'hand', size, depth: 0.14, color, side: '#3a4a6a', emissive: 0.9, opacity: 0.9, rim: '#cfe6ff', rimStrength: 0.7, castShadow: false, keyLight: 0.2, maxWidth: 2.4 });
    g.add(a);
    const texts = [a];
    if (text.en) { const b = text3d(text.en, { font: 'ui', size: size * 0.45, depth: 0.1, color: '#c8d8f0', emissive: 0.7, opacity: 0.85, castShadow: false, keyLight: 0.2, maxWidth: 2.4 }); b.position.y = -size * 1.1; g.add(b); texts.push(b); }
    g.position.copy(at);
    this.root.add(g);
    this.items.push({ obj: g, t: 0, dur, texts, update: (k) => { g.position.y = at.y + k * 0.25; const cp = this.game.camera.getWorldPosition(_v); g.rotation.y = Math.atan2(cp.x - g.position.x, cp.z - g.position.z); } });
  }

  /** the ghost's review: `n` gold stars pop in one by one in an arc above her head (+ empty ghost outlines) */
  stars(at: () => THREE.Vector3 | null, n: number) {
    const g = new THREE.Group();
    const geo = starGeo();
    const gold = new THREE.MeshStandardMaterial({ color: '#ffd76a', emissive: '#ffb21a', emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.25, transparent: true, opacity: 0.95 });
    const ghost = new THREE.MeshStandardMaterial({ color: '#9ab0c8', emissive: '#6a88aa', emissiveIntensity: 0.4, transparent: true, opacity: 0.22, roughness: 0.6, depthWrite: false });
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo, i < n ? gold : ghost);
      const a = (i - 2) * 0.32;
      m.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.28 - 0.12, 0);
      m.scale.setScalar(0.001);
      g.add(m); meshes.push(m);
    }
    this.root.add(g);
    let shown = 0;
    this.items.push({
      obj: g, t: 0, dur: 9, texts: [], meshes,
      update: (_k, dt) => {
        const p = at(); if (p) g.position.copy(p).add(new THREE.Vector3(0, 0.32, 0));
        const cp = this.game.camera.getWorldPosition(_v); g.rotation.y = Math.atan2(cp.x - g.position.x, cp.z - g.position.z);
        const it = this.items.find((x) => x.obj === g)!;
        const want = Math.min(5, Math.floor(it.t / 0.55));
        while (shown < want) { if (shown < n) { play('sparkle_chime|ding_correct', { vol: 0.7, pitch: 0.9 + shown * 0.08 }); } shown++; }
        meshes.forEach((m, i) => {
          const age = it.t - i * 0.55;
          const s = age <= 0 ? 0.001 : age < 0.25 ? (age / 0.25) * 1.35 : 1 + Math.max(0, 0.35 - (age - 0.25) * 1.4);
          m.scale.setScalar(Math.max(0.001, s * 0.12));
          m.rotation.y += dt * (i < n ? 2.4 : 0.6);
        });
      },
    });
  }

  // ------------------------------------------------------------------ mosquitoes

  mosquitoes(center: THREE.Vector3, dur = 8) {
    this.swarm?.mesh.removeFromParent();
    const N = 140;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.0045, 0), new THREE.MeshBasicMaterial({ color: '#141210' }), N);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.swarm = { mesh, t: 0, dur, center: center.clone(), seeds, buzz: play('shop_fly_buzz', { vol: 0.9, pitch: 1.9, loop: true }) };
  }
  private swarmFrame(dt: number) {
    const s = this.swarm;
    if (!s) return;
    s.t += dt;
    const m = new THREE.Matrix4();
    // a buzzing cloud right around your face (they always find you)
    const cam = this.game.camera;
    const c = cam.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.1, -0.75).applyQuaternion(cam.getWorldQuaternion(_q)));
    for (let i = 0; i < s.mesh.count; i++) {
      const a = s.seeds[i * 4] * 6.28 + s.t * (2 + s.seeds[i * 4 + 1] * 4), r = 0.15 + s.seeds[i * 4 + 2] * 0.85;
      m.makeTranslation(c.x + Math.cos(a) * r, c.y + Math.sin(s.t * 3 + i) * 0.18 + (s.seeds[i * 4 + 3] - 0.5) * 0.7, c.z + Math.sin(a * 1.3) * r);
      s.mesh.setMatrixAt(i, m);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
    if (s.t > s.dur) { s.mesh.removeFromParent(); s.mesh.geometry.dispose(); s.buzz?.stop?.(0.4); this.swarm = null; }
  }

  // ------------------------------------------------------------------ reading a paper (flyer / manual)

  get reading() { return !!this.paperObj; }
  paper(pages: string[][], page = 0) {
    this.closePaper();
    const lines = pages[Math.min(page, pages.length - 1)];
    const cv = document.createElement('canvas'); cv.width = 700; cv.height = 900;
    const draw = () => {
      const c = cv.getContext('2d')!;
      c.fillStyle = '#efe2c0'; c.fillRect(0, 0, 700, 900);
      for (let i = 0; i < 1600; i++) { c.fillStyle = `rgba(110,80,40,${Math.random() * 0.05})`; c.fillRect(Math.random() * 700, Math.random() * 900, 2, 1); }
      c.strokeStyle = 'rgba(120,40,30,0.5)'; c.lineWidth = 3; c.strokeRect(24, 24, 652, 852);
      c.fillStyle = '#2a1a14'; c.textAlign = 'center';
      lines.forEach((ln, i) => { c.font = `${i === 0 ? 700 : 500} ${i === 0 ? 44 : 30}px ${F.hand}`; c.fillText(ln, 350, 90 + i * 60); });
      c.font = `500 22px ${F.ui}`; c.fillStyle = '#6a4a3a';
      c.fillText(pages.length > 1 ? `หน้า ${page + 1}/${pages.length} · E พลิกหน้า / ปิด` : 'E ปิด', 350, 860);
    };
    draw();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    (document as any).fonts?.ready?.then(() => { draw(); tex.needsUpdate = true; });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthTest: false }));
    m.renderOrder = 999;
    m.userData.pages = pages; m.userData.page = page;
    this.root.add(m);
    this.paperObj = m;
    this.paperT = 0;
    play('paper_rustle', { vol: 0.6 });
  }
  /** E while reading: next page or close */
  flip() {
    const m = this.paperObj; if (!m) return;
    const pages = m.userData.pages as string[][], page = m.userData.page as number;
    if (page + 1 < pages.length) this.paper(pages, page + 1); else this.closePaper();
  }
  closePaper() { if (this.paperObj) { this.paperObj.removeFromParent(); (this.paperObj.material as THREE.MeshBasicMaterial).map?.dispose(); this.paperObj = null; } }
  private paperLate(dt: number) {
    const m = this.paperObj; if (!m) return;
    this.paperT += dt;
    if (this.paperT > 25) { this.closePaper(); return; }
    const cam = this.game.camera;
    cam.getWorldPosition(m.position);
    cam.getWorldQuaternion(m.quaternion);
    m.position.add(_v.set(0, -0.02, -0.42).applyQuaternion(m.quaternion));
    m.rotateX(-0.08);
  }

  // ------------------------------------------------------------------ the selfie

  /** local selfie with ghost entity `gid`: gather beside her, phone-camera shot, countdown, flash, polaroid */
  startSelfie(gid: number) {
    if (this.selfieRun) return;
    const game = this.game;
    const g = game.state.get(gid);
    const me = game.me;
    if (!g?.p || !me?.p) return;
    const near = Math.hypot(me.p[0] - g.p[0], me.p[2] - g.p[2]) < 30;
    if (!near) return;
    // stand beside her, facing the phone (slot by player slot: left, right, back-left, back-right)
    const yaw = g.yaw ?? 0;
    const f = fwdOf(yaw), r = rightOf(yaw);
    const slot = (me.slot ?? 0) % 4;
    const side = slot % 2 ? 1 : -1, back = slot >= 2 ? 0.45 : 0.12;
    const p = new THREE.Vector3(g.p[0], g.p[1], g.p[2]).addScaledVector(r, side * (0.55 + (slot >= 2 ? 0.25 : 0))).addScaledVector(f, -back);
    p.y = game.world?.groundY(p.x, p.z) ?? p.y;
    game.player?.teleport([p.x, p.y, p.z], yaw);
    game.player?.setMode('external');
    this.selfieRun = { t: 0, done: false, ghost: gid, restore: true, polaroid: null, captured: false, text: null, cdStep: -1 };
  }
  private selfieLate(dt: number) {
    const S = this.selfieRun;
    if (!S) return;
    S.t += dt;
    const game = this.game;
    const g = game.state.get(S.ghost);
    const cam = game.camera;
    if (g?.p && S.t < 5.2) {
      // her phone at arm's length, up high, looking back at her + the gang (classic selfie angle)
      const yaw = g.yaw ?? 0;
      const f = fwdOf(yaw);
      const head = new THREE.Vector3(g.p[0], g.p[1] + 1.55, g.p[2]);
      cam.position.copy(head).addScaledVector(f, 1.35).add(_v.set(0, 0.32, 0)).addScaledVector(rightOf(yaw), 0.18);
      cam.lookAt(head.x, head.y - 0.12, head.z);
      cam.rotation.z += Math.sin(S.t * 1.7) * 0.01 + 0.06;   // the selfie tilt
      // countdown 3 · 2 · 1 · ชีส!
      const step = Math.floor(S.t - 0.6);
      if (step !== S.cdStep && step >= 0 && step <= 3) {
        S.cdStep = step;
        S.text?.removeFromParent(); S.text?.dispose();
        const word = ['3', '2', '1', 'ชีส~!'][step];
        S.text = text3d(word, { font: 'heavy', size: step === 3 ? 0.07 : 0.11, depth: 0.3, color: step === 3 ? '#ffe27a' : '#ffffff', side: '#5a2a10', emissive: 0.5, castShadow: false, keyLight: 0.7, xray: true });
        this.root.add(S.text);
        play(step === 3 ? 'camera_shutter' : 'timer_ding|bubble_pop', { vol: 0.7 });
      }
      if (S.text) { S.text.position.copy(cam.position).add(_v.set(0, -0.06, -0.55).applyQuaternion(cam.getWorldQuaternion(_q))); S.text.quaternion.copy(cam.quaternion); }
      if (S.t > 3.6 && !S.captured) {
        S.captured = true;
        this.flash = Math.max(this.flash, 0.9);
        S.text?.removeFromParent(); S.text?.dispose(); S.text = null;
        this.captureFrame();
      }
    }
    if (S.t >= 5.2 && S.restore) {
      S.restore = false;
      game.player?.setMode('play');
      if (this.selfie) this.showPolaroid(S);
    }
    if (S.polaroid) {
      const pol = S.polaroid;
      cam.getWorldPosition(pol.position);
      cam.getWorldQuaternion(pol.quaternion);
      const k = Math.min(1, (S.t - 5.2) / 0.6);
      const out = Math.max(0, S.t - 10.5);
      pol.position.add(_v.set(0.05 + out * 0.8, -0.02 - (1 - k) * 0.3 + out * 0.3, -0.5).applyQuaternion(pol.quaternion));
      pol.rotateZ(0.08 - out * 0.6);
      if (S.t > 11.5) { pol.removeFromParent(); S.polaroid = null; }
    }
    if (S.t > 12) { S.text?.removeFromParent(); this.selfieRun = null; }
  }
  /** grab the next rendered frame (post-processed) right after the engine draws it */
  private captureFrame() {
    const post = this.game.engine.post as any;
    const orig = post.render;
    const canvas = this.game.engine.renderer.domElement;
    post.render = (dt: number) => {
      orig.call(post, dt);
      post.render = orig;
      try {
        const out = document.createElement('canvas'); out.width = 560; out.height = 680;
        const c = out.getContext('2d')!;
        c.fillStyle = '#fbfaf6'; c.fillRect(0, 0, 560, 680);
        const sw = canvas.width, sh = canvas.height, side = Math.min(sw, sh * 1.0);
        c.drawImage(canvas, (sw - side) / 2, (sh - side) / 2, side, side, 30, 30, 500, 500);
        // slightly washed polaroid look
        c.fillStyle = 'rgba(255,240,220,0.08)'; c.fillRect(30, 30, 500, 500);
        c.fillStyle = '#2a2230'; c.textAlign = 'center';
        c.font = `600 34px ${F.hand}`; c.fillText('ผีนางรีวิว x ทีมเฮียผัด (^_^)v', 280, 590);
        c.font = `500 22px ${F.hand}`; c.fillText(`ไลฟ์สด · คืนวันที่ ${this.game.g.day ?? 1} · ${'%'}`.replace('%', 'ผู้ชม 3 คน'), 280, 630);
        this.selfie = out;
        (this.game as any).ritual = { ...((this.game as any).ritual ?? {}), selfie: out };
      } catch (e) { console.warn('[ritual] selfie capture', e); }
    };
  }
  private showPolaroid(S: NonNullable<RitualFx['selfieRun']>) {
    const tex = new THREE.CanvasTexture(this.selfie!); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.2186), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthTest: false }));
    m.renderOrder = 998;
    this.root.add(m);
    S.polaroid = m;
    play('camera_shutter', { vol: 0.4, pitch: 0.8 });
  }
  get inSelfie() { return !!this.selfieRun?.restore; }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.update?.(k, dt);
      if (it.t > it.dur) {
        for (const tx of it.texts) { if (tx.vanish) tx.vanish(); }
        setTimeout(() => { it.obj.removeFromParent(); for (const tx of it.texts) tx.dispose(); }, 400);
        this.items.splice(i, 1);
      }
    }
    this.swarmFrame(dt);
  }

  dispose() {
    this.closePaper();
    this.root.removeFromParent();
    this.swarm?.buzz?.stop?.(0.1);
    if (this.selfieRun?.restore) this.game.player?.setMode('play');
    this.selfieRun = null;
    if (this.faintT >= 0) this.game.engine.post.fade = 0;
    if (this.lastWritten >= 0) this.game.engine.post.exposure = this.lastBase;
  }
}

let _star: THREE.BufferGeometry | null = null;
function starGeo() {
  if (_star) return _star;
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  _star = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3 });
  _star.center();
  return _star;
}

export { tl };
