import json, struct, sys
f = open(sys.argv[1], 'rb').read()
magic, ver, length = struct.unpack('<4sII', f[:12])
jl, jt = struct.unpack('<II', f[12:20])
J = json.loads(f[20:20 + jl])
bv = J.get('bufferViews', [])
acc = J.get('accessors', [])
def bvsize(i): return bv[i]['byteLength'] if i is not None and i < len(bv) else 0
anim_bytes = 0
for a in J.get('animations', []):
    s = 0
    for smp in a['samplers']:
        for k in ('input', 'output'):
            s += bvsize(acc[smp[k]].get('bufferView'))
    anim_bytes += s
    print('ANIM', a.get('name'), len(a['channels']), 'channels', s // 1024, 'KB')
img = sum(bvsize(i.get('bufferView')) for i in J.get('images', []))
mesh = 0
for m in J.get('meshes', []):
    for p in m['primitives']:
        for k, v in p['attributes'].items(): mesh += bvsize(acc[v].get('bufferView'))
        if 'indices' in p: mesh += bvsize(acc[p['indices']].get('bufferView'))
print('nodes', len(J.get('nodes', [])), 'skins', [len(s['joints']) for s in J.get('skins', [])])
print('TOTAL', length // 1024, 'KB  anim', anim_bytes // 1024, 'KB  images', img // 1024, 'KB  mesh', mesh // 1024, 'KB')
for i in J.get('images', []): print('IMG', i.get('name'), i.get('mimeType'), bvsize(i.get('bufferView')) // 1024, 'KB')
for m in J.get('materials', []): print('MAT', m.get('name'), list(m.get('pbrMetallicRoughness', {}).keys()), [k for k in m if 'Texture' in k])
