"""Write titles.txt (player handles + capitalised variants) for fetch-liquipedia.ps1.
Usage: python3 make_titles.py vrs-YYYY-MM-DD.json titles.txt"""
import json, sys

hs = []
for t in json.load(open(sys.argv[1]))['teams']:
    hs += [h for h in t['roster'] if h not in hs]
alt = [h[0].upper() + h[1:] for h in hs if h[0].upper() + h[1:] not in hs]
open(sys.argv[2], 'w', newline='\n').write('\n'.join(hs + alt) + '\n')
print(len(hs), 'handles,', len(alt), 'variants')
