import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Input } from '../../core/input';
import { addInkHull, removeInkHull } from '../../core/ink';
import { Fx, SpeedLines, Puffs, Sparkles, sweatDrop, angerVein, popMark, soundWord } from './fx';

/* =============================================================================================
 * anime — goofy anime energy (docs/ART_STYLE.md §1), client-local, driven by existing events + state:
 *   speed lines (sprint) · sweat drops (stressed customers, bargaining keepers, YOU when orders pile up)
 *   anger veins 💢 (angry customers / mad shopkeepers) · "!" "?" pop marks (shock, notice, shrug)
 *   impact frames (slaps, wok flare-ups, jump scares, big drops) · dust puffs (landing, sprint start,
 *   thrown items, slaps) · sparkles (great dishes, 5-star reviews, level-ups) · comic sound-word stamps
 *   (looped Thai 3D text) · squash-and-stretch on slapped people.
 * Also applies the inverted-hull ink silhouette to every character rig (game.chars.create wrapper),
 * the stray dog & cat and the cooking cart.
 * ============================================================================================= */

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

interface NpcMem { face?: string | null; kst?: string; cs?: string; animT?: number; anim?: string; veinT: number; sweatT: number; markT: number }

class Anime {
  readonly root = new THREE.Group();
  readonly speed = new SpeedLines();
  readonly puffs = new Puffs();
  readonly sparks = new Sparkles();
  private fx: Fx[] = [];
  private npc = new Map<number, NpcMem>();
  private dishes = new Set<number>();
  private dishInit = false;
  private sparkSrc: { id: number; until: number; rate: number; acc: number }[] = [];
  private squash = new Map<THREE.Object3D, number>();
  private scanT = 0;
  private slowT = 0;
  private now = 0;
  private air = 0;
  private wasGrounded = true;
  private lastSpeed = 0;
  private sprintPuffT = 0;
  private meSweatT = 0;
  private meStressUntil = 0;
  private flareT = 0;
  private splashT = 0;
  private hulled = new WeakSet<THREE.Object3D>();

  constructor(private game: Game) {
    this.root.name = 'anime-fx';
    this.root.add(this.speed.mesh, this.puffs.mesh, this.sparks.mesh);
  }

  // ------------------------------------------------------------------ helpers

  private cam() { return this.game.engine.camera; }
  private me() { return this.game.me; }
  private isMe(id: number | null | undefined) { return id != null && id === this.game.localPlayerId; }

  /** head-top world point of an entity (null when gone) */
  head(id: number): THREE.Vector3 | null {
    const g = this.game;
    const o = g.views.objectOf(id);
    if (o && o.parent) {
      const h = ((o.userData.headHeight as number) ?? 1.95) - 0.25;
      return o.localToWorld(new THREE.Vector3(0, h, 0));
    }
    const e = g.state.get(id);
    return e?.p ? new THREE.Vector3(e.p[0], e.p[1] + 1.7, e.p[2]) : null;
  }
  headFn(id: number) { return () => this.head(id); }
  feet(id: number): THREE.Vector3 | null {
    const o = this.game.views.objectOf(id);
    if (o && o.parent) return o.getWorldPosition(new THREE.Vector3());
    const e = this.game.state.get(id);
    return e?.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
  }
  itemPos(id: number): THREE.Vector3 | null {
    const e = this.game.state.get(id);
    if (!e) return null;
    try { const p = (this.game.items as any).worldPos(e); if (p) return p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]); } catch {}
    return e.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null;
  }
  near(p: THREE.Vector3 | null, d = 24) {
    if (!p) return false;
    return this.cam().getWorldPosition(_v).distanceTo(p) < d;
  }
  /** a point at the upper right of the local view (first-person sweat) */
  private screenCorner = () => {
    const c = this.cam();
    c.getWorldPosition(_v);
    c.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(c.quaternion);
    _r.crossVectors(_f, _u).normalize();
    return _v.clone().addScaledVector(_f, 0.55).addScaledVector(_u, 0.16).addScaledVector(_r, 0.3);
  };

  add(f: Fx | null) {
    if (!f) return;
    this.root.add(f.obj);
    this.fx.push(f);
    if (this.fx.length > 40) { const old = this.fx.shift()!; old.obj.removeFromParent(); old.dispose?.(); }
  }
  word(at: THREE.Vector3 | null, w: string, color?: THREE.ColorRepresentation, size?: number) {
    if (!at || !this.near(at, 20)) return;
    this.add(soundWord(at, w, color, size));
  }
  mark(id: number, m: '!' | '?' | '!!' | '!?', color?: THREE.ColorRepresentation) {
    const mem = this.mem(id);
    if (this.now - mem.markT < 1.2) return;
    mem.markT = this.now;
    if (!this.near(this.head(id), 26)) return;
    this.add(popMark(this.headFn(id), m, color));
  }
  vein(id: number) {
    const mem = this.mem(id);
    if (this.now - mem.veinT < 1.9) return;
    mem.veinT = this.now;
    if (!this.near(this.head(id), 24)) return;
    this.add(angerVein(this.headFn(id)));
  }
  sweat(id: number) {
    const mem = this.mem(id);
    if (this.now - mem.sweatT < 2.2) return;
    mem.sweatT = this.now;
    if (this.isMe(id)) { this.meSweat(); return; }
    if (!this.near(this.head(id), 22)) return;
    this.add(sweatDrop(this.headFn(id), 0.085, Math.random() < 0.5 ? 1 : -1));
  }
  meSweat() {
    if (this.now - this.meSweatT < 1.6) return;
    this.meSweatT = this.now;
    const p = this.game.player;
    if (p && p.mode === 'external') { const id = this.game.localPlayerId; this.add(sweatDrop(this.headFn(id))); return; }
    this.add(sweatDrop(this.screenCorner, 0.032, 0));
  }
  impact(at: THREE.Vector3 | null, k: number) { this.game.engine.post.impact(at, k); }
  private mem(id: number): NpcMem {
    let m = this.npc.get(id);
    if (!m) this.npc.set(id, (m = { veinT: -9, sweatT: -9, markT: -9 }));
    return m;
  }
  doSquash(id: number) {
    const o = this.game.views.objectOf(id);
    if (!o || this.squash.has(o)) return;
    if (Math.abs(o.scale.x - 1) > 1e-3 || Math.abs(o.scale.y - 1) > 1e-3) return;
    this.squash.set(o, 0);
  }

  // ------------------------------------------------------------------ events

  wire() {
    const g = this.game;
    g.on('social:slap', (d: { by: number; to: number }) => {
      const at = this.head(d.to);
      if (!at) return;
      const mine = this.isMe(d.to) || this.isMe(d.by);
      if (mine || this.near(at, 9)) this.impact(this.isMe(d.to) ? null : at, mine ? 1 : 0.7);
      this.word(at.clone().add(_v.set(0, 0.25, 0)), 'เพี๊ยะ!', '#ffe94a', 0.24);
      if (!this.isMe(d.to)) { this.mark(d.to, '!!', '#ff5a3a'); this.doSquash(d.to); }
      const f = this.feet(d.to);
      if (f) this.puffs.burst(f, 6, 0.08, 1.1);
    });
    g.on('shop:slapped', (d: { pid: number }) => {
      const at = this.head(d.pid);
      if (this.isMe(d.pid)) this.impact(null, 1);
      this.word(at, 'เพี๊ยะ!!', '#ffe94a', 0.26);
      this.doSquash(d.pid);
    });
    g.on('cook:flare', (d: { wok: number; k: number }) => {
      const p = this.itemPos(d.wok);
      if (!p) return;
      if ((d.k ?? 0) > 0.5) this.word(p.clone().add(_v.set(0, 0.45, 0)), (d.k ?? 0) > 0.85 ? 'พรึ่บ!!' : 'ฟู่ว!', '#ffb53a', 0.16 + 0.08 * Math.min(1, d.k));
      if ((d.k ?? 0) > 0.85 && this.now - this.flareT > 4 && this.near(p, 3.5)) { this.flareT = this.now; this.impact(p, 0.55); }
    });
    g.on('rest:review', (d: { cid: number; stars: number }) => {
      const at = this.head(d.cid);
      if (!at) return;
      if (d.stars >= 5) {
        for (let i = 0; i < 8; i++) this.sparks.add(at.clone().add(_v.set((Math.random() - 0.5) * 0.6, Math.random() * 0.5, (Math.random() - 0.5) * 0.6)), 0.07, this.headFn(d.cid));
        this.word(at.clone().add(_v.set(0, 0.35, 0)), 'ว้าว!', '#ffd84a', 0.2);
      } else if (d.stars <= 1) this.vein(d.cid);
    });
    g.on('rest:mad', (d: { cid: number; pid: number }) => {
      this.vein(d.cid);
      this.mark(d.cid, '!', '#ff5a3a');
      if (this.isMe(d.pid)) { this.meStressUntil = this.now + 4; this.meSweat(); }
    });
    g.on('shop:choose', (d: { pid: number; seconds: number }) => {
      if (this.isMe(d.pid)) { this.meStressUntil = this.now + (d.seconds ?? 3) + 1; this.meSweat(); }
    });
    g.on('social:levelup', (d: { id: number }) => {
      const at = this.isMe(d.id) && this.game.player?.mode !== 'external' ? this.screenCorner().addScaledVector(_r, -0.3) : this.head(d.id);
      if (!at) return;
      for (let i = 0; i < 10; i++) this.sparks.add(at.clone().add(_v.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.4, (Math.random() - 0.5) * 0.5)), 0.05);
      this.word(at.clone().add(_v.set(0, 0.15, 0)), 'ติ๊ง!!', '#9ff0ff', this.isMe(d.id) ? 0.07 : 0.2);
    });
    g.on('life:jumpscare', (d: { player: number }) => {
      if (!this.isMe(d.player)) return;
      this.impact(null, 1);
      this.meSweat();
    });
    g.on('intro:shock', () => this.impact(null, 0.9));
    g.on('shop:zap', (d: { p: number[] }) => {
      const p = new THREE.Vector3(d.p[0], d.p[1], d.p[2]);
      this.word(p, 'ซี๊ด!', '#a8ecff', 0.18);
      if (this.near(p, 4)) this.impact(p, 0.45);
    });
    g.on('wt:splash', (d: { p: number[]; s: number }) => {
      if ((d.s ?? 0) < 0.55 || this.now - this.splashT < 1.2) return;
      this.splashT = this.now;
      this.word(new THREE.Vector3(d.p[0], d.p[1] + 0.3, d.p[2]), 'จ๋อม!', '#8fd8ff', 0.15);
    });
    // host-local events (the host sees these; clients get the replicated consequences)
    g.events.on('item:dropped', (d: { item: number; thrown?: boolean }) => {
      if (!d.thrown) return;
      setTimeout(() => {
        const p = this.itemPos(d.item);
        if (!p || !this.near(p, 18)) return;
        this.puffs.burst(p, 7, 0.07, 1.3);
        this.word(p.clone().add(_v.set(0, 0.25, 0)), 'ตุ้บ!', '#fff3c4', 0.14);
      }, 450);
    });
    g.events.on('life:dog_steal', () => {
      const dog = this.game.state.all('dog')[0];
      if (dog) { this.word(this.head(dog.id), 'งับ!', '#fff3c4', 0.16); this.mark(dog.id, '!?', '#ffd23a'); }
    });
  }

  // ------------------------------------------------------------------ state scans

  private scanNpcs() {
    const g = this.game;
    let stressed = 0;
    const seen = new Set<number>();
    for (const e of g.state.all('npc') as Ent[]) {
      seen.add(e.id);
      const m = this.mem(e.id);
      const role: string = e.role ?? '';
      // shock / scream → "!"
      if (e.face !== m.face) {
        if ((e.face === 'shock' || e.face === 'scream') && m.face !== undefined) this.mark(e.id, e.face === 'scream' ? '!!' : '!', e.face === 'scream' ? '#ff5a3a' : '#ffd23a');
        m.face = e.face;
      }
      if (e.animT !== m.animT) {
        if (m.animT !== undefined) {
          if (e.anim === 'angry') this.vein(e.id);
          else if (e.anim === 'shrug') this.mark(e.id, '?', '#bfe8ff');
        }
        m.animT = e.animT; m.anim = e.anim;
      }
      if (role === 'customer') {
        const mood = e.mood ?? 1;
        const waiting = e.cs !== 'leave' && e.cs !== 'flee' && e.cs !== 'eat';
        if (waiting && mood < 0.15) this.vein(e.id);
        else if (waiting && mood < 0.4) this.sweat(e.id);
        if (waiting && mood < 0.35) stressed++;
        if (e.cs !== m.cs) { if (e.cs === 'flee' && m.cs !== undefined) this.mark(e.id, '!!', '#ff5a3a'); m.cs = e.cs; }
      } else if (role.startsWith('shopkeeper')) {
        const k = e.kst as string;
        if (k !== m.kst) {
          if (m.kst !== undefined) {
            if (k === 'talk' && (m.kst === 'idle' || m.kst === 'fan' || m.kst === 'phone' || m.kst === 'nap' || m.kst === 'count' || m.kst === 'chat')) this.mark(e.id, '!', '#ffd23a');
            if (k === 'mad' || k === 'chase') this.mark(e.id, '!', '#ff5a3a');
          }
          m.kst = k;
        }
        if (k === 'mad' || k === 'chase') this.vein(e.id);
        else if (k === 'bargain') this.sweat(e.id);
      }
    }
    for (const id of this.npc.keys()) if (!seen.has(id) && !g.state.get(id)) this.npc.delete(id);
    // you, when the orders pile up
    if (stressed >= 2 || this.now < this.meStressUntil) this.meSweat();
  }

  private scanDishes() {
    const g = this.game;
    const items = g.state.all('item') as Ent[];
    for (const e of items) {
      if (e.k !== 'dish' || this.dishes.has(e.id)) continue;
      this.dishes.add(e.id);
      if (!this.dishInit) continue;
      const taste = e.data?.taste ?? 0;
      if (taste >= 0.75) {
        this.sparkSrc.push({ id: e.id, until: this.now + (taste >= 0.88 ? 4 : 2.5), rate: taste >= 0.88 ? 14 : 7, acc: 0 });
        const p = this.itemPos(e.id);
        if (p && taste >= 0.88) this.word(p.clone().add(_v.set(0, 0.35, 0)), 'วิ้ง~', '#fff3a0', 0.12);
      }
    }
    this.dishInit = true;
    if (this.dishes.size > 400) { for (const id of this.dishes) if (!g.state.get(id)) this.dishes.delete(id); }
  }

  private hullPets() {
    const g = this.game;
    for (const t of ['dog', 'cat']) {
      for (const e of g.state.all(t) as Ent[]) {
        const o = g.views.objectOf(e.id);
        if (!o || this.hulled.has(o)) continue;
        this.hulled.add(o);
        addInkHull(o, 2.0, { world: t === 'dog' ? 0.022 : 0.014, maxDist: 28, filter: (m) => !!(m as any).isSkinnedMesh });
      }
    }
    // the cooking cart is the hero prop: hull it if it is reasonably light
    for (const e of g.state.all('cart') as Ent[]) {
      const o = g.views.objectOf(e.id);
      if (!o || this.hulled.has(o)) continue;
      let n = 0;
      o.traverse((c: any) => { if (c.isMesh && !c.isInstancedMesh) n++; });
      this.hulled.add(o);
      if (n > 0 && n <= 28) addInkHull(o, 1.6, { maxDist: 20, refDist: 2.5 });
    }
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number) {
    const g = this.game;
    this.now += dt;
    const scene = g.engine.scene;
    if (this.root.parent !== scene) scene.add(this.root);
    const inWorld = !!g.scene && scene === g.scene;
    this.scanT -= dt;
    if (inWorld && this.scanT <= 0) {
      this.scanT = 0.2;
      try { this.scanNpcs(); } catch (e) { console.warn('[anime] npc scan', e); }
      try { this.scanDishes(); } catch (e) { console.warn('[anime] dish scan', e); }
    }
    this.slowT -= dt;
    if (inWorld && this.slowT <= 0) { this.slowT = 1; try { this.hullPets(); } catch {} }
    // ink glow follows the night
    const night = inWorld ? g.clock?.nightFactor ?? 0 : 0;
    g.engine.post.setInk({ glow: 0.1 + 0.32 * night });
  }

  /** after camera follow: everything camera-relative */
  late(dt: number) {
    const g = this.game;
    const cam = this.cam();
    const inWorld = !!g.scene && g.engine.scene === g.scene;
    // ---- speed lines + dust (local player)
    const pl: any = g.player;
    let sprint = 0;
    if (inWorld && pl && pl.mode === 'play') {
      const sp = pl.speedNow ?? 0;
      if (Input.isDown('ShiftLeft') && sp > 4.1) sprint = Math.min(1, (sp - 4.1) / 0.9);
      const grounded = pl.grounded !== false;
      if (!grounded) this.air += dt;
      else {
        if (!this.wasGrounded && this.air > 0.32) {
          this.puffs.burst(pl.pos.clone(), 10, 0.1 + Math.min(0.06, this.air * 0.05), 1.5);
          if (this.air > 0.75) this.word(pl.pos.clone().add(_v.set(0, 0.3, 0)).addScaledVector(cam.getWorldDirection(_f), 0.8), 'ตุ้บ!', '#fff3c4', 0.14);
        }
        this.air = 0;
      }
      this.wasGrounded = grounded;
      this.sprintPuffT -= dt;
      if (grounded && sprint > 0 && this.lastSpeed < 3.2 && this.sprintPuffT <= 0) {
        this.sprintPuffT = 1.2;
        const back = cam.getWorldDirection(_f).setY(0).normalize().multiplyScalar(-0.5);
        this.puffs.burst(pl.pos.clone().add(back), 6, 0.08, 1.0, back.clone().normalize());
      }
      this.lastSpeed = sp;
    }
    this.speed.update(dt, sprint, (cam as THREE.PerspectiveCamera).aspect || 16 / 9);
    // ---- sparkles following great dishes
    for (let i = this.sparkSrc.length - 1; i >= 0; i--) {
      const s = this.sparkSrc[i];
      if (this.now > s.until || !g.state.get(s.id)) { this.sparkSrc.splice(i, 1); continue; }
      s.acc += dt * s.rate;
      while (s.acc >= 1) {
        s.acc -= 1;
        const p = this.itemPos(s.id);
        if (!p) break;
        const id = s.id;
        this.sparks.add(p.add(_v.set((Math.random() - 0.5) * 0.36, 0.05 + Math.random() * 0.22, (Math.random() - 0.5) * 0.36)), 0.035, () => this.itemPos(id));
      }
    }
    this.puffs.update(dt);
    this.sparks.update(dt, cam);
    // ---- squash & stretch
    for (const [o, t0] of this.squash) {
      const t = t0 + dt;
      if (t > 0.7 || !o.parent) { o.scale.set(1, 1, 1); this.squash.delete(o); continue; }
      this.squash.set(o, t);
      const e = Math.exp(-t * 8) * Math.cos(t * 26);
      o.scale.set(1 + 0.13 * e, 1 - 0.17 * e, 1 + 0.13 * e);
    }
    // ---- one-shot effects
    let n = 0;
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      let alive = false;
      try { alive = f.update(dt, cam); } catch (e) { console.warn('[anime] fx', e); }
      if (alive) this.fx[n++] = f;
      else { f.obj.removeFromParent(); f.dispose?.(); }
    }
    this.fx.length = n;
  }
}

let A: Anime | null = null;

function hookCharacters(game: Game) {
  const chars: any = game.chars;
  if (!chars || chars.__inkHooked) return;
  chars.__inkHooked = true;
  const create = chars.create.bind(chars);
  chars.create = (look: any, opts?: { lod?: 'high' | 'low'; castShadow?: boolean }) => {
    const rig = create(look, opts);
    try {
      const low = opts?.lod === 'low';
      addInkHull(rig.root, low ? 1.8 : 2.3, { skinnedOnly: true, maxDist: low ? 24 : 34 });
      const dispose = rig.dispose?.bind(rig);
      if (dispose) rig.dispose = () => { removeInkHull(rig.root); dispose(); };
    } catch (e) { console.warn('[anime] ink hull', e); }
    return rig;
  };
}

export default defineModule({
  id: 'anime',
  deps: ['characters'],
  init(game) {
    hookCharacters(game);
    A = new Anime(game);
    A.wire();
    game.engine.onLate((f) => A?.late(f.rawDt > 0 ? Math.min(0.1, f.dt || f.rawDt) : 0));
    (window as any).__anime = A;
  },
  frame(game, dt) {
    if (game.chars && !(game.chars as any).__inkHooked) hookCharacters(game);
    A?.frame(dt);
  },
});
