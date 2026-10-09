-- Disable JIT for this database.
-- PostGIS functions carry high planner cost estimates, which push ordinary OLTP queries past
-- jit_above_cost; Postgres then spends ~35 ms compiling code for queries that execute in
-- ~5 ms (measured: feed page 43 ms → 8 ms with jit=off). Applies to new connections.
-- Wrapped so environments without ALTER DATABASE privilege don't fail the migration.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not disable JIT (insufficient privilege); set jit=off in the server or role config instead.';
END $$;
