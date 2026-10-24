#!/usr/bin/env python3
"""R5-audio original music (numpy synthesis): Thai-flavoured loops, menu theme, jingles.

python3 -I music.py [name ...]   -> scripts/_cache/audio_work/synth/music_<name>.wav (stereo float)
All compositions are original (pentatonic melodies written for this project).
"""
import os, sys
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R5")
import numpy as np
from scipy import signal
import audiolib as A
import synth as S

SR = A.SR
OUTD = os.path.join(A.WORK, "synth")
os.makedirs(OUTD, exist_ok=True)
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def m(name):
    """'C5', 'Bb3', 'F#4' -> midi"""
    n = NOTE[name[0]]
    i = 1
    if name[1] in "#b":
        n += 1 if name[1] == "#" else -1
        i = 2
    return 12 * (int(name[i:]) + 1) + n


def hz(x):
    return S.midi(x if isinstance(x, (int, float)) else m(x))


# ------------------------------------------------------------------ instruments (mono arrays)
def ranat(f, dur, vel=1.0, rng=None):
    """Ranat ek (Thai wooden xylophone, hard mallets): modal bar + click; played in octaves by caller."""
    n = int(max(dur, 0.6) * SR)
    sc = (440.0 / f) ** 0.35
    ex = np.zeros(n)
    k = int(0.0012 * SR)
    ex[:k] = np.hanning(k)
    y = S.resonator_bank(ex, [f, f * 3.94, f * 8.9, f * 1.0 * 2.01],
                         [0.55 * sc, 0.14 * sc, 0.05, 0.25 * sc], [1.0, 0.45, 0.18, 0.1])
    click = S.butter(S.noise(int(0.004 * SR)), "highpass", 2000, 2) * 0.06
    y[: len(click)] += click
    y /= np.max(np.abs(y)) + 1e-9
    return y * vel


def khim(f, dur, vel=1.0):
    """Khim (Thai hammered dulcimer): two slightly detuned bright struck strings."""
    d = max(dur, 1.2)
    a = S.pluck(f, d, decay=0.9975, bright=0.75, pick=0.12, seed_=int(f))
    b = S.pluck(f * 1.0025, d, decay=0.9972, bright=0.7, pick=0.15, seed_=int(f) + 7)
    y = (a + b) * 0.5
    y = S.butter(y, "highpass", 80, 2)
    return y * vel


def harp(f, dur, vel=1.0):
    d = max(dur, 2.0)
    y = S.pluck(f, d, decay=0.9985, bright=0.35, pick=0.3, seed_=int(f * 3))
    return S.butter(y, "lowpass", 6000, 2) * vel


def pizz(f, dur, vel=1.0):
    y = S.pluck(f, 0.5, decay=0.993, bright=0.4, pick=0.2, seed_=int(f * 5))
    return S.butter(y, "lowpass", 3500, 2) * vel


def guitar(f, dur, vel=1.0):
    d = max(dur, 1.4)
    y = S.pluck(f, d, decay=0.9968, bright=0.55, pick=0.18, seed_=int(f * 11))
    y = S.peaking(y, 2500, 3, 1.0)
    return y * vel


def ep(f, dur, vel=1.0):
    """Rhodes-ish electric piano (FM) with gentle tremolo."""
    d = max(dur, 0.4) + 0.6
    n = int(d * SR)
    t = np.arange(n) / SR
    idx = 1.8 * np.exp(-t / 0.35) + 0.25
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    y += 0.15 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t / 0.08)
    env = np.exp(-t / 1.4) * np.minimum(1, t / 0.004)
    rel = np.clip((d - t) / 0.25, 0, 1)
    y *= env * rel * (1 + 0.12 * np.sin(2 * np.pi * 4.5 * t))
    return y * vel * 0.6


def bell(f, dur, vel=1.0, tau=1.6):
    n = int(max(dur, tau * 2) * SR)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / tau) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / (tau * 0.4))
         + 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / (tau * 0.2)))
    y *= np.minimum(1, t / 0.002) * np.clip((t[-1] - t) / 0.2, 0, 1)
    return y * vel * 0.6


def pad(f, dur, vel=1.0, bright=1800, att=1.2):
    n = int((dur + 1.2) * SR)
    y = sum(S.saw(f * d, n) for d in (0.995, 1.0, 1.006)) / 3
    y = S.butter(y, "lowpass", bright, 2)
    t = np.arange(n) / SR
    env = np.minimum(1, t / att) * np.clip((dur + 1.2 - t) / 1.2, 0, 1)
    return S.chorus(y * env, 0.004, 0.3, 0.4) * vel * 0.5


def strings(f, dur, vel=1.0):
    n = int((dur + 0.8) * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t)
    y = sum(S.saw(f * d * vib, n) for d in (0.996, 1.0, 1.005, 2.0)) / 4
    y = S.butter(y, "lowpass", 3200, 2)
    env = np.minimum(1, t / 0.35) * np.clip((dur + 0.8 - t) / 0.8, 0, 1)
    return y * env * vel * 0.5


def choir(f, dur, vel=1.0, vowel="a"):
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    F = {"a": [(700, 6), (1150, 8), (2700, 10)], "o": [(450, 6), (800, 7), (2600, 10)]}[vowel]
    out = np.zeros(n)
    for v in range(5):
        r = np.random.default_rng(int(f) + v)
        vib = 1 + 0.006 * np.sin(2 * np.pi * r.uniform(4.6, 5.8) * t + r.uniform(0, 6))
        src = S.saw(f * vib * r.uniform(0.995, 1.005), n) + 0.06 * r.standard_normal(n)
        for (fc, q), g in zip(F, [1.0, 0.55, 0.3]):
            out += g * S.svf(src, fc, q, "bpn")
    env = np.minimum(1, t / 0.5) * np.clip((dur + 0.9 - t) / 0.9, 0, 1)
    return out / 5 * env * vel * 0.8


def khaen(freqs, dur, vel=1.0):
    """Khaen (Isan free-reed mouth organ) chord/drone with breathing swells."""
    n = int((dur + 0.5) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        amps = [1.0, 0.7, 0.55, 0.35, 0.3, 0.2, 0.15, 0.1]
        out += S.additive(f * (1 + 0.0015 * np.sin(2 * np.pi * 0.3 * t)), n, amps)
    breath = 1 + 0.12 * np.sin(2 * np.pi * 5.3 * t) * np.minimum(1, t / 1.0)
    out = S.butter(out * breath, "lowpass", 3800, 2) + S.butter(S.noise(n), "bandpass", [600, 3000], 2) * 0.03
    env = np.minimum(1, t / 0.18) * np.clip((dur + 0.5 - t) / 0.5, 0, 1)
    return out / len(freqs) * env * vel * 0.5


def bass(f, dur, vel=1.0):
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.2)
    env = np.minimum(1, t / 0.008) * np.exp(-t / 1.2) * np.clip((dur + 0.15 - t) / 0.12, 0, 1)
    return S.softclip(y * env * 1.2, 1.1) * vel


def ching(open_=True, vel=1.0):
    n = int((0.9 if open_ else 0.15) * SR)
    t = np.arange(n) / SR
    tau = 0.55 if open_ else 0.035
    y = sum(g * np.sin(2 * np.pi * f * t + p) for f, g, p in
            [(3150, 1.0, 0), (4420, 0.8, 1), (5890, 0.6, 2), (7330, 0.45, 3), (9810, 0.3, 4), (12100, 0.2, 5)])
    y = y * np.exp(-t / tau) + S.butter(S.noise(n), "highpass", 5000, 2) * np.exp(-t / 0.02) * 0.6
    return y * np.minimum(1, t / 0.0008) * vel * 0.25


def thon(kind="tum", vel=1.0):
    if kind == "tum":
        n = int(0.5 * SR)
        f = S.glide(n, [(0, 150), (0.05, 105), (0.5, 98)])
        y = S.sine(f, n=n) * S.env_exp(n, 0.18, a=0.002)
        y += S.butter(S.noise(n), "bandpass", [200, 1200], 2) * S.env_exp(n, 0.015) * 0.4
    else:
        n = int(0.25 * SR)
        imp = np.zeros(n)
        imp[:30] = np.hanning(30)
        y = S.resonator_bank(imp, [420, 690, 1150], [0.05, 0.035, 0.02], [1, .7, .4])
        y = y / (np.max(np.abs(y)) + 1e-9) + S.butter(S.noise(n), "highpass", 1500, 2) * S.env_exp(n, 0.01) * 0.4
    return y * vel


def kick(vel=1.0):
    n = int(0.35 * SR)
    f = S.glide(n, [(0, 130), (0.04, 60), (0.35, 45)])
    return S.sine(f, n=n) * S.env_exp(n, 0.12, a=0.001) * vel


def brush(vel=1.0):
    n = int(0.25 * SR)
    y = S.butter(S.noise(n), "bandpass", [900, 7000], 2) * S.env_exp(n, 0.07, a=0.004)
    imp = np.zeros(n)
    imp[:40] = np.hanning(40)
    y += 0.5 * S.resonator_bank(imp, [190, 330], [0.06, 0.04], [1, .5]) / 1.0
    return y * vel * 0.6


def shaker(vel=1.0):
    n = int(0.07 * SR)
    return S.butter(S.noise(n), "highpass", 6000, 2) * np.hanning(n) * vel * 0.35


def timp(f, vel=1.0):
    n = int(1.6 * SR)
    fg = S.glide(n, [(0, f * 1.08), (0.08, f)])
    y = S.sine(fg, n=n) * S.env_exp(n, 0.55, a=0.002) + 0.3 * S.sine(fg * 1.5, n=n) * S.env_exp(n, 0.3)
    y += S.butter(S.noise(n), "lowpass", 500, 2) * S.env_exp(n, 0.04) * 0.5
    return y * vel


def cymbal_swell(dur, vel=1.0):
    n = int(dur * SR)
    y = S.butter(S.noise(n), "highpass", 3000, 2)
    return y * np.linspace(0, 1, n) ** 2 * vel * 0.3


# ------------------------------------------------------------------ sequencer
class Song:
    def __init__(self, bpm, beats, tail=4.0):
        self.bpm = bpm
        self.spb = 60.0 / bpm
        self.L = beats * self.spb
        self.n = int((self.L + tail) * SR)
        self.dry = np.zeros((self.n, 2))
        self.send = np.zeros((self.n, 2))

    def add(self, beat, x, pan=0.0, gain=1.0, rev=0.25):
        t = beat * self.spb
        st = S.pan(x * gain, pan)
        S.place(self.dry, st, t)
        S.place(self.send, st * rev, t)

    def render(self, ir_dur=2.4, decay=2.0, damp=6000, loop=True, warm=False, lp=None):
        ir = S.make_ir(ir_dur, decay, damp, stereo=True, seed_=5)
        wet = S.reverb(self.send, ir, wet=1.0, dry=0.0)[: self.n]
        mix = self.dry + wet
        if lp:
            mix = S.butter(mix, "lowpass", lp, 2)
        if warm:  # tape-ish warmth
            mix = S.softclip(mix * 1.2, 1.3)
            mix = S.butter(mix, "lowpass", 9500, 2)
            tt = np.arange(len(mix)) / SR
            wow = 0.0012 * np.sin(2 * np.pi * 0.55 * tt)
            idx = np.arange(len(mix)) + wow * SR
            mix = np.stack([np.interp(idx, np.arange(len(mix)), mix[:, c]) for c in range(2)], axis=1)
        if loop:
            Ln = int(self.L * SR)
            out = mix[:Ln].copy()
            tail = mix[Ln:]
            k = min(len(tail), Ln)
            out[:k] += tail[:k]
            return out
        return mix


def deg(d, base="C", octave=5):
    """Pentatonic scale degree strings like '5', '6', '1+', '3-' -> midi."""
    scale = {"1": 0, "2": 2, "3": 4, "5": 7, "6": 9}
    oc = octave + d.count("+") - d.count("-")
    return 12 * (oc + 1) + NOTE[base] + scale[d.strip("+-")]


# ------------------------------------------------------------------ pieces
def day_gameplay():
    """Light Thai-flavoured street loop: ranat ek melody in octaves, khim, khaen drone, ching & thon groove."""
    bpm = 104
    phrases = {
        "A": ["5 6 5 3 2 3 5 .", "6 1+ 6 5 3 5 6 .", "5 3 2 1 2 3 2 1", "6- 1 2 3 2 ~ ~ ~"],
        "A2": ["5 6 5 3 2 3 5 .", "6 1+ 6 5 3 5 6 .", "3 5 6 1+ 6 5 3 2", "1 2 3 5 1 ~ ~ ~"],
        "B": ["1+ 1+ 6 1+ 2+ 1+ 6 5", "6 5 3 5 6 . 5 .", "3 3 2 3 5 3 2 1", "2 3 5 6 5 ~ ~ ~"],
        "A3": ["5 6 5 3 2 3 5 .", "6 1+ 6 5 3 5 6 .", "5 3 2 1 2 3 2 1", "2 3 2 1 1 ~ ~ ~"],
    }
    order = ["A", "A2", "B", "A3"]
    song = Song(bpm, 64, tail=4.0)
    rng = np.random.default_rng(7)
    bar = 0
    for ph in order:
        for line in phrases[ph]:
            toks = line.split()
            i = 0
            while i < 8:
                tk = toks[i]
                if tk in (".", "~"):
                    i += 1
                    continue
                ln = 1
                while i + ln < 8 and toks[i + ln] == "~":
                    ln += 1
                beat = bar * 4 + i * 0.5
                mid = deg(tk, "C", 5)
                d = ln * 0.5 * song.spb
                v = 0.8 + 0.2 * rng.random()
                if ln >= 3:  # tremolo roll on long notes (ranat style)
                    k = int(ln * 0.5 * 8)
                    for j in range(k):
                        vv = v * (0.55 + 0.25 * (j % 2))
                        song.add(beat + j * 0.125, ranat(hz(mid), 0.3, vv), -0.1, 0.5, 0.25)
                        song.add(beat + j * 0.125 + 0.01, ranat(hz(mid + 12), 0.3, vv * 0.6), 0.15, 0.35, 0.25)
                else:
                    song.add(beat + rng.normal(0, 0.006), ranat(hz(mid), d, v), -0.1, 0.55, 0.25)
                    song.add(beat + 0.012, ranat(hz(mid + 12), d, v * 0.7), 0.15, 0.38, 0.25)
                i += ln
            # accompaniment per bar
            root = {0: "C3", 1: "A2", 2: "G2", 3: "G2"}[bar % 4] if ph != "B" else {0: "A2", 1: "C3", 2: "C3", 3: "G2"}[bar % 4]
            rm = m(root)
            for j, iv in enumerate([0, 7, 12, 7, 16, 7, 12, 7]):
                song.add(bar * 4 + j * 0.5, khim(hz(rm + 12 + iv), 0.5, 0.35 + 0.1 * (j % 2 == 0)), 0.35, 0.45, 0.3)
            song.add(bar * 4, bass(hz(rm), 1.6 * song.spb, 0.7), 0.0, 0.55, 0.05)
            song.add(bar * 4 + 2, bass(hz(rm + 7), 1.6 * song.spb, 0.55), 0.0, 0.5, 0.05)
            for b in range(4):
                song.add(bar * 4 + b, ching(open_=(b % 2 == 1), vel=0.9 if b % 2 else 0.6), 0.5, 0.3, 0.2)
            for b, kind, v in [(0, "tum", 0.9), (1.5, "tak", 0.6), (2, "tum", 0.7), (3, "tak", 0.7), (3.5, "tak", 0.5)]:
                song.add(bar * 4 + b, thon(kind, v), -0.35, 0.55, 0.15)
            bar += 1
    # khaen drone: C + G (+ upper C), swelling per 4-bar phrase
    for p in range(4):
        song.add(p * 16, khaen([hz("C4"), hz("G4"), hz("C5")], 16 * song.spb - 0.2, 0.55), -0.25, 0.6, 0.35)
    return song.render(2.2, 1.6, 6500, loop=True, lp=11000)


def main_menu():
    """Warm, slightly lo-fi 2000s Thai-indie feel: clean guitar arpeggios, EP, brushed kit, bass, glock lead."""
    bpm = 92
    prog = [("C3", [0, 4, 7, 11]), ("A2", [0, 3, 7, 10]), ("D3", [0, 3, 7, 10]), ("G2", [0, 5, 7, 10]),
            ("C3", [0, 4, 7, 11]), ("E3", [0, 3, 7, 10]), ("F2", [0, 4, 7, 11]), ("G2", [0, 4, 7, 9])]
    song = Song(bpm, 64, tail=4.0)
    rng = np.random.default_rng(3)
    lead = ["E5 . G5 . A5 G5 E5 .", "C5 . D5 E5 ~ . . .", "F5 . E5 . D5 C5 D5 .", "D5 ~ ~ . . . . .",
            "E5 . G5 . C6 B5 A5 .", "G5 . E5 . D5 ~ . .", "C5 . D5 . E5 . A5 G5", "G5 ~ ~ ~ . . . ."]
    for rep in range(2):
        for bi, (root, ch) in enumerate(prog):
            bar = rep * 8 + bi
            rm = m(root)
            notes = [rm + 12 + iv for iv in ch]
            arp = [notes[0], notes[2], notes[3] + 12 if notes[3] < notes[0] + 12 else notes[3], notes[1] + 12,
                   notes[2] + 12, notes[1] + 12, notes[3], notes[2]]
            for j, nn in enumerate(arp):
                song.add(bar * 4 + j * 0.5 + rng.normal(0, 0.008), guitar(hz(nn), 1.2, 0.45 + 0.1 * (j == 0)),
                         0.3, 0.55, 0.25)
            for b, ln in [(0, 1.4), (1.5, 0.9), (3, 0.9)]:
                for nn in notes[1:]:
                    song.add(bar * 4 + b, ep(hz(nn + 12), ln * song.spb, 0.35), -0.3, 0.45, 0.3)
            song.add(bar * 4, bass(hz(rm), 1.4 * song.spb, 0.8), 0, 0.6, 0.05)
            song.add(bar * 4 + 1.5, bass(hz(rm + 7), 0.4 * song.spb, 0.5), 0, 0.5, 0.05)
            song.add(bar * 4 + 2, bass(hz(rm), 1.4 * song.spb, 0.7), 0, 0.55, 0.05)
            song.add(bar * 4, kick(0.8), 0, 0.6, 0.05)
            song.add(bar * 4 + 2.5, kick(0.55), 0, 0.5, 0.05)
            song.add(bar * 4 + 1, brush(0.7), 0.1, 0.5, 0.2)
            song.add(bar * 4 + 3, brush(0.75), 0.1, 0.5, 0.2)
            for s16 in range(16):
                song.add(bar * 4 + s16 * 0.25, shaker(0.5 + 0.3 * (s16 % 4 == 2)), -0.4, 0.35, 0.1)
            if rep == 1:
                toks = lead[bi].split()
                i = 0
                while i < 8:
                    tk = toks[i]
                    if tk in (".", "~"):
                        i += 1
                        continue
                    ln = 1
                    while i + ln < 8 and toks[i + ln] == "~":
                        ln += 1
                    song.add(bar * 4 + i * 0.5, bell(hz(tk) * 2, 1.0, 0.5, tau=0.8), 0.0, 0.32, 0.35)
                    song.add(bar * 4 + i * 0.5, ep(hz(tk), ln * 0.5 * song.spb, 0.3), 0.0, 0.3, 0.3)
                    i += ln
    return song.render(2.0, 1.4, 6000, loop=True, warm=True)


def night():
    """Eerie night loop: dissonant khaen-like drone, sparse detuned ranat notes, ghostly bells, sub swells."""
    song = Song(60, 40, tail=6.0)
    rng = np.random.default_rng(13)
    song.add(0, khaen([hz("A2"), hz("E3"), hz("Bb3")], 40 - 0.3, 0.35), 0, 0.6, 0.5)
    song.add(0, pad(hz("A1"), 40 - 1.5, 0.5, bright=400, att=4.0), 0, 0.5, 0.4)
    scale = ["A4", "Bb4", "D5", "E5", "F5", "A5", "Bb5"]
    t = 1.0
    while t < 38:
        nn = scale[rng.integers(0, len(scale))]
        f = hz(nn) * rng.uniform(0.985, 1.0)
        song.add(t, ranat(f, 1.2, 0.5), rng.uniform(-0.7, 0.7), 0.35, 0.8)
        if rng.random() < 0.35:
            song.add(t + 0.75, ranat(f * 0.5, 1.2, 0.35), rng.uniform(-0.7, 0.7), 0.3, 0.8)
        t += rng.uniform(1.6, 3.8)
    for t0 in (6.0, 21.0, 33.0):
        for k in range(3):
            song.add(t0 + k * 0.37, bell(hz(scale[rng.integers(0, 7)]) * 2 * rng.uniform(0.97, 1.0), 2.0, 0.25, 2.5),
                     rng.uniform(-1, 1), 0.3, 0.9)
    return song.render(4.5, 4.0, 3500, loop=True)


def slowmo():
    """Comedic over-dramatic slow-motion: choir 'aah', strings, timpani, cymbal swells (Am F C G Am F Dm E)."""
    song = Song(60, 32, tail=5.0)
    prog = [("A2", [0, 3, 7]), ("F2", [0, 4, 7]), ("C3", [0, 4, 7]), ("G2", [0, 4, 7]),
            ("A2", [0, 3, 7]), ("F2", [0, 4, 7]), ("D3", [0, 3, 7]), ("E3", [0, 4, 7])]
    for bi, (root, ch) in enumerate(prog):
        rm = m(root)
        b = bi * 4
        for iv in ch:
            song.add(b, choir(hz(rm + 12 + iv), 4 * song.spb - 0.2, 0.6), -0.3 + 0.3 * (iv / 7), 0.5, 0.45)
            song.add(b, strings(hz(rm + 24 + iv), 4 * song.spb - 0.2, 0.5), 0.3, 0.45, 0.35)
        song.add(b, strings(hz(rm), 4 * song.spb - 0.2, 0.6), 0, 0.5, 0.3)
        song.add(b, timp(hz(rm - 12 if rm > 45 else rm), 0.9), 0, 0.6, 0.3)
        if bi in (3, 7):
            song.add(b + 2, cymbal_swell(2 * song.spb, 0.8), 0, 0.6, 0.5)
            for k in range(8):
                song.add(b + 2 + k * 0.25, timp(hz(rm), 0.25 + 0.06 * k), 0, 0.5, 0.3)
    # melody: slow soaring line in strings octave
    mel = [("E5", 4), ("F5", 4), ("G5", 3), ("D5", 1), ("C5", 2), ("E5", 2), ("A5", 4), ("F5", 2), ("D5", 2), ("B4", 4)]
    t = 0
    for nn, ln in mel:
        song.add(t, strings(hz(nn), ln * song.spb - 0.1, 0.55), 0.1, 0.45, 0.4)
        t += ln
    return song.render(3.5, 3.0, 5000, loop=True)


def skill_tree():
    """Dreamy harp arpeggios + celesta + warm pads (Fmaj9 Em7 Dm9 Cmaj9 / Bbmaj7 Am7 Gm9 Csus)."""
    song = Song(72, 32, tail=5.0)
    prog = [("F2", [0, 4, 7, 11, 14]), ("E2", [0, 3, 7, 10, 14]), ("D2", [0, 3, 7, 10, 14]), ("C2", [0, 4, 7, 11, 14]),
            ("Bb1", [0, 4, 7, 11, 14]), ("A1", [0, 3, 7, 10, 14]), ("G1", [0, 3, 7, 10, 14]), ("C2", [0, 5, 7, 10, 14])]
    rng = np.random.default_rng(21)
    for bi, (root, ch) in enumerate(prog):
        rm = m(root)
        b = bi * 4
        for iv in ch[:4]:
            song.add(b, pad(hz(rm + 24 + iv), 4 * song.spb - 0.3, 0.45, bright=1500, att=1.0), rng.uniform(-0.5, 0.5), 0.4, 0.5)
        song.add(b, bass(hz(rm + 12), 3.5 * song.spb, 0.5), 0, 0.45, 0.2)
        notes = [rm + 24 + iv for iv in ch] + [rm + 36 + iv for iv in ch[:3]]
        for j in range(16):
            nn = notes[j % len(notes)] if (j // len(notes)) % 2 == 0 else notes[-1 - (j % len(notes))]
            song.add(b + j * 0.25, harp(hz(nn), 1.5, 0.35 + 0.1 * (j % 4 == 0)), 0.4 * np.sin(j), 0.45, 0.5)
        if bi % 2 == 0:
            for k, nn in enumerate([ch[4], ch[2], ch[3]]):
                song.add(b + 1 + k * 1.0, bell(hz(rm + 48 + nn), 2.0, 0.4, 2.2), 0.2, 0.35, 0.6)
    return song.render(4.0, 3.2, 7000, loop=True)


def bargaining():
    """Tense haggling loop (A minor, 128 bpm): pizzicato ostinato, ticking hats, pulse bass, ranat stabs."""
    song = Song(128, 32, tail=3.0)
    ost = ["A3", "C4", "E4", "A3", "D4", "C4", "E4", "C4"]
    for bar in range(8):
        b = bar * 4
        alt = bar % 4 == 3
        for j in range(8):
            nn = ost[j] if not alt else ["G3", "B3", "E4", "G3", "D4", "B3", "E4", "B3"][j]
            song.add(b + j * 0.5, pizz(hz(nn), 0.3, 0.7 + 0.2 * (j % 2 == 0)), -0.3, 0.55, 0.15)
        for q in range(4):
            song.add(b + q, bass(hz("A1" if not alt else "E1"), 0.4 * song.spb, 0.8), 0, 0.55, 0.05)
            song.add(b + q, kick(0.5), 0, 0.4, 0.05)
        for s in range(8):
            song.add(b + s * 0.5 + 0.25, shaker(0.9), 0.4, 0.25, 0.05)
        if bar % 2 == 1:
            for k, nn in enumerate(["E5", "F5", "E5"]):
                song.add(b + 2 + k * 0.5, ranat(hz(nn), 0.3, 0.7), 0.3, 0.4, 0.2)
                song.add(b + 2 + k * 0.5, ranat(hz(nn) * 2, 0.3, 0.4), 0.3, 0.3, 0.2)
        song.add(b, strings(hz("A2" if not alt else "E2"), 4 * song.spb - 0.1, 0.35), 0.0, 0.35, 0.3)
    return song.render(1.6, 1.2, 6000, loop=True, lp=10000)


def lullaby():
    """Sleep lullaby: slow khim melody (pentatonic) over a soft pad, music-box sparkles."""
    song = Song(66, 32, tail=5.0)
    mel = ["3 . 5 . 6 ~ 5 .", "3 . 2 . 1 ~ ~ .", "2 . 3 . 5 ~ 3 .", "2 ~ ~ ~ . . . .",
           "3 . 5 . 6 ~ 1+ .", "6 . 5 . 3 ~ ~ .", "2 . 3 . 2 ~ 1 .", "1 ~ ~ ~ . . . ."]
    roots = ["C3", "A2", "F2", "G2", "C3", "A2", "F2", "C3"]
    for bar, line in enumerate(mel):
        toks = line.split()
        i = 0
        while i < 8:
            tk = toks[i]
            if tk in (".", "~"):
                i += 1
                continue
            ln = 1
            while i + ln < 8 and toks[i + ln] == "~":
                ln += 1
            mid = deg(tk, "C", 5)
            song.add(bar * 4 + i * 0.5, khim(hz(mid), 2.0, 0.5), -0.1, 0.5, 0.45)
            song.add(bar * 4 + i * 0.5 + 0.02, bell(hz(mid + 12), 1.5, 0.15, 1.2), 0.3, 0.3, 0.5)
            i += ln
        rm = m(roots[bar])
        for iv in (0, 7, 16):
            song.add(bar * 4, pad(hz(rm + 12 + iv), 4 * song.spb - 0.3, 0.35, bright=900, att=1.5), 0, 0.4, 0.5)
        song.add(bar * 4, bass(hz(rm), 3.6 * song.spb, 0.35), 0, 0.35, 0.2)
    return song.render(4.0, 3.5, 5000, loop=True, lp=7000)


def shop_jingle():
    song = Song(140, 6, tail=2.5)
    run = ["C5", "D5", "E5", "G5", "A5", "C6"]
    for k, nn in enumerate(run):
        song.add(k * 0.25, ranat(hz(nn), 0.3, 0.8), -0.1, 0.55, 0.25)
        song.add(k * 0.25 + 0.01, ranat(hz(nn) * 2, 0.3, 0.5), 0.15, 0.35, 0.25)
    for nn in ("C5", "E5", "G5", "C6"):
        song.add(1.75, khim(hz(nn), 1.5, 0.6), 0.2, 0.45, 0.35)
        song.add(1.75, bell(hz(nn) * 2, 1.5, 0.3, 1.0), -0.2, 0.3, 0.4)
    song.add(1.75, ching(True, 1.0), 0.4, 0.7, 0.3)
    song.add(1.75, thon("tum", 0.9), -0.3, 0.6, 0.2)
    return song.render(1.8, 1.2, 7000, loop=False)


def day_end_jingle():
    song = Song(96, 10, tail=3.0)
    song.add(0, khaen([hz("C4"), hz("G4"), hz("C5"), hz("E5")], 4.2, 0.6), -0.2, 0.55, 0.35)
    phr = [("G5", 0.5), ("A5", 0.5), ("G5", 0.5), ("E5", 0.5), ("D5", 1.0), ("E5", 0.5), ("D5", 0.5), ("C5", 2.0)]
    t = 0.5
    for nn, ln in phr:
        song.add(t, ranat(hz(nn), ln * song.spb, 0.8), -0.1, 0.55, 0.3)
        song.add(t + 0.01, ranat(hz(nn) * 2, ln * song.spb, 0.5), 0.15, 0.35, 0.3)
        t += ln
    for b in (0.5, 2.5, 4.5):
        song.add(b, ching(True, 0.8), 0.4, 0.5, 0.3)
    song.add(t, khim(hz("C4"), 2.0, 0.6), 0.2, 0.5, 0.4)
    song.add(t, thon("tum", 0.9), -0.3, 0.6, 0.3)
    return song.render(2.5, 2.0, 6000, loop=False)


PIECES = {"day_gameplay": day_gameplay, "main_menu": main_menu, "night": night, "slowmo": slowmo,
          "skill_tree": skill_tree, "bargaining": bargaining, "lullaby": lullaby, "shop_jingle": shop_jingle,
          "day_end_jingle": day_end_jingle}


def path(name):
    return os.path.join(OUTD, f"music_{name}.wav")


if __name__ == "__main__":
    names = sys.argv[1:] or list(PIECES)
    for nm in names:
        y = PIECES[nm]()
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
        A.write_wav(y, path(nm))
        print(nm, round(len(y) / SR, 2), "s", flush=True)
