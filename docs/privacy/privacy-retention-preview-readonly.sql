WITH bounds AS (
  SELECT
    current_timestamp AS generated_at,
    current_timestamp - interval '2 years' AS analytics_cutoff,
    current_timestamp - interval '6 months' AS report_cutoff
),
analytics_preview AS (
  SELECT
    count(*) AS target_count,
    min(event_row.server_received_at) AS oldest_target_at,
    max(event_row.server_received_at) AS newest_target_at
  FROM public.analytics_events AS event_row
  CROSS JOIN bounds
  WHERE event_row.server_received_at < bounds.analytics_cutoff
),
report_preview AS (
  SELECT
    count(*) AS target_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', report_row.id,
          'status', report_row.status,
          'completed_at', report_row.completed_at
        ) ORDER BY report_row.completed_at, report_row.id
      ),
      '[]'::jsonb
    ) AS targets
  FROM public.info_reports AS report_row
  CROSS JOIN bounds
  WHERE report_row.status IN ('done', 'rejected')
    AND report_row.completed_at IS NOT NULL
    AND report_row.completed_at < bounds.report_cutoff
)
SELECT jsonb_build_object(
  'generated_at', bounds.generated_at,
  'analytics', jsonb_build_object(
    'cutoff', bounds.analytics_cutoff,
    'count', analytics_preview.target_count,
    'oldest_server_received_at', analytics_preview.oldest_target_at,
    'newest_server_received_at', analytics_preview.newest_target_at
  ),
  'info_reports', jsonb_build_object(
    'cutoff', bounds.report_cutoff,
    'count', report_preview.target_count,
    'items', report_preview.targets
  )
) AS privacy_retention_preview
FROM bounds
CROSS JOIN analytics_preview
CROSS JOIN report_preview;
