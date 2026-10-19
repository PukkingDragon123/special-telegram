"""R5-audio world / ambience designs (engines, Doppler passes, bells, buzz, composite ambiences)."""
import math
import numpy as np
from scipy import signal
import audiolib as A
import synth as S
from designs import L, mk, kn, og, SY, mixdown, env_points, rngs, chop_hits, SR

DL = A.DL


def cm(sub, f):
    return f"{DL}/{sub}/{f}"


# ------------------------------------------------------------------ engines (source-filter model)
def engine(fire_hz, dur, kind="scooter", seed=1, rpm_curve=None):
    """Combustion engine: per-cycle pulse excitation -> exhaust/body resonances + mechanical noise.
    fire_hz may be an array (per-sample firing frequency)."""
    r = rngs(seed)
    n = int(dur * SR)
    f = np.broadcast_to(np.asarray(fire_hz, float), (n,)).copy() if np.ndim(fire_hz) else np.full(n, float(fire_hz))
    f *= 1 + 0.015 * S.butter(r.standard_normal(n), "lowpass", 6, 2) / 0.05  # rpm wander
    ph = np.cumsum(f) / SR
    idx = np.where(np.diff(np.floor(ph)) > 0)[0]
    ex = np.zeros(n)
    amps = r.uniform(0.75, 1.0, len(idx))
    if kind == "tuktuk":  # 2-stroke rasp: irregular firing strength, occasional misfire
        amps *= np.where(r.random(len(idx)) < 0.06, 0.25, 1.0)
    ex[idx] = amps
    # each combustion pulse is a short decaying noise burst (gives the 'putt')
    burst = np.exp(-np.arange(int(0.006 * SR)) / (0.0012 * SR)) * r.standard_normal(int(0.006 * SR))
    ex = signal.fftconvolve(ex, burst)[:n] + 0.25 * ex
    if kind == "scooter":
        res = ([115, 310, 620, 1250, 2400], [0.05, 0.035, 0.025, 0.015, 0.01], [1, .8, .5, .3, .15])
        mech_bp, mech_g = [1500, 6000], 0.06
    elif kind == "tuktuk":
        res = ([95, 240, 520, 980, 1900, 3300], [0.07, 0.05, 0.035, 0.022, 0.012, 0.008], [1, .95, .75, .45, .25, .12])
        mech_bp, mech_g = [1500, 5000], 0.05
    elif kind == "diesel":
        res = ([70, 180, 420, 900], [0.08, 0.05, 0.03, 0.02], [1, .7, .4, .2])
        mech_bp, mech_g = [1800, 7000], 0.1
    else:
        res = ([100, 300, 700], [0.05, 0.03, 0.02], [1, .6, .3])
        mech_bp, mech_g = [1500, 6000], 0.05
    y = S.resonator_bank(ex, *res)
    y /= np.max(np.abs(y)) + 1e-9
    mech = S.butter(r.standard_normal(n), "bandpass", mech_bp, 2)
    # mechanical noise modulated by the firing cycle (valve train / chain / knock)
    cyc = 0.5 + 0.5 * np.cos(2 * np.pi * ph)
    if kind == "diesel":
        cyc = cyc ** 6  # sharp diesel knock
    mech *= cyc * mech_g * 4
    if kind == "scooter":  # CVT belt whine
        wh = S.sine(f * 7.3, n=n) * 0.03 + S.sine(f * 14.6, n=n) * 0.015
        mech += wh
    out = y + mech
    out = S.softclip(out * 1.4, 1.2)
    return out


def doppler_pass(src, tc=1.6, v=11.0, d0=4.0, dur=None):
    """Moving source past a listener: y(t) = x(t - r/c)/r with distance-dependent air absorption."""
    c = 343.0
    n = len(src) if dur is None else int(dur * SR)
    t = np.arange(n) / SR
    r = np.sqrt(d0 ** 2 + (v * (t - tc)) ** 2)
    tr = t - r / c
    pos = (tr - tr.min()) * SR
    y = np.interp(pos, np.arange(len(src)), src, left=0, right=0)
    amp = d0 / r
    fc = np.clip(16000 * (d0 / r) ** 0.9, 900, 16000)
    y = S.svf(y * amp, fc, 0.7, "lp")
    return y


def motorbike_pass_syn(seed=1):
    r = rngs(seed)
    dur = 4.2
    n = int((dur + 0.5) * SR)
    rpm = S.lin_env(n, [(0, r.uniform(48, 55)), (1.8, r.uniform(55, 62)), (dur + 0.5, r.uniform(50, 58))])
    eng = engine(rpm, dur + 0.5, "scooter", seed)
    y = doppler_pass(eng, tc=r.uniform(1.6, 2.0), v=r.uniform(9, 14), d0=r.uniform(3, 5), dur=dur)
    y = S.butter(y, "highpass", 60, 2)
    return y, [SY("motorbike_pass")]


def motorbike_pass_rec(which=1):
    if which == 1:
        x = L(mk(2732), 0.6, 4.2)
        x = x * env_points(len(x), [(0, 0.6), (1.6, 1), (3.0, 0.6), (4.2, 0)])
        return x, [mk(2732)]
    x = L(mk(1606))
    return x, [mk(1606)]


def tuktuk_loop(dur=8.0, seed=4):
    """Two-stroke auto-rickshaw idle/putter: 'tuk-tuk-tuk' rasp with rattling body panels."""
    r = rngs(seed)
    n = int(dur * SR)
    f = S.lin_env(n, [(0, 21), (dur * 0.3, 23), (dur * 0.6, 20.5), (dur, 21.5)])
    e = engine(f, dur, "tuktuk", seed)
    # body rattle: sheet metal + plastic buzz excited by engine vibration
    ph = np.cumsum(f) / SR
    vib = (0.5 + 0.5 * np.cos(2 * np.pi * ph)) ** 4
    rat = S.butter(r.standard_normal(n), "bandpass", [2200, 5500], 2) * vib * 0.05
    exh = S.butter(r.standard_normal(n), "bandpass", [120, 900], 2) * vib * 0.35
    out = S.butter(e + rat + exh, "lowpass", 6500, 2)
    return out, [SY("tuktuk_engine")]


def scooter_idle():
    x = L(mk(2721), 0.1, 2.5)
    return x, [mk(2721)]


def songthaew():
    x = L(mk(1621), 0.5, 9.0)
    return x, [mk(1621)]


def bus_airbrake(seed=7):
    r = rngs(seed)
    n = int(1.6 * SR)
    hiss = S.butter(r.standard_normal(n), "highpass", 1800, 2)
    hiss = S.svf(hiss, S.lin_env(n, [(0, 9000), (1.6, 4000)]), 0.6, "lp")
    e = env_points(n, [(0, 0), (0.008, 1), (0.18, 0.85), (0.5, 0.45), (1.6, 0)])
    sq = S.sine(S.glide(int(0.25 * SR), [(0, 3300), (0.25, 3050)]), n=int(0.25 * SR)) * \
        env_points(int(0.25 * SR), [(0, 0), (0.01, 0.15), (0.25, 0)])
    door = L(mk(2709), 0.1, 1.2)
    door = A.fade(S.butter(door, "lowpass", 600, 2), 0.005, 0.4)
    out = mixdown(n, [(hiss * e, 0.0, 0), (sq, 0.0, -6), (door, 0.0, -14)])
    return out, [SY("bus_airbrake"), mk(2709)]


def siren_distant():
    x = L(mk(1642), 0.5, 11.0)
    x = S.butter(x, "lowpass", 2200, 2)
    x = S.butter(x, "highpass", 350, 2)
    ir = S.make_ir(2.5, 2.0, 2500, stereo=False, seed_=31)
    y = A.mono(S.reverb(x, ir, wet=0.6, dry=0.5))[: len(x)]
    y *= env_points(len(y), [(0, 0), (2.0, 0.7), (5, 1.0), (8, 0.8), (11, 0)])
    return y, [mk(1642)]


# ------------------------------------------------------------------ bells, chimes, buzz
def thai_temple_bell(seed=1, dur=6.0):
    """Big bronze temple bell (ระฆัง) struck with a wooden mallet: inharmonic bell partials with beating."""
    r = rngs(seed)
    n = int(dur * SR)
    f0 = 98.0 if seed == 1 else 131.0
    parts = [(0.5, 0.9, 4.5), (1.0, 0.8, 3.8), (1.183, 0.6, 3.0), (1.506, 0.5, 2.4), (2.0, 0.75, 2.2),
             (2.514, 0.5, 1.5), (2.662, 0.45, 1.4), (3.011, 0.4, 1.1), (4.166, 0.3, 0.8), (5.433, 0.2, 0.6),
             (6.79, 0.12, 0.4), (8.2, 0.08, 0.3)]
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, g, tau in parts:
        for det in (1.0, 1.0 + r.uniform(0.0008, 0.002)):  # degenerate mode pair -> beating
            out += g * 0.5 * np.sin(2 * np.pi * f0 * ratio * det * t + r.uniform(0, 6)) * np.exp(-t / (tau * dur / 6))
    att = np.zeros(int(0.05 * SR))
    att[:60] = np.hanning(60)
    thump = S.resonator_bank(att, [f0 * 0.5, f0 * 1.9, 900], [0.15, 0.08, 0.03], [1, .5, .3])
    out = mixdown(n, [(out / (np.max(np.abs(out)) + 1e-9), 0, 0), (thump / (np.max(np.abs(thump)) + 1e-9), 0, -12)])
    out *= env_points(n, [(0, 0), (0.004, 1), (dur, 1)])
    ir = S.make_ir(3.0, 2.6, 4000, stereo=False, seed_=41)
    out = A.mono(S.reverb(out, ir, wet=0.25))[:n]
    out *= env_points(n, [(0, 1), (dur - 0.8, 1), (dur, 0)])
    return out, [SY("temple_bell")]


def wind_bells(seed=2, dur=6.0, eerie=False):
    """Small temple eave bells (กระดิ่งลม) tinkling in the breeze."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    base = [1318, 1568, 1760, 2093, 2349] if not eerie else [1244, 1318, 1661, 1865, 2489]
    t = 0.05
    while t < dur - 1.0:
        f = r.choice(base) * r.uniform(0.995, 1.005)
        m = int(2.0 * SR)
        tt = np.arange(m) / SR
        tone = np.zeros(m)
        for ratio, g, tau in [(1.0, 1.0, 0.9), (2.76, 0.4, 0.35), (5.40, 0.2, 0.15), (8.93, 0.1, 0.08)]:
            tone += g * np.sin(2 * np.pi * f * ratio * tt) * np.exp(-tt / tau)
        tone *= np.minimum(1, tt / 0.002) * np.minimum(1, (tt[-1] - tt) / 0.3)
        if eerie:
            tone = A.resample_ratio(tone, r.uniform(0.5, 0.56))[:m]
        S.place(out, tone * r.uniform(0.25, 1.0), t)
        t += r.exponential(0.35) + 0.05
    ir = S.make_ir(3.5 if eerie else 1.8, 3.0 if eerie else 1.3, 6000, stereo=False, seed_=43)
    out = A.mono(S.reverb(out, ir, wet=0.5 if eerie else 0.25))[:n]
    out *= env_points(n, [(0, 0), (0.05, 1), (dur - 0.6, 1), (dur, 0)])
    return out, [SY("wind_bells")]


def gong(seed=1, dur=5.0):
    """Thai bossed gong (ฆ้อง): clear pitched centre boss with a slight pitch glide and shimmer."""
    r = rngs(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = 196.0
    fg = f0 * (1 + 0.012 * np.exp(-t / 0.4))
    ph = 2 * np.pi * np.cumsum(fg) / SR
    out = np.sin(ph) * np.exp(-t / 2.2) + 0.45 * np.sin(2.01 * ph) * np.exp(-t / 1.4) + \
        0.25 * np.sin(2.98 * ph + 1) * np.exp(-t / 0.9) + 0.15 * np.sin(4.1 * ph) * np.exp(-t / 0.5)
    sh = S.butter(r.standard_normal(n), "bandpass", [1200, 5000], 2) * np.exp(-t / 0.25) * 0.08
    out = (out + sh) * np.minimum(1, t / 0.003)
    ir = S.make_ir(2.5, 2.0, 5000, stereo=False, seed_=47)
    out = A.mono(S.reverb(out, ir, wet=0.2))[:n]
    out *= env_points(n, [(0, 1), (dur - 0.5, 1), (dur, 0)])
    return out, [SY("gong")]


def door_chime():
    """Original convenience-store entry chime: a bright 2-tone 'ding-dong' (+ soft third note)."""
    notes = [(0.0, 1318.5), (0.42, 1046.5), (0.84, 1174.7)]
    n = int(2.4 * SR)
    out = np.zeros(n)
    for i, (t0, f) in enumerate(notes):
        m = int(1.5 * SR)
        tt = np.arange(m) / SR
        g = 1.0 if i < 2 else 0.55
        tone = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 2.0 * tt) * np.exp(-tt / 0.3)
                + 0.12 * np.sin(2 * np.pi * f * 3.01 * tt) * np.exp(-tt / 0.15)) * np.exp(-tt / 0.65) * g
        tone *= np.minimum(1, tt / 0.003) * np.minimum(1, (tt[-1] - tt) / 0.4)
        S.place(out, tone, t0)
    ir = S.make_ir(1.2, 0.9, 7000, stereo=False, seed_=53)
    out = A.mono(S.reverb(out, ir, wet=0.18))[:n]
    return out, [SY("door_chime")]


def icecream_bell(dur=4.0, seed=5):
    """Ice-cream cart hand bell rung in bursts: 'ting-ting-ting-ting ... ting-ting-ting'."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    f = 2350.0
    t = 0.05
    burst = 0
    while t < dur - 0.6:
        for k in range(r.integers(5, 9)):
            m = int(0.6 * SR)
            tt = np.arange(m) / SR
            tone = (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 2.42 * tt) * np.exp(-tt / 0.08)
                    + 0.3 * np.sin(2 * np.pi * f * 4.1 * tt) * np.exp(-tt / 0.04)) * np.exp(-tt / 0.22)
            tone *= np.minimum(1, tt / 0.001) * np.minimum(1, (tt[-1] - tt) / 0.15)
            S.place(out, tone * r.uniform(0.6, 1.0), t)
            t += r.uniform(0.085, 0.11)
        t += r.uniform(0.35, 0.6)
        burst += 1
    ir = S.make_ir(1.0, 0.7, 6000, stereo=False, seed_=55)
    out = A.mono(S.reverb(out, ir, wet=0.15))[:n]
    out *= env_points(n, [(0, 1), (dur - 0.3, 1), (dur, 0)])
    return out, [SY("icecream_bell")]


def fluorescent_buzz(dur=6.0, seed=9):
    """Tube light ballast hum (Thailand mains 50 Hz -> 100 Hz buzz + harmonics) with faint flicker ticks."""
    r = rngs(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h, g in [(1, 1.0), (2, 0.5), (3, 0.35), (4, 0.2), (6, 0.12), (8, 0.08), (10, 0.05), (14, 0.03)]:
        out += g * np.sin(2 * np.pi * 100 * h * t + r.uniform(0, 6))
    out = S.softclip(out * 0.8, 1.5)
    out *= 1 + 0.05 * S.butter(r.standard_normal(n), "lowpass", 3, 2) / 0.05
    hiss = S.butter(r.standard_normal(n), "bandpass", [3000, 9000], 2) * 0.02
    return out * 0.3 + hiss, [SY("fluorescent_buzz")]


def ac_hum():
    x = L(og("household", "airconditioner01.wav"), 10.0, 12.0)
    return x, [og("household", "airconditioner01.wav")]


# ------------------------------------------------------------------ composite ambiences
def _bed(path, ss, t, ch=2):
    try:
        return L(path, ss, t, ch=2)
    except Exception:
        return A.stereo(L(path, ss, t))


def traffic_bangkok(dur=40.0, seed=11):
    """Busy Bangkok road: traffic bed + many scooter passes + tuk-tuk + horns (sparse but frequent)."""
    r = rngs(seed)
    n = int(dur * SR)
    bed = _bed(mk(2930), 2.0, dur)
    bed2 = _bed(mk(2463), 5.0, dur)
    out = np.zeros((n, 2))
    S.place(out, bed[:n] * 0.8, 0)
    S.place(out, bed2[:n] * 1.6, 0)
    used = [mk(2930), mk(2463)]
    t = 0.5
    k = 0
    real1 = L(mk(2732), 0.6, 4.2) * env_points(int(4.2 * SR), [(0, 0.5), (1.6, 1), (3.0, 0.6), (4.2, 0)])
    real2 = L(mk(1606))
    while t < dur - 4:
        if k % 4 == 3:
            y = real1 if (k // 4) % 2 == 0 else real2
            y = A.resample_ratio(y, r.uniform(0.92, 1.1))
        else:
            y, _ = motorbike_pass_syn(seed * 100 + k)
        y = S.butter(y, "lowpass", r.uniform(2500, 9000), 2)
        S.place(out, S.pan(y * r.uniform(0.06, 0.2), r.uniform(-0.9, 0.9)), t)
        t += r.exponential(1.6) + 0.6
        k += 1
    used += [mk(2732), mk(1606)]
    for t0 in r.uniform(1, dur - 2, 7):
        h = L(mk(int(r.choice([717, 718, 719, 1565]))))
        S.place(out, S.pan(S.butter(h, "lowpass", 4000, 2) * r.uniform(0.08, 0.2), r.uniform(-0.9, 0.9)), t0)
    used += [mk(717), mk(718), mk(719), mk(1565)]
    tk, _ = tuktuk_loop(10.0, seed=3)
    tk = doppler_pass(tk, tc=5.0, v=6, d0=8, dur=10)
    S.place(out, S.pan(tk * 0.25, -0.3), dur * 0.45)
    used.append(SY("traffic_mix"))
    return out, used


def street_day(dur=40.0, seed=12):
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    S.place(out, _bed(mk(2505), 4.0, dur)[:n] * 0.9, 0)
    S.place(out, _bed(mk(346), 2.0, dur)[:n] * 5.0, 0)
    S.place(out, _bed(mk(2434), 3.0, dur)[:n] * 0.35, 0)
    used = [mk(2505), mk(346), mk(2434)]
    t = 2.0
    k = 0
    while t < dur - 4:
        y, _ = motorbike_pass_syn(seed * 50 + k)
        y = S.butter(y, "lowpass", 3500, 2)
        S.place(out, S.pan(y * r.uniform(0.06, 0.14), r.uniform(-0.9, 0.9)), t)
        t += r.uniform(3.0, 7.0)
        k += 1
    for t0 in r.uniform(3, dur - 2, 3):
        h = L(mk(int(r.choice([717, 719]))))
        S.place(out, S.pan(S.butter(h, "lowpass", 2500, 2) * 0.05, r.uniform(-1, 1)), t0)
    used += [mk(717), mk(719), SY("street_mix")]
    return out, used


def street_night(dur=40.0, seed=13):
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    S.place(out, _bed(mk(1782), 1.0, min(dur, 31.0))[:n] * 0.6, 0)
    S.place(out, _bed(mk(1782), 1.0, min(dur, 31.0))[:n][::-1] * 0.0, 0)
    cr = _bed(mk(2416), 0.0, 10.5)
    for t0 in np.arange(0, dur, 9.5):
        S.place(out, cr * 0.4 * np.hanning(len(cr))[:, None] ** 0.3, t0)
    S.place(out, _bed(mk(2463), 10.0, dur)[:n] * 0.9, 0)
    used = [mk(1782), mk(2416), mk(2463)]
    # distant dogs + occasional far scooter
    for t0 in r.uniform(4, dur - 4, 3):
        b = L(mk(1), 0.0, 1.4)
        b = S.butter(b, "lowpass", 1800, 2)
        ir = S.make_ir(2.0, 1.6, 2000, stereo=True, seed_=int(t0))
        S.place(out, S.reverb(b * 0.05, ir, wet=0.8, dry=0.3), t0)
    used.append(mk(1))
    for k, t0 in enumerate(r.uniform(2, dur - 5, 4)):
        y, _ = motorbike_pass_syn(900 + k)
        S.place(out, S.pan(S.butter(y, "lowpass", 2000, 2) * 0.05, r.uniform(-1, 1)), t0)
    used.append(SY("street_night_mix"))
    return out, used


def crickets_frogs(dur=30.0):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    a = _bed(mk(40), 0.0, 22.0)
    b = _bed(mk(1789), 0.0, 42.0)
    S.place(out, b[:n] * 0.8, 0)
    for t0 in (0.0, 15.0):
        S.place(out, a[: int(16 * SR)] * np.hanning(int(16 * SR))[:, None] ** 0.5 * 0.9, t0)
    return out, [mk(40), mk(1789)]


def market_crowd(dur=40.0, seed=21, voices=None):
    """Fresh-market bed: crowd chatter + bag rustle + cleaver chops + distant scooters (+ Thai voices if given)."""
    import designs as D
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    S.place(out, _bed(mk(444), 10.0, dur)[:n] * 0.9, 0)
    S.place(out, _bed(mk(352), 1.0, min(30.0, dur))[:n] * 0.6, 0)
    used = [mk(444), mk(352)]
    for t0 in r.uniform(1, dur - 2, 10):
        b, _ = D.plastic_bag(int(t0 * 10), r.uniform(0.4, 0.9))
        S.place(out, S.pan(b * r.uniform(0.05, 0.12), r.uniform(-1, 1)), t0)
    for t0 in r.uniform(1, dur - 3, 5):
        segs = D.chop_hits(og("household", "kitchencuttingboard01.wav"), 10 + t0, 4.0, thr_db=-18, min_gap=0.15,
                           length=0.25)
        for j, s in enumerate(segs[:4]):
            S.place(out, S.pan(S.butter(s, "lowpass", 5000, 2) * 0.12, -0.6), t0 + j * 0.33)
    used += [SY("plastic_bag"), og("household", "kitchencuttingboard01.wav")]
    if voices:
        for (x, t0, g, p) in voices:
            S.place(out, S.pan(x * g, p), t0)
    return out, used


def cicada_chorus(dur=30.0, seed=17):
    """Hot-afternoon cicada chorus (จักจั่น): several buzzing voices (tymbal AM on narrow noise bands)
    swelling in and out, plus a quiet real CC0 cicada recording underneath for texture."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    t = np.arange(n) / SR
    for v in range(7):
        fc = r.uniform(3800, 7200)
        bw = r.uniform(250, 900)
        car = S.butter(r.standard_normal(n), "bandpass", [fc - bw / 2, fc + bw / 2], 2)
        am_rate = r.uniform(140, 260)
        am = (0.5 + 0.5 * np.sin(2 * np.pi * am_rate * t + r.uniform(0, 6))) ** 2
        # song pattern: long swells, some species pulse at a few Hz
        sw_period = r.uniform(6, 14)
        sw = np.clip(np.sin(2 * np.pi * t / sw_period + r.uniform(0, 6)) * 1.4, 0, 1) ** 1.5
        if r.random() < 0.4:
            pulse = (np.sin(2 * np.pi * r.uniform(2, 6) * t) > -0.2).astype(float)
            pulse = S.butter(pulse, "lowpass", 30, 2)
            sw = sw * pulse
        voice = car * am * sw * r.uniform(0.4, 1.0)
        S.place(out, S.pan(voice, r.uniform(-0.8, 0.8)), 0)
    dist = S.butter(r.standard_normal(n), "bandpass", [3500, 8000], 2) * 0.12
    out += A.stereo(dist * (0.7 + 0.3 * np.sin(2 * np.pi * t / 9.0)))
    rec = L(og("cicada", "082526-cicadasounds2_0.ogg"), 2.0, min(dur, 31.0))
    rec = S.butter(rec, "highpass", 2500, 2)
    rec = rec / (np.std(rec) + 1e-9) * np.std(out) * 0.6
    S.place(out, A.stereo(rec[:n]), 0)
    return out, [SY("cicada_chorus"), og("cicada", "082526-cicadasounds2_0.ogg")]


def birds_city(dur=30.0, seed=19):
    """Tropical city birds: dense distant chorus + myna/babbler-like chatter bursts + a few song phrases
    (+ the Commons 'unidentified bird in Bangkok' recording when it is available)."""
    import os
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    ch = _bed(mk(69), 0.0, min(dur, 33.0))
    S.place(out, ch[:n] * 4.0, 0)
    S.place(out, _bed(mk(325), 2.0, min(dur, 38.0))[:n] * 2.0, 0)
    chat = _bed(mk(2433), 0.2, 6.2)
    w = np.hanning(len(chat))[:, None] ** 0.6
    for t0 in np.arange(0.5, dur - 3, r.uniform(4.0, 5.5)):
        c = chat * w
        if r.random() < 0.5:
            c = A.resample_ratio(c, r.uniform(0.9, 1.12))
        S.place(out, c * r.uniform(0.25, 0.45), t0)
    song = _bed(mk(2472), 5.0, dur)
    S.place(out, song[:n] * 0.18, 0)
    used = [mk(69), mk(325), mk(2433), mk(2472)]
    bk = cm("commons_amb", "Sound_of_a_unidentified_bird_in_Bangkok_Thailand.ogg")
    if os.path.exists(bk) and os.path.getsize(bk) > 4000:
        b = A.trim(L(bk), -45, -55)
        for t0 in r.uniform(1, dur - 4, 3):
            S.place(out, S.pan(b[: int(3 * SR)] * 0.5, r.uniform(-0.7, 0.7)), t0)
        used.append(bk)
    return out, used


def fan_loop():
    x = L(mk(1833), 3.0, 14.0)
    n = len(x)
    t = np.arange(n) / SR
    sw = 1 + 0.18 * np.sin(2 * np.pi * t / 7.0)  # oscillating standing fan
    y = S.svf(x * sw, 2500 + 1200 * np.sin(2 * np.pi * t / 7.0), 0.7, "lp")
    return y, [mk(1833)]


def tokay_call():
    """Rattle intro + four 'TOK-KAE' calls, silences shortened (PD recording by Richard Ling)."""
    p = cm("commons_tokay", "Mating_call_of_a_male_Tokay_gecko_(Gekko_gecko).ogg")
    x = L(p)
    segs = [(2.3, 4.3), (10.8, 11.9), (13.8, 14.9), (16.8, 17.9), (19.8, 20.95)]
    out = []
    gaps = [0.9, 1.25, 1.3, 1.35, 0.0]
    for (a, b), g in zip(segs, gaps):
        s = x[int(a * SR):int(b * SR)]
        s = A.fade(s, 0.02, 0.08)
        out.append(s)
        out.append(np.zeros(int(g * SR)))
    y = np.concatenate(out)
    return y, [p]
