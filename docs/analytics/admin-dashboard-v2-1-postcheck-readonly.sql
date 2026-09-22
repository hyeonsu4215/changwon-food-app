-- Read-only contract check after Admin Analytics v2.1 migration.
WITH target_function AS (
  SELECT procedure_row.*, pg_catalog.pg_get_functiondef(procedure_row.oid) AS definition
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid = to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)')
), checks AS (
  SELECT
    (SELECT count(*) FROM target_function) = 1 AS one_exact_rpc,
    COALESCE((SELECT prorettype = 'jsonb'::regtype FROM target_function), false) AS returns_jsonb,
    COALESCE((SELECT prosecdef FROM target_function), false) AS security_definer,
    COALESCE((SELECT proconfig = ARRAY['search_path=pg_catalog']::text[] FROM target_function), false) AS safe_search_path,
    COALESCE((SELECT definition LIKE '%public.is_admin() IS DISTINCT FROM true%' FROM target_function), false) AS admin_guard,
    COALESCE((SELECT definition LIKE '%''range'', jsonb_build_object%' FROM target_function), false) AS range_contract,
    COALESCE((SELECT definition LIKE '%''summary'', jsonb_build_object%' FROM target_function), false) AS summary_contract,
    COALESCE((SELECT definition LIKE '%''acquisition'', acquisition.regular_sources%' FROM target_function), false) AS acquisition_contract,
    COALESCE((SELECT definition LIKE '%''daily'', daily.rows%' FROM target_function), false) AS daily_contract,
    COALESCE((SELECT definition LIKE '%''restaurants'', restaurant_result.rows%' FROM target_function), false) AS restaurants_contract,
    COALESCE((SELECT definition LIKE '%''retention'', jsonb_build_object%' FROM target_function), false) AS retention_contract,
    COALESCE((SELECT definition LIKE '%''completed_sessions'', metric.completed_sessions%' FROM target_function), false) AS daily_completed_sessions,
    COALESCE((SELECT definition LIKE '%''returning_sessions'', metric.returning_sessions%' FROM target_function), false) AS daily_returning_sessions,
    COALESCE((SELECT definition NOT LIKE '%occurred_at%' FROM target_function), false) AS server_time_only,
    NOT has_function_privilege('anon', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE') AS anon_blocked,
    has_function_privilege('authenticated', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE') AS authenticated_allowed,
    has_function_privilege('service_role', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE') AS service_role_allowed,
    (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass) AS rls_enabled,
    (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events') = 0 AS policies_unchanged,
    NOT has_table_privilege('anon', 'public.analytics_events', 'SELECT') AS anon_raw_select_blocked,
    NOT has_table_privilege('authenticated', 'public.analytics_events', 'SELECT') AS authenticated_raw_select_blocked
)
SELECT *,
  one_exact_rpc AND returns_jsonb AND security_definer AND safe_search_path AND admin_guard
    AND range_contract AND summary_contract AND acquisition_contract AND daily_contract
    AND restaurants_contract AND retention_contract
    AND daily_completed_sessions AND daily_returning_sessions AND server_time_only
    AND anon_blocked AND authenticated_allowed AND service_role_allowed
    AND rls_enabled AND policies_unchanged AND anon_raw_select_blocked AND authenticated_raw_select_blocked AS pass
FROM checks;
