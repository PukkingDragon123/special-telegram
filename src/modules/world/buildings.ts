import type { ShopCtx } from './shophouse';
import type { RNG } from '../../core/rng';
import type { FoliageSys } from './foliage';
export interface SpecialCtx extends ShopCtx { rng: RNG; holes: { x0: number; z0: number; x1: number; z1: number }[]; fol: FoliageSys | null }
export function buildSpecial(_c: SpecialCtx) {}
