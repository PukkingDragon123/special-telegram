# Original synthesized anime/meme SFX (no samples). Writes WAVs into the given dir.
import numpy as np, wave, sys, os
SR = 44100
out = sys.argv[1]
ONLY2 = len(sys.argv) > 2
rng = np.random.default_rng(7)
def t(d): return np.arange(int(SR*d))/SR
def env(n, a, d, s=0.0, r=None):
    x = np.ones(n); A = int(SR*a); D = int(SR*d)
    x[:A] = np.linspace(0,1,max(A,1))[:A] if A else x[:A]
    x[A:A+D] = np.linspace(1,s,max(D,1))[:len(x[A:A+D])]
    x[A+D:] = s
    return x
def exp_env(n, k): return np.exp(-np.arange(n)/SR*k)
def lp(x, fc):
    a = np.exp(-2*np.pi*fc/SR); y = np.zeros_like(x); p = 0.0
    for i in range(len(x)): p = (1-a)*x[i] + a*p; y[i] = p
    return y
def lp_sweep(x, f0, f1):
    fc = np.geomspace(f0, f1, len(x)); a = np.exp(-2*np.pi*fc/SR); y = np.zeros_like(x); p = 0.0
    for i in range(len(x)): p = (1-a[i])*x[i] + a[i]*p; y[i] = p
    return y
def hp(x, fc): return x - lp(x, fc)
def saw(f, tt): return 2*((f*tt) % 1) - 1
def sq(f, tt): return np.sign(np.sin(2*np.pi*f*tt))
def sine(f, tt): return np.sin(2*np.pi*f*tt)
def noise(n): return rng.uniform(-1,1,n)
def reverb(x, wet=0.3, decay=1.6):
    n = int(SR*decay); ir = noise(n)*exp_env(n, 4.5/decay); ir = lp(ir, 5000)
    L = len(x)+n; N = 1 << (L-1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N)*np.fft.rfft(ir, N), N)[:L]; y = y/ (np.max(np.abs(y))+1e-9)
    xx = np.concatenate([x, np.zeros(n)])
    return xx*(1-wet) + y*wet*np.max(np.abs(x))
def sat(x, k=2.5): return np.tanh(x*k)/np.tanh(k)
def norm(x, peak=0.9): return x/ (np.max(np.abs(x))+1e-9)*peak
def mix(*xs):
    n = max(len(a) for a in xs); y = np.zeros(n)
    for a in xs: y[:len(a)] += a
    return y
def at(x, sec, n=None):
    pad = np.zeros(int(SR*sec)); return np.concatenate([pad, x])
def save(name, x):
    x = norm(x); d = (x*32767).astype(np.int16)
    with wave.open(os.path.join(out, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes())
def brass(f, d, bright=3000):
    tt = t(d); v = sum(saw(f*m*(1+0.003*k), tt) for k,m in enumerate([1,1,0.5,2]))
    v = lp_sweep(v, 600, bright) * env(len(tt), 0.02, d*0.5, 0.6)
    return v * exp_env(len(tt), 1.2)

# ------------------------------------------------------------------ batch 2 (round 6): more meme / anime SFX
def formant(src, freqs, bws, gains):
    # crude vowel: sum of 2-pole resonators
    y = np.zeros_like(src)
    for f, bw, g in zip(freqs, bws, gains):
        r = np.exp(-np.pi*bw/SR); c = 2*r*np.cos(2*np.pi*f/SR)
        o = np.zeros_like(src); y1 = y2 = 0.0
        for i in range(len(src)):
            v = src[i] + c*y1 - r*r*y2; y2 = y1; y1 = v; o[i] = v
        y += o/(np.max(np.abs(o))+1e-9)*g
    return y
def glottal(f0, d, jitter=0.01):
    tt = t(d); f = f0*(1+jitter*np.sin(2*np.pi*5.3*tt)) if np.isscalar(f0) else f0
    ph = np.cumsum(f)/SR if not np.isscalar(f0) else np.cumsum(np.full(len(tt), 1.0)*f)/SR
    return 2*(ph % 1) - 1
VOW = {'a': ([800, 1200, 2500], [90, 110, 160], [1, .6, .25]), 'u': ([320, 800, 2300], [70, 90, 150], [1, .35, .15]),
       'o': ([500, 900, 2400], [80, 100, 150], [1, .5, .2]), 'e': ([450, 1900, 2600], [70, 120, 160], [1, .5, .3])}
def vowel(v, f0, d, a=0.02, r=0.12):
    fr, bw, g = VOW[v]; tt = t(d)
    fcur = np.full(len(tt), float(f0)) if np.isscalar(f0) else f0
    src = glottal(fcur, d)
    x = formant(src, fr, bw, g) * env(len(tt), a, d - a - r, 1.0)
    rel = int(SR*r); x[-rel:] *= np.linspace(1, 0, rel)
    return x

# bruh-style low "huh?" (original synthetic voice: low glottal pulse through 'u'→'a' formants, falling pitch)
d = 0.55; tt = t(d); f = np.linspace(105, 82, len(tt))
save('meme_huh_low', reverb(vowel('a', f, d)*0.8 + lp(noise(len(tt)), 900)*exp_env(len(tt), 12)*0.15, 0.15, 0.6))
# comedic spring boing
d = 0.9; tt = t(d); f = 220*(1 + 0.6*np.sin(2*np.pi*14*tt)*exp_env(len(tt), 4)) * np.linspace(1.0, 1.25, len(tt))
save('meme_boing', sine(1, np.cumsum(f)/SR) * exp_env(len(tt), 4.5))
# slide whistle up then down
d = 1.1; tt = t(d); f = np.concatenate([np.geomspace(500, 1800, len(tt)//2), np.geomspace(1800, 420, len(tt)-len(tt)//2)]) * (1 + 0.012*np.sin(2*np.pi*6*tt))
x = sine(1, np.cumsum(f)/SR) + 0.25*sine(2, np.cumsum(f)/SR) + lp(noise(len(tt)), 3000)*0.05
save('meme_slide_whistle', x * env(len(tt), 0.04, d-0.2, 1.0) * np.minimum(1, (d-tt)/0.15+0.01))
# chipmunk gasp "huh?!" (high, quick rise)
d = 0.32; tt = t(d); f = np.geomspace(420, 900, len(tt))
save('meme_chipmunk', vowel('a', f, d, 0.01, 0.06) * 0.9)
# airhorn (3 blasts, detuned saws)
def horn(d):
    tt = t(d); x = sum(saw(fq*(1+0.004*k), tt) for k, fq in enumerate([466, 470, 554, 558, 698]))
    return sat(lp(x, 3500)*env(len(tt), 0.01, d-0.06, 1.0), 2.5)
save('meme_airhorn', reverb(mix(horn(0.22), at(horn(0.22), 0.28), at(horn(0.85), 0.56)), 0.2, 0.9))
# correct ding (bell partials)
d = 1.4; tt = t(d)
save('meme_ding', sum(sine(1760*m, tt)*exp_env(len(tt), 3.5*m**0.6)*g for m, g in [(1, 1), (2.76, .35), (5.4, .15), (0.5, .3)]))
# wrong buzzer
d = 0.75; tt = t(d)
save('meme_wrong_buzzer', sat(lp(sq(110, tt) + sq(116.5, tt)*0.7, 1600), 2) * env(len(tt), 0.01, d-0.08, 1.0) * np.minimum(1, (d-tt)/0.06+0.01))
# cartoon run (fast tom roll + bongo + whistle sweep)
d = 1.0; tt = t(d); x = np.zeros(len(tt))
for i in range(16):
    s0 = int(i*SR*0.055); n = int(SR*0.06); ft = 180 if i % 2 else 140
    hit = sine(ft, t(0.06))*exp_env(n, 40); x[s0:s0+n] += hit[:len(x[s0:s0+n])]
save('meme_cartoon_run', x + sine(1, np.cumsum(np.geomspace(900, 2400, len(tt)))/SR)*0.25*np.linspace(0, 1, len(tt))*exp_env(len(tt), 1))
# camera shutter (two clicks + whirr)
def click(n=0.012, fc=4000): x = hp(noise(int(SR*n)), fc)*exp_env(int(SR*n), 300); return x
save('meme_camera_shutter', mix(click(0.015, 2500)*1.0, at(click(0.02, 1800)*0.8, 0.07), at(lp(noise(int(SR*0.12)), 2500)*exp_env(int(SR*0.12), 25)*0.25, 0.09)))
# gong
d = 3.5; tt = t(d)
x = sum(sine(f0, tt)*exp_env(len(tt), k)*g for f0, k, g in [(98, .8, 1), (153, 1.1, .6), (231, 1.4, .45), (317, 1.8, .3), (459, 2.2, .2)])
x *= (1 + 0.5*np.minimum(1, tt/0.4))
save('meme_gong', reverb(x + lp(noise(len(tt)), 900)*exp_env(len(tt), 30)*0.3, 0.3, 2.2))
# cash register ka-ching (drawer clunk + two bells)
d = 1.2; tt = t(d)
bell = lambda f: sum(sine(f*m, t(1.0))*exp_env(int(SR), 5*m)*g for m, g in [(1, 1), (2.4, .4), (4.1, .2)])
clunk = lp(noise(int(SR*0.08)), 600)*exp_env(int(SR*0.08), 35)
save('meme_ka_ching', mix(clunk*1.2, at(bell(2093)*0.7, 0.07), at(bell(2637)*0.8, 0.16)))
# crowd laugh track (many synthetic "ha" bursts, random voices)
d = 2.6; x = np.zeros(int(SR*d))
for k in range(26):
    f0 = rng.uniform(110, 300); start = rng.uniform(0, 0.5); nha = rng.integers(3, 7)
    for j in range(nha):
        s0 = int(SR*(start + j*rng.uniform(0.13, 0.19)))
        h = vowel('a', f0*rng.uniform(0.95, 1.08), 0.11, 0.008, 0.05) + hp(noise(int(SR*0.11)), 1500)*0.25*exp_env(int(SR*0.11), 20)
        x[s0:s0+len(h)] += h[:len(x[s0:s0+len(h)])]*rng.uniform(0.4, 1)
x *= np.minimum(1, np.linspace(1.6, 0, len(x)))
save('meme_laugh_track', reverb(lp(x, 4500), 0.3, 1.0))
# crowd "wooow"
d = 1.6; x = np.zeros(int(SR*(d+0.2)))
for k in range(18):
    f0 = rng.uniform(110, 260); tt = t(d); f = f0*np.concatenate([np.linspace(0.9, 1.15, len(tt)//2), np.linspace(1.15, 0.85, len(tt)-len(tt)//2)])
    v = vowel('o', f, d, 0.15, 0.4)
    s0 = int(SR*rng.uniform(0, 0.2)); x[s0:s0+len(v)] += v*rng.uniform(0.4, 1)
save('meme_crowd_wow', reverb(lp(x, 4000), 0.3, 1.0))
# record scratch variants (band-passed noise with back-and-forth pitch)
for vi, (rate, n) in enumerate([(9, 0.45), (14, 0.35)]):
    tt = t(n); fc = 900 + 700*np.sin(2*np.pi*rate*tt)
    x = noise(len(tt)); y = np.zeros_like(x); lpv = 0.0; bpv = 0.0
    for i in range(len(x)):
        f = 2*np.sin(np.pi*fc[i]/SR); hpv = x[i] - lpv - 0.4*bpv; bpv += f*hpv; lpv += f*bpv; y[i] = bpv
    save(f'meme_scratch_{vi+2}', sat(y*exp_env(len(tt), 3), 2))
print('ok')
