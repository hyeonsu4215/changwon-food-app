# Catalog Migration Final Approval Summary

> PREVIEW ONLY. Approval A and Approval B are separate. No database or schema change was executed.

Generated: 2026-08-09T09:27:27.566Z

## Before

| Item | Current |
| --- | ---: |
| Supabase restaurants | 1 |
| Supabase menus | 0 |
| Existing untouched row | C001 리코리코 |
| User app catalog | static 29/100 |

## Approval A: Schema Only

- Add `public.menus.food_character TEXT NULL`.
- Add a CHECK allowing only `rice-meal`, `noodle-special`, `hot-soup`, `quick-snack`, and `main-dish` when non-null.
- No default, backfill, Secondary Trait, `food_traits`, or RLS change.
- Approval A must stop after schema verification. Approval B is never automatic.

## Approval B: One Catalog Transaction

| Write | Rows |
| --- | ---: |
| Restaurants INSERT | 28 |
| Restaurants UPDATE | 0 |
| Menus INSERT | 100 |
| Menus UPDATE | 0 |
| C001 write | 0 |
| DELETE | 0 |

## Exact Diff

| Resource | Existing untouched | New | Updated | Deleted |
| --- | --- | --- | ---: | ---: |
| Restaurants | C001 | C002-C029 (28) | 0 | 0 |
| Menus | none | M001-M100 (100) | 0 | 0 |
| Food Character | none | 100 values on the new menu rows | 0 | 0 |

## Expected After Approval B

| Item | Expected |
| --- | ---: |
| Supabase restaurants | 29 |
| Supabase menus | 100 |
| Food Character populated | 100/100 |
| Food Character null/invalid | 0/0 |
| Orphan menus | 0 |
| User app catalog | Supabase |

Distribution: rice-meal 24, noodle-special 25, hot-soup 16, quick-snack 21, main-dish 14.

## C001 Decision

C001 is excluded from every write payload. Its existing Supabase value, including `last_checked = 2026-06-15T00:00:00+00:00`, is fingerprinted before and after the transaction and must remain unchanged.

All 100 menu references resolve across C001-C029. Five new menu rows reference the existing active C001 row, so no C001 write is needed for referential completeness.

## Failure Boundaries

- Transaction assertion/write failure: automatic rollback; the visible catalog remains 1/0.
- Schema succeeds but catalog transaction fails: 1/0 remains and only an unused nullable column exists. Do not rush to drop it; handle schema rollback under a separate approval.
- Catalog commits but operational validation fails: use the separately reviewed rollback transaction to delete only M001-M100 and C002-C029, leaving C001 untouched.
