import * as THREE from 'three';

export const BASE = (import.meta as any).env?.BASE_URL ?? './';
/** Resolve a path inside public/assets → URL usable at runtime. */
export const asset = (p: string) => `${BASE}assets/${p.replace(/^\/?(assets\/)?/, '')}`;

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number) => lerp(c, d, invLerp(a, b, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const dampTo = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * damp(rate, dt);
export const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dampAngle = (cur: number, target: number, rate: number, dt: number) => cur + angleDiff(cur, target) * damp(rate, dt);
export const round = (v: number, d = 2) => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};
export const v3 = (a?: ArrayLike<number> | null) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3());
export const arr3 = (v: THREE.Vector3, d = 3) => [round(v.x, d), round(v.y, d), round(v.z, d)];
export const dist2D = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const dist3 = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Tiny tween helper driven by the engine loop (see Engine.tweens). */
export interface Tween { t: number; dur: number; ease: (t: number) => number; onUpdate: (k: number) => void; resolve: () => void; delay: number; dead?: boolean }

export function disposeObject(obj: THREE.Object3D, disposeTextures = false) {
  obj.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (disposeTextures) for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}

/** Thai/English bilingual string. */
export interface TL { th: string; en?: string }
export const tl = (th: string, en?: string): TL => ({ th, en });

export function formatBaht(n: number) {
  return `${Math.round(n).toLocaleString('th-TH')} ฿`;
}

/** Deterministic string hash (FNV-1a). */
export function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const params = new URLSearchParams(location.search);
export const DEBUG = params.has('debug');
