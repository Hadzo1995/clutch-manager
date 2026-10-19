# Clutch Manager

A free, non-commercial Counter-Strike 2 esports manager game that runs in the browser.
Build a roster from cases, train it, win the veto and climb four divisions, or play the
beta tournament against friends (four managers, seven days, three matches a night).

Not affiliated with or endorsed by Valve, HLTV or any team or player. Player data from
Liquipedia (CC BY-SA 3.0); see the in-game credits.

## Develop

    npm ci
    npm run dev      # local game; online features need .env.local with the Supabase values
    npm test         # full suite (several minutes)
    npm run build    # single-file build in dist/

Pushes to `main` deploy to GitHub Pages (`.github/workflows/pages.yml`).
The database schema and rules are in `supabase/schema.sql`; `tools/db-test` checks the rules
against a local Postgres.
