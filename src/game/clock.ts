import * as THREE from 'three';
import { params } from '../core/util';
import type { Game } from './game';

/**
 * In-game clock. One playable day = 06:00 → 24:00 (18 game hours) in 20 real minutes,
 * i.e. 1 game hour ≈ 66.7 real seconds. Replicated as g.time (hours, float) and g.day.
 * At 24:00 time stops and 'day:midnight' fires once (progression module puts everyone to sleep).
 */
export const DAY_START = 6;
export const DAY_END = 24;
export const REAL_SECONDS_PER_DAY = 20 * 60;
export const HOURS_PER_SECOND = (DAY_END - DAY_START) / REAL_SECONDS_PER_DAY;

export class Clock {
  /** debug speed-up: ?timescale=20 */
  speed = Number(params.get('timescale') ?? 1) || 1;
  private midnightFired = -1;
  constructor(private game: Game) {}

  get time(): number { return this.game.g.time ?? 7; }
  get day(): number { return this.game.g.day ?? 1; }
  get hour() { return Math.floor(this.time); }
  get minute() { return Math.floor((this.time % 1) * 60); }
  /** "08:30" */
  label() { return `${String(this.hour % 24).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`; }
  /** 0 at 06:00 … 1 at 24:00 */
  get dayProgress() { return (this.time - DAY_START) / (DAY_END - DAY_START); }
  get isNight() { return this.time >= 19 || this.time < 5.5; }
  get isDusk() { return this.time >= 17.5 && this.time < 19.5; }
  /** 0 = full day … 1 = full night (smooth). */
  get nightFactor() {
    const t = this.time;
    if (t < 17.8) return t < 6.3 ? 1 - (t - 5.5) / 0.8 : 0;
    return Math.min(1, (t - 17.8) / 1.6);
  }
  /** Lunch rush etc. (customer flow multiplier) */
  get rush() {
    const t = this.time;
    const bump = (c: number, w: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w));
    return 0.35 + bump(7.5, 0.8, 0.6) + bump(12.1, 0.7, 1.2) + bump(18.6, 0.9, 1.0) + bump(21.5, 0.8, 0.35);
  }

  /** Sun direction (from ground toward sun) for the current time. Bangkok ~13.7°N. */
  sunDir(out = new THREE.Vector3()) {
    const t = this.time;
    const h = ((t - 6.2) / 12.3) * Math.PI; // 0 at sunrise, π at sunset
    const elev = Math.sin(h) * (Math.PI / 2 - 0.42);
    const az = Math.PI * 0.5 - h; // east → south-ish → west
    out.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.5 + 0.35).normalize();
    return out;
  }

  /** HOST */
  hostAdvance(dt: number) {
    const g = this.game.g;
    if (g.scene !== 'world' || g.freezeTime) return;
    if (g.time === undefined) g.time = 7;
    if (g.time >= DAY_END) {
      if (this.midnightFired !== g.day) {
        this.midnightFired = g.day;
        this.game.events.emit('day:midnight', g.day);
      }
      return;
    }
    const before = g.time;
    g.time = Math.min(DAY_END, g.time + dt * HOURS_PER_SECOND * this.speed);
    if (Math.floor(before) !== Math.floor(g.time)) this.game.events.emit('clock:hour', Math.floor(g.time));
  }

  /** HOST: start a new day (called by progression after sleep). */
  newDay() {
    const g = this.game.g;
    g.day = (g.day ?? 1) + 1;
    g.time = DAY_START + 0.5;
    this.midnightFired = -1;
    for (const m of this.game.modules) {
      try { m.onNewDay?.(this.game, g.day); } catch (e) { console.error(`[module ${m.id}] onNewDay`, e); }
    }
    this.game.events.emit('day:new', g.day);
  }
}
