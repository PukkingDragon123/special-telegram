"""R5-audio synthesis toolkit (numpy/scipy/numba). Everything returns float64 arrays at SR."""
import math
import numpy as np
from numba import njit
from scipy import signal

SR = 44100
rng = np.random.default_rng(12345)


def seed(s):
    global rng
    rng = np.random.default_rng(s)


def T(dur):
    return np.arange(int(dur * SR)) / SR


def N(dur):
    return int(round(dur * SR))


# ---------------------------------------------------------------- oscillators
def phase_from_freq(f, n=None):
    f = np.broadcast_to(np.asarray(f, dtype=np.float64), (n,)) if n is not None else np.asarray(f, float)
    return 2 * np.pi * np.cumsum(f) / SR


def sine(f, dur=None, n=None, ph0=0.0):
    n = n if n is not None else N(dur)
    return np.sin(phase_from_freq(f, n) + ph0)


def additive(f, n, amps, ratios=None, phase_rand=True):
    """Band-limited additive tone. amps: list of partial amplitudes; ratios default harmonic."""
    ph = phase_from_freq(f, n)
    f = np.broadcast_to(np.asarray(f, float), (n,))
    out = np.zeros(n)
    for i, a in enumerate(amps):
        r = (i + 1) if ratios is None else ratios[i]
        if a == 0:
            continue
        mask = (f * r) < (SR / 2 - 500)
        p0 = rng.uniform(0, 2 * np.pi) if phase_rand else 0
        out += a * np.sin(ph * r + p0) * mask
    return out


def saw(f, n, nh=None):
    fm = float(np.max(f))
    nh = nh or max(1, int((SR / 2 - 1000) / max(fm, 20)))
    nh = min(nh, 120)
    return additive(f, n, [(-1) ** (k + 1) / k for k in range(1, nh + 1)], phase_rand=False) * (2 / np.pi)


def square(f, n, nh=None, duty=0.5):
    fm = float(np.max(f))
    nh = nh or max(1, int((SR / 2 - 1000) / max(fm, 20)))
    nh = min(nh, 120)
    if duty == 0.5:
        amps = [(1 / k if k % 2 else 0) for k in range(1, nh + 1)]
    else:
        amps = [math.sin(math.pi * k * duty) / k for k in range(1, nh + 1)]
    return additive(f, n, amps, phase_rand=False) * (4 / np.pi)


def tri(f, n, nh=None):
    fm = float(np.max(f))
    nh = nh or max(1, int((SR / 2 - 1000) / max(fm, 20)))
    nh = min(nh, 60)
    amps = [((-1) ** ((k - 1) // 2) / k ** 2 if k % 2 else 0) for k in range(1, nh + 1)]
    return additive(f, n, amps, phase_rand=False) * (8 / np.pi ** 2)


def noise(n, kind="white"):
    w = rng.standard_normal(n)
    if kind == "white":
        return w / 3
    if kind == "pink":
        # Voss-McCartney-ish via filtering
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        return signal.lfilter(b, a, w) * 3
    if kind == "brown":
        y = np.cumsum(w)
        y = signal.lfilter([1, -1], [1, -0.995], y)
        return y / (np.max(np.abs(y)) + 1e-9)
    raise ValueError(kind)


# ---------------------------------------------------------------- envelopes
def env_exp(n, tau, a=0.002):
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    na = max(1, int(a * SR))
    e[:na] *= np.linspace(0, 1, na)
    return e


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2, gate=None):
    gate = gate if gate is not None else n / SR - r
    e = np.zeros(n)
    ia, idd, ig = int(a * SR), int((a + d) * SR), int(gate * SR)
    ia = max(ia, 1)
    e[:ia] = np.linspace(0, 1, ia)[: len(e[:ia])]
    if idd > ia:
        seg = e[ia:idd]
        e[ia:idd] = np.linspace(1, s, idd - ia)[: len(seg)]
    if ig > idd:
        e[idd:ig] = s
    lvl = e[min(ig, n) - 1] if ig > 0 else s
    nr = n - ig
    if nr > 0:
        e[ig:] = lvl * np.exp(-np.arange(nr) / (max(r, 1e-3) * SR / 5))
    return e


def lin_env(n, points):
    """points: list of (time_s, value); linear interpolation."""
    ts = np.array([p[0] for p in points]) * SR
    vs = np.array([p[1] for p in points])
    return np.interp(np.arange(n), ts, vs)


def glide(n, points):
    """exponential-ish glide for frequency: interpolate in log domain."""
    ts = np.array([p[0] for p in points]) * SR
    vs = np.log(np.array([p[1] for p in points]))
    return np.exp(np.interp(np.arange(n), ts, vs))


# ---------------------------------------------------------------- filters
def butter(x, kind, f, order=2):
    sos = signal.butter(order, f, kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


@njit(cache=True)
def _svf(x, fc, q, mode):
    n = x.shape[0]
    y = np.zeros(n)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        g = math.tan(math.pi * min(fc[i], 20000.0) / 44100.0)
        k = 1.0 / q[i]
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if mode == 0:
            y[i] = v2            # low
        elif mode == 1:
            y[i] = v1            # band
        elif mode == 2:
            y[i] = x[i] - k * v1 - v2  # high
        else:
            y[i] = k * v1        # band, unity peak
    return y


def svf(x, fc, q=0.707, mode="lp"):
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, float), (n,)).copy()
    q = np.broadcast_to(np.asarray(q, float), (n,)).copy()
    m = {"lp": 0, "bp": 1, "hp": 2, "bpn": 3}[mode]
    return _svf(np.ascontiguousarray(x, dtype=np.float64), fc, q, m)


def peaking(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A]
    a = [1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A]
    return signal.lfilter(b, a, x, axis=0)


def resonator_bank(x, freqs, decays, gains):
    """Sum of 2-pole resonators (modal synthesis). decays in seconds (T60-ish)."""
    out = np.zeros(len(x))
    for f, d, g in zip(freqs, decays, gains):
        if f >= SR / 2 - 100:
            continue
        r = math.exp(-6.9 / (d * SR))
        w = 2 * np.pi * f / SR
        b = [1 - r]
        a = [1, -2 * r * math.cos(w), r * r]
        out += g * signal.lfilter(b, a, x)
    return out


# ---------------------------------------------------------------- physical-ish
@njit(cache=True)
def _ks(n, period, decay, bright, excite):
    y = np.zeros(n)
    p = len(excite)
    buf = excite.copy()
    idx = 0
    last = 0.0
    for i in range(n):
        cur = buf[idx]
        nxt = buf[(idx + 1) % p]
        v = decay * (bright * cur + (1 - bright) * 0.5 * (cur + nxt))
        v = 0.5 * (v + last) if bright < 0.0 else v
        last = v
        y[i] = cur
        buf[idx] = v
        idx = (idx + 1) % p
    return y


def pluck(freq, dur, decay=0.996, bright=0.5, pick=0.3, seed_=None):
    """Karplus-Strong plucked string."""
    p = max(2, int(round(SR / freq)))
    r = np.random.default_rng(seed_) if seed_ is not None else rng
    ex = r.uniform(-1, 1, p)
    # pick position comb + lowpass the excitation for softer pluck
    ex = ex - np.roll(ex, int(p * pick))
    ex = signal.lfilter([1 - bright * 0.5], [1, -bright * 0.5], ex)
    y = _ks(N(dur), p, decay, 0.5 + bright * 0.5, ex.astype(np.float64))
    return y / (np.max(np.abs(y)) + 1e-9)


def bar(freq, dur, ratios=(1, 3.93, 9.0, 15.0), decays=(1.0, 0.35, 0.12, 0.06), gains=(1, 0.5, 0.25, 0.1),
        hardness=0.6, seed_=None):
    """Struck bar / mallet instrument via modal resonators excited by a short click."""
    n = N(dur)
    r = np.random.default_rng(seed_) if seed_ is not None else rng
    ex = np.zeros(n)
    m = max(2, int(SR * (0.0015 + 0.004 * (1 - hardness))))
    ex[:m] = np.hanning(m) * (1 + 0.3 * r.standard_normal(m))
    y = resonator_bank(ex, [freq * q for q in ratios], decays, gains)
    return y / (np.max(np.abs(y)) + 1e-9)


def fm_bell(freq, dur, ratio=1.4, index=4.0, tau=1.5, itau=0.6):
    t = T(dur)
    mod = index * np.exp(-t / itau) * np.sin(2 * np.pi * freq * ratio * t)
    return np.sin(2 * np.pi * freq * t + mod) * np.exp(-t / tau)


# ---------------------------------------------------------------- reverb / space
def make_ir(dur=2.0, decay=1.5, damp=6000, predelay=0.01, stereo=True, er=True, seed_=7):
    r = np.random.default_rng(seed_)
    n = N(dur)
    t = np.arange(n) / SR
    ch = 2 if stereo else 1
    ir = np.zeros((n, ch))
    for c in range(ch):
        nz = r.standard_normal(n) * np.exp(-6.9 * t / decay)
        # progressive damping: blend lowpassed version over time
        lpz = butter(nz, "lowpass", damp, 1)
        lpz2 = butter(nz, "lowpass", max(800, damp / 4), 1)
        w = np.clip(t / decay, 0, 1)
        ir[:, c] = (1 - w) * lpz + w * lpz2
        if er:
            for k in range(8):
                d = int(SR * (predelay + r.uniform(0.003, 0.05)))
                if d < n:
                    ir[d, c] += r.uniform(0.2, 0.6) * (1 if r.random() > 0.5 else -1)
    pd = int(predelay * SR)
    ir = np.vstack([np.zeros((pd, ch)), ir])[:n]
    ir /= np.sqrt((ir ** 2).sum(axis=0, keepdims=True)) + 1e-9
    return ir if stereo else ir[:, 0]


def reverb(x, ir, wet=0.25, dry=1.0):
    """x mono or stereo; ir stereo (n,2) -> stereo out (len(x)+len(ir)-1)."""
    if x.ndim == 1:
        xs = np.stack([x, x], axis=1)
    else:
        xs = x
    if ir.ndim == 1:
        ir = np.stack([ir, ir], axis=1)
    L = len(xs) + len(ir) - 1
    out = np.zeros((L, 2))
    for c in range(2):
        out[:, c] = signal.fftconvolve(xs[:, c], ir[:, c])
    out *= wet
    out[: len(xs)] += dry * xs
    return out


def pan(x, p):
    """p in [-1,1], equal power."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def place(buf, x, t0):
    """Mix x into buf at time t0 (s). buf mono/stereo; x matches channels."""
    i = int(round(t0 * SR))
    if i >= len(buf):
        return buf
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i]
    return buf


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def chorus(x, depth=0.003, rate=0.8, mix=0.5):
    n = len(x)
    t = np.arange(n) / SR
    d = (depth * (1 + np.sin(2 * np.pi * rate * t)) / 2 + 0.005) * SR
    idx = np.arange(n) - d
    y = np.interp(idx, np.arange(n), x, left=0)
    return (1 - mix) * x + mix * y


def normalize_peak(x, p=0.9):
    return x * (p / (np.max(np.abs(x)) + 1e-12))


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)
