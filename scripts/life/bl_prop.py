# Headless Blender: static prop GLB cleanup — delete objects by name regex, scale to target length/height, export.
#   blender -b -P bl_prop.py -- src out target_size axis(x|y|z|h) [delete_regex] [rotz_deg]
import bpy, sys, os, re, math, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, size, axis = argv[0], argv[1], float(argv[2]), argv[3]
dele = argv[4] if len(argv) > 4 else ''
rotz = float(argv[5]) if len(argv) > 5 else 0
ratio = float(argv[6]) if len(argv) > 6 else 1.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if (dele and re.search(dele, o.name)) or (o.type == 'MESH' and o.name.startswith('Icosphere')):
        bpy.data.objects.remove(o, do_unlink=True)
if ratio < 0.999:
    for m in [o for o in sc.objects if o.type == 'MESH']:
        bpy.context.view_layer.objects.active = m
        for o in sc.objects: o.select_set(o == m)
        mod = m.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio; mod.use_collapse_triangulate = True
        while m.modifiers[0].name != 'dec': bpy.ops.object.modifier_move_up(modifier='dec')
        bpy.ops.object.modifier_apply(modifier='dec')
    print('TRIS', sum(len(p.polygons) for p in [o.data for o in sc.objects if o.type == 'MESH']))
deps = bpy.context.evaluated_depsgraph_get()
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for m in [o for o in sc.objects if o.type == 'MESH']:
    me = m.evaluated_get(deps)
    for v in me.data.vertices:
        w = me.matrix_world @ v.co
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
d = mx - mn
cur = {'x': d.x, 'y': d.y, 'z': d.z, 'h': d.z}[axis]
s = size / cur
print('DIMS', tuple(round(v, 3) for v in d), 'scale', s)
roots = [o for o in sc.objects if o.parent is None]
piv = mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for r in roots:
    r.location = (r.location - piv) * s
    r.scale = r.scale * s
    if rotz:
        r.rotation_mode = 'XYZ'; r.rotation_euler.z += math.radians(rotz)
        r.location = mathutils.Matrix.Rotation(math.radians(rotz), 3, 'Z') @ r.location
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, 1024 * img.size[1] // img.size[0])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_animations=True, export_image_format='JPEG', export_jpeg_quality=85, export_cameras=False, export_lights=False)
print('EXPORTED', out, os.path.getsize(out) // 1024, 'KB')
