"""Extract Thai utterances / words from the public-domain Peace Corps Thai lessons using the Whisper
word timestamps (scripts/_cache/audio_work/asr/peacecorps_medium.json) + energy-based boundary refinement."""
import functools, json, os, re
import numpy as np
import audiolib as A

SR = A.SR
PC = os.path.join(A.DL, "archive_peacecorps_thai")
ASR = os.path.join(A.WORK, "asr/peacecorps_medium.json")
THAI = re.compile(r"[฀-๿]")


@functools.lru_cache(maxsize=1)
def transcripts():
    return json.load(open(ASR))


def lesson_path(n):
    return os.path.join(PC, f"TH_Thai_Lesson_{n}.mp3")


@functools.lru_cache(maxsize=16)
def lesson_audio(n):
    return A.decode(lesson_path(n), ch=1)


def words(n):
    segs = transcripts()[f"TH_Thai_Lesson_{n}.mp3"]
    out = []
    for s in segs:
        for w in s.get("words", []):
            out.append((w["s"], w["e"], w["w"].strip()))
    return out


def find(n, pattern, occurrence=0, after=0.0, before=1e9):
    """Locate a Thai pattern in lesson n's word stream; returns (start, end) seconds."""
    ws = [w for w in words(n) if after <= w[0] <= before]
    text, idx = "", []
    for i, (s, e, w) in enumerate(ws):
        for ch in w:
            text += ch
            idx.append(i)
    hits = [m.start() for m in re.finditer(re.escape(pattern), text)]
    if len(hits) <= occurrence:
        raise KeyError(f"lesson {n}: '{pattern}' found {len(hits)}x")
    a = hits[occurrence]
    b = a + len(pattern) - 1
    return ws[idx[a]][0], ws[idx[b]][1]


def islands(x, a, b, thr_db=-30.0, merge_gap=0.2, min_len=0.08):
    """Speech islands (sample ranges, absolute) inside x[a:b]."""
    seg = x[a:b]
    env = A.env_rms(seg, 0.02)
    pk = env.max() + 1e-12
    on = env > pk * 10 ** (thr_db / 20)
    regs = []
    i = 0
    n = len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            regs.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for r_ in regs:
        if merged and r_[0] - merged[-1][1] < merge_gap * SR:
            merged[-1][1] = r_[1]
        else:
            merged.append(r_)
    out = []
    for i0, i1 in merged:
        if i1 - i0 >= min_len * SR:
            en = float((seg[i0:i1] ** 2).sum())
            out.append((a + i0, a + i1, en))
    return out


def refine(x, s, e, pre=0.25, post=0.35, thr_db=-30.0, pad_a=0.035, pad_b=0.08, island=None, merge_gap=0.2):
    a = max(0, int((s - pre) * SR))
    b = min(len(x), int((e + post) * SR))
    isl = islands(x, a, b, thr_db, merge_gap)
    if not isl:
        return x[a:b]
    if island is None:
        ws, we = int(s * SR), int(e * SR)
        def score(it):
            ov = max(0, min(it[1], we) - max(it[0], ws))
            return (ov, it[2])
        pick = max(isl, key=score)
    else:
        pick = isl[min(island, len(isl) - 1)]
    i0 = max(0, pick[0] - int(pad_a * SR))
    i1 = min(len(x), pick[1] + int(pad_b * SR))
    return x[i0:i1]


def utt(n, pattern, occurrence=0, after=0.0, before=1e9, **kw):
    s, e = find(n, pattern, occurrence, after, before)
    x = lesson_audio(n)
    y = refine(x, s, e, **kw)
    y = A.hp(y, 80, 2)
    y = A.fade(y, 0.01, 0.05)
    return y


def seg(n, s, e, **kw):
    """Raw time window (seconds) refined by energy."""
    x = lesson_audio(n)
    y = refine(x, s, e, **kw)
    y = A.hp(y, 80, 2)
    return A.fade(y, 0.01, 0.05)


def thai_segments(n):
    """All transcript segments that contain Thai text: list of (start, end, text)."""
    segs = transcripts().get(f"TH_Thai_Lesson_{n}.mp3", [])
    return [(s["start"], s["end"], s["text"]) for s in segs if THAI.search(s["text"])]
