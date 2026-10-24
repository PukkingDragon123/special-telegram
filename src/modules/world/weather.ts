import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { params } from '../../core/util';
import { U } from './mats';

/**
 * WEATHER — Thai afternoon showers. The HOST plans rain windows per day and writes g.rain (0..1,
 * replicated); every peer renders streaks around the camera (one draw call), wet glossy ground
 * (uWet in the world shader), darker sky/fog, rain loop + occasional thunder & lightning.
 * ?rain=1 forces rain (debug).
 */

const RAIN_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uCam; uniform float uRain;
varying float vA;
void main() {
  vec3 box = vec3(36.0, 22.0, 36.0);
  float speed = 13.0 + aSeed.w * 6.0;
  vec3 p = aSeed.xyz * box;
  p.y -= uTime * speed;
  p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
  p.x += position.y * 0.05;          // wind slant
  p.y += position.y * (0.55 + aSeed.w * 0.4);
  p.x += position.x * 0.012;
  vA = uRain * step(aSeed.w, uRain * 1.2) * (1.0 - smoothstep(10.0, 18.0, length(p.xz - uCam.xz)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.75, 0.8, 0.85) * vA * 0.35, vA * 0.35); }`;

export class Weather {
  mesh: THREE.Mesh;
  private camU = { value: new THREE.Vector3() };
  private rainU = { value: 0 };
  private loop: any = null;
  private thunderT = 8;
  private flash = 0;
  private plan: { day: number; s: number; e: number; k: number }[] = [];
  private planned = -1;

  constructor(private game: Game, root: THREE.Object3D) {
    const N = game.engine.quality === 'low' ? 1500 : 4000;
    const pos = new Float32Array(N * 4 * 3), seed = new Float32Array(N * 4 * 4), idx = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      const cs = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) { pos.set([cs[k][0], cs[k][1], 0], (i * 4 + k) * 3); seed.set(s, (i * 4 + k) * 4); }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: U.uTime, uCam: this.camU, uRain: this.rainU } });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'rain';
    this.mesh.visible = false;
    root.add(this.mesh);
  }

  /** HOST: schedule + drive g.rain */
  host(dt: number) {
    const g = this.game.g as any;
    const day = g.day ?? 1;
    if (this.planned !== day) {
      this.planned = day;
      const r = mulberry(day * 7919 + (g.seed ?? 1));
      this.plan = [];
      if (r() < 0.45) { const s = 14 + r() * 3; this.plan.push({ day, s, e: s + 0.6 + r() * 1.0, k: 0.6 + r() * 0.4 }); }
      if (r() < 0.2) { const s = 20 + r() * 2; this.plan.push({ day, s, e: s + 0.8 + r(), k: 0.35 + r() * 0.3 }); }
    }
    const t = this.game.clock.time;
    let target = 0;
    for (const p of this.plan) if (t >= p.s && t <= p.e) target = p.k * Math.min(1, (t - p.s) / 0.15, (p.e - t) / 0.15);
    if (params.has('rain')) target = Number(params.get('rain')) || 1;
    const cur = g.rain ?? 0;
    const nv = cur + (target - cur) * Math.min(1, dt * 0.5);
    if (Math.abs(nv - cur) > 0.002 || (target === 0 && cur !== 0 && nv < 0.01)) g.rain = nv < 0.01 && target === 0 ? 0 : Math.round(nv * 1000) / 1000;
  }

  update(dt: number, cam: THREE.Vector3, atmo: { cover: number; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fog: THREE.FogExp2 }) {
    const rain = (this.game.g as any).rain ?? 0;
    this.rainU.value = rain;
    this.camU.value.copy(cam);
    this.mesh.visible = rain > 0.02;
    atmo.cover = 0.45 + rain * 0.55;
    atmo.sun.intensity *= 1 - rain * 0.65;
    atmo.fog.density *= 1 + rain * 0.9;
    // sound
    if (rain > 0.05 && !this.loop) this.loop = Sound.loop('rain_loop', { vol: 0 });
    if (this.loop) { this.loop.setVolume?.(Math.min(0.8, rain)); if (rain <= 0.02) { this.loop.stop?.(1.5); this.loop = null; } }
    // thunder + lightning flash in heavy rain
    if (rain > 0.6) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this.thunderT = 12 + Math.random() * 25; this.flash = 1; setTimeout(() => Sound.play('thunder', { vol: 0.7 }), 600 + Math.random() * 1800); }
    }
    if (this.flash > 0) { atmo.hemi.intensity += this.flash * 3; this.flash = Math.max(0, this.flash - dt * 6); }
  }

  dispose() { this.loop?.stop?.(0.3); this.loop = null; }
}

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
