#!/usr/bin/env python3
"""Bake the buildings agent's extra texture-array layers ('g:<name>' sources in mats.ts LAYERS) into
public/assets/gen/world/layers/ and merge them into layers.json (bake_layers.py keeps 'g:' entries).

Sources (all real photos / photoscans, see public/assets/gen/world/models/CREDITS.md + references/credits):
  - Thai drain & manhole covers (textures/world, streets research agent photos)
Run from the repo root:  python3 src/modules/world/tools/bake_arch.py"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
A = os.path.join(ROOT, 'public/assets')
TW = os.path.join(A, 'textures/world')
OUT = os.path.join(A, 'gen/world/layers')
S = 512
os.makedirs(OUT, exist_ok=True)


def crop(im, box):
    w, h = im.size
    return im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def flat_orm(rough=0.8, metal=0.0, ao=1.0):
    return Image.new('RGB', (S, S), (int(ao * 255), int(rough * 255), int(metal * 255)))


def normal_from_height(gray, strength=2.5):
    h = np.asarray(gray.convert('L').resize((S, S), Image.LANCZOS), dtype=np.float32) / 255.0
    h = ndimage.gaussian_filter(h, 1.0)
    dx = ndimage.sobel(h, axis=1) * strength
    dy = ndimage.sobel(h, axis=0) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), 'RGB')


def save(name, src, alb, nrm, orm, alpha=None, metal=None):
    rec = {'src': 'g:' + name}
    alb = alb.convert('RGB').resize((S, S), Image.LANCZOS)
    if alpha is not None:
        a = alpha.convert('L').resize((S, S), Image.LANCZOS)
        im = alb.copy(); im.putalpha(a)
        fn = f'{name}_a.png'; im.save(os.path.join(OUT, fn), optimize=True)
    else:
        fn = f'{name}_a.jpg'; alb.save(os.path.join(OUT, fn), quality=90, optimize=True)
    rec['albedo'] = 'gen/world/layers/' + fn
    for img, suf, key in ((nrm, 'n', 'normal'), (orm, 'o', 'orm')):
        img = img.convert('RGB').resize((S, S), Image.LANCZOS)
        fn = f'{name}_{suf}.jpg'; img.save(os.path.join(OUT, fn), quality=94, optimize=True)
        rec[key] = 'gen/world/layers/' + fn
    if metal is None:
        metal = round(float(np.asarray(orm.convert('RGB'))[..., 2].mean()) / 255.0, 3)
    rec['metal'] = metal
    rec['from'] = src
    return name, rec


out = {}

# ---------------------------------------------------------------- Thai drain covers
# round cast-iron manhole (alpha circle): composite on dark iron so the disc edge never shows background
im = Image.open(os.path.join(TW, 'manhole_round_iron.png')).convert('RGBA')
bg = Image.new('RGBA', im.size, (52, 46, 40, 255)); bg.alpha_composite(im)
nrm = Image.open(os.path.join(TW, 'manhole_round_iron_normal.jpg'))
orm = Image.open(os.path.join(TW, 'manhole_round_drain_orm.jpg'))
k, r = save('drain_round', 'textures/world/manhole_round_iron.png', bg, nrm, orm); out[k] = r

# square BMA-style cover with the fish relief (cover only, no concrete surround)
box = (0.2, 0.06, 0.96, 0.91)
im = crop(Image.open(os.path.join(TW, 'manhole_square_bma_albedo.jpg')), box)
nrm = crop(Image.open(os.path.join(TW, 'manhole_square_bma_normal.jpg')), box)
orm = crop(Image.open(os.path.join(TW, 'manhole_square_bma_orm.jpg')), box)
k, r = save('drain_square', 'textures/world/manhole_square_bma_albedo.jpg', im, nrm, orm); out[k] = r

# double drain cover with slots → alpha holes (you see down the shaft)
box = (0.13, 0.074, 0.865, 0.9)
im = crop(Image.open(os.path.join(TW, 'manhole_double_drain_cover_albedo.jpg')), box)
nrm = crop(Image.open(os.path.join(TW, 'manhole_double_drain_cover_normal.jpg')), box)
orm = crop(Image.open(os.path.join(TW, 'manhole_double_drain_cover_orm.jpg')), box)
g = np.asarray(im.convert('L').resize((S, S), Image.LANCZOS), dtype=np.float32)
holes = g < 38
holes = ndimage.binary_opening(holes, iterations=2)
lab, nl = ndimage.label(holes)
sizes = ndimage.sum(holes, lab, range(1, nl + 1))
keep = np.zeros_like(holes)
for i, sz in enumerate(sizes):
    if 60 < sz < 4000:
        keep |= lab == (i + 1)
keep = ndimage.binary_dilation(keep, iterations=2)
alpha = Image.fromarray(np.where(keep, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.8))
k, r = save('drain_slots', 'textures/world/manhole_double_drain_cover_albedo.jpg', im, nrm, orm, alpha=alpha); out[k] = r

# gutter trench grate (cast iron bars) → alpha gaps
im = Image.open(os.path.join(TW, 'trench_grate_cast_iron_photo_albedo.jpg'))
nrm = Image.open(os.path.join(TW, 'trench_grate_cast_iron_photo_normal.jpg'))
orm = Image.open(os.path.join(TW, 'trench_grate_cast_iron_photo_orm.jpg'))
g = np.asarray(im.convert('L').resize((S, S), Image.LANCZOS), dtype=np.float32)
loc = ndimage.uniform_filter(g, 25)
gaps = (g < loc * 0.62) & (g < 60)
gaps = ndimage.binary_opening(gaps, iterations=1)
alpha = Image.fromarray(np.where(gaps, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.6))
k, r = save('grate_iron', 'textures/world/trench_grate_cast_iron_photo_albedo.jpg', im, nrm, orm, alpha=alpha); out[k] = r

# ---------------------------------------------------------------- merge
lp = os.path.join(OUT, 'layers.json')
J = json.load(open(lp)) if os.path.exists(lp) else {'size': S, 'layers': {}}
J['layers'].update(out)
json.dump(J, open(lp, 'w'), indent=1)
print('baked', len(out), 'arch layers:', ', '.join(out))
