#!/usr/bin/env python3
"""Search the local Mixkit catalog: python3 -I mk_search.py "regex1" "regex2" ..."""
import json, re, sys
c = json.load(open("/home/user/special-telegram/scripts/_cache/audio_dl/mixkit/catalog.json"))
for pat in sys.argv[1:]:
    print("==", pat)
    for k, v in sorted(c.items(), key=lambda kv: int(kv[0])):
        if re.search(pat, v["title"], re.I):
            print(f"  {k:>5} {v['dur']:>5} {v['title']}  [{','.join(v['tags'][:5])}]")
