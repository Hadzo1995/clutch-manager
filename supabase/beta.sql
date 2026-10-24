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

-- The beta window. Edit the two dates before running if they've changed; running again keeps
-- any dates you already set (change them with the update in the admin notes above).
insert into public.beta_settings (starts_at, ends_at, max_players)
  values ('2026-11-02 00:00 Europe/Sarajevo', '2026-12-03 00:00 Europe/Sarajevo', 50)
  on conflict (id) do nothing;
