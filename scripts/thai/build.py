#!/usr/bin/env python3
"""
Build custom Thai models with headless Blender and publish them to the shared library.

  python3 scripts/thai/build.py <name> [<name> ...] [--no-pub] [--preview] [--size 1024]
  python3 scripts/thai/build.py --list

Each builder (scripts/thai/models_*.py, registered with @model) returns the objects + catalog metadata; this runner bakes
them onto one PBR atlas (common.bake_export), optimises/registers with scripts/libpub.py and renders a preview to
scripts/_cache/thai/<name>.png.
"""
import os, sys, subprocess, json, time, importlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C
from registry import MODELS
for m in sorted(f[:-3] for f in os.listdir(HERE) if f.startswith('models_') and f.endswith('.py')):
    importlib.import_module(m)

ROOT = C.ROOT
HIGH = '--high' in sys.argv


def build(name, publish=True, preview=False, size=None):
    t0 = time.time()
    fn, meta = MODELS[name]
    C.reset()
    objs = fn()
    if HIGH:
        import bpy
        C.select_only([o for o in objs if o])
        hp = os.path.join(C.WORK, name + '.high.glb')
        bpy.ops.export_scene.gltf(filepath=hp, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts/libpub.py'), 'preview', hp, os.path.join(C.WORK, name + '_high.png'),
                        '--yaw', str(meta.get('yaw', 35)), '--pitch', str(meta.get('pitch', 18))], check=True)
        return
    raw = os.path.join(C.WORK, name + '.raw.glb')
    out, dims = C.bake_export(name, objs, raw, size=size or meta.get('bake', 1024), lowpoly=meta.get('low'), ao_mix=meta.get('ao_mix', 0.45),
                              keep_parts=meta.get('parts', False), ray=meta.get('ray', 0.02), alpha=meta.get('alpha', False))
    print(f'[{name}] built in {time.time() - t0:.0f}s')
    if publish:
        a = [sys.executable, os.path.join(ROOT, 'scripts/libpub.py'), 'add', raw, '--id', meta.get('id', name), '--cat', meta['cat'],
             '--tags', ','.join(meta.get('tags', [])), '--phys', meta.get('phys', 'static'), '--mass', str(meta.get('mass', 0)),
             '--tex', str(meta.get('tex', 1024)), '--tris', str(meta.get('tris', 20000)), '--title', meta.get('title', name),
             '--source', 'scripts/thai/' + meta['_file'] + ' (custom bpy model; textures: see public/assets/textures manifests)']
        if meta.get('tint'): a.append('--tint')
        if meta.get('alpha'): a.append('--alpha-mask')
        for k in ('friction', 'far', 'collider', 'anchor', 'note'):
            if meta.get(k) is not None: a += ['--' + k, str(meta[k])]
        subprocess.run(a, check=True)
    if preview:
        glb = os.path.join(ROOT, 'public/assets/gen/lib', meta['cat'], meta.get('id', name) + '.glb') if publish else raw
        subprocess.run([sys.executable, os.path.join(ROOT, 'scripts/libpub.py'), 'preview', glb, os.path.join(C.WORK, name + '.png'),
                        '--yaw', str(meta.get('yaw', 35)), '--pitch', str(meta.get('pitch', 18))], check=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--list' in args:
        for k, (_, m) in sorted(MODELS.items()): print(f"{k:24s} {m['cat']:12s} {m.get('title', '')}")
        sys.exit()
    size = None
    if '--size' in args: size = int(args[args.index('--size') + 1]); args.remove(str(size)); args.remove('--size')
    names = [a for a in args if not a.startswith('--')]
    for n in names: build(n, '--no-pub' not in args, '--preview' in args, size)
