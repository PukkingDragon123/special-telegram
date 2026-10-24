import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SoundHandle } from '../../core/audio';
import { bump } from './util';
import { loop, play, hasSound } from './sounds';
import type { Life } from './index';

/* ============================================================================================
 * AMBIENCE AUDIO ZONES & TIME (client-local). Positional beds that slide along their zone to
 * the nearest point to the listener (traffic rides the main road, market chatter sits in the
 * market shed, cicadas in the trees, crickets/frogs at the canal & rice fields, TV & luk-thung
 * radio from shophouses) + 2D day/night beds + timed one-shots (tokay gecko at night, roosters
 * at dawn, temple bells morning & evening, far dogs howling, sirens, crows).
 * ========================================================================================== */

interface Layer { name: string; vol: (h: number, cam: THREE.Vector3) => number; pos?: (cam: THREE.Vector3) => THREE.Vector3; ref?: number; max?: number; h?: SoundHandle | null; cur: number }

const clampX = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const nearestOf = (cam: THREE.Vector3, pts: [number, number, number][]) => {
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = (p[0] - cam.x) ** 2 + (p[2] - cam.z) ** 2; if (d < bd) { bd = d; best = p; } }
  return new THREE.Vector3(best[0], best[1], best[2]);
};
const fall = (d: number, r: number) => Math.max(0, 1 - d / r);

export class Ambience {
  private layers: Layer[] = [];
  private t = 0;
  private oneT: Record<string, number> = {};
  private built = false;

  constructor(private game: Game, private life: Life) {}

  build() {
    if (this.built) return;
    this.built = true;
    const night = (h: number) => this.game.clock.nightFactor;
    const day = (h: number) => 1 - this.game.clock.nightFactor;
    this.layers = [
      { name: 'amb_traffic', cur: 0, ref: 12, max: 160, pos: (c) => new THREE.Vector3(clampX(c.x, -130, 130), 1, 14),
        vol: (h, c) => (0.35 + bump(h, 7.8, 1.2, 0.4) + bump(h, 18, 1.5, 0.45) - (h > 22 ? (h - 22) * 0.2 : 0)) * fall(Math.abs(c.z - 14), 140) },
      { name: 'amb_day', cur: 0, vol: (h) => 0.38 * day(h) },
      { name: 'amb_night', cur: 0, vol: (h) => 0.45 * night(h) },
      { name: 'amb_birds', cur: 0, vol: (h) => 0.35 * bump(h, 7, 1.1) },
      { name: 'amb_market', cur: 0, ref: 8, max: 70, pos: (c) => new THREE.Vector3(clampX(c.x, 8, 48), 1.5, clampX(c.z, -78, -42)),
        vol: (h) => (h < 14.5 ? 0.85 + bump(h, 7.5, 1.3, 0.3) : 0.08) },
      { name: 'amb_chatter', cur: 0, ref: 6, max: 45, pos: () => new THREE.Vector3(-30, 1.5, 2), vol: (h) => 0.25 + bump(h, 12.1, 0.8, 0.6) + bump(h, 17.8, 0.8, 0.4) },
      { name: 'amb_cicadas', cur: 0, ref: 10, max: 80, pos: (c) => nearestOf(c, [[-19, 6, -86], [40, 6, -120], [-12, 6, -152], [30, 5, -210], [-40, 5, -230]]), vol: (h) => 0.6 * bump(h, 14, 2.0) * day(h) },
      { name: 'amb_crickets', cur: 0, ref: 10, max: 90, pos: (c) => nearestOf(c, [[clampX(c.x, -120, 120), 0, -168], [clampX(c.x, -120, 120), 0, -215], [-19, 0, -86]]), vol: (h) => 0.75 * night(h) },
      { name: 'amb_tv', cur: 0, ref: 3, max: 22, pos: (c) => nearestOf(c, [[-7.5, 2.5, -62], [7.5, 2.5, -104], [-7.5, 2.5, -118], [7.5, 2.5, -136]]), vol: (h) => (h > 16 && h < 23.5 ? 0.55 : 0.12) },
      { name: 'amb_radio', cur: 0, ref: 3, max: 26, pos: () => new THREE.Vector3(-7.5, 1.5, -36), vol: (h) => (h > 7 && h < 20 ? 0.5 : 0) },
    ].filter((l) => hasSound(l.name)) as Layer[];
  }

  dispose() {
    for (const l of this.layers) { l.h?.stop(0.5); l.h = null; }
    this.layers = [];
    this.built = false;
  }

  frame(dt: number) {
    if (!this.built) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const game = this.game;
    const h = game.clock.time;
    const cam = game.camera.getWorldPosition(new THREE.Vector3());
    for (const l of this.layers) {
      const want = Math.max(0, Math.min(1.2, l.vol(h, cam)));
      l.cur += (want - l.cur) * 0.25;
      if (l.cur > 0.02 && !l.h) l.h = loop(l.name, { vol: 0, bus: 'amb', pos: l.pos ? l.pos(cam) : undefined, ref: l.ref, max: l.max });
      if (l.h) {
        l.h.setVolume(l.cur, 0.4);
        if (l.pos) l.h.setPos(l.pos(cam));
        if (l.cur < 0.01) { l.h.stop(1.2); l.h = null; }
      }
    }
    this.oneShots(h, cam);
  }

  private every(key: string, min: number, max: number): boolean {
    const now = this.life.clock.t;
    if (this.oneT[key] === undefined) { this.oneT[key] = now + Math.random() * max; return false; }
    if (now < this.oneT[key]) return false;
    this.oneT[key] = now + min + Math.random() * (max - min);
    return true;
  }

  private oneShots(h: number, cam: THREE.Vector3) {
    const around = (r: number, y = 2.5) => cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 2, y, (Math.random() - 0.5) * r * 2));
    const nightF = this.game.clock.nightFactor;
    if (nightF > 0.5 && this.every('gecko', 18, 45)) play('gecko', { pos: around(18, 3.5), vol: 0.8, ref: 4, max: 40 });
    if (h < 7.6 && this.every('rooster', 9, 25)) play('rooster', { pos: new THREE.Vector3(cam.x + 30, 1, Math.min(cam.z - 40, -190)), vol: 0.9, ref: 10, max: 160 });
    if ((bump(h, 6.8, 0.6) > 0.3 || bump(h, 17.6, 0.5) > 0.3) && this.every('temple', 25, 50)) play('temple_bell', { pos: new THREE.Vector3(40, 6, -125), vol: 0.8, ref: 15, max: 180 });
    if (nightF > 0.6 && this.every('howl', 40, 90)) play(Math.random() < 0.5 ? 'howl' : 'bark', { pos: around(60, 1), vol: 0.35, ref: 8, max: 120 });
    if (this.every('siren', 120, 300)) play('siren', { vol: 0.35 });
    if (nightF < 0.3 && this.every('crow', 30, 80)) play('crow', { pos: around(25, 6), vol: 0.5, ref: 6, max: 60 });
    if (nightF < 0.3 && this.every('pigeons', 40, 90)) play('pigeons', { pos: around(15, 5), vol: 0.4, ref: 4, max: 30 });
  }
}
