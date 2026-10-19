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
 * Local first-person controller (no hands are ever drawn). Owns the camera while mode='play'.
 * mode 'external' hands the camera to another module (skill tree, cutscenes, emotes) and shows
 * the player's own body; 'frozen' keeps first person but blocks movement/interaction.
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

  constructor(private game: Game, readonly camera: THREE.PerspectiveCamera) {
    camera.fov = this.baseFov;
    camera.near = 0.04;
    camera.updateProjectionMatrix();
    camera.add(game.items.viewModel);
  }

  get firstPerson() { return this.mode !== 'external'; }
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
    if (yaw !== undefined) this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.body?.setNextKinematicTranslation({ x: p[0], y: p[1] + this.height / 2, z: p[2] });
    this.body?.setTranslation({ x: p[0], y: p[1] + this.height / 2, z: p[2] }, true);
    this.writeEnt();
    this.placeCamera(1 / 60, true);
  }

  setMode(m: PlayerMode) {
    this.mode = m;
    const rig = this.rig();
    rig?.setFirstPerson(m !== 'external');
    Input.setWantLock(m === 'play' || m === 'frozen');
    if (m !== 'play') this.game.interact.clear();
    Overlay.crosshair(m === 'play');
    this.game.items.viewModel.visible = m !== 'external';
  }

  rig(): CharacterRig | null {
    const v = this.game.views.of(this.game.localPlayerId).find((v: any) => v.rig) as any;
    return v?.rig ?? null;
  }

  private writeEnt() {
    const me = this.me;
    if (!me) return;
    me.p = [round(this.pos.x, 3), round(this.pos.y, 3), round(this.pos.z, 3)];
    me.yaw = round(this.yaw, 3);
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

    // ---- slot selection (1-5 / wheel)
    if (playing) {
      for (let i = 0; i < 5; i++) if (Input.wasPressed('Digit' + (i + 1))) this.select(i);
      if (Input.wheel) this.select(((me.sel ?? 0) + Input.wheel + 5) % 5);
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

    // ---- interaction
    if (playing) this.game.interact.update(dt, this.camera);
    items.updateViewModel(dt, this.speedNow, this.lookDX, this.lookDY);
    this.placeCamera(dt, false);
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
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.045 * this.bob;
    const bobX = Math.cos(this.bobT) * 0.025 * this.bob;
    const cam = this.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eye + bobY - 0.02, this.pos.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bobX);
    cam.rotation.set(this.pitch, this.yaw, Math.cos(this.bobT) * 0.004 * this.bob, 'YXZ');
    const run = this.speedNow > 4 ? 1 : 0;
    this.fovKick += (run * 6 - this.fovKick) * damp(4, dt);
    const fov = this.baseFov + this.fovKick;
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
          root.rotation.set(0, game.player.yaw, 0);
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
