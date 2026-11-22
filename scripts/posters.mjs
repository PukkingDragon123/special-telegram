// Pre-render the wall posters (src/modules/posters/gen.ts) into public/assets/gen/posters/*.webp.
//   1. start the dev server:   npx vite --port 5206
//   2. node scripts/posters.mjs [http://localhost:5206] [id,id,…]
// Renders in a headless Chromium (software GL is fine: it's a one-off), then encodes WebP with sharp
// and writes manifest.json ({ items: [{ id, file, cat, aspect }] }) that the game reads.
import { createRequire } from 'node:module';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // the machine-wide Playwright (not a project dependency)

const base = process.argv[2] || 'http://localhost:5206';
const ids = process.argv[3] || '';
const outDir = path.resolve('public/assets/gen/posters');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('console', (m) => { const t = m.text(); if (/posters|error/i.test(t)) console.log('[page]', t.slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  const url = `${base}/?only=characters,cooking,posters&posters=gen${ids ? '&posterIds=' + ids : ''}`;
  console.log('open', url);
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => (window).__postersDone === true, null, { timeout: 1800000, polling: 2000 });
  const list = await page.evaluate(() => (window).__posters);
  const manPath = path.join(outDir, 'manifest.json');
  const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { items: [] };
  for (const p of list) {
    const buf = Buffer.from(p.url.split(',')[1], 'base64');
    const file = p.id + '.webp';
    await sharp(buf).webp({ quality: 86, effort: 5 }).toFile(path.join(outDir, file));
    man.items = man.items.filter((it) => it.id !== p.id);
    man.items.push({ id: p.id, file, cat: p.cat, aspect: +(p.w / p.h).toFixed(4) });
    console.log('wrote', file);
  }
  man.items.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
} finally {
  await browser.close();
}
