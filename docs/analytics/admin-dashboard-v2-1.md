# Admin Analytics v2.1: daily metric chart

## Scope

This change adds one selectable daily line chart to the existing date-range dashboard. It does not add a table, column, index, policy, or event write path.

The chart metrics are sessions, completed recommendation sessions, recommendation refreshes, menu detail opens, map opens, shares, eaten records, and returning sessions. Sessions remain the default.

## RPC contract

`public.get_admin_analytics_dashboard_range(date, date)` keeps its signature, default parameters, JSON top-level keys, admin guard, `SECURITY DEFINER`, `search_path = pg_catalog`, and effective execute grants. Its `daily` objects add seven fields while retaining `date` and `sessions`.

Every selected calendar date is returned, including zero-activity dates. Boundaries use `server_received_at` and the `Asia/Seoul` calendar. Internal-test sessions remain excluded from regular KPI data. Recommendation completion keeps the existing three-position, three-distinct-menu definition.

The function validates that every daily series total equals the matching summary or retention total before returning JSON. The admin client repeats those checks and rejects malformed responses.

## UI behavior

Changing the chart metric only re-renders the already loaded payload. It does not call the RPC again. The metric remains selected when the date range changes and resets to sessions on administrator logout.

All dates are represented by SVG points. Axis labels are thinned for longer ranges. The exact selected metric is repeated in the numeric daily list below the chart.

## Safety

The migration replaces only the date-range RPC. It contains no Analytics row write, core catalog write, table/schema/RLS/policy/index change, or raw-table grant. The backup, precheck, and postcheck scripts are read-only. Rollback restores the v2 RPC body and does not use `CASCADE`.

No migration is executed by preparing this package.
