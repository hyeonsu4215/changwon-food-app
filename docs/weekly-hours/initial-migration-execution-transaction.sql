-- EXECUTED MANUALLY IN SUPABASE SQL EDITOR ON 2026-08-16.
-- HISTORICAL EXECUTION RECORD. DO NOT RE-RUN.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
DECLARE
  difference_count integer;
  constraint_count integer;
  policy_count integer;
  trigger_count integer;
  restaurant_count integer;
  menu_count integer;
  weekly_count integer;
  restaurants_fingerprint text;
  menus_fingerprint text;
BEGIN
  IF to_regclass('public.restaurants') IS NULL
    OR to_regclass('public.menus') IS NULL
    OR to_regclass('public.restaurant_weekly_hours') IS NULL THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: required table is missing';
  END IF;

  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;
  SELECT count(*) INTO weekly_count FROM public.restaurant_weekly_hours;

  IF restaurant_count <> 29 OR menu_count <> 100 OR weekly_count <> 0 THEN
    RAISE EXCEPTION
      'Initial weekly migration preflight failed: expected restaurants=29 menus=100 weekly=0, got restaurants=% menus=% weekly=%',
      restaurant_count,
      menu_count,
      weekly_count;
  END IF;

  WITH expected_columns(ordinal_position, column_name, data_type, is_nullable) AS (
    VALUES
      (1, 'restaurant_id', 'text', 'NO'),
      (2, 'iso_weekday', 'smallint', 'NO'),
      (3, 'day_status', 'text', 'NO'),
      (4, 'open_time', 'time without time zone', 'YES'),
      (5, 'close_time', 'time without time zone', 'YES'),
      (6, 'closes_next_day', 'boolean', 'NO'),
      (7, 'break_status', 'text', 'NO'),
      (8, 'break_start', 'time without time zone', 'YES'),
      (9, 'break_end', 'time without time zone', 'YES'),
      (10, 'note', 'text', 'YES'),
      (11, 'source', 'text', 'YES'),
      (12, 'last_verified_at', 'timestamp with time zone', 'YES'),
      (13, 'updated_at', 'timestamp with time zone', 'NO')
  ),
  actual_columns AS (
    SELECT ordinal_position::integer, column_name::text, data_type::text, is_nullable::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
  ),
  differences AS (
    (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns)
    UNION ALL
    (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: 13-column schema changed';
  END IF;

  IF (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'closes_next_day'
  ) IS DISTINCT FROM 'false' OR (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'updated_at'
  ) IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: schema defaults changed';
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

  IF constraint_count <> 7 OR NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.restaurant_weekly_hours'::regclass
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: constraints or RLS changed';
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
  ) OR NOT EXISTS (
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
    RAISE EXCEPTION 'Initial weekly migration preflight failed: PK or FK contract changed';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'restaurant_weekly_hours';

  SELECT count(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.restaurant_weekly_hours'::regclass
    AND NOT tgisinternal
    AND tgname = 'restaurant_weekly_hours_updated_at'
    AND tgenabled = 'O'
    AND tgfoid = 'public.set_updated_at()'::regprocedure;

  IF policy_count <> 2 OR trigger_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_weekly_hours'
      AND policyname = 'Active restaurant weekly hours are readable by everyone'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['anon', 'authenticated']::name[]
      AND qual LIKE '%restaurant.active = true%'
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
    RAISE EXCEPTION 'Initial weekly migration preflight failed: policies or trigger changed';
  END IF;

  IF NOT has_table_privilege('anon', 'public.restaurant_weekly_hours', 'SELECT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'INSERT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'UPDATE')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'DELETE')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'UPDATE')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'DELETE') THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: table grants changed';
  END IF;

  WITH expected_baseline (id, name, open_time, close_time, break_time, closed_days) AS (
  VALUES
    ('C001', '리코리코', '10:00:00', '20:40:00', '', '일요일'),
    ('C002', '달인의찜닭', '10:30:00', '21:00:00', '', '일요일'),
    ('C003', '엄마손', 'X', 'X', 'X', 'X'),
    ('C007', '봉구스 밥버거', '10:20:00', '20:00:00', 'X', '일요일'),
    ('C009', '맘스터치', 'X', 'X', 'X', 'X'),
    ('C010', '따뜻한밥상', '10:30:00', '20:00:00', '14:30-17:00', '토요일,일요일'),
    ('C011', '소소소국수집', 'X', 'X', 'X', 'X'),
    ('C013', '쌈마이 닭쌈밥', '10:00:00', '20:00:00', 'X', '일요일'),
    ('C014', '창대 비빔밥 뷔페', '11:00:00', '14:00:00', 'X', '토요일,일요일'),
    ('C015', '알촌', '09:40:00', '20:30:00', 'X', '토요일'),
    ('C017', '이삭토스트', '11:00:00', '21:10:00', 'X', '일요일'),
    ('C019', '밀밭이야기', 'X', 'X', 'X', 'X'),
    ('C020', '김밥일번지', '09:00:00', '20:00:00', 'X', '일요일'),
    ('C022', '차곡히', '11:00:00', '21:00:00', 'X', '토요일,일요일'),
    ('C023', '레빗테이블', '11:00:00', '21:00:00', 'X', '토요일'),
    ('C027', '호호돼지국밥', '10:30:00', '21:00:00', '15:00-16:00', '일요일')
),
  actual_baseline AS (
    SELECT id, name, open_time, close_time, break_time, closed_days
    FROM public.restaurants
    WHERE id IN ('C001', 'C002', 'C003', 'C007', 'C009', 'C010', 'C011', 'C013', 'C014', 'C015', 'C017', 'C019', 'C020', 'C022', 'C023', 'C027')
  ),
  differences AS (
    (SELECT * FROM expected_baseline EXCEPT SELECT * FROM actual_baseline)
    UNION ALL
    (SELECT * FROM actual_baseline EXCEPT SELECT * FROM expected_baseline)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: 16-target legacy baseline changed';
  END IF;

  IF (SELECT count(*) FROM public.restaurants WHERE id IN ('C004', 'C005', 'C006', 'C008', 'C012', 'C016', 'C018', 'C021', 'C024', 'C025', 'C026', 'C028', 'C029')) <> 13 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: excluded restaurant set changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants
    WHERE id = 'C024'
      AND name = '고가밀면'
      AND closed_days = '2,4번째 일요일'
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: C024 special closure changed';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO menus_fingerprint
  FROM public.menus AS menu;

  PERFORM set_config('mukjji.initial_weekly_restaurants_fingerprint', restaurants_fingerprint, true);
  PERFORM set_config('mukjji.initial_weekly_menus_fingerprint', menus_fingerprint, true);
END;
$preflight$;

-- BEGIN CANONICAL DATA EFFECT
INSERT INTO public.restaurant_weekly_hours (
  restaurant_id,
  iso_weekday,
  day_status,
  open_time,
  close_time,
  closes_next_day,
  break_status,
  break_start,
  break_end,
  note,
  source,
  last_verified_at
) VALUES
  ('C001', 1, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 2, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 3, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 4, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 5, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 6, 'open', '10:00:00', '20:40:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C001', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 1, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 2, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 3, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 4, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 5, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 6, 'open', '10:30:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C002', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 1, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 2, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 3, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 4, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 5, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 6, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C003', 7, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 1, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 2, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 3, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 4, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 5, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 6, 'open', '10:20:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C007', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 1, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 2, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 3, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 4, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 5, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 6, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C009', 7, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C010', 1, 'open', '10:30:00', '20:00:00', false, 'scheduled', '14:30:00', '17:00:00', NULL, 'legacy_migration', NULL),
  ('C010', 2, 'open', '10:30:00', '20:00:00', false, 'scheduled', '14:30:00', '17:00:00', NULL, 'legacy_migration', NULL),
  ('C010', 3, 'open', '10:30:00', '20:00:00', false, 'scheduled', '14:30:00', '17:00:00', NULL, 'legacy_migration', NULL),
  ('C010', 4, 'open', '10:30:00', '20:00:00', false, 'scheduled', '14:30:00', '17:00:00', NULL, 'legacy_migration', NULL),
  ('C010', 5, 'open', '10:30:00', '20:00:00', false, 'scheduled', '14:30:00', '17:00:00', NULL, 'legacy_migration', NULL),
  ('C010', 6, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C010', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 1, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 2, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 3, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 4, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 5, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 6, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C011', 7, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 1, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 2, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 3, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 4, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 5, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 6, 'open', '10:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C013', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 1, 'open', '11:00:00', '14:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 2, 'open', '11:00:00', '14:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 3, 'open', '11:00:00', '14:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 4, 'open', '11:00:00', '14:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 5, 'open', '11:00:00', '14:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 6, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C014', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 1, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 2, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 3, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 4, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 5, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 6, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C015', 7, 'open', '09:40:00', '20:30:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 1, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 2, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 3, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 4, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 5, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 6, 'open', '11:00:00', '21:10:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C017', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 1, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 2, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 3, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 4, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 5, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 6, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C019', 7, 'unknown', NULL, NULL, false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 1, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 2, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 3, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 4, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 5, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 6, 'open', '09:00:00', '20:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C020', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 1, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 2, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 3, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 4, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 5, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 6, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C022', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 1, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 2, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 3, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 4, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 5, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 6, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C023', 7, 'open', '11:00:00', '21:00:00', false, 'unknown', NULL, NULL, NULL, 'legacy_migration', NULL),
  ('C027', 1, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 2, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 3, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 4, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 5, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 6, 'open', '10:30:00', '21:00:00', false, 'scheduled', '15:00:00', '16:00:00', NULL, 'legacy_migration', NULL),
  ('C027', 7, 'closed', NULL, NULL, false, 'none', NULL, NULL, NULL, 'legacy_migration', NULL);
-- END CANONICAL DATA EFFECT

DO $postcheck$
DECLARE
  difference_count integer;
  invalid_group_count integer;
  restaurant_count integer;
  menu_count integer;
  weekly_count integer;
  restaurants_fingerprint text;
  menus_fingerprint text;
BEGIN
  SELECT count(*) INTO weekly_count FROM public.restaurant_weekly_hours;

  IF weekly_count <> 112
    OR (SELECT count(DISTINCT restaurant_id) FROM public.restaurant_weekly_hours) <> 16
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'open') <> 69
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'closed') <> 15
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'unknown') <> 28
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'scheduled') <> 11
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'none') <> 15
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'unknown') <> 86
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE source = 'legacy_migration') <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE last_verified_at IS NULL) <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE closes_next_day = false) <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE updated_at IS NOT NULL) <> 112 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: aggregate mismatch';
  END IF;

  SELECT count(*) INTO invalid_group_count
  FROM (
    SELECT restaurant_id
    FROM public.restaurant_weekly_hours
    GROUP BY restaurant_id
    HAVING count(*) <> 7
      OR count(DISTINCT iso_weekday) <> 7
      OR min(iso_weekday) <> 1
      OR max(iso_weekday) <> 7
  ) AS invalid_groups;

  IF invalid_group_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: weekday completeness mismatch';
  END IF;

  IF (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id IN ('C004', 'C005', 'C006', 'C008', 'C012', 'C016', 'C018', 'C021', 'C024', 'C025', 'C026', 'C028', 'C029')) <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: excluded restaurant row found';
  END IF;

  WITH expected_rows (restaurant_id, iso_weekday, day_status, open_time, close_time, closes_next_day, break_status, break_start, break_end, note, source, last_verified_at) AS (
  VALUES
    ('C001'::text, 1::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 2::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 3::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 4::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 5::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 6::smallint, 'open'::text, '10:00:00'::time without time zone, '20:40:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C001'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 1::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 2::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 3::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 4::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 5::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 6::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C002'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 1::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 2::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 3::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 4::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 5::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 6::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C003'::text, 7::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 1::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 2::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 3::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 4::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 5::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 6::smallint, 'open'::text, '10:20:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C007'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 1::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 2::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 3::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 4::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 5::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 6::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C009'::text, 7::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 1::smallint, 'open'::text, '10:30:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'scheduled'::text, '14:30:00'::time without time zone, '17:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 2::smallint, 'open'::text, '10:30:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'scheduled'::text, '14:30:00'::time without time zone, '17:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 3::smallint, 'open'::text, '10:30:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'scheduled'::text, '14:30:00'::time without time zone, '17:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 4::smallint, 'open'::text, '10:30:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'scheduled'::text, '14:30:00'::time without time zone, '17:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 5::smallint, 'open'::text, '10:30:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'scheduled'::text, '14:30:00'::time without time zone, '17:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 6::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C010'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 1::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 2::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 3::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 4::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 5::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 6::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C011'::text, 7::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 1::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 2::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 3::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 4::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 5::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 6::smallint, 'open'::text, '10:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C013'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 1::smallint, 'open'::text, '11:00:00'::time without time zone, '14:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 2::smallint, 'open'::text, '11:00:00'::time without time zone, '14:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 3::smallint, 'open'::text, '11:00:00'::time without time zone, '14:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 4::smallint, 'open'::text, '11:00:00'::time without time zone, '14:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 5::smallint, 'open'::text, '11:00:00'::time without time zone, '14:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 6::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C014'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 1::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 2::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 3::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 4::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 5::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 6::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C015'::text, 7::smallint, 'open'::text, '09:40:00'::time without time zone, '20:30:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 1::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 2::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 3::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 4::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 5::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 6::smallint, 'open'::text, '11:00:00'::time without time zone, '21:10:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C017'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 1::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 2::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 3::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 4::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 5::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 6::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C019'::text, 7::smallint, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 1::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 2::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 3::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 4::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 5::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 6::smallint, 'open'::text, '09:00:00'::time without time zone, '20:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C020'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 1::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 2::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 3::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 4::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 5::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 6::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C022'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 1::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 2::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 3::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 4::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 5::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 6::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C023'::text, 7::smallint, 'open'::text, '11:00:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'unknown'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 1::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 2::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 3::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 4::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 5::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 6::smallint, 'open'::text, '10:30:00'::time without time zone, '21:00:00'::time without time zone, false::boolean, 'scheduled'::text, '15:00:00'::time without time zone, '16:00:00'::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz),
    ('C027'::text, 7::smallint, 'closed'::text, NULL::time without time zone, NULL::time without time zone, false::boolean, 'none'::text, NULL::time without time zone, NULL::time without time zone, NULL::text, 'legacy_migration'::text, NULL::timestamptz)
),
  actual_rows AS (
    SELECT restaurant_id, iso_weekday, day_status, open_time, close_time, closes_next_day, break_status, break_start, break_end, note, source, last_verified_at
    FROM public.restaurant_weekly_hours
  ),
  differences AS (
    (SELECT * FROM expected_rows EXCEPT SELECT * FROM actual_rows)
    UNION ALL
    (SELECT * FROM actual_rows EXCEPT SELECT * FROM expected_rows)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: exact expected rows differ';
  END IF;

  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO menus_fingerprint
  FROM public.menus AS menu;

  IF restaurant_count <> 29 OR menu_count <> 100
    OR restaurants_fingerprint IS DISTINCT FROM current_setting('mukjji.initial_weekly_restaurants_fingerprint', true)
    OR menus_fingerprint IS DISTINCT FROM current_setting('mukjji.initial_weekly_menus_fingerprint', true) THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: existing catalog changed';
  END IF;
END;
$postcheck$;

COMMIT;
