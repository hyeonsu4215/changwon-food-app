-- READ ONLY. Every pass value must be true before migration execution is approved.
WITH required_columns(column_name) AS (
  VALUES
    ('event_id'), ('event_name'), ('server_received_at'), ('session_id'),
    ('recommendation_id'), ('restaurant_id'), ('menu_id'), ('position'),
    ('source_context'), ('acquisition_source'), ('is_returning'),
    ('return_gap'), ('first_acquisition_source')
)
SELECT 'existing_rpc' AS check_name, jsonb_build_object(
  'exists', to_regprocedure('public.get_admin_analytics_dashboard()') IS NOT NULL,
  'returns_jsonb', procedure_row.prorettype = 'jsonb'::regtype,
  'security_definer', procedure_row.prosecdef,
  'search_path', procedure_row.proconfig,
  'pass', procedure_row.prorettype = 'jsonb'::regtype
    AND procedure_row.prosecdef
    AND procedure_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
) AS result
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard()')
UNION ALL
SELECT 'range_rpc_absent', jsonb_build_object(
  'overloads', count(*),
  'pass', count(*) = 0
)
FROM pg_catalog.pg_proc AS procedure_row
JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.proname = 'get_admin_analytics_dashboard_range'
UNION ALL
SELECT 'required_columns', jsonb_build_object(
  'missing', COALESCE(jsonb_agg(required_columns.column_name) FILTER (WHERE column_row.column_name IS NULL), '[]'::jsonb),
  'pass', count(*) FILTER (WHERE column_row.column_name IS NULL) = 0
)
FROM required_columns
LEFT JOIN information_schema.columns AS column_row
  ON column_row.table_schema = 'public'
  AND column_row.table_name = 'analytics_events'
  AND column_row.column_name = required_columns.column_name
UNION ALL
SELECT 'raw_security', jsonb_build_object(
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT'),
  'pass', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass)
    AND (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events') = 0
    AND NOT has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
)
ORDER BY check_name;
