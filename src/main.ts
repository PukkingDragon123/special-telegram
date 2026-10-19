import { Engine } from './core/engine';
import { Overlay } from './ui3d/overlay';
import { loadFonts } from './core/fonts';
import { Sound } from './core/audio';
import { Assets } from './core/assets';
import { Input } from './core/input';
import { initRapier } from './sim/physics';
import { Game, installCoreEvents } from './game/game';
import { installWorldScene } from './game/world-scene';
import { installCoreActions } from './game/core-actions';
import { FallbackMenu } from './game/fallback-menu';
import { Session } from './net/session';
import type { GameModule } from './game/contracts';
import { params } from './core/util';

/**
 * Boot: fonts → manifests → physics → engine → game → modules (auto-discovered from
 * src/modules/<name>/index.ts, each `export default defineModule({...})`) → menu.
 */
async function boot() {
  Overlay.init();
  Overlay.setLoading(0.05, 'กำลังตั้งเตา…');
  await loadFonts();
  Overlay.setLoading(0.25, 'กำลังซื้อหมูสับ…');
  Sound.init();
  await Promise.all([Sound.loadManifest(), Assets.loadManifests(), initRapier()]);
  Overlay.setLoading(0.5, 'กำลังโขลกพริก…');

  const engine = new Engine(document.getElementById('app')!);
  const game = new Game(engine);
  installCoreEvents(game);
  installCoreActions(game);
  installWorldScene(game);
  game.scenes.register('menu', () => new FallbackMenu(game));

  Overlay.setLoading(0.7, 'กำลังติดแก๊ส…');
  await game.initModules(await loadModules());

  game.setSession(Session.local());
  engine.start();
  Overlay.setLoading(1, 'พร้อมแล้ว!');
  setTimeout(() => Overlay.hideLoading(), 250);

  (window as any).__hp = { game, engine, Input, Sound, Assets, Overlay };
}

/**
 * Modules are imported lazily and independently so one broken module never takes the game down.
 * ?only=world,characters loads just those (plus nothing else); ?skip=ghosts excludes some.
 */
async function loadModules(): Promise<GameModule[]> {
  const found = import.meta.glob('./modules/*/index.ts') as Record<string, () => Promise<{ default?: GameModule }>>;
  const only = params.get('only')?.split(',').filter(Boolean);
  const skip = new Set(params.get('skip')?.split(',').filter(Boolean) ?? []);
  const entries = Object.entries(found).filter(([path]) => {
    const name = path.split('/')[2];
    return (!only || only.includes(name)) && !skip.has(name);
  });
  const res = await Promise.all(entries.map(async ([path, load]) => {
    try { return (await load()).default ?? null; } catch (e) { console.error(`[modules] failed to load ${path}`, e); return null; }
  }));
  return res.filter(Boolean) as GameModule[];
}

boot().catch((e) => {
  console.error(e);
  Overlay.setLoading(1, 'บูตไม่ขึ้น: ' + (e?.message ?? e));
});
