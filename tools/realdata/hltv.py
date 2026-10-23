"""
HLTV player statistics for the real-pro dataset, from stats pages the user saved in a browser.

HLTV has no public API and blocks automated access, so this reads pages saved by hand
(https://www.hltv.org/stats/players and its attribute tabs, Ctrl+S). Used in a free,
non-commercial university project only, as a reference for tiers and skills; the game does
not display HLTV numbers.

Pages (all with the same filters, e.g. last 12 months, Big events):
  --overall  stats/players               maps, rounds, K-D diff, K/D, rating
  --entry    stats/players/entrying      HLTV entry score 0..100 and its stats
  --sniping  stats/players/sniping       HLTV sniping score 0..100, sniper kill share, kills/round
  --flash    stats/players/flashbangs    HLTV flash score 0..100, flash assists per round

Identity: rows are tied to HLTV's numeric player id (from the profile link). A row is matched
to a game player when the handle matches (case-insensitive) and that handle appears once on the
page; team differences are listed in the report (players move), never silently merged.

Usage: python3 hltv.py --overall=A.html [--entry=B.html --sniping=C.html --flash=D.html] --label="..." [--report=out.md]
Writes src/engine/data/hltvStats.generated.ts keyed by the game's player id.
"""
import csv, html, io, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)


def table_rows(path):
    s = open(path, encoding='utf8', errors='replace').read()
    t = s[s.index('<table class="stats-table player-ratings-table'):]
    t = t[:t.index('</table>')]
    head = [re.sub(r'<[^>]+>|&nbsp;', '', h).strip() for h in re.findall(r'<th[^>]*>(.*?)</th>', t[:t.index('</thead>')], re.S)]
    out = []
    for r in re.findall(r'<tr>(.*?)</tr>', t, re.S):
        m = re.search(r'/stats/players/(\d+)/[^"]*"[^>]*>([^<]+)</a>', r)
        if not m:
            continue
        team = re.search(r'class="teamCol" data-sort="([^"]*)"', r)
        cells = re.findall(r'<td class="([^"]*)"([^>]*)>(.*?)</td>', r, re.S)
        vals = []
        for cls, attrs, inner in cells:
            if 'playerCol' in cls or 'teamCol' in cls:
                continue
            ds = re.search(r'data-sort="([^"]*)"', attrs)
            txt = re.sub(r'<[^>]+>', '', inner).strip()
            vals.append(ds.group(1) if ds else txt)
        out.append({'hltvId': int(m.group(1)), 'handle': html.unescape(m.group(2)).strip(), 'team': html.unescape(team.group(1)) if team else '', 'vals': vals})
    return head, out


def num(v):
    try:
        x = float(str(v).replace(',', '').replace('+', '').replace('%', ''))
        return None if x <= -1e8 else x
    except ValueError:
        return None


def by_name(head, name):
    for i, h in enumerate(head[1:]):  # head[0] is Player
        if h.lower().startswith(name.lower()):
            return i
    return None


gen = open(os.path.join(ROOT, 'src', 'engine', 'data', 'realPlayers.generated.ts'), encoding='utf8').read()
csv_text = json.loads(re.search(r'REAL_PLAYERS_CSV = (".*?");\n', gen, re.S).group(1))
ours = list(csv.DictReader(io.StringIO(csv_text)))
pid = lambda h: 'pro-' + re.sub(r'[^a-z0-9]+', '-', h.lower())  # noqa: E731  same rule as realPlayers.ts

head, overall = table_rows(args['overall'])
cols = [h for h in head[1:] if h.lower() not in ('teams',)]
stats, seen, notes = {}, {}, []
for r in overall:
    seen.setdefault(r['handle'].lower(), []).append(r)
for p in ours:
    rows = seen.get(p['handle'].lower(), [])
    if len(rows) != 1:
        if len(rows) > 1:
            notes.append(f"{p['handle']}: {len(rows)} HLTV players share this name; not used")
        continue
    r = rows[0]
    v = [num(x) for x in r['vals']]
    entry = {'hltvId': r['hltvId'], 'team': r['team'], 'maps': int(v[0] or 0), 'rounds': int(v[1] or 0), 'diff': int(v[2] or 0), 'kd': v[3], 'rating': v[4]}
    if r['team'] and p['team'] and re.sub(r'[^a-z0-9]', '', r['team'].lower()) != re.sub(r'[^a-z0-9]', '', p['team'].lower()):
        notes.append(f"{p['handle']}: HLTV team {r['team']}, ours {p['team']} (kept: same HLTV id across pages)")
    stats[pid(p['handle'])] = entry

ids = {v['hltvId']: k for k, v in stats.items()}
for key, path, fields in [
    ('entry', args.get('entry'), {}),
    ('sniping', args.get('sniping'), {'killShare': 'SK%', 'killsPerRound': 'SKPR'}),
    ('flash', args.get('flash'), {'assistsPerRound': 'FlaA', 'blindPerRound': 'BliPR'}),
]:
    if not path:
        continue
    h, rows = table_rows(path)
    for r in rows:
        k = ids.get(r['hltvId'])
        if not k:
            continue
        rec = {'score': num(r['vals'][-1])}
        for out_name, col in fields.items():
            i = by_name(h, col)
            if i is not None:
                rec[out_name] = num(r['vals'][i])
        stats[k][key] = rec

dst = os.path.join(ROOT, 'src', 'engine', 'data', 'hltvStats.generated.ts')
with open(dst, 'w', encoding='utf8', newline='\n') as f:
    f.write('// Generated by tools/realdata/hltv.py from HLTV.org stats pages saved by hand. Do not edit by hand.\n')
    f.write('// Free, non-commercial university project; HLTV statistics belong to HLTV.org. Reference only: not shown in the game.\n')
    f.write('export interface HltvAttr { score: number | null; killShare?: number | null; killsPerRound?: number | null; assistsPerRound?: number | null; blindPerRound?: number | null }\n')
    f.write('export interface HltvLine { hltvId: number; team: string; maps: number; rounds: number; diff: number; kd: number | null; rating: number | null; entry?: HltvAttr; sniping?: HltvAttr; flash?: HltvAttr }\n')
    f.write(f'export const HLTV_LABEL = {json.dumps(args.get("label", ""))};\n')
    f.write('/** Keyed by the game\'s player id (pro-<handle>). */\n')
    f.write('export const HLTV_STATS: Record<string, HltvLine> = ' + json.dumps(stats, separators=(',', ':')) + ';\n')

have = lambda k: sum(1 for v in stats.values() if k in v)  # noqa: E731
summary = f"{len(overall)} rows on the overall page; {len(stats)} of {len(ours)} game players matched; entry {have('entry')}, sniping {have('sniping')}, flash {have('flash')}"
print(summary)
if args.get('report'):
    with open(args['report'], 'w', encoding='utf8') as f:
        f.write(f"# HLTV import\n\n{args.get('label', '')}\n\n{summary}\n\n## Notes\n\n" + '\n'.join(f'- {n}' for n in notes) + '\n')
