import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';

/* ============================================================================================
 * Small shared helpers for the social module: timers (host + local), per-day social counters
 * (g.social → merged into the newspaper stats), mode helpers.
 * ========================================================================================== */

export class Timers {
  private list: { t: number; fn: () => void }[] = [];
  now = 0;
  after(sec: number, fn: () => void) { this.list.push({ t: this.now + sec, fn }); }
  update(dt: number) {
    this.now += dt;
    if (!this.list.length) return;
    const due = this.list.filter((x) => x.t <= this.now);
    if (!due.length) return;
    this.list = this.list.filter((x) => x.t > this.now);
    for (const d of due) { try { d.fn(); } catch (e) { console.error('[social timer]', e); } }
  }
  clear() { this.list = []; }
}

/** HOST timers (run in hostUpdate) and LOCAL timers (run in frame). */
export const hostTimers = new Timers();
export const localTimers = new Timers();

/** Modes where a player is "busy" with a social / module activity. */
export const READING_MODES = ['book', 'read', 'reading', 'recipe'];

export function isPlayer(e: Ent | undefined | null): e is Ent { return !!e && e.t === 'player'; }

/** HOST: bump a per-day social counter (g.social.<k>). */
export function bump(game: Game, k: string, n = 1) {
  const s = { slaps: 0, highfives: 0, hanging: 0, given: 0, tugs: 0, passedOut: 0, levelups: 0, ...(game.g.social ?? {}) };
  s[k] = (s[k] ?? 0) + n;
  game.g.social = s;
}

export function dist2(a?: number[], b?: number[]) {
  if (!a || !b) return Infinity;
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** HOST: play an animation on a player/npc entity. */
export function anim(e: Ent, name: string, loop = false) {
  e.anim = name;
  e.animLoop = loop;
  e.animT = (e.animT ?? 0) + 1 + Math.random() * 0.001;
}
