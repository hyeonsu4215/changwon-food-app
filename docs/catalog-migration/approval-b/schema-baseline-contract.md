# Approval B Schema Baseline Contract

> STATUS: NOT EXECUTED. This package must not be run without separate Approval B authorization.

## Required Schema

- Table: `public.menus`
- Column: `food_character`
- Type: `text`
- Nullable: `YES`
- Default: none
- Constraint: exactly one `menus_food_character_allowed`
- Constraint type: validated `CHECK`, not `NO INHERIT`
- Referenced column: only `food_character`
- Allowed values: `rice-meal`, `noodle-special`, `hot-soup`, `quick-snack`, `main-dish`
- `NULL` is allowed; empty strings, arbitrary slugs, and Secondary Trait values are rejected.

## Fail-closed Validation

The transaction reads `information_schema.columns`, `pg_attribute`, and `pg_constraint` before either INSERT. It validates column metadata, constraint identity and metadata, the sorted literal set, and a normalized expression shape.

The expression normalization removes PostgreSQL-rendered whitespace, parentheses, and `text` casts, then replaces each literal with a placeholder. This avoids comparing raw `pg_get_constraintdef()` formatting while still rejecting extra operators, branches, literals, columns, or a sixth value. A PostgreSQL rendering that is not recognized fails closed.

The catalog expression is also evaluated against in-memory `VALUES`: `NULL` and all five approved values must be true, while an empty string and representative invalid/Secondary Trait slugs must be false. These probes perform no table INSERT, temporary DDL, or schema change.

## Source Checkpoint

- Commit: `47500127be5f44979b7154422388ec643d04722a`
- Baseline backup manifest: `docs/catalog-migration/backups/pre-migration-backup-manifest.json` in that checkpoint
- Existing baseline: restaurants 1, menus 0, C001 21-field fingerprint unchanged

The executable artifact for a later explicit approval is `02-migrate-catalog.sql`. The rollback artifact is separate and also requires explicit approval.
