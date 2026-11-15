import re,sys,json,glob
TH=re.compile(r"[฀-๿]")
lit=re.compile(r"(['\"`])((?:\\.|(?!\1).)*?)\1")
def norm(t):
  t=re.sub(r"\s+"," ",t.strip())
  return t
def speakable(t):
  s=re.sub(r"\([^)]*\)","",t)            # stage directions
  s=re.sub(r"[♪♥★☆«»“”\"']","",s)
  s=s.replace("…"," ").replace("..."," ")
  s=re.sub(r"[A-Za-z]+","",s)            # TTS is Thai-only
  s=re.sub(r"\s+"," ",s).strip(" ,.!?·-–—/")
  return s
def fnv(s):
  h=0x811c9dc5
  for b in s.encode('utf8'): h^=b; h=(h*0x01000193)&0xffffffff
  return '%08x'%h
groups=[('A',['src/modules/intro/**/*.ts','src/modules/stand/**/*.ts','src/modules/backrooms/**/*.ts','src/modules/ritual/lines.ts','src/modules/ritual/talk.ts','src/modules/ritual/index.ts','src/modules/build/keeper.ts','src/modules/cooking/butcher.ts']),
        ('B',['src/modules/quests/content/banter.ts','src/modules/combat/lines.ts','src/modules/restaurant/lines.ts','src/modules/life/lines.ts']),
        ('C',['src/modules/quests/content/people.ts','src/modules/quests/content/keepers.ts','src/modules/shops/lines.ts','src/modules/hud/monologue.ts'])]
seen={}; out=[]
for g,pats in groups:
  for pat in pats:
    for f in sorted(glob.glob(pat,recursive=True)):
      src=open(f,encoding='utf8').read()
      for m in lit.finditer(src):
        t=m.group(2)
        if not TH.search(t) or '${' in t: continue
        t=norm(t.replace("\\'","'").replace('\\"','"'))
        sp=speakable(t)
        if len(re.findall(r"[฀-๿]",sp))<3 or len(sp)>140: continue
        k=fnv(t)
        if k in seen: continue
        seen[k]=1; out.append({'k':k,'t':t,'s':sp,'g':g,'f':f})
json.dump(out,open(sys.argv[1],'w'),ensure_ascii=False,indent=0)
from collections import Counter; print(Counter(o['g'] for o in out), len(out))
