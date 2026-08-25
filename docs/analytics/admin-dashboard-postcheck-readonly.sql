SELECT 'dashboard_rpc' AS section, jsonb_build_object(
  'overloads', (
    SELECT count(*) FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'get_admin_analytics_dashboard'
  ),
  'returns_jsonb', procedure_row.prorettype = 'jsonb'::regtype,
  'zero_arguments', procedure_row.pronargs = 0,
  'security_definer', procedure_row.prosecdef,
  'search_path', procedure_row.proconfig,
  'has_admin_guard', pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%public.is_admin()%'
)
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard()')
UNION ALL
SELECT 'dashboard_grants', jsonb_build_object(
  'public_execute', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
    ) AS acl
    WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard()')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'anon_execute', has_function_privilege('anon', 'public.get_admin_analytics_dashboard()', 'EXECUTE'),
  'authenticated_execute', has_function_privilege('authenticated', 'public.get_admin_analytics_dashboard()', 'EXECUTE')
)
UNION ALL
SELECT 'raw_security', jsonb_build_object(
  'rows', (SELECT count(*) FROM public.analytics_events),
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
