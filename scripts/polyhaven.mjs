#!/usr/bin/env node
/**
 * Poly Haven model downloader + optimizer (CC0 photoscans → small game-ready GLBs).
 *
 *   node scripts/polyhaven.mjs [options] <id[:key=value...]> ...
 *
 * Options
 *   --out <dir>      output folder (default public/assets/gen/world/models)
 *   --res <1k|2k>    source resolution to download (default 1k)
 *   --tex <px>       max texture size after optimizing (default 512)
 *   --tris <n>       target triangle count; meshes above it are simplified (default 3000)
 *   --error <f>      simplify error limit as a fraction of the mesh extent (default 0.004)
 *   --force          re-download and re-optimize even if the output exists
 *   --list           print polycount / size / authors of the ids and exit
 * Per-id overrides: `fire_hydrant:tris=4000:tex=1024:error=0.01`
 *
 * Output: <out>/<id>/<id>.glb (meshopt-compressed geometry, WebP textures) plus
 * <out>/manifest.json (id → file, bytes, tris, dims in metres, authors) and <out>/CREDITS.md.
 * Raw downloads are cached in scripts/_cache/polyhaven/ (git-ignored).
 * Load the GLBs with GLTFLoader + MeshoptDecoder (three/examples/jsm/libs/meshopt_decoder.module.js).
 * Uses curl (proxy-aware) and `npx -y @gltf-transform/cli` (nothing is added to package.json).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { out: 'public/assets/gen/world/models', res: '1k', tex: 512, tris: 3000, error: 0.004, force: false, list: false };
const ids = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--force') opt.force = true;
  else if (a === '--list') opt.list = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = isNaN(+args[i + 1]) ? args[i + 1] : +args[i + 1], i++;
  else ids.push(a);
}
if (!ids.length) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }

const OUT = path.resolve(ROOT, opt.out);
const CACHE = path.join(ROOT, 'scripts/_cache/polyhaven');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const curl = (url, dest) => execFileSync('curl', ['-sSfL', '--retry', '3', '-o', dest, url], { stdio: ['ignore', 'inherit', 'inherit'] });
const getJSON = (url) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', url], { maxBuffer: 64 << 20 }).toString());
const gt = (...a) => execFileSync('npx', ['-y', '@gltf-transform/cli', ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();

/** triangle count of a glTF/GLB (from `gltf-transform inspect`) */
const countTris = (file) => {
  let t = 0;
  try {
    const meshes = (gt('inspect', file, '--format', 'csv').split('MESHES')[1] ?? '').split('MATERIALS')[0];
    for (const line of meshes.split('\n')) { const c = line.split(','); if (c[2] === 'TRIANGLES') t += (+c[4] || 0) * (+c[c.length - 2] || 1); }
  } catch { /* optional */ }
  return t;
};

const manPath = path.join(OUT, 'manifest.json');
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};

for (const spec of ids) {
  const [id, ...kv] = spec.split(':');
  const o = { ...opt };
  for (const p of kv) { const [k, v] = p.split('='); o[k] = isNaN(+v) ? v : +v; }
  let info;
  try { info = getJSON(`https://api.polyhaven.com/info/${id}`); } catch (e) { console.error(`✗ ${id}: info failed (${e.message})`); continue; }
  if (opt.list) {
    console.log(`${id.padEnd(32)} tris≈${String(info.polycount).padStart(7)}  ${(info.dimensions ?? []).map((d) => (d / 1000).toFixed(2)).join('×')} m  ${Object.keys(info.authors ?? {}).join(', ')}`);
    continue;
  }
  const dir = path.join(OUT, id);
  const outFile = path.join(dir, `${id}.glb`);
  if (fs.existsSync(outFile) && !opt.force) { console.log(`= ${id} (exists)`); continue; }
  // ---- download the glTF + its includes (bin, textures)
  const files = getJSON(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf?.[o.res]?.gltf ?? files.gltf?.['1k']?.gltf;
  if (!g) { console.error(`✗ ${id}: no glTF at ${o.res}`); continue; }
  const raw = path.join(CACHE, id);
  fs.mkdirSync(raw, { recursive: true });
  const src = path.join(raw, path.basename(new URL(g.url).pathname));
  if (!fs.existsSync(src) || opt.force) {
    curl(g.url, src);
    for (const [rel, f] of Object.entries(g.include ?? {})) {
      const dest = path.join(raw, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      curl(f.url, dest);
    }
  }
  // ---- optimize: weld + simplify to the target, join, palette, WebP textures, meshopt geometry
  fs.mkdirSync(dir, { recursive: true });
  const poly = countTris(src) || info.polycount || 1;
  const ratio = Math.min(1, o.tris / poly);
  const a = ['optimize', src, outFile, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(o.tex),
    '--instance', 'false', '--simplify', ratio < 0.98 ? 'true' : 'false', '--simplify-ratio', ratio.toFixed(4), '--simplify-error', String(o.error)];
  try { gt(...a); } catch (e) { console.error(`✗ ${id}: optimize failed\n${e.stderr?.toString() ?? e.message}`); continue; }
  const tris = countTris(outFile);
  const bytes = fs.statSync(outFile).size;
  const dims = (info.dimensions ?? []).map((d) => +(d / 1000).toFixed(3));
  man[id] = { file: `${id}/${id}.glb`, name: info.name, bytes, srcTris: poly, tris: tris || undefined, dims, authors: Object.keys(info.authors ?? {}), license: 'CC0', source: `https://polyhaven.com/a/${id}` };
  console.log(`✓ ${id.padEnd(30)} ${(bytes / 1024).toFixed(0).padStart(5)} KB  tris ${poly} → ${tris || '?'} (ratio ${ratio.toFixed(2)})`);
}
if (!opt.list) {
  const sorted = Object.fromEntries(Object.entries(man).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(manPath, JSON.stringify(sorted, null, 1));
  const total = Object.values(sorted).reduce((s, m) => s + m.bytes, 0);
  const lines = ['# Real-world prop models — credits', '', 'All models come from [Poly Haven](https://polyhaven.com) and are **CC0** (public domain, no attribution required; credited anyway).',
    'Downloaded and optimized with `scripts/polyhaven.mjs` (simplified with meshoptimizer, WebP textures, meshopt geometry).', '',
    '| model | Poly Haven page | author(s) | size |', '|---|---|---|---|',
    ...Object.entries(sorted).map(([id, m]) => `| ${m.name ?? id} (\`${id}\`) | ${m.source} | ${m.authors.join(', ')} | ${(m.bytes / 1024).toFixed(0)} KB |`),
    '', `Total: ${(total / 1048576).toFixed(1)} MB in ${Object.keys(sorted).length} models.`, ''];
  // hand-maintained extra credits (photo-derived textures etc.) are appended verbatim
  const extra = path.join(OUT, 'CREDITS.extra.md');
  if (fs.existsSync(extra)) lines.push('', fs.readFileSync(extra, 'utf8'));
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n'));
}
