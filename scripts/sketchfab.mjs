#!/usr/bin/env node
/**
 * Sketchfab model downloader + optimizer (CC0 / CC-BY / CC-BY-SA only → small game-ready GLBs).
 *
 *   node scripts/sketchfab.mjs --out public/assets/gen/cooking/models <name>=<uid>[:tris=N][:tex=N] ...
 *
 * Needs the Sketchfab API token (the session proxy injects it for api.sketchfab.com; never pass it here).
 * Writes <out>/<name>/<name>.glb (meshopt geometry, WebP textures ≤ tex px, simplified to ≤ tris)
 * and appends author / licence / URL to <out>/CREDITS.md + <out>/manifest.json.
 * Raw downloads are cached in scripts/_cache/sketchfab/ (git-ignored).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out = 'public/assets/gen/cooking/models', tris = 3000, tex = 512;
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--tris') tris = +args[++i];
  else if (args[i] === '--tex') tex = +args[++i];
  else ids.push(args[i]);
}
const OUT = path.resolve(ROOT, out);
const CACHE = path.join(ROOT, 'scripts/_cache/sketchfab');
fs.mkdirSync(CACHE, { recursive: true });
const OK_LIC = /^(CC0|CC Attribution(-ShareAlike)?)( |$|Public)/;

const curlJSON = (url) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', '-m', '60', url], { maxBuffer: 64 << 20 }).toString());
const curl = (url, dest) => execFileSync('curl', ['-sSfL', '--retry', '3', '-m', '600', '-o', dest, url], { stdio: ['ignore', 'inherit', 'inherit'] });
const gt = (...a) => execFileSync('npx', ['-y', '@gltf-transform/cli', ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).toString();
function countTris(file) {
  try {
    const meshes = (gt('inspect', file, '--format', 'csv').split('MESHES')[1] ?? '').split('MATERIALS')[0];
    let n = 0;
    for (const line of meshes.split('\n').slice(2)) { const c = line.split(','); const v = +c[5]; if (v) n += v; }
    return n;
  } catch { return 0; }
}

const manPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
const credits = [];

for (const spec of ids) {
  const [head, ...kv] = spec.split(':');
  const [name, uid] = head.split('=');
  const o = { tris, tex, err: 0.05 };
  for (const p of kv) { const [k, v] = p.split('='); o[k] = +v; }
  const info = curlJSON(`https://api.sketchfab.com/v3/models/${uid}`);
  const lic = info.license?.label ?? '';
  if (!OK_LIC.test(lic)) { console.error(`✗ ${name}: licence "${lic}" not allowed`); continue; }
  const dir = path.join(OUT, name);
  const outFile = path.join(dir, `${name}.glb`);
  const raw = path.join(CACHE, uid);
  fs.mkdirSync(raw, { recursive: true });
  let src = fs.readdirSync(raw).find((f) => f.endsWith('.glb'));
  if (!src) {
    const dl = curlJSON(`https://api.sketchfab.com/v3/models/${uid}/download`);
    const g = dl.glb ?? null;
    if (!g?.url) { console.error(`✗ ${name}: no glb download`, Object.keys(dl)); continue; }
    curl(g.url, path.join(raw, 'model.glb'));
    src = 'model.glb';
  }
  const srcFile = path.join(raw, src);
  fs.mkdirSync(dir, { recursive: true });
  const poly = countTris(srcFile) || info.faceCount || 1;
  const ratio = Math.min(1, o.tris / poly);
  try {
    gt('optimize', srcFile, outFile, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(o.tex),
      '--instance', 'false', '--simplify', ratio < 0.98 ? 'true' : 'false', '--simplify-ratio', ratio.toFixed(5), '--simplify-error', String(o.err));
  } catch (e) { console.error(`✗ ${name}: optimize failed\n${e.stderr?.toString() ?? e.message}`); continue; }
  const t = countTris(outFile), bytes = fs.statSync(outFile).size;
  manifest[name] = { file: `${name}/${name}.glb`, bytes, tris: t, source: 'sketchfab', uid, license: lic, author: info.user?.displayName ?? info.user?.username, url: info.viewerUrl };
  credits.push(`- **${name}** — "${info.name}" by ${info.user?.displayName ?? info.user?.username} (${info.viewerUrl}), ${lic}${/Attribution/.test(lic) ? ' — attribution required' : ''}`);
  console.log(`✓ ${name}: ${poly} → ${t} tris, ${(bytes / 1024).toFixed(0)} KB, ${lic}`);
}
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 1));
if (credits.length) {
  const cp = path.join(OUT, 'CREDITS.md');
  const head = fs.existsSync(cp) ? fs.readFileSync(cp, 'utf8') : '# Credits\n';
  const sec = head.includes('## Sketchfab') ? '\n' : '\n\n## Sketchfab\n';
  fs.writeFileSync(cp, head.trimEnd() + sec + credits.join('\n') + '\n');
}
