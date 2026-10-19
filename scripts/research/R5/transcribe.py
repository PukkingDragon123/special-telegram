#!/usr/bin/env python3
"""R5-audio: transcribe (Thai) lesson audio with faster-whisper, word timestamps -> JSON.

python3 -I transcribe.py <model> <out.json> file1.mp3 file2.mp3 ...
Model weights are cached in scripts/_cache/hf (HF_HOME).
"""
import json, os, sys, time
os.environ.setdefault("HF_HOME", "/home/user/special-telegram/scripts/_cache/hf")
from faster_whisper import WhisperModel

model_name, out = sys.argv[1], sys.argv[2]
files = sys.argv[3:]
model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=3)
res = json.load(open(out)) if os.path.exists(out) else {}
for f in files:
    k = os.path.basename(f)
    if k in res:
        continue
    t0 = time.time()
    # language=None lets whisper switch; we force Thai because we want Thai words.
    import subprocess, numpy as np
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True).stdout
    audio = np.frombuffer(pcm, dtype=np.float32).copy()
    segs, info = model.transcribe(audio, language="th", word_timestamps=True, vad_filter=False,
                                  beam_size=5, condition_on_previous_text=False)
    out_segs = []
    for s in segs:
        out_segs.append({"start": s.start, "end": s.end, "text": s.text,
                         "words": [{"s": w.start, "e": w.end, "w": w.word, "p": round(w.probability, 3)}
                                   for w in (s.words or [])]})
    res[k] = out_segs
    json.dump(res, open(out, "w"), ensure_ascii=False, indent=0)
    print(k, "done in", round(time.time() - t0), "s", len(out_segs), "segments", flush=True)
