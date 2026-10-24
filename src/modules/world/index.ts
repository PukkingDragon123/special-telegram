import * as THREE from 'three';
import { defineModule } from '../../game/contracts';
import type { WorldAPI, AnchorPt } from '../../game/contracts';
import type { Game } from '../../game/game';
import { ANCHORS, ZONES, zoneAt } from '../../game/mapplan';
import { Assets } from '../../core/assets';
import { RNG } from '../../core/rng';
import { params } from '../../core/util';
import { WB, Kind } from './geo';
import { loadWorldTextures, layerLookup, makeWorldMaterial, makeWorldCutDepth, makeSignMaterial, makeDecalMaterial, makeFoliageMaterial, makeGlassMaterial, U, WorldTex } from './mats';
import { Atlas } from './atlas';
import { Atmosphere, preloadHdris } from './sky';
import { NightLights } from './lights';
import { buildNav, Nav } from './nav';
import { buildStreets, buildBaseGround, Ctx } from './streets';
import { makeProps } from './props';
import { buildRows, ShopCtx } from './shophouse';
import { ROWS, groundHeight } from './layout';
import { loadSigns, SignSys } from './signs';
import { buildSpecial } from './buildings';
import { buildPoles } from './wires';
import { buildMarket } from './market';
import { buildCanal, pendingWater } from './canal';
import { buildRural } from './rural';
import { buildStreetLife } from './dressing';
import { loadFoliage, FoliageSys } from './foliage';
import { installDebug, DebugCam } from './debug';
import { Weather } from './weather';

/**
 * WORLD MODULE — builds ซอยเฮียผัด and its surroundings (see docs/MAP_PLAN.md):
 * shophouses, streets, market, canal, rural edge, wires, lights, sky & day/night, colliders, nav.
 */

interface WorldState {
  game: Game;
  root: THREE.Group;
  atmo: Atmosphere;
  lights: NightLights;
  details: THREE.Mesh[];
  bases: THREE.Mesh[];
  casters: THREE.Mesh[];
  nav: Nav;
  frameN: number;
  dbg: DebugCam | null;
  weather: Weather;
  stats: { drawMeshes: number; tris: number; buildMs: number };
}

let preload: Promise<{ tex: WorldTex; decals: Atlas | null; signs: SignSys | null; fol: FoliageSys | null }> | null = null;
let S: WorldState | null = null;

function startPreload(game: Game) {
  if (preload) return preload;
  preload = (async () => {
    const tp = performance.now();
    const worldMan = await Assets.jsonSafe<any>('textures/world/manifest.json', null);
    const size = game.engine.quality === 'low' ? 256 : 512;
    const atlasSize = game.engine.quality === 'low' ? 2048 : 4096;   // decal / sign / foliage atlases
    const [tex, decals, signs, fol] = await Promise.all([
      loadWorldTextures(size, worldMan).then((r) => { TIMES.texArrays = Math.round(performance.now() - tp); return r; }),
      loadDecals(worldMan, atlasSize).then((r) => { TIMES.decals = Math.round(performance.now() - tp); return r; }).catch((e) => { console.warn('[world] decals', e); return null; }),
      loadSigns(atlasSize).then((r) => { TIMES.signs = Math.round(performance.now() - tp); return r; }).catch((e) => { console.warn('[world] signs', e); return null; }),
      loadFoliage(atlasSize).then((r) => { TIMES.foliage = Math.round(performance.now() - tp); return r; }).catch((e) => { console.warn('[world] foliage', e); return null; }),
    ]);
    return { tex, decals, signs, fol };
  })();
  return preload;
}

/** decal atlas from textures/world (+ our gen/world extras) */
async function loadDecals(man: any, atlasSize = 4096): Promise<Atlas | null> {
  const base = 'textures/world/';
  const D = (id: string, w: number, h: number) => ({ id, url: base + id + '.png', w, h });
  const items = [
    D('decal_puddles', 512, 512), D('decal_oil_stains', 512, 512), D('decal_asphalt_patches', 768, 768), D('decal_gum_spots', 256, 256),
    D('decal_puddles_photo', 1024, 1024), D('decal_oil_stains_photo', 1024, 1024), D('decal_potholes_photo', 1024, 1024), D('decal_moss_photo', 768, 768),
    D('decal_torn_posters_photo', 1024, 1024), D('decal_wall_grime_streaks_photo', 1024, 1024), D('decal_litter_atlas', 1024, 1024),
    D('decal_cigarette_butts_photo', 512, 142), D('decal_gum_spots_photo', 512, 172), D('decal_flyers_loan_cluster_photo', 452, 512),
    D('manhole_round_iron', 384, 384), D('manhole_round_drain', 384, 384), D('manhole_round_electric', 384, 384),
    D('roadline_white_edge_photo', 48, 768), D('roadline_double_yellow_photo', 96, 768), D('roadline_white_worn', 48, 512),
    D('roadline_yellow_worn', 48, 512), D('roadline_double_yellow_worn', 96, 512), D('roadline_white_dashed_photo', 256, 256),
    D('roadmark_zebra_worn_photo', 1024, 768), D('roadmark_zebra_worn', 512, 512),
  ];
  // any extra decals listed in the world manifest (png with alpha)
  if (man) for (const [k, v] of Object.entries<any>(man)) {
    if (items.some((i) => i.id === k)) continue;
    const f = v?.file ?? v?.rgba ?? v?.files?.rgba;
    if (typeof f === 'string' && f.endsWith('.png')) items.push({ id: k, url: f.startsWith('textures') ? f : base + f, w: 512, h: 512 });
  }
  // our own real-photo decals (graffiti, stains, posters) from gen/world
  const gen = await Assets.jsonSafe<any>('gen/world/decals.json', null);
  if (gen) for (const d of gen.items ?? []) items.push({ id: d.id, url: 'gen/world/' + d.file, w: d.w ?? 512, h: d.h ?? 512 });
  return Atlas.build(items, atlasSize, 4);
}

const TIMES: Record<string, number> = {};
(window as any).__worldTimes = TIMES;
async function buildWorld(game: Game) {
  const t0 = performance.now();
  const assets = await startPreload(game);
  TIMES.preloadWait = performance.now() - t0;
  const tex = assets.tex;
  const root = new THREE.Group();
  root.name = 'world';
  const w = new WB(layerLookup(tex));
  const seed = 20261018;
  const rng = new RNG(seed);
  const phys = { box: (c: number[], s: number[], yaw = 0) => { game.physics.addBox(c, s, yaw); } };
  const props = makeProps(w);
  const q = game.engine.quality;
  const lights = new NightLights(q === 'low' ? 4 : q === 'medium' ? 6 : 8);
  const anchors: Record<string, AnchorPt> = JSON.parse(JSON.stringify(ANCHORS));
  const ctx: Ctx = { w, rng, decals: assets.decals, phys };
  const shopCtx: ShopCtx = { w, props, lights, signs: assets.signs, decals: assets.decals, phys, anchors, managed: new Set(['kitchen_shop', 'plastic_shop', 'gas_shop']), fol: assets.fol };

  // ---------------------------------------------------------------- build everything
  const step = (name: string, fn: () => void) => { const t = performance.now(); try { fn(); } catch (e) { console.error('[world] build step failed:', name, e); } const dt = performance.now() - t; TIMES[name] = Math.round(dt); };
  step('streets', () => buildStreets(ctx));
  step('rows', () => buildRows(shopCtx, ROWS));
  const extraHoles: { x0: number; z0: number; x1: number; z1: number }[] = [];
  step('special', () => buildSpecial({ ...shopCtx, rng, holes: extraHoles, fol: assets.fol }));
  step('market', () => buildMarket({ ...shopCtx, rng, fol: assets.fol }));
  step('poles', () => buildPoles({ w, rng, lights, phys, props }));
  step('canal', () => buildCanal({ ...shopCtx, rng, holes: extraHoles, fol: assets.fol }));
  step('rural', () => buildRural({ ...shopCtx, rng, holes: extraHoles, fol: assets.fol }));
  step('life', () => buildStreetLife({ ...shopCtx, rng, fol: assets.fol }));
  step('ground', () => buildBaseGround(ctx, extraHoles));

  // ---------------------------------------------------------------- materials + meshes
  const worldMat = makeWorldMaterial(tex);
  const cutMat = makeWorldMaterial(tex, true);
  const signMat = makeSignMaterial(assets.signs?.atlas.tex ?? new THREE.Texture());
  const decalMat = makeDecalMaterial(assets.decals?.tex ?? new THREE.Texture());
  const fol = makeFoliageMaterial(assets.fol?.atlas.tex ?? new THREE.Texture());
  const mats: Record<Kind, THREE.Material> = { world: worldMat, cut: cutMat, sign: signMat, decal: decalMat, fol: fol.mat, glass: makeGlassMaterial() };
  let tf = performance.now();
  const meshes = w.finalize(mats, { shadows: { world: true, cut: true, sign: false, decal: false, fol: true, glass: false } });
  TIMES.finalize = Math.round(performance.now() - tf);
  const details: THREE.Mesh[] = [];
  const bases: THREE.Mesh[] = [];
  let tris = 0;
  const cutDepth = makeWorldCutDepth(tex);
  for (const m of meshes) {
    if (m.kind === 'fol') m.mesh.customDepthMaterial = fol.depth;
    if (m.kind === 'cut') m.mesh.customDepthMaterial = cutDepth;
    root.add(m.mesh);
    if (m.group === 'detail') details.push(m.mesh); else bases.push(m.mesh);
    tris += (m.mesh.geometry.index?.count ?? 0) / 3;
  }

  for (const o of pendingWater.splice(0)) root.add(o);
  // ---------------------------------------------------------------- atmosphere & lights
  tf = performance.now();
  const atmo = new Atmosphere(game);
  await atmo.loadHdris();
  TIMES.hdri = Math.round(performance.now() - tf);
  atmo.attach(game.scene!);
  lights.build();
  root.add(lights.root);
  game.scene!.add(root);
  if (params.has('time') && game.isHost) {
    const t = Number(params.get('time'));
    if (Number.isFinite(t)) game.g.time = Math.min(23.95, Math.max(4, t));
    if (params.has('freeze')) game.g.freezeTime = true;
  }

  // ---------------------------------------------------------------- nav + API
  tf = performance.now();
  const nav = buildNav(ZONES);
  TIMES.nav = Math.round(performance.now() - tf);
  const api: WorldAPI & Record<string, any> = {
    anchors,
    anchor: (n: string) => anchors[n] ?? ANCHORS[n] ?? { p: [0, 0, 0] },
    zones: ZONES,
    zoneAt,
    nav,
    groundY: (x: number, z: number) => groundHeight(x, z),
    root,
    addNightLight: (l: THREE.Light | THREE.Object3D, intensity?: number) => {
      if (!l.parent) root.add(l);
      lights.addCustom(l, intensity);
    },
    /** extra: a virtual light for the night pool (no shader recompiles) */
    addLightPoint: (p: THREE.Vector3, color: number | THREE.Color = 0xffc080, intensity = 10, range = 10, glow = 0.6) =>
      lights.add({ p: p.clone(), color: color instanceof THREE.Color ? color : new THREE.Color(color), intensity, range, glow, kind: 'custom' }),
    /** 0 day … 1 night (smooth), as used for lights */
    get night() { return atmo.night; },
    /** set false to stop the world from driving the post-processing grade (skill tree, cutscenes) */
    get autoLook() { return atmo.autoLook; },
    set autoLook(v: boolean) { atmo.autoLook = v; },
    weather: { get rain() { return (game.g as any).rain ?? 0; } },
    get rain() { return (game.g as any).rain ?? 0; },
    sunDir: atmo.sunDir,
    stats: { meshes: meshes.length, tris: Math.round(tris), buildMs: 0 },
  };
  game.world = api;

  // bake the environment once and pre-compile every program now (no hitches when walking into new areas)
  tf = performance.now();
  try {
    atmo.update(0.016, game.camera);
    game.engine.renderer.compile(game.scene!, game.camera);
  } catch (e) { console.warn('[world] precompile', e); }
  TIMES.compile = Math.round(performance.now() - tf);
  releaseCpuCopies(game, assets);
  // debug: anchors, fly camera
  const dbg = installDebug(game, root, anchors, nav);
  const weather = new Weather(game, root);
  const casters = meshes.filter((m) => m.mesh.castShadow).map((m) => m.mesh);
  S = { game, root, atmo, lights, details, bases, casters, nav, frameN: 0, dbg, weather, stats: { drawMeshes: meshes.length, tris, buildMs: performance.now() - t0 } };
  api.stats.buildMs = Math.round(performance.now() - t0);
  console.info(`[world] built in ${api.stats.buildMs} ms — ${meshes.length} meshes, ${Math.round(tris / 1000)}k tris, ${lights.points.length} light points`);
  const off = game.events.on('world:exit', () => { off(); dispose(); });
}

/** After the first GPU upload, drop the CPU-side pixel copies of the big textures (~350 MB at high):
 *  texture-array data and the 4096² atlas canvases. The GPU textures stay alive (never disposed). */
let released = false;
function releaseCpuCopies(game: Game, assets: any) {
  if (released) return;
  released = true;
  const R = game.engine.renderer;
  try {
    for (const t of [assets.tex?.alb, assets.tex?.nra]) {
      if (!t) continue;
      R.initTexture(t);
      t.onUpdate = null;
      (t.image as any).data = null;
    }
    for (const a of [assets.decals, assets.signs?.atlas, assets.fol?.atlas]) {
      if (!a?.tex) continue;
      R.initTexture(a.tex);
      const cv = a.canvas ?? a.tex.image;
      if (cv && 'width' in cv) { cv.width = 1; cv.height = 1; }
    }
  } catch (e) { console.warn('[world] release', e); }
}

function dispose() {
  if (!S) return;
  S.atmo.dispose();
  S.weather.dispose();
  S.dbg?.dispose();
  S = null;
}

const _cam = new THREE.Vector3();
function frame(game: Game, dt: number) {
  if (!S || S.game.scene !== game.scene || !game.scene) return;
  U.uTime.value += dt;
  const cam = game.camera;
  // cables stay >= ~1 px wide: radius per metre = 1 / (P11 * viewport height)
  const ph = game.engine.renderer.domElement.height || 1080;
  U.uWirePx.value = 0.9 / (Math.max(0.1, (cam as THREE.PerspectiveCamera).projectionMatrix.elements[5]) * ph);
  S.dbg?.update(dt);
  S.atmo.update(dt, cam);
  cam.getWorldPosition(_cam);
  S.weather.update(dt, _cam, S.atmo);
  S.lights.update(_cam, S.atmo.night, dt);
  U.uWet.value += (((game.g as any).rain ?? 0) - U.uWet.value) * Math.min(1, dt * 0.2);
  // distance-cull small detail meshes
  if ((S.frameN++ & 7) === 0) {
    const far = game.engine.quality === 'low' ? 60 : game.engine.quality === 'medium' ? 80 : 110;
    for (const m of S.details) {
      const bs = m.geometry.boundingSphere!;
      m.visible = bs.center.distanceTo(_cam) - bs.radius < far;
    }
    // shadow casting only near the player (the sun's shadow box is ~70 m wide anyway)
    for (const m of S.casters) {
      const bs = m.geometry.boundingSphere!;
      m.castShadow = m.visible && bs.center.distanceTo(_cam) - bs.radius < 52;
    }
    // big chunks fade into the haze: cull what the fog hides completely
    const fogFar = Math.min(460, 2.2 / Math.max(0.003, S.atmo.fog.density));
    for (const m of S.bases) {
      const bs = m.geometry.boundingSphere!;
      m.visible = bs.center.distanceTo(_cam) - bs.radius < fogFar;
    }
  }
}

export default defineModule({
  id: 'world',
  init(game) { startPreload(game); preloadHdris(); },
  async buildWorld(game) { await buildWorld(game); },
  frame,
  hostUpdate(game, dt) { if (S && S.game === game && game.g.scene === 'world') S.weather.host(dt); },
});
