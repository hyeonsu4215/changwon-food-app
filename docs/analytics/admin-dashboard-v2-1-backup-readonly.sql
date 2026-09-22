-- Read-only snapshot for Admin Analytics v2.1. Run before the migration.
SELECT 'range_rpc_definition' AS section, jsonb_build_object(
  'oid', procedure_row.oid,
  'identity_arguments', pg_catalog.pg_get_function_identity_arguments(procedure_row.oid),
  'result', pg_catalog.pg_get_function_result(procedure_row.oid),
  'security_definer', procedure_row.prosecdef,
  'config', procedure_row.proconfig,
  'definition', pg_catalog.pg_get_functiondef(procedure_row.oid),
  'definition_md5', md5(pg_catalog.pg_get_functiondef(procedure_row.oid)),
  'acl', procedure_row.proacl
) AS payload
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)')
UNION ALL
SELECT 'analytics_security', jsonb_build_object(
  'rows', (SELECT count(*) FROM public.analytics_events),
  'fingerprint', (
    SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id), '[]'::jsonb)::text)
    FROM public.analytics_events AS event_row
  ),
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
)
UNION ALL
SELECT 'core_counts', jsonb_build_object(
  'restaurants', (SELECT count(*) FROM public.restaurants),
  'menus', (SELECT count(*) FROM public.menus),
  'weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours)
);
