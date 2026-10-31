"""
Shared headless-Blender toolkit for the custom Thai models of the asset library (docs/ART_STYLE.md §2, §10).

Pipeline for every model (run a builder with `python3 scripts/thai/build.py <name> [...]`):
  1. model with real dimensions (metres, Blender Z up, FRONT FACES -Y = +Z in glTF), bevelled, every small part;
  2. tiling PBR photo materials (public/assets/textures/pbr, textures/props, img/labels) on explicit metre UVs, with a
     weathering layer (crevice dirt from the AO node, edge wear from pointiness, water streaks, grime noise);
  3. everything is joined and baked (Cycles CPU) onto ONE atlas: albedo (× soft AO), ORM (AO, roughness, metal),
     tangent normal — so each model is a single material / draw call;
  4. glass and other see-through parts stay on a small shared non-baked material ("glass");
  5. origin bottom centre, export GLB → scripts/libpub.py optimises (meshopt + WebP) and writes the catalog entry.
"""
import bpy, bmesh, math, os, random, json, time
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = os.path.join(ROOT, 'public/assets/textures')
IMG = os.path.join(ROOT, 'public/assets/img')
WORK = os.path.join(ROOT, 'scripts/_cache/thai')
PI = math.pi


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 16
    s.render.bake.margin = 6
    s.render.threads_mode = 'FIXED'
    s.render.threads = 3
    # world for AO bake (no influence on DIFFUSE/COLOR bakes)
    w = bpy.data.worlds.new('w'); s.world = w
    return s


def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def mesh_obj(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    if mat: o.data.materials.append(mat)
    return o


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_mods(o):
    select_only([o])
    for m in list(o.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e: print('modifier apply failed', o.name, m.name, e); o.modifiers.remove(m)


def apply_xform(o):
    select_only([o])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def smooth(o, angle=35):
    me = o.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))


def bevel(o, w=0.004, segs=2, angle=40, harden=True):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = w; m.segments = segs; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
    m.harden_normals = harden; m.miter_outer = 'MITER_ARC'
    return m


def solidify(o, t, offset=-1):
    m = o.modifiers.new('solid', 'SOLIDIFY'); m.thickness = t; m.offset = offset; m.use_even_offset = True
    return m


def subsurf(o, lv=1):
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = lv; m.render_levels = lv
    return m


def finish(o, bev=0.004, segs=2, angle=40, sm=35, sub=0):
    """bevel + apply + smooth-by-angle + metre box UVs"""
    if sub: subsurf(o, sub)
    if bev: bevel(o, bev, segs, angle)
    apply_mods(o)
    smooth(o, sm)
    if not o.data.uv_layers: uv_box(o)
    return o


def xf(o, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    o.location = loc; o.rotation_euler = rot
    if scale is not None: o.scale = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    apply_xform(o)
    return o


def dup(o, name=None, loc=None, rot=None, scale=None, link_data=False):
    n = o.copy()
    if not link_data: n.data = o.data.copy()
    n.name = name or o.name + '.d'
    link(n)
    n.location = loc if loc is not None else (0, 0, 0)
    n.rotation_euler = rot if rot is not None else (0, 0, 0)
    if scale is not None: n.scale = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    apply_xform(n)
    return n


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    select_only(objs)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    if name: o.name = name; o.data.name = name
    return o


# ------------------------------------------------------------------ UVs
def uv_box(o, k=1.0, name='UVMap'):
    """planar per-face box projection in object metres (correct tangent frames per face; o must have identity transform)"""
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get(name) or bm.loops.layers.uv.new(name)
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0: u, v = (c.y if n.x > 0 else -c.y), c.z
            elif ax == 1: u, v = (-c.x if n.y > 0 else c.x), c.z
            else: u, v = c.x, (c.y if n.z > 0 else -c.y)
            l[uvl].uv = (u * k, v * k)
    bm.to_mesh(me); bm.free()


def uv_cyl(o, axis='Z', k=1.0, name='UVMap'):
    """cylindrical projection (u = arc length at the mean radius, v = height), with a seam fix"""
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get(name) or bm.loops.layers.uv.new(name)
    rs = [math.hypot(v.co.x, v.co.y) for v in bm.verts]
    R = max(1e-3, sum(rs) / max(1, len(rs)))
    for f in bm.faces:
        if abs(f.normal.z) > 0.85:   # caps: planar
            for l in f.loops: l[uvl].uv = (l.vert.co.x * k, l.vert.co.y * k)
            continue
        us = [math.atan2(l.vert.co.y, l.vert.co.x) for l in f.loops]
        if max(us) - min(us) > PI: us = [u + 2 * PI if u < 0 else u for u in us]
        for l, a in zip(f.loops, us): l[uvl].uv = (a * R * k, l.vert.co.z * k)
    bm.to_mesh(me); bm.free()


# ------------------------------------------------------------------ geometry builders
def lathe(name, prof, segs=48, mat=None, k=1.0, arc=2 * PI, cap=False):
    """revolve (r, z) profile points around Z. Profile runs around the solid cross-section so normals face out
    (bottom→top on the outside). UVs: u = angle × max radius, v = profile length (metres × k)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    full = abs(arc - 2 * PI) < 1e-6
    n = segs if full else segs + 1
    rings = []
    for s in range(n):
        a = arc * s / segs
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in prof])
    vs = [0.0]
    for i in range(1, len(prof)): vs.append(vs[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    uR = max(p[0] for p in prof)
    for s in range(segs):
        r0, r1 = rings[s], rings[(s + 1) % n]
        u0, u1 = arc * s / segs * uR, arc * (s + 1) / segs * uR
        for i in range(len(prof) - 1):
            vv = [r0[i], r1[i], r1[i + 1], r0[i + 1]]
            uv = [(u0, vs[i]), (u1, vs[i]), (u1, vs[i + 1]), (u0, vs[i + 1])]
            # drop duplicate (pole) verts
            q = [(v, t) for j, (v, t) in enumerate(zip(vv, uv)) if v not in [w for w, _ in zip(vv[:j], uv[:j])]]
            if len(q) < 3: continue
            try: f = bm.faces.new([v for v, _ in q])
            except ValueError: continue
            for l, (_, t) in zip(f.loops, q): l[uvl].uv = (t[0] * k, t[1] * k)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if cap:
        bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bm.normal_update()
    return mesh_obj(name, bm, mat)


def rbox(name, sx, sy, sz, loc=(0, 0, 0), mat=None, bev=0.006, segs=2, rot=(0, 0, 0)):
    """box sized (sx, sy, sz) with its BOTTOM at loc.z, bevelled"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + sz / 2))
    o = mesh_obj(name, bm, mat)
    o.rotation_euler = rot; o.location = loc
    apply_xform(o)
    if bev: bevel(o, min(bev, min(sx, sy, sz) * 0.45), segs, 30)
    apply_mods(o); smooth(o, 30); uv_box(o)
    return o


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, segs=24, bev=0.003, r2=None):
    """capped cylinder / frustum along local Z from 0..h, then rotated & moved"""
    r2 = r if r2 is None else r2
    b = min(bev, r * 0.4, h * 0.4)
    prof = [(1e-5, 0), (r - b, 0), (r, b), (r2, h - b), (r2 - b, h), (1e-5, h)] if b > 0 else [(1e-5, 0), (r, 0), (r2, h), (1e-5, h)]
    o = lathe(name, prof, segs, mat)
    o.rotation_euler = rot; o.location = loc
    apply_xform(o); smooth(o, 40)
    return o


def tube(name, pts, r, mat=None, res=8, closed=False, segs=6, caps=True):
    """round tube through 3D points (polyline with rounded corners via NURBS-ish Bezier auto handles)"""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = max(1, res // 4); cu.resolution_u = segs
    cu.use_fill_caps = caps
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts): p.co = (c[0], c[1], c[2], 1)
    sp.use_cyclic_u = closed
    o = link(bpy.data.objects.new(name, cu))
    select_only([o])
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    if mat: o.data.materials.clear(); o.data.materials.append(mat)
    smooth(o, 50); uv_box(o)
    return o


def bent_tube(name, pts, r, bend=0.03, mat=None, sides=8):
    """tube through points with rounded (filleted) corners of radius `bend` — welded steel frames"""
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d0 = (b - a); d1 = (c - b)
        L0, L1 = d0.length, d1.length
        d0.normalize(); d1.normalize()
        t = min(bend, L0 * 0.45, L1 * 0.45)
        p0, p1 = b - d0 * t, b + d1 * t
        for k in range(7):
            s = k / 6
            q = (1 - s) ** 2 * p0 + 2 * (1 - s) * s * b + s * s * p1
            out.append(q)
    out.append(P[-1])
    return tube(name, [tuple(v) for v in out], r, mat, res=sides, segs=1)


def plane_grid(name, sx, sy, nx, ny, mat=None):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    for v in bm.verts: v.co.x *= sx; v.co.y *= sy
    return mesh_obj(name, bm, mat)


def displace_noise(o, amt=0.003, scale=0.1, seed=0):
    """small organic irregularity (hand-made / moulded things are never perfect)"""
    rnd = random.Random(seed)
    tx = bpy.data.textures.new(o.name + '_n', 'CLOUDS'); tx.noise_scale = scale
    m = o.modifiers.new('disp', 'DISPLACE'); m.texture = tx; m.strength = amt; m.mid_level = 0.5
    m.texture_coords = 'GLOBAL'
    apply_mods(o)
    return o


# ------------------------------------------------------------------ materials
_img_cache = {}
def img(path, srgb=True):
    key = (path, srgb)
    if key in _img_cache: return _img_cache[key]
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    _img_cache[key] = im
    return im


def _nodes(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    return m, nt, bsdf


def _tex_node(nt, image, vec, interp='Linear', ext='REPEAT'):
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = image; t.interpolation = interp; t.extension = ext
    nt.links.new(vec, t.inputs['Vector'])
    return t


def weather(nt, col_socket, dirt=0.5, wear=0.0, streak=0.0, grime=0.25, dirt_col=(0.16, 0.12, 0.08), wear_col=None, seed=0.0):
    """insert a weathering stack after a colour socket; returns the new colour socket.
    dirt: crevice dirt (AO node), wear: bright worn edges (pointiness), streak: vertical water stains, grime: blotchy noise."""
    L = nt.links.new
    out = col_socket
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if grime > 0:
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.0; nz.inputs['Detail'].default_value = 8
        nz.noise_dimensions = '4D'; nz.inputs['W'].default_value = seed
        L(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[1].position = 0.75
        L(nz.outputs['Fac'], ramp.inputs['Fac'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = grime
        L(ramp.outputs['Color'], mul.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs['B'].default_value = (*[c * 2.2 for c in dirt_col], 1)
        L(mul.outputs[0], mix.inputs['Factor']); L(out, mix.inputs['A']); out = mix.outputs['Result']
    if streak > 0:
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 14, 0.6)
        L(tc.outputs['Object'], mp.inputs['Vector'])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.5; nz.inputs['Detail'].default_value = 4
        nz.noise_dimensions = '4D'; nz.inputs['W'].default_value = seed + 3
        L(mp.outputs['Vector'], nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.5; ramp.color_ramp.elements[1].position = 0.8
        L(nz.outputs['Fac'], ramp.inputs['Fac'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = streak
        L(ramp.outputs['Color'], mul.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs['B'].default_value = (*[c * 2.6 for c in dirt_col], 1)
        L(mul.outputs[0], mix.inputs['Factor']); L(out, mix.inputs['A']); out = mix.outputs['Result']
    if dirt > 0:
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.04; ao.samples = 16
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        L(ao.outputs['AO'], inv.inputs[1])
        pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 0.7
        L(inv.outputs[0], pw.inputs[0])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = dirt; mul.use_clamp = True
        L(pw.outputs[0], mul.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MIX'
        mix.inputs['B'].default_value = (*dirt_col, 1)
        L(mul.outputs[0], mix.inputs['Factor']); L(out, mix.inputs['A']); out = mix.outputs['Result']
    if wear > 0:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.52; ramp.color_ramp.elements[1].position = 0.62
        L(geo.outputs['Pointiness'], ramp.inputs['Fac'])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 18; nz.inputs['Detail'].default_value = 6
        L(tc.outputs['Object'], nz.inputs['Vector'])
        m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
        L(ramp.outputs['Color'], m2.inputs[0]); L(nz.outputs['Fac'], m2.inputs[1])
        m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'; m3.inputs[1].default_value = wear * 2; m3.use_clamp = True
        L(m2.outputs[0], m3.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'SCREEN' if wear_col is None else 'MIX'
        mix.inputs['B'].default_value = (*(wear_col or (0.45, 0.42, 0.38)), 1)
        L(m3.outputs[0], mix.inputs['Factor']); L(out, mix.inputs['A']); out = mix.outputs['Result']
    return out


def pbr(name, tex=None, tile=1.0, color=None, rough=None, rough_mul=1.0, metal=None, nstr=1.0, tint=None,
        files=None, w=None, emissive=None):
    """photo PBR material. tex = folder in textures/pbr (albedo/normal/orm) or files={'albedo','normal','orm','rough'}
    (absolute or textures/-relative). tile = metres per texture repeat. color = flat base colour if no texture.
    tint = multiply colour. w = weather kwargs dict."""
    m, nt, bsdf = _nodes(name)
    L = nt.links.new
    f = dict(files or {})
    if tex:
        d = os.path.join(TEX, 'pbr', tex)
        f.setdefault('albedo', os.path.join(d, 'albedo.jpg'))
        if os.path.exists(os.path.join(d, 'normal.jpg')): f.setdefault('normal', os.path.join(d, 'normal.jpg'))
        if os.path.exists(os.path.join(d, 'orm.jpg')): f.setdefault('orm', os.path.join(d, 'orm.jpg'))
    f = {k: (v if os.path.isabs(v) else os.path.join(TEX, v)) for k, v in f.items()}
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    mp = nt.nodes.new('ShaderNodeMapping'); s = 1.0 / tile; mp.inputs['Scale'].default_value = (s, s, s)
    L(uvn.outputs['UV'], mp.inputs['Vector'])
    vec = mp.outputs['Vector']
    col = None
    if 'albedo' in f:
        col = _tex_node(nt, img(f['albedo']), vec).outputs['Color']
    if color is not None:
        if col is None:
            rgb = nt.nodes.new('ShaderNodeRGB'); rgb.outputs[0].default_value = (*color, 1); col = rgb.outputs[0]
    if tint is not None and col is not None:
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        mx.inputs['B'].default_value = (*tint, 1); L(col, mx.inputs['A']); col = mx.outputs['Result']
    if col is not None:
        if w: col = weather(nt, col, **w)
        L(col, bsdf.inputs['Base Color'])
    if 'orm' in f:
        o = _tex_node(nt, img(f['orm'], False), vec)
        sep = nt.nodes.new('ShaderNodeSeparateColor'); L(o.outputs['Color'], sep.inputs['Color'])
        if rough is None:
            rm = nt.nodes.new('ShaderNodeMath'); rm.operation = 'MULTIPLY'; rm.inputs[1].default_value = rough_mul; rm.use_clamp = True
            L(sep.outputs['Green'], rm.inputs[0]); L(rm.outputs[0], bsdf.inputs['Roughness'])
        if metal is None: L(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    elif 'rough' in f and rough is None:
        r = _tex_node(nt, img(f['rough'], False), vec)
        rm = nt.nodes.new('ShaderNodeMath'); rm.operation = 'MULTIPLY'; rm.inputs[1].default_value = rough_mul; rm.use_clamp = True
        L(r.outputs['Color'], rm.inputs[0]); L(rm.outputs[0], bsdf.inputs['Roughness'])
    if rough is not None: bsdf.inputs['Roughness'].default_value = rough
    if metal is not None: bsdf.inputs['Metallic'].default_value = metal
    if 'normal' in f:
        n = _tex_node(nt, img(f['normal'], False), vec)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; nm.inputs['Strength'].default_value = nstr
        L(n.outputs['Color'], nm.inputs['Color']); L(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emissive is not None:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1); bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


def label_mat(name, path, rough=0.35, metal=0.0, w=None, clamp=True, alpha=False, tint=None):
    """a printed label / photo decal mapped 0..1 on UVMap (no tiling)"""
    m, nt, bsdf = _nodes(name)
    L = nt.links.new
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    t = _tex_node(nt, img(path if os.path.isabs(path) else os.path.join(ROOT, 'public/assets', path)), uvn.outputs['UV'], ext='EXTEND' if clamp else 'REPEAT')
    col = t.outputs['Color']
    if tint is not None:
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        mx.inputs['B'].default_value = (*tint, 1); L(col, mx.inputs['A']); col = mx.outputs['Result']
    if w: col = weather(nt, col, **w)
    L(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    if alpha:
        m['alpha_from'] = 1
        L(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    return m


def flat(name, color, rough=0.5, metal=0.0, w=None, noise=0.08):
    """plain painted / moulded colour with a little tonal noise (never perfectly flat)"""
    m, nt, bsdf = _nodes(name)
    L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; nz.inputs['Detail'].default_value = 6
    L(tc.outputs['Object'], nz.inputs['Vector'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'OVERLAY'; mx.inputs['Factor'].default_value = noise
    mx.inputs['A'].default_value = (*color, 1); L(nz.outputs['Color'], mx.inputs['B'])
    col = mx.outputs['Result']
    if w: col = weather(nt, col, **w)
    L(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    return m


def glass_mat(name='glass', color=(0.85, 0.9, 0.88), alpha=0.22, rough=0.06):
    """the one non-baked see-through material (exported as alpha BLEND)"""
    m, nt, bsdf = _nodes(name)
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Alpha'].default_value = alpha
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    m['nobake'] = 1
    return m


# ------------------------------------------------------------------ bake + export
def _set_active_image(objs, image):
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.get('nobake'): continue
            nt = m.node_tree
            n = nt.nodes.get('__bake__')
            if not n:
                n = nt.nodes.new('ShaderNodeTexImage'); n.name = '__bake__'
                uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'bake'; nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
            n.image = image
            nt.nodes.active = n
            n.select = True


def _emit_swap(objs, what):
    """temporarily route a Principled input (Metallic / Alpha) to an emission output for an EMIT bake"""
    saved = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.get('nobake'): continue
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
            em = nt.nodes.new('ShaderNodeEmission'); em.name = '__emit__'
            inp = bsdf.inputs[what]
            if inp.links: nt.links.new(inp.links[0].from_socket, em.inputs['Color'])
            else:
                v = inp.default_value
                em.inputs['Color'].default_value = tuple(v)[:3] + (1,) if hasattr(v, '__len__') else (v, v, v, 1)
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            saved.append((nt, out, old, em))
    return saved


def _emit_restore(saved):
    for nt, out, old, em in saved:
        if old: nt.links.new(old, out.inputs['Surface'])
        nt.nodes.remove(em)


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate_copy(o, target):
    """low-poly copy (collapse decimation, silhouette kept) for high→low baking"""
    low = o.copy(); low.data = o.data.copy(); low.name = o.name + '_low'; link(low)
    t = tri_count(low)
    if t > target:
        m = low.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = max(0.02, target / t)
        m.use_collapse_triangulate = False
        apply_mods(low)
    # planar cleanup of what is left
    if tri_count(low) > target:
        m = low.modifiers.new('dis', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(2.0)
        apply_mods(low)
    smooth(low, 40)
    return low


def bake_export(name, objs, out_glb, size=1024, ao_samples=24, ao_mix=0.45, margin=None, keep_parts=False, uv_margin=0.004,
                angle=60, lowpoly=None, ray=0.02, alpha=False, origin='bottom'):
    """join + atlas-bake + export (see module doc). lowpoly = triangle target: a decimated copy receives the bake from the
    detailed mesh (normal map keeps the lost detail). Returns (path, size_m)."""
    os.makedirs(WORK, exist_ok=True)
    sc = bpy.context.scene
    objs = [o for o in objs if o and o.type == 'MESH']
    for o in objs:
        if o.modifiers: apply_mods(o)
        if any(abs(s - 1) > 1e-6 for s in o.scale) or o.location.length > 1e-6 or any(abs(r) > 1e-6 for r in o.rotation_euler): apply_xform(o)
        if not o.data.uv_layers: uv_box(o)
        if keep_parts and o.get('part'):
            vg = o.vertex_groups.new(name='part:' + o['part']); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    for o in objs:   # empty slots (boolean operands) → first real material
        slots = [s.material for s in o.material_slots]
        if None in slots and any(slots):
            first = next(i for i, m in enumerate(slots) if m)
            for p in o.data.polygons:
                if slots[p.material_index] is None: p.material_index = first
    nob = [o for o in objs if all(s.material and s.material.get('nobake') for s in o.material_slots) and o.material_slots]
    bak = [o for o in objs if o not in nob]
    # consistent UV layer names
    for o in bak:
        uvs = o.data.uv_layers
        if uvs[0].name != 'UVMap': uvs[0].name = 'UVMap'
        while len(uvs) > 1: uvs.remove(uvs[1])
    high = join(bak, name + '_high')
    s2a = bool(lowpoly) and tri_count(high) > lowpoly * 1.1
    if s2a:
        body = decimate_copy(high, lowpoly)
        body.data.materials.clear()
        bm_ = bpy.data.materials.new(name + '_bk'); bm_.use_nodes = True
        body.data.materials.append(bm_)
        for p in body.data.polygons: p.material_index = 0
        print(f'[low] {name}: {tri_count(high)} → {tri_count(body)} tris')
    else:
        body = high
    body.name = name
    # ---- bake UV
    while len(body.data.uv_layers) > (0 if s2a else 1): body.data.uv_layers.remove(body.data.uv_layers[-1])
    uvb = body.data.uv_layers.new(name='bake')
    body.data.uv_layers.active = uvb
    select_only([body])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=uv_margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try: bpy.ops.uv.pack_islands(margin=uv_margin, rotate=True, shape_method='CONCAVE')
    except Exception as e: print('pack', e)
    bpy.ops.object.mode_set(mode='OBJECT')
    # ---- images
    def newimg(tag, srgb=True, col=(0.5, 0.5, 0.5, 1)):
        im = bpy.data.images.new(f'{name}_{tag}', size, size, alpha=False, float_buffer=False)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        im.generated_color = col
        return im
    I = {'col': bpy.data.images.new(f'{name}_col', size, size, alpha=True), 'nrm': newimg('nrm', False, (0.5, 0.5, 1, 1)), 'rgh': newimg('rgh', False), 'met': newimg('met', False, (0, 0, 0, 1)), 'ao': newimg('ao', False, (1, 1, 1, 1))}
    sc.render.bake.margin = margin if margin is not None else max(4, size // 128)
    sc.render.bake.use_clear = True
    if s2a:
        select_only([body]); high.select_set(True); bpy.context.view_layer.objects.active = body
    else:
        select_only([body])

    def bake(kind, image, **kw):
        _set_active_image([body], image)
        sc.cycles.samples = kw.pop('samples', 1)
        if s2a: kw.update(use_selected_to_active=True, cage_extrusion=ray, max_ray_distance=ray * 2)
        tb = time.time()
        bpy.ops.object.bake(type=kind, uv_layer='bake', **kw)
        print(f'  [bake] {kind} {time.time() - tb:.1f}s', flush=True)

    t0 = time.time()
    sv = _emit_swap([high], 'Base Color'); bake('EMIT', I['col']); _emit_restore(sv)
    bake('ROUGHNESS', I['rgh'])
    bake('NORMAL', I['nrm'], normal_space='TANGENT')
    sv = _emit_swap([high], 'Metallic'); bake('EMIT', I['met']); _emit_restore(sv)
    if alpha:
        I['alp'] = newimg('alp', False, (1, 1, 1, 1))
        sv = _emit_swap([high], 'Alpha'); bake('EMIT', I['alp']); _emit_restore(sv)
    sc.world.color = (1, 1, 1)
    sc.world.light_settings.distance = 0.25 if hasattr(sc.world, 'light_settings') else 0
    bake('AO', I['ao'], samples=ao_samples)
    print(f'[bake] {name}: {size}px in {time.time() - t0:.1f}s, {tri_count(body)} tris')
    # ---- compose albedo×AO and ORM with numpy
    import numpy as np
    def arr(im):
        a = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
        return a
    col, ao, rg, mt = arr(I['col']), arr(I['ao']), arr(I['rgh']), arr(I['met'])
    aoc = np.clip(ao[..., 0], 0, 1)
    soft = 1 - ao_mix * (1 - aoc)
    # col is linear here (Blender converts sRGB images to linear floats in .pixels? no: pixels are in the image colour space)
    col[..., :3] = col[..., :3] * soft[..., None]
    col[..., 3] = arr(I['alp'])[..., 0] if alpha else 1.0
    I['col'].pixels[:] = col.ravel()
    orm = np.stack([aoc, np.clip(rg[..., 0], 0.03, 1), np.clip(mt[..., 0], 0, 1), np.ones_like(aoc)], -1)
    I['orm'] = newimg('orm', False)
    I['orm'].pixels[:] = orm.ravel()
    paths = {}
    for k in ('col', 'nrm', 'orm'):
        p = os.path.join(WORK, f'{name}_{k}.png')
        I[k].filepath_raw = p; I[k].file_format = 'PNG'; I[k].save()
        paths[k] = p
    # ---- final single material
    fm, nt, bsdf = _nodes(name)
    L = nt.links.new
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'bake'
    tc = _tex_node(nt, I['col'], uvn.outputs['UV'], ext='EXTEND'); L(tc.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        L(tc.outputs['Alpha'], bsdf.inputs['Alpha'])
        try: fm.surface_render_method = 'DITHERED'
        except Exception: pass
    to = _tex_node(nt, I['orm'], uvn.outputs['UV'], ext='EXTEND')
    sep = nt.nodes.new('ShaderNodeSeparateColor'); L(to.outputs['Color'], sep.inputs['Color'])
    L(sep.outputs['Green'], bsdf.inputs['Roughness']); L(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    tn = _tex_node(nt, I['nrm'], uvn.outputs['UV'], ext='EXTEND')
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'bake'; L(tn.outputs['Color'], nm.inputs['Color']); L(nm.outputs['Normal'], bsdf.inputs['Normal'])
    # glTF occlusion (R of the ORM)
    g = bpy.data.node_groups.get('glTF Material Output')
    if not g:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g
    L(sep.outputs['Red'], gn.inputs['Occlusion'])
    body.data.materials.clear(); body.data.materials.append(fm)
    for p in body.data.polygons: p.material_index = 0
    if 'UVMap' in body.data.uv_layers: body.data.uv_layers.remove(body.data.uv_layers['UVMap'])
    body.data.uv_layers['bake'].name = 'UVMap'
    if s2a: bpy.data.objects.remove(high)
    nm.uv_map = 'UVMap'; uvn.uv_map = 'UVMap'
    # ---- non-baked parts (glass)
    parts = [body] + nob
    # ---- origin bottom centre
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in parts:
        for v in o.data.vertices:
            for i in range(3): mn[i] = min(mn[i], v.co[i]); mx[i] = max(mx[i], v.co[i])
    # bottom centre; 'back' = wall side (Blender +Y = glTF -Z) at 0 so the model sticks out of the wall along +Z; 'top' = hanging point
    off = Vector((-(mn.x + mx.x) / 2, -mx.y if origin == 'back' else -(mn.y + mx.y) / 2, -mx.z if origin == 'top' else -mn.z))
    for o in parts: o.data.transform(Matrix.Translation(off))
    if keep_parts:
        groups = [vg.name for vg in body.vertex_groups if vg.name.startswith('part:')]
        before = set(bpy.context.scene.objects)
        select_only([body])
        bpy.ops.object.mode_set(mode='EDIT')
        for gname in groups[:-1]:
            bpy.ops.mesh.select_all(action='DESELECT')
            body.vertex_groups.active_index = body.vertex_groups[gname].index
            bpy.ops.object.vertex_group_select()
            bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        def majority(o):
            cnt = {}
            for v in o.data.vertices:
                for g in v.groups:
                    if g.weight > 0.5: cnt[g.group] = cnt.get(g.group, 0) + 1
            return o.vertex_groups[max(cnt, key=cnt.get)].name.split(':', 1)[1] if cnt else None
        for o in [o for o in bpy.context.scene.objects if o not in before] + [body]:
            nm_ = majority(o)
            if nm_:
                o.name = nm_; o.data.name = nm_
            if o is not body: parts.append(o)
    dims = mx - mn
    select_only(parts)
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_image_format='AUTO', export_cameras=False, export_lights=False, export_extras=False)
    print(f'[export] {out_glb}  dims {dims.x:.3f} x {dims.y:.3f} x {dims.z:.3f} m (x, depth, height)')
    return out_glb, (dims.x, dims.z, dims.y)
