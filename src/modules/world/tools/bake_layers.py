#!/usr/bin/env python3
"""Pre-bake the world texture-array layers (see src/modules/world/mats.ts LAYERS) to 512x512 JPEGs
in public/assets/gen/world/layers/ so the browser decodes small images instead of 2K sources.
Run from the repo root:  python3 src/modules/world/tools/bake_layers.py"""
import json, os, re, sys
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
A = os.path.join(ROOT, 'public/assets')
OUT = os.path.join(A, 'gen/world/layers')
os.makedirs(OUT, exist_ok=True)
src_ts = open(os.path.join(ROOT, 'src/modules/world/mats.ts'), encoding='utf-8').read()
block = src_ts.split('export const LAYERS')[1].split('];')[0]
layers = []
for m in re.finditer(r"\{\s*name:\s*'([^']+)',\s*src:\s*\[([^\]]*)\]", block):
    layers.append((m.group(1), re.findall(r"'([^']+)'", m.group(2))))
pbr = json.load(open(os.path.join(A, 'textures/pbr/manifest.json'), encoding='utf-8'))
S = int(sys.argv[1]) if len(sys.argv) > 1 else 512
out = {}
for name, srcs in layers:
    res = None
    for s in srcs:
        if s.startswith('w:'):
            b = s[2:]
            p = os.path.join(A, 'textures/world', b + '_albedo.jpg')
            if os.path.exists(p):
                res = {'albedo': p, 'normal': os.path.join(A, 'textures/world', b + '_normal.jpg'), 'orm': os.path.join(A, 'textures/world', b + '_orm.jpg'), 'src': s}
                break
        elif s.startswith('p:'):
            e = pbr.get(s[2:])
            if not e: continue
            def P(f):
                if f.startswith('textures'): return os.path.join(A, f)
                if '/' in f: return os.path.join(A, 'textures/pbr', f)
                return os.path.join(A, 'textures/pbr', s[2:], f)
            res = {'albedo': P(e['albedo']), 'normal': P(e['normal']) if e.get('normal') else None, 'orm': P(e['orm']) if e.get('orm') else None, 'src': s, 'tile': e.get('tileMeters')}
            break
    if not res:
        continue
    rec = {'src': res['src']}
    for k, suf in (('albedo', 'a'), ('normal', 'n'), ('orm', 'o')):
        p = res.get(k)
        if not p or not os.path.exists(p): continue
        im = Image.open(p).convert('RGB').resize((S, S), Image.LANCZOS)
        fn = f'{name}_{suf}.jpg'
        im.save(os.path.join(OUT, fn), quality=90 if k == 'albedo' else 94, optimize=True)
        rec[k] = 'gen/world/layers/' + fn
        if k == 'orm':
            px = im.getchannel('B')
            rec['metal'] = round(sum(px.getdata()) / (S * S) / 255.0, 3)
    if res.get('tile'): rec['tile'] = res['tile']
    out[name] = rec
# keep the extra 'g:' layers baked by bake_arch.py (buildings agent)
try:
    prev = json.load(open(os.path.join(OUT, 'layers.json'), encoding='utf-8')).get('layers', {})
    for k, v in prev.items():
        if str(v.get('src', '')).startswith('g:') and k not in out: out[k] = v
except Exception:
    pass
json.dump({'size': S, 'layers': out}, open(os.path.join(OUT, 'layers.json'), 'w'), indent=1)
print('baked', len(out), 'layers →', OUT)
