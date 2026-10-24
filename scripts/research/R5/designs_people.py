"""R5-audio people / voice / ghost designs built mostly from the public-domain Peace Corps Thai lessons."""
import functools, os, pickle, subprocess
import numpy as np
from scipy import signal
import audiolib as A
import synth as S
import pc_extract as PX
from designs import L, mk, kn, og, SY, mixdown, env_points, rngs, SR

PC_FILES = [PX.lesson_path(n) for n in (3, 4, 9, 10, 13, 5, 7)]
CACHE = os.path.join(A.WORK, "pc_pool.pkl")


def _lessons_available():
    t = PX.transcripts()
    return [n for n in (3, 4, 9, 10, 13, 5, 7) if f"TH_Thai_Lesson_{n}.mp3" in t]


@functools.lru_cache(maxsize=1)
def pc_pool():
    """All Thai speech islands (0.3-2.6 s) from the transcribed lessons: list of (array, lesson, text)."""
    avail = _lessons_available()
    if os.path.exists(CACHE):
        d = pickle.load(open(CACHE, "rb"))
        if d.get("lessons") == avail:
            return d["pool"]
    pool = []
    for n in avail:
        x = PX.lesson_audio(n)
        for (s, e, txt) in PX.thai_segments(n):
            a, b = max(0, int((s - 0.2) * SR)), min(len(x), int((e + 0.3) * SR))
            for (i0, i1, en) in PX.islands(x, a, b, -30, 0.2):
                d = (i1 - i0) / SR
                if 0.3 <= d <= 2.6:
                    y = x[max(0, i0 - int(0.03 * SR)): i1 + int(0.06 * SR)]
                    y = A.fade(A.hp(y, 90, 2), 0.01, 0.05)
                    pool.append((y.astype(np.float32), n, txt))
    pickle.dump({"lessons": avail, "pool": pool}, open(CACHE, "wb"))
    return pool


def pc_used():
    return [PX.lesson_path(n) for n in _lessons_available()]


@functools.lru_cache(maxsize=1)
def syllable_pool():
    """Short single Thai words (one syllable) from word timestamps -> list of arrays."""
    out = []
    for n in _lessons_available():
        x = PX.lesson_audio(n)
        for (s, e, w) in PX.words(n):
            if not PX.THAI.search(w) or len(w) > 4 or (e - s) > 0.6:
                continue
            a, b = max(0, int((s - 0.12) * SR)), min(len(x), int((e + 0.2) * SR))
            isl = PX.islands(x, a, b, -28, 0.06, 0.06)
            if not isl:
                continue
            i0, i1, en = max(isl, key=lambda it: it[2])
            if 0.09 <= (i1 - i0) / SR <= 0.5:
                out.append((x[max(0, i0 - int(0.012 * SR)): i1].astype(np.float64), w))
    return out


# ------------------------------------------------------------------ people
def crowd_chatter(dur=32.0, seed=31, density=2.2, bed_gain=0.7, lp=None):
    """Thai-sounding crowd chatter: generic restaurant crowd bed + many Thai phrases (Peace Corps PD
    recordings) re-pitched into different 'people', scattered in a room."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    bed = L(mk(444), 20.0, dur, ch=2)
    S.place(out, bed[:n] * bed_gain, 0)
    pool = pc_pool()
    ir = S.make_ir(1.4, 1.0, 5000, stereo=True, seed_=seed)
    t = 0.0
    while t < dur - 0.5:
        y, _, _ = pool[r.integers(0, len(pool))]
        y = A.resample_ratio(y.astype(np.float64), r.uniform(0.86, 1.16))
        y = S.butter(y, "lowpass", r.uniform(2500, 7000), 2)
        g = r.uniform(0.04, 0.16)
        S.place(out, S.reverb(S.pan(y, r.uniform(-0.9, 0.9)) * g, ir, wet=0.35)[: n], t)
        t += r.exponential(1.0 / density)
    if lp:
        out = S.butter(out, "lowpass", lp, 2)
    return out, [mk(444)] + pc_used() + [SY("thai_chatter_mix")]


def babble(i):
    """Speech blip i (0..11): a real Thai syllable, sped up like Animal Crossing speech."""
    pool = syllable_pool()
    # pick 12 distinct syllables spread across the pool (deterministic)
    pool = sorted(pool, key=lambda p: (len(p[0]), p[1]))
    idx = np.linspace(0, len(pool) - 1, 12).astype(int)
    x, w = pool[idx[i]]
    rate = [1.32, 1.4, 1.28, 1.45, 1.35, 1.3, 1.42, 1.38, 1.26, 1.48, 1.33, 1.4][i]
    y = A.resample_ratio(x, rate)
    y = y[: int(0.16 * SR)]
    y = A.fade(A.hp(y, 120, 2), 0.004, 0.035)
    return y, pc_used()


def angry_grumble(i=0):
    """Angry muttering gibberish: male Thai phrases reversed + pitched down + gritty, ending in a 'hmph'."""
    r = rngs(70 + i)
    pool = pc_pool()
    cand = [p for p in pool if 0.7 < len(p[0]) / SR < 1.8]
    a = cand[(i * 7 + 3) % len(cand)][0].astype(np.float64)
    b = cand[(i * 11 + 5) % len(cand)][0].astype(np.float64)
    ra = A.fade(A.trim(a[::-1], -35, -45), 0.01, 0.06)
    rb = A.fade(A.trim(b[::-1], -35, -45)[: int(0.55 * SR)], 0.01, 0.12)
    seq = np.concatenate([ra, np.zeros(int(0.06 * SR)), rb])
    seq = A.resample_ratio(seq, 0.86 if i == 0 else 0.8)
    seq = A.ffilter(seq, "atempo=1.25")
    seq = S.peaking(seq, 350, 4, 0.8)
    seq = S.softclip(seq / (np.max(np.abs(seq)) + 1e-9) * 1.8, 1.4)
    seq = A.fade(seq, 0.01, 0.12)
    return seq, pc_used()


# ------------------------------------------------------------------ ghost / night
def whisperize(x, smooth=10):
    """Noise-excited resynthesis from the spectral envelope (turns voiced speech into a whisper)."""
    f, t, Z = signal.stft(x, SR, nperseg=1024, noverlap=768)
    mag = np.abs(Z)
    lm = np.log(mag + 1e-9)
    k = np.ones(smooth) / smooth
    env = np.exp(np.apply_along_axis(lambda c: np.convolve(c, k, mode="same"), 0, lm))
    ph = np.exp(1j * np.random.default_rng(3).uniform(0, 2 * np.pi, Z.shape))
    _, y = signal.istft(env * ph, SR, nperseg=1024, noverlap=768)
    y = S.butter(y, "highpass", 400, 2)
    return y[: len(x)]


def ghost_whisper(i=0):
    if i == 0:
        x = PX.utt(13, "ช่วยด้วย", 0)
        w = whisperize(x)
        w2 = whisperize(A.resample_ratio(x, 0.94))
        n = len(w) + int(1.5 * SR)
        dry = mixdown(n, [(w, 0.0, 0), (w2, 0.9, -5)])
        used = [PX.lesson_path(13)]
    else:
        x = L(mk(302), 0.3, 2.6)
        dry = np.pad(x, (0, int(1.2 * SR)))
        used = [mk(302)]
    ir = S.make_ir(3.0, 2.6, 5000, stereo=False, seed_=61 + i)
    y = A.mono(S.reverb(dry, ir, wet=0.55, dry=0.8))[: len(dry)]
    return y, used


def ghost_laugh(i=0):
    if i == 0:
        x = L(og("giggle", "ghostly_cackle_laugh_1.ogg"))
        used = [og("giggle", "ghostly_cackle_laugh_1.ogg")]
    else:
        x = L(mk(426))
        x = A.resample_ratio(x, 1.08)
        used = [mk(426)]
    x = A.trim(x, -40, -50)
    # eerie: slight pitch wobble via chorus + long reverb + pre-echo
    x = S.chorus(x, depth=0.004, rate=0.6, mix=0.4)
    n = len(x) + int(2.5 * SR)
    pre = np.pad(x[::-1], (0, 0))
    ir = S.make_ir(3.5, 3.0, 6000, stereo=False, seed_=71 + i)
    wet = A.mono(S.reverb(np.pad(x, (0, n - len(x))), ir, wet=0.6, dry=1.0))[:n]
    head = x[: int(0.6 * SR)]
    r_ = A.mono(S.reverb(np.pad(head[::-1], (0, int(1.2 * SR))), ir, wet=1.0, dry=0.0))[: len(head) + int(1.2 * SR)]
    rv = A.fade(r_[::-1] * 0.35, 0.4, 0.005)  # reverse-reverb swell; laugh onset sits at len(rv) - len(head)
    onset = (len(rv) - len(head)) / SR
    out = np.zeros(int(onset * SR) + n)
    S.place(out, rv, 0)
    S.place(out, wet, onset)
    return out, used


def ghost_engine(dur=9.0):
    """Headless-rider motorcycle: scooter idle slowed, pitch-wobbled, distorted, drowned in reverb."""
    import designs_world as W
    x = L(mk(2721), 0.1, 2.5)
    x = np.tile(A.fade(x, 0.02, 0.02), 6)
    x = A.resample_ratio(x, 0.72)
    n = int(dur * SR)
    x = x[:n]
    t = np.arange(len(x)) / SR
    wob = 1 + 0.03 * np.sin(2 * np.pi * 0.35 * t)
    idx = np.cumsum(wob)
    idx = idx / idx[-1] * (len(x) - 1)
    x = np.interp(idx, np.arange(len(x)), x)
    x = S.softclip(x / (np.max(np.abs(x)) + 1e-9) * 3.0, 2.5)
    x = S.chorus(x, depth=0.006, rate=0.25, mix=0.5)
    x = S.butter(x, "lowpass", 3500, 2)
    ir = S.make_ir(4.0, 3.5, 3000, stereo=True, seed_=81)
    y = S.reverb(x, ir, wet=0.7, dry=0.6)[:n]
    wind = L(mk(1266), 3.0, dur, ch=2)[:n] * 0.15
    y[: len(wind)] += wind
    return y, [mk(2721), mk(1266)]


def eerie_drone(dur=40.0):
    import designs_world as W
    n = int(dur * SR)
    out = np.zeros((n, 2))
    d = L(mk(2749), 10.0, dur, ch=2)
    S.place(out, d[:n] * 0.9, 0)
    try:
        g = L(og("ghostloops", "x/atmosmoody/atmoseerie02.mp3.flac"), 0.0, dur, ch=2)
        S.place(out, g[:n] * 0.6, 0)
        used = [mk(2749), og("ghostloops", "x/atmosmoody/atmoseerie02.mp3.flac")]
    except Exception:
        used = [mk(2749)]
    b, _ = W.wind_bells(5, dur, eerie=True)
    S.place(out, A.stereo(b[:n]) * 0.12, 0)
    # very low sub swell
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * 41 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * t / 13.0)) * 0.05
    out += A.stereo(sub)
    return out, used + [SY("eerie_drone")]


def chain_rattle(seed=4, dur=1.6):
    """Metal chain shaken/dragged: clustered clinks of small links (modal 2-9 kHz) + scrape."""
    r = rngs(seed)
    n = int(dur * SR)
    ex = np.zeros(n)
    t = 0.02
    while t < dur - 0.2:
        k = r.integers(3, 9)
        for _ in range(k):
            i = int((t + r.uniform(0, 0.06)) * SR)
            if i < n:
                ex[i] += r.uniform(0.2, 1.0)
        t += r.uniform(0.04, 0.16)
    ex *= env_points(n, [(0, 0.6), (0.3, 1), (dur * 0.7, 0.7), (dur, 0.1)])
    y = np.zeros(n)
    for _ in range(6):
        fr = np.exp(r.uniform(np.log(2200), np.log(9000), 4))
        y += S.resonator_bank(ex * r.uniform(0.5, 1), list(fr), list(r.uniform(0.02, 0.08, 4)), [1, .7, .5, .3])
    sc = S.butter(r.standard_normal(n), "bandpass", [2000, 7000], 2) * env_points(n, [(0, 0), (0.1, 0.2), (dur, 0)])
    y = y / (np.max(np.abs(y)) + 1e-9) + 0.15 * sc
    ir = S.make_ir(1.5, 1.2, 6000, stereo=False, seed_=91)
    y = A.mono(S.reverb(y, ir, wet=0.3))[:n + int(0.5 * SR)]
    return y, [SY("chain_rattle")]


def dog_howl():
    x = L(mk(1729))
    x = A.resample_ratio(x, 1.05)
    x = S.butter(x, "lowpass", 4500, 2)
    ir = S.make_ir(3.0, 2.5, 3500, stereo=False, seed_=95)
    y = A.mono(S.reverb(np.pad(x, (0, int(2 * SR))), ir, wet=0.5, dry=0.8))
    return y, [mk(1729)]


def scare_sting(i=0):
    if i == 0:
        x = L(mk(773))
        used = [mk(773)]
    else:
        x = L(mk(2484), 0.0, 4.5)
        used = [mk(2484)]
    return x, used


# ------------------------------------------------------------------ casino
def casino_amb(dur=36.0, seed=41):
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    S.place(out, L(mk(360), 0.0, dur, ch=2)[:n] * 0.8, 0)
    S.place(out, L(mk(981), 30.0, dur, ch=2)[:n] * 0.5, 0)
    used = [mk(360), mk(981)]
    slots = [L(mk(1930)), L(mk(1932)), L(mk(1928)), L(mk(1981))]
    for t0 in np.arange(1.0, dur - 6, 3.4):
        s = slots[r.integers(0, len(slots))]
        s = S.butter(s, "lowpass", 5000, 2)
        S.place(out, S.pan(s * r.uniform(0.05, 0.12), r.uniform(-1, 1)), t0 + r.uniform(0, 1.5))
    used += [mk(1930), mk(1932), mk(1928), mk(1981)]
    for t0 in r.uniform(0.5, dur - 1, 14):
        c = L(kn("casino-audio", f"chips-collide-{r.integers(1, 5)}.ogg"))
        S.place(out, S.pan(c * r.uniform(0.05, 0.12), r.uniform(-1, 1)), t0)
    used.append(kn("casino-audio", "chips-collide-1.ogg"))
    return out, used + [SY("casino_mix")]


def slowmo_whoosh():
    x = L(mk(1486))
    x = A.resample_ratio(x, 0.55)
    y = S.butter(x, "lowpass", 5000, 2)
    sub = S.sine(S.glide(len(y), [(0, 90), (len(y) / SR, 40)]), n=len(y)) * \
        env_points(len(y), [(0, 0), (0.4 * len(y) / SR, 0.25), (len(y) / SR, 0)])
    y = y / (np.max(np.abs(y)) + 1e-9) + sub
    ir = S.make_ir(3.0, 2.5, 4000, stereo=False, seed_=97)
    y = A.mono(S.reverb(y, ir, wet=0.35))[: len(y) + int(1.0 * SR)]
    return y, [mk(1486), SY("slowmo_sub")]


# ------------------------------------------------------------------ world: tv / radio / junk buyer
def _music_bed(path, dur):
    if os.path.exists(path):
        return L(path, 0.0, dur, ch=1)
    return np.zeros(int(dur * SR))


def tv_muffled(dur=30.0, seed=51, music=None):
    """TV playing in a shophouse behind a wall: Thai soap/news voices + music bed + canned laughs, muffled."""
    r = rngs(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    pool = pc_pool()
    t = 0.3
    while t < dur - 1:
        y = pool[r.integers(0, len(pool))][0].astype(np.float64)
        y = A.resample_ratio(y, r.uniform(0.95, 1.08))
        S.place(out, y * r.uniform(0.6, 1.0), t)
        t += len(y) / SR + r.uniform(0.15, 0.6)
    mus = _music_bed(music, dur) if music else np.zeros(n)
    out = out / (np.max(np.abs(out)) + 1e-9) + 0.25 * mus[:n] / (np.max(np.abs(mus)) + 1e-9)
    for t0 in r.uniform(3, dur - 4, 3):
        lg = L(mk(422))
        S.place(out, lg * 0.3, t0)
    out = S.butter(out, "bandpass", [180, 4500], 2)       # TV speaker
    out = S.softclip(out * 1.5, 1.2)
    out = S.butter(out, "lowpass", 950, 2)                # through the wall
    ir = S.make_ir(0.8, 0.5, 2500, stereo=False, seed_=seed)
    out = A.mono(S.reverb(out, ir, wet=0.4))[:n]
    return out, pc_used() + [mk(422), SY("tv_mix")] + ([music] if music else [])


def radio_distant(dur=30.0, seed=53, music=None):
    """A neighbour's radio down the soi: Thai-flavoured song (project original) + DJ voice, AM-radio EQ, far away."""
    r = rngs(seed)
    n = int(dur * SR)
    mus = _music_bed(music, dur) if music else np.zeros(n)
    mus = mus[:n] / (np.max(np.abs(mus)) + 1e-9)
    pool = pc_pool()
    dj = np.zeros(n)
    t = dur * 0.62
    for _ in range(3):
        y = pool[r.integers(0, len(pool))][0].astype(np.float64)
        S.place(dj, y, t)
        t += len(y) / SR + 0.2
    duck = 1 - 0.6 * (A.env_rms(dj, 0.2) > 0.01)
    x = mus * duck + 0.9 * dj / (np.max(np.abs(dj)) + 1e-9)
    x = S.butter(x, "bandpass", [350, 3200], 2)
    x = S.softclip(x * 2.0, 1.6)
    x += S.butter(S.noise(n), "highpass", 4000, 2) * 0.01
    x = S.butter(x, "lowpass", 2200, 2)
    ir = S.make_ir(2.0, 1.6, 2000, stereo=False, seed_=seed)
    x = A.mono(S.reverb(x, ir, wet=0.5, dry=0.6))[:n]
    return x, ([music] if music else []) + pc_used() + [SY("radio_mix")]


def junk_buyer(dur=22.0):
    """Parody of the roving junk-buyer pickup loudspeaker: espeak-ng Thai chant through a megaphone,
    slap-back echo off shophouses, diesel pickup underneath."""
    text = ("รับซื้อ ทีวี ตู้เย็น เครื่องซักผ้า แอร์เก่า พัดลม ของเก่า เสียแล้ว ไม่ใช้แล้ว ขายได้ "
            "รับซื้อ ของเก่า ครับ")
    work = os.path.join(A.WORK, "espeak")
    os.makedirs(work, exist_ok=True)
    wav = os.path.join(work, "junk.wav")
    subprocess.run(["espeak-ng", "-v", "th", "-s", "150", "-p", "62", "-a", "180", "-w", wav, text], check=True)
    v = A.decode(wav, ch=1)
    v = A.trim(v, -40, -50)
    n = int(dur * SR)
    out = np.zeros(n)
    t = 0.4
    while t < dur - 1:
        S.place(out, v, t)
        t += len(v) / SR + 1.2
    out = S.butter(out, "bandpass", [450, 3400], 2)
    out = S.softclip(out / (np.max(np.abs(out)) + 1e-9) * 4.0, 3.0)
    out = S.peaking(out, 1800, 6, 1.2)
    echo = np.zeros(n)
    for d, g in [(0.23, 0.45), (0.51, 0.3), (0.86, 0.18)]:
        S.place(echo, out * g, d)
    out = out + S.butter(echo, "lowpass", 2500, 2)
    eng = L(mk(1621), 0.5, 9.0)
    eng = np.tile(eng, int(dur / 9) + 1)[:n]
    out = out / (np.max(np.abs(out)) + 1e-9) + 0.25 * eng / (np.max(np.abs(eng)) + 1e-9)
    return out, [os.path.join(work, "junk.wav"), mk(1621), SY("megaphone_fx")]
