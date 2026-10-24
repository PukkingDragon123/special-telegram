import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { params, tl } from '../../core/util';
import { AmbientClock } from './atime';
import { loadLifeSounds } from './sounds';
import { loadLines } from './lines';
import { Pets, DogAPI } from './pets';
import { Homeless } from './homeless';
import { Ghosts } from './ghosts';
import { Crowd } from './crowd';
import { Traffic } from './traffic';
import { Ambience } from './ambience';
import { Eggs } from './eggs';
import { defineLifeItems } from './items';
import { anchorP } from './util';

/* ============================================================================================
 * MODULE `life` — the neighbourhood is ALIVE: ambient crowds & traffic (client-local,
 * deterministic from g.seed + g.lifeT), the stray dog & cat (t:'dog' / t:'cat'), the homeless
 * man (npc role 'homeless'), Thai ghosts at night (t:'ghost'), ambience audio zones and Thai
 * meme easter eggs.
 *
 * Public hub: (game as any).life  →  { dog: DogAPI, pets, ghosts, crowd, traffic, homeless,
 *   tipMul(), luck(playerId) }      (see each file for details)
 * Dev: ?lifelab (dog/cat/homeless near spawn + dog food in hand) · ?time=22 · ?ghost=moto|krasue|tani|pret|white
 *      ?crowd=0 · ?traffic=0 · ?amb=0
 * ========================================================================================== */

export class Life {
  readonly clock: AmbientClock;
  readonly pets: Pets;
  readonly dog: DogAPI;
  readonly homeless: Homeless;
  readonly ghosts: Ghosts;
  readonly crowd: Crowd;
  readonly traffic: Traffic;
  readonly ambience: Ambience;
  readonly eggs: Eggs;
  readonly lab = params.has('lifelab');
  built = false;

  constructor(readonly game: Game) {
    this.clock = new AmbientClock(game);
    this.pets = new Pets(game, this);
    this.dog = new DogAPI(this.pets, game);
    this.homeless = new Homeless(game, this);
    this.ghosts = new Ghosts(game, this);
    this.crowd = new Crowd(game, this);
    this.traffic = new Traffic(game, this);
    this.ambience = new Ambience(game, this);
    this.eggs = new Eggs(game, this);
  }

  /** Restaurant hook: tip multiplier from the homeless man's blessing / merit (1 = none). */
  tipMul(): number { return this.homeless.tipMul(); }
  /** Per-player luck 0..1 (merit from giving / feeding the pret). */
  luck(playerId: number): number { return this.homeless.luck(playerId); }
  /** Nearest visible ghost within r metres (or null). */
  ghostNear(p: ArrayLike<number>, r: number): Ent | null { return this.ghosts.near(p, r); }
  cat() { return this.pets.cat(); }
}

let life: Life | null = null;

export default defineModule({
  id: 'life',
  deps: ['characters', 'world', 'cooking', 'restaurant'],

  async init(game: Game) {
    life = new Life(game);
    (game as any).life = life;
    await Promise.all([loadLifeSounds(), loadLines()]);
    defineLifeItems(game);
    life.pets.init();
    life.homeless.init();
    life.ghosts.init();
    life.crowd.init();
    life.eggs.init();
    game.events.on('net:session', () => life?.clock.reset());
    game.events.on('world:ready', () => onWorldReady(game));
    game.events.on('world:exit', () => {
      if (!life) return;
      life.built = false;
      life.crowd.dispose();
      life.traffic.dispose();
      life.ambience.dispose();
      life.ghosts.disposeLocal();
      life.eggs.dispose();
    });
  },

  async buildWorld(game: Game) {
    if (!life) return;
    // static-ish world dressing (every peer)
    try { await life.eggs.build(); } catch (e) { console.error('[life] eggs', e); }
  },

  hostUpdate(game: Game, dt: number) {
    if (!life || game.g.scene !== 'world') return;
    life.clock.hostTick(dt);
    if (!life.built) return;
    life.pets.hostUpdate(dt);
    life.homeless.hostUpdate(dt);
    life.ghosts.hostUpdate(dt);
  },

  frame(game: Game, dt: number) {
    if (!life || !life.built || !game.scene) return;
    life.clock.frame(dt);
    const safe = (n: string, f: () => void) => { try { f(); } catch (e) { console.error('[life] ' + n, e); } };
    safe('crowd', () => life!.crowd.frame(dt));
    safe('traffic', () => life!.traffic.frame(dt));
    safe('ghosts', () => life!.ghosts.frame(dt));
    safe('ambience', () => life!.ambience.frame(dt));
    safe('eggs', () => life!.eggs.frame(dt));
  },

  onNewDay(game: Game, day: number) {
    if (!life) return;
    life.pets.onNewDay(day);
    life.homeless.onNewDay(day);
    life.ghosts.onNewDay(day);
  },
});

function onWorldReady(game: Game) {
  if (!life) return;
  const L = life;
  // dev: ?time=22 (host)
  const tp = params.get('time');
  if (tp && game.isHost && Number.isFinite(+tp)) game.g.time = Math.max(6, Math.min(23.9, +tp));
  if (game.isHost) {
    L.pets.hostEnsure();
    L.homeless.hostEnsure();
  }
  if (params.get('crowd') !== '0') L.crowd.build();
  if (params.get('traffic') !== '0') L.traffic.build();
  if (params.get('amb') !== '0') L.ambience.build();
  L.ghosts.buildLocal();
  L.built = true;
  if (L.lab && game.isHost) setTimeout(() => lifeLab(game), 400);
  const gq = params.get('ghost');
  if (gq && game.isHost) setTimeout(() => L.ghosts.debugSpawn(gq), 1200);
}

/** ?lifelab — bring the animals and the homeless man next to the spawn for quick tests. */
function lifeLab(game: Game) {
  if (!life) return;
  const me = game.me;
  const sp = me?.p ? new THREE.Vector3(me.p[0], me.p[1], me.p[2]) : anchorP(game, 'player_spawn', [-4.6, 0.15, -21]);
  const yaw = me?.yaw ?? -Math.PI / 2;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = (f: number, r: number) => sp.clone().addScaledVector(fwd, f).addScaledVector(right, r);
  const dog = life.dog.ensure();
  if (dog) { game.npcs.stop(dog); const p = at(2.4, -0.7); dog.p = [p.x, p.y, p.z]; dog.yaw = yaw + Math.PI * 0.6; dog.st = 'sit'; }
  const cat = life.pets.cat();
  if (cat) { game.npcs.stop(cat); const p = at(2.6, 0.9); cat.p = [p.x, p.y, p.z]; cat.yaw = yaw - Math.PI * 0.7; cat.st = 'sit'; }
  life.homeless.labMove(at(3.0, 1.4));
  if (me) { game.items.give(me, 'dog_food'); game.items.give(me, 'dog_food'); }
  console.info('[life] lifelab ready', tl('หมา แมว ลุง มาแล้ว').th);
}
