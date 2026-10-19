import * as THREE from 'three';
import type { Game } from './game';
import type { Action, Ctx } from './interact';
import { tl, params } from '../core/util';
import { noiseMaterial } from '../core/proctex';

/**
 * Built-in interactions every item gets: pick up (E), place on a surface (LMB), put into a
 * container (LMB), take from a container (E). Modules add richer actions with higher priority.
 */
export function installCoreActions(game: Game) {
  const items = game.items;

  game.interact.provide((ctx: Ctx) => {
    const acts: Action[] = [];
    const t = ctx.hit?.ent;
    // ---- E: pick up a free / container item
    if (t && t.t === 'item') {
      const def = items.defOf(t);
      if (def && !def.noPickup && t.holder == null) {
        const kids = def.container ? items.contents(t) : [];
        if (kids.length) {
          acts.push({ key: 'E', label: tl('หยิบจาก' + def.name.th, 'take from'), priority: 1, run: () => game.intent('item.take', { from: t.id }) });
          acts.push({ key: 'F', label: tl('ยกทั้งหมด', 'pick up all'), priority: 0, run: () => game.intent('item.pickup', { id: t.id }) });
        } else {
          const need = def.slots ?? 1;
          const free = items.freeSlots(ctx.me);
          acts.push(free >= need
            ? { key: 'E', label: tl('หยิบ', 'pick up'), priority: 1, run: () => game.intent('item.pickup', { id: t.id }) }
            : { key: 'E', label: tl('หยิบ', 'pick up'), disabled: tl('มือเต็ม', 'hands full') });
        }
      } else if (def && t.holder != null && t.holder !== ctx.me.id) {
        acts.push({ key: 'E', label: tl('แย่ง!', 'snatch!'), priority: 2, run: () => game.intent('item.pickup', { id: t.id }) });
      }
    }
    // ---- LMB with a held item: put into container / place on surface
    if (ctx.held) {
      const held = ctx.held;
      if (t && t.t === 'item' && t.id !== held.id) {
        const cdef = items.defOf(t)?.container;
        const hdef = items.defOf(held);
        if (cdef && hdef && (!cdef.accepts || cdef.accepts(held, hdef)) && items.contents(t).length < cdef.capacity) {
          acts.push({ key: 'LMB', label: tl('ใส่ใน' + (items.defOf(t)?.name.th ?? ''), 'put in'), priority: 1, run: () => game.intent('item.put', { slot: ctx.me.sel ?? 0, into: t.id }) });
        }
      }
      if (ctx.surface && !acts.some((a) => a.key === 'LMB')) {
        const pt = ctx.surface.point;
        acts.push({
          key: 'LMB', label: tl('วาง', 'place'), priority: -10,
          run: () => game.intent('item.place', { slot: ctx.me.sel ?? 0, pos: [pt.x, pt.y, pt.z], yaw: ctx.me.yaw }),
        });
      }
    }
    return acts;
  }, -100);

  // dev-only test item (?debug)
  if (params.has('debug')) {
    game.items.define({
      kind: 'dev_crate', name: tl('ลังทดสอบ', 'dev crate'), weight: 1.5, carry: 'hand',
      build: () => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), noiseMaterial(0xb08a5a, 'grime'));
        m.position.y = 0.11;
        const g = new THREE.Group(); g.add(m); return g;
      },
    });
  }

  // overloaded grumble (host → bubble for everyone)
  game.onIntent('player.overloaded', (pl) => {
    const lines = [tl('หนักกกก!', 'so heavy!'), tl('ไม่ไหวแล้ววว', "can't do it"), tl('หลังจะหักแล้ว!', 'my back!'), tl('ใครก็ได้ช่วยที!', 'someone help!')];
    game.say(pl.id, lines[Math.floor(Math.random() * lines.length)], { style: 'thought', voice: 0, duration: 2.2 });
    game.sfx('grunt', pl.p, { vol: 0.6 });
  });
}

export const _v = new THREE.Vector3();
