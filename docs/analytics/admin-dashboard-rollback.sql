BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $admin_dashboard_rollback_precheck$
DECLARE
  v_function_oid oid;
BEGIN
  v_function_oid := to_regprocedure('public.get_admin_analytics_dashboard()');
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Admin dashboard rollback stopped: RPC is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = v_function_oid
      AND procedure_row.prorettype = 'jsonb'::regtype
      AND procedure_row.pronargs = 0
      AND procedure_row.prosecdef
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%public.is_admin()%'
  ) THEN
    RAISE EXCEPTION 'Admin dashboard rollback stopped: RPC contract drifted';
  END IF;
END;
$admin_dashboard_rollback_precheck$;

REVOKE ALL ON FUNCTION public.get_admin_analytics_dashboard() FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.get_admin_analytics_dashboard();

DO $admin_dashboard_rollback_postcheck$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_dashboard()') IS NOT NULL THEN
    RAISE EXCEPTION 'Admin dashboard rollback failed: RPC remains';
  END IF;
END;
$admin_dashboard_rollback_postcheck$;

COMMIT;
