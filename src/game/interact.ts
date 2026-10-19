import * as THREE from 'three';
import type { Game } from './game';
import type { Ent } from '../sim/state';
import { Input } from '../core/input';
import { TL } from '../core/util';
import { G } from '../sim/physics';
import type { TagHandle } from '../ui3d/bubbles';
import { Overlay } from '../ui3d/overlay';

/**
 * Look-at interaction. Anything with `userData.interact = { kind, eid?, data? }` that is
 * registered via `game.interact.register(obj)` can be targeted from the crosshair.
 * Modules add PROVIDERS that return actions for the current context; the best action per key
 * wins (priority). A tiny diegetic tag near the target shows the options.
 *
 * Keys: E (pick up / interact), LMB (use held item on target / place), RMB (social / alt),
 * F (inspect / read), R (secondary). Q (drop) is handled by the player controller.
 */
export type ActKey = 'E' | 'LMB' | 'RMB' | 'F' | 'R';

export interface Action {
  key: ActKey;
  label: TL;
  /** continuous while the key is held (pouring, stirring, washing…) */
  hold?: boolean;
  priority?: number;
  /** shown but not runnable (with reason) */
  disabled?: TL;
  run?(ctx: Ctx): void;
  tick?(ctx: Ctx, dt: number): void;
  end?(ctx: Ctx): void;
  /** override tag text (e.g. live "1 g กำลังเท") */
  status?: () => string;
}

export interface Hit {
  object: THREE.Object3D;   // the registered root
  mesh: THREE.Object3D;     // the exact mesh hit
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  kind: string;
  eid?: number;
  ent?: Ent;
  data?: any;
}

export interface Ctx {
  game: Game;
  me: Ent;
  held: Ent | null;
  hit: Hit | null;
  /** static/item surface under the crosshair (for placing), within reach */
  surface: { point: THREE.Vector3; normal: THREE.Vector3; dist: number; eid?: number } | null;
  camera: THREE.Camera;
}

export type Provider = (ctx: Ctx) => Action | Action[] | null | undefined | void;

const KEY_LABEL: Record<ActKey, string> = { E: 'E', LMB: 'คลิก', RMB: 'คลิกขวา', F: 'F', R: 'R' };
const keyDown = (k: ActKey) => (k === 'LMB' ? Input.mouseDown(0) : k === 'RMB' ? Input.mouseDown(2) : Input.isDown('Key' + k));
const keyPressed = (k: ActKey) => (k === 'LMB' ? Input.mousePressed(0) : k === 'RMB' ? Input.mousePressed(2) : Input.wasPressed('Key' + k));

export class Interaction {
  private targets = new Set<THREE.Object3D>();
  private providers: { fn: Provider; order: number }[] = [];
  private ray = new THREE.Raycaster();
  private tag: TagHandle | null = null;
  private holding: { action: Action; key: ActKey; ctx: Ctx } | null = null;
  enabled = true;
  reach = 2.7;
  current: Hit | null = null;
  actions: Action[] = [];
  /** Global "first time" hints already shown */
  private hinted = new Set<string>();

  constructor(private game: Game) {}

  register(obj: THREE.Object3D, meta?: { kind: string; eid?: number; data?: any; reach?: number }) {
    if (meta) obj.userData.interact = meta;
    this.targets.add(obj);
  }
  unregister(obj: THREE.Object3D) { this.targets.delete(obj); }

  /** Add an action provider. Lower `order` runs first; priorities decide conflicts per key. */
  provide(fn: Provider, order = 0) {
    this.providers.push({ fn, order });
    this.providers.sort((a, b) => a.order - b.order);
  }

  private findRoot(o: THREE.Object3D): THREE.Object3D | null {
    let c: THREE.Object3D | null = o;
    while (c) { if (c.userData.interact && this.targets.has(c)) return c; c = c.parent; }
    return null;
  }

  private raycastTargets(cam: THREE.Camera, excludeHeld: Set<number>): Hit | null {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    this.ray.far = 6;
    const list = [...this.targets].filter((t) => t.visible && t.parent);
    const hits = this.ray.intersectObjects(list, true);
    for (const h of hits) {
      const root = this.findRoot(h.object);
      if (!root) continue;
      const meta = root.userData.interact;
      if (meta.eid !== undefined && excludeHeld.has(meta.eid)) continue;
      if (h.distance > (meta.reach ?? this.reach)) continue;
      if (!isVisibleChain(h.object)) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { object: root, mesh: h.object, point: h.point.clone(), normal: n, dist: h.distance, kind: meta.kind, eid: meta.eid, ent: meta.eid !== undefined ? this.game.state.get(meta.eid) : undefined, data: meta.data };
    }
    return null;
  }

  /** Called every frame by the player controller while in free first-person mode. */
  update(dt: number, cam: THREE.Camera) {
    const game = this.game;
    const me = game.me;
    if (!me || !this.enabled) { this.clear(); return; }
    const held = game.items.selected(me);
    const mine = new Set<number>((me.inv ?? []).filter((x: any) => x !== null));
    const hit = this.raycastTargets(cam, mine);
    // surface for placing
    let surface: Ctx['surface'] = null;
    if (game.physics) {
      const o = cam.getWorldPosition(new THREE.Vector3());
      const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      const h = game.physics.raycast(o, d, this.reach + 0.3, G.STATIC | G.ITEM);
      if (h && h.normal.y > 0.55) surface = { point: h.point, normal: h.normal, dist: h.toi, eid: game.physics.tags.get(h.collider.handle)?.eid };
    }
    if (hit && surface && hit.dist < surface.dist - 0.05) { /* target in front of surface: fine */ }
    const ctx: Ctx = { game, me, held, hit, surface, camera: cam };
    this.current = hit;

    // continuing hold action?
    if (this.holding) {
      const hk = this.holding;
      if (keyDown(hk.key)) { hk.action.tick?.({ ...ctx }, dt); this.showTag(ctx, [hk.action]); return; }
      hk.action.end?.({ ...ctx });
      this.holding = null;
    }

    const overloaded = game.items.isOverloaded(me);
    let acts: Action[] = [];
    if (!overloaded) {
      for (const p of this.providers) {
        let r: any;
        try { r = p.fn(ctx); } catch (e) { console.error('[interact provider]', e); }
        if (!r) continue;
        if (Array.isArray(r)) acts.push(...r.filter(Boolean)); else acts.push(r);
      }
    }
    // best per key
    const best = new Map<ActKey, Action>();
    for (const a of acts) {
      const cur = best.get(a.key);
      if (!cur || (a.priority ?? 0) > (cur.priority ?? 0)) best.set(a.key, a);
    }
    this.actions = [...best.values()];
    Overlay.crosshair(true, !!hit || this.actions.length > 0);

    for (const a of this.actions) {
      if (a.disabled || !keyPressed(a.key)) continue;
      if (a.key === 'LMB') Input.consumeMouse(0); else if (a.key === 'RMB') Input.consumeMouse(2); else Input.consume('Key' + a.key);
      try {
        a.run?.(ctx);
        if (a.hold) this.holding = { action: a, key: a.key, ctx };
      } catch (e) { console.error('[action]', e); }
      break;
    }
    if (overloaded) this.showOverloaded(ctx);
    else this.showTag(ctx, this.actions);
  }

  private showOverloaded(ctx: Ctx) {
    const anchor = ctx.hit?.point ?? null;
    if (!anchor) { this.tag?.remove(); this.tag = null; return; }
    this.setTag(anchor, 'หนักเกิ๊น! ทำอะไรไม่ได้', '[Q] วางของก่อน');
  }

  private showTag(ctx: Ctx, acts: Action[]) {
    const hit = ctx.hit;
    if (!hit && !acts.length) { this.tag?.remove(); this.tag = null; return; }
    let title = '';
    if (hit?.ent?.t === 'item') title = this.game.items.name(hit.ent).th;
    else if (hit?.data?.name) title = hit.data.name.th ?? hit.data.name;
    const status = acts.find((a) => a.status)?.status?.();
    if (status) title = status;
    const sub = acts.map((a) => `[${KEY_LABEL[a.key]}] ${a.disabled ? '✕ ' + a.disabled.th : a.label.th}`).join('   ');
    if (!title && !sub) { this.tag?.remove(); this.tag = null; return; }
    let pos: THREE.Vector3;
    if (hit) {
      const box = new THREE.Box3().setFromObject(hit.object);
      pos = box.isEmpty() ? hit.point.clone() : new THREE.Vector3((box.min.x + box.max.x) / 2, Math.min(box.max.y, hit.point.y + 0.6), (box.min.z + box.max.z) / 2);
      pos.lerp(hit.point, 0.35);
    } else pos = ctx.surface?.point.clone() ?? new THREE.Vector3();
    this.setTag(pos, title || ' ', sub || undefined);
  }

  private tagPos = new THREE.Vector3();
  private setTag(pos: THREE.Vector3, title: string, sub?: string) {
    this.tagPos.lerp(pos, this.tag ? 0.35 : 1);
    if (!this.tag) this.tag = this.game.ui.tag(() => this.tagPos, title, sub, { offset: 0.08 });
    else this.tag.set(title, sub);
  }

  clear() {
    if (this.holding) { this.holding.action.end?.(this.holding.ctx); this.holding = null; }
    this.tag?.remove();
    this.tag = null;
    this.current = null;
    this.actions = [];
  }

  /** Show a one-time hint at the bottom of the screen. */
  hintOnce(id: string, text: string, sec = 5) {
    if (this.hinted.has(id)) return;
    this.hinted.add(id);
    Overlay.showHint(text, sec);
  }
}

function isVisibleChain(o: THREE.Object3D | null) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}
