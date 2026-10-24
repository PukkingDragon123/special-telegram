"""
Headless Blender build for the characters module (เฮียผัด!).

  blender -b --factory-startup -P scripts/characters/build_chars.py -- <ubc_dir> <ual_glb> <out_dir>

Inputs (CC0, Quaternius): Universal Base Characters [Standard] (Superhero_Male/Female_FullBody.gltf)
and Universal Animation Library [Standard] (UAL1_Standard.glb).
Outputs (out_dir = public/assets/gen/characters):
  body_m.glb / body_f.glb   armature + meshes: body_hi, body_lo, shell_* (fitted clothing shells),
                            skirt_*, shoe_*; UV0 = the characters atlas layout (layout.ts), _FAT attribute
  anims.glb                 armature + all UAL clips (no mesh)
  body_m.json / body_f.json landmarks (three.js frame), head surface table, height mapping
Keep the layout constants below in sync with src/modules/characters/layout.ts.
"""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
UBC_DIR, UAL_GLB, OUT = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)

# ----------------------------------------------------------------- layout (mirror of layout.ts)
ATLAS, INSET = 1024.0, 5.0
REG = {
    'torso': (0, 0, 512, 400), 'leg': (512, 0, 288, 512), 'arm': (800, 0, 224, 400), 'face': (0, 400, 320, 320),
    'scalp': (320, 400, 192, 160), 'neck': (320, 560, 192, 64), 'hand': (320, 624, 192, 96), 'foot': (512, 512, 192, 160),
    'hair': (704, 400, 320, 272), 'skirt': (0, 720, 400, 200), 'apron': (400, 720, 128, 200), 'hat': (528, 672, 256, 128),
    'collar': (784, 672, 240, 48), 'band': (784, 720, 240, 32), 'towel': (784, 752, 240, 64), 'mask': (528, 800, 128, 96),
    'pack': (656, 800, 128, 128), 'sole': (784, 816, 120, 64), 'ear': (904, 816, 120, 64),
}
def ruv(reg, s, t):
    x, y, w, h = REG[reg]
    s = min(1.0, max(0.0, s)); t = min(1.0, max(0.0, t))
    # glTF uv (0,0) = top-left of the image, three.js flipY=false → v = canvas y / size
    return ((x + INSET + s * (w - 2 * INSET)) / ATLAS, (y + INSET + t * (h - 2 * INSET)) / ATLAS)
TORSO_TOP, TORSO_BOT = 1.5, 0.78
LEG_TOP, LEG_BOT = 1.0, 0.0
ARM_D0, ARM_D1 = -0.06, 0.56
NECK_TOP, NECK_BOT = 1.62, 1.4
HAND_D0, HAND_D1 = -0.015, 0.2
FOOT_Z0, FOOT_Z1 = -0.085, 0.245
SCALP_TOP, SCALP_BOT = 0.235, -0.035
torsoT = lambda y: (TORSO_TOP - y) / (TORSO_TOP - TORSO_BOT)
legT = lambda y: (LEG_TOP - y) / (LEG_TOP - LEG_BOT)
armT = lambda d: (d - ARM_D0) / (ARM_D1 - ARM_D0)
neckT = lambda y: (NECK_TOP - y) / (NECK_TOP - NECK_BOT)
handT = lambda d: (d - HAND_D0) / (HAND_D1 - HAND_D0)
footT = lambda z: (z - FOOT_Z0) / (FOOT_Z1 - FOOT_Z0)
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (x - a) / (b - a))))

PART_OF = {}
for n in ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r']: PART_OF[n] = 'torso'
PART_OF['neck_01'] = 'neck'; PART_OF['Head'] = 'head'
for s in 'lr':
    PART_OF['upperarm_' + s] = 'arm'; PART_OF['lowerarm_' + s] = 'arm'
    PART_OF['thigh_' + s] = 'leg'; PART_OF['calf_' + s] = 'leg'
    PART_OF['foot_' + s] = 'foot'; PART_OF['ball_' + s] = 'foot'; PART_OF['ball_leaf_' + s] = 'foot'
    for f in ['hand', 'index', 'middle', 'ring', 'pinky', 'thumb']:
        pass

def part_of_bone(n):
    if n in PART_OF: return PART_OF[n]
    if n.startswith(('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')): return 'hand'
    return 'torso'

def side_of_bone(n):
    return 1 if n.endswith('_l') else (-1 if n.endswith('_r') else 0)

def interp(pairs, x):
    pairs = sorted(pairs)
    if x <= pairs[0][0]: (x0, y0), (x1, y1) = pairs[0], pairs[1]
    elif x >= pairs[-1][0]: (x0, y0), (x1, y1) = pairs[-2], pairs[-1]
    else:
        for i in range(len(pairs) - 1):
            if pairs[i][0] <= x <= pairs[i + 1][0]: (x0, y0), (x1, y1) = pairs[i], pairs[i + 1]; break
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)

def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def apply_mod(o, m):
    select_only([o])
    bpy.ops.object.modifier_apply(modifier=m.name)

# ----------------------------------------------------------------- per body
def build_body(src, sex):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    body = max([m for m in meshes if m.parent == arm], key=lambda m: len(m.data.vertices))
    eyes = next((m for m in meshes if m.name.lower().startswith('eyes')), None)
    # eye centres (world, blender frame)
    ec = []
    if eyes:
        vs = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
        for sgn in (1, -1):
            pts = [v for v in vs if v.x * sgn > 0]
            c = sum(pts, Vector()) / len(pts)
            ec.append(c)
    for m in meshes:
        if m != body: bpy.data.objects.remove(m, do_unlink=True)
    # the glTF importer splits vertices at every UV seam → weld them, or smoothing/decimation tears cracks open
    bmw = bmesh.new(); bmw.from_mesh(body.data)
    bmesh.ops.remove_doubles(bmw, verts=bmw.verts, dist=1e-4)
    bmw.to_mesh(body.data); bmw.free(); body.data.update()
    B = {b.name: b for b in arm.data.bones}
    W = lambda n: arm.matrix_world @ B[n].head_local
    eye_l, eye_r = (ec[0], ec[1]) if ec else (Vector((0.031, -0.07, W('Head').z + 0.1)), Vector((-0.031, -0.07, W('Head').z + 0.1)))
    eye_mid = (eye_l + eye_r) / 2
    iod = (eye_l - eye_r).length
    top_z = max((body.matrix_world @ v.co).z for v in body.data.vertices)
    # height mapping blender z → reference body y (1.70 m reference used by the painter)
    zmap = [
        (W('foot_l').z, 0.075), (W('calf_l').z, 0.48), (W('thigh_l').z, 0.90), (W('spine_01').z, 1.05), (W('spine_03').z, 1.24),
        (W('upperarm_l').z, 1.405), (W('neck_01').z, 1.445), (W('Head').z, 1.555), (top_z, 1.784),
    ]
    yref = lambda z: interp(zmap, z)
    # arm distance mapping (T-pose, along ±x)
    sh_x, el_x, wr_x = W('upperarm_l').x, W('lowerarm_l').x, W('hand_l').x
    tip_x = max((body.matrix_world @ v.co).x for v in body.data.vertices)
    dmap = [(sh_x - 0.12, -0.12 * 0.29 / (el_x - sh_x)), (sh_x, 0.0), (el_x, 0.29), (wr_x, 0.54)]
    hmap = [(wr_x, 0.0), (tip_x, 0.19)]
    ank = W('foot_l'); toe_y = arm.matrix_world @ B['ball_leaf_l'].tail_local
    foot_len = ank.y - toe_y.y
    head_c = Vector((0.0, (W('Head').y + eye_mid.y) * 0.5 + 0.02, 0.0))

    # ---- vertex groups (dominant bone per vertex)
    vg_names = {g.index: g.name for g in body.vertex_groups}
    def dominant(v):
        best, bw = None, -1
        for g in v.groups:
            if g.weight > bw and g.group in vg_names: best, bw = vg_names[g.group], g.weight
        return best or 'pelvis'

    # ---- soften the superhero body (remove muscle definition), fill eye sockets
    me = body.data
    vg_soft = body.vertex_groups.new(name='_soft')
    vg_eye = body.vertex_groups.new(name='_eye')
    for v in me.vertices:
        p = body.matrix_world @ v.co
        part = part_of_bone(dominant(v))
        w = {'torso': 1.0, 'arm': 0.9, 'leg': 0.55, 'neck': 0.6, 'head': 0.0, 'hand': 0.0, 'foot': 0.0}[part]
        if w > 0: vg_soft.add([v.index], w, 'REPLACE')
        de = min((p - eye_l).length, (p - eye_r).length)
        if de < 0.03 and p.y < eye_mid.y + 0.02: vg_eye.add([v.index], 1.0 - de / 0.03, 'REPLACE')
    m = body.modifiers.new('soft', 'SMOOTH'); m.factor = 0.55; m.iterations = 7; m.vertex_group = '_soft'
    apply_mod(body, m)
    m = body.modifiers.new('eyefill', 'SMOOTH'); m.factor = 1.0; m.iterations = 14; m.vertex_group = '_eye'
    apply_mod(body, m)
    # slimmer, less heroic proportions: shrink chest/arms/shoulders slightly along normals
    me.update()
    for v in me.vertices:
        part = part_of_bone(dominant(v))
        p = body.matrix_world @ v.co
        k = {'torso': 0.010 if p.z > W('spine_02').z else 0.003, 'arm': 0.009, 'leg': 0.002, 'neck': 0.004}.get(part, 0.0)
        if k: v.co = v.co - v.normal * k
    me.update()

    # ---- decimate → hi / lo
    def decimated(target_tris, name):
        select_only([body])
        bpy.ops.object.duplicate()
        o = bpy.context.active_object
        o.name = name; o.data.name = name
        vg = o.vertex_groups.new(name='_ext')
        for v in o.data.vertices:
            part = part_of_bone(dominant(v))
            if part in ('hand', 'foot'): vg.add([v.index], 1.0, 'REPLACE')
        tris = lambda: sum(len(p.vertices) - 2 for p in o.data.polygons)
        ext = sum(1 for v in o.data.vertices if part_of_bone(dominant(v)) in ('hand', 'foot')) / max(1, len(o.data.vertices))
        # pass 1: hands & feet only (fingers/toes are over-dense for our budget)
        mm = o.modifiers.new('dec1', 'DECIMATE'); mm.ratio = max(0.05, 1.0 - ext * 0.75); mm.use_collapse_triangulate = True; mm.vertex_group = '_ext'
        apply_mod(o, mm)
        # pass 2: uniform to the target budget
        r = min(1.0, target_tris / max(1, tris()))
        mm = o.modifiers.new('dec2', 'DECIMATE'); mm.ratio = r; mm.use_collapse_triangulate = True
        apply_mod(o, mm)
        for g in list(o.vertex_groups):
            if g.name.startswith('_'): o.vertex_groups.remove(g)
        return o
    hi = decimated(4600, 'body_hi')
    lo = decimated(1500, 'body_lo')
    bpy.data.objects.remove(body, do_unlink=True)

    # ---- UVs (atlas layout) + _FAT attribute
    def layout_uvs(o, force_part=None):
        me = o.data
        vgn = {g.index: g.name for g in o.vertex_groups}
        def dom(v):
            best, bw = None, -1
            for g in v.groups:
                n = vgn.get(g.group)
                if n and not n.startswith('_') and g.weight > bw: best, bw = n, g.weight
            return best or 'pelvis'
        vdom = [dom(v) for v in me.vertices]
        while len(me.uv_layers): me.uv_layers.remove(me.uv_layers[0])
        uvl = me.uv_layers.new(name='BODY')
        if '_FAT' in me.attributes: me.attributes.remove(me.attributes['_FAT'])
        fat = me.attributes.new('_FAT', 'FLOAT', 'POINT')
        mw = o.matrix_world
        P = [mw @ v.co for v in me.vertices]
        for v in me.vertices:
            p = P[v.index]; bn = vdom[v.index]; part = part_of_bone(bn)
            y = yref(p.z)
            front = max(0.0, -p.y / 0.15)
            f = {'torso': 0.55 + 0.45 * smooth(0.0, 1.0, front) * smooth(1.32, 1.05, y) * smooth(0.85, 0.98, y), 'leg': 0.55 * smooth(0.3, 0.85, y) + 0.2,
                 'arm': 0.4, 'neck': 0.35, 'head': 0.18 * smooth(1.68, 1.6, y), 'hand': 0.05, 'foot': 0.03}.get(part, 0.2)
            fat.data[v.index].value = f
        for poly in me.polygons:
            # part of the face = majority of dominant bones of its vertices
            cnt = {}
            for vi in poly.vertices:
                pt = force_part or part_of_bone(vdom[vi])
                cnt[pt] = cnt.get(pt, 0) + 1
            part = max(cnt, key=cnt.get)
            sides = [side_of_bone(vdom[vi]) for vi in poly.vertices]
            sd = 1 if sum(sides) >= 0 else -1
            cen = sum((P[vi] for vi in poly.vertices), Vector()) / len(poly.vertices)
            if part in ('arm', 'hand', 'leg', 'foot'):
                sd = 1 if cen.x >= 0 else -1
            uvs = []
            for li in poly.loop_indices:
                p = P[me.loops[li].vertex_index]
                if part in ('torso', 'neck'):
                    th = math.atan2(p.x, -(p.y - 0.01))
                    s = 0.5 + th / (2 * math.pi)
                    t = torsoT(yref(p.z)) if part == 'torso' else neckT(yref(p.z))
                elif part == 'arm':
                    ax = p.x * sd
                    d = interp(dmap, ax)
                    th = math.atan2(-(p.y - 0.068), (p.z - W('upperarm_l').z))
                    s = 0.5 + th / (2 * math.pi); t = armT(d)
                elif part == 'hand':
                    ax = p.x * sd
                    d = interp(hmap, ax)
                    th = math.atan2(-(p.y - 0.06), (p.z - W('hand_l').z))
                    s = 0.5 + th / (2 * math.pi); t = handT(d)
                elif part == 'leg':
                    lx = W('thigh_l').x * sd
                    th = math.atan2((p.x - lx) * sd, -(p.y - 0.04))
                    s = 0.5 + th / (2 * math.pi); t = legT(yref(p.z))
                elif part == 'foot':
                    fx = W('foot_l').x * sd
                    fz = 0.035
                    th = math.atan2((p.x - fx) * sd, (p.z - fz))
                    s = 0.5 + th / (2 * math.pi)
                    fwd = (ank.y - p.y) / max(0.05, foot_len) * 0.245
                    t = footT(fwd)
                else:  # head
                    hy = head_c.y
                    phi = math.degrees(math.atan2(cen.x, -(cen.y - hy)))
                    if abs(phi) <= 105:
                        u_img = 0.5 + p.x / (iod / 0.28)
                        v_img = 0.44 + (eye_mid.z - p.z) / (iod / 0.28)
                        uvs.append(('face', u_img, v_img)); continue
                    ph = math.degrees(math.atan2(p.x, -(p.y - hy)))
                    if ph < 0: ph += 360
                    s = (ph - 105) / 150.0
                    ry = yref(p.z) - 1.555
                    t = (SCALP_TOP - ry) / (SCALP_TOP - SCALP_BOT)
                    uvs.append(('scalp', s, t)); continue
                uvs.append((part, s, t))
            # fix the wrap seam inside a face (u jumping 0 ↔ 1)
            if part in ('torso', 'neck', 'arm', 'hand', 'leg', 'foot'):
                ss = [u[1] for u in uvs]
                if max(ss) - min(ss) > 0.5:
                    uvs = [(u[0], u[1] + 1.0 if u[1] < 0.5 else u[1], u[2]) for u in uvs]
                    uvs = [(u[0], min(1.0, u[1]), u[2]) for u in uvs]
            for li, (reg, s, t) in zip(poly.loop_indices, uvs):
                u, vv = ruv(reg, s, t)
                uvl.data[li].uv = (u, 1.0 - vv)  # Blender uv origin is bottom-left; exporter flips
        return vdom
    layout_uvs(hi); layout_uvs(lo)

    # ---- metrics for shells
    def part_y_arm(o):
        me = o.data; mw = o.matrix_world
        vgn = {g.index: g.name for g in o.vertex_groups}
        info = []
        for v in me.vertices:
            best, bw = 'pelvis', -1
            for g in v.groups:
                n = vgn.get(g.group)
                if n and g.weight > bw: best, bw = n, g.weight
            p = mw @ v.co
            info.append((part_of_bone(best), yref(p.z), interp(dmap, abs(p.x)), p))
        return info

    zof = lambda yr: interp([(b, a) for a, b in zmap], yr)
    xof = lambda d: interp([(b, a) for a, b in dmap], d)

    def make_shell(name, src, zlo, zhi, xin=None, xout=None, off=0.01, rim=0.004, off_waist=None):
        """slab of the body between planes (clean hems), pushed out along normals"""
        select_only([src]); bpy.ops.object.duplicate()
        o = bpy.context.active_object; o.name = name; o.data.name = name
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.normal_update()
        nrm = {v.index: v.normal.copy() for v in bm.verts}
        for v in bm.verts:
            k = off
            if off_waist is not None: k = off + (off_waist - off) * smooth(0.84, 0.94, yref((src.matrix_world @ v.co).z))
            v.co = v.co + v.normal * k
        cuts = []
        if zlo is not None: cuts.append(((0, 0, zlo), (0, 0, 1)))
        if zhi is not None: cuts.append(((0, 0, zhi), (0, 0, 1)))
        for xv in (xin, xout):
            if xv is not None: cuts += [((xv, 0, 0), (1, 0, 0)), ((-xv, 0, 0), (1, 0, 0))]
        for co, no in cuts:
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=0.0005)
        def keep(f):
            c = f.calc_center_median()
            if zlo is not None and c.z < zlo: return False
            if zhi is not None and c.z > zhi: return False
            ax = abs(c.x)
            if xin is not None and ax < xin: return False
            if xout is not None and ax > xout: return False
            return True
        kill = [f for f in bm.faces if not keep(f)]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(o.data); bm.free()
        if rim and len(o.data.polygons):
            mm = o.modifiers.new('rim', 'SOLIDIFY'); mm.thickness = rim; mm.offset = -1; mm.use_rim = True; mm.use_rim_only = True
            apply_mod(o, mm)
        return o

    shells = []
    z_neck = zof(1.435)
    sh_edge = sh_x + 0.05
    TOPS = {'u': (0.86, 0.012), 't': (0.975, 0.009), 'l': (0.82, 0.022), 'j': (0.78, 0.03)}
    for key, (hem, off) in TOPS.items():
        shells.append(make_shell('shell_top_' + key, hi, zof(hem), z_neck, None, sh_edge, off))
    SLEEVES = {'cap': 0.065, 'short': 0.15, 'rolled': 0.335, 'long': 0.535}
    for key, end in SLEEVES.items():
        so = 0.013 if key in ('short', 'cap') else 0.009
        shells.append(make_shell('shell_sleeve_' + key, hi, zof(1.2), None, sh_x - 0.03, xof(end), so))
    BOTS = {'shorts': (0.66, 0.02), 'knee': (0.52, 0.026), 'trousers': (0.05, 0.011), 'loose': (0.07, 0.03)}
    for key, (hem, off) in BOTS.items():
        shells.append(make_shell('shell_bot_' + key, hi, zof(hem), zof(1.0), None, sh_x - 0.03, off, off_waist=0.005))
    shells.append(make_shell('shell_shoe', hi, None, zof(0.125), None, None, 0.008, rim=0.0))
    for o in shells: layout_uvs(o)

    # ---- measured tables for the JS generators (three.js frame: y up, z forward)
    HV = [hi.matrix_world @ v.co for v in hi.data.vertices]
    HP = [part_y_arm(hi)[i][0] for i in range(len(HV))] if False else None
    def radii_at(z, yc, angles, rmax=0.5, band=0.018, xlim=None):
        out = []
        for a in angles:
            ar = math.radians(a)
            best = 0.0
            for p in HV:
                if abs(p.z - z) > band: continue
                if xlim is not None and abs(p.x) > xlim: continue
                dx, dy = p.x, -(p.y - yc)
                r = math.hypot(dx, dy)
                if r > rmax or r < 1e-4: continue
                ang = math.atan2(abs(dx), dy)
                if abs(ang - ar) < math.radians(16): best = max(best, r)
            out.append(round(best, 4))
        return out
    torso_tab = []
    for yr in [0.8, 0.84, 0.88, 0.92, 0.96, 1.0, 1.05, 1.1, 1.16, 1.22, 1.27, 1.31, 1.35, 1.39, 1.42, 1.445, 1.47, 1.49]:
        z = zof(yr)
        xl = sh_x - 0.01 if yr > 1.3 else (0.3 if yr > 0.9 else 0.22)
        fy = [p.y for p in HV if abs(p.z - z) < 0.018 and abs(p.x) < 0.05]
        yc = (max(fy) + min(fy)) * 0.5 if fy else 0.0
        rr = radii_at(z, yc, [0, 45, 90, 135, 180], 0.45, 0.018, xl)
        torso_tab.append([yr] + rr + [round(-yc, 4)])
    neck_tab = []
    for yr in [1.43, 1.46, 1.5, 1.54, 1.58]:
        z = zof(yr)
        fy = [p.y for p in HV if abs(p.z - z) < 0.012 and abs(p.x) < 0.03]
        yc = (max(fy) + min(fy)) * 0.5 if fy else 0.0
        neck_tab.append([yr] + radii_at(z, yc, [0, 45, 90, 135, 180], 0.12, 0.012, 0.12) + [round(-yc, 4)])

    # ---- skirts / wraps (cones with weights transferred from the body)
    def make_skirt(name, hem, flare, narrow=0.0):
        waist = None
        # waist height in blender z for yref 1.0
        zs = [z for z in [i * 0.002 for i in range(200, 700)] if abs(yref(z) - 1.0) < 0.003]
        z_w = zs[len(zs) // 2] if zs else W('pelvis').z + 0.05
        zh = [z for z in [i * 0.002 for i in range(0, 700)] if abs(yref(z) - hem) < 0.003]
        z_h = zh[len(zh) // 2] if zh else 0.45
        # body cross-section radius at hips
        bvh = BVHTree.FromObject(hi, bpy.context.evaluated_depsgraph_get())
        n = 20; rings = 9
        bm = bmesh.new()
        rows = []
        for r in range(rings):
            k = r / (rings - 1)
            z = z_w + (z_h - z_w) * (k ** 0.85)
            row = []
            for j in range(n):
                a = 2 * math.pi * j / n
                d = Vector((math.sin(a), -math.cos(a), 0.0))
                # cast inward from outside to find the body surface
                hit = bvh.ray_cast(Vector((0, 0.01, z)) + d * 0.6, -d, 0.7)
                rad = (0.6 - hit[3]) if hit[0] is not None else 0.16
                z_ref = yref(z)
                below = smooth(0.92, 0.8, z_ref)
                legs_w = 0.185 if abs(math.sin(a)) > 0.5 else 0.13
                rad = max(rad, legs_w * below) + 0.018 + flare * k - narrow * smooth(0.6, hem, z_ref) * abs(math.sin(a))
                row.append(bm.verts.new(Vector((0, 0.01, z)) + d * rad))
            rows.append(row)
        for r in range(rings - 1):
            for j in range(n):
                a, b, c, dd = rows[r][j], rows[r][(j + 1) % n], rows[r + 1][(j + 1) % n], rows[r + 1][j]
                bm.faces.new((a, b, c, dd))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
        o = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(o)
        o.parent = arm
        for g in hi.vertex_groups: o.vertex_groups.new(name=g.name)
        dt = o.modifiers.new('wt', 'DATA_TRANSFER'); dt.object = hi; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
        dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
        apply_mod(o, dt)
        mm = o.modifiers.new('rim', 'SOLIDIFY'); mm.thickness = 0.006; mm.offset = -1; mm.use_rim = True; mm.use_rim_only = True
        apply_mod(o, mm)
        am = o.modifiers.new('arm', 'ARMATURE'); am.object = arm
        # uv: skirt region
        me = o.data
        uvl = me.uv_layers.new(name='BODY')
        fat = me.attributes.new('_FAT', 'FLOAT', 'POINT')
        for v in me.vertices: fat.data[v.index].value = 0.4
        for poly in me.polygons:
            ss = []
            for li in poly.loop_indices:
                p = me.vertices[me.loops[li].vertex_index].co
                th = math.atan2(p.x, -(p.y - 0.01)); s = 0.5 + th / (2 * math.pi)
                t = (z_w - p.z) / max(0.05, (z_w - z_h))
                ss.append((s, t))
            if max(s for s, _ in ss) - min(s for s, _ in ss) > 0.5: ss = [(min(1.0, s + 1.0) if s < 0.5 else s, t) for s, t in ss]
            for li, (s, t) in zip(poly.loop_indices, ss):
                u, vv = ruv('skirt', s, t); uvl.data[li].uv = (u, 1.0 - vv)
        return o
    skirts = [make_skirt('skirt_knee', 0.47, 0.05), make_skirt('skirt_wrap', 0.08, 0.0, 0.03), make_skirt('skirt_wrapknee', 0.45, 0.01)]

    # ---- head table (three.js frame relative to the Head bone): rows ry, cz, r(0..180 step 22.5)
    hb = W('Head')
    table = []
    for i in range(16):
        ry = -0.03 + i * (0.26 / 15)
        z = hb.z + ry
        fy = [p.y for p in HV if abs(p.z - z) < 0.01 and abs(p.x) < 0.02]
        yc = (max(fy) + min(fy)) * 0.5 if fy else head_c.y
        rs = radii_at(z, yc, [k * 22.5 for k in range(9)], 0.16, 0.01, 0.13)
        table.append([round(ry, 4), round(-yc - (-hb.y), 4)] + rs)

    # ---- export GLB
    for o in [hi, lo] + shells + skirts:
        o.parent = arm
        if not any(m.type == 'ARMATURE' for m in o.modifiers):
            am = o.modifiers.new('arm', 'ARMATURE'); am.object = arm
        o.data.materials.clear()
    objs = [arm, hi, lo] + shells + skirts
    select_only(objs)
    out = os.path.join(OUT, f'body_{sex}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False, export_skins=True,
                              export_attributes=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='NONE',
                              export_morph=False, export_apply=False)
    to3 = lambda v: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
    info = {
        'sex': sex, 'height': round(top_z, 4), 'eyes': [to3(eye_l), to3(eye_r)], 'iod': round(iod, 4),
        'bones': {n: to3(W(n)) for n in B.keys()}, 'zmap': [[round(a, 4), b] for a, b in zmap], 'headTable': table,
        'headCenterZ': round(-head_c.y, 4), 'torsoTable': torso_tab, 'neckTable': neck_tab,
        'armMap': [[round(a, 4), b] for a, b in dmap], 'tris': {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in [hi, lo] + shells + skirts},
    }
    json.dump(info, open(os.path.join(OUT, f'body_{sex}.json'), 'w'), indent=1)
    print('BUILT', out, info['tris'])

def build_anims():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=UAL_GLB)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    for o in list(bpy.data.objects):
        if o.type == 'MESH': bpy.data.objects.remove(o, do_unlink=True)
    select_only([arm])
    out = os.path.join(OUT, 'anims.glb')
    kw = dict(filepath=out, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
              export_skins=True, export_yup=True, export_materials='NONE', export_frame_step=1, export_force_sampling=True)
    try: bpy.ops.export_scene.gltf(**kw, export_reset_pose_bones=True)
    except TypeError: bpy.ops.export_scene.gltf(**kw)
    print('BUILT', out)

bd = os.path.join(UBC_DIR, 'Base Characters', 'Godot - UE')
build_body(os.path.join(bd, 'Superhero_Male_FullBody.gltf'), 'm')
build_body(os.path.join(bd, 'Superhero_Female_FullBody.gltf'), 'f')
build_anims()
