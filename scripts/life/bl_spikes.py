# find vertices far from their dominant bone in the current pose (stretched geometry) and report the bones
import bpy, sys, collections
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
act = next(a for a in bpy.data.actions if argv[1] in a.name)
arm.animation_data_create(); arm.animation_data.action = act
for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
sc.frame_set(0)
deps = bpy.context.evaluated_depsgraph_get()
m = [o for o in sc.objects if o.type == 'MESH' and not o.name.startswith('Ico')][0]
me = m.evaluated_get(deps).to_mesh()
base = m.data
# edge length outliers in posed vs rest
cnt = collections.Counter()
for e in me.edges:
    a, b = e.vertices
    lp = (me.vertices[a].co - me.vertices[b].co).length
    lr = (base.vertices[a].co - base.vertices[b].co).length
    if lr > 0 and lp > lr * 6 and lp > 0.05 / max(m.matrix_world.to_scale().x, 1e-6) * 0.01:
        for vi in (a, b):
            gs = sorted(base.vertices[vi].groups, key=lambda g: -g.weight)[:2]
            for g in gs: cnt[m.vertex_groups[g.group].name] += 1
print('SPIKE_BONES', cnt.most_common(12))
