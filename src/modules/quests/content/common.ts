import type { Game } from '../../../game/game';
import type { TL } from '../../../core/util';
import { DEFAULT_UNLOCKED } from '../../cooking/recipes';
import type { DlgCtx, DlgNode, DlgOption, TalkTarget } from '../api';

export const T = (th: string, en?: string): TL => ({ th, en });
export const pick = <X>(a: X[]): X => a[Math.floor(Math.random() * a.length)];
export const role = (r: string) => (t: TalkTarget) => t.role === r;
export const rolePrefix = (r: string) => (t: TalkTarget) => t.role.startsWith(r);
export const wallet = (c: DlgCtx) => c.me.wallet ?? 0;
export const hour = (g: Game) => g.g.time ?? 10;
export const day = (g: Game) => g.g.day ?? 1;
export const isUnlocked = (g: Game, id: string) => {
  const u = (g.g as any).unlocks?.recipes;
  return (Array.isArray(u) && u.length ? u : DEFAULT_UNLOCKED).includes(id);
};
/** "ask something else" loop-back + goodbye */
export const back = (to: string, bye: TL = T('ขอบคุณครับ!', 'Thanks!')): DlgOption[] => [
  { text: T('ถามเรื่องอื่นหน่อย', 'Something else…'), next: to },
  { text: bye, end: true },
];
/** a node with the standard loop-back options */
export const info = (id: string, say: DlgNode['say'], to: string, extra: Partial<DlgNode> = {}): DlgNode => ({ id, say, options: back(to), ...extra });
/** the items the local player is carrying (entities) */
export function carried(c: DlgCtx) {
  const inv: (number | null)[] = c.me.inv ?? [];
  const ids = [...new Set(inv.filter((x): x is number => x !== null))];
  return ids.map((id) => c.game.state.get(id)).filter(Boolean) as any[];
}
export function carriedDish(c: DlgCtx, pred: (d: any) => boolean = () => true) {
  return carried(c).find((e) => e.k === 'dish' && pred(e.data ?? {})) ?? null;
}
