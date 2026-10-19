import type { Game } from './game';
import { Overlay } from '../ui3d/overlay';

/**
 * Scene switching. The active scene name is REPLICATED as `g.scene` (host decides; clients follow).
 * Modules register scenes in init(): game.scenes.register('menu', () => new MenuScene(game)).
 * Core registers 'world' (gameplay). Built-in fallbacks exist for 'menu' until the menu module lands.
 */
export interface SceneDef {
  /** Build & show. Should call game.engine.setView(scene, camera). */
  enter(params?: any): Promise<void> | void;
  exit?(): Promise<void> | void;
  /** Every frame while active. */
  update?(dt: number): void;
  /** Use a black fade when entering (default true). */
  fade?: boolean;
}

export class SceneManager {
  private defs = new Map<string, () => SceneDef>();
  current: SceneDef | null = null;
  currentName = '';
  private busy = false;
  private pendingParams: any = null;

  constructor(private game: Game) {
    game.engine.onFrame((f) => {
      this.current?.update?.(f.dt);
      const want = game.g.scene;
      if (want && want !== this.currentName && !this.busy) this.goto(want, this.pendingParams);
    });
  }

  register(name: string, factory: () => SceneDef) { this.defs.set(name, factory); }
  has(name: string) { return this.defs.has(name); }

  /** HOST: switch everyone. Clients: request is ignored (they follow g.scene). */
  request(name: string, params?: any) {
    this.pendingParams = params ?? null;
    if (this.game.isHost) this.game.g.scene = name;
  }

  /** Local switch (normally driven by g.scene). */
  async goto(name: string, params?: any) {
    const f = this.defs.get(name);
    if (!f) { console.warn('[scenes] unknown scene', name); this.currentName = name; return; }
    this.busy = true;
    const next = f();
    const fade = next.fade !== false;
    try {
      if (this.current && fade) await Overlay.fade(1, 0.45);
      try { await this.current?.exit?.(); } catch (e) { console.error('[scene exit]', e); }
      this.game.ui.closeAll();
      this.current = next;
      this.currentName = name;
      await next.enter(params);
      this.game.events.emit('scene:entered', name);
    } catch (e) {
      console.error(`[scene ${name}] enter failed`, e);
    } finally {
      if (fade) await Overlay.fade(0, 0.7);
      this.busy = false;
      this.pendingParams = null;
    }
  }
}
