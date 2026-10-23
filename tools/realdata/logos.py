"""
Team logos for the real organisations in src/engine/data/realTeams.ts, from Liquipedia.

Liquipedia API rules (https://liquipedia.net/api-terms-of-use): MediaWiki API only, gzip, a
custom User-Agent with contact details, at most one request every 2 seconds (we wait 2.5 s).
Team logos are trademarks of their organisations; Clutch Manager uses them in a free,
non-commercial university project only. Remove src/ui/teamLogos.generated.ts for any other use.

Usage: python3 logos.py <cache-dir>
  Reads team names from realTeams.ts, fetches each team page's infobox logo (dark-mode
  version preferred), downloads a 96 px thumbnail into <cache-dir> and writes
  src/ui/teamLogos.generated.ts (key -> data URL). Re-running reuses the cache.
"""
import base64, gzip, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = sys.argv[1]
API = 'https://liquipedia.net/counterstrike/api.php'
UA = 'ClutchManagerFanGame/0.2 (free non-commercial CS2 manager university project; team logos; https://github.com/Hadzo1995/clutch-manager)'
last = [0.0]


def wait():
    w = 2.5 - (time.time() - last[0])
    if w > 0:
        time.sleep(w)


def get(url):
    wait()
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


# Liquipedia page titles where the org's display name is not the page name.
ALT = {
    'Aurora': 'Aurora Gaming', 'Inner Circle': 'Inner Circle Esports', 'BBL': 'BBL Esports', 'Sangal': 'Sangal Esports',
    'Imperial': 'Imperial Esports', 'Betclic': 'Betclic Apogee Esports', 'CYBERSHOKE': 'CYBERSHOKE Esports', 'SINNERS': 'SINNERS Esports',
    'DENDELE': 'Dendele', 'WBT': 'WBT Esports', 'Color': 'Team Color',
}


def teams():
    src = open(os.path.join(ROOT, 'src', 'engine', 'data', 'realTeams.ts'), encoding='utf8').read()
    # Lines like:  MOUZ: T('MOUZ', 'MOUZ', '#d3112c', '#f4f4f4'),   or   'Natus Vincere': T('Natus Vincere', ...
    return [(k, ALT.get(k, n)) for k, n in re.findall(r"^\s*'?([^':]+?)'?\s*:\s*T\('([^']+)'", src, re.M)]


def main():
    os.makedirs(CACHE, exist_ok=True)
    pairs = teams()  # (csv key, display name)
    meta_path = os.path.join(CACHE, 'files.json')
    files = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    todo = [(k, n) for k, n in pairs if k not in files]
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        res = api({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'redirects': 1, 'titles': '|'.join(n for _, n in chunk)})
        q = res['query']
        alias = {}
        for r in q.get('normalized', []) + q.get('redirects', []):
            alias[r['from']] = r['to']
        text = {p['title']: (p.get('revisions') or [{}])[0].get('slots', {}).get('main', {}).get('content', '') for p in q['pages']}
        for key, name in chunk:
            t = name
            while t in alias:
                t = alias[t]
            wt = text.get(t, '')
            dark = re.search(r'\|\s*imagedark\s*=\s*([^\n|}]+)', wt)
            light = re.search(r'\|\s*image\s*=\s*([^\n|}]+)', wt)
            f = (dark or light)
            files[key] = f.group(1).strip() if f else None
            if not f:
                print('no logo found for', key, '->', t)
    json.dump(files, open(meta_path, 'w'), indent=1)

    names = sorted({f for f in files.values() if f})
    urls = {}
    for i in range(0, len(names), 50):
        chunk = names[i:i + 50]
        res = api({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': 96, 'titles': '|'.join('File:' + n for n in chunk)})
        alias = {r['from']: r['to'] for r in res['query'].get('normalized', [])}
        back = {alias.get('File:' + n, 'File:' + n): n for n in chunk}
        for p in res['query']['pages']:
            ii = (p.get('imageinfo') or [{}])[0]
            u = ii.get('thumburl') or ii.get('url')
            if u and p['title'] in back:
                urls[back[p['title']]] = u

    out = {}
    for key, f in files.items():
        if not f or f not in urls:
            continue
        ext = os.path.splitext(urls[f].split('?')[0])[1].lower() or '.png'
        local = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9]+', '_', key) + ext)
        if not os.path.exists(local):
            open(local, 'wb').write(get(urls[f]))
        mime = {'.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}.get(ext, 'image/png')
        out[key] = f'data:{mime};base64,' + base64.b64encode(open(local, 'rb').read()).decode()

    dst = os.path.join(ROOT, 'src', 'ui', 'teamLogos.generated.ts')
    with open(dst, 'w', encoding='utf8', newline='\n') as fh:
        fh.write('// Generated by tools/realdata/logos.py from Liquipedia. Do not edit by hand.\n')
        fh.write('// Team logos are trademarks of their organisations, used here only in a free, non-commercial university project.\n')
        fh.write('export const TEAM_LOGOS: Record<string, string> = ' + json.dumps(out, indent=0) + ';\n')
    print(f'{len(out)} of {len(pairs)} logos written to {dst} ({os.path.getsize(dst) // 1024} KB)')


if __name__ == '__main__':
    main()
