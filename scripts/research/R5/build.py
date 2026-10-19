#!/usr/bin/env python3
"""R5-audio build pipeline: recipes -> trimmed/looped/normalized MP3s + manifest.json + credits.

python3 -I build.py [--only k1,k2] [--folder sfx/cooking] [--manifest-only]
State of every built file (analysis + credits) is kept in scripts/_cache/audio_work/build_state.json so
partial rebuilds still produce a complete manifest/credits file.
"""
import json, os, sys, time, traceback
sys.path.insert(0, "/home/user/special-telegram/scripts/research/R5")
import numpy as np
import audiolib as A
import credits_db

STATE = os.path.join(A.WORK, "build_state.json")
TARGET = {"sfx": -16.0, "meme": -16.0, "voice": -16.0, "amb": -24.0, "music": -20.0}
KBPS = {"sfx": 112, "meme": 112, "voice": 112, "amb": 128, "music": 128}


class Entry:
    def __init__(self, key, folder, cat, desc, variants, vol=0.7, loop=False, pitchVar=0.05, lufs=None,
                 stereo=None, kbps=None):
        self.key, self.folder, self.cat, self.desc = key, folder, cat, desc
        self.variants, self.vol, self.loop, self.pitchVar = variants, vol, loop, pitchVar
        self.lufs = lufs
        self.stereo = stereo if stereo is not None else (cat in ("amb", "music"))
        self.kbps = kbps


def V(src, ss=None, t=None, af=None, rate=None, gain_db=0.0, fin=0.003, fout=0.03, trim=True,
      thr=-45.0, tail=-55.0, xfade=1.0, loop_len=None, lufs=None, post_af=None, maxlen=None):
    return dict(src=src, ss=ss, t=t, af=af, rate=rate, gain_db=gain_db, fin=fin, fout=fout, trim=trim, thr=thr,
                tail=tail, xfade=xfade, loop_len=loop_len, lufs=lufs, post_af=post_af, maxlen=maxlen)


def load_src(v, ch):
    src = v["src"]
    if callable(src):
        x, used = src()
        if ch == 2 and x.ndim == 1:
            x = A.stereo(x)
        if ch == 1 and x.ndim == 2:
            x = A.mono(x)
        if v["ss"] is not None or v["t"] is not None:
            s = int((v["ss"] or 0) * A.SR)
            e = s + int(v["t"] * A.SR) if v["t"] else len(x)
            x = x[s:e]
        if v["af"]:
            x = A.ffilter(x, v["af"])
        return x, used
    x = A.decode(src, ch=ch, af=v["af"], ss=v["ss"], t=v["t"])
    return x, [src]


def process(e, v):
    ch = 2 if e.stereo else 1
    x, used = load_src(v, ch)
    if v["rate"]:
        x = A.resample_ratio(x, v["rate"])
    if v["post_af"]:
        x = A.ffilter(x, v["post_af"])
    if v["gain_db"]:
        x = x * 10 ** (v["gain_db"] / 20)
    x = A.hp(x, 25 if e.cat in ("amb", "music") else 35, 2)  # DC / sub-sonic cleanup
    if e.loop:
        x = A.make_loop(x, v["xfade"], length=v["loop_len"])
    else:
        if v["trim"]:
            x = A.trim(x, v["thr"], v["tail"])
        if v["maxlen"] and len(x) > v["maxlen"] * A.SR:
            x = x[: int(v["maxlen"] * A.SR)]
            v = dict(v, fout=max(v["fout"], 0.08))
        x = A.fade(x, v["fin"], v["fout"])
    target = v["lufs"] if v["lufs"] is not None else (e.lufs if e.lufs is not None else TARGET[e.cat])
    x = A.normalize(x, target, tp=-1.0)
    if e.loop:
        # keep loop seam continuous: no fades, but make sure the ends are tiny-matched
        pass
    return x, used


def build(entries, only=None, folder=None):
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    for e in entries:
        if only and e.key not in only:
            continue
        if folder and e.folder != folder:
            continue
        files, infos = [], []
        n = len(e.variants)
        for i, v in enumerate(e.variants):
            name = f"{e.key}.mp3" if n == 1 else f"{e.key}_{i + 1}.mp3"
            rel = f"{e.folder}/{name}"
            out = os.path.join(A.OUT, rel)
            try:
                t0 = time.time()
                x, used = process(e, v)
                kb = e.kbps or KBPS[e.cat]
                if x.ndim == 1 and kb > 112 and e.cat not in ("amb", "music"):
                    kb = 112
                A.encode_mp3(x, out, kbps=kb)
                info = A.analyse(x)
                info["file"] = rel
                info["credits"] = [credits_db.credit(u) for u in used]
                infos.append(info)
                files.append(rel)
                print(f"OK {rel:55s} {info['dur']:6.2f}s lufs={info['lufs']:6.1f} tp={info['tp_db']:5.1f} "
                      f"cen={info['centroid']:5d} ({time.time() - t0:.1f}s)", flush=True)
            except Exception as ex:
                print(f"FAIL {rel}: {ex}", flush=True)
                traceback.print_exc()
        if files:
            # remove stale variant files for this key
            d = os.path.join(A.OUT, e.folder)
            for fn in os.listdir(d):
                if (fn == f"{e.key}.mp3" or (fn.startswith(e.key + "_") and fn[len(e.key) + 1:-4].isdigit())) \
                        and f"{e.folder}/{fn}" not in files:
                    os.remove(os.path.join(d, fn))
            state[e.key] = dict(files=files, vol=e.vol, loop=e.loop, cat=e.cat, pitchVar=e.pitchVar, desc=e.desc,
                                folder=e.folder, infos=infos)
    json.dump(state, open(STATE, "w"), indent=1, ensure_ascii=False)
    return state


def write_manifest(state, order):
    man = {}
    for k in order:
        if k not in state:
            continue
        s = state[k]
        man[k] = {"files": s["files"], "vol": round(float(s["vol"]), 2), "loop": bool(s["loop"]), "cat": s["cat"],
                  "pitchVar": round(float(s["pitchVar"]), 3), "desc": s["desc"]}
    for k in state:  # anything built but not in order
        if k not in man:
            s = state[k]
            man[k] = {"files": s["files"], "vol": round(float(s["vol"]), 2), "loop": bool(s["loop"]),
                      "cat": s["cat"], "pitchVar": round(float(s["pitchVar"]), 3), "desc": s["desc"]}
    json.dump(man, open(os.path.join(A.OUT, "manifest.json"), "w"), indent=1, ensure_ascii=False)
    return man


def write_credits(state, order):
    lines = ["# R5-audio — credits for shipped audio", "",
             "Every file under `public/assets/audio/` with its source, author and licence.",
             "Synthesized / designed sounds are original work of this project (CC0). Composite files list every",
             "source that was layered into them. Mixkit items are used under the Mixkit Sound Effects Free License",
             "(free for commercial use inside a project; not redistributable as standalone sound files).", "",
             "| shipped path | source | source URL | author | licence |", "|---|---|---|---|---|"]
    keys = [k for k in order if k in state] + [k for k in state if k not in order]
    for k in keys:
        for info in state[k]["infos"]:
            seen = set()
            for c in info["credits"]:
                sig = (c["source"], c["url"])
                if sig in seen:
                    continue
                seen.add(sig)
                lines.append(f"| {info['file']} | {c['source']} | {c['url']} | {c['author']} | {c['licence']} |")
    p = os.path.join(credits_db.ROOT, "references/credits/R5-audio.md")
    open(p, "w").write("\n".join(lines) + "\n")


def main():
    import recipes
    args = sys.argv[1:]
    only = folder = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    if "--folder" in args:
        folder = args[args.index("--folder") + 1]
    entries = recipes.ENTRIES
    order = [e.key for e in entries]
    if "--manifest-only" in args:
        state = json.load(open(STATE))
    else:
        state = build(entries, only, folder)
    # drop state for keys no longer in recipes
    state = {k: v for k, v in state.items() if k in order}
    json.dump(state, open(STATE, "w"), indent=1, ensure_ascii=False)
    write_manifest(state, order)
    write_credits(state, order)
    tot = sum(os.path.getsize(os.path.join(A.OUT, f)) for s in state.values() for f in s["files"]
              if os.path.exists(os.path.join(A.OUT, f)))
    print(f"manifest: {len(state)} keys, {sum(len(s['files']) for s in state.values())} files, {tot / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
