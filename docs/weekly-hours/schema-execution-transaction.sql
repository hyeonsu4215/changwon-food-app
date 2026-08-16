-- EXECUTED MANUALLY IN SUPABASE SQL EDITOR ON 2026-08-16.
-- HISTORICAL EXECUTION RECORD. DO NOT RE-RUN.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
DECLARE
  restaurant_count integer;
  menu_count integer;
  restaurants_fingerprint text;
BEGIN
  IF to_regclass('public.restaurants') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: public.restaurants is missing';
  END IF;

  IF to_regclass('public.menus') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: public.menus is missing';
  END IF;

  IF to_regclass('public.restaurant_weekly_hours') IS NOT NULL THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: target table already exists';
  END IF;

  IF to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: public.set_updated_at() is missing';
  END IF;

  IF (
    SELECT prorettype
    FROM pg_proc
    WHERE oid = 'public.set_updated_at()'::regprocedure
  ) <> 'trigger'::regtype
    OR lower(pg_get_functiondef('public.set_updated_at()'::regprocedure))
      !~ 'new[.]updated_at[[:space:]]*:?=[[:space:]]*now[(][)]'
    OR lower(pg_get_functiondef('public.set_updated_at()'::regprocedure))
      !~ 'return[[:space:]]+new' THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: public.set_updated_at() contract changed';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: public.is_admin() is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurants'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: restaurants.id contract changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.restaurants'::regclass
      AND constraint_row.contype = 'p'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['id']::name[]
  ) THEN
    RAISE EXCEPTION 'Weekly hours preflight failed: restaurants primary key changed';
  END IF;

  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;

  IF restaurant_count <> 29 OR menu_count <> 100 THEN
    RAISE EXCEPTION
      'Weekly hours preflight failed: expected restaurants=29 menus=100, got restaurants=% menus=%',
      restaurant_count,
      menu_count;
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  PERFORM set_config(
    'mukjji.weekly_hours_restaurants_fingerprint',
    restaurants_fingerprint,
    true
  );
END;
$preflight$;

-- BEGIN CANONICAL SCHEMA EFFECT
CREATE TABLE public.restaurant_weekly_hours (
  restaurant_id text NOT NULL,
  iso_weekday smallint NOT NULL,
  day_status text NOT NULL,
  open_time time without time zone NULL,
  close_time time without time zone NULL,
  closes_next_day boolean NOT NULL DEFAULT false,
  break_status text NOT NULL,
  break_start time without time zone NULL,
  break_end time without time zone NULL,
  note text NULL,
  source text NULL,
  last_verified_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_weekly_hours_pkey
    PRIMARY KEY (restaurant_id, iso_weekday),
  CONSTRAINT restaurant_weekly_hours_restaurant_fkey
    FOREIGN KEY (restaurant_id)
    REFERENCES public.restaurants (id)
    ON DELETE RESTRICT,
  CONSTRAINT restaurant_weekly_hours_iso_weekday_allowed
    CHECK (iso_weekday BETWEEN 1 AND 7),
  CONSTRAINT restaurant_weekly_hours_day_status_allowed
    CHECK (day_status IN ('open', 'closed', 'unknown')),
  CONSTRAINT restaurant_weekly_hours_break_status_allowed
    CHECK (break_status IN ('scheduled', 'none', 'unknown')),
  CONSTRAINT restaurant_weekly_hours_day_shape_valid
    CHECK (
      (day_status = 'open' AND open_time IS NOT NULL AND close_time IS NOT NULL)
      OR
      (
        day_status = 'closed'
        AND open_time IS NULL
        AND close_time IS NULL
        AND closes_next_day = false
        AND break_status = 'none'
      )
      OR
      (
        day_status = 'unknown'
        AND open_time IS NULL
        AND close_time IS NULL
        AND closes_next_day = false
        AND break_status = 'unknown'
      )
    ),
  CONSTRAINT restaurant_weekly_hours_break_shape_valid
    CHECK (
      (
        break_status = 'scheduled'
        AND day_status = 'open'
        AND break_start IS NOT NULL
        AND break_end IS NOT NULL
      )
      OR
      (
        break_status IN ('none', 'unknown')
        AND break_start IS NULL
        AND break_end IS NULL
      )
    )
);

ALTER TABLE public.restaurant_weekly_hours ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.restaurant_weekly_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_weekly_hours TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.restaurant_weekly_hours TO authenticated;

CREATE POLICY "Active restaurant weekly hours are readable by everyone"
ON public.restaurant_weekly_hours
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.restaurants AS restaurant
    WHERE restaurant.id = restaurant_weekly_hours.restaurant_id
      AND restaurant.active = true
  )
);

CREATE POLICY "Admins can manage restaurant weekly hours"
ON public.restaurant_weekly_hours
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE TRIGGER restaurant_weekly_hours_updated_at
BEFORE UPDATE ON public.restaurant_weekly_hours
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
-- END CANONICAL SCHEMA EFFECT

DO $postcheck$
DECLARE
  column_difference_count integer;
  constraint_count integer;
  index_count integer;
  policy_count integer;
  trigger_count integer;
  restaurant_count integer;
  menu_count integer;
  weekly_count integer;
  restaurants_fingerprint text;
BEGIN
  IF to_regclass('public.restaurant_weekly_hours') IS NULL THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: target table is missing';
  END IF;

  WITH expected(column_name, data_type, is_nullable) AS (
    VALUES
      ('restaurant_id', 'text', 'NO'),
      ('iso_weekday', 'smallint', 'NO'),
      ('day_status', 'text', 'NO'),
      ('open_time', 'time without time zone', 'YES'),
      ('close_time', 'time without time zone', 'YES'),
      ('closes_next_day', 'boolean', 'NO'),
      ('break_status', 'text', 'NO'),
      ('break_start', 'time without time zone', 'YES'),
      ('break_end', 'time without time zone', 'YES'),
      ('note', 'text', 'YES'),
      ('source', 'text', 'YES'),
      ('last_verified_at', 'timestamp with time zone', 'YES'),
      ('updated_at', 'timestamp with time zone', 'NO')
  ),
  actual AS (
    SELECT column_name::text, data_type::text, is_nullable::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
  ),
  differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO column_difference_count FROM differences;

  IF column_difference_count <> 0 THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: column contract mismatch';
  END IF;

  IF (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'closes_next_day'
  ) IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: closes_next_day default mismatch';
  END IF;

  IF (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'updated_at'
  ) IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: updated_at default mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name NOT IN ('closes_next_day', 'updated_at')
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: unexpected column default';
  END IF;

  SELECT count(*) INTO constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.restaurant_weekly_hours'::regclass
    AND conname IN (
      'restaurant_weekly_hours_pkey',
      'restaurant_weekly_hours_restaurant_fkey',
      'restaurant_weekly_hours_iso_weekday_allowed',
      'restaurant_weekly_hours_day_status_allowed',
      'restaurant_weekly_hours_break_status_allowed',
      'restaurant_weekly_hours_day_shape_valid',
      'restaurant_weekly_hours_break_shape_valid'
    );

  IF constraint_count <> 7 THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: expected seven named constraints, got %', constraint_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.restaurant_weekly_hours'::regclass
      AND constraint_row.conname = 'restaurant_weekly_hours_pkey'
      AND constraint_row.contype = 'p'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['restaurant_id', 'iso_weekday']::name[]
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: primary key mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.restaurant_weekly_hours'::regclass
      AND constraint_row.conname = 'restaurant_weekly_hours_restaurant_fkey'
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.restaurants'::regclass
      AND constraint_row.confdeltype = 'r'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['restaurant_id']::name[]
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['id']::name[]
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: foreign key mismatch';
  END IF;

  SELECT count(*) INTO index_count
  FROM pg_index
  WHERE indrelid = 'public.restaurant_weekly_hours'::regclass;

  IF index_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indrelid = 'public.restaurant_weekly_hours'::regclass
      AND indisprimary = true
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: unexpected index set';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.restaurant_weekly_hours'::regclass
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: RLS is not enabled';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'restaurant_weekly_hours';

  IF policy_count <> 2 OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_weekly_hours'
      AND policyname = 'Active restaurant weekly hours are readable by everyone'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['anon', 'authenticated']::name[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_weekly_hours'
      AND policyname = 'Admins can manage restaurant weekly hours'
      AND cmd = 'ALL'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%is_admin()%'
      AND with_check LIKE '%is_admin()%'
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: RLS policy mismatch';
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.restaurant_weekly_hours'::regclass
    AND NOT tgisinternal
    AND tgname = 'restaurant_weekly_hours_updated_at'
    AND tgenabled = 'O'
    AND tgfoid = 'public.set_updated_at()'::regprocedure;

  IF trigger_count <> 1 THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: updated_at trigger mismatch';
  END IF;

  IF NOT has_table_privilege('anon', 'public.restaurant_weekly_hours', 'SELECT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'INSERT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'UPDATE')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'DELETE') THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: anon grants mismatch';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'UPDATE')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'DELETE') THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: authenticated grants mismatch';
  END IF;

  SELECT count(*) INTO weekly_count FROM public.restaurant_weekly_hours;
  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;

  IF weekly_count <> 0 OR restaurant_count <> 29 OR menu_count <> 100 THEN
    RAISE EXCEPTION
      'Weekly hours post-check failed: expected weekly=0 restaurants=29 menus=100, got weekly=% restaurants=% menus=%',
      weekly_count,
      restaurant_count,
      menu_count;
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  IF restaurants_fingerprint IS DISTINCT FROM current_setting(
    'mukjji.weekly_hours_restaurants_fingerprint',
    true
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: existing restaurant data changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.restaurants'::regclass
      AND NOT tgisinternal
      AND tgname = 'restaurants_updated_at'
      AND tgenabled = 'O'
      AND tgfoid = 'public.set_updated_at()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Weekly hours post-check failed: restaurants trigger changed';
  END IF;
END;
$postcheck$;

COMMIT;
