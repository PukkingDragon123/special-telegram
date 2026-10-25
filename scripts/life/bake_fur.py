# Bake game-ready fur textures for a rigged creature GLB (life module, shell + fin fur in creature.ts).
#   python3 -I scripts/life/bake_fur.py <creature.glb> <strand_photo.jpg> <out_prefix> <cfg.json>
#   e.g. python3 -I scripts/life/bake_fur.py public/assets/gen/life/models/dog.glb <photo> public/assets/gen/life/tex/dog public/assets/gen/life/data/fur_dog.json
# The cfg json is ALSO read at runtime by creature.ts (comb rules: hipBone, headBone, rules, noFurBones).
# Outputs (atlas UV space of the GLB's body mesh):
#   <out_prefix>_albedo.jpg   recoloured albedo: model's low-frequency colour layout × REAL fur-photo strand detail,
#                             the photo resampled along the strand-flow field (cell-rotated texture synthesis)
#   <out_prefix>_fur.jpg      R = flow-aligned strand density (from the same photo), G = fur mask (0 = no fur:
#                             eyes, nose, pads, mouth, teeth, tongue), B = wetness (eyes, nose, tongue: glossy)
#   <out_prefix>_flow.png     RG = strand flow direction in UV space (debug / optional)
# The per-vertex comb direction uses the SAME rules as combDirs() in src/modules/life/creature.ts.
import json, struct, sys, re, math
import numpy as np, cv2

glb_path, photo_path, out_prefix, cfg_path = sys.argv[1:5]
CFG = json.load(open(cfg_path))
SIZE = CFG.get('size', 2048)

# ------------------------------------------------------------------ GLB
f = open(glb_path, 'rb').read()
jl, _ = struct.unpack('<II', f[12:20]); J = json.loads(f[20:20 + jl])
off = 20 + jl; bl, _ = struct.unpack('<II', f[off:off + 8]); BIN = f[off + 8:off + 8 + bl]
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 0) or dt.itemsize * n
    raw = np.frombuffer(BIN, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=o)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
    arr = out.view(dt).reshape(a['count'], n)
    if a.get('normalized') and dt != np.float32: arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr

# pick the body primitive (largest vertex count with a skin)
best = None
for ni, node in enumerate(J['nodes']):
    if 'mesh' not in node or 'skin' not in node: continue
    for pi, prim in enumerate(J['meshes'][node['mesh']]['primitives']):
        n = J['accessors'][prim['attributes']['POSITION']]['count']
        if prim.get('material') not in CFG.get('materials', [prim.get('material')]): continue
        if best is None or n > best[0]: best = (n, ni, pi)
_, NODE, PRIM = best
prim = J['meshes'][J['nodes'][NODE]['mesh']]['primitives'][PRIM]
P = acc(prim['attributes']['POSITION']).astype(np.float64)
N = acc(prim['attributes']['NORMAL']).astype(np.float64)
UV = acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
JI = acc(prim['attributes']['JOINTS_0']).astype(np.int64)
JW = acc(prim['attributes']['WEIGHTS_0']).astype(np.float64)
IDX = acc(prim['indices']).reshape(-1, 3).astype(np.int64)
skin = J['skins'][J['nodes'][NODE]['skin']]
joints = skin['joints']
IBM = acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major → row-major
names = [re.sub(r'^mixamorig:?', '', J['nodes'][j].get('name', '')) for j in joints]
BP = np.array([np.linalg.inv(m)[:3, 3] for m in IBM])  # bind-space joint positions (mesh space)
print('mesh', len(P), 'verts', len(IDX), 'tris', len(joints), 'joints')

# ------------------------------------------------------------------ per-vertex comb (keep in sync with creature.ts combDirs)
R = CFG['rules']  # list of [regex, kind, lengthMul]
def rx(name, pat): return re.search(pat, name) is not None
def find(pat):
    for i, n in enumerate(names):
        if rx(n, pat): return i
    return None
hip_i, head_i = find(CFG['hipBone']), find(CFG['headBone'])
fwd = BP[head_i] - BP[hip_i]; fwd[1] = 0; fwd /= np.linalg.norm(fwd)
up = np.array([0.0, 1.0, 0.0])
children = {}
for i, j in enumerate(joints):
    for c in J['nodes'][j].get('children', []):
        if c in joints: children.setdefault(i, []).append(joints.index(c))
def chain_dir(i):
    cs = [c for c in children.get(i, []) if not rx(names[c], r'corrective|_end')]
    if not cs: return None
    d = BP[cs[0]] - BP[i]; n = np.linalg.norm(d)
    return d / n if n > 1e-9 else None
bdir = np.zeros((len(joints), 3)); blen = np.ones(len(joints))
for i, n in enumerate(names):
    kind, lm = 'back', 1.0
    for pat, k, l in R:
        if rx(n, pat): kind, lm = k, l; break
    if kind == 'back': d = -fwd
    elif kind == 'down': d = -up * 0.85 - fwd * 0.3
    elif kind == 'chain':
        d = chain_dir(i)
        if d is None:
            p = [k for k, cs in children.items() if i in cs]
            d = chain_dir(p[0]) if p else None
            if d is None: d = -fwd
    elif kind == 'none': d = -fwd
    else: d = -fwd
    bdir[i] = d / max(1e-9, np.linalg.norm(d)); blen[i] = lm
comb = (JW[:, :, None] * bdir[JI]).sum(1) + np.array([0, -0.3, 0])
furlen = (JW * blen[JI]).sum(1)
Nn = N / np.maximum(1e-9, np.linalg.norm(N, axis=1, keepdims=True))
comb -= Nn * (comb * Nn).sum(1, keepdims=True)
ln = np.linalg.norm(comb, axis=1, keepdims=True)
fallback = -up - Nn * (-up * Nn).sum(1, keepdims=True)
comb = np.where(ln > 0.15, comb / np.maximum(ln, 1e-9), fallback / np.maximum(1e-9, np.linalg.norm(fallback, axis=1, keepdims=True)))

# no-fur weight from bones (eyes, tongue, teeth …)
nofur_b = np.array([1.0 if any(rx(n, p) for p in CFG.get('noFurBones', [])) else 0.0 for n in names])
nofur_v = (JW * nofur_b[JI]).sum(1)
dark_b = np.array([1.0 if any(rx(n, p) for p in CFG.get('darkBones', [])) else 0.0 for n in names])
dark_v = (JW * dark_b[JI]).sum(1)
print('nofur verts', int((nofur_v > 0.5).sum()), 'dark verts', int((dark_v > 0.5).sum()))

# ------------------------------------------------------------------ per-vertex UV flow (direction of comb in UV space)
flow_uv = np.zeros((len(P), 2)); cnt = np.zeros(len(P))
for a, b, c in IDX:
    e1, e2 = P[b] - P[a], P[c] - P[a]
    d1, d2 = UV[b] - UV[a], UV[c] - UV[a]
    det = d1[0] * d2[1] - d2[0] * d1[1]
    if abs(det) < 1e-12: continue
    T = (e1 * d2[1] - e2 * d1[1]) / det    # dP/du
    B = (e2 * d1[0] - e1 * d2[0]) / det    # dP/dv
    G = np.array([[T @ T, T @ B], [T @ B, B @ B]])
    try: Gi = np.linalg.inv(G)
    except np.linalg.LinAlgError: continue
    for v in (a, b, c):
        rhs = np.array([comb[v] @ T, comb[v] @ B])
        duv = Gi @ rhs
        nn = np.linalg.norm(duv)
        if nn > 1e-12: flow_uv[v] += duv / nn; cnt[v] += 1
flow_uv /= np.maximum(1e-9, np.linalg.norm(flow_uv, axis=1, keepdims=True))

# ------------------------------------------------------------------ rasterize per-vertex attributes into the atlas
FS = 1024
def raster(vals, size, fill=0.0):
    ch = vals.shape[1]
    img = np.full((size, size, ch), fill, np.float32); cov = np.zeros((size, size), np.float32)
    uvp = UV * size  # glTF uv: v down = image row
    for a, b, c in IDX:
        pa, pb, pc = uvp[a], uvp[b], uvp[c]
        x0, x1 = int(max(0, math.floor(min(pa[0], pb[0], pc[0])))), int(min(size - 1, math.ceil(max(pa[0], pb[0], pc[0]))))
        y0, y1 = int(max(0, math.floor(min(pa[1], pb[1], pc[1])))), int(min(size - 1, math.ceil(max(pa[1], pb[1], pc[1]))))
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(den) < 1e-12: continue
        l1 = ((pb[1] - pc[1]) * (xs - pc[0]) + (pc[0] - pb[0]) * (ys - pc[1])) / den
        l2 = ((pc[1] - pa[1]) * (xs - pc[0]) + (pa[0] - pc[0]) * (ys - pc[1])) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not m.any(): continue
        v = l1[..., None] * vals[a] + l2[..., None] * vals[b] + l3[..., None] * vals[c]
        sub = img[y0:y1 + 1, x0:x1 + 1]; sub[m] = v[m]
        cov[y0:y1 + 1, x0:x1 + 1][m] = 1
    return img, cov
wet_b = np.array([1.0 if any(rx(n, p) for p in CFG.get('wetBones', [])) else 0.0 for n in names])
wet_v = (JW * wet_b[JI]).sum(1)
# street grime: dusty lower legs / paws and belly (bind-space height & normal)
dc = CFG.get('dust', {})
if dc:
    y0, y1 = dc.get('legY', [0.17, 0.03])
    t = np.clip((y0 - P[:, 1]) / (y0 - y1), 0, 1); legs = t * t * (3 - 2 * t)
    belly = np.clip((-Nn[:, 1] - 0.35) / 0.5, 0, 1) * dc.get('belly', 0.35)
    dust_v = np.maximum(legs, belly)
else:
    dust_v = np.zeros(len(P))
attrs = np.concatenate([flow_uv, wet_v[:, None], 1 - nofur_v[:, None], dark_v[:, None], dust_v[:, None]], 1)
A, COV = raster(attrs, FS)
# dilate into gutters
filled = COV > 0
for _ in range(24):
    if filled.all(): break
    blur = cv2.blur(A * filled[..., None], (3, 3)); w = cv2.blur(filled.astype(np.float32), (3, 3))
    grow = (~filled) & (w > 0)
    A[grow] = blur[grow] / w[grow][:, None]; filled = filled | grow
# smooth the flow (keep unit length) and the scalar maps
fl = cv2.GaussianBlur(A[..., :2], (0, 0), 3)
fl /= np.maximum(1e-6, np.linalg.norm(fl, axis=2, keepdims=True))
if CFG.get('writeFlow'):
    fl8 = np.clip((fl * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    cv2.imwrite(out_prefix + '_flow.png', np.dstack([np.full((FS, FS), 128, np.uint8), fl8[..., 1], fl8[..., 0]]))

# ------------------------------------------------------------------ strand texture synthesis (real photo along the flow)
src = cv2.imread(photo_path)
cx, cy, cw, chh = CFG.get('photoCrop', [0, 0, src.shape[1], src.shape[0]])
src = src[cy:cy + chh, cx:cx + cw]
if CFG.get('photoRotate'): src = cv2.rotate(src, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[CFG['photoRotate']])
g = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
g = g - cv2.GaussianBlur(g, (0, 0), 25) + g.mean()      # flatten lighting
# seamless tile (cross-fade with half-shifted copy)
h, w = g.shape
sh = np.roll(np.roll(g, h // 2, 0), w // 2, 1)
yy = np.linspace(-1, 1, h)[:, None]; xx = np.linspace(-1, 1, w)[None, :]
rr = np.clip(np.maximum(np.abs(xx), np.abs(yy)), 0, 1)
mk = 0.5 - 0.5 * np.cos(np.clip((rr - 0.55) / 0.45, 0, 1) * np.pi)
g = g * (1 - mk) + sh * mk
g = ((g - g.mean()) / (g.std() + 1e-6)).astype(np.float32)          # zero-mean, unit variance strand signal
# photo strand direction (structure tensor, dominant)
gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
Jxx, Jyy, Jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
theta_grad = 0.5 * math.atan2(2 * Jxy, Jxx - Jyy)      # dominant gradient angle
photo_ang = theta_grad + math.pi / 2                    # strands run perpendicular to the gradient
print('photo strand angle', round(math.degrees(photo_ang), 1))

S = SIZE
flS = cv2.resize(fl, (S, S), interpolation=cv2.INTER_LINEAR)
ang = np.arctan2(flS[..., 1], flS[..., 0])           # target angle in image coords (x right, y down)
scale = CFG.get('photoScale', 2.0) * S / 2048          # source px per atlas px
CELL = CFG.get('cell', 96) * S // 2048
rng = np.random.default_rng(7)
ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
acc_s = np.zeros((S, S), np.float32); acc_w = np.zeros((S, S), np.float32)
ncx, ncy = S // CELL + 2, S // CELL + 2
offs = rng.uniform(0, 1, (ncy, ncx, 2)) * [w, h]
for oy in (0, 1):
    for ox in (0, 1):
        # cell grid shifted by half a cell for the 2x2 bilinear blend
        cxg = (np.floor(xs / CELL - 0.5) + ox).astype(np.int32); cyg = (np.floor(ys / CELL - 0.5) + oy).astype(np.int32)
        ccx = (cxg + 0.5) * CELL; ccy = (cyg + 0.5) * CELL
        wx = np.clip(1 - np.abs((xs - ccx) / CELL), 0, 1)
        wy = np.clip(1 - np.abs((ys - ccy) / CELL), 0, 1)
        wgt = wx * wy
        dx, dy = (xs - ccx) * scale, (ys - ccy) * scale
        a = photo_ang - ang                                   # rotate target frame into the photo's strand frame
        ca, sa = np.cos(a), np.sin(a)
        sx = ca * dx - sa * dy; sy = sa * dx + ca * dy
        o = offs[np.clip(cyg + 1, 0, ncy - 1), np.clip(cxg + 1, 0, ncx - 1)]
        mapx = ((sx + o[..., 0]) % w).astype(np.float32); mapy = ((sy + o[..., 1]) % h).astype(np.float32)
        smp = cv2.remap(g, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
        acc_s += smp * wgt; acc_w += wgt * wgt
strand = acc_s / np.sqrt(np.maximum(acc_w, 1e-6))   # variance-preserving blend
strand = np.clip(strand, -3, 3)

# ------------------------------------------------------------------ fur data texture
AS = cv2.resize(A, (S, S), interpolation=cv2.INTER_LINEAR)
base = cv2.imread(CFG['albedoSrc']) if CFG.get('albedoSrc') else None
if base is None:
    # embedded base colour texture of the body material
    mat = J['materials'][prim['material']]
    ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    img = J['images'][J['textures'][ti]['source']]; v = J['bufferViews'][img['bufferView']]
    base = cv2.imdecode(np.frombuffer(BIN[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']], np.uint8), cv2.IMREAD_COLOR)
base = cv2.resize(base, (S, S), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
bl_ = base[..., ::-1]  # RGB
lum = bl_ @ np.array([0.299, 0.587, 0.114])
red = bl_[..., 0] - np.maximum(bl_[..., 1], bl_[..., 2])
mask = AS[..., 3].copy()
mask *= np.clip((lum - CFG.get('maskMinLum', 0.12)) / 0.06, 0, 1)
mask *= np.clip((CFG.get('maskMaxRed', 0.25) - red) / 0.05, 0, 1)
for x0, y0, x1, y1 in CFG.get('noFurRects', []):
    mask[int(y0 * S):int(y1 * S), int(x0 * S):int(x1 * S)] = 0
mask = cv2.GaussianBlur(mask, (0, 0), 1.5 * S / 1024)
dens = np.clip(0.5 + strand * 0.22, 0, 1)
wet = np.clip(AS[..., 2], 0, 1)
for x0, y0, x1, y1 in CFG.get('wetRects', []):
    wet[int(y0 * S):int(y1 * S), int(x0 * S):int(x1 * S)] = 1
wet *= np.clip(1 - mask * 2, 0, 1)
wet = cv2.GaussianBlur(wet, (0, 0), 1.0 * S / 1024)
cv2.imwrite(out_prefix + '_fur.jpg', np.dstack([wet * 255, mask * 255, dens * 255]).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, CFG.get('furQ', 90)])

# ------------------------------------------------------------------ albedo: low-frequency colour layout, recoloured, × strand detail
lowc = cv2.GaussianBlur(bl_, (0, 0), CFG.get('lowSigma', 5) * S / 1024)
pal = CFG.get('palette')
out = lowc.copy()
if pal:
    lin = lambda c: (np.array(c, np.float32) / 255) ** 2.2
    cream, tan, saddle, dark = lin(pal['cream']), lin(pal['tan']), lin(pal['saddle']), lin(pal['dark'])
    L = lowc ** 2.2
    l = L @ np.array([0.2126, 0.7152, 0.0722])
    sat = (L.max(2) - L.min(2)) / np.maximum(1e-4, L.max(2))
    t = np.clip((sat - pal.get('satLo', 0.12)) / (pal.get('satHi', 0.6) - pal.get('satLo', 0.12)), 0, 1)   # 0 = white areas, 1 = orange areas
    t = t * t * (3 - 2 * t)
    dk = np.clip((pal.get('darkLum', 0.25) - l) / pal.get('darkLum', 0.25), 0, 1)                            # darker orange → saddle
    col = cream[None, None] * (1 - t[..., None]) + tan[None, None] * t[..., None]
    col = col * (1 - dk[..., None] * t[..., None]) + saddle[None, None] * (dk * t)[..., None]
    # keep the painted shading variation (relative luminance inside each region)
    ref = np.maximum(1e-4, (col @ np.array([0.2126, 0.7152, 0.0722])))
    shade = np.clip(l / np.maximum(1e-4, cv2.GaussianBlur(l, (0, 0), 30 * S / 1024)), 0.7, 1.3)
    col = col * shade[..., None] ** 0.5
    dm = np.clip(AS[..., 4] * pal.get('darkAmt', 0.0), 0, 1)
    col = col * (1 - dm[..., None]) + dark[None, None] * dm[..., None]
    if dc:
        # blotches from a real dirt photo (CC0 Poly Haven), tiled over the atlas
        ds = cv2.imread(dc['src'], cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
        rep = dc.get('repeat', 3)
        ds = cv2.resize(ds, (S // rep + 1, S // rep + 1))
        ds = np.tile(ds, (rep + 1, rep + 1))[:S, :S]
        ds = (ds - ds.mean()) / (ds.std() + 1e-6)
        dw = np.clip(AS[..., 5] * dc.get('amount', 0.5) * (0.75 + 0.35 * ds), 0, 0.9)
        dcol = lin(dc.get('color', [118, 104, 88]))
        col = col * (1 - dw[..., None]) + (dcol[None, None] * (0.85 + 0.15 * ds[..., None])) * dw[..., None]
    out = np.clip(col, 0, 1) ** (1 / 2.2)
# recolour regions (e.g. the near-black inner ear → pink-brown skin with light hair)
for rc in CFG.get('recolor', []):
    x0, y0, x1, y1 = rc['rect']; tc = np.array(rc['color'], np.float32) / 255
    sl_ = (slice(int(y0 * S), int(y1 * S)), slice(int(x0 * S), int(x1 * S)))
    l0 = (bl_[sl_] @ np.array([0.299, 0.587, 0.114]))
    k = np.clip((rc.get('belowLum', 0.3) - l0) / 0.15, 0, 1)[..., None] * rc.get('amount', 0.85)
    out[sl_] = out[sl_] * (1 - k) + tc * (0.7 + 0.6 * l0[..., None]) * k
    bl_[sl_] = bl_[sl_] * (1 - k) + tc * (0.7 + 0.6 * l0[..., None]) * k
detail = np.exp(strand * CFG.get('detailAmt', 0.16))
out = out * detail[..., None]
# keep the original texture (eyes, nose, teeth, tongue, pads) where there is no fur
keep = np.clip(1 - mask * 1.4, 0, 1)
keep = np.maximum(keep, 0)
out = out * (1 - keep[..., None]) + bl_ * keep[..., None]
cv2.imwrite(out_prefix + '_albedo.jpg', np.clip(out[..., ::-1] * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, CFG.get('jpegQ', 88)])
print('wrote', out_prefix)
