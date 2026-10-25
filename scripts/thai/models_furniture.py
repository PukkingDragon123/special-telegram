"""Thai street furniture: plastic stool (เก้าอี้พลาสติก), folding steel table with plastic top."""
import bpy, bmesh, math
from mathutils import Vector
import common as C
from registry import model

PI = math.pi
PP = {'albedo': 'props/plastic_pp_red.jpg', 'normal': 'props/plastic_pp_n.jpg', 'rough': 'props/plastic_pp_r.jpg'}


def superellipse(a, b, n, t):
    c, s = math.cos(t), math.sin(t)
    return (a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s))


def loft(name, rings, N=96, mat=None, close_center=False):
    """rings: list of (a, b, n, z) superellipse sections, bottom → top. Quad strip surface (open)."""
    bm = bmesh.new()
    vs = []
    for a, b, n, z in rings:
        vs.append([bm.verts.new((*superellipse(a, b, n, 2 * PI * j / N + PI / 4), z)) for j in range(N)])
    for i in range(len(rings) - 1):
        for j in range(N):
            bm.faces.new([vs[i][j], vs[i][(j + 1) % N], vs[i + 1][(j + 1) % N], vs[i + 1][j]])
    bm.normal_update()
    return C.mesh_obj(name, bm, mat)


@model('thai_stool', cat='furniture', title='Thai plastic stool (เก้าอี้พลาสติก)', tags=['stool', 'plastic', 'thai', 'seat', 'street-food', 'red'],
       phys='dynamic', mass=0.75, friction=0.55, tint=True, bake=768, low=2600, tex=512, tris=3000, far=0.9)
def thai_stool():
    H = 0.43          # top of the skirt (seat surface ~0.445 with the dome)
    red = C.pbr('pp_red', files=PP, tile=0.22, rough_mul=0.95, metal=0.0, nstr=0.6,
                w=dict(dirt=0.55, grime=0.25, streak=0.15, wear=0.25, dirt_col=(0.16, 0.08, 0.06), seed=1.3))
    band = C.pbr('pp_band', files={'albedo': 'props/stool_band_floral_red.jpg', 'normal': 'props/plastic_pp_n.jpg', 'rough': 'props/plastic_pp_r.jpg'},
                 tile=1.0, nstr=0.6, metal=0.0, w=dict(dirt=0.45, grime=0.2, dirt_col=(0.16, 0.08, 0.06), seed=1.3))
    # band texture: one repeat ≈ 0.36 m wide x 0.047 m high
    mp = next(n for n in band.node_tree.nodes if n.type == 'MAPPING')
    mp.inputs['Scale'].default_value = (1 / 0.36, 1 / 0.047, 1); mp.inputs['Location'].default_value = (0, -0.372 / 0.047, 0)
    rings = []
    # skirt: flared, squarer at the feet
    for k in range(15):
        z = H * k / 14
        f = (1 - z / H)
        a = 0.150 + 0.036 * f ** 1.5
        n = 3.7 + 1.1 * f
        rings.append((a, a, n, z))
    # rolled lip, then the slightly domed seat with the grip hole
    rings += [(0.1555, 0.1555, 3.7, H + 0.006), (0.1545, 0.1545, 3.7, H + 0.011), (0.148, 0.148, 3.7, H + 0.0135)]
    for k in range(1, 9):
        s = 1 - k / 9
        a = 0.016 + (0.146 - 0.016) * s
        n = 2.0 + 1.7 * s
        rings.append((a, a, n, H + 0.0135 + 0.006 * (1 - s * s)))
    rings.append((0.0165, 0.0165, 2.0, H + 0.0195 - 0.004))
    shell = loft('stool', rings, 96, red)
    C.solidify(shell, 0.0035, -1)
    C.apply_mods(shell)
    # ---- arch openings (front/back and left/right) + raised middle of the bottom band (feet)
    def arch_cutter(nm, rot):
        w0, w1, z0, z1, rr = 0.20, 0.16, 0.052, 0.285, 0.055
        pts = []
        for k in range(9):   # rounded top
            t = PI * k / 8
            pts.append((w1 / 2 - rr + rr * math.cos(t) if t < PI / 2 else -w1 / 2 + rr + rr * math.cos(t), z1 - rr + rr * math.sin(t)))
        pts = [(w0 / 2, z0)] + [(x, z) for x, z in sorted(pts, key=lambda p: -p[0])] + [(-w0 / 2, z0)]
        bm = bmesh.new()
        top = [bm.verts.new((x, -0.4, z)) for x, z in pts]
        bot = [bm.verts.new((x, 0.4, z)) for x, z in pts]
        bm.faces.new(top[::-1]); bm.faces.new(bot)
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new([top[i], top[j], bot[j], bot[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = C.mesh_obj(nm, bm)
        o.rotation_euler = rot; C.apply_xform(o)
        return o
    def notch(nm, rot):
        o = C.rbox(nm, 0.27, 0.8, 0.034, (0, 0, -0.02), bev=0.008, segs=3)
        o.rotation_euler = rot; C.apply_xform(o)
        return o
    cutters = [arch_cutter('cy', (0, 0, 0)), arch_cutter('cx', (0, 0, PI / 2)), notch('ny', (0, 0, 0)), notch('nx', (0, 0, PI / 2))]
    for ct in cutters:
        m = shell.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = ct; m.solver = 'EXACT'
        C.apply_mods(shell)
        bpy.data.objects.remove(ct)
    C.bevel(shell, 0.0016, 2, 50, harden=False)
    C.apply_mods(shell)
    C.smooth(shell, 50)
    C.uv_cyl(shell, k=1.0)
    # band material on the outer faces just under the lip
    shell.data.materials.clear(); shell.data.materials.append(red); shell.data.materials.append(band)
    for p in shell.data.polygons:
        c = p.center
        rad = Vector((c.x, c.y, 0)).normalized()
        p.material_index = 1 if (0.372 < c.z < 0.419 and p.normal.dot(rad) > 0.4) else 0
    # ---- moulded logo sticker on the front
    logo = C.label_mat('logo', 'textures/props/stool_logo_esqube.png', rough=0.4)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    W, Hh, zc = 0.086, 0.033, 0.335
    a_at = lambda z: 0.150 + 0.036 * (1 - z / H) ** 1.5
    vs = []
    for i in range(9):
        row = []
        for j in range(5):
            u, v = i / 8, j / 4
            x = (u - 0.5) * W; z = zc + (v - 0.5) * Hh
            y = -(a_at(z) + 0.0012)
            row.append(bm.verts.new((x, y, z)))
        vs.append(row)
    for i in range(8):
        for j in range(4):
            f = bm.faces.new([vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]])
            for l, (uu, vv) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]): l[uvl].uv = (uu / 8, vv / 4)
    bm.normal_update()
    lg = C.mesh_obj('logo', bm, logo)
    # cut the oval: drop corner faces whose centre lies outside the ellipse
    me = lg.data
    bm = bmesh.new(); bm.from_mesh(me)
    kill = [f for f in bm.faces if ((f.calc_center_median().x / (W / 2)) ** 2 + ((f.calc_center_median().z - zc) / (Hh / 2)) ** 2) > 1.05]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        if p.normal.y > 0: p.flip()
    return [shell, lg]
