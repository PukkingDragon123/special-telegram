import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Assets } from '../../core/assets';
import { tex } from './util';
import { TABLE_Y } from './casino-set';

/* ============================================================================================
 * Casino effects: real-photo casino chips (stacks + physics-driven chip rain in a local Rapier
 * world), slow-motion confetti, champagne/beer droplets and flippable playing cards.
 * Everything is local to the cutscene (purely visual, no networking).
 * ========================================================================================== */

const CHIP_R = 0.02, CHIP_H = 0.0036;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

/** Chip geometry with UVs into one of the four chip faces of chips.jpg (2×2 atlas). */
function chipGeometry(cell: number) {
  const g = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 20, 1);
  const uv = g.getAttribute('uv'), pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const cx = (cell % 2) * 0.5 + 0.25, cy = 1 - (Math.floor(cell / 2) * 0.5 + 0.25);
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), ny = nor.getY(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, cx + (x / CHIP_R) * 0.23, cy + (z / CHIP_R) * 0.23 * (ny > 0 ? -1 : 1));
    else { const a = Math.atan2(z, x); uv.setXY(i, cx + Math.cos(a) * 0.235, cy + Math.sin(a) * 0.235); }
  }
  return g;
}

export class Chips {
  readonly group = new THREE.Group();
  private world: RAPIER.World;
  private kinds: THREE.InstancedMesh[] = [];
  private bodies: { body: RAPIER.RigidBody; kind: number; idx: number }[] = [];
  private stacks: { mesh: THREE.InstancedMesh; group: THREE.Group }[] = [];
  private acc = 0;
  private mat: THREE.MeshStandardMaterial;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    // floor + card table top + roulette top (approximate) as static colliders
    const fixed = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.6).setRestitution(0.35), b);
    };
    fixed(0, -0.5, 0, 30, 0.5, 30);
    fixed(0, TABLE_Y - 0.05, 0.1, 1.3, 0.05, 0.65);
    this.mat = new THREE.MeshStandardMaterial({ map: tex('chips.jpg'), roughness: 0.45, metalness: 0.0 });
    for (let k = 0; k < 4; k++) {
      const im = new THREE.InstancedMesh(chipGeometry(k), this.mat, 40);
      im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;
      this.kinds.push(im);
      this.group.add(im);
    }
  }

  /** A static stack group (moves as a whole: push to the bet, rake away). */
  stack(at: THREE.Vector3, n: number, kind = 0, cols = 1): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    const im = new THREE.InstancedMesh(chipGeometry(kind), this.mat, n * cols);
    im.castShadow = true; im.receiveShadow = true;
    let i = 0;
    for (let c = 0; c < cols; c++) {
      const ox = (c % 3) * CHIP_R * 2.15 - CHIP_R * 2.15, oz = Math.floor(c / 3) * CHIP_R * 2.15;
      for (let j = 0; j < n; j++) {
        _q.setFromEuler(_e.set(0, Math.random() * 6.28, 0));
        im.setMatrixAt(i++, _m.compose(_p.set(ox + (Math.random() - 0.5) * 0.002, CHIP_H * (j + 0.5), oz + (Math.random() - 0.5) * 0.002), _q, _s));
      }
    }
    g.add(im);
    this.group.add(g);
    this.stacks.push({ mesh: im, group: g });
    return g;
  }

  /** Throw chips into the air from a point (celebration rain). */
  burst(at: THREE.Vector3, n = 60, up = 4.5, spread = 1.6) {
    for (let i = 0; i < n; i++) {
      const kind = i % 4;
      const im = this.kinds[kind];
      if (im.count >= 40) continue;
      const idx = im.count++;
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x + (Math.random() - 0.5) * 0.4, at.y + Math.random() * 0.2, at.z + (Math.random() - 0.5) * 0.3)
        .setLinvel((Math.random() - 0.5) * spread, up * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * spread)
        .setAngvel({ x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 30 })
        .setCcdEnabled(true).setLinearDamping(0.25).setAngularDamping(0.4));
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(CHIP_H / 2, CHIP_R).setMass(0.01).setRestitution(0.4).setFriction(0.5), b);
      this.bodies.push({ body: b, kind, idx });
    }
  }

  update(dt: number) {
    if (!this.bodies.length) return;
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= this.world.timestep && n < 8) { this.world.step(); this.acc -= this.world.timestep; n++; }
    for (const r of this.bodies) {
      const t = r.body.translation(), q = r.body.rotation();
      this.kinds[r.kind].setMatrixAt(r.idx, _m.compose(_p.set(t.x, t.y, t.z), _q.set(q.x, q.y, q.z, q.w), _s));
    }
    for (const k of this.kinds) k.instanceMatrix.needsUpdate = true;
  }

  clearRain() {
    for (const r of this.bodies) this.world.removeRigidBody(r.body);
    this.bodies = [];
    for (const k of this.kinds) k.count = 0;
  }

  dispose() {
    this.clearRain();
    this.world.free();
    for (const k of this.kinds) k.geometry.dispose();
    for (const s of this.stacks) s.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Slow-motion confetti (paper scan tinted with the casino palette) + droplets (champagne / beer). */
export class Particles {
  readonly group = new THREE.Group();
  private conf: THREE.InstancedMesh;
  private drops: THREE.InstancedMesh;
  private cp: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; alive: boolean }[] = [];
  private dp: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];

  constructor() {
    const paper = Assets.texture('textures/pbr/paper_creased/albedo.jpg', { srgb: true, repeat: 0.1 });
    this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.02), new THREE.MeshStandardMaterial({ map: paper, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 }), 320);
    this.conf.count = 0; this.conf.frustumCulled = false;
    const pal = [0xd8b04a, 0xb8202e, 0xf2efe8, 0x2f8a4a, 0xe0457b, 0xf2d27a];
    const c = new THREE.Color();
    for (let i = 0; i < 320; i++) this.conf.setColorAt(i, c.set(pal[i % pal.length]));
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.009, 0), new THREE.MeshStandardMaterial({ color: 0xfff1c8, roughness: 0.15, transparent: true, opacity: 0.85 }), 200);
    this.drops.count = 0; this.drops.frustumCulled = false;
    this.group.add(this.conf, this.drops);
  }

  confetti(center: THREE.Vector3, n = 260, radius = 2.2, height = 2.6) {
    for (let i = 0; i < n && this.cp.length < 320; i++) {
      this.cp.push({
        p: new THREE.Vector3(center.x + (Math.random() - 0.5) * radius * 2, center.y + height * (0.6 + Math.random() * 0.6), center.z + (Math.random() - 0.5) * radius * 2),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.4 - Math.random() * 0.4, (Math.random() - 0.5) * 0.3),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        alive: true,
      });
    }
    this.conf.count = this.cp.length;
  }

  spray(from: THREE.Vector3, dir: THREE.Vector3, n = 80, speed = 3.5, color = 0xfff1c8) {
    (this.drops.material as THREE.MeshStandardMaterial).color.set(color);
    for (let i = 0; i < n; i++) {
      if (this.dp.length >= 200) this.dp.shift();
      const v = dir.clone().normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      v.x += (Math.random() - 0.5) * 1.2; v.y += (Math.random() - 0.5) * 1.2; v.z += (Math.random() - 0.5) * 1.2;
      this.dp.push({ p: from.clone(), v, life: 1.6 + Math.random() });
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.cp.length; i++) {
      const c = this.cp[i];
      if (c.p.y > 0.005) {
        c.v.y = Math.max(c.v.y - 0.6 * dt, -0.7);
        c.p.addScaledVector(c.v, dt);
        c.p.x += Math.sin(c.r.x * 3 + c.p.y * 4) * 0.25 * dt;
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      } else { c.p.y = 0.004; c.r.x = -Math.PI / 2; c.r.y = 0; }
      _q.setFromEuler(c.r);
      this.conf.setMatrixAt(i, _m.compose(c.p, _q, _s));
    }
    this.conf.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const d of this.dp) {
      d.life -= dt;
      if (d.life <= 0 || d.p.y < 0) continue;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      this.drops.setMatrixAt(n++, _m.compose(d.p, _q.identity(), _s.setScalar(0.6 + d.life * 0.4)));
    }
    _s.set(1, 1, 1);
    this.dp = this.dp.filter((d) => d.life > 0 && d.p.y >= 0);
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.conf.geometry.dispose(); this.drops.geometry.dispose(); }
}

/** Playing card (front from cards.jpg: 0 = A♥, 1 = K♥, 2 = 9♦; back = cell 3). Origin = centre, lying flat. */
export function makeCard(face: number): THREE.Group {
  const atlas = tex('cards.jpg', { wrap: false });
  const cell = (c: number) => { const t = atlas.clone(); t.repeat.set(250 / 1024, 350 / 512); t.offset.set((c * 256 + 3) / 1024, 1 - 350 / 512); t.needsUpdate = true; return t; };
  const w = 0.063, h = 0.088;
  const g = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: cell(face), roughness: 0.5 }));
  front.position.y = 0.0004;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: cell(3), roughness: 0.5 }));
  front.castShadow = back.castShadow = true;
  g.add(front, back);
  return g;
}

/** Thai-baht coin reverse (temple side) — also used by the world pay scene. */
let coinGeo: THREE.BufferGeometry | null = null;
let coinMat: THREE.Material[] | null = null;
export function makeCoin(scale = 1): THREE.Mesh {
  if (!coinGeo) {
    coinGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.0018, 18);
    const uv = coinGeo.getAttribute('uv'), pos = coinGeo.getAttribute('position'), nor = coinGeo.getAttribute('normal');
    for (let i = 0; i < uv.count; i++) if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, 0.5 + (pos.getX(i) / 0.0125) * 0.49, 0.5 - (pos.getZ(i) / 0.0125) * 0.49);
    const face = new THREE.MeshStandardMaterial({ map: tex('coin.jpg'), metalness: 0.85, roughness: 0.32 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, metalness: 0.9, roughness: 0.35 });
    coinMat = [edge, face, face];
  }
  const m = new THREE.Mesh(coinGeo, coinMat!);
  m.scale.setScalar(scale);
  m.castShadow = true;
  return m;
}
