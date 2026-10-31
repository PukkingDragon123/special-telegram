#!/usr/bin/env python3
"""
Publish models into the shared asset library: public/assets/gen/lib/<category>/<id>.glb + catalog.json + CREDITS.md
(docs/ART_STYLE.md §10). Search the catalog first (`list`) so nothing is imported twice.

  python3 scripts/libpub.py list [pattern]
  # a model already normalised (custom bpy builds: origin bottom centre, metres, +Z forward):
  python3 scripts/libpub.py add <raw.glb> --id thai_stool --cat furniture --tags "stool,plastic" --phys dynamic --mass 0.7 \
          --license CC0-1.0 --author "..." --source "scripts/thai/..." [--tex 1024] [--tris 12000] [--tint] [--friction 0.5]
  # a Sketchfab / Objaverse model (fetched through scripts/objaverse.py, normalised here with headless Blender):
  python3 scripts/libpub.py import <uid> --id scooter_wave --cat vehicles --height 1.08 [--length 1.9] [--rot 0,0,90]
          [--tex 1024] [--tris 15000] --phys static [--mass 95] [--drop "name-regex"] [--keep-anim]
  python3 scripts/libpub.py preview <glb> <out.png> [--size 512] [--yaw 35]     # Cycles turntable still (HDRI lit)
  python3 scripts/libpub.py remove <id>
  python3 scripts/libpub.py credits                                                # rebuild CREDITS.md

Optimisation: `npx -y @gltf-transform/cli optimize --compress meshopt --texture-compress webp --texture-size <tex>`,
simplified (meshoptimizer) when above the triangle budget. Load with GLTFLoader + MeshoptDecoder (src/modules/world/lib.ts).
"""
import argparse, json, os, re, struct, subprocess, sys, math, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'public/assets/gen/lib')
CAT = os.path.join(LIB, 'catalog.json')
CACHE = os.path.join(ROOT, 'scripts/_cache/libpub')
LIC_NAME = {'by': 'CC-BY-4.0', 'by-sa': 'CC-BY-SA-4.0', 'cc0': 'CC0-1.0'}


# ------------------------------------------------------------------ catalog
def load_cat():
    """catalog.json + every <category>/catalog.part.json fragment (other agents publish fragments; theirs win for their ids)"""
    cat = json.load(open(CAT)) if os.path.exists(CAT) else []
    if os.path.isdir(LIB):
        for d in sorted(os.listdir(LIB)):
            part = os.path.join(LIB, d, 'catalog.part.json')
            if not os.path.exists(part): continue
            try: frag = json.load(open(part))
            except Exception as e: print('bad fragment', part, e); continue
            ids = {e['id'] for e in frag}
            files = {e['file'] for e in frag}
            # fragment entries replace any entry with the same id OR the same file (no duplicate ids for one model)
            cat = [e for e in cat if e['id'] not in ids and e['file'] not in files] + frag
    return cat


def save_cat(cat):
    cat.sort(key=lambda e: (e['category'], e['id']))
    os.makedirs(LIB, exist_ok=True)
    tmp = CAT + '.tmp'
    json.dump(cat, open(tmp, 'w'), indent=1, ensure_ascii=False)
    os.replace(tmp, CAT)
    write_credits(cat)


def write_credits(cat):
    total = sum(e.get('bytes', 0) for e in cat)
    L = ['# Shared asset library — credits', '',
         'Models in `public/assets/gen/lib/` (catalog: `catalog.json`, loader: `src/modules/world/lib.ts`).',
         'Imported models come from Sketchfab (via the Objaverse 1.0 mirror on HuggingFace) under CC0 / CC-BY / CC-BY-SA; '
         'custom Thai models were built for เฮียผัด! with headless Blender (`scripts/thai/`) from photo textures listed in the texture manifests.',
         'CC-BY / CC-BY-SA models are credited below as required; changes: re-scaled, re-centred, simplified, textures resized and WebP-compressed.', '',
         '| id | model | author | licence | source |', '|---|---|---|---|---|']
    for e in cat:
        L.append(f"| `{e['id']}` | {e.get('title', e['id'])} | {e.get('author', '')} | {e.get('license', '')} | {e.get('source_url', '')} |")
    L += ['', f'Total: {len(cat)} models, {total / 1048576:.1f} MB.', '']
    open(os.path.join(LIB, 'CREDITS.md'), 'w').write('\n'.join(L))


# ------------------------------------------------------------------ GLB inspection (tris + bounds, works on meshopt files)
def glb_json(path):
    b = open(path, 'rb').read()
    magic, ver, ln = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67, 'not a GLB'
    cl, ct = struct.unpack_from('<II', b, 12)
    return json.loads(b[20:20 + cl])


def _mat(node):
    import numpy as np
    if 'matrix' in node: return np.array(node['matrix'], dtype=float).reshape(4, 4).T
    t = node.get('translation', [0, 0, 0]); r = node.get('rotation', [0, 0, 0, 1]); s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t
    return M


def glb_stats(path):
    import numpy as np
    j = glb_json(path)
    acc = j.get('accessors', [])
    tris = 0
    mn = np.array([1e9] * 3); mx = -mn
    def walk(ni, M):
        nonlocal tris, mn, mx
        n = j['nodes'][ni]
        W = M @ _mat(n)
        if 'mesh' in n:
            inst = 1
            ext = n.get('extensions', {}).get('EXT_mesh_gpu_instancing')
            for p in j['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4: continue
                a = acc[p['indices']] if 'indices' in p else acc[p['attributes']['POSITION']]
                tris += a['count'] // 3 * inst
                pa = acc[p['attributes']['POSITION']]
                lo, hi = pa.get('min'), pa.get('max')
                if lo and hi:
                    # dequantise normalized accessors
                    if pa.get('normalized'):
                        div = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}.get(pa['componentType'], 1)
                        lo = [v / div for v in lo]; hi = [v / div for v in hi]
                    for cx in (lo[0], hi[0]):
                        for cy in (lo[1], hi[1]):
                            for cz in (lo[2], hi[2]):
                                q = W @ np.array([cx, cy, cz, 1])
                                mn = np.minimum(mn, q[:3]); mx = np.maximum(mx, q[:3])
        for c in n.get('children', []): walk(c, W)
    sc = j.get('scenes', [{}])[j.get('scene', 0)]
    for ni in sc.get('nodes', []): walk(ni, np.eye(4))
    return {'tris': int(tris), 'min': mn.round(4).tolist(), 'max': mx.round(4).tolist(), 'size': (mx - mn).round(3).tolist(),
            'materials': len(j.get('materials', [])), 'meshes': len(j.get('meshes', [])), 'textures': len(j.get('textures', [])),
            'anims': len(j.get('animations', []))}


def patch_alpha(path, mode='MASK', cutoff=0.5):
    """rewrite every non-glass material's alphaMode in a GLB (JSON chunk only)"""
    b = bytearray(open(path, 'rb').read())
    cl, _ = struct.unpack_from('<II', b, 12)
    j = json.loads(b[20:20 + cl])
    for m in j.get('materials', []):
        if 'glass' in (m.get('name') or '').lower(): continue
        m['alphaMode'] = mode
        if mode == 'MASK': m['alphaCutoff'] = cutoff
        m['doubleSided'] = True
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    rest = b[20 + cl:]
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
    open(path, 'wb').write(out)


# ------------------------------------------------------------------ optimise
def gt(*a):
    r = subprocess.run(['npx', '-y', '@gltf-transform/cli', *a], cwd=ROOT, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr[-3000:] + r.stdout[-1000:])
    return r.stdout


def optimize(src, dst, tex=1024, tris=15000, error=0.002, keep_anim=False):
    st = glb_stats(src)
    ratio = min(1.0, tris / max(1, st['tris']))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    a = ['optimize', src, dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', str(tex),
         '--instance', 'false', '--flatten', 'false' if keep_anim else 'true', '--join', 'true', '--palette', 'false',
         '--simplify', 'true' if ratio < 0.97 else 'false', '--simplify-ratio', f'{ratio:.4f}', '--simplify-error', str(error)]
    gt(*a)
    st2 = glb_stats(dst)
    if ratio < 0.97 and st2['tris'] > tris * 1.35:
        # error bound too strict → relax once
        a[a.index('--simplify-error') + 1] = str(error * 5)
        gt(*a)
        st2 = glb_stats(dst)
    return st, st2


# ------------------------------------------------------------------ catalog entry
def entry_common(a, glb, st):
    rel = os.path.relpath(glb, LIB).replace(os.sep, '/')
    e = {'id': a.id, 'file': rel, 'category': a.cat, 'tags': [t.strip() for t in (a.tags or '').split(',') if t.strip()],
         'size_m': [round(v, 3) for v in st['size']], 'tris': st['tris'], 'license': a.license, 'author': a.author,
         'source_url': a.source, 'physics': a.phys, 'mass_kg': a.mass if a.phys == 'dynamic' else (a.mass or 0),
         'bytes': os.path.getsize(glb)}
    if getattr(a, 'title', None): e['title'] = a.title
    if a.tint: e['tint'] = True
    if a.friction is not None: e['friction'] = a.friction
    if a.anchor and a.anchor != 'bottom': e['anchor'] = a.anchor
    if a.far is not None: e['far'] = a.far
    if a.collider: e['collider'] = a.collider
    if a.note: e['note'] = a.note
    if st.get('anims'): e['anims'] = st['anims']
    return e


def upsert(e):
    cat = [x for x in load_cat() if x['id'] != e['id']]
    cat.append(e)
    save_cat(cat)
    tot = sum(x.get('bytes', 0) for x in cat)
    print(f"✓ {e['id']}: {e['tris']} tris, {e['bytes'] / 1024:.0f} KB, size {e['size_m']} m  — library {len(cat)} models / {tot / 1048576:.1f} MB")


def cmd_add(a):
    dst = os.path.join(LIB, a.cat, a.id + '.glb')
    st0, st = optimize(a.glb, dst, a.tex, a.tris, a.error)
    if a.alpha_mask: patch_alpha(dst)
    print(f'  {st0["tris"]} → {st["tris"]} tris')
    e = entry_common(a, dst, st)
    if a.alpha_mask: e['alpha'] = 'mask'
    upsert(e)


# ------------------------------------------------------------------ import (normalise with Blender)
NORMALISE = r'''
import bpy, sys, json, math, re
from mathutils import Vector, Matrix
src, dst, opt = sys.argv[-3], sys.argv[-2], json.loads(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
drop = re.compile(opt['drop'], re.I) if opt.get('drop') else None
for o in list(sc.objects):
    if o.type in ('CAMERA', 'LIGHT', 'EMPTY') and not o.children: bpy.data.objects.remove(o); continue
    if drop and o.type == 'MESH' and (drop.search(o.name) or drop.search(o.data.name)): bpy.data.objects.remove(o)
if not opt.get('keep_anim'):
    # bake the pose, drop armatures / animation
    for o in list(sc.objects):
        if o.type == 'MESH':
            for m in list(o.modifiers):
                if m.type == 'ARMATURE':
                    bpy.context.view_layer.objects.active = o
                    try: bpy.ops.object.modifier_apply(modifier=m.name)
                    except Exception: o.modifiers.remove(m)
            o.shape_key_clear() if o.data.shape_keys else None
    for o in list(sc.objects):
        if o.type == 'ARMATURE': bpy.data.objects.remove(o)
meshes = [o for o in sc.objects if o.type == 'MESH']
# un-parent keeping transforms, apply everything
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(sc.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# user rotation (degrees, Blender axes) so that the model stands on Z and its front faces -Y
rx, ry, rz = [math.radians(v) for v in opt.get('rot', [0, 0, 0])]
R = Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
for o in meshes: o.data.transform(R)
mn = Vector((1e9,) * 3); mx = -mn
for o in meshes:
    for v in o.data.vertices:
        for i in range(3): mn[i] = min(mn[i], v.co[i]); mx[i] = max(mx[i], v.co[i])
size = mx - mn
s = 1.0
if opt.get('height'): s = opt['height'] / size.z
elif opt.get('length'): s = opt['length'] / max(size.x, size.y)
elif opt.get('width'): s = opt['width'] / size.x
elif opt.get('maxdim'): s = opt['maxdim'] / max(size)
T = Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
for o in meshes:
    o.data.transform(T)
    o.data.update()
# opaque unless the material really is glass
for m in bpy.data.materials:
    if not m.use_nodes: continue
    nm = m.name.lower()
    glassy = any(k in nm for k in ('glass', 'window', 'windshield', 'lens', 'visor', 'transp'))
    if not glassy:
        try: m.surface_render_method = 'DITHERED'
        except Exception: pass
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED' and n.inputs['Alpha'].links and not opt.get('keep_alpha'):
                # cut-outs (leaves, grilles) keep alpha via MASK; others become opaque
                if not any(k in nm for k in ('leaf', 'leaves', 'grass', 'foliage', 'alpha', 'cutout', 'decal', 'plant', 'net', 'mesh', 'fence', 'hair')):
                    m.node_tree.links.remove(n.inputs['Alpha'].links[0]); n.inputs['Alpha'].default_value = 1
print('NORMALISED', json.dumps({'scale': s, 'size': [size.x * s, size.y * s, size.z * s], 'meshes': len(meshes)}))
if opt.get('decimate'):
    # Blender collapse decimation (works across UV seams of photoscans, where meshopt simplify stalls)
    tot = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    r = min(1.0, opt['decimate'] / max(1, tot))
    if r < 0.98:
        for o in meshes:
            m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = r
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    print('DECIMATED', tot, '->', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes))
if opt.get('rebake'):
    # decimate to the budget and bake the full-detail original onto one new atlas (albedo×AO, ORM, normal)
    sys.path.insert(0, opt['thai'])
    import common as Cm
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.render.threads_mode = 'FIXED'; sc.render.threads = 3
    if not sc.world: sc.world = bpy.data.worlds.new('w')
    for o in meshes: o.data.uv_layers.active_index = 0
    Cm.bake_export(opt['id'], meshes, dst, size=opt['rebake'], lowpoly=opt['tris'], ray=opt.get('ray', 0.02), ao_mix=opt.get('ao_mix', 0.3),
                   alpha=bool(opt.get('alpha')), origin=opt.get('anchor', 'bottom'))
    raise SystemExit(0)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    export_animations=bool(opt.get('keep_anim')), export_cameras=False, export_lights=False, export_extras=False)
'''


def run_blender(code, *args, timeout=1800):
    os.makedirs(CACHE, exist_ok=True)
    sp = os.path.join(CACHE, '_bl.py')
    open(sp, 'w').write(code)
    r = subprocess.run([sys.executable, '-I', sp, *args], capture_output=True, text=True, timeout=timeout)
    out = r.stdout + r.stderr
    if r.returncode: raise RuntimeError(out[-4000:])
    return out


def cmd_import(a):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import objaverse as ov
    meta = None
    for r in ov.load_index() if not a.no_index else []:
        if r['uid'] == a.uid: meta = r; break
    if meta is None:
        _, m = ov.thumb_url(a.uid)
        lic = ov.lic_from(m.get('license') or {})
        meta = {'name': m.get('name', ''), 'lic': lic, 'user': (m.get('user') or {}).get('username', ''), 'uname': (m.get('user') or {}).get('displayName', '')}
    if meta['lic'] not in LIC_NAME: sys.exit(f"✗ {a.uid}: licence {meta['lic']} is not CC0 / CC-BY / CC-BY-SA")
    raw = ov.fetch(a.uid)
    norm = os.path.join(CACHE, a.id + '.norm.glb')
    opt = {'height': a.height, 'length': a.length, 'width': a.width, 'maxdim': a.maxdim, 'rot': [float(v) for v in a.rot.split(',')],
           'drop': a.drop, 'keep_anim': a.keep_anim, 'keep_alpha': a.keep_alpha, 'rebake': a.rebake, 'tris': a.tris, 'id': a.id.replace('/', '_'),
           'ray': a.ray, 'thai': os.path.join(ROOT, 'scripts/thai'), 'alpha': a.alpha_mask, 'anchor': a.anchor, 'decimate': a.decimate}
    out = run_blender(NORMALISE, raw, norm, json.dumps(opt))
    print('  ' + next((l for l in out.splitlines() if l.startswith('NORMALISED')), '?'))
    a.license = LIC_NAME[meta['lic']]
    a.author = a.author or f"{meta.get('uname') or meta['user']} (sketchfab.com/{meta['user']})"
    a.source = f'https://sketchfab.com/3d-models/{a.uid}'
    a.title = a.title or meta['name']
    dst = os.path.join(LIB, a.cat, a.id + '.glb')
    st0, st = optimize(norm, dst, a.tex, int(a.tris * 1.15) if a.rebake else a.tris, a.error, a.keep_anim)
    if a.alpha_mask: patch_alpha(dst)
    print(f'  {st0["tris"]} → {st["tris"]} tris')
    e = entry_common(a, dst, st)
    e['uid'] = a.uid
    if a.alpha_mask: e['alpha'] = 'mask'
    upsert(e)


# ------------------------------------------------------------------ preview
PREVIEW = r'''
import bpy, sys, math, json, os
from mathutils import Vector
src, out, opt = sys.argv[-3], sys.argv[-2], json.loads(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in sc.objects if o.type == 'MESH']
mn = Vector((1e9,) * 3); mx = -mn
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
ctr = (mn + mx) / 2; ext = (mx - mn).length
# ground
bpy.ops.mesh.primitive_plane_add(size=ext * 8, location=(ctr.x, ctr.y, mn.z))
g = sc.objects[-1] if False else bpy.context.active_object
gm = bpy.data.materials.new('g'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.3, 0.27, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
g.data.materials.append(gm)
# HDRI world
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
nt = w.node_tree; env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(opt['hdri'])
nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])
nt.nodes['Background'].inputs['Strength'].default_value = opt.get('env', 1.0)
# sun
sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 3.0; sd.angle = math.radians(3)
so = bpy.data.objects.new('sun', sd); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(opt.get('sun', 140)))
cam = bpy.data.cameras.new('c'); cam.lens = 50
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
yaw = math.radians(opt.get('yaw', 35)); pit = math.radians(opt.get('pitch', 18))
d = ext * opt.get('dist', 1.25) / math.tan(cam.angle / 2) / 2
co.location = ctr + Vector((math.sin(yaw) * math.cos(pit) * -1 * -1, -math.cos(yaw) * math.cos(pit), math.sin(pit))) * d
co.location.x = ctr.x - math.sin(-yaw) * math.cos(pit) * d
dirv = ctr - co.location
co.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'CYCLES'; sc.cycles.samples = opt.get('samples', 24); sc.cycles.device = 'CPU'
try: sc.cycles.use_denoising = True
except Exception: pass
sc.render.threads_mode = 'FIXED'; sc.render.threads = 3
sc.render.resolution_x = sc.render.resolution_y = opt.get('size', 512)
sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('PREVIEW', out)
'''


DECODE = r"""
const { createRequire } = require('node:module');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const base = path.join(os.homedir(), '.npm/_npx');
const dir = fs.readdirSync(base).map((d) => path.join(base, d, 'node_modules')).find((d) => fs.existsSync(path.join(d, '@gltf-transform/core')));
const req = createRequire(path.join(dir, 'x.js'));
(async () => {
  const { NodeIO } = req('@gltf-transform/core');
  const { ALL_EXTENSIONS } = req('@gltf-transform/extensions');
  const { MeshoptDecoder } = req('meshoptimizer');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(process.argv[2]);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  await io.write(process.argv[3], doc);
})().catch((e) => { console.error(e); process.exit(1); });
"""


def decoded(glb):
    """meshopt-free copy of a GLB (Blender cannot read EXT_meshopt_compression)"""
    if 'EXT_meshopt_compression' not in json.dumps(glb_json(glb).get('extensionsUsed', [])): return glb
    os.makedirs(CACHE, exist_ok=True)
    js = os.path.join(CACHE, '_decode.cjs'); open(js, 'w').write(DECODE)
    out = os.path.join(CACHE, os.path.basename(glb) + '.dec.glb')
    subprocess.run(['node', js, glb, out], check=True)
    return out


def cmd_preview(a):
    hdri_dir = os.path.join(ROOT, 'public/assets/hdri')
    hd = None
    for f in sorted(os.listdir(hdri_dir)):
        if f.endswith(('.hdr', '.exr', '.jpg')) and ('day' in f or 'sun' in f or 'noon' in f or 'street' in f): hd = os.path.join(hdri_dir, f); break
    if not hd: hd = os.path.join(hdri_dir, next(f for f in sorted(os.listdir(hdri_dir)) if f.endswith(('.hdr', '.exr', '.jpg'))))
    run_blender(PREVIEW, decoded(a.glb), os.path.abspath(a.out), json.dumps({'hdri': hd, 'size': a.size, 'yaw': a.yaw, 'pitch': a.pitch, 'samples': a.samples, 'dist': a.dist}))
    print('preview →', a.out)


def cmd_list(a):
    pat = re.compile(a.pattern or '.', re.I)
    cat = load_cat()
    for e in cat:
        if pat.search(e['id'] + ' ' + ' '.join(e.get('tags', [])) + ' ' + e['category']):
            print(f"{e['category']:12s} {e['id']:28s} {e['tris']:6d} tris {e.get('bytes', 0) / 1024:6.0f} KB {str(e['size_m']):24s} {e['physics']:7s} {e.get('license', '')}")
    print(f"{len(cat)} models, {sum(e.get('bytes', 0) for e in cat) / 1048576:.1f} MB")


def cmd_remove(a):
    cat = load_cat()
    for e in cat:
        if e['id'] == a.id:
            p = os.path.join(LIB, e['file'])
            if os.path.exists(p): os.remove(p)
    save_cat([e for e in cat if e['id'] != a.id])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    def common(s):
        s.add_argument('--id', required=True); s.add_argument('--cat', required=True); s.add_argument('--tags', default='')
        s.add_argument('--phys', choices=['dynamic', 'static', 'none'], default='static'); s.add_argument('--mass', type=float, default=0)
        s.add_argument('--tex', type=int, default=1024); s.add_argument('--tris', type=int, default=15000); s.add_argument('--error', type=float, default=0.002)
        s.add_argument('--tint', action='store_true'); s.add_argument('--friction', type=float); s.add_argument('--anchor', default='bottom')
        s.add_argument('--far', type=float); s.add_argument('--collider', choices=['hull', 'box', 'cyl']); s.add_argument('--note'); s.add_argument('--title')
        s.add_argument('--alpha-mask', action='store_true')
    s = sp.add_parser('add'); s.add_argument('glb'); common(s)
    s.add_argument('--license', default='CC0-1.0'); s.add_argument('--author', default='เฮียผัด! assets (custom, headless Blender)'); s.add_argument('--source', default='')
    s.set_defaults(fn=cmd_add)
    s = sp.add_parser('import'); s.add_argument('uid'); common(s)
    for k in ('height', 'length', 'width', 'maxdim'): s.add_argument('--' + k, type=float)
    s.add_argument('--rot', default='0,0,0'); s.add_argument('--drop'); s.add_argument('--keep-anim', action='store_true'); s.add_argument('--keep-alpha', action='store_true')
    s.add_argument('--author'); s.add_argument('--no-index', action='store_true')
    s.add_argument('--decimate', type=int, help='Blender collapse-decimate to about this many triangles before optimising (photoscans)')
    s.add_argument('--rebake', type=int, help='decimate to --tris and bake the original onto one new atlas of this size'); s.add_argument('--ray', type=float, default=0.02)
    s.set_defaults(fn=cmd_import, license='', source='')
    s = sp.add_parser('preview'); s.add_argument('glb'); s.add_argument('out'); s.add_argument('--size', type=int, default=512)
    s.add_argument('--yaw', type=float, default=35); s.add_argument('--pitch', type=float, default=18); s.add_argument('--samples', type=int, default=24)
    s.add_argument('--dist', type=float, default=1.25); s.set_defaults(fn=cmd_preview)
    s = sp.add_parser('list'); s.add_argument('pattern', nargs='?'); s.set_defaults(fn=cmd_list)
    s = sp.add_parser('remove'); s.add_argument('id'); s.set_defaults(fn=cmd_remove)
    s = sp.add_parser('credits'); s.set_defaults(fn=lambda a: write_credits(load_cat()))
    s = sp.add_parser('merge', help='fold catalog.part.json fragments into catalog.json'); s.set_defaults(fn=lambda a: save_cat(load_cat()))
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
