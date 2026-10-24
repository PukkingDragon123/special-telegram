#!/usr/bin/env python3
"""QA: transcribe shipped voice clips with Whisper (auto language) to confirm they contain the intended Thai words.
python3 -I verify_voice.py <files...>"""
import os, subprocess, sys
os.environ.setdefault("HF_HOME", "/home/user/special-telegram/scripts/_cache/hf")
import numpy as np
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("WMODEL", "medium"), device="cpu", compute_type="int8", cpu_threads=2)
for f in sys.argv[1:]:
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True).stdout
    a = np.frombuffer(pcm, dtype=np.float32).copy()
    a = np.concatenate([np.zeros(8000, np.float32), a, np.zeros(8000, np.float32)])
    segs, info = model.transcribe(a, language=None, beam_size=5, condition_on_previous_text=False)
    txt = " ".join(s.text.strip() for s in segs)
    txt_th = ""
    if os.environ.get("BOTH"):
        segs_th, _ = model.transcribe(a, language="th", beam_size=5, condition_on_previous_text=False)
        txt_th = " ".join(s.text.strip() for s in segs_th)
    print(f"{os.path.basename(f):28s} lang={info.language}({info.language_probability:.2f}) auto='{txt}' th='{txt_th}'",
          flush=True)
