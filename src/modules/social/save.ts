import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { isPlayer } from './state';

/* ============================================================================================
 * SAVE / LOAD (host). Auto-saves every new day to localStorage:
 *   g (minus transient fields) + every non-volatile entity (not players / npcs / tugs) + per-slot
 *   player progress { name, wallet, xp, lv, sp, skills, inv:[item ids] }.
 * (game as any).save = { has(), load(), clear(), save(), info() }  — menu "เล่นต่อ" calls load()
 * on the host before entering the world. Saved items keep their ids (remapped if a live entity
 * already uses one); players get their progress & carried items back when they (re)join.
 * ========================================================================================== */

const KEY = 'hp.save.v1';
const TRANSIENT_G = new Set(['id', 't', 'scene', 'phase', 'paused', 'freezeTime', 'night', '_visitT']);
const SKIP_T = new Set(['player', 'npc', 'tug', 'global']);
const REF_KEYS = new Set(['in', 'holder', 'owner', 'by', 'bed', 'cart', 'table', 'item', 'parent', 'target', 'seat', 'station', 'container', 'wok', 'plate', 'dish', 'stool', 'chair', 'tray']);

interface SaveData {
  v: 1; ts: number; day: number;
  g: Record<string, any>;
  ents: Ent[];
  players: Record<number, { name: string; wallet: number; xp: any; lv: any; sp: number; skills: string[]; inv: number[] }>;
}

function clean(o: any) {
  const out: any = {};
  for (const k in o) if (k.charCodeAt(0) !== 95) out[k] = o[k];
  return JSON.parse(JSON.stringify(out));
}

export function installSave(game: Game) {
  let pending: SaveData['players'] | null = null;
  let remap = new Map<number, number>();

  function save() {
    if (!game.isHost) return false;
    const g: any = {};
    for (const k in game.g) if (!TRANSIENT_G.has(k) && k.charCodeAt(0) !== 95) g[k] = game.g[k];
    const players: SaveData['players'] = {};
    const heldBy = new Map<number, number>();
    for (const p of game.players()) {
      const inv = [...new Set<number>((p.inv ?? []).filter((x: any) => x != null))];
      for (const id of inv) heldBy.set(id, p.slot);
      players[p.slot] = { name: p.name, wallet: p.wallet ?? 0, xp: p.xp, lv: p.lv, sp: p.sp ?? 0, skills: p.skills ?? [], inv };
    }
    const ents: Ent[] = [];
    for (const e of game.state.ents.values()) {
      if (SKIP_T.has(e.t) || game.volatile.has(e.t)) continue;
      const c = clean(e);
      if (e.t === 'item' && e.holder != null) {
        // carried: store free, given back to the slot owner on load
        c.holder = null; c.slot = null;
        const pl = game.state.get(e.holder);
        if (pl?.p) c.p = [pl.p[0], pl.p[1] + 0.5, pl.p[2]];
      }
      if (e.t === 'item' && e.k === 'cardboard_bed' && c.data) c.data = { ...c.data, by: null };
      ents.push(c);
    }
    const data: SaveData = { v: 1, ts: Date.now(), day: game.g.day ?? 1, g, ents, players };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn('[social] save failed (storage full?)', e); return false; }
    game.events.emit('save:done', { day: data.day });
    return true;
  }

  function read(): SaveData | null {
    try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d?.v === 1 ? d : null; } catch { return null; }
  }

  function applyPlayer(p: Ent) {
    const rec = pending?.[p.slot];
    if (!rec) return;
    p.wallet = rec.wallet; p.xp = rec.xp ?? p.xp; p.lv = rec.lv ?? p.lv; p.sp = rec.sp ?? 0; p.skills = rec.skills ?? [];
    for (const old of rec.inv ?? []) {
      const it = game.state.get(remap.get(old) ?? old);
      if (it && it.t === 'item' && it.holder == null) game.items.putInInventory(p, it);
    }
    delete pending![p.slot];
  }

  function load(): boolean {
    if (!game.isHost) return false;
    const d = read();
    if (!d) return false;
    const st: any = game.state;
    // g
    for (const k in d.g) if (!TRANSIENT_G.has(k)) game.g[k] = d.g[k];
    game.g.time = 6.5;
    game.g.night = { phase: 'none', late: 0, t: 0 };
    game.g.loadedFromSave = true;
    // wipe current non-volatile entities that a fresh session may have created (carts, items…)
    for (const e of [...game.state.ents.values()]) if (!SKIP_T.has(e.t) && !game.volatile.has(e.t)) game.state.despawn(e);
    // ids: keep, remap collisions
    remap = new Map();
    let next: number = st.nextId ?? 1;
    for (const e of d.ents) next = Math.max(next, e.id + 1);
    for (const e of d.ents) if (game.state.ents.has(e.id)) remap.set(e.id, next++);
    const fix = (e: any) => {
      if (remap.has(e.id)) e.id = remap.get(e.id);
      for (const k in e) if (REF_KEYS.has(k) && typeof e[k] === 'number' && remap.has(e[k])) e[k] = remap.get(e[k]);
      if (e.data && typeof e.data === 'object') for (const k in e.data) if (REF_KEYS.has(k) && typeof e.data[k] === 'number' && remap.has(e.data[k])) e.data[k] = remap.get(e.data[k]);
    };
    const fresh: Ent[] = [];
    for (const raw of d.ents) {
      const e = JSON.parse(JSON.stringify(raw));
      fix(e);
      st.insert(e);
      fresh.push(e);
    }
    st.nextId = Math.max(next, st.nextId ?? 1);
    for (const e of fresh) game.state.spawned.emit(e);
    if (game.scene) game.items.rebuildBodies();
    pending = { ...d.players };
    for (const p of game.players()) applyPlayer(p);
    game.events.emit('save:loaded', { day: d.day });
    console.info(`[social] loaded save: day ${d.day}, ${fresh.length} entities`);
    return true;
  }

  game.events.on('player:joined', (p: Ent) => { if (game.isHost && pending && isPlayer(p)) applyPlayer(p); });

  const api = {
    has: () => !!read(),
    load,
    save,
    clear: () => { try { localStorage.removeItem(KEY); } catch {} },
    info: () => { const d = read(); return d ? { day: d.day, ts: d.ts, players: Object.values(d.players).map((p) => p.name) } : null; },
  };
  (game as any).save = api;
  return api;
}
