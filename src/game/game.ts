import * as THREE from 'three';
import { Engine } from '../core/engine';
import { Emitter } from '../core/events';
import { Sound, SoundOpts } from '../core/audio';
import { RNG } from '../core/rng';
import { TL, dist3, params } from '../core/util';
import { Session } from '../net/session';
import { State, Ent, Delta } from '../sim/state';
import { Physics } from '../sim/physics';
import { UI3D, SayOpts } from '../ui3d/bubbles';
import { ViewManager } from './views';
import type { CharacterFactory, GameModule, Look, WorldAPI } from './contracts';
import { Clock } from './clock';
import { stubCharacters } from './stubs/characters-stub';
import { ItemSystem } from './items';
import { Interaction } from './interact';
import { SceneManager } from './scenes';
import { NpcMover } from './npc';

export type IntentHandler = (player: Ent, data: any, peer: string) => void;
export const MAX_PLAYERS = 4;
const NET_HZ = 20;
const HOST_HZ = 30;

/**
 * The game hub, alive for the whole session (menu → intro → world).
 * Owns the network session, the replicated State, physics, views, 3D UI and all modules.
 *
 * NETWORK MODEL (see docs/ARCHITECTURE.md)
 *  - Host-authoritative. Clients send INTENTS (`game.intent(type, data)`), the host runs the
 *    registered handler (`game.onIntent(type, fn)`) which mutates State; State replicates.
 *  - One-shot effects (sounds, bubbles, particles) go through `game.emit(type, data)` →
 *    every peer runs `game.on(type, fn)` handlers. Helpers: game.sfx(), game.say().
 *  - Each client owns its own player's transform (p/yaw/pitch); everything else is host-owned.
 */
export class Game {
  readonly engine: Engine;
  session: Session;
  state: State;
  physics!: Physics;
  readonly ui = new UI3D();
  views: ViewManager;
  /** Item definitions, inventory, physics bodies, carry visuals. */
  items!: ItemSystem;
  /** Look-at interaction (providers, prompts). */
  interact!: Interaction;
  /** Replicated scene switching (g.scene). */
  scenes!: SceneManager;
  /** HOST: path-following for NPCs / animals. */
  npcs!: NpcMover;
  readonly clock: Clock;
  chars: CharacterFactory = stubCharacters;
  world: WorldAPI | null = null;
  modules: GameModule[] = [];
  /** local events (and network events re-emitted locally) */
  readonly events = new Emitter();
  private intents = new Map<string, IntentHandler>();
  localPlayerId = -1;
  /** Name & look the local user wants (persisted in localStorage). */
  profile: { name: string; look: Look | null };
  /** World scene (gameplay). Built by WorldScene. */
  scene: THREE.Scene | null = null;
  camera!: THREE.PerspectiveCamera;
  /** set by WorldScene: local first-person controller */
  player: any = null;
  /** Shared deterministic randomness (seeded from g.seed) for ambient, client-local things. */
  rng = new RNG(1);
  private netAcc = 0;
  private hostAcc = 0;
  private psAcc = 0;
  /** entity types that are not saved (recreated each day / transient) */
  readonly volatile = new Set<string>(['player']);
  paused = false;

  constructor(engine: Engine) {
    this.engine = engine;
    this.camera = engine.camera;
    this.session = Session.local();
    this.state = new State(true);
    this.views = new ViewManager(this, this.state);
    this.clock = new Clock(this);
    this.interact = new Interaction(this);
    this.items = new ItemSystem(this);
    this.scenes = new SceneManager(this);
    this.npcs = new NpcMover(this);
    let saved: any = null;
    try { saved = JSON.parse(localStorage.getItem('hp.profile') || 'null'); } catch {}
    this.profile = saved ?? { name: 'เฮีย' + Math.floor(Math.random() * 90 + 10), look: null };
    engine.onFixed((f) => this.fixed(f.dt));
    engine.onFrame((f) => this.frame(f.dt, f.rawDt));
  }

  get isHost() { return this.session.isHost; }
  get g() { return this.state.g; }
  /** Local player entity (may be undefined before welcome). */
  get me(): Ent | undefined { return this.state.get(this.localPlayerId); }
  players(): Ent[] { return this.state.all('player').sort((a, b) => a.slot - b.slot); }
  playerByPeer(peer: string) { return this.state.find('player', (p) => p.peer === peer); }

  saveProfile() { try { localStorage.setItem('hp.profile', JSON.stringify(this.profile)); } catch {} }

  // ------------------------------------------------------------------ modules

  async initModules(mods: GameModule[]) {
    const byId = new Map(mods.map((m) => [m.id, m]));
    const out: GameModule[] = [];
    const seen = new Set<string>();
    const visit = (m: GameModule, stack: string[]) => {
      if (seen.has(m.id)) return;
      if (stack.includes(m.id)) { console.warn('[modules] cycle', stack); return; }
      for (const d of m.deps ?? []) { const dm = byId.get(d); if (dm) visit(dm, [...stack, m.id]); }
      seen.add(m.id);
      out.push(m);
    };
    for (const m of mods) visit(m, []);
    this.modules = out;
    for (const m of out) {
      try { await m.init?.(this); } catch (e) { console.error(`[module ${m.id}] init failed`, e); }
    }
    console.info('[modules]', out.map((m) => m.id).join(', '));
  }

  module<T extends GameModule = GameModule>(id: string): T | undefined { return this.modules.find((m) => m.id === id) as T; }

  // ------------------------------------------------------------------ intents & events

  /** Register a HOST handler for a client action. */
  onIntent(type: string, fn: IntentHandler) {
    if (this.intents.has(type)) console.warn('[intent] duplicate handler', type);
    this.intents.set(type, fn);
  }

  /** Ask the host to do something on behalf of the local player. */
  intent(type: string, data: any = {}) {
    if (this.isHost) this.runIntent(this.session.selfId, type, data);
    else this.session.toHost('in', [type, data]);
  }

  private runIntent(peer: string, type: string, data: any) {
    const fn = this.intents.get(type);
    if (!fn) { console.warn('[intent] no handler', type); return; }
    const pl = this.playerByPeer(peer);
    if (!pl) return;
    try { fn(pl, data, peer); } catch (e) { console.error(`[intent ${type}]`, e); }
  }

  /** Listen for a one-shot event (local and network). */
  on<T = any>(type: string, fn: (data: T) => void) { return this.events.on<T>(type, fn); }

  /** Fire a one-shot event on EVERY peer (including this one). */
  emit(type: string, data: any = {}) {
    if (this.isHost) this.session.broadcast('ev', [type, data]);
    else this.session.toHost('evr', [type, data]);
    this.events.emit(type, data);
  }

  /** Networked positional sound. pos may be an entity id's position. */
  sfx(key: string, pos?: ArrayLike<number> | THREE.Vector3 | null, o: Omit<SoundOpts, 'pos'> = {}) {
    const p = pos ? ((pos as any).isVector3 ? [(pos as any).x, (pos as any).y, (pos as any).z] : [pos[0], pos[1], pos[2]]) : null;
    this.emit('sfx', { k: key, p, o });
  }

  /** Networked speech bubble above an entity (entity id) — every peer shows it. */
  say(eid: number, text: string | TL, o: SayOpts = {}) { this.emit('say', { id: eid, text, o }); }

  /** Networked floating popup text at a position. */
  popup(pos: ArrayLike<number>, text: string, style?: any) { this.emit('popup', { p: [pos[0], pos[1], pos[2]], text, style }); }

  // ------------------------------------------------------------------ session

  /** Replace the network session (host / join / back to solo). Resets State. */
  setSession(s: Session) {
    this.session.close();
    this.session = s;
    const keepViews = this.views.active;
    this.views.deactivate();
    this.state = new State(s.isHost);
    this.views = new ViewManager(this, this.state);
    this.rewireViews();
    this.items.bindState();
    this.localPlayerId = -1;
    s.on('ps', (peer, d) => this.onPlayerState(peer, d));
    s.on('in', (peer, d) => this.runIntent(peer, d[0], d[1]));
    s.on('evr', (peer, d) => {
      // relay to everyone else, then run locally (host)
      for (const p of this.session.peers) if (p !== peer) this.session.sendTo(p, 'ev', d);
      this.events.emit(d[0], d[1]);
    });
    s.on('ev', (_peer, d) => this.events.emit(d[0], d[1]));
    s.on('d', (_peer, d: Delta) => this.state.apply(d));
    s.on('hello', (peer, d) => this.onHello(peer, d));
    s.on('welcome', (_peer, d) => this.onWelcome(d));
    s.on('full', (_peer, _d) => this.events.emit('net:full', {}));
    s.peerLeft.add((peer) => this.onPeerLeft(peer));
    s.closed.add((reason) => this.events.emit('net:closed', { reason }));
    if (s.isHost) {
      this.initHostState();
      this.spawnPlayer(s.selfId, this.profile.name, this.profile.look);
    } else {
      s.toHost('hello', { name: this.profile.name, look: this.profile.look });
    }
    this.events.emit('net:session', { host: s.isHost, room: s.room, kind: s.kind });
    if (keepViews && this.scene) this.views.activate(this.scene);
  }

  /** Called by setSession: modules that registered views must re-register on the new manager. */
  private viewRegs: [string, any][] = [];
  registerView(type: string, f: any) { this.viewRegs.push([type, f]); this.views.register(type, f); }
  private rewireViews() { for (const [t, f] of this.viewRegs) this.views.register(t, f); }

  private initHostState() {
    const g = this.state.g;
    g.scene = 'menu';
    g.phase = 'lobby';
    g.seed = (Math.random() * 1e9) | 0;
    g.day = 1;
    g.time = 7.0;
    g.paused = false;
    this.rng = new RNG(g.seed);
    this.events.emit('host:init', g);
  }

  private onHello(peer: string, d: { name: string; look: Look | null }) {
    if (!this.isHost) return;
    if (this.players().length >= MAX_PLAYERS) { this.session.sendTo(peer, 'full', {}); return; }
    const pl = this.spawnPlayer(peer, d.name, d.look);
    this.session.sendTo(peer, 'welcome', { id: pl.id, snap: this.state.snapshot() });
    this.events.emit('player:joined', pl);
  }

  private onWelcome(d: { id: number; snap: Delta }) {
    this.state.apply(d.snap);
    this.localPlayerId = d.id;
    this.state.ownedTf.add(d.id);
    this.state.ownedKeys.set(d.id, new Set(['sel', 'crouch']));
    this.rng = new RNG(this.state.g.seed ?? 1);
    this.events.emit('net:welcome', d.id);
  }

  private onPeerLeft(peer: string) {
    if (!this.isHost) return;
    const pl = this.playerByPeer(peer);
    if (!pl) return;
    this.events.emit('player:left', pl);
    this.state.despawn(pl);
  }

  /** HOST: create a player entity for a peer. */
  spawnPlayer(peer: string, name: string, look: Look | null): Ent {
    const used = new Set(this.players().map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const pl = this.state.spawn('player', {
      peer, slot, name: (name || `P${slot + 1}`).slice(0, 16),
      look: look ?? this.chars.playerLook(slot),
      p: [0, 0, 0], yaw: 0, pitch: 0,
      inv: [null, null, null, null, null] as (number | null)[], sel: 0,
      wallet: 25, xp: { cook: 0, prep: 0, serve: 0, clean: 0 }, sp: 0, skills: [] as string[],
      mode: 'free', crouch: false, ready: false,
    });
    if (peer === this.session.selfId) {
      this.localPlayerId = pl.id;
    }
    return pl;
  }

  /** HOST: change replicated scene (all peers follow). */
  setScene(name: string, phase?: string) {
    if (!this.isHost) return;
    this.g.scene = name;
    if (phase) this.g.phase = phase;
  }

  /** Client → host: my transform. */
  private sendPlayerState() {
    const me = this.me;
    if (!me || this.isHost || !me.p) return;
    this.session.toHost('ps', [me.p, me.yaw ?? 0, me.pitch ?? 0, me.crouch ? 1 : 0, me.sel ?? 0]);
  }

  private onPlayerState(peer: string, d: any[]) {
    const pl = this.playerByPeer(peer);
    if (!pl) return;
    const p = d[0];
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return;
    pl.p = p;
    pl.yaw = +d[1] || 0;
    pl.pitch = +d[2] || 0;
    pl.crouch = !!d[3];
    pl.sel = Math.max(0, Math.min(4, d[4] | 0));
  }

  // ------------------------------------------------------------------ loop

  private fixed(dt: number) {
    if (this.physics && this.scene && this.isHost) {
      this.events.emit('physics:pre', dt);
      this.physics.step();
      this.events.emit('physics:post', dt);
    } else if (this.physics && this.scene) {
      // clients only need the query structures updated (static world + kinematic players)
      this.physics.world.propagateModifiedBodyPositionsToColliders?.();
    }
  }

  private frame(dt: number, rawDt: number) {
    // host simulation at HOST_HZ
    if (this.isHost) {
      this.hostAcc += dt;
      const step = 1 / HOST_HZ;
      let n = 0;
      while (this.hostAcc >= step && n < 4) {
        this.hostAcc -= step;
        n++;
        if (!this.g.paused) this.clock.hostAdvance(step);
        for (const m of this.modules) if (m.hostUpdate) {
          try { m.hostUpdate(this, step); } catch (e) { console.error(`[module ${m.id}] hostUpdate`, e); }
        }
        this.events.emit('host:update', step);
      }
      if (n === 4) this.hostAcc = 0;
      // replicate
      this.netAcc += rawDt;
      if (this.netAcc >= 1 / NET_HZ) {
        this.netAcc = 0;
        const d = this.state.makeDelta();
        if (d && this.session.online) this.session.broadcast('d', d);
      }
    } else {
      this.psAcc += rawDt;
      if (this.psAcc >= 1 / NET_HZ) { this.psAcc = 0; this.sendPlayerState(); }
    }
    for (const m of this.modules) if (m.frame) {
      try { m.frame(this, dt); } catch (e) { console.error(`[module ${m.id}] frame`, e); }
    }
    this.views.update(dt);
    this.ui.update(rawDt);
  }

  // ------------------------------------------------------------------ helpers

  /** Nearest player entity to a point (optionally within range). */
  nearestPlayer(p: ArrayLike<number>, max = Infinity): Ent | null {
    let best: Ent | null = null, bd = max;
    for (const pl of this.players()) {
      if (!pl.p) continue;
      const d = dist3(pl.p, p);
      if (d < bd) { bd = d; best = pl; }
    }
    return best;
  }

  /** Position of an entity as Vector3 (or null). */
  posOf(id: number | null | undefined): THREE.Vector3 | null {
    const e = this.state.get(id);
    return e?.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
  }

  get debug() { return params.has('debug'); }

  // ------------------------------------------------------------------ economy & progression helpers (HOST)

  /**
   * HOST: change a player's wallet. Positive = earn, negative = spend. Returns false if they can't
   * afford it. Shows a floating "+60 ฿" and plays coins. Each player has a SEPARATE wallet.
   */
  money(playerId: number, delta: number, reason = '', popupAt?: ArrayLike<number> | null): boolean {
    const pl = this.state.get(playerId);
    if (!pl || pl.t !== 'player') return false;
    const v = Math.round(delta);
    if (v < 0 && (pl.wallet ?? 0) + v < 0) return false;
    pl.wallet = (pl.wallet ?? 0) + v;
    const at = popupAt ?? (pl.p ? [pl.p[0], pl.p[1] + 1.9, pl.p[2]] : null);
    if (at && v !== 0) this.popup(at, `${v > 0 ? '+' : '−'}${Math.abs(v)} ฿`, { font: '"Kanit"', size: 60, weight: 800, color: v > 0 ? '#ffe27a' : '#ff8a6a', stroke: '#2a1a08', strokeWidth: 7 });
    if (v !== 0) this.sfx(v > 0 ? 'coins_handful' : 'coin_clink', pl.p, { vol: 0.7 });
    this.events.emit('money', { player: playerId, delta: v, reason, wallet: pl.wallet });
    return true;
  }

  /** HOST: award skill XP ('cook' | 'prep' | 'serve' | 'clean'). The progression module levels players up. */
  xp(playerId: number, skill: 'cook' | 'prep' | 'serve' | 'clean', amount: number) {
    const pl = this.state.get(playerId);
    if (!pl || pl.t !== 'player') return;
    pl.xp = { ...(pl.xp ?? {}), [skill]: (pl.xp?.[skill] ?? 0) + amount };
    this.events.emit('xp', { player: playerId, skill, amount });
  }

  /** Does a player have a skill-tree upgrade? (ids defined by the progression module) */
  hasSkill(pl: Ent | undefined | null, id: string): boolean { return !!pl?.skills?.includes(id); }

  /** Speed multiplier for an action from skills, e.g. game.skillMul(pl, 'chop') → 1, 1.25, 1.5… */
  skillMul(pl: Ent | undefined | null, action: string): number {
    if (!pl?.skills) return 1;
    let m = 1;
    for (const s of pl.skills as string[]) if (s.startsWith(action + '_fast')) m += 0.25;
    return m;
  }
}

/** Built-in network event handlers (installed once at boot). */
export function installCoreEvents(game: Game) {
  game.on('sfx', (d: { k: string; p: number[] | null; o: SoundOpts }) => {
    Sound.play(d.k, { ...(d.o || {}), pos: d.p ? new THREE.Vector3(d.p[0], d.p[1], d.p[2]) : undefined });
  });
  game.on('say', (d: { id: number; text: any; o: SayOpts }) => {
    const obj = game.views.objectOf(d.id);
    const e = game.state.get(d.id);
    if (obj) {
      const h = (obj.userData.headHeight as number) ?? 1.9;
      game.ui.say(() => obj.localToWorld(new THREE.Vector3(0, h, 0)), d.text, { ...d.o });
    } else if (e?.p) {
      game.ui.say(new THREE.Vector3(e.p[0], e.p[1] + 1.9, e.p[2]), d.text, d.o);
    }
  });
  game.on('popup', (d: { p: number[]; text: string; style?: any }) => {
    game.ui.popup(new THREE.Vector3(d.p[0], d.p[1], d.p[2]), d.text, d.style ? { style: d.style } : {});
  });
}
