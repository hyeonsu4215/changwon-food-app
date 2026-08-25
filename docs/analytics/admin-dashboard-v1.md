# Admin Usage Dashboard v1

The administrator dashboard shows aggregate product-usage signals, never raw analytics rows or identifiers.

## Metrics

- Today sessions: distinct non-test `session_start` sessions received during the current KST calendar day.
- Completed sessions: sessions with at least one normal recommendation containing positions 1, 2, and 3 with three distinct menus.
- Completion rate: completed sessions divided by today sessions. An empty denominator is displayed as `-`.
- Refresh, detail, map, share, and error values are event action counts, not user or visit counts.
- Acquisition values describe sessions started from tagged links. They do not prove the user's last platform.
- Restaurant interest counts recommendation rows, menu-detail opens, and map opens for the current KST seven-day window.
- Restaurant analytics remain visible when a catalog row is later deleted; the dashboard keeps the stored restaurant ID and displays `삭제된 가게` as the name.

## Privacy and safety

Sessions whose `session_start` has `acquisition_source = internal_test` are excluded in full before date aggregation. The browser calls one admin-only aggregate RPC. Raw event, session, and recommendation identifiers are never returned.

The RPC is `SECURITY DEFINER`, uses `search_path = pg_catalog`, and calls `public.is_admin()` before reading aggregates. Only `authenticated` receives execute permission. Raw table grants, RLS, policies, event types, and analytics data are unchanged.

## v1 scope

The UI contains today's KPIs, acquisition counts, a seven-day summary, and seven-day restaurant interest. It intentionally excludes streaming, raw event inspection, exports, arbitrary date ranges, funnels, retention, and device analysis.
