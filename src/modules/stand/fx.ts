import * as THREE from 'three';
import { F } from '../../core/fonts';

/* ============================================================================================
 * Screen + world effects for the burnt-rice time rewind (module `stand`):
 *  RewindOverlay — DOM layer: desaturation, VHS "◀◀ REWIND" scan bars + inward ripple rings,
 *                  the stand's name card (white lettering, dark outline, no glow, level)
 *  SmokeSuck     — grey smoke puffs that fly BACK into the wok (time running backwards)
 *  Aura          — soft pink motes drifting around the stand while it is out
 * ========================================================================================== */

export class RewindOverlay {
  private root: HTMLDivElement;
  private desat: HTMLDivElement;
  private rings: HTMLCanvasElement;
  private vhs: HTMLDivElement;
  private card: HTMLDivElement;
  private grayK = 0; private grayTo = 0;
  private ringK = 0; private ringTo = 0; private ringT = 0;
  private vhsOn = false;

  constructor() {
    const r = (this.root = document.createElement('div'));
    r.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9';
    this.desat = document.createElement('div');
    this.desat.style.cssText = 'position:absolute;inset:0;background:#808080;mix-blend-mode:saturation;opacity:0';
    this.rings = document.createElement('canvas');
    this.rings.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0';
    this.vhs = document.createElement('div');
    this.vhs.style.cssText = `position:absolute;left:clamp(16px,3vw,40px);top:clamp(16px,4vh,44px);font:900 clamp(22px,2.6vw,38px)/1 ${F.heavy},sans-serif;color:#fff;
      -webkit-text-stroke:2px #000;paint-order:stroke fill;letter-spacing:.06em;opacity:0;transition:opacity .2s`;
    this.vhs.textContent = '◀◀ ย้อนเวลา · REWIND';
    this.card = document.createElement('div');
    this.card.style.cssText = `position:absolute;right:clamp(16px,4vw,60px);bottom:clamp(60px,16vh,170px);text-align:right;opacity:0;transform:translateX(40px);
      transition:opacity .35s,transform .45s cubic-bezier(.2,1.2,.4,1);color:#fff`;
    this.card.innerHTML = `<div style="font:700 clamp(12px,1.1vw,16px) ${F.ui};letter-spacing:.3em;-webkit-text-stroke:1px #000;paint-order:stroke fill">สแตนด์ · STAND</div>
      <div style="font:900 clamp(34px,4.2vw,64px)/1.05 ${F.heavy};-webkit-text-stroke:3px #000;paint-order:stroke fill">「ข้าวไหม้ควีน」</div>
      <div style="font:800 clamp(14px,1.5vw,22px) ${F.ui};letter-spacing:.25em;-webkit-text-stroke:1.5px #000;paint-order:stroke fill">BURNT QUEEN</div>`;
    r.append(this.desat, this.rings, this.vhs, this.card);
    document.body.appendChild(r);
  }

  gray(on: boolean) { this.grayTo = on ? 1 : 0; }
  rewind(on: boolean) { this.ringTo = on ? 1 : 0; this.vhsOn = on; this.vhs.style.opacity = on ? '1' : '0'; }
  showCard(on: boolean) { this.card.style.opacity = on ? '1' : '0'; this.card.style.transform = on ? 'none' : 'translateX(40px)'; }

  update(raw: number) {
    const ease = (c: number, t: number, k: number) => c + (t - c) * (1 - Math.exp(-raw * k));
    this.grayK = ease(this.grayK, this.grayTo, 8);
    this.desat.style.opacity = (this.grayK * 0.85).toFixed(3);
    this.ringK = ease(this.ringK, this.ringTo, 10);
    this.rings.style.opacity = this.ringK.toFixed(3);
    if (this.vhsOn) this.vhs.style.visibility = (Math.floor(performance.now() / 380) % 2) ? 'visible' : 'hidden';
    if (this.ringK > 0.02) { this.ringT += raw; this.drawRings(); }
  }

  /** concentric rings shrinking INTO the centre + VHS tracking bars: time running backwards */
  private drawRings() {
    const cv = this.rings;
    const w = Math.max(320, Math.round(innerWidth / 2)), h = Math.max(180, Math.round(innerHeight / 2));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2;
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const k = 1 - (((this.ringT * 0.9) + i / 6) % 1);   // 1 → 0: shrinking
      g.strokeStyle = `rgba(255,255,255,${(0.32 * k).toFixed(3)})`;
      g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const y = ((this.ringT * 140 + i * h / 3) % (h + 20)) - 10;
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y, w, 6);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y + 6, w, 3);
    }
  }

  dispose() { this.root.remove(); }
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(235,235,235,0.75)'); gr.addColorStop(0.5, 'rgba(200,200,200,0.35)'); gr.addColorStop(1, 'rgba(180,180,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let PUFF: THREE.CanvasTexture | null = null;

interface Puff { s: THREE.Sprite; from: THREE.Vector3; t: number; life: number }

/** smoke flying backwards into the wok */
export class SmokeSuck {
  group = new THREE.Group();
  private puffs: Puff[] = [];
  private acc = 0;
  active = false;
  target = new THREE.Vector3();
  update(dt: number) {
    if (this.active) {
      this.acc += dt * 18;
      while (this.acc >= 1) {
        this.acc -= 1;
        PUFF ??= puffTexture();
        const m = new THREE.SpriteMaterial({ map: PUFF, transparent: true, depthWrite: false, opacity: 0, fog: false });
        const s = new THREE.Sprite(m);
        const a = Math.random() * Math.PI * 2, r = 0.9 + Math.random() * 1.2;
        const from = this.target.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.6, 0.6 + Math.random() * 1.8, Math.sin(a) * r * 0.6));
        s.position.copy(from); s.scale.setScalar(0.5 + Math.random() * 0.5);
        this.group.add(s);
        this.puffs.push({ s, from, t: 0, life: 0.7 + Math.random() * 0.4 });
      }
    }
    for (const p of this.puffs) {
      p.t += dt;
      const k = Math.min(1, p.t / p.life);
      const e = k * k;                       // accelerates into the wok
      p.s.position.lerpVectors(p.from, this.target, e);
      p.s.scale.setScalar(Math.max(0.05, (1 - e) * 0.9));
      (p.s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.45;
    }
    this.puffs = this.puffs.filter((p) => { if (p.t < p.life) return true; p.s.removeFromParent(); (p.s.material as THREE.Material).dispose(); return false; });
  }
  dispose() { for (const p of this.puffs) { p.s.removeFromParent(); (p.s.material as THREE.Material).dispose(); } this.puffs = []; this.group.removeFromParent(); }
}

/** soft pink motes around the stand */
export class Aura {
  points: THREE.Points;
  private base: Float32Array;
  constructor(n = 60) {
    const g = new THREE.BufferGeometry();
    this.base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.base[i * 3] = (Math.random() - 0.5) * 1.1; this.base[i * 3 + 1] = Math.random() * 2.1; this.base[i * 3 + 2] = (Math.random() - 0.5) * 0.7; }
    g.setAttribute('position', new THREE.BufferAttribute(this.base.slice(), 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf6b6cf, size: 0.035, transparent: true, opacity: 0, depthWrite: false }));
    this.points.frustumCulled = false;
  }
  update(t: number, k: number) {
    const a = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const y = (this.base[i * 3 + 1] + t * 0.35) % 2.1;
      a.setXYZ(i, this.base[i * 3] + Math.sin(t * 1.3 + i) * 0.05, y, this.base[i * 3 + 2] + Math.cos(t * 1.1 + i) * 0.05);
    }
    a.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 0.75 * k;
  }
  dispose() { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); this.points.removeFromParent(); }
}
