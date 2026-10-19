"""
Turn the Valve import + Liquipedia details + Amar's star list into the CSV the
game's importer reads (src/engine/data/importer.ts). Decision D4.

Ratings are OUR OWN game numbers, not anyone's published statistics:
  rating = team level (from Valve points) + a fixed offset per role + a star bonus.
No HLTV data. If HLTV ever grants permission, its numbers go in the optional
stat columns of the same CSV (see CSV_COLUMNS.optional in importer.ts).

Usage: python3 build_csv.py vrs-YYYY-MM-DD.json players-liquipedia.json stars.md out.csv
       (pass "-" for the Liquipedia file to do a dry run: roles are then filled
        in by slot and every such row is listed as guessed; never ship that.)
"""
import csv, datetime, json, re, sys

import pycountry

VRS, LQ, STARS, OUT = sys.argv[1:5]

# Rating scale the importer and ratings.ts expect: around 1.00 for an average pro.
LEVEL_LO, LEVEL_HI = 0.90, 1.12          # team ranked last of the top 64 .. team ranked first
ROLE_OFFSET = {'awp': 0.03, 'entry': 0.01, 'lurker': 0.0, 'support': -0.02, 'igl': -0.05}
STAR_BONUS = 0.06
GAME_ROLES = ['igl', 'awp', 'entry', 'lurker', 'support']
ALIASES = {'russia': 'RU', 'kosovo': 'XK', 'turkey': 'TR', 'czech republic': 'CZ', 'south korea': 'KR',
           'vietnam': 'VN', 'taiwan': 'TW', 'iran': 'IR', 'moldova': 'MD', 'bolivia': 'BO', 'venezuela': 'VE',
           'united kingdom': 'GB', 'uk': 'GB', 'usa': 'US', 'united states': 'US'}


def iso2(name):
    if not name:
        return None
    n = re.sub(r'\[\[|\]\]|\{\{.*?\}\}', '', name).strip()
    if len(n) == 2:
        return n.upper()
    if n.lower() in ALIASES:
        return ALIASES[n.lower()]
    try:
        return pycountry.countries.lookup(n).alpha_2
    except LookupError:
        try:
            return pycountry.countries.search_fuzzy(n)[0].alpha_2
        except LookupError:
            return None


def age_on(birth, day):
    m = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', birth or '')
    if not m:
        return None
    b = datetime.date(*map(int, m.groups()))
    return day.year - b.year - ((day.month, day.day) < (b.month, b.day))


def stars():
    out = set()
    for line in open(STARS):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) == 4 and cells[0].isdigit() and cells[3]:
            out.update(s.strip() for s in cells[3].split(','))
    return out


def assign_roles(roster, lq):
    """One IGL and one AWPer per team where Liquipedia says so; others keep their listed role,
    then fill the remaining slots. Returns {handle: (primary, secondary, guessed)}."""
    listed = {h: [r for r in (lq.get(h, {}).get('roles') or []) if r in GAME_ROLES] for h in roster}
    out, taken = {}, []
    for role in ('igl', 'awp'):
        # Prefer a player who lists the role first, then anyone who lists it at all.
        for h in sorted(roster, key=lambda h: listed[h].index(role) if role in listed[h] else 99):
            if h not in out and role in listed[h] and role not in taken:
                out[h] = role; taken.append(role); break
    for h in roster:
        if h not in out:
            pick = next((r for r in listed[h] if r not in ('igl', 'awp')), None)
            if pick:
                out[h] = pick
    free = [r for r in ('entry', 'lurker', 'support', 'awp', 'igl') if r not in out.values()]
    guessed = set()
    for h in roster:
        if h not in out:
            out[h] = free.pop(0) if free else 'support'
            guessed.add(h)
    res = {}
    for h in roster:
        sec = next((r for r in listed[h] if r != out[h]), 'support' if out[h] != 'support' else 'entry')
        res[h] = (out[h], sec, h in guessed)
    return res


def main():
    vrs = json.load(open(VRS))
    day = datetime.date.fromisoformat(vrs['standingsDate'])
    lq = {}
    if LQ != '-':
        lq = {p['handle']: p for p in json.load(open(LQ))['players'] if p.get('found')}
    star = stars()
    teams = vrs['teams']
    n = len(teams)
    rows, guessed, no_age, no_country, seen = [], [], [], [], set()
    for t in teams:
        level = LEVEL_HI - (LEVEL_HI - LEVEL_LO) * (t['rank'] - 1) / max(1, n - 1)
        roles = assign_roles(t['roster'], lq)
        for h in t['roster']:
            if h.lower() in seen:
                continue  # a player listed on two rosters keeps the higher-ranked team
            seen.add(h.lower())
            p, s, g = roles[h]
            info = lq.get(h, {})
            rating = round(level + ROLE_OFFSET[p] + (STAR_BONUS if h in star else 0), 3)
            age = age_on(info.get('birthDate'), day)
            cc = iso2(info.get('country'))
            if g: guessed.append(f'{h} ({t["name"]}) -> {p}')
            if age is None: no_age.append(h)
            if cc is None: no_country.append(h)
            rows.append({'rank': 0, 'handle': h, 'primary_role': p, 'secondary_role': s, 'rating': rating,
                         'maps_played': len(t['matches']), 'country': cc or '', 'age': age if age is not None else '',
                         'team': t['name'], 'star': 'yes' if h in star else ''})
    rows.sort(key=lambda r: -r['rating'])
    for i, r in enumerate(rows, 1):
        r['rank'] = i
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    by_role = {r: sum(x['primary_role'] == r for x in rows) for r in GAME_ROLES}
    print(f'{len(rows)} players -> {OUT}; roles {by_role}; stars {sum(x["star"] == "yes" for x in rows)}')
    print(f'role guessed: {len(guessed)}, no age: {len(no_age)}, no country: {len(no_country)}')
    for g in guessed[:400]:
        print('  guessed:', g)
    unknown_stars = star - {r['handle'] for r in rows}
    if unknown_stars:
        print('  stars not on any roster:', ', '.join(sorted(unknown_stars)))


main()
