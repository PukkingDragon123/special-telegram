import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound, SoundHandle } from '../../core/audio';
import { Assets } from '../../core/assets';
import { isFoodItem } from '../life/util';
import { Spots } from './spots';
import { night, qmul, tex } from './util';

/* ============================================================================================
 * แมลงวัน — house flies looping over the butcher's meat, the auntie's stall, food left on tables and
 * trash bags (real photo sprite of Musca domestica, CC BY), landing for a moment then buzzing off.
 * The butcher's ไม้ปัดแมลงวัน (spinning plastic-strip fly fan) whirs on and off; when it spins the
 * flies there scatter. One InstancedMesh of camera-facing quads; spatial buzz loops near the camera.
 * Also exports the shared billboard material used by the moths.
 * ========================================================================================== */

const MAX = 64;

export function billboardMaterial(map: THREE.Texture, flap: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uTime: { value: 0 }, uBright: { value: new THREE.Color(1, 1, 1) }, uFlap: { value: flap } },
    vertexShader: /* glsl */`
      attribute vec2 aSeed; uniform float uTime; uniform float uFlap; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sz = length(instanceMatrix[0].xyz);
        float fl = mix(1.0, 0.25 + 0.75 * abs(sin(uTime * aSeed.y + aSeed.x)), uFlap);
        vec2 q = position.xy * sz;
        q.x *= fl;
        float a = aSeed.x * 6.2831;
        q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
        c.xy += q;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 uBright; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.4) discard;
        gl_FragColor = vec4(t.rgb * uBright, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: false,
  });
}

interface Hot { p: THREE.Vector3; r: number; want: number; kind: 'meat' | 'food' | 'trash'; loop: SoundHandle | null; scare: number }

export class Flies {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private seed: THREE.InstancedBufferAttribute;
  private hots: Hot[] = [];
  private hotT = 0;
  // per fly
  private hi = new Int16Array(MAX).fill(-1);
  private ph = new Float32Array(MAX * 4);
  private land = new Float32Array(MAX);      // >0: sitting for this many seconds
  private lx = new Float32Array(MAX); private ly = new Float32Array(MAX); private lz = new Float32Array(MAX);
  private px = new Float32Array(MAX); private py = new Float32Array(MAX); private pz = new Float32Array(MAX);
  private m4 = new THREE.Matrix4(); private v = new THREE.Vector3();
  private t = 0;
  private fan: FlyFan | null = null;

  constructor(private game: Game, private spots: Spots, root: THREE.Object3D) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    g.setAttribute('aSeed', this.seed);
    this.mat = billboardMaterial(tex('fly.png'), 0.25);
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'critters-flies';
    for (let i = 0; i < MAX; i++) { this.seed.setXY(i, Math.random(), 160 + Math.random() * 90); for (let k = 0; k < 4; k++) this.ph[i * 4 + k] = Math.random() * 100; }
    // butcher fly fan
    const a = game.world?.anchors?.butcher_stall;
    if (a && spots.meat[0]) { this.fan = new FlyFan(); this.fan.group.position.copy(spots.meat[0]).add(new THREE.Vector3(0.75, 0, 0.1)); root.add(this.fan.group); }
  }

  private rebuildHots(cam: THREE.Vector3) {
    const game = this.game;
    const tod = game.clock?.time ?? 12;
    const old = this.hots;
    const next: Hot[] = [];
    const keep = (p: THREE.Vector3, r: number, want: number, kind: Hot['kind']) => {
      if (p.distanceToSquared(cam) > 26 * 26) return;
      const prev = old.find((h) => h.p.distanceToSquared(p) < 0.04);
      next.push({ p: p.clone(), r, want, kind, loop: prev?.loop ?? null, scare: prev?.scare ?? 0 });
    };
    // meat counters: busy while the market is open, a few hang around all day
    const busy = tod > 5.5 && tod < 15 ? 1 : 0.35;
    for (const m of this.spots.meat) keep(m.clone().add(new THREE.Vector3(0, 0.12, 0)), 0.55, Math.round(14 * busy), 'meat');
    // food left lying around
    let nf = 0;
    for (const e of game.state.all('item')) {
      if (nf >= 4 || e.holder != null || e.in != null || !e.p) continue;
      if (Math.abs(e.p[0] - cam.x) > 14 || Math.abs(e.p[2] - cam.z) > 14) continue;
      if (!isFoodItem(game, e, 'dog')) continue;
      keep(this.v.set(e.p[0], e.p[1] + 0.1, e.p[2]), 0.25, 4, 'food'); nf++;
    }
    // nearest trash bags
    const tr = this.spots.trash.map((s) => ({ s, d: (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 })).filter((o) => o.d < 18 * 18).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { s } of tr) keep(this.v.set(s.x, s.y + 0.5, s.z), 0.45, 5, 'trash');
    for (const h of old) if (!next.find((n) => n.loop === h.loop) && h.loop) h.loop.stop(0.6);
    this.hots = next;
    // reassign flies
    const scale = qmul(this.game);
    let i = 0;
    for (let k = 0; k < next.length; k++) {
      const n = Math.round(next[k].want * scale);
      for (let j = 0; j < n && i < MAX; j++, i++) this.hi[i] = k;
    }
    for (; i < MAX; i++) this.hi[i] = -1;
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t, game = this.game;
    this.mat.uniforms.uTime.value = t;
    const nt = night(game);
    const b = 1 - nt * 0.65;
    (this.mat.uniforms.uBright.value as THREE.Color).setRGB(b, b, b * 0.95);
    this.hotT -= dt;
    if (this.hotT <= 0) { this.hotT = 2; this.rebuildHots(cam); }
    // the fan
    let fanOn = false;
    if (this.fan) {
      fanOn = this.fan.update(dt, cam);
      const h = this.hots.find((x) => x.kind === 'meat' && x.p.distanceToSquared(this.fan!.group.position) < 2);
      if (h) h.scare += ((fanOn ? 1 : 0) - h.scare) * Math.min(1, dt * (fanOn ? 3 : 0.4));
    }
    // sound loops per hot spot near the camera
    for (const h of this.hots) {
      const d2 = h.p.distanceToSquared(cam);
      const want = d2 < 7 * 7 && h.want > 0;
      if (want && !h.loop) h.loop = Sound.loop('crit_fly_loop', { pos: h.p, vol: 0.5, ref: 0.7, max: 8 });
      else if (!want && h.loop) { h.loop.stop(0.5); h.loop = null; }
      h.loop?.setVolume(0.35 + 0.4 * (1 - h.scare) * Math.min(1, h.want / 8));
    }
    // flies
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const k = this.hi[i];
      if (k < 0) continue;
      const h = this.hots[k];
      if (!h) continue;
      const o = i * 4;
      let x: number, y: number, z: number;
      if (this.land[i] > 0) {
        this.land[i] -= dt;
        if (h.scare > 0.3) this.land[i] = 0;
        x = this.lx[i]; y = this.ly[i]; z = this.lz[i];
      } else {
        const r = h.r * (1 + h.scare * 3.5);
        const s1 = 1.3 + (this.ph[o] % 1) * 1.6, s2 = 1.1 + (this.ph[o + 1] % 1) * 1.9;
        x = h.p.x + Math.sin(t * s1 + this.ph[o]) * r * (0.6 + 0.4 * Math.sin(t * 0.7 + this.ph[o + 2]));
        z = h.p.z + Math.cos(t * s2 + this.ph[o + 1]) * r * (0.6 + 0.4 * Math.cos(t * 0.9 + this.ph[o + 3]));
        y = h.p.y + 0.06 + Math.sin(t * 2.3 + this.ph[o + 2]) * 0.09 + h.scare * 0.6 + Math.sin(t * 17 + this.ph[o]) * 0.01;
        // jittery zig-zag
        x += Math.sin(t * 23 + this.ph[o + 3]) * 0.015; z += Math.cos(t * 19 + this.ph[o]) * 0.015;
        if (h.scare < 0.2 && Math.random() < dt * 0.25) { this.land[i] = 0.8 + Math.random() * 2.5; this.lx[i] = x; this.ly[i] = h.p.y - (h.kind === 'trash' ? 0.1 : 0.06); this.lz[i] = z; }
      }
      // smooth (flies dart, but no teleports when re-assigned)
      const kk = Math.min(1, dt * 14);
      this.px[i] += (x - this.px[i]) * kk; this.py[i] += (y - this.py[i]) * kk; this.pz[i] += (z - this.pz[i]) * kk;
      if (Math.abs(this.px[i] - x) > 3) { this.px[i] = x; this.py[i] = y; this.pz[i] = z; }
      this.m4.makeScale(0.011, 0.011, 0.011).setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(n, this.m4);
      this.seed.setX(n, (i * 0.137) % 1);
      this.seed.setY(n, this.land[i] > 0 ? 0 : 180 + (i % 7) * 13);
      n++;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.seed.needsUpdate = true; }
  }

  dispose() {
    for (const h of this.hots) h.loop?.stop(0.2);
    this.fan?.dispose();
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent();
  }
}

/** ไม้ปัดแมลงวัน: small motor on a stand with a rod and plastic-bag strips that whirl around. */
class FlyFan {
  readonly group = new THREE.Group();
  private rotor = new THREE.Group();
  private strips: THREE.Mesh[] = [];
  private t = Math.random() * 10;
  private spin = 0;
  private loop: SoundHandle | null = null;

  constructor() {
    this.group.name = 'butcher-fly-fan';
    const plastic = Assets.pbr('plastic_glossy', { color: 0xd8d2c4 });
    const steel = Assets.pbr('stainless_brushed', { color: 0xcfcfcf });
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 12), plastic);
    motor.position.y = 0.06;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), steel);
    rod.position.y = 0.33;
    this.group.add(motor, rod);
    this.rotor.position.y = 0.52;
    const strip = Assets.pbr('plastic_glossy', { color: 0xf0f4ff }).clone();
    strip.transparent = true; strip.opacity = 0.55; strip.side = THREE.DoubleSide; strip.depthWrite = false;
    const pink = strip.clone(); pink.color.set(0xff8fb0);
    for (let k = 0; k < 4; k++) {
      const g = new THREE.PlaneGeometry(0.03, 0.42, 1, 6);
      g.translate(0, -0.21, 0);
      const m = new THREE.Mesh(g, k % 2 ? pink : strip);
      const a = (k / 4) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.012, 0, Math.sin(a) * 0.012);
      m.rotation.y = -a;
      this.rotor.add(m);
      this.strips.push(m);
    }
    this.group.add(this.rotor);
    this.group.traverse((o: any) => { if (o.isMesh) o.castShadow = false; });
  }

  /** returns true while spinning */
  update(dt: number, cam: THREE.Vector3): boolean {
    this.t += dt;
    const cyc = this.t % 15;
    const on = cyc < 6;
    this.spin += ((on ? 1 : 0) - this.spin) * Math.min(1, dt * (on ? 2.5 : 1.2));
    this.rotor.rotation.y += this.spin * dt * 22;
    // strips swing outward with speed
    for (const s of this.strips) s.rotation.z = -this.spin * 1.2 + Math.sin(this.t * 9 + s.id) * 0.05 * (1 - this.spin);
    const near = this.group.position.distanceToSquared(cam) < 9 * 9;
    if (on && near && !this.loop) this.loop = Sound.loop('fan_loop', { pos: this.group.position, vol: 0.35, ref: 1, max: 9 });
    if ((!on || !near) && this.loop) { this.loop.stop(0.8); this.loop = null; }
    return this.spin > 0.5;
  }

  dispose() { this.loop?.stop(0.2); this.group.removeFromParent(); }
}
