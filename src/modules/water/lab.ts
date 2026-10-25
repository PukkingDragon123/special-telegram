import type { Game } from '../../game/game';
import { params } from '../../core/util';

/**
 * ?waterlab           — wash corner: tap running into a bucket, a basin with floating stuff, things
 *                       dropped into the drum and the jar, and a full bucket that tips over after ~4 s
 *                       (spill → stream → puddle creeping into the floor drain).
 * ?waterlab=canal     — same, but the camera looks at junk splashing into the canal by the bridge.
 * ?waterlab=hose      — the player holds the hose and sprays.
 * Add &rain=1 for rain (world/weather.ts).
 */
export function waterLab(game: Game, o: { splash: (x: number, y: number, z: number, s: number) => void }) {
  if (!game.isHost) return;
  const mode = params.get('waterlab') || 'wash';
  const g = game.g;
  if (!params.has('time')) g.time = 10.5;
  const has = (k: string) => !!game.items.def(k);
  const sp = (k: string, p: number[], opts: any = {}) => (has(k) ? game.items.spawn(k, p, opts) : null);
  const F = 0.15;
  g.wtaps = [1, mode === 'hose' ? 1 : 0];
  // bucket under the running tap (inside the basin)
  sp('water_bucket', [13.08, F + 0.03, -16.3], { data: { water: 3.5, color: 1 } });
  // basin with floating things
  const basin = sp('water_basin', [12.0, F + 0.02, -15.65], { data: { water: 6.5 } });
  if (basin) {
    const put = (k: string, at: number[]) => { const it = sp(k, [12, 1, -15.6], { noPhysics: true }); if (it) { game.items.toContainer(it, basin, at); if (k === 'egg') it._wsink = true; } };
    put('lime', [0.08, 0.075, 0.05, 0.3]);
    put('cup_plastic', [-0.1, 0.07, -0.02, 1.2]);
    put('egg', [0.02, 0.012, -0.12, 0]);
  }
  // things dropped into the drum and the jar → buoyancy in static volumes
  const drops: [string, number[], number[]][] = [
    ['lime', [12.95, 1.6, -15.5], [0, -1, 0]], ['cup_plastic', [13.0, 1.8, -15.55], [0, -0.5, 0]], ['egg', [12.93, 1.9, -15.45], [0, -1, 0]],
    ['takeaway_box', [12.9, 1.7, -17.28], [0, -0.5, 0]], ['garlic', [12.95, 2.0, -17.32], [0, -1, 0]],
  ];
  drops.forEach(([k, p, v], i) => setTimeout(() => sp(k, p, { vel: v }), 500 + i * 450));
  // a full bucket that will tip over toward the drain
  const tip = sp('water_bucket', [12.02, F + 0.02, -16.82], { data: { water: 9.5, color: 3 } });
  setTimeout(() => {
    if (!tip) return;
    const b = game.items.bodyOf?.(tip.id);
    if (b) { b.setAngvel({ x: 0.3, y: 0, z: -6.5 }, true); b.applyImpulse({ x: 1.2, y: 0.4, z: 0 }, true); }
  }, mode === 'spill' ? 2500 : 4200);
  // junk into the canal by the bridge
  const junk = ['cup_plastic', 'takeaway_box', 'stool_red', 'egg', 'lime', 'plastic_bag', 'chopping_board', 'soda_cola_can', 'water_bucket', 'wok', 'garlic', 'cup_plastic', 'takeaway_box', 'stool_blue'];
  junk.forEach((k, i) => setTimeout(() => {
    const x = 4.2 + (i % 5) * 0.9 + Math.random() * 0.4, z = -171.2 + Math.floor(i / 5) * 1.4 + Math.random() * 0.5;
    sp(k, [x, 0.6 + Math.random() * 0.8, z], { vel: [Math.random() - 0.5, -1.5, Math.random() - 0.5], yaw: Math.random() * 6 });
  }, (mode === 'canal' ? 900 : 300) + i * (mode === 'canal' ? 260 : 60)));
  // camera
  setTimeout(() => {
    const pl = game.player;
    if (!pl) return;
    if (mode === 'canal') { pl.teleport([0.6, 0.62, -166.6], -Math.PI / 2 - 0.25); (pl as any).pitch = -0.62; }
    else if (mode === 'hose') {
      pl.teleport([10.6, F, -17.4], -Math.PI / 2 - 0.25); (pl as any).pitch = -0.2;
      const h = game.state.find('item', (e) => e.k === 'water_hose');
      const me = game.me;
      if (h && me) { game.items.putInInventory(me, h); me.sel = h.slot ?? 0; setTimeout(() => { h.spray = 1; }, 600); }
    } else { pl.teleport([10.75, F, -16.55], -Math.PI / 2 - 0.08); (pl as any).pitch = -0.36; }
  }, 200);
  void o;
}
