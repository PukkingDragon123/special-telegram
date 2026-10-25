#!/usr/bin/env node
/**
 * Make an itch.io-ready HTML5 bundle (itch allows max 1000 files per upload).
 *   npm run build && node scripts/itch-pack.mjs   →  dist-itch/ + hia-phat-itch.zip
 * Files under dist/assets/ (except the JS/CSS chunks) are concatenated into ~20 MB .pak files per folder.
 * A tiny loader in index.html serves them back through fetch(), <img src> and FontFace on demand,
 * fetching each pak once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SRC = 'dist', OUT = 'dist-itch', PAK_MAX = 20 * 1024 * 1024;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets', 'pak'), { recursive: true });

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/'));
const isCode = (f) => !f.startsWith('assets/') || /^assets\/[^/]+\.(js|css)$/.test(f) || /\.(woff2?|ttf|otf)$/.test(f);

for (const f of files.filter(isCode)) { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); }

// group packable files by top two folders, split by size
const groups = new Map();
for (const f of files.filter((f) => !isCode(f))) {
  const key = f.split('/').slice(1, 3).join('_').replace(/\.[^.]+$/, '');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
const index = {}; // url path -> [pak, offset, length]
let pakN = 0;
for (const [, list] of groups) {
  let buf = [], size = 0;
  const flush = () => {
    if (!buf.length) return;
    const name = `p${pakN++}.pak`;
    const fd = fs.openSync(path.join(OUT, 'assets', 'pak', name), 'w');
    let off = 0;
    for (const f of buf) { const b = fs.readFileSync(path.join(SRC, f)); fs.writeSync(fd, b); index[f] = [name, off, b.length]; off += b.length; }
    fs.closeSync(fd);
    buf = []; size = 0;
  };
  for (const f of list) {
    const s = fs.statSync(path.join(SRC, f)).size;
    if (size + s > PAK_MAX) flush();
    buf.push(f); size += s;
  }
  flush();
}
fs.writeFileSync(path.join(OUT, 'assets', 'pak', 'index.json'), JSON.stringify(index));

const loader = `<script>
(() => {
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json', mp3: 'audio/mpeg', ogg: 'audio/ogg', woff2: 'font/woff2', hdr: 'application/octet-stream', glb: 'model/gltf-binary', txt: 'text/plain', svg: 'image/svg+xml' };
  const base = new URL('.', location.href).href;
  const ofetch = window.fetch.bind(window);
  const idxP = ofetch(base + 'assets/pak/index.json').then((r) => r.json());
  const paks = new Map(), blobs = new Map();
  const key = (u) => { try { const a = new URL(u, location.href).href; return a.startsWith(base) ? decodeURIComponent(a.slice(base.length).split(/[?#]/)[0]) : null; } catch { return null; } };
  async function blobFor(k) {
    const idx = await idxP; const e = idx[k]; if (!e) return null;
    if (!blobs.has(k)) blobs.set(k, (async () => {
      if (!paks.has(e[0])) paks.set(e[0], ofetch(base + 'assets/pak/' + e[0]).then((r) => r.blob()));
      const p = await paks.get(e[0]);
      return p.slice(e[1], e[1] + e[2], MIME[k.split('.').pop().toLowerCase()] || 'application/octet-stream');
    })());
    return blobs.get(k);
  }
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    const k = url && key(url);
    if (k && k.startsWith('assets/') && !k.startsWith('assets/pak/')) {
      const b = await blobFor(k);
      if (!b) return ofetch(input, init);
      const head = (init && init.method || (input && input.method) || 'GET').toUpperCase() === 'HEAD';
      return new Response(head ? null : b, { status: 200, headers: { 'content-type': b.type, 'content-length': String(b.size) } });
    }
    return ofetch(input, init);
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true, get() { return desc.get.call(this); },
    set(v) {
      const k = typeof v === 'string' && key(v);
      if (!k || !k.startsWith('assets/')) return desc.set.call(this, v);
      blobFor(k).then((b) => desc.set.call(this, b ? URL.createObjectURL(b) : v));
    },
  });
})();
</script>`;
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('<head>', '<head>' + loader);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

const count = walk(OUT).length;
console.log(`dist-itch: ${count} files, ${pakN} paks`);
fs.rmSync('hia-phat-itch.zip', { force: true });
execSync(`cd ${OUT} && zip -qr -1 ../hia-phat-itch.zip .`);
console.log('hia-phat-itch.zip', (fs.statSync('hia-phat-itch.zip').size / 1048576).toFixed(1), 'MB');
