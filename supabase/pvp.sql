-- Clutch Manager 1-on-1 PvP rooms (Supabase / Postgres). Additive: it creates only pvp_* objects
-- and leaves the tournament tables in schema.sql alone.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again.
--
-- Who can do what (enforced by row level security):
--   * Everyone signed in can read rooms and seats (a room is found by its six-character code).
--   * Anyone signed in creates a room as its host.
--   * The guest seat is claimed through pvp_claim_guest, so two people can't both take it.
--   * Only the room's two managers change the room, and only through pvp_patch (a merge into its data).
--   * Each manager writes only their own seat (their locked team and ready flag).

create table if not exists public.pvp_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users (id) on delete cascade,
  guest_id uuid references auth.users (id) on delete set null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pvp_rooms_host on public.pvp_rooms (host_id);
create index if not exists pvp_rooms_guest on public.pvp_rooms (guest_id);

create table if not exists public.pvp_seats (
  code text not null references public.pvp_rooms (code) on delete cascade,
  side text not null check (side in ('host', 'guest')),
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (code, side)
);

alter table public.pvp_rooms enable row level security;
alter table public.pvp_seats enable row level security;

-- Rooms: read by anyone signed in; created by the host; changed only through the functions below.
drop policy if exists pr_read on public.pvp_rooms;
create policy pr_read on public.pvp_rooms for select to authenticated using (true);
drop policy if exists pr_insert on public.pvp_rooms;
create policy pr_insert on public.pvp_rooms for insert to authenticated with check (host_id = auth.uid() and guest_id is null);
drop policy if exists pr_update on public.pvp_rooms;
create policy pr_update on public.pvp_rooms for update to authenticated
  using (auth.uid() = host_id or auth.uid() = guest_id) with check (auth.uid() = host_id or auth.uid() = guest_id);
revoke update on public.pvp_rooms from authenticated, anon;
grant update (data, updated_at) on public.pvp_rooms to authenticated;

-- Seats: each manager writes only the seat that is theirs in that room.
drop policy if exists ps_read on public.pvp_seats;
create policy ps_read on public.pvp_seats for select to authenticated using (true);
drop policy if exists ps_insert on public.pvp_seats;
create policy ps_insert on public.pvp_seats for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.pvp_rooms r where r.code = pvp_seats.code
      and ((pvp_seats.side = 'host' and r.host_id = auth.uid()) or (pvp_seats.side = 'guest' and r.guest_id = auth.uid()))));
drop policy if exists ps_update on public.pvp_seats;
create policy ps_update on public.pvp_seats for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Takes the empty guest seat of a room (or confirms you already have it). Atomic, so only one person gets it.
create or replace function public.pvp_claim_guest(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if auth.uid() is null then return false; end if;
  update public.pvp_rooms set guest_id = auth.uid(), updated_at = now()
    where code = p_code and host_id <> auth.uid() and (guest_id is null or guest_id = auth.uid())
    returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.pvp_claim_guest(text) from public, anon;
grant execute on function public.pvp_claim_guest(text) to authenticated;

-- Merges a patch into a room's data in one step, so two writes never undo each other.
-- Runs as the caller, so the update policy above decides who may do it.
create or replace function public.pvp_patch(p_code text, p_patch jsonb) returns void
language sql security invoker set search_path = public as $$
  update public.pvp_rooms set data = data || p_patch, updated_at = now() where code = p_code;
$$;
revoke all on function public.pvp_patch(text, jsonb) from public, anon;
grant execute on function public.pvp_patch(text, jsonb) to authenticated;
