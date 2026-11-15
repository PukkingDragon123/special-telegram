#!/usr/bin/env python3
"""
Sketchfab model downloader + optimizer (CC0 / CC-BY / CC-BY-SA only → small game-ready GLBs).

  python3 scripts/sketchfab.py <id>=<uid>:<height_m>[:tris=N][:error=F] ...

  id        local id (folder + file name under public/assets/gen/world/models/<id>/<id>.glb)
  uid       Sketchfab model uid
  height_m  real-world height the model is scaled to (Sketchfab units are arbitrary); 0 = keep units

Needs an API token for api.sketchfab.com: in the cloud sessions the network proxy injects it (no header
needed here); elsewhere set SKETCHFAB_TOKEN. Licence is checked against the API (NC / ND are refused).
Writes the manifest entry (dims in metres after scaling, authors, licence, source URL) next to the Poly Haven
ones (public/assets/gen/world/models/manifest.json) and appends an attribution line to CREDITS.md.
Geometry: simplified to tris (default 4000), meshopt-compressed; textures WebP ≤1024 px (gltf-transform CLI via npx).
Bounds are measured with trimesh (pip install trimesh numpy) on the original GLB.
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'public/assets/gen/world/models')
CACHE = os.path.join(ROOT, 'scripts/_cache/sketchfab')
API = 'https://api.sketchfab.com/v3'
OK_LIC = ('cc0', 'by', 'by-sa')

def curl_json(url):
    args = ['curl', '-sSfL', '--retry', '3', url]
    tok = os.environ.get('SKETCHFAB_TOKEN')
    if tok and tok != 'proxy-injected':
        args[1:1] = ['-H', f'Authorization: Token {tok}']
    return json.loads(subprocess.check_output(args))

def gt(*a):
    return subprocess.check_output(['npx', '-y', '@gltf-transform/cli', *a], cwd=ROOT, stderr=subprocess.STDOUT).decode()

def count_tris(f):
    try:
        csv = gt('inspect', f, '--format', 'csv')
        part = csv.split('MESHES')[1].split('MATERIALS')[0]
        t = 0
        for line in part.splitlines():
            c = line.split(',')
            if len(c) > 4 and c[2] == 'TRIANGLES':
                try: t += int(float(c[4])) * int(float(c[-2] or 1))
                except ValueError: pass
        return t
    except Exception:
        return 0

def bounds(f):
    import trimesh
    sc = trimesh.load(f, force='scene')
    b = sc.bounds  # (2,3) in scene units, Y up (glTF)
    return [float(b[1][i] - b[0][i]) for i in range(3)]

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    man_p = os.path.join(OUT, 'manifest.json')
    man = json.load(open(man_p)) if os.path.exists(man_p) else {}
    credits = []
    for spec in sys.argv[1:]:
        lid, rest = spec.split('=', 1)
        parts = rest.split(':')
        uid, height = parts[0], float(parts[1]) if len(parts) > 1 else 0.0
        opts = dict(p.split('=') for p in parts[2:]) if len(parts) > 2 else {}
        tris_t = int(opts.get('tris', 4000))
        err = opts.get('error', '0.004')
        try:
            info = curl_json(f'{API}/models/{uid}')
            lic = (info.get('license') or {})
            slug = (lic.get('slug') or lic.get('label') or '').lower()
            if not any(slug == k or slug.endswith(k) for k in OK_LIC) and 'attribution' not in slug and 'cc0' not in slug:
                print(f'✗ {lid}: licence {slug!r} not allowed'); continue
            if 'noncommercial' in slug or 'noderiv' in slug or slug.endswith('-nc') or '-nd' in slug:
                print(f'✗ {lid}: licence {slug!r} not allowed'); continue
            src = os.path.join(CACHE, f'{uid}.glb')
            if not os.path.exists(src):
                dl = curl_json(f'{API}/models/{uid}/download')
                url = (dl.get('glb') or {}).get('url')
                if not url: print(f'✗ {lid}: no glb'); continue
                subprocess.check_call(['curl', '-sSfL', '--retry', '3', '-o', src, url])
            dims0 = bounds(src)
            s = height / dims0[1] if height > 0 and dims0[1] > 0 else 1.0
            d = os.path.join(OUT, lid); os.makedirs(d, exist_ok=True)
            out = os.path.join(d, f'{lid}.glb')
            poly = count_tris(src) or info.get('faceCount') or 1
            ratio = min(1.0, tris_t / poly)
            with tempfile.TemporaryDirectory() as td:
                mid = os.path.join(td, 'm.glb')
                gt('optimize', src, mid, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024',
                   '--instance', 'false', '--simplify', 'true' if ratio < 0.98 else 'false', '--simplify-ratio', f'{ratio:.4f}', '--simplify-error', str(err))
                # bake the real-world scale into the root (so the game reads metres)
                if abs(s - 1) > 1e-3:
                    scaled = os.path.join(td, 's.glb')
                    _scale_glb(mid, scaled, s)
                    mid = scaled
                gt('meshopt', mid, out)
            tris = count_tris(out)
            dims = [round(x * s, 3) for x in dims0]
            author = (info.get('user') or {}).get('displayName') or (info.get('user') or {}).get('username')
            man[lid] = {'file': f'{lid}/{lid}.glb', 'name': info.get('name'), 'bytes': os.path.getsize(out), 'srcTris': poly, 'tris': tris,
                        'dims': dims, 'authors': [author], 'license': lic.get('label') or slug, 'source': info.get('viewerUrl') or f'https://sketchfab.com/3d-models/{uid}', 'scale': round(s, 5)}
            credits.append(f"- **{lid}** — “{info.get('name')}” by {author}, {lic.get('label') or slug} — {man[lid]['source']}")
            print(f'✓ {lid:24s} {os.path.getsize(out) // 1024:6d} KB  tris {poly} → {tris}  dims {dims}  scale {s:.4f}')
        except subprocess.CalledProcessError as e:
            print(f'✗ {lid}: {e.output.decode()[-400:] if getattr(e, "output", None) else e}')
        except Exception as e:  # keep going
            print(f'✗ {lid}: {e}')
    json.dump(man, open(man_p, 'w'), indent=1, sort_keys=True)
    if credits:
        cp = os.path.join(OUT, 'CREDITS.md')
        txt = open(cp).read() if os.path.exists(cp) else '# Model credits\n'
        if '## Sketchfab (CC-BY / CC0)' not in txt:
            txt += '\n## Sketchfab (CC-BY / CC0)\nModels downloaded with scripts/sketchfab.py; scaled, simplified and re-encoded (WebP textures, meshopt).\n'
        for c in credits:
            key = c.split('**')[1]
            txt = '\n'.join(l for l in txt.split('\n') if f'**{key}**' not in l)
            txt += c + '\n'
        open(cp, 'w').write(txt)

def _scale_glb(src, dst, s):
    """Wrap every scene root in a scaled node (pure glTF JSON edit, binary chunk untouched)."""
    import struct
    b = open(src, 'rb').read()
    magic, ver, length = struct.unpack_from('<III', b, 0)
    jlen, jtype = struct.unpack_from('<II', b, 12)
    js = json.loads(b[20:20 + jlen].decode())
    rest = b[20 + jlen:]
    nodes = js.setdefault('nodes', [])
    for scene in js.get('scenes', []):
        roots = scene.get('nodes', [])
        nodes.append({'name': 'realscale', 'scale': [s, s, s], 'children': roots})
        scene['nodes'] = [len(nodes) - 1]
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    out = struct.pack('<III', magic, ver, 12 + 8 + len(jb) + len(rest)) + struct.pack('<II', len(jb), jtype) + jb + rest
    open(dst, 'wb').write(out)

if __name__ == '__main__':
    main()
