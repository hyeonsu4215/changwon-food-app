-- READ-ONLY. Run before the Acquisition Source v1 migration.
SELECT 'baseline_counts' AS section, jsonb_build_object(
  'analytics_events', (SELECT count(*) FROM public.analytics_events),
  'restaurants', (SELECT count(*) FROM public.restaurants),
  'menus', (SELECT count(*) FROM public.menus),
  'restaurant_weekly_hours', (SELECT count(*) FROM public.restaurant_weekly_hours)
) AS payload;

SELECT 'analytics_columns' AS section, COALESCE(jsonb_agg(to_jsonb(column_row) ORDER BY column_row.ordinal_position), '[]'::jsonb) AS payload
FROM (
  SELECT column_name, data_type, is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'analytics_events'
) AS column_row;

SELECT 'analytics_constraints' AS section, COALESCE(jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.constraint_name), '[]'::jsonb) AS payload
FROM (
  SELECT constraint_row.conname AS constraint_name,
    constraint_row.contype AS constraint_type,
    constraint_row.convalidated AS validated,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
) AS constraint_row;

SELECT 'analytics_rpc_signatures' AS section, COALESCE(jsonb_agg(to_jsonb(function_row) ORDER BY function_row.identity_arguments), '[]'::jsonb) AS payload
FROM (
  SELECT pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(procedure_row.oid) AS result_type,
    procedure_row.prosecdef AS security_definer,
    procedure_row.proconfig AS configuration
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'log_analytics_event'
) AS function_row;

SELECT 'analytics_security' AS section, jsonb_build_object(
  'rls_enabled', (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'rls_forced', (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass),
  'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'),
  'anon_table_select', has_table_privilege('anon', 'public.analytics_events', 'SELECT'),
  'anon_table_insert', has_table_privilege('anon', 'public.analytics_events', 'INSERT'),
  'authenticated_table_select', has_table_privilege('authenticated', 'public.analytics_events', 'SELECT'),
  'authenticated_table_insert', has_table_privilege('authenticated', 'public.analytics_events', 'INSERT'),
  'public_rpc_execute', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS acl
    WHERE procedure_row.oid = 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'anon_rpc_execute', has_function_privilege('anon', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)', 'EXECUTE'),
  'authenticated_rpc_execute', has_function_privilege('authenticated', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)', 'EXECUTE')
) AS payload;
