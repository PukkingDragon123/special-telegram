"""R5-audio processing helpers: decode, trim, fade, loop, loudness, limit, encode, analyse.

All heavy lifting is numpy/scipy + ffmpeg subprocesses. Import with the R5 dir on sys.path.
"""
import json, math, os, subprocess
import numpy as np
from scipy import signal

SR = 44100
ROOT = "/home/user/special-telegram"
OUT = os.path.join(ROOT, "public/assets/audio")
DL = os.path.join(ROOT, "scripts/_cache/audio_dl")
WORK = os.path.join(ROOT, "scripts/_cache/audio_work")


# ---------------------------------------------------------------- io
def decode(path, ch=1, sr=SR, af=None, ss=None, t=None):
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if ss is not None:
        cmd += ["-ss", str(ss)]
    if t is not None:
        cmd += ["-t", str(t)]
    cmd += ["-i", path]
    if af:
        cmd += ["-af", af]
    cmd += ["-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"decode failed {path}: {r.stderr.decode()[:400]}")
    x = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
    if ch == 2:
        x = x.reshape(-1, 2)
    return x


def ffilter(x, af, sr=SR):
    """Run an ffmpeg audio filter chain on an array (keeps channel count)."""
    ch = 1 if x.ndim == 1 else x.shape[1]
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
           "-af", af, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"]
    r = subprocess.run(cmd, input=x.astype(np.float32).tobytes(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffilter failed {af}: {r.stderr.decode()[:400]}")
    y = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
    return y.reshape(-1, ch) if ch == 2 else y


def write_wav(x, path, sr=SR):
    import soundfile as sf
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, np.clip(x, -1, 1).astype(np.float32), sr, subtype="FLOAT")


def encode_mp3(x, path, kbps=112, sr=SR):
    ch = 1 if x.ndim == 1 else x.shape[1]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
           "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(sr), "-map_metadata", "-1", "-write_xing", "1", path]
    r = subprocess.run(cmd, input=np.clip(x, -1, 1).astype(np.float32).tobytes(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:400])


# ---------------------------------------------------------------- basic ops
def mono(x):
    return x if x.ndim == 1 else x.mean(axis=1)


def stereo(x):
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def db(v):
    return 20 * math.log10(max(v, 1e-12))


def peak(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def env_rms(x, win=0.01, sr=SR):
    m = mono(x)
    n = max(1, int(win * sr))
    k = np.ones(n) / n
    return np.sqrt(np.convolve(m * m, k, mode="same") + 1e-20)


def trim(x, thr_db=-45.0, tail_db=-55.0, pre=0.004, post=0.03, sr=SR):
    """Trim leading/trailing silence relative to the peak envelope."""
    e = env_rms(x, 0.005, sr)
    pk = e.max()
    if pk <= 0:
        return x
    on = np.where(e > pk * 10 ** (thr_db / 20))[0]
    off = np.where(e > pk * 10 ** (tail_db / 20))[0]
    if len(on) == 0:
        return x
    s = max(0, on[0] - int(pre * sr))
    t = min(len(x), off[-1] + int(post * sr))
    return x[s:t]


def fade(x, fin=0.003, fout=0.03, sr=SR, curve="cos"):
    y = x.copy()
    n = len(y)
    a = min(int(fin * sr), n // 2)
    b = min(int(fout * sr), n // 2)
    if a > 0:
        r = np.linspace(0, 1, a)
        w = np.sin(r * np.pi / 2) ** 2 if curve == "cos" else r
        y[:a] = (y[:a].T * w).T
    if b > 0:
        r = np.linspace(1, 0, b)
        w = np.sin(r * np.pi / 2) ** 2 if curve == "cos" else r
        y[n - b:] = (y[n - b:].T * w).T
    return y


def make_loop(x, xfade=1.0, sr=SR, length=None):
    """Seamless loop: out = x[0:L] with its head crossfaded (equal power) into x[L:L+X]."""
    X = int(xfade * sr)
    L = (len(x) - X) if length is None else int(length * sr)
    L = min(L, len(x) - X)
    assert L > X, "source too short for loop"
    out = x[:L].copy()
    t = np.linspace(0, 1, X)
    fi = np.sin(t * np.pi / 2)
    fo = np.cos(t * np.pi / 2)
    out[:X] = (x[:X].T * fi).T + (x[L:L + X].T * fo).T
    return out


def resample_ratio(x, ratio):
    """Pitch/tempo change by resampling (ratio>1 = higher & shorter)."""
    from fractions import Fraction
    f = Fraction(ratio).limit_denominator(200)
    return signal.resample_poly(x, f.denominator, f.numerator, axis=0)


def hp(x, f, order=2, sr=SR):
    sos = signal.butter(order, f, "highpass", fs=sr, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def lp(x, f, order=2, sr=SR):
    sos = signal.butter(order, f, "lowpass", fs=sr, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def bp(x, f1, f2, order=2, sr=SR):
    sos = signal.butter(order, [f1, f2], "bandpass", fs=sr, output="sos")
    return signal.sosfilt(sos, x, axis=0)


# ---------------------------------------------------------------- loudness
_meters = {}


def lufs(x, sr=SR):
    import pyloudnorm as pyln
    if sr not in _meters:
        _meters[sr] = pyln.Meter(sr)
    y = x
    if len(y) < int(0.45 * sr):  # pad very short sounds (centre) so a 400 ms block exists
        padn = int(0.45 * sr) - len(y)
        pw = ((padn // 2, padn - padn // 2),) + (((0, 0),) if y.ndim == 2 else ())
        y = np.pad(y, pw)
    try:
        v = _meters[sr].integrated_loudness(y)
    except Exception:
        v = -70.0
    return float(v) if np.isfinite(v) else -70.0


def true_peak(x):
    y = signal.resample_poly(x, 4, 1, axis=0)
    return max(peak(x), float(np.max(np.abs(y))))


def limiter(x, ceiling_db=-1.0, attack=0.0015, release=0.012, hold=0.003, sr=SR):
    """Lookahead peak limiter. Fast defaults (spike tamer); use longer release for musical material."""
    from scipy.ndimage import maximum_filter1d
    c = 10 ** (ceiling_db / 20)
    a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
    la = max(1, int(attack * sr))
    m = maximum_filter1d(a, size=2 * la + 1, mode="nearest")
    gr = np.maximum(0.0, 20 * np.log10(np.maximum(m, 1e-12) / c))
    hn = max(1, int(hold * sr))
    hold_gr = maximum_filter1d(gr, size=2 * hn + 1, mode="nearest")
    rel = math.exp(-1.0 / (release * sr))
    sm = signal.lfilter([1 - rel], [1, -rel], hold_gr)
    gr_s = np.maximum(sm, hold_gr)
    gr_s = np.convolve(gr_s, np.ones(la) / la, mode="same")
    gr_s = np.maximum(gr_s, gr)
    gs = 10 ** (-gr_s / 20)
    return (x.T * gs).T


def tp_clip(x, ceiling_db=-1.0):
    """Final true-peak safety: 4x oversampled soft clip of residual overs, back to SR."""
    c = 10 ** (ceiling_db / 20)
    y = signal.resample_poly(x, 4, 1, axis=0)
    over = np.abs(y) > c * 0.9
    if not over.any():
        return x
    k = c * 0.9
    z = np.where(np.abs(y) <= k, y, np.sign(y) * (k + (c - k) * np.tanh((np.abs(y) - k) / (c - k))))
    return signal.resample_poly(z, 1, 4, axis=0)[: len(x)]


def normalize(x, target=-16.0, tp=-1.0, limit=True, max_gain_db=40.0, max_gr_db=9.0, slow=False):
    """Gain to target LUFS; tame peaks with a lookahead limiter (iterating so the target is still met)
    but never more than max_gr_db of peak reduction; final oversampled TP safety."""
    L0 = lufs(x)
    g = min(target - L0, max_gain_db)
    rel = 0.08 if slow else 0.012
    hold = 0.01 if slow else 0.003
    y = x * 10 ** (g / 20)
    if limit:
        for _ in range(3):
            p = true_peak(y)
            if p <= 10 ** (tp / 20):
                break
            over_db = db(p) - tp
            if over_db > max_gr_db:  # would squash too hard: back the gain off
                y = y * 10 ** (-(over_db - max_gr_db) / 20)
            y = limiter(y, tp - 0.4, release=rel, hold=hold)
            Ln = lufs(y)
            if Ln < target - 0.5:
                y = y * 10 ** (min(target - Ln, 6.0) / 20)
            else:
                break
        y = limiter(y, tp - 0.4, release=rel, hold=hold)
        y = tp_clip(y, tp)
    p = true_peak(y)
    if p > 10 ** (tp / 20):
        y = y * (10 ** (tp / 20) / p) * 0.99
    return y


# ---------------------------------------------------------------- analysis
def analyse(x, sr=SR, fast=False):
    if fast and len(x) > sr * 20:
        x = x[: sr * 20]
    m = mono(x)
    n = len(m)
    spec = np.abs(np.fft.rfft(m[: min(n, sr * 30)] * np.hanning(min(n, sr * 30))))
    freqs = np.fft.rfftfreq(min(n, sr * 30), 1 / sr)
    cen = float((spec * freqs).sum() / max(spec.sum(), 1e-12))
    e = env_rms(m, 0.05, sr)
    return {
        "dur": round(n / sr, 3), "peak_db": round(db(peak(x)), 2), "tp_db": round(db(peak(x) if fast else true_peak(x)), 2),
        "lufs": round(lufs(x), 1), "centroid": int(cen),
        "silent_frac": round(float((e < 10 ** (-60 / 20)).mean()), 3),
    }


def spectrogram_png(path_in, png, w=800, h=200):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", path_in, "-lavfi",
                    f"showspectrumpic=s={w}x{h}:legend=0:scale=log:fscale=log", png], check=True)
