-- Run each SELECT separately in Supabase SQL Editor and export each result.
-- Store exports outside the repository with restricted access.

SELECT event_row.*
FROM public.analytics_events AS event_row
WHERE event_row.server_received_at < current_timestamp - interval '2 years'
ORDER BY event_row.server_received_at, event_row.event_id;

SELECT report_row.*
FROM public.info_reports AS report_row
WHERE report_row.status IN ('done', 'rejected')
  AND report_row.completed_at IS NOT NULL
  AND report_row.completed_at < current_timestamp - interval '6 months'
ORDER BY report_row.completed_at, report_row.id;
