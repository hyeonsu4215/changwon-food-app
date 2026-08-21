-- ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.
BEGIN;

DO $rollback_guard$
BEGIN
  IF to_regclass('public.restaurant_weekly_hours') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours rollback preview stopped: target table does not exist';
  END IF;

  IF (SELECT count(*) FROM public.restaurant_weekly_hours) <> 0 THEN
    RAISE EXCEPTION 'Weekly hours rollback preview stopped: target table is not empty';
  END IF;
END;
$rollback_guard$;

DROP TRIGGER restaurant_weekly_hours_updated_at
ON public.restaurant_weekly_hours;

DROP POLICY "Admins can manage restaurant weekly hours"
ON public.restaurant_weekly_hours;

DROP POLICY "Active restaurant weekly hours are readable by everyone"
ON public.restaurant_weekly_hours;

DROP TABLE public.restaurant_weekly_hours;

-- This preview always rolls back. A separately approved rollback package is required.
ROLLBACK;
