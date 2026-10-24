import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { CarryPose, CharacterFactory } from '../../game/contracts';
import { followEnt } from '../../game/views';
import { tl } from '../../core/util';
import type { AnyRig } from './rigglb';
import { ARCHETYPES, resolveArchetype } from './defs';
import { RNG } from '../../core/rng';

/* ============================================================================================
 * View for `npc` entities: { role, look, p, yaw, anim?, animT?, animLoop?, face?, lookAt?, hold?,
 * name?, posture?, seat? } (posture/seat are optional extras: 'stand'|'sit'|'floor'|'lie').
 * Smooth follow, locomotion from motion, carry pose when holding, interaction target
 * { kind:'npc', eid, data:{name} }, userData.headHeight for speech bubbles, view.rig exposed.
 * ========================================================================================== */

const NO_CARRY: CarryPose = { r: false, l: false, two: false, head: false, load: 0 };
const HOLD_R: CarryPose = { r: true, l: false, two: false, head: false, load: 0.1 };

export function npcView(game: Game, factory: CharacterFactory) {
  return (e: Ent) => {
    const root = new THREE.Group();
    root.name = 'npc:' + e.id;
    const look = e.look ?? factory.randomLook(e.role, e.id);
    const rig = factory.create(look) as AnyRig;
    root.add(rig.root);
    root.userData.headHeight = rig.height + 0.25;
    const roleName = () => {
      if (e.name) return typeof e.name === 'string' ? tl(e.name) : e.name;
      const id = resolveArchetype(e.role, new RNG(e.id || 1));
      return ARCHETYPES[id]?.name ?? tl('คนเดินถนน', 'passer-by');
    };
    const meta = { kind: 'npc', eid: e.id, data: { name: roleName() } };
    game.interact.register(root, meta);
    if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
    if (e.yaw !== undefined) root.rotation.y = e.yaw;
    const prev = root.position.clone();
    let speed = 0;
    let lastAnimT: any = undefined;
    let lookJson = JSON.stringify(look);
    let holdKind: string | null = null;
    let holdObj: THREE.Object3D | null = null;
    let lastFace: any = undefined;
    let lastName = JSON.stringify(e.name ?? null);
    const tmp = new THREE.Vector3();

    const targetPos = (id: number): THREE.Vector3 | null => {
      if (id === game.localPlayerId && game.player?.firstPerson) return game.camera.getWorldPosition(tmp);
      const v = game.views.of(id).find((x: any) => x.rig) as any;
      if (v?.rig?.headWorld) return v.rig.headWorld(tmp).add(new THREE.Vector3(0, -0.1, 0));
      const t = game.state.get(id);
      if (!t?.p) return null;
      if (t.t === 'item') { const w = game.items.worldPos(t); return w ? tmp.copy(w) : null; }
      return tmp.set(t.p[0], t.p[1] + (t.t === 'player' || t.t === 'npc' ? 1.55 : 0.4), t.p[2]);
    };

    const setHold = (kind: string | null) => {
      if (holdObj) { holdObj.removeFromParent(); holdObj.traverse((o: any) => o.geometry?.dispose?.()); holdObj = null; }
      holdKind = kind;
      if (!kind) return;
      const def = game.items.def(kind);
      if (!def) return;
      try {
        const fake = { id: -e.id - 1000, t: 'item', k: kind, p: [0, 0, 0], data: def.data?.() ?? {} } as any;
        holdObj = def.build(fake, game);
        holdObj.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.raycast = () => {}; } });
        rig.attach('hand_r').add(holdObj);
      } catch (err) { console.error('[characters] hold build', kind, err); }
    };

    return {
      object: root,
      rig,
      update: (e: Ent, dt: number) => {
        if (e.look) { const lj = JSON.stringify(e.look); if (lj !== lookJson) { lookJson = lj; rig.setLook(e.look); } }
        const nj = JSON.stringify(e.name ?? null);
        if (nj !== lastName) { lastName = nj; meta.data.name = roleName(); }
        followEnt(root, e, dt, 10);
        const moved = root.position.distanceTo(prev);
        const inst = moved > 2 ? 0 : moved / Math.max(dt, 1e-4);
        speed += (Math.min(inst, 7) - speed) * (1 - Math.exp(-7 * dt));
        prev.copy(root.position);
        if (e.animT !== lastAnimT) {
          lastAnimT = e.animT;
          if (e.anim) rig.play(e.anim, { loop: e.animLoop === undefined ? undefined : !!e.animLoop });
          else rig.play('idle');
        }
        if (e.posture && e.posture !== rig.posture) rig.setPosture(e.posture);
        if (typeof e.seat === 'number') rig.seat = e.seat;
        if (e.face !== lastFace) { lastFace = e.face; rig.setFace(e.face ?? null); }
        rig.lookAt(e.lookAt != null ? targetPos(e.lookAt) : null);
        const hk = e.hold ?? null;
        if (hk !== holdKind) setHold(hk);
        rig.setMove(speed < 0.08 ? 0 : speed);
        rig.setCarry(holdKind ? HOLD_R : NO_CARRY);
        rig.update(dt);
        root.userData.headHeight = rig.headHeight + 0.22;
      },
      dispose: () => {
        game.interact.unregister(root);
        setHold(null);
        rig.dispose();
      },
    };
  };
}
