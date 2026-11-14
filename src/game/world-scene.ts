import * as THREE from 'three';
import type { Game } from './game';
import type { SceneDef } from './scenes';
import { Physics } from '../sim/physics';
import { LocalPlayer, playerView } from './player';
import { buildStubWorld } from './stubs/world-stub';
import { Overlay } from '../ui3d/overlay';
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
    for (const m of game.modules) {
      if (!m.buildWorld) continue;
      const t = performance.now();
      try { await m.buildWorld(game); } catch (e) { console.error(`[module ${m.id}] buildWorld failed`, e); }
      marks['bw:' + m.id] = Math.round(performance.now() - t);
    }
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
    this.offs.push(game.engine.onFrame((f) => player.update(f.dt)));
    game.events.emit('world:ready', this.scene);
    // compile every visible material now (behind the scene fade), not when it first enters the view — on
    // Windows (ANGLE → D3D11) each program link is a 50–300 ms hitch mid-game otherwise
    await prewarmShaders(game.engine.renderer, this.scene, this.camera, 8000);
  }

  private pauseEl: HTMLDivElement | null = null;
  pause(on: boolean) {
    const game = this.game;
    if (on === !!this.pauseEl) return;
    if (on) {
      game.player?.setMode('frozen');
      Input.setWantLock(false);
      const d = (this.pauseEl = document.createElement('div'));
      d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,8,6,.55);backdrop-filter:blur(3px);z-index:20;cursor:pointer';
      d.innerHTML = `<div style="text-align:center;color:#fff6e2;font-family:'IBM Plex Sans Thai Looped',sans-serif">
        <div style="font:700 64px Kodchasan;-webkit-text-stroke:2px #2f7d32;paint-order:stroke fill;text-shadow:0 4px 0 #1b4d1e">พักก่อน</div>
        <div style="opacity:.8;margin-top:8px">คลิกเพื่อเล่นต่อ · click to resume</div>
        ${game.session.online ? `<div style="margin-top:14px;font:800 20px K2D">ห้อง ROOM: ${game.session.room}</div>` : ''}</div>`;
      d.onclick = () => this.pause(false);
      document.body.appendChild(d);
      if (!game.session.online) game.g.paused = true;
    } else {
      this.pauseEl?.remove();
      this.pauseEl = null;
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

/** renderer.compileAsync (KHR_parallel_shader_compile when available) with a time cap. */
export async function prewarmShaders(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, capMs = 6000) {
  const t0 = performance.now();
  try {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, capMs))]);
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
