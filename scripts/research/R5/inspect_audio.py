#!/usr/bin/env python3
"""Contact sheet of waveform + spectrogram for audio files (so I can *look* at sounds).

python3 -I inspect_audio.py out.png file[@ss:t] ...   (max ~12 per sheet)
Each row: title + stats, waveform (with RMS envelope), log-frequency spectrogram.
"""
import os, sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R5")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import signal
import audiolib as A


def load(spec):
    ss = t = None
    path = spec
    if "@" in spec:
        path, rng = spec.rsplit("@", 1)
        a, b = rng.split(":")
        ss = float(a) if a else None
        t = float(b) if b else None
    x = A.decode(path, ch=1, ss=ss, t=t if t is not None else 40)
    return path, x


def main():
    out = sys.argv[1]
    specs = sys.argv[2:]
    n = len(specs)
    fig, axes = plt.subplots(n, 2, figsize=(16, 1.9 * n), squeeze=False,
                             gridspec_kw={"width_ratios": [1, 1.4]})
    for i, sp in enumerate(specs):
        try:
            path, x = load(sp)
        except Exception as e:
            axes[i][0].set_title(f"ERR {sp}: {e}"[:120], fontsize=7)
            continue
        sr = A.SR
        tt = np.arange(len(x)) / sr
        st = A.analyse(x, fast=True)
        st['dur'] = round(len(x) / sr, 2)
        lbl = os.path.basename(path)[:60]
        if "@" in sp:
            lbl += " @" + sp.rsplit("@", 1)[1]
        ax = axes[i][0]
        step = max(1, len(x) // 4000)
        ax.plot(tt[::step], x[::step], lw=0.4, color="#335")
        e = A.env_rms(x, 0.02)
        ax.plot(tt[::step], e[::step] * 1.41, lw=0.8, color="#d50")
        ax.set_xlim(0, max(tt[-1] if len(tt) else 1, 0.05))
        ax.set_ylim(-1, 1)
        ax.set_title(f"{lbl}  dur={st['dur']}s pk={st['peak_db']}dB lufs={st['lufs']} cen={st['centroid']}Hz",
                     fontsize=7, loc="left")
        ax.tick_params(labelsize=6)
        ax2 = axes[i][1]
        nper = 1024 if len(x) > 4096 else 256
        f, ts, S = signal.spectrogram(x, fs=sr, nperseg=nper, noverlap=nper * 3 // 4)
        S = 10 * np.log10(S + 1e-12)
        vmax = S.max()
        ax2.pcolormesh(ts, f + 1, S, vmin=vmax - 80, vmax=vmax, shading="auto", cmap="magma")
        ax2.set_yscale("log")
        ax2.set_ylim(40, 20000)
        ax2.tick_params(labelsize=6)
    plt.tight_layout()
    plt.savefig(out, dpi=72)


if __name__ == "__main__":
    main()
