import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type ShapeDesc =
  | { type: 'box'; size: [number, number, number] }
  | { type: 'cyl'; r: number; h: number }
  | { type: 'ball'; r: number }
  | { type: 'capsule'; r: number; h: number };

/** Collision membership bits. */
export const G = { STATIC: 0x0001, ITEM: 0x0002, PLAYER: 0x0004, NPC: 0x0008, TRIGGER: 0x0010, VEHICLE: 0x0020, ALL: 0xffff };
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

let initPromise: Promise<void> | null = null;
export function initRapier() {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export interface RayHit { toi: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider }

/**
 * Rapier world wrapper.
 *  - Every peer adds STATIC colliders (the world module does this while building the map).
 *  - Only the HOST simulates dynamic bodies (items); clients render replicated transforms.
 *  - Each peer runs a kinematic character controller for its own player.
 */
export class Physics {
  readonly R = RAPIER;
  world: RAPIER.World;
  private staticBodies: RAPIER.RigidBody[] = [];
  /** collider handle → user payload (e.g. entity id) */
  readonly tags = new Map<number, any>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  static async create() { await initRapier(); return new Physics(); }

  shapeDesc(s: ShapeDesc): RAPIER.ColliderDesc {
    switch (s.type) {
      case 'box': return RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
      case 'cyl': return RAPIER.ColliderDesc.cylinder(s.h / 2, s.r);
      case 'ball': return RAPIER.ColliderDesc.ball(s.r);
      case 'capsule': return RAPIER.ColliderDesc.capsule(Math.max(0.01, s.h / 2 - s.r), s.r);
    }
  }

  /** Static axis-aligned-ish box (optional yaw). centre = box centre. */
  addBox(center: ArrayLike<number>, size: ArrayLike<number>, yaw = 0, opts: { friction?: number; tag?: any; member?: number } = {}) {
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]);
    if (yaw) bd.setRotation(quatYaw(yaw));
    const body = this.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setFriction(opts.friction ?? 0.7)
      .setCollisionGroups(groups(opts.member ?? G.STATIC, G.ALL));
    const c = this.world.createCollider(cd, body);
    if (opts.tag !== undefined) this.tags.set(c.handle, opts.tag);
    this.staticBodies.push(body);
    return c;
  }

  addCylinder(center: ArrayLike<number>, radius: number, height: number, opts: { tag?: any } = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setCollisionGroups(groups(G.STATIC, G.ALL)), body);
    if (opts.tag !== undefined) this.tags.set(c.handle, opts.tag);
    this.staticBodies.push(body);
    return c;
  }

  /** Static triangle mesh from a (world-space or object) geometry. Use for ground/ramps; prefer boxes for walls. */
  addTrimesh(geom: THREE.BufferGeometry, matrix?: THREE.Matrix4, opts: { tag?: any } = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const pos = g.getAttribute('position');
    const verts = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z;
    }
    const idx = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = i;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(groups(G.STATIC, G.ALL)), body);
    if (opts.tag !== undefined) this.tags.set(c.handle, opts.tag);
    this.staticBodies.push(body);
    return c;
  }

  /** Static box collider matching an object's world bounding box. */
  addBoundsOf(obj: THREE.Object3D, opts: { tag?: any; shrink?: number } = {}) {
    const b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) return null;
    const s = b.getSize(new THREE.Vector3()).subScalar(opts.shrink ?? 0).max(new THREE.Vector3(0.02, 0.02, 0.02));
    const c = b.getCenter(new THREE.Vector3());
    return this.addBox([c.x, c.y, c.z], [s.x, s.y, s.z], 0, opts);
  }

  /** HOST: dynamic body for an item entity. */
  addDynamic(shape: ShapeDesc, mass: number, pos: ArrayLike<number>, quat?: ArrayLike<number>, opts: { tag?: any; friction?: number; restitution?: number; linvel?: ArrayLike<number>; angvel?: ArrayLike<number>; ccd?: boolean; damping?: number } = {}) {
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setCcdEnabled(opts.ccd ?? true)
      .setLinearDamping(opts.damping ?? 0.05).setAngularDamping(0.3);
    if (quat) bd.setRotation({ x: quat[0], y: quat[1], z: quat[2], w: quat[3] });
    if (opts.linvel) bd.setLinvel(opts.linvel[0], opts.linvel[1], opts.linvel[2]);
    if (opts.angvel) bd.setAngvel({ x: opts.angvel[0], y: opts.angvel[1], z: opts.angvel[2] });
    const body = this.world.createRigidBody(bd);
    const cd = this.shapeDesc(shape).setMass(Math.max(0.01, mass)).setFriction(opts.friction ?? 0.8).setRestitution(opts.restitution ?? 0.15)
      .setCollisionGroups(groups(G.ITEM, G.STATIC | G.ITEM | G.PLAYER | G.NPC | G.VEHICLE));
    const c = this.world.createCollider(cd, body);
    if (opts.tag !== undefined) this.tags.set(c.handle, opts.tag);
    return body;
  }

  /** Kinematic capsule (players / NPCs) that pushes dynamic items. Feet at `pos`. */
  addKinematicCapsule(radius: number, height: number, pos: ArrayLike<number>, member = G.PLAYER, tag?: any) {
    const half = Math.max(0.01, height / 2 - radius);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + height / 2, pos[2]));
    const c = this.world.createCollider(RAPIER.ColliderDesc.capsule(half, radius).setCollisionGroups(groups(member, G.ALL & ~G.TRIGGER)), body);
    if (tag !== undefined) this.tags.set(c.handle, tag);
    return { body, collider: c, height };
  }

  removeBody(body: RAPIER.RigidBody | null | undefined) {
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  createController(offset = 0.02) {
    const cc = this.world.createCharacterController(offset);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    cc.enableAutostep(0.32, 0.15, true);
    cc.enableSnapToGround(0.35);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(70);
    return cc;
  }

  step() { this.world.step(); }

  /** Ray cast against colliders matching `filter` membership bits. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, filter = G.STATIC | G.ITEM, excludeCollider?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, max, true, undefined, groups(G.ALL, filter), excludeCollider, excludeBody);
    if (!hit) return null;
    const pt = ray.pointAt(hit.timeOfImpact);
    return { toi: hit.timeOfImpact, point: new THREE.Vector3(pt.x, pt.y, pt.z), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider };
  }

  /** Ground height below (x,z) by raycast from above (static only). */
  groundY(x: number, z: number, from = 50): number {
    const h = this.raycast(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0), from + 20, G.STATIC);
    return h ? h.point.y : 0;
  }

  clearStatic() {
    for (const b of this.staticBodies) this.removeBody(b);
    this.staticBodies = [];
  }
}

export function quatYaw(yaw: number) {
  const h = yaw / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
