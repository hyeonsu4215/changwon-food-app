# Approval A Food Character Schema Plan

> NOT EXECUTED. This document and migration file prepare a separately approved schema change only.

## Versioned migration

- File: `supabase/migrations/20260809094834_add_food_character.sql`
- Target: `public.menus`
- Constraint: `menus_food_character_allowed`
- Preflight checkpoint: `47500127be5f44979b7154422388ec643d04722a`

The migration fails closed if `public.menus` is missing, the baseline menu count is not 0, `food_character` already exists in any form, or the named constraint already exists. It does not replace or reinterpret an existing schema object.

## Before

| Item | Current |
| --- | ---: |
| Supabase restaurants | 1 row |
| Supabase menus | 0 rows |
| `food_character` | column absent |
| User app catalog | static 29/100 |

## Approval A operations

1. Add `public.menus.food_character TEXT NULL`.
2. Add a CHECK allowing exactly `rice-meal`, `noodle-special`, `hot-soup`, `quick-snack`, and `main-dish` when the value is not null.

The column is nullable so schema rollout and the separately approved 100-row catalog migration remain independent. No DEFAULT or backfill is defined.

## Data and application impact

| Scope | Expected change |
| --- | ---: |
| Restaurant writes | 0 |
| Menu row inserts | 0 |
| Menu row updates | 0 |
| Menu row deletes | 0 |
| RLS or policy changes | 0 |
| Other columns or tables | 0 |

After Approval A, menus remains at 0 rows and the user app continues using static 29/100. `app.js`, `data.js`, recommendation behavior, and the existing administrator save payload are unchanged. The FC-1 Primary Food Character select remains disabled preview UI; FC-2 activation is a separate feature and approval.

Secondary Trait and `food_traits` are outside this migration.

## After expected

| Item | Expected |
| --- | ---: |
| Supabase restaurants | 1 row, unchanged |
| Supabase menus | 0 rows, unchanged |
| `food_character` | nullable column present |
| User app catalog | static 29/100 |

## Explicitly excluded next steps

- Insert restaurants C002-C029.
- Insert menus M001-M100.
- Populate 100 Food Character values.
- Enable the administrator Food Character control or save payload.
- Connect Food Character to the recommendation algorithm.

Each item requires a later feature and separate approval. Approval A must stop after schema verification.

## Rollback plan

If Approval A has been applied but no Food Character data migration or client activation has occurred, a separately approved rollback can run the following transaction:

```sql
begin;

alter table public.menus
  drop constraint menus_food_character_allowed;

alter table public.menus
  drop column food_character;

commit;
```

This rollback is documentation only and has not been executed. Before any rollback, confirm that no deployed client reads or writes `food_character` and that Approval B has not populated it.

## Execution recommendation

Preferred: install and configure Supabase CLI under a separate approval, preserve this versioned migration in Git, verify the linked project, and run `supabase db push --dry-run` before applying only the reviewed Approval A migration. Stop after schema verification; Approval B must never run automatically.

Secondary: use a normally authenticated Supabase SQL Editor session to run the exact reviewed migration as one batch. This is operationally simpler, but direct remote SQL can bypass a repository migration-history workflow.

No credential belongs in this migration, documentation, command history, or generated output.

Official references:

- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://supabase.com/docs/guides/database/overview
