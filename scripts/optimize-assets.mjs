// Build-time asset optimizer (vite plugin `hpAssets`, also runnable: node scripts/optimize-assets.mjs [--report]).
//
//  - PNG / JPG under public/assets are re-encoded to WebP when it saves enough:
//      colour images (albedo, photos, UI, labels)  → lossy WebP (q 90–92, full-quality alpha, exact RGB under alpha)
//      data maps (normal / orm / roughness / height / masks, grayscale, palette) → lossless WebP (bit-exact)
//      JPEGs are only converted when it saves ≥ 25 %, PNGs ≥ 15 % (else the original is kept)
//  - the source tree is untouched: converted files live in a cache (node_modules/.cache/hp-assets) and replace
//    the originals in the build output only; the old→new path map is inlined into the bundle as the virtual
//    module 'virtual:hp-asset-remap', which core/util.ts asset() applies (dev server: empty map, originals)
//  - files nothing loads are left out of the build (2K HDRIs — the game bakes the 1K ones to PMREM —, notes)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VID = 'virtual:hp-asset-remap';
const CACHE_VERSION = 'v1';
const MIN_BYTES = 40 * 1024;
const DATA_RE = /(^|[_\-/.])(normal|nrm|norm|orm|arm|rough|roughness|metal|metalness|height|disp|displacement|bump|ao|occlusion|mask|depth|spec|gloss|opacity|alpha|fat|lut|id|weights?)([_\-/.]|$)/i;
/** never shipped: nothing requests them */
const PRUNE = [/^assets\/hdri\/.*_2k\.hdr$/, /\.md$/i, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/**
 * Convert everything under <publicDir>/assets that benefits. Returns { map: {rel→rel}, files: {rel→cachePath}, stats }.
 * rel paths are relative to the assets folder (what asset() receives).
 */
export async function optimizeAssets(publicDir, { log = console.log, cacheDir = path.join(ROOT, 'node_modules/.cache/hp-assets') } = {}) {
  const sharp = (await import('sharp')).default;
  sharp.concurrency(1);
  const assetsDir = path.join(publicDir, 'assets');
  fs.mkdirSync(cacheDir, { recursive: true });
  const all = walk(assetsDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  const map = {}, files = {};
  const stats = { n: 0, converted: 0, before: 0, after: 0, cached: 0 };
  const t0 = Date.now();
  await pool(all, Math.max(2, Math.min(8, os.cpus().length)), async (abs) => {
    const st = fs.statSync(abs);
    stats.n++;
    if (st.size < MIN_BYTES) return;
    const rel = path.relative(assetsDir, abs).split(path.sep).join('/');
    const isPng = /\.png$/i.test(abs);
    const key = crypto.createHash('sha1').update(CACHE_VERSION + rel + st.size + ':' + st.mtimeMs).digest('hex');
    const out = path.join(cacheDir, key + '.webp');
    const skip = path.join(cacheDir, key + '.skip');
    if (fs.existsSync(skip)) return;
    let size;
    if (fs.existsSync(out)) { size = fs.statSync(out).size; stats.cached++; }
    else {
      try {
        const img = sharp(abs, { failOn: 'none' });
        const meta = await img.metadata();
        const data = DATA_RE.test(rel) || meta.space === 'b-w' || meta.channels <= 2 || meta.paletteBitDepth || (isPng && meta.isPalette);
        let buf;
        if (data && isPng) buf = await img.webp({ lossless: true, effort: 5, exact: true }).toBuffer();
        else if (data) { fs.writeFileSync(skip, ''); return; }                       // lossy data JPEG: leave alone
        else {
          const q = /^(img|gen\/menu|gen\/text3d|textures\/faces)\//.test(rel) ? 92 : 90;
          buf = await img.webp({ quality: q, alphaQuality: 100, effort: 5, smartSubsample: true, exact: true }).toBuffer();
        }
        const need = isPng ? 0.85 : 0.75;
        if (buf.length > st.size * need) { fs.writeFileSync(skip, ''); return; }
        fs.writeFileSync(out, buf);
        size = buf.length;
      } catch (e) { log(`[hp-assets] skip ${rel}: ${e.message}`); fs.writeFileSync(skip, ''); return; }
    }
    const nrel = rel.replace(/\.(png|jpe?g)$/i, '.webp');
    // a real .webp of the same name already in the tree wins (don't overwrite it)
    if (fs.existsSync(path.join(assetsDir, nrel))) return;
    map[rel] = nrel; files[rel] = out;
    stats.converted++; stats.before += st.size; stats.after += size;
  });
  log(`[hp-assets] ${stats.converted}/${stats.n} images → WebP: ${(stats.before / 1e6).toFixed(1)} MB → ${(stats.after / 1e6).toFixed(1)} MB (${stats.cached} cached, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return { map, files, stats };
}

/** Vite plugin: inline the remap, swap converted files into the build output, prune unused files. */
export function hpAssets() {
  let result = { map: {}, files: {} };
  let cfg;
  return {
    name: 'hp-assets',
    configResolved(c) { cfg = c; },
    async buildStart() {
      if (cfg.command !== 'build' || process.env.HP_NO_ASSET_OPT) return;
      result = await optimizeAssets(cfg.publicDir, { log: (m) => cfg.logger.info(m) });
    },
    resolveId(id) { return id === VID ? '\0' + VID : null; },
    load(id) { return id === '\0' + VID ? `export default ${JSON.stringify(cfg.command === 'build' ? result.map : {})};` : null; },
    closeBundle() {
      if (cfg.command !== 'build') return;
      const outDir = path.resolve(cfg.root, cfg.build.outDir);
      const aDir = path.join(outDir, 'assets');
      let swapped = 0, pruned = 0, freed = 0;
      for (const [rel, cache] of Object.entries(result.files)) {
        const orig = path.join(aDir, rel);
        if (!fs.existsSync(orig)) continue;
        freed += fs.statSync(orig).size - fs.statSync(cache).size;
        fs.copyFileSync(cache, path.join(aDir, result.map[rel]));
        fs.unlinkSync(orig);
        swapped++;
      }
      for (const f of walk(outDir)) {
        const rel = path.relative(outDir, f).split(path.sep).join('/');
        if (PRUNE.some((r) => r.test(rel))) { freed += fs.statSync(f).size; fs.unlinkSync(f); pruned++; }
      }
      cfg.logger.info(`[hp-assets] build output: ${swapped} files swapped to WebP, ${pruned} unused files pruned, ${(freed / 1e6).toFixed(1)} MB saved`);
    },
  };
}

// standalone: node scripts/optimize-assets.mjs  → converts into the cache and prints the savings
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const r = await optimizeAssets(path.join(ROOT, 'public'));
  if (process.argv.includes('--report')) {
    const rows = Object.keys(r.map).map((k) => [k, fs.statSync(path.join(ROOT, 'public/assets', k)).size, fs.statSync(r.files[k]).size]).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
    for (const [k, a, b] of rows.slice(0, 40)) console.log(`${(a / 1e3).toFixed(0).padStart(6)} KB → ${(b / 1e3).toFixed(0).padStart(5)} KB  ${k}`);
  }
}
