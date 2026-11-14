import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Local combat FX (every peer): impact bursts, knock-out stars, muzzle flash + tracer + bullet
 * dust, a synthesized gunshot (WebAudio — no sample needed), camera shake / punch lunge, red hurt
 * flash and the knock-out screen. Pooled sprites, shared canvas textures; nothing per frame allocates.
 * ========================================================================================== */

function starTex(points: number, inner: number, color: string, soft = 0.5): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color); g.addColorStop(soft, color); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? 32 * inner : 31, a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spr { s: THREE.Sprite; life: number; t: number; v: THREE.Vector3; s0: number; s1: number; spin: number }

export class CombatFX {
  readonly root = new THREE.Group();
  private pool: Spr[] = [];
  private live: Spr[] = [];
  private tex: Record<string, THREE.Texture> = {};
  private tracers: { l: THREE.Line; t: number }[] = [];
  private stars = new Map<number, THREE.Sprite[]>();
  private shake = 0;
  private lunge = 0;
  private flash!: HTMLDivElement;
  private koEl!: HTMLDivElement;
  private flashK = 0;
  private noise: AudioBuffer | null = null;
  private t = 0;

  constructor(private game: Game) {
    this.root.name = 'combat-fx';
    this.tex.burst = starTex(8, 0.38, 'rgba(255,248,230,1)', 0.25);
    this.tex.muzzle = starTex(6, 0.3, 'rgba(255,214,140,1)', 0.35);
    this.tex.dust = starTex(12, 0.85, 'rgba(200,190,170,0.8)', 0.1);
    this.tex.star = starTex(5, 0.45, 'rgba(235,245,255,1)', 0.6);
    const st = document.createElement('style');
    st.textContent = `.cb-flash{position:fixed;inset:0;pointer-events:none;z-index:8;opacity:0;background:radial-gradient(ellipse at center,rgba(160,0,0,0) 45%,rgba(170,10,10,.55) 100%)}
      .cb-ko{position:fixed;inset:0;pointer-events:none;z-index:9;background:#0b0606;opacity:0;transition:opacity .6s;display:flex;align-items:center;justify-content:center;
        color:#fff;font:800 clamp(28px,4vw,54px) ${F.ui},sans-serif;text-shadow:0 2px 0 #000,0 0 3px #000}
      .cb-ko small{display:block;font:500 clamp(13px,1.3vw,17px) ${F.ui};opacity:.75;margin-top:6px;text-align:center}`;
    document.head.appendChild(st);
    this.flash = document.createElement('div'); this.flash.className = 'cb-flash';
    this.koEl = document.createElement('div'); this.koEl.className = 'cb-ko';
    document.body.append(this.flash, this.koEl);
    // camera shake / lunge after the player placed the camera, before render
    game.engine.onLate(() => this.applyCamera());
  }

  attach() { if (this.game.scene && this.root.parent !== this.game.scene) this.game.scene.add(this.root); }

  private sprite(tex: string, p: THREE.Vector3, life: number, s0: number, s1: number, v = new THREE.Vector3(), additive = true): Spr {
    let o = this.pool.pop();
    if (!o) {
      const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false });
      o = { s: new THREE.Sprite(m), life: 0, t: 0, v: new THREE.Vector3(), s0: 0, s1: 0, spin: 0 };
      o.s.renderOrder = 20;
    }
    const m = o.s.material as THREE.SpriteMaterial;
    m.map = this.tex[tex]; m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; m.opacity = 1; m.rotation = Math.random() * 6.28; m.needsUpdate = true;
    o.s.position.copy(p); o.life = life; o.t = 0; o.v.copy(v); o.s0 = s0; o.s1 = s1; o.spin = (Math.random() - 0.5) * 6;
    o.s.scale.setScalar(s0);
    this.root.add(o.s);
    this.live.push(o);
    return o;
  }

  impact(p: THREE.Vector3, crit: boolean) {
    this.attach();
    this.sprite('burst', p, crit ? 0.2 : 0.14, 0.12, crit ? 0.75 : 0.45);
    for (let i = 0; i < (crit ? 7 : 4); i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.2, (Math.random() - 0.5) * 3);
      this.sprite('dust', p, 0.35, 0.05, 0.18, v, false);
    }
  }

  muzzle(p: THREE.Vector3, to: THREE.Vector3, hit: boolean) {
    this.attach();
    this.sprite('muzzle', p, 0.06, 0.18, 0.32);
    const g = new THREE.BufferGeometry().setFromPoints([p, to]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    l.renderOrder = 20;
    this.root.add(l);
    this.tracers.push({ l, t: 0 });
    if (!hit) for (let i = 0; i < 4; i++) this.sprite('dust', to, 0.5, 0.05, 0.25, new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5), false);
    this.gunshot(p);
  }

  /** dizzy stars over a knocked-out npc's head (null removes) */
  setStars(id: number, on: boolean) {
    const have = this.stars.get(id);
    if (on && !have) {
      this.attach();
      const arr: THREE.Sprite[] = [];
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.star, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
        s.scale.setScalar(0.13); s.renderOrder = 20;
        this.root.add(s); arr.push(s);
      }
      this.stars.set(id, arr);
    } else if (!on && have) {
      for (const s of have) { s.removeFromParent(); (s.material as THREE.Material).dispose(); }
      this.stars.delete(id);
    }
  }

  shakeCam(k: number) { this.shake = Math.min(1, this.shake + k); }
  punchLunge() { this.lunge = 1; }
  hurtFlash(k: number) { this.flashK = Math.min(1, this.flashK + k); }

  knockScreen(on: boolean, th = 'สลบเหมือด', en = 'out cold') {
    if (on) { this.koEl.innerHTML = `<div>${th}<small>${en}</small></div>`; this.koEl.style.opacity = '0.92'; }
    else this.koEl.style.opacity = '0';
  }

  private applyCamera() {
    const cam = this.game.camera;
    if (!cam || this.game.player?.mode === 'external') return;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.06;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.6;
    }
    if (this.lunge > 0.001) {
      const k = Math.sin(this.lunge * Math.PI) * 0.08;
      _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
      cam.position.addScaledVector(_f, k);
    }
  }

  /** a short, punchy gunshot made from filtered noise + a low thump, positioned in 3D */
  private gunshot(p: THREE.Vector3) {
    const ctx = Sound.ctx;
    if (!ctx || (Sound as any).muted) return;
    if (!this.noise) {
      const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
      const d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      this.noise = n;
    }
    const t = ctx.currentTime;
    const out = (Sound as any).master ?? ctx.destination;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 4; pan.maxDistance = 120; pan.rolloffFactor = 0.8;
    pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z;
    pan.connect(out);
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.35);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.2, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(lp).connect(g).connect(pan);
    src.start(t); src.stop(t + 0.6);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og).connect(pan); o.start(t); o.stop(t + 0.2);
  }

  /** stars follow heads; sprites and tracers age */
  frame(dt: number, headOf: (id: number) => THREE.Vector3 | null) {
    this.t += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const o = this.live[i];
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.s.removeFromParent(); this.live.splice(i, 1); this.pool.push(o); continue; }
      o.s.position.addScaledVector(o.v, dt); o.v.y -= dt * 4;
      o.s.scale.setScalar(o.s0 + (o.s1 - o.s0) * Math.sqrt(k));
      const m = o.s.material as THREE.SpriteMaterial;
      m.opacity = 1 - k * k; m.rotation += o.spin * dt;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]; tr.t += dt;
      (tr.l.material as THREE.LineBasicMaterial).opacity = Math.max(0, 0.85 - tr.t * 12);
      if (tr.t > 0.08) { tr.l.removeFromParent(); tr.l.geometry.dispose(); (tr.l.material as THREE.Material).dispose(); this.tracers.splice(i, 1); }
    }
    for (const [id, arr] of this.stars) {
      const h = headOf(id);
      if (!h) { this.setStars(id, false); continue; }
      arr.forEach((s, i) => { const a = this.t * 3 + (i / arr.length) * Math.PI * 2; s.position.set(h.x + Math.cos(a) * 0.28, h.y + 0.12 + Math.sin(this.t * 5 + i) * 0.03, h.z + Math.sin(a) * 0.28); });
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.lunge = Math.max(0, this.lunge - dt * 7);
    this.flashK = Math.max(0, this.flashK - dt * 1.6);
    this.flash.style.opacity = this.flashK.toFixed(3);
  }

  clear() {
    for (const o of this.live) { o.s.removeFromParent(); this.pool.push(o); }
    this.live = [];
    for (const id of [...this.stars.keys()]) this.setStars(id, false);
    this.root.removeFromParent();
    this.knockScreen(false);
    this.flashK = 0;
  }
}

const _f = new THREE.Vector3();
