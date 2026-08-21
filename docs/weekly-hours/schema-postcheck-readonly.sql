-- READ ONLY POST-CHECK.
BEGIN;
SET TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.restaurants) AS restaurants,
  (SELECT count(*) FROM public.menus) AS menus,
  (SELECT count(*) FROM public.restaurant_weekly_hours) AS weekly_hours_rows;

SELECT
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'restaurant_weekly_hours'
ORDER BY ordinal_position;

SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.restaurant_weekly_hours'::regclass
ORDER BY conname;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'restaurant_weekly_hours'
ORDER BY indexname;

SELECT
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = 'public.restaurant_weekly_hours'::regclass;

SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'restaurant_weekly_hours'
ORDER BY policyname;

SELECT
  tgname AS trigger_name,
  tgenabled AS enabled,
  pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.restaurant_weekly_hours'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'restaurant_weekly_hours'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

SELECT
  has_table_privilege('anon', 'public.restaurant_weekly_hours', 'SELECT') AS anon_select,
  has_table_privilege('anon', 'public.restaurant_weekly_hours', 'INSERT') AS anon_insert,
  has_table_privilege('anon', 'public.restaurant_weekly_hours', 'UPDATE') AS anon_update,
  has_table_privilege('anon', 'public.restaurant_weekly_hours', 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'DELETE') AS authenticated_delete;

SELECT
  count(*) = 7 AS has_seven_named_constraints
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

COMMIT;
