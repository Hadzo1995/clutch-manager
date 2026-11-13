#!/bin/bash
# Checks the rules in supabase/league.sql (same setup as rls.sh; see README.md).
P="psql -h /tmp -p 5433 -U postgres -d sb -qtA -v ON_ERROR_STOP=1"
as() { local who=$1; shift; local role=authenticated sub="00000000-0000-0000-0000-00000000000$who"; [ "$who" = anon ] && { role=anon; sub=; }
  $P -c "set role $role; set request.jwt.claim.sub = '$sub'; $*" 2>&1 | sed 's/^psql:.*ERROR: */ERR /' | tr '\n' ' '; echo; }
expect() { local want=$1 label=$2; shift 2; local out; out=$(as "$@"); if [[ "$out" == *"$want"* ]]; then echo "PASS $label"; else echo "FAIL $label -> $out"; fi; }
psql -h /tmp -p 5433 -U postgres -d sb -q -c "set client_min_messages=warning; truncate public.leagues cascade;"
U1=00000000-0000-0000-0000-000000000001
DATA='{"maxTeams":2,"firstSeasonStart":"2030-01-01","tz":"Europe/Berlin","kickoff":"20:00","state":"active"}'
expect "done" "u1 creates league" 1 "insert into public.leagues(id, owner_id, first_kickoff, data) values ('LABCDE', auth.uid(), now() + interval '1 day', '$DATA'); select 'done'"
expect "ERR" "u2 cannot create a league owned by u1" 2 "insert into public.leagues(id, owner_id, first_kickoff, data) values ('LXYZ12', '$U1', now(), '{}')"
expect "ERR" "bad code rejected" 1 "insert into public.leagues(id, owner_id, first_kickoff, data) values ('T12345', auth.uid(), now(), '{}')"
expect "ERR" "anon cannot read leagues" anon "select 1/(select count(*) from public.leagues)"
expect "done" "u1 takes seat 0" 1 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 0, auth.uid(), '{}'); select 'done'"
expect "ERR" "u2 cannot seat u1" 2 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 1, '$U1', '{}')"
expect "ERR" "u1 cannot take a second seat" 1 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 1, auth.uid(), '{}')"
expect "done" "u2 takes seat 1" 2 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 1, auth.uid(), '{}'); select 'done'"
expect "ERR" "u3 is over the cap" 3 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 2, auth.uid(), '{}')"
expect "0" "u2 cannot edit the league" 2 "with x as (update public.leagues set data = data || '{\"name\":\"hack\"}' returning 1) select count(*) from x"
expect "done" "owner raises the cap" 1 "update public.leagues set data = data || '{\"maxTeams\":3}'; select 'done'"
expect "done" "u3 joins under the new cap" 3 "insert into public.league_seats(league_id, slot, user_id, info) values ('LABCDE', 2, auth.uid(), '{}'); select 'done'"
expect "ERR" "u4 cannot write a season (not a member)" 4 "insert into public.league_seasons values ('LABCDE', 1, '{}', auth.uid())"
expect "done" "u2 writes season 1" 2 "insert into public.league_seasons(league_id, season, data, created_by) values ('LABCDE', 1, '{}', auth.uid()); select 'done'"
expect "ERR" "season 1 can't be written twice" 3 "insert into public.league_seasons(league_id, season, data, created_by) values ('LABCDE', 1, '{\"x\":1}', auth.uid())"
expect "done" "u1 sends a lineup for a future kickoff" 1 "insert into public.league_entries(league_id, slot, user_id, season, day, kickoff_at, data) values ('LABCDE', 0, auth.uid(), 1, 1, now() + interval '1 hour', '{}'); select 'done'"
expect "ERR" "no lineup for a kickoff that started" 1 "insert into public.league_entries(league_id, slot, user_id, season, day, kickoff_at, data) values ('LABCDE', 0, auth.uid(), 1, 1, now() - interval '1 minute', '{}')"
expect "ERR" "u2 cannot send for u1's seat" 2 "insert into public.league_entries(league_id, slot, user_id, season, day, kickoff_at, data) values ('LABCDE', 0, auth.uid(), 1, 1, now() + interval '1 hour', '{}')"
expect "0" "u2 cannot read u1's lineup before kickoff" 2 "select count(*) from public.league_entries"
expect "1" "u1 reads their own lineup" 1 "select count(*) from public.league_entries"
expect "done" "u2 stores a result" 2 "insert into public.league_results(league_id, season, match_id, data, created_by) values ('LABCDE', 1, 's1d1m0', '{}', auth.uid()); select 'done'"
expect "ERR" "results are final" 1 "insert into public.league_results(league_id, season, match_id, data, created_by) values ('LABCDE', 1, 's1d1m0', '{}', auth.uid())"
expect "ERR" "u4 cannot store results" 4 "insert into public.league_results(league_id, season, match_id, data, created_by) values ('LABCDE', 1, 's1d1m1', '{}', auth.uid())"
expect "done" "u1 saves their club" 1 "insert into public.league_clubs(league_id, user_id, data) values ('LABCDE', auth.uid(), '{}'); select 'done'"
expect "0" "u2 cannot read u1's club" 2 "select count(*) from public.league_clubs"
psql -h /tmp -p 5433 -U postgres -d sb -q -c "update public.leagues set first_kickoff = now() - interval '1 day';"
expect "ERR" "calendar is locked after season 1 starts" 1 "update public.leagues set data = data || '{\"kickoff\":\"21:00\"}'"
expect "done" "prizes can still change" 1 "update public.leagues set data = data || '{\"prizes\":[\"AWP\"]}'; select 'done'"
expect "done" "u3 can leave" 3 "delete from public.league_seats where user_id = auth.uid(); select 'done'"
