# Blender headless: import a model, print rig/anim info, render a 3/4 + side preview (Workbench, textured).
import bpy, sys, os, math, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
path, out = argv[0], argv[1]
frame = float(argv[2]) if len(argv) > 2 else -1
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(path)[1].lower()
if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=path)
elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=path)
elif ext == '.blend': bpy.ops.wm.open_mainfile(filepath=path)
elif ext == '.dae': bpy.ops.wm.collada_import(filepath=path)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
arms = [o for o in scene.objects if o.type == 'ARMATURE']
tris = 0
for o in meshes:
    me = o.data
    t = sum(len(p.vertices) - 2 for p in me.polygons)
    tris += t
    print('MESH', o.name, 'verts', len(me.vertices), 'tris', t, 'mats', [m.name for m in me.materials if m], 'shapekeys', [k.name for k in me.shape_keys.key_blocks][:20] if me.shape_keys else [], 'vg', len(o.vertex_groups))
print('TOTAL_TRIS', tris)
for a in arms:
    print('ARMATURE', a.name, 'bones', len(a.data.bones))
    print('  BONES', ' '.join(b.name for b in a.data.bones)[:3000])
for act in bpy.data.actions:
    print('ACTION', act.name, tuple(act.frame_range))
for img in bpy.data.images:
    print('IMAGE', img.name, tuple(img.size))
if frame >= 0: scene.frame_set(int(frame))
# bounds
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
deps = bpy.context.evaluated_depsgraph_get()
for o in meshes:
    oe = o.evaluated_get(deps)
    for c in oe.bound_box:
        w = oe.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
ctr = (mn + mx) / 2; size = (mx - mn).length
print('BOUNDS', tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
cam_data.type = 'ORTHO'; cam_data.ortho_scale = size * 0.95
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 640; scene.render.resolution_y = 480
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w'); scene.world.color = (0.25, 0.25, 0.28)
views = [('a', (1.0, -1.0, 0.55)), ('b', (1.0, 0.0, 0.0)), ('c', (0.0, -1.0, 0.0))]
for tag, d in views:
    dv = mathutils.Vector(d).normalized()
    cam.location = ctr + dv * size * 2
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = out.replace('.png', f'_{tag}.png')
    bpy.ops.render.render(write_still=True)
