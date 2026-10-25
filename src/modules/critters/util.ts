import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Sound } from '../../core/audio';
import { Assets } from '../../core/assets';

/* Shared bits for the critters module: own sound keys (registered into the Sound manifest at
 * runtime), textures in gen/critters, quality scaling. */

export const GEN = 'gen/critters/';

const SND: Record<string, [string[], number, boolean]> = {
  crit_stomp: [['stomp_squish.mp3'], 0.9, false],
  crit_rat: [['rat_squeak.mp3', 'rat_squeak2.mp3'], 0.6, false],
  crit_fly_loop: [['fly_buzz_loop.mp3'], 0.5, true],
  crit_fly: [['fly_buzz.mp3'], 0.5, false],
  crit_skitter: [['roach_skitter.mp3'], 0.45, false],
  crit_roach_fly: [['roach_fly.mp3'], 0.85, false],
  crit_moth_loop: [['moth_flutter.mp3'], 0.35, true],
  crit_scurry: [['roach_scurry_cartoon.mp3'], 0.5, false],
};

export function registerSounds() {
  const m = Sound.manifest as Record<string, any>;
  for (const [k, [files, vol, loop]] of Object.entries(SND)) {
    if (!m[k]) m[k] = { files: files.map((f) => '../' + GEN + 'audio/' + f), vol, loop, cat: 'sfx', pitchVar: 0.12 };
  }
}

export function tex(file: string): THREE.Texture {
  const t = Assets.texture(GEN + 'tex/' + file, { wrap: false });
  t.anisotropy = 4;
  return t;
}

/** 0.5 (low) … 1.3 (ultra) */
export function qmul(game: Game) {
  const q = (game.engine as any).quality ?? 'high';
  return ({ low: 0.5, medium: 0.75, high: 1, ultra: 1.3 } as Record<string, number>)[q] ?? 1;
}

/** 0 day … 1 night */
export function night(game: Game): number {
  const w = game.world as any;
  if (w && typeof w.night === 'number') return w.night;
  return game.clock?.nightFactor ?? 0;
}

/** shared billboard vertex chunk: expands a unit quad (position.xy in -0.5..0.5) around an instance centre */
export const BILLBOARD_VERT = /* glsl */`
  vec4 mvC = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sz = length(instanceMatrix[0].xyz);
`;
