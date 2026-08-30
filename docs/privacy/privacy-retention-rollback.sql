BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $privacy_retention_rollback_precheck$
BEGIN
  IF to_regprocedure('public.get_admin_privacy_retention_preview()') IS NULL
    OR to_regprocedure('public.set_info_report_completed_at()') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'info_reports' AND column_name = 'completed_at'
    ) THEN
    RAISE EXCEPTION 'Privacy retention rollback stopped: installed contract is incomplete';
  END IF;

  IF EXISTS (SELECT 1 FROM public.info_reports WHERE completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Privacy retention rollback stopped: completed_at contains operational data';
  END IF;
END;
$privacy_retention_rollback_precheck$;

REVOKE ALL ON FUNCTION public.get_admin_privacy_retention_preview() FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.get_admin_privacy_retention_preview();

DROP TRIGGER info_reports_completed_at ON public.info_reports;
DROP FUNCTION public.set_info_report_completed_at();

ALTER TABLE public.info_reports
DROP COLUMN completed_at;

DO $privacy_retention_rollback_postcheck$
BEGIN
  IF to_regprocedure('public.get_admin_privacy_retention_preview()') IS NOT NULL
    OR to_regprocedure('public.set_info_report_completed_at()') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'info_reports' AND column_name = 'completed_at'
    ) THEN
    RAISE EXCEPTION 'Privacy retention rollback post-check failed';
  END IF;
END;
$privacy_retention_rollback_postcheck$;

COMMIT;
