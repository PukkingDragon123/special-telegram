# render an action of a glb at given frames (side view, workbench)
import bpy, sys, mathutils, math
argv = sys.argv[sys.argv.index('--') + 1:]
path, out, act_name = argv[0], argv[1], argv[2]
frames = [int(f) for f in argv[3].split(',')]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
sc = bpy.context.scene
arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
act = bpy.data.actions.get(act_name) or next((a for a in bpy.data.actions if act_name in a.name), None)
print('ACTS', [a.name for a in bpy.data.actions], 'using', act and act.name)
if act_name != 'rest':
    arm.animation_data_create(); arm.animation_data.action = act
    for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.3
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 480; sc.render.resolution_y = 400
cam.location = (1.6, 0.0, 0.35); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = out.replace('.png', f'_{f}.png')
    bpy.ops.render.render(write_still=True)
