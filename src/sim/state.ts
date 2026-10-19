import { Signal } from '../core/events';

/**
 * Replicated game state.
 *
 * Every gameplay object is a plain JSON-able **entity** `{ id, t, ...fields }` stored here.
 * The HOST mutates entities freely (no "mark dirty" needed); every network tick the host
 * diffs entities against what it last sent and broadcasts changes. Clients apply deltas.
 *
 * Field conventions
 *  - `t`            entity type ('player', 'item', 'npc', 'dog', 'table', ...)
 *  - `p` [x,y,z]    position (metres)       ┐ sent on the fast transform channel,
 *  - `q` [x,y,z,w]  rotation quaternion     │ quantized; views should smooth them
 *  - `yaw` number   heading (radians)       │ (use either q or yaw)
 *  - `pitch` number look pitch (players)    ┘
 *  - `_anything`    LOCAL ONLY (never replicated, e.g. physics handles, AI scratch data)
 *  - everything else is replicated as JSON whenever it changes (keep it small & plain).
 *
 * Entity id 0 is the global entity `state.g` (day, clock, phase, shop status, ...).
 */
export interface Ent {
  id: number;
  t: string;
  p?: number[];
  q?: number[];
  yaw?: number;
  pitch?: number;
  [k: string]: any;
}

const TF_KEYS = new Set(['p', 'q', 'yaw', 'pitch']);

export interface Delta {
  /** changed / new entity bodies (non-transform fields) */
  s?: Ent[];
  /** transforms: [id, p|null, q|null, yaw|null, pitch|null] */
  x?: (number | number[] | null)[][];
  /** removed ids */
  r?: number[];
  /** full snapshot → client clears first */
  full?: boolean;
  tick?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function body(e: Ent) {
  const o: any = {};
  for (const k in e) {
    if (k.charCodeAt(0) === 95 /* _ */ || TF_KEYS.has(k)) continue;
    o[k] = e[k];
  }
  return o;
}

export class State {
  readonly ents = new Map<number, Ent>();
  private byT = new Map<string, Set<Ent>>();
  private nextId = 1;
  private removed: number[] = [];
  private sentBody = new Map<number, string>();
  private sentTf = new Map<number, string>();
  tick = 0;
  /** Spawned (host: on spawn(); client: when first received). */
  readonly spawned = new Signal<Ent>();
  readonly despawned = new Signal<Ent>();
  /** Client only: body fields changed by a delta. */
  readonly changed = new Signal<Ent>();
  /** Client: entity ids whose transform the client owns (its own player) — deltas don't overwrite them. */
  ownedTf = new Set<number>();
  /** Client: per-entity body keys the client owns (e.g. its own player's 'crouch'). */
  ownedKeys = new Map<number, Set<string>>();

  constructor(public isHost: boolean) {
    this.reset();
  }

  reset() {
    for (const e of [...this.ents.values()]) this.despawned.emit(e);
    this.ents.clear();
    this.byT.clear();
    this.sentBody.clear();
    this.sentTf.clear();
    this.removed = [];
    this.nextId = 1;
    const g: Ent = { id: 0, t: 'global' };
    this.insert(g);
  }

  /** Global entity (id 0). */
  get g(): Ent { return this.ents.get(0)!; }

  private insert(e: Ent) {
    this.ents.set(e.id, e);
    let s = this.byT.get(e.t);
    if (!s) this.byT.set(e.t, (s = new Set()));
    s.add(e);
  }

  get(id: number | null | undefined): Ent | undefined {
    return id === null || id === undefined ? undefined : this.ents.get(id);
  }

  /** All entities of a type (live set — don't mutate while iterating spawns/despawns). */
  all(t: string): Ent[] { const s = this.byT.get(t); return s ? [...s] : []; }
  each(t: string, fn: (e: Ent) => void) { const s = this.byT.get(t); if (s) for (const e of s) fn(e); }
  count(t: string) { return this.byT.get(t)?.size ?? 0; }
  find(t: string, pred: (e: Ent) => boolean): Ent | undefined {
    const s = this.byT.get(t);
    if (s) for (const e of s) if (pred(e)) return e;
    return undefined;
  }

  /** HOST: create an entity. */
  spawn<T extends Partial<Ent>>(t: string, data: T = {} as T): Ent & T {
    if (!this.isHost) { console.warn('[state] spawn on client ignored', t); return null as any; }
    const e = { ...data, id: this.nextId++, t } as Ent & T;
    this.insert(e);
    this.spawned.emit(e);
    return e;
  }

  /** HOST: remove an entity. */
  despawn(id: number | Ent) {
    if (!this.isHost) return;
    const e = typeof id === 'number' ? this.ents.get(id) : id;
    if (!e || e.id === 0) return;
    this.ents.delete(e.id);
    this.byT.get(e.t)?.delete(e);
    this.sentBody.delete(e.id);
    this.sentTf.delete(e.id);
    this.removed.push(e.id);
    this.despawned.emit(e);
  }

  /** HOST: compute changes since the last call. Returns null when nothing changed. */
  makeDelta(): Delta | null {
    this.tick++;
    const s: Ent[] = [];
    const x: any[] = [];
    for (const e of this.ents.values()) {
      const b = body(e);
      const js = JSON.stringify(b);
      if (this.sentBody.get(e.id) !== js) { this.sentBody.set(e.id, js); s.push(b); }
      if (e.p || e.q || e.yaw !== undefined || e.pitch !== undefined) {
        const p = e.p ? [r2(e.p[0]), r2(e.p[1]), r2(e.p[2])] : null;
        const q = e.q ? [r3(e.q[0]), r3(e.q[1]), r3(e.q[2]), r3(e.q[3])] : null;
        const yaw = e.yaw !== undefined ? r3(e.yaw) : null;
        const pitch = e.pitch !== undefined ? r3(e.pitch) : null;
        const key = `${p}|${q}|${yaw}|${pitch}`;
        if (this.sentTf.get(e.id) !== key) { this.sentTf.set(e.id, key); x.push([e.id, p, q, yaw, pitch]); }
      }
    }
    const r = this.removed;
    this.removed = [];
    if (!s.length && !x.length && !r.length) return null;
    const d: Delta = { tick: this.tick };
    if (s.length) d.s = s;
    if (x.length) d.x = x;
    if (r.length) d.r = r;
    return d;
  }

  /** HOST: full snapshot for a joining client (does not disturb delta bookkeeping). */
  snapshot(): Delta {
    const s: Ent[] = [];
    const x: any[] = [];
    for (const e of this.ents.values()) {
      s.push(body(e));
      if (e.p || e.q || e.yaw !== undefined || e.pitch !== undefined) x.push([e.id, e.p ?? null, e.q ?? null, e.yaw ?? null, e.pitch ?? null]);
    }
    return { s, x, full: true, tick: this.tick };
  }

  /** CLIENT: apply a delta / snapshot from the host. */
  apply(d: Delta) {
    if (d.full) {
      for (const e of [...this.ents.values()]) if (e.id !== 0) { this.ents.delete(e.id); this.byT.get(e.t)?.delete(e); this.despawned.emit(e); }
    }
    const fresh: Ent[] = [];
    if (d.s) for (const b of d.s) {
      const cur = this.ents.get(b.id);
      if (!cur) {
        const e = { ...b } as Ent;
        this.insert(e);
        fresh.push(e);
      } else {
        const own = this.ownedKeys.get(b.id);
        for (const k in cur) {
          if (k.charCodeAt(0) === 95 || TF_KEYS.has(k) || k in b || (own && own.has(k))) continue;
          delete cur[k];
        }
        for (const k in b) if (!own || !own.has(k)) cur[k] = (b as any)[k];
        if (cur.t !== b.t) { this.byT.get(cur.t)?.delete(cur); cur.t = b.t; this.insert(cur); }
        this.changed.emit(cur);
      }
    }
    if (d.x) for (const [id, p, q, yaw, pitch] of d.x as any[]) {
      if (this.ownedTf.has(id)) continue;
      const e = this.ents.get(id);
      if (!e) continue;
      if (p) e.p = p;
      if (q) e.q = q;
      if (yaw !== null && yaw !== undefined) e.yaw = yaw;
      if (pitch !== null && pitch !== undefined) e.pitch = pitch;
    }
    for (const e of fresh) this.spawned.emit(e);
    if (d.r) for (const id of d.r) {
      const e = this.ents.get(id);
      if (!e) continue;
      this.ents.delete(id);
      this.byT.get(e.t)?.delete(e);
      this.despawned.emit(e);
    }
    if (d.tick) this.tick = d.tick;
  }
}
