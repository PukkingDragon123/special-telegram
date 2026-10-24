# Blender: inspect a model file (fbx/dae/blend/glb/obj) — objects, meshes, armatures, bones, actions
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
path = argv[0]
ext = os.path.splitext(path)[1].lower()
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=path)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == '.fbx': bpy.ops.import_scene.fbx(filepath=path)
    elif ext == '.dae': bpy.ops.wm.collada_import(filepath=path)
    elif ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.obj': bpy.ops.wm.obj_import(filepath=path)
for o in bpy.data.objects:
    info = f"OBJ {o.name} type={o.type} parent={o.parent.name if o.parent else None} dims={tuple(round(d,3) for d in o.dimensions)}"
    if o.type == 'MESH':
        me = o.data
        info += f" verts={len(me.vertices)} faces={len(me.polygons)} mats={[m.name for m in me.materials if m]} vgroups={len(o.vertex_groups)} shapekeys={[k.name for k in me.shape_keys.key_blocks] if me.shape_keys else []} uv={[u.name for u in me.uv_layers]}"
    if o.type == 'ARMATURE':
        info += f" bones={len(o.data.bones)}"
    print(info)
    if o.type == 'ARMATURE':
        for b in o.data.bones:
            print('   BONE', b.name, 'parent=', b.parent.name if b.parent else None, 'head=', tuple(round(v, 3) for v in b.head_local), 'tail=', tuple(round(v, 3) for v in b.tail_local))
for a in bpy.data.actions:
    print('ACTION', a.name, 'frames=', tuple(a.frame_range), 'fcurves=', len(a.fcurves))
for m in bpy.data.materials:
    col = None
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED': col = tuple(round(c, 3) for c in n.inputs['Base Color'].default_value)
    print('MAT', m.name, col)
