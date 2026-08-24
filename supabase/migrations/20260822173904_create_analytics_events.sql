-- PREPARED FOR STAGE 5A-2. NOT EXECUTED AGAINST SUPABASE.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $analytics_preflight$
DECLARE
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
BEGIN
  IF to_regnamespace('public') IS NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: public schema is missing';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: required app roles are missing';
  END IF;

  IF to_regclass('public.restaurants') IS NULL
    OR to_regclass('public.menus') IS NULL
    OR to_regclass('public.restaurant_weekly_hours') IS NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: required catalog tables are missing';
  END IF;

  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: public.analytics_events already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'log_analytics_event'
  ) THEN
    RAISE EXCEPTION 'Analytics preflight failed: public.log_analytics_event already exists';
  END IF;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: gen_random_uuid() is unavailable';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Analytics preflight failed: public.is_admin() is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = 'public.is_admin()'::regprocedure
      AND procedure_row.prorettype = 'boolean'::regtype
      AND procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=public']::text[]
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%public.admin_users%'
      AND pg_catalog.pg_get_functiondef(procedure_row.oid) LIKE '%auth.uid()%'
  ) THEN
    RAISE EXCEPTION 'Analytics preflight failed: public.is_admin() contract changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurants'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menus'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menus'
      AND column_name = 'restaurant_id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Analytics preflight failed: catalog ID contract changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.menus'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.restaurants'::regclass
      AND constraint_row.confdeltype = 'c'
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY key_row.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_row(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS attribute_row
          ON attribute_row.attrelid = constraint_row.conrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['restaurant_id']::name[]
      AND (
        SELECT array_agg(attribute_row.attname ORDER BY key_row.ordinality)
        FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_row(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS attribute_row
          ON attribute_row.attrelid = constraint_row.confrelid
         AND attribute_row.attnum = key_row.attnum
      ) = ARRAY['id']::name[]
  ) THEN
    RAISE EXCEPTION 'Analytics preflight failed: menu restaurant relation changed';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS menu;

  SELECT md5(COALESCE(
    jsonb_agg(to_jsonb(weekly_row) ORDER BY weekly_row.restaurant_id, weekly_row.iso_weekday),
    '[]'::jsonb
  )::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS weekly_row;

  PERFORM set_config('mukjji.analytics_restaurants_fingerprint', v_restaurants_fingerprint, true);
  PERFORM set_config('mukjji.analytics_menus_fingerprint', v_menus_fingerprint, true);
  PERFORM set_config('mukjji.analytics_weekly_hours_fingerprint', v_weekly_hours_fingerprint, true);
END;
$analytics_preflight$;

CREATE TABLE public.analytics_events (
  event_id uuid NOT NULL,
  event_name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid NOT NULL,
  recommendation_id uuid NULL,
  restaurant_id text NULL,
  menu_id text NULL,
  position smallint NULL,
  source_context text NULL,
  event_version smallint NOT NULL DEFAULT 1,
  error_code text NULL,
  item_count smallint NULL,
  share_method text NULL,
  CONSTRAINT analytics_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT analytics_events_event_name_allowed CHECK (
    event_name IN (
      'session_start',
      'recommendation_shown',
      'recommendation_refresh',
      'menu_card_open',
      'map_open',
      'share_recommendation',
      'recommendation_error'
    )
  ),
  CONSTRAINT analytics_events_source_context_allowed CHECK (
    source_context IS NULL
    OR source_context IN ('discovery', 'personalized', 'shared_pick', 'search')
  ),
  CONSTRAINT analytics_events_position_allowed CHECK (
    position IS NULL OR position BETWEEN 1 AND 3
  ),
  CONSTRAINT analytics_events_event_version_v1 CHECK (event_version = 1),
  CONSTRAINT analytics_events_error_code_allowed CHECK (
    error_code IS NULL
    OR error_code IN ('insufficient_candidates', 'invalid_result', 'data_unavailable', 'unknown')
  ),
  CONSTRAINT analytics_events_item_count_allowed CHECK (
    item_count IS NULL OR item_count BETWEEN 0 AND 3
  ),
  CONSTRAINT analytics_events_share_method_allowed CHECK (
    share_method IS NULL OR share_method IN ('web_share', 'clipboard')
  )
);

CREATE UNIQUE INDEX analytics_events_recommendation_position_unique
ON public.analytics_events (recommendation_id, position)
WHERE event_name = 'recommendation_shown'
  AND recommendation_id IS NOT NULL
  AND position IS NOT NULL;

CREATE UNIQUE INDEX analytics_events_recommendation_menu_unique
ON public.analytics_events (recommendation_id, menu_id)
WHERE event_name = 'recommendation_shown'
  AND recommendation_id IS NOT NULL
  AND menu_id IS NOT NULL;

CREATE INDEX analytics_events_event_received_at_idx
ON public.analytics_events (event_name, server_received_at);

CREATE INDEX analytics_events_restaurant_event_received_at_idx
ON public.analytics_events (restaurant_id, event_name, server_received_at)
WHERE restaurant_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;

-- BEGIN INGESTION RPC
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
-- END INGESTION RPC

REVOKE ALL ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_analytics_event(
  uuid, text, timestamptz, uuid, uuid, text, text, smallint, text, text, smallint, text
) TO anon, authenticated;

DO $analytics_postcheck$
DECLARE
  v_function_oid oid;
  v_column_difference_count integer;
  v_constraint_count integer;
  v_index_count integer;
  v_restaurants_fingerprint text;
  v_menus_fingerprint text;
  v_weekly_hours_fingerprint text;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION 'Analytics post-check failed: target table is missing';
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
    RAISE EXCEPTION 'Analytics post-check failed: column contract mismatch';
  END IF;

  IF (
    SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
    FROM pg_catalog.pg_attrdef AS default_row
    JOIN pg_catalog.pg_attribute AS attribute_row
      ON attribute_row.attrelid = default_row.adrelid
     AND attribute_row.attnum = default_row.adnum
    WHERE default_row.adrelid = 'public.analytics_events'::regclass
      AND attribute_row.attname = 'server_received_at'
  ) IS DISTINCT FROM 'now()' OR (
    SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
    FROM pg_catalog.pg_attrdef AS default_row
    JOIN pg_catalog.pg_attribute AS attribute_row
      ON attribute_row.attrelid = default_row.adrelid
     AND attribute_row.attnum = default_row.adnum
    WHERE default_row.adrelid = 'public.analytics_events'::regclass
      AND attribute_row.attname = 'event_version'
  ) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Analytics post-check failed: server-controlled defaults mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analytics_events'
      AND column_name NOT IN ('server_received_at', 'event_version')
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: unexpected column default';
  END IF;

  SELECT count(*) INTO v_constraint_count
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
    );

  IF v_constraint_count <> 8 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.analytics_events'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: constraint contract mismatch';
  END IF;

  SELECT count(*) INTO v_index_count
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'analytics_events'
    AND indexname IN (
      'analytics_events_pkey',
      'analytics_events_recommendation_position_unique',
      'analytics_events_recommendation_menu_unique',
      'analytics_events_event_received_at_idx',
      'analytics_events_restaurant_event_received_at_idx'
    );

  IF v_index_count <> 5 OR (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analytics_events'
  ) <> 5 THEN
    RAISE EXCEPTION 'Analytics post-check failed: index contract mismatch';
  END IF;

  IF NOT (
    SELECT class_row.relrowsecurity
    FROM pg_catalog.pg_class AS class_row
    WHERE class_row.oid = 'public.analytics_events'::regclass
  ) OR (
    SELECT class_row.relforcerowsecurity
    FROM pg_catalog.pg_class AS class_row
    WHERE class_row.oid = 'public.analytics_events'::regclass
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: RLS contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analytics_events'
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: unexpected table policy';
  END IF;

  IF has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('anon', 'public.analytics_events', 'DELETE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE') THEN
    RAISE EXCEPTION 'Analytics post-check failed: app table privileges are too broad';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS class_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))
    ) AS privilege_row
    WHERE class_row.oid = 'public.analytics_events'::regclass
      AND privilege_row.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: PUBLIC table privilege remains';
  END IF;

  v_function_oid := to_regprocedure(
    'public.log_analytics_event(uuid,text,timestamp with time zone,uuid,uuid,text,text,smallint,text,text,smallint,text)'
  );

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Analytics post-check failed: ingestion RPC is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_language AS language_row
      ON language_row.oid = procedure_row.prolang
    WHERE procedure_row.oid = v_function_oid
      AND procedure_row.prorettype = 'boolean'::regtype
      AND procedure_row.prosecdef
      AND procedure_row.pronargdefaults = 8
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND language_row.lanname = 'plpgsql'
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: ingestion RPC security contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
    ) AS privilege_row
    WHERE procedure_row.oid = v_function_oid
      AND privilege_row.grantee = 0
      AND privilege_row.privilege_type = 'EXECUTE'
  ) OR NOT has_function_privilege('anon', v_function_oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Analytics post-check failed: ingestion RPC execute grants mismatch';
  END IF;

  IF (SELECT count(*) FROM public.analytics_events) <> 0 THEN
    RAISE EXCEPTION 'Analytics post-check failed: target table is not empty';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO v_restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO v_menus_fingerprint
  FROM public.menus AS menu;

  SELECT md5(COALESCE(
    jsonb_agg(to_jsonb(weekly_row) ORDER BY weekly_row.restaurant_id, weekly_row.iso_weekday),
    '[]'::jsonb
  )::text)
  INTO v_weekly_hours_fingerprint
  FROM public.restaurant_weekly_hours AS weekly_row;

  IF v_restaurants_fingerprint IS DISTINCT FROM current_setting(
    'mukjji.analytics_restaurants_fingerprint', true
  ) OR v_menus_fingerprint IS DISTINCT FROM current_setting(
    'mukjji.analytics_menus_fingerprint', true
  ) OR v_weekly_hours_fingerprint IS DISTINCT FROM current_setting(
    'mukjji.analytics_weekly_hours_fingerprint', true
  ) THEN
    RAISE EXCEPTION 'Analytics post-check failed: existing catalog data changed';
  END IF;
END;
$analytics_postcheck$;

COMMIT;
