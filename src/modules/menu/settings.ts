import type { Game } from '../../game/game';
import type { Quality } from '../../core/postfx';
import { Sound } from '../../core/audio';
import { Input } from '../../core/input';

/** Player settings (quality / master volume / mouse sensitivity), persisted per browser. */
export interface Settings { volume: number; sens: number }
const KEY = 'hp.settings';
const BASE_SENS = 0.0022;

export function loadSettings(): Settings {
  let s: any = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  return { volume: clamp01(s?.volume ?? 0.8), sens: Math.max(0.2, Math.min(2, s?.sens ?? 1)) };
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function applySettings(s: Settings) {
  Sound.setBusVolume('master', 0.9 * s.volume);
  Input.sensitivity = BASE_SENS * s.sens;
}
export function setQuality(game: Game, q: Quality) { game.engine.setQuality(q); }
export const QUALITIES: { q: Quality; th: string; en: string }[] = [
  { q: 'low', th: 'ประหยัด', en: 'LOW' }, { q: 'medium', th: 'กลางๆ', en: 'MEDIUM' }, { q: 'high', th: 'สวย', en: 'HIGH' }, { q: 'ultra', th: 'สวยสุดๆ', en: 'ULTRA' },
];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
