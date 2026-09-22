-- READ ONLY. Run only after a separately approved migration execution.
SELECT 'range_rpc' AS check_name, jsonb_build_object(
  'overloads', (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'get_admin_analytics_dashboard_range'
  ),
  'identity_arguments', pg_catalog.pg_get_function_identity_arguments(procedure_row.oid),
  'result', pg_catalog.pg_get_function_result(procedure_row.oid),
  'security_definer', procedure_row.prosecdef,
  'search_path', procedure_row.proconfig,
  'public_execute', EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl_row
    WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
  ),
  'anon_execute', has_function_privilege('anon', procedure_row.oid, 'EXECUTE'),
  'authenticated_execute', has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE'),
  'service_role_execute', has_function_privilege('service_role', procedure_row.oid, 'EXECUTE'),
  'pass', NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl_row
    WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
  )
    AND NOT has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
    AND has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
    AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
) AS result
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)')
UNION ALL
SELECT 'existing_rpc_preserved', jsonb_build_object(
  'exists', to_regprocedure('public.get_admin_analytics_dashboard()') IS NOT NULL,
  'identity_arguments', pg_catalog.pg_get_function_identity_arguments(procedure_row.oid),
  'result', pg_catalog.pg_get_function_result(procedure_row.oid),
  'definition_sha256', encode(digest(pg_catalog.pg_get_functiondef(procedure_row.oid), 'sha256'), 'hex')
)
FROM pg_catalog.pg_proc AS procedure_row
WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard()')
UNION ALL
SELECT 'raw_security', jsonb_build_object(
  'rows', (SELECT count(*) FROM public.analytics_events),
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'authenticated_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
)
ORDER BY check_name;

-- Optional admin-session runtime checks. These calls only read aggregates.
-- SELECT public.get_admin_analytics_dashboard_range(NULL, NULL);
-- SELECT public.get_admin_analytics_dashboard_range(current_date, current_date);
