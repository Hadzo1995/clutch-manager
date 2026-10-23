"""
Add player photos by hand: put image files named after the player's handle or id
(e.g. "MATYS.jpg" or "pro-matys.png") in one folder and run

    python3 photos_manual.py <folder>

Each file is copied to public/players/<player id>.<ext> and added to
src/engine/data/playerPhotos.generated.ts (existing photos are kept unless replaced).
Files that match no player are listed and skipped.
"""
import csv, io, json, os, re, shutil, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
folder = sys.argv[1]
gen = open(os.path.join(ROOT, 'src', 'engine', 'data', 'realPlayers.generated.ts'), encoding='utf8').read()
rows = list(csv.DictReader(io.StringIO(json.loads(re.search(r'REAL_PLAYERS_CSV = (".*?");\n', gen, re.S).group(1)))))
pid = lambda h: 'pro-' + re.sub(r'[^a-z0-9]+', '-', h.lower())  # noqa: E731
by_key = {}
for r in rows:
    by_key[r['handle'].lower()] = pid(r['handle'])
    by_key[pid(r['handle'])] = pid(r['handle'])

dst = os.path.join(ROOT, 'src', 'engine', 'data', 'playerPhotos.generated.ts')
text = open(dst, encoding='utf8').read()
photos = json.loads(re.search(r'PLAYER_PHOTOS: Record<string, PlayerPhoto> = (.*);\s*$', text, re.S).group(1))
added, skipped = [], []
for f in sorted(os.listdir(folder)):
    name, ext = os.path.splitext(f)
    if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
        continue
    key = by_key.get(name.lower())
    if not key:
        skipped.append(f)
        continue
    ext = '.jpg' if ext.lower() == '.jpeg' else ext.lower()
    os.makedirs(os.path.join(ROOT, 'public', 'players'), exist_ok=True)
    for old in os.listdir(os.path.join(ROOT, 'public', 'players')):
        if os.path.splitext(old)[0] == key:
            os.remove(os.path.join(ROOT, 'public', 'players', old))
    shutil.copyfile(os.path.join(folder, f), os.path.join(ROOT, 'public', 'players', key + ext))
    photos[key] = {'src': f'players/{key}{ext}', 'page': 'added by hand', 'license': 'provided by the project owner', 'artist': ''}
    added.append(key)
head = text[:text.index('export const PLAYER_PHOTOS')]
with open(dst, 'w', encoding='utf8', newline='\n') as fh:
    fh.write(head + 'export const PLAYER_PHOTOS: Record<string, PlayerPhoto> = ' + json.dumps(photos, indent=0, ensure_ascii=False) + ';\n')
print(f'added {len(added)}; skipped (no matching player): {skipped}')
