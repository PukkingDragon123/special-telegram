import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { params, tl, TL } from '../../core/util';
import { RECIPES, DEFAULT_UNLOCKED } from '../cooking/recipes';
import { Quests, QuestDef, QuestState, setUnlockRecipe, unlockRecipe } from './api';

/* ============================================================================================
 * HOST quest state machine + recipe unlocks.
 *   g.quests[id] = { id, status, step, t0, data }   (replicated, saved with g)
 *   intents: quest.start {id} · quest.op {id, op, data} · quest.buyRecipe {id, price, from}
 *            talk.begin {eid} · talk.end {eid} · talk.act {eid, anim, face}
 *   events (all peers): quest:start {id, by} · quest:step {id, step} · quest:done {id, by, money, recipes, items, note}
 *                       unlock:recipe {recipes, source}
 * ========================================================================================== */

export function questState(game: Game, id: string): QuestState | null {
  return ((game.g as any).quests ?? {})[id] ?? null;
}

export function unlocked(game: Game): string[] {
  const u = (game.g as any).unlocks?.recipes;
  return Array.isArray(u) && u.length ? u : DEFAULT_UNLOCKED;
}

/** day-gating etc. + every quest is available with ?quests=all */
export function questAvailable(game: Game, def: QuestDef): boolean {
  if (questState(game, def.id)) return false;
  if (params.get('quests') === 'all') return true;
  const g: any = game.g;
  if (g.introStep && g.introStep !== 'done') return false;
  try { return def.available ? !!def.available(game) : true; } catch { return false; }
}

export function sourceText(source: string): TL {
  if (source.startsWith('quest:')) {
    const d = Quests.get(source.slice(6));
    return d ? tl(`จากภารกิจ "${d.title.th}"`, `from the quest "${d.title.en ?? d.title.th}"`) : tl('จากภารกิจ', 'from a quest');
  }
  switch (source) {
    case 'oldman': return tl('ลุงเจ้าของรถเข็นเอาหน้ากระดาษมาให้', 'the old cart owner brought the page');
    case 'restaurant': return tl('ฉลองเปิดร้านจริง!', 'celebrating the real restaurant!');
    case 'level': return tl('ฝีมือทำอาหารเลเวลอัป', 'your cooking levelled up');
    case 'rep': return tl('ร้านดังขึ้น ★4 ขึ้นไป', 'the shop hit ★4 reputation');
    case 'bought': return tl('ซื้อสูตรลับมา', 'bought the secret recipe');
    case 'ghost': return tl('ผีบอกสูตร (จริงๆ นะ)', 'a ghost whispered it (really)');
    default: return tl('ได้สูตรใหม่', 'new recipe');
  }
}

export class QuestHost {
  private acc = 0;
  constructor(private game: Game) {}

  private Q(): Record<string, QuestState> {
    const g: any = this.game.g;
    if (!g.quests || typeof g.quests !== 'object') g.quests = {};
    return g.quests;
  }
  private set(st: QuestState) { const q = this.Q(); (this.game.g as any).quests = { ...q, [st.id]: { ...st } }; }

  install() {
    const game = this.game;
    // the real unlockRecipe: menu entry, newspaper line, announcement with the source
    setUnlockRecipe((g2: Game, id: string, source = 'quest') => this.unlockRecipeHost(g2, id, source));
    game.onIntent('quest.start', (pl, d: { id: string }) => { this.start(d?.id, pl); });
    game.onIntent('quest.op', (pl, d: { id: string; op: string; data?: any }) => {
      const def = Quests.get(d?.id);
      const st = questState(game, d?.id);
      if (!def || !st || st.status !== 'active') return;
      const fn = def.ops?.[d.op];
      if (!fn) return;
      let r: boolean | void = false;
      try { r = fn(game, pl, d.data, { ...st, data: { ...(st.data ?? {}) } }); } catch (e) { console.error('[quests] op', d.op, e); }
      if (r) this.advance(d.id);
    });
    game.onIntent('quest.buyRecipe', (pl, d: { id: string; price: number; from?: string }) => {
      if (!RECIPES[d?.id] || unlocked(game).includes(d.id)) return;
      const price = Math.max(0, Math.round(d.price ?? 0));
      if (!game.money(pl.id, -price, 'recipe:' + d.id)) { game.say(pl.id, tl('ตังค์ไม่พอ…', 'not enough money…'), { duration: 2 }); return; }
      unlockRecipe(game, d.id, 'bought');
    });
    game.onIntent('talk.begin', (pl, d: { eid: number }) => {
      const e = game.state.get(d?.eid);
      if (!e) return;
      e.lookAt = pl.id;
      e._talkBy = pl.id;
      if (e.t === 'npc' && e.p && pl.p) {
        // turn to face the player (most NPC brains leave yaw alone while idle)
        e.yaw = Math.round(Math.atan2(pl.p[0] - e.p[0], pl.p[2] - e.p[2]) * 1000) / 1000;
      }
      if (e.t === 'npc' && (!e.anim || e.anim === 'idle' || e.anim === 'talk')) this.anim(e, 'talk', true);
    });
    game.onIntent('talk.end', (pl, d: { eid: number }) => {
      const e = game.state.get(d?.eid);
      if (!e || e._talkBy !== pl.id) return;
      e._talkBy = undefined;
      if (e.lookAt === pl.id) e.lookAt = null;
      if (e.t === 'npc' && e.anim === 'talk') this.anim(e, 'idle', true);
    });
    game.onIntent('talk.act', (pl, d: { eid: number; anim?: string; face?: string }) => {
      const e = game.state.get(d?.eid);
      if (!e || e.t !== 'npc') return;
      if (d.anim) this.anim(e, d.anim, d.anim === 'talk' || d.anim === 'idle');
      if (d.face) { e.face = d.face; const fid = e.id; setTimeout(() => { const n = game.state.get(fid); if (n && n.face === d.face) n.face = 'neutral'; }, 2600); }
    });
    // level-up and reputation sources
    game.on('social:levelup', (d: { id: number; skill: string; lv: number }) => {
      if (!game.isHost || d.skill !== 'cook') return;
      const gates: [number, string][] = [[4, 'phat_si_io'], [5, 'rat_na'], [6, 'tom_yam']];
      for (const [lv, id] of gates) if (d.lv >= lv) unlockRecipe(game, id, 'level');
    });
  }

  private anim(e: Ent, anim: string, loop: boolean) {
    e.anim = anim; e.animT = (this.game.g.time ?? 0) + Math.random(); e.animLoop = loop;
  }

  // ------------------------------------------------------------------ quest lifecycle

  start(id: string, pl?: Ent | null): boolean {
    const game = this.game;
    const def = Quests.get(id);
    if (!def || !questAvailable(game, def)) return false;
    const st: QuestState = { id, status: 'active', step: 0, t0: Math.round(game.engine.time), data: {} };
    this.set(st);
    try { def.onStart?.(game, questState(game, id)!, pl ?? game.players()[0]); } catch (e) { console.error('[quests] onStart', id, e); }
    game.emit('quest:start', { id, by: pl?.id ?? null });
    return true;
  }

  advance(id: string, data?: Record<string, any>) {
    const st = questState(this.game, id);
    const def = Quests.get(id);
    if (!st || !def || st.status !== 'active') return;
    const next = { ...st, step: st.step + 1, data: { ...(st.data ?? {}), ...(data ?? {}) } };
    if (next.step >= def.steps.length) { this.set(next); this.complete(id); return; }
    this.set(next);
    this.game.emit('quest:step', { id, step: next.step });
  }

  complete(id: string, by?: Ent | null) {
    const game = this.game;
    const st = questState(game, id);
    const def = Quests.get(id);
    if (!st || !def || st.status === 'done') return;
    this.set({ ...st, status: 'done', step: def.steps.length });
    const r = def.reward ?? {};
    const players = game.players();
    const who = by ?? players.find((p) => p.id === game.localPlayerId) ?? players[0];
    if (r.money) for (const p of players) game.money(p.id, r.money, 'quest:' + id);
    if (r.items && who) for (const k of r.items) { try { game.items.give(who, k); } catch {} }
    if (r.rep) { const g: any = game.g; g.reputation = Math.round(Math.max(0, Math.min(5, (g.reputation ?? 3) + r.rep)) * 1000) / 1000; }
    if (r.xp) for (const p of players) game.xp(p.id, r.xp.skill, r.xp.amount);
    try { r.apply?.(game); } catch (e) { console.error('[quests] reward.apply', id, e); }
    // newspaper line
    this.headline(`ทีมเฮียผัดช่วยคนในซอยสำเร็จ: "${def.title.th}"`);
    game.emit('quest:done', { id, by: who?.id ?? null, money: r.money ?? 0, recipes: r.recipes ?? [], items: r.items ?? [], rep: r.rep ?? 0, note: r.note ?? null });
    // recipes last, so their cinematic follows the quest card
    if (r.recipes) setTimeout(() => { for (const rid of r.recipes!) unlockRecipe(game, rid, 'quest:' + id); }, 2600);
  }

  /** HOST: poll step predicates + reputation gate (≈ 2×/s) */
  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const game = this.game;
    const q = (game.g as any).quests ?? {};
    for (const id of Object.keys(q)) {
      const st: QuestState = q[id];
      if (st?.status !== 'active') continue;
      const def = Quests.get(id);
      const step = def?.steps[st.step];
      if (!step?.done) continue;
      let ok = false;
      try { ok = !!step.done(game, st); } catch (e) { /* content error: never stall the host */ }
      if (ok) this.advance(id);
    }
    // ★4 reputation → tom yam
    const rep = Number((game.g as any).reputation ?? 0);
    if (rep >= 4 && (game.g.day ?? 1) >= 2) unlockRecipe(game, 'tom_yam', 'rep');
  }

  // ------------------------------------------------------------------ recipes

  headline(th: string) {
    const g: any = this.game.g;
    const day = g.day ?? 1;
    const ds = g.dayStats && g.dayStats.day === day ? g.dayStats : { ...(g.dayStats ?? {}), day };
    const ev = Array.isArray(ds.events) ? ds.events : [];
    if (!ev.includes(th)) g.dayStats = { ...ds, events: [...ev, th] };
  }

  private unlockRecipeHost(game: Game, id: string, source = 'quest'): boolean {
    if (!RECIPES[id]) return false;
    const g: any = game.g;
    const have: string[] = Array.isArray(g.unlocks?.recipes) && g.unlocks.recipes.length ? g.unlocks.recipes : [...DEFAULT_UNLOCKED];
    if (have.includes(id)) return false;
    g.unlocks = { ...(g.unlocks ?? {}), recipes: [...have, id] };
    if (Array.isArray(g.pendingRecipes)) g.pendingRecipes = g.pendingRecipes.filter((r: string) => r !== id);
    // straight onto the menu at the suggested price
    if (g.menu && typeof g.menu === 'object' && g.menu[id] === undefined) g.menu = { ...g.menu, [id]: RECIPES[id].price };
    const st = sourceText(source);
    this.headline(`ร้านเฮียผัดได้สูตร${RECIPES[id].name.th} (${st.th})`);
    game.emit('unlock:recipe', { recipes: [id], source });
    return true;
  }
}
