import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { Game } from '../../game/game';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { CombatHost } from './host';
import { CombatFX } from './fx';
import { defineProps } from './props';

/* ============================================================================================
 * MODULE `combat` — punch people (F). Street characters react by personality: cowards flee or
 * film you on their phones, aunties come at you with a slipper, tough guys shove back, thugs
 * fight (and some pull a pistol when they're losing), a cop shows up after enough trouble and
 * fines you on the spot. NPCs get knocked out (stars) or killed (a ghost rises from the body).
 * If YOU go down: "out cold" screen, hospital fee, wake up at the cart.
 *
 * Host: host.ts (intent 'combat.punch' {yaw, walker?}) · local: this file + fx.ts.
 * Events: combat:hit {to,by,p,dir,crit} · combat:hurt {id,by,dmg,kind,dir} · combat:ko · combat:dead
 *         combat:aim {id,to} · combat:shot {from,to,hit,victim} · combat:down {id} · combat:respawn {id,p,fine}
 *         combat:takeover {key} (a crowd walker became a real npc) · combat:cop {id,pl}
 * Public: (game as any).combat = { host, fx }.  Dev: window.__combat.
 * ========================================================================================== */

let host: CombatHost | null = null;
let fx: CombatFX | null = null;
let cooldown = 0;
let downLocal = false;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _h = new THREE.Vector3();

function rigOf(game: Game, id: number): any {
  return (game.views.of(id).find((v: any) => v.rig) as any)?.rig ?? null;
}
function headOf(game: Game, id: number): THREE.Vector3 | null {
  const e = game.state.get(id);
  if (!e?.p) return null;
  const obj = game.views.objectOf(id);
  if (obj) { const h = (obj.userData.headHeight as number) ?? 1.7; return obj.localToWorld(_h.set(0, e.posture === 'lie' ? 0.35 : h - 0.15, 0)).clone(); }
  return new THREE.Vector3(e.p[0], e.p[1] + 1.6, e.p[2]);
}

/** the crowd walker (client-local, life/crowd.ts) right in front of the player, if any */
function walkerInFront(game: Game, yaw: number): any | null {
  const crowd: any = (game as any).life?.crowd;
  const walkers: Map<string, any> | undefined = crowd?.walkers;
  const me = game.player;
  if (!walkers || !me) return null;
  _o.copy(me.pos);
  _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  let best: any = null, bd = 1e9;
  for (const w of walkers.values()) {
    if (w.gone || !w.pos || w.pos.lengthSq() === 0) continue;
    const dx = w.pos.x - _o.x, dz = w.pos.z - _o.z, d = Math.hypot(dx, dz);
    if (d > 1.8 || d < 0.05) continue;
    if ((dx * _d.x + dz * _d.z) / d < 0.45) continue;
    if (d < bd) { bd = d; best = w; }
  }
  if (!best) return null;
  let look: any = null;
  try { look = crowd.lookFor?.('w' + best.key, best.arch, best.seed) ?? null; } catch { look = null; }
  if (!look) return null;
  return { key: best.key, p: [best.pos.x, best.pos.y, best.pos.z], yaw: best.yaw ?? 0, arch: best.arch, look };
}

function canPunch(game: Game) {
  const pl = game.player, g: any = game.g;
  if (!pl || pl.mode !== 'play' || downLocal) return false;
  if (game.scenes.currentName !== 'world' || (g.introStep && g.introStep !== 'done')) return false;
  if (game.ui.choosing || (game as any).buildActive || (game as any).questTalking?.()) return false;
  if ((game as any).backrooms?.inside) return false;
  return true;
}

export default defineModule({
  id: 'combat',
  deps: ['characters', 'world', 'life'],
  init(game: Game) {
    defineProps(game);
    host = new CombatHost(game);
    fx = new CombatFX(game);
    (game as any).combat = { host, fx };
    (window as any).__combat = { host: () => host, fx: () => fx };

    game.on('combat:hit', (d: { to: number; by: number; p: number[]; crit: boolean }) => {
      fx!.impact(new THREE.Vector3(d.p[0], d.p[1], d.p[2]), d.crit);
      if (d.by === game.localPlayerId) fx!.shakeCam(d.crit ? 0.55 : 0.3);
    });
    game.on('combat:hurt', (d: { id: number; dmg: number; kind: string }) => {
      if (d.id !== game.localPlayerId) return;
      fx!.hurtFlash(d.kind === 'shot' ? 0.9 : 0.45);
      fx!.shakeCam(d.kind === 'shot' ? 0.8 : 0.45);
      const h = headOf(game, d.id);
      if (h) fx!.impact(h.addScaledVector(game.camera.getWorldDirection(_d), 0.4), d.kind === 'shot');
    });
    game.on('combat:aim', (d: { id: number }) => { const e = game.state.get(d.id); if (e?.p) Sound.play('pickup', { pos: new THREE.Vector3(e.p[0], e.p[1] + 1.2, e.p[2]), vol: 0.5, pitch: 0.5 }); });
    game.on('combat:shot', (d: { from: number; to: number[]; hit: boolean; victim: number | null }) => {
      const rig = rigOf(game, d.from);
      const e = game.state.get(d.from);
      if (!e?.p) return;
      const to = new THREE.Vector3(d.to[0], d.to[1], d.to[2]);
      let mz: THREE.Vector3;
      const hand = rig?.attach?.('hand_r');
      if (hand) { mz = hand.getWorldPosition(new THREE.Vector3()); mz.addScaledVector(to.clone().sub(mz).normalize(), 0.2); }
      else mz = new THREE.Vector3(e.p[0], e.p[1] + 1.35, e.p[2]);
      fx!.muzzle(mz, to, d.hit);
    });
    game.on('combat:down', (d: { id: number }) => {
      if (d.id !== game.localPlayerId) return;
      downLocal = true;
      fx!.hurtFlash(1);
      fx!.knockScreen(true);
      game.player?.setMode('frozen');
      Sound.play('body_thud', { vol: 0.9 });
    });
    game.on('combat:respawn', (d: { id: number; p: number[]; fine: number }) => {
      if (d.id !== game.localPlayerId) return;
      const pl = game.player;
      if (pl) {
        const y = game.world?.groundY(d.p[0], d.p[2]) ?? d.p[1];
        pl.teleport([d.p[0], y, d.p[2]], pl.yaw);
        pl.setMode('play');
      }
      fx!.knockScreen(false);
      downLocal = false;
      if (d.fine > 0) (game as any).hud?.toast?.({ th: `ค่าหมอ −${d.fine} ฿`, en: 'hospital fee' }, { kind: 'bad', dur: 3 });
    });
    game.on('combat:takeover', (d: { key: string }) => {
      const w = (game as any).life?.crowd?.walkers?.get?.(d.key);
      if (w) w.gone = true;
    });
    game.events.on('world:exit', () => { fx?.clear(); downLocal = false; });
  },
  hostUpdate(game: Game, dt: number) {
    host?.update(dt);
  },
  frame(game: Game, dt: number) {
    if (!fx || game.scenes.currentName !== 'world') return;
    cooldown -= dt;
    // ---- punch (F)
    if (Input.wasPressed('KeyF') && cooldown <= 0 && canPunch(game)) {
      cooldown = 0.38;
      const pl = game.player!;
      const yaw = pl.yaw;
      Sound.play('whoosh_swing', { vol: 0.35, pitch: 1.1 + Math.random() * 0.2 });
      fx.punchLunge();
      const walker = game.state.all('npc').some((e) => e.p && Math.hypot(e.p[0] - pl.pos.x, e.p[2] - pl.pos.z) < 1.8) ? null : walkerInFront(game, yaw);
      game.intent('combat.punch', { yaw, walker });
    }
    // ---- knocked-out npcs get stars
    for (const e of game.state.all('npc')) {
      if (typeof e.role !== 'string' || !e.role.startsWith('cb_')) continue;
      fx.setStars(e.id, e.cbSt === 'ko');
    }
    fx.frame(dt, (id) => headOf(game, id));
  },
});
