-- READ-ONLY. DO NOT MODIFY DATA.
SET default_transaction_read_only = on;
BEGIN;
SET TRANSACTION READ ONLY;

WITH function_rows AS (
  SELECT procedure_row.oid,
    procedure_row.proname,
    pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(procedure_row.oid) AS result_type,
    procedure_row.pronargs AS argument_count,
    procedure_row.prosecdef AS security_definer,
    procedure_row.proconfig AS config,
    pg_catalog.pg_get_functiondef(procedure_row.oid) AS definition
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname IN ('log_analytics_event', 'get_admin_analytics_dashboard')
)
SELECT section, payload
FROM (
  SELECT 1 AS ordinal, 'counts'::text AS section, jsonb_build_object(
    'restaurants', (SELECT count(*) FROM public.restaurants),
    'menus', (SELECT count(*) FROM public.menus),
    'weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours),
    'analytics_events', (SELECT count(*) FROM public.analytics_events),
    'eaten_record_added', (SELECT count(*) FROM public.analytics_events WHERE event_name = 'eaten_record_added')
  ) AS payload
  UNION ALL
  SELECT 2, 'event_constraint', jsonb_build_object(
    'expected_event_count', 7,
    'expected_eaten_present', false,
    'actual_eaten_present', pg_catalog.pg_get_constraintdef(constraint_row.oid, true) LIKE '%eaten_record_added%',
    'actual_event_names', (
      SELECT jsonb_agg(match_row[1] ORDER BY match_row[1])
      FROM pg_catalog.regexp_matches(
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        '''([^'']+)''::text',
        'g'
      ) AS match_row
    ),
    'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  )
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
    AND constraint_row.conname = 'analytics_events_event_name_allowed'
  UNION ALL
  SELECT 3, 'functions', jsonb_build_object(
    'expected_overloads_each', 1,
    'expected_eaten_semantics', false,
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
    'name', function_row.proname,
    'identity_arguments', function_row.identity_arguments,
    'argument_count', function_row.argument_count,
    'result_type', function_row.result_type,
    'security_definer', function_row.security_definer,
    'config', function_row.config,
    'public_execute', EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS acl_row
      WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
    ),
    'anon_execute', has_function_privilege('anon', function_row.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', function_row.oid, 'EXECUTE'),
    'has_eaten_semantics', function_row.definition LIKE '%eaten_record_added%',
    'has_eaten_dashboard_key', function_row.definition LIKE '%eaten_records%',
    'has_internal_test_filter', function_row.definition LIKE '%internal_test_sessions AS MATERIALIZED%'
    ) ORDER BY function_row.proname), '[]'::jsonb)
  )
  FROM function_rows AS function_row
  JOIN pg_catalog.pg_proc AS procedure_row ON procedure_row.oid = function_row.oid
  UNION ALL
  SELECT 4, 'raw_table_security', jsonb_build_object(
    'rls_enabled', class_row.relrowsecurity,
    'rls_forced', class_row.relforcerowsecurity,
    'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
    'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
    'anon_insert', has_table_privilege('anon', 'public.analytics_events', 'INSERT'),
    'anon_update', has_table_privilege('anon', 'public.analytics_events', 'UPDATE'),
    'anon_delete', has_table_privilege('anon', 'public.analytics_events', 'DELETE'),
    'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT'),
    'authenticated_insert', has_table_privilege('authenticated', 'public.analytics_events', 'INSERT'),
    'authenticated_update', has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE'),
    'authenticated_delete', has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
  )
  FROM pg_catalog.pg_class AS class_row
  WHERE class_row.oid = 'public.analytics_events'::regclass
  UNION ALL
  SELECT 5, 'privacy_retention', jsonb_build_object(
    'function_present', to_regprocedure('public.get_admin_privacy_retention_preview()') IS NOT NULL,
    'analytics_cutoff_uses_server_received_at_2_years', COALESCE(
      pg_catalog.pg_get_functiondef(to_regprocedure('public.get_admin_privacy_retention_preview()'))
        LIKE '%server_received_at < v_now - interval ''2 years''%',
      false
    )
  )
) AS result
ORDER BY ordinal;

COMMIT;
