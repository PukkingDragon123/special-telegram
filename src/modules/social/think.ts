import * as THREE from 'three';
import type { Game } from '../../game/game';
import { Input } from '../../core/input';
import { Sound } from '../../core/audio';
import { Ease, clamp } from '../../core/util';
import { Overlay } from '../../ui3d/overlay';
import { Sparkles, headPos, bodyPos, rigOf, shake } from './fx';
import { SkillHeaven, Veil, HEAVEN_LOOK } from './heaven';
import { SkyOpening, ThinkerBeam } from './ascend';

/* ============================================================================================
 * THINK MODE → the SKILL HEAVEN (Tab).
 *  1. UP (street): the first-person camera tilts up to the real sky; right above you the clouds
 *     swirl and part, warm light pours out, god rays stream down onto you, whoosh + angel choir +
 *     dreamy music, the grade brightens and the view goes white.
 *  2. HEAVEN: a separate THREE.Scene (heaven.ts) is rendered instead of the street, which stays
 *     loaded and simulated underneath. Skills are real floating props; aim + click to learn.
 *  3. DOWN: Tab / Esc / Q (or a friend's slap): you look down, drop through the cloud sea into
 *     white, land back in your body looking up, and the camera tilts down to where you were.
 * Replicated as player.mode 'think' (intent 'think.set' {on}). Everyone else sees your body
 * standing still, looking up, inside a faint golden light column — and can SLAP you back down.
 * ========================================================================================== */

const UP_DUR = 2.4;
const DOWN_DUR = 1.45;
const LOOK_UP = 1.3;

const ASCEND_LOOK = { lift: [0.1, 0.085, 0.06] as [number, number, number], gain: [1.22, 1.16, 1.08] as [number, number, number], saturation: 0.92, contrast: 0.88, tint: [1.02, 1.0, 0.97] as [number, number, number] };

const SOUNDS: Record<string, any> = {
  social_heaven_ascend: { files: ['../gen/social/audio/heaven_ascend.mp3'], vol: 0.9, cat: 'sfx', desc: 'Skill Heaven: rising whoosh + angelic choir swell (Mixkit "Big woosh heal choir", Mixkit free licence).' },
  social_heaven_arrive: { files: ['../gen/social/audio/heaven_arrive.mp3'], vol: 0.8, cat: 'sfx', desc: 'Skill Heaven: arrival choir shimmer (Mixkit "Choir magic shine").' },
  social_heaven_choir: { files: ['../gen/social/audio/heaven_choir.mp3'], vol: 0.6, cat: 'music', desc: 'Skill Heaven: soft angelic choir pad (Mixkit "Angelical choir").' },
  social_heaven_learn: { files: ['../gen/social/audio/heaven_learn.mp3'], vol: 0.9, cat: 'sfx', desc: 'Skill learned: choir + harp blessing chime (Mixkit "Choir harp bless").' },
  social_heaven_bless: { files: ['../gen/social/audio/heaven_bless.mp3'], vol: 0.8, cat: 'sfx', desc: 'Skill Heaven: choir bell blessing (Mixkit "Choir bell bless").' },
};

type Phase = 'up' | 'heaven' | 'down';

interface Local {
  phase: Phase;
  t: number;
  p0: number;          // pitch when Tab was pressed
  pFrom: number;       // pitch the descent starts from
  yaw: number;
  fov0: number;
  bloom0: number;
  ao0: boolean;
  amb0: number;
  prevMusic: string;
  prevUnlock: (() => void) | null;
  popped: boolean;
  veilFrom: number;
  openK: number;
  landed: boolean;
}

export function installThink(game: Game, sparks: Sparkles, canStart: () => boolean) {
  Object.assign(Sound.manifest, Object.fromEntries(Object.entries(SOUNDS).filter(([k]) => !Sound.manifest[k])));

  // ------------------------------------------------------------------ HOST
  game.onIntent('think.set', (pl, d: { on: boolean }) => {
    if (d?.on) {
      if (pl.mode && pl.mode !== 'free') return;
      pl.mode = 'think';
      pl.anim = 'think'; pl.animLoop = true; pl.animT = (pl.animT ?? 0) + 1.001;
      game.emit('social:think', { id: pl.id, on: true });
    } else if (pl.mode === 'think') {
      pl.mode = 'free';
      pl.anim = 'idle'; pl.animLoop = true; pl.animT = (pl.animT ?? 0) + 1.001;
      game.emit('social:think', { id: pl.id, on: false });
    }
  });
  game.on('social:think', (d: { id: number; on: boolean }) => {
    if (d.id === game.localPlayerId) return;
    const p = headPos(game, d.id);
    if (p) Sound.play(d.on ? 'sparkle_chime' : 'cloud_poof', { pos: p.add(new THREE.Vector3(0, 0.5, 0)), vol: d.on ? 0.45 : 0.4, pitch: d.on ? 0.8 : 1.3 });
  });

  // ------------------------------------------------------------------ LOCAL
  let local: Local | null = null;
  let heaven: SkillHeaven | null = null;
  let heavenFor = -1;
  let opening: SkyOpening | null = null;
  const veil = new Veil();
  const beams = new Map<number, ThinkerBeam>();
  let lateOff: (() => void) | null = null;
  const _feet = new THREE.Vector3(), _head = new THREE.Vector3(), _look = new THREE.Vector3(), _up22 = new THREE.Vector3(0, 2.2, 0);

  function getHeaven() {
    const me = game.me;
    if (!me) return null;
    if (heaven && heavenFor !== me.id) { heaven.dispose(); heaven = null; }
    if (!heaven) { heaven = new SkillHeaven(game, me); heavenFor = me.id; heaven.prepare(); }
    return heaven;
  }

  function placeWorldCam(pitch: number, yawOff = 0, lift = 0, fov?: number) {
    const pl = game.player, cam = game.camera;
    if (!pl || !local) return;
    cam.position.set(pl.pos.x, pl.pos.y + pl.eye + lift, pl.pos.z);
    cam.rotation.set(pitch, local.yaw + yawOff, 0, 'YXZ');
    if (fov !== undefined && Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  function start() {
    const me = game.me, pl = game.player;
    if (!me || !pl || !game.scene || local) return;
    if (pl.mode !== 'play' || (me.mode && me.mode !== 'free')) return;
    const h = getHeaven();
    if (!h) return;
    game.intent('think.set', { on: true });
    const post = game.engine.post;
    local = {
      phase: 'up', t: 0, p0: pl.pitch, pFrom: LOOK_UP, yaw: pl.yaw, fov0: game.camera.fov, bloom0: post.bloom.intensity, ao0: !!post.ao.enabled,
      amb0: (Sound as any).volumes?.amb ?? 0.8, prevMusic: (Sound as any).musicKey ?? '', prevUnlock: Input.onUnlock, popped: false, veilFrom: 0, openK: 0, landed: false,
    };
    // hand the camera over WITHOUT dropping pointer lock (mouse-look continues in heaven)
    const setLock = Input.setWantLock;
    (Input as any).setWantLock = () => {};
    try { pl.setMode('external'); } finally { (Input as any).setWantLock = setLock; }
    rigOf(game, me.id)?.setFirstPerson?.(true);
    Input.onUnlock = () => stop();
    Overlay.crosshair(false);
    game.interact.clear();
    opening = new SkyOpening();
    game.scene.add(opening.group);
    veil.attach(game.camera);
    veil.k = 0;
    Sound.play('social_heaven_ascend', { vol: 0.9 });
    Sound.music('skill_tree_dreamy', 2.5);
    Sound.setBusVolume('amb', local.amb0 * 0.35);
    if (!lateOff) lateOff = game.engine.onLate(late);
  }

  function late() {
    if (!local) return;
    const post = game.engine.post;
    if (local.phase === 'up') {
      const k = clamp((local.t - 0.6) / 1.6);
      post.setLook(ASCEND_LOOK, k * 0.8);
      post.bloom.intensity = local.bloom0 + 0.9 * k;
    } else if (local.phase === 'heaven') {
      post.setLook(HEAVEN_LOOK, 1);
      post.bloom.intensity = 0.36 + (heaven?.kick ?? 0) * 0.8;
    } else {
      const k = clamp(local.t / 1.0);
      post.bloom.intensity = local.bloom0 + 0.9 * (1 - k);
    }
  }

  function enterHeaven() {
    if (!local || !heaven) return;
    local.phase = 'heaven';
    local.t = 0;
    const post = game.engine.post;
    post.ao.enabled = false;
    post.setDOF(false);
    game.engine.setView(heaven.scene, heaven.camera);
    heaven.arrive();
    veil.k = 0;
    opening && (opening.group.visible = false);
  }

  /** leave heaven (or abort the way up) */
  function stop(popped = false) {
    if (!local) return;
    if (game.me?.mode === 'think') game.intent('think.set', { on: false });
    if (local.phase === 'heaven') {
      if (heaven && !heaven.leaving) {
        heaven.leave(popped);
        local.popped = popped;
        if (popped) { Sound.play('slap_hard', { vol: 0.8 }); shake(game, 0.06, 0.45, 0.05); }
      }
    } else if (local.phase === 'up') {
      // abort mid-way: fall straight back
      const cam = game.camera;
      local.pFrom = cam.rotation.x;
      local.veilFrom = veil.k;
      local.openK = clamp((local.t - 0.35) / 0.8);
      local.phase = 'down';
      local.t = 0;
      local.popped = popped;
      Sound.music(local.prevMusic || '', 1.2);
      if (popped) Sound.play('bonk', { vol: 0.6 });
    }
  }

  function backToWorld() {
    if (!local) return;
    game.engine.setView(game.scene!, game.camera);
    const post = game.engine.post;
    post.ao.enabled = local.ao0;
    local.phase = 'down';
    local.t = 0;
    local.pFrom = LOOK_UP;
    local.veilFrom = 1;
    local.openK = 1;
    veil.attach(game.camera);
    veil.k = 1;
    Sound.music(local.prevMusic || '', 1.5);
  }

  function finish() {
    if (!local) return;
    const pl = game.player, cam = game.camera, post = game.engine.post;
    cam.fov = local.fov0; cam.updateProjectionMatrix();
    post.bloom.intensity = local.bloom0;
    post.ao.enabled = local.ao0;
    Sound.setBusVolume('amb', local.amb0);
    Input.onUnlock = local.prevUnlock;
    veil.k = 0;
    opening?.dispose(); opening = null;
    rigOf(game, game.localPlayerId)?.setFace?.(null as any);
    if (pl && pl.mode === 'external') { pl.pitch = local.p0; pl.setMode('play'); }
    local = null;
  }

  function frameLocal(dt: number) {
    const me = game.me, pl = game.player;
    if (!local || !me || !pl) return;
    local.t += dt;
    const t = local.t;
    // knocked out by the host (slap, snatch, bedtime…) — or the host refused
    if (me.mode !== 'think' && (local.phase === 'heaven' || (local.phase === 'up' && t > 1.0))) {
      if (local.phase === 'heaven' ? !heaven?.leaving : true) stop(true);
    }
    _feet.copy(pl.pos);
    // external mode shows the body; the camera sits inside the head, so keep our own body first-person
    if (local.phase !== 'heaven') { const rig = rigOf(game, me.id); if (rig && rig.mode !== 'fp') rig.setFirstPerson?.(true); }
    if (local.phase === 'up') {
      const k = Ease.inOutCubic(clamp(t / 1.5));
      placeWorldCam(THREE.MathUtils.lerp(local.p0, LOOK_UP, k), 0, 0, THREE.MathUtils.lerp(local.fov0, 80, k));
      opening?.update(dt, clamp((t - 0.3) / 0.7), Ease.inOutCubic(clamp((t - 0.55) / 1.4)), _feet, local.yaw, game.camera);
      veil.k = Ease.inQuad(clamp((t - 1.6) / (UP_DUR - 1.6)));
      if (t > 1.25 && t - dt <= 1.25) sparks.burst(_head.copy(_feet).add(_up22), 40, { color: 0xffe6a8, color2: 0xffffff, speed: 1.2, size: 0.05, life: 1.2, up: 1.5 });
      if (t > 0.3 && (Input.wasPressed('Tab') || Input.wasPressed('Escape'))) { Input.consume('Tab'); Input.consume('Escape'); stop(); }
      else if (t >= UP_DUR) enterHeaven();
    } else if (local.phase === 'heaven') {
      const allow = !Input.blocked;
      if (heaven) {
        heaven.update(dt, allow);
        if (!heaven.leaving && (Input.wasPressed('Tab') || Input.wasPressed('Escape') || Input.wasPressed('KeyQ'))) {
          Input.consume('Tab'); Input.consume('Escape'); Input.consume('KeyQ');
          stop();
        }
        if (heaven.done) backToWorld();
      } else backToWorld();
    } else {
      // DOWN: land back in the body, looking up, then tilt down to where you were
      const k = Ease.outCubic(clamp(t / (DOWN_DUR - 0.15)));
      const lift = local.veilFrom >= 1 ? 0.75 * (1 - k) - Math.sin(clamp((t - 0.55) / 0.45) * Math.PI) * 0.06 : 0;
      placeWorldCam(THREE.MathUtils.lerp(local.pFrom, local.p0, k), 0, lift, THREE.MathUtils.lerp(local.fov0 + 8, local.fov0, k));
      veil.k = local.veilFrom * (1 - Ease.inOutQuad(clamp(t / 0.75)));
      const ok = local.openK * (1 - clamp(t / 1.0));
      opening?.update(dt, ok, ok, _feet, local.yaw, game.camera);
      if (!local.landed && t > 0.55) {
        local.landed = true;
        Sound.play('body_thud', { vol: local.popped ? 0.5 : 0.22, pitch: 1.2 });
        if (local.popped) shake(game, 0.05, 0.35, 0.04);
      }
      if (t >= DOWN_DUR) finish();
    }
  }

  // ------------------------------------------------------------------ remote thinkers: still body, looking up, light column
  function frameRemote(dt: number) {
    const seen = new Set<number>();
    for (const p of game.players()) {
      if (p.mode !== 'think' || p.id === game.localPlayerId) continue;
      seen.add(p.id);
      let b = beams.get(p.id);
      if (!b) { b = new ThinkerBeam(); beams.set(p.id, b); game.scene?.add(b.group); }
      b.target = 1;
      const feet = bodyPos(game, p.id, _feet);
      b.update(dt, feet);
      const rig = rigOf(game, p.id);
      if (rig && feet) {
        const yaw = p.yaw ?? 0;
        _look.set(feet.x - Math.sin(yaw) * 1.2, feet.y + 6, feet.z - Math.cos(yaw) * 1.2);
        rig.lookAt?.(_look);
        rig.setFace?.('think');
      }
    }
    for (const [id, b] of beams) {
      if (seen.has(id)) continue;
      if (b.target !== 0) {
        b.target = 0;
        const rig = rigOf(game, id);
        rig?.lookAt?.(null);
        rig?.setFace?.(null as any);
        const hp = headPos(game, id);
        if (hp && game.state.get(id)) sparks.burst(hp.add(new THREE.Vector3(0, 0.6, 0)), 30, { color: 0xfff0c8, color2: 0xffffff, speed: 1.6, size: 0.06, life: 0.7 });
      }
      b.update(dt, bodyPos(game, id, _feet));
      if (b.gone || !game.state.get(id)) { b.dispose(); beams.delete(id); }
    }
  }

  return {
    /** build the heaven + compile its shaders ahead of the first Tab (avoids a hitch) */
    prewarm() {
      const h = getHeaven();
      const r: any = game.engine.renderer;
      if (!h || !r?.compileAsync) return;
      h.prepare().then(() => r.compileAsync(h.scene, h.camera)).catch(() => {});
    },
    get active() { return !!local && local.phase !== 'down'; },
    get debug() { return local ? { phase: local.phase, t: local.t, heaven: heaven?.phase, env: !!heaven?.scene.environment, locked: Input.locked } : null; },
    /** QA helpers */
    get heaven() { return heaven; },
    /** QA: go straight up (skips the look-up), for quick screenshots */
    qaEnter() { if (!local && canStart()) start(); if (local && local.phase === 'up') local.t = UP_DUR; },
    stop,
    onUnlock(d: { id: number; skill: string }) {
      if (d.id !== game.localPlayerId || !local || local.phase !== 'heaven') return;
      heaven?.onUnlocked(d.skill);
    },
    frame(dt: number) {
      const me = game.me, pl = game.player;
      if (pl && me && Input.wasPressed('Tab') && !local) {
        Input.consume('Tab');
        if (canStart()) start();
      }
      frameLocal(dt);
      frameRemote(dt);
    },
    dispose() {
      if (local) {
        Input.onUnlock = local.prevUnlock;
        Sound.setBusVolume('amb', local.amb0);
        game.engine.post.ao.enabled = local.ao0;
        local = null;
      }
      opening?.dispose(); opening = null;
      veil.mesh.removeFromParent();
      heaven?.dispose(); heaven = null; heavenFor = -1;
      for (const b of beams.values()) b.dispose();
      beams.clear();
      lateOff?.(); lateOff = null;
    },
  };
}

export type ThinkCtl = ReturnType<typeof installThink>;
