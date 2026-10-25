import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { buildRoachGeometry } from './roaches';
import { tex } from './util';

/* Squash decals (real photos: the roach + an oil-stain smear) and the rare flying roach. */

const DMAX = 28;

export class Splats {
  readonly mesh: THREE.InstancedMesh;
  private born = new Float32Array(DMAX);
  private pos: THREE.Vector3[] = [];
  private rot = new Float32Array(DMAX);
  private n = 0;
  private head = 0;
  private t = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3();

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex('splat.png'), transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.25, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(g, mat, DMAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'critters-splats';
    for (let i = 0; i < DMAX; i++) this.pos.push(new THREE.Vector3());
  }

  add(x: number, y: number, z: number) {
    const i = this.head;
    this.head = (this.head + 1) % DMAX;
    this.n = Math.min(DMAX, this.n + 1);
    this.pos[i].set(x, y + 0.004, z);
    this.rot[i] = Math.random() * Math.PI * 2;
    this.born[i] = this.t;
  }

  update(dt: number) {
    this.t += dt;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.t - this.born[i];
      if (age > 150) continue;
      const pop = Math.min(1, age * 12);
      const sc = 0.1 * (0.6 + 0.4 * pop) * (age > 140 ? (150 - age) / 10 : 1);
      this.q.setFromEuler(this.e.set(0, this.rot[i], 0));
      this.m4.compose(this.pos[i], this.q, this.s.set(sc, 1, sc * 1.1));
      this.mesh.setMatrixAt(k++, this.m4);
    }
    this.mesh.count = k;
    if (k) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.removeFromParent(); }
}

/** The rare roach that takes off and flies straight at the camera, wings buzzing open. */
export class Flyer {
  readonly group = new THREE.Group();
  private wings: THREE.Mesh[] = [];
  private t = -1;
  private from = new THREE.Vector3();
  private ctrl = new THREE.Vector3();
  private to = new THREE.Vector3();
  private exit = new THREE.Vector3();
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private hit = false;
  private shake = 0;

  constructor(private game: Game) {
    this.group.name = 'critters-flyer';
    this.group.visible = false;
    const map = tex('roach.png');
    const body = new THREE.Mesh(buildRoachGeometry(), new THREE.MeshStandardMaterial({ map, roughness: 0.32, envMapIntensity: 1.5 }));
    this.group.add(body);
    // wings: the photo's wing region on two hinged quads
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.011, 0.034);
      g.rotateX(-Math.PI / 2);
      g.translate(s * 0.0055, 0, 0.012);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, s < 0 ? 0.3 + uv.getX(i) * 0.22 : 0.52 + uv.getX(i) * 0.22, 0.2 + uv.getY(i) * 0.5);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.4 }));
      m.position.set(s * 0.002, 0.008, -0.006);
      this.group.add(m);
      this.wings.push(m);
    }
    this.group.scale.setScalar(1.2);
  }

  get flying() { return this.t >= 0; }

  launch(x: number, y: number, z: number) {
    const cam = this.game.camera;
    cam.getWorldDirection(this.fwd);
    this.from.set(x, y + 0.01, z);
    this.to.copy(cam.position).addScaledVector(this.fwd, 0.16);
    this.to.y -= 0.03;
    this.ctrl.lerpVectors(this.from, this.to, 0.5).add(this.v.set(0, 0.6, 0));
    this.exit.copy(cam.position).addScaledVector(this.fwd, -1.5).add(this.v.set((Math.random() - 0.5) * 2, 0.8, 0));
    this.t = 0; this.hit = false;
    this.group.visible = true;
    Sound.play('crit_roach_fly', { pos: this.from, vol: 1, ref: 1, max: 12 });
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const T1 = 0.85, T2 = 1.35;
    const t = this.t;
    const g = this.group;
    for (const [i, w] of this.wings.entries()) w.rotation.z = (i ? -1 : 1) * (0.9 + Math.sin(t * 90) * 0.5);
    if (t < T1) {
      // track the face while it comes (you can't dodge it)
      const cam = this.game.camera;
      cam.getWorldDirection(this.fwd);
      this.to.copy(cam.position).addScaledVector(this.fwd, 0.16);
      this.to.y -= 0.03;
      const k = t / T1, a = 1 - k;
      this.v.set(0, 0, 0).addScaledVector(this.from, a * a).addScaledVector(this.ctrl, 2 * a * k).addScaledVector(this.to, k * k);
      g.lookAt(this.v);
      g.rotateY(Math.PI);
      g.position.copy(this.v);
    } else if (t < T2) {
      if (!this.hit) {
        this.hit = true;
        this.shake = 0.45;
        const cam = this.game.camera;
        cam.getWorldDirection(this.fwd);
        const at = this.v.copy(cam.position).addScaledVector(this.fwd, 1.1);
        this.game.ui.shout(at.clone(), { th: 'อ๊ากกกก!!', en: 'AAAAH!!' }, { duration: 1.4, scale: 0.8 });
        Sound.play('chuay_duay', { vol: 0.9 });
        Sound.play('slide_whistle_up', { vol: 0.35, delay: 0.1 });
      }
      const k = (t - T1) / (T2 - T1);
      g.position.lerpVectors(this.to, this.exit, k * k);
    } else {
      this.t = -1;
      g.visible = false;
    }
    // little head-jerk on impact (player-owned yaw/pitch only)
    if (this.shake > 0) {
      this.shake -= dt;
      const pl = this.game.player;
      if (pl && pl.mode === 'play') { pl.pitch += Math.sin(this.shake * 60) * 0.012; pl.yaw += Math.cos(this.shake * 47) * 0.01; }
    }
  }

  dispose() { this.group.removeFromParent(); }
}
