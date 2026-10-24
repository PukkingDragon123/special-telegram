import type { Game } from '../../game/game';
import type { Ent } from '../../sim/state';
import type { DishData } from '../../game/contracts';
import { tl, TL, clamp } from '../../core/util';
import { archDef, recipeInfo, ORDER_NAME, pick, weighted, particle, DEFAULT_EXTRAS } from './data';
import { L, X, pickL, fillL, stars as starStr, Line } from './lines';

/* =============================================================================================
 * ORDERS & HONEST JUDGING. A customer's order (recipe + requests + drink), how it is spoken, and
 * the review after eating: DishData vs order, price vs expectation, wait, cleanliness, extras →
 * stars (1–5), a specific funny review line, and the payment.
 * ============================================================================================= */

export type Req = 'egg' | 'egg_runny' | 'egg_crispy' | 'no_egg' | 'mild' | 'hot' | 'special' | 'takeaway';
export interface Order { r: string | null; any?: boolean; req: Req[]; drink?: 'water' | 'ice' | 'soda' | null }

export const SPICY_RECIPES = ['kaphrao_moo', 'phat_phrik_kaeng', 'tom_yam', 'phat_phak_bung', 'khao_phat'];

/** Enabled menu recipes (g.menu minus extras). */
export function menuRecipes(game: Game): string[] {
  return Object.keys(game.g.menu ?? {}).filter((k) => k !== 'extras');
}
export const extras = (game: Game) => ({ ...DEFAULT_EXTRAS, ...(game.g.menu?.extras ?? {}) });
export const menuPrice = (game: Game, r: string) => game.g.menu?.[r] ?? game.g.menuPrices?.[r] ?? recipeInfo(game, r).price;

export function makeOrder(game: Game, c: Ent, o: { drinks: { water: boolean; soda: boolean } }): Order | null {
  const menu = menuRecipes(game);
  if (!menu.length) return null;
  const a = archDef(c.arch);
  const pf = c._pf ?? 1;
  const w: [string, number][] = menu.map((r) => {
    const exp = recipeInfo(game, r).price * pf * a.budget;
    const attract = clamp(Math.pow(exp / Math.max(5, menuPrice(game, r)), 1.6), 0.25, 2.2);
    return [r, (a.likes?.[r] ?? 1) * attract];
  });
  const any = Math.random() < 0.07;
  const r = weighted(w);
  const info = recipeInfo(game, r);
  const req: Req[] = [];
  if (!any) {
    if (info.egg === 'topping') {
      if (Math.random() < 0.6) { req.push('egg'); const s = Math.random(); if (s < 0.35) req.push('egg_runny'); else if (s < 0.6) req.push('egg_crispy'); }
    } else if (info.egg === 'main') { const s = Math.random(); if (s < 0.35) req.push('egg_runny'); else if (s < 0.65) req.push('egg_crispy'); }
    if (SPICY_RECIPES.includes(r)) { const s = Math.random(); if (s < (a.hot ?? 0.25)) req.push('hot'); else if (s < (a.hot ?? 0.25) + (a.mild ?? 0.15)) req.push('mild'); }
    if (Math.random() < 0.1 && info.egg !== 'main') req.push('special');
  }
  let take = a.takeaway;
  if (game.clock.time > 17.5 && game.clock.time < 20.5 && c.arch?.startsWith('office')) take += 0.3;
  if (Math.random() < take) req.push('takeaway');
  let drink: Order['drink'] = null;
  const dr = Math.random();
  if (!req.includes('takeaway')) {
    if (o.drinks.water && dr < 0.28) drink = Math.random() < 0.5 ? 'water' : 'ice';
    else if (o.drinks.soda && dr < 0.42) drink = 'soda';
  }
  return { r: any ? null : r, any, req, drink };
}

const REQ_TH: Record<Req, string> = { egg: 'ไข่ดาว', egg_runny: 'ไข่ดาวไม่สุก', egg_crispy: 'ไข่ดาวกรอบ ๆ', no_egg: 'ไม่เอาไข่', mild: 'ไม่เผ็ด', hot: 'เผ็ดมาก', special: 'พิเศษ', takeaway: 'ใส่กล่องกลับบ้าน' };
const REQ_EN: Record<Req, string> = { egg: '+ fried egg', egg_runny: 'runny egg', egg_crispy: 'crispy egg', no_egg: 'no egg', mild: 'not spicy', hot: 'extra hot', special: 'large', takeaway: 'to go' };

/** Short written form for the order ticket / look-at tag. */
export function orderShort(game: Game, o: Order): string {
  if (o.any) return 'อะไรก็ได้!';
  const parts = [recipeInfo(game, o.r!).name.th];
  for (const q of o.req) if (!(q === 'egg' && (o.req.includes('egg_runny') || o.req.includes('egg_crispy')))) parts.push(REQ_TH[q]);
  if (o.drink) parts.push(o.drink === 'water' ? '+น้ำเปล่า' : o.drink === 'ice' ? '+น้ำแข็ง' : '+น้ำอัดลม');
  return parts.join(' · ');
}

/** What the customer says out loud. */
export function orderSpeech(game: Game, c: Ent, o: Order): TL {
  const p = particle(c);
  if (o.any) { const l = pickL(L.order.arai_ko_dai); return { th: l.th, en: l.en }; }
  const nm = pick(ORDER_NAME[o.r!] ?? [recipeInfo(game, o.r!).name.th]);
  const reqs = o.req.filter((q) => !(q === 'egg' && (o.req.includes('egg_runny') || o.req.includes('egg_crispy'))));
  let th = nm + (reqs.length ? ' ' + reqs.map((q) => REQ_TH[q]).join(' ') : '');
  const en = recipeInfo(game, o.r!).name.en + (reqs.length ? ', ' + reqs.map((q) => REQ_EN[q]).join(', ') : '');
  const form = Math.random();
  if (reqs.includes('takeaway')) th = th + ' ' + p;
  else if (form < 0.4) th = th + ' จานนึง' + p;
  else if (form < 0.7) th = 'เอา' + th + ' ' + p;
  else th = 'ขอ' + th + ' ที่นึง' + p;
  if (o.drink) th += o.drink === 'water' ? ' ขอน้ำเปล่าด้วย' : o.drink === 'ice' ? ' น้ำแข็งเปล่าแก้วนึง' : ' โค้กกระป๋องนึง';
  return { th: th.replace(/\s+/g, ' ').trim(), en: en + (o.drink ? ` + ${o.drink === 'soda' ? 'a soda' : o.drink === 'ice' ? 'cup of ice' : 'water'}` : '') };
}

// ------------------------------------------------------------------ judging

export interface Factor { k: string; v: number; line?: Line }
export interface Verdict { stars: number; score: number; factors: Factor[]; review: TL; pay: number; tip: number; base: number; mad?: string | null }

export interface JudgeCtx {
  waited: number; patience: number; mess: number; flies: boolean; tissue: boolean; shade: boolean; wet: number;
  drinkOk: boolean | null; soda: number; sawSlap: boolean; madCalmed: boolean; moneyDelta: number;
}

export function judge(game: Game, c: Ent, d: DishData, o: Order, j: JudgeCtx): Verdict {
  const a = archDef(c.arch);
  const F: Factor[] = [];
  const bad = (k: string, v: number, line?: Line) => F.push({ k, v: -Math.abs(v) * a.picky, line });
  const good = (k: string, v: number, line?: Line) => F.push({ k, v: Math.abs(v), line });
  const taste = clamp(d.taste ?? 0.5, 0, 1);
  const base = 1 + 4 * Math.pow(taste, 1.15);
  const issues = d.issues ?? [];
  const iss = (k: string) => issues.includes(k);
  // flavour & cooking problems (taste already includes them; the factor carries the line + safety extra)
  if (iss('raw_pork') || iss('raw_meat') || iss('raw_shrimp')) bad('raw', 1.4, pickL(X.issue[issues.find((i) => i.startsWith('raw_'))!] ?? X.issue.raw_pork));
  if (iss('burnt')) bad('burnt', 0.4, pickL(L.bad.burnt));
  else if (iss('burnt_garlic')) bad('burnt_garlic', 0.2, pickL(X.issue.burnt_garlic));
  const wantHot = o.req.includes('hot'), wantMild = o.req.includes('mild');
  if (iss('too_salty') || (d.salty ?? 0) > 0.45) bad('salty', 0.5, pickL(L.bad.too_salty));
  else if (iss('bland') || (d.salty ?? 0) < -0.5) bad('bland', 0.4, pickL(L.bad.too_bland));
  if (iss('too_sweet')) bad('sweet', 0.3, pickL(X.issue.too_sweet));
  if (wantMild && (d.spicy ?? 0) > 0.35) bad('mild_fail', 1.0, pickL(X.req.mildFail));
  else if (wantHot && (d.spicy ?? 0) < 0.35) bad('hot_fail', 0.6, pickL(X.req.hotFail));
  else if (!wantHot && !wantMild && iss('too_spicy')) bad('too_spicy', 0.5, pickL(L.bad.too_spicy));
  else if (wantHot && (d.spicy ?? 0) > 0.55) good('hot_ok', 0.25);
  for (const k of ['soggy_basil', 'no_basil', 'too_oily', 'dry', 'cold', 'no_rice', 'watery', 'smoky', 'mushy_rice', 'hard_rice', 'unchopped', 'not_flipped', 'soggy_veg']) if (iss(k)) bad(k, k === 'no_rice' ? 0.8 : k === 'cold' ? 0.35 : 0.2, pickL(X.issue[k]));
  if (iss('small_portion')) bad('portion', 0.4, pickL(L.bad.portion));
  if (iss('huge_portion') || (o.req.includes('special') && (d.portion ?? 0) > 200)) good('portion', 0.3, pickL(L.good.portion));
  else if (o.req.includes('special') && (d.portion ?? 0) < 170) bad('special_small', 0.4, pickL(L.ok.portion));
  if (iss('no_spoon') && !o.req.includes('takeaway')) bad('no_spoon', 0.4, pickL(L.bad.no_spoon));
  // egg requests
  const egg = d.egg ?? 'none';
  const info = o.r ? recipeInfo(game, o.r) : null;
  if (o.req.includes('egg') && egg === 'none') bad('egg_missing', 0.8, pickL(X.req.eggMissing));
  if (o.req.includes('egg_runny') && egg !== 'none' && egg !== 'runny') bad('egg_runny', 0.6, pickL(X.req.runnyFail));
  if (o.req.includes('egg_crispy') && egg !== 'none' && egg !== 'crispy') bad('egg_crispy', 0.6, pickL(X.req.crispyFail));
  if (egg === 'raw') bad('egg_raw', 0.4, pickL(X.issue.raw_egg));
  if (egg === 'burnt') bad('egg_burnt', 0.3, pickL(X.issue.burnt_egg));
  if ((o.req.includes('egg_runny') && egg === 'runny') || (o.req.includes('egg_crispy') && egg === 'crispy')) good('egg_ok', 0.3, { th: 'ไข่ดาวได้ตามสั่งเป๊ะ', en: 'egg exactly as ordered' });
  // wrong dish (only if they didn't say "anything")
  if (!o.any && o.r && d.recipe !== o.r) bad('wrong', 1.2, pickL(L.bad.served_wrong_dish));
  if (o.any && d.recipe === 'khai_jiao' && Math.random() < 0.5) bad('any_omelet', 0.6, pickL(X.req.anyOmelet));
  if (o.req.includes('takeaway') && !d.takeaway) bad('takeaway', 0.3, pickL(X.req.takeawayFail));
  // price vs expectation
  const price = menuPrice(game, d.recipe);
  const exp = recipeInfo(game, d.recipe).price * (c._pf ?? 1) * a.budget;
  const ratio = price / Math.max(5, exp);
  if (ratio < 0.8) good('cheap', 0.35, pickL(L.good.price_cheap));
  else if (ratio > 1.7) bad('price', 1.4, pickL(L.bad.price_too_high));
  else if (ratio > 1.35) bad('price', 0.8, pickL(L.bad.price_too_high));
  else if (ratio > 1.15) bad('price', 0.35, pickL(L.ok.price));
  // wait
  const wf = j.waited / Math.max(1, j.patience);
  if (wf < 0.3) good('fast', 0.35, pickL(L.good.wait));
  else if (wf > 0.85) bad('slow', 0.6 * (a.patience < 1 ? 1.3 : 1), pickL(L.bad.wait));
  else if (wf > 0.6) bad('slow', 0.25, pickL(L.ok.wait));
  if (j.madCalmed) bad('scene', 0.3);
  // place
  if (j.mess > 0.25) bad('dirty', j.mess * 1.2, pickL(L.bad.dirty_table));
  else if (j.mess < 0.05 && !o.req.includes('takeaway')) good('clean', 0.15, pickL(L.good.clean));
  if (j.flies) bad('flies', 0.3, pickL(X.req.flies));
  if (!j.tissue && !o.req.includes('takeaway') && Math.random() < 0.6) bad('tissue', 0.15, pickL(X.req.noTissue));
  if (j.wet > 4) bad('rain', 0.5, pickL(X.req.rainWet));
  if (j.shade) good('shade', 0.1);
  if (j.drinkOk === true) good('drink', 0.3, { th: 'มีน้ำให้ด้วย ดีงาม', en: 'they brought water, nice' });
  if (j.drinkOk === false) bad('drink', 0.25, { th: 'ขอน้ำไปแล้วไม่ได้สักที', en: 'never got my water' });
  if (j.sawSlap) F.push({ k: 'show', v: 0.1, line: pickL(X.req.slapShow) });
  // composite
  const sum = F.reduce((s, f) => s + f.v, 0);
  const score = clamp(base + sum, 0.5, 5.4);
  const st = Math.max(1, Math.min(5, Math.round(score)));
  // review text: specific & honest
  const negs = F.filter((f) => f.v < 0 && f.line).sort((x, y) => x.v - y.v);
  const poss = F.filter((f) => f.v > 0 && f.line).sort((x, y) => y.v - x.v);
  let review: Line;
  const tasteGood = taste >= 0.75 ? pickL(L.good.taste) : taste >= 0.55 ? pickL(L.ok.taste) : pickL(L.bad.taste);
  if (st >= 4) {
    const extra = poss[0]?.line;
    review = extra && Math.random() < 0.7 ? { th: tasteGood.th + ' ' + extra.th, en: (tasteGood.en ?? '') + '. ' + (extra.en ?? '') } : tasteGood;
    if (negs[0] && st === 4 && Math.random() < 0.5) review = { th: review.th + ' แต่' + negs[0].line!.th, en: (review.en ?? '') + ', but ' + (negs[0].line!.en ?? '') };
  } else if (st <= 2) {
    const n1 = negs[0]?.line ?? tasteGood, n2 = negs[1]?.line;
    review = n2 && Math.random() < 0.6 ? { th: n1.th + ' ' + n2.th, en: (n1.en ?? '') + '. ' + (n2.en ?? '') } : n1;
  } else {
    const n1 = negs[0]?.line;
    review = n1 ? { th: tasteGood.th + ' แต่' + n1.th, en: (tasteGood.en ?? '') + ', but ' + (n1.en ?? '') } : poss[0]?.line ? { th: tasteGood.th + ' ' + poss[0].line!.th, en: tasteGood.en } : tasteGood;
  }
  review = fillL(review, { total: price, price, dish: recipeInfo(game, d.recipe).name.th });
  // payment
  const ex = extras(game);
  let pay = price;
  if (info?.egg === 'topping' && egg !== 'none' && d.recipe === o.r) pay += ex.egg;
  else if (recipeInfo(game, d.recipe).egg === 'topping' && egg !== 'none') pay += ex.egg;
  if (o.req.includes('special') && (d.portion ?? 0) >= 180) pay += ex.special;
  pay += j.soda;
  pay += j.moneyDelta;
  let tip = 0;
  if (st >= 5 && taste >= 0.82) tip = pick([5, 10, 10, 20]) * (a.budget > 1.1 ? 2 : 1);
  if (st <= 1) pay = Math.round(pay * 0.5 / 5) * 5;
  return { stars: st, score, factors: F, review, pay: Math.max(0, pay), tip, base };
}

export function reviewBubble(v: Verdict): TL {
  return { th: `${starStr(v.stars)}  ${v.review.th}`, en: v.review.en };
}
export { tl };
