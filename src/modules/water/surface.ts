import * as THREE from 'three';
import { Assets } from '../../core/assets';
import { RIPPLE_GLSL } from './ripples';

/**
 * Water SURFACE material (MeshStandardMaterial + shader hooks) for the local water surfaces this
 * module owns (buckets, basins, drums, jars, tubs, the canal ripple patch). Physically lit and
 * reflects the scene's HDRI environment; the normal comes from two scrolling layers of a REAL
 * water-ripple photo normal map (textures/pbr/water_ripples_puddle, CC BY 2.0) plus the shared
 * ripple heightfield (ripples.ts) sampled by world xz, plus a per-object slosh wobble.
 */
export const SHARED = {
  uTime: { value: 0 },
  uRipTex: { value: null as THREE.Texture | null },
  uRipO: { value: new THREE.Vector2() },
  uRipSpan: { value: 10 },
};

export interface SurfOpts {
  color?: THREE.ColorRepresentation;
  opacity?: number;
  /** metres per normal-map tile */
  tile?: number;
  /** normal map strength */
  nmK?: number;
  /** heightfield ripple strength */
  ripK?: number;
  flow?: [number, number];
  /** 'puddle' (fine ripples) | 'chop' (wind chop) | 'canal' */
  nm?: 'puddle' | 'chop' | 'canal';
  /** murk/foam tint for wash water */
  foam?: number;
  /** alpha follows the ripple slope only (overlay patch on another water surface) */
  overlay?: boolean;
  side?: THREE.Side;
}

const NM: Record<string, string> = {
  puddle: 'textures/pbr/water_ripples_puddle/normal.jpg',
  chop: 'textures/pbr/water_wind_chop/normal.jpg',
  canal: 'textures/pbr/water_canal_calm/normal.jpg',
};

export interface SurfMat extends THREE.MeshStandardMaterial {
  userData: { wob: { value: THREE.Vector4 }; foamU: { value: number } };
}

export function makeSurfaceMat(o: SurfOpts = {}): SurfMat {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0x51666a, roughness: 0.04, metalness: 0, transparent: true, opacity: o.opacity ?? 0.62,
    depthWrite: false, envMapIntensity: 1.15, side: o.side ?? THREE.FrontSide,
  }) as SurfMat;
  m.name = 'water-surface';
  const nmTex = Assets.texture(NM[o.nm ?? 'puddle'], { srgb: false });
  nmTex.wrapS = nmTex.wrapT = THREE.RepeatWrapping;
  const wob = { value: new THREE.Vector4(0, 0, 0, 0) };   // x,z: slosh slope (per metre), z: disc radius (m), w: wobble amount
  const foamU = { value: o.foam ?? 0 };
  m.userData = { wob, foamU };
  const tile = o.tile ?? 0.6, nmK = o.nmK ?? 0.22, ripK = o.ripK ?? 1.0;
  const flow = o.flow ?? [0, 0];
  const overlay = !!o.overlay;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.uTime;
    sh.uniforms.uRipTex = SHARED.uRipTex;
    sh.uniforms.uRipO = SHARED.uRipO;
    sh.uniforms.uRipSpan = SHARED.uRipSpan;
    sh.uniforms.uWNM = { value: nmTex };
    sh.uniforms.uWob = wob;
    sh.uniforms.uFoam = foamU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform vec4 uWob; uniform float uTime; varying vec3 vWPw; varying vec2 vLoc;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vLoc = position.xz;
float wr = length(position.xz);
transformed.y += (uWob.x * position.x + uWob.y * position.z) * uWob.z + uWob.w * sin(wr * 9.0 - uTime * 11.0) * 0.006 * wr;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vWPw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime; uniform sampler2D uWNM; uniform vec4 uWob; uniform float uFoam; varying vec3 vWPw; varying vec2 vLoc;
${RIPPLE_GLSL}
float wHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float wNoise(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <normal_fragment_maps>', `
float wFres;
{
  vec2 wuv = vWPw.xz / ${tile.toFixed(3)};
  vec2 fl = vec2(${flow[0].toFixed(3)}, ${flow[1].toFixed(3)}) * uTime / ${tile.toFixed(3)};
  vec3 n1 = texture2D(uWNM, wuv + fl + vec2(uTime * 0.021, uTime * 0.011)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWNM, wuv * 0.71 + fl * 0.8 + vec2(-uTime * 0.017, uTime * 0.023)).xyz * 2.0 - 1.0;
  vec3 rp = ripSample(vWPw.xz);
  vec2 nm = (n1.xy + n2.xy) * ${nmK.toFixed(3)};
  vec3 wN = normalize(vec3(nm.x + rp.x * ${ripK.toFixed(3)} - uWob.x, 1.0, -nm.y + rp.y * ${ripK.toFixed(3)} - uWob.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
  wFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  ${overlay ? 'diffuseColor.a *= clamp(length(rp.xy) * 2.5 + abs(rp.z) * 0.5, 0.0, 1.0) * 0.9;' : 'diffuseColor.a = mix(diffuseColor.a, 1.0, wFres * 0.8);'}
  if (uFoam > 0.001) {
    float fo = wNoise(vWPw.xz * 26.0 + uTime * 0.3) * 0.6 + wNoise(vWPw.xz * 61.0 - uTime * 0.2) * 0.4;
    float fm = smoothstep(1.0 - uFoam, 1.05 - uFoam * 0.6, fo + length(rp.xy) * 0.4);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.94, 0.92), fm);
    diffuseColor.a = mix(diffuseColor.a, 0.97, fm);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor, 0.02, 1.0);`);
  };
  m.customProgramCacheKey = () => `wsurf-${tile}-${nmK}-${ripK}-${flow[0]}-${flow[1]}-${overlay}-${o.nm ?? 'puddle'}`;
  return m;
}

/** Disc surface geometry (radius 1, XZ plane, centred) with rings for the wobble shader. */
let discGeo: THREE.BufferGeometry | null = null;
export function surfaceDisc(): THREE.BufferGeometry {
  if (!discGeo) {
    discGeo = new THREE.CircleGeometry(1, 28, 0, Math.PI * 2);
    // add inner rings so the vertex wobble has something to move: use a ring-subdivided disc
    const g = new THREE.RingGeometry(0.0001, 1, 28, 5);
    g.rotateX(-Math.PI / 2);
    discGeo.dispose();
    discGeo = g;
  }
  return discGeo;
}
