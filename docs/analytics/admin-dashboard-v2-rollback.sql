BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $admin_analytics_range_rollback_precheck$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)') IS NULL THEN
    RAISE EXCEPTION 'Admin Analytics range rollback stopped: range RPC is missing';
  END IF;
  IF to_regprocedure('public.get_admin_analytics_dashboard()') IS NULL THEN
    RAISE EXCEPTION 'Admin Analytics range rollback stopped: existing dashboard RPC is missing';
  END IF;
END;
$admin_analytics_range_rollback_precheck$;

REVOKE ALL ON FUNCTION public.get_admin_analytics_dashboard_range(date, date) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.get_admin_analytics_dashboard_range(date, date);

DO $admin_analytics_range_rollback_postcheck$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)') IS NOT NULL
    OR to_regprocedure('public.get_admin_analytics_dashboard()') IS NULL THEN
    RAISE EXCEPTION 'Admin Analytics range rollback failed';
  END IF;
END;
$admin_analytics_range_rollback_postcheck$;

COMMIT;
