# Clutch Manager

A free, non-commercial Counter-Strike 2 esports manager game that runs in the browser.
Build a roster from cases, train it, win the veto and climb four divisions, or play the
beta tournament against friends (four managers, seven days, three matches a night).

Not affiliated with or endorsed by Valve, HLTV or any team or player. Player data from
Liquipedia (CC BY-SA 3.0); see the in-game credits.

## Play

The live build is on GitHub Pages: https://hadzo1995.github.io/clutch-manager/ (updated on every push
to `main`). To run it yourself, `npm ci && npm run build`, then open `dist/index.html` in a browser;
it is one self-contained file and works offline. Saves live in the browser (Settings → Export save
to back one up).

**The calendar.** Season 1 of a new career kicks off on Tuesday 1 December 2026 and every game
week is one calendar week: seven Bo1 league rounds (1 Dec – 12 Jan), Bo3 playoffs for the top four,
the cup in weeks 10–12 (final 16 Feb 2027), then a two-week off-season. Season 2 starts 9 March
2027. The dates are in-game; they move on when you play a week, not with the real clock
(`src/engine/calendar.ts`). New beta tournaments default their Day 1 to 1 December 2026.

## Develop

    npm ci
    npm run dev      # local game; online features need .env.local with the Supabase values
    npm test         # full suite (several minutes)
    npm run build    # single-file build in dist/

Pushes to `main` deploy to GitHub Pages (`.github/workflows/pages.yml`).
The database schema and rules are in `supabase/schema.sql`; `tools/db-test` checks the rules
against a local Postgres.
