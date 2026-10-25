# Rewrite only the JSON chunk of a GLB (no Blender round-trip — Blender breaks some FBX-derived rigs):
#   python3 -I scripts/life/glb_root_fix.py <in.glb> <out.glb> <rootNodeName> <scale_mul> <rotY_deg> [renameJson]
# multiplies the named root node's scale, pre-rotates it about world Y, renames animations ({"old": "new"}).
import json, struct, sys, math
src, out, root, smul, roty = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
ren = json.loads(sys.argv[6]) if len(sys.argv) > 6 else {}
f = open(src, 'rb').read()
jl, jt = struct.unpack('<II', f[12:20]); J = json.loads(f[20:20 + jl]); rest = f[20 + jl:]
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
for n in J['nodes']:
    if n.get('name') == root:
        if 'matrix' in n:
            M = [n['matrix'][i * 4:(i + 1) * 4] for i in range(4)]          # column-major columns
            c, s_ = math.cos(math.radians(roty)), math.sin(math.radians(roty))
            R = [[c * smul, 0, s_ * smul, 0], [0, smul, 0, 0], [-s_ * smul, 0, c * smul, 0], [0, 0, 0, 1]]  # row-major
            cols = []
            for col in M:
                cols.append([sum(R[r][k] * col[k] for k in range(4)) for r in range(4)])
            n['matrix'] = [v for col in cols for v in col]
            print('fixed matrix', root); continue
        n['scale'] = [s * smul for s in n.get('scale', [1, 1, 1])]
        h = math.radians(roty) / 2
        n['rotation'] = qmul([0, math.sin(h), 0, math.cos(h)], n.get('rotation', [0, 0, 0, 1]))
        if 'translation' in n:
            t = n['translation']; c, s = math.cos(2 * h), math.sin(2 * h)
            n['translation'] = [(t[0] * c + t[2] * s) * smul, t[1] * smul, (-t[0] * s + t[2] * c) * smul]
        print('fixed', root, n['scale'], n['rotation'])
for a in J.get('animations', []):
    for k, v in ren.items():
        if a.get('name', '').startswith(k): a['name'] = v
js = json.dumps(J, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
body = struct.pack('<II', len(js), 0x4E4F534A) + js + rest
open(out, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body)
print('wrote', out, 12 + len(body))
