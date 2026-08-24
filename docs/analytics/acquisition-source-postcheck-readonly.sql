-- READ-ONLY. Run only after the Acquisition Source v1 migration.
SELECT 'post_counts' AS section, jsonb_build_object(
  'analytics_events', (SELECT count(*) FROM public.analytics_events),
  'session_start_missing_source', (SELECT count(*) FROM public.analytics_events WHERE event_name = 'session_start' AND acquisition_source IS NULL),
  'non_session_source_rows', (SELECT count(*) FROM public.analytics_events WHERE event_name <> 'session_start' AND acquisition_source IS NOT NULL),
  'invalid_source_rows', (SELECT count(*) FROM public.analytics_events WHERE acquisition_source IS NOT NULL AND acquisition_source NOT IN ('direct', 'everytime', 'kakao', 'instagram', 'poster_qr', 'share', 'internal_test', 'other')),
  'restaurants', (SELECT count(*) FROM public.restaurants),
  'menus', (SELECT count(*) FROM public.menus),
  'restaurant_weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours)
) AS payload;

SELECT 'acquisition_column' AS section, COALESCE(jsonb_agg(to_jsonb(column_row)), '[]'::jsonb) AS payload
FROM (
  SELECT column_name, data_type, is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'analytics_events'
    AND column_name = 'acquisition_source'
) AS column_row;

SELECT 'acquisition_constraint' AS section, COALESCE(jsonb_agg(to_jsonb(constraint_row)), '[]'::jsonb) AS payload
FROM (
  SELECT constraint_row.conname AS constraint_name,
    constraint_row.convalidated AS validated,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
    AND constraint_row.conname = 'analytics_events_acquisition_source_semantics'
) AS constraint_row;

SELECT 'analytics_rpc_final' AS section, COALESCE(jsonb_agg(to_jsonb(function_row) ORDER BY function_row.identity_arguments), '[]'::jsonb) AS payload
FROM (
  SELECT pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(procedure_row.oid) AS result_type,
    procedure_row.prosecdef AS security_definer,
    procedure_row.proconfig AS configuration,
    EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute,
    has_function_privilege('anon', procedure_row.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE') AS authenticated_execute
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'log_analytics_event'
) AS function_row;

SELECT 'analytics_raw_table_security' AS section, jsonb_build_object(
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'rls_forced', (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'anon_insert', has_table_privilege('anon', 'public.analytics_events', 'INSERT'),
  'anon_update', has_table_privilege('anon', 'public.analytics_events', 'UPDATE'),
  'anon_delete', has_table_privilege('anon', 'public.analytics_events', 'DELETE'),
  'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT'),
  'authenticated_insert', has_table_privilege('authenticated', 'public.analytics_events', 'INSERT'),
  'authenticated_update', has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE'),
  'authenticated_delete', has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
) AS payload;
