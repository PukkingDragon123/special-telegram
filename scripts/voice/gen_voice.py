"""
Offline Thai voice lines for เฮียผัด! — Meta MMS-TTS Thai (facebook/mms-tts-tha, CC-BY-NC 4.0, non-commercial).
Input : lines.json  [{k: fnv1a(text), t: text, s: speakable text, g: priority group}]
Output: public/assets/audio/voice/<k>.mp3 (16 kHz mono 32 kbps) + manifest.json {k: [file, seconds]}
One neutral take per line; characters get their own pitch/rate/FX at runtime (src/core/voice.ts).
usage: python gen_voice.py lines.json OUTDIR [groups=ABC]
"""
import json, os, sys, subprocess, tempfile, time
import numpy as np, soundfile as sf, torch
from transformers import VitsModel, AutoTokenizer

lines = json.load(open(sys.argv[1], encoding='utf8'))
out = sys.argv[2]
groups = sys.argv[3] if len(sys.argv) > 3 else 'ABC'
os.makedirs(out, exist_ok=True)
manp = os.path.join(out, 'manifest.json')
man = json.load(open(manp)) if os.path.exists(manp) else {}
torch.set_num_threads(int(os.environ.get('THREADS', '3')))
torch.manual_seed(7)
m = VitsModel.from_pretrained('facebook/mms-tts-tha').eval()
m.noise_scale = 0.55; m.noise_scale_duration = 0.7; m.speaking_rate = 1.08
tok = AutoTokenizer.from_pretrained('facebook/mms-tts-tha')
SR = m.config.sampling_rate
todo = [l for g in groups for l in lines if l['g'] == g and l['k'] not in man]
print('todo', len(todo), flush=True)

def trim(w):
    a = np.abs(w); thr = max(1e-3, a.max() * 0.02)
    idx = np.where(a > thr)[0]
    if not len(idx): return w
    s = max(0, idx[0] - int(0.03 * SR)); e = min(len(w), idx[-1] + int(0.08 * SR))
    w = w[s:e]
    return w / max(1e-6, np.abs(w).max()) * 0.89

B = 8; t0 = time.time()
for i in range(0, len(todo), B):
    chunk = todo[i:i + B]
    inp = tok([c['s'] for c in chunk], return_tensors='pt', padding=True)
    with torch.inference_mode():
        o = m(**inp)
    for c, w, n in zip(chunk, o.waveform, o.sequence_lengths):
        w = trim(w[: int(n)].numpy())
        with tempfile.NamedTemporaryFile(suffix='.wav') as f:
            sf.write(f.name, w, SR)
            fn = c['k'] + '.mp3'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f.name, '-ac', '1', '-ar', str(SR), '-b:a', '32k', os.path.join(out, fn)], check=True)
        man[c['k']] = [fn, round(len(w) / SR, 2)]
    json.dump(man, open(manp, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'{i + len(chunk)}/{len(todo)} {time.time() - t0:.0f}s', flush=True)
print('done', len(man))
