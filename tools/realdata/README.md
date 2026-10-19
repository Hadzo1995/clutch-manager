# Real player data (decision D4)

Built 2026-10-17 from Valve's standings of 2026-10-05.

| Step | Script | Output |
|---|---|---|
| 1. Valve rankings, rosters, results | `vrs.py <cloned repo> vrs-DATE.json 64` | `vrs-2026-10-05.json` (64 teams, 320 players) |
| 2. Liquipedia pages (run on Amar's PC; the cloud IP is rate-blocked) | `pc-fetch/RUN-ME.bat` → `raw/batchNN.json` | `liquipedia-raw-2026-10-17/` |
| 3. Roles, countries, ages | `liquipedia.py vrs-DATE.json players-liquipedia.json --raw=<dir>` | `players-liquipedia.json` (312/320 found) |
| 4. Our ratings → game CSV | `build_csv.py vrs-DATE.json players-liquipedia.json stars.md players-DATE.csv` | `players-2026-10-05.csv` |

The game's own importer (Settings → Import your own stats) accepts `players-2026-10-05.csv`: 320 players, 0 errors (checked with `importCsv` in a vitest run).

Notes
- Ratings are ours: team level from Valve rank (0.90–1.12) + role offset + 0.06 for stars in `stars.md`. No HLTV data.
- Liquipedia lists most players only as "rifler", so 156 entry/lurker/support slots are filled in by roster order; IGL and AWP come from Liquipedia where listed.
- 8 players have no Liquipedia page match (MATYS, Lucky, fEAR, Sonic, Rkzinho, Tatu, tyr1k, z4KR); 11 have no age, 9 no country.
- Liquipedia content is CC BY-SA 3.0: the game must credit Liquipedia, and this derived data stays under the same licence.

## Monthly refresh
1. `git clone --depth 1 https://github.com/ValveSoftware/counter-strike_regional_standings vrs-repo` and `python3 vrs.py vrs-repo vrs-DATE.json 64`.
2. `python3 pc-fetch/make_titles.py vrs-DATE.json pc-fetch/titles.txt`, and run `pc-fetch/RUN-ME.bat` on a home PC (Liquipedia blocks cloud IPs); then `liquipedia.py ... --raw=<raw folder>`.
3. `build_csv.py`, then `embed.py players-DATE.csv DATE`, run the tests, build and republish.
