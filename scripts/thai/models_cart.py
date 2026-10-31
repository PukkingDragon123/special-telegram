"""Street-food kit: รถเข็น food cart (glass display case, bicycle wheels, LPG under, vinyl banner), พัดไล่แมลงวัน fly-fan
(separate `spin` node), moulded plastic street table, ตู้กับข้าว aluminium food cabinet (glass + perforated doors, legs in
ant-moat bowls, crockery inside)."""
import bpy, bmesh, math, random
from mathutils import Vector
import common as C
from registry import model

PI = math.pi
SS = {'albedo': 'props/stainless_brushed_dented.jpg', 'normal': 'props/stainless_brushed_dented_n.jpg', 'rough': 'props/stainless_brushed_dented_r.jpg'}
SSG = {'albedo': 'props/stainless_grimy.jpg', 'normal': 'props/stainless_brushed_dented_n.jpg', 'rough': 'props/stainless_grimy_r.jpg'}


def steel(name, grimy=False, tile=0.5, seed=2):
    return C.pbr(name, files=SSG if grimy else SS, tile=tile, metal=1.0, rough_mul=0.9, nstr=0.7,
                 w=dict(dirt=0.5, grime=0.25, streak=0.3, dirt_col=(0.1, 0.08, 0.05), seed=seed))


def quad_img(name, mat, w, h, center, normal='-Y', inset=0.0):
    """textured quad (UV 0..1) facing -Y (default) or +X/-X, centred at `center` (x, y, z_bottom)"""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    x, y, z = center
    if normal == '-Y': pts = [(x - w / 2, y, z), (x + w / 2, y, z), (x + w / 2, y, z + h), (x - w / 2, y, z + h)]
    elif normal == '+Y': pts = [(x + w / 2, y, z), (x - w / 2, y, z), (x - w / 2, y, z + h), (x + w / 2, y, z + h)]
    elif normal == '-X': pts = [(x, y + w / 2, z), (x, y - w / 2, z), (x, y - w / 2, z + h), (x, y + w / 2, z + h)]
    else: pts = [(x, y - w / 2, z), (x, y + w / 2, z), (x, y + w / 2, z + h), (x, y - w / 2, z + h)]
    vs = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(vs)
    for l, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): l[uvl].uv = uv
    o = C.mesh_obj(name, bm, mat)
    return o


# ============================================================ รถเข็น food cart
@model('rot_khen_cart', cat='furniture', title='Street food cart (รถเข็นขายอาหาร) with glass display case', tags=['cart', 'food cart', 'street-food', 'stall', 'glass case', 'thai', 'hero'],
       phys='static', bake=2048, low=16000, tex=1024, tris=19000, far=1.6, yaw=150, pitch=12, ray=0.02)
def rot_khen_cart():
    W, D = 1.5, 0.8
    cab = steel('cabinet', grimy=True, tile=0.7, seed=3)
    top = steel('counter', tile=0.6, seed=4)
    alu = C.pbr('alu', tex='aluminium_scratched', tile=0.4, metal=1.0, rough_mul=0.8, w=dict(dirt=0.6, grime=0.35, dirt_col=(0.1, 0.08, 0.05), seed=5))
    glass = C.glass_mat('glass', alpha=0.2)
    rub = C.pbr('rubber', tex='rubber_black', tile=0.3, w=dict(dirt=0.3, grime=0.2))
    banner = C.label_mat('banner', 'img/signs/banner_tamsang_paksaep_vinyl.png', rough=0.55, w=dict(dirt=0.45, grime=0.35, streak=0.4, dirt_col=(0.14, 0.1, 0.06), seed=6))
    header = C.label_mat('header', 'img/signs/menu_chicken_rice_photo_strip.png', rough=0.4, w=dict(dirt=0.35, grime=0.3, streak=0.3, seed=7))
    paint = C.pbr('trim', tex='metal_painted_chipped', tile=0.5, tint=(1.0, 0.25, 0.15), metal=0.0, w=dict(dirt=0.5, grime=0.3, wear=0.35, seed=8))
    lpg = C.pbr('lpg', files={'albedo': 'props/lpg_paint_blue_tile.jpg', 'normal': 'props/lpg_paint_tile_n.jpg'}, tile=0.5, metal=0.0, w=dict(dirt=0.5, grime=0.4, streak=0.3, seed=9))
    iron = C.pbr('iron', tex='cast_iron_wok', tile=0.3, metal=0.8, w=dict(dirt=0.6, grime=0.5, seed=10))
    hose = C.pbr('hose', files={'albedo': 'props/rubber_hose_orange_tile.jpg', 'normal': 'props/rubber_hose_tile_n.jpg'}, tile=0.1, metal=0.0)
    P = []
    # ---- cabinet body (sheet steel box, door outline, hinges, handle) + counter + backsplash
    P.append(C.rbox('body', W, D, 0.42, (0, 0, 0.55), cab, bev=0.02, segs=2))
    P.append(C.rbox('door', 0.62, 0.006, 0.32, (0.35, -D / 2 - 0.002, 0.6), cab, bev=0.004))
    for z in (0.64, 0.86):
        P.append(C.cyl('hinge', 0.007, 0.04, (0.66, -D / 2 - 0.006, z), mat=top, segs=8, bev=0.002))
    P.append(C.bent_tube('dhandle', [(0.06, -D / 2 - 0.004, 0.72), (0.06, -D / 2 - 0.03, 0.73), (0.06, -D / 2 - 0.03, 0.81), (0.06, -D / 2 - 0.004, 0.82)], 0.006, 0.01, top))
    P.append(C.rbox('counter', W + 0.08, D + 0.06, 0.025, (0, 0, 0.97), top, bev=0.008))
    # ---- display case: aluminium posts & rails, glass panes, mid shelf, roof, coloured header with menu strip
    gx, gy = W / 2 - 0.02, D / 2 - 0.02
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(C.rbox('post', 0.022, 0.022, 0.53, (sx * gx, sy * gy, 0.995), alu, bev=0.003))
    for z in (1.0, 1.25, 1.51):
        for sy in (-1, 1): P.append(C.rbox('rail', W - 0.03, 0.018, 0.018, (0, sy * gy, z), alu, bev=0.003))
        for sx in (-1, 1): P.append(C.rbox('rail2', 0.018, D - 0.03, 0.018, (sx * gx, 0, z), alu, bev=0.003))
    P.append(C.rbox('shelf', W - 0.08, D - 0.08, 0.008, (0, 0, 1.255), glass, bev=0))
    for sy in (-1, 1): P.append(quad_img('pane', glass, W - 0.05, 0.5, (0, sy * gy, 1.008), '-Y' if sy < 0 else '+Y'))
    for sx in (-1, 1): P.append(quad_img('pane', glass, D - 0.05, 0.5, (sx * gx, 0, 1.008), '-X' if sx < 0 else '+X'))
    P.append(C.rbox('roof', W + 0.06, D + 0.04, 0.02, (0, 0, 1.53), top, bev=0.006))
    P.append(C.rbox('hdr', W + 0.07, D + 0.05, 0.12, (0, 0, 1.55), paint, bev=0.01))
    P.append(quad_img('hdr_img', header, W - 0.06, 0.1, (0, -(D + 0.05) / 2 - 0.003, 1.56)))
    # ---- vinyl banner tied across the front of the cabinet (grommets + cable ties)
    bw, bh = 1.3, 0.36
    bn = C.plane_grid('banner', bw, bh, 8, 3, banner)
    for v in bn.data.vertices:
        u = v.co.x / bw
        v.co = Vector((v.co.x, -D / 2 - 0.012 - 0.008 * math.cos(u * PI) - 0.004 * math.sin(v.co.y * 20), 0.76 + v.co.y))
    me = bn.data
    uvl = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.x / bw + 0.5, (co.z - 0.76) / bh + 0.5)
        if p.normal.y > 0: p.flip()
    C.solidify(bn, 0.002, 0); C.apply_mods(bn); P.append(bn)
    for x in (-bw / 2 + 0.03, bw / 2 - 0.03):
        for z in (0.6, 0.92):
            P.append(C.cyl('tie', 0.006, 0.012, (x, -D / 2 - 0.02, z), rot=(PI / 2, 0, 0), mat=C.flat('tiewrap', (0.1, 0.1, 0.1), rough=0.5), segs=8, bev=0.001))
    # ---- running gear: bicycle wheels (tyre, rim, 16 spokes, hub) on an axle at x=-0.35, legs at +x, lower shelf
    Rw, xw = 0.3, -0.35
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.06)
        tyre = C.lathe('tyre', [(Rw - 0.022 + 0.022 * math.cos(t), 0.022 * math.sin(t)) for t in [PI / 2 + 2 * PI * k / 10 for k in range(11)]], 32, rub)
        tyre.rotation_euler = (PI / 2, 0, 0); tyre.location = (xw, y, Rw); C.apply_xform(tyre); C.uv_box(tyre); P.append(tyre)
        rim = C.lathe('rim', [(Rw - 0.05, -0.012), (Rw - 0.035, -0.014), (Rw - 0.035, 0.014), (Rw - 0.05, 0.012)][::-1], 32, top)
        rim.rotation_euler = (PI / 2, 0, 0); rim.location = (xw, y, Rw); C.apply_xform(rim); C.uv_box(rim); P.append(rim)
        P.append(C.cyl('hub', 0.025, 0.07, (xw, y + 0.035, Rw), rot=(PI / 2, 0, 0), mat=top, segs=12, bev=0.004))
        for k in range(16):
            a = 2 * PI * k / 16
            side = 0.025 if k % 2 else -0.025
            P.append(C.tube('spoke', [(xw, y + side, Rw), (xw + math.cos(a) * (Rw - 0.045), y, Rw + math.sin(a) * (Rw - 0.045))], 0.0018, top, res=4))
    P.append(C.tube('axle', [(xw, -D / 2 - 0.1, Rw), (xw, D / 2 + 0.1, Rw)], 0.012, cab))
    for sy in (-1, 1):
        P.append(C.tube('stay', [(xw, sy * (D / 2 + 0.02), Rw), (xw - 0.12, sy * (D / 2 - 0.02), 0.56)], 0.011, cab))
        P.append(C.tube('leg', [(W / 2 - 0.08, sy * (D / 2 - 0.06), 0.56), (W / 2 - 0.06, sy * (D / 2 - 0.05), 0.02)], 0.015, cab))
        P.append(C.cyl('foot', 0.02, 0.025, (W / 2 - 0.06, sy * (D / 2 - 0.05), 0.0), mat=rub, segs=10, bev=0.004))
    P.append(C.rbox('lshelf', W - 0.5, D - 0.12, 0.012, (0.2, 0, 0.12), cab, bev=0.003))
    # ---- LPG tank on the lower shelf + orange hose up to the burner, burner ring with pan supports on the counter
    tank = C.lathe('tank', [(1e-5, 0.0), (0.12, 0.0), (0.13, 0.02), (0.135, 0.06), (0.135, 0.3), (0.11, 0.35), (0.06, 0.375), (0.025, 0.38), (0.025, 0.4), (1e-5, 0.4)], 20, lpg)
    tank.location = (0.35, 0.05, 0.132); C.apply_xform(tank); C.uv_cyl(tank); P.append(tank)
    P.append(C.tube('hose', [(0.35, 0.05, 0.535), (0.42, 0.0, 0.6), (0.55, -0.15, 0.62), (0.62, -0.25, 0.75), (0.6, -0.2, 0.97)], 0.007, hose))
    br = C.lathe('burner', [(0.05, 0.0), (0.16, 0.0), (0.17, 0.03), (0.16, 0.06), (0.15, 0.06), (0.14, 0.02), (0.06, 0.02), (0.05, 0.05), (0.04, 0.05), (0.04, 0.0)][::-1], 24, iron)
    br.location = (0.45, 0.05, 0.995); C.apply_xform(br); C.uv_box(br); P.append(br)
    # ---- push handle with rubber grips, umbrella holder clamp
    P.append(C.bent_tube('handle', [(-W / 2, -D / 2 + 0.05, 0.9), (-W / 2 - 0.3, -D / 2 + 0.05, 0.95), (-W / 2 - 0.3, D / 2 - 0.05, 0.95), (-W / 2, D / 2 - 0.05, 0.9)], 0.016, 0.06, top))
    for y in (-0.2, 0.2):
        P.append(C.cyl('grip', 0.021, 0.14, (-W / 2 - 0.3, y - 0.07, 0.95), rot=(-PI / 2, 0, 0), mat=rub, segs=12, bev=0.005))
    P.append(C.tube('umb', [(W / 2 + 0.04, D / 2 - 0.05, 0.55), (W / 2 + 0.04, D / 2 - 0.05, 1.05)], 0.018, cab))
    return P


# ============================================================ fly-fan
@model('fly_fan', cat='tableware', title='Fly-shooing fan (พัดไล่แมลงวัน), spinner node "spin"', tags=['fly fan', 'fan', 'flies', 'food', 'market', 'stall', 'thai', 'animated'],
       phys='dynamic', mass=0.35, friction=0.6, bake=512, low=None, tex=512, tris=1500, far=0.5, parts=True, yaw=25, pitch=20)
def fly_fan():
    body = C.pbr('fan_body', tex='plastic_rough', tile=0.2, tint=(0.95, 0.95, 0.92), metal=0.0, rough=0.4, w=dict(dirt=0.6, grime=0.4, streak=0.2, dirt_col=(0.2, 0.17, 0.12), seed=3))
    accent = C.flat('fan_accent', (0.15, 0.45, 0.85), rough=0.35, w=dict(dirt=0.4, grime=0.3))
    blade = C.flat('fan_blade', (0.92, 0.35, 0.6), rough=0.25, noise=0.15)
    base = C.lathe('base', [(1e-5, 0.0), (0.05, 0.0), (0.052, 0.004), (0.05, 0.02), (0.044, 0.09), (0.038, 0.105), (0.03, 0.11), (1e-5, 0.112)], 24, body)
    C.smooth(base, 40); C.uv_box(base, 4)
    ring = C.lathe('ring', [(0.0505, 0.03), (0.053, 0.032), (0.053, 0.045), (0.0495, 0.047)], 24, accent); C.uv_box(ring, 4)
    sw = C.rbox('switch', 0.018, 0.01, 0.012, (0, -0.048, 0.06), accent, bev=0.003)
    for o in (base, ring, sw): o['part'] = 'base'
    hub = C.cyl('hub', 0.012, 0.02, (0, 0, 0.112), mat=accent, segs=12, bev=0.003)
    sp = [hub]
    for k in range(3):
        a = 2 * PI * k / 3
        bl = C.plane_grid('blade', 0.26, 0.022, 10, 1, blade)
        for v in bl.data.vertices:
            t = (v.co.x + 0.13) / 0.26
            v.co = Vector((0.012 + t * 0.25, v.co.y + 0.004 * math.sin(t * 6), 0.125 - 0.05 * t * t))
        C.solidify(bl, 0.0012, 0); C.apply_mods(bl)
        bl.rotation_euler = (0.25, 0, a); C.apply_xform(bl); C.uv_box(bl)
        sp.append(bl)
    for o in sp: o['part'] = 'spin'
    return [base, ring, sw] + sp


# ============================================================ moulded plastic street table
@model('thai_table_plastic', cat='furniture', title='Moulded plastic street table (โต๊ะพลาสติก)', tags=['table', 'plastic', 'street-food', 'thai', 'blue'],
       phys='dynamic', mass=3.5, friction=0.6, tint=True, bake=1024, low=2400, tex=512, tris=3000, collider='box', yaw=30, pitch=22)
def thai_table_plastic():
    W, D, H = 0.8, 0.62, 0.66
    pp = C.pbr('pp', files={'albedo': 'props/plastic_pp_blue.jpg', 'normal': 'props/plastic_pp_n.jpg', 'rough': 'props/plastic_pp_r.jpg'}, tile=0.25, metal=0.0, nstr=0.6,
               w=dict(dirt=0.55, grime=0.3, streak=0.25, wear=0.2, dirt_col=(0.12, 0.1, 0.08), seed=4))
    P = []
    # top: an upside-down tray (moulded skirt) with rounded corners
    bm = bmesh.new()
    def rr(w, d, r, z, n=5):
        pts = []
        for cx, cy, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, PI / 2), (-w / 2 + r, -d / 2 + r, PI), (w / 2 - r, -d / 2 + r, 1.5 * PI)):
            for k in range(n + 1):
                a = a0 + PI / 2 * k / n
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
        return pts
    rings = [rr(W - 0.004, D - 0.004, 0.05, H - 0.045), rr(W, D, 0.052, H - 0.035), rr(W, D, 0.052, H - 0.006), rr(W - 0.01, D - 0.01, 0.047, H)]
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(vs[0])
    for i in range(len(vs) - 1):
        for k in range(n): bm.faces.new([vs[i][k], vs[i][(k + 1) % n], vs[i + 1][(k + 1) % n], vs[i + 1][k]])
    bm.faces.new(vs[-1])
    bm.normal_update()
    t = C.mesh_obj('top', bm, pp); C.solidify(t, 0.004, -1); C.apply_mods(t); C.smooth(t, 40); C.uv_box(t)
    P.append(t)
    # ribs under the top
    for x in (-0.2, 0.0, 0.2):
        P.append(C.rbox('ribx', 0.008, D - 0.06, 0.03, (x, 0, H - 0.04), pp, bev=0.002))
    for y in (-0.15, 0.15):
        P.append(C.rbox('riby', W - 0.06, 0.008, 0.03, (0, y, H - 0.04), pp, bev=0.002))
    # legs in corner sockets: tapered square tubes with flared feet
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.07), sy * (D / 2 - 0.07)
            P.append(C.rbox('socket', 0.06, 0.06, 0.04, (x, y, H - 0.075), pp, bev=0.008))
            leg = C.lathe('leg', [(0.024, H - 0.075), (0.021, 0.04), (0.027, 0.012), (0.028, 0.0), (1e-5, 0.0)][::-1], 4, pp)
            leg.rotation_euler = (0, 0, PI / 4); leg.location = (x, y, 0); C.apply_xform(leg); C.smooth(leg, 30); C.uv_box(leg)
            P.append(leg)
    return P


# ============================================================ ตู้กับข้าว
@model('tu_kap_khao', cat='household', title='Aluminium food cabinet (ตู้กับข้าว) with glass + perforated doors, legs in ant-moat bowls',
       tags=['cabinet', 'food cabinet', 'kitchen', 'aluminium', 'glass', 'thai', 'household', 'shophouse'],
       phys='static', bake=1024, low=5500, tex=1024, tris=7000, far=1.2, alpha=True, yaw=25, pitch=8)
def tu_kap_khao():
    W, D = 0.8, 0.42
    z0, H = 0.24, 1.2            # cabinet bottom, cabinet height
    alu = C.pbr('alu', tex='aluminium_scratched', tile=0.5, metal=1.0, rough_mul=0.85, w=dict(dirt=0.6, grime=0.4, streak=0.35, dirt_col=(0.12, 0.1, 0.07), seed=3))
    perf = C.pbr('perf', tex='aluminium_scratched', tile=0.5, metal=1.0, rough_mul=0.85, w=dict(dirt=0.6, grime=0.4, streak=0.35, dirt_col=(0.12, 0.1, 0.07), seed=3))
    nt = perf.node_tree; L = nt.links.new
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(uv.outputs['UV'], sep.inputs['Vector'])
    def axis(sock, period):
        d = nt.nodes.new('ShaderNodeMath'); d.operation = 'DIVIDE'; d.inputs[1].default_value = period; L(sock, d.inputs[0])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'FRACT'; L(d.outputs[0], f.inputs[0])
        s = nt.nodes.new('ShaderNodeMath'); s.operation = 'SUBTRACT'; s.inputs[1].default_value = 0.5; L(f.outputs[0], s.inputs[0])
        m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; L(s.outputs[0], m.inputs[0]); L(s.outputs[0], m.inputs[1])
        return m.outputs[0]
    ax, ay = axis(sep.outputs['X'], 0.008), axis(sep.outputs['Y'], 0.008)
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'; L(ax, add.inputs[0]); L(ay, add.inputs[1])
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.09; L(add.outputs[0], gt.inputs[0])
    L(gt.outputs[0], bsdf.inputs['Alpha'])
    glass = C.glass_mat('glass', alpha=0.18)
    P = []
    # frame: corner posts that run down as legs, top/bottom/mid rails
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(C.rbox('post', 0.025, 0.025, z0 + H, (sx * (W / 2 - 0.0125), sy * (D / 2 - 0.0125), 0), alu, bev=0.003))
    for z in (z0, z0 + 0.55, z0 + H - 0.025):
        for sy in (-1, 1): P.append(C.rbox('railx', W, 0.025, 0.025, (0, sy * (D / 2 - 0.0125), z), alu, bev=0.003))
        for sx in (-1, 1): P.append(C.rbox('raily', 0.025, D, 0.025, (sx * (W / 2 - 0.0125), 0, z), alu, bev=0.003))
    P.append(C.rbox('topp', W + 0.02, D + 0.02, 0.012, (0, 0, z0 + H), alu, bev=0.004))
    P.append(C.rbox('botp', W - 0.02, D - 0.02, 0.01, (0, 0, z0 + 0.005), alu, bev=0.002))
    P.append(C.rbox('midp', W - 0.02, D - 0.02, 0.01, (0, 0, z0 + 0.555), alu, bev=0.002))
    P.append(C.rbox('shelf', W - 0.04, D - 0.04, 0.006, (0, 0, z0 + 0.88), glass, bev=0))
    P.append(C.rbox('back', W - 0.02, 0.006, H - 0.02, (0, D / 2 - 0.008, z0 + 0.01), alu, bev=0.001))
    # lower: two perforated doors with knobs; sides perforated
    for sx in (-1, 1):
        P.append(C.rbox('door', W / 2 - 0.03, 0.008, 0.5, (sx * (W / 4 - 0.005), -D / 2 + 0.002, z0 + 0.03), perf, bev=0.002))
        P.append(C.rbox('dframe', W / 2 - 0.03, 0.014, 0.02, (sx * (W / 4 - 0.005), -D / 2, z0 + 0.03), alu, bev=0.002))
        P.append(C.rbox('dframe2', W / 2 - 0.03, 0.014, 0.02, (sx * (W / 4 - 0.005), -D / 2, z0 + 0.51), alu, bev=0.002))
        P.append(C.cyl('knob', 0.009, 0.018, (sx * 0.04, -D / 2 - 0.004, z0 + 0.3), rot=(PI / 2, 0, 0), mat=C.flat('knob', (0.6, 0.15, 0.1), rough=0.4), segs=10, bev=0.003))
        P.append(C.rbox('side', 0.006, D - 0.04, 0.5, (sx * (W / 2 - 0.004), 0, z0 + 0.03), perf, bev=0.001))
    # upper: two sliding glass doors in aluminium frames (+ glass sides)
    for k, (x, y) in enumerate(((-W / 4 + 0.01, -D / 2 + 0.004), (W / 4 - 0.01, -D / 2 + 0.016))):
        P.append(C.rbox('gpane', W / 2 - 0.02, 0.004, H - 0.6, (x, y, z0 + 0.58), glass, bev=0))
        for z in (z0 + 0.58, z0 + H - 0.04):
            P.append(C.rbox('gframe', W / 2 - 0.02, 0.012, 0.016, (x, y, z), alu, bev=0.002))
        for sx in (-1, 1):
            P.append(C.rbox('gframe2', 0.016, 0.012, H - 0.6, (x + sx * (W / 4 - 0.018), y, z0 + 0.58), alu, bev=0.002))
    for sx in (-1, 1): P.append(C.rbox('gside', 0.004, D - 0.04, H - 0.6, (sx * (W / 2 - 0.004), 0, z0 + 0.58), glass, bev=0))
    # legs stand in enamel bowls of water (keeps ants off the food)
    enamel = C.flat('enamel', (0.85, 0.85, 0.8), rough=0.25, w=dict(dirt=0.6, grime=0.5, wear=0.4, wear_col=(0.1, 0.1, 0.12), seed=5))
    water = C.flat('water', (0.12, 0.13, 0.11), rough=0.05)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.0125), sy * (D / 2 - 0.0125)
            b = C.lathe('bowl', [(1e-5, 0.0), (0.04, 0.0), (0.06, 0.035), (0.062, 0.04), (0.058, 0.04), (0.038, 0.006), (1e-5, 0.006)], 20, enamel)
            b.location = (x, y, -0.0); C.apply_xform(b); C.uv_box(b); P.append(b)
            P.append(C.cyl('w', 0.05, 0.002, (x, y, 0.026), mat=water, segs=16, bev=0))
    # crockery: rooster bowls + plates stacks on the glass shelf and the middle shelf
    rooster = C.pbr('bowl_r', files={'albedo': 'props/bowl_rooster_side.jpg'}, tile=0.25, rough=0.2, metal=0.0, w=dict(dirt=0.3, grime=0.2))
    plate = C.flat('plate', (0.92, 0.92, 0.88), rough=0.2, w=dict(dirt=0.35, grime=0.25))
    for x in (-0.2, 0.05):
        for k in range(3):
            b = C.lathe('rbowl', [(1e-5, 0.0), (0.032, 0.0), (0.06, 0.05), (0.064, 0.055), (0.058, 0.055), (0.03, 0.006), (1e-5, 0.006)], 20, rooster)
            b.location = (x, 0.02, z0 + 0.89 + k * 0.022); C.apply_xform(b); C.uv_cyl(b); P.append(b)
    for k in range(6):
        p = C.lathe('plate', [(1e-5, 0.0), (0.06, 0.0), (0.1, 0.012), (0.105, 0.016), (0.098, 0.016), (0.058, 0.004), (1e-5, 0.004)], 22, plate)
        p.location = (0.22, 0.03, z0 + 0.565 + k * 0.013); C.apply_xform(p); C.uv_box(p); P.append(p)
    return P
