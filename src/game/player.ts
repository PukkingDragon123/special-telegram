import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from './game';
import type { Ent } from '../sim/state';
import type { CharacterRig } from './contracts';
import { Input } from '../core/input';
import { Sound } from '../core/audio';
import { clamp, damp, dampAngle, round } from '../core/util';
import { G, groups } from '../sim/physics';
import { Overlay } from '../ui3d/overlay';
import { followEnt } from './views';

export type PlayerMode = 'play' | 'external' | 'frozen';

/**
 * Local player controller. Owns the camera while mode='play'/'frozen'.
 *  - view 'fp' (first person): camera at the eyes; your body is visible when you look down
 *    (the rig hides only the head for the camera), the selected item floats lower-right.
 *  - view 'tp' (third person, toggle V): over-the-shoulder camera with smooth lag, wall collision
 *    (never clips into geometry), the body turns toward where you walk; interaction still aims
 *    from your eyes at whatever is under the crosshair.
 * mode 'external' hands the camera to another module (skill tree, cutscenes, emotes) and shows
 * the player's own body; 'frozen' keeps the view but blocks movement/interaction.
 */
export class LocalPlayer {
  mode: PlayerMode = 'play';
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private vel = new THREE.Vector3();
  private grounded = true;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;
  private kcc: RAPIER.KinematicCharacterController | null = null;
  readonly radius = 0.3;
  readonly height = 1.72;
  eye = 1.6;
  private stepAcc = 0;
  private bobT = 0;
  private bob = 0;
  speedNow = 0;
  private lookDX = 0;
  private lookDY = 0;
  private overloadBreath: any = null;
  private lastOverloadBubble = 0;
  /** extra FOV kick (sprint) */
  private fovKick = 0;
  baseFov = 72;
  /** camera view: first or third person (V toggles, remembered) */
  view: 'fp' | 'tp' = 'fp';
  /** where the BODY faces (= yaw in first person; follows movement in third person) */
  bodyYaw = 0;
  /** third-person camera state */
  private tpDist = 2.7;
  private tpPos = new THREE.Vector3();
  private tpInit = false;
  private tpBlend = 0;
  private landDip = 0;
  private wasGrounded = true;
  /** virtual eye camera used for interaction rays in third person */
  readonly aimCam = new THREE.PerspectiveCamera(72, 1, 0.04, 50);

  constructor(private game: Game, readonly camera: THREE.PerspectiveCamera) {
    camera.fov = this.baseFov;
    camera.near = 0.04;
    camera.updateProjectionMatrix();
    camera.add(game.items.viewModel);
    try { if (localStorage.getItem('hp_view') === 'tp') this.view = 'tp'; } catch { /* storage blocked */ }
  }

  get firstPerson() { return this.mode !== 'external' && this.view === 'fp'; }

  /** Switch first / third person (V). */
  setView(v: 'fp' | 'tp') {
    if (this.view === v) return;
    this.view = v;
    try { localStorage.setItem('hp_view', v); } catch { /* storage blocked */ }
    this.tpInit = false;
    if (v === 'fp') this.yaw = this.bodyYaw = this.yaw;
    this.rig()?.setFirstPerson(this.firstPerson);
    this.game.items.viewModel.visible = this.firstPerson;
    Sound.play('pickup', { vol: 0.12, pitch: 0.8 });
  }
  get me(): Ent | undefined { return this.game.me; }

  /** Create the kinematic capsule. Call after the world's static colliders exist. */
  spawn(p: ArrayLike<number>, yaw = 0) {
    const phys = this.game.physics;
    const R = phys.R;
    if (this.body) phys.removeBody(this.body);
    this.body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1] + this.height / 2, p[2]));
    this.collider = phys.world.createCollider(
      R.ColliderDesc.capsule(this.height / 2 - this.radius, this.radius).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.ITEM | G.PLAYER | G.NPC | G.VEHICLE)),
      this.body,
    );
    this.kcc = phys.createController(0.02);
    this.teleport(p, yaw);
  }

  teleport(p: ArrayLike<number>, yaw?: number) {
    this.pos.set(p[0], p[1], p[2]);
    if (yaw !== undefined) { this.yaw = yaw; this.bodyYaw = yaw; }
    this.vel.set(0, 0, 0);
    this.tpInit = false;
    this.body?.setNextKinematicTranslation({ x: p[0], y: p[1] + this.height / 2, z: p[2] });
    this.body?.setTranslation({ x: p[0], y: p[1] + this.height / 2, z: p[2] }, true);
    this.writeEnt();
    this.placeCamera(1 / 60, true);
  }

  setMode(m: PlayerMode) {
    this.mode = m;
    const rig = this.rig();
    rig?.setFirstPerson(this.firstPerson);
    Input.setWantLock(m === 'play' || m === 'frozen');
    if (m !== 'play') this.game.interact.clear();
    Overlay.crosshair(m === 'play');
    this.game.items.viewModel.visible = this.firstPerson;
    this.tpInit = false;
  }

  rig(): CharacterRig | null {
    const v = this.game.views.of(this.game.localPlayerId).find((v: any) => v.rig) as any;
    return v?.rig ?? null;
  }

  private writeEnt() {
    const me = this.me;
    if (!me) return;
    me.p = [round(this.pos.x, 3), round(this.pos.y, 3), round(this.pos.z, 3)];
    me.yaw = round(this.view === 'tp' ? this.bodyYaw : this.yaw, 3);
    me.pitch = round(this.pitch, 3);
  }

  update(dt: number) {
    const me = this.me;
    if (!me || !this.body || !this.kcc || !this.collider) return;
    const items = this.game.items;
    const playing = this.mode === 'play';

    // ---- look
    if (this.mode !== 'external' && Input.locked) {
      const s = Input.sensitivity;
      this.lookDX = Input.mouseDX; this.lookDY = Input.mouseDY;
      this.yaw -= Input.mouseDX * s;
      this.pitch = clamp(this.pitch - Input.mouseDY * s * (Input.invertY ? -1 : 1), -1.45, 1.45);
    } else { this.lookDX = 0; this.lookDY = 0; }

    // ---- camera view toggle
    if (playing && Input.wasPressed('KeyV') && !(this.game as any).buildActive) this.setView(this.view === 'fp' ? 'tp' : 'fp');

    // ---- slot selection (1-5 / wheel)
    if (playing && !this.game.ui.choosing) {
      for (let i = 0; i < 5; i++) if (Input.wasPressed('Digit' + (i + 1))) this.select(i);
      if (Input.wheel && !(this.game as any).buildActive) this.select(((me.sel ?? 0) + Input.wheel + 5) % 5);   // build mode: wheel rotates
    }

    // ---- move
    const overloaded = items.isOverloaded(me);
    let wish = new THREE.Vector3();
    if (playing) {
      if (Input.isDown('KeyW')) wish.z -= 1;
      if (Input.isDown('KeyS')) wish.z += 1;
      if (Input.isDown('KeyA')) wish.x -= 1;
      if (Input.isDown('KeyD')) wish.x += 1;
    }
    const crouch = playing && (Input.isDown('ControlLeft') || Input.isDown('KeyC'));
    if (me.crouch !== crouch) me.crouch = crouch;
    const run = Input.isDown('ShiftLeft') && !crouch && !overloaded;
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const base = run ? 5.3 : 3.0;
    const spd = base * items.speedMul(me) * (crouch ? 0.5 : 1);
    const target = wish.multiplyScalar(spd);
    const accel = this.grounded ? 14 : 3;
    this.vel.x += (target.x - this.vel.x) * damp(accel, dt);
    this.vel.z += (target.z - this.vel.z) * damp(accel, dt);
    if (this.grounded && playing && Input.wasPressed('Space') && !overloaded) { this.vel.y = 4.2; this.grounded = false; Sound.play('grunt', { vol: 0.25 }); }
    this.vel.y -= 18 * dt;
    if (this.vel.y < -30) this.vel.y = -30;
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, undefined, groups(G.PLAYER, G.STATIC | G.ITEM | G.PLAYER | G.NPC | G.VEHICLE));
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = -1;
    this.pos.x += mv.x; this.pos.y += mv.y; this.pos.z += mv.z;
    if (this.pos.y < -20) this.teleport(this.game.world?.anchor('player_spawn')?.p ?? [0, 0, 0]);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });
    const hs = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    this.speedNow += (hs - this.speedNow) * damp(10, dt);
    // body facing: first person = camera yaw; third person = turn smoothly toward the walking direction
    if (this.view === 'fp' || this.mode === 'external') this.bodyYaw = this.yaw;
    else if (hs > 0.35 && Math.hypot(this.vel.x, this.vel.z) > 0.3) {
      const want = Math.atan2(-this.vel.x, -this.vel.z);
      this.bodyYaw = dampAngle(this.bodyYaw, want, run ? 9 : 7, dt);
    }
    if (!this.wasGrounded && this.grounded) this.landDip = Math.min(0.12, Math.max(0.03, -this.vel.y * 0.02));
    this.wasGrounded = this.grounded;
    this.writeEnt();

    // ---- footsteps & bob
    if (this.grounded && this.speedNow > 0.4) {
      this.stepAcc += this.speedNow * dt;
      this.bobT += dt * (6.5 + this.speedNow * 1.4);
      const stride = run ? 1.25 : 0.82;
      if (this.stepAcc > stride) { this.stepAcc = 0; this.footstep(); }
    }
    this.bob += ((this.grounded && this.speedNow > 0.4 ? 1 : 0) - this.bob) * damp(8, dt);

    // ---- overload feedback
    if (overloaded && playing) {
      if (!this.overloadBreath) this.overloadBreath = Sound.loop('overloaded_breath_loop', { vol: 0.6 });
      if (this.game.engine.time - this.lastOverloadBubble > 9) {
        this.lastOverloadBubble = this.game.engine.time;
        this.game.intent('player.overloaded', {});
      }
    } else if (this.overloadBreath) { this.overloadBreath.stop(0.6); this.overloadBreath = null; }

    // ---- drop
    if (playing && Input.wasPressed('KeyQ')) {
      if (items.selected(me)) this.game.intent('item.drop', { slot: me.sel ?? 0, throw: run && this.speedNow > 3 });
      else {
        // nothing in selected slot → drop the first carried thing (so overloaded players can always recover)
        const idx = (me.inv ?? []).findIndex((x: any) => x !== null);
        if (idx >= 0) this.game.intent('item.drop', { slot: idx });
      }
    }

    // ---- camera first, so interaction aims through this frame's crosshair
    items.updateViewModel(dt, this.speedNow, this.lookDX, this.lookDY);
    this.placeCamera(dt, false);
    // ---- interaction (third person aims from the eyes toward whatever is under the crosshair)
    if (playing) this.game.interact.update(dt, this.view === 'tp' ? this.aimFromEyes() : this.camera);
  }

  private _o = new THREE.Vector3();
  private _d = new THREE.Vector3();
  /** Third person: a camera at the eyes looking at the crosshair's world point (within reach range). */
  private aimFromEyes(): THREE.Camera {
    const cam = this.camera, a = this.aimCam;
    cam.getWorldPosition(this._o);
    this._d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // the crosshair point: first static/item hit along the camera ray (skip the part behind the player)
    let target: THREE.Vector3 | null = null;
    const behind = this._o.distanceTo(this.eyePos(new THREE.Vector3()));
    const h = this.game.physics?.raycast(this._o.clone().addScaledVector(this._d, behind * 0.85), this._d, 30, G.STATIC | G.ITEM | G.NPC | G.VEHICLE);
    if (h) target = h.point.clone ? h.point.clone() : new THREE.Vector3(h.point.x, h.point.y, h.point.z);
    if (!target) target = this._o.clone().addScaledVector(this._d, 30);
    this.eyePos(a.position);
    a.up.set(0, 1, 0);
    a.lookAt(target);
    a.updateMatrixWorld(true);
    return a;
  }

  /** world position of the eyes */
  eyePos(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  select(i: number) {
    const me = this.me;
    if (!me || me.sel === i) return;
    me.sel = i;
    Sound.play('pickup', { vol: 0.18, pitch: 1.6 });
  }

  private footstep() {
    const me = this.me!;
    const shoes = me.look?.shoes?.id ?? 'flipflops';
    const key = /flip|slipper|sandal/.test(shoes) ? 'footstep_flipflop' : 'footstep_concrete';
    this.game.sfx(key, [this.pos.x, this.pos.y, this.pos.z], { vol: 0.35 });
  }

  placeCamera(dt: number, snap: boolean) {
    if (this.mode === 'external') return;
    const me = this.me;
    const crouch = me?.crouch ? 1 : 0;
    const eyeTarget = (crouch ? 1.08 : 1.6) * ((me?.look?.height ?? 1.72) / 1.72);
    this.eye += (eyeTarget - this.eye) * (snap ? 1 : damp(10, dt));
    this.landDip += (0 - this.landDip) * (snap ? 1 : damp(7, dt));
    const cam = this.camera;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const run = this.speedNow > 4 ? 1 : 0;
    this.tpBlend += ((this.view === 'tp' ? 1 : 0) - this.tpBlend) * (snap ? 1 : damp(9, dt));
    if (this.view === 'tp') {
      // ---- third person: over the right shoulder, pitch-dependent height/distance, collision-safe
      const bobY = Math.abs(Math.sin(this.bobT)) * 0.018 * this.bob;
      const pivot = new THREE.Vector3(this.pos.x, this.pos.y + this.eye - 0.08 + bobY - this.landDip * 0.6, this.pos.z);
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const want = (crouch ? 2.1 : 2.75) + (this.pitch < 0 ? -this.pitch * 0.5 : 0) + run * 0.35;
      const shoulder = crouch ? 0.38 : 0.48;
      const side = pivot.clone().addScaledVector(right, shoulder);
      // shoulder offset itself must not go through a wall
      const hs = this.game.physics?.raycast(pivot, right, shoulder + 0.2, G.STATIC);
      if (hs) side.copy(pivot).addScaledVector(right, Math.max(0, hs.toi - 0.22));
      const back = fwd.clone().negate();
      let dist = want;
      // several rays (centre + 4 offsets ≈ a sphere cast) so thin edges don't let the camera clip
      const up = new THREE.Vector3(0, 1, 0);
      const offs = [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.16], [0, -0.16]];
      for (const [ox, oy] of offs) {
        const o = side.clone().addScaledVector(right, ox).addScaledVector(up, oy);
        const h = this.game.physics?.raycast(o, back, want + 0.3, G.STATIC | G.VEHICLE);
        if (h) dist = Math.min(dist, h.toi - 0.25);
      }
      dist = Math.max(0.35, dist);
      // pull in immediately, ease back out slowly (no popping)
      this.tpDist = snap || !this.tpInit ? dist : dist < this.tpDist ? dist : this.tpDist + (dist - this.tpDist) * damp(2.5, dt);
      const goal = side.clone().addScaledVector(back, this.tpDist);
      if (!this.tpInit || snap) { this.tpPos.copy(goal); this.tpInit = true; }
      else this.tpPos.lerp(goal, damp(22, dt));
      // never lag behind into a wall: if the smoothed point is further than the safe distance, clamp it
      if (this.tpPos.distanceTo(side) > this.tpDist + 0.05) this.tpPos.copy(goal);
      cam.position.copy(this.tpPos);
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      // fade the body out when the camera is squeezed right against it (tight corners)
      const rig = this.rig() as any;
      rig?.root && (rig.root.visible = this.tpDist > 0.55);
    } else {
      const rig = this.rig() as any;
      if (rig?.root && !rig.root.visible) rig.root.visible = true;
      const bobY = Math.abs(Math.sin(this.bobT)) * 0.045 * this.bob;
      const bobX = Math.cos(this.bobT) * 0.025 * this.bob;
      cam.position.set(this.pos.x, this.pos.y + this.eye + bobY - 0.02 - this.landDip, this.pos.z);
      cam.position.addScaledVector(right, bobX);
      // a little in front of the eyes so the (head-less) body never fills the view when looking down
      cam.position.x += -Math.sin(this.yaw) * 0.09;
      cam.position.z += -Math.cos(this.yaw) * 0.09;
      cam.rotation.set(this.pitch, this.yaw, Math.cos(this.bobT) * 0.004 * this.bob, 'YXZ');
    }
    this.fovKick += (run * 6 - this.fovKick) * damp(4, dt);
    const fov = this.baseFov + this.fovKick - this.tpBlend * 4;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  dispose() {
    if (this.body) this.game.physics?.removeBody(this.body);
    this.body = null;
    this.overloadBreath?.stop(0.2);
  }
}

/** View for player entities: animated character + carried items + collision proxy for remote players. */
export function playerView(game: Game) {
  return (e: Ent) => {
    const root = new THREE.Group();
    root.name = 'player:' + e.id;
    let rig = game.chars.create(e.look);
    root.add(rig.root);
    root.userData.headHeight = (e.look?.height ?? 1.72) + 0.25;
    game.interact.register(root, { kind: 'player', eid: e.id, data: { name: { th: e.name } } });
    const isLocal = () => e.id === game.localPlayerId;
    let lookJson = JSON.stringify(e.look);
    let lastAnimT = -1;
    let fp = false;
    const prev = new THREE.Vector3();
    let speed = 0;
    let kin: { body: RAPIER.RigidBody } | null = null;
    if (e.p) { root.position.set(e.p[0], e.p[1], e.p[2]); prev.copy(root.position); }
    const view = {
      object: root,
      rig,
      update: (e: Ent, dt: number) => {
        const local = isLocal();
        const lj = JSON.stringify(e.look);
        if (lj !== lookJson) { lookJson = lj; rig.setLook(e.look); if (local && fp) rig.setFirstPerson(true); }
        if (local && game.player) {
          root.position.copy(game.player.pos);
          root.rotation.set(0, game.player.bodyYaw, 0);
          speed = game.player.speedNow;
          const wantFp = game.player.firstPerson;
          if (wantFp !== fp) { fp = wantFp; rig.setFirstPerson(fp); }
        } else {
          followEnt(root, e, dt, 12);
          const d = root.position.distanceTo(prev) / Math.max(dt, 1e-4);
          speed += (Math.min(d, 8) - speed) * damp(8, dt);
          // collision proxy so we bump into friends
          if (game.physics && !kin) kin = game.physics.addKinematicCapsule(0.3, 1.7, [root.position.x, root.position.y, root.position.z], G.PLAYER, { eid: e.id });
          kin?.body.setNextKinematicTranslation({ x: root.position.x, y: root.position.y + 0.85, z: root.position.z });
        }
        prev.copy(root.position);
        if (e.animT !== undefined && e.animT !== lastAnimT) {
          lastAnimT = e.animT;
          if (e.anim) rig.play(e.anim, { loop: !!e.animLoop });
        }
        rig.setMove(e.mode === 'free' || !e.mode ? speed : 0);
        rig.setCarry(game.items.carryPose(e));
        rig.update(dt);
      },
      dispose: () => {
        game.interact.unregister(root);
        if (kin) game.physics?.removeBody(kin.body);
        rig.dispose();
      },
    };
    return view;
  };
}
