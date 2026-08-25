BEGIN;

SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $admin_analytics_preflight$
DECLARE
  v_dashboard_function_count integer;
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
  v_analytics_fingerprint text;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: analytics_events is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name = 'acquisition_source'
      AND data_type = 'text'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: acquisition_source contract mismatch';
  END IF;

  IF to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'
  ) IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'log_analytics_event'
  ) <> 1 THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: ingestion RPC contract mismatch';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.is_admin()'::regprocedure
      AND procedure_row.prorettype = 'boolean'::regtype
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%public.admin_users%'
  ) THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: is_admin contract mismatch';
  END IF;

  SELECT count(*)
  INTO v_dashboard_function_count
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND procedure_row.proname = 'get_admin_analytics_dashboard';

  IF v_dashboard_function_count <> 0 THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: dashboard RPC already exists';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'analytics_events'
    )
    OR has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'SELECT') THEN
    RAISE EXCEPTION 'Admin analytics preflight failed: raw table security mismatch';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS menu;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(weekly_row) ORDER BY weekly_row.restaurant_id, weekly_row.iso_weekday), '[]'::jsonb)::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS weekly_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id), '[]'::jsonb)::text)
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  PERFORM set_config('mukjji.admin_analytics_restaurants_fingerprint', v_restaurants_fingerprint, true);
  PERFORM set_config('mukjji.admin_analytics_menus_fingerprint', v_menus_fingerprint, true);
  PERFORM set_config('mukjji.admin_analytics_weekly_fingerprint', v_weekly_hours_fingerprint, true);
  PERFORM set_config('mukjji.admin_analytics_events_fingerprint', v_analytics_fingerprint, true);
END;
$admin_analytics_preflight$;

CREATE FUNCTION public.get_admin_analytics_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $admin_analytics_dashboard$
DECLARE
  v_result jsonb;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin analytics access denied' USING ERRCODE = '42501';
  END IF;

  WITH
  bounds AS (
    SELECT
      ((current_timestamp AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul') AS today_start,
      ((((current_timestamp AT TIME ZONE 'Asia/Seoul')::date + 1)::timestamp) AT TIME ZONE 'Asia/Seoul') AS tomorrow_start,
      ((((current_timestamp AT TIME ZONE 'Asia/Seoul')::date - 6)::timestamp) AT TIME ZONE 'Asia/Seoul') AS seven_day_start
  ),
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
  today_events AS MATERIALIZED (
    SELECT event_row.*
    FROM eligible_events AS event_row
    CROSS JOIN bounds
    WHERE event_row.server_received_at >= bounds.today_start
      AND event_row.server_received_at < bounds.tomorrow_start
  ),
  seven_day_events AS MATERIALIZED (
    SELECT event_row.*
    FROM eligible_events AS event_row
    CROSS JOIN bounds
    WHERE event_row.server_received_at >= bounds.seven_day_start
      AND event_row.server_received_at < bounds.tomorrow_start
  ),
  today_sessions AS (
    SELECT DISTINCT event_row.session_id
    FROM today_events AS event_row
    WHERE event_row.event_name = 'session_start'
  ),
  seven_day_sessions AS (
    SELECT DISTINCT event_row.session_id
    FROM seven_day_events AS event_row
    WHERE event_row.event_name = 'session_start'
  ),
  today_complete_recommendations AS (
    SELECT event_row.recommendation_id, event_row.session_id, event_row.source_context
    FROM today_events AS event_row
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
  seven_day_complete_recommendations AS (
    SELECT event_row.recommendation_id, event_row.session_id, event_row.source_context
    FROM seven_day_events AS event_row
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
  today_completed_sessions AS (
    SELECT DISTINCT complete_row.session_id
    FROM today_complete_recommendations AS complete_row
    JOIN today_sessions AS session_row ON session_row.session_id = complete_row.session_id
  ),
  seven_day_completed_sessions AS (
    SELECT DISTINCT complete_row.session_id
    FROM seven_day_complete_recommendations AS complete_row
    JOIN seven_day_sessions AS session_row ON session_row.session_id = complete_row.session_id
  ),
  today_metrics AS (
    SELECT
      (SELECT count(*) FROM today_sessions) AS sessions,
      (SELECT count(*) FROM today_completed_sessions) AS completed_sessions,
      count(*) FILTER (WHERE event_name = 'recommendation_refresh') AS refreshes,
      count(*) FILTER (WHERE event_name = 'menu_card_open') AS menu_detail_opens,
      count(*) FILTER (WHERE event_name = 'map_open') AS map_opens,
      count(*) FILTER (WHERE event_name = 'share_recommendation') AS shares,
      count(*) FILTER (WHERE event_name = 'recommendation_error') AS errors
    FROM today_events
  ),
  seven_day_metrics AS (
    SELECT
      (SELECT count(*) FROM seven_day_sessions) AS sessions,
      (SELECT count(*) FROM seven_day_completed_sessions) AS completed_sessions,
      count(*) FILTER (WHERE event_name = 'map_open') AS map_opens
    FROM seven_day_events
  ),
  acquisition_metrics AS (
    SELECT jsonb_build_object(
      'direct', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'direct'),
      'everytime', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'everytime'),
      'kakao', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'kakao'),
      'instagram', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'instagram'),
      'poster_qr', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'poster_qr'),
      'share', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'share'),
      'other', count(DISTINCT session_id) FILTER (WHERE acquisition_source = 'other')
    ) AS regular_sources
    FROM today_events
    WHERE event_name = 'session_start'
  ),
  internal_test_metric AS (
    SELECT count(DISTINCT event_row.session_id) AS sessions
    FROM public.analytics_events AS event_row
    CROSS JOIN bounds
    WHERE event_row.event_name = 'session_start'
      AND event_row.acquisition_source = 'internal_test'
      AND event_row.server_received_at >= bounds.today_start
      AND event_row.server_received_at < bounds.tomorrow_start
  ),
  restaurant_metrics AS (
    SELECT
      event_row.restaurant_id,
      count(*) FILTER (WHERE event_row.event_name = 'recommendation_shown') AS recommendation_exposures,
      count(*) FILTER (WHERE event_row.event_name = 'menu_card_open') AS menu_detail_opens,
      count(*) FILTER (WHERE event_row.event_name = 'map_open') AS map_opens
    FROM seven_day_events AS event_row
    WHERE event_row.restaurant_id IS NOT NULL
      AND event_row.event_name IN ('recommendation_shown', 'menu_card_open', 'map_open')
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
          'map_opens', metric.map_opens
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
  )
  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'sessions', today.sessions,
      'completed_sessions', today.completed_sessions,
      'completion_rate', CASE
        WHEN today.sessions = 0 THEN NULL
        ELSE round((today.completed_sessions::numeric * 100) / today.sessions, 1)
      END,
      'refreshes', today.refreshes,
      'menu_detail_opens', today.menu_detail_opens,
      'map_opens', today.map_opens,
      'shares', today.shares,
      'errors', today.errors
    ),
    'acquisition', acquisition.regular_sources || jsonb_build_object('internal_test', internal_test.sessions),
    'last_7_days', jsonb_build_object(
      'sessions', seven_days.sessions,
      'completed_sessions', seven_days.completed_sessions,
      'map_opens', seven_days.map_opens
    ),
    'restaurants', restaurant_result.rows
  )
  INTO v_result
  FROM today_metrics AS today
  CROSS JOIN seven_day_metrics AS seven_days
  CROSS JOIN acquisition_metrics AS acquisition
  CROSS JOIN internal_test_metric AS internal_test
  CROSS JOIN restaurant_result;

  RETURN v_result;
END;
$admin_analytics_dashboard$;

REVOKE ALL ON FUNCTION public.get_admin_analytics_dashboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_dashboard() TO authenticated;

DO $admin_analytics_postcheck$
DECLARE
  v_function_oid oid;
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
  v_analytics_fingerprint text;
BEGIN
  v_function_oid := to_regprocedure('public.get_admin_analytics_dashboard()');

  IF v_function_oid IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'get_admin_analytics_dashboard'
  ) <> 1 THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: dashboard RPC count mismatch';
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
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%Asia/Seoul%'
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%internal_test_sessions%'
  ) THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: dashboard RPC contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
    ) AS acl
    WHERE procedure_row.oid = v_function_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: dashboard RPC grants mismatch';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'analytics_events'
    )
    OR has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'SELECT') THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: raw table security changed';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname = 'public' AND tablename = 'analytics_events') <> 5 THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: analytics indexes changed';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS menu;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(weekly_row) ORDER BY weekly_row.restaurant_id, weekly_row.iso_weekday), '[]'::jsonb)::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS weekly_row;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_id), '[]'::jsonb)::text)
  INTO v_analytics_fingerprint
  FROM public.analytics_events AS event_row;

  IF v_restaurants_fingerprint <> current_setting('mukjji.admin_analytics_restaurants_fingerprint')
    OR v_menus_fingerprint <> current_setting('mukjji.admin_analytics_menus_fingerprint')
    OR v_weekly_hours_fingerprint <> current_setting('mukjji.admin_analytics_weekly_fingerprint')
    OR v_analytics_fingerprint <> current_setting('mukjji.admin_analytics_events_fingerprint') THEN
    RAISE EXCEPTION 'Admin analytics post-check failed: existing data changed';
  END IF;
END;
$admin_analytics_postcheck$;

COMMIT;
