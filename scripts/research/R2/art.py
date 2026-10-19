"""Reusable illustration pieces for parody labels (mountains, mascots, emblems, seals)."""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

import labelkit as K


def soft_ellipse(im, box, fill):
    """Alpha-blended ellipse on an RGBA image (ImageDraw does not blend on RGBA targets)."""
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([int(v) for v in box], fill=fill)
    im.alpha_composite(ov)


def ridge(x0, x1, base_y, peaks, rough=0.08, seed=0, steps=7):
    """Mountain ridge polyline using midpoint displacement between given peak points."""
    rnd = random.Random(seed)
    pts = [(x0, base_y)] + peaks + [(x1, base_y)]
    for s in range(steps):
        new = []
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            mx, my = (ax + bx) / 2, (ay + by) / 2
            d = math.hypot(bx - ax, by - ay)
            my += rnd.uniform(-1, 1) * d * rough / (1 + s * 0.35)
            new += [(ax, ay), (mx, my)]
        new.append(pts[-1])
        pts = new
    return pts


def _jag(a, b, rough, rnd, steps=5):
    pts = [a, b]
    for s_ in range(steps):
        out = []
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            mx, my = (ax + bx) / 2, (ay + by) / 2
            dd = math.hypot(bx - ax, by - ay)
            nx, ny = -(by - ay) / (dd + 1e-6), (bx - ax) / (dd + 1e-6)
            off = rnd.uniform(-1, 1) * dd * rough
            out += [(ax, ay), (mx + nx * off, my + ny * off)]
        out.append(pts[-1])
        pts = out
    return pts


def mountain(w, h, metal_kind="silver", seed=3, snow=True, sun=True, sun_col=("#fff07a", "#ff9a1f")):
    """Stylised triple-peak mountain logo: metallic lit/shadow faces, jagged snow caps, sun with rays."""
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    if sun:
        cx, cy, r = w * 0.70, h * 0.30, h * 0.20
        for i in range(24):
            a0 = i / 24 * math.pi * 2
            a1 = a0 + math.pi / 48
            d.polygon([(cx, cy), (cx + math.cos(a0) * r * 2.6, cy + math.sin(a0) * r * 2.6),
                       (cx + math.cos(a1) * r * 2.6, cy + math.sin(a1) * r * 2.6)], fill=K.C(sun_col[0], 90))
        sg = K.rad_grad(int(r * 2), int(r * 2), [(0, sun_col[0]), (0.8, sun_col[1]), (0.97, sun_col[1]),
                                                 (1, "#ff9a1f00")])
        im.alpha_composite(sg, (int(cx - r), int(cy - r)))
    peaks = [(0.27, 0.34, 0.30, 0.80, seed + 1), (0.75, 0.40, 0.30, 0.86, seed + 2), (0.50, 0.06, 0.40, 1.0, seed)]
    for (px, top, hw, shade, sd) in peaks:
        r2 = random.Random(sd)
        apex = (w * px, h * top)
        lb, rb = (w * (px - hw), h * 1.02), (w * (px + hw), h * 1.02)
        left = _jag(lb, apex, 0.05, r2)
        right = _jag(apex, rb, 0.05, r2)
        poly = left + right[1:]
        m = K.poly_mask((w, h), poly)
        tex = K.metal(w, h, metal_kind, seed=sd, angle=75)
        arr = np.asarray(tex, np.float32)
        arr[..., :3] *= shade
        tex = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        lay.paste(tex, (0, 0), m)
        ld = ImageDraw.Draw(lay, "RGBA")
        # shadow face (right of a crease running down from apex)
        crease = _jag(apex, (w * (px + hw * 0.18), h * 1.02), 0.06, r2)
        shadow_poly = crease + list(reversed(right))
        sm = ImageChops.multiply(K.poly_mask((w, h), shadow_poly), m)
        lay.paste((40, 46, 60, 255), (0, 0), sm.point(lambda v: v * 95 // 255))
        # secondary creases
        for k in range(4):
            sx = apex[0] + r2.uniform(-0.6, 0.9) * hw * w * 0.5
            sy = apex[1] + r2.uniform(0.15, 0.35) * (h - apex[1])
            cl = _jag((sx, sy), (sx + r2.uniform(-0.05, 0.08) * w, h * 1.02), 0.08, r2, 4)
            ld.line(cl, fill=(30, 35, 48, 70), width=max(1, w // 220))
        if snow:
            depth = (h - apex[1]) * 0.30
            lx = apex[0] - hw * w * 0.33
            rx = apex[0] + hw * w * 0.33
            edge = _jag((lx, apex[1] + depth * 0.95), (rx, apex[1] + depth * 1.05), 0.18, r2, 4)
            snow_poly = [apex] + edge
            snm = ImageChops.multiply(K.poly_mask((w, h), snow_poly), m)
            lay.paste((252, 253, 255, 255), (0, 0), snm)
            shm = ImageChops.multiply(snm, K.poly_mask((w, h), crease + [(w * 2, h * 1.02), (w * 2, 0)]))
            lay.paste((170, 186, 210, 255), (0, 0), shm)
        im.alpha_composite(lay)
    return im


def chef_face(size, skin="#f1c08c", hat=True, mustache=True, seed=0, outline="#3a1d0e"):
    """Cartoon chef-uncle head in vintage label style (outlined, flat + soft shading)."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    lw = max(2, S // 70)
    oc = K.C(outline)
    # neck & collar
    d.rounded_rectangle([S * 0.30, S * 0.78, S * 0.70, S * 1.05], radius=S * 0.08, fill=K.C("#ffffff"), outline=oc,
                        width=lw)
    d.polygon([(S * 0.42, S * 0.80), (S * 0.5, S * 0.92), (S * 0.58, S * 0.80)], fill=K.C("#d4161c"), outline=oc)
    # face
    face_box = [S * 0.24, S * 0.30, S * 0.76, S * 0.86]
    d.ellipse(face_box, fill=K.C(skin), outline=oc, width=lw)
    shade = K.rad_grad(S, S, [(0, "#00000000"), (0.7, "#00000000"), (1, "#8a4a2055")], cx=0.45, cy=0.5, rx=0.32)
    fm = K.ellipse_mask((S, S), face_box)
    im.paste(shade, (0, 0), ImageChops.multiply(fm, shade.getchannel("A")))
    # ears
    for ex in (0.22, 0.78):
        d.ellipse([S * (ex - 0.05), S * 0.52, S * (ex + 0.05), S * 0.66], fill=K.C(skin), outline=oc, width=lw)
    # eyes (happy closed arcs) + brows
    for ex in (0.40, 0.60):
        d.arc([S * (ex - 0.06), S * 0.50, S * (ex + 0.06), S * 0.60], 200, 340, fill=oc, width=lw + 1)
        d.line([S * (ex - 0.06), S * 0.46, S * (ex + 0.05), S * 0.445], fill=oc, width=lw + 1)
    # cheeks
    for ex in (0.34, 0.66):
        soft_ellipse(im, [S * (ex - 0.045), S * 0.62, S * (ex + 0.045), S * 0.68], (232, 110, 90, 110))
    # nose
    d.ellipse([S * 0.46, S * 0.56, S * 0.54, S * 0.65], fill=K.C("#e9a774"), outline=oc, width=max(1, lw - 1))
    # big smile
    d.chord([S * 0.38, S * 0.62, S * 0.62, S * 0.80], 10, 170, fill=K.C("#7a1a12"), outline=oc, width=lw)
    d.chord([S * 0.43, S * 0.70, S * 0.57, S * 0.80], 20, 160, fill=K.C("#e8655a"))
    if mustache:
        for sgn in (-1, 1):
            pts = [(S * 0.5, S * 0.645), (S * (0.5 + sgn * 0.05), S * 0.625), (S * (0.5 + sgn * 0.13), S * 0.66),
                   (S * (0.5 + sgn * 0.16), S * 0.625), (S * (0.5 + sgn * 0.14), S * 0.69),
                   (S * (0.5 + sgn * 0.06), S * 0.675)]
            d.polygon(pts, fill=K.C("#2a160c"))
    if hat:
        # chef hat: puffs + band
        d.rounded_rectangle([S * 0.27, S * 0.26, S * 0.73, S * 0.38], radius=S * 0.03, fill=K.C("#ffffff"), outline=oc,
                            width=lw)
        for (cx, cy, r) in [(0.33, 0.20, 0.11), (0.5, 0.13, 0.14), (0.67, 0.20, 0.11), (0.42, 0.17, 0.1),
                            (0.58, 0.17, 0.1)]:
            d.ellipse([S * (cx - r), S * (cy - r), S * (cx + r), S * (cy + r)], fill=K.C("#ffffff"), outline=oc,
                      width=lw)
        d.rectangle([S * 0.28, S * 0.22, S * 0.72, S * 0.30], fill=K.C("#ffffff"))
        d.line([S * 0.27, S * 0.30, S * 0.73, S * 0.30], fill=oc, width=lw)
        hs = K.lin_grad(S, S, [(0, "#00000000"), (0.6, "#00000000"), (1, "#6070903a")], angle=0)
        hm = Image.new("L", (S, S), 0)
        ImageDraw.Draw(hm).rectangle([S * 0.25, 0, S * 0.75, S * 0.38], fill=255)
        im.paste(hs, (0, 0), ImageChops.multiply(ImageChops.multiply(hm, im.getchannel("A")), hs.getchannel("A")))
    return im


def baby_face(size, skin="#f6c9a0", outline="#5a2a12"):
    """Chubby baby mascot (head + shoulders) for the soy-sauce parody."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    lw = max(2, S // 80)
    oc = K.C(outline)
    # body / bib
    d.ellipse([S * 0.18, S * 0.66, S * 0.82, S * 1.25], fill=K.C(skin), outline=oc, width=lw)
    d.chord([S * 0.30, S * 0.70, S * 0.70, S * 1.05], 0, 180, fill=K.C("#2e8b3d"), outline=oc, width=lw)
    d.text((S * 0.5, S * 0.86), "อิ่ม", font=K.F("Kanit-Black", S * 0.08), fill=K.C("#ffe14d"), anchor="mm")
    # head
    hb = [S * 0.20, S * 0.10, S * 0.80, S * 0.74]
    d.ellipse(hb, fill=K.C(skin), outline=oc, width=lw)
    sh = K.rad_grad(S, S, [(0, "#00000000"), (0.72, "#00000000"), (1, "#b0603040")], cx=0.48, cy=0.42, rx=0.31)
    m = K.ellipse_mask((S, S), hb)
    im.paste(sh, (0, 0), ImageChops.multiply(m, sh.getchannel("A")))
    # hair tuft
    d.arc([S * 0.42, S * 0.02, S * 0.58, S * 0.20], 120, 360, fill=oc, width=lw + 2)
    d.arc([S * 0.47, S * 0.04, S * 0.62, S * 0.18], 160, 400, fill=oc, width=lw + 1)
    # ears
    for ex in (0.19, 0.81):
        d.ellipse([S * (ex - 0.05), S * 0.38, S * (ex + 0.05), S * 0.52], fill=K.C(skin), outline=oc, width=lw)
    # eyes: big round with highlight
    for ex in (0.39, 0.61):
        d.ellipse([S * (ex - 0.055), S * 0.36, S * (ex + 0.055), S * 0.47], fill=K.C("#1d0f08"))
        d.ellipse([S * (ex - 0.025), S * 0.375, S * (ex + 0.0), S * 0.405], fill=K.C("#ffffff"))
    # cheeks
    for ex in (0.31, 0.69):
        soft_ellipse(im, [S * (ex - 0.06), S * 0.48, S * (ex + 0.06), S * 0.56], (240, 120, 110, 120))
    # mouth
    d.chord([S * 0.42, S * 0.50, S * 0.58, S * 0.62], 0, 180, fill=K.C("#a3241a"), outline=oc, width=lw)
    d.ellipse([S * 0.47, S * 0.555, S * 0.53, S * 0.60], fill=K.C("#f07b6b"))
    # nose
    d.arc([S * 0.47, S * 0.44, S * 0.53, S * 0.50], 20, 160, fill=oc, width=lw)
    return im


def auntie_face(size, skin="#e9b285", outline="#3b1a0c"):
    """Smiling auntie cook (hair bun, earrings) for the oyster-sauce parody medallion."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    lw = max(2, S // 80)
    oc = K.C(outline)
    # shoulders (blue blouse + apron strap)
    d.chord([S * 0.12, S * 0.70, S * 0.88, S * 1.35], 180, 360, fill=K.C("#1f4fa0"), outline=oc, width=lw)
    d.polygon([(S * 0.36, S * 0.80), (S * 0.64, S * 0.80), (S * 0.60, S * 1.0), (S * 0.40, S * 1.0)],
              fill=K.C("#ffffff"), outline=oc)
    # neck
    d.rectangle([S * 0.44, S * 0.66, S * 0.56, S * 0.80], fill=K.C(skin), outline=oc, width=lw)
    # hair back + bun
    d.ellipse([S * 0.40, S * 0.02, S * 0.60, S * 0.20], fill=K.C("#1a0f0a"), outline=oc, width=lw)
    d.ellipse([S * 0.24, S * 0.12, S * 0.76, S * 0.62], fill=K.C("#1a0f0a"))
    # face
    fb = [S * 0.28, S * 0.20, S * 0.72, S * 0.74]
    d.ellipse(fb, fill=K.C(skin), outline=oc, width=lw)
    sh = K.rad_grad(S, S, [(0, "#00000000"), (0.7, "#00000000"), (1, "#7a3a1848")], cx=0.46, cy=0.47, rx=0.27)
    im.paste(sh, (0, 0), ImageChops.multiply(K.ellipse_mask((S, S), fb), sh.getchannel("A")))
    # fringe
    d.chord([S * 0.27, S * 0.16, S * 0.73, S * 0.44], 180, 360, fill=K.C("#1a0f0a"))
    # eyes smiling
    for ex in (0.41, 0.59):
        d.arc([S * (ex - 0.05), S * 0.42, S * (ex + 0.05), S * 0.50], 200, 340, fill=oc, width=lw + 1)
    # brows
    for ex in (0.41, 0.59):
        d.arc([S * (ex - 0.05), S * 0.37, S * (ex + 0.05), S * 0.43], 210, 330, fill=oc, width=lw)
    # cheeks + lips
    for ex in (0.35, 0.65):
        soft_ellipse(im, [S * (ex - 0.04), S * 0.52, S * (ex + 0.04), S * 0.57], (225, 100, 90, 110))
    d.chord([S * 0.43, S * 0.56, S * 0.57, S * 0.68], 0, 180, fill=K.C("#b8202a"), outline=oc, width=lw)
    d.rectangle([S * 0.455, S * 0.62, S * 0.545, S * 0.635], fill=K.C("#ffffff"))
    d.arc([S * 0.47, S * 0.47, S * 0.53, S * 0.54], 20, 160, fill=oc, width=lw)
    # earrings
    for ex in (0.27, 0.73):
        d.ellipse([S * (ex - 0.02), S * 0.56, S * (ex + 0.02), S * 0.60], fill=K.C("#f2c94c"), outline=oc)
    return im


def seal(size, text_top, text_mid, text_bot, col="#c4161c", ring="gold", font_mid="Chonburi-Regular",
         font_ring="Kanit-Bold", seed=0, txt_col="#ffffff"):
    """Round medal / quality seal with metallic ring and arched text."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ring_tex = K.metal(S, S, ring, seed=seed, angle=60)
    pts = K.star_pts(S / 2, S / 2, S * 0.5, S * 0.465, 40, 0)
    m = K.poly_mask((S, S), pts)
    im.paste(ring_tex, (0, 0), m)
    inner = [S * 0.07, S * 0.07, S * 0.93, S * 0.93]
    m2 = K.ellipse_mask((S, S), inner)
    grad = K.rad_grad(S, S, [(0, K.C(col)), (1, tuple(int(c * 0.65) for c in K.C(col)[:3]) + (255,))], rx=0.45)
    im.paste(grad, (0, 0), m2)
    d = ImageDraw.Draw(im)
    d.ellipse([S * 0.16, S * 0.16, S * 0.84, S * 0.84], outline=K.C("#ffffff", 200), width=max(1, S // 90))
    if text_top:
        K.arc_text(im, (S / 2, S / 2), S * 0.355, text_top, K.F(font_ring, S * 0.085), txt_col, start_deg=-90)
    if text_bot:
        K.arc_text(im, (S / 2, S / 2), S * 0.355, text_bot, K.F(font_ring, S * 0.085), txt_col, start_deg=90,
                   clockwise=False)
    if text_mid:
        f = K.fit(text_mid, font_mid, S * 0.52, S * 0.3, S * 0.22)
        K.text(im, (S / 2, S / 2), text_mid, f, txt_col, stroke=max(1, S // 120), stroke_fill="#00000060")
    return im


def footprint(size, col="#c4161c"):
    """Cartoon footprint logo (for the 'ตราเท้า' pepper parody)."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = K.C(col)
    d.ellipse([S * 0.28, S * 0.30, S * 0.72, S * 0.98], fill=c)
    d.ellipse([S * 0.24, S * 0.42, S * 0.62, S * 0.80], fill=c)
    toes = [(0.30, 0.20, 0.10), (0.45, 0.13, 0.085), (0.58, 0.13, 0.075), (0.69, 0.18, 0.065), (0.77, 0.27, 0.055)]
    for x, y, r in toes:
        d.ellipse([S * (x - r), S * (y - r * 1.2), S * (x + r), S * (y + r * 1.2)], fill=c)
    return im


def silhouette(img_rgba, col="#000000", blur=0.6):
    """Turn a cut-out RGBA photo into a solid silhouette logo."""
    a = img_rgba.getchannel("A").filter(ImageFilter.GaussianBlur(blur)).point(lambda v: 255 if v > 120 else 0)
    out = Image.new("RGBA", img_rgba.size, K.C(col))
    out.putalpha(a)
    return out


def rice_sprig(w, h, col="#d9a520", seed=0, outline=None):
    """Stylised rice ear (grains along a curved stem)."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rnd = random.Random(seed)
    pts = [(w * 0.5 + math.sin(t * 2.2) * w * 0.18 * t, h * (1 - t)) for t in np.linspace(0, 1, 40)]
    d.line(pts, fill=K.C("#7a8a2a"), width=max(2, w // 40))
    for i, (x, y) in enumerate(pts[8::2]):
        for sgn in (-1, 1):
            gx = x + sgn * w * 0.08
            gy = y - h * 0.015
            ang = sgn * 35 + rnd.uniform(-8, 8)
            g = Image.new("RGBA", (int(w * 0.12), int(w * 0.24)), (0, 0, 0, 0))
            gd = ImageDraw.Draw(g)
            gd.ellipse([0, 0, g.width - 1, g.height - 1], fill=K.C(col), outline=K.C(outline) if outline else None)
            gd.line([g.width / 2, g.height * 0.1, g.width / 2, g.height * 0.9], fill=(150, 100, 20, 120), width=1)
            g = g.rotate(ang, expand=True, resample=Image.BICUBIC)
            im.alpha_composite(g, (int(gx - g.width / 2), int(gy - g.height / 2)))
    return im


def fish(w, h, back="#2f4f6f", belly="#f4f7fa", stripe="#c9d6e2", seed=0):
    """Slender anchovy-type fish, facing left, silver body with dark back, lateral stripe, eye, fins."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    up, lo = [], []
    for i in range(41):
        t = i / 40
        x = w * (0.04 + 0.74 * t)
        s = math.sin(math.pi * min(1, t * 1.05)) ** 0.85
        up.append((x, h * 0.5 - h * 0.30 * s * (1 - 0.35 * t)))
        lo.append((x, h * 0.5 + h * 0.24 * s * (1 - 0.35 * t)))
    tail = [(w * 0.76, h * 0.47), (w * 0.98, h * 0.14), (w * 0.90, h * 0.50), (w * 0.98, h * 0.86),
            (w * 0.76, h * 0.53)]
    body = up + tail + list(reversed(lo))
    m = K.poly_mask((w, h), body)
    grad = K.lin_grad(w, h, [(0, back), (0.36, back), (0.47, stripe), (0.55, belly), (1, "#e5ecf2")])
    im.paste(grad, (0, 0), m)
    d = ImageDraw.Draw(im)
    # lateral silver stripe
    d.line([(w * 0.12, h * 0.48), (w * 0.78, h * 0.50)], fill=K.C("#ffffff"), width=max(2, h // 18))
    # scales hint
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for yy in range(int(h * 0.22), int(h * 0.7), max(4, h // 12)):
        for xx in range(int(w * 0.2), int(w * 0.75), max(5, w // 30)):
            od.arc([xx, yy, xx + w // 30, yy + h // 12], 270, 90, fill=(255, 255, 255, 50), width=1)
    ov.putalpha(ImageChops.multiply(ov.getchannel("A"), m))
    im.alpha_composite(ov)
    # fins
    d.polygon([(w * 0.42, h * 0.27), (w * 0.52, h * 0.12), (w * 0.55, h * 0.30)], fill=K.C(back))
    d.polygon([(w * 0.24, h * 0.62), (w * 0.33, h * 0.80), (w * 0.34, h * 0.62)], fill=K.C("#b8c6d4"))
    # gill + eye
    d.arc([w * 0.10, h * 0.30, w * 0.22, h * 0.70], 300, 60, fill=K.C("#5a6f86"), width=max(2, h // 40))
    d.ellipse([w * 0.075, h * 0.40, w * 0.125, h * 0.50], fill=K.C("#ffffff"), outline=K.C("#22303f"))
    d.ellipse([w * 0.088, h * 0.42, w * 0.115, h * 0.48], fill=K.C("#111111"))
    return im


def palm_fruits(w, h, seed=0):
    """Cluster of oil-palm fruits (glossy orange->black ovals)."""
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pts = []
    for i in range(46):
        a = rnd.uniform(0, math.pi * 2)
        r = rnd.uniform(0, 0.36) ** 0.8
        pts.append((0.5 + math.cos(a) * r * 0.9, 0.55 + math.sin(a) * r * 0.75, rnd.uniform(0.08, 0.12)))
    pts.sort(key=lambda p: p[1])
    for (x, y, s) in pts:
        fw, fh = int(w * s), int(w * s * 1.25)
        g = K.rad_grad(fw, fh, [(0, "#ffd36b"), (0.35, "#f2731c"), (0.75, "#9c1d0b"), (1, "#2a0a04")],
                       cx=0.38, cy=0.35, rx=0.7)
        mm = K.ellipse_mask((fw, fh), [0, 0, fw - 1, fh - 1])
        fr = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        fr.paste(g, (0, 0), mm)
        fd = ImageDraw.Draw(fr)
        fd.ellipse([fw * 0.25, fh * 0.15, fw * 0.45, fh * 0.32], fill=(255, 245, 210, 255))
        fr = fr.rotate(rnd.uniform(-40, 40), expand=True, resample=Image.BICUBIC)
        im.alpha_composite(fr, (int(x * w - fr.width / 2), int(y * h - fr.height / 2)))
    # leaves
    d = ImageDraw.Draw(im)
    for sgn in (-1, 1):
        d.polygon([(w * 0.5, h * 0.25), (w * (0.5 + sgn * 0.45), h * 0.02), (w * (0.5 + sgn * 0.2), h * 0.28)],
                  fill=K.C("#2e8b3d"))
    return im


def chili(w, h, col="#d81e1e", stem="#2f7d32", seed=0, curve=0.25):
    """Single bird's-eye chili (horizontal, stem on the left) with glossy highlight."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    up, lo = [], []
    for i in range(31):
        t = i / 30
        x = w * (0.18 + 0.80 * t)
        c = h * curve * math.sin(math.pi * t * 0.9)
        rad = h * 0.30 * (1 - t) ** 0.7 * (0.6 + 0.4 * math.sin(math.pi * min(1, t * 4)))
        up.append((x, h * 0.5 - rad + c))
        lo.append((x, h * 0.5 + rad + c))
    m = K.poly_mask((w, h), up + list(reversed(lo)))
    c = K.C(col)
    dark = tuple(int(v * 0.55) for v in c[:3]) + (255,)
    g = K.lin_grad(w, h, [(0, dark), (0.35, c), (0.5, tuple(min(255, int(v * 1.25)) for v in c[:3]) + (255,)),
                          (0.75, c), (1, dark)])
    im.paste(g, (0, 0), m)
    d = ImageDraw.Draw(im)
    hl = [(x, y + h * 0.08) for (x, y) in up[2:20]]
    d.line(hl, fill=(255, 255, 255, 190), width=max(1, h // 14))
    d.polygon([(w * 0.02, h * 0.42), (w * 0.20, h * 0.36), (w * 0.24, h * 0.5), (w * 0.20, h * 0.64),
               (w * 0.02, h * 0.58)], fill=K.C(stem))
    d.line([(0, h * 0.5), (w * 0.08, h * 0.5)], fill=K.C(stem), width=max(2, h // 10))
    return im


def flames(w, h, seed=0, cols=("#fff27a", "#ffb31a", "#f2541b", "#b3120e")):
    """Stylised flame band (stacked jagged tongues), transparent background."""
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for li, col in enumerate(reversed(cols)):
        sc = 1 - li * 0.2
        pts = [(0, h)]
        n = 9
        for i in range(n):
            x0 = w * i / n
            tip = h * (1 - sc * rnd.uniform(0.65, 1.0))
            pts += [(x0 + w / n * 0.15, h * (1 - sc * 0.3)), (x0 + w / n * rnd.uniform(0.35, 0.65), tip),
                    (x0 + w / n * 0.85, h * (1 - sc * 0.3))]
        pts.append((w, h))
        m = K.poly_mask((w, h), pts).filter(ImageFilter.GaussianBlur(1.5))
        lay = Image.new("RGBA", (w, h), K.C(col))
        lay.putalpha(m)
        im.alpha_composite(lay)
    return im


def sugarcane(w, h, seed=0):
    """Two sugar-cane stalks with nodes and leaves (vintage illustration)."""
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k, (x, tilt) in enumerate([(0.38, -0.05), (0.62, 0.06)]):
        sw = w * 0.13
        x0 = w * x
        for y in range(int(h * 0.12), h, int(h * 0.14)):
            seg = [x0 - sw / 2 + tilt * y, y, x0 + sw / 2 + tilt * y, y + h * 0.14]
            g = K.lin_grad(int(sw), int(h * 0.14), [(0, "#6e8f2a"), (0.4, "#c8d86a"), (1, "#5c7a22")], angle=0)
            im.paste(g, (int(seg[0]), int(seg[1])))
            d.line([seg[0], seg[1], seg[2], seg[1]], fill=K.C("#46601a"), width=max(2, h // 90))
            d.ellipse([seg[0] + sw * 0.4, seg[1] - h * 0.006, seg[0] + sw * 0.6, seg[1] + h * 0.01],
                      fill=K.C("#e6dc8c"))
        for j in range(4):
            ly = h * (0.1 + 0.18 * j)
            sgn = 1 if (j + k) % 2 else -1
            d.polygon([(x0 + tilt * ly, ly), (x0 + sgn * w * 0.45 + tilt * ly, ly - h * 0.1),
                       (x0 + sgn * w * 0.12 + tilt * ly, ly + h * 0.03)], fill=K.C("#3f8f3a"))
    return im


def bowl_logo(size, col="#d4161c", text="อร่อย", font="Kanit-Black"):
    """Red bowl with steam (MSG parody logo)."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.chord([S * 0.08, S * 0.18, S * 0.92, S * 0.90], 0, 180, fill=K.C(col))
    d.rectangle([S * 0.36, S * 0.86, S * 0.64, S * 0.93], fill=K.C(col))
    d.ellipse([S * 0.08, S * 0.46, S * 0.92, S * 0.62], fill=K.C("#7d0a0d"))
    d.arc([S * 0.08, S * 0.46, S * 0.92, S * 0.62], 0, 360, fill=K.C(col), width=max(2, S // 40))
    for i, x in enumerate((0.36, 0.5, 0.64)):
        pts = [(S * x + math.sin(t * 6 + i) * S * 0.03, S * (0.42 - t * 0.38)) for t in np.linspace(0, 1, 20)]
        d.line(pts, fill=K.C(col), width=max(3, S // 28))
    K.text(im, (S * 0.5, S * 0.72), text, K.F(font, S * 0.17), "#ffffff")
    return im


def hand_phone(size, col="#ffffff"):
    """Hand holding a phone (cha-yen 'ตรามือถือ' logo), flat icon."""
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = K.C(col)
    d.rounded_rectangle([S * 0.36, S * 0.08, S * 0.66, S * 0.62], radius=S * 0.05, outline=c, width=max(3, S // 22))
    d.rectangle([S * 0.41, S * 0.16, S * 0.61, S * 0.52], fill=c)
    d.ellipse([S * 0.49, S * 0.55, S * 0.53, S * 0.59], fill=c)
    # palm + fingers
    d.rounded_rectangle([S * 0.26, S * 0.46, S * 0.70, S * 0.86], radius=S * 0.12, fill=c)
    for i in range(3):
        d.rounded_rectangle([S * (0.60 + 0.0), S * (0.30 + i * 0.1), S * 0.78, S * (0.38 + i * 0.1)],
                            radius=S * 0.04, fill=c)
    d.rounded_rectangle([S * 0.18, S * 0.40, S * 0.32, S * 0.62], radius=S * 0.06, fill=c)
    d.rectangle([S * 0.36, S * 0.84, S * 0.64, S * 0.98], fill=c)
    return im


def orange_slice(size, col="#ff9a1a", seed=0):
    S = int(size)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, S - 1, S - 1], fill=K.C("#f27a00"))
    d.ellipse([S * 0.04, S * 0.04, S * 0.96, S * 0.96], fill=K.C("#fff1c9"))
    n = 10
    for i in range(n):
        a0 = i / n * math.pi * 2 + 0.05
        a1 = (i + 1) / n * math.pi * 2 - 0.05
        pts = [(S / 2 + math.cos(a0) * S * 0.04, S / 2 + math.sin(a0) * S * 0.04)]
        for t in np.linspace(a0, a1, 8):
            pts.append((S / 2 + math.cos(t) * S * 0.42, S / 2 + math.sin(t) * S * 0.42))
        g = K.rad_grad(S, S, [(0, "#ffd36a"), (0.6, col), (1, "#f06b00")], rx=0.45)
        m = K.poly_mask((S, S), pts)
        im.paste(g, (0, 0), m)
    rnd = random.Random(seed)
    for _ in range(30):
        a = rnd.uniform(0, math.pi * 2)
        r = rnd.uniform(0.1, 0.38) * S
        x, y = S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r
        soft_ellipse(im, [x - S * 0.012, y - S * 0.025, x + S * 0.012, y + S * 0.025], (255, 255, 255, 110))
    return im


def strawberry(size, seed=0):
    S = int(size)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pts = []
    for i in range(60):
        t = i / 60 * math.pi * 2
        x = math.sin(t)
        y = -math.cos(t)
        r = 0.42 * (1 - 0.35 * max(0, y)) * (1 + 0.08 * math.cos(t * 2))
        pts.append((S * (0.5 + x * r), S * (0.55 + y * 0.42 * (1.0 if y < 0 else 1.05))))
    m = K.poly_mask((S, S), pts)
    g = K.rad_grad(S, S, [(0, "#ff6a6a"), (0.5, "#e01b2a"), (1, "#8c0612")], cx=0.4, cy=0.45, rx=0.5)
    im.paste(g, (0, 0), m)
    d = ImageDraw.Draw(im)
    rnd = random.Random(seed)
    for _ in range(40):
        x, y = rnd.uniform(0.2, 0.8) * S, rnd.uniform(0.25, 0.9) * S
        if m.getpixel((int(x), int(y))) > 200:
            d.ellipse([x - S * 0.012, y - S * 0.018, x + S * 0.012, y + S * 0.018], fill=K.C("#ffe27a"))
    for i in range(6):
        a = math.pi * (0.1 + i / 5 * 0.8)
        d.polygon([(S * 0.5, S * 0.15), (S * (0.5 + math.cos(a) * 0.3), S * (0.13 + math.sin(a) * 0.08)),
                   (S * (0.5 + math.cos(a + 0.2) * 0.18), S * 0.2)], fill=K.C("#2e9b3a"))
    return im


def unicorn_head(size, col="#ffffff"):
    """Unicorn head profile silhouette (facing right) for the LPG parody logo."""
    S = int(size)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pts = [(0.30, 0.95), (0.33, 0.70), (0.36, 0.55), (0.40, 0.42), (0.44, 0.33), (0.50, 0.27), (0.56, 0.24),
           (0.60, 0.20), (0.62, 0.10), (0.66, 0.20), (0.70, 0.27), (0.78, 0.38), (0.88, 0.50), (0.93, 0.58),
           (0.92, 0.64), (0.86, 0.66), (0.78, 0.62), (0.70, 0.60), (0.62, 0.66), (0.58, 0.78), (0.60, 0.95)]
    d = ImageDraw.Draw(im)
    d.polygon([(S * x, S * y) for x, y in pts], fill=K.C(col))
    # horn
    d.polygon([(S * 0.66, S * 0.25), (S * 0.86, S * 0.02), (S * 0.71, S * 0.30)], fill=K.C(col))
    # mane
    for i in range(6):
        y = 0.30 + i * 0.1
        d.polygon([(S * (0.40 - i * 0.015), S * y), (S * (0.22 - i * 0.01), S * (y + 0.04)),
                   (S * (0.36 - i * 0.015), S * (y + 0.1))], fill=K.C(col))
    # eye (cut out)
    d.ellipse([S * 0.66, S * 0.36, S * 0.71, S * 0.40], fill=(0, 0, 0, 0))
    return im


def lamp_emblem(size, gold_seed=3):
    """Dim oil-lamp emblem with rays (whisky parody)."""
    S = int(size)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g = K.metal(S, S, "gold", seed=gold_seed, angle=70)
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    for i in range(16):
        a = -math.pi / 2 + (i - 7.5) / 16 * math.pi * 0.9
        d.polygon([(S * 0.5, S * 0.42), (S * 0.5 + math.cos(a - 0.04) * S * 0.48, S * 0.42 + math.sin(a - 0.04) * S * 0.48),
                   (S * 0.5 + math.cos(a + 0.04) * S * 0.48, S * 0.42 + math.sin(a + 0.04) * S * 0.48)], fill=120)
    d.ellipse([S * 0.40, S * 0.22, S * 0.60, S * 0.46], fill=255)
    d.chord([S * 0.18, S * 0.48, S * 0.82, S * 0.86], 0, 180, fill=255)
    d.rectangle([S * 0.18, S * 0.62, S * 0.82, S * 0.67], fill=255)
    d.rectangle([S * 0.44, S * 0.44, S * 0.56, S * 0.66], fill=255)
    im.paste(g, (0, 0), m)
    return im
