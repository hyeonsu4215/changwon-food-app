SELECT 'baseline' AS section, jsonb_build_object(
  'analytics_events', (SELECT count(*) FROM public.analytics_events),
  'info_reports', (SELECT count(*) FROM public.info_reports),
  'restaurants', (SELECT count(*) FROM public.restaurants),
  'menus', (SELECT count(*) FROM public.menus),
  'restaurant_weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours)
) AS payload
UNION ALL
SELECT 'completed_at' AS section, jsonb_build_object(
  'exists', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ),
  'type', (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ),
  'nullable', (
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ),
  'default', (
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ),
  'existing_non_null_rows', (
    SELECT count(*) FROM public.info_reports WHERE completed_at IS NOT NULL
  )
)
UNION ALL
SELECT 'functions' AS section, jsonb_build_object(
  'completion_trigger_function', (
    SELECT jsonb_build_object(
      'exists', true,
      'return_type', prorettype::regtype::text,
      'security_definer', prosecdef,
      'config', proconfig
    )
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.set_info_report_completed_at()')
  ),
  'preview_rpc', (
    SELECT jsonb_build_object(
      'exists', true,
      'arguments', pronargs,
      'return_type', prorettype::regtype::text,
      'security_definer', prosecdef,
      'config', proconfig,
      'admin_guard', pg_catalog.pg_get_functiondef(oid) LIKE '%public.is_admin()%IS DISTINCT FROM true%',
      'analytics_cutoff', pg_catalog.pg_get_functiondef(oid) LIKE '%server_received_at < v_now - interval ''2 years''%',
      'info_report_cutoff', pg_catalog.pg_get_functiondef(oid) LIKE '%completed_at < v_now - interval ''6 months''%'
    )
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.get_admin_privacy_retention_preview()')
  )
)
UNION ALL
SELECT 'trigger' AS section, COALESCE((
  SELECT jsonb_build_object(
    'count', count(*),
    'enabled', bool_and(tgenabled = 'O'),
    'before', bool_and((tgtype & 2) <> 0),
    'row_level', bool_and((tgtype & 1) <> 0),
    'insert', bool_and((tgtype & 4) <> 0),
    'update', bool_and((tgtype & 16) <> 0),
    'delete', bool_or((tgtype & 8) <> 0),
    'truncate', bool_or((tgtype & 32) <> 0),
    'definition', min(pg_catalog.pg_get_triggerdef(oid))
  )
  FROM pg_catalog.pg_trigger
  WHERE tgrelid = 'public.info_reports'::regclass
    AND NOT tgisinternal
    AND tgname = 'info_reports_completed_at'
    AND tgfoid = to_regprocedure('public.set_info_report_completed_at()')
), '{}'::jsonb)
UNION ALL
SELECT 'preview_rpc_grants' AS section, jsonb_build_object(
  'public_execute', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )) AS acl_row
    WHERE procedure_row.oid = to_regprocedure('public.get_admin_privacy_retention_preview()')
      AND acl_row.grantee = 0
      AND acl_row.privilege_type = 'EXECUTE'
  ),
  'anon_execute', has_function_privilege(
    'anon',
    'public.get_admin_privacy_retention_preview()',
    'EXECUTE'
  ),
  'authenticated_execute', has_function_privilege(
    'authenticated',
    'public.get_admin_privacy_retention_preview()',
    'EXECUTE'
  )
)
UNION ALL
SELECT 'table_security' AS section, COALESCE(
  jsonb_agg(jsonb_build_object(
    'table', class_row.relname,
    'rls', class_row.relrowsecurity,
    'acl', class_row.relacl,
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', policy_row.policyname,
        'command', policy_row.cmd,
        'roles', policy_row.roles,
        'using', policy_row.qual,
        'with_check', policy_row.with_check
      ) ORDER BY policy_row.policyname), '[]'::jsonb)
      FROM pg_catalog.pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = class_row.relname
    )
  ) ORDER BY class_row.relname),
  '[]'::jsonb
)
FROM pg_catalog.pg_class AS class_row
JOIN pg_catalog.pg_namespace AS namespace_row
  ON namespace_row.oid = class_row.relnamespace
WHERE namespace_row.nspname = 'public'
  AND class_row.relname IN ('analytics_events', 'info_reports');
