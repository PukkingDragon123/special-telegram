"""Thai street-architecture parts for the buildings agent: pole-mounted distribution transformer (หม้อแปลง) + platform,
Thai lightbox signs (real sign photos from public/assets/img/signs), folding steel gate (ประตูเหล็กยืด) closed module and
folded bundle, concrete ventilation blocks (ช่องลม)."""
import bpy, bmesh, math, random, os
from mathutils import Vector
import common as C
from registry import model

PI = math.pi


def paint(name, tint, seed=1, rust=0.35, tile=0.6):
    return C.pbr(name, tex='metal_painted_chipped', tile=tile, tint=tint, metal=0.0, rough_mul=1.0,
                 w=dict(dirt=0.55, grime=0.35, streak=0.45, wear=rust, wear_col=(0.36, 0.17, 0.07), dirt_col=(0.13, 0.09, 0.05), seed=seed))


def porcelain(name='porcelain', col=(0.36, 0.17, 0.08)):
    return C.flat(name, col, rough=0.18, noise=0.1, w=dict(dirt=0.5, grime=0.3, streak=0.3, dirt_col=(0.12, 0.1, 0.08), seed=3))


def bushing(h, sheds, r=0.03, mat=None):
    prof = [(1e-5, 0.0), (r * 1.2, 0.0), (r * 1.2, 0.02)]
    z = 0.02
    step = (h - 0.05) / sheds
    for k in range(sheds):
        prof += [(r, z + step * 0.15), (r * 2.1, z + step * 0.35), (r * 2.0, z + step * 0.45), (r, z + step * 0.6)]
        z += step
    prof += [(r * 0.9, h - 0.03), (r * 0.5, h - 0.02), (r * 0.5, h), (1e-5, h)]
    return C.lathe('bushing', prof, 16, mat)


# ============================================================ transformer
@model('transformer', cat='utility', title='Pole-mounted distribution transformer (หม้อแปลงไฟฟ้า)', tags=['transformer', 'utility', 'pole', 'electric', 'pea', 'thai'],
       phys='static', bake=1024, low=6500, tex=1024, tris=7500, far=1.8, yaw=30, pitch=12)
def transformer():
    grey = paint('tank', (0.72, 0.74, 0.72), seed=2, rust=0.4)
    dark = paint('steel', (0.35, 0.35, 0.34), seed=3, rust=0.6, tile=0.4)
    porc = porcelain()
    W, D, H = 0.86, 0.5, 0.92
    P = []
    # tank with a raised lid flange + base skid
    P.append(C.rbox('tank', W, D, H, (0, 0, 0.06), grey, bev=0.02, segs=2))
    P.append(C.rbox('lid', W + 0.06, D + 0.06, 0.04, (0, 0, H + 0.06), grey, bev=0.01))
    P.append(C.rbox('lid_top', W - 0.04, D - 0.04, 0.03, (0, 0, H + 0.1), grey, bev=0.012))
    for x in (-W / 2 + 0.1, W / 2 - 0.1):
        P.append(C.rbox('skid', 0.08, D + 0.12, 0.06, (x, 0, 0), dark, bev=0.006))
    # radiator fin banks, front + back
    for sy in (-1, 1):
        for k in range(13):
            x = -W / 2 + 0.1 + k * (W - 0.2) / 12
            P.append(C.rbox('fin', 0.014, 0.16, H - 0.24, (x, sy * (D / 2 + 0.08), 0.18), grey, bev=0.003))
        for z in (0.2, H - 0.06):
            P.append(C.rbox('header', W - 0.14, 0.05, 0.05, (0, sy * (D / 2 + 0.03), z), grey, bev=0.01))
    # HV bushings on top, LV bushings on the side, lifting lugs, name plate, oil gauge, earth strap
    for x in (-0.24, 0, 0.24):
        b = bushing(0.36, 4, 0.028, porc); b.location = (x, -0.05, H + 0.13); C.apply_xform(b); C.uv_box(b, 6); P.append(b)
        P.append(C.cyl('cap', 0.012, 0.05, (x, -0.05, H + 0.49), mat=dark, segs=8, bev=0.003))
    for k, x in enumerate((-0.27, -0.09, 0.09, 0.27)):
        b = bushing(0.15, 2, 0.02, porc); b.rotation_euler = (PI / 2, 0, 0); b.location = (x, -(D / 2 + 0.005), H - 0.12); C.apply_xform(b); C.uv_box(b, 6); P.append(b)
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        P.append(C.bent_tube('lug', [(x, -0.08, H + 0.1), (x, -0.08, H + 0.16), (x, 0.08, H + 0.16), (x, 0.08, H + 0.1)], 0.012, 0.03, dark))
    nameplate = C.rbox('plate', 0.16, 0.006, 0.1, (W * 0.25, -(D / 2 + 0.003), 0.55), C.pbr('alu', tex='aluminium_scratched', tile=0.2, metal=1.0, w=dict(dirt=0.6, grime=0.4)), bev=0.002)
    P.append(nameplate)
    P.append(C.cyl('gauge', 0.04, 0.03, (-W * 0.3, -(D / 2 + 0.01), 0.72), rot=(PI / 2, 0, 0), mat=dark, segs=16, bev=0.006))
    P.append(C.tube('earth', [(W / 2 - 0.02, -D / 2, 0.1), (W / 2 + 0.03, -D / 2 - 0.02, 0.05), (W / 2 + 0.06, -D / 2 - 0.03, -0.0)], 0.006, C.pbr('cu', tex='brass_gold', tile=0.2, tint=(0.9, 0.55, 0.4), metal=1.0)))
    return P


@model('transformer_platform', cat='utility', title='Transformer platform: steel channel beams + braces (between two poles 2 m apart)',
       tags=['transformer', 'platform', 'utility', 'pole', 'steel', 'thai'], phys='static', bake=512, low=1500, tex=512, tris=2000, far=1.6)
def transformer_platform():
    st = paint('channel', (0.5, 0.5, 0.48), seed=5, rust=0.7, tile=0.5)
    P = []
    L = 2.5
    for y in (-0.22, 0.22):
        # C-channel: web + flanges
        P.append(C.rbox('web', L, 0.008, 0.15, (0, y, 0), st, bev=0.002))
        for z in (0.0, 0.142):
            P.append(C.rbox('flange', L, 0.07, 0.008, (0, y + (0.035 if y < 0 else -0.035), z), st, bev=0.002))
        for x in (-1.0, 1.0):   # bolts to the poles
            for z in (0.04, 0.11):
                P.append(C.cyl('bolt', 0.009, 0.05, (x, y - 0.02, z), rot=(PI / 2, 0, 0), mat=st, segs=6, bev=0.002))
    for x in (-0.6, 0.6):
        P.append(C.rbox('cross', 0.06, 0.52, 0.008, (x, 0, 0.15), st, bev=0.002))
    return P


# ============================================================ lightbox signs
SIGNS = {
    # id: (image, width m, height m, depth m, kind)  kind: blade (double-sided, perpendicular to the wall) | flat (on the facade)
    'signbox_room_for_rent': ('sign_room_for_rent_lightbox', 0.9, 0.45, 0.12, 'blade', 'Lightbox: room for rent (มีห้องว่างให้เช่า)'),
    'signbox_pharmacy': ('shop_pharmacy_world_lightbox', 0.8, 0.45, 0.13, 'blade', 'Lightbox: pharmacy'),
    'signbox_chicken_rice': ('shop_chicken_rice_midnight_korat_lightbox', 1.3, 0.45, 0.14, 'flat', 'Lightbox: chicken rice shop (ข้าวมันไก่)'),
    'signbox_barber': ('shop_barber_noi_lightbox', 1.6, 0.23, 0.12, 'flat', 'Lightbox: barber (ร้านตัดผม)'),
    'signbox_gold_vertical': ('shop_gold_vertical_green_white_cn', 0.32, 1.78, 0.14, 'blade', 'Vertical gold shop sign (ร้านทอง)'),
    'signbox_noodle': ('shop_noodle_neon_logo', 0.62, 0.66, 0.13, 'blade', 'Lightbox: noodle shop logo (ก๋วยเตี๋ยว)'),
    'signbox_coffee': ('shop_coffee_boran_green_blue', 1.0, 0.5, 0.12, 'flat', 'Sign box: coffee boran (กาแฟโบราณ)'),
    'signbox_massage': ('shop_massage_nuat_red', 0.6, 0.67, 0.13, 'blade', 'Lightbox: Thai massage (นวดแผนไทย)'),
}


def make_sign(sid):
    imgname, W, H, Dp, kind, title = SIGNS[sid]
    alu = C.pbr('frame', tex='aluminium_scratched', tile=0.4, metal=1.0, rough_mul=0.9, w=dict(dirt=0.6, grime=0.45, streak=0.5, dirt_col=(0.12, 0.1, 0.07), seed=7))
    face = C.label_mat('face', f'img/signs/{imgname}.png', rough=0.3, w=dict(dirt=0.35, grime=0.35, streak=0.4, dirt_col=(0.14, 0.11, 0.07), seed=8))
    steel = paint('bracket', (0.25, 0.25, 0.25), seed=9, rust=0.7, tile=0.3)
    P = []
    # box: the sign plane is XZ for flat signs (faces -Y = street); blades are rotated so the faces look along ±X
    body = C.rbox('box', W, Dp, H, (0, 0, 0), alu, bev=0.018, segs=3)
    P.append(body)
    def face_panel(y, flip):
        bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
        m = 0.025
        vs = [bm.verts.new((x, y, z)) for x, z in ((-W / 2 + m, m), (W / 2 - m, m), (W / 2 - m, H - m), (-W / 2 + m, H - m))]
        f = bm.faces.new(vs if not flip else vs[::-1])
        for l in f.loops:
            co = l.vert.co
            u = (co.x + W / 2 - m) / (W - 2 * m)
            l[uvl].uv = (u if not flip else 1 - u, (co.z - m) / (H - 2 * m))
        return C.mesh_obj('face', bm, face)
    P.append(face_panel(-Dp / 2 - 0.002, False))
    if kind == 'blade': P.append(face_panel(Dp / 2 + 0.002, True))
    out = []
    if kind == 'blade':
        # blade: rotate so the faces look along ±X, wall at +Y (back); two L brackets + conduit
        for o in P:
            o.rotation_euler = (0, 0, PI / 2); o.location = (0, -(W / 2 + 0.12), 0); C.apply_xform(o)
        for z in (H * 0.15, H * 0.85):
            out.append(C.tube('arm', [(0, 0.0, z), (0, -0.14, z)], 0.012, steel))
            out.append(C.rbox('plate', 0.1, 0.008, 0.1, (0, -0.004, z - 0.05), steel, bev=0.002))
        out.append(C.tube('conduit', [(0.0, -0.12, H * 0.5), (0.02, -0.06, H * 0.45), (0.03, -0.01, H * 0.2), (0.03, -0.01, -0.3)], 0.008, C.flat('pvc', (0.86, 0.86, 0.82), rough=0.5, w=dict(dirt=0.6, grime=0.5))))
    else:
        for o in P:
            o.location = (0, -(Dp / 2 + 0.06), 0); C.apply_xform(o)
        for x in (-W * 0.35, W * 0.35):
            for z in (H * 0.2, H * 0.8):
                out.append(C.rbox('stand', 0.04, 0.06, 0.04, (x, -0.03, z), steel, bev=0.004))
        out.append(C.tube('cable', [(W / 2 - 0.05, -0.05, H * 0.3), (W / 2 + 0.03, -0.01, H * 0.25), (W / 2 + 0.05, -0.01, -0.4)], 0.005, C.flat('cable', (0.03, 0.03, 0.03), rough=0.6)))
    return P + out


for _sid, _s in SIGNS.items():
    model(_sid, cat='signs', title=_s[5], tags=['sign', 'lightbox', 'shop', 'thai', _s[4], 'wall'], phys='static', bake=1024, low=None, tex=1024, tris=1500,
          far=1.6, anchor='back', yaw=60 if _s[4] == 'blade' else 20, pitch=5)((lambda sid: (lambda: make_sign(sid)))(_sid))


# ============================================================ folding steel gate
def gate_mat():
    return paint('gate', (0.38, 0.45, 0.42), seed=11, rust=0.65, tile=0.5)


@model('folding_gate', cat='facade', title='Folding steel gate, closed, 1.2 m module (ประตูเหล็กยืด)', tags=['gate', 'folding', 'steel', 'shutter', 'facade', 'shophouse', 'thai'],
       phys='static', bake=1024, low=4500, tex=1024, tris=5000, far=1.4, anchor='back', yaw=20, pitch=5)
def folding_gate():
    st = gate_mat()
    W, H = 1.2, 2.6
    P = []
    n = 11                      # vertical channels per module (pitch ~11 cm)
    pitch = W / n
    for k in range(n):
        x = -W / 2 + pitch * (k + 0.5)
        P.append(C.rbox('chan', 0.022, 0.03, H - 0.1, (x, 0, 0.05), st, bev=0.003))
    # X lattice between neighbouring channels at three levels
    for k in range(n - 1):
        x0 = -W / 2 + pitch * (k + 0.5); x1 = x0 + pitch
        for zc in (0.45, 1.3, 2.15):
            hz = 0.36
            for sgn in (-1, 1):
                L = math.hypot(pitch, hz * 2)
                b = C.rbox('bar', L, 0.005, 0.022, (0, 0, -0.011), st, bev=0.0015)
                b.rotation_euler = (0, sgn * math.atan2(hz * 2, pitch), 0); b.location = ((x0 + x1) / 2, -0.02 if sgn > 0 else -0.026, zc); C.apply_xform(b)
                P.append(b)
            P.append(C.cyl('rivet', 0.006, 0.014, ((x0 + x1) / 2, -0.03, zc), rot=(PI / 2, 0, 0), mat=st, segs=8, bev=0.002))
    # top & bottom tracks
    P.append(C.rbox('top', W, 0.06, 0.06, (0, 0.01, H - 0.06), st, bev=0.006))
    P.append(C.rbox('bottom', W, 0.07, 0.025, (0, 0.01, 0), st, bev=0.005))
    for k in range(n):
        x = -W / 2 + pitch * (k + 0.5)
        P.append(C.cyl('roller', 0.012, 0.012, (x, -0.02, H - 0.075), rot=(PI / 2, 0, 0), mat=st, segs=10, bev=0.002))
    return P


@model('folding_gate_folded', cat='facade', title='Folding steel gate pushed open (folded bundle)', tags=['gate', 'folding', 'steel', 'facade', 'shophouse', 'thai', 'open'],
       phys='static', bake=1024, low=2500, tex=1024, tris=3000, far=1.3, anchor='back', yaw=35, pitch=5)
def folding_gate_folded():
    st = gate_mat()
    H = 2.6
    P = []
    rnd = random.Random(4)
    n = 22
    for k in range(n):
        x = -0.17 + k * 0.016 + rnd.uniform(-0.002, 0.002)
        P.append(C.rbox('chan', 0.022, 0.03, H - 0.1, (x, 0, 0.05), st, bev=0.003))
        for zc in (0.45, 1.3, 2.15):   # folded lattice: bars hang almost vertical between channels
            for dz in (-0.33, 0.33):
                P.append(C.rbox('bar', 0.005, 0.022, 0.06, (x + 0.008, -0.022, zc + dz * 0.9), st, bev=0.0015))
    P.append(C.rbox('top', 0.42, 0.06, 0.06, (0, 0.01, H - 0.06), st, bev=0.006))
    P.append(C.rbox('bottom', 0.42, 0.07, 0.025, (0, 0.01, 0), st, bev=0.005))
    # padlock + chain looped round the bundle
    lock = C.pbr('brass_lock', tex='brass_gold', tile=0.1, metal=1.0, w=dict(dirt=0.5, grime=0.3))
    P.append(C.rbox('padlock', 0.05, 0.022, 0.06, (0.2, -0.05, 1.0), lock, bev=0.006))
    P.append(C.bent_tube('shackle', [(0.188, -0.05, 1.055), (0.188, -0.05, 1.08), (0.212, -0.05, 1.08), (0.212, -0.05, 1.055)], 0.004, 0.01, C.pbr('chrome', tex='chrome', tile=0.1, metal=1.0)))
    return P


# ============================================================ ventilation blocks (ช่องลม)
def vent_block_geo(name, mat, x=0.0, z=0.0):
    S, T = 0.19, 0.09
    o = C.rbox(name, S, T, S, (x, 0, z), mat, bev=0.006)
    # pattern: square window with a circle and a four-petal cross (boolean cutters)
    cut = []
    c = C.cyl('c', 0.07, T + 0.1, (x, 0.05 + T / 2, z + S / 2), rot=(PI / 2, 0, 0), segs=24, bev=0)
    cut.append(c)
    for m in list(cut):
        md = o.modifiers.new('cut', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = m; md.solver = 'EXACT'
        C.apply_mods(o); bpy.data.objects.remove(m)
    # the cross / petals left standing inside the circle
    petals = []
    for a in (0, PI / 2):
        b = C.rbox('petal', 0.15, T * 0.7, 0.022, (0, 0, -0.011), mat, bev=0.005)
        b.rotation_euler = (0, a, 0); b.location = (x, 0, z + S / 2); C.apply_xform(b); petals.append(b)
    ring = C.lathe('ring', [(0.036, -T * 0.35), (0.044, -T * 0.35), (0.044, T * 0.35), (0.036, T * 0.35)], 20, mat)
    ring.rotation_euler = (PI / 2, 0, 0); ring.location = (x, 0, z + S / 2); C.apply_xform(ring); C.uv_box(ring)
    return [o, ring] + petals


def vent_mat():
    return C.pbr('vent', tex='concrete_streaked', tile=0.5, tint=(1.05, 1.02, 0.95), metal=0.0, w=dict(dirt=0.65, grime=0.45, streak=0.5, dirt_col=(0.14, 0.12, 0.09), seed=13))


@model('vent_block', cat='facade', title='Concrete ventilation block (ช่องลม), single 19 cm', tags=['vent', 'block', 'breeze block', 'concrete', 'facade', 'wall', 'thai'],
       phys='static', bake=512, low=600, tex=512, tris=800, far=1.0, anchor='back', yaw=15, pitch=5)
def vent_block():
    return vent_block_geo('vb', vent_mat())


@model('vent_block_panel', cat='facade', title='Ventilation block panel 5 × 3 (ช่องลม)', tags=['vent', 'block', 'breeze block', 'concrete', 'facade', 'wall', 'thai', 'panel'],
       phys='static', bake=1024, low=4000, tex=1024, tris=4500, far=1.4, anchor='back', yaw=15, pitch=5)
def vent_block_panel():
    m = vent_mat()
    P = []
    for i in range(5):
        for j in range(3):
            P += vent_block_geo(f'vb{i}{j}', m, (i - 2) * 0.2, j * 0.2)
    return P
