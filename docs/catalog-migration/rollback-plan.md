# Catalog Migration Rollback Plan

> PLAN ONLY. No DELETE, UPDATE, schema change, or rollback command was executed.

## Baseline

- Captured at: 2026-08-09T09:05:09.474Z
- Supabase restaurants: 1 row, C001
- Supabase menus: 0 rows
- User app source: static 29/100

## Identity and manifest

- Preserve the exact C001 backup before every write approval.
- Treat C002-C029 as proposed inserts only after rechecking the baseline.
- Treat M001-M100 as proposed inserts only after confirming menus is still empty.
- Abort if any target ID exists unexpectedly; do not broaden deletion criteria.

## Catalog rollback sequence

1. Stop and record post-write counts and failed gate; do not patch data in place.
2. Remove only migration-owned M001-M100 rows identified by the approved manifest.
3. Remove only migration-owned C002-C029 rows identified by the approved manifest.
4. Restore C001 from `backups/pre-migration-stores.json` field-for-field.
5. Validate restaurants=1, menus=0 and rerun orphan/inactive checks.
6. Confirm the user app falls back to static 29/100 before declaring rollback complete.

## Schema rollback

The nullable column may remain harmless while no client consumes it. Dropping the CHECK constraint or column requires separate schema approval and must occur only after confirming that no deployed code references `food_character`. Catalog rollback and schema rollback are independent decisions.
