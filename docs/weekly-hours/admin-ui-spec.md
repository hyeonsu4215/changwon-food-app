# Admin Weekly Hours UI Specification

> IMPLEMENTATION PENDING. The schema and initial 112 rows are deployed, but no admin code or weekly-hours write path is implemented yet.

## Product Boundary

The weekly editor manages only `restaurant_weekly_hours`. It never sends restaurant name, address, map settings, legacy hour fields, or any other `restaurants` column.

Until the user app reader is separately approved, legacy restaurant fields remain the production source of truth. The weekly editor must display a persistent `준비 데이터 · 사용자 앱 미적용` status during that period.

## Information Architecture

Within the existing catalog restaurant mode:

1. Select a Supabase restaurant.
2. Edit and save existing basic information in the current form.
3. Open the separate `영업시간 관리` section.
4. Load weekly rows and legacy reference values independently.

The two sections have different save buttons, dirty state, request state, validation, and payload builders. Saving one section must not submit the other form.

## Desktop Layout

- Header: restaurant name, data source badge, weekly status badge, refresh control.
- Legacy reference band: raw open, close, break, and closed values; never silently normalized in the UI.
- Seven stable day panels arranged as a vertical list or two-column responsive grid, not a seven-column spreadsheet.
- Day header: weekday and segmented control for `영업`, `정기휴무`, `정보 미확인`.
- Open-day controls: opening time, closing time, and `익일 마감` checkbox.
- Break controls: `있음`, `없음`, `정보 미확인`; scheduled mode reveals start and end time.
- Footer: change count, preview button, discard button, and weekly-only save button.

## Mobile Layout

Use one accordion/card per weekday. Keep the header visible with weekday, status text, and a compact summary such as `10:30-20:00 · break 14:30-17:00`.

Opening a card reveals controls in one column. All inputs and segmented controls must fit 360-430px without horizontal scrolling. Only one or two day cards need to be expanded at once; expanding a card must not discard edits in another card.

## Local Editor State

Keep these values separate:

- `restaurantId`, source, and request generation token.
- Original seven-row snapshot from the server.
- Current seven-day draft.
- Dirty weekdays and validation errors.
- Saving state and read-back result.
- Bulk-action undo snapshot.

Restaurant change, source change, refresh, logout, and form reset invalidate the request generation and clear the editor. If dirty, request confirmation before discarding the local draft.

## Status Badges

Compute status from rows and verification metadata; do not add a database status column in v1. Review is complete only when all seven rows have a non-null `last_verified_at`.

- `영업시간 설정 완료`: exactly seven structurally valid rows, no unknown day, review complete.
- `확인 필요`: seven rows exist but an unknown value remains or review is incomplete.
- `정보 미확인`: seven rows exist and every day is unknown.
- `Legacy 사용 중`: fewer than seven rows, C024 special fallback, or no weekly rows.

## Bulk Actions

- Copy Monday to selected weekdays.
- Apply one draft to Monday-Friday.
- Apply one draft to explicitly selected weekdays.
- Apply only break settings to selected open days.

Every bulk action first shows affected weekdays and field-level before/after values. Applying it creates one undo snapshot. Undo is available until another bulk action, restaurant change, refresh, or successful save.

Bulk operations never auto-save. Closed and unknown targets require explicit confirmation before an open-day schedule is copied onto them.

## Validation

- Exactly seven unique ISO weekdays are required for a complete save.
- Open requires both times; closed/unknown clears both times.
- Non-open clears `closes_next_day`.
- Scheduled break requires an open day and both break times.
- None/unknown break clears break times.
- Equal open/close and overnight choices receive an explicit review prompt rather than an inferred correction.
- C024 is blocked from weekly completion while recurring closure support is absent.

## Save Flow

Future implementation should use a dedicated `saveWeeklyHours()` path:

1. Fail unless the authenticated admin is on the Supabase source.
2. Snapshot restaurant ID, source, generation, and original rows.
3. Validate and normalize only weekly fields.
4. Re-fetch current weekly rows and reject stale snapshots.
5. Show a field-level preview and obtain confirmation.
6. Submit seven rows in one weekly-table request; no `restaurants` payload is present.
7. Require exactly seven returned rows with unique weekdays.
8. Read the seven rows again and compare every persisted field.
9. Only then replace the original snapshot, clear dirty state, and show success.

The save button is disabled while saving, and the helper also rejects double submission. A source or restaurant change during the request invalidates the result so it cannot update another editor.

A single PostgREST bulk request is preferable to seven requests. Before owner concurrency is enabled, evaluate a transaction-safe RPC with expected-version checks; client-side pre-fetch alone cannot eliminate the final race window.

## Failure Behavior

Auth, RLS, network, row-count, stale-snapshot, and read-back failures keep the draft dirty and retryable. They never update the local original snapshot or report success.

Static source shows legacy values but hides or disables all weekly write commands with a textual read-only reason. Function-level guards run before a Supabase client call.

## User App Transition

This UI does not switch the user app reader. A later feature may select weekly data per restaurant only when all seven rows are present, structurally valid, reviewed, and compatible with special closures. All other restaurants continue through the legacy reader.
