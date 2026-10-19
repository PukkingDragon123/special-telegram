"""R5-audio sound designs: composites of licensed sources + original synthesis.

Every public function returns (mono_or_stereo_array, [source_paths_used]).
Synth-only designs report the pseudo path ".../design/<name>" so credits mark them as original.
"""
import functools, math, os
import numpy as np
from scipy import signal
import audiolib as A
import synth as S

SR = A.SR
DL = A.DL
MK = os.path.join(DL, "mixkit/wav")
KN = os.path.join(DL, "kenney")
OG = os.path.join(DL, "oga")
SYN = os.path.join(A.WORK, "design")


def mk(i):
    return os.path.join(MK, f"{i}.wav")


def kn(pack, f):
    return os.path.join(KN, f"kenney_{pack}", "Audio", f)


def og(pack, f):
    return os.path.join(OG, pack, f)


def SY(name):
    return os.path.join(SYN, name)


@functools.lru_cache(maxsize=256)
def _load(path, ss, t, ch):
    return A.decode(path, ch=ch, ss=ss, t=t)


def L(path, ss=None, t=None, ch=1):
    return _load(path, ss, t, ch).copy()


def mixdown(n, layers, ch=1):
    """layers: list of (array, t0_seconds, gain_db)."""
    out = np.zeros((n, 2)) if ch == 2 else np.zeros(n)
    for x, t0, g in layers:
        if ch == 2 and x.ndim == 1:
            x = A.stereo(x)
        if ch == 1 and x.ndim == 2:
            x = A.mono(x)
        S.place(out, x * 10 ** (g / 20), t0)
    return out


def env_points(n, pts):
    return S.lin_env(n, pts)


def rngs(seed):
    return np.random.default_rng(seed)


# ======================================================================= COOKING
def sizzle_burst(seed=1, dur=2.0, off=4.0, rate=1.0):
    """Food hitting hot oil: hiss transient + sizzle swell that settles."""
    r = rngs(seed)
    base = L(mk(123), off, dur + 0.5)
    base2 = L(og("household", "fryingpan01.wav"), 5 + (seed * 3.1) % 45, dur + 0.5)
    x = base + 0.6 * base2
    if rate != 1.0:
        x = A.resample_ratio(x, rate)
    n = int(dur * SR)
    x = x[:n]
    e = env_points(n, [(0, 0), (0.012, 1.0), (0.22, 0.85), (0.7, 0.45), (dur * 0.75, 0.25), (dur, 0.0)])
    x = x / (np.max(np.abs(x)) + 1e-9) * e
    # splash hiss transient (wet food meets 200C oil)
    hn = int(0.35 * SR)
    hiss = S.noise(hn) * S.env_exp(hn, 0.07, a=0.004)
    hiss = S.butter(hiss, "highpass", 2500, 2)
    # crackle pops
    pops = np.zeros(n)
    for _ in range(int(14 * dur)):
        t = r.uniform(0.02, dur * 0.8)
        i = int(t * SR)
        m = int(r.uniform(0.0008, 0.003) * SR)
        if i + m < n:
            pops[i:i + m] += r.uniform(0.2, 1.0) * np.hanning(m) * r.choice([-1, 1])
    pops = S.butter(pops, "highpass", 1200, 2) * np.exp(-np.arange(n) / SR / (dur * 0.5))
    out = 0.8 * x + mixdown(n, [(hiss, 0.0, -2)]) + 0.35 * pops
    return out, [mk(123), og("household", "fryingpan01.wav")]


def spatula_scrape(seed=1, dur=0.4):
    """Metal spatula scraping a carbon-steel wok: stick-slip friction into wok/spatula modes + clank."""
    r = rngs(seed)
    n = int(dur * SR)
    # friction excitation: Poisson impulses + band noise, amplitude follows the stroke
    rate = r.uniform(1800, 3200)
    ex = np.zeros(n)
    k = int(rate * dur)
    idx = r.integers(0, n, k)
    ex[idx] += r.standard_normal(k) * r.uniform(0.3, 1.0, k)
    ex += 0.25 * S.butter(r.standard_normal(n), "bandpass", [1500, 9000], 2)
    stroke = env_points(n, [(0, 0), (0.03, 1), (dur * 0.4, r.uniform(0.6, 1.0)), (dur * 0.75, 0.8), (dur, 0)])
    # speed wobble -> slight AM
    stroke *= 1 + 0.25 * np.sin(2 * np.pi * r.uniform(7, 14) * np.arange(n) / SR + r.uniform(0, 6))
    ex *= stroke
    # wok modes (damped by oil/food) + spatula blade modes (brighter, longer)
    wf = np.exp(r.uniform(np.log(500), np.log(9500), 26))
    wd = r.uniform(0.012, 0.06, 26)
    wg = (wf / 1000.0) ** -0.35 * r.uniform(0.4, 1.0, 26)
    sf = np.array([2350, 3910, 5620, 7480]) * r.uniform(0.92, 1.08)
    y = S.resonator_bank(ex, list(wf), list(wd), list(wg))
    y += 0.25 * S.resonator_bank(ex, list(sf), [0.08, 0.07, 0.06, 0.05], [1, 0.7, 0.5, 0.35])
    # squeal: faint gliding stick-slip tone
    f0 = r.uniform(900, 1500)
    gl = S.glide(n, [(0, f0), (dur, f0 * r.uniform(1.1, 1.4))])
    sq = S.sine(gl, n=n) * stroke * 0.05
    y = y / (np.max(np.abs(y)) + 1e-9)
    grit = S.butter(r.standard_normal(n), "bandpass", [1200, 10000], 2) * stroke
    grit = grit / (np.max(np.abs(grit)) + 1e-9)
    y = 0.75 * y + 0.45 * grit + sq
    # initial clank (edge hits the wok)
    imp = np.zeros(int(0.5 * SR))
    imp[0] = 1.0
    cl = S.resonator_bank(imp, [610 * r.uniform(.9, 1.1), 1180, 1930, 2840, 4120], [0.35, 0.3, 0.22, 0.15, 0.1],
                          [1, .8, .6, .45, .3])
    cl = cl / (np.max(np.abs(cl)) + 1e-9)
    out = mixdown(n + len(cl), [(y, 0.0, 0), (cl, 0.0, -9)])
    out = S.butter(out, "highpass", 250, 2)
    return out, [SY("spatula_scrape")]


def wok_toss(seed=1):
    r = rngs(seed)
    n = int(1.6 * SR)
    wh = L(mk(2605))
    clank = L(kn("impact-sounds", f"impactMetal_light_00{seed % 5}.ogg"))
    sz, _ = sizzle_burst(seed + 10, dur=1.3, off=8 + seed * 2.0, rate=1.05)
    sw = env_points(len(sz), [(0, 0.2), (0.25, 1.0), (1.3, 0.0)])
    land = L(og("household", "fryingpan01.wav"), 52 + seed, 0.6)
    land = land * env_points(len(land), [(0, 0), (0.02, 1), (0.6, 0)])
    out = mixdown(n, [(wh, 0.0, -4), (clank, 0.05, -3), (sz * sw, 0.18, -2), (land, 0.42, -6),
                      (L(kn("impact-sounds", f"impactMetal_light_00{(seed + 2) % 5}.ogg")), 0.45, -8)])
    return out, [mk(2605), kn("impact-sounds", "impactMetal_light_000.ogg"), mk(123), og("household", "fryingpan01.wav")]


def gas_ignite():
    """click-click-whoosh (+ a breath of burner roar)."""
    clicks = L(mk(1816), 5.05, 1.25)
    ign = L(mk(1804))
    wh = L(mk(1349), 0.7, 1.6)
    whe = wh * env_points(len(wh), [(0, 0), (0.05, 0.6), (0.5, 1.0), (1.6, 0)])
    n = int(2.9 * SR)
    out = mixdown(n, [(clicks, 0.0, 0), (ign, 1.08, 2), (whe, 1.12, -4)])
    return out, [mk(1816), mk(1804), mk(1349)]


def burner_roar(seed=3, dur=12.0):
    """Thai high-pressure LPG burner: jet roar + combustion rumble + flutter."""
    r = rngs(seed)
    n = int(dur * SR)
    pink = S.noise(n, "pink")
    roar = S.butter(pink, "bandpass", [180, 2600], 2)
    # slow random modulation of intensity and spectral tilt
    m = S.butter(r.standard_normal(n), "lowpass", 2.5, 2)
    m = 1 + 0.25 * m / (np.std(m) + 1e-9)
    flutter = 1 + 0.12 * S.butter(r.standard_normal(n), "bandpass", [8, 35], 2) / 0.3
    roar = roar * m * flutter
    rumble = S.butter(S.noise(n, "brown"), "lowpass", 160, 2) * 3.0
    hiss = S.butter(r.standard_normal(n), "highpass", 3500, 2) * 0.05
    syn = roar / np.std(roar) * 0.25 + rumble / (np.std(rumble) + 1e-9) * 0.12 + hiss
    rec = L(mk(1333), 1.0, 4.4)
    rec2 = L(mk(1331), 0.8, 4.4)
    lay = np.zeros(n)
    pos = 0.0
    k = 0
    while pos < dur:
        src = rec if k % 2 == 0 else rec2
        seg = src * np.hanning(len(src)) ** 0.5
        S.place(lay, seg / (np.std(seg) + 1e-9) * 0.18, pos)
        pos += 2.6
        k += 1
    out = syn + lay
    return out, [SY("burner_roar"), mk(1333), mk(1331)]


def mortar_pound(seed=1):
    """Wooden pestle into a clay mortar (ครก) crushing garlic/chili: thunk + crunch + clay ring."""
    r = rngs(seed)
    n = int(0.6 * SR)
    wood = L(kn("impact-sounds", f"impactWood_heavy_00{seed % 5}.ogg"))
    wood = A.resample_ratio(wood, 0.82 + 0.06 * seed)
    imp = np.zeros(int(0.4 * SR))
    imp[:40] = np.hanning(40)
    clay = S.resonator_bank(imp, [180 * r.uniform(.95, 1.05), 410, 760, 1290], [0.07, 0.05, 0.04, 0.03],
                            [1, .6, .35, .2])
    clay /= np.max(np.abs(clay)) + 1e-9
    cr = L(mk(2244))
    cr = A.trim(cr, -40, -50)[: int(0.12 * SR)]
    cr = S.butter(cr, "highpass", 900, 2)
    juice = S.butter(r.standard_normal(int(0.15 * SR)), "bandpass", [600, 3000], 2) * S.env_exp(int(0.15 * SR), 0.03)
    out = mixdown(n, [(wood, 0.0, 0), (clay, 0.0, -4), (cr, 0.004, -9), (juice, 0.006, -16)])
    return out, [kn("impact-sounds", "impactWood_heavy_000.ogg"), mk(2244), SY("mortar_clay")]


def rice_scoop(seed=1):
    """Plastic paddle into cooked sticky rice: soft 'shlk' cut + sticky squelch + light tap on the pot rim."""
    r = rngs(seed)
    n = int(0.75 * SR)
    m = int(0.16 * SR)
    cut = S.butter(r.standard_normal(m), "bandpass", [350, 2600], 2)
    cut *= env_points(m, [(0, 0), (0.012, 1), (0.05, 0.6), (0.16, 0)])
    stick = np.zeros(m)
    k = int(m / SR * 450)
    stick[r.integers(0, m, k)] = r.standard_normal(k) * 0.5
    stick = S.butter(stick, "bandpass", [500, 4000], 2) * env_points(m, [(0, 0.2), (0.04, 1), (0.16, 0)])
    sq = A.trim(L(mk(3167)), -40, -50)[: int(0.25 * SR)]
    sq = A.fade(S.butter(sq, "lowpass", 3500, 2), 0.003, 0.08)
    thump = S.butter(L(kn("impact-sounds", f"impactSoft_medium_00{seed % 5}.ogg")), "lowpass", 1500, 2)[: int(0.2 * SR)]
    tap = L(kn("impact-sounds", f"impactGeneric_light_00{(seed + 1) % 5}.ogg"))[: int(0.12 * SR)]
    tap = A.fade(A.resample_ratio(tap, 1.25), 0.001, 0.03)
    out = mixdown(n, [(cut, 0.0, -3), (stick, 0.0, -9), (sq, 0.01, -4), (thump, 0.0, -12),
                      (tap, 0.36 + 0.06 * seed, -8)])
    return out, [SY("rice_scoop"), mk(3167), kn("impact-sounds", "impactSoft_medium_000.ogg"),
                 kn("impact-sounds", "impactGeneric_light_000.ogg")]


def scrub(seed=5, dur=9.0):
    """Sponge scrubbing a plate in a basin: rhythmic wet strokes with squeaks and sloshes."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    t = 0.05
    while t < dur - 0.3:
        L_ = r.uniform(0.16, 0.30)
        m = int(L_ * SR)
        st = S.butter(r.standard_normal(m), "bandpass", [r.uniform(700, 1200), r.uniform(4500, 7500)], 2)
        st *= np.sin(np.linspace(0, np.pi, m)) ** 1.5 * r.uniform(0.6, 1.0)
        # wet crackle (foam bubbles)
        cr = np.zeros(m)
        kk = int(m / SR * 300)
        cr[r.integers(0, m, kk)] = r.standard_normal(kk) * 0.6
        cr = S.butter(cr, "highpass", 2500, 2)
        S.place(out, st + cr * 0.4, t)
        if r.random() < 0.25:  # squeak on ceramic
            sm = int(r.uniform(0.04, 0.09) * SR)
            f = S.glide(sm, [(0, r.uniform(1400, 2200)), (sm / SR, r.uniform(1800, 3000))])
            sqk = S.sine(f, n=sm) * np.hanning(sm) * 0.18
            S.place(out, sqk, t + L_ * r.uniform(0.2, 0.6))
        t += L_ + r.uniform(0.0, 0.06)
    slosh = L(og("household", "kitchensink02.wav"), 3.0, dur)
    slosh = S.butter(slosh, "lowpass", 1800, 2)
    out = out / (np.std(out) + 1e-9) * 0.2 + slosh[:n] / (np.std(slosh) + 1e-9) * 0.05
    return out, [SY("scrub"), og("household", "kitchensink02.wav")]


def glug(seed=1, count=4):
    """Sauce bottle glugs: air-bubble resonances + thick pour."""
    r = rngs(seed)
    n = int((0.16 * count + 0.6) * SR)
    out = np.zeros(n)
    t = 0.02
    b1 = L(mk(3000))
    b2 = L(mk(1317))
    for k in range(count):
        src = b1 if (k + seed) % 2 == 0 else b2
        g = A.resample_ratio(src, r.uniform(0.75, 1.25))
        g = A.trim(g, -40, -50)[: int(0.25 * SR)]
        g = A.fade(g, 0.002, 0.05)
        S.place(out, g / (np.max(np.abs(g)) + 1e-9) * r.uniform(0.6, 1.0), t)
        t += r.uniform(0.11, 0.17)
    pour = L(mk(142), 0.35, 1.2)
    pour = A.resample_ratio(pour, 0.8)
    pour = S.butter(pour, "lowpass", 4000, 2)
    pour = pour[: n] * env_points(min(n, len(pour)), [(0, 0), (0.05, 1), (t, 0.8), (t + 0.2, 0)])
    out = out + 0.35 * np.pad(pour, (0, max(0, n - len(pour))))[:n] / (np.max(np.abs(pour)) + 1e-9)
    return out, [mk(3000), mk(1317), mk(142)]


def oil_pour():
    x = L(mk(142), 0.3, 1.35)
    x = A.resample_ratio(x, 0.78)
    x = S.butter(x, "lowpass", 5000, 2)
    sz = L(mk(123), 12.0, 1.8)
    sz = sz * env_points(len(sz), [(0, 0), (0.3, 0.0), (0.5, 0.5), (1.4, 0.35), (1.8, 0)])
    n = int(2.0 * SR)
    out = mixdown(n, [(x, 0.0, 0), (sz, 0.0, -10)])
    return out, [mk(142), mk(123)]


def burnt_hiss():
    a = L(mk(2447))
    b = L(mk(2446), 0.1, 2.5)
    cr = L(mk(1330), 3.0, 2.5)
    n = int(2.8 * SR)
    out = mixdown(n, [(a, 0.0, 0), (b, 0.25, -5), (S.butter(cr, "highpass", 800, 2), 0.2, -8)])
    out *= env_points(n, [(0, 1), (2.2, 0.8), (2.8, 0)])
    return out, [mk(2447), mk(2446), mk(1330)]


def steam_hiss():
    a = L(mk(2446), 0.1, 2.2)
    a = S.butter(a, "highpass", 1800, 2)
    b = L(mk(1458))
    n = int(2.3 * SR)
    out = mixdown(n, [(a, 0.0, -3), (S.butter(b, "highpass", 1200, 2), 0.0, -4)])
    out *= env_points(n, [(0, 0), (0.04, 1), (1.4, 0.7), (2.3, 0)])
    return out, [mk(2446), mk(1458)]


def rice_cooker_click():
    a = L(mk(1830))
    b = L(mk(1869), 0.33, 0.35) * 8
    imp = np.zeros(int(0.25 * SR))
    imp[:30] = np.hanning(30)
    body = S.resonator_bank(imp, [420, 980, 1650], [0.05, 0.04, 0.03], [1, .5, .3])
    body /= np.max(np.abs(body)) + 1e-9
    n = int(0.6 * SR)
    out = mixdown(n, [(a, 0.0, 0), (body, 0.095, -10), (S.butter(b, "highpass", 1500, 2), 0.1, -18)])
    return out, [mk(1830), mk(1869), SY("rice_cooker_body")]


def chop_hits(path, ss=None, t=None, thr_db=-22, min_gap=0.12, length=0.28):
    """Find onsets (energy jumps) and return list of segments."""
    x = L(path, ss, t)
    e = A.env_rms(x, 0.004)
    edb = 20 * np.log10(e + 1e-9)
    pk = edb.max()
    on = []
    i = 0
    hop = int(0.002 * SR)
    prev = -120
    while i < len(x):
        cur = edb[i]
        if cur > pk + thr_db and cur - prev > 6:
            on.append(i)
            i += int(min_gap * SR)
            prev = cur
            continue
        prev = edb[max(0, i - int(0.01 * SR))]
        i += hop
    segs = []
    for o in on:
        s = max(0, o - int(0.004 * SR))
        seg = x[s:s + int(length * SR)]
        segs.append(seg)
    return segs


def knife_chop(idx=0):
    segs = chop_hits(mk(134), thr_db=-20, min_gap=0.15, length=0.3)
    segs2 = chop_hits(og("household", "kitchencuttingboard01.wav"), 2, 20, thr_db=-18, min_gap=0.15, length=0.3)
    pool = segs[:6] + segs2[:6]
    # pick by loudness rank to avoid weak ones
    pool.sort(key=lambda s: -np.max(np.abs(s)))
    s = pool[idx % len(pool)]
    return s, [mk(134), og("household", "kitchencuttingboard01.wav")]


# ======================================================================= ITEMS
def plastic_drag(seed=1, dur=0.8, judder=(70, 120), body=(330, 760, 1250, 2100), heavy=False):
    """Plastic chair/table leg dragged on rough concrete: judder pulses into the plastic body + grit."""
    r = rngs(seed)
    n = int(dur * SR)
    f = S.glide(n, [(0, judder[0]), (dur * 0.5, judder[1]), (dur, judder[0] * 0.9)])
    f *= 1 + 0.08 * S.butter(r.standard_normal(n), "lowpass", 12, 2) / 0.1
    ph = np.cumsum(f) / SR
    pulses = np.zeros(n)
    k = np.where(np.diff(np.floor(ph)) > 0)[0]
    pulses[k] = r.uniform(0.5, 1.0, len(k))
    stroke = env_points(n, [(0, 0), (0.04, 1), (dur * 0.6, 0.9), (dur, 0)])
    grit = S.butter(r.standard_normal(n), "bandpass", [700, 6000], 2) * 0.25
    ex = (pulses + grit) * stroke
    dec = [0.03, 0.025, 0.02, 0.015] if not heavy else [0.06, 0.05, 0.035, 0.025]
    y = S.resonator_bank(ex, [b * r.uniform(0.94, 1.06) for b in body], dec, [1, .8, .6, .4])
    y = y / (np.max(np.abs(y)) + 1e-9) + 0.15 * grit * stroke
    if heavy:
        y = S.butter(y, "lowpass", 4500, 2)
    return y, [SY("plastic_drag")]


def chair_stack(seed=2):
    a, _ = plastic_drag(seed, 0.25, (90, 140))
    h1 = L(mk(3204))
    h2 = A.resample_ratio(L(mk(3204)), 1.15)
    n = int(1.0 * SR)
    out = mixdown(n, [(a, 0.0, -6), (h1, 0.18, 0), (h2, 0.33, -3), (L(mk(3088)), 0.36, -8)])
    return out, [SY("plastic_drag"), mk(3204), mk(3088)]


def plastic_bag(seed=1, dur=1.2):
    """Thin plastic carrier bag (ถุงก๊อบแก๊บ) crinkle gestures."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    t = 0.0
    while t < dur - 0.1:
        g = r.uniform(0.12, 0.4)
        m = int(g * SR)
        rate = r.uniform(600, 2500)
        k = int(rate * g)
        cl = np.zeros(m)
        pos = r.integers(0, m, k)
        cl[pos] = r.standard_normal(k) * r.uniform(0.2, 1.0, k) ** 2
        cl = S.butter(cl, "bandpass", [r.uniform(1800, 3000), r.uniform(9000, 14000)], 2)
        cl *= np.sin(np.linspace(0, np.pi, m)) ** 0.7
        rus = S.butter(r.standard_normal(m), "bandpass", [1500, 8000], 2) * 0.08 * np.sin(np.linspace(0, np.pi, m))
        S.place(out, (cl + rus) * r.uniform(0.5, 1.0), t)
        t += g * r.uniform(0.5, 1.1)
    return out, [SY("plastic_bag")]


def cardboard(seed=1):
    r = rngs(seed)
    n = int(0.7 * SR)
    imp = np.zeros(n)
    imp[:60] = np.hanning(60)
    body = S.resonator_bank(imp, [170 * r.uniform(.9, 1.1), 310, 520, 880, 1400], [0.08, 0.06, 0.05, 0.04, 0.03],
                            [1, .7, .5, .35, .2])
    body /= np.max(np.abs(body)) + 1e-9
    fr = S.butter(r.standard_normal(int(0.25 * SR)), "bandpass", [900, 5000], 2) * S.env_exp(int(0.25 * SR), 0.06)
    paper = L(mk(2380))
    out = mixdown(n, [(body, 0.0, 0), (fr, 0.0, -10), (S.butter(paper, "lowpass", 5000, 2), 0.02 + 0.05 * seed, -12)])
    if seed == 2:  # box flap / drop variant
        out = mixdown(n, [(out, 0.0, 0), (L(kn("impact-sounds", "impactSoft_heavy_001.ogg")), 0.0, -6)])
    return out, [SY("cardboard"), mk(2380)] + ([kn("impact-sounds", "impactSoft_heavy_001.ogg")] if seed == 2 else [])


def coin_drop(seed=1, spin=False):
    """Coin dropped on a table: clink + bounces (+ optional Euler-disk spin-down rattle)."""
    r = rngs(seed)
    dur = 1.6 if spin else 0.9
    n = int(dur * SR)
    out = np.zeros(n)
    modes = np.array([2650, 4930, 7600, 10450, 13300]) * r.uniform(0.95, 1.05)
    t, a = 0.0, 1.0
    gap = r.uniform(0.09, 0.13)
    for b in range(5):
        imp = np.zeros(int(0.4 * SR))
        imp[0] = a
        ring = S.resonator_bank(imp, list(modes), [0.25, 0.18, 0.12, 0.08, 0.05], [1, .7, .5, .3, .2])
        thud = S.resonator_bank(imp, [260, 520], [0.03, 0.02], [1, .5]) * 0.6
        S.place(out, ring + thud, t)
        t += gap
        gap *= 0.62
        a *= 0.55
    if spin:
        m = int(0.9 * SR)
        f = S.glide(m, [(0, 9), (0.9, 70)])
        ph = np.cumsum(f) / SR
        k = np.where(np.diff(np.floor(ph)) > 0)[0]
        ex = np.zeros(m)
        ex[k] = np.linspace(0.25, 0.6, len(k))
        sp = S.resonator_bank(ex, list(modes[:3]), [0.05, 0.04, 0.03], [1, .6, .3]) + \
            S.resonator_bank(ex, [300], [0.02], [0.6])
        sp *= env_points(m, [(0, 0.3), (0.8, 1), (0.9, 0)])
        S.place(out, sp, t + 0.05)
    out /= np.max(np.abs(out)) + 1e-9
    return out, [SY("coin_drop")]


def cash_drawer():
    bell = L(mk(588))
    dr = L(mk(834))
    coins = L(mk(1993))
    n = int(1.6 * SR)
    out = mixdown(n, [(bell, 0.0, -3), (dr, 0.12, 0), (coins, 0.35, -9)])
    return out, [mk(588), mk(834), mk(1993)]


def fizz_tail(seed, dur):
    r = rngs(seed)
    n = int(dur * SR)
    ex = np.zeros(n)
    k = int(2500 * dur)
    ex[r.integers(0, n, k)] = r.standard_normal(k)
    f = S.butter(ex, "highpass", 3500, 2) * np.exp(-np.arange(n) / SR / (dur * 0.45))
    return f


def bottle_open():
    r = rngs(4)
    n = int(1.6 * SR)
    imp = np.zeros(int(0.3 * SR))
    imp[0] = 1
    tik = S.resonator_bank(imp, [3100, 5400, 7900], [0.06, 0.04, 0.03], [1, .6, .4])
    psh = S.butter(r.standard_normal(int(0.35 * SR)), "bandpass", [1500, 9000], 2) * \
        S.env_exp(int(0.35 * SR), 0.08, a=0.003)
    fz = fizz_tail(5, 1.4)
    pour = L(mk(2833), 0.2, 1.4)
    out = mixdown(n, [(tik, 0.0, -6), (psh, 0.01, 0), (fz, 0.05, -8), (pour, 0.2, -16)])
    return out, [SY("bottle_open"), mk(2833)]


def can_open(seed=6):
    r = rngs(seed)
    n = int(1.3 * SR)
    imp = np.zeros(int(0.2 * SR))
    imp[0] = 1
    click = S.resonator_bank(imp, [1800, 3400, 6200], [0.03, 0.025, 0.02], [1, .8, .5])
    click2 = S.resonator_bank(imp, [1200, 2600], [0.02, 0.015], [1, .6])
    hiss = S.butter(r.standard_normal(int(0.45 * SR)), "highpass", 2200, 2) * \
        env_points(int(0.45 * SR), [(0, 0), (0.006, 1), (0.08, 0.5), (0.45, 0)])
    fz = fizz_tail(seed + 1, 1.1)
    out = mixdown(n, [(click, 0.0, -4), (hiss, 0.012, 0), (click2, 0.03, -10), (fz, 0.1, -10)])
    return out, [SY("can_open")]


def champagne_pop():
    r = rngs(9)
    n = int(2.2 * SR)
    imp = np.zeros(int(0.4 * SR))
    imp[:12] = np.hanning(12)
    pop = S.resonator_bank(imp, [340, 720, 1500], [0.05, 0.03, 0.02], [1, .6, .3])
    pop /= np.max(np.abs(pop)) + 1e-9
    crack = S.butter(r.standard_normal(int(0.03 * SR)), "highpass", 2000, 2) * S.env_exp(int(0.03 * SR), 0.006)
    gas = S.butter(r.standard_normal(int(0.8 * SR)), "bandpass", [1500, 8000], 2) * \
        env_points(int(0.8 * SR), [(0, 0), (0.01, 0.6), (0.8, 0)])
    foam = L(mk(3181), 1.0, 2.0)
    out = mixdown(n, [(pop, 0.0, 0), (crack, 0.0, -6), (gas, 0.01, -10), (fizz_tail(10, 1.8), 0.15, -9),
                      (foam, 0.25, -16)])
    return out, [SY("champagne_pop"), mk(3181)]


def ka_ching():
    click = L(mk(1830))
    bell = L(mk(586))
    coins = L(mk(1993))
    dr = L(mk(834))
    n = int(1.4 * SR)
    out = mixdown(n, [(click, 0.0, -2), (dr, 0.03, -8), (bell, 0.09, 0), (coins, 0.2, -6)])
    return out, [mk(1830), mk(586), mk(1993), mk(834)]


# ======================================================================= PLAYER
def flipflop(seed=1):
    """Rubber slipper (รองเท้าแตะ) on concrete: sole slap 'flip' then strap/heel 'flop'."""
    r = rngs(seed)
    n = int(0.42 * SR)
    step = L(kn("impact-sounds", f"footstep_concrete_00{seed % 5}.ogg"))
    step = S.butter(step, "lowpass", 2500, 2)
    sl = L(mk(481))
    sl = A.trim(sl, -40, -50)[: int(0.12 * SR)]
    sl = A.resample_ratio(sl, r.uniform(0.62, 0.72))
    sl = S.butter(sl, "bandpass", [250, 3500], 2)
    imp = np.zeros(int(0.15 * SR))
    imp[:25] = np.hanning(25)
    rub = S.resonator_bank(imp, [210 * r.uniform(.9, 1.1), 470, 900], [0.025, 0.02, 0.015], [1, .6, .3])
    rub /= np.max(np.abs(rub)) + 1e-9
    d = r.uniform(0.07, 0.11)
    out = mixdown(n, [(step, 0.0, -4), (rub, 0.0, -6), (sl, d, -2 + r.uniform(-2, 1))])
    out = S.butter(out, "highpass", 90, 2)
    return out, [kn("impact-sounds", "footstep_concrete_000.ogg"), mk(481), SY("flipflop_rubber")]


def wet_step(seed=1):
    r = rngs(seed)
    step = L(kn("impact-sounds", f"footstep_concrete_00{(seed + 2) % 5}.ogg"))
    sp = L(mk(536))
    segs = chop_hits(mk(536), thr_db=-18, min_gap=0.25, length=0.45)
    s = segs[seed % len(segs)] if segs else sp[: int(0.4 * SR)]
    n = int(0.5 * SR)
    out = mixdown(n, [(step, 0.0, -5), (s, 0.0, 0)])
    return out, [kn("impact-sounds", "footstep_concrete_000.ogg"), mk(536)]


def snore_loop():
    """Inhale snore + slow exhale, ~4.4 s cycle x2."""
    sn = A.trim(L(mk(2478)), -40, -50)
    br = L(mk(2236))
    br = A.trim(br, -40, -50)
    cyc = 4.4
    n = int(cyc * 2 * SR + 1.5 * SR)
    lay = []
    for k in range(3):
        lay.append((sn * (0.9 if k % 2 else 1.0), k * cyc, 0))
        lay.append((br[: int(1.8 * SR)] * env_points(min(len(br), int(1.8 * SR)), [(0, 0), (0.2, 1), (1.8, 0)]),
                    k * cyc + len(sn) / SR + 0.25, -6))
    out = mixdown(n, lay)
    return out, [mk(2478), mk(2236)]


def heartbeat_slow():
    x = L(mk(494), 2.0, 9.0)
    return x, [mk(494)]


def hiccup(seed=1):
    """Formant-synth 'hic!': inhale squeak + clipped voiced burst ending in a glottal stop."""
    r = rngs(seed)
    n = int(0.32 * SR)
    f0 = r.uniform(240, 300) if seed == 1 else r.uniform(170, 210)
    vd = 0.075
    m = int(vd * SR)
    f = S.glide(m, [(0, f0 * 1.25), (vd, f0 * 0.85)])
    src = S.saw(f, m)
    src += 0.15 * S.butter(r.standard_normal(m), "highpass", 2000, 2)
    v = np.zeros(m)
    for fc, bw, g in [(420, 80, 1.0), (2050, 140, 0.7), (2750, 180, 0.45), (3500, 250, 0.25)]:
        v += g * S.svf(src, fc, fc / bw, "bpn")
    v *= env_points(m, [(0, 0), (0.006, 1), (vd * 0.8, 0.8), (vd, 0)])
    inh = S.butter(r.standard_normal(int(0.06 * SR)), "bandpass", [1200, 5000], 2) * \
        env_points(int(0.06 * SR), [(0, 0), (0.05, 0.4), (0.06, 0)])
    body = np.zeros(int(0.08 * SR))
    body[:20] = np.hanning(20)
    body = S.resonator_bank(body, [140, 300], [0.04, 0.03], [1, .5])
    out = mixdown(n, [(inh, 0.0, -14), (v, 0.055, 0), (body / (np.max(np.abs(body)) + 1e-9), 0.055, -12)])
    return out, [SY("hiccup")]


# ======================================================================= MEME
def airhorn(pattern=((0.0, 1.15),), seed=1):
    r = rngs(seed)
    tot = max(a + b for a, b in pattern) + 0.25
    n = int(tot * SR)
    out = np.zeros(n)
    for (t0, d) in pattern:
        m = int(d * SR)
        f0 = 466.0
        f = f0 * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * np.arange(m) / SR)) * \
            S.lin_env(m, [(0, 0.97), (0.04, 1.0), (d, 0.995)])
        tone = sum(S.saw(f * dt, m) for dt in (1.0, 1.006, 0.994)) / 3
        tone += 0.8 * sum(S.saw(f * 1.335 * dt, m) for dt in (1.0, 1.004)) / 2
        tone = S.softclip(tone * 2.5, 2.0)
        tone = S.peaking(tone, 1800, 8, 0.8)
        tone = S.peaking(tone, 3200, 5, 1.0)
        tone = S.butter(tone, "lowpass", 7000, 2)
        tone *= env_points(m, [(0, 0), (0.015, 1), (d - 0.06, 0.95), (d, 0)])
        S.place(out, tone, t0)
    ir = S.make_ir(1.2, 0.8, 5000, stereo=False)
    out = A.mono(S.reverb(out, ir, wet=0.12))[:n + int(0.6 * SR)]
    return out, [SY("airhorn")]


def bass_boom():
    n = int(2.4 * SR)
    f = S.glide(n, [(0, 95), (0.08, 62), (0.5, 46), (2.4, 40)])
    tone = S.sine(f, n=n) * S.env_exp(n, 0.55, a=0.003)
    tone += 0.35 * S.sine(f * 2.01, n=n) * S.env_exp(n, 0.25, a=0.003)
    tone = S.softclip(tone * 1.8, 1.5)
    hit = S.butter(S.noise(int(0.12 * SR)), "lowpass", 1800, 2) * S.env_exp(int(0.12 * SR), 0.02)
    out = mixdown(n, [(tone, 0, 0), (hit, 0, -6)])
    ir = S.make_ir(2.5, 2.0, 2500, stereo=False, seed_=3)
    out = A.mono(S.reverb(out, ir, wet=0.35))[:n + SR]
    return out, [SY("bass_boom")]


def bonk():
    n = int(0.5 * SR)
    f = S.glide(n, [(0, 780), (0.05, 420), (0.5, 380)])
    tone = S.sine(f, n=n) * S.env_exp(n, 0.07, a=0.001) + 0.4 * S.sine(f * 2.7, n=n) * S.env_exp(n, 0.03, a=0.001)
    imp = np.zeros(n)
    imp[:30] = np.hanning(30)
    wood = S.resonator_bank(imp, [960, 2150, 3400], [0.09, 0.05, 0.03], [1, .5, .3])
    wood /= np.max(np.abs(wood)) + 1e-9
    out = tone + 0.8 * wood
    return out, [SY("bonk")]


def slide_whistle(up=True):
    d = 0.95
    n = int(d * SR)
    a, b = (420, 1650) if up else (1650, 380)
    f = S.glide(n, [(0, a), (0.08, a), (d * 0.9, b), (d, b)])
    f = f * (1 + 0.012 * np.sin(2 * np.pi * 6.0 * np.arange(n) / SR))
    tone = S.sine(f, n=n) + 0.12 * S.sine(2 * f, n=n) + 0.04 * S.sine(3 * f, n=n)
    breath = S.butter(S.noise(n), "bandpass", [1000, 6000], 2) * 0.05
    out = (tone + breath) * env_points(n, [(0, 0), (0.03, 1), (d - 0.08, 1), (d, 0)])
    return out, [SY("slide_whistle")]


def dun_dun_dunn():
    ir = S.make_ir(2.8, 2.2, 6000, stereo=True, seed_=11)
    notes = [(0.0, 0.32, [50, 57, 62]), (0.42, 0.32, [50, 57, 62]), (0.86, 2.1, [49, 56, 61])]
    n = int(3.6 * SR)
    out = np.zeros((n, 2))
    for t0, d, chord in notes:
        m = int(d * SR)
        x = np.zeros(m)
        for mid in chord:
            f = S.midi(mid)
            for det in (0.997, 1.0, 1.004):
                x += S.saw(f * det, m)
            x += 0.6 * S.saw(f * 0.5, m)
        fc = S.lin_env(m, [(0, 400), (0.03, 3500), (0.25, 1400), (d, 900)])
        x = S.svf(x / 10, fc, 0.9, "lp")
        x *= env_points(m, [(0, 0), (0.01, 1), (d * 0.6, 0.8), (d, 0)])
        # timpani
        tm = int(min(d, 1.5) * SR)
        tf = S.glide(tm, [(0, S.midi(chord[0] - 12) * 1.1), (0.1, S.midi(chord[0] - 12))])
        tp = S.sine(tf, n=tm) * S.env_exp(tm, 0.45, a=0.002) + \
            S.butter(S.noise(tm), "lowpass", 400, 2) * S.env_exp(tm, 0.05) * 0.5
        S.place(out, S.pan(x, -0.15) + S.pan(tp * 0.9, 0.1), t0)
    out = S.reverb(out, ir, wet=0.25)[:n]
    return out, [SY("dun_dun_dunn")]


def quack(seed=1):
    r = rngs(seed)
    d = 0.22
    m = int(d * SR)
    f = S.glide(m, [(0, 520), (0.03, 600), (d, 430)])
    src = S.saw(f, m) + 0.5 * S.square(f * 0.5, m)
    rough = 1 + 0.4 * np.sign(np.sin(2 * np.pi * 45 * np.arange(m) / SR))
    src *= rough
    v = np.zeros(m)
    for fc, q, g in [(950, 5, 1.0), (1650, 6, 0.9), (2600, 7, 0.5), (3800, 8, 0.25)]:
        v += g * S.svf(src, fc, q, "bpn")
    v *= env_points(m, [(0, 0), (0.01, 1), (0.12, 0.85), (d, 0)])
    v = S.softclip(v / (np.max(np.abs(v)) + 1e-9) * 1.5, 1.2)
    return v, [SY("quack")]


def crickets_awkward():
    ch = [A.trim(L(mk(1780)), -40, -50), A.trim(L(mk(1927)), -40, -50), A.trim(L(mk(1781)), -40, -50)]
    n = int(3.6 * SR)
    room = S.butter(S.noise(n, "pink"), "lowpass", 900, 2) * 0.004
    lay = [(ch[0], 0.15, 0), (ch[1], 0.95, -2), (ch[0], 1.75, -1), (ch[2], 2.55, -3)]
    out = mixdown(n, lay) + room
    return out, [mk(1780), mk(1927), mk(1781)]


def tick_tock(beats=6, period=0.5):
    n = int(beats * period * SR)
    out = np.zeros(n)
    for k in range(beats):
        imp = np.zeros(int(0.15 * SR))
        imp[:8] = np.hanning(8)
        if k % 2 == 0:
            y = S.resonator_bank(imp, [2450, 3900, 6100], [0.03, 0.02, 0.015], [1, .6, .4])
        else:
            y = S.resonator_bank(imp, [1550, 2650, 4300], [0.035, 0.025, 0.015], [1, .6, .3])
        y /= np.max(np.abs(y)) + 1e-9
        mech = S.butter(S.noise(int(0.01 * SR)), "highpass", 3000, 2) * 0.2
        S.place(out, y * (1.0 if k % 2 == 0 else 0.85), k * period + 0.005)
        S.place(out, mech, k * period + 0.004)
    return out, [SY("tick_tock")]


def cloud_poof(seed=1):
    r = rngs(seed)
    n = int(0.6 * SR)
    nz = S.butter(r.standard_normal(n), "lowpass", 2200, 2)
    nz = S.svf(nz, S.lin_env(n, [(0, 3000), (0.5, 500)]), 0.7, "lp")
    e = env_points(n, [(0, 0), (0.015, 1), (0.08, 0.6), (0.6, 0)])
    th = S.sine(S.glide(n, [(0, 160), (0.2, 70)]), n=n) * S.env_exp(n, 0.06)
    out = nz * e + 0.5 * th
    return out, [SY("cloud_poof")]


def crowd_vowel(kind="aww", voices=26, seed=3):
    """Formant-synth crowd reaction ('aww' sympathetic / 'ooh-wow' impressed)."""
    r = rngs(seed)
    d = 1.6 if kind == "aww" else 1.5
    n = int((d + 0.6) * SR)
    out = np.zeros((n, 2))
    for v in range(voices):
        fem = r.random() < 0.5
        base = r.uniform(190, 260) if fem else r.uniform(100, 145)
        dd = d * r.uniform(0.75, 1.05)
        m = int(dd * SR)
        if kind == "aww":
            f = S.glide(m, [(0, base * 1.25), (0.25, base * 1.18), (dd, base * 0.82)])
            F = [(S.lin_env(m, [(0, 640), (dd, 700)]), 6), (S.lin_env(m, [(0, 1000), (dd, 1150)]), 8), (2600, 10)]
        else:  # "oooOOOoo" wow: rising then falling, rounded vowel
            f = S.glide(m, [(0, base * 0.95), (dd * 0.45, base * 1.35), (dd, base * 0.9)])
            F = [(S.lin_env(m, [(0, 380), (dd * 0.5, 450), (dd, 400)]), 6),
                 (S.lin_env(m, [(0, 800), (dd * 0.5, 900), (dd, 820)]), 7), (2500, 10)]
        f = f * (1 + 0.01 * np.sin(2 * np.pi * r.uniform(4.5, 6.5) * np.arange(m) / SR + r.uniform(0, 6)))
        src = S.saw(f, m) * 0.6 + 0.08 * r.standard_normal(m)
        if fem:
            F = [(fc * 1.15 if np.isscalar(fc) else fc * 1.15, q) for fc, q in F]
        x = np.zeros(m)
        for (fc, q), g in zip(F, [1.0, 0.6, 0.25]):
            x += g * S.svf(src, fc, q, "bpn")
        x *= env_points(m, [(0, 0), (r.uniform(0.08, 0.2), 1), (dd * 0.7, 0.8), (dd, 0)])
        x = S.butter(x, "highpass", 90, 2)
        S.place(out, S.pan(x * r.uniform(0.5, 1.0), r.uniform(-0.8, 0.8)), r.uniform(0.0, 0.18))
    ir = S.make_ir(1.8, 1.2, 5000, stereo=True, seed_=21)
    out = S.reverb(out, ir, wet=0.3)[: n + int(0.5 * SR)]
    out += 0.01 * S.stereo(S.butter(S.noise(len(out), "pink"), "lowpass", 2000, 2)) * \
        S.stereo(env_points(len(out), [(0, 0), (0.1, 1), (d, 1), (d + 0.6, 0)]))
    return A.mono(out), [SY("crowd_vowel")]


# ======================================================================= ITEMS/PLAYER composites
def pickup(seed=1):
    cl = L(kn("rpg-audio", f"cloth{[1, 3, 4][seed % 3]}.ogg"))
    wh = L(mk([1462, 2605, 1464][seed % 3]))
    wh = S.butter(wh, "highpass", 300, 2)
    n = int(0.6 * SR)
    out = mixdown(n, [(wh, 0.0, -9), (cl, 0.02, 0)])
    return out, [kn("rpg-audio", "cloth1.ogg"), mk([1462, 2605, 1464][seed % 3])]


def glass_break():
    hit = L(kn("impact-sounds", "impactGlass_heavy_002.ogg"))
    sh = L(mk(1551), 0.0, 1.8)
    tink = L(mk(759), 0.25, 0.9)
    n = int(1.9 * SR)
    out = mixdown(n, [(hit, 0.0, -2), (sh, 0.005, 0), (S.butter(tink, "highpass", 2500, 2), 0.3, -10)])
    out *= env_points(n, [(0, 1), (1.3, 0.7), (1.9, 0)])
    return out, [kn("impact-sounds", "impactGlass_heavy_002.ogg"), mk(1551), mk(759)]


def slap(seed=1):
    r = rngs(seed)
    hit = L(og("hits", f"x/{[3, 4, 5][seed % 3]}.ogg"))
    hit = A.trim(hit, -30, -50)
    cl = A.trim(L(mk(2167)), -40, -55)
    wh = L(mk(1462))
    wh = S.butter(wh, "highpass", 500, 2)
    n = int(0.9 * SR)
    pre = 0.12
    dry = mixdown(n, [(wh[: int(0.2 * SR)] * np.hanning(int(0.2 * SR)), 0.0, -14), (hit, pre, 0),
                      (cl, pre + 0.002, -3 + r.uniform(-1, 1))])
    ir = S.make_ir(0.5, 0.35, 6000, stereo=False, seed_=seed)
    out = A.mono(S.reverb(dry, ir, wet=0.12))[:n]
    return out, [og("hits", "x/3.ogg"), mk(2167), mk(1462), SY("slap_room")]


def high_five(seed=1):
    if seed == 1:
        x = L(mk(481))
    else:
        segs = chop_hits(mk(482), thr_db=-14, min_gap=0.2, length=0.2)
        x = segs[min(4, len(segs) - 1)]
    imp = np.zeros(int(0.12 * SR))
    imp[:20] = np.hanning(20)
    body = S.resonator_bank(imp, [180, 420], [0.03, 0.02], [1, .5])
    body /= np.max(np.abs(body)) + 1e-9
    n = int(0.35 * SR)
    out = mixdown(n, [(x, 0.0, 0), (body, 0.0, -14)])
    ir = S.make_ir(0.4, 0.3, 7000, stereo=False, seed_=5)
    out = A.mono(S.reverb(out, ir, wet=0.1))[:n]
    return out, [mk(481) if seed == 1 else mk(482), SY("high_five_body")]


def tug_strain(seed=1):
    if seed == 1:
        x = L(mk(2172))
    else:
        x = A.resample_ratio(L(mk(2170)), 0.92)
    breath = L(mk(379), 3.0, 0.8)
    n = int(1.4 * SR)
    out = mixdown(n, [(breath, 0.0, -14), (x, 0.1, 0)])
    return out, [mk(2172) if seed == 1 else mk(2170), mk(379)]
