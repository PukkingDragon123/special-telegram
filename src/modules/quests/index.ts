import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ctx } from '../../game/interact';
import { params, tl, TL } from '../../core/util';
import { setKeeperTalk } from '../shops/trade';
import { Dialogues, LocalTalkers, Quests, QuestRuntime, TalkTarget, setQuestRuntime } from './api';
import { QuestHost, questState, questAvailable } from './runtime';
import { DialogueSession, canTalk, resolveDialogue, voiceOf } from './session';
import { QuestFX } from './fx';
import { entityHead, entityTarget, headOfTarget, targetFromHit } from './targets';
import { registerKeepers } from './content/keepers';
import { registerPeople } from './content/people';
import { registerQuests } from './content/quests';

/* ============================================================================================
 * quests — talk to anyone, side quests, recipe unlocks.
 *   E on a person → a cinematic conversation: their words float as 3D lettering beside their head, your
 *   answers float as 3D cards (1-9 / click). Quest givers show a gold "!", hand-ins a blue "?". Active
 *   objectives live on a torn exercise-book note in the corner of the view + a gold arrow over the target.
 *   Recipes are EARNED (quests, levels, Hia Seng's card, the restaurant, ★4) and arrive with a recipe-card
 *   cinematic showing the real dish.
 * Content: content/keepers.ts (9 shopkeepers), content/people.ts (homeless, old man, วิน, gossip, everyone),
 *          content/quests.ts (10 side quests). Shared contract: api.ts (other modules register there too).
 * Dev: ?quests=all (every quest available now) · ?quest=<id> (start it) · window.__quests
 * ========================================================================================== */

/** dev: ?qoff=prov,bark,fx,host turns parts off (bisecting) */
const OFF = new Set((params.get('qoff') ?? '').split(',').filter(Boolean));
let host: QuestHost | null = null;
let session: DialogueSession | null = null;
let fx: QuestFX | null = null;

// ------------------------------------------------------------------ barks (short lines when you walk past)
const barkT = new Map<string, number>();
let barkGlobal = 0, barkAcc = 0;
function barks(game: Game, dt: number) {
  barkAcc += dt;
  if (barkAcc < 0.5) return;
  barkAcc = 0;
  const pl = game.player;
  if (!pl || pl.mode !== 'play' || session?.active) return;
  const now = game.engine.time;
  if (now < barkGlobal) return;
  const me = new THREE.Vector3(pl.pos.x, pl.pos.y + 1.5, pl.pos.z);
  const fwd = game.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  const cands: TalkTarget[] = [];
  for (const e of game.state.all('npc')) if (e.p && Math.hypot(e.p[0] - me.x, e.p[2] - me.z) < 6.5) cands.push(entityTarget(game, e));
  for (const { target } of LocalTalkers.map.values()) cands.push(target);
  let best: { t: TalkTarget; d: number } | null = null;
  for (const t of cands) {
    if ((barkT.get(t.key) ?? -1e9) > now) continue;
    const h = headOfTarget(t);
    if (!h) continue;
    const d = h.distanceTo(me);
    if (d < 2.0 || d > 6.5) continue;
    const dir = h.clone().sub(me).setY(0).normalize();
    if (dir.dot(fwd) < 0.55) continue;
    if (!best || d < best.d) best = { t, d };
  }
  if (!best) return;
  const t = best.t;
  // quest givers call you over; everyone else says something in character
  const giverQuest = Quests.defs.find((q) => q.giver === t.role && questAvailable(game, q));
  let line: TL | string | null = null;
  if (giverQuest) line = [tl('เฮ้! มานี่หน่อย มีเรื่องให้ช่วย!', 'Hey! Come here, I need a hand!'), tl('น้องๆ ว่างไหม?', 'Got a minute?'), tl('ช่วยหน่อยได้ไหมจ๊ะ', 'Could you help me?')][Math.floor(Math.random() * 3)];
  else {
    const d = resolveDialogue(game, t);
    const list = d?.barks ? (typeof d.barks === 'function' ? d.barks(t, game) : d.barks) : null;
    if (list?.length) line = list[Math.floor(Math.random() * list.length)];
  }
  barkT.set(t.key, now + 28 + Math.random() * 20);
  if (!line) return;
  barkGlobal = now + 6 + Math.random() * 5;
  const text = typeof line === 'string' ? { th: line } : line;
  game.ui.say(() => { const h = headOfTarget(t); return h ? h.add(new THREE.Vector3(0, 0.32, 0)) : null; }, text, { duration: 2.6, voice: voiceOf(t, resolveDialogue(game, t)) * 0.95, scale: 0.85 });
}

function talkTo(game: Game, t: TalkTarget): boolean {
  if (!session || session.active) return false;
  return session.start(t);
}

export default defineModule({
  id: 'quests',
  deps: ['characters', 'world', 'cooking', 'shops', 'life', 'social', 'restaurant'],
  init(game) {
    registerKeepers();
    registerPeople();
    registerQuests();
    host = new QuestHost(game);
    host.install();
    session = new DialogueSession(game);
    fx = new QuestFX(game);
    (game as any).questsRecipeFx = true;

    const rt: QuestRuntime = {
      start: (id) => host?.start(id) ?? false,
      advance: (id, data) => host?.advance(id, data),
      complete: (id) => host?.complete(id),
      state: (id) => questState(game, id),
      talk: (t) => { talkTo(game, t); },
      bark: (t, text, seconds = 2.6) => { game.ui.say(() => { const h = headOfTarget(t); return h ? h.add(new THREE.Vector3(0, 0.32, 0)) : null; }, typeof text === 'string' ? { th: text } : text, { duration: seconds, voice: voiceOf(t, null) }); },
    };
    setQuestRuntime(rt);

    // shopkeepers: their "คุย" opens the conversation
    setKeeperTalk((sid) => {
      const e = game.state.find('npc', (n) => n.role === 'shopkeeper:' + sid);
      if (!e) return false;
      return talkTo(game, entityTarget(game, e));
    });

    // E "คุย" on any talkable person (shopkeepers go through trade.ts, ghosts / pets only for special dialogues)
    game.interact.provide((ctx: Ctx) => {
      if (OFF.has('prov') || session?.active || !ctx.hit) return;
      const t = targetFromHit(game, ctx.hit);
      if (!t || t.role.startsWith('shopkeeper:')) return;
      const special = t.role.startsWith('ghost') || t.role === 'cat' || t.role === 'dog';
      if (!canTalk(game, t, special ? 10 : -Infinity)) return;
      const quest = Quests.defs.some((q) => (q.giver === t.role && questAvailable(game, q)) || (questState(game, q.id)?.status === 'active' && q.steps[questState(game, q.id)!.step]?.at === t.role));
      return {
        key: 'E', label: quest ? tl('คุย (!)', 'talk (!)') : tl('คุย', 'talk'),
        priority: t.role === 'homeless' ? 8 : special ? 9 : quest ? 4 : 1,
        run: () => { talkTo(game, t); },
      };
    }, 20);

    // events → visuals (every client)
    game.on('quest:start', (d: { id: string }) => fx?.questStart(d.id));
    game.on('quest:done', (d: any) => fx?.questDone(d));
    game.on('unlock:recipe', (d: { recipes: string[]; source?: string }) => { for (const r of d.recipes ?? []) fx?.recipeUnlock(r, d.source ?? 'oldman'); });
    // another player's conversation: the NPC's lines float as ordinary 3D speech for everybody else
    game.on('talk:line', (d: { by: number; eid: number | null; key: string; th: string; en: string | null; voice: number }) => {
      if (d.by === game.localPlayerId) return;
      const anchor = d.eid != null ? () => { const h = entityHead(game, d.eid!, new THREE.Vector3()); return h ? h.add(new THREE.Vector3(0, 0.32, 0)) : null; }
        : () => { const lt = LocalTalkers.map.get(d.key); const h = lt ? headOfTarget(lt.target) : null; return h ? h.add(new THREE.Vector3(0, 0.32, 0)) : null; };
      game.ui.say(anchor, { th: d.th, en: d.en ?? undefined }, { duration: 3.2, voice: d.voice });
    });
    game.events.on('world:exit', () => { session?.close(); fx?.dispose(); });

    (window as any).__quests = {
      host: () => host, session: () => session, fx: () => fx, Quests, Dialogues, LocalTalkers,
      talkRole: (role: string) => {
        const e = game.state.find('npc', (n) => n.role === role);
        if (e) return talkTo(game, entityTarget(game, e));
        for (const { target } of LocalTalkers.map.values()) if (target.role === role) return talkTo(game, target);
        return false;
      },
      roles: () => [...game.state.all('npc').map((e) => e.role), ...[...LocalTalkers.map.values()].map((x) => x.target.role)],
    };
  },
  buildWorld(game) {
    fx?.build();
    const want = params.get('quest');
    if (want && game.isHost) setTimeout(() => host?.start(want, game.me ?? null), 1500);
  },
  hostUpdate(game, dt) { if (!OFF.has('host')) host?.update(dt); },
  frame(game, dt) {
    session?.update(dt);
    if (fx && !OFF.has('fx')) { fx.hidden = !!session?.active; fx.frame(dt); }
    if (!OFF.has('bark')) barks(game, dt);
  },
});
