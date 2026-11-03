import { RNG } from '../../core/rng';

/* ============================================================================================
 * Backrooms layout: a seeded grid of CELL-sized rooms. A perfect maze (randomised DFS) guarantees every
 * cell is reachable, then most walls are knocked out, some blocks become big open rooms and some become
 * pillar halls, so the result reads as the endless, slightly-wrong office space of the folklore
 * (mono-yellow rooms, long corridors, random dead ends) instead of a hedge maze.
 * Same seed → same layout on every peer.
 * ========================================================================================== */

export interface Layout {
  n: number;
  /** wall between (i,j) and (i+1,j)  → v[j*n + i], i in 0..n-2 */
  v: Uint8Array;
  /** wall between (i,j) and (i,j+1) → h[j*n + i], j in 0..n-2 */
  h: Uint8Array;
  /** free-standing square pillars at grid corners (i, j) = corner between cells i-1..i and j-1..j */
  pillars: [number, number][];
  entrance: [number, number];
  far: [number, number];
  /** cells reachable distance from the entrance (BFS steps) */
  dist: Int32Array;
}

export function generate(n: number, seed: number): Layout {
  const rng = new RNG(seed * 7919 + 13);
  const v = new Uint8Array(n * n).fill(1), h = new Uint8Array(n * n).fill(1);
  // ---- perfect maze (iterative DFS)
  const seen = new Uint8Array(n * n);
  const stack: number[] = [0];
  seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const i = c % n, j = (c / n) | 0;
    const nb: [number, number, 'v' | 'h', number][] = [];
    if (i > 0 && !seen[c - 1]) nb.push([c - 1, 0, 'v', j * n + i - 1]);
    if (i < n - 1 && !seen[c + 1]) nb.push([c + 1, 0, 'v', j * n + i]);
    if (j > 0 && !seen[c - n]) nb.push([c - n, 0, 'h', (j - 1) * n + i]);
    if (j < n - 1 && !seen[c + n]) nb.push([c + n, 0, 'h', j * n + i]);
    if (!nb.length) { stack.pop(); continue; }
    const [next, , kind, idx] = rng.pick(nb);
    if (kind === 'v') v[idx] = 0; else h[idx] = 0;
    seen[next] = 1;
    stack.push(next);
  }
  // ---- open it up: most walls go, the rest make corridors and alcoves
  for (let k = 0; k < n * n; k++) { if (rng.chance(0.58)) v[k] = 0; if (rng.chance(0.58)) h[k] = 0; }
  // long straight corridors: a few full rows / columns of parallel walls with gaps
  for (let c = 0; c < Math.floor(n / 6); c++) {
    const row = rng.int(2, n - 3), from = rng.int(0, n >> 1), len = rng.int(5, n - 4);
    for (let i = from; i < Math.min(n - 1, from + len); i++) { h[row * n + i] = 1; if (row + 1 < n - 1) h[(row + 1) * n + i] = 1; }
    for (let i = from; i < Math.min(n - 1, from + len); i++) { v[row * n + i] = 0; v[(row + 1) * n + i] = 0; }
  }
  // big open rooms (no inner walls)
  const clearBlock = (i0: number, j0: number, w: number, d: number) => {
    for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) {
      if (i < i0 + w - 1 && i < n - 1) v[j * n + i] = 0;
      if (j < j0 + d - 1 && j < n - 1) h[j * n + i] = 0;
    }
  };
  const pillars: [number, number][] = [];
  for (let r = 0; r < Math.max(3, n >> 2); r++) {
    const w = rng.int(3, 5), d = rng.int(3, 5);
    const i0 = rng.int(0, n - w), j0 = rng.int(0, n - d);
    clearBlock(i0, j0, w, d);
    // half of them are pillar halls
    if (rng.chance(0.5)) for (let j = j0 + 1; j < j0 + d; j++) for (let i = i0 + 1; i < i0 + w; i++) if (rng.chance(0.8)) pillars.push([i, j]);
  }
  const entrance: [number, number] = [1, 0];
  // the entrance room is open (2×2) so you arrive in a proper room
  clearBlock(0, 0, 3, 2);
  // ---- BFS distances from the entrance (walls respected); the corridor walls above can cut cells off,
  //      so knock through walls until every cell is reachable again
  const dist = new Int32Array(n * n);
  const bfs = () => {
    dist.fill(-1);
    const q: number[] = [entrance[1] * n + entrance[0]];
    dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], i = c % n, j = (c / n) | 0, d0 = dist[c] + 1;
      const go = (to: number) => { if (dist[to] < 0) { dist[to] = d0; q.push(to); } };
      if (i > 0 && !v[j * n + i - 1]) go(c - 1);
      if (i < n - 1 && !v[j * n + i]) go(c + 1);
      if (j > 0 && !h[(j - 1) * n + i]) go(c - n);
      if (j < n - 1 && !h[j * n + i]) go(c + n);
    }
    return q.length;
  };
  for (let guard = 0; guard < n * n && bfs() < n * n; guard++) {
    for (let c = 0; c < n * n; c++) {
      if (dist[c] >= 0) continue;
      const i = c % n, j = (c / n) | 0;
      if (i > 0 && dist[c - 1] >= 0) { v[j * n + i - 1] = 0; break; }
      if (i < n - 1 && dist[c + 1] >= 0) { v[j * n + i] = 0; break; }
      if (j > 0 && dist[c - n] >= 0) { h[(j - 1) * n + i] = 0; break; }
      if (j < n - 1 && dist[c + n] >= 0) { h[j * n + i] = 0; break; }
    }
  }
  let best = 0;
  for (let c = 0; c < n * n; c++) if (dist[c] > dist[best]) best = c;
  return { n, v, h, pillars, entrance, far: [best % n, (best / n) | 0], dist };
}
