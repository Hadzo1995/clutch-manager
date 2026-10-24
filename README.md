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

## Closed beta

`supabase/beta.sql` turns on an invite-only beta: while its `beta_settings` row exists, the game
asks for a sign-in and an invite code (each code works once, 50 players at most) and only opens
between the beta's start and end dates. Online play (tournaments, PvP) is refused by the database
for anyone without a beta place. In the SQL editor:

    select code from public.beta_make_invites(50);   -- make invite codes
    select * from public.beta_roster;                -- who joined, last day played
    select * from public.beta_daily;                 -- players per day
    select * from public.beta_surveys;               -- week-2 and final survey answers
    update public.beta_settings set ends_at = ends_at + interval '7 days';  -- extend
    update public.beta_settings set gate = false;    -- open the game to everyone

The career itself runs in the browser, so the gate keeps out people without a code but can't stop
someone determined to edit the page; everything online is enforced by the database.
