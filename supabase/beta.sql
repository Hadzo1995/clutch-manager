-- Clutch Manager closed beta: invite codes, a player cap, the beta window, activity and surveys.
-- Additive: it creates only beta_* objects and adds "must be a beta player" rules on top of the
-- tournament and PvP tables (schema.sql and pvp.sql stay as they are).
-- Run once in the Supabase dashboard after schema.sql (and pvp.sql if you use it):
-- SQL Editor -> New query -> paste this file -> Run. Safe to run again.
--
-- How the beta works:
--   * The game asks beta_status() on start. While a beta_settings row exists, the game is gated:
--     only signed-in accounts that redeemed an invite code, inside the beta window, get in.
--     Delete the row (or set gate = false) and the game is open to everyone again.
--   * Each invite code works once. The beta stops taking players at max_players (50), even if
--     more codes exist.
--   * Creating tournaments, taking seats, sending lineups and creating or joining PvP rooms need a
--     beta place, checked by the database, not by the game.
--   * Each player's career is saved online (beta_saves), so it follows them between devices.
--   * One ladder for all beta players (ladder_players, ladder_matches); see the ladder section.
--   * The game records one row per player per day they play (beta_days), for daily players and
--     retention, and stores the week-2 and final surveys (beta_surveys). Players cannot read
--     other players' rows.
--
-- Admin (SQL Editor only; none of these can be called from the game):
--   select * from public.beta_make_invites(50);            -- make codes, optionally with a label: beta_make_invites(1, 'Sam')
--   select * from public.beta_roster;                      -- who joined, with which code, last day played
--   select * from public.beta_daily;                       -- players per day
--   select * from public.beta_surveys order by created_at; -- survey answers
--   update public.beta_settings set ends_at = ends_at + interval '7 days'; -- extend the beta
--   select * from public.ladder_add_bots(20);              -- bot teams on the ladder (testing)
--   update public.beta_settings set starts_at = now();     -- test run: open now for code holders
--   select public.beta_reset_ladder();                     -- wipe the test run (removes bots, resets ratings)

create table if not exists public.beta_settings (
  id boolean primary key default true check (id),  -- a single row
  gate boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_players int not null default 50 check (max_players > 0),
  check (ends_at > starts_at)
);

create table if not exists public.beta_invites (
  code text primary key check (code ~ '^CM-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  label text,
  claimed_by uuid unique references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.beta_failed_codes (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists beta_failed_codes_u on public.beta_failed_codes (user_id, at);

create table if not exists public.beta_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  sessions int not null default 1,
  primary key (user_id, day)
);

create table if not exists public.beta_surveys (
  user_id uuid not null references auth.users (id) on delete cascade,
  survey text not null check (survey in ('week2', 'final')),
  answers jsonb not null check (pg_column_size(answers) < 8000),
  created_at timestamptz not null default now(),
  primary key (user_id, survey)
);

alter table public.beta_settings enable row level security;
alter table public.beta_invites enable row level security;
alter table public.beta_failed_codes enable row level security;
alter table public.beta_days enable row level security;
alter table public.beta_surveys enable row level security;
-- No policies on settings, invites, failed codes or days: the game reaches them only through the functions below.

-- True when the beta gate is off, or the account holds a beta place and the beta is running.
create or replace function public.beta_member(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.beta_settings where gate) then true
    when uid is null then false
    else exists (select 1 from public.beta_invites where claimed_by = uid)
      and exists (select 1 from public.beta_settings where now() >= starts_at and now() < ends_at)
  end
$$;
revoke all on function public.beta_member(uuid) from public;
grant execute on function public.beta_member(uuid) to anon, authenticated;

-- Each player writes and reads only their own surveys.
drop policy if exists bs_insert on public.beta_surveys;
create policy bs_insert on public.beta_surveys for insert to authenticated with check (user_id = auth.uid() and public.beta_member(auth.uid()));
drop policy if exists bs_read on public.beta_surveys;
create policy bs_read on public.beta_surveys for select to authenticated using (user_id = auth.uid());

-- What the game needs to decide which screen to show. Works signed out too (member is then false).
create or replace function public.beta_status() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'gate', s.gate,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
      'max_players', s.max_players,
      'players', (select count(*) from public.beta_invites where claimed_by is not null),
      'invited', exists (select 1 from public.beta_invites where claimed_by = auth.uid()),
      'now', now())
    from public.beta_settings s), jsonb_build_object('gate', false, 'now', now()))
$$;
revoke all on function public.beta_status() from public;
grant execute on function public.beta_status() to anon, authenticated;

-- Redeems an invite code for the signed-in account. Returns 'ok' or raises a message the game shows as is.
create or replace function public.beta_redeem(invite text) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c text := upper(regexp_replace(coalesce(invite, ''), '[^A-Za-z0-9]', '', 'g'));
  s public.beta_settings;
  inv public.beta_invites;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.beta_invites where claimed_by = uid) then return 'ok'; end if;
  select * into s from public.beta_settings;
  if s is null then return 'ok'; end if;
  if now() >= s.ends_at then raise exception 'The closed beta has ended. Thanks for your interest!'; end if;
  if (select count(*) from public.beta_failed_codes where user_id = uid and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  -- One redeem at a time, so the cap can't be passed by two players at once.
  perform pg_advisory_xact_lock(hashtext('beta_redeem'));
  if length(c) = 10 and left(c, 2) = 'CM' then c := 'CM-' || substr(c, 3, 4) || '-' || substr(c, 7, 4); end if;
  select * into inv from public.beta_invites where code = c for update;
  if inv is null then
    insert into public.beta_failed_codes (user_id) values (uid);
    return 'That invite code doesn’t exist. Check it and try again.';
  end if;
  if inv.claimed_by is not null then raise exception 'That invite code was already used by another account.'; end if;
  if (select count(*) from public.beta_invites where claimed_by is not null) >= s.max_players then
    raise exception 'The closed beta is full.';
  end if;
  update public.beta_invites set claimed_by = uid, claimed_at = now() where code = c;
  return 'ok';
end $$;
revoke all on function public.beta_redeem(text) from public;
grant execute on function public.beta_redeem(text) to authenticated;

-- Counts one play session for today (the database's day, UTC).
create or replace function public.beta_ping() returns void language sql security definer set search_path = public as $$
  insert into public.beta_days (user_id, day) select auth.uid(), current_date where auth.uid() is not null
  on conflict (user_id, day) do update set sessions = public.beta_days.sessions + 1
$$;
revoke all on function public.beta_ping() from public;
grant execute on function public.beta_ping() to authenticated;

-- Makes n new invite codes like CM-7KQ2-XP9D (no 0/O or 1/I/L, so they're easy to read out).
create or replace function public.beta_make_invites(n int, who text default null) returns setof public.beta_invites
language plpgsql set search_path = public as $$
declare
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea; c text; made int := 0;
begin
  while made < n loop
    b := decode(md5(gen_random_uuid()::text), 'hex');
    c := 'CM-';
    for i in 0..7 loop
      c := c || substr(abc, 1 + get_byte(b, i) % length(abc), 1);
      if i = 3 then c := c || '-'; end if;
    end loop;
    begin
      return query insert into public.beta_invites (code, label) values (c, who) returning *;
      made := made + 1;
    exception when unique_violation then null; end;
  end loop;
end $$;
revoke all on function public.beta_make_invites(int, text) from public, anon, authenticated;

-- Dashboard views (owner only: the game's roles cannot read them).
create or replace view public.beta_roster as
  select i.code, i.label, u.email, i.claimed_at,
    (select max(day) from public.beta_days d where d.user_id = i.claimed_by) as last_played,
    (select count(*) from public.beta_days d where d.user_id = i.claimed_by) as days_played
  from public.beta_invites i left join auth.users u on u.id = i.claimed_by
  order by i.claimed_at nulls last, i.created_at;
create or replace view public.beta_daily as
  select day, count(*) as players, sum(sessions) as sessions from public.beta_days group by day order by day;
revoke all on public.beta_roster, public.beta_daily from anon, authenticated;

-- The online parts need a beta place too. Restrictive policies are added on top of the existing
-- ones, so they only ever take rights away. Tables from pvp.sql are skipped if it wasn't run.
do $$
declare t text;
begin
  foreach t in array array['tournaments', 'tournament_seats', 'tournament_entries', 'tournament_results', 'tournament_flags', 'tournament_clubs', 'pvp_rooms', 'pvp_seats'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists beta_only on public.%I', t);
      execute format('create policy beta_only on public.%I as restrictive for insert to authenticated with check (public.beta_member(auth.uid()))', t);
    end if;
  end loop;
end $$;
-- pvp_claim_guest is a function that bypasses row rules, so it checks the beta place itself.
do $$
begin
  if to_regprocedure('public.pvp_claim_guest(text)') is not null and to_regprocedure('public.pvp_claim_guest_open(text)') is null then
    alter function public.pvp_claim_guest(text) rename to pvp_claim_guest_open;
    revoke all on function public.pvp_claim_guest_open(text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.pvp_claim_guest_open(text)') is not null then
    execute $f$
      create or replace function public.pvp_claim_guest(p_code text) returns boolean language plpgsql security definer set search_path = public as $b$
      begin
        if not public.beta_member(auth.uid()) then raise exception 'PvP is for closed beta players only.'; end if;
        return public.pvp_claim_guest_open(p_code);
      end $b$;
    $f$;
    revoke all on function public.pvp_claim_guest(text) from public;
    grant execute on function public.pvp_claim_guest(text) to authenticated;
  end if;
end $$;

-- ------------------------------------------------------------------ cloud saves
-- Each beta player's career, so it follows them between devices. Only they can read or write it.
create table if not exists public.beta_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null check (char_length(data) < 5000000),
  saved_at timestamptz not null,  -- when the game saved it (from the save file), to pick the newer copy
  updated_at timestamptz not null default now()
);
alter table public.beta_saves enable row level security;
drop policy if exists sv_own on public.beta_saves;
create policy sv_own on public.beta_saves for select to authenticated using (user_id = auth.uid());
drop policy if exists sv_insert on public.beta_saves;
create policy sv_insert on public.beta_saves for insert to authenticated with check (user_id = auth.uid() and public.beta_member(auth.uid()));
drop policy if exists sv_update on public.beta_saves;
create policy sv_update on public.beta_saves for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.beta_member(auth.uid()));
drop policy if exists sv_delete on public.beta_saves;
create policy sv_delete on public.beta_saves for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------ ladder
-- One month-long ranking for every beta player. A challenge plays your career team against the
-- other manager's published team, in your browser, from a seed the database picks. The challenge
-- counts as a loss the moment it starts and turns into a win only when you report one, so closing
-- the page on a losing match doesn't help. Every match keeps both teams and the seed, so anyone can
-- re-run it and get the same result.
create table if not exists public.ladder_players (
  id text primary key check (id ~ '^(u-[0-9a-f-]{36}|bot-[0-9]+)$'),
  user_id uuid unique references auth.users (id) on delete cascade,
  bot_slot int unique,
  manager text not null check (char_length(manager) between 1 and 24),
  team text not null check (char_length(team) between 1 and 22),
  tag text not null check (tag ~ '^[A-Z0-9]{2,4}$'),
  rating int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  snapshot jsonb check (pg_column_size(snapshot) < 200000),
  updated_at timestamptz not null default now(),
  check ((user_id is null) <> (bot_slot is null))
);

create table if not exists public.ladder_matches (
  id bigint generated always as identity primary key,
  challenger text not null references public.ladder_players (id) on delete cascade,
  defender text not null references public.ladder_players (id) on delete cascade,
  seed int not null,
  challenger_team jsonb not null,
  defender_team jsonb,  -- a bot's team is built by the challenger's game and stored with the report
  status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  expected real not null,
  delta int not null,  -- rating points the challenger has gained so far (negative while it counts as a loss)
  summary jsonb check (pg_column_size(summary) < 20000),
  result_hash text,
  created_at timestamptz not null default now(),
  reported_at timestamptz
);
create index if not exists ladder_matches_c on public.ladder_matches (challenger, created_at);
create index if not exists ladder_matches_d on public.ladder_matches (defender, created_at);

alter table public.ladder_players enable row level security;
alter table public.ladder_matches enable row level security;
-- Beta players read the ladder; every change goes through the functions below.
drop policy if exists lp_read on public.ladder_players;
create policy lp_read on public.ladder_players for select to authenticated using (public.beta_member(auth.uid()));
drop policy if exists lm_read on public.ladder_matches;
create policy lm_read on public.ladder_matches for select to authenticated using (public.beta_member(auth.uid()));

-- Join the ladder, or update your name and published team.
create or replace function public.ladder_join(manager text, team text, tag text, snapshot jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me text := 'u-' || auth.uid()::text;
begin
  if uid is null or not public.beta_member(uid) then raise exception 'The ladder is for closed beta players only.'; end if;
  if snapshot is null or jsonb_typeof(snapshot) <> 'object' or jsonb_array_length(snapshot->'players') <> 5 then raise exception 'Your team needs five players.'; end if;
  insert into public.ladder_players (id, user_id, manager, team, tag, snapshot)
    values (me, uid, left(trim(manager), 24), left(trim(team), 22), upper(left(tag, 4)), snapshot)
    on conflict (id) do update set manager = excluded.manager, team = excluded.team, tag = excluded.tag, snapshot = excluded.snapshot, updated_at = now();
  return me;
end $$;
revoke all on function public.ladder_join(text, text, text, jsonb) from public;
grant execute on function public.ladder_join(text, text, text, jsonb) to authenticated;

-- Start a challenge. Returns the seed and the defender's team (null for a bot).
create or replace function public.ladder_challenge(opponent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); me text := 'u-' || auth.uid()::text;
  c public.ladder_players; d public.ladder_players;
  e real; loss int; m public.ladder_matches;
begin
  if uid is null or not public.beta_member(uid) then raise exception 'The ladder is for closed beta players only.'; end if;
  -- Lock both rows in a fixed order so two challenges at once can't tangle the ratings.
  perform 1 from public.ladder_players where id in (me, opponent) order by id for update;
  select * into c from public.ladder_players where id = me;
  select * into d from public.ladder_players where id = opponent;
  if c is null or c.snapshot is null then raise exception 'Join the ladder with your team first.'; end if;
  if d is null then raise exception 'That manager isn’t on the ladder.'; end if;
  if d.id = me then raise exception 'You can’t challenge yourself.'; end if;
  if d.bot_slot is null and d.snapshot is null then raise exception 'That manager hasn’t published a team yet.'; end if;
  if (select count(*) from public.ladder_matches where challenger = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That’s 10 challenges in the last 24 hours. Your next one opens up later.';
  end if;
  if (select count(*) from public.ladder_matches where challenger = me and defender = opponent and created_at > now() - interval '1 day') >= 2 then
    raise exception 'You’ve challenged this team twice in the last 24 hours. Pick another opponent.';
  end if;
  e := 1.0 / (1.0 + power(10.0, (d.rating - c.rating) / 400.0));
  loss := -greatest(1, round(32 * e)::int);
  update public.ladder_players set rating = rating + loss, losses = losses + 1 where id = me;
  update public.ladder_players set rating = rating - loss, wins = wins + 1 where id = opponent;
  insert into public.ladder_matches (challenger, defender, seed, challenger_team, defender_team, expected, delta)
    values (me, opponent, 1 + floor(random() * 2147483646)::int, c.snapshot, d.snapshot, e, loss)
    returning * into m;
  return jsonb_build_object('id', m.id, 'seed', m.seed, 'defender_team', d.snapshot, 'bot_slot', d.bot_slot, 'expected', e);
end $$;
revoke all on function public.ladder_challenge(text) from public;
grant execute on function public.ladder_challenge(text) to authenticated;

-- Report the result of your own challenge, within 15 minutes of starting it. Returns the challenger's rating change.
create or replace function public.ladder_report(match_id bigint, won boolean, summary jsonb, result_hash text, defender_team jsonb default null) returns int
language plpgsql security definer set search_path = public as $$
declare me text := 'u-' || auth.uid()::text; m public.ladder_matches; win int; fix int;
begin
  select * into m from public.ladder_matches where id = match_id and challenger = me for update;
  if m is null then raise exception 'No such challenge.'; end if;
  if m.status <> 'pending' then return m.delta; end if;
  if m.created_at < now() - interval '15 minutes' then
    -- Too late: it stays a loss (the game sees a negative number back after reporting a win).
    update public.ladder_matches set status = 'lost', reported_at = now() where id = match_id;
    return m.delta;
  end if;
  win := 0;
  if won then
    win := greatest(1, round(32 * (1 - m.expected))::int);
    fix := win - m.delta;
    perform 1 from public.ladder_players where id in (m.challenger, m.defender) order by id for update;
    update public.ladder_players set rating = rating + fix, wins = wins + 1, losses = losses - 1 where id = m.challenger;
    update public.ladder_players set rating = rating - fix, wins = wins - 1, losses = losses + 1 where id = m.defender;
  end if;
  update public.ladder_matches set status = case when won then 'won' else 'lost' end, delta = case when won then win else m.delta end,
    summary = ladder_report.summary, result_hash = ladder_report.result_hash,
    defender_team = coalesce(m.defender_team, ladder_report.defender_team), reported_at = now()
  where id = match_id;
  return case when won then win else m.delta end;
end $$;
revoke all on function public.ladder_report(bigint, boolean, jsonb, text, jsonb) from public;
grant execute on function public.ladder_report(bigint, boolean, jsonb, text, jsonb) to authenticated;

-- Admin: add n bot teams to the ladder (for testing, or to give early players opponents).
-- Bots play the strength of an AI team from the challenger's own league. Remove them with
-- delete from public.ladder_players where bot_slot is not null;
create or replace function public.ladder_add_bots(n int) returns setof public.ladder_players
language plpgsql set search_path = public as $$
declare
  names constant text[] := array['Iron Wolves','Night Owls','Red Comets','Static Five','Blue Vipers','Desert Kings','Neon Riders','Frost Bite','Ghost Unit','Steel Hearts','Black Swans','Rapid Fire','Lone Pines','Echo Squad','Crimson Tide','Silent Storm','High Ground','Last Light','Zero Hour','Wild Cards'];
  first int := coalesce((select max(bot_slot) from public.ladder_players), -1) + 1;
  nm text;
begin
  for i in first .. first + n - 1 loop
    nm := names[1 + i % array_length(names, 1)] || case when i >= array_length(names, 1) then ' ' || (1 + i / array_length(names, 1))::text else '' end;
    return query insert into public.ladder_players (id, bot_slot, manager, team, tag, rating)
      values ('bot-' || i, i, 'Bot', left(nm, 22), upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), 900 + (i * 37) % 200)
      returning *;
  end loop;
end $$;
revoke all on function public.ladder_add_bots(int) from public, anon, authenticated;

-- Admin: wipe the test run before the real start (keeps invites, accounts and saves).
-- select public.beta_reset_ladder();
create or replace function public.beta_reset_ladder() returns void language sql set search_path = public as $$
  delete from public.ladder_matches;
  delete from public.ladder_players where bot_slot is not null;
  update public.ladder_players set rating = 1000, wins = 0, losses = 0;
$$;
revoke all on function public.beta_reset_ladder() from public, anon, authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.ladder_players; exception when others then null; end;
end $$;

-- The beta window. Edit the two dates before running if they've changed; running again keeps
-- any dates you already set (change them with the update in the admin notes above).
insert into public.beta_settings (starts_at, ends_at, max_players)
  values ('2026-11-02 00:00 Europe/Sarajevo', '2026-12-03 00:00 Europe/Sarajevo', 50)
  on conflict (id) do nothing;
