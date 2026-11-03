import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { Hit } from '../../game/interact';
import type { AnimName, FaceVariant } from '../../game/contracts';
import { tl, TL } from '../../core/util';
import { LocalTalkers, TalkTarget } from './api';

/* ============================================================================================
 * TalkTargets: entity NPCs (npc / shopkeeper proxy / homeless / ghost / pets) and client-local characters.
 * ========================================================================================== */

const _v = new THREE.Vector3();

/** world position of the middle of an entity's head (rig bone when available) */
export function entityHead(game: Game, eid: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  const views = game.views.of(eid) as any[];
  const rv = views.find((v) => v?.rig?.headWorld);
  if (rv) { try { return rv.rig.headWorld(out); } catch { /* fall through */ } }
  const obj = game.views.objectOf(eid);
  if (obj) {
    const h = (obj.userData.headHeight as number) ?? 1.9;
    return obj.localToWorld(out.set(0, Math.max(0.3, h - 0.32), 0));
  }
  const e = game.state.get(eid);
  return e?.p ? out.set(e.p[0], e.p[1] + 1.55, e.p[2]) : null;
}

function asTL(n: any, fb: TL): TL {
  if (!n) return fb;
  if (typeof n === 'string') return { th: n };
  if (n.th) return n as TL;
  return fb;
}

export function entityTarget(game: Game, e: Ent, name?: any): TalkTarget {
  const role: string = e.t === 'npc' ? String(e.role ?? 'npc') : e.t === 'ghost' ? 'ghost:' + (e.kind ?? '') : String(e.t);
  return {
    kind: 'entity', eid: e.id, key: 'e' + e.id, role,
    name: asTL(e.name ?? name, role.startsWith('ghost') ? tl('ผี', 'ghost') : tl('คนแถวนี้', 'local')),
    head: () => entityHead(game, e.id, new THREE.Vector3()),
    act: (anim?: AnimName, face?: FaceVariant) => game.intent('talk.act', { eid: e.id, anim, face }),
  };
}

/** the TalkTarget behind an interaction hit (null when it is not a person / not talkable kind) */
export function targetFromHit(game: Game, hit: Hit | null): TalkTarget | null {
  if (!hit) return null;
  if (hit.kind === 'local_talk') {
    const key = hit.data?.key;
    return key ? LocalTalkers.map.get(key)?.target ?? null : null;
  }
  let e: Ent | undefined = hit.ent;
  if (hit.kind === 'shopkeeper') {
    const sid = hit.data?.sid ?? hit.ent?.sid;
    e = (hit.eid !== undefined ? game.state.get(hit.eid) : undefined) ?? game.state.find('npc', (n) => n.role === 'shopkeeper:' + sid) ?? undefined;
  }
  if (!e) return null;
  if (e.t === 'npc' || e.t === 'ghost' || e.t === 'cat' || e.t === 'dog') return entityTarget(game, e, hit.data?.name);
  return null;
}

/** find a talk target by role (entity NPCs first, then local talkers) */
export function targetByRole(game: Game, role: string): TalkTarget | null {
  const e = game.state.find('npc', (n) => n.role === role);
  if (e) return entityTarget(game, e);
  for (const { target } of LocalTalkers.map.values()) if (target.role === role) return target;
  return null;
}

export function headOfTarget(t: TalkTarget): THREE.Vector3 | null {
  try { return t.head(); } catch { return null; }
}

export function distTo(t: TalkTarget, p: THREE.Vector3) {
  const h = headOfTarget(t);
  return h ? _v.copy(h).setY(p.y).distanceTo(p) : Infinity;
}
