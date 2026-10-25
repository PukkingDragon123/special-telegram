import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { F } from '../../core/fonts';
import { tl } from '../../core/util';
import { SKILL, BRANCH_NAME, XpSkill, levels, levelOf, skillState } from './skills';
import { Sparkles, headPos } from './fx';
import { pick } from './lines';
import { bump, isPlayer } from './state';

/* ============================================================================================
 * XP → LEVELS → SKILL POINTS, skill unlocking, and the skill effects core can't express:
 *   pl.lv = {cook, prep, serve, clean} (replicated), pl.sp += 1 per level gained.
 *   intent 'skill.unlock' {id} → pl.skills += id, pl.sp -= cost.
 *   events 'social:levelup' {id, skill, lv} · 'social:unlock' {id, skill}
 * game.skillMul is wrapped: high-five "hype" buff ×1.15, sore back (slept on concrete) ×0.9 until 09:00.
 * game.items.speedMul is wrapped: 'carry_fast' removes 60 % of the load slowdown.
 * ========================================================================================== */

export function installProgress(game: Game, sparks: Sparkles) {
  // ------------------------------------------------------------------ skill effect patches
  const baseMul = game.skillMul.bind(game);
  game.skillMul = (pl: Ent | undefined | null, action: string) => {
    let m = baseMul(pl, action);
    if (pl?.hype) m *= 1.15;
    if (pl?.sore && (game.g.time ?? 7) < 9) m *= 0.9;
    return m;
  };
  const items: any = game.items;
  const baseSpeed = items.speedMul.bind(items);
  items.speedMul = (pl: Ent) => {
    const s = baseSpeed(pl);
    if (!game.hasSkill(pl, 'carry_fast')) return s;
    return s + (1 - s) * 0.6;
  };

  // ------------------------------------------------------------------ HOST: levels
  const check = (pl: Ent) => {
    const lv = levels(pl);
    const prev = pl.lv ?? { cook: 1, prep: 1, serve: 1, clean: 1 };
    let gained = 0;
    for (const k of ['cook', 'prep', 'serve', 'clean'] as XpSkill[]) {
      const d = lv[k] - (prev[k] ?? 1);
      if (d > 0) {
        gained += d;
        game.emit('social:levelup', { id: pl.id, skill: k, lv: lv[k] });
        bump(game, 'levelups', d);
      }
    }
    if (gained > 0 || !pl.lv) {
      pl.lv = lv;
      if (gained > 0) pl.sp = (pl.sp ?? 0) + gained;
    }
  };
  game.events.on('xp', (d: { player: number }) => {
    if (!game.isHost) return;
    const pl = game.state.get(d.player);
    if (isPlayer(pl)) check(pl);
  });
  game.events.on('player:joined', (pl: Ent) => { if (game.isHost && isPlayer(pl)) check(pl); });

  game.onIntent('skill.unlock', (pl, d: { id: string }) => {
    const s = SKILL.get(d?.id);
    if (!s) return;
    if (skillState(pl, s).st !== 'ready') return;
    pl.skills = [...(pl.skills ?? []), s.id];
    pl.sp = (pl.sp ?? 0) - s.cost;
    game.emit('social:unlock', { id: pl.id, skill: s.id });
  });

  // ------------------------------------------------------------------ ALL: fanfare + popup
  game.on('social:levelup', (d: { id: number; skill: XpSkill; lv: number }) => {
    const p = headPos(game, d.id);
    if (!p) return;
    p.y += 0.35;
    Sound.play('level_up_fanfare', { pos: p, vol: 0.9 });
    sparks.burst(p, 50, { color: 0xffe28a, color2: 0xfff6d8, speed: 2.2, size: 0.055, life: 1.2, up: 1.2 });
    game.ui.popup(p.clone(), `เลเวลอัป! ${BRANCH_NAME[d.skill].th} Lv.${d.lv}`, { style: { font: F.heavy, size: 66, weight: 800, color: '#ffe066', stroke: '#2a1408', strokeWidth: 9, shadow: 'rgba(0,0,0,0.5)', shadowBlur: 12 }, dur: 2.6, rise: 0.9, scale: 1.1 });
    if (d.id === game.localPlayerId) {
      game.ui.popup(p.clone().add(new THREE.Vector3(0, -0.22, 0)), '+1 แต้มสกิล · กด Tab ขึ้นสวรรค์สกิล', { style: { font: F.ui, size: 40, weight: 700, color: '#fff7e0', stroke: '#2a1408', strokeWidth: 6 }, dur: 3, rise: 0.6 });
      game.interact.hintOnce('social_tab', 'มีแต้มสกิล! กด [Tab] มองฟ้า… ขึ้นสวรรค์สกิล (skill heaven)', 6);
    }
  });
  game.on('social:unlock', (d: { id: number; skill: string }) => {
    const s = SKILL.get(d.skill);
    const p = headPos(game, d.id);
    if (!p || !s) return;
    if (d.id !== game.localPlayerId) {
      // others only hear a little ding over the thinker
      Sound.play('sparkle_chime', { pos: p, vol: 0.5 });
    }
  });
}

/** Thai label of a player's levels for UI. */
export function levelLine(pl: Ent) {
  const xp = pl.xp ?? {};
  return (['cook', 'prep', 'serve', 'clean'] as XpSkill[]).map((k) => `${BRANCH_NAME[k].th} ${levelOf(k, xp[k] ?? 0)}`).join(' · ');
}
export { tl, pick };
