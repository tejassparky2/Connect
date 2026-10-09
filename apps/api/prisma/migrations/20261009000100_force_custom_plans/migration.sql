-- Always plan prepared statements with their actual parameters.
-- Prisma uses prepared statements; after 5 executions Postgres may switch to a GENERIC plan
-- built without knowing the query point. For geospatial queries selectivity depends entirely
-- on the point (dense city vs empty village), so generic plans were measured 4× slower
-- (feed page 29 ms → 7 ms with force_custom_plan). Applies to new connections.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET plan_cache_mode = force_custom_plan', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set plan_cache_mode (insufficient privilege); set it in the server or role config instead.';
END $$;
