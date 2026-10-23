"""
Player photos for the real-pro dataset, from Liquipedia (not HLTV: HLTV has no API, blocks
automated access with a bot check and its terms forbid scraping).

Liquipedia API rules (https://liquipedia.net/api-terms-of-use): MediaWiki API only, gzip,
a User-Agent with contact details, at most one request every 2 seconds (we wait 2.5 s).

Identity matching: a player's page is used only when its infobox team matches the player's
team in our dataset (so a same-named player elsewhere is never picked up). Player pages come
from the API answers saved by pc-fetch (raw/*.json); only image metadata and the thumbnails
themselves are requested here. Each file's licence (from Liquipedia's file page) is recorded.

Usage: python3 photos.py <data-dir>
  <data-dir> holds raw/*.json; thumbnails are cached in <data-dir>/photos/.
  Writes public/players/<player id>.<ext> and src/engine/data/playerPhotos.generated.ts,
  plus PHOTOS_REPORT.md in <data-dir>.
"""
import csv, glob, gzip, io, json, os, re, shutil, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = sys.argv[1]
CACHE = os.path.join(DATA, 'photos')
OUT_DIR = os.path.join(ROOT, 'public', 'players')
API = 'https://liquipedia.net/counterstrike/api.php'
UA = 'ClutchManagerFanGame/0.3 (free non-commercial CS2 manager university project; player photos; https://github.com/Hadzo1995/clutch-manager)'
WIDTH = 160
last = [0.0]


def get(url):
    w = 2.5 - (time.time() - last[0])
    if w > 0:
        time.sleep(w)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    last[0] = time.time()
    return raw


def api(params):
    q = urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': 2})
    return json.loads(get(f'{API}?{q}'))


def field(text, name):
    m = re.search(r'\|\s*' + name + r'\s*=\s*([^\n|}]*)', text)
    return m.group(1).strip() if m else ''


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def same_team(page_team, ours):
    a, b = norm(page_team), norm(ours)
    return bool(a) and bool(b) and (a == b or a.startswith(b) or b.startswith(a) or b in a)


def players():
    gen = open(os.path.join(ROOT, 'src', 'engine', 'data', 'realPlayers.generated.ts'), encoding='utf8').read()
    text = json.loads(re.search(r'REAL_PLAYERS_CSV = (".*?");\n', gen, re.S).group(1))
    return list(csv.DictReader(io.StringIO(text)))


def player_id(handle):
    # Same rule as realPlayers.ts: pro-<handle lower-cased, non-alphanumerics as dashes>.
    return 'pro-' + re.sub(r'[^a-z0-9]+', '-', handle.lower())


def raw_pages():
    norm_map, redir, by_title = {}, {}, {}
    for f in sorted(glob.glob(os.path.join(DATA, 'raw', '*.json'))):
        q = json.load(open(f, encoding='utf8'))['query']
        norm_map.update({r['from']: r['to'] for r in q.get('normalized', [])})
        redir.update({r['from']: r['to'] for r in q.get('redirects', [])})
        for p in q['pages']:
            if p.get('revisions'):
                by_title[p['title']] = p['revisions'][0]['slots']['main']['content']
    def find(title):
        t = norm_map.get(title, title)
        seen = 0
        while t in redir and seen < 5:
            t = redir[t]; seen += 1
        return (t, by_title[t]) if t in by_title else (None, None)
    return find


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    find = raw_pages()
    rows = players()
    matched, report = {}, []
    for r in rows:
        h, team = r['handle'], r['team']
        title, text = find(h)
        if not text:
            # Disambiguated pages, e.g. "Ryu (Brazilian player)": any saved page whose
            # infobox id is this handle and whose team matches.
            report.append((h, team, 'no Liquipedia page found'))
            continue
        if not re.search(r'\{\{\s*Infobox player', text, re.I):
            report.append((h, team, f'page "{title}" is not a player page (disambiguation)'))
            continue
        page_team = field(text, 'team')
        if not same_team(page_team, team):
            report.append((h, team, f'page "{title}" lists team "{page_team}", not {team}: not used'))
            continue
        img = field(text, 'image')
        if not img:
            report.append((h, team, f'page "{title}" has no photo'))
            continue
        matched[h] = {'id': player_id(h), 'page': title, 'file': img}

    files = sorted({m['file'] for m in matched.values()})
    info = {}
    for i in range(0, len(files), 50):
        chunk = files[i:i + 50]
        res = api({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': WIDTH, 'titles': '|'.join('File:' + f for f in chunk)})
        alias = {n['from']: n['to'] for n in res['query'].get('normalized', [])}
        back = {alias.get('File:' + f, 'File:' + f): f for f in chunk}
        for p in res['query']['pages']:
            ii = (p.get('imageinfo') or [{}])[0]
            meta = ii.get('extmetadata') or {}
            if p['title'] in back and (ii.get('thumburl') or ii.get('url')):
                info[back[p['title']]] = {
                    'url': ii.get('thumburl') or ii['url'],
                    'license': (meta.get('LicenseShortName') or {}).get('value', ''),
                    'artist': re.sub(r'<[^>]+>', '', (meta.get('Artist') or {}).get('value', '')).strip(),
                }

    out = {}
    for h, m in matched.items():
        inf = info.get(m['file'])
        if not inf:
            report.append((h, '', f'file "{m["file"]}" not found on Liquipedia'))
            continue
        ext = os.path.splitext(inf['url'].split('?')[0])[1].lower() or '.jpg'
        cached = os.path.join(CACHE, m['id'] + ext)
        try:
            if not os.path.exists(cached):
                open(cached, 'wb').write(get(inf['url']))
        except Exception as e:  # noqa: BLE001
            report.append((h, '', f'download failed: {e}'))
            continue
        shutil.copyfile(cached, os.path.join(OUT_DIR, m['id'] + ext))
        out[m['id']] = {'src': f'players/{m["id"]}{ext}', 'page': m['page'], 'license': inf['license'], 'artist': inf['artist'][:80]}

    dst = os.path.join(ROOT, 'src', 'engine', 'data', 'playerPhotos.generated.ts')
    with open(dst, 'w', encoding='utf8', newline='\n') as f:
        f.write('// Generated by tools/realdata/photos.py from Liquipedia. Do not edit by hand.\n')
        f.write('// Photos keep their Liquipedia licences (listed per file); used in a free, non-commercial university project.\n')
        f.write('export interface PlayerPhoto { src: string; page: string; license: string; artist: string }\n')
        f.write('export const PLAYER_PHOTOS: Record<string, PlayerPhoto> = ' + json.dumps(out, indent=0, ensure_ascii=False) + ';\n')

    lic = {}
    for v in out.values():
        lic[v['license'] or 'unknown'] = lic.get(v['license'] or 'unknown', 0) + 1
    with open(os.path.join(DATA, 'PHOTOS_REPORT.md'), 'w', encoding='utf8') as f:
        f.write(f'# Player photos\n\n{len(out)} of {len(rows)} players have a photo.\n\nLicences: {json.dumps(lic)}\n\n## Missing or not used ({len(report)})\n\n')
        for h, team, why in report:
            f.write(f'- {h} ({team}): {why}\n')
    print(f'{len(out)} of {len(rows)} photos; {len(report)} missing; licences {lic}')


if __name__ == '__main__':
    main()
