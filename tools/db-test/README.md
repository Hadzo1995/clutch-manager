# Database rule tests

Runs the rules in `supabase/schema.sql` against a throwaway local PostgreSQL 16,
with `stub.sql` standing in for the parts of Supabase the schema uses
(`auth.users`, `auth.uid()`, the `anon` and `authenticated` roles, the
`supabase_realtime` publication).

    createdb sb && psql -d sb -f stub.sql && psql -d sb -f ../../supabase/schema.sql
    ./rls.sh   # expects the server on /tmp port 5433; edit P= at the top otherwise

Every line should start with PASS.

The PvP rooms have their own file and check:

    psql -d sb -f ../../supabase/pvp.sql
    ./pvp-rls.sh

The closed beta has its own check too (load it after the two files above):

    psql -d sb -f ../../supabase/beta.sql
    ./beta-rls.sh

It leaves the beta switched off when it finishes, so `rls.sh` and `pvp-rls.sh` still pass afterwards.
