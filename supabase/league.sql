-- Clutch League (Supabase / Postgres): one online league that runs season after season.
-- Additive: it creates only league_* objects and leaves schema.sql and pvp.sql alone.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again.
--
-- Who can do what (enforced by row level security and triggers, not by the game):
--   * Everyone signed in reads leagues, seats, season line-ups and results.
--   * Anyone signed in creates a league as its owner. The owner can rename it, edit the prize
--     list and raise or lower the seat cap at any time, but never move its calendar
--     (first season, time zone, kickoff time) once season 1 has started.
--   * A manager takes a seat only for themselves, below the league's seat cap, one per league.
--     The database stamps when they joined; a seat plays from the next season not yet started.
--   * Season line-ups (which organisation plays in each free seat) and results are written by
--     seated managers. The first one stored is final; every browser checks it and can flag it.
--   * A manager writes lineups only for their own seat, and only before that lineup's kickoff
--     (checked against the database clock). Nobody reads another manager's lineup before kickoff.
--   * Each manager's club save is private to them.

create table if not exists public.leagues (
  id text primary key check (id ~ '^L[A-Z0-9]{5}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  first_kickoff timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.league_seats (
  league_id text not null references public.leagues (id) on delete cascade,
  slot smallint not null check (slot between 0 and 127),
  user_id uuid not null references auth.users (id) on delete cascade,
  info jsonb not null,
  joined_at timestamptz not null default now(),
  primary key (league_id, slot),
  unique (league_id, user_id)
);

create table if not exists public.league_seasons (
  league_id text not null references public.leagues (id) on delete cascade,
  season int not null check (season >= 1),
  data jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (league_id, season)
);

create table if not exists public.league_entries (
  id bigint generated always as identity primary key,
  league_id text not null references public.leagues (id) on delete cascade,
  slot smallint not null check (slot between 0 and 127),
  user_id uuid not null references auth.users (id) on delete cascade,
  season int not null check (season >= 1),
  day int not null check (day between 1 and 40),
  kickoff_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists league_entries_l on public.league_entries (league_id, season, day);

create table if not exists public.league_results (
  league_id text not null references public.leagues (id) on delete cascade,
  season int not null,
  match_id text not null,
  data jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (league_id, match_id)
);
create index if not exists league_results_s on public.league_results (league_id, season);

create table if not exists public.league_flags (
  league_id text not null references public.leagues (id) on delete cascade,
  match_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  agrees boolean not null,
  created_at timestamptz not null default now(),
  primary key (league_id, match_id, user_id)
);

create table if not exists public.league_clubs (
  league_id text not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- Seats: the database clock stamps the join, and the slot must be below the league's cap.
create or replace function public.league_seats_stamp() returns trigger language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  new.joined_at := now();
  select coalesce((data->>'maxTeams')::int, 50) into cap from public.leagues where id = new.league_id;
  if cap is null then raise exception 'No league with that code.'; end if;
  if (select data->>'state' from public.leagues where id = new.league_id) = 'closed' then raise exception 'This league is closed.'; end if;
  if new.slot >= cap then raise exception 'All seats are taken. Ask the owner to raise the cap.'; end if;
  return new;
end $$;
drop trigger if exists league_seats_stamp on public.league_seats;
create trigger league_seats_stamp before insert on public.league_seats for each row execute function public.league_seats_stamp();

-- Lineups: stamped by the database clock and refused once their kickoff has started.
create or replace function public.league_entries_stamp() returns trigger language plpgsql as $$
begin
  new.submitted_at := now();
  if new.kickoff_at <= now() then raise exception 'This kickoff has already started.'; end if;
  return new;
end $$;
drop trigger if exists league_entries_stamp on public.league_entries;
create trigger league_entries_stamp before insert on public.league_entries for each row execute function public.league_entries_stamp();

-- The owner can't move the calendar once season 1 has started.
create or replace function public.leagues_guard() returns trigger language plpgsql as $$
begin
  if old.first_kickoff <= now() and (
       new.first_kickoff <> old.first_kickoff
    or new.data->>'firstSeasonStart' is distinct from old.data->>'firstSeasonStart'
    or new.data->>'tz' is distinct from old.data->>'tz'
    or new.data->>'kickoff' is distinct from old.data->>'kickoff') then
    raise exception 'The league calendar can''t change once season 1 has started.';
  end if;
  new.owner_id := old.owner_id;
  new.id := old.id;
  return new;
end $$;
drop trigger if exists leagues_guard on public.leagues;
create trigger leagues_guard before update on public.leagues for each row execute function public.leagues_guard();

alter table public.leagues enable row level security;
alter table public.league_seats enable row level security;
alter table public.league_seasons enable row level security;
alter table public.league_entries enable row level security;
alter table public.league_results enable row level security;
alter table public.league_flags enable row level security;
alter table public.league_clubs enable row level security;

create or replace function public.league_member(lid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_seats s where s.league_id = lid and s.user_id = auth.uid())
$$;

drop policy if exists l_read on public.leagues;
create policy l_read on public.leagues for select to authenticated using (true);
drop policy if exists l_insert on public.leagues;
create policy l_insert on public.leagues for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists l_update on public.leagues;
create policy l_update on public.leagues for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists ls_read on public.league_seats;
create policy ls_read on public.league_seats for select to authenticated using (true);
drop policy if exists ls_insert on public.league_seats;
create policy ls_insert on public.league_seats for insert to authenticated with check (user_id = auth.uid());
-- A manager can leave (their seat frees up for the next season not yet started).
drop policy if exists ls_delete on public.league_seats;
create policy ls_delete on public.league_seats for delete to authenticated using (user_id = auth.uid());

drop policy if exists lse_read on public.league_seasons;
create policy lse_read on public.league_seasons for select to authenticated using (true);
drop policy if exists lse_insert on public.league_seasons;
create policy lse_insert on public.league_seasons for insert to authenticated with check (created_by = auth.uid() and public.league_member(league_id));

drop policy if exists le_read on public.league_entries;
create policy le_read on public.league_entries for select to authenticated using (user_id = auth.uid() or kickoff_at <= now());
drop policy if exists le_insert on public.league_entries;
create policy le_insert on public.league_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.league_seats s where s.league_id = league_entries.league_id and s.slot = league_entries.slot and s.user_id = auth.uid())
);

drop policy if exists lr_read on public.league_results;
create policy lr_read on public.league_results for select to authenticated using (true);
drop policy if exists lr_insert on public.league_results;
create policy lr_insert on public.league_results for insert to authenticated with check (created_by = auth.uid() and public.league_member(league_id));

drop policy if exists lf_read on public.league_flags;
create policy lf_read on public.league_flags for select to authenticated using (true);
drop policy if exists lf_write on public.league_flags;
create policy lf_write on public.league_flags for insert to authenticated with check (user_id = auth.uid() and public.league_member(league_id));

drop policy if exists lc_own on public.league_clubs;
create policy lc_own on public.league_clubs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates for the league screens.
do $$ begin
  begin alter publication supabase_realtime add table public.league_seats; exception when others then null; end;
  begin alter publication supabase_realtime add table public.league_results; exception when others then null; end;
  begin alter publication supabase_realtime add table public.league_seasons; exception when others then null; end;
  begin alter publication supabase_realtime add table public.leagues; exception when others then null; end;
end $$;
