# Weekly Hours Backup And Rollback Plan

> Historical planning record. Pre-migration backups were created outside Git, and the schema plus initial 112 rows were applied manually on 2026-08-16. No rollback has been executed or approved.

## Approval-time Backup Set

Immediately before any future schema execution, produce one timestamped raw backup directory outside Git:

1. All 29 `restaurants` rows with every column.
2. Legacy hours snapshot: ID, name, four legacy hour fields, and `updated_at`.
3. All menu IDs plus row count and deterministic hash; export full menus if the approved migration can touch them.
4. Restaurants column metadata and defaults.
5. Constraints and indexes.
6. Trigger definitions and trigger-function definitions.
7. RLS enabled/forced flags and policy definitions.
8. Grants for anon and authenticated roles.
9. Existing weekly-hours rows if the table already exists at execution time.
10. SHA-256 manifest containing file names, byte sizes, row counts, source commit, and audit timestamp.

Raw JSON, credentials, SQL Editor exports, and database URLs remain outside Git. Git candidates are the sanitized schema design, reviewed migration preview, approved SQL text, and a manifest with no secrets or raw row content.

## Validation Checkpoints

### Before schema

- Reconfirm origin/main, DB counts 29/100, exact legacy snapshot hash, table absence, and current policy/trigger contracts.
- Stop on drift; do not adapt the approved SQL during the execution window.

### After schema

- Verify exact columns, defaults, constraints, PK/FK, RLS, policies, grants, and trigger.
- Confirm weekly row count remains zero and legacy hashes are unchanged.

### After initial migration

- Expected rows: 112 only.
- IDs represented: 12 AUTO_SAFE plus 4 UNKNOWN.
- Every represented restaurant has exactly seven unique weekdays.
- Manual-review restaurants have zero rows.
- C024 has zero weekly rows.
- Legacy fields and menus are unchanged.

## Rollback By Failure Stage

### A. Schema creation problem

Keep the user and admin readers on legacy. Do not automatically drop objects. Compare actual schema with the backup, prepare a separate cleanup SQL, review dependencies, and request explicit destructive approval.

### B. Initial migration transaction failure

The approved migration must be atomic so failed inserts leave zero new rows. Verify weekly count and legacy hashes. Do not run a second attempt until the failure is understood and the baseline is reconfirmed.

### C. Post-migration validation failure

Keep weekly data unused. Preserve the unexpected rows as evidence, compare them with the 112-row manifest, and prepare a targeted restore or cleanup transaction. Any delete requires separate approval.

### D. Admin UI problem

Disable or revert only the weekly editor feature. Existing restaurant administration and the legacy user reader remain operational. Do not modify weekly rows merely to hide a UI defect.

### E. User weekly reader problem

Turn off the weekly-reader feature gate and return to legacy fields per restaurant. Because legacy values were never changed or removed, no database rollback is required for immediate service recovery.

## C024 Safety

C024 remains legacy-only until recurring closure support is implemented and validated. No rollback may replace `2,4번째 일요일` with every-Sunday closure.

## Owner Expansion Boundary

Owner UI and policies are not part of 3B. The composite key and restaurant FK allow future membership-based policies without changing existing row identity. Before owner writes, add server-side concurrency protection, owner audit attribution, and owner-specific tests under a separate approval.
