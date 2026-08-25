-- PREPARED ROLLBACK FOR ACQUISITION SOURCE V1. DO NOT RUN WITHOUT SEPARATE APPROVAL.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $acquisition_rollback_preflight$
BEGIN
  IF to_regclass('public.analytics_events') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'analytics_events'
        AND column_name = 'acquisition_source'
        AND data_type = 'text'
        AND is_nullable = 'YES'
        AND column_default IS NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.analytics_events'::regclass
        AND conname = 'analytics_events_acquisition_source_semantics'
        AND contype = 'c'
        AND convalidated
    ) THEN
    RAISE EXCEPTION 'Acquisition rollback blocked: target schema contract is missing';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0 THEN
    RAISE EXCEPTION 'Acquisition rollback blocked: analytics history is not empty';
  END IF;

  IF to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'
  ) IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'log_analytics_event'
  ) <> 1 THEN
    RAISE EXCEPTION 'Acquisition rollback blocked: final RPC signature drifted';
  END IF;
END;
$acquisition_rollback_preflight$;

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text, text
);

ALTER TABLE public.analytics_events
DROP CONSTRAINT analytics_events_acquisition_source_semantics;

ALTER TABLE public.analytics_events
DROP COLUMN acquisition_source;

CREATE FUNCTION public.log_analytics_event(
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
  p_share_method text DEFAULT NULL
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
    IF p_recommendation_id IS NOT NULL
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

  ELSIF p_event_name = 'recommendation_shown' THEN
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

  IF p_restaurant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.restaurants AS restaurant
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
    share_method
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
    p_share_method
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count = 1;
END;
$analytics_rpc$;

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) TO anon, authenticated;

DO $acquisition_rollback_postcheck$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name = 'acquisition_source'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
      AND conname = 'analytics_events_acquisition_source_semantics'
  ) THEN
    RAISE EXCEPTION 'Acquisition rollback failed: target schema objects remain';
  END IF;

  IF to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'
  ) IS NOT NULL OR to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'
  ) IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public' AND procedure_row.proname = 'log_analytics_event'
  ) <> 1 THEN
    RAISE EXCEPTION 'Acquisition rollback failed: legacy RPC was not restored exactly';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0 THEN
    RAISE EXCEPTION 'Acquisition rollback failed: analytics row count changed';
  END IF;
END;
$acquisition_rollback_postcheck$;

COMMIT;
