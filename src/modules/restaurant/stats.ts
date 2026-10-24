import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import { clamp, round } from '../../core/util';
import { recipeInfo } from './data';

/* =============================================================================================
 * REPUTATION & DAY STATS (host). g.reputation 0..5 = slow moving average of ratings.
 * g.dayStats = { day, revenue, customers, ratings[], rating, angry, dishes{}, bestDish, tips,
 *                ghostScares, orders, quotes[], events[] } — reset every new day; the newspaper /
 * social module reads it (fields named to match menu/newspaper.ts normStats()).
 * ============================================================================================= */

let G: Game;
export function bindStats(game: Game) { G = game; }

export function freshStats(day: number) {
  return { day, revenue: 0, customers: 0, ratings: [] as number[], rating: 0, angry: 0, dishes: {} as Record<string, number>, bestDish: null as string | null, tips: 0, ghostScares: 0, orders: 0, quotes: [] as { th: string; en?: string; stars: number }[], events: [] as string[] };
}

export function stats(): ReturnType<typeof freshStats> {
  const g = G.g;
  if (!g.dayStats || g.dayStats.day !== (g.day ?? 1)) g.dayStats = freshStats(g.day ?? 1);
  return g.dayStats;
}

export function addReview(c: Ent, v: { stars: number; review: { th: string; en?: string }; pay: number; tip: number }, recipe: string | null, paid: number, stormed: boolean) {
  const s = stats();
  const g = G.g;
  s.ratings = [...s.ratings, v.stars].slice(-200);
  s.rating = round(s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length, 2);
  if (!stormed) s.customers++;
  s.revenue += paid;
  s.tips += v.tip ?? 0;
  if (recipe && !stormed) {
    s.dishes = { ...s.dishes, [recipe]: (s.dishes[recipe] ?? 0) + 1 };
    s.bestDish = Object.entries(s.dishes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  // keep a few notable quotes (best & worst) for the newspaper
  if (v.stars <= 1 || v.stars >= 5 || s.quotes.length < 3) s.quotes = [...s.quotes, { th: v.review.th, en: v.review.en, stars: v.stars }].slice(-8);
  if (v.stars <= 1 && s.events.length < 6) s.events = [...s.events, `ลูกค้าโวย: "${v.review.th}"`];
  if (v.stars >= 5 && (v.tip ?? 0) > 0 && s.events.length < 6) s.events = [...s.events, `ลูกค้าให้ทิป ${v.tip} บาท ${recipe ? recipeInfo(G, recipe).name.th : ''}อร่อยเหาะ`];
  g.reputation = round(clamp((g.reputation ?? 3) + (v.stars - (g.reputation ?? 3)) * 0.06, 0, 5), 3);
  G.events.emit('restaurant:review', { customer: c.id, stars: v.stars, paid, recipe, stormed });
}

/** HOST, new day: next day's footfall shrinks after a bad day (max −30 %, per the economy notes). */
export function rollDay(day: number) {
  const prev = G.g.dayStats;
  const r = prev?.ratings?.length ? prev.rating : 3;
  G.g.restYesterday = r < 2.6 ? clamp(1 - (2.6 - r) * 0.2, 0.7, 1) : r >= 4 ? 1.1 : 1;
  G.g.dayStats = freshStats(day);
}
