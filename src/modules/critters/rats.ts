import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { loadModel } from '../world/realprops';
import { Spots, Spot } from './spots';
import { night } from './util';

/* ============================================================================================
 * หนู — street rats darting between trash piles and drains at night. Real photoscanned model
 * (Poly Haven "street_rat", CC0, the props agent's optimised GLB used read-only), oriented by its
 * silhouette (head = the thicker end), dash → freeze & sniff → dash → gone, squeaks, bolts from feet.
 * ========================================================================================== */

const N = 3;

interface Rat { obj: THREE.Group; on: boolean; a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3; t: number; d1: number; pause: number; d2: number; speed: number; scared: boolean; squeaked: boolean }

export class Rats {
  readonly root = new THREE.Group();
  private rats: Rat[] = [];
  private timer = 6 + Math.random() * 10;
  private ready = false;
  private v = new THREE.Vector3();

  constructor(private game: Game, private spots: Spots) {
    this.root.name = 'critters-rats';
    loadModel('rat').then((m) => {
      if (!m) return;
      const proto = orientRat(m.parts.map((p) => new THREE.Mesh(p.geom, p.mat)));
      for (let i = 0; i < N; i++) {
        const obj = proto.clone(true);
        obj.visible = false;
        this.root.add(obj);
        this.rats.push({ obj, on: false, a: new THREE.Vector3(), b: new THREE.Vector3(), mid: new THREE.Vector3(), t: 0, d1: 0, pause: 0, d2: 0, speed: 2.4, scared: false, squeaked: false });
      }
      this.ready = true;
    });
  }

  private launch(r: Rat, cam: THREE.Vector3) {
    const isHole = (s: Spot) => s.kind === 'drain' || s.kind === 'trash' || s.kind === 'butcher';
    const src = this.spots.sample(cam.x, cam.z, 5, 22, Math.random, isHole);
    if (!src) return false;
    const dst = this.spots.sample(src.x, src.z, 4, 13, Math.random, (s) => isHole(s) || s.kind === 'wall');
    if (!dst) return false;
    r.a.set(src.x, src.y, src.z);
    r.b.set(dst.x, dst.y, dst.z);
    r.mid.lerpVectors(r.a, r.b, 0.4 + Math.random() * 0.25);
    r.mid.x += (Math.random() - 0.5) * 0.8; r.mid.z += (Math.random() - 0.5) * 0.8;
    r.t = 0; r.speed = 2.2 + Math.random() * 1.2;
    r.d1 = r.a.distanceTo(r.mid) / r.speed; r.pause = 0.35 + Math.random() * 0.7; r.d2 = r.mid.distanceTo(r.b) / r.speed;
    r.on = true; r.scared = false; r.squeaked = false;
    r.obj.visible = true;
    r.obj.scale.setScalar(1);
    Sound.play('crit_rat', { pos: r.a, vol: 0.8, ref: 1.2, max: 14 });
    return true;
  }

  update(dt: number, cam: THREE.Vector3) {
    if (!this.ready) return;
    const nt = night(this.game);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 9 + Math.random() * 22;
      if (nt > 0.45) { const r = this.rats.find((x) => !x.on); if (r) this.launch(r, cam); }
    }
    const pl = this.game.player;
    for (const r of this.rats) {
      if (!r.on) continue;
      r.t += dt;
      const o = r.obj;
      // bolt when a player comes close
      if (!r.scared && pl && pl.pos.distanceToSquared(o.position) < 2.2 * 2.2) {
        r.scared = true;
        const k = this.progress(r);
        r.a.copy(o.position); r.mid.copy(o.position).lerp(r.b, 0.5); r.speed = 4;
        r.t = 0; r.d1 = r.a.distanceTo(r.mid) / r.speed; r.pause = 0; r.d2 = r.mid.distanceTo(r.b) / r.speed;
        void k;
        Sound.play('crit_rat', { pos: o.position, vol: 1, pitch: 1.3, ref: 1.2, max: 14 });
      }
      let from: THREE.Vector3, to: THREE.Vector3, k: number, moving = true;
      if (r.t < r.d1) { from = r.a; to = r.mid; k = r.t / r.d1; }
      else if (r.t < r.d1 + r.pause) { from = r.mid; to = r.mid; k = 1; moving = false; if (!r.squeaked && Math.random() < 0.5) { r.squeaked = true; Sound.play('crit_rat', { pos: r.mid, vol: 0.5, pitch: 1.15, ref: 1, max: 10 }); } }
      else if (r.t < r.d1 + r.pause + r.d2) { from = r.mid; to = r.b; k = (r.t - r.d1 - r.pause) / r.d2; }
      else { // into the hole
        const s = 1 - (r.t - r.d1 - r.pause - r.d2) / 0.25;
        o.scale.setScalar(Math.max(0.01, s));
        if (s <= 0) { r.on = false; o.visible = false; }
        continue;
      }
      o.position.lerpVectors(from, to, k);
      const gy = this.game.world?.groundY(o.position.x, o.position.z) ?? o.position.y;
      o.position.y = gy + (moving ? Math.abs(Math.sin(r.t * 24)) * 0.012 : 0);
      if (moving) { this.v.subVectors(to, from); if (this.v.lengthSq() > 1e-4) o.rotation.y = Math.atan2(-this.v.x, -this.v.z); o.rotation.x = Math.sin(r.t * 24) * 0.04; }
      else { o.rotation.x = Math.sin(r.t * 14) * 0.08 - 0.06; o.rotation.y += Math.sin(r.t * 5) * dt * 0.8; }
      if (o.position.distanceToSquared(cam) > 40 * 40) { r.on = false; o.visible = false; }
    }
  }

  private progress(r: Rat) { return r.t / Math.max(0.01, r.d1 + r.pause + r.d2); }

  /** dev: launch one now near the camera */
  force(cam: THREE.Vector3) { const r = this.rats.find((x) => !x.on); return r ? this.launch(r, cam) : false; }

  dispose() { this.root.removeFromParent(); }
}

/** rotate the scan so its long axis is -Z with the (thicker) head forward; scale to a ~32 cm rat (incl. tail) */
function orientRat(meshes: THREE.Mesh[]): THREE.Group {
  const inner = new THREE.Group();
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; inner.add(m); }
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const axis: 'x' | 'z' = size.x > size.z ? 'x' : 'z';
  const lo = box.min[axis], hi = box.max[axis], L = hi - lo;
  const c = box.getCenter(new THREE.Vector3());
  let rLo = 0, rHi = 0;
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i);
      const u = (v[axis] - lo) / L;
      const r = axis === 'x' ? Math.hypot(v.y - c.y, v.z - c.z) : Math.hypot(v.y - c.y, v.x - c.x);
      if (u < 0.3) rLo = Math.max(rLo, r); else if (u > 0.7) rHi = Math.max(rHi, r);
    }
  }
  // head end → -Z
  const headDir = new THREE.Vector3(); headDir[axis] = rHi > rLo ? 1 : -1;
  inner.position.set(-c.x, -box.min.y, -c.z);
  const turn = new THREE.Group();
  turn.add(inner);
  turn.quaternion.setFromUnitVectors(headDir, new THREE.Vector3(0, 0, -1));
  const outer = new THREE.Group();
  outer.add(turn);
  const s = 0.32 / Math.max(0.05, L);
  outer.scale.setScalar(1);
  turn.scale.setScalar(s);
  outer.name = 'rat';
  return outer;
}
