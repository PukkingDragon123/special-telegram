"""ศาลพระภูมิ — Thai spirit house on its pillar, dressed like the references (references/ghosts/web/spirithouse_*):
red & gold house with a cruciform two-tier roof, chofa finials, naga bargeboards and a spire; balustraded deck with steps;
marigold + jasmine garlands; three-colour cloth around the pillar; red Fanta bottles with straws, incense pot, vases,
figurines (elephants, dancer)."""
import bpy, bmesh, math, random
from mathutils import Vector
import common as C
from registry import model

PI = math.pi


def gable(name, half_w, length, z0, rise, thick, mat, overhang=0.03):
    """gable roof prism (ridge along local Y), two sloping slabs with thickness; base eave line at z0"""
    bm = bmesh.new()
    L = length / 2 + overhang
    pts = [(-half_w, z0), (0, z0 + rise), (half_w, z0)]
    vs = []
    for x, z in pts:
        vs.append((bm.verts.new((x, -L, z)), bm.verts.new((x, L, z))))
    for i in range(2):
        a, b = vs[i], vs[i + 1]
        bm.faces.new([a[0], b[0], b[1], a[1]])
    bm.normal_update()
    o = C.mesh_obj(name, bm, mat)
    for p in o.data.polygons:
        if p.normal.z < 0: p.flip()
    C.solidify(o, thick, -1)
    C.bevel(o, 0.004, 1, 30)
    C.apply_mods(o); C.smooth(o, 30); C.uv_box(o)
    return o


def tri_panel(name, half_w, z0, rise, y, mat, inset=0.012):
    bm = bmesh.new()
    a = bm.verts.new((-half_w + inset, y, z0 + 0.004)); b = bm.verts.new((half_w - inset, y, z0 + 0.004)); c = bm.verts.new((0, y, z0 + rise - inset * 1.5))
    bm.faces.new([a, b, c])
    o = C.mesh_obj(name, bm, mat)
    C.solidify(o, 0.008, 0); C.bevel(o, 0.002, 1, 30); C.apply_mods(o); C.uv_box(o)
    return o


def flower(bm_list, p, r, rnd, mat_index):
    bm_list.append((Vector(p), r, rnd.uniform(0, 2 * PI), mat_index))


def flowers_mesh(name, items, mats):
    """many small marigold / jasmine blooms in one mesh (displaced low icospheres)"""
    bm = bmesh.new()
    for p, r, rot, mi in items:
        geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        vs = geom['verts']
        for v in vs:
            d = v.co.normalized()
            n = 1 + 0.22 * math.sin(7 * d.x + rot) * math.cos(5 * d.y + rot * 1.3)
            v.co = Vector((v.co.x * n, v.co.y * n, v.co.z * n * 0.8)) + p
        fs = {f for v in vs for f in v.link_faces}
        for f in fs: f.material_index = mi
    bm.normal_update()
    o = C.mesh_obj(name, bm)
    for m in mats: o.data.materials.append(m)
    C.smooth(o, 80); C.uv_box(o, 4)
    return o


def catenary(a, b, sag, n):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in [i / (n - 1) for i in range(n)]]


@model('spirit_house', cat='spirit', title='Spirit house on its pillar (ศาลพระภูมิ) with garlands & offerings',
       tags=['spirit house', 'shrine', 'san phra phum', 'garland', 'marigold', 'offering', 'thai', 'hero'],
       phys='static', mass=0, bake=2048, low=19000, tex=1024, tris=20000, far=1.6, ray=0.025, yaw=25, pitch=8)
def spirit_house():
    rnd = random.Random(42)
    gold = C.pbr('gold', tex='brass_gold', tile=0.12, metal=1.0, rough_mul=0.8, w=dict(dirt=0.55, grime=0.25, streak=0.25, dirt_col=(0.12, 0.08, 0.03), seed=3))
    red = C.pbr('red_lacquer', tex='wood_painted_weathered', tile=0.35, tint=(1.0, 0.18, 0.12), metal=0.0, rough_mul=0.8,
                w=dict(dirt=0.5, grime=0.3, streak=0.3, wear=0.3, wear_col=(0.6, 0.45, 0.3), dirt_col=(0.12, 0.06, 0.03), seed=4))
    white = C.pbr('pillar_white', tex='plaster_painted_dirty', tile=0.6, tint=(1.05, 1.0, 0.92), metal=0.0,
                  w=dict(dirt=0.5, grime=0.35, streak=0.45, dirt_col=(0.16, 0.13, 0.09), seed=5))
    tiles = C.pbr('roof_tiles', tex='roof_clay_tiles', tile=0.22, tint=(1.1, 0.5, 0.35), metal=0.0, w=dict(dirt=0.45, grime=0.3, streak=0.3, seed=6))
    tiles_g = C.pbr('roof_tiles_green', tex='roof_clay_tiles', tile=0.22, tint=(0.35, 0.75, 0.45), metal=0.0, w=dict(dirt=0.45, grime=0.3, streak=0.3, seed=7))
    floor = C.pbr('plinth', tex='tiles_floor_terracotta', tile=0.3, metal=0.0, w=dict(dirt=0.5, grime=0.4, seed=8))
    dark = C.flat('dark', (0.05, 0.03, 0.025), rough=0.8)
    mari = C.flat('marigold', (0.95, 0.42, 0.02), rough=0.75, noise=0.25)
    mari2 = C.flat('marigold_y', (0.98, 0.68, 0.05), rough=0.75, noise=0.25)
    jas = C.flat('jasmine', (0.92, 0.9, 0.82), rough=0.7, noise=0.2)
    rose = C.flat('rose', (0.7, 0.04, 0.08), rough=0.6, noise=0.2)
    cloth = [C.pbr(f'cloth{i}', tex='cotton_jersey', tile=0.15, tint=c, metal=0.0, w=dict(dirt=0.35, grime=0.25, seed=i))
             for i, c in enumerate([(1.0, 0.35, 0.6), (0.3, 0.85, 0.5), (1.0, 0.85, 0.2)])]
    P = []
    # ---- plinth + pillar + corbel
    P.append(C.rbox('plinth', 0.44, 0.44, 0.12, (0, 0, 0), floor, bev=0.01))
    P.append(C.rbox('pillar', 0.2, 0.2, 1.14, (0, 0, 0.12), white, bev=0.012, segs=2))
    for z in (0.14, 1.18):
        P.append(C.rbox('band', 0.215, 0.215, 0.035, (0, 0, z), gold, bev=0.006))
    cor = C.lathe('corbel', [(0.152, 1.26), (0.16, 1.26), (0.2, 1.3), (0.31, 1.325), (0.31, 1.335), (1e-5, 1.335)], 4, gold)
    cor.rotation_euler = (0, 0, PI / 4); C.apply_xform(cor); C.uv_box(cor); P.append(cor)
    # ---- deck, balustrade, steps
    D = 0.62
    P.append(C.rbox('deck', D, D, 0.05, (0, 0, 1.335), red, bev=0.008))
    P.append(C.rbox('deck_edge', D + 0.016, D + 0.016, 0.014, (0, 0, 1.36), gold, bev=0.004))
    zt = 1.385
    for side in range(4):
        a = side * PI / 2
        for k in range(7):
            t = -0.27 + k * 0.09
            if side == 0 and abs(t) < 0.1: continue   # open front (-Y)
            x, y = t, -0.29
            c, s = math.cos(a), math.sin(a)
            P.append(C.rbox('post', 0.018, 0.018, 0.085, (x * c - y * s, x * s + y * c, zt), gold if k in (0, 6) else red, bev=0.004))
        # rail
        for seg in ([(-0.29, -0.29), (-0.1, -0.29)], [(0.1, -0.29), (0.29, -0.29)]) if side == 0 else ([(-0.29, -0.29), (0.29, -0.29)],):
            (x0, y0), (x1, y1) = seg
            c, s = math.cos(a), math.sin(a)
            P.append(C.tube('rail', [(x0 * c - y0 * s, x0 * s + y0 * c, zt + 0.088), (x1 * c - y1 * s, x1 * s + y1 * c, zt + 0.088)], 0.007, gold))
    for k in range(3):
        P.append(C.rbox('step', 0.16, 0.05, 0.016 * (k + 1), (0, -0.215 + k * 0.04, zt), red, bev=0.004))
    # ---- house body
    Z0 = zt + 0.05
    P.append(C.rbox('hfloor', 0.36, 0.36, 0.05, (0, 0, zt), gold, bev=0.006))
    P.append(C.rbox('walls', 0.3, 0.3, 0.27, (0, 0, Z0), red, bev=0.006))
    for x, y in ((-0.155, -0.155), (0.155, -0.155), (0.155, 0.155), (-0.155, 0.155), (-0.07, -0.158), (0.07, -0.158)):
        P.append(C.rbox('col', 0.03, 0.03, 0.29, (x, y, Z0), gold, bev=0.006))
        P.append(C.rbox('cap', 0.044, 0.044, 0.02, (x, y, Z0 + 0.275), gold, bev=0.005))
    # doorway (dark, arched gold frame) + side windows
    door = C.rbox('door', 0.1, 0.012, 0.17, (0, -0.151, Z0 + 0.01), dark, bev=0.003)
    P.append(door)
    P.append(C.bent_tube('doorframe', [(-0.055, -0.158, Z0 + 0.01), (-0.055, -0.158, Z0 + 0.17), (0, -0.158, Z0 + 0.205), (0.055, -0.158, Z0 + 0.17), (0.055, -0.158, Z0 + 0.01)], 0.008, 0.03, gold))
    for sx in (-1, 1):
        P.append(C.rbox('win', 0.012, 0.09, 0.1, (sx * 0.151, 0, Z0 + 0.1), dark, bev=0.002))
        P.append(C.rbox('winf', 0.016, 0.11, 0.014, (sx * 0.153, 0, Z0 + 0.085), gold, bev=0.003))
        P.append(C.rbox('winf2', 0.016, 0.11, 0.014, (sx * 0.153, 0, Z0 + 0.2), gold, bev=0.003))
    # ---- cruciform two-tier roof
    ZE = Z0 + 0.3
    tiers = [(0.27, 0.6, ZE, 0.15, tiles), (0.19, 0.42, ZE + 0.1, 0.24, tiles_g)]
    for half_w, length, z0, rise, mat in tiers:
        for rot in (0, PI / 2):
            g = gable('roof', half_w, length, z0, rise, 0.014, mat)
            g.rotation_euler = (0, 0, rot); C.apply_xform(g); P.append(g)
            for sgn in (-1, 1):
                L = length / 2 + 0.03
                pn = tri_panel('gpanel', half_w, z0, rise, sgn * (L - 0.012), gold)
                pn.rotation_euler = (0, 0, rot); C.apply_xform(pn); P.append(pn)
                # naga bargeboards with upturned tails (hang hong) + chofa at the apex
                for sx in (-1, 1):
                    pts = [(0, sgn * (L + 0.004), z0 + rise + 0.01), (sx * half_w * 0.5, sgn * (L + 0.004), z0 + rise * 0.5 + 0.012),
                           (sx * half_w, sgn * (L + 0.004), z0 + 0.006), (sx * (half_w + 0.02), sgn * (L + 0.004), z0 + 0.03), (sx * (half_w + 0.02), sgn * (L + 0.004), z0 + 0.055)]
                    bt = C.bent_tube('barge', pts, 0.008, 0.03, gold)
                    bt.rotation_euler = (0, 0, rot); C.apply_xform(bt); P.append(bt)
                cf = C.bent_tube('chofa', [(0, sgn * L, z0 + rise), (0, sgn * (L + 0.02), z0 + rise + 0.05), (0, sgn * (L + 0.05), z0 + rise + 0.09), (0, sgn * (L + 0.07), z0 + rise + 0.075)], 0.008, 0.02, gold)
                cf.rotation_euler = (0, 0, rot); C.apply_xform(cf); P.append(cf)
    # spire (stacked tapering tiers, octagonal) on the crossing
    zs = ZE + 0.1 + 0.24 - 0.02
    prof = [(1e-5, zs), (0.06, zs), (0.06, zs + 0.03)]
    r, z = 0.055, zs + 0.03
    for k in range(5):
        prof += [(r, z), (r * 0.8, z + 0.035), (r * 0.86, z + 0.04)]
        r *= 0.78; z += 0.04
    prof += [(0.008, z + 0.01), (0.006, z + 0.12), (1e-5, z + 0.14)]
    sp = C.lathe('spire', prof, 8, gold); C.smooth(sp, 30); C.uv_box(sp); P.append(sp)
    # ---- garlands
    items = []
    def strand(pts, r, mi, step=None):
        step = step or r * 1.7
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            n = max(1, int((b - a).length / step))
            for k in range(n):
                q = a.lerp(b, k / n) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * r * 0.25
                flower(items, q, r * rnd.uniform(0.85, 1.1), rnd, mi)
    # big marigold garlands draped over the front gable of the upper tier, hanging down past the eaves
    hw, z0, rise = 0.19, ZE + 0.1, 0.24
    yF = -(0.42 / 2 + 0.03) - 0.025
    for sx in (-1, 1):
        pts = [Vector((0, yF, z0 + rise + 0.03)), Vector((sx * hw * 0.5, yF, z0 + rise * 0.5 + 0.03)), Vector((sx * (hw + 0.03), yF - 0.01, z0 + 0.0)),
               Vector((sx * (hw + 0.05), yF - 0.02, z0 - 0.12)), Vector((sx * (hw + 0.05), yF - 0.02, z0 - 0.3))]
        strand(pts, 0.019, sx > 0 and 0 or 1)
        # jasmine tassel at the end with a red rose
        tp = pts[-1]
        strand([tp, tp + Vector((0, 0, -0.1))], 0.009, 2)
        flower(items, tp + Vector((0, 0, -0.115)), 0.016, rnd, 3)
    # swags along the deck front + corners hanging
    for sx in (-1, 1):
        a = Vector((sx * 0.3, -0.3, zt + 0.09)); b = Vector((sx * 0.1, -0.3, zt + 0.09))
        strand(catenary(a, b, 0.07, 8), 0.016, 0 if sx < 0 else 1)
    for x, y in ((-0.31, -0.31), (0.31, -0.31), (0.31, 0.31), (-0.31, 0.31)):
        top = Vector((x, y, zt + 0.07))
        strand([top, top + Vector((0, 0, -0.14))], 0.015, rnd.choice([0, 1]))
        strand([top + Vector((0, 0, -0.14)), top + Vector((0, 0, -0.24))], 0.008, 2)
        flower(items, top + Vector((0, 0, -0.255)), 0.014, rnd, 3)
    # offering garlands laid on the deck + around the pillar top
    for k in range(18):
        a = 2 * PI * k / 18
        flower(items, Vector((math.cos(a) * 0.135, math.sin(a) * 0.135, 1.19)), 0.017, rnd, k % 2)
    P.append(flowers_mesh('flowers', items, [mari, mari2, jas, rose]))
    # ---- three-colour cloth tied around the pillar, tails hanging
    for i, m in enumerate(cloth):
        z = 1.08 - i * 0.035
        ring = C.lathe('cloth', [(0.132 + 0.004 * i, z), (0.138 + 0.004 * i, z + 0.012), (0.132 + 0.004 * i, z + 0.034)], 4, m)
        ring.rotation_euler = (0, 0, PI / 4); C.apply_xform(ring); C.uv_box(ring, 6); P.append(ring)
        tail = C.plane_grid('tail', 0.05, 0.36, 2, 8, m)
        for v in tail.data.vertices:
            t = (v.co.y + 0.18) / 0.36
            v.co = Vector((v.co.x + 0.02 * math.sin(t * 5 + i), -0.112 - 0.02 * t - 0.01 * i, z - (0.18 - v.co.y) + 0.02))
        tail.location = (0.03 * (i - 1), 0, 0); C.apply_xform(tail)
        C.solidify(tail, 0.003, 0); C.apply_mods(tail); C.smooth(tail, 60); C.uv_box(tail, 6); P.append(tail)
    # ---- offerings on the deck: red Fanta bottles with straws, incense pot, vases, figurines
    fanta = C.flat('fanta', (0.75, 0.05, 0.05), rough=0.08)
    cap = C.flat('fcap', (0.1, 0.3, 0.8), rough=0.4)
    straw = C.flat('straw', (0.95, 0.95, 0.9), rough=0.4)
    for x in (-0.24, 0.24):
        b = C.lathe('fanta', [(1e-5, 0.0), (0.024, 0.0), (0.026, 0.004), (0.026, 0.08), (0.016, 0.1), (0.01, 0.115), (0.01, 0.125), (1e-5, 0.125)], 14, fanta)
        b.location = (x, -0.235, zt); C.apply_xform(b); C.uv_box(b); P.append(b)
        P.append(C.tube('straw', [(x, -0.235, zt + 0.1), (x + 0.008, -0.24, zt + 0.17), (x + 0.025, -0.25, zt + 0.19)], 0.0025, straw))
        P.append(C.cyl('fcap', 0.011, 0.012, (x + 0.04, -0.27, zt), mat=cap, segs=10, bev=0.002))
    brass = C.pbr('brass', tex='brass_gold', tile=0.08, metal=1.0, rough_mul=1.0, tint=(0.8, 0.7, 0.55), w=dict(dirt=0.7, grime=0.4, seed=9))
    pot = C.lathe('pot', [(1e-5, 0.0), (0.03, 0.0), (0.033, 0.01), (0.045, 0.03), (0.05, 0.055), (0.047, 0.06), (0.04, 0.05), (1e-5, 0.05)], 18, brass)
    pot.location = (0, -0.2, zt); C.apply_xform(pot); C.uv_box(pot); P.append(pot)
    stick = C.flat('incense', (0.55, 0.12, 0.08), rough=0.8)
    for k in range(7):
        a = rnd.uniform(0, 2 * PI); r = rnd.uniform(0, 0.03)
        p0 = Vector((math.cos(a) * r, -0.2 + math.sin(a) * r, zt + 0.05))
        P.append(C.tube('stick', [tuple(p0), tuple(p0 + Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), rnd.uniform(0.1, 0.16))))], 0.0018, stick))
    for x in (-0.12, 0.12):
        v = C.lathe('vase', [(1e-5, 0.0), (0.014, 0.0), (0.02, 0.02), (0.02, 0.05), (0.011, 0.07), (0.009, 0.09), (0.016, 0.1), (0.014, 0.102), (1e-5, 0.1)], 14, brass)
        v.location = (x, -0.26, zt); C.apply_xform(v); C.uv_box(v); P.append(v)
    ceramic = C.flat('ceramic', (0.85, 0.82, 0.75), rough=0.25, w=dict(dirt=0.6, grime=0.3))
    for x in (-0.205, 0.205):   # elephants facing out
        e = []
        body = C.lathe('eb', [(1e-5, 0.0), (0.016, 0.003), (0.02, 0.015), (0.016, 0.027), (1e-5, 0.03)], 12, ceramic)
        body.rotation_euler = (0, PI / 2, 0); body.location = (0, 0, 0.03); C.apply_xform(body); e.append(body)
        e.append(C.cyl('head', 0.012, 0.022, (0.02, 0, 0.045), rot=(0, PI / 2, 0), mat=ceramic, segs=10))
        e.append(C.tube('trunk', [(0.038, 0, 0.045), (0.045, 0, 0.03), (0.046, 0, 0.012)], 0.004, ceramic))
        for lx, ly in ((-0.012, -0.008), (-0.012, 0.008), (0.012, -0.008), (0.012, 0.008)):
            e.append(C.cyl('leg', 0.0045, 0.03, (lx, ly, 0), mat=ceramic, segs=8))
        el = C.join(e, 'elephant'); el.rotation_euler = (0, 0, PI / 2 if x < 0 else -PI / 2); el.location = (x, -0.16, zt); C.apply_xform(el); P.append(el)
    dancer = C.lathe('dancer', [(1e-5, 0.0), (0.016, 0.0), (0.012, 0.03), (0.007, 0.05), (0.009, 0.058), (0.004, 0.064), (0.007, 0.07), (0.006, 0.078), (0.002, 0.09), (1e-5, 0.1)], 10, gold)
    dancer.location = (0, -0.15, zt + 0.05); C.apply_xform(dancer); C.uv_box(dancer); P.append(dancer)
    return P
