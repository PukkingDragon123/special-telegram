import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Look } from '../../game/contracts';
import { round, tl } from '../../core/util';
import { cl } from './lines';
import { G } from '../../sim/physics';

/* ============================================================================================
 * HOST side of the combat module: street characters, punches, reactions, fights, pistols,
 * knock-outs, deaths (→ a ghost rises), witnesses filming, the cop and the player's KO.
 *
 * Combat NPCs are ordinary 'npc' entities with role 'cb_street' (spawned around the players),
 * 'cb_victim' (a crowd walker that got punched and was taken over) or 'cb_cop'. Replicated extras:
 *   cbKind 'thug'|'auntie'|'tough'|'coward'|'cop' · hp · cbSt 'ok'|'ko'|'dead' (views: stars / still)
 *   gun (true = carries a pistol, drawn with hold:'cb_pistol')
 * Any other npc (shopkeepers, customers, the old man …) only flinches and swears (gameplay-safe).
 * Player extras: hp (0..100), cbDown (knocked out).
 * ========================================================================================== */

export type Kind = 'thug' | 'auntie' | 'tough' | 'coward' | 'cop';
type St = 'idle' | 'wander' | 'loiter' | 'flee' | 'fight' | 'aim' | 'ko' | 'dead' | 'film' | 'chase' | 'leave';

interface Brain {
  st: St;
  t: number;            // time in state
  target: number | null;
  next: number;         // generic timer (swing cooldown, re-path, …)
  hits: number;
  shots: number;
  group?: number;
  home: THREE.Vector3;
  ghost?: number | null;
  talkOff?: number;
}

const ARCH: Record<Exclude<Kind, 'cop'>, string[]> = {
  thug: ['gangster_lite', 'gangster_lite', 'moto_taxi'],
  auntie: ['auntie_vendor', 'housewife', 'old_lady'],
  tough: ['construction_worker', 'uncle_singlet', 'delivery_rider', 'security_guard', 'karaoke_uncle'],
  coward: ['student_m', 'student_f', 'office_worker_m', 'office_worker_f', 'teen_gamer', 'tourist_backpacker', 'shop_girl'],
};
const KIND_OF_ARCH: Record<string, Kind> = {};
for (const [k, list] of Object.entries(ARCH)) for (const a of list) KIND_OF_ARCH[a] = k as Kind;

const POP_RADIUS = 45;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const V = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);

export class CombatHost {
  private brains = new Map<number, Brain>();
  private now = 0;
  private popT = 0;
  private heat = new Map<number, number>();       // player id → trouble level (decays)
  private copFor = new Map<number, number>();     // player id → cop eid
  private groupN = 1;

  constructor(private game: Game) {
    game.onIntent('combat.punch', (pl, d) => this.punch(pl, d));
    game.events.on('world:exit', () => { this.brains.clear(); this.heat.clear(); this.copFor.clear(); });
  }

  get enabled() {
    const g: any = this.game.g;
    return this.game.g.scene === 'world' && (!g.introStep || g.introStep === 'done');
  }

  // ------------------------------------------------------------------ helpers
  private anim(e: Ent, a: string, loop = false) { e.anim = a; e.animLoop = loop; e.animT = (e.animT ?? 0) + 1; }
  private say(e: Ent, k: string, style: 'speech' | 'shout' = 'shout', dur = 2.2) {
    const b = this.brains.get(e.id);
    if (b && b.talkOff && this.now < b.talkOff - 1.2) return;   // don't spam
    this.game.say(e.id, cl(k), { style, duration: dur });
    e.talking = true;
    if (b) b.talkOff = this.now + 1.4;
  }
  private playerById(id: number | null): Ent | null { const p = id != null ? this.game.state.get(id) : null; return p && p.t === 'player' ? p : null; }
  private dist(a: Ent, b: Ent) { return Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]); }
  private face(e: Ent, p: ArrayLike<number>) { this.game.npcs.faceTo(e, p); }
  private ground(x: number, z: number) { return this.game.world?.groundY(x, z) ?? 0; }
  private set(e: Ent, b: Brain, st: St) { b.st = st; b.t = 0; b.next = 0; }

  /** a free spot along the nav graph near p (r metres), falling back to straight offsets */
  private near(p: THREE.Vector3, r: number): THREE.Vector3 {
    const ang = Math.random() * Math.PI * 2;
    const q = p.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    const h = this.game.physics?.raycast(p.clone().setY(p.y + 0.9), q.clone().sub(p).setY(0).normalize(), r, G.STATIC);
    if (h) q.copy(p).addScaledVector(q.clone().sub(p).setY(0).normalize(), Math.max(0.5, h.toi - 0.6));
    q.y = this.ground(q.x, q.z);
    return q;
  }

  private spawnNpc(kind: Kind, p: THREE.Vector3, role = 'cb_street', look?: Look | null, yaw = Math.random() * 6.28): Ent {
    const arch = kind === 'cop' ? 'police' : ARCH[kind][(Math.random() * ARCH[kind].length) | 0];
    const lk = look ?? this.game.chars.randomLook(arch, (Math.random() * 1e6) | 0);
    const e = this.game.state.spawn('npc', {
      role, cbKind: kind, hp: kind === 'thug' ? 130 : kind === 'cop' ? 160 : kind === 'tough' ? 115 : 90, cbSt: 'ok',
      gun: kind === 'thug' && Math.random() < 0.4,
      look: lk, p: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], yaw: round(yaw, 3),
      lookAt: null,
    } as any);
    this.brains.set(e.id, { st: 'idle', t: 0, target: null, next: 0, hits: 0, shots: 0, home: p.clone() });
    return e;
  }

  // ------------------------------------------------------------------ the punch (intent)
  private punch(pl: Ent, d: { yaw?: number; walker?: { key: string; p: number[]; yaw: number; arch: string; look: Look } }) {
    if (!this.enabled || !pl?.p || pl.cbDown) return;
    if ((pl._cbPunchAt ?? -9) > this.now - 0.32) return;     // swing rate
    pl._cbPunchAt = this.now;
    this.anim(pl, 'slap');
    const yaw = typeof d?.yaw === 'number' ? d.yaw : pl.yaw ?? 0;
    const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const o = V(pl.p);
    // a crowd walker in reach → becomes a real (host) person on every peer
    let target: Ent | null = null;
    if (d?.walker && Array.isArray(d.walker.p) && typeof d.walker.key === 'string' && d.walker.look) {
      const wp = V(d.walker.p);
      if (wp.distanceTo(o) < 2.4) {
        const kind = KIND_OF_ARCH[d.walker.arch] ?? 'coward';
        target = this.spawnNpc(kind, wp, 'cb_victim', d.walker.look, d.walker.yaw);
        this.game.emit('combat:takeover', { key: d.walker.key });
      }
    }
    if (!target) {
      let best = 1e9;
      for (const e of this.game.state.all('npc')) {
        if (!e.p) continue;
        _a.set(e.p[0] - o.x, 0, e.p[2] - o.z);
        const dd = _a.length();
        if (dd > 1.75 || dd < 0.05) continue;
        if (_a.normalize().dot(dir) < 0.4) continue;
        if (dd < best) { best = dd; target = e; }
      }
    }
    if (!target) { this.game.sfx('whoosh_swing', pl.p, { vol: 0.5, pitch: 1.3 }); return; }
    this.hit(target, pl, dir);
  }

  /** a player's punch lands on an npc */
  private hit(e: Ent, by: Ent, dir: THREE.Vector3) {
    const crit = Math.random() < 0.17;
    const dmg = crit ? 48 : 22 + Math.random() * 12;
    const p = [e.p[0], e.p[1] + 1.45, e.p[2]];
    this.game.sfx('slap_hard', p, { vol: crit ? 1 : 0.8, pitch: 0.85 + Math.random() * 0.2 });
    if (crit) this.game.sfx('body_thud', e.p, { vol: 0.7 });
    const isCb = typeof e.role === 'string' && e.role.startsWith('cb_');
    this.game.emit('combat:hit', { to: e.id, by: by.id, p, dir: [dir.x, dir.z], crit });
    this.addHeat(by, isCb ? 1 : 0.5);
    if (!isCb) {
      // gameplay npcs (shopkeepers, customers, the old man …): flinch + swear, nothing else
      this.anim(e, 'get_slapped');
      e.expr = 'angry';
      this.game.say(e.id, cl('flinch'), { style: 'shout', duration: 2 });
      setTimeout(() => { if (this.game.state.get(e.id)) { e.expr = null; this.anim(e, 'angry'); } }, 900);
      this.witnesses(e, by);
      return;
    }
    const b = this.brains.get(e.id) ?? { st: 'idle' as St, t: 0, target: null, next: 0, hits: 0, shots: 0, home: V(e.p) };
    this.brains.set(e.id, b);
    b.hits++;
    if (e.cbSt === 'dead') { this.game.sfx('body_thud', e.p, { vol: 0.4 }); return; }
    e.hp = Math.round((e.hp ?? 100) - dmg);
    if (e.cbSt === 'ko') {
      if (e.hp <= -45) this.kill(e, b, by);
      else { this.anim(e, 'lie_cardboard', true); }
      return;
    }
    // knock back (stays out of walls)
    const kb = crit ? 0.75 : 0.35;
    const h = this.game.physics?.raycast(V(e.p).setY(e.p[1] + 0.9), dir, kb + 0.35, G.STATIC);
    const step = h ? Math.max(0, h.toi - 0.35) : kb;
    const np = V(e.p).addScaledVector(dir, step);
    e.p = [round(np.x, 3), round(this.ground(np.x, np.z), 3), round(np.z, 3)];
    this.face(e, by.p);
    if (e.hp <= 0) { if (crit && Math.random() < 0.35) this.kill(e, b, by); else this.knockOut(e, b, by); return; }
    this.anim(e, 'get_slapped');
    e.expr = 'pain';
    const kind: Kind = e.cbKind ?? 'coward';
    if (kind === 'coward' || (kind === 'tough' && b.hits === 1 && Math.random() < 0.35)) {
      if (kind === 'coward') { this.say(e, 'flee'); this.flee(e, b, by); }
      else { this.say(e, 'push'); this.anim(e, 'angry'); }
    } else {
      if (kind === 'auntie') { e.hold = 'cb_slipper'; this.say(e, 'auntie'); }
      else if (kind === 'cop') this.say(e, 'police');
      else this.say(e, b.hits === 1 ? 'push' : 'fight');
      this.engage(e, b, by.id);
      // the rest of the gang joins
      if (b.group) for (const [id, ob] of this.brains) if (ob.group === b.group && id !== e.id && ob.st !== 'fight' && ob.st !== 'ko' && ob.st !== 'dead') { const o2 = this.game.state.get(id); if (o2) this.engage(o2, ob, by.id); }
    }
    this.witnesses(e, by);
  }

  private engage(e: Ent, b: Brain, target: number) {
    b.target = target;
    this.set(e, b, 'fight');
    e.expr = 'angry';
    this.game.npcs.stop(e);
  }

  private flee(e: Ent, b: Brain, from: Ent) {
    this.set(e, b, 'flee');
    const away = V(e.p).sub(V(from.p)).setY(0).normalize();
    const to = V(e.p).addScaledVector(away, 22);
    this.anim(e, 'scream_run', true);
    e.expr = 'scared';
    this.game.npcs.go(e, to, { speed: 4.6 });
  }

  private knockOut(e: Ent, b: Brain, by: Ent) {
    this.set(e, b, 'ko');
    e.cbSt = 'ko';
    e.hold = null;
    e.expr = 'drunk';
    this.game.npcs.stop(e);
    this.anim(e, 'fall');
    this.game.sfx('body_thud', e.p, { vol: 0.9 });
    this.game.emit('combat:ko', { id: e.id, by: by.id });
    setTimeout(() => { if (this.game.state.get(e.id) && e.cbSt === 'ko') { e.posture = 'lie'; this.anim(e, 'lie_cardboard', true); this.say(e, 'ko', 'speech', 2.5); } }, 900);
    this.addHeat(by, 1.5);
  }

  private kill(e: Ent, b: Brain, by: Ent) {
    this.set(e, b, 'dead');
    e.cbSt = 'dead';
    e.hold = null;
    e.expr = 'sleep';
    e.talking = false;
    this.game.npcs.stop(e);
    if (e.posture !== 'lie') { this.anim(e, 'fall'); setTimeout(() => { if (this.game.state.get(e.id)) { e.posture = 'lie'; this.anim(e, 'lie_cardboard', true); } }, 900); }
    else this.anim(e, 'lie_cardboard', true);
    this.game.sfx('body_thud', e.p, { vol: 1 });
    this.game.emit('combat:dead', { id: e.id, by: by.id });
    this.addHeat(by, 3);
  }

  /** bystanders: cowards run or film, the crowd laughs (crowd.ts reacts to the slap sound) */
  private witnesses(at: Ent, by: Ent) {
    let filmers = 0;
    for (const [id, b] of this.brains) {
      const e = this.game.state.get(id);
      if (!e?.p || e === at || b.st === 'fight' || b.st === 'ko' || b.st === 'dead' || b.st === 'flee' || b.st === 'film') continue;
      const d = this.dist(e, at);
      if (d > 16) continue;
      if (e.cbKind === 'coward' || e.cbKind === 'auntie') {
        if (filmers < 3 && Math.random() < 0.6) {
          filmers++;
          this.set(e, b, 'film');
          b.target = at.id;
          const ring = V(at.p).add(V(e.p).sub(V(at.p)).setY(0).normalize().multiplyScalar(4.5 + Math.random() * 1.5));
          this.game.npcs.go(e, ring, { speed: 2.4, onArrive: () => { if (b.st === 'film') { e.hold = 'cb_phone'; this.face(e, at.p); this.anim(e, 'idle', true); this.say(e, 'film', 'speech'); } } });
        } else this.flee(e, b, by);
      }
    }
  }

  private addHeat(pl: Ent, v: number) {
    const h = (this.heat.get(pl.id) ?? 0) + v;
    this.heat.set(pl.id, h);
    if (h >= 4 && !this.copFor.has(pl.id)) this.dispatchCop(pl);
  }

  private dispatchCop(pl: Ent) {
    if (!pl.p) return;
    let at: THREE.Vector3 | null = null;
    for (let i = 0; i < 10 && !at; i++) {
      const q = this.game.world?.nav.randomPoint(this.game.world.zoneAt(pl.p)?.id) ?? null;
      if (q && q.distanceTo(V(pl.p)) > 18 && q.distanceTo(V(pl.p)) < 40) at = q;
    }
    at ??= this.near(V(pl.p), 20);
    const cop = this.spawnNpc('cop', at, 'cb_cop');
    const b = this.brains.get(cop.id)!;
    b.target = pl.id;
    this.set(cop, b, 'chase');
    this.copFor.set(pl.id, cop.id);
    this.game.sfx('siren_distant', at, { vol: 0.8 });
    this.game.emit('combat:cop', { id: cop.id, pl: pl.id });
  }

  /** a combat npc lands a hit on a player */
  private hurtPlayer(pl: Ent, from: Ent, dmg: number, kind: 'punch' | 'slipper' | 'shot') {
    if (pl.cbDown) return;
    pl.hp = Math.max(0, Math.round((pl.hp ?? 100) - dmg));
    pl._cbHurtAt = this.now;
    const dir = V(pl.p).sub(V(from.p)).setY(0).normalize();
    this.game.emit('combat:hurt', { id: pl.id, by: from.id, dmg, kind, dir: [dir.x, dir.z] });
    if (kind !== 'shot') this.game.sfx(kind === 'slipper' ? 'slap_hard' : 'grunt', pl.p, { vol: 0.8, pitch: kind === 'slipper' ? 1.4 : 0.9 });
    if (pl.hp <= 0) this.downPlayer(pl);
  }

  private downPlayer(pl: Ent) {
    pl.cbDown = true;
    this.game.emit('combat:down', { id: pl.id });
    for (const [id, b] of this.brains) if (b.target === pl.id && (b.st === 'fight' || b.st === 'aim' || b.st === 'chase')) {
      const e = this.game.state.get(id); if (!e) continue;
      this.anim(e, 'laugh'); e.expr = 'smug';
      this.say(e, e.cbKind === 'thug' ? 'gunAway' : 'fight', 'shout');
      this.leave(e, b);
    }
    setTimeout(() => {
      if (!this.game.state.get(pl.id)) return;
      const fine = Math.min(pl.wallet ?? 0, 40);
      if (fine > 0) this.game.money(pl.id, -fine, 'hospital');
      const cart = this.game.state.all('cart')[0];
      const c = cart?.p ?? this.game.world?.anchor('player_spawn')?.p ?? [0, 0, 0];
      pl.hp = 100;
      pl.cbDown = false;
      this.heat.set(pl.id, 0);
      this.game.emit('combat:respawn', { id: pl.id, p: [c[0] + 1.2, c[1], c[2] + 1.2], fine });
    }, 4200);
  }

  private leave(e: Ent, b: Brain) {
    this.set(e, b, 'leave');
    b.target = null;
    setTimeout(() => { if (this.game.state.get(e.id) && b.st === 'leave') { e.hold = null; e.expr = null; this.anim(e, 'walk', true); this.game.npcs.go(e, this.near(V(e.p), 24), { speed: 1.6 }); } }, 1400);
  }

  // ------------------------------------------------------------------ per tick
  update(dt: number) {
    this.now += dt;
    if (!this.enabled || !this.game.world) return;
    const players = this.game.players().filter((p) => p.p);
    // heat decays, players regenerate
    for (const [id, h] of this.heat) this.heat.set(id, Math.max(0, h - dt * 0.05));
    for (const pl of players) {
      if (!pl.cbDown && (pl.hp ?? 100) < 100 && this.now - (pl._cbHurtAt ?? -99) > 5) pl.hp = Math.min(100, Math.round((pl.hp ?? 100) + dt * 10));
    }
    this.population(dt, players);
    for (const [id, b] of [...this.brains]) {
      const e = this.game.state.get(id);
      if (!e || !e.p) { this.brains.delete(id); continue; }
      b.t += dt;
      if (b.talkOff && this.now > b.talkOff) { e.talking = false; b.talkOff = 0; }
      this.think(e, b, dt, players);
    }
  }

  private population(dt: number, players: Ent[]) {
    this.popT -= dt;
    if (this.popT > 0) return;
    this.popT = 2.5;
    const mine = [...this.brains.keys()].map((id) => this.game.state.get(id)).filter((e): e is Ent => !!e && e.role === 'cb_street');
    // despawn far-away street people (not mid-fight)
    for (const e of mine) {
      const b = this.brains.get(e.id)!;
      const near = players.some((p) => this.dist(e, p) < POP_RADIUS + 20);
      if (!near && b.st !== 'fight' && b.st !== 'aim') { this.brains.delete(e.id); this.game.state.despawn(e); }
    }
    const cap = (this.game.engine as any).quality === 'low' ? 4 : 7;
    for (const pl of players) {
      if (pl.cbDown) continue;
      const around = mine.filter((e) => this.game.state.get(e.id) && this.dist(e, pl) < POP_RADIUS).length;
      if (around >= cap) continue;
      const zone = this.game.world!.zoneAt(pl.p);
      if (!zone || !['soi', 'market', 'mainroad', 'office', 'temple', 'canal'].includes(zone.kind)) continue;
      let at: THREE.Vector3 | null = null;
      for (let i = 0; i < 12 && !at; i++) {
        const q = this.game.world!.nav.randomPoint(zone.id);
        const d = q.distanceTo(V(pl.p));
        if (d > 14 && d < POP_RADIUS - 5) at = q;
      }
      if (!at) continue;
      at.y = this.ground(at.x, at.z);
      const r = Math.random();
      if (r < 0.28) {
        // a little gang hanging out (2–3 thugs)
        const g = this.groupN++;
        const n = 2 + (Math.random() < 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const p = this.near(at, k === 0 ? 0.01 : 1.2);
          const e = this.spawnNpc('thug', p, 'cb_street');
          const b = this.brains.get(e.id)!;
          b.group = g;
          this.set(e, b, 'loiter');
          this.face(e, [at.x, at.y, at.z]);
          this.anim(e, k === 0 ? 'stand_cool' : Math.random() < 0.5 ? 'talk' : 'idle', true);
        }
      } else {
        const kind: Kind = r < 0.48 ? 'auntie' : r < 0.66 ? 'tough' : 'coward';
        const e = this.spawnNpc(kind, at, 'cb_street');
        this.set(e, this.brains.get(e.id)!, 'wander');
      }
    }
  }

  private think(e: Ent, b: Brain, dt: number, players: Ent[]) {
    const npcs = this.game.npcs;
    switch (b.st) {
      case 'idle':
      case 'wander': {
        if (b.st === 'wander' && !npcs.isMoving(e) && b.t > b.next) {
          b.t = 0; b.next = 3 + Math.random() * 6;
          const z = this.game.world!.zoneAt(e.p);
          const q = z ? this.game.world!.nav.randomPoint(z.id) : this.near(V(e.p), 10);
          if (q.distanceTo(V(e.p)) < 30) { this.anim(e, 'walk', true); npcs.go(e, q, { speed: 1.1 + Math.random() * 0.4, onArrive: () => this.anim(e, Math.random() < 0.3 ? 'look_around' : 'idle', true) }); }
        }
        break;
      }
      case 'loiter': break;
      case 'flee': {
        if (!npcs.isMoving(e) && b.t > 1) {
          if (e.role === 'cb_victim' || e.role === 'cb_street') {
            // out of sight → gone
            if (!players.some((p) => this.dist(e, p) < 20)) { this.brains.delete(e.id); this.game.state.despawn(e); return; }
            this.set(e, b, 'wander'); e.expr = null; this.anim(e, 'idle', true);
          }
        }
        break;
      }
      case 'film': {
        const t = this.game.state.get(b.target);
        if (!t || b.t > 14) { e.hold = null; this.set(e, b, 'wander'); this.anim(e, 'walk', true); break; }
        if (!npcs.isMoving(e) && t.p) this.face(e, t.p);
        break;
      }
      case 'fight': this.fight(e, b, dt); break;
      case 'aim': this.aim(e, b, dt); break;
      case 'chase': this.chase(e, b); break;
      case 'ko': {
        if (b.t > 10 && e.cbSt === 'ko') {
          e.cbSt = 'ok'; e.posture = 'stand'; e.hp = 40; e.expr = 'angry';
          this.anim(e, 'wake_up');
          this.say(e, 'wake', 'speech');
          this.set(e, b, 'leave');
          setTimeout(() => { if (this.game.state.get(e.id)) { const near = players.find((p) => p.p); if (near) this.flee(e, b, near); } }, 2200);
        }
        break;
      }
      case 'dead': {
        if (b.t > 3 && b.ghost === undefined) {
          const gh: any = (this.game as any).life?.ghosts;
          b.ghost = null;
          if (gh?.summon) {
            const look: Look | undefined = e.look;
            const g = gh.summon(look?.sex === 'f' ? 'white' : 'pret', [e.p[0], e.p[1] + 0.2, e.p[2]], e.yaw ?? 0, { cbFrom: e.id });
            b.ghost = g?.id ?? null;
            if (g) setTimeout(() => { if (this.game.state.get(g.id)) this.game.say(g.id, cl('ghost'), { style: 'speech', duration: 3 }); }, 1500);
          }
        }
        if (b.t > 14 && b.ghost) { (this.game as any).life?.ghosts?.dismiss?.(b.ghost); b.ghost = 0; }
        if (b.t > 22) { this.brains.delete(e.id); this.game.state.despawn(e); }
        break;
      }
      case 'leave': {
        if (!npcs.isMoving(e) && b.t > 3) {
          if (!players.some((p) => this.dist(e, p) < 18) || b.t > 25) {
            if (e.role === 'cb_cop') for (const [pid, cid] of this.copFor) if (cid === e.id) this.copFor.delete(pid);
            this.brains.delete(e.id); this.game.state.despawn(e);
          }
        }
        break;
      }
    }
  }

  private fight(e: Ent, b: Brain, dt: number) {
    const pl = this.playerById(b.target);
    if (!pl?.p || pl.cbDown) { this.leave(e, b); return; }
    const d = this.dist(e, pl);
    if (d > 26) { this.say(e, 'fight'); this.leave(e, b); return; }
    // thugs with a pistol draw it when they're losing
    if (e.gun && (e.hp ?? 100) < 70 && e.cbKind === 'thug') { this.set(e, b, 'aim'); e.hold = 'cb_pistol'; this.say(e, 'gun'); return; }
    const reach = 1.25;
    if (d > reach) {
      b.next -= dt;
      if (b.next <= 0 || !this.game.npcs.isMoving(e)) { b.next = 0.45; this.game.npcs.go(e, V(pl.p), { direct: d < 6, speed: e.cbKind === 'auntie' ? 2.8 : 3.4, radius: 0.9 }); }
      if (e.anim !== 'walk') this.anim(e, 'walk', true);
      return;
    }
    this.game.npcs.stop(e);
    this.face(e, pl.p);
    b.next -= dt;
    if (b.next > 0) return;
    b.next = 1.05 + Math.random() * 0.6;
    this.anim(e, e.cbKind === 'auntie' ? 'slap' : 'slap');
    this.game.sfx('whoosh_swing', e.p, { vol: 0.5 });
    const id = e.id, pid = pl.id;
    setTimeout(() => {
      const e2 = this.game.state.get(id), p2 = this.game.state.get(pid);
      if (!e2?.p || !p2?.p || e2.cbSt !== 'ok' || this.brains.get(id)?.st !== 'fight') return;
      const dd = this.dist(e2, p2);
      _a.set(p2.p[0] - e2.p[0], 0, p2.p[2] - e2.p[2]).normalize();
      _b.set(-Math.sin(e2.yaw ?? 0), 0, -Math.cos(e2.yaw ?? 0));
      // dodge: back off / sidestep and it whiffs
      if (dd < 1.6 && _a.dot(_b) > 0.3) this.hurtPlayer(p2, e2, e2.cbKind === 'auntie' ? 9 : e2.cbKind === 'cop' ? 12 : 15, e2.cbKind === 'auntie' ? 'slipper' : 'punch');
    }, 300);
  }

  private aim(e: Ent, b: Brain, dt: number) {
    const pl = this.playerById(b.target);
    if (!pl?.p || pl.cbDown) { this.leave(e, b); return; }
    const d = this.dist(e, pl);
    this.game.npcs.stop(e);
    this.face(e, pl.p);
    if (d < 3 && b.t < 1.2) {
      // back off a few steps first
      const away = V(e.p).sub(V(pl.p)).setY(0).normalize();
      this.game.npcs.go(e, V(e.p).addScaledVector(away, 2.5), { speed: 2.2, direct: true });
    }
    if (e.anim !== 'point') { this.anim(e, 'point', true); this.game.emit('combat:aim', { id: e.id, to: pl.id }); }
    b.next -= dt;
    if (b.next > 0 || b.t < 0.9) return;
    b.next = 1.4 + Math.random() * 0.5;
    b.shots++;
    const hit = d < 22 && Math.random() < Math.max(0.15, 0.7 - d * 0.035);
    const to = hit ? [pl.p[0], pl.p[1] + 1.25, pl.p[2]] : [pl.p[0] + (Math.random() - 0.5) * 2.4, pl.p[1] + 0.4 + Math.random() * 1.6, pl.p[2] + (Math.random() - 0.5) * 2.4];
    this.game.emit('combat:shot', { from: e.id, to, hit, victim: hit ? pl.id : null });
    this.addHeat(pl, 1);
    if (hit) this.hurtPlayer(pl, e, 42, 'shot');
    if (b.shots >= 3 || pl.cbDown) { e.expr = 'smug'; this.say(e, 'gunAway'); this.leave(e, b); }
  }

  private chase(e: Ent, b: Brain) {
    const pl = this.playerById(b.target);
    if (!pl?.p) { this.leave(e, b); return; }
    const d = this.dist(e, pl);
    if (b.t > 55 || d > 70) { this.say(e, 'policeGone', 'speech'); this.leave(e, b); return; }
    if (d > 1.5) {
      if (!this.game.npcs.isMoving(e) || b.t > b.next) { b.next = b.t + 0.6; this.game.npcs.go(e, V(pl.p), { speed: 3.8, direct: d < 8, radius: 1.1 }); if (e.anim !== 'run') this.anim(e, 'run', true); }
      if (b.t > 1 && b.hits === 0 && Math.random() < 0.01) this.say(e, 'police');
      return;
    }
    // caught: on-the-spot fine
    this.game.npcs.stop(e);
    this.face(e, pl.p);
    this.anim(e, 'lecture', true);
    this.say(e, 'police', 'shout', 3);
    const fine = Math.min(pl.wallet ?? 0, 200);
    if (fine > 0) this.game.money(pl.id, -fine, 'police_fine');
    else this.game.say(e.id, tl('ไม่มีตังค์? งั้นกวาดถนนไป!', 'Broke? Then go sweep the street!'), { style: 'shout', duration: 3 });
    this.heat.set(pl.id, 0);
    this.copFor.delete(pl.id);
    this.leave(e, b);
  }
}
