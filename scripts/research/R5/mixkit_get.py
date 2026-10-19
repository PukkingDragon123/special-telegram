#!/usr/bin/env python3
"""Download Mixkit SFX WAVs by id into scripts/_cache/audio_dl/mixkit/wav/<id>.wav (polite)."""
import os, subprocess, sys, time

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = "/home/user/special-telegram/scripts/_cache/audio_dl/mixkit/wav"
os.makedirs(OUT, exist_ok=True)
ids = []
for a in sys.argv[1:]:
    ids += [x for x in a.replace(",", " ").split() if x.strip()]
for i in ids:
    dest = os.path.join(OUT, f"{i}.wav")
    if os.path.exists(dest) and os.path.getsize(dest) > 2000:
        continue
    url = f"https://assets.mixkit.co/active_storage/sfx/{i}/{i}.wav"
    r = subprocess.run(["curl", "-sS", "-A", UA, "-o", dest, "-w", "%{http_code}", url], capture_output=True, text=True)
    code = r.stdout.strip()
    if code != "200":
        # fall back to the preview mp3
        os.remove(dest) if os.path.exists(dest) else None
        dest2 = os.path.join(OUT, f"{i}.mp3")
        r = subprocess.run(["curl", "-sS", "-A", UA, "-o", dest2, "-w", "%{http_code}",
                            f"https://assets.mixkit.co/active_storage/sfx/{i}/{i}-preview.mp3"], capture_output=True, text=True)
        code = "mp3:" + r.stdout.strip()
    print(i, code, flush=True)
    time.sleep(0.6)
