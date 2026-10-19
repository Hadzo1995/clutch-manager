"""
Read Valve's public Counter-Strike Regional Standings (VRS) and write a compact JSON.

Source: https://github.com/ValveSoftware/counter-strike_regional_standings
(no licence file; we credit Valve and never imply endorsement). We keep only
facts: rank, points, team name, region, five-player roster, and each counted
match (date, opponent, win/loss, LAN flag). No HLTV data is used.

Usage: python3 scratch/realdata/vrs.py <path to cloned repo> [out.json] [top N]
"""
import glob, json, os, re, sys

REPO = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'out', 'vrs.json')
TOP = int(sys.argv[3]) if len(sys.argv) > 3 else 64


def latest_date():
    files = glob.glob(f'{REPO}/live/*/standings_global_*.md')
    dates = sorted(re.search(r'(\d{4}_\d{2}_\d{2})\.md$', f).group(1) for f in files)
    return dates[-1]


def table_rows(text):
    for line in text.splitlines():
        if line.startswith('|') and not line.startswith('| :') and not line.startswith('| -:'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            yield cells


def main():
    date = latest_date()
    year = date[:4]
    base = f'{REPO}/live/{year}'
    glob_md = open(f'{base}/standings_global_{date}.md').read()
    region_of, regional_rank = {}, {}
    for reg in ('europe', 'americas', 'asia'):
        p = f'{base}/standings_{reg}_{date}.md'
        if not os.path.exists(p):
            continue
        for c in table_rows(open(p).read()):
            if c[0].isdigit():
                region_of[c[3]] = reg
                regional_rank[c[3]] = int(c[0])
    teams = []
    for c in table_rows(glob_md):
        if not c[0].isdigit():
            continue
        rank, points, name, roster = int(c[0]), int(c[1]), c[2], [h.strip() for h in c[3].split(',')]
        if rank > TOP:
            break
        link = re.search(r'\((details/[^)]+)\)', c[4]).group(1)
        detail = open(f'{base}/{link}').read()
        matches = []
        for m in table_rows(detail):
            # | Match Played | Match ID | Date | Opponent | W/L | Age Weight | Event Weight | Bounty | Network | LAN Wins | H2H | Roster |
            if len(m) >= 12 and re.match(r'\d{4}-\d{2}-\d{2}', m[2]):
                matches.append({'date': m[2], 'opponent': m[3], 'won': m[4] == 'W', 'countedLanWin': m[9].startswith('1')})
        teams.append({
            'rank': rank, 'points': points, 'name': name, 'roster': roster,
            'region': region_of.get(c[3]),  # regional tables are keyed by roster
            'regionalRank': regional_rank.get(c[3]),
            'matches': sorted(matches, key=lambda x: x['date'], reverse=True),
        })
    out = {
        'source': 'Valve Counter-Strike Regional Standings',
        'sourceUrl': 'https://github.com/ValveSoftware/counter-strike_regional_standings',
        'standingsDate': date.replace('_', '-'),
        'note': 'Rank, points, rosters and match results as published by Valve. Not endorsed by Valve.',
        'teams': teams,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'{date}: {len(teams)} teams, {sum(len(t["roster"]) for t in teams)} players -> {OUT}')


main()
