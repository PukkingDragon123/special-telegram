import * as THREE from 'three';
import type { NavGraph, Zone } from '../../game/contracts';
import { ANCHORS } from '../../game/mapplan';
import { groundHeight, SOI, MAIN, CROAD, CANAL, BRIDGE, MARKET, LOT, OFFICE, WHOLESALE, TEMPLE, RROAD } from './layout';

/**
 * Waypoint graph over sidewalks, crossings, market aisles, shop fronts, the bridge and the rural
 * road. A* with a binary heap; road-crossing edges are penalised with avoidRoads.
 */

interface Node { id: number; p: THREE.Vector3; e: { to: number; w: number; road: boolean }[] }

export class Nav implements NavGraph {
  nodes: Node[] = [];
  private grid = new Map<string, number[]>();
  private cell = 8;

  constructor(private zones: Zone[]) {}

  add(x: number, z: number, y?: number): number {
    // merge with an existing node very close by
    const near = this.nearestNode(x, z, 0.6);
    if (near >= 0) return near;
    const id = this.nodes.length;
    const p = new THREE.Vector3(x, y ?? groundHeight(x, z), z);
    this.nodes.push({ id, p, e: [] });
    const k = this.key(x, z);
    let c = this.grid.get(k);
    if (!c) this.grid.set(k, (c = []));
    c.push(id);
    return id;
  }
  private key(x: number, z: number) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); }

  link(a: number, b: number, road = false) {
    if (a === b || a < 0 || b < 0) return;
    const A = this.nodes[a], B = this.nodes[b];
    if (A.e.some((e) => e.to === b)) return;
    const w = A.p.distanceTo(B.p);
    A.e.push({ to: b, w, road }); B.e.push({ to: a, w, road });
  }

  /** chain of nodes along a straight segment every `step` m, linked; returns ids */
  line(x0: number, z0: number, x1: number, z1: number, step = 6, road = false, yFn?: (x: number, z: number) => number): number[] {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    const ids: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      ids.push(this.add(x, z, yFn ? yFn(x, z) : undefined));
    }
    for (let i = 0; i < ids.length - 1; i++) this.link(ids[i], ids[i + 1], road);
    return ids;
  }

  /** connect a point to the nearest node (optionally within max) */
  attach(x: number, z: number, max = 30, road = false, y?: number): number {
    const target = this.nearestNode(x, z, max);
    const id = this.add(x, z, y);
    if (target >= 0 && target !== id) this.link(id, target, road);
    return id;
  }

  nearestNode(x: number, z: number, max = Infinity): number {
    let best = -1, bd = max * max;
    const r = Math.ceil(Math.min(max, 64) / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const R = Number.isFinite(max) ? r : 64;
    for (let ring = 0; ring <= R; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const c = this.grid.get((cx + dx) + ',' + (cz + dz));
        if (!c) continue;
        for (const id of c) {
          const p = this.nodes[id].p;
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
      }
      if (best >= 0 && ring * this.cell > Math.sqrt(bd) + this.cell) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ NavGraph API

  path(from: THREE.Vector3, to: THREE.Vector3, opts: { avoidRoads?: boolean } = {}): THREE.Vector3[] {
    const a = this.nearestNode(from.x, from.z), b = this.nearestNode(to.x, to.z);
    if (a < 0 || b < 0) return [to.clone()];
    if (a === b) return [this.nodes[a].p.clone(), to.clone()];
    const pen = opts.avoidRoads ? 6 : 1.25;
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: [number, number][] = [];
    const push = (f: number, id: number) => {
      heap.push([f, id]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top;
    };
    const goal = this.nodes[b].p;
    g[a] = 0; push(this.nodes[a].p.distanceTo(goal), a);
    let found = false;
    while (heap.length) {
      const [, id] = pop();
      if (closed[id]) continue;
      if (id === b) { found = true; break; }
      closed[id] = 1;
      for (const e of this.nodes[id].e) {
        if (closed[e.to]) continue;
        const ng = g[id] + e.w * (e.road ? pen : 1);
        if (ng < g[e.to]) { g[e.to] = ng; came[e.to] = id; push(ng + this.nodes[e.to].p.distanceTo(goal), e.to); }
      }
    }
    if (!found) return [to.clone()];
    const out: THREE.Vector3[] = [];
    for (let c = b; c >= 0; c = came[c]) out.push(this.nodes[c].p.clone());
    out.reverse();
    // drop the first node if we're already past it (heading away from it)
    if (out.length > 1) {
      const d0 = from.distanceTo(out[0]), d1 = from.distanceTo(out[1]), d01 = out[0].distanceTo(out[1]);
      if (d1 < d01 && d0 < d01) out.shift();
    }
    // drop the last graph node if the target is beyond it along the same direction
    if (out.length > 1) {
      const n = out.length;
      const dl = to.distanceTo(out[n - 1]), dp = to.distanceTo(out[n - 2]), dd = out[n - 1].distanceTo(out[n - 2]);
      if (dp < dd && dl < dd) out.pop();
    }
    out.push(to.clone());
    return out;
  }

  randomPoint(zone?: string, rng: () => number = Math.random): THREE.Vector3 {
    let cand = this.nodes;
    if (zone) {
      const z = this.zones.find((q) => q.id === zone);
      if (z) {
        const [x0, z0, x1, z1] = z.rect;
        const f = this.nodes.filter((n) => n.p.x >= x0 && n.p.x <= x1 && n.p.z >= z0 && n.p.z <= z1);
        if (f.length) cand = f;
      }
    }
    const n = cand[Math.floor(rng() * cand.length)];
    if (!n) return new THREE.Vector3(-4.8, 0.15, -20);
    // random spot along one of its edges
    if (n.e.length && rng() < 0.7) {
      const e = n.e[Math.floor(rng() * n.e.length)];
      if (!e.road) {
        const q = this.nodes[e.to].p;
        const t = rng() * 0.5;
        const x = n.p.x + (q.x - n.p.x) * t, z = n.p.z + (q.z - n.p.z) * t;
        return new THREE.Vector3(x, groundHeight(x, z), z);
      }
    }
    return n.p.clone();
  }

  nearest(p: THREE.Vector3): THREE.Vector3 {
    const id = this.nearestNode(p.x, p.z);
    if (id < 0) return p.clone();
    const A = this.nodes[id].p;
    // best projection on the node's edges
    let best = A.clone(), bd = A.distanceToSquared(p);
    const tmp = new THREE.Vector3();
    for (const e of this.nodes[id].e) {
      const B = this.nodes[e.to].p;
      const ab = tmp.copy(B).sub(A);
      const t = Math.max(0, Math.min(1, ab.dot(p.clone().sub(A)) / Math.max(1e-6, ab.lengthSq())));
      const q = A.clone().addScaledVector(ab, t);
      const d = q.distanceToSquared(p);
      if (d < bd) { bd = d; best = q; }
    }
    best.y = groundHeight(best.x, best.z);
    return best;
  }
}

/** Build the whole graph for the map. */
export function buildNav(zones: Zone[]): Nav {
  const nav = new Nav(zones);
  const wx = SOI.x0 - 1.25, ex = SOI.x1 + 1.25; // sidewalk centre lines (±4.75)
  const nz = 3.0, sz = 24.0;
  // --- soi sidewalks
  const W = nav.line(wx, 1.5, wx, -157, 5.5);
  const E = nav.line(ex, 1.5, ex, -157, 5.5);
  // --- soi crossings (zebras + casual)
  for (const z of [-4, -20.5, -33, -46, -57, -70, -84, -100, -116, -132, -150]) nav.link(nav.nearestNode(wx, z), nav.nearestNode(ex, z), true);
  // --- main road sidewalks
  const MN_W = nav.line(MAIN.x0 + 2, nz, wx, nz, 6);
  const MN_E = nav.line(ex, nz, MAIN.x1 - 2, nz, 6);
  nav.link(nav.nearestNode(wx, nz), nav.nearestNode(wx, 1.5));
  nav.link(nav.nearestNode(ex, nz), nav.nearestNode(ex, 1.5));
  nav.link(nav.nearestNode(wx, nz), nav.nearestNode(ex, nz), true); // across the soi mouth
  nav.line(MAIN.x0 + 2, sz, MAIN.x1 - 2, sz, 6);
  // main road crossings: zebra at x -11.5 (preferred), plus jaywalking spots
  for (const [x, road] of [[-11.5, true], [40, true], [-80, true], [96, true]] as [number, boolean][]) {
    const a = nav.nearestNode(x, nz), b = nav.nearestNode(x, sz);
    const m = nav.add(x, 14, 0.22);
    nav.link(a, m, road); nav.link(m, b, road);
  }
  // pedestrian overpass at x -45 (stairs up, deck, stairs down)
  {
    const y = 5.6;
    const n0 = nav.nearestNode(-38, nz), s0 = nav.nearestNode(-38, sz);
    const a = nav.add(-41, 4.3, 2.6), b = nav.add(-45, 4.3, y), c = nav.add(-45, 14, y), d = nav.add(-45, 23.7, y), e = nav.add(-41, 23.7, 2.6);
    nav.link(n0, a); nav.link(a, b); nav.link(b, c); nav.link(c, d); nav.link(d, e); nav.link(e, s0);
  }
  void MN_W; void MN_E; void W; void E;
  // --- canal road sidewalk + bank walk + bridge + rural road
  const cz = (CROAD.sw0 + CROAD.sw1) / 2;
  nav.line(MAIN.x0 + 2, cz, wx, cz, 6);
  nav.line(ex, cz, MAIN.x1 - 2, cz, 6);
  nav.link(nav.nearestNode(wx, cz), nav.nearestNode(wx, -157));
  nav.link(nav.nearestNode(ex, cz), nav.nearestNode(ex, -157));
  const bz = (CANAL.zS + CROAD.z0) / 2;
  nav.line(MAIN.x0 + 2, bz, BRIDGE.x0 - 0.5, bz, 6);
  nav.line(BRIDGE.x1 + 0.5, bz, MAIN.x1 - 2, bz, 6);
  for (const x of [-60, -20, 20, 60]) nav.link(nav.nearestNode(x, cz), nav.nearestNode(x, bz), true);
  const bridge = nav.line(0, CROAD.z1 - 0.5, 0, BRIDGE.zN - 1.5, 3);
  nav.link(bridge[0], nav.nearestNode(wx, cz), true);
  nav.link(bridge[0], nav.nearestNode(ex, cz), true);
  nav.link(bridge[1], nav.nearestNode(BRIDGE.x0 - 0.5, bz));
  nav.link(bridge[1], nav.nearestNode(BRIDGE.x1 + 0.5, bz));
  const rural = nav.line(0, BRIDGE.zN - 1.5, 0, RROAD.zN + 3, 6);
  void rural;
  // rural branches
  nav.attach(ANCHORS.rural_spot.p[0], ANCHORS.rural_spot.p[2], 10);
  const grove = nav.line(3.5, -205, 52, -205, 6);
  nav.link(grove[0], nav.nearestNode(0, -205));
  nav.line(30, -205, 30, -232, 6);
  nav.line(45, -205, 45, -222, 6);
  nav.attach(ANCHORS.krasue_spot.p[0], ANCHORS.krasue_spot.p[2], 12);
  nav.attach(ANCHORS.nang_tani_spot.p[0], ANCHORS.nang_tani_spot.p[2], 12);
  // paddy dikes (west)
  for (const z of [-204, -226, -248]) { const l = nav.line(-3.5, z, -102, z, 7); nav.link(l[0], nav.nearestNode(0, z)); }
  // --- market aisles
  const mx0 = MARKET.x0 + 3.0;
  nav.line(mx0, MARKET.z1 - 2, mx0, MARKET.z0 + 2, 4);
  nav.line(mx0, -47, 48, -47, 4);
  nav.line(mx0, -63, 48, -63, 4);
  nav.line(mx0, -73, 48, -73, 4);
  for (const x of [21, 33, 45]) nav.line(x, -47, x, -73, 4);
  for (const z of [-55, -72]) nav.link(nav.nearestNode(ex, z), nav.nearestNode(mx0, z));
  nav.link(nav.nearestNode(ex, -44), nav.nearestNode(mx0, -44));
  // --- shop fronts & anchors (attach to nearest walk node)
  const att = (name: string, max = 12) => { const a = ANCHORS[name]; if (a) nav.attach(a.p[0], a.p[2], max, false, a.p[1]); };
  for (const n of ['plastic_shop', 'gas_shop', 'kitchen_shop', 'convenience_store', 'auntie_stall', 'butcher_stall', 'veg_stall', 'egg_stall',
    'cart_start', 'old_man_spot', 'tables_area', 'item_respawn', 'moto_taxi_stand', 'bus_stop', 'office_spot', 'market_spot', 'mainroad_spot',
    'cat_spot', 'spirit_house', 'temple_gate', 'pret_spot', 'homeless_spot']) att(n);
  nav.link(nav.nearestNode(ANCHORS.convenience_counter.p[0], ANCHORS.convenience_counter.p[2]), nav.add(ANCHORS.convenience_counter.p[0], ANCHORS.convenience_counter.p[2]));
  nav.link(nav.add(ANCHORS.convenience_counter.p[0], ANCHORS.convenience_counter.p[2]), nav.nearestNode(ANCHORS.convenience_store.p[0], ANCHORS.convenience_store.p[2]));
  // wake points
  for (let i = 0; i < 4; i++) att('wake_' + i, 6);
  // --- vacant lot
  const lotIds = [nav.add(-8, -80), nav.add(-10, -86), nav.add(-12.5, -83.5), nav.add(-11, -90), nav.add(-17, -86), nav.add(-22, -82), nav.add(-20, -93)];
  for (let i = 0; i < lotIds.length - 1; i++) nav.link(lotIds[i], lotIds[i + 1]);
  nav.link(lotIds[0], nav.nearestNode(wx, -80)); nav.link(lotIds[3], nav.nearestNode(wx, -92)); nav.link(lotIds[1], lotIds[4]);
  void LOT;
  // --- temple forecourt
  const tf = nav.line(TEMPLE.x0 + 2, -154, TEMPLE.x1 - 2, -154, 6);
  nav.link(tf[0], nav.nearestNode(ex, -154));
  nav.link(nav.nearestNode(TEMPLE.gateX, -154), nav.nearestNode(ANCHORS.temple_gate.p[0], ANCHORS.temple_gate.p[2]));
  for (const x of [20, 50, 80]) nav.link(nav.nearestNode(x, -154), nav.nearestNode(x, cz), true);
  // --- office plaza
  const op = nav.line(OFFICE.plazaX0 + 2, -4.5, OFFICE.plazaX1 - 1, -4.5, 6);
  for (const x of [-60, -45, -30]) nav.link(nav.nearestNode(x, -4.5), nav.nearestNode(x, nz));
  nav.attach(-45, -8.5, 6);
  void op;
  // --- wholesale front + parking
  nav.line(WHOLESALE.x0, 28.3, WHOLESALE.x1 - 2, 28.3, 6);
  att('wholesale_door', 6);
  nav.link(nav.nearestNode(ANCHORS.wholesale_door.p[0], ANCHORS.wholesale_door.p[2]), nav.add(ANCHORS.wholesale_counter.p[0], ANCHORS.wholesale_counter.p[2]));
  for (const x of [32, 50, 70]) nav.link(nav.nearestNode(x, 28.3), nav.nearestNode(x, sz));
  const pk = nav.line(97, sz, 97, 80, 6);
  nav.line(86, 50, 110, 50, 6); nav.line(86, 70, 110, 70, 6);
  nav.link(nav.nearestNode(97, 50), nav.nearestNode(86, 50)); nav.link(nav.nearestNode(97, 70), nav.nearestNode(86, 70));
  void pk;
  return nav;
}
