SELECT 'baseline' AS section, jsonb_build_object(
  'analytics_events', (SELECT count(*) FROM public.analytics_events),
  'info_reports', (SELECT count(*) FROM public.info_reports),
  'restaurants', (SELECT count(*) FROM public.restaurants),
  'menus', (SELECT count(*) FROM public.menus),
  'restaurant_weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours),
  'info_report_status_counts', (
    SELECT COALESCE(jsonb_object_agg(status, row_count), '{}'::jsonb)
    FROM (
      SELECT status, count(*) AS row_count
      FROM public.info_reports
      GROUP BY status
      ORDER BY status
    ) AS status_rows
  )
) AS payload
UNION ALL
SELECT 'schema' AS section, jsonb_build_object(
  'server_received_at', (
    SELECT jsonb_build_object(
      'type', data_type,
      'nullable', is_nullable,
      'default', column_default
    )
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name = 'server_received_at'
  ),
  'info_reports_status', (
    SELECT jsonb_build_object(
      'type', data_type,
      'nullable', is_nullable,
      'default', column_default
    )
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'status'
  ),
  'status_constraint', (
    SELECT pg_catalog.pg_get_constraintdef(oid, true)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.info_reports'::regclass
      AND conname = 'info_reports_status_check'
  )
)
UNION ALL
SELECT 'collisions' AS section, jsonb_build_object(
  'completed_at_exists', EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ),
  'completion_function_count', (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'set_info_report_completed_at'
  ),
  'preview_rpc_count', (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'get_admin_privacy_retention_preview'
  ),
  'completion_trigger_count', (
    SELECT count(*)
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.info_reports'::regclass
      AND NOT tgisinternal
      AND tgname = 'info_reports_completed_at'
  )
)
UNION ALL
SELECT 'admin_contract' AS section, jsonb_build_object(
  'exists', to_regprocedure('public.is_admin()') IS NOT NULL,
  'return_type', (
    SELECT prorettype::regtype::text
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')
  ),
  'security_definer', (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')
  ),
  'config', (
    SELECT proconfig
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')
  ),
  'uses_admin_users', (
    SELECT pg_catalog.pg_get_functiondef(oid) LIKE '%public.admin_users%'
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')
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
  AND class_row.relname IN ('analytics_events', 'info_reports')
UNION ALL
SELECT 'retention_automation' AS section, jsonb_build_object(
  'pg_cron_installed', EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'
  ),
  'cron_job_relation', to_regclass('cron.job'),
  'analytics_retention_trigger_count', (
    SELECT count(*)
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.analytics_events'::regclass
      AND NOT tgisinternal
  )
);
