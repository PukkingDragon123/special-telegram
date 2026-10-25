"""Thai concrete electricity pole kit (MEA/PEA style) — custom bpy model for the shared library.

  python3 src/modules/world/tools/blender/thai_pole.py <out_dir>

Builds, bakes and exports (GLB, +Y up, origin at the pole foot):
  thai_pole.glb        9 m prestressed square concrete pole with chamfered corners, black/white foot band, step
                       bolts, number plate, bolt-through holes, telecom clamp ring
  thai_pole_arms.glb   galvanised steel crossarm set (1.8 m + 1.4 m arms, braces, bolt plates, 5 porcelain pin
                       insulators) — mounted at the pole top (origin = pole axis at the top of the pole)
Clean low-to-mid-poly shapes with bevelled edges; real PBR photo textures (public/assets/textures/pbr) projected
and baked into one 1024² atlas per model (albedo × baked AO, tangent normal, ORM). Fine detail lives in the maps.
"""
import bpy, bmesh, sys, os, math, mathutils

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else '.'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../..'))
PBR = os.path.join(ROOT, 'public/assets/textures/pbr')
TEX = 1024


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1


def pbr_mat(name, lib, tile, tint=(1, 1, 1, 1), metal=0.0, rough_mul=1.0, stripes=None):
    """material: box-projected photo texture (albedo, normal, ORM roughness), constant metalness"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / tile,) * 3
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    def img(f, srgb):
        t = N.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(PBR, lib, f), check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        t.projection = 'BOX'; t.projection_blend = 0.25
        L.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t
    a = img('albedo.jpg', True)
    col = a.outputs['Color']
    mix = N.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs['Fac'].default_value = 1.0
    mix.inputs['Color2'].default_value = tint
    L.new(col, mix.inputs['Color1']); col = mix.outputs['Color']
    if stripes:
        # painted black/white bands near the foot (paint over the real concrete photo)
        sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sep.inputs['Vector'])
        mth = N.new('ShaderNodeMath'); mth.operation = 'MULTIPLY'; mth.inputs[1].default_value = 1 / stripes[0]
        L.new(sep.outputs['Z'], mth.inputs[0])
        fr = N.new('ShaderNodeMath'); fr.operation = 'FRACT'; L.new(mth.outputs[0], fr.inputs[0])
        st = N.new('ShaderNodeMath'); st.operation = 'GREATER_THAN'; st.inputs[1].default_value = 0.5; L.new(fr.outputs[0], st.inputs[0])
        lim = N.new('ShaderNodeMath'); lim.operation = 'LESS_THAN'; lim.inputs[1].default_value = stripes[1]; L.new(sep.outputs['Z'], lim.inputs[0])
        k = N.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; L.new(lim.outputs[0], k.inputs[0])
        bw = N.new('ShaderNodeMixRGB'); bw.inputs['Color1'].default_value = (0.92, 0.92, 0.88, 1); bw.inputs['Color2'].default_value = (0.04, 0.04, 0.04, 1)
        L.new(st.outputs[0], bw.inputs['Fac'])
        L.new(lim.outputs[0], k.inputs[1])
        paint = N.new('ShaderNodeMixRGB'); paint.blend_type = 'MULTIPLY'; paint.inputs['Fac'].default_value = 0.0
        L.new(col, paint.inputs['Color1']); L.new(bw.outputs['Color'], paint.inputs['Color2'])
        L.new(k.outputs[0], paint.inputs['Fac'])
        col = paint.outputs['Color']
    L.new(col, bsdf.inputs['Base Color'])
    n = img('normal.jpg', False)
    nm = N.new('ShaderNodeNormalMap'); L.new(n.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o = img('orm.jpg', False)
    sp = N.new('ShaderNodeSeparateColor'); L.new(o.outputs['Color'], sp.inputs['Color'])
    rm = N.new('ShaderNodeMath'); rm.operation = 'MULTIPLY'; rm.inputs[1].default_value = rough_mul
    L.new(sp.outputs['Green'], rm.inputs[0]); L.new(rm.outputs[0], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = metal
    m['metal'] = metal
    return m


def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def box(name, mat, x0, y0, z0, x1, y1, z1, bevel=0.01):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0); v.co.y = y0 + (v.co.y + 0.5) * (y1 - y0); v.co.z = z0 + (v.co.z + 0.5) * (z1 - z0)
    if bevel > 0: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
    return obj_from_bm(bm, name, mat)


def cyl(name, mat, x, y, z, r0, r1, h, seg=10, bevel=0.0, axis='Z', rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=h)
    for v in bm.verts: v.co.z += h / 2
    if bevel > 0: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6], offset=bevel, segments=1, affect='EDGES')
    ob = obj_from_bm(bm, name, mat)
    if axis == 'X': ob.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y': ob.rotation_euler = (math.pi / 2, 0, 0)
    if rot: ob.rotation_euler = rot
    ob.location = (x, y, z)
    return ob


def tapered_pole(name, mat, h, b0, b1, ch):
    """square tapered pole with chamfered corners (8-sided section), 4 height rings"""
    bm = bmesh.new()
    rings = []
    for k in range(5):
        t = k / 4; z = h * t; r = b0 + (b1 - b0) * t; c = ch * (r / b0)
        pts = [(-r + c, -r), (r - c, -r), (r, -r + c), (r, r - c), (r - c, r), (-r + c, r), (-r, r - c), (-r, -r + c)]
        rings.append([bm.verts.new((x, y, z)) for x, y in pts])
    for a, b in zip(rings, rings[1:]):
        for i in range(8):
            bm.faces.new((a[i], a[(i + 1) % 8], b[(i + 1) % 8], b[i]))
    bm.faces.new(rings[-1]); bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(bm, name, mat)


def bake_and_export(objs, name, out_glb, face_islands=False):
    sc = bpy.context.scene
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    # shade: flat except smooth on round parts (auto smooth by angle)
    for p in ob.data.polygons: p.use_smooth = True
    try: bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    if face_islands:
        # long thin parts (the 9 m pole): every quad its own island, packed with rotation → ~3x texel density
        bpy.ops.mesh.mark_seam(clear=False)
        bpy.ops.uv.unwrap(method='CONFORMAL', margin=0.003)
        bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    imgs = {}
    for k in ('col', 'ao', 'rough', 'nrm', 'metal'):
        im = bpy.data.images.new(f'{name}_{k}', TEX, TEX, alpha=False, float_buffer=(k == 'nrm'))
        im.colorspace_settings.name = 'sRGB' if k == 'col' else 'Non-Color'
        imgs[k] = im
    mats = [s.material for s in ob.material_slots]
    def target(k):
        for m in mats:
            nt = m.node_tree
            t = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); t.name = 'BAKE'
            t.image = imgs[k]; nt.nodes.active = t
    # metal: temporarily emit the metal constant
    def bake(kind, k, **kw):
        target(k)
        bpy.ops.object.bake(type=kind, margin=6, use_clear=True, **kw)
    sc.cycles.samples = 1
    bake('DIFFUSE', 'col', pass_filter={'COLOR'})
    bake('ROUGHNESS', 'rough')
    bake('NORMAL', 'nrm', normal_space='TANGENT')
    for m in mats:
        e = m.node_tree.nodes['Principled BSDF']
        e.inputs['Emission Color'].default_value = (m.get('metal', 0.0),) * 3 + (1,); e.inputs['Emission Strength'].default_value = 1.0
    bake('EMIT', 'metal')
    sc.cycles.samples = 48
    bake('AO', 'ao')
    # combine: albedo × AO, ORM = (AO, rough, metal)
    import numpy as np
    def px(im): a = np.array(im.pixels[:], dtype=np.float32).reshape(TEX, TEX, 4); return a
    col, ao, ro, me = px(imgs['col']), px(imgs['ao']), px(imgs['rough']), px(imgs['metal'])
    aok = 0.35 + 0.65 * ao[..., :1]
    col[..., :3] *= aok
    alb = bpy.data.images.new(f'{name}_albedo', TEX, TEX); alb.colorspace_settings.name = 'sRGB'; alb.pixels = col.ravel()
    orm = np.stack([ao[..., 0], ro[..., 0], me[..., 0], np.ones_like(ao[..., 0])], -1)
    ormi = bpy.data.images.new(f'{name}_orm', TEX, TEX); ormi.colorspace_settings.name = 'Non-Color'; ormi.pixels = orm.ravel()
    # final single material
    fm = bpy.data.materials.new(name); fm.use_nodes = True
    N, L = fm.node_tree.nodes, fm.node_tree.links
    b = N['Principled BSDF']
    ta = N.new('ShaderNodeTexImage'); ta.image = alb; L.new(ta.outputs['Color'], b.inputs['Base Color'])
    to = N.new('ShaderNodeTexImage'); to.image = ormi
    sp = N.new('ShaderNodeSeparateColor'); L.new(to.outputs['Color'], sp.inputs['Color'])
    L.new(sp.outputs['Green'], b.inputs['Roughness']); L.new(sp.outputs['Blue'], b.inputs['Metallic'])
    tn = N.new('ShaderNodeTexImage'); tn.image = imgs['nrm']
    nm = N.new('ShaderNodeNormalMap'); L.new(tn.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], b.inputs['Normal'])
    ob.data.materials.clear(); ob.data.materials.append(fm)
    for im in (alb, ormi, imgs['nrm']):
        im.file_format = 'PNG'; im.filepath_raw = os.path.join(OUT, im.name + '.png'); im.save()
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_yup=True, export_image_format='JPEG', export_jpeg_quality=88)
    print('EXPORTED', out_glb, 'tris', tris)


# ====================================================================== the pole
H = 9.0
reset()
concrete = pbr_mat('concrete', 'concrete_old_cracked', 1.6, tint=(0.82, 0.8, 0.76, 1), stripes=(0.3, 2.4))
steel = pbr_mat('steel', 'steel_rusty', 0.6, metal=0.6)
plate = pbr_mat('plate', 'metal_painted_chipped', 0.5, tint=(0.95, 0.95, 0.92, 1), metal=0.2)
parts = [tapered_pole('pole', concrete, H, 0.13, 0.085, 0.03)]
# step bolts (two sides, staggered), bolt-through holes as rusty bolts near the top, number plate, telecom clamp
for i in range(9):
    z = 2.6 + i * 0.42; side = 1 if i % 2 == 0 else -1
    r = 0.13 + (0.085 - 0.13) * (z / H)
    parts.append(cyl(f'step{i}', steel, side * (r + 0.07), 0, z, 0.012, 0.012, 0.16, 6, axis='X'))
for z in (H - 0.32, H - 0.25, H - 1.08, H - 1.0):
    parts.append(cyl(f'bolt{z}', steel, 0, 0, z, 0.016, 0.016, 0.26, 6, axis='Y'))
parts.append(box('plate', plate, -0.075, -0.125, 2.2, 0.075, -0.115, 2.45, 0.004))
ring = cyl('clamp', steel, 0, 0, 5.85, 0.135, 0.13, 0.12, 12, 0.006)
parts.append(ring)
bake_and_export(parts, 'thai_pole', os.path.join(OUT, 'thai_pole.glb'), face_islands=True)

# ====================================================================== crossarms + insulators (origin = pole top)
reset()
galv = pbr_mat('galv', 'galvanized_steel', 0.5, metal=0.85, rough_mul=0.9)
porc = pbr_mat('porcelain', 'plastic_glossy', 0.3, tint=(0.55, 0.36, 0.22, 1), rough_mul=0.6)
steel = pbr_mat('steel', 'steel_rusty', 0.6, metal=0.6)
P = []
for (zz, half) in ((-0.3, 0.9), (-1.05, 0.7)):
    # C-channel crossarm (clean bevelled bar + lips), bolt plate against the pole, two diagonal braces
    P.append(box(f'arm{zz}', galv, -half, -0.04, zz - 0.05, half, 0.04, zz + 0.05, 0.008))
    P.append(box(f'lipT{zz}', galv, -half, 0.04, zz + 0.035, half, 0.06, zz + 0.05, 0.004))
    P.append(box(f'lipB{zz}', galv, -half, 0.04, zz - 0.05, half, 0.06, zz - 0.035, 0.004))
    P.append(box(f'plate{zz}', steel, -0.12, -0.1, zz - 0.09, 0.12, -0.085, zz + 0.09, 0.004))
    for s in (-1, 1):
        L = math.hypot(half * 0.7, 0.45)
        br = box(f'brace{zz}{s}', galv, -0.02, -0.006, 0, 0.02, 0.006, L, 0.003)
        br.location = (s * 0.1, -0.06, zz - 0.5)
        br.rotation_euler = (0, -s * math.atan2(half * 0.7 - 0.1, 0.45), 0)
        P.append(br)
    xs = (-0.75, 0.0, 0.75) if half > 0.8 else (-0.55, 0.55)
    for x in xs:
        P.append(cyl(f'pin{zz}{x}', steel, x, 0, zz + 0.05, 0.012, 0.012, 0.06, 6))
        for k, (r, hh) in enumerate(((0.05, 0.03), (0.065, 0.025), (0.05, 0.03), (0.04, 0.03))):
            P.append(cyl(f'ins{zz}{x}{k}', porc, x, 0, zz + 0.1 + k * 0.032, r, r * 0.85, hh, 12, 0.004))
bake_and_export(P, 'thai_pole_arms', os.path.join(OUT, 'thai_pole_arms.glb'))
