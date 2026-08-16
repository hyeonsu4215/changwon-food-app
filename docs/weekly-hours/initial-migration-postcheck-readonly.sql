-- READ ONLY POST-CHECK.
BEGIN;
SET TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.restaurants) AS restaurants,
  (SELECT count(*) FROM public.menus) AS menus,
  (SELECT count(*) FROM public.restaurant_weekly_hours) AS weekly_rows,
  (SELECT count(DISTINCT restaurant_id) FROM public.restaurant_weekly_hours) AS weekly_restaurants,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'open') AS open_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'closed') AS closed_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'unknown') AS unknown_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'scheduled') AS scheduled_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'none') AS none_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'unknown') AS unknown_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE source = 'legacy_migration') AS legacy_source_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE last_verified_at IS NULL) AS unverified_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id IN ('C004', 'C005', 'C006', 'C008', 'C012', 'C016', 'C018', 'C021', 'C024', 'C025', 'C026', 'C028', 'C029')) AS manual_review_rows,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id = 'C024') AS c024_rows;

SELECT
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
  last_verified_at,
  updated_at
FROM public.restaurant_weekly_hours
WHERE restaurant_id IN ('C001', 'C002', 'C003', 'C007', 'C009', 'C010', 'C011', 'C013', 'C014', 'C015', 'C017', 'C019', 'C020', 'C022', 'C023', 'C027')
ORDER BY restaurant_id, iso_weekday;

COMMIT;
