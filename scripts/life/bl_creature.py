# Headless Blender: clean up a downloaded rigged creature and export a game-ready GLB.
#   blender -b --factory-startup -P bl_creature.py -- <src.glb> <out.glb> <decimate_ratio> <target_height_m> [rename_map_json] [keep_actions_csv]
# - removes importer bone-shape icospheres, decimates meshes (keeps UVs + skin weights),
# - scales the armature root so the creature's bounding height matches target_height_m,
# - renames actions (json {"substring": "newname"}) and drops actions not listed (optional),
# - exports GLB (Y-up, JPEG textures, all actions as separate animations).
import bpy, sys, os, json, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
ratio = float(argv[2]) if len(argv) > 2 else 0.35
target_h = float(argv[3]) if len(argv) > 3 else 0.0
rename = json.loads(argv[4]) if len(argv) > 4 and argv[4] else {}
keep = [k for k in argv[5].split(',') if k] if len(argv) > 5 and argv[5] else []
max_tex = int(argv[6]) if len(argv) > 6 else 1024
FRAME_STEP = int(argv[7]) if len(argv) > 7 else 2
ROT_Z = float(argv[8]) if len(argv) > 8 else 0.0
DEL_BONES = argv[9] if len(argv) > 9 else ''
MERGE_BONES = argv[10] if len(argv) > 10 else ''
RESET_BONES = argv[11] if len(argv) > 11 else ''

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)

meshes = [o for o in scene.objects if o.type == 'MESH']
arms = [o for o in scene.objects if o.type == 'ARMATURE']

# rest pose for measuring / decimating
for a in arms:
    a.data.pose_position = 'REST'
bpy.context.view_layer.update()

# delete geometry bound to unwanted bones (e.g. whiskers rigged to bones at the origin)
if DEL_BONES:
    import re, bmesh
    rx = re.compile(DEL_BONES)
    for m in meshes:
        idx = {g.index for g in m.vertex_groups if rx.search(g.name)}
        if not idx: continue
        bm = bmesh.new(); bm.from_mesh(m.data)
        dl = bm.verts.layers.deform.active
        kill = [v for v in bm.verts if dl and sum(w for gi, w in v[dl].items() if gi in idx) > 0.3]
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
        bm.to_mesh(m.data); bm.free()
        print('DELETED', m.name, len(kill), 'verts bound to', DEL_BONES)

# merge weights of broken bones (e.g. toe joints sitting at the origin) into their parents
if MERGE_BONES:
    import re
    rx = re.compile(MERGE_BONES)
    arm = arms[0] if arms else None
    for m in meshes:
        for gname in [g.name for g in m.vertex_groups]:
            g = m.vertex_groups.get(gname)
            if g is None or not rx.search(g.name) or not arm: continue
            b = arm.data.bones.get(g.name)
            par = b.parent if b else None
            while par and rx.search(par.name): par = par.parent
            if not par: continue
            pg = m.vertex_groups.get(par.name) or m.vertex_groups.new(name=par.name)
            n = 0
            for v in m.data.vertices:
                for ge in v.groups:
                    if ge.group == g.index and ge.weight > 0:
                        pg.add([v.index], ge.weight, 'ADD'); n += 1
            nm = g.name
            m.vertex_groups.remove(g)
            print('MERGED', nm, '->', par.name, n)

tris_before = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
for m in meshes:
    if ratio >= 0.999:
        continue
    bpy.context.view_layer.objects.active = m
    for o in scene.objects:
        o.select_set(o == m)
    mod = m.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    while m.modifiers[0].name != 'dec':
        bpy.ops.object.modifier_move_up(modifier='dec')
    bpy.ops.object.modifier_apply(modifier='dec')
tris_after = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
print('TRIS', tris_before, '->', tris_after)

# measure height in rest pose (world space)
deps = bpy.context.evaluated_depsgraph_get()
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for m in meshes:
    me = m.evaluated_get(deps)
    for v in me.data.vertices:
        w = me.matrix_world @ v.co
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
h = mx.z - mn.z
print('BOUNDS', tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx), 'height', round(h, 3))
if target_h > 0 and h > 0:
    s = target_h / h
    # scale the top-most parent(s)
    roots = [o for o in scene.objects if o.parent is None and o.type in ('ARMATURE', 'EMPTY', 'MESH')]
    for r in roots:
        r.scale = r.scale * s
        r.location = r.location * s
    print('SCALE', s)
if ROT_Z:
    import math
    for r in [o for o in scene.objects if o.parent is None and o.type in ('ARMATURE', 'EMPTY', 'MESH')]:
        r.rotation_mode = 'XYZ'
        r.rotation_euler.z += math.radians(ROT_Z)
        r.location = mathutils.Matrix.Rotation(math.radians(ROT_Z), 3, 'Z') @ r.location
    print('ROTZ', ROT_Z)

for a in arms:
    a.data.pose_position = 'POSE'

# actions
for act in list(bpy.data.actions):
    new = None
    for k, v in rename.items():
        if k in act.name:
            new = v
            break
    if keep and (new is None or new not in keep):
        bpy.data.actions.remove(act)
        continue
    if new:
        act.name = new
print('ACTIONS', [a.name for a in bpy.data.actions])

# strip redundant channels: scale everywhere, location on bones that barely translate
def strip(act):
    removed = 0
    for fc in list(act.fcurves):
        dp = fc.data_path
        vals = [k.co[1] for k in fc.keyframe_points]
        if not vals:
            continue
        if dp.endswith('.scale') and all(abs(v - 1.0) < 1e-4 for v in vals):
            act.fcurves.remove(fc); removed += 1; continue
        if dp.endswith('.location') and all(abs(v) < 1e-4 for v in vals):
            act.fcurves.remove(fc); removed += 1
    return removed
for act in bpy.data.actions:
    print('STRIP', act.name, strip(act))
if RESET_BONES:
    import re
    rr = re.compile(RESET_BONES)
    for act in bpy.data.actions:
        n = 0
        for fc in list(act.fcurves):
            mm = re.match(r'pose\.bones\["(.+?)"\]', fc.data_path)
            if mm and rr.search(mm.group(1)):
                act.fcurves.remove(fc); n += 1
        print('RESET', act.name, n)

# make every action available to the exporter (push to NLA tracks)
for a in arms:
    ad = a.animation_data or a.animation_data_create()
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    for act in bpy.data.actions:
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        tr.mute = True
    ad.action = None

# downscale textures
for img in bpy.data.images:
    if img.size[0] > max_tex:
        img.scale(max_tex, max_tex * img.size[1] // img.size[0])
        print('IMG scaled', img.name)

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_yup=True, export_apply=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True, export_frame_step=FRAME_STEP,
    export_skins=True, export_morph=True, export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=86, export_def_bones=False,
    export_extras=False, export_cameras=False, export_lights=False,
)
print('EXPORTED', out, os.path.getsize(out) // 1024, 'KB')
