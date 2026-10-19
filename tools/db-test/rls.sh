#!/bin/bash
# Checks the row level security in supabase/schema.sql against a local Postgres 16
# (stub.sql imitates the parts of Supabase it relies on). See tools/db-test/README.md.
# Usage: run as <user-n|anon> "sql"; prints OK or the error
P="psql -h /tmp -p 5433 -U postgres -d sb -qtA -v ON_ERROR_STOP=1"
as() { local who=$1; shift; local role=authenticated sub="00000000-0000-0000-0000-00000000000$who"; [ "$who" = anon ] && { role=anon; sub=; }
  $P -c "set role $role; set request.jwt.claim.sub = '$sub'; $*" 2>&1 | sed 's/^psql:.*ERROR: */ERR /' | tr '\n' ' '; echo; }
expect() { local want=$1 label=$2; shift 2; local out; out=$(as "$@"); if [[ "$out" == *"$want"* ]]; then echo "PASS $label"; else echo "FAIL $label -> $out"; fi; }
psql -h /tmp -p 5433 -U postgres -d sb -q -c "set client_min_messages=warning; truncate public.tournaments, public.contact_messages cascade; delete from public.app_secrets; insert into public.app_secrets values ('contact_token','secret-xyz');"
SOON="now() + interval '2 seconds'"
expect "" "u1 creates tournament" 1 "insert into public.tournaments(id, owner_id, first_kickoff, data) values ('TABCDE','00000000-0000-0000-0000-000000000001', $SOON, '{}'); select 'done'"
expect "ERR" "u2 cannot create tournament owned by u1" 2 "insert into public.tournaments(id, owner_id, first_kickoff, data) values ('TXYZ12','00000000-0000-0000-0000-000000000001', now()+interval '1 day', '{}')"
expect "ERR" "bad id rejected" 1 "insert into public.tournaments(id, owner_id, first_kickoff, data) values ('bad','00000000-0000-0000-0000-000000000001', now()+interval '1 day', '{}')"
expect "ERR" "anon cannot read tournaments" anon "select count(*) from public.tournaments; select 1/(select count(*) from public.tournaments)"
expect "0" "u2 cannot update u1's tournament (0 rows)" 2 "with x as (update public.tournaments set data='{\"x\":1}' returning 1) select count(*) from x"
for i in 1 2 3 4; do expect "done" "u$i takes seat $((i-1))" $i "insert into public.tournament_seats values ('TABCDE', $((i-1)), '00000000-0000-0000-0000-00000000000$i', '{}'); select 'done'"; done
expect "ERR" "fifth user cannot take a seat" 5 "insert into public.tournament_seats values ('TABCDE', 3, '00000000-0000-0000-0000-000000000005', '{}')"
expect "ERR" "seat 4 out of range" 5 "insert into public.tournament_seats values ('TABCDE', 4, '00000000-0000-0000-0000-000000000005', '{}')"
expect "ERR" "u1 cannot take a second seat" 1 "insert into public.tournament_seats values ('TABCDE', 3, '00000000-0000-0000-0000-000000000001', '{}')"
expect "ERR" "u2 cannot seat someone else" 2 "insert into public.tournament_seats values ('TABCDE', 0, '00000000-0000-0000-0000-000000000005', '{}')"
expect "0" "u2 cannot move its seat" 2 "with x as (update public.tournament_seats set seat=2 where user_id=auth.uid() returning 1) select count(*) from x"
# entries: future kickoff + kickoff that passes in 2s
expect "done" "u1 entry for future kickoff" 1 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, submitted_at, data) values ('TABCDE',0,auth.uid(),0, $SOON, '2000-01-01', '{\"a\":1}'); select 'done'"
expect "t" "submitted_at is now, not backdated" 1 "select bool_and(submitted_at > now() - interval '1 minute') from public.tournament_entries"
expect "ERR" "u2 cannot write for seat 0" 2 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, data) values ('TABCDE',0,auth.uid(),0, $SOON, '{}')"
expect "ERR" "u2 cannot impersonate u1" 2 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, data) values ('TABCDE',0,'00000000-0000-0000-0000-000000000001',0, $SOON, '{}')"
expect "ERR" "u5 (no seat) cannot write entries" 5 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, data) values ('TABCDE',3,auth.uid(),0, $SOON, '{}')"
expect "ERR" "entry for a started kickoff refused" 1 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, data) values ('TABCDE',0,auth.uid(),0, now() - interval '1 second', '{}')"
expect "0" "u2 cannot see u1's entry before kickoff" 2 "select count(*) from public.tournament_entries"
expect "1" "u1 sees own entry" 1 "select count(*) from public.tournament_entries"
expect "0" "nobody can edit an entry" 1 "with x as (update public.tournament_entries set data='{}' returning 1) select count(*) from x"
expect "0" "nobody can delete an entry" 1 "with x as (delete from public.tournament_entries returning 1) select count(*) from x"
sleep 3
expect "1" "after kickoff u2 sees u1's entry" 2 "select count(*) from public.tournament_entries"
expect "ERR" "late entry refused" 1 "insert into public.tournament_entries(tournament_id, seat, user_id, slot, kickoff_at, data) values ('TABCDE',0,auth.uid(),0, now() - interval '1 second', '{}')"
expect "ERR" "no joining after start" 5 "insert into public.tournament_seats values ('TABCDE', 3, '00000000-0000-0000-0000-000000000005', '{}')"
expect "0" "owner cannot edit after start" 1 "with x as (update public.tournaments set data='{\"y\":2}' returning 1) select count(*) from x"
# results
expect "done" "seated u3 stores a result" 3 "insert into public.tournament_results values ('TABCDE','d1k0a','{}',auth.uid()); select 'done'"
expect "ERR" "second result for same match refused" 4 "insert into public.tournament_results values ('TABCDE','d1k0a','{\"x\":1}',auth.uid())"
expect "0" "result cannot be edited" 3 "with x as (update public.tournament_results set data='{\"z\":1}' returning 1) select count(*) from x"
expect "ERR" "unseated u5 cannot store result" 5 "insert into public.tournament_results values ('TABCDE','d1k0b','{}',auth.uid())"
expect "done" "u4 flags disagreement" 4 "insert into public.tournament_flags values ('TABCDE','d1k0a',auth.uid(),false); select 'done'"
# clubs
expect "1" "u1 saves own club" 1 "insert into public.tournament_clubs values ('TABCDE', auth.uid(), '{}') on conflict (tournament_id,user_id) do update set data=excluded.data; select count(*) from public.tournament_clubs"
expect "0" "u2 cannot read u1's club" 2 "select count(*) from public.tournament_clubs"
expect "ERR" "u2 cannot write u1's club" 2 "insert into public.tournament_clubs values ('TABCDE', '00000000-0000-0000-0000-000000000001', '{}')"
expect "t" "server clock readable" anon "select public.server_time() is not null"
# contact
expect "done" "anon sends contact message" anon "insert into public.contact_messages(topic, body, user_id, forwarded_at) values ('bug','The map veto froze', '00000000-0000-0000-0000-000000000003', now()); select 'done'"
expect "done" "signed-in sends contact message" 2 "insert into public.contact_messages(topic, body, reply_to) values ('feedback','Great game so far', 'discord: x'); select 'done'"
expect "ERR" "too-short message refused" anon "insert into public.contact_messages(topic, body) values ('bug','hi')"
expect "ERR" "unknown topic refused" anon "insert into public.contact_messages(topic, body) values ('spam','hello there')"
expect "0" "nobody reads messages from the game" 2 "select count(*) from public.contact_messages"
expect "ERR" "nobody reads secrets" anon "select 1/(select count(*) from public.app_secrets)"
expect "ERR" "wrong token refused" anon "select * from public.take_contact_messages('guess')"
expect "2" "right token returns both messages" anon "select count(*) from public.take_contact_messages('secret-xyz')"
expect "0" "messages are only taken once" anon "select count(*) from public.take_contact_messages('secret-xyz')"
psql -h /tmp -p 5433 -U postgres -d sb -qtA -c "select coalesce(user_id::text,'null')||' fwd:'||(forwarded_at is not null) from public.contact_messages order by id"
