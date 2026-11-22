// Build-time GPU texture compression (KTX2 / Basis Universal) for the GPU-only textures the game loads through
// Assets.texture() — the PBR material library, props, food, clothing shells, model maps.
//
// Why: the browser uploads JPG/PNG/WebP as uncompressed RGBA8 (4 B/px + mips): ~600 textures were ≈ 3 GB of VRAM,
// which makes 2–4 GB GPUs page and stutter. KTX2 stays compressed on the GPU (BC1/BC3/BC7 on desktop, ETC/ASTC on
// mobile, transcoded at load by three's KTX2Loader): 4–8× less VRAM and no image decode on the main thread.
// Everything is UASTC + Zstd (→ BC7 on desktop, 4× less VRAM than RGBA8): measured on a noisy 1K albedo, ETC1S
// (8×) peaked at 34 dB PSNR even at max quality, i.e. visibly blocky; UASTC level 1 is 51 dB. RDO cost 4–6× the
// encode time for −8…20 % size. Data maps (normal/orm/rough…) are tagged linear, colour sRGB.
// Encoded with KTX-Software's `toktx` (HP_TOKTX=/path/to/toktx, else `toktx` on PATH). Without it the step is
// skipped and the game keeps using the WebP/JPG originals (dev machines, old CI caches): nothing breaks.
// Originals stay in the build (Assets.image() / canvas painting still need real images); the KTX2 files are
// additional, listed in window.__HP_KTX2__ (rel path of the original → rel path of the .ktx2).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERSION = 'k3';
/** data map if the file name (without extension) ENDS in one of these tokens: …/normal, x_nrm, plastic_pp_n, …_orm */
const DATA_RE = /(^|[_\-/.])(normal|nrm|norm|nor|orm|arm|rough|roughness|metal|metalness|height|disp|displacement|bump|ao|occlusion|spec|gloss|n|r|m)$/i;
/** folders whose images are only ever used as GPU textures */
// (not the whole textures/pbr library: the world streets load those maps as bitmaps into array textures, so only
//  the PBR maps seen in Assets.texture() are listed in ktx2-list.txt)
const DIRS = ['textures/props', 'textures/food', 'textures/clothing'];
/** extra files collected at runtime from Assets.texture() (scripts/ktx2-list.txt, one rel path per line) */
const LIST = path.join(ROOT, 'scripts/ktx2-list.txt');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function findToktx() {
  const cands = [process.env.HP_TOKTX, 'toktx'].filter(Boolean);
  for (const c of cands) {
    try { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); if (r.status === 0 || /toktx/i.test((r.stdout || '') + (r.stderr || ''))) return c; } catch { /* next */ }
  }
  return null;
}

function run(bin, args) {
  return new Promise((res) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, err }));
    p.on('error', (e) => res({ code: -1, err: String(e) }));
  });
}

/** → { map: {rel → rel.ktx2}, files: {rel.ktx2 → cachePath}, stats } */
export async function buildKtx2(publicDir, { log = console.log, cacheDir = path.join(ROOT, 'node_modules/.cache/hp-ktx2') } = {}) {
  const res = { map: {}, files: {}, stats: { n: 0, ok: 0, cached: 0, bytes: 0 } };
  if (process.env.HP_NO_KTX2) return res;
  const bin = findToktx();
  if (!bin) { log('[hp-ktx2] toktx not found (set HP_TOKTX) — skipping GPU texture compression'); return res; }
  const sharp = (await import('sharp')).default;
  const assetsDir = path.join(publicDir, 'assets');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rels = new Set();
  for (const d of DIRS) for (const f of walk(path.join(assetsDir, d))) if (/\.(png|jpe?g|webp)$/i.test(f)) rels.add(path.relative(assetsDir, f).split(path.sep).join('/'));
  if (fs.existsSync(LIST)) for (const l of fs.readFileSync(LIST, 'utf8').split('\n')) { const r = l.trim(); if (r && !r.startsWith('#') && /\.(png|jpe?g|webp)$/i.test(r) && fs.existsSync(path.join(assetsDir, r))) rels.add(r); }
  const all = [...rels];
  const t0 = Date.now();
  const threads = Math.max(1, Math.min(4, os.cpus().length));
  let i = 0;
  const work = async () => {
    while (i < all.length) {
      const rel = all[i++];
      res.stats.n++;
      const abs = path.join(assetsDir, rel);
      const data = DATA_RE.test(rel.replace(/\.[^.]+$/, ''));
      const key = crypto.createHash('sha1').update(VERSION).update(rel).update(data ? 'u' : 'c').update(fs.readFileSync(abs)).digest('hex');
      const out = path.join(cacheDir, key + '.ktx2');
      const skip = path.join(cacheDir, key + '.skip');
      if (fs.existsSync(skip)) continue;
      if (!fs.existsSync(out)) {
        // toktx reads PNG/JPEG: decode anything else (WebP) or odd sizes through sharp into a temp PNG,
        // padded to a multiple of 4 (block formats); tiny images aren't worth it
        let src = abs, tmp = null;
        try {
          const meta = await sharp(abs).metadata();
          if (!meta.width || !meta.height || Math.max(meta.width, meta.height) < 128) { fs.writeFileSync(skip, ''); continue; }
          const w4 = Math.ceil(meta.width / 4) * 4, h4 = Math.ceil(meta.height / 4) * 4;
          if (/\.webp$/i.test(abs) || w4 !== meta.width || h4 !== meta.height) {
            tmp = out + '.png';
            await sharp(abs).resize(w4, h4, { fit: 'fill' }).png().toFile(tmp);
            src = tmp;
          }
        } catch (e) { log(`[hp-ktx2] skip ${rel}: ${e.message}`); fs.writeFileSync(skip, ''); continue; }
        const common = ['--t2', '--genmipmap', '--lower_left_maps_to_s0t0', '--threads', '1'];
        const args = data
          ? [...common, '--encode', 'uastc', '--uastc_quality', '1', '--zcmp', '18', '--assign_oetf', 'linear', '--assign_primaries', 'none']
          : [...common, '--encode', 'uastc', '--uastc_quality', '1', '--zcmp', '18', '--assign_oetf', 'srgb'];
        const r = await run(bin, [...args, out + '.tmp', src]);
        if (tmp) { try { fs.unlinkSync(tmp); } catch { /* */ } }
        if (r.code !== 0 || !fs.existsSync(out + '.tmp')) { log(`[hp-ktx2] failed ${rel}: ${r.err.split('\n')[0]}`); fs.writeFileSync(skip, ''); continue; }
        fs.renameSync(out + '.tmp', out);
      } else res.stats.cached++;
      const krel = rel.replace(/\.[^.]+$/, '.ktx2');
      res.map[rel] = krel;
      res.files[krel] = out;
      res.stats.ok++;
      res.stats.bytes += fs.statSync(out).size;
    }
  };
  await Promise.all(Array.from({ length: threads }, work));
  log(`[hp-ktx2] ${res.stats.ok}/${res.stats.n} textures → KTX2 (${(res.stats.bytes / 1e6).toFixed(1)} MB, ${res.stats.cached} cached, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return res;
}

/** copy the Basis transcoder next to the build (KTX2Loader fetches it at runtime) */
export function copyTranscoder(outDir) {
  const src = path.join(ROOT, 'node_modules/three/examples/jsm/libs/basis');
  const dst = path.join(outDir, 'basis');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

// standalone: node scripts/ktx2.mjs → encodes into the cache and prints the result
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await buildKtx2(path.join(ROOT, 'public'));
}
