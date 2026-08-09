# Catalog Migration Preflight Report

> READ-ONLY PREFLIGHT. No Supabase write, schema change, RLS change, seed, or migration was executed.

## Baseline

- Generated: 2026-08-09T09:05:09.474Z
- Project URL: https://poxvxxwtrblkjfrqqnrw.supabase.co
- Catalog tables: `restaurants`, `menus`
- Related public resources used by the app: `menu_reviews`, `info_reports`, `admin_users`, `menu_review_summary`, `menu_taste_summary`
- Anon-visible Supabase rows: restaurants 1, menus 0
- Static rows: stores 29, menus 100
- Current admin status: partial
- Current user app expected source: static
- Source mismatch: true

## Schema observation

Explicit GET selects verified 21 restaurant columns and 18 menu columns. The menus table currently has no rows, so runtime value shape cannot be sampled. The PostgREST OpenAPI endpoint rejected anon access and requested service-role credentials; those credentials were not requested or used. Required/nullable, PK, and FK constraints are therefore **unconfirmed**. Existing `onConflict: "id"` and relationship code are implementation evidence only.

- restaurants: GET 200, anon-visible rows 1
- menus: GET 200, anon-visible rows 0
- menu_reviews: GET 200, anon-visible rows 0
- info_reports: GET 200, anon-visible rows 0
- admin_users: GET 200, anon-visible rows 0
- menu_review_summary: GET 200, anon-visible rows 0
- menu_taste_summary: GET 200, anon-visible rows 7

## Payload validation

- Stores: 29, duplicate IDs 0, invalid identity/coordinate/boolean 0/0/0
- Menus: 100, duplicate IDs 0
- Missing restaurant references: 0
- Invalid price/taste/tags/available: 0/0/0/0
- Food Character candidate: 100, missing 0, extra 0, duplicate 0
- Distribution: rice-meal 24, noodle-special 25, hot-soup 16, quick-snack 21, main-dish 14

## C001

C001 has 1 non-identical field(s). No winner is selected. See `c001-conflict-analysis.md`.

## Migration strategy comparison

| Strategy | Write steps | Partial-failure risk | Rollback | Validation | User app risk |
| --- | --- | --- | --- | --- | --- |
| A. Nullable schema, then bulk 29/100 with FC | Schema + 2 REST bulk writes | Stores can commit before menus fail | Medium | Good between steps | App switches when any active store and available menu coexist |
| B. Catalog, then schema, then FC update | 2 bulk writes + schema + another 100-row write | Highest; app may switch before FC completion | Hard | Multiple intermediate states | Highest |
| C. Nullable schema, then one server-side catalog transaction with assertions | Schema approval + one transactional catalog operation | Lowest; assertion failure rolls back catalog | Best with baseline backup | Best | Source changes only after transaction commit |

**Recommendation: C.** Approve the nullable schema separately, then use a dedicated server-side transaction that asserts the 1/0 baseline, resolves C001 explicitly, writes 29/100 including Food Character, validates counts/references/allowed values, and rolls back on any failure. Do not use the current browser seed function for production migration.

## Existing seed function

`seedCatalogFromStatic()` is locked. It bulk-upserts `restaurants` first and `menus` second with `onConflict: "id"`. The two requests are not one transaction; a menu failure leaves restaurant changes committed. It has no preflight baseline assertion, C001 conflict decision, manifest, post-write validation, or rollback. It is insufficient for the production migration.

## User source transition

The user app queries only active restaurants and available menus, then selects Supabase when both arrays are non-empty. It does not wait for 29/100 completeness.

- Complete 29/100: expected Supabase source after integrity checks pass.
- Stores succeed, menus fail and remain 0: static fallback remains, but DB is partially changed.
- First available menu appears: the app can switch early even if the menu set is incomplete.
- Orphan or inactive-store-linked menus: diagnostics warn, but source selection can still occur if any active store and any available menu exist.

Treat "DB write success" and "safe user-source switch" as separate approval gates.

## Approval gates

1. Preserve current backup and hashes.
2. Approve nullable schema preview.
3. Approve 29/100 payload and Food Character diff.
4. Resolve C001 fields manually.
5. Recheck exact baseline counts and target IDs immediately before execution.
6. Approve schema execution separately.
7. Approve one transaction-safe catalog write separately.
8. Validate 29/100, orphan 0, inactive-linked sellable 0, Food Character 100/100.
9. Verify admin normal state and user app Supabase source.
10. Confirm rollback evidence before closing the migration window.

## Preflight verdict

Schema/migration approval review is possible after the C001 field conflict is explicitly decided and server-side transaction payload is reviewed.
