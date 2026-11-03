import type * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { TL } from '../../core/util';
import type { AnimName, FaceVariant } from '../../game/contracts';

/* ============================================================================================
 * quests — SHARED CONTRACT (dependency-free, safe to import from any module).
 *
 * Other modules REGISTER content here; the `quests` module (src/modules/quests/index.ts) is the runtime:
 * talk-to-NPC dialogue shown as floating 3D text with selectable 3D responses, side-quest tracking,
 * rewards, and recipe unlocks. Registration may happen at import / init time, before the runtime exists.
 *
 *   Dialogues.register({ id, match, start, nodes })   who can be talked to, and what they say
 *   Quests.register({ id, title, steps, reward })      side quests (accepted from dialogue options)
 *   unlockRecipe(game, id, source)                     HOST: make a recipe cookable + put it on the menu
 *   questApi(game)                                     runtime helpers (start / advance / complete …)
 * ========================================================================================== */

/** Anything the player can talk to: entity NPCs (npc, shopkeeper, customer, homeless, ghost, landlord…)
 *  or client-local characters (crowd set pieces, easter-egg sellers) that register a talk target. */
export interface TalkTarget {
  /** 'entity' → `eid` is a game.state entity id; 'local' → a client-only character (key is unique) */
  kind: 'entity' | 'local';
  eid?: number;
  key: string;
  /** npc role (e.g. 'shopkeeper:gas_shop', 'homeless', 'landlord', 'customer', 'ghost:krasue') or archetype */
  role: string;
  name: TL;
  /** world position of the top of the head (speech text floats just above / beside it) */
  head: () => THREE.Vector3 | null;
  /** optional: play an animation / face on the speaker (entity NPCs get it done through the host) */
  act?: (anim?: AnimName, face?: FaceVariant) => void;
}

export interface DlgCtx {
  game: Game;
  target: TalkTarget;
  /** the entity behind the target (when kind === 'entity') */
  npc: Ent | null;
  /** the local player entity */
  me: Ent;
  /** per-conversation scratch */
  vars: Record<string, any>;
}

export type Line = TL | string | ((c: DlgCtx) => TL | string);

export interface DlgOption {
  text: Line;
  /** jump to node id (omit + no `end` → conversation ends after `do`) */
  next?: string;
  /** shown only if true */
  if?: (c: DlgCtx) => boolean;
  /** side effect when picked. Runs on the picking client: use game.intent(...) for host-authoritative changes */
  do?: (c: DlgCtx) => void;
  /** greyed out with this reason when it returns a string (e.g. 'ต้องมี 500 ฿') */
  lock?: (c: DlgCtx) => string | null | undefined | false;
  end?: boolean;
}

export interface DlgNode {
  id: string;
  /** what the NPC says (typewriter, floating 3D text) */
  say: Line;
  anim?: AnimName;
  face?: FaceVariant;
  /** player responses (3D floating cards; keys 1-9 or mouse). None → click / E to continue to `next` or end */
  options?: DlgOption[];
  next?: string;
  do?: (c: DlgCtx) => void;
}

export interface Dialogue {
  id: string;
  /** does this dialogue apply to that target? Highest `priority` among matches wins (default 0;
   *  quest-specific dialogues use 10+, generic chit-chat −10) */
  match: (t: TalkTarget, game: Game) => boolean;
  priority?: number;
  /** id of the first node (may depend on quest state / time / money) */
  start: (c: DlgCtx) => string;
  nodes: DlgNode[];
}

export interface QuestStep {
  id: string;
  /** objective text shown in the tracker */
  text: Line | ((game: Game) => TL | string);
  /** HOST: polled ~2×/s while the step is active; return true when it is done */
  done?: (game: Game, q: QuestState) => boolean;
  /** world position to point the tracker / marker at (optional) */
  where?: (game: Game) => [number, number, number] | null;
}

export interface QuestReward {
  /** each player in the party gets this much */
  money?: number;
  recipes?: string[];
  /** item kinds spawned at the giver / player */
  items?: string[];
  rep?: number;
  xp?: { skill: 'cook' | 'prep' | 'serve' | 'clean'; amount: number };
  /** free text shown in the reward popup (e.g. 'ส่วนลด 20% ร้านเฟอร์นิเจอร์') */
  note?: TL | string;
  /** extra host-side effect */
  apply?: (game: Game) => void;
}

export interface QuestDef {
  id: string;
  title: TL;
  /** who gives it (TalkTarget.role) — gets a floating "!" marker while available */
  giver?: string;
  /** can it be offered now? (day, time, stage, previous quests…) */
  available?: (game: Game) => boolean;
  steps: QuestStep[];
  reward: QuestReward;
  /** comedic one-liners for start / complete (said by the giver) */
  startLine?: TL | string;
  doneLine?: TL | string;
}

/** replicated quest state lives in game.g.quests[id] */
export interface QuestState { id: string; status: 'active' | 'done' | 'failed'; step: number; t0: number; data?: Record<string, any> }

export const Dialogues = {
  list: [] as Dialogue[],
  register(d: Dialogue) { const i = this.list.findIndex((x) => x.id === d.id); if (i >= 0) this.list[i] = d; else this.list.push(d); },
};

export const Quests = {
  defs: [] as QuestDef[],
  register(q: QuestDef) { const i = this.defs.findIndex((x) => x.id === q.id); if (i >= 0) this.defs[i] = q; else this.defs.push(q); },
  get(id: string) { return this.defs.find((q) => q.id === id); },
};

/** Client-local talk targets (crowd set pieces, egg sellers): register while they exist, unregister when gone. */
export const LocalTalkers = {
  map: new Map<string, { target: TalkTarget; object: THREE.Object3D }>(),
  add(target: TalkTarget, object: THREE.Object3D) { this.map.set(target.key, { target, object }); },
  remove(key: string) { this.map.delete(key); },
};

/**
 * HOST: unlock a recipe for good (cookable, in the recipe book, added to the menu at its default price) and
 * announce it to everyone ('unlock:recipe' → popup + fanfare on every client). The quests runtime may replace
 * this implementation (richer announcement); the signature stays.
 */
export let unlockRecipe = (game: Game, id: string, source = 'quest'): boolean => {
  const g: any = game.g;
  const have: string[] = Array.isArray(g.unlocks?.recipes) ? g.unlocks.recipes : [];
  if (have.includes(id)) return false;
  g.unlocks = { ...(g.unlocks ?? {}), recipes: [...have, id] };
  game.emit('unlock:recipe', { recipes: [id], source });
  return true;
};
export function setUnlockRecipe(fn: typeof unlockRecipe) { unlockRecipe = fn; }

/** Runtime helpers, available once the quests module is loaded (null before / without it). */
export interface QuestRuntime {
  /** HOST */ start(id: string): boolean;
  /** HOST */ advance(id: string, data?: Record<string, any>): void;
  /** HOST */ complete(id: string): void;
  state(id: string): QuestState | null;
  /** open a conversation with a target (local player) */
  talk(t: TalkTarget): void;
  /** show a one-off floating 3D line above a target (local) */
  bark(t: TalkTarget, text: TL | string, seconds?: number): void;
}
let runtime: QuestRuntime | null = null;
export function setQuestRuntime(r: QuestRuntime | null) { runtime = r; }
export function questApi(_game?: Game): QuestRuntime | null { return runtime; }
