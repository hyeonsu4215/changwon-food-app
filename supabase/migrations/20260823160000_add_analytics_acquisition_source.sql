-- PREPARED FOR ACQUISITION SOURCE V1. NOT EXECUTED AGAINST SUPABASE.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $acquisition_preflight$
DECLARE
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
  v_column_difference_count integer;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Acquisition preflight failed: public.analytics_events is missing';
  END IF;

  IF (SELECT count(*) FROM public.restaurants) <> 29
    OR (SELECT count(*) FROM public.menus) <> 100
    OR (SELECT count(*) FROM public.restaurant_weekly_hours) <> 112 THEN
    RAISE EXCEPTION 'Acquisition preflight failed: core row-count baseline drifted';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0 THEN
    RAISE EXCEPTION 'Acquisition preflight failed: analytics history requires an explicit backfill plan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name = 'acquisition_source'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
      AND conname = 'analytics_events_acquisition_source_semantics'
  ) THEN
    RAISE EXCEPTION 'Acquisition preflight failed: target schema objects already exist';
  END IF;

  WITH expected(column_name, data_type, is_nullable) AS (
    VALUES
      ('event_id', 'uuid', 'NO'),
      ('event_name', 'text', 'NO'),
      ('occurred_at', 'timestamp with time zone', 'NO'),
      ('server_received_at', 'timestamp with time zone', 'NO'),
      ('session_id', 'uuid', 'NO'),
      ('recommendation_id', 'uuid', 'YES'),
      ('restaurant_id', 'text', 'YES'),
      ('menu_id', 'text', 'YES'),
      ('position', 'smallint', 'YES'),
      ('source_context', 'text', 'YES'),
      ('event_version', 'smallint', 'NO'),
      ('error_code', 'text', 'YES'),
      ('item_count', 'smallint', 'YES'),
      ('share_method', 'text', 'YES')
  ),
  actual AS (
    SELECT column_name::text, data_type::text, is_nullable::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
  ),
  differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO v_column_difference_count FROM differences;

  IF v_column_difference_count <> 0 THEN
    RAISE EXCEPTION 'Acquisition preflight failed: analytics column contract drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
      AND conname IN (
        'analytics_events_pkey',
        'analytics_events_event_name_allowed',
        'analytics_events_source_context_allowed',
        'analytics_events_position_allowed',
        'analytics_events_event_version_v1',
        'analytics_events_error_code_allowed',
        'analytics_events_item_count_allowed',
        'analytics_events_share_method_allowed'
      )
  ) <> 8 OR (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
  ) <> 8 THEN
    RAISE EXCEPTION 'Acquisition preflight failed: analytics constraints drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analytics_events'
      AND indexname IN (
        'analytics_events_pkey',
        'analytics_events_recommendation_position_unique',
        'analytics_events_recommendation_menu_unique',
        'analytics_events_event_received_at_idx',
        'analytics_events_restaurant_event_received_at_idx'
      )
  ) <> 5 OR (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND tablename = 'analytics_events'
  ) <> 5 THEN
    RAISE EXCEPTION 'Acquisition preflight failed: analytics indexes drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'log_analytics_event'
  ) <> 1 OR to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Acquisition preflight failed: current RPC signature drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'::regprocedure
      AND procedure_row.prorettype = 'boolean'::regtype
      AND procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'Acquisition preflight failed: current RPC security contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS acl
    WHERE procedure_row.oid = 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
    OR NOT has_function_privilege('anon', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acquisition preflight failed: current RPC grants drifted';
  END IF;

  IF has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('anon', 'public.analytics_events', 'DELETE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'analytics_events'
    ) THEN
    RAISE EXCEPTION 'Acquisition preflight failed: raw table security drifted';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS row_value;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS row_value;

  SELECT md5(COALESCE(
    jsonb_agg(to_jsonb(row_value) ORDER BY row_value.restaurant_id, row_value.iso_weekday),
    '[]'::jsonb
  )::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS row_value;

  PERFORM set_config('mukjji.acquisition_restaurants_fingerprint', v_restaurants_fingerprint, true);
  PERFORM set_config('mukjji.acquisition_menus_fingerprint', v_menus_fingerprint, true);
  PERFORM set_config('mukjji.acquisition_weekly_hours_fingerprint', v_weekly_hours_fingerprint, true);
END;
$acquisition_preflight$;

ALTER TABLE public.analytics_events
ADD COLUMN acquisition_source text NULL;

ALTER TABLE public.analytics_events
ADD CONSTRAINT analytics_events_acquisition_source_semantics CHECK (
  (
    event_name = 'session_start'
    AND acquisition_source IN (
      'direct',
      'everytime',
      'kakao',
      'instagram',
      'poster_qr',
      'share',
      'internal_test',
      'other'
    )
  )
  OR (
    event_name <> 'session_start'
    AND acquisition_source IS NULL
  )
);

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
);

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

DO $acquisition_postcheck$
DECLARE
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
  v_constraint_definition text;
BEGIN
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
    RAISE EXCEPTION 'Acquisition post-check failed: column contract mismatch';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.analytics_events'::regclass
    AND constraint_row.conname = 'analytics_events_acquisition_source_semantics'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  IF v_constraint_definition IS NULL
    OR v_constraint_definition NOT LIKE '%event_name = ''session_start''%'
    OR v_constraint_definition NOT LIKE '%acquisition_source IS NULL%'
    OR v_constraint_definition NOT LIKE '%''direct''%'
    OR v_constraint_definition NOT LIKE '%''everytime''%'
    OR v_constraint_definition NOT LIKE '%''kakao''%'
    OR v_constraint_definition NOT LIKE '%''instagram''%'
    OR v_constraint_definition NOT LIKE '%''poster_qr''%'
    OR v_constraint_definition NOT LIKE '%''share''%'
    OR v_constraint_definition NOT LIKE '%''internal_test''%'
    OR v_constraint_definition NOT LIKE '%''other''%' THEN
    RAISE EXCEPTION 'Acquisition post-check failed: constraint semantics mismatch';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
      AND conname IN (
        'analytics_events_pkey',
        'analytics_events_event_name_allowed',
        'analytics_events_source_context_allowed',
        'analytics_events_position_allowed',
        'analytics_events_event_version_v1',
        'analytics_events_error_code_allowed',
        'analytics_events_item_count_allowed',
        'analytics_events_share_method_allowed',
        'analytics_events_acquisition_source_semantics'
      )
  ) <> 9 OR (
    SELECT count(*) FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
  ) <> 9 THEN
    RAISE EXCEPTION 'Acquisition post-check failed: constraint set changed unexpectedly';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analytics_events'
      AND indexname IN (
        'analytics_events_pkey',
        'analytics_events_recommendation_position_unique',
        'analytics_events_recommendation_menu_unique',
        'analytics_events_event_received_at_idx',
        'analytics_events_restaurant_event_received_at_idx'
      )
  ) <> 5 OR (
    SELECT count(*) FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND tablename = 'analytics_events'
  ) <> 5 THEN
    RAISE EXCEPTION 'Acquisition post-check failed: analytics indexes changed';
  END IF;

  IF to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'
  ) IS NOT NULL OR to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'
  ) IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'log_analytics_event'
  ) <> 1 THEN
    RAISE EXCEPTION 'Acquisition post-check failed: RPC overload contract mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'::regprocedure
      AND procedure_row.prorettype = 'boolean'::regtype
      AND procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'Acquisition post-check failed: RPC security contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS acl
    WHERE procedure_row.oid = 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
    OR NOT has_function_privilege('anon', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acquisition post-check failed: RPC grants mismatch';
  END IF;

  IF has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('anon', 'public.analytics_events', 'DELETE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE')
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.analytics_events'::regclass)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'analytics_events'
    ) THEN
    RAISE EXCEPTION 'Acquisition post-check failed: raw table security changed';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0
    OR (SELECT count(*) FROM public.restaurants) <> 29
    OR (SELECT count(*) FROM public.menus) <> 100
    OR (SELECT count(*) FROM public.restaurant_weekly_hours) <> 112 THEN
    RAISE EXCEPTION 'Acquisition post-check failed: row counts changed';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS row_value;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS row_value;

  SELECT md5(COALESCE(
    jsonb_agg(to_jsonb(row_value) ORDER BY row_value.restaurant_id, row_value.iso_weekday),
    '[]'::jsonb
  )::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS row_value;

  IF v_restaurants_fingerprint IS DISTINCT FROM current_setting('mukjji.acquisition_restaurants_fingerprint', true)
    OR v_menus_fingerprint IS DISTINCT FROM current_setting('mukjji.acquisition_menus_fingerprint', true)
    OR v_weekly_hours_fingerprint IS DISTINCT FROM current_setting('mukjji.acquisition_weekly_hours_fingerprint', true) THEN
    RAISE EXCEPTION 'Acquisition post-check failed: core data changed';
  END IF;
END;
$acquisition_postcheck$;

COMMIT;
