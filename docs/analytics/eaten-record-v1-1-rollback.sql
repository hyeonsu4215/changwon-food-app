-- RUN ONLY AFTER SEPARATE APPROVAL. FAILS CLOSED WHEN V1.1 DATA EXISTS.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $eaten_analytics_rollback_preflight$
DECLARE
  v_constraint_definition text;
  v_event_names text[];
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Eaten Analytics rollback blocked: analytics_events is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.analytics_events
    WHERE event_name = 'eaten_record_added'
  ) THEN
    RAISE EXCEPTION 'Eaten Analytics rollback blocked: eaten_record_added rows exist';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
    AND constraint_row.conname = 'analytics_events_event_name_allowed';

  SELECT array_agg(match_row[1] ORDER BY match_row[1])
  INTO v_event_names
  FROM pg_catalog.regexp_matches(
    COALESCE(v_constraint_definition, ''),
    '''([^'']+)''::text',
    'g'
  ) AS match_row;

  IF v_event_names IS DISTINCT FROM ARRAY['eaten_record_added', 'map_open', 'menu_card_open', 'recommendation_error', 'recommendation_refresh', 'recommendation_shown', 'session_start', 'share_recommendation']::text[]
    OR to_regprocedure('public.log_analytics_event(uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text)') IS NULL
    OR to_regprocedure('public.get_admin_analytics_dashboard()') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = 'public.log_analytics_event(uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text)'::regprocedure
        AND pg_catalog.pg_get_functiondef(oid) LIKE '%invalid eaten_record_added fields%'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = 'public.get_admin_analytics_dashboard()'::regprocedure
        AND pg_catalog.pg_get_functiondef(oid) LIKE '%eaten_records%'
        AND pg_catalog.pg_get_functiondef(oid) LIKE '%internal_test_sessions AS MATERIALIZED%'
    ) THEN
    RAISE EXCEPTION 'Eaten Analytics rollback blocked: V1.1 contract is not active';
  END IF;
END;
$eaten_analytics_rollback_preflight$;

ALTER TABLE public.analytics_events
DROP CONSTRAINT analytics_events_event_name_allowed;

ALTER TABLE public.analytics_events
ADD CONSTRAINT analytics_events_event_name_allowed CHECK (
  event_name IN (
    'session_start',
    'recommendation_shown',
    'recommendation_refresh',
    'menu_card_open',
    'map_open',
    'share_recommendation',
    'recommendation_error'
  )
);

CREATE OR REPLACE FUNCTION public.log_analytics_event(
  p_event_id uuid,
  p_event_name text,
  p_occurred_at timestamptz,
  p_session_id uuid,
  p_recommendation_id uuid DEFAULT NULL,
  p_restaurant_id text DEFAULT NULL,
  p_menu_id text DEFAULT NULL,
  p_position smallint DEFAULT NULL,
  p_source_context text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_item_count smallint DEFAULT NULL,
  p_share_method text DEFAULT NULL,
  p_acquisition_source text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $analytics_rpc$
DECLARE
  v_inserted_count integer;
  v_menu_restaurant_id text;
BEGIN
  IF p_event_id IS NULL OR p_event_name IS NULL OR p_occurred_at IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'Analytics event rejected: missing required identity field'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_name NOT IN (
    'session_start',
    'recommendation_shown',
    'recommendation_refresh',
    'menu_card_open',
    'map_open',
    'share_recommendation',
    'recommendation_error'
  ) THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid event name'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_context IS NOT NULL
    AND p_source_context NOT IN ('discovery', 'personalized', 'shared_pick', 'search') THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid source context'
      USING ERRCODE = '22023';
  END IF;

  IF p_acquisition_source IS NOT NULL
    AND p_acquisition_source NOT IN (
      'direct', 'everytime', 'kakao', 'instagram', 'poster_qr', 'share', 'internal_test', 'other'
    ) THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid acquisition source'
      USING ERRCODE = '22023';
  END IF;

  IF p_position IS NOT NULL AND p_position NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid position'
      USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NOT NULL
    AND p_error_code NOT IN ('insufficient_candidates', 'invalid_result', 'data_unavailable', 'unknown') THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid error code'
      USING ERRCODE = '22023';
  END IF;

  IF p_item_count IS NOT NULL AND p_item_count NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid item count'
      USING ERRCODE = '22023';
  END IF;

  IF p_share_method IS NOT NULL AND p_share_method NOT IN ('web_share', 'clipboard') THEN
    RAISE EXCEPTION 'Analytics event rejected: invalid share method'
      USING ERRCODE = '22023';
  END IF;

  IF p_occurred_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
    OR p_occurred_at > pg_catalog.statement_timestamp() + INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Analytics event rejected: implausible occurred_at'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_name = 'session_start' THEN
    IF p_acquisition_source IS NULL
      OR p_recommendation_id IS NOT NULL
      OR p_restaurant_id IS NOT NULL
      OR p_menu_id IS NOT NULL
      OR p_position IS NOT NULL
      OR p_source_context IS NOT NULL
      OR p_error_code IS NOT NULL
      OR p_item_count IS NOT NULL
      OR p_share_method IS NOT NULL THEN
      RAISE EXCEPTION 'Analytics event rejected: invalid session_start fields'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_acquisition_source IS NOT NULL THEN
      RAISE EXCEPTION 'Analytics event rejected: acquisition source is session-only'
        USING ERRCODE = '22023';
    END IF;

    IF p_event_name = 'recommendation_shown' THEN
      IF p_recommendation_id IS NULL
        OR p_restaurant_id IS NULL
        OR p_menu_id IS NULL
        OR p_position IS NULL
        OR p_source_context IS NULL
        OR p_source_context NOT IN ('discovery', 'personalized', 'shared_pick')
        OR p_error_code IS NOT NULL
        OR p_item_count IS NOT NULL
        OR p_share_method IS NOT NULL THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid recommendation_shown fields'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_recommendation_id::text, 0)
      );

      IF EXISTS (
        SELECT 1
        FROM public.analytics_events AS existing_event
        WHERE existing_event.event_name = 'recommendation_shown'
          AND existing_event.recommendation_id = p_recommendation_id
          AND (
            existing_event.session_id IS DISTINCT FROM p_session_id
            OR existing_event.source_context IS DISTINCT FROM p_source_context
          )
      ) THEN
        RAISE EXCEPTION 'Analytics event rejected: inconsistent recommendation set'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_event_name = 'recommendation_refresh' THEN
      IF p_recommendation_id IS NULL
        OR p_source_context IS NULL
        OR p_source_context NOT IN ('discovery', 'personalized', 'shared_pick')
        OR p_restaurant_id IS NOT NULL
        OR p_menu_id IS NOT NULL
        OR p_position IS NOT NULL
        OR p_error_code IS NOT NULL
        OR p_item_count IS NOT NULL
        OR p_share_method IS NOT NULL THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid recommendation_refresh fields'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_event_name = 'menu_card_open' THEN
      IF p_restaurant_id IS NULL
        OR p_menu_id IS NULL
        OR p_source_context IS NULL
        OR p_error_code IS NOT NULL
        OR p_item_count IS NOT NULL
        OR p_share_method IS NOT NULL
        OR (
          p_source_context = 'search'
          AND (p_recommendation_id IS NOT NULL OR p_position IS NOT NULL)
        )
        OR (
          p_source_context <> 'search'
          AND (p_recommendation_id IS NULL OR p_position IS NULL)
        ) THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid menu_card_open fields'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_event_name = 'map_open' THEN
      IF p_restaurant_id IS NULL
        OR p_source_context IS NULL
        OR p_error_code IS NOT NULL
        OR p_item_count IS NOT NULL
        OR p_share_method IS NOT NULL
        OR (
          p_source_context = 'search'
          AND (p_recommendation_id IS NOT NULL OR p_position IS NOT NULL)
        )
        OR (
          p_source_context <> 'search'
          AND (p_recommendation_id IS NULL OR p_menu_id IS NULL OR p_position IS NULL)
        ) THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid map_open fields'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_event_name = 'share_recommendation' THEN
      IF p_recommendation_id IS NULL
        OR p_source_context IS NULL
        OR p_source_context NOT IN ('discovery', 'personalized', 'shared_pick')
        OR p_share_method IS NULL
        OR p_restaurant_id IS NOT NULL
        OR p_menu_id IS NOT NULL
        OR p_position IS NOT NULL
        OR p_error_code IS NOT NULL
        OR p_item_count IS NOT NULL THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid share_recommendation fields'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_event_name = 'recommendation_error' THEN
      IF p_source_context IS NULL
        OR p_source_context NOT IN ('discovery', 'personalized')
        OR p_error_code IS NULL
        OR p_recommendation_id IS NOT NULL
        OR p_restaurant_id IS NOT NULL
        OR p_menu_id IS NOT NULL
        OR p_position IS NOT NULL
        OR p_share_method IS NOT NULL THEN
        RAISE EXCEPTION 'Analytics event rejected: invalid recommendation_error fields'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF p_restaurant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurants AS restaurant
    WHERE restaurant.id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Analytics event rejected: unknown restaurant'
      USING ERRCODE = '22023';
  END IF;

  IF p_menu_id IS NOT NULL THEN
    SELECT menu.restaurant_id
    INTO v_menu_restaurant_id
    FROM public.menus AS menu
    WHERE menu.id = p_menu_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Analytics event rejected: unknown menu'
        USING ERRCODE = '22023';
    END IF;

    IF p_restaurant_id IS NULL OR v_menu_restaurant_id IS DISTINCT FROM p_restaurant_id THEN
      RAISE EXCEPTION 'Analytics event rejected: menu restaurant mismatch'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.analytics_events (
    event_id,
    event_name,
    occurred_at,
    server_received_at,
    session_id,
    recommendation_id,
    restaurant_id,
    menu_id,
    position,
    source_context,
    event_version,
    error_code,
    item_count,
    share_method,
    acquisition_source
  ) VALUES (
    p_event_id,
    p_event_name,
    p_occurred_at,
    pg_catalog.now(),
    p_session_id,
    p_recommendation_id,
    p_restaurant_id,
    p_menu_id,
    p_position,
    p_source_context,
    1,
    p_error_code,
    p_item_count,
    p_share_method,
    p_acquisition_source
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count = 1;
END;
$analytics_rpc$;

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_dashboard()
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

DO $eaten_analytics_rollback_postcheck$
DECLARE
  v_constraint_definition text;
  v_event_names text[];
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
    AND constraint_row.conname = 'analytics_events_event_name_allowed';

  SELECT array_agg(match_row[1] ORDER BY match_row[1])
  INTO v_event_names
  FROM pg_catalog.regexp_matches(
    COALESCE(v_constraint_definition, ''),
    '''([^'']+)''::text',
    'g'
  ) AS match_row;

  IF v_event_names IS DISTINCT FROM ARRAY['map_open', 'menu_card_open', 'recommendation_error', 'recommendation_refresh', 'recommendation_shown', 'session_start', 'share_recommendation']::text[]
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = 'public.log_analytics_event(uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text)'::regprocedure
        AND pg_catalog.pg_get_functiondef(oid) LIKE '%eaten_record_added%'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid = 'public.get_admin_analytics_dashboard()'::regprocedure
        AND pg_catalog.pg_get_functiondef(oid) LIKE '%eaten_records%'
    ) THEN
    RAISE EXCEPTION 'Eaten Analytics rollback postcheck failed';
  END IF;
END;
$eaten_analytics_rollback_postcheck$;

COMMIT;
