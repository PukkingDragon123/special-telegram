import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Sound } from '../../core/audio';
import { Sparkles, SweatDrops, updateDecals, clearDecals } from './fx';
import { installProgress } from './progress';
import { installActions, updateRadial, closeRadial, radialOpen } from './actions';
import { preloadRadialImages } from './radial';
import { installTug, installTugEndFx } from './tug';
import { installThink, ThinkCtl } from './think';
import { installSleep, recipesFor } from './sleep';
import { installSave } from './save';
import { buildMoney } from './money';
import { FlyText } from './flytext';
import { F } from '../../core/fonts';
import { SKILLS, SKILL_IDS, levels } from './skills';
import { hostTimers, localTimers, READING_MODES, anim } from './state';

/* ============================================================================================
 * MODULE: social — right-click social (slap / high-five / give money), snatch tug-of-war, XP
 * levels + the skill-tree thought cloud (Tab), cardboard sleeping + day transition + morning
 * newspaper, recipe unlock schedule (g.unlocks), day stats history, save/load.
 *
 *   player.mode: 'think' · 'tug' · 'sleep' · 'down' (just lost a tug)   (others: 'free')
 *   skill ids (game.hasSkill / game.skillMul): see skills.ts SKILL_IDS
 *   API: (game as any).social = { skills, skillIds, levels(pl), money(amount), recipesFor(day) }
 *        (game as any).save = { has, load, clear, save, info }
 * ========================================================================================== */

const SOUNDS: Record<string, any> = {
  social_crowd_ouch: { files: ['../gen/social/audio/crowd_ouch_1.mp3', '../gen/social/audio/crowd_ouch_2.mp3'], vol: 0.85, cat: 'sfx', pitchVar: 0.06, desc: 'Crowd "ouch!" reaction (Freesound #324897, CC0).' },
};

let sparks: Sparkles;
let sweat: SweatDrops;
let think: ThinkCtl;
let tug: ReturnType<typeof installTug>;
let sleep: ReturnType<typeof installSleep>;

function knockOut(game: Game, v: Ent, reason: string) {
  if (reason === 'think' && v.mode === 'think') { v.mode = 'free'; game.emit('social:think', { id: v.id, on: false }); }
  else if (READING_MODES.includes(reason) && READING_MODES.includes(v.mode)) { v.mode = 'free'; game.emit('social:interrupt', { id: v.id, reason: 'slap' }); }
  else if (reason === 'sleep' && v.mode === 'sleep') {
    const ph = game.g.night?.phase ?? 'none';
    if (ph === 'dream' || ph === 'morning') return;
    const b = game.state.get(v.bed);
    if (b?.data?.by === v.id) b.data = { ...b.data, by: null };
    v.bed = null;
    v.mode = 'free';
    anim(v, 'wake_up');
  }
}

export default defineModule({
  id: 'social',
  deps: ['characters', 'world', 'cooking'],
  init(game) {
    Object.assign(Sound.manifest, Object.fromEntries(Object.entries(SOUNDS).filter(([k]) => !Sound.manifest[k])));
    preloadRadialImages();
    sparks = new Sparkles();
    sweat = new SweatDrops();
    const saveApi = installSave(game);
    installProgress(game, sparks);
    installActions(game, sparks, (v, reason) => knockOut(game, v, reason));
    tug = installTug(game, sparks, sweat);
    installTugEndFx(game, sparks);
    think = installThink(game, sparks, () => {
      const me = game.me;
      if (!me || radialOpen()) return false;
      const ph = game.g.night?.phase ?? 'none';
      return (!me.mode || me.mode === 'free') && ph !== 'dream' && ph !== 'morning';
    });
    game.on('social:unlock', (d: any) => think.onUnlock(d));
    sleep = installSleep(game, sparks, () => saveApi.save());
    (game as any).social = {
      skills: SKILLS, skillIds: SKILL_IDS, levels: (pl: Ent) => levels(pl), money: (amount: number) => buildMoney(amount),
      recipesFor: (day: number) => recipesFor(game, day), think: () => think.active, _thinkDebug: () => (think as any).debug, _FlyText: FlyText, _F: F,
    };
    game.events.on('world:exit', () => { think.dispose(); sleep.dispose(); closeRadial(); clearDecals(); localTimers.clear(); });
  },
  buildWorld(game) {
    game.scene?.add(sparks.points);
    game.scene?.add(sweat.group);
    sleep.buildWorld();
    if (game.isHost) {
      const g = game.g;
      const day = g.day ?? 1;
      if (!Array.isArray(g.unlocks?.recipes) || !g.unlocks.recipes.length) g.unlocks = { ...(g.unlocks ?? {}), recipes: recipesFor(game, day) };
      g.night ??= { phase: 'none', late: 0, t: 0 };
    }
  },
  hostUpdate(game, dt) {
    hostTimers.update(dt);
    tug.hostUpdate(dt);
    sleep.hostUpdate(dt);
  },
  frame(game, dt) {
    if (!game.scene) return;
    localTimers.update(dt);
    sparks.update(dt);
    sweat.update(dt);
    updateDecals(game, dt);
    updateRadial(dt);
    think.frame(dt);
    tug.frame(dt);
    sleep.frame(dt);
  },
  onNewDay(game, day) {
    const g = game.g;
    const have: string[] = Array.isArray(g.unlocks?.recipes) ? g.unlocks.recipes : [];
    const all = recipesFor(game, day);
    const fresh = all.filter((r) => !have.includes(r));
    // new pages are handed over by the old man in the morning (sleep.ts); fallback unlock at 10:00
    if (fresh.length) g.pendingRecipes = [...new Set([...(g.pendingRecipes ?? []), ...fresh])];
  },
});
