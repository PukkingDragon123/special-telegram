import * as THREE from 'three';
import type { Game } from './game';
import type { SceneDef } from './scenes';
import { Physics } from '../sim/physics';
import { LocalPlayer, playerView } from './player';
import { buildStubWorld } from './stubs/world-stub';
import { Overlay } from '../ui3d/overlay';
import { PauseMenu, loadExtra, applyExtra } from '../modules/menu/pause';
import { Input } from '../core/input';
import { Sound } from '../core/audio';
import { disposeObject } from '../core/util';

/**
 * The gameplay scene: the Thai street world. Every module's buildWorld() runs here (the `world`
 * module builds the map and sets game.world; others add stations, NPC systems, ambience…).
 */
export class WorldScene implements SceneDef {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.04, 900);
  private offs: (() => void)[] = [];

  constructor(private game: Game) {}

  async enter() {
    const game = this.game;
    this.scene.name = 'world';
    game.scene = this.scene;
    game.camera = this.camera;
    this.scene.add(this.camera);
    game.physics = await Physics.create();
    game.world = null;
    const marks = (window as any).__hpMarks ?? {};
    const tw = performance.now();
    // the `world` module (map, game.world) builds first; every other module then STARTS its buildWorld in the usual
    // order (so their synchronous parts run in the same sequence as before) but their asynchronous tails — model
    // downloads, dressing — overlap instead of queueing one after another
    const run = async (m: (typeof game.modules)[number]) => {
      const t = performance.now();
      try { await m.buildWorld!(game); } catch (e) { console.error(`[module ${m.id}] buildWorld failed`, e); }
      marks['bw:' + m.id] = Math.round(performance.now() - t);
    };
    // dependency-aware: a module still waits for the buildWorld of every module it declares in `deps`
    const withBuild = game.modules.filter((m) => m.buildWorld);
    const done = new Map<string, Promise<void>>();
    for (const m of withBuild.filter((x) => x.id === 'world')) { const p = run(m); done.set(m.id, p); await p; }
    for (const m of withBuild) {
      if (done.has(m.id)) continue;
      const deps = ((m as any).deps as string[] | undefined ?? []).map((d) => done.get(d)).filter(Boolean) as Promise<void>[];
      done.set(m.id, (deps.length ? Promise.all(deps) : Promise.resolve()).then(() => run(m)));
    }
    await Promise.all(done.values());
    marks.buildWorld = Math.round(performance.now() - tw);
    if (!game.world) game.world = buildStubWorld(game);
    game.engine.setView(this.scene, this.camera);
    game.ui.setScene(this.scene, this.camera);
    game.views.activate(this.scene);
    game.items.rebuildBodies();

    const player = new LocalPlayer(game, this.camera);
    game.player = player;
    const me = game.me;
    const hasPos = !!me?.p && (me.p[0] !== 0 || me.p[2] !== 0);
    const a = game.world.anchors['wake_' + (me?.slot ?? 0)] ?? game.world.anchor('player_spawn');
    player.spawn(hasPos ? me!.p! : a.p, hasPos ? me!.yaw ?? 0 : a.yaw ?? 0);
    player.setMode('play');
    Input.onUnlock = () => this.pause(true);
    applyExtra(game, loadExtra());
    // Esc while the pointer is already free (e.g. after closing a dialog) also opens the pause menu
    {
      const onKey = (e: KeyboardEvent) => {
        // only from free play: an Esc that closes a dialog / the book / a choice must not also open the pause menu
        if (e.code !== 'Escape' || this.pauseMenu?.open || Input.locked || this.game.player?.mode !== 'play' || this.game.ui.choosing || (this.game as any).questTalking?.()) return;
        setTimeout(() => this.pause(true), 0);
      };
      window.addEventListener('keydown', onKey);
      this.offs.push(() => window.removeEventListener('keydown', onKey));
    }
    this.offs.push(game.engine.onFrame((f) => player.update(f.dt)));
    game.events.emit('world:ready', this.scene);
    // compile every visible material now (behind the scene fade), not when it first enters the view — on
    // Windows (ANGLE → D3D11) each program link is a 50–300 ms hitch mid-game otherwise
    await prewarmShaders(game.engine.renderer, this.scene, this.camera, 8000);
  }

  // ---- pause (Esc / pointer lock lost) → the in-game pause menu (menu/pause.ts; ui4 owns this function)
  private pauseMenu: PauseMenu | null = null;
  private pauseKeyOff: (() => void) | null = null;
  pause(on: boolean) {
    const game = this.game;
    const menu = (this.pauseMenu ??= new PauseMenu(game, () => this.pause(false)));
    if (on === menu.open) return;
    if (on) {
      // dialogs / the recipe book / choices / cutscenes own Esc first: never stack the pause menu on them
      const pl = game.player;
      if (!pl || pl.mode === 'external' || (pl.mode === 'frozen' && !menu.open) || game.ui.choosing || (game as any).questTalking?.()) return;
      pl.setMode('frozen');
      Input.setWantLock(false);
      menu.show();
      if (!game.session.online) game.g.paused = true;
    } else {
      menu.hide();
      game.g.paused = false;
      game.player?.setMode('play');
    }
  }

  async exit() {
    const game = this.game;
    this.pause(false);
    for (const o of this.offs) o();
    this.offs = [];
    Input.onUnlock = null;
    game.interact.clear();
    game.player?.dispose();
    game.player = null;
    game.views.deactivate();
    game.events.emit('world:exit', this.scene);
    disposeObject(this.scene);
    game.scene = null;
    game.world = null;
    Sound.stopAll(0.5);
    Overlay.crosshair(false);
    Input.setWantLock(false);
  }
}

/** The render target the scene is drawn into each frame (post-processing input), or null (canvas). */
export function compileTarget(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget | null {
  return ((renderer as any).__hpScene as THREE.WebGLRenderTarget | undefined) ?? null;
}

/** renderer.compileAsync (KHR_parallel_shader_compile when available) with a time cap. */
export async function prewarmShaders(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, capMs = 6000) {
  const t0 = performance.now();
  try {
    // compile for the target the scene really renders into (the composer's linear half-float buffer): compiling
    // against the canvas made three build the sRGB-output variant of every program — never used — while the real
    // variants still compiled mid-game (double the load-time compile work AND the hitches it was meant to avoid)
    const target = compileTarget(renderer);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    let p: Promise<unknown>;
    try { p = renderer.compileAsync(scene, camera); } finally { renderer.setRenderTarget(prev); }
    await Promise.race([p, new Promise((r) => setTimeout(r, capMs))]);
  } catch (e) { console.warn('[world] shader prewarm', e); }
  // upload every loaded texture of visible objects now (also behind the fade): no texImage2D + mipmap hitch
  // the first time something turns into view. Time-sliced so the page stays responsive.
  const texs = new Set<THREE.Texture>();
  scene.traverseVisible((o: any) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
      const u = m.uniforms;
      if (u) for (const k in u) { const v = u[k]?.value; if (v && v.isTexture) texs.add(v); }
    }
  });
  let n = 0, t1 = performance.now();
  for (const t of texs) {
    if (performance.now() - t0 > capMs * 2) break;
    const img: any = t.image;
    if (!img || (t as any).isRenderTargetTexture || (img.width === undefined && !(t as any).isDataTexture)) continue;
    try { renderer.initTexture(t); n++; } catch {}
    if (performance.now() - t1 > 30) { await new Promise((r) => setTimeout(r, 0)); t1 = performance.now(); }
  }
  const marks = (window as any).__hpMarks;
  if (marks) { marks.prewarmMs = Math.round(performance.now() - t0); marks.prewarmTex = n; }
}

export function installWorldScene(game: Game) {
  game.registerView('player', playerView(game));
  game.registerView('item', (e) => game.items.makeView(e));
  game.scenes.register('world', () => new WorldScene(game));
}
