#!/bin/bash
# Checks the row level security in supabase/pvp.sql (same setup as rls.sh; see README.md).
P="psql -h /tmp -p 5433 -U postgres -d sb -qtA -v ON_ERROR_STOP=1"
as() { local who=$1; shift; local role=authenticated sub="00000000-0000-0000-0000-00000000000$who"; [ "$who" = anon ] && { role=anon; sub=; }
  $P -c "set role $role; set request.jwt.claim.sub = '$sub'; $*" 2>&1 | sed 's/^psql:.*ERROR: */ERR /' | tr '\n' ' '; echo; }
expect() { local want=$1 label=$2; shift 2; local out; out=$(as "$@"); if [[ "$out" == *"$want"* ]]; then echo "PASS $label"; else echo "FAIL $label -> $out"; fi; }
psql -h /tmp -p 5433 -U postgres -d sb -q -c "set client_min_messages=warning; truncate public.pvp_rooms cascade;"
U1=00000000-0000-0000-0000-000000000001; U2=00000000-0000-0000-0000-000000000002
expect "done" "u1 creates room" 1 "insert into public.pvp_rooms(code, host_id, data) values ('ABC234', auth.uid(), '{\"state\":\"waiting\"}'); select 'done'"
expect "ERR" "u2 cannot create a room as u1" 2 "insert into public.pvp_rooms(code, host_id, data) values ('XYZ234', '$U1', '{}')"
expect "ERR" "bad code rejected" 1 "insert into public.pvp_rooms(code, host_id, data) values ('abc', auth.uid(), '{}')"
expect "ERR" "anon cannot read rooms" anon "select 1/(select count(*) from public.pvp_rooms)"
expect "done" "u1 writes host seat" 1 "insert into public.pvp_seats values ('ABC234','host',auth.uid(),'{}'); select 'done'"
expect "ERR" "u2 cannot take the host seat" 2 "insert into public.pvp_seats values ('ABC234','host',auth.uid(),'{}')"
expect "f" "host cannot claim own guest seat" 1 "select public.pvp_claim_guest('ABC234')"
expect "0" "u2 cannot patch before joining (0 rows)" 2 "select public.pvp_patch('ABC234','{\"state\":\"x\"}'); select count(*) from public.pvp_rooms where data->>'state'='x'"
expect "t" "u2 claims guest seat" 2 "select public.pvp_claim_guest('ABC234')"
expect "f" "u3 cannot claim taken guest seat" 3 "select public.pvp_claim_guest('ABC234')"
expect "t" "u2 claiming again is fine" 2 "select public.pvp_claim_guest('ABC234')"
expect "done" "u2 writes guest seat" 2 "insert into public.pvp_seats values ('ABC234','guest',auth.uid(),'{}'); select 'done'"
expect "ERR" "u3 cannot write guest seat" 3 "insert into public.pvp_seats values ('ABC234','guest',auth.uid(),'{}')"
expect "0" "u1 cannot edit u2's seat" 1 "with x as (update public.pvp_seats set data='{\"h\":1}' where side='guest' returning 1) select count(*) from x"
expect "ready" "u2 patch merges" 2 "select public.pvp_patch('ABC234','{\"state\":\"ready\",\"names\":[\"a\",\"b\"]}'); select data->>'state' from public.pvp_rooms"
expect "in_progress" "u1 patch merges" 1 "select public.pvp_patch('ABC234','{\"state\":\"in_progress\"}'); select data->>'state' || ':' || (data->'names'->>1) from public.pvp_rooms"
expect "ERR" "u1 cannot change guest_id directly" 1 "update public.pvp_rooms set guest_id=null"
expect "ERR" "u2 cannot change host_id directly" 2 "update public.pvp_rooms set host_id=auth.uid()"
expect "in_progress" "u3 patch does nothing" 3 "select public.pvp_patch('ABC234','{\"state\":\"hacked\"}'); select data->>'state' from public.pvp_rooms"
expect "ERR" "anon cannot patch" anon "select public.pvp_patch('ABC234','{}')"
expect "1" "u2 sees room in own list" 2 "select count(*) from public.pvp_rooms where host_id=auth.uid() or guest_id=auth.uid()"
