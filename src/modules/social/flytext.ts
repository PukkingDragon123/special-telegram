import * as THREE from 'three';
import { renderText, TextBlock } from '../../ui3d/text';

/* ============================================================================================
 * FLY TEXT — Thai text whose characters fly / tumble / fade in one by one (and scatter out).
 * The whole text block is rendered ONCE on a canvas (so Thai shaping, stacked vowels and tone
 * marks stay perfect); each grapheme cluster becomes its own quad sampling its slice of that
 * canvas, animated in the vertex shader → one draw call per text block.
 * ========================================================================================== */

const seg: any = (Intl as any).Segmenter ? new (Intl as any).Segmenter('th', { granularity: 'grapheme' }) : null;

const vert = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aRand;   // xyz random dir, w = delay (s)
uniform float uT, uOut, uDur, uFly;
varying vec2 vUv;
varying float vA;
float outBack(float t) { float s = 1.9; t -= 1.0; return 1.0 + (s + 1.0) * t * t * t + s * t * t; }
void main() {
  vUv = uv;
  float p = clamp((uT - aRand.w) / uDur, 0.0, 1.0);
  float e = outBack(p);
  float o = clamp((uOut - aRand.w * 0.4) / 0.35, 0.0, 1.0);
  vec3 local = position - aCenter;
  float ang = (1.0 - e) * aRand.x * 2.4 + o * aRand.y * 3.0;
  float c = cos(ang), s = sin(ang);
  local.xy = mat2(c, s, -s, c) * local.xy;
  float sc = max(0.0, e) * (1.0 + o * 0.6);
  vec3 off = aRand.xyz * (1.0 - p) * (1.0 - p) * uFly + vec3(aRand.x, abs(aRand.y) + 0.6, aRand.z) * o * o * uFly * 0.8;
  vec3 pos = aCenter + local * sc + off;
  vA = smoothstep(0.0, 0.45, p) * (1.0 - o);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 c = texture2D(uMap, vUv);
  float a = c.a * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(c.rgb, a);
}`;

export interface FlyOpts {
  /** metres per canvas px */
  px?: number;
  /** stagger between clusters (s) */
  stagger?: number;
  dur?: number;
  fly?: number;
  align?: 'center' | 'left';
  depthTest?: boolean;
}

export class FlyText {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.CanvasTexture;
  t = 0;
  out = -1;
  readonly width: number;
  readonly height: number;
  private total: number;

  constructor(blocks: TextBlock[], o: FlyOpts = {}) {
    const scale = 2;
    const mt = renderText(blocks, { pad: 4, scale });
    const cv = mt.canvas;
    const ctx = cv.getContext('2d')!;
    const px = (o.px ?? 0.0011) / scale;
    const W = cv.width, H = cv.height;
    this.width = W * px; this.height = H * px;
    // find glyph clusters per text line: scan the alpha columns of each line band and split by
    // grapheme-cluster advance widths measured with the same font.
    const img = ctx.getImageData(0, 0, W, H).data;
    const quads: { x0: number; x1: number; y0: number; y1: number }[] = [];
    // line bands from row alpha
    const rowHas = new Uint8Array(H);
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x += 2) if (img[(y * W + x) * 4 + 3] > 8) { rowHas[y] = 1; break; } }
    const bands: [number, number][] = [];
    let y0 = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && rowHas[y];
      if (on && y0 < 0) y0 = y;
      if (!on && y0 >= 0) { if (y - y0 > 3) bands.push([y0, y]); y0 = -1; }
    }
    // merge bands that are too close (stacked Thai marks create tiny separate bands)
    const merged: [number, number][] = [];
    for (const b of bands) {
      const last = merged[merged.length - 1];
      if (last && b[0] - last[1] < 10 * scale) last[1] = b[1]; else merged.push([b[0], b[1]]);
    }
    for (const [b0, b1] of merged) {
      // columns with ink inside this band
      const colHas = new Uint8Array(W);
      for (let x = 0; x < W; x++) for (let y = b0; y < b1; y += 2) if (img[(y * W + x) * 4 + 3] > 8) { colHas[x] = 1; break; }
      let xs = -1;
      const runs: [number, number][] = [];
      for (let x = 0; x <= W; x++) {
        const on = x < W && colHas[x];
        if (on && xs < 0) xs = x;
        if (!on && xs >= 0) { runs.push([xs, x]); xs = -1; }
      }
      // split long runs (connected scripts / tight kerning) into ~cluster sized chunks
      const target = (b1 - b0) * 0.42;
      for (const [r0, r1] of runs) {
        const n = Math.max(1, Math.round((r1 - r0) / target));
        for (let k = 0; k < n; k++) quads.push({ x0: r0 + ((r1 - r0) * k) / n, x1: r0 + ((r1 - r0) * (k + 1)) / n, y0: b0 - 2, y1: b1 + 2 });
      }
    }
    void seg;
    const N = Math.max(1, quads.length);
    const pos = new Float32Array(N * 4 * 3), uv = new Float32Array(N * 4 * 2), cen = new Float32Array(N * 4 * 3), rnd = new Float32Array(N * 4 * 4);
    const idx: number[] = [];
    const stagger = o.stagger ?? 0.022;
    const ox = o.align === 'left' ? 0 : -W / 2, oy = H / 2;
    quads.forEach((q, i) => {
      const xa = (q.x0 + ox) * px, xb = (q.x1 + ox) * px, ya = (oy - q.y1) * px, yb = (oy - q.y0) * px;
      const cx = (xa + xb) / 2, cy = (ya + yb) / 2;
      const corners = [[xa, ya, q.x0, q.y1], [xb, ya, q.x1, q.y1], [xb, yb, q.x1, q.y0], [xa, yb, q.x0, q.y0]];
      const r = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 1.2 - 0.2, i * stagger + Math.random() * stagger];
      corners.forEach((c, k) => {
        const j = i * 4 + k;
        pos[j * 3] = c[0]; pos[j * 3 + 1] = c[1]; pos[j * 3 + 2] = 0;
        uv[j * 2] = c[2] / W; uv[j * 2 + 1] = 1 - c[3] / H;
        cen[j * 3] = cx; cen[j * 3 + 1] = cy; cen[j * 3 + 2] = 0;
        rnd[j * 4] = r[0]; rnd[j * 4 + 1] = r[1]; rnd[j * 4 + 2] = r[2]; rnd[j * 4 + 3] = r[3];
      });
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    this.total = N * stagger + (o.dur ?? 0.5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    g.setIndex(idx);
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true,
      uniforms: { uMap: { value: this.tex }, uT: { value: 0 }, uOut: { value: 0 }, uDur: { value: o.dur ?? 0.5 }, uFly: { value: o.fly ?? 0.35 }, uOpacity: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  /** start the scatter-out; returns seconds until gone */
  leave() { if (this.out < 0) this.out = 0; return 0.6; }
  get gone() { return this.out > 0.9; }
  get revealed() { return this.t >= this.total; }
  set opacity(v: number) { this.mat.uniforms.uOpacity.value = v; }

  update(dt: number) {
    this.t += dt;
    if (this.out >= 0) this.out += dt;
    this.mat.uniforms.uT.value = this.t;
    this.mat.uniforms.uOut.value = Math.max(0, this.out);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
