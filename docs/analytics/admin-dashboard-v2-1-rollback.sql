BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $admin_analytics_daily_rollback_precheck$
DECLARE
  v_function_oid oid := to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)');
  v_definition text;
  v_analytics_fingerprint text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(procedure_row.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid = v_function_oid
    AND procedure_row.prorettype = 'jsonb'::regtype
    AND procedure_row.prosecdef
    AND procedure_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) = 'p_start_date date, p_end_date date';

  IF v_definition IS NULL
    OR v_definition NOT LIKE '%' || quote_literal('completed_sessions') || '%'
    OR v_definition NOT LIKE '%' || quote_literal('returning_sessions') || '%' THEN
    RAISE EXCEPTION 'Admin Analytics daily metrics rollback precheck failed: v2.1 contract mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin Analytics daily metrics rollback precheck failed: grants mismatch';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id), '[]'::jsonb)::text)
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  PERFORM set_config('mukjji.admin_analytics_daily_rollback_data', v_analytics_fingerprint, true);
END;
$admin_analytics_daily_rollback_precheck$;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_dashboard_range(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $admin_analytics_range$
DECLARE
  v_server_today date := (current_timestamp AT TIME ZONE 'Asia/Seoul')::date;
  v_start_date date;
  v_end_date date;
  v_day_count integer;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin analytics access denied' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL AND p_end_date IS NULL THEN
    v_start_date := v_server_today - 6;
    v_end_date := v_server_today;
  ELSIF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Analytics range requires both start and end dates' USING ERRCODE = '22023';
  ELSE
    v_start_date := p_start_date;
    v_end_date := p_end_date;
  END IF;

  IF v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Analytics range start date must not be after end date' USING ERRCODE = '22023';
  END IF;
  IF v_end_date > v_server_today THEN
    RAISE EXCEPTION 'Analytics range end date must not be in the future' USING ERRCODE = '22023';
  END IF;

  v_day_count := v_end_date - v_start_date + 1;
  IF v_day_count > 731 THEN
    RAISE EXCEPTION 'Analytics range must be 731 calendar days or fewer' USING ERRCODE = '22023';
  END IF;

  v_start_at := v_start_date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_end_at := (v_end_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul';

  WITH
  internal_test_sessions AS MATERIALIZED (
    SELECT DISTINCT event_row.session_id
    FROM public.analytics_events AS event_row
    WHERE event_row.event_name = 'session_start'
      AND event_row.acquisition_source = 'internal_test'
  ),
  eligible_events AS MATERIALIZED (
    SELECT event_row.*
    FROM public.analytics_events AS event_row
    WHERE NOT EXISTS (
      SELECT 1
      FROM internal_test_sessions AS test_session
      WHERE test_session.session_id = event_row.session_id
    )
  ),
  availability AS (
    SELECT
      min((event_row.server_received_at AT TIME ZONE 'Asia/Seoul')::date) AS analytics_available_from,
      min((event_row.server_received_at AT TIME ZONE 'Asia/Seoul')::date) FILTER (
        WHERE event_row.event_name = 'session_start'
          AND event_row.is_returning IS NOT NULL
          AND event_row.first_acquisition_source IS DISTINCT FROM 'internal_test'
      ) AS retention_measured_from
    FROM eligible_events AS event_row
  ),
  range_events AS MATERIALIZED (
    SELECT event_row.*
    FROM eligible_events AS event_row
    WHERE event_row.server_received_at >= v_start_at
      AND event_row.server_received_at < v_end_at
  ),
  range_session_starts AS MATERIALIZED (
    SELECT DISTINCT ON (event_row.session_id)
      event_row.session_id,
      event_row.acquisition_source,
      event_row.is_returning,
      event_row.return_gap,
      event_row.first_acquisition_source,
      event_row.server_received_at,
      event_row.event_id
    FROM range_events AS event_row
    WHERE event_row.event_name = 'session_start'
    ORDER BY event_row.session_id, event_row.server_received_at ASC, event_row.event_id ASC
  ),
  complete_recommendations AS (
    SELECT event_row.recommendation_id, event_row.session_id, event_row.source_context
    FROM range_events AS event_row
    WHERE event_row.event_name = 'recommendation_shown'
      AND event_row.recommendation_id IS NOT NULL
      AND event_row.menu_id IS NOT NULL
      AND event_row.source_context IN ('discovery', 'personalized')
    GROUP BY event_row.recommendation_id, event_row.session_id, event_row.source_context
    HAVING count(*) = 3
      AND count(DISTINCT event_row.position) = 3
      AND min(event_row.position) = 1
      AND max(event_row.position) = 3
      AND count(DISTINCT event_row.menu_id) = 3
  ),
  completed_sessions AS (
    SELECT DISTINCT complete_row.session_id
    FROM complete_recommendations AS complete_row
    JOIN range_session_starts AS session_row ON session_row.session_id = complete_row.session_id
  ),
  summary_metrics AS (
    SELECT
      (SELECT count(*) FROM range_session_starts) AS sessions,
      (SELECT count(*) FROM completed_sessions) AS completed_sessions,
      count(*) FILTER (WHERE event_name = 'recommendation_refresh') AS refreshes,
      count(*) FILTER (WHERE event_name = 'menu_card_open') AS menu_detail_opens,
      count(*) FILTER (WHERE event_name = 'map_open') AS map_opens,
      count(*) FILTER (WHERE event_name = 'share_recommendation') AS shares,
      count(*) FILTER (WHERE event_name = 'recommendation_error') AS errors,
      count(*) FILTER (WHERE event_name = 'eaten_record_added') AS eaten_records
    FROM range_events
  ),
  acquisition_metrics AS (
    SELECT jsonb_build_object(
      'direct', count(*) FILTER (WHERE acquisition_source = 'direct'),
      'everytime', count(*) FILTER (WHERE acquisition_source = 'everytime'),
      'kakao', count(*) FILTER (WHERE acquisition_source = 'kakao'),
      'instagram', count(*) FILTER (WHERE acquisition_source = 'instagram'),
      'poster_qr', count(*) FILTER (WHERE acquisition_source = 'poster_qr'),
      'share', count(*) FILTER (WHERE acquisition_source = 'share'),
      'other', count(*) FILTER (WHERE acquisition_source = 'other')
    ) AS regular_sources
    FROM range_session_starts
  ),
  internal_test_metric AS (
    SELECT count(DISTINCT event_row.session_id) AS sessions
    FROM public.analytics_events AS event_row
    WHERE event_row.event_name = 'session_start'
      AND event_row.acquisition_source = 'internal_test'
      AND event_row.server_received_at >= v_start_at
      AND event_row.server_received_at < v_end_at
  ),
  daily_dates AS (
    SELECT generated_date::date AS date
    FROM generate_series(v_start_date::timestamp, v_end_date::timestamp, interval '1 day') AS generated_date
  ),
  daily_metrics AS (
    SELECT date_row.date, count(session_row.session_id) AS sessions
    FROM daily_dates AS date_row
    LEFT JOIN range_session_starts AS session_row
      ON (session_row.server_received_at AT TIME ZONE 'Asia/Seoul')::date = date_row.date
    GROUP BY date_row.date
  ),
  daily_result AS (
    SELECT jsonb_agg(
      jsonb_build_object('date', metric.date, 'sessions', metric.sessions)
      ORDER BY metric.date ASC
    ) AS rows
    FROM daily_metrics AS metric
  ),
  restaurant_metrics AS (
    SELECT
      event_row.restaurant_id,
      count(*) FILTER (WHERE event_row.event_name = 'recommendation_shown') AS recommendation_exposures,
      count(*) FILTER (WHERE event_row.event_name = 'menu_card_open') AS menu_detail_opens,
      count(*) FILTER (WHERE event_row.event_name = 'map_open') AS map_opens,
      count(*) FILTER (WHERE event_row.event_name = 'eaten_record_added') AS eaten_records
    FROM range_events AS event_row
    WHERE event_row.restaurant_id IS NOT NULL
      AND event_row.event_name IN ('recommendation_shown', 'menu_card_open', 'map_open', 'eaten_record_added')
    GROUP BY event_row.restaurant_id
  ),
  restaurant_result AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'restaurant_id', metric.restaurant_id,
          'restaurant_name', COALESCE(restaurant.name, '삭제된 가게'),
          'recommendation_exposures', metric.recommendation_exposures,
          'menu_detail_opens', metric.menu_detail_opens,
          'map_opens', metric.map_opens,
          'eaten_records', metric.eaten_records
        )
        ORDER BY metric.map_opens DESC,
          metric.menu_detail_opens DESC,
          metric.recommendation_exposures DESC,
          COALESCE(restaurant.name, '삭제된 가게') ASC
      ),
      '[]'::jsonb
    ) AS rows
    FROM restaurant_metrics AS metric
    LEFT JOIN public.restaurants AS restaurant ON restaurant.id = metric.restaurant_id
  ),
  retention_metrics AS (
    SELECT
      count(*) FILTER (WHERE is_returning IS NOT NULL) AS measured_sessions,
      count(*) FILTER (WHERE is_returning IS false) AS new_sessions,
      count(*) FILTER (WHERE is_returning IS true) AS returning_sessions,
      count(*) FILTER (WHERE is_returning IS NULL) AS unmeasured_sessions
    FROM range_session_starts
    WHERE first_acquisition_source IS DISTINCT FROM 'internal_test'
  ),
  retention_gap_metrics AS (
    SELECT jsonb_build_object(
      'same_day', count(*) FILTER (WHERE is_returning IS true AND return_gap = 'same_day'),
      '1d', count(*) FILTER (WHERE is_returning IS true AND return_gap = '1d'),
      '2_3d', count(*) FILTER (WHERE is_returning IS true AND return_gap = '2_3d'),
      '4_7d', count(*) FILTER (WHERE is_returning IS true AND return_gap = '4_7d'),
      '8_30d', count(*) FILTER (WHERE is_returning IS true AND return_gap = '8_30d'),
      '31d_plus', count(*) FILTER (WHERE is_returning IS true AND return_gap = '31d_plus')
    ) AS rows
    FROM range_session_starts
    WHERE first_acquisition_source IS DISTINCT FROM 'internal_test'
  ),
  first_acquisition_metrics AS (
    SELECT jsonb_build_object(
      'direct', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'direct' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'direct' AND is_returning IS true)),
      'everytime', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'everytime' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'everytime' AND is_returning IS true)),
      'kakao', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'kakao' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'kakao' AND is_returning IS true)),
      'instagram', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'instagram' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'instagram' AND is_returning IS true)),
      'poster_qr', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'poster_qr' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'poster_qr' AND is_returning IS true)),
      'share', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'share' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'share' AND is_returning IS true)),
      'other', jsonb_build_object('new_sessions', count(*) FILTER (WHERE first_acquisition_source = 'other' AND is_returning IS false), 'returning_sessions', count(*) FILTER (WHERE first_acquisition_source = 'other' AND is_returning IS true))
    ) AS rows
    FROM range_session_starts
    WHERE first_acquisition_source IS DISTINCT FROM 'internal_test'
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date,
      'day_count', v_day_count,
      'server_today', v_server_today,
      'analytics_available_from', availability.analytics_available_from,
      'retention_measured_from', availability.retention_measured_from
    ),
    'summary', jsonb_build_object(
      'sessions', summary.sessions,
      'completed_sessions', summary.completed_sessions,
      'completion_rate', CASE WHEN summary.sessions = 0 THEN NULL ELSE round((summary.completed_sessions::numeric * 100) / summary.sessions, 1) END,
      'refreshes', summary.refreshes,
      'menu_detail_opens', summary.menu_detail_opens,
      'map_opens', summary.map_opens,
      'shares', summary.shares,
      'errors', summary.errors,
      'eaten_records', summary.eaten_records
    ),
    'acquisition', acquisition.regular_sources || jsonb_build_object('internal_test', internal_test.sessions),
    'daily', daily.rows,
    'restaurants', restaurant_result.rows,
    'retention', jsonb_build_object(
      'measured_sessions', retention.measured_sessions,
      'new_sessions', retention.new_sessions,
      'returning_sessions', retention.returning_sessions,
      'unmeasured_sessions', retention.unmeasured_sessions,
      'returning_session_share', CASE WHEN retention.measured_sessions = 0 THEN NULL ELSE round((retention.returning_sessions::numeric * 100) / retention.measured_sessions, 1) END,
      'return_gap', retention_gap.rows,
      'first_acquisition_source', first_acquisition.rows
    )
  )
  INTO v_result
  FROM summary_metrics AS summary
  CROSS JOIN acquisition_metrics AS acquisition
  CROSS JOIN internal_test_metric AS internal_test
  CROSS JOIN daily_result AS daily
  CROSS JOIN restaurant_result
  CROSS JOIN retention_metrics AS retention
  CROSS JOIN retention_gap_metrics AS retention_gap
  CROSS JOIN first_acquisition_metrics AS first_acquisition
  CROSS JOIN availability;

  RETURN v_result;
END;
$admin_analytics_range$;

REVOKE ALL ON FUNCTION public.get_admin_analytics_dashboard_range(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_dashboard_range(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_analytics_dashboard_range(date, date)
IS 'Returns admin-only aggregate Analytics for an inclusive Asia/Seoul calendar date range.';

DO $admin_analytics_daily_rollback_postcheck$
DECLARE
  v_function_oid oid := to_regprocedure('public.get_admin_analytics_dashboard_range(date,date)');
  v_definition text;
  v_public_execute boolean;
  v_analytics_fingerprint text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(procedure_row.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid = v_function_oid
    AND procedure_row.prorettype = 'jsonb'::regtype
    AND procedure_row.prosecdef
    AND procedure_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) = 'p_start_date date, p_end_date date';

  IF v_definition IS NULL
    OR position('jsonb_build_object(''date'', metric.date, ''sessions'', metric.sessions)' in v_definition) = 0
    OR position('''completed_sessions'', metric.completed_sessions' in v_definition) > 0
    OR position('''returning_sessions'', metric.returning_sessions' in v_definition) > 0 THEN
    RAISE EXCEPTION 'Admin Analytics daily metrics rollback postcheck failed: v2 contract was not restored';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
    ) AS acl_row
    WHERE procedure_row.oid = v_function_oid
      AND acl_row.grantee = 0
      AND acl_row.privilege_type = 'EXECUTE'
  ) INTO v_public_execute;

  IF v_public_execute
    OR has_function_privilege('anon', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.get_admin_analytics_dashboard_range(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin Analytics daily metrics rollback postcheck failed: grants mismatch';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id), '[]'::jsonb)::text)
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  IF v_analytics_fingerprint <> current_setting('mukjji.admin_analytics_daily_rollback_data') THEN
    RAISE EXCEPTION 'Admin Analytics daily metrics rollback postcheck failed: Analytics rows changed';
  END IF;
END;
$admin_analytics_daily_rollback_postcheck$;

COMMIT;
