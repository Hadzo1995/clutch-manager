# Player database

How the real-player data is put together, what the game uses it for, and how to change it.

## Sources of truth

| What | File | Made by | Shown in game |
|---|---|---|---|
| Players: handle, roles, country, age, team, rank, game rating | `src/engine/data/realPlayers.generated.ts` (CSV) | `embed.py` from Valve standings + Liquipedia | yes |
| Hand-checked corrections (country, notes) | `src/engine/data/playerFixes.ts` | by hand, each with its source | yes |
| Teams: name, tag, colours | `src/engine/data/realTeams.ts` | by hand | yes |
| Team logos | `src/ui/teamLogos.generated.ts` | `logos.py` (Liquipedia API) | yes |
| HLTV stats: Overall, Entry, Sniping, Flash | `src/engine/data/hltvStats.generated.ts` | `hltv.py` from pages saved by hand | **no**, reference only |
| Player photos | `public/players/<id>.jpg` + `src/engine/data/playerPhotos.generated.ts` | `photos.py` (Liquipedia API) | yes |

## Identity

- Every player's id is `pro-<handle lower-cased, other characters as dashes>` (`realPlayers.ts`).
  Cards, cases, photos, HLTV lines and saves all use this id; display names are never keys.
- HLTV rows are tied to HLTV's numeric player id. A row joins a player only when the handle
  matches and appears once on the page. Team differences are written to `HLTV_IMPORT.md`.
- A Liquipedia page (for photos) is used only when its infobox team matches ours, or is a
  known rename of it (`TEAM_ALIASES` in `photos.py`). Anything else goes to `PHOTOS_REPORT.md`.

## What the game does with it

1. **Tier** (`ratings.ts`, `assignTiers`): within each role, players with big-event HLTV numbers
   rank by HLTV rating (small samples pulled toward 1.00), then everyone else by game rating.
   Per role: S+++ 1, S++ 2, S+ 4, S 8, A 16, the rest B.
2. **Start OVR and cap**: the tier sets where a card starts and the hard cap training can reach
   (S+++ 100, S++ 97, S+ 94, S 91, A 87, B 83).
3. **Skills**: HLTV's Entry and Flash scores and sniper kill share shape the entry, utility and
   AWP skills (blended with the rating-based value).
4. **Rarity** follows tier: Legend = S+++/S++, Elite = S+, Gold = S, Silver = A, Bronze = B.
5. **Cases** (`cases.ts`): each case sets a chance per rarity; `caseTable()` turns it into exact
   per-player odds (equal within a rarity). The case screen shows that table and `rollPlayer()`
   draws from it.

## Changing things

- **Fix one player's country**: add a line to `playerFixes.ts` with the source.
- **Move a player to another tier**: add them to `TIER_OVERRIDES` in `ratings.ts`.
- **New HLTV pages**: save the four pages with the same filters, then
  `python tools/realdata/hltv.py --overall=... --entry=... --sniping=... --flash=... --label="..." --report=HLTV_IMPORT.md`.
- **Photos**: `python tools/realdata/photos.py <data dir with raw/*.json>`; to add one by hand, put
  `public/players/<id>.jpg` in place and add its line to `playerPhotos.generated.ts`.
- **New players or a new standings snapshot**: re-run the standings + Liquipedia pipeline
  (`README.md` in this folder), then the HLTV and photo scripts. `tests/database.test.ts`
  checks that everything still lines up.
