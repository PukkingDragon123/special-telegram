import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { params } from '../../core/util';
import { Spots } from './spots';
import { Roaches } from './roaches';
import { Flies } from './flies';
import { Moths } from './moths';
import { Rats } from './rats';
import { Splats, Flyer } from './fx';
import { registerSounds } from './util';

/* ============================================================================================
 * MODULE `critters` — the street is alive: cockroaches (แมลงสาบ) on kerbs, wall bases, drains, trash
 * and the butcher (lots at night; stomp them!), flies over meat / food / trash with the butcher's
 * fly fan, rats darting between trash and drains at night, moths around street lamps.
 * Client-local & cosmetic (ARCHITECTURE §3): no entities, no network. Instanced, simulated only near
 * the camera, no per-frame allocation in the hot loops.
 * Dev: window.__critters = { sys, roaches(n), rat(), fly() } · ?critters=0 disables the module.
 * ========================================================================================== */

const STOMP_TEXT = ['แหวะ!', 'กรอบ!', 'อี๋ยยย!', 'โทษทีนะพี่…', 'แป๊ะ!', 'ขอให้ไปสบาย'];

class CritterSys {
  readonly root = new THREE.Group();
  readonly spots: Spots;
  readonly roaches: Roaches;
  readonly flies: Flies;
  readonly moths: Moths;
  readonly rats: Rats;
  readonly splats = new Splats();
  readonly flyer: Flyer;
  private textT = 0;

  constructor(private game: Game) {
    this.root.name = 'critters';
    this.spots = new Spots(game);
    this.spots.build();
    this.roaches = new Roaches(game, this.spots);
    this.flies = new Flies(game, this.spots, this.root);
    this.moths = new Moths(game, this.spots);
    this.rats = new Rats(game, this.spots);
    this.flyer = new Flyer(game);
    this.root.add(this.roaches.mesh, this.flies.mesh, this.moths.mesh, this.rats.root, this.splats.mesh, this.flyer.group);
    this.roaches.onSquash = (x, y, z, local) => this.squash(x, y, z, local);
    this.roaches.onFly = (x, y, z) => { if (!this.flyer.flying) this.flyer.launch(x, y, z); };
    game.scene!.add(this.root);
  }

  private squash(x: number, y: number, z: number, local: boolean) {
    this.splats.add(x, y, z);
    const p = new THREE.Vector3(x, y, z);
    Sound.play('crit_stomp', { pos: p, vol: local ? 1 : 0.7, ref: 1, max: 10 });
    if (local && this.textT <= 0) {
      this.textT = 2.5;
      const txt = STOMP_TEXT[Math.floor(Math.random() * STOMP_TEXT.length)];
      this.game.ui.popup(p.add(new THREE.Vector3(0, 0.35, 0)), txt, { style: { font: '"K2D"', size: 52, color: '#e8d27a' } as any, dur: 1.4, scale: 0.7 });
    }
  }

  frame(dt: number) {
    const game = this.game;
    if (game.g.scene !== 'world' || !game.scene) return;
    const cam = game.camera.position;
    this.textT -= dt;
    this.roaches.update(dt, cam);
    this.flies.update(dt, cam);
    this.moths.update(dt, cam);
    this.rats.update(dt, cam);
    this.splats.update(dt);
    this.flyer.update(dt);
  }

  dispose() {
    this.roaches.dispose(); this.flies.dispose(); this.moths.dispose(); this.rats.dispose(); this.splats.dispose(); this.flyer.dispose();
    this.root.removeFromParent();
  }
}

let sys: CritterSys | null = null;

export default defineModule({
  id: 'critters',
  deps: ['world', 'life'],
  init(game: Game) {
    registerSounds();
    game.events.on('world:exit', () => { sys?.dispose(); sys = null; });
    (window as any).__critters = {
      get sys() { return sys; },
      roaches: (n = 10) => sys?.roaches.spawnNear(game.camera.position, n),
      rat: () => sys?.rats.force(game.camera.position),
      fly: () => sys?.roaches.forceFly(),
    };
  },
  async buildWorld(game: Game) {
    if (params.get('critters') === '0') return;
    registerSounds();
    sys?.dispose();
    try { sys = new CritterSys(game); } catch (e) { console.error('[critters] build', e); sys = null; }
  },
  frame(game: Game, dt: number) {
    if (!sys) return;
    try { sys.frame(dt); } catch (e) { console.error('[critters] frame', e); sys.dispose(); sys = null; }
  },
});
