export { dist2D, dist3, clamp, tl } from '../../core/util';
export { followEnt } from '../../game/views';
import { Sound } from '../../core/audio';

/** First audio key that exists (shops keys are registered at init; core keys may arrive later). */
export function sndKey(...keys: string[]) { return keys.find((k) => Sound.has(k)) ?? keys[0]; }

/** Thai vendors round to 5 baht above 50. */
export function roundPrice(v: number) { return v >= 50 ? Math.max(5, Math.round(v / 5) * 5) : Math.max(1, Math.round(v)); }

export function shuffle<T>(a: T[], r = Math.random): T[] { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
