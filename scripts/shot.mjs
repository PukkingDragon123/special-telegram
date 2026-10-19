#!/usr/bin/env node
/**
 * Headless screenshot / smoke test for เฮียผัด!
 *
 *   node scripts/shot.mjs "<url query>" <out.png> [waitSeconds] [--eval "<js run in page after wait>"] [--keys "KeyW:1500,KeyE:100"]
 *
 * Examples
 *   node scripts/shot.mjs "?autostart&skipintro" /tmp/world.png 8
 *   node scripts/shot.mjs "?scene=menu" /tmp/menu.png 6
 *
 * Uses the globally installed Playwright + pre-installed Chromium with SwiftShader WebGL.
 * Prints console errors/warnings (deduplicated) and page errors. Exit code 1 on page errors.
 * Requires the dev server: `npx vite --port 5173 --host 127.0.0.1`.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const [query = '', out = 'shot.png', waitS = '6', ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const base = process.env.HP_URL || 'http://127.0.0.1:5173/';
const w = Number(process.env.HP_W || 1280), h = Number(process.env.HP_H || 720);

const browser = await pw.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const seen = new Map();
let pageErrors = 0;
page.on('console', (m) => {
  const t = m.type();
  if (t !== 'error' && t !== 'warning') return;
  const k = t + ': ' + m.text().slice(0, 300);
  seen.set(k, (seen.get(k) || 0) + 1);
});
page.on('pageerror', (e) => { pageErrors++; console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
await page.goto(base + query, { waitUntil: 'domcontentloaded' });
const keys = opt('--keys');
const start = Date.now();
await page.waitForTimeout(Number(waitS) * 1000);
if (keys) {
  for (const part of keys.split(',')) {
    const [k, ms] = part.split(':');
    await page.evaluate(([k]) => window.__hp?.Input.simulate(k, true), [k]);
    await page.waitForTimeout(Number(ms || 100));
    await page.evaluate(([k]) => window.__hp?.Input.simulate(k, false), [k]);
  }
}
const ev = opt('--eval');
if (ev) {
  try { const r = await page.evaluate(ev); if (r !== undefined) console.log('EVAL', typeof r === 'string' ? r : JSON.stringify(r, null, 1).slice(0, 4000)); }
  catch (e) { console.log('EVAL ERROR', e.message); }
  await page.waitForTimeout(Number(opt('--after') || 1500));
}
await page.screenshot({ path: out, timeout: 240000 });
const fps = await page.evaluate(() => window.__hp?.engine?.fps?.toFixed(1)).catch(() => null);
console.log(`shot → ${out} (${((Date.now() - start) / 1000).toFixed(1)}s, fps≈${fps})`);
for (const [k, n] of seen) console.log(`${n}× ${k}`);
await browser.close();
process.exit(pageErrors ? 1 : 0);
