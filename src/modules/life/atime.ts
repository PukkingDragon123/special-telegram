import type { Game } from '../../game/game';

/* ============================================================================================
 * Ambient clock: a replicated, never-freezing "seconds" counter (g.lifeT) used to drive
 * client-local but deterministic ambient life (crowds, traffic). The host advances it and
 * writes a rounded value once per second; every peer extrapolates smoothly in between.
 * ========================================================================================== */

export class AmbientClock {
  /** smoothed local time (seconds) */
  t = 0;
  private hostT = 0;
  private hostWrite = 0;
  private lastSeen = -1;
  private since = 0;
  private init = false;

  constructor(private game: Game) {}

  /** HOST: advance (called from hostUpdate). Keeps ticking during freezeTime cutscenes. */
  hostTick(dt: number) {
    const g = this.game.g;
    if (g.paused) return;
    if (!this.init) { this.hostT = Number(g.lifeT) || 900 + ((g.seed ?? 0) % 600); this.init = true; g.lifeT = Math.round(this.hostT * 10) / 10; }
    this.hostT += dt;
    this.hostWrite += dt;
    if (this.hostWrite >= 1 || g.lifeT === undefined) { this.hostWrite = 0; g.lifeT = Math.round(this.hostT * 10) / 10; }
  }

  /** Every peer, every frame. */
  frame(dt: number) {
    const game = this.game;
    if (game.isHost) { this.t = this.hostT; return; }
    const v = Number(game.g.lifeT) || 0;
    if (v !== this.lastSeen) { this.lastSeen = v; this.since = 0; } else this.since += dt;
    const target = v + Math.min(this.since, 1.6);
    if (game.g.paused) return;
    if (Math.abs(target - this.t) > 3) this.t = target;
    else this.t += dt + (target - this.t) * Math.min(1, dt * 1.5);
  }

  /** reset on a new session */
  reset() { this.init = false; this.hostT = 0; this.t = 0; this.lastSeen = -1; }
}
