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
  const T0 = performance.now();
  const marks: Record<string, number> = ((window as any).__hpMarks = {});
  const mark = (k: string) => { marks[k] = Math.round(performance.now() - T0); };
  Overlay.init();
  Overlay.setLoading(0.03, 'กำลังตั้งเตา…');
  // real progress: boot stages + every tracked asset load while the modules initialise
  let stage = 0.03;
  const show = (label?: string) => {
    const a = Assets.loaded + Assets.pending;
    const k = a ? Assets.loaded / a : 0;
    Overlay.setLoading(Math.min(0.98, stage + (0.97 - stage) * k * 0.6), label);
  };
  Assets.onProgress = () => show();
  // the game bundle, physics and fonts are independent: fetch them in parallel
  const modsP = loadModules();
  await Promise.all([
    loadFonts().then(() => mark('fonts')),
    (Sound.init(), Promise.all([Sound.loadManifest(), Assets.loadManifests()])).then(() => mark('manifests')),
    initRapier().then(() => mark('physics')),
  ]);
  stage = 0.35; show('กำลังโขลกพริก…');

  const engine = new Engine(document.getElementById('app')!);
  mark('engine');
  const game = new Game(engine);
  installCoreEvents(game);
  installCoreActions(game);
  installWorldScene(game);
  game.scenes.register('menu', () => new FallbackMenu(game));

  stage = 0.45; show('กำลังติดแก๊ส…');
  const mods = await modsP;
  mark('modulesLoaded');
  await game.initModules(mods);
  mark('modulesInit');

  game.setSession(Session.local());
  engine.start();
  Assets.onProgress = null;
  Overlay.setLoading(1, 'พร้อมแล้ว!');
  setTimeout(() => Overlay.hideLoading(), 250);
  game.events.on('scene:entered', (n: string) => mark('scene:' + n));
  mark('boot');
  console.info('[boot]', JSON.stringify(marks), engine.gpu.name, engine.gpu.tier, engine.post.quality);

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
