import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { TL } from '../../core/util';
import { Input } from '../../core/input';
import { MONO, SNEAK, pick } from './lines';

/* ============================================================================================
 * "Talking to yourself" (every peer, local player only). Context-driven inner monologue:
 *  - during the tutorial it fires on its own (sneaking near the old man, running in flip-flops,
 *    crouching, staring at the stars, standing around, holding the first plate…)
 *  - any time in the world, [T] makes you think out loud about your situation (wallet, time of day,
 *    what you're holding) — friends see it as a thought cloud above your head.
 * Lines go through `say` (local.ts: networked 'intro:think' → HUD monologue for you, cloud for others).
 * ========================================================================================== */

type Say = (text: TL, sec?: number) => void;

const fill = (t: TL, w: number): TL => ({ th: t.th.replace('{w}', String(w)), en: t.en?.replace('{w}', String(w)) });

export class Monologue {
  private gap = 6;                 // global quiet time before the next automatic line
  private pools = new Map<string, number>();
  private used = new Map<string, Set<number>>();
  private still = 0;
  private lastPos = new THREE.Vector3();
  private tick = 0;
  private hinted = false;

  constructor(private game: Game, private say: Say) {}

  /** say a line now (scripted beats); pushes the automatic chatter back */
  now(text: TL, sec = 3.4) { this.say(text, sec); this.gap = Math.max(this.gap, sec + 4); }

  private from(key: string, arr: TL[], cool: number, sec = 3.4): boolean {
    if (this.gap > 0 || (this.pools.get(key) ?? 0) > this.tick) return false;
    let u = this.used.get(key);
    if (!u || u.size >= arr.length) { u = new Set(); this.used.set(key, u); }
    let i = Math.floor(Math.random() * arr.length);
    for (let k = 0; k < arr.length && u.has(i); k++) i = (i + 1) % arr.length;
    u.add(i);
    this.say(arr[i], sec);
    this.pools.set(key, this.tick + cool);
    this.gap = sec + 5 + Math.random() * 6;
    return true;
  }

  /** per frame; `step` = g.introStep, `ctx` = what the tutorial knows about the scene */
  frame(dt: number, step: string | undefined, ctx: { old?: THREE.Vector3 | null; cart?: THREE.Vector3 | null; oldAsleep?: boolean }) {
    const game = this.game;
    const pl = game.player;
    const me = game.me;
    this.tick += dt;
    this.gap -= dt;
    if (!pl || !me || game.g.scene !== 'world') return;
    // ---- [T] think out loud (any time in the world, outside menus/conversations)
    if (pl.mode === 'play' && !game.ui.choosing && Input.wasPressed('KeyT')) {
      Input.consume('KeyT');
      this.gap = 0;
      this.pools.set('key', 0);
      this.from('key', this.contextLines(step), 0, 3.6);
      return;
    }
    if (!this.hinted && step === 'done' && pl.mode === 'play') {
      this.hinted = true;
      setTimeout(() => game.interact.hintOnce?.('intro.mono', `กด [T] ${MONO.key.th} · ${MONO.key.en}`, 6), 25000);
    }
    // ---- standing still?
    if (pl.pos.distanceTo(this.lastPos) > 0.35) { this.lastPos.copy(pl.pos); this.still = 0; } else this.still += dt;
    if (pl.mode !== 'play') return;
    if (step === 'sneak') {
      const dOld = ctx.old ? Math.hypot(pl.pos.x - ctx.old.x, pl.pos.z - ctx.old.z) : 99;
      const run = pl.speedNow > 4.2;
      if (run && dOld < 10 && this.from('run', SNEAK.running, 7, 2.6)) return;
      if (dOld < 4 && ctx.oldAsleep && this.from('near', SNEAK.near, 16)) return;
      if (me.crouch && this.from('crouch', SNEAK.crouch, 30)) return;
      if (pl.pitch > 0.55 && this.from('sky', SNEAK.sky, 45)) return;
      if (this.still > 11 && this.from('idle', SNEAK.idle, 18)) return;
      if (this.tick > 6) this.from('approach', SNEAK.approach, 14);
    } else if (step === 'customer') {
      const held = game.items.selected(me);
      if (held?.k === 'dish') this.from('dish', MONO.dish, 25);
    } else if (step === 'lesson') {
      if (this.still > 35) this.from('cook', MONO.cook, 60);
    }
  }

  /** what you'd mumble right now ([T]) */
  private contextLines(step: string | undefined): TL[] {
    const game = this.game, me = game.me;
    const w = Math.round(me?.wallet ?? 0);
    const t = game.clock.time;
    const held = me ? game.items.selected(me) : null;
    const out: TL[] = [];
    if (step === 'sneak') return [...SNEAK.approach, ...SNEAK.idle];
    if (held?.k === 'dish') out.push(...MONO.dish);
    if (t < 6.3 && t > 4.5) out.push(...MONO.dawn);
    else if (game.clock.isNight) out.push(...MONO.night);
    if (w < 30) out.push(...MONO.broke.map((l) => fill(l, w)));
    else if (w >= 300) out.push(...MONO.rich.map((l) => fill(l, w)));
    out.push(...MONO.generic);
    return out.length ? out : [pick(MONO.generic)];
  }
}
