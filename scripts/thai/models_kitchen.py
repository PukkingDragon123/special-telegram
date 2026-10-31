"""Thai kitchen / table things: steel folding table, condiment caddy (พวงเครื่องปรุง 4 jars), tamarind chopping board
(เขียงมะขาม), 15 kg LPG cylinder, Thai brand bottles & cans (real label photos from public/assets/img/labels)."""
import bpy, bmesh, math, random
from mathutils import Vector
import common as C
from registry import model

PI = math.pi
SS = {'albedo': 'props/stainless_brushed_dented.jpg', 'normal': 'props/stainless_brushed_dented_n.jpg', 'rough': 'props/stainless_brushed_dented_r.jpg'}
SSG = {'albedo': 'props/stainless_grimy.jpg', 'normal': 'props/stainless_brushed_dented_n.jpg', 'rough': 'props/stainless_grimy_r.jpg'}


def steel(name='steel', grimy=False, tile=0.5, w=None):
    return C.pbr(name, files=SSG if grimy else SS, tile=tile, metal=1.0, rough_mul=0.9, nstr=0.7,
                 w=w or dict(dirt=0.45, grime=0.15, dirt_col=(0.1, 0.08, 0.06), seed=2.1))


def rubber(name='rubber'):
    return C.pbr(name, tex='rubber_black', tile=0.2, w=dict(dirt=0.2, grime=0.1))


def band_uv(o, z0, z1, arc, mat_index, front=-1):
    """label band: faces whose centre lies in z0..z1 get material `mat_index` and UVs: u over the front `arc` (radians,
    centred on -Y), clamped at the label edges behind; v = (z - z0) / (z1 - z0)."""
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv['UVMap']
    for f in bm.faces:
        c = f.calc_center_median()
        if not (z0 <= c.z <= z1) or abs(f.normal.z) > 0.6: continue
        f.material_index = mat_index
        ac = math.atan2(c.x, -c.y)
        for l in f.loops:
            p = l.vert.co
            a = math.atan2(p.x, -p.y)
            if abs(a - ac) > PI: a += 2 * PI if ac > 0 else -2 * PI
            u = min(0.995, max(0.005, 0.5 + a / arc))
            l[uvl].uv = (u, (p.z - z0) / (z1 - z0))
    bm.to_mesh(me); bm.free()


# ============================================================ steel folding table
@model('thai_table_steel', cat='furniture', title='Stainless folding street table (โต๊ะพับสแตนเลส)', tags=['table', 'stainless', 'folding', 'street-food', 'thai'],
       phys='dynamic', mass=7.5, friction=0.5, bake=1024, low=2400, tex=512, tris=3000, collider='box')
def thai_table_steel():
    W, D, H = 0.75, 0.60, 0.72
    st = steel('steel_top', tile=0.6)
    leg = steel('steel_leg', grimy=True, tile=0.4)
    blk = rubber()
    # pressed top: an upside-down tray (open bottom) with rounded rim
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * W, v.co.y * D, v.co.z * 0.034 + H - 0.017))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5], context='FACES')
    top = C.mesh_obj('top', bm, st)
    C.solidify(top, 0.0015, -1)
    C.bevel(top, 0.006, 3, 30)
    C.apply_mods(top); C.smooth(top, 35); C.uv_box(top)
    parts = [top]
    # under-frame: two square rails under the long edges + cross rails
    for y in (-D / 2 + 0.045, D / 2 - 0.045):
        parts.append(C.rbox('rail', W - 0.09, 0.02, 0.02, (0, y, H - 0.054), leg, bev=0.003))
    for x in (-W / 2 + 0.07, W / 2 - 0.07):
        parts.append(C.rbox('xr', 0.02, D - 0.09, 0.02, (x, 0, H - 0.054), leg, bev=0.003))
    # folding U legs (round tube) with a low brace, rubber feet, hinge plates and the folding strut
    for sx in (-1, 1):
        x0 = sx * (W / 2 - 0.085)
        x1 = sx * (W / 2 - 0.06)
        y0 = D / 2 - 0.07
        u = C.bent_tube('legU', [(x0, -y0, H - 0.04), (x1, -y0 - 0.012, 0.03), (x1, y0 + 0.012, 0.03), (x0, y0, H - 0.04)], 0.0115, 0.05, leg, sides=10)
        parts.append(u)
        parts.append(C.tube('brace', [(x1 - sx * 0.008, -y0, 0.14), (x1 - sx * 0.008, y0, 0.14)], 0.008, leg))
        for y in (-y0 - 0.012, y0 + 0.012):
            parts.append(C.cyl('foot', 0.016, 0.03, (x1, y, -0.002), mat=blk, segs=12, bev=0.004))
            parts.append(C.rbox('hinge', 0.045, 0.006, 0.05, (x0 + sx * 0.01, y + (0.014 if y < 0 else -0.014), H - 0.09), leg, bev=0.0015))
        # strut from the brace to the centre of the top (folding stay)
        parts.append(C.rbox('stay', 0.018, 0.004, math.hypot(abs(x1) - 0.12, H - 0.2) + 0.02, (0, 0, 0), leg, bev=0.001))
        s = parts[-1]
        ang = math.atan2(abs(x1) - 0.12, H - 0.2)
        s.rotation_euler = (0, -sx * ang, 0); s.location = (x1 - sx * 0.01, 0, 0.13); C.apply_xform(s)
    return parts


# ============================================================ condiment caddy (4 jars)
@model('condiment_caddy', cat='tableware', title='Condiment caddy, 4 jars (พวงเครื่องปรุง)', tags=['condiment', 'caddy', 'table', 'fish sauce', 'chili', 'sugar', 'vinegar', 'thai'],
       phys='dynamic', mass=1.4, friction=0.5, bake=1024, low=2800, tex=512, tris=3200, far=0.6, collider='box')
def condiment_caddy():
    st = steel('ss', tile=0.25, w=dict(dirt=0.6, grime=0.3, streak=0.2, dirt_col=(0.12, 0.08, 0.04), seed=4))
    glass = C.glass_mat('glass', color=(0.86, 0.9, 0.86), alpha=0.18)
    gravel = lambda nm, col, tile: C.pbr(nm, tex='gravel_crushed', tile=tile, tint=col, rough_mul=1.0, metal=0.0, nstr=1.4)
    fill = {
        'fish': C.flat('fish_sauce', (0.36, 0.17, 0.035), rough=0.05, w=dict(dirt=0.2, grime=0.0)),
        'vin': C.flat('vinegar', (0.62, 0.55, 0.28), rough=0.05, w=dict(dirt=0.2, grime=0.0)),
        'chili': gravel('chili_flakes', (1.0, 0.25, 0.1), 0.03),
        'sugar': gravel('sugar', (1.6, 1.55, 1.45), 0.02),
    }
    red = C.flat('chili_red', (0.6, 0.06, 0.03), rough=0.35)
    green = C.flat('chili_green', (0.2, 0.42, 0.06), rough=0.35)
    S = 0.168
    parts = []
    # base tray with raised rolled rim + 4 shallow jar seats
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * S, v.co.y * S, v.co.z * 0.016 + 0.008))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.5], context='FACES')
    tray = C.mesh_obj('tray', bm, st); C.solidify(tray, 0.0012, -1); C.bevel(tray, 0.005, 3, 30); C.apply_mods(tray); C.smooth(tray, 35); C.uv_box(tray)
    parts.append(tray)
    # central post + loop handle, mid-height wire frame holding the jars
    parts.append(C.tube('post', [(0, 0, 0.004), (0, 0, 0.165)], 0.0045, st))
    hl = [(0.035 * math.cos(a) * 0 + 0, 0.032 * math.cos(a), 0.165 + 0.04 * math.sin(a)) for a in [PI * k / 12 for k in range(13)]]
    parts.append(C.tube('handle', hl, 0.0035, st, segs=1))
    parts.append(C.tube('hbar', [(0, -0.034, 0.165), (0, 0.034, 0.165)], 0.0035, st))
    q = S / 2 - 0.006
    parts.append(C.bent_tube('frame', [(-q, -q, 0.07), (q, -q, 0.07), (q, q, 0.07), (-q, q, 0.07), (-q, -q + 0.0001, 0.07)], 0.0022, 0.02, st))
    parts.append(C.tube('crossA', [(-q, 0, 0.07), (q, 0, 0.07)], 0.002, st))
    parts.append(C.tube('crossB', [(0, -q, 0.07), (0, q, 0.07)], 0.002, st))
    for x, y in ((-q, -q), (q, -q), (q, q), (-q, q)):
        parts.append(C.tube('upr', [(x, y, 0.012), (x, y, 0.07)], 0.002, st))
    rnd = random.Random(7)
    for k, (kind, (x, y)) in enumerate(zip(['fish', 'vin', 'chili', 'sugar'], [(-0.041, -0.041), (0.041, -0.041), (0.041, 0.041), (-0.041, 0.041)])):
        R, Hj = 0.034, 0.092
        jar = C.lathe('jar', [(1e-5, 0.0), (R - 0.006, 0.0), (R, 0.006), (R, Hj - 0.012), (R - 0.004, Hj - 0.006), (R - 0.004, Hj)], 28, glass)
        jar.location = (x, y, 0.009); C.apply_xform(jar); C.smooth(jar, 50); C.uv_cyl(jar)
        parts.append(jar)
        lvl = {'fish': 0.06, 'vin': 0.058, 'chili': 0.05, 'sugar': 0.055}[kind]
        c = C.cyl('fill', R - 0.0025, lvl, (x, y, 0.0105), mat=fill[kind], segs=24, bev=0.001)
        C.uv_box(c); parts.append(c)
        if kind in ('fish', 'vin'):
            for i in range(9):   # chili rings floating
                a, r = rnd.uniform(0, 2 * PI), rnd.uniform(0, R - 0.01)
                ring = C.lathe('ring', [(0.0025, 0), (0.0045, 0), (0.0045, 0.002), (0.0025, 0.002)], 8, red if (kind == 'fish' and i % 3) else green)
                ring.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0)
                ring.location = (x + r * math.cos(a), y + r * math.sin(a), 0.0105 + lvl - 0.001); C.apply_xform(ring); C.uv_box(ring)
                parts.append(ring)
        # stainless lid with the spoon notch, and the spoon
        lid = C.lathe('lid', [(1e-5, 0.0115), (R + 0.0015, 0.0115), (R + 0.0015, 0.002), (R + 0.0005, 0.0), (R - 0.004, 0.0), (R - 0.004, 0.009), (1e-5, 0.009)][::-1], 28, st)
        lid.location = (x, y, 0.009 + Hj); C.apply_xform(lid); C.smooth(lid, 45); C.uv_box(lid)
        parts.append(lid)
        ang = math.atan2(-y, -x) + rnd.uniform(-0.3, 0.3)
        tip = Vector((x + math.cos(ang) * 0.012, y + math.sin(ang) * 0.012, 0.009 + Hj + 0.0115))
        end = tip + Vector((math.cos(ang) * 0.02, math.sin(ang) * 0.02, 0.05))
        bowl_c = Vector((x - math.cos(ang) * 0.004, y - math.sin(ang) * 0.004, 0.0105 + lvl + 0.004))
        parts.append(C.tube('spoon', [tuple(bowl_c), tuple(tip), tuple(end)], 0.0016, st, segs=1))
        b = C.lathe('bowl', [(1e-5, 0), (0.008, 0.002), (0.0095, 0.006), (0.0085, 0.006), (0.007, 0.0035), (1e-5, 0.0015)], 14, st)
        b.scale = (1, 0.7, 1); b.location = tuple(bowl_c - Vector((0, 0, 0.004))); C.apply_xform(b); C.uv_box(b)
        parts.append(b)
    return parts


# ============================================================ tamarind chopping board
@model('tamarind_board', cat='kitchen', title='Tamarind wood chopping block (เขียงมะขาม)', tags=['chopping board', 'block', 'wood', 'tamarind', 'butcher', 'kitchen', 'thai'],
       phys='dynamic', mass=6.0, friction=0.75, bake=1024, low=900, tex=1024, tris=1200, far=0.8, collider='cyl')
def tamarind_board():
    R, T = 0.19, 0.075
    rnd = random.Random(3)
    wood = (0.78, 0.6, 0.42)
    top = C.label_mat('board_top', 'textures/props/tamarind_board_top_used.jpg', rough=0.75, tint=wood, w=dict(dirt=0.45, grime=0.35, dirt_col=(0.15, 0.08, 0.04), seed=2))
    bot = C.label_mat('board_bot', 'textures/props/tamarind_board_top.jpg', rough=0.8, tint=wood, w=dict(dirt=0.4, grime=0.3, dirt_col=(0.12, 0.08, 0.04)))
    side = C.pbr('board_side', files={'albedo': 'props/tamarind_board_side_tile.jpg', 'normal': 'props/tamarind_board_side_tile_n.jpg'}, tile=0.25, rough=0.8, tint=(0.7, 0.55, 0.4),
                 metal=0.0, w=dict(dirt=0.5, grime=0.35, streak=0.3, dirt_col=(0.12, 0.07, 0.03), seed=5))
    # irregular round (trunk section) with soft, worn edges
    N = 64
    rad = [R * (1 + 0.025 * math.sin(3 * 2 * PI * k / N + 1) + 0.015 * math.sin(7 * 2 * PI * k / N) + rnd.uniform(-0.004, 0.004)) for k in range(N)]
    bm = bmesh.new()
    rings = []
    prof = [(0.0, -0.006), (0.004, 0.0), (T - 0.006, 0.0), (T, -0.008)]   # (z, inset): bottom chamfer, side, worn top edge
    for z, ins in prof:
        rings.append([bm.verts.new(((rad[k] + ins) * math.cos(2 * PI * k / N), (rad[k] + ins) * math.sin(2 * PI * k / N), z)) for k in range(N)])
    for i in range(len(rings) - 1):
        for k in range(N): bm.faces.new([rings[i][k], rings[i][(k + 1) % N], rings[i + 1][(k + 1) % N], rings[i + 1][k]])
    ft = bm.faces.new(rings[-1]); fb = bm.faces.new(rings[0][::-1])
    bm.normal_update()
    o = C.mesh_obj('board', bm, side)
    o.data.materials.append(top); o.data.materials.append(bot)
    C.bevel(o, 0.003, 2, 50, harden=False); C.apply_mods(o)
    C.smooth(o, 40); C.uv_cyl(o, k=1.0)
    me = o.data
    uvl = me.uv_layers['UVMap']
    for p in me.polygons:
        if p.normal.z > 0.7 or p.normal.z < -0.7:
            p.material_index = 1 if p.normal.z > 0 else 2
            for li in p.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                uvl.data[li].uv = (0.5 + v.x / (2.06 * R), 0.5 + v.y / (2.06 * R) * (1 if p.normal.z > 0 else -1))
        else: p.material_index = 0
    return [o]


# ============================================================ LPG cylinder 15 kg
@model('lpg_15kg', cat='kitchen', title='LPG cylinder 15 kg, World Gas blue (ถังแก๊ส)', tags=['lpg', 'gas', 'cylinder', 'tank', 'cooking', 'thai', 'blue'],
       phys='dynamic', mass=29, friction=0.45, bake=1024, low=2200, tex=512, tris=2800, collider='cyl')
def lpg_15kg():
    paint = C.pbr('lpg_paint', files={'albedo': 'props/lpg_paint_blue_tile.jpg', 'normal': 'props/lpg_paint_tile_n.jpg', 'rough': 'props/lpg_paint_tile_r.jpg'},
                  tile=0.5, metal=0.0, w=dict(dirt=0.5, grime=0.35, streak=0.35, wear=0.35, wear_col=(0.32, 0.3, 0.28), dirt_col=(0.12, 0.08, 0.05), seed=6))
    label = C.label_mat('lpg_label', 'img/labels/lpg_cylinder_world_gas.png', rough=0.55, w=dict(dirt=0.3, grime=0.3, streak=0.3, wear=0.25, dirt_col=(0.12, 0.08, 0.05), seed=6))
    brass = C.pbr('brass', tex='brass_gold', tile=0.1, metal=1.0, w=dict(dirt=0.6, grime=0.3, seed=2))
    R = 0.15
    # foot ring, domed bottom, straight wall, domed top, valve boss
    prof = [(1e-5, 0.004), (0.12, 0.0), (0.128, 0.003), (0.128, 0.05), (0.124, 0.056), (0.132, 0.063), (0.141, 0.072), (0.147, 0.086), (R, 0.105),
            (R, 0.50), (0.148, 0.518), (0.141, 0.535), (0.127, 0.55), (0.105, 0.561), (0.075, 0.568), (0.045, 0.572), (0.03, 0.573), (0.03, 0.578), (1e-5, 0.579)]
    body = C.lathe('body', prof, 40, paint)
    C.smooth(body, 40); C.uv_cyl(body)
    body.data.materials.append(label)
    band_uv(body, 0.17, 0.47, 0.3 * 0.933 / R, 1)
    # guard collar with two handle cut-outs
    col = C.lathe('collar', [(0.108, 0.53), (0.112, 0.53), (0.112, 0.655), (0.108, 0.655)], 40, paint)
    for ang in (0, PI):
        ct = C.rbox('hole', 0.09, 0.08, 0.035, (0, 0, 0.6), bev=0.012, segs=3)
        ct.rotation_euler = (0, 0, ang); ct.location = (0, 0, 0); C.apply_xform(ct)
        ct.location = (math.sin(ang) * 0.11, -math.cos(ang) * 0.11, 0); C.apply_xform(ct)
        m = col.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = ct; m.solver = 'EXACT'
        C.apply_mods(col); bpy.data.objects.remove(ct)
    C.bevel(col, 0.0015, 2, 40); C.apply_mods(col); C.smooth(col, 40); C.uv_cyl(col)
    # foot ring holes
    parts = [body, col]
    # valve: brass body, outlet, hand wheel
    parts.append(C.cyl('valve', 0.016, 0.06, (0, 0, 0.56), mat=brass, segs=6, bev=0.002))
    parts.append(C.cyl('outlet', 0.008, 0.035, (0, -0.012, 0.595), rot=(PI / 2, 0, 0), mat=brass, segs=12))
    wheel = C.lathe('wheel', [(0.012, 0.0), (0.03, 0.0), (0.03, 0.008), (0.012, 0.008)], 20, C.flat('wheel', (0.08, 0.08, 0.09), rough=0.6))
    wheel.location = (0, 0, 0.62); C.apply_xform(wheel); C.uv_box(wheel)
    parts.append(wheel)
    for k in range(5):
        a = 2 * PI * k / 5
        parts.append(C.rbox('spoke', 0.022, 0.006, 0.006, (math.cos(a) * 0.019, math.sin(a) * 0.019, 0.621), C.flat('wheel2', (0.08, 0.08, 0.09), rough=0.6), bev=0.001, rot=(0, 0, a)))
    return parts


# ============================================================ Thai brand bottles & cans
def bottle_profile(kind, h, d):
    r = d / 2
    if kind == 'sauce':     # glass sauce bottle: body, rounded shoulder, long neck, lip
        return [(1e-5, 0.003), (r - 0.006, 0.0), (r, 0.006), (r, 0.6 * h), (r * 0.82, 0.69 * h), (r * 0.48, 0.77 * h), (0.0135, 0.84 * h), (0.0135, 0.93 * h),
                (0.0155, 0.935 * h), (0.0155, 0.95 * h), (0.0, 0.95 * h)]
    if kind == 'beer':
        return [(1e-5, 0.004), (r - 0.007, 0.0), (r, 0.008), (r, 0.56 * h), (r * 0.9, 0.62 * h), (r * 0.55, 0.72 * h), (0.0125, 0.8 * h), (0.0118, 0.94 * h),
                (0.0145, 0.955 * h), (0.0145, 0.975 * h), (0.0, 0.975 * h)]
    if kind == 'pet':
        return [(1e-5, 0.006), (r * 0.7, 0.0), (r, 0.012), (r, 0.12 * h), (r * 0.96, 0.15 * h), (r, 0.18 * h), (r, 0.66 * h), (r * 0.7, 0.78 * h), (0.0145, 0.86 * h),
                (0.0145, 0.88 * h), (0.019, 0.885 * h), (0.019, 0.893 * h), (0.0145, 0.9 * h), (0.0145, 0.92 * h), (0.0, 0.92 * h)]
    if kind == 'small':     # Krating Daeng / M-150 brown bottle
        return [(1e-5, 0.003), (r - 0.004, 0.0), (r, 0.004), (r, 0.5 * h), (r * 0.8, 0.62 * h), (0.012, 0.75 * h), (0.0115, 0.88 * h), (0.0135, 0.89 * h), (0.0, 0.89 * h)]
    if kind == 'can':
        return [(1e-5, 0.004), (r * 0.78, 0.0), (r * 0.82, 0.002), (r, 0.012), (r, h - 0.012), (r * 0.86, h - 0.004), (r * 0.88, h), (r * 0.8, h - 0.002), (0.0, h - 0.003)]
    if kind == 'jar':
        return [(1e-5, 0.002), (r - 0.004, 0.0), (r, 0.004), (r, 0.82 * h), (r * 0.9, 0.86 * h), (r * 0.88, 0.86 * h), (0.0, 0.86 * h)]
    raise ValueError(kind)


BOTTLES = {
    # id: (kind, label, h, d, label_h, glass colour (opaque look of glass + liquid), rough, cap colour, cap kind, title)
    'bottle_fish_sauce_tiparos': ('pet', 'fish_sauce_tiparos', 0.29, 0.075, 0.085, (0.42, 0.2, 0.04), 0.06, (0.9, 0.9, 0.86), 'screw', 'Fish sauce bottle, Tiparos (น้ำปลาทิพรส)'),
    'bottle_fish_sauce_squid': ('sauce', 'fish_sauce_squid', 0.28, 0.076, 0.095, (0.38, 0.17, 0.03), 0.05, (0.1, 0.5, 0.18), 'screw', 'Fish sauce bottle, Squid brand (น้ำปลาตราปลาหมึก)'),
    'bottle_golden_mountain': ('sauce', 'seasoning_sauce_golden_mountain', 0.245, 0.072, 0.09, (0.07, 0.035, 0.015), 0.05, (0.12, 0.54, 0.24), 'screw', 'Golden Mountain seasoning sauce (ซอสภูเขาทอง)'),
    'bottle_light_soy': ('sauce', 'light_soy_healthy_boy', 0.27, 0.07, 0.11, (0.1, 0.05, 0.02), 0.05, (0.95, 0.75, 0.1), 'screw', 'Healthy Boy light soy sauce (ซีอิ๊วขาวเด็กสมบูรณ์)'),
    'bottle_dark_soy': ('pet', 'dark_soy_healthy_boy', 0.26, 0.076, 0.09, (0.05, 0.03, 0.02), 0.08, (0.85, 0.15, 0.1), 'screw', 'Healthy Boy dark soy sauce (ซีอิ๊วดำ)'),
    'bottle_oyster_sauce': ('sauce', 'oyster_sauce_maekrua', 0.255, 0.076, 0.1, (0.09, 0.05, 0.03), 0.05, (0.75, 0.1, 0.08), 'screw', 'Maekrua oyster sauce (ซอสหอยนางรมแม่ครัว)'),
    'bottle_palm_oil': ('pet', 'palm_oil_morakot_1l', 0.30, 0.084, 0.105, (0.78, 0.55, 0.1), 0.07, (0.1, 0.5, 0.2), 'screw', 'Morakot palm oil 1 L (น้ำมันปาล์มมรกต)'),
    'bottle_soybean_oil': ('pet', 'soybean_oil_angoon_1l', 0.30, 0.084, 0.10, (0.82, 0.62, 0.12), 0.07, (0.95, 0.8, 0.1), 'screw', 'Angoon soybean oil 1 L (น้ำมันถั่วเหลืององุ่น)'),
    'bottle_fanta_red': ('pet', 'soda_fanta_red_bottle', 0.32, 0.095, 0.09, (0.62, 0.05, 0.05), 0.06, (0.1, 0.3, 0.75), 'screw', 'Red Fanta bottle (น้ำแดง) — spirit house offering'),
    'bottle_water': ('pet', 'water_crystal_600ml', 0.22, 0.065, 0.055, (0.62, 0.72, 0.78), 0.04, (0.45, 0.7, 0.95), 'screw', 'Crystal drinking water 600 ml'),
    'bottle_beer_singha': ('beer', 'beer_singha_bottle', 0.285, 0.074, 0.09, (0.13, 0.05, 0.012), 0.05, (0.75, 0.6, 0.2), 'crown', 'Singha beer bottle (เบียร์สิงห์)'),
    'bottle_beer_chang': ('beer', 'beer_chang_bottle', 0.285, 0.074, 0.09, (0.03, 0.13, 0.05), 0.05, (0.15, 0.45, 0.2), 'crown', 'Chang beer bottle (เบียร์ช้าง)'),
    'bottle_beer_leo': ('beer', 'beer_leo_bottle', 0.285, 0.074, 0.085, (0.13, 0.05, 0.012), 0.05, (0.75, 0.6, 0.2), 'crown', 'Leo beer bottle (เบียร์ลีโอ)'),
    'bottle_whisky_sangsom': ('sauce', 'whisky_sangsom', 0.28, 0.085, 0.095, (0.36, 0.16, 0.03), 0.05, (0.75, 0.6, 0.2), 'screw', 'SangSom rum bottle (แสงโสม)'),
    'bottle_krating_daeng': ('small', 'energy_krating_daeng', 0.125, 0.052, 0.055, (0.16, 0.07, 0.015), 0.05, (0.8, 0.15, 0.1), 'crown', 'Krating Daeng energy drink (กระทิงแดง)'),
    'bottle_m150': ('small', 'energy_m150', 0.125, 0.052, 0.06, (0.16, 0.07, 0.015), 0.05, (0.8, 0.65, 0.25), 'screw', 'M-150 energy drink'),
    'can_coke': ('can', 'cola_coke_can_325', 0.115, 0.066, 0.1, (0.6, 0.6, 0.62), 0.25, None, None, 'Coca-Cola can 325 ml'),
    'can_beer_chang': ('can', 'beer_chang_can', 0.122, 0.066, 0.106, (0.6, 0.6, 0.62), 0.25, None, None, 'Chang beer can'),
    'can_beer_leo': ('can', 'beer_leo_can', 0.168, 0.066, 0.152, (0.6, 0.6, 0.62), 0.25, None, None, 'Leo beer can 490 ml'),
    'jar_chili_paste': ('jar', 'chili_paste_mae_pranom', 0.105, 0.07, 0.045, (0.42, 0.1, 0.04), 0.1, (0.15, 0.3, 0.7), 'lid', 'Mae Pranom chili paste jar (น้ำพริกเผาแม่ประนอม)'),
}


def make_bottle(bid):
    kind, lab, h, d, lh, gcol, rough, capcol, capk, title = BOTTLES[bid]
    r = d / 2
    if kind == 'can':
        body_m = C.pbr('alu', tex='aluminium_scratched', tile=0.15, metal=1.0, rough_mul=0.6, w=dict(dirt=0.3, grime=0.15))
    else:
        body_m = C.flat('glass_' + bid, gcol, rough=rough, w=dict(dirt=0.35, grime=0.25, dirt_col=(0.2, 0.17, 0.12), seed=hash(bid) % 7), noise=0.05)
    lab_m = C.label_mat('label', f'img/labels/{lab}.png', rough=0.4 if kind != 'can' else 0.3, metal=0.0 if kind != 'can' else 0.6,
                        w=dict(dirt=0.25, grime=0.25, wear=0.2, dirt_col=(0.2, 0.15, 0.1), seed=1))
    b = C.lathe('bottle', bottle_profile(kind, h, d), 24, body_m)
    C.smooth(b, 40); C.uv_cyl(b)
    b.data.materials.append(lab_m)
    from PIL import Image
    import os
    im = Image.open(os.path.join(C.ROOT, 'public/assets/img/labels', lab + '.png'))
    aspect = im.width / im.height
    if kind == 'can': z0, z1 = 0.012, h - 0.012
    else:
        zc = {'sauce': 0.33, 'beer': 0.3, 'pet': 0.42, 'small': 0.28, 'jar': 0.42}[kind] * h
        z0, z1 = zc - lh / 2, zc + lh / 2
    band_uv(b, z0, z1, min(2 * PI * 0.98, (z1 - z0) * aspect / r), 1)
    parts = [b]
    if capk:
        top = {'sauce': 0.95, 'beer': 0.975, 'pet': 0.92, 'small': 0.89, 'jar': 0.86}[kind] * h
        capm = C.flat('cap', capcol, rough=0.45 if capk != 'crown' else 0.3, metal=0.0 if capk == 'screw' else 0.8, w=dict(dirt=0.3, grime=0.2))
        if capk == 'screw': parts.append(C.cyl('cap', 0.0165 if kind != 'small' else 0.0145, 0.022 if kind != 'small' else 0.016, (0, 0, top - 0.012), mat=capm, segs=20, bev=0.0015))
        elif capk == 'crown':
            cp = C.lathe('crown', [(1e-5, 0.0065), (0.0145, 0.0065), (0.0158, 0.004), (0.0158, 0.0), (0.0148, 0.0), (1e-5, 0.001)][::-1], 21, capm)
            # crimped skirt
            for v in cp.data.vertices:
                if v.co.z < 0.004:
                    a = math.atan2(v.co.y, v.co.x); s = 1 + 0.06 * math.cos(21 * a)
                    v.co.x *= s; v.co.y *= s
            cp.location = (0, 0, top - 0.005); C.apply_xform(cp); C.uv_box(cp); parts.append(cp)
        else:
            parts.append(C.cyl('lid', r * 0.92, 0.016, (0, 0, top - 0.002), mat=capm, segs=24, bev=0.002))
    return parts


for _bid, _b in BOTTLES.items():
    small = _b[0] in ('small', 'can', 'jar')
    model(_bid, cat='packaged', title=_b[9], tags=['bottle' if _b[0] != 'can' else 'can', 'drink' if 'beer' in _bid or 'fanta' in _bid or 'water' in _bid or 'can' in _bid else 'sauce', 'thai', 'brand', _b[1]],
          phys='dynamic', mass=round(_b[2] * _b[3] * _b[3] * 600, 2), friction=0.45, bake=512, low=None, tex=256, tris=1400, far=0.4, collider='cyl')(
        (lambda bid: (lambda: make_bottle(bid)))(_bid))
