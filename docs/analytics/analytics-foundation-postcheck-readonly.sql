-- READ-ONLY ANALYTICS FOUNDATION POSTCHECK. NO DATABASE CHANGES.
SET default_transaction_read_only = on;
BEGIN;
SET TRANSACTION READ ONLY;
COMMIT;

SELECT check_name, expected, actual, passed
FROM (
  SELECT 1 AS ordering, 'analytics table exists'::text AS check_name, 'true'::text AS expected,
    (to_regclass('public.analytics_events') IS NOT NULL)::text AS actual,
    to_regclass('public.analytics_events') IS NOT NULL AS passed

  UNION ALL

  SELECT 2, 'analytics column count', '14', count(*)::text, count(*) = 14
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'analytics_events'

  UNION ALL

  SELECT 3, 'analytics named constraint count', '8', count(*)::text, count(*) = 8
  FROM pg_catalog.pg_constraint
  WHERE conrelid = to_regclass('public.analytics_events')
    AND conname IN (
      'analytics_events_pkey',
      'analytics_events_event_name_allowed',
      'analytics_events_source_context_allowed',
      'analytics_events_position_allowed',
      'analytics_events_event_version_v1',
      'analytics_events_error_code_allowed',
      'analytics_events_item_count_allowed',
      'analytics_events_share_method_allowed'
    )

  UNION ALL

  SELECT 4, 'analytics index count', '5', count(*)::text, count(*) = 5
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public' AND tablename = 'analytics_events'

  UNION ALL

  SELECT 5, 'analytics RLS enabled', 'true',
    COALESCE((SELECT relrowsecurity::text FROM pg_catalog.pg_class WHERE oid = to_regclass('public.analytics_events')), 'false'),
    COALESCE((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = to_regclass('public.analytics_events')), false)

  UNION ALL

  SELECT 6, 'analytics RLS forced', 'false',
    COALESCE((SELECT relforcerowsecurity::text FROM pg_catalog.pg_class WHERE oid = to_regclass('public.analytics_events')), 'missing'),
    NOT COALESCE((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = to_regclass('public.analytics_events')), true)

  UNION ALL

  SELECT 7, 'analytics policy count', '0', count(*)::text, count(*) = 0
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'analytics_events'

  UNION ALL

  SELECT 8, 'anon direct table access', 'false',
    COALESCE((
      has_table_privilege('anon', 'public.analytics_events', 'SELECT')
      OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
      OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
      OR has_table_privilege('anon', 'public.analytics_events', 'DELETE')
    ), false)::text,
    NOT COALESCE((
      has_table_privilege('anon', 'public.analytics_events', 'SELECT')
      OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
      OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
      OR has_table_privilege('anon', 'public.analytics_events', 'DELETE')
    ), true)

  UNION ALL

  SELECT 9, 'authenticated direct table access', 'false',
    COALESCE((
      has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
    ), false)::text,
    NOT COALESCE((
      has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
      OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
    ), true)

  UNION ALL

  SELECT 10, 'ingestion RPC exists', 'true',
    (to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)') IS NOT NULL)::text,
    to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)') IS NOT NULL

  UNION ALL

  SELECT 11, 'ingestion RPC security definer', 'true',
    COALESCE((SELECT prosecdef::text FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)')), 'false'),
    COALESCE((SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)')), false)

  UNION ALL

  SELECT 12, 'ingestion RPC search_path', 'search_path=pg_catalog',
    COALESCE((SELECT array_to_string(proconfig, ',') FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)')), 'missing'),
    COALESCE((SELECT proconfig = ARRAY['search_path=pg_catalog']::text[] FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)')), false)

  UNION ALL

  SELECT 13, 'PUBLIC RPC execute', 'false', count(*)::text, count(*) = 0
  FROM pg_catalog.pg_proc AS procedure_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
  ) AS privilege_row
  WHERE procedure_row.oid = to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)')
    AND privilege_row.grantee = 0
    AND privilege_row.privilege_type = 'EXECUTE'

  UNION ALL

  SELECT 14, 'anon RPC execute', 'true',
    COALESCE(has_function_privilege('anon', to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'), 'EXECUTE'), false)::text,
    COALESCE(has_function_privilege('anon', to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'), 'EXECUTE'), false)

  UNION ALL

  SELECT 15, 'authenticated RPC execute', 'true',
    COALESCE(has_function_privilege('authenticated', to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'), 'EXECUTE'), false)::text,
    COALESCE(has_function_privilege('authenticated', to_regprocedure('public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'), 'EXECUTE'), false)

  UNION ALL

  SELECT 16, 'analytics row count', '0',
    CASE WHEN to_regclass('public.analytics_events') IS NULL THEN 'missing'
      ELSE (SELECT count(*)::text FROM public.analytics_events) END,
    to_regclass('public.analytics_events') IS NOT NULL
      AND (SELECT count(*) FROM public.analytics_events) = 0

  UNION ALL

  SELECT 17, 'restaurants current count', 'same as execution precheck',
    (SELECT count(*)::text FROM public.restaurants), NULL::boolean

  UNION ALL

  SELECT 18, 'menus current count', 'same as execution precheck',
    (SELECT count(*)::text FROM public.menus), NULL::boolean

  UNION ALL

  SELECT 19, 'weekly hours current count', 'same as execution precheck',
    (SELECT count(*)::text FROM public.restaurant_weekly_hours), NULL::boolean

  UNION ALL

  SELECT 20, 'PUBLIC direct table privilege count', '0', count(*)::text, count(*) = 0
  FROM pg_catalog.pg_class AS class_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))
  ) AS privilege_row
  WHERE class_row.oid = to_regclass('public.analytics_events')
    AND privilege_row.grantee = 0

  UNION ALL

  SELECT 21, 'analytics expected index names', '5', count(*)::text, count(*) = 5
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'analytics_events'
    AND indexname IN (
      'analytics_events_pkey',
      'analytics_events_recommendation_position_unique',
      'analytics_events_recommendation_menu_unique',
      'analytics_events_event_received_at_idx',
      'analytics_events_restaurant_event_received_at_idx'
    )
) AS checks
ORDER BY ordering;
