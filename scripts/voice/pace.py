"""
Slow the generated voice takes down to a natural speaking pace (MMS-TTS reads quickly and the runtime per-character
rate made it worse). High-quality, formant-preserving time-stretch (ffmpeg + librubberband), pitch unchanged.
Idempotent: the applied tempo is recorded in scripts/voice/paced.json, so a re-run only stretches by the difference.
usage: python3 scripts/voice/pace.py [TEMPO=0.8] [VOICE_DIR=public/assets/audio/voice]
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

tempo = float(sys.argv[1]) if len(sys.argv) > 1 else 0.8
vdir = sys.argv[2] if len(sys.argv) > 2 else 'public/assets/audio/voice'
here = os.path.dirname(os.path.abspath(__file__))
statep = os.path.join(here, 'paced.json')
state = json.load(open(statep)) if os.path.exists(statep) else {}
manp = os.path.join(vdir, 'manifest.json')
man = json.load(open(manp))
AF = 'rubberband=tempo={t}:transients=smooth:detector=soft:window=long:smoothing=on:formant=preserved:pitchq=quality'

def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)

def job(k):
    f, _ = man[k]
    done = state.get(f, 1.0)
    t = tempo / done
    p = os.path.join(vdir, f)
    if abs(t - 1) > 1e-3:
        tmp = p + '.tmp.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-af', AF.format(t=round(t, 4)), '-ar', '16000', '-ac', '1', '-b:a', '32k', tmp], check=True)
        os.replace(tmp, p)
    return k, f, round(dur(p), 3)

with ThreadPoolExecutor(int(os.environ.get('THREADS', '4'))) as ex:
    for i, (k, f, d) in enumerate(ex.map(job, list(man.keys()))):
        man[k] = [f, d]; state[f] = tempo
        if i % 200 == 0: print(i, flush=True)

json.dump(man, open(manp, 'w'), separators=(',', ':'))
json.dump(state, open(statep, 'w'), separators=(',', ':'))
print('done', len(man))
