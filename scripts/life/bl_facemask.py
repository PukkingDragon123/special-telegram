# Headless Blender: cut a photoscanned head to a FACE MASK and seat it on a character template head.
#   blender -b --factory-startup -P scripts/life/bl_facemask.py -- <scan.glb> <keep_mesh_csv> <template.glb> <template.json> \
#           <eyeLx> <eyeRx> <eyeZ> <mouthZ> <out.glb> [target_tris]
# Landmarks are in the scan's Blender world units (read from a front ortho render, see the report).
# The mask lives in the template's model space (three.js frame after export) so the runtime binds it to the Head bone,
# its UVs reproduce EXACTLY the planar face-photo projection of the template head (build_chars.py: u = 0.5 + x/(iod/.28),
# v = 0.44 + (eyeZ - z)/(iod/.28), placed in the atlas 'face' rect) → the per-character Thai face photo lands on the scan's
# 3D relief, colours match the low-poly head at the rim, and the rim is blended INTO the head surface (no visible seam).
import bpy, bmesh, sys, json, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

a = sys.argv[sys.argv.index('--') + 1:]
scan, keep, tpl, tjson = a[0], a[1].split(','), a[2], a[3]
eLx, eRx, eZ, mZ = map(float, a[4:8])
out = a[8]
target = int(a[9]) if len(a) > 9 else 7000
info = json.load(open(tjson))
iod = info['iod']
ex3 = info['eyes'][0]                                   # three.js frame (x, y up, z fwd)
tEyeZ = ex3[1]                                          # blender z (up)
FACE = (0, 400, 320, 320); INSET = 5; ATL = 1024.0

bpy.ops.wm.read_factory_settings(use_empty=True)
# ---- template head surface (BVH of the skin piece)
bpy.ops.import_scene.gltf(filepath=tpl)
tobjs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for ar in [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']: ar.data.pose_position = 'REST'
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
body = max(tobjs, key=lambda o: len(o.data.vertices) if 'body' in o.name.lower() or True else 0)
cands = [o for o in tobjs if 'body' in o.name.lower()] or [body]
body = max(cands, key=lambda o: len(o.data.vertices))
be = body.evaluated_get(deps); bm = bmesh.new(); bm.from_mesh(be.to_mesh()); bm.transform(body.matrix_world)
tbvh = BVHTree.FromBMesh(bm)
print('template skin', body.name, len(bm.verts))
def head_y(x, z):
    hit = tbvh.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)), 2.0)
    return hit[0].y if hit[0] is not None else None
tEyeY = head_y(0.0, tEyeZ)
# eye-surface depth on the template (average of both eyes)
tEyeY = sum(head_y(s * iod / 2, tEyeZ) for s in (-1, 1)) / 2
print('template eye surface y', tEyeY)
for o in tobjs + [o for o in bpy.context.scene.objects if o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)

# ---- scan
bpy.ops.import_scene.gltf(filepath=scan)
ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']
km = [o for o in ms if any(k in o.name for k in keep)]
for o in km:   # keep world transforms when the importer's parent empties are removed
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in ms:
    if o not in km: bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in km: o.select_set(True)
bpy.context.view_layer.objects.active = km[0]
if len(km) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
# scan landmarks → template frame
sMid = (eLx + eRx) / 2
s = iod / abs(eRx - eLx)
sy = (0.29 * iod / 0.28) / max(1e-9, (eZ - mZ) * s)     # vertical scale so the mouth lands on v = 0.73
# eye-surface depth on the scan: front-most vertices near each eye landmark
rad = abs(eRx - eLx) * 0.08
ys = [v.co.y for v in me.vertices for x in (eLx, eRx) if (v.co.x - x) ** 2 + (v.co.z - eZ) ** 2 < rad * rad]
ys.sort()
sEyeY = ys[len(ys) // 10] if ys else 0.0
print('scale', s, 'yscale', sy, 'scan eye surface', sEyeY)
for v in me.vertices:
    p = v.co
    v.co = Vector(((p.x - sMid) * s, tEyeY + (p.y - sEyeY) * s, tEyeZ + (p.z - eZ) * s * sy))
me.update()
# ---- cut to the face (forehead → chin, ear → ear, front half)
top, chin = tEyeZ + 0.068, tEyeZ - 0.29 * iod / 0.28 - 0.052
zc, az, ax = (top + chin) / 2, (top - chin) / 2, 0.066
def rr(x, z): return math.sqrt((x / ax) ** 2 + ((z - zc) / az) ** 2)
bm2 = bmesh.new(); bm2.from_mesh(me)
kill = [v for v in bm2.verts if rr(v.co.x, v.co.z) > 1.0 or v.co.y > tEyeY + 0.045]
bmesh.ops.delete(bm2, geom=kill, context='VERTS')
# keep the biggest connected piece (drop ears / stray islands)
bm2.verts.ensure_lookup_table()
seen = set(); best = []
for v0 in bm2.verts:
    if v0 in seen: continue
    comp = []; st = [v0]; seen.add(v0)
    while st:
        v = st.pop(); comp.append(v)
        for e in v.link_edges:
            w = e.other_vert(v)
            if w not in seen: seen.add(w); st.append(w)
    if len(comp) > len(best): best = comp
bs = set(best)
bmesh.ops.delete(bm2, geom=[v for v in bm2.verts if v not in bs], context='VERTS')
# ---- depth: sit 2 mm proud of the head on average, never inside it, rim blended into the head surface
diffs = []
for v in bm2.verts:
    if rr(v.co.x, v.co.z) < 0.6:
        hy = head_y(v.co.x, v.co.z)
        if hy is not None: diffs.append(v.co.y - hy)
diffs.sort()
print('inner verts with head hits', len(diffs), 'total', len(bm2.verts))
off = -0.002 - (diffs[len(diffs) // 2] if diffs else 0.0)
print('depth offset', off)
for v in bm2.verts:
    x, z = v.co.x, v.co.z
    hy = head_y(x, z)
    y = v.co.y + off
    if hy is None: v.co.y = y; continue
    r = rr(x, z)
    w = min(1.0, max(0.0, (r - 0.62) / 0.38)); w = w * w * (3 - 2 * w)
    yi = min(y, hy - 0.0007)
    v.co.y = yi * (1 - w) + (hy + 0.0018) * w
bm2.to_mesh(me); bm2.free(); me.update()
# ---- decimate
tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > target:
    mod = ob.modifiers.new('dec', 'DECIMATE'); mod.ratio = target / tris; mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
me = ob.data
for p in me.polygons: p.use_smooth = True
# ---- atlas UVs = template planar face projection
while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
uvl = me.uv_layers.new(name='UVMap')
W = iod / 0.28
for poly in me.polygons:
    for li in poly.loop_indices:
        co = me.vertices[me.loops[li].vertex_index].co
        ui = 0.5 + co.x / W; vi = 0.44 + (tEyeZ - co.z) / W
        ua = (FACE[0] + INSET + ui * (FACE[2] - 2 * INSET)) / ATL
        va = (FACE[1] + INSET + vi * (FACE[3] - 2 * INSET)) / ATL
        uvl.data[li].uv = (ua, 1.0 - va)
me.materials.clear()
mat = bpy.data.materials.new('facemask'); me.materials.append(mat)
print('MASK tris', sum(len(p.vertices) - 2 for p in me.polygons), 'verts', len(me.vertices))
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_texcoords=True, export_normals=True, export_materials='PLACEHOLDER', export_animations=False, export_skins=False)
print('EXPORTED', out)
