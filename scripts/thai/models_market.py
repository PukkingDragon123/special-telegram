"""Market & household Thai things: กระด้ง woven bamboo tray, ตะกร้า perforated plastic basket, 15 kg rice sack,
โอ่ง glazed water jar with its aluminium bowl, ขันน้ำ aluminium dipper bowl."""
import bpy, bmesh, math, random
from mathutils import Vector
import common as C
from registry import model

PI = math.pi
PP = {'albedo': 'props/plastic_pp_blue.jpg', 'normal': 'props/plastic_pp_n.jpg', 'rough': 'props/plastic_pp_r.jpg'}


# ============================================================ กระด้ง
@model('kradong', cat='market', title='Woven bamboo winnowing tray (กระด้ง)', tags=['tray', 'bamboo', 'woven', 'market', 'drying', 'thai', 'kradong'],
       phys='dynamic', mass=0.9, friction=0.8, bake=1024, low=1400, tex=1024, tris=1800, far=0.8, collider='cyl')
def kradong():
    weave = C.pbr('weave', tex='bamboo_woven', tile=0.9, metal=0.0, w=dict(dirt=0.45, grime=0.35, streak=0.2, dirt_col=(0.14, 0.1, 0.05), seed=2))
    rimm = C.pbr('rim', tex='bamboo_poles', tile=0.5, metal=0.0, w=dict(dirt=0.5, grime=0.3, dirt_col=(0.14, 0.1, 0.05), seed=3))
    rattan = C.pbr('rattan', tex='bamboo_poles', tile=0.15, tint=(0.75, 0.55, 0.35), metal=0.0, w=dict(dirt=0.6, grime=0.3, seed=4))
    R = 0.34
    # shallow dish (woven), slightly uneven
    prof = [(1e-5, 0.012), (0.1, 0.01), (0.2, 0.012), (0.28, 0.02), (R - 0.01, 0.034)]
    disc = C.lathe('disc', [(r, z) for r, z in prof], 48, weave)
    C.solidify(disc, 0.003, -1); C.apply_mods(disc)
    rnd = random.Random(5)
    for v in disc.data.vertices: v.co.z += 0.004 * math.sin(3 * math.atan2(v.co.y, v.co.x) + 1) * (math.hypot(v.co.x, v.co.y) / R)
    C.smooth(disc, 60); C.uv_box(disc)
    # rim: two split-bamboo hoops (inner + outer) + rattan lashing spiral
    parts = [disc]
    for rr, zz in ((R + 0.004, 0.036), (R - 0.016, 0.036)):
        hoop = C.lathe('hoop', [(rr - 0.008, zz - 0.012), (rr + 0.008, zz - 0.012), (rr + 0.009, zz + 0.006), (rr - 0.009, zz + 0.006)], 64, rimm)
        C.smooth(hoop, 40); C.uv_cyl(hoop); parts.append(hoop)
    pts = []
    turns = 70
    for k in range(turns * 8 + 1):
        a = 2 * PI * k / 8 / turns * 1.0
        t = 2 * PI * k / 8
        pts.append(((R - 0.006 + 0.019 * math.cos(t)) * math.cos(a), (R - 0.006 + 0.019 * math.cos(t)) * math.sin(a), 0.033 + 0.014 * math.sin(t)))
    # lash in short bundles (every few cm), not one continuous coil
    for k in range(0, len(pts) - 24, 40):
        parts.append(C.tube('lash', pts[k:k + 24], 0.0022, rattan, segs=1))
    return parts


# ============================================================ ตะกร้า perforated plastic basket
@model('plastic_basket', cat='market', title='Perforated plastic market basket (ตะกร้า)', tags=['basket', 'plastic', 'market', 'produce', 'crate', 'thai', 'blue'],
       phys='dynamic', mass=0.6, friction=0.55, tint=True, alpha=True, bake=1024, low=1600, tex=1024, tris=2000, far=0.7, collider='box')
def plastic_basket():
    W, D, H = 0.46, 0.33, 0.19
    solid = C.pbr('pp', files=PP, tile=0.25, metal=0.0, nstr=0.6, w=dict(dirt=0.5, grime=0.3, streak=0.2, dirt_col=(0.12, 0.1, 0.08), seed=3))
    perf = C.pbr('pp_perf', files=PP, tile=0.25, metal=0.0, nstr=0.6, w=dict(dirt=0.5, grime=0.3, streak=0.2, dirt_col=(0.12, 0.1, 0.08), seed=3))
    # perforation: rounded-rect holes on a grid (structure, not art) → alpha
    nt = perf.node_tree; L = nt.links.new
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(uv.outputs['UV'], sep.inputs['Vector'])
    def hole_axis(sock, period, frac):
        d = nt.nodes.new('ShaderNodeMath'); d.operation = 'DIVIDE'; d.inputs[1].default_value = period; L(sock, d.inputs[0])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'FRACT'; L(d.outputs[0], f.inputs[0])
        s = nt.nodes.new('ShaderNodeMath'); s.operation = 'SUBTRACT'; s.inputs[1].default_value = 0.5; L(f.outputs[0], s.inputs[0])
        a = nt.nodes.new('ShaderNodeMath'); a.operation = 'ABSOLUTE'; L(s.outputs[0], a.inputs[0])
        lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = frac / 2; L(a.outputs[0], lt.inputs[0])
        return lt.outputs[0]
    hx = hole_axis(sep.outputs['X'], 0.018, 0.62)
    hy = hole_axis(sep.outputs['Y'], 0.013, 0.55)
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; L(hx, mul.inputs[0]); L(hy, mul.inputs[1])
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1; L(mul.outputs[0], inv.inputs[1])
    L(inv.outputs[0], bsdf.inputs['Alpha'])
    # open box, tapered, rounded corners, with a rolled rim and handle slots
    bm = bmesh.new()
    def rr(w, d, r, z, n=6):
        pts = []
        for cx, cy, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, PI / 2), (-w / 2 + r, -d / 2 + r, PI), (w / 2 - r, -d / 2 + r, 1.5 * PI)):
            for k in range(n + 1):
                a = a0 + PI / 2 * k / n
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
        return pts
    rings = [rr(W - 0.05, D - 0.05, 0.03, 0.0), rr(W - 0.03, D - 0.03, 0.035, 0.015), rr(W - 0.012, D - 0.012, 0.04, H - 0.03), rr(W, D, 0.045, H - 0.012), rr(W, D, 0.045, H)]
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vs[0])
    for i in range(len(vs) - 1):
        for k in range(n): bm.faces.new([vs[i][k], vs[i][(k + 1) % n], vs[i + 1][(k + 1) % n], vs[i + 1][k]])
    bm.faces.new(vs[0][::-1])
    bm.normal_update()
    o = C.mesh_obj('basket', bm, solid)
    o.data.materials.append(perf)
    C.solidify(o, 0.003, -1); C.apply_mods(o)
    # subdivide the walls so the bake has a clean layout; mark perforated wall band
    C.uv_box(o)
    for p in o.data.polygons:
        z = p.center.z
        p.material_index = 1 if (0.03 < z < H - 0.035 and abs(p.normal.z) < 0.5) else 0
    # handle slots (boolean) + rolled rim
    for sx in (-1, 1):
        ct = C.rbox('slot', 0.06, 0.1, 0.025, (sx * W / 2, 0, H - 0.055), bev=0.012, segs=3)
        m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = ct; m.solver = 'EXACT'
        C.apply_mods(o); bpy.data.objects.remove(ct)
    C.bevel(o, 0.0015, 1, 50, harden=False); C.apply_mods(o); C.smooth(o, 45)
    ring = rr(W + 0.006, D + 0.006, 0.048, H - 0.004)
    path = [Vector(p) for p in ring] + [Vector(ring[0])]
    rim = C.tube('rim', [tuple(p) for p in path], 0.005, solid, segs=1)
    return [o, rim]


# ============================================================ rice sack 15 kg
@model('rice_sack', cat='market', title='Rice sack 15 kg, woven PP (กระสอบข้าว)', tags=['sack', 'rice', 'woven', 'bag', 'market', 'thai', 'heavy'],
       phys='dynamic', mass=15, friction=0.9, bake=1024, low=1500, tex=1024, tris=2000, far=0.8, collider='box')
def rice_sack():
    sack = C.pbr('woven', files={'albedo': 'props/pp_woven_sack_white_tile.jpg', 'normal': 'props/pp_woven_sack_tile_n.jpg'}, tile=0.12, rough=0.75, metal=0.0, nstr=1.2,
                 w=dict(dirt=0.6, grime=0.4, streak=0.2, dirt_col=(0.15, 0.12, 0.08), seed=4))
    prt = C.label_mat('print', 'img/labels/rice_15kg_sack_surin.png', rough=0.75, w=dict(dirt=0.5, grime=0.4, dirt_col=(0.15, 0.12, 0.08), seed=4))
    W, Lg, T = 0.5, 0.74, 0.17
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * W, v.co.y * Lg, v.co.z * T + T / 2))
    o = C.mesh_obj('sack', bm, sack)
    C.subsurf(o, 3); C.apply_mods(o)
    rnd = random.Random(9)
    # pillow: squash corners, bulge the middle, sag, lumps; sewn end thinner
    for v in o.data.vertices:
        x, y, z = v.co
        u, w_ = x / (W / 2), y / (Lg / 2)
        zc = z - T / 2
        bul = (1 - u * u) ** 0.6 * (1 - w_ * w_) ** 0.5
        z2 = T / 2 + zc * (0.35 + 0.75 * bul)
        if zc < 0: z2 = max(0.0, T / 2 + zc * (0.2 + 0.9 * bul)) * 0.55
        v.co = Vector((x * (1 + 0.05 * bul), y, z2))
    C.displace_noise(o, 0.012, 0.18, 3)
    for v in o.data.vertices: v.co.z = max(0.0, v.co.z)
    C.smooth(o, 70); C.uv_box(o)
    o.data.materials.append(prt)
    uvl = o.data.uv_layers['UVMap']
    for p in o.data.polygons:
        c = p.center
        if p.normal.z > 0.55 and abs(c.x) < W * 0.42 and abs(c.y) < Lg * 0.4:
            p.material_index = 1
            for li in p.loop_indices:
                v = o.data.vertices[o.data.loops[li].vertex_index].co
                uvl.data[li].uv = (0.5 + v.x / (W * 0.84), 0.5 + v.y / (Lg * 0.8))
    # sewn seam (thread) at one end
    seam = C.tube('seam', [(-W / 2 + 0.02, Lg / 2 - 0.025, 0.06), (W / 2 - 0.02, Lg / 2 - 0.025, 0.06)], 0.004, C.flat('thread', (0.85, 0.82, 0.7), rough=0.9))
    return [o, seam]


# ============================================================ โอ่ง glazed water jar + aluminium bowl lid
@model('ong_jar', cat='household', title='Glazed water jar (โอ่ง) with aluminium bowl', tags=['jar', 'water', 'ong', 'ceramic', 'glazed', 'thai', 'household'],
       phys='static', mass=0, bake=1024, low=2200, tex=1024, tris=2600, far=1.0, yaw=30)
def ong_jar():
    glaze = C.flat('glaze', (0.16, 0.075, 0.03), rough=0.22, noise=0.18, w=dict(dirt=0.5, grime=0.3, streak=0.55, wear=0.25, wear_col=(0.55, 0.4, 0.25), dirt_col=(0.2, 0.17, 0.12), seed=5))
    clay = C.pbr('clay', tex='tiles_floor_terracotta', tile=0.5, metal=0.0, w=dict(dirt=0.5, grime=0.3, seed=6))
    alu = C.pbr('alu', tex='aluminium_scratched', tile=0.3, metal=1.0, rough_mul=0.9, w=dict(dirt=0.5, grime=0.3, seed=7))
    water = C.flat('water', (0.08, 0.1, 0.09), rough=0.03)
    # big bellied jar ~70 cm tall, wide mouth with a rolled lip
    prof = [(1e-5, 0.0), (0.17, 0.0), (0.2, 0.02), (0.27, 0.12), (0.31, 0.26), (0.315, 0.36), (0.29, 0.5), (0.24, 0.6), (0.2, 0.65), (0.205, 0.672), (0.222, 0.69),
            (0.226, 0.705), (0.212, 0.715), (0.19, 0.705), (0.188, 0.69)]
    jar = C.lathe('jar', prof, 48, glaze)
    for v in jar.data.vertices:   # hand-thrown irregularity
        a = math.atan2(v.co.y, v.co.x)
        s = 1 + 0.008 * math.sin(3 * a + v.co.z * 7) + 0.004 * math.sin(7 * a)
        v.co.x *= s; v.co.y *= s
    C.smooth(jar, 40); C.uv_cyl(jar)
    jar.data.materials.append(clay)
    for p in jar.data.polygons:
        if p.center.z < 0.05: p.material_index = 1      # unglazed foot
    # inner wall + water surface
    inner = C.lathe('inner', [(0.188, 0.69), (0.19, 0.6), (0.24, 0.5), (1e-5, 0.48)], 32, glaze)
    C.smooth(inner, 40); C.uv_cyl(inner)
    wtr = C.cyl('water', 0.205, 0.004, (0, 0, 0.58), mat=water, segs=32, bev=0)
    # aluminium bowl (ขัน) floating / resting on the rim
    bowl = C.lathe('bowl', [(1e-5, 0.0), (0.05, 0.0), (0.085, 0.03), (0.11, 0.07), (0.115, 0.075), (0.112, 0.078), (0.105, 0.072), (0.08, 0.035), (0.047, 0.006), (1e-5, 0.006)], 32, alu)
    bowl.rotation_euler = (0.25, 0.1, 0); bowl.location = (0.06, -0.05, 0.66); C.apply_xform(bowl); C.smooth(bowl, 40); C.uv_box(bowl)
    return [jar, inner, wtr, bowl]


# ============================================================ ขันน้ำ dipper bowl
@model('khan_bowl', cat='household', title='Aluminium water dipper bowl (ขันน้ำ)', tags=['bowl', 'dipper', 'aluminium', 'water', 'thai', 'household'],
       phys='dynamic', mass=0.15, friction=0.4, bake=512, low=None, tex=512, tris=800, far=0.45)
def khan_bowl():
    alu = C.pbr('alu', tex='aluminium_scratched', tile=0.25, metal=1.0, rough_mul=0.8, w=dict(dirt=0.45, grime=0.3, seed=8))
    b = C.lathe('bowl', [(1e-5, 0.0), (0.045, 0.0), (0.075, 0.028), (0.095, 0.062), (0.1, 0.07), (0.097, 0.073), (0.09, 0.066), (0.07, 0.032), (0.042, 0.005), (1e-5, 0.005)], 32, alu)
    # embossed rings
    C.smooth(b, 40); C.uv_box(b)
    return [b]
