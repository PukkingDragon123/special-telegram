import * as THREE from 'three';
import { cachedMat, pbr, lateTex, speckle, labelTex } from './assets';

/** Shared materials (one instance per look → batched shader programs, few uploads). */
export const M = {
  steel: () => pbr('stainless_brushed', { repeat: 1, roughness: 0.9, metalness: 0.6 }),
  steelDent: () => pbr('stainless_dented_greasy', { repeat: 1, metalness: 0.85, roughness: 0.75, color: 0xdfe4ea }),
  steelDark: () => pbr('stainless_dented_greasy', { repeat: 1, color: 0x8a8580, metalness: 0.6 }),
  wok: () => pbr('cast_iron_wok', { repeat: 1, metalness: 0.5 }),
  wood: () => pbr('wood_teak', { repeat: 1, color: 0xb08a68 }),
  woodRaw: () => pbr('plywood', { repeat: 1, color: 0xc7a882 }),
  board: () => pbr('chopping_board_endgrain', { repeat: 1 }),
  boardSide: () => pbr('wood_planks_old', { repeat: 1, color: 0x8a6440 }),
  clay: () => pbr('tiles_floor_terracotta', { repeat: 1, color: 0xd08a62 }),
  alu: () => pbr('aluminium_scratched', { repeat: 1, metalness: 0.6 }),
  rubber: () => pbr('rubber_black', { repeat: 1 }),
  chrome: () => pbr('chrome', { repeat: 1, roughness: 1.4, metalness: 0.7 }),
  galv: () => pbr('galvanized_steel', { repeat: 1, metalness: 0.6 }),
  roof: () => pbr('roof_corrugated_galvanized', { repeat: 1, side: THREE.DoubleSide, metalness: 0.5 }),
  paint: (hex: number) => pbr('metal_painted_chipped', { repeat: 1, color: hex }),
  plastic: (hex: number) => pbr('plastic_glossy', { repeat: 1, color: hex }),
  plasticRough: (hex: number) => pbr('plastic_rough', { repeat: 1, color: hex }),
  paper: (hex = 0xffffff) => pbr('paper_creased', { repeat: 1, color: hex }),
  cardboard: () => pbr('cardboard_worn', { repeat: 1 }),
  tarp: (hex: number) => pbr('canvas_tarp', { repeat: 1, color: hex, side: THREE.DoubleSide }),
  castIron: () => pbr('cast_iron_wok', { repeat: 1, color: 0x6a6662, metalness: 0.5 }),
  glass: () => cachedMat('glass', () => new THREE.MeshStandardMaterial({ color: 0xe8f2ef, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 })),
  glassBottle: (hex: number, op = 0.35) => cachedMat('glassb' + hex + op, () => new THREE.MeshStandardMaterial({ color: hex, transparent: true, opacity: op, roughness: 0.08, metalness: 0.05, depthWrite: false, envMapIntensity: 1.4 })),
  liquid: (hex: number, rough = 0.12) => cachedMat('liq' + hex + rough, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 })),
  film: () => cachedMat('film', () => new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, roughness: 0.06, metalness: 0, depthWrite: false, envMapIntensity: 2 })),
  bagClear: (hex = 0xffffff, op = 0.32) => cachedMat('bag' + hex + op, () => new THREE.MeshStandardMaterial({ color: hex, transparent: true, opacity: op, roughness: 0.25, metalness: 0, depthWrite: false, side: THREE.DoubleSide })),
  label: (kind: string) => cachedMat('label:' + kind, () => new THREE.MeshStandardMaterial({ map: labelTex(kind), roughness: 0.42, metalness: 0 })),
  rubberBand: () => cachedMat('rband', () => new THREE.MeshStandardMaterial({ color: 0xc8231a, roughness: 0.6 })),
  foam: () => pbr('plastic_rough', { repeat: 1, color: 0xf6f4ee }),
  eggShell: () => cachedMat('eggshell', () => new THREE.MeshStandardMaterial({ map: lateTex('eggshell', ['egg shell texture', 'brown egg shell', 'eggshell'], speckle('#d9b58c', [['#c9a37a', 120, 2], ['#e8cba6', 80, 3]], 31), { dirs: ['textures/food/', 'gen/cooking/'], not: ['fried', 'omelet', 'tray'] }), roughness: 0.62 })),
  pulp: () => cachedMat('pulp', () => new THREE.MeshStandardMaterial({ map: lateTex('pulp', ['egg tray pulp', 'pulp paper', 'egg carton'], speckle('#b9b2a2', [['#a39b8a', 200, 2], ['#cfc8b8', 120, 2]], 32), { dirs: ['textures/props/', 'gen/cooking/'] }), roughness: 0.95 })),
  stem: () => cachedMat('stem', () => new THREE.MeshStandardMaterial({ color: 0x4f6a2a, roughness: 0.7 })),
  stemPurple: () => cachedMat('stemp', () => new THREE.MeshStandardMaterial({ color: 0x5a3e48, roughness: 0.7 })),
  black: () => cachedMat('blackplastic', () => new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.55 })),
  emissive: (hex: number, k = 2) => cachedMat('emi' + hex + k, () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: hex, emissiveIntensity: k, roughness: 0.4 })),
};

/** Uniform scale helper for meshes sharing a cached geometry. */
export function mesh(g: THREE.BufferGeometry, m: THREE.Material, pos?: [number, number, number], rot?: [number, number, number], scale?: number | [number, number, number]) {
  const o = new THREE.Mesh(g, m);
  if (pos) o.position.set(pos[0], pos[1], pos[2]);
  if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined) typeof scale === 'number' ? o.scale.setScalar(scale) : o.scale.set(scale[0], scale[1], scale[2]);
  return o;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Cached geometry by key (shared across item instances). */
export function gc(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
