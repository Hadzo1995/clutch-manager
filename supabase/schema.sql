-- Clutch Manager online backend (Supabase / Postgres).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: it only creates what is missing and replaces the policies and functions.
--
-- Who can do what (enforced by row level security, not by the game):
--   * Everyone signed in reads tournaments and seats.
--   * A manager takes a seat only for themselves, and only before the first kickoff.
--   * A manager writes entries (lineup + map preferences) only for their own seat, and only
--     before that entry's kickoff (checked against the database clock, not the player's).
--   * Nobody can read another manager's entry until its kickoff has passed.
--   * Each manager's club save is private to them.
--   * The first stored result for a match is final; every browser checks it and can flag it.
--   * Contact messages can be sent by anyone and read by nobody through the game
--     (only in the dashboard, or through take_contact_messages with the private token).

create table if not exists public.tournaments (
  id text primary key check (id ~ '^T[A-Z0-9]{5}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  first_kickoff timestamptz not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_seats (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid not null references auth.users (id) on delete cascade,
  info jsonb not null,
  joined_at timestamptz not null default now(),
  primary key (tournament_id, seat),
  unique (tournament_id, user_id)
);

create table if not exists public.tournament_entries (
  id bigint generated always as identity primary key,
  tournament_id text not null references public.tournaments (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot int not null check (slot >= 0),
  kickoff_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists tournament_entries_t on public.tournament_entries (tournament_id, seat, slot);

create table if not exists public.tournament_results (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  match_id text not null,
  data jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tournament_id, match_id)
);

create table if not exists public.tournament_flags (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  match_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  agrees boolean not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, match_id, user_id)
);

-- Each manager's own tournament club, so it follows them between devices. Only they can read it.
create table if not exists public.tournament_clubs (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  topic text not null check (topic in ('removal', 'bug', 'feedback', 'other')),
  body text not null check (char_length(body) between 5 and 2000),
  reply_to text check (char_length(reply_to) <= 200),
  created_at timestamptz not null default now(),
  forwarded_at timestamptz
);

create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);

-- The database clock decides submission time; a manager cannot backdate an entry.
create or replace function public.entries_stamp() returns trigger language plpgsql as $$
begin
  new.submitted_at := now();
  if new.kickoff_at <= now() then
    raise exception 'This kickoff has already started.';
  end if;
  return new;
end $$;
drop trigger if exists entries_stamp on public.tournament_entries;
create trigger entries_stamp before insert on public.tournament_entries for each row execute function public.entries_stamp();

create or replace function public.seats_stamp() returns trigger language plpgsql as $$
begin
  new.joined_at := now();
  if (select first_kickoff from public.tournaments where id = new.tournament_id) <= now() then
    raise exception 'The tournament has already started.';
  end if;
  return new;
end $$;
drop trigger if exists seats_stamp on public.tournament_seats;
create trigger seats_stamp before insert on public.tournament_seats for each row execute function public.seats_stamp();

create or replace function public.messages_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.forwarded_at := null;
  new.user_id := auth.uid();
  -- A simple flood guard: the game is small, so more than 30 messages an hour means something is wrong.
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many messages right now. Please try again later.';
  end if;
  return new;
end $$;
drop trigger if exists messages_stamp on public.contact_messages;
create trigger messages_stamp before insert on public.contact_messages for each row execute function public.messages_stamp();

alter table public.tournaments enable row level security;
alter table public.tournament_seats enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_results enable row level security;
alter table public.tournament_flags enable row level security;
alter table public.tournament_clubs enable row level security;
alter table public.contact_messages enable row level security;
alter table public.app_secrets enable row level security; -- no policies: unreadable from the game

drop policy if exists t_read on public.tournaments;
create policy t_read on public.tournaments for select to authenticated using (true);
drop policy if exists t_insert on public.tournaments;
create policy t_insert on public.tournaments for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists t_update on public.tournaments;
-- The owner can change the tournament (name, start date) only until it starts.
create policy t_update on public.tournaments for update to authenticated using (owner_id = auth.uid() and first_kickoff > now()) with check (owner_id = auth.uid());

drop policy if exists s_read on public.tournament_seats;
create policy s_read on public.tournament_seats for select to authenticated using (true);
drop policy if exists s_insert on public.tournament_seats;
create policy s_insert on public.tournament_seats for insert to authenticated with check (user_id = auth.uid());
drop policy if exists s_update on public.tournament_seats; -- seats are not edited once taken

drop policy if exists e_read on public.tournament_entries;
create policy e_read on public.tournament_entries for select to authenticated using (user_id = auth.uid() or kickoff_at <= now());
drop policy if exists e_insert on public.tournament_entries;
create policy e_insert on public.tournament_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.tournament_seats s where s.tournament_id = tournament_entries.tournament_id and s.seat = tournament_entries.seat and s.user_id = auth.uid())
);

drop policy if exists r_read on public.tournament_results;
create policy r_read on public.tournament_results for select to authenticated using (true);
drop policy if exists r_insert on public.tournament_results;
create policy r_insert on public.tournament_results for insert to authenticated with check (
  created_by = auth.uid()
  and exists (select 1 from public.tournament_seats s where s.tournament_id = tournament_results.tournament_id and s.user_id = auth.uid())
);

drop policy if exists f_read on public.tournament_flags;
create policy f_read on public.tournament_flags for select to authenticated using (true);
drop policy if exists f_write on public.tournament_flags;
create policy f_write on public.tournament_flags for insert to authenticated with check (user_id = auth.uid());

drop policy if exists c_own on public.tournament_clubs;
create policy c_own on public.tournament_clubs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists m_insert on public.contact_messages;
create policy m_insert on public.contact_messages for insert to anon, authenticated with check (true);

-- Lets a scheduled job forward new contact messages by email without any key in the game.
-- Set the token once in the SQL editor:  insert into public.app_secrets values ('contact_token', '<long random text>');
create or replace function public.take_contact_messages(token text)
returns setof public.contact_messages language plpgsql security definer set search_path = public as $$
begin
  if token is null or token <> (select value from public.app_secrets where name = 'contact_token') then
    raise exception 'not allowed';
  end if;
  return query
    update public.contact_messages set forwarded_at = now()
    where forwarded_at is null
    returning *;
end $$;
revoke all on function public.take_contact_messages(text) from public;
grant execute on function public.take_contact_messages(text) to anon, authenticated;

-- The game asks for the database clock, so a device whose clock is off still sends lineups on time.
create or replace function public.server_time() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_time() to anon, authenticated;

-- Live updates for the tournament screens.
do $$ begin
  begin alter publication supabase_realtime add table public.tournament_seats; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tournament_results; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tournaments; exception when others then null; end;
end $$;
