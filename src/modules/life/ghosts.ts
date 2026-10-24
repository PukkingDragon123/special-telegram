import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Ctx } from '../../game/interact';
import type { SoundHandle } from '../../core/audio';
import { tl, round, angleDiff, params } from '../../core/util';
import { Assets } from '../../core/assets';
import { yawTo } from '../../game/mapplan';
import { anchorP, dist2, isFoodItem, cameraLooksAt, h01 } from './util';
import { line } from './lines';
import { sfx, play, loop } from './sounds';
import { Mist, glowSprite, glowNoiseMaterial, ghostify } from './fx';
import { riderGeometries } from './vehicles';
import type { Life } from './index';

/* ============================================================================================
 * THAI GHOSTS AT NIGHT (t:'ghost', host AI). Spawn after ~20:00, more after 22:00, gone at dawn.
 *   moto  — ผีหัวขาดขี่มอไซค์: headless rider on a rusty old scooter (real model) roaring down the
 *           soi ghost_moto_a ↔ b, flickering headlight, trailing noise-shader mist.
 *   krasue — กระสือ: floating head with long hair and glowing entrails (banana grove / fields);
 *           raids the cart for RAW meat.
 *   tani  — นางตานี: woman in green by the banana trees, sobbing, beckoning.
 *   pret  — เปรต: super tall, begging for merit at the temple wall; FEED it = merit (luck).
 *   white — ผู้หญิงชุดขาว: long hair over the face, "พี่มาก…", appears behind you, vanishes when seen.
 * Chase off: ไหว้ (E, respectful wai) · shine a flashlight · your adopted dog barking · amulet.
 * Entity: { t:'ghost', kind, p, yaw, st, vis 0..1, tgt, carry }
 * Host events: 'life:ghost_scare' {id, kind, p, r} (customers/NPCs should flee), 'life:ghost' {id, kind, on}
 * ========================================================================================== */

export type GhostKind = 'moto' | 'krasue' | 'tani' | 'pret' | 'white';
const KINDS: GhostKind[] = ['white', 'krasue', 'pret', 'tani'];

interface GBrain { next: number; t0: number; until: number; seen: number; scared: number; target: THREE.Vector3 | null; callT: number; scareT: number; stealT: number; path?: { a: THREE.Vector3; b: THREE.Vector3; s: number; len: number } }
const brains = new WeakMap<Ent, GBrain>();
const brainOf = (e: Ent): GBrain => { let b = brains.get(e); if (!b) { b = { next: 0, t0: 0, until: 0, seen: 0, scared: 0, target: null, callT: 0, scareT: 0, stealT: 0 }; brains.set(e, b); } return b; };

export class Ghosts {
  private motoT = 0;
  private spawnT = 0;
  private amb: SoundHandle | null = null;
  private ambVol = 0;
  private shineT = 0;
  private seenT = 0;
  private shake = 0;
  private flick = new Map<THREE.Light, { base: number; written: number }>();
  private lateOff: (() => void) | null = null;
  private forced = false;

  constructor(private game: Game, private life: Life) {}
  get now() { return this.life.clock.t; }
  all(): Ent[] { return this.game.state.all('ghost'); }

  near(p: ArrayLike<number>, r: number): Ent | null {
    let best: Ent | null = null, bd = r;
    for (const g of this.all()) { if (!g.p || (g.vis ?? 0) < 0.3) continue; const d = dist2(g.p, p); if (d < bd) { bd = d; best = g; } }
    return best;
  }

  // ------------------------------------------------------------------ init

  init() {
    const game = this.game;
    game.registerView('ghost', (e: Ent) => this.makeView(e));
    game.onIntent('life.pray', (pl, d: { id: number }) => this.hostPray(pl, d.id));
    game.onIntent('life.shine', (pl, d: { id: number }) => { const g = game.state.get(d.id); if (g?.t === 'ghost' && pl.p && g.p && dist2(pl.p, g.p) < 22) this.scare(g, 'light'); });
    game.onIntent('life.ghostFeed', (pl, d: { id: number; slot: number }) => this.hostFeed(pl, d.id, d.slot));
    game.onIntent('life.ghostSeen', (pl, d: { id: number }) => this.hostSeen(pl, d.id));
    game.on('life:jumpscare', (d: { player: number; kind: string }) => { if (d.player === game.localPlayerId) this.jumpScare(); });
    game.interact.provide((ctx: Ctx) => {
      if (ctx.hit?.kind !== 'ghost' || !ctx.hit.ent) return;
      const g = ctx.hit.ent;
      const acts: any[] = [{ key: 'E', label: tl('ไหว้ (สาธุ)', 'wai / pray'), priority: 9, run: () => game.intent('life.pray', { id: g.id }) }];
      if (g.kind === 'pret' && ctx.held && isFoodItem(game, ctx.held, 'pret')) acts.push({ key: 'LMB', label: tl('ทำบุญให้เปรต', 'give merit (food)'), priority: 10, run: () => game.intent('life.ghostFeed', { id: g.id, slot: ctx.me.sel ?? 0 }) });
      return acts;
    }, 13);
  }

  // ------------------------------------------------------------------ host

  private spawn(kind: GhostKind, p: THREE.Vector3, yaw = 0, extra: any = {}): Ent {
    const g = this.game.state.spawn('ghost', { kind, p: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], yaw, st: 'appear', vis: 0, tgt: null, carry: null, ...extra });
    brainOf(g).t0 = this.now;
    this.game.events.emit('life:ghost', { id: g.id, kind, on: true });
    return g;
  }
  private despawn(g: Ent) { this.game.events.emit('life:ghost', { id: g.id, kind: g.kind, on: false }); this.game.state.despawn(g); }

  debugSpawn(k: string) {
    const me = this.game.me;
    if (!me?.p) return;
    this.forced = true;
    const yaw = me.yaw ?? 0;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const at = new THREE.Vector3(me.p[0], me.p[1], me.p[2]).addScaledVector(fwd, k === 'pret' ? 6 : 4.5);
    if (k === 'moto') { this.rideMoto(true); return; }
    const kind = (KINDS.includes(k as GhostKind) ? k : 'white') as GhostKind;
    if (kind === 'krasue') at.y += 1.4;
    this.spawn(kind, at, yaw + Math.PI, { st: 'idle' });
  }

  private rideMoto(nearPlayer = false) {
    const a = anchorP(this.game, 'ghost_moto_a', [0, 0, -158]), b = anchorP(this.game, 'ghost_moto_b', [0, 0, 4]);
    const rev = Math.random() < 0.5;
    const from = rev ? b : a, to = rev ? a : b;
    const lane = rev ? -1.6 : 1.6; // drives on the left… mostly
    from.x += lane; to.x += lane;
    if (nearPlayer) {
      const me = this.game.me;
      if (me?.p) { from.set(lane, 0, me.p[2] + 45); to.set(lane, 0, me.p[2] - 60); }
    }
    const g = this.spawn('moto', from, yawTo(to.x - from.x, to.z - from.z), { st: 'ride' });
    brainOf(g).path = { a: from, b: to, s: 0, len: from.distanceTo(to) };
    sfx(this.game, 'ghost_laugh', [from.x, 1, from.z], { vol: 0.5, max: 80 });
  }

  hostUpdate(dt: number) {
    const game = this.game;
    const t = game.clock.time;
    const now = this.now;
    const night = t >= 20 || this.forced;
    if (!night) { for (const g of this.all()) this.despawn(g); this.forced = false; return; }
    // ---- schedule
    if (!this.forced && now > this.spawnT) {
      this.spawnT = now + 25 + Math.random() * 30;
      const max = t >= 22.5 ? 3 : t >= 21.2 ? 2 : 1;
      const active = this.all().filter((g) => g.kind !== 'moto');
      if (active.length < max) {
        const day = game.g.day ?? 1;
        const kind = KINDS[(Math.floor(h01(game.g.seed ?? 1, day, Math.floor(now / 60)) * 997) + active.length) % KINDS.length];
        if (!active.some((g) => g.kind === kind)) this.spawnKind(kind);
      }
    }
    if (t >= 20.5 && now > this.motoT && !this.all().some((g) => g.kind === 'moto')) {
      this.motoT = now + 70 + Math.random() * 70;
      if (!this.forced || this.all().length === 0) this.rideMoto(Math.random() < 0.35);
    }
    // ---- brains
    for (const g of this.all()) {
      const b = brainOf(g);
      if (g.st === 'pose') continue; // frozen (dev / screenshots)
      // fade in/out
      if (g.st === 'flee' || g.st === 'vanish') {
        g.vis = round(Math.max(0, (g.vis ?? 0) - dt * (g.st === 'vanish' ? 2.5 : 1.0)), 2);
        if (g.st === 'flee') this.moveAway(g, dt, 3.5);
        if (g.vis <= 0) { if (g.kind === 'white' && g.st === 'vanish' && now < b.until) { this.relocateWhite(g); continue; } this.despawn(g); continue; }
        continue;
      }
      if ((g.vis ?? 0) < 0.9) g.vis = round(Math.min(g.kind === 'white' ? 0.85 : 0.95, (g.vis ?? 0) + dt * 0.8), 2);
      if (g.st === 'appear' && g.vis > 0.5) g.st = 'idle';
      // amulet holders repel ghosts
      const pl = this.nearestPlayer(g, 40);
      if (pl && pl.p && dist2(pl.p, g.p) < 4 && game.items.carried(pl).some((it) => it.k === 'amulet') && g.kind !== 'moto') { this.scare(g, 'amulet'); continue; }
      // scare customers / NPCs around (host event)
      if (now > b.scareT) { b.scareT = now + 2; game.events.emit('life:ghost_scare', { id: g.id, kind: g.kind, p: g.p, r: g.kind === 'pret' ? 8 : 11 }); }
      switch (g.kind as GhostKind) {
        case 'moto': this.brainMoto(g, b, dt); break;
        case 'white': this.brainWhite(g, b, dt, pl); break;
        case 'krasue': this.brainKrasue(g, b, dt, pl); break;
        case 'tani': this.brainTani(g, b, dt, pl); break;
        case 'pret': this.brainPret(g, b, dt, pl); break;
      }
    }
  }

  onNewDay(_d: number) { for (const g of this.all()) this.despawn(g); this.forced = false; }

  private spawnKind(kind: GhostKind) {
    const game = this.game;
    let p: THREE.Vector3;
    switch (kind) {
      case 'krasue': p = anchorP(game, 'krasue_spot', [30, 0.05, -210]); p.y += 1.6; break;
      case 'tani': p = anchorP(game, 'nang_tani_spot', [42, 0.05, -214]); break;
      case 'pret': p = anchorP(game, 'pret_spot', [30, 0.15, -153]); break;
      default: {
        const pl = game.players()[Math.floor(Math.random() * game.players().length)];
        if (!pl?.p) return;
        p = this.behind(pl, 14);
      }
    }
    this.spawn(kind, p, Math.random() * 6.28, { st: 'appear' });
  }

  private behind(pl: Ent, d: number): THREE.Vector3 {
    const yaw = pl.yaw ?? 0;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const p = new THREE.Vector3(pl.p[0], pl.p[1], pl.p[2]).addScaledVector(back, d);
    p.x = Math.max(-5.5, Math.min(5.5, p.x)); // stay in the soi corridor when near it
    p.y = this.game.world?.groundY(p.x, p.z) ?? 0.15;
    return p;
  }

  private nearestPlayer(g: Ent, r: number): Ent | null {
    let best: Ent | null = null, bd = r;
    for (const pl of this.game.players()) { if (!pl.p) continue; const d = dist2(pl.p, g.p); if (d < bd) { bd = d; best = pl; } }
    return best;
  }

  private glide(g: Ent, to: ArrayLike<number>, speed: number, dt: number, hover = 0) {
    const p = g.p;
    const dx = to[0] - p[0], dz = to[2] - p[2];
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const s = Math.min(d, speed * dt);
      const gy = (this.game.world?.groundY(p[0], p[2]) ?? 0) + hover;
      g.p = [round(p[0] + (dx / d) * s, 3), round(p[1] + (gy - p[1]) * Math.min(1, dt * 2), 3), round(p[2] + (dz / d) * s, 3)];
      const want = yawTo(dx, dz);
      g.yaw = round((g.yaw ?? 0) + angleDiff(g.yaw ?? 0, want) * Math.min(1, dt * 4), 3);
    }
    return d;
  }
  private moveAway(g: Ent, dt: number, speed: number) {
    const pl = this.nearestPlayer(g, 60);
    if (!pl) return;
    const away = [g.p[0] + (g.p[0] - pl.p[0]) * 3, g.p[1], g.p[2] + (g.p[2] - pl.p[2]) * 3];
    this.glide(g, away, speed, dt, g.kind === 'krasue' ? 1.8 : 0.05);
  }

  private brainMoto(g: Ent, b: GBrain, dt: number) {
    const P = b.path;
    if (!P) { this.despawn(g); return; }
    P.s += dt * 15;
    const t = Math.min(1, P.s / P.len);
    const p = P.a.clone().lerp(P.b, t);
    p.y = this.game.world?.groundY(p.x, p.z) ?? 0;
    g.p = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
    // ride THROUGH players: near misses → jump scare for that player
    for (const pl of this.game.players()) {
      if (pl.p && dist2(pl.p, g.p) < 1.6 && this.now - (b.seen ?? 0) > 2) { b.seen = this.now; this.game.emit('life:jumpscare', { player: pl.id, kind: 'moto' }); }
    }
    if (t >= 1) { g.st = 'vanish'; }
  }

  private brainWhite(g: Ent, b: GBrain, dt: number, pl: Ent | null) {
    const now = this.now;
    if (now - b.t0 > 120) { g.st = 'vanish'; b.until = 0; return; }
    if (!pl) return;
    g.tgt = pl.id;
    if (now > b.callT) { b.callT = now + 7 + Math.random() * 5; this.game.say(g.id, line('ghost_white'), { duration: 3, voice: 0.4 } as any); sfx(this.game, 'ghost_whisper', g.p, { vol: 0.7 }); }
    const d = this.glide(g, pl.p, 0.55, dt, 0.06);
    if (d < 1.3) {
      this.game.emit('life:jumpscare', { player: pl.id, kind: 'white' });
      g.st = 'vanish'; b.until = now + 40;
    }
  }
  private relocateWhite(g: Ent) {
    const pl = this.game.players()[Math.floor(Math.random() * this.game.players().length)];
    if (!pl?.p) { this.despawn(g); return; }
    const p = this.behind(pl, 9 + Math.random() * 6);
    g.p = [round(p.x, 3), round(p.y, 3), round(p.z, 3)];
    g.st = 'appear'; g.vis = 0;
  }

  private brainKrasue(g: Ent, b: GBrain, dt: number, pl: Ent | null) {
    const now = this.now;
    const home = anchorP(this.game, 'krasue_spot', [30, 0.05, -210]);
    // raid the cart for raw meat when nobody is around it
    if (g.st === 'idle' && now > b.stealT) {
      b.stealT = now + 50 + Math.random() * 40;
      const meat = this.game.state.all('item').find((it) => it.holder == null && /pork|chicken|meat|beef|liver|shrimp/.test(String(it.k)) && !this.game.players().some((p) => p.p && it.p && dist2(p.p, this.game.items.worldPos(it)?.toArray() ?? it.p) < 7));
      if (meat) { g.st = 'raid'; g.tgt = meat.id; }
    }
    if (g.st === 'raid') {
      const it = this.game.state.get(g.tgt);
      const wp = it ? this.game.items.worldPos(it) : null;
      if (!it || !wp || it.holder != null) { g.st = 'idle'; return; }
      const d = this.glide(g, [wp.x, 0, wp.z], 6, dt, 1.3);
      if (d < 0.8) {
        g.carry = it.k;
        this.game.items.remove(it);
        const near = this.game.nearestPlayer(g.p, 25);
        if (near) this.game.say(near.id, line('ghost_stole'), { duration: 2.6 });
        sfx(this.game, 'ghost_laugh', g.p, { vol: 0.8 });
        g.st = 'home';
      }
      return;
    }
    if (g.st === 'home') { if (this.glide(g, [home.x, 0, home.z], 6, dt, 1.8) < 1) { g.st = 'idle'; g.carry = null; } return; }
    // hover, bob, approach players that come close, circle them giggling
    const t = now - b.t0;
    if (pl && dist2(pl.p, g.p) < 24) {
      const ang = t * 0.6;
      const c = [pl.p[0] + Math.cos(ang) * 4, 0, pl.p[2] + Math.sin(ang) * 4];
      this.glide(g, c, 2.2, dt, 1.7 + Math.sin(t * 1.3) * 0.3);
      g.tgt = pl.id;
      if (now > b.callT) { b.callT = now + 6 + Math.random() * 4; this.game.say(g.id, line('ghost_krasue'), { duration: 2.4 }); sfx(this.game, 'ghost_laugh', g.p, { vol: 0.6 }); }
    } else {
      const w = [home.x + Math.cos(t * 0.2) * 8, 0, home.z + Math.sin(t * 0.27) * 6];
      this.glide(g, w, 1.2, dt, 1.8 + Math.sin(t) * 0.25);
      g.tgt = null;
    }
  }

  private brainTani(g: Ent, b: GBrain, dt: number, pl: Ent | null) {
    const now = this.now;
    const home = anchorP(this.game, 'nang_tani_spot', [42, 0.05, -214]);
    if (pl && dist2(pl.p, g.p) < 16) {
      g.tgt = pl.id;
      this.game.npcs.faceTo(g, pl.p);
      if (dist2(pl.p, g.p) > 3) this.glide(g, pl.p, 0.35, dt, 0.08);
      if (now > b.callT) { b.callT = now + 6 + Math.random() * 6; this.game.say(g.id, line('ghost_tani'), { duration: 3 }); sfx(this.game, 'ghost_cry', g.p, { vol: 0.6 }); }
    } else { g.tgt = null; this.glide(g, [home.x, 0, home.z], 0.5, dt, 0.08); }
  }

  private brainPret(g: Ent, b: GBrain, dt: number, pl: Ent | null) {
    const now = this.now;
    const home = anchorP(this.game, 'pret_spot', [30, 0.15, -153]);
    if (pl && dist2(pl.p, g.p) < 22 && dist2(pl.p, [home.x, 0, home.z]) < 30) {
      g.tgt = pl.id;
      if (dist2(pl.p, g.p) > 4) this.glide(g, pl.p, 0.4, dt, 0.02); else this.game.npcs.faceTo(g, pl.p);
      if (now > b.callT) { b.callT = now + 7 + Math.random() * 5; this.game.say(g.id, line('ghost_pret'), { duration: 3.2 }); sfx(this.game, 'ghost_wail', g.p, { vol: 0.7 }); }
    } else { g.tgt = null; this.glide(g, [home.x, 0, home.z], 0.4, dt, 0.02); }
  }

  /** a ghost is chased away (by: 'pray' | 'light' | 'dog' | 'amulet') */
  scare(g: Ent, by: string) {
    if (!g || g.st === 'flee' || g.st === 'vanish' || g.kind === 'moto') return;
    const b = brainOf(g);
    if (g.kind === 'white') { g.st = 'vanish'; b.until = by === 'pray' ? 0 : this.now + 30; }
    else g.st = 'flee';
    if (g.kind === 'krasue' && g.carry) g.carry = null;
    sfx(this.game, g.kind === 'krasue' ? 'ghost_laugh' : 'ghost_wail', g.p, { vol: 0.7, pitch: 1.2 });
    this.game.events.emit('life:ghost_chased', { id: g.id, kind: g.kind, by });
  }

  private hostPray(pl: Ent, id: number) {
    const g = this.game.state.get(id);
    if (!g || g.t !== 'ghost' || !pl.p || dist2(pl.p, g.p) > 9) return;
    pl.anim = 'pray'; pl.animT = this.now + Math.random() * 0.01; pl.animLoop = false;
    this.game.say(pl.id, line('pray'), { duration: 2.6 });
    sfx(this.game, 'pray', pl.p, { vol: 0.6 });
    const merit = (this.game.g.merit ??= {});
    if (g.kind === 'pret') merit[pl.id] = (merit[pl.id] ?? 0) + 0.5;
    setTimeout(() => { if (this.game.state.get(g.id)) this.scare(g, 'pray'); }, 1300);
  }

  private hostFeed(pl: Ent, id: number, slot: number) {
    const g = this.game.state.get(id);
    const it = this.game.state.get(pl.inv?.[slot]);
    if (!g || g.kind !== 'pret' || !it || !isFoodItem(this.game, it, 'pret') || !pl.p || dist2(pl.p, g.p) > 7) return;
    this.game.items.remove(it);
    const merit = (this.game.g.merit ??= {});
    merit[pl.id] = (merit[pl.id] ?? 0) + 1;
    // merit → luck: tomorrow's tips like the homeless blessing
    const gg = this.game.g;
    gg.luckTip = Math.min(1.35, (gg.luckTipDay === (gg.day ?? 1) + 1 ? gg.luckTip ?? 1 : 1) + 0.1);
    gg.luckTipDay = (gg.day ?? 1) + 1;
    this.game.say(g.id, line('ghost_pret_thanks'), { duration: 3 });
    sfx(this.game, 'merit', g.p, { vol: 0.8 });
    this.game.popup([g.p[0], g.p[1] + 3.6, g.p[2]], 'ได้บุญ +1', { font: '"Charmonman"', size: 64, weight: 700, color: '#ffe9a8', stroke: '#3a2a08', strokeWidth: 7 });
    g.st = 'flee';
    this.game.events.emit('life:merit', { player: pl.id, merit: merit[pl.id] });
  }

  private hostSeen(pl: Ent, id: number) {
    const g = this.game.state.get(id);
    if (!g || g.kind !== 'white' || g.st !== 'idle' || !pl.p || dist2(pl.p, g.p) > 16) return;
    const b = brainOf(g);
    if (this.now - b.seen < 3) return;
    b.seen = this.now;
    g.st = 'vanish'; b.until = this.now + 35;
    sfx(this.game, 'ghost_sting', g.p, { vol: 0.6 });
  }

  // ------------------------------------------------------------------ client (every peer)

  buildLocal() {
    const game = this.game;
    this.lateOff?.();
    this.lateOff = game.engine.onLate?.(() => this.lateCamera()) ?? null;
  }
  disposeLocal() {
    this.amb?.stop(0.5); this.amb = null;
    this.lateOff?.(); this.lateOff = null;
    for (const [l, r] of this.flick) if (l.intensity === r.written) l.intensity = r.base;
    this.flick.clear();
  }

  private jumpScare() {
    this.shake = 0.6;
    play('ghost_sting', { vol: 0.75 });
    play('scream_m', { vol: 0.5 });
    const cam = this.game.camera;
    const p = cam.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, -1.2).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())));
    this.game.ui.shout(p, tl('กรี๊ดดดดด!!', 'AAAAH!!'), { duration: 1.2 });
  }
  private lateCamera() {
    if (this.shake <= 0) return;
    const cam = this.game.camera;
    const k = this.shake;
    cam.rotation.x += (Math.random() - 0.5) * 0.06 * k;
    cam.rotation.y += (Math.random() - 0.5) * 0.06 * k;
    this.shake = Math.max(0, this.shake - 1 / 60);
  }

  frame(dt: number) {
    const game = this.game;
    const cam = game.camera;
    if (!cam) return;
    const camP = cam.getWorldPosition(new THREE.Vector3());
    const ghosts = this.all().filter((g) => g.p && (g.vis ?? 0) > 0.05);
    // eerie ambience when any ghost is near
    let nd = Infinity;
    for (const g of ghosts) nd = Math.min(nd, Math.hypot(g.p[0] - camP.x, g.p[2] - camP.z));
    const want = nd < 40 ? Math.min(1, (40 - nd) / 25) : 0;
    this.ambVol += (want - this.ambVol) * Math.min(1, dt * 1.5);
    if (this.ambVol > 0.02 && !this.amb) this.amb = loop('ghost_amb', { vol: 0, bus: 'amb' });
    if (this.amb) { this.amb.setVolume(this.ambVol * 0.8, 0.3); if (this.ambVol < 0.01) { this.amb.stop(1); this.amb = null; } }
    // local player: looking at the white lady makes her vanish; flashlight shines ghosts away
    const me = game.me;
    if (me) {
      const held = game.items.selected(me);
      for (const g of ghosts) {
        const gp = new THREE.Vector3(g.p[0], g.p[1] + (g.kind === 'pret' ? 2.5 : g.kind === 'krasue' ? 0.2 : 1.4), g.p[2]);
        if (g.kind === 'white' && g.st === 'idle' && this.life.clock.t > this.seenT && cameraLooksAt(cam, gp, 12, 0.985)) { this.seenT = this.life.clock.t + 2; game.intent('life.ghostSeen', { id: g.id }); }
        if (held?.k === 'flashlight' && game.clock.nightFactor > 0.2 && this.life.clock.t > this.shineT && cameraLooksAt(cam, gp, 20, 0.97)) { this.shineT = this.life.clock.t + 1; game.intent('life.shine', { id: g.id }); }
      }
    }
    // lights flicker near ghosts
    this.flicker(ghosts);
  }

  private lightList: THREE.Light[] = [];
  private lightScanT = 0;
  private flicker(ghosts: Ent[]) {
    const scene = this.game.scene;
    if (!scene) return;
    this.lightScanT -= 1 / 60;
    if (this.lightScanT < 0) {
      this.lightScanT = 2;
      this.lightList = [];
      scene.traverse((o: any) => { if ((o.isPointLight || o.isSpotLight) && !o.userData.lifeNoFlicker) this.lightList.push(o); });
    }
    const t = this.life.clock.t;
    const active = new Set<THREE.Light>();
    if (ghosts.length) {
      for (const l of this.lightList) {
        const lp = l.getWorldPosition(new THREE.Vector3());
        let near = false;
        for (const g of ghosts) if (Math.hypot(g.p[0] - lp.x, g.p[2] - lp.z) < (g.kind === 'moto' ? 14 : 10)) { near = true; break; }
        if (!near) continue;
        active.add(l);
        let r = this.flick.get(l);
        if (!r) { r = { base: l.intensity, written: -1 }; this.flick.set(l, r); }
        if (l.intensity !== r.written) r.base = l.intensity;
        const n = Math.sin(t * 37 + lp.x) * Math.sin(t * 13.3 + lp.z) + Math.sin(t * 71);
        const f = n > 0.9 ? 0.05 : n > 0.4 ? 0.5 : 1;
        r.written = r.base * f;
        l.intensity = r.written;
      }
    }
    for (const [l, r] of this.flick) if (!active.has(l)) { if (l.intensity === r.written) l.intensity = r.base; this.flick.delete(l); }
  }

  // ------------------------------------------------------------------ views

  private makeView(e: Ent) {
    const game = this.game;
    const root = new THREE.Group();
    root.name = 'ghost:' + e.kind;
    const mist = new Mist(e.kind === 'moto' ? 60 : 28, new THREE.Color(e.kind === 'tani' ? '#a8d8a0' : e.kind === 'krasue' ? '#e8b0a0' : '#c8d4dc'), e.kind === 'moto' ? 0.4 : 0.28);
    game.scene?.add(mist.mesh);
    let ghostMat: ReturnType<typeof ghostify> | null = null;
    let rig: any = null;
    let extra: THREE.Object3D[] = [];
    let light: THREE.PointLight | THREE.SpotLight | null = null;
    let engine: SoundHandle | null = null;
    let glows: THREE.Sprite[] = [];
    let entrailMat: THREE.ShaderMaterial | null = null;
    const kind = e.kind as GhostKind;
    // proxy for interaction
    const H = kind === 'pret' ? 3.6 : kind === 'krasue' ? 0.6 : kind === 'moto' ? 1.5 : 1.7;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(kind === 'moto' ? 0.8 : 0.6, H, kind === 'moto' ? 1.9 : 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.y = kind === 'krasue' ? 0 : H / 2;
    root.add(proxy);
    const names: Record<GhostKind, string> = { moto: 'ผีหัวขาดขี่มอไซค์', krasue: 'กระสือ', tani: 'นางตานี', pret: 'เปรต', white: 'ผู้หญิงชุดขาว' };
    game.interact.register(root, { kind: 'ghost', eid: e.id, data: { name: tl(names[kind], kind) } });
    root.userData.headHeight = kind === 'pret' ? 3.7 : kind === 'krasue' ? 0.45 : 1.9;

    const charGhost = (look: any, tint: THREE.Color, sx = 1, sy = 1) => {
      rig = game.chars.create(look, { lod: 'high', castShadow: false });
      rig.root.scale.set(sx, sy, sx);
      root.add(rig.root);
      ghostMat = ghostify(rig.root, tint);
      try { rig.play('idle', { loop: true }); } catch {}
    };
    const femaleLook = (top: string, color: string, bottomId: string, bottomColor: string) => {
      const L = game.chars.randomLook('temple_lady', 4242 + e.id);
      L.sex = 'f'; L.hair = { style: 'long', color: '#0b0909' };
      L.top = { id: top, color }; L.bottom = { id: bottomId, color: bottomColor }; L.shoes = { id: 'barefoot' }; L.acc = [];
      return L;
    };
    const glbGhost = (url: string, tint: THREE.Color, recolor?: (m: THREE.MeshStandardMaterial, mesh: THREE.Mesh) => void, fallback?: () => void) => {
      Assets.glb(url).then((gl: any) => {
        if (!root.parent && !root.userData.alive) return;
        const m = gl.scene.clone(true);
        m.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); recolor?.(o.material, o); o.castShadow = false; } });
        m.rotation.y = Math.PI;
        root.add(m);
        ghostMat = ghostify(m, tint);
        extra.push(m);
      }).catch(() => fallback?.());
    };
    root.userData.alive = true;
    if (kind === 'white') {
      // long-haired woman in a white gown (real sculpted model), hair over the face
      glbGhost('gen/life/models/ghost_white.glb', new THREE.Color(0.85, 0.9, 0.95), undefined, () => charGhost(femaleLook('house_dress', '#f2f0ea', 'pha_thung', '#efece6'), new THREE.Color(0.85, 0.9, 0.95)));
    } else if (kind === 'tani') {
      // นางตานี: same sculpted woman, dress dyed banana-leaf green, softly glowing
      glbGhost('gen/life/models/ghost_white.glb', new THREE.Color(0.55, 0.95, 0.6), (mat, mesh) => { if (/dress/i.test(mesh.name + mat.name)) mat.color = new THREE.Color('#3f9a4a'); }, () => charGhost(femaleLook('auntie_blouse', '#2f7a3a', 'pha_thung', '#1f5a2a'), new THREE.Color(0.6, 0.95, 0.65)));
      light = new THREE.PointLight(0x7aff9a, 2.5, 6, 2);
      light.position.y = 1.2; light.userData.lifeNoFlicker = true;
      root.add(light);
    } else if (kind === 'pret') {
      const L = game.chars.randomLook('grandpa', 777);
      L.build = 0.0; L.top = { id: 'tshirt_ragged', color: '#4a4a44' }; L.bottom = { id: 'cloth_shorts', color: '#33302a' }; L.hair = { style: 'shaggy', color: '#2a2622' }; L.shoes = { id: 'barefoot' };
      charGhost(L, new THREE.Color(0.55, 0.6, 0.55), 0.62, 2.15);
      const eyes = [glowSprite(0xffe08a, 0.09, 0.9), glowSprite(0xffe08a, 0.09, 0.9)];
      eyes.forEach((s, i) => { s.position.set(i ? 0.035 : -0.035, 3.45, -0.1); root.add(s); });
      glows.push(...eyes);
    } else if (kind === 'krasue') {
      this.buildKrasue(root, e, (m) => { entrailMat = m; }, (l) => { light = l; }, (r, gm) => { rig = r; ghostMat = gm; });
    } else if (kind === 'moto') {
      this.buildMoto(root, (l) => { light = l; }, (g) => glows.push(g), (gm) => { ghostMat = gm; });
      engine = loop('ghost_moto', { pos: root.position, vol: 1, ref: 6, max: 90 }) ?? loop('moto_idle', { pos: root.position, vol: 1, pitch: 0.55, ref: 6, max: 90, lowpass: 900 });
    }
    if (e.p) root.position.set(e.p[0], e.p[1], e.p[2]);
    root.rotation.y = e.yaw ?? 0;
    let t = 0, emitT = 0;
    const prev = root.position.clone();
    let lastVis = 0;
    return {
      object: root,
      update: (e: Ent, dt: number) => {
        t += dt;
        const vis = e.vis ?? 0;
        if (vis > 0.6 && lastVis <= 0.6 && kind !== 'moto') {
          const d = game.camera.getWorldPosition(new THREE.Vector3()).distanceTo(root.position);
          if (d < 14) play('ghost_sting', { pos: root.position, vol: 0.45 });
        }
        lastVis = vis;
        if (e.p) {
          const tgt = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
          if (root.position.distanceToSquared(tgt) > 25) root.position.copy(tgt); else root.position.lerp(tgt, 1 - Math.exp(-12 * dt));
        }
        root.rotation.y += angleDiff(root.rotation.y, e.yaw ?? 0) * (1 - Math.exp(-8 * dt));
        const speed = root.position.distanceTo(prev) / Math.max(dt, 1e-4);
        prev.copy(root.position);
        // float / sway
        const bob = kind === 'krasue' ? Math.sin(t * 1.7) * 0.08 : kind === 'moto' ? 0 : Math.sin(t * 1.1) * 0.04 + 0.05;
        if (rig) { rig.root.position.y = (kind === 'krasue' ? 0 : bob); rig.root.rotation.z = kind === 'tani' || kind === 'pret' ? Math.sin(t * 0.7) * 0.04 : 0; rig.setMove?.(0); rig.update?.(dt); }
        if (kind === 'krasue') { root.children.forEach((c) => { if (c.userData.krasueHead) c.position.y = 0.0 + bob; }); }
        ghostMat?.set(vis, t);
        if (entrailMat) { entrailMat.uniforms.uTime.value = t; entrailMat.uniforms.uOpacity.value = vis; }
        for (const g of glows) (g.material as THREE.SpriteMaterial).opacity = vis * (0.6 + Math.random() * 0.4);
        if (light) {
          const fl = kind === 'moto' ? (Math.sin(t * 31) * Math.sin(t * 7.7) > 0.75 ? 0.1 : 1) : 0.8 + Math.sin(t * 9) * 0.2;
          light.intensity = (kind === 'moto' ? 26 : kind === 'krasue' ? 4 : 2.5) * fl * vis;
        }
        root.visible = vis > 0.01;
        // mist
        emitT -= dt;
        if (emitT < 0 && vis > 0.1) {
          emitT = kind === 'moto' ? 0.03 : 0.25;
          const p = root.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, kind === 'krasue' ? -0.6 : 0.15, (Math.random() - 0.5) * 0.6));
          const vel = kind === 'moto' ? new THREE.Vector3(Math.sin(root.rotation.y) * 2, 0.4, Math.cos(root.rotation.y) * 2) : undefined;
          mist.emit(p, kind === 'moto' ? 1.2 : 0.8, kind === 'moto' ? 2.2 : 3.5, vel);
        }
        mist.update(dt, t);
        if (engine) { engine.setPos(root.position); engine.setPitch(0.5 + Math.min(1, speed / 15) * 0.35 + Math.sin(t * 3) * 0.05, 0.2); engine.setVolume(vis, 0.2); }
      },
      dispose: () => {
        root.userData.alive = false;
        game.interact.unregister(root);
        mist.mesh.removeFromParent(); mist.dispose();
        engine?.stop(0.6);
        ghostMat?.dispose();
        rig?.dispose?.();
        proxy.geometry.dispose();
      },
    };
  }

  private buildMoto(root: THREE.Group, setLight: (l: THREE.SpotLight) => void, addGlow: (g: THREE.Sprite) => void, setGhost: (g: any) => void) {
    const body = new THREE.Group();
    root.add(body);
    // headless rider (posed), tattered dark clothes
    const rg = riderGeometries(true);
    const dark = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
    const rider = new THREE.Group();
    rider.add(new THREE.Mesh(rg.shirt, dark('#2a2a30')), new THREE.Mesh(rg.pants, dark('#1d1d22')));
    // skin parts without the head: hands/arms only (strip the head sphere by clipping above the neck)
    const skin = new THREE.Mesh(rg.skin, new THREE.MeshStandardMaterial({ color: '#8a8a80', roughness: 0.8 }));
    rider.add(skin);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 8), new THREE.MeshStandardMaterial({ color: '#4a0a0a', roughness: 0.4, emissive: '#200000' }));
    stump.position.set(0, 1.44, -0.05);
    rider.add(stump);
    rider.position.z = 0.05;
    body.add(rider);
    const gm = ghostify(rider, new THREE.Color(0.7, 0.75, 0.8));
    setGhost(gm);
    // the real scooter model (rusty, ghostly)
    Assets.glb('gen/life/models/ghost_scooter.glb').then((gl: any) => {
      const s = gl.scene.clone(true);
      s.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.color?.multiplyScalar(0.55); o.material.transparent = true; o.material.opacity = 0.9; } });
      s.rotation.y = Math.PI; // model front → -Z
      body.add(s);
    }).catch(() => {});
    // flickering headlight
    const spot = new THREE.SpotLight(0xd8f0ff, 26, 30, 0.5, 0.6, 1.3);
    spot.position.set(0, 1.0, -0.9);
    spot.target.position.set(0, 0, -9);
    spot.userData.lifeNoFlicker = true;
    body.add(spot, spot.target);
    setLight(spot);
    const g = glowSprite(0xe0f4ff, 0.8, 0.9);
    g.position.set(0, 1.0, -0.95);
    body.add(g);
    addGlow(g);
  }

  private buildKrasue(root: THREE.Group, e: Ent, setMat: (m: THREE.ShaderMaterial) => void, setLight: (l: THREE.PointLight) => void, setRig: (r: any, gm: any) => void) {
    const game = this.game;
    const headG = new THREE.Group();
    headG.userData.krasueHead = true;
    root.add(headG);
    // a real sculpted woman's head (pale, ghostly) + long black hair falling around it
    Promise.all([Assets.glb('gen/life/models/krasue_head.glb'), Assets.glb('gen/life/models/krasue_hair.glb')]).then(([h, hr]: any[]) => {
      const head = h.scene.clone(true), hair = hr.scene.clone(true);
      const box = new THREE.Box3().setFromObject(head);
      const hb = new THREE.Box3().setFromObject(hair);
      head.position.y = -box.max.y + 0.12;                      // crown ~12 cm above the float point
      hair.position.set(-(hb.min.x + hb.max.x) / 2, -hb.max.y + 0.135, -(hb.min.z + hb.max.z) / 2 + 0.02);
      const g = new THREE.Group();
      g.add(head, hair);
      g.rotation.y = Math.PI;
      head.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.9); } });
      headG.add(g);
      const gm = ghostify(g, new THREE.Color(1.0, 0.88, 0.85));
      setRig(null, gm);
    }).catch(() => { /* keep entrails only */ });
    // glowing entrails: heart, stomach, and a dangling coil of intestines (noise-shader glow)
    const mat = glowNoiseMaterial('#ff2a3a', '#7aff6a', { additive: true, opacity: 1, fresnel: 1.2 });
    setMat(mat);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.12, 0), new THREE.Vector3(0.05, -0.3, 0.03), new THREE.Vector3(-0.06, -0.48, -0.02), new THREE.Vector3(0.07, -0.62, 0.04), new THREE.Vector3(-0.04, -0.8, 0.0), new THREE.Vector3(0.02, -0.95, 0.05),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.028, 6, false), mat);
    headG.add(tube);
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 2), mat); heart.position.set(0.02, -0.22, 0.02); heart.scale.set(1, 1.2, 0.9); headG.add(heart);
    const lungs = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 2), mat); lungs.position.set(-0.03, -0.32, -0.01); lungs.scale.set(1.4, 1, 0.8); headG.add(lungs);
    const glow = glowSprite(0xff5040, 1.2, 0.7); glow.position.y = -0.4; headG.add(glow);
    const l = new THREE.PointLight(0xff4a3a, 4, 7, 2); l.position.y = -0.35; l.userData.lifeNoFlicker = true; headG.add(l);
    setLight(l);
  }
}

export const DEV_GHOST = params.get('ghost');
