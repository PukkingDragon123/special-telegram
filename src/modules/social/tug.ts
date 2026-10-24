import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { Input } from '../../core/input';
import { Sound, SoundHandle } from '../../core/audio';
import { F } from '../../core/fonts';
import { clamp, damp, tl } from '../../core/util';
import { yawTo } from '../../game/mapplan';
import { FlyText } from './flytext';
import { Sparkles, SweatDrops, headPos, rigOf, shake } from './fx';
import { pick } from './lines';
import { hostTimers, localTimers, READING_MODES, bump, dist2, anim, isPlayer } from './state';

/* ============================================================================================
 * SNATCH TUG-OF-WAR. Host event 'item:snatch' {by, from, item} (core fires it when someone
 * picks up an item another player holds — also the recipe book while it's being read).
 *   tug entity { t:'tug', a, b, item, mid, dir, pa, pb, phase:'ready'|'pull'|'done', ca, cb, fa, fb, win }
 * Both players: mode 'tug', anim 'tug', side camera. "3-2-1-ดึง!", then MASH LEFT CLICK for 3 s.
 * FAIR UNDER LATENCY: each client counts its own clicks inside its OWN local 3-second window
 * (starting when it sees phase 'pull') and sends running totals; the host takes the final totals
 * (or whatever arrived within a grace period). The item hangs between the two, bodies lean toward
 * the winner, sweat flies; the winner gets the item (items.putInInventory), the loser falls on
 * their butt (anim 'fall').
 * ========================================================================================== */

const READY = 1.7;
const PULL = 3.0;
const GRACE = 1.0;

export function installTug(game: Game, sparks: Sparkles, sweat: SweatDrops) {
  game.volatile.add('tug');

  // ------------------------------------------------------------------ HOST
  game.events.on('item:snatch', (d: { by: number; from: number; item: number }) => {
    if (!game.isHost) return;
    const a = game.state.get(d.by), b = game.state.get(d.from), it = game.state.get(d.item);
    if (!isPlayer(a) || !isPlayer(b) || !it || it.holder !== b.id || !a.p || !b.p) return;
    if (dist2(a.p, b.p) > 3.4) return;
    for (const p of [a, b]) if (p.mode === 'tug' || p.mode === 'sleep') return;
    if (game.state.find('tug', (t) => t.item === it.id)) return;
    const wasB = b.mode;
    // positions: face each other 1.3 m apart around the midpoint
    const mx = (a.p[0] + b.p[0]) / 2, mz = (a.p[2] + b.p[2]) / 2, my = Math.max(a.p[1], b.p[1]);
    let dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const half = 0.66;
    const pa = [mx - dx * half, my, mz - dz * half], pb = [mx + dx * half, my, mz + dz * half];
    game.items.detach(it);
    it.p = [mx, my + 1.08, mz];
    const tug = game.state.spawn('tug', {
      a: a.id, b: b.id, item: it.id, mid: [mx, my, mz], dir: [dx, dz], pa, pb, ya: yawTo(dx, dz), yb: yawTo(-dx, -dz),
      phase: 'ready', ca: 0, cb: 0, fa: false, fb: false, win: null, _t: 0,
    });
    for (const p of [a, b]) { p.mode = 'tug'; anim(p, 'tug', true); }
    if (READING_MODES.includes(wasB)) game.emit('social:interrupt', { id: b.id, by: a.id, reason: 'snatch' });
    game.say(a.id, pick('snatch'), { style: 'shout', duration: 1.4 });
    hostTimers.after(0.7, () => game.say(b.id, pick('snatched'), { style: 'shout', duration: 1.4 }));
    bump(game, 'tugs');
    game.emit('social:tug', { id: tug.id });
  });

  game.onIntent('tug.count', (pl, d: { id: number; n: number; final?: boolean }) => {
    const t = game.state.get(d?.id);
    if (!t || t.t !== 'tug' || t.phase === 'done') return;
    const n = clamp(Math.floor(Number(d.n) || 0), 0, 70);
    if (pl.id === t.a) { t.ca = Math.max(t.ca, n); if (d.final) t.fa = true; }
    else if (pl.id === t.b) { t.cb = Math.max(t.cb, n); if (d.final) t.fb = true; }
  });

  // ------------------------------------------------------------------ CLIENT state
  let mine: { id: number; side: 'a' | 'b'; start: number; n: number; sent: number; lastSend: number; final: boolean; cam: THREE.Vector3; strain: SoundHandle | null; text: FlyText | null; phaseSeen: string; endT: number; } | null = null;
  const texts = new Map<number, { ft: FlyText; key: string }>();
  const strains = new Map<number, SoundHandle>();

  function countdownText(key: string) {
    const big = key === 'ดึง!';
    return new FlyText([{ text: key, style: { font: big ? F.heavy : F.bubbly, size: big ? 150 : 170, weight: 800, color: big ? '#ffde59' : '#fff7e8', stroke: '#2a1408', strokeWidth: 12 } }], { px: 0.0016, stagger: 0.04, dur: 0.35, fly: 0.5, depthTest: false });
  }

  return {
    hostUpdate(dt: number) {
      for (const t of game.state.all('tug')) {
        t._t += dt;
        const a = game.state.get(t.a), b = game.state.get(t.b), it = game.state.get(t.item);
        if (!isPlayer(a) || !isPlayer(b) || !it || it.holder != null || it.in != null) { abort(t, a, b); continue; }
        // item hangs between them, pulled toward the leader
        const lean = (t.ca - t.cb) / (t.ca + t.cb + 6);
        const wob = t.phase === 'pull' ? Math.sin(t._t * 23) * 0.02 : 0;
        it.p = [t.mid[0] - t.dir[0] * lean * 0.32, t.mid[1] + 1.08 + wob, t.mid[2] - t.dir[1] * lean * 0.32];
        it.q = [0, Math.sin((t.ya + Math.PI / 2) / 2), 0, Math.cos((t.ya + Math.PI / 2) / 2)];
        if (t.phase === 'ready' && t._t >= READY) { t.phase = 'pull'; t._t = 0; }
        else if (t.phase === 'pull' && ((t.fa && t.fb) || t._t >= PULL + GRACE)) resolve(t, a, b, it);
      }
    },
    frame(dt: number) {
      const me = game.me;
      // ---- my participation
      if (me && !mine) {
        const t = game.state.find('tug', (x) => (x.a === me.id || x.b === me.id) && x.phase !== 'done');
        if (t) {
          const side = t.a === me.id ? 'a' : 'b';
          const pos = side === 'a' ? t.pa : t.pb;
          game.player?.teleport(pos, side === 'a' ? t.ya : t.yb);
          game.player?.setMode('external');
          mine = { id: t.id, side, start: -1, n: 0, sent: 0, lastSend: 0, final: false, cam: new THREE.Vector3(), strain: null, text: null, phaseSeen: '', endT: 0 };
          Input.setWantLock(true);
        }
      }
      if (mine) {
        const t = game.state.get(mine.id);
        const now = performance.now() / 1000;
        if (t && t.phase === 'pull' && mine.start < 0) mine.start = now;
        if (t && mine.start >= 0 && !mine.final) {
          const inWin = now - mine.start <= PULL;
          if (inWin) {
            let presses = 0;
            if (Input.mousePressed(0)) { presses++; Input.consumeMouse(0); }
            if (Input.wasPressed('Space')) { presses++; Input.consume('Space'); }
            if (presses) {
              mine.n += presses;
              const hp = headPos(game, me!.id);
              Sound.play('grunt', { pos: hp ?? undefined, vol: 0.25, pitch: 1 + Math.random() * 0.3 });
              shake(game, 0.012, 0.12, 0.01, 30);
            }
            if (mine.n !== mine.sent && now - mine.lastSend > 0.1) { mine.sent = mine.n; mine.lastSend = now; game.intent('tug.count', { id: t.id, n: mine.n }); }
          } else {
            mine.final = true;
            game.intent('tug.count', { id: t.id, n: mine.n, final: true });
          }
        }
        // camera: side view framing both
        if (t && game.player && game.player.mode === 'external') {
          const cam = game.camera;
          const mid = new THREE.Vector3(t.mid[0], t.mid[1], t.mid[2]);
          const perp = new THREE.Vector3(-t.dir[1], 0, t.dir[0]);
          const sgn = mine.side === 'a' ? 1 : -1;
          const k = t.phase === 'pull' ? clamp((performance.now() / 1000 - Math.max(0, mine.start)) / PULL) : 0;
          const want = mid.clone().addScaledVector(perp, sgn * (3.1 - k * 0.6)).add(new THREE.Vector3(0, 1.55 - k * 0.15, 0)).addScaledVector(new THREE.Vector3(t.dir[0], 0, t.dir[1]), (mine.side === 'a' ? -0.6 : 0.6));
          if (mine.cam.lengthSq() === 0) mine.cam.copy(cam.position);
          mine.cam.lerp(want, damp(4, dt));
          cam.position.copy(mine.cam);
          cam.lookAt(mid.x, mid.y + 1.05, mid.z);
          if (Math.abs(cam.fov - 55) > 0.1) { cam.fov = 55; cam.updateProjectionMatrix(); }
        }
        if (!t || t.phase === 'done') {
          if (!mine.endT) mine.endT = now;
          if (!t || now - mine.endT > 1.8) {
            if (game.player && game.player.mode === 'external') { game.player.setMode('play'); game.camera.fov = game.player.baseFov; game.camera.updateProjectionMatrix(); }
            mine = null;
          }
        }
      }

      // ---- visuals for every tug (all peers): countdown, lean, sweat, strain
      const seen = new Set<number>();
      for (const t of game.state.all('tug')) {
        seen.add(t.id);
        const mid = new THREE.Vector3(t.mid[0], t.mid[1] + 2.25, t.mid[2]);
        let key = '';
        if (t.phase === 'ready') key = t._k ?? '';
        // derive countdown from local time since first seen
        t._seen ??= performance.now() / 1000;
        const since = performance.now() / 1000 - t._seen;
        if (t.phase === 'ready') key = since < 0.45 ? '3' : since < 0.9 ? '2' : since < 1.35 ? '1' : 'ดึง!';
        else if (t.phase === 'pull' && since < READY + 0.6) key = 'ดึง!';
        else if (t.phase === 'pull') key = 'คลิกรัวๆ!';
        else if (t.phase === 'done' && t.win) key = 'win';
        let tx = texts.get(t.id);
        if (!tx || tx.key !== key) {
          if (tx) { tx.ft.leave(); const old = tx.ft; localTimers.after(0.7, () => old.dispose()); }
          let ft: FlyText | null = null;
          if (key === 'คลิกรัวๆ!') ft = new FlyText([{ text: 'คลิกรัวๆ!', style: { font: F.heavy, size: 92, weight: 800, color: '#ffe9a8', stroke: '#2a1408', strokeWidth: 10 } }, { text: 'MASH LEFT CLICK', style: { font: F.body, size: 34, weight: 700, color: '#fff', stroke: '#2a1408', strokeWidth: 6 } }], { px: 0.0012, depthTest: false });
          else if (key === 'win') {
            const w = game.state.get(t.win);
            ft = new FlyText([{ text: `${w?.name ?? ''} ชนะ!`, style: { font: F.heavy, size: 110, weight: 800, color: '#ffde59', stroke: '#2a1408', strokeWidth: 11 } }], { px: 0.0013, depthTest: false });
          } else if (key) ft = countdownText(key);
          if (ft) { game.scene?.add(ft.mesh); texts.set(t.id, { ft, key }); if (key !== 'win' && key !== 'คลิกรัวๆ!') Sound.play(key === 'ดึง!' ? 'ding_correct' : 'bubble_pop', { pos: mid, vol: 0.7, pitch: key === 'ดึง!' ? 1 : 0.9 + Number(key) * 0.1 }); if (key === 'ดึง!') Sound.play('whoosh_text', { pos: mid, vol: 0.5 }); }
          else texts.delete(t.id);
          tx = texts.get(t.id);
        }
        if (tx) {
          tx.ft.update(dt);
          tx.ft.mesh.position.copy(mid);
          tx.ft.mesh.quaternion.copy(game.camera.quaternion);
          const d = mid.distanceTo(game.camera.getWorldPosition(new THREE.Vector3()));
          tx.ft.mesh.scale.setScalar(clamp(d / 4, 0.6, 3));
        }
        // lean & strain
        const lean = (t.ca - t.cb) / (t.ca + t.cb + 6);
        const intensity = t.phase === 'pull' ? clamp((t.ca + t.cb) / 30, 0.2, 1) : 0.15;
        for (const [pid, sgn] of [[t.a, 1], [t.b, -1]] as [number, number][]) {
          const rig = rigOf(game, pid);
          if (rig?.root) {
            const winning = lean * sgn;
            const target = t.phase === 'done' ? 0 : clamp(0.08 + winning * 0.32, -0.25, 0.4) + Math.sin(performance.now() / 70 + pid) * 0.012 * intensity;
            rig.root.rotation.x += (target - rig.root.rotation.x) * damp(8, dt);
          }
          if (t.phase === 'pull' && Math.random() < dt * 5 * intensity) { const hp = headPos(game, pid); if (hp) sweat.emit(hp.add(new THREE.Vector3(0, -0.12, 0)), 1); }
          let s = strains.get(pid);
          if (t.phase === 'pull' && !s) { s = Sound.loop('tug_strain', { pos: headPos(game, pid) ?? undefined, vol: 0.5 }); strains.set(pid, s); }
          if (s) { const hp = headPos(game, pid); if (hp) s.setPos(hp); s.setVolume(0.35 + intensity * 0.5); s.setPitch(0.9 + intensity * 0.25 + Math.max(0, -lean * sgn) * 0.2); }
          if (t.phase !== 'pull' && s) { s.stop(0.3); strains.delete(pid); }
        }
      }
      for (const [id, tx] of texts) if (!seen.has(id)) { tx.ft.leave(); const old = tx.ft; localTimers.after(0.7, () => old.dispose()); texts.delete(id); }
      // reset leaning of players no longer in a tug
      for (const p of game.players()) {
        if (p.mode === 'tug') continue;
        const rig = rigOf(game, p.id);
        if (rig?.root && Math.abs(rig.root.rotation.x) > 0.001) rig.root.rotation.x += (0 - rig.root.rotation.x) * damp(6, dt);
      }
      for (const [pid, s] of strains) if (!game.state.get(pid) || game.state.get(pid)!.mode !== 'tug') { s.stop(0.3); strains.delete(pid); }
    },
  };

  function resolve(t: Ent, a: Ent, b: Ent, it: Ent) {
    const ma = game.hasSkill(a, 'tug_strong') ? 1.3 : 1, mb = game.hasSkill(b, 'tug_strong') ? 1.3 : 1;
    const sa = t.ca * ma, sb = t.cb * mb;
    const win = sa > sb ? a : sb > sa ? b : b; // tie → the holder keeps it
    const lose = win === a ? b : a;
    t.phase = 'done';
    t.win = win.id;
    if (!game.items.putInInventory(win, it)) game.items.toWorld(it, [win.p[0], win.p[1] + 0.8, win.p[2]], [0, 1, 0]);
    win.mode = 'free';
    anim(win, 'celebrate', true);
    lose.mode = 'down';
    anim(lose, 'fall');
    game.emit('social:tug_end', { id: t.id, win: win.id, lose: lose.id, item: it.id, ca: t.ca, cb: t.cb });
    game.say(win.id, pick('tug_win'), { style: 'shout', duration: 1.8 });
    hostTimers.after(1.0, () => game.say(lose.id, pick('tug_lose'), { duration: 2 }));
    hostTimers.after(1.8, () => { if (game.state.get(win.id) && win.anim === 'celebrate') anim(win, 'idle', true); });
    hostTimers.after(2.3, () => { if (game.state.get(lose.id)) anim(lose, 'wake_up'); });
    hostTimers.after(4.4, () => { const l = game.state.get(lose.id); if (l && l.mode === 'down') { l.mode = 'free'; anim(l, 'idle', true); } });
    hostTimers.after(2.5, () => { if (game.state.get(t.id)) game.state.despawn(t); });
  }

  function abort(t: Ent, a: Ent | undefined, b: Ent | undefined) {
    if (t.phase === 'done') return;
    t.phase = 'done';
    for (const p of [a, b]) if (isPlayer(p) && p.mode === 'tug') { p.mode = 'free'; anim(p, 'fall'); hostTimers.after(2.2, () => { if (game.state.get(p.id)) anim(p, 'wake_up'); }); }
    const it = game.state.get(t.item);
    if (it && it.holder == null && it.in == null) game.items.toWorld(it, it.p ?? t.mid, [0, 1, 0]);
    game.emit('social:tug_end', { id: t.id, win: null, lose: null, item: t.item });
    if (a) game.say(a.id, tl('ของหายไปไหน!?', 'where did it go!?'), { style: 'shout', duration: 1.6 });
    hostTimers.after(1.5, () => { if (game.state.get(t.id)) game.state.despawn(t); });
  }
}

/** visuals on tug end (all peers) */
export function installTugEndFx(game: Game, sparks: Sparkles) {
  game.on('social:tug_end', (d: { win: number | null; lose: number | null }) => {
    if (d.lose != null) {
      const p = headPos(game, d.lose);
      Sound.play('slide_whistle_down', { pos: p ?? undefined, vol: 0.6 });
      localTimers.after(0.75, () => { const q = headPos(game, d.lose!); Sound.play('body_thud', { pos: q ?? undefined, vol: 0.9 }); if (d.lose === game.localPlayerId) shake(game, 0.06, 0.35, 0.05); });
    }
    if (d.win != null) {
      const p = headPos(game, d.win);
      if (p) { sparks.burst(p.add(new THREE.Vector3(0, 0.2, 0)), 40, { color: 0xffe28a, speed: 2, size: 0.05 }); Sound.play('tada', { pos: p, vol: 0.6 }); }
    }
  });
}
