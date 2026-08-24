SELECT 'analytics_table' AS section, jsonb_build_object(
  'exists', to_regclass('public.analytics_events') IS NOT NULL,
  'rows', (SELECT count(*) FROM public.analytics_events),
  'acquisition_source_exists', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_events' AND column_name = 'acquisition_source'
  )
) AS payload
UNION ALL
SELECT 'ingestion_rpc', jsonb_build_object(
  'expected_signature_exists', to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'
  ) IS NOT NULL,
  'overloads', (
    SELECT count(*) FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'log_analytics_event'
  )
)
UNION ALL
SELECT 'is_admin', jsonb_build_object(
  'exists', to_regprocedure('public.is_admin()') IS NOT NULL,
  'returns_boolean', procedure_row.prorettype = 'boolean'::regtype,
  'security_definer', procedure_row.prosecdef,
  'uses_admin_users', pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%public.admin_users%'
)
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.is_admin()')
UNION ALL
SELECT 'dashboard_collision', jsonb_build_object(
  'overloads', (
    SELECT count(*) FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'get_admin_analytics_dashboard'
  )
)
UNION ALL
SELECT 'raw_security', jsonb_build_object(
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
)
ORDER BY section;
