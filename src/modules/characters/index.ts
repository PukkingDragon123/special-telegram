import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { CharacterFactory, Look } from '../../game/contracts';
import { Assets } from '../../core/assets';
import { params } from '../../core/util';
import { RigWorld, processAtlasQueue } from './rig';
import { createRig } from './rigglb';
import { loadTemplates } from './glb';
import { randomLook, playerLook, catalogue, ingestFaceManifest, archetypeIds, ARCHETYPES } from './defs';
import { preloadFabrics } from './atlas';
import { npcView } from './npcview';
import { CharLab } from './charlab';
import { ANIM_NAMES } from './anims';

/* ============================================================================================
 * characters — procedural low-poly skinned Thai people with static photo faces.
 *   game.chars.create(look, {lod, castShadow}) → CharacterRig (+ extras: setPosture, seat,
 *     headWorld(), headHeight, anim, lod, mesh)
 *   game.chars.randomLook(archetype, seed) · playerLook(slot) · catalogue()
 *   extras: (game.chars as any).archetypes() → ids, .anims() → AnimName list
 *   npc view: registerView('npc') · dev scene: ?charlab (see charlab.ts)
 * ========================================================================================== */

const factory: CharacterFactory & { archetypes(): string[]; archetypeName(id: string): any; anims(): string[] } = {
  create: (look: Look, opts?: { lod?: 'high' | 'low'; castShadow?: boolean }) => createRig(look ?? randomLook(), opts ?? {}),
  randomLook: (archetype?: string, seed?: number) => randomLook(archetype, seed),
  playerLook: (slot: number) => playerLook(slot),
  catalogue: () => catalogue(),
  archetypes: () => archetypeIds(),
  archetypeName: (id: string) => ARCHETYPES[id]?.name,
  anims: () => ANIM_NAMES.slice(),
};

const _cam = new THREE.Vector3();

export default defineModule({
  id: 'characters',
  async init(game) {
    await Promise.all([
      Assets.jsonSafe<any>('textures/faces/manifest.json', null).then((m) => ingestFaceManifest(m)),
      preloadFabrics(),
      loadTemplates(),
    ]);
    game.chars = factory;
    game.registerView('npc', npcView(game, factory));
    game.scenes.register('charlab', () => new CharLab(game));
    if (params.has('charlab')) {
      let done = false;
      game.events.on('net:session', () => {
        if (done) return;
        done = true;
        setTimeout(() => { if (game.isHost) game.g.scene = 'charlab'; }, 0);
      });
    }
  },
  frame(game) {
    RigWorld.frame++;
    const cam = game.engine.camera;
    if (cam) { cam.getWorldPosition(_cam); RigWorld.cam.copy(_cam); }
    processAtlasQueue();
  },
});
