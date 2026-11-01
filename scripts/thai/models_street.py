"""Doorstep & sidewalk Thai things for the clutter pass (src/modules/world/clutter.ts):
รองเท้าแตะ rubber flip-flops left at the door, a coiled garden hose with its brass tap nozzle, the aluminium
ราวตากผ้า folding drying rack with a towel, a T-shirt and a pha khao ma (checked cloth) hanging on it.
Blender axes: Z up, front faces -Y (exported Y-up, +Z forward)."""
import bpy, bmesh, math, random
from mathutils import Vector
import common as C
from registry import model

PI = math.pi


def _sole(name, mat, L=0.255, W=0.092, T=0.016, mirror=False):
    """flip-flop sole: foot outline (toe wide, waist narrow, heel round), thick EVA/rubber slab"""
    pts = []
    N = 28
    for i in range(N):
        a = 2 * PI * i / N
        y = -math.cos(a) * L / 2                         # -Y = toe
        t = (y + L / 2) / L                              # 0 toe .. 1 heel
        w = W * (0.5 + 0.06 * math.cos(t * PI * 2.2) - 0.08 * math.sin(t * PI) ** 4) * (0.92 if t > 0.7 else 1.0)
        x = math.sin(a) * w + (0.012 * (1 - t) * (-1 if mirror else 1))   # big-toe side bulge
        pts.append((x, y))
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, 0)) for x, y in pts]
    vt = [bm.verts.new((x, y, T)) for x, y in pts]
    bm.faces.new(vb[::-1]); bm.faces.new(vt)
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    o = C.mesh_obj(name, bm, mat)
    C.bevel(o, 0.004, 2, 40); C.apply_mods(o); C.smooth(o, 45); C.uv_box(o)
    return o


def _strap(name, mat, mirror=False, T=0.016):
    s = -1 if mirror else 1
    post = (0.006 * s, -0.075, T)                         # toe post between big & second toe
    pts_l = [post, (0.012 * s, -0.06, T + 0.022), (0.03, -0.02, T + 0.03), (0.045, 0.012, T + 0.012), (0.047, 0.02, T)]
    pts_r = [post, (0.004 * s, -0.06, T + 0.022), (-0.025, -0.02, T + 0.03), (-0.04, 0.012, T + 0.012), (-0.042, 0.02, T)]
    a = C.tube(name + 'L', pts_l, 0.0055, mat, res=6, segs=3)
    b = C.tube(name + 'R', pts_r, 0.0055, mat, res=6, segs=3)
    for o in (a, b):
        o.scale = (1, 1, 0.55); C.apply_xform(o)
    return [a, b]


@model('sandals_pair', cat='household', title='Rubber flip-flops left at the door (รองเท้าแตะ)', tags=['sandals', 'flip-flops', 'shoes', 'doorstep', 'rubber', 'thai', 'household'],
       phys='dynamic', mass=0.3, friction=0.9, bake=512, low=None, tex=512, tris=900, far=0.45, collider='box', yaw=30)
def sandals_pair():
    sole_w = C.flat('sole_w', (0.78, 0.8, 0.78), rough=0.75, noise=0.12, w=dict(dirt=0.85, grime=0.6, wear=0.2, dirt_col=(0.22, 0.18, 0.13), seed=21))
    sole_b = C.flat('sole_b', (0.12, 0.24, 0.55), rough=0.7, noise=0.1, w=dict(dirt=0.6, grime=0.4, dirt_col=(0.2, 0.17, 0.12), seed=22))
    strap = C.flat('strap', (0.1, 0.22, 0.62), rough=0.55, noise=0.1, w=dict(dirt=0.4, grime=0.3, seed=23))
    out = []
    rnd = random.Random(4)
    for k, (dx, dy, yaw, mir) in enumerate(((-0.06, 0.0, 0.12, False), (0.065, 0.03, -0.2, True))):
        lo = _sole('soleA%d' % k, sole_b, T=0.006, mirror=mir)
        hi = _sole('soleB%d' % k, sole_w, T=0.011, mirror=mir)
        C.xf(hi, (0, 0, 0.006))
        parts = [lo, hi] + _strap('strap%d' % k, strap, mir, T=0.017)
        o = C.join(parts, 'sandal%d' % k)
        C.xf(o, (dx, dy, 0), (0, 0, yaw))
        out.append(o)
    return out


@model('hose_coil', cat='household', title='Coiled garden hose with brass nozzle (สายยาง)', tags=['hose', 'garden hose', 'rubber', 'coil', 'water', 'sidewalk', 'thai'],
       phys='dynamic', mass=2.2, friction=0.9, bake=1024, low=1800, tex=512, tris=2400, far=0.6, collider='cyl', yaw=20)
def hose_coil():
    rub = C.pbr('hose', files={'albedo': 'props/rubber_hose_orange_tile.jpg', 'normal': 'props/rubber_hose_tile_n.jpg', 'rough': 'props/rubber_hose_tile_r.jpg'},
                tile=0.08, tint=(0.35, 0.95, 0.45), metal=0.0, w=dict(dirt=0.65, grime=0.45, streak=0.2, dirt_col=(0.2, 0.16, 0.1), seed=31))
    brass = C.pbr('brass', tex='brass_gold', tile=0.05, metal=1.0, rough_mul=1.3, w=dict(dirt=0.7, grime=0.6, seed=32))
    rnd = random.Random(7)
    r_h = 0.0095
    pts = []
    turns, R0 = 5.2, 0.2
    n = int(turns * 30)
    for i in range(n + 1):
        t = i / n
        a = t * turns * 2 * PI
        R = R0 + 0.035 * math.sin(a * 0.5 + 1.0) + 0.02 * rnd.uniform(-1, 1) * 0.3
        layer = (i // 30) % 3
        z = r_h + layer * r_h * 1.6 + 0.004 * math.sin(a * 3)
        pts.append((R * math.cos(a), R * math.sin(a) * 0.92, z))
    # loose tail running off toward the front with the nozzle
    ex, ey, ez = pts[-1]
    tail = [(ex + 0.05, ey - 0.06, r_h), (ex + 0.02, ey - 0.2, r_h), (ex - 0.08, ey - 0.3, r_h)]
    coil = C.tube('coil', pts + tail, r_h, rub, res=8, segs=2)
    tx, ty, tz = tail[-1]
    noz = C.cyl('nozzle', 0.012, 0.07, (tx, ty, tz), (PI / 2, 0, 0.6), brass, segs=12, r2=0.008)
    ring = C.cyl('clamp', 0.0125, 0.012, (tail[-2][0] - 0.01, tail[-2][1] - 0.02, tz), (PI / 2, 0, 0.6), brass, segs=12)
    return [coil, noz, ring]


@model('laundry_rack', cat='household', title='Aluminium drying rack with laundry (ราวตากผ้า)', tags=['laundry', 'drying rack', 'clothes', 'towel', 'pha khao ma', 'balcony', 'sidewalk', 'thai', 'household'],
       phys='static', mass=0, bake=1024, low=2600, tex=1024, tris=3200, far=1.0, yaw=25)
def laundry_rack():
    alu = C.pbr('alu', tex='aluminium_scratched', tile=0.3, metal=1.0, rough_mul=0.9, w=dict(dirt=0.5, grime=0.4, seed=41))
    foot = C.flat('foot', (0.05, 0.05, 0.05), rough=0.7)
    towel = C.pbr('towel', tex='cotton_jersey', tile=0.25, tint=(0.95, 0.45, 0.55), metal=0.0, w=dict(dirt=0.25, grime=0.2, seed=42))
    shirt = C.pbr('shirt', tex='cotton_jersey', tile=0.25, tint=(0.35, 0.55, 0.9), metal=0.0, w=dict(dirt=0.2, grime=0.2, seed=43))
    jeans = C.pbr('jeans', tex='denim', tile=0.3, metal=0.0, w=dict(dirt=0.25, grime=0.2, seed=44))
    W, H, D = 1.3, 1.12, 0.56
    parts = []
    # two A-frame ends (square aluminium tube, rounded), rails between them
    for sx in (-W / 2, W / 2):
        parts.append(C.bent_tube('endA', [(sx, -D / 2, 0.0), (sx, -0.05, H), (sx, 0.05, H), (sx, D / 2, 0.0)], 0.011, bend=0.05, mat=alu, sides=8))
        parts.append(C.tube('brace', [(sx, -D / 2 + 0.14, 0.36), (sx, D / 2 - 0.14, 0.36)], 0.006, alu, res=6, segs=1))
        for sy in (-D / 2, D / 2):
            parts.append(C.cyl('foot', 0.016, 0.03, (sx, sy, 0), mat=foot, segs=10))
    rails = []
    for k, f in enumerate((0.28, 0.62, 1.0)):
        for s in (-1, 1):
            y = s * (0.05 + (D / 2 - 0.05) * (1 - f)); z = H * f
            if f == 1.0 and s == 1: continue
            rails.append((y, z))
            parts.append(C.tube('rail', [(-W / 2 - 0.02, y, z), (W / 2 + 0.02, y, z)], 0.0065, alu, res=6, segs=1))

    def cloth(name, mat, x0, x1, y, z, drop, sag=0.02, back=0.0, nx=10, ny=8):
        """a cloth draped over a rail: hangs down both sides of the rail (front + back), gently waved"""
        bm = bmesh.new()
        rows = []
        for j in range(ny * 2 + 1):
            t = j / (ny * 2)                               # 0 front bottom .. 0.5 over the rail .. 1 back bottom
            side = -1 if t < 0.5 else 1
            hh = abs(t - 0.5) * 2                          # 0 at rail .. 1 at hem
            d = drop if side < 0 else drop * (1 - back)
            row = []
            for i in range(nx + 1):
                u = i / nx
                x = x0 + (x1 - x0) * u
                zz = z - hh * d - sag * math.sin(u * PI) * hh + 0.012 * math.sin(u * 9 + j) * hh
                yy = y + side * (0.008 + 0.03 * hh * hh) + 0.012 * math.sin(u * 7 + 2) * hh
                row.append(bm.verts.new((x, yy, max(0.02, zz))))
            rows.append(row)
        for j in range(len(rows) - 1):
            for i in range(nx):
                bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
        o = C.mesh_obj(name, bm, mat)
        C.solidify(o, 0.004, 0); C.apply_mods(o); C.smooth(o, 60); C.uv_box(o)
        return o

    parts.append(cloth('towel', towel, -0.55, -0.05, rails[-1][0], rails[-1][1], 0.42, back=0.3))
    parts.append(cloth('shirt', shirt, 0.02, 0.5, rails[3][0], rails[3][1], 0.36, back=0.1, sag=0.05))
    parts.append(cloth('jeans', jeans, -0.3, 0.12, rails[0][0], rails[0][1], 0.22, back=0.0))
    # pha khao ma: checked cotton cloth, procedural check pattern
    pk = C.flat('phakhaoma', (0.75, 0.2, 0.18), rough=0.85, noise=0.05, w=dict(dirt=0.25, grime=0.2, seed=45))
    nt = pk.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    chk = nt.nodes.new('ShaderNodeTexChecker'); chk.inputs['Scale'].default_value = 26
    chk.inputs['Color1'].default_value = (0.7, 0.12, 0.12, 1); chk.inputs['Color2'].default_value = (0.95, 0.85, 0.7, 1)
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    nt.links.new(uvn.outputs['UV'], chk.inputs['Vector'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 0.85
    src = bsdf.inputs['Base Color'].links[0].from_socket
    nt.links.new(src, mx.inputs['A']); nt.links.new(chk.outputs['Color'], mx.inputs['B'])
    nt.links.new(mx.outputs['Result'], bsdf.inputs['Base Color'])
    parts.append(cloth('phakhaoma', pk, 0.15, 0.6, rails[1][0], rails[1][1], 0.3, back=0.05, sag=0.03))
    return parts
