import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound, SoundHandle } from '../../core/audio';
import { Spots } from './spots';
import { billboardMaterial } from './flies';
import { night, qmul, tex } from './util';

/* ============================================================================================
 * แมลงเม่า / moths circling the street lamps at night (real photo cut-out, CC BY), lit warm by the
 * lamp, erratic orbits that bump into the lamp head. One InstancedMesh for every lamp near the camera.
 * ========================================================================================== */

const MAX = 70;
const PER = 9;

export class Moths {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private seed: THREE.InstancedBufferAttribute;
  private t = 0;
  private near: number[] = [];
  private nearT = 0;
  private m4 = new THREE.Matrix4();
  private loop: SoundHandle | null = null;
  private v = new THREE.Vector3();

  constructor(private game: Game, private spots: Spots) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    g.setAttribute('aSeed', this.seed);
    this.mat = billboardMaterial(tex('moth.png'), 1);
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'critters-moths';
    for (let i = 0; i < MAX; i++) this.seed.setXY(i, Math.random(), 26 + Math.random() * 18);
    this.seed.needsUpdate = true;
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    const nt = night(this.game);
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uBright.value as THREE.Color).setRGB(1.6, 1.35, 0.95);
    if (nt < 0.35 || !this.spots.lamps.length) {
      this.mesh.count = 0;
      if (this.loop) { this.loop.stop(0.5); this.loop = null; }
      return;
    }
    this.nearT -= dt;
    if (this.nearT <= 0) {
      this.nearT = 1;
      const L = this.spots.lamps;
      this.near = L.map((l, i) => ({ i, d: (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2 })).filter((o) => o.d < 38 * 38).sort((a, b) => a.d - b.d).slice(0, Math.floor(MAX / PER)).map((o) => o.i);
    }
    const per = Math.max(3, Math.round(PER * qmul(this.game) * Math.min(1, (nt - 0.3) * 2)));
    let n = 0, closest = 1e9, cl = -1;
    for (const li of this.near) {
      const l = this.spots.lamps[li];
      const d2 = (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2;
      if (d2 < closest) { closest = d2; cl = li; }
      for (let k = 0; k < per && n < MAX; k++, n++) {
        const s = li * 31 + k * 7.3;
        const r = 0.25 + ((s * 0.618) % 1) * 0.55;
        const w1 = 1.4 + ((s * 0.37) % 1) * 2.2, w2 = 1.1 + ((s * 0.71) % 1) * 2.6;
        const x = l.x + Math.sin(t * w1 + s) * r + Math.sin(t * 7.3 + s * 2) * 0.06;
        const z = l.z + Math.cos(t * w2 + s * 1.3) * r + Math.cos(t * 6.1 + s) * 0.06;
        const y = l.y - 0.18 + Math.sin(t * 1.7 + s) * 0.22 + Math.abs(Math.sin(t * 9 + s)) * 0.05;
        const sz = 0.03 + ((s * 0.29) % 1) * 0.018;
        this.m4.makeScale(sz, sz, sz).setPosition(x, y, z);
        this.mesh.setMatrixAt(n, this.m4);
      }
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
    // faint flutter at the nearest lamp
    const want = cl >= 0 && closest < 5 * 5;
    if (want && !this.loop) this.loop = Sound.loop('crit_moth_loop', { pos: this.v.set(this.spots.lamps[cl].x, this.spots.lamps[cl].y, this.spots.lamps[cl].z), vol: 0.4, ref: 0.8, max: 6 });
    else if (!want && this.loop) { this.loop.stop(0.6); this.loop = null; }
    if (this.loop && cl >= 0) this.loop.setPos(this.v.set(this.spots.lamps[cl].x, this.spots.lamps[cl].y, this.spots.lamps[cl].z));
  }

  dispose() { this.loop?.stop(0.2); this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}
