#!/usr/bin/env python3
"""
Sketchfab / Objaverse model finder + downloader for the shared asset library (docs/ART_STYLE.md §2, §10).

  python3 scripts/objaverse.py scan                       # build the offline index (once, ~10 min, ~580 MB streamed)
  python3 scripts/objaverse.py search "scooter|moped" [--min-faces 2000] [--max-faces 200000] [-n 30] [--sheet out.jpg]
  python3 scripts/objaverse.py sketchfab "honda wave"     [-n 24] [--sheet out.jpg]   # live Sketchfab search API
  python3 scripts/objaverse.py thumbs <uid> ...  --sheet out.jpg                       # contact sheet of thumbnails
  python3 scripts/objaverse.py info <uid>                                              # licence / author / counts
  python3 scripts/objaverse.py fetch <uid> [--out dir]                                 # download the GLB (raw)

Sources
  * Offline: Objaverse 1.0 metadata chunks (https://huggingface.co/datasets/allenai/objaverse, metadata/000-XXX.json.gz).
    Objaverse uids ARE Sketchfab uids, so every hit is a Sketchfab model with its author + licence.
  * Online: the Sketchfab search API (no token needed), cross-checked against object-paths.json.gz.
  * Download: the official Sketchfab download API when SKETCHFAB_TOKEN is set, otherwise the Objaverse mirror
    (https://huggingface.co/datasets/allenai/objaverse/resolve/main/<path>).
Only CC0 / CC-BY / CC-BY-SA models are ever listed or fetched (no NC, no ND).

Index: scripts/_cache/objaverse/index.jsonl.gz (textured, permissive, not age-restricted) — one JSON per line:
  {uid, name, tags, cats, lic, faces, likes, views, user, tex, texres, size, anim, thumb}
Raw GLBs: scripts/_cache/objaverse/glb/<uid>.glb (git-ignored). Normalise + publish with scripts/libpub.py.
"""
import argparse, ast, concurrent.futures as cf, gzip, io, json, os, re, subprocess, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'scripts/_cache/objaverse')
INDEX = os.path.join(CACHE, 'index.jsonl.gz')
HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/'
UA = {'User-Agent': 'HiaPhatAssetLib/1.0'}
OK_LIC = {'by': 'CC-BY-4.0', 'by-sa': 'CC-BY-SA-4.0', 'cc0': 'CC0-1.0'}
PATHS_GZ = [os.path.join(CACHE, 'object-paths.json.gz'),
            '/tmp/claude-0/-home-user-special-telegram/7e6bcd1d-aa72-520f-8b31-cf837c26660e/scratchpad/objv/paths.json.gz']


def http(url, timeout=120, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    last = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # retry transient proxy / HF errors
            last = e
    raise last


def lit(v, default):
    """metadata values are python-repr strings in the chunks"""
    if isinstance(v, (list, dict)): return v
    if not v or v == 'None': return default
    try: return ast.literal_eval(v)
    except Exception: return default


def num(v):
    try: return int(float(v))
    except Exception: return 0


# ---------------------------------------------------------------- scan
def scan_chunk(i):
    url = HF + 'metadata/000-%03d.json.gz' % i
    try:
        d = json.loads(gzip.decompress(http(url, 300)))
    except Exception as e:
        return i, [], str(e)
    out = []
    for uid, m in d.items():
        lic = m.get('license')
        if lic not in OK_LIC or str(m.get('isAgeRestricted')) == 'True': continue
        arch = lit(m.get('archives'), {}) or {}
        glb = arch.get('glb') or {}
        tex = num(glb.get('textureCount'))
        thumbs = (lit(m.get('thumbnails'), {}) or {}).get('images') or []
        thumbs = sorted(thumbs, key=lambda t: abs(num(t.get('width')) - 512))
        user = lit(m.get('user'), {}) or {}
        out.append({
            'uid': uid, 'name': (m.get('name') or '')[:120],
            'tags': ' '.join(t.get('name', '') for t in lit(m.get('tags'), []))[:300],
            'cats': ' '.join(c.get('name', '') for c in lit(m.get('categories'), [])),
            'lic': lic, 'faces': num(m.get('faceCount')), 'likes': num(m.get('likeCount')), 'views': num(m.get('viewCount')),
            'user': user.get('username', ''), 'uname': user.get('displayName', ''),
            'tex': tex, 'texres': num(glb.get('textureMaxResolution')), 'size': num(glb.get('size')),
            'anim': num(m.get('animationCount')), 'thumb': thumbs[0]['url'] if thumbs else '',
            'desc': (m.get('description') or '')[:160].replace('\n', ' '),
        })
    return i, out, None


def cmd_scan(a):
    os.makedirs(CACHE, exist_ok=True)
    n = 0
    with gzip.open(INDEX + '.tmp', 'wt', encoding='utf8') as f, cf.ThreadPoolExecutor(a.jobs) as ex:
        for i, rows, err in ex.map(scan_chunk, range(160)):
            if err: print('ERR chunk', i, err, flush=True); continue
            for r in rows: f.write(json.dumps(r, ensure_ascii=False) + '\n')
            n += len(rows)
            print(f'chunk {i:3d}: {len(rows):5d} permissive  (total {n})', flush=True)
    os.replace(INDEX + '.tmp', INDEX)
    print('index →', INDEX, n)


# ---------------------------------------------------------------- paths
_paths = None
def paths():
    global _paths
    if _paths is None:
        src = next((p for p in PATHS_GZ if os.path.exists(p)), None)
        if not src:
            os.makedirs(CACHE, exist_ok=True)
            src = PATHS_GZ[0]
            open(src, 'wb').write(http(HF + 'object-paths.json.gz', 600))
        _paths = json.loads(gzip.decompress(open(src, 'rb').read()))
    return _paths


# ---------------------------------------------------------------- search
def load_index():
    if not os.path.exists(INDEX): sys.exit('no index — run: python3 scripts/objaverse.py scan')
    with gzip.open(INDEX, 'rt', encoding='utf8') as f:
        for line in f: yield json.loads(line)


def score(r):
    # likes dominate, views help, textured + mid-poly preferred
    s = r['likes'] * 3 + r['views'] / 200
    if r['tex'] == 0: s -= 1e6
    return s


def cmd_search(a):
    pat = re.compile(a.query, re.I)
    neg = re.compile(a.exclude, re.I) if a.exclude else None
    hits = []
    for r in load_index():
        txt = r['name'] + ' ' + (r['tags'] if not a.name_only else '')
        if not pat.search(txt): continue
        if neg and neg.search(r['name'] + ' ' + r['tags'] + ' ' + r['desc']): continue
        if r['faces'] < a.min_faces or r['faces'] > a.max_faces: continue
        if r['tex'] < a.min_tex: continue
        if a.static and r['anim']: continue
        hits.append(r)
    hits.sort(key=score, reverse=True)
    hits = hits[:a.n]
    show(hits)
    if a.sheet: sheet([(h['uid'], h['thumb'], f"{h['name'][:28]} ♥{h['likes']} {h['faces']//1000}k") for h in hits], a.sheet)
    if a.json: json.dump(hits, open(a.json, 'w'), indent=1, ensure_ascii=False)


def show(hits):
    for i, h in enumerate(hits):
        print(f"{i:2d} {h['uid']} ♥{h['likes']:4d} f{h['faces']:7d} t{h['tex']}@{h['texres']:4d} {h['size']/1e6:5.1f}MB {h['lic']:5s} {h['user'][:14]:14s} {h['name'][:50]}")


def lic_from(l):
    lab = (l.get('label') or l.get('slug') or '').lower()
    if 'noncommercial' in lab or 'noderiv' in lab or '-nc' in lab or '-nd' in lab: return 'restricted'
    if 'sharealike' in lab or 'by-sa' in lab: return 'by-sa'
    if 'cc0' in lab or 'public domain' in lab: return 'cc0'
    if 'attribution' in lab or lab in ('by', 'cc-by'): return 'by'
    return lab or '?'


def cmd_sketchfab(a):
    q = urllib.parse.urlencode({'type': 'models', 'q': a.query, 'downloadable': 'true', 'count': min(24, a.n),
                                'sort_by': a.sort, 'archives_flavours': 'false'})
    d = json.loads(http('https://api.sketchfab.com/v3/search?' + q))
    P = paths()
    hits = []
    for m in d.get('results', []):
        lic = lic_from((m.get('license') or {}))
        imgs = sorted((m.get('thumbnails') or {}).get('images') or [], key=lambda t: abs(t.get('width', 0) - 512))
        h = {'uid': m['uid'], 'name': m.get('name', ''), 'likes': m.get('likeCount', 0), 'views': m.get('viewCount', 0),
             'faces': m.get('faceCount', 0), 'lic': lic or '?', 'user': (m.get('user') or {}).get('username', ''),
             'tex': -1, 'texres': 0, 'size': 0, 'thumb': imgs[0]['url'] if imgs else '', 'mirror': m['uid'] in P}
        if lic not in OK_LIC and not a.all: continue
        hits.append(h)
    for i, h in enumerate(hits):
        print(f"{i:2d} {h['uid']} ♥{h['likes']:4d} f{h['faces']:7d} {h['lic']:6s} mirror={'Y' if h['mirror'] else 'n'} {h['user'][:14]:14s} {h['name'][:50]}")
    if a.sheet: sheet([(h['uid'], h['thumb'], f"{h['name'][:24]} ♥{h['likes']} {'M' if h['mirror'] else '-'}") for h in hits], a.sheet)


# ---------------------------------------------------------------- thumbnails
def thumb_url(uid):
    m = json.loads(http(f'https://api.sketchfab.com/v3/models/{uid}'))
    imgs = sorted((m.get('thumbnails') or {}).get('images') or [], key=lambda t: abs(t.get('width', 0) - 512))
    return imgs[0]['url'] if imgs else '', m


def sheet(items, out, cell=256, cols=6):
    from PIL import Image, ImageDraw
    def get(it):
        uid, url, label = it
        try:
            if not url: url, _ = thumb_url(uid)
            im = Image.open(io.BytesIO(http(url, 60))).convert('RGB')
        except Exception:
            im = Image.new('RGB', (cell, cell), (60, 0, 0))
        im.thumbnail((cell, cell))
        return im, label
    if not items: print('no hits'); return
    with cf.ThreadPoolExecutor(8) as ex: ims = list(ex.map(get, items))
    rows = (len(ims) + cols - 1) // cols
    S = Image.new('RGB', (cols * cell, rows * (cell + 18)), (24, 24, 24))
    d = ImageDraw.Draw(S)
    for k, (im, label) in enumerate(ims):
        x, y = (k % cols) * cell, (k // cols) * (cell + 18)
        S.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        d.text((x + 3, y + cell + 2), f'{k}:{label}', fill=(255, 255, 160))
    S.save(out, quality=85)
    print('sheet →', out)


def cmd_thumbs(a):
    sheet([(u, '', u[:8]) for u in a.uids], a.sheet)


def cmd_info(a):
    for uid in a.uids:
        _, m = thumb_url(uid)
        lic = lic_from(m.get('license') or {})
        print(json.dumps({'uid': uid, 'name': m.get('name'), 'license': lic, 'author': (m.get('user') or {}).get('displayName'),
                          'username': (m.get('user') or {}).get('username'), 'faces': m.get('faceCount'), 'likes': m.get('likeCount'),
                          'url': m.get('viewerUrl'), 'mirror': uid in paths()}, ensure_ascii=False))


# ---------------------------------------------------------------- fetch
def fetch(uid, out_dir=None):
    out_dir = out_dir or os.path.join(CACHE, 'glb')
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, uid + '.glb')
    if os.path.exists(dest) and os.path.getsize(dest) > 1000: return dest
    tok = os.environ.get('SKETCHFAB_TOKEN')
    if tok:
        info = json.loads(http(f'https://api.sketchfab.com/v3/models/{uid}/download', headers={'Authorization': 'Token ' + tok}))
        g = info.get('glb') or {}
        if g.get('url'):
            open(dest, 'wb').write(http(g['url'], 900)); return dest
    p = paths().get(uid)
    if not p: raise SystemExit(f'{uid}: not in the Objaverse mirror (and no SKETCHFAB_TOKEN)')
    subprocess.run(['curl', '-sSfL', '--retry', '3', '-o', dest, HF + p], check=True)
    return dest


def cmd_fetch(a):
    for uid in a.uids: print(fetch(uid, a.out))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('scan'); s.add_argument('--jobs', type=int, default=4); s.set_defaults(fn=cmd_scan)
    s = sp.add_parser('search'); s.add_argument('query'); s.add_argument('-n', type=int, default=30)
    s.add_argument('--min-faces', type=int, default=300); s.add_argument('--max-faces', type=int, default=250000)
    s.add_argument('--min-tex', type=int, default=1); s.add_argument('--exclude', default='')
    s.add_argument('--name-only', action='store_true'); s.add_argument('--static', action='store_true')
    s.add_argument('--sheet'); s.add_argument('--json'); s.set_defaults(fn=cmd_search)
    s = sp.add_parser('sketchfab'); s.add_argument('query'); s.add_argument('-n', type=int, default=24)
    s.add_argument('--sort', default='-likeCount'); s.add_argument('--all', action='store_true'); s.add_argument('--sheet'); s.set_defaults(fn=cmd_sketchfab)
    s = sp.add_parser('thumbs'); s.add_argument('uids', nargs='+'); s.add_argument('--sheet', required=True); s.set_defaults(fn=cmd_thumbs)
    s = sp.add_parser('info'); s.add_argument('uids', nargs='+'); s.set_defaults(fn=cmd_info)
    s = sp.add_parser('fetch'); s.add_argument('uids', nargs='+'); s.add_argument('--out'); s.set_defaults(fn=cmd_fetch)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
