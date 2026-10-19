"""
Add each player's role, country and birth date from Liquipedia to the Valve import.

Liquipedia API rules (https://liquipedia.net/api-terms-of-use):
- MediaWiki API only (no HTML scraping), gzip, a custom User-Agent with contact details;
- at most 1 request every 2 seconds (we wait 2.5 s); action=parse is not used.
Content is CC BY-SA 3.0: credit Liquipedia and share the derived data under the same licence.

Usage: python3 liquipedia.py vrs-YYYY-MM-DD.json players-liquipedia.json "Contact <email>"
   or: python3 liquipedia.py vrs-YYYY-MM-DD.json players-liquipedia.json --raw=<dir>
       (reads API answers saved by pc-fetch/fetch-liquipedia.ps1 instead of calling the API)
Requests: one per 50 player pages (about 7 for 320 players) plus one per 50 team pages.
"""
import gzip, json, re, sys, time, urllib.parse, urllib.request

VRS, OUT, CONTACT = sys.argv[1], sys.argv[2], sys.argv[3]
API = 'https://liquipedia.net/counterstrike/api.php'
UA = f'ClutchManagerFanGame/0.1 (free non-commercial CS2 manager fan game; roster import; {CONTACT})'
last = [0.0]


def api(params):
    wait = 2.5 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    q = urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': 2})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    last[0] = time.time()
    return json.loads(raw)


def pages(titles):
    """Wikitext for up to 50 titles at a time, following redirects. Returns {requested title: (final title, text)}."""
    out = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = api({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'redirects': 1, 'titles': '|'.join(chunk)})
        q = d.get('query', {})
        norm = {n['from']: n['to'] for n in q.get('normalized', [])}
        redir = {r['from']: r['to'] for r in q.get('redirects', [])}
        by_title = {}
        for p in q.get('pages', []):
            if p.get('missing') or not p.get('revisions'):
                continue
            by_title[p['title']] = p['revisions'][0]['slots']['main']['content']
        for t in chunk:
            n = norm.get(t, t)
            f = redir.get(n, n)
            if f in by_title:
                out[t] = (f, by_title[f])
    return out


def field(text, name):
    m = re.search(r'\|\s*' + name + r'\s*=\s*([^\n|}]*)', text)
    return m.group(1).strip() if m and m.group(1).strip() else None


ROLE_MAP = {'awper': 'awp', 'awp': 'awp', 'in-game leader': 'igl', 'igl': 'igl', 'entry fragger': 'entry', 'entryfragger': 'entry', 'entry': 'entry', 'rifle': 'rifler',
            'lurker': 'lurker', 'lurk': 'lurker', 'support': 'support', 'rifler': 'rifler', 'coach': 'coach'}


def roles(text):
    found = []
    for key in ('role', 'role2', 'role3', 'roles'):
        v = field(text, key)
        if not v:
            continue
        for part in re.split(r'[,/;]', v):
            r = ROLE_MAP.get(part.strip().lower())
            if r and r not in found:
                found.append(r)
    return found


def pages_from_raw(folder, titles):
    """Same result as pages(), from saved API answers (batchNN.json)."""
    import glob, os
    norm, redir, by_title = {}, {}, {}
    for f in sorted(glob.glob(os.path.join(folder, 'batch*.json'))):
        q = json.load(open(f, encoding='utf-8-sig')).get('query', {})
        norm.update({n['from']: n['to'] for n in q.get('normalized', [])})
        redir.update({r['from']: r['to'] for r in q.get('redirects', [])})
        for p in q.get('pages', []):
            if not p.get('missing') and p.get('revisions'):
                by_title[p['title']] = p['revisions'][0]['slots']['main']['content']
    out = {}
    for t in titles:
        n = norm.get(t, t)
        f = redir.get(n, n)
        if f in by_title:
            out[t] = (f, by_title[f])
    return out


def same_team(page_team, vrs_team):
    """Loose match ("FaZe Clan" vs "FaZe"), to catch a page about a different person with the same handle."""
    a = re.sub(r'[^a-z0-9]', '', (page_team or '').lower())
    b = re.sub(r'[^a-z0-9]', '', vrs_team.lower())
    return bool(a) and (a in b or b in a)


def main():
    vrs = json.load(open(VRS))
    handles = [h for t in vrs['teams'] for h in t['roster']]
    if CONTACT.startswith('--raw='):
        global pages
        folder = CONTACT[len('--raw='):]
        pages = lambda titles: pages_from_raw(folder, titles)  # noqa: E731
    got = pages(handles)
    # A second pass with capitalised first letter / exact case variants for misses.
    miss = [h for h in handles if h not in got]
    alt = {h: h[0].upper() + h[1:] for h in miss if h[0].upper() + h[1:] != h}
    got2 = pages(list(alt.values()))
    for h, a in alt.items():
        if a in got2:
            got[h] = got2[a]
    players = []
    for t in vrs['teams']:
        for h in t['roster']:
            rec = {'handle': h, 'team': t['name'], 'found': h in got}
            if h in got:
                title, text = got[h]
                if '{{infobox player' not in text.lower():
                    rec.update(found=False, note=f'page "{title}" is not a player infobox (disambiguation?)')
                else:
                    rec.update({
                        'page': title,
                        'country': field(text, 'country'),
                        'birthDate': field(text, 'birth_date'),
                        'roles': roles(text),
                        'status': field(text, 'status'),
                        'pageTeam': field(text, 'team'),
                        'teamMatch': same_team(field(text, 'team'), t['name']),
                    })
            players.append(rec)
    out = {
        'source': 'Liquipedia (https://liquipedia.net/counterstrike/), CC BY-SA 3.0',
        'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'basedOn': vrs.get('standingsDate'),
        'players': players,
    }
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    ok = sum(p.get('found') for p in players)
    print(f'{ok}/{len(players)} players matched; with role {sum(bool(p.get("roles")) for p in players)}, '
          f'country {sum(bool(p.get("country")) for p in players)}, birth date {sum(bool(p.get("birthDate")) for p in players)}')
    print(f'team on page differs from Valve roster: {sum(p.get("found") and not p.get("teamMatch") for p in players)}')
    for p in players:
        if p.get('found') and not p.get('teamMatch'):
            print('  team differs:', p['handle'], p['team'], 'vs page:', p.get('pageTeam'))
    for p in players:
        if not p.get('found'):
            print('  missing:', p['handle'], '(' + p['team'] + ')', p.get('note', ''))


main()
