-- READ ONLY. Export this result outside the repository before applying Analytics v2.
SELECT 'existing_dashboard_rpc' AS section, jsonb_build_object(
  'identity_arguments', pg_catalog.pg_get_function_identity_arguments(procedure_row.oid),
  'result', pg_catalog.pg_get_function_result(procedure_row.oid),
  'security_definer', procedure_row.prosecdef,
  'config', procedure_row.proconfig,
  'acl', procedure_row.proacl,
  'definition', pg_catalog.pg_get_functiondef(procedure_row.oid)
) AS payload
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard()')
UNION ALL
SELECT 'range_rpc_collision', jsonb_build_object(
  'overloads', (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'get_admin_analytics_dashboard_range'
  )
)
UNION ALL
SELECT 'analytics_columns', COALESCE(jsonb_agg(jsonb_build_object(
  'name', column_name,
  'type', data_type,
  'nullable', is_nullable,
  'default', column_default
) ORDER BY ordinal_position), '[]'::jsonb)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'analytics_events'
UNION ALL
SELECT 'analytics_indexes', COALESCE(jsonb_agg(jsonb_build_object(
  'name', indexname,
  'definition', indexdef
) ORDER BY indexname), '[]'::jsonb)
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public' AND tablename = 'analytics_events'
UNION ALL
SELECT 'analytics_security', jsonb_build_object(
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'rls_forced', (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
)
ORDER BY section;
