-- READ-ONLY ANALYTICS FOUNDATION PRECHECK. NO DATABASE CHANGES.
SET default_transaction_read_only = on;
BEGIN;
SET TRANSACTION READ ONLY;
COMMIT;

SELECT check_name, expected, actual, passed
FROM (
  SELECT 1 AS ordering, 'analytics relation collision'::text AS check_name,
    '0'::text AS expected,
    count(*)::text AS actual,
    count(*) = 0 AS passed
  FROM pg_catalog.pg_class AS class_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname = 'analytics_events'

  UNION ALL

  SELECT 2, 'analytics function collision', '0', count(*)::text, count(*) = 0
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname = 'log_analytics_event'

  UNION ALL

  SELECT 3, 'gen_random_uuid available', 'true',
    (to_regprocedure('gen_random_uuid()') IS NOT NULL)::text,
    to_regprocedure('gen_random_uuid()') IS NOT NULL

  UNION ALL

  SELECT 4, 'public.is_admin available', 'true',
    (to_regprocedure('public.is_admin()') IS NOT NULL)::text,
    to_regprocedure('public.is_admin()') IS NOT NULL

  UNION ALL

  SELECT 5, 'restaurants current count', 'record before migration',
    (SELECT count(*)::text FROM public.restaurants), true

  UNION ALL

  SELECT 6, 'menus current count', 'record before migration',
    (SELECT count(*)::text FROM public.menus), true

  UNION ALL

  SELECT 7, 'weekly hours current count', 'record before migration',
    (SELECT count(*)::text FROM public.restaurant_weekly_hours), true

  UNION ALL

  SELECT 8, 'orphan menus', '0', count(*)::text, count(*) = 0
  FROM public.menus AS menu
  LEFT JOIN public.restaurants AS restaurant
    ON restaurant.id = menu.restaurant_id
  WHERE restaurant.id IS NULL

  UNION ALL

  SELECT 9, 'anon can create in public schema', 'false',
    has_schema_privilege('anon', 'public', 'CREATE')::text,
    NOT has_schema_privilege('anon', 'public', 'CREATE')

  UNION ALL

  SELECT 10, 'authenticated can create in public schema', 'false',
    has_schema_privilege('authenticated', 'public', 'CREATE')::text,
    NOT has_schema_privilege('authenticated', 'public', 'CREATE')

  UNION ALL

  SELECT 11, 'public.is_admin security contract', 'true',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('public.is_admin()')
        AND prorettype = 'boolean'::regtype
        AND prosecdef
        AND proconfig @> ARRAY['search_path=public']::text[]
    )::text,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('public.is_admin()')
        AND prorettype = 'boolean'::regtype
        AND prosecdef
        AND proconfig @> ARRAY['search_path=public']::text[]
    )

  UNION ALL

  SELECT 12, 'menu restaurant FK delete action', 'CASCADE',
    COALESCE((
      SELECT CASE constraint_row.confdeltype WHEN 'c' THEN 'CASCADE' ELSE constraint_row.confdeltype::text END
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.menus'::regclass
        AND constraint_row.contype = 'f'
        AND constraint_row.confrelid = 'public.restaurants'::regclass
      LIMIT 1
    ), 'missing'),
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.menus'::regclass
        AND constraint_row.contype = 'f'
        AND constraint_row.confrelid = 'public.restaurants'::regclass
        AND constraint_row.confdeltype = 'c'
    )
) AS checks
ORDER BY ordering;
