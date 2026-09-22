# Admin Analytics Dashboard v2

## What changes

The administrator can view aggregate Analytics for today, yesterday, the latest 7 or 30 KST calendar days, the full available history, or a custom inclusive date range. The server remains the authoritative source for today's date.

The new RPC is additive:

`public.get_admin_analytics_dashboard_range(p_start_date date, p_end_date date)`

The existing `public.get_admin_analytics_dashboard()` RPC is preserved without a signature, body, or ACL change so the production v1 administrator remains compatible until the v2 frontend is released.

## Metric contract

- Dates use `server_received_at` and Asia/Seoul calendar boundaries.
- A session whose `session_start` acquisition source is `internal_test` is excluded in full from regular metrics.
- A completed recommendation still requires exactly positions 1, 2, and 3, three distinct menus, and a `discovery` or `personalized` source context.
- Restaurant recommendation exposure remains an event-row count. Deleted restaurant rows remain visible as `삭제된 가게`.
- Daily rows include every selected calendar date, including zero-session dates.
- `재방문 세션 비중` is returning sessions divided by measured sessions. It is a session classification metric, not user retention or an identified-user cohort.
- The measurement start date is derived from eligible measured `session_start` data and is never hardcoded.

## Validation

Both dates omitted means the latest seven KST calendar days. Supplying only one date, reversing the range, selecting a future end date, or requesting more than 731 calendar days fails with an invalid-parameter error.

## Security and migration scope

The range RPC is `SECURITY DEFINER`, fixes `search_path` to `pg_catalog`, and checks `public.is_admin()` before reading. `PUBLIC` and `anon` execute are revoked; `authenticated` and `service_role` receive execute, while the function owner retains its owner privilege. The application-level admin check remains mandatory.

The migration adds one function only. It performs no table DDL, policy or RLS change, raw Analytics grant, index change, or row DML. The rollback removes only the new range RPC and never uses `CASCADE`.

## Release order

1. Export `admin-dashboard-v2-backup-readonly.sql` results outside the repository.
2. Run the read-only precheck and review the migration.
3. Apply the migration only after explicit Production DB approval.
4. Run the read-only postcheck and controlled RPC validation.
5. Release the frontend only after the new RPC is verified.
