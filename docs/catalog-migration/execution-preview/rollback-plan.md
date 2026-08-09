# Execution Rollback Plan

> PLAN AND SQL PREVIEW ONLY. No rollback was executed.

## Approval B transaction fails

PostgreSQL aborts the transaction. No C002-C029 or M001-M100 row becomes visible, C001 remains untouched, and the catalog remains restaurants 1 / menus 0.

## Approval A succeeds but Approval B fails

The catalog remains 1/0. The nullable, unused `menus.food_character` column does not affect the current user app because deployed code does not read it. Keep the column temporarily and decide any DROP under a separate schema approval; an urgent DROP adds avoidable risk.

## Approval B commits but operational validation fails

Use `03-rollback-catalog.sql` only after separate approval. It requires the exact 29/100 committed state and the unchanged C001 fingerprint, then deletes M001-M100 before C002-C029 in one transaction. It asserts the restored 1/0 state before COMMIT. It never updates or deletes C001.

Schema rollback remains separate. Drop the CHECK before the column only after confirming no deployed client consumes `food_character`.
