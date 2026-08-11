# Approval B Final Approval Summary

> STATUS: NOT EXECUTED. No database write was performed while preparing this package.

## Before

- Restaurants: 1
- Menus: 0
- C001: unchanged 21-field fingerprint
- User app expected source: static

## Required Schema

- `public.menus.food_character`: nullable `text`, no default
- Exactly one validated `menus_food_character_allowed` CHECK
- Exact values: `rice-meal`, `noodle-special`, `hot-soup`, `quick-snack`, `main-dish`
- `NULL` allowed; arbitrary and Secondary Trait values rejected

## Planned Write

- Restaurants INSERT: 28 (`C002-C029`)
- Menus INSERT: 100 (`M001-M100`)
- Food Character populated: 100/100
- UPDATE: 0
- UPSERT: 0
- DELETE: 0
- C001 write: 0

Distribution: `rice-meal 24`, `noodle-special 25`, `hot-soup 16`, `quick-snack 21`, `main-dish 14`.

## Expected After

- Restaurants: 29
- Menus: 100
- User app expected source: Supabase

## Failure Behavior

The SQL is one serializable transaction. Any schema, baseline, write-count, relationship, Food Character, distribution, or C001 assertion failure aborts before COMMIT. The expected database remains restaurants 1, menus 0, and the user app remains on static data.

## Artifacts

- Execution target after separate approval: `02-migrate-catalog.sql`
- Post-commit rollback after separate approval: `03-rollback-catalog.sql`
- Payload audit inputs: `restaurants-insert-preview.json`, `menus-insert-preview.json`
- Source checkpoint: `47500127be5f44979b7154422388ec643d04722a`
