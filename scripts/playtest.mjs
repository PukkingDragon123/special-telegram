#!/usr/bin/env node
/**
 * Solo playthrough smoke test (drives game APIs, screenshots each stage, collects errors).
 *   node scripts/playtest.mjs [outDir] [quality]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2] || 'screenshots/playtest';
const quality = process.argv[3] || 'low';
fs.mkdirSync(out, { recursive: true });
const base = process.env.HP_URL || 'http://127.0.0.1:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = new Map();
page.on('console', (m) => { if (m.type() === 'error') { const k = m.text().slice(0, 220); errs.set(k, (errs.get(k) || 0) + 1); } });
page.on('pageerror', (e) => { const k = 'PAGEERROR ' + e.message.slice(0, 220); errs.set(k, (errs.get(k) || 0) + 1); });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { log('EVAL ERR', e.message.slice(0, 200)); return null; } };
const shot = async (name) => { try { await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 }); log('shot', name); } catch (e) { log('shot fail', name, e.message.slice(0, 80)); } };
const waitFor = async (fn, ms, label) => { try { await page.waitForFunction(fn, null, { timeout: ms, polling: 500 }); return true; } catch { log('TIMEOUT', label); return false; } };

await page.goto(base + `?quality=${quality}`, { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__hp?.game?.scenes?.currentName === 'menu', 120000, 'menu');
await page.waitForTimeout(8000);
await shot('01_menu');

// casino
await ev(() => window.__hp.game.scenes.request('casino'));
await waitFor(() => window.__hp.game.scenes.currentName === 'casino', 120000, 'casino');
await page.waitForTimeout(15000);
await shot('02_casino');
await page.waitForTimeout(12000);
await shot('03_casino_late');

// skip → world wake
await ev(() => window.__hp.game.intent('intro.skipCasino', {}));
await waitFor(() => window.__hp.game.scenes.currentName === 'world' && window.__hp.game.player, 240000, 'world');
await page.waitForTimeout(10000);
log('intro', await ev(() => window.__hp.game.g.introStep));
await shot('04_wake');

// intro beats
for (const step of ['see_cart', 'pay']) {
  await ev((s) => window.__hp.game.intro.go(s), step);
  await page.waitForTimeout(6000);
}
await shot('05_oldman');
// pay coins (solo has 100)
await ev(() => { const g = window.__hp.game; const om = g.state.find('npc', (n) => n.role === 'oldman'); if (om) g.player.teleport([om.p[0] - 1.2, om.p[1], om.p[2]], -Math.PI / 2); });
await page.waitForTimeout(2000);
for (let i = 0; i < 6; i++) { await ev(() => window.__hp.game.intent('intro.pay', {})); await page.waitForTimeout(1500); }
log('after pay', await ev(() => ({ step: window.__hp.game.g.introStep, wallet: window.__hp.game.me.wallet, cart: window.__hp.game.state.find('cart', () => true)?.owner })));
if ((await ev(() => window.__hp.game.g.introStep)) === 'pay') await ev(() => window.__hp.game.intro.go('starter'));
await page.waitForTimeout(6000);
await ev(() => window.__hp.game.intro?.go?.('dog'));
await page.waitForTimeout(14000);
await shot('06_dog');
await ev(() => window.__hp.game.intro?.go?.('go_market'));
await page.waitForTimeout(5000);
await shot('07_go_market');
// walk to auntie
await ev(() => { const g = window.__hp.game; const a = g.world.anchor('auntie_stall'); g.player.teleport([a.p[0] - 2.2, a.p[1], a.p[2]], -Math.PI / 2); });
await waitFor(() => window.__hp.game.g.introStep === 'done', 30000, 'intro done');
await page.waitForTimeout(5000);
await shot('08_market');
log('market', await ev(() => { const g = window.__hp.game; return { step: g.g.introStep, debt: g.g.debt, credit: g.g.creditUsed, wallet: g.me.wallet, keepers: g.state.all('npc').filter((n) => String(n.role).startsWith('shopkeeper')).length, stock: g.state.all('item').filter((i) => i.unpaid || i.data?.unpaid).length }; }));

// cooking: back to cart, spawn a dish via cooking API, serve a customer
await ev(() => { const g = window.__hp.game; const c = g.state.find('cart', () => true); g.player.teleport([c.p[0] - 2.5, c.p[1], c.p[2] + 1], -Math.PI / 2); });
await page.waitForTimeout(6000);
await shot('09_cart');
const rest = await ev(() => {
  const g = window.__hp.game; const R = g.restaurant || window.__rest;
  if (!R) return 'no restaurant api';
  try { R.open?.(true); } catch (e) { return 'open err ' + e.message; }
  const c = R.spawnCustomer?.();
  return { open: g.g.shopOpen, cust: !!c, menu: g.g.menu };
});
log('restaurant', JSON.stringify(rest));
await page.waitForTimeout(20000);
await shot('10_customers');

// night
await ev(() => { window.__hp.game.g.time = 21.5; });
await page.waitForTimeout(15000);
await shot('11_night');
log('night', await ev(() => ({ ghosts: window.__hp.game.state.all('ghost').length, t: window.__hp.game.g.time })));
await ev(() => { window.__hp.game.g.time = 23.99; });
await page.waitForTimeout(8000);
await shot('12_midnight');
await ev(() => { const g = window.__hp.game; g.g.time = 24.6; });
await waitFor(() => window.__hp.game.g.day >= 2, 120000, 'day 2');
await page.waitForTimeout(6000);
await shot('13_newspaper_or_morning');
log('day', await ev(() => ({ day: window.__hp.game.g.day, t: window.__hp.game.g.time, unlocks: window.__hp.game.g.unlocks, saved: !!window.__hp.game.save?.has?.() })));

console.log('\n== ERRORS ==');
for (const [k, n] of errs) console.log(`${n}× ${k}`);
await browser.close();
