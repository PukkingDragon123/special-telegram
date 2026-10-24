import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
for a in [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']:
    for b in a.data.bones:
        d = 0
        p = b.parent
        while p: d += 1; p = p.parent
        print('B', '  ' * min(d, 12) + b.name, tuple(round(v, 2) for v in (a.matrix_world @ b.head_local)))
