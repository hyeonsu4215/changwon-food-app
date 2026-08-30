BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $privacy_retention_preflight$
DECLARE
  v_analytics_fingerprint text;
  v_reports_fingerprint text;
  v_policy_fingerprint text;
  v_table_acl_fingerprint text;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: public.analytics_events is missing';
  END IF;

  IF to_regclass('public.info_reports') IS NULL THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: public.info_reports is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name = 'server_received_at'
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: server_received_at contract mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'status'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.info_reports'::regclass
      AND conname = 'info_reports_status_check'
      AND pg_catalog.pg_get_constraintdef(oid, true) LIKE '%pending%'
      AND pg_catalog.pg_get_constraintdef(oid, true) LIKE '%checking%'
      AND pg_catalog.pg_get_constraintdef(oid, true) LIKE '%done%'
      AND pg_catalog.pg_get_constraintdef(oid, true) LIKE '%rejected%'
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: info report status contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: info_reports.completed_at already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname IN ('set_info_report_completed_at', 'get_admin_privacy_retention_preview')
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: target function name already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.info_reports'::regclass
      AND NOT tgisinternal
      AND tgname = 'info_reports_completed_at'
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: target trigger already exists';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.is_admin()'::regprocedure
      AND prorettype = 'boolean'::regtype
      AND prosecdef
      AND proconfig @> ARRAY['search_path=public']::text[]
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%public.admin_users%'
  ) THEN
    RAISE EXCEPTION 'Privacy retention preflight failed: public.is_admin() contract mismatch';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id)::text, '[]'))
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(report_row) ORDER BY report_row.id)::text, '[]'))
  INTO v_reports_fingerprint
  FROM public.info_reports AS report_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(policy_row) ORDER BY policy_row.tablename, policy_row.policyname)::text, '[]'))
  INTO v_policy_fingerprint
  FROM pg_catalog.pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN ('analytics_events', 'info_reports');

  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('table', class_row.relname, 'acl', class_row.relacl) ORDER BY class_row.relname)::text, '[]'))
  INTO v_table_acl_fingerprint
  FROM pg_catalog.pg_class AS class_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname IN ('analytics_events', 'info_reports');

  PERFORM set_config('mukjji.privacy_analytics_fingerprint', v_analytics_fingerprint, true);
  PERFORM set_config('mukjji.privacy_reports_fingerprint', v_reports_fingerprint, true);
  PERFORM set_config('mukjji.privacy_policy_fingerprint', v_policy_fingerprint, true);
  PERFORM set_config('mukjji.privacy_table_acl_fingerprint', v_table_acl_fingerprint, true);
END;
$privacy_retention_preflight$;

ALTER TABLE public.info_reports
ADD COLUMN completed_at timestamptz NULL;

CREATE FUNCTION public.set_info_report_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $info_report_completion$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('done', 'rejected') THEN
      NEW.completed_at := current_timestamp;
    ELSE
      NEW.completed_at := NULL;
    END IF;
  ELSIF NEW.status IN ('done', 'rejected') THEN
    IF OLD.status NOT IN ('done', 'rejected') THEN
      NEW.completed_at := current_timestamp;
    ELSE
      NEW.completed_at := OLD.completed_at;
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$info_report_completion$;

CREATE TRIGGER info_reports_completed_at
BEFORE INSERT OR UPDATE ON public.info_reports
FOR EACH ROW
EXECUTE FUNCTION public.set_info_report_completed_at();

CREATE FUNCTION public.get_admin_privacy_retention_preview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $privacy_retention_preview$
DECLARE
  v_now timestamptz := current_timestamp;
  v_result jsonb;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Privacy retention preview access denied' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', v_now,
    'analytics', (
      SELECT jsonb_build_object(
        'cutoff', v_now - interval '2 years',
        'count', count(*),
        'oldest_server_received_at', min(event_row.server_received_at),
        'newest_server_received_at', max(event_row.server_received_at)
      )
      FROM public.analytics_events AS event_row
      WHERE event_row.server_received_at < v_now - interval '2 years'
    ),
    'info_reports', (
      SELECT jsonb_build_object(
        'cutoff', v_now - interval '6 months',
        'count', count(*),
        'items', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', report_row.id,
              'status', report_row.status,
              'completed_at', report_row.completed_at
            ) ORDER BY report_row.completed_at, report_row.id
          ),
          '[]'::jsonb
        )
      )
      FROM public.info_reports AS report_row
      WHERE report_row.status IN ('done', 'rejected')
        AND report_row.completed_at IS NOT NULL
        AND report_row.completed_at < v_now - interval '6 months'
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$privacy_retention_preview$;

REVOKE ALL ON FUNCTION public.get_admin_privacy_retention_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_privacy_retention_preview() TO authenticated;

DO $privacy_retention_postcheck$
DECLARE
  v_analytics_fingerprint text;
  v_reports_fingerprint text;
  v_policy_fingerprint text;
  v_table_acl_fingerprint text;
  v_preview_oid oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'info_reports'
      AND column_name = 'completed_at'
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: completed_at contract mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM public.info_reports WHERE completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: existing reports were backfilled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.info_reports'::regclass
      AND NOT tgisinternal
      AND tgname = 'info_reports_completed_at'
      AND tgenabled = 'O'
      AND tgfoid = 'public.set_info_report_completed_at()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: completed_at trigger mismatch';
  END IF;

  v_preview_oid := to_regprocedure('public.get_admin_privacy_retention_preview()');
  IF v_preview_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = v_preview_oid
      AND prorettype = 'jsonb'::regtype
      AND pronargs = 0
      AND prosecdef
      AND proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%public.is_admin()%'
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%server_received_at < v_now - interval ''2 years''%'
      AND pg_catalog.pg_get_functiondef(oid) LIKE '%completed_at < v_now - interval ''6 months''%'
  ) THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: preview RPC contract mismatch';
  END IF;

  IF has_function_privilege('anon', v_preview_oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_preview_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(COALESCE(
        (SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_preview_oid),
        pg_catalog.acldefault('f', (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_preview_oid))
      )) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: preview RPC grants mismatch';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id)::text, '[]'))
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(report_row) - 'completed_at' ORDER BY report_row.id)::text, '[]'))
  INTO v_reports_fingerprint
  FROM public.info_reports AS report_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(policy_row) ORDER BY policy_row.tablename, policy_row.policyname)::text, '[]'))
  INTO v_policy_fingerprint
  FROM pg_catalog.pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN ('analytics_events', 'info_reports');

  SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('table', class_row.relname, 'acl', class_row.relacl) ORDER BY class_row.relname)::text, '[]'))
  INTO v_table_acl_fingerprint
  FROM pg_catalog.pg_class AS class_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname IN ('analytics_events', 'info_reports');

  IF v_analytics_fingerprint <> current_setting('mukjji.privacy_analytics_fingerprint')
    OR v_reports_fingerprint <> current_setting('mukjji.privacy_reports_fingerprint')
    OR v_policy_fingerprint <> current_setting('mukjji.privacy_policy_fingerprint')
    OR v_table_acl_fingerprint <> current_setting('mukjji.privacy_table_acl_fingerprint') THEN
    RAISE EXCEPTION 'Privacy retention post-check failed: existing data or table security changed';
  END IF;
END;
$privacy_retention_postcheck$;

COMMIT;
