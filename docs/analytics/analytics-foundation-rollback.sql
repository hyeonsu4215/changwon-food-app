-- PREPARED ROLLBACK. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $analytics_rollback_guard$
DECLARE
  v_function_oid oid;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Analytics rollback stopped: target table does not exist';
  END IF;

  v_function_oid := to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'
  );

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Analytics rollback stopped: ingestion RPC does not exist';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0 THEN
    RAISE EXCEPTION 'Analytics rollback stopped: analytics_events is not empty';
  END IF;
END;
$analytics_rollback_guard$;

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
);

DROP TABLE public.analytics_events;

DO $analytics_rollback_postcheck$
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Analytics rollback failed: target table remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'log_analytics_event'
  ) THEN
    RAISE EXCEPTION 'Analytics rollback failed: ingestion RPC remains';
  END IF;
END;
$analytics_rollback_postcheck$;

COMMIT;
