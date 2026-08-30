-- BLOCKED BY DEFAULT. Prepare only after Preview, Backup, recount, and explicit approval.
BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $privacy_retention_delete$
DECLARE
  v_now timestamptz := current_timestamp;
  v_expected_analytics_count bigint := -1;
  v_expected_report_ids uuid[] := NULL;
  v_confirmation text := 'NOT APPROVED';
  v_actual_analytics_count bigint;
  v_actual_report_ids uuid[];
  v_deleted_analytics_count bigint;
  v_deleted_report_count bigint;
  v_expected_confirmation text;
BEGIN
  IF NOT (current_user = 'postgres' AND session_user = 'postgres')
    AND public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Privacy retention delete stopped: trusted operator authorization required' USING ERRCODE = '42501';
  END IF;

  IF v_expected_analytics_count < 0 OR v_expected_report_ids IS NULL THEN
    RAISE EXCEPTION 'Privacy retention delete stopped: expected targets are not configured';
  END IF;

  v_expected_report_ids := ARRAY(
    SELECT target_id FROM unnest(v_expected_report_ids) AS target_id ORDER BY target_id
  );
  v_expected_confirmation := format(
    'DELETE EXPIRED PRIVACY DATA: analytics=%s; reports=%s',
    v_expected_analytics_count,
    cardinality(v_expected_report_ids)
  );

  IF v_confirmation IS DISTINCT FROM v_expected_confirmation THEN
    RAISE EXCEPTION 'Privacy retention delete stopped: confirmation text mismatch';
  END IF;

  SELECT count(*)
  INTO v_actual_analytics_count
  FROM public.analytics_events AS event_row
  WHERE event_row.server_received_at < v_now - interval '2 years';

  SELECT COALESCE(array_agg(report_row.id ORDER BY report_row.id), ARRAY[]::uuid[])
  INTO v_actual_report_ids
  FROM public.info_reports AS report_row
  WHERE report_row.status IN ('done', 'rejected')
    AND report_row.completed_at IS NOT NULL
    AND report_row.completed_at < v_now - interval '6 months';

  IF v_actual_analytics_count <> v_expected_analytics_count
    OR v_actual_report_ids IS DISTINCT FROM v_expected_report_ids THEN
    RAISE EXCEPTION 'Privacy retention delete stopped: preview targets changed';
  END IF;

  DELETE FROM public.analytics_events AS event_row
  WHERE event_row.server_received_at < v_now - interval '2 years';
  GET DIAGNOSTICS v_deleted_analytics_count = ROW_COUNT;

  DELETE FROM public.info_reports AS report_row
  WHERE report_row.status IN ('done', 'rejected')
    AND report_row.completed_at IS NOT NULL
    AND report_row.completed_at < v_now - interval '6 months'
    AND report_row.id = ANY(v_expected_report_ids);
  GET DIAGNOSTICS v_deleted_report_count = ROW_COUNT;

  IF v_deleted_analytics_count <> v_expected_analytics_count
    OR v_deleted_report_count <> cardinality(v_expected_report_ids)
    OR EXISTS (
      SELECT 1 FROM public.analytics_events
      WHERE server_received_at < v_now - interval '2 years'
    )
    OR EXISTS (
      SELECT 1 FROM public.info_reports
      WHERE status IN ('done', 'rejected')
        AND completed_at IS NOT NULL
        AND completed_at < v_now - interval '6 months'
    ) THEN
    RAISE EXCEPTION 'Privacy retention delete stopped: post-delete verification failed';
  END IF;
END;
$privacy_retention_delete$;

COMMIT;
